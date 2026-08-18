/*
  Rail Exchange (design doc 72, keeper K08).

  Stacked pink and blue rails run the length of the ship. Neighbouring rails
  always hold opposite families and their pulse trains stream in opposite
  directions, so the hull reads as a set of counter-running conveyor belts. Two
  slow inversion fronts — one sweeping bow to stern, one climbing the stack —
  arrive independently and repaint every rail into its own negative as they
  pass, which is the exchange: the rails trade lanes without ever breaking the
  strict alternation, so the instantaneous census is always half pink, half
  blue no matter where the fronts are.

  Local Speed is the safe first control. Direction flips every stream. Level
  sets output. Stream Density sets how tightly the pulses are packed along the
  hull. Black is designed: the gap between rails is cut to exact black and
  reads as the rail bed, which is what keeps neighbouring families from
  bleeding into each other.

  World geometry uses the all-smokestack ship frame only; raw hull coordinates
  appear once each to build it. The rail coordinate blends height with the beam
  axis so the stack resolves on both the full ship and the test bench, where
  height alone collapses to a single rail. Vintage fixtures run six micro-rails
  with one rotating black separator head. Both TE signs carry four mini-rails
  with the same trade rule, byte-identical by address.
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
export var streamDensity = 0.5;

export function sliderLocalSpeed(value) { localSpeed = value; }
export function sliderDirection(value) { direction = value; }
export function sliderLevel(value) { level = value; }
export function sliderStreamDensity(value) { streamDensity = value; }

var tradeClock = 0.0;
var flowClock = 0.0;
var shimmerClock = 0.0;
var liveLevel = 0.86;
var liveDensity = 0.5;

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
  var flowSign = 1.0;
  if (direction < 0.5) flowSign = -1.0;
  // SPEED RETUNE (report _305). Base rates below are ×7.85 (exact equivalence 7.849).
  // The show's reference operating point is global SPEED 25 and
  // sliderLocalSpeed 0.30. The engine's global knob is EXPONENTIAL —
  // engine.js createRenderLoop: multiplier = 0.25 * 16^speed, so 25 is
  // 0.50x wall clock — and speedScale below is linear, so pattern time
  // advances at 0.50 * 0.845 = 0.4225x there. The factor moves
  // the look the operator approved at global SPEED 72 / sliderLocalSpeed 0.88
  // onto that reference point. Saved playlist defaults are UNCHANGED — the
  // retune lives here, in the pattern's own base rate.
  tradeClock = tradeClock + dt * 0.25905 * speedScale;
  flowClock = flowClock + dt * 1.3345 * speedScale * flowSign;
  shimmerClock = shimmerClock + dt * 0.8635 * speedScale;
  if (tradeClock >= 2.0) tradeClock = tradeClock - 2.0;
  if (flowClock >= 10000.0) flowClock = flowClock - 10000.0;
  if (flowClock < 0.0) flowClock = flowClock + 10000.0;
  if (shimmerClock >= 10000.0) shimmerClock = shimmerClock - 10000.0;
  liveLevel = clamp01(level);
  liveDensity = clamp01(streamDensity);
}

export function render3D(index, x, y, z) {
  if (fixtureType == FIX_VINTAGE_6) {
    var head = pixelLocalIndex % 6.0;
    var darkHead = floor(tradeClock * 3.0 + shimmerClock * 1.4) % 6.0;
    if (head == darkHead) {
      emitBlack();
      return;
    }
    var headFlips = floor(tradeClock * 2.0 + flowClock * 0.4);
    var headParity = (head + headFlips) % 2.0;
    var headPhase = head * 0.31 + flowClock * 2.0;
    if (headParity < 1.0) headPhase = head * 0.31 - flowClock * 2.0;
    var headLevel = 0.52 + wave(headPhase) * 0.40;
    if (headParity < 1.0) emitBlue(headLevel);
    else emitPink(headLevel);
    return;
  }

  if (fixtureType == FIX_TE_SIGN) {
    var signAddress = index % 74.0;
    var signX = (signAddress % 10.0) / 9.0;
    var signY = floor(signAddress / 10.0) / 7.0;
    var signRailU = signY * 4.0;
    var signRail = floor(signRailU);
    var signGap = signRailU - signRail;
    if (abs(signGap - 0.5) > 0.42) {
      emitBlack();
      return;
    }
    var signFront = tradeClock * 1.6 - signX * 0.9 + 6.0;
    var signParity = (signRail + floor(signFront)) % 2.0;
    var signPhase = signX * 2.2 + signRail * 0.31 + flowClock * 1.6;
    if (signParity < 1.0) signPhase = signX * 2.2 + signRail * 0.31
                                    - flowClock * 1.6;
    var signLevel = 0.52 + wave(signPhase) * 0.40;
    if (signParity < 1.0) emitBlue(signLevel);
    else emitPink(signLevel);
    return;
  }

  var dx = x - SHIP_CENTER_X;
  var dz = z - SHIP_CENTER_Z;
  var shipLong = 0.50 + dx * SHIP_AXIS_X + dz * SHIP_AXIS_Z;
  var shipWide = 0.50 + dx * (-SHIP_AXIS_Z) + dz * SHIP_AXIS_X;
  var railCoord = y * 0.65 + shipWide * 0.70;
  var railU = railCoord * 9.0 + 8.0;
  var railCell = floor(railU);
  var railGap = railU - railCell;
  if (abs(railGap - 0.5) > 0.42) {
    emitBlack();
    return;
  }
  var tradeFront = tradeClock - shipLong * 0.85 + 6.0;
  var stackFront = tradeClock * 0.62 - railCoord * 1.2 + 6.0;
  var railParity = (railCell + floor(tradeFront) + floor(stackFront)) % 2.0;
  var streamFreq = 1.6 + liveDensity * 1.4;
  var streamPhase = shipLong * streamFreq + railCell * 0.31 + flowClock;
  if (railParity < 1.0) streamPhase = shipLong * streamFreq + railCell * 0.31
                                    - flowClock;
  var ownedLevel = 0.50 + wave(streamPhase) * 0.42;
  if (tradeFront - floor(tradeFront) < 0.05) ownedLevel = 0.92;
  if (railParity < 1.0) emitBlue(ownedLevel);
  else emitPink(ownedLevel);
}
