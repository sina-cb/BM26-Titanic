/*
  12_breathing.js
  HD Synchronized Breathing — the whole rig inhales/exhales together with a
  slow, organic swell. Exhale = cp1, inhale crest = cp2 (now blended in RGB
  space so the breath never traverses off-palette hues). A spatial ripple lets
  the breath travel across the rig instead of pulsing in lockstep.

  Identity kept: one shared breath wave, cp1->cp2 color shift over the cycle,
  ripple + sharpness controls. Now HD, render3D, audio-reactive, never static.
  Default palette is a calm warm-exhale -> cool-inhale meditative pair (both
  picker-overridable) so the rig genuinely spans two hues (hueSpread gate).

  CORE NON-REPEATING MATH (skill 12 §3/§7):
    The breath is the SUM of two wave() oscillators whose periods are in the
    irrational ratio φ (1.61803), so the combined swell never re-locks. A third,
    golden-angle ripple phase carries the breath spatially. All phases accumulate
    against a large PHASE_WRAP to avoid wrapped-then-scaled seams.

  SPEED / DIRECTION:
    localSpeed scales every phase via rate = pow(2,(localSpeed-0.5)*4). At 0 the
    breath still creeps; at 1 it is ~4x. `direction` (guarded off center) sets
    which way the ripple travels; an autonomous incommensurate clock (~73s)
    occasionally reverses it on its own so it feels alive.

  AUDIO (modulators-only — never read CPC audio globals natively):
  AUDIO_MODULATION_V1:
    sliderLevel      <- micLow  range 0.30..1.00 curve linear  # PRIMARY overall brightness (bass)
    sliderKick       <- micKick range 0.00..1.00 curve pow2    # breath-peak brightness pop
    sliderRadius     <- micFlux range 0.40..0.90 curve linear  # how far the breath swells/travels
    sliderDepth      <- micMid  range 0.30..0.85 curve linear  # inhale depth (cp2 reach)
    sliderWhiteKick  <- micKick range 0.00..1.00 curve pow2    # white spark on inhale + vintage blinder
    sliderWhiteLevel <- micLow  range 0.30..0.90 curve linear  # overall white amount / keep
  # static (unmapped): direction, spatialOffset, sharpness, blinderBite, palette pickers
  White is ADDITIVE over the strict cp1/cp2 breath: a crisp white SPARK rides the
  inhale crest across the whole rig, and the vintage heads (sectionId==2) carry a
  gentle, kick-gated white BLINDER that swells on the inhale. blinderBite shapes
  how snappy that swell hits. White never washes the rig (hueSpread stays high).
*/

// ── Exported controls (UI order = declaration order) ─────────────────────────
export var localSpeed = 0.5;   // master motion rate
export var direction = 0.5;    // ripple travel direction (0.5 = guarded center)
export var level = 1.0;        // AUDIO: overall brightness (PRIMARY)
export var kick = 0.0;         // AUDIO: breath-peak brightness pop
export var radius = 0.5;       // AUDIO: breath swell / travel distance
export var depth = 0.5;        // AUDIO: inhale depth (how far toward cp2)
export var spatialOffset = 0.5;// breath ripple spread across the rig
export var sharpness = 0.4;    // breath crest sharpness (lower = fuller, softer
                               // breath = the calm meditative identity; high
                               // values crush the crest, so default sits below 0.5)
export var whiteLevel = 0.45;  // WHITE: overall white amount / keep (audio: micLow)
export var whiteKick = 0.0;    // WHITE: white spark on inhale + blinder pop (audio: micKick)
export var blinderBite = 0.6;  // WHITE: how snappy the vintage-head blinder swell hits

export var cp1H = 0.02, cp1S = 1.0, cp1V = 1.0; // Exhale (warm red)
export var cp2H = 0.50, cp2S = 1.0, cp2V = 1.0; // Inhale (calm cyan)
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderDirection(v) { direction = v; }
export function sliderLevel(v) { level = v; }
export function sliderKick(v) { kick = v; }
export function sliderRadius(v) { radius = v; }
export function sliderDepth(v) { depth = v; }
export function sliderRipple(v) { spatialOffset = v; }
export function sliderSharpness(v) { sharpness = v; }
export function sliderWhiteLevel(v) { whiteLevel = v; }
export function sliderWhiteKick(v) { whiteKick = v; }
export function sliderBlinderBite(v) { blinderBite = v; }

// ── Tunables ─────────────────────────────────────────────────────────────────
var MAX_RATE = 0.5;          // base breaths/sec at localSpeed = 1.0
var PHASE_WRAP = 10000.0;
var AUTO_PERIOD = 73.0;      // seconds for autonomous direction oscillation
var BASE_FLOOR = 0.06;       // small non-black floor

// ── Palette RGB cache (verbatim from 27_swipe) ───────────────────────────────
var pr1 = 1, pg1 = 0, pb1 = 0;
var pr2 = 0, pg2 = 0, pb2 = 1;
function _hsv2rgb1() {
  var hv = cp1H - floor(cp1H); if (hv < 0) hv += 1;
  var iv = floor(hv * 6) % 6;
  var fv = hv * 6 - floor(hv * 6);
  var pv = cp1V * (1 - cp1S);
  var qv = cp1V * (1 - fv * cp1S);
  var tv = cp1V * (1 - (1 - fv) * cp1S);
  if      (iv == 0) { pr1 = cp1V; pg1 = tv;    pb1 = pv;    }
  else if (iv == 1) { pr1 = qv;    pg1 = cp1V; pb1 = pv;    }
  else if (iv == 2) { pr1 = pv;    pg1 = cp1V; pb1 = tv;    }
  else if (iv == 3) { pr1 = pv;    pg1 = qv;    pb1 = cp1V; }
  else if (iv == 4) { pr1 = tv;    pg1 = pv;    pb1 = cp1V; }
  else             { pr1 = cp1V; pg1 = pv;    pb1 = qv;    }
}
function _hsv2rgb2() {
  var hv = cp2H - floor(cp2H); if (hv < 0) hv += 1;
  var iv = floor(hv * 6) % 6;
  var fv = hv * 6 - floor(hv * 6);
  var pv = cp2V * (1 - cp2S);
  var qv = cp2V * (1 - fv * cp2S);
  var tv = cp2V * (1 - (1 - fv) * cp2S);
  if      (iv == 0) { pr2 = cp2V; pg2 = tv;    pb2 = pv;    }
  else if (iv == 1) { pr2 = qv;    pg2 = cp2V; pb2 = pv;    }
  else if (iv == 2) { pr2 = pv;    pg2 = cp2V; pb2 = tv;    }
  else if (iv == 3) { pr2 = pv;    pg2 = qv;    pb2 = cp2V; }
  else if (iv == 4) { pr2 = tv;    pg2 = pv;    pb2 = cp2V; }
  else             { pr2 = cp2V; pg2 = pv;    pb2 = qv;    }
}

function clamp01(v) {
  if (v < 0.0) return 0.0;
  if (v > 1.0) return 1.0;
  return v;
}

// ── Persistent state ─────────────────────────────────────────────────────────
var breathA = 0.0;    // primary breath phase
var breathB = 0.0;    // secondary breath phase (period in φ ratio)
var ripple = 0.0;     // spatial ripple phase
var autoClock = 0.0;
var effDir = 1.0;
var localMul = 1.0;

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  localMul = pow(2.0, (localSpeed - 0.5) * 4.0);

  var manDir = (direction * 2.0) - 1.0;
  if (manDir >= 0.0 && manDir < 0.06) manDir = 0.06;
  else if (manDir < 0.0 && manDir > -0.06) manDir = -0.06;

  autoClock = autoClock + dt;
  if (autoClock >= PHASE_WRAP) autoClock = autoClock - PHASE_WRAP;
  var autoSign = (sin(autoClock / AUTO_PERIOD * PI2) >= 0.0) ? 1.0 : -1.0;
  effDir = manDir * autoSign;

  breathA = breathA + dt * localMul * MAX_RATE;
  breathB = breathB + dt * localMul * MAX_RATE * 1.61803;
  ripple = ripple + dt * localMul * MAX_RATE * 0.41 * effDir;
  if (breathA >= PHASE_WRAP) breathA = breathA - PHASE_WRAP;
  if (breathB >= PHASE_WRAP) breathB = breathB - PHASE_WRAP;
  if (ripple >= PHASE_WRAP) ripple = ripple - PHASE_WRAP;
  else if (ripple <= -PHASE_WRAP) ripple = ripple + PHASE_WRAP;

  _hsv2rgb1();
  _hsv2rgb2();
}

export function render3D(index, x, y, z) {
  var pct = clamp01(x);
  var pcy = clamp01(y);

  // Spatial ripple carries the breath across the rig (radius widens travel).
  var spread = spatialOffset * 2.0 * (0.5 + radius);
  var rip = pct * spread + pcy * spread * 0.4 + ripple * 0.3;

  // Shared breath = sum of two φ-ratio oscillators (non-repeating swell). It is
  // a TRAVELLING swell across the rig: as the crest moves, some pixels brighten
  // while others dim, so the rig visibly "breathes/ripples" yet total brightness
  // stays roughly constant — leaving the level gain (PRIMARY) as the dominant
  // total-brightness driver (animation wobble in total kills corr, skill §5).
  var bA = wave(breathA * 0.2 + rip);
  var bB = wave(breathB * 0.2 + rip * 0.6);
  var breath = bA * 0.6 + bB * 0.4;

  // Sharpen the travelling crest; sharpness slider controls definition.
  var sharp = 1.0 + sharpness * 7.0;
  var breathV = pow(breath, sharp);

  // A high spatial-contrast crest (crisp lit core, dim troughs) that AVERAGES to
  // a near-constant rig sum as it travels. Kick adds a per-pixel pop; the level
  // gain (PRIMARY) scales the whole rig. Computed in ONE expression — repeated
  // `v = v * ...` reassignment of a single-letter local mis-compiles on the VM.
  // PRIMARY: level^2 gain (matching 16/17) makes micLow the DOMINANT total-
  // brightness driver (corr>=0.5); the traveling breath is the spatial texture
  // and kick only a small per-pixel pop, so neither swamps the bass correlation.
  var crestBri = 0.40 + breathV * 0.62 + kick * 0.14;
  if (crestBri > 1.0) crestBri = 1.0;
  var levelGain = 0.12 + level * level * 2.2;
  var bri = clamp01((BASE_FLOOR + crestBri * (1.0 - BASE_FLOOR)) * levelGain);

  // Inhale pushes toward cp2; a mostly-standing spatial gradient guarantees both
  // palette ends are present across the rig at once, kept nearly time-stable so
  // total brightness tracks `level` (PRIMARY), not the cp1/cp2 luminance gap.
  var grad = clamp01(pct * 0.6 + pcy * 0.4);
  grad = grad + 0.08 * wave(pct * 1.1 + pcy * 0.6 + ripple * 0.15) - 0.04;
  var tcol = clamp01(grad * 0.9 + depth * 0.1);
  var r = (pr1 + (pr2 - pr1) * tcol) * bri;
  var g = (pg1 + (pg2 - pg1) * tcol) * bri;
  var b = (pb1 + (pb2 - pb1) * tcol) * bri;

  // WHITE — additive over the cp1/cp2 breath, controllable via white_* sliders.
  // A crisp white SPARK rides the inhale crest across the whole rig: it tracks
  // breathV (so it appears at the breath peak), is scaled by whiteLevel (overall
  // amount) and popped by whiteKick (the inhale white pop), and stays coupled to
  // the PRIMARY level so it never lights up in silence-with-no-level.
  var wAmt = clamp01(whiteLevel);
  var wKick = clamp01(whiteKick);
  var sparkCore = pow(breathV, 2.0);
  var spark = sparkCore * (0.25 + 0.75 * wAmt) * (0.4 + wKick * 1.1) * (0.10 + level * level * 0.95);

  var w = spark;

  // VINTAGE BLINDER (sectionId == 2): the upper heads carry a gentle white swell
  // that breathes WITH the inhale and bites on the kick. blinderBite shapes the
  // attack — higher = snappier, kick-dominated punch; lower = soft swell.
  if (sectionId == 2) {
    var bite = clamp01(blinderBite);
    var swell = breathV * (1.0 - bite * 0.6);          // soft inhale swell
    var punch = wKick * (0.4 + 0.6 * bite) * (0.5 + 0.5 * breathV); // snappy kick bite
    var blind = (swell * 0.5 + punch) * (0.3 + 0.7 * wAmt) * (0.25 + 0.75 * level * level);
    w = w + blind;
    // keep the heads glowing warm, not just blank white
    r = r + wKick * 0.06 * bite;
  }

  rgbwau(clamp01(r), clamp01(g), clamp01(b), clamp01(w), 0.0, 0.0);
}
