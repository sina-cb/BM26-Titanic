/*
  Bullseye Tide (design doc 72, keeper K10).

  Concentric pink and blue rings expand forever out of the heart of the ship.
  Ownership is ring parity in a radial lattice, so every ring hosts the family
  its neighbours do not and both colors sit on both halves of every axis at
  every instant. A slow outward drift walks the whole board one ring at a time,
  so a fixed point on the hull trades family as each shell passes it. The
  smokestacks are the outermost shells, so the crest crossing the stack chains
  is the pattern's downbeat.

  Local Speed is the safe first control. Level sets output. Ring Count picks how
  tightly the shells are packed. Black is designed: every ring seam is exact
  black, which is what keeps the shells reading as separate territories instead
  of a gradient.

  World geometry uses the all-smokestack ship frame only; raw coordinates appear
  once each to build it. The radius mixes hull length, height and ship width so
  neither rig's degenerate axis can flatten the bullseye, and a small angular
  wobble keeps the shells from landing as clean bands on any one fixture.
  Vintage fixtures pass the ring front head to head with one rotating black
  separator head. Both TE signs carry a three-ring mini bullseye on the same
  clock, byte-identical by address.
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

export var localSpeed = 0.42;
export var level = 0.85;
export var ringCount = 0.5;

export function sliderLocalSpeed(value) { localSpeed = value; }
export function sliderLevel(value) { level = value; }
export function sliderRingCount(value) { ringCount = value; }

var ringClock = 0.0;
var shimmerClock = 0.0;
var liveLevel = 0.85;
var liveRings = 0.5;

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
  ringClock = ringClock + dt * 0.050 * speedScale;
  shimmerClock = shimmerClock + dt * 0.170 * speedScale;
  if (ringClock >= 2.0) ringClock = ringClock - 2.0;
  if (shimmerClock >= 10000.0) shimmerClock = shimmerClock - 10000.0;
  liveLevel = clamp01(level);
  liveRings = clamp01(ringCount);
}

export function render3D(index, x, y, z) {
  if (fixtureType == FIX_VINTAGE_6) {
    var head = pixelLocalIndex % 6.0;
    var darkHead = floor(shimmerClock * 1.5) % 6.0;
    if (head == darkHead) {
      emitBlack();
      return;
    }
    var headU = head / 5.0 * 3.0 + 6.0 - ringClock * 2.0;
    var headStep = floor(headU);
    var headFrac = headU - headStep;
    var headParity = (head + floor(ringClock * 2.0 + 6.0)) % 2.0;
    var headLevel = 0.40 + wave(headFrac * 1.1 + shimmerClock * 0.5) * 0.26;
    if (headFrac > 0.42) {
      if (headFrac < 0.65) headLevel = headLevel + 0.34;
    }
    if (headParity < 1.0) emitBlue(headLevel);
    else emitPink(headLevel);
    return;
  }

  if (fixtureType == FIX_TE_SIGN) {
    var signAddress = index % 74.0;
    var signX = (signAddress % 10.0) / 9.0;
    var signY = floor(signAddress / 10.0) / 7.0;
    var signDX = signX - 0.50;
    var signDY = signY - 0.50;
    var signR = sqrt(signDX * signDX + signDY * signDY * 0.75);
    var signAng = atan2(signDY, signDX);
    var signRingU = signR * 5.2 + sin(signAng * 3.0) * 0.16 + 8.0 - ringClock * 2.0;
    var signRing = floor(signRingU);
    var signFrac = signRingU - signRing;
    if (signFrac < 0.13) {
      emitBlack();
      return;
    }
    var signParity = (signRing + 24.0) % 2.0;
    var signLevel = 0.42 + wave(signFrac * 1.1 + shimmerClock * 0.5 + signR * 0.9) * 0.26;
    if (signFrac > 0.42) {
      if (signFrac < 0.66) signLevel = signLevel + 0.32;
    }
    if (signParity < 1.0) emitBlue(signLevel);
    else emitPink(signLevel);
    return;
  }

  var dx = x - SHIP_CENTER_X;
  var dz = z - SHIP_CENTER_Z;
  var shipLong = 0.50 + dx * SHIP_AXIS_X + dz * SHIP_AXIS_Z;
  var shipWide = 0.50 + dx * (-SHIP_AXIS_Z) + dz * SHIP_AXIS_X;
  var radialL = (shipLong - 0.50) * 1.15;
  var radialY = (y - 0.52) * 1.40;
  var radialW = (shipWide - 0.50) * 2.40;
  var radius = sqrt(radialL * radialL + radialY * radialY + radialW * radialW);
  var bearing = atan2(radialY * 0.7 + radialW * 0.7, radialL);
  var ringScale = 10.0 + liveRings * 4.0;
  var ringU = radius * ringScale + sin(bearing * 5.0) * 0.20 + 8.0 - ringClock;
  var ring = floor(ringU);
  var ringFrac = ringU - ring;
  if (ringFrac < 0.10) {
    emitBlack();
    return;
  }
  var ringParity = (ring + 24.0) % 2.0;
  var ringLevel = 0.40 + wave(ringFrac * 1.1 + shimmerClock * 0.5 + radius * 0.9) * 0.26;
  if (ringFrac > 0.42) {
    if (ringFrac < 0.65) ringLevel = ringLevel + 0.34;
  }
  if (ringParity < 1.0) emitBlue(ringLevel);
  else emitPink(ringLevel);
}
