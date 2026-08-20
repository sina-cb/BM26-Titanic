# Fix: LED strand move leaves pixel trail + selection/orange line never clears

**Mode:** implementation (2 surgical fixes)
**Branch:** `feat/bm_readiness` (working tree — no git operations performed)
**Follows:** `.agent/reports/202607/20260725_1_led_move_trail_debug.md` (diagnosis + fix plan)
**Live verification:** yes — own puppeteer probes against the already-running
operator stack, sim :6969, scene `titanic`, loaded with `&readonly=1` (no sACN
out from the probe pages). Stack not restarted.

## TL;DR

Both operator symptoms are fixed with two one-mechanism edits, exactly as the
debugger's plan specified. Post-fix probe: `dotsNearOldPositions: 0` (was 40),
2D-pixel-map data source `entriesAtOldPositions: 0 / entriesAtNewPositions: 40`,
and strand selection clears on both empty-click and Escape (`_selected`, glow
tube, endpoint handles, `gui-card-selected` all false). `npm test` 542/542.

## What changed

### Fix 1 — trail: invalidate the batch cache on 3D-handle strand moves

`simulation/src/gui/gui_builder.js:4329-4345` — `window._onStrandTransformChange`

One added call (plus a why-comment) after `fixture.rebuildVisuals()`:

```js
if (window.invalidateMarsinBatchCache) window.invalidateMarsinBatchCache('strand_transform');
```

Same guarded pattern `rebuildLedStrands()` already uses at gui_builder.js:4324.
`rebuildVisuals()` only moves the strand's own bulb/halo meshes; every
batch-list consumer (global instanced dot mesh, 2D Pixel Map, engine
`_batchCoords`) reads x/y/z snapshotted by `generatePixelMap()` at cache-build
time. Bumping the version makes the next frame re-run `_rebuildBatchCache()`,
which cures all of them at once.

### Fix 2 — sticky selection / orange line: teach deselect about strands

`simulation/src/core/interaction.js:98-118` — `deselectAllFixtures()`

After the existing PAR loop + `selectedFixtureIndices.clear()`, added:

```js
(window.ledStrandFixtures || []).forEach((f) => {
  if (f && typeof f.setSelected === 'function') f.setSelected(false);
});
(window.strandGuiFolders || []).forEach((f) => {
  if (f && f.domElement) f.domElement.classList.remove('gui-card-selected');
});
```

LED strands hold selection per-fixture (`_selected`), not in
`selectedFixtureIndices`, so the PAR loop never touched them and the selection
glow tube (`led_strand.js:157`, colored `config.color` — `#ff8800` on 7 of 8
titanic strands = the operator's "orange line") stayed visible. Putting it
inside `deselectAllFixtures` covers every entry point already routing through
it: empty-space click (interaction.js:503), Escape, trace pick (447/461/474),
PAR pick (477/490), delete/duplicate. The strand-pick branch order
(`deselectAllFixtures()` at :477 → `openStrandFolder()` at :478 re-selects) is
unchanged, so picking a strand still selects it. The `|| []` guards are the
boot-time-undefined guards the plan specified, not fallbacks. TE Sign halves
are PAR-class (`params.parLights`) — their path is untouched.

Nothing else was modified. `node --check` clean on both files.

## Verification evidence

Probe: `~/tmp/led_strand_fix_probe/probe.cjs` (adapted from the debugger's
`~/tmp/led_move_trail_probe/probe.cjs`). Loads `&readonly=1`, asserts
`params.autoSave === false` AND `__readonlyMode === true` in-page before any
mutation (aborts otherwise) → zero disk writes, zero sACN out. Browser closed
at end of every run. Drive: `openStrandFolder(0)` → REAL canvas click on the
projected start handle (`tc.object.userData.isLedStrand === true`) → 6-step
rigid +4x/+4y move dispatching real `{type:'change'}` on the live
TransformControls; real `page.mouse.click` for click-away and
`page.keyboard.press('Escape')`.

The 2D-Pixel-Map row reads the **live `_batchRenderList`** — the probe taps it
via `import('/simulation/src/core/animate.js').onPixelFrame(...)` (same module
URL ⇒ same module instance), i.e. literally the array
`pixel_map_frame_source.js` paints from.

Run ts `1784995203`, strand 0 `Left_Front_Left` (40 px), scene total 981 px:

| Check | Pre-fix (debugger, ts 1784994218) | Post-fix | Verdict |
|---|---|---|---|
| Invalidations fired during drag | 0 | **24** (`strand_transform`) | fixed |
| Global dot mesh — instances at OLD line | 40 | **0** | fixed |
| — instances at NEW line | 1 | **41** (40 + 1 coincidental unrelated px) | fixed |
| Strand `bulbInst` at NEW / OLD | 40 / 0 | 40 / 0 | unchanged (was already right) |
| 2D-map source `_batchRenderList` — entries at OLD | (stale by construction) | **0** | fixed |
| — entries at NEW | — | **40** | fixed |
| — built version after move | 5 | **29** | rebuild ran |
| Click-away: `tc.object === null` (empty branch ran) | true | true | oracle holds |
| — `strand._selected` | true (bug) | **false** | fixed |
| — glow tube visible | true (bug) | **false** | fixed |
| — endpoint handles visible | true (bug) | **false** | fixed |
| — `gui-card-selected` on the card | true (bug) | **false** | fixed |
| Escape (after re-selecting): `_selected` / tube / handles / card | true / true | **false / false / false / false** | fixed |
| PAR fixtures still selectable (84 present) | — | true | no regression |
| `cd simulation && npm test` | 542/542 | **542/542** | green |

### Screenshots (`.agent_renders/`, all visually inspected)

Pre-fix (debugger's run, ts `1784994218`):
- `1784994218_trail_3_after_move.png` — teal glow tube at the NEW position **plus
  a red dotted ghost line along the OLD diagonal**.
- `1784994218_trail_4_after_clickaway.png` — gizmo detached (click WAS processed
  as empty space) but the fat glow tube + handles + ghost trail all persist.

Post-fix, wide (ts `1784995203`):
- `1784995203_fix_2_selected.png` — strand selected, glow tube + handles + gizmo.
- `1784995203_fix_3_after_move.png` — strand moved up-right; **the old diagonal
  is bare hull, no ghost dots**.
- `1784995203_fix_4_after_clickaway.png`, `1784995203_fix_6_after_escape.png` —
  no glow tube, no handles, no gizmo.

Post-fix, close-up (ts `1784995394`, `~/tmp/led_strand_fix_probe/zoom.cjs`, GUI
panel hidden for an unobstructed view):
- `1784995394_zoom_2_selected.png` — the lit strand running down the hull, selected.
- `1784995394_zoom_3_after_move.png` — the strand now runs up-right from the
  gizmo; the previous hull diagonal is **completely clear** — single line, no trail.
- `1784995394_zoom_4_after_escape.png` — glow tube gone, handles gone, gizmo gone;
  the strand's own pixels remain at the NEW position only.

Close-up probe in-page asserts: after move `{selected: true, tubeVisible: true}`
(selection survives a drag — correct); after Escape
`{selected: false, tubeVisible: false}`.

## Honesty notes

- **First probe run (ts `1784994903`) read too early and looked like a failure**
  (`dotsNearOldPositions: 40`, built version 5 while `_batchCacheVersion` was
  ~29). The invalidation had fired — a follow-up diagnostic
  (`~/tmp/led_strand_fix_probe/diag.cjs`) confirmed 12 `strand_transform`
  invalidations and dots already at the new position — but the render loop
  runs at ~2 fps under SwiftShader, so the 1500 ms settle sometimes elapsed
  before the frame that rebuilds the cache. Extending the settle to 3000 ms
  made every run pass. This is a probe-timing artifact of software GL, not a
  property of the fix; the built-version field (5 → 29) is the discriminator.
  On the real GPU at 60 fps the rebuild lands on the next frame.
- The drag was simulated by mutating handle positions and dispatching real
  `{type:'change'}` events on the live TransformControls — the exact chain a
  physical gizmo drag fires (main.js:229). The pointer-down/up
  `dragging-changed` bracket was not exercised; it contains no strand logic.
- Drag-time perf was not benchmarked as a separate experiment. The invalidation
  fires per change event (24 for a 6-step two-endpoint move) — strictly cheaper
  than the Start/End sliders, which already call `rebuildLedStrands()` per tick
  (that destroys and re-creates every LedStrand *and* invalidates). SwiftShader
  FPS (1-2) is dominated by software rasterization, so this box cannot measure
  the delta meaningfully; flagging it rather than claiming a clean bill.
- Screenshots show the pre-existing "2 sim windows connected" and "ENGINE MODEL
  STALE (132 → 206)" banners — operator-stack state, unrelated to these bugs.
  The probe pages were `readonly=1`, so they never emitted sACN.
- SwiftShader rendering; not pixel-accurate to the show GPU. Irrelevant to the
  geometry/selection evidence, all of which is numeric.
- No git operations. No state/config files written (`autoSave=false` asserted
  in-page before every mutation). Probe files live only in `~/tmp/`.

## Out of scope (unchanged, filed separately)

- **Locked strand groups don't rigid-move on 3D handle drags** —
  `_onStrandTransformChange` still moves a single endpoint;
  `computeRigidMoveIndices` is PAR-only. Deliberately not touched.
- Engine-side model-staleness banner (test_bench vs titanic).
