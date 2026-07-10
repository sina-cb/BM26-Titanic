# 2026-07-10 — Slice L2: exporter LED per-pixel parity (fixes G3)

**Branch:** `feat/led_integration` (worktree `kind-banach-95157b`).
**Plan:** `.agent/plans/20260710_2_led_universe_layout.md` → Slice L2.
**Owns (only files touched):**
`simulation/src/dmx/pixelblaze_model_exporter.js`,
`simulation/tests/pixelblaze_model_exporter_local_index.test.js`.

## Problem (G3)

For UNBOUND LED controllers the exporter computed each pixel's `{universe, addr}`
with its own dense-byte formula (`uniSpan = floor(startByte / 512)`,
`pixelblaze_model_exporter.js:320-334`). That formula ignores the tail bytes
skipped at each no-straddle universe wrap, so it diverged from the canonical
walker (`projectLedStrandPixels`) — and from the firmware/patches — whenever
`(startAddr − 1) % stride ≠ 0`. Worked example (stride 4, startAddr 3): pixel
128 lands at `U4 ch5` per the walker but `U4 ch3` per the old formula.

## Fix

Routed the unbound per-pixel LED addressing through the **same walker** the
device-bound path and patches.yaml already use — one source of truth, no
re-derived math:

- Replaced the device-only `devicePixels` precompute + the two-branch per-pixel
  logic with a single `ledPixels = projectLedStrandPixels(proj.universe,
  proj.addr, proj.stride, count).pixels` walk for **every** patched strand
  (device-bound and unbound). Both read `ledPixels[j]` and emit
  `{universe, addr, footprint: stride, led: true}`.
- Deleted the divergent dense-byte formula entirely.
- Walker `overflow` now **throws loudly** (codex P0) instead of silently
  exporting a truncated model — the device-bound path shares this walker, so
  both paths are protected.
- Imports: dropped now-unused `DMX_UNIVERSE_SIZE`, added `MAX_UNIVERSE`
  (for the overflow message). Imports stay at top of file.

The unpatched-marker contract for `!proj` (patch:null + unpatched:true) is
untouched.

## Tests

Extended `pixelblaze_model_exporter_local_index.test.js` (imported
`projectLedStrandPixels` to assert parity directly):

- **G3 unbound misaligned start** — stride 4, startAddr 3, 130 px: asserts
  pixel 127 = `U4 ch1`, pixel 128 = `U4 ch5` (the exact divergence), and every
  pixel equals the walker byte-for-byte.
- **G3 unbound stride-aligned** — startAddr 1, 200 px @ U3: pixel 127 = `U3
  ch509`, pixel 128 spills whole to `U4 ch1`, pixel 199 = `U4 ch285`; whole
  strand equals the walker (the case that was already byte-identical, now
  asserted).

Run (only this file, `three` npm-installed --no-save):

```
node --test tests/pixelblaze_model_exporter_local_index.test.js
→ tests 13, pass 13, fail 0
```

## Bound output unchanged — confirmation

Bound (device-linear) strands already flowed through `projectLedStrandPixels`;
the fix only unifies the unbound branch onto that same call. The two existing
device-bound goldens (`U3 ch1–160 / ch161–320`, disabled-middle-output cursor
continuity) and the unpatched-loud test pass **unchanged**. Bound per-pixel
emission is byte-for-byte identical before and after — zero hardware byte
movement.

## Scope notes

- No changes to device-bound emission, `channels` maps, `whiteMode`,
  `localIndex`, group tagging, or the DMX sections.
- Any layout where `(startAddr − 1) % stride == 0` (every shipped scene —
  startAddr defaults to 1) is byte-identical. Only non-default-aligned unbound
  strands change, moving them into agreement with the walker/patches.
- L1 (`projectLedStrandSegments`, segments records) landed already and was
  consumed read-only. L3/L4 remain for their owners.
