/*
  stardust_dome
  Sparse orbiting particles around the ring; the triangle apex becomes a
  3-edge constellation that TWINKLES.

  APEX edge rhythm: 1-1-1 cascade. Each TriangleEdge has a unique density
  AND twinkle phase via edgeId / 3.0. Each edge gets its own sparse
  twinkle field — per-pixel sparkles whose probability is modulated by
  the edge's independent phase clock. No spin offset shared across
  edges, so we cannot collapse to 1-2 or 2-1.
  TrianglePars (idx 54,55,56) are 3 prominent "named stars" pulsing on
  their own slower timing — third voice in the constellation.

  E2 par visibility push: each named star now holds an always-on base + wide
  slow pulse + occasional bright twinkle, with a unique anchored hue per par
  so the three stars carry visibly different colours. Undampened brightness
  path so the stars read across the dome (floor ≥ 0.28, peak ≥ 0.90).
*/

export var localSpeed = 0.5;
export var starCore = 0.58;
export var particleDensity = 0.34;
export var orbitSpeed = 0.52;
export var ringWidth = 0.34;
export var wallHit = 0.42;
export var blackoutDepth = 0.40;

export var cp1H = 0.78, cp1S = 0.58, cp1V = 0.78;
export var cp2H = 0.55, cp2S = 0.62, cp2V = 0.68;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderStarCore(v) { starCore = v; }
export function sliderParticleDensity(v) { particleDensity = v; }
export function sliderOrbitSpeed(v) { orbitSpeed = v; }
export function sliderRingWidth(v) { ringWidth = v; }
export function sliderWallHit(v) { wallHit = v; }
export function sliderBlackoutDepth(v) { blackoutDepth = v; }

var pr1 = 1, pg1 = 0, pb1 = 0;
var pr2 = 0, pg2 = 0, pb2 = 1;

function hsv1() {
  var h = cp1H - floor(cp1H); if (h < 0) h += 1;
  var iv = floor(h * 6) % 6;
  var f = h * 6 - floor(h * 6);
  var p = cp1V * (1 - cp1S);
  var q = cp1V * (1 - f * cp1S);
  var tv = cp1V * (1 - (1 - f) * cp1S);
  if      (iv == 0) { pr1 = cp1V; pg1 = tv;   pb1 = p;    }
  else if (iv == 1) { pr1 = q;    pg1 = cp1V; pb1 = p;    }
  else if (iv == 2) { pr1 = p;    pg1 = cp1V; pb1 = tv;   }
  else if (iv == 3) { pr1 = p;    pg1 = q;    pb1 = cp1V; }
  else if (iv == 4) { pr1 = tv;   pg1 = p;    pb1 = cp1V; }
  else              { pr1 = cp1V; pg1 = p;    pb1 = q;    }
}

function hsv2() {
  var h = cp2H - floor(cp2H); if (h < 0) h += 1;
  var iv = floor(h * 6) % 6;
  var f = h * 6 - floor(h * 6);
  var p = cp2V * (1 - cp2S);
  var q = cp2V * (1 - f * cp2S);
  var tv = cp2V * (1 - (1 - f) * cp2S);
  if      (iv == 0) { pr2 = cp2V; pg2 = tv;   pb2 = p;    }
  else if (iv == 1) { pr2 = q;    pg2 = cp2V; pb2 = p;    }
  else if (iv == 2) { pr2 = p;    pg2 = cp2V; pb2 = tv;   }
  else if (iv == 3) { pr2 = p;    pg2 = q;    pb2 = cp2V; }
  else if (iv == 4) { pr2 = tv;   pg2 = p;    pb2 = cp2V; }
  else              { pr2 = cp2V; pg2 = p;    pb2 = q;    }
}

function clamp01(v) { if (v < 0) return 0; if (v > 1) return 1; return v; }
function wrap01(v) { v = v % 1; if (v < 0) v += 1; return v; }
function circDist(a, b) { var d = abs(a - b); if (d > 0.5) d = 1 - d; return d; }
function pulse(d, w) { var px = clamp01(1 - d / w); return px * px * (3 - 2 * px); }
function reverseEveryTwo(v) { var block = floor(v / 2.0); var within = v - block * 2.0; if ((block % 2) == 0) return within; return 2.0 - within; }

var tOrbit = 0;
var tTwinkle = 0;
var tPar = 0;

export function beforeRender(delta) {
  var m = pow(2, (localSpeed - 0.5) * 4);
  var dt = delta / 1310.72 * m;
  tOrbit += dt * (0.16 + orbitSpeed * 1.10);
  tTwinkle += dt * (0.70 + particleDensity * 2.0);
  // Pars on a deliberately slower clock — "named stars" pulse
  tPar += dt * (0.18 + starCore * 0.42);
  hsv1();
  hsv2();
}

export function render3D(index, x, y, z) {
  var isEdge = sectionId == 1;
  var isPar = sectionId == 2 && y > 2;
  var isBar = sectionId == 2 && y <= 2;
  var isVintage = sectionId == 3;

  var theta = wrap01((atan2(z, x) / PI2) + 0.5);
  var spin = reverseEveryTwo(tOrbit);
  var width = 0.008 + ringWidth * 0.060;
  var p1 = pulse(circDist(theta, wrap01(spin)), width);
  var p2 = pulse(circDist(theta, wrap01(0.37 - spin * 0.63)), width * 0.8);
  var dust = pow(wave(theta * (9 + particleDensity * 18) + spin * 1.4 + index * 0.017), 8.0 - particleDensity * 3.0);

  var stage = 0, w = 0, a = 0, u = 0;

  if (isBar) {
    stage = (p1 + p2 * 0.7 + dust * particleDensity * 0.45) * (0.25 + wallHit * 0.45);
    w = pow(stage, 2.2) * wallHit * 0.4;
    u = stage * 0.28;
  } else if (isEdge) {
    var edgeId = floor(index / 18.0);
    var edgeT = (index % 18) / 17.0;
    // 1-1-1 cascade: each edge has its own twinkle phase + density modulator
    var edgePhase = edgeId / 3.0;
    // Per-pixel sparse twinkle, edge-unique base offset
    // Use a large-prime stride per edge so the twinkle waveforms never align
    var twinkleArg = tTwinkle * (0.9 + edgeId * 0.17) + edgeT * 23.0 + edgePhase * 6.28;
    var twinkle = pow(wave(twinkleArg), 10.0 - particleDensity * 4.0);
    // Per-edge density envelope: each edge brightens at its own slow phase
    var densityGate = 0.40 + 0.60 * wave(tPar * 0.8 + edgePhase);
    // Optional travelling core star per edge — its own offset, not shared spin
    var core = pulse(circDist(edgeT, wrap01(edgePhase + spin * 0.20)), 0.040 + starCore * 0.06);
    stage = (twinkle * densityGate * (0.55 + particleDensity * 0.65) + core * (0.30 + starCore * 0.55)) * (0.45 + starCore * 0.55);
    w = clamp01(twinkle * densityGate * starCore * 0.85 + core * starCore);
  } else if (isPar) {
    // 3 "named stars" — each on its own slow phase, never grouped.
    // E2 push: each named star holds a slow, wide-amplitude base brightness +
    // occasional bright twinkle. Each par has a unique base hue offset so the
    // three stars carry visibly different colours.
    var parId = index - 54;
    var parPhase = parId / 3.0;
    // Slow wide pulse — wide pow(wave,2) gives a much more visible breathing
    // than pow(wave,4) which clamps near zero most of the time.
    var parPulseSlow = pow(wave(tPar * 0.50 + parPhase), 2.0);
    // Per-par twinkle (pow(wave,6) — softer than pow(wave,9)).
    var parTwinkle = pow(wave(tTwinkle * 0.35 + parId * 0.41), 6.0);
    // Always-on base so the named stars are always visible.
    var base = 0.28 + 0.18 * wave(tPar * 1.1 + parId * 0.27);
    var combo = clamp01(base + parPulseSlow * (0.45 + starCore * 0.45) + parTwinkle * 0.55);
    stage = combo;
    w = clamp01(parTwinkle * (0.55 + starCore * 0.45) + parPulseSlow * 0.20);
    u = clamp01(parTwinkle * 0.30 + base * 0.15);
  } else if (isVintage) {
    a = (p1 + p2) * wallHit * 0.10 * wave(tTwinkle * 0.4 + index * 0.04);
    stage = a * 0.08;
  }

  var mixv = clamp01(0.15 + theta * 0.30 + dust * 0.50);
  // Pars get a unique anchored hue per parId so the 3 named stars carry
  // visibly different colours.
  if (isPar) {
    var parIdMix = index - 54;
    mixv = clamp01(parIdMix / 2.0);
  }
  var bri = (1 - blackoutDepth) * 0.015 + stage * 0.55;
  // Pars: undampened bright path so the named stars read across the dome.
  if (isPar) bri = 0.14 + stage * (0.78 + starCore * 0.20);
  rgbwau(
    clamp01((pr1 + (pr2 - pr1) * mixv) * bri),
    clamp01((pg1 + (pg2 - pg1) * mixv) * bri),
    clamp01((pb1 + (pb2 - pb1) * mixv) * bri),
    clamp01(w),
    clamp01(a),
    clamp01(u)
  );
}
