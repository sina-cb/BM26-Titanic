/*
  24_chromatic_murmuration.js
  A flocking color storm: unpredictable swarms, moving shadows, and bright harmonic contrast.
*/

export var speed = 0.18;
export var flockReach = 0.36;
export var flockFocus = 4.0;
export var filamentDensity = 7.0;
export var contrast = 2.2;
export var saturation = 0.94;
export var afterglow = 0.18;
export var hueSky = 0.62;
export var hueEmber = 0.03;
export var hueViolet = 0.78;

export function sliderSpeed(v) { speed = 0.75 - v * 0.73; }
export function sliderFlockReach(v) { flockReach = 0.12 + v * 0.55; }
export function sliderFlockFocus(v) { flockFocus = 1.5 + v * 7.0; }
export function sliderFilamentDensity(v) { filamentDensity = 2.0 + v * 16.0; }
export function sliderContrast(v) { contrast = 0.8 + v * 5.5; }
export function sliderSaturation(v) { saturation = 0.45 + v * 0.55; }
export function sliderAfterglow(v) { afterglow = v * 0.45; }
export function hsvPickerSkyColor(h, s, v) { hueSky = h; }
export function hsvPickerEmberColor(h, s, v) { hueEmber = h; }
export function hsvPickerVioletColor(h, s, v) { hueViolet = h; }

var orbitA = 0.0;
var orbitB = 0.0;
var orbitC = 0.0;

export function beforeRender(delta) {
  orbitA = time(speed) * 6.2831853;
  orbitB = time(speed * 0.41) * 6.2831853;
  orbitC = time(speed * 0.67) * 6.2831853;
}

export function render3D(index, x, y, z) {
  var nx = (x + 1.264) / 3.125;
  var ny = y / 6.5;
  nx = max(0.0, min(1.0, nx));
  ny = max(0.0, min(1.0, ny));

  var ax = 0.5 + flockReach * sin(orbitA + sin(orbitB) * 0.6) * 0.75;
  var ay = 0.5 + flockReach * cos(orbitB * 1.3 - orbitC * 0.2) * 0.68;
  var bx = 0.5 + flockReach * cos(orbitA * 0.8 + 2.2) * 0.86;
  var by = 0.5 + flockReach * sin(orbitC * 1.6 + orbitA * 0.3) * 0.6;
  var cx = 0.5 + flockReach * sin(orbitB * 1.9 - 1.1) * 0.66;
  var cy = 0.5 + flockReach * cos(orbitA * 1.4 + orbitC) * 0.72;

  var dA = hypot(nx - ax, ny - ay);
  var dB = hypot(nx - bx, ny - by);
  var dC = hypot(nx - cx, ny - cy);

  var aGlow = pow(max(0.0, 1.0 - dA * flockFocus), contrast);
  var bGlow = pow(max(0.0, 1.0 - dB * flockFocus), contrast);
  var cGlow = pow(max(0.0, 1.0 - dC * flockFocus), contrast);

  var ribbon = wave((dA - dB + dC) * filamentDensity + time(speed * 0.27));
  var shadow = wave((nx * 1.3 - ny * 0.8) + time(speed * 0.13));
  var v = min(1.0, afterglow + aGlow * 0.75 + bGlow * 0.65 + cGlow * 0.6 + pow(ribbon, contrast) * 0.28);
  v *= 0.82 + shadow * 0.18;

  var strongest = max(aGlow, max(bGlow, cGlow));
  var hue = hueSky;
  if (bGlow == strongest) {
    hue = hueEmber;
  } else if (cGlow == strongest) {
    hue = hueViolet;
  }

  var hueDrift = sin((dA - dB) * 9.0 + orbitC) * 0.06;
  hue = hue + hueDrift;

  hsv(hue - floor(hue), saturation, min(1.0, v));
}
