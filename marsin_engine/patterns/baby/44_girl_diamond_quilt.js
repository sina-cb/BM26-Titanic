// DRAFT - pending operator review
/* Baby-pink travelling diamond quilt. COLOR_* constants are the only girl/boy delta. */

var COLOR_R_DARK = 1.000;
var COLOR_G_DARK = 0.035;
var COLOR_B_DARK = 0.360;
var COLOR_R_LIGHT = 1.000;
var COLOR_G_LIGHT = 0.035;
var COLOR_B_LIGHT = 0.360;

export var localSpeed = 0.65;
export var level = 0.91;
export var seamWidth = 0.50;
export var quiltScale = 0.52;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderLevel(v) { level = v; }
export function sliderSeamWidth(v) { seamWidth = v; }
export function sliderQuiltScale(v) { quiltScale = v; }

var phase = 0.0;
var liveLevel = 0.91;
var liveWidth = 0.50;
var liveScale = 0.52;

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
  phase = phase + clamp01(delta / 100.0) * 0.124 * speedMultiplier;
  if (phase >= 10000.0) phase = phase - 10000.0;
  liveLevel = clamp01(level);
  liveWidth = clamp01(seamWidth);
  liveScale = clamp01(quiltScale);
}

export function render3D(index, x, y, z) {
  var scale = 2.2 + liveScale * 6.8;
  var diagA = wave((x + y + z * 0.31) * scale - phase);
  var diagB = wave((x - y + z * 0.57) * scale + phase * 0.78615137775);
  var seam = 1.0 - abs(diagA - diagB);
  var focus = 2.0 + (1.0 - liveWidth) * 13.0;
  var stitch = pow(seam, focus);
  var panels = pow(diagA * diagB, 2.2);
  var depthStitch = pow(wave(z * scale * 0.73 + x * 0.47 - phase * 0.43), 9.0);
  var field = max(stitch, panels * 0.69);
  var bri = clamp01((0.18 + field * 0.68 + depthStitch * stitch * 0.17) * liveLevel);
  emitColor(x, y, z, 0.15 + stitch * 0.72 + panels * 0.38 + depthStitch * 0.17, bri);
}

