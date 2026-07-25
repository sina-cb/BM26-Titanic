# 2026-07-24 — 2D vis rehaul: dynamic multi-view + tmux panes (design)

Designer session (Fable) for project **bm_readiness_mapping** (branch
`feat/bm_readiness`). **DOC-ONLY slice — zero source edits, zero git ops.**
Spec source of truth: `.agent/projects/bm_readiness_mapping.md` §"2D vis
rehaul requirements". Grounding: full code read of the existing 2D Pixel Map
(`simulation/src/gui/pixel_map/*`, `modern/pixel_map_panel.js`), its data
feed (`animate.js onPixelFrame`, `pixelblaze_model_exporter.js`), the Views
Rehaul machinery (`view_registry.js`, report `20260724_7`), and a live
screenshot of the current vis on the running stack
(`.agent_renders/1784926583_current.png`, visually inspected). Does not
collide with the mapping split-screen work (`20260724_2`/`_4`): that owns
the 3D-vs-mapping screen split; this owns the inside of the 2D pixel
viewport.

---

## 0. TL;DR

- The current 2D vis is the **2D Pixel Map** — the `2d_pixels` lighting
  profile's full-screen viewport (`simulation/src/gui/pixel_map/`,
  Canvas 2D, fed per-frame by `animate.js onPixelFrame`). It is a single
  hand-editable layout of ALL fixtures; live capture shows **85 clusters /
  1,147 px** — because **all 16 LED strands collapse into ONE cluster**
  (exporter omits `fixIndex`/`fixKey` on strand pixels) and the **TE LED
  grids render as 1-D rows** (layout can only expand pixels along a line).
  The single all-fixtures spatial seed is unreadably dense (screenshot).
- Design: keep **Canvas 2D** (one canvas per pane, static-layer + lit-fill
  blit, exactly today's proven renderer pattern), add a **single shared
  frame source** that decodes RGBWAU→display-RGB **once per frame** into a
  shared color buffer; panes only stamp geometry. 6 panes on full titanic ≈
  8–11k fills/frame — comfortably inside a 60 FPS budget; a 2nd WebGL
  context is explicitly rejected (context-loss risk vs THREE, and
  unnecessary at this pixel count).
- **Views are data** (`views2d` in the scene YAML): a view = 1+ panels,
  each panel = fixture **selectors** (kind/fixtureType/group/name/named-view
  via `view_registry`) + a **projection** (top/front/side) + a **layout
  type** (spatial | radial | planar | lanes) + per-view editable placements.
  The 4 required views ship as data defaults, addable/removable/duplicable
  at runtime from a Views manager UI.
- **Pane layout = binary split tree**, vim/tmux-style: split h/v via mouse
  (pane-header buttons, draggable dividers) and keyboard (`\` `-` `x` `z`
  `Tab` `[` `]` `1-9`, all scoped to the vis focus), any pane binds any
  view, tree persisted per scene in localStorage.
- **Parallel plan: 3 strictly disjoint build slices + 1 integration slice**
  (true 4-way disjointness is impossible — integration by definition edits
  the existing seam files). File ownership table in §7.

---

## 1. Current state (what/where the 2D vis is)

### 1.1 Files

| File | Role |
|---|---|
| `simulation/src/gui/pixel_map/pixel_map_store.js` | signal store: visibility/mode/selection/zoom/pan, placements `Map<fixKey,{x,y,rot}>`, per-type overrides, canvas size; subscribes to `onPixelFrame`; persists to `params.pixelMap2d` (scene YAML, auto-save forced) |
| `simulation/src/gui/pixel_map/pixel_map_layout.js` | pure math: `buildClusters` (contiguous `fixIndex` runs), `seedLayout` (2-largest-spread-axes world projection, aspect-preserving, collision relax), `clusterPixelPositions` (**1-D row expansion only**), hit tests, `TYPE_STYLES` (ShehdsBar square 13, VintageLed circle 15, UkingPar circle 24, `_default` square) |
| `simulation/src/gui/pixel_map/pixel_map_renderer.js` | Canvas 2D, two layers: offscreen static (bg/grid/off-bezels/edit chrome, redrawn on layout/mode/selection/view change) + per-frame blit + flat lit fills via `entryDisplayRgb` + preview gamma 0.6; design-space `setTransform` letterbox; flat pixel-art stance (no glow) |
| `simulation/src/gui/pixel_map/pixel_map_interaction.js` | pointer/keys: pan/zoom/marquee/drag/rotate/nudge; **all events stopPropagation'd** so 3D shortcuts never fire |
| `simulation/src/gui/modern/pixel_map_panel.js` | Preact shell (toolbar VIEW/EDIT, per-type sliders, inspector, status strip); `initPixelMapPanel()` from `main.js:736`; full-screen `#pixel-map-panel` (style.css:3342), **gated to `params.lightingProfile === '2d_pixels'`** (`showPixelMap`), toggled by the headless latch in `animate.js:281-285` and the `M` key |
| `simulation/src/core/animate.js:39-54` | `onPixelFrame(fn)` — per-rendered-frame dispatch of the live `_batchRenderList` + topology `builtVersion`; listener exceptions unsubscribe loudly |
| `simulation/src/dmx/pixelblaze_model_exporter.js` | builds the pixel list: DMX pixels carry `fixIndex`/`fixKey`/`fixtureType`/`group`/world `x,y,z` (runtime-only keys, **not serialized** — verified against `saveModelJS` line 453); **strand pixels carry neither `fixIndex` nor `fixKey`** (`:346-373`) |
| `simulation/src/core/rgbwau_blend.js` | canonical RGBWAU→display RGB (`entryDisplayRgb`, incl. unpatched-black/red rule) |

The "prev/next arrows at the screen edges" in the operator's description are
the edge chevron tabs of the surrounding chrome (Pattern-Editor/left-drawer
and split-restore tabs) that float above the full-screen map (z-index 8 vs
panels above) — they are not part of the pixel map itself.

### 1.2 Data feed

`animate()` (rAF loop) → gradient/pixelblaze/sACN-in writes RGBWAU onto
`_batchRenderList` entries → `_dispatchPixelFrame()` → store `onFrame` →
`renderer.drawFrame(list, patchesActive, showUnpatchedRed)`. The list is the
exporter's pixel array cloned with `wx/wy/wz` + live `r,g,b,w,a,u`
(`animate.js:128-132`). Works identically under local patterns and sACN-in;
in the `2d_pixels` headless profile all 3D GPU work is skipped but the loop
and dispatch still run (this is the Pi profile). The 2D map is therefore
**display-truth by construction** (same blend as the 3D dots).

### 1.3 Measured/observed today

- Live capture (`.agent_renders/1784926583_current.png`, titanic,
  `?profile=2d_pixels&pixelmap=view`): header reads **`85 fix · 1147 px`**
  → 84 DMX clusters + **one 480-px mega-cluster holding all 16 strands**
  (contiguity clustering + missing strand `fixIndex`). Layout is an
  overlapping red mass (all unpatched → red overlay): the single
  all-fixtures seed does not read at titanic density.
- Scene truth (working tree): 84 DMX fixtures (UkingPar incl. 2×10
  "Top Chimney Generator" par rings, 24 ShehdsBar, ~20 VintageLed,
  **2 TeLedGrid40** = the TE sign) + **16 strands** (8×40 px large
  `Left_/Right_*`, 8×20 px `Small_*`) = 1,147 px. (The dossier's "28
  strands / 1,120 px" figure describes a planned/estimated rig — the design
  below is count-agnostic either way.)
- Perf: the map renderer is a static-blit + ~1.1k flat fills per frame —
  not a bottleneck. The 7 FPS seen in the capture is the SwiftShader
  agent-render environment (whole-app); prior real-GPU measurements
  (`20260724_1`) put light profiles at 60 FPS. Canvas 2D cost scales
  linearly with drawn pixels only.

### 1.4 Gaps vs the operator's requirements

1. One hardcoded "view" (everything), one pane. No per-audience views.
2. Strands: not individually addressable clusters (exporter gap) — can't be
   moved/styled per strand, and a strands-only view has nothing to select.
3. 2-D fixtures (TE grid) flatten to a row — `clusterPixelPositions` only
   expands along local X.
4. No radial arrangement (smoke-stack ring), no lanes layout.
5. Placements/styles are global, not per-view.
6. No pane splitting, no view binding, no runtime add/remove of views.

---

## 2. Architecture

### 2.1 Rendering: Canvas 2D per pane, one shared frame source

**Decision: keep Canvas 2D.** Rationale (unchanged from the original
renderer header, now with multi-pane numbers): a second GL context fights
the THREE renderer (real context-loss risk under SwiftShader — the agent
render path we must keep working), and the workload is small: worst case
~6 panes × their view subsets ≈ **8–11k flat fills/frame** on full titanic
(top-down ~1.6k px, strands 480, TE 80, front ~700, plus duplicates).
Canvas 2D handles ~50k simple fills/frame on a GPU-composited canvas; even
software raster holds 30+ FPS at this count. DOM (one element per pixel) is
rejected outright (10k live nodes). WebGL instancing would only pay off
above ~50k px/frame — revisit only if the rig grows 5×.

**Shared frame source** (`pixel_map_frame_source.js`, new): the single
`onPixelFrame` subscriber for the whole multiview.

- Per topology bump (`builtVersion` change): rebuild clusters once
  (`buildClusters`), notify the view layer (views re-resolve selectors,
  panes re-seed missing placements).
- Per frame: decode `entryDisplayRgb` + preview gamma **once per pixel**
  into a shared `Float32Array(3n)` color buffer (colors are identical
  across panes; only geometry differs), then call each registered pane
  painter with `(colorBuf, list, version)`.
- Skips: `document.hidden`, zero registered panes, panes whose canvas is
  detached/hidden. A painter that throws is unsubscribed loudly (mirrors
  the `onPixelFrame` contract).

**Per-pane painter** (today's renderer pattern, generalized):
static offscreen layer (bg, grid in edit mode, off-bezels, hulls/labels)
redrawn only on layout/selection/zoom/mode change; per frame = blit static
+ fill lit pixels from the shared color buffer. Micro-optimizations that
keep the budget flat: unrotated squares use the `fillRect` fast path (bars,
TE grid, strands — the vast majority); circles/rotated shapes keep the path
route; `fillStyle` set only when the quantized color changes between
consecutive pixels of a run (bars often run uniform).

### 2.2 View definition model (views are data)

New scene-YAML key `params.pixelMapViews` (exported/imported with the scene
like `pixelMap2d` today; auto-save forced via the existing `markEdited`
bridge):

```yaml
pixelMapViews:
  version: 1
  views:
    - id: top_down
      label: Top-Down
      panels:
        - id: main
          select:                      # union of selectors; fail-loud on unknown keys
            - { fixtureType: ShehdsBar }
            - { kind: led }            # all LED strands
          projection: top              # top | front | side  (seed plane)
          layout: spatial
          weight: 3
        - id: stacks
          label: Smoke Stacks
          select:
            - { group: 'Left Top Chimney Generator' }
            - { group: 'Right Top Chimney Generator' }
          layout: radial               # ring per group, angle from world pos
          weight: 1
      placements: { }                  # fixKey → {x,y,rot}; operator edits, per view
      typeStyles: { }                  # per-view style overrides (same shape as today)
```

**Selectors** (matched against cluster fields, which come straight from the
batch entries): `kind: dmx|led`, `fixtureType: <exact>`, `group: <exact or
glob>`, `name: <glob>` and `view: <name>` — the last resolving through the
scene's **`view_registry`** (`views.yaml` groupBits + custom views), so the
Views-Rehaul vocabulary is reused rather than reinvented. Union semantics
with optional `exclude:` list. A selector that matches zero fixtures, or an
unknown selector key, renders the pane with a loud inline error banner
(codex P0 — no silent empty view).

**Layout types** (panel-level):

| layout | Behavior |
|---|---|
| `spatial` | today's seed, scoped to the panel's fixtures only — normalizing the *subset* to the canvas is what makes each view "pretty + screen-fitting" (the density problem in §1.3 is caused by normalizing *everything* at once) |
| `radial` | one ring per group in the selection: fixture centers on a circle around the group's world centroid, **angle taken from each fixture's actual world bearing around that centroid** — so the on-screen ring matches the physical par ring on the stack; ring radius auto from count × style size |
| `planar` | per-fixture 2-D expansion: project the fixture's own pixel world coords onto their best-fit plane (largest-two-spread axes of the pixel cloud) → the TE grid renders as its true 2-D grid; generalizes to any future 2-D fixture; falls back to nothing — a 1-D fixture simply yields its line, same math |
| `lanes` | one horizontal row per fixture (strand), ordered by group then name, pixel order = `localIndex` — the "logical" strands view alternative to spatial |

**The 4 required views** ship as data in `pixel_map_view_defaults.js` and
are seeded into `pixelMapViews` on first open of a scene that has none:

1. `top_down` — bars + strands, `projection: top`, `layout: spatial`; +
   `stacks` panel, chimney par groups, `layout: radial` (focusable: the
   panel maximizes on click, same affordance as pane-zoom).
2. `front` — `{fixtureType: ShehdsBar} ∪ {fixtureType: VintageLed}`,
   `projection: front`, `layout: spatial`.
3. `strands` — `{kind: led}`, `layout: spatial` (top) with a one-click
   toggle to `lanes`.
4. `te_sign` — `{fixtureType: TeLedGrid40}`, `layout: planar`.

**Runtime add/remove:** a Views manager (list in the vis toolbar): add
(blank or duplicate-from), rename, edit selectors (structured rows, not
free YAML), delete. All writes go through the store → `markEdited` →
scene YAML autosave. Deleting a view that panes still bind → those panes
show the explicit "view removed — pick another" state (never auto-rebind).
Per-view placements/styles are edited exactly like today (EDIT mode drag/
rotate/nudge/inspector) but write into that view's `placements`.

**Migration:** on first load, if legacy `params.pixelMap2d` exists, its
placements become an `all_fixtures` view (so nothing the operator tuned is
lost) and the legacy key is dropped from params on next save. Reported in
console, one line.

### 2.3 Pane layout model (vim/tmux splits)

Binary tree, pure data (`pixel_map_pane_tree.js`):

```js
node := { split: 'h'|'v', ratio: 0..1, a: node, b: node }
      | { view: '<viewId>' }
state := { root: node, focusPath: 'ab..', zoomPath: null|'ab..' }
```

Pure ops (all return a new tree; trivially unit-testable): `splitPane(path,
dir)` (new sibling inherits the focused pane's view), `closePane(path)`
(sibling collapses up; closing the last pane is a no-op), `setRatio(path,
r)` (clamped 0.15–0.85), `bindView(path, viewId)`, `moveFocus(dir)`
(geometric nearest-neighbor), `toggleZoom(path)` (tmux zoom: render one
pane full-bleed, tree untouched).

**Mouse:** each pane has a slim header — view-name chip (click = view
dropdown incl. "Manage views…"), `⊞` split-v, `⊟` split-h, `⛶` zoom, `✕`
close; dividers are 6-px hit targets, drag to resize, double-click resets
to 0.5. Panel sections inside a view (e.g. `stacks`) get a click-to-focus
maximize within the pane.

**Keyboard** (scoped to the vis root's focus — every key handler
`stopPropagation`s exactly like today's canvas, so no collision with the 3D
shortcuts T/R/S/Q/D/P/H/B/M):

| Key | Action |
|---|---|
| `\` | split vertical (side-by-side) |
| `-` | split horizontal (stacked) |
| `x` | close focused pane |
| `z` | zoom (maximize) focused pane, toggle |
| `Tab` / `Shift+Tab` | cycle pane focus |
| `Alt+←↑↓→` | directional pane focus |
| `[` / `]` | previous/next view in the focused pane |
| `1`–`9` | bind Nth view to the focused pane |
| `f` | fit (reset pan/zoom) in the focused pane |
| `Ctrl+Alt+←→↑↓` | grow/shrink the focused pane's split |

(Existing per-pane gestures unchanged: wheel zoom-to-cursor, space/middle
pan, EDIT-mode Q/E/arrows/marquee.) The catalogue is added to
`shortcuts.js` so the help panel stays truthful.

**Persistence:** `localStorage['bm26.pixelmap.paneLayout.<scene>']` — tree +
focus, validated on load (schema + every `viewId` must exist). A corrupt or
stale entry is reported in a visible toast and replaced by the single-pane
default — loud recovery, not silent fallback. (localStorage, not scene
YAML: the pane arrangement is per-workstation ergonomics, exactly like the
mapping split ratio `bm26.sim.splitRatio.<class>`; the views themselves are
scene data.)

### 2.4 Surface & profile binding

The multiview replaces the single canvas **inside the existing
`#pixel-map-panel` full-screen viewport**, keeping the current contract:
exclusive to the `2d_pixels` profile, driven by the headless latch in
`animate.js`, `M` to toggle, no interference with the mapping split-screen
(different profiles/workflows). Opening it in 3D profiles is an operator
decision (§8 Q1) — the pane shell is host-agnostic either way.

---

## 3. Perf budget

Hard requirement: the operator tunes patterns against the big model here.

| Metric | Target | Basis |
|---|---|---|
| Sustained FPS, real-GPU laptop, full titanic (~1.2–1.8k px), **6 live panes** | **60 FPS** (vis adds ≤ 4 ms/frame) | frame-source decode ≤ 0.3 ms (one pass over n px); 8–11k flat fills ≈ 2–3 ms Canvas 2D; static layers amortized |
| Same, SwiftShader agent env, 1280×720, 4 panes | ≥ 20 FPS, and **≥ 0.9× the single-pane FPS on the same box** (relative gate — absolute SwiftShader numbers are environment noise) | today's single-pane map is the baseline |
| Selection/edit interactions | static-layer redraw only for the affected pane, < 5 ms | mirrors G2 lesson: never rebuild what a patch can update |
| Topology rebuild (scene edit) | recluster + reseed all panes < 100 ms, once per `builtVersion` bump | buildClusters is O(n); seeds are per-panel subsets |
| Memory | ≤ 2 offscreen canvases per pane (static + visible), shared color buffer 3n floats | |

Guard rails: the frame source is the ONLY `onPixelFrame` subscriber for the
vis (N panes must never mean N subscriptions); zoom-state panes skip
painting the hidden siblings; `document.hidden` skips everything.

---

## 4. File-level implementation map

**New files** (all under `simulation/` unless noted):

| File | Contents |
|---|---|
| `src/gui/pixel_map/pixel_map_frame_source.js` | single onPixelFrame subscriber, shared color buffer, pane-painter registry, topology notifications |
| `src/gui/pixel_map/pixel_map_views.js` | view/panel schema validation (fail-loud), selector resolution (incl. `view:` via `view_registry`), per-view placement/style stores, add/remove/duplicate ops, `params.pixelMapViews` persistence + legacy migration |
| `src/gui/pixel_map/pixel_map_view_defaults.js` | the 4 required view definitions as data |
| `src/gui/pixel_map/pixel_map_pane_tree.js` | pure split-tree model + ops + (de)serialization/validation |
| `src/gui/pixel_map/pixel_map_pane_view.js` | per-pane painter class (static layer + lit fills from shared buffer, fillRect fast path, per-pane zoom/pan/selection) |
| `src/gui/modern/pixel_map_multiview_panel.js` | Preact shell: pane tree DOM, headers/dividers, keybindings, Views manager UI; injects its own `<style>` (keeps `style.css` untouched for slice disjointness) |
| `agent_tools/pixel_map_capture.cjs` | repeatable screenshots: default 4 views, split states, edit mode |
| `agent_tools/pixel_map_perf_test.cjs` | rAF FPS + per-frame draw-ms probe, 1/2/4/6 panes, exit-1 on relative regression |
| `tests/pixel_map_frame_source.test.js`, `tests/pixel_map_layout_expansion.test.js`, `tests/pixel_map_views.test.js`, `tests/pixel_map_pane_tree.test.js` | unit tests (node test runner, same conventions as `tests/*.test.js`) |

**Edited files:**

| File | Edit |
|---|---|
| `src/dmx/pixelblaze_model_exporter.js` | stamp `fixIndex` (continuing the DMX index space) + `fixKey` (strand name) + `fixtureType: 'LedStrand'` on strand pixels — runtime-only fields, provably not serialized (`saveModelJS:453`), so the engine model is byte-identical |
| `src/gui/pixel_map/pixel_map_layout.js` | `buildClusters` carries `kind` (entry.type); new expansions `radial` / `planar` / `lanes`; `seedLayout` takes an explicit fixture subset + plane; `TYPE_STYLES` gains `LedStrand` + `TeLedGrid40` entries |
| `src/gui/pixel_map/pixel_map_store.js` | store holds views + pane tree signals; subscription goes through the frame source |
| `src/gui/pixel_map/pixel_map_interaction.js` | gestures become per-pane (attach to pane canvas, write to the pane's view placements) |
| `src/gui/modern/pixel_map_panel.js` | hosts the multiview shell instead of the single canvas (toolbar/status strip stay) |
| `src/gui/pixel_map/pixel_map_renderer.js` | retired/reduced to shared drawing helpers once `pixel_map_pane_view.js` is live |
| `src/gui/shortcuts.js` | new "2D Vis (focused)" shortcut group |
| `main.js`, `style.css` | init wiring; only if the injected-style approach needs a hook (expected: no change to style.css) |

---

## 5. Cross-slice API contracts (agree before fan-out)

- **Cluster** (produced by layout, consumed everywhere):
  `{ fixIndex, fixKey, fixtureType, kind: 'dmx'|'led', group, pixels: [{gi}] }`.
- **Frame source:** `registerPanePainter(fn) → unregister`; painter called
  as `fn(colorBuf /*Float32Array 3n*/, list, builtVersion)`;
  `onTopology(fn)` for recluster notifications.
- **Layout:** `expandPanel(panelDef, clusters, list, placements, styles) →
  [{gi, cx, cy, sizeX, sizeY, shape, rot}]` and `seedPanel(panelDef,
  clusters, list, canvasW, canvasH, styles) → Map<fixKey,{x,y,rot}>`.
- **Views:** `resolveView(viewDef, clusters, list) → { panels: [{ def,
  clusters, placements, styles }] }`; throws on invalid schema; zero-match
  returns `{ error }` per panel (renderable, loud).
- **Pane tree:** pure functions listed in §2.3; serialized form is the
  literal node shape.

---

## 6. Test plan (per slice, plus integration)

- **S1 (geometry/data):** unit — strand pixels cluster per strand (16
  clusters from a synthetic 2-strand + 2-bar list); `planar` reproduces a
  known 8×5 grid from world coords; `radial` ring order matches world
  bearings; exporter emits byte-identical `saveModelJS` output before/after
  (regression fixture, extends
  `pixelblaze_model_exporter_local_index.test.js` pattern in a NEW file);
  frame-source: one decode per frame, painter exceptions unsubscribe.
- **S2 (views):** unit — schema validation throws on unknown selector key;
  selector union/exclude membership on a synthetic cluster set; `view:`
  resolution against a stub view_registry; defaults seed exactly the 4
  views; legacy `pixelMap2d` migration preserves placements.
- **S3 (pane shell):** unit — every tree op (split/close/ratio/bind/zoom/
  focus) incl. edge cases (close last pane no-op, ratio clamp,
  deserialization rejects unknown viewIds); DOM smoke via the capture tool.
- **S4 (integration):** `cd simulation && npm test` (full suite, currently
  284); `scene_console_smoke.cjs` on titanic + test_bench under
  `?profile=2d_pixels`; `pixel_map_perf_test.cjs` 1→6 panes relative gate;
  `pixel_map_capture.cjs` screenshots of all 4 default views + a 4-pane
  split, **visually inspected** (see_the_world discipline); manual: engine
  running (`ws :6968`) → pattern animates in every pane simultaneously;
  edit-mode placement edit in one pane persists per view and survives
  reload; `M`/profile-switch enter/exit leaves the 3D path untouched.

---

## 7. Parallel implementation plan (Opus agents, same working tree)

**Slices S1–S3 are STRICTLY DISJOINT by file set and can run
simultaneously. S4 (integration) cannot be made disjoint** — it exists to
edit the seam files (store/panel/interaction/main) that currently implement
the single-view behavior — so it is **sequenced after S1–S3 land**. Slices
build against §5 contracts; S2/S3 develop with small in-test stubs where
they'd otherwise import S1 output.

| Slice | Scope | Owns (exclusive) | Est. |
|---|---|---|---|
| **S1 — Geometry & frame core** | strand cluster fix, radial/planar/lanes expansion, subset seeding, shared frame source | `src/dmx/pixelblaze_model_exporter.js`, `src/gui/pixel_map/pixel_map_layout.js`, `src/gui/pixel_map/pixel_map_frame_source.js` (new), `tests/pixel_map_layout_expansion.test.js` (new), `tests/pixel_map_frame_source.test.js` (new), `tests/pixelblaze_model_exporter_strand_keys.test.js` (new) | ~1 d |
| **S2 — View model** | schema, selectors (incl. view_registry hook), defaults, persistence + migration, add/remove ops (logic only, no UI) | `src/gui/pixel_map/pixel_map_views.js` (new), `src/gui/pixel_map/pixel_map_view_defaults.js` (new), `tests/pixel_map_views.test.js` (new) | ~1 d |
| **S3 — Pane shell** | split-tree model, pane painter, multiview Preact shell + own CSS, keybindings, capture/perf tools | `src/gui/pixel_map/pixel_map_pane_tree.js` (new), `src/gui/pixel_map/pixel_map_pane_view.js` (new), `src/gui/modern/pixel_map_multiview_panel.js` (new), `agent_tools/pixel_map_capture.cjs` (new), `agent_tools/pixel_map_perf_test.cjs` (new), `tests/pixel_map_pane_tree.test.js` (new) | ~1.5 d |
| **S4 — Integration** (after S1–S3) | wire store→frame source→views→panes, per-pane interaction, retire single-view path, migration on load, shortcuts help, full verification (§6) | `src/gui/pixel_map/pixel_map_store.js`, `src/gui/pixel_map/pixel_map_interaction.js`, `src/gui/pixel_map/pixel_map_renderer.js`, `src/gui/modern/pixel_map_panel.js`, `src/gui/shortcuts.js`, `main.js`, `style.css` (if needed) | ~1 d |

Read-only imports across slices are allowed and expected (S3 imports S1's
layout helpers at integration time); only WRITE ownership is exclusive.
`view_registry.js` is read-only for everyone (S2 imports it, never edits).

---

## 8. Open questions for the operator (only real blockers)

1. **Profile binding:** keep the multiview exclusively as the `2d_pixels`
   full-screen viewport (current contract, recommended — the mapping split
   owns in-3D screen area), or must it also open as a windowed surface
   while a 3D profile is active? Changes S4 wiring + daily workflow; needs
   a ruling before S4.
2. **Smoke-stack section membership:** the scene has TWO chimney par
   groups (`Left/Right Top Chimney Generator`, 10 fixtures each), not one
   8-par ring. Default proposal: the `stacks` panel shows **both groups as
   two rings** (membership = those two groups, data-driven, count-agnostic).
   Confirm, or name the exact fixtures/single stack you want focused.

Non-blocking note: the working tree carries 16 strands (1,147 px total)
while the dossier cites 28/1,120 px — everything here is data-driven, so
the discrepancy changes nothing in this design, but the model-staleness
issue from report `20260724_7` §1.4 still stands.

---

## Honesty notes

- No source was edited; the only live probe was the §1.3 screenshot on the
  already-running shared stack (standard ports, untouched).
- The strand mono-cluster claim is code-read (exporter `:346-373` omits the
  keys; `buildClusters` clusters on `fixIndex` contiguity) **and** confirmed
  by the live header (`85 fix` for an 84-DMX + 16-strand scene).
- Perf numbers in §3 are budgets derived from today's renderer structure
  and the `20260724_1` real-GPU findings, not fresh multi-pane
  measurements — `pixel_map_perf_test.cjs` (S3) is what makes them
  enforceable.
- `saveModelJS` byte-identity after the exporter edit was verified by
  reading the serializer's explicit field list (line 453); the S1
  regression test still must lock it in.
