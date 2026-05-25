/*
  20_parametric_sway_field.js
  RGB-only parametric field with dancing attractors. Strict cp1<->cp2 in
  RGB-space (previously used hsv() which could traverse non-palette hues).
*/

export var localSpeed = 0.5;
export var reach = 0.42;
export var focus = 3.0;
export var trailBlend = 0.55;

export var cp1H = 0.58, cp1S = 0.88, cp1V = 1.0;
export var cp2H = 0.78, cp2S = 0.88, cp2V = 1.0;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderReach(v) { reach = 0.18 + v * 0.55; }
export function sliderFocus(v) { focus = 1.2 + v * 5.5; }
export function sliderTrailBlend(v) { trailBlend = v; }

var p = 0.0;
var q = 0.0;
var currentScale = 0.15;

// ── Palette RGB cache ─────────────────────────────────────────────────
var pr1 = 1, pg1 = 0, pb1 = 0;
var pr2 = 0, pg2 = 0, pb2 = 1;
function _hsv2rgb1() {
  var hv = cp1H - floor(cp1H); if (hv < 0) hv += 1;
  var iv = floor(hv * 6) % 6;
  var fv = hv * 6 - floor(hv * 6);
  var pv = cp1V * (1 - cp1S);
  var qv = cp1V * (1 - fv * cp1S);
  var tv = cp1V * (1 - (1 - fv) * cp1S);
  if      (iv == 0) { pr1 = cp1V; pg1 = tv;   pb1 = pv;   }
  else if (iv == 1) { pr1 = qv;   pg1 = cp1V; pb1 = pv;   }
  else if (iv == 2) { pr1 = pv;   pg1 = cp1V; pb1 = tv;   }
  else if (iv == 3) { pr1 = pv;   pg1 = qv;   pb1 = cp1V; }
  else if (iv == 4) { pr1 = tv;   pg1 = pv;   pb1 = cp1V; }
  else             { pr1 = cp1V; pg1 = pv;   pb1 = qv;   }
}
function _hsv2rgb2() {
  var hv = cp2H - floor(cp2H); if (hv < 0) hv += 1;
  var iv = floor(hv * 6) % 6;
  var fv = hv * 6 - floor(hv * 6);
  var pv = cp2V * (1 - cp2S);
  var qv = cp2V * (1 - fv * cp2S);
  var tv = cp2V * (1 - (1 - fv) * cp2S);
  if      (iv == 0) { pr2 = cp2V; pg2 = tv;   pb2 = pv;   }
  else if (iv == 1) { pr2 = qv;   pg2 = cp2V; pb2 = pv;   }
  else if (iv == 2) { pr2 = pv;   pg2 = cp2V; pb2 = tv;   }
  else if (iv == 3) { pr2 = pv;   pg2 = qv;   pb2 = cp2V; }
  else if (iv == 4) { pr2 = tv;   pg2 = pv;   pb2 = cp2V; }
  else             { pr2 = cp2V; pg2 = pv;   pb2 = qv;   }
}

export function beforeRender(delta) {
  var localMultiplier = pow(2.0, (localSpeed - 0.5) * 4.0);
  currentScale = 0.15 / localMultiplier;
  p = time(currentScale) * 6.2831853;
  q = time(currentScale * 0.53) * 6.2831853;
  _hsv2rgb1();
  _hsv2rgb2();
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

  // Strict RGB lerp — no hsv() interpolation, no hue drift past cp1/cp2.
  var r = (pr1 + (pr2 - pr1) * mixVal) * v;
  var g = (pg1 + (pg2 - pg1) * mixVal) * v;
  var b = (pb1 + (pb2 - pb1) * mixVal) * v;

  rgb(r, g, b);
}
