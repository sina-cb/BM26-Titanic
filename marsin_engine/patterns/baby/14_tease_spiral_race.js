// DRAFT - pending operator review
/* Spiral Race: fast counter-rotating spiral crests race around the ship axis. */

export var localSpeed = 0.75;
export var level = 0.95;
export var spiralWidth = 0.46;
export var spiralArms = 0.62;
export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderLevel(v) { level = v; }
export function sliderSpiralWidth(v) { spiralWidth = v; }
export function sliderSpiralArms(v) { spiralArms = v; }

var phase = 0.0;
var teasePhase = 0.0;
function clamp01(v) { return min(1.0, max(0.0, v)); }
export function beforeRender(delta) {
  var dt = min(0.1, max(0.0, delta / 1000.0));
  var localMult = pow(2.0, (clamp01(localSpeed) - 0.5) * 4.0);
  phase = phase + dt * 0.68 * localMult;
  teasePhase = teasePhase + dt * 0.53 * localMult;
  if (phase >= 10000.0) phase = phase - 10000.0;
  if (teasePhase >= 10000.0) teasePhase = teasePhase - 10000.0;
}
export function render3D(index, x, y, z) {
  var cx = x - 0.5;
  var cy = y - 0.5;
  var angle = atan2(cy, cx) / PI2;
  var radius = sqrt(cx * cx + cy * cy);
  var arms = 2.0 + floor(clamp01(spiralArms) * 8.0);
  var focus = 2.0 + (1.0 - clamp01(spiralWidth)) * 12.0;
  var spiralA = pow(wave(angle * arms + radius * 4.0 - phase + z * 0.71), focus);
  var spiralB = pow(wave(-angle * (arms + 1.0) + radius * 3.1 + phase * 1.41421356 - z * 0.53), focus + 0.8);
  var spark = pow(wave((x - y + z) * 13.0 + phase * 1.7320508), 14.0);
  var field = max(spiralA, max(spiralB * 0.94, spark * 0.52));
  var familyBlue = index % 2;
  var dominance = 0.66 + 0.34 * wave(teasePhase + familyBlue * 0.5);
  var shade = clamp01(0.13 + field * 0.87);
  var bri = clamp01((0.13 + field * 0.92) * clamp01(level) * dominance);
  if (familyBlue) rgbwau((0.010 + shade * 0.025) * bri, (0.16 + shade * 0.30) * bri, (0.64 + shade * 0.36) * bri, 0.0, 0.0, 0.0);
  else rgbwau((0.64 + shade * 0.36) * bri, (0.010 + shade * 0.025) * bri, (0.18 + shade * 0.18) * bri, 0.0, 0.0, 0.0);
}
