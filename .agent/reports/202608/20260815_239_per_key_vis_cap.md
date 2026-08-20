# _239 — per-key vis caps (PIXELS at full rate) + the FRONT / TE SIGN fit

**Numbering note:** this work was briefed as `_235`. That slot was taken while
it ran (`20260815_235_pattern_curation_ambient_extra.md`, the curation
session), so it landed as **`_239`** — the first free number at the tracker
tail. Every in-code reference says `_239`.

**Scope:** engine vis-broadcast budget (new `lib/vis_budget.js`, `engine.js`
broadcast, `config.yaml`), the two CaptainPad surfaces that consume it, and the
Deck PIXELS window's view fitting. No pattern content touched. No git
operations.

---

## 0. The two orders

1. `_225`'s own open item: **"a per-key cap (full-rate `rig`/`preDimmer`,
   capped channels) would be the clean fix, and is an ENGINE change — not taken
   here."** The window printed `100/964 COLOUR SAMPLES` for a 964-pixel model.
2. The operator, mid-pass: *"fix these views please the other 2 are perfect. TE
   Signs and FRONT need some adjustment and proper fitting"*.

Both are in the same window, and — as it turns out — the second one was not a
fitting-constant problem at all.

---

## 1. The cap becomes PER KEY

### 1.1 Why one number could not serve both consumers

`vis.maxPixels: 100` existed because **every** consumer was a `<PixelStrip>`:
one RN `<View>` per sample per channel on the iPad's UI thread, times however
many channels are open. That is a real cost and the cap is the right answer
for it.

`_225` added a consumer with the opposite cost model: a raw 2D canvas whose
work is **per pixel DRAWN, not per sample received**. Its fidelity *is* the
sample count. One number cannot be right for both, so it is now two:

* per-**channel** keys keep `vis.maxPixels` (unchanged, 100);
* the whole-rig **composite** keys can be raised individually.

### 1.2 The config shape

```yaml
vis:
  broadcastHz: 5
  maxPixels: 100          # DEFAULT budget — every per-channel key
  keyMaxPixels:           # per-key overrides: positive integer, or `full`
    rig: full
    preDimmer: full
```

`full` = send the model verbatim, no subsampling. `config.yaml` carries the
reasoning in comments; the contract itself is the header of
**`marsin_engine/lib/vis_budget.js`**.

### 1.3 Validation is LOUD (codex P0)

An **absent** field takes its documented default. A field that is **present
but unreadable** throws at boot, naming the valid set:

| what | result |
|---|---|
| `vis: 5` (not a mapping) | throw |
| `vis.maxPixel: 100` (typo) | throw — *"unknown field vis.maxPixel — valid fields are broadcastHz, maxPixels, keyMaxPixels"* |
| `broadcastHz: 0` / `'5'` / `NaN` | throw |
| `maxPixels: 2.5` / `-3` / `'FULL'` | throw |
| `keyMaxPixels: {predimmer: full}` | throw — *"…is not a whole-rig vis key — valid keys are master, preDimmer, rig, `__deck_inactive__`, `__deck_swap__`"* |
| `keyMaxPixels: {rig: -4}` | throw, naming that key |

`keyMaxPixels` may only name the engine's **fixed** whole-rig keys. Per-channel
keys are runtime channel ids — a config file naming one would bind to a channel
that may not exist next boot — so they always take the default, and naming one
throws rather than being silently ignored. A silently-ignored `maxPixel: 900`
typo is precisely the failure that leaves an operator staring at a window that
never sharpened.

### 1.4 The sampler

One index table + one scratch buffer **per distinct budget**, built lazily and
reused for the life of the engine — so `rig` and `preDimmer` share, and eight
channels share one. The hot path allocates nothing, exactly as before. A
full-rate key is returned **without copying at all** (the buffer itself is
handed back).

The sampling rule per budget is byte-identical to the single-cap era —
`sampleIdx[i] = floor(i * pixelCount / budget)` — so CaptainPad's existing
inverse (`sampleIndexForModelPixel`) still holds, and is asserted against it.

### 1.5 The frame gained two honest fields

`pixelCount` still means *"how many samples a default-budget (per-channel)
buffer carries"* — pre-`_239` clients read exactly what they always did. Added:

* **`pixelCounts`** — `{ <visKey>: n }`, the per-key truth;
* **`modelPixelCount`** — the model's real size, so a client can tell "full
  rate" from "capped" without inferring it.

Boot banner now reads:
`📊 Vis broadcast: 5 Hz · 100 px/strip · preDimmer 964 (full) · rig 964 (full) · model 964 px`

---

## 2. The strip fix this REQUIRED (not optional)

`preDimmer` is read by three surfaces, not one: the deck's LIVE OUTPUT strip
(`app/(tabs)/index.tsx`), the mixer's master strip (`ChannelVizStrip
vizKey="preDimmer"`), and PIXELS. `PixelStrip` took **the first N samples**
(`Math.min(pixelCount=256, len/6)`). Handed 964 samples it would have drawn
model pixels 0…255 — **the bow of the ship stretched across a bar the operator
reads as the whole rig**. Nothing would look broken; it would simply be wrong.

So the strip now declares its **own** budget and samples ACROSS the buffer with
the engine's own uniform rule (`components/ui/pixel_strip_logic.ts`, pure +
unit-tested). Engine budget = a **bandwidth** decision; strip budget = a
**render** decision. They were conflated; each layer now owns its own.

`STRIP_MAX_SEGMENTS = 100` is not a guess — it is exactly what every strip has
been drawing since the cap was introduced, so **the strips' render cost changes
by zero** while what they show gets fixed.

---

## 3. PIXELS at full rate

* `buildSampleLookup()` returns **`null`** when `sampleCount >= modelCount`. A
  lookup would then be the identity on the model index — i.e. a copy of
  `flat.modelIndex`, which the caller already has — so the nearest-sample
  upsampling path is **not walked at all**, not merely walked as an identity.
  The capped path is kept, exact and tested, because it is still reachable (an
  operator lowering `keyMaxPixels` for WiFi; an older engine with no per-key
  caps).
* The disclosure line now prints the **arithmetic on both paths**:
  `720 PX · 964/964 COLOUR SAMPLES · FULL RATE` (was `720 PX · FULL-RATE
  COLOUR`). A claim with its numbers attached is checkable; "FULL RATE" alone
  is a word.

### 3.1 A caption bug the capture caught

`drawn` was read off `drawRef.current` **during render**, but the flatten
happens in an effect — so after every view switch the caption showed the
**previous** view's pixel count (`720 PX` while showing FRONT's 396). Found by
reading the capture log, not by looking at a picture. Now state, set where the
view is flattened. The whole point of that line is that it is the number you
can trust.

---

## 4. Measured

### 4.1 Canvas draw cost — full rate costs the canvas NOTHING

Instrumented in-page (`deck_pixels_capture.cjs --perf`): a frame is one
`setTransform` → the last drawing call before the next one.

| view | glyphs | fill calls / frame | draw ms (median) | p95 |
|---|---|---|---|---|
| TOP-DOWN | 720 | 1441 | **1.8 – 2.6** | 3.3 – 3.5 |
| FRONT | 396 | 793 | **1.2 – 1.8** | 2.0 – 2.9 |
| LED STRANDS | 320 | 641 | **0.6 – 1.3** | 1.2 – 2.7 |
| TE SIGN | 148 | 297 | **0.2 – 0.5** | 0.6 – 1.1 |
| all-five-open (283×433 track) | 720 | 721 – 1441 | **1.3 – 2.7** | 3.3 – 3.9 |

Ranges are across runs; the high ends were taken with the full engine test
suite hammering the same CPU (worst single frame observed 8.6 ms). Compare
`_225`'s 100-sample baseline: **1.1 – 7.1 ms, median 2–4 ms**. So going from
100 samples to 964 moved the canvas cost **not at all** — which is the whole
argument for the per-key split: this consumer's cost is per glyph drawn, and
the glyph count did not change. At 5 Hz that is ~1 % duty.

**No cap reduction needed.** Full rate is the shipped value.

### 4.2 WS payload — 5× bigger, and still small

Measured on the offline engine (titanic, 964 px, 5 Hz, one channel + master):

| | full rate (shipped) | same frames, rig+preDimmer back at 100 |
|---|---|---|
| frame bytes | **17,273** | 3,449 |
| per key (base64 chars) | ch 800 · master 800 · **rig 7,712** · **preDimmer 7,712** | ch 800 · master 800 · rig 800 · preDimmer 800 |
| rate | 4.92 Hz | 4.92 Hz |
| wire | **85.0 KB/s = 680 kbit/s** | 17.0 KB/s = 136 kbit/s |

**Delta: +13,824 bytes/frame = +544 kbit/s.** With all 8 mixer channels open
the frame grows to ~23.7 KB (~933 kbit/s), because each extra channel adds only
800 chars.

**Is 0.68 Mbit/s a problem for the iPad over WiFi?** No — it is under 1 % of
even a poor 2.4 GHz link, and it is one WebSocket the app already holds. Worth
knowing rather than hiding: the honest cost of the fidelity is a 5× payload,
the honest verdict is that it does not matter at this size, and the operator
has `keyMaxPixels: {rig: 240}` in reach with a documented comment if a playa
network ever disagrees. **Nothing was silently reduced.**

One thing worth recording as a future option: the composites run at full rate
**whether or not the PIXELS window is open** (it is default-closed). A
demand-driven subscription would spend that 544 kbit/s only when someone is
looking. That is a `/ws/viz` protocol change, not a budget change, and is not
taken here.

---

## 5. The operator's order: FRONT and TE SIGN

### 5.1 It was not a fitting constant. `_225` was drawing the panels on top of each other.

`_225` noted *"the shipped Titanic views are single-panel"*. **They are not.**

```
top_down   1 panel   main(720)
front      2 panels  left(198)  right(198)      ← LEFT + RIGHT front of the ship
strands    1 panel   main(320)
te_sign    2 panels  sign_1(74) sign_2(74)      ← the two TE signs
```

And every panel's glyph coordinates fill the sim's **whole** 900×520 design
rect — the exporter lays each panel out against the full canvas independently
(`export_touch_control_pixel_views.mjs` → `layoutPanel(..., DEFAULT_CANVAS.w,
DEFAULT_CANVAS.h, ...)`) and expects the consumer to give each one its own
sub-rect. Measured overlap in the shipped artifact: `front.left` spans
x[145, 795], `front.right` x[290, 790]; `te_sign.sign_1` x[275, 625],
`sign_2` x[306, 594] — the panels are on top of each other by construction.

`flattenView` merged them into one array and fitted the merged bounding box. So
FRONT drew the ship's left half superimposed on its right half, and TE SIGN
drew sign 2 on top of sign 1. That is exactly the report: a band in the middle,
and *"a sparse cloud of dots"*. **The two views the operator called perfect are
the two single-panel ones** — which is the tell.

The canonical consumer of this artifact already had the answer:
`docs/ui/touch_control_pixel_views.js` → `panelSubRects` + `panelTransform` +
`reprojectView`. `_225` never read it.

### 5.2 The fix — `layoutView()`, measured from the glyphs, no view named

One transform per panel:

1. **Split** the viewport into strips sized by panel `weight`, separated by
   `design.panelGap` (both now REQUIRED by the parser and fail loud — a
   mis-gapped multi-panel view is silently wrong, and the sim always writes
   them).
2. **Letterbox** the view's **common box** into each strip — `flat.bounds`, the
   union of every panel's own bounds.
   *Departure from the sim, deliberate:* its consumer letterboxes the full
   design rect here, but that rect carries the empty margin the operator's
   authored views leave around their content, and on a deck-sized canvas that
   margin is charged **twice, once per panel** — which is why TE SIGN's two
   signs sat small with a chasm between them. The union box trims the margin
   **once, uniformly, from a frame all panels share**, so every panel still
   draws at one scale and keeps its true position relative to the others.
   Measured at 618×463: te_sign scale **0.457 → 0.837** (1.8× larger, nothing
   moved relative to anything else).
3. **Fit** the resulting composite's real extents to `FIT_FILL = 0.92` of the
   viewport (the sim's own constant) and centre it.

**Plus one addition:** a multi-panel view is arranged along whichever **axis
measures bigger** — both are computed and the one that draws the pixels larger
wins, ties to the sim's `columns`. The Live Touch pad is always a wide
full-screen surface, where columns are always right; a deck window is a track
in a row of five and can be almost any shape. Measured on `front`:

| viewport | columns | rows | chosen |
|---|---|---|---|
| 618×463 (PIXELS beside PATTERNS) | 0.433 | **0.494** | rows |
| 283×433 (all five windows open) | 0.195 | **0.401** | rows |
| 900×500 (a wide window) | **0.634** | 0.534 | columns |

This is a **fitting** decision, not a geometry one — which pixel is where still
comes only from the sim's artifact, and `view.framing` (the operator's
zoom/pan of the Live Touch **pad**, in that surface's pixels: `top_down` carries
panY −118) is deliberately still not applied. Nothing is special-cased by name,
so a view authored tomorrow frames itself.

**No regression on the two perfect views:** `top_down` and `strands` are
single-panel, so they take the same path as before and measure identically
(0.804 and 0.980 at 618×463, before and after). The before/after sheet shows
them pixel-for-pixel unchanged.

### 5.3 Glyph sizing

Left as the sim's. Every glyph's `sizeX/sizeY` is the operator's own
`typeStyles` from `pixel_map_views.yaml`, carried verbatim through the
artifact; a nearest-neighbour radius rule here would be a second, drifting
opinion about size. Once the panels stopped overlapping, TE SIGN's dots read
correctly at 1.8× their previous scale — see the screenshots.

---

## Files

**New**
* `marsin_engine/lib/vis_budget.js` — the per-key budget contract: resolve +
  validate + sample + describe. Pure, no engine state.
* `marsin_engine/tests/io/vis_budget.test.js` — 23 tests, incl. one that parses
  the SHIPPED `config.yaml` and asserts it is legal.
* `CaptainPad/components/ui/pixel_strip_logic.ts` (+ `.test.ts`, 11 tests) —
  the strip's own sampling budget.

**Edited (surgical)**
* `marsin_engine/engine.js` — vis budget block replaced by the plan+sampler;
  per-key sampling in the broadcast; `pixelCounts` + `modelPixelCount` added.
* `marsin_engine/config.yaml` — `vis.keyMaxPixels` + the reasoning in comments.
* `CaptainPad/components/ui/PixelStrip.tsx` — stride sampling; `pixelCount` prop
  → `maxSegments` (no caller passed it).
* `CaptainPad/components/deck/pixel_view_logic.ts` — `panelGap`/`weight`
  validation, per-panel flatten + union bounds, `layoutView` / `panelAxisFor` /
  `arrangePanels` / `FIT_FILL` replacing `fitView`, `buildSampleLookup` → `null`
  at full rate, caption arithmetic.
* `CaptainPad/components/deck/pixel_view_logic.test.ts` — 41 → **54** tests.
* `CaptainPad/components/deck/pixel_view_window.tsx` — per-panel paint,
  full-rate path, `drawnCount` state (the stale-caption fix).
* `simulation/agent_tools/deck_pixels_capture.cjs` — `--api-base`, `--prefix`,
  `--views` (one shot per authored view, driving the real chips), `--perf`
  (canvas draw-cost instrumentation), `--zoom` clip. Reusable, not a one-off.

---

## Verification

### Engine suite — failing list EMPTY

| | tests | pass | fail |
|---|---|---|---|
| baseline (before) | 3415 | 3405 | **10** |
| after | 3451 | 3439 | **12** |

Baseline 10: `mixer/all_models_load_lint` ×5 (dev_test_bench groupBits),
`mixer/deck_entry_autocapture` ×4, `patterns/baby_color_contract` ×1 — all
present before I touched anything.
The 2 new ones are `special_events/show_schema.test.js:326` and
`special_events/wedding_show.test.js`, both failing on
`"effectId 'blastWhite' is not allowed as a QUICK EFFECT"` — a concurrent
session's show-schema work, in files I did not open. (The suite also grew by 36
tests, 23 of them mine, the rest concurrent.) **My failing list is empty.**

### CaptainPad suite — failing list EMPTY

| | files | tests | fail |
|---|---|---|---|
| baseline | 75 | 1498 (+6 skipped) | **0** |
| after | 80 | 1588 (+6 skipped) | **0** |

My two files: **65/65**.

### tsc + lint
`npx tsc --noEmit` — clean, zero errors in the tree.
`npx eslint` over all six touched/new CaptainPad files — zero problems.

### Screenshots — `~/tmp/fix_239/`

Fresh dist on **:7169** (never 6967/7167/7168), **served bundle hash verified
against the export before every shoot** (`_232`'s trap):
`entry-00b85a6b8aab230c632df81aa5b53109.js`. Console muted before boot, one tab
per shot. Against the **OFFLINE** engine on **:17235**, `--dest 192.0.2.x`
(TEST-NET-1), isolated config/state/playlist/timeline dirs — boot log shows
`[sACN Out] … destinations [192.0.2.x]`, no Art-Net line, `outputRouting.
controllers: []`. The only live-stack traffic was read-only GETs of the sim's
pixel-map artifact on :6969.

| file | shows |
|---|---|
| `239_view_top_down.png` | TOP-DOWN, lit, `720 PX · 964/964 COLOUR SAMPLES · FULL RATE` |
| `239_view_front.png` | **FRONT — left half above, right half below**, filling the canvas |
| `239_view_led_strands.png` | LED STRANDS, unchanged, `320 PX · 964/964 …` |
| `239_view_te_sign.png` | **TE SIGN — two distinct signs**, 1.8× their previous size |
| `239_wide_all_open.png` | all five windows open; PIXELS in the 283×433 track |
| `239_canvas_zoom.png` | the map at 2× — per-pixel colour on every bar segment, halo bloom, crisp cores |
| `239_before_after_front.png` | FRONT: `_225` merged (red/teal interleaved into a jumble) vs `_239` |
| `239_before_after_te_sign.png` | TE SIGN: two signs superimposed into one cloud vs two signs |
| `239_before_after_all_views.png` | all four views before/after — **top_down and strands identical**, front and te_sign fixed |

The before/after sheets are drawn from the SAME shipped artifact by a scratch
generator (`~/tmp/fix_239/before_after.cjs`) that implements `_225`'s exact
geometry (merge every panel, letterbox the merged box, pad 6) beside the
shipped `layoutView` maths. Left panel red, right panel teal, so the overlap is
unmissable. All nine PNGs visually inspected.

---

## Live reload — **the engine must be RESTARTED**

* **Engine: RESTART REQUIRED.** `vis.keyMaxPixels` is read once at boot
  (`createRenderLoop` builds the plan and the sampler for the loaded model).
  The operator's running `:6968` engine is still shipping 100 samples per key,
  and the window will keep printing `100/964` against it until he restarts it.
  Nothing degrades in the meantime — the capped path is intact and honest.
* **CaptainPad: fresh web build** (`npm run web:build`) for the panel fix, the
  strip fix and the caption. His `:6967` instance is his to restart.
* **Simulation: untouched**, no restart.

---

## Open for the operator

* **Demand-driven vis.** The composites cost 544 kbit/s whether or not PIXELS
  is open. A subscribe-on-demand `/ws/viz` would spend it only when someone is
  looking. Protocol change; say the word.
* **The TE SIGN axis.** At 618×463 the two signs go side by side; in the narrow
  283×433 all-windows track they stack. Both are the measured better fit, but
  if he wants a view PINNED to one arrangement that is a per-view field in
  `pixel_map_views.yaml` and a line here.
* **`rig` vs `preDimmer` default** — unchanged from `_225` (`SHOW`/`preDimmer`),
  still a one-line flip.
