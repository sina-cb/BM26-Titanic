// DRAFT — pending operator review
/*
  04_five_lanterns.js — FIVE LANTERNS

  CONCEPT
    The ship's five fixture instruments behave like five lantern materials in
    one room. Their clocks are independent, but their role energy is normalized
    by the sum, so a bright instrument can rise only while another yields.
    The transfer is deliberately high contrast: there is no shared whole-ship
    inhale, no gather/hold chapter, and no blackout.

  INSTRUMENT STAGING
    FIX_BAR_18     — broad Hull lamp with a softly faceted glass body.
    FIX_RAW_LED    — cool, crisp Silhouette outline with a moving edge sheen.
    FIX_VINTAGE_6  — warm Jewelry lanterns with restrained matched W=A light.
    FIX_PAR        — structural Organs lamp, broad and weighty rather than hot.
    FIX_TE_SIGN    — steady paired name lamps with shallow breathing and a
                     fixture-local two-dimensional reading texture.

  MOTION / MATH
    Five raised-cosine envelopes advance at irrationally related rates. The
    Separation control spreads fixed irrational phase offsets. Neighbor
    Crossfade hands each role part of the next role's envelope. Balance biases
    the warm and cool instrument families before all five values are divided
    by their scalar sum. The resulting role pulses always average one.

  CONTROLS (declaration order = physical MIDI order)
    localSpeed   — rate of all five lantern breaths.
    separation   — phase distance between the five independent breaths.
    breathDepth  — contrast between each lantern's inhale and exhale.
    balance      — energy balance between warm and cool instrument families.
    crossfade    — amount each lantern inherits from its neighboring lantern.
    level        — authored energy above the whole-ship safety floor.
    safetyFloor  — minimum visible light on every fixture role.

  AUDIO_MODULATION_V1:
    sliderSeparation <- micFlux range 0.25..0.65 curve ease   # flux opens the five breaths apart
    sliderLevel      <- micLow  range 0.38..0.70 curve linear # low energy lifts the complete lantern room
  Static (unmapped) params: localSpeed, breathDepth, balance, crossfade,
    safetyFloor, colorPalette1/2.

  COLOR / OUTPUT
    RGB is always on the selected cp1-to-cp2 palette line. Only Jewelry emits
    native white, and its W/A lanes are byte-identical. UV is always zero.
    Silence is a complete, gently polyphonic ambient look.
*/

export var localSpeed = 0.30;
export var separation = 0.43;
export var breathDepth = 0.50;
export var balance = 0.50;
export var crossfade = 0.28;
export var level = 0.62;
export var safetyFloor = 0.28;

export var cp1H = 0.535, cp1S = 0.78, cp1V = 0.88;
export var cp2H = 0.105, cp2S = 0.82, cp2V = 1.00;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderSeparation(v) { separation = v; }
export function sliderBreathDepth(v) { breathDepth = v; }
export function sliderBalance(v) { balance = v; }
export function sliderCrossfade(v) { crossfade = v; }
export function sliderLevel(v) { level = v; }
export function sliderSafetyFloor(v) { safetyFloor = v; }

var SQRT2 = 1.41421356;
var SQRT3 = 1.73205081;
var PHI = 1.61803399;
var SQRT5 = 2.23606798;
var GOLDEN_ANGLE = 2.39996323;
var PHASE_WRAP = 62831.85307;

var phase1 = 0.0;
var phase2 = 0.0;
var phase3 = 0.0;
var phase4 = 0.0;
var phase5 = 0.0;

var liveSeparation = 0.43;
var liveBreathDepth = 0.50;
var liveBalance = 0.50;
var liveCrossfade = 0.28;
var liveLevel = 0.62;
var liveFloor = 0.28;

var lantern1 = 1.0;
var lantern2 = 1.0;
var lantern3 = 1.0;
var lantern4 = 1.0;
var lantern5 = 1.0;

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

  var follow = min(1.0, dt * 5.0);
  liveSeparation += (separation - liveSeparation) * follow;
  liveBreathDepth += (breathDepth - liveBreathDepth) * follow;
  liveBalance += (balance - liveBalance) * follow;
  liveCrossfade += (crossfade - liveCrossfade) * follow;
  liveLevel += (level - liveLevel) * follow;
  liveFloor += (safetyFloor - liveFloor) * follow;

  var speedMultiplier = 0.25 + clamp01(localSpeed)
    * (32.824 - 16.412 * clamp01(localSpeed));
  // At the saved speed, even the slowest role makes a clearly visible handoff
  // within a 40-second capture while the irrational ratios never re-lock.
  var baseRate = 0.320 * speedMultiplier;
  phase1 += dt * baseRate;
  phase2 += dt * baseRate * SQRT2;
  phase3 += dt * baseRate * SQRT3;
  phase4 += dt * baseRate * PHI;
  phase5 += dt * baseRate * SQRT5;
  if (phase1 >= PHASE_WRAP) phase1 -= PHASE_WRAP;
  if (phase2 >= PHASE_WRAP) phase2 -= PHASE_WRAP;
  if (phase3 >= PHASE_WRAP) phase3 -= PHASE_WRAP;
  if (phase4 >= PHASE_WRAP) phase4 -= PHASE_WRAP;
  if (phase5 >= PHASE_WRAP) phase5 -= PHASE_WRAP;

  _hsv2rgb1();
  _hsv2rgb2();

  var spread = 0.70 + clamp01(liveSeparation) * 1.35;
  // A fourth-power lantern envelope creates long, clearly separated yields
  // and unmistakable arrivals. The irrational phase clocks still prevent a
  // repeating five-step chase, but the eye can now name the role receiving
  // the conserved pool instead of seeing five near-sine breaths at once.
  var env1 = pow(0.5 + 0.5 * cos(phase1 + spread * 0.0), 4.0);
  var env2 = pow(0.5 + 0.5 * cos(phase2 + spread * 1.0), 4.0);
  var env3 = pow(0.5 + 0.5 * cos(phase3 + spread * 2.0), 4.0);
  var env4 = pow(0.5 + 0.5 * cos(phase4 + spread * 3.0), 4.0);
  var env5 = pow(0.5 + 0.5 * cos(phase5 + spread * 4.0), 4.0);

  // Crossfade is a cyclic role handoff. Because it only permutes and blends
  // the same five scalars, their sum is preserved before normalization.
  var cross = clamp01(liveCrossfade) * 0.72;
  var cross1 = env1 + (env2 - env1) * cross;
  var cross2 = env2 + (env3 - env2) * cross;
  var cross3 = env3 + (env4 - env3) * cross;
  var cross4 = env4 + (env5 - env4) * cross;
  var cross5 = env5 + (env1 - env5) * cross;

  // Balance transfers energy between warm structural lamps (positive bias)
  // and cool direct-view lamps (negative bias), then normalization restores a
  // constant five-role pool. Every value stays positive at both endpoints.
  var bias = (clamp01(liveBalance) - 0.5) * 1.80;
  cross1 *= 1.0 + bias * 0.36;
  cross2 *= 1.0 - bias * 0.54;
  cross3 *= 1.0 + bias * 0.72;
  cross4 *= 1.0 + bias * 0.48;
  cross5 *= 1.0 - bias * 0.42;

  // Add a small role floor, then normalize by the actual Titanic instrument
  // populations (360/320/96/40/148). Equal role sums were not equal whole-rig
  // sums: attention moving into a 40-pixel Organ otherwise looked like a
  // global exhale. This weighted pool keeps the aggregate per-pixel role
  // energy constant while letting small instruments become truly prominent.
  cross1 = 0.20 + cross1 * 0.80;
  cross2 = 0.20 + cross2 * 0.80;
  cross3 = 0.20 + cross3 * 0.80;
  cross4 = 0.20 + cross4 * 0.80;
  cross5 = 0.20 + cross5 * 0.80;
  var weightedSum = cross1 * 360.0 + cross2 * 320.0
                  + cross3 * 96.0 + cross4 * 40.0 + cross5 * 148.0;
  var depth = 0.055 + clamp01(liveBreathDepth) * 0.145;
  lantern1 = 0.012 + depth * cross1 * 964.0 / weightedSum;
  lantern2 = 0.012 + depth * cross2 * 964.0 / weightedSum;
  lantern3 = 0.012 + depth * cross3 * 964.0 / weightedSum;
  lantern4 = 0.012 + depth * cross4 * 964.0 / weightedSum;
  lantern5 = 0.012 + depth * cross5 * 964.0 / weightedSum;
}

export function render3D(index, x, y, z) {
  var rolePulse = lantern1;
  var colorMix = 0.50;
  var material = 0.50;
  var nativeWhite = 0.0;
  var materialBias = (clamp01(liveBalance) - 0.5) * 0.30;

  if (fixtureType == FIX_BAR_18) {
    rolePulse = lantern1;
    // Large beveled panes carry three fixture-local wick ribbons. The broad
    // role handoff remains the main grammar, while each 18-pixel bar now has
    // enough counter-moving internal life to read as glass rather than a flat
    // block. pixelLocalIndex makes the detail repeat intentionally per bar.
    var hullFacet = 0.5 + 0.5 * cos((x * 1.7 + y * 0.8 - z * 1.2) * PI2
                                  + phase1 * 0.35);
    hullFacet = smooth01(hullFacet);
    var barU = ((pixelLocalIndex % 18.0) + 0.5) / 18.0;
    var wickA = pow(0.5 + 0.5 * cos((barU * 2.0 - phase1 * 0.82) * PI2), 5.0);
    var wickB = pow(0.5 + 0.5 * cos((barU * 3.0 + phase2 * 0.47) * PI2), 7.0);
    var glassRib = smooth01(0.58 * wickA + 0.42 * wickB);
    material = 0.48 + hullFacet * 0.24 + glassRib * 0.38 + materialBias;
    colorMix = 0.22 + hullFacet * 0.12 + glassRib * 0.24;
  } else if (fixtureType == FIX_RAW_LED) {
    rolePulse = lantern2;
    // A cool edge sheen travels along the direct-view outline without
    // imposing a directional control on the breathing concept.
    var edgeSheen = 0.5 + 0.5 * cos((x * 1.5 + z * SQRT2) * PI2
                                  - phase2 * 0.42);
    material = 0.62 + smooth01(edgeSheen) * 0.38 - materialBias;
    colorMix = 0.01 + edgeSheen * 0.05;
  } else if (fixtureType == FIX_VINTAGE_6) {
    rolePulse = lantern3;
    var warmGlass = 0.5 + 0.5 * cos(pixelLocalIndex * GOLDEN_ANGLE
                                   + phase3 * 0.26);
    material = 0.55 + smooth01(warmGlass) * 0.45 + materialBias;
    colorMix = 0.86 + warmGlass * 0.12;
    nativeWhite = (0.025 + smooth01(warmGlass) * 0.12)
                * (0.50 + 0.50 * clamp01(rolePulse));
  } else if (fixtureType == FIX_PAR) {
    rolePulse = lantern4;
    var organBody = 0.5 + 0.5 * cos((z * 1.4 + y * 0.65) * PI2
                                  + phase4 * 0.22);
    material = 0.66 + smooth01(organBody) * 0.34 + materialBias;
    colorMix = 0.72 + organBody * 0.16;
  } else if (fixtureType == FIX_TE_SIGN) {
    // Both signs share this local-index map. Their safety bed preserves the
    // name, while most of the fifth role pulse stays visible in the handoff.
    rolePulse = lantern5;
    var signIndex = index % 74.0;
    var signX = (signIndex % 10.0) / 9.0;
    var signY = floor(signIndex / 10.0) / 7.0;
    var signStripe = 0.5 + 0.5 * cos((signX * 1.45 - signY * 0.35) * PI2
                                   + phase5 * 0.18);
    var signWindow = smooth01(signStripe);
    material = 0.54 + signWindow * 0.46 - materialBias;
    colorMix = 0.14 + signX * 0.08 + signWindow * 0.08;
  }

  rolePulse = clamp01(rolePulse);
  var floorLevel = 0.025 + clamp01(liveFloor) * 0.105;
  var authoredLevel = 0.18 + clamp01(liveLevel) * 0.82;
  // The constant pedestal is identical on all 964 pixels; the weighted role
  // term above also has a constant whole-rig sum. Together they stay bright
  // enough for an ambient bed without clipping away conserved energy.
  var attention = 0.025 + rolePulse * 4.25;
  var brightness = floorLevel
                 + (1.0 - floorLevel) * authoredLevel
                 * attention * clamp01(material);
  brightness = clamp01(brightness);
  colorMix = clamp01(colorMix);
  nativeWhite = clamp01(nativeWhite * (0.45 + clamp01(liveLevel) * 0.55));

  var red = (pr1 + (pr2 - pr1) * colorMix) * brightness;
  var green = (pg1 + (pg2 - pg1) * colorMix) * brightness;
  var blue = (pb1 + (pb2 - pb1) * colorMix) * brightness;
  rgbwau(clamp01(red), clamp01(green), clamp01(blue),
         nativeWhite, nativeWhite, 0.0);
}
