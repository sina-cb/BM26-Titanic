/*
  ghost_ship_reveal
  Dark-to-structure reveal for Summer Camp Dome.

  TriangleEdges are the stage scanner; BarLights open as circular windows;
  Vintage lamps wake in sparse amber clusters.

  Revised:
  - Removed strobe-like threshold sparkle gates.
  - Added smooth circular spin motion around theta.
*/

export var localSpeed = 0.5;
export var revealWidth = 0.4;
export var orbitDrift = 0.5;
export var blackoutDepth = 0.7;
export var lanternGlow = 0.3;
export var beaconSparkle = 0.2;
export var uvTrail = 0.5;
export var spinMotion = 0.55;

export var cp1H = 0.62, cp1S = 0.9, cp1V = 0.35;
export var cp2H = 0.72, cp2S = 0.8, cp2V = 0.25;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderRevealWidth(v) { revealWidth = v; }
export function sliderOrbitDrift(v) { orbitDrift = v; }
export function sliderBlackoutDepth(v) { blackoutDepth = v; }
export function sliderLanternGlow(v) { lanternGlow = v; }
export function sliderBeaconSparkle(v) { beaconSparkle = v; }
export function sliderUvTrail(v) { uvTrail = v; }
export function sliderSpinMotion(v) { spinMotion = v; }

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

var tOrbit = 0.0;
var tFlicker = 0.0;
var tSlow = 0.0;
var tSpin = 0.0;

export function beforeRender(delta) {
  var localMult = pow(2.0, (localSpeed - 0.5) * 4.0);
  var dt = (delta / 1310.72) * localMult;

  tOrbit = tOrbit + dt * (0.22 + orbitDrift * 1.10);

  // Slower, softer lantern movement. Less twitchy than the old flicker.
  tFlicker = tFlicker + dt * (0.55 + lanternGlow * 1.15);

  tSlow = tSlow + dt * 0.19;

  // Smooth circular rotation driver.
  tSpin = tSpin + dt * (0.18 + orbitDrift * 0.55 + spinMotion * 0.85);

  _hsv2rgb1();
  _hsv2rgb2();
}

export function render3D(index, x, y, z) {
  var isTriangleEdge = (viewMask & 1) != 0;
  var isTrianglePar = (viewMask & 2) != 0;
  var isBar = (viewMask & 4) != 0;
  var isVintage = (viewMask & 8) != 0;
  var isApex = isTriangleEdge || isTrianglePar;

  var dx = x - 0.5;
  var dz = z - 0.5;
  var theta = wrap01((atan2(dz, dx) / PI2) + 0.5);

  // Shared smooth spinning beam around the full structure.
  var spinHead = wrap01(tSpin);
  var spinTail = wrap01(tSpin - 0.085);
  var spinWide = 0.035 + revealWidth * 0.18;

  var spinCore = softPulse(circDist(theta, spinHead), spinWide);
  var spinTrail = softPulse(circDist(theta, spinTail), spinWide * 2.15) * 0.38;
  var spinEnergy = clamp01(spinCore + spinTrail);

  // TriangleEdges: edge-local scanners plus smooth circular sweep influence.
  var edgeStage = 0.0;
  var edgeWhite = 0.0;

  if (isTriangleEdge) {
    var edgeId = floor(index / 18.0);
    var edgeT = (index % 18) / 17.0;

    var edgeA = wrap01(tSlow * 1.70 + edgeId * 0.333 + wave(tOrbit * 0.23 + edgeId * 0.17) * 0.10);
    var edgeB = wrap01(1.0 - tOrbit * 0.73 + edgeId * 0.271);
    var edgeWidth = 0.045 + revealWidth * 0.135;

    var edgeSweepA = softPulse(circDist(edgeT, edgeA), edgeWidth);
    var edgeSweepB = softPulse(circDist(edgeT, edgeB), edgeWidth * 0.62) * 0.42;
    var mastBreath = wave(tSlow * 0.83 + edgeId * 0.19) * 0.12;

    edgeStage = edgeSweepA;
    if (edgeSweepB > edgeStage) edgeStage = edgeSweepB;

    edgeStage = clamp01(edgeStage + mastBreath + spinEnergy * (0.18 + spinMotion * 0.32));
    edgeWhite = clamp01(edgeSweepA * 0.24 + edgeSweepB * 0.16 + spinEnergy * 0.42);
  }

  // BarLights: smooth orbiting reveal window around the circular perimeter.
  var ringStage = 0.0;
  var ringUv = 0.0;

  if (isBar) {
    var barLocal = index - 57;
    var barIndex = floor(barLocal / 18.0);
    var barT = (barLocal % 18) / 17.0;

    var ringWidth = 0.018 + revealWidth * 0.165;

    var armA = spinEnergy;
    var armB = softPulse(circDist(theta, wrap01(tSpin + 0.333)), ringWidth * 1.35) * 0.36;
    var armC = softPulse(circDist(theta, wrap01(tSlow * 1.31 + 0.68)), ringWidth * 0.72) * 0.24;

    var barTrace = wave(barT * 1.15 - tSlow * 1.15 + barIndex * 0.037);

    ringStage = armA;
    if (armB > ringStage) ringStage = armB;
    if (armC > ringStage) ringStage = armC;

    ringStage = ringStage * (0.50 + 0.50 * barTrace);

    ringUv = clamp01((armA * 0.70 + armB * 0.32 + armC * 0.18) * (0.55 + barTrace * 0.45));
  }

  // VintageLights: sparse amber lantern clusters, softened.
  var lanternVal = 0.0;

  if (isVintage) {
    var vintageLocal = index - 291;
    var fixtureNo = floor(vintageLocal / 6.0);
    var lampNo = vintageLocal % 6;

    var fixtureGate = softPulse(
      circDist(wrap01(tSlow * 0.46 + fixtureNo * 0.173), 0.5),
      0.13 + revealWidth * 0.11
    );

    var ember = 0.020 + (1.0 - blackoutDepth) * 0.050;

    // Soft flame movement, not strobe.
    var flameA = wave(tFlicker * 0.85 + fixtureNo * 0.31 + lampNo * 0.071);
    var flameB = wave(tFlicker * 1.65 + fixtureNo * 0.17 + lampNo * 0.113);

    var verticalLift = 0.62 + 0.38 * (lampNo / 5.0);

    lanternVal = (ember + fixtureGate * (0.46 + 0.30 * flameA + 0.12 * flameB)) * verticalLift;
    lanternVal = lanternVal + spinEnergy * lanternGlow * 0.035;
  }

  // TrianglePars: no threshold pop; now smooth masthead spin punctuation.
  var parVal = 0.0;

  if (isTrianglePar) {
    var parLocalWave = wave(theta * 1.0 - tSpin + index * 0.041);
    parVal = clamp01((spinEnergy * 0.78 + parLocalWave * 0.16) * (0.22 + beaconSparkle * 0.78));
  }

  var revealFactor = 0.0;

  if (isTriangleEdge) revealFactor = edgeStage;
  else if (isBar) revealFactor = ringStage;
  else if (isTrianglePar) revealFactor = parVal;
  else if (isVintage) revealFactor = lanternVal;

  var pressureWake = wave(theta * 0.71 + y * 0.29 - tSlow * 1.37);
  var ghostLace = wave(x * 0.17 - z * 0.13 + tSlow * 0.59);

  var colorMix = clamp01(0.18 + pressureWake * 0.52 + ghostLace * 0.30);

  var baseR = pr1 + (pr2 - pr1) * colorMix;
  var baseG = pg1 + (pg2 - pg1) * colorMix;
  var baseB = pb1 + (pb2 - pb1) * colorMix;

  var mistPhase = wrap01(theta + y * 0.19 + ghostLace * 0.035);
  var mistGate = softPulse(
    circDist(mistPhase, wrap01(tSlow * 0.43 + 0.11)),
    0.012 + (1.0 - blackoutDepth) * 0.045
  );

  var bgGlow = mistGate * (1.0 - blackoutDepth) * 0.045;

  var bri = bgGlow + revealFactor * (0.22 + revealWidth * 0.28);

  if (isVintage) bri = bgGlow * 0.35 + lanternVal * 0.08;
  if (isTrianglePar) bri = bgGlow * 0.25 + parVal * 0.10;

  var r = baseR * bri;
  var g = baseG * bri;
  var b = baseB * bri;

  var uvWake = pow(clamp01(pressureWake), 2.0 + (1.0 - uvTrail) * 3.5);

  var u = uvTrail * clamp01(
    ringUv * 0.78 +
    edgeStage * 0.38 +
    parVal * 0.28 +
    uvWake * revealFactor * 0.18 +
    spinEnergy * 0.35
  );

  // Smooth white accent. No glint threshold, no flashing.
  var w = isApex
    ? clamp01(beaconSparkle * (edgeWhite * 0.72 + parVal * 0.55 + spinEnergy * 0.45))
    : 0.0;

  var a = isVintage ? clamp01(lanternGlow * lanternVal * 0.95) : 0.0;

  rgbwau(
    clamp01(r),
    clamp01(g),
    clamp01(b),
    clamp01(w),
    clamp01(a),
    clamp01(u)
  );
}