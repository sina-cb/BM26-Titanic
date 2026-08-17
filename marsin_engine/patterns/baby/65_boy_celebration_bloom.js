// DRAFT - pending operator review
/* Baby-blue celebration petals unfold smoothly over a persistent photo wash. */

var COLOR_R_DARK = 0.008;
var COLOR_G_DARK = 0.130;
var COLOR_B_DARK = 0.620;
var COLOR_R_LIGHT = 0.033;
var COLOR_G_LIGHT = 0.450;
var COLOR_B_LIGHT = 1.000;

export var localSpeed = 0.48;
export var level = 0.92;
export var petalCount = 0.52;
export var bloomDepth = 0.58;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderLevel(v) { level = v; }
export function sliderPetalCount(v) { petalCount = v; }
export function sliderBloomDepth(v) { bloomDepth = v; }

var phaseA = 0.0;
var phaseB = 0.0;
var phaseC = 0.0;
var liveLevel = 0.92;
var liveCount = 0.52;
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
  var dt = min(0.1, max(0.0, delta / 1000.0));
  var speedMultiplier = pow(2.0, (clamp01(localSpeed) - 0.5) * 4.0);
  phaseA = phaseA + dt * 0.13 * speedMultiplier;
  phaseB = phaseB + dt * 0.13 * 1.41421356 * speedMultiplier;
  phaseC = phaseC + dt * 0.13 * 1.73205081 * speedMultiplier;
  if (phaseA >= 10000.0) phaseA = phaseA - 10000.0;
  if (phaseB >= 10000.0) phaseB = phaseB - 10000.0;
  if (phaseC >= 10000.0) phaseC = phaseC - 10000.0;
  liveLevel = clamp01(level);
  liveCount = clamp01(petalCount);
  liveDepth = clamp01(bloomDepth);
}

export function render3D(index, x, y, z) {
  var cx = x - 0.5;
  var cy = y - 0.5;
  var cz = z - 0.5;
  var radiusA = sqrt(cx * cx + cy * cy * 1.12 + cz * cz * 0.92);
  var shiftX = cx + 0.17;
  var shiftY = cy - 0.11;
  var shiftZ = cz + 0.08;
  var radiusB = sqrt(shiftX * shiftX * 0.88 + shiftY * shiftY * 1.19 +
                     shiftZ * shiftZ * 1.07);
  var count = 1.6 + liveCount * 5.4;
  var petalA = wave((cx * 0.81 + cy * 1.13 + cz * 1.37) * count + phaseB);
  var petalB = wave((-cx * 1.21 + cy * 0.67 + cz * 0.93) * count - phaseC);
  var petalWarp = (petalA + petalB - 1.0) * (0.045 + liveDepth * 0.105);
  var bloomA = pow(wave((radiusA + petalWarp) * 3.2 - phaseA), 1.65);
  var bloomB = pow(wave((radiusB - petalWarp * 0.72) * 4.1 + phaseB * 0.71), 1.95);
  var overlap = sqrt(bloomA * bloomB);
  var petals = sqrt(petalA * petalB);
  var field = clamp01(bloomA * 0.52 + bloomB * 0.38 +
                      overlap * (0.12 + liveDepth * 0.25) +
                      petals * liveDepth * 0.10);
  var shade = clamp01(0.18 + field * 0.70 + overlap * 0.16);
  var bri = clamp01((0.30 + field * 0.68) * liveLevel);
  emitColor(shade, bri);
}
