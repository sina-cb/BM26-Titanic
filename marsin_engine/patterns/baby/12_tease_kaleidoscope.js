// DRAFT - pending operator review
/* Kaleidoscope: folded angular geometry rotates through three model planes. */

export var localSpeed = 0.66;
export var level = 0.92;
export var foldCount = 0.58;
export var edgeFocus = 0.62;
export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderLevel(v) { level = v; }
export function sliderFoldCount(v) { foldCount = v; }
export function sliderEdgeFocus(v) { edgeFocus = v; }

var phase = 0.0;
var teasePhase = 0.0;
function clamp01(v) { return min(1.0, max(0.0, v)); }
export function beforeRender(delta) {
  var dt = min(0.1, max(0.0, delta / 1000.0));
  var localMult = pow(2.0, (clamp01(localSpeed) - 0.5) * 4.0);
  phase = phase + dt * 0.35 * localMult;
  teasePhase = teasePhase + dt * 0.27 * localMult;
  if (phase >= 10000.0) phase = phase - 10000.0;
  if (teasePhase >= 10000.0) teasePhase = teasePhase - 10000.0;
}
export function render3D(index, x, y, z) {
  var ax = atan2(y - 0.5, x - 0.5) / PI2;
  var ay = atan2(z - 0.5, y - 0.5) / PI2;
  var az = atan2(x - 0.5, z - 0.5) / PI2;
  var folds = 3.0 + floor(clamp01(foldCount) * 9.0);
  var focus = 2.0 + clamp01(edgeFocus) * 10.0;
  var planeA = pow(wave(abs(wave(ax * folds + phase) - 0.5) * 2.0), focus);
  var planeB = pow(wave(abs(wave(ay * (folds + 1.0) - phase * 1.41421356) - 0.5) * 2.0), focus);
  var planeC = pow(wave(abs(wave(az * (folds + 2.0) + phase * 1.7320508) - 0.5) * 2.0), focus);
  var field = max(planeA, max(planeB * 0.94, planeC * 0.88));
  var familyBlue = index % 2;
  var dominance = 0.70 + 0.30 * wave(teasePhase + familyBlue * 0.5);
  var shade = clamp01(0.15 + field * 0.86);
  var bri = clamp01((0.14 + field * 0.90) * clamp01(level) * dominance);
  if (familyBlue) rgbwau((0.010 + shade * 0.025) * bri, (0.16 + shade * 0.30) * bri, (0.64 + shade * 0.36) * bri, 0.0, 0.0, 0.0);
  else rgbwau((0.64 + shade * 0.36) * bri, (0.010 + shade * 0.025) * bri, (0.18 + shade * 0.18) * bri, 0.0, 0.0, 0.0);
}
