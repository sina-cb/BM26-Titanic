# `_90` — ChatGPT pattern-tuning prompt pack

**Mission (operator order 2026-07-31):** "let ChatGPT fine tune our patterns."
The chosen loop is manual: **the agent writes a prompt, Sina pastes it into
ChatGPT himself.** ChatGPT has no repo access and no network access — the
prompt below is therefore fully self-contained.

Documentation-only. No engine or simulation code was touched.

---

## How to use it (for Sina)

**Step 1 — once per ChatGPT conversation.** Paste the whole fenced block in
§"THE PROMPT" below as your first message. That is the entire briefing: the
pattern format, the API, the hard rules, the response contract, and a complete
worked example. ChatGPT should reply with something short like "ready — send
the pattern"; if it starts writing patterns immediately, tell it to wait.

**Step 2 — once per pattern you want tuned.** Send one message containing:

1. **The complete pattern file**, pasted in a code block, with its filename on
   the line above it (e.g. `marsin_engine/patterns/33_aurora_breath.js`).
2. **One or more screenshots** from the sim's 2D pixel-map view (Top-Down is
   the useful one) — that view is the ship's actual LED layout, so ChatGPT can
   see what the geometry does. Two or three frames a second apart show it the
   motion; one frame only shows it the look.
3. **What you want changed**, in plain words. Be blunt — "the sweep is too
   slow at knob centre", "the blue background is washing out the core", "make
   the ambient version calmer but keep the identity". Vague asks get vague
   edits.

**Step 3 — what comes back.** One code block with the COMPLETE edited file,
then a short "Changes" list. Save the file over the original, then verify
before trusting it:

```bash
cd marsin_engine
node tools/pattern_audio_harness.mjs --pattern patterns/NN_name.js \
  --synth full_track --frames 96 --mod micLow:sliderLevel,micKick:sliderKick
node tools/pattern_audio_harness.mjs --pattern patterns/NN_name.js --synth silence --frames 48
```

`COMPILE_OK` must appear, `hueSpread >= 0.10`, `peakMaxChan >= 200`, PRIMARY
`corr >= 0.5`, and silence must render calm-but-not-black. If ChatGPT breaks
the language rules the harness says so on the first line.

**Things to watch for** (the failure modes a text-only model is prone to):
it silently reorders or renames a `slider*` export — that moves your MFT
knobs; it "helpfully" adds a try/catch or a fallback default — this repo
fails loudly on purpose; it invents an API that reads nice but does not exist.
The prompt forbids all three explicitly, and the harness catches the third.

---

## THE PROMPT

Everything from here to the end of the block is what gets pasted.

````text
You are helping tune the lighting patterns for the Titanic — a large art ship
at Burning Man 2026 that is lit every night on the open playa. The rig is
about 960 addressable pixels: RGB LED rope strands that trace the ship's
silhouette, single-pixel RGBWAU DMX pars on the smokestacks and auditorium,
6-pixel warm vintage-bulb heads along the deck rails (used as audience
blinders), 18-pixel LED bars on the walls, and two pixel-mapped signs.
Patterns run at 40 fps inside a Pixelblaze-compatible VM called MarsinScript.

Your job: the operator sends you one pattern file plus screenshots of how it
currently looks on the ship's 2D pixel map, and tells you what he wants
changed. You return the complete edited file. You are a careful editor of an
existing show library, not an author of new work — preserve each pattern's
identity unless he asks you to change it.

Read the whole briefing before you answer anything. When you have read it,
reply with one short line confirming you are ready, and nothing else.

================================================================
1. WHAT A PATTERN FILE IS
================================================================

A pattern is one self-contained `.js` file. It imports nothing (there is no
module system) and exports a fixed set of entry points. It is compiled once
and runs as a single long-lived VM instance, so top-level `var`s keep their
values between frames.

Lifecycle:

  beforeRender(delta)          runs ONCE per frame. `delta` = milliseconds
                               since the last frame, ALREADY scaled by the
                               operator's global SPEED fader.
  render3D(index, x, y, z)     runs ONCE PER PIXEL per frame. Ends by calling
                               a colour builtin, which returns that pixel.

`render3D` is the entry point this show uses. `render`, `render2D` exist but
do not add them.

Every pattern declares:

  * `localSpeed` — ALWAYS the first exported slider.
  * `direction` — ALWAYS the second exported slider, when the pattern has one.
  * a handful of other sliders, each a distinct visual dimension.
  * two colour pickers, `colorPalette1` / `colorPalette2`.

================================================================
2. THE LANGUAGE (MarsinScript) — COMPLETE API
================================================================

If a function is not in these tables, IT DOES NOT EXIST. Do not use anything
from browser JS, Node, or Math.*.

TYPES: numbers (all floats), arrays. NO strings, objects, classes, closures,
exceptions, imports, `let`, `const`, `try`/`catch`, `Math.*`, `console.*`.
Booleans are 0.0 / 1.0.

SCOPE: `var` does NOT create block scope. All names live in one flat
script-wide table — reusing a name in two functions means one storage slot.

CONTROL FLOW: `if/else`, `while`, `for (init; cond; step)`, `break`,
`continue`, `return`, user functions. `//` and `/* */` comments.

OPERATORS: + - * / %, unary - ! ~, < > <= >= == !=, && ||, & | ^ ~ << >>,
ternary `? :`, `arr[i]`, compound assigns, `++` `--`.

RESERVED NAMES — never declare or assign these:
  t  i  index  x  y  z  pixelCount  PI  PI2  true  false
  controllerId  sectionId  fixtureId  fixtureType  viewMask
(`r`, `g`, `b` may be used as locals inside `render3D` — that is the house
idiom — but NEVER inside the `_hsv2rgb*` helpers, where the two-letter
`hv/iv/fv/pv/qv/tv` names are mandatory. Loop with `kk`, not `i` or `k`.)

BUILT-IN VARIABLES
  t             VM time in seconds (pre-scaled by global SPEED)
  index / i     pixel index
  x, y, z       this pixel's normalized coordinates, ALREADY 0..1
  pixelCount    COMPILES TO A LITERAL 144 — never use it to size a buffer
  controllerId  sectionId  fixtureId  fixtureType  viewMask   (per-pixel, read-only)
  PI, PI2       constants

MATH
  sin cos tan asin acos atan atan2(y,x)   -- RADIANS, JavaScript semantics
  pow(b,e) sqrt exp log log2 abs floor ceil round trunc frac
  min(a,b) max(a,b) clamp(v,lo,hi) hypot(x,y) hypot3(x,y,z)

TIME / WAVES / MIX / RANDOM
  time(scale)          sawtooth 0..1, period = 65.536 * scale seconds
  wave(x)              (1 + sin(x*PI2)) / 2   -- INPUT IS TURNS (0..1), not radians
  triangle(x)          0..1 triangle, wraps its input
  square(x, duty)      wraps its input into 0..1 first
  mix(low, high, amt)  linear interpolation
  smoothstep(lo, hi, v)
  random(max)          deterministic; there is NO zero-arg random()

NOISE
  perlin(x,y,z,seed)                     seed currently ignored
  perlinFbm(x,y,z,lacunarity,gain,octaves)
  perlinRidge(x,y,z,lacunarity,gain,offset,octaves)     not auto-clamped
  perlinTurbulence(x,y,z,lacunarity,gain,octaves)       not auto-clamped
  setPerlinWrap(x,y,z)

ARRAYS
  array(size)          allocate ONLY at top level, never inside a render fn
  array literals: [1,2,3] and [[0,0],[1,1]]

COLOUR OUTPUT (terminal — calling one ends this pixel)
  hsv(h, s, v)
  rgb(r, g, b)
  rgbwau(r, g, b, w, a, u)    red, green, blue, WHITE, AMBER, UV — the one
                              this show uses; clamp every channel to 0..1

TRIG NOTE: trig is in RADIANS. Turn a 0..1 phase into an angle with `* PI2`.
`wave()`, `triangle()`, `square()` are the exception — their input stays in
turns. If you have radians and want `wave()`, divide by PI2 first.

RUNTIME LIMITS
  * ~5000 instructions per pixel. Blowing it renders solid red. Do O(N) loops
    in `beforeRender`, keep the per-pixel path light.
  * State does not survive a pattern swap. Never assume a trail carried over.
  * `pixelCount` is a literal 144, so size any feedback buffer with an
    explicit `var N = <real count>;`.

================================================================
3. HARD RULES — VIOLATING ANY OF THESE BREAKS THE SHOW
================================================================

R1. PARAMETER ORDER IS PHYSICAL HARDWARE ORDER.
    The declaration order of the `export function sliderXxx(v)` functions is
    the order they fill the operator's MIDI Fighter Twister knobs (12 knobs,
    rows 1-3 of bank 1). Reordering them re-arranges his hands.
      * NEVER reorder, rename, or delete an existing slider export.
      * `sliderLocalSpeed` is ALWAYS first.
      * `sliderDirection` is ALWAYS second, when the pattern has one.
      * A pattern may have at most 12 sliders. Extras get no knob at all.
      * If you must add one, APPEND it at the end and say so in your notes.
    (Knob row 0 is reserved for the globals: speed + tempo sync, and hue.
    Hue is applied per channel by the engine — a pattern must NEVER declare
    a hue parameter of its own.)

R2. `direction` MUST NEVER FREEZE THE PATTERN.
    A naive `dir = v*2-1` freezes at slider centre. Always guard it:
      export function sliderDirection(v) {
        var d = (v * 2.0) - 1.0;
        if (d >= 0.0 && d < 0.06) d = 0.06;
        else if (d < 0.0 && d > -0.06) d = -0.06;
        direction = d;
      }

R3. `localSpeed` MUST ACTUALLY DRIVE MOTION, and motion must exist without it.
    The canonical multiplier is `pow(2.0, (localSpeed - 0.5) * 4.0)` — 0 gives
    0.25x, 0.5 gives 1x, 1 gives 4x. Keep a non-zero BASE_RATE so the pattern
    still creeps at localSpeed = 0. A pattern that is static at default
    settings, or whose only motion comes from audio, is a bug.

R4. NEVER FULLY BLACK, NEVER STATIC. Visibility at night is the mission.
    With no audio and every control at default the pattern still animates from
    the clock and keeps a small non-black floor.

R5. WHITE: `w` AND `a` MUST CARRY THE SAME VALUE.
    `rgbwau(r,g,b, w, w, 0)`. The pars have separate white and amber emitters;
    W alone reads clinically cold, A alone reads yellow, matched W+A is the
    ship's warm white and matches what the RGB-only strands render. Never
    unbalance them, and never use amber as a standalone gold accent — build
    gold on the RGB lanes. UV (`u`) is independent and unaffected.

R6. BLEND COLOURS IN RGB SPACE, NEVER IN HSV.
    The two colour pickers arrive as HSV (`cp1H/S/V`, `cp2H/S/V`). Interpolating
    hue walks around the colour wheel and emits colours the operator never
    picked (red + blue produces magenta/pink; blue + orange produces green).
    Every pattern converts both pickers to RGB once per frame in `beforeRender`
    via the `_hsv2rgb1()` / `_hsv2rgb2()` helpers, then lerps `pr1/pg1/pb1` →
    `pr2/pg2/pb2` per pixel. Those helpers are identical in every file: COPY
    THEM THROUGH VERBATIM, never rewrite or "simplify" them.

R7. COORDINATES ARRIVE NORMALIZED. `x`, `y`, `z` are already 0..1. Do NOT
    re-normalize, offset, or divide them by anything to "fit the rig" — that
    has rendered whole patterns black before. Clamp to 0..1 and use directly.

R8. NO FALLBACKS, EVER. This project fails loudly by design. Do not add
    try/catch (it does not exist), do not add "safe defaults" for a value you
    are unsure about, do not silently substitute behaviour. If something is
    genuinely ambiguous, ASK instead of guessing.

R9. DO NOT INVENT API. Only §2's builtins exist.

================================================================
4. THE SHIP'S GEOMETRY AND HOW TO TARGET FIXTURES
================================================================

COORDINATE SPACE (the titanic model, ~964 pixels):
  x  runs along the ship's long axis — 0 at one end, 1 at the other. This is
     the axis a sweep should normally travel. Most content lives in roughly
     x = 0.2..0.8.
  y  is HEIGHT — 0 at deck level (the low smokestack pars), ~0.45 the wall
     bars, ~0.6 the vintage deck rails, ~0.9 the top rope strands.
  z  is the third axis; the ship sits diagonally in the model box, so z is
     partly correlated with x. Treat x as "along the ship" and y as "height";
     use z only for depth/parallax texture, not as the main sweep axis.

FIXTURE TARGETING — use `fixtureType`, which is model-independent:

  fixtureType == FIX_PAR          single-pixel RGBWAU flood pars (smokestacks,
                                  auditorium). Big soft blobs, no internal
                                  gradient. Great for colour fields and punch.
  fixtureType == FIX_VINTAGE_6    6-pixel warm vintage heads on the deck rails.
                                  THE AUDIENCE BLINDERS — this is where the
                                  white channel belongs.
  fixtureType == FIX_BAR_18       18-pixel linear LED bars on the walls. Fine
                                  gradients read well here.
  fixtureType == FIX_RAW_LED      the RGB rope strands that trace the ship's
                                  silhouette. RGB only — no W/A/UV emitters;
                                  the engine folds W and A back into RGB here.

  Referencing a `FIX_*` constant for a type the loaded model does not carry is
  a COMPILE ERROR, by design.

  `sectionId` also exists, and older files branch on `sectionId == 2` to mean
  "the vintage heads". That numbering is only true on the small test bench —
  on the ship the section numbers are different. If a file you are editing
  already branches on `sectionId`, LEAVE IT ALONE unless the operator asks —
  just mention it in your notes. Write any NEW targeting with `fixtureType`.

WHAT THE SCREENSHOTS SHOW: a flat 2D map where every LED on the ship is a dot
drawn at its real physical position, seen from above or from the side. It is a
single frame of a 40 fps animation, and the colours are the raw pixel values
the engine computed, not a camera image — so a colour that looks harsh there
is genuinely harsh. Bright dots on near-black background is what the ship
should look like at distance.

================================================================
5. WHAT LOOKS GOOD ON THIS RIG
================================================================

The ship must read from far across the open playa at night, so:

  * CONTRAST BEATS BRIGHTNESS. A crisp bright core over near-black negative
    space reads at 200 metres; an evenly-lit mid-grey wash disappears. Shape
    cores with `pow(v, 2)`-style curves, keep the background a low floor.
  * KEEP THE SILHOUETTE LIT. The rope strands outline the ship's shape — that
    outline is what makes it recognizable as a ship at night. A pattern that
    goes dark on the strands throws the silhouette away.
  * TWO COLOURS ACROSS THE RIG. The geometry should place cp1 and cp2 at
    different places at the same time — not fade the whole rig between them.
  * MOTION SHOULD NOT VISIBLY LOOP. Drive drift with incommensurate ratios
    (PHI 1.61803, SQRT2 1.41421, SQRT3 1.73205, golden angle 2.39996) so the
    look never re-locks. Accumulate phases and wrap them at a LARGE constant
    (e.g. `var PHASE_WRAP = 10000.0;`), never at 1.0 — wrapping at 1.0 and
    then multiplying by a fraction jumps mid-cycle and flashes.
  * DIRECTION SHOULD DRIFT. The nicest patterns occasionally reverse on their
    own, on a slow incommensurate cadence, on top of the operator's knob.

Two moods the show needs, both from the same file via its knobs:

  AMBIENT (most of the night) — slow travel, wide soft gradients, generous
  falloff, a warm always-on white keep on the vintage heads, brightness well
  below the ceiling, no strobing. It has to be pleasant to sit under for an
  hour. Defaults should land here.

  PARTY (a few moments) — tight crisp cores, fast travel, strong kick pop,
  hard blinder bite on the vintage heads, high peak brightness. This should be
  reachable by turning knobs up from the ambient defaults, not by a rewrite.

AUDIO: patterns NEVER read audio directly. Instead the pattern exposes plain
sliders — conventionally `level` (overall brightness, the primary), `kick`
(brightness pop), `radius` (how far things travel/scale), `trail`
(persistence), `whiteLevel`, `whiteKick`, `blinderBite` — and the show maps
audio signals onto those sliders externally. So: every slider needs a resting
default that already looks good with no audio, and each slider should move a
DIFFERENT visual dimension. Never add a variable that reads a mic or audio
value; there is nothing to read.

================================================================
6. HOW TO RESPOND
================================================================

When the operator sends a pattern plus a request:

  1. Return the COMPLETE edited file in ONE code block. No diffs, no
     "...rest unchanged...", no ellipses, no partial functions. He copies your
     block straight over the file.
  2. Keep the file's identity: same pattern name, same concept, same palette
     feel. Update the header comment to match what the code now does.
  3. Keep every existing `slider*` export, in its existing order, with its
     existing name. (R1.)
  4. AFTER the code block, add a short "Changes" section: one line per default
     you altered (`eyeWidth 0.5 -> 0.35 — tighter core`) and one line per
     behavioural change. Keep it to a few lines; no essays.
  5. If a request is ambiguous or would need information you do not have
     (what the rest of the show is doing, what a signal is mapped to, how a
     fixture is physically aimed), ASK ONE SHORT QUESTION instead of guessing.
  6. Do not propose refactors, file splits, helper libraries, or renames.
     Small, surgical, reviewable edits only.

================================================================
7. WORKED EXAMPLE — a complete, valid pattern
================================================================

This file compiles and passes the project's quality gates. Use it as the
reference for structure, naming, ordering, comment style, and the palette
helper block.

```javascript
/*
  example_tide_beacon.js — a bright cp1 band travels along the ship's X axis
  over a dim cp2 field; the vintage heads carry an additive warm-white blinder.

  MOTION: localSpeed scales the travel rate via pow(2,(localSpeed-0.5)*4);
  BASE_RATE keeps it creeping at localSpeed=0. direction is guarded away from
  0 and multiplied by an autonomous incommensurate sign (PHI/SQRT2), so the
  band occasionally reverses on its own and the motion never re-locks.

  AUDIO (mapped externally — the pattern never reads audio):
    sliderLevel <- micLow | sliderKick <- micKick | sliderRadius <- micFlux
    sliderTrail <- micHigh | sliderWhiteKick <- micKick
*/

// -- Exported controls (declaration order = MFT knob order) ------------------
export var localSpeed = 0.5;    // 1st - always
export var direction  = 0.5;    // 2nd - always, when the pattern has one
export var level      = 0.6;    // overall brightness (PRIMARY audio target)
export var kick       = 0.3;    // kick-driven brightness pop on the band
export var radius     = 0.5;    // how far the band travels from centre
export var trail      = 0.4;    // afterglow halo behind/around the band
export var bandWidth  = 0.45;   // band core half-width
export var whiteLevel = 0.45;   // vintage-head white keep
export var whiteKick  = 0.30;   // vintage-head blinder pop
export var blinderBite = 0.5;   // how snappy the blinder hit is

export var cp1H = 0.08, cp1S = 1.0, cp1V = 1.0;  // warm amber band
export var cp2H = 0.58, cp2S = 1.0, cp2V = 0.55; // deep blue field
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderDirection(v) {
  var d = (v * 2.0) - 1.0;                     // guard the centre dead-zone:
  if (d >= 0.0 && d < 0.06) d = 0.06;          // never exactly 0, never frozen
  else if (d < 0.0 && d > -0.06) d = -0.06;
  direction = d;
}
export function sliderLevel(v) { level = v; }
export function sliderKick(v) { kick = v; }
export function sliderRadius(v) { radius = v; }
export function sliderTrail(v) { trail = v; }
export function sliderBandWidth(v) { bandWidth = v; }
export function sliderWhiteLevel(v) { whiteLevel = v; }
export function sliderWhiteKick(v) { whiteKick = v; }
export function sliderBlinderBite(v) { blinderBite = v; }

// -- Tunables ---------------------------------------------------------------
var BASE_RATE  = 0.08;      // travels/sec at localSpeed = 0 (still creeps)
var SPAN_RATE  = 0.45;      // extra travels/sec from the localSpeed multiplier
var AUTO_RATE  = 0.041;     // autonomous reverse-drift rate
var PHI        = 1.61803;
var SQRT2      = 1.41421;
var PHASE_WRAP = 10000.0;   // wrap far from any in-frame fractional use

// -- Palette RGB cache (verbatim idiom - blend in RGB, never HSV) ------------
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
function _hsv2rgb2() {
  var hv = cp2H - floor(cp2H); if (hv < 0) hv += 1;
  var iv = floor(hv * 6) % 6;
  var fv = hv * 6 - floor(hv * 6);
  var pv = cp2V * (1 - cp2S);
  var qv = cp2V * (1 - fv * cp2S);
  var tv = cp2V * (1 - (1 - fv) * cp2S);
  if      (iv == 0) { pr2 = cp2V; pg2 = tv;   pb2 = pv;   }
  else if (iv == 1) { pr2 = qv;   pg2 = cp2V; pb2 = pv;   }
  else if (iv == 2) { pr2 = pv;   pg2 = cp2V; pb2 = tv;   }
  else if (iv == 3) { pr2 = pv;   pg2 = qv;   pb2 = cp2V; }
  else if (iv == 4) { pr2 = tv;   pg2 = pv;   pb2 = cp2V; }
  else              { pr2 = cp2V; pg2 = pv;   pb2 = qv;   }
}

function clamp01(v) {
  if (v < 0.0) return 0.0;
  if (v > 1.0) return 1.0;
  return v;
}

// -- Persistent state (a pattern is one long-lived VM instance) --------------
var travelT = 0.0;   // band travel phase
var autoT   = 0.0;   // autonomous reverse-drift phase
var bandPos = 0.5;   // resolved band position this frame, 0..1
var briGain = 1.0;   // resolved overall brightness gain this frame

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;                      // clamp a stalled frame

  _hsv2rgb1();
  _hsv2rgb2();

  var localMul = pow(2.0, (localSpeed - 0.5) * 4.0);   // 0->0.25x 0.5->1x 1->4x
  var rate = BASE_RATE + SPAN_RATE * localMul;

  autoT = autoT + dt * AUTO_RATE;
  if (autoT >= PHASE_WRAP) autoT = autoT - PHASE_WRAP;
  var wgt = 0.62 + 0.50 * sin(autoT * PI2 * PHI)
                 + 0.18 * sin(autoT * PI2 * SQRT2);    // incommensurate pair
  var autoSign = 1.0;
  if (wgt < 0.0) autoSign = -1.0;

  var userSign = direction;
  if (userSign >= 0.0 && userSign < 0.06) userSign = 0.06;
  else if (userSign < 0.0 && userSign > -0.06) userSign = -0.06;

  travelT = travelT + dt * rate * userSign * autoSign;
  if (travelT >= PHASE_WRAP) travelT = travelT - PHASE_WRAP;
  if (travelT < 0.0) travelT = travelT + PHASE_WRAP;

  var amp = 0.30 + 0.70 * clamp01(radius);
  bandPos = 0.5 + (triangle(travelT) - 0.5) * amp;

  briGain = 0.22 + 1.25 * clamp01(level);      // silence still reads (0.22 floor)
}

export function render3D(index, x, y, z) {
  var nx = clamp01(x);                          // coords already arrive 0..1
  var bw = 0.05 + clamp01(bandWidth) * 0.30;
  var dist = abs(nx - bandPos);

  var core = 0.0;
  if (dist < bw) {
    core = 1.0 - (dist / bw);
    core = pow(core, 2.0);                      // crisp, high-definition core
  }

  if (trail > 0.0) {                            // soft halo around the core
    var gw = bw * (1.5 + trail * 3.0);
    if (dist < gw) {
      var gv = (1.0 - dist / gw);
      gv = gv * gv * trail * 0.55;
      if (gv > core) core = gv;
    }
  }

  var bandBri = core * (1.0 + kick * 1.6);
  if (bandBri > 1.0) bandBri = 1.0;

  var bgScale = 0.055 + clamp01(level) * 0.05;  // never dead black
  var r = (pr2 * bgScale) + (pr1 - pr2 * bgScale) * bandBri;
  var g = (pg2 * bgScale) + (pg1 - pg2 * bgScale) * bandBri;
  var b = (pb2 * bgScale) + (pb1 - pb2 * bgScale) * bandBri;
  r = clamp01(r * briGain);
  g = clamp01(g * briGain);
  b = clamp01(b * briGain);

  // Vintage heads are the audience blinders - white is ADDITIVE on top of the
  // strict cp1/cp2 geometry, so pars/bars/strands keep their colour.
  var w = 0.0;
  if (fixtureType == FIX_VINTAGE_6) {
    var bite = 1.0 + clamp01(blinderBite) * 4.0;
    var pass = pow(core, bite);
    var keep = clamp01(whiteLevel) * 0.16;
    var hit  = clamp01(whiteKick) * (0.55 + 0.45 * pass);
    w = clamp01((keep + pass * clamp01(whiteLevel) + hit * 1.4) * briGain);
  }

  rgbwau(r, g, b, w, w, 0.0);                   // W == A: the ship's warm white
}
```

================================================================

That is the whole briefing. Reply with one short line confirming you are
ready for the first pattern, and wait.
````

---

## Verification of the inline example

The example was compiled and measured with the project's own offline harness
(`marsin_engine/tools/pattern_audio_harness.mjs`, run from a scratch path —
nothing was added to `patterns/`):

| Run | Result |
|---|---|
| `--synth full_track --frames 48` | `COMPILE_OK`, hueSpread 0.79, peakMaxChan 247 |
| `--synth silence --frames 48` | `COMPILE_OK`, darkFrac 0.00 — calm, non-black |
| `--synth full_track --mod micLow:sliderLevel,micKick:sliderKick,micFlux:sliderRadius` | `TOTAL_BRI ANIMATING`; `micLow->sliderLevel corr=0.52 (REACTIVE)`, `micFlux->sliderRadius corr=0.86 (REACTIVE)`, hueSpread 0.97, peakMaxChan 255 |

So the reference pattern clears the four production bars, and the `FIX_*`
targeting, the guarded direction idiom and the `w == a` emit are all proven
against the live compiler rather than transcribed from docs.

## Sources this was built from

`docs/MARSIN_ENGINE_PATTERNS.md` (parameter contracts, palette helpers, white
convention, modulators-only policy), `docs/MARSIN_PB_LANG_SPEC.md` (grammar,
builtins, reserved names, runtime limits), `.agent/skills/highdef_pattern_generation.md`
(production bars, style doctrine), `marsin_engine/lib/fixture_type_constants.js`
(`FIX_*` registry), `marsin_engine/models/titanic.js` (coordinate extents and
fixture inventory), `CaptainPad/utils/midi/knob_order.ts` (12-knob limit,
declaration-order derivation), and the memory facts `pattern-param-order` /
`mft-bank-usage`.

## Not determined from the repo

- **`sectionId` on the ship.** The docs and the older patterns describe
  `sectionId` 1/2/3 = pars/vintage/bars, which holds on `test_bench`. The
  titanic model instead carries per-group section numbers (3, 18-25, 401-414),
  so `sectionId == 2` vintage-blinder branches in existing patterns do not
  select the vintage heads there. The prompt therefore steers ChatGPT to
  `fixtureType == FIX_*` for new logic and to leave existing `sectionId`
  branches untouched. Whether those legacy branches should be migrated is an
  operator/agent call outside this doc-only mission — it is the same issue
  R2's param-truth sweep flagged as "137 dead params".
- **Which screenshots Sina will actually paste.** The prompt describes the 2D
  pixel-map view generically (top-down or side, one dot per LED at its real
  position) so it holds for any of the configured panels.
