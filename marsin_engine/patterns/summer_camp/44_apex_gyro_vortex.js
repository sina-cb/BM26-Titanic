/*
  apex_gyro_vortex
  Three nested counter-rotating vortices (rates 1.0, -0.618, 1.414) wrap the
  apex. TriangleEdges carry an arm per edge (1-1-1 cascade at edgeId/3.0).
  TrianglePars are three anchor stars that pulse when the fastest vortex
  passes their cardinal location. BarLights render a vortex-shadow ring with
  a bright streak rotating around the perimeter.

  Continuity preserved (yesterday's fix): tPhase / tSlow remain UNBOUNDED
  accumulators — wave(... ± tPhase*1.7) consumers stay continuous; only
  wrap at circDist call sites.

  Enhancements (D3 push):
  - 3 nested counter-rotating vortices instead of 1.
  - Per-edge unique arm (Rule 1) at edgeId/3.0.
  - Active anchor pars (Rule 2): cardinal-hit pulse + low halo.
  - Bar vortex-shadow streak (Rule 3): pixel art, not dark.
  - Bright defaults (Rule 4).
*/

export var localSpeed = 0.5;
export var vortexSpeed = 0.50;
export var sweepImpact = 0.40;
export var hullGlow = 0.55;
export var uvIntensity = 0.70;
export var vortexWidth = 0.42;
export var armPhase = 0.5;
export var blackoutDepth = 0.30;

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
export function sliderArmPhase(v) { armPhase = v; }
export function sliderBlackoutDepth(v) { blackoutDepth = v; }

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

// Continuity-critical accumulators: see comment in beforeRender.
var tPhase = 0.0;
var tSlow = 0.0;
var tStar = 0.0;

export function beforeRender(delta) {
  var localMult = pow(2.0, (localSpeed - 0.5) * 4.0);
  var dt = (delta / 1310.72) * localMult;

  // Continuity: tPhase / tSlow are fed into wave(... ± tPhase*1.7) etc. wave
  // is period-1, so wrap01-ing here would jump the wave argument by 1.7 mod 1
  // = 0.7 every cycle (visible step in spiral/gyre). Keep them unbounded;
  // float64 holds ~14 hours of dt accumulation cleanly. circDist/softPulse
  // consumers wrap themselves so head/tail remain continuous.
  tPhase = tPhase + dt * (0.10 + vortexSpeed * 1.35);
  tSlow = tSlow + dt * 0.13;
  tStar = tStar + dt * 0.27;

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

  // Three nested counter-rotating vortex heads. Rates are irrational so they
  // never lock. tPhase is unbounded (continuity); wrap at circDist sites only.
  // KEY GESTURE: 3 nested vortices (1.0, -0.618, 1.414) — the gyro multi-arm.
  var head1 = wrap01(tPhase * 1.0);
  var head2 = wrap01(-tPhase * 0.618);
  var head3 = wrap01(tPhase * 1.414 + 0.27);
  var tail1 = wrap01(tPhase * 1.0 - 0.12);

  var width = 0.035 + vortexWidth * 0.18;

  var core1 = softPulse(circDist(theta, head1), width);
  var core2 = softPulse(circDist(theta, head2), width * 0.78) * 0.65;
  var core3 = softPulse(circDist(theta, head3), width * 0.62) * 0.50;
  var trail = softPulse(circDist(theta, tail1), width * 2.4) * 0.42;

  // Spiral / gyre textures stay continuous because tPhase / tSlow are unbounded.
  var spiral = wave(theta * 1.2 + radius * 0.55 - y * 0.07 - tPhase * 1.7);
  var gyre = wave(theta * 2.8 - radius * 0.95 + tSlow * 1.6);

  var vortex = clamp01(core1 + core2 + core3 + trail);
  vortex = vortex * (0.58 + spiral * 0.28 + gyre * 0.14);

  var hullBase = hullGlow * (0.10 + radius * 0.06) + (1.0 - blackoutDepth) * 0.025;

  var stage = hullBase + vortex * hullGlow * (0.72 + sweepImpact * 0.55);

  if (isTriangleEdge) {
    // PER-EDGE UNIQUE PHASE (Rule 1): each edge gets a rotating arm at
    // phase = edgeId/3.0, evaluated against edgeT (along the edge).
    var edgeId = floor(index / 18.0);
    var edgeT = (index % 18) / 17.0;
    var armHead = wrap01(tPhase + edgeId / 3.0);
    var arm = softPulse(abs(edgeT - armHead), 0.045 + armPhase * 0.10);
    var armWave = wave(edgeT * 2.2 + tPhase * 1.7 + edgeId * 0.31);
    var armGlow = clamp01(arm + armWave * 0.18 * arm);
    stage = hullBase * 0.85 + vortex * hullGlow * 0.85 + armGlow * (0.45 + sweepImpact * 0.55);
  }

  if (isTrianglePar) {
    // PARS ACTIVE (Rule 2): three anchor stars at cardinal positions
    // (parId * 1/3 around the ring). Pulse when fastest vortex (head1) passes.
    var parId = index - 54;
    var starPos = parId / 3.0;
    var starHit = softPulse(circDist(head1, starPos), 0.05 + vortexWidth * 0.08);
    // Low halo so pars are never fully off.
    var starHalo = 0.10 + 0.08 * wave(tStar * 1.2 + parId * 0.41);
    stage = hullBase * 0.55 + vortex * hullGlow * 0.45 + starHalo * 0.35 + starHit * (0.55 + sweepImpact * 0.55);
  }

  if (isBar) {
    // Vortex shadow ring with a bright streak rotating around the perimeter.
    // KEY GESTURE: rotating streak + pixel-level shadow texture.
    var barLocal = index - 57;
    var barIdx = floor(barLocal / 18.0);
    var barT = (barLocal % 18) / 17.0;
    var streak = softPulse(circDist(theta, head1), 0.05 + vortexWidth * 0.10);
    var counterStreak = softPulse(circDist(theta, head2), 0.04 + vortexWidth * 0.08) * 0.62;
    // Pixel-level texture along each bar so it's never flat.
    var pixelWave = wave(barT * 3.0 + tPhase * 1.7 + barIdx * 0.17);
    var barTex = 0.20 + 0.20 * pixelWave;
    stage = hullBase + (vortex * 0.40 + streak + counterStreak) * hullGlow * (0.55 + sweepImpact * 0.50) * (0.65 + barTex * 0.45);
  }

  if (isVintage) stage = hullBase * 0.25 + vortex * hullGlow * 0.18;

  var colorMix = clamp01(spiral * 0.55 + gyre * 0.22 + vortex * 0.35);

  var r = (pr1 + (pr2 - pr1) * colorMix) * stage;
  var g = (pg1 + (pg2 - pg1) * colorMix) * stage;
  var b = (pb1 + (pb2 - pb1) * colorMix) * stage;

  // Smooth white center instead of strobe pop. Apex only.
  var w = isApex ? clamp01(vortex * sweepImpact * (0.32 + core1 * 0.48)) : 0.0;

  var a = isVintage ? clamp01(hullGlow * 0.08 + vortex * sweepImpact * 0.12) : 0.0;

  var uvTrail = clamp01(trail * 0.75 + core1 * 0.32 + gyre * vortex * 0.18);
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
