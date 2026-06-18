/*
  47_apex_perimeter_ping.js
  APEX cascade: 3 edge pings fire at unique 1-1-1 phase offsets, each one
  detonating its matching TrianglePar corona when the ping reaches the apex.
  Bars carry a slow echo ring of the ping; a golden-ratio ghost ping trails.

  E2 par visibility push: pars now hold a per-par baseline glow at unique
  phases between cascade hits so the three corners are always visibly lit;
  cascade burst still snaps bright on arrival (floor ≥ 0.22, peak ≥ 0.90).
*/

export var localSpeed = 0.5;
export var pingWidth = 0.34;
export var ghostMix = 0.55;
export var coronaImpact = 0.70;
export var trailDecay = 0.52;
export var ringEcho = 0.62;
export var vintageMidpoint = 0.26;
export var blackoutDepth = 0.32;

export var cp1H = 0.53, cp1S = 0.92, cp1V = 0.85;
export var cp2H = 0.08, cp2S = 0.94, cp2V = 0.80;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderPingWidth(v) { pingWidth = v; }
export function sliderGhostMix(v) { ghostMix = v; }
export function sliderCoronaImpact(v) { coronaImpact = v; }
export function sliderTrailDecay(v) { trailDecay = v; }
export function sliderRingEcho(v) { ringEcho = v; }
export function sliderVintageMidpoint(v) { vintageMidpoint = v; }
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

// Golden ratio offset for the ghost ping so it never aligns with the lead.
var GOLDEN = 0.61803;

// Per-edge corona decay state — keyed by edgeId 0/1/2.
var coronaA0 = 0.0, coronaA1 = 0.0, coronaA2 = 0.0;
var lastT0 = 0.0,  lastT1 = 0.0,  lastT2 = 0.0;

var tPing = 0.0;
var tRing = 0.0;
var tGhost = 0.0;

export function beforeRender(delta) {
  var localMult = pow(2.0, (localSpeed - 0.5) * 4.0);
  var dt = (delta / 1310.72) * localMult;

  tPing  = tPing  + dt * 0.55;       // lead ping cadence
  tRing  = tRing  + dt * 0.18;       // slow bar echo
  tGhost = tGhost + dt * (0.55 * GOLDEN);

  // Per-edge cascade phases — strictly unique 0, 1/3, 2/3 (Rule 1).
  var t0 = wrap01(tPing + 0.0 / 3.0);
  var t1 = wrap01(tPing + 1.0 / 3.0);
  var t2 = wrap01(tPing + 2.0 / 3.0);

  // Wrap detection -> trigger that edge's corona burst.
  if (t0 < lastT0) coronaA0 = 1.0;
  if (t1 < lastT1) coronaA1 = 1.0;
  if (t2 < lastT2) coronaA2 = 1.0;
  lastT0 = t0; lastT1 = t1; lastT2 = t2;

  // Corona decays each frame; trailDecay controls how long it lingers.
  var decay = clamp01(dt * (3.5 - trailDecay * 2.4));
  coronaA0 = clamp01(coronaA0 - decay);
  coronaA1 = clamp01(coronaA1 - decay);
  coronaA2 = clamp01(coronaA2 - decay);

  _hsv2rgb1();
  _hsv2rgb2();
}

export function render3D(index, x, y, z) {
  var isTriangleEdge = sectionId == 1;
  var isTrianglePar = sectionId == 2 && y > 2.0;
  var isBar = sectionId == 2 && y <= 2.0;
  var isVintage = sectionId == 3;

  var theta = wrap01((atan2(z, x) / PI2) + 0.5);
  var width = 0.028 + pingWidth * 0.115;
  var stage = 0.0, white = 0.0, amber = 0.0, uv = 0.0;
  var mixv = 0.0;

  if (isTriangleEdge) {
    var edgeId = floor(index / 18.0);
    var edgeT = (index % 18) / 17.0;
    var phaseOffset = edgeId / 3.0;          // 0, 0.333, 0.667 — Rule 1.
    var head = wrap01(tPing + phaseOffset);
    var ghost = wrap01(tGhost + phaseOffset + GOLDEN);

    var leadPulse = softPulse(abs(edgeT - head), width);
    var ghostPulse = softPulse(abs(edgeT - ghost), width * 0.55) * ghostMix;

    stage = clamp01((leadPulse + ghostPulse * 0.65) * 0.95);
    white = clamp01(leadPulse * 0.70);
    uv    = clamp01(ghostPulse * 0.45);
    // Mix lead/ghost by edgeId so each edge favours a slightly different hue.
    mixv = clamp01(phaseOffset * 0.45 + leadPulse * 0.30 + ghostPulse * 0.45);
  } else if (isTrianglePar) {
    // E2 push: pars hold a per-par baseline glow between cascade hits so they
    // never go dark; cascade burst still snaps bright on arrival.
    var parId = index - 54;                  // 0, 1, 2
    var myCorona = 0.0;
    if (parId == 0) myCorona = coronaA0;
    else if (parId == 1) myCorona = coronaA1;
    else myCorona = coronaA2;

    // Corona shape: bright snap then quadratic decay.
    var burst = myCorona * myCorona;
    // Per-par baseline at unique phase so the three pars breathe out of sync.
    var parPhase = parId / 3.0;
    var baseline = 0.22 + 0.18 * wave(tRing * 1.4 + parPhase);
    stage = clamp01(baseline + burst * (0.55 + coronaImpact * 0.45));
    white = clamp01(burst * (0.65 + coronaImpact * 0.30) + baseline * 0.25);
    amber = clamp01(burst * 0.35 + baseline * 0.20);
    uv    = clamp01(burst * 0.30);
    mixv = parId / 2.0;
  } else if (isBar) {
    var barLocal = index - 57;
    var barIndex = floor(barLocal / 18.0);
    var barT = (barLocal % 18) / 17.0;

    // Echo ring travels around the perimeter at a slow rate; each bar offset
    // by its own theta so the wave reads as continuous around the ring.
    var ringHead = wrap01(tRing);
    var ringPulse = softPulse(circDist(theta, ringHead), 0.045 + ringEcho * 0.090);

    // Per-bar internal traveling pulse synced to the apex ping cascade.
    var localHead = wrap01(tPing * 1.4 + barIndex * 0.083);
    var travel = softPulse(abs(barT - localHead), 0.060 + pingWidth * 0.080) * 0.55;

    // A persistent dotted baseline so bars never go dark (Rule 3).
    var baseline = 0.18 + 0.10 * wave(barT * 6.0 + barIndex * 0.13 + tRing * 0.6);

    stage = clamp01(baseline + ringPulse * 0.75 + travel * ringEcho);
    white = clamp01(ringPulse * 0.50 + travel * 0.30);
    uv    = clamp01(travel * trailDecay * 0.40);
    mixv  = clamp01(theta + ringPulse * 0.40);
  } else if (isVintage) {
    var vintageLocal = index - 291;
    var fixtureNo = floor(vintageLocal / 6.0);
    var mid = softPulse(circDist(theta, wrap01(0.58 + fixtureNo * 0.013)), 0.12);
    amber = mid * vintageMidpoint * 0.6;
    stage = amber * 0.10;
    mixv = theta;
  }

  var floorGlow = (1.0 - blackoutDepth) * 0.020;
  var brightness = floorGlow + stage * (0.55 + pingWidth * 0.30);
  if (isVintage) brightness = floorGlow * 0.30 + stage;
  // Pars: stronger curve so cascade arrivals punch and baseline holds visible.
  if (isTrianglePar) brightness = 0.15 + stage * (0.80 + coronaImpact * 0.20);

  var r = (pr1 + (pr2 - pr1) * mixv) * brightness;
  var g = (pg1 + (pg2 - pg1) * mixv) * brightness;
  var b = (pb1 + (pb2 - pb1) * mixv) * brightness;

  rgbwau(clamp01(r), clamp01(g), clamp01(b), clamp01(white), clamp01(amber), clamp01(uv));
}
