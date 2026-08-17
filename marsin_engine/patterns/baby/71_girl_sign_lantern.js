// DRAFT - pending operator review
/* Baby-pink sign lanterns breathe as coherent glyphs over a steady photo wash. */

var COLOR_R_DARK = 0.620;
var COLOR_G_DARK = 0.008;
var COLOR_B_DARK = 0.170;
var COLOR_R_LIGHT = 1.000;
var COLOR_G_LIGHT = 0.035;
var COLOR_B_LIGHT = 0.360;

export var localSpeed = 0.28;
export var level = 0.94;
export var lanternDepth = 0.52;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderLevel(v) { level = v; }
export function sliderLanternDepth(v) { lanternDepth = v; }

var phaseA = 0.0;
var phaseB = 0.0;
var liveLevel = 0.94;
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
  phaseA = phaseA + dt * 0.105 * speedMultiplier;
  phaseB = phaseB + dt * 0.105 * 1.41421356 * speedMultiplier;
  if (phaseA >= 10000.0) phaseA = phaseA - 10000.0;
  if (phaseB >= 10000.0) phaseB = phaseB - 10000.0;
  liveLevel = clamp01(level);
  liveDepth = clamp01(lanternDepth);
}

export function render3D(index, x, y, z) {
  var slot = floor(x * 3.0);
  if (slot > 2.0) slot = 2.0;
  var centerX = 0.1666667 + slot * 0.3333333;
  var centerY = 0.35 + (slot % 2.0) * 0.30;
  var centerZ = 0.58 + slot * 0.075;
  var dx = x - centerX;
  var dy = y - centerY;
  var dz = z - centerZ;
  var size = 0.180;
  var xGate = clamp01(1.0 - abs(dx) / (size * 1.75));
  var horizontal = clamp01(1.0 - abs(dz) / (size * 0.28)) *
                   clamp01(1.0 - abs(dy) / (size * 1.35));
  var vertical = clamp01(1.0 - abs(dy) / (size * 0.28)) *
                 clamp01(1.0 - abs(dz) / (size * 1.35));
  var corner = clamp01(1.0 - sqrt(dy * dy + dz * dz) / (size * 1.18));
  var glyph = clamp01(max(horizontal, vertical) * xGate + corner * xGate * 0.34);
  var pulseA = wave(phaseA + slot * 0.27182818);
  var pulseB = wave(phaseB - slot * 0.16180340);
  var lanternPulse = 0.62 + pulseA * 0.22 + pulseB * 0.16;
  var lantern = glyph * lanternPulse;
  var washFlow = wave(phaseA * 0.91 + x * 0.31 + y * 0.17 + z * 0.23);
  var shade = clamp01(0.13 + washFlow * 0.22 +
                      lantern * (0.56 + liveDepth * 0.34));
  var bri = clamp01((0.45 + washFlow * 0.28 +
                     lantern * (0.40 + liveDepth * 0.46)) * liveLevel);
  emitColor(shade, bri);
}
