/*
  63_white_chase.js - "White Chase"  [WHITE ONLY family]

  A smooth bow-to-stern procession authored separately for Titanic's five
  instruments. Hull ribbons travel in ship space, the Silhouette carries a
  fine counter-tracer, Vintage rails chase as six-lamp pearls, Organs answer
  in structural cohorts, and both complete 74-pixel TE surfaces receive the
  same composed scan. The ship stays outlined between passes.

  Every live control is slewed before it reaches geometry, so width, trail,
  count, and direction edits reshape the procession without a one-frame jump.
  White is authored directly with no palette dependency. W always equals A;
  UV is always zero.

  AUDIO_MODULATION_V1:
    sliderLevel      <- micLow  range 0.30..1.00 curve linear  # overall intensity (PRIMARY)
    sliderKick       <- micKick range 0.00..1.00 curve pow2    # bar pop
    sliderRadius     <- micFlux range 0.25..0.75 curve linear  # bar width swells on the build
    sliderWhiteKick  <- micKick range 0.00..1.00 curve pow2    # W-emitter blinder bite
    # STATIC (omit from audio): localSpeed, direction, tailLength, count, whiteLevel, warmth
*/

export var localSpeed = 0.5;
export var direction  = 1.0;
export var level      = 0.75;
export var kick       = 0.0;
export var radius     = 0.40;
export var tailLength = 0.45;
export var count      = 0.35;
export var whiteLevel = 0.60;
export var whiteKick  = 0.35;
export var warmth     = 0.05;

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
export function sliderTailLength(v) { tailLength = v; }
export function sliderCount(v)      { count = v; }
export function sliderWhiteLevel(v) { whiteLevel = v; }
export function sliderWhiteKick(v)  { whiteKick = v; }
export function sliderWarmth(v)     { warmth = v; }

var PHASE_WRAP = 4096.0;
var chasePhase = 0.0;
var liveDirection = 1.0;
var liveLevel = 0.75;
var liveKick = 0.0;
var liveRadius = 0.40;
var liveTailLength = 0.45;
var liveCount = 0.35;
var liveWhiteLevel = 0.60;
var liveWhiteKick = 0.35;
var liveWarmth = 0.05;

function clamp01(value) {
  if (value < 0.0) return 0.0;
  if (value > 1.0) return 1.0;
  return value;
}

function slew(current, target, amount) {
  return current + (target - current) * amount;
}

function chaseShape(coordinate, width, tail) {
  var wrapped = coordinate - floor(coordinate);
  var coreAmount = 1.0 - clamp01(wrapped / width);
  var core = coreAmount * coreAmount * (3.0 - 2.0 * coreAmount);
  var tailAmount = 1.0 - clamp01((1.0 - wrapped) / tail);
  var trail = tailAmount * tailAmount * 0.48;
  return clamp01(core + trail);
}

export function beforeRender(delta) {
  var dt = clamp01(delta / 1000.0);
  if (dt > 0.1) dt = 0.1;
  var edit = clamp01(dt * 8.0);
  liveDirection = slew(liveDirection, direction, clamp01(dt * 24.0));
  liveLevel = slew(liveLevel, clamp01(level), edit);
  liveKick = slew(liveKick, clamp01(kick), edit);
  liveRadius = slew(liveRadius, clamp01(radius), edit);
  liveTailLength = slew(liveTailLength, clamp01(tailLength), edit);
  liveCount = slew(liveCount, clamp01(count), edit);
  liveWhiteLevel = slew(liveWhiteLevel, clamp01(whiteLevel), edit);
  liveWhiteKick = slew(liveWhiteKick, clamp01(whiteKick), edit);
  liveWarmth = slew(liveWarmth, clamp01(warmth), edit);

  var localMult = pow(2.0, (localSpeed - 0.5) * 4.0);
  var rate = 0.035 + localMult * 0.27;
  chasePhase = chasePhase + dt * rate * liveDirection;
  if (chasePhase >= PHASE_WRAP) chasePhase = chasePhase - PHASE_WRAP;
  else if (chasePhase <= -PHASE_WRAP) chasePhase = chasePhase + PHASE_WRAP;
}

export function render3D(index, x, y, z) {
  var px = x - 0.5;
  var py = y - 0.5;
  var pz = z - 0.5;
  var isSign = fixtureType == FIX_TE_SIGN;
  if (isSign) {
    var signIndex = index % 74.0;
    px = (signIndex % 10.0) / 9.0 - 0.5;
    py = floor(signIndex / 10.0) / 7.0 - 0.5;
    pz = 0.0;
  }

  var barCount = 1.0 + floor(liveCount * 4.99);
  var width = 0.050 + liveRadius * 0.31;
  var tail = 0.10 + liveTailLength * 0.68;

  // Fixed ship axes make direction unambiguous and preserve the hull form.
  // X is the ship-length axis. Keeping the traveling phase independent of
  // Y/Z makes port and starboard exact spatial mirrors rather than two loosely
  // related diagonal wipes.
  var hullCoordinate = px + 0.5;
  var hullChase = chaseShape(hullCoordinate * barCount - chasePhase,
                             width, tail);
  var roleLevel = 0.08 + hullChase * 0.88;
  var nativeAccent = 0.0;
  var rgbBias = 1.0;
  var activity = hullChase;

  if (fixtureType == FIX_BAR_18) {
    // Hull: broad bow-to-stern ribbon, vertically faceted without changing
    // its direction of travel.
    var hullFacet = 0.76 + wave((py + 0.5) * 1.41
                              + (pz + 0.5) * 0.67) * 0.24;
    roleLevel = 0.07 + hullChase * hullFacet * 0.93;
    nativeAccent = hullChase * (0.035 + liveWhiteKick * 0.18);
  } else if (fixtureType == FIX_RAW_LED) {
    // Silhouette: a slimmer counter-thread rides a steady ship outline.
    var outlineCoordinate = px + 0.5;
    var contourChase = chaseShape(outlineCoordinate * barCount
                                + chasePhase * 0.73,
                                  width * 0.57, tail * 0.58);
    roleLevel = 0.16 + contourChase * 0.78;
    nativeAccent = contourChase * (0.018 + liveWhiteKick * 0.11);
    activity = contourChase;
    rgbBias = 1.05;
  } else if (fixtureType == FIX_VINTAGE_6) {
    // Jewelry: six discrete pearls chase locally on every rail.
    var jewelCoordinate = pixelLocalIndex / 6.0 * barCount
                        - chasePhase * 1.11;
    var jewelChase = chaseShape(jewelCoordinate,
                                width * 0.61, tail * 0.49);
    roleLevel = 0.10 + jewelChase * 0.90;
    nativeAccent = jewelChase * (0.22 + liveWhiteKick * 0.70);
    activity = jewelChase;
    rgbBias = 1.08;
  } else if (fixtureType == FIX_PAR) {
    // Organs: stacks answer as staggered structural cohorts.
    var organCoordinate = fixtureId * 0.173 * barCount
                        - chasePhase * 0.83;
    var organChase = chaseShape(organCoordinate,
                                width * 0.74, tail * 0.44);
    var organEcho = chaseShape(organCoordinate + 0.43,
                               width * 0.48, tail * 0.31);
    roleLevel = 0.12 + organChase * 0.74 + organEcho * 0.14;
    nativeAccent = organChase * (0.08 + liveWhiteKick * 0.35);
    activity = clamp01(organChase + organEcho * 0.35);
  } else if (isSign) {
    // Identity: exact paired 10x8 surfaces cross-scan in two dimensions.
    var signHorizontal = chaseShape((px + 0.5) * barCount
                                  - chasePhase * 0.44,
                                    width * 0.69, tail * 0.54);
    var signVertical = chaseShape((py + 0.5) * barCount
                                + chasePhase * 0.31 + 0.37,
                                  width * 0.54, tail * 0.43);
    var signIntersection = signHorizontal * signVertical;
    roleLevel = 0.24 + signHorizontal * 0.32 + signVertical * 0.17
              + signIntersection * 0.30;
    nativeAccent = signIntersection * (0.025 + liveWhiteKick * 0.09);
    activity = clamp01(signHorizontal * 0.62 + signVertical * 0.28
                     + signIntersection * 0.35);
    rgbBias = 1.08;
  }

  var authoredLevel = 0.10 + liveLevel * 0.90;
  var kickLift = liveKick * activity * 0.32;
  var brightness = clamp01((roleLevel + kickLift) * authoredLevel);
  var rgbShare = (1.0 - liveWhiteLevel * 0.68) * rgbBias;
  var red = brightness * rgbShare;
  var green = red * (1.0 - liveWarmth * 0.26);
  var blue = red * (1.0 - liveWarmth * 0.60);
  var white = clamp01(brightness * liveWhiteLevel + nativeAccent);

  rgbwau(clamp01(red), clamp01(green), clamp01(blue), white, white, 0.0);
}
