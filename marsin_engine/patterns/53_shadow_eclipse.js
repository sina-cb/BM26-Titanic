/*
  shadow_eclipse
  Black-sun corona: a wide moving shadow eats the ring while two bright rims
  and a triangle-stage corona flare outline the eclipse.
*/

export var localSpeed = 0.5;
export var shadowSize = 0.58;
export var rimWidth = 0.35;
export var orbitEccentricity = 0.42;
export var coronaPulse = 0.52;
export var vintageBloom = 0.22;
export var blackoutDepth = 0.82;

export var cp1H = 0.62, cp1S = 0.72, cp1V = 0.40;
export var cp2H = 0.04, cp2S = 0.86, cp2V = 0.44;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }
export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderShadowSize(v) { shadowSize = v; }
export function sliderRimWidth(v) { rimWidth = v; }
export function sliderOrbitEccentricity(v) { orbitEccentricity = v; }
export function sliderCoronaPulse(v) { coronaPulse = v; }
export function sliderVintageBloom(v) { vintageBloom = v; }
export function sliderBlackoutDepth(v) { blackoutDepth = v; }

var pr1 = 1, pg1 = 0, pb1 = 0;
var pr2 = 0, pg2 = 0, pb2 = 1;
function hsv1() { var hv = cp1H - floor(cp1H); if (hv < 0) hv += 1; var iv = floor(hv * 6) % 6; var fv = hv * 6 - floor(hv * 6); var pv = cp1V * (1 - cp1S); var qv = cp1V * (1 - fv * cp1S); var tv = cp1V * (1 - (1 - fv) * cp1S); if (iv == 0) { pr1 = cp1V; pg1 = tv; pb1 = pv; } else if (iv == 1) { pr1 = qv; pg1 = cp1V; pb1 = pv; } else if (iv == 2) { pr1 = pv; pg1 = cp1V; pb1 = tv; } else if (iv == 3) { pr1 = pv; pg1 = qv; pb1 = cp1V; } else if (iv == 4) { pr1 = tv; pg1 = pv; pb1 = cp1V; } else { pr1 = cp1V; pg1 = pv; pb1 = qv; } }
function hsv2() { var hv = cp2H - floor(cp2H); if (hv < 0) hv += 1; var iv = floor(hv * 6) % 6; var fv = hv * 6 - floor(hv * 6); var pv = cp2V * (1 - cp2S); var qv = cp2V * (1 - fv * cp2S); var tv = cp2V * (1 - (1 - fv) * cp2S); if (iv == 0) { pr2 = cp2V; pg2 = tv; pb2 = pv; } else if (iv == 1) { pr2 = qv; pg2 = cp2V; pb2 = pv; } else if (iv == 2) { pr2 = pv; pg2 = cp2V; pb2 = tv; } else if (iv == 3) { pr2 = pv; pg2 = qv; pb2 = cp2V; } else if (iv == 4) { pr2 = tv; pg2 = pv; pb2 = cp2V; } else { pr2 = cp2V; pg2 = pv; pb2 = qv; } }
function clamp01(v) { if (v < 0.0) return 0.0; if (v > 1.0) return 1.0; return v; }
function wrap01(v) { v = v % 1.0; if (v < 0.0) v += 1.0; return v; }
function circDist(a, b) { var d = abs(a - b); if (d > 0.5) d = 1.0 - d; return d; }
function softPulse(dist, width) { var px = clamp01(1.0 - dist / width); return px * px * (3.0 - 2.0 * px); }

var orbitPhase = 0.0;
var coronaPhase = 0.0;
export function beforeRender(delta) {
  var localMult = pow(2.0, (localSpeed - 0.5) * 4.0);
  var dt = (delta / 1310.72) * localMult;
  orbitPhase = orbitPhase + dt * (0.10 + orbitEccentricity * 0.62);
  coronaPhase = coronaPhase + dt * (0.48 + coronaPulse * 1.75);
  hsv1(); hsv2();
}

export function render3D(index, x, y, z) {
  var isEdge = sectionId == 1;
  var isPar = sectionId == 2 && y > 2.0;
  var isBar = sectionId == 2 && y <= 2.0;
  var isVintage = sectionId == 3;
  var theta = wrap01((atan2(z, x) / PI2) + 0.5);
  var center = wrap01(orbitPhase + (wave(orbitPhase * 0.31) - 0.5) * orbitEccentricity * 0.22);
  var radius = 0.070 + shadowSize * 0.230;
  var dist = circDist(theta, center);
  var body = softPulse(dist, radius);
  var rimA = softPulse(abs(dist - radius), 0.010 + rimWidth * 0.038);
  var rimB = softPulse(abs(dist - radius * 0.62), 0.008 + rimWidth * 0.026) * 0.48;
  var shimmer = 0.38 + 0.62 * pow(wave(coronaPhase + theta * 5.0 + index * 0.011), 2.5);
  var rim = clamp01((rimA + rimB) * shimmer);
  var stage = 0.0, white = 0.0, amber = 0.0, uv = 0.0;

  if (isBar) {
    stage = rim * (0.30 + coronaPulse * 0.24) + (1.0 - body) * (1.0 - blackoutDepth) * 0.018;
    white = rim * coronaPulse * 0.42;
    uv = rim * (0.30 + rimWidth * 0.35);
  } else if (isEdge) {
    var edgeId = floor(index / 18.0);
    var edgeT = (index % 18) / 17.0;
    var coronaArm = softPulse(circDist(edgeT, wrap01(center + edgeId * 0.333)), 0.030 + rimWidth * 0.060);
    var flare = coronaArm * (0.45 + 0.55 * wave(coronaPhase * 0.7 + edgeId * 0.19));
    stage = flare * (0.22 + coronaPulse * 0.56);
    white = flare * coronaPulse;
    uv = coronaArm * 0.16;
  } else if (isPar) {
    var core = pow(wave(coronaPhase * 1.31 + index * 0.27), 7.0);
    stage = (rim + core) * coronaPulse * 0.06;
    white = clamp01(rim * coronaPulse + core * coronaPulse * 0.55);
    uv = rim * 0.22;
  } else if (isVintage) {
    amber = rim * vintageBloom * wave(coronaPhase * 0.42 + index * 0.047);
    stage = amber * 0.060;
  }

  stage = stage * (1.0 - body * blackoutDepth);
  var mixv = clamp01(0.16 + rim * 0.64 + theta * 0.14);
  var bri = (1.0 - blackoutDepth) * 0.008 + stage;
  rgbwau(
    clamp01((pr1 + (pr2 - pr1) * mixv) * bri),
    clamp01((pg1 + (pg2 - pg1) * mixv) * bri),
    clamp01((pb1 + (pb2 - pb1) * mixv) * bri),
    clamp01(white), clamp01(amber), clamp01(uv)
  );
}
