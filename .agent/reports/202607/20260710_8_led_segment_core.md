# 2026-07-10 — LED segment core (plan 20260710_2, Slice L1)

**Branch:** `feat/led_integration` (worktree `kind-banach-95157b`). **No git ops.**
**Owns (only):** `simulation/src/dmx/led/led_patch_projection.js`,
`simulation/tests/led_patch_projection.test.js`.
**Tests:** `node --test tests/led_patch_projection.test.js` → **25 pass / 0 fail**
(13 pre-existing + 12 new). Full `npm test` intentionally NOT run (coordinator owns
the authoritative suite).

## What L1 delivers

The pure segment-walker core for DMX-parity multi-universe LED layout. Every new
output is a **derived view over the SAME `projectLedStrandPixels` walk** — zero
byte movement, so bound-controller layouts stay byte-identical (docs/41 §3).

1. **`projectLedStrandSegments(universe, channel, stride, count)`** — new pure
   export. Groups the single-source pixel walker's output into per-universe
   contiguous runs. Identical-by-construction (it *calls* `projectLedStrandPixels`
   and buckets the pixels; no re-derived layout math).
2. **`computeLedStrandPatches` records gained** `segments`, `endUniverse`,
   `endChannel`. `dmxUniverse`/`dmxAddress` still the strand START (bytes
   unchanged). Existing fields untouched. The one `projectLedStrandPixels` call in
   the walk loop is now `projectLedStrandSegments` (one walk, both views).
3. **`computeLedUniverseClaims(boundFields, genericFields)`** — new pure export:
   the LED mirror of `computeProjection().universeMaps`. Bound records use their
   pre-walked `segments`; generic (unbound, START-only) records are walked here via
   the same `projectLedStrandSegments`. Never touches the registry. Taken as inputs
   (not imported) to avoid a cycle with `controller_registry.js`.

`projectLedStrandPixels`, `computeLedStrandPatches` (all prior fields),
`ledUniverseHonorability`, `validateLedManualUniverses` remain exported and
byte-identical.

## Goldens proven (RGBW stride 4 unless noted)

- 200 px @ U6 → `[U6 ch1–512 ×128, U7 ch1–288 ×72]`, endUniverse 7, endChannel 288,
  next cursor U7 ch289.
- 40 px @ U6 → single `[U6 ch1–160]`, endChannel 160.
- Two 100 px strands chained on one port: A `[U6 ch1–400]`; B mid-strand spill
  `[U6 ch401–512 ×28, U7 ch1–288 ×72]`.
- startAddr 511 no-straddle: whole strand rolls to U7 ch1; **no segment touches
  U6 511–512**; segment view == pixel walker.
- startAddr 3, 129 px misalignment → `[U6 ch3–510 ×127, U7 ch1–8 ×2]` == walker.
- Equivalence property: segments reconstruct the pixel walker exactly across
  startAddr ∈ {1,2,3,509,511,512} × count ∈ {1,40,127,128,129,200,256} × stride ∈ {3,4,5}.
- Claims: 200 px spill claims both U6 and U7; two strands sharing U7 both appear,
  sorted by start then name; generic START-only records walked into segments.

Note: three pre-existing `deepEqual` full-record goldens were updated to include
the three GAINED fields (records only gain fields — the plan's regression rule).

## Downstream (L2/L3) consumption

L2 (`pixelblaze_model_exporter.js`) already imports `projectLedStrandPixels` — no
new dependency. L3 consumes `segments` + `computeLedUniverseClaims` (persistence,
subscription, spill reservation, UI bars). Public signatures in the handoff message.
