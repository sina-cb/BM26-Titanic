/*
  abyssal_searchlight
  Trident-style searchlight beams: TriangleEdges are the source, BarLights
  catch narrow moving shafts, and the rest of the dome stays mostly black.
*/

export var localSpeed = 0.5;
export var beamCount = 0.42;
export var sweepWidth = 0.26;
export var gimbalDrift = 0.52;
export var sweepImpact = 0.55;
export var trailLength = 0.38;
export var blackoutDepth = 0.82;
export var sweepDirection = 0.0;

export var cp1H = 0.55, cp1S = 0.86, cp1V = 0.50;
export var cp2H = 0.68, cp2S = 0.62, cp2V = 0.36;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }
export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderBeamCount(v) { beamCount = v; }
export function sliderSweepWidth(v) { sweepWidth = v; }
export function sliderGimbalDrift(v) { gimbalDrift = v; }
export function sliderSweepImpact(v) { sweepImpact = v; }
export function sliderTrailLength(v) { trailLength = v; }
export function sliderBlackoutDepth(v) { blackoutDepth = v; }
export function sliderSweepDirection(v) { sweepDirection = v; }

var pr1 = 1, pg1 = 0, pb1 = 0;
var pr2 = 0, pg2 = 0, pb2 = 1;

function hsv1() {
  var hv = cp1H - floor(cp1H); if (hv < 0) hv += 1;
  var iv = floor(hv * 6) % 6; var fv = hv * 6 - floor(hv * 6);
  var pv = cp1V * (1 - cp1S); var qv = cp1V * (1 - fv * cp1S); var tv = cp1V * (1 - (1 - fv) * cp1S);
  if (iv == 0) { pr1 = cp1V; pg1 = tv; pb1 = pv; } else if (iv == 1) { pr1 = qv; pg1 = cp1V; pb1 = pv; } else if (iv == 2) { pr1 = pv; pg1 = cp1V; pb1 = tv; } else if (iv == 3) { pr1 = pv; pg1 = qv; pb1 = cp1V; } else if (iv == 4) { pr1 = tv; pg1 = pv; pb1 = cp1V; } else { pr1 = cp1V; pg1 = pv; pb1 = qv; }
}

function hsv2() {
  var hv = cp2H - floor(cp2H); if (hv < 0) hv += 1;
  var iv = floor(hv * 6) % 6; var fv = hv * 6 - floor(hv * 6);
  var pv = cp2V * (1 - cp2S); var qv = cp2V * (1 - fv * cp2S); var tv = cp2V * (1 - (1 - fv) * cp2S);
  if (iv == 0) { pr2 = cp2V; pg2 = tv; pb2 = pv; } else if (iv == 1) { pr2 = qv; pg2 = cp2V; pb2 = pv; } else if (iv == 2) { pr2 = pv; pg2 = cp2V; pb2 = tv; } else if (iv == 3) { pr2 = pv; pg2 = qv; pb2 = cp2V; } else if (iv == 4) { pr2 = tv; pg2 = pv; pb2 = cp2V; } else { pr2 = cp2V; pg2 = pv; pb2 = qv; }
}

function clamp01(v) { if (v < 0.0) return 0.0; if (v > 1.0) return 1.0; return v; }
function wrap01(v) { v = v % 1.0; if (v < 0.0) v += 1.0; return v; }
function circDist(a, b) { var d = abs(a - b); if (d > 0.5) d = 1.0 - d; return d; }
function softPulse(dist, width) { var px = clamp01(1.0 - dist / width); return px * px * (3.0 - 2.0 * px); }

var sweepPhase = 0.0;
var wobblePhase = 0.0;
var shutterPhase = 0.0;

export function beforeRender(delta) {
  var localMult = pow(2.0, (localSpeed - 0.5) * 4.0);
  var dt = (delta / 1310.72) * localMult;
  sweepPhase = sweepPhase + dt * (0.16 + sweepImpact * 0.92);
  wobblePhase = wobblePhase + dt * (0.13 + gimbalDrift * 0.74);
  shutterPhase = shutterPhase + dt * (0.42 + beamCount * 0.60);
  hsv1(); hsv2();
}

export function render3D(index, x, y, z) {
  var isEdge = sectionId == 1;
  var isPar = sectionId == 2 && y > 2.0;
  var isBar = sectionId == 2 && y <= 2.0;
  var isVintage = sectionId == 3;
  var theta = wrap01((atan2(z, x) / PI2) + 0.5);
  var sweepMotion = sweepDirection < 0.5 ? sweepPhase : -sweepPhase;
  var beams = floor(1.0 + beamCount * 3.0);
  var width = 0.010 + sweepWidth * 0.105;
  var stage = 0.0, white = 0.0, amber = 0.0, uv = 0.0;

  var beam = 0.0;
  var tail = 0.0;
  var shutter = 0.55 + 0.45 * pow(wave(shutterPhase + theta * 4.0), 3.0);
  for (var beamNo = 0; beamNo < 4; beamNo++) {
    if (beamNo < beams) {
      var wobble = (wave(wobblePhase * (0.7 + beamNo * 0.17) + beamNo * 0.23) - 0.5) * gimbalDrift * 0.18;
      var head = wrap01(sweepMotion * (0.72 + beamNo * 0.09) + beamNo / beams + wobble);
      var shaft = softPulse(circDist(theta, head), width);
      var after = softPulse(circDist(theta, wrap01(head - 0.05 - trailLength * 0.16)), width * (1.3 + trailLength));
      if (shaft > beam) beam = shaft;
      if (after > tail) tail = after;
    }
  }

  if (isBar) {
    var barT = ((index - 57) % 18) / 17.0;
    var downBeam = pow(wave(barT * 1.7 - sweepMotion * 1.8 + theta * 0.31), 1.8);
    stage = (beam * 0.86 + tail * 0.24) * (0.34 + downBeam * 0.66) * shutter;
    white = beam * sweepImpact * (0.45 + downBeam * 0.55);
    uv = tail * (0.18 + trailLength * 0.45);
  } else if (isEdge) {
    var edgeId = floor(index / 18.0);
    var edgeT = (index % 18) / 17.0;
    var source = softPulse(circDist(edgeT, wrap01(sweepMotion * 0.88 + edgeId * 0.333)), 0.025 + sweepWidth * 0.070);
    var sourceGate = pow(wave(shutterPhase + edgeId * 0.2), 2.5);
    stage = source * (0.36 + sweepImpact * 0.58) * (0.55 + sourceGate * 0.45);
    white = source * sweepImpact;
    uv = source * 0.12;
  } else if (isPar) {
    stage = beam * sweepImpact * 0.055;
    white = beam * sweepImpact;
  } else if (isVintage) {
    amber = beam * 0.07 * wave(wobblePhase + index * 0.047);
    stage = amber * 0.05;
  }

  var floorGlow = (1.0 - blackoutDepth) * 0.008;
  var mixv = clamp01(0.12 + theta * 0.34 + beam * 0.46);
  var bri = floorGlow + stage * (0.28 + sweepImpact * 0.18);
  rgbwau(
    clamp01((pr1 + (pr2 - pr1) * mixv) * bri),
    clamp01((pg1 + (pg2 - pg1) * mixv) * bri),
    clamp01((pb1 + (pb2 - pb1) * mixv) * bri),
    clamp01(white), clamp01(amber), clamp01(uv)
  );
}
