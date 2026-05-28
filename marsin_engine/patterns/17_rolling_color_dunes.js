/*
  17_rolling_color_dunes.js
  Summer Camp Dome tune: quasi-crystal dunes across the physical dome,
  with TriangleEdges as surf lines and sparse Vintage warmth.
*/

export var localSpeed = 0.5;
export var duneScale = 0.42;
export var duneContrast = 0.48;
export var orbitDrift = 0.36;
export var blackoutDepth = 0.35;
export var stageSurf = 0.70;
export var amberWarmth = 0.40;

export var cp1H = 0.08, cp1S = 0.88, cp1V = 0.78;
export var cp2H = 0.47, cp2S = 0.88, cp2V = 0.72;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderDuneScale(v) { duneScale = v; }
export function sliderDuneContrast(v) { duneContrast = v; }
export function sliderOrbitDrift(v) { orbitDrift = v; }
export function sliderBlackoutDepth(v) { blackoutDepth = v; }
export function sliderStageSurf(v) { stageSurf = v; }
export function sliderAmberWarmth(v) { amberWarmth = v; }

var pr1 = 1, pg1 = 0, pb1 = 0;
var pr2 = 0, pg2 = 0, pb2 = 1;

function hsv1() {
  var hv = cp1H - floor(cp1H); if (hv < 0.0) hv += 1.0;
  var iv = floor(hv * 6.0) % 6;
  var fv = hv * 6.0 - floor(hv * 6.0);
  var pv = cp1V * (1.0 - cp1S);
  var qv = cp1V * (1.0 - fv * cp1S);
  var tv = cp1V * (1.0 - (1.0 - fv) * cp1S);
  if (iv == 0) { pr1 = cp1V; pg1 = tv; pb1 = pv; }
  else if (iv == 1) { pr1 = qv; pg1 = cp1V; pb1 = pv; }
  else if (iv == 2) { pr1 = pv; pg1 = cp1V; pb1 = tv; }
  else if (iv == 3) { pr1 = pv; pg1 = qv; pb1 = cp1V; }
  else if (iv == 4) { pr1 = tv; pg1 = pv; pb1 = cp1V; }
  else { pr1 = cp1V; pg1 = pv; pb1 = qv; }
}

function hsv2() {
  var hv = cp2H - floor(cp2H); if (hv < 0.0) hv += 1.0;
  var iv = floor(hv * 6.0) % 6;
  var fv = hv * 6.0 - floor(hv * 6.0);
  var pv = cp2V * (1.0 - cp2S);
  var qv = cp2V * (1.0 - fv * cp2S);
  var tv = cp2V * (1.0 - (1.0 - fv) * cp2S);
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
  var px = clamp01(1.0 - dist / width);
  return px * px * (3.0 - 2.0 * px);
}

var rollPhase = 0.0;
var driftPhase = 0.0;
var shimmerPhase = 0.0;

export function beforeRender(delta) {
  var localMult = pow(2.0, (localSpeed - 0.5) * 4.0);
  var dt = (delta / 1310.72) * localMult;
  rollPhase = rollPhase + dt * (0.12 + orbitDrift * 0.80);
  driftPhase = driftPhase + dt * (0.045 + duneScale * 0.22);
  shimmerPhase = shimmerPhase + dt * (0.34 + stageSurf * 0.92);
  hsv1(); hsv2();
}

export function render3D(index, x, y, z) {
  var isEdge = sectionId == 1;
  var isPar = sectionId == 2 && y > 2.0;
  var isBar = sectionId == 2 && y <= 2.0;
  var isVintage = sectionId == 3;

  var nx = clamp01((x + 10.0) / 20.0);
  var ny = clamp01(y / 6.8);
  var nz = clamp01((z + 10.0) / 20.0);
  var scale = 2.0 + duneScale * 8.0;

  var shearA = wave(nx * 1.37 - nz * 0.83 + driftPhase * 0.71);
  var shearB = wave(nz * 1.11 + ny * 0.47 - rollPhase * 0.39);
  var foldX = nx + (shearA - 0.5) * (0.10 + duneScale * 0.18);
  var foldZ = nz + (shearB - 0.5) * (0.08 + orbitDrift * 0.16);

  var contourA = wave(foldX * scale + foldZ * scale * 0.618 - rollPhase);
  var contourB = wave(foldX * scale * 1.414 - foldZ * scale * 0.731 + driftPhase * 1.37 + ny * 0.29);
  var contourC = wave((foldX - foldZ) * scale * 0.913 + wave(ny * 1.7 + driftPhase) * 0.23 - rollPhase * 0.43);
  var contourD = wave(sqrt(abs(foldX - 0.5) * 1.7 + abs(foldZ - 0.5) * 1.1) * scale * 1.9 - driftPhase * 2.3);
  var dune = contourA * 0.38 + contourB * 0.27 + contourC * 0.22 + contourD * 0.13;
  dune = pow(clamp01(dune), 1.1 + duneContrast * 4.2);

  var valley = pow(wave(foldX * 5.0 - foldZ * 7.0 + ny * 1.13 + driftPhase * 0.7), 2.0 + blackoutDepth * 4.0);
  var shardGate = pow(wave(foldX * 11.0 + foldZ * 17.0 - rollPhase * 0.83), 5.0);
  var stage = 0.0, white = 0.0, amber = 0.0, uv = 0.0;

  if (isBar) {
    var barT = ((index - 57) % 18) / 17.0;
    var barIndex = floor((index - 57) / 18.0);
    var sandRipple = wave(barT * 1.45 - rollPhase * 1.9 + barIndex * 0.137 + shearA * 0.31);
    var brokenLane = pow(wave(barIndex * 0.271 + barT * 2.3 + driftPhase * 1.61), 3.8);
    stage = dune * (0.30 + sandRipple * 0.50 + brokenLane * 0.32);
    stage = stage * (1.0 - valley * blackoutDepth * 0.55);
    stage = stage * (0.65 + shardGate * 0.35);
    uv = pow(stage, 2.0) * 0.20;
  } else if (isEdge) {
    var edgeId = floor(index / 18.0);
    var edgeT = (index % 18) / 17.0;
    var surfA = softPulse(circDist(edgeT, wrap01(rollPhase * 0.52 + wave(driftPhase + edgeId * 0.17) * 0.23 + edgeId * 0.333)), 0.040 + stageSurf * 0.080);
    var surfB = softPulse(circDist(edgeT, wrap01(1.0 - driftPhase * 1.8 + edgeId * 0.19 + contourB * 0.10)), 0.026 + duneScale * 0.060) * 0.52;
    stage = clamp01((surfA + surfB) * (0.45 + stageSurf * 0.55));
    white = surfA * stageSurf * 0.42;
    uv = surfB * 0.24;
  } else if (isPar) {
    var parHit = pow(wave(shimmerPhase + index * 0.27), 7.0);
    stage = (0.08 + parHit * 0.92) * (0.22 + stageSurf * 0.55);
    white = parHit * stageSurf * 0.45;
  } else if (isVintage) {
    var vintageLocal = index - 291;
    var ember = wave(shimmerPhase * 0.47 + vintageLocal * 0.059);
    var bank = softPulse(circDist(wrap01(floor(vintageLocal / 6.0) / 5.0), wrap01(driftPhase * 0.38)), 0.11 + duneScale * 0.08);
    amber = (0.060 + bank * ember * 0.50) * amberWarmth;
    stage = amber * 0.30;
  }

  var colorBlend = clamp01(0.14 + contourB * 0.28 + contourC * 0.22 + contourD * 0.18 + foldX * 0.10 + dune * 0.26);
  var darkFloor = (1.0 - blackoutDepth) * 0.045;
  var brightness = darkFloor + stage * (0.55 + duneContrast * 0.45);
  if (isVintage) brightness = darkFloor * 0.35 + stage;
  if (isPar) brightness = darkFloor * 0.20 + stage;

  var r = (pr1 + (pr2 - pr1) * colorBlend) * brightness;
  var g = (pg1 + (pg2 - pg1) * colorBlend) * brightness;
  var b = (pb1 + (pb2 - pb1) * colorBlend) * brightness;

  rgbwau(clamp01(r), clamp01(g), clamp01(b), clamp01(white), clamp01(amber), clamp01(uv));
}
