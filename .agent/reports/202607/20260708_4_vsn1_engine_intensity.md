# 20260708_4 — VSN1 engine intensity registry

**Role:** Effects/engine developer.
**Branch:** `feat/party_integration_20260711`.
**Scope (zone):** `marsin_engine/lib/*`, `marsin_engine/effects/*`,
`marsin_engine/tests/*` only. No CaptainPad / simulation / tools touched.
**Goal:** a per-effect "primary intensity" registry so the Intech VSN1
endless jog-wheel (docs/42) drives ONE party-meaningful knob per global
effect (GEM) slot, normalized 0..1, applied live and persisted per slot.

---

## What changed

### 1. Per-effect primary-intensity declaration (`effects/*.js`)

Every effect module now exports a `primaryIntensity` descriptor on its
`*Effect` bundle object:

```js
primaryIntensity: { label, param, default, min, max }   // or null
```

- `label` — operator-facing knob name.
- `param` — the effect param a normalized 0..1 value writes into.
- `min`/`max` — the real param range a 0..1 value maps linearly onto.
- `default` — the param value used when intensity was never touched.

An effect with **no tunable magnitude** (invert, the legacy channel slams,
fogger) declares `primaryIntensity: null` **explicitly** — a deliberate "no
primary". A **missing** declaration (`undefined`) is a hard startup error
(Codex P0: no silent fallback). This distinction is enforced in
`normalizePrimaryDescriptor`.

### 2. Registry + mapping (`lib/global_effect_library.js`)

- `PRIMARY_INTENSITY_REGISTRY` — `effectId → frozen descriptor | null`,
  **built and fully validated at module load** for every GEM-library
  effect. A forgotten/ malformed declaration throws at boot (proven by the
  `npm run check` dry-run booting clean).
- `getPrimaryIntensity(effectId)` — descriptor lookup (throws on unknown id).
- `map01ToPrimary(effectId, v01)` — clamp 0..1, map onto `[min,max]`.
- `mapPrimaryTo01(effectId, value)` — inverse, clamped to 0..1.
- `normalizePrimaryDescriptor(effectId, desc)` — exported so tests lock the
  loud-error contract.

### 3. Slot status + live intensity (`lib/global_effect_slot_manager.js`)

- Slot gains a persisted `intensity` field (`null` = untouched → default
  applies). Survives the `getSlots`/`setSlots` deep-clone and the YAML save.
- `getStatus()` now emits per slot: **`intensity`** (current 0..1),
  **`intensityDefault`** (default → 0..1), **`intensityLabel`**. All three
  are `null` for an effect with no primary (or an unknown effect).
- `setSlotIntensity(slotId, value, {frameIndex, nowMs})` — clamp+validate,
  map onto the real param, write `paramsOverride[param]`, record
  `slot.intensity`, round-trip through `resolveSlotBinding`, and
  **re-dispatch (`activate`) when the slot's effect is currently running** so
  the change is live. Trigger effects (dropHit) are NOT re-dispatched (that
  would fire a spurious hit) — their next fire picks up the new params.
- `resetSlotIntensity(slotId, …)` — clear `slot.intensity`, delete the
  intensity key from `paramsOverride`, re-dispatch live if running.
- `patchSlot` now drops a stale touched intensity when the bound `effectId`
  changes (the old value was scaled to the old effect's range).

### 4. Endpoints (`lib/api_server.js`)

Two new routes, inserted **before** the generic
`POST /global-effect-slots/:id/{activate…}` matcher (which would otherwise
404 the `/intensity` paths). Both persist via
`stateManager.saveGlobalEffectSlots` and broadcast `globalEffectMacroStatus`.

---

## Endpoint contract

### `POST /global-effect-slots/:slotId/intensity`
Body: `{ "value": <number 0..1> }`

- `value` non-finite / missing / non-number → **400**
  `{ error: 'body must include value: a finite number in [0..1]' }`.
- `value` out of [0..1] → **clamped** (not rejected).
- Slot has no effect / effect has no primary / unknown slotId → **400**
  with the manager's message.
- Success **200**:
  `{ status: 'ok', slotId, intensity, paramValue, applied }`
  where `intensity` is the stored 0..1, `paramValue` is the real mapped
  param value, `applied` is `true` iff a running effect was re-dispatched.

### `POST /global-effect-slots/:slotId/intensity/reset`
No body.

- Same 400 conditions (no primary / unknown slot).
- Success **200**: `{ status: 'ok', slotId, intensity, applied }` where
  `intensity` is the effect default normalized to 0..1.

### `GET /global-effect-slots/status` (extended)
Each slot object now additionally carries:
`intensity` (0..1 | null), `intensityDefault` (0..1 | null),
`intensityLabel` (string | null).

---

## Per-effect primary param table

GEM-library effects (slot-bindable today):

| effectId | label | param | min | max | default |
|---|---|---|---|---|---|
| `strobe` | Flash Strength | `intensity` | 0 | 1 | 1.0 |
| `dropHit` | Punch | `intensity` | 0 | 1 | 1.0 |
| `colorWash` | Wash Depth | `amount` | 0 | 1 | 0.7 |
| `feedbackTrails` | Trail Mix | `mix` | 0 | 1 | 0.5 |
| `invert` | — (null) | — | — | — | — |
| `vintageWhite` | — (null) | — | — | — | — |
| `blastWhite` | — (null) | — | — | — | — |
| `uvBlast` | — (null) | — | — | — | — |
| `fogger` | — (null) | — | — | — | — |

Party effects (declared now, jog-wheel-ready for when they are GEM-wired):

| module | label | param | min | max | default |
|---|---|---|---|---|---|
| `e1_beat_pump` | Pump Depth | `depth` | 0 | 1 | 0.5 |
| `e2_waterline_sweep` | Sweep Depth | `amount` | 0 | 1 | 0.7 |
| `e3_kick_punch` | Punch Strength | `intensityCeil` | 0 | 1 | 1.0 |
| `freeze_frame` (E4) | Hold Fade | `holdFadeMs` | 0 | 10000 | 0 |
| `palette_crush` (E6) | Crush | `amount` | 0 | 1 | 1.0 |
| `ocean_breath` (E9) | Breath Depth | `depth` | 0 | 0.6 | 0.4 |
| `frost_sparkle` (E10) | Sparkle Density | `density` | 0 | 0.2 | 0.02 |

`freeze_frame` is the only non-[0,1] primary (ms range). `ocean_breath`
depth caps at 0.6 (an ambient mode never fully blacks the rig);
`frost_sparkle` density caps at 0.2 (still → blizzard).

---

## Test results

- **New file:** `tests/global_effect_intensity.test.js` — **27 tests, all
  pass.** Covers: registry completeness + well-formedness; missing-declaration
  loud error vs explicit-null; every party module declares its primary;
  mapping math + inverse + clamp + non-[0,1] range; status intensity fields
  (real + null cases); `setSlotIntensity` write/clamp/garbage-reject/
  no-primary-reject/unknown-slot; LIVE re-apply to running wash + strobe;
  inactive slot persists without re-dispatch; dropHit trigger does not
  auto-fire; `resetSlotIntensity` restore + live + reject; getSlots/setSlots
  persistence; effect-swap drops stale intensity.
- **Related suites (regression):**
  `global_effect_macros`, `global_invert`, `global_effect_blackout`,
  `freeze_frame`, `palette_crush`, `ocean_breath`, `frost_sparkle`,
  `scheduled_tasks` — **151 tests, all pass.**
- **Full engine suite (`npm test`):** **1768 tests, 1762 pass, 6 fail.**
  All 6 failures are **pre-existing + environmental**, not from this change:
  5 in `audio_capture.test.js` (Windows requires a pinned mic —
  `device_not_configured`) and 1 in `osc_listener.test.js` (port-bind returns
  `EACCES` instead of `EADDRINUSE` on this box). Neither file references the
  effects/library/slot code touched here.
- **Boot check (`npm run check`):** exit 0 — the registry validates at load,
  so the engine boots clean (this is the loud-error path for a missing
  declaration).

## Safety

- No test binds/kills **:6968**; the live stack was untouched. All new tests
  are pure in-process (`GlobalEffectsController` + `GlobalEffectSlotManager`),
  no server bound. Engine boot port-cleanup scope unchanged.

## Files touched

Effects (added `primaryIntensity`): `strobe.js`, `dropHit.js`, `colorWash.js`,
`feedbackTrails.js`, `invert.js`, `vintageWhite.js`, `blastWhite.js`,
`uvBlast.js`, `fogger.js`, `e1_beat_pump.js`, `e2_waterline_sweep.js`,
`e3_kick_punch.js`, `freeze_frame.js`, `palette_crush.js`, `ocean_breath.js`,
`frost_sparkle.js`.
Lib: `global_effect_library.js` (registry + mapping), `global_effect_slot_manager.js`
(status fields + set/reset), `api_server.js` (2 endpoints).
Tests: `tests/global_effect_intensity.test.js` (new).

— 2026-07-08.
