/*
  boiler_pressure_release
  Cyclic pressure build, vent burst, and cooling afterglow.
*/

export var localSpeed = 0.5;
export var pressure = 0.46;
export var releaseThreshold = 0.72;
export var ventWidth = 0.36;
export var heatBloom = 0.48;
export var ventFlash = 0.36;
export var coolingAfterglow = 0.58;

export var cp1H = 0.02, cp1S = 1.0, cp1V = 0.70;
export var cp2H = 0.13, cp2S = 0.92, cp2V = 0.48;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderPressure(v) { pressure = v; }
export function sliderReleaseThreshold(v) { releaseThreshold = v; }
export function sliderVentWidth(v) { ventWidth = v; }
export function sliderHeatBloom(v) { heatBloom = v; }
export function sliderVentFlash(v) { ventFlash = v; }
export function sliderCoolingAfterglow(v) { coolingAfterglow = v; }

var pr1 = 1, pg1 = 0, pb1 = 0;
var pr2 = 0, pg2 = 0, pb2 = 1;
function _hsv2rgb1() { var hv = cp1H - floor(cp1H); if (hv < 0) hv += 1; var iv = floor(hv * 6) % 6; var fv = hv * 6 - floor(hv * 6); var pv = cp1V * (1 - cp1S); var qv = cp1V * (1 - fv * cp1S); var tv = cp1V * (1 - (1 - fv) * cp1S); if (iv == 0) { pr1 = cp1V; pg1 = tv; pb1 = pv; } else if (iv == 1) { pr1 = qv; pg1 = cp1V; pb1 = pv; } else if (iv == 2) { pr1 = pv; pg1 = cp1V; pb1 = tv; } else if (iv == 3) { pr1 = pv; pg1 = qv; pb1 = cp1V; } else if (iv == 4) { pr1 = tv; pg1 = pv; pb1 = cp1V; } else { pr1 = cp1V; pg1 = pv; pb1 = qv; } }
function _hsv2rgb2() { var hv = cp2H - floor(cp2H); if (hv < 0) hv += 1; var iv = floor(hv * 6) % 6; var fv = hv * 6 - floor(hv * 6); var pv = cp2V * (1 - cp2S); var qv = cp2V * (1 - fv * cp2S); var tv = cp2V * (1 - (1 - fv) * cp2S); if (iv == 0) { pr2 = cp2V; pg2 = tv; pb2 = pv; } else if (iv == 1) { pr2 = qv; pg2 = cp2V; pb2 = pv; } else if (iv == 2) { pr2 = pv; pg2 = cp2V; pb2 = tv; } else if (iv == 3) { pr2 = pv; pg2 = qv; pb2 = cp2V; } else if (iv == 4) { pr2 = tv; pg2 = pv; pb2 = cp2V; } else { pr2 = cp2V; pg2 = pv; pb2 = qv; } }
function clamp01(v) { if (v < 0.0) return 0.0; if (v > 1.0) return 1.0; return v; }
function wrap01(v) { v = v % 1.0; if (v < 0.0) v += 1.0; return v; }
function circDist(a, b) { var d = abs(a - b); if (d > 0.5) d = 1.0 - d; return d; }
function softPulse(dist, width) { var xVal = clamp01(1.0 - dist / width); return xVal * xVal * (3.0 - 2.0 * xVal); }

var tBuild = 0.0;
var tHeat = 0.0;
export function beforeRender(delta) {
  var localMult = pow(2.0, (localSpeed - 0.5) * 4.0);
  var dt = (delta / 1310.72) * localMult;
  tBuild = tBuild + dt * (0.11 + pressure * 0.92);
  tHeat = tHeat + dt * (0.62 + heatBloom * 1.70);
  _hsv2rgb1();
  _hsv2rgb2();
}

export function render3D(index, x, y, z) {
  var isTriangleEdge = sectionId == 1;
  var isTrianglePar = sectionId == 2 && y > 2.0;
  var isBar = sectionId == 2 && y <= 2.0;
  var isVintage = sectionId == 3;
  var theta = wrap01((atan2(z, x) / PI2) + 0.5);
  var phase = wrap01(tBuild);
  var threshold = 0.58 + releaseThreshold * 0.34;
  var build = phase < threshold ? phase / threshold : 0.0;
  var release = phase >= threshold ? (phase - threshold) / (1.0 - threshold) : 0.0;
  var flash = release > 0.0 ? pow(1.0 - release, 4.0) : 0.0;
  var cool = release > 0.0 ? pow(1.0 - release, 1.7) * coolingAfterglow : 0.0;
  var width = 0.020 + ventWidth * 0.160;
  var stage = 0.0, white = 0.0, amber = 0.0, uv = 0.0;

  if (isBar) {
    var barLocal = index - 57;
    var barT = (barLocal % 18) / 17.0;
    var vent = softPulse(circDist(theta, wrap01(tBuild * 0.77)), width);
    var vent2 = softPulse(circDist(theta, wrap01(0.42 - tBuild * 0.49)), width * 0.75) * 0.64;
    var piston = wave(barT * 1.7 - tHeat + theta * 0.5);
    stage = (vent + vent2) * (build * (0.24 + heatBloom * 0.40) + flash * (0.36 + ventFlash * 0.50)) * (0.35 + piston * 0.65);
    white = (vent + vent2) * flash * ventFlash;
    uv = (vent + vent2) * cool * 0.55;
  } else if (isTriangleEdge) {
    var edgeId = floor(index / 18.0);
    var edgeT = (index % 18) / 17.0;
    var gauge = softPulse(circDist(edgeT, build), 0.028 + ventWidth * 0.060);
    var burst = softPulse(circDist(edgeT, wrap01(1.0 - release)), 0.024 + ventFlash * 0.050);
    stage = gauge * (0.30 + pressure * 0.45) + burst * flash;
    white = burst * ventFlash * 0.70;
    uv = burst * cool * 0.30;
  } else if (isTrianglePar) {
    stage = flash * ventFlash * 0.10;
    white = flash * ventFlash;
    uv = cool * 0.18;
  } else if (isVintage) {
    var vintageLocal = index - 291;
    var heat = build * wave(tHeat + vintageLocal * 0.063);
    amber = (0.020 + heat * 0.42 + flash * 0.24) * heatBloom;
    stage = amber * 0.10;
  }

  var colorMix = clamp01(0.12 + build * 0.62 + wave(tHeat * 0.25 + theta) * 0.18);
  var brightness = stage + build * heatBloom * 0.018;
  var r = (pr1 + (pr2 - pr1) * colorMix) * brightness;
  var g = (pg1 + (pg2 - pg1) * colorMix) * brightness;
  var b = (pb1 + (pb2 - pb1) * colorMix) * brightness * 0.38;
  rgbwau(clamp01(r), clamp01(g), clamp01(b), clamp01(white), clamp01(amber), clamp01(uv));
}
