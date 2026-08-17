// DRAFT — pending operator review
/*
  18_soft_steps.js — SOFT STEPS

  CONCEPT
    Five broad luminous terraces climb diagonally through the vessel. Each
    terrace is a stable material plateau with a gently traveling boundary,
    like moonlit stairs cut into the ship rather than ribs or a wave field.

  INSTRUMENT STAGING
    FIX_BAR_18     — broad ordered Hull terraces with luminous risers.
    FIX_RAW_LED    — the stepped outer edge remains legible at distance.
    FIX_VINTAGE_6  — sparse palette-RGB notch lights; no native white.
    FIX_PAR        — calm landings that mark the terrace centers.
    FIX_TE_SIGN    — identical paired stair emblems on both TE signs.

  MOTION / MATH
    A tilted XYZ height is smoothly quantized into three through seven broad
    plateaus. Two incommensurate boundary offsets drift through the height
    field, so the steps breathe without scrolling or visibly re-locking.

  CONTROLS (declaration order = physical MIDI order)
    localSpeed  — cadence of the slow boundary drift.
    stepCount   — three to seven broad terraces across the vessel.
    stepHeight  — luminance separation between low and high terraces.
    drift       — travel distance of the eased terrace boundaries.
    edgeGlow    — brightness and definition of each luminous riser.
    level       — expressive energy above the visibility floor.
    safetyFloor — minimum whole-rig palette light between risers.

  AUDIO_MODULATION_V1:
    sliderStepHeight <- micMid  range 0.22..0.55 curve linear # mids deepen the terrace relief
    sliderEdgeGlow   <- micHigh range 0.04..0.28 curve ease   # highs illuminate the risers
  Static (unmapped) params: localSpeed, stepCount, drift, level, safetyFloor,
    colorPalette1/2.

  COLOR / OUTPUT
    RGB stays strictly on the cp1-to-cp2 line. This pattern emits no native
    white or UV, so W=A=U=0 exactly. Silence remains a complete ambient look.
*/

export var cp1H = 0.58, cp1S = 0.76, cp1V = 0.88;
export var cp2H = 0.10, cp2S = 0.72, cp2V = 1.00;
export function colorPalette1(hv, sv, vv) { cp1H = hv; cp1S = sv; cp1V = vv; }
export function colorPalette2(hv, sv, vv) { cp2H = hv; cp2S = sv; cp2V = vv; }

export var localSpeed = 0.30;
export var stepCount = 0.50;
export var stepHeight = 0.42;
export var drift = 0.34;
export var edgeGlow = 0.38;
export var level = 0.62;
export var safetyFloor = 0.27;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderStepCount(v) { stepCount = v; }
export function sliderStepHeight(v) { stepHeight = v; }
export function sliderDrift(v) { drift = v; }
export function sliderEdgeGlow(v) { edgeGlow = v; }
export function sliderLevel(v) { level = v; }
export function sliderSafetyFloor(v) { safetyFloor = v; }

var SQRT2 = 1.41421356;
var SQRT3 = 1.73205081;
var PHI = 1.61803399;
var GOLDEN_ANGLE = 2.39996323;
var PHASE_WRAP = 10000.0;

var stairClock = 0.173;
var driftOne = 0.0;
var driftTwo = 0.0;

var liveStepCount = 0.50;
var liveStepHeight = 0.42;
var liveDrift = 0.34;
var liveEdgeGlow = 0.38;
var liveLevel = 0.62;
var liveSafetyFloor = 0.27;

var pr1 = 1.0, pg1 = 0.0, pb1 = 0.0;
var pr2 = 0.0, pg2 = 0.0, pb2 = 1.0;

function clamp01(value) {
  if (value < 0.0) return 0.0;
  if (value > 1.0) return 1.0;
  return value;
}

function smooth01(value) {
  var bounded = clamp01(value);
  return bounded * bounded * (3.0 - 2.0 * bounded);
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
  else if (iv == 4.0) { pr1 = tv;   pg1 = pv;   pb1 = qv;   }
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

  // Every live-editable handle slews into the field rather than teleporting
  // its boundaries or brightness.
  var shapeFollow = min(1.0, dt * 5.0);
  var lightFollow = min(1.0, dt * 12.0);
  liveStepCount += (stepCount - liveStepCount) * shapeFollow;
  liveStepHeight += (stepHeight - liveStepHeight) * lightFollow;
  liveDrift += (drift - liveDrift) * shapeFollow;
  liveEdgeGlow += (edgeGlow - liveEdgeGlow) * lightFollow;
  liveLevel += (level - liveLevel) * lightFollow;
  liveSafetyFloor += (safetyFloor - liveSafetyFloor) * lightFollow;

  var localMultiplier = 0.25 + clamp01(localSpeed)
    * (32.824 - 16.412 * clamp01(localSpeed));
  stairClock += dt * (0.006 + localMultiplier * 0.034);
  if (stairClock >= PHASE_WRAP) stairClock -= PHASE_WRAP;

  // Separate irrational-rate components keep the field from visibly locking.
  driftOne = sin(stairClock * PI2);
  driftTwo = sin(stairClock * PI2 / SQRT2 + 1.7);

  _hsv2rgb1();
  _hsv2rgb2();
}

export function render3D(index, x, y, z) {
  var ux = clamp01(x);
  var uy = clamp01(y);
  var uz = clamp01(z);
  var isSign = fixtureType == FIX_TE_SIGN;

  if (isSign) {
    // Fold the two physical fixtures into one complete 74-pixel stair map.
    var signIndex = index % 74.0;
    ux = (signIndex % 10.0) / 9.0;
    uy = 1.0 - floor(signIndex / 10.0) / 7.0;
    uz = 0.50;
  }

  // A monotonic tilted height guarantees ordered, broad material plateaus.
  // Drift only bends their boundaries; it never scrambles terrace order.
  // Titanic's actual normalized XYZ cloud occupies roughly 0.19..0.80 under
  // this projection. Mapping that full physical span prevents most fixtures
  // from clipping into the same warm top landing.
  var diagonalHeight = (ux * 0.20 + uy * 0.35 + uz * 0.45 - 0.18) / 0.62;
  var driftAmount = 0.020 + clamp01(liveDrift) * 0.120;
  var boundaryBend = sin((ux * SQRT2 - uz * SQRT3 + uy * 0.37) * PI2
                        + stairClock * 0.41) * driftOne;
  boundaryBend += sin((uz * PHI + uy * 0.53) * PI2
                     - stairClock * 0.29) * driftTwo * 0.55;
  // One bounded procession advances every ordered landing along the same
  // diagonal without changing count or scrambling the staircase hierarchy.
  var procession = sin(stairClock * PI2 * 0.73) * driftAmount * 0.82;
  diagonalHeight = clamp01(diagonalHeight
                          + boundaryBend * driftAmount + procession);

  // Continuous density gives exactly three through seven terraces without a
  // hard count snap during a live edit. Every plateau spans at least 1/7 of
  // the normalized height field, comfortably above the 5% acceptance floor.
  var terraceDensity = 3.0 + clamp01(liveStepCount) * 4.0;
  var terraceCoordinate = diagonalHeight * terraceDensity;
  var terraceIndex = floor(terraceCoordinate);
  var terracePhase = terraceCoordinate - terraceIndex;
  // Ease the level change just after each boundary. The remainder of every
  // cell is a truly flat material landing, while a moving boundary cannot
  // pop a pixel abruptly from one level to the next.
  var stepBlend = smoothstep(0.0, 0.13, terracePhase);
  var terraceLevel = clamp01((terraceIndex + stepBlend) / terraceDensity);

  var edgeDistance = min(terracePhase, 1.0 - terracePhase);
  var edgeWidth = 0.022 + clamp01(liveEdgeGlow) * 0.072;
  var riser = 1.0 - smoothstep(edgeWidth, edgeWidth + 0.045, edgeDistance);
  var landing = 1.0 - smoothstep(0.25, 0.47,
                                 abs(terracePhase - 0.50));

  var relief = 0.34 + clamp01(liveStepHeight) * 0.76;
  var floorLevel = 0.055 + clamp01(liveSafetyFloor) * 0.235;
  var energy = 0.35 + clamp01(liveLevel) * 0.65;
  var plateauLight = 0.11 + terraceLevel * relief;
  var edgeLight = riser * (0.10 + clamp01(liveEdgeGlow) * 1.32);
  var brightness = floorLevel + (1.0 - floorLevel)
                 * clamp01((plateauLight + edgeLight) * energy);
  var paletteMix = clamp01(0.03 + terraceLevel * 0.93
                          + riser * 0.04);

  if (fixtureType == FIX_RAW_LED) {
    // The Silhouette is the continuous stepped edge at playa distance.
    brightness = floorLevel + (1.0 - floorLevel)
               * clamp01((0.20 + terraceLevel * relief * 0.72
                          + riser * (0.10 + liveEdgeGlow * 1.25)) * energy);
    paletteMix = clamp01(0.03 + terraceLevel * 0.91 + riser * 0.06);
  } else if (fixtureType == FIX_VINTAGE_6) {
    // Sparse notch lights remain palette-derived RGB; no native white is
    // emitted. The golden-angle spacing prevents fixture-local lockstep.
    var notchPhase = 0.5 + 0.5 * cos(pixelLocalIndex * GOLDEN_ANGLE
                                   + terraceIndex * PHI
                                   + stairClock * 0.37);
    var notch = pow(notchPhase, 10.0);
    brightness = clamp01(floorLevel * 0.76 + 0.07
                       + landing * 0.12 + notch * (0.28 + edgeLight * 0.44));
    brightness *= 0.54 + liveLevel * 0.46;
    paletteMix = clamp01(0.22 + terraceLevel * 0.65 + notch * 0.10);
  } else if (fixtureType == FIX_PAR) {
    // Organs become calm landings rather than global punches.
    brightness = clamp01(floorLevel + (0.16 + landing * 0.48
                       + terraceLevel * relief * 0.28) * energy);
    paletteMix = clamp01(0.05 + terraceLevel * 0.90);
  } else if (isSign) {
    // A firm identity floor preserves both letterforms while the same
    // diagonal staircase remains visibly animated inside them.
    var emblemEdge = max(riser,
      1.0 - smoothstep(0.045, 0.13, abs(ux + uy - 1.0)));
    brightness = clamp01(max(0.32, floorLevel + (0.24
                       + terraceLevel * relief * 0.36
                       + emblemEdge * (0.10 + liveEdgeGlow * 0.82)) * energy));
    paletteMix = clamp01(0.04 + terraceLevel * 0.90 + emblemEdge * 0.05);
  } else if (fixtureType == FIX_BAR_18) {
    // Hull Canvas is the reference material surface; keep broad plateaus
    // dominant and let the luminous boundary remain a secondary accent.
    brightness = floorLevel + (1.0 - floorLevel)
               * clamp01((0.18 + terraceLevel * relief * 0.82
                          + edgeLight * 0.88) * energy);
  }

  brightness = clamp01(brightness);
  paletteMix = clamp01(paletteMix);
  var outR = (pr1 + (pr2 - pr1) * paletteMix) * brightness;
  var outG = (pg1 + (pg2 - pg1) * paletteMix) * brightness;
  var outB = (pb1 + (pb2 - pb1) * paletteMix) * brightness;
  rgbwau(clamp01(outR), clamp01(outG), clamp01(outB), 0.0, 0.0, 0.0);
}
