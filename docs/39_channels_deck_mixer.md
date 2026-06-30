# Design 39: Channels — Deck, Mixer, and Hot-Swap Playlists

**Status**: Reference (as-built, 2026-06-20)
**Scope**: BM26-Titanic `marsin_engine` + `CaptainPad` channels subsystem
**Goal**: Single source of truth for how the **deck** and the **mixer** work after
the channels-improvement campaign — hot-swap playlists, production/operational
signals, and the two-view (deck/mixer) CaptainPad surface.

This doc is the as-built reference. It extends three existing design docs and
does **not** duplicate them:

| See also | For |
|---|---|
| `docs/18_marsin_mixer.md` | Original mixer architecture, blend modes, parameter scopes |
| `docs/19_playlists.md` | Playlist file format, assignment state, autopilot, capture |
| `docs/27_mixer_layer_view_selection.md` | `viewFader` crossfade math, per-channel view masks |

Every endpoint and field below was verified against the code; implementation
sites are tabulated in §6.

---

## 1. Concepts

### 1.1 Deck vs Mixer

The engine maintains **two output buffers** and crossfades between them:

| | **Deck** | **Mixer** |
|---|---|---|
| What it is | Singleton PFL (pre-fade-listen) preview channel | Stack of live overlay channels |
| How many channels | Exactly one (`deckChannel`) | 0..N overlays (`maxChannels = 8`) |
| Renders into | `deckBuffer` (the focused pattern at 100%) | `mixerBuffer` (composited) |
| Composite | None — single pattern | Bottom→top: base seeds the buffer, overlays blend on top with each channel's fader + blend mode |
| Pattern switch | **Soft swap** — ping-pong double-buffer crossfade | **Instant** load (no double-buffer) |

The deck is a *preview/cue* surface and a single live channel; the mixer is the
*layered show*. The deck channel (`baseChannelId`) is intentionally excluded
from the mixer composite loop — see `docs/27` for the per-layer compositing.

### 1.2 Channel and Playlist

A **channel** owns one WASM pattern handle plus its operator-visible state
(id, name, fader, blend mode, view selection, local controls, lock flags). A
**playlist** is an ordered list of entries assigned to a channel (deck or
mixer overlay); each channel has its own independent assignment + cursor +
autopilot. See `docs/19_playlists.md` for the full data model.

### 1.3 View crossfade (`viewFader`)

Final output is a linear crossfade between the two buffers:

```
outputBuffer[i] = deckBuffer[i] * (1 - viewFader) + mixerBuffer[i] * viewFader
```

- `viewFader = 0.0` → output is the deck (PFL).
- `viewFader = 1.0` → output is the mixer composite (the startup default).
- The CaptainPad deck/mixer tabs select the view via `POST /mixer/view`
  `{ view: 'deck' | 'mixer' }`, which ramps `targetViewFader` to 0.0 / 1.0.
- After the crossfade, the master fader scales the output, then global
  effects + intensity run (unchanged from `docs/18`).

The crossfade math and its linearity guarantees are owned by
`docs/27_mixer_layer_view_selection.md` — do not re-derive it here.

### 1.4 View-override lease

`POST /mixer/view-override { override: 'deck' | null }` **pins** the output to
the deck side regardless of any `/mixer/view` writes that arrive while engaged
(e.g. a podium or controller forcing a cue). It is **leased**: a client holding
the pin re-POSTs periodically to renew a ~30s lease; clearing it
(`override: null`) snaps `targetViewFader` back to the value saved when the pin
was taken. This is distinct from `/mixer/view` (the normal tab toggle).

### 1.5 Auto-finalize on tab-away

Navigating to the mixer tab (`POST /mixer/view { view: 'mixer' }`) while a deck
soft-swap is mid-fade calls `finishDeckSwapNow()` — the swap snaps to its end
(atomic handle swap + `onComplete`) so returning to the deck shows the
destination pattern fully, not a half-blended buffer.

---

## 2. Hot-swap playlists (flagship)

"Hot-swap" loads a **different** playlist onto a channel and lands on its first
(or a specified) entry, additively and behind explicit `/swap` routes — the
existing entry-advance routes (`/deck/playlist/entry`,
`/mixer/channels/:id/playlist/entry`) are untouched.

The **deck swap is a soft swap** (rides the ping-pong double-buffer crossfade
via `loadPlaylistEntryWithTransition`). The **mixer swap is instant** (overlays
have no double-buffer machinery — it is a plain `loadPlaylistEntry`).

### 2.1 API surface

| Method | Path | Body | Notes |
|---|---|---|---|
| `POST` | `/deck/playlist/swap` | `{ name, entryId?, transition? }` | Soft crossfade onto another playlist. Parametric per-call transition override. |
| `POST` | `/deck/playlist/queue` | `{ name, entryId? }` | Warm-then-fire: compile + park in inactive slot WITHOUT advancing. |
| `POST` | `/mixer/channels/:id/playlist/swap` | `{ name, entryId? }` | **Instant** overlay load of another playlist. No `transition`. |
| `POST` | `/deck/playlist/entry` | `{ entryId }` | (Existing) advance within the loaded deck playlist (soft swap). |
| `POST` | `/mixer/channels/:id/playlist/entry` | `{ entryId }` | (Existing) instant overlay entry advance. |

`entryId` is optional on the swap routes: omitted ⇒ the first non-`_missing`
entry of the target playlist.

### 2.2 `POST /deck/playlist/swap` — request/response

Request body:

```json
{
  "name": "chill_night",
  "entryId": "e_1715120000003",
  "transition": { "enabled": true, "mode": "trans_crossfade", "durationMs": 1200 }
}
```

- `name` (required string) — playlist to swap to.
- `entryId` (optional) — entry to land on; defaults to first usable entry.
- `transition` (optional) — **per-call override** of the global
  `deckTransitionConfig` FOR THIS SWAP ONLY. Validated identically to
  `POST /deck/transition-config` (see §2.4). It does **not** mutate the global;
  omitting it gives existing callers the exact current behavior.

Success (`200`):

```json
{
  "status": "ok",
  "playlist": { "name": "chill_night", "activeEntryId": "...", "cursor": 0, "autopilot": {...} },
  "pattern": "08_ocean_liner",
  "transitionId": 42,
  "targetEntryId": "e_1715120000003"
}
```

> **`targetEntryId` is load-bearing (FIX B).** During a deck soft-swap,
> `playlist.activeEntryId` is still the **OLD** entry — the new id is only
> written in the swap's `onComplete` after the fade. The client must arm its
> pending-gate from the response's `targetEntryId`, NOT from
> `playlist.activeEntryId`, or the UI pins to the stale entry until the ~8s
> watchdog fires. The mixer entry/swap routes settle synchronously, so they
> return `pattern`/`playlist` already reflecting the new entry.

### 2.3 Error codes

| Status | Cause |
|---|---|
| `400` | `name` missing/empty; invalid `transition` field; explicit `entryId` is `_missing` (pattern not on disk); playlist has no usable entries; malformed playlist YAML (`PlaylistLoadError`, body carries `code`). |
| `404` | No deck channel; playlist file not found; explicit `entryId` not found in the target playlist. |
| `409` | `code: "EBUSY"` — a deck swap is already in flight. The route returns 409 rather than force-finishing the prior swap, because force-finishing would visibly snap the deck to an intermediate pattern the operator didn't choose to settle on. The caller (e.g. a timeline driver) decides whether to retry on the next anchor. |

The mixer swap route returns the same `400`/`404` for the same reasons but has
no in-flight concept (instant load), so no `409`/`EBUSY` on the swap path
itself.

### 2.4 Parametric transition validation

`validateSwapTransitionOverride(override, base)` (api_server.js) mirrors
`POST /deck/transition-config` field-for-field so the two paths cannot drift:

- `enabled` — optional boolean.
- `shuffle` — optional boolean.
- `mode` — optional string, must start with `trans_` (a scripted transition,
  not a steady channel blend).
- `durationMs` — optional, must be **finite** (non-finite ⇒ 400), then clamped
  to `[DECK_TRANSITION_MIN_MS, DECK_TRANSITION_MAX_MS]` = `[50, 30000]` ms.

A bad override 400s **before** the deck is touched — no silent fall-through to
the global config (Codex P0).

### 2.5 `POST /deck/playlist/queue` — warm-then-fire

Compiles a target entry's pattern and **parks** it in the inactive deck slot
WITHOUT advancing the deck. The next swap (manual ping-pong or autopilot) that
targets the same pattern reuses this warm handle for a **zero-compile** fade —
letting a timeline pre-stage the next look on a musical anchor and fire it
instantly when the beat lands.

- Uses the leak-safe `mixer.warmInactiveDeckHandle(patternName, handle)`
  contract: a redundant handle (slot already holds this pattern) or a refused
  handle (swap raced in) is **destroyed by the mixer**, never leaked. Handle
  ownership transfers to the mixer on the call.
- Returns `200 { status, warmed, entryId, reused }` (`reused: true` when the
  slot already held this pattern — no recompile).
- Returns `409 { code: "EBUSY" }` if a swap is in flight (the inactive slot is
  the live fade target then).
- Returns `400` on `name` missing, compile error, or `_missing` entry.

---

## 3. Production / operational signals

All of these are Codex-P0 "fail loud, never silent" surfaces. A green rig is
`renderHealth.ok === true` with empty `blendErrors` and `deckRestoreDegraded === null`.

### 3.1 `GET /status.renderHealth`

```json
"renderHealth": { "ok": true, "frame": 11, "blendErrors": [] }
```

- Blend handles are **precompiled at boot**, triggered by the
  `mixer.patternsDir` setter (boot wiring lives in `pattern_mixer.js`, not
  `engine.js`). This removes lazy compile from the 40 Hz hot path.
- If a blend script is missing or fails to compile, the mixer composites that
  mode via a **host-side linear-interpolation fallback** (so the rig never
  freezes), records the error in `renderHealth.blendErrors`, and logs it
  **loudly ONCE per mode** (not per frame). `ok` flips to `false` and
  `blendErrors[]` names the offending mode (`{ blend, message, sinceFrame, count }`).
- The error is cleared the moment that mode's handle compiles successfully
  (e.g. a boot precompile or a hot edit). This is the *visibility* contract:
  the fallback exists so the rig stays lit, but it must never be silent.

### 3.2 `GET /status.deckRestoreDegraded`

```json
"deckRestoreDegraded": { "failedPattern": "29_bar_dancers", "reason": "...", "fellBackTo": "test_const" }
```

`null` on a clean boot. Non-null iff the saved **deck** channel failed to
restore.

> **The deck NEVER dark-starts (FIX A, mission-critical).** The deck drives the
> Titanic exterior — the one surface that must be visible at night.
> `restoreDeckWithFallback(saved, defaultPattern, build)` tries to build from
> the saved pattern; on ANY failure (saved pattern null/empty/missing-on-disk,
> or compiles-but-fails) it **falls back to the default pattern** so the deck is
> never dark, preserving the saved channel's identity/lock/view prefs. The
> fallback is loud (`console.error`) and visible (`deckRestoreDegraded` on
> `/status`). It throws fatally **only** if the default pattern ALSO fails —
> that means the install itself is broken. (Mixer overlays degrade
> independently: a dead overlay warns and is skipped; the deck + other overlays
> stay live.)

A dangling `activeEntryId` (the entry was deleted from the playlist since the
state was saved) is detected at restore, WARNed loudly, and **cleared** so the
channel is in a clean "no active entry" state rather than carrying a ghost
pointer.

### 3.3 Fader validation

`validateFader(raw)` (api_server.js) guards every fader write path (master,
deck, mixer overlays, and WS fader messages):

- Accepts only an actual `number`, or a non-empty string that parses to a
  finite number. Rejects `null`/`undefined`/boolean/object outright — JSON
  coercion (`Number(null)===0`, `Number(true)===1`) would otherwise mask a
  structurally-wrong payload as a valid fader (silent fallback, Codex P0).
- Non-finite ⇒ rejected (and a WS write replies `channelFaderRejected`).
- A valid value is **clamped to `[0, 1]`**.

### 3.4 Atomic state writes

State persistence (`state_manager.js`) writes via temp-file + `fsync` + rename
so a crash mid-write can never leave a torn/partial state file on disk. Channel
serialization is de-duplicated through a shared `serializeChannel()` helper
(byte-compatible on disk; backward-compatible — no export removed). See
`docs/19_playlists.md` §3 for the on-disk schema.

---

## 4. The two views in CaptainPad (deck + mixer)

Both screens drive the engine over WebSocket and share one connection
lifecycle. Patterns below were verified in `useEngineConnection.ts`,
`PlaylistPanel.tsx`, `utils/api.ts`.

### 4.1 WS-driven (no polling)

`useEngineConnection` owns the boot + subscription lifecycle for both the deck
(`index.tsx`) and mixer (`mixer.tsx`) screens: resolve API base → probe
connection (drives the CONNECTED/OFFLINE pill) → nudge the singleton WS buses
to reconnect **only if down** (a forced reconnect on every tab focus tears a
live socket apart and flashes "Engine Offline") → seed view-specific REST
state → subscribe to control/status/viz buses → re-run on AppState `active`.
Each screen supplies its own REST seed + per-bus handlers; the hook is a refactor,
not a behavior change. Connection failures surface through `onStatus` — the hook
neither swallows errors nor substitutes default state (Codex P0).

### 4.2 Optimistic-update + reconcile + pending-gate

- **Fader/param moves** can update locally optimistically (low-latency over WS),
  with the WS broadcast reconciling the canonical state.
- **Hot-swap does NOT optimistically flip local state**: the deck transition
  takes ~Ns and the engine keeps reporting the prior entry until it completes.
  The panel arms a **pending-gate** from the response's `targetEntryId`
  (§2.2) and lets the WS broadcast (`deck` / `mixer` / `channelPlaylistData`)
  reconcile the final entry — so the row highlight settles on the swapped-in
  entry without bouncing. A watchdog (~8s) clears the gate if no broadcast
  arrives.
- A `swapEpochRef` ticks on each tap so a stale POST response can't be applied
  on top of a newer swap (last-write-wins guard).

### 4.3 Fail-loud error surfacing

Hot-swap and entry-tap surface real failures via `Alert` (Codex P0 — no silent
swallow). The single deliberate exception is `409/EBUSY` (a swap already in
flight): swallowed silently, because the operator double-tapping / tapping
mid-crossfade is expected, not an error. API clients honor `res.ok` (a non-2xx
is `{ ok: false, error }`, never a fake `{ ok: true }`).

### 4.4 Destructive actions, viz isolation, touch targets

- **ConfirmSheet** gates destructive actions (channel delete, playlist-entry
  removal) — no silent destructive taps. Its buttons carry `hitSlop`.
- **ChannelVizStrip** self-subscribes to viz frames so a viz update no longer
  reconciles the whole strip list (`React.memo` holds) — kills the re-render
  storm.
- Touch targets are **≥44 pt** (hitSlop) on icon buttons and rows.

### 4.5 Mixer SWAP copy is honest (FIX B)

The mixer-overlay SWAP confirm/help copy says **"Switch … instantly (no
crossfade)"**, not "Crossfade" — because a mixer swap is an instant load. Only
the deck swap copy says "Crossfade". The copy branches on `role` in
`PlaylistPanel.tsx`.

### 4.6 Do / Don't for contributors

**Do**
- Route all engine I/O for these screens through `useEngineConnection` +
  the `utils/api.ts` clients; honor `res.ok` and surface errors via `Alert`.
- Arm the pending-gate from `targetEntryId` on deck swaps.
- Add new touch targets at ≥44 pt; gate destructive actions with `ConfirmSheet`.
- Let WS broadcasts reconcile final state; keep optimistic UI to fader/param moves.

**Don't**
- Poll the engine on an interval — the buses are push.
- Force a WS reconnect on every focus (tears live sockets).
- Optimistically flip the active entry on a deck swap (it's still the old entry
  until `onComplete`).
- Swallow non-`EBUSY` failures, or fabricate `{ ok: true }` on a non-2xx.
- Read the deck channel out of the `/mixer` broadcast (it is excluded by
  invariant; `hil_channel_isolation_test.mjs` enforces this).

---

## 5. Timeline-readiness (follow-up, NOT done here)

The parametric `POST /deck/playlist/swap` (per-call `transition` override,
concurrency-safe with 409/EBUSY) and the warm-then-fire `POST /deck/playlist/queue`
endpoints were added **so that** `feat/timeline_support`'s arbiter can drive
smooth, anchored, cut-or-fade deck changes: queue the next look on an anchor,
fire it with an exact `durationMs`/`mode` on the beat, and get a clean `EBUSY`
to retry on the next anchor if a swap is still settling.

**The timeline integration itself is follow-up work on `feat/timeline_support`,
not this branch.** Specifically still open there:

- Wiring the timeline arbiter to call `/deck/playlist/swap` + `/deck/playlist/queue`
  instead of the instant `loadPlaylistEntry` hard-cut it uses today.
- Reconciling the timeline's **per-channel `autopilotPool`** against this
  branch's **single global deck autopilot** — they collide on merge and the
  resolution is a merge-time design decision for whoever integrates the timeline.

This doc documents the endpoints; it does not claim the timeline uses them.

---

## 6. Implementation map

Engine (`marsin_engine/lib/`):

| Site | What |
|---|---|
| `api_server.js` `validateFader` (~195) | Fader non-finite reject + `[0,1]` clamp |
| `api_server.js` `validateSwapTransitionOverride` (~238), `DECK_TRANSITION_MIN/MAX_MS` (~218) | Per-call transition override validation + duration bounds |
| `api_server.js` `restoreDeckWithFallback` / `buildDeckFallback` (~372) | Deck never dark-starts |
| `api_server.js` `loadPlaylistEntryWithTransition` (~1278) | Deck soft-swap helper (used by swap + entry) |
| `api_server.js` `/status` renderHealth + deckRestoreDegraded (~2274/2281) | Operational signals |
| `api_server.js` `/deck/playlist/swap` (~4104), `/deck/playlist/queue` (~4199) | Deck hot-swap + warm |
| `api_server.js` `/deck/transition-config` (~4322) | Global deck transition config |
| `api_server.js` `/mixer/channels/:id/playlist/swap` (~4447), `/entry` (~4415) | Mixer instant swap/advance |
| `api_server.js` `/mixer/view` (~3240), `/mixer/view-override` (~3260) | View crossfade + leased pin |
| `pattern_mixer.js` `getRenderHealth` (~371), `precompileAllBlends`/`precompileBlend` (~389), `_recordBlendError` (~424) | Boot blend precompile + render health |
| `pattern_mixer.js` swap state machine: `warmInactiveDeckHandle` (~960), `getInactiveDeckPattern` (~1009), `isDeckSwapInFlight` (~1217), `finishDeckSwapNow` (~1234), `cancelDeckPatternSwap` (~1200), `updateDeckSwapTransition` (~1247) | Ping-pong double-buffer deck swap |

CaptainPad:

| Site | What |
|---|---|
| `hooks/useEngineConnection.ts` | Shared WS boot/subscribe lifecycle |
| `utils/api.ts` `swapDeckPlaylist` (~1421), `swapMixerChannelPlaylist` (~1451), `swapChannelPlaylist` (~1482) | Typed swap clients (EBUSY on 409, cache-invalidating) |
| `components/PlaylistPanel.tsx` `handleHotSwap` (~708), swap picker + ConfirmSheet (~1468) | SWAP UI, pending-gate, honest mixer copy |

Tests / HIL (`marsin_engine/tests/`):

| File | Asserts |
|---|---|
| `blend_precompile.test.js` | Boot precompile; missing blend flips `renderHealth.ok=false` and names the mode |
| `hil/hil_playlist_hotswap_test.mjs` | Deck/mixer hot-swap end-to-end (17 assertions) |
| `hil/hil_deck_swap_param_test.mjs` | Parametric swap (per-call transition override, 409 in-flight) |
| `hil/hil_deck_swap_response_test.mjs` | Mid-fade `targetEntryId` ≠ stale `playlist.activeEntryId` |
| `hil/hil_concurrent_entry_test.mjs` | Concurrent playlist-entry behavior |
| `hil/hil_channel_isolation_test.mjs` | Deck channel excluded from `/mixer` broadcast |

---

## 8. Channel-features wave (2026-06-20, engine-side)

Four additive, backward-compatible features. Every new field defaults so an
old state file (without the field) still loads and restores to the documented
default — **a schema default is not a silent fallback**; non-finite /
structurally-wrong inputs are rejected loudly (Codex P0).

### 8.1 F-A — Named mixer snapshots / look recall (flagship)

A **snapshot** ("look") is the FULL mixer state captured under a name: the
grand-master value, the deck channel, and every overlay's serialized core
(id / name / pattern / fader / **faderMax** / **color** / mode / enabled /
locked / faderLocked / viewSelection / playlist+activeEntry). Persisted as
YAML in `states/<model>/snapshots/<name>.yaml` via the SAME atomic
temp+fsync+rename writer as the playlist / state managers
(`StateManager.writeFileAtomic`, new public wrapper). Implemented in
`lib/snapshot_manager.js` (`SnapshotManager`, `SnapshotLoadError`).

| Method | Path | Body | Returns |
|---|---|---|---|
| `GET` | `/mixer/snapshots` | — | `{ snapshots: string[] }` (sorted names) |
| `POST` | `/mixer/snapshots` | `{ name }` | `{ status:'ok', name }` — captures current look |
| `GET` | `/mixer/snapshots/:name` | — | the full look object, or `404` |
| `DELETE` | `/mixer/snapshots/:name` | — | `{ status:'ok' }`, or `404` |
| `POST` | `/mixer/snapshots/:name/recall` | — | `{ status:'ok', name }` — restores the look |

- **Name rules**: `^[a-z0-9][a-z0-9_-]{0,63}$` (snake_case slug). A bad name,
  a `null`/empty `name` on capture ⇒ `400`. Path traversal is rejected.
- **Capture** reuses `serializeChannel` (`state_manager.js`) so a captured
  look round-trips through recall identically to an engine restart.
- **Recall** reuses the existing build/setter machinery
  (`buildChannelFromSaved` → `setDeckChannel` / `addMixerChannel` /
  `removeMixerChannel`, then `setMaster`) and **RESPECTS `maxChannels`**: it
  removes every current overlay, rebuilds the deck (mission-critical
  never-dark fallback applies), then re-adds the snapshot's overlays. A
  snapshot with MORE overlays than `maxChannels` ⇒ `400 code:SNAPSHOT_OVER_CAP`
  (fail loud — never a silent truncation). Recall persists via `saveAllState()`.
- **Fail loud**: unknown name on recall/GET ⇒ `404`; malformed snapshot YAML
  or invalid shape ⇒ `400 code:SNAPSHOT_MALFORMED` (mirrors `PlaylistLoadError`).
- **WS**: broadcasts `{ type:'snapshots', action:'saved'|'deleted'|'recalled',
  name, snapshots }` on `/ws/control` on every mutation.

### 8.2 F-B — Grand-master fade-time / timed blackout (flagship)

`POST /mixer/master/fade { target, durationMs }` animates `master` from its
current value toward `target` over `durationMs` on the 40 Hz render tick —
the SAME dt-clamped, frame-rate-independent ramp as the `viewFader` crossfade
(`PatternMixer.renderAll6ch` → `_tickMasterFade`). A **timed blackout** is
`target:0`; a **restore** is a fade back to a non-zero value.

- Validation (Codex P0, before the mixer is touched): `target` must be a
  finite number in `[0,1]` (reuses `validateFader`; non-finite ⇒ `400`),
  `durationMs` must be a finite number `> 0` (else `400`).
- A direct `PATCH /mixer { master }` (or any `setMaster`) **cancels** any
  in-flight fade — the operator's hand always wins.
- The fade lands EXACTLY on the target and clears its descriptor when done.
- **Exposed**: `master` + `masterFade` on `GET /status`, `GET /mixer`, and the
  `deck`/`mixer` WS broadcasts. `masterFade` is `null` when steady, else
  `{ active:true, from, to, durationMs, elapsedMs, remainingMs }`.
- Default behavior unchanged: an instant `PATCH /mixer { master }` set is
  unaffected — the fade is opt-in via the new route.

### 8.3 F-C — Per-channel intensity clamp (`faderMax`)

`faderMax` (number, default `1.0`) is a hard ceiling on a channel's OWN
contribution to the composite. Applied at blend time as
`effectiveFader = min(channel.fader, faderMax)` in `PatternMixer.renderAll6ch`
— so a fader, a scripted transition, or a manual write can ride up to
`faderMax` but **never above it**. The clamp is the **last word** on a
channel's own output. `faderMax = 0` fully suppresses the channel.

- Set via `PATCH /mixer/channels/:id` and `PATCH /deck/channel` with
  `{ faderMax }`. Validated identically to a fader (finite, clamped to
  `[0,1]`; non-finite ⇒ `400`).
- Added to `PatternChannel`, BOTH serializers (broadcast + state), and the
  restore path. Persists across restart; absent in an old file ⇒ `1.0`.

### 8.4 F-D — Channel color

`color` (string or `null`, default `null`) is pure operator-facing METADATA
(e.g. a hex accent for the CaptainPad strip) with **no render effect**.

- Set via `PATCH /mixer/channels/:id` and `PATCH /deck/channel` with
  `{ color }`. Must be a string or `null`; any other type ⇒ `400`.
- Added to `PatternChannel`, BOTH serializers, and the restore path. Persists
  across restart; absent in an old file ⇒ `null`.

### 8.5 Implementation map (this wave)

| Site | What |
|---|---|
| `lib/snapshot_manager.js` | `SnapshotManager` (save/list/load/delete, atomic write, name safety), `SnapshotLoadError` |
| `lib/state_manager.js` | `serializeChannel` appends `faderMax`/`color`; `saveMixerState` persists them; new public `writeFileAtomic` |
| `lib/pattern_channel.js` | `faderMax`/`color` constructor fields (clamped/typed) |
| `lib/pattern_mixer.js` | `_masterFade` state, `startMasterFade`/`getMasterFade`/`_tickMasterFade`, `setMaster` cancels fade; `effFader = min(fader, faderMax)` clamp in the overlay composite |
| `lib/api_server.js` | snapshot routes + `captureLook`/`recallLook`; `POST /mixer/master/fade`; `faderMax`/`color` in PATCH handlers, both serializers, `/status`, restore config |
| `lib/ws_topic_routing.js` | `snapshots` → `/ws/control` |
| `tests/snapshot_manager.test.js`, `tests/master_fade.test.js`, `tests/fader_max_clamp.test.js`, `tests/channel_feature_fields.test.js` | Unit coverage |
| `tests/hil/hil_channel_features_test.mjs` | HIL: capture/recall, master fade ramp, faderMax/color, error paths (25 assertions) |

---

## 9. Playlist tags wave (2026-06-20)

Additive playlist feature, schema'd in `lib/playlist_manager.js` and surfaced
through CaptainPad's `PlaylistPanel`. Full schema + coercion rules live in
`docs/19_playlists.md` §2.5; this section is the channels-side summary.

- **#11 Tags + search/filter.** Playlist-level `tags: string[]` (lenient
  coerce: trim + lowercase + drop empties on load; same + `Set` dedupe on
  save; non-array → `[]`). `GET /playlists/:name` returns them inline; the
  `POST /playlists` handler now passes `save({ name, tags, entries })`. The
  CaptainPad library picker (`LibraryModal`) and hot-swap picker
  (`SwapPlaylistModal`) gained a search box + tag chips that filter
  client-side; tags are fetched lazily per name (reusing the api.ts per-name
  cache) so names render immediately and the filter is additive. A tag-edit
  row on the loaded playlist commits comma-separated tags via `savePlaylist`.

> Per-entry `hold` / `loop` flags (#12) were part of this wave but were
> removed (2026-06). The autopilot advance no longer has hold/loop gates; old
> playlists carrying those keys load fine (keys ignored + stripped on save).

### 9.1 Implementation map (this wave)

| Site | What |
|---|---|
| `lib/playlist_manager.js` | `tags` coerce in `load()`/`save()` |
| `lib/api_server.js` | `save({ name, tags, entries })` on `POST /playlists` |
| `CaptainPad/utils/api.ts` | `tags?` on `PlaylistData`; `savePlaylist` arg includes `tags?` |
| `CaptainPad/components/PlaylistPanel.tsx` | search + tag chips in both pickers; tag-edit row |
| `tests/playlist_tags.test.js` | Unit: tags round-trip, OLD-playlist coercion (byte-compat + legacy hold/loop strip), junk coercion |

---

## 10. Channel groups (gang-faders) + server-authoritative solo (WAVE 15, 2026-06-20, engine-side)

Two additive, composable mixer features. The UI (CaptainPad group rail +
solo-safe toggle) is a **separate later wave** — this wave is engine-only.

### 10.1 Concepts

- **Channel group (gang-fader).** A named group (`mixGroups[]`, ids `mg_*`)
  with a `fader` (0..1) and a `muted` flag that **scales** every member
  channel's contribution at composite time. Membership is a **single-membership
  channel→group pointer** (`channel.mixGroupId`, default `null`) — members are
  *derived* (`mixerChannels.filter(c => c.mixGroupId === g.id)`), never stored
  on the group, so removing a channel can never dangle a member reference. A
  group has optional `name`/`color` metadata.
- **Solo (server-authoritative).** `PatternMixer.soloedChannelIds` (a `Set`) is
  the **sole** source of truth. When non-empty, only soloed / solo-safe /
  fader-locked channels contribute. The render gate reads the Set; sibling
  `enabled`/`fader` are **never** mutated by solo (parked levels survive). The
  Set is **TRANSIENT** — never persisted; cleared on engine restart and at the
  start of a scripted mixer transition.
- **Solo-safe (`soloSafe`, default `false`).** Rig-config flag: this channel is
  never gated off by *another* channel's solo. It protects the mission-critical
  exterior. Persisted like `faderLocked`.

### 10.2 Precedence (`PatternMixer._effFader`, per channel, per frame)

```
groupScale = group ? (group.muted ? 0 : group.fader) : 1
soloActive = soloedChannelIds.size > 0
soloGate   = !soloActive ? 1 : (soloSafe || faderLocked || soloed) ? 1 : 0
enabledGate= enabled ? 1 : 0
effFader   = clamp(fader, 0, (faderMax ?? 1)) * groupScale * soloGate * enabledGate
```

Then the existing blend → view crossfade → **master(t) LAST** (F-B) chain runs
unchanged. The composite skip is one check: `if (!isScriptedTarget && eff <= 0.001) continue;`.
Rules: explicit mute (`enabled=false`) **wins** over solo; `soloSafe` survives a
solo but **not** a group-mute; **group-mute beats a member's solo**; fader-lock
**implies** solo-safe AND a group fader still scales a locked channel (gang
scale ≠ a fader write); `faderMax` clamp is applied to the channel's own level
**before** the group scale; master-fade-to-0 darkens even soloed/safe channels
(grand kill — a different, later stage). Solo affects the mixer composite only;
deck / PFL are untouched. Hot path is allocation-free: group scales are
precomputed once per frame into a reused `_groupScaleCache` Map (`clear()`+`set()`),
`soloActive` is an O(1) size check, and `_effFader` is pure arithmetic.

### 10.3 API surface (NEW — for the follow-on UI wave)

All mutations are validate→mutate→`saveAllState()`→`broadcastMixerState()`.
Bad input fails loud (`400` malformed / `404` missing) — no silent fallback.

Groups:

| Method + path | Body | Result |
|---|---|---|
| `GET /mixer/groups` | — | `{ mixGroups: [...] }` |
| `POST /mixer/groups` | `{ name?, color? }` | `201 { status, group }` (group id is `mg_*`, `fader:1`, `muted:false`) |
| `PATCH /mixer/groups/:gid` | `{ name?, fader?, muted?, color? }` | `200 { status, group }`; `fader` via `validateFader` (NaN→400); unknown gid→404 |
| `DELETE /mixer/groups/:gid` | — | `200`; **clears every member's `mixGroupId` first**; unknown gid→404 |
| `POST /mixer/groups/:gid/members` | `{ channelId }` | `200`; `400` if missing `channelId`, the channel is the deck (`WRONG_ROLE`), or it's already in a *different* group (single membership); `404` on unknown gid/channel; re-add to the *same* group is an idempotent `200` |
| `DELETE /mixer/groups/:gid/members/:channelId` | — | `200` (idempotent clear); `404` on unknown gid/channel |

Solo:

| Method + path | Body | Result |
|---|---|---|
| `POST /mixer/solo` | `{ channelId, additive?:false }` | `200 { status, soloedChannelIds }`; `additive` adds, else replaces the set; `404` unknown / `400` deck id |
| `DELETE /mixer/solo/:channelId` | — | un-solo one; `200 { soloedChannelIds }`; `404` unknown |
| `DELETE /mixer/solo` | — | clear ALL; `200 { soloedChannelIds: [] }` |

`PATCH /mixer/channels/:id` gains a `soloSafe` boolean toggle.

WS (low-latency mirrors on `/ws/control`, same dual-path as mute):
`{ type:'setSolo', channelId, additive? }`, `{ type:'clearSolo', channelId? }`
(channelId absent = clear all). A bad id pushes back `{ type:'soloRejected', channelId, reason }`.

Broadcast / serializers: both `serializeChannel` and the inline `serializeMixerState`
channel map gain `mixGroupId` + `soloSafe`. `serializeMixerState` additionally
carries top-level `mixGroups: [...]` and `soloedChannelIds: [...]` (an array
snapshot of the Set — the client reconciles its **display-only** dim/active
state from this on every broadcast; it survives reconnect because it lives
server-side).

### 10.4 Persistence

`mixGroupId` + `soloSafe` are appended to `serializeChannel` (after
`faderMax`/`color`) → persisted in both `deck_state.yaml` and
`mixer_state.yaml`. The group registry persists as a new top-level
`mixGroups: []` in `mixer_state.yaml` (group ids/faders/mutes survive restart so
member pointers resolve). `soloedChannelIds` is deliberately **NOT** persisted —
solo is transient and the set is empty after a restart. Snapshots (look
capture/recall) carry groups + membership + `soloSafe` too. All additive: an old
state file without the new keys loads and restores to the documented defaults
(`mixGroupId: null`, `soloSafe: false`, `mixGroups: []`).

### 10.5 Implementation map (this wave)

| Site | What |
|---|---|
| `lib/pattern_channel.js` | `mixGroupId` (null) + `soloSafe` (false) ctor fields, typed/coerced defensively |
| `lib/pattern_mixer.js` | `mixGroups[]` + `soloedChannelIds` Set + `_groupScaleCache`; group CRUD (`createMixGroup`/`updateMixGroup`/`deleteMixGroup`/`addChannelToGroup`/`removeChannelFromGroup`); solo (`setSolo`/`clearSolo`); `_effFader` precedence; per-frame precompute + composite-gate rewrite; `removeMixerChannel` drops solo + membership (no phantom-solo); `triggerMixerTransition` clears solo; teardown clears registry |
| `lib/api_server.js` | group + solo routes (armed before the `/mixer/channels/:id` regexes, members routes before bare `/:gid`); `soloSafe` in PATCH; both serializers gain `mixGroupId`/`soloSafe`; `serializeMixerState` gains `mixGroups[]`/`soloedChannelIds[]`; `buildChannelFromSaved` plumbs the fields; `restoreMixGroups` at boot + recall; `captureLook` carries groups; WS `setSolo`/`clearSolo` |
| `lib/state_manager.js` | `serializeChannel` appends `mixGroupId`/`soloSafe`; new `serializeMixGroup`; `saveMixerState` persists `mixGroups[]`; `loadMixerState` defaults `mixGroups: []` |
| `tests/groups_solo_precedence.test.js` | Unit: every precedence row (18 tests) incl. soloSafe-survives, group-mute-beats-solo, faderMax-before-gang, lock-implies-safe, additive solo, allocation-free cache |
| `tests/groups_solo_state.test.js` | Unit: ctor defaults, serialize round-trip, group CRUD + single-membership 400, removeMixerChannel solo/membership cleanup, transition clears solo (16 tests) |
| `tests/hil/hil_groups_solo_test.mjs` | HIL: group CRUD, single-membership/deck 400, **mission-critical soloSafe-stays-lit**, group-mute-beats-solo dark, reconnect keeps solo, transition clears solo, validation 400/404 (18 assertions) |

### 10.6 Deferred to the UI wave (not in scope here)

CaptainPad `mixer.tsx` group rail + `soloSafe` toggle; replacing the
client-side `handleSoloToggle` / destructive `preSoloStateRef` save-restore with
optimistic WS `setSolo` + REST mirror + reconcile-from-broadcast; `api.ts`
group/solo clients. The engine is the authority; the client render dim/active is
display-only.

### 10.7 FLASH / BUMP — momentary "full while held" (round-2 #5, 2026-06-21)

The defining live-busking accent: HOLD a channel's **BUMP** button → that
channel slams to FULL output; RELEASE → it snaps back to its parked level.
Directly analogous to solo — a transient server-authoritative `Set` read on the
hot path.

**Source of truth.** `PatternMixer._bumpedChannelIds` (a `Set`) is the SOLE
truth. `bumpChannel(id)` / `unbumpChannel(id?)` (no arg = release all) /
`clearBumps()` mutate it; a bad / non-mixer id is a fail-loud `404`. Bump
**never** mutates a channel's `enabled`/`fader` — the parked level survives
untouched; release just drops the id. **TRANSIENT** — never persisted; empty
after restart; cleared on teardown, on a scripted mixer transition
(`triggerMixerTransition`), on `removeMixerChannel` (no phantom bump), and on
`panicToSafeDefault`.

**Precedence (extends §10.2).** The bump override is the FIRST thing
`_effFader` checks after the hard-mute gate:

```
if (!enabled) return 0;                       // hard mute STILL wins
if (bumped)   return min(1.0, faderMax ?? 1); // bump: full, capped by faderMax
... normal clamp(fader, faderMax) * groupScale * soloGate ...
```

So bump **overrides** the channel's own fader, its group scale, AND the
solo-dimming gate (the accent always reads) — **but** a hard mute
(`enabled=false`) still wins (bump is an "up" gesture, mute is the operator's
explicit "off"), and the per-fixture **`faderMax` safety ceiling STILL holds**:
a bumped channel goes to `min(1.0, faderMax)` so a CAP-protected fixture is
never over-driven, even on a bump. Hot path stays allocation-free: a gated
`_bumpedChannelIds.size > 0` check short-circuits the override before any group/
solo arithmetic; the common (no-bumps) case pays one `size` read.

**Release-on-disconnect (mission safety).** A held bump from a dropped iPad
must NOT pin a channel full forever. TWO independent nets in `api_server.js`:

1. **Lease (`BUMP_LEASE_MS = 2000`).** Every `bump` (REST or WS) stamps a
   per-channel expiry. The client RENEWS by re-sending the WS `bump` every
   ~700 ms while the button is held. A periodic sweep
   (`BUMP_SWEEP_MS = 500`, armed only while bumps are held, `unref()`'d)
   auto-releases any lapsed bump. This is the backstop for hard link loss
   (and the ONLY net for REST-only bumps, which have no socket to close).
2. **WS-close.** Each `/ws/control` socket tracks the channels it bumped
   (`ws._bumpedByThisWs`); on close it releases exactly those — instant
   cleanup for the clean "tab closed / reconnect" case.

**API surface.**

| Method + path | Body | Result |
|---|---|---|
| `POST /mixer/channels/:id/bump` | `{ on: true\|false }` | `200 { status, bumpedChannelIds }`; `404` unknown / `400` deck (`WRONG_ROLE`) / `400` missing-or-non-boolean `on`. Armed BEFORE the `^/mixer/channels/[^/]+$` regexes (next to `/duplicate`) so `/bump` isn't swallowed as a channel id. Each `on:true` renews the lease. |

WS (low-latency mirrors on `/ws/control`, same dual-path as solo):
`{ type:'bump', channelId }`, `{ type:'unbump', channelId? }` (channelId absent
= release all). A bad id pushes back `{ type:'bumpRejected', channelId, reason }`
(point-to-point `ws.send`; the type is registered in `ws_topic_routing.js` →
`/ws/control` for documentation + safety). A WS `bump` re-send is a no-op renew
(no broadcast); only a CHANGE broadcasts.

**Broadcast / serializer.** `serializeMixerState` gains top-level
`bumpedChannelIds: [...]` (array snapshot of the Set, alongside
`soloedChannelIds`) — the client reconciles its **display-only** "held" state
from it on every `mixer` broadcast. Bump state rides the existing `mixer`
broadcast (no separate broadcast type), exactly like solo. **NOT persisted**
(transient).

**CaptainPad.** `mixer.tsx` ChannelStrip gains a **BUMP** `Pressable`
(`onPressIn` → bump on, `onPressOut` → bump off; amber held state; ✓ glyph +
`accessibilityState` so it's not color-only; 44 pt+ via 32 pt button + 8 pt
hitSlop). The handler sends the WS `bump`/`unbump` (low-latency) + a REST
mirror (`utils/bumpApi.ts` `postBump`, fail-loud), runs a `BUMP_RENEW_MS = 700`
hold-renew heartbeat, optimistically flips local held state, and reconciles
from the broadcast's `bumpedChannelIds[]`. An unmount cleanup clears every
renew timer AND eagerly releases held bumps.

**Implementation map (round-2 #5).**

| Site | What |
|---|---|
| `lib/pattern_mixer.js` | `_bumpedChannelIds` Set; `bumpChannel`/`unbumpChannel`/`clearBumps`; bump override in `_effFader` (gated, allocation-free, `min(1.0, faderMax)`, mute-wins); clear-bumps in `removeMixerChannel` + `triggerMixerTransition` + teardown + `panicToSafeDefault` |
| `lib/api_server.js` | `POST /mixer/channels/:id/bump` (armed pre-regex); WS `bump`/`unbump` handlers + `bumpRejected`; `bumpedChannelIds[]` in `serializeMixerState`; `BUMP_LEASE_MS` lease + sweep + `ws._bumpedByThisWs` close-release |
| `lib/ws_topic_routing.js` | `bumpRejected` → CONTROL |
| `CaptainPad/utils/bumpApi.ts` | NEW — `postBump` REST mirror (WS-first dual-path), fail-loud |
| `CaptainPad/app/(tabs)/mixer.tsx` | BUMP Pressable + `handleBumpOn`/`handleBumpOff` (WS + REST + renew heartbeat) + `bumpedIds` reconcile/seed + unmount cleanup |
| `tests/bump_flash.test.js` | Unit (16): override-to-full, faderMax cap, mute-wins, group/solo override, transient lifecycle (transition/remove/teardown/panic), 404, allocation-free/gated |
| `tests/hil/hil_flash_bump_test.mjs` | HIL (19): REST+WS bump/release with RENDER proof (bumped full vs sibling parked), faderMax ceiling, AUTO-RELEASE on ws-close AND lease-expiry, 404/400 validation |

---

### 10.8 SNAPSHOT CROSSFADE / MORPH — ramp a recall over N seconds (round-2 #1, 2026-06-21)

Recall a saved look by **ramping** the live mix current→target over a chosen
duration instead of the instant cut `/recall` does. Additive — `/recall` is
untouched; this is its animated sibling, built ENTIRELY on the engine's
existing animation machinery (per-channel `transitions[]`, the grand-master
`_masterFade`, and a new parallel group-fade array) so there is no second
interpolation system.

**API.** `POST /mixer/snapshots/:name/recall-fade { durationMs }`
(finite > 0). `404` unknown name · `400 SNAPSHOT_MALFORMED` (corrupt snapshot)
· `400` `durationMs <= 0` / non-finite / missing (validated BEFORE any load or
mutation) · `400 SNAPSHOT_OVER_CAP` (the **UNION** `current ∪ target` overlay
count exceeds `maxChannels`). The route is armed with the regex
`^/mixer/snapshots/[^/]+/recall-fade$`, which the `…/recall$` regex cannot
shadow (it ends at `recall`, not `recall-fade`). **No `saveAllState` at
kickoff** (transient animation, exactly like `/mixer/master/fade`); the look
is persisted by the morph finalizer on completion. Broadcasts
`{type:'snapshots', action:'recall-fade', name}` at kickoff and
`{type:'snapshots', action:'recall-fade-complete'}` when the ramps land (both
on the existing `snapshots` CONTROL topic — no routing change).

**Transient UNION cap (fail-loud, the key risk).** While a morph is in flight
the current-only (C) channels still exist (fading out) WHILE the target-only
(T) channels are added, so the peak channel count is `|current ∪ target|`, not
the target count. We validate that union vs `maxChannels` BEFORE mutating and
reject over-cap with `SNAPSHOT_OVER_CAP` — never a silent truncation (Codex
P0). Because peak = union ≤ cap, the mixer's per-add cap is never tripped mid-
build.

**Channel semantics (match by channel ID).**

| Class | Condition | Behavior |
|---|---|---|
| **M** | id in BOTH | SNAP structural/chroma (rebuild content so a changed `pattern`/`mode`/`viewSelection`/`faderMax`/`color`/`hue`/`mixGroupId` takes effect at kickoff), anchor the rebuilt fader at the PRE-morph level, then `fadeChannel` current→target (smoothstep). A changed-pattern M is the structural-snap + level-ramp case. |
| **T** | target-only | `restoreChannel('mixer')` then force `fader=0`+`enabled`, then `fadeChannel` 0→target. |
| **C** | current-only | `fadeChannel(id, 0, { destroyOnComplete })` → `updateTransitions` removes the channel object; the finalizer `paramCenter.unregisterChannel(id)` (because `removeChannel` does NOT — `/recall` unregisters explicitly at teardown). Fader-locked C channels are left in place (not in target) — documented, not ripped out mid-morph. |

**Master / groups / deck.** Master ramps via `startMasterFade(look.master,
durationMs)`. Groups ramp the **fader** of groups present in BOTH (capture
prior faders, `restoreMixGroups`, rewind to prior + `startGroupFade` to target
via the new `_groupFades` array — parallel to `_masterFade`, linear wall-clock,
lands exactly, self-clears); target-only groups SNAP (nothing to ramp from).
The deck SNAPS content (mission-critical never-dark via `restoreChannel`'s
fallback) and RAMPS its fader.

**v1 deferrals (documented).** RAMP **levels only** (per-channel fader, group
fader, master). `hue`/`color`/`faderMax` are **SNAPPED** at kickoff:
`color` is metadata (no render), `faderMax` is a non-linear ceiling (ramping it
would warp the level ramp), `hue` is angular and needs short-arc interpolation
(v2). The deck/T never-dark rule means deck/T **content** snaps, only the level
animates.

**Descriptor + completion (allocation-free hot path).** `PatternMixer._morph =
{ startMs, durationMs, fadeOutIds }`. The descriptor owns NO interpolation — it
rides the existing `transitions[]` / `_masterFade` / `_groupFades` ticks
already in `beginFrame`. `_tickMorph()` (added to `beginFrame`, AFTER the
ramps) is a single O(1) wall-clock comparison: when `now - startMs >=
durationMs` it clears `_morph` and fires `onMorphComplete({ fadeOutIds })`
EXACTLY once. The finalizer CPC-unregisters the faded-out ids, `saveAllState()`,
and broadcasts the settled mix + `recall-fade-complete`. Because every ramp
shares the identical `durationMs`, the settled mix EQUALS an instant `/recall`
of the same snapshot exactly (proven in HIL).

**Kickoff cancels/replaces** a prior morph (`cancelMorph` — no finalizer, no
double-free), the grand-master fade (auto via `startMasterFade`), per-channel
transitions (auto via `fadeChannel`'s `cancelChannelTransition`), all group
fades (`cancelAllGroupFades`), the deck swap (`cancelDeckPatternSwap`), and
clears solo + bump (transient — a stuck solo would gate the morph's losers to
black mid-ramp). A direct `updateMixGroup` fader write cancels that group's
in-flight fade (operator's hand wins, mirroring `setMaster`).

**CaptainPad.** `SnapshotBar.tsx` per recall-list row gains a **MORPH** button
that expands inline duration pills **1 / 3 / 5 / 10 s** (default 3) →
`recallSnapshotFade(name, durationMs)`. No optimistic flip (the WS `mixer`
broadcast reconciles the strips as the ramp progresses); `Alert` on any 4xx
(mirrors the instant `handleRecall`). The plain name tap stays the instant cut.

**Implementation map (round-2 #1).**

| Site | What |
|---|---|
| `lib/pattern_mixer.js` | `_groupFades` array + `startGroupFade`/`cancelGroupFade`/`cancelAllGroupFades`/`_tickGroupFades`; `_morph` descriptor + `beginMorph`/`getMorph`/`cancelMorph`/`_tickMorph` + `onMorphComplete`; both ticks wired into `beginFrame`; `updateMixGroup` fader write cancels in-flight group fade; `deleteMixGroup` drops fade |
| `lib/api_server.js` | `morphToLook(look, durationMs)` (union-cap, M/T/C build, master/group/deck ramps, arms `_morph`); `POST /mixer/snapshots/:name/recall-fade` route (validate→morph→broadcast, no kickoff save); `onMorphComplete` finalizer (CPC-unregister faded-out ids + save + broadcast complete) |
| `CaptainPad/utils/channelExtrasApi.ts` | `recallSnapshotFade(name, durationMs)` (mirrors `recallSnapshot` + master-fade body shape, fail-loud) |
| `CaptainPad/components/SnapshotBar.tsx` | per-row MORPH button + inline 1/3/5/10 s duration pills → `recallSnapshotFade`; no optimistic flip; Alert on 4xx |

> **Master FADE pills (`MasterFadeGroup`, deck + mixer) — 2026-06-30:** the
> TO BLACK / UP duration picker now offers **0s** (instant) alongside
> 1/3/5/10 s. 0s can't use the timed-fade route (`startMasterFade` requires
> `durationMs > 0`), so `runFade()` routes 0s to the instant
> `PATCH /mixer {master}` (`updateMixerMaster`, which also cancels any in-flight
> fade); >0 runs the timed fade as before.
| `tests/snapshot_morph.test.js` | Unit (11): group-fade lerp/exact-land/cancel-on-write/delete-drop/validation; fadeChannel M midpoint≈smoothstep + T 0→target + C→0+removed; changed-pattern structural-snap + level-ramp; morph descriptor fires finalizer once with fadeOutIds; beginMorph duration validation; cancelMorph (replace mid-flight, no double-fire) |
| `tests/hil/hil_snapshot_morph_test.mjs` | HIL (18): recall-fade ramps master+fader MONOTONICALLY toward target, converges to target, and the settled mix EQUALS an instant recall of the same snapshot EXACTLY (lands exactly on target look); 404/400 (durationMs 0/neg/non-finite/missing) error paths |

### 10.9 NAMED PER-CHANNEL PARAM PRESETS — capture/recall one channel's params (round-2 #9, 2026-06-21)

A **param preset** captures the LIVE local-control parameter values of a SINGLE
channel (its `localControls` map — the pattern's slider/knob/color values, keyed
by export control id → `{v0,v1,v2}`) under a name, so the operator can recall the
exact look of one channel's pattern later. This is NARROWER than a §8.1 mixer
snapshot (which captures the whole mixer + deck + groups + faders): a param
preset is ONE channel's pattern params, nothing else. ENGINE-ONLY this wave (no
CaptainPad surface yet).

Presets persist as YAML in `states/<model>/param_presets/<name>.yaml` via the
SAME atomic temp+fsync+rename writer the snapshot/state/playlist managers use
(`StateManager.writeFileAtomic`). Manager: `lib/param_preset_manager.js`
(`ParamPresetManager`, `ParamPresetError`), modelled on `SnapshotManager`.

**API.**

| Method | Route | Body | Result |
|---|---|---|---|
| `GET` | `/mixer/param-presets` | — | `{ paramPresets: [{ name, pattern, savedAt }] }` (sorted) |
| `POST` | `/mixer/channels/:id/param-presets` | `{ name }` | `{ status:'ok', name, pattern }` — captures the channel's current params |
| `POST` | `/mixer/channels/:id/param-presets/:name/recall` | — | `{ status:'ok', name, channelId }` — replays the preset onto the channel |
| `DELETE` | `/mixer/param-presets/:name` | — | `{ status:'ok' }`, or `404` |

**Channel scope.** `:id` is resolved with `mixer.getChannel(id)`, so BOTH the deck
channel and any mixer overlay can capture/recall — the routes are disjoint from
the §8.1 whole-mixer snapshot routes, so supporting the deck cost nothing extra.

**Pattern scoping (fail loud, the key rule).** The pattern a preset was captured
on is stamped into the preset. Recalling onto a channel running a DIFFERENT
pattern is rejected `409 code:PARAM_PRESET_PATTERN_MISMATCH` — the control ids are
pattern-specific export slots, so replaying them onto another pattern would set
the wrong knobs or silently no-op on missing exports. We refuse rather than
degrade (Codex P0).

**Recall application.** For each saved control, recall replays it via
`paramRouter.setChannelControl(channelId, controlId, v0, v1, v2)` — the SAME path
boot/snapshot-recall uses — gated by `getReplayableLocalExport` (skips
CPC-owned/blocked/non-local ids, same as the boot restore). `setChannelControl` →
`channel.setControl` writes BOTH `channel.localControls` AND the live WASM handle,
so the running pattern picks the values up on the NEXT frame. Recall then
`saveAllState()` + `broadcastMixerState()`.

**Fail loud.** Unknown preset on recall ⇒ `404`; unknown channel ⇒ `404`; corrupt
preset YAML / bad shape ⇒ `400 code:PARAM_PRESET_MALFORMED` (never a silent empty
preset — a corrupt file even fails `listParamPresets` loudly); malformed/empty
name ⇒ `400`; pattern mismatch ⇒ `409`.

**WS.** Broadcasts `{ type:'paramPresets', action:'captured'|'recalled'|'deleted',
name, paramPresets }` on `/ws/control` (new type registered in
`ws_topic_routing.js`, next to `snapshots`).

**Implementation map (round-2 #9).**

| Site | What |
|---|---|
| `lib/param_preset_manager.js` | `ParamPresetManager` (`captureParamPreset`/`listParamPresets`/`loadParamPreset`/`deleteParamPreset`, atomic write, name safety, deep-copy + numeric coercion on capture, pattern + controls shape validation), `ParamPresetError` |
| `lib/api_server.js` | `ParamPresetManager` construction; the 4 routes (capture/list/recall/delete); recall replays via `paramRouter.setChannelControl` + `getReplayableLocalExport` gate; 404/400/409 fail-loud handling |
| `lib/ws_topic_routing.js` | `paramPresets` → `/ws/control` |
| `tests/param_preset.test.js` | Unit (14): capture→list (pattern scope); load round-trips exact controls; deep-copy isolation; non-finite coercion; missing→null; malformed name→throw; corrupt YAML/shape→`ParamPresetError`; list fails loud on corrupt file; persist+reload; delete; sort; overwrite |
| `tests/hil/hil_param_preset_test.mjs` | HIL (21): capture→list; set param A→capture→change to B→recall restores A on the LIVE channel's serialized export; recall unknown preset→404, missing channel→404; malformed/empty name→400; pattern mismatch→409 (with code); delete→404-on-second |

---

## 11. Per-channel output METERING (2026-06-20)

A cheap effective-output **level** per channel, surfaced as a bar/percent
meter in the self-subscribing `ChannelVizStrip` (beyond the existing pixel
viz). It answers "is this layer actually putting light on the rig, or is it
sitting dark?" — a layer faded out, in a muted group, solo-gated, or made
invisible by a blend mode reads ~0 even when its underlying pattern is bright.

**Engine.** `PatternMixer` computes one `level` (0..1) per channel each
vis-broadcast frame, **allocation-free** and folded into the existing vis
extraction pre-pass (no new per-frame `Uint8Array`, no extra render). The
level is the channel's intrinsic **mean brightness** (`_bufferMeanLevel` —
one pass summing the just-rendered `channelBuffer`'s RGBWAU bytes / `n*255`)
scaled by the **same `effFader`** the composite gate uses (fader → `faderMax`
clamp → group scale → solo gate → enabled). The deck is PFL, so its meter uses
only its own clamped fader + enabled gate (decks are never in groups/solos);
the `master` key meters the final composed output; the deck-swap inactive
sibling meters its incoming pattern × swap fader. The WAVE 15 per-frame
group-scale cache + `soloActive` flag are now precomputed ONCE **before** the
vis pre-pass (hoisted up from the composite loop) and reused by both, keeping
`_effFader` pure O(1). Exposed via `PatternMixer.getVisLevels()` → `{ <visKey>:
number }` keyed identically to `getVisData()`. Populated only when
`wantVisThisFrame` (same cadence as vis), so non-broadcast frames do zero extra
work.

**Broadcast.** `engine.js` adds a `levels` sidecar to the existing
`{ type:'vis', vis, pixelCount }` message: `{ type:'vis', vis, levels,
pixelCount }`, where `levels` is the plain `{ <visKey>: number }` map. The
`api_server.js` viz publish hook forwards the whole `type:'vis'` object to
`/ws/viz` unchanged, so no route edit was needed.

**CaptainPad.** `ChannelVizStrip` (still self-subscribed to the viz bus — no
new prop, no `mixer.tsx` coupling) reads its own key off `msg.levels` and
renders a thin bar (green→amber→red) + tabular percent under the pixel strip,
on the same 5 Hz redraw cap. A new `showMeter` prop (default `true`) lets
tight layouts opt out.

**Fail-loud / no silent fallback (Codex P0).** If the engine omits `levels`
(older engine) or the key is absent / non-finite, the client's `level` stays
`null` and **NO meter renders** (the pixel strip layout is unchanged — no
layout shift). That `null` is the documented "no level reported" default,
never a fabricated `0`. Default behavior is otherwise unchanged: the level is
purely additive telemetry with no render effect.

| Site | What |
|---|---|
| `lib/pattern_mixer.js` | `_visLevels` field; `_bufferMeanLevel`; `getVisLevels()`; group-scale/`soloActive` precompute hoisted before the vis pre-pass; per-channel/deck/master/inactive level fill in `renderAll6ch` |
| `engine.js` | `levels` sidecar on the `type:'vis'` broadcast |
| `components/ChannelVizStrip.tsx` | meter bar + percent from `msg.levels`; `showMeter` prop; `null`-when-absent |
| `tests/channel_metering.test.js` | Unit: fader→level (0/0.5/1), faderMax clamp, disabled, solo gate, group mute/fader, deck PFL, master, non-vis-frame skip, key parity with vis (13 tests) |

---

## 6b. Channel ops cluster — Duplicate · Reorder · Panic/Home

Engine wave (2026-06-20). Three operator actions on the overlay stack. All
mutations are validate→mutate→`saveAllState()`→`broadcastMixerState()`; bad
input fails loud (400/404), never silently. Routes are armed in
`api_server.js` **before** the `^/mixer/channels/[^/]+$` PATCH/DELETE regexes
so the literal `/duplicate` and `reorder` segments aren't read as channel ids.

### #6 Duplicate — `POST /mixer/channels/:id/duplicate`
Deep-copies a mixer overlay into a NEW overlay that lands on **top** of the
stack. Rejects the deck id (`WRONG_ROLE` 400); a missing source id is 404.
Copy = `serializeChannelForState(src)` (the same serializer `captureLook`
uses) with `id` overridden to a freshly minted `ch_<ts>_<counter>` and `name`
to `"<src> copy"`, then rebuilt via `buildChannelFromSaved` — which compiles a
**fresh** WASM handle (never shares `src.handle`, so no double-free),
re-binds the playlist, replays `localControls`, and runs `finalizeCpcValues`.
All additive fields (`faderMax`, `color`, `mixGroupId`, `soloSafe`,
`viewSelection`, locks, transition prefs) inherit for free via the blob. The
cap is **delegated** to `addMixerChannel` (throws → 400) — single source of
truth, no separate pre-check. Response mirrors the add route (`channelId`,
`pattern`, `playlist`, inline `playlistData`) plus `sourceChannelId`.

### #7 Reorder — `POST /mixer/channels/reorder { order: [ids] }`
Reassigns the overlay stack order. `order` MUST be a **permutation** of the
current overlay ids — array, exact length, no duplicates, exact same id set —
validated BEFORE any mutation; any deviation ⇒ `400 REORDER_BAD_SET` (no
partial apply). The mixer method `reorderMixerChannels(orderedIds)` does a
single atomic reassignment of `this.mixerChannels` to the **same** channel
objects in the new order (no splice, no recompile). Every per-channel field
(handle, `compiledPixelMask`, `mixGroupId`, `soloSafe`, …) is preserved by
reference. **Accepted mid-transition (no 409):** `renderAll6ch` rebuilds
`_renderOrderScratch` from `mixerChannels` every frame via `findIndex`, and
transitions key on channel id, so the new order is picked up next frame with
no glitch. `order[0]` = bottom of the mix (seed layer), `order[last]` = top.

### #9 Panic / Home — `POST /mixer/panic { home? }`
Mission-critical: **always leaves the rig LIT.** `home` defaults to `true`.

- If a snapshot named **`home`** exists → `recallLook` it, then force blackout
  off + master to 1.0 (so a home captured at low master can't leave it dark).
  Response `{ status:'ok', mode:'home', home:'home', rigLit:true }`.
- Else → `mixer.panicToSafeDefault()` + clear blackout + master 1.0. Response
  `{ status:'ok', mode:'safeDefault', rigLit:true }`.
- **The ONE sanctioned loud fallback:** if a configured `home` snapshot is
  malformed (corrupt YAML / bad shape) or structurally unusable (over-cap),
  return **400** with a structured error (`PANIC_HOME_MALFORMED` /
  `PANIC_HOME_RECALL_FAILED`) **but still clear blackout + master up** so the
  exterior stays visible. The response carries `rigLit:true`.

`panicToSafeDefault()` (mixer method): `setMaster(1.0)` (cancels any in-flight
master fade); `cancelDeckPatternSwap()` (drops a half-chosen deck target,
keeps the current known-lit deck pattern — NOT `finishDeckSwapNow`);
`cancelChannelTransition` on every overlay (restores saved blend modes + clears
the scripted-target flag); force-enable every overlay at fader 1.0 **except**
`faderLocked` channels (parked level sacred) and **never** touching `faderMax`
(safety ceiling); `soloedChannelIds.clear()`; un-**mute** every group (without
deleting groups or resetting their faders); reset `targetViewFader` to 1.0.

| Site | What |
|---|---|
| `lib/pattern_mixer.js` | `reorderMixerChannels(orderedIds)` (atomic re-order, re-validates + throws); `panicToSafeDefault()` (cancel fade/swap/transitions, enable overlays, clear solo, un-mute groups) |
| `lib/api_server.js` | route arms `POST /mixer/channels/:id/duplicate`, `POST /mixer/channels/reorder`, `POST /mixer/panic` (armed before the `:id` regex) |
| `tests/channel_ops_state.test.js` | Unit: reorder reverse/by-ref/atomic/bad-set/mid-transition; panic master/overlays/solo/faderLocked/faderMax/groups/deck-swap (10 tests) |
| `tests/hil/hil_channel_ops_test.mjs` | HIL: dup distinct id + top + inherit + cap-400 + 404; reorder reverse/intact/bad-set/mid-transition; panic (all-in-flight) → master 1, blackout false, solo cleared, **NON-ZERO pixels (rig LIT)**; panic-with-home; panic-malformed-home → 400 but still LIT (30 checks) |

---

## 6.x §F-hue — Hue Shifter (global + per-channel)

Operator-requested (2026-06). Two independent hue rotations, **both RGB-only**:
the **GLOBAL** hue rotates the whole post-mixer buffer; the **PER-CHANNEL** hue
rotates one layer before it blends. **W / A / UV are never touched** — those
channels carry no hue concept and the mission-critical exterior whites must
never be tinted or dimmed by a hue knob. Both use a luminance-preserving **YIQ
rotation** (NTSC luma weights), precomputing `cos`/`sin` + the 3×3 matrix once
per frame (~9 mults/pixel), **gated on a non-zero angle so the default rig pays
zero cost**, allocation-free hot path.

### Pipeline order

```
mixer composite -> applyMacros -> [GLOBAL hue] -> applyGroupFixedColors -> intensity/blackout
                                   (engine.js, on model.pixels floats)
per-channel render -> [PER-CHANNEL hue] -> blend into composite
                       (pattern_mixer.js, on channelBuffer Uint8 0-255, PRE-blend)
```

The two **stack additively** per pixel: a channel with `hue=30` under a global
`hue=90` reads as a net +120 deg rotation on that channel's contribution. Global
hue runs **before** group-fixed-color locks and intensity/blackout, so color
locks and the e-stop safety stay authoritative. `effFader` (level) and the
`color` metadata tag are orthogonal — no conflict.

### Global hue (first-class knob, NOT a GEM slot)

- `GlobalEffectsController.hueShift = { degrees, autoRotateDegPerSec }` —
  PERSISTENT rig state (`globals_state.yaml`). `setHueShift(deg, rot)` validates
  finite (throws on NaN/Inf — Codex P0), normalizes `degrees` into `[0,360)`,
  clamps `rot` into `[-360,360]`. `applyHueShift(pixels, nowMs)` advances the
  phase by `rot * dt` (wall-clock, frame-rate-independent, wrap 360) then rotates
  RGB. **Left alone by `panicStop()`** (hue is a chroma offset, not a
  brightness/flash hazard; blackout still zeroes output).
- **`POST /global-effect-hue`** `{ degrees, autoRotateDegPerSec? }` -> validates
  (400 on non-finite), persists `globalsState.hueShift`, broadcasts
  `{ type: 'globalHueShift', hueShift }` (-> `/ws/control`) + mixer state.
  `GET /globals` reflects `hueShift`.

### Per-channel hue

- `PatternChannel.hue` (default `0`, normalized `[0,360)`). Applied on the
  interleaved `channelBuffer` via `applyHueShift6chU8(buf, pixelCount, degrees)`
  in the composite loop **and** the vis/deck pre-passes (so meter + preview
  match the rendered output).
- **`PATCH /mixer/channels/:id`** and **`PATCH /deck/channel`** accept a `hue`
  field via `validateHue` (non-finite -> 400, normalized into `[0,360)`).
  Serialized in all four serializers (api_server `serializeChannel` +
  `serializeMixerState`; state_manager `serializeChannel` + `saveMixerState`
  overlay) and the restore path. An old state file without `hue` restores to `0`.

### Validation — `validateHue(raw)` (api_server.js)

Finite number (or finite-parseable string) required; non-finite / non-number =>
`{ ok:false }` -> **400** (no silent coercion to 0). Finite => normalized into
`[0,360)` via `((n%360)+360)%360` (the hue wheel wraps — `370->10`, `-30->330`).

| Site | What |
|---|---|
| `effects/hue_shift.js` (NEW) | `applyHueShift({pixels,degrees})` — float `model.pixels`, RGB-only, no-op at 0, header documents W/A/UV untouched |
| `lib/global_effects_controller.js` | `hueShift` state + `setHueShift` + per-frame `applyHueShift` (auto-rotate) + `getStatus`; panicStop leaves it alone |
| `engine.js` | calls `applyHueShift(model.pixels, now)` between `applyMacros` and `applyGroupFixedColors` |
| `lib/pattern_channel.js` | `hue=0` field, normalized `[0,360)` |
| `lib/pattern_mixer.js` | `applyHueShift6chU8` helper; applied pre-blend in composite loop + vis pre-pass + deck pre-pass, gated `if(channel.hue)` |
| `lib/api_server.js` | `validateHue`; `POST /global-effect-hue`; `hue` on both channel PATCHes; serialized in 4 serializers + restore |
| `lib/state_manager.js` | `globalsState.hueShift` default + restore (validating setter); channel `hue` in `serializeChannel` + `saveMixerState` |
| `lib/ws_topic_routing.js` | `globalHueShift` -> `/ws/control` |
| `tests/hue_shift.test.js`, `tests/hue_serialize.test.js` | Unit: rotation @120/240 deg, W/A/U unchanged, no-op@0, clamp, validateHue NaN->400 + normalize 370->10, auto-rotate dt advance + wrap, panicStop preserves, per-channel round-trip (25 tests) |
| `tests/hil/hil_hue_shift_test.mjs` | HIL: validateHue 400/normalize; global hue rotates `rig` RGB while W/A/U unchanged (POST-composite); per-channel deck hue rotates the channel vis buffer while W/A/U unchanged (PRE-blend); serialize round-trip (17 checks) |

---

## 6.x2 §F-invert — GLOBAL color INVERT

Operator-requested (round 2, 2026-06; **converted from per-channel to GLOBAL**
in the channels-optimization campaign, 2026-06). A single **global** boolean
toggle that **inverts the RGB of the WHOLE post-mixer buffer** (`1 - v` on the
float `model.pixels`) in the engine pipeline. Modeled exactly on the global hue
shifter: a first-class chroma op (like blackout), **RGB-only**, gated,
persisted, broadcast. W / A / UV are **never** touched — the mission-critical
exterior whites carry no color concept and must never be flipped dark by an
invert toggle.

> The earlier per-channel invert (`PatternChannel.invert` + the mixer's
> `applyInvert6chU8` pre-blend helper + the `{invert}` PATCH on both channel
> handlers + the per-channel serializers) was **removed entirely** — no dead
> code remains. Per-channel chroma is still available via the per-channel hue.

### Global invert

- `GlobalEffectsController.invert` (default `false`, coerced via `setInvert`’s
  `!!`). Applied post-composite by `applyInvert(pixels)`, which delegates to
  `effects/invert.js applyInvert({pixels, enabled})` (RGB-only float `1 - v`;
  W/A/UV untouched). Gated `if (this.invert)` so the default rig pays nothing.
  `panicStop()` LEAVES it alone (a static chroma op, not a brightness/flash
  hazard, and blackout still zeroes the output — same rationale as the global
  hue).
- **`POST /global-effect-invert { enabled }`** — mirrors `POST
  /global-effect-hue`. `enabled` coerced via `!!` (a pure boolean toggle — any
  value coerces, no validation-error contract / no 400). Calls `setInvert`,
  persists `globalsState.invert`, broadcasts `{ type: 'globalInvert', invert }`
  on `/ws/control`, and also re-broadcasts mixer state.
- **Persistence**: `globalsState.invert` in `state_manager` (`loadGlobalsState`
  default `false`; `applyGlobalsState` restores through `setInvert` on boot).
  An old globals file without `invert` loads to `false`.
- **WS routing**: `globalInvert` → `/ws/control` (same topic as
  `globalHueShift`), pinned in `ws_topic_routing.js` + both routing tests.

### Pipeline order

The engine applies the global hue **first**, then the global invert
(`applyHueShift(model.pixels)` then `applyInvert(model.pixels)`) — documented
order **global HUE then global INVERT** — AFTER the show macros and BEFORE the
group color-locks + intensity/blackout, so locks and the e-stop keep the final
say.

| Site | What |
|---|---|
| `effects/invert.js` (NEW) | `applyInvert({pixels, enabled})` float `1 - v`, RGB-only (W/A/UV untouched), early-return when disabled (gated zero-cost). Header mirrors `hue_shift.js` |
| `lib/global_effects_controller.js` | `this.invert=false`; `setInvert(enabled)` (`!!`); `applyInvert(pixels)` (gated, delegates to the effect); surfaced in `getStatus()`; LEFT ALONE in `panicStop()` |
| `engine.js` | `globalEffectsController.applyInvert(model.pixels)` AFTER `applyHueShift`, BEFORE `applyGroupFixedColors` + intensity/blackout |
| `lib/api_server.js` | `POST /global-effect-invert {enabled}` (`!!`); persists `globalsState.invert`; broadcasts `{type:'globalInvert', invert}` + mixer state |
| `lib/ws_topic_routing.js` | `globalInvert` → `control` (same topic as `globalHueShift`) |
| `lib/state_manager.js` | `globalsState.invert` default false (`loadGlobalsState`) + restore (`applyGlobalsState`) |
| `tests/global_invert.test.js` (NEW) | Unit: `1-v` flip + W/A/U untouched, double-invert identity, disabled no-op (gated), `setInvert` `!!` coercion, `getStatus`, `panicStop` preserves, globalsState round-trip + missing→false, pipeline order (hue-then-invert) |
| `tests/hil/hil_global_invert_test.mjs` (NEW) | HIL (slot 2 :31268): `POST /global-effect-invert {enabled:true}` flips the post-composite `rig` RGB to 255-baseline while W/A/U unchanged; toggle off restores baseline; `globalInvert` broadcast observed on `/ws/control`; payload coercion |

---

## 6.y §F-cue — Cue-to-deck (audition a mixer overlay on the deck preview)

Operator-requested (2026-06, round-2 backlog #7). Lets the operator **audition
a MIXER overlay's pattern on the DECK preview buffer at 100% (PFL)** before
pushing it live on the mixer — the classic console "cue / PFL" affordance.

The render path **already honoured** `PatternMixer.deckFocusChannelId`: when set
(in `renderAll6ch`, the "Render Deck" step), the deck buffer renders THAT
channel instead of the canonical deck channel, via `getChannel(id)` (which
resolves an overlay OR the deck). This wave was pure plumbing + UI around that
existing field.

### API surface

- **`POST /deck/focus { channelId }`** — arm a cue. `channelId` is a MIXER
  overlay id to preview on the deck, or `null` to clear (restore the canonical
  deck view). Validation (fail-loud, Codex P0, no silent fallback):
  - `null`/absent ⇒ clear ⇒ 200 `{ status:'ok', deckFocusChannelId:null }`.
  - non-string `channelId` ⇒ **400**.
  - the deck channel's own id ⇒ **400** (the deck cannot cue itself; clearing is
    the default state).
  - an unknown id (not an existing overlay) ⇒ **404**.
  - a valid overlay ⇒ set `mixer.deckFocusChannelId` ⇒ 200 `{ status:'ok',
    deckFocusChannelId:<id> }`.
  - Placed as a `/deck/*` EXACT-match router arm BEFORE the
    `/mixer/channels/:id` regex arms, away from that regex hazard.
- **`deckFocusChannelId` surfaced** on `GET /deck/channel` and on the **deck WS
  broadcast** (`serializeDeckState`, fired by `broadcastMixerState` /
  `broadcastDeckState`) so CaptainPad reconciles the active cue.

### Transient by design

`deckFocusChannelId` is **NOT persisted** — it is a live audition affordance,
not show state. It **clears on engine restart** (and `state_manager` never reads
or writes it). This is intentional: an operator should never reboot into a
preview override they forgot about.

### CaptainPad (deck tab)

A **CUE** affordance in the deck preview header: tap `◎ CUE` to pick a mixer
overlay (modal lists the live overlays from the `mixer` WS broadcast / a one-time
`/mixer` seed — the deck tab does not otherwise track overlays); the active cue
shows as a `CUE · <name>` chip + a `CLEAR` button. Optimistic local apply,
reconciled from the deck broadcast's `deckFocusChannelId`; a rejected arm reverts
+ Alerts with the engine's error verbatim. ≥44pt targets; the header reserves
height so arming/clearing causes no layout shift. The cued pattern is visible on
the **simulation / sACN output** (the deck buffer), not the CaptainPad mini-strip
(which is keyed by the deck channel's own render).

### Implementation map (this wave)

| File | Change |
|---|---|
| `lib/api_server.js` | `POST /deck/focus` arm (validate overlay / 400 deck-self / 404 unknown / null clear); `deckFocusChannelId` on `GET /deck/channel` + `serializeDeckState` |
| `lib/pattern_mixer.js` | none (render already honours `deckFocusChannelId`; field set directly from the route) |
| `CaptainPad/utils/deckFocusApi.ts` (NEW) | `setDeckFocus(channelId|null)` client, fail-loud `ApiResult` |
| `CaptainPad/app/(tabs)/index.tsx` | CUE control + overlay-picker modal + active-cue chip + CLEAR; optimistic + reconcile from the `deck` broadcast |
| `tests/deck_focus_cue.test.js` (NEW) | Unit: field defaults null, set/clear, `getMixerChannel` contract (overlay resolves / deck→null→400 / unknown→undefined→404) — 6 tests |
| `tests/hil/hil_deck_focus_cue_test.mjs` (NEW) | HIL (slot 2 :31268): arm overlay → GET + WS reflect id + rendered deck buffer == overlay render; clear → back to deck render; 404/400/400 error paths — 18 checks |

---

## 6.z §F-phase — Per-channel phase clock: TAP-TEMPO core (#4, 2026-06-21, engine-side)

Round-2 cluster, **trimmed** in the channels-optimization campaign (2026-06).
The original cluster carried three features on one per-channel phase clock:
**#3 per-channel SPEED**, **#4 TAP-TEMPO**, **#11 CHASE/phaseOffsetMs**. The
**per-channel SPEED knob (#3) and the CHASE / phaseOffsetMs (#11) features were
REMOVED entirely** — only the minimal **tap-tempo** core remains. Design:
`.agent/02_reports/202606/20260620_33_speed_tap_chase_design.md`.

> Removed (no dead code remains): `PatternChannel.speed` /
> `PatternChannel.phaseOffsetMs` fields; `validateSpeed` /
> `validatePhaseOffsetMs` in `api_server`; the `{speed}` / `{phaseOffsetMs}`
> PATCH handling on both channel handlers; the `speed` / `phaseOffsetMs`
> serializer + restore fields. The phase accumulator, `followsTempo`, and the
> tap-tempo machinery were KEPT.

### The mechanism (why an accumulator, not a dt-scale)

The WASM VM consumes **ABSOLUTE per-handle time** (`wasm_host.beginFrame(handle,
elapsedSeconds)`). The engine already owns a GLOBAL scaled clock
(`engine.js` `patternClockSeconds` — each wall dt scaled by the global speed
knob) and fans the SAME `elapsed` UNCHANGED to every channel via
`PatternChannel.beginFrame`. The phase clock gives each channel its OWN
**accumulated** phase derived from that same global elapsed DELTA:

```
dt = max(0, elapsed - _lastPhaseElapsed)   // first frame ⇒ 0; backwards ⇒ 0
_lastPhaseElapsed = elapsed
_phaseSeconds += dt * effectiveSpeed        // ACCUMULATE — never re-scale a raw dt
phase = _phaseSeconds
wasmHost.beginFrame(handle, phase)
```

We **accumulate** (not multiply the absolute `elapsed`) so an absolute-time
pattern (`time(...)`, `triangle(t)`, etc.) **never JUMPS** when the operator
taps a new tempo mid-show — the accumulator stays continuous across the
change; only the future rate changes. No reset on handle swap (continuity is
fine); **no modulo** (f64 has ample precision for a multi-day show, and
wrapping would visibly glitch an absolute-time pattern). `globalDt` is ALREADY
global-speed-scaled by `engine.js` — the per-channel multiply does NOT
re-read / re-apply the global speed (no double-count).

### Per-channel field (`PatternChannel`)

| Field | Default | Clamp | Meaning |
|---|---|---|---|
| `followsTempo` (#4) | `false` | bool | opt-in to the global tap-tempo. Default false ⇒ the mission-critical exterior is immune unless opted in |

TRANSIENT (NEVER serialized): `_phaseSeconds` (running accumulator),
`_lastPhaseElapsed`. Rebuilt from 0 on boot — persisting a stale absolute
time would mean nothing after a restart.

### Global tap-tempo (#4, `PatternMixer`)

The CLIENT computes BPM from tap intervals; the engine stores the resolved
tempo and derives the multiplier. `tempoBpm` (null = no tempo set —
distinct from a tapped value), `_tempoMultiplier` (derived, never
serialized). `setTempoBpm(bpm)` → `_tempoMultiplier = clamp(bpm/120, 0.05, 8)`
(**120 BPM = 1×**). `_effectiveSpeed(ch) = clamp(ch.followsTempo ?
_tempoMultiplier : 1, 0.05, 8)` — **TEMPO-ONLY** (no per-channel speed factor):
a `followsTempo` channel runs at the tempo multiplier, every other channel at
1×. O(1), allocation-free, called once per channel per frame next to
`_effFader`. The inactive deck sibling is ticked with the active DECK's
effectiveSpeed (keeps the ping-pong time-sync contract).

### Composition / orthogonality

`effectiveSpeed = clamp(followsTempo ? tempoMult : 1, 0.05, 8)`;
`phase = _phaseSeconds`. Orthogonal to fader/faderMax/group/solo/bump (level),
hue (chroma), viewSelection (spatial). Scripted transitions ramp
`channel.fader` ONLY — never time — so a tempo change can't perturb a
fade-in-flight, and vice versa.

### API surface

- `PATCH /mixer/channels/:id` and `PATCH /deck/channel` accept:
  - `{ followsTempo }` — coerced via `!!` (boolean flag).
- `POST /mixer/tempo { bpm }` — finite `[20, 400]` else **400**; sets the
  global tempo; `saveAllState`; broadcasts mixer state. Response:
  `{ status, tempoBpm, tempoMultiplier }`. **No new WS message type** — `tempoBpm`
  rides the existing `mixer`-state broadcast (`serializeMixerState`).
- `followsTempo` is surfaced in ALL 4 serializers
  (`state_manager.serializeChannel`, `api_server.serializeChannel`,
  inline `serializeMixerState`, restored by `buildChannelFromSaved`);
  `tempoBpm` is a mixer-state global (serialized + restored on boot via
  `setTempoBpm`). `_phaseSeconds` is NEVER serialized. Missing field restores
  to default (false; tempoBpm null).

### Implementation map (this wave, post-trim)

| File | Change |
|---|---|
| `lib/pattern_channel.js` | `followsTempo` field + transient `_phaseSeconds`/`_lastPhaseElapsed`; `beginFrame(host, elapsed, force, effectiveSpeed=1)` accumulates per-channel phase (`phase = _phaseSeconds`). speed/phaseOffsetMs removed |
| `lib/pattern_mixer.js` | `tempoBpm`/`_tempoMultiplier`; `_effectiveSpeed(ch)` **tempo-only**; `setTempoBpm(bpm)`; pass effectiveSpeed to all 3 `beginFrame` call sites (inactive sibling gets the deck's) |
| `lib/api_server.js` | `{followsTempo}` in BOTH channel PATCH handlers; `POST /mixer/tempo`; `followsTempo` in `serializeChannel` + inline `serializeMixerState` (+ `tempoBpm` global) + `buildChannelFromSaved` restore + boot `setTempoBpm`. validateSpeed/validatePhaseOffsetMs + speed/phaseOffsetMs PATCH removed |
| `lib/state_manager.js` | `serializeChannel` emits followsTempo (additive, after hue); `saveMixerState` overlay copy + `tempoBpm` global. speed/phaseOffsetMs removed |
| `tests/tap_tempo.test.js` (renamed from `phase_clock.test.js`, trimmed) | Unit: accumulate-monotonic, no-jump-on-tempo-change, negative-dt floor, tempo 60→0.5× on followers only (tempo-only `_effectiveSpeed`), clamp, `setTempoBpm` rejects non-finite, `followsTempo` serialize round-trip + missing→false, `_phaseSeconds` never serialized, orthogonality, removed-field assertion |
| `tests/hil/hil_tap_tempo_test.mjs` (renamed from `hil_phase_clock_test.mjs`, trimmed) | HIL (slot 2 :31268): `POST /mixer/tempo {60}` → multiplier 0.5 + `serializeMixerState` reports `tempoBpm:60`; followsTempo halves follower only; bad bpm → 400 |

### Deferred to the UI wave (not in scope here)

- CaptainPad: a FOLLOW TEMPO toggle on the channel strip; a TAP TEMPO button
  (client computes BPM from tap intervals → `POST /mixer/tempo`); `MixerChannel`
  type += `followsTempo`. (The per-channel SPEED + CHASE/OFFSET UI is NOT in
  scope — those engine features were removed in the channels-optimization
  campaign.)
- Audio-derived BPM (auto tap from the audio companion) is explicitly
  out-of-scope — #4 is manual tap only this wave.
  **(Delivered as the follow-up below: §F-tempo-arbitration.)**

---

## 6.za §F-tempo-arbitration — OSC auto-drives, tap overrides (2026-06-21, engine-side)

> ⚠️ **SUPERSEDED 2026-06-30 by §6.zb (sticky OSC/TAP source switch).** The
> "tap overrides for 12 s then OSC reclaims" auto-revert + the `MANUAL_HOLD_MS`
> window + the stability deadband described below were REPLACED by a sticky,
> persisted `tempoSourcePref` switch and source-side smoothing. Read §6.zb for
> current behavior; this section is kept for history.

The tap-tempo core above (§F-phase) is *manual only*: nothing fed the live
OSC/audio BPM into `mixer.tempoBpm`. This wave adds the arbiter that makes the
manual TAP and the live OSC BPM coherent. The operator's rule:
**"OSC auto-drives, tap overrides."**

### The arbiter (`lib/tempo_arbiter.js`, `TempoArbiter`)

A small object constructed at boot (engine.js, before `startApiServer`,
exposed as `engineCore.tempoArbiter`) and `attach()`-ed to the ParamCenter.
It drives **only** `mixer.tempoBpm` (which in turn affects `followsTempo`
channels via the §F-phase multiplier). State lives on the arbiter, not module
globals: `_manualOverrideUntilMs`, `_lastOscBpm` / `_lastOscBpmMs`,
`_lastAppliedOscBpm`.

**Named constants (documented):**

| Const | Value | Meaning |
|---|---|---|
| `MANUAL_HOLD_MS` | `12000` | how long a manual tap suppresses OSC auto-follow |
| `OSC_STALENESS_MS` | `1500` | a received `audioBpm` is "live" only within this window |
| `TEMPO_MIN_BPM` / `TEMPO_MAX_BPM` | `20` / `400` | the supported musical window OSC-driven values clamp into |

### The four ruled behaviours

1. **OSC live → auto-follow.** A render-loop `beforeFrame` tick
   (`tempoArbiter.tick(Date.now())`, composed in the SAME hook as
   `autoCycleTick` / `deckOverlayAutoCycleTick`) continuously sets
   `mixer.tempoBpm` from the live OSC BPM (clamped `[20,400]`), but **only when
   the value actually changes** — no per-frame `setTempoBpm` churn / log spam.
   Hot-path safe: two field reads + one timestamp compare, no allocation.
2. **Manual tap overrides for a hold window.** `POST /mixer/tempo {bpm}` sets
   the tempo immediately (as before) AND calls
   `tempoArbiter.noteManualTap()` → `_manualOverrideUntilMs = now +
   MANUAL_HOLD_MS`. While `now < _manualOverrideUntilMs` the auto-follow tick
   is a no-op, so OSC cannot overwrite the tapped value. After the window, if
   OSC is still live, auto-follow resumes (OSC reclaims).
3. **Idle OSC → last value holds.** If OSC is stale/off the tick never fires,
   so the last `tempoBpm` (tapped or last OSC) simply persists. No clobber.
4. **Explicit re-sync.** `POST /mixer/tempo/sync` (no body / `{}`) →
   `tempoArbiter.clearOverride()` (`_manualOverrideUntilMs = 0`) so OSC
   reclaims on the next tick if live. **Fails loud (500)** if the arbiter /
   mixer is missing (codex P0 — no silent fallback).

### OSC liveness (how it's read)

The engine ParamCenter has **no per-key timestamp**. The arbiter therefore
`subscribe()`s to the CPC (same multi-subscriber API `bpm_speed_sync` uses) and
records the wall-clock instant (`Date.now()`) that `audioBpm` was last written
with a **finite, positive** value. A `0` / non-finite `audioBpm` is "no signal"
(the Companion emits 0 when it can't resolve a tempo) and does NOT refresh the
liveness clock — fail SAFE, never follow a stale/absent tempo. This is a
**BPM-specific** liveness signal, NOT generic OSC traffic (`oscStats.lastSeenMs`),
so unrelated OSC messages can't masquerade as a fresh tempo. The auto-follow
tick passes `Date.now()` (NOT the loop's `performance.now()` — different epoch
from the recorded timestamps).

### `tempoSource` (display) + new WS fields

`serializeMixerState` now emits two NEW fields ALONGSIDE the unchanged
`tempoBpm` (so the UI can render `128 · OSC` / `128 · TAP` / `128 · held`):

- **`tempoSource`** — `tempoArbiter.deriveSource()`:
  - `'osc'` — OSC live AND not in a manual-override window (auto-driving).
  - `'manual'` — inside the manual-override window (the tap owns it).
  - `'held'` — OSC stale/off; the last value is just holding.
- **`oscTempoBpm`** — the raw live OSC value (clamped to `[20,400]`) or `null`
  when OSC is stale/off. Distinct from the applied `tempoBpm`.

Both ride the existing `mixer`-state broadcast — no new WS message type. The
`POST /mixer/tempo` and `POST /mixer/tempo/sync` responses also include
`tempoSource` (and sync includes `oscTempoBpm`).

### Independence from `bpm_speed_sync` (do NOT unify)

`lib/bpm_speed_sync.js` separately maps `audioBpm` → the **SPEED knob** (CPC
`speed`). That is a **different mechanism with a different target**. The
TempoArbiter drives **only** `mixer.tempoBpm`; it never touches `speed`. Both
may be enabled at once — that is acceptable and intended. They are NOT unified
and do NOT double-apply (different write targets).

### Implementation + test map (this wave)

| File | Change |
|---|---|
| `marsin_engine/lib/tempo_arbiter.js` | NEW — `TempoArbiter` (attach/detach, `tick`, `noteManualTap`, `clearOverride`, `deriveSource`, `oscTempoBpm`, `isOscLive`, `isManualOverrideActive`) + the exported constants |
| `marsin_engine/engine.js` | import + construct `TempoArbiter` before `startApiServer`, `attach()`, expose on `engineCore.tempoArbiter`; compose `tempoArbiter.tick(Date.now())` into the `beforeFrame` hook |
| `marsin_engine/lib/api_server.js` | `POST /mixer/tempo` now arms `noteManualTap()` + returns `tempoSource`; NEW `POST /mixer/tempo/sync` (drops override, 500 if no arbiter); `serializeMixerState` emits `tempoSource` + `oscTempoBpm` |
| `marsin_engine/tests/tempo_arbitration.test.js` | NEW unit suite (21 tests): OSC-drive, tap-override hold, post-window reclaim, stale-hold, sync, source derivation, clamp, no-churn |
| `marsin_engine/tests/hil/hil_tempo_arbitration_test.mjs` | NEW HIL (slot :31268): simulates OSC via `POST /param-center {audioBpm}`; asserts manual/osc/held transitions + clamp on the live `mixer` WS broadcast |

### Deferred to the UI wave (not in scope here)

- CaptainPad: render `tempoSource` (`OSC` / `TAP` / `held` badge next to the
  BPM), a re-sync button → `POST /mixer/tempo/sync`, and add `tempoSource` +
  `oscTempoBpm` to the `MixerState` type. Engine side is complete.

---

## 6.w §F-follow — Channel FOLLOW / LINK (round-2 #6, 2026-06-21, engine-side)

Operator-requested (round-2 backlog #6). A mixer channel can be set to
**FOLLOW** another channel (the **leader**) so the **follower**'s fader tracks
the leader's *effective* level. Lets the operator gang two layers' brightness
without grouping them (groups scale members; follow makes one layer's input
*equal* another's output × a scale) — e.g. a UV accent layer that always rides
at half the brightness of the main wash.

Engine-only this wave (no CaptainPad). Lives in `PatternChannel` (two fields),
`PatternMixer` (`_effFader` resolution + the prev-frame effective cache + the
cycle/cleanup helpers), `api_server` (PATCH `followLeaderId`/`followScale`,
DELETE cleanup, serializers, restore), and `state_manager` (persistence).

### Per-channel fields (`PatternChannel`)

- `followLeaderId` — id of the leader channel, or `null` = "not following"
  (the follower uses its own manual `fader`). Default `null`. An old state file
  without the field restores to `null` (documented schema default, NOT a silent
  fallback).
- `followScale` — multiplier applied to the leader's effective level before the
  follower's own caps. Default `1.0` (track 1:1). Clamped to `[0,2]`
  (`validateFollowScale` at the API boundary + the ctor defensively). A
  non-finite value restores to `1.0`.

### Semantics + precedence (THE EXACT RULE)

Follow replaces **only** the follower's manual `fader` **INPUT** with
`leaderEffective × followScale`. Everything else about the follower stays
independent and is **still applied on top**, in this order (see
`PatternMixer._effFader`):

1. **enabled gate** — a disabled follower contributes 0 (mute always wins).
2. **bump override** — a held FLASH/BUMP still forces the follower to
   `min(1, faderMax)` and short-circuits before the follow resolution (bump is
   the operator's momentary accent; it overrides the followed input).
3. **follow input** — if `followLeaderId` is set, the input becomes
   `leaderEffectivePrevFrame × followScale` (else the follower's own `fader`).
4. **own `faderMax` cap** — `min(input, faderMax)` (the follower's per-fixture
   ceiling is the last word on its own output; a follower can never exceed it).
5. **own group scale** — the follower's own `mixGroupId` gang-fader still
   scales it.
6. **own solo gate** — the follower's own solo/solo-safe state still applies.

The follower keeps its **own** pattern, hue, group, and solo. Following
**only ever affects the FOLLOWER's level — it can NEVER alter the leader** (the
resolution only *reads* the leader's cached effective value). Mission rule
satisfied: a follower can never force a mission-critical leader dark.

### Resolution = PREVIOUS-FRAME effective (the documented choice)

The follower reads the leader's effective level from the **previous frame**,
snapshotted into a reused `PatternMixer._prevEffFaderCache` Map at the END of
every `renderAll6ch`. This was chosen DELIBERATELY over a per-frame topological
resolve because it is the simplest correct approach that is **O(1) per channel
and allocation-free** (mirrors the `_groupScaleCache` precedent): no ordering
pass, the multiple `_effFader` calls within one frame (vis pre-pass AND
composite loop) all read the same frozen snapshot so they return identical
values, and a **chain** (A→B→C) resolves naturally with **one frame of latency
PER HOP**. One frame at 40 fps is 25 ms — imperceptible for lighting. A missing
cache entry (first frame, or a leader added this frame) reads as **0** (the
follower tracks down for one frame, then catches up — fail-safe, never a
spurious flash). The deck channel is included in the snapshot (a mixer overlay
may follow the deck); the deck is PFL so its effective level is its own
enabled-gated, `faderMax`-clamped fader.

### Cycle prevention (CRITICAL — fail loud)

Setting `followLeaderId` **rejects** any link that would create a cycle, at
PATCH time (the live follow graph can therefore never contain a loop):

- **self-follow** (A→A) → **400 `FOLLOW_CYCLE`**.
- **any cycle** (A→B→A, or longer A→B→C→A) → **400 `FOLLOW_CYCLE`**. Resolved by
  `PatternMixer.wouldCreateFollowCycle(followerId, leaderId)`, which walks the
  existing chain from the proposed leader up through each leader's own leader; a
  cycle exists iff the walk reaches the follower. A `seen` guard makes the walk
  terminate even against pre-existing bad data.
- **unknown leader** (id names no existing channel) → **404
  `FOLLOW_LEADER_NOT_FOUND`**. The leader may be a mixer overlay OR the deck.
- **non-finite `followScale`** → **400** (`validateFollowScale`, Codex P0 — no
  silent coercion).
- `followLeaderId: null` (or `""`) **clears** the link (revert to own fader).

### Missing / deleted leader = FAIL SAFE (not dark, not silent)

On channel **DELETE**, the api_server calls
`PatternMixer.clearFollowersOf(leaderId)` **before** removing the channel,
clearing `followLeaderId` on every follower so each reverts to its **own manual
fader** — it does NOT freeze and does NOT go dark, and the single mixer-state
broadcast carries the cleared values so CaptainPad re-syncs. `removeMixerChannel`
also clears followers belt-and-braces, so the mixer is self-consistent for any
direct/legacy caller. A dangling reference that somehow survives (e.g. a leader
missing after a restore) reads as a 0 prev-frame entry in `_effFader` — the
follower tracks down safely, never crashes; the operator should re-link.

### Persistence

`followLeaderId`/`followScale` round-trip through `serializeChannel`
(state_manager + the api_server serializers) and `buildChannelFromSaved`
restore. Appended AFTER the phase-clock fields so the on-disk key order for all
earlier fields is unchanged (old files load to the `null` / `1.0` defaults). The
transient `_prevEffFaderCache` is NEVER persisted — it is rebuilt frame-by-frame
from 0 on boot.

### API surface (NEW — for the follow-on UI wave)

- `PATCH /mixer/channels/:id` accepts `{ followLeaderId?, followScale? }`.
  Validated then applied; rides the existing mixer-state broadcast (no new WS
  type). Both fields surface in `serializeChannel` + `serializeMixerState`
  (`followLeaderId` null = not following; `followScale` 1.0 = 1:1).

### Implementation map (this wave)

- `lib/pattern_channel.js` — `followLeaderId` (string|null) + `followScale`
  (clamped [0,2]) fields + docs.
- `lib/pattern_mixer.js` — `_prevEffFaderCache` (reused Map); `_effFader` follow
  resolution (prev-frame leader effective × scale, before faderMax/group/solo);
  end-of-`renderAll6ch` snapshot pass (deck + mixer); `wouldCreateFollowCycle`;
  `clearFollowersOf`; `removeMixerChannel`/`destroy` cleanup.
- `lib/api_server.js` — `validateFollowScale`; PATCH `followLeaderId`/
  `followScale` (cycle/self/unknown/finite checks); DELETE `clearFollowersOf`
  + broadcast; serializers (both) + `buildChannelFromSaved` restore.
- `lib/state_manager.js` — `serializeChannel` + `saveMixerState` round-trip.
- Tests: `tests/follow_link.test.js` (unit), `tests/hil/hil_follow_link_test.mjs`
  (HIL).

### Deferred to the UI wave (not in scope here)

- CaptainPad: a FOLLOW picker (choose leader / "none") + a follow-scale fader on
  the channel strip; `MixerChannel` type += `followLeaderId`/`followScale`; a
  visual cue that a strip is following (and a guard that hides cyclic leader
  choices client-side, the engine still being the fail-loud source of truth).

---

## 6.v §auto-cycle — Overlay AUTO-CYCLE (round-2 #2, 2026-06-21, engine-side)

Generalizes the deck Autopilot daemon to ANY mixer overlay: a channel whose
per-channel `playlist.autopilot.active` is true auto-advances its playlist on a
timer. Before this wave, mixer overlays already CARRIED the `autopilot
{active, delay_s, shuffle}` field (constructed by `loadPlaylistEntry`), but
NOTHING ticked them — the only runner was the single `Autopilot` daemon, hard-
bound to the deck channel. This wave makes overlays cycle too.

### The mechanism (why a render-loop tick, not N setTimeouts)

Auto-cycle is driven from the engine render loop's per-frame `beforeFrame`
hook (`engine.js`), NOT a `setTimeout` per channel. One source of time (the
wall clock via `Date.now()`), no timer sprawl, no drift: each channel anchors
to `_autoCycleLastAdvanceMs` and the tick measures wall-clock deltas against it
(self-correcting). The tick (`autoCycleTick` in `api_server.js`) is cheap and
synchronous — it only DECIDES whether an advance is due; it never compiles
inline.

### Off-hot-path advance (CRITICAL)

Overlay `loadPlaylistEntry` is an **instant hard handle destroy+compile**
(50-200 ms) — overlays have NO double-buffer (unlike the deck). Awaiting that
compile inside `beforeFrame` would darken the composite for a frame or two.
So the actual advance is dispatched **off the hot path via `setImmediate`**,
drained after the frame returns. A per-channel `_autoCycleInFlight` guard
prevents a slow compile from stacking two advances. A compile error is
**logged loudly** (`[AutoCycle] advance failed …`) and the channel **keeps its
current pattern** — NOT a silent swap, NOT a silent swallow (Codex P0).

### v1 ships a HARD-CUT on overlays (documented limitation)

Because overlays have no double-buffer, the v1 auto-cycle advance is a visible
**instant hard-cut** (the same cut a manual entry tap produces). This is an
accepted v1 limitation. A v2 could fade the channel `fader` down → swap → up
via the existing `fadeChannel` path; that is out of scope for the engine-only
wave.

### Safety contract — EXTERIOR IMMUNITY is FREE (opt-in)

`autopilot.active` defaults **false** (set by `loadPlaylistEntry`). So a
mission-critical exterior channel **never auto-changes** unless an operator
explicitly arms it via the PATCH below — exactly mirroring the `followsTempo`
opt-in immunity. There is no separate exclude flag and none is needed.

### Per-channel transient field (`PatternChannel`)

- `_autoCycleLastAdvanceMs` — wall-clock ms of the last auto-advance, or
  `null` = "not yet seeded". **TRANSIENT — never serialized** (re-seeds to
  `now` on the first active frame post-boot, like `_phaseSeconds`). The first
  active frame seeds it and does NOT advance, so the first auto-advance lands a
  full `delay_s` later. A manual entry tap (`loadPlaylistEntry`) resets it to
  `null`, so the next tick measures from the manual change — the timer
  re-anchors cleanly.

### Tick algorithm (mirrors the deck advance)

Per active overlay, once `delay_s` has elapsed: pick the next entry —
`shuffle` = a random OTHER usable entry; else sequential, walking forward and
skipping `_missing` — then advance via the existing
`loadPlaylistEntry` choke. Pure decision helpers `autoCycleDueDecision` and
`pickNextAutoCycleEntry` are exported from `api_server.js` and unit-tested with
a fake clock. If a snapshot morph / recall-fade is rebuilding overlays
(`mixer.getMorph()`), auto-advance is skipped that frame.

### API surface (NEW — for the follow-on UI wave)

- `PATCH /mixer/channels/:id` accepts `{ autopilot: { active?, delay_s?,
  shuffle? } }`, merged into `channel.playlist.autopilot` (mirrors the deck
  `POST /deck/playlist/autopilot`, but stricter on `delay_s`).
  - `delay_s` is validated by `validateAutoCycleDelay`: finite + `> 0`, then
    **floored to 1 s**; a non-finite or `<= 0` value is rejected with
    **400 `AUTOCYCLE_BAD_DELAY`** (Codex P0 — no silent coerce, unlike the
    deck handler's legacy `parseInt||30`).
  - `active` / `shuffle` coerce via `!!`.
  - A channel with no `playlist.name` is rejected **400 `AUTOCYCLE_NO_PLAYLIST`**
    (nothing to cycle); a non-object `autopilot` is **400
    `AUTOCYCLE_BAD_PAYLOAD`**.
  - On success: `saveAllState` + `broadcastMixerState`; the anchor is re-seeded
    so the timer measures a full `delay_s` from the arm/change.
- **WS:** rides the existing `mixer` broadcast — `autopilot` lives inside the
  serialized per-channel `playlist`, so there is **NO new WS type**.

### Serialize / restore

`playlist` already round-trips whole (`serializeChannel` copies
`playlist: ch.playlist`), so `autopilot` persists with no new serializer field;
`autopilot` defaults fill on the next `loadPlaylistEntry` if an old state
file's playlist lacks them. `_autoCycleLastAdvanceMs` / `_autoCycleInFlight`
are transient and never persisted.

### Implementation map (this wave)

- `lib/pattern_channel.js` — transient `_autoCycleLastAdvanceMs = null` field +
  docs.
- `lib/api_server.js` — `validateAutoCycleDelay`; exported pure helpers
  `autoCycleDueDecision` + `pickNextAutoCycleEntry`; the `autoCycleTick`
  closure (dispatches the advance via `setImmediate`); the PATCH
  `autopilot` merge block; `loadPlaylistEntry` resets the anchor; `server.
  autoCycleTick` export.
- `engine.js` — composes `apiServer.autoCycleTick()` into the render loop's
  `beforeFrame` hook alongside `modulationController.applyFrame`.
- Tests: `tests/auto_cycle.test.js` (unit, fake clock),
  `tests/hil/hil_mixer_autocycle_test.mjs` (HIL).

### Deferred to the UI wave (not in scope here)

- CaptainPad: an AUTO toggle + delay / shuffle pills on the mixer channel strip
  (mirror the DeckTopBar autopilot button); `channelExtrasApi.setChannelAutoCycle`;
  `MixerChannel` type += `playlist.autopilot`. v2: a fade-on-advance for overlays.

---

## 6.u §F-undo — Mixer UNDO (round-2 #10, 2026-06-21, engine-side)

Undo the last DESTRUCTIVE mixer action — an operator safety net for "I didn't
mean to do that" on the playa. ENGINE-ONLY this wave; the CaptainPad UNDO
button is a follow-on.

### The mechanism (a bounded ring of full looks, restored via recallLook)

Undo is a bounded ring (`UndoStack`, `lib/undo_stack.js`, `UNDO_MAX = 10`,
oldest dropped) of full `captureLook()` snapshots taken BEFORE each destructive
mutation. Undo pops the most recent look and restores it via the proven,
never-dark `recallLook()` path — the same primitive snapshot recall uses. We
chose a ring of full looks over a command/inverse-op log because `recallLook`
already rebuilds the deck explicitly (never-dark) and re-registers every
overlay's CPC through the boot-identical `buildChannelFromSaved`→
`registerChannel` path; an inverse-op log would need a bespoke inverse per
route (un-delete-with-CPC, un-reorder, un-recall) — strictly more code + bug
surface for a live show. A captured look is plain serialized JS (no live WASM
handles), so holding `UNDO_MAX` of them is allocation-light; restore pays the
normal compile cost OFF the render hot path (same as an operator recall).

### Choke point (`pushUndo`) — STRUCTURAL mutations only

`function pushUndo(label)` is the single hook: it pushes
`{label, look: captureLook(), atMs}`, trims to `UNDO_MAX`, and broadcasts. It is
called BEFORE the mutation in each destructive route — but AFTER that route's
validation, so a 404/400/409 never leaves a phantom undo entry:

| Route | Label |
|---|---|
| `DELETE /mixer/channels/:id` | `delete '<id>'` |
| `POST /mixer/snapshots/:name/recall` | `recall '<name>'` |
| `POST /mixer/snapshots/:name/recall-fade` | `recall-fade '<name>'` |
| `POST /mixer/channels/reorder` | `reorder channels` |
| `POST /mixer/channels/:id/param-presets/:name/recall` | `param-preset '<name>'` |

Non-destructive, high-frequency writes (fader / hue / etc. PATCH) do
**NOT** push — undoing them is not what the operator wants and they would flood
the ring and bury the structural action. Undo scope is STRUCTURAL mutations
only. A future `/mixer/clear` becomes another `pushUndo` site.

### API

- `POST /mixer/undo` → empty ring ⇒ **400 `UNDO_EMPTY`** (fail loud, NOT a
  silent no-op — Codex P0). Else pop, `recallLook(popped.look)`, `saveAllState`,
  broadcast `mixer` + `undoState`, **200 `{status, label}`**.
- `GET /mixer/undo` → `{depth, top}` (top = most-recent label or `null`) for the
  UI button enable/label.
- `POST /mixer/redo` is DEFERRED to v2 (a redo stack needs invalidation on any
  new destructive op — a stale-redo footgun not worth it for v1).

### Morph-cancel race (CRITICAL)

If a recall-fade `_morph` is mid-flight when undo fires, the handler calls
`mixer.cancelMorph()` BEFORE `recallLook` — `cancelMorph` drops the morph
descriptor WITHOUT firing its completion finalizer (`onMorphComplete`), so the
finalizer can't fire its CPC-unregister/persist against the torn-down +
rebuilt state undo is about to install. The C (fading-out) channels the morph
would have removed are still present and `recallLook` tears them down and
rebuilds the captured look wholesale.

### Scope boundary (documented)

- **SESSION-ONLY**: the ring is in-memory and NOT persisted. An engine restart
  is itself a clean undo boundary (nothing sensible to undo back to across a
  reboot), and persisting would race the on-disk mixer state. Lost on restart
  by design.
- **LIVE mixer look only**: undo restores the live mixer state. It does NOT
  resurrect deleted snapshot / param-preset FILES on disk — those are separate
  libraries with their own delete routes. Undoing a snapshot DELETE is out of
  scope; undoing a snapshot RECALL (the live-look swap) is in scope.

### WS

One new type `undoState {type:'undoState', depth, top}`, routed to
`/ws/control` in `ws_topic_routing.js` (`TOPIC_BY_TYPE`; there is no default
topic — an unregistered type throws, and the unit + HIL pins guard the table).
Broadcast on every push + every undo, and replayed on `/ws/control` connect
(like autopilot) so a late-joining CaptainPad paints its UNDO button without
waiting for the next change.

### Implementation map (this wave)

- `lib/undo_stack.js` — pure `UndoStack` ring (push/pop/depth/topLabel/isEmpty,
  cap trim, loud validation). `UNDO_MAX = 10`.
- `lib/api_server.js` — `undoStack` instance, `pushUndo` / `broadcastUndoState`,
  `pushUndo` wired into the 5 destructive routes, `POST`/`GET /mixer/undo`,
  morph-cancel in the undo handler, `undoState` connect-replay.
- `lib/ws_topic_routing.js` — `undoState → CONTROL`.
- Tests: `tests/mixer_undo.test.js` (ring + capture-detachment),
  `tests/hil/hil_mixer_undo_test.mjs` (delete/recall/reorder undo end-to-end,
  empty→400, non-destructive-no-push, deck never dark), routing pins updated.

### Deferred to the UI wave (not in scope here)

- CaptainPad: a global UNDO button (enabled iff `depth>0`, labeled with
  `top`), `GET /mixer/undo` on mount + `undoState` WS to keep it live.
- `POST /mixer/redo` (v2).

---

## 6.o §deck-overlays — Deck dynamic view overrides (2026-06-21, engine-side)

Layered, view-scoped overlay decks composited OVER the main deck. Each overlay
owns its own VIEW + its own PLAYLIST/cursor/content, blended over the deck
within its view, stacked + reorderable, with an auto accent color. ENGINE-only
in this wave (UI follows). REUSES the overlay-channel + blend + view-mask
machinery — it is NOT a deck-local stack.

### Model

`PatternMixer.deckOverlays = []` lives beside `deckChannel` / `mixerChannels`.
A deck overlay IS a `PatternChannel` (same construction path as a mixer
overlay). Per layer: `id`, `viewSelection` (REQUIRED, validated, never an
all/whole-rig selection), `playlist`, `mode` (`blend_screen` default; only
`blend_screen | blend_add | blend_over` — `trans_*` excluded), `enabled`,
`fader`, `faderMax`, `color` (auto accent), `hue`. Order = array index:
`deckOverlays[0]` = bottom, `deckOverlays[last]` = top.

- Cap: `DECK_OVERLAY_MAX = 4` (exported from `pattern_mixer.js`). A 5th add is
  rejected **400 `DECK_OVERLAY_OVER_CAP`** at the API; `addDeckOverlay` also
  throws as a belt-and-braces fail-loud.
- Auto accent color: `DECK_OVERLAY_COLOR_SWATCHES` (engine-side 8-swatch
  palette constant — the CaptainPad swatch list is UI-only). `addDeckOverlay`
  cycles it, skipping any color in use by a sibling overlay or the main deck so
  adjacent layers never collide. A restored overlay keeps its saved color.
- `add/remove/reorder` mirror `addMixerChannel` / `removeMixerChannel` /
  `reorderMixerChannels`: cap check, mask compile (`recompileChannelMask` →
  `compileViewSelectionMask`), handle destroy on remove, and a permutation
  validation that **THROWS** on a bad set (length / dup / membership). The
  reorder is a single atomic array reassignment of the same objects (handles,
  masks, color all preserved by reference).

### Compositing (renderAll6ch — into `deckBuffer`)

After the deck channel renders into `deckBuffer` (with its PFL blackout) and
BEFORE the deck-swap inactive-sibling block, the overlays composite bottom→top
INTO `deckBuffer` (NOT `mixerBuffer` — that feeds the other side of the
deck/mixer crossfade). Per overlay: an effective-fader gate (`enabled ?
min(fader, faderMax) : 0`) + skip-dark (`effFader <= 0.001`); render into the
reused `channelBuffer`; per-overlay hue (`applyHueShift6chU8`, gated on
non-zero); `renderBlend6ch(getBlendHandle(mode), …, deckBuffer, channelBuffer,
effFader)`; then `commitBlendedLayerWithMask(deckBuffer, blended,
overlay.compiledPixelMask, …)`. The composited `deckBuffer` then feeds the
EXISTING `lerp(deck, mixer, viewFader)` + `applyMaster` UNCHANGED — so the
deck/mixer crossfade, blackout, and grand-master all still apply uniformly.
Reuses the existing scratch buffers (`channelBuffer` / `blendedScratch`) — NO
new per-frame allocation. Overlays do NOT receive the deck PFL blackout (that
applies to the deck channel only); they preserve the background exactly like
mixer overlays.

### Never-dark (mission rule)

Pixels OUTSIDE every overlay's view stay EXACTLY at the `deckChannel` value —
`commitBlendedLayerWithMask` leaves unselected pixels untouched, so the
exterior the deck covers can NEVER be blacked out by overlays. WITHIN a chosen
view the operator's selected overlay + mode governs and MAY dim (`blend_over`
is a lerp) — that is intended operator override and acceptable. Structural
guard: a `viewSelection` that compiles to `all`/whole-rig/empty is REFUSED
(`addDeckOverlay` and PATCH of `viewSelection` throw / return **400
`DECK_OVERLAY_VIEW_REQUIRED`**), so no overlay can ever target everything. The
unit assertion "no pixel below deck" is scoped to the monotone modes
(`blend_add` / `blend_screen`); for `blend_over` the assertion is only that
pixels OUTSIDE the view are untouched.

### Unique view per overlay (REFINEMENT)

At most one overlay per view. `addDeckOverlay` and a `viewSelection` PATCH
REJECT (**409 `DECK_OVERLAY_VIEW_TAKEN`**) if another overlay already targets an
equivalent selection — compared via the normalized `{type, target, invert}`
tuple (`deckOverlayViewTaken`).

### Shared / matching auto-advance timer (REFINEMENT)

Each overlay owns its OWN playlist + cursor + content, BUT the auto-advance
TIMERS are SYNCHRONIZED across all deck overlays: ONE shared clock — a single
anchor (`PatternMixer._deckOverlayAnchorMs`, transient) + a single shared delay
(`PatternMixer.deckOverlayAutopilot = {active, delay_s, shuffle}`) for the whole
group, NOT an independent per-overlay anchor. When the shared timer crosses its
delay boundary EVERY auto-advancing overlay advances its OWN cursor at the same
instant (each to its own next entry, honoring the shared `shuffle`). An overlay
may be individually paused via its own `enabled` flag — a disabled overlay does
not advance, but the shared cadence is unaffected so the others stay in step.
Driven from the SAME render-loop `beforeFrame` hook as the per-channel
`autoCycleTick` (`api_server.deckOverlayAutoCycleTick`), wired in `engine.js`
right after `autoCycleTick` — one source of time (the wall clock). Advances are
dispatched off the hot path via `setImmediate` (overlay `loadPlaylistEntry` is a
50-200ms hard handle swap) with a per-overlay in-flight guard; a compile error
is logged loudly and the overlay keeps its pattern (Codex P0). Set the shared
cadence with **`POST /deck/overlays/autopilot {active?, delay_s?, shuffle?}`**
(`delay_s` validated by `validateAutoCycleDelay`).

### Shared globals (REFINEMENT)

Deck overlays are subject to the SAME globals as the main deck — the GLOBAL
PARAMS (speed / size / colors / BPM / macros) and the GLOBAL EFFECTS (global
hue, global invert). Confirmed in code two ways:
1. **Params / clock:** overlays tick via `overlay.beginFrame(wasmHost,
   elapsedSeconds, true, this._effectiveSpeed(overlay))` in `PatternMixer.
   beginFrame` — the SAME global `elapsedSeconds` and `_effectiveSpeed`
   pipeline as the deck and mixer overlays. There are NO per-overlay isolated
   globals.
2. **Global effects:** global hue / invert / macros run POST-composite on
   `model.pixels` in `engine.js` (`applyHueShift` / `applyInvert` /
   `applyMacros`) AFTER `renderAll6ch()` returns. Because overlays are
   composited INTO `deckBuffer` BEFORE that pass, the global effects apply to
   overlays automatically.

### Persistence (across restart)

Overlays + the shared autopilot cadence serialize into `deck_state.yaml`
(`overlays: [...]` via `serializeChannel`, `overlayAutopilot: {active, delay_s,
shuffle}`) in `saveDeckState`'s `extras`. The boot restore loops
`deckState.overlays` → `buildChannelFromSaved(saved, 'deckOverlay', …)` +
`loadPlaylistEntry` (mirroring the mixer restore loop), then restores
`deckOverlayAutopilot` (delay floored to 1s). An old file without `overlays`
loads to `[]` (documented default, no fallback); the transient shared anchor
stays `null` and re-seeds on the first active tick.

### API surface (mirror mixer routes, fail loud)

- `GET /deck/overlays` — `{ overlays: [serializeChannel], overlayAutopilot }`.
- `POST /deck/overlays { viewSelection(REQUIRED), playlist|pattern, mode,
  enabled }` → add (auto-color, `loadPlaylistEntry`); cap (400 OVER_CAP),
  unique view (409 VIEW_TAKEN), all/empty view (400 VIEW_REQUIRED).
- `PATCH /deck/overlays/:id { mode, fader, enabled, faderLocked, faderMax,
  color, hue, viewSelection, pattern }` — role guard rejects the deck id and
  any mixer-overlay id (`WRONG_ROLE`); a `viewSelection` change re-checks the
  never-dark + unique-view rules.
- `DELETE /deck/overlays/:id` — frees the WASM handle.
- `POST /deck/overlays/reorder { order }` — permutation (400 REORDER_BAD_SET).
- `POST /deck/overlays/:id/playlist` + `/playlist/entry` — swap playlist / load
  an entry.
- `POST /deck/overlays/autopilot { active?, delay_s?, shuffle? }` — the SHARED
  cadence (one timer for the group).

Validators reused: `validateViewSelection`, `VALID_CHANNEL_BLEND_MODES` /
`isValidBlendMode` (trans_* excluded for overlays), `validateFader`,
`validateHue`, `validateAutoCycleDelay`.

### WS / broadcast

`serializeDeckState` folds `overlays: [...]` + `overlayAutopilot` into the
existing `deck` message — existing `deck` subscribers get them free, NO new WS
type. `broadcastDeckState()` fires on every overlay mutation.

### Implementation map (this wave)

- `lib/pattern_mixer.js`: `DECK_OVERLAY_MAX`, `DECK_OVERLAY_COLOR_SWATCHES`,
  `deckOverlays` + `deckOverlayAutopilot` + `_deckOverlayAnchorMs` fields,
  `getDeckOverlays` / `getDeckOverlay` / `deckOverlayViewTaken` /
  `_pickDeckOverlayColor` / `addDeckOverlay` / `removeDeckOverlay` /
  `reorderDeckOverlays` / `setDeckOverlayViewSelection`, the compositing loop in
  `renderAll6ch`, the `beginFrame` overlay tick, `setModelViewMasks` +
  `destroy` extended.
- `lib/api_server.js`: the `/deck/overlays*` routes, `deckOverlayAutoCycleTick`,
  `serializeDeckState` + `saveAllState` extension, `buildChannelFromSaved`
  `deckOverlay` role + the boot restore loop, `import { DECK_OVERLAY_MAX }`.
- `engine.js`: `deckOverlayAutoCycleTick` wired into the `beforeFrame` hook.
- Tests: `tests/deck_overlays.test.js` (15 unit tests),
  `tests/hil/hil_deck_overlays_test.mjs` (self-contained HIL).

---

## 7. Discrepancies / follow-ups

- **`docs/19_playlists.md` §8.3 / §3.2 mark mixer-channel playlist routes as
  "Future."** They are now implemented: `GET`/`POST /mixer/channels/:id/playlist`,
  `POST /mixer/channels/:id/playlist/entry`, plus `/swap`, `/capture`, and
  `/discard`. `19_playlists.md` was not edited (out of this doc's additive
  scope); this is a documentation lag to reconcile, not a code bug.
- **`docs/18_marsin_mixer.md` §7 lists `POST /mixer/base` and
  `POST /mixer/channels/:id/pattern`** as the transition/pattern-change routes.
  The as-built channels surface drives pattern changes through the
  playlist-entry + swap routes documented here; treat `18`'s §7 as the original
  design intent, not the current API.
- The deck swap soft-transition watchdog in `PlaylistPanel.tsx` is ~8s; the
  `transition.durationMs` clamp ceiling is 30000 ms. A deck transition
  configured above ~8s would let the watchdog clear the pending-gate before the
  fade completes. Not observed as a problem at default durations; flagged for
  whoever tunes long fades.

---

## 6.zb §F-tempo-source — sticky OSC/TAP switch + source-side smoothing (2026-06-30)

Supersedes §6.za. The 12 s auto-revert made the source flap OSC↔TAP whenever a
tap landed or OSC liveness blinked, and the deadband let the applied tempo
differ from the OSC readout. The operator's rule is now a **sticky switch**:
*"the OSC/TAP selection decides which BPM the whole system uses, and it stays
put until you change it."*

**Sticky source preference.** `mixer.tempoSourcePref` ('osc' | 'tap'), persisted
in `mixer_state.yaml`, restored at boot, and on every `serializeMixerState`
broadcast (so deck + mixer always agree — one source of truth, no per-surface
guess).

| pref | behavior |
|---|---|
| `osc` (default) | `mixer.tempoBpm` = the RAW live OSC bpm, verbatim (clamped [20,400], no deadband). A brief OSC dropout reads `tempoSource:'held'` while the selector STAYS on OSC — it never flips to TAP. |
| `tap` | OSC auto-follow fully suppressed; the tapped tempo holds indefinitely. |

- A manual tap (`POST /mixer/tempo`) sets pref→`tap` (you're hand-driving). "Use
  OSC" (`POST /mixer/tempo/sync`) and the explicit `POST /mixer/tempo/source
  {source}` set the pref directly. `clearOverride()`/`noteManualTap()` just flip
  the sticky pref — there is no time window any more.
- **`tempoSource`** (live status, for the accent) = `'osc'` (selected+live) /
  `'manual'` (pref tap) / `'held'` (pref osc, OSC stale). **`tempoSourcePref`**
  (the selector highlight) = the sticky `'osc'`/`'tap'` — does NOT flap.

**Stability lives at the source, not in a deadband.** The Audio Companion (a)
EMA-smooths `audioBpm` (`lib/bpm_smoother.js`, τ 250 ms) IN PLACE before the UI
frame AND the OSC emit read it, and (b) rounds to an integer at emit
(`bpm_emit.js`). So the Companion UI, the OSC packet, CaptainPad's OSC BPM, and
`mixer.tempoBpm` all show ONE identical integer. Config:
`config.yaml companion.bpmSmoothing {enabled,tauMs}` (default on). An optional
engine-side replica (`config.yaml tempo.oscBpmSmoothing`) is **default off** —
the Companion already smooths; enable only for a jumpy non-Companion sender.

**Single-source `audioBpm` (the "jumpy OSC" fix).** When the engine runs its OWN
local analyzer (`audio/signals/derived_signals.js`, write-source
`'derivedSignals'`) alongside the Companion, both write the same `audioBpm` CPC
key — one raw, one smoothed — and the arbiter followed whichever wrote last,
flickering the tempo. `TempoArbiter._onChange` now **ignores `audioBpm` whose
ParamCenter `lastSource === 'derivedSignals'`** and follows only the
OSC/Companion value (`'osc'`); test/api injection still works. This also
stabilizes `bpm_speed_sync` (it maps the arbitrated `mixer.tempoBpm`).

**Touched.** `lib/tempo_arbiter.js` (pref + raw-apply + source filter, deadband
removed), `lib/bpm_smoother.js` (new), `lib/pattern_mixer.js`
(`tempoSourcePref`), `lib/state_manager.js` (persist), `lib/api_server.js`
(`POST /mixer/tempo/source`, `tempoSourcePref` in broadcasts + tempo responses,
restore), `audio/companion/{companion_server,bpm_emit}.js` (smooth+round),
`config.yaml` (`companion.bpmSmoothing`, `tempo.oscBpmSmoothing`). CaptainPad:
`hooks/use_tempo_tap.ts` (`sourcePref`, `setSource`), `components/CPCControls.tsx`
(selector highlights sticky pref), `utils/channelExtrasApi.ts`
(`postTempoSource`), `app/(tabs)/audio.tsx` (single-source on `audioBpm`).
Tests: `tempo_arbitration.test.js` (31), `bpm_smoother.test.js` (10),
`companion_bpm_emit.test.js`, HIL `hil_tempo_arbitration_test.mjs`.

### Mixer-group persistence in saved looks (2026-06-30)

`SnapshotManager.save` rebuilt the on-disk look from `{master,deck,channels}` and
silently dropped `mixGroups` — so a recalled view kept the per-channel
`mixGroupId` pointers but lost the group registry, and the gang-faders vanished.
`save()` now persists `mixGroups` (empty array when none); `load()` returned it
verbatim already and `recallLook`/`morphToLook` already restore the registry, so
groups (faders + membership) now round-trip capture → save → recall.
