// DRAFT - pending operator review
/* Constellation Tides: drifting star knots ride over a smooth spatial sea. */

var BABY_BLUE_R = 0.033;
var BABY_BLUE_G = 0.450;
var BABY_BLUE_B = 1.000;
var BABY_PINK_R = 1.000;
var BABY_PINK_G = 0.035;
var BABY_PINK_B = 0.360;
export var localSpeed = 0.59;
export var level = 0.90;
export var starFocus = 0.62;
export var tideDepth = 0.54;
export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderLevel(v) { level = v; }
export function sliderStarFocus(v) { starFocus = v; }
export function sliderTideDepth(v) { tideDepth = v; }

var phase = 0.0;
var teasePhase = 0.0;
function clamp01(v) { return min(1.0, max(0.0, v)); }
export function beforeRender(delta) {
  var dt = min(0.1, max(0.0, delta / 1000.0));
  var localMult = pow(2.0, (clamp01(localSpeed) - 0.5) * 4.0);
  phase = phase + dt * 0.40 * localMult;
  teasePhase = teasePhase + dt * 0.31 * localMult;
  if (phase >= 10000.0) phase = phase - 10000.0;
  if (teasePhase >= 10000.0) teasePhase = teasePhase - 10000.0;
}
export function render3D(index, x, y, z) {
  var focus = 5.0 + clamp01(starFocus) * 16.0;
  var latticeA = pow(wave(x * 11.0 + y * 7.0 - phase), focus);
  var latticeB = pow(wave(y * 13.0 - z * 5.0 + phase * 1.41421356), focus);
  var latticeC = pow(wave(z * 17.0 + x * 3.0 - phase * 1.7320508), focus);
  var stars = pow(latticeA * latticeB * latticeC, 0.42);
  var tide = wave(x * 1.7 - y * 0.7 + z * 1.1 - phase * 0.37);
  var field = max(stars, pow(tide, 2.5) * (0.30 + clamp01(tideDepth) * 0.38));
  var familyBlue = index % 2;
  var dominance = 0.73 + 0.27 * wave(teasePhase + familyBlue * 0.5);
  var shade = clamp01(0.18 + field * 0.82);
  var bri = clamp01((0.18 + field * 0.84) * clamp01(level) * dominance);
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
