// DRAFT - pending operator review
/* Baby-blue aurora veils drift in layered curtains over a full-ship wash. */

var COLOR_R_DARK = 0.008;
var COLOR_G_DARK = 0.130;
var COLOR_B_DARK = 0.620;
var COLOR_R_LIGHT = 0.033;
var COLOR_G_LIGHT = 0.450;
var COLOR_B_LIGHT = 1.000;

export var localSpeed = 0.58;
export var level = 0.91;
export var veilWidth = 0.54;
export var auroraDepth = 0.62;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderLevel(v) { level = v; }
export function sliderVeilWidth(v) { veilWidth = v; }
export function sliderAuroraDepth(v) { auroraDepth = v; }

var phase = 0.0;
var liveLevel = 0.91;
var liveWidth = 0.54;
var liveDepth = 0.62;

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
  phase = phase + clamp01(delta / 100.0) * 0.030 * speedMultiplier;
  if (phase >= 10000.0) phase = phase - 10000.0;
  liveLevel = clamp01(level);
  liveWidth = clamp01(veilWidth);
  liveDepth = clamp01(auroraDepth);
}

export function render3D(index, x, y, z) {
  var foldA = wave(y * (1.5 + liveDepth * 3.5) + sin((x - phase) * PI2) * 0.24);
  var foldB = wave(z * (1.8 + liveDepth * 3.2) - sin((x + phase * 0.71) * PI2) * 0.20 + 0.33);
  var focus = 1.4 + (1.0 - liveWidth) * 5.0;
  var curtainA = pow(foldA, focus);
  var curtainB = pow(foldB, focus * 0.86);
  var crest = wave(x * (1.0 + liveDepth * 2.0) - phase * 0.54 + y * 0.18);
  var field = clamp01(max(curtainA, curtainB * 0.84) * (0.74 + crest * 0.24));
  var breath = 0.86 + wave(phase * 0.36 + z * 0.12) * 0.14;
  var bri = clamp01((0.27 + field * 0.70) * liveLevel * breath);
  emitColor(0.15 + field * 0.85, bri);
}
