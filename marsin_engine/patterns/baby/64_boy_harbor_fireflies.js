// DRAFT - pending operator review
/* Baby-blue harbor fireflies drift softly through a persistent shipwide glow. */

var COLOR_R_DARK = 0.008;
var COLOR_G_DARK = 0.130;
var COLOR_B_DARK = 0.620;
var COLOR_R_LIGHT = 0.033;
var COLOR_G_LIGHT = 0.450;
var COLOR_B_LIGHT = 1.000;

export var localSpeed = 0.62;
export var level = 0.91;
export var fireflySize = 0.48;
export var driftDepth = 0.58;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderLevel(v) { level = v; }
export function sliderFireflySize(v) { fireflySize = v; }
export function sliderDriftDepth(v) { driftDepth = v; }

var phase = 0.0;
var liveLevel = 0.91;
var liveSize = 0.48;
var liveDepth = 0.58;

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
  phase = phase + clamp01(delta / 100.0) * 0.026 * speedMultiplier;
  if (phase >= 10000.0) phase = phase - 10000.0;
  liveLevel = clamp01(level);
  liveSize = clamp01(fireflySize);
  liveDepth = clamp01(driftDepth);
}

export function render3D(index, x, y, z) {
  var driftX = x + sin((phase * 0.71 + y * 0.6) * PI2) * liveDepth * 0.12;
  var driftY = y + cos((phase * 0.53 + z * 0.7) * PI2) * liveDepth * 0.10;
  var driftZ = z + sin((phase * 0.37 + x * 0.8) * PI2) * liveDepth * 0.11;
  var cellA = wave(driftX * 8.0 + driftY * 5.0 + driftZ * 3.0 - phase);
  var cellB = wave(driftX * 3.0 - driftY * 7.0 + driftZ * 9.0 + phase * 0.83);
  var focus = 7.0 - liveSize * 4.8;
  var fireflies = max(pow(cellA, focus), pow(cellB, focus * 1.12));
  var harbor = wave(x * 1.3 - phase * 0.25) * wave(z * 1.7 + phase * 0.18);
  var field = clamp01(fireflies * (0.72 + harbor * 0.24) + harbor * 0.14);
  var bri = clamp01((0.30 + field * 0.66) * liveLevel);
  emitColor(0.14 + field * 0.86, bri);
}
