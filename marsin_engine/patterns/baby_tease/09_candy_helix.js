/*
  Candy Helix (design doc 72, keeper K07).

  A pink-and-blue candy-cane ribbon screws along the hull. The cross-section
  angle around the ship's spine is added to a linear twist along the hull, and
  the fractional part of that helix coordinate splits into two half-period
  ribbons: the first half is pink, the second is blue. Half-period ribbons are
  50/50 by construction, so neither family can ever own a plane of the ship —
  as the helix turns, every point trades families on a slow, even schedule.

  Local Speed is the safe first control. Direction screws the helix bow-ward or
  stern-ward. Level sets output. Twist Breath widens and narrows the number of
  turns along the hull so the barber pole breathes. Black is designed: the two
  ribbon edges are cut to exact black, which is what keeps the candy stripe
  reading as two separate ribbons instead of a gradient, and a sparkle lace
  dims a finer cross-hatch riding on top.

  World geometry uses the all-smokestack ship frame only; raw hull coordinates
  appear once each to build it. The cross-section coordinate blends height with
  the beam axis so the helix resolves on both the full ship and the test bench,
  where height alone is nearly degenerate. Vintage fixtures run the ribbon
  around six heads with one rotating black separator head. Both TE signs carry
  a diagonal barber pole scrolling corner to corner, byte-identical by address.
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

export var localSpeed = 0.46;
export var direction = 1.0;
export var level = 0.86;
export var twistBreath = 0.5;

export function sliderLocalSpeed(value) { localSpeed = value; }
export function sliderDirection(value) { direction = value; }
export function sliderLevel(value) { level = value; }
export function sliderTwistBreath(value) { twistBreath = value; }

var twistClock = 0.0;
var breathClock = 0.0;
var sparkleClock = 0.0;
var liveLevel = 0.86;
var liveBreath = 0.5;

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
  var twistSign = 1.0;
  if (direction < 0.5) twistSign = -1.0;
  // SPEED RETUNE (report _305). Base rates below are ×3.0 — ESTIMATE. The operator said "too slow too" without a reference
  // setting, so this is a judged ~3x, not a measured equivalence.
  // Re-measure on the rig and adjust THIS constant group.
  // The show's reference operating point is global SPEED 25 and
  // sliderLocalSpeed 0.30. The engine's global knob is EXPONENTIAL —
  // engine.js createRenderLoop: multiplier = 0.25 * 16^speed, so 25 is
  // 0.50x wall clock — and speedScale below is linear, so pattern time
  // advances at 0.50 * 0.845 = 0.4225x there. The factor is the operator's
  // field note applied at that reference point. Saved playlist defaults
  // are UNCHANGED — the retune lives here, in the pattern's own base rate.
  twistClock = twistClock + dt * 0.072 * speedScale * twistSign;
  breathClock = breathClock + dt * 0.123 * speedScale;
  sparkleClock = sparkleClock + dt * 0.645 * speedScale;
  if (twistClock >= 2.0) twistClock = twistClock - 2.0;
  if (twistClock < 0.0) twistClock = twistClock + 2.0;
  if (breathClock >= 10000.0) breathClock = breathClock - 10000.0;
  if (sparkleClock >= 10000.0) sparkleClock = sparkleClock - 10000.0;
  liveLevel = clamp01(level);
  liveBreath = clamp01(twistBreath);
}

export function render3D(index, x, y, z) {
  if (fixtureType == FIX_VINTAGE_6) {
    var head = pixelLocalIndex % 6.0;
    var darkHead = floor(twistClock * 3.0) % 6.0;
    if (head == darkHead) {
      emitBlack();
      return;
    }
    var headU = head / 6.0 + twistClock * 1.2 + 8.0;
    var headStripe = headU - floor(headU);
    var headLevel = 0.54 + wave(sparkleClock * 0.7 + head / 6.0) * 0.38;
    if (headStripe < 0.5) emitPink(headLevel);
    else emitBlue(headLevel);
    return;
  }

  if (fixtureType == FIX_TE_SIGN) {
    var signAddress = index % 74.0;
    var signX = (signAddress % 10.0) / 9.0;
    var signY = floor(signAddress / 10.0) / 7.0;
    var signU = signY * 1.5 + signX * 0.9 + twistClock * 1.4 + 8.0;
    var signStripe = signU - floor(signU);
    var signEdge = min(min(signStripe, 1.0 - signStripe), abs(signStripe - 0.5));
    if (signEdge < 0.055) {
      emitBlack();
      return;
    }
    var signLevel = 0.54 + wave(sparkleClock * 0.55 + signX * 0.7
                              + signY * 0.45) * 0.38;
    if (signStripe < 0.5) emitPink(signLevel);
    else emitBlue(signLevel);
    return;
  }

  var dx = x - SHIP_CENTER_X;
  var dz = z - SHIP_CENTER_Z;
  var shipLong = 0.50 + dx * SHIP_AXIS_X + dz * SHIP_AXIS_Z;
  var shipWide = 0.50 + dx * (-SHIP_AXIS_Z) + dz * SHIP_AXIS_X;
  var crossHigh = (y * 0.55 + shipWide * 0.45 - 0.40) * 2.2;
  var crossSide = (y * 0.75 - shipWide * 0.65) * 0.90;
  var spinAngle = atan2(crossSide, crossHigh) / PI2 + 0.5;
  var turns = 2.0 + sin(breathClock * PI2) * (0.10 + liveBreath * 0.30);
  var helixU = spinAngle * 3.0 + shipLong * turns + twistClock + 8.0;
  var stripe = helixU - floor(helixU);
  var ribbonEdge = min(min(stripe, 1.0 - stripe), abs(stripe - 0.5));
  if (ribbonEdge < 0.045) {
    emitBlack();
    return;
  }
  var spinRadius = sqrt(crossHigh * crossHigh * 1.3 + crossSide * crossSide);
  var ownedLevel = 0.54 + wave(spinRadius * 0.9 + sparkleClock * 0.6) * 0.38;
  var sparkleLace = abs(sin((helixU * 3.0 + spinRadius * 1.5) * PI2));
  if (sparkleLace < 0.18) ownedLevel = 0.30;
  if (stripe < 0.5) emitPink(ownedLevel);
  else emitBlue(ownedLevel);
}
