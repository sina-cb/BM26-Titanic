/*
  Argyle Weave (design doc 72, keeper K06).

  Two counter-sliding diagonal stripe systems duel for ownership over the whole
  hull. Pink threads climb bow-high, blue threads climb stern-high, and every
  pixel joins whichever of the two sinusoids is locally on top. The result is a
  field of argyle diamonds sliding in opposite diagonals: each diamond is ringed
  by the other family, so both colours sit on both halves of every axis at every
  moment and ownership never comes from a plane threshold.

  Local Speed is the safe first control. Level sets output. Weave Scale picks
  the diamond frequency along the hull. Black is designed twice over: the exact
  seam where the two stripe systems cross is cut to true black and reads as the
  argyle lattice line, and a slower cross-thread lace dims a second family of
  diagonals without extinguishing them.

  World geometry uses the all-smokestack ship frame only; raw hull coordinates
  appear once each to build it. Vintage fixtures run a six-head duel with a
  rotating pair of opposed black separator heads, which leaves two pink and two
  blue heads lit at all times. Both TE signs carry the same duel at a higher
  frequency and steeper diagonals, byte-identical by address.
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
export var level = 0.86;
export var weaveScale = 0.55;

export function sliderLocalSpeed(value) { localSpeed = value; }
export function sliderLevel(value) { level = value; }
export function sliderWeaveScale(value) { weaveScale = value; }

var pinkPhase = 0.0;
var bluePhase = 0.0;
var shimmerClock = 0.0;
var liveLevel = 0.86;
var liveScale = 0.55;

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
  // SPEED RETUNE (report _305). Base rates below are ×1.20 (operator: +20%).
  // The show's reference operating point is global SPEED 25 and
  // sliderLocalSpeed 0.30. The engine's global knob is EXPONENTIAL —
  // engine.js createRenderLoop: multiplier = 0.25 * 16^speed, so 25 is
  // 0.50x wall clock — and speedScale below is linear, so pattern time
  // advances at 0.50 * 0.845 = 0.4225x there. The factor is the operator's
  // field note applied at that reference point. Saved playlist defaults
  // are UNCHANGED — the retune lives here, in the pattern's own base rate.
  pinkPhase = pinkPhase + dt * 0.054 * speedScale;
  bluePhase = bluePhase + dt * 0.0336 * speedScale;
  shimmerClock = shimmerClock + dt * 0.1764 * speedScale;
  if (pinkPhase >= 2.0) pinkPhase = pinkPhase - 2.0;
  if (bluePhase >= 2.0) bluePhase = bluePhase - 2.0;
  if (shimmerClock >= 10000.0) shimmerClock = shimmerClock - 10000.0;
  liveLevel = clamp01(level);
  liveScale = clamp01(weaveScale);
}

export function render3D(index, x, y, z) {
  if (fixtureType == FIX_VINTAGE_6) {
    var head = pixelLocalIndex % 6.0;
    var darkHead = floor(pinkPhase * 3.0) % 6.0;
    if (head == darkHead) {
      emitBlack();
      return;
    }
    if (head == (darkHead + 3.0) % 6.0) {
      emitBlack();
      return;
    }
    var headFlips = floor(pinkPhase * 2.0 + bluePhase * 2.0);
    var headParity = (head + headFlips) % 2.0;
    var headPink = sin((head / 3.0 - pinkPhase) * PI2);
    var headBlue = sin((head / 6.0 + bluePhase + 0.37) * PI2);
    var headLevel = 0.52 + clamp01(max(headPink, headBlue)) * 0.40;
    if (abs(headPink - headBlue) < 0.22) headLevel = 0.30;
    if (headParity < 1.0) emitBlue(headLevel);
    else emitPink(headLevel);
    return;
  }

  if (fixtureType == FIX_TE_SIGN) {
    var signAddress = index % 74.0;
    var signX = (signAddress % 10.0) / 9.0;
    var signY = floor(signAddress / 10.0) / 7.0;
    var signFreq = 1.7 + liveScale * 1.0;
    var signDiagPink = (signX + signY * 0.85) * signFreq;
    var signDiagBlue = (signX * 0.70 - signY) * signFreq;
    var signStripePink = sin((signDiagPink - pinkPhase) * PI2);
    var signStripeBlue = sin((signDiagBlue + bluePhase + 0.37) * PI2);
    var signDuel = signStripePink - signStripeBlue;
    if (abs(signDuel) < 0.22) {
      emitBlack();
      return;
    }
    var signLevel = 0.52 + clamp01(max(signStripePink, signStripeBlue)) * 0.40;
    var signLace = abs(sin((signDiagPink + signDiagBlue
                          + shimmerClock * 0.35) * PI2));
    if (signLace < 0.15) signLevel = 0.30;
    if (signDuel > 0.0) emitPink(signLevel);
    else emitBlue(signLevel);
    return;
  }

  var dx = x - SHIP_CENTER_X;
  var dz = z - SHIP_CENTER_Z;
  var shipLong = 0.50 + dx * SHIP_AXIS_X + dz * SHIP_AXIS_Z;
  var shipWide = 0.50 + dx * (-SHIP_AXIS_Z) + dz * SHIP_AXIS_X;
  var weaveFreq = 2.6 + liveScale * 1.2;
  var weaveCross = y * 0.85 + shipWide * 0.80;
  var diagPink = (shipLong + weaveCross) * weaveFreq;
  var diagBlue = (shipLong - weaveCross) * weaveFreq;
  var stripePink = sin((diagPink - pinkPhase) * PI2);
  var stripeBlue = sin((diagBlue + bluePhase + 0.20) * PI2);
  var duel = stripePink - stripeBlue;
  if (abs(duel) < 0.16) {
    emitBlack();
    return;
  }
  var ownedLevel = 0.52 + clamp01(max(stripePink, stripeBlue)) * 0.40;
  var threadLace = abs(sin((diagPink + diagBlue - pinkPhase * 0.5
                          + bluePhase * 0.5) * PI2));
  if (threadLace < 0.15) ownedLevel = 0.30;
  if (duel > 0.0) emitPink(ownedLevel);
  else emitBlue(ownedLevel);
}
