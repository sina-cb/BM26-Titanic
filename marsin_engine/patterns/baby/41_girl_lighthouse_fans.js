// DRAFT - pending operator review
/* Baby-pink mirrored lighthouse fans. COLOR_* constants are the only girl/boy delta. */

var COLOR_R_DARK = 1.000;
var COLOR_G_DARK = 0.035;
var COLOR_B_DARK = 0.360;
var COLOR_R_LIGHT = 1.000;
var COLOR_G_LIGHT = 0.035;
var COLOR_B_LIGHT = 0.360;

export var localSpeed = 0.52;
export var level = 0.90;
export var beamWidth = 0.48;
export var fanCount = 0.45;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderLevel(v) { level = v; }
export function sliderBeamWidth(v) { beamWidth = v; }
export function sliderFanCount(v) { fanCount = v; }

var phase = 0.0;
var liveLevel = 0.90;
var liveWidth = 0.48;
var liveCount = 0.45;

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
  phase = phase + clamp01(delta / 100.0) * 0.076 * speedMultiplier;
  if (phase >= 10000.0) phase = phase - 10000.0;
  liveLevel = clamp01(level);
  liveWidth = clamp01(beamWidth);
  liveCount = clamp01(fanCount);
}

export function render3D(index, x, y, z) {
  var cx = x - 0.5;
  var cz = z - 0.5;
  var angle = atan2(cz, cx) / PI2;
  var count = 1.0 + liveCount * 4.0;
  var focus = 2.2 + (1.0 - liveWidth) * 13.0;
  var fanA = pow(wave(angle * count - phase), focus);
  var fanB = pow(wave(-angle * (count + 0.73) - phase * 0.61803398875), focus + 1.0);
  var horizon = pow(wave(y * 2.0 + sqrt(cx * cx + cz * cz) * 1.7 - phase * 0.31), 7.0);
  var field = max(fanA, fanB * 0.88);
  var bri = clamp01((0.18 + field * 0.72 + horizon * field * 0.16) * liveLevel);
  emitColor(x, y, z, 0.16 + fanA * 0.74 + fanB * 0.54 + horizon * 0.12, bri);
}

