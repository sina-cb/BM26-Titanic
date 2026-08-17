// DRAFT — pending operator review
/*
  20_long_shadow.js — LONG SHADOW

  CONCEPT
    One broad oblique shadow crosses a fully lit vessel. A single narrow rim
    marks its leading edge, like a moving architectural occluder rather than
    an eclipse, pulse, or repeating stripe field.

  INSTRUMENT STAGING
    Hull Canvas — the continuous lit plane and its connected shadow slab.
    Silhouette  — a protected outline with a restrained pass of the shadow.
    Jewelry     — sparse matched W+A grazing glints on the leading rim.
    Organs      — individual break lamps that announce the rim crossing.
    Identity    — two balanced fixture-local miniature shadow transits.

  MOTION / MATH
    A signed accumulator moves one finite tilted slab back and forth across an
    XYZ projection. The occluder has an asymmetric, one-sided penumbra and only
    its leading boundary carries a luminous rim. Irrational secondary drift
    keeps the plane alive without introducing a second shadow.

  CONTROLS (declaration order = physical MIDI order)
    localSpeed  — crossing pace.
    direction   — genuine signed reversal; centre retains slow movement.
    shadowWidth — connected slab coverage, approximately 15–45%.
    rimWidth    — thickness and visibility of the single leading rim.
    tilt        — oblique angle of the shadow plane.
    depth       — darkness of the occluded material.
    safetyFloor — dependable whole-rig minimum light.

  AUDIO_MODULATION_V1:
    sliderShadowWidth <- micFlux range 0.25..0.55 curve ease   # builds broaden the passing shadow
    sliderRimWidth    <- micHigh range 0.05..0.22 curve linear # highs sharpen the luminous edge
  Static (unmapped) params: localSpeed, direction, tilt, depth, safetyFloor,
    colorPalette1/2.

  COLOR / OUTPUT
    RGB remains strictly on the cp1-to-cp2 line. Native white is emitted only
    as matched W+A on Jewelry; UV is always zero. Silence is a complete look.
*/

export var cp1H = 0.61, cp1S = 0.78, cp1V = 0.76;
export var cp2H = 0.09, cp2S = 0.62, cp2V = 1.00;
export function colorPalette1(hv, sv, vv) { cp1H = hv; cp1S = sv; cp1V = vv; }
export function colorPalette2(hv, sv, vv) { cp2H = hv; cp2S = sv; cp2V = vv; }

export var localSpeed = 0.31;
export var direction = 0.78;
export var shadowWidth = 0.48;
export var rimWidth = 0.30;
export var tilt = 0.58;
export var shadowDepth = 0.68;
export var visibilityFloor = 0.28;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderDirection(v) { direction = v; }
export function sliderShadowWidth(v) { shadowWidth = v; }
export function sliderRimWidth(v) { rimWidth = v; }
export function sliderTilt(v) { tilt = v; }
export function sliderDepth(v) { shadowDepth = v; }
export function sliderSafetyFloor(v) { visibilityFloor = v; }

var SQRT2 = 1.41421356;
var PHI = 1.61803399;
var GOLDEN_ANGLE = 2.39996323;
var PHASE_WRAP = 10000.0;

var travelPhase = 0.0;
var detailPhase = 0.0;
var heading = 0.56;
var slabCenter = 0.50;
var planeX = 0.80;
var planeY = 0.10;
var planeZ = 0.58;

var liveDirection = 0.78;
var liveShadowWidth = 0.48;
var liveRimWidth = 0.30;
var liveTilt = 0.58;
var liveDepth = 0.68;
var liveSafetyFloor = 0.28;

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
  else if (iv == 4.0) { pr2 = tv;   pg2 = pv;   pb2 = qv;   }
  else                 { pr2 = cp2V; pg2 = pv;   pb2 = qv;   }
}

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  // Slew every geometry-bearing edit so a live knob move bends the material
  // instead of teleporting its connected edge.
  var shapeFollow = min(1.0, dt * 5.0);
  var lightFollow = min(1.0, dt * 11.0);
  liveDirection = direction;
  liveShadowWidth += (shadowWidth - liveShadowWidth) * shapeFollow;
  liveRimWidth += (rimWidth - liveRimWidth) * shapeFollow;
  liveTilt += (tilt - liveTilt) * shapeFollow;
  liveDepth += (shadowDepth - liveDepth) * lightFollow;
  liveSafetyFloor += (visibilityFloor - liveSafetyFloor) * lightFollow;

  heading = liveDirection * 2.0 - 1.0;
  if (heading >= 0.0 && heading < 0.06) heading = 0.06;
  else if (heading < 0.0 && heading > -0.06) heading = -0.06;

  var localMultiplier = 0.25 + clamp01(localSpeed)
    * (32.824 - 16.412 * clamp01(localSpeed));
  // A direction sweep observes only a short launch window, so the crossing
  // needs enough physical displacement to show its signed travel while the
  // default remains a calm, roughly twenty-three-second passage.
  var rate = 0.025 + localMultiplier * 0.090;
  travelPhase += dt * rate * heading;
  // Every time-bearing component follows the signed heading. Keeping the
  // secondary depth breath on the same sign makes the two direction endpoints
  // exact temporal reversals instead of laying forward-only wobble over them.
  detailPhase += dt * rate * SQRT2 * heading;
  if (travelPhase >= PHASE_WRAP) travelPhase -= PHASE_WRAP;
  else if (travelPhase < 0.0) travelPhase += PHASE_WRAP;
  if (detailPhase >= PHASE_WRAP) detailPhase -= PHASE_WRAP;
  else if (detailPhase < 0.0) detailPhase += PHASE_WRAP;

  // The leading edge traverses most of the vessel while the finite slab keeps
  // some overlap at both turnarounds. That long throw is the far-field read.
  slabCenter = 0.50 + sin(travelPhase * PI2) * 0.33;
  var angle = (liveTilt - 0.5) * PI * 0.72;
  planeX = cos(angle);
  planeZ = sin(angle);
  planeY = 0.14 + 0.08 * sin(detailPhase * PI2 / PHI);

  _hsv2rgb1();
  _hsv2rgb2();
}

export function render3D(index, x, y, z) {
  var ux = clamp01(x);
  var uy = clamp01(y);
  var uz = clamp01(z);
  var isSign = fixtureType == FIX_TE_SIGN;

  if (isSign) {
    // Fold the physical 40 + 34 patch into one complete 74-pixel transit.
    var signIndex = index % 74.0;
    ux = (signIndex % 10.0) / 9.0;
    uy = 1.0 - floor(signIndex / 10.0) / 7.0;
    uz = 0.50;
  }

  var projected = 0.50 + (ux - 0.50) * planeX
                + (uz - 0.50) * planeZ
                + (uy - 0.50) * planeY;
  var halfWidth = 0.075 + clamp01(liveShadowWidth) * 0.150;

  // One fixed side has the long soft penumbra. Direction reverses the entire
  // transit through time; it does not mirror the slab into a different shape.
  // That preserves the identity of one connected architectural occluder.
  var leadingSide = 1.0;
  // Anchor the luminous boundary to the shared travel path so low/high
  // direction are exact temporal reversals of the same physical rim.
  var slabCoordinate = projected
                     - (slabCenter - leadingSide * halfWidth);
  var leadingSigned = (slabCoordinate * leadingSide) - halfWidth;
  var penumbraWidth = 0.030 + clamp01(liveDepth) * 0.060;
  var shadowMask = smoothstep(-halfWidth - 0.016, -halfWidth,
                              slabCoordinate)
                 * (1.0 - smoothstep(halfWidth, halfWidth + penumbraWidth,
                                     slabCoordinate));

  // Only the leading boundary receives light. RimWidth changes both its
  // physical thickness and its visible strength, so the control is obvious.
  var rimPhysical = 0.005 + clamp01(liveRimWidth) * 0.035;
  var rimDistance = abs(leadingSigned);
  var rim = 1.0 - smooth01(rimDistance / rimPhysical);
  rim *= 0.18 + clamp01(liveRimWidth) * 0.82;

  var floorLevel = 0.035 + clamp01(liveSafetyFloor) * 0.665;
  var shadowLight = 0.68 - clamp01(liveDepth) * 0.63;
  var brightness = 0.78 * (1.0 - shadowMask)
                 + shadowLight * shadowMask + rim * 0.92;
  brightness = max(floorLevel, brightness);
  var paletteMix = clamp01(0.78 - shadowMask * 0.66 + rim * 0.18);
  var outW = 0.0;

  if (fixtureType == FIX_RAW_LED) {
    // The outline is protected: the slab reads, but never erases the ship.
    brightness = max(floorLevel * 1.20,
      0.66 - shadowMask * (0.18 + liveDepth * 0.28) + rim * 0.86);
    paletteMix = clamp01(0.82 - shadowMask * 0.48 + rim * 0.12);
  } else if (fixtureType == FIX_VINTAGE_6) {
    // Sparse grazing points on the single leading edge, with matched warm
    // white lanes. Away from the rim, Jewelry remains restrained palette RGB.
    var lens = 0.5 + 0.5 * cos(pixelLocalIndex * GOLDEN_ANGLE
                              + detailPhase * PI2 * 0.37);
    var grazing = rim * (0.35 + pow(lens, 8.0) * 0.65);
    brightness = max(floorLevel * 0.72,
      0.22 + (1.0 - shadowMask) * 0.11 + grazing * 0.48);
    paletteMix = clamp01(0.63 - shadowMask * 0.28 + grazing * 0.20);
    outW = clamp01(grazing * (0.12 + liveRimWidth * 0.54));
  } else if (fixtureType == FIX_PAR) {
    // Organs act as discrete break lamps as the edge crosses their positions.
    var lamp = pow(rim, 0.65);
    brightness = max(floorLevel,
      0.28 + (1.0 - shadowMask) * 0.16 + lamp * 0.72);
    paletteMix = clamp01(0.70 - shadowMask * 0.42 + lamp * 0.18);
  } else if (isSign) {
    // A high identity floor preserves the letterforms while the compact slab
    // and its one bright edge remain clearly visible on both signs.
    brightness = max(0.31,
      0.62 - shadowMask * (0.20 + liveDepth * 0.28) + rim * 0.84);
    paletteMix = clamp01(0.80 - shadowMask * 0.55 + rim * 0.16);
  } else if (fixtureType == FIX_BAR_18) {
    // Hull Canvas is the reference plane; no additional pattern fragments the
    // single connected shadow.
    brightness = max(floorLevel, brightness);
  }

  brightness = clamp01(brightness);
  var outR = (pr1 + (pr2 - pr1) * paletteMix) * brightness;
  var outG = (pg1 + (pg2 - pg1) * paletteMix) * brightness;
  var outB = (pb1 + (pb2 - pb1) * paletteMix) * brightness;
  rgbwau(clamp01(outR), clamp01(outG), clamp01(outB), outW, outW, 0.0);
}
