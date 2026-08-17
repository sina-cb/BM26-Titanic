// DRAFT - pending operator review
/*
  Orbit Question: interlocking 3D shells carry a persistent pink/blue question.
  Palette-independent RGB only; every frame contains both hard-coded families.
  W=A=U=0. Handles: speed, level, ring thickness, spatial depth.
*/

var BABY_BLUE_R = 0.033;
var BABY_BLUE_G = 0.450;
var BABY_BLUE_B = 1.000;
var BABY_PINK_R = 1.000;
var BABY_PINK_G = 0.035;
var BABY_PINK_B = 0.360;
export var localSpeed = 0.34;
export var level = 0.82;
export var ringWidth = 0.54;
export var spatialDepth = 0.68;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderLevel(v) { level = v; }
export function sliderRingWidth(v) { ringWidth = v; }
export function sliderSpatialDepth(v) { spatialDepth = v; }

var orbitPhase = 0.0;
var questionPhase = 0.0;

function clamp01(v) { return min(1.0, max(0.0, v)); }

export function beforeRender(delta) {
  var dt = min(0.1, max(0.0, delta / 1000.0));
  var localMult = pow(2.0, (clamp01(localSpeed) - 0.5) * 4.0);
  orbitPhase = orbitPhase + dt * 0.22 * localMult;
  questionPhase = questionPhase + dt * 0.13 * localMult;
  if (orbitPhase >= 10000.0) orbitPhase = orbitPhase - 10000.0;
  if (questionPhase >= 10000.0) questionPhase = questionPhase - 10000.0;
}

export function render3D(index, x, y, z) {
  var cx = x - 0.5;
  var cy = y - 0.5;
  var cz = z - 0.5;
  var depth = clamp01(spatialDepth);
  var warpX = cx + (wave(y * 0.73 + orbitPhase * 0.61) - 0.5) * depth * 0.24;
  var warpY = cy + (wave(z * 0.59 - orbitPhase * 0.47) - 0.5) * depth * 0.20;
  var warpZ = cz + (wave(x * 0.67 + orbitPhase * 0.79) - 0.5) * depth * 0.24;
  var radiusA = sqrt(warpX * warpX + warpY * warpY + warpZ * warpZ);
  var radiusB = sqrt((warpX * 0.63 + warpZ * 0.77) * (warpX * 0.63 + warpZ * 0.77) + warpY * warpY * 1.4161);
  var focus = 1.8 + (1.0 - clamp01(ringWidth)) * 5.2;
  var shellA = pow(wave(radiusA * 3.7 - orbitPhase), focus);
  var shellB = pow(wave(radiusB * 4.3 + orbitPhase * 1.41421356), focus + 0.4);
  var detail = pow(wave(x * 7.0 - y * 11.0 + z * 13.0 + orbitPhase * 1.7320508), 9.0);
  var field = max(shellA, shellB * 0.92);
  var familyBlue = index % 2;
  var dominance = 0.82 + 0.18 * wave(questionPhase + familyBlue * 0.5);
  var shade = clamp01(0.22 + field * 0.65 + detail * 0.18);
  var bri = clamp01((0.16 + field * (0.62 + depth * 0.24) + detail * 0.14) * clamp01(level) * dominance);
  var geometry = clamp01(shade);
  var energy = clamp01(bri);
  if (fixtureType == FIX_TE_SIGN) {
    var signAddress = index % 74.0;
    if (signAddress % 9.0 < 1.0) {
      rgbwau(0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
      return;
    }
    var signIntensity = clamp01(0.56 + energy * 0.38
                                + wave(signAddress * 0.37) * 0.06);
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
  var intensity = clamp01(0.55 + energy * 0.45);
  if (familyBlue) {
    rgbwau(BABY_BLUE_R * intensity, BABY_BLUE_G * intensity,
           BABY_BLUE_B * intensity, 0.0, 0.0, 0.0);
  } else {
    rgbwau(BABY_PINK_R * intensity, BABY_PINK_G * intensity,
           BABY_PINK_B * intensity, 0.0, 0.0, 0.0);
  }
}
