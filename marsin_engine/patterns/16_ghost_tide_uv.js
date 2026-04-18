/*
  16_ghost_tide_uv.js
  Slow white surf and UV undertow, built for smooth motion without flashes.
*/

export var speed = 0.025;
export var tideWidth = 0.38;
export var whiteLevel = 0.85;
export var uvLevel = 0.7;
export var mistHue = 0.62;

export function sliderSpeed(v) { speed = 0.006 + v * 0.07; }
export function sliderTideWidth(v) { tideWidth = 0.15 + v * 0.55; }
export function sliderWhiteLevel(v) { whiteLevel = v; }
export function sliderUvLevel(v) { uvLevel = v; }
export function hsvPickerMistColor(h, s, v) { mistHue = h; }

var tide = 0.0;
var undertow = 0.0;

export function beforeRender(delta) {
  tide = time(speed);
  undertow = time(speed * 0.57);
}

export function render3D(index, x, y, z) {
  var nx = (x + 1.264) / 3.125;
  var ny = y / 6.5;
  nx = max(0.0, min(1.0, nx));
  ny = max(0.0, min(1.0, ny));

  var sweep = (nx * 0.75 + ny * 0.55 + tide) % 1.0;
  var edge = abs(sweep - 0.5) * 2.0;
  var foam = max(0.0, 1.0 - edge / tideWidth);
  foam = pow(foam, 2.4);

  var lowRoll = wave((ny * 2.2) - (nx * 0.8) + undertow);
  var mist = pow(lowRoll, 2.0) * (0.25 + foam * 0.45);

  var white = foam * whiteLevel;
  var uv = ((1.0 - ny) * lowRoll * 0.45 + foam * 0.55) * uvLevel;

  var rgbV = mist;
  var r = rgbV * wave(mistHue + 0.000);
  var g = rgbV * wave(mistHue + 0.333);
  var b = rgbV * wave(mistHue + 0.666);

  rgbwau(min(1.0, r), min(1.0, g), min(1.0, b), min(1.0, white), 0.0, min(1.0, uv));
}
