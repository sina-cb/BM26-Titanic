// DRAFT - pending operator review
/* Baby-blue keel line breathes gently beneath a full-ship photo wash. */

var COLOR_R_DARK = 0.008;
var COLOR_G_DARK = 0.130;
var COLOR_B_DARK = 0.620;
var COLOR_R_LIGHT = 0.033;
var COLOR_G_LIGHT = 0.450;
var COLOR_B_LIGHT = 1.000;

export var localSpeed = 0.30;
export var level = 0.86;
export var keelWidth = 0.52;
export var breathDepth = 0.46;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderLevel(v) { level = v; }
export function sliderKeelWidth(v) { keelWidth = v; }
export function sliderBreathDepth(v) { breathDepth = v; }

var phase = 0.0;
var liveLevel = 0.86;
var liveWidth = 0.52;
var liveDepth = 0.46;

function clamp01(v) {
  if (v < 0.0) return 0.0;
  if (v > 1.0) return 1.0;
  return v;
}

function emitColor(shade, bri) {
  var s = clamp01(shade);
  rgbwau((COLOR_R_DARK + (COLOR_R_LIGHT - COLOR_R_DARK) * s) * bri,
         (COLOR_G_DARK + (COLOR_G_LIGHT - COLOR_G_DARK) * s) * bri,
         (COLOR_B_DARK + (COLOR_B_LIGHT - COLOR_B_DARK) * s) * bri,
         0.0, 0.0, 0.0);
}

export function beforeRender(delta) {
  var speedMultiplier = pow(2.0, (clamp01(localSpeed) - 0.5) * 4.0);
  phase = phase + clamp01(delta / 100.0) * 0.022 * speedMultiplier;
  if (phase >= 10000.0) phase = phase - 10000.0;
  liveLevel = clamp01(level);
  liveWidth = clamp01(keelWidth);
  liveDepth = clamp01(breathDepth);
}

export function render3D(index, x, y, z) {
  var keelCenter = 0.14 + sin((x * 0.7 - phase) * PI2) * (0.02 + liveDepth * 0.05);
  var width = 0.035 + liveWidth * 0.16;
  var keel = clamp01(1.0 - abs(z - keelCenter) / width);
  var ribs = pow(wave(x * (2.0 + liveDepth * 3.0) - phase * 0.48), 2.5);
  var breath = 0.78 + wave(phase * 0.64 + x * 0.20) * 0.22;
  var field = clamp01(keel * 0.72 + ribs * (0.12 + keel * 0.24));
  var bri = clamp01((0.30 + field * 0.65) * liveLevel * breath);
  emitColor(0.16 + field * 0.84, bri);
}
