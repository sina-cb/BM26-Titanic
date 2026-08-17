// DRAFT - pending operator review
/* Constellation Duet: pink and blue star paths orbit together without resolving. */

var BABY_BLUE_R = 0.033;
var BABY_BLUE_G = 0.450;
var BABY_BLUE_B = 1.000;
var BABY_PINK_R = 1.000;
var BABY_PINK_G = 0.035;
var BABY_PINK_B = 0.360;
export var localSpeed = 0.52;
export var level = 0.90;
export var starFocus = 0.58;
export var duetDepth = 0.60;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderLevel(v) { level = v; }
export function sliderStarFocus(v) { starFocus = v; }
export function sliderDuetDepth(v) { duetDepth = v; }

var phase = 0.0;
var liveLevel = 0.90;
var liveFocus = 0.58;
var liveDepth = 0.60;

function clamp01(v) {
  if (v < 0.0) return 0.0;
  if (v > 1.0) return 1.0;
  return v;
}

export function beforeRender(delta) {
  var speedMultiplier = pow(2.0, (clamp01(localSpeed) - 0.5) * 4.0);
  phase = phase + clamp01(delta / 100.0) * 0.027 * speedMultiplier;
  if (phase >= 10000.0) phase = phase - 10000.0;
  liveLevel = clamp01(level);
  liveFocus = clamp01(starFocus);
  liveDepth = clamp01(duetDepth);
}

export function render3D(index, x, y, z) {
  var familyBlue = index % 2;
  var familyOffset = familyBlue * 0.5;
  var orbitX = 0.5 + sin((phase + familyOffset) * PI2) * (0.18 + liveDepth * 0.18);
  var orbitY = 0.5 + cos((phase * 0.73 + familyOffset) * PI2) * (0.14 + liveDepth * 0.16);
  var orbitZ = 0.5 + sin((phase * 0.51 + familyOffset + 0.25) * PI2) * (0.16 + liveDepth * 0.20);
  var dx = x - orbitX;
  var dy = y - orbitY;
  var dz = z - orbitZ;
  var distance = sqrt(dx * dx + dy * dy + dz * dz);
  var halo = clamp01(1.0 - distance / (0.24 + liveDepth * 0.30));
  var lattice = wave(x * 7.0 + y * 5.0 + z * 9.0 - phase * 1.7 + familyOffset);
  var focus = 1.5 + liveFocus * 7.0;
  var stars = pow(lattice, focus);
  var connector = pow(wave((x - y + z) * 2.4 + phase * 0.38), 2.0 + liveFocus * 4.0);
  var field = clamp01(halo * 0.56 + stars * 0.52 + connector * 0.22);
  var dominance = 0.78 + wave(phase * 0.68 + familyOffset) * 0.22;
  var bri = clamp01((0.22 + field * 0.74) * liveLevel * dominance);
  var shade = clamp01(0.16 + halo * 0.50 + stars * 0.42);

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
