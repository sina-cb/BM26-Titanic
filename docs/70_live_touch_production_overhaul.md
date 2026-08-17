# 70 — Live Touch production overhaul: spatial-first, ambient backgrounds, deck colours, per-scene presets

**Status:** DESIGN (report `_284`, Fable). Awaits one Opus lead + Sonnet
implementers. Builds on docs/44/45 (Live Touch system), docs/65 (`_268`
declutter), docs/66 (`_272` iPad ergonomics), docs/59/61 (`_259`/`_264`
colour daemon + interaction model), `_271` (artifact self-heal), `_277`
(text-selection kill).

**Operator order (verbatim intent, three items + the bar):**

1. *"the UI is still very cluttered and looking not prod ready … I want the
   spatial mode to be default in the SPATIAL XY, and XY mode call it effect
   control and make it the secondary option, make sure the spatial ui buttons
   are proper for production UI please too, call POOL -> invert, the others
   trail and erase and ignite sound okay"*
2. *"allow using the ambient patterns in the live touch too — instead of the
   130, 128, 129 patterns, allow the ambient patterns without exposing the
   parameters at all in the UI as the pattern that is used in the background —
   for the colors, integrate the 3 modes we have in the Deck color now into
   the live touch colors too and actually maybe use that as the main color,
   keep the existing color panel and call it 'legacy color' and have it
   hidden by default"*
3. *"let's figure out the presets — treat this as a playlist that we maintain
   and persist for the live touch settings … snapshotted and used as a
   preset, the presets are also persisted for the live touch per scene like a
   single playlist again — use best practices for this and follow existing
   mechanism we have for state saving from the deck and mixer"*

**Final bar:** *"implement all, validate all, screenshots, and proof on how
things have improved and are prod ready — a masterpiece of a visual live
touch control."*

---

## 1. Screenshot review — what reads as clutter and why it is not prod-grade

Evidence: iPad-resolution captures of the CURRENT surface (scratch dist on
:7171 → live :6969 panel → live :6968 engine, DISARMED, no engine writes) in
`C:/Users/TITANI~1/tmp/live_touch_shots/` — `portrait_*` 834×1194,
`landscape_*` 1194×834: `01_default`, `02_xy_mode`, `03_spatial_mode`,
`04_spatial_fullscreen`, `pane_{color,effects,groups,spatial}`, plus
`*_mode_state.json` / `*_inventory.json` DOM dumps.

### F1 — portrait header collision (defect, not taste)

At 834pt the tab header renders "TOUCH CONTROL" **under/through the
ARM–DISARMED pill** (`portrait_01_default.png`). One glance says unfinished.
The pattern hint is also truncated ("5 colours · XY pad · to…").

### F2 — priority inversion: the wheel is the hero, the pad is the tenant

Portrait default gives the legacy COLOR wheel ≈45% of the viewport; the
SPATIAL/XY panel starts below the fold line and EFFECTS, GROUPS and PRESETS
are entirely off-screen. The surface the operator performs on (the pad) is
the least visible thing on it. Landscape halves everything into a 2×2 grid
where the pad gets ≈40% of one quadrant — controls out-weigh canvas ~3:2.

### F3 — the wrong default mode

`portrait_mode_state.json` / `landscape_mode_state.json`: `XY MODE` is
`is-active` on boot (hardcoded markup, `touch_control.html:2941`); SPATIAL
must be selected by hand every session. Direct contradiction of the order.

### F4 — cross-mode residue

Each mode permanently displays a dead caption advertising the other mode's
controls ("SIZE · POWER · FADE · STEP · TAKE — SHOWN IN SPATIAL MODE" in XY;
"Y AXIS · ON TIME — SHOWN IN XY MODE" in spatial), and XY mode renders the
whole DRAW rail greyed — four disabled buttons occupying a full column.

### F5 — three competing control vocabularies at equal weight

Teal chip grids (ON TIME/SPEED/POWER/STEP/FADE/SIZE — up to six rows of 5-6
near-identical rectangles), white pill buttons (MASTER/HUE/…), and **bare
text rails** (DRAW: POOL/TRAIL/ERASE/IGNITE; INK: ONE/MASTER/HUE/COMP/CLASH)
whose inactive entries have no button chrome at all — in fullscreen they are
floating words. Nothing signals hierarchy: a once-per-set-up STEP chip has
the same visual rank as the ARM control.

### F6 — the EFFECTS panel is a config sheet

Sixteen visually identical dropdown slots with truncated names ("Movement
Trace - Ev…" ×4, "Movement Trace - Or…" ×4) and microscopic LVL readouts.
Zero glanceability mid-show.

### F7 — telemetry cosplaying as UI

The audio rail prints raw analysis numbers (micDomF **5733**, **1949**) and
a cryptic `+4`/`+1` overflow chip. Operator-meaningless engineering readout
in the premium top strip.

### F8 — PRESETS is invisible

A docked vertical text sliver on the far-left edge — the feature item 3
elevates to a headline currently has the least discoverable affordance on
the surface.

**What already IS prod-grade:** spatial fullscreen (`*_04_*`) — one giant
canvas, rails at the edges, EXIT/VIEW top-right. The overhaul's direction is
to make the whole surface feel like that view, not to invent a new language.

---

## 2. Ruled design — item 1: modes, renames, production buttons

### 2.1 SPATIAL default, "EFFECT CONTROL" secondary

- The mode toggle becomes **[ SPATIAL ] [ EFFECT CONTROL ]**, SPATIAL first
  and `is-active` on boot. Panel title stays "SPATIAL / XY"-family; ruled
  title: **"SPATIAL"** with the toggle carrying the two mode names (the
  panel header no longer needs the slash compound).
- Mechanics: today's default is markup (`touch_control.html:2941`) and the
  wire's mode predicate reads **button ordinal** (`spatialMode()` =
  `btns[1].classList.contains('is-active')`, `touch_control_wire.js:~904`
  and `:1487-1490`). Reordering buttons therefore breaks the predicate.
  **Ruling:** give the two buttons explicit `data-mode="spatial"` /
  `data-mode="effect"` attributes, rewrite the predicates to read the
  attribute, then reorder freely. The HTML-parsing contract tests that pin
  the toggle must be updated in the same commit, deliberately.
- **No last-mode persistence is added** (none exists today — nothing stores
  mode or pattern selection; boot re-stages the default). Boot = SPATIAL,
  always. Mode IS captured in item-3 presets, so a recalled preset may land
  the operator in EFFECT CONTROL — that is intent, not drift.
- Mode-switch behavior stays exactly as shipped: local relabel + capability
  refresh; retiring spatial pointers on leave; **no pattern auto-load on
  mode change** (pinned comment, `touch_control_wire.js:2168-2172`).

### 2.2 POOL → INVERT

- **Label + help copy only.** `touch_control.html:3093` button text becomes
  `INVERT`; its `title` and the DRAW help copy (`:~4400`, and the POOL
  design comments at `:3085-3091`, `:3950-3990` where user-facing) are
  rewritten for invert semantics — the mode literally paints the opposite
  colour (`isPool` complement path), so INVERT is the truer name.
- **The wire keyword and ordinal are protocol and do not move**:
  `data-dm="0"` stays on the first slot, `DRAW_MODES[0] === 'pool'` stays in
  the wire, engine and validator (three pinned files), and presets encode
  the ordinal — **rename is safe, reorder is forbidden.**
- TRAIL / ERASE / IGNITE keep their names and their `data-dm` values; TRAIL
  remains the default draw mode (pinned comment `:3085`).

### 2.3 Production button system (the "proper spatial ui buttons" clause)

One vocabulary, two tiers, everywhere on the panel (44pt doctrine, docs/66):

- **Tier 1 — performance controls** (DRAW modes, INK modes, mode toggle,
  TAKE transport, ARM): ≥44pt pills with visible chrome in EVERY state —
  inactive = outlined pill, active = filled pill + label weight. The DRAW
  and INK rails keep their edge positions (they are correct ergonomics) but
  every entry becomes a real pill, embedded and fullscreen alike.
- **Tier 2 — set-and-forget parameters** (SIZE/POWER/FADE/STEP/SPEED, Y-axis
  ON TIME): collapse from six always-open chip rows into **one compact
  "BRUSH" cluster row** showing current values (e.g. `M · 90 · 0.5s`), which
  expands in place on tap to the full chip rows and collapses again. The
  reclaimed vertical space goes to the pad. Chip rows inside the expansion
  keep the existing chips (they work; they were just always-on).
- **Cross-mode residue deleted**: no dead captions for the other mode, no
  greyed DRAW column in EFFECT CONTROL — a mode shows its own controls only.
- **Header fix**: the portrait title/ARM collision (F1) is a layout bug in
  the CaptainPad tab header (`app/(tabs)/touch_control.tsx` chrome), fixed
  so title, ARM pill and status cluster never overlap at 834pt; pattern hint
  gets a real truncation treatment or moves to the picker sheet.
- **PRESETS affordance**: the docked-panel rail tab system stays, but docked
  tabs render as labeled pills with an icon, not bare vertical text (F8).
- The audio rail drops raw numbers for operator-meaningful meters (F7):
  bars + labels only; the `+N` overflow chip gets a real "more meters" label
  in the expansion. (Scope guard: presentation only — no analysis changes.)

---

## 3. Ruled design — item 2a: ambient patterns as the Live background

### 3.1 Mechanism facts (recon-anchored)

- The engine already accepts **any valid pattern slug** on
  `PUT /layers/live_touch/pattern {pattern}` → `installLiveTouchPattern()`
  (`api_server.js:11460`, `:5179`). The 128/129/130 restriction is purely
  client-side: the `<select>` (`touch_control.html:2767-2772`),
  `PATTERN_FILES` (`touch_control_wire.js:1218-1222`), and the pinning
  contract test `touch_control_wire_layers_contract.test.js:27-36`.
- `installLiveTouchPattern` applies **pattern code defaults + CPC only** —
  it never calls `playlistManager.applyEntryDefaults`, so a raw stage runs
  an ambient pattern at its `export var` defaults, losing the curated
  per-entry tuning that IS the ambient blessing.
- Ambient truth is **playlists, not a pattern family**: per-scene
  `simulation/scenes/<scene>/playlists/*.yaml`, schemaVersion 1, entries
  `{id, pattern, label, defaults, modulations, midiMappings, notes}`.
  `ambient.yaml` (34 entries) is the canonical operator-blessed pilot;
  `ambient_sound_reactive.yaml` is its order-identical twin + 95 audio
  modulations; the other `ambient_*` families are draft/untracked.
- Modulations ride the **single deck-owned ModulationController** (one
  active entry context, pushed on deck swap) — they are not channel-generic.

### 3.2 The ruling

**Client widening + a small engine slice (recon options D1+D3):**

- The pattern picker becomes a **BACKGROUND picker listing ambient playlist
  entries by label** (source list: D4 below), replacing the raw 3-pattern
  select. Section two, "INSTRUMENTS", keeps 128/129/130 (D6).
- `PUT /layers/live_touch/pattern` grows an optional
  `{pattern, playlist?, entryId?}` form: when the entry is named, the
  engine resolves it and calls `playlistManager.applyEntryDefaults` inside
  `installLiveTouchPattern` after code-default seeding — same precedence
  order as a deck stage (code defaults → entry defaults → CPC). Bad
  playlist/entry → 400, loud, no fallback to code defaults.
- **Parameters are never rendered**: the panel simply does not render
  `GET /layers/live_touch/exports` for background patterns — that route is
  the only way the panel learns local controls, so hiding is free and
  total. (128-130 instruments keep their existing exposed controls.)
- **Entry modulations do NOT follow the pattern** (D5): the
  ModulationController is deck-owned single-context; hijacking it would
  fight the Deck, and a second live-scoped instance is real engine scope
  this wave does not need. Live audio-reactivity remains the Live surface's
  own audio-bindings system. Consequence stated honestly: an
  `ambient_sound_reactive` entry staged as Live background moves less than
  it does on the Deck.
- **Capability honesty** (existing `#patternCaps` affordance): ambient
  patterns don't export `sliderHue3/4/5` (five-colour degrades to
  `colorPalette1/2` — which is exactly what the item-2b colour integration
  speaks) nor `targetX/targetY` (SPATIAL painting still works — it rides
  the `/spatial-paint` global-effect path, which is coordinate-blind by
  design). The picker labels each entry's capability tier instead of
  letting controls silently no-op.
- The pinning contract test is **updated deliberately** to assert the new
  picker contract (ambient entries + instruments), keeping the isolation
  rule (only `/layers/live_touch/*` + the entry-resolution read).
- ARM re-stages the selected background exactly as it does today
  (unconditional stage step in `armLiveTouch`); a background swap mid-ARM
  is a hard cut (no live-channel transition exists) — acceptable for
  a background change, noted in the panel copy.
- Namespace guard: timeline cue kind `ambient` (plan background layer) is a
  homonym — the picker and preset schema say **"background pattern"**,
  never bare "ambient", in every identifier.

---

## 4. Ruled design — item 2b: deck colour modes become the main Live colour

### 4.1 Mechanism facts (recon-anchored)

- The deck colour system is **one global daemon** (`ColorAutopilot`, single
  instance `api_server.js:6132`, one config + runtime overlay file), one
  mode discriminator (`palettes` | `followNote`), output =
  global CPC `colorPalette1/2`. UI families (TWO COLOUR / PALETTE TURNS /
  FOLLOW NOTE) are **client cards** deriving `rotationKind` from the
  mode-scoped `colorAutopilot` WS broadcast.
- API: `GET/POST/PATCH /deck/color-autopilot` — POST = mode-aware
  merge + strict validate + full replace (generation bump, tween cancel);
  PATCH = live retune, `active`/`mode` refused. Unauthenticated, unscoped:
  Live Touch may legally drive it today.
- **But an armed Live session cannot SEE it**: Live renders from a private
  ParamCenter (`live_touch_session_context.js:68`, no save hook, seeded
  from the shared CPC snapshot at ARM) and ARM source-locks the shared CPC
  to `'api'` — the daemon's `'colorAutopilot'`-sourced writes are silently
  dropped for the whole armed session, while it keeps broadcasting.
- Live Touch's existing FOLLOW NOTE is a **client-side Scriabin table**
  (`touch_control.html:3401-3414, 4710-4742`) — the "second note→colour
  authority" docs/59 argues against.
- `ColorsWindow` (React) cannot be dropped into the HTML panel; the mixer
  precedent (`mixer.tsx:1788-1807`) is a React-host template only. The
  port is a **reconciliation inside the HTML panel** against the same wire
  contract — the panel already has a wheel, five slots, scheme generators
  and a follow-note modifier to reconcile.

### 4.2 The ruling

- **New "COLOR" panel (the main colour surface) inside the HTML panel**,
  three cards — TWO COLOUR / PALETTE TURNS / FOLLOW NOTE — reimplementing
  the docs/61 interaction contract against `GET/POST/PATCH
  /deck/color-autopilot` + the `colorAutopilot` WS frame. Same grammar as
  the deck: `rotationKind` derivation, kind-named refusal sentences
  (`manualWriteGate` wording), `schemeTapOutcome(kind, title, surface)`
  semantics (stage-only on foreign cards), DRIVING strip with the one STOP
  posting bare `{active:false}`. No React component is reused — the logic
  contract is (see §8 collisions: `colors_window_logic.ts` and
  `colors_window.tsx` are NOT edited).
- **One daemon, one config is preserved via the fan-out engine slice**
  (recon option A): `writeColorPaletteParams` (and the tween apply path)
  additionally writes `liveTouchSession.paramCenter` while a session is
  active. The private ParamCenter is a separate instance, so the shared-CPC
  source lock does not apply to it; the shared CPC keeps its lock
  semantics untouched. Bench-confirm the lock behaviour as part of W3
  validation (recon derived it from code).
- **The client-side Scriabin follow-note table is deleted**, replaced by
  the daemon's followNote mode. One note→colour authority.
- **Yield semantics for a non-Deck host** follow the shipped mixer ruling:
  Live Touch never fires yield gestures (no L2/L3 from a second surface);
  leaving the FOLLOW NOTE card inside the panel does not stop the show.
  The DRIVING strip's explicit STOP is the only stop on this surface. The
  app-wide colour chip remains read-only and navigates to the Deck.
- **The legacy panel**: today's COLOR panel (wheel + 5 slots + MASTER/HUE/
  COMPLEMENT/CONTRAST + local follow-note) is retitled **"LEGACY COLOR"**
  and ships **docked by default** (D8). Its five-slot instrument workflow
  for 128-130 remains fully functional when opened.

---

## 5. Ruled design — item 3: presets as one persisted per-scene playlist

### 5.1 Mechanism facts (recon-anchored)

- Live Touch persists **nothing** engine-side today, by design (in-memory
  session context; the live channel never serializes into
  `mixer_state.yaml`; panel DOM is the runtime truth).
- A shipped, populated 25-slot preset store already exists **panel-side**
  in localStorage `bm26_touch_presets_v1` (schema `v:3`,
  `captureState`/`restoreState`, `touch_control.html:6218-6333`): palette,
  scheme, follow, groups, fx by stable `{e,p}` identity, spatial block;
  deliberately excludes ARM + audio bindings; refuses recall on unknown
  effects. Its own comment says device-swap presets "belong on the engine."
- House persistence idioms: SnapshotManager / ParamPresetManager siblings
  under `states/<scene>/` via `StateManager.writeFileAtomic` (torn-write
  safe, fail-loud), REST + WS broadcast + replay-on-connect,
  server-authoritative for multi-pad; the live titanic scene runs
  `autoSave:false`, so anything routed through `saveAllState` would
  silently never write. `simulation/scenes/**/playlists/` is a scene asset
  tree with the one non-atomic writer — wrong home.

### 5.2 The ruling

- **Home:** engine-side `states/<scene>/live_touch_presets.yaml` — a third
  sibling of snapshots/param-presets. Direct `writeFileAtomic` on every
  mutation; **never** via `saveAllState`; fail-loud on unreadable/invalid
  file (no silent empty-list fallback).
- **Shape:** one ordered playlist per scene:
  `{schemaVersion: 1, entries: [{id, name, capturedAt, state: {...}}]}` —
  whole-file save, ParamPresetManager-style REST (list/create/recall-
  support/rename/delete/reorder) + `liveTouchPresets` WS broadcast +
  replay-on-connect. Server-authoritative; pads render broadcast state.
- **Capture set:** the shipped `v:3` capture coverage (palette, scheme,
  follow, groups, fx `{e,p}`, spatial block) **plus** this wave's new
  state: active mode (SPATIAL/EFFECT CONTROL), background selection
  (`{playlist, entryId}` — not a bare pattern slug), and the main-colour
  config (the daemon wire shape for the card being used). **ARM and audio
  bindings stay excluded.** Recall keeps refusing loudly on unknown
  effects; recall of the colour block is an explicit POST (full-replace
  takeover semantics are correct for an intent gesture).
- **Recall while DISARMED** stages panel-locally exactly as `restoreState`
  does today; engine writes remain ARM-gated. A preset is a staging
  document, not a backdoor around the lease.
- **Migration (D10):** one-time client-assisted import — on connect, if
  the scene's engine store is empty and the panel holds a non-empty
  `bm26_touch_presets_v1`, the panel offers/POSTs them as origin-tagged
  migrated entries; first pad wins harmlessly (store non-empty afterward);
  localStorage store becomes inert legacy. Rig state is never silently
  orphaned (the bump-key-and-ignore convention is licensed for view
  preferences only).
- **UI:** the PRESETS panel becomes a first-class playlist list — rows
  with name, captured badges (mode/background/colour), SAVE (snapshot
  now), RECALL, rename, reorder, delete — one-up stacked per docs/66.

---

## 6. W-packages

Sequencing: W1 → (W2 ∥ W3) → W4 → W5. Every W lands with its tests green
and its screenshot proof; W5 is the operator's final bar.

### W1 — Production shell (panel + tab chrome; no engine change)

Scope: §2 complete — SPATIAL default + reorder via `data-mode`, EFFECT
CONTROL rename, POOL→INVERT label/help, tiered button system (44pt pills;
BRUSH cluster collapse), cross-mode residue removal, portrait header
collision fix, PRESETS/docked-tab affordance, audio-rail presentation.
Files: `docs/ui/touch_control.html`, `touch_control_wire.js` (mode
predicates only), `app/(tabs)/touch_control.tsx` (header chrome),
HTML-parsing contract tests.
Acceptance:
- Boot lands in SPATIAL both orientations; `spatialMode()` reads
  `data-mode`; toggle order SPATIAL, EFFECT CONTROL.
- Grep gate: no user-facing "POOL" remains in panel copy; `data-dm="0"`
  ordinal and `DRAW_MODES[0]==='pool'` byte-identical in wire/engine/
  validator; preset ordinal encoding untouched.
- Every interactive control ≥44pt with chrome in every state; no dead
  cross-mode captions; portrait header has zero overlaps at 834pt.
- Contract tests (29/29 HTML-parsing family) updated and green; `_277`
  selection-kill pair intact; `_271` artifact gate untouched (see §9).
- Screenshots: portrait+landscape default/spatial/effect-control/
  fullscreen at 834×1194 / 1194×834.

### W2 — Ambient backgrounds (engine slice + picker)

Scope: §3 — PUT body extension + `applyEntryDefaults` in
`installLiveTouchPattern`; BACKGROUND/INSTRUMENTS picker; exports never
rendered for backgrounds; capability tier labels; contract test rewrite.
Acceptance:
- Staging `{playlist:'ambient', entryId}` runs the entry at its blessed
  defaults (engine test asserts a known entry's slider values on the live
  channel); bad entry → 400, no fallback.
- Picker lists D4's source; no parameter UI appears for any background;
  128-130 instruments unchanged; ARM re-stage works; revision-race 409
  behaviour unchanged.
- `touch_control_wire_layers_contract.test.js` updated deliberately;
  isolation rule (only `/layers/live_touch/*` writes) still asserted.
- Screenshots: picker open (both orientations), an ambient background
  live on the pad, capability label visible.

### W3 — Main colour = the deck daemon (engine fan-out + panel cards)

Scope: §4 — fan-out slice; three-card COLOR panel in HTML against
`/deck/color-autopilot` + WS; DRIVING strip + kind-named refusals +
stage-only scheme taps; Scriabin table deleted; LEGACY COLOR rename +
default-dock.
Acceptance:
- With Live ARMED and the daemon running, the rig visibly follows the
  daemon (fan-out proven live — the recon's source-lock analysis
  bench-confirmed); deck + mixer COLORS surfaces show the same state;
  engine colour-autopilot test suite green + new fan-out tests.
- Only one note→colour authority remains (grep gate: Scriabin table gone).
- STOP posts bare `{active:false}`; no yield gesture fires from Live
  Touch (test-pinned, mirroring `colors_yield_bridge.test.ts`'s
  source-text gate style).
- LEGACY COLOR docked by default per D8; five-slot flow works when opened.
- Screenshots: each card, DRIVING strip visible, legacy panel docked +
  reopened.

### W4 — Presets playlist (engine manager + panel UI + migration)

Scope: §5 — `live_touch_presets.yaml` manager (atomic, autoSave-
independent), REST + WS + replay, capture-set extension, presets panel UI,
v1 migration.
Acceptance:
- Engine restart round-trip: save preset → restart engine → preset list
  replays on connect and recalls correctly (the device-swap test the v1
  store cannot pass).
- Two-client test: second WS client sees create/rename/reorder/delete
  broadcasts; recall respects ARM gating.
- Migration test: populated v1 store + empty engine store → offered
  import lands origin-tagged entries exactly once across two racing
  clients; non-empty engine store → no migration.
- Corrupt/invalid store file → loud failure, no silent empty list.
- Screenshots: presets panel as playlist, saved/recalled badge states.

### W5 — Proof of prod-readiness (the operator's bar)

Full before/after screenshot matrix (this doc's §1 shots are the
"before"): portrait + landscape at 834×1194/1194×834 (plus 1024×1366 if
the lead wants the 13" proof), every pane, both modes, fullscreen, picker,
colour cards, presets. Side-by-side improvement narrative keyed to F1-F8.
Gates: full CaptainPad suite + tsc + eslint, engine suite (known
environmental failures only), wire contract tests, artifact gate
regenerated-and-passing, security scan. Report + tracker + dossier update.

---

## 7. Decision list (one-line vetoable defaults)

- **D1** POOL→INVERT is label+help only; wire keyword `'pool'` and ordinal
  `data-dm="0"` stay pinned protocol-wide (rename OK, reorder forbidden).
- **D2** Boot mode is always SPATIAL; no last-mode persistence added; mode
  rides item-3 presets instead.
- **D3** Mode buttons get `data-mode` attributes; predicates read the
  attribute, not the ordinal; contract tests updated in the same commit.
- **D4** Background source list = `ambient.yaml` (the 34 canonical blessed
  entries) only; other `ambient_*` families join when blessed.
- **D5** Entry `defaults` follow the background engine-side; entry
  `modulations` do NOT (deck-owned single ModulationController); Live
  keeps its own audio-bindings reactivity.
- **D6** 128/129/130 remain available under an INSTRUMENTS section; the
  default selection becomes the first ambient background (veto → remove
  instruments from the picker entirely).
- **D7** Colour integration = fan-out to the live session ParamCenter
  (one daemon, one config); no second daemon, no client-side re-
  implementation.
- **D8** LEGACY COLOR defaults to docked for fresh layout state; devices
  with a stored open state keep it (additive layout key, no version bump,
  per docs/65 §6.5) (veto → one-time force-dock for everyone).
- **D9** Presets live engine-side at `states/<scene>/live_touch_presets.yaml`,
  atomic writes, autoSave-independent, server-authoritative.
- **D10** One-time client-assisted migration of `bm26_touch_presets_v1`
  (veto → declare the store orphaned, loudly, in the panel).
- **D11** Preset recall stays ARM-gated for engine writes (staging
  document, not a lease bypass); colour recall uses POST full-replace.
- **D12** The unclaimed `liveTouchChannel.hue` seam stays unclaimed this
  wave (veto → add a background HUE control that works on any pattern).
- **D13** Audio-rail raw numbers replaced by presentation-only meters; no
  analysis/registry changes.

---

## 8. Engine-vs-pad split, restarts, sequencing, collisions

### Engine (operator restart of the live stack REQUIRED)

- W2: `PUT /layers/live_touch/pattern` entry form +
  `applyEntryDefaults` call (+ tests).
- W3: colour fan-out into `liveTouchSession.paramCenter` (+ tests).
- W4: live-touch preset manager + routes + WS (+ tests).

W2/W3/W4 engine slices should land as ONE restart-worthy engine change-set
if scheduling allows — the operator runs the live stack; every engine slice
costs a show-stack restart (memory: bench-check first, keep the live engine
newest).

### Pad / panel (no engine restart)

- W1 entirely; the HTML panel (`docs/ui/*`) is served from disk by the sim
  (:6969) — an iframe reload picks it up; CaptainPad tab-chrome changes
  need a web dist export / native rebuild per docs/62 (`rebuild-pad`).
- W2/W3/W4 panel sides ride the same panel-reload path.

### Sequencing & collision notes (concurrent tonight)

- **Deck layout debug** (`deck_workspace_layout.ts` + `index.tsx`, landed
  `_281`): zero file overlap with this contract.
- **Mixer three-fix** (docs/69 → `mixer.tsx` + mixer files): zero overlap —
  this contract deliberately never edits `mixer.tsx` (the ColorsWindow
  mixer mount is a template, not a dependency).
- **TURNS-lag memoization** (in working tree, markers in
  `colors_window.tsx`, `hue_wheel.tsx`, pinned by source-text asserts in
  `colors_window_wiring.test.ts`): this contract **must not edit those
  three files**. The W3 port reimplements the docs/61 grammar in the HTML
  panel; any shared pure logic goes into `colors_window_logic.ts` (marker-
  free) or a new sibling — never into the memoized components.
- **Perf-mode wave** (`_layout.tsx`, `PerformanceModeControl`,
  `ExitPerformanceSheet`, shared playlist components `PlaylistPanel` /
  `split_playlist_panes`): zero overlap — item-3 presets UI lives in the
  HTML panel and the engine, NOT in the React playlist components.
- This wave's implementer runs **after** tonight's landings rebase;
  W1 first (pure panel, immediately reviewable), engine slices batched.

---

## 9. Constraints appendix — what this design must not break

- **Transport pins (UNTOUCHABLE):** `buildTransport()`
  (`touch_control_theme.js:96`), `window.__captainpadDeliver`
  (`touch_control_theme.js:339`), the `captainpad_embed=native` gate and
  `window.parent !== window` check (`touch_control.html:2734-2735`).
- **`_271` artifact gate stays fail-closed and unweakened** — the
  pixel-view artifact check + self-heal mechanics are not relaxed by any
  layout change; W5 regenerates and re-proves the artifact.
- **`_277` selection-kill pair** — the shell kill rule + the
  `input,textarea,[contenteditable]` caret counter-rule survive intact
  (the contract tests assert both together).
- **docs/66 doctrine** — 44pt two-tier touch targets, one-up stacking,
  first-paint gate, curtain behaviour (`_261`).
- **docs/65 §6.5** — `bm26_touch_layout_v2` is additive-only, no version
  bump; new panels/defaults are additive keys.
- **Live/Timeline authority** — Timeline outranks ARM; emergency paths,
  lease semantics, 423/409 codes, activity-based takeover renewal: all
  untouched. `PUT /layers/live_touch/pattern` keeps its existing (ownerless)
  posture this wave; flagged as a known posture, not silently changed.
- **No fallback behaviours anywhere** (codex P0): bad playlist entry, bad
  preset file, failed colour POST → loud errors, never silent defaults.
- **Offline readiness**: no new assets, no CDNs; everything ships in-repo.

---

## 10. ADDENDUM (post-`_288`) — F6: the EFFECTS panel's production grammar

Commissioned after W1 + the three engine slices shipped (`_288`); F6 was
reviewed in §1 but left unscoped above. Substrate = the `_288` shell
(read `_288`'s three contract corrections first). Evidence: the `_288`
after-shots (`~/tmp/live_touch_impl/shots/after/landscape_01_default.png`,
effects region re-examined at 2× zoom) — SPATIAL is now production-grade;
EFFECTS is still §1-F6 verbatim.

### 10.1 What F6 is, precisely, on the `_288` shell

1. **Identity lives in the wrong control.** Each of the 16 cells is headed
   by the 18px assign `<select>` (`.fx-pick`) whose truncated label is the
   only readable identity — and the shipped default bank makes SEVEN cells
   read identically as "Movement Trace - …". The pressable face
   (`.fx-face`, the actual performance control, tap=latch / hold≥350ms=
   momentary — already desk-grammar, already correct) renders its FX_SHORT
   two-liner **invisibly** in the real theme: the after-shot faces are
   blank. The best control on the panel is unlabeled; the label sits on
   the set-and-forget control.
2. **Rule documentation as permanent furniture.** The header legend row
   ("DIM · one | FLASH · one | FRAME · one | TEXTURE · stack freely |
   movement only · colour from the wheel") narrates family law full-time
   instead of at the moment it acts.
3. **32 micro-controls always on stage.** Every cell foot carries the
   audio-binding row (`.aud-pick` 8.5px select + `.aud-mode` LVL/HIT) —
   edit-time configuration rendered at performance-time, at sizes the
   docs/66 census flagged (fx cell 43.75px at 1194×834; `.fx-pick` is an
   accepted 44pt residual at 1121-1366px *because* it is always-on).

### 10.2 The ruled grammar — a bank of sixteen named keys, with a service hatch

The panel gets **two class-states** on the existing DOM (visibility only —
no element moves, no id changes, wire's delegated listeners see the same
tree): **PLAY** (default, the performance surface) and **EDIT** (the
service hatch), toggled by one 44pt pill in the panel header beside
`#fxCount`.

**PLAY** — nothing on stage but the sixteen keys:
- `.fx-pick` and `.aud-row` are hidden (CSS state class on the panel;
  elements stay in the DOM exactly where `#fxGrid`'s delegated handlers
  and the preset restore path expect them).
- The face's FX_SHORT two-liner becomes the identity: rendered in theme-
  bridge tokens at AA contrast in BOTH arm states (this is the wash-out
  fix — the current colours are dark-theme literals that die on the
  bridged light theme). Face lines never truncate: FX_SHORT's ≤8-char
  contract gets an enforcing test at minimum cell width.
- A tiny corner **family tag** (DIM/FLASH/FRAME/TEX/MOVE) joins the stripe
  so families decode without a legend; the slim foot **amount bar** shows
  the slot's base level read-only.
- The legend row is deleted. Family law speaks when it acts: the existing
  capped-family/singleton eviction (`was-released` flash) gains a one-line
  transient narration in the panel sub-header — "FLASH allows one —
  released STROBE". The ⓘ help overlay (docs/65 drawHelp precedent, zero
  flow height) carries the full family table. `#palNote` stays exactly as
  is — it already IS this grammar.
- Hold/latch timing (`HOLD_MS` 350), singleton + `FX_CAPPED` eviction,
  solid-green `is-on`, family stripes, `#fxCount` copy: all untouched.

**EDIT** — the same sixteen cells, opened for service:
- Each cell reveals its existing `.fx-pick` select grown to a ≥44pt real
  box (the CSS's documented 1194×834 ratio-ceiling residual applied to the
  *always-on* select; an opt-in state may spend height PLAY reserves for
  faces), the `.aud-row` at ≥44pt, and a **new horizontal base-level
  fader** riding the EXISTING `paramsOverride` merge writer
  (`touch_control_wire.js:1411-1420` grammar — MERGE, never replace; no
  new engine surface). When an audio binding in LVL mode owns the slot's
  level, the fader renders ghosted read-only — one writer per knob.
- EDIT may scroll inside the panel if 16 cells at edit height exceed it;
  PLAY never scrolls.
- EDIT is UI posture, not rig state: not persisted, not captured in W4
  presets, always boots PLAY.

### 10.3 W6 — the implementer package

Scope: `docs/ui/touch_control.html` only (CSS + the small state-toggle and
narration script; `touch_control_wire.js` only if the level fader's writer
needs a named export — prefer reusing the existing merge path).
Sequencing: **after `_289`** (the W2/W3/W4 panel sides) — same-file waves
must not interleave.

Acceptance criteria (gate = `simulation/agent_tools/
live_touch_overhaul_shots.cjs`, union(box, `::after`) measure, both docs/66
11" viewports 834×1194 and 1194×834):

- **PLAY:** 16/16 cells visible without panel scroll in landscape (4×4)
  and when the panel is scrolled into view in portrait; every face
  hit-region ≥44×44pt (both viewports, both spatial modes); ZERO always-on
  selects or aud-rows; zero truncated face lines (test enforces FX_SHORT
  ≤8 chars renders untruncated at minimum cell width); header legend row
  absent; face two-liner contrast ≥4.5:1 through the theme bridge in
  DISARMED and ARMED (measured, both lines, lit and unlit).
- **EDIT:** PLAY↔EDIT pill ≥44pt; every edit control (select, aud-pick,
  aud-mode, level fader) ≥44pt real box; internal scroll allowed; fader
  writes prove MERGE semantics (amount + mode survive each other) and the
  ghost state proves single-writer under an LVL binding.
- **Eviction narration:** capped-family and singleton releases produce the
  named one-liner; `was-released` flash unchanged.
- **Pins byte-identical:** `#fxGrid`/`#fxCount`/`#palNote` ids and the
  `[data-role=fxpick]`/`[data-role=fxface]` roles; `HOLD_MS`; family
  mapping + caps; all §9 transport pins; `xyPad.clipBottom` budget (this
  wave never touches the spatial panel); theme contract
  (`touch_control_theme.js` zero changes).
- **No engine change; panel-reload only.** Screenshots: PLAY + EDIT, both
  orientations, one eviction-narration frame, before/after against the
  `_288` after-shots.

### 10.4 Addendum decisions (vetoable)

- **D14** PLAY/EDIT are panel class-states on the existing DOM; PLAY
  default; EDIT never persisted (not in presets either).
- **D15** Identity = the face's FX_SHORT two-liner; the select is
  edit-only. Select option labels may truncate (edit-time); face lines may
  not (test-enforced).
- **D16** Legend row deleted → ⓘ overlay + moment-of-action eviction
  narration + per-cell family corner tag.
- **D17** The default bank gets a family-spread curation pass (the seven
  "Movement Trace" defaults are indistinguishable) — implementer proposes,
  operator blesses; W4 presets capture banks thereafter.
- **D18** Base-level fader ships in EDIT riding the existing
  `paramsOverride` merge writer; ghosted read-only when an LVL audio
  binding owns the level (veto → no fader, foot bar stays read-only).
- **D19** Face-label wash-out is fixed with theme-bridge tokens (never
  hard-coded dark-theme literals) — AA in both arm states is a gate, not
  an aspiration.

---

## 11. ADDENDUM — hide/show becomes the Deck grammar (OPERATOR OVERRIDE)

**Operator override, 2026-08-16 (verbatim):** *"the UI hiding showing
feature in the live touch tab changed and it's for the worse! 🙂 use the
deck hide/show functionality for the live touch"*; *"the windows, please
make them more robust and friendly and stable — the buttons disappear at
certain grid layouts"*; *"make the hide/show area less dominant in the UI
again, use the idea from the deck"*. **This overrides the docs/65 §6
"one show/hide system per surface" pin** that rejected a deck-style chip
row for this panel. Recorded here; docs/65 §6 yields to this section.

This is an HTML panel, not RN: the port is the **grammar** of
`components/ui/workspace_chip.tsx` + `deck_workspace_layout.ts`, never the
React components.

### 11.1 Diagnosis — "the buttons disappear at certain grid layouts"

Code-anchored mechanisms (the `_288` panel, current dock script
`touch_control.html:7088-7277`):

1. **Landscape has no scroll escape.** `.content-grid { overflow:auto }`
   exists only inside `@media (max-width:900px)` (`:2280`) — portrait
   one-up scrolls, but landscape (≥901px) clips everything that doesn't
   fit, with the base `.prow > .panel { min-height:0 }` letting panels
   compress arbitrarily under the `.prow-top` 1.36 ratio ceiling. A
   header's `[data-collapse]`/`[data-lock]` buttons that land outside the
   viewport are simply GONE — no path reaches them.
2. **Silent displacement.** `MAX_PER_ROW=2` displacement
   (`makeRoomIn`, `:7220-7229`) docks the least-recently-opened panel with
   zero narration — to the operator a window (and every button on it)
   vanishes as a side effect of opening another. `loadLayout`'s cap
   enforcement (`:7182-7185`) similarly pops DOM-order-last panels docked.
3. **The restore affordance is a left-edge vertical rail**
   (`#panelRail` rail-tabs, built only for docked panels) — the "dominant"
   area the operator wants gone, and one more vocabulary on a surface that
   already has too many (§1-F5).

A scroll-aware probe harness that enumerates every reachable
`bm26_touch_layout_v2` shut-set at both 11" viewports and hit-tests every
collapse/lock/rail control is saved for the implementer at
`C:/Users/TITANI~1/tmp/live_touch_dock_probe/dock_orphan_probe2.cjs`
(127.0.0.1-only per the standing loopback rule). **W7 step one is running
it to pin the exact failing states before changing anything**; the design
below must then name them fixed.

### 11.2 The ruled grammar — one quiet chip row, deck semantics

Replace the dock rail + per-panel header chevrons with **one horizontal
chip row at the bottom of the panel** (bottom tier, one row tall,
horizontal scroll, never wraps):

- **Chips** (the deck spec, in panel CSS): ~28px pill + `::after` overlay
  to ≥44pt (the house pattern for buttons); content = dot → label → glyph.
  OPEN chip = normal caps, panel ground, `▾`, tap **hides** its panel.
  HIDDEN chip = micro caps, quieter ground + ghost border, `▸`, tap
  **restores**. The identity dot never changes between states (same
  object moving, deck rule). No count badges. Order: open chips in
  canonical panel order, then a 1px divider + `HIDDEN` micro-caption,
  then hidden chips **in close order**. Overflow: a `›` hint pinned
  outside the scroller, shown only while the row actually overflows and
  is not at its end (mixer lesson; adjacent hit-slops must not overlap —
  mind the gap).
- **Floor**: MIN_OPEN=1 keeps its value but adopts the deck's
  **unpressable-floor** treatment — when one panel remains, its chip
  renders as a plain non-button (no glyph, no press), replacing the
  `dock-refused` flash ("an affordance that always refuses should not
  exist").
- **Displacement narrated**: MAX_PER_ROW=2 stays (row capacity is real),
  but a displaced panel's chip visibly lands at the head of the HIDDEN
  segment — the chip row IS the narration; nothing vanishes without its
  name appearing somewhere tappable.
- **Bars ride the same row**: the meter strip's AUDIO chip joins as a bar
  chip (deck bar precedent) — same row, never counted toward the floor.
- **Deleted**: `#panelRail` and the per-panel `[data-collapse]` chevrons
  (the chip row is the one hide/show affordance). `[data-lock]` stays in
  panel headers. The landscape clip hazard (11.1-1) is closed by the same
  wave: with chevrons gone, hide/show never depends on reaching a panel
  header; W7's acceptance still requires every surviving header control
  hittable in every reachable state.

### 11.3 Persistence ruling — `bm26_touch_layout_v3`

- **New key `bm26_touch_layout_v3`**, storing
  `{ closed: [keys in close order], known: [all keys at write time] }` —
  the deck wire shape, honoring the known-set rule verbatim: *"a store may
  only be silent about an element that did not exist when it was written,
  and silence must reproduce the screen that store's author was looking
  at."* Unknown-to-the-store **panels default closed** (every future
  panel must ship closed — the deck invariant this rule depends on);
  unknown **bars** hydrate open (bars ship open). Normalizer is total:
  junk → shipped defaults, unknown ids dropped, floor enforced at
  hydrate, `{closed:[]}` legitimate.
- **v2 is NOT migrated — ruled loudly.** The docs/65 §6.5 additive-only
  pin protected back-compat *within* the v2 grammar; a grammar swap is
  the deck's own convention's licensed case: *"version lives in the key;
  a bump discards old keys, no migration, because this is a preference
  not engine state."* Panel layout is a view preference (contrast §5's
  D10, where presets are rig state and migration is mandatory). Boot
  with only a v2 store = shipped defaults + one console note naming the
  supersession. The v2 key is left untouched on disk (never deleted —
  a rollback build still reads it).

### 11.4 W7 — the implementer package

Scope: `docs/ui/touch_control.html` (dock script + chip-row CSS/markup;
panel-reload only, no engine change). Sequence: **after `_289` and the W6
effects wave** — same-file waves never interleave; implementation slot
assigned by the coordinator (`_294+`).

Acceptance:
- Step one: run the 11.1 probe on the pre-change panel; record the
  failing states; the same probe on the post-change panel reports **zero
  orphans across every reachable v3 layout × both 11" viewports** (all
  chips + surviving header controls hittable, scroll-aware).
- Chip row: one row, ≤44pt tall visual tier; every chip ≥44pt effective
  hit region (union gate), no overlapping adjacent hit regions; quiet
  parity (hidden chips visibly recede vs open chips); divider + HIDDEN
  caption present only when something is hidden.
- Displacement test: opening a third top-row panel moves the displaced
  panel's chip to the HIDDEN segment head in the same frame.
- Floor test: last open panel's chip is a non-button; docking it is
  impossible by construction.
- Persistence: v3 round-trip over all reachable layouts; known-set
  future-panel simulation (a synthetic sixth key defaults closed, bar
  key defaults open); v2-only store boots shipped defaults with the
  console note; v2 key not deleted.
- Pins: transport (§9) byte-identical; `#fxGrid`/`#fxCount`/`#palNote`
  and all W6 grammar untouched; `_271` artifact gate, `_277` pair,
  spatial fullscreen, `xyPad.clipBottom` budgets untouched; 44pt gate =
  `live_touch_overhaul_shots.cjs`.
- Screenshots: chip row both orientations, a displacement sequence, the
  floor state, before/after of a diagnosed failing state.

### 11.5 Addendum decisions (vetoable)

- **D20** The chip row lives at the panel's bottom edge (bottom tier,
  quiet) — veto relocates it under the topbar (deck renders its row
  mid-surface; bottom is this panel's equivalent of "out of the
  performance zone").
- **D21** `bm26_touch_layout_v3` with `{closed, known}`; v2 bumped-and-
  ignored (view preference, deck convention), key left on disk, loud
  console note. Veto → migrate v2's shut-list into v3.closed once.
- **D22** MAX_PER_ROW=2 displacement kept, narrated via the chip row.
  Veto → refuse-instead-of-displace (two-tap swaps).
- **D23** MIN_OPEN floor keeps value 1 with the unpressable-floor chip
  treatment (dock-refused flash deleted).
- **D24** Per-panel header chevrons deleted; the chip row is the only
  hide/show affordance (locks stay). Veto → keep chevrons as a secondary
  affordance (not recommended — two systems is the exact docs/65 §6
  failure the operator is re-litigating).
