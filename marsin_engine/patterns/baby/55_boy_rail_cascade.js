// DRAFT - pending operator review
/* Baby-blue rail cascades travel lengthwise over a steady full-ship glow. */

var COLOR_R_DARK = 0.008;
var COLOR_G_DARK = 0.130;
var COLOR_B_DARK = 0.620;
var COLOR_R_LIGHT = 0.033;
var COLOR_G_LIGHT = 0.450;
var COLOR_B_LIGHT = 1.000;

export var localSpeed = 0.40;
export var level = 0.88;
export var railWidth = 0.48;
export var cascadeDepth = 0.56;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderLevel(v) { level = v; }
export function sliderRailWidth(v) { railWidth = v; }
export function sliderCascadeDepth(v) { cascadeDepth = v; }

var phase = 0.0;
var liveLevel = 0.88;
var liveWidth = 0.48;
var liveDepth = 0.56;

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
  phase = phase + clamp01(delta / 100.0) * 0.032 * speedMultiplier;
  if (phase >= 10000.0) phase = phase - 10000.0;
  liveLevel = clamp01(level);
  liveWidth = clamp01(railWidth);
  liveDepth = clamp01(cascadeDepth);
}

export function render3D(index, x, y, z) {
  var width = 0.025 + liveWidth * 0.11;
  var upperRail = clamp01(1.0 - abs(z - (0.72 + sin((x - phase) * PI2) * 0.055)) / width);
  var lowerRail = clamp01(1.0 - abs(z - (0.38 - sin((x - phase * 0.83) * PI2) * 0.045)) / width);
  var sideRail = clamp01(1.0 - abs(y - (0.5 + sin((x * 1.5 + phase) * PI2) * 0.30)) / (width * 1.35));
  var drops = pow(wave(x * (2.0 + liveDepth * 5.0) - phase * 1.3 + z * 0.7), 2.2 + liveDepth * 3.0);
  var rail = max(upperRail, max(lowerRail, sideRail * 0.82));
  var field = clamp01(rail * (0.70 + drops * 0.28) + drops * 0.18);
  var breath = 0.86 + wave(phase * 0.43 + x * 0.16) * 0.14;
  var bri = clamp01((0.28 + field * 0.68) * liveLevel * breath);
  emitColor(0.14 + field * 0.86, bri);
}
