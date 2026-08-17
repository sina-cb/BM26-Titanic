// DRAFT — pending operator review
/*
  23_needle_gauge.js — NEEDLE GAUGE

  CONCEPT
    One immense, fixed instrument dial spans the ship. A finite needle scans
    its calibrated arc while Organs illuminate as ordered threshold lamps.
    This is a bounded measurement instrument, never a lighthouse beam.

  INSTRUMENT STAGING
    Hull Canvas  — the dial face, engraved arc, ticks and finite needle.
    Silhouette   — the clearest scale rim and major calibration marks.
    Jewelry      — sparse golden-white scale lamps with matched W+A lanes.
    Organs       — ordered threshold lamps that fill behind the needle.
    Identity     — two balanced fixture-local miniature gauges.

  MOTION / MATH
    An eased triangle oscillator moves monotonically across each half-cycle.
    Range always preserves at least 86% of the calibrated scale. Polar arc
    distance draws the fixed face; point-to-segment distance draws one finite
    needle. An irrational material drift prevents the dial face from locking.

  CONTROLS (declaration order = physical MIDI order)
    localSpeed  — pace of the complete gauge scan.
    range       — breadth of the needle's bounded calibrated travel.
    needleWidth — thickness and halo of the finite needle segment.
    tickGlow    — visibility of fixed and passed scale marks.
    organPeak   — prominence of ordered PAR threshold lamps.
    safetyFloor — dependable whole-rig minimum light.

  AUDIO_MODULATION_V1:
    sliderRange     <- micFlux range 0.30..0.68 curve ease   # flux opens the calibrated scan
    sliderOrganPeak <- micMid  range 0.08..0.40 curve linear # mids lift the ordered threshold lamps
  Static (unmapped) params: localSpeed, needleWidth, tickGlow,
    safetyFloor, colorPalette1/2.

  COLOR / OUTPUT
    RGB stays strictly on the cp1-to-cp2 line. Native white appears only on
    Vintage scale lamps, always with byte-identical W and A. UV is always zero.
    Silence remains a complete, slowly moving ambient instrument.
*/

export var cp1H = 0.60, cp1S = 0.76, cp1V = 0.82;
export var cp2H = 0.105, cp2S = 0.70, cp2V = 1.00;
export function colorPalette1(hv, sv, vv) { cp1H = hv; cp1S = sv; cp1V = vv; }
export function colorPalette2(hv, sv, vv) { cp2H = hv; cp2S = sv; cp2V = vv; }

export var localSpeed = 0.55;
export var gaugeRange = 0.54;
export var needleWidth = 0.38;
export var tickGlow = 0.54;
export var organPeak = 0.30;
export var safetyFloor = 0.30;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderRange(v) { gaugeRange = v; }
export function sliderNeedleWidth(v) { needleWidth = v; }
export function sliderTickGlow(v) { tickGlow = v; }
export function sliderOrganPeak(v) { organPeak = v; }
export function sliderSafetyFloor(v) { safetyFloor = v; }

var SQRT2 = 1.41421356;
var PHI = 1.61803399;
var GOLDEN_ANGLE = 2.39996323;
var PHASE_WRAP = 10000.0;

// Start at the center reading so a freshly loaded gauge is immediately
// legible before beginning its autonomous bounded scan.
var scanPhase = 0.250;
var materialPhase = 0.371;
var needlePosition = 0.50;
var needleCos = 0.0;
var needleSin = 1.0;
var liveRange = 0.54;
var liveNeedleWidth = 0.38;
var liveTickGlow = 0.54;
var liveOrganPeak = 0.30;
var liveSafetyFloor = 0.30;

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

  // Geometry and brightness-bearing edits slew independently so a live MIDI
  // move reshapes the instrument instead of teleporting its needle or scale.
  var shapeFollow = min(1.0, dt * 5.0);
  var lightFollow = min(1.0, dt * 10.0);
  liveRange += (gaugeRange - liveRange) * shapeFollow;
  liveNeedleWidth += (needleWidth - liveNeedleWidth) * shapeFollow;
  liveTickGlow += (tickGlow - liveTickGlow) * lightFollow;
  liveOrganPeak += (organPeak - liveOrganPeak) * lightFollow;
  liveSafetyFloor += (safetyFloor - liveSafetyFloor) * lightFollow;

  // Quadratic trim keeps the low end genuinely slow while preserving a clear,
  // monotonic acceleration across the whole local-speed range.
  var speedTrim = clamp01(localSpeed);
  // Calibrated for the Ambient operating point: Global 0.30 / Local 0.30
  // carries the former Global 0.98 / Local 0.85 scan cadence.
  var rate = 15.0 * (0.004 + speedTrim * speedTrim * 0.048);
  scanPhase += dt * rate;
  materialPhase += dt * rate * SQRT2;
  if (scanPhase >= PHASE_WRAP) scanPhase -= PHASE_WRAP;
  if (materialPhase >= PHASE_WRAP) materialPhase -= PHASE_WRAP;

  // The eased triangle is monotonic on each half-cycle. Range changes the
  // bounded sweep from 86% to 98% of the engraved scale, never beyond it.
  var unitPhase = scanPhase - floor(scanPhase);
  var triangle = 1.0 - abs(unitPhase * 2.0 - 1.0);
  var easedScan = smooth01(triangle);
  var halfSpan = 0.43 + clamp01(liveRange) * 0.06;
  needlePosition = 0.50 - halfSpan + easedScan * halfSpan * 2.0;
  var needleAngle = PI * (1.0 - needlePosition);
  needleCos = cos(needleAngle);
  needleSin = sin(needleAngle);

  _hsv2rgb1();
  _hsv2rgb2();
}

export function render3D(index, x, y, z) {
  var geomX = clamp01(x);
  var geomY = clamp01(y);
  var geomZ = clamp01(z);
  var isSign = fixtureType == FIX_TE_SIGN;

  if (isSign) {
    // The sign is physically patched as 40 + 34 pixels. Fold the global index
    // across one complete row-major 10x8/74-pixel gauge so both signs match
    // byte-for-byte without repeating the first fixture's drawing.
    var signIndex = index % 74.0;
    geomX = (signIndex % 10.0) / 9.0;
    geomY = 1.0 - floor(signIndex / 10.0) / 7.0;
    geomZ = 0.50;
  }

  // Titanic's long, continuously sampled hull axis is Z. The paired signs
  // use their fixture-local X axis instead, so each remains a complete dial.
  var dialX = geomZ;
  if (isSign) dialX = geomX;

  var centerX = 0.50;
  var centerY = 0.12;
  var dx = dialX - centerX;
  var dy = geomY - centerY;
  var radius = sqrt(dx * dx + dy * dy);
  var angle = atan2(dy, dx);
  var onUpperFace = 1.0;
  if (angle < 0.0 || angle > PI) onUpperFace = 0.0;
  var gaugeU = clamp01(1.0 - angle / PI);

  // Fixed engraved scale and eleven deterministic major ticks. Neither moves
  // with the needle, which keeps this an instrument dial rather than a beam.
  var scaleArc = (1.0 - smoothstep(0.010, 0.034, abs(radius - 0.43)))
               * onUpperFace;
  var tickPhase = gaugeU * 10.0;
  var tickDistance = abs(tickPhase - floor(tickPhase + 0.50));
  var tickAngular = 1.0 - smoothstep(0.055, 0.165, tickDistance);
  var tickRadial = 1.0 - smoothstep(0.018, 0.062,
                                  abs(radius - 0.385));
  var ticks = tickAngular * tickRadial * onUpperFace;

  // Distance to one finite segment from radius 0.075 to 0.405. The explicit
  // projection clips both ends; no infinite scan line or lighthouse remains.
  var innerRadius = 0.075;
  var outerRadius = 0.405;
  var needleStartX = centerX + needleCos * innerRadius;
  var needleStartY = centerY + needleSin * innerRadius;
  var needleVectorX = needleCos * (outerRadius - innerRadius);
  var needleVectorY = needleSin * (outerRadius - innerRadius);
  var needleLengthSq = (outerRadius - innerRadius)
                     * (outerRadius - innerRadius);
  var alongNeedle = ((dialX - needleStartX) * needleVectorX
                   + (geomY - needleStartY) * needleVectorY)
                  / needleLengthSq;
  alongNeedle = clamp01(alongNeedle);
  var nearestX = needleStartX + alongNeedle * needleVectorX;
  var nearestY = needleStartY + alongNeedle * needleVectorY;
  var needleDx = dialX - nearestX;
  var needleDy = geomY - nearestY;
  var needleDistanceSq = needleDx * needleDx + needleDy * needleDy;
  var needleCoreWidth = 0.003 + clamp01(liveNeedleWidth) * 0.045;
  var needleHaloWidth = needleCoreWidth * 3.20;
  var needleCore = 1.0 - smoothstep(needleCoreWidth * needleCoreWidth,
                                   needleHaloWidth * needleHaloWidth,
                                   needleDistanceSq);
  // A finite luminous pointer cap rides the scale, making the current reading
  // legible from distance throughout the autonomous scan.
  var tipX = centerX + needleCos * outerRadius;
  var tipY = centerY + needleSin * outerRadius;
  var tipDx = dialX - tipX;
  var tipDy = geomY - tipY;
  var tipDistanceSq = tipDx * tipDx + tipDy * tipDy;
  var needleTip = 1.0 - smoothstep(0.00050, 0.00640,
                                  tipDistanceSq);
  var hub = 1.0 - smoothstep(0.0016, 0.0095,
                            dx * dx + dy * dy);

  // A subtle etched material gives close-range detail without creating a
  // second moving field that could compete with the gauge reading.
  var engraving = wave(dialX * PHI + geomY * SQRT2
                     + geomZ * 0.37 + materialPhase * 0.17);
  var floorLevel = 0.055 + clamp01(liveSafetyFloor) * 0.245;
  var tickLevel = clamp01(liveTickGlow);
  // Keep the irrational etching alive but subordinate to the actual reading.
  var brightness = floorLevel + engraving * 0.014
                 + scaleArc * (0.22 + tickLevel * 0.42)
                 + ticks * (0.18 + tickLevel * 0.66)
                 + needleCore * 0.96 + needleTip * 1.00 + hub * 0.78;
  // Material separation is the critical gauge signature: a stable deep-blue
  // face, a fixed gold scale, and one still-brighter gold pointer. Avoid a
  // whole-face hue gradient that can masquerade as a rotating compass rose.
  var paletteMix = clamp01(0.045 + gaugeU * 0.13
                          + scaleArc * 0.54 + ticks * 0.66
                          + needleCore * 0.78 + needleTip * 0.88
                          + hub * 0.56);
  var outW = 0.0;

  if (fixtureType == FIX_RAW_LED) {
    // Silhouette is the readable scale: restrained face, crisp fixed arc and
    // major marks, with the finite needle retained where geometry intersects.
    brightness = floorLevel * 0.76 + 0.045
               + scaleArc * (0.30 + tickLevel * 0.54)
               + ticks * (0.22 + tickLevel * 0.72)
               + needleCore * 0.92 + needleTip * 1.00 + hub * 0.42;
    paletteMix = clamp01(0.045 + gaugeU * 0.10
                       + scaleArc * 0.56 + ticks * 0.70
                       + needleCore * 0.82 + needleTip * 0.90);
  } else if (fixtureType == FIX_VINTAGE_6) {
    // Six physical heads become sparse fixed calibration lamps. The passed
    // marks retain a dim glow while the active needle mark blooms in W+A.
    var headU = pixelLocalIndex / 5.0;
    var headDistance = abs(headU - needlePosition);
    var activeHead = 1.0 - smoothstep(0.035, 0.155, headDistance);
    var passedHead = smoothstep(headU - 0.045, headU + 0.045,
                               needlePosition);
    var sparse = 0.74 + 0.26 * wave(fixtureId * GOLDEN_ANGLE
                                  + pixelLocalIndex * PHI);
    brightness = floorLevel * 0.72 + 0.055
               + tickLevel * sparse * (0.18 + passedHead * 0.30)
               + activeHead * (0.28 + tickLevel * 0.62);
    paletteMix = clamp01(0.45 + headU * 0.42 + activeHead * 0.10);
    outW = clamp01(activeHead * tickLevel
                 + passedHead * tickLevel * sparse * 0.25);
  } else if (fixtureType == FIX_PAR) {
    // World X supplies a stable spatial threshold order. Lamps below the
    // reading fill first; the frontier lamp blooms without temporal chatter.
    var threshold = dialX;
    var passed = smoothstep(threshold - 0.055, threshold + 0.055,
                            needlePosition);
    var frontier = 1.0 - smoothstep(0.025, 0.130,
                                   abs(threshold - needlePosition));
    brightness = floorLevel + 0.10 + liveOrganPeak
               * (passed * 0.48 + frontier * 0.82);
    paletteMix = clamp01(0.10 + threshold * 0.73 + frontier * 0.12);
  } else if (isSign) {
    // A higher identity floor preserves the letters. The local arc, ticks and
    // needle remain dynamic and byte-balanced across both sign fixtures.
    var dialWash = 1.0 - smoothstep(0.10, 0.52,
                                    abs(dialX - needlePosition));
    var dialField = wave(dialX * 0.71 + geomY * 0.37
                        - materialPhase * 0.63);
    brightness = max(0.29, floorLevel + 0.10
                   + scaleArc * (0.22 + tickLevel * 0.36)
                   + ticks * (0.16 + tickLevel * 0.46)
                   + needleCore * 0.88 + needleTip * 0.96 + hub * 0.42
                   + dialWash * (0.14 + dialField * 0.22));
    paletteMix = clamp01(0.06 + gaugeU * 0.11 + scaleArc * 0.48
                        + ticks * 0.58 + needleCore * 0.82
                        + needleTip * 0.90 + dialField * 0.16);
  } else if (fixtureType == FIX_BAR_18) {
    // Hull Canvas is the reference face; keep its analytic geometry intact.
    brightness = max(floorLevel, brightness);
  }

  brightness = clamp01(brightness);
  paletteMix = clamp01(paletteMix);
  var outR = (pr1 + (pr2 - pr1) * paletteMix) * brightness;
  var outG = (pg1 + (pg2 - pg1) * paletteMix) * brightness;
  var outB = (pb1 + (pb2 - pb1) * paletteMix) * brightness;
  rgbwau(clamp01(outR), clamp01(outG), clamp01(outB), outW, outW, 0.0);
}
