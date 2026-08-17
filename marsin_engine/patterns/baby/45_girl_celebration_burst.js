// DRAFT - pending operator review
/* Baby-pink repeating celebration bursts. COLOR_* constants are the only girl/boy delta. */

var COLOR_R_DARK = 0.620;
var COLOR_G_DARK = 0.008;
var COLOR_B_DARK = 0.140;
var COLOR_R_LIGHT = 1.000;
var COLOR_G_LIGHT = 0.040;
var COLOR_B_LIGHT = 0.360;

export var localSpeed = 0.72;
export var level = 0.92;
export var burstWidth = 0.52;
export var burstReach = 0.64;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderLevel(v) { level = v; }
export function sliderBurstWidth(v) { burstWidth = v; }
export function sliderBurstReach(v) { burstReach = v; }

var phase = 0.0;
var liveLevel = 0.92;
var liveWidth = 0.52;
var liveReach = 0.64;

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
  phase = phase + clamp01(delta / 100.0) * 0.150 * speedMultiplier;
  if (phase >= 10000.0) phase = phase - 10000.0;
  liveLevel = clamp01(level);
  liveWidth = clamp01(burstWidth);
  liveReach = clamp01(burstReach);
}

export function render3D(index, x, y, z) {
  var cx = x - 0.5;
  var cy = y - 0.5;
  var cz = z - 0.5;
  var radius = sqrt(cx * cx + cy * cy + cz * cz);
  var angle = atan2(cz, cx) / PI2;
  var elevation = atan2(cy, sqrt(cx * cx + cz * cz) + 0.001) / PI2;
  var focus = 2.0 + (1.0 - liveWidth) * 12.0;
  var shell = pow(wave(radius * (4.0 + liveReach * 4.0) - phase), focus);
  var raysA = pow(wave(angle * 9.0 + phase * 0.37), 9.0);
  var raysB = pow(wave(elevation * 13.0 - phase * 0.47), 8.0);
  var rays = max(raysA, raysB * 0.82);
  var secondary = pow(wave(radius * 6.7 - phase * 1.61803398875), focus + 1.4);
  var burst = max(shell * (0.52 + rays * 0.58), secondary * 0.71);
  var bri = clamp01((0.17 + burst * 0.79 + shell * rays * 0.17) * liveLevel);
  emitColor(0.14 + burst * 0.74 + rays * shell * 0.34, bri);
}

