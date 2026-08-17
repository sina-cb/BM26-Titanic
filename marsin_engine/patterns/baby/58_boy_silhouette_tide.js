// DRAFT - pending operator review
/* Baby-blue silhouette tides trace the ship's spatial edges over a calm wash. */

var COLOR_R_DARK = 0.008;
var COLOR_G_DARK = 0.130;
var COLOR_B_DARK = 0.620;
var COLOR_R_LIGHT = 0.033;
var COLOR_G_LIGHT = 0.450;
var COLOR_B_LIGHT = 1.000;

export var localSpeed = 0.46;
export var level = 0.89;
export var tideWidth = 0.52;
export var silhouetteDepth = 0.58;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderLevel(v) { level = v; }
export function sliderTideWidth(v) { tideWidth = v; }
export function sliderSilhouetteDepth(v) { silhouetteDepth = v; }

var phase = 0.0;
var liveLevel = 0.89;
var liveWidth = 0.52;
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
  phase = phase + clamp01(delta / 100.0) * 0.030 * speedMultiplier;
  if (phase >= 10000.0) phase = phase - 10000.0;
  liveLevel = clamp01(level);
  liveWidth = clamp01(tideWidth);
  liveDepth = clamp01(silhouetteDepth);
}

export function render3D(index, x, y, z) {
  var edgeY = abs(y - 0.5) * 2.0;
  var edgeZ = abs(z - 0.5) * 2.0;
  var edge = max(edgeY, edgeZ);
  var movingEdge = 0.60 + sin((x * 1.2 - phase) * PI2) * (0.06 + liveDepth * 0.12);
  var width = 0.045 + liveWidth * 0.18;
  var outline = clamp01(1.0 - abs(edge - movingEdge) / width);
  var tide = pow(wave(x * (1.6 + liveDepth * 2.8) - phase + edge * 0.28), 2.0 + liveDepth * 2.4);
  var field = clamp01(outline * 0.78 + tide * (0.16 + outline * 0.20));
  var breath = 0.84 + wave(phase * 0.41 + x * 0.13) * 0.16;
  var bri = clamp01((0.30 + field * 0.66) * liveLevel * breath);
  emitColor(0.15 + field * 0.85, bri);
}
