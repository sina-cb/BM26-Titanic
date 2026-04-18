/*
  20_parametric_sway_field.js
  RGB-only parametric light field with dancing attractors and soft harmonic trails.
*/

export var timeScale = 0.15;
export var reach = 0.42;
export var focus = 3.0;
export var trailBlend = 0.55;
export var hueA = 0.58;
export var hueB = 0.78;

// Invert slider so maxing the UI makes the timeScale smaller (which loops the VM faster natively)
export function sliderSpeed(v) { timeScale = 0.8 - (v * 0.78); } // 0.8 (Very Slow) to 0.02 (Rapid)
export function sliderReach(v) { reach = 0.18 + v * 0.55; }
export function sliderFocus(v) { focus = 1.2 + v * 5.5; }
export function sliderTrailBlend(v) { trailBlend = v; }
export function hsvPickerPrimary(h, s, v) { hueA = h; }
export function hsvPickerSecondary(h, s, v) { hueB = h; }

var p = 0.0;
var q = 0.0;

export function beforeRender(delta) {
  p = time(timeScale) * 6.2831853;
  q = time(timeScale * 0.53) * 6.2831853;
}

export function render3D(index, x, y, z) {
  var nx = (x + 1.264) / 3.125;
  var ny = y / 6.5;
  nx = max(0.0, min(1.0, nx));
  ny = max(0.0, min(1.0, ny));

  var ax = 0.5 + reach * sin(p) * cos(q * 0.7);
  var ay = 0.5 + reach * sin(p * 1.37 + 0.8) * 0.62 + sin(q * 1.9) * 0.09;

  var bx = 0.5 + reach * sin(p * 0.73 + 2.1) * 0.75;
  var by = 0.5 + reach * sin(p * 1.91 - q * 0.4) * 0.55;

  var cx = 0.5 + reach * sin(p * 1.21 - 1.4) * cos(q * 0.5) * 0.8;
  var cy = 0.5 + reach * sin(p * 0.61 + q + 1.2) * 0.58;

  var dA = hypot(nx - ax, ny - ay);
  var dB = hypot(nx - bx, ny - by);
  var dC = hypot(nx - cx, ny - cy);

  var nearest = min(dA, min(dB, dC));
  var glow = pow(max(0.0, 1.0 - nearest * focus), 2.0);

  var trail = wave((dA - dB + dC) * 3.0 + time(timeScale * 0.67));
  var v = min(1.0, glow + trail * trailBlend * 0.22);

  var mixVal = wave((dB - dA) * 2.2 + nx * 0.5 + time(timeScale * 0.29));
  var dh = hueB - hueA;
  if (dh > 0.5) dh -= 1.0;
  else if (dh < -0.5) dh += 1.0;

  var h = hueA + dh * mixVal;
  hsv(h - floor(h), 0.88, v);
}
