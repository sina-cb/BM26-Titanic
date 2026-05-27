/*
  iceberg_fracture
  Cold branching cracks launched from TriangleEdges into BarLights lanes.
*/

export var localSpeed = 0.5;
export var fractureDensity = 0.46;
export var branchSpread = 0.42;
export var strikeDecay = 0.50;
export var aftershockWarmth = 0.18;
export var laneCount = 0.46;
export var blackoutDepth = 0.74;

export var cp1H = 0.53, cp1S = 0.28, cp1V = 0.70;
export var cp2H = 0.63, cp2S = 0.74, cp2V = 0.58;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderFractureDensity(v) { fractureDensity = v; }
export function sliderBranchSpread(v) { branchSpread = v; }
export function sliderStrikeDecay(v) { strikeDecay = v; }
export function sliderAftershockWarmth(v) { aftershockWarmth = v; }
export function sliderLaneCount(v) { laneCount = v; }
export function sliderBlackoutDepth(v) { blackoutDepth = v; }

var pr1 = 1, pg1 = 0, pb1 = 0;
var pr2 = 0, pg2 = 0, pb2 = 1;
function _hsv2rgb1() { var hv = cp1H - floor(cp1H); if (hv < 0) hv += 1; var iv = floor(hv * 6) % 6; var fv = hv * 6 - floor(hv * 6); var pv = cp1V * (1 - cp1S); var qv = cp1V * (1 - fv * cp1S); var tv = cp1V * (1 - (1 - fv) * cp1S); if (iv == 0) { pr1 = cp1V; pg1 = tv; pb1 = pv; } else if (iv == 1) { pr1 = qv; pg1 = cp1V; pb1 = pv; } else if (iv == 2) { pr1 = pv; pg1 = cp1V; pb1 = tv; } else if (iv == 3) { pr1 = pv; pg1 = qv; pb1 = cp1V; } else if (iv == 4) { pr1 = tv; pg1 = pv; pb1 = cp1V; } else { pr1 = cp1V; pg1 = pv; pb1 = qv; } }
function _hsv2rgb2() { var hv = cp2H - floor(cp2H); if (hv < 0) hv += 1; var iv = floor(hv * 6) % 6; var fv = hv * 6 - floor(hv * 6); var pv = cp2V * (1 - cp2S); var qv = cp2V * (1 - fv * cp2S); var tv = cp2V * (1 - (1 - fv) * cp2S); if (iv == 0) { pr2 = cp2V; pg2 = tv; pb2 = pv; } else if (iv == 1) { pr2 = qv; pg2 = cp2V; pb2 = pv; } else if (iv == 2) { pr2 = pv; pg2 = cp2V; pb2 = tv; } else if (iv == 3) { pr2 = pv; pg2 = qv; pb2 = cp2V; } else if (iv == 4) { pr2 = tv; pg2 = pv; pb2 = cp2V; } else { pr2 = cp2V; pg2 = pv; pb2 = qv; } }
function clamp01(v) { if (v < 0.0) return 0.0; if (v > 1.0) return 1.0; return v; }
function wrap01(v) { v = v % 1.0; if (v < 0.0) v += 1.0; return v; }
function circDist(a, b) { var d = abs(a - b); if (d > 0.5) d = 1.0 - d; return d; }
function softPulse(dist, width) { var xVal = clamp01(1.0 - dist / width); return xVal * xVal * (3.0 - 2.0 * xVal); }

var tStrike = 0.0;
var tBranch = 0.0;
export function beforeRender(delta) {
  var localMult = pow(2.0, (localSpeed - 0.5) * 4.0);
  var dt = (delta / 1310.72) * localMult;
  tStrike = tStrike + dt * (0.18 + fractureDensity * 0.92);
  tBranch = tBranch + dt * (0.36 + branchSpread * 1.25);
  _hsv2rgb1();
  _hsv2rgb2();
}

export function render3D(index, x, y, z) {
  var isTriangleEdge = sectionId == 1;
  var isTrianglePar = sectionId == 2 && y > 2.0;
  var isBar = sectionId == 2 && y <= 2.0;
  var isVintage = sectionId == 3;
  var theta = wrap01((atan2(z, x) / PI2) + 0.5);
  var phase = wrap01(tStrike);
  var impact = softPulse(circDist(phase, 0.0), 0.028 + fractureDensity * 0.050);
  var lanes = floor(4.0 + laneCount * 9.0);
  var lane = pow(wave(theta * lanes + tBranch), 4.5 + branchSpread * 3.0);
  var crackWave = wrap01(phase * 1.45);
  var stage = 0.0, white = 0.0, amber = 0.0, uv = 0.0;

  if (isTriangleEdge) {
    var edgeId = floor(index / 18.0);
    var edgeT = (index % 18) / 17.0;
    var origin = softPulse(circDist(edgeT, wrap01(edgeId * 0.333 + phase)), 0.024 + branchSpread * 0.065);
    var splinter = pow(wave(edgeT * lanes * 0.5 + tBranch + edgeId * 0.27), 5.0);
    stage = (origin + splinter * impact * 0.55) * (0.35 + fractureDensity * 0.72);
    white = origin * impact * (0.55 + strikeDecay * 0.45);
    uv = stage * 0.30;
  } else if (isBar) {
    var barLocal = index - 57;
    var barT = (barLocal % 18) / 17.0;
    var advance = softPulse(abs(barT - crackWave), 0.035 + strikeDecay * 0.105);
    var branch = softPulse(circDist(theta, wrap01(tBranch * 0.37 + barT * branchSpread)), 0.030 + branchSpread * 0.080);
    stage = (advance * lane + branch * impact * 0.72) * (0.30 + fractureDensity * 0.70);
    white = stage * impact * (0.34 + strikeDecay * 0.50);
    uv = stage * (0.28 + branchSpread * 0.40);
  } else if (isTrianglePar) {
    stage = impact * fractureDensity * 0.10;
    white = impact;
    uv = impact * 0.24;
  } else if (isVintage) {
    var vintageLocal = index - 291;
    var delayed = softPulse(circDist(wrap01(phase - 0.30), 0.0), 0.08 + strikeDecay * 0.12);
    amber = delayed * aftershockWarmth * wave(tBranch + vintageLocal * 0.061);
    stage = amber * 0.07;
  }

  var colorMix = clamp01(0.16 + lane * 0.34 + stage * 0.38);
  var brightness = (1.0 - blackoutDepth) * 0.010 + stage * (0.28 + fractureDensity * 0.30);
  var r = (pr1 + (pr2 - pr1) * colorMix) * brightness;
  var g = (pg1 + (pg2 - pg1) * colorMix) * brightness;
  var b = (pb1 + (pb2 - pb1) * colorMix) * brightness;
  rgbwau(clamp01(r), clamp01(g), clamp01(b), clamp01(white), clamp01(amber), clamp01(uv));
}
