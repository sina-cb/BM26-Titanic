// DRAFT - pending operator review
/* Kaleidoscope: folded angular geometry rotates through three model planes. */

var BABY_BLUE_R = 0.033;
var BABY_BLUE_G = 0.450;
var BABY_BLUE_B = 1.000;
var BABY_PINK_R = 1.000;
var BABY_PINK_G = 0.035;
var BABY_PINK_B = 0.360;
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
