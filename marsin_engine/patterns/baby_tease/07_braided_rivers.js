/*
  Braided Rivers (design doc 72, keeper K01).

  Long Baby Pink and Baby Blue river territories run the length of the hull and
  braid around each other. Ownership is the sign of a lane sinusoid whose phase
  is warped by a wave travelling along the ship axis, so the channels weave,
  neck and reconnect while every lateral half of the ship always carries both
  families. No whole-field inversion ever happens.

  Local Speed is the safe first control. Level sets output. Braid Width breathes
  the split/reconnect pressure. Current Bend sets the lateral weave depth of the
  centerlines; at the shipped default a centerline swings about a third of a
  channel width along the hull, which is what makes the crossings read at 50 ft.
  Black is designed: the banks between rivers are exact black and travelling
  oxbow shoals cut broad black pockets across both families, which is what keeps
  the channels reading as separate territories.

  The lane axis is a blended lateral coordinate (height plus beam) because beam
  alone is nearly degenerate on the titanic rig and height alone is nearly
  degenerate on the bench rig; the blend spans a full unit on both. The lane
  count is set high enough that every fixture family straddles several channels
  — with coarser lanes a single channel swallows a whole fixture group and
  swings the pink/blue census. World geometry uses the all-smokestack ship frame
  only; raw x/z appear once each to build it. Vintage fixtures run a six-head
  braid with one rotating black separator head. Both TE signs carry the same
  local lane weave, byte-identical by address.
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

export var localSpeed = 0.47;
export var level = 0.84;
export var braidWidth = 0.54;
export var currentBend = 0.66;

export function sliderLocalSpeed(value) { localSpeed = value; }
export function sliderLevel(value) { level = value; }
export function sliderBraidWidth(value) { braidWidth = value; }
export function sliderCurrentBend(value) { currentBend = value; }

var currentClock = 0.0;
var widthClock = 0.0;
var liveLevel = 0.84;
var liveWidth = 0.54;
var liveBend = 0.66;

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
  currentClock = currentClock + dt * 0.0420 * speedScale;
  widthClock = widthClock + dt * 0.1052 * speedScale;
  if (currentClock >= 10000.0) currentClock = currentClock - 10000.0;
  if (widthClock >= 10000.0) widthClock = widthClock - 10000.0;
  liveLevel = clamp01(level);
  liveWidth = clamp01(braidWidth);
  liveBend = clamp01(currentBend);
}

export function render3D(index, x, y, z) {
  if (fixtureType == FIX_VINTAGE_6) {
    var head = pixelLocalIndex % 6.0;
    var darkHead = floor(currentClock * 3.0) % 6.0;
    if (head == darkHead) {
      emitBlack();
      return;
    }
    var headLane = (head + floor(currentClock * 2.0)) % 2.0;
    var headLevel = 0.50 + wave(widthClock * 0.6 + head * 0.17) * 0.34;
    if (headLane < 1.0) emitBlue(headLevel);
    else emitPink(headLevel);
    return;
  }

  if (fixtureType == FIX_TE_SIGN) {
    var signAddress = index % 74.0;
    var signX = (signAddress % 10.0) / 9.0;
    var signY = floor(signAddress / 10.0) / 7.0;
    var signWeave = sin(signX * PI2 - currentClock * PI2)
                  * (0.35 + liveBend * 0.70);
    var signField = sin(signY * PI2 * 2.3 + signWeave)
                  + sin(signY * PI2 - signX * PI2 + widthClock * PI2)
                  * (0.10 + liveWidth * 0.20);
    if (abs(signField) < 0.22) {
      emitBlack();
      return;
    }
    var signLevel = 0.49 + wave(signX * 1.8 - currentClock * 0.72) * 0.34;
    if (signField > 0.0) emitBlue(signLevel);
    else emitPink(signLevel);
    return;
  }

  var dx = x - SHIP_CENTER_X;
  var dz = z - SHIP_CENTER_Z;
  var shipLong = 0.50 + dx * SHIP_AXIS_X + dz * SHIP_AXIS_Z;
  var shipWide = 0.50 + dx * (-SHIP_AXIS_Z) + dz * SHIP_AXIS_X;
  var across = y * 0.62 + shipWide * 0.55 + 0.06;
  var travel = shipLong * PI2 - currentClock * PI2;
  var lateralWeave = sin(travel) * (0.30 + liveBend * 2.20)
                   + sin(travel * 2.0 + widthClock * PI2 * 0.382)
                   * 0.90 * liveBend;
  var riverField = sin(across * PI2 * 5.4 + lateralWeave);
  var reconnect = sin(across * PI2 - shipLong * PI2 * 0.72 + widthClock * PI2)
                * (0.10 + liveWidth * 0.24);
  var field = riverField + reconnect;
  var bank = 0.09 + (1.0 - liveWidth) * 0.05;
  if (abs(field) < bank) {
    emitBlack();
    return;
  }
  var oxbowShoal = abs(sin((shipLong * 1.18 - currentClock
                          + sin(across * PI2 * 2.0) * 0.46) * PI2));
  if (oxbowShoal < 0.30) {
    emitBlack();
    return;
  }
  var currentRidge = wave(shipLong * 1.65 - currentClock * 0.83 + across * 0.28);
  var ownedLevel = 0.46 + currentRidge * 0.34;
  if (field > 0.0) emitBlue(ownedLevel);
  else emitPink(ownedLevel);
}
