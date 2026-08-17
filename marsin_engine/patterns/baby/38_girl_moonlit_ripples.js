// DRAFT - pending operator review
/* Baby-pink travelling moon ripples. COLOR_* constants are the only girl/boy delta. */

var COLOR_R_DARK = 0.620;
var COLOR_G_DARK = 0.008;
var COLOR_B_DARK = 0.140;
var COLOR_R_LIGHT = 1.000;
var COLOR_G_LIGHT = 0.040;
var COLOR_B_LIGHT = 0.360;

export var localSpeed = 0.44;
export var level = 0.88;
export var rippleWidth = 0.52;
export var originOffset = 0.58;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderLevel(v) { level = v; }
export function sliderRippleWidth(v) { rippleWidth = v; }
export function sliderOriginOffset(v) { originOffset = v; }

var phase = 0.0;
var liveLevel = 0.88;
var liveWidth = 0.52;
var liveDrift = 0.58;

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
  phase = phase + clamp01(delta / 100.0) * 0.051 * speedMultiplier;
  if (phase >= 10000.0) phase = phase - 10000.0;
  liveLevel = clamp01(level);
  liveWidth = clamp01(rippleWidth);
  liveDrift = clamp01(originOffset);
}

export function render3D(index, x, y, z) {
  var ox = 0.5 + (wave(phase * 0.137) - 0.5) * liveDrift * 0.64;
  var oz = 0.5 + (wave(phase * 0.173 + 0.31) - 0.5) * liveDrift * 0.64;
  var dx = x - ox;
  var dz = z - oz;
  var radius = sqrt(dx * dx + dz * dz + (y - 0.5) * (y - 0.5) * 0.23);
  var focus = 2.2 + (1.0 - liveWidth) * 9.0;
  var rippleA = pow(wave(radius * 5.0 - phase), focus);
  var rippleB = pow(wave(radius * 7.3 - phase * 1.41421356237), focus + 1.0);
  var moonPath = pow(wave(y * 1.3 + x * 0.43 - phase * 0.27), 6.0);
  var field = max(rippleA, rippleB * 0.78);
  var bri = clamp01((0.18 + field * 0.67 + moonPath * field * 0.18) * liveLevel);
  emitColor(0.18 + rippleA * 0.62 + rippleB * 0.42 + moonPath * 0.10, bri);
}

