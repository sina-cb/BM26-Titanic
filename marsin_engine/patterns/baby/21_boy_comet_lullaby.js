// DRAFT - pending operator review
/* Baby-blue smooth comet procession. COLOR_* constants are the only girl/boy delta. */

var COLOR_R_DARK = 0.008;
var COLOR_G_DARK = 0.130;
var COLOR_B_DARK = 0.620;
var COLOR_R_LIGHT = 0.033;
var COLOR_G_LIGHT = 0.450;
var COLOR_B_LIGHT = 1.000;

export var localSpeed = 0.40;
export var level = 0.88;
export var tailLength = 0.56;
export var cometCount = 0.46;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderLevel(v) { level = v; }
export function sliderTailLength(v) { tailLength = v; }
export function sliderCometCount(v) { cometCount = v; }

var phase = 0.0;
var liveLevel = 0.88;
var liveTail = 0.56;
var liveCount = 0.46;

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
  phase = phase + clamp01(delta / 100.0) * 0.040 * speedMultiplier;
  if (phase >= 10000.0) phase = phase - 10000.0;
  liveLevel = clamp01(level);
  liveTail = clamp01(tailLength);
  liveCount = clamp01(cometCount);
}

export function render3D(index, x, y, z) {
  var count = 2.0 + liveCount * 5.0;
  var lane = x * count + y * 0.43 + z * 0.29;
  var travel = lane - phase * 1.17;
  var head = pow(wave(travel), 8.0 + (1.0 - liveTail) * 12.0);
  var tail = pow(wave(travel - 0.07 - liveTail * 0.16),
                 2.0 + (1.0 - liveTail) * 5.0);
  var sideDrift = wave(y * 2.0 - z * 1.7 + phase * 0.37);
  var ribbon = pow(wave((y - z) * 2.8 + sideDrift * 0.34 - phase * 0.53), 6.0);
  var field = max(head, tail * (0.38 + liveTail * 0.42));
  var bri = clamp01((0.17 + field * 0.73 + ribbon * field * 0.18) * liveLevel);
  emitColor(0.16 + tail * 0.50 + head * 0.52, bri);
}
