// DRAFT — pending operator review
/*
  09_shadow_slats.js — SHADOW SLATS

  CONCEPT
    Giant diagonal louvers pivot across a luminous ship. Three to seven broad,
    finite slabs carve crisp negative space while their grazing edges remain
    visible as a quiet architectural drawing.

  INSTRUMENT STAGING
    FIX_BAR_18     — luminous Hull field interrupted by the full dark louvers.
    FIX_RAW_LED    — uninterrupted Silhouette rim with moving edge embossing.
    FIX_VINTAGE_6  — sparse palette-RGB grazing catches; no native white.
    FIX_PAR        — restrained light leaking between adjacent louvers.
    FIX_TE_SIGN    — paired, fixture-local slat cross-sections with a firm
                     identity floor. Both signs receive the exact same map.

  MOTION / MATH
    One delta-accumulated signed angle rotates a plane normal through X/Z. A
    second fixed Y component tilts that plane into diagonal louvers. The field
    is analytic and finite across the normalized model bounds; it is not a
    wave lattice, noise field, or scrolling grid. Phase wraps only after a
    whole number of turns, so the wrap is continuous.

  CONTROLS (declaration order = physical MIDI order)
    localSpeed  — louver pivot rate; zero still creeps and one is decisive.
    direction   — genuine signed pivot direction; center cannot freeze.
    slatCount   — smoothly spans three to seven parallel slabs.
    open        — widens the luminous openings between the dark slabs.
    tilt        — pitches the slats from shallow to steep diagonals.
    rimGlow     — strength of the Silhouette and grazing-edge drawing.
    safetyFloor — whole-rig palette visibility beneath the carving.

  AUDIO_MODULATION_V1:
    sliderOpen    <- micFlux range 0.28..0.65 curve ease # flux opens the louvers
    sliderRimGlow <- micHigh range 0.06..0.32 curve pow2 # highs trace grazing edges
  Static (unmapped) params: localSpeed, direction, slatCount, tilt,
    safetyFloor, colorPalette1/2.

  COLOR / OUTPUT
    Every RGB value is drawn only from the cp1-to-cp2 RGB line. No native
    white or UV is emitted, therefore W=A=U=0 exactly. Silence is a complete,
    continuously visible ambient composition.
*/

// Global palette pickers precede local controls.
export var cp1H = 0.60, cp1S = 0.78, cp1V = 0.72;
export var cp2H = 0.095, cp2S = 0.84, cp2V = 1.00;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export var localSpeed = 0.30;
export var direction = 0.74;
export var slatCount = 0.48;
export var open = 0.47;
export var tilt = 0.58;
export var rimGlow = 0.24;
export var safetyFloor = 0.28;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderDirection(v) {
  direction = v;
  var dv = v * 2.0 - 1.0;
  if (dv >= 0.0 && dv < 0.06) dv = 0.06;
  else if (dv < 0.0 && dv > -0.06) dv = -0.06;
  pivotDirection = dv;
}
export function sliderSlatCount(v) { slatCount = v; }
export function sliderOpen(v) { open = v; }
export function sliderTilt(v) { tilt = v; }
export function sliderRimGlow(v) { rimGlow = v; }
export function sliderSafetyFloor(v) { safetyFloor = v; }

var PHASE_WRAP = 10000.0;
var GOLDEN_ANGLE = 2.39996323;

var pivotClock = 0.071;
var pivotDirection = 0.48;
var normalX = 1.0;
var normalZ = 0.0;

var liveSlatCount = 4.92;
var liveOpen = 0.47;
var liveTilt = 0.58;
var liveRimGlow = 0.24;
var liveFloor = 0.105;

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

  // Slew every live-editable shape/light control so an operator move bends
  // the louvers instead of teleporting the field.
  var shapeFollow = min(1.0, dt * 4.2);
  var lightFollow = min(1.0, dt * 9.0);
  var targetCount = 3.0 + clamp01(slatCount) * 4.0;
  var targetFloor = 0.055 + clamp01(safetyFloor) * 0.180;
  liveSlatCount += (targetCount - liveSlatCount) * shapeFollow;
  liveOpen += (clamp01(open) - liveOpen) * shapeFollow;
  liveTilt += (clamp01(tilt) - liveTilt) * shapeFollow;
  liveRimGlow += (clamp01(rimGlow) - liveRimGlow) * lightFollow;
  liveFloor += (targetFloor - liveFloor) * lightFollow;

  var localMult = 0.25 + clamp01(localSpeed)
    * (32.824 - 16.412 * clamp01(localSpeed));
  var pivotRate = 0.010 + localMult * 0.052;
  pivotClock += dt * pivotRate * pivotDirection;
  if (pivotClock >= PHASE_WRAP) pivotClock -= PHASE_WRAP;
  if (pivotClock < 0.0) pivotClock += PHASE_WRAP;

  var pivotAngle = pivotClock * PI2;
  normalX = cos(pivotAngle);
  normalZ = sin(pivotAngle);

  _hsv2rgb1();
  _hsv2rgb2();
}

export function render3D(index, x, y, z) {
  var ux = clamp01(x);
  var uy = clamp01(y);
  var uz = clamp01(z);
  var isSign = fixtureType == FIX_TE_SIGN;

  if (isSign) {
    // The physical sign is split across two fixtures. Fold the global index
    // across the full 74-pixel object before authoring its 10x8 cross-section.
    var signIndex = index % 74.0;
    ux = (signIndex % 10.0) / 9.0;
    uy = floor(signIndex / 10.0) / 7.0;
    uz = 0.44 + ux * 0.12;
  }

  var qx = ux - 0.50;
  var qy = uy - 0.50;
  var qz = uz - 0.50;

  // The rotating X/Z normal supplies pivot. Tilt supplies a separately
  // controllable Y component, making the louvers visibly shallow or steep.
  var pitch = (liveTilt * 2.0 - 1.0) * 1.18;
  var projected = qx * normalX + qz * normalZ + qy * pitch;
  var perpendicular = -qx * normalZ + qz * normalX;
  var projectionScale = 0.56 / (1.0 + abs(pitch) * 0.34);
  var slatAxis = 0.50 + projected * projectionScale;
  var slatCoordinate = slatAxis * liveSlatCount;
  var slatCell = slatCoordinate - floor(slatCoordinate);
  var centerDistance = abs(slatCell - 0.50);

  // Dark slab center, luminous opening, and a crisp grazing edge. Increasing
  // Open narrows the slab so the literal light aperture grows monotonically.
  var slabHalf = 0.39 - liveOpen * 0.27;
  var edgeSoftness = 0.020 + 0.006 / liveSlatCount;
  var opening = smoothstep(slabHalf, slabHalf + edgeSoftness, centerDistance);
  var edgeDistance = abs(centerDistance - slabHalf);
  var grazingEdge = 1.0 - smoothstep(edgeSoftness * 0.45,
                                     edgeSoftness * 2.8, edgeDistance);

  // A fixed hinge rail and one pin per slab turn the repeated mask into a
  // legible bank of mechanically linked louvers. Long Shadow owns a single
  // free slab; this pattern always exposes the shared pivot architecture.
  var hingeRail = 1.0 - smoothstep(0.026, 0.072,
                                   abs(perpendicular + qy * 0.10));
  var pinAcross = 1.0 - smoothstep(0.050, 0.13, centerDistance);
  var pivotPin = hingeRail * pinAcross;

  // A broad, non-periodic illumination bias prevents the open regions from
  // becoming a flat binary mask while remaining subordinate to the louvers.
  var broadField = 0.50 + 0.22 * sin((qx * 1.41421356
                                    + qz * 1.73205081) * PI2
                                    + pivotClock * 0.37)
                           + 0.18 * cos((qy * 1.61803399
                                      - qx * 0.73) * PI2);
  broadField = clamp01(broadField);

  // Palette follows material state, not cell index: dark cool louvers against
  // warm apertures. This removes the generic multicolour stripe reading.
  var paletteMix = clamp01(0.08 + opening * 0.72
                         + grazingEdge * 0.15 + pivotPin * 0.10
                         + (broadField - 0.50) * 0.08);
  var litField = clamp01(0.40 + broadField * 0.42
                       + grazingEdge * liveRimGlow * 0.26);
  var brightness = liveFloor + (1.0 - liveFloor) * opening * litField;

  if (fixtureType == FIX_BAR_18) {
    // Full-depth louver carving on the Hull Canvas.
    brightness = liveFloor + (1.0 - liveFloor)
               * clamp01(opening * (0.43 + broadField * 0.43)
                        + grazingEdge * (0.10 + liveRimGlow * 0.38)
                        + pivotPin * (0.12 + liveRimGlow * 0.24));
  } else if (fixtureType == FIX_RAW_LED) {
    // Silhouette never inherits the dark slab: the ship outline stays whole.
    // RimGlow lifts the entire continuous outline as well as its embossed
    // edges, so the control is visibly useful even between edge crossings.
    brightness = clamp01(liveFloor + 0.13
                       + liveRimGlow * 0.40
                       + broadField * 0.08
                       + grazingEdge * (0.12 + liveRimGlow * 0.38)
                       + hingeRail * (0.08 + liveRimGlow * 0.18));
    paletteMix = clamp01(paletteMix - 0.10 + grazingEdge * 0.16);
  } else if (fixtureType == FIX_VINTAGE_6) {
    // Sparse palette-only grazing catches follow each fixture's local heads.
    // The golden-angle term breaks regular rail rows without making sparkle.
    var grazePhase = 0.5 + 0.5 * cos(pixelLocalIndex * GOLDEN_ANGLE
                                   + slatCoordinate * 1.61803399);
    var graze = max(grazingEdge, pivotPin) * pow(grazePhase, 5.0);
    brightness = clamp01(liveFloor * 0.82 + 0.06
                       + opening * 0.09
                       + graze * (0.30 + liveRimGlow * 0.58));
    paletteMix = clamp01(0.62 + graze * 0.30 - opening * 0.12);
  } else if (fixtureType == FIX_PAR) {
    // Organs show light leaking through the openings, never a harsh flash.
    var leak = smooth01(opening) * (0.46 + broadField * 0.32);
    brightness = clamp01(liveFloor + 0.12 + leak * 0.55
                       + grazingEdge * liveRimGlow * 0.18);
    paletteMix = clamp01(0.30 + leak * 0.42);
  } else if (isSign) {
    // Identity carries a quieter cross-section with a strong letterform floor.
    // Opening and edge remain active, but neither can erase the mark.
    brightness = clamp01(max(0.32, liveFloor + 0.20
                       + opening * (0.15 + broadField * 0.16)
                       + grazingEdge * (0.12 + liveRimGlow * 0.25)
                       + pivotPin * 0.18));
    paletteMix = clamp01(0.18 + opening * 0.54
                       + grazingEdge * 0.12 + (uy - 0.50) * 0.08);
  }

  brightness = clamp01(brightness);
  paletteMix = clamp01(paletteMix);
  var outR = (pr1 + (pr2 - pr1) * paletteMix) * brightness;
  var outG = (pg1 + (pg2 - pg1) * paletteMix) * brightness;
  var outB = (pb1 + (pb2 - pb1) * paletteMix) * brightness;
  rgbwau(clamp01(outR), clamp01(outG), clamp01(outB), 0.0, 0.0, 0.0);
}
