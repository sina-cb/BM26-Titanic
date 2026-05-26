/*
  dome_door_spin
  Door-opening reveal for Summer Camp Dome.

  Motion:
  - Starts mostly closed / dark.
  - A circular door opens from the front.
  - The whole pattern slowly spins after opening.
  - spinDirection controls direction:
      0.0 = reverse
      0.5 = mostly still
      1.0 = forward
*/

export var localSpeed = 0.5;
export var tierDelay = 0.36;
export var doorWidth = 0.42;
export var openImpact = 0.55;
export var holdBlackout = 0.35;
export var edgeUv = 0.34;
export var triangleLead = 0.68;

export var spinSpeed = 0.42;
export var spinDirection = 1.0;
export var doorOpenSoftness = 0.46;

export var cp1H = 0.60, cp1S = 0.88, cp1V = 0.46;
export var cp2H = 0.03, cp2S = 0.94, cp2V = 0.38;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderTierDelay(v) { tierDelay = v; }
export function sliderDoorWidth(v) { doorWidth = v; }
export function sliderOpenImpact(v) { openImpact = v; }
export function sliderHoldBlackout(v) { holdBlackout = v; }
export function sliderEdgeUv(v) { edgeUv = v; }
export function sliderTriangleLead(v) { triangleLead = v; }
export function sliderSpinSpeed(v) { spinSpeed = v; }
export function sliderSpinDirection(v) { spinDirection = v; }
export function sliderDoorOpenSoftness(v) { doorOpenSoftness = v; }

var pr1 = 1, pg1 = 0, pb1 = 0;
var pr2 = 0, pg2 = 0, pb2 = 1;

function _hsv2rgb1() {
  var hv = cp1H - floor(cp1H); if (hv < 0) hv += 1;
  var iv = floor(hv * 6) % 6;
  var fv = hv * 6 - floor(hv * 6);
  var pv = cp1V * (1 - cp1S);
  var qv = cp1V * (1 - fv * cp1S);
  var tv = cp1V * (1 - (1 - fv) * cp1S);

  if (iv == 0) { pr1 = cp1V; pg1 = tv; pb1 = pv; }
  else if (iv == 1) { pr1 = qv; pg1 = cp1V; pb1 = pv; }
  else if (iv == 2) { pr1 = pv; pg1 = cp1V; pb1 = tv; }
  else if (iv == 3) { pr1 = pv; pg1 = qv; pb1 = cp1V; }
  else if (iv == 4) { pr1 = tv; pg1 = pv; pb1 = cp1V; }
  else { pr1 = cp1V; pg1 = pv; pb1 = qv; }
}

function _hsv2rgb2() {
  var hv = cp2H - floor(cp2H); if (hv < 0) hv += 1;
  var iv = floor(hv * 6) % 6;
  var fv = hv * 6 - floor(hv * 6);
  var pv = cp2V * (1 - cp2S);
  var qv = cp2V * (1 - fv * cp2S);
  var tv = cp2V * (1 - (1 - fv) * cp2S);

  if (iv == 0) { pr2 = cp2V; pg2 = tv; pb2 = pv; }
  else if (iv == 1) { pr2 = qv; pg2 = cp2V; pb2 = pv; }
  else if (iv == 2) { pr2 = pv; pg2 = cp2V; pb2 = tv; }
  else if (iv == 3) { pr2 = pv; pg2 = qv; pb2 = cp2V; }
  else if (iv == 4) { pr2 = tv; pg2 = pv; pb2 = cp2V; }
  else { pr2 = cp2V; pg2 = pv; pb2 = qv; }
}

function clamp01(v) {
  if (v < 0.0) return 0.0;
  if (v > 1.0) return 1.0;
  return v;
}

function wrap01(v) {
  v = v % 1.0;
  if (v < 0.0) v += 1.0;
  return v;
}

function circDist(a, b) {
  var d = abs(a - b);
  if (d > 0.5) d = 1.0 - d;
  return d;
}

function softPulse(dist, width) {
  var xVal = clamp01(1.0 - dist / width);
  return xVal * xVal * (3.0 - 2.0 * xVal);
}

function ease01(v) {
  v = clamp01(v);
  return v * v * (3.0 - 2.0 * v);
}

var tDoor = 0.0;
var tSpin = 0.0;
var tBreath = 0.0;

export function beforeRender(delta) {
  var localMult = pow(2.0, (localSpeed - 0.5) * 4.0);
  var dt = (delta / 1310.72) * localMult;

  tDoor = wrap01(tDoor + dt * (0.095 + tierDelay * 0.34));

  var dir = spinDirection * 2.0 - 1.0;
  tSpin = wrap01(tSpin + dt * dir * (0.035 + spinSpeed * 0.42));

  tBreath = wrap01(tBreath + dt * (0.18 + openImpact * 0.55));

  _hsv2rgb1();
  _hsv2rgb2();
}

export function render3D(index, x, y, z) {
  var isTriangleEdge = sectionId == 1;
  var isTrianglePar = sectionId == 2 && y > 2.0;
  var isBar = sectionId == 2 && y <= 2.0;
  var isVintage = sectionId == 3;
  var isApex = isTriangleEdge || isTrianglePar;

  var theta0 = wrap01((atan2(z, x) / PI2) + 0.5);

  // Whole-pattern spin.
  var spinAmount = tSpin;
  var theta = wrap01(theta0 + spinAmount);

  // Door cycle:
  // 0.00 - 0.18 blackout / closed
  // 0.18 - 0.58 door opens
  // 0.58 - 1.00 open spin
  var closedHold = 0.10 + holdBlackout * 0.20;
  var openStart = closedHold;
  var openEnd = openStart + 0.26 + doorOpenSoftness * 0.22;

  var rawOpen = (tDoor - openStart) / (openEnd - openStart);
  var doorOpen = ease01(rawOpen);

  // Keep it from snapping black at the loop point.
  var loopFade = 1.0 - softPulse(circDist(tDoor, 0.0), 0.025 + holdBlackout * 0.035);
  doorOpen = doorOpen * loopFade;

  var doorCenterA = wrap01(0.25 + spinAmount * 0.35);
  var doorCenterB = wrap01(0.75 + spinAmount * 0.35);

  // Closed doors are narrow slits; open doors widen into a full reveal.
  var doorEdgeWidth = 0.018 + doorWidth * 0.12;
  var doorRevealWidth = 0.040 + doorWidth * 0.38 * doorOpen;

  var doorA = softPulse(circDist(theta, doorCenterA), doorRevealWidth);
  var doorB = softPulse(circDist(theta, doorCenterB), doorRevealWidth) * 0.78;
  var doorEdgeA = softPulse(circDist(theta, wrap01(doorCenterA + doorRevealWidth * 0.85)), doorEdgeWidth);
  var doorEdgeB = softPulse(circDist(theta, wrap01(doorCenterB - doorRevealWidth * 0.85)), doorEdgeWidth);

  var doorField = clamp01(doorA + doorB);
  var doorEdge = clamp01(doorEdgeA + doorEdgeB);

  // Soft rotating background motion after the door opens.
  var spiralA = wave(theta * 1.2 + y * 0.055 - tSpin * 1.9);
  var spiralB = wave(theta * 2.7 - y * 0.035 + tBreath * 0.9);
  var spinTexture = clamp01(spiralA * 0.68 + spiralB * 0.32);

  var openGlow = doorOpen * (0.28 + spinTexture * 0.72);
  var stage = 0.0;
  var white = 0.0;
  var amber = 0.0;
  var uv = 0.0;

  if (isTriangleEdge) {
    var edgeId = floor(index / 18.0);
    var edgeT = (index % 18) / 17.0;

    var tierPhase = wrap01(tDoor - edgeId * (0.025 + tierDelay * 0.030));
    var edgeOpen = ease01((tierPhase - openStart) / (openEnd - openStart));

    var edgeSweep = softPulse(
      circDist(edgeT, wrap01(edgeOpen + edgeId * 0.14)),
      0.030 + triangleLead * 0.085
    );

    var edgeBackSweep = softPulse(
      circDist(edgeT, wrap01(1.0 - edgeOpen * 0.82 + edgeId * 0.19)),
      0.022 + doorWidth * 0.050
    ) * 0.42;

    stage = clamp01(
      (edgeSweep * 0.72 + edgeBackSweep * 0.34 + doorField * 0.28) *
      (0.28 + triangleLead * 0.84) *
      edgeOpen
    );

    white = clamp01((edgeSweep * 0.42 + doorEdge * 0.34) * openImpact);
    uv = clamp01((edgeBackSweep * 0.55 + doorEdge * 0.28) * edgeUv);
  }

  else if (isBar) {
    var barLocal = index - 57;
    var barIndex = floor(barLocal / 18.0);
    var barT = (barLocal % 18) / 17.0;

    var tier = barIndex / 13.0;
    var delayedDoor = ease01((tDoor - openStart - tier * (0.030 + tierDelay * 0.045)) / (openEnd - openStart));

    var localFlow = wave(barT * (1.1 + doorWidth) - tSpin * 1.3 + barIndex * 0.061);
    var verticalOpen = softPulse(circDist(barT, delayedDoor), 0.035 + doorWidth * 0.075);

    stage = clamp01(
      (doorField * (0.46 + localFlow * 0.36) + verticalOpen * 0.42) *
      delayedDoor *
      (0.55 + openGlow * 0.65)
    );

    white = clamp01((doorEdge * 0.22 + verticalOpen * 0.20) * openImpact);
    uv = clamp01((doorEdge * 0.46 + verticalOpen * 0.28 + doorField * 0.12) * edgeUv);
  }

  else if (isTrianglePar) {
    var parBreath = pow(wave(tBreath * 0.82 + theta * 0.9 + index * 0.21), 3.4);

    stage = clamp01(
      (doorEdge * 0.42 + doorField * 0.24 + parBreath * 0.16) *
      triangleLead *
      doorOpen
    ) * 0.12;

    white = clamp01((doorEdge * 0.55 + parBreath * 0.18) * openImpact);
    uv = clamp01((doorField * 0.25 + parBreath * 0.16) * edgeUv);
  }

  else if (isVintage) {
    var vintageLocal = index - 291;
    var fixtureNo = floor(vintageLocal / 6.0);
    var lampNo = vintageLocal % 6;

    var vintageTheta = wrap01(fixtureNo / 5.0 + lampNo * 0.017 + spinAmount * 0.22);
    var warmDoor = softPulse(circDist(vintageTheta, doorCenterA), doorRevealWidth * 0.72);
    var warmDoorB = softPulse(circDist(vintageTheta, doorCenterB), doorRevealWidth * 0.60) * 0.55;
    var filament = wave(tBreath * 0.42 + fixtureNo * 0.27 + lampNo * 0.071);

    amber = clamp01((warmDoor + warmDoorB) * (0.12 + filament * 0.18) * doorOpen);
    stage = amber * 0.060;
  }

  var colorMix = clamp01(
    0.14 +
    theta * 0.22 +
    spinTexture * 0.36 +
    doorField * 0.24
  );

  var floorGlow = (1.0 - holdBlackout) * 0.010 * doorOpen;
  var brightness = floorGlow + stage * (0.24 + doorWidth * 0.30);

  if (isVintage) brightness = floorGlow * 0.22 + stage;
  if (isTrianglePar) brightness = floorGlow * 0.16 + stage;

  var r = (pr1 + (pr2 - pr1) * colorMix) * brightness;
  var g = (pg1 + (pg2 - pg1) * colorMix) * brightness;
  var b = (pb1 + (pb2 - pb1) * colorMix) * brightness;

  rgbwau(
    clamp01(r),
    clamp01(g),
    clamp01(b),
    clamp01(white),
    clamp01(amber),
    clamp01(uv)
  );
}