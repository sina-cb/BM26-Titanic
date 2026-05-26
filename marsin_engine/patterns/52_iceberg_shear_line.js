/*
  iceberg_shear_line
  A wide ice wall slices through the ring, leaving one side submerged and the
  other side retreating into faint warm memory.
*/

export var localSpeed = 0.5;
export var shearAngle = 0.45;
export var shearWidth = 0.32;
export var advance = 0.54;
export var submergeDepth = 0.68;
export var warmthRetreat = 0.24;
export var triangleBlade = 0.70;

export var cp1H = 0.52, cp1S = 0.26, cp1V = 0.70;
export var cp2H = 0.65, cp2S = 0.86, cp2V = 0.48;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }
export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderShearAngle(v) { shearAngle = v; }
export function sliderShearWidth(v) { shearWidth = v; }
export function sliderAdvance(v) { advance = v; }
export function sliderSubmergeDepth(v) { submergeDepth = v; }
export function sliderWarmthRetreat(v) { warmthRetreat = v; }
export function sliderTriangleBlade(v) { triangleBlade = v; }

var pr1 = 1, pg1 = 0, pb1 = 0;
var pr2 = 0, pg2 = 0, pb2 = 1;
function hsv1() { var hv = cp1H - floor(cp1H); if (hv < 0) hv += 1; var iv = floor(hv * 6) % 6; var fv = hv * 6 - floor(hv * 6); var pv = cp1V * (1 - cp1S); var qv = cp1V * (1 - fv * cp1S); var tv = cp1V * (1 - (1 - fv) * cp1S); if (iv == 0) { pr1 = cp1V; pg1 = tv; pb1 = pv; } else if (iv == 1) { pr1 = qv; pg1 = cp1V; pb1 = pv; } else if (iv == 2) { pr1 = pv; pg1 = cp1V; pb1 = tv; } else if (iv == 3) { pr1 = pv; pg1 = qv; pb1 = cp1V; } else if (iv == 4) { pr1 = tv; pg1 = pv; pb1 = cp1V; } else { pr1 = cp1V; pg1 = pv; pb1 = qv; } }
function hsv2() { var hv = cp2H - floor(cp2H); if (hv < 0) hv += 1; var iv = floor(hv * 6) % 6; var fv = hv * 6 - floor(hv * 6); var pv = cp2V * (1 - cp2S); var qv = cp2V * (1 - fv * cp2S); var tv = cp2V * (1 - (1 - fv) * cp2S); if (iv == 0) { pr2 = cp2V; pg2 = tv; pb2 = pv; } else if (iv == 1) { pr2 = qv; pg2 = cp2V; pb2 = pv; } else if (iv == 2) { pr2 = pv; pg2 = cp2V; pb2 = tv; } else if (iv == 3) { pr2 = pv; pg2 = qv; pb2 = cp2V; } else if (iv == 4) { pr2 = tv; pg2 = pv; pb2 = cp2V; } else { pr2 = cp2V; pg2 = pv; pb2 = qv; } }
function clamp01(v) { if (v < 0.0) return 0.0; if (v > 1.0) return 1.0; return v; }
function wrap01(v) { v = v % 1.0; if (v < 0.0) v += 1.0; return v; }
function circDist(a, b) { var d = abs(a - b); if (d > 0.5) d = 1.0 - d; return d; }
function softPulse(dist, width) { var px = clamp01(1.0 - dist / width); return px * px * (3.0 - 2.0 * px); }

var shearPhase = 0.0;
var splinterPhase = 0.0;
export function beforeRender(delta) {
  var localMult = pow(2.0, (localSpeed - 0.5) * 4.0);
  var dt = (delta / 1310.72) * localMult;
  shearPhase = shearPhase + dt * (0.12 + advance * 0.90);
  splinterPhase = splinterPhase + dt * (0.32 + triangleBlade * 0.72);
  hsv1(); hsv2();
}

export function render3D(index, x, y, z) {
  var isEdge = sectionId == 1;
  var isPar = sectionId == 2 && y > 2.0;
  var isBar = sectionId == 2 && y <= 2.0;
  var isVintage = sectionId == 3;
  var theta = wrap01((atan2(z, x) / PI2) + 0.5);
  var blade = wrap01(shearPhase + shearAngle * 0.42 + (wave(splinterPhase * 0.33) - 0.5) * 0.08);
  var width = 0.012 + shearWidth * 0.120;
  var dist = circDist(theta, blade);
  var edge = softPulse(dist, width);
  var iceSide = dist < (0.22 + shearWidth * 0.16) ? 1.0 : 0.0;
  var stage = 0.0, white = 0.0, amber = 0.0, uv = 0.0;

  if (isBar) {
    var barT = ((index - 57) % 18) / 17.0;
    var verticalCrack = softPulse(abs(barT - wrap01(shearPhase * 1.38 + theta * 0.20)), 0.030 + shearWidth * 0.060);
    var splinter = pow(wave(theta * 11.0 + barT * 3.0 + splinterPhase), 6.0);
    stage = edge * (0.40 + triangleBlade * 0.28) + verticalCrack * splinter * 0.35;
    stage = stage * (0.32 + submergeDepth * 0.44);
    white = edge * triangleBlade + verticalCrack * splinter * 0.28;
    uv = iceSide * submergeDepth * 0.12 + edge * 0.38;
  } else if (isEdge) {
    var edgeId = floor(index / 18.0);
    var edgeT = (index % 18) / 17.0;
    var bladeLine = softPulse(circDist(edgeT, wrap01(shearPhase * 1.15 + edgeId * 0.333)), 0.022 + shearWidth * 0.075);
    var crackLine = pow(wave(edgeT * 4.0 - splinterPhase + edgeId * 0.41), 7.0);
    stage = (bladeLine + crackLine * edge * 0.35) * (0.35 + triangleBlade * 0.70);
    white = bladeLine * triangleBlade;
    uv = crackLine * 0.20;
  } else if (isPar) {
    stage = edge * triangleBlade * 0.075;
    white = edge * triangleBlade;
    uv = edge * 0.25;
  } else if (isVintage) {
    amber = (1.0 - iceSide) * warmthRetreat * 0.14 * wave(splinterPhase * 0.7 + index * 0.047);
    stage = amber * 0.065;
  }

  var mixv = clamp01(iceSide * 0.72 + edge * 0.25);
  var bri = (1.0 - submergeDepth) * 0.010 + stage;
  rgbwau(
    clamp01((pr1 + (pr2 - pr1) * mixv) * bri),
    clamp01((pg1 + (pg2 - pg1) * mixv) * bri),
    clamp01((pb1 + (pb2 - pb1) * mixv) * bri),
    clamp01(white), clamp01(amber), clamp01(uv)
  );
}
