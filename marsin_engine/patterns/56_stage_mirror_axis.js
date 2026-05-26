/*
  stage_mirror_axis
  Mirror-symmetric stage-axis pattern for Summer Camp Dome.
  center maps 0..1 to 0..360 degrees. Set it toward the stage; the pattern
  builds mirrored motion on both sides of that axis.
*/

export var localSpeed = 0.5;
export var center = 0.0;
export var mirrorWidth = 0.32;
export var orbitSpeed = 0.42;
export var particleDensity = 0.36;
export var stageFocus = 0.64;
export var blackoutDepth = 0.74;
export var uvEdge = 0.32;
export var centerGuide = 0.0;

export var cp1H = 0.56, cp1S = 0.84, cp1V = 0.52;
export var cp2H = 0.80, cp2S = 0.70, cp2V = 0.46;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderCenter(v) { center = v; }
export function sliderMirrorWidth(v) { mirrorWidth = v; }
export function sliderOrbitSpeed(v) { orbitSpeed = v; }
export function sliderParticleDensity(v) { particleDensity = v; }
export function sliderStageFocus(v) { stageFocus = v; }
export function sliderBlackoutDepth(v) { blackoutDepth = v; }
export function sliderUvEdge(v) { uvEdge = v; }
export function sliderCenterGuide(v) { centerGuide = v; }

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

var orbitPhase = 0.0;
var sparklePhase = 0.0;

export function beforeRender(delta) {
  var localMult = pow(2.0, (localSpeed - 0.5) * 4.0);
  var dt = (delta / 1310.72) * localMult;
  orbitPhase = orbitPhase + dt * (0.14 + orbitSpeed * 0.92);
  sparklePhase = sparklePhase + dt * (0.62 + particleDensity * 1.80);
  hsv1(); hsv2();
}

export function render3D(index, x, y, z) {
  var isEdge = sectionId == 1;
  var isPar = sectionId == 2 && y > 2.0;
  var isBar = sectionId == 2 && y <= 2.0;
  var isVintage = sectionId == 3;

  var theta = wrap01((atan2(z, x) / PI2) + 0.5);
  var axis = wrap01(center);
  var mirroredTheta = circDist(theta, axis) * 2.0;
  var width = 0.014 + mirrorWidth * 0.115;
  var outward = wrap01(orbitPhase);
  var inward = wrap01(1.0 - orbitPhase * 0.63);
  var beamA = softPulse(circDist(mirroredTheta, outward), width);
  var beamB = softPulse(circDist(mirroredTheta, inward), width * 0.70) * 0.70;
  var axisLine = softPulse(circDist(theta, axis), 0.008 + stageFocus * 0.030);
  var oppositeLine = softPulse(circDist(theta, wrap01(axis + 0.5)), 0.006 + mirrorWidth * 0.022) * 0.45;
  var particle = pow(wave(mirroredTheta * (7.0 + particleDensity * 18.0) + sparklePhase + index * 0.017), 7.0 - particleDensity * 3.0);

  var stage = 0.0, white = 0.0, amber = 0.0, uv = 0.0;

  if (isBar) {
    var barT = ((index - 57) % 18) / 17.0;
    var vertical = wave(barT * 1.35 - orbitPhase * 1.7 + mirroredTheta * 0.22);
    stage = (beamA + beamB + particle * particleDensity * 0.35) * (0.30 + vertical * 0.70);
    stage = stage + axisLine * stageFocus * 0.42 + oppositeLine * 0.20;
    white = axisLine * stageFocus * 0.55 + beamA * 0.22;
    uv = (beamB + particle * 0.20 + oppositeLine) * uvEdge;
  } else if (isEdge) {
    var edgeId = floor(index / 18.0);
    var edgeT = (index % 18) / 17.0;
    var mirroredEdge = circDist(edgeT, edgeId * 0.333) * 2.0;
    var core = softPulse(circDist(mirroredEdge, wrap01(orbitPhase * 0.82)), 0.030 + stageFocus * 0.075);
    stage = core * (0.34 + stageFocus * 0.74) + axisLine * 0.14;
    white = core * stageFocus;
    uv = core * uvEdge * 0.20;
  } else if (isPar) {
    var hit = pow(wave(sparklePhase + index * 0.31), 9.0);
    stage = (axisLine + hit * 0.35) * stageFocus * 0.085;
    white = clamp01(axisLine * stageFocus + hit * stageFocus * 0.42);
    uv = axisLine * uvEdge * 0.25;
  } else if (isVintage) {
    amber = (beamA + beamB) * 0.10 * wave(sparklePhase * 0.45 + index * 0.047);
    stage = amber * 0.08;
  }

  var darkFloor = (1.0 - blackoutDepth) * 0.010;
  var mixv = clamp01(0.14 + mirroredTheta * 0.38 + particle * 0.34 + axisLine * 0.22);
  var bri = darkFloor + stage * (0.28 + stageFocus * 0.18);
  var guide = circDist(theta, axis) < 0.05 ? centerGuide : 0.0;
  var outR = clamp01((pr1 + (pr2 - pr1) * mixv) * bri);
  var outG = clamp01((pg1 + (pg2 - pg1) * mixv) * bri);
  var outB = clamp01((pb1 + (pb2 - pb1) * mixv) * bri);
  if (guide > outR) outR = guide;
  if (guide > outG) outG = guide;
  if (guide > outB) outB = guide;
  if (guide > white) white = guide;
  rgbwau(
    outR,
    outG,
    outB,
    clamp01(white),
    clamp01(amber),
    clamp01(uv)
  );
}
