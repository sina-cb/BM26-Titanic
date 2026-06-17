/*
  iceberg_shear_line
  A wide ice wall slices through the ring, leaving one side submerged and the
  other side retreating into faint warm memory.

  APEX edge rhythm: 1-1-1 cascade — 3 INDEPENDENT shear lines, one per
  TriangleEdge, each at its own phase via edgeId / 3.0. Creative wave:
  edge 0 shears forward, edge 1 shears in REVERSE (mirror), edge 2
  finishes forward, so the gesture sweeps the triangle as a loop.
  TrianglePars (idx 54,55,56) pop on a half-beat — each par independently
  flashes as the shear blade crosses its corner, so they read as 3rd
  voice in the cascade rather than a synchronous trio.
  Bar "nice dotted pattern" preserved.

  E2 par visibility push: pars now also carry a rising STRESS gradient (bright
  as the blade approaches their corner, dim when far) on top of a per-par
  baseline shimmer, with an undampened brightness path so the indicators
  always read (floor ≥ 0.22, peak ≥ 0.90 on crossing).
*/

export var localSpeed = 0.5;
export var shearAngle = 0.45;
export var shearWidth = 0.32;
export var advance = 0.54;
export var submergeDepth = 0.68;
export var warmthRetreat = 0.24;
export var triangleBlade = 0.70;

export var cp1H = 0.52, cp1S = 0.26, cp1V = 0.70;
export var cp2H = 0.65, cp2S = 0.86, cp2V = 0.48;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }
export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderShearAngle(v) { shearAngle = v; }
export function sliderShearWidth(v) { shearWidth = v; }
export function sliderAdvance(v) { advance = v; }
export function sliderSubmergeDepth(v) { submergeDepth = v; }
export function sliderWarmthRetreat(v) { warmthRetreat = v; }
export function sliderTriangleBlade(v) { triangleBlade = v; }

var pr1 = 1, pg1 = 0, pb1 = 0;
var pr2 = 0, pg2 = 0, pb2 = 1;
function hsv1() { var hv = cp1H - floor(cp1H); if (hv < 0) hv += 1; var iv = floor(hv * 6) % 6; var fv = hv * 6 - floor(hv * 6); var pv = cp1V * (1 - cp1S); var qv = cp1V * (1 - fv * cp1S); var tv = cp1V * (1 - (1 - fv) * cp1S); if (iv == 0) { pr1 = cp1V; pg1 = tv; pb1 = pv; } else if (iv == 1) { pr1 = qv; pg1 = cp1V; pb1 = pv; } else if (iv == 2) { pr1 = pv; pg1 = cp1V; pb1 = tv; } else if (iv == 3) { pr1 = pv; pg1 = qv; pb1 = cp1V; } else if (iv == 4) { pr1 = tv; pg1 = pv; pb1 = cp1V; } else { pr1 = cp1V; pg1 = pv; pb1 = qv; } }
function hsv2() { var hv = cp2H - floor(cp2H); if (hv < 0) hv += 1; var iv = floor(hv * 6) % 6; var fv = hv * 6 - floor(hv * 6); var pv = cp2V * (1 - cp2S); var qv = cp2V * (1 - fv * cp2S); var tv = cp2V * (1 - (1 - fv) * cp2S); if (iv == 0) { pr2 = cp2V; pg2 = tv; pb2 = pv; } else if (iv == 1) { pr2 = qv; pg2 = cp2V; pb2 = pv; } else if (iv == 2) { pr2 = pv; pg2 = cp2V; pb2 = tv; } else if (iv == 3) { pr2 = pv; pg2 = qv; pb2 = cp2V; } else if (iv == 4) { pr2 = tv; pg2 = pv; pb2 = cp2V; } else { pr2 = cp2V; pg2 = pv; pb2 = qv; } }
function clamp01(v) { if (v < 0.0) return 0.0; if (v > 1.0) return 1.0; return v; }
function wrap01(v) { v = v % 1.0; if (v < 0.0) v += 1.0; return v; }
function circDist(a, b) { var d = abs(a - b); if (d > 0.5) d = 1.0 - d; return d; }
function softPulse(dist, width) { var px = clamp01(1.0 - dist / width); return px * px * (3.0 - 2.0 * px); }

var shearPhase = 0.0;
var splinterPhase = 0.0;
export function beforeRender(delta) {
  var localMult = pow(2.0, (localSpeed - 0.5) * 4.0);
  var dt = (delta / 1310.72) * localMult;
  shearPhase = shearPhase + dt * (0.12 + advance * 0.90);
  splinterPhase = splinterPhase + dt * (0.32 + triangleBlade * 0.72);
  hsv1(); hsv2();
}

export function render3D(index, x, y, z) {
  var isEdge = sectionId == 1;
  var isPar = sectionId == 2 && y > 2.0;
  var isBar = sectionId == 2 && y <= 2.0;
  var isVintage = sectionId == 3;
  var theta = wrap01((atan2(z, x) / PI2) + 0.5);
  var blade = wrap01(shearPhase + shearAngle * 0.42 + (wave(splinterPhase * 0.33) - 0.5) * 0.08);
  var width = 0.012 + shearWidth * 0.120;
  var dist = circDist(theta, blade);
  var edge = softPulse(dist, width);
  var iceSide = dist < (0.22 + shearWidth * 0.16) ? 1.0 : 0.0;
  var stage = 0.0, white = 0.0, amber = 0.0, uv = 0.0;

  if (isBar) {
    var barT = ((index - 57) % 18) / 17.0;
    var verticalCrack = softPulse(abs(barT - wrap01(shearPhase * 1.38 + theta * 0.20)), 0.030 + shearWidth * 0.060);
    var splinter = pow(wave(theta * 11.0 + barT * 3.0 + splinterPhase), 6.0);
    stage = edge * (0.40 + triangleBlade * 0.28) + verticalCrack * splinter * 0.35;
    stage = stage * (0.32 + submergeDepth * 0.44);
    white = edge * triangleBlade + verticalCrack * splinter * 0.28;
    uv = iceSide * submergeDepth * 0.12 + edge * 0.38;
  } else if (isEdge) {
    var edgeId = floor(index / 18.0);
    var edgeT = (index % 18) / 17.0;
    // 1-1-1 cascade: each edge owns a unique phase via edgeId / 3.0
    var edgePhase = edgeId / 3.0;
    // Creative: edge 1 shears in REVERSE so the gesture loops around the triangle
    var dirSign = (edgeId == 1) ? -1.0 : 1.0;
    var bladePos = wrap01(shearPhase * 1.15 * dirSign + edgePhase);
    var bladeLine = softPulse(circDist(edgeT, bladePos), 0.022 + shearWidth * 0.075);
    // Crack line uses the SAME edgePhase but a different speed so it never re-pairs the edges
    var crackLine = pow(wave(edgeT * 4.0 - splinterPhase * dirSign + edgePhase), 7.0);
    stage = (bladeLine + crackLine * edge * 0.35) * (0.35 + triangleBlade * 0.70);
    white = bladeLine * triangleBlade;
    uv = crackLine * 0.20;
  } else if (isPar) {
    // Pars (idx 54,55,56) — stress-fracture indicators per corner.
    // E2 push: pars now hold a per-par stress baseline (rising as the shear
    // blade approaches their corner), with a strong pop on crossing. Each par
    // at its unique phase via parId/3.0 (Rule A).
    var parId = index - 54;
    var parPhase = parId / 3.0;
    // Pop when the global shear blade crosses this par's "corner" phase
    var cornerCross = softPulse(circDist(blade, parPhase), 0.050 + shearWidth * 0.090);
    // Rising stress: bright when blade is close, dim when far. Continuous gradient.
    var stress = 1.0 - circDist(blade, parPhase) * 2.0;       // 0..1
    var stressPow = pow(clamp01(stress), 1.4);
    // Independent shimmer at half-beat
    var shimmer = pow(wave(splinterPhase * 0.50 + parPhase), 6.0);
    // Always-on baseline so the stress indicator is never dark.
    var baseline = 0.22 + 0.18 * wave(splinterPhase * 0.7 + parId * 0.41);
    stage = clamp01(baseline + stressPow * 0.40 + cornerCross * (0.55 + triangleBlade * 0.45) + shimmer * 0.30);
    white = clamp01(cornerCross * (0.65 + triangleBlade * 0.35) + shimmer * 0.30);
    uv = clamp01(stressPow * 0.40 + cornerCross * 0.35 + baseline * 0.15);
  } else if (isVintage) {
    amber = (1.0 - iceSide) * warmthRetreat * 0.14 * wave(splinterPhase * 0.7 + index * 0.047);
    stage = amber * 0.065;
  }

  var mixv = clamp01(iceSide * 0.72 + edge * 0.25);
  var bri = (1.0 - submergeDepth) * 0.010 + stage;
  // Pars: stronger curve so the stress + crossing reads regardless of submerge.
  if (isPar) bri = 0.14 + stage * (0.78 + triangleBlade * 0.20);
  rgbwau(
    clamp01((pr1 + (pr2 - pr1) * mixv) * bri),
    clamp01((pg1 + (pg2 - pg1) * mixv) * bri),
    clamp01((pb1 + (pb2 - pb1) * mixv) * bri),
    clamp01(white), clamp01(amber), clamp01(uv)
  );
}
