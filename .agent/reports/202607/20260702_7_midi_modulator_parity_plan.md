# MIDI mapping → modulator parity — implementation plan (Sina's concrete design)

**Date:** 2026-07-02 · **Author:** Fable (read-only investigation → plan)
**Branch:** `feat/captainpad-midi-control`, tip `1e878d77`
**Inputs:** report `20260702_6` (same tip), docs/34, Sina's concrete design (relayed
2026-07-02), and the code — every claim about current behavior carries file:line.

**Sina's north star (verbatim):** "I want the APC mini mostly similar to modulators —
allow overriding the global midi mapping, and showing all midi mapping like all of the
modulators, and saving the data with the playlist like the modulators again. All like the
modulator which works really good!" MFT bank-2 knobs: "similar to modulators again."

**The concrete design this plan targets:**
- **Deck:** unchanged.
- **APC mini:** one consistent surface. Columns 1-4 = four **assignable mixer
  channels** (8 pads = that channel's playlist navigation, track button = focus that
  channel + LED, fader = that channel's level); the channel→column assignment is
  assignable and **saved with the playlist**. Columns 5-8 = globals as before
  (colors/speed/master/etc — current roles kept).
- **MFT:** default 16 knobs = focused pattern's local params in order (current
  behavior); **full per-pattern override** (pin params to knobs, saved with the entry);
  **color overflow** — patterns with <16 local params fill the remaining knobs with
  color/global params ("the MFT turns on or off the colors"); **live ring values** —
  rings show the post-modulator live value (reverses Wave-1 #6 / D-2); the knob still
  edits the base.

---

## 0. DECISIONS LOCKED (Sina, 2026-07-02) — these override the plan body where they conflict

Four forks were put to Sina; his answers below are authoritative. Where the plan
body (written before these answers) assumed otherwise — notably the "unified APC"
reading — **this section wins** and the affected packages are re-scoped here.

**A1 — column layout is CONTEXT-AWARE, not unified (supersedes §"unified APC").**
The APC columns 1-4 behave differently per active CaptainPad tab:
- **Deck view:** column 1 = the DECK (its focus button + fader + nav pads);
  columns 2-4 = **disabled** (dark LEDs, no focus/fader/nav).
- **Mixer view:** columns 1-4 = mixer channels 1-4 (default; still per-set
  reassignable via `midiSurface.columnChannels`, modulator-style).
- Columns 5-8 = globals (colors/speed/master/etc) — **identical in both views**
  (this is what preserves muscle memory and answers report-6's context-divergence
  concern: only the left half switches, the global half never moves).
- **Plan delta:** the deck/mixer `context` machinery (today vestigial — both tabs
  alias one YAML anchor) must become REAL, but MINIMALLY: two contexts that differ
  ONLY in columns 1-4; columns 5-8 shared. W2 owns this. The column-resolution
  layer must key on active context. A disabled column (deck-view 2-4) is a first-
  class state: dark LED, fader/pads inert, not merely "unassigned."

**A2 — color-overflow knobs: TURN = hue (wrap), PUSH = on/off** (ring dark when
off). Confirmed as Fable proposed. W3 owns; the exact color param set is a bench
feel item.

**A3 — override reach: FIXED controls stay hardcoded (D-B2 = NO).** The APC
fader-7 (speed) and MFT bank-2 knobs 1-3 (speed/size/rotate) are NOT re-targetable
by a per-set override. **Plan delta:** `playlist.midiOverrides` is NARROWER than
the plan body assumed — it covers only the genuinely-assignable surface (mixer-view
column→channel assignment, per-pattern MFT knob pinning, bank-2 knobs 4-16
assignment). It does NOT re-map the fixed/muscle-memory controls. Resolution order
stays learn > entry binding > override > profile, but the fixed controls have no
override tier. Simpler W1/W4.

**A4 — SEQUENCING: hardware bench FIRST, then build.** Sina runs the report-5
MFT+APC bench pass on the ALREADY-SHIPPED Wave-1/2 work before this build starts;
anything it surfaces gets fixed first. **No build package below starts until the
bench pass is reported.** (W1 + W6 are pre-bench-safe if a head start is ever
wanted, but the default per Sina is: bench, fix, then build.)

---

## 1. The modulator system — the template to copy

### 1a. Engine side

| Piece | Where | What it does |
|---|---|---|
| CRUD routes | `marsin_engine/lib/api_server.js:3344-3453` — `PUT/PATCH/DELETE /api/playlists/:name/items/:itemId/modulations/:mappingId` | Load playlist → validate incoming (`validateModulationMapping`) BEFORE mutating (`:3395-3396`) → mutate entry array → `playlistManager.save()` (strict re-validation) → `finishOk` |
| Post-save fanout | `api_server.js:3370-3380` (`finishOk`) | Broadcasts `{type:'playlistSaved', name}`; IF the mutated entry is the deck's active entry, re-pushes mappings to the controller (`pushActiveEntryToModulation`, `:390-413`) |
| Context push sites | `api_server.js:909-912`, `:1146-1148`, `:3376`, `:3639-3644`, `:4332-4336` | Push-driven; the hot loop never touches disk |
| Persistence | `playlist_manager.js:146` (lenient load via `_coerceModulations` `:246-269` — invalid mapping dropped w/ warning), `:176-188` (strict save — throws) | Modulations ride the playlist ENTRY (`entry.modulations`) in `playlists/<name>.yaml` |
| Runtime + broadcast | `modulation_controller.js:66-71` (`setActiveEntry`), `:79-180` (`applyFrame` → throttled 20 Hz `modulationState` broadcast `:174-179`, guaranteed final empty frame on >0→0 `:161-172`) | Engine-as-truth live state for the iPad ghost |
| Validator + shape | `modulation_engine.js:290-346`; typedef `:62-71` | `{ id, type:'continuous', enabled, source:{scope:'cpc', key}, target:{scope:'pattern', parameter}, mode, polarity, range:[min,max] ∈[-4,4] (:101-102), curve }` |

### 1b. Client side

| Piece | Where | What it does |
|---|---|---|
| **Show-all panel** | `CaptainPad/components/AllModulationsPanel.tsx` | Modal + FlatList of entries that HAVE modulations (`:138-141`). Per-entry card: label + ACTIVE + ● LIVE dot (`:223-235`) + CLEAR ALL (`:238-254`; parallel DELETE fanout `:193-199`). Row (`ModulationRow` `:412-502`): enabled dot, `target ← source`, mode badge, range, curve. **Tap row → navigate deck to the entry AND open the editor** (`:164-171`); long-press → enable/disable PATCH (`:173-177`); trash → delete, **no confirm** (`:179-186`). Footer totals `:376-389`. Data: fetch on open + `playlistSaved` re-fetch (`:104-132`) |
| Panel trigger | `app/(tabs)/index.tsx:491-508` (◎ ALL pill), mount `:533-538` | |
| Per-param affordance | `Modulation.tsx:343-523` (`ModulatedSlider`): ◎ badge row (`:158-233` — ◎ ON pill, `!` override badge, ✕ one-tap clear), range band `:313-341`, ghost `:246-275` | One tap opens the editor; one tap clears |
| Editor popover | `Modulation.tsx:758-1260`: live source trace, engine-mirrored transfer curve (`:595-627`), chips, SAVE/CANCEL/REMOVE `:1214-1255`, stable-id PUT/PATCH `:844-868,950-952` | Save = one HTTP call; playlist persistence is the same act |
| API wrappers | `utils/api.ts:1786-1843`, types `:1747-1778` | |
| State hooks | `Modulation.tsx:52-67` (`useModulationState`), `:71-85` (`useEntryModulations`) → shared `useEntryBindings` (`MidiMap.tsx:36-76` — cached fetch + `playlistSaved` re-fetch) | Already shared by both systems |
| Mixer read-only | `mixer.tsx:35,90` | |

### 1c. Why the modulator UX "works really good" (properties to preserve)

1. **One-tap add from where you already are** (the ◎ badge on the param row).
2. **CRUD = persistence** — every SAVE/REMOVE writes the playlist file; no separate
   save step, nothing to lose.
3. **One show-all surface** — everything wired in the playlist is visible, editable,
   toggleable, deletable in one panel, with tap-through to the entry.
4. **Multi-client sync for free** — every mutation broadcasts `playlistSaved`.
5. **Live truth on screen** — the UI paints only what the engine reports.
6. **Delete is cheap and unconfirmed** — recreating is one tap.

---

## 2. Current state vs the target design — verified facts + gaps

### 2a. What already exists at parity (built as a mirror — `midi_mapping_engine.js:2-6`)

- **Per-entry param-binding CRUD**: routes `api_server.js:3465-3553`; upsert-by-target
  `playlist_manager.js:403-415`; lenient-load `:274-297` / strict-save `:189-203`;
  validator `midi_mapping_engine.js:31-74`; wrappers `api.ts:1889-1950`; learn popover
  `MidiMap.tsx:138-320`; ⊞ badge `MidiMap.tsx:91-124` on deck (`Modulation.tsx:424-428`)
  and mixer (`mixer.tsx:24,105`). Saves with the playlist, broadcasts `playlistSaved`.

### 2b. Verified current-state facts the design lands on

| Fact | Evidence |
|---|---|
| APC pad columns 1-4 are ALREADY per-channel playlist browsers for **layers 0-3** (scroll down/up + 6-slot window select) | `apc_mini_mk2.yaml:73-126` (`playlistScroll`/`playlistWindowSelect` layer 0..3) |
| But faders stop at 3 channels: faders 1-3 → `mixerLayerFader` layers 0-2; fader 4 is in the learn pool | `apc_mini_mk2.yaml:32-44` |
| And track buttons stop at 3: notes 100-102 → `focusChannel` layers 0-2; track button 4 (note 103) is unmapped | `apc_mini_mk2.yaml:60-71` |
| Columns 5-8 pads = palette pairs; scene column = blackout + GE slots 1-7; fader 7 = global speed, fader 9 = master | `apc_mini_mk2.yaml:128-178,45-50` |
| A "layer" resolves **by array order with a context branch**: deck tab → layer 0 = deck channel; mixer tab → layers = `engine.mixerChannels` in order | `dispatch.ts:32-48`; `useMidiControl.ts:470-527` (`:519-527` stale-focus reset) |
| Channel ids are runtime-generated `ch_<Date.now()>` | `api_server.js:296` |
| MFT knob order is pure declaration order: kind===1, not `cpcOwned`, numeric v0 | `knob_order.ts:83-101`; consumed by runtime (`useMidiControl.ts:558` region) AND the KNOB N badges (`knob_badge.ts`) — one derivation |
| MFT ring shows the **base**, not the live value: `getFocusedExportValue` returns `exp.base ?? exp.v0` ("#6, decision D-2" comment) | `manager.ts:991-999` |
| Ring pulse for modulated params is separate and stays | `led_projector.ts:271-286` (`getFocusedExportModulated` → `RGB_PULSE_1_BEAT`) |
| Pickup/anchor math ALSO anchors on `base ?? v0` — these are different call sites from the ring display | `manager.ts:724-726` (flush snap anchor), `:903` (pickup) |
| Color params are kind-6 hsvPicker exports (h=v0, s=v1, v=v2) | `GlobalParams.tsx:90`; `playlist_manager.js:343-348` |
| MFT bank-2: knobs 1-3 → CPC speed/size/rotate; knobs 4-16 (CC 19-31) reserved/unmapped | `mft.yaml:144-154` |
| MIDI tab has no mapping editor ("a follow-up") | `app/(tabs)/midi.tsx:34-40` |

### 2c. Parity matrix (modulator capability → MIDI equivalent → gap)

| Capability | Modulator mechanism | MIDI equivalent to build | Gap today |
|---|---|---|---|
| Show-all list | `AllModulationsPanel.tsx` + ◎ ALL (`index.tsx:491-508`) | **`AllMidiMappingsPanel`** (clone) + ⊞ ALL + MIDI-tab embed | Nothing exists; profile layout visible nowhere at runtime |
| Add / edit / delete / toggle, no-confirm delete, CLEAR ALL | popover PUT/PATCH/DELETE + panel rows | per-entry: **exists** (`MidiMap.tsx`); from a list view: missing; ✕ quick-clear on the ⊞ badge: missing (◎ has it, `Modulation.tsx:208-230`) | Partial |
| Per-entry save-with-playlist | `entry.modulations` | `entry.midiMappings` — **exists** | None |
| **Channel→column assignment, saved with playlist** | *(no direct analogue; nearest: playlist-scoped data + CRUD + `playlistSaved`)* | **NEW `midiSurface.columnChannels` on the deck playlist root** (§3.1) + column-based layer resolution | Columns are implicit array order + a ctx branch; only 3 of 4 columns have fader/focus |
| **MFT per-pattern knob override** | per-entry array, edited in-place, saved with entry | **NEW `entry.knobOrder`** (§3.2) + `deriveKnobOrder` override arg | Declaration order only, no pinning (report-6 G2 — now confirmed as M2) |
| **Color overflow on unused knobs** | *(no analogue — derivation change)* | `deriveKnobOrder` fill stage + hsv knob action kinds (§3.2/§4.3) | Knobs beyond the slider count are dead |
| **Override the global mapping (bank-2 assign etc.)** | playlist-scoped data mirroring the modulation shape | **NEW `playlist.midiOverrides`** (§3.3) + CRUD cloned from `api_server.js:3465-3553` | Static YAML only (`useMidiControl.ts:64-65`); bank-2 knobs 4-16 dead |
| Live state on the hardware | `modulationState` → ghost slider | **Ring shows live v0** (§3.4 — reverses D-2); no new WS topic (param broadcasts are already the truth) | Ring shows base today (`manager.ts:996-999`) |
| Multi-client sync | `playlistSaved` → `useEntryBindings` re-fetch | Same bus/hook for all three new stores | None |

---

## 3. Data model — three persisted stores + one revert (all modulator-style)

**Seam guardrail (unchanged):** the engine stays persistence-only for ALL of this. It
stores, validates, saves, and rebroadcasts; the render loop never reads any of it (same
amended non-goal as midiMappings, docs/34:236-241). All application lives in
CaptainPad's manager. The engine control path sees zero new verbs — every new binding
resolves to action shapes the dispatcher already handles (`dispatch.ts`).

### 3.1 Channel→column assignment — `midiSurface` on the DECK playlist root

```yaml
# playlists/<name>.yaml — new OPTIONAL root key (sibling of entries)
midiSurface:
  columnChannels:            # APC columns 1-4, in order; exactly 4 slots
    - { ref: deck }          # column 1 → the deck singleton (see D-A1)
    - { ref: channel, id: ch_1751234567 }
    - { ref: playlist, name: rooms }   # resilient alternative ref (see below)
    - null                   # column dark
```

- **Which playlist:** the playlist loaded on the DECK — it is the natural "set file"
  (per Sina: "saved with the playlist"), the same source the ⊞ flow already keys off
  (`index.tsx:536`). Load a different set → its surface layout loads with it. No
  playlist on deck → today's default (array-order layers).
- **Channel identity is the design's weak point:** overlay ids are `ch_<Date.now()>`
  (`api_server.js:296`) — stable across engine restarts (mixer state persists) but NOT
  across delete/recreate. Mitigation, mirroring `_missing` entries
  (`playlist_manager.js:150`): a dangling `id` renders the column DARK + a named grey
  row in the show-all panel (loud, P6), never a silent re-target. The optional
  `{ref: playlist, name}` form ("the channel currently playing playlist X") is offered
  as the resilient alternative; **recommend shipping `id` + dark-on-dangle first**
  (simplest truthful behavior) and letting the bench decide if playlist-ref is needed.
- Engine: `validateMidiSurface()` (shape: ≤4 slots, ref enum, id/name strings) in
  `midi_mapping_engine.js`; lenient-load/strict-save threading in
  `playlist_manager.js` `load()`/`save()` (`:123-127`, `:162-214`); one route
  `PUT /api/playlists/:name/midi-surface` (body = whole block — it's 4 slots, CRUD per
  slot is overkill) → `save()` → `playlistSaved`.
- Client resolution: `getLayer(column)` stops being "array index + ctx branch"
  (`useMidiControl.ts:470-527`) and becomes "resolve `columnChannels[column]` against
  the live engine snapshot" — deck ref → deck channel (role 'deck', existing
  `MidiLayerRef` shape, `dispatch.ts:32-44`); channel ref → matching overlay; dangling
  → null (inert, `dispatch.ts:88-89` already handles). Focus
  (`focusChannel`/`FocusedChannel`, `manager.ts:147-171`, single intent writer
  `:643-649`) extends from 3 layers to 4 columns; still ONE shared focus that the MFT
  sculpts (SELECT→SCULPT unchanged).

### 3.2 MFT per-pattern knob override + color overflow — `entry.knobOrder`

```yaml
# on a playlist ENTRY, beside defaults/modulations/midiMappings
knobOrder: [sliderIntensity, sliderSpeed, hsvPickerA]   # pinned first, in order
```

- Semantics: pinned names first (knobs 1..k), remaining learnable sliders in
  declaration order, **then the overflow fill** (below) into any knob still empty.
  Stale names (pattern changed) are skipped with a warning at load — lenient-load /
  strict-save exactly like `defaults` (`playlist_manager.js:141-151`, `:189-203`).
- `deriveKnobOrder(exports, knobOrderOverride?)` (`knob_order.ts:83-101`) gains the
  override argument + a fill stage. Because the runtime AND the on-screen KNOB N
  badges consume the same derivation (`knob_order.ts:1-13`), the screens relabel
  themselves automatically — no second code path.
- **Color overflow (automatic, not persisted):** for each knob index ≥ (slider count),
  fill from: (1) the pattern's kind-6 hsvPicker exports (`GlobalParams.tsx:90`), one
  knob per picker; (2) then a curated CPC global list (the confirmed [0,1] keys —
  same set that gates bank-2, `mft.yaml:140-142`). The fill is derived per-pattern at
  focus time; `knobOrder` pinning may also name hsv params to place them explicitly.
- Engine route: `PUT /api/playlists/:name/items/:itemId/knob-order` (body
  `{knobOrder: string[]}`) → validate (array of non-empty strings, ≤16, unique) →
  `save()` → `playlistSaved`. (A dedicated route, not a generic entry PATCH, keeps the
  strict-save surface small — same pattern as the midi-mappings family.)
- **How a relative encoder drives an HSV param — proposal (open ambiguity #2, §7):**
  - **Primary proposal:** encoder TURN = **hue sweep** (v0, wrapping at 0/1 — hue is
    circular so an endless encoder is the natural control); encoder PUSH = **toggle
    the color on/off** — V (v2) toggles 0 ↔ last-non-zero (stashed in the manager's
    optimistic layer, engine echo confirms), which is exactly Sina's "turns on or off
    the colors". Ring = hue position; ring OFF (dark) when V is 0 so on/off state is
    visible on the hardware.
  - Alternative A: TURN = V (brightness) — makes the ring a brightness bar (more
    conventional ring read) but loses the hue sweep and makes push-toggle redundant.
  - Alternative B: TURN = hue, PUSH cycles S presets. More states, weaker "on/off".
  - Writes go through the existing hsv control path (`setChannelControl` h/s/v triple,
    `playlist_manager.js:375`) — new resolved-action kind(s) in the manager/dispatcher
    (`focusedColorDelta`/`focusedColorToggle`), CaptainPad-side only.

### 3.3 Global-mapping overrides — `playlist.midiOverrides` (bank-2 assignment et al.)

Unchanged from the pre-design draft; this is the store the bank-2 grid writes:

```yaml
midiOverrides:
  - id: ovr_knob19_glitter
    enabled: true
    control: { type: cc, channel: 0, number: 19, relative: true }   # MFT b2 knob 4
    target:  { scope: global, key: glitter }
    steps: [0.005, 0.02, 0.06]        # relative detent triple (optional)
  - id: ovr_fader5_fog
    enabled: true
    control: { type: cc, channel: 0, number: 52 }                    # APC fader 5 (learn pool)
    target:  { scope: global, key: fog }
    range: [0, 1]
```

- Shape mirrors `MidiMapping` (`midi_mapping_engine.js:42-54` control rules) + the two
  continuous action families (`relative`+`steps` XOR `range` — validator enforces).
  `target.scope:'global'`, `key` = CPC key, **no allow-list** (modulation-source
  philosophy, `modulation_engine.js:86-92`): picker offers live [0,1] schema keys
  (`useMidiControl.ts:399` `_schemaKeys`), a stale key no-ops loudly in the panel.
- One override per control AND per target key; friendly upsert (clone of
  `upsertMidiMapping`, `playlist_manager.js:403-415`) + strict save backstop.
- Routes: `PUT/PATCH/DELETE /api/playlists/:name/midi-overrides/:mappingId` — clone of
  `api_server.js:3465-3553` minus the items segment; `finishOk` → `playlistSaved`; no
  controller push (pure metadata, `:3454-3460`).
- Resolution order in the manager (`onMessage`, `manager.ts:560-591`): learn →
  per-entry learned binding (`:580`) → **NEW: playlist override** → profile
  (`:583`). Most-specific-wins, same logic as binding-first.
- **Muscle-memory guard (P7, docs/34:71-74):** two-tier control policy, enforced in the
  editor + capture path (the engine validator stays shape-only — it can't see YAML
  profiles): **SAFETY tier never overridable** — blackout (`apc_mini_mk2.yaml:147-150`),
  master (`:48-50`), focus track buttons (`:60-71`), scene/GE column (`:151-178`),
  channel faders/pads (cols 1-4), MFT side buttons (`mft.yaml:164-172`). **SCULPT tier
  overridable** — learn-pool faders 5/6/8 (post-§3.1 fader 4 becomes channel 4), any
  unclaimed control (bank-2 knobs 4-16, banks 3-4), and — decision D-B2 — fader 7
  (global speed) + bank-2 knobs 1-3. Overridden rows in the show-all panel MUST show
  the shadowed default (`FADER 7: GLOBAL SPEED → FOG`). Learn capture
  (`manager.ts:560-574`) and `midiControlConflict` (`useMidiControl.ts:291-297`) also
  refuse controls claimed by an active override.
- This supersedes report-6 M1's separate `GET/PUT /api/midi/global-assignments` store —
  one home (the playlist), per Sina's own ask; resolves report-6 open questions 1-2.

### 3.4 Live ring values — revert Wave-1 #6 / D-2 (exact change)

- `manager.ts:996-999`: the `getFocusedExportValue` closure returns `exp.base ?? exp.v0`
  today (comment "Show the value the KNOB edits… (#6, decision D-2)"). Change: return
  **`exp.v0`** (the engine's live, post-modulator value — the export the modulation
  controller writes every frame, `modulation_controller.js:129`).
- **Only the display changes.** The knob still edits the base: the flush anchor
  (`manager.ts:724-726`, `snapAnchor = exp.base ?? exp.v0`) and the pickup math
  (`:903`, `pickup(state, exp.base ?? exp.v0, value)`) are separate call sites and stay
  on `base ?? v0`. The delta-applies-to-base behavior (`:709-735`) is untouched.
- Ring pulse coexists: `led_projector.ts:271-286` already layers the modulated pulse
  (`getFocusedExportModulated` → `RGB_PULSE_1_BEAT`) independently of the position
  value — no change needed there beyond re-benching the visual.
- Update the stale comments at `manager.ts:991-995` and the docs/34 D-2 note (flag:
  this REVERSES a recorded decision — the docs must say so, not silently drift).

### 3.5 APC profile edits (YAML, reviewed in git — not runtime data)

- `fader_4` leaves the learn pool → `mixerLayerFader layer 3`; learn pool becomes
  faders 5/6/8 (`apc_mini_mk2.yaml:41-44` comment + `conflictMessage` copy at
  `useMidiControl.ts:303-313` and popover copy `MidiMap.tsx:267` say "4-6 or 8" —
  all three must change together).
- `track_4` (note 103) → `focusChannel layer 3` + LED (clone of `:60-71`).
- Pad columns 1-4 already correct (`:79-126`, layers 0-3). Columns 5-8 + scene column
  + fader 7/9 unchanged.

---

## 4. UI plan

### 4.1 `AllMidiMappingsPanel` — the show-all surface (mirror of `AllModulationsPanel.tsx`)

New `CaptainPad/components/AllMidiMappingsPanel.tsx`, cloned structurally from
`AllModulationsPanel.tsx` (Modal + backdrop + FlatList + footer, `:272-407`), violet
(`MIDI_VIOLET`, `MidiMap.tsx:27`). Four sections:

1. **SURFACE (columns 1-4)** — the four column slots: assigned channel (name +
   playlist), dangling refs in loud grey, tap → column-assign picker (§4.2).
2. **GLOBAL LAYOUT** — the loaded profiles' static controls as read-only rows (source:
   `_loadedProfiles`, `useMidiControl.ts:284`). SCULPT-tier rows carry OVERRIDE;
   overridden rows render `default → override` + ✕ revert (= DELETE the override).
3. **PLAYLIST OVERRIDES** — rows from `midiOverrides`: `control → target key`, enabled
   dot (long-press toggle PATCH), trash (no confirm — modulator convention,
   `AllModulationsPanel.tsx:179-186`), tap → `MidiOverridePopover`. Includes the
   **bank-2 knob grid**: a 4×4 face mirror; knobs 1-3 show profile defaults, 4-16 are
   "+ ASSIGN" slots; tap → popover pre-filled with `{cc, ch0, number:16+i,
   relative:true}` → pick a CPC key → SAVE. No learning needed — the control is known
   positionally.
4. **PER-ENTRY BINDINGS** — grouped by entry exactly like the modulation panel
   (`:201-268`): ACTIVE badge, CLEAR ALL, rows tap → navigate deck
   (`setChannelPlaylistEntry`, `:156-162`) + open the existing `MidiMapPopover`.
   Entry rows also show the entry's `knobOrder` pins ("KNOB 1 ← INTENSITY").

Data: one `fetchPlaylistByName` on open + `playlistSaved` re-fetch (`:104-132`) —
`midiSurface`, `midiOverrides`, and entries' `midiMappings`/`knobOrder` all arrive in
the same payload. Triggers: **⊞ ALL** pill beside ◎ ALL (`index.tsx:491-508` pattern);
embedded non-modal in the MIDI tab replacing the "editor is a follow-up" card
(`midi.tsx:30-41`).

### 4.2 Channel-assign affordance

- In the panel's SURFACE section AND on the mixer tab's channel strip header: an
  "APC col N" chip per channel; tap → pick column 1-4 (or clear). Writes the whole
  `midiSurface` block via the single PUT; `playlistSaved` re-syncs every client and
  the manager's column resolution.
- APC track-button LEDs keep meaning FOCUS only (single-source, one lit); column
  assignment is an iPad act, not a hardware gesture — no hidden chord modes (P7).

### 4.3 MFT knob override + color overflow config

- **Pin affordance where the operator already looks:** the on-screen param rows
  already carry KNOB N badges (`knob_badge.ts`, rendered in `GlobalParams.tsx:144-149`
  region). Long-press the badge (or a pin row in the ⊞ popover) → "PIN TO KNOB…"
  picker (1-16) → writes `entry.knobOrder` via the new route. The badges re-derive
  automatically because screens and runtime share `deriveKnobOrder`.
- Overflow knobs render on-screen too: the deck's color pickers + curated globals get
  their own KNOB N badges from the same derivation, so the operator can SEE which knob
  holds which color before touching the MFT.
- Ring feedback: overflow hsv knobs per §3.2 (hue position, dark when off); global
  overflow knobs same as bank-2 rings today.

---

## 5. Build breakdown — work packages (disjoint, D-style)

Contracts to freeze FIRST (Phase-0 style): **(C1)** the three persisted shapes +
validator error strings (`midiSurface`, `entry.knobOrder`, `MidiOverride`); **(C2)**
`api.ts` wrapper signatures (`putMidiSurface`, `putKnobOrder`,
`put/patch/deleteMidiOverride` — clones of `:1895-1950`); **(C3)** manager-snapshot
fields (`columns: MidiLayerRef[]`, `overrides: ResolvedOverride[]`, extended
`focused.exports` unchanged) + the resolution order (learn > entry binding > override >
profile); **(C4)** the `deriveKnobOrder(exports, override?)` signature + fill-stage
rules.

| WP | Scope | Owned files | Red-first tests | Harness |
|---|---|---|---|---|
| **W1 — engine stores** | 3 validators; playlist root + entry-key load/save/coerce; `upsertMidiOverride`; routes: midi-overrides CRUD, midi-surface PUT, knob-order PUT | `marsin_engine/lib/midi_mapping_engine.js`, `lib/playlist_manager.js`, `lib/api_server.js`, engine tests | validator matrices (shape, relative/range XOR, dual one-per rules, ≤4 columns, ≤16 unique knobOrder); lenient-load drops bad data w/o killing the playlist; strict-save throws; route round-trips broadcast `playlistSaved`; back-compat: files without the new keys load clean | node engine tests, zero hardware |
| **W2 — APC surface** | profile edits (§3.5); column-based `getLayer` resolution replacing the ctx branch (`useMidiControl.ts:470-527`); focus → 4 columns (`manager.ts:147-171,643-649`); dangling-ref dark-column; LED projection for col 4 + override targets | `midi_profiles/apc_mini_mk2.yaml`, `hooks/useMidiControl.ts` (layer builder), `utils/midi/manager.ts` (focus), `utils/midi/led_projector.ts`, tests | FakeTransport: fader 4 drives column-4 channel; track 4 focuses it (one LED lit); dangling ref → inert + dark; deck-ref column browses the deck playlist; profile validation passes (no overlapping claims, `profile.ts:388-391`) | vitest + FakeTransport |
| **W3 — MFT knobs + rings** | `deriveKnobOrder` override arg + overflow fill (pure); hsv knob action kinds (turn=hue wrap, push=V toggle) in manager/coalescer; ring revert §3.4 (`manager.ts:996-999` + comments); `entry.knobOrder` consumption in the hook | `utils/midi/knob_order.ts`, `utils/midi/manager.ts` (flush/rings), `utils/midi/knob_badge.ts`, `hooks/useMidiControl.ts` (threading), tests | pure: pin-first order, stale-pin skip, fill order (sliders→hsv→globals), 17th-slider reachable via pin; manager: hue wraps 0↔1, push toggles V and restores last value, ring value = live v0 while flush anchor stays base (two asserted separately!); pulse still set when modulated | vitest + FakeTransport |
| **W4 — client CRUD + overrides runtime** | api.ts wrappers (C2); override fetch + snapshot threading; `applyOverride` step in `onMessage` (between `:580` and `:583`); conflict-check extension (`manager.ts:563`, `useMidiControl.ts:291-297`); learn-pool copy fixes ("5/6/8") | `utils/api.ts`, `hooks/useMidiControl.ts`, `utils/midi/manager.ts` (resolution), `components/MidiMap.tsx` (copy) | absolute override drives CPC write; relative override accumulates deltas; entry binding beats override beats profile; learn rejects override-claimed control; override vanishes when deck playlist unloads | vitest + FakeTransport |
| **W5 — show-all panel + editors** | `AllMidiMappingsPanel` (4 sections + bank-2 grid), `MidiOverridePopover`, column-assign picker + mixer-strip chip, pin-to-knob affordance, ⊞ ALL trigger, MIDI-tab embed, ✕ quick-clear on ⊞ badge | `components/AllMidiMappingsPanel.tsx` (new), `components/MidiMap.tsx`, `components/GlobalParams.tsx`, `app/(tabs)/index.tsx`, `app/(tabs)/midi.tsx`, `app/(tabs)/mixer.tsx` | pure row-formatting helpers unit-tested; rest manual/visual | Expo web + Chrome Web MIDI |
| **W6 — relative-CC learn guard** (report-6 M4, independent) | pattern-scope learn rejects relative delta codes loudly | `utils/midi/learn.ts`, `utils/midi/manager.ts` (`:560-574`), tests | capture of a decodable relative code → named rejection | vitest, zero hardware |

W1 ∥ W6 immediately; W2 ∥ W3 ∥ W4 once C1-C4 frozen (W2/W3/W4 all touch `manager.ts` —
partition by region: W2 owns focus/layers, W3 owns flush/rings, W4 owns onMessage
resolution; if that feels tight, serialize W4 after W2); W5 last, against fixture data.
Docs/34 as-built section + the D-2 reversal note ride W3's PR; the persistence-non-goal
amendment rides W1's.

**Unit-testable with zero hardware:** all of W1-W4, W6 (FakeTransport/vitest + node
engine tests). **Bench-bound (APC+MFT, Ring 1 Chrome Web MIDI):** column-assign feel +
4-channel focus LEDs; hue-sweep/push-toggle feel + ring-dark-when-off; live-ring
readability under heavy modulation (does a breathing ring fight the pickup feel?);
override shadow legibility; bank-2 assignment end-to-end.

---

## 6. Sequencing + risks

**Sequence:** freeze C1-C4 → W1 + W6 → W2/W3/W4 → W5 → bench pass → docs. Nothing
waits on the VSN1 (its keys/jog become another override pool later).

**Report-5 bench pass is still pending** (Waves 1-2 unverified on hardware).
Recommend running that checklist **before** W2-W4 land: they rewire the manager's hot
paths (focus, resolution, rings), and stacking a second unbenched wave makes any
hardware regression two waves deep to bisect. W1 + W6 can safely land pre-bench
(engine-only + a guard).

**Risks / ideology check:**
- *Static-remapper creep:* contained — SAFETY tier stays YAML-frozen; overrides are
  playlist-scoped named-set data, not profile mutations; capture-time rejection stays.
- *Stateful controller:* none — all three stores live in the playlist file
  (engine-as-truth); the manager holds only synced copies; hot-unplug loses nothing.
  The one new client-side ephemeral is the hsv push-toggle's "last non-zero V" stash —
  acceptable (it's an optimistic-layer value like the existing `optimisticValues`,
  `manager.ts:315`, and the engine echo remains the truth), but W3 must keep it out of
  any persisted state.
- *Ring revert (D-2 reversal):* the original #6 decision existed because a moving ring
  under modulation makes soft-takeover pickup feel random. Sina explicitly wants live
  rings; the mitigation is that pickup math stays anchored on base (§3.4) — but this is
  the plan's top **bench-verify** item. If pickup feel degrades, the fallback is
  ring=live only when the param is NOT pickup-locked.
- *Dangling channel refs:* dark column + loud grey row, never silent re-target (P6).
- *Engine-surface growth:* 2 root keys + 1 entry key + 5 routes, all clones of shipped
  patterns; same amendment class Sina ack'd for midiMappings — flag explicitly (D-B3).

## 7. Open ambiguities + decisions for Sina

**Ambiguity 1 — is the APC truly ONE unified layout?** My read: **yes, and it's a
simplification, not a divergence.** Sina's design makes columns 1-4 mean "the four
assigned channels" on EVERY tab — which *removes* the existing context branch (deck tab:
layer 0 = deck; mixer tab: layers = overlays; `dispatch.ts:32-34`,
`useMidiControl.ts:470-527`) rather than adding per-tab divergence (the report-6
ideology risk was re-diverging tab LAYOUTS; this is the opposite — one meaning
everywhere, P7-positive). The one loose end: today the deck tab's pads browse the DECK
playlist via that ctx branch; under the new design the deck only keeps pad-navigation
if it can be ASSIGNED to a column. **Proposal (D-A1):** allow `{ref: deck}` as a column
target, default `columnChannels = [deck, overlay1, overlay2, overlay3]` when the key is
absent — preserving today's muscle memory exactly while making it visible + editable.
Needs Sina's confirm: *should the deck occupy an APC column by default, or are columns
1-4 mixer-overlays-only (deck driven from iPad + MFT side button,
`mft.yaml:170-172`)?*

**Ambiguity 2 — color-param → relative-knob mapping for overflow knobs.** Primary
proposal (§3.2): TURN = hue sweep (wrapping — hue is circular, endless encoder is the
natural fit), PUSH = toggle V 0↔last ("turns on or off the colors"), ring = hue
position + dark when off. Alternatives: TURN=brightness (conventional ring read, loses
hue); PUSH=saturation presets (more states, weaker on/off). Also to confirm: after the
pattern's own hsvPickers, which curated CPC globals fill the remainder — and is
palette-pair selection (currently APC cols 5-8, `apc_mini_mk2.yaml:128-144`) wanted on
knobs at all, or do knobs stay per-pattern-color only? **This is a feel call — pick a
default (primary proposal), build it behind the derivation, bench it.**

**Decisions:**
- **D-A1** (above) — deck-as-column default.
- **D-B2** — SCULPT-tier boundary: may an override re-target fader 7 (global speed) and
  bank-2 knobs 1-3 (speed/size/rotate)? Recommended YES (sculpt, not safety);
  blackout/master/focus/scene/channel-strip stay untouchable either way.
- **D-B3** — engine amendment ack: 2 playlist root keys + 1 entry key + 5
  persistence-only routes (same class as the midiMappings amendment, docs/34:236-241).
- **D-B4** — bench ordering: confirm report-5 hardware checklist runs before W2-W4.

**Explicitly not building** (report 6 §3, unchanged): free-for-all remap of the safety
layout, per-operator profile presets, per-tab layout divergence, controller-side macros.
