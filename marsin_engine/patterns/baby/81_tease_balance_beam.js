/*
  81_tease_balance_beam.js — BABY BALANCE BEAM

  CONCEPT
    Baby Pink and Baby Blue occupy opposing balance bowls with a narrow black
    transfer boundary. The two shares are complementary, so emphasis may sway
    while the conserved reservoir never chooses an outcome. Both TE signs fold
    onto the same 74-pixel seal for byte-identical readability.

  MOTION / MATH
    A slow damped phase tips the common beam and breathes both bowl surfaces.
    Balance transfers energy between complementary shares; Transfer Width
    changes both bowls symmetrically. Every pixel is emitted as exact scaled
    Baby Blue, exact scaled Baby Pink, or black — never an RGB interpolation.

  CONTROLS (declaration order = physical MIDI order)
    localSpeed    — pace of the material sway.
    balance       — complementary left/right energy transfer.
    transferWidth — symmetric breadth of both bowls.
    counterweight — strength of opposing Jewelry weights.
    level         — overall RGB intensity.

  AUDIO_MODULATION_V1:
    sliderTransferWidth <- micFlux range 0.24..0.58 curve ease
    sliderCounterweight <- micLow  range 0.20..0.52 curve linear
  Static (unmapped) params: localSpeed, balance, level.

  COLOR / OUTPUT
    Exact hard-coded Baby Blue and Baby Pink plus black only. RGB lanes only;
    W=A=U=0. No palette exports, white, amber, UV, or third hue.
*/

var BABY_BLUE_R = 0.033;
var BABY_BLUE_G = 0.450;
var BABY_BLUE_B = 1.000;
var BABY_PINK_R = 1.000;
var BABY_PINK_G = 0.035;
var BABY_PINK_B = 0.360;

export var localSpeed = 0.30;
export var balance = 0.50;
export var transferWidth = 0.38;
export var counterweight = 0.36;
export var level = 0.90;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderBalance(v) { balance = v; }
export function sliderTransferWidth(v) { transferWidth = v; }
export function sliderCounterweight(v) { counterweight = v; }
export function sliderLevel(v) { level = v; }

var SQRT2 = 1.41421356;
var PHI = 1.61803399;
var GOLDEN_ANGLE = 2.39996323;
var phase = 0.0;
var liveBalance = 0.50;
var liveWidth = 0.38;
var liveCounterweight = 0.36;
var liveLevel = 0.90;

function clamp01(value) {
  if (value < 0.0) return 0.0;
  if (value > 1.0) return 1.0;
  return value;
}

export function beforeRender(delta) {
  var dt = min(0.1, max(0.0, delta / 1000.0));
  var follow = min(1.0, dt * 7.0);
  liveBalance += (clamp01(balance) - liveBalance) * follow;
  liveWidth += (clamp01(transferWidth) - liveWidth) * follow;
  liveCounterweight += (clamp01(counterweight) - liveCounterweight) * follow;
  liveLevel += (clamp01(level) - liveLevel) * follow;
  var speedMultiplier = pow(2.0, (clamp01(localSpeed) - 0.5) * 4.0);
  phase += dt * (0.045 + speedMultiplier * 0.085);
  if (phase >= 10000.0) phase -= 10000.0;
}

export function render3D(index, x, y, z) {
  var ux = clamp01(x);
  var uy = clamp01(y);
  var uz = clamp01(z);

  // Fold both physical sign patches onto the same complete seal. This keeps
  // their letters byte-identical even though their model coordinates differ.
  if (fixtureType == FIX_TE_SIGN) {
    ux = ((index % 74.0) + 0.5) / 74.0;
    uy = wave((index % 74.0) * GOLDEN_ANGLE);
    uz = wave((index % 74.0) * PHI);
  }

  var split = fixtureType == FIX_TE_SIGN ? 0.50 : 0.65;
  var isBlue = ux < split;
  var halfPosition = isBlue ? ux / split : (1.0 - ux) / (1.0 - split);
  var centerAuthority = 1.0 - abs(liveBalance * 2.0 - 1.0);
  var dynamicBalance = clamp01(liveBalance
                     + sin(phase * PI2) * 0.10 * centerAuthority);
  var blueShare = 0.28 + (1.0 - dynamicBalance) * 0.44;
  var pinkShare = 1.0 - blueShare;
  var sideShare = isBlue ? blueShare : pinkShare;

  var bowlDistance = abs(halfPosition - 0.50);
  var innerRadius = 0.08 + liveWidth * 0.13;
  var outerRadius = 0.25 + liveWidth * 0.31;
  var bowl = 1.0 - smoothstep(innerRadius, outerRadius, bowlDistance);
  var lip = 1.0 - smoothstep(0.025, 0.075,
                            abs(bowlDistance - outerRadius));
  var tilt = (blueShare - pinkShare) * 0.30;
  var beamY = 0.50 + (ux - split) * tilt;
  var beam = 1.0 - smoothstep(0.018, 0.070, abs(uy - beamY));
  var material = wave(halfPosition * PHI + uz * SQRT2
                    + phase * (isBlue ? 1.0 : -1.0));
  var field = bowl * (0.58 + material * 0.42) + lip * 0.30 + beam * 0.36;

  if (fixtureType == FIX_VINTAGE_6) {
    var opposingShare = 1.0 - sideShare;
    var head = (pixelLocalIndex + 0.5) / 6.0;
    var weightCenter = 0.18 + opposingShare * 0.64;
    var weight = 1.0 - smoothstep(0.08, 0.28, abs(head - weightCenter));
    field = max(field * 0.72, weight * liveCounterweight * 1.45);
  } else if (fixtureType == FIX_PAR) {
    var pivotDx = ux - split;
    var pivotDy = uy - 0.50;
    var pivot = 1.0 - smoothstep(0.002, 0.034,
                               pivotDx * pivotDx + pivotDy * pivotDy);
    field = max(field * 0.82, pivot);
  }

  // The bench concentrates several non-sign fixtures outside the analytic
  // bowl core. A shared blue-side material floor keeps the conserved left bowl
  // visually authoritative there without introducing a wash or a third hue.
  if (isBlue) field = max(field, 0.34 + material * 0.08);

  // This is a true black moat, not a purple blend between the two sides.
  var gap = 0.045;
  var fieldFloor = isBlue ? 0.03 : 0.15;
  if (abs(ux - split) < gap || field < fieldFloor
      || wave(ux * 1.7 + uy * 1.3 + uz * 1.1) < 0.12) {
    rgbwau(0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
    return;
  }

  var intensity = clamp01((0.62 + field * 0.30 + sideShare * 0.08)
                         * liveLevel);
  if (isBlue) {
    rgbwau(BABY_BLUE_R * intensity, BABY_BLUE_G * intensity,
           BABY_BLUE_B * intensity, 0.0, 0.0, 0.0);
  } else {
    rgbwau(BABY_PINK_R * intensity, BABY_PINK_G * intensity,
           BABY_PINK_B * intensity, 0.0, 0.0, 0.0);
  }
}
