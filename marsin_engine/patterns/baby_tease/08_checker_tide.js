/*
  Checker Tide (design doc 72, keeper K04).

  A giant pink/blue checkerboard laid over the whole ship in the smokestack
  frame. A slow diagonal inversion front sweeps bow to stern and repaints the
  board into its own negative as it passes, so every tile hosts both families
  across a cycle while the instantaneous picture is always a crisp checker.
  Ownership comes from lattice parity, never from a plane threshold, so both
  families sit on both halves of every axis at every moment.

  Local Speed is the safe first control. Level sets output. Tile Grain picks
  3-5 tiles along the hull. Black is the tile grout and it is designed: the
  seam between tiles is exact black, which is what keeps the two families
  reading as separate territories rather than a blend.

  The inversion front is diagonal in all three ship axes at once, which is what
  keeps the census near 50/50 on both rigs: a front aligned to a single axis
  flips whole blocks of the hull together and swings the pink/blue balance.

  World geometry uses the all-smokestack ship frame only; raw x/z appear once
  each to build it. Vintage fixtures run a six-head mini checker with one
  rotating black separator head. Both TE signs carry the same 4x3 mini checker
  with the same inversion wave, byte-identical by address.
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
export var tileGrain = 0.5;

export function sliderLocalSpeed(value) { localSpeed = value; }
export function sliderLevel(value) { level = value; }
export function sliderTileGrain(value) { tileGrain = value; }

var tideClock = 0.0;
var shimmerClock = 0.0;
var liveLevel = 0.86;
var liveGrain = 0.5;

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
  // SPEED RETUNE (report _305). Base rates below are ×3.5 — ESTIMATE. The operator said "toooo slow" without a reference
  // setting, so this is a judged 3-4x bracket, not a measured equivalence.
  // Re-measure on the rig and adjust THIS constant pair.
  // The show's reference operating point is global SPEED 25 and
  // sliderLocalSpeed 0.30. The engine's global knob is EXPONENTIAL —
  // engine.js createRenderLoop: multiplier = 0.25 * 16^speed, so 25 is
  // 0.50x wall clock — and speedScale below is linear, so pattern time
  // advances at 0.50 * 0.845 = 0.4225x there. The factor is the operator's
  // field note applied at that reference point. Saved playlist defaults
  // are UNCHANGED — the retune lives here, in the pattern's own base rate.
  tideClock = tideClock + dt * 0.1925 * speedScale;
  shimmerClock = shimmerClock + dt * 0.5985 * speedScale;
  if (tideClock >= 2.0) tideClock = tideClock - 2.0;
  if (shimmerClock >= 10000.0) shimmerClock = shimmerClock - 10000.0;
  liveLevel = clamp01(level);
  liveGrain = clamp01(tileGrain);
}

export function render3D(index, x, y, z) {
  if (fixtureType == FIX_VINTAGE_6) {
    var head = pixelLocalIndex % 6.0;
    var headTick = floor(tideClock * 3.0);
    // The separator's OWN parity must alternate. With `darkHead = headTick % 6`
    // the blacked-out head is (headTick + headTick) % 2 == 0 every single tick,
    // so the separator always eats a blue head and every Vintage sits at a
    // permanent 3 pink / 2 blue — a standing pink bias across 10 % of the rig.
    // The removed head's family is floor(headTick / 3) % 2, and tideClock wraps
    // at 2.0 so headTick only ever runs 0..5 — dividing by 3 is what splits
    // those six ticks 3/3 between the families. (Dividing by 2 gives 4/2 and
    // leaves a smaller but still permanent bias.)
    var darkHead = (headTick + floor(headTick / 3.0) + 3.0) % 6.0;
    if (head == darkHead) {
      emitBlack();
      return;
    }
    // The flip count is per-FIXTURE, not per-head: a per-head phase makes
    // floor() land differently on neighbouring heads and collapses the
    // alternation to 4-1, which breaks the ">=2 of each family" fixture gate.
    // A single tick keeps the six heads strictly alternating (3/3), so removing
    // the rotating black separator always leaves 3/2 or 2/3.
    var headParity = (head + headTick + 12.0) % 2.0;
    var headLevel = 0.50 + wave(shimmerClock * 0.6 + head * 0.17) * 0.32;
    if (tideClock * 3.0 - headTick < 0.10) headLevel = 0.95;
    if (headParity < 1.0) emitBlue(headLevel);
    else emitPink(headLevel);
    return;
  }

  if (fixtureType == FIX_TE_SIGN) {
    var signAddress = index % 74.0;
    var signX = (signAddress % 10.0) / 9.0;
    var signY = floor(signAddress / 10.0) / 7.0;
    var signU = signX * 4.0;
    var signV = signY * 3.0;
    var signCellX = floor(signU);
    var signCellY = floor(signV);
    var signWave = tideClock * 1.5 - (signX * 0.85 + signY * 0.35);
    if (signWave < 0.0) signWave = signWave + 3.0;
    if (signWave < 0.0) signWave = signWave + 3.0;
    var signFlips = floor(signWave);
    var signParity = (signCellX + signCellY + signFlips + 24.0) % 2.0;
    var signGrout = min(min(signU - signCellX, 1.0 - (signU - signCellX)),
                        min(signV - signCellY, 1.0 - (signV - signCellY)));
    if (signGrout < 0.10) {
      emitBlack();
      return;
    }
    var signLevel = 0.52 + wave(shimmerClock * 0.5 + signCellX * 0.29
                              + signCellY * 0.37) * 0.34;
    if (signWave - signFlips < 0.07) signLevel = 0.92;
    if (signParity < 1.0) emitBlue(signLevel);
    else emitPink(signLevel);
    return;
  }

  var dx = x - SHIP_CENTER_X;
  var dz = z - SHIP_CENTER_Z;
  var shipLong = 0.50 + dx * SHIP_AXIS_X + dz * SHIP_AXIS_Z;
  var shipWide = 0.50 + dx * (-SHIP_AXIS_Z) + dz * SHIP_AXIS_X;
  var tilesL = 3.0 + floor(liveGrain * 2.0);
  var scaledL = shipLong * tilesL;
  var scaledY = y * 3.0 + 0.5;
  var scaledW = shipWide * 4.0 + 0.5;
  var cellL = floor(scaledL);
  var cellY = floor(scaledY);
  var cellW = floor(scaledW);
  var baseParity = (cellL + cellY + cellW + 24.0) % 2.0;
  var wavePhase = tideClock - (shipLong * 3.40 + y * 0.35 + shipWide * 0.90) + 6.0;
  var flips = floor(wavePhase);
  var parity = (baseParity + flips) % 2.0;
  var fl = scaledL - cellL;
  var fy = scaledY - cellY;
  var grout = min(min(fl, 1.0 - fl), min(fy, 1.0 - fy));
  if (grout < 0.085) {
    emitBlack();
    return;
  }
  var tileShade = 0.54 + wave(shimmerClock * 0.5 + cellL * 0.23 + cellY * 0.31
                            + cellW * 0.17) * 0.32;
  if (wavePhase - flips < 0.045) tileShade = 0.92;
  if (parity < 1.0) emitBlue(tileShade);
  else emitPink(tileShade);
}
