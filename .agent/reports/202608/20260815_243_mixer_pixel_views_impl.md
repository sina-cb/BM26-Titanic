# _243 — Mixer pixel views: implementation (per-channel + master 2D ship, perf overlay, D5 mask)

**Role:** Opus implementer. **Contract:** `docs/58_mixer_pixel_views.md` (the
`_241` Fable design), W1-W6. **No git ops.** Shared tree: `_240`
(special-events) and `_242` (COLORS window) ran concurrently; their files were
not touched.

---

## 1. What shipped, per W-item

### W1 — shared plumbing (pure + tested) ✅

**`CaptainPad/components/mixer/pixel_paint_scheduler.ts`** — one shared,
budgeted, round-robin painter. Subscribers register `{paint, isVisible}` and
call `request()` when a vis frame lands in their own ref; ONE `rAF` drains the
FIFO, stops at **8 ms**, requeues the rest. Latest-buffer-wins falls out of the
shape: the scheduler carries no pixel data, only "this subscriber owes a
paint", so a deferred canvas paints the CURRENT frame later, never a stale one.
`isVisible()` is asked at DRAIN time (collapsed / scrolled-off / hidden-tab
bands cost 0 ms). Clock + frame scheduler are injected; the real one
(`sharedPixelPaintScheduler()`) **throws** if the platform has no
`requestAnimationFrame` / `performance.now` — no setTimeout substitution.
**11 tests** with a fake clock: budget cutoff, at-least-one-paint, round-robin
fairness (a canvas that just painted queues BEHIND the waiting ones),
request-coalescing, drain-time visibility skip, release semantics, duty
measurement, shared-instance identity.

**`CaptainPad/hooks/use_pixel_view_artifact.ts`** — module-cached artifact +
pixel-count loader. **6 tests**: nine simultaneous consumers ⇒ **one** fetch and
the same parsed object; the pixel-count probe is cached separately; a missing
probe is `null` (guard off, never "zero pixels"); a failed artifact load is NOT
cached (the simulator is routinely started after the pad) and surfaces the
simulator's HTTP status verbatim; a malformed artifact propagates the parser's
own loud error.

**Bonus extraction (needed to avoid a fork):**
`CaptainPad/components/deck/pixel_view_paint.ts` — the imperative paint moved
verbatim out of `pixel_view_window.tsx` so the deck window and the mixer bands
share ONE halo pass, ghost ink, half-pixel snapping and glyph floor. The deck
window also migrated onto the artifact hook (its two per-mount fetch effects
are gone). Zero behaviour change; the extraction is a pure move.

### W2 — the band ✅

**`CaptainPad/components/mixer/pixel_view_band_logic.ts`** (pure, **17 tests**)
— band geometry constants, the compact ratio caption (`100/964` /
`964/964 FULL`, refusing to invent a ratio from non-positive counts), the
picker-footer sentence (asserted **identical** to
`describeColourResolution`), the `TOP-DOWN ▾` chip label, the module-level
session store (per-vis-key `{viewId, collapsed}`, hands out copies, ordered
snapshot for the round-trip proof), and `resolveBandViewId` (session choice
wins while the artifact still has that view, else `pickDefaultView`).

**`CaptainPad/components/mixer/pixel_view_band.tsx`** — the surface. Header
(identity dot + `PIXELS` + view chip + ratio + collapse chevron, plus SHOW/RIG
inline on the master), canvas, picker modal in the mixer's own
`modalOverlay`/`modalContent` idiom with the honesty sentence in the footer.
Rows are `artifact.views` verbatim — this file names no view.

Acceptance evidence:
- **Zero React on the frame path.** The band self-subscribes to
  `engineVizEvents`, writes the decoded buffer into a ref and calls
  `scheduler.request()`. The only `setState` on the vis path is `setSampleCount`
  on a CHANGE of sample count — once per session. `MixerScreen`'s
  non-subscription to the viz bus is untouched.
- **Canvas is gesture-dead**: the canvas sits inside a
  `<View style={StyleSheet.absoluteFill} pointerEvents="none">`.
- **≥44 pt**: 22-28 px controls with 10 pt vertical hitSlop, picker rows
  `minHeight: 44`.
- **Non-web** renders `NEEDS A BROWSER` in the canvas slot.
- **One shared `ResizeObserver` and one shared `IntersectionObserver`** for
  every band on the page.
- Header shrink priority is deliberate: the chip and the ratio never shrink,
  the `PIXELS` label does (it only repeats what the dot already says).

### W3 — edit-mode integration ✅

Band under the existing thin `ChannelVizStrip` on every expanded strip (skipped
on `collapsed` group members, which stay minimal), master band inside the
MASTER OUTPUT block below the `preDimmer` strip with SHOW/RIG inline. Canvas
112 px / 96 px per the doc.

### W4 — performance-mode derived layout ✅

Gated on **raw `usePerformanceMode().active`**, not `usePerfLock()` — the
`deck_workspace.tsx:227-233` reasoning, quoted in the code. Derived in render:
LOCAL PARAMS column not rendered, the band moves into that slot
(`allowCollapse={false}`, `forceExpanded`, canvas fills the column), the static
`PARAMS HIDDEN · SHOW MODE · MIDI STILL LIVE` caption under it, master forced
open at 160 px, playlist column stays. **Zero writes** to any layout or
preference state — the perf branch only READS the session store.

Round-trip: the capture harness enters and leaves performance mode **in one
page** with a band already folded, and the layout probe (view chips, canvas
sizes, LOCAL PARAMS presence, band count) is byte-identical before and after —
`round-trip layout identical: true`, shot `243_08`.

### W5 — D5 masking ✅ (the recommended engine change)

`marsin_engine/lib/pattern_mixer.js`, mixer vis pre-pass (the `renderMixer`
loop, previously :3383-3395) — **3 lines**, the same call the deck PFL preview
(:3431) and Live Touch (:3402) already make:

```js
if (channel.compiledPixelMask) {
  applyPreviewMaskBlackout(this.channelBuffer, channel.compiledPixelMask, this.pixelCount);
}
```

**+3 engine tests** appended to `tests/mixer/pattern_mixer_masking.test.js`
(35/35 green): a view-selected channel previews black outside its selection and
keeps full brightness inside it; an unselected channel still previews the whole
model; and the COMPOSITE is unchanged (a masked overlay still preserves the red
background outside its view — the never-dark rule).

**As-built note (operator-visible):** this darkens the thin per-channel strips
for view-selected channels. Shot `243_10` shows it: channel 2 is view-selected
to `Hull Canvas`, and both its band and its thin strip now paint only the hull
pixels, while channels 3/4 (`ALL`) paint across the whole ship. The 2026-06-29
"TRUE pattern at full brightness" ruling is untouched — that is about FADER
independence, and the preview is still pre-fader, pre-blend, full brightness.

### W6 — verification ✅ (§3)

### W7 (`vis.maxPixels 100 → 240`) — NOT taken. Operator's call; §4.
### W8 (class budget + demand-driven `/ws/viz`) — NOT built, per the contract.

---

## 2. The one deviation, measured — perf-mode "dominance"

docs/58 §2.3 says the perf band moves into the vacated params column and fills
its height, "~260-380 px … the dominant view the operator asked for". I built
that, measured it, tried the two alternatives, and measured those too. Numbers,
all from the same build:

| placement | canvas (px) | fitted top-down ship | cost |
|---|---|---|---|
| edit band (shipped) | 316 × 110 | ~316 × 105 | — |
| **perf column @40 % (doc as written)** | 141 × 148 | ~141 × 47 | caption overlapped the canvas |
| **perf column @55 % (SHIPPED)** | 157 × 118 @900 px tall viewport · **157 × 203 @1366×1024** | ~157 × 52 | nothing clipped |
| perf full-width @176 px | 316 × 174 | ~316 × 105 | **playlist + MUTE/SOLO/BUMP pushed off the card** |
| perf full-width @240 px | 316 × 238 | ~316 × 105 | playlist, mute/solo AND transition off the card |

Two facts the design could not have known without building it:

1. **A mixer strip card cannot grow.** `channelCard` is `alignSelf:'stretch'`
   inside a horizontal ScrollView with `overflow:'hidden'`, so its height is
   fixed by the viewport and every pixel the band gains is taken from the rows
   below. On a 1440 × 900 landscape the band region (~145 px) plus the body
   (~85 px) is the entire budget — a 176 px full-width band silently ate the
   playlist and the MUTE/SOLO/BUMP row.
2. **The top-down ship is capped by CARD WIDTH, not height.** It is a ~3:1
   picture in a 316 px card, so it fits at ~105 px tall in *any* full-width
   layout — the 110 px edit band is already at that ceiling. No perf layout can
   render the top-down ship bigger on a 316 px strip.

So I shipped the design's placement, with one change: **the perf-mode body
splits 55/45 in the view's favour** instead of the edit-mode 60/40 the other
way (`PERF_PIXEL_COLUMN_WIDTH`). The tall slot is real value for the
MULTI-PANEL views (`front`, `strands` stack their halves vertically); for
top-down it is honestly not bigger than the edit band. Where perf-mode
dominance actually lands is the **master band: 1294 × 158**, which is the
composition worth watching during a show.

This is the report's main veto point (§4).

---

## 3. Verification

### Suites

| suite | result |
|---|---|
| CaptainPad vitest | **85 files, 1706 passed, 6 skipped, 0 failed** (baseline at session start: 81 / 1598 / 0 failed). **My failing list is EMPTY.** My +34 tests: 11 scheduler, 6 artifact loader, 17 band logic. The rest of the growth is `_240`/`_242` landing concurrently. |
| marsin_engine `npm test` | **3498 tests, 3490 pass, 8 fail.** All 8 are FOREIGN and in files I never touched: 5 × `tests/mixer/all_models_load_lint.test.js` (`dev_test_bench` groupBits drift — "stale: [ParLights, VintageLights, BarLights, LED_0]"), `tests/patterns/baby_color_contract.test.js`, `tests/playlist/ambient_playlist_campaign.test.mjs`, `tests/special_events/wedding_show.test.js` (playlist byte-identity across scenes — `_240`'s live campaign). |
| `tests/mixer/pattern_mixer_masking.test.js` | **35/35** including the 3 new D5 tests |
| `tsc --noEmit` | clean |
| `expo lint` | clean on every touched file (16 pre-existing warnings elsewhere, none mine; no `Alert` import — `utils/op_dialog.ts` is the only dialog path and this work needed none) |

### Paint budget — measured, not asserted

Instrumented in-page (every `setTransform` opens a canvas, every fill/arc
extends it, `requestAnimationFrame` brackets a DRAIN), 20 s windows, fresh dist
on :7174 against the offline engine. Numbers are per-drain wall time in ms;
note the instrumentation itself adds a `performance.now()` per fill call, so
these are an UPPER bound on the real cost.

**5 bands visible (4 channels + master, 1440 × 900):**

| canvases in the drain | n | median | p95 | max |
|---|---|---|---|---|
| 5 | 95 | **5.3** | 7.2 | 9.2 |

**9 bands visible (8 channels + master, 2560 × 1000):**

| canvases in the drain | n | median | p95 | max |
|---|---|---|---|---|
| 1 | 14 | 0.9 | 1.3 | 1.3 |
| 4 | 7 | 6.5 | 8.3 | 8.3 |
| 7 | 14 | 8.0 | 9.1 | 9.1 |
| 9 | 56 | **7.7** | 8.4 | 13.6 |

Reading: the 8 ms budget holds. A drain's worst case is `8 ms + one canvas`
(the budget is checked AFTER a paint, so the first canvas is never refused) —
the 13.6 ms outlier is exactly that shape. The design's feared 20 ms burst does
not occur, because a 316 × 110 band costs ~0.85 ms rather than the `_239`
full-window 2.2 ms; the scheduler is what *guarantees* that, not what the
measurement happened to find.

**Visibility gating confirmed in every capture**: with 8 channels in a 1440-wide
row, the four strips scrolled out of the horizontal ScrollView report canvases
at the un-sized `300x150` default — they never painted at all.

### Screenshots — `~/tmp/fix_243/`, all visually inspected

| # | file | shows |
|---|---|---|
| 1 | `243_01_edit_landscape.png` | edit mode, 4 channels, bands open + lit, master band open, `100/964` on channels and `964/964 FULL` on master |
| 2 | `243_02_channel_front_view.png` | a CHANNEL band on `FRONT` (multi-panel) while the master stays TOP-DOWN |
| 3 | `243_03_view_picker.png` / `243_03a_view_picker_master.png` | picker modal, four authored views, ✓ on the active row, honesty sentence in the footer (`720 PX · 964/964 COLOUR SAMPLES · FULL RATE` on master) |
| 4 | `243_04_band_collapsed.png` | one band collapsed to header-only, siblings open |
| 5 | `243_05_eight_channels.png` | 8 channels, scrolled row, off-viewport bands unpainted |
| 6 | `243_06_perf_dominant.png` + `243_06a_before_perf.png` | perf mode — LOCAL PARAMS gone, view in the column, caption |
| 7 | `243_07_perf_master_band.png` | perf master band at 160 px with SHOW/RIG |
| 8 | `243_08_perf_exit_roundtrip.png` | perf exit — layout identical to `06a` |
| 9 | `243_09_portrait_narrow.png` | portrait 834-wide, band in the narrow column |
| 10 | `243_10_view_selected_channel.png` | **D5**: channel 2 view-selected to `Hull Canvas` — band AND thin strip dark outside the selection, siblings unmasked |
| — | `243_perf_1366x1024.png`, `243_perf_1194x834.png` | perf layout at real iPad landscape sizes (the §2 measurements) |
| — | `243_capture.json` | every run's probe + scheduler stats |

Harness: **`simulation/agent_tools/mixer_pixel_views_capture.cjs`** (new) —
fresh dist on :7174, console muted before boot, `API_BASE` seeded through the
same localStorage key the Config tab writes, `--perf` scheduler instrumentation,
`--artifact <file>` to serve the pixel map from the repo.

### Isolation

- **Offline engine on :17243**, `--dest 192.0.2.x` (TEST-NET-1), black-holed
  config + isolated `MARSIN_STATE_DIR` / `MARSIN_PLAYLISTS_DIR` /
  `MARSIN_TIMELINE_DIR` under `~/tmp/fix_243/engine/`. Asserted on the way up:
  `[sACN Out] Sender started — 38 universe(s) … destinations [192.0.2.x]`, **no**
  `[Art-Net Out]` line, `/status.outputRouting.controllers == []`.
- **LIVE stack (:6966-:6972) never bound, killed or restarted.** The only
  traffic to it was read-only GETs of the simulator's pixel-map artifact.
- **Served-bundle hash verified** on every capture run (final:
  `entry-7b59ef6e01220b0d37b999919e0936a4.js`, served from
  `~/tmp/fix_243/dist5` on :7174). The operator's :6967 Expo instance and the
  :7167 dist were not touched; `expo export` wrote to a scratch `--output-dir`
  each time, never `CaptainPad/dist`.
- **Observed, not caused:** the operator's simulator on :6969 stopped answering
  part-way through the campaign. I neither started, stopped nor wrote to it. The
  remaining captures used `--artifact docs/ui/touch_control_pixel_views.json` —
  the simulator's HTTP document root IS the repo root
  (`utils/simulation_url.ts`), so that file is byte-for-byte the response :6969
  gives. The transport was substituted; the content was not.

---

## 4. Open for the operator (veto points)

1. **Perf-mode per-channel view (§2).** Shipped as the design's column
   placement, widened to 55 %. The top-down ship is capped by the 316 px card
   width in every layout, so perf mode does not enlarge it — it enlarges the
   slot (good for `front`/`strands`) and the master band. Alternatives, all
   measured: (a) full-width 176 px band → 316 × 174, but the playlist and the
   MUTE/SOLO/BUMP row fall off the card at 900 px viewport height; (b) as (a)
   plus hiding the TRANSITION bar in perf mode, which buys ~76 px and makes it
   fit — one more derived flag, one word from you; (c) leave as shipped.
2. **D5 (§W5) — shipped as recommended.** It visibly darkens the thin
   per-channel strips for view-selected channels (shot `243_10`). Say the word
   and it reverts to a 3-line revert plus the
   `FULL PATTERN · MASKED TO <sel> AT MIX` caption instead.
3. **Edit-mode band costs the playlist ~140 px** on every expanded strip
   (the doc's own arithmetic, default OPEN). The chevron folds it per channel,
   session-local. If you would rather it defaulted CLOSED, that is one constant.
4. **W7** — `vis.maxPixels: 100 → 240` sharpens channel colour for
   +44 kbit/s per channel (bands ~10 px → ~4 px). Not taken. Config-only,
   engine restart.
5. **Persistence** — view choice and collapse are session-only (docs/58 §3.3).
   If you want them to survive a reload, it is one AsyncStorage line in the
   same store.
6. **Master band source** — defaults to SHOW (`preDimmer`), RIG one tap away,
   same open question `_225` left.

---

## 5. Restart / rebuild

- **Engine restart REQUIRED** for the D5 mask (`pattern_mixer.js`). The live
  engine on :6968 is still running the unmasked pre-pass; nothing changes on the
  rig until it restarts. No config change, no sACN change, output path
  untouched.
- **CaptainPad web rebuild required** for everything else (client-side only).
- **Simulator**: no change. It must be UP for the bands to fetch the pixel map —
  the band names its refusal loudly if it is not.

## 6. NATIVE COMPATIBILITY (disclosure for docs/60)

The operator's native-first requirement landed mid-flight. This work was built
and verified on web, as contracted. Here is exactly where it stands on native —
**read off the code paths, not estimated**.

### 6.1 What a band does on native TODAY

`Platform.OS === 'web'` is captured once (`pixel_view_band.tsx:166`) and gates
**every** web-bound path, so native is an **explicit, named refusal — no crash,
no blank box, no network, no subscription**:

| path | native behaviour |
|---|---|
| render | early return at `:412` — the real header (dot, `PIXELS`, view chip, chevron) over a correctly-sized stage containing the micro-caps text **`NEEDS A BROWSER`** |
| artifact fetch | `usePixelViewArtifact(isWeb)` is called with `false` — the effect returns immediately, no `fetch`, no cache entry |
| scheduler | subscribe effect returns at `:237` — `sharedPixelPaintScheduler()` is **never constructed**, so its loud "no requestAnimationFrame" throw cannot fire on native either |
| vis subscription | returns at `:261` — the band never joins `engineVizEvents`, so zero decode and zero bus traffic |
| observers | return at `:303` — no `ResizeObserver`, no `IntersectionObserver`, no `document` access |
| `<canvas>` | `React.createElement('canvas')` is inside the web-only return, unreachable |

The deck's PIXELS window has the same shape (its own `!isWeb` refusal screen).

**The honest UX cost, and it is not small:** `mixer.tsx` renders the band
unconditionally, so on a native iPad build the mixer would show **one
`NEEDS A BROWSER` box per channel plus one for the master** — ~140 px of dead
chrome on every strip, and in performance mode the whole params column would be
that box. Honest absence, but nine of them is not shippable as-is. The native
port either supplies a real renderer or `mixer.tsx` must gate the band on
`Platform.OS === 'web'` at the call site (a one-line change, deliberately NOT
taken here so the gap stays visible rather than quietly disappearing).

### 6.2 Portable as-is vs web-bound

**Portable — pure TS, zero DOM, already unit-tested off-browser (34 tests run
in the node-env vitest suite, which cannot even load a `.tsx`):**

- `components/mixer/pixel_paint_scheduler.ts` — the queue, the 8 ms budget, the
  round-robin, latest-buffer-wins, visibility gating. Its clock and frame source
  are **injected**; only `sharedPixelPaintScheduler()` reaches for
  `requestAnimationFrame` / `performance.now`, both of which React Native
  provides, so even the shared instance is expected to work unchanged (verify on
  device rather than trust this line).
- `components/mixer/pixel_view_band_logic.ts` — geometry constants, captions,
  session store, view resolution.
- `components/deck/pixel_view_logic.ts` — the whole geometry/colour core:
  `parsePixelViewArtifact`, `flattenView`, `arrangePanels`/`layoutView`,
  `buildSampleLookup`, `sampleToDisplayRgb`, `previewBrighten`,
  `describeColourResolution`. All typed-array maths.
- `hooks/use_pixel_view_artifact.ts` — `fetch` + `getApiBaseAsync`, both native-safe.

**Web-bound, and precisely three things:**

1. `components/deck/pixel_view_paint.ts` — the only renderer file. Uses
   `canvas.getContext('2d')`, `clientWidth/clientHeight`, `devicePixelRatio`,
   `setTransform`, `fillRect`, `arc`, `ellipse`, and
   `globalCompositeOperation = 'lighter'` for the additive halo pass.
2. The canvas element itself — `React.createElement('canvas', {ref, style})`
   inline in the band and in the deck window.
3. Two small module-level helpers at the top of `pixel_view_band.tsx`:
   `observeResize` / `observeIntersection` (the shared `ResizeObserver` /
   `IntersectionObserver`) and `documentVisible()` (`document.visibilityState`).

One more, shared with every existing viz surface: `atobToBytes`
(`pixel_view_logic.ts:658`) calls the global `atob`. It is already **injected**
into `decodeVisSamples(base64, decodeBase64)` precisely so the platform supplies
its own decoder (the tests pass Node's Buffer), so a native build swaps the
argument, not the function — but the *call site* in the band passes
`atobToBytes`, and whether RN's `atob` polyfill is present in this Expo version
should be checked on device, not assumed. `PixelStrip` (the thin strips, shipped
long before this work) has the same dependency.

### 6.3 Choices that help a Skia port

- **The paint is already ONE file with a narrow signature.** `paintPixelView(canvas,
  state)` was extracted this session (§W1) so the deck window and the mixer bands
  could share it. That extraction is exactly the seam docs/60 needs: a Skia
  backend is a sibling module with the same signature, and both surfaces switch
  together.
- **`PixelViewDrawState` is renderer-agnostic** — flat typed arrays, the design
  rect, the sample LUT and the raw RGBWAU buffer. Nothing in it is a DOM handle.
- **Frames never touch React** (ref → imperative draw). That architecture is
  what a Skia `useCanvasRef()` / `SkPicture` path wants too; a React-per-frame
  design would have had to be rewritten.
- **The scheduler takes its frame source by injection**, so a Skia surface can
  drive it from `useFrameCallback` (Reanimated) or from rAF, with no change to
  the queue semantics or the tests.
- **Visibility is a predicate, not a DOM query.** `isVisible()` is supplied by
  the band; on native it becomes `onLayout` size + screen focus instead of
  `IntersectionObserver`. The scheduler never learns the difference.
- **Layout is measurement-driven** (`layoutView` picks the panel axis from the
  viewport it is handed), so it works off `onLayout` numbers as happily as off
  `clientWidth`.

### 6.4 Choices that hinder it

- `paintPixelView` calls the 2D API **directly** rather than through a tiny
  drawing interface. Skia equivalents exist for all of it
  (`globalCompositeOperation='lighter'` → `BlendMode.Plus`, `ellipse` →
  `drawOval`, `fillRect` → `drawRect`), but it is a rewrite of ~90 lines per
  backend, not a drop-in. If docs/60 wants one implementation, the pass
  structure (halo pass → core pass) should be lifted into a backend-neutral
  emitter that yields draw ops, with two thin adapters.
- The canvas element is **inlined** in both surfaces. A native seam needs a
  component indirection (something like `<PixelStage onPaint={…} />`) — two call
  sites to change, but they are inside the render bodies rather than behind a prop.
- The DPR/backing-store sizing (`canvas.width = cssW * dpr`) is a browser
  concept; Skia handles scale differently and that block does not port.
- `documentVisible()` and the two observers are web-only helpers living **inside
  the band component's module**. They are small and isolated, but they are in a
  `.tsx` the node-env suite cannot load, so they are untested either way.

**Net:** the split is about as favourable as it could be — ~95 % of the new code
(and all of the tested code) is platform-neutral, and the web-bound remainder is
one renderer file plus one element plus three small helpers.

## 7. Files

New: `CaptainPad/components/mixer/pixel_paint_scheduler.ts` (+ test),
`CaptainPad/components/mixer/pixel_view_band_logic.ts` (+ test),
`CaptainPad/components/mixer/pixel_view_band.tsx`,
`CaptainPad/hooks/use_pixel_view_artifact.ts` (+ test),
`CaptainPad/components/deck/pixel_view_paint.ts`,
`simulation/agent_tools/mixer_pixel_views_capture.cjs`.

Modified: `CaptainPad/app/(tabs)/mixer.tsx`,
`CaptainPad/components/deck/pixel_view_window.tsx` (migrated onto the shared
loader + shared paint),
`marsin_engine/lib/pattern_mixer.js` (3-line D5 mask),
`marsin_engine/tests/mixer/pattern_mixer_masking.test.js` (+3 tests).
