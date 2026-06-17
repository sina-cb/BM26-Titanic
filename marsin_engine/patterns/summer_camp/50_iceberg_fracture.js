/*
  iceberg_fracture
  Three cracks propagate up the TriangleEdges (one per edgeId at phase
  edgeId/3.0). When a crack reaches the apex, its matching TrianglePar bursts
  white. BarLights render an ice-shard texture: jagged white peaks on a
  cool-blue base, plus a slow lateral drift.

  Enhancements (D3 push):
  - Fixed dimness cascade (palette V, blackoutDepth, stage multipliers).
  - 1-1-1 cascade across edges; pars active per-edge burst.
  - Bar pixel art: jagged shard peaks + cool background, never dark.

  E2 par visibility push: each par is its own "fracture epicenter" — halo +
  rising tension + per-par micro-crackle on top of the apex-hit burst, with
  an undampened brightness path so the corners are visibly cracking at all
  times (floor ≥ 0.22, peak ≥ 0.90).
*/

export var localSpeed = 0.5;
export var fractureDensity = 0.55;
export var branchSpread = 0.46;
export var strikeDecay = 0.55;
export var aftershockWarmth = 0.20;
export var laneCount = 0.50;
export var shardJag = 0.55;
export var blackoutDepth = 0.30;

export var cp1H = 0.55, cp1S = 0.32, cp1V = 0.92;
export var cp2H = 0.62, cp2S = 0.78, cp2V = 0.80;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderFractureDensity(v) { fractureDensity = v; }
export function sliderBranchSpread(v) { branchSpread = v; }
export function sliderStrikeDecay(v) { strikeDecay = v; }
export function sliderAftershockWarmth(v) { aftershockWarmth = v; }
export function sliderLaneCount(v) { laneCount = v; }
export function sliderShardJag(v) { shardJag = v; }
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
var tShimmer = 0.0;

export function beforeRender(delta) {
  var localMult = pow(2.0, (localSpeed - 0.5) * 4.0);
  var dt = (delta / 1310.72) * localMult;
  tStrike = tStrike + dt * (0.22 + fractureDensity * 0.85);
  tBranch = tBranch + dt * (0.38 + branchSpread * 1.20);
  tShimmer = tShimmer + dt * 0.32;
  _hsv2rgb1();
  _hsv2rgb2();
}

export function render3D(index, x, y, z) {
  var isTriangleEdge = sectionId == 1;
  var isTrianglePar = sectionId == 2 && y > 2.0;
  var isBar = sectionId == 2 && y <= 2.0;
  var isVintage = sectionId == 3;
  var theta = wrap01((atan2(z, x) / PI2) + 0.5);
  var lanes = floor(4.0 + laneCount * 9.0);
  var stage = 0.0, white = 0.0, amber = 0.0, uv = 0.0;

  if (isTriangleEdge) {
    // 3 cracks propagate up each edge, one per edgeId, phase = edgeId/3.0.
    // KEY GESTURE: per-edge unique phase (Rule 1), crack head climbs edgeT.
    var edgeId = floor(index / 18.0);
    var edgeT = (index % 18) / 17.0;
    var crackHead = wrap01(tStrike + edgeId / 3.0);
    var crackWidth = 0.028 + branchSpread * 0.060;
    var crack = softPulse(abs(edgeT - crackHead), crackWidth);
    // Splinter texture on the edge — jagged side-branches off the main crack.
    var splinter = pow(wave(edgeT * (3.0 + branchSpread * 6.0) + tBranch + edgeId * 0.27), 4.5);
    splinter = splinter * crack * 0.55;
    // Cool background shimmer so edges never go fully dark.
    var shimmer = 0.10 + 0.08 * wave(tShimmer + edgeT * 1.7 + edgeId * 0.41);
    stage = clamp01(shimmer + crack * (0.55 + fractureDensity * 0.55) + splinter);
    white = clamp01(crack * (0.62 + strikeDecay * 0.42));
    uv = clamp01(crack * 0.45 + splinter * 0.30);
  } else if (isBar) {
    // Ice-shard texture: jagged white peaks on a cool base.
    var barLocal = index - 57;
    var barIdx = floor(barLocal / 18.0);
    var barT = (barLocal % 18) / 17.0;
    // Three crack waves drift around the ring at different speeds.
    var w1 = softPulse(circDist(theta, wrap01(tBranch * 0.22 + 0.00)), 0.045 + branchSpread * 0.08);
    var w2 = softPulse(circDist(theta, wrap01(tBranch * 0.33 + 0.37)), 0.040 + branchSpread * 0.07) * 0.72;
    var w3 = softPulse(circDist(theta, wrap01(tBranch * 0.41 + 0.71)), 0.035 + branchSpread * 0.06) * 0.55;
    var arc = clamp01(w1 + w2 + w3);
    // Jagged shard peaks along the bar — high-frequency wave gated by lane.
    var shardPeak = pow(wave(barT * lanes + tShimmer + barIdx * 0.137), 6.0 + shardJag * 4.0);
    // Cool base wash so bars are always present.
    var base = 0.18 + 0.12 * wave(tShimmer * 0.6 + barT * 0.8 + barIdx * 0.19);
    stage = clamp01(base + arc * (0.45 + fractureDensity * 0.55) + shardPeak * 0.55);
    white = clamp01(shardPeak * 0.65 + arc * 0.32);
    uv = clamp01(arc * (0.32 + branchSpread * 0.35) + shardPeak * 0.20);
  } else if (isTrianglePar) {
    // PARS ACTIVE (Rule 2): each par bursts when its matching crack reaches apex.
    // parId 0/1/2 maps to the matching edgeId; burst when crackHead approaches 1.
    // E2 push: each par is its own "fracture epicenter" — it crackles continuously
    // at its own micro-rate, plus a strong burst on apex hit. Pars are now bright
    // year-round, not just on the moment of impact.
    var parId = index - 54;
    var parCrackHead = wrap01(tStrike + parId / 3.0);
    // Burst when head is near apex (parCrackHead near 1.0, i.e. near 0 after wrap).
    var apexHit = softPulse(circDist(parCrackHead, 0.97), 0.07 + fractureDensity * 0.12);
    // Pre-burst tension: ramps up as crack head approaches apex.
    var tension = pow(parCrackHead, 2.5);
    // Micro-crackle unique to this par (high-freq wave gated by per-par phase).
    var crackle = pow(wave(tBranch * (1.7 + parId * 0.31) + parId * 0.137), 5.0);
    // Counter-rhythm low halo so pars are not dead between bursts.
    var halo = 0.22 + 0.18 * wave(tShimmer * 0.7 + parId * 0.41);
    stage = clamp01(halo + tension * 0.35 + crackle * 0.40 + apexHit * (0.55 + fractureDensity * 0.55));
    white = clamp01(apexHit * 0.90 + crackle * 0.45);
    uv = clamp01(apexHit * 0.45 + tension * 0.30 + halo * 0.18);
  } else if (isVintage) {
    var vintageLocal = index - 291;
    var delayed = softPulse(circDist(wrap01(tStrike - 0.30), 0.0), 0.10 + strikeDecay * 0.14);
    amber = clamp01(delayed * aftershockWarmth * (0.55 + 0.45 * wave(tBranch + vintageLocal * 0.061)));
    stage = amber * 0.08;
  }

  var laneMix = pow(wave(theta * lanes + tBranch), 3.0);
  var colorMix = clamp01(0.20 + laneMix * 0.40 + stage * 0.30);
  var brightness = (1.0 - blackoutDepth) * 0.040 + stage * (0.40 + fractureDensity * 0.35);
  // Pars: stronger curve so the epicenter bursts read across the dome.
  if (isTrianglePar) brightness = 0.14 + stage * (0.78 + fractureDensity * 0.20);
  var r = (pr1 + (pr2 - pr1) * colorMix) * brightness;
  var g = (pg1 + (pg2 - pg1) * colorMix) * brightness;
  var b = (pb1 + (pb2 - pb1) * colorMix) * brightness;
  rgbwau(clamp01(r), clamp01(g), clamp01(b), clamp01(white), clamp01(amber), clamp01(uv));
}
