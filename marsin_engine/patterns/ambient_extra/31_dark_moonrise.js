// DRAFT — pending operator review
/*
  31_dark_moonrise.js — DARK MOONRISE

  CONCEPT
    One luminous crescent rises from below the hull, holds above the ship's
    skyline, then sinks away. It is a bright moon, never an eclipse or orbit.

  INSTRUMENT STAGING
    FIX_BAR_18     — moonlit body and the broad crescent crossing the Hull.
    FIX_RAW_LED    — bright skyline and a crisp crescent edge.
    FIX_VINTAGE_6  — sparse matched W=A stars around a palette-derived bed.
    FIX_PAR        — steady horizon anchors beneath the rising moon.
    FIX_TE_SIGN    — paired 10x8 crescent seals with identical choreography.

  MOTION / MATH
    A single crescent is the difference of one outer circle and one offset
    inner circle. Its Y center follows a cubic-eased rise for 35% of the
    cycle, holds within an exact stationary apex for 30%, and descends for
    35%. The centroid travels over 45% of normalized model Y at defaults.
    Its concentric halo has no rotation, texture drift, or duplicate lobes.

  CONTROLS (declaration order = physical MIDI order)
    localSpeed    — cadence of the complete rise, hold, and descent.
    moonSize      — radius of the one luminous moon.
    crescentWidth — thickness of its bright crescent blade.
    rise          — vertical distance and skyline height of the moonrise.
    halo          — breadth and intensity of the stationary lunar halo.
    level         — prominence of moonlight above the complete ship bed.
    safetyFloor   — minimum whole-ship visibility when the moon is below it.

  AUDIO_MODULATION_V1:
    sliderHalo  <- micFlux range 0.10..0.38 curve ease   # PRIMARY: flux opens the stationary lunar halo
    sliderLevel <- micLow  range 0.34..0.68 curve linear # lows lift the crescent and moonlit body
  Static (unmapped) params: localSpeed, moonSize, crescentWidth, rise,
    safetyFloor, colorPalette1/2.

  COLOR / OUTPUT
    RGB stays strictly on the selected cp1-to-cp2 line. Jewelry alone emits
    restrained native-white stars, always with byte-identical W and A. UV is
    always zero. Silence retains a complete, readable nighttime ship.
*/

export var localSpeed = 0.30;
export var moonSize = 0.48;
export var crescentWidth = 0.46;
export var rise = 0.62;
export var halo = 0.24;
export var level = 0.54;
export var safetyFloor = 0.27;

export var cp1H = 0.61, cp1S = 0.76, cp1V = 0.90;
export var cp2H = 0.105, cp2S = 0.44, cp2V = 1.00;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderMoonSize(v) { moonSize = v; }
export function sliderCrescentWidth(v) { crescentWidth = v; }
export function sliderRise(v) { rise = v; }
export function sliderHalo(v) { halo = v; }
export function sliderLevel(v) { level = v; }
export function sliderSafetyFloor(v) { safetyFloor = v; }

var GOLDEN_ANGLE = 2.39996323;
var PHI = 1.61803399;
var CLOCK_WRAP = 10000.0;

// Begin in the early rise so short offline audits and gallery clips see the
// defining vertical travel immediately; the analytic cycle remains seamless.
var moonClock = 0.02;
var moonY = -0.16;
var liveMoonSize = 0.48;
var liveCrescentWidth = 0.46;
var liveRise = 0.62;
var liveHalo = 0.24;
var liveLevel = 0.54;
var liveSafetyFloor = 0.27;

var pr1 = 1.0, pg1 = 0.0, pb1 = 0.0;
var pr2 = 0.0, pg2 = 0.0, pb2 = 1.0;

function clamp01(v) {
  if (v < 0.0) return 0.0;
  if (v > 1.0) return 1.0;
  return v;
}

function smooth01(v) {
  var q = clamp01(v);
  return q * q * (3.0 - 2.0 * q);
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

  // Every live edit eases into the geometry instead of jumping the moon.
  var follow = min(1.0, dt * 4.0);
  liveMoonSize += (moonSize - liveMoonSize) * follow;
  liveCrescentWidth += (crescentWidth - liveCrescentWidth) * follow;
  liveRise += (rise - liveRise) * follow;
  liveHalo += (halo - liveHalo) * follow;
  liveLevel += (level - liveLevel) * follow;
  liveSafetyFloor += (safetyFloor - liveSafetyFloor) * follow;

  var localMultiplier = 0.25 + clamp01(localSpeed)
    * (32.824 - 16.412 * clamp01(localSpeed));
  moonClock += dt * (0.007 + 0.018 * localMultiplier);
  if (moonClock >= CLOCK_WRAP) moonClock -= CLOCK_WRAP;

  var cyclePhase = moonClock - floor(moonClock);
  var travel = 0.0;
  if (cyclePhase < 0.35) {
    travel = smooth01(cyclePhase / 0.35);
  } else if (cyclePhase < 0.65) {
    travel = 1.0;
  } else {
    travel = 1.0 - smooth01((cyclePhase - 0.65) / 0.35);
  }

  // Defaults span 0.77 normalized Y; even the lowest Rise retains a clearly
  // legible passage through the skyline rather than flattening into a pulse.
  var lowY = -0.18;
  var travelHeight = 0.49 + clamp01(liveRise) * 0.45;
  moonY = lowY + travel * travelHeight;

  _hsv2rgb1();
  _hsv2rgb2();
}

export function render3D(index, x, y, z) {
  var ux = clamp01(x);
  var uy = clamp01(y);
  var uz = clamp01(z);
  var isSign = fixtureType == FIX_TE_SIGN;

  if (isSign) {
    // Each sign spans a 40-pixel fixture plus a 34-pixel fixture. The global
    // fold authors one complete 74-pixel 10x8 seal on both physical signs.
    var signIndex = index % 74.0;
    ux = (signIndex % 10.0) / 9.0;
    uy = floor(signIndex / 10.0) / 7.0;
    uz = 0.50;
  }

  // The physical model is sparse, so the lunar blade needs a playa-scale
  // footprint rather than a screen-space-thin SDF. At defaults the disc spans
  // almost two thirds of normalized model height; Z is still present, but
  // compressed enough that the two broadsides read as one celestial body.
  var radius = 0.14 + clamp01(liveMoonSize) * 0.38;
  var edge = 0.022 + radius * 0.080;
  var moonX = 0.52;
  var dx = ux - moonX;
  var dy = uy - moonY;
  // Z compression makes one readable disc span the ship's physical depth
  // without producing a second front/back moon.
  var dz = (uz - 0.50) * 0.18;
  var radialDistance = sqrt(dx * dx + dy * dy + dz * dz);
  var outerDistance = radialDistance - radius;
  var outerDisc = 1.0 - smoothstep(-edge, edge, outerDistance);

  var width = clamp01(liveCrescentWidth);
  // The cut nearly matches the outer disc and overlaps it deeply. This keeps
  // empty night visible inside one clean blade instead of filling a sector.
  var cutRadius = radius * (0.96 - width * 0.22);
  var cutOffset = radius * (0.22 + width * 0.28);
  var cutDx = ux - (moonX + cutOffset);
  var innerDistance = sqrt(cutDx * cutDx + dy * dy + dz * dz)
                    - cutRadius;
  var outsideCut = smoothstep(-edge, edge, innerDistance);
  var crescent = outerDisc * outsideCut;
  var bladeRim = (1.0 - smoothstep(edge * 0.35, edge * 1.80,
                                    abs(outerDistance))) * outsideCut;

  // One non-rotating concentric halo: no second moon, orbit, or moving grain.
  var haloRadius = radius + 0.055 + clamp01(liveHalo) * 0.21;
  var haloField = 1.0 - smoothstep(radius, haloRadius, radialDistance);
  haloField *= (1.0 - outerDisc) * (0.12 + clamp01(liveHalo) * 0.88);

  var floorLevel = 0.035 + clamp01(liveSafetyFloor) * 0.210;
  var bodyLift = clamp01(liveLevel);
  var horizon = 1.0 - smoothstep(0.13, 0.38, abs(uy - 0.35));
  var paletteMix = clamp01(0.12 + uy * 0.31 + crescent * 0.51
                          + haloField * 0.14);
  var brightness = floorLevel + 0.035 + horizon * 0.035
                 + haloField * (0.09 + liveHalo * 0.24)
                 + crescent * (0.52 + bodyLift * 0.72)
                 + bladeRim * 0.34;
  var whiteLevel = 0.0;

  if (fixtureType == FIX_BAR_18) {
    // Hull Canvas: broad moonlit body with enough contrast for the crescent.
    brightness = floorLevel + 0.035 + horizon * 0.040
               + haloField * (0.10 + liveHalo * 0.26)
               + crescent * (0.58 + bodyLift * 0.72)
               + bladeRim * 0.38;
  } else if (fixtureType == FIX_RAW_LED) {
    // Silhouette: a firm skyline with a sharp, high-distance lunar crossing.
    var skyline = 1.0 - smoothstep(0.08, 0.24, abs(uy - 0.58));
    brightness = floorLevel + 0.085 + skyline * 0.075
               + haloField * (0.08 + liveHalo * 0.18)
               + crescent * (0.70 + bodyLift * 0.70)
               + bladeRim * 0.48;
    paletteMix = clamp01(0.10 + uy * 0.24 + crescent * 0.62);
  } else if (fixtureType == FIX_VINTAGE_6) {
    // Sparse fixed stars use an irrational index placement, independent of
    // the moon shape. Only these Jewelry stars emit native matched white.
    var starPhase = 0.5 + 0.5 * sin(index * GOLDEN_ANGLE
                                  + floor(index / 6.0) * PHI);
    var star = pow(starPhase, 13.0);
    brightness = floorLevel * 0.68 + 0.045
               + haloField * (0.08 + liveHalo * 0.12)
               + crescent * (0.34 + bodyLift * 0.40)
               + bladeRim * 0.15
               + star * 0.20;
    paletteMix = clamp01(0.68 + crescent * 0.25);
    whiteLevel = star * (0.055 + bodyLift * 0.15);
  } else if (fixtureType == FIX_PAR) {
    // Organs are weighty horizon anchors, lifted as the moon reaches them.
    var anchor = 1.0 - smoothstep(0.12, 0.42, abs(uy - 0.31));
    brightness = floorLevel + 0.095 + anchor * (0.10 + bodyLift * 0.18)
               + haloField * (0.08 + liveHalo * 0.17)
               + crescent * 0.38 + bladeRim * 0.16;
    paletteMix = clamp01(0.62 + anchor * 0.16 + crescent * 0.15);
  } else if (isSign) {
    // Paired crescent seals remain legible throughout the cycle. The moving
    // crescent is primary; a higher bed keeps the TE identity readable when
    // the moon sits below the miniature sign surface.
    var signSky = wave(ux * 0.61 + uy * 0.43 - moonClock * 0.73)
                * wave(uy * 0.57 - ux * 0.31
                      + moonClock * 1.41421356);
    brightness = floorLevel + 0.14 + haloField * (0.14 + liveHalo * 0.21)
               + crescent * (0.64 + bodyLift * 0.64)
               + bladeRim * 0.40 + signSky * 0.20;
    paletteMix = clamp01(0.18 + uy * 0.18 + crescent * 0.58
                       + signSky * 0.15);
  }

  // Level is an honest whole-composition prominence control. It scales every
  // ray above the protected safety floor, then adds a modest model-wide lunar
  // lift; at zero the ship remains safely visible rather than going black.
  brightness = floorLevel + (brightness - floorLevel)
             * (0.30 + liveLevel * 0.70) + liveLevel * 0.11;
  brightness = clamp01(brightness);
  whiteLevel = clamp01(whiteLevel);
  var outR = (pr1 + (pr2 - pr1) * paletteMix) * brightness;
  var outG = (pg1 + (pg2 - pg1) * paletteMix) * brightness;
  var outB = (pb1 + (pb2 - pb1) * paletteMix) * brightness;
  rgbwau(clamp01(outR), clamp01(outG), clamp01(outB),
         whiteLevel, whiteLevel, 0.0);
}
