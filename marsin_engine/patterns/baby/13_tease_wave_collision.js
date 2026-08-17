// DRAFT - pending operator review
/* Wave Collision: fast bow and stern wavefronts meet in a bright central seam. */

export var localSpeed = 0.70;
export var level = 0.94;
export var frontWidth = 0.48;
export var collisionEnergy = 0.66;
export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderLevel(v) { level = v; }
export function sliderFrontWidth(v) { frontWidth = v; }
export function sliderCollisionEnergy(v) { collisionEnergy = v; }

var phase = 0.0;
var teasePhase = 0.0;
function clamp01(v) { return min(1.0, max(0.0, v)); }
export function beforeRender(delta) {
  var dt = min(0.1, max(0.0, delta / 1000.0));
  var localMult = pow(2.0, (clamp01(localSpeed) - 0.5) * 4.0);
  phase = phase + dt * 0.58 * localMult;
  teasePhase = teasePhase + dt * 0.45 * localMult;
  if (phase >= 10000.0) phase = phase - 10000.0;
  if (teasePhase >= 10000.0) teasePhase = teasePhase - 10000.0;
}
export function render3D(index, x, y, z) {
  var width = 0.05 + clamp01(frontWidth) * 0.24;
  var head = wave(phase * 0.5);
  var frontA = pow(clamp01(1.0 - abs(x - head) / width), 1.8);
  var frontB = pow(clamp01(1.0 - abs((1.0 - x) - head) / width), 1.8);
  var collision = pow(clamp01(1.0 - abs(frontA - frontB)), 4.0) * min(frontA + frontB, 1.0);
  var shock = pow(wave(y * 8.0 + z * 5.0 - phase * 1.7320508), 9.0) * clamp01(collisionEnergy);
  var field = max(max(frontA, frontB), collision * (0.65 + clamp01(collisionEnergy) * 0.35));
  var familyBlue = index % 2;
  var dominance = 0.68 + 0.32 * wave(teasePhase + familyBlue * 0.5);
  var shade = clamp01(0.14 + field * 0.82 + shock * 0.16);
  var bri = clamp01((0.14 + field * 0.90 + shock * 0.14) * clamp01(level) * dominance);
  if (familyBlue) rgbwau((0.010 + shade * 0.025) * bri, (0.16 + shade * 0.30) * bri, (0.64 + shade * 0.36) * bri, 0.0, 0.0, 0.0);
  else rgbwau((0.64 + shade * 0.36) * bri, (0.010 + shade * 0.025) * bri, (0.18 + shade * 0.18) * bri, 0.0, 0.0, 0.0);
}
