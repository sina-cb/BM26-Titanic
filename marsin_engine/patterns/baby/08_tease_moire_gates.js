// DRAFT - pending operator review
/* Moire Gates: opposing slanted line fields form moving portal bands. */

export var localSpeed = 0.53;
export var level = 0.88;
export var lineWidth = 0.50;
export var interference = 0.60;
export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderLevel(v) { level = v; }
export function sliderLineWidth(v) { lineWidth = v; }
export function sliderInterference(v) { interference = v; }

var phaseA = 0.0;
var phaseB = 0.0;
var teasePhase = 0.0;
function clamp01(v) { return min(1.0, max(0.0, v)); }
export function beforeRender(delta) {
  var dt = min(0.1, max(0.0, delta / 1000.0));
  var localMult = pow(2.0, (clamp01(localSpeed) - 0.5) * 4.0);
  phaseA = phaseA + dt * 0.33 * localMult;
  phaseB = phaseB + dt * 0.33 * 1.41421356 * localMult;
  teasePhase = teasePhase + dt * 0.25 * localMult;
  if (phaseA >= 10000.0) phaseA = phaseA - 10000.0;
  if (phaseB >= 10000.0) phaseB = phaseB - 10000.0;
  if (teasePhase >= 10000.0) teasePhase = teasePhase - 10000.0;
}
export function render3D(index, x, y, z) {
  var focus = 2.0 + (1.0 - clamp01(lineWidth)) * 12.0;
  var fieldA = pow(wave(x * 6.0 + y * 3.7 + z * 1.9 - phaseA), focus);
  var fieldB = pow(wave(x * 5.3 - y * 4.1 + z * 2.7 + phaseB), focus);
  var cross = pow(clamp01(1.0 - abs(fieldA - fieldB)), 2.0 + clamp01(interference) * 5.0);
  var gate = pow(wave(abs(x - 0.5) * 6.0 + abs(z - 0.5) * 4.0 - phaseA * 0.47), 8.0);
  var field = max(max(fieldA, fieldB), max(cross * 0.72, gate * 0.68));
  var familyBlue = index % 2;
  var dominance = 0.75 + 0.25 * wave(teasePhase + familyBlue * 0.5);
  var shade = clamp01(0.17 + field * 0.82);
  var bri = clamp01((0.16 + field * 0.84) * clamp01(level) * dominance);
  if (familyBlue) rgbwau((0.010 + shade * 0.025) * bri, (0.16 + shade * 0.30) * bri, (0.64 + shade * 0.36) * bri, 0.0, 0.0, 0.0);
  else rgbwau((0.64 + shade * 0.36) * bri, (0.010 + shade * 0.025) * bri, (0.18 + shade * 0.18) * bri, 0.0, 0.0, 0.0);
}
