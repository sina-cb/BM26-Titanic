/*
  16_turning_tiles.js — TURNING TILES

  CONCEPT
    Broad diamond tiles independently turn between the two selected palette
    materials. Stable dark grout and long held faces make this a finite wall
    of objects, not a continuous interference field.

  INSTRUMENT STAGING
    FIX_BAR_18     — the large tiled Hull Canvas and its material faces.
    FIX_RAW_LED    — a bright border procession around the Silhouette.
    FIX_VINTAGE_6  — sparse palette-RGB catches as individual tiles turn.
    FIX_PAR        — weighted studs that echo the three flip cohorts.
    FIX_TE_SIGN    — identical paired 10x8 tiled medallions with a firm floor.

  MOTION / MATH
    World X/Y/Z are projected into a rotated diamond grid. Every finite cell
    receives one of three explicit orientation cohorts plus a golden-angle
    phase offset. A cosine face term foreshortens each tile only during its
    brief cubic flip; the long holds keep fewer than one quarter edge-on at
    once. Grout is an analytic cell-boundary distance and never swims.

  CONTROLS (declaration order = physical MIDI order)
    localSpeed   — cadence of independent tile flips.
    tileSize     — physical scale of the broad diamond cells.
    faceDepth    — depth and contrast of face foreshortening.
    faceHold     — time each material remains fully presented.
    grout        — width and definition of the stable dark tile seams.
    jewelryCatch — strength of sparse RGB catches on Vintage rails.
    safetyFloor  — minimum whole-rig visibility between turning faces.

  AUDIO_MODULATION_V1:
    sliderFaceDepth    <- micFlux range 0.20..0.58 curve ease # spectral change deepens each tile turn
    sliderJewelryCatch <- micHigh range 0.03..0.30 curve pow2 # high detail lifts sparse Jewelry catches
  Static (unmapped) params: localSpeed, tileSize, faceHold, grout,
    safetyFloor, colorPalette1/2.

  COLOR / OUTPUT
    Every RGB sample lies strictly on the cp1-to-cp2 line. The pattern emits
    no native white and no UV, so W=A=U=0. Silence remains a complete, safely
    visible composition on both supported models.
*/

export var localSpeed = 0.30;
export var tileSize = 0.56;
export var faceDepth = 0.40;
export var faceHold = 0.64;
export var grout = 0.46;
export var jewelryCatch = 0.26;
export var safetyFloor = 0.28;

export var cp1H = 0.565, cp1S = 0.78, cp1V = 0.94;
export var cp2H = 0.085, cp2S = 0.84, cp2V = 1.00;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderTileSize(v) { tileSize = v; }
export function sliderFaceDepth(v) { faceDepth = v; }
export function sliderFaceHold(v) { faceHold = v; }
export function sliderGrout(v) { grout = v; }
export function sliderJewelryCatch(v) { jewelryCatch = v; }
export function sliderSafetyFloor(v) { safetyFloor = v; }

var GOLDEN_FRACTION = 0.38196601;
var GOLDEN_ANGLE = 2.39996323;
var SQRT2 = 1.41421356;
var SQRT3 = 1.73205081;
var PHASE_WRAP = 30000.0;

var flipClock = 0.0;
var borderClock = 0.0;
var liveTileSize = 0.56;
var liveFaceDepth = 0.40;
var liveFaceHold = 0.64;
var liveGrout = 0.46;
var liveJewelryCatch = 0.26;
var liveSafetyFloor = 0.28;

var pr1 = 1.0, pg1 = 0.0, pb1 = 0.0;
var pr2 = 0.0, pg2 = 0.0, pb2 = 1.0;

function clamp01(v) {
  if (v < 0.0) return 0.0;
  if (v > 1.0) return 1.0;
  return v;
}

function smooth01(v) {
  var sv = clamp01(v);
  return sv * sv * (3.0 - 2.0 * sv);
}

function _hsv2rgb1() {
  var hv = cp1H - floor(cp1H); if (hv < 0.0) hv += 1.0;
  var iv = floor(hv * 6.0) % 6.0;
  var fv = hv * 6.0 - floor(hv * 6.0);
  var pv = cp1V * (1.0 - cp1S);
  var qv = cp1V * (1.0 - fv * cp1S);
  var tv = cp1V * (1.0 - (1.0 - fv) * cp1S);
  if      (iv == 0.0) { pr1 = cp1V; pg1 = tv;   pb1 = pv;   }
  else if (iv == 1.0) { pr1 = qv;   pg1 = cp1V; pb1 = pv;   }
  else if (iv == 2.0) { pr1 = pv;   pg1 = cp1V; pb1 = tv;   }
  else if (iv == 3.0) { pr1 = pv;   pg1 = qv;   pb1 = cp1V; }
  else if (iv == 4.0) { pr1 = tv;   pg1 = pv;   pb1 = cp1V; }
  else                 { pr1 = cp1V; pg1 = pv;   pb1 = qv;   }
}

function _hsv2rgb2() {
  var hv = cp2H - floor(cp2H); if (hv < 0.0) hv += 1.0;
  var iv = floor(hv * 6.0) % 6.0;
  var fv = hv * 6.0 - floor(hv * 6.0);
  var pv = cp2V * (1.0 - cp2S);
  var qv = cp2V * (1.0 - fv * cp2S);
  var tv = cp2V * (1.0 - (1.0 - fv) * cp2S);
  if      (iv == 0.0) { pr2 = cp2V; pg2 = tv;   pb2 = pv;   }
  else if (iv == 1.0) { pr2 = qv;   pg2 = cp2V; pb2 = pv;   }
  else if (iv == 2.0) { pr2 = pv;   pg2 = cp2V; pb2 = tv;   }
  else if (iv == 3.0) { pr2 = pv;   pg2 = qv;   pb2 = cp2V; }
  else if (iv == 4.0) { pr2 = tv;   pg2 = pv;   pb2 = qv;   }
  else                 { pr2 = cp2V; pg2 = pv;   pb2 = qv;   }
}

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  // Controls glide into the geometry so live edits never tear the tile map.
  var follow = min(1.0, dt * 4.0);
  liveTileSize += (tileSize - liveTileSize) * follow;
  liveFaceDepth += (faceDepth - liveFaceDepth) * follow;
  liveFaceHold += (faceHold - liveFaceHold) * follow;
  liveGrout += (grout - liveGrout) * follow;
  liveJewelryCatch += (jewelryCatch - liveJewelryCatch) * follow;
  liveSafetyFloor += (safetyFloor - liveSafetyFloor) * follow;

  var speedMultiplier = 0.25 + clamp01(localSpeed)
    * (32.824 - 16.412 * clamp01(localSpeed));
  flipClock += dt * 0.078 * speedMultiplier;
  borderClock += dt * 0.041 * speedMultiplier;
  if (flipClock >= PHASE_WRAP) flipClock -= PHASE_WRAP;
  if (borderClock >= PHASE_WRAP) borderClock -= PHASE_WRAP;

  _hsv2rgb1();
  _hsv2rgb2();
}

export function render3D(index, x, y, z) {
  var ux = clamp01(x);
  var uy = clamp01(y);
  var uz = clamp01(z);
  var isSign = fixtureType == FIX_TE_SIGN;

  if (isSign) {
    // Author the two physical fixtures as one complete 74-pixel tiled surface.
    var signIndex = index % 74.0;
    ux = (signIndex % 10.0) / 9.0;
    uy = floor(signIndex / 10.0) / 7.0;
    uz = 0.50;
  }

  // A continuous world projection lets the diamonds cross fixture seams.
  // Rotating the two axes by 45 degrees turns square cells into diamonds.
  var horizontal = 0.68 * ux + 0.32 * uz;
  var vertical = 0.86 * uy + 0.14 * uz;
  var density = 7.2 - clamp01(liveTileSize) * 4.2;
  var gridA = (horizontal + vertical) * density;
  var gridB = (horizontal - vertical + 1.0) * density;
  var cellA = floor(gridA);
  var cellB = floor(gridB);
  var localA = gridA - cellA - 0.50;
  var localB = gridB - cellB - 0.50;

  // Distance to the finite diamond boundary. The seam never depends on time.
  var boundaryDistance = 0.50 - max(abs(localA), abs(localB));
  var groutWidth = 0.010 + clamp01(liveGrout) * 0.070;
  var seam = 1.0 - smoothstep(groutWidth,
                              groutWidth * 2.25, boundaryDistance);

  // Three explicit cohorts ensure multiple face orientations at every frame.
  // Golden-angle phase separates neighboring cells without random state.
  var integerKey = abs(cellA * 7.0 + cellB * 11.0);
  var cohort = integerKey % 3.0;
  var phaseOffset = cohort / 3.0
                  + frac(abs(cellA * 13.0 - cellB * 17.0)
                       * GOLDEN_FRACTION) * 0.23;
  var cycle = frac(flipClock + phaseOffset);
  var half = floor(cycle * 2.0);
  var halfPhase = cycle * 2.0 - half;
  var holdPoint = 0.48 + clamp01(liveFaceHold) * 0.38;
  var turnProgress = 0.0;
  if (halfPhase > holdPoint) {
    turnProgress = smooth01((halfPhase - holdPoint)
                           / (1.0 - holdPoint));
  }
  var material = turnProgress;
  if (half >= 1.0) material = 1.0 - turnProgress;

  // Cosine foreshortening creates an actual turning face. Even at maximum
  // depth, the tile safety bed and bright grout preserve the vessel outline.
  var face = abs(cos(material * PI));
  var depth = 0.18 + clamp01(liveFaceDepth) * 0.82;
  var foreshortening = 1.0 - (1.0 - face) * depth;
  var cohortLight = 0.5 + 0.5 * cos(cohort * PI2 / 3.0
                                  + material * PI * SQRT2);
  var floorLevel = 0.055 + clamp01(liveSafetyFloor) * 0.245;
  // Deeper turns narrow the face while a restrained face-light preserves
  // material detail. Grout is subtractive and fixed in world space: it must
  // read as a dark joint between physical tiles, never as a bright lattice.
  var tileBody = (0.42 + cohortLight * 0.30) * foreshortening
               + clamp01(liveFaceDepth) * 0.08;
  var groutShadow = 1.0 - seam * (0.46 + liveGrout * 0.43);
  var brightness = floorLevel + (1.0 - floorLevel)
                 * clamp01(tileBody * groutShadow);
  var paletteMix = clamp01(0.08 + material * 0.84
                          + (cohort - 1.0) * 0.055);

  if (fixtureType == FIX_BAR_18) {
    // The bars are the broad material faces. Darker grout and strong endpoint
    // color separation keep every finite tile readable from playa distance.
    brightness = floorLevel + (1.0 - floorLevel)
               * clamp01(tileBody * groutShadow * 1.08);
  } else if (fixtureType == FIX_RAW_LED) {
    // Fixture-local travel creates a procession around the ship's outline;
    // the world-space seam still ties it visually to the Hull tile field.
    var strandU = (pixelLocalIndex + 0.5) / 40.0;
    var procession = pow(wave(strandU * 1.73 - borderClock
                              + fixtureId * GOLDEN_FRACTION), 5.0);
    brightness = floorLevel + 0.18 + groutShadow * 0.14
               + procession * (0.30 + liveFaceDepth * 0.25);
    paletteMix = clamp01(0.12 + material * 0.68
                        + procession * 0.14);
  } else if (fixtureType == FIX_VINTAGE_6) {
    // Jewelry catches remain selected-palette RGB, never an invented gold or
    // native white. Sparse heads light as their local tile passes edge-on.
    var catchWave = wave(pixelLocalIndex * GOLDEN_ANGLE
                        + fixtureId * GOLDEN_FRACTION
                        - flipClock * SQRT3);
    var edgeCatch = pow(1.0 - face, 3.0) * pow(catchWave, 7.0);
    brightness = floorLevel * 0.72 + 0.07 + tileBody * 0.20
               + edgeCatch * (0.18 + liveJewelryCatch * 0.88)
               + liveJewelryCatch * 0.32;
    paletteMix = clamp01(0.22 + material * 0.64
                        + edgeCatch * 0.12);
  } else if (fixtureType == FIX_PAR) {
    // Organs are discrete studs: their pixel identity selects the same three
    // cohorts while a broad face pulse keeps the pools calm and legible.
    var studCohort = pixelLocalIndex % 3.0;
    var studPulse = 0.5 + 0.5 * cos(studCohort * PI2 / 3.0
                                  + flipClock * PI2 * 0.73);
    brightness = floorLevel + 0.22 + studPulse * 0.34
               + face * 0.10 + seam * 0.08;
    paletteMix = clamp01(0.14 + studCohort * 0.34
                        + material * 0.10);
  } else if (isSign) {
    // Identity carries a high-floor miniature medallion, with moving material
    // faces and grout detail across each letter instead of a static wash.
    var medallionX = ux - 0.50;
    var medallionY = uy - 0.50;
    var medallionEdge = 1.0 - smoothstep(0.31, 0.48,
                           abs(medallionX) + abs(medallionY));
    brightness = max(0.34, floorLevel + 0.18
                   + tileBody * groutShadow * 0.48
                   + medallionEdge * 0.12);
    paletteMix = clamp01(0.10 + material * 0.74
                        + cohort * 0.055
                        + medallionEdge * 0.07);
  }

  brightness = clamp01(brightness);
  paletteMix = clamp01(paletteMix);
  var outR = (pr1 + (pr2 - pr1) * paletteMix) * brightness;
  var outG = (pg1 + (pg2 - pg1) * paletteMix) * brightness;
  var outB = (pb1 + (pb2 - pb1) * paletteMix) * brightness;
  rgbwau(clamp01(outR), clamp01(outG), clamp01(outB), 0.0, 0.0, 0.0);
}
