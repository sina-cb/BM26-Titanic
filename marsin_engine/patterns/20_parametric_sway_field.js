/*
  20_parametric_sway_field.js
  RGB-only parametric light field with dancing attractors and soft harmonic trails.
*/

export var speedTrim = 0.5;
export var reach = 0.42;
export var focus = 3.0;
export var trailBlend = 0.55;

export var cp1H = 0.58, cp1S = 0.88, cp1V = 1.0; // Primary Color (Teal/Blue default)
export var cp2H = 0.78, cp2S = 0.88, cp2V = 1.0; // Secondary Color (Purple/Magenta default)
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderSpeedTrim(v) { speedTrim = v; }
export function sliderReach(v) { reach = 0.18 + v * 0.55; }
export function sliderFocus(v) { focus = 1.2 + v * 5.5; }
export function sliderTrailBlend(v) { trailBlend = v; }

var p = 0.0;
var q = 0.0;
var currentScale = 0.15;

export function beforeRender(delta) {
  var localMultiplier = pow(2.0, (speedTrim - 0.5) * 4.0);
  currentScale = 0.15 / localMultiplier;
  p = time(currentScale) * 6.2831853;
  q = time(currentScale * 0.53) * 6.2831853;
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

  var trail = wave((dA - dB + dC) * 3.0 + time(currentScale * 0.67));
  var v = min(1.0, glow + trail * trailBlend * 0.22);

  var mixVal = wave((dB - dA) * 2.2 + nx * 0.5 + time(currentScale * 0.29));
  var dh = cp2H - cp1H;
  if (dh > 0.5) dh -= 1.0;
  else if (dh < -0.5) dh += 1.0;

  var h = cp1H + dh * mixVal;
  var s = cp1S + (cp2S - cp1S) * mixVal;
  var maxVal = cp1V + (cp2V - cp1V) * mixVal;

  hsv(h - floor(h), s, v * maxVal);
}
