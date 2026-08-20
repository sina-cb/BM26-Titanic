// DRAFT — pending operator review
/*
  37_single_thread.js — SINGLE THREAD

  CONCEPT
    Exactly one thin, unbroken luminous Bézier thread crosses the complete
    vessel. One monotonic-X cubic evaluation follows the curve directly; there are
    no copies, parallel rivers, ripples, caustics, particles, or secondary
    paths. The surrounding ship remains visible as a low satin field.

  INSTRUMENT STAGING
    FIX_BAR_18     — a restrained, low-contrast Hull field under the filament.
    FIX_RAW_LED    — the strongest far-field reading of the one thread.
    FIX_VINTAGE_6  — one traveling needle cohort on that same thread, with
                     matched native W=A and no independent sparkle system.
    FIX_PAR        — three structural knots sampled along the same curve.
    FIX_TE_SIGN    — paired fixture-local crossings; both signs render the
                     same moving thread and retain a firm identity floor.

  MOTION / MATH
    A monotonic cubic Bézier runs from beyond x=0 to beyond x=1. Its two
    interior control points move on three independent, incommensurate clocks.
    Per pixel, an allocation-free monotonic-X cubic evaluation returns the
    curve distance and parameter. Direction reverses every
    clock; large whole-turn wraps are seam-safe.

  CONTROLS (declaration order = physical MIDI order)
    localSpeed     — pace of the moving control points and Jewelry needle.
    direction      — genuine signed reversal of all curve motion.
    threadWidth    — physical width of the single luminous filament.
    bend           — excursion of the two moving Bézier control points.
    glow           — gain of the thread and its close halo above the floor.
    jewelryNeedle  — strength of the one traveling Vintage W=A cohort.
    safetyFloor    — minimum palette-derived whole-vessel visibility.

  AUDIO_MODULATION_V1:
    sliderBend <- micFlux range 0.22..0.55 curve ease # flux flexes the single thread
    sliderGlow <- micHigh range 0.06..0.30 curve pow2 # highs illuminate its close halo
  Static (unmapped) params: localSpeed, direction, threadWidth,
    jewelryNeedle, safetyFloor, colorPalette1/2.

  COLOR / OUTPUT
    RGB stays strictly on the selected cp1-to-cp2 line. Only Vintage fixtures
    emit native white, always as byte-identical W=A; UV is always zero. The
    safety field makes silence complete without competing with the filament.
*/

export var cp1H = 0.585, cp1S = 0.82, cp1V = 0.88;
export var cp2H = 0.095, cp2S = 0.76, cp2V = 1.00;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export var localSpeed = 0.30;
export var direction = 0.74;
export var threadWidth = 0.30;
export var bend = 0.38;
export var glow = 0.20;
export var jewelryNeedle = 0.56;
export var safetyFloor = 0.27;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderDirection(v) { direction = v; }
export function sliderThreadWidth(v) { threadWidth = v; }
export function sliderBend(v) { bend = v; }
export function sliderGlow(v) { glow = v; }
export function sliderJewelryNeedle(v) { jewelryNeedle = v; }
export function sliderSafetyFloor(v) { safetyFloor = v; }

var SQRT2 = 1.41421356;
var SQRT3 = 1.73205081;
var PHI = 1.61803399;
var PHASE_WRAP = 10000.0;

var curveClock1 = 0.071;
var curveClock2 = 0.283;
var curveClock3 = 0.517;
var needleClock = 0.113;
var threadTravelClock = 0.0;

var point0x = -0.08, point0y = 0.37, point0z = 0.48;
var point1x = 0.27, point1y = 0.23, point1z = 0.35;
var point2x = 0.73, point2y = 0.77, point2z = 0.65;
var point3x = 1.08, point3y = 0.63, point3z = 0.52;
var needlePosition = 0.50;

var liveThreadWidth = 0.30;
var liveBend = 0.38;
var liveGlow = 0.20;
var liveJewelryNeedle = 0.56;
var liveSafetyFloor = 0.27;

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

  // Live edits enter the curve continuously rather than teleporting it.
  var follow = min(1.0, dt * 5.0);
  liveThreadWidth += (threadWidth - liveThreadWidth) * follow;
  liveBend += (bend - liveBend) * follow;
  liveGlow += (glow - liveGlow) * follow;
  liveJewelryNeedle += (jewelryNeedle - liveJewelryNeedle) * follow;
  liveSafetyFloor += (safetyFloor - liveSafetyFloor) * follow;

  var signedDirection = clamp01(direction) * 2.0 - 1.0;
  if (signedDirection >= 0.0 && signedDirection < 0.06) {
    signedDirection = 0.06;
  } else if (signedDirection < 0.0 && signedDirection > -0.06) {
    signedDirection = -0.06;
  }
  var localMultiplier = 0.25 + clamp01(localSpeed)
    * (32.824 - 16.412 * clamp01(localSpeed));
  curveClock1 += dt * 0.120 * localMultiplier * signedDirection;
  curveClock2 += dt * 0.089 * SQRT2 * localMultiplier * signedDirection;
  curveClock3 += dt * 0.071 * SQRT3 * localMultiplier * signedDirection;
  needleClock += dt * 0.065 * PHI * localMultiplier * signedDirection;
  threadTravelClock += dt * 0.120 * localMultiplier * signedDirection;

  if (curveClock1 >= PHASE_WRAP) curveClock1 -= PHASE_WRAP;
  if (curveClock1 < 0.0) curveClock1 += PHASE_WRAP;
  if (curveClock2 >= PHASE_WRAP) curveClock2 -= PHASE_WRAP;
  if (curveClock2 < 0.0) curveClock2 += PHASE_WRAP;
  if (curveClock3 >= PHASE_WRAP) curveClock3 -= PHASE_WRAP;
  if (curveClock3 < 0.0) curveClock3 += PHASE_WRAP;
  if (needleClock >= PHASE_WRAP) needleClock -= PHASE_WRAP;
  if (needleClock < 0.0) needleClock += PHASE_WRAP;
  if (threadTravelClock >= PHASE_WRAP) threadTravelClock -= PHASE_WRAP;
  if (threadTravelClock < 0.0) threadTravelClock += PHASE_WRAP;

  var bendAmount = 0.035 + clamp01(liveBend) * 0.235;
  var angle1 = curveClock1 * PI2;
  var angle2 = curveClock2 * PI2;
  var angle3 = curveClock3 * PI2;
  var threadLift = sin(threadTravelClock * PI2) * 0.14;

  // Endpoints stay outside the model, guaranteeing one continuous crossing.
  // Only the two interior points move; x remains monotonic at all settings.
  point0y = 0.38 + sin(angle3) * bendAmount * 0.16 + threadLift;
  point0z = 0.48 + cos(angle3) * bendAmount * 0.10;
  point1y = 0.31 + sin(angle1) * bendAmount + threadLift;
  point1z = 0.34 + cos(angle2) * bendAmount * 0.72;
  point2y = 0.69 + cos(angle2 + 0.91) * bendAmount + threadLift;
  point2z = 0.66 + sin(angle1 + angle3) * bendAmount * 0.72;
  point3y = 0.62 - sin(angle3) * bendAmount * 0.16 + threadLift;
  point3z = 0.52 - cos(angle3) * bendAmount * 0.10;

  // The Jewelry needle traverses the same curve without spawning a second
  // path. A sinusoid gives it continuous turnaround and no wrap flash.
  needlePosition = wave(needleClock);

  _hsv2rgb1();
  _hsv2rgb2();
}

export function render3D(index, x, y, z) {
  var ux = clamp01(x);
  var uy = clamp01(y);
  var uz = clamp01(z);
  var isSign = fixtureType == FIX_TE_SIGN;

  if (isSign) {
    // Each sign spans two physical fixtures. The complete 74-pixel fold keeps
    // the one cubic continuous through the fixture boundary on both signs.
    var signIndex = index % 74.0;
    ux = (signIndex % 10.0) / 9.0;
    uy = floor(signIndex / 10.0) / 7.0;
    uz = 0.50 + (uy - 0.50) * 0.10;
  }

  // Distance to one cubic Bézier by direct monotonic-X evaluation.
  // The closest projected point also gives the curve parameter used for its
  // color progression, three Organ knots, and single Jewelry needle cohort.
  var nearestT = clamp01((ux - point0x) / (point3x - point0x));
  var pixelV = uy * 0.62 + uz * 0.38;
  var inverseT = 1.0 - nearestT;
  var inverse2 = inverseT * inverseT;
  var curve2 = nearestT * nearestT;
  var weight0 = inverse2 * inverseT;
  var weight1 = 3.0 * inverse2 * nearestT;
  var weight2 = 3.0 * inverseT * curve2;
  var weight3 = curve2 * nearestT;
  var curveX = point0x * weight0 + point1x * weight1
             + point2x * weight2 + point3x * weight3;
  var curveY = point0y * weight0 + point1y * weight1
             + point2y * weight2 + point3y * weight3;
  var curveZ = point0z * weight0 + point1z * weight1
             + point2z * weight2 + point3z * weight3;
  var curveV = curveY * 0.62 + curveZ * 0.38;
  var distanceX = ux - curveX;
  var distanceV = pixelV - curveV;
  var nearestSquared = distanceX * distanceX + distanceV * distanceV;

  // Titanic's physical sampling is sparse: a mathematically thin curve can
  // fall between whole fixture runs.  This remains one filament, but its
  // luminous core is wide enough to be continuously traceable at distance.
  var width = 0.026 + clamp01(liveThreadWidth) * 0.084;
  var widthSquared = width * width;
  var haloReach = width * 2.30 + 0.010;
  var threadCore = smooth01(1.0 - nearestSquared
                           / (widthSquared + 0.000001));
  var threadHalo = smooth01(1.0 - nearestSquared
                           / (haloReach * haloReach + 0.000001));
  // One attached traveling highlight makes the signed direction legible on
  // the complete filament; it never creates a second path.
  var markerDistance = abs(nearestT - needlePosition);
  var travelMarker = smooth01(1.0 - markerDistance / 0.14)
                   * max(threadCore, threadHalo * 0.54);
  var floorLevel = 0.035 + clamp01(liveSafetyFloor) * 0.200;

  // One broad, sub-cycle satin plane is the Hull's quiet field. It never
  // becomes a second thread, ripple lattice, river, or caustic texture.
  var satin = wave((ux * 0.41 + uy * 0.23 + uz * 0.29)
                 + curveClock3 * 0.073);
  var brightness = floorLevel + satin * 0.016
                 + threadHalo * (0.13 + clamp01(liveGlow) * 0.48)
                 + threadCore * 0.86 + travelMarker * 0.26;
  var paletteMix = clamp01(0.08 + satin * 0.12 + nearestT * 0.72
                          + threadCore * 0.08);
  var nativeWhite = 0.0;

  if (fixtureType == FIX_BAR_18) {
    // The bars remain a low satin canvas with the single curve drawn across
    // them. The field is intentionally subordinate to the filament.
    brightness = floorLevel + satin * 0.020
               + threadHalo * (0.10 + liveGlow * 0.40)
               + threadCore * 0.72 + travelMarker * 0.22;
  } else if (fixtureType == FIX_RAW_LED) {
    // The Silhouette carries the strongest far-field thread reading.
    brightness = floorLevel + 0.028
               + threadHalo * (0.24 + liveGlow * 0.68)
               + threadCore * 1.08 + travelMarker * 0.36;
    paletteMix = clamp01(0.06 + nearestT * 0.86);
  } else if (fixtureType == FIX_VINTAGE_6) {
    // One global cohort moves along the same curve. It is gated by both curve
    // distance and curve parameter, so it cannot become a separate sparkle.
    var needleDistance = abs(nearestT - needlePosition);
    var needle = smooth01(1.0 - needleDistance / 0.180)
               * (0.32 + threadHalo * 0.68);
    brightness = floorLevel * 0.74 + 0.045
               + threadHalo * 0.10 + threadCore * 0.32
               + needle * (0.18 + liveJewelryNeedle * 0.62);
    paletteMix = clamp01(0.56 + nearestT * 0.34);
    nativeWhite = clamp01(needle * liveJewelryNeedle * 0.72);
  } else if (fixtureType == FIX_PAR) {
    // Three knots belong to the one curve: Organs brighten only where their
    // nearest curve parameter approaches one of these structural tie points.
    var knotDistance = min(abs(nearestT - 0.22),
                           min(abs(nearestT - 0.50),
                               abs(nearestT - 0.78)));
    var knot = smooth01(1.0 - knotDistance / 0.085)
             * max(threadCore, threadHalo * 0.48);
    brightness = floorLevel + 0.12
               + threadHalo * (0.12 + liveGlow * 0.24)
               + threadCore * 0.36 + knot * 0.52;
    paletteMix = clamp01(0.16 + nearestT * 0.74 + knot * 0.08);
  } else if (isSign) {
    // A readable bed contains one active crossing. Both physical signs use
    // the same local map, so their energy and motion remain exactly paired.
    brightness = max(0.29, floorLevel + 0.12 + satin * 0.012
                   + threadHalo * (0.22 + liveGlow * 0.54)
                   + threadCore * 0.82 + travelMarker * 0.28);
    paletteMix = clamp01(0.12 + nearestT * 0.78);
  }

  // Glow is an honest luminous-gain handle: it scales every authored trace
  // above the independent safety floor while leaving that floor untouched.
  // High-frequency modulation therefore remains legible at playa distance.
  brightness = floorLevel + (brightness - floorLevel)
             * (0.34 + clamp01(liveGlow) * 1.58);
  brightness = clamp01(brightness);
  paletteMix = clamp01(paletteMix);
  nativeWhite = clamp01(nativeWhite);
  var outR = (pr1 + (pr2 - pr1) * paletteMix) * brightness;
  var outG = (pg1 + (pg2 - pg1) * paletteMix) * brightness;
  var outB = (pb1 + (pb2 - pb1) * paletteMix) * brightness;
  rgbwau(clamp01(outR), clamp01(outG), clamp01(outB),
         nativeWhite, nativeWhite, 0.0);
}
