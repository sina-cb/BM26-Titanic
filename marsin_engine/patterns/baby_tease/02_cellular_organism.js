/*
  Cellular Organism (design doc 72, keeper K02).

  Soft ship-scale pebbles tile the whole hull and slowly trade places. The cells
  are a deformed lattice: two travelling sinusoids bend the station and tier
  coordinates, a cubic superellipse rounds each cell into a pebble, and family
  is the parity of the cell address, so pink and blue pebbles interleave
  everywhere and no slice of the ship is ever one family. The lattice drifts
  bodily along and across the ship, which hands whole pebbles from one family to
  the other without inverting the rig, and the bending sinusoids squeeze
  neighbours past each other so the tissue visibly writhes.

  Local Speed is the safe first control. Level sets output. Cell Push sets both
  the lattice travel and how hard the cells deform each other. Black is
  designed: the interstitial grout between pebbles is exact black, and
  travelling pores cut broad black holes inside cells. Nuclei are the bright
  accents.

  The lateral tier axis is a blend of height and beam, because beam alone is
  nearly degenerate on the titanic rig and height alone is nearly degenerate on
  the bench rig. Parity over two lattice axes is what holds the census: each
  axis carries its own population bias and the parity of their sum multiplies
  those biases down, which a small set of hand-placed cell centers cannot do on
  a hull whose pixels are strongly bimodal along the ship axis. World geometry
  uses the all-smokestack ship frame only; raw x/z appear once each to build it.
  Vintage fixtures are six neighbouring cells with one rotating black separator
  head. Both TE signs carry the same deformed-lattice tissue in sign space,
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

export var localSpeed = 0.42;
export var level = 0.86;
export var cellPush = 0.58;

export function sliderLocalSpeed(value) { localSpeed = value; }
export function sliderLevel(value) { level = value; }
export function sliderCellPush(value) { cellPush = value; }

var bodyPhase = 1.55;
var membranePhase = 0.0;
var liveLevel = 0.86;
var livePush = 0.58;

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
  bodyPhase = bodyPhase + dt * 0.0430 * speedScale;
  membranePhase = membranePhase + dt * 0.0780 * speedScale;
  if (bodyPhase >= 10000.0) bodyPhase = bodyPhase - 10000.0;
  if (membranePhase >= 10000.0) membranePhase = membranePhase - 10000.0;
  liveLevel = clamp01(level);
  livePush = clamp01(cellPush);
}

export function render3D(index, x, y, z) {
  if (fixtureType == FIX_VINTAGE_6) {
    var head = pixelLocalIndex % 6.0;
    var darkHead = floor(bodyPhase * 3.0) % 6.0;
    if (head == darkHead) {
      emitBlack();
      return;
    }
    var headTier = floor(head * 0.5);
    var headStation = head % 2.0;
    var headPink = (headTier + headStation) % 2.0;
    var headLevel = 0.46 + wave(membranePhase * 0.7 + head * 0.1618) * 0.38;
    if (headPink < 1.0) emitBlue(headLevel);
    else emitPink(headLevel);
    return;
  }

  if (fixtureType == FIX_TE_SIGN) {
    var signAddress = index % 74.0;
    var signX = (signAddress % 10.0) / 9.0;
    var signY = floor(signAddress / 10.0) / 7.0;
    var signWarp = 0.12 + livePush * 0.16;
    var signSlide = sin(bodyPhase * PI2) * livePush * 0.30;
    var signLaneX = signX * 4.2
                  + sin(signY * PI2 * 1.4 + membranePhase * PI2) * signWarp;
    var signLaneY = signY * 3.6 + signSlide
                  + sin(signX * PI2 * 1.1 - membranePhase * PI2 * 0.5) * signWarp;
    var signCellX = floor(signLaneX + 24.0);
    var signCellY = floor(signLaneY + 24.0);
    var signFracX = signLaneX + 24.0 - signCellX;
    var signFracY = signLaneY + 24.0 - signCellY;
    var signPink = (signCellX + signCellY) % 2.0;
    var signReachX = abs(signFracX * 2.0 - 1.0);
    var signReachY = abs(signFracY * 2.0 - 1.0);
    var signBlob = 1.0 - (signReachX * signReachX * signReachX
                        + signReachY * signReachY * signReachY);
    if (signBlob < 0.20) {
      emitBlack();
      return;
    }
    var signPore = abs(sin((signX * 1.7 + signY * 1.3
                          - membranePhase * 0.5) * PI2));
    if (signPore < 0.18) {
      emitBlack();
      return;
    }
    var signLevel = 0.40 + clamp01(signBlob) * 0.26
                  + wave(membranePhase * 0.6 + signCellX * 0.1618
                       + signCellY * 0.2361) * 0.22;
    if (signPink < 0.5) emitBlue(signLevel);
    else emitPink(signLevel);
    return;
  }

  var dx = x - SHIP_CENTER_X;
  var dz = z - SHIP_CENTER_Z;
  var shipLong = 0.50 + dx * SHIP_AXIS_X + dz * SHIP_AXIS_Z;
  var shipWide = 0.50 + dx * (-SHIP_AXIS_Z) + dz * SHIP_AXIS_X;
  var across = y * 0.62 + shipWide * 0.55 + 0.06;
  var push = 0.035 + livePush * 0.105;
  var stationGap = 0.17;
  var tierGap = 0.17;
  var warp = 0.10 + livePush * 0.14;
  var tierDrift = sin(bodyPhase * PI2) * push * 1.0;
  var rollDrift = sin(bodyPhase * PI2 * 0.5) * push * 1.4;
  var laneL = (shipLong - rollDrift) / stationGap
            + sin(across * PI2 * 1.6 + membranePhase * PI2) * warp;
  var laneA = (across - tierDrift) / tierGap
            + sin(shipLong * PI2 * 1.1 - membranePhase * PI2 * 0.5) * warp;
  var cellL = floor(laneL + 24.0);
  var cellA = floor(laneA + 24.0);
  var fracL = laneL + 24.0 - cellL;
  var fracA = laneA + 24.0 - cellA;
  var cellPink = (cellL + cellA) % 2.0;
  var reachL = abs(fracL * 2.0 - 1.0);
  var reachA = abs(fracA * 2.0 - 1.0);
  var blob = 1.0 - (reachL * reachL * reachL + reachA * reachA * reachA);
  if (blob < 0.16) {
    emitBlack();
    return;
  }
  var poreOne = abs(sin((shipLong * 0.66 + y * 0.41
                       - membranePhase * 0.43) * PI2));
  var poreTwo = abs(sin((across * 0.59 - shipLong * 0.35
                       + membranePhase * 0.31) * PI2));
  if (min(poreOne, poreTwo) < 0.20) {
    emitBlack();
    return;
  }
  var membrane = clamp01((blob - 0.16) * 2.6);
  var nucleus = clamp01((blob - 0.55) * 2.4);
  var interior = wave(membranePhase * 0.37 + cellL * 0.1618 + cellA * 0.2361);
  var cellLevel = 0.36 + membrane * 0.22 + nucleus * 0.26 + interior * 0.14;
  if (cellPink < 0.5) emitBlue(cellLevel);
  else emitPink(cellLevel);
}
