// DRAFT - pending operator review
/*
  Baby-pink orbital shells for long photo holds. Autonomous, palette-locked,
  audio-independent, RGB-only. COLOR_* constants are the only girl/boy delta.
*/

var COLOR_R_DARK = 1.000;
var COLOR_G_DARK = 0.035;
var COLOR_B_DARK = 0.360;
var COLOR_R_LIGHT = 1.000;
var COLOR_G_LIGHT = 0.035;
var COLOR_B_LIGHT = 0.360;

export var localSpeed = 0.30;
export var level = 0.84;
export var ringWidth = 0.54;
export var spatialDepth = 0.68;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderLevel(v) { level = v; }
export function sliderRingWidth(v) { ringWidth = v; }
export function sliderSpatialDepth(v) { spatialDepth = v; }

var PHASE_WRAP = 10000.0;
var phase = 0.0;
var liveLevel = 0.84;
var liveWidth = 0.54;
var liveDepth = 0.68;

function clamp01(v) {
  if (v < 0.0) return 0.0;
  if (v > 1.0) return 1.0;
  return v;
}

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
  var dt = clamp01(delta / 100.0) * 0.1;
  var speedMultiplier = pow(2.0, (clamp01(localSpeed) - 0.5) * 4.0);
  phase = phase + dt * 0.19 * speedMultiplier;
  if (phase >= PHASE_WRAP) phase = phase - PHASE_WRAP;
  liveLevel = clamp01(level);
  liveWidth = clamp01(ringWidth);
  liveDepth = clamp01(spatialDepth);
}

export function render3D(index, x, y, z) {
  var cx = clamp01(x) - 0.5;
  var cy = clamp01(y) - 0.5;
  var cz = clamp01(z) - 0.5;
  var warpX = cx + (wave(y * 0.73 + phase * 0.61) - 0.5) * liveDepth * 0.24;
  var warpY = cy + (wave(z * 0.59 - phase * 0.47) - 0.5) * liveDepth * 0.20;
  var warpZ = cz + (wave(x * 0.67 + phase * 0.79) - 0.5) * liveDepth * 0.24;
  var radiusA = sqrt(warpX * warpX + warpY * warpY + warpZ * warpZ);
  var radiusB = sqrt((warpX * 0.63 + warpZ * 0.77) *
                     (warpX * 0.63 + warpZ * 0.77) +
                     (warpY * 1.19) * (warpY * 1.19));
  var shellA = pow(wave(radiusA * 3.7 - phase),
                   1.8 + (1.0 - liveWidth) * 5.2);
  var shellB = pow(wave(radiusB * 4.3 + phase * 1.41421356237),
                   2.0 + (1.0 - liveWidth) * 5.8);
  var detail = pow(wave(x * 7.0 - y * 11.0 + z * 13.0
                        + phase * 1.73205080757), 9.0);
  var field = max(shellA, shellB * 0.92);
  var shade = 0.22 + field * 0.65 + detail * 0.18;
  var bri = clamp01((0.18 + field * (0.60 + liveDepth * 0.24)
                    + detail * 0.14) * liveLevel);
  emitColor(x, y, z, shade, bri);
}

