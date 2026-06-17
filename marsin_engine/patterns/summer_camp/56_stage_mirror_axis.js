/*
  stage_mirror_axis
  A mirror-symmetric "stage" axis with a SECOND axis rotating at golden ratio
  offset so the mirror itself drifts. TriangleEdges carry a tracer per edge
  (1-1-1 cascade at edgeId/3.0); the matching TrianglePar lights up when the
  tracer reaches the corner. BarLights mirror the axis reflection onto the
  perimeter ring with per-bar phase offsets. A low background breathing wash
  keeps the rig present at all times.

  Enhancements (D3 push):
  - Second golden-ratio axis (drift over time).
  - Per-edge tracer (1-1-1 cascade) + corner-hit pars (Rule 2 active).
  - Bar reflection with per-bar offset phasing.
  - Breathing background wash; bright defaults.

  E2 par visibility push: each par is now an "axis endpoint" — it brightens
  continuously when the mirror axis (A or drifting B) aligns with its corner
  phase (wide gradient, not just a flash), plus a strong burst on tracer
  arrival, and an anchored unique hue per par (floor ≥ 0.22, peak ≥ 0.90).
*/

export var localSpeed = 0.5;
export var center = 0.0;
export var mirrorWidth = 0.36;
export var orbitSpeed = 0.46;
export var particleDensity = 0.42;
export var stageFocus = 0.62;
export var axisDrift = 0.45;
export var blackoutDepth = 0.30;
export var uvEdge = 0.36;
export var centerGuide = 0.0;

export var cp1H = 0.55, cp1S = 0.82, cp1V = 0.85;
export var cp2H = 0.82, cp2S = 0.72, cp2V = 0.78;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderCenter(v) { center = v; }
export function sliderMirrorWidth(v) { mirrorWidth = v; }
export function sliderOrbitSpeed(v) { orbitSpeed = v; }
export function sliderParticleDensity(v) { particleDensity = v; }
export function sliderStageFocus(v) { stageFocus = v; }
export function sliderAxisDrift(v) { axisDrift = v; }
export function sliderBlackoutDepth(v) { blackoutDepth = v; }
export function sliderUvEdge(v) { uvEdge = v; }
export function sliderCenterGuide(v) { centerGuide = v; }

var pr1 = 1, pg1 = 0, pb1 = 0;
var pr2 = 0, pg2 = 0, pb2 = 1;

function hsv1() {
  var hv = cp1H - floor(cp1H); if (hv < 0.0) hv += 1.0;
  var iv = floor(hv * 6.0) % 6;
  var fv = hv * 6.0 - floor(hv * 6.0);
  var pv = cp1V * (1.0 - cp1S);
  var qv = cp1V * (1.0 - fv * cp1S);
  var tv = cp1V * (1.0 - (1.0 - fv) * cp1S);
  if (iv == 0) { pr1 = cp1V; pg1 = tv; pb1 = pv; }
  else if (iv == 1) { pr1 = qv; pg1 = cp1V; pb1 = pv; }
  else if (iv == 2) { pr1 = pv; pg1 = cp1V; pb1 = tv; }
  else if (iv == 3) { pr1 = pv; pg1 = qv; pb1 = cp1V; }
  else if (iv == 4) { pr1 = tv; pg1 = pv; pb1 = cp1V; }
  else { pr1 = cp1V; pg1 = pv; pb1 = qv; }
}

function hsv2() {
  var hv = cp2H - floor(cp2H); if (hv < 0.0) hv += 1.0;
  var iv = floor(hv * 6.0) % 6;
  var fv = hv * 6.0 - floor(hv * 6.0);
  var pv = cp2V * (1.0 - cp2S);
  var qv = cp2V * (1.0 - fv * cp2S);
  var tv = cp2V * (1.0 - (1.0 - fv) * cp2S);
  if (iv == 0) { pr2 = cp2V; pg2 = tv; pb2 = pv; }
  else if (iv == 1) { pr2 = qv; pg2 = cp2V; pb2 = pv; }
  else if (iv == 2) { pr2 = pv; pg2 = cp2V; pb2 = tv; }
  else if (iv == 3) { pr2 = pv; pg2 = qv; pb2 = cp2V; }
  else if (iv == 4) { pr2 = tv; pg2 = pv; pb2 = cp2V; }
  else { pr2 = cp2V; pg2 = pv; pb2 = qv; }
}

function clamp01(v) { if (v < 0.0) return 0.0; if (v > 1.0) return 1.0; return v; }
function wrap01(v) { v = v % 1.0; if (v < 0.0) v += 1.0; return v; }
function circDist(a, b) { var d = abs(a - b); if (d > 0.5) d = 1.0 - d; return d; }
function softPulse(dist, width) { var px = clamp01(1.0 - dist / width); return px * px * (3.0 - 2.0 * px); }

var orbitPhase = 0.0;
var sparklePhase = 0.0;
var driftPhase = 0.0;
var breathPhase = 0.0;

export function beforeRender(delta) {
  var localMult = pow(2.0, (localSpeed - 0.5) * 4.0);
  var dt = (delta / 1310.72) * localMult;
  orbitPhase = orbitPhase + dt * (0.16 + orbitSpeed * 0.92);
  sparklePhase = sparklePhase + dt * (0.62 + particleDensity * 1.80);
  driftPhase = driftPhase + dt * (0.04 + axisDrift * 0.18);
  breathPhase = breathPhase + dt * 0.24;
  hsv1(); hsv2();
}

export function render3D(index, x, y, z) {
  var isEdge = sectionId == 1;
  var isPar = sectionId == 2 && y > 2.0;
  var isBar = sectionId == 2 && y <= 2.0;
  var isVintage = sectionId == 3;

  var theta = wrap01((atan2(z, x) / PI2) + 0.5);
  // Primary axis (operator-controlled) and second golden-ratio drifting axis.
  // KEY GESTURE: second mirror axis at φ-offset, slowly rotating.
  var axisA = wrap01(center);
  var axisB = wrap01(center + 0.6180339887 + driftPhase);

  var mirroredA = circDist(theta, axisA) * 2.0;
  var mirroredB = circDist(theta, axisB) * 2.0;

  var width = 0.014 + mirrorWidth * 0.115;
  var outward = wrap01(orbitPhase);
  var inward = wrap01(1.0 - orbitPhase * 0.63);
  var beamA = softPulse(circDist(mirroredA, outward), width);
  var beamB = softPulse(circDist(mirroredA, inward), width * 0.70) * 0.70;
  var beamA2 = softPulse(circDist(mirroredB, outward), width * 0.85) * 0.65;

  var axisLineA = softPulse(circDist(theta, axisA), 0.008 + stageFocus * 0.030);
  var axisLineB = softPulse(circDist(theta, axisB), 0.008 + stageFocus * 0.024) * 0.65;
  var oppositeLine = softPulse(circDist(theta, wrap01(axisA + 0.5)), 0.006 + mirrorWidth * 0.022) * 0.45;

  var particle = pow(wave(mirroredA * (7.0 + particleDensity * 18.0) + sparklePhase + index * 0.017), 7.0 - particleDensity * 3.0);

  // Always-on breathing wash so the rig never goes dead.
  var breath = 0.10 + 0.08 * wave(breathPhase + theta * 0.6);

  var stage = 0.0, white = 0.0, amber = 0.0, uv = 0.0;

  if (isBar) {
    var barLocal = index - 57;
    var barIdx = floor(barLocal / 18.0);
    var barT = (barLocal % 18) / 17.0;
    // Per-bar offset: the mirror reflection onto the ring with per-bar
    // phasing so adjacent bars carry slightly out-of-phase wash.
    var barPhase = barIdx / 11.0;
    var ringReflect = softPulse(circDist(theta, wrap01(axisA + barT * 0.10 + barPhase * 0.05)), 0.030 + mirrorWidth * 0.06);
    var ringReflectB = softPulse(circDist(theta, wrap01(axisB - barT * 0.08 + barPhase * 0.07)), 0.028 + mirrorWidth * 0.05) * 0.62;
    var vertical = wave(barT * 1.35 - orbitPhase * 1.7 + mirroredA * 0.22 + barPhase * 0.5);
    stage = breath + (beamA + beamB + beamA2 + particle * particleDensity * 0.35) * (0.32 + vertical * 0.62);
    stage = stage + (ringReflect + ringReflectB) * (0.40 + stageFocus * 0.45);
    stage = stage + axisLineA * stageFocus * 0.42 + axisLineB * stageFocus * 0.30 + oppositeLine * 0.20;
    white = axisLineA * stageFocus * 0.50 + axisLineB * stageFocus * 0.35 + beamA * 0.22;
    uv = (beamB + beamA2 * 0.5 + particle * 0.20 + oppositeLine) * uvEdge;
  } else if (isEdge) {
    var edgeId = floor(index / 18.0);
    var edgeT = (index % 18) / 17.0;
    // PER-EDGE UNIQUE PHASE (Rule 1): tracer point per edge, phase = edgeId/3.0.
    // KEY GESTURE: tracer moves along edgeT, lighting the matching corner par
    // when it reaches the end.
    var tracerPos = wrap01(orbitPhase + edgeId / 3.0);
    var tracer = softPulse(abs(edgeT - tracerPos), 0.040 + stageFocus * 0.08);
    var mirroredEdge = circDist(edgeT, edgeId * 0.333) * 2.0;
    var core = softPulse(circDist(mirroredEdge, wrap01(orbitPhase * 0.82)), 0.030 + stageFocus * 0.075);
    stage = breath * 0.6 + core * (0.34 + stageFocus * 0.62) + tracer * (0.50 + stageFocus * 0.50) + axisLineA * 0.14;
    white = clamp01(core * stageFocus + tracer * 0.55);
    uv = (core + tracer * 0.45) * uvEdge * 0.30;
  } else if (isPar) {
    // PARS ACTIVE (Rule 2): par lights up when its matching edge tracer hits
    // the apex corner. E2 push: each par is an "axis endpoint" — it lights
    // brightly when the mirror axis points THROUGH its corner, plus a strong
    // burst when the tracer arrives. Per-par phase via parId/3.
    var parId = index - 54;
    var parPhase = parId / 3.0;
    var parTracer = wrap01(orbitPhase + parPhase);
    var cornerHit = softPulse(circDist(parTracer, 0.97), 0.07 + stageFocus * 0.11);
    // Axis alignment: bright when either axis (A or drifting B) points at this
    // par's corner phase. Wide gradient so it's a continuous gesture.
    var axisAlignA = 1.0 - circDist(axisA, parPhase) * 2.0;
    var axisAlignB = 1.0 - circDist(axisB, parPhase) * 2.0;
    var endpoint = pow(clamp01(axisAlignA), 1.4) * 0.65 + pow(clamp01(axisAlignB), 1.4) * 0.45;
    // Halo from the drifting axis so pars are never fully off (Rule B floor).
    var parHalo = 0.22 + 0.16 * wave(breathPhase * 0.8 + parId * 0.41);
    stage = clamp01(parHalo + endpoint * (0.45 + stageFocus * 0.35) + cornerHit * (0.55 + stageFocus * 0.45));
    white = clamp01(cornerHit * (0.65 + stageFocus * 0.35) + endpoint * stageFocus * 0.35);
    uv = clamp01((cornerHit * 0.35 + endpoint * 0.25 + parHalo * 0.20) * uvEdge);
  } else if (isVintage) {
    amber = (beamA + beamB + beamA2) * 0.12 * (0.55 + 0.45 * wave(sparklePhase * 0.45 + index * 0.047));
    stage = amber * 0.08;
  }

  var darkFloor = (1.0 - blackoutDepth) * 0.030;
  var mixv = clamp01(0.16 + mirroredA * 0.30 + mirroredB * 0.20 + particle * 0.30 + axisLineA * 0.22);
  // Pars get an anchored hue per parId so the 3 endpoints carry distinct colours.
  if (isPar) {
    var parIdMix = index - 54;
    mixv = clamp01(parIdMix / 2.0 + axisLineA * 0.15);
  }
  var bri = darkFloor + stage * (0.38 + stageFocus * 0.22);
  // Pars: undampened bright path so the axis-endpoint reading punches.
  if (isPar) bri = 0.14 + stage * (0.78 + stageFocus * 0.20);
  var guide = circDist(theta, axisA) < 0.05 ? centerGuide : 0.0;
  var outR = clamp01((pr1 + (pr2 - pr1) * mixv) * bri);
  var outG = clamp01((pg1 + (pg2 - pg1) * mixv) * bri);
  var outB = clamp01((pb1 + (pb2 - pb1) * mixv) * bri);
  if (guide > outR) outR = guide;
  if (guide > outG) outG = guide;
  if (guide > outB) outB = guide;
  if (guide > white) white = guide;
  rgbwau(
    outR,
    outG,
    outB,
    clamp01(white),
    clamp01(amber),
    clamp01(uv)
  );
}
