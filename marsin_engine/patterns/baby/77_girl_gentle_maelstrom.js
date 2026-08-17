// DRAFT - pending operator review
/* Baby-pink gentle maelstrom turns through a persistent full-ship photo wash. */

var COLOR_R_DARK = 0.620;
var COLOR_G_DARK = 0.008;
var COLOR_B_DARK = 0.170;
var COLOR_R_LIGHT = 1.000;
var COLOR_G_LIGHT = 0.035;
var COLOR_B_LIGHT = 0.360;

export var localSpeed = 0.27;
export var level = 0.94;
export var spiralWidth = 0.68;
export var currentDepth = 0.48;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderLevel(v) { level = v; }
export function sliderSpiralWidth(v) { spiralWidth = v; }
export function sliderCurrentDepth(v) { currentDepth = v; }

var spiralPhase = 0.0;
var undertowPhase = 0.0;
var liveLevel = 0.94;
var liveWidth = 0.68;
var liveDepth = 0.48;

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
  spiralPhase = spiralPhase + dt * 0.052 * speedMultiplier;
  undertowPhase = undertowPhase + dt * 0.03676955 * speedMultiplier;
  if (spiralPhase >= 10000.0) spiralPhase = spiralPhase - 10000.0;
  if (undertowPhase >= 10000.0) undertowPhase = undertowPhase - 10000.0;
  liveLevel = clamp01(level);
  liveWidth = clamp01(spiralWidth);
  liveDepth = clamp01(currentDepth);
}

export function render3D(index, x, y, z) {
  var centerX = x - 0.5;
  var centerY = y - 0.5;
  var centerZ = z - 0.5;
  var angle = atan2(centerY, centerX) / PI2;
  var radius = sqrt(centerX * centerX + centerY * centerY);
  var focus = 1.35 + (1.0 - liveWidth) * 3.65;
  var spiral = pow(wave(angle + radius * (1.75 + liveDepth * 1.55) +
                        centerZ * 0.62 - spiralPhase), focus);
  var undertow = pow(wave(radius * 1.35 - centerZ * 0.94 - undertowPhase),
                     focus + 0.55);
  var softCore = pow(clamp01(1.0 - radius * 1.55), 1.8);
  var current = clamp01(spiral * (0.42 + liveDepth * 0.34) +
                        undertow * (0.18 + liveDepth * 0.27) +
                        softCore * (0.08 + liveDepth * 0.10));
  var breathe = 0.89 + 0.11 * wave(undertowPhase * 0.25 + z * 0.17);
  var bri = clamp01((0.34 + current * 0.60) * liveLevel * breathe);
  emitColor(0.16 + current * 0.84, bri);
}
