// DRAFT - pending operator review
/* Helix Exchange: two counter-wound helices trade emphasis bow-to-stern. */

var BABY_BLUE_R = 0.033;
var BABY_BLUE_G = 0.450;
var BABY_BLUE_B = 1.000;
var BABY_PINK_R = 1.000;
var BABY_PINK_G = 0.035;
var BABY_PINK_B = 0.360;
export var localSpeed = 0.56;
export var level = 0.90;
export var helixWidth = 0.48;
export var turns = 0.55;
export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderLevel(v) { level = v; }
export function sliderHelixWidth(v) { helixWidth = v; }
export function sliderTurns(v) { turns = v; }

var phase = 0.0;
var teasePhase = 0.0;
function clamp01(v) { return min(1.0, max(0.0, v)); }
export function beforeRender(delta) {
  var dt = min(0.1, max(0.0, delta / 1000.0));
  var localMult = pow(2.0, (clamp01(localSpeed) - 0.5) * 4.0);
  phase = phase + dt * 0.36 * localMult;
  teasePhase = teasePhase + dt * 0.28 * localMult;
  if (phase >= 10000.0) phase = phase - 10000.0;
  if (teasePhase >= 10000.0) teasePhase = teasePhase - 10000.0;
}
export function render3D(index, x, y, z) {
  var cy = y - 0.5;
  var cz = z - 0.5;
  var angle = atan2(cz, cy) / PI2;
  var radial = sqrt(cy * cy + cz * cz);
  var turnCount = 2.0 + clamp01(turns) * 6.0;
  var focus = 2.0 + (1.0 - clamp01(helixWidth)) * 10.0;
  var helixA = pow(wave(angle + x * turnCount - phase), focus);
  var helixB = pow(wave(-angle + x * (turnCount * 0.83) + phase * 1.61803399), focus + 0.7);
  var core = pow(wave(radial * 5.0 - phase * 0.53), 7.0);
  var field = max(helixA, max(helixB * 0.94, core * 0.58));
  var familyBlue = index % 2;
  var dominance = 0.74 + 0.26 * wave(teasePhase + familyBlue * 0.5);
  var shade = clamp01(0.18 + field * 0.80);
  var bri = clamp01((0.16 + field * 0.86) * clamp01(level) * dominance);
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
