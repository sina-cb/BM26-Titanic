// DRAFT - pending operator review
/* Spiral Race: fast counter-rotating spiral crests race around the ship axis. */

var BABY_BLUE_R = 0.033;
var BABY_BLUE_G = 0.450;
var BABY_BLUE_B = 1.000;
var BABY_PINK_R = 1.000;
var BABY_PINK_G = 0.035;
var BABY_PINK_B = 0.360;
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
  var geometry = clamp01(shade);
  var energy = clamp01(bri);
  var gate = geometry * 0.70 + energy * 0.30;
  if (gate < 0.16 || (fixtureType != FIX_TE_SIGN && wave(x * 1.7 + y * 1.3 + z * 1.1) < 0.12)) {
    rgbwau(0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
    return;
  }
  var intensity = clamp01(0.65 + energy * 0.35);
  if (familyBlue) {
    rgbwau(BABY_BLUE_R * intensity, BABY_BLUE_G * intensity,
           BABY_BLUE_B * intensity, 0.0, 0.0, 0.0);
  } else {
    rgbwau(BABY_PINK_R * intensity, BABY_PINK_G * intensity,
           BABY_PINK_B * intensity, 0.0, 0.0, 0.0);
  }
}
