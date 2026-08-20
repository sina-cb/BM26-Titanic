/*
  64_temple_warm_white.js - "Temple Warm White"  [WHITE ONLY family]

  A ceremonial candle procession composed as five distinct instruments.
  Hull bars carry layered wax-and-flame material rather than a flat wash;
  Silhouette is the protected, readable lantern contour; Jewelry is a crown
  of six native-white candle cups; Organs hold independent, slowly answering
  vigils; and each TE sign carries one complete 74-pixel processional field.

  The clocks use golden-ratio and sqrt-derived relationships, so the candle
  material continually changes without becoming busy or visibly relocking.
  No palette exports are present. Warm-neutral RGB shapes temperature while
  explicit native white is always byte-matched W=A, and UV is always zero.

  AUDIO_MODULATION_V1:
    sliderLevel <- micLow  range 0.35..0.80 curve linear  # shallow intensity (PRIMARY)
    sliderKick  <- micKick range 0.00..0.45 curve pow2    # gentle lift only
    # STATIC (omit from audio): localSpeed, direction, radius, ceiling, warmth,
    #                           whiteLevel, whiteKick
*/

export var localSpeed = 0.25;
export var direction  = 1.0;
export var level      = 0.55;
export var kick       = 0.0;
export var radius     = 0.45;
export var ceiling    = 0.45;
export var warmth     = 0.85;
export var whiteLevel = 0.70;
export var whiteKick  = 0.06;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderDirection(v) {
  var signed = v * 2.0 - 1.0;
  if (signed >= 0.0 && signed < 0.06) signed = 0.06;
  else if (signed < 0.0 && signed > -0.06) signed = -0.06;
  direction = signed;
  liveDirection = signed;
}
export function sliderLevel(v)      { level = v; }
export function sliderKick(v)       { kick = v; }
export function sliderRadius(v)     { radius = v; }
export function sliderCeiling(v)    { ceiling = v; }
export function sliderWarmth(v)     { warmth = v; }
export function sliderWhiteLevel(v) { whiteLevel = v; }
export function sliderWhiteKick(v)  { whiteKick = v; }

var PHASE_WRAP = 4096.0;
var processionPhase = 0.0;
var waxPhase = 0.0;
var lanternPhase = 0.0;
var organPhase = 0.0;
var liveDirection = 1.0;
var liveLevel = 0.55;
var liveKick = 0.0;
var liveRadius = 0.45;
var liveCeiling = 0.45;
var liveWarmth = 0.85;
var liveWhiteLevel = 0.70;
var liveWhiteKick = 0.06;

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

function softCup(position) {
  var wrapped = position - floor(position);
  var distance = abs(wrapped - 0.5) * 2.0;
  var cup = 1.0 - clamp01(distance);
  return cup * cup * (3.0 - 2.0 * cup);
}

function processionFold(position) {
  // One broad, asymmetric pool of candlelight. Its long release makes the
  // direction legible as a ceremonial procession rather than a chase point.
  var wrapped = position - floor(position);
  var distance;
  if (wrapped < 0.36) distance = (0.36 - wrapped) / 0.36;
  else distance = (wrapped - 0.36) / 0.64;
  return 1.0 - smooth01(distance);
}

export function beforeRender(delta) {
  var dt = clamp01(delta / 1000.0);
  if (dt > 0.1) dt = 0.1;
  var edit = clamp01(dt * 7.0);
  liveDirection = slew(liveDirection, direction, clamp01(dt * 24.0));
  liveLevel = slew(liveLevel, clamp01(level), edit);
  liveKick = slew(liveKick, clamp01(kick), edit);
  liveRadius = slew(liveRadius, clamp01(radius), edit);
  liveCeiling = slew(liveCeiling, clamp01(ceiling), edit);
  liveWarmth = slew(liveWarmth, clamp01(warmth), edit);
  liveWhiteLevel = slew(liveWhiteLevel, clamp01(whiteLevel), edit);
  liveWhiteKick = slew(liveWhiteKick, clamp01(whiteKick), edit);

  var localMult = pow(2.0, (localSpeed - 0.5) * 4.0);
  var rate = 0.020 + localMult * 0.105;
  processionPhase = processionPhase + dt * rate * liveDirection;
  waxPhase = waxPhase - dt * rate * liveDirection * 0.61803;
  lanternPhase = lanternPhase + dt * rate * liveDirection * 0.41421;
  organPhase = organPhase - dt * rate * liveDirection * 0.70711;
  if (processionPhase >= PHASE_WRAP) processionPhase = processionPhase - PHASE_WRAP;
  else if (processionPhase <= -PHASE_WRAP) processionPhase = processionPhase + PHASE_WRAP;
  if (waxPhase >= PHASE_WRAP) waxPhase = waxPhase - PHASE_WRAP;
  else if (waxPhase <= -PHASE_WRAP) waxPhase = waxPhase + PHASE_WRAP;
  if (lanternPhase >= PHASE_WRAP) lanternPhase = lanternPhase - PHASE_WRAP;
  else if (lanternPhase <= -PHASE_WRAP) lanternPhase = lanternPhase + PHASE_WRAP;
  if (organPhase >= PHASE_WRAP) organPhase = organPhase - PHASE_WRAP;
  else if (organPhase <= -PHASE_WRAP) organPhase = organPhase + PHASE_WRAP;
}

export function render3D(index, x, y, z) {
  var px = x - 0.5;
  var py = y - 0.5;
  var pz = z - 0.5;
  var scale = 0.55 + liveRadius * 2.15;

  // A low-contrast, three-axis candle atmosphere joins the instruments
  // without forcing them through one shared brightness envelope.
  var airA = wave((px * 1.41421 + py * 0.78615 - pz * 1.13247) * scale
                + waxPhase);
  var airB = wave((px * -0.61803 + py * 1.73205 + pz * 0.41421) * scale
                + lanternPhase);
  var candleAir = smooth01(airA * 0.62 + airB * 0.38);
  var travellingFold = processionFold(py * 0.82 + px * 0.18
                                    - processionPhase * 4.80);

  var roleLevel = 0.42;
  var nativeAccent = 0.0;
  var rgbBias = 1.0;
  var whiteBias = 1.0;

  if (fixtureType == FIX_BAR_18) {
    // Hull Canvas: three broad candle wells per 18-cell bar. Their wax body
    // stays readable while slow flame tongues move through real XYZ.
    var barPosition = (pixelLocalIndex + 0.5) / 18.0;
    var candleWells = softCup(barPosition * 3.0 + fixtureId * 0.071);
    var flameTongue = wave(barPosition * 1.61803 + py * 0.71 - pz * 0.43
                         + processionPhase * 0.83 + fixtureId * 0.037);
    flameTongue = flameTongue * flameTongue * flameTongue;
    var waxGrain = wave(px * 0.73 - py * 1.13 + pz * 0.57 + waxPhase * 0.31);
    roleLevel = 0.11 + candleWells * 0.26 + candleAir * 0.25
              + flameTongue * candleWells * 0.24 + waxGrain * 0.08
              + travellingFold * 0.42;
    nativeAccent = candleWells * flameTongue * (0.020 + liveWhiteKick * 0.16);
  } else if (fixtureType == FIX_RAW_LED) {
    // Silhouette: the hull outline never drops below a strong lantern line.
    // A broad crest travels along each 40-pixel rope without eroding shape.
    var ropePosition = pixelLocalIndex / 39.0;
    var contourCrest = wave(ropePosition * 0.82 + pz * 0.37
                          + lanternPhase * 0.91 + fixtureId * 0.029);
    contourCrest = smooth01(contourCrest);
    roleLevel = 0.62 + contourCrest * 0.18 + candleAir * 0.08
              + travellingFold * 0.18;
    nativeAccent = 0.035 + contourCrest * (0.025 + liveWhiteKick * 0.10);
    rgbBias = 0.92;
    whiteBias = 1.10;
  } else if (fixtureType == FIX_VINTAGE_6) {
    // Jewelry: all six cups remain lit, with paired flame and halo motion.
    // The high whiteBias makes the physical native-white emitters the hero.
    var cupPosition = (pixelLocalIndex + 0.5) / 6.0;
    var cupHalo = wave(cupPosition * 1.61803 - processionPhase * 0.71
                     + fixtureId * 0.043);
    var cupFlame = wave(cupPosition * 2.41421 + lanternPhase * 1.13
                      - fixtureId * 0.031);
    cupFlame = cupFlame * cupFlame * cupFlame * cupFlame;
    roleLevel = 0.54 + cupHalo * 0.18 + cupFlame * 0.24
              + travellingFold * 0.12;
    nativeAccent = 0.10 + cupHalo * 0.08
                 + cupFlame * (0.16 + liveWhiteKick * 0.68);
    rgbBias = 0.62;
    whiteBias = 1.34;
  } else if (fixtureType == FIX_PAR) {
    // Organs: forty independent vigils answer at incommensurate intervals.
    // Their floor is calm; kick only lifts the already-moving answer.
    var vigil = wave(organPhase + fixtureId * 0.137 + py * 0.19);
    var answer = wave(lanternPhase * 0.61803 - fixtureId * 0.083 + pz * 0.23);
    vigil = vigil * vigil;
    answer = answer * answer * answer;
    roleLevel = 0.32 + vigil * 0.26 + answer * 0.18
              + liveKick * max(vigil, answer) * 0.14
              + travellingFold * 0.08;
    nativeAccent = 0.025 + answer * (0.045 + liveWhiteKick * 0.30);
    whiteBias = 1.06;
  } else if (fixtureType == FIX_TE_SIGN) {
    // Identity: index folding reconstructs one complete 74-pixel topology
    // across the physical 40+34 fixture seam. Both signs therefore host the
    // same full-field procession instead of four restarting local fragments.
    var signIndex = index % 74.0;
    var signPath = signIndex / 73.0;
    // Identity must be authored entirely in its reconstructed local topology:
    // using ship-space X/Y here makes the physically separated signs differ.
    var signFold = processionFold(signPath * 0.82
                                - processionPhase * 4.80);
    var lanternA = wave(signPath * 1.00 - processionPhase * 0.79);
    var lanternB = wave(signPath * 1.61803 + lanternPhase * 0.61 + 0.23);
    lanternA = lanternA * lanternA * lanternA;
    lanternB = lanternB * lanternB * lanternB * lanternB;
    var procession = clamp01(max(lanternA, lanternB * 0.82));
    var letterBed = wave(signPath * 0.50 + waxPhase * 0.17);
    roleLevel = 0.48 + procession * 0.30 + letterBed * 0.10
              + signFold * 0.11;
    nativeAccent = 0.035 + procession * (0.06 + liveWhiteKick * 0.16);
    rgbBias = 0.86;
    whiteBias = 1.12;
  }

  var authoredLevel = 0.24 + liveLevel * 0.76;
  var cap = 0.06 + liveCeiling * 0.94;
  var brightness = clamp01((0.08 + roleLevel * 0.92) * authoredLevel
                         * (1.0 + liveKick * 0.18));
  brightness = brightness * cap;

  // Warmth shapes RGB only. Native white remains a matched W=A system on
  // every instrument; whiteLevel changes the RGB/native-white balance.
  var rgbShare = (1.0 - liveWhiteLevel * 0.68) * rgbBias;
  var red = brightness * rgbShare;
  var green = red * (1.0 - liveWarmth * 0.32);
  var blue = red * (1.0 - liveWarmth * 0.68);
  var white = brightness * liveWhiteLevel * whiteBias + nativeAccent * cap;
  white = clamp01(white);
  if (white > cap) white = cap;

  rgbwau(clamp01(red), clamp01(green), clamp01(blue), white, white, 0.0);
}
