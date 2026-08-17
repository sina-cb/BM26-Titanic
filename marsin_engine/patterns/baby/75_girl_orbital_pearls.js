// DRAFT - pending operator review
/* Baby-pink orbital pearls drift in linked strands above a steady photo wash. */

var COLOR_R_DARK = 0.620;
var COLOR_G_DARK = 0.008;
var COLOR_B_DARK = 0.170;
var COLOR_R_LIGHT = 1.000;
var COLOR_G_LIGHT = 0.035;
var COLOR_B_LIGHT = 0.360;

export var localSpeed = 0.52;
export var level = 0.90;
export var pearlSize = 0.50;
export var orbitDepth = 0.60;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderLevel(v) { level = v; }
export function sliderPearlSize(v) { pearlSize = v; }
export function sliderOrbitDepth(v) { orbitDepth = v; }

var phase = 0.0;
var liveLevel = 0.90;
var liveSize = 0.50;
var liveDepth = 0.60;

function clamp01(v) {
  if (v < 0.0) return 0.0;
  if (v > 1.0) return 1.0;
  return v;
}

function emitColor(shade, bri) {
  var s = clamp01(shade);
  rgbwau((COLOR_R_DARK + (COLOR_R_LIGHT - COLOR_R_DARK) * s) * bri,
         (COLOR_G_DARK + (COLOR_G_LIGHT - COLOR_G_DARK) * s) * bri,
         (COLOR_B_DARK + (COLOR_B_LIGHT - COLOR_B_DARK) * s) * bri,
         0.0, 0.0, 0.0);
}

export function beforeRender(delta) {
  var speedMultiplier = pow(2.0, (clamp01(localSpeed) - 0.5) * 4.0);
  phase = phase + clamp01(delta / 100.0) * 0.036 * speedMultiplier;
  if (phase >= 10000.0) phase = phase - 10000.0;
  liveLevel = clamp01(level);
  liveSize = clamp01(pearlSize);
  liveDepth = clamp01(orbitDepth);
}

export function render3D(index, x, y, z) {
  var orbit = x * (1.8 + liveDepth * 3.2) - phase;
  var targetY = 0.5 + sin(orbit * PI2) * (0.12 + liveDepth * 0.26);
  var targetZ = 0.5 + cos(orbit * PI2) * (0.10 + liveDepth * 0.24);
  var dy = y - targetY;
  var dz = z - targetZ;
  var strand = clamp01(1.0 - sqrt(dy * dy + dz * dz) / (0.07 + liveSize * 0.13));
  var beads = pow(wave(x * (5.0 + liveDepth * 8.0) - phase * 1.7), 5.5 - liveSize * 3.0);
  var counter = pow(wave((1.0 - x) * 7.0 - phase * 1.1 + y * 0.4), 3.0 + liveSize * 2.0);
  var field = clamp01(strand * (0.56 + beads * 0.42) + counter * 0.24);
  var bri = clamp01((0.28 + field * 0.69) * liveLevel);
  emitColor(0.13 + field * 0.87, bri);
}
