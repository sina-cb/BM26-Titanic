/*
  51_abyssal_searchlight.js
  Triple counter-rotating searchlight system. 3 beams (one per edge) rotate
  at irrational frequency ratios (1.0, -1.414, 0.618) so they never re-sync.
  TrianglePars ignite as each beam sweeps the apex; bars catch each beam's spot.

  E2 par visibility push: each par is now the pivot of its beam — it brightens
  continuously as the beam swings toward its own theta and dims as it swings
  away (a wide proximity gradient, not just a flash), plus a per-par baseline
  so the pivots are always visible (floor ≥ 0.22, peak ≥ 0.90).
*/

export var localSpeed = 0.5;
export var beamWidth = 0.35;
export var beamReach = 0.62;
export var beamPunch = 0.75;
export var trailLength = 0.40;
export var swirlMix = 0.45;
export var vintageBleed = 0.20;
export var blackoutDepth = 0.30;

export var cp1H = 0.55, cp1S = 0.78, cp1V = 0.85;
export var cp2H = 0.86, cp2S = 0.82, cp2V = 0.75;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderBeamWidth(v) { beamWidth = v; }
export function sliderBeamReach(v) { beamReach = v; }
export function sliderBeamPunch(v) { beamPunch = v; }
export function sliderTrailLength(v) { trailLength = v; }
export function sliderSwirlMix(v) { swirlMix = v; }
export function sliderVintageBleed(v) { vintageBleed = v; }
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

function clamp01(v) { if (v < 0.0) return 0.0; if (v > 1.0) return 1.0; return v; }
function wrap01(v) { v = v % 1.0; if (v < 0.0) v += 1.0; return v; }
function circDist(a, b) { var d = abs(a - b); if (d > 0.5) d = 1.0 - d; return d; }
function softPulse(dist, width) { var xVal = clamp01(1.0 - dist / width); return xVal * xVal * (3.0 - 2.0 * xVal); }

// Irrational rotation rates so the 3 beams never re-sync.
var BEAM_RATE_0 =  1.000;
var BEAM_RATE_1 = -1.414;     // -sqrt(2)
var BEAM_RATE_2 =  0.618;     // golden

var tBase = 0.0;
var tSwirl = 0.0;

export function beforeRender(delta) {
  var localMult = pow(2.0, (localSpeed - 0.5) * 4.0);
  var dt = (delta / 1310.72) * localMult;
  tBase  = tBase  + dt * (0.10 + beamReach * 0.35);
  tSwirl = tSwirl + dt * (0.22 + swirlMix * 0.50);
  _hsv2rgb1();
  _hsv2rgb2();
}

// Compute one beam's angular position (0..1).
function beamHead(rate, phaseOffset) {
  return wrap01(tBase * rate + phaseOffset);
}

export function render3D(index, x, y, z) {
  var isTriangleEdge = sectionId == 1;
  var isTrianglePar = sectionId == 2 && y > 2.0;
  var isBar = sectionId == 2 && y <= 2.0;
  var isVintage = sectionId == 3;

  var theta = wrap01((atan2(z, x) / PI2) + 0.5);
  var width = 0.020 + beamWidth * 0.085;

  // 3 beam heads — each tied to an edgeId (Rule 1: 1-1-1 cascade).
  var head0 = beamHead(BEAM_RATE_0, 0.0 / 3.0);
  var head1 = beamHead(BEAM_RATE_1, 1.0 / 3.0);
  var head2 = beamHead(BEAM_RATE_2, 2.0 / 3.0);

  // Beam intensity at this theta — per-beam so we can light pars selectively.
  var b0 = softPulse(circDist(theta, head0), width);
  var b1 = softPulse(circDist(theta, head1), width);
  var b2 = softPulse(circDist(theta, head2), width);
  var beamAny = b0; if (b1 > beamAny) beamAny = b1; if (b2 > beamAny) beamAny = b2;

  // Trails behind each beam (lagging by direction).
  var trail0 = softPulse(circDist(theta, wrap01(head0 - 0.04 - trailLength * 0.12)), width * (1.3 + trailLength));
  var trail1 = softPulse(circDist(theta, wrap01(head1 + 0.04 + trailLength * 0.12)), width * (1.3 + trailLength));
  var trail2 = softPulse(circDist(theta, wrap01(head2 - 0.04 - trailLength * 0.12)), width * (1.3 + trailLength));
  var trailAny = trail0; if (trail1 > trailAny) trailAny = trail1; if (trail2 > trailAny) trailAny = trail2;

  var stage = 0.0, white = 0.0, amber = 0.0, uv = 0.0;
  var mixv = clamp01(theta + b1 * 0.5);

  if (isTriangleEdge) {
    var edgeId = floor(index / 18.0);
    var edgeT = (index % 18) / 17.0;

    // Each edge is the "source" of its own beam — pulses travel out along it
    // at its own rate (Rule 1, 1-1-1 cascade).
    var sourceHead = 0.0;
    if (edgeId == 0) sourceHead = wrap01(tBase * BEAM_RATE_0 * 1.4);
    else if (edgeId == 1) sourceHead = wrap01(-tBase * BEAM_RATE_1 * 1.4 + 0.333);
    else sourceHead = wrap01(tBase * BEAM_RATE_2 * 1.4 + 0.667);

    var sourcePulse = softPulse(abs(edgeT - sourceHead), 0.040 + beamWidth * 0.060);
    var coreGlow = 0.25 + 0.20 * wave(edgeT * 4.0 + tBase * 2.0 + edgeId * 0.33);

    stage = clamp01(sourcePulse * (0.60 + beamPunch * 0.40) + coreGlow * 0.45);
    white = clamp01(sourcePulse * beamPunch * 0.80);
    uv    = clamp01(sourcePulse * 0.25);
    mixv  = clamp01(edgeId / 2.0 + sourcePulse * 0.40);
  } else if (isTrianglePar) {
    // Each par mapped to its edge's beam — bright when that beam is at apex.
    // E2 push: each par is the pivot of its beam — it tracks the rotational
    // distance of its assigned beam from its own theta, so it brightens as the
    // beam swings TOWARD it and dims as it swings AWAY (a continuous gradient,
    // not just a brief flash). Plus a per-par baseline so the pivots are always
    // visible.
    var parId = index - 54;
    var myHead = head0;
    if (parId == 1) myHead = head1;
    else if (parId == 2) myHead = head2;
    // Wide proximity curve — much wider than the bar spot, so the par reads
    // continuously as the beam orbits.
    var proximity = 1.0 - circDist(theta, myHead) * 2.0;  // 0..1, peak when aligned
    var pivot = pow(clamp01(proximity), 1.6);
    // Per-par baseline at unique phase (Rule A) — always-on pivot glow.
    var parPhase = parId / 3.0;
    var baseline = 0.22 + 0.18 * wave(tSwirl * 0.6 + parPhase);

    stage = clamp01(baseline + pivot * (0.55 + beamPunch * 0.45));
    white = clamp01(pivot * beamPunch * 0.95 + baseline * 0.20);
    amber = clamp01(pivot * 0.30 + baseline * 0.25);
    uv    = clamp01((1.0 - pivot) * baseline * 0.45);
    mixv = parId / 2.0;
  } else if (isBar) {
    var barLocal = index - 57;
    var barIndex = floor(barLocal / 18.0);
    var barT = (barLocal % 18) / 17.0;

    // Per-bar spot: the bar lights brightest at the pixel closest to the
    // beam's bar-internal position (different for each beam).
    var spot0 = softPulse(abs(barT - wrap01(head0 * 1.7 + barIndex * 0.071)), 0.060 + beamWidth * 0.070);
    var spot1 = softPulse(abs(barT - wrap01(head1 * 1.7 + barIndex * 0.107)), 0.060 + beamWidth * 0.070);
    var spot2 = softPulse(abs(barT - wrap01(head2 * 1.7 + barIndex * 0.139)), 0.060 + beamWidth * 0.070);
    var spotMax = spot0; if (spot1 > spotMax) spotMax = spot1; if (spot2 > spotMax) spotMax = spot2;

    // The bar also picks up the perimeter beam (theta-based) — moving spot.
    var azimuthalSpot = beamAny * (0.45 + 0.55 * wave(barT * 2.0 + tSwirl));

    // Subtle persistent ring so bars never go fully dark (Rule 3).
    var baseline = 0.16 + 0.08 * wave(barT * 5.0 + barIndex * 0.27 + tSwirl * 0.4);

    stage = clamp01(baseline + spotMax * 0.65 + azimuthalSpot * 0.55 + trailAny * 0.20);
    white = clamp01(spotMax * beamPunch * 0.55 + azimuthalSpot * 0.35);
    uv    = clamp01(trailAny * trailLength * 0.45);
    mixv  = clamp01(theta + spotMax * 0.40);
  } else if (isVintage) {
    amber = beamAny * vintageBleed * (0.40 + 0.30 * wave(tSwirl + index * 0.09));
    stage = amber * 0.12;
    mixv = theta;
  }

  var floorGlow = (1.0 - blackoutDepth) * 0.018;
  var brightness = floorGlow + stage * (0.55 + beamPunch * 0.25);
  if (isVintage) brightness = floorGlow * 0.30 + stage;
  // Pars: stronger curve so the pivot gradient + beam alignment punches.
  if (isTrianglePar) brightness = 0.14 + stage * (0.78 + beamPunch * 0.20);

  var r = (pr1 + (pr2 - pr1) * mixv) * brightness;
  var g = (pg1 + (pg2 - pg1) * mixv) * brightness;
  var b = (pb1 + (pb2 - pb1) * mixv) * brightness;

  rgbwau(clamp01(r), clamp01(g), clamp01(b), clamp01(white), clamp01(amber), clamp01(uv));
}
