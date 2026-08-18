/*
  Rotating Yin-Yang (design doc 72, keeper K03).

  Interlocking Baby Pink and Baby Blue hooks, each carrying the other colour's
  eye, rock and breathe around the ship. The ship-scale field is a travelling
  lattice of yin-yang medallions: inside every medallion one pink hook curls
  into blue territory and one blue hook curls back, and each hook holds a
  counter-coloured eye, so pink lives inside blue country and blue inside pink
  everywhere on the rig. Every medallion is point-antisymmetric, which makes the
  two families equal on any slice of the ship — the composition never
  degenerates into the half-and-half split that a single ship-scale S produces.
  Neighbouring medallions are counter-oriented by lattice parity, so the
  interlock reads even where two meet.

  Motion is territorial in two ways: the medallion lattice travels bow to stern
  on the turn clock, so hooks and eyes cross the hull, and the whole medallion
  frame rocks through a bounded angle on the breath clock. It never rotates far
  enough to perform a wholesale family-role inversion.

  Local Speed is the safe first control. Level sets output. Curl Depth sets how
  far each hook reaches into the other family and how fat the eyes are. Turn
  Reach sets the bounded rocking range. Black is designed: the medallion rims,
  the drawn S contour and the iris ring around each eye are exact black, which
  is what makes the interlock legible at 50 ft rather than reading as a smear.

  The medallion lattice runs along the ship axis and across a blended lateral
  coordinate (height plus beam), because beam alone is nearly degenerate on the
  titanic rig and height alone is nearly degenerate on the bench rig. World
  geometry uses the all-smokestack ship frame only; raw x/z appear once each to
  build it. Vintage fixtures are two opposing three-head hooks whose middle head
  flips to the other family (the local eyes), with one rotating black separator
  head. Both TE signs carry one full rocking medallion with both eyes,
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

export var localSpeed = 0.40;
export var level = 0.82;
export var curlDepth = 0.62;
export var turnReach = 0.48;

export function sliderLocalSpeed(value) { localSpeed = value; }
export function sliderLevel(value) { level = value; }
export function sliderCurlDepth(value) { curlDepth = value; }
export function sliderTurnReach(value) { turnReach = value; }

var turnClock = 0.0;
var breathClock = 0.0;
var liveLevel = 0.82;
var liveCurl = 0.62;
var liveTurn = 0.48;

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
  // SPEED RETUNE (report _305). Base rates below are ×1.15 (operator: +15%).
  // The show's reference operating point is global SPEED 25 and
  // sliderLocalSpeed 0.30. The engine's global knob is EXPONENTIAL —
  // engine.js createRenderLoop: multiplier = 0.25 * 16^speed, so 25 is
  // 0.50x wall clock — and speedScale below is linear, so pattern time
  // advances at 0.50 * 0.845 = 0.4225x there. The factor is the operator's
  // field note applied at that reference point. Saved playlist defaults
  // are UNCHANGED — the retune lives here, in the pattern's own base rate.
  turnClock = turnClock + dt * 0.067275 * speedScale;
  breathClock = breathClock + dt * 0.1088475 * speedScale;
  if (turnClock >= 2.0) turnClock = turnClock - 2.0;
  if (breathClock >= 10000.0) breathClock = breathClock - 10000.0;
  liveLevel = clamp01(level);
  liveCurl = clamp01(curlDepth);
  liveTurn = clamp01(turnReach);
}

export function render3D(index, x, y, z) {
  var angle = sin(breathClock * PI2) * (0.08 + liveTurn * 0.46);
  var angleCos = cos(angle);
  var angleSin = sin(angle);
  var hookReach = 0.20 + liveCurl * 0.11;
  var eyeReach = 0.062 + liveCurl * 0.042;

  if (fixtureType == FIX_VINTAGE_6) {
    var head = pixelLocalIndex % 6.0;
    var darkHead = floor(turnClock * 3.0) % 6.0;
    if (head == darkHead) {
      emitBlack();
      return;
    }
    var hookPink = 0.0;
    if (head >= 3.0) hookPink = 1.0;
    if (head == 1.0) hookPink = 1.0;
    if (head == 4.0) hookPink = 0.0;
    var headLevel = 0.50 + wave(breathClock * 0.6 + head * 0.17) * 0.34;
    if (head == 1.0) headLevel = 0.86;
    if (head == 4.0) headLevel = 0.86;
    if (hookPink < 0.5) emitBlue(headLevel);
    else emitPink(headLevel);
    return;
  }

  if (fixtureType == FIX_TE_SIGN) {
    var signAddress = index % 74.0;
    var signX = (signAddress % 10.0) / 9.0;
    var signY = floor(signAddress / 10.0) / 7.0;
    var signDx = signX - 0.50;
    var signDy = signY - 0.50;
    var signU = signDx * angleCos - signDy * angleSin;
    var signV = signDx * angleSin + signDy * angleCos;
    var signRad = sqrt(signU * signU + signV * signV);
    if (signRad > 0.58) {
      emitBlack();
      return;
    }
    var signTopD = sqrt(signU * signU + (signV - 0.25) * (signV - 0.25));
    var signBotD = sqrt(signU * signU + (signV + 0.25) * (signV + 0.25));
    if (abs(signTopD - 0.25) < 0.022) {
      emitBlack();
      return;
    }
    if (abs(signBotD - 0.25) < 0.022) {
      emitBlack();
      return;
    }
    var signPink = 0.0;
    if (signU > 0.0) signPink = 1.0;
    if (signTopD < 0.25) signPink = 1.0;
    if (signBotD < 0.25) signPink = 0.0;
    var signLevel = 0.48 + wave(signRad * 2.0 - breathClock * 0.38) * 0.32;
    if (signTopD < 0.090) { signPink = 0.0; signLevel = 0.88; }
    if (signBotD < 0.090) { signPink = 1.0; signLevel = 0.88; }
    if (signPink < 0.5) emitBlue(signLevel);
    else emitPink(signLevel);
    return;
  }

  var dx = x - SHIP_CENTER_X;
  var dz = z - SHIP_CENTER_Z;
  var shipLong = 0.50 + dx * SHIP_AXIS_X + dz * SHIP_AXIS_Z;
  var shipWide = 0.50 + dx * (-SHIP_AXIS_Z) + dz * SHIP_AXIS_X;
  var across = y * 0.62 + shipWide * 0.55 + 0.06;
  var latticeU = shipLong * 2.6 - turnClock + 6.75;
  var latticeV = across * 3.8 + 6.25;
  var cellU = floor(latticeU);
  var cellV = floor(latticeV);
  var localU = latticeU - cellU - 0.5;
  var localV = latticeV - cellV - 0.5;
  var rotU = localU * angleCos - localV * angleSin;
  var rotV = localU * angleSin + localV * angleCos;
  if ((cellU + cellV) % 2.0 >= 1.0) {
    rotU = 0.0 - rotU;
    rotV = 0.0 - rotV;
  }
  var medallion = sqrt(rotU * rotU + rotV * rotV);
  if (medallion > 0.58) {
    emitBlack();
    return;
  }
  var topD = sqrt(rotU * rotU + (rotV - hookReach) * (rotV - hookReach));
  var botD = sqrt(rotU * rotU + (rotV + hookReach) * (rotV + hookReach));
  if (abs(topD - hookReach) < 0.010) {
    emitBlack();
    return;
  }
  if (abs(botD - hookReach) < 0.010) {
    emitBlack();
    return;
  }
  if (abs(topD - eyeReach) < 0.009) {
    emitBlack();
    return;
  }
  if (abs(botD - eyeReach) < 0.009) {
    emitBlack();
    return;
  }
  var ownerPink = 0.0;
  if (rotU > 0.0) ownerPink = 1.0;
  if (topD < hookReach) ownerPink = 1.0;
  if (botD < hookReach) ownerPink = 0.0;
  var contour = wave(medallion * 2.1 - breathClock * 0.42 + y * 0.25);
  var ownedLevel = 0.46 + contour * 0.34;
  if (topD < eyeReach) {
    ownerPink = 0.0;
    ownedLevel = 0.58 + wave(breathClock * 0.5 + y * 0.3) * 0.26;
  }
  if (botD < eyeReach) {
    ownerPink = 1.0;
    ownedLevel = 0.58 + wave(breathClock * 0.5 + y * 0.3) * 0.26;
  }
  if (ownerPink < 0.5) emitBlue(ownedLevel);
  else emitPink(ownedLevel);
}
