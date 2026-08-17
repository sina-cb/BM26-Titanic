// DRAFT - pending operator review
/* Baby-pink drifting constellation lattice. COLOR_* constants are the only girl/boy delta. */

var COLOR_R_DARK = 1.000;
var COLOR_G_DARK = 0.035;
var COLOR_B_DARK = 0.360;
var COLOR_R_LIGHT = 1.000;
var COLOR_G_LIGHT = 0.035;
var COLOR_B_LIGHT = 0.360;

export var localSpeed = 0.42;
export var level = 0.88;
export var starSize = 0.54;
export var constellationDensity = 0.48;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderLevel(v) { level = v; }
export function sliderStarSize(v) { starSize = v; }
export function sliderConstellationDensity(v) { constellationDensity = v; }

var phase = 0.0;
var liveLevel = 0.88;
var liveSize = 0.54;
var liveDensity = 0.48;

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
  phase = phase + clamp01(delta / 100.0) * 0.045 * speedMultiplier;
  if (phase >= 10000.0) phase = phase - 10000.0;
  liveLevel = clamp01(level);
  liveSize = clamp01(starSize);
  liveDensity = clamp01(constellationDensity);
}

export function render3D(index, x, y, z) {
  var density = 2.5 + liveDensity * 6.5;
  var latticeA = wave(x * density + y * 1.7 - phase);
  var latticeB = wave(z * (density * 0.83) - y * 2.1 + phase * 1.61803398875);
  var latticeC = wave((x - z) * (density * 0.61) + y * 3.0 - phase * 0.73);
  var agreement = latticeA * latticeB * latticeC;
  var stars = pow(agreement, 3.0 + (1.0 - liveSize) * 14.0);
  var threads = pow(1.0 - abs(latticeA - latticeB), 9.0) * 0.34;
  var breathe = 0.72 + wave(y * 0.71 + phase * 0.19) * 0.28;
  var field = max(stars, threads);
  var bri = clamp01((0.16 + field * 0.79 * breathe) * liveLevel);
  emitColor(x, y, z, 0.14 + threads * 0.78 + stars * 0.88, bri);
}

