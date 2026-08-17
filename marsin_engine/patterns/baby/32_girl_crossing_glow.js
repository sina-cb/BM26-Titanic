// DRAFT - pending operator review
/*
  Baby-pink crossing beacons for long photo holds. Autonomous, palette-locked,
  audio-independent, RGB-only. COLOR_* constants are the only girl/boy delta.
*/

var COLOR_R_DARK = 0.620;
var COLOR_G_DARK = 0.008;
var COLOR_B_DARK = 0.140;
var COLOR_R_LIGHT = 1.000;
var COLOR_G_LIGHT = 0.040;
var COLOR_B_LIGHT = 0.360;

export var localSpeed = 0.32;
export var level = 0.86;
export var beamWidth = 0.46;
export var crossingOffset = 0.50;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderLevel(v) { level = v; }
export function sliderBeamWidth(v) { beamWidth = v; }
export function sliderCrossingOffset(v) { crossingOffset = v; }

var PHASE_WRAP = 10000.0;
var phase = 0.0;
var liveLevel = 0.86;
var liveWidth = 0.46;
var liveCrossing = 0.50;

function clamp01(v) {
  if (v < 0.0) return 0.0;
  if (v > 1.0) return 1.0;
  return v;
}

function emitColor(shade, bri) {
  var s = clamp01(shade);
  var r = COLOR_R_DARK + (COLOR_R_LIGHT - COLOR_R_DARK) * s;
  var g = COLOR_G_DARK + (COLOR_G_LIGHT - COLOR_G_DARK) * s;
  var b = COLOR_B_DARK + (COLOR_B_LIGHT - COLOR_B_DARK) * s;
  rgbwau(r * bri, g * bri, b * bri, 0.0, 0.0, 0.0);
}

export function beforeRender(delta) {
  var dt = clamp01(delta / 100.0) * 0.1;
  var speedMultiplier = pow(2.0, (clamp01(localSpeed) - 0.5) * 4.0);
  phase = phase + dt * 0.23 * speedMultiplier;
  if (phase >= PHASE_WRAP) phase = phase - PHASE_WRAP;
  liveLevel = clamp01(level);
  liveWidth = clamp01(beamWidth);
  liveCrossing = clamp01(crossingOffset);
}

export function render3D(index, x, y, z) {
  var pivot = 0.05 + liveCrossing * 0.90;
  var diagonalA = x + (z - pivot) * (0.72 + y * 0.41);
  var diagonalB = (1.0 - x) + (z - pivot) * (0.72 + (1.0 - y) * 0.41);
  var exponent = 2.0 + (1.0 - liveWidth) * 8.0;
  var fanA = pow(wave(diagonalA * 1.73 - phase), exponent);
  var fanB = pow(wave(diagonalB * 1.41 + phase * 1.61803398875), exponent);
  var crossingGlow = pow(1.0 - clamp01(abs(fanA - fanB)), 2.2);
  var horizon = pow(wave(z * 2.3 - phase * 0.47), 5.0);
  var field = max(max(fanA, fanB), crossingGlow * 0.72);
  var shade = 0.18 + field * 0.72 + crossingGlow * 0.15;
  var bri = clamp01((0.18 + field * 0.68 + horizon * 0.14) * liveLevel);
  emitColor(shade, bri);
}

