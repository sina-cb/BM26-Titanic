# Dynamic group→bit assignment in the engine (kills hardcoded GROUP_TO_BIT)

**Date:** 2026-06-10
**Author:** agent (requested by Sina)
**Scope:** `marsin_engine/engine.js`, `marsin_engine/lib/api_server.js`,
`marsin_engine/models/*.viewmasks.js`, `docs/13_model_v2.md`

## What happened at deployment (root cause)

`loadModel()` in `marsin_engine/engine.js` carried a hardcoded
`GROUP_TO_BIT` table mixing group names from three different models
(test_bench, dome, Logsville). Two failure modes followed:

1. **Unknown groups got no bit.** The titanic model has 30 groups
   (`Berg Alpha`, `Right Front Wall Generator`, …) — none were in the
   table, so every titanic pixel loaded with `vMask = 0` and all
   view-mask selection silently died. This is the deployment failure.
2. **Stale sidecar indices were silently skipped.** The Logsville
   sidecar's `pixelIndices` predated a model re-export: `VintageOnly`
   (144–203) was actually tagging `LedBarsWall` pixels, and
   `RedwoodPARs` (204–221) pointed past the end of the 216-pixel model.
   The old code skipped out-of-range indices without a sound.

## What changed

### Engine (`loadModel`)

- `GROUP_TO_BIT` is gone. Base group bits are now **derived from the
  loaded model**: each distinct pixel `group` gets the lowest free
  power-of-two bit, in first-appearance order (stable — the simulator
  export writes pixels in fixed order). Max 31 bits (`vMask` is Int32
  in the WASM runtime); exceeding throws.
- Sidecar entries now declare membership by **group name** (preferred)
  or `pixelIndices`, with an optional explicit `bit`:
  - `{ name, groups }` — bit computed as OR of the groups' dynamic bits.
  - `{ name, bit, groups }` — explicit reserved bit, membership by
    group. For presets whose bit is hardcoded in pattern code.
  - `{ name, bit, pixelIndices }` — explicit bit, arbitrary pixels.
- Explicit bits are reserved **before** base-group assignment, so they
  can never collide (Logsville: base groups skip 0x40/0x80).
- **Everything fails loudly now** (codex P0): broken sidecar, unknown
  group name, duplicate name, colliding/non-power-of-two bit, and
  out-of-range pixel index all throw at load time.
- The engine logs the full `group → bit` table at startup and returns
  `groupBits` from `loadModel`; hot-reload carries it.

### API

- `GET /model/view-selection-options` now includes `groupBits` so
  operators/tools can verify the assignment instead of guessing.

### Sidecars

- `test_bench` / `summer_camp_dome`: converted to computed-bit
  `groups` form. Resulting bits are identical to before
  (`ParsAndBars` 0x05, `Apex` 0x03, `AllButApex` 0x0C).
- `summer_camp_logsville`: converted to explicit-bit + `groups` form,
  **fixing the stale pixel ranges**. Bits 0x40/0x80 kept because
  patterns 70–117 hardcode `MASK_REDWOOD_PARS = 64` /
  `MASK_VINTAGE_ONLY = 128`.

### Pattern compatibility

- Dome patterns (40, 44) hardcode bits 1/2/4/8 — first-appearance
  order on the dome model reproduces exactly those values. Verified.
- Logsville patterns keep 0x40/0x80 via the reserved explicit bits.
- Logsville *base* bits shifted vs the old table (e.g. `DJ Lights`
  1→4, `Redwoods1` 8→0x10) — no pattern references those literally
  (audited; patterns 71/74 had already removed raw base-bit checks).

## Validation

- `node --check` on all changed JS: pass.
- `git diff --check -- marsin_engine marsin_pb`: pass.
- `node engine.js --list`: pass.
- Dry-run `test_const` against **all four models** (test_bench, dome,
  logsville, titanic): exit 0, correct bit tables logged, no missing
  blend warnings.
- `node --test tests/pattern_mixer_masking.test.js`: 33/33 pass.
- HIL tests not run (no mixer/blend behavior change; engine boot path
  exercised by the four dry-runs).

## Follow-ups (not done here)

- Titanic has no `.viewmasks.js` sidecar yet — composite presets for
  the ship (e.g. `Bergs`, `Chimneys`, `SmallSails`) can now be added
  as simple `groups` entries.
- Consider injecting `MASK_<NAME>` constants into pattern source at
  compile time so patterns stop hardcoding preset bits entirely.

## Addendum (same day): pinned `groupBits` + `MASK_*` injection

Sina's review concern: derived first-appearance bits are deterministic
but *implicit* — reordering fixtures in the sim scene and re-exporting
would silently renumber the bits patterns hardcode. Decision: sidecars
own the contract (the MarsinLED/WASM `viewBit("name")` intrinsic is
deferred). Second pass on the same branch:

- **Pinned `groupBits`:** sidecars now export an explicit
  `groupBits = { '<group>': bit }` table. The engine validates it
  strictly against the loaded model (two-way coverage, power-of-two
  unique bits, no preset collisions — all throw) and uses it verbatim.
  Derived first-appearance assignment remains only for sidecar-less
  models, logged with a "pin me" hint.
- **All four models pinned**, including a new `titanic.viewmasks.js`
  locking the 30 titanic groups (no composite presets yet — task 011).
- **`MASK_*` constants in patterns:** `WasmHost.compile` (the single
  choke point for boot, mixer, live-edit API, and blend compiles)
  resolves referenced-but-undeclared `MASK_<NAME>` identifiers against
  the model's table (`lib/view_mask_constants.js`) and prepends them as
  one `var` line. Unknown name → loud compile error listing the model's
  known constants. A pattern's own `var MASK_X = ...` wins, so the 28
  Logsville patterns are untouched and still compile (verified with a
  live dry-run of `85_redwood_starry_canopy`).
- API: `/model/view-selection-options` additionally returns
  `maskConstants`.
- Probed the real MarsinScript compiler first: duplicate `var`
  declarations are legal, undefined variables are a compile error —
  the injection design leans on both.

Validation (second pass): 15/15 new unit tests
(`tests/view_mask_constants.test.js`, includes two end-to-end compiles
through the real WASM compiler), 33/33 mixer masking tests, dry-run
exit 0 on all four models with pinned tables logged, Logsville pattern
compile OK, `node --check` + `git diff --check` clean.
