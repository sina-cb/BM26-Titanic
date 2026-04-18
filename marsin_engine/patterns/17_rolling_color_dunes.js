/*
  17_rolling_color_dunes.js
  RGB-only rolling dunes of color with broad, slow movement across X and height.
*/

export var speed = 0.035;
export var scale = 3.0;
export var contrast = 1.7;
export var hueLow = 0.08;
export var hueHigh = 0.47;

export function sliderSpeed(v) { speed = 0.008 + v * 0.09; }
export function sliderScale(v) { scale = 1.0 + v * 7.0; }
export function sliderContrast(v) { contrast = 0.8 + v * 3.5; }
export function hsvPickerLowColor(h, s, v) { hueLow = h; }
export function hsvPickerHighColor(h, s, v) { hueHigh = h; }

var roll = 0.0;
var drift = 0.0;

export function beforeRender(delta) {
  roll = time(speed);
  drift = time(speed * 0.29);
}

export function render3D(index, x, y, z) {
  var nx = (x + 1.264) / 3.125;
  var ny = y / 6.5;
  nx = max(0.0, min(1.0, nx));
  ny = max(0.0, min(1.0, ny));

  var duneA = wave(nx * scale - roll + ny * 0.9);
  var duneB = wave((nx + ny) * scale * 0.45 + drift);
  var dune = pow(duneA * 0.7 + duneB * 0.3, contrast);

  var blend = wave(ny * 0.8 + nx * 0.35 + drift);
  var dh = hueHigh - hueLow;
  if (dh > 0.5) dh -= 1.0;
  else if (dh < -0.5) dh += 1.0;

  var h = hueLow + dh * blend;
  var v = 0.08 + dune * 0.92;

  hsv(h - floor(h), 0.88, min(1.0, v));
}
