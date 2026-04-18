/*
  18_deep_space_lattice.js
  RGB-only drifting lattice waves with smooth color depth and no hard flashes.
*/

export var speed = 0.028;
export var latticeScale = 6.0;
export var lineSoftness = 2.0;
export var baseHue = 0.68;
export var accentHue = 0.92;

export function sliderSpeed(v) { speed = 0.006 + v * 0.08; }
export function sliderLatticeScale(v) { latticeScale = 2.0 + v * 12.0; }
export function sliderLineSoftness(v) { lineSoftness = 1.0 + v * 5.0; }
export function hsvPickerBaseColor(h, s, v) { baseHue = h; }
export function hsvPickerAccentColor(h, s, v) { accentHue = h; }

var phaseA = 0.0;
var phaseB = 0.0;

export function beforeRender(delta) {
  phaseA = time(speed);
  phaseB = time(speed * 0.41);
}

export function render3D(index, x, y, z) {
  var nx = (x + 1.264) / 3.125;
  var ny = y / 6.5;
  nx = max(0.0, min(1.0, nx));
  ny = max(0.0, min(1.0, ny));

  var gridX = wave(nx * latticeScale + phaseA);
  var gridY = wave(ny * latticeScale * 0.72 - phaseB);
  var diagonal = wave((nx - ny) * latticeScale * 0.38 + phaseA * 0.7);

  var lattice = max(gridX * gridY, diagonal * 0.65);
  lattice = pow(lattice, lineSoftness);

  var depth = wave(nx * 0.6 + ny * 0.9 + phaseB);
  var dh = accentHue - baseHue;
  if (dh > 0.5) dh -= 1.0;
  else if (dh < -0.5) dh += 1.0;

  var h = baseHue + dh * depth;
  var v = 0.04 + lattice * 0.9;

  hsv(h - floor(h), 0.95, min(1.0, v));
}
