# Touch Control panel: from non-functional to a performable surface, + the Audio Companion

**Branch** `feat/bm_readiness` · **Session window** 2026-08-09 13:55 → 2026-08-10
**Surfaces** `docs/ui/touch_control.html`, `docs/ui/touch_control_wire.js`,
`marsin_engine/effects/spatial_paint.js`, `marsin_engine/effects/movement_trace.js`,
`marsin_engine/lib/global_effects_controller.js`, `marsin_engine/lib/api_server.js`,
`marsin_engine/audio/companion/` (launched, not modified)

---

## 1. What this session was

The operator drove this end to end, one instruction at a time, mostly in the
form "X does not work" or "X is a bad choice, make it Y". The through-line: the
**SPATIAL / XY pad** — a per-pixel paint surface for the ship — went from a
control that did nothing at all to one the operator can perform with. The last
stretch turned on the **Audio Companion**, which immediately exposed a serious
defect in the panel that nobody could have found without live audio.

This report is the honest record, including the things I got wrong and the
claims I had to retract. Several of the "fixes" below are fixes to my own
earlier work in the same session.

---

## 2. The headline: SPATIAL paint works, on every pattern

### The problem, and the three separate causes

"Spatial mode still does not work" was said four times across the session,
because it had **three independent causes stacked on top of each other**. Each
one alone was enough to make the feature look dead, so fixing one changed
nothing visible and looked like a failed fix.

1. **The pad drove the wrong thing.** Position was written into
   `68_spatial_paint`'s own pattern sliders, so the feature only existed while
   that one pattern was loaded. Moved to a **global effect stage**
   (`applySpatialStage`) that runs after group paint, so it now works on any
   pattern. Measured: peak red on the rig went **0 → 8,497** with paint on.
2. **The sim was not showing engine output.** `lightingMode` defaults to
   `gradient`, which ignores sACN entirely. Every "the sim shows nothing"
   observation before this discovery was invalid — including several of mine.
3. **Violet on violet.** The stroke was painting the operator's colour onto a
   pattern already showing that colour, so it was genuinely invisible. This is
   the one that produced my worst claim of the session (see §7).

### Ordering matters

The stage had to land **after** `applyGroupFixedColors(..., 'post')` and before
the grand master, or group paint would overwrite the stroke. It is deliberately
an arrow-function property on the controller rather than a chain stage, so
`engine.js` can invoke it at exactly that point.

### The brush

- **Hard-edged, round, per-axis normalised.** It started as an oval because the
  ship's normalised space is not square; `rx`/`ry` are now separate.
- **Segment sweep** from the previous sample to the current one, so one touch
  paints a continuous path instead of dots at the sample rate.
- **Per-pixel colour memory** (`ink` Float32Array), which is what makes
  "painting IS how you change colour" possible — four hue families can coexist
  on the rig at once, verified.

### The four DRAW modes, after operator rulings

| Mode | What it does | Operator ruling that shaped it |
|---|---|---|
| TRAIL | Lights follow your colour and fall back off in step with the on-pad fade | "trail needs to turn the lights off or on matching the fade of the trail" |
| POOL | A pool in the **opposite** colour under the finger | "POOL is a bad choice, make it an opposite colour choice" |
| ERASE | Wipes to **true black**, 0% floor | First "2% at its floor", then overruled: "erase should turn the light off 100% so you can do fun washes and swipes" |
| IGNITE | The whole ship lifts with the stroke in **contrasting** colours | "ignite is bad too, change that to contrasting colours" |

ERASE reaching real black is pinned by four tests (LOCAL / TRANSIENT / OWNED
phases). TRAIL was made the **default instead of POOL** — shipping POOL lit meant
the dot was always the opposite of the colour the operator had picked, which is
what produced "for some reason the dot is always a contrasting colour".

### INK schemes

MASTER / HUE / COMP / CLASH / ONE, matching the COLOUR panel's schemes but
applied to the stroke, with a STEP control for how far the finger travels before
the ink advances. Colour parity between the on-screen dot and the ship was
verified **exact, 25/25 samples, in every scheme**.

---

## 3. The chart: making the pad tell the truth

The ship's hull lies at **44.3°** in the sim's nx/nz plane and is **2.9× longer
than wide**, so a raw pad fraction aimed the light at the wrong part of the
vessel. The page now owns a de-rotation about the hull centroid plus a per-axis
scale, exposed as `worldToPad` / `padPxToWorld`.

- Round-trip pad → world → pad is **exact to 0px**.
- Chart fill went from **59% to 97%** of the pad height.
- Pad X is **mirrored** so starboard reads on the left, matching what the
  operator sees in the sim — their call, confirmed by eye.
- Fixtures went from 964 overlapping dots to **150 distinct, ringed,
  high-contrast markers**, twice at the operator's request ("spread them out
  more").
- Axis labels follow the mode: STARBOARD/PORT in SPATIAL, DIM/BRIGHT in XY.

---

## 4. XY mode became a real performance mode

Y used to drive the pattern's *rotate* — a look-tweak, not something you reach
for mid-song. Now:

- **X → grand master.**
- **Y → strobe rate _or_ group walk**, operator-selectable, both on exponential
  sweeps (a linear sweep buries everything usable in the last few pixels).

Two new engine endpoints back this:

| Endpoint | Range | Proof |
|---|---|---|
| `POST /strobe-rate` | 0.2–25 Hz, duty 0.02–0.98 | 100% gate swing measured |
| `POST /movement-rate` | 0.05–120 px/s, 4 modes | 24,437 colour delta at the controller; 9,110 → 11,403 live |

The walk took **three failed measurement attempts** before I found one that
actually detects it — centre-of-brightness and lit/unlit counts both stayed flat
because the walk moves colour, not brightness. A fourth attempt failed because I
posted `/movement-rate` without colours, leaving one default colour and nothing
to walk between.

### The never-black floor on X

Operator, late in the session: *"XY mode cannot go dark on full left, the floor
must be at 5%, never dark on that panel."*

X drove the master straight from the pad fraction, so the far-left edge sent
`master: 0` — a dark ship, one careless drag away, on the panel with no undo.
Now **rescaled into [0.05, 1]** rather than clamped: a clamp makes the bottom 5%
of travel dead and identical, rescaling keeps the whole sweep live and puts
exactly the floor at the edge.

Measured: `x=0 → 0.0500`, `0.25 → 0.2875`, `0.5 → 0.5250`, `1 → 1.0000`,
strictly increasing, no dead zone. The axis label said **DARK**, which had become
a lie, and the readout still printed the raw pad fraction — showing 20% while
sending 24%. Both fixed. This extends the existing NEVER-BLACK invariant
(`ARM_FADE_FLOOR`) to a second surface.

---

## 5. TAKE: record, play, loop a gesture

Drawing was the most expressive thing on the panel and it lasted exactly as long
as a finger stayed down. Takes capture the stroke **with its timing**, replay it
at the speed it was performed, loop it, and — at the operator's request —
**survive a real preset save and recall**, which is verified against the actual
preset store rather than a mock.

---

## 6. The UI rebuild

Three operator instructions, in order, each correcting the last:

1. *"All the controls in the top 1/3, the bottom 2/3 the panel as a rectangle."*
2. *"Can't just make the panel bigger — you need to consolidate the panel smaller."*
3. *"Draw, ink, y axis, take can all share two rows like the other options."*

My first attempt bought the pad its share by growing the panel 584 → 735px,
which just steals space from the other panels. Reverted. What actually worked
was consolidating: **faders became stepped chip buttons** (SIZE, POWER, FADE,
STEP, ON TIME, SPEED), with the sliders kept hidden in the DOM as the value
carrier the wire and presets already read — a chip writes the same
`dataset.value` and fires the same `sliderchange` a drag does, so a cosmetic
change cannot break the engine path.

Then DRAW and INK moved out of the control block entirely into **vertical
columns flanking the pad**, stretched to its full height as large finger
targets. Result: **controls 25% / pad 73%**, pad 567 × 389.

**The Z fader was not removed**, despite "if the z fader is not doing anything
remove it" — it *is* doing something, driving global pattern speed via
`/param-center`. It became the SPEED chip row instead. Deviation from the
instruction, disclosed at the time.

**DUTY was renamed ON TIME** — operator: the name is confusing. Duty cycle is
desk jargon for a plain idea: what share of each flash the lights are on. The
element id stays `strobeDuty` and the engine field stays `duty`, because the
wire, presets and `/strobe-rate` all speak that key; the label is what a human
reads, the key is what the machine reads, and they need not match.

### Layout mistakes made and caught

| Mistake | How it was caught |
|---|---|
| `display: contents` on rows scattered every label into its own grid cell | Screenshot |
| My row-splitting script left a stray `</div>` after each of three rows, closing the control block early | Counting div balance |
| Rows carrying a button group *and* a value control folded onto a second line (CLASH sat on the STEP chips) | Screenshot |
| Buttons spilled cells by up to 120px — flex items default to `min-width: auto` | DOM measurement; I nearly wrote it off as a screenshot crop |
| The same trap on the **cross** axis: `.mode-toggle button` has `min-width: 76px`, which in a column layout forced every button 20px wider than its 56px column | DOM measurement |

---

## 7. Corrections and retractions

Recorded plainly because the record is only useful if it is accurate.

- **"End-to-end PASS: peak red 90 → 181."** Retracted publicly during the
  session. That number was exactly the arithmetic of violet-on-violet
  invisibility — it proved nothing.
- **A broken sACN instrument** summed whichever universe arrived last of 38, and
  had been feeding me wrong numbers for hours. Retracted.
- **`--view top` is not a valid camera preset.** `clickView` only checks that
  `window.animateCamera` exists, so every render that session silently used the
  default camera.
- **Headless timer starvation** produced a false "the pad sends no positions"
  finding.
- **Invented API surface, twice**: `frameCounter()` and `WORLD_PTS`, both caught
  by grep because each appeared exactly once — in my own line.
- **`console.log('%-6s', …)`** — Node does not support printf padding; it
  shifted every argument and printed `rgb(NaN,…)`. Made the same mistake twice.
- **"Engine master unchanged"** was printed as a hard-coded string while the
  value had actually moved 0.4537 → 0.1077. False claim, retracted.
- **A stale scratch assertion** still expected the 2% erase floor after the
  operator had ruled 0%, and reported FAIL against correct code.
- **Ran `node --test` once without the config guard**, mutating tracked
  `config.yaml`.

---

## 8. The Audio Companion, and what it exposed

### Launched

`node audio/companion/companion_server.js` from `marsin_engine/` → **:6966**.
Verified live rather than merely listening:

- Mode **`mic`** on a real device (HuddleCamHD, 7 available), not the synthetic
  test source.
- Engine tuning link **up** on `ws://127.0.0.1:6968/ws/control`.
- OSC → engine CPC **moving**: `micLow` .564 → .402, `micDomFreq1` 63 → 52 Hz,
  loudness tracking. BPM 115–118, note F#.
- UI renders, 11 canvases painted, no page errors.
- **`bpmSpeedSync` is on and autopilot is off**, so detected tempo is already
  driving pattern speed.

I reported ffmpeg as missing — **wrong**. `ffmpeg -version` fails because the
repo vendors `ffmpeg-static` in `node_modules`, which is exactly how the offline
/ playa requirement is met. Corrected before drawing any conclusion from it.

### The defect it exposed: the panel froze its own main thread

With audio live, measured on the panel page:

| Metric | Before | After fix |
|---|---|---|
| `setInterval(16ms)` throughput | **1 tick/s** | 13 ticks/s |
| requestAnimationFrame | 8 fps | 17 fps |
| Worst gap between two 4ms timers | **4,365 ms** | 117 ms |
| CPU in one loop | 89% | (see caveat below) |

`about:blank` in the same browser ticked 63/s, so it was the page, not the
environment.

**Cause.** `paintMeter` ran in full on **every** `/ws/signals` message —
measured at **35 msg/s** — redrawing nine canvases as 360-point polylines each
time. With no audio running the socket barely pushes, which is exactly why this
had never surfaced.

**Fix.** Coalesce the **canvas** work to one animation frame on the latest
values, while keeping the cheap semantic work — liveness, BPM, note and beat
`CustomEvent`s — on **every** message. That split is deliberate: those events
drive the palette and beat-synced behaviour, so dropping them would drop musical
events, not pixels.

**Causal chain closed at both ends.** `take_test` had started failing (3
playback events instead of ~15) purely because timer-driven playback was being
starved. After the fix it passes **with the Companion still running**: 15–18
events, 4/4 standalone runs.

---

## 9. New engine surface added this session

| Thing | Where |
|---|---|
| `applySpatialStage` global effect stage | `lib/global_effects_controller.js` |
| `spatial_paint` effect (heat, ink, prev-position buffers) | `effects/spatial_paint.js` |
| `movement_trace` effect | `effects/movement_trace.js` |
| `POST/GET /strobe-rate` | `lib/api_server.js` |
| `POST/GET /movement-rate` | `lib/api_server.js` |
| `setSpatialPaint` — validates and **throws**, never clamps (codex P0) | `lib/global_effects_controller.js` |
| Autopilot runtime split out of tracked `config.yaml` | `lib/color_autopilot.js` |
| Tests: `motion_transition`, `touch_paint_lease`, `spatial_paint_order` | `tests/effects/` |

---

## 10. Verification status

**Proven this session, with captured output:** spatial stage ordering; ERASE to
true black (4 tests); colour-by-painting with per-pixel memory; pad/world
exactness (0px); the side-to-side mirror; fixture legibility and spread; colour
parity pad↔ship (25/25 exact); `/strobe-rate` (100% gate swing);
`/movement-rate` (live delta); takes recording, playing, looping and surviving a
real preset save+recall; the disarm handback under deliberate sabotage; the UI
split and zero button overflow measured in the DOM; the XY 5% floor at four
points across the sweep; the readout matching what is sent; the meter freeze
before/after.

**Regression sweep green:** `xy_floor2`, `xy_readout`, `xy_controls`,
`chip_drive`, `side_func`, `take_preset_real`, `colour_match`.

**NOT verified — stated plainly:**

- **Nothing was exercised through the operator's own panel.** It holds the arm
  lease. Everything ran in a headless copy of the same page against the live
  engine. The XY floor test armed a *local* copy only after stubbing `fetch`,
  with zero writes escaping to the engine (asserted, 0).
- **The remaining meter CPU is unexplained.** The profiler still attributes ~80%
  of samples to the meter loop even though an out-of-band benchmark says a full
  nine-canvas pass costs under 1ms. Those two numbers disagree and I did not
  reconcile them. The page is no longer *blocked*, but it is still heavy.
  Headless software rendering may be inflating it — unverified.
- **`take_test` can still fail inside a long back-to-back sweep.** That is my own
  assertion being marginal under load (a 3s loop window compared against a 2.5s
  play window), not the panel.
- **"TRAIL doesn't fade" in POOL/TRAIL with COMP/CLASH** was reported by the
  operator and I could not reproduce it. Still open.
- **Touch ergonomics** of the tall stacked DRAW/INK buttons is an eyeball call
  only the operator can make.

---

## 11. Open items

| # | Item |
|---|---|
| 9 | Eyeball the tempo-lock and arm fade on the ship (operator's eyes) |
| 10 | Ask Sina whether `deploy/boot_server.ps1` runs on the show server |
| 21 | `revertToAutomaticShow` selects the MIXER view after loading the playlist on the DECK |
| 24 | Warn when a sim window is not showing engine output (`lightingMode !== 'sacn_in'`) — this cost hours today |
| — | Complete the colour-wheel guard: `applyStatic` is still reachable from arm, FX taps and `groupmodeschange` |
| — | Reconcile the residual meter CPU attribution |
| — | Reproduce or close "TRAIL doesn't fade with COMP/CLASH" |
| — | Offered, not built: playback speed control for takes; IGNITE using the operator's colour rather than the contrasting one |

## 12. Housekeeping

Removed a stray empty `.panel` file from the repo root — 0 bytes, untracked,
created accidentally by a shell redirect during the layout work. Scratch belongs
in `~/tmp/` (codex P0).

The engine writes runtime state into tracked `marsin_engine/states/` files while
running; that residue is expected and is reported, not committed or silently
reverted.
