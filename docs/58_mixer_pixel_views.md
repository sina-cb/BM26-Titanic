# 58 — Mixer pixel views: the 2D ship on every channel, and on the master

**Status:** DESIGN — ready for implementation ·
**Author:** agent _241 (Fable, design) · **Operator:** Sina Solaimanpour

Operator order (verbatim):

> "mixer change, in the mixer, please add the top down view on the channels
> and add one for the master. make it a nice design by fable to show the top
> down (or possibly other views too based on a drop down or sth)"
>
> "keep in mind we can hide parameters during performance and show viz more
> dominantly with patterns. use the idea from the deck hiding and shit. also,
> optimize for touch performance please in the design"

Related canon: `docs/54_deck_ui_restyle.md` (the visual grammar every spec
below wears), `docs/53_deck_workspace_windows.md` (the deck workspace the
PIXELS machinery was built for), `docs/56_principal_scoped_persistence.md`
(perf-mode semantics, _228), `docs/55` D3 (perf overlay suppression),
`docs/27_mixer_layer_view_selection.md` (preview-mask blackout),
`.agent/reports/202608/20260815_225_deck_pixel_view_window.md` (the PIXELS
window) and `20260815_239_per_key_vis_cap.md` (per-key vis budgets, the
measured draw/payload numbers this doc's arithmetic is built on).

---

## 0. What this is

The Deck's PIXELS window (`_225`/`_239`) — the simulation's own 2D pixel map,
lit live from `/ws/viz` — comes to the **mixer**: one compact 2D view **per
channel strip** showing *that channel's* pattern on the ship, and one for the
**master** showing the post-mix composition. Default view **top-down**; a
compact dropdown switches to any other authored view (front / strands /
te_sign / whatever `pixel_map_views.yaml` grows next).

In **performance mode** the mixer borrows the deck's hiding idea (`_217`
derived overlay, docs/55 D3): the LOCAL PARAMS column disappears and the
channel's pixel view takes that column — viz dominant, patterns (the playlist
column) still in reach, faders untouched.

Everything reuses the machinery that already exists and is already tested:
`components/deck/pixel_view_logic.ts` (artifact parse, `flattenView`,
`layoutView`, sample lookup, honesty captions — 54 tests), the deck window's
raw-canvas paint path, `engineVizEvents`, and the sim-resolved artifact at
`/CaptainPad/live_touch/touch_control_pixel_views.json`. **No new geometry code. No new
sockets. One new render surface, one new scheduler, one screen integration.**

---

## 1. Data reality, and the data-path decision (D1)

### 1.1 What the wire carries today

Per `_239` (`marsin_engine/lib/vis_budget.js`, `config.yaml → vis:`):

| key class | budget (shipped) | samples on titanic (964 px) | b64 chars/frame |
|---|---|---|---|
| per-channel (`<channel.id>`) | `vis.maxPixels` = **100** | 100 | 800 |
| `master` | default = 100 | 100 | 800 |
| `rig`, `preDimmer` | `keyMaxPixels: full` | **964** | 7,712 |

`keyMaxPixels` **refuses per-channel keys by design** — channel ids are
runtime state; a config file naming one binds to a channel that may not exist
next boot (`vis_budget.js:142-147`). That validation argument is correct and
this design does not fight it.

The per-channel buffer is the channel's **own pattern, whole-model, at full
brightness** — pre-fader, pre-blend, hue applied (`pattern_mixer.js:3383-3395`).
That is exactly the right feed for a per-channel ship view: it answers "what
is this layer painting, and where," independent of how far the fader is up.

### 1.2 The decision: render channel views from the capped buffers (no engine change)

**Chosen: the capped path the deck window already ships.** Channel canvases
consume the 100-sample buffer through `buildSampleLookup()` — every glyph
drawn at its exact sim position, coloured from the nearest transmitted sample,
with the ratio printed on the surface (`100/964`). The master view reads
`preDimmer` (already `full`) and needs nothing.

Why this wins, with the numbers:

1. **Canvas cost is identical either way.** `_239` measured the whole point:
   going 100 → 964 samples moved the draw cost *not at all* (top-down, 720
   glyphs: 1.8–2.6 ms median on both). The only thing full-rate channels buy
   is colour fidelity, never speed.
2. **The fidelity gap is invisible at mixer scale.** 964/100 ≈ a ~10-model-px
   colour band travelling along a strand. In a ~112 px-tall channel canvas the
   whole ship is ~300×112 CSS px and a glyph is ~1.6–2 px — a 10-glyph band is
   a smear the eye reads as the pattern's gradient anyway. The scrutiny
   surface for per-pixel colour is the deck PIXELS window, which already runs
   full rate. The mixer view's job is *which pattern, where on the ship,
   moving how* — positions are exact on the capped path.
3. **Full-rate channels are the one option that scales badly.** Each full-rate
   channel key adds 7,712 − 800 = 6,912 b64 chars/frame; at the measured
   4.92 Hz that is **+272 kbit/s per channel**, ×8 channels = **+2.18 Mbit/s**,
   total ≈ **2.9 Mbit/s** — sent to *every* `/ws/viz` client *whether or not
   the mixer tab is open*, multiplying per pad. `_239` already flagged 544
   kbit/s of always-on composite traffic as the thing to fix with a
   demand-driven subscription; quadrupling it before that protocol change
   exists is the wrong order of operations.
4. **Honesty is already built.** The capped path prints its arithmetic
   (`describeColourResolution`), is unit-tested, and disappears by itself
   wherever the budget stops binding. Codex P0 satisfied with zero new code.

**One config-only sharpening knob, offered but not required (W7):** raise
`vis.maxPixels: 100 → 240`. Since `_239`, `PixelStrip` resamples across the
buffer with its **own** render budget (`STRIP_MAX_SEGMENTS = 100`,
`pixel_strip_logic.ts`), so raising the transmit budget costs the RN strips
**zero** render work — it only sharpens canvases. Cost: 240 samples = 1,920
b64 chars, +1,120/frame/channel ≈ **+44 kbit/s per channel** (8 channels:
+353 kbit/s; total ≈ 1.03 Mbit/s). Bands shrink ~10 px → ~4 px. One line, one
engine restart, no code. Operator's call; the design is correct at 100.

**Explicitly rejected: extending `keyMaxPixels` to channel ids.** The `_239`
validation stands (runtime ids don't belong in config). If full-rate channels
are ever truly wanted, the correct engine change is a **class budget** — a new
`vis.channelMaxPixels: <int|full>` field applying to every per-channel key
(validation identical to `maxPixels`; memory is one shared index table +
scratch per distinct budget, ≈7 KB, and zero-copy at `full`) — **and it should
land together with the demand-driven `/ws/viz` subscription** `_239` left on
the table, so the +2.18 Mbit/s is spent only while someone is looking. Spec'd
as deferred W8; not part of this build.

---

## 2. Layout

### 2.1 The band (both modes' shared unit)

One new component — **`pixel_view_band`** — used by every placement below.
Anatomy, top to bottom:

```
┌────────────────────────────────────────────────┐
│ ● PIXELS   TOP-DOWN ▾            100/964   ⌄   │  ← header row, 28 px
│ ┌────────────────────────────────────────────┐ │
│ │            (canvas, PIXEL_STAGE_BG)        │ │  ← the ship
│ └────────────────────────────────────────────┘ │
└────────────────────────────────────────────────┘
```

- **Header row** (28 px + hitSlop ⇒ ≥44 pt targets): identity dot + `PIXELS`
  micro-caps title (docs/54 panel-header grammar); the **view chip**
  (`TOP-DOWN ▾`, quiet-chip tone) opening the view picker (§3); the **ratio
  micro-caption** (`100/964`, or `964/964 FULL` on the master) — the compact
  form of the deck window's honesty line, always present; a **collapse
  chevron** (edit mode only, §2.2).
- **Canvas**: the deck window's paint path verbatim — `PIXEL_STAGE_BG` ground
  on every theme, ghost ink for unlit pixels, additive halo pass, half-pixel
  snapping, `MIN_GLYPH_PX`, `previewBrighten`. `layoutView()` handles any
  aspect (it already chooses the panel axis by measurement, so FRONT stacks
  its two halves in a tall slot and sits side-by-side in a wide one — nothing
  new to write).
- **The canvas takes no touches.** Wrapper `pointerEvents="none"` (§4.1).
- **Master band only**: the deck window's `SHOW`/`RIG` source chips inline in
  the header (`PIXEL_VIS_SOURCES`, default `preDimmer` — same buffer the
  master strip above it draws, same one-tap route to hardware truth).
  Channel bands have exactly one real buffer (the channel key) — no source
  chips, nothing to pretend otherwise.
- **Non-web** (no 2D context): the header renders with the micro-caption
  `NEEDS A BROWSER` in the canvas slot — the deck window's named refusal in
  band form, honest absence, never a blank box. (CaptainPad ships as a static
  web export; this is belt-and-braces, not a real platform.)

### 2.2 Edit mode (performance mode OFF)

**Channel strip** (`app/(tabs)/mixer.tsx`, `ChannelStrip`): the band inserts
directly **below the existing thin `ChannelVizStrip`** (mixer.tsx:883-885) and
above the CHANNEL fader. Canvas height **112 px** (+28 header ≈ 140 px added
to the card). The thin strip stays — it is the zero-cost glanceable that
works at every card state, and the deck sets the precedent (LIVE OUTPUT strip
and PIXELS window coexist on the same buffer).

- **Collapsible**: the chevron collapses the band to header-only (28 px);
  state is per-channel, session-local (§3.3). Default **open** — the operator
  asked for these views; he can fold the ones he doesn't want.
- **Collapsed group members** (`collapsed=true` strips) render **no band** —
  a collapsed strip is deliberately minimal chrome.
- **Portrait / narrow** (320 px column): same band, same 112 px — `layoutView`
  letterboxes; the ship simply draws smaller. No special case.
- **Dense (up to `maxChannels: 8`)**: nothing changes per strip; the paint
  scheduler (§4.2) is what makes 8+1 canvases safe, and off-viewport strips
  in the horizontal ScrollView don't paint at all (§4.2).

**Master**: the band inserts inside the existing MASTER OUTPUT block
(mixer.tsx:2744-2758), below the `preDimmer` strip, full width. Canvas height
**96 px** (top-down is wide; a full-width 96 px slot renders it large).
Default **open**, collapsible like the channels.

### 2.3 Performance mode (the deck-hiding idea) — a DERIVED view, never persisted

Gate on **raw `usePerformanceMode().active`** — not `usePerfLock()` — for
exactly the reason `deck_workspace.tsx:227-233` records: screen composition
follows the *mode* for every session, symmetric on exit; the lock's
captain-session bypass is about edit rights. Unresolved state = inactive =
everything shown (hiding on unknown state would be a fallback, codex P0).

When active, in render, with **zero writes to any layout or preference
state** (the `_217` contract — round-trip byte-identical):

1. **LOCAL PARAMS column hidden** (the whole `paramsPanel`,
   mixer.tsx:1008-1032) — the mixer's twin of the deck suppressing
   PARAMETERS/AUTOPILOT (docs/55 D3).
2. **The pixel view moves into that column slot** and fills its height
   (~260-380 px in landscape — the dominant view the operator asked for).
   The edit-mode band under the thin strip is suppressed in this mode (never
   two canvases per channel). The playlist column **stays** — "viz more
   dominantly *with patterns*": pattern switching is live-performance work,
   not structure (_228: the engine 409s structural routes; playlist
   activation, faders, mute/solo, bump all stay live).
3. ~~**Where the params went is answered on the spot** (the deck bar's
   `PERF_BAR_CAPTION` precedent): one static micro-caps line at the foot of
   the perf-mode view panel — `PARAMS HIDDEN · SHOW MODE · MIDI STILL LIVE`.~~
   **WITHDRAWN — operator order, report _308:** no explainer caption ships,
   here or on the deck bar (`PERF_BAR_CAPTION` is gone too).
   Params hidden ≠ params dead: the MFT keeps driving them (_228 semantics);
   only the on-screen sliders are folded away.
4. **Master band forced open at 160 px** (derived; the session collapse
   preference is read but not written — on exit the operator's folded/unfolded
   choices reappear exactly as he left them).
5. Everything perf mode already gates on these strips (reorder, delete, view
   selection — the `perfLocked` idiom) is untouched by this design.

Exit performance mode ⇒ edit layout returns identically: same bands, same
collapse states, same view choices. There is nothing to restore because
nothing was written.

---

## 3. The view switcher

### 3.1 UX: a compact dropdown chip, not a chip row, not press-hold

The channel card has no horizontal room for the deck window's per-view chip
row (4+ chips × ~70 px in a 320 px card that also carries a title, a ratio and
a chevron). Press-hold is an invisible affordance — rejected. The mixer
already has the exact right idiom in the same card: the **`SCREEN ▾` dropdown**
(blend mode) and `TRANSITION ▾`. So:

- The header's **`TOP-DOWN ▾` chip** opens a **modal picker** — the existing
  `modalOverlay`/`modalContent` pattern (the same one the blend/transition/
  view-selection pickers use), one ≥44 pt row per view, check on the active
  row, tap-outside to dismiss.
- Rows are **the artifact's authored views in the operator's order** —
  `artifact.views` verbatim, never a hardcoded taxonomy (a view authored
  tomorrow appears everywhere at once). Default `top_down` via
  `pickDefaultView` (`PREFERRED_VIEW_ID` precedent).
- The picker's footer prints the **full honesty sentence** for the surface
  (`describeColourResolution` — `720 PX · 100/964 COLOUR SAMPLES`), so the
  compact header ratio always has its long form one tap away.
- Master picker adds nothing else — its SHOW/RIG chips live inline (§2.1).

### 3.2 One artifact fetch for the whole app

`pixel_view_window.tsx` fetches the artifact per mount. Nine mixer bands must
not fetch nine times: extract the fetch into a **module-cached loader**
(`use_pixel_view_artifact` — one in-flight promise, one parsed artifact, every
consumer including the deck window reads the cache; errors surface per-band as
the deck window surfaces them today). Same for the one-shot
`/model/group-layout` pixel-count guard.

### 3.3 What is remembered, and where

Per-surface view choice (+ per-surface collapse state) live in a
**module-level session store** keyed by vis key (`Map<string, {viewId,
collapsed}>`), mirroring `ChannelVizStrip`'s self-containment: survives tab
switches, resets on reload, **never persisted to disk**. This is client UI
state, not rig state — docs/56's persistence gates are not in play, and no
principal question arises. (If the operator later wants choices to survive
reload, that is an AsyncStorage line in the same store — noted as open,
not taken.)

---

## 4. Touch + performance budget

### 4.1 Gesture rules (hard requirements)

1. **The canvas is gesture-dead**: `pointerEvents="none"` on the canvas
   wrapper. All interaction lives on the header chips. Consequences, all
   intended: a drag starting on the ship pans the horizontal strip
   ScrollView exactly like any inert card area; the `HorizontalFader`s'
   capture-claimed drags (and the hue wheel's capture-phase precedent,
   `hue_wheel.tsx:150-159`) never meet a competing responder; there is no
   pan/zoom on mixer canvases (the deck PIXELS window is the scrutiny
   surface — one surface, one job).
2. **Hit targets ≥44 pt**: 28 px header controls + the existing
   `ICON_BTN_HIT_SLOP` idiom, same as every title-bar button on the strip.
3. **No new scroll containers.** The band is fixed-height and non-scrolling;
   the perf-mode column view fills its slot without a ScrollView. Nothing
   nests a same-axis scroll (the hue-wheel lesson stays learned).
4. **React re-render hygiene** (the `_225` law): the band self-subscribes to
   `engineVizEvents` like `ChannelVizStrip`; frames go into a ref and an
   imperative canvas paint — **React renders zero times per vis frame**.
   React renders only on view switch, collapse, artifact load, error, mode
   flip. The mixer screen gets **no new per-tick props** — `MixerScreen`'s
   deliberate non-subscription to the viz bus (mixer.tsx:1700-1718) is
   preserved.

### 4.2 Draw budget, measured, and the scheduler that enforces it

`_239` measured the exact paint this design reuses (720-glyph top-down:
**1.8–2.6 ms median, p95 3.5 ms**; smaller views cheaper; cost is per glyph
drawn and independent of both sample count and canvas CSS size):

| scenario | canvases | burst/vis-tick (nominal ~2.2 ms ea) | duty @ 5 Hz |
|---|---|---|---|
| edit, 2 ch + master | 3 | ~6.6 ms | ~3.3 % |
| perf, 2 ch + master | 3 | ~6.6 ms | ~3.3 % |
| edit, 8 ch + master | 9 | **~20 ms** | ~10 % |

Three canvases are fine unscheduled. Nine painted synchronously in one vis
callback is a 20 ms main-thread stall five times a second — that *is* a
stolen fader frame. So: one tiny shared **paint scheduler**
(`pixel_paint_scheduler.ts`, pure, unit-tested):

- Subscribers register a paint closure; a vis frame **stores the buffer in
  the subscriber's ref and enqueues it** (latest-buffer-wins — a deferred
  canvas never paints stale data, it paints *current* data later).
- One `requestAnimationFrame` drains the queue **round-robin with a time
  budget**: paint, check `performance.now()`, stop at **8 ms**, requeue the
  rest for the next rAF. Worst case (9 canvases ≈ 20 ms) spreads across ~3
  animation frames ≈ 48 ms — every canvas still repaints well inside one
  200 ms vis period, and no single frame carries more than ~half its 16 ms.
- **Visibility gating**: a band that is collapsed, unmounted, in a hidden
  tab, or scrolled out of the horizontal strip row paints nothing
  (`open`-style prop + zero-size check the deck window already has + an
  `IntersectionObserver` on the canvas — web-only surface, so IO is always
  available). Off-screen strips cost 0 ms, which is what makes the 8-channel
  scrolled row cheap in practice.
- One shared `ResizeObserver` for all bands (repaint on resize), replacing
  per-canvas observers.

WS payload: **unchanged** by this design (zero engine change). With optional
W7 (240 samples): +44 kbit/s × channel count (8 ch: +353 kbit/s, total ≈
1.03 Mbit/s — under 2 % of a poor 2.4 GHz link). Full-rate channels (W8,
deferred): +272 kbit/s per channel, 8 ch ⇒ ≈2.9 Mbit/s total, which is why W8
is chained to the demand-driven subscription.

---

## 5. D5 — should a channel's view show its VIEW SELECTION? (operator veto point)

Today the per-channel vis buffer is **unmasked**: a channel view-selected to
`te_sign` still broadcasts its pattern across the whole model
(`pattern_mixer.js:3383-3395` — no `applyPreviewMaskBlackout`, unlike the
deck channel at :3431-3433 and Live Touch at :3402-3404, which both black out
unselected pixels per docs/27 §4.2 "show me what THIS channel covers").

On a 1D strip that gap was invisible. On a top-down ship view it is the whole
point: "where does this layer land" is the question the view answers, and an
unmasked buffer answers it wrongly for every view-selected channel.

**Recommendation: mask it** — 3 lines in the mixer vis pre-pass (`if
(channel.compiledPixelMask) applyPreviewMaskBlackout(this.channelBuffer, …)`
before `_extractVisInto`), matching the deck/Live-Touch precedent and docs/27.
**Flagged for operator veto because it visibly changes an existing surface**:
the thin per-channel strips will show dark segments for masked-out pixels
(they currently show the full pattern). That is the truthful picture — the
2026-06-29 "TRUE pattern at full brightness" ruling was about *fader*
independence, which is untouched — but it is his ruling to make. If vetoed,
the band caption for a view-selected channel must say so instead:
`FULL PATTERN · MASKED TO <sel> AT MIX` (honesty either way, codex P0).

---

## 6. Implementation contract (for the Opus implementer)

Ordered W-items. Baseline discipline throughout: record suite baselines
first; your failing list must be empty; tsc + eslint clean on touched files;
no git ops; offline engine + isolated dirs + TEST-NET-1 for any live capture;
fresh dist on a scratch port (never :6967/:7167), served-bundle hash verified
(`_232`); the operator's Expo instance is his (memory: operator-manages-expo).

**W1 — shared plumbing (pure + tested).**
`CaptainPad/components/mixer/pixel_paint_scheduler.ts` (round-robin, 8 ms
budget, latest-wins, visibility gating — unit-test the queue semantics with a
fake clock) and `CaptainPad/hooks/use_pixel_view_artifact.ts` (module-cached
artifact + pixel-count fetch; the deck window migrates onto it).
*Accept:* scheduler tests prove budget cutoff, round-robin fairness,
latest-buffer-wins, and unsubscribe; artifact fetch count is 1 with N
consumers (test via injected fetch).

**W2 — the band.** `CaptainPad/components/mixer/pixel_view_band.tsx` +
`pixel_view_band_logic.ts` (pure: session store, caption strings, header
state). Reuses `pixel_view_logic` exports verbatim — zero forks of geometry,
colour, or caption code. Props: `visKey`, `height`, `open`, `showSourceChips`
(master), `dominant` (perf column mode).
*Accept:* React profiler (or render-count probe) shows zero band re-renders
across 50 vis frames; canvas is `pointerEvents:none`; non-web renders the
named refusal caption; ratio caption matches `describeColourResolution`
arithmetic on both paths.

**W3 — mixer edit-mode integration.** Band under the thin strip per §2.2 (skip
when `collapsed`), master band in the MASTER OUTPUT block, view-picker modal
(existing modal pattern), collapse/session store wiring.
*Accept:* screenshot matrix rows 1-5 (§7); fader drag over a canvas moves
nothing but the ScrollView; strip row still centers ≤3 / scrolls >3.

**W4 — performance-mode derived layout.** §2.3 exactly: raw
`usePerformanceMode().active`, params column hidden, band dominant in the
column slot, single canvas per channel, master forced open at 160 px, static
caption, zero persistence writes.
*Accept:* enter/exit perf round-trip leaves collapse+view session state
byte-identical (assert on the store); perf mode with the engine's structural
locks shows faders/mute/solo/playlist still live; screenshot rows 6-8.

**W5 — D5 masking (pending operator answer).** Either the 3-line engine
masking (plus an engine test: view-selected channel's vis buffer is black
outside its mask) or the `FULL PATTERN · MASKED TO … AT MIX` caption. Not
optional to skip both.

**W6 — verification pass.** Full CaptainPad + engine suites vs baseline,
screenshot matrix complete and visually inspected, live-reload note in the
report (CaptainPad web build; engine restart only if W5-mask or W7 taken).

**W7 (optional, config-only, operator's call).** `vis.maxPixels: 100 → 240` +
a comment carrying §1.2's arithmetic. Engine restart required.

**W8 (deferred — do NOT build now).** Class budget `vis.channelMaxPixels`
(validated like `maxPixels`, applies to every per-channel key) **together
with** demand-driven `/ws/viz` subscriptions (`_239` open item). Spec'd in
§1.2; take only on an explicit operator order.

### 7. Screenshot matrix (all off a fresh dist, offline engine, lit pattern)

| # | shot |
|---|---|
| 1 | Edit mode, 2 channels landscape — bands open, top-down lit, master band open |
| 2 | Channel band showing FRONT (proves multi-panel fit in band aspect) |
| 3 | View picker modal open (rows + honesty footer) |
| 4 | One band collapsed, sibling open (chevron state) |
| 5 | 8 channels — scrolled row; console/profiler evidence of scheduler duty |
| 6 | Performance mode, same 2 channels — params gone, dominant views, caption |
| 7 | Perf master band at 160 px, SHOW/RIG chips |
| 8 | Perf exit — pixel-identical to shot 1 (the round-trip proof) |
| 9 | Portrait narrow column, band at 320 px width |
| 10 | (if W5-mask) view-selected channel: band dark outside its selection |

---

## 8. Open for the operator

1. **D5** (§5): mask channel previews to their view selection (recommended),
   or keep unmasked + the explicit caption?
2. **W7**: spend +44 kbit/s per channel to sharpen channel colour 100 → 240
   samples? (Design is correct without it.)
3. Should view choice / collapse survive an app reload (AsyncStorage), or is
   session memory right? (Spec'd session-only.)
4. Perf mode keeps the playlist column (this doc's reading of "with
   patterns"). If he wants playlist hidden too — viz full-card — that is one
   more derived flag in W4, say the word.
