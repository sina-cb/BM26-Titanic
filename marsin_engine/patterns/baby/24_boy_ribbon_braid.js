// DRAFT - pending operator review
/* Baby-blue three-strand ribbon braid. COLOR_* constants are the only girl/boy delta. */

var COLOR_R_DARK = 0.008;
var COLOR_G_DARK = 0.130;
var COLOR_B_DARK = 0.620;
var COLOR_R_LIGHT = 0.033;
var COLOR_G_LIGHT = 0.450;
var COLOR_B_LIGHT = 1.000;

export var localSpeed = 0.46;
export var level = 0.89;
export var ribbonWidth = 0.54;
export var braidAmount = 0.56;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderLevel(v) { level = v; }
export function sliderRibbonWidth(v) { ribbonWidth = v; }
export function sliderBraidAmount(v) { braidAmount = v; }

var phase = 0.0;
var liveLevel = 0.89;
var liveWidth = 0.54;
var liveTension = 0.56;

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
  phase = phase + clamp01(delta / 100.0) * 0.058 * speedMultiplier;
  if (phase >= 10000.0) phase = phase - 10000.0;
  liveLevel = clamp01(level);
  liveWidth = clamp01(ribbonWidth);
  liveTension = clamp01(braidAmount);
}

export function render3D(index, x, y, z) {
  var turns = 1.3 + liveTension * 3.7;
  var bendA = wave(x * turns - phase) - 0.5;
  var bendB = wave(x * turns - phase + 0.33333333333) - 0.5;
  var bendC = wave(x * turns - phase + 0.66666666667) - 0.5;
  var targetA = 0.50 + bendA * (0.24 + liveTension * 0.18);
  var targetB = 0.50 + bendB * (0.24 + liveTension * 0.18);
  var targetC = 0.50 + bendC * (0.24 + liveTension * 0.18);
  var width = 0.025 + liveWidth * 0.15;
  var ribbonA = clamp01(1.0 - abs(y - targetA) / width);
  var ribbonB = clamp01(1.0 - abs(z - targetB) / width);
  var ribbonC = clamp01(1.0 - abs((y + z) * 0.5 - targetC) / width);
  var field = max(ribbonA, max(ribbonB, ribbonC));
  var crossing = min(1.0, ribbonA + ribbonB + ribbonC) * field;
  var bri = clamp01((0.17 + field * 0.66 + crossing * 0.15) * liveLevel);
  emitColor(0.15 + ribbonA * 0.48 + ribbonB * 0.62 + ribbonC * 0.72, bri);
}
