/*
  14_pale_maelstrom.js — "Pale Maelstrom"  [WHITE ONLY family — wave _312]

  DERIVED FROM: patterns/127_grand_maelstrom.js. Skeleton kept: one polar
  flow field with a wandering eye center, blended two/three-arm angular
  curl fields (avoiding a live-edit jump between arm counts), a filled
  radial-area arm mask, and a subordinate fixture-local counter-current.
  TE signs receive the same pixel-local vortex-arm score.
  IDENTITY (50 ft): a great slow maelstrom of pale arms rotates around the
  ship, arm edges etched white.

  TEXTURE: the outer water between arms rests at a 0.08 shadow; the filled
  arm interior and counter-current carry the 0.30-0.55 mid body; the arm's
  own transition rim (armEdge) and the calm eye pressure carry the
  0.85-1.0 crisp peaks.
  SPEED: authored to global 25 / local 0.30 (rate factor 0.4225); the
  vortex and undertow clocks keep the source's 0.074 / 0.045733
  incommensurate rate ratio scaled by the same speedScale.
  RUNAWAY (g=4.0, local 1.0 = 8x base): fastest term is the vortex clock at
  0.074 x 8 = 0.59 cycles/s, far below the 10/s alias bar. Max per-frame
  clock jump 0.1 x 0.074 x 2.0 = 0.015 against PHASE_WRAP 4096 — wraps safe
  by many orders of magnitude.
  CONTROLS (declaration order = MFT knob order): localSpeed — vortex
  rotation rate; armWidth — filled angular area of each arm; armCount —
  blend between two and three arms; depth — curl/vertical-climb depth;
  level — overall intensity with a visible floor.
*/

export var localSpeed = 0.30;
export var armWidth = 0.58;
export var armCount = 0.32;
export var depth = 0.56;
export var level = 0.50;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderArmWidth(v) { armWidth = v; }
export function sliderArmCount(v) { armCount = v; }
export function sliderDepth(v) { depth = v; }
export function sliderLevel(v) { level = v; }

// ── WHITE AUTHORITY (white_only family block — byte-identical across
//    patterns/white_only/*; hash-gated by white_only_contract.test.js) ──
// The family renders WHITE ONLY, as grayscale intensity art:
//   zero chroma (R = G = B exactly, every pixel, every frame); native white
//   W = A matched; UV = 0 always; and NO colorPalette exports, so the family
//   is untintable by design (house convention from patterns/60_white_wash.js).
var WHITE_RGB_SHARE = 0.88;
var WHITE_NATIVE_SHARE = 0.62;
function clamp01(v) {
  if (v < 0.0) return 0.0;
  if (v > 1.0) return 1.0;
  return v;
}
function smooth01(v) {
  var sv = clamp01(v);
  return sv * sv * (3.0 - 2.0 * sv);
}
function emitWhite(level, nativeShare) {
  var lit = clamp01(level);
  var rgb = lit * WHITE_RGB_SHARE;
  var nat = clamp01(lit * WHITE_NATIVE_SHARE * clamp01(nativeShare));
  rgbwau(rgb, rgb, rgb, nat, nat, 0.0);
}
// ── end WHITE AUTHORITY ──

var PHASE_WRAP = 4096.0;

var vortexPhase = 0.0;
var undertowPhase = 0.0;

var liveWidth = 0.58;
var liveCount = 0.32;
var liveDepth = 0.56;
var liveLevel = 0.58;

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;
  var speedScale = 0.35 + clamp01(localSpeed) * 1.65;

  var paramFollow = clamp01(dt * 6.0);
  liveWidth += (clamp01(armWidth) - liveWidth) * paramFollow;
  liveCount += (clamp01(armCount) - liveCount) * paramFollow;
  liveDepth += (clamp01(depth) - liveDepth) * paramFollow;
  liveLevel += (clamp01(level) - liveLevel) * paramFollow;

  vortexPhase += dt * 0.074 * speedScale;
  undertowPhase += dt * 0.045733 * speedScale;
  if (vortexPhase >= PHASE_WRAP) vortexPhase -= PHASE_WRAP;
  if (undertowPhase >= PHASE_WRAP) undertowPhase -= PHASE_WRAP;
}

export function render3D(index, x, y, z) {
  var ux = clamp01(x);
  var uy = clamp01(y);
  var uz = clamp01(z);
  var isSign = fixtureType == FIX_TE_SIGN;

  if (isSign) {
    // The physical sign is split across two fixtures. Fold the global index
    // across the full 74-pixel object so both signs stay byte-identical.
    var signIndex = index % 74.0;
    ux = (signIndex % 10.0) / 9.0;
    uy = floor(signIndex / 10.0) / 7.0;
    uz = 0.44 + ux * 0.12;
  }

  // The calm eye tours the vessel instead of pinning all structure to the
  // normalized center; two small incommensurate excursions keep the
  // off-axis field smooth.
  var centerX = 0.5 + sin(undertowPhase * PI2 * 1.4142136) * 0.14;
  var centerZ = 0.5 + cos(undertowPhase * PI2 * 1.7320508) * 0.12;
  var dx = ux - centerX;
  var dz = uz - centerZ;
  var radius = sqrt(dx * dx + dz * dz);
  var angle = atan2(dz, dx) / PI2;
  var depthAmount = liveDepth;

  // Two integer angular fields keep the atan seam continuous; ArmCount
  // blends smoothly between them, avoiding a live-edit jump.
  var radialCurl2 = radius * (1.30 + depthAmount * 1.35);
  var radialCurl3 = radius * (1.65 + depthAmount * 1.55);
  var verticalClimb2 = uy * (0.34 + depthAmount * 0.92);
  var verticalClimb3 = uy * (0.48 + depthAmount * 1.12);
  var phase2 = angle * 2.0 - radialCurl2 + verticalClimb2 - vortexPhase;
  var phase3 = angle * 3.0 - radialCurl3 + verticalClimb3 - vortexPhase;
  var armTwo = wave(phase2);
  var armThree = wave(phase3);
  var countMix = smooth01(liveCount);
  var armField = armTwo + (armThree - armTwo) * countMix;

  // Width changes filled angular area, not a tubular contour, so this
  // reads as a monumental mass rather than a thin luminous tube.
  var width = 0.32 + liveWidth * 0.62;
  var arm = smooth01((armField - (1.0 - width)) / width);
  arm = pow(arm, 0.58 + (1.0 - liveWidth) * 0.92);
  arm = smooth01(arm * (1.48 + liveWidth * 1.18));

  // A subordinate counter-current follows the same polar topology at a
  // finer scale, with fixture-local travel for texture.
  var localTravel = pixelLocalIndex * 0.017;
  var undertowField = wave(-angle * 1.0 - radius * (3.6 + depthAmount * 2.4) + uy * 1.4142136 + localTravel + undertowPhase);
  var undertow = smooth01((undertowField - 0.34) / 0.66);
  undertow = undertow * (0.32 + smooth01(radius / 0.72) * 0.68);

  // The calm eye is a filled center pressure, not a ring shell.
  var eyeRadius = 0.09 + depthAmount * 0.09;
  var eye = smooth01(1.0 - radius / eyeRadius);
  var eyePressure = eye * (0.38 + arm * 0.62);

  var distributedCurrent = arm * (0.70 + undertow * 0.30);
  distributedCurrent = distributedCurrent + undertow * (1.0 - arm) * 0.34;

  // Arm edges (the mask's own transition rim) etch a crisp white line; the
  // filled arm interior stays a mid-body mass rather than a whole-field lift.
  var armEdge = smooth01(1.0 - abs(arm - 0.5) * 2.4);
  armEdge = pow(armEdge, 1.6);

  var shadow = 0.08;
  var midBody = distributedCurrent * 0.40;
  midBody = midBody + undertow * 0.10;
  var peakAcc = armEdge * 1.70;
  peakAcc = peakAcc + eyePressure * 0.40;

  var lvl = shadow + midBody;
  lvl = lvl + peakAcc;
  var nativeShare = 0.18 + armEdge * 0.65;

  if (isSign) {
    // Each letter's physical wiring path becomes a miniature vortex arm,
    // excluding world X so matching local indices on the two signs match.
    var signPath = pixelLocalIndex / 39.0;
    var signArm = wave(signPath * (1.70 + depthAmount * 1.30) - vortexPhase * 1.18);
    var signUndertow = wave(signPath * 2.3999632 + undertowPhase * 1.4142136);
    var signCurrent = smooth01(signArm * 0.68 + signUndertow * 0.32);

    var signMid = signUndertow * 0.14;
    signMid = signMid + signCurrent * 0.20;
    var signPeak = signCurrent * 0.60;
    lvl = 0.24 + signMid;
    lvl = lvl + signPeak;
    nativeShare = 0.22 + signCurrent * 0.58;
  }

  var authored = 0.35 + liveLevel * 0.65;
  emitWhite(lvl * authored, nativeShare);
}
