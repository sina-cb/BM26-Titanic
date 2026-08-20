# _181 — Why the titanic calibration planes stop at ~0.5 (coordinate range story)

Date: 2026-08-06 · Agent: _181 (Fable debug, read-only) · Branch: feat/bm_readiness

## Question

During calibration with `marsin_engine/patterns/66/67/68_calibration_*_plane.js`
on the **titanic** model, the swept Position slider only finds pixels between
0 and ~0.5 on all three axes — not 0 to 1. Design or bug?

## Verdict

**Not a model bug, not an exporter bug, not a calibration-pattern bug.**
The model data is perfect. The compression is the **engine-owned global SIZE
fader**, which is persisted at `size: 0.773` in the titanic scene state and
divides every coordinate the patterns see by ~2.13. It is *by design* as a
show feature — and a **calibration-workflow footgun** in this context.

## Measured truth (read-only probe of shipped model files)

Probe: `~/tmp/fix_181/probe_ranges.mjs` (pure node import of the model files;
no engine boot, no sockets).

| Model | pixels | nx | ny | nz | world x | world y | world z |
|---|---|---|---|---|---|---|---|
| titanic | 964 | **0 → 1** | **0 → 1** | **0 → 1** | -50.318 → 45.454 | 0.25 → 14.9 | -26.379 → 16.156 |
| test_bench | 166 | **0 → 1** | **0 → 1** | **0 → 1** | -2.764 → 2 | 0.625 → 10.055 | -0.5 → 1 |

Every axis of both shipped models spans the full [0..1]. The exporter uses
**per-axis independent min/max normalization** (not aspect-preserving):
`simulation/src/dmx/pixelblaze_model_exporter.js:639-654` —
`nx = (x - minX) / rangeX` etc., each axis stretched to fill 0..1 on its own.

## The mechanism (file:line chain)

1. **Patterns read live coords** — `render3D(index, x, y, z)` receives whatever
   is in the WASM coord buffer; the calibration patterns compare that directly
   to the 0..1 Position slider (`abs(x - position) <= halfWidth`).
2. **WasmHost seeds the buffer from nx/ny/nz** —
   `marsin_engine/lib/wasm_host.js:196-214` (`setCoords`) caches the original
   normalized coords and loads them into the live buffer.
3. **Engine-owned global SIZE rescales the buffer every frame** —
   `marsin_engine/lib/wasm_host.js:232+` (`applySizeScale`): live coord =
   original ÷ sizeMult ("size = 2 → pattern samples from half the coord
   range"). Called from the render loop at `marsin_engine/engine.js:791`.
4. **Fader → multiplier mapping** — `marsin_engine/engine.js:763-770`:
   `mult = 0.25 · 16^size`, so fader 0.5 = identity (1×), fader 0 = 0.25×,
   fader 1 = 4×. Default is 0.5 (`marsin_engine/lib/param_center.js:53-59`,
   `persist: true`).
5. **The titanic scene has a persisted non-default SIZE** —
   `marsin_engine/states/titanic/globals_state.yaml:13-17`: `size: 0.773`
   (set by the operator at some earlier session via CPC/MFT/OSC, persisted,
   restored at boot with `lastSource: init`).

Arithmetic: `0.25 · 16^0.773 ≈ 2.13` → live coords span `0 → 1/2.13 ≈ 0.469`
on **all three axes** — exactly the "0 → 0.5" the operator observed.

Contrast: `marsin_engine/states/test_bench/globals_state.yaml:16-17` has
`size: 0.5` → identity → calibration on test_bench reads a clean 0 → 1,
which is why the bench calibrated "correctly" and the ship didn't.

## Consequences for pattern authors

- **Never assume render3D coords top out at 1.** The visible coordinate range
  is `[0 .. 1/sizeMult]` with sizeMult ∈ [0.25, 4]: anywhere from 0..0.25
  (SIZE fader full up) to 0..4 (fader full down). Write patterns with
  periodic/wave functions or thresholds relative to a scale, not hard 0..1
  edge assumptions. This is the intended contract — SIZE makes features grow
  or tile denser for free on every pattern.
- **Model coords are per-axis stretched, not aspect-preserving.** On titanic,
  x=0→1 covers ~96 world units while y=0→1 covers ~14.7. Euclidean distances
  in (nx,ny,nz) space are geometrically distorted; radial/circular effects
  will look squashed along the ship unless the pattern compensates with the
  world-coordinate lanes or its own aspect factors.
- **Calibration procedure**: before trusting the plane patterns, set the
  global SIZE fader to exactly 0.5 (identity). At any other value the
  Position slider's "plane at 0.5" is a lie relative to the model. Today's
  titanic readings are internally consistent — every pixel's reading is just
  divided by 2.13 — so no remapping work done during this session is wrong,
  only compressed.

## If a change were wanted (described only — nothing changed)

Options, cheapest first:
1. **Procedure only**: document "SIZE=0.5 before calibration" in the
   calibration skill/runbook. Zero code.
2. **Pattern-level opt-out**: let a pattern declare it wants unscaled coords
   (e.g. an exported flag the engine checks before `applySizeScale`, or a
   calibration-only shared fn exposing sizeMult so the pattern can multiply
   it back out).
3. **Engine-level**: pin `applySizeScale(1)` while any `*_calibration_*`
   pattern is active. Most magic, least operator burden, most special-casing.

No fix is required for correctness of the model, exporter, or engine — all
behave per their documented contracts.
