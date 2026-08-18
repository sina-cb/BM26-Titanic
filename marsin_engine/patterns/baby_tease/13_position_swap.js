/*
  Position Swap (design doc 72, keeper K13).

  Two equal soft masses — one pink, one blue — slide the length of the hull in
  opposite directions and zip straight through each other to swap ends. The
  masses are mirror images at every instant, so the rig is 50/50 by
  construction. Between and behind them the ship carries a dim travelling wake
  lace whose stripes alternate family, which keeps both colors on both halves
  of every axis even while the two masses sit at opposite ends.

  Local Speed is the safe first control. Level sets output. Finger Count picks
  how many interleaved fingers the seam shatters into while the masses cross.
  Black is designed: every mass wears a hard black rim, and the wake lace has a
  black seam between stripes, so masses read as bodies and the lace reads as
  slats rather than a wash.

  World geometry uses the all-smokestack ship frame only; raw coordinates
  appear once each to build it. The mass cross-position combines height and
  ship width so neither rig's degenerate axis can flatten it. Vintage fixtures
  run the same exchange over six heads with one rotating black separator head.
  Both TE signs carry two discs swapping horizontally with the same zipper comb
  at the crossing, byte-identical by address.
*/

var BABY_PINK_R = 1.000;
var BABY_PINK_G = 0.035;
var BABY_PINK_B = 0.360;
var BABY_BLUE_R = 0.033;
var BABY_BLUE_G = 0.450;
var BABY_BLUE_B = 1.000;
var SHIP_CENTER_X = 0.5219458333333333;
var SHIP_CENTER_Z = 0.5606541666666667;
var SHIP_AXIS_X = 0.7658426753447269;
var SHIP_AXIS_Z = -0.6430279905422711;
var PINK_TRIM = 0.97;
var PINK_BAR_TRIM = 0.80;
var FLOOR_I = 0.14;

export var localSpeed = 0.44;
export var level = 0.87;
export var fingerCount = 0.5;

export function sliderLocalSpeed(value) { localSpeed = value; }
export function sliderLevel(value) { level = value; }
export function sliderFingerCount(value) { fingerCount = value; }

var swapClock = 0.0;
var laceClock = 0.0;
var shimmerClock = 0.0;
var liveLevel = 0.87;
var liveFingers = 0.5;

function clamp01(value) {
  if (value < 0.0) return 0.0;
  if (value > 1.0) return 1.0;
  return value;
}

function emitBlue(intensity) {
  var k = max(FLOOR_I, min(1.0, intensity)) * liveLevel;
  rgbwau(BABY_BLUE_R * k, BABY_BLUE_G * k, BABY_BLUE_B * k, 0.0, 0.0, 0.0);
}

function emitPink(intensity) {
  var k = max(FLOOR_I, min(1.0, intensity)) * liveLevel * PINK_TRIM;
  if (fixtureType == FIX_BAR_18) k = k * PINK_BAR_TRIM;
  rgbwau(BABY_PINK_R * k, BABY_PINK_G * k, BABY_PINK_B * k, 0.0, 0.0, 0.0);
}

function emitBlack() {
  rgbwau(0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
}

export function beforeRender(delta) {
  var dt = min(0.10, max(0.0, delta / 1000.0));
  var speedScale = 0.35 + clamp01(localSpeed) * 1.65;
  // SPEED RETUNE (report _305). Base rates below are ×14.4 (exact equivalence 14.446).
  // The show's reference operating point is global SPEED 25 and
  // sliderLocalSpeed 0.30. The engine's global knob is EXPONENTIAL —
  // engine.js createRenderLoop: multiplier = 0.25 * 16^speed, so 25 is
  // 0.50x wall clock — and speedScale below is linear, so pattern time
  // advances at 0.50 * 0.845 = 0.4225x there. The factor moves
  // the look the operator approved at global SPEED 94 / sliderLocalSpeed 0.88
  // onto that reference point. Saved playlist defaults are UNCHANGED — the
  // retune lives here, in the pattern's own base rate.
  swapClock = swapClock + dt * 0.432 * speedScale;
  laceClock = laceClock + dt * 1.296 * speedScale;
  shimmerClock = shimmerClock + dt * 2.664 * speedScale;
  if (swapClock >= 2.0) swapClock = swapClock - 2.0;
  if (laceClock >= 2.0) laceClock = laceClock - 2.0;
  if (shimmerClock >= 10000.0) shimmerClock = shimmerClock - 10000.0;
  liveLevel = clamp01(level);
  liveFingers = clamp01(fingerCount);
}

export function render3D(index, x, y, z) {
  if (fixtureType == FIX_VINTAGE_6) {
    var head = pixelLocalIndex % 6.0;
    var darkHead = floor(shimmerClock * 1.7) % 6.0;
    if (head == darkHead) {
      emitBlack();
      return;
    }
    var headPos = head / 5.0;
    var headMix = wave(swapClock);
    var headPinkD = abs(headPos - headMix);
    var headBlueD = abs(headPos - (1.0 - headMix));
    var headOverlap = clamp01(1.0 - abs(1.0 - headMix * 2.0) * 2.2);
    var headComb = 1.0;
    if ((head + 24.0) % 2.0 < 1.0) headComb = -1.0;
    var headField = headBlueD - headPinkD + headComb * 0.20 * headOverlap;
    var headNear = min(headPinkD, headBlueD);
    var headLevel = 0.40 + max(0.0, 1.0 - headNear * 2.4) * 0.42
                  + wave(shimmerClock * 0.6 + head * 0.19) * 0.14;
    if (headField > 0.0) emitPink(headLevel);
    else emitBlue(headLevel);
    return;
  }

  if (fixtureType == FIX_TE_SIGN) {
    var signAddress = index % 74.0;
    var signX = (signAddress % 10.0) / 9.0;
    var signY = floor(signAddress / 10.0) / 7.0;
    var signMix = wave(swapClock * 1.35);
    var signPinkX = 0.20 + 0.60 * signMix;
    var signBlueX = 0.80 - 0.60 * signMix;
    var signDrift = sin(swapClock * PI2 * 2.0) * 0.06;
    var signPinkDX = signX - signPinkX;
    var signPinkDY = signY - 0.50 - signDrift;
    var signBlueDX = signX - signBlueX;
    var signBlueDY = signY - 0.50 + signDrift;
    var signPinkD = sqrt(signPinkDX * signPinkDX + signPinkDY * signPinkDY * 0.70);
    var signBlueD = sqrt(signBlueDX * signBlueDX + signBlueDY * signBlueDY * 0.70);
    var signNear = min(signPinkD, signBlueD);
    if (signNear >= 0.30) {
      var signLaceU = signX * 1.6 + signY * 2.3 - swapClock * 1.0 + 6.0;
      var signLaceCell = floor(signLaceU);
      var signLaceFrac = signLaceU - signLaceCell;
      if (signLaceFrac < 0.24) {
        emitBlack();
        return;
      }
      var signLaceLevel = 0.40 + wave(shimmerClock * 0.5 + signLaceFrac * 0.8) * 0.30;
      if ((signLaceCell + 24.0) % 2.0 < 1.0) emitBlue(signLaceLevel);
      else emitPink(signLaceLevel);
      return;
    }
    if (signNear >= 0.265) {
      emitBlack();
      return;
    }
    var signOverlap = clamp01(1.0 - abs(signPinkX - signBlueX) * 2.4);
    var signComb = sin(signY * PI2 * 2.5 + signX * PI2 * 0.6);
    var signField = signBlueD - signPinkD + signComb * 0.16 * signOverlap;
    var signLevel = 0.58 + (1.0 - signNear / 0.265) * 0.38;
    if (signField > 0.0) emitPink(signLevel);
    else emitBlue(signLevel);
    return;
  }

  var dx = x - SHIP_CENTER_X;
  var dz = z - SHIP_CENTER_Z;
  var shipLong = 0.50 + dx * SHIP_AXIS_X + dz * SHIP_AXIS_Z;
  var shipWide = 0.50 + dx * (-SHIP_AXIS_Z) + dz * SHIP_AXIS_X;
  var cross = y * 0.55 + shipWide * 0.45;
  var swapMix = wave(swapClock);
  var pinkLong = 0.26 + 0.48 * swapMix;
  var blueLong = 0.74 - 0.48 * swapMix;
  var drift = sin(swapClock * PI2 * 2.0) * 0.07;
  var pinkDL = shipLong - pinkLong;
  var pinkDC = cross - 0.46 - drift;
  var blueDL = shipLong - blueLong;
  var blueDC = cross - 0.46 + drift;
  var pinkD = sqrt(pinkDL * pinkDL + pinkDC * pinkDC * 0.70);
  var blueD = sqrt(blueDL * blueDL + blueDC * blueDC * 0.70);
  var nearD = min(pinkD, blueD);
  var laceU = shipLong * 5.0 + y * 7.0 + shipWide * 10.0 + 6.0;
  var laceCell = floor(laceU);
  var laceFrac = laceU - laceCell;
  if (laceFrac < 0.16) {
    emitBlack();
    return;
  }
  var laceBlue = 0.0;
  if ((laceCell + 24.0) % 2.0 < 1.0) laceBlue = 1.0;
  var laceFlow = wave(laceFrac * 0.85 + shipLong * 0.75 + y * 0.55 - laceClock);
  if (nearD < 0.112) {
    if (nearD >= 0.096) {
      emitBlack();
      return;
    }
    if (laceFrac < 0.58) {
      var slatLevel = 0.44 + laceFlow * 0.16;
      if (laceBlue > 0.5) emitBlue(slatLevel);
      else emitPink(slatLevel);
      return;
    }
    var overlap = clamp01(1.0 - abs(pinkLong - blueLong) * 2.4);
    var comb = sin(shipWide * PI2 * (1.6 + liveFingers * 2.0) + y * PI2 * 1.1
                 + shipLong * PI2 * 0.5);
    var field = blueD - pinkD + comb * 0.07 * overlap;
    var coreLevel = 0.68 + (1.0 - nearD / 0.096) * 0.26
                  + laceFlow * 0.06;
    if (field > 0.0) emitPink(coreLevel);
    else emitBlue(coreLevel);
    return;
  }
  var laceLevel = 0.40 + laceFlow * 0.44;
  if (laceBlue > 0.5) emitBlue(laceLevel);
  else emitPink(laceLevel);
}
