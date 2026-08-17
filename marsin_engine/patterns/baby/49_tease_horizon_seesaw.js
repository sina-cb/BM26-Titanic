// DRAFT - pending operator review
/* Horizon Seesaw: paired pink and blue horizons breathe across all three axes. */

export var localSpeed = 0.48;
export var level = 0.88;
export var horizonWidth = 0.56;
export var seesawDepth = 0.54;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderLevel(v) { level = v; }
export function sliderHorizonWidth(v) { horizonWidth = v; }
export function sliderSeesawDepth(v) { seesawDepth = v; }

var phase = 0.0;
var liveLevel = 0.88;
var liveWidth = 0.56;
var liveDepth = 0.54;

function clamp01(v) {
  if (v < 0.0) return 0.0;
  if (v > 1.0) return 1.0;
  return v;
}

export function beforeRender(delta) {
  var speedMultiplier = pow(2.0, (clamp01(localSpeed) - 0.5) * 4.0);
  phase = phase + clamp01(delta / 100.0) * 0.032 * speedMultiplier;
  if (phase >= 10000.0) phase = phase - 10000.0;
  liveLevel = clamp01(level);
  liveWidth = clamp01(horizonWidth);
  liveDepth = clamp01(seesawDepth);
}

export function render3D(index, x, y, z) {
  var familyBlue = index % 2;
  var familyOffset = familyBlue * 0.5;
  var rocking = wave(phase + familyOffset) - 0.5;
  var tilt = rocking * (0.10 + liveDepth * 0.30);
  var horizon = 0.5 + tilt * (x - 0.5) * 2.0;
  var width = 0.07 + liveWidth * 0.24;
  var yBand = clamp01(1.0 - abs(y - horizon) / width);
  var zBand = clamp01(1.0 - abs(z - (1.0 - horizon)) / (width * 1.15));
  var longWave = wave(x * (1.4 + liveDepth * 1.8) - phase * 0.43 + familyOffset);
  var field = clamp01(max(yBand, zBand * 0.86) + longWave * 0.24);
  var dominance = 0.76 + wave(phase * 0.72 + familyOffset) * 0.24;
  var bri = clamp01((0.24 + field * 0.72) * liveLevel * dominance);
  var shade = clamp01(0.18 + field * 0.82);

  if (familyBlue) {
    rgbwau((0.008 + shade * 0.025) * bri,
           (0.13 + shade * 0.32) * bri,
           (0.62 + shade * 0.38) * bri,
           0.0, 0.0, 0.0);
  } else {
    rgbwau((0.62 + shade * 0.38) * bri,
           (0.008 + shade * 0.027) * bri,
           (0.17 + shade * 0.19) * bri,
           0.0, 0.0, 0.0);
  }
}
