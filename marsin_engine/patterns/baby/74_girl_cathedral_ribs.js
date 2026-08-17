// DRAFT - pending operator review
/* Baby-pink cathedral ribs glide through repeating arches over a steady photo wash. */

var COLOR_R_DARK = 0.620;
var COLOR_G_DARK = 0.008;
var COLOR_B_DARK = 0.170;
var COLOR_R_LIGHT = 1.000;
var COLOR_G_LIGHT = 0.035;
var COLOR_B_LIGHT = 0.360;

export var localSpeed = 0.30;
export var level = 0.96;
export var ribWidth = 0.54;
export var archHeight = 0.58;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderLevel(v) { level = v; }
export function sliderRibWidth(v) { ribWidth = v; }
export function sliderArchHeight(v) { archHeight = v; }

var travelPhase = 0.0;
var breathPhase = 0.0;
var liveLevel = 0.96;
var liveWidth = 0.54;
var liveHeight = 0.58;

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
  travelPhase = travelPhase + dt * 0.115 * speedMultiplier;
  breathPhase = breathPhase + dt * 0.0813172798 * speedMultiplier;
  if (travelPhase >= 10000.0) travelPhase = travelPhase - 10000.0;
  if (breathPhase >= 10000.0) breathPhase = breathPhase - 10000.0;
  liveLevel = clamp01(level);
  liveWidth = clamp01(ribWidth);
  liveHeight = clamp01(archHeight);
}

export function render3D(index, x, y, z) {
  var bayPosition = x * 5.0;
  var bayNumber = floor(bayPosition);
  var bayLocal = bayPosition - bayNumber - 0.5;
  var lateral = abs(y - 0.5);
  var halfSpan = 0.29 + liveHeight * 0.17;
  var archSide = lateral / halfSpan;
  var archInside = clamp01(1.0 - archSide);
  var breathingLift = (wave(breathPhase + bayNumber * 0.1618033989) - 0.5) * 0.035;
  var archRise = 0.18 + liveHeight * 0.25;
  var archTarget = 0.29 + breathingLift + archRise * sqrt(archInside);
  var echoTarget = 0.27 + breathingLift * 0.72
                   + archRise * 0.76 * pow(archInside, 0.68);
  var thickness = 0.025 + liveWidth * 0.085;
  var sideGate = clamp01(1.0 - max(0.0, archSide - 0.86) * 7.2);
  var outerArch = pow(clamp01(1.0 - abs(z - archTarget) / thickness), 1.45)
                  * sideGate;
  var innerArch = pow(clamp01(1.0 - abs(z - echoTarget) /
                              (thickness * 0.78)), 1.65) * sideGate;
  var vaultGlow = pow(clamp01(1.0 - abs(z - archTarget) /
                              (0.19 + liveWidth * 0.20)), 1.35) * sideGate;
  var bayReach = 0.16 + liveWidth * 0.24;
  var bayGate = pow(clamp01(1.0 - abs(bayLocal) / bayReach), 1.35);
  var pillar = pow(clamp01(1.0 - abs(lateral - halfSpan) /
                           (thickness * 1.25)), 1.50)
               * clamp01(1.0 - max(0.0, z - 0.46) * 5.0);
  var travelingLight = 0.24 + 0.76 * wave(travelPhase
                                          + bayNumber * 0.2360679775);
  var crossRib = pow(wave(x * 5.0 - travelPhase * 0.43
                          + z * 0.37 - y * 0.29),
                     2.0 + (1.0 - liveWidth) * 10.0);
  var ribs = max(max(outerArch, innerArch * 0.72), pillar * 0.82) * bayGate;
  var field = clamp01(max(ribs * travelingLight,
                          vaultGlow * (0.45 + travelingLight * 0.43)
                          * (0.62 + bayGate * 0.38))
                      + crossRib * (0.07 + vaultGlow * 0.14));
  var materialSheen = 0.58 + 0.42 * wave(breathPhase * 0.91
                                         + x * 0.23 - y * 0.17 + z * 0.31);
  var shade = clamp01(0.58 + field * 0.42);
  var bri = clamp01((0.86 + field * 0.14) * liveLevel * materialSheen);
  emitColor(shade, bri);
}
