/*
  18_deep_space_lattice.js
  RGB-only drifting lattice waves with smooth color depth and no hard flashes.
*/

export var localSpeed = 0.5;
export var latticeScale = 6.0;
export var lineSoftness = 2.0;

export var cp1H = 0.68, cp1S = 0.95, cp1V = 1.0; // Base Color (Purple/Blue default)
export var cp2H = 0.92, cp2S = 0.95, cp2V = 1.0; // Accent Color (Pink default)
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderLatticeScale(v) { latticeScale = 2.0 + v * 12.0; }
export function sliderLineSoftness(v) { lineSoftness = 1.0 + v * 5.0; }

var phaseA = 0.0;
var phaseB = 0.0;
var phaseAd = 0.0;

export function beforeRender(delta) {
  var localMultiplier = pow(2.0, (localSpeed - 0.5) * 4.0);
  phaseA = time(0.028 / localMultiplier);
  phaseB = time(0.011 / localMultiplier);
  // Continuity: the diagonal wave uses phaseA * 0.7 — multiplying a wrapping
  // time() by a non-integer makes the wave argument jump by 0.7 mod 1 every
  // period. Drive the 0.7× phase from its own time() base instead (smaller
  // scale = faster, so 0.028/0.7 matches the original visual rate cleanly).
  phaseAd = time(0.028 / 0.7 / localMultiplier);
}

export function render3D(index, x, y, z) {
  var nx = (x + 1.264) / 3.125;
  var ny = y / 6.5;
  nx = max(0.0, min(1.0, nx));
  ny = max(0.0, min(1.0, ny));

  var gridX = wave(nx * latticeScale + phaseA);
  var gridY = wave(ny * latticeScale * 0.72 - phaseB);
  var diagonal = wave((nx - ny) * latticeScale * 0.38 + phaseAd);

  var lattice = max(gridX * gridY, diagonal * 0.65);
  lattice = pow(lattice, lineSoftness);

  var depth = wave(nx * 0.6 + ny * 0.9 + phaseB);
  var dh = cp2H - cp1H;
  if (dh > 0.5) dh -= 1.0;
  else if (dh < -0.5) dh += 1.0;

  var h = cp1H + dh * depth;
  var s = cp1S + (cp2S - cp1S) * depth;
  var maxVal = cp1V + (cp2V - cp1V) * depth;
  var v = 0.04 + lattice * 0.9;

  hsv(h - floor(h), s, min(1.0, v * maxVal));
}
