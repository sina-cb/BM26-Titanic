// DRAFT - pending operator review
/*
  Baby-pink counter-wound rose for long photo holds. Autonomous, palette-locked,
  audio-independent, RGB-only. COLOR_* constants are the only girl/boy delta.
*/

var COLOR_R_DARK = 1.000;
var COLOR_G_DARK = 0.035;
var COLOR_B_DARK = 0.360;
var COLOR_R_LIGHT = 1.000;
var COLOR_G_LIGHT = 0.035;
var COLOR_B_LIGHT = 0.360;

export var localSpeed = 0.34;
export var level = 0.86;
export var petalWidth = 0.52;
export var spatialDepth = 0.70;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderLevel(v) { level = v; }
export function sliderPetalWidth(v) { petalWidth = v; }
export function sliderSpatialDepth(v) { spatialDepth = v; }

var PHASE_WRAP = 10000.0;
var phase = 0.0;
var liveLevel = 0.86;
var liveWidth = 0.52;
var liveDepth = 0.70;

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
  phase = phase + dt * 0.27 * speedMultiplier;
  if (phase >= PHASE_WRAP) phase = phase - PHASE_WRAP;
  liveLevel = clamp01(level);
  liveWidth = clamp01(petalWidth);
  liveDepth = clamp01(spatialDepth);
}

export function render3D(index, x, y, z) {
  var cx = x - 0.5;
  var cy = y - 0.5;
  var cz = z - 0.5;
  var radial = sqrt(cx * cx + cz * cz);
  var volumeRadius = sqrt(cx * cx + cy * cy + cz * cz);
  var angle = atan2(cz, cx) / PI2;
  var focus = 2.0 + (1.0 - liveWidth) * 7.0;
  var petalsA = pow(wave(angle * 6.0 - radial * 2.7 - phase), focus);
  var petalsB = pow(wave(angle * 5.0 + radial * 3.1
                         + phase * 1.41421356237), focus + 0.8);
  var shell = pow(wave(volumeRadius * (2.1 + liveDepth * 1.7)
                       - phase * 0.73), 3.2 + liveDepth * 3.0);
  var silkA = wave(x * 0.73 + y * 0.31 - z * 0.47 - phase);
  var silkB = wave(-x * 0.41 + y * 0.67 + z * 0.37
                   + phase * 1.61803398875);
  var silk = pow(1.0 - abs(silkA - silkB), 2.6 + liveDepth * 2.4);
  var field = max(max(petalsA, petalsB * 0.90), max(shell * 0.82, silk * 0.74));
  var shade = 0.20 + field * 0.72 + silk * 0.12;
  var bri = clamp01((0.18 + field * (0.64 + liveDepth * 0.22)
                    + shell * 0.12) * liveLevel);
  emitColor(x, y, z, shade, bri);
}

