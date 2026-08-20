// DRAFT — pending operator review
/*
  15_woven_light.js — WOVEN LIGHT

  CONCEPT
    A finite luminous textile is stretched across the ship. Broad warp and
    weft threads have rounded ends, visible crossings, and real alternating
    over-under order; the result reads as fabric, not a swaying line lattice.

  INSTRUMENT STAGING
    FIX_BAR_18     — the cloth body, colored threads, and crossing relief.
    FIX_RAW_LED    — bright selvage edges with a restrained woven trace.
    FIX_VINTAGE_6  — sparse palette-colored knots with matched W=A glints.
    FIX_PAR        — weighted corners that hold the textile open.
    FIX_TE_SIGN    — paired, fixture-local woven crests with a readable bed.

  MOTION / MATH
    Three to seven warp and weft segments are evaluated by analytic
    point-to-finite-segment distance. Thread Count continuously changes their
    density and fades the fractional edge thread. Crossing parity chooses the
    over-thread; a reversible traveling sheen moves along warp and weft at
    irrationally related rates.

  CONTROLS (declaration order = physical MIDI order)
    localSpeed  — speed of the traveling textile sheen.
    direction   — genuine reversal of sheen travel, never stopped at center.
    threadCount — smoothly spaces three through seven warp/weft pairs.
    threadWidth — physical width of every finite luminous thread.
    overUnder   — depth separating the over-thread from the under-thread.
    knotGlow    — brightness of sparse Jewelry knot glints.
    safetyFloor — minimum whole-rig visibility beneath the textile.

  AUDIO_MODULATION_V1:
    sliderOverUnder <- micFlux range 0.25..0.62 curve ease # flux deepens the alternating weave
    sliderKnotGlow  <- micHigh range 0.05..0.42 curve pow2 # highs illuminate Jewelry knots
  Static (unmapped) params: localSpeed, direction, threadCount, threadWidth,
    safetyFloor, colorPalette1/2.

  COLOR / OUTPUT
    RGB lies strictly on the cp1-to-cp2 line. Only Vintage Jewelry emits
    native white, with byte-identical W and A. UV is always zero. Silence is
    a complete, safely visible woven composition.
*/

export var localSpeed = 0.30;
export var direction = 0.72;
export var threadCount = 0.54;
export var threadWidth = 0.46;
export var overUnder = 0.44;
export var knotGlow = 0.34;
export var safetyFloor = 0.28;

export var cp1H = 0.555, cp1S = 0.78, cp1V = 0.92;
export var cp2H = 0.090, cp2S = 0.82, cp2V = 1.00;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderDirection(v) { direction = v; }
export function sliderThreadCount(v) { threadCount = v; }
export function sliderThreadWidth(v) { threadWidth = v; }
export function sliderOverUnder(v) { overUnder = v; }
export function sliderKnotGlow(v) { knotGlow = v; }
export function sliderSafetyFloor(v) { safetyFloor = v; }

var PHI = 1.61803399;
var SQRT2 = 1.41421356;
var SQRT3 = 1.73205081;
var GOLDEN_ANGLE = 2.39996323;
var PHASE_WRAP = 62831.85307;

var travel = 0.0;
var drift = 0.0;
var liveCount = 0.54;
var liveWeaveCount = 4.32;
var liveOverUnder = 0.44;
var liveKnotGlow = 0.34;
var liveFloor = 0.28;

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
  else if (iv == 4.0) { pr2 = tv;   pg2 = pv;   pb2 = cp2V; }
  else                 { pr2 = cp2V; pg2 = pv;   pb2 = qv;   }
}

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  // Geometry and intensity controls follow live edits instead of teleporting.
  var follow = min(1.0, dt * 5.0);
  liveCount += (threadCount - liveCount) * follow;
  liveWeaveCount = 3.0 + pow(clamp01(liveCount), 1.80) * 4.0;
  liveOverUnder += (overUnder - liveOverUnder) * follow;
  liveKnotGlow += (knotGlow - liveKnotGlow) * follow;
  liveFloor += (safetyFloor - liveFloor) * follow;

  var signedDirection = clamp01(direction) * 2.0 - 1.0;
  if (signedDirection >= 0.0 && signedDirection < 0.06) {
    signedDirection = 0.06;
  } else if (signedDirection < 0.0 && signedDirection > -0.06) {
    signedDirection = -0.06;
  }
  var speedMultiplier = 0.25 + clamp01(localSpeed)
    * (32.824 - 16.412 * clamp01(localSpeed));
  travel += dt * 0.420 * speedMultiplier * signedDirection;
  drift += dt * 0.027 * speedMultiplier * signedDirection;
  if (travel > PHASE_WRAP) travel -= PHASE_WRAP;
  if (travel < -PHASE_WRAP) travel += PHASE_WRAP;
  if (drift > PHASE_WRAP) drift -= PHASE_WRAP;
  if (drift < -PHASE_WRAP) drift += PHASE_WRAP;

  _hsv2rgb1();
  _hsv2rgb2();
}

export function render3D(index, x, y, z) {
  var ux = clamp01(x);
  var uy = clamp01(y);
  var uz = clamp01(z);
  var isSign = fixtureType == FIX_TE_SIGN;

  if (isSign) {
    // Fold the physical 40 + 34 patch into one complete 74-pixel textile.
    // Both signs then receive the same authored 10x8 woven crest.
    var signIndex = index % 74.0;
    ux = (signIndex % 10.0) / 9.0;
    uy = floor(signIndex / 10.0) / 7.0;
    uz = 0.50;
  }

  // Tilted textile coordinates remain bounded in 0..1. Z contributes enough
  // depth to carry the cloth across the broken ship rather than one flat wall.
  var u = clamp01(0.50 + (ux - 0.50) * 0.84
                       + (uz - 0.50) * 0.30);
  var v = clamp01(0.50 + (uy - 0.50) * 0.86
                       - (uz - 0.50) * 0.18);

  // Width is safe to read directly: it changes only a continuous distance
  // threshold, never topology, and therefore remains stable during live edits.
  var width = 0.028 + clamp01(threadWidth) * 0.135;
  // Keep the endpoints at three and seven threads while biasing the saved
  // midpoint toward a coarse four-by-four textile. This makes the topology
  // legible on the physical fixture spacing instead of reading as a lattice.
  var weaveCount = liveWeaveCount;

  // Density is continuous, so live Thread Count edits glide the finite
  // segments across the fabric. The fractional outer thread fades in instead
  // of appearing in one frame. This is the analytic nearest-segment form of
  // the finite warp/weft set and avoids a costly per-pixel search loop.
  var warpIndex = floor(u * weaveCount);
  var weftIndex = floor(v * weaveCount);
  var finalIndex = floor(weaveCount - 0.0001);
  if (warpIndex > finalIndex) warpIndex = finalIndex;
  if (weftIndex > finalIndex) weftIndex = finalIndex;
  var warpActive = smooth01(weaveCount - warpIndex);
  var weftActive = smooth01(weaveCount - weftIndex);
  var warpCenter = (warpIndex + 0.5) / weaveCount;
  var weftCenter = (weftIndex + 0.5) / weaveCount;

  var du = abs(u - warpCenter);
  var warpOverrun = max(abs(v - 0.50) - 0.455, 0.0);
  var warpDistance = sqrt(du * du + warpOverrun * warpOverrun);
  var warpCore = warpActive
               * smooth01(1.0 - warpDistance / (width * 1.35));

  var dv = abs(v - weftCenter);
  var weftOverrun = max(abs(u - 0.50) - 0.455, 0.0);
  var weftDistance = sqrt(dv * dv + weftOverrun * weftOverrun);
  var weftCore = weftActive
               * smooth01(1.0 - weftDistance / (width * 1.35));

  var crossing = warpCore * weftCore;
  var knotRadius = 0.050 + clamp01(threadWidth) * 0.082;
  var knotDistance = sqrt(du * du + dv * dv);
  var knotField = smooth01(1.0 - knotDistance / knotRadius);
  var parity = (warpIndex + weftIndex) % 2.0;
  var depth = 0.24 + clamp01(liveOverUnder) * 0.72;
  var warpLift = 1.0;
  var weftLift = 1.0;
  if (parity < 1.0) {
    warpLift += crossing * depth * 0.92;
    weftLift -= crossing * (0.66 + depth * 0.28);
  } else {
    weftLift += crossing * depth * 0.92;
    warpLift -= crossing * (0.66 + depth * 0.28);
  }

  // A broad shuttle of light travels in opposite coordinate directions on
  // warp and weft. Direction endpoints visibly reverse both motions.
  var warpWave = wave(v * 1.37 - travel + warpIndex * 0.113);
  var weftWave = wave(u * 1.19 + travel * SQRT2 + weftIndex * 0.097);
  var warpSheen = 0.48 + 0.52 * warpWave * warpWave
                * (1.45 - warpWave * 0.45);
  var weftSheen = 0.48 + 0.52 * weftWave * weftWave
                * (1.45 - weftWave * 0.45);
  var warpEnergy = clamp01(warpCore * warpLift * warpSheen);
  var weftEnergy = clamp01(weftCore * weftLift * weftSheen);

  // The cloth body is a low, continuous twill rather than black space between
  // threads. Its two low-frequency folds make the woven surface readable.
  var twill = wave((u * 2.0 + v * 3.0) * PHI + drift * 0.41);
  var bodyFold = wave((u * SQRT2 - v * SQRT3) * 1.25 - drift * 0.29);
  var shuttle = wave(u * 0.72 + v * 0.41 - travel);
  var clothBody = 0.045 + twill * 0.040 + bodyFold * 0.035
                + shuttle * 0.045;

  var floorLevel = 0.055 + clamp01(liveFloor) * 0.205;
  var threadEnergy = max(warpEnergy, weftEnergy);
  var brightness = floorLevel + clothBody
                 + warpEnergy * 0.70 + weftEnergy * 0.70
                 + crossing * depth * 0.22
                 + knotField * crossing * (0.10 + liveKnotGlow * 0.62)
                 + threadWidth * (0.04 + twill * 0.16);
  var paletteWeight = warpEnergy + weftEnergy + 0.0001;
  var paletteMix = (warpEnergy * 0.04 + weftEnergy * 0.96)
                 / paletteWeight;
  paletteMix = clamp01(paletteMix + 0.08
                       + (bodyFold - 0.50) * 0.24
                       + knotField * crossing
                       * (parity < 1.0 ? -0.24 : 0.24));
  var nativeWhite = 0.0;

  if (fixtureType == FIX_RAW_LED) {
    // The strands are the textile's selvage. Fixture-local end catches make
    // the borders read even where world-coordinate thread samples are sparse.
    var strandU = (pixelLocalIndex + 0.5) / 40.0;
    var selvage = 1.0 - smoothstep(0.035, 0.17,
                                  min(strandU, 1.0 - strandU));
    var selvageShuttle = pow(wave(strandU * 1.35 - travel * 0.74
                                 + (pixelLocalIndex % 2.0) * 0.5), 2.0);
    brightness = floorLevel + 0.19 + threadEnergy * 0.54
               + selvage * (0.27 + liveOverUnder * 0.20)
               + selvageShuttle * 0.12;
    paletteMix = clamp01(0.055 + paletteMix * 0.26
                        + selvage * 0.09 + selvageShuttle * 0.66);
  } else if (fixtureType == FIX_VINTAGE_6) {
    // Sparse knots are anchored to thread crossings but each six-head rail
    // selects only a few glints. White and amber remain exactly matched.
    var knotSelector = pow(wave(pixelLocalIndex * GOLDEN_ANGLE
                              + warpIndex * PHI - weftIndex * SQRT2), 10.0);
    var knot = clamp01((0.12 + knotField * 0.88) * knotSelector);
    brightness = floorLevel * 0.70 + 0.08 + threadEnergy * 0.28
               + liveKnotGlow * 0.10
               + knot * (0.20 + liveKnotGlow * 0.72);
    paletteMix = clamp01(0.58 + paletteMix * 0.34);
    nativeWhite = clamp01(knot * liveKnotGlow * 0.96);
  } else if (fixtureType == FIX_PAR) {
    // Organs are the textile's four corner weights: broad, solid pools whose
    // subtle shuttle response prevents them from feeling detached.
    var cornerX = abs(ux - 0.50) * 2.0;
    var cornerZ = abs(uz - 0.50) * 2.0;
    var cornerWeight = smooth01(clamp01(cornerX * cornerZ * 1.35));
    brightness = floorLevel + 0.24 + cornerWeight * 0.34
               + (warpSheen + weftSheen) * 0.075;
    paletteMix = clamp01(0.44 + (cornerX - cornerZ) * 0.18);
  } else if (isSign) {
    // The signs carry paired woven crests. Their own local geometry stays
    // detailed and dynamic while a strong bed preserves identity legibility.
    var crest = pow(wave((u - v) * 1.5 + travel * 0.33), 3.0);
    var signWarp = floor(ux * 4.0);
    var signWeft = floor(uy * 4.0);
    var signParity = (signWarp + signWeft) % 2.0;
    brightness = max(0.34, floorLevel + 0.17 + uy * 0.08
                   + threadEnergy * 0.43 + crossing * depth * 0.24
                   + crest * 0.17);
    paletteMix = clamp01(0.04 + signParity * 0.66 + uy * 0.12
                        + crest * 0.18
                        + crossing * (parity < 1.0 ? -0.12 : 0.12));
  }

  // Knot glow is the textile's transmitted-light gain: its localized peaks
  // remain strongest at crossings, while a soft whole-cloth lift makes the
  // control legible from playa distance and responsive to high-frequency audio.
  brightness *= 0.65 + liveKnotGlow * 1.03;
  brightness = clamp01(brightness * 1.34);
  var outR = (pr1 + (pr2 - pr1) * paletteMix) * brightness;
  var outG = (pg1 + (pg2 - pg1) * paletteMix) * brightness;
  var outB = (pb1 + (pb2 - pb1) * paletteMix) * brightness;
  rgbwau(clamp01(outR), clamp01(outG), clamp01(outB),
         nativeWhite, nativeWhite, 0.0);
}
