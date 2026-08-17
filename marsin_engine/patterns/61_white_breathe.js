/*
  61_white_breathe.js - "White Breathe"  [WHITE ONLY family]

  One slow breath passes through five physical instruments without forcing
  them into lockstep: Hull becomes a luminous volume, Silhouette carries the
  travelling contour, Jewelry inhales as a six-pearl necklace, Organs answer
  in staggered pulses, and Identity remains a readable breathing nameplate.
  Real XYZ defines the roll; canonical fixture roles author the arrangement.

  No palette exports are present. Warm-neutral RGB plus explicit byte-matched
  W/A stays white under global palette and hue changes; UV is always zero.

  AUDIO_MODULATION_V1:
    sliderLevel     <- micLow  range 0.30..1.00 curve linear  # overall intensity (PRIMARY)
    sliderKick      <- micKick range 0.00..1.00 curve pow2    # breath pop
    sliderDepth     <- micMid  range 0.35..0.90 curve linear  # breath depth
    sliderWhiteKick <- micKick range 0.00..1.00 curve pow2    # W-emitter blinder bite
    # STATIC (omit from audio): localSpeed, direction, radius, whiteLevel, warmth
*/

export var localSpeed = 0.35;
export var direction  = 1.0;
export var level      = 0.70;
export var kick       = 0.0;
export var radius     = 0.5;
export var depth      = 0.42;
export var whiteLevel = 0.65;
export var whiteKick  = 0.20;
export var warmth     = 0.20;

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
export function sliderDepth(v)      { depth = v; }
export function sliderWhiteLevel(v) { whiteLevel = v; }
export function sliderWhiteKick(v)  { whiteKick = v; }
export function sliderWarmth(v)     { warmth = v; }

var PHASE_WRAP = 4096.0;
var breathPhase = 0.0;
// Launch away from a wrap boundary so a direction edit reverses the visible
// crest from the same mid-surface position instead of showing two wrap edges.
var rollPhase = 0.15;
var secondaryPhase = 0.19;
var bodyBreath = 0.5;
var liveDirection = 1.0;
var liveLevel = 0.70;
var liveKick = 0.0;
var liveRadius = 0.5;
var liveDepth = 0.42;
var liveWhiteLevel = 0.65;
var liveWhiteKick = 0.20;
var liveWarmth = 0.20;

function clamp01(value) {
  if (value < 0.0) return 0.0;
  if (value > 1.0) return 1.0;
  return value;
}

function slew(current, target, amount) {
  return current + (target - current) * amount;
}

function breathRibbon(coordinate) {
  var wrapped = coordinate - floor(coordinate);
  var coreAmount = 1.0 - clamp01(wrapped / 0.24);
  var core = coreAmount * coreAmount * coreAmount;
  var tailAmount = 1.0 - clamp01((1.0 - wrapped) / 0.58);
  return clamp01(core + tailAmount * tailAmount * 0.34);
}

export function beforeRender(delta) {
  var dt = clamp01(delta / 1000.0);
  if (dt > 0.1) dt = 0.1;
  var edit = clamp01(dt * 8.0);
  liveDirection = slew(liveDirection, direction, clamp01(dt * 24.0));
  liveLevel = slew(liveLevel, clamp01(level), edit);
  liveKick = slew(liveKick, clamp01(kick), edit);
  liveRadius = slew(liveRadius, clamp01(radius), edit);
  liveDepth = slew(liveDepth, clamp01(depth), edit);
  liveWhiteLevel = slew(liveWhiteLevel, clamp01(whiteLevel), edit);
  liveWhiteKick = slew(liveWhiteKick, clamp01(whiteKick), edit);
  liveWarmth = slew(liveWarmth, clamp01(warmth), edit);

  var localMult = pow(2.0, (localSpeed - 0.5) * 4.0);
  var rate = 0.010 + localMult * 0.050;
  breathPhase = breathPhase + dt * rate * liveDirection;
  // The quicker spatial roll makes reverse an honest contour-travel control
  // rather than a barely moving phase trim.
  rollPhase = rollPhase + dt * (0.075 + localMult * 0.44) * liveDirection;
  secondaryPhase = secondaryPhase + dt * rate * liveDirection * 0.41421;
  if (breathPhase >= PHASE_WRAP) breathPhase = breathPhase - PHASE_WRAP;
  else if (breathPhase <= -PHASE_WRAP) breathPhase = breathPhase + PHASE_WRAP;
  if (rollPhase >= PHASE_WRAP) rollPhase = rollPhase - PHASE_WRAP;
  else if (rollPhase <= -PHASE_WRAP) rollPhase = rollPhase + PHASE_WRAP;
  if (secondaryPhase >= PHASE_WRAP) secondaryPhase = secondaryPhase - PHASE_WRAP;
  else if (secondaryPhase <= -PHASE_WRAP) secondaryPhase = secondaryPhase + PHASE_WRAP;

  var inhale = wave(breathPhase);
  var second = wave(secondaryPhase + 0.37);
  bodyBreath = inhale * 0.72 + second * 0.28;
}

export function render3D(index, x, y, z) {
  var px = x - 0.5;
  var py = y - 0.5;
  var pz = z - 0.5;
  var isSign = fixtureType == FIX_TE_SIGN;
  if (isSign) {
    // Complete model-index folding carries one breath plane through the 40/34
    // fixture seam and makes the paired 74-pixel signs byte-identical.
    var signIndex = index % 74.0;
    px = (signIndex % 10.0) / 9.0 - 0.5;
    py = floor(signIndex / 10.0) / 7.0 - 0.5;
    pz = 0.0;
  }
  var scale = 0.50 + liveRadius * 2.35;
  var roll = wave((px * 0.78 + py * 0.93 - pz * 0.51) * scale
                - rollPhase);
  var crossRoll = wave((px * -0.41 + py * 0.37 + pz * 0.89) * scale
                     + secondaryPhase);
  var spatialBreath = bodyBreath * 0.64 + roll * 0.24 + crossRoll * 0.12;
  var depthShape = 1.0 - liveDepth
                 + liveDepth * spatialBreath * spatialBreath;
  var travellingInhale = breathRibbon(py * 0.90 + px * 0.08
                                    + pz * 0.02 - rollPhase);
  // A second, opposed fold produces deliberate negative space during the
  // exhale while the global bodyBreath still unifies the whole model.
  var quietFold = smoothstep(0.28, 0.76,
                             roll * 0.58 + (1.0 - crossRoll) * 0.42);
  var globalInhale = 0.16 + bodyBreath * 0.84;
  var roleLevel = 0.10 + depthShape * 0.44
                + travellingInhale * liveDepth * 0.30;
  var nativeAccent = 0.0;
  var nativeShare = 0.14;
  var rgbBias = 1.0;

  if (fixtureType == FIX_BAR_18) {
    // Hull Canvas: broad ribs inhale together, while offset voids keep the
    // surface dimensional instead of uniformly white.
    var volume = wave(py * scale * 0.74 - pz * 0.31
                    + rollPhase * 0.52);
    var hullRib = pow(wave(pixelLocalIndex / 18.0 * 1.5
                         + rollPhase * 0.29), 4.0);
    roleLevel = 0.08 + globalInhale * 0.28 + depthShape * 0.24
              + volume * liveDepth * 0.18
              + hullRib * quietFold * liveDepth * 0.24;
    nativeShare = 0.18;
  } else if (fixtureType == FIX_RAW_LED) {
    // Silhouette: one bright crest traces the outline with a dim tail.
    var contourCrest = breathRibbon(pixelLocalIndex * 0.021 + pz * 0.28
                                  + py * 0.12 - rollPhase * 1.17);
    roleLevel = 0.14 + globalInhale * 0.20 + depthShape * 0.16
              + contourCrest * liveDepth * 0.56;
    nativeShare = 0.08;
    rgbBias = 1.08;
  } else if (fixtureType == FIX_VINTAGE_6) {
    // Jewelry: six pearls inhale in sequence rather than as a flat rail.
    var pearlBreath = wave(pixelLocalIndex / 6.0 - breathPhase * 0.72
                         - rollPhase * 0.24);
    var pearlHalo = pow(pearlBreath, 2.0);
    var pearl = pow(pearlBreath, 8.0);
    roleLevel = 0.12 + globalInhale * 0.16 + pearlHalo * 0.18
              + pearl * 0.58;
    nativeAccent = pearl * 0.18
                 + liveWhiteKick * (0.10 + pearl * 0.62);
    nativeShare = 0.84;
    rgbBias = 1.10;
  } else if (fixtureType == FIX_PAR) {
    // Organs: staggered single-source answers to the shared inhale.
    var organBreath = wave(breathPhase + fixtureId * 0.173);
    organBreath = pow(organBreath, 4.0);
    roleLevel = 0.10 + globalInhale * 0.18 + organBreath * 0.64
              + liveKick * organBreath * 0.24;
    nativeAccent = liveWhiteKick * organBreath * 0.34;
    nativeShare = 0.32;
  } else if (isSign) {
    // Identity: a complete paired 74-pixel card breathes globally while two
    // local diagonals move through it, preserving both readability and life.
    var signDiagonal = breathRibbon((px + 0.5) * 0.76
                                  + (py + 0.5) * 0.38
                                  - rollPhase * 0.71);
    var signCounter = wave((px - py) * scale * 0.67
                         + secondaryPhase * 0.63);
    var letterBreath = signDiagonal * 0.68 + signCounter * 0.32;
    roleLevel = 0.20 + globalInhale * 0.22 + depthShape * 0.12
              + letterBreath * liveDepth * 0.42;
    nativeShare = 0.22;
    rgbBias = 1.10;
  }
  // Every instrument receives the same signed travelling inhale on top of
  // its authored detail, making Direction an unmistakable physical reversal.
  roleLevel = roleLevel + travellingInhale * liveDepth * 0.52;

  var authoredLevel = 0.14 + liveLevel * 0.86;
  var brightness = clamp01((0.045 + roleLevel * 0.91) * authoredLevel
                         * (1.0 + liveKick * 0.30));
  var rgbShare = (0.28 + (1.0 - liveWhiteLevel) * 0.56) * rgbBias;
  var red = brightness * rgbShare;
  var green = red * (1.0 - liveWarmth * 0.26);
  var blue = red * (1.0 - liveWarmth * 0.60);
  var white = clamp01(brightness * liveWhiteLevel * nativeShare
                    + nativeAccent);

  rgbwau(clamp01(red), clamp01(green), clamp01(blue), white, white, 0.0);
}
