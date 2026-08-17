// DRAFT - pending operator review
/* Baby-pink stack halos crown four soft columns over a persistent photo wash. */

var COLOR_R_DARK = 0.620;
var COLOR_G_DARK = 0.008;
var COLOR_B_DARK = 0.170;
var COLOR_R_LIGHT = 1.000;
var COLOR_G_LIGHT = 0.035;
var COLOR_B_LIGHT = 0.360;

export var localSpeed = 0.30;
export var level = 0.92;
export var haloWidth = 0.56;
export var haloDepth = 0.52;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderLevel(v) { level = v; }
export function sliderHaloWidth(v) { haloWidth = v; }
export function sliderHaloDepth(v) { haloDepth = v; }

var haloPhase = 0.0;
var driftPhase = 0.0;
var liveLevel = 0.92;
var liveWidth = 0.56;
var liveDepth = 0.52;

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
  haloPhase = haloPhase + dt * 0.150 * speedMultiplier;
  driftPhase = driftPhase + dt * 0.1060660172 * speedMultiplier;
  if (haloPhase >= 10000.0) haloPhase = haloPhase - 10000.0;
  if (driftPhase >= 10000.0) driftPhase = driftPhase - 10000.0;
  liveLevel = clamp01(level);
  liveWidth = clamp01(haloWidth);
  liveDepth = clamp01(haloDepth);
}

export function render3D(index, x, y, z) {
  var stackPosition = x * 4.0;
  var stackNumber = floor(stackPosition);
  var stackLocal = stackPosition - stackNumber - 0.5;
  var stagger = stackNumber * 0.1732050808;
  var sway = (wave(driftPhase + stagger) - 0.5) * (0.025 + liveDepth * 0.045);
  var centerY = 0.5 + sway;
  var centerZ = 0.67 + (wave(haloPhase * 0.61 + stagger) - 0.5) * 0.055;
  var lateral = y - centerY;
  var vertical = z - centerZ;
  var radial = sqrt(lateral * lateral * 1.45 + vertical * vertical * 0.92);
  var haloRadius = 0.105 + liveWidth * 0.105
                   + (wave(haloPhase + stagger) - 0.5) * 0.025;
  var softness = 0.045 + liveWidth * 0.095;
  var halo = pow(clamp01(1.0 - abs(radial - haloRadius) / softness), 1.45);
  var xReach = 0.13 + liveWidth * 0.19;
  var columnGate = pow(clamp01(1.0 - abs(stackLocal) / xReach), 1.35);
  var columnCore = pow(clamp01(1.0 - abs(lateral) /
                               (0.075 + liveWidth * 0.105)), 1.7);
  var columnLift = clamp01((centerZ + haloRadius - z) /
                           (0.38 + liveWidth * 0.18));
  var column = columnGate * columnCore * columnLift;
  var echo = pow(wave(x * 4.0 - haloPhase * 0.42
                      + y * 0.37 - z * 0.29), 3.2);
  var materialSheen = 0.90 + 0.10 * wave(driftPhase * 0.73
                                         + x * 0.31 - y * 0.19 + z * 0.23);
  var field = clamp01(max(halo * columnGate,
                          column * (0.36 + liveDepth * 0.48))
                      + echo * (0.08 + liveDepth * 0.18));
  var shade = clamp01(0.18 + field * 0.78);
  var bri = clamp01((0.34 + field * (0.57 + liveDepth * 0.18))
                    * liveLevel * materialSheen);
  emitColor(shade, bri);
}
