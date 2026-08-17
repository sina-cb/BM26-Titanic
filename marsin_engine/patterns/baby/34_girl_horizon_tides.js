// DRAFT - pending operator review
/* Baby-pink horizon tides. COLOR_* constants are the only girl/boy delta. */

var COLOR_R_DARK = 1.000;
var COLOR_G_DARK = 0.035;
var COLOR_B_DARK = 0.360;
var COLOR_R_LIGHT = 1.000;
var COLOR_G_LIGHT = 0.035;
var COLOR_B_LIGHT = 0.360;

export var localSpeed = 0.36;
export var level = 0.86;
export var tideWidth = 0.52;
export var verticalReach = 0.62;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderLevel(v) { level = v; }
export function sliderTideWidth(v) { tideWidth = v; }
export function sliderVerticalReach(v) { verticalReach = v; }

var phase = 0.0;
var liveLevel = 0.86;
var liveWidth = 0.52;
var liveReach = 0.62;

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
  phase = phase + clamp01(delta / 100.0) * 0.031 * speedMultiplier;
  if (phase >= 10000.0) phase = phase - 10000.0;
  liveLevel = clamp01(level);
  liveWidth = clamp01(tideWidth);
  liveReach = clamp01(verticalReach);
}

export function render3D(index, x, y, z) {
  var bend = (wave(x * 0.61 + z * 0.37 + phase * 0.27) - 0.5) * 0.28;
  var tideA = wave(y * (2.0 + liveReach * 3.8) + x * 0.34 + bend - phase);
  var tideB = wave(y * (3.1 + liveReach * 2.7) - z * 0.43 - phase * 0.61803398875);
  var focus = 2.0 + (1.0 - liveWidth) * 8.0;
  var crest = max(pow(tideA, focus), pow(tideB, focus + 1.2));
  var foam = pow(wave(x * 7.0 + z * 5.0 - phase * 1.41), 9.0) * crest;
  var floor = 0.18 + 0.09 * wave(y * 0.7 + phase * 0.11);
  var bri = clamp01((floor + crest * 0.69 + foam * 0.16) * liveLevel);
  emitColor(x, y, z, 0.20 + crest * 0.66 + foam * 0.18, bri);
}

