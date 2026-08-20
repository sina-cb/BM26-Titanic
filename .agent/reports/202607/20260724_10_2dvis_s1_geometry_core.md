# 2026-07-24 — 2D vis multiview, Slice S1: geometry & frame core (impl)

Implementer S1 of the 2D-vis multiview wave. Branch `feat/bm_readiness`,
shared working tree (other agents' uncommitted work left untouched). **No git
ops, no commits.** Builds against the design doc
`20260724_9_2d_vis_multiview_design.md` §5 API contracts and §6 test plan.

## What landed (my owned files only)

1. **`simulation/src/dmx/pixelblaze_model_exporter.js`** — strand cluster fix.
   Every LED strand pixel now carries runtime-only `fixIndex` (continuing the
   DMX cluster-index space: `dmxList.length + strandIndex`) and `fixKey`
   (the strand name). Previously strand pixels omitted both, so `buildClusters`
   (fixIndex-contiguity) collapsed all 16 strands into ONE mega-cluster
   (design §1.3). Both fields are runtime-only — **not** in the `saveModelJS`
   serialized field list — so the exported engine model is **byte-identical**.

2. **`simulation/src/gui/pixel_map/pixel_map_layout.js`** — layout engine.
   - `buildClusters` now tags each cluster with `kind` (`'dmx'|'led'`) and a
     derived `fixtureType` (LED clusters → `'LedStrand'` when the serialized
     type is empty). Satisfies the §5 Cluster contract
     `{ fixIndex, fixKey, fixtureType, kind, group, pixels }`.
   - `TYPE_STYLES` gains `LedStrand` (7px squares) and `TeLedGrid40` (9px) .
   - New public API per §5: `seedPanel(panelDef, clusters, list, canvasW,
     canvasH, styles) → Map<fixKey,{x,y,rot}>` and `expandPanel(panelDef,
     clusters, list, placements, styles) → [{gi,cx,cy,sizeX,sizeY,shape,rot}]`.
   - Four layout types: `spatial` (existing world projection, scoped to the
     subset), `radial` (one ring per group, on-screen angle = each fixture's
     real world bearing around the group centroid), `planar` (true 2-D grid
     from the pixel cloud's best-fit plane — the TE sign; a 1-D fixture
     degenerates to its line), `lanes` (one centered horizontal row per
     fixture, ordered by group→name). Existing exports (`seedLayout`,
     `clusterPixelPositions`, `clusterBounds`, hit-tests, `styleFor`) are
     unchanged — the renderer/interaction (S4) keep working.

3. **`simulation/src/gui/pixel_map/pixel_map_frame_source.js`** (new) — the
   single shared per-frame color decode. `registerPanePainter(fn) → unregister`
   (painter gets `(colorBuf, list, builtVersion)`), `onTopology(fn) →
   unsubscribe`. Decodes `entryDisplayRgb` + preview-gamma **once per pixel**
   into a shared `Float32Array(3n)` and fans out to all panes; one onPixelFrame
   subscription serves N panes (subscribe on first painter, tear down on last);
   `document.hidden`/zero-pane skips; a painter that throws is dropped loudly.

4. **Tests** (3 new files, 15 tests, all green):
   `tests/pixelblaze_model_exporter_strand_keys.test.js` (strand keys +
   byte-identity lock), `tests/pixel_map_layout_expansion.test.js`
   (clustering/kind, planar 8×5 grid, radial bearing order, lanes, spatial),
   `tests/pixel_map_frame_source.test.js` (one decode/frame, brightened buffer,
   painter-exception unsubscribe, topology-once, single injected subscription).

## Contract deviations

**None to the cross-slice §5 contracts.** Two design-implementation notes S2/S4
should be aware of (neither changes the §5 shapes S2/S3 build against):

- **Byte-identity vs. the design's `fixtureType: 'LedStrand'` suggestion.**
  Design §4 says stamp `fixtureType: 'LedStrand'` on strand pixels, calling it
  "not serialized (saveModelJS:453)". It **is** serialized (line 453 emits
  `fixtureType`). Since byte-identity is a hard requirement ("prove it"), I did
  **not** change the serialized strand `fixtureType` (stays `''`); the cluster's
  `fixtureType: 'LedStrand'` is **derived in `buildClusters`** from `kind`. The
  §5 Cluster contract is fully met — clusters carry `fixtureType:'LedStrand'` +
  `kind:'led'` — so this is invisible to S2/S3. Proven by the byte-identity test
  (reconstructs the serialized `pixels` block and asserts equality; asserts no
  `fixIndex`/`fixKey` leak and strand `fixtureType:''` preserved).

- **Frame-source subscription is injected, not a direct `animate.js` import.**
  `animate.js` references `window` at module-eval and pulls in `chroma-js`
  (not a node dep), so importing it makes the module — and every pane test —
  unloadable under `node --test`. The frame source therefore imports only
  node-safe modules and takes `onPixelFrame` via **`startFrameSource(subscribe)`**.
  **S4 action item:** call `startFrameSource(onPixelFrame)` once at panel init
  (passing animate.js's `onPixelFrame`). `registerPanePainter`/`onTopology`
  (the §5 contract) are unchanged.

## Verification

- **Sim unit tests: 406 pass / 0 fail** (`node --test tests/*.test.js`) — 293
  original baseline + concurrent agents' work + my 15. My 3 files green in
  isolation and in the full run.
- **Exporter byte-parity: green** (reconstruction equality + no key leak).
- **`git diff --check -- simulation`: clean** (the two LF/CRLF warnings are on
  `scenes/common.yaml`/`manifest.json`, files I did not touch).
- **`node --check`** on all three edited/new source files: pass.
- **`agent_tools/scene_console_smoke.cjs` titanic + test_bench:** clean of any
  error attributable to my code. Residual noise is environmental and
  pre-existing — captured the exact URLs: `favicon.ico` 404 (browser default,
  no favicon served) and `ERR_CONNECTION_REFUSED` on `:6970/save-model` (the
  save-server isn't running in this render env; the exporter's POSTs are
  pre-existing and `.catch`-handled). My change adds no fetches.
- **Live sanity (2d_pixels map, titanic):** header **85 → 100 clusters**
  (16 strands now 16 separate `LedStrand` clusters instead of 1; 85−1+16=100),
  `1147 px` unchanged, renders correctly (screenshot
  `.agent_renders/s1_strand_clusters.png`, visually inspected).

## Gaps / handoff notes

- The new layout types (`radial`/`planar`/`lanes`) and the frame source are
  **not yet wired into the running UI** — that's S4 integration. The exporter +
  `buildClusters` changes ARE live (the existing single-view store already
  imports `buildClusters`), which is why the live cluster count improved.
- `expandPanel` skips a cluster that has no placement (mirrors the existing
  renderer's `if (!pl) continue`); `seedPanel` is expected to fill every
  cluster upstream. S4 should seed-then-expand, as the store does today.
- Strand/TE-grid style sizes (`LedStrand` 7px, `TeLedGrid40` 9px) are sane
  defaults; tune per taste in `TYPE_STYLES` (S1-owned) if the operator wants.
