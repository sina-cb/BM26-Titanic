# _225 — Deck PIXELS window + orientation-aware second playlist

**Scope:** CaptainPad deck workspace shell + one new window + read-only data
plumbing. No engine source touched. No git operations.

## The two operator orders

1. *"in the deck, the UI rehaul is great! please add a new panel which is the 2d
   pixel view from the simulation style, read the model from sim and show it
   optimize for fast showing of the mapped pixels and make sure the pixels look
   amazingly pixel arty and representative"*, then the ruling
   *"simulation 2d pixels are the source of truth please"*.
2. *"in the deck view for the 2nd playlist, when in vertical layout for the whole
   app (the optional panels go under the main playlist) spawn the 2nd playlist as
   a new column on the right of the main playlist, when moved to horizontal
   layout, move the 2nd playlist to the bottom of the main one as it is now"*.

---

## 1. PIXELS — the simulation's 2D pixel map, lit by the engine

### 1.1 Where the picture comes from (the source-of-truth ruling, honoured literally)

The geometry is **not** derived here and **not** derived from the engine model.
It is the **simulation's own resolver output**, consumed verbatim.

```
simulation/scenes/titanic/pixel_map_views.yaml   ← the operator's authored views
  → simulation/src/gui/pixel_map/{pixel_map_layout,pixel_map_views}.js  (the resolver)
  → simulation/tools/export_touch_control_pixel_views.mjs               (offline export)
  → docs/ui/touch_control_pixel_views.json        ← per-pixel design-space x/y/size/shape
  → served by the SIM's HTTP server (repo root is its document root)
```

**Exact route the window fetches:**
`GET http://<simHost>:6969/docs/ui/touch_control_pixel_views.json`
(host derived from the engine api_base by the new `simulationOriginFromApiBase`,
which is now also the single prefix `simulationUrlFromApiBase` builds on — one
place decides where the simulator lives).

This is the same artifact the standalone Live Touch surface already reads
(`docs/ui/touch_control_pixel_views.js`), so both surfaces now share one picture.
Because it is the resolver's *output*, every operator-ordered departure the sim
carries — the Top-Down gap `compress`, the VintageLed `expandPitch`, per-panel
`rotate`, his saved `offsets` — is already baked in. **None of that math is
re-implemented here**, which is the whole point: there is exactly one
implementation of the layout, and it lives in the sim.

Views come from the artifact too (`TOP-DOWN / FRONT / LED STRANDS / TE SIGN` are
*his* authored views, in *his* order) — the window opens on `top_down` by NAME,
so re-ordering the artifact still opens on the ship.

### 1.2 The live frame path (existing, read-only, no new WS type)

`utils/engineVizEvents` → the engine's existing **`/ws/viz`** singleton bus →
`{type:'vis'}` frames. No new socket, no new message type, no writes. Same bus
`ChannelVizStrip` and the deck's master strip already use.

**Two real buffers, offered as a labelled toggle** (`SHOW` / `RIG`):

| chip | key | what it is |
|---|---|---|
| `SHOW` *(default)* | `preDimmer` | composition after global FX, **before** section dimmers/blackout — the same buffer the deck's master strip above this window draws |
| `RIG` | `rig` | post-dimmer, post-blackout hardware truth |

`SHOW` is the default on the engine's own documented reasoning (engine.js ~1300:
the dimmers *"would otherwise wash the UI preview out to near-black"*). **Measured
live this session:** `rig` averaged 50/1530 against `preDimmer`'s 173, with 92 % of
samples under value 40 — the first screenshot pass rendered a nearly invisible
ship, which is exactly that wash-out. Both are real engine buffers; the toggle
picks between two truths, never between truth and flattery.

### 1.3 The resolution seam — declared, never silent

**The engine subsamples its vis broadcast.** `marsin_engine/config.yaml` sets
`vis.maxPixels: 100`, and `engine.js` builds `visSampleIdx[i] = floor(i *
pixelCount / maxPixels)` once at boot. **Measured on the live rig: 100 px/key at
5.2 Hz, for a 964-pixel model.**

That cap is **not ours to raise**: `ChannelVizStrip` renders one RN `<View>` per
sample per channel, so lifting it to the full model would put ~964 Views per
channel on the iPad's UI thread — precisely the starvation the cap exists to end.

So the window:

* draws **every** mapped pixel at its **true sim position** (the ship's shape is
  exact — that is what "representative" means), and
* colours each from the **nearest transmitted sample**. Because model indices run
  contiguously along a strand, that is a ~10-pixel colour band travelling along
  that strand — a resolution statement, not an invention. `sampleIndexForModelPixel`
  is the exact inverse of the engine's table and is unit-tested against it, is
  monotonic, and is the **identity** whenever the cap stops binding.
* **prints the real numbers on screen**: `720 PX · 100/964 COLOUR SAMPLES`.

Nothing is fabricated — every pixel's colour is a byte the engine really sent,
just shared with its neighbours, and the operator can see the ratio.

### 1.4 Making it look like the sim

Two things ported straight from `simulation/src/gui/pixel_map/pixel_map_renderer.js`:

* **`PREVIEW_GAMMA = 0.6`** (`_previewBrighten`) — a hue-preserving gamma on the
  pixel's VALUE. Lifts dim/dimmed light so it reads on a screen; leaves full
  brightness alone; scales all channels by the same factor so hue and saturation
  are untouched. Display-only — sACN still carries the true colour.
* **`PIXEL_STAGE_BG = '#0b0d12'`** — the sim's own `BG`, **fixed on every theme**.
  This is an identity colour in the `constants/identity.ts` sense: it identifies
  something outside this app's theme. On the light palette
  `surfaceContainerLowest` is literally `#ffffff`, and the first screenshot pass
  proved what that does to a pixel map. The night sky does not flip with the
  operator's theme. The chrome *around* the stage stays fully themed.

Plus, this window's own paint: an additive (`lighter`) halo pass over lit pixels
only — so overlapping strands bloom into each other rather than the last one
painted winning — then a crisp core pass with half-pixel snapping (a 2px square
stays a *square* instead of smearing across two half-lit columns), and a faint
ghost for unlit pixels so the hull keeps its shape through a blackout.

### 1.5 Rendering approach + measured cost

A raw `<canvas>` 2D context, **touched zero times by React on the frame path**:
the vis subscriber writes into a ref and calls an imperative draw. React
re-renders only when the artifact loads, the view/source changes, or an error
does. Geometry lives in parallel typed arrays (`Float32Array`/`Int32Array`) built
once per view, so the hot loop walks contiguous memory and allocates nothing.

**Measured on the live rig** (720 glyphs, 618×463 CSS canvas, headless Chrome):

| | |
|---|---|
| canvas fill calls / frame | **1000 – 1430** (720 cores + one halo per lit pixel) |
| draw time / frame | **1.1 – 7.1 ms**, median **~2–4 ms** |
| at the engine's 5 Hz | **~1–2 % duty** |

A hidden window is mounted but **idle** — it keeps its subscription and does no
decode and no paint.

### 1.6 Workspace integration

* New window id **`pixels`**, appended **LAST** in `DECK_WINDOW_IDS`, so every
  previously reachable composition renders exactly as before.
* Wide flex weight **4** (the only non-3 secondary window): its content is one
  wide-aspect picture and a letterboxed fit is bounded by the narrower axis — at
  weight 3 in the all-five-open row the ship shrank to fit a column it could not use.
* Chip in `DeckWorkspaceBar`, identity dot **`C.secondary`** — the palette's
  *neutral* ink, deliberately: every other accent in that row means "this window
  is about X", and this window is about the rig's own colour, so an accent of its
  own would compete with what it displays. Contrast-guarded like the rest
  (clears the 3:1 UI-component bar on both chip grounds on all five themes,
  worst case gruvbox 4.72, distinct from every other dot) — pinned in
  `restyle_contrast.test.ts`.
* `display:'none'` no-remount contract honoured (via the unchanged `DeckWindow`).
* **Performance overlay: untouched, exactly like COLORS.** `PERF_HIDDEN_WINDOWS`
  stays `['parameters','autopilot']`. The order named *"the params and auto pilot
  **settings**"*; PIXELS is a pure monitoring surface with no controls, and a
  show is when the operator most wants to see what the rig is doing. Verified
  live — the screenshots below were taken while the engine was genuinely in
  performance mode, and PIXELS is visible in them.
* `patternsFillsNarrow` from `_217` still holds: PIXELS open = a second window =
  the pin is restored. Pinned by test and by screenshot.

### 1.7 The upgrade hazard, and the fix

The brief asked for "default closed so existing persisted layouts are unchanged".
**Default-closed alone does not achieve that**, and this is worth recording: only
the **closed set** is persisted, so "open" is the *absence* of a name — and a
store written before a window existed cannot possibly name it. Adding a fifth
window to a pure closed-set store therefore springs it **open** on every operator
who had ever touched the workspace bar.

Fix: the persisted object now also records **`known`** — the set of windows the
writing build had an opinion about. On hydrate, any current window outside
`known` is appended to `closed`. A store with no `known` field is a pre-`_225`
build and is treated as knowing `LEGACY_KNOWN_WINDOWS` (the original four).

The key stays **`deck_workspace_layout_v1`** on purpose: this is a
backwards-compatible addition, and bumping the key would discard every operator's
real preferences to fix a problem affecting one window. Tested: every pre-`_225`
store reproduces its pre-`_225` deck exactly, a post-`_225` store that
deliberately opened PIXELS keeps it open, and every reachable layout round-trips
through serialize → JSON → normalize.

---

## 2. Second playlist follows the app's layout mode

`SplitPlaylistPanes` gains one prop, **`sideBySide`**, wired as `sideBySide={!isWide}`.

| app layout | PATTERNS' shape | DECK B |
|---|---|---|
| **WIDE** (landscape) | one tall, narrow column in a row of windows | **under** DECK A — byte-identical to before |
| **NARROW** (portrait) | a full-width, short band | a **column to the RIGHT** of DECK A |

The reasoning is the shape of the space PATTERNS is given: in wide mode height is
the abundant axis, in narrow mode width is, and stacking in narrow gave two
~140pt-tall panes where splitting sideways gives two full-height columns.

Everything else is axis-agnostic and shared: the **same stored ratio** ("pane 1's
share" is meaningful on either axis), the same engine clamp band `[0.15, 0.85]`,
the same divider, the same PanResponder. The axis selects only which layout
property, which gesture delta (`dx` vs `dy`), which container extent
(`width` vs `height`) and which minimum applies (`MIN_PANE_W_PT = 200` vs
`MIN_PANE_PT = 140` — a 140pt-*tall* pane still shows entries, a 140pt-*wide* one
cannot hold a label and its LOAD… control).

**DECK B's lifecycle is untouched** — its ✕ remains the one authoritative unbind.
This is placement, nothing else. The axis is read through a ref so the once-built
PanResponder stays correct if the iPad is rotated mid-drag, and the sideways
divider carries `touchAction:'none'` on web (scoped to the new axis, so the
shipped vertical divider is not touched).

Composes with `_217`: in narrow PATTERNS-fullscreen the two columns get the whole
screen height — see the screenshot.

---

## Files

**New**
* `CaptainPad/components/deck/pixel_view_logic.ts` — pure brain: artifact
  validation, flattening, viewport fit, RGBWAU→display, the sim's preview gamma,
  the engine sample-index inverse, the honesty caption.
* `CaptainPad/components/deck/pixel_view_logic.test.ts` — 41 tests.
* `CaptainPad/components/deck/pixel_view_window.tsx` — canvas surface.
* `simulation/agent_tools/deck_pixels_capture.cjs` — reproducible screenshots.

**Edited (surgical)**
* `deck_workspace_layout.ts` — `pixels` id/title/weight, `known` +
  `serializeLayout` + `LEGACY_KNOWN_WINDOWS`, perf-overlay note.
* `deck_workspace_layout.test.ts` — case matrix 8 → 16 reachable layouts, new
  upgrade suite.
* `deck_workspace.tsx` — PIXELS identity colour, persistence via `serializeLayout`.
* `split_playlist_panes.tsx` — the `sideBySide` axis.
* `app/(tabs)/index.tsx` — PIXELS track, `sideBySide={!isWide}`, one stale comment
  corrected. Additive; minimal, as another agent was in this file.
* `utils/simulation_url.ts` (+ test) — `simulationOriginFromApiBase`.
* `components/restyle_contrast.test.ts` — PIXELS dot added to the guarded set.

## Verification

* **Unit:** my four touched test files **109/109 pass**. Full CaptainPad suite
  **1468 passed / 6 skipped**, with **6 failures in two files I did not touch** —
  `components/performance_mode_logic.test.ts` (2, a concurrent `editPrincipal`
  change) and `utils/special_events_api.test.ts` (4, concurrent passcode work).
  My failing list is **empty**.
* **tsc:** the only errors in the tree are the same concurrent
  `performance_mode_logic.test.ts` `editPrincipal` mismatch. My files clean.
* **eslint:** 0 errors; none of the 14 pre-existing warnings are in my files.
* **Screenshots** `~/tmp/fix_225/` — 7 PNGs, all visually inspected, fresh dist on
  **:7167** (never the operator's :6967), console muted before boot, one tab,
  against the live stack (engine :6968 titanic, sim :6969). Read-only GETs only;
  no engine state written.

| file | shows |
|---|---|
| `225_wide_pixels_open.png` | wide deck, PIXELS beside PATTERNS, live map, view chips, `720 PX · 100/964 COLOUR SAMPLES`, SHOW/RIG toggle |
| `225_wide_all_open.png` | every window open — the tightest five-track row |
| `225_wide_default_rail.png` | default layout, PIXELS on the HIDDEN rail (the upgrade case) |
| `225_narrow_pixels_open.png` | narrow stack: **DECK B as a right-hand column** + PIXELS below |
| `225_narrow_patterns_fullscreen.png` | `_217` fullscreen still holds, with DECK B side-by-side |
| `225_narrow_stack_with_optionals.png` | narrow with optional windows open — stack order intact |
| `225_canvas_zoom.png` | the map at 2× — glow bloom, crisp cores, par rings / bars / strands |

## Open for the operator

* **`SHOW` vs `RIG` default.** The window opens on `preDimmer` (SHOW) to match the
  deck's master strip and stay legible under section dimmers. If he wants the
  monitor to default to hardware truth, it is a one-line flip.
* **The 100/964 colour cap** is the one real fidelity limit. Raising
  `vis.maxPixels` would sharpen this window but would put ~964 RN Views per
  channel into `ChannelVizStrip`; a per-key cap (full-rate `rig`/`preDimmer`,
  capped channels) would be the clean fix, and is an **engine** change — not
  taken here.
* **No reload/restart needed on the engine or sim.** Client-side only. The deck
  needs a **fresh CaptainPad web build** to pick it up (`npm run web:build`); the
  operator's `:6967` instance is his to restart.
* The window requires the **web build** (a 2D drawing context is a browser
  primitive; the repo has no `ios/`/`android/` project and ships
  `web.output: "static"`). On any other platform it renders a named refusal
  rather than a blank box.
