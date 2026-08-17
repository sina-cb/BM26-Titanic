// DRAFT - pending operator review
/* Tidal Ribbons: slow opposing water ribbons braid along the ship. */

var BABY_BLUE_R = 0.033;
var BABY_BLUE_G = 0.450;
var BABY_BLUE_B = 1.000;
var BABY_PINK_R = 1.000;
var BABY_PINK_G = 0.035;
var BABY_PINK_B = 0.360;
export var localSpeed = 0.42;
export var level = 0.84;
export var ribbonWidth = 0.56;
export var turbulence = 0.48;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderLevel(v) { level = v; }
export function sliderRibbonWidth(v) { ribbonWidth = v; }
export function sliderTurbulence(v) { turbulence = v; }

var travel = 0.0;
var teasePhase = 0.0;
function clamp01(v) { return min(1.0, max(0.0, v)); }

export function beforeRender(delta) {
  var dt = min(0.1, max(0.0, delta / 1000.0));
  var localMult = pow(2.0, (clamp01(localSpeed) - 0.5) * 4.0);
  travel = travel + dt * 0.21 * localMult;
  teasePhase = teasePhase + dt * 0.16 * localMult;
  if (travel >= 10000.0) travel = travel - 10000.0;
  if (teasePhase >= 10000.0) teasePhase = teasePhase - 10000.0;
}

export function render3D(index, x, y, z) {
  var turb = clamp01(turbulence);
  var warp = (wave(y * 1.73 + z * 1.11 + travel * 0.37) - 0.5) * turb * 0.34;
  var ribbonA = pow(wave(x * 2.3 + y * 0.61 + warp - travel), 2.0 + (1.0 - clamp01(ribbonWidth)) * 8.0);
  var ribbonB = pow(wave((1.0 - x) * 1.9 + z * 0.83 - warp + travel * 1.41421356), 2.4 + (1.0 - clamp01(ribbonWidth)) * 7.0);
  var foam = pow(wave(x * 7.0 - y * 5.0 + z * 3.0 + travel * 1.7320508), 10.0);
  var field = max(ribbonA, ribbonB * 0.94);
  var familyBlue = index % 2;
  var dominance = 0.78 + 0.22 * wave(teasePhase + familyBlue * 0.5);
  var shade = clamp01(0.18 + field * 0.70 + foam * 0.16);
  var bri = clamp01((0.18 + field * 0.72 + foam * 0.12) * clamp01(level) * dominance);
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
