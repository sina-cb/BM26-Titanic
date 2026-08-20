/*
  60_white_wash.js - "White Wash"  [WHITE ONLY family]

  An elegant authored white material, not one flat paint bucket. Hull bars
  carry slow satin planes; Silhouette ropes hold the ship's contour; Vintage
  rails are a six-pearl Jewelry hero; pars punctuate structure; TE signs hold
  a calm engraved nameplate. Real XYZ supplies the material field while the
  canonical fixtureType roles assign each physical family its own job.

  This file deliberately declares no palette exports. Warm-neutral RGB and
  explicit matched W/A make the look untintable by global palettes and hue;
  UV is always zero. `evenness` can still turn this into a practical work
  light, but the five role levels remain composed instead of becoming equal.

  AUDIO_MODULATION_V1:
    sliderLevel      <- micLow  range 0.35..1.00 curve linear  # overall intensity (PRIMARY)
    sliderKick       <- micKick range 0.00..1.00 curve pow2    # brightness pop
    sliderRadius     <- micFlux range 0.35..0.85 curve linear  # wash feature scale
    sliderWhiteKick  <- micKick range 0.00..1.00 curve pow2    # W-emitter blinder bite
    # STATIC (omit from audio): localSpeed, direction, evenness, whiteLevel, warmth
*/

export var localSpeed = 0.5;
export var direction  = 1.0;
export var level      = 0.65;
export var kick       = 0.0;
export var radius     = 0.5;
export var evenness   = 0.35;
export var whiteLevel = 0.70;
export var whiteKick  = 0.15;
export var warmth     = 0.15;

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
export function sliderEvenness(v)   { evenness = v; }
export function sliderWhiteLevel(v) { whiteLevel = v; }
export function sliderWhiteKick(v)  { whiteKick = v; }
export function sliderWarmth(v)     { warmth = v; }

var PHASE_WRAP = 4096.0;
var travelA = 0.0;
var travelB = 0.0;
var liveDirection = 1.0;
var liveLevel = 0.65;
var liveKick = 0.0;
var liveRadius = 0.5;
var liveEvenness = 0.35;
var liveWhiteLevel = 0.70;
var liveWhiteKick = 0.15;
var liveWarmth = 0.15;

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

function satinRibbon(coordinate) {
  var wrapped = coordinate - floor(coordinate);
  var coreAmount = 1.0 - clamp01(wrapped / 0.22);
  var core = coreAmount * coreAmount * coreAmount;
  var tailAmount = 1.0 - clamp01((1.0 - wrapped) / 0.55);
  return clamp01(core + tailAmount * tailAmount * 0.38);
}

export function beforeRender(delta) {
  var dt = clamp01(delta / 1000.0);
  if (dt > 0.1) dt = 0.1;
  var edit = clamp01(dt * 8.0);

  // Direction settles quickly enough for a deliberate reversal to read from
  // the first material fold, while the slower edit slew still protects gain.
  liveDirection = slew(liveDirection, direction, clamp01(dt * 24.0));
  liveLevel = slew(liveLevel, clamp01(level), edit);
  liveKick = slew(liveKick, clamp01(kick), edit);
  liveRadius = slew(liveRadius, clamp01(radius), edit);
  liveEvenness = slew(liveEvenness, clamp01(evenness), edit);
  liveWhiteLevel = slew(liveWhiteLevel, clamp01(whiteLevel), edit);
  liveWhiteKick = slew(liveWhiteKick, clamp01(whiteKick), edit);
  liveWarmth = slew(liveWarmth, clamp01(warmth), edit);

  var localMult = pow(2.0, (localSpeed - 0.5) * 4.0);
  var rate = 0.060 + localMult * 0.540;
  travelA = travelA + dt * rate * liveDirection;
  travelB = travelB - dt * rate * liveDirection * 0.61803;
  if (travelA >= PHASE_WRAP) travelA = travelA - PHASE_WRAP;
  else if (travelA <= -PHASE_WRAP) travelA = travelA + PHASE_WRAP;
  if (travelB >= PHASE_WRAP) travelB = travelB - PHASE_WRAP;
  else if (travelB <= -PHASE_WRAP) travelB = travelB + PHASE_WRAP;
}

export function render3D(index, x, y, z) {
  var px = x - 0.5;
  var py = y - 0.5;
  var pz = z - 0.5;
  var isSign = fixtureType == FIX_TE_SIGN;
  if (isSign) {
    // A sign spans fixture-local 40 + 34 counters. Fold the model index over
    // one complete 10x8 plane so its lower rows continue across the seam and
    // both physical Identity surfaces remain byte-identical.
    var signIndex = index % 74.0;
    px = (signIndex % 10.0) / 9.0 - 0.5;
    py = floor(signIndex / 10.0) / 7.0 - 0.5;
    pz = 0.0;
  }
  var scale = 0.68 + liveRadius * 3.10;
  var planeA = wave((px * 1.47 + py * 0.53 - pz * 0.77) * scale
                  + travelA);
  var planeB = wave((px * -0.37 + py * 1.13 + pz * 0.69) * scale
                  + travelB);
  var crossGrain = smoothstep(0.20, 0.82, planeA * planeB);
  var fold = smooth01(planeA * 0.56 + planeB * 0.44);
  // Evenness softens the satin contrast without erasing its motion or making
  // every fixture family converge on one flat level.
  var material = 0.10 + fold * (0.74 - liveEvenness * 0.30)
               + crossGrain * (0.20 - liveEvenness * 0.10);
  var movingSelvedge = satinRibbon(px * 0.83 + py * 0.31
                                + pz * 0.57 - travelA);

  var roleLevel = 0.12 + material * 0.67;
  var nativeAccent = 0.0;
  var nativeShare = 0.16;
  var rgbBias = 1.0;

  if (fixtureType == FIX_BAR_18) {
    // Hull Canvas: broad moving satin with narrow luminous ribs. The field is
    // authored in XYZ so the hull reads as material instead of one dimmer.
    var hullFold = smoothstep(0.32, 0.86,
                              1.0 - abs(planeA - planeB));
    var hullRib = pow(wave(pixelLocalIndex / 18.0 * 2.0
                         - travelB * 0.71), 5.0);
    roleLevel = 0.10 + material * 0.58 + hullFold * 0.20
              + hullRib * movingSelvedge * 0.18;
    nativeShare = 0.19;
  } else if (fixtureType == FIX_RAW_LED) {
    // Silhouette: an asymmetric crest walks the physical outline, leaving
    // enough negative space behind it for the ship geometry to stay legible.
    var contour = satinRibbon(pixelLocalIndex * 0.023 + pz * 0.31
                            + py * 0.17 - travelA * 0.83);
    roleLevel = 0.18 + material * 0.22 + contour * 0.62;
    nativeShare = 0.10;
    rgbBias = 1.08;
  } else if (fixtureType == FIX_VINTAGE_6) {
    // Jewelry: finite pearls have a halo and a brilliant native-white core.
    var pearlPhase = pixelLocalIndex / 6.0 - travelA * 1.07;
    var pearlHalo = pow(wave(pearlPhase), 2.0);
    var pearl = pow(wave(pearlPhase), 10.0);
    roleLevel = 0.16 + pearlHalo * 0.24 + pearl * 0.62;
    nativeAccent = pearl * 0.20
                 + liveWhiteKick * (0.12 + pearl * 0.58);
    nativeShare = 0.82;
    rgbBias = 1.10;
  } else if (fixtureType == FIX_PAR) {
    // Organs: discrete structural punctuation, not another wash surface.
    var organ = pow(wave(fixtureId * 0.173 + travelB * 1.17), 3.0);
    roleLevel = 0.16 + material * 0.16 + organ * 0.64
              + liveKick * organ * 0.24;
    nativeAccent = liveWhiteKick * organ * 0.34;
    nativeShare = 0.32;
  } else if (isSign) {
    // Identity: two moving diagonals engrave the complete 74-pixel surface;
    // every pixel remains readable while the nameplate visibly changes.
    var signSweep = satinRibbon((px + 0.5) * 0.78
                              + (py + 0.5) * 0.33 - travelA * 0.72);
    var signCross = wave((px - py) * scale * 0.61 + travelB * 0.47);
    var engraving = smoothstep(0.28, 0.78,
                                signSweep * 0.62 + signCross * 0.38);
    roleLevel = 0.24 + material * 0.24 + engraving * 0.48;
    nativeShare = 0.23;
    rgbBias = 1.10;
  }
  roleLevel = roleLevel + movingSelvedge * (1.0 - liveEvenness) * 0.30;

  var authoredLevel = 0.14 + liveLevel * 0.86;
  var brightness = clamp01((0.045 + roleLevel * 0.91) * authoredLevel
                         * (1.0 + liveKick * 0.28));
  var rgbShare = (0.28 + (1.0 - liveWhiteLevel) * 0.56) * rgbBias;
  var red = brightness * rgbShare;
  var green = red * (1.0 - liveWarmth * 0.26);
  var blue = red * (1.0 - liveWarmth * 0.60);
  var white = clamp01(brightness * liveWhiteLevel * nativeShare
                    + nativeAccent);

  rgbwau(clamp01(red), clamp01(green), clamp01(blue), white, white, 0.0);
}
