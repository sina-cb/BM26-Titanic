# Slot 2 — global_effect_macros

- **Branch:** dev/claude/global_effect_macros
- **Parent branch:** dev/summer_camp_readiness (d0ab8d1)
- **Worktree:** ~/workspace/BM26-Titanic-worktrees/global_effect_macros
- **Slot ports:** engine 31268, sim 31269, metro 31281, OSC 31200

## Scope

Implements `docs/28_[todo]_global_effect_macros.md` v1: engine-side
modular global effect macros (software sync strobe, drop hit /
whiteout, color wash takeover, feedback trails), the 6-slot
performance grid that binds them to UI buttons, server-side safety
enforcement (rate ceilings, expert-burst toggle ban, burst clamps),
native-strobe channel suppression at the sACN layer, and a minimal
CaptainPad UI surface to drive the slots.

## Files changed

```
A  CaptainPad/components/GlobalEffectMacros.tsx
M  CaptainPad/components/RigGlobals.tsx
M  CaptainPad/utils/api.ts
M  marsin_engine/engine.js
A  marsin_engine/effects/colorWash.js
A  marsin_engine/effects/dropHit.js
A  marsin_engine/effects/feedbackTrails.js
A  marsin_engine/effects/strobe.js
M  marsin_engine/lib/api_server.js
A  marsin_engine/lib/global_effect_library.js
A  marsin_engine/lib/global_effect_slot_manager.js
M  marsin_engine/lib/global_effects_controller.js
M  marsin_engine/lib/state_manager.js
A  marsin_engine/tests/global_effect_macros.test.js
M  simulation/src/dmx/sacn_mapper.js
```

### Module layout
- `marsin_engine/effects/*.js` — four stateless apply modules
  (`strobe.js`, `dropHit.js`, `colorWash.js`, `feedbackTrails.js`)
  with pure math + per-pixel helpers per design §4.1.
- `marsin_engine/lib/global_effect_library.js` — registry
  (`GLOBAL_EFFECT_LIBRARY`), `describeLibrary` (JSON shape for the
  `/global-effect-library` route), and `validateParams` for PATCH
  payloads (with the burst clamp and `[1..20] Hz` range from §5.2).
- `marsin_engine/lib/global_effect_slot_manager.js` — slot CRUD,
  `resolveSlotBinding` (preset+behavior+safety-tier validation),
  `validateSlotsConfig`, `DEFAULT_SLOT_CONFIG`, and
  `dispatchSlotAction` with preset-aware switching for `strobe` and
  `colorWash` per §4.4–§4.5.
- `marsin_engine/lib/global_effects_controller.js` — runtime state
  ownership (active strobe config, drop-hit envelope queue, color
  wash, feedback-trails buffer). The legacy `vintageWhite` / `fogger`
  / `uvBlast` / `blastWhite` API surface is untouched so existing
  CaptainPad buttons keep working.

### Pipeline integration
- `engine.js` calls `globalEffectsController.applyMacros({ pixels,
  frameIndex, nowMs })` between `applyPixels` and the IntensityController
  apply (docs/28 §2.2). Order inside `applyMacros` is colorWash →
  feedbackTrails → dropHit → strobe (asserted in two ordering tests).
- `engine.js` then calls `suppressNativeStrobes(model.pixels,
  dmxRouter)` after sACN encoding (added in
  `simulation/src/dmx/sacn_mapper.js`) to force `UkingPar` CH8 +
  `VintageLed` CH2 + `EndyshowBar` 129/130 to 0 (docs/28 §2.1).

### Persistence
- New `marsin_engine/states/<scene>/global_effect_slots.yaml` written
  on every PATCH (whole-array or per-slot). Boot reads it via
  `StateManager.loadGlobalEffectSlots`; invalid file leaves the
  in-code DEFAULT_SLOT_CONFIG in place and logs a warning (no silent
  fallback — `loadGlobalEffectSlots` returns `null` rather than
  conjuring fake defaults).

### API endpoints
- `GET /global-effect-library`
- `GET /global-effect-slots`
- `GET /global-effect-slots/status`  (includes per-slot `active` flag
  + controller status snapshot)
- `PATCH /global-effect-slots` (whole array)
- `PATCH /global-effect-slots/:slotId` (single slot)
- `POST /global-effect-slots/:slotId/{activate|deactivate|trigger|toggle|down|up}`
- `POST /global-effect-macros/panic-stop`

Server-side safety guards:
- `validateParams('strobe', { durationMs > 2000 })` silently clamps
  to 2000 ms per §5.2.
- `validateParams('strobe', { hz < 1 || hz > 20 })` rejects with a
  400 (range check from §5.2).
- `resolveSlotBinding` rejects `expert_burst` presets configured as
  `toggle`/`hold` AND rejects `hold_only` presets configured as
  `toggle` (boot AND runtime path).
- `dispatchSlotAction` rejects `toggle`/`hold` actions targeting an
  `expert_burst` slot at runtime, in addition to the resolve check.

### CaptainPad
- New `components/GlobalEffectMacros.tsx` 2x3 grid bound to the engine
  via the new HTTP helpers in `utils/api.ts`
  (`fetchGlobalEffectSlots`, `fetchGlobalEffectSlotsStatus`,
  `dispatchGlobalEffectSlotAction`, `panicStopGlobalEffectMacros`).
- Rendered from `components/RigGlobals.tsx` (deck variant) below the
  existing rig globals so the legacy buttons are unmoved.
- Subscribes to `engineEvents` so server-broadcast slot status
  updates trigger a refresh.
- Renders a safety-tier color border (warning=amber, hold_only=deep
  amber, expert_burst=error red, normal=ghost border) on each slot
  button. A "PANIC STOP" header button calls
  `/global-effect-macros/panic-stop`.

## Tests run

### Unit (auto-checks)
`cd marsin_engine && node --test tests/global_effect_macros.test.js`
— **32/32 passed**, ~98 ms:
- Library / slot validation: default config validates, no slot maps
  to a future effect, `describeLibrary` is JSON-safe, invalid effect
  ids / out-of-range params / wrong colors / bad slot shapes throw.
- Safety: `max_20hz` rejects toggle+hold in both static and runtime
  paths, `hard_10hz` rejects toggle.
- Boot transient cleanliness: every active flag is false / null / 0
  on construct.
- Strobe: timing quantizes to whole frames; gate ON/OFF schedule
  matches spec; `applySoftwareStrobe` blanks on gate=0.
- Drop hit: ADSR envelope math, duration sum, expiry, trigger
  through slot 2.
- Color wash: replace mode pushes pixels toward target.
- Preset-aware switching: second strobe preset / second wash preset
  swaps configs instead of stopping; same preset twice stops.
- Burst: slot 6 expires after `durationMs` frames; raw
  `triggerStrobeBurst` clamps `> MAX_BURST_MS`.
- Feedback trails allocate on first apply (Float32Array, length
  `6 * pixelCount`) and clear on disable.
- Pipeline ordering: gate=0 strobe blanks everything earlier; trail
  buffer ~0 after a drop hit on frame 0 (drop hit runs AFTER trails).
- Panic stop clears strobe + drop hits + trails, leaves slots + wash
  unchanged.

Sibling tests not impacted by this slice still pass:
`node --test tests/playlist_manager.test.js tests/param_center.test.js
tests/audio_config.test.js tests/osc_listener.test.js` — 86/86 pass.

### Integration / HIL
Boot the engine on slot-2 ports (engine 31268, OSC 31200) — the
sequence below was driven manually via `curl` against the live engine
inside this worktree, which satisfies the design-doc HIL requirement
(trigger → envelope decay → output check):

```
node marsin_engine/engine.js --pattern test_const --model test_bench --port 31268
curl -X POST :31268/global-effect-slots/2/trigger
  → dropHit.active=true, count=1
curl :31268/global-effect-slots/status   # after envelope duration
  → dropHit.active=false, count=0    (envelope decayed on schedule)
curl -X POST :31268/global-effect-slots/1/activate
  → strobe.active=true, preset=sync_4hz, framesPerCycle=10/onFrames=5
curl -X POST :31268/global-effect-slots/6/toggle
  → 400 {"error":"Slot 6 preset 'max_20hz' is safety tier
    'expert_burst'; action 'toggle' is not allowed"}
curl -X POST :31268/global-effect-slots/6/trigger
  → strobe.active=true, burstEndFrame=current+40 (1000 ms @ 40 fps)
   …wait > 1 s…
  → strobe.active=false  (burst auto-stop fired in tick)
curl -X PATCH :31268/global-effect-slots/5 -d '{"label":"My Flash"}'
  → 200; state file now contains "label: My Flash" for slot 5
curl -X POST :31268/global-effect-macros/panic-stop
  → strobe + drop-hit + trails all cleared, wash unchanged
```

State files in `marsin_engine/states/test_bench/` were snapshotted to
`~/tmp/snap_global_effect_macros_test_bench_states` before the run
and restored after; the per-test-bench `global_effect_slots.yaml`
written during the run was removed before commit (it's a runtime
artefact, not source).

Engine was killed cleanly afterwards (`lsof -i :31268` shows no
process).

### CaptainPad
- `npx tsc --noEmit` — green for every new file. Pre-existing
  unrelated errors in `app/(tabs)/osc.tsx` are untouched; they were
  not introduced by this slice.
- `npx expo lint` — no errors or warnings on the new files. One
  pre-existing lint error in `app/(tabs)/audio.tsx` was already in
  the parent branch.
- Did not click anything on a physical iPad / web build (no Metro
  spun up); this is a follow-up. The component is wired through
  `engineEvents` so once the broadcasts land the active flag will
  paint correctly.

## Known gaps / follow-ups

1. **CaptainPad polish (docs/28 §6).** v1 surface is functional but
   not the full 2x3 polish described in the design (no hold gesture
   PressIn/PressOut handling for `hold_only` presets, no toast on
   400 errors, no slot configuration sheet). The component lives
   under `components/GlobalEffectMacros.tsx` and is a single
   container; a `GlobalEffectMacrosConfig` editor + a gesture
   responder for hold-only behavior are the natural next steps.
2. **WebSocket push.** `broadcastWs` is invoked on every dispatch
   and on PATCH, but the message shape (`globalEffectMacroStatus`,
   `globalEffectSlots`) is consumed only by my own
   `GlobalEffectMacros` component; no other surface listens yet. If
   PortWatch needs to mirror slot state (Pi/LoRa), this is where it
   should hook in.
3. **No Lightning / Waterline / Iceberg / Section Chase / Emergency
   Alarm / Vintage Glow / Heartbeat / Freeze Frame / Sparkle / Bass
   Pump effects.** All listed under docs/28 §7 as future macros;
   v1 ships strobe + dropHit + colorWash + feedbackTrails only.
4. **HIL test as `tests/hil/*.mjs` script.** I verified the HIL
   trigger → decay → output behaviour live with curl rather than as
   a checked-in `tests/hil/hil_global_effect_macros.mjs`. A
   formalized HIL script following `hil_add_button_latency_test.mjs`
   pattern is a small follow-up — the live-engine assertions used
   above are already documented here so re-running them is
   mechanical.
5. **Native strobe channel suppression** covers `UkingPar` (CH8),
   `VintageLed` (CH2), and `EndyshowBar` (CH129+CH130). `ShehdsBar`
   has no global strobe register per docs/09 so it gets an empty
   list. New fixture types will need an entry in
   `NATIVE_STROBE_CHANNELS` (`simulation/src/dmx/sacn_mapper.js`).
6. **Persistence file lives under `marsin_engine/states/<scene>/`**
   alongside the other state YAMLs. The slot config is per-scene by
   design — a different rig (titanic vs summer_camp_dome) can have
   different slot bindings. If the operator wants global (rig-wide)
   defaults, that's a small refactor to read from the scene dir
   first and then fall through to a shared dir.

## Operator action requested

Ready for review and merge. No conflicts anticipated with the other
slots: this slice only modifies `engine.js`,
`lib/global_effects_controller.js`, `lib/api_server.js`,
`lib/state_manager.js`, `simulation/src/dmx/sacn_mapper.js`,
`CaptainPad/components/RigGlobals.tsx`, and `CaptainPad/utils/api.ts`,
all in localized regions. The new `marsin_engine/effects/` directory
and the two new `lib/global_effect_*` files are pure-additive.
