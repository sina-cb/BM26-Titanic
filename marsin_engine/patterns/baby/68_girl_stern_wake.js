// DRAFT - pending operator review
/* Baby-pink stern wake opens into layered 3D fans over a steady photo wash. */

var COLOR_R_DARK = 0.620;
var COLOR_G_DARK = 0.008;
var COLOR_B_DARK = 0.170;
var COLOR_R_LIGHT = 1.000;
var COLOR_G_LIGHT = 0.035;
var COLOR_B_LIGHT = 0.360;

export var localSpeed = 0.34;
export var level = 0.88;
export var wakeSpread = 0.56;
export var rippleDensity = 0.48;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderLevel(v) { level = v; }
export function sliderWakeSpread(v) { wakeSpread = v; }
export function sliderRippleDensity(v) { rippleDensity = v; }

var phaseA = 0.0;
var phaseB = 0.0;
var liveLevel = 0.88;
var liveSpread = 0.56;
var liveDensity = 0.48;

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
  phaseA = phaseA + dt * 0.16 * speedMultiplier;
  phaseB = phaseB + dt * 0.16 * 1.41421356 * speedMultiplier;
  if (phaseA >= 10000.0) phaseA = phaseA - 10000.0;
  if (phaseB >= 10000.0) phaseB = phaseB - 10000.0;
  liveLevel = clamp01(level);
  liveSpread = clamp01(wakeSpread);
  liveDensity = clamp01(rippleDensity);
}

export function render3D(index, x, y, z) {
  var lateral = y - 0.5;
  var height = z - 0.5;
  var widening = 0.055 + x * (0.18 + liveSpread * 0.54);
  var swayA = (wave(x * 0.73 - phaseA * 0.61) - 0.5) * widening * 0.48;
  var swayB = (wave(x * 0.91 + phaseB * 0.47) - 0.5) * widening * 0.42;
  var fanA = clamp01(1.0 - abs(lateral + height * 0.58 - swayA) / widening);
  var fanB = clamp01(1.0 - abs(lateral - height * 0.71 + swayB) / widening);
  var fanC = clamp01(1.0 - abs(height + lateral * 0.37 - swayB * 0.72) /
                     (widening * 1.12));
  var density = 2.2 + liveDensity * 5.8;
  var rippleA = wave(x * density - phaseA + lateral * 0.81 + height * 0.43);
  var rippleB = wave(x * density * 1.41421356 + phaseB - lateral * 0.57 + height * 0.69);
  var layered = max(fanA * (0.40 + rippleA * 0.60),
                    max(fanB * (0.36 + rippleB * 0.58),
                        fanC * (0.34 + rippleA * rippleB * 0.56)));
  var sternRadius = sqrt(x * x + lateral * lateral * 1.8 + height * height * 1.5);
  var sternGlow = pow(clamp01(1.0 - sternRadius / (0.16 + liveSpread * 0.10)), 1.6);
  var field = clamp01(max(layered, sternGlow * 0.92));
  var shade = clamp01(0.20 + field * 0.72 + (rippleA + rippleB) * 0.06);
  var bri = clamp01((0.30 + field * 0.62) * liveLevel);
  emitColor(shade, bri);
}
