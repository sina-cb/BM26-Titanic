// DRAFT - pending operator review
/* Baby-pink diagonal beacons cross in XYZ over a persistent full-ship wash. */

var COLOR_R_DARK = 0.620;
var COLOR_G_DARK = 0.008;
var COLOR_B_DARK = 0.170;
var COLOR_R_LIGHT = 1.000;
var COLOR_G_LIGHT = 0.035;
var COLOR_B_LIGHT = 0.360;

export var localSpeed = 0.36;
export var level = 0.90;
export var beaconWidth = 0.58;
export var crossingDepth = 0.54;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderLevel(v) { level = v; }
export function sliderBeaconWidth(v) { beaconWidth = v; }
export function sliderCrossingDepth(v) { crossingDepth = v; }

var phaseA = 0.0;
var phaseB = 0.0;
var phaseC = 0.0;
var liveLevel = 0.90;
var liveWidth = 0.58;
var liveDepth = 0.54;

function clamp01(v) {
  if (v < 0.0) return 0.0;
  if (v > 1.0) return 1.0;
  return v;
}

function emitColor(shade, bri) {
  var s = clamp01(shade);
  rgbwau((COLOR_R_DARK + (COLOR_R_LIGHT - COLOR_R_DARK) * s) * bri,
         (COLOR_G_DARK + (COLOR_G_LIGHT - COLOR_G_DARK) * s) * bri,
         (COLOR_B_DARK + (COLOR_B_LIGHT - COLOR_B_DARK) * s) * bri,
         0.0, 0.0, 0.0);
}

export function beforeRender(delta) {
  var dt = min(0.1, max(0.0, delta / 1000.0));
  var speedMultiplier = pow(2.0, (clamp01(localSpeed) - 0.5) * 4.0);
  phaseA = phaseA + dt * 0.145 * speedMultiplier;
  phaseB = phaseB + dt * 0.145 * 1.41421356 * speedMultiplier;
  phaseC = phaseC + dt * 0.145 * 1.73205081 * speedMultiplier;
  if (phaseA >= 10000.0) phaseA = phaseA - 10000.0;
  if (phaseB >= 10000.0) phaseB = phaseB - 10000.0;
  if (phaseC >= 10000.0) phaseC = phaseC - 10000.0;
  liveLevel = clamp01(level);
  liveWidth = clamp01(beaconWidth);
  liveDepth = clamp01(crossingDepth);
}

export function render3D(index, x, y, z) {
  var focus = 1.8 + (1.0 - liveWidth) * 7.6;
  var ribbonA = pow(wave(x * 1.31 + y * 0.73 - z * 0.47 - phaseA), focus);
  var ribbonB = pow(wave(-x * 0.89 + y * 1.17 + z * 0.61 + phaseB), focus + 0.35);
  var ribbonC = pow(wave(x * 0.53 - y * 0.79 + z * 1.43 - phaseC), focus + 0.70);
  var crossAB = sqrt(ribbonA * ribbonB);
  var crossBC = sqrt(ribbonB * ribbonC);
  var crossCA = sqrt(ribbonC * ribbonA);
  var crossing = max(crossAB, max(crossBC, crossCA));
  var beacon = max(ribbonA, max(ribbonB * 0.94, ribbonC * 0.90));
  var field = clamp01(beacon * (0.68 + liveDepth * 0.16) +
                      crossing * (0.16 + liveDepth * 0.42));
  var shade = clamp01(0.18 + beacon * 0.56 + crossing * (0.18 + liveDepth * 0.18));
  var bri = clamp01((0.28 + field * 0.70) * liveLevel);
  emitColor(shade, bri);
}
