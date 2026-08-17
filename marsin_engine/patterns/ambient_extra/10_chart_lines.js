/*
  10_chart_lines.js — CHART LINES

  CONCEPT
    A slow nautical relief chart is projected through the ship. Three broad
    analytic hills generate nested, closed isolines that merge and separate
    like imaginary islands; this is not a scrolling wave or caustic field.

  INSTRUMENT STAGING
    FIX_BAR_18     — the complete contour map across the Hull Canvas.
    FIX_RAW_LED    — a brighter coastline trace that preserves the outline.
    FIX_VINTAGE_6  — sparse survey pins in palette RGB plus matched W=A.
    FIX_PAR        — stepped depth markers with quiet contour emphasis.
    FIX_TE_SIGN    — balanced fixture-local chart insets on both TE signs.

  MOTION / MATH
    Three radial inverse-quadratic hills drift on independent irrational-rate
    ellipses. Quantizing their summed scalar height yields genuinely nested
    closed/spanning isolines. Slow center drift changes the terrain topology
    continuously without a visible phase-wrap seam.

  CONTROLS (declaration order = physical MIDI order)
    localSpeed   — terrain-drift rate; zero still creeps, one moves decisively.
    lineCount    — number of visible elevation contours.
    lineWidth    — thickness of every chart line.
    relief       — steepness and contrast of the imaginary terrain.
    drift        — travel radius of the three relief centers.
    jewelryMark  — prominence of sparse Jewelry survey pins.
    safetyFloor  — whole-ship palette visibility below the chart drawing.

  AUDIO_MODULATION_V1:
    sliderRelief      <- micMid  range 0.25..0.58 curve linear # mids lift chart relief
    sliderJewelryMark <- micHigh range 0.05..0.32 curve ease # highs reveal survey pins
  Static (unmapped) params: localSpeed, lineCount, lineWidth, drift,
    safetyFloor, colorPalette1/2.

  COLOR / OUTPUT
    RGB stays strictly on the straight cp1-to-cp2 RGB line. Only Jewelry adds
    native survey white, always with byte-identical W=A. UV is always zero.
    A palette-derived safety floor makes silence a complete ambient look.
*/

// Global palette pickers precede the local controls.
export var cp1H = 0.56, cp1S = 0.82, cp1V = 0.76;
export var cp2H = 0.10, cp2S = 0.70, cp2V = 1.00;
export function colorPalette1(hv, sv, vv) { cp1H = hv; cp1S = sv; cp1V = vv; }
export function colorPalette2(hv, sv, vv) { cp2H = hv; cp2S = sv; cp2V = vv; }

export var localSpeed = 0.29;
export var contourBands = 0.48;
export var contourStroke = 0.36;
export var relief = 0.42;
export var drift = 0.38;
export var jewelryMark = 0.20;
export var safetyFloor = 0.28;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderLineCount(v) { contourBands = v; }
export function sliderLineWidth(v) { contourStroke = v; }
export function sliderRelief(v) { relief = v; }
export function sliderDrift(v) { drift = v; }
export function sliderJewelryMark(v) { jewelryMark = v; }
export function sliderSafetyFloor(v) { safetyFloor = v; }

var PHASE_WRAP = 10000.0;
var GOLDEN_ANGLE = 2.39996323;
var SQRT2 = 1.41421356;
var SQRT3 = 1.73205081;
var PHI = 1.61803399;

var chartClock = 0.117;
var hill1X = 0.28, hill1Z = 0.34;
var hill2X = 0.70, hill2Z = 0.37;
var hill3X = 0.52, hill3Z = 0.73;

var liveLineCount = 3.92;
var liveLineWidth = 0.36;
var liveRelief = 0.42;
var liveDrift = 0.38;
var liveJewelryMark = 0.20;
var liveFloor = 0.053;

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

  // Live geometry bends toward new settings rather than jumping on a knob edit.
  var shapeFollow = min(1.0, dt * 5.0);
  var lightFollow = min(1.0, dt * 10.0);
  var targetFloor = 0.025 + clamp01(safetyFloor) * 0.100;
  // Count and width are quantized chart drafting choices. Resolve them per
  // frame so the VM's control sweep and a live editor see the same target.
  // Their rendered edges still move continuously because the field itself
  // drifts underneath them.
  liveLineCount = 2.0 + clamp01(contourBands) * 4.0;
  liveLineWidth = clamp01(contourStroke);
  liveRelief += (clamp01(relief) - liveRelief) * shapeFollow;
  liveDrift += (clamp01(drift) - liveDrift) * shapeFollow;
  liveJewelryMark += (clamp01(jewelryMark) - liveJewelryMark) * lightFollow;
  liveFloor += (targetFloor - liveFloor) * lightFollow;

  var localMult = 0.25 + clamp01(localSpeed)
    * (32.824 - 16.412 * clamp01(localSpeed));
  chartClock += dt * (0.006 + localMult * 0.035);
  if (chartClock >= PHASE_WRAP) chartClock -= PHASE_WRAP;

  // Three independent elliptical orbits. Irrational phase rates prevent the
  // relief configuration from visibly re-locking.
  var excursion = 0.025 + liveDrift * 0.145;
  hill1X = 0.25 + excursion * sin(chartClock * PI2);
  hill1Z = 0.31 + excursion * 0.72 * cos(chartClock * PI2 * SQRT2 + 0.7);
  hill2X = 0.73 + excursion * 0.82 * cos(chartClock * PI2 * SQRT3 + 2.1);
  hill2Z = 0.40 + excursion * sin(chartClock * PI2 / PHI + 1.3);
  hill3X = 0.51 + excursion * 0.68 * sin(chartClock * PI2 * PHI + 4.0);
  hill3Z = 0.74 + excursion * 0.76 * cos(chartClock * PI2 / SQRT3 + 2.8);

  _hsv2rgb1();
  _hsv2rgb2();
}

function terrainHeight(px, pz) {
  var d1x = px - hill1X;
  var d1z = pz - hill1Z;
  var d2x = px - hill2X;
  var d2z = pz - hill2Z;
  var d3x = px - hill3X;
  var d3z = pz - hill3Z;
  // Three finite radial domes create large closed island families. Taking the
  // maximum suppresses the broad inverse-quadratic fill that formerly painted
  // the entire ship while still allowing contours to merge at close passes.
  var radius = 0.235 + liveRelief * 0.105;
  var radiusSquared = radius * radius;
  var hillOne = clamp01(1.0 - (d1x * d1x * 1.05
                              + d1z * d1z) / radiusSquared);
  var hillTwo = clamp01(1.0 - (d2x * d2x
                              + d2z * d2z * 1.18)
                              / (radiusSquared * 1.1664));
  var hillThree = clamp01(1.0 - (d3x * d3x * 1.20
                                + d3z * d3z)
                                / (radiusSquared * 0.8836));
  return max(hillOne, max(hillTwo, hillThree));
}

export function render3D(index, x, y, z) {
  var mapX = clamp01(x);
  var mapZ = clamp01(z);
  var isSign = fixtureType == FIX_TE_SIGN;

  if (isSign) {
    // pixelLocalIndex repeats for both 74-pixel fixtures, making the chart
    // insets perfectly balanced while preserving a readable local letter map.
    var signIndex = index % 74.0;
    mapX = (signIndex % 10.0) / 9.0;
    mapZ = floor(signIndex / 10.0) / 7.0;
  }

  // Project the relief together with its port/starboard reflection. Max/min
  // blending preserves closed families while giving both physical halves the
  // same high-area budget; no side can dominate merely because more fixtures
  // sampled one of the three moving hill centers.
  var primaryHeight = terrainHeight(mapX, mapZ);
  var reflectedHeight = terrainHeight(1.0 - mapX, mapZ);
  var height = max(primaryHeight, reflectedHeight) * 0.88
             + min(primaryHeight, reflectedHeight) * 0.12;
  // The phase offset keeps zero elevation between strokes without deleting
  // the low, broad outer contours that carry the map on sparse geometry.
  var contourCoordinate = 0.18 + height * liveLineCount;
  var contourIndex = floor(contourCoordinate);
  var contourCell = contourCoordinate - floor(contourCoordinate);
  var contourDistance = min(contourCell, 1.0 - contourCell);
  var width = 0.030 + liveLineWidth * 0.082;
  var minorInk = 1.0 - smoothstep(width, width + 0.034,
                                  contourDistance);
  var majorInk = 1.0 - smoothstep(width * 1.75,
                                  width * 1.75 + 0.038,
                                  contourDistance);
  var majorGate = 0.0;
  if ((contourIndex % 2.0) == 0.0) majorGate = 1.0;
  var contourInk = minorInk + (majorInk - minorInk) * majorGate;
  var coastGate = smooth01(height / 0.085);
  contourInk = contourInk * coastGate;

  var depth = smooth01(height);
  var paletteMix = clamp01(0.08 + depth * 0.34
                         + contourInk * (0.24 + majorGate * 0.24));
  var brightness = liveFloor + depth * 0.012
                 + contourInk * (0.68 + majorGate * 0.30);
  var nativeWhite = 0.0;

  if (fixtureType == FIX_BAR_18) {
    // The bars carry the cartographic drawing with crisp nested elevation.
    brightness = liveFloor + depth * (0.006 + liveRelief * 0.016)
               + contourInk * (0.70 + liveRelief * 0.12
                              + majorGate * 0.30);
  } else if (fixtureType == FIX_RAW_LED) {
    // A continuous far-field coastline: outline floor plus the same isolines.
    brightness = liveFloor + 0.065 + depth * 0.012
               + contourInk * (0.72 + majorGate * 0.26);
    paletteMix = clamp01(0.14 + depth * 0.38
                       + contourInk * (0.20 + majorGate * 0.14));
  } else if (fixtureType == FIX_VINTAGE_6) {
    // Two of each six local heads become survey stations. They illuminate
    // most strongly where an isoline crosses the fixture's world position.
    var surveySlot = pixelLocalIndex % 3.0;
    var surveyGate = surveySlot < 0.5 ? 1.0 : 0.0;
    // Survey stations are spatially fixed drafting marks. The chart moves
    // beneath them, but the pins themselves do not sparkle or wander.
    var surveyWeight = 0.76 + 0.24
                     * cos(pixelLocalIndex * GOLDEN_ANGLE);
    var survey = surveyGate * surveyWeight
               * (0.38 + contourInk * 0.62) * liveJewelryMark;
    brightness = liveFloor * 0.72 + 0.030 + depth * 0.025
               + contourInk * 0.075 + survey * 0.72;
    paletteMix = clamp01(0.68 + depth * 0.18 + survey * 0.12);
    nativeWhite = survey * 0.34;
  } else if (fixtureType == FIX_PAR) {
    // Discrete depth bands turn the sparse Organs into survey soundings.
    var depthBand = floor(depth * 5.0) / 4.0;
    brightness = liveFloor + 0.065 + depthBand * 0.24 + contourInk * 0.34;
    paletteMix = clamp01(0.24 + depthBand * 0.58);
  } else if (isSign) {
    // Both signs show the same compact chart inset. A firm floor preserves TE
    // legibility while the nested lines remain visibly alive inside it.
    var insetFrame = max(smooth01((0.10 - abs(mapX - 0.50)) / 0.075),
                         smooth01((0.10 - abs(mapZ - 0.50)) / 0.075));
    brightness = liveFloor + 0.11 + depth * 0.025
               + contourInk * (0.58 + majorGate * 0.20)
               + insetFrame * 0.05;
    paletteMix = clamp01(0.20 + depth * 0.38
                       + contourInk * (0.16 + majorGate * 0.12));
  }

  // A modest final drafting gain keeps fine chart ink photo-visible on the
  // physical hull without filling the dark water between contour families.
  brightness = clamp01(brightness * 1.08);
  var outR = (pr1 + (pr2 - pr1) * paletteMix) * brightness;
  var outG = (pg1 + (pg2 - pg1) * paletteMix) * brightness;
  var outB = (pb1 + (pb2 - pb1) * paletteMix) * brightness;
  var outW = clamp01(nativeWhite);
  rgbwau(clamp01(outR), clamp01(outG), clamp01(outB), outW, outW, 0.0);
}
