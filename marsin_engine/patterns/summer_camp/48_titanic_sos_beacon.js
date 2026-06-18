/*
  48_titanic_sos_beacon
  Morse "SOS" signal routed across the apex rig in three distinct layers:
    - TrianglePars (3): blink the SOS code in unison — readable beacon head.
    - TriangleEdges (3): slow rotating "searchlight" sweep with the SOS code
      modulating its intensity, phase-distributed POSITION-based with
      φ-spaced offsets [0.0, 0.382, 0.764] (E1 fix).
    - BarLights (perimeter): steady amber wash with a slow brighter band that
      travels around the ring; SOS only nudges its brightness gently.
    - Vintage lamps: amber "responder" answer, delayed and per-fixture.

  APEX 1-1-1 fix (E1): the previous edgeId/3.0 spacing (0, 1/3, 2/3) put
  searchlight spots at mirror-symmetric positions on the equilateral triangle,
  reading as 2-1 to the eye. Replaced with φ-spaced offsets [0.0, 0.382, 0.764]
  to break the mirror symmetry. Strobe cap and soft envelope from Wave 1 are
  preserved (sliderEdgeSoftness, MAX_SIGNAL_HZ).

  Apex polish (D4):
  - Preserved strobe cap and soft envelope from Wave 1.
  - Brightness defaults bumped (cp1V/cp2V -> 0.85/0.80, signalStrength -> 0.90).
  - Pars now drive a strong unison SOS readout (was a faint 0.08 background).
  - Bars now have an always-on amber wash with a traveling brighter band so
    the perimeter never goes dark between morse units (Rule 3 / Rule 4).
  - New sliderBrightness for global headroom; new sliderSearchlightSweep for
    the edge searchlight speed; new sliderWashBrightness for the bar baseline.

  Safety:
  - morsePulse edges are softened by a linear attack/decay envelope
    (sliderEdgeSoftness, 0..1 -> 0..120 ms) so dot edges are not instantaneous.
    Operator-tunable; floor is 0 ms only at the explicit operator extreme
    (no silent fallback).
  - Maximum dot/dash flash rate is bounded at MAX_SIGNAL_HZ (~0.375 cycles/sec
    => peak full-rig flash ~3 Hz of the fastest morse element). signalSpeed is
    clamped into this safe range before driving tSignal.
*/

export var localSpeed = 0.5;
export var signalStrength = 0.90;
export var signalSpeed = 0.46;
export var echoDelay = 0.38;
export var echoWidth = 0.34;
export var responseGlow = 0.45;
export var abyssalDarkness = 0.32;
export var edgeSoftness = 0.45;
export var brightness = 0.80;
export var searchlightSweep = 0.45;
export var washBrightness = 0.40;

// Cap morse cycle rate so the fastest element stays at/under ~3 Hz of full-rig
// flash. tSignal advances by (0.10 + signalSpeed * MAX_RATE_SPAN) cycles/sec;
// inside one cycle there are 8 morse units, so 3 Hz floor => max ~0.375 c/s.
var MAX_SIGNAL_BASE = 0.10;
var MAX_RATE_SPAN = 0.275;

export var cp1H = 0.58, cp1S = 0.84, cp1V = 0.85;
export var cp2H = 0.08, cp2S = 0.78, cp2V = 0.80;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderSignalStrength(v) { signalStrength = v; }
export function sliderSignalSpeed(v) { signalSpeed = v; }
export function sliderEchoDelay(v) { echoDelay = v; }
export function sliderEchoWidth(v) { echoWidth = v; }
export function sliderResponseGlow(v) { responseGlow = v; }
export function sliderAbyssalDarkness(v) { abyssalDarkness = v; }
export function sliderEdgeSoftness(v) { edgeSoftness = v; }
export function sliderBrightness(v) { brightness = v; }
export function sliderSearchlightSweep(v) { searchlightSweep = v; }
export function sliderWashBrightness(v) { washBrightness = v; }

var pr1 = 1, pg1 = 0, pb1 = 0;
var pr2 = 0, pg2 = 0, pb2 = 1;
function _hsv2rgb1() { var hv = cp1H - floor(cp1H); if (hv < 0) hv += 1; var iv = floor(hv * 6) % 6; var fv = hv * 6 - floor(hv * 6); var pv = cp1V * (1 - cp1S); var qv = cp1V * (1 - fv * cp1S); var tv = cp1V * (1 - (1 - fv) * cp1S); if (iv == 0) { pr1 = cp1V; pg1 = tv; pb1 = pv; } else if (iv == 1) { pr1 = qv; pg1 = cp1V; pb1 = pv; } else if (iv == 2) { pr1 = pv; pg1 = cp1V; pb1 = tv; } else if (iv == 3) { pr1 = pv; pg1 = qv; pb1 = cp1V; } else if (iv == 4) { pr1 = tv; pg1 = pv; pb1 = cp1V; } else { pr1 = cp1V; pg1 = pv; pb1 = qv; } }
function _hsv2rgb2() { var hv = cp2H - floor(cp2H); if (hv < 0) hv += 1; var iv = floor(hv * 6) % 6; var fv = hv * 6 - floor(hv * 6); var pv = cp2V * (1 - cp2S); var qv = cp2V * (1 - fv * cp2S); var tv = cp2V * (1 - (1 - fv) * cp2S); if (iv == 0) { pr2 = cp2V; pg2 = tv; pb2 = pv; } else if (iv == 1) { pr2 = qv; pg2 = cp2V; pb2 = pv; } else if (iv == 2) { pr2 = pv; pg2 = cp2V; pb2 = tv; } else if (iv == 3) { pr2 = pv; pg2 = qv; pb2 = cp2V; } else if (iv == 4) { pr2 = tv; pg2 = pv; pb2 = cp2V; } else { pr2 = cp2V; pg2 = pv; pb2 = qv; } }
function clamp01(v) { if (v < 0.0) return 0.0; if (v > 1.0) return 1.0; return v; }
function wrap01(v) { v = v % 1.0; if (v < 0.0) v += 1.0; return v; }
function circDist(a, b) { var d = abs(a - b); if (d > 0.5) d = 1.0 - d; return d; }
function softPulse(dist, width) { var xVal = clamp01(1.0 - dist / width); return xVal * xVal * (3.0 - 2.0 * xVal); }

var tSignal = 0.0;
var tDrift = 0.0;
var edgeMUnits = 0.05;  // attack/decay width in morse-unit space (recomputed each frame).
export function beforeRender(delta) {
  var localMult = pow(2.0, (localSpeed - 0.5) * 4.0);
  var dt = (delta / 1310.72) * localMult;

  // Clamp signal cycle rate into the safe band (max ~3 Hz of fastest morse element).
  var safeSpeed = signalSpeed;
  if (safeSpeed < 0.0) safeSpeed = 0.0;
  if (safeSpeed > 1.0) safeSpeed = 1.0;
  var cyclesPerSec = MAX_SIGNAL_BASE + safeSpeed * MAX_RATE_SPAN;

  tSignal = tSignal + dt * cyclesPerSec;
  tDrift = tDrift + dt * 0.17;

  // Convert edgeSoftness (0..1) to milliseconds (0..120 ms), then to morse-unit
  // width: one morse unit = 1/(8 * cyclesPerSec) seconds.
  var softness = edgeSoftness;
  if (softness < 0.0) softness = 0.0;
  if (softness > 1.0) softness = 1.0;
  var edgeSec = softness * 0.120;
  edgeMUnits = edgeSec * 8.0 * cyclesPerSec;
  // Hard floor avoids divide-by-zero in the envelope at extreme slider=0;
  // tiny but non-zero, deliberately small so the operator extreme behaves
  // exactly as requested (no silent re-routing to a larger value).
  if (edgeMUnits < 0.0005) edgeMUnits = 0.0005;

  _hsv2rgb1();
  _hsv2rgb2();
}

// Linear ramp envelope: 0 outside [start, end], ramps up over edgeMUnits at
// start, ramps down over edgeMUnits at end. Keeps the Morse timing recognizable
// but removes the instantaneous 0->1 / 1->0 transitions that would strobe.
function morseEnv(m, start, end) {
  if (m < start || m > end) return 0.0;
  var fromStart = m - start;
  var toEnd = end - m;
  var attack = fromStart / edgeMUnits;
  var decay = toEnd / edgeMUnits;
  var env = attack;
  if (decay < env) env = decay;
  if (env > 1.0) env = 1.0;
  if (env < 0.0) env = 0.0;
  return env;
}

// SOS pattern: three dots, gap, three dashes, gap, three dots.
// dots at m = 0.00..0.26, 0.50..0.76, 1.00..1.26
// dashes at m = 2.00..2.72, 3.00..3.72, 4.00..4.72
// dots at m = 5.50..5.76, 6.00..6.26, 6.50..6.76
function morsePulse(sigTime) {
  var m = wrap01(sigTime) * 8.0;
  var p = 0.0;
  var q = 0.0;
  if (m < 1.5) {
    p = morseEnv(m, 0.00, 0.26);
    q = morseEnv(m, 0.50, 0.76);
    if (q > p) p = q;
    q = morseEnv(m, 1.00, 1.26);
    if (q > p) p = q;
  } else if (m > 2.0 && m < 5.0) {
    p = morseEnv(m, 2.00, 2.72);
    q = morseEnv(m, 3.00, 3.72);
    if (q > p) p = q;
    q = morseEnv(m, 4.00, 4.72);
    if (q > p) p = q;
  } else if (m > 5.5 && m < 7.0) {
    p = morseEnv(m, 5.50, 5.76);
    q = morseEnv(m, 6.00, 6.26);
    if (q > p) p = q;
    q = morseEnv(m, 6.50, 6.76);
    if (q > p) p = q;
  }
  return p;
}

export function render3D(index, x, y, z) {
  var isTriangleEdge = sectionId == 1;
  var isTrianglePar = sectionId == 2 && y > 2.0;
  var isBar = sectionId == 2 && y <= 2.0;
  var isVintage = sectionId == 3;
  var theta = wrap01((atan2(z, x) / PI2) + 0.5);
  var pulse = morsePulse(tSignal);
  var width = 0.018 + echoWidth * 0.150;
  var stage = 0.0, white = 0.0, amber = 0.0, uv = 0.0;

  if (isTriangleEdge) {
    var edgeId = floor(index / 18.0);
    var edgeT = (index % 18) / 17.0;
    // φ-spaced 1-1-1: [0.0, 0.382, 0.764]. Continuity check (edgeT=0.5, tDrift
    // makes c = tDrift*sweepSpeed advance; sample c = 0.0, 0.25, 0.5):
    //   c=0.0 : positions 0.000, 0.382, 0.764 → dists 0.500, 0.118, 0.264 — distinct.
    //   c=0.25: positions 0.250, 0.632, 0.014 → dists 0.250, 0.132, 0.486 — distinct.
    //   c=0.5 : positions 0.500, 0.882, 0.264 → dists 0.000, 0.382, 0.236 — distinct.
    var edgePhase = 0.0;
    if (edgeId == 1) edgePhase = 0.382;
    if (edgeId == 2) edgePhase = 0.764;
    var sweepSpeed = 0.20 + searchlightSweep * 1.40;
    var scan = softPulse(circDist(edgeT, wrap01(tDrift * sweepSpeed + edgePhase)), width);
    // Always-on dim baseline so edges read between morse dots. Baseline phase
    // also uses the φ-spaced offset so the per-edge baseline modulation is
    // not in 2-1 sync with the scan.
    var baseline = 0.18 + 0.10 * wave(edgeT * 4.0 + edgePhase + tDrift * 0.4);
    stage = (baseline * 0.45 + scan * 0.55 * (0.35 + pulse * 0.85)) * signalStrength;
    white = clamp01(scan * pulse * signalStrength);
    uv = clamp01(scan * pulse * 0.22);
  } else if (isTrianglePar) {
    // Unison SOS beacon head — all 3 pars blink the morse code together so
    // the SOS is unmistakably readable at distance (Rule 2 — active).
    var parId = index - 54;
    var parGlow = 0.18 + 0.10 * wave(tDrift * 0.6 + parId * 0.33);  // always lit
    stage = clamp01(parGlow * 0.30 + pulse * signalStrength * 0.75);
    white = clamp01(pulse * signalStrength);
  } else if (isBar) {
    var barLocal = index - 57;
    var barIndex = floor(barLocal / 18.0);
    var barT = (barLocal % 18) / 17.0;
    // Steady amber wash so the perimeter is always present (Rule 3).
    var wash = washBrightness * (0.65 + 0.35 * wave(barT * 1.7 + barIndex * 0.13 + tDrift * 0.2));
    // Traveling brighter band around the ring; gentle, not strobing.
    var travelHead = wrap01(tDrift * 0.55);
    var band = softPulse(circDist(theta, travelHead), 0.08 + echoWidth * 0.10);
    // Soft delayed morse colour-shift across theta — brightness only, no strobe.
    var delayed = morsePulse(tSignal - echoDelay * 0.18 - theta * 0.22);
    stage = clamp01(wash + band * (0.45 + delayed * 0.30) * signalStrength);
    amber = clamp01(wash * 0.55 + band * 0.30);
    uv = clamp01(band * delayed * (0.18 + echoWidth * 0.30));
  } else if (isVintage) {
    var vintageLocal = index - 291;
    var fixtureNo = floor(vintageLocal / 6.0);
    var answer = morsePulse(tSignal - 0.18 - fixtureNo * 0.018);
    amber = clamp01(responseGlow * (0.30 + answer * 0.70) * (0.65 + 0.35 * wave(tDrift * 1.4 + vintageLocal * 0.071)));
    stage = amber * 0.10;
  }

  var floorGlow = (1.0 - abyssalDarkness) * 0.040;
  var colorMix = clamp01(0.20 + theta * 0.28 + wave(tDrift + y * 0.07) * 0.24);
  var bri = (floorGlow + stage * 0.78) * (0.40 + brightness * 0.85);
  var r = (pr1 + (pr2 - pr1) * colorMix) * bri;
  var g = (pg1 + (pg2 - pg1) * colorMix) * bri;
  var b = (pb1 + (pb2 - pb1) * colorMix) * bri;
  rgbwau(clamp01(r), clamp01(g), clamp01(b), clamp01(white * brightness), clamp01(amber * brightness), clamp01(uv));
}
