/*
  apex_gyro_vortex
  Smooth rotating vortex for Apex / hull fixtures.
  Fixed:
  - Removed hard threshold strobe.
  - Added soft vortex core.
  - Made vortexSpeed control real movement speed.
  - Made UV follow the vortex instead of filling everything.
*/

export var localSpeed = 0.5;
export var vortexSpeed = 0.45;
export var sweepImpact = 0.3;
export var hullGlow = 0.35;
export var uvIntensity = 1.0;
export var vortexWidth = 0.42;

export var cp1H = 0.0, cp1S = 1.0, cp1V = 1.0;
export var cp2H = 0.08, cp2S = 1.0, cp2V = 1.0;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderVortexSpeed(v) { vortexSpeed = v; }
export function sliderSweepImpact(v) { sweepImpact = v; }
export function sliderHullGlow(v) { hullGlow = v; }
export function sliderUvIntensity(v) { uvIntensity = v; }
export function sliderVortexWidth(v) { vortexWidth = v; }

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

var tPhase = 0.0;
var tSlow = 0.0;

export function beforeRender(delta) {
  var localMult = pow(2.0, (localSpeed - 0.5) * 4.0);
  var dt = (delta / 1310.72) * localMult;

  tPhase = wrap01(tPhase + dt * (0.10 + vortexSpeed * 1.35));
  tSlow = wrap01(tSlow + dt * 0.13);

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
  var radius = clamp01(sqrt(dx * dx + dz * dz) * 2.0);

  // Main rotating vortex head.
  var head = tPhase;
  var tail = wrap01(tPhase - 0.12);

  var width = 0.035 + vortexWidth * 0.18;

  var core = softPulse(circDist(theta, head), width);
  var trail = softPulse(circDist(theta, tail), width * 2.4) * 0.42;

  // Spiral texture: different heights/radii get pulled slightly around the vortex.
  var spiral = wave(theta * 1.2 + radius * 0.55 - y * 0.07 - tPhase * 1.7);
  var gyre = wave(theta * 2.8 - radius * 0.95 + tSlow * 1.6);

  var vortex = clamp01(core + trail);
  vortex = vortex * (0.62 + spiral * 0.28 + gyre * 0.10);

  // Low background hull glow, so it never goes dead-black unless hullGlow is low.
  var hullBase = hullGlow * (0.08 + radius * 0.06);

  var stage = hullBase + vortex * hullGlow * (0.72 + sweepImpact * 0.55);

  if (isTriangleEdge) stage = hullBase * 0.6 + vortex * hullGlow * 0.92;
  if (isTrianglePar) stage = hullBase * 0.35 + vortex * hullGlow * 0.55;
  if (isBar) stage = hullBase * 0.8 + vortex * hullGlow * 0.82;
  if (isVintage) stage = hullBase * 0.25 + vortex * hullGlow * 0.18;

  var colorMix = clamp01(spiral * 0.55 + gyre * 0.22 + vortex * 0.35);

  var r = (pr1 + (pr2 - pr1) * colorMix) * stage;
  var g = (pg1 + (pg2 - pg1) * colorMix) * stage;
  var b = (pb1 + (pb2 - pb1) * colorMix) * stage;

  // Smooth white center instead of strobe pop.
  var w = isApex ? clamp01(vortex * sweepImpact * (0.32 + core * 0.48)) : 0.0;

  // Vintage warmth catches a little bit of the vortex but stays subtle.
  var a = isVintage ? clamp01(hullGlow * 0.08 + vortex * sweepImpact * 0.12) : 0.0;

  // UV follows the tail/edge of the vortex, not the full inverse sweep.
  var uvTrail = clamp01(trail * 0.75 + core * 0.32 + gyre * vortex * 0.18);
  var u = clamp01(uvTrail * uvIntensity);

  rgbwau(
    clamp01(r),
    clamp01(g),
    clamp01(b),
    clamp01(w),
    clamp01(a),
    clamp01(u)
  );
}