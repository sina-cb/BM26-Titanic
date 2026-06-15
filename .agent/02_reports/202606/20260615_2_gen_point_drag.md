# Slot 2 — gen_point_drag

- **Branch:** dev/claude/gen_point_drag
- **Parent branch:** claude/intelligent-knuth-j6cba1
- **Worktree:** ~/BM26-Titanic-worktrees/gen_point_drag
- **Slot ports:** sim 31269 (save 31270, sACN 31271/31272) — config.yaml reverted before commit

## Scope

Two related features for the DMX generator (the *trace* feature in
`simulation/src/gui/gui_builder.js`):

1. **Semi-adjust individual light positions along the path.** Each light
   preview dot can now be dragged; the drag is projected back onto the trace
   path (constrained to slide along it, never free 3D motion, mirroring the
   reference PixelMapper model). The signed shift is stored per-trace,
   per-point in `trace.pointOffsets[k]` (arclength meters). A "Reset point
   offsets" button in each trace's GUI folder clears them back to even
   spacing.
2. **Distance gradient.** Each preview dot is colored by the inter-point
   spacing relative to the trace's mean spacing: GREEN = even/target,
   RED/warm = stretched gap, BLUE = bunched gap (diverging blue→green→red
   scale via the vendored `chroma-js`). Colors update live on every drag and
   on rebuild.

Default behavior (all offsets 0) is byte-identical to the prior even
distribution. The offset logic is a clearly-commented post-processing step
applied AFTER the base arclengths are computed, operating on the generic
arclength list + path tangents, so it composes with however many base points
exist (spacing- or future count-driven) and with any path shape (line,
circle/arc, and a future `corner` polyline).

## Files changed

```
M  simulation/src/gui/gui_builder.js
M  simulation/src/core/interaction.js
```

Key additions in `gui_builder.js`:
- `buildTracePath(trace)` — parametric arclength path (`length`, `at(s)`,
  `tangentAt(s)`) shared by base layout and offset math; shape-agnostic.
- `computeTraceBaseArclengths(trace, path)` — single source of truth for the
  even base layout; `computeTracePoints` and the drag math both call it so
  they can never diverge.
- `computeTracePoints` post-process applies clamped `pointOffsets`
  (clamped between neighbours/ends so points never cross or leave the path).
- `computeTraceDotColors(pts)` — spacing gradient.
- `window._beginTraceDotDrag / _updateTraceDotDrag / _endTraceDotDrag` —
  project a world-space pointer ray onto the path (coarse scan + ternary
  refine), convert to an offset, live-update dots, autosave on release.
- `refreshTraceDots` — in-place dot position+color update during a drag.
- Each dot now carries `userData.pointIndex` and its own material instance.
- Fixed `setTraceSelected` (was crashing on the now-array `dotMats`; it now
  highlights only the wireframe path and leaves the gradient dots intact).
- Fixed the line-endpoint live-rebuild path to recreate dots with the full
  contract (own material, pointIndex, registered in `interactiveObjects`) so
  dragging an endpoint never strips a trace of its gradient or drag handles.
- "Reset point offsets" button added next to the Spacing control.

In `interaction.js`: a preview-dot click now starts a path-constrained drag
(disables orbit, feeds a world ray per pointermove, finishes on pointerup)
instead of only opening the trace folder.

## Tests run

- **Syntax:** `node --check` on both changed files — pass.
- **`git diff --check -- simulation`:** clean.
- **Unit:** `cd simulation && npm run check` — 74/74 pass (ran 3×, stable;
  an initial run showed 3 flaky fog/panel failures unrelated to this slice
  that did not reproduce and are not in touched code).
- **Sim smoke / interaction (headless, xvfb + SwiftShader, slot port 31269,
  scene test_bench):** created a line and a circle generator via the real
  GUI buttons, then exercised the drag + reset via the public API:
  - Line: 5 dots, all green at even spacing. Dragging the middle point
    x=0 → x=1.3 slid it along the path; gradient updated (stretched
    neighbour → `#ff4422` red, bunched neighbour → `#2a7fff` blue).
  - Circle: 16 dots; dragging a point kept it exactly on the ring
    (`radius` unchanged) — arc projection works; gradient updated.
  - "Reset point offsets" button restored even spacing
    (`[-5,-2.5,0,2.5,5]`) and all-green colors.
  - No `pageerror` after the `setTraceSelected` fix.
  - Screenshots captured and visually inspected (dots render along the
    wireframe with distinct gradient colors). NOTE: the test_bench scene's
    floodlight pool tints the ground green under SwiftShader, so dot-color
    pixel reading from screenshots is unreliable; the authoritative color
    verification is the live material hex values read from the DOM, listed
    above.

## Known gaps / follow-ups

- Visual screenshot verification of exact dot colors is limited by the
  SwiftShader scene flood; functional correctness is proven via DOM state.
- Stayed out of the sibling slice's lane: did not touch the spacing→count
  GUI control or new-trace defaults. If/when `count` and the `corner` shape
  land, the offset/gradient code already operates on the generic point list
  and should compose without changes (corner just needs its branch in
  `buildTracePath`).
- No GPU-accurate publish render was done (headless box).

## Operator action requested

Ready for review and merge.
