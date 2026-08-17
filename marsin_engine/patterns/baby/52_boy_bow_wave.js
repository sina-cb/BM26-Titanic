// DRAFT - pending operator review
/* Baby-blue bow wave rolls through a persistent full-ship photo wash. */

var COLOR_R_DARK = 0.008;
var COLOR_G_DARK = 0.130;
var COLOR_B_DARK = 0.620;
var COLOR_R_LIGHT = 0.033;
var COLOR_G_LIGHT = 0.450;
var COLOR_B_LIGHT = 1.000;

export var localSpeed = 0.34;
export var level = 0.96;
export var waveWidth = 0.62;
export var waveDepth = 0.50;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderLevel(v) { level = v; }
export function sliderWaveWidth(v) { waveWidth = v; }
export function sliderWaveDepth(v) { waveDepth = v; }

var frontPhase = 0.0;
var undertowPhase = 0.0;
var liveLevel = 0.96;
var liveWidth = 0.62;
var liveDepth = 0.50;

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
  var dt = min(0.1, max(0.0, delta / 1000.0));
  var speedMultiplier = pow(2.0, (clamp01(localSpeed) - 0.5) * 4.0);
  frontPhase = frontPhase + dt * 0.18 * speedMultiplier;
  undertowPhase = undertowPhase + dt * 0.12727922 * speedMultiplier;
  if (frontPhase >= 10000.0) frontPhase = frontPhase - 10000.0;
  if (undertowPhase >= 10000.0) undertowPhase = undertowPhase - 10000.0;
  liveLevel = clamp01(level);
  liveWidth = clamp01(waveWidth);
  liveDepth = clamp01(waveDepth);
}

export function render3D(index, x, y, z) {
  var bowY = y - 0.5;
  var bowZ = z - 0.5;
  var radius = sqrt(x * x * 0.72 + bowY * bowY * 1.36 + bowZ * bowZ * 1.08);
  var focus = 2.0 + (1.0 - liveWidth) * 8.0;
  var broadFront = pow(wave(radius * 2.35 - frontPhase), focus);
  var undertow = pow(wave(radius * 3.10 - undertowPhase + y * 0.21 - z * 0.17),
                     focus + 1.6);
  var bowLift = pow(clamp01(1.0 - radius * 0.78), 1.6);
  var build = 0.74 + 0.26 * wave(undertowPhase * 0.25);
  var field = clamp01(broadFront * (0.35 + liveDepth * 0.47) +
                      undertow * (0.12 + liveDepth * 0.28) +
                      bowLift * (0.10 + liveDepth * 0.12));
  var bri = clamp01((0.31 + field * 0.64) * liveLevel * build);
  emitColor(0.16 + field * 0.84, bri);
}
