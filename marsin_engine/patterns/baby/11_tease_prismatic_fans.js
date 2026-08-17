// DRAFT - pending operator review
/* Prismatic Fans: rotating fan wedges open from opposing corners in XYZ. */

export var localSpeed = 0.62;
export var level = 0.92;
export var fanWidth = 0.50;
export var fanCount = 0.52;
export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderLevel(v) { level = v; }
export function sliderFanWidth(v) { fanWidth = v; }
export function sliderFanCount(v) { fanCount = v; }

var phase = 0.0;
var teasePhase = 0.0;
function clamp01(v) { return min(1.0, max(0.0, v)); }
export function beforeRender(delta) {
  var dt = min(0.1, max(0.0, delta / 1000.0));
  var localMult = pow(2.0, (clamp01(localSpeed) - 0.5) * 4.0);
  phase = phase + dt * 0.45 * localMult;
  teasePhase = teasePhase + dt * 0.35 * localMult;
  if (phase >= 10000.0) phase = phase - 10000.0;
  if (teasePhase >= 10000.0) teasePhase = teasePhase - 10000.0;
}
export function render3D(index, x, y, z) {
  var angleA = atan2(y - 0.12, x - 0.08) / PI2;
  var angleB = atan2(y - 0.88, z - 0.92) / PI2;
  var count = 3.0 + floor(clamp01(fanCount) * 8.0);
  var focus = 2.0 + (1.0 - clamp01(fanWidth)) * 11.0;
  var fanA = pow(wave(angleA * count - phase + z * 0.63), focus);
  var fanB = pow(wave(angleB * (count + 1.0) + phase * 1.41421356 - x * 0.47), focus + 0.6);
  var hinge = pow(wave((x + y + z) * 3.0 - phase * 0.71), 8.0);
  var field = max(fanA, max(fanB * 0.95, hinge * 0.58));
  var familyBlue = index % 2;
  var dominance = 0.72 + 0.28 * wave(teasePhase + familyBlue * 0.5);
  var shade = clamp01(0.16 + field * 0.84);
  var bri = clamp01((0.15 + field * 0.88) * clamp01(level) * dominance);
  if (familyBlue) rgbwau((0.010 + shade * 0.025) * bri, (0.16 + shade * 0.30) * bri, (0.64 + shade * 0.36) * bri, 0.0, 0.0, 0.0);
  else rgbwau((0.64 + shade * 0.36) * bri, (0.010 + shade * 0.025) * bri, (0.18 + shade * 0.18) * bri, 0.0, 0.0, 0.0);
}
