/*
  Carousel Sectors (design doc 72, keeper K05).

  A six-blade pinwheel of alternating Baby Pink and Baby Blue spins over the
  whole ship in the smokestack-derived top plane. Three pink blades and three
  blue blades exist at every instant and opposite blades always carry opposite
  families, so no half of the ship is ever one colour. The blades sweep back as
  they run outward, so each one is a broad spiral rather than a straight spoke:
  that is what keeps the census steady, because a straight spoke lets the ship's
  lumpy angular pixel density sit inside a single blade. Blade edges also
  scallop with height, so the same blade arrives at different bearings on
  different decks and the sweep reads as a solid rotating fan, not a flat wipe.

  Local Speed is the safe first control. Direction reverses the spin (below 0.5
  reverses). Level sets output. Blade Scallop sets how much the blade edges bow
  with height. Black is designed: the gap between two blades is exact black and
  so is the hub, which is what keeps the blades reading as separate territories
  instead of a rotating blur.

  The polar frame uses the ship axis against a blended lateral coordinate
  (height plus beam) with the long axis compressed, because beam alone is nearly
  degenerate on the titanic rig and height alone is nearly degenerate on the
  bench rig; the blend gives a round point cloud and therefore even blades on
  both. World geometry uses the all-smokestack ship frame only; raw x/z appear
  once each to build it. Vintage fixtures run a six-head alternation whose parity
  advances with the spin, plus one rotating black separator head. Both TE signs
  carry the same local six-blade pinwheel turning at a third of the ship rate,
  byte-identical by address.
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

export var localSpeed = 0.45;
export var direction = 1.0;
export var level = 0.86;
export var bladeScallop = 0.55;

export function sliderLocalSpeed(value) { localSpeed = value; }
export function sliderDirection(value) { direction = value; }
export function sliderLevel(value) { level = value; }
export function sliderBladeScallop(value) { bladeScallop = value; }

var spinSectors = 0.0;
var breathClock = 0.0;
var liveLevel = 0.86;
var liveScallop = 0.55;

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
  var spinSign = 1.0;
  if (direction < 0.5) spinSign = -1.0;
  // SPEED RETUNE (report _305). Base rates below are ×1.15 (operator: +15%).
  // The show's reference operating point is global SPEED 25 and
  // sliderLocalSpeed 0.30. The engine's global knob is EXPONENTIAL —
  // engine.js createRenderLoop: multiplier = 0.25 * 16^speed, so 25 is
  // 0.50x wall clock — and speedScale below is linear, so pattern time
  // advances at 0.50 * 0.845 = 0.4225x there. The factor is the operator's
  // field note applied at that reference point. Saved playlist defaults
  // are UNCHANGED — the retune lives here, in the pattern's own base rate.
  spinSectors = spinSectors + dt * 0.13225 * speedScale * spinSign;
  breathClock = breathClock + dt * 0.113505 * speedScale;
  if (spinSectors >= 12.0) spinSectors = spinSectors - 12.0;
  if (spinSectors < 0.0) spinSectors = spinSectors + 12.0;
  if (breathClock >= 10000.0) breathClock = breathClock - 10000.0;
  liveLevel = clamp01(level);
  liveScallop = clamp01(bladeScallop);
}

export function render3D(index, x, y, z) {
  var breath = sin(breathClock * PI2);

  if (fixtureType == FIX_VINTAGE_6) {
    var head = pixelLocalIndex % 6.0;
    var darkHead = floor(spinSectors * 1.5) % 6.0;
    if (head == darkHead) {
      emitBlack();
      return;
    }
    var headSector = floor(head + spinSectors + 12.0);
    var headLevel = 0.50 + wave(breathClock * 0.5 + head * 0.1618) * 0.34;
    if (headSector % 2.0 < 1.0) emitBlue(headLevel);
    else emitPink(headLevel);
    return;
  }

  if (fixtureType == FIX_TE_SIGN) {
    var signAddress = index % 74.0;
    var signX = (signAddress % 10.0) / 9.0;
    var signY = floor(signAddress / 10.0) / 7.0;
    var signDx = signX - 0.50;
    var signDy = signY - 0.50;
    var signRadius = sqrt(signDx * signDx + signDy * signDy);
    if (signRadius < 0.09) {
      emitBlack();
      return;
    }
    var signAngle = atan2(signDy, signDx) / PI2 + 0.5;
    var signU = signAngle * 6.0 + spinSectors / 3.0 + 12.0;
    var signSector = floor(signU);
    var signFrac = signU - signSector;
    if (signFrac < 0.10) {
      emitBlack();
      return;
    }
    if (signFrac > 0.90) {
      emitBlack();
      return;
    }
    var signLevel = 0.48 + wave(signRadius * 2.2 - breathClock * 0.45) * 0.34;
    if (signSector % 2.0 < 1.0) emitBlue(signLevel);
    else emitPink(signLevel);
    return;
  }

  var dx = x - SHIP_CENTER_X;
  var dz = z - SHIP_CENTER_Z;
  var shipLong = 0.50 + dx * SHIP_AXIS_X + dz * SHIP_AXIS_Z;
  var shipWide = 0.50 + dx * (-SHIP_AXIS_Z) + dz * SHIP_AXIS_X;
  var across = y * 0.62 + shipWide * 0.55 + 0.06;
  var polarL = (shipLong - 0.52) * 0.72;
  var polarA = across - 0.52;
  var radius = sqrt(polarL * polarL + polarA * polarA);
  if (radius < 0.055) {
    emitBlack();
    return;
  }
  var scallop = sin(y * PI2 + breath * 0.7) * (0.02 + liveScallop * 0.055);
  var bladeU = atan2(polarA, polarL) / PI2 * 6.0 + 3.0
             + spinSectors + scallop * 6.0 + radius * 4.2 + 12.0;
  var sector = floor(bladeU);
  var bladeFrac = bladeU - sector;
  if (bladeFrac < 0.065) {
    emitBlack();
    return;
  }
  if (bladeFrac > 0.935) {
    emitBlack();
    return;
  }
  var bladeContour = wave(radius * 2.1 - breathClock * 0.42 + y * 0.25);
  var ownedLevel = 0.48 + bladeContour * 0.34;
  var spokeLace = abs(sin((radius * 2.6 + y * 0.4 - breathClock * 0.5) * PI2));
  if (spokeLace < 0.30) ownedLevel = ownedLevel * 0.42;
  if (sector % 2.0 < 1.0) emitBlue(ownedLevel);
  else emitPink(ownedLevel);
}
