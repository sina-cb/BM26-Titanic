// DRAFT - pending operator review
/*
  Twin Lantern Tides: mirrored pink and blue lantern fields drift through
  layered XYZ tides while the two families trade gentle emphasis forever.
  Whole-ship, photo-safe tease bed; parity keeps both families simultaneous.
  Palette-independent operator exception. RGB only; W=A=U=0.
  Handles: local speed, overall level, lantern focus, and tidal depth.
*/

export var localSpeed = 0.43;
export var level = 0.96;
export var lanternFocus = 0.58;
export var tideDepth = 0.52;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderLevel(v) { level = v; }
export function sliderLanternFocus(v) { lanternFocus = v; }
export function sliderTideDepth(v) { tideDepth = v; }

var lanternPhase = 0.0;
var exchangePhase = 0.0;

function clamp01(v) { return min(1.0, max(0.0, v)); }

export function beforeRender(delta) {
  var dt = min(0.1, max(0.0, delta / 1000.0));
  var localMult = pow(2.0, (clamp01(localSpeed) - 0.5) * 4.0);
  lanternPhase = lanternPhase + dt * 0.17 * localMult;
  exchangePhase = exchangePhase + dt * 0.071 * localMult;
  if (lanternPhase >= 10000.0) lanternPhase = lanternPhase - 10000.0;
  if (exchangePhase >= 10000.0) exchangePhase = exchangePhase - 10000.0;
}

export function render3D(index, x, y, z) {
  var familyBlue = index % 2;
  var familyOffset = familyBlue * 0.5;
  var side = familyBlue * 2.0 - 1.0;
  var depth = clamp01(tideDepth);
  var focus = 2.2 + clamp01(lanternFocus) * 7.8;

  var centerX = 0.5 + side * (0.19 + 0.07 * wave(lanternPhase * 0.73));
  var centerY = 0.5 + side * 0.15 * (wave(lanternPhase * 1.41421356) - 0.5);
  var centerZ = 0.5 - side * 0.22 * (wave(lanternPhase * 1.7320508) - 0.5);
  var dx = x - centerX;
  var dy = y - centerY;
  var dz = z - centerZ;
  var radius = sqrt(dx * dx * 1.35 + dy * dy * 0.90 + dz * dz * 1.15);
  var lantern = pow(clamp01(1.0 - radius * (1.45 + focus * 0.16)), 0.72);
  var halo = pow(wave(radius * (2.8 + focus * 0.34) - lanternPhase * 0.37), focus);

  var tideX = wave(x * 1.7 + z * 0.8 - lanternPhase + familyOffset);
  var tideY = wave(y * 2.3 - x * 0.6 + lanternPhase * 1.41421356 + familyOffset);
  var tideZ = wave(z * 1.9 + y * 0.7 - lanternPhase * 1.7320508 + familyOffset);
  var tide = (tideX + tideY + tideZ) / 3.0;
  var field = clamp01(lantern * (0.64 + depth * 0.28) + halo * 0.26 + tide * depth * 0.34);

  var dominance = 0.78 + 0.22 * wave(exchangePhase + familyOffset);
  var shade = clamp01(0.16 + field * 0.84);
  var bri = clamp01((0.28 + field * 0.72) * clamp01(level) * dominance);

  if (familyBlue) {
    rgbwau((0.008 + shade * 0.025) * bri,
           (0.13 + shade * 0.32) * bri,
           (0.62 + shade * 0.38) * bri,
           0.0, 0.0, 0.0);
  } else {
    rgbwau((0.62 + shade * 0.38) * bri,
           (0.008 + shade * 0.027) * bri,
           (0.17 + shade * 0.19) * bri,
           0.0, 0.0, 0.0);
  }
}
