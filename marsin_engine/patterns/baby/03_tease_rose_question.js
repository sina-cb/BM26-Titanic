// DRAFT - pending operator review
/* Rose Question: counter-wound petals and spherical shells bloom in 3D. */

var BABY_BLUE_R = 0.033;
var BABY_BLUE_G = 0.450;
var BABY_BLUE_B = 1.000;
var BABY_PINK_R = 1.000;
var BABY_PINK_G = 0.035;
var BABY_PINK_B = 0.360;
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
  var geometry = clamp01(shade);
  var energy = clamp01(bri);
  if (fixtureType == FIX_TE_SIGN) {
    var signAddress = index % 74.0;
    if (signAddress % 9.0 < 1.0) {
      rgbwau(0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
      return;
    }
    var signIntensity = clamp01(0.68 + energy * 0.28
                                + wave(signAddress * 0.37) * 0.04);
    familyBlue = signAddress % 2.0;
    if (familyBlue) {
      rgbwau(BABY_BLUE_R * signIntensity, BABY_BLUE_G * signIntensity,
             BABY_BLUE_B * signIntensity, 0.0, 0.0, 0.0);
    } else {
      rgbwau(BABY_PINK_R * signIntensity, BABY_PINK_G * signIntensity,
             BABY_PINK_B * signIntensity, 0.0, 0.0, 0.0);
    }
    return;
  }
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
