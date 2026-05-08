# Design 19: Playlists

## 1. Overview

A **playlist** is an ordered list of pattern entries stored per-scene on disk. Each entry references a pattern file, carries a display label, and stores **local parameter defaults** — enabling the same pattern code to appear multiple times with different configurations.

Two distinct concepts:

| Concept | Where it lives | What it is |
|---------|---------------|------------|
| **Playlist Library** | `simulation/scenes/<scene>/playlists/*.yaml` | Authored show content — saved, versioned, shared |
| **Playlist Assignment** | `marsin_engine/states/<scene>/deck_state.yaml` + `mixer_state.yaml` | Runtime state — which playlist is loaded, active entry cursor, shuffle state |

The library is show content. The assignment is runtime state. They never mix.

---

## 2. Data Model

### 2.1 Playlist File Format

```yaml
# simulation/scenes/test_bench/playlists/experimental_flash.yaml
schemaVersion: 1
name: experimental_flash
entries:
  - id: "e_1715120000001"                     # stable unique ID
    pattern: 13_sparkle                        # source .js file (without extension)
    label: "Sparkle — Slow Dreamy"             # display name (null → use pattern name)
    defaults:                                   # local param overrides by export name
      bgFadeSpeed: 0.01
      sparkleSpeed: 0.005
      sparkleDensity: 0.2
      bgHue1: 0.55
    notes: "Good for opening set"              # optional user notes

  - id: "e_1715120000002"
    pattern: 13_sparkle                        # same pattern, different config
    label: "Sparkle — Fast Strobe"
    defaults:
      bgFadeSpeed: 0.09
      sparkleSpeed: 0.04
      sparkleDensity: 0.8

  - id: "e_1715120000003"
    pattern: 08_ocean_liner
    label: null                                # null → displays as "08_ocean_liner"
    defaults: {}                               # empty → pattern's built-in defaults

  - id: "e_1715120000004"
    pattern: 25_heartbeat
    label: "Heartbeat — Red Alert"
    defaults:
      pulseHue: { h: 0.0, s: 1.0, v: 1.0 }   # HSV picker values
      pulseSpeed: 0.08
```

### 2.2 Entry IDs

Every entry has a **stable unique `id`** (e.g., `e_` + timestamp). This is required because:

- The same pattern can appear multiple times — pattern name is not identity
- Autopilot, active cursor, shuffle, delete, and reorder all need an unambiguous handle
- Capture-defaults targets a specific entry by ID, not by pattern name or index

IDs are generated server-side when an entry is added and persist for the life of the entry.

### 2.3 Defaults Storage: Named Exports, Not Control IDs

Local params are stored by **export variable name**, not numeric control IDs:

```yaml
# Good: stable across recompiles
defaults:
  bgFadeSpeed: 0.01
  sparkleSpeed: 0.005

# Bad: fragile, compiler-assigned
defaults:
  '1115050250': { v0: 0.01 }
```

Resolution at load time:
```js
const exports = wasmHost.getExports(handle);
for (const [name, value] of Object.entries(entry.defaults)) {
  const exp = exports.find(e => e.name === name);
  if (!exp) { console.warn(`[Playlist] Stale default "${name}" in ${entry.pattern}`); continue; }
  // Skip CPC-owned exports — shared params are never overridden by playlist defaults
  if (paramCenter && paramCenter.isSharedExport(channelId, exp.name)) continue;
  if (typeof value === 'object' && value !== null) {
    paramRouter.setChannelControl(channelId, exp.id, value.h, value.s, value.v);
  } else {
    paramRouter.setChannelControl(channelId, exp.id, value, 0, 0);
  }
}
```

### 2.4 Default Playlist Auto-Generation

On engine boot, if `simulation/scenes/<scene>/playlists/` is empty:

1. List all patterns from `patterns/` directory
2. Create `default.yaml` with one entry per pattern, auto-generated IDs, no labels, empty defaults
3. Write to disk immediately

---

## 3. Playlist vs Assignment

```
  ┌──────────────────── On Disk (Show Content) ──────────────────┐
  │                                                              │
  │  simulation/scenes/test_bench/playlists/                     │
  │    ├── default.yaml           entries: [e1, e2, e3, ...]     │
  │    ├── experimental_flash.yaml                               │
  │    └── chill_night.yaml                                      │
  │                                                              │
  └──────────────────────────────────────────────────────────────┘
                              │
                              │  load by name
                              ▼
  ┌──────────── Runtime Assignment (Engine State) ───────────────┐
  │                                                              │
  │  Persisted in the EXISTING state files:                      │
  │                                                              │
  │  marsin_engine/states/<scene>/deck_state.yaml                │
  │    └── new fields: playlist, activeEntryId                   │
  │                                                              │
  │  marsin_engine/states/<scene>/mixer_state.yaml               │
  │    └── per-channel: playlist, activeEntryId (future)         │
  │                                                              │
  └──────────────────────────────────────────────────────────────┘
```

### 3.1 Deck State — Existing Structure + Playlist Fields

Playlist assignment is added to the **existing** `deck_state.yaml` alongside the current channel data. The existing fields (`channel.id`, `channel.pattern`, `channel.localControls`, `channel.patternCache`) are preserved for backward compatibility.

**Current structure** (`marsin_engine/states/test_bench/deck_state.yaml`):

```yaml
channel:
  id: ch_base_1778209259268
  name: Base
  pattern: 01_cylon_sweep
  mode: blend_screen
  fader: 1
  enabled: true
  localControls: {}
  patternCache:
    02_phase_cathedral: {}
    12_breathing:
      '1115050250':
        v0: 0.29
        v1: 0
        v2: 0
```

**With playlist fields added:**

```yaml
channel:
  id: ch_base_1778209259268
  name: Base
  pattern: 01_cylon_sweep           # ← still tracks current pattern (backward compat)
  mode: blend_screen
  fader: 1
  enabled: true
  localControls: {}
  patternCache:                      # ← still used when NO playlist is active
    02_phase_cathedral: {}
    12_breathing:
      '1115050250':
        v0: 0.29
        v1: 0
        v2: 0

# ── NEW: Playlist Assignment ───────────────────────────────────
playlist:
  name: experimental_flash           # which playlist is loaded (null = none)
  activeEntryId: e_1715120000002     # stable ID of the active entry
  cursor: 1                          # index in the entries array
  autopilot:                         # per-channel independent autopilot state
    active: false
    delay_s: 30
    shuffle: false
```

### 3.2 Mixer State — Existing Structure + Per-Channel Playlist Fields

Playlist assignment is added **per channel** in the existing `mixer_state.yaml`. The existing channel fields (`id`, `pattern`, `mode`, `fader`, `localControls`, `patternCache`) are all preserved.

**Current structure** (`marsin_engine/states/test_bench/mixer_state.yaml`):

```yaml
master: 1
channels:
  - id: ch_1778205858556
    name: New Layer
    pattern: 08_ocean_liner
    mode: blend_screen
    fader: 0.52
    enabled: true
    locked: false
    transitionMode: trans_crossfade
    transitionTime: 1
    localControls: {}
    patternCache:
      07_shimmer:
        '323270901':
          v0: 0.21
```

**With per-channel playlist fields added (future):**

```yaml
master: 1
channels:
  - id: ch_1778205858556
    name: New Layer
    pattern: 08_ocean_liner         # ← still tracks current pattern
    mode: blend_screen
    fader: 0.52
    enabled: true
    locked: false
    transitionMode: trans_crossfade
    transitionTime: 1
    localControls: {}
    patternCache:
      07_shimmer:
        '323270901':
          v0: 0.21
    # ── NEW: Per-channel playlist assignment ─────────────────
    playlist:                        # (null/missing = no playlist)
      name: chill_night
      activeEntryId: e_1715120000003
      cursor: 0
      autopilot:
        active: true
        delay_s: 45
        shuffle: true
```

### 3.3 Backward Compatibility Rules

| Scenario | Behavior |
|----------|----------|
| `playlist` field missing or `null` | Engine boots in **legacy mode** — uses `channel.pattern` + `patternCache` as before |
| `playlist.name` set but playlist file missing | Falls back to legacy mode, logs warning |
| Old engine reads new state file | Ignores unknown `playlist` key — safe |
| New engine reads old state file | `playlist` is undefined — boots legacy |

The `channel.pattern` field continues to track the currently active pattern regardless of whether playlists are in use. This ensures the engine always knows what pattern is compiled without needing to resolve the playlist.

### 3.4 Key Rules

- **Library** = authored playlists on disk (`simulation/scenes/<scene>/playlists/`). Shared across restarts. Multiple channels can reference the same playlist.
- **Assignment** = runtime cursor per channel. Persisted in `deck_state.yaml` / `mixer_state.yaml` alongside existing channel data. This explicitly includes the **autopilot** sub-state so that deck and mixer channels can have independent delays and active states.
- Each channel (deck or mixer) has its **own independent** assignment, cursor, and shuffle state.

---

## 4. Who Loads What

```
  ┌────────────────────────────────────────────────────────────────┐
  │                         Deck Tab                               │
  │                                                                │
  │  ┌─────────────┐  ┌─────────────────────────────────────────┐  │
  │  │  Playlist    │  │  Entry List                             │  │
  │  │  Selector    │  │  (from loaded playlist)                 │  │
  │  │             │  │                                         │  │
  │  │ [default   ]│  │  ┌───────────────────────┐  ┌───┐      │  │
  │  │ [exp_flash ]│  │  │ ▶ Sparkle — Slow      │  │ − │      │  │
  │  │ [chill     ]│  │  │   13_sparkle           │  └───┘      │  │
  │  │             │  │  ├───────────────────────┤  ┌───┐      │  │
  │  │  [NEW]      │  │  │   Sparkle — Fast      │  │ − │      │  │
  │  │             │  │  │   13_sparkle           │  └───┘      │  │
  │  └─────────────┘  │  ├───────────────────────┤  ┌───┐      │  │
  │                   │  │   Ocean Liner          │  │ − │      │  │
  │  [💾 SAVE]        │  │   08_ocean_liner       │  └───┘      │  │
  │                   │  └───────────────────────┘              │  │
  │                   │                                         │  │
  │                   │  ┌─────────────────────────────────┐    │  │
  │                   │  │        + ADD PATTERN             │    │  │
  │                   │  └─────────────────────────────────┘    │  │
  │                   └─────────────────────────────────────────┘  │
  │                                                                │
  │  CAN: load, edit, add (+), remove (−), save, create new       │
  └────────────────────────────────────────────────────────────────┘

  ┌────────────────────────────────────────────────────────────────┐
  │                        Mixer Tab                               │
  │                                                                │
  │  Per mixer channel: load a playlist by name (read-only)        │
  │  Autopilot cycles through the loaded playlist entries          │
  │  Each channel has its own cursor and shuffle state             │
  │  No add/remove/save — Deck-only operations                    │
  └────────────────────────────────────────────────────────────────┘
```

---

## 5. Parameter Precedence

When a playlist entry is loaded into a channel, params are applied in this order. Later steps win:

```
  1. Pattern built-in defaults     (export var speed = 0.5)
     │
     ▼
  2. Playlist entry local defaults (defaults: { speed: 0.8 })
     │  ← only LOCAL exports, CPC-owned exports SKIPPED
     ▼
  3. CPC / shared globals          (paramCenter.applyToChannel)
     │  ← CPC always gets the last word
     ▼
  4. Live user tweaks              (slider/picker during performance)
```

### Capture Rules

When **capturing** current params into entry defaults:

- Only capture exports where `localControlKinds` includes the kind (1=slider, 2=toggle, 6=hsv)
- **Triggers excluded**: Kind 3 (momentary triggers) are deliberately excluded. They are not stable defaults and persisting them would cause unexpected burst/strobe misfires when autopilot cycles entries.
- **Filter out CPC-owned exports** — never store shared params in playlist defaults
- Store by export **name**, not ID

### Capture Timing

Defaults are captured **automatically** at these moments (not just on explicit save):

| Trigger | What happens |
|---------|-------------|
| User switches to a different entry | Capture active entry defaults into in-memory dirty state |
| User removes an entry | Capture before removal (so undo could restore it) |
| User taps SAVE | Capture active entry, then persist entire playlist to disk |
| User switches playlists | Prompt if dirty: "Save changes to X?" |

The in-memory playlist tracks `dirtyDefaults` per entry ID. On save, dirty defaults are merged into the entry's `defaults` field.

---

## 6. Validation Rules

### 6.1 Playlist Name Validation

Playlist names must be valid filesystem slugs:

```js
const VALID_PLAYLIST_NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/;

function validatePlaylistName(name) {
  if (!VALID_PLAYLIST_NAME.test(name)) {
    throw new Error(`Invalid playlist name: "${name}". Use lowercase alphanumeric, hyphens, underscores.`);
  }
  // Reject path traversal
  if (name.includes('..') || name.includes('/') || name.includes('\\')) {
    throw new Error(`Path traversal rejected: "${name}"`);
  }
}
```

### 6.2 Entry ID Validation

When saving a playlist, ensure all `entry.id` values are unique and non-empty. Duplicate IDs must be rejected before saving to disk.

### 6.3 Pattern Existence and Slug Validation

When loading or saving a playlist, validate each entry's pattern name is a strict slug to prevent path traversal, and then verify the pattern exists:

```js
const VALID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

for (const entry of playlist.entries) {
  if (!VALID_PATTERN.test(entry.pattern)) {
    throw new Error(`Invalid pattern name: "${entry.pattern}"`);
  }

  const patternPath = path.join(patternsDir, `${entry.pattern}.js`);
  if (!fs.existsSync(patternPath)) {
    console.warn(`[Playlist] Pattern "${entry.pattern}" in entry ${entry.id} not found — skipping`);
    entry._missing = true;
  }
}
```

Missing patterns are skipped during autopilot and marked in the UI.

### 6.4 Stale Defaults

When applying entry defaults, log warnings for export names that don't exist in the compiled pattern. Don't fail — just skip the stale key.

---

## 7. Storage Layout

```
simulation/scenes/                           ← SHOW CONTENT (authored, versioned)
  └── test_bench/
      └── playlists/
          ├── default.yaml                   auto-generated, all patterns
          ├── experimental_flash.yaml        user-created
          └── chill_night.yaml               user-created

marsin_engine/states/                        ← RUNTIME STATE (persisted, not versioned)
  └── test_bench/
      ├── deck_state.yaml                    channel data + playlist assignment
      │   └── playlist:                      (name, activeEntryId, cursor)
      ├── mixer_state.yaml                   per-channel data + playlist assignment
      │   └── channels[].playlist:           (name, activeEntryId, cursor)
      └── globals_state.yaml                 blackout, dimmers, CPC
```

Playlist **library files** are show content — they belong in the `simulation/scenes/` tree and can be version-controlled. Playlist **assignment state** (which playlist is loaded, which entry is active) is runtime state that lives in the existing `deck_state.yaml` and `mixer_state.yaml` files alongside the existing channel structure.

---

## 8. API Endpoints

### 8.1 Playlist Library (CRUD)

| Method | Path | Body | Description |
|--------|------|------|-------------|
| `GET` | `/playlists` | — | List all playlist names for the active scene |
| `GET` | `/playlists/:name` | — | Get full playlist (schema, name, entries[]) |
| `POST` | `/playlists` | `{ name, entries[] }` | Create or overwrite playlist. Validates name. Saves to disk |
| `DELETE` | `/playlists/:name` | — | Delete playlist file. Rejects "default" |

### 8.2 Deck Playlist Assignment

| Method | Path | Body | Description |
|--------|------|------|-------------|
| `GET` | `/deck/playlist` | — | Get deck's loaded playlist name + activeEntryId + cursor |
| `POST` | `/deck/playlist` | `{ name }` | Load a playlist into the deck channel |
| `POST` | `/deck/playlist/entry` | `{ entryId }` | Set active entry by ID. Compiles pattern, applies defaults |
| `POST` | `/deck/playlist/capture` | — | Capture current deck channel params as defaults for active entry |

### 8.3 Mixer Channel Playlist Assignment (Future)

| Method | Path | Body | Description |
|--------|------|------|-------------|
| `GET` | `/mixer/channels/:id/playlist` | — | Get channel's loaded playlist |
| `POST` | `/mixer/channels/:id/playlist` | `{ name }` | Load playlist into mixer channel |
| `POST` | `/mixer/channels/:id/playlist/entry` | `{ entryId }` | Set active entry for channel |

### 8.4 Entry Shape (JSON over API)

```json
{
  "id": "e_1715120000001",
  "pattern": "13_sparkle",
  "label": "Sparkle — Fast Strobe",
  "defaults": {
    "bgFadeSpeed": 0.09,
    "sparkleSpeed": 0.04,
    "sparkleDensity": 0.8
  },
  "notes": null
}
```

### 8.5 PlaylistAssignment Schema (Runtime State)

Stored inside `deck_state.yaml` and `mixer_state.yaml` per channel:

```json
{
  "name": "experimental_flash",
  "activeEntryId": "e_1715120000001",
  "cursor": 0,
  "autopilot": {
    "active": false,
    "delay_s": 30,
    "shuffle": false
  }
}
```

---

## 9. Engine Implementation

### 9.1 PlaylistManager Class

New file: `marsin_engine/lib/playlist_manager.js`

```js
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

const VALID_NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export class PlaylistManager {
  constructor(playlistsDir, patternsDir) {
    this.playlistsDir = playlistsDir;
    this.patternsDir = patternsDir;
    if (!fs.existsSync(this.playlistsDir)) {
      fs.mkdirSync(this.playlistsDir, { recursive: true });
    }
  }

  validateName(name) {
    if (!VALID_NAME.test(name)) throw new Error(`Invalid playlist name: "${name}"`);
    if (name.includes('..')) throw new Error(`Path traversal rejected: "${name}"`);
  }

  list() {
    if (!fs.existsSync(this.playlistsDir)) return [];
    return fs.readdirSync(this.playlistsDir)
      .filter(f => f.endsWith('.yaml'))
      .map(f => f.replace('.yaml', ''));
  }

  load(name) {
    this.validateName(name);
    const filePath = path.join(this.playlistsDir, `${name}.yaml`);
    if (!fs.existsSync(filePath)) return null;
    const data = yaml.load(fs.readFileSync(filePath, 'utf8'));
    // Validate pattern existence
    for (const entry of (data.entries || [])) {
      const pp = path.join(this.patternsDir, `${entry.pattern}.js`);
      if (!fs.existsSync(pp)) entry._missing = true;
    }
    return data;
  }

  save(playlist) {
    this.validateName(playlist.name);
    // Strip runtime-only fields before persisting
    const clean = {
      schemaVersion: 1,
      name: playlist.name,
      entries: (playlist.entries || []).map(e => {
        if (!e.id) throw new Error("Entry missing ID");
        if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(e.pattern)) throw new Error(`Invalid pattern: ${e.pattern}`);
        return {
          id: e.id,
          pattern: e.pattern,
          label: e.label || null,
          defaults: e.defaults || {},
          notes: e.notes || null
        };
      })
    };
    
    // Ensure uniqueness
    const ids = new Set();
    for (const e of clean.entries) {
      if (ids.has(e.id)) throw new Error(`Duplicate entry ID: ${e.id}`);
      ids.add(e.id);
    }
    
    const filePath = path.join(this.playlistsDir, `${playlist.name}.yaml`);
    fs.writeFileSync(filePath, yaml.dump(clean));
  }

  delete(name) {
    this.validateName(name);
    if (name === 'default') throw new Error('Cannot delete the default playlist');
    const filePath = path.join(this.playlistsDir, `${name}.yaml`);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }

  generateDefault() {
    const patterns = fs.readdirSync(this.patternsDir)
      .filter(f => f.endsWith('.js') && !f.startsWith('test'))
      .map(f => f.replace('.js', ''));
    const playlist = {
      schemaVersion: 1,
      name: 'default',
      entries: patterns.map((p, i) => ({
        id: `e_default_${i}`,
        pattern: p,
        label: null,
        defaults: {},
        notes: null
      }))
    };
    this.save(playlist);
    return playlist;
  }

  generateEntryId() {
    return `e_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  }

  // Capture current local controls as named defaults (CPC-filtered)
  captureDefaults(channel, wasmHost, paramCenter) {
    const exports = wasmHost.getExports(channel.handle);
    const defaults = {};
    const localKinds = new Set([1, 2, 6]); // Exclude 3 (triggers)
    for (const exp of exports) {
      if (!localKinds.has(exp.kind)) continue;
      // Skip CPC-owned exports
      if (paramCenter && paramCenter.isSharedExport(channel.id, exp.name)) continue;
      const cv = channel.localControls[exp.id];
      if (exp.kind === 6) {
        defaults[exp.name] = {
          h: cv ? cv.v0 : exp.v0,
          s: cv ? cv.v1 : (exp.v1 || 0),
          v: cv ? cv.v2 : (exp.v2 || 0)
        };
      } else {
        defaults[exp.name] = cv ? cv.v0 : exp.v0;
      }
    }
    return defaults;
  }
}
```

### 9.2 Applying Entry Defaults (CPC-Safe)

```js
function applyEntryDefaults(channel, entry, wasmHost, paramRouter, paramCenter) {
  if (!entry.defaults || Object.keys(entry.defaults).length === 0) return;
  const exports = wasmHost.getExports(channel.handle);

  for (const [name, value] of Object.entries(entry.defaults)) {
    const exp = exports.find(e => e.name === name);
    if (!exp) {
      console.warn(`[Playlist] Stale default "${name}" in ${entry.pattern} — skipping`);
      continue;
    }
    // Never override CPC-owned exports with playlist defaults
    if (paramCenter && paramCenter.isSharedExport(channel.id, exp.name)) continue;

    if (typeof value === 'object' && value !== null) {
      paramRouter.setChannelControl(channel.id, exp.id, value.h, value.s, value.v);
    } else {
      paramRouter.setChannelControl(channel.id, exp.id, value, 0, 0);
    }
  }
}
```

### 9.3 Pattern Cache Bypass for Playlist Entries

Two entries using the same pattern (e.g., two `13_sparkle`) must have **independent defaults**. The existing `patternCache` system caches by pattern name — if entry A sets `sparkleSpeed=0.01` and entry B sets `sparkleSpeed=0.04`, the cache would clobber one.

**Solution**: When loading a playlist entry, **skip `applyPatternCache`** and instead apply only the entry's `defaults`. The entry defaults ARE the cache for playlist mode.

```js
function loadPlaylistEntry(entry, channel, wasmHost, paramRouter, paramCenter) {
  const src = loadPattern(patternsDir, entry.pattern);
  const comp = wasmHost.compile(src);
  if (!comp.ok) throw new Error(comp.error);

  if (channel.handle) wasmHost.destroy(channel.handle);
  channel.handle = comp.handle;
  channel.pattern = entry.pattern;
  channel.localControls = {};

  onChannelCompiled(channel);
  // DO NOT call applyPatternCache — playlist entry defaults replace it
  applyEntryDefaults(channel, entry, wasmHost, paramRouter, paramCenter);
  finalizeCpcValues(channel);  // CPC gets the last word
}
```

### 9.4 Integration Points

```js
// In engine.js boot:
const playlistsDir = path.join(
  __dirname, '..', 'simulation', 'scenes', opts.modelName, 'playlists'
);
const playlistManager = new PlaylistManager(playlistsDir, path.join(__dirname, 'patterns'));

// Auto-generate default if no playlists exist
if (playlistManager.list().length === 0) {
  playlistManager.generateDefault();
}

const engineCore = { mixer, wasmHost, paramRouter, paramCenter, playlistManager };
```

---

## 10. Pattern Renaming (Entry Labels)

This is **not** renaming the `.js` file. It's giving a playlist entry a display name:

```yaml
entries:
  - id: "e_1715120000001"
    pattern: 13_sparkle              # source code stays "13_sparkle.js"
    label: "Emergency Flash"          # display name in CaptainPad
```

Multiple entries can reference the same pattern with different labels and defaults:

```yaml
entries:
  - id: "e_001"
    pattern: 13_sparkle
    label: "Sparkle — Dreamy"
    defaults: { sparkleSpeed: 0.005, sparkleDensity: 0.2 }

  - id: "e_002"
    pattern: 13_sparkle
    label: "Sparkle — Aggressive"
    defaults: { sparkleSpeed: 0.04, sparkleDensity: 0.9 }

  - id: "e_003"
    pattern: 13_sparkle
    label: "Sparkle — Purple Haze"
    defaults: { sparkleSpeed: 0.01, bgHue1: 0.75, bgHue2: 0.80 }
```

Pattern is content. Label is identity. The `id` field is the stable handle.

---

## 11. Autopilot Integration

The autopilot cycles through **playlist entries by ID and index**, not by pattern filename.

```
  Autopilot cycle (per-channel):
    entry[cursor] → compile pattern + apply entry.defaults → wait delay_s
    cursor++ (or shuffle pick)
    entry[cursor] → compile pattern + apply entry.defaults → wait delay_s
    ...
    wrap to entry[0] at end
```

Each channel's autopilot tracks its own:
- `playlistName` — which playlist is loaded
- `cursor` — current index
- `activeEntryId` — for unambiguous identification
- `shuffleOrder` — pre-computed shuffle when shuffle mode is on

When the autopilot advances, it calls `loadPlaylistEntry()` (Section 9.3) — which bypasses pattern cache and applies entry-specific defaults.

---

## 12. CaptainPad Implementation

### 12.1 API Functions (`utils/api.ts`)

```ts
// Playlist Library
export async function fetchPlaylists(): Promise<ApiResult<string[]>>
export async function fetchPlaylist(name: string): Promise<ApiResult<PlaylistData>>
export async function savePlaylist(playlist: PlaylistData): Promise<ApiResult<any>>
export async function deletePlaylist(name: string): Promise<ApiResult<any>>

// Deck Assignment
export async function fetchDeckPlaylist(): Promise<ApiResult<DeckAssignment>>
export async function setDeckPlaylist(name: string): Promise<ApiResult<any>>
export async function setDeckPlaylistEntry(entryId: string): Promise<ApiResult<any>>
export async function captureDeckDefaults(): Promise<ApiResult<Record<string, any>>>
```

### 12.2 Deck Tab Changes (`index.tsx`)

1. **Playlist selector** (left pane, top) — dropdown listing available playlists
2. **Entry list** replaces "Pattern Queue" — shows entries from loaded playlist with labels
3. **+ ADD** button — opens modal listing all patterns from `GET /list-patterns`, appends new entry with generated ID
4. **− button** per entry — captures current defaults before removal, removes from in-memory list
5. **💾 SAVE** button — captures active entry, persists entire playlist to disk
6. **Entry tap** — captures previous entry defaults (dirty tracking), loads tapped entry via `POST /deck/playlist/entry`
7. **Label editing** — tap label to edit inline

### 12.3 Mixer Tab Changes (`mixer.tsx`)

Per mixer channel header: optional playlist dropdown (read-only). When a playlist is assigned, the channel's autopilot cycles through that playlist's entries. No add/remove/edit UI.

---

## 13. Implementation Phases

### Phase 1: Deck-Only Playlists (v1)

| Step | Scope | Files | Description |
|------|-------|-------|-------------|
| **1.1** | Engine | `playlist_manager.js` | New class: list, load, save, delete, generateDefault, captureDefaults, validateName |
| **1.2** | Engine | `state_manager.js` | Update `saveDeckState` and `loadDeckState` to persist the new `playlist` and `autopilot` structures for the deck channel. |
| **1.3** | Engine | `api_server.js` | Add REST routes: `/playlists`, `/playlists/:name`, `/deck/playlist`, `/deck/playlist/entry`, `/deck/playlist/capture` |
| **1.4** | Engine | `engine.js` | Wire PlaylistManager into boot sequence. Auto-generate default playlist |
| **1.5** | Engine | `api_server.js` | `loadPlaylistEntry()` helper — compile + skip patternCache + apply entry defaults + CPC finalize |
| **1.6** | Engine | `autopilot.js` | Switch from global autopilot to deck-only assignment entries. Track cursor + activeEntryId. Shuffle randomly picks next entry instead of tracking `shuffleOrder`. |
| **1.7** | CaptainPad | `utils/api.ts` | Add playlist API functions |
| **1.8** | CaptainPad | `index.tsx` | Rework Pattern Queue → entry list. Add playlist selector, +/−, save, dirty tracking |

### Phase 2: Mixer-Channel Playlists (Future)

| Step | Scope | Files | Description |
|------|-------|-------|-------------|
| **2.1** | Engine | `state_manager.js` | Update `saveMixerState` and `loadMixerState` to support per-channel `playlist` assignments |
| **2.2** | Engine | `api_server.js` | Add REST routes: `/mixer/channels/:id/playlist`, `/mixer/channels/:id/playlist/entry` |
| **2.3** | Engine | `autopilot.js` | Extend autopilot loop to independently schedule multiple mixer channels |
| **2.4** | CaptainPad | `mixer.tsx` | Add read-only playlist selector per channel |
