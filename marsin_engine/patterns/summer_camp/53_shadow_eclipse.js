/*
  shadow_eclipse
  Black-sun corona: a wide moving shadow eats the ring while two bright rims
  and a triangle-stage corona flare outline the eclipse.

  APEX 1-1-1 fix (E1): switched from (0, 1/3, 2/3) to φ-spaced edge offsets
  [0.0, 0.382, 0.764]. The previous spacing put corona arm positions at
  mirror-symmetric points of the equilateral triangle, reading as 2-1.
  φ-spacing breaks that mirror symmetry. Also, the per-edge flare wave
  modulator `wave(coronaPhase * 0.7 + edgePhase)` with (1/3, 2/3) offsets
  produced wave-fold collisions at moments when 2*coronaPhase*0.7 ≈ 0 (the
  symmetric-through-wave anti-pattern called out in the spec). φ-spacing
  removes that pairing as well.
  TrianglePars now use the same φ-spacing.
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
    // φ-spaced 1-1-1: [0.0, 0.382, 0.764]. Continuity check (edgeT=0.5; t makes
    // `center` advance; sample center = 0.0, 0.25, 0.5):
    //   center=0.0 : positions 0.000, 0.382, 0.764 → dists 0.500, 0.118, 0.264 — distinct.
    //   center=0.25: positions 0.250, 0.632, 0.014 → dists 0.250, 0.132, 0.486 — distinct.
    //   center=0.5 : positions 0.500, 0.882, 0.264 → dists 0.000, 0.382, 0.236 — distinct.
    var edgePhase = 0.0;
    if (edgeId == 1) edgePhase = 0.382;
    if (edgeId == 2) edgePhase = 0.764;
    var coronaArm = softPulse(circDist(edgeT, wrap01(center + edgePhase)), 0.030 + rimWidth * 0.060);
    // Flare modulator: with φ-spaced offsets, wave(coronaPhase * 0.7 + edgePhase)
    // no longer folds to a pair — wave(x+0.382) and wave(x+0.764) are not equal
    // (unlike wave(x+1/3)=wave(x+2/3) at x=0).
    var flare = coronaArm * (0.45 + 0.55 * wave(coronaPhase * 0.7 + edgePhase));
    stage = flare * (0.22 + coronaPulse * 0.56);
    white = flare * coronaPulse;
    uv = coronaArm * 0.16;
  } else if (isPar) {
    // Pars (idx 54,55,56) — φ-spaced offsets; the previous parPhase computed
    // distance = circDist(center+parPhase, parPhase+0.5) = |center-0.5| for ALL
    // par ids, so all three pars were identical (a hard 3-1 collapse). The fix
    // gives each par a unique target theta.
    var parId = index - 54;
    var parPhase = 0.0;
    if (parId == 1) parPhase = 0.382;
    if (parId == 2) parPhase = 0.764;
    // Each par "owns" a different theta target (0.0, 0.5, 0.25 — also unique-pairwise)
    // so they brighten at distinct moments of the orbit.
    var parTarget = 0.0;
    if (parId == 1) parTarget = 0.5;
    if (parId == 2) parTarget = 0.25;
    var parPass = softPulse(circDist(center, parTarget), 0.18 + rimWidth * 0.10);
    var core = pow(wave(coronaPhase * 0.55 + parPhase), 7.0);
    var combo = clamp01(parPass * (0.45 + coronaPulse * 0.45) + core * 0.35);
    stage = (rim * 0.40 + combo) * coronaPulse * 0.18;
    white = clamp01(rim * coronaPulse * 0.6 + combo * coronaPulse * 0.85);
    uv = (rim + combo) * 0.22;
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
