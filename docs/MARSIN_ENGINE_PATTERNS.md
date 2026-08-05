# MarsinEngine Pattern Development Guide

This guide defines the engineering contracts, parameter conventions, and runtime
lifecycles for developing LED patterns in the **MarsinEngine** ecosystem.

For the formal grammar, syntax rules, and standard functions of the programming
language, see [`MARSIN_PB_LANG_SPEC.md`](MARSIN_PB_LANG_SPEC.md).
For palette/surface guidance on the physical ship, see
[`COLOR_THEORY.md`](COLOR_THEORY.md).

> **How to read this document.** Everything is sorted into three tiers, and the
> tier is always stated. Do not promote one to another.
>
> | Tier | Meaning |
> |---|---|
> | **HARD CONTRACT** | The engine, the compiler, the ABI, or a CI test enforces it. Breaking it is a bug that fails loudly or renders wrong. |
> | **PRODUCTION CONVENTION** | An operator decision about how this show's patterns are authored. Binding for `marsin_engine/patterns/`, but it is a *choice*, not a runtime rule. |
> | **OPTIONAL CAPABILITY** | A technique available to you. Use it when the artistic idea calls for it. Never required. |
>
> Never describe an artistic preference as a runtime requirement.

---

## 0. The hard contracts, in one list

These are the rules the machine enforces. Sections below give the detail.

1. **Entry points.** At least one of `render(index,x,y,z)` / `render2D` /
   `render3D` is required. `beforeRender(delta)` is optional. (§2)
2. **The engine owns the global speed clock.** A pattern must NOT compute or
   apply a second global-speed multiplier. `t`, `time(scale)` and
   `beforeRender`'s `delta` are already global-speed-scaled when they reach
   you. (§3)
3. **`speed` and `size` are engine-owned globals.** They are never injected
   into a pattern. Declaring `export var speed` / `export function speed(...)`
   receives nothing. (§3.3, `lib/param_center.js` `engineOwned`)
4. **Trig is radians.** `sin/cos/tan/asin/acos/atan/atan2` are JavaScript
   `Math` semantics. `wave/triangle/square` are the exception — their input is
   a `0..1` turn. (§5)
5. **`w == a` whenever logical white is emitted.** Enforced by
   `marsin_engine/tests/patterns/white_amber_lane_match.test.js` over every
   pattern that calls `rgbwau()`. (§6.2)
6. **Reserved identifiers cannot be declared.** Including the metadata
   builtins. `viewMaskHi` may ONLY appear as `(viewMaskHi & MASK)`. (§7.1)
7. **`inView("Name")` folds at compile time; an unknown view name is a hard
   compile error.** No silent constant-false test, no coordinate fallback.
   (§7.3, `lib/in_view_intrinsic.js`)
8. **`MASK_*` and `FIX_*` references that the loaded model cannot satisfy fail
   the compile.** (§7.4)
9. **`pixelCount` compiles to the literal `144`**, not the runtime pixel count.
   Never size a buffer or an index with it. (§11)
10. **5000 instructions per pixel.** Overrun renders that pixel solid red.
    (§2.2)
11. **Allocate arrays in top-level init only.** `render` runs with allocation
    disabled.
12. **Patterns never read live audio signals.** The engine refuses to bind the
    live audio family into pattern globals; audio reaches a pattern only
    through a modulation mapping onto a `slider*`. (§8)
13. **Transition / channel-blend contracts.** Exact outgoing endpoint at
    `progress == 0`, exact incoming endpoint at `progress == 1`, bounded
    output, identical compositing math on W and A, no per-pixel allocation.
    (§10)

---

## 1. Parameter philosophy (PRODUCTION CONVENTION — operator-binding)

> This section replaces the former "every pattern must expose direction,
> radius, kick, autonomous reversal, two colours, true black, party
> brightness" rules. Those manufactured dead, wrong, and weak controls: the
> parameter truth sweep
> ([`.agent/reports/202607/20260725_32_pattern_param_truth_sweep.md`](../.agent/reports/202607/20260725_32_pattern_param_truth_sweep.md))
> measured **170 DEAD, 39 WRONG and 25 WEAK controls out of 817**, and the
> largest recognisable clusters were exactly the generically-mandated ones —
> six `sliderDirection` that never reverse, eight `*Brightness`/`*Glow` that
> never change luma, `sliderRadius` on patterns with no radius.

### 1.1 The rule

**Every control a pattern declares must be truthful, perceptible, independently
useful, and meaningfully effective across its whole range.** A control's name
is a promise about what moves when you turn it. If the promise cannot be kept,
delete the control.

### 1.2 `localSpeed` — the one control every production pattern has

- Every production pattern declares a **truthful `localSpeed`**, and it is the
  **FIRST** local control.
- Truthful means the pattern's motion visibly accelerates and decelerates
  across the slider's range. Declaring the variable and not scaling a rate by
  it is a bug (`113_tower_column_breath` and `114_tower_ring_chase` are the
  measured examples).
- `localSpeed` is a **trim on top of** the engine's global speed clock — see
  §3. Do not multiply in a second global term.

```javascript
export var localSpeed = 0.5;
export function sliderLocalSpeed(v) { localSpeed = v; }
```

### 1.3 `direction` — conditional, and second when present

- Direction exists **only when the pattern's visual concept has meaningful
  directional motion.** A breathing pattern, a symmetric bloom, an omni-
  directional shimmer has no direction; do not give it one.
- When it exists it is the **SECOND** local control.
- Its endpoints must **visibly produce opposite motion**, and it must **not
  freeze at slider centre**. Guard the dead-zone:

```javascript
export function sliderDirection(v) {
  var d = (v * 2.0) - 1.0;
  if (d >= 0.0 && d < 0.06) d = 0.06;        // never exactly 0
  else if (d < 0.0 && d > -0.06) d = -0.06;
  heading = d;
}
```

- **Autonomous direction reversal is NOT required.** It is an
  **OPTIONAL CAPABILITY** — a nice organic touch on a few patterns. Layering a
  clock-driven auto-flip *on top of* a manual `direction` is precisely what
  made `01_cylon_sweep`'s direction unobservable in the sweep: the manual
  control became a bias on a chaotic sign and stopped deterministically
  reversing anything. If you use auto-reversal, either do not also expose
  `direction`, or make the manual control dominant enough that its endpoints
  still measurably reverse travel.

### 1.4 Everything else arises from the artistic idea

There is **no** required `radius`, `kick`, `brightness punch`, `width`,
`trail`, or any other generic slider. Ask what this specific look actually has
handles for, expose those, name them for what they do, and stop.

- **Do not invent controls to fill MIDI knobs.** An empty knob is fine. A
  lying knob is not. (Knob order is fixed by declaration order — see §4.3 —
  so a pattern with three honest controls simply uses three knobs.)
- Store the raw slider value; scale it where you use it. That keeps declared
  defaults meaningful and keeps the offline truth harness able to sweep it.

### 1.5 Declaration order

**HARD CONTRACT:** globals are declared before locals, and **declaration order
of the `slider*` functions is the physical MIDI knob order** on the CaptainPad
control surface. Reordering declarations silently remaps the operator's
muscle memory. See [`docs/34_captainpad_midi.md`](34_captainpad_midi.md).

### 1.6 What is NOT a requirement

- **"High-definition" is not universal.** Crisp single-pixel cores on true
  black are one aesthetic, excellent for signal-to-visual work (§12.3). A
  quiet ambient wash is allowed to be soft, dim, and slow.
- **True black is not universal.** Nor is a mandated non-black floor: keeping a
  small base so the ship stays visible in silence is good judgement for the
  exterior show patterns, not a rule the engine checks.
- **Constant beat behaviour is not universal.** A pattern with no beat concept
  should not fake one.
- **"Party brightness" is not universal.** The mission-critical exterior
  visibility requirement is satisfied by the *show*, i.e. by which patterns are
  in the playlist and where their faders sit — not by forcing every pattern to
  peak.
- **Two palette colours spanning the rig is a convention, not a contract.**
  Strict `cp1`↔`cp2` blending (§9) is the default because it keeps operator
  palette control meaningful; a monochrome or single-endpoint look is a
  legitimate artistic choice.
- **Audio reactivity is not required per pattern.** Audio reaches patterns
  only as modulation onto ordinary sliders (§8). A pattern with no
  modulation-worthy handle simply has none.

---

## 2. Engine architecture and execution lifecycle

Every pattern is written in MarsinScript (a JavaScript-like dialect compiling
to stack-based bytecode) and executes inside the **MarsinVM** WebAssembly
sandbox (`marsin_pb/wasm`, driven by `marsin_engine/lib/wasm_host.js`).

```text
        CaptainPad UI / CPC (Central Parameter Center)
                │ global params            │ local slider values
                ▼                          ▼
  MarsinEngine Node host  (engine.js → pattern_mixer → pattern_channel)
    │  owns: global SPEED clock, global SIZE coord rescale,
    │        palette slew, modulation, per-channel phase
    ▼
  WasmHost  → compile-time inView()/MASK_*/FIX_* injection
    ▼
  MarsinVM   beforeRender(delta) once per frame
             render3D(index,x,y,z) per pixel  → RGBWAU MarsinPixel
    ▼
  sACN out → simulation / rig
```

### 2.1 `beforeRender(delta)`

Runs once per frame, before any pixel. `delta` is **milliseconds** — see §3.2
for its exact, measured behaviour.

### 2.2 `render3D(index, x, y, z)`

Runs per pixel. `x`, `y`, `z` are **normalized `0..1`** model coordinates (do
not re-normalize them). Execution terminates when a colour builtin (`hsv`,
`rgb`, `rgbwau`) is called. Exceeding **5000 instructions** for a pixel aborts
that pixel and renders it solid red — keep the per-pixel path light and do
`O(N)` work in `beforeRender`.

---

## 3. Timing: the global speed clock (HARD CONTRACT)

### 3.1 The engine owns global speed

`engine.js` accumulates a monotonic `patternClockSeconds` by scaling each
wall-clock delta by the current global multiplier, and passes **that** into
`mixer.beginFrame(elapsed)`:

```js
// marsin_engine/engine.js — createRenderLoop
patternClockSeconds += wallDelta * globalSpeedMultiplier();
const elapsed = patternClockSeconds;
...
mixer.beginFrame(elapsed);
```

`globalSpeedMultiplier()` maps the CPC `speed` fader `0..1` exponentially onto
`0.25×  … 4×` (`0.5` is exactly `1×`). `PatternChannel.beginFrame` then
differences consecutive `elapsed` values, scales by that channel's tap-tempo
multiplier, accumulates into a per-channel `_phaseSeconds`, and hands **that**
to `wasmHost.beginFrame(handle, seconds)` — with an explicit comment that the
global speed must not be re-applied there, "that would double-count it".

**Therefore:**

- `t` is exactly the seconds value the host passed in (probe E below).
- `time(scale)` sweeps its `0..1` sawtooth off that same clock, period
  `65.536 × scale` seconds (probe F).
- `delta` is the millisecond difference between consecutive such values
  (§3.2) — so it, too, is already global-speed-scaled.

A pattern applies **only** its own `localSpeed` trim:

```javascript
var tPhase = 0.0;

export function beforeRender(delta) {
  // localSpeed ONLY. The global SPEED fader is already inside `delta`.
  var localMult = pow(2.0, (localSpeed - 0.5) * 4.0);  // 0.5→1×, 1→4×, 0→0.25×
  tPhase = (tPhase + (delta / 1310.72) * localMult) % 1.0;
  if (tPhase < 0.0) tPhase += 1.0;
}
```

The divisor is simply the loop duration in milliseconds: `delta / 1310.72`
completes a `0..1` phase per 1.31 s of scaled clock; `delta / 65536.0` per
65.5 s. Pick whichever the look wants.

> **Removed:** the former `var globalMult = pow(2.0, (speed - 0.5) * 4.0)`
> idiom, and the instruction to `export var speed` in every pattern. Both are
> obsolete: `speed` was demoted to `engineOwned` in `lib/param_center.js`
> ("deliberately NOT injected as pattern variables, so patterns can't fight
> the engine over the same knob"), so the pattern-side multiplier had nothing
> real to read and, where a pattern kept a stale `speed` default of 0.5, it
> multiplied the engine's already-scaled clock by a *second* constant.

### 3.2 `delta` — measured behaviour (offline probe, current vendored WASM)

Measured with an offline probe against
`marsin_engine/lib/marsin_wasm_runtime.js` + `marsin_pb/wasm` (no engine boot,
no ports): a pattern stores `delta` in `beforeRender` and emits it as a pixel
byte; the host drives `beginFrame(elapsed)` with controlled sequences.

| `beginFrame` elapsed sequence (s) | `delta` seen per frame (ms) |
|---|---|
| `0, 0.025, 0.05, 0.075, 0.1` | `16, 16, 25, 25, 25` |
| `0, 0.01, 0.03, 0.13, 0.14, 0.14, 0.20` | `16, 16, 20, 100, 10, 0, 60` |
| `1.0, 1.2, 1.4, 1.6` | `16, 200, 200, 200` |
| `0, 0, 0, 0` | `16, 16, 16, 16` |

**The contract this establishes:**

1. `delta` is a **real millisecond step**, `(elapsed_now − elapsed_prev) × 1000`
   — it *does* track the value passed to `beginFrame`. (The older claim that it
   is a fixed nominal step independent of `elapsed` is **wrong** and has been
   removed from both documents.)
2. Because the host passes the **speed-scaled** clock, `delta` is
   **global-speed-scaled too**. Motion built on `delta` obeys the SPEED fader
   exactly as motion built on `time()` does. (The older "SPEED scales `time()`,
   not `delta`" gotcha is **wrong** and has been removed.)
3. **Initialization:** the VM's previous-time slot starts at `0` and `0` doubles
   as the "no previous frame" sentinel. So `delta` is a **nominal `16.0` ms**
   on the first frame, and on any frame whose predecessor's `elapsed` was
   exactly `0`. The engine's first tick has `wallDelta == 0` and a fresh
   channel's `_phaseSeconds` starts at `0`, so in practice **a freshly loaded
   pattern sees `16, 16, <real>, <real>, …`**. Two nominal frames at 40 fps is
   ~50 ms of slightly-off phase — harmless for accumulators, fatal only if you
   try to derive frame rate from frame 1.
4. A repeated `elapsed` yields `delta == 0` (frame 6 of the irregular row), not
   the nominal. Accumulators must tolerate a zero step.
5. `delta` is clamped into the pixel byte in the probe, not in the VM — the
   200 ms and 100 ms rows are genuine, unclamped values.

### 3.3 What patterns must never do

- Compute a global speed multiplier from a `speed` variable. (`speed` is
  engine-owned; the variable will simply hold its declared literal forever.)
- Re-scale `t` or `time()` by a global term.
- Drive animation from a frame counter. During a transition your `beforeRender`
  may run invisibly in a background buffer, so frame counts are not a stable
  clock.

---

## 4. Parameter binding

### 4.1 Global parameters (CPC, shared across decks)

| Global | Binding | Status |
|---|---|---|
| `speed` | **engine-owned** — never injected | HARD CONTRACT |
| `size` | **engine-owned** — rescales the coord buffer (`wasmHost.applySizeScale`) | HARD CONTRACT |
| `colorPalette1` / `colorPalette2` | bound to the pattern's exported function | HARD CONTRACT |
| `rotate`, `colorTransitionMs`, `bpmSpeed*` | bound if exported | — |
| live audio family (`micLow`, `micKick`, `audioBpm`, …) | **never** bound into pattern globals | HARD CONTRACT (§8) |

```javascript
export var cp1H = 0.0,  cp1S = 1.0, cp1V = 1.0;
export var cp2H = 0.08, cp2S = 1.0, cp2V = 1.0;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }
```

The engine slews the two pickers toward their target over `colorTransitionMs`
(see [`docs/36_color_palette_live_transitions.md`](36_color_palette_live_transitions.md)),
so what a pattern receives is the ramped value, not a snap.

### 4.2 Local parameters (deck sliders)

Any exported function whose name starts with `slider` registers a deck slider
with input `0.0 … 1.0`. Use the **identity-slider** shape so the declared
default is the value the engine and the offline harness both see:

```javascript
export var shimmer = 0.35;                        // the variable IS the control
export function sliderShimmer(v) { shimmer = v; } // store raw; scale at use site
```

An untouched slider is seeded to the Pixelblaze default **0.5** by
`PatternChannel.seedLocalControlDefaults` (toggles → 0, hsv pickers → h0/s1/v1)
so every declared control broadcasts a real value and MIDI knob indices stay
aligned.

### 4.3 Ordering

**Declaration order of `slider*` functions = UI order = MIDI knob order.**
`localSpeed` first; `direction` second when present (§1.3); everything else in
whatever order makes performing the pattern natural.

---

## 5. Trigonometry — radians

`sin`, `cos`, `tan`, `asin`, `acos`, `atan`, `atan2` use **radians**
(JavaScript `Math` semantics). Multiply a normalized `0..1` phase by `PI2` to
get an angle:

```javascript
var angle = (x * 10.0) * PI2;      // 10 spatial cycles across x
var amp   = sin(angle + beatPhase); // beatPhase in radians
```

**Exception:** `wave(x)`, `triangle(x)` and `square(x, duty)` take a
turn-based `0..1` input. `wave(x) == (1 + sin(x * PI2)) / 2`. If your value is
already radians, divide by `PI2` before passing it in.

---

## 6. Colour output and what the hardware actually does

### 6.1 The emit builtins

`rgb(r,g,b)` and `hsv(h,s,v)` leave W/A/U at zero. `rgbwau(r,g,b,w,a,u)` is the
Marsin extension giving direct six-lane control. All channels clamp to `0..1`;
NaN resolves to black.

### 6.2 The `w == a` invariant (HARD CONTRACT)

> **Wherever a pattern emits logical white, the W and A lanes must carry the
> same value.** `w != a` on a white emit is an authoring bug.

```javascript
rgbwau(0, 0, 0, 1, 1, 0)   // the ship's white — matched W + A
rgbwau(0, 0, 0, 1, 0, 0)   // WRONG: too cold on the rig
rgbwau(0, 0, 0, 0, 1, 0)   // WRONG: reads almost yellow
```

Why: the RGBWAU pars and bars carry **separate white and amber emitters**, and
neither is a usable white alone — W alone is clinical and blue-ish, A alone is
a saturated amber. **W and A driven to the same value is the warm white the
whole show is tuned against.**

Consequences for authoring:

- **Shape cooler/warmer whites on the RGB lanes.** Never by unbalancing W
  against A. (That is what the `warmth` control does in the `60`–`64` white
  family.)
- **Amber is not a separate authoring accent lane under this project
  convention.** Build gold and fire looks on RGB; the A lane belongs to the
  white system. This is a project convention layered on top of the hard
  invariant — the hardware *has* an amber emitter, we simply do not author it
  independently, because doing so desynchronises white between the RGBWAU
  fixtures and the RGBW ones.
- **`u` (UV) is unaffected** and stays an independent lane.
- The idiom is either duplicating the white expression at the call site, or
  assigning the amber lane from the white lane just before the emit:

```javascript
rgbwau(clamp01(r), clamp01(g), clamp01(b), clamp01(w), clamp01(w), 0.0);
// or
outA = outW;
rgbwau(r, g, b, outW, outA, outU);
```

**Enforcement:** `marsin_engine/tests/patterns/white_amber_lane_match.test.js`
auto-discovers every pattern that calls `rgbwau()`, renders it, and asserts the
W and A bytes are identical on every pixel of every frame. No allowlist, no
opt-out. Transition and channel-blend scripts are out of scope — they
composite already-rendered sources rather than authoring white, so their W and
A lanes are whatever the inputs supplied (and §10's matched-inputs rule is what
keeps them matched).

> **Known interaction:** a lane-match pass that appends an unconditional
> `a = clamp01(w)` at the end of a pattern will overwrite any amber a control
> was driving. That is exactly why `13_sparkle / sliderAmberGlint` measures
> DEAD in the parameter truth sweep. Assign the amber lane *from* the white
> expression, do not staple it on after other code has written `a`.

### 6.3 What the Titanic can actually emit (HARD FACTS)

The finished mapping is **964 pixels** across five instruments:

| Instrument | Pixels | Fixtures | Emitters | Output path |
|---|---:|---|---|---|
| **Hull Canvas** | 360 | 20 × Shehds 18-px bar, across the four wall groups | RGB + W + Amber + UV | DMX, RGBWAU-capable |
| **Silhouette** | 320 | 8 rope/strand runs of 40 | RGBW | LED strand (`led_wire.js`) |
| **Jewelry** | 96 | 16 × Vintage 6-head rail fixture | RGBW | DMX |
| **Organs** | 40 | 40 × UKing par — 24 across the main and small stack structures, 16 across the left and right auditoriums | RGB + W + Amber + UV | DMX, RGBWAU-capable |
| **Identity** | 148 | 2 × independently controlled 74-pixel TE sign | RGBW | LED strand (`led_wire.js`) |

Sources: [`simulation/scenes/titanic/patches.yaml`](../simulation/scenes/titanic/patches.yaml),
[`simulation/scenes/titanic/controllers.yaml`](../simulation/scenes/titanic/controllers.yaml),
[`simulation/scenes/titanic/scene_config.yaml`](../simulation/scenes/titanic/scene_config.yaml),
and the fixture models under `simulation/dmx/fixtures/`.

**Correcting stale claims:** the rope strands and the TE signs **do** have
dedicated white emitters — they are RGBW (`led.order: RGBW`, `stride: 4`,
`whiteMode: native`), and the TE sign pucks are documented in
`simulation/dmx/fixtures/te_sign_v3/model_a_160.yaml` as "the SAME LEDs as the
rope strands". What they lack is **amber** and **UV**.

**How the six render lanes reach each path** — the authority is
[`simulation/src/dmx/sacn_mapper.js`](../simulation/src/dmx/sacn_mapper.js) and
[`simulation/src/dmx/led_wire.js`](../simulation/src/dmx/led_wire.js):

- **DMX fixtures (bars, pars, vintage rails).** R/G/B/W/A/U bytes are written
  to the fixture's mapped channels as authored. Where the fixture profile has
  no A or U channel, that lane simply has no destination. When a pattern
  produced no explicit W, the mapper synthesizes `W = min(R,G,B)` from the
  bytes as they stand in the universe buffer — so **to control white you must
  emit it yourself.**
- **LED strands (ropes, TE signs).** `ledWireBytes()` folds the **amber lane
  into RGB** using the preview weights `[0.9, 0.6, 0.0]` (`foldAmber`, on by
  default), **drops the UV lane entirely** (there is no UV emitter), then
  jointly pre-scales the whole RGBW quad by one shared factor so no channel's
  `RGB + W` composite can clip. One shared factor means hue and the
  colour-versus-white balance you authored survive exactly; the picture gets
  dimmer rather than distorted. Gamma lives **only** on the LED controller;
  the mapper emits linear bytes.

> **The RGB approximation formulas are a PREVIEW path, not the physical output
> path.** `displayR = min(1, R + W + 0.8A + 0.1U)` and friends describe how a
> *3-channel-only* surface (legacy firmware LED output, the RGB-only WASM
> exports, the DMX preview blend) approximates six lanes for display. The
> Titanic's actual chain is: RGBWAU-capable DMX for bars and pars, native RGBW
> wire for strands and signs. Do not reason about the physical rig from those
> equations.

---

## 7. Model metadata and view targeting

### 7.1 The current per-pixel metadata ABI (HARD CONTRACT)

The host packs **7 int32 lanes per pixel** into the buffer the WASM
`*_with_meta` render exports read. The lane layout is a cross-repo ABI contract
(`marsin_engine/lib/meta_abi.js`):

| Lane | Builtin | Notes |
|---:|---|---|
| 0 | `controllerId` | numeric id of the physical controller |
| 1 | `sectionId` | **model-specific** numeric section id |
| 2 | `fixtureId` | **model-specific** numeric fixture id |
| 3 | `viewMask` | low view word — 31 usable bits |
| 4 | `fixtureTypeId` | read in-VM as the `fixtureType` builtin; canonical `FIX_*` id |
| 5 | `pixelLocalIndex` | 0-based index of this pixel within its fixture |
| 6 | `viewMaskHi` | high view word — Tier C, lifts the budget to 62 views |

All seven are **reserved identifiers** — you cannot declare or assign them.
Verified by compile probe against the vendored WASM:

- `controllerId`, `sectionId`, `fixtureId`, `viewMask`, `fixtureType`,
  `pixelLocalIndex` read as ordinary numbers.
- **`viewMaskHi` is restricted.** The compiler rejects anything but the
  membership form: *"viewMaskHi may only be used as `(viewMaskHi & MASK)` — it
  cannot be stored, compared, shifted, or used in arithmetic."* The mask must
  be a compile-time single-bit literal, which is exactly what `inView()` and
  the `MASK_*` injector emit.
- `fixtureTypeId` and `pixelIndex` are **not** builtin names (`Undefined var`).
  The lane is named `fixtureTypeId` in the ABI; the *language* name is
  `fixtureType`.

The old "the engine injects four metadata variables" description is obsolete —
it predates `fixtureTypeId`, `pixelLocalIndex` and the second view word.

### 7.2 Section IDs are model-specific — never a portable taxonomy

**Do not write `sectionId == 2 // Vintage`.** There is no global section
taxonomy. `test_bench` happens to use `1 = Pars, 2 = Vintage, 3 = Bars`; the
Titanic uses values like `514` (Right Front Wall) and `515` (Right SmokeStacks)
— see [`simulation/scenes/titanic/patches.yaml`](../simulation/scenes/titanic/patches.yaml).

This is not a hypothetical. The parameter truth sweep found **137 dead
parameters — one in six of every knob measured** — precisely because patterns
gated their white/blinder work behind `sectionId == 2`, a branch that never
executes on the ship.

Use raw section ids only for a pattern that is explicitly and only for one
model, and say so in the header.

### 7.3 Prefer `inView("Authored View Name")` (RECOMMENDED)

`inView()` is a **compile-time intrinsic** (`lib/in_view_intrinsic.js`) that
resolves an authored view name to its exact membership test:

```javascript
if (inView("Hull Canvas")) {
  // the four wall groups, 360 bar pixels — one line, no bit arithmetic
}
```

- It resolves **both words**: a low-word view folds to
  `((viewMask & <bit>) != 0)`, a high-word view to
  `((viewMaskHi & <literal>) != 0)`.
- Resolution is by the view's **authored name** — the same string the scene's
  Views panel and `/model/view-selection-options` use — so
  `inView("Right Front Rails")` works verbatim, spaces and all.
- **An unknown view name is a hard compile error** that lists the known views
  for the loaded model. It never folds to a silent constant-false test.
- A "bit-free" host-only view is **promoted on demand**: the host allocates a
  free `(word, bit)` from the 62-bit budget, sets it on the view's member
  pixels, and re-packs the meta buffer. If no promoter is wired or the budget
  is exhausted, it throws loudly.
- A commented-out `inView("X")` neither folds nor fails the compile.

**Do not write a coordinate or metadata fallback around it.** `if (sectionId ==
0) { /* guess from x */ }` violates the no-fallback rule (codex P0) and is what
lets a broken model render *something* instead of failing where you can see it.

### 7.3.1 The semantic views on `titanic`

Source of truth:
[`simulation/scenes/titanic/views.yaml`](../simulation/scenes/titanic/views.yaml),
exported to
[`marsin_engine/models/titanic.viewmasks.js`](../marsin_engine/models/titanic.viewmasks.js),
which the engine validates against the loaded model and fails loudly on drift.
**31 names** are `inView()`-able from the scene registry: **7** composite views
plus the 24 base groups — and on top of those the engine derives the bit-free
auto-views in §7.3.2, which `inView()` resolves the same way. Names below are
exact — `inView()` matches the authored string verbatim.

**The seven composite views** — this is the layer to reach for first, because it
is the one that maps onto the five instruments in
[`COLOR_THEORY.md`](COLOR_THEORY.md) §2:

| View | Pixels | Covers |
|---|---:|---|
| `Hull Canvas` | 360 | all four wall groups |
| `Silhouette` | 320 | all eight rope strands |
| `Jewelry` | 96 | all four Vintage rail groups |
| `Organs` | 40 | all pars — stacks **and** auditoriums |
| `Identity` | 148 | both TE signs |
| `Stacks` | 24 | the four stack structures only |
| `Auditoriums` | 16 | Left + Right Auditorium |

Counts verified by summing the model's per-group pixel membership; the five
instruments total the ship exactly (360 + 320 + 96 + 40 + 148 = 964).

Note that `Organs` (40) = `Stacks` (24) + `Auditoriums` (16) — so `Organs` is
the whole par instrument, and `Stacks` is the stacks-only subset. Reach for
`Stacks` when you mean the funnels; `Organs` when you mean every par.

**There are no `Left *` / `Right *` composites.** The ten of them
(`Left Hull`, `Right Hull`, `Left Silhouette`, `Right Silhouette`,
`Left Jewelry`, `Right Jewelry`, `Left Organs`, `Right Organs`, `Left Stacks`,
`Right Stacks`) were **removed** by operator ruling (report `_145`). When you
mean a half of the ship, use the exhaustive **`LEFT`** / **`RIGHT`** views
below — they cover 482 pixels each, every instrument included. Combine them
with an instrument view when you want a half of one instrument:
`if (inView("Silhouette") && inView("LEFT"))`.

**The 24 base group views** (finer-grained, unchanged by this revision):

`Right Front Wall` · `Left Front Wall` · `Right Back Wall` · `Left Back Wall` ·
`Right Front Rails` · `Left Front Rails` · `Right Back Rails` ·
`Left Back Rails` · `Right Auditorium` · `Left Auditorium` ·
`Left SmokeStack` · `Right SmokeStacks` · `Left Small SmokeStack` ·
`Right Small SmokeStack` · `Left_Front_Left` · `Left_Back_Left` ·
`Left_Back_Right` · `Left_Front_Right` · `Right_Back_Left` ·
`Right_Back_Right` · `Right_Front_Right` · `Right_Front_Left` · `TE Sign` ·
`TE Sign 2`

Note the spelling irregularities, which `inView()` matches literally:
**`Right SmokeStacks` is plural** while `Left SmokeStack` is singular; the rope
strand groups use **underscores** (`Left_Front_Left`), unlike every other name;
the sign groups are `TE Sign` and `TE Sign 2`, and `Left Auditorium` /
`Right Auditorium` are singular base groups while the composite is
`Auditoriums`. Copy the name, do not retype it from memory.

**Word placement** (an implementation detail you should not need, but which
explains the generated code): **the 24 base groups live in the low word** and
fold to `((viewMask & <bit>) != 0)`; **all seven composite views live in the
high word** and fold to `((viewMaskHi & <literal>) != 0)`.

That split is the allocator's policy, not a coincidence:
`CUSTOM_VIEW_WORD_ORDER = [1, 0]` in
[`simulation/src/dmx/view_registry.js`](../simulation/src/dmx/view_registry.js)
makes a new custom view prefer word 1, with word 0 kept only as the spill
target — because base group bits are **hard-pinned to word 0** and are the only
consumer that cannot go anywhere else. Spending word 0 on a composite would
starve the scene's ability to grow fixture groups. So expect any future
composite to land in the high word too.

`inView()` picks the right word for you, which is exactly why you should use it
rather than hand-written bit tests — a composite's word (and bit) is an
allocator decision that can change when the scene is re-saved. `Hull Canvas`,
for instance, has already moved from word 0 bit `0x40000` to word 1 bit
`0x400`. Any pattern that had hard-coded the old value would now be silently
testing the wrong pixels; `inView("Hull Canvas")` simply recompiles correctly.

**Names that do NOT exist** — these are hard compile errors naming the view,
not empty selections:

- `All Bars`, `All Ropes`, `All Vintage Lights`, `All TE Signs` → use
  `Hull Canvas`, `Silhouette` (or `Strands`), `Jewelry`, `Identity` (or
  `TE Signs`).
- `Left Hull`, `Right Hull`, `Left Silhouette`, `Right Silhouette`,
  `Left Jewelry`, `Right Jewelry`, `Left Organs`, `Right Organs`,
  `Left Stacks`, `Right Stacks`, `Left Identity`, `Right Identity` → use
  `LEFT` / `RIGHT` (optionally `&&` an instrument view).
- `PORT`, `STARBOARD` → `LEFT`, `RIGHT`.
- `FORE`, `AFT` → `FRONT`, `BACK`.
- `BAND_LOW`, `BAND_MID`, `BAND_HIGH`, every `<base>_BOTH` name, `@RAW` →
  removed outright (report `_145`); `@RAW`'s pixels are now `Strands`.
- `WALLS`, `AUDITORIUM` → removed (report `_148`) as exact duplicates of the
  authored `Hull Canvas` / `Auditoriums`; use those. `DECKS` and `CHIMNEYS`
  never existed on titanic.

**Exact spelling is mandatory.** `inView()` matches the authored string
verbatim — case, spaces, underscores and all. A near-miss is a compile error,
which is the point: there is no fuzzy match and no fallback view.

> **Do not confuse the two view files.**
> [`simulation/scenes/titanic/views.yaml`](../simulation/scenes/titanic/views.yaml)
> is the **engine semantic / base view-mask registry** — the group→bit contract
> patterns compile against.
> `simulation/scenes/titanic/pixel_map_views.yaml` is a **simulator display
> layout** sidecar (2D operator pixel-map arrangements). It has no bearing on
> `inView()` or on what a pattern can target.

### 7.3.2 The derived auto-views on `titanic`

These are minted by
[`marsin_engine/lib/auto_views.js`](../marsin_engine/lib/auto_views.js) at model
load from metadata the model already carries, so they can never go stale
against the pixels. They are **Tier-A**: pure per-pixel membership, no
`viewMask` bit spent, promoted to a bit on demand the first time an `inView()`
touches one. They are the same list CaptainPad's view picker shows.

| View | Pixels | Derived from |
|---|---:|---|
| `LEFT` | 482 | world **X < 0** — the whole port half, every instrument |
| `RIGHT` | 482 | world **X > 0** — the whole starboard half |
| `FRONT` | 388 | groups carrying a `Front` token |
| `BACK` | 388 | groups carrying a `Back` token |
| `Strands` | 320 | fixture role `FIX_RAW_LED` — the eight rope runs |
| `TE Signs` | 148 | fixture role `FIX_TE_SIGN` — both signs |
| `@BAR` | 360 | fixture role `FIX_BAR_18` |
| `@PAR` | 40 | fixture role `FIX_PAR` |
| `@VINTAGE` | 96 | fixture role `FIX_VINTAGE_6` |
| `CTRL_1` … `CTRL_18` | varies | one per LED/DMX controller, for strike + debug |

`LEFT` and `RIGHT` are **exhaustive and disjoint**: 482 + 482 = 964, every
pixel in exactly one half, each half carrying its own wall bars, rope strands,
Vintage rails, stacks, auditorium pars and one TE sign. The side comes from the
pixel's world X — physical truth — and a `Left_`/`Right_` group token that
disagrees with the geometry makes the model **throw at load**, never quietly
pick a side.

**`Strands` and `TE Signs` are operator/mixer targeting handles**, keyed on the
fixture role rather than the scene's group names. When you mean both signs
**artistically**, keep writing `inView("Identity")` — that is the semantic
instrument view, and it is the one `COLOR_THEORY.md` §2 is written against.
`Strands` and `Silhouette` cover the same 320 pixels for the same reason.
`@BAR` is the same idea one level down: fixture-**capability** targeting (every
18-cell bar), which happens to be the same 360 pixels as `Hull Canvas` today.

**There are no structural views on `titanic`.** The generator's
`WALLS`/`DECKS`/`CHIMNEYS`/`AUDITORIUM` family derives from a group-name token,
and on this ship `WALLS` came out byte-identical to the authored `Hull Canvas`
and `AUDITORIUM` byte-identical to `Auditoriums` — two picker rows and two
spellings for one pixel set. Both were **removed** by operator ruling (report
`_148`); `inView("WALLS")` and `inView("AUDITORIUM")` are now hard compile
errors. Use **`Hull Canvas`** and **`Auditoriums`**. (`DECKS`/`CHIMNEYS` never
existed here — titanic carries no `Deck`/`Chimney` group token.) The rule is
membership-driven, not titanic-specific: a scene whose structural band has no
byte-identical authored twin still gets the derived view.

### 7.4 Fixture-type constants (`FIX_*`) — when capability is the real distinction

`fixtureType` is the one per-pixel property that stays stable when you switch
models (`fixtureId`/`group`/`viewMask` all reshuffle). Use it when the artistic
distinction genuinely is *fixture capability*:

```javascript
if (fixtureType == FIX_PAR) { /* one big single-pixel wash source */ }
```

Canonical roles (`lib/fixture_type_constants.js`, ids are append-only and never
renumbered): `FIX_RAW_LED` (1), `FIX_PAR` (2), `FIX_VINTAGE_6` (3),
`FIX_BAR_18` (4), `FIX_HAZE` (5), `FIX_FOG` (6), `FIX_TE_SIGN` (7 — both sign
panel variants, one role). Only the types **present on
the loaded model** are emitted, so a `FIX_*` reference the model cannot satisfy
**fails the compile** rather than silently matching nothing.

`MASK_*` constants behave the same way: injected only where referenced,
unknown names are a loud compile-stage error, and a pattern that declares its
own `var MASK_X` wins.

**Choosing between them:** `inView("…")` for *where on the ship*; `FIX_*` for
*what kind of light this is*; raw `sectionId`/`fixtureId` only for
explicitly-single-model work.

---

## 8. Audio reactivity — modulators only (HARD CONTRACT)

**Operator decision 2026-06-17: patterns MUST NOT read live audio signals
natively.** There is no "declare `export var micLow` and the engine feeds it"
path. `lib/param_center.js` `registerChannel` skips every export whose name is
in the live audio family (`isLiveAudioSharedFnName`, sourced from
`audio/postproc/audio_signals.js`), so such a declaration receives nothing.

Audio reactivity is two pieces:

1. **The pattern exposes an ordinary `slider*`** for the thing audio should
   drive, with a resting default that already looks good with no audio:

```javascript
export var domEnergy = 0.6;
export function sliderDomEnergy(v) { domEnergy = v; }
// render reads `domEnergy`, never `micDomEnergy1`.
```

2. **A modulation mapping couples an audio source to that slider**, declared on
   the playlist entry (`simulation/scenes/<scene>/playlists/<name>.yaml`).
   `lib/modulation_engine.js` reads the source each frame and writes the
   modulated value through the normal control path:

```yaml
modulations:
  - id: mod_sliderDomEnergy_micDomEnergy1
    type: continuous
    enabled: true
    source: { scope: cpc, key: micDomEnergy1 }
    target: { scope: pattern, parameter: sliderDomEnergy }
    mode: offset          # or scale
    polarity: unipolar    # or bipolar
    range: [0, 0.4]
    curve: easeOut        # linear | easeIn | easeOut | exp
```

**Available sources.** Any CPC key can be a modulation source — sources are not
allow-listed. The live audio family (source of truth:
`marsin_engine/audio/postproc/audio_signals.js`) includes mic band energies and
kick/flux (`micLow`, `micMid`, `micHigh`, `micKick`, `micFlux`), the dominant-
frequency analyzer (`micDomFreq1/2`, `micDomEnergy1/2`), the tempo/beat grid
(`tempoBpm`, `audioBpm`, `audioBeat`, `audioBeatInBar`, `audioBarPhase`,
`audioDownbeat`), the structure detector (`audioStructure`, `audioBuildScore`,
`audioEnergyRatio`, `audioVocalsHot`, `audioDropPulse`, `audioSlowZone`), and
derived cues (`audioParty`, `audioNote`, `audioNoteHue`, `audioSwitchPattern`,
`audioSwitchColor`). These are fed by the Audio Companion over OSC, live in the
CPC as `live:true` params, and are broadcast to CaptainPad for the ghost
slider — but they are never injected into pattern globals.

> The persistent `*Gain` knobs (`micLowGain`, …) are operator levels, not
> signals. They are not in the live set and are not modulation sources — they
> *do* bind normally.

**Consequence for control design:** a control meant to be driven by a
transient (a kick) may legitimately be edge-triggered and do nothing while
*held* at any value. Say so in the header — the offline truth harness has a
trigger probe for exactly this case, but a human reading the file should not
have to guess.

---

## 9. Palette handling — strict `cp1`↔`cp2` (PRODUCTION CONVENTION)

### 9.1 Why RGB-space, not HSV-space

Interpolating `cp1H → cp2H` walks *around* the colour wheel: red + blue gives
purple/magenta/pink midpoints the operator never picked; blue + orange gives
green. Converting each picker to RGB once and lerping in RGB-space keeps the
output strictly on the straight line between the two pickers.

A second failure mode is the compact "rainbow wave" idiom
(`r = v*wave(h+0.000); g = v*wave(h+0.333); b = v*wave(h+0.666)`), which emits
non-zero values on all three channels regardless of `h` and saturation. RGB
lerping between two pre-converted endpoints fixes both at once.

### 9.2 The canonical idiom

Convert once per frame in `beforeRender`, lerp per pixel in `render3D`:

```javascript
var pr1 = 1, pg1 = 0, pb1 = 0;
var pr2 = 0, pg2 = 0, pb2 = 1;
function _hsv2rgb1() {
  var hv = cp1H - floor(cp1H); if (hv < 0) hv += 1;
  var iv = floor(hv * 6) % 6;
  var fv = hv * 6 - floor(hv * 6);
  var pv = cp1V * (1 - cp1S);
  var qv = cp1V * (1 - fv * cp1S);
  var tv = cp1V * (1 - (1 - fv) * cp1S);
  if      (iv == 0) { pr1 = cp1V; pg1 = tv;   pb1 = pv;   }
  else if (iv == 1) { pr1 = qv;   pg1 = cp1V; pb1 = pv;   }
  else if (iv == 2) { pr1 = pv;   pg1 = cp1V; pb1 = tv;   }
  else if (iv == 3) { pr1 = pv;   pg1 = qv;   pb1 = cp1V; }
  else if (iv == 4) { pr1 = tv;   pg1 = pv;   pb1 = cp1V; }
  else              { pr1 = cp1V; pg1 = pv;   pb1 = qv;   }
}
// _hsv2rgb2() is the same body against cp2H/cp2S/cp2V → pr2/pg2/pb2.

export function beforeRender(delta) {
  /* timing math */
  _hsv2rgb1();
  _hsv2rgb2();
}

export function render3D(index, x, y, z) {
  var blend = /* your 0..1 blend factor */;
  var v     = /* your 0..1 brightness  */;
  rgb((pr1 + (pr2 - pr1) * blend) * v,
      (pg1 + (pg2 - pg1) * blend) * v,
      (pb1 + (pb2 - pb1) * blend) * v);
}
```

**Local naming (HARD CONTRACT).** MarsinScript reserves single-letter
identifiers (`h`, `i`, `f`, `p`, `q`, `t`, `r`, `g`, `b`, `x`, `y`, `z`) for
builtin slots and per-pixel context — `var i = ...` is a compile error
(`Cannot declare reserved name 'i'`). Use the two-character `*v` suffix inside
palette helpers. See `MARSIN_PB_LANG_SPEC.md` §2.4.

This idiom is slated to become the language builtins `paletteRgb1()` /
`paletteRgb2()` — see [`MARSIN_PB_LANG_SPEC.md`](MARSIN_PB_LANG_SPEC.md) §6.6
("Future: built-in palette accessors"). Until then every pattern carries its
own copy.

### 9.3 Legitimate opt-outs

- **Per-instrument palette positions.** A pattern that deliberately drives
  different parts of the ship at different points on the palette still uses the
  helpers; it just picks `blend` from `inView(...)` / `fixtureType` instead of
  from a continuous gradient. One palette does **not** mean identical colour on
  every fixture family — see `COLOR_THEORY.md` §7.
- **W / A / UV lifts.** Additive writes to the white and UV lanes on top of the
  RGB lerp are fine — they sit on dedicated emitters and do not pollute the
  palette hue. Expose them as named sliders (`sliderWhiteLift`,
  `sliderUvLevel`, …) so an operator can disable them per show. Remember §6.2:
  the amber lane follows white, it is not a separate accent.
- **Single-endpoint / monochrome concepts.** Allowed; say so in the header.

---

## 10. Transitions and channel blends (HARD CONTRACT)

The same scripts serve two contexts. During a **transition** `progress` is
elapsed/duration (`0 → 1` automatically) and `from*` / `to*` are the outgoing
and incoming patterns. In the **channel mixer** `progress` is the channel
**fader** and `from*` is the accumulated mix-so-far while `to*` is this
channel's own output. The script is identical; only the engine's binding
changes.

**Every transition and channel-blend script must satisfy all of these:**

1. **Exact outgoing endpoint at `progress == 0`.** Output must equal the `from*`
   input, byte for byte. A blend that is off by a rounding step at 0 shows as a
   visible pop the instant a fader leaves rest.
2. **Exact incoming endpoint at `progress == 1`.** Output must equal the `to*`
   input. A channel at full fader must render its pattern, not an approximation
   of it.
3. **Bounded output.** Every lane stays in `0..1`. Additive modes must be
   written so the clamp is a designed ceiling, not an accident.
4. **Identical compositing math for W and A.** Whatever expression produces the
   W output must produce the A output with the A inputs substituted — so two
   matched inputs (`fromW == fromA`, `toW == toA`) stay matched on the way out.
   This is what keeps §6.2's invariant true through the mixer, and it is why
   blends are exempted from the lane-match test.
5. **No per-pixel allocation.** `render` runs with allocation disabled, and a
   scripted transition evaluates *three* scripts per pixel (outgoing, incoming,
   blend), dividing the 5000-instruction budget three ways.
6. **Truthful direction for spatial transitions.** A wipe named `wipe_left` must
   travel left. A `direction`/`feather` control on a wipe must measurably change
   the thing it names.

```javascript
// patterns/transitions/wipe_x.js — a spatial wipe with a feathered edge.
export var feather = 0.08;

export function render(index, x, y, z) {
  var edge = smoothstep(progress - feather, progress + feather, x);
  rgbwau(
    mix(fromR, toR, edge),
    mix(fromG, toG, edge),
    mix(fromB, toB, edge),
    mix(fromW, toW, edge),
    mix(fromA, toA, edge),   // SAME expression as W — matched inputs stay matched
    mix(fromU, toU, edge)
  );
}
```

**Where they live and what is valid.** Steady channel blends live in
`marsin_engine/patterns/channel_blends/`; scripted transitions live in
`marsin_engine/patterns/transitions/`. The mixer resolves a blend name by
looking in `channel_blends/` first, then `transitions/`
(`lib/pattern_mixer.js` `_compileBlend`). The API accepts exactly three steady
channel modes — **`blend_screen`, `blend_add`, `blend_over`**
(`VALID_CHANNEL_BLEND_MODES` in `lib/api_server.js`) — plus any `trans_*` name
transiently while a fade is in flight. Anything else is rejected with a 400.

---

## 11. Frame state, trails, and model portability

### 11.1 State persistence (HARD CONTRACT)

A compiled pattern is one long-lived VM instance. `beginFrame` does not wipe
script memory, so top-level `var`s and `array()`s retain their values across
frames — that single fact is the foundation of every feedback effect. State is
per-VM-instance and **resets on (re)compile**: loading the pattern, a live
edit, a deck/pattern swap, or a transition that instantiates a fresh background
buffer all re-run top-level init. Never assume a trail survives a pattern
change.

### 11.2 Model portability (HARD CONTRACT)

**`pixelCount` compiles to the literal `144`.** Verified by probe: a VM created
for 4, 144 and 964 pixels all report ~144 to the pattern. Never size a buffer
or compute an index with it.

**Do not hard-code the test-bench pixel count as if it were portable, either.**
The old guidance `var N = 144;` (or `52`) is a *test-bench* number. The Titanic
has **964 mapped pixels**. A model-sized array is therefore explicitly
model-specific and must say so:

```javascript
// MODEL-SPECIFIC: sized for titanic (964 mapped pixels). Re-size or use a
// scalar/spatial formulation before running this on another model.
var N = 964;
var buf = array(N);
```

**Prefer formulations that do not need a model-sized array at all:**

| Instead of | Use |
|---|---|
| a per-pixel history buffer | a **scalar decay envelope** gated by position (§12.1) |
| a per-pixel comet tail | a moving head plus `smoothstep(head + len, head, x)` in `render3D` — spatial, resolution-independent |
| ghosting an arbitrary pattern | the **`feedbackTrails` global effect** (§12.3) — whole-frame feedback with no pattern code at all |

Use a real per-pixel `array(N)` only when the effect genuinely needs
independent per-pixel memory, and then mark it model-specific.

---

## 12. Recipes (tutorial — below the normative contracts)

Everything from here down is worked examples. Nothing in this part is a
contract.

### 12.1 Scalar decay envelope — a pulse that fades

The cheapest trail: one persistent scalar, snapped to `1.0` on an event and
decayed each frame. This is the engine behind heartbeats, pings, and
searchlight afterglow — and it is **model-portable**, because it holds no
per-pixel state.

```javascript
export var localSpeed = 0.5;
export function sliderLocalSpeed(v) { localSpeed = v; }
export var fade = 0.5;                       // longer tail as this rises
export function sliderFade(v) { fade = v; }
export var cp1H = 0.0, cp1S = 1.0, cp1V = 1.0;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }

var clock = 0.0, env = 0.0, lastPhase = 0.0;

export function beforeRender(delta) {
  var localMult = pow(2.0, (localSpeed - 0.5) * 4.0);   // localSpeed ONLY (§3)
  var dt = (delta / 1310.72) * localMult;
  clock = clock + dt * 0.5;
  var phase = clock % 1.0;
  if (phase < lastPhase) env = 1.0;                     // fire on each wrap
  lastPhase = phase;
  env = env - dt * (1.5 + fade * 4.0);
  if (env < 0.0) env = 0.0;
}

export function render3D(index, x, y, z) {
  hsv(cp1H, cp1S, env * cp1V);
}
```

To make it travel instead of flashing globally, gate it by position: multiply
`env` by `smoothstep(headX + 0.1, headX, x)` where `headX = clock % 1.0`. That
version is still portable — no array, no `N`.

### 12.2 Per-pixel feedback buffer — a comet with a real tail

When the effect genuinely needs independent per-pixel memory. **Model-specific
by construction** (§11.2).

```javascript
export var localSpeed = 0.5;
export function sliderLocalSpeed(v) { localSpeed = v; }
export var tailLen = 0.6;
export function sliderTailLen(v) { tailLen = v; }
export var cp1H = 0.55, cp1S = 0.9, cp1V = 1.0;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }

// MODEL-SPECIFIC: titanic = 964 mapped pixels. pixelCount is a literal 144
// and cannot be used here (§11.2).
var N = 964;
var buf = array(N);                          // allocated once, in top-level init
var head = 0.0;

export function beforeRender(delta) {
  var localMult = pow(2.0, (localSpeed - 0.5) * 4.0);
  head = (head + (delta / 1310.72) * localMult * 0.25) % 1.0;
  var decay = 1.0 - (1.0 - (0.15 + tailLen * 0.8)) * 0.25;
  var k = 0;
  for (k = 0; k < N; k = k + 1) { buf[k] = buf[k] * decay; }   // O(N), once per frame
  buf[floor(head * N) % N] = 1.0;
}

export function render3D(index, x, y, z) {
  hsv(cp1H, cp1S, buf[index] * cp1V);
}
```

Variations from the same skeleton: inject at a fixed centre cell and read
`buf[abs(index - center)]` for a ripple; seed several cells with `random(1)`
and use a gentler decay for an ink-in-water bloom.

### 12.3 Mixer-level trails — ghost any pattern, no code

`marsin_engine/effects/feedbackTrails.js` is a **global effect** that keeps an
RGBWAU trail buffer of the *composited* output and mixes it back with
operator-tunable `decay`, `injection`, `mix`, `colorBleed`, and `blendMode`
(add / max / replace). This is the "ghost everything" knob, it is model-
agnostic, and it needs no pattern state at all. Reach for it before writing
§12.2.

> Filename note: this effect's source file is `feedbackTrails.js` — camelCase,
> which does not match the repo's `snake_case` filename convention. The link
> above is to the file as it actually exists; renaming it is a code change, not
> a documentation change.

### 12.4 Signal-to-visual patterns

The modulators-only contract (§8) enables a family of patterns where the look
is decomposed into a few well-named visual characteristics, each a plain
`slider*` a modulation can drive. The pattern never reads audio — it exposes
*handles*; the show wires a signal (an audio key, a hand fader, an LFO) onto
each handle. The same pattern is a calm idle at rest and a tightly audio-locked
instrument once mapped, with no code change.

Handles that tend to be worth exposing **when the look actually has them**:
*position* (where the effect sits), *width/size*, *energy/intensity*,
*persistence/trail*, *palette position*, *count*. Pick a small orthogonal set,
name them plainly, and give each a resting default that looks good with nothing
mapped.

`27_swipe` is the simplest member: a single sharp pixel sweeping a fixture,
with `swipePos` as the modulatable position, `swipeWidth`/`blur` as
size/softness, `trail` as persistence, `shift` to calibrate the zero point.
Its sharp core on a dark field is what makes each modulation of `swipePos` read
as a crisp, exact move — high contrast is what lets a signal show through
faithfully. That is a property of *this* pattern's design, not a rule for all
patterns (§1.6). Richer members of the same family (e.g.
`26_dom_dancers_chevron`) are gliding orbs whose position and energy are the
handles.

---

## 13. Verifying a pattern

Everything here is **offline** — no engine boot, no ports, no live audio.

- **Parameter truth harness** — `marsin_engine/tools/param_truth/`. Loads a
  pattern into the engine's own WASM VM, sweeps every declared `slider*` across
  its range, measures what actually changed in the rendered light, and checks
  that against what the control's name claims. Verdicts: `TRUE`, `DEAD`,
  `WRONG`, `WEAK`, `UNKNOWN_CLAIM`. **This is the tool that decides whether
  §1.1 holds.**

  ```bash
  cd marsin_engine
  node tools/param_truth/run_param_truth.mjs --pattern NN_name
  node tools/param_truth/sweep_all.mjs                    # full library
  ```

- **Audio harness + clips + gallery** — the end-to-end authoring loop lives in
  the skill [`.agent/skills/highdef_pattern_generation.md`](../.agent/skills/highdef_pattern_generation.md);
  publishing clips for phone review is
  [`.agent/skills/pattern_gallery.md`](../.agent/skills/pattern_gallery.md).
  Both are offline.

- **CI tests** — `marsin_engine/tests/patterns/white_amber_lane_match.test.js`
  (the §6.2 invariant), `param_truth_smoke.test.js` (harness properties),
  `specialty_white_uv.test.js`.

- **After any live engine boot**, the engine writes runtime state into tracked
  `marsin_engine/states/` files. That residue is expected — report it, do not
  silently revert it.

---

## 14. Related documents

- [`MARSIN_PB_LANG_SPEC.md`](MARSIN_PB_LANG_SPEC.md) — grammar, builtins,
  runtime semantics, model script formats.
- [`COLOR_THEORY.md`](COLOR_THEORY.md) — the five instruments, surface
  reflectance, palette guidance.
- [`13_model_v2.md`](13_model_v2.md) — model + view-mask contract.
- [`15_central_param_center_cpc.md`](15_central_param_center_cpc.md) — the CPC.
- [`19_playlists.md`](19_playlists.md) — playlist entries and modulation
  declarations.
- [`34_captainpad_midi.md`](34_captainpad_midi.md) — knob mapping and why
  declaration order matters.
- [`36_color_palette_live_transitions.md`](36_color_palette_live_transitions.md) — palette slew.
- [`39_channels_deck_mixer.md`](39_channels_deck_mixer.md) — channels, faders,
  blend modes.
- [`.agent/reports/202607/20260725_32_pattern_param_truth_sweep.md`](../.agent/reports/202607/20260725_32_pattern_param_truth_sweep.md)
  — the measurement this guide's §1 is built on.
