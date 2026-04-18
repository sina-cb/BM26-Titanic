/*
  14_lunar_current.js
  Wide, smooth moonlit currents with white and UV riding through the upper layers.
*/

export var speed = 0.035;
export var density = 2.8;
export var whiteLift = 0.75;
export var uvLift = 0.55;
export var blueHue = 0.58;
export var blueSat = 0.85;

export function sliderSpeed(v) { speed = 0.01 + v * 0.08; }
export function sliderDensity(v) { density = 1.0 + v * 5.0; }
export function sliderWhiteLift(v) { whiteLift = v; }
export function sliderUvLift(v) { uvLift = v; }
export function hsvPickerWaterTone(h, s, v) { blueHue = h; blueSat = s; }

var driftA = 0.0;
var driftB = 0.0;

export function beforeRender(delta) {
  driftA = time(speed);
  driftB = time(speed * 0.43);
}

export function render3D(index, x, y, z) {
  var nx = (x + 1.264) / 3.125;
  var ny = y / 6.5;
  nx = max(0.0, min(1.0, nx));
  ny = max(0.0, min(1.0, ny));

  var longWave = wave((nx * density) + (ny * 0.8) - driftA);
  var crossWave = wave((ny * density * 0.7) - (nx * 0.6) + driftB);
  var current = (longWave * 0.65) + (crossWave * 0.35);
  current = pow(current, 1.8);

  var crown = pow(max(0.0, ny), 1.6);
  var white = current * crown * whiteLift;
  var uv = (0.2 + crossWave * 0.8) * crown * uvLift;

  var rgbV = current * (0.35 + 0.45 * (1.0 - crown));
  var sat = blueSat * (0.75 + 0.25 * longWave);

  var base = rgbV * (1.0 - sat);
  var r = base + (rgbV * wave(blueHue + 0.000) * sat);
  var g = base + (rgbV * wave(blueHue + 0.333) * sat);
  var b = base + (rgbV * wave(blueHue + 0.666) * sat);

  rgbwau(min(1.0, r), min(1.0, g), min(1.0, b), min(1.0, white), 0.0, min(1.0, uv));
}
