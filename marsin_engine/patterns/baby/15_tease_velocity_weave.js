// DRAFT - pending operator review
/* Velocity Weave: the fastest tease, with smooth woven crests and swaps. */

export var localSpeed = 0.80;
export var level = 0.96;
export var strandWidth = 0.48;
export var weaveDepth = 0.68;
export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderLevel(v) { level = v; }
export function sliderStrandWidth(v) { strandWidth = v; }
export function sliderWeaveDepth(v) { weaveDepth = v; }

var phaseA = 0.0;
var phaseB = 0.0;
var teasePhase = 0.0;
function clamp01(v) { return min(1.0, max(0.0, v)); }
export function beforeRender(delta) {
  var dt = min(0.1, max(0.0, delta / 1000.0));
  var localMult = pow(2.0, (clamp01(localSpeed) - 0.5) * 4.0);
  phaseA = phaseA + dt * 0.82 * localMult;
  phaseB = phaseB + dt * 0.82 * 1.41421356 * localMult;
  teasePhase = teasePhase + dt * 0.64 * localMult;
  if (phaseA >= 10000.0) phaseA = phaseA - 10000.0;
  if (phaseB >= 10000.0) phaseB = phaseB - 10000.0;
  if (teasePhase >= 10000.0) teasePhase = teasePhase - 10000.0;
}
export function render3D(index, x, y, z) {
  var depth = clamp01(weaveDepth);
  var focus = 2.0 + (1.0 - clamp01(strandWidth)) * 13.0;
  var warpA = (wave(z * 2.7 + phaseB * 0.31) - 0.5) * depth * 0.42;
  var warpB = (wave(y * 3.1 - phaseA * 0.29) - 0.5) * depth * 0.42;
  var strandA = pow(wave(x * 7.0 + y * 4.0 + warpA - phaseA), focus);
  var strandB = pow(wave(x * 6.0 - z * 5.0 + warpB + phaseB), focus + 0.6);
  var knots = pow(strandA * strandB, 0.50);
  var pulse = pow(wave((x + y + z) * 9.0 - phaseA * 1.7320508), 12.0);
  var field = max(max(strandA, strandB * 0.96), max(knots, pulse * 0.55));
  var familyBlue = index % 2;
  var dominance = 0.64 + 0.36 * wave(teasePhase + familyBlue * 0.5);
  var shade = clamp01(0.12 + field * 0.88);
  var bri = clamp01((0.12 + field * 0.94) * clamp01(level) * dominance);
  if (familyBlue) rgbwau((0.010 + shade * 0.025) * bri, (0.16 + shade * 0.30) * bri, (0.64 + shade * 0.36) * bri, 0.0, 0.0, 0.0);
  else rgbwau((0.64 + shade * 0.36) * bri, (0.010 + shade * 0.025) * bri, (0.18 + shade * 0.18) * bri, 0.0, 0.0, 0.0);
}
