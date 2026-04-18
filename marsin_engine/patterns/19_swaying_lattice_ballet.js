/*
  19_swaying_lattice_ballet.js
  RGB-only nested lattice ribbons that rise, dip, curl upward, and settle back down.
*/

export var timeScale = 0.032;
export var density = 5.5;
export var width = 0.22;
export var softness = 2.6;
export var baseHue = 0.68;
export var accentHue = 0.48;

// Invert slider so maxing the UI makes the timeScale smaller (which loops the VM faster natively)
export function sliderSpeed(v) { timeScale = 0.8 - (v * 0.78); } // 0.8 (Very Slow) to 0.02 (Rapid)
export function sliderDensity(v) { density = 2.0 + v * 10.0; }
export function sliderWidth(v) { width = 0.08 + v * 0.38; }
export function sliderSoftness(v) { softness = 1.0 + v * 5.0; }
export function hsvPickerBaseColor(h, s, v) { baseHue = h; }
export function hsvPickerAccentColor(h, s, v) { accentHue = h; }

var mainPhase = 0.0;
var tSlow = 0.0;

export function beforeRender(delta) {
  mainPhase = time(timeScale) * 6.2831853;
  tSlow = time(timeScale * 0.37) * 6.2831853;
}

export function render3D(index, x, y, z) {
  var nx = (x + 1.264) / 3.125;
  var ny = y / 6.5;
  nx = max(0.0, min(1.0, nx));
  ny = max(0.0, min(1.0, ny));

  var sway1 = sin(mainPhase + nx * 4.1) * 0.22;
  var sway2 = sin(mainPhase * 1.7 - nx * 7.3 + tSlow) * 0.13;
  var sway3 = sin(mainPhase * 2.6 + nx * 11.0 - ny * 2.0) * 0.07;
  var centerY = 0.5 + sway1 + sway2 + sway3;

  var distY = abs(ny - centerY);
  var ribbon = max(0.0, 1.0 - distY / width);
  ribbon = pow(ribbon, softness);

  var sideCurl = wave(nx * density + sin(tSlow + ny * 3.0) * 0.35);
  var cross = wave((nx - ny) * density * 0.42 + time(timeScale * 0.61));
  var v = ribbon * (0.55 + sideCurl * 0.3 + cross * 0.25);

  var colorMix = wave(nx * 0.7 + ny * 1.4 + time(timeScale * 0.43));
  var dh = accentHue - baseHue;
  if (dh > 0.5) dh -= 1.0;
  else if (dh < -0.5) dh += 1.0;

  var h = baseHue + dh * colorMix;
  hsv(h - floor(h), 0.9, min(1.0, v));
}
