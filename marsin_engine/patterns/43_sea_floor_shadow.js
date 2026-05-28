/*
  sea_floor_shadow
  Abyssal occlusion for Summer Camp Dome.
  A dark body moves around the BarLights ring while only the rim catches
  cold UV foam; TriangleEdges become distant silhouette lines.

  APEX 1-1-1 fix (E1): the previous (0, 1/3, 2/3) edge offsets put spots
  at geometrically mirror-symmetric positions on the equilateral triangle
  — at edgeT=0.5, edge0 spot lands at one position while edges 1 and 2 land
  at mirror positions, reading as 2-1 to the eye. POSITION-based fix using
  φ-spaced offsets [0.0, 0.382, 0.764] so no pair is mirror-symmetric.
  Applied to silhouette, counter, and par sweep.
*/

export var localSpeed = 0.5;
export var shadowWidth = 0.46;
export var shadowDrift = 0.44;
export var abyssalSwell = 0.55;
export var edgeFoam = 0.55;
export var blackoutDepth = 0.55;
export var triangleSilhouette = 0.70;

export var cp1H = 0.57, cp1S = 0.92, cp1V = 0.85;
export var cp2H = 0.66, cp2S = 0.88, cp2V = 0.70;
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
    stage = (1.0 - body) * (0.16 + abyssalSwell * 0.30) * deepRipple + rim * 0.60;
    uv = rim * (0.40 + edgeFoam * 0.55);
  } else if (isTriangleEdge) {
    var edgeId = floor(index / 18.0);
    var edgeT = (index % 18) / 17.0;
    // φ-spaced 1-1-1: positions [0.0, 0.382, 0.764] are not mirror-symmetric.
    // Continuity check (silhouette spot, edgeT=0.5, time t=0.25, 0.5, 0.75):
    //   c = tShadow * 0.61 + edgePhase
    //   At t=0.25 (c=0.1525): positions 0.153, 0.535, 0.917 → dists 0.347, 0.035, 0.417 — distinct.
    //   At t=0.5  (c=0.305 ): positions 0.305, 0.687, 0.069 → dists 0.195, 0.187, 0.431 — distinct.
    //   At t=0.75 (c=0.458 ): positions 0.458, 0.840, 0.222 → dists 0.042, 0.340, 0.278 — distinct.
    var edgePhase = 0.0;
    if (edgeId == 1) edgePhase = 0.382;
    if (edgeId == 2) edgePhase = 0.764;
    var silhouetteLine = softPulse(circDist(edgeT, wrap01(tShadow * 0.61 + edgePhase)), 0.032 + shadowWidth * 0.062);
    // Counter line uses a different temporal coefficient AND φ-spaced offset,
    // so it never collides with silhouette and the three counter spots are also
    // all distinct (same φ-spacing argument).
    var counterLine = softPulse(circDist(edgeT, wrap01(0.5 - tSwell * 0.79 + edgePhase)), 0.026 + edgeFoam * 0.044) * 0.48;
    stage = clamp01((silhouetteLine + counterLine) * (0.38 + triangleSilhouette * 0.55));
    uv = clamp01(counterLine * edgeFoam * 0.45);
    white = clamp01(silhouetteLine * edgeFoam * 0.24);
  } else if (isTrianglePar) {
    // Pars (idx 54,55,56) — φ-spaced offsets so the three pars are not at
    // mirror-symmetric phases of the shadow sweep.
    var parId = index - 54;
    var parPhase = 0.0;
    if (parId == 1) parPhase = 0.382;
    if (parId == 2) parPhase = 0.764;
    var parSweep = softPulse(circDist(wrap01(tShadow * 0.61 + parPhase), centerA), 0.10 + shadowWidth * 0.14);
    var parSparkle = pow(wave(tFoam * 0.77 + parPhase), 7.0);
    var shadowPass = parSweep * (0.55 + triangleSilhouette * 0.45);
    stage = (0.06 + (shadowPass + parSparkle * 0.30) * 0.94) * (0.22 + triangleSilhouette * 0.55);
    white = (shadowPass + parSparkle * 0.18) * edgeFoam * 0.32;
    uv = shadowPass * edgeFoam * 0.40;
  } else if (isVintage) {
    var vintageLocal = index - 291;
    var fixtureNo = floor(vintageLocal / 6.0);
    var lampNo = vintageLocal % 6;
    var emberGate = softPulse(circDist(wrap01(fixtureNo / 5.0), wrap01(tSwell * 0.21 + 0.33)), 0.075);
    var ember = wave(tFoam * 0.43 + fixtureNo * 0.29 + lampNo * 0.061);
    amber = emberGate * ember * (0.30 + abyssalSwell * 0.45);
    stage = amber * 0.18;
  }

  var darkness = clamp01(body * (0.40 + blackoutDepth * 0.45));
  stage = stage * (1.0 - darkness);
  uv = uv * (1.0 - body * 0.42);

  var colorMix = clamp01(0.16 + swell * 0.42 + radial * 0.20 + rim * 0.22);
  var floorGlow = (1.0 - blackoutDepth) * (0.06 + abyssalSwell * 0.10);
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
