// DRAFT — pending operator review
/*
  42_seed_drift.js — SEED DRIFT

  CONCEPT
    A finite family of rigid, paired-wing seeds rises and tumbles through a
    gentle updraft. Every active object has exactly two lens-shaped wings and
    one finite stem. There are no droplets, falling streaks, rain columns, or
    independently moving particle trails.

  INSTRUMENT STAGING
    FIX_BAR_18     — a quiet air field carrying complete seed silhouettes.
    FIX_RAW_LED    — the strongest paired-wing and stem reading at distance.
    FIX_VINTAGE_6  — palette-RGB seed coats; no native-white shortcut.
    FIX_PAR        — four steady updraft sources beneath the rising objects.
    FIX_TE_SIGN    — identical complete 74-pixel seed windows.

  CONTROLS (declaration order = physical MIDI order)
    localSpeed  — cadence of the rigid seeds' vertical travel.
    direction   — genuine signed reversal of their net vertical motion.
    seedCount   — number of complete paired-wing objects admitted to the field.
    wingSpan    — separation and length of both wings on every object.
    tumble      — angular excursion of each complete rigid seed.
    updraft     — vertical lift rate and prominence of the supporting air.
    safetyFloor — minimum palette-derived whole-vessel visibility.

  AUDIO_MODULATION_V1:
    sliderUpdraft <- micFlux range 0.20..0.55 curve ease # flux lifts the complete seed family
    sliderSeedCount <- micHigh range 0.15..0.42 curve linear # highs admit more paired-wing seeds
  Static (unmapped) params: localSpeed, direction, wingSpan, tumble,
    safetyFloor, colorPalette1/2.

  COLOR / OUTPUT
    RGB lies strictly on the selected cp1-to-cp2 line. Native white, amber,
    and UV remain zero. A protected floor keeps the complete vessel visible
    while the finite seed objects travel in either operator-selected direction.
*/

export var cp1H = 0.465, cp1S = 0.78, cp1V = 0.88;
export var cp2H = 0.105, cp2S = 0.72, cp2V = 1.00;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export var localSpeed = 0.30;
export var direction = 0.76;
export var seedCount = 0.32;
export var wingSpan = 0.52;
export var tumble = 0.42;
export var updraft = 0.34;
export var safetyFloor = 0.28;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderDirection(v) {
  direction = v;
  if (v < 0.50) heading = -1.0;
  else heading = 1.0;
}
export function sliderSeedCount(v) { seedCount = v; }
export function sliderWingSpan(v) { wingSpan = v; }
export function sliderTumble(v) { tumble = v; }
export function sliderUpdraft(v) { updraft = v; }
export function sliderSafetyFloor(v) { safetyFloor = v; }

var PHASE_WRAP = 1.0;
var PHI = 1.61803399;
var SQRT2 = 1.41421356;
var SQRT3 = 1.73205081;
var GOLDEN_ANGLE = 2.39996323;

var riseClock = 0.0;
var airClock = 0.419;
var heading = 1.0;

var liveSeedCount = 0.32;
var liveWingSpan = 0.52;
var liveTumble = 0.42;
var liveUpdraft = 0.34;
var liveSafetyFloor = 0.28;
var liveColumns = 6.0;
var liveSpan = 0.20;
var liveWingLength = 0.17;
var liveWingDepth = 0.080;
var liveVeinCount = 3.0;

// The seed identities are a finite 9x5 maximum. Their hash and rigid tumble
// matrices are frame-uniform, so calculate them once rather than 964 times.
var seedHash = array(45);
var seedHash2 = array(45);
var seedCos = array(45);
var seedSin = array(45);

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

  // Object geometry and audio controls pursue their targets continuously.
  // The seed lattice never reseeds; Seed Count only admits fixed objects.
  var geometryFollow = min(1.0, dt * 4.5);
  var lightFollow = min(1.0, dt * 9.0);
  liveSeedCount += (clamp01(seedCount) - liveSeedCount) * geometryFollow;
  liveWingSpan += (clamp01(wingSpan) - liveWingSpan) * geometryFollow;
  liveTumble += (clamp01(tumble) - liveTumble) * geometryFollow;
  liveUpdraft += (clamp01(updraft) - liveUpdraft) * geometryFollow;
  liveSafetyFloor += (clamp01(safetyFloor) - liveSafetyFloor) * lightFollow;

  var speedMultiplier = 0.25 + clamp01(localSpeed)
    * (32.824 - 16.412 * clamp01(localSpeed));
  var liftRate = (0.026 + liveUpdraft * 0.105) * speedMultiplier;
  riseClock += dt * liftRate;
  if (riseClock >= PHASE_WRAP) riseClock -= PHASE_WRAP;

  // Air motion shares direction but uses an irrational rate, remaining a
  // broad supporting field rather than a vertically repeated streak texture.
  airClock += dt * (0.008 + liveUpdraft * 0.024) * SQRT2;
  if (airClock >= PHASE_WRAP) airClock -= PHASE_WRAP;

  liveColumns = 9.0 - floor(clamp01(liveWingSpan) * 5.999);
  liveSpan = 0.06 + clamp01(liveWingSpan) * 0.28;
  liveWingLength = 0.08 + clamp01(liveWingSpan) * 0.17;
  liveWingDepth = 0.050 + clamp01(liveWingSpan) * 0.065;
  liveVeinCount = 1.0 + floor(clamp01(liveWingSpan) * 4.999);
  var seedRow = 0.0;
  var seedColumn = 0.0;
  for (seedRow = 0.0; seedRow < 5.0; seedRow = seedRow + 1.0) {
    for (seedColumn = 0.0; seedColumn < liveColumns;
         seedColumn = seedColumn + 1.0) {
      var seedId = seedColumn + seedRow * liveColumns;
      var hashA = wave(seedId * 0.75487767 + seedColumn * PHI
                     + seedRow * 0.56984029);
      var hashB = wave(seedId * SQRT2 - seedColumn * 0.38196601
                     + seedRow * GOLDEN_ANGLE / PI2);
      var tumbleTurns = 1.0 + floor(hashA * 3.999);
      var tumblePhase = riseClock * PI2 * tumbleTurns
                      + seedId * GOLDEN_ANGLE;
      var objectAngle = (hashA - 0.50) * 0.42
                      + sin(tumblePhase) * clamp01(liveTumble) * 1.35;
      seedHash[seedId] = hashA;
      seedHash2[seedId] = hashB;
      seedCos[seedId] = cos(objectAngle);
      seedSin[seedId] = sin(objectAngle);
    }
  }

  _hsv2rgb1();
  _hsv2rgb2();
}

export function render3D(index, x, y, z) {
  var ux = clamp01(x);
  var uy = clamp01(y);
  var uz = clamp01(z);
  var isSign = fixtureType == FIX_TE_SIGN;

  if (isSign) {
    // One sign is patched as 40 + 34 pixels, so fixture-local indexing repeats
    // the top rows. Model-index folding continues one complete 10x8 window
    // across the seam and gives both physical signs byte-identical motion.
    var signIndex = index % 74.0;
    ux = (signIndex % 10.0) / 9.0;
    uy = floor(signIndex / 10.0) / 7.0;
    uz = 0.50;
  }

  // Six columns by five wrapped rows define a finite family of potential
  // rigid objects. Vertical phase translates the family as one continuous
  // updraft; modulo row identity makes the one-turn wrap exact.
  // Wider lenses need fewer columns to remain separate complete objects.
  // This couples local lens reach to real shipwise extent: the sweep moves
  // from nine compact seed columns to four broad seed columns, while Seed
  // Count independently controls which complete objects are admitted.
  var columns = liveColumns;
  var rows = 5.0;
  var fieldY = uy * 0.72 + uz * 0.28;
  var travelClock = riseClock * heading;
  var gridX = ux * columns;
  var gridY = (fieldY - travelClock) * rows;
  var rawColumn = floor(gridX);
  var rawRow = floor(gridY);
  var column = rawColumn - floor(rawColumn / columns) * columns;
  var row = rawRow - floor(rawRow / rows) * rows;
  var objectId = column + row * columns;
  var objectHash = seedHash[objectId];
  var objectHash2 = seedHash2[objectId];

  // Fixed per-object center offsets prevent a regimented lattice. The local
  // coordinates remain bounded inside one cell and rotate as one rigid seed.
  var localX = (gridX - rawColumn) - 0.50
             - (objectHash - 0.50) * 0.18;
  var localY = (gridY - rawRow) - 0.50
             - (objectHash2 - 0.50) * 0.16;
  var angleCos = seedCos[objectId];
  var angleSin = seedSin[objectId];
  var objectX = localX * angleCos + localY * angleSin;
  var objectY = -localX * angleSin + localY * angleCos;

  // Two finite elliptical lens SDFs, mirrored around one stem. Their centers
  // and splay are part of this object's rigid local frame, so neither wing can
  // drift independently or turn into a streak.
  var span = liveSpan;
  var wingLength = liveWingLength;
  var wingDepth = liveWingDepth;
  var splayCos = 0.913089;
  var splaySin = 0.407760;

  var leftX = objectX + span;
  var leftY = objectY + 0.055;
  var leftAlong = leftX * splayCos - leftY * splaySin;
  var leftAcross = leftX * splaySin + leftY * splayCos;
  var leftRadiusSquared = (leftAlong / wingLength) * (leftAlong / wingLength)
                        + (leftAcross / wingDepth) * (leftAcross / wingDepth);
  var leftWing = smooth01(1.0 - leftRadiusSquared);

  var rightX = objectX - span;
  var rightY = objectY + 0.055;
  var rightAlong = rightX * splayCos + rightY * splaySin;
  var rightAcross = -rightX * splaySin + rightY * splayCos;
  var rightRadiusSquared = (rightAlong / wingLength)
                         * (rightAlong / wingLength)
                         + (rightAcross / wingDepth)
                         * (rightAcross / wingDepth);
  var rightWing = smooth01(1.0 - rightRadiusSquared);

  // One finite line stem begins between the wings and extends below them.
  var stemNearestY = min(0.34, max(-0.02, objectY));
  var stemDistanceSquared = objectX * objectX
                          + (objectY - stemNearestY)
                          * (objectY - stemNearestY);
  var stem = smooth01(1.0 - stemDistanceSquared / 0.0016);

  // Seed Count smoothly admits deterministic complete objects. Because this
  // gate multiplies both wings and the stem together, no half-seed can appear.
  var admissionThreshold = 0.76 - clamp01(liveSeedCount) * 0.58;
  var admitted = smooth01((objectHash - admissionThreshold) / 0.14);
  // Longer physical wings expose more finite structural veins inside the two
  // lens masks. The control therefore changes true reach plus resolvable
  // spatial extent on Titanic's sparse topology, never just output gain.
  var veinCount = liveVeinCount;
  var leftVeins = 0.42 + 0.58
                * wave(leftAlong / wingLength * veinCount * 0.50);
  var rightVeins = 0.42 + 0.58
                 * wave(rightAlong / wingLength * veinCount * 0.50);
  var wingSurface = max(leftWing * leftVeins,
                        rightWing * rightVeins) * admitted;
  var wings = max(leftWing, rightWing) * admitted;
  var completeSeed = max(wingSurface, stem * admitted);
  var wingSeam = min(leftWing, rightWing) * admitted;

  // Two broad irrational harmonics describe open air. No narrow threshold or
  // vertical repetition is applied, so the field cannot read as rain streaks.
  var airA = wave(ux * 0.61 + fieldY * 0.37 - uz * 0.29
                - airClock * heading);
  var airB = wave(ux * SQRT2 - fieldY * 0.43 + uz * PHI
                + airClock * 2.0 * heading);
  // One sub-cycle vertical pressure gradient translates with the seed family.
  // Its wavelength is wider than the complete ship, so it proves signed net
  // travel without becoming a repeated band or a rain/streak field.
  var directionAir = wave(fieldY * 0.45 - travelClock);
  var airField = 0.40 * airA + 0.30 * airB + 0.30 * directionAir;
  var updraftCenter = 0.50 + heading * (wave(riseClock) - 0.50);
  var updraftBody = 1.0 - smoothstep(0.10, 0.24,
                                     abs(uy - updraftCenter));
  var floorLevel = 0.055 + clamp01(liveSafetyFloor) * 0.225;
  var airLift = (0.040 + liveUpdraft * 0.150) * airField
              + updraftBody * (0.16 + liveUpdraft * 0.25);
  var brightness = floorLevel + airLift
                 + completeSeed * (0.76 + liveUpdraft * 0.48)
                 + wingSeam * 0.16;
  var paletteMix = clamp01(0.08 + airB * 0.11 + directionAir * 0.09
                          + leftWing * admitted * 0.30
                          + rightWing * admitted * 0.54
                          + stem * admitted * 0.18);

  if (fixtureType == FIX_BAR_18) {
    // Hull Canvas remains airy while presenting whole rigid seed silhouettes.
    brightness = floorLevel + airLift
               + completeSeed * (0.74 + liveUpdraft * 0.50)
               + wingSeam * 0.14;
  } else if (fixtureType == FIX_RAW_LED) {
    // Silhouette carries the clearest paired wings and their central stem.
    brightness = floorLevel + 0.055 + airLift * 0.65
               + completeSeed * (0.80 + liveUpdraft * 0.44)
               + stem * admitted * 0.18;
    paletteMix = clamp01(0.10 + leftWing * admitted * 0.32
                        + rightWing * admitted * 0.58
                        + stem * admitted * 0.12);
  } else if (fixtureType == FIX_VINTAGE_6) {
    // Jewelry coats the same finite seeds in palette RGB. It adds no sparkle
    // clock and emits no native white, keeping the objects structurally honest.
    var coat = completeSeed * (0.72 + objectHash2 * 0.28);
    brightness = floorLevel * 0.78 + 0.045 + airLift * 0.28
               + coat * (0.66 + liveUpdraft * 0.42);
    paletteMix = clamp01(0.46 + leftWing * admitted * 0.18
                        + rightWing * admitted * 0.42
                        + stem * admitted * 0.08);
  } else if (fixtureType == FIX_PAR) {
    // Organs are the updraft sources: four broad source phases lift with Flux
    // without becoming independent seed objects or transient flashes.
    var sourcePhase = wave(pixelLocalIndex * 0.25 + airClock * heading);
    brightness = floorLevel + 0.13 + airField * 0.06
               + liveUpdraft * (0.24 + sourcePhase * 0.34)
               + completeSeed * 0.18;
    paletteMix = clamp01(0.16 + sourcePhase * 0.56
                        + completeSeed * 0.18);
  } else if (isSign) {
    // Each TE surface receives the same complete local seeds over a readable
    // bed. Both wings and the stem remain active rather than freezing the logo.
    brightness = max(0.30, floorLevel + 0.15 + airLift * 0.72
                   + completeSeed * (0.60 + liveUpdraft * 0.44)
                   + wingSeam * 0.12);
    paletteMix = clamp01(0.12 + airB * 0.12
                        + leftWing * admitted * 0.28
                        + rightWing * admitted * 0.50
                        + stem * admitted * 0.16);
  }

  brightness = clamp01(brightness);
  paletteMix = clamp01(paletteMix);
  var outR = (pr1 + (pr2 - pr1) * paletteMix) * brightness;
  var outG = (pg1 + (pg2 - pg1) * paletteMix) * brightness;
  var outB = (pb1 + (pb2 - pb1) * paletteMix) * brightness;
  rgbwau(clamp01(outR), clamp01(outG), clamp01(outB), 0.0, 0.0, 0.0);
}
