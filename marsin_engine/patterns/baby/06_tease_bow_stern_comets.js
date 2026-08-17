// DRAFT - pending operator review
/* Bow-Stern Comets: mirrored heads and long tails exchange along X. */

var BABY_BLUE_R = 0.033;
var BABY_BLUE_G = 0.450;
var BABY_BLUE_B = 1.000;
var BABY_PINK_R = 1.000;
var BABY_PINK_G = 0.035;
var BABY_PINK_B = 0.360;
export var localSpeed = 0.47;
export var level = 0.88;
export var tailLength = 0.55;
export var cometFocus = 0.62;
export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderLevel(v) { level = v; }
export function sliderTailLength(v) { tailLength = v; }
export function sliderCometFocus(v) { cometFocus = v; }

var travel = 0.0;
var teasePhase = 0.0;
function clamp01(v) { return min(1.0, max(0.0, v)); }
export function beforeRender(delta) {
  var dt = min(0.1, max(0.0, delta / 1000.0));
  var localMult = pow(2.0, (clamp01(localSpeed) - 0.5) * 4.0);
  travel = travel + dt * 0.27 * localMult;
  teasePhase = teasePhase + dt * 0.21 * localMult;
  if (travel >= 10000.0) travel = travel - 10000.0;
  if (teasePhase >= 10000.0) teasePhase = teasePhase - 10000.0;
}
export function render3D(index, x, y, z) {
  var headA = wave(travel * 0.5);
  var headB = 1.0 - wave(travel * 0.5 + 0.25);
  var len = 0.08 + clamp01(tailLength) * 0.34;
  var focus = 3.0 + clamp01(cometFocus) * 10.0;
  var distA = abs(x - headA) + abs(y - wave(headA * 0.37 + z * 0.63)) * 0.30;
  var distB = abs(x - headB) + abs(y - wave(headB * 0.53 - z * 0.71)) * 0.30;
  var cometA = pow(clamp01(1.0 - distA / len), 1.3 + focus * 0.08);
  var cometB = pow(clamp01(1.0 - distB / len), 1.3 + focus * 0.08);
  var ribs = pow(wave(x * 9.0 + z * 4.0 - travel * 1.41421356), focus);
  var field = max(cometA, cometB);
  var familyBlue = index % 2;
  var dominance = 0.76 + 0.24 * wave(teasePhase + familyBlue * 0.5);
  var shade = clamp01(0.19 + field * 0.73 + ribs * 0.15);
  var bri = clamp01((0.16 + field * 0.78 + ribs * 0.15) * clamp01(level) * dominance);
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
