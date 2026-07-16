# 2026-07-10 — Exporter adopts device-linear LED layout (LED integration P5)

**Branch:** `feat/led_integration` (worktree `kind-banach-95157b`).
**Plan:** `.agent/plans/20260709_0_led_integration_execution.md` — the **P5
"model re-export"** item flagged as the "Key known gap" in
`.agent/reports/202607/20260709_3_led_discovery_ui.md`.
**No git operations performed.** No hardware touched (pure/DOM-mock tests only).

## The defect

For a **device-bound multi-output** MarsinLED controller, the scene exporter
(`pixelblaze_model_exporter.js`) computed every strand's LED patch through the
registry's `computeLedProjection`, which **resets the channel cursor at the
start of every port**. So two 40px RGBW lines on ports 1 & 2 both landed at
**U3 ch1** — disagreeing with (a) the physical device's *contiguous* linear
firmware layout (docs/41 §3) and (b) `patches.yaml`, which `led_patch_projection.js::computeLedStrandPatches`
already produced correctly (strand A U3 ch1–160, strand B U3 ch161–320). The
auto-generated engine model therefore lit the second strand at the wrong
channels on hardware.

## Fix (scope)

Make the exporter emit the **device-linear** layout for controllers carrying a
`device:` binding, byte-for-byte identical to `computeLedStrandPatches` /
`patches.yaml` / the firmware — while leaving **unbound** controllers on the
existing generic per-port projection unchanged (they have no firmware to agree
with). Reuse `computeLedStrandPatches` rather than duplicate its math; fail
loud on an internally inconsistent registry (codex P0, no guessed addresses).

### How
- Both projections are computed from the same registry. The exporter starts
  from the generic per-strand projection, then **overrides** each device-bound
  strand's `universe`/`addr` with the device-linear start from
  `computeLedStrandPatches`. Order, stride and whiteMode are firmware semantics
  read from the same `controller.led`, so they carry over unchanged — only the
  address differs. A device-linear strand with no generic lane is impossible
  (both walk the same ports/chains); if it ever occurs the exporter **throws**
  rather than guess.
- The per-pixel `{universe, addr}` walk is now a single shared source of truth:
  extracted `projectLedStrandPixels(universe, channel, stride, count)` in
  `led_patch_projection.js`. `computeLedStrandPatches` uses it to place each
  strand's start + advance the contiguous cursor; the exporter uses it to emit
  each device-bound pixel's span. This guarantees agreement for *any* stride
  (the old dense-byte wrap in the exporter diverges for strides that don't
  divide 512, e.g. RGB stride 3 — that path is retained only for unbound
  strands, matching prior behavior).
- Unassigned/disabled outputs contribute 0 pixels; a sim strand on no output
  still exports the LOUD unpatched marker (`patch: null` + `unpatched: true`).

## Files

### Modified
- `simulation/src/dmx/led/led_patch_projection.js` — new exported pure
  `projectLedStrandPixels(...)` (the shared contiguous-layout walker);
  `computeLedStrandPatches` refactored to call it (behavior identical — its 10
  golden tests unchanged and green).
- `simulation/src/dmx/pixelblaze_model_exporter.js` — imports
  `computeLedStrandPatches` + `projectLedStrandPixels`; computes both
  projections; merges with a device-bound override + fail-loud guard;
  per-pixel loop branches device-linear (shared walker) vs generic (unchanged
  dense wrap).
- `simulation/tests/pixelblaze_model_exporter_local_index.test.js` — +4 tests
  (below).

## Tests

Extended the exporter test file with:
1. **device-bound golden**: 2×40px RGBW on ports 1&2 → lineA U3 ch1–160
   (pixel0 addr1 … pixel39 addr157), lineB **contiguous** U3 ch161–320 (pixel0
   addr161 … pixel39 addr317); footprint 4/pixel; channels `{r:1,g:2,b:3,w:4}`.
2. **disabled/unassigned middle output skipped**: lineC on output 3 still
   follows lineA's 160 channels at U3 ch161 (empty output 2 contributes 0 px).
3. **strand on no output** exports `patch:null` + `unpatched:true` (loud), its
   patched sibling unaffected.
4. **unbound controller UNCHANGED**: same rig without `device:` keeps the
   generic per-port projection — both lines start at U3 ch1 (old behavior).

- Exporter file alone: **7 pass, 0 fail**.
- Full sim suite `node --test tests/*.test.js`: **190 pass, 0 fail** (was 186;
  +4 new, `three` npm-installed `--no-save` in this worktree).

## Exact engine-model output (golden case)

Serialized `marsin_engine/models/<scene>.js` pixel lines (cId/sId/fId elided):

```js
{ i: 0,  type: 'led', name: 'lineA', group: 'lineA', ... localIndex: 0,  patch: { universe: 3, addr: 1,   footprint: 4, led: true }, channels: {"r":1,"g":2,"b":3,"w":4}, whiteMode: 'native' },
{ i: 39, type: 'led', name: 'lineA', group: 'lineA', ... localIndex: 39, patch: { universe: 3, addr: 157, footprint: 4, led: true }, channels: {"r":1,"g":2,"b":3,"w":4}, whiteMode: 'native' },
{ i: 40, type: 'led', name: 'lineB', group: 'lineB', ... localIndex: 0,  patch: { universe: 3, addr: 161, footprint: 4, led: true }, channels: {"r":1,"g":2,"b":3,"w":4}, whiteMode: 'native' },
{ i: 79, type: 'led', name: 'lineB', group: 'lineB', ... localIndex: 39, patch: { universe: 3, addr: 317, footprint: 4, led: true }, channels: {"r":1,"g":2,"b":3,"w":4}, whiteMode: 'native' },
```

lineB at **U3 ch161** (not ch1) confirms the exporter, `patches.yaml`
(`computeLedStrandPatches`), and the device's contiguous firmware layout now
agree byte-for-byte.

## Decisions / notes
- **Non-bound LED controllers are deliberately unchanged** — the device-linear
  layout applies *only* when a `device:` binding declares the firmware
  semantics. Existing generic per-port rigs/tests are untouched.
- `computeLedProjection` itself was **not** modified (P2 boundary + suite
  stability); the exporter merges over its output.
- Fail-loud guard: a device-bound strand missing its generic lane throws
  (impossible with a consistent registry — no silent address fabrication).
