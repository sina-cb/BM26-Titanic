/*
  ghost_ship_reveal
  Multi-stage reveal:
  - TriangleEdges: three lanterns swinging on unique phases (edgeId/3.0).
  - TrianglePars: ghost mast lights — slow par-by-par glow rotation (Rule 2 active).
  - BarLights: hull silhouette dark band drifting around the ring, with
    bright "window light" port pulses chasing along each bar (Rule 3 art).
  - VintageLights: sparse amber lanterns waking from mist.
  - Subtle moonlight wash so the rig never goes fully dark (Rule 4).

  Enhancements (D3 push):
  - 1-1-1 per-edge swinging lanterns.
  - Active mast pars with par-by-par glow walk.
  - Hull silhouette band + window-port chasers on bars.
  - Moonlight floor.
*/

export var localSpeed = 0.5;
export var revealWidth = 0.45;
export var orbitDrift = 0.50;
export var blackoutDepth = 0.30;
export var lanternGlow = 0.55;
export var beaconSparkle = 0.32;
export var uvTrail = 0.45;
export var spinMotion = 0.55;
export var hullDarkness = 0.55;
export var portBrightness = 0.60;

export var cp1H = 0.60, cp1S = 0.85, cp1V = 0.78;
export var cp2H = 0.72, cp2S = 0.78, cp2V = 0.68;
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
export function sliderHullDarkness(v) { hullDarkness = v; }
export function sliderPortBrightness(v) { portBrightness = v; }

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
var tMast = 0.0;
var tPort = 0.0;
var tMoon = 0.0;

export function beforeRender(delta) {
  var localMult = pow(2.0, (localSpeed - 0.5) * 4.0);
  var dt = (delta / 1310.72) * localMult;

  tOrbit = tOrbit + dt * (0.22 + orbitDrift * 1.10);
  tFlicker = tFlicker + dt * (0.55 + lanternGlow * 1.15);
  tSlow = tSlow + dt * 0.19;
  tSpin = tSpin + dt * (0.18 + orbitDrift * 0.55 + spinMotion * 0.85);
  // Slower mast par walk + port chaser.
  tMast = tMast + dt * (0.12 + lanternGlow * 0.35);
  tPort = tPort + dt * (0.40 + portBrightness * 0.85);
  tMoon = tMoon + dt * 0.07;

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

  // Moonlight wash (always present, soft, low frequency).
  var moonWash = 0.10 + 0.08 * wave(tMoon + theta * 0.7);

  // TriangleEdges: three swinging lanterns, one per edge, at edgeId/3.0 phase.
  // KEY GESTURE: per-edge unique phase (Rule 1) — independent lantern swing.
  var edgeStage = 0.0;
  var edgeWhite = 0.0;

  if (isTriangleEdge) {
    var edgeId = floor(index / 18.0);
    var edgeT = (index % 18) / 17.0;

    // Swing center oscillates along the edge for each lantern.
    var swingCenter = 0.5 + 0.35 * wave(tFlicker * 0.55 + edgeId / 3.0);
    var lanternWidth = 0.060 + revealWidth * 0.140;
    var lantern = softPulse(abs(edgeT - swingCenter), lanternWidth);

    // Secondary slow sweep so edges have layered motion.
    var sweepA = wrap01(tSlow * 1.70 + edgeId / 3.0);
    var edgeSweep = softPulse(circDist(edgeT, sweepA), 0.05 + revealWidth * 0.12) * 0.50;

    var mastBreath = 0.08 + 0.06 * wave(tSlow * 0.83 + edgeId * 0.19);

    edgeStage = clamp01(mastBreath + lantern * (0.55 + lanternGlow * 0.55) + edgeSweep + spinEnergy * (0.16 + spinMotion * 0.28));
    edgeWhite = clamp01(lantern * 0.55 + edgeSweep * 0.22 + spinEnergy * 0.32);
  }

  // BarLights: hull silhouette = dark band drifting around the ring; bright
  // "window port" light pulses chasing along each bar pixel-by-pixel.
  // KEY GESTURE: dark hull band + travelling port lights (Rule 3 pixel art).
  var ringStage = 0.0;
  var ringUv = 0.0;

  if (isBar) {
    var barLocal = index - 57;
    var barIdx = floor(barLocal / 18.0);
    var barT = (barLocal % 18) / 17.0;

    // Hull silhouette: a wide dark band travels around the ring.
    var hullCenter = wrap01(tOrbit * 0.42);
    var hullBand = softPulse(circDist(theta, hullCenter), 0.10 + revealWidth * 0.10);
    var hullMask = 1.0 - hullBand * hullDarkness;

    // Window ports: travelling bright pulses along each bar, with per-bar offset.
    var portPos = wrap01(tPort + barIdx * 0.087);
    var portPulse = softPulse(abs(barT - portPos), 0.06 + revealWidth * 0.08);
    var portPos2 = wrap01(tPort * 0.62 + barIdx * 0.137 + 0.41);
    var portPulse2 = softPulse(abs(barT - portPos2), 0.05 + revealWidth * 0.06) * 0.70;

    // Multi-arm circular sweeps for layered motion.
    var armA = spinEnergy;
    var armB = softPulse(circDist(theta, wrap01(tSpin + 0.333)), (0.018 + revealWidth * 0.165) * 1.35) * 0.36;
    var armC = softPulse(circDist(theta, wrap01(tSlow * 1.31 + 0.68)), (0.018 + revealWidth * 0.165) * 0.72) * 0.24;

    var sweepArm = armA;
    if (armB > sweepArm) sweepArm = armB;
    if (armC > sweepArm) sweepArm = armC;

    var barTrace = wave(barT * 1.15 - tSlow * 1.15 + barIdx * 0.037);

    // Compose: hull-masked base + sweeps + window ports (the ports punch
    // through even on dark band, like ship cabins).
    var base = moonWash + sweepArm * (0.45 + 0.40 * barTrace);
    base = base * hullMask;
    var ports = (portPulse + portPulse2) * portBrightness * (0.60 + 0.40 * barTrace);
    ringStage = clamp01(base + ports);

    ringUv = clamp01((armA * 0.55 + armB * 0.30 + ports * 0.45) * (0.55 + barTrace * 0.45));
  }

  // VintageLights: sparse amber lantern clusters.
  var lanternVal = 0.0;

  if (isVintage) {
    var vintageLocal = index - 291;
    var fixtureNo = floor(vintageLocal / 6.0);
    var lampNo = vintageLocal % 6;

    var fixtureGate = softPulse(
      circDist(wrap01(tSlow * 0.46 + fixtureNo * 0.173), 0.5),
      0.13 + revealWidth * 0.11
    );

    var ember = 0.030 + (1.0 - blackoutDepth) * 0.060;

    var flameA = wave(tFlicker * 0.85 + fixtureNo * 0.31 + lampNo * 0.071);
    var flameB = wave(tFlicker * 1.65 + fixtureNo * 0.17 + lampNo * 0.113);

    var verticalLift = 0.62 + 0.38 * (lampNo / 5.0);

    lanternVal = (ember + fixtureGate * (0.48 + 0.30 * flameA + 0.12 * flameB)) * verticalLift;
    lanternVal = lanternVal + spinEnergy * lanternGlow * 0.04;
  }

  // TrianglePars: ghost mast lights — a slow glow that walks par-by-par.
  // PARS ACTIVE (Rule 2). Each par has a slow fade-in window when the walk
  // reaches it, plus a low halo.
  var parVal = 0.0;

  if (isTrianglePar) {
    var parId = index - 54;
    // Slow walker (cycles through pars 0->1->2->...).
    var walker = wrap01(tMast);
    var parSlot = parId / 3.0;
    var mastGlow = softPulse(circDist(walker, parSlot), 0.18);
    // Also flare when the spin beam aligns with this par's cardinal.
    var spinAlign = softPulse(circDist(spinHead, parSlot), 0.10);
    // Halo so pars are never fully off.
    var parHalo = 0.10 + 0.08 * wave(tMast * 1.4 + parId * 0.41);
    parVal = clamp01(parHalo + mastGlow * (0.55 + lanternGlow * 0.55) + spinAlign * beaconSparkle * 0.55);
  }

  var revealFactor = 0.0;

  if (isTriangleEdge) revealFactor = edgeStage;
  else if (isBar) revealFactor = ringStage;
  else if (isTrianglePar) revealFactor = parVal;
  else if (isVintage) revealFactor = lanternVal;

  var pressureWake = wave(theta * 0.71 + y * 0.29 - tSlow * 1.37);
  var ghostLace = wave(x * 0.17 - z * 0.13 + tSlow * 0.59);

  var colorMix = clamp01(0.18 + pressureWake * 0.50 + ghostLace * 0.30);

  var baseR = pr1 + (pr2 - pr1) * colorMix;
  var baseG = pg1 + (pg2 - pg1) * colorMix;
  var baseB = pb1 + (pb2 - pb1) * colorMix;

  var mistPhase = wrap01(theta + y * 0.19 + ghostLace * 0.035);
  var mistGate = softPulse(
    circDist(mistPhase, wrap01(tSlow * 0.43 + 0.11)),
    0.012 + (1.0 - blackoutDepth) * 0.045
  );

  var bgGlow = mistGate * (1.0 - blackoutDepth) * 0.060 + (1.0 - blackoutDepth) * 0.020;

  var bri = bgGlow + revealFactor * (0.32 + revealWidth * 0.30);

  if (isVintage) bri = bgGlow * 0.45 + lanternVal * 0.10;
  if (isTrianglePar) bri = bgGlow * 0.40 + parVal * 0.12;

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
