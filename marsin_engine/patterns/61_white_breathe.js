/*
  61_white_breathe.js — "White Breathe"  [WHITE ONLY family]

  A slow, deep, whole-rig WHITE breath. The rig inhales and exhales as one
  body, with a gentle travelling component so the breath rolls across the
  fixtures instead of pulsing in perfect lockstep. Pure white throughout.

  WHY IT IS ACTUALLY WHITE — see 60_white_wash.js's header (same three
  guarantees, verbatim): no colorPalette exports (the global palette /
  palette autopilot cannot bind to this pattern), neutral RGB (hue-invariant,
  so the per-channel hue stage cannot tint it), and an explicit W lane via
  rgbwau() rather than the mapper's min(R,G,B) host-synth.

  FIXTURE COVERAGE is model-independent — no FIX_* / sectionId branching.
  Amber is emitted unconditionally for warmth; sacn_mapper only writes a
  channel the fixture's channel map declares, so RGBW and RGB-only fixtures
  simply drop it.

  CORE (non-repeating) MATH — the breath is the product of TWO breaths at an
  irrational period ratio, so the envelope never repeats:
      body = wave(breathA) * 0.68 + wave(breathA * 0.41421 + 0.37) * 0.32
      roll = wave(nx*0.55*R + ny*0.90*R - nz*0.35*R + breathB)
  breathA and breathB accumulate at rates in a 1 : 0.61803 (golden) ratio.
  Direction biases which way the roll travels and eases through reversals via
  a soft-clipped sine, so the roll changes heading on its own without a kink.

  CONTROLS (UI order = declaration order = MFT knob order)
    - localSpeed : FIRST. Breath rate.
    - direction  : SECOND (project rule). Guarded sign, never 0.
    - level      : overall intensity (PRIMARY audio target).
    - kick       : kick brightness pop on top of the breath.
    - radius     : how far the roll travels across the rig.
    - depth      : breath depth — 0 nearly steady, 1 full inhale/exhale.
    - whiteLevel : crossfade of the white between RGB and the W emitter.
    - whiteKick  : kick-driven W pop (blinder bite; allowed to stack).
    - warmth     : 0 neutral/cool white, 1 warm white (amber + RGB tint).

  The `hueSpread >= 0.10` bar does not apply to the WHITE ONLY family (a
  white pattern is deliberately hue-free); every other production bar does.

AUDIO_MODULATION_V1:
  sliderLevel     <- micLow  range 0.30..1.00 curve linear  # overall intensity (PRIMARY)
  sliderKick      <- micKick range 0.00..1.00 curve pow2    # breath pop
  sliderDepth     <- micMid  range 0.35..0.90 curve linear  # breath depth
  sliderWhiteKick <- micKick range 0.00..1.00 curve pow2    # W-emitter blinder bite
  # STATIC (omit from audio): localSpeed, direction, radius, whiteLevel, warmth
*/

// ── Exported controls (UI order = declaration order) ─────────────────────────
export var localSpeed = 0.35;  // FIRST: breath rate (slow by design)
export var direction  = 1.0;   // SECOND: signed roll direction (-1..1 stored)
export var level      = 0.70;  // overall intensity (PRIMARY)
export var kick       = 0.0;   // kick brightness pop (transient target)
export var radius     = 0.5;   // how far the roll travels
export var depth      = 0.42;  // breath depth
export var whiteLevel = 0.65;  // RGB <-> W emitter crossfade
export var whiteKick  = 0.20;  // kick-driven W pop
export var warmth     = 0.20;  // 0 neutral white -> 1 warm white

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderDirection(v) {
  var d = (v * 2.0) - 1.0;
  if (d >= 0.0 && d < 0.06) d = 0.06;
  else if (d < 0.0 && d > -0.06) d = -0.06;
  direction = d;
}
export function sliderLevel(v)      { level = v; }
export function sliderKick(v)       { kick = v; }
export function sliderRadius(v)     { radius = v; }
export function sliderDepth(v)      { depth = v; }
export function sliderWhiteLevel(v) { whiteLevel = v; }
export function sliderWhiteKick(v)  { whiteKick = v; }
export function sliderWarmth(v)     { warmth = v; }

// ── Tunables ─────────────────────────────────────────────────────────────────
var MAX_RATE = 0.085;      // breaths/sec at localSpeed = 1.0 (~12 s inhale+exhale)
var BASE_RATE = 0.012;     // the breath never stops, even at localSpeed = 0
var PHASE_WRAP = 1000.0;
var OSC_WRAP = 1000.0;

function clamp01(v) {
  if (v < 0.0) return 0.0;
  if (v > 1.0) return 1.0;
  return v;
}

// ── Persistent state ─────────────────────────────────────────────────────────
var breathA = 0.0;
var breathB = 0.0;
var dirOsc = 0.0;
var autoSign = 1.0;
var body = 0.5;        // whole-rig breath envelope, resolved once per frame
var levGain = 1.0;
var radScale = 0.5;
var kickBody = 0.0;
var depthAmt = 0.6;
var whiteKeep = 0.0;
var whiteBite = 0.0;
var warmAmt = 0.0;

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  var localMult = pow(2.0, (localSpeed - 0.5) * 4.0);
  var rate = BASE_RATE + MAX_RATE * localMult;

  // Autonomous heading variation (soft-clipped sine — continuous through the
  // reversal, so the roll velocity never jumps). sin() is in TURNS, so an
  // integer wrap of dirOsc is exactly seam-free.
  dirOsc = dirOsc + dt * 0.0163;      // ~61 s per full turn
  if (dirOsc >= OSC_WRAP) dirOsc = dirOsc - OSC_WRAP;
  var osc = sin(dirOsc);
  autoSign = osc / sqrt(osc * osc + 0.0036);

  var effDir = direction;
  if (effDir >= 0.0 && effDir < 0.06) effDir = 0.06;
  else if (effDir < 0.0 && effDir > -0.06) effDir = -0.06;

  // The BODY breath always runs forward (a breath does not reverse); only the
  // travelling roll takes the heading.
  breathA = breathA + dt * rate;
  if (breathA >= PHASE_WRAP) breathA = breathA - PHASE_WRAP;
  breathB = breathB + dt * rate * 0.61803 * effDir * autoSign;
  if (breathB >= PHASE_WRAP) breathB = breathB - PHASE_WRAP;
  else if (breathB <= -PHASE_WRAP) breathB = breathB + PHASE_WRAP;

  // Two incommensurate breaths -> a never-repeating envelope.
  var b1 = wave(breathA);
  var b2 = wave(breathA * 0.41421 + 0.37);     // sqrt(2)-1 ratio
  body = b1 * 0.68 + b2 * 0.32;

  // Wide levGain + a moderate default `depth`: the breath envelope and the
  // audio level both move total brightness, so if the envelope swings as hard
  // as `level` does the PRIMARY correlation collapses (measured 0.21 at
  // depth 0.60). The shipped depth keeps the breath clearly visible while
  // leaving `level` the dominant term; push depth up for a deeper breath and
  // the pattern simply becomes less audio-legible, which is the honest
  // trade and the operator's to make.
  levGain = 0.08 + 0.92 * clamp01(level);
  radScale = 0.30 + clamp01(radius) * 1.30;
  kickBody = clamp01(kick);
  depthAmt = clamp01(depth);
  whiteKeep = clamp01(whiteLevel);
  whiteBite = clamp01(whiteKick);
  warmAmt = clamp01(warmth);
}

export function render3D(index, x, y, z) {
  var nx = clamp01(x);
  var ny = clamp01(y);
  var nz = clamp01(z);

  // The travelling component: the breath rolls across the rig rather than
  // flashing everywhere at once.
  var roll = wave(nx * 0.55 * radScale + ny * 0.90 * radScale - nz * 0.35 * radScale + breathB);

  // Combine the whole-rig breath with the roll, then apply depth. depth = 0
  // leaves a steady sheet; depth = 1 swings from a dim floor to full.
  var env = body * 0.70 + roll * 0.30;
  var shaped = 1.0 - depthAmt + depthAmt * (env * env);   // squared -> softer bottoms

  var bri = shaped * levGain * (1.0 + kickBody * 0.28);
  bri = clamp01(bri);

  // ── WHITE EMIT (see 60_white_wash.js header) ───────────────────────────────
  var rgbShare = 1.0 - 0.72 * whiteKeep;
  var wg = 1.0 - warmAmt * 0.26;
  var wb = 1.0 - warmAmt * 0.60;
  var rgbBri = bri * rgbShare;

  var wLane = bri * whiteKeep + whiteBite * bri * 0.85;
  if (wLane > 1.0) wLane = 1.0;
  // LANE MATCH (w == a): amber tracks white exactly. Bare W is cold, bare A is
  // yellow; matched W+A is the warm white the ship reads as white, and it is
  // what the LED strands already render. Warmth still shapes the RGB lanes.
  var aLane = wLane;

  rgbwau(clamp01(rgbBri), clamp01(rgbBri * wg), clamp01(rgbBri * wb),
         clamp01(wLane), clamp01(aLane), 0.0);
}
