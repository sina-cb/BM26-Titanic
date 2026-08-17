// DRAFT - pending operator review
/* Baby-blue mirrored cradle arcs. COLOR_* constants are the only girl/boy delta. */

var COLOR_R_DARK = 0.033;
var COLOR_G_DARK = 0.450;
var COLOR_B_DARK = 1.000;
var COLOR_R_LIGHT = 0.033;
var COLOR_G_LIGHT = 0.450;
var COLOR_B_LIGHT = 1.000;

export var localSpeed = 0.38;
export var level = 0.87;
export var arcWidth = 0.50;
export var cradleDepth = 0.66;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderLevel(v) { level = v; }
export function sliderArcWidth(v) { arcWidth = v; }
export function sliderCradleDepth(v) { cradleDepth = v; }

var phase = 0.0;
var liveLevel = 0.87;
var liveWidth = 0.50;
var liveDepth = 0.66;

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
  phase = phase + clamp01(delta / 100.0) * 0.035 * speedMultiplier;
  if (phase >= 10000.0) phase = phase - 10000.0;
  liveLevel = clamp01(level);
  liveWidth = clamp01(arcWidth);
  liveDepth = clamp01(cradleDepth);
}

export function render3D(index, x, y, z) {
  var sx = abs(x - 0.5) * 2.0;
  var sz = abs(z - 0.5) * 2.0;
  var bowlA = y + sx * sx * (0.45 + liveDepth * 0.55);
  var bowlB = (1.0 - y) + sz * sz * (0.38 + liveDepth * 0.48);
  var focus = 2.3 + (1.0 - liveWidth) * 7.5;
  var arcA = pow(wave(bowlA * 2.2 - phase), focus);
  var arcB = pow(wave(bowlB * 2.7 + phase * 0.78615137775), focus + 0.7);
  var crossing = pow(1.0 - clamp01(abs(arcA - arcB)), 3.0) * min(arcA, arcB);
  var grain = pow(wave((x + z) * 6.0 + y * 3.0 + phase * 0.31), 10.0);
  var field = max(arcA, arcB * 0.92);
  var bri = clamp01((0.19 + field * 0.68 + crossing * 0.20 + grain * 0.06) * liveLevel);
  emitColor(x, y, z, 0.18 + field * 0.70 + crossing * 0.18, bri);
}
