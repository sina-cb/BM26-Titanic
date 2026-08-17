// DRAFT — pending operator review
/*
  22_balance_beam.js — BALANCE BEAM

  CONCEPT
    Two broad bowls share one conserved reservoir of light. Moving Balance
    transfers energy between the left and right halves without sweeping a wall
    across the ship; the Silhouette is their beam, Jewelry supplies opposing
    counterweights, Organs hold the pivot, and both TE signs carry the same
    compact paired seal.

  MOTION / MATH
    Complementary normalized weights drive paired sigmoid bowls. A very slow
    irrational sway animates the bowl material and the damped center without
    changing the total reservoir. This is a quasi-static balance, not a chase.

  CONTROLS (declaration order = physical MIDI order)
    localSpeed    — pace of material shimmer and pivot settling.
    balance       — transfers the conserved reservoir from 75:25 to 25:75.
    transferWidth — breadth of both paired bowl fields.
    settle        — damping of the center and beam sway.
    counterweight — visibility of the opposing Jewelry weights.
    level         — energy above the protected whole-rig floor.
    safetyFloor   — dependable whole-rig minimum light.

  AUDIO_MODULATION_V1:
    sliderTransferWidth <- micFlux range 0.22..0.55 curve ease   # flux opens both receiving bowls
    sliderCounterweight <- micLow  range 0.20..0.50 curve linear # low energy seats the jewelry weights
  Static (unmapped) params: localSpeed, balance, settle, level, safetyFloor,
    colorPalette1/2.

  COLOR / OUTPUT
    RGB stays strictly on the cp1-to-cp2 line. Native white and UV are not
    emitted, so W=A=U=0. Silence is a complete, continuously moving look.
*/

export var cp1H = 0.59, cp1S = 0.76, cp1V = 0.88;
export var cp2H = 0.095, cp2S = 0.70, cp2V = 1.00;
export function colorPalette1(hv, sv, vv) { cp1H = hv; cp1S = sv; cp1V = vv; }
export function colorPalette2(hv, sv, vv) { cp2H = hv; cp2S = sv; cp2V = vv; }

export var localSpeed = 0.30;
export var balance = 0.50;
export var transferWidth = 0.38;
export var settle = 0.62;
export var counterweight = 0.36;
export var level = 0.64;
export var safetyFloor = 0.34;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderBalance(v) { balance = v; }
export function sliderTransferWidth(v) { transferWidth = v; }
export function sliderSettle(v) { settle = v; }
export function sliderCounterweight(v) { counterweight = v; }
export function sliderLevel(v) { level = v; }
export function sliderSafetyFloor(v) { safetyFloor = v; }

var SQRT2 = 1.41421356;
var PHI = 1.61803399;
var GOLDEN_ANGLE = 2.39996323;
var PHASE_WRAP = 10000.0;

var materialPhase = 0.0;
var settlePhase = 0.317;
var liveBalance = 0.50;
var liveTransferWidth = 0.38;
var liveSettle = 0.62;
var liveCounterweight = 0.36;
var liveLevel = 0.64;
var liveSafetyFloor = 0.34;

var pr1 = 1.0, pg1 = 0.0, pb1 = 0.0;
var pr2 = 0.0, pg2 = 0.0, pb2 = 1.0;

function clamp01(value) {
  if (value < 0.0) return 0.0;
  if (value > 1.0) return 1.0;
  return value;
}

function smooth01(value) {
  var bounded = clamp01(value);
  return bounded * bounded * (3.0 - 2.0 * bounded);
}

function _hsv2rgb1() {
  var hv = cp1H - floor(cp1H); if (hv < 0.0) hv += 1.0;
  var iv = floor(hv * 6.0) % 6.0;
  var fv = hv * 6.0 - floor(hv * 6.0);
  var pv = cp1V * (1.0 - cp1S);
  var qv = cp1V * (1.0 - fv * cp1S);
  var tv = cp1V * (1.0 - (1.0 - fv) * cp1S);
  if      (iv == 0.0) { pr1 = cp1V; pg1 = tv;   pb1 = pv;   }
  else if (iv == 1.0) { pr1 = qv;   pg1 = cp1V; pb1 = pv;   }
  else if (iv == 2.0) { pr1 = pv;   pg1 = cp1V; pb1 = tv;   }
  else if (iv == 3.0) { pr1 = pv;   pg1 = qv;   pb1 = cp1V; }
  else if (iv == 4.0) { pr1 = tv;   pg1 = pv;   pb1 = cp1V; }
  else                 { pr1 = cp1V; pg1 = pv;   pb1 = qv;   }
}

function _hsv2rgb2() {
  var hv = cp2H - floor(cp2H); if (hv < 0.0) hv += 1.0;
  var iv = floor(hv * 6.0) % 6.0;
  var fv = hv * 6.0 - floor(hv * 6.0);
  var pv = cp2V * (1.0 - cp2S);
  var qv = cp2V * (1.0 - fv * cp2S);
  var tv = cp2V * (1.0 - (1.0 - fv) * cp2S);
  if      (iv == 0.0) { pr2 = cp2V; pg2 = tv;   pb2 = pv;   }
  else if (iv == 1.0) { pr2 = qv;   pg2 = cp2V; pb2 = pv;   }
  else if (iv == 2.0) { pr2 = pv;   pg2 = cp2V; pb2 = tv;   }
  else if (iv == 3.0) { pr2 = pv;   pg2 = qv;   pb2 = cp2V; }
  else if (iv == 4.0) { pr2 = tv;   pg2 = pv;   pb2 = qv;   }
  else                 { pr2 = cp2V; pg2 = pv;   pb2 = qv;   }
}

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  // Every live geometry edit is slewed. Balance remains responsive, while
  // width and damping reshape the material without a single-frame jump.
  var balanceFollow = min(1.0, dt * 8.0);
  var shapeFollow = min(1.0, dt * 5.0);
  var lightFollow = min(1.0, dt * 10.0);
  liveBalance += (clamp01(balance) - liveBalance) * balanceFollow;
  liveTransferWidth += (clamp01(transferWidth) - liveTransferWidth) * shapeFollow;
  liveSettle += (clamp01(settle) - liveSettle) * shapeFollow;
  liveCounterweight += (clamp01(counterweight) - liveCounterweight) * lightFollow;
  liveLevel += (clamp01(level) - liveLevel) * lightFollow;
  liveSafetyFloor += (clamp01(safetyFloor) - liveSafetyFloor) * lightFollow;

  var localMultiplier = 0.25 + clamp01(localSpeed)
    * (32.824 - 16.412 * clamp01(localSpeed));
  var rate = 0.015 + localMultiplier * 0.060;
  materialPhase += dt * rate;
  settlePhase += dt * rate * SQRT2;
  if (materialPhase >= PHASE_WRAP) materialPhase -= PHASE_WRAP;
  if (settlePhase >= PHASE_WRAP) settlePhase -= PHASE_WRAP;

  _hsv2rgb1();
  _hsv2rgb2();
}

export function render3D(index, x, y, z) {
  var ux = clamp01(x);
  var uy = clamp01(y);
  var uz = clamp01(z);
  var isLeft = ux < 0.50;
  var halfPosition = ux * 2.0;
  if (!isLeft) halfPosition = (1.0 - ux) * 2.0;

  // The shares are complementary by construction. The authored reservoir is
  // deliberately wider than the visible 75:25 span because the protected
  // symmetric floor compresses the measured ratio toward center.
  // At the saved center the apparatus autonomously weighs and releases its
  // reservoir over a long irrational material cycle. Manual Balance remains
  // dominant toward either endpoint, where the autonomous excursion tapers
  // away instead of fighting the operator.
  var centerAuthority = 1.0 - abs(liveBalance * 2.0 - 1.0);
  var dynamicBalance = clamp01(liveBalance
                     + sin(materialPhase * PI2) * 0.24 * centerAuthority);
  var rightShare = 0.08 + dynamicBalance * 0.84;
  var leftShare = 1.0 - rightShare;
  // A normalized cubic response preserves leftShare + rightShare == 1 while
  // restoring the visible 75:25 span after the shared safety/identity floor.
  var leftRaw = leftShare * leftShare * leftShare;
  var rightRaw = rightShare * rightShare * rightShare;
  var shareNorm = leftRaw + rightRaw;
  leftShare = leftRaw / shareNorm;
  rightShare = rightRaw / shareNorm;
  var sideShare = rightShare;
  if (isLeft) sideShare = leftShare;

  // Each half owns one broad sigmoid bowl. Width changes the bowl's breadth,
  // never its center or topology, so micFlux reads as an opening vessel rather
  // than a moving wipe.
  var bowlDistance = abs(halfPosition - 0.50);
  var innerRadius = 0.08 + liveTransferWidth * 0.16;
  var outerRadius = 0.23 + liveTransferWidth * 0.29;
  var bowl = 1.0 - smoothstep(innerRadius, outerRadius, bowlDistance);
  var bowlLip = 1.0 - smoothstep(0.022 + liveTransferWidth * 0.018,
                                0.070 + liveTransferWidth * 0.045,
                                abs(bowlDistance - outerRadius));

  // Damping affects only a low-amplitude common-mode sway. Because the term
  // is identical on both halves it cannot steal energy from one side.
  var damping = 1.0 - liveSettle;
  var centerSway = sin(settlePhase * PI2) * (0.008 + damping * 0.050);
  var beamCenter = 0.52 + centerSway;
  // A real balance beam tilts around its fixed fulcrum as the bowls trade
  // weight. The sign of the tilt follows the conserved side shares.
  var beamTilt = (leftShare - rightShare) * 0.34;
  var beamY = beamCenter + (ux - 0.50) * beamTilt;
  var beamDistance = abs(uy - beamY);
  var beam = 1.0 - smoothstep(0.020, 0.085, beamDistance);
  var pivotDx = ux - 0.50;
  var pivotDy = uy - beamCenter;
  var pivotDistanceSq = pivotDx * pivotDx + pivotDy * pivotDy;
  var pivot = 1.0 - smoothstep(0.0020, 0.0320, pivotDistanceSq);

  var material = wave(halfPosition * PHI + uz * SQRT2
                    + materialPhase * (isLeft ? 1.0 : -1.0));
  var crossGrain = wave(uy * SQRT2 - uz * PHI
                      + materialPhase * 0.61803399);
  var commonTexture = 0.76 + material * 0.15 + crossGrain * 0.09;
  var floorLevel = 0.060 + liveSafetyFloor * 0.140;
  var authoredEnergy = sideShare * (0.36 + bowl * 0.72 + bowlLip * 0.20)
                     * commonTexture;
  var brightness = floorLevel
                 + (1.0 - floorLevel) * liveLevel * authoredEnergy;
  var paletteMix = clamp01(0.055 + sideShare * 0.89
                         + (material - 0.50) * 0.06);

  if (fixtureType == FIX_RAW_LED) {
    // The Silhouette is a single balanced beam with a restrained bowl echo.
    brightness = floorLevel + (1.0 - floorLevel) * liveLevel
               * (0.08 + sideShare * (0.36 + beam * 0.94
                                    + bowlLip * 0.24));
    paletteMix = clamp01(0.055 + sideShare * 0.86 + beam * 0.08);
  } else if (fixtureType == FIX_VINTAGE_6) {
    // Counterweights deliberately oppose the bowl share. They remain strictly
    // palette RGB; no white lane is used to invent a third color.
    var opposingShare = 1.0 - sideShare;
    var headPosition = (pixelLocalIndex + 0.5) / 6.0;
    var counterCenter = 0.18 + opposingShare * 0.64;
    var weightCore = 1.0 - smoothstep(0.08, 0.30,
                                    abs(headPosition - counterCenter));
    var weightGlint = wave(pixelLocalIndex * GOLDEN_ANGLE
                         + materialPhase * SQRT2);
    var weightEnergy = opposingShare * liveCounterweight
                     * (0.34 + weightCore * 0.56 + weightGlint * 0.10);
    brightness = floorLevel * 0.82 + liveLevel * (0.075 + weightEnergy * 1.48);
    paletteMix = clamp01(0.12 + opposingShare * 0.74
                       + weightGlint * 0.08);
  } else if (fixtureType == FIX_PAR) {
    // Organs are the shared central pivot. Settle visibly damps their halo.
    var pivotHalo = pivot * (0.48 + damping * 0.22)
                  + beam * (0.12 + damping * 0.16);
    brightness = floorLevel + (1.0 - floorLevel) * liveLevel
               * (0.26 + pivotHalo * 0.66 + sideShare * 0.16);
    paletteMix = clamp01(0.34 + sideShare * 0.38 - pivot * 0.12);
  } else if (fixtureType == FIX_TE_SIGN) {
    // Fold both physical 40 + 34 patches onto one complete 74-pixel seal.
    // Global-index folding makes the two signs byte-identical while allowing
    // pixels 40..73 to continue, rather than repeat, the authored surface.
    var signIndex = index % 74.0;
    var sealRadius = sqrt((signIndex + 0.5) / 74.0) * 0.50;
    var sealAngle = signIndex * GOLDEN_ANGLE;
    var sealX = cos(sealAngle) * sealRadius;
    var sealY = sin(sealAngle) * sealRadius;
    var sealIsLeft = sealX < 0.0;
    var sealShare = rightShare;
    if (sealIsLeft) sealShare = leftShare;
    var sealRing = 1.0 - smoothstep(0.035, 0.105,
                                  abs(sealRadius - 0.34));
    var sealBeamY = centerSway * 0.80 + sealX * beamTilt;
    var sealBeam = 1.0 - smoothstep(0.018, 0.090,
                                  abs(sealY - sealBeamY));
    var transferField = wave(sealX * 0.83 + sealY * 0.41
                            - materialPhase * 0.77)
                      * wave(sealY * 0.67 - sealX * 0.29
                            + materialPhase * 1.41421356);
    var transferCenter = centerSway * 0.80;
    var transferWash = 1.0 - smoothstep(0.08, 0.46,
                                       abs(sealX - transferCenter));
    brightness = max(0.22, floorLevel + liveLevel
                   * (0.06 + sealShare * 0.18
                    + sealRing * 0.09 + sealBeam * 0.065)
                   + transferWash * (0.17 + transferField * 0.25));
    paletteMix = clamp01(0.16 + sealShare * 0.70
                       + sealRing * 0.08 - sealBeam * 0.06
                       + transferField * 0.16 + transferWash * 0.08);
  } else if (fixtureType == FIX_BAR_18) {
    // Hull Canvas is the reference bowl field; no additional geometry turns
    // the complementary transfer into a chase.
    brightness = max(floorLevel, brightness);
  }

  brightness = clamp01(brightness);
  var outR = (pr1 + (pr2 - pr1) * paletteMix) * brightness;
  var outG = (pg1 + (pg2 - pg1) * paletteMix) * brightness;
  var outB = (pb1 + (pb2 - pb1) * paletteMix) * brightness;
  rgbwau(clamp01(outR), clamp01(outG), clamp01(outB), 0.0, 0.0, 0.0);
}
