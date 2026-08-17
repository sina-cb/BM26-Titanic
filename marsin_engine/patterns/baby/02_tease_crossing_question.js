// DRAFT - pending operator review
/* Crossing Question: oblique pink/blue fans cross through the whole model. */

export var localSpeed = 0.38;
export var level = 0.84;
export var beamWidth = 0.46;
export var crossing = 0.50;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderLevel(v) { level = v; }
export function sliderBeamWidth(v) { beamWidth = v; }
export function sliderCrossing(v) { crossing = v; }

var travelPhase = 0.0;
var questionPhase = 0.0;
function clamp01(v) { return min(1.0, max(0.0, v)); }

export function beforeRender(delta) {
  var dt = min(0.1, max(0.0, delta / 1000.0));
  var localMult = pow(2.0, (clamp01(localSpeed) - 0.5) * 4.0);
  travelPhase = travelPhase + dt * 0.23 * localMult;
  questionPhase = questionPhase + dt * 0.13 * localMult;
  if (travelPhase >= 10000.0) travelPhase = travelPhase - 10000.0;
  if (questionPhase >= 10000.0) questionPhase = questionPhase - 10000.0;
}

export function render3D(index, x, y, z) {
  var pivot = 0.05 + clamp01(crossing) * 0.90;
  var diagonalA = x + (z - pivot) * (0.72 + y * 0.41);
  var diagonalB = (1.0 - x) + (z - pivot) * (0.72 + (1.0 - y) * 0.41);
  var exponent = 2.0 + (1.0 - clamp01(beamWidth)) * 8.0;
  var fanA = pow(wave(diagonalA * 1.73 - travelPhase), exponent);
  var fanB = pow(wave(diagonalB * 1.41 + travelPhase * 1.61803399), exponent);
  var crossingGlow = pow(1.0 - clamp01(abs(fanA - fanB)), 2.2);
  var horizon = pow(wave(z * 2.3 - travelPhase * 0.47), 5.0);
  var field = max(max(fanA, fanB), crossingGlow * 0.72);
  var familyBlue = index % 2;
  var dominance = 0.80 + 0.20 * wave(questionPhase + familyBlue * 0.5);
  var shade = clamp01(0.18 + field * 0.72 + crossingGlow * 0.15);
  var bri = clamp01((0.17 + field * 0.70 + horizon * 0.14) * clamp01(level) * dominance);
  if (familyBlue) {
    rgbwau((0.010 + shade * 0.025) * bri, (0.16 + shade * 0.30) * bri, (0.64 + shade * 0.36) * bri, 0.0, 0.0, 0.0);
  } else {
    rgbwau((0.64 + shade * 0.36) * bri, (0.010 + shade * 0.025) * bri, (0.18 + shade * 0.18) * bri, 0.0, 0.0, 0.0);
  }
}
