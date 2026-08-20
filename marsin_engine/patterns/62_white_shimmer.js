/*
  62_white_shimmer.js - "White Shimmer"  [WHITE ONLY family]

  A bold, high-definition white material study. Broad crystalline sweeps cross
  Hull facets, the Silhouette carries a counter-moving frost edge, Vintage rails form
  crisp six-lamp diamonds, Organs answer in restrained cohorts, and both TE
  signs receive the same complete 74-pixel engraved shimmer surface.

  The moving detail is deterministic and spatial: no frame-random glitter and
  no flat whole-rig noise. A protected low bed keeps every fixture visible,
  while thresholded material layers leave generous visual negative space.
  White is authored directly; there are no palette exports. W always equals A
  and UV is always zero.

  AUDIO_MODULATION_V1:
    sliderLevel     <- micLow  range 0.30..1.00 curve linear  # overall intensity (PRIMARY)
    sliderKick      <- micKick range 0.00..1.00 curve pow2    # sparkle pop
    sliderDensity   <- micHigh range 0.25..0.95 curve linear  # how much of the rig glitters
    sliderWhiteKick <- micKick range 0.00..1.00 curve pow2    # W-emitter blinder bite
    # STATIC (omit from audio): localSpeed, direction, radius, sharpness, whiteLevel, warmth
*/

export var localSpeed = 0.55;
export var direction  = 1.0;
export var level      = 0.70;
export var kick       = 0.0;
export var radius     = 0.5;
export var density    = 0.55;
export var sharpness  = 0.55;
export var whiteLevel = 0.60;
export var whiteKick  = 0.30;
export var warmth     = 0.10;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderDirection(v) {
  var signed = v * 2.0 - 1.0;
  if (signed >= 0.0 && signed < 0.06) signed = 0.06;
  else if (signed < 0.0 && signed > -0.06) signed = -0.06;
  direction = signed;
}
export function sliderLevel(v)      { level = v; }
export function sliderKick(v)       { kick = v; }
export function sliderRadius(v)     { radius = v; }
export function sliderDensity(v)    { density = v; }
export function sliderSharpness(v)  { sharpness = v; }
export function sliderWhiteLevel(v) { whiteLevel = v; }
export function sliderWhiteKick(v)  { whiteKick = v; }
export function sliderWarmth(v)     { warmth = v; }

var PHASE_WRAP = 4096.0;
var shimmerPhase = 0.0;
var materialPhase = 0.0;
var liveDirection = 1.0;
var liveLevel = 0.70;
var liveKick = 0.0;
var liveRadius = 0.5;
var liveDensity = 0.55;
var liveSharpness = 0.55;
var liveWhiteLevel = 0.60;
var liveWhiteKick = 0.30;
var liveWarmth = 0.10;

function clamp01(value) {
  if (value < 0.0) return 0.0;
  if (value > 1.0) return 1.0;
  return value;
}

function smooth01(value) {
  var amount = clamp01(value);
  return amount * amount * (3.0 - 2.0 * amount);
}

function slew(current, target, amount) {
  return current + (target - current) * amount;
}

function narrowBand(coordinate, width) {
  var wrapped = coordinate - floor(coordinate);
  var distance = wrapped;
  if (distance > 0.5) distance = 1.0 - distance;
  return pow(clamp01(1.0 - distance / width), 2.0);
}

export function beforeRender(delta) {
  var dt = clamp01(delta / 1000.0);
  if (dt > 0.1) dt = 0.1;
  var edit = clamp01(dt * 8.0);
  liveDirection = slew(liveDirection, direction, clamp01(dt * 24.0));
  liveLevel = slew(liveLevel, clamp01(level), edit);
  liveKick = slew(liveKick, clamp01(kick), edit);
  liveRadius = slew(liveRadius, clamp01(radius), edit);
  liveDensity = slew(liveDensity, clamp01(density), edit);
  liveSharpness = slew(liveSharpness, clamp01(sharpness), edit);
  liveWhiteLevel = slew(liveWhiteLevel, clamp01(whiteLevel), edit);
  liveWhiteKick = slew(liveWhiteKick, clamp01(whiteKick), edit);
  liveWarmth = slew(liveWarmth, clamp01(warmth), edit);

  var localMult = pow(2.0, (localSpeed - 0.5) * 4.0);
  var rate = 0.045 + localMult * 0.24;
  shimmerPhase = shimmerPhase + dt * rate * liveDirection;
  materialPhase = materialPhase + dt * rate * liveDirection * 0.317;
  if (shimmerPhase >= PHASE_WRAP) shimmerPhase = shimmerPhase - PHASE_WRAP;
  else if (shimmerPhase <= -PHASE_WRAP) shimmerPhase = shimmerPhase + PHASE_WRAP;
  if (materialPhase >= PHASE_WRAP) materialPhase = materialPhase - PHASE_WRAP;
  else if (materialPhase <= -PHASE_WRAP) materialPhase = materialPhase + PHASE_WRAP;
}

export function render3D(index, x, y, z) {
  var px = x - 0.5;
  var py = y - 0.5;
  var pz = z - 0.5;
  var isSign = fixtureType == FIX_TE_SIGN;
  if (isSign) {
    // Both physical signs are two fixture segments of one 74-pixel surface.
    // Folding the model index makes their corresponding surface pixels exact.
    var signIndex = index % 74.0;
    px = (signIndex % 10.0) / 9.0 - 0.5;
    py = floor(signIndex / 10.0) / 7.0 - 0.5;
    pz = 0.0;
  }

  var grainScale = 5.8 - liveRadius * 3.6;
  var materialA = wave((px * 1.71 + py * 1.13 - pz * 0.79)
                     * grainScale + materialPhase);
  var materialB = wave((px * 0.83 - py * 1.93 + pz * 1.37)
                     * grainScale - materialPhase * 0.73);
  var facets = pow(materialA * materialB,
                   1.4 + liveSharpness * 5.6);

  // Each point owns a permanent seed; only its eased highlight moves.
  var seedHash = sin(px * 47.17 + py * 71.93 + pz * 29.41) * 43758.5453;
  var seed = seedHash - floor(seedHash);
  var seedHash2 = sin(px * 89.11 - py * 37.73 + pz * 53.27) * 21313.7331;
  var gateSeed = seedHash2 - floor(seedHash2);
  var sparkPulse = wave(shimmerPhase * (0.68 + seed * 0.56) + seed);
  var spark = pow(sparkPulse, 8.0 + liveSharpness * 28.0);
  var population = smooth01((liveDensity - gateSeed + 0.055) / 0.11);
  spark = spark * population;

  // Two large frost planes make the identity legible on the small bench rig;
  // the deterministic facets and point sparks remain visible up close.
  var travelingCatch = narrowBand((px + 0.5) * 0.87
                                + (py + 0.5) * 0.19
                                + (pz + 0.5) * 0.11
                                - shimmerPhase * 1.07,
                                  0.075 + liveRadius * 0.13);
  var counterCatch = narrowBand((py + 0.5) * 0.79
                              - (pz + 0.5) * 0.21
                              + shimmerPhase * 0.61 + 0.37,
                                0.055 + liveRadius * 0.085);
  var roleLevel = 0.12;
  var nativeAccent = 0.0;
  var rgbBias = 1.0;
  var activity = clamp01(facets * 0.22 + travelingCatch * 0.68
                       + counterCatch * 0.28 + spark * 0.48);

  if (fixtureType == FIX_BAR_18) {
    // Hull: restrained frost facets with one legible traveling material catch.
    roleLevel = 0.09 + facets * 0.15 + travelingCatch * 0.55
              + counterCatch * 0.12 + spark * 0.25;
    nativeAccent = (travelingCatch * 0.12 + spark * 0.38)
                 * (0.025 + liveWhiteKick * 0.16);
  } else if (fixtureType == FIX_RAW_LED) {
    // Silhouette: a dependable outline dotted by fine moving pinpricks.
    var contour = narrowBand(pixelLocalIndex * 0.047
                           + shimmerPhase * 0.79, 0.085);
    roleLevel = 0.17 + contour * 0.36 + counterCatch * 0.30
              + spark * 0.24;
    nativeAccent = (contour + counterCatch * 0.35)
                 * (0.018 + liveWhiteKick * 0.12);
    activity = clamp01(contour * 0.58 + counterCatch * 0.34
                     + spark * 0.31);
    rgbBias = 1.05;
  } else if (fixtureType == FIX_VINTAGE_6) {
    // Jewelry: crisp six-lamp diamonds, never a generic fixture-wide pulse.
    var jewelCoordinate = pixelLocalIndex / 6.0;
    var jewelCatch = narrowBand(jewelCoordinate - shimmerPhase * 0.79,
                                0.095 + liveRadius * 0.065);
    var diamond = pow(wave(jewelCoordinate * 2.0 + materialPhase),
                      3.0 + liveSharpness * 8.0);
    roleLevel = 0.17 + jewelCatch * 0.58 + diamond * 0.20;
    nativeAccent = jewelCatch * (0.20 + liveWhiteKick * 0.70);
    activity = jewelCatch * 0.80 + diamond * 0.20;
    rgbBias = 1.08;
  } else if (fixtureType == FIX_PAR) {
    // Organs: slow structural cohorts with a concise, non-flashing kick lift.
    var organCoordinate = fixtureId * 0.173 - shimmerPhase * 0.39;
    var organCatch = narrowBand(organCoordinate,
                                0.10 + liveRadius * 0.08);
    roleLevel = 0.14 + organCatch * 0.61 + travelingCatch * 0.18;
    nativeAccent = organCatch * (0.07 + liveWhiteKick * 0.31);
    activity = clamp01(organCatch + travelingCatch * 0.25);
  } else if (isSign) {
    // Identity: the full 10x8 engraving stays readable while a diagonal glint
    // exposes rows, columns, and fine frost on every one of the 74 pixels.
    var signDiagonal = narrowBand((px + 0.5) * 0.71
                                + (py + 0.5) * 0.43
                                - shimmerPhase * 0.34,
                                  0.075 + liveRadius * 0.07);
    var signEtch = pow(wave((px * 1.31 - py * 1.79) * grainScale
                          + materialPhase),
                       2.0 + liveSharpness * 6.0);
    var signCross = narrowBand((px + 0.5) * 0.83
                             - (py + 0.5) * 0.57
                             + shimmerPhase * 0.19,
                               0.055 + liveRadius * 0.05);
    roleLevel = 0.25 + signEtch * 0.12 + signCross * 0.20
              + signDiagonal * 0.43;
    nativeAccent = signDiagonal * (0.018 + liveWhiteKick * 0.08);
    activity = signDiagonal * 0.62 + signCross * 0.23 + signEtch * 0.15;
    rgbBias = 1.08;
  }

  var authoredLevel = 0.10 + liveLevel * 0.90;
  var kickLift = liveKick * (0.05 + activity * 0.34);
  var brightness = clamp01((roleLevel + kickLift) * authoredLevel);
  var rgbShare = (1.0 - liveWhiteLevel * 0.68) * rgbBias;
  var red = brightness * rgbShare;
  var green = red * (1.0 - liveWarmth * 0.26);
  var blue = red * (1.0 - liveWarmth * 0.60);
  var white = clamp01(brightness * liveWhiteLevel + nativeAccent);

  rgbwau(clamp01(red), clamp01(green), clamp01(blue), white, white, 0.0);
}
