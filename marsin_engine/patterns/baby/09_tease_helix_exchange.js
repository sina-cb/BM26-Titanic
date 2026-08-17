// DRAFT - pending operator review
/* Helix Exchange: two counter-wound helices trade emphasis bow-to-stern. */

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
  if (familyBlue) rgbwau((0.010 + shade * 0.025) * bri, (0.16 + shade * 0.30) * bri, (0.64 + shade * 0.36) * bri, 0.0, 0.0, 0.0);
  else rgbwau((0.64 + shade * 0.36) * bri, (0.010 + shade * 0.025) * bri, (0.18 + shade * 0.18) * bri, 0.0, 0.0, 0.0);
}
