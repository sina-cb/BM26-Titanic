// DRAFT - pending operator review
/*
  Parallax Ribbons: three translucent-looking ribbon fields drift at different
  depths across the whole ship, keeping Baby-pink and Baby-blue side by side.
  Autonomous palette-independent RGB only; both families persist in every
  frame and smoothly exchange emphasis without selecting an outcome.
  W=A=U=0. Handles: speed, level, ribbon width, and parallax depth.
*/

var COLOR_PINK_R_DARK = 0.640;
var COLOR_PINK_G_DARK = 0.010;
var COLOR_PINK_B_DARK = 0.180;
var COLOR_PINK_R_LIGHT = 1.000;
var COLOR_PINK_G_LIGHT = 0.035;
var COLOR_PINK_B_LIGHT = 0.360;
var COLOR_BLUE_R_DARK = 0.010;
var COLOR_BLUE_G_DARK = 0.160;
var COLOR_BLUE_B_DARK = 0.640;
var COLOR_BLUE_R_LIGHT = 0.035;
var COLOR_BLUE_G_LIGHT = 0.460;
var COLOR_BLUE_B_LIGHT = 1.000;

export var localSpeed = 0.38;
export var level = 0.86;
export var ribbonWidth = 0.58;
export var parallaxDepth = 0.66;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderLevel(v) { level = v; }
export function sliderRibbonWidth(v) { ribbonWidth = v; }
export function sliderParallaxDepth(v) { parallaxDepth = v; }

var PHASE_WRAP = 10000.0;
var nearPhase = 0.0;
var middlePhase = 0.0;
var farPhase = 0.0;
var exchangePhase = 0.0;
var liveLevel = 0.86;
var liveWidth = 0.58;
var liveDepth = 0.66;

function clamp01(v) {
  if (v < 0.0) return 0.0;
  if (v > 1.0) return 1.0;
  return v;
}

function emitPink(shade, bri) {
  var sv = clamp01(shade);
  var outR = COLOR_PINK_R_DARK + (COLOR_PINK_R_LIGHT - COLOR_PINK_R_DARK) * sv;
  var outG = COLOR_PINK_G_DARK + (COLOR_PINK_G_LIGHT - COLOR_PINK_G_DARK) * sv;
  var outB = COLOR_PINK_B_DARK + (COLOR_PINK_B_LIGHT - COLOR_PINK_B_DARK) * sv;
  rgbwau(outR * bri, outG * bri, outB * bri, 0.0, 0.0, 0.0);
}

function emitBlue(shade, bri) {
  var sv = clamp01(shade);
  var outR = COLOR_BLUE_R_DARK + (COLOR_BLUE_R_LIGHT - COLOR_BLUE_R_DARK) * sv;
  var outG = COLOR_BLUE_G_DARK + (COLOR_BLUE_G_LIGHT - COLOR_BLUE_G_DARK) * sv;
  var outB = COLOR_BLUE_B_DARK + (COLOR_BLUE_B_LIGHT - COLOR_BLUE_B_DARK) * sv;
  rgbwau(outR * bri, outG * bri, outB * bri, 0.0, 0.0, 0.0);
}

export function beforeRender(delta) {
  var dt = min(0.1, max(0.0, delta / 1000.0));
  var localMult = pow(2.0, (clamp01(localSpeed) - 0.5) * 4.0);
  nearPhase = nearPhase + dt * 0.170 * localMult;
  middlePhase = middlePhase + dt * 0.1202081528 * localMult;
  farPhase = farPhase + dt * 0.2078460969 * localMult;
  exchangePhase = exchangePhase + dt * 0.082 * localMult;
  if (nearPhase >= PHASE_WRAP) nearPhase = nearPhase - PHASE_WRAP;
  if (middlePhase >= PHASE_WRAP) middlePhase = middlePhase - PHASE_WRAP;
  if (farPhase >= PHASE_WRAP) farPhase = farPhase - PHASE_WRAP;
  if (exchangePhase >= PHASE_WRAP) exchangePhase = exchangePhase - PHASE_WRAP;
  liveLevel = clamp01(level);
  liveWidth = clamp01(ribbonWidth);
  liveDepth = clamp01(parallaxDepth);
}

export function render3D(index, x, y, z) {
  var nearWarp = (wave(y * 1.73205080757 + z * 0.73
                       - middlePhase * 0.37) - 0.5) * liveDepth * 0.54;
  var middleWarp = (wave(z * 1.41421356237 - x * 0.61
                         + farPhase * 0.43) - 0.5) * liveDepth * 0.42;
  var farWarp = (wave(x * 1.61803398875 + y * 0.47
                      - nearPhase * 0.29) - 0.5) * liveDepth * 0.32;
  var focus = 2.0 + (1.0 - liveWidth) * 10.0;
  var nearRibbon = pow(wave(x * 3.0 + y * 0.82 + z * 0.31
                            + nearWarp - nearPhase), focus);
  var middleRibbon = pow(wave(y * 2.0 - z * 1.13 + x * 0.67
                              + middleWarp + middlePhase), focus + 0.8);
  var farRibbon = pow(wave(z * 2.7 + x * 0.53 - y * 0.71
                           + farWarp - farPhase), focus + 1.6);
  var crossings = sqrt(max(0.0, nearRibbon * middleRibbon));
  var field = clamp01(nearRibbon * 0.58 + middleRibbon * 0.47
                      + farRibbon * 0.38 + crossings * liveDepth * 0.42);
  var glint = pow(wave(x * 5.0 - y * 7.0 + z * 11.0
                       + nearPhase * 1.41421356237
                       - farPhase * 0.57735026919), 12.0);
  var familyBlue = index % 2;
  var dominance = 0.74 + 0.26 * wave(exchangePhase + familyBlue * 0.5);
  var shade = clamp01(0.18 + field * 0.72 + glint * 0.12);
  var bri = clamp01((0.18 + field * 0.74 + glint * 0.10)
                    * liveLevel * dominance);
  if (familyBlue) emitBlue(shade, bri);
  else emitPink(shade, bri);
}
