---
description: The step-by-step procedure for authoring a production MarsinScript pattern for the Titanic — from the artistic idea, to an honest control set, to view-based targeting, timing, colour and portability, to the offline verification gates and the phone gallery. Read this before writing or reworking anything in marsin_engine/patterns/.
---

# 🎛️ Pattern Generation — the authoring pipeline

This is the **procedure**. The **contracts** live in
[`docs/MARSIN_ENGINE_PATTERNS.md`](../../docs/MARSIN_ENGINE_PATTERNS.md) —
read it first, and do not let this skill contradict it. If the two ever
disagree, the guide wins and this file is the bug.

| Read | For |
|---|---|
| [`docs/MARSIN_ENGINE_PATTERNS.md`](../../docs/MARSIN_ENGINE_PATTERNS.md) | §0 hard contracts, §1 parameter philosophy, §3 timing, §6 colour/output, §7 metadata + views, §8 audio, §9 palette, §11 portability |
| [`docs/MARSIN_PB_LANG_SPEC.md`](../../docs/MARSIN_PB_LANG_SPEC.md) | grammar, builtins, reserved names (§2.4), clock semantics (§9.3) |
| [`docs/COLOR_THEORY.md`](../../docs/COLOR_THEORY.md) | the five instruments, what each can emit, palette composition on the physical ship |
| [`.agent/skills/pattern_gallery.md`](pattern_gallery.md) · [`.agent/skills/visualize_patterns_widget.md`](visualize_patterns_widget.md) | phone review, widget anatomy |

Everything in the verification loop is **offline** — no engine boot, no ports,
no mic. You drive the vendored WASM VM (and, for audio, a deterministic synth
through the real engine DSP) in-process.

**Use the guide's three tiers when you read anything below.** *HARD CONTRACT*
= the engine/compiler/ABI/CI enforces it. *PRODUCTION CONVENTION* = an operator
decision about how this show is authored. *OPTIONAL CAPABILITY* = a technique
you may reach for. Never describe a preference as a runtime rule.

---

## 0. What this skill no longer tells you to do

An earlier revision of this file mandated a fixed control "anatomy" —
`direction` + autonomous reversal + a movement `radius` + a brightness `kick`
on **every** pattern — plus true black, two colours spanning the rig,
`peakMaxChan >= 200`, and constant beat behaviour. It also taught fixture
targeting as bench-numbered `sectionId == 1|2|3` — which is wrong on the ship.

Both are **overruled**:

- The parameter truth sweep measured **170 DEAD, 39 WRONG and 25 WEAK controls
  out of 817**, and the largest clusters were exactly the generically-mandated
  ones
  ([`_32`](../reports/202607/20260725_32_pattern_param_truth_sweep.md)). The
  replacement policy is `MARSIN_ENGINE_PATTERNS.md` §1, written by
  [`_133`](../reports/202607/20260725_133_docs_contract_truth.md) and
  re-verified by [`_135`](../reports/202607/20260725_135_wave_verification.md).
- `sectionId` is **model-specific and is not a portable taxonomy**. `1/2/3` is
  a `test_bench` accident; the ship uses values like `514`/`515`. A pattern
  gated on the bench numbering executes none of that branch on the Titanic —
  that is where a large share of the dead knobs came from. The replacement is
  `inView("Authored View Name")` (`MARSIN_ENGINE_PATTERNS.md` §7.2–7.3.1,
  view set landed by
  [`_134`](../reports/202607/20260725_134_titanic_semantic_views.md) /
  [`_137`](../reports/202607/20260725_137_view_allocator_word_policy.md)).

**"High-definition" is a craft bar, not a look.** It means: every control does
what its name says, the motion never visibly re-locks, the geometry reads at
distance on the instrument you put it on, and nothing about the file lies. It
does **not** mandate true black, a constant beat, or party brightness — the
show is ambient-dominant most of the night, and a quiet wash is allowed to be
soft, dim and slow (`MARSIN_ENGINE_PATTERNS.md` §1.6).

---

## 1. Step 1 — write the idea down before you write code

In the file header, in prose, state:

1. **The concept in one line.** What is the viewer looking at?
2. **Which instrument(s) carry it** — Hull Canvas, Silhouette, Jewelry, Organs,
   Identity (§3 below). "The whole ship" is a legitimate answer; "I did not
   think about it" is not.
3. **The core motion math**, including the incommensurate ratios that keep it
   from looping (√2 ≈ 1.41421, √3 ≈ 1.73205, φ ≈ 1.61803, golden angle ≈
   2.39996, distinct primes). No plain integer periods.
4. **The handles the look actually has** — the shortlist you will turn into
   controls in Step 2, and which of them (if any) a modulation should drive.
5. **Where it sits in the show** — ambient bed, or a moment. Its defaults must
   land there with nothing mapped.

Reworking an existing pattern? **Keep its identity** — concept, palette feel,
name — and modernise it to the current contracts. Do not rewrite it into
something else.

---

## 2. Step 2 — choose the controls (this is where patterns go wrong)

The governing rule is `MARSIN_ENGINE_PATTERNS.md` §1.1: **every control a
pattern declares must be truthful, perceptible, independently useful, and
meaningfully effective across its whole range.** A control's name is a promise.
If you cannot keep the promise, delete the control.

### 2.1 `localSpeed` — always, and always first

```javascript
export var localSpeed = 0.5;
export function sliderLocalSpeed(v) { localSpeed = v; }
```

Truthful means motion visibly accelerates and decelerates across the range.
Declaring it and not scaling a rate by it is a bug, not a stylistic choice.

### 2.2 `direction` — only when the concept has one, and then second

Direction exists **only when the visual concept has real directional motion**.
A breath, a symmetric bloom, an omni-directional shimmer has no direction —
giving it one manufactures a dead knob. When it exists it is the **second**
local control (memory fact `pattern-param-order` applies *when direction
exists*), its endpoints must visibly produce opposite motion, and it must not
freeze at slider centre:

```javascript
export var heading = 0.5;
export function sliderDirection(v) {
  var d = (v * 2.0) - 1.0;
  if (d >= 0.0 && d < 0.06) d = 0.06;          // never exactly 0 at centre
  else if (d < 0.0 && d > -0.06) d = -0.06;
  heading = d;
}
```

Autonomous direction reversal is an **OPTIONAL CAPABILITY**, not a requirement.
Layering an auto-flip over a manual `direction` is precisely what made
`01_cylon_sweep`'s direction unobservable. If you use auto-reversal, either do
not also expose `direction`, or keep the manual control dominant enough that
its endpoints still measurably reverse travel.

### 2.3 Everything else earns its place

There is **no** required `radius`, `kick`, `brightness`, `width` or `trail`.
Ask what *this* look has handles for, expose those, name them for what they do,
and stop.

- **Never invent a control to fill a MIDI knob.** An empty knob is fine; a
  lying knob is not. A pattern with three honest controls uses three knobs.
- Handles worth exposing *when the look has them*: position, width/size,
  energy, persistence, palette position, count
  (`MARSIN_ENGINE_PATTERNS.md` §12.4).
- **Identity-slider shape** — store the raw `0..1` value, scale at the use
  site. That keeps the declared default meaningful and lets the offline truth
  harness sweep it:

```javascript
export var shimmer = 0.35;
export function sliderShimmer(v) { shimmer = v; }
```

- A control meant to be driven by a **transient** may legitimately be
  edge-triggered and do nothing while *held*. Say so in the header — the truth
  harness has a pulse probe for exactly that case.

### 2.4 Ordering and the knob surface

**HARD CONTRACT:** globals are declared before locals, and **declaration order
of the `slider*` functions is the physical MIDI knob order**
([`docs/34_captainpad_midi.md`](../../docs/34_captainpad_midi.md)). Never
reorder, rename or delete an existing slider export on a rework — that moves
the operator's hands. Append if you must add one, and say so.

Practical limits (memory facts `mft-bank-usage`, `pattern-param-order`): bank 1
row 0 is the engine globals (speed + sync, hue), leaving **12 knobs** for local
sliders. **A pattern never declares a hue parameter** — hue is applied per
channel by the engine.

---

## 3. Step 3 — targeting: name the part of the ship

**Use `inView("Authored View Name")`.** It is a compile-time intrinsic
(`marsin_engine/lib/in_view_intrinsic.js`): it resolves the authored name to
the exact membership test, picks the right view word for you, and an **unknown
name is a hard compile error** listing the model's known views. It never folds
to a silent constant-false test, and you never write bit arithmetic.

```javascript
export function render3D(index, x, y, z) {
  if (inView("Stacks")) { rgb(1.0, 0.55, 0.10); }   // funnels stay gold
  else { rgb(0.0, 0.35, 0.45); }
}
```

**Do not build a coordinate or metadata fallback around it** — that is a codex
P0 violation and it lets a broken model render *something* instead of failing
where you can see it.

### 3.1 The five instruments partition the ship

Verified by [`_135`](../reports/202607/20260725_135_wave_verification.md): the
five instrument views are **mutually exclusive and exhaustive** — they cover all
24 base groups with zero overlap and sum to exactly **964 pixels**. That is what
makes a per-instrument `if / else if` chain *provably* complete: nothing unlit,
nothing double-assigned.

| Instrument view | Px | Hardware | Emitters |
|---|---:|---|---|
| `Hull Canvas` | 360 | 20 × 18-px LED bar, four wall groups | RGB + W + Amber + UV |
| `Silhouette` | 320 | 8 rope/strand runs of 40 | RGBW |
| `Jewelry` | 96 | 16 × Vintage 6-head rail | RGBW |
| `Organs` | 40 | 40 single-pixel pars (stacks + auditoriums) | RGB + W + Amber + UV |
| `Identity` | 148 | 2 × 74-px TE sign | RGBW |

Halves and subdivisions, all real view names: `Left Hull` · `Right Hull` ·
`Left Silhouette` · `Right Silhouette` · `Left Jewelry` · `Right Jewelry` ·
`Left Organs` · `Right Organs` · `Stacks` (24, the funnels only) ·
`Left Stacks` · `Right Stacks` · `Auditoriums` (16).

`Organs` = `Stacks` + `Auditoriums`. Reach for `Stacks` when you mean the
funnels; `Organs` when you mean every par.

The **24 finer base groups**, exact spelling:

`Right Front Wall` · `Left Front Wall` · `Right Back Wall` · `Left Back Wall` ·
`Right Front Rails` · `Left Front Rails` · `Right Back Rails` ·
`Left Back Rails` · `Right Auditorium` · `Left Auditorium` ·
`Left SmokeStack` · `Right SmokeStacks` · `Left Small SmokeStack` ·
`Right Small SmokeStack` · `Left_Front_Left` · `Left_Back_Left` ·
`Left_Back_Right` · `Left_Front_Right` · `Right_Back_Left` ·
`Right_Back_Right` · `Right_Front_Right` · `Right_Front_Left` · `TE Sign` ·
`TE Sign 2`

**Copy the names, do not retype them from memory.** `inView()` matches
literally and the spelling is irregular: **`Right SmokeStacks` is plural** while
`Left SmokeStack` is singular; the rope strand groups use **underscores**
(`Left_Front_Left`); the signs are `TE Sign` / `TE Sign 2`; `Left Auditorium` /
`Right Auditorium` are singular *base groups* while the composite is
`Auditoriums`. Source of truth for all 41 names:
`MARSIN_ENGINE_PATTERNS.md` §7.3.1 →
[`simulation/scenes/titanic/views.yaml`](../../simulation/scenes/titanic/views.yaml).

Names that do **not** exist (each a hard compile error, not an empty
selection): `All Bars`, `All Ropes`, `All Vintage Lights`, `All TE Signs`,
`Left Identity`, `Right Identity`.

### 3.2 Never hard-code a view's bit or word

A composite's `(word, bit)` is an allocator decision that changes when the
scene is re-saved — `Hull Canvas` has already moved once. `inView()`
recompiles correctly; a hand-written mask silently tests the wrong pixels.

### 3.3 `fixtureType` when the distinction is capability, not place

```javascript
export function render3D(index, x, y, z) {
  if (fixtureType == FIX_PAR) { rgb(1.0, 0.6, 0.2); }  // one big wash source
  else { rgb(0.1, 0.1, 0.3); }
}
```

`FIX_RAW_LED` (1) · `FIX_PAR` (2) · `FIX_VINTAGE_6` (3) · `FIX_BAR_18` (4) ·
`FIX_HAZE` (5) · `FIX_FOG` (6), from
`marsin_engine/lib/fixture_type_constants.js`. A `FIX_*` the loaded model
cannot satisfy **fails the compile**. Choose: `inView("…")` for *where on the
ship*, `FIX_*` for *what kind of light this is*.

Raw `sectionId` / `fixtureId` are for a pattern that is explicitly and only for
one model — and the header must say so. Do not present them as portable.

---

## 4. Step 4 — timing

**HARD CONTRACT: the engine owns the global speed clock.** `t`, `time(scale)`
and `beforeRender`'s `delta` all arrive **already scaled** by the operator's
SPEED fader (`engine.js` accumulates `patternClockSeconds += wallDelta *
globalSpeedMultiplier()`). A pattern applies **only** its own `localSpeed`
trim. There is no `speed` variable to read — `speed` and `size` are
engine-owned and are never injected.

```javascript
export var localSpeed = 0.5;
export function sliderLocalSpeed(v) { localSpeed = v; }

var BASE_RATE = 0.08;          // still creeps at localSpeed = 0
var SPAN_RATE = 0.45;
var PHASE_WRAP = 10000.0;      // wrap far from any in-frame fractional use
var travel = 0.0;

export function beforeRender(delta) {
  var dt = delta / 1000.0;     // seconds; delta is ms and may be 0
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;      // tolerate a stalled frame
  var localMult = pow(2.0, (localSpeed - 0.5) * 4.0);   // 0→0.25× 0.5→1× 1→4×
  travel = travel + dt * (BASE_RATE + SPAN_RATE * localMult);
  if (travel >= PHASE_WRAP) travel = travel - PHASE_WRAP;
}
```

Delta behaviour, measured (`MARSIN_PB_LANG_SPEC.md` §9.3):

- `delta = (elapsed_now − elapsed_prev) × 1000` ms — a real step, and
  global-speed-scaled like everything else.
- **First-frames quirk:** the VM's previous-time slot starts at `0` and `0`
  doubles as the "no previous frame" sentinel, so a freshly loaded pattern sees
  **`16, 16, <real>, <real>, …`**. Never derive a frame rate from frame 1.
- A repeated `elapsed` yields `delta == 0`. Accumulators must tolerate a zero
  step.
- The house divisors are `delta / 1310.72` (a 1.31 s loop) and
  `delta / 65536.0` (65.5 s). `time(scale)` is the stateless alternative,
  period `65.536 × scale` s.
- **Wrap accumulating phases at a large multiple of their period, never at
  `1.0`.** Wrapping to `0..1` and then multiplying that phase by a non-integer
  factor jumps mid-cycle and flashes — that was the real `34_moire_interference`
  bug. Give each consumer its own accumulator.
- Never drive animation from a frame counter: during a transition your
  `beforeRender` may run invisibly in a background buffer.

---

## 5. Step 5 — colour and output

### 5.1 Palette: convert once, lerp in RGB

Copy the `_hsv2rgb1()` / `_hsv2rgb2()` helpers verbatim from
`MARSIN_ENGINE_PATTERNS.md` §9.2 (or from an existing pattern such as
`marsin_engine/patterns/27_swipe.js`), call both in `beforeRender`, and lerp
`pr1/pg1/pb1 → pr2/pg2/pb2` per pixel. **Never interpolate in HSV** — hue
interpolation walks around the wheel and emits colours the operator never
picked. Reserved single-letter names mean the helpers must use the `hv/iv/fv/
pv/qv/tv` locals; `r`/`g`/`b` are fine as locals inside `render3D` only.

Legitimate opt-outs: per-instrument palette *positions* (§5.3), additive W/UV
lifts on dedicated emitters, and single-endpoint/monochrome concepts — say so
in the header.

### 5.2 `w == a` whenever white is emitted (HARD CONTRACT)

The RGBWAU pars and bars carry **separate white and amber emitters**, and
neither is a usable white alone. W and A driven to the same value is the warm
white the whole show is tuned against.

```javascript
var outW = 0.0;
export function render3D(index, x, y, z) {
  outW = 0.4;
  rgbwau(0.2, 0.1, 0.0, outW, outW, 0.0);   // W == A: the ship's warm white
}
```

- Shape cooler/warmer whites **on the RGB lanes**, never by unbalancing W
  against A.
- **Amber is not a separate authoring accent lane** under this project's
  convention — build gold and fire on RGB. `u` (UV) is independent.
- Assign the amber lane *from* the white expression; never staple
  `a = clamp01(w)` on at the end, or you overwrite whatever a control was
  driving (that is why `13_sparkle / sliderAmberGlint` measures DEAD).
- Enforced over every `rgbwau()` pattern by
  `marsin_engine/tests/patterns/white_amber_lane_match.test.js` — no allowlist.
- `rgb()` / `hsv()` leave W/A/U at zero; the sACN mapper then synthesizes
  `W = min(R,G,B)` for DMX fixtures. **To control white you must emit it.**

### 5.3 Per-instrument capability — what actually exists where

| Path | Instruments | Behaviour |
|---|---|---|
| RGBWAU DMX | `Hull Canvas` (bars), `Organs` (pars) | W, A and U reach real emitters |
| RGBW wire | `Silhouette`, `Identity` (and the Jewelry rail pixels) | **amber folded into RGB**, **UV dropped**, whole RGBW quad jointly pre-scaled so nothing clips |

So a look carried by UV **does not exist** on the Silhouette or the signs. If
UV or amber is carrying the idea, put it on the bars and pars and give the RGBW
instruments something else.

### 5.4 The colour-theory checklist (guidance, not engine rules)

From [`docs/COLOR_THEORY.md`](../../docs/COLOR_THEORY.md) — run a look past
this before you call it done:

1. **Wash the wood warm; put saturation in the pixels.** The exterior is
   stained wood: warm light is amplified, pure blue wash is eaten and reads
   muddy and patchy. Saturated blues/purples belong on the direct-view
   instruments (`Silhouette`, `Jewelry`, `Identity`) where nothing distorts
   them. Want cool on wood? Teal/cyan, not pure blue. Deep red is the one
   non-warm hue that survives the yellow stain.
2. **Stacks stay warm** — gold/amber funnels are the highest-visibility
   combination the ship has, and keeping them warm inside a cool look reads as
   intentional. `inView("Stacks")` makes it one line. **Operator ruling: this
   is artistic guidance, not an enforced rule** — and note `Organs` drags the
   auditoriums along, so target `Stacks` when you mean the funnels.
3. **One palette does not mean one colour.** Same two endpoints, different
   palette *position*, luminance, saturation and motion per instrument. Pick
   `blend` from `inView(...)` / `fixtureType` instead of from a continuous
   gradient:

```javascript
var pr1 = 1.0, pg1 = 0.4, pb1 = 0.0;
var pr2 = 0.0, pg2 = 0.5, pb2 = 0.9;
var sweep = 0.5, hit = 0.8, signLevel = 0.7;

export function render3D(index, x, y, z) {
  var blend = 0.5;
  var v = 1.0;
  if      (inView("Hull Canvas")) { blend = sweep; v = 0.6; }
  else if (inView("Silhouette"))  { blend = 0.0;   v = 1.0; }
  else if (inView("Jewelry"))     { blend = 1.0;   v = 0.25; }
  else if (inView("Organs"))      { blend = 1.0;   v = hit; }
  else if (inView("Identity"))    { blend = 1.0;   v = signLevel; }
  rgb((pr1 + (pr2 - pr1) * blend) * v,
      (pg1 + (pg2 - pg1) * blend) * v,
      (pb1 + (pb2 - pb1) * blend) * v);
}
```

4. **Dark paint is free negative space.** Don't spend wash intensity on it.
5. **Identity punctuates, it does not compete.** A sign that always animates is
   a sign nobody reads.
6. **Keep the Silhouette lit** if the pattern is an exterior show piece — that
   outline is what makes the ship recognisable at distance. This is a
   *judgement*, not a floor the engine checks.

---

## 6. Step 6 — portability

- **`pixelCount` compiles to the literal `144`.** Never size a buffer or an
  index with it.
- **Do not hard-code a bench pixel count either.** `test_bench` is 52 px, the
  Titanic is 964. Prefer formulations that need no model-sized array at all:

| Instead of | Use |
|---|---|
| per-pixel history buffer | a **scalar decay envelope** gated by position |
| per-pixel comet tail | a moving head + `smoothstep(head + len, head, x)` — spatial, resolution-independent |
| ghosting an arbitrary pattern | the **`feedbackTrails` global effect** (`marsin_engine/effects/feedbackTrails.js`) — whole-frame feedback, no pattern code |

```javascript
export var localSpeed = 0.5;
export function sliderLocalSpeed(v) { localSpeed = v; }
export var fade = 0.5;
export function sliderFade(v) { fade = v; }

var clock = 0.0, env = 0.0, lastPhase = 0.0;

export function beforeRender(delta) {
  var localMult = pow(2.0, (localSpeed - 0.5) * 4.0);   // localSpeed ONLY
  var dt = (delta / 1310.72) * localMult;
  clock = clock + dt * 0.5;
  var phase = clock % 1.0;
  if (phase < lastPhase) env = 1.0;                     // fire on each wrap
  lastPhase = phase;
  env = env - dt * (1.5 + fade * 4.0);
  if (env < 0.0) env = 0.0;
}

export function render3D(index, x, y, z) {
  var head = clock % 1.0;
  hsv(0.08, 1.0, env * smoothstep(head + 0.1, head, x));   // no array, portable
}
```

- If the effect genuinely needs independent per-pixel memory, allocate in
  top-level init only, and **label the array model-specific** in a comment
  naming the model and its pixel count.
- State is per-VM-instance and **resets on (re)compile** — a load, a live edit,
  a deck swap, a transition instantiating a fresh buffer. Never assume a trail
  survives a pattern change.
- Coordinates arrive **normalized `0..1`**. Do not re-normalize them; that has
  rendered whole patterns black.
- Keep the per-pixel path light: **5000 instructions per pixel**, and an
  overrun renders that pixel solid red. Do `O(N)` work in `beforeRender`.

---

## 7. Step 7 — audio, if the pattern has a handle for it

**HARD CONTRACT: patterns never read live audio.** There is no `micLow` to
declare — the engine refuses to bind the live audio family into pattern
globals. Audio reaches a pattern only as a **modulation onto an ordinary
`slider*`**, so the same file is a calm idle at rest and a tightly locked
instrument once mapped, with no code change.

Audio reactivity is **not required per pattern**. A pattern with no
modulation-worthy handle simply has none.

When it does, declare the mapping in the header as an **`AUDIO_MODULATION_V1`
block** — the parseable format the offline tooling auto-discovers
(`marsin_engine/tools/audio_mod_spec.mjs`). One mapping per line, strict:

```text
AUDIO_MODULATION_V1:
  sliderSwell   <- micLow  range 0.30..0.95 curve linear   # PRIMARY brightness
  sliderSparkle <- micHigh range 0.00..0.80 curve pow2     # fine detail
  sliderKick    <- micFlux range 0.00..0.90 curve linear   # build → bloom
Static (unmapped) params: localSpeed, uvGlow, base, colorPalette1/2.
```

- `slider<Name> <- mic<Sig> range <a>..<b> curve <linear|pow2|ease>  # note`.
- Signals for this block: `micLow` · `micMid` · `micHigh` · `micKick` ·
  `micFlux`. A line that looks like a mapping but is malformed is a **hard
  error** — never a silently dropped mapping.
- The deployed engine applies each as an OVERRIDE: `param = lerp(min, max,
  curve(signal))`. The block is what `tools/gallery/gen_variations.mjs` turns
  into the harness `--mod` string, so the offline sound clip matches the rig.
- Richer second-tier signals (structure, tempo grid, derived cues) exist and
  are listed in `MARSIN_ENGINE_PATTERNS.md` §8; drive them offline with
  `tools/pattern_derived_harness.mjs`.
- Give every mapped slider a **resting default that already looks good with
  nothing mapped**.

---

## 8. Step 8 — verify offline (the gates)

Run these from `marsin_engine/`. None of them opens a socket or binds a port,
so they are safe while the operator's stack holds 6966–6972 and 5568.

### 8.1 Parameter truth — the gate for the §2 policy

This is the tool that decides whether your controls are honest. It loads the
pattern into the engine's own WASM VM **with the full view table, `MASK_*` and
`FIX_*` injection**, sweeps every declared `slider*`, measures what actually
changed in the rendered light, and checks it against what the name claims.
Verdicts: `TRUE` · `DEAD` · `WRONG` · `WEAK` · `UNKNOWN_CLAIM`.

```bash
cd marsin_engine
node tools/param_truth/run_param_truth.mjs --pattern NN_name --model titanic \
  --out ~/tmp/param_truth_NN
node tools/param_truth/sweep_all.mjs                    # the whole library
```

- `--model` defaults to `titanic`. Add `--cross-model test_bench` to catch
  targeting that only works on one rig.
- **Always pass `--out` to a scratch path.** The default writes into the source
  tree at `marsin_engine/tools/param_truth/param_truth_results.{json,md}`,
  which is not gitignored — a targeted run would otherwise overwrite the
  library-wide sweep result.
- A `DEAD`/`WRONG` verdict on a control you declared is a bug in the pattern,
  not in the harness. Fix the control or delete it.

### 8.2 Audio harness + the gate

```bash
cd marsin_engine
node tools/pattern_audio_harness.mjs --pattern patterns/NN_name.js \
  --model titanic --synth full_track --frames 96 --gate \
  --mod micLow:sliderSwell:0.30:0.95:linear,micHigh:sliderSparkle:0.00:0.80:pow2 \
  --out ~/tmp/genkit/out/NN_name.json
```

**Pass `--gate` on every gate run** (operator instruction, and the `_90`
ChatGPT loop depends on it): the verdict always prints, but only `--gate` makes
a failure a non-zero exit (3) that automation can trust. Named failures:

| Reason | Meaning |
|---|---|
| `DARK` | more than `--max-dark-frac` (default 0.5) of the window renders essentially black |
| `BLACK_LATCH` | lit early, then latches black later — the "sleeper" case, caught by rendering `--gate-frames` (default 600 ≈ 15 s) past the clip |
| `OVER_BUDGET` | mean VM render time exceeds `--budget-ms / --mix-channels` (default 25 ms / 4 channels) |

`GATE_WARN DIM` (peak < 200) is **advisory** — appropriate to ignore on a
deliberately soft ambient pattern.

Other lines it prints, and how to read them:

- `COMPILE_OK` / `COMPILE_FAIL: <language error>` — read the error, it is exact.
- `QUALITY hueSpread=… darkFrac=… brightFrac=… peakMaxChan=…` — **diagnostics,
  not universal bars.** `hueSpread` flags a two-colour spread above 0.06;
  `peakMaxChan >= 200` is the tool's "not dim" heuristic. Judge them against
  *your* concept: an analogous palette or a quiet ambient wash legitimately
  sits low on both.
- `AUDIO_REACT <sig>-><slider>: corr(signal,brightness)=…` — labels
  `(REACTIVE)` above |0.35|. A slider that reshapes geometry rather than
  brightness will read low here **and still be correct**; that is a property of
  the metric, not a defect.
- `TOTAL_BRI … (ANIMATING|LOW-VARIATION)` — spatial motion is real even when
  *total* brightness is flat.
- `LIT_BY_SECTION` — a per-`sId` diagnostic of the loaded model. It is a
  debugging aid only; do not turn it into targeting.

Also run **silence** (calm, non-crashing baseline) and the synth that best
exercises your primary signal — `hats` for highs, `kick_4floor` for kick
events, `bassline` for lows, `riser`/`edm_drop` for builds, `full_track` for
everything:

```bash
node tools/pattern_audio_harness.mjs --pattern patterns/NN_name.js \
  --model titanic --synth silence --frames 96 --gate
```

> **Targeting parity — measured, not assumed (report `_140`).** The harness
> now loads the model through the engine's own `loadModelForGauge()` and
> compiles through `WasmHost.compile()`, so all three source-injection passes
> run here in the engine's order: `inView("Authored Name")` folding →
> `MASK_*` → `FIX_*`. An `inView()`-targeted pattern therefore compiles,
> renders and gates offline, and everything built on the harness inherits it —
> `tools/gallery/gen_variations.mjs` (it spawns the harness, no change of its
> own) and the §9 offline clip path.
>
> Measured on `--model titanic`: a probe branching on `inView("Hull Canvas")`
> and `inView("Stacks")` lights **360** and **24** pixels respectively, with
> **zero** overlap — matching the model's own view membership (both views live
> in the high word, `viewMaskHi`). An unknown name is a loud
> `COMPILE_FAIL: Pattern references unknown view(s) via inView(): <name>.
> Known views for this model: …` at exit 2 — never a silent constant-false
> test. Pinned by
> `tests/tools/harness_inview_injection.test.mjs`.
>
> This replaces the earlier "harness cannot compile inView patterns" note.
> §8.1 param truth is still the gate for control honesty; it is no longer the
> *only* engine-parity tool. Never work around targeting by rewriting
> `inView()` into coordinates or `sectionId` — that is the regression this
> skill exists to stop.

### 8.3 Derived-signal harness

For second-tier signals (structure, phrase, countdown, onsets), driven through
the real detector chain and auto-discovering your `AUDIO_MODULATION_V1` block:

```bash
node tools/pattern_derived_harness.mjs --pattern patterns/NN_name.js \
  --model titanic --synth edm_drop --frames 240
```

> **Targeting parity — measured, not assumed (report `_142`).** This harness
> now loads the model through the engine's own `loadModelForGauge()` and
> compiles through `WasmHost.compile()`, exactly like §8.2's audio harness, so
> the same three source-injection passes run in the engine's order:
> `inView("Authored Name")` folding → `MASK_*` → `FIX_*`. The per-pixel meta is
> the loader's full 7-lane ABI, so `fixtureType`, `pixelLocalIndex` and the
> high view word (`viewMaskHi` — where all 17 titanic composite views live)
> read true here.
>
> Measured on `--model titanic`: `inView("Hull Canvas")` lights **360** pixels,
> `inView("Stacks")` **24**, and the union **384** — disjoint, matching the
> model's own view membership. `viewMaskHi & MASK_STACKS` → 24.
> `fixtureType == FIX_PAR` → **40**, `pixelLocalIndex == 0` → **88** (one per
> fixture), both matching the loader. An unknown view name is a loud
> `COMPILE_FAIL: Pattern references unknown view(s) via inView(): <name>.
> Known views for this model: …` at exit 2, and a model that exists but does
> not resolve is a named `MODEL_FAIL` at exit 2 — never a silent render. Pinned
> by `tests/tools/derived_harness_inview_injection.test.mjs`.
>
> Before this the harness bare-imported the raw model (every pixel `vMask: 0`,
> no sidecar presets) and drove `lib/marsin_wasm_runtime.js`, which has no
> injection stage at all: `inView()` died with *"strings cannot be used as a
> function argument"*, `MASK_*`/`FIX_*` were `Undefined var`, and the 4-lane
> meta pack made `pixelLocalIndex == 0` match **all 964** pixels instead of 88.

### 8.4 CI tests

```bash
cd marsin_engine
node --test tests/patterns/white_amber_lane_match.test.js   # the w == a invariant
node --test tests/patterns/specialty_white_uv.test.js tests/patterns/param_truth_smoke.test.js
```

### 8.5 Discontinuity check

Capture a few hundred silent frames and compare the per-frame mean absolute
delta: a spike far above the median is a seam or flash. Fix it by re-checking
your phase wrapping (§4).

---

## 9. Step 9 — clips and phone review

```bash
cd marsin_engine
node tools/make_vis_clip.mjs --in ~/tmp/genkit/out/NN_name.json \
  --out ~/tmp/genkit/out/NN_name.html --fps 14 [--layout strip|map|auto] [--view top|front|auto]
```

`--layout auto` gives a **strip** for `test_bench` and a **top-down physical
map** — one glowing dot per pixel at its real coordinate — for the Titanic and
other large rigs. Real-time clips: `--seconds 10` on the harness (default
`--out-fps 20`); big rigs auto-downsample with a printed `DOWNSAMPLED:` line,
never a silent truncation.

Publish for phone review (full detail in
[`.agent/skills/pattern_gallery.md`](pattern_gallery.md)):

```bash
node tools/gallery/publish.mjs --name NN_name --capture ~/tmp/genkit/out/NN_name.json
node tools/gallery/publish.mjs --name NN_name --model titanic \
  --capture ~/tmp/genkit/out/NN_name__titanic.json      # [--view top|front] [--layout strip|map]
node tools/gallery/server.mjs                            # port from gallery_config.json
```

`gen_variations.mjs` produces the paired **static** (`--synth silence`) and
**sound** (driven by your `AUDIO_MODULATION_V1` block) clips the gallery offers
as variations. The operator does the final on-phone visual pass.

---

## 10. Step 10 — register

1. Add the file stem to `marsin_engine/patterns/manifest.json` (keep numbers
   distinct). Examples under `patterns/examples/` stay unregistered.
2. Re-run §8.4 and keep the suite green.
3. **No git operations** unless the operator asks.
4. After any live engine boot the engine writes runtime state into tracked
   `marsin_engine/states/` files. That residue is expected — **report it, do
   not silently revert it.**

---

## 11. Doing it at scale — the sub-agent fleet

For a batch, fan out **one pattern per sub-agent**. Each sub-agent reads the
guide + this skill + its source pattern, writes/edits ONE file, iterates §8
until its controls measure `TRUE` and the gate passes, and returns the exact
verdict lines plus the `--mod` string it used.

The orchestrator must:

- Keep `manifest.json` and all git operations **central** — sub-agents never
  touch them, which avoids write races.
- **Independently re-run §8.1 and §8.2 on every returned pattern.** Do not
  trust self-reports.
- Publish each accepted pattern to the gallery for operator review.

---

## 12. Gotchas (learned the hard way)

- `render3D` coords are already `0..1`; re-normalizing renders patterns black.
- `pixelCount` is a literal `144`. `test_bench` is 52 px, the Titanic 964.
- A phase wrapped at `1.0` and then scaled by a fraction flashes once per wrap.
- The LIVE engine applies a **global palette** that overrides per-pattern
  `cp1`/`cp2` — so "use two colours" means the *geometry* must span both
  endpoints regardless of the hues you defaulted.
- `localSpeed` declared but unused, or motion that only exists when audio is
  mapped, is a bug.
- `sectionId` numbering is **not** portable — see §3. Existing patterns that
  branch on it are single-model until someone migrates them; say so rather than
  pretending otherwise.
- Reserved identifiers cannot be declared: `t i index x y z pixelCount PI PI2
  true false controllerId sectionId fixtureId fixtureType viewMask
  pixelLocalIndex viewMaskHi`. `viewMaskHi` may only ever appear as
  `(viewMaskHi & MASK)` — which is what `inView()` emits for you.
- Trig is **radians**; `wave` / `triangle` / `square` take a `0..1` turn.
- Never wrap an import, a fallback, or a "safe default" around a failure. This
  repo fails loudly on purpose (codex P0).
