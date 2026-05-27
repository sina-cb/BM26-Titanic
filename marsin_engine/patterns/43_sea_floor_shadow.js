/*
  sea_floor_shadow
  Abyssal occlusion for Summer Camp Dome.
  A dark body moves around the BarLights ring while only the rim catches
  cold UV foam; TriangleEdges become distant silhouette lines.
*/

export var localSpeed = 0.5;
export var shadowWidth = 0.46;
export var shadowDrift = 0.44;
export var abyssalSwell = 0.38;
export var edgeFoam = 0.32;
export var blackoutDepth = 0.76;
export var triangleSilhouette = 0.58;

export var cp1H = 0.57, cp1S = 0.92, cp1V = 0.42;
export var cp2H = 0.66, cp2S = 0.88, cp2V = 0.30;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderShadowWidth(v) { shadowWidth = v; }
export function sliderShadowDrift(v) { shadowDrift = v; }
export function sliderAbyssalSwell(v) { abyssalSwell = v; }
export function sliderEdgeFoam(v) { edgeFoam = v; }
export function sliderBlackoutDepth(v) { blackoutDepth = v; }
export function sliderTriangleSilhouette(v) { triangleSilhouette = v; }

var pr1 = 1, pg1 = 0, pb1 = 0;
var pr2 = 0, pg2 = 0, pb2 = 1;

function _hsv2rgb1() {
  var hv = cp1H - floor(cp1H); if (hv < 0) hv += 1;
  var iv = floor(hv * 6) % 6;
  var fv = hv * 6 - floor(hv * 6);
  var pv = cp1V * (1 - cp1S);
  var qv = cp1V * (1 - fv * cp1S);
  var tv = cp1V * (1 - (1 - fv) * cp1S);
  if      (iv == 0) { pr1 = cp1V; pg1 = tv;   pb1 = pv;   }
  else if (iv == 1) { pr1 = qv;   pg1 = cp1V; pb1 = pv;   }
  else if (iv == 2) { pr1 = pv;   pg1 = cp1V; pb1 = tv;   }
  else if (iv == 3) { pr1 = pv;   pg1 = qv;   pb1 = cp1V; }
  else if (iv == 4) { pr1 = tv;   pg1 = pv;   pb1 = cp1V; }
  else              { pr1 = cp1V; pg1 = pv;   pb1 = qv;   }
}

function _hsv2rgb2() {
  var hv = cp2H - floor(cp2H); if (hv < 0) hv += 1;
  var iv = floor(hv * 6) % 6;
  var fv = hv * 6 - floor(hv * 6);
  var pv = cp2V * (1 - cp2S);
  var qv = cp2V * (1 - fv * cp2S);
  var tv = cp2V * (1 - (1 - fv) * cp2S);
  if      (iv == 0) { pr2 = cp2V; pg2 = tv;   pb2 = pv;   }
  else if (iv == 1) { pr2 = qv;   pg2 = cp2V; pb2 = pv;   }
  else if (iv == 2) { pr2 = pv;   pg2 = cp2V; pb2 = tv;   }
  else if (iv == 3) { pr2 = pv;   pg2 = qv;   pb2 = cp2V; }
  else if (iv == 4) { pr2 = tv;   pg2 = pv;   pb2 = cp2V; }
  else              { pr2 = cp2V; pg2 = pv;   pb2 = qv;   }
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

var tShadow = 0.0;
var tSwell = 0.0;
var tFoam = 0.0;

export function beforeRender(delta) {
  var localMult = pow(2.0, (localSpeed - 0.5) * 4.0);
  var dt = (delta / 1310.72) * localMult;

  tShadow = tShadow + dt * (0.10 + shadowDrift * 0.74);
  tSwell = tSwell + dt * (0.08 + abyssalSwell * 0.46);
  tFoam = tFoam + dt * (0.48 + edgeFoam * 1.85);

  _hsv2rgb1();
  _hsv2rgb2();
}

export function render3D(index, x, y, z) {
  var isTriangleEdge = sectionId == 1;
  var isTrianglePar = sectionId == 2 && y > 2.0;
  var isBar = sectionId == 2 && y <= 2.0;
  var isVintage = sectionId == 3;
  var isApex = isTriangleEdge || isTrianglePar;

  var theta = wrap01((atan2(z, x) / PI2) + 0.5);
  var radial = clamp01(sqrt(x * x + z * z) / 10.2);
  var swell = wave(tSwell + radial * 0.31 + y * 0.043);
  var centerA = wrap01(tShadow + (swell - 0.5) * 0.10);
  var centerB = wrap01(0.58 - tShadow * 0.37);
  var width = 0.055 + shadowWidth * 0.245;
  var shadowA = softPulse(circDist(theta, centerA), width);
  var shadowB = softPulse(circDist(theta, centerB), width * 0.58) * 0.64;
  var body = shadowA;
  if (shadowB > body) body = shadowB;

  var rimA = softPulse(abs(circDist(theta, centerA) - width), 0.012 + edgeFoam * 0.026);
  var rimB = softPulse(abs(circDist(theta, centerB) - width * 0.58), 0.010 + edgeFoam * 0.020) * 0.62;
  var foamTexture = pow(wave(tFoam * 2.11 + theta * 3.7 + y * 0.17 + index * 0.013), 2.8);
  var rim = clamp01((rimA + rimB) * (0.30 + edgeFoam * 0.82) * (0.35 + foamTexture * 0.65));

  var stage = 0.0;
  var white = 0.0;
  var amber = 0.0;
  var uv = 0.0;

  if (isBar) {
    var barLocal = index - 57;
    var barIndex = floor(barLocal / 18.0);
    var barT = (barLocal % 18) / 17.0;
    var deepRipple = pow(wave(barT * 1.17 + barIndex * 0.097 - tSwell * 1.7), 2.2);
    stage = (1.0 - body) * (0.040 + abyssalSwell * 0.13) * deepRipple + rim * 0.30;
    uv = rim * (0.34 + edgeFoam * 0.66);
  } else if (isTriangleEdge) {
    var edgeId = floor(index / 18.0);
    var edgeT = (index % 18) / 17.0;
    var silhouetteLine = softPulse(circDist(edgeT, wrap01(tShadow * 0.61 + edgeId * 0.333)), 0.032 + shadowWidth * 0.062);
    var counterLine = softPulse(circDist(edgeT, wrap01(1.0 - tSwell * 0.79 + edgeId * 0.19)), 0.026 + edgeFoam * 0.044) * 0.48;
    stage = clamp01((silhouetteLine + counterLine) * (0.18 + triangleSilhouette * 0.42));
    uv = clamp01(counterLine * edgeFoam * 0.34);
    white = clamp01(silhouetteLine * edgeFoam * 0.18);
  } else if (isTrianglePar) {
    var parPulse = pow(wave(tFoam * 0.77 + index * 0.271), 7.0);
    stage = parPulse * triangleSilhouette * 0.055;
    white = parPulse * edgeFoam * 0.16;
    uv = parPulse * edgeFoam * 0.22;
  } else if (isVintage) {
    var vintageLocal = index - 291;
    var fixtureNo = floor(vintageLocal / 6.0);
    var lampNo = vintageLocal % 6;
    var emberGate = softPulse(circDist(wrap01(fixtureNo / 5.0), wrap01(tSwell * 0.21 + 0.33)), 0.075);
    var ember = wave(tFoam * 0.43 + fixtureNo * 0.29 + lampNo * 0.061);
    amber = emberGate * ember * abyssalSwell * 0.18;
    stage = amber * 0.040;
  }

  var darkness = clamp01(body * (0.58 + blackoutDepth * 0.40));
  stage = stage * (1.0 - darkness);
  uv = uv * (1.0 - body * 0.42);

  var colorMix = clamp01(0.16 + swell * 0.42 + radial * 0.20 + rim * 0.22);
  var floorGlow = (1.0 - blackoutDepth) * abyssalSwell * 0.018;
  var brightness = floorGlow + stage;
  if (isVintage) brightness = floorGlow * 0.25 + stage;

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
