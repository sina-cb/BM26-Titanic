// DRAFT — pending operator review
/*
  38_shell_growth.js — SHELL GROWTH

  CONCEPT
    One stationary logarithmic shell grows outward from a fixed pearl nucleus.
    Its coil never travels or rotates: a slow ceremony reveals more of the
    anchored curve, then holds the complete shell before gently folding back.

  INSTRUMENT STAGING
    FIX_BAR_18     — the broad shell body and its radial growth ridges.
    FIX_RAW_LED    — the crisp outer coil that makes the silhouette readable.
    FIX_VINTAGE_6  — sparse pearl-ridge points with matched native W+A.
    FIX_PAR        — a stationary, weighty nucleus at the shell's origin.
    FIX_TE_SIGN    — identical paired miniature shell seals on both TE signs.

  MOTION / MATH
    A true logarithmic spiral is evaluated over five candidate windings. The
    default resolves 3.6 readable turns (the control spans 2.5–4.5). Only the
    revealed arc length changes; the spiral center, pitch, and nucleus remain
    anchored. A piecewise clock spends 54% of its cycle revealing, 34% holding
    the complete shell, and 12% smoothly concealing back to the audio/operator
    growth floor. Radial log bands expose the shell's accreted ridges.

  CONTROLS (declaration order = physical MIDI order)
    localSpeed  — reveal / hold ceremony rate; shell geometry stays anchored.
    shellSize   — outer reach of the complete shell.
    coilCount   — 2.5 to 4.5 readable logarithmic turns.
    bandWidth   — physical thickness of the shell body and outer coil.
    growth      — minimum revealed arc length, suitable for flux modulation.
    pearlGlow   — sparse Jewelry pearl-ridge brightness and W+A intensity.
    safetyFloor — whole-rig palette-derived visibility floor.

  AUDIO_MODULATION_V1:
    sliderGrowth    <- micFlux range 0.25..0.68 curve ease # PRIMARY: flux reveals more anchored shell
    sliderPearlGlow <- micHigh range 0.04..0.30 curve pow2 # highs illuminate sparse Jewelry pearls
  Static (unmapped) params: localSpeed, shellSize, coilCount, bandWidth,
    safetyFloor, colorPalette1/2.

  COLOR / OUTPUT
    RGB lies strictly on the selected cp1↔cp2 line. Jewelry alone adds a
    restrained pearl-white ridge on matched W+A; UV is always zero. Silence
    remains a complete, animated ambient composition above the safety floor.
*/

export var cp1H = 0.53, cp1S = 0.72, cp1V = 0.86;
export var cp2H = 0.085, cp2S = 0.62, cp2V = 1.00;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export var localSpeed = 0.30;
export var shellSize = 0.62;
export var coilCount = 0.55;
export var bandWidth = 0.42;
export var growth = 0.46;
export var pearlGlow = 0.20;
export var safetyFloor = 0.24;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderShellSize(v) { shellSize = v; }
export function sliderCoilCount(v) { coilCount = v; }
export function sliderBandWidth(v) { bandWidth = v; }
export function sliderGrowth(v) { growth = v; }
export function sliderPearlGlow(v) { pearlGlow = v; }
export function sliderSafetyFloor(v) { safetyFloor = v; }

var PHASE_WRAP = 10000.0;
var SQRT2 = 1.41421356;
var SQRT3 = 1.73205081;
var PHI = 1.61803399;

// Begin on a visibly partial coil so short review windows witness growth
// immediately instead of spending their opening frames near an empty nucleus.
var revealClock = 0.12;
var ridgeClock = 0.07;
var revealStage = 0.0;

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

  var localMultiplier = 0.25 + clamp01(localSpeed)
    * (32.824 - 16.412 * clamp01(localSpeed));
  revealClock += dt * (0.007 + localMultiplier * 0.026);
  ridgeClock += dt * (0.004 + localMultiplier * 0.010);
  if (revealClock >= PHASE_WRAP) revealClock -= PHASE_WRAP;
  if (ridgeClock >= PHASE_WRAP) ridgeClock -= PHASE_WRAP;

  var phase = revealClock - floor(revealClock);
  if (phase < 0.54) {
    revealStage = smooth01(phase / 0.54);
  } else if (phase < 0.88) {
    revealStage = 1.0;
  } else {
    revealStage = smooth01(1.0 - (phase - 0.88) / 0.12);
  }

  _hsv2rgb1();
  _hsv2rgb2();
}

export function render3D(index, x, y, z) {
  var nx = clamp01(x);
  var ny = clamp01(y);
  var nz = clamp01(z);
  var isSign = fixtureType == FIX_TE_SIGN;

  // Both signs receive the same local seal coordinates. This preserves exact
  // pair balance and makes the log-shell readable inside each letterform.
  if (isSign) {
    var signIndex = index % 74.0;
    nx = (signIndex % 10.0) / 9.0;
    ny = floor(signIndex / 10.0) / 7.0;
    nz = 0.5;
  }

  // Oblique projection uses all XYZ axes: the hull reads in top and front
  // views without allowing the elongated ship proportions to flatten the coil.
  var px = (nx - 0.43) * (1.02 + clamp01(shellSize) * 0.18);
  var py = (ny - 0.50) * 0.74 + (nz - 0.50) * 0.48;
  var radius = sqrt(px * px + py * py);
  var angle = atan2(py, px);
  if (angle < 0.0) angle += PI2;

  var turns = 2.5 + clamp01(coilCount) * 2.0;
  var totalAngle = turns * PI2;
  var innerRadius = 0.020;
  var outerRadius = 0.13 + clamp01(shellSize) * 0.70;
  var logRatio = log(outerRadius / innerRadius);

  // Solve the nearest logarithmic winding analytically. Radius identifies the
  // ideal unwrapped angle and rounding selects the nearest whole turn.
  var radialProgress = log(max(radius, innerRadius) / innerRadius)
                     / max(logRatio, 0.001);
  radialProgress = clamp01(radialProgress);
  var idealAngle = radialProgress * totalAngle;
  var turnSlot = floor((idealAngle - angle) / PI2 + 0.5);
  if (turnSlot < 0.0) turnSlot = 0.0;
  if (turnSlot > 4.0) turnSlot = 4.0;
  var unwrappedAngle = angle + turnSlot * PI2;
  if (unwrappedAngle > totalAngle && turnSlot > 0.0) {
    unwrappedAngle -= PI2;
  }
  var bestArc = clamp01(unwrappedAngle / totalAngle);
  var targetRadius = innerRadius * exp(logRatio * bestArc);
  var bestDistance = abs(radius - targetRadius);

  // Growth owns a large minimum arc-length range; the autonomous reveal adds
  // the remainder, then holds the fully grown shell. Endpoint difference is
  // deliberately greater than 50% of the complete arc.
  var minimumReveal = 0.05 + clamp01(growth) * 0.78;
  var revealedArc = minimumReveal + (1.0 - minimumReveal) * revealStage;
  var revealSoftness = 0.018 + clamp01(bandWidth) * 0.030;
  var revealed = 1.0 - smoothstep(revealedArc,
                                   revealedArc + revealSoftness, bestArc);

  var width = 0.010 + clamp01(bandWidth) * 0.205;
  var coilBody = 1.0 - smoothstep(width * 0.35,
                                  width * 1.45, bestDistance);
  coilBody *= revealed;
  var coilHalo = 1.0 - smoothstep(width * 1.10,
                                  width * 3.20, bestDistance);
  coilHalo *= revealed;

  // Two stationary accretion systems give close detail without competing
  // with the one coil.  Their frequencies follow Coil Count, and only a slow
  // light phase moves; the shell geometry never rotates or translates.
  var ridgePhase = bestArc * (6.0 + turns * 2.4)
                 + ridgeClock * 0.09;
  ridgePhase -= floor(ridgePhase);
  var ridgeTriangle = 1.0 - abs(ridgePhase * 2.0 - 1.0);
  var ridgeSquared = ridgeTriangle * ridgeTriangle;
  var ridge = ridgeSquared * ridgeSquared * ridgeSquared * coilBody;
  var sizeEnvelope = 1.0 - smoothstep(outerRadius * 0.76,
                                      outerRadius * 1.04, radius);
  var growthPhase = radialProgress * (3.0 + turns * 1.8)
                  + bestArc * 0.23;
  growthPhase -= floor(growthPhase);
  var growthTriangle = 1.0 - abs(growthPhase * 2.0 - 1.0);
  var growthSquared = growthTriangle * growthTriangle;
  var growthRidges = growthSquared * growthSquared * growthSquared;
  growthRidges *= sizeEnvelope * revealed;

  // Band Width also opens one broad accretion rim. This supplements the thin
  // analytic coil on sparse point layouts, where widening only the curve can
  // otherwise fall between sampled fixtures and appear to do nothing.
  var plateWidth = 0.010 + clamp01(bandWidth) * 0.340;
  var plateDistance = abs(radius - outerRadius * 0.72);
  var plateRim = 1.0 - smoothstep(plateWidth * 0.28,
                                  plateWidth, plateDistance);
  plateRim *= revealed;

  var nucleusWidth = 0.058 + clamp01(shellSize) * 0.026;
  var nucleus = 1.0 - smoothstep(nucleusWidth * 0.35,
                                 nucleusWidth * 1.65, radius);
  // Three large-scale spatial witnesses make the physical handles legible on
  // a fixture-sparse ship as well as on a continuous pixel grid. They are all
  // parts of the same shell: its filled reach, aperture lip, and projected
  // accretion ribs—not unrelated background texture.
  var shellReach = 1.0 - smoothstep(0.025,
                                    0.08 + clamp01(shellSize) * 0.72, radius);
  // A broad, softly carved shell plate makes the object legible between its
  // analytic coil samples.  Its right-facing mouth keeps the plate from
  // becoming a generic circular blob.
  var mouthDirection = clamp01(0.5 + 0.5 * px / (radius + 0.0001));
  var mouthReach = smoothstep(outerRadius * 0.38,
                              outerRadius * 0.92, radius);
  var mouth = mouthDirection * mouthDirection * mouthReach;
  var shellPlate = shellReach * revealed * (1.0 - mouth * 0.72);
  var lipHalfWidth = 0.008 + clamp01(bandWidth) * 0.30;
  var shellLip = 1.0 - smoothstep(lipHalfWidth * 0.30,
                                  lipHalfWidth, abs(py));
  shellLip *= shellReach * (0.18 + revealed * 0.82);
  var floorLevel = 0.035 + clamp01(safetyFloor) * 0.190;
  var brightness = floorLevel
                 + coilHalo * (0.08 + clamp01(bandWidth) * 0.42)
                 + coilBody * 0.88 + ridge * 0.38
                 + growthRidges * 0.34 + plateRim * 0.46
                 + shellPlate * 0.12 + shellLip * 0.28
                 + nucleus * 0.94;
  var paletteMix = clamp01(0.10 + bestArc * 0.72 + ridge * 0.16);

  if (fixtureType == FIX_RAW_LED) {
    // The Silhouette is the outer coil: stronger at the latest revealed arc,
    // but never dark between coil crossings.
    var outerEmphasis = smoothstep(0.52, 0.96, bestArc);
    brightness = floorLevel * 1.15 + 0.05
               + coilHalo * (0.08 + clamp01(bandWidth) * 0.34)
               + coilBody * (0.58 + outerEmphasis * 0.56)
               + ridge * 0.42 + growthRidges * 0.16
               + plateRim * 0.28 + shellPlate * 0.045
               + nucleus * 0.38;
    paletteMix = clamp01(0.12 + bestArc * 0.76);
  } else if (fixtureType == FIX_VINTAGE_6) {
    // Sparse deterministic pearls sit on the revealed ridges. Native white is
    // added below as matched W+A; RGB stays on the selected palette line.
    var pearlSeed = wave(pixelLocalIndex * 0.38196601
                       + fixtureId * PHI + bestArc * 0.17);
    var pearlPoint = pow(pearlSeed, 10.0);
    var pearl = pearlPoint * (0.20 + revealed * 0.80);
    brightness = floorLevel * 0.80 + 0.028 + clamp01(pearlGlow) * 0.56
               + coilHalo * 0.12 + coilBody * 0.20
               + pearl * (0.08 + pearlGlow * 1.10);
    paletteMix = clamp01(0.56 + bestArc * 0.36);
  } else if (fixtureType == FIX_PAR) {
    // Organs are the stationary nucleus, deliberately independent of the
    // reveal frontier so the composition retains an anchored visual center.
    var organNucleus = 0.14 + 0.86 * nucleus;
    brightness = floorLevel + 0.06 + organNucleus * 0.98
               + ridge * 0.10;
    paletteMix = clamp01(0.10 + organNucleus * 0.16);
  } else if (isSign) {
    // The paired seals retain the exact shell math, with a stronger letterform
    // floor and wider ridge so both 74-pixel identities animate legibly.
    var sealBody = 1.0 - smoothstep(width * 0.45,
                                    width * 2.10, bestDistance);
    sealBody *= revealed;
    var sealShimmer = wave(t * 0.071 + bestArc * 0.19);
    brightness = max(0.30 + floorLevel * 0.45,
                     floorLevel + coilHalo * 0.12 + sealBody * 0.44
                   + ridge * 0.18 + nucleus * 0.34
                   + revealStage * 0.16 + sealShimmer * 0.22);
    paletteMix = clamp01(0.08 + bestArc * 0.44 + ridge * 0.06
                       + revealStage * 0.08 + sealShimmer * 0.32);
  }

  brightness = clamp01(brightness);
  paletteMix = clamp01(paletteMix);
  var outR = (pr1 + (pr2 - pr1) * paletteMix) * brightness;
  var outG = (pg1 + (pg2 - pg1) * paletteMix) * brightness;
  var outB = (pb1 + (pb2 - pb1) * paletteMix) * brightness;

  var white = 0.0;
  if (fixtureType == FIX_VINTAGE_6) {
    var whiteSeed = wave(pixelLocalIndex * 0.38196601
                       + fixtureId * PHI + bestArc * 0.17);
    var whitePoint = pow(whiteSeed, 10.0);
    var pearlAmount = whitePoint * (0.20 + revealed * 0.80);
    white = clamp01((0.10 + pearlAmount * 0.90)
                  * clamp01(pearlGlow));
  }

  rgbwau(clamp01(outR), clamp01(outG), clamp01(outB), white, white, 0.0);
}
