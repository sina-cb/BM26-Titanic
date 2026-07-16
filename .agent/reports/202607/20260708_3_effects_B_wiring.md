# Effects Builder B — wiring spec for E4 / E6 / E9 / E10

- **Role:** Effects Builder B (standalone per-frame transforms).
- **Branch:** `feat/party_integration_20260711`.
- **Scope:** 4 NEW standalone effect modules + their tests. This spec tells
  Builder A / the coordinator EXACTLY how to wire each into the chain. Builder
  B touched ONLY new files (see "Files" at the bottom) — no shared/orchestration
  file was edited.
- **Spec source:** `20260708_2_effects_review_and_impl_plan.md` (Table 2 +
  GEM/panicStop table) and `20260708_1_global_effects_proposals.md`
  (per-frame math).

The 4 modules are **pure per-frame transforms** and need no chain
restructuring. Two are stateless (E6, E9); two carry a lazy buffer held in an
**explicit state object** the controller must own and pass in each frame
(mirroring how `feedbackTrails` owns its Float32 buffer and `dropHit` owns its
envelope list — Builder B could not touch the controller to hold them itself).

Chain reference (current `applyMacros` order, then post-macro stages), per
report-2:
`wash(1) → trails(2) → dropHit(3) → strobe(4)` → `invert` → `groupLocks` →
`intensity` → `blackout`.

---

## Module signatures (verified against neighbors)

All four export a named apply fn plus an `*Effect` object, matching the
existing `effects/*.js` style (ESM `export function`, `export const xEffect`).

```js
// effects/palette_crush.js  — STATELESS
applyPaletteCrush({ pixels, levels, amount })

// effects/ocean_breath.js   — STATELESS (self-clocked off nowMs)
applyOceanBreath({ pixels, nowMs, periodMs, depth, warmth })
oceanBreathPhase({ nowMs, periodMs, depth, warmth }) -> { b, warm }  // helper

// effects/freeze_frame.js    — STATEFUL (explicit state object)
createFreezeState() -> { buffer, pixelCount, captured, engagedAtMs }
applyFreezeFrame({ pixels, state, active, nowMs, holdFadeMs = 0 })

// effects/frost_sparkle.js   — STATEFUL (explicit state object) + optional audio
createSparkleState({ rng } = {}) -> { spark, pixelCount, activeCount, lastMs, rng }
resetSparkle(state)   // panicStop / disable path — clears live glints
applyFrostSparkle({ pixels, state, enabled, nowMs, density,
                    decayMs = 200, intensity = 1, audioDensity = false, signals })
```

Each module also exposes a bundle object for import convenience:
`paletteCrushEffect`, `oceanBreathEffect`, `freezeFrameEffect`,
`frostSparkleEffect` (the last two carry `.createState` / `.reset`).

---

## E4 — Freeze Frame

- **Import (top of `global_effects_controller.js`, with the other effect imports):**
  ```js
  import { freezeFrameEffect } from '../effects/freeze_frame.js';
  ```
- **Controller state (constructor):**
  ```js
  this.freeze = { active: false, holdFadeMs: 0 };
  this._freezeState = freezeFrameEffect.createState();  // lazy buffer holder
  ```
- **Insertion point — FIRST in `applyMacros`, step 0, BEFORE colorWash.** The
  frozen frame is the base; wash/sweep/strobe still animate on top (report-2
  §Interactions: "wash/sweep/strobe still animate on the frozen base").
  ```js
  // step 0 — before wash:
  freezeFrameEffect.apply({
    pixels, state: this._freezeState,
    active: this.freeze.active, nowMs, holdFadeMs: this.freeze.holdFadeMs,
  });
  ```
  When `active` is false the call is a cheap no-op (it early-returns and clears
  the prior capture), so no extra gate is required — but keep the standard
  `if (this.freeze.active)` guard around it for the zero-cost-when-off idiom if
  you prefer symmetry with the other stages.
- **Channels:** REPLACES all 6 (R/G/B/W/A/U) — it replays a real composited
  frame, so W/A/U ARE part of the snapshot (this is NOT a chroma op; the
  RGB-only rule does not apply because we are freezing, not recoloring).
- **Params + ranges:**
  | param | type | range | default | notes |
  |---|---|---|---|---|
  | `holdFadeMs` | knob | `0`..`10000` | `0` | `0` = hold forever; else linear fade-to-black over this many ms |
  | `mode` | armed/momentary | `hold` \| `toggle` | `toggle` | drives whether `active` is momentary (down/up) or latched |
- **GEM slot entry (`GLOBAL_EFFECT_LIBRARY.freeze`):**
  ```js
  freeze: {
    id: 'freeze', name: 'Freeze Frame', category: 'time',
    behaviorTypes: ['toggle', 'hold'], singleton: true,
    presets: {
      hold:        { label: 'Hold', params: { holdFadeMs: 0 },    defaultBehavior: 'toggle' },
      fade_2s:     { label: 'Fade 2s', params: { holdFadeMs: 2000 }, defaultBehavior: 'toggle' },
      stutter:     { label: 'Stutter', params: { holdFadeMs: 0 },  defaultBehavior: 'hold' },
    },
    apply: freezeFrameEffect.apply,
  },
  ```
  Default binding: one GEM slot, toggle behavior, `hold` preset.
- **`_isSlotActive` reads:** `c.freeze.active`.
- **panicStop: YES — kill it.** Set `this.freeze.active = false`
  (releasing the freeze). The next engage re-captures automatically.
- **Mutex:** report-2 marks E5 Beat Echo as mutually exclusive with Freeze
  (same "time" family). E5 is not in this deliverable; when it lands, enforce
  the singleton mutex in dispatch.

---

## E6 — Palette Crush

- **Import:**
  ```js
  import { paletteCrushEffect } from '../effects/palette_crush.js';
  ```
- **Controller state:**
  ```js
  this.crush = { enabled: false, levels: 4, amount: 1 };
  ```
- **Insertion point — new chroma stage AFTER `invert`, BEFORE `groupLocks`.**
  Report-2 Table 2: "new chroma stage after invert, before groupLocks
  (RGB-only)". A crushed image inverts crisply and the quantization bands stay
  stable when crush runs after invert.
  ```js
  // post-macro, after applyInvert(pixels), before applyGroupFixedColors(pixels):
  if (this.crush.enabled) {
    paletteCrushEffect.apply({
      pixels, levels: this.crush.levels, amount: this.crush.amount,
    });
  }
  ```
- **Channels:** RGB-only. W/A/U byte-for-byte untouched (same protection as
  invert / hue_shift). The module enforces this internally.
- **Params + ranges:**
  | param | type | range | default | notes |
  |---|---|---|---|---|
  | `levels` | stepped knob | `2`..`8` (int) | `4` | clamped + rounded inside the module |
  | `amount` | knob | `0`..`1` | `1` | blend original↔quantized; `0` = no-op |
- **GEM slot entry:**
  ```js
  crush: {
    id: 'crush', name: 'Palette Crush', category: 'color',
    behaviorTypes: ['toggle'], singleton: true,
    presets: {
      hard_2:  { label: '2-level', params: { levels: 2, amount: 1 },   defaultBehavior: 'toggle' },
      bold_4:  { label: '4-level', params: { levels: 4, amount: 1 },   defaultBehavior: 'toggle' },
      soft_6:  { label: '6-level soft', params: { levels: 6, amount: 0.6 }, defaultBehavior: 'toggle' },
    },
    apply: paletteCrushEffect.apply,
  },
  ```
  Default binding: toggle, `bold_4` preset.
- **`_isSlotActive` reads:** `c.crush.enabled`.
- **panicStop: NO — preserve it.** Static chroma, like `invert`. Report-2 GEM
  table: E6 = **NO**. Document alongside the invert/groupFixedColors note in
  the controller header.

---

## E9 — Ocean Breath

- **Import:**
  ```js
  import { oceanBreathEffect } from '../effects/ocean_breath.js';
  ```
- **Controller state:**
  ```js
  this.breath = { enabled: false, periodMs: 8000, depth: 0.4, warmth: 0.2 };
  ```
- **Insertion point — gate stage at the END of `applyMacros`** (with
  pump/strobe), per report-2 Table 2 ("gate stage, END of applyMacros"). It
  sits before `intensity`/`blackout` so dimmers still cap it.
  ```js
  // END of applyMacros, alongside the other gate-family effects:
  if (this.breath.enabled) {
    oceanBreathEffect.apply({
      pixels, nowMs,
      periodMs: this.breath.periodMs, depth: this.breath.depth, warmth: this.breath.warmth,
    });
  }
  ```
- **Channels:** GATE — scales R/G/B/W/U by the swell `b`; deliberately breathes
  the amber floor (px.a) UP at the trough (`a = a*b + warm`, clamped). This is
  the one place amber is intentionally driven (a warmth gesture, not a hue).
  UV rides the swell, no warmth add.
- **Self-clocked — NO signals bag.** Phase derives from `nowMs`/`periodMs`.
  `periodMs <= 0` **throws** (fail-loud; do not pass 0).
- **Params + ranges:**
  | param | type | range | default | notes |
  |---|---|---|---|---|
  | `periodMs` | knob | `4000`..`20000` | `8000` | swell period; must be > 0 |
  | `depth` | knob | `0`..`0.6` | `0.4` | swell dims to `1-depth` at the crest of cos |
  | `warmth` | knob | `0`..`1` | `0.2` | amber floor amount lifted at the trough |
- **GEM slot entry:**
  ```js
  breath: {
    id: 'breath', name: 'Ocean Breath', category: 'ambient',
    behaviorTypes: ['toggle'], singleton: true,
    presets: {
      calm:    { label: 'Calm 8s',  params: { periodMs: 8000,  depth: 0.35, warmth: 0.2 }, defaultBehavior: 'toggle' },
      deep:    { label: 'Deep 14s', params: { periodMs: 14000, depth: 0.5,  warmth: 0.3 }, defaultBehavior: 'toggle' },
      sunrise: { label: 'Sunrise',  params: { periodMs: 20000, depth: 0.4,  warmth: 0.5 }, defaultBehavior: 'toggle' },
    },
    apply: oceanBreathEffect.apply,
  },
  ```
  Default binding: toggle, `calm` preset.
- **`_isSlotActive` reads:** `c.breath.enabled`.
- **panicStop: NO — preserve it (RECOMMENDED).** Slow ambient, no flash hazard.
  Report-2 GEM table: **NO** (matching the invert precedent). If Sina prefers
  "one hard kill of everything", flip to YES — but the recommendation is NO.
  Document the choice in the controller header.

---

## E10 — Frost Sparkle

- **Import:**
  ```js
  import { frostSparkleEffect } from '../effects/frost_sparkle.js';
  ```
- **Controller state:**
  ```js
  this.sparkle = { enabled: false, density: 0.02, decayMs: 200, intensity: 1, audioDensity: false };
  this._sparkleState = frostSparkleEffect.createState();  // default rng = Math.random
  ```
- **Insertion point — overlay AFTER `trails`, BEFORE `dropHit`.** Report-2
  Table 2: "AFTER trails". Glints should NOT smear by default; placing them
  after `feedbackTrails` keeps them crisp. (A future `beforeTrails` preset flag
  could opt into comet-glints — not built here.)
  ```js
  // in applyMacros, between feedbackTrails (step 2) and dropHit (step 3):
  if (this.sparkle.enabled) {
    frostSparkleEffect.apply({
      pixels, state: this._sparkleState, enabled: true, nowMs,
      density: this.sparkle.density, decayMs: this.sparkle.decayMs,
      intensity: this.sparkle.intensity,
      audioDensity: this.sparkle.audioDensity,
      signals,   // the report-2 signals bag; may be undefined — module is safe
    });
  }
  ```
- **Channels:** OVERLAY into the **W channel ONLY** (additive, clamped). W is
  untouched by downstream hue rotation and invert, so a glint stays crisp
  white no matter what chroma effect runs after it — the deliberate use of the
  channel convention from report-1 §E10. R/G/B/A/U are never written.
- **`signals` consumed:** ONLY `signals.micHigh` (0..1, high-band envelope —
  the CORRECTED CPC key from report-2's table). Read only when
  `audioDensity: true`. If `signals` is absent/undefined or `micHigh` is
  missing/non-finite, the module treats it as **0** and does NOT throw. Builder
  A owns whether the bag is assembled; the module is safe either way.
- **Params + ranges:**
  | param | type | range | default | notes |
  |---|---|---|---|---|
  | `density` | knob (THE knob) | `0`..`~0.2` | `0.02` | expected fraction of pixels spawned per ~25 ms tick; ambient≈0.01, blizzard≈0.15 |
  | `decayMs` | knob | `40`..`800` | `200` | larger = longer trails; `0` = single-frame glints |
  | `intensity` | preset | `0`..`1` | `1` | peak W written per glint |
  | `audioDensity` | toggle | bool | `false` | adds `signals.micHigh` to `density` |
- **GEM slot entry:**
  ```js
  sparkle: {
    id: 'sparkle', name: 'Frost Sparkle', category: 'overlay',
    behaviorTypes: ['toggle'], singleton: true,
    presets: {
      fizz:     { label: 'Fizz',    params: { density: 0.01, decayMs: 400, intensity: 1, audioDensity: false } },
      blizzard: { label: 'Blizzard',params: { density: 0.15, decayMs: 80,  intensity: 1, audioDensity: false } },
      hihat:    { label: 'Hi-Hat',  params: { density: 0.0,  decayMs: 120, intensity: 1, audioDensity: true  } },
    },
    apply: frostSparkleEffect.apply,
  },
  ```
  Default binding: toggle, `fizz` preset.
- **`_isSlotActive` reads:** `c.sparkle.enabled`.
- **panicStop: YES — kill it AND clear the field.** Set
  `this.sparkle.enabled = false` **and** call
  `frostSparkleEffect.reset(this._sparkleState)`. A plain early-return on
  `enabled=false` would freeze live glints mid-air; `reset` empties the spark
  array so nothing lingers. (The disable path in the setter should do the same
  `reset` for the same reason.)

---

## Signals bag — what E10 needs

Only E10 consumes `signals`, and only `signals.micHigh`. The bag is assembled
in `engine.js` `tick()` per report-2's spec and passed through `applyMacros`
into the controller, which forwards it to `frostSparkleEffect.apply`. If the
bag is not yet plumbed, pass `undefined` — E10 degrades to non-audio mode
(audioDensity contribution 0) with no error. No other effect in this
deliverable reads `signals`.

---

## Verification (Builder B, this session)

- `node --check` on all 4 modules + all 4 tests: **PASS** (8/8 OK).
- `node --test tests/{palette_crush,ocean_breath,freeze_frame,frost_sparkle}.test.js`:
  **37 tests, 37 pass, 0 fail.**
- Engine dry-run (`npm run check:rainbow` → `node engine.js --pattern rainbow
  --model test_bench --dry-run`): **exit 0, no missing-blend warning.** (The new
  modules are not yet imported by the engine — that is this wiring step — so the
  dry-run only proves the engine still boots clean.)
- **NOTE for coordinator:** the auto-checks spec references `npm run check`
  (dry-run) but `marsin_engine/package.json` has **no `check` script** — only
  `check:rainbow` / `check:breathing` / `check:fire`. Consider adding the
  `check:syntax` + `check:dry-run` + `check` scripts from
  `.agent/ops/marsin_engine_auto_checks.md` §"Package Script Target". Builder B
  did not add them (package.json is a shared file, out of Builder B's ownership).
- Builder B did **NOT** run the full `npm test` (to avoid churn) — only the 4
  new test files.

## Per-frame cost (970-px titanic worst case; studio ≈ 4× cheaper)

| Effect | Cost when ON | Cost when OFF |
|---|---|---|
| **E6 Palette Crush** | ~9 ops/px (3 ch × [mul, round, mul, lerp]) + 1 reciprocal/frame. Cheapest. | zero (gated) |
| **E9 Ocean Breath** | 1 `cos` + a few scalars/frame, then ~6 mul/add per px. | zero (gated) |
| **E4 Freeze Frame** | capture frame = 6 writes/px (first active frame only); held frame = 6 reads + up to 6 mul/px (fade), or 6 copies when `holdFadeMs=0`. | zero (early-return no-op) |
| **E10 Frost Sparkle** | spawn = ~`density·px·dtScale` RNG picks; decay+draw = only pixels with live energy ([read, add, mul]); whole pixel loop skipped when the field is empty. | zero (gated); on disable also `reset()` to clear the field |

All hot loops are allocation-free; the two stateful effects lazily allocate
their buffer on first use and reallocate only when the pixel count changes.

## Files created (ONLY these — no shared/orchestration file touched)

```
marsin_engine/effects/palette_crush.js
marsin_engine/effects/ocean_breath.js
marsin_engine/effects/freeze_frame.js
marsin_engine/effects/frost_sparkle.js
marsin_engine/tests/palette_crush.test.js
marsin_engine/tests/ocean_breath.test.js
marsin_engine/tests/freeze_frame.test.js
marsin_engine/tests/frost_sparkle.test.js
.agent/reports/202607/20260708_3_effects_B_wiring.md   (this spec)
```

Builder B did NOT edit `global_effects_controller.js`,
`global_effect_slot_manager.js`, `engine.js`, `global_effect_library.js`, any
existing effect module, `package.json`, or any CaptainPad file.

— Effects Builder B, 2026-07-08.
