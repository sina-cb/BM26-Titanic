// DRAFT - pending operator review
/* Rose Question: counter-wound petals and spherical shells bloom in 3D. */

export var localSpeed = 0.40;
export var level = 0.86;
export var petalWidth = 0.52;
export var spatialDepth = 0.70;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderLevel(v) { level = v; }
export function sliderPetalWidth(v) { petalWidth = v; }
export function sliderSpatialDepth(v) { spatialDepth = v; }

var rosePhase = 0.0;
var questionPhase = 0.0;
function clamp01(v) { return min(1.0, max(0.0, v)); }

export function beforeRender(delta) {
  var dt = min(0.1, max(0.0, delta / 1000.0));
  var localMult = pow(2.0, (clamp01(localSpeed) - 0.5) * 4.0);
  rosePhase = rosePhase + dt * 0.17 * localMult;
  questionPhase = questionPhase + dt * 0.14 * localMult;
  if (rosePhase >= 10000.0) rosePhase = rosePhase - 10000.0;
  if (questionPhase >= 10000.0) questionPhase = questionPhase - 10000.0;
}

export function render3D(index, x, y, z) {
  var cx = x - 0.5;
  var cy = y - 0.5;
  var cz = z - 0.5;
  var radial = sqrt(cx * cx + cz * cz);
  var volumeRadius = sqrt(cx * cx + cy * cy + cz * cz);
  var angle = atan2(cz, cx) / PI2;
  var depth = clamp01(spatialDepth);
  var focus = 2.0 + (1.0 - clamp01(petalWidth)) * 7.0;
  var petalsA = pow(wave(angle * 6.0 - radial * 2.7 - rosePhase), focus);
  var petalsB = pow(wave(angle * 5.0 + radial * 3.1 + rosePhase * 1.41421356), focus + 0.8);
  var shell = pow(wave(volumeRadius * (2.1 + depth * 1.7) - rosePhase * 0.73), 3.2 + depth * 3.0);
  var silkA = wave(x * 0.73 + y * 0.31 - z * 0.47 - rosePhase);
  var silkB = wave(-x * 0.41 + y * 0.67 + z * 0.37 + rosePhase * 1.61803399);
  var silk = pow(1.0 - abs(silkA - silkB), 2.6 + depth * 2.4);
  var field = max(max(petalsA, petalsB * 0.90), max(shell * 0.82, silk * 0.74));
  var familyBlue = index % 2;
  var dominance = 0.80 + 0.20 * wave(questionPhase + familyBlue * 0.5);
  var shade = clamp01(0.20 + field * 0.72 + silk * 0.12);
  var bri = clamp01((0.16 + field * (0.66 + depth * 0.22) + shell * 0.12) * clamp01(level) * dominance);
  if (familyBlue) {
    rgbwau((0.010 + shade * 0.025) * bri, (0.16 + shade * 0.30) * bri, (0.64 + shade * 0.36) * bri, 0.0, 0.0, 0.0);
  } else {
    rgbwau((0.64 + shade * 0.36) * bri, (0.010 + shade * 0.025) * bri, (0.18 + shade * 0.18) * bri, 0.0, 0.0, 0.0);
  }
}
