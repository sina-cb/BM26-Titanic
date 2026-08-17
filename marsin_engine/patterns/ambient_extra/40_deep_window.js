// DRAFT — pending operator review
/*
  40_deep_window.js — DEEP WINDOW

  CONCEPT
    Three to five finite rectangular windows recede through the vessel toward
    one gently wandering vanishing point. This is a countable perspective
    drawing, not a circular tunnel: every layer has four straight sides and
    all layers share one exact center.

  INSTRUMENT STAGING
    FIX_BAR_18     — broad translucent planes behind the rectangular borders.
    FIX_RAW_LED    — the nearest, largest frame for a clean distant outline.
    FIX_VINTAGE_6  — sparse corner catches with restrained native W=A.
    FIX_PAR        — four stable perspective anchors around the window stack.
    FIX_TE_SIGN    — paired local window diagrams mapped across each sign.

  MOTION / MATH
    A signed phase advances a finite queue of perspective depths. Each frame
    expands from the common vanishing point along a nonlinear depth curve;
    the outer frame fades beyond the modeled field exactly as a new tiny frame
    emerges. Two irrationally related sines move the bounded vanishing point,
    preventing a short visible re-lock while preserving one shared center.

  CONTROLS (declaration order = physical MIDI order)
    localSpeed      — recession cadence of the complete frame queue.
    direction       — genuine signed depth motion; endpoints reverse travel.
    windowCount     — selects exactly three, four, or five visible layers.
    borderWidth     — thickness of all four finite sides on every layer.
    depth           — separation and perspective spread between layers.
    vanishingPoint  — travel extent of the one bounded shared center.
    level           — intensity of frames, planes, corners, and anchors.
    safetyFloor     — protected whole-vessel visibility beneath the drawing.

  AUDIO_MODULATION_V1:
    sliderDepth       <- micFlux range 0.22..0.60 curve ease # flux opens the perspective depth
    sliderBorderWidth <- micHigh range 0.06..0.24 curve linear # highs sharpen the window borders
  Static (unmapped) params: localSpeed, direction, windowCount,
    vanishingPoint, level, safetyFloor, colorPalette1/2.

  COLOR / OUTPUT
    RGB stays strictly on the cp1-to-cp2 line. Only Vintage fixtures emit
    native white, always with byte-identical W=A. UV is always zero. Silence
    retains a slow complete composition and a nonblack whole-ship floor.
*/

export var cp1H = 0.585, cp1S = 0.80, cp1V = 0.92;
export var cp2H = 0.105, cp2S = 0.76, cp2V = 1.00;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export var localSpeed = 0.30;
export var direction = 0.76;
export var windowCount = 0.52;
export var borderWidth = 0.18;
export var depth = 0.38;
export var vanishingPoint = 0.42;
export var level = 0.72;
export var safetyFloor = 0.26;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderDirection(v) {
  direction = v;
  var dv = v * 2.0 - 1.0;
  if (dv >= 0.0 && dv < 0.06) dv = 0.06;
  else if (dv < 0.0 && dv > -0.06) dv = -0.06;
  signedDirection = dv;
}
export function sliderWindowCount(v) { windowCount = v; }
export function sliderBorderWidth(v) { borderWidth = v; }
export function sliderDepth(v) { depth = v; }
export function sliderVanishingPoint(v) { vanishingPoint = v; }
export function sliderLevel(v) { level = v; }
export function sliderSafetyFloor(v) { safetyFloor = v; }

var SQRT2 = 1.41421356;
var SQRT3 = 1.73205081;
var GOLDEN_FRACTION = 0.61803399;
var GOLDEN_ANGLE = 2.39996323;
var PHASE_WRAP = 10000.0;

var depthPhase = 0.137;
var vanishingTravelClock = 0.25;
var signedDirection = 0.52;
var sharedVanishingX = 0.50;
var sharedVanishingY = 0.50;

var liveWindowCount = 0.52;
var liveBorderWidth = 0.18;
var liveDepth = 0.38;
var liveVanishingPoint = 0.42;
var liveLevel = 0.72;
var liveSafetyFloor = 0.26;

var pr1 = 1.0, pg1 = 0.0, pb1 = 0.0;
var pr2 = 0.0, pg2 = 0.0, pb2 = 1.0;

function clamp01(v) {
  if (v < 0.0) return 0.0;
  if (v > 1.0) return 1.0;
  return v;
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

  // Live edits converge without teleporting a border or the shared center.
  var follow = min(1.0, dt * 5.2);
  liveWindowCount += (windowCount - liveWindowCount) * follow;
  liveBorderWidth += (borderWidth - liveBorderWidth) * follow;
  liveDepth += (depth - liveDepth) * follow;
  liveVanishingPoint += (vanishingPoint - liveVanishingPoint) * follow;
  liveLevel += (level - liveLevel) * follow;
  liveSafetyFloor += (safetyFloor - liveSafetyFloor) * follow;

  var localMultiplier = 0.25 + clamp01(localSpeed)
    * (32.824 - 16.412 * clamp01(localSpeed));
  depthPhase += dt * (0.085 + localMultiplier * 0.225) * signedDirection;
  vanishingTravelClock += dt * 0.060 * localMultiplier * signedDirection;
  if (depthPhase >= PHASE_WRAP) depthPhase -= PHASE_WRAP;
  if (depthPhase < 0.0) depthPhase += PHASE_WRAP;
  if (vanishingTravelClock >= PHASE_WRAP) vanishingTravelClock -= PHASE_WRAP;
  if (vanishingTravelClock < 0.0) vanishingTravelClock += PHASE_WRAP;

  // Both coordinates use the same phase but irrational rates. The signed X
  // traverse is deliberately legible on the sparse hull: reversing Direction
  // reverses the complete common-center stack, never an independent overlay.
  var wander = clamp01(liveVanishingPoint) * 0.16;
  sharedVanishingX = 0.50 + wander
    * (0.64 * sin(depthPhase * PI2 * GOLDEN_FRACTION + 0.41)
      + 0.36 * sin(depthPhase * PI2 * SQRT2 + 1.73))
    + 0.28 * cos(vanishingTravelClock * PI2);
  sharedVanishingY = 0.50 + wander
    * (0.62 * sin(depthPhase * PI2 * SQRT3 + 2.11)
      + 0.38 * sin(depthPhase * PI2 / SQRT2 + 4.07));

  _hsv2rgb1();
  _hsv2rgb2();
}

export function render3D(index, x, y, z) {
  var px = clamp01(x);
  var py = clamp01(y * 0.84 + z * 0.16);
  var isSign = fixtureType == FIX_TE_SIGN;

  if (isSign) {
    // Both 74-pixel signs receive the same local 10x8 diagram. This keeps the
    // paired Identity surfaces byte-balanced while using both letter axes.
    var signIndex = index % 74.0;
    px = (signIndex % 10.0) / 9.0;
    py = floor(signIndex / 10.0) / 7.0;
  }

  var fromVanishingX = px - sharedVanishingX;
  var fromVanishingY = py - sharedVanishingY;
  var frameCount = floor(3.0 + clamp01(liveWindowCount) * 2.999);
  var queuePhase = depthPhase - floor(depthPhase);
  var depthWarp = clamp01(liveDepth) * 0.62;
  var physicalEdgeWidth = 0.024 + clamp01(liveBorderWidth) * 0.085;
  var allBorders = 0.0;
  var allPlanes = 0.0;
  var allCorners = 0.0;
  var nearestBorder = 0.0;
  var nearestProgress = -1.0;
  var depthColorSum = 0.0;
  var depthColorWeight = 0.0;

  // Each fixed iteration is one complete four-sided rectangle. All active
  // layers share this exact center and differ only in nonlinear depth scale.
  for (var frameIndex = 0.0; frameIndex < 5.0; frameIndex++) {
    var activeFrame = frameIndex < frameCount;
    var linearProgress = (frameIndex + queuePhase) / frameCount;
    var nonlinearProgress = linearProgress * linearProgress;
    var depthProgress = linearProgress * (1.0 - depthWarp)
                      + nonlinearProgress * depthWarp;
    var halfWidth = 0.065 + depthProgress * 0.515;
    var halfHeight = 0.045 + depthProgress * 0.345;
    var normalizedX = abs(fromVanishingX) / halfWidth;
    var normalizedY = abs(fromVanishingY) / halfHeight;
    var layerRadius = max(normalizedX, normalizedY);
    var borderDistance = abs(layerRadius - 1.0)
                       * min(halfWidth, halfHeight);
    var enterFade = smoothstep(0.0, 0.08, depthProgress);
    var exitFade = 1.0 - smoothstep(0.92, 1.0, depthProgress);
    var layerVisibility = (0.34 + enterFade * exitFade * 0.66)
                        * activeFrame;
    var border = (1.0 - smoothstep(physicalEdgeWidth,
                                   physicalEdgeWidth * 1.70,
                                   borderDistance)) * layerVisibility;
    var insidePlane = (1.0 - smoothstep(0.78, 0.98, layerRadius))
                    * layerVisibility;
    var cornerRatio = min(normalizedX, normalizedY)
                    / (layerRadius + 0.0001);
    var corners = border * smoothstep(0.72, 0.94, cornerRatio);
    allBorders = max(allBorders, border);
    allPlanes += insidePlane * (0.035 + (1.0 - depthProgress) * 0.045);
    allCorners = max(allCorners, corners);
    depthColorSum += border * depthProgress;
    depthColorWeight += border;
    if (depthProgress > nearestProgress) {
      nearestProgress = depthProgress;
      nearestBorder = border;
    }
  }
  var depthColor = nearestProgress;
  if (depthColorWeight > 0.0001) {
    depthColor = depthColorSum / depthColorWeight;
  }
  var rectX = abs(fromVanishingX) / 0.58;
  var rectY = abs(fromVanishingY) / 0.39;
  var apertureRadius = max(rectX, rectY);

  // Five is the hard finite maximum. Window Count activates exactly 3–5
  // layers; no allocations or unbounded work occur in the per-pixel path.
  allBorders = clamp01(allBorders);
  allPlanes = clamp01(allPlanes);
  allCorners = clamp01(allCorners);
  nearestBorder = clamp01(nearestBorder);

  var floorLevel = 0.040 + clamp01(liveSafetyFloor) * 0.220;
  var featureLevel = 0.20 + clamp01(liveLevel) * 0.80;
  // The shared-center aperture is a translucent well behind the countable
  // borders.  It gives the rectangles actual depth rather than the appearance
  // of independently floating line objects.
  var aperture = 1.0 - smoothstep(0.24, 0.96, apertureRadius);
  var aperturePulse = 0.72 + 0.28
    * wave(depthPhase * 0.37 + apertureRadius * 0.53);
  var depthWell = aperture * aperturePulse;

  var brightness = floorLevel + allPlanes * 0.14 * featureLevel
                 + allBorders * 0.72 * featureLevel
                 + depthWell * 0.13 * featureLevel;
  var paletteMix = clamp01(0.08 + depthColor * 0.78
                          + allPlanes * 0.12);
  var nativeWhite = 0.0;

  if (fixtureType == FIX_BAR_18) {
    // Hull Canvas carries translucent depth planes behind crisp borders.
    brightness = floorLevel + allPlanes * 0.30 * featureLevel
               + allBorders * 0.78 * featureLevel
               + depthWell * 0.22 * featureLevel;
    paletteMix = clamp01(0.08 + depthColor * 0.72
                       + allPlanes * 0.18);
  } else if (fixtureType == FIX_RAW_LED) {
    // Silhouette isolates the nearest frame for an unmistakable rectangle.
    brightness = floorLevel + 0.035
               + nearestBorder * 0.96 * featureLevel
               + allBorders * 0.30 * featureLevel
               + depthWell * 0.10 * featureLevel;
    paletteMix = clamp01(0.12 + nearestBorder * 0.78
                       + depthColor * 0.10);
  } else if (fixtureType == FIX_VINTAGE_6) {
    // Jewelry catches only the finite corners. Native white is exclusive to
    // Vintage fixtures and emitted with exact W=A parity.
    var cornerPulse = 0.68 + 0.32
      * sin(pixelLocalIndex * GOLDEN_ANGLE + depthPhase * PI2 * 0.43);
    var jewelryCatch = allCorners * max(0.0, cornerPulse);
    brightness = floorLevel * 0.78 + 0.06
               + allBorders * 0.10 * featureLevel
               + jewelryCatch * 0.76 * featureLevel;
    paletteMix = clamp01(0.18 + depthColor * 0.54
                       + jewelryCatch * 0.24);
    nativeWhite = jewelryCatch * featureLevel * 0.34;
  } else if (fixtureType == FIX_PAR) {
    // Four Organ cohorts are stable perspective anchors around the moving
    // stack, with the active cohort chosen from the local fixture index.
    var anchorCohort = pixelLocalIndex % 4.0;
    var anchorX = anchorCohort == 0.0 || anchorCohort == 2.0 ? -1.0 : 1.0;
    var anchorY = anchorCohort < 2.0 ? -1.0 : 1.0;
    var anchorPhase = 0.5 + 0.5
      * sin(depthPhase * PI2 + anchorX * 0.72 + anchorY * 1.19);
    brightness = floorLevel + 0.10
               + (0.18 + anchorPhase * 0.42) * featureLevel
               + allCorners * 0.32 * featureLevel;
    paletteMix = clamp01(0.14 + (anchorCohort / 3.0) * 0.68
                       + anchorPhase * 0.10);
  } else if (isSign) {
    // Each TE sign carries the complete local perspective diagram with a firm
    // identity floor. Both signs use identical math and local addressing.
    brightness = max(0.30, floorLevel + 0.13
                   + allPlanes * 0.16 * featureLevel
                   + allBorders * 0.84 * featureLevel
                   + depthWell * 0.18 * featureLevel
                   + allCorners * 0.24 * featureLevel);
    paletteMix = clamp01(0.10 + depthColor * 0.76
                       + allCorners * 0.12);
  }

  brightness = clamp01(brightness);
  nativeWhite = clamp01(nativeWhite);
  paletteMix = clamp01(paletteMix);
  var outR = (pr1 + (pr2 - pr1) * paletteMix) * brightness;
  var outG = (pg1 + (pg2 - pg1) * paletteMix) * brightness;
  var outB = (pb1 + (pb2 - pb1) * paletteMix) * brightness;
  rgbwau(clamp01(outR), clamp01(outG), clamp01(outB),
         nativeWhite, nativeWhite, 0.0);
}
