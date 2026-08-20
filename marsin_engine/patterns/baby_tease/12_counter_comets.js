/*
  Counter Comets (design doc 72, keeper K09).

  Pink and blue comets lap the ship in opposite directions over a woven pink
  and blue lattice. The orbit is an ellipse in the hull plane; each family
  carries three evenly spaced heads with the same head size and the same tail,
  so the two streams sweep equal territory however far apart they drift —
  the families cross, overtake and pass through each other without either one
  ever taking the ship. Underneath, the lattice is a static half-and-half
  basket weave that holds the census steady while the comets fly.

  Local Speed is the safe first control. Direction reverses both orbits at
  once. Level sets output. Comet Size grows the heads. Black is designed: the
  grout between the basket cells is cut to exact black, so the weave reads as
  woven strands rather than a wash, and the comets fly over the grout.

  World geometry uses the all-smokestack ship frame only; raw hull coordinates
  appear once each to build it. The orbit's second axis and the weave both
  blend height with the beam axis, so the ellipse and the lattice resolve on
  the full ship and on the test bench alike. Vintage fixtures run two
  counter-chasing bright heads over a pair of opposed black separator heads.
  Both TE signs carry two pink and two blue counter-orbiting dots over the same
  mini weave, byte-identical by address.
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
export var direction = 1.0;
export var level = 0.87;
export var cometSize = 0.5;

export function sliderLocalSpeed(value) { localSpeed = value; }
export function sliderDirection(value) { direction = value; }
export function sliderLevel(value) { level = value; }
export function sliderCometSize(value) { cometSize = value; }

var orbitClock = 0.0;
var shimmerClock = 0.0;
var liveLevel = 0.87;
var liveSize = 0.5;

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
  var orbitSign = 1.0;
  if (direction < 0.5) orbitSign = -1.0;
  // SPEED RETUNE (report _305). Base rates below are ×1.25 (operator: +25%).
  // The show's reference operating point is global SPEED 25 and
  // sliderLocalSpeed 0.30. The engine's global knob is EXPONENTIAL —
  // engine.js createRenderLoop: multiplier = 0.25 * 16^speed, so 25 is
  // 0.50x wall clock — and speedScale below is linear, so pattern time
  // advances at 0.50 * 0.845 = 0.4225x there. The factor is the operator's
  // field note applied at that reference point. Saved playlist defaults
  // are UNCHANGED — the retune lives here, in the pattern's own base rate.
  orbitClock = orbitClock + dt * 0.0375 * speedScale * orbitSign;
  shimmerClock = shimmerClock + dt * 0.1625 * speedScale;
  if (orbitClock >= 2.0) orbitClock = orbitClock - 2.0;
  if (orbitClock < 0.0) orbitClock = orbitClock + 2.0;
  if (shimmerClock >= 10000.0) shimmerClock = shimmerClock - 10000.0;
  liveLevel = clamp01(level);
  liveSize = clamp01(cometSize);
}

export function render3D(index, x, y, z) {
  if (fixtureType == FIX_VINTAGE_6) {
    var head = pixelLocalIndex % 6.0;
    var darkHead = floor(orbitClock * 3.0) % 6.0;
    if (head == darkHead) {
      emitBlack();
      return;
    }
    if (head == (darkHead + 3.0) % 6.0) {
      emitBlack();
      return;
    }
    var headFlips = floor(orbitClock * 2.0 + shimmerClock * 0.5);
    var headParity = (head + headFlips) % 2.0;
    var headLevel = 0.52 + wave(shimmerClock * 0.5 + head / 6.0) * 0.34;
    var chasePink = floor(orbitClock * 6.0) % 6.0;
    var chaseBlue = (17.0 - floor(orbitClock * 5.0)) % 6.0;
    if (head == chasePink) headLevel = 0.94;
    if (head == chaseBlue) headLevel = 0.94;
    if (headParity < 1.0) emitBlue(headLevel);
    else emitPink(headLevel);
    return;
  }

  if (fixtureType == FIX_TE_SIGN) {
    var signAddress = index % 74.0;
    var signX = (signAddress % 10.0) / 9.0;
    var signY = floor(signAddress / 10.0) / 7.0;
    var signOrbitX = (signX - 0.50) / 0.46;
    var signOrbitY = (signY - 0.50) / 0.46;
    var signRadius = sqrt(signOrbitX * signOrbitX + signOrbitY * signOrbitY);
    var signAngle = atan2(signOrbitY, signOrbitX) / PI2;
    var signRing = clamp01((0.20 - abs(signRadius - 0.70)) / 0.30);
    var signPinkU = (signAngle - orbitClock * 2.4 + 8.0) * 2.0;
    var signPinkFrac = signPinkU - floor(signPinkU);
    var signPinkField = max(
      clamp01(1.0 - min(signPinkFrac, 1.0 - signPinkFrac) / 0.10),
      clamp01(1.0 - signPinkFrac / 0.20) * 0.75) * signRing;
    var signBlueU = (signAngle + orbitClock * 2.04 + 0.31 + 8.0) * 2.0;
    var signBlueFrac = signBlueU - floor(signBlueU);
    var signBlueField = max(
      clamp01(1.0 - min(signBlueFrac, 1.0 - signBlueFrac) / 0.10),
      clamp01(1.0 - signBlueFrac / 0.20) * 0.75) * signRing;
    var signBest = max(signPinkField, signBlueField);
    if (signBest > 0.14) {
      var signCometLevel = 0.62 + signBest * 0.36;
      if (signPinkField >= signBlueField) emitPink(signCometLevel);
      else emitBlue(signCometLevel);
      return;
    }
    var signWeaveU = (signX + signY) * 2.2 + 8.0;
    var signWeaveV = (signX - signY + 1.0) * 2.2 + 8.0;
    var signCellU = floor(signWeaveU);
    var signCellV = floor(signWeaveV);
    var signFracU = signWeaveU - signCellU;
    var signFracV = signWeaveV - signCellV;
    var signGrout = min(min(signFracU, 1.0 - signFracU),
                        min(signFracV, 1.0 - signFracV));
    if (signGrout < 0.09) {
      emitBlack();
      return;
    }
    var signParity = (signCellU + signCellV) % 2.0;
    var signLevel = 0.46 + wave(shimmerClock * 0.4 + signX * 1.7
                              + signY * 1.3) * 0.36;
    if (signParity < 1.0) emitBlue(signLevel);
    else emitPink(signLevel);
    return;
  }

  var dx = x - SHIP_CENTER_X;
  var dz = z - SHIP_CENTER_Z;
  var shipLong = 0.50 + dx * SHIP_AXIS_X + dz * SHIP_AXIS_Z;
  var shipWide = 0.50 + dx * (-SHIP_AXIS_Z) + dz * SHIP_AXIS_X;
  var vertMix = y * 0.55 + shipWide * 0.45;
  var crossMix = y * 0.75 - shipWide * 0.65;
  var orbitX = (shipLong - 0.55) / 0.58;
  var orbitY = (vertMix - 0.38) / 0.34;
  var orbitRadius = sqrt(orbitX * orbitX + orbitY * orbitY);
  var orbitAngle = atan2(orbitY, orbitX) / PI2;
  var ringMask = clamp01((0.18 - abs(orbitRadius - 0.85)) / 0.16);
  var headSpan = 0.10 + liveSize * 0.12;
  var pinkU = (orbitAngle - orbitClock + 8.0) * 3.0;
  var pinkFrac = pinkU - floor(pinkU);
  var pinkField = max(clamp01(1.0 - min(pinkFrac, 1.0 - pinkFrac) / headSpan),
                      clamp01(1.0 - pinkFrac / 0.24) * 0.75) * ringMask;
  var blueU = (orbitAngle + orbitClock * 0.85 + 0.31 + 8.0) * 3.0;
  var blueFrac = blueU - floor(blueU);
  var blueField = max(clamp01(1.0 - min(blueFrac, 1.0 - blueFrac) / headSpan),
                      clamp01(1.0 - blueFrac / 0.24) * 0.75) * ringMask;
  var bodyBest = max(pinkField, blueField);
  if (bodyBest > 0.12) {
    var cometLevel = 0.62 + bodyBest * 0.36;
    if (pinkField >= blueField) emitPink(cometLevel);
    else emitBlue(cometLevel);
    return;
  }
  var weaveU = vertMix * 4.0 + 8.5;
  var weaveV = crossMix * 4.0 + 8.5;
  var weaveCellU = floor(weaveU);
  var weaveCellV = floor(weaveV);
  var weaveFracU = weaveU - weaveCellU;
  var weaveFracV = weaveV - weaveCellV;
  var weaveGrout = min(min(weaveFracU, 1.0 - weaveFracU),
                       min(weaveFracV, 1.0 - weaveFracV));
  if (weaveGrout < 0.08) {
    emitBlack();
    return;
  }
  var groundParity = (floor(shipLong * 5.5 + 8.5) + weaveCellU
                    + weaveCellV) % 2.0;
  var groundLevel = 0.46 + wave(shimmerClock * 0.4 + vertMix * 1.9
                              + crossMix * 1.1) * 0.36;
  if (groundParity < 1.0) emitBlue(groundLevel);
  else emitPink(groundLevel);
}
