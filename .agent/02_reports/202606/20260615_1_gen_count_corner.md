# Slot 1 — gen_count_corner

- **Branch:** dev/claude/gen_count_corner
- **Parent branch:** claude/intelligent-knuth-j6cba1
- **Worktree:** ~/BM26-Titanic-worktrees/gen_count_corner
- **Slot ports:** sim HTTP 31169, save 31170, sACN 31171/31172 (config.yaml
  edited only in-worktree, reverted before commit)

## Scope

Two changes to the DMX generator (the "trace" feature in
`simulation/src/gui/gui_builder.js`):

1. **Number of lights instead of spacing.** The point count along a trace
   path is now driven by an explicit integer `trace.count` (>= 1) the user
   sets directly, replacing the old `spacing`-derived count. Fixture width is
   kept only as informational (no longer drives the count).
2. **New `corner` path type** — two straight segments meeting at one corner
   vertex (start / corner / end), with `count` lights distributed evenly
   across the whole polyline and three draggable handles.

## Files changed

`git diff --name-status HEAD~1..HEAD`:

```
M  simulation/src/core/config.js
M  simulation/src/gui/gui_builder.js
```

### config.js

- New `normalizeTraces(traces)` performs a **one-time, loud migration** at
  config-load time (the single point where traces are backfilled, inside
  `extractParams`'s `traces` branch). Legacy traces carrying `spacing` but no
  `count` get a `count` derived from path length (circle circumference / line
  length / corner two-segment length), then `spacing` is `delete`d. Traces
  already on the new model just drop any stale `spacing`. No dual code path
  reads `spacing` at render time.

### gui_builder.js

- `computeTracePoints`: count-driven, per-shape. Circle distributes `count`
  across the arc; line places `count` evenly start→end (count==1 → start);
  corner walks arc-length across both segments so spacing is even across the
  polyline and endpoints + corner vertex are represented (count==1 → corner).
- `buildTraceObject`: new `corner` branch — 3-point wireframe polyline,
  preview dots, three draggable handles (start=green, corner=blue, end=red)
  plus the yellow aim handle and dashed aim line, mirroring the line build.
- `_onTraceTransformChange`: new corner branch handling start/corner/end
  handle drags — writes the moved point to the right
  `trace.{start,corner,end}{X,Y,Z}`, moves the aim handle by the same delta,
  re-orients handles along their adjacent segments, and live-rebuilds the
  3-point polyline + dots.
- `generateGroupFromTrace`: corner points are treated as world-space (like
  line); only circle uses the transformed group's world matrix.
- `renderGeneratorGUI`: "⌐ New Corner" button (count:8 default); New Circle /
  New Line defaults switched from `spacing:2` to `count:8`; "Spacing (m)"
  slider replaced by a "Lights" integer control (1..200) that rebuilds the
  preview, updates the "N lights" readout, and regenerates if generated;
  Start/Corner/End point folders for corner; folder glyph `⌐` for corner.

## Tests run

- **JS syntax:** `node --check` on both changed files — pass.
- **git diff --check -- simulation:** clean.
- **Unit:** `cd simulation && npm run check` → 74/74 pass.
- **Sim smoke / visual:** sim booted on slot-1 ports
  (`http://localhost:31169/simulation/?scene=test_bench`). Injected one line
  (count 10), one circle (count 18), one corner (count 13) into the live
  `params.traces` via the shared state module, then captured top-down and
  angled renders (SwiftShader, 1280x720, xvfb).
  - Preview-dot counts matched the `count` controls exactly for all three
    shapes; handle counts: line 3 (start/end/aim), circle 1 (aim), corner 4
    (start/corner/end/aim).
  - Corner rendered two segments meeting at a vertex with green start, blue
    corner, red end handles and even dot spacing across both legs.
  - No trace/generator-related console errors. The only console errors were
    pre-existing engine/sACN-offline noise on the CaptainPad client default
    ports 6968/6972 (unrelated to this change).

## Known gaps / follow-ups

- `DmxFixtureRuntime.getFixtureWidth` is now unused (its only caller was the
  old spacing logic). Left in place as a public static util; removing it is
  out of scope.
- Corner `direction`/`*_locked` aim modes use the generic line-style path
  direction (pts[0]→pts[last]); there is no corner-specific per-segment
  tangent treatment. The default behavior is sensible but could be refined.
- A sibling slice (gen_point_drag) is concurrently editing
  `computeTracePoints` / `buildTraceObject` for per-point dragging +
  distance-gradient dot coloring. Edits here were kept additive and
  per-shape to minimize conflicts, but both touch the same functions —
  expect a small merge in `computeTracePoints` and the dot-creation loops.

## Operator action requested

Ready for review and merge.
