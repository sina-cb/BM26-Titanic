// DRAFT - pending operator review
/* Baby-pink cascading veil filaments. COLOR_* constants are the only girl/boy delta. */

var COLOR_R_DARK = 0.620;
var COLOR_G_DARK = 0.008;
var COLOR_B_DARK = 0.140;
var COLOR_R_LIGHT = 1.000;
var COLOR_G_LIGHT = 0.040;
var COLOR_B_LIGHT = 0.360;

export var localSpeed = 0.60;
export var level = 0.91;
export var veilWidth = 0.52;
export var cascadeDensity = 0.54;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderLevel(v) { level = v; }
export function sliderVeilWidth(v) { veilWidth = v; }
export function sliderCascadeDensity(v) { cascadeDensity = v; }

var phase = 0.0;
var liveLevel = 0.91;
var liveWidth = 0.52;
var liveDensity = 0.54;

function clamp01(v) { if (v < 0.0) return 0.0; if (v > 1.0) return 1.0; return v; }
function emitColor(shade, bri) {
  var s = clamp01(shade);
  rgbwau((COLOR_R_DARK + (COLOR_R_LIGHT - COLOR_R_DARK) * s) * bri,
         (COLOR_G_DARK + (COLOR_G_LIGHT - COLOR_G_DARK) * s) * bri,
         (COLOR_B_DARK + (COLOR_B_LIGHT - COLOR_B_DARK) * s) * bri,
         0.0, 0.0, 0.0);
}

export function beforeRender(delta) {
  var speedMultiplier = pow(2.0, (clamp01(localSpeed) - 0.5) * 4.0);
  phase = phase + clamp01(delta / 100.0) * 0.104 * speedMultiplier;
  if (phase >= 10000.0) phase = phase - 10000.0;
  liveLevel = clamp01(level);
  liveWidth = clamp01(veilWidth);
  liveDensity = clamp01(cascadeDensity);
}

export function render3D(index, x, y, z) {
  var density = 3.0 + liveDensity * 8.0;
  var sway = (wave(y * 0.73 + phase * 0.21) - 0.5) * 0.31;
  var strandA = pow(wave((x + sway) * density + z * 0.63),
                    3.0 + (1.0 - liveWidth) * 12.0);
  var strandB = pow(wave((z - sway * 0.71) * density * 0.79 - x * 0.47),
                    4.0 + (1.0 - liveWidth) * 10.0);
  var dropA = pow(wave(y * 3.7 + x * 0.29 - phase), 5.0);
  var dropB = pow(wave(y * 5.1 - z * 0.37 - phase * 1.61803398875), 7.0);
  var veil = max(strandA * dropA, strandB * dropB * 0.88);
  var mist = pow(wave((x + z) * 2.0 - y * 1.3 + phase * 0.19), 8.0);
  var bri = clamp01((0.17 + veil * 0.76 + mist * 0.10) * liveLevel);
  emitColor(0.15 + veil * 0.82 + mist * 0.14, bri);
}

