// DRAFT - pending operator review
/* Baby-pink breathing bubble field. COLOR_* constants are the only girl/boy delta. */

var COLOR_R_DARK = 0.620;
var COLOR_G_DARK = 0.008;
var COLOR_B_DARK = 0.140;
var COLOR_R_LIGHT = 1.000;
var COLOR_G_LIGHT = 0.040;
var COLOR_B_LIGHT = 0.360;

export var localSpeed = 0.49;
export var level = 0.89;
export var bubbleSize = 0.50;
export var cellDensity = 0.52;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderLevel(v) { level = v; }
export function sliderBubbleSize(v) { bubbleSize = v; }
export function sliderCellDensity(v) { cellDensity = v; }

var phase = 0.0;
var liveLevel = 0.89;
var liveSize = 0.50;
var liveDensity = 0.52;

function clamp01(v) { if (v < 0.0) return 0.0; if (v > 1.0) return 1.0; return v; }
function emitColor(shade, bri) {
  var s = clamp01(shade);
  rgbwau((COLOR_R_DARK + (COLOR_R_LIGHT - COLOR_R_DARK) * s) * bri,
         (COLOR_G_DARK + (COLOR_G_LIGHT - COLOR_G_DARK) * s) * bri,
         (COLOR_B_DARK + (COLOR_B_LIGHT - COLOR_B_DARK) * s) * bri,
         0.0, 0.0, 0.0);
}

export function beforeRender(delta) {
  var speedMultiplier = pow(2.0, (clamp01(localSpeed) - 0.5) * 4.0);
  phase = phase + clamp01(delta / 100.0) * 0.066 * speedMultiplier;
  if (phase >= 10000.0) phase = phase - 10000.0;
  liveLevel = clamp01(level);
  liveSize = clamp01(bubbleSize);
  liveDensity = clamp01(cellDensity);
}

export function render3D(index, x, y, z) {
  var density = 2.0 + liveDensity * 5.0;
  var cellA = wave(x * density + phase * 0.29) *
              wave(y * density * 0.83 - phase * 0.41) *
              wave(z * density * 0.71 + phase * 0.53);
  var cellB = wave((x + y) * density * 0.61 - phase * 0.73) *
              wave((y + z) * density * 0.57 + phase * 0.61);
  var threshold = 0.70 - liveSize * 0.43;
  var bubbleA = clamp01((cellA - threshold) / (1.0 - threshold));
  var bubbleB = clamp01((cellB - threshold * 0.91) / (1.0 - threshold * 0.91));
  var rims = pow(1.0 - abs(bubbleA - 0.52) * 1.92, 4.0) * bubbleA;
  var field = max(bubbleA, bubbleB * 0.84);
  var bri = clamp01((0.18 + field * 0.62 + rims * 0.25) * liveLevel);
  emitColor(0.16 + field * 0.63 + rims * 0.36, bri);
}

