// DRAFT - pending operator review
/* Baby-blue repeating celebration bursts. COLOR_* constants are the only girl/boy delta. */

var COLOR_R_DARK = 0.033;
var COLOR_G_DARK = 0.450;
var COLOR_B_DARK = 1.000;
var COLOR_R_LIGHT = 0.033;
var COLOR_G_LIGHT = 0.450;
var COLOR_B_LIGHT = 1.000;

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
function emitColor(px, py, pz, shade, bri) {
  var geometry = clamp01(shade);
  var energy = clamp01(bri);
  var gate = geometry * 0.72 + energy * 0.28;
  if (gate < 0.24 || (fixtureType != FIX_TE_SIGN && wave(px * 1.7 + py * 1.3 + pz * 1.1) < 0.12)) {
    rgbwau(0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
    return;
  }
  var intensity = clamp01(0.62 + energy * 0.38);
  var r = (COLOR_R_DARK + COLOR_R_LIGHT) * 0.5;
  var g = (COLOR_G_DARK + COLOR_G_LIGHT) * 0.5;
  var b = (COLOR_B_DARK + COLOR_B_LIGHT) * 0.5;
  rgbwau(r * intensity, g * intensity, b * intensity, 0.0, 0.0, 0.0);
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
  emitColor(x, y, z, 0.14 + burst * 0.74 + rays * shell * 0.34, bri);
}
