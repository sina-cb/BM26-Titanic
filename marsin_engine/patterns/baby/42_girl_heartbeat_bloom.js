// DRAFT - pending operator review
/* Baby-pink nested heartbeat blooms. COLOR_* constants are the only girl/boy delta. */

var COLOR_R_DARK = 1.000;
var COLOR_G_DARK = 0.035;
var COLOR_B_DARK = 0.360;
var COLOR_R_LIGHT = 1.000;
var COLOR_G_LIGHT = 0.035;
var COLOR_B_LIGHT = 0.360;

export var localSpeed = 0.56;
export var level = 0.90;
export var bloomSharpness = 0.50;
export var echoDepth = 0.58;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderLevel(v) { level = v; }
export function sliderBloomSharpness(v) { bloomSharpness = v; }
export function sliderEchoDepth(v) { echoDepth = v; }

var phase = 0.0;
var liveLevel = 0.90;
var liveSharpness = 0.50;
var liveEcho = 0.58;

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
  phase = phase + clamp01(delta / 100.0) * 0.088 * speedMultiplier;
  if (phase >= 10000.0) phase = phase - 10000.0;
  liveLevel = clamp01(level);
  liveSharpness = clamp01(bloomSharpness);
  liveEcho = clamp01(echoDepth);
}

export function render3D(index, x, y, z) {
  var cx = x - 0.5;
  var cy = (y - 0.5) * 1.18;
  var cz = z - 0.5;
  var radius = sqrt(cx * cx + cy * cy + cz * cz);
  var pulseA = wave(phase);
  var pulseB = wave(phase * 2.0 + 0.17) * 0.54;
  var focus = 2.0 + liveSharpness * 10.0;
  var shellA = pow(wave(radius * 3.9 - pulseA * 0.63), focus);
  var shellB = pow(wave(radius * (5.2 + liveEcho * 2.1) - pulseB), focus + 1.4);
  var heartPlane = pow(wave((x + z) * 2.7 - y * 1.9 + phase * 0.47), 8.0);
  var field = max(shellA, shellB * (0.46 + liveEcho * 0.42));
  var bri = clamp01((0.18 + field * 0.70 + heartPlane * field * 0.17) * liveLevel);
  emitColor(x, y, z, 0.15 + shellA * 0.68 + shellB * 0.48 + heartPlane * 0.17, bri);
}

