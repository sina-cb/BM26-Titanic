/*
  24_chromatic_murmuration.js
  Flocking colour storm — strict cp1<->cp2 in RGB-space. The previous
  hsv()-based mix could traverse non-palette hues at narrow saturations;
  RGB-lerp guarantees output stays on the cp1<->cp2 line.
*/

export var localSpeed = 0.5;
export var flockReach = 0.36;
export var flockFocus = 4.0;
export var filamentDensity = 7.0;
export var contrast = 2.2;
export var afterglow = 0.18;

export var cp1H = 0.62, cp1S = 0.94, cp1V = 1.0;
export var cp2H = 0.03, cp2S = 0.94, cp2V = 1.0;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderFlockReach(v) { flockReach = 0.12 + v * 0.55; }
export function sliderFlockFocus(v) { flockFocus = 1.5 + v * 7.0; }
export function sliderFilamentDensity(v) { filamentDensity = 2.0 + v * 16.0; }
export function sliderContrast(v) { contrast = 0.8 + v * 5.5; }
export function sliderAfterglow(v) { afterglow = v * 0.45; }

// ── Continuity: same fix as patterns 20/23 — per-harmonic time() bases so
//   each sin/cos angle is time(s)*TAU with no fractional multiplier on a
//   wrapping phase (would otherwise jump by sin(2π*k+c)−sin(c) per wrap).
var orbitA = 0.0;
var orbitB = 0.0;
var orbitC = 0.0;
var orbitB13 = 0.0, orbitC02 = 0.0, orbitA08 = 0.0;
var orbitC16 = 0.0, orbitA03 = 0.0, orbitB19 = 0.0, orbitA14 = 0.0;
var currentScale = 0.18;

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
  currentScale = 0.18 / localMultiplier;
  orbitA = time(currentScale) * 6.2831853;
  orbitB = time(currentScale * 0.41) * 6.2831853;
  orbitC = time(currentScale * 0.67) * 6.2831853;
  // Per-harmonic bases for the k-multiplied phases in render3D. Scale s/k.
  orbitB13 = time(currentScale * 0.41 / 1.3) * 6.2831853;
  orbitC02 = time(currentScale * 0.67 / 0.2) * 6.2831853;
  orbitA08 = time(currentScale / 0.8) * 6.2831853;
  orbitC16 = time(currentScale * 0.67 / 1.6) * 6.2831853;
  orbitA03 = time(currentScale / 0.3) * 6.2831853;
  orbitB19 = time(currentScale * 0.41 / 1.9) * 6.2831853;
  orbitA14 = time(currentScale / 1.4) * 6.2831853;
  _hsv2rgb1();
  _hsv2rgb2();
}

export function render3D(index, x, y, z) {
  var nx = (x + 1.264) / 3.125;
  var ny = y / 6.5;
  nx = max(0.0, min(1.0, nx));
  ny = max(0.0, min(1.0, ny));

  var ax = 0.5 + flockReach * sin(orbitA + sin(orbitB) * 0.6) * 0.75;
  var ay = 0.5 + flockReach * cos(orbitB13 - orbitC02) * 0.68;
  var bx = 0.5 + flockReach * cos(orbitA08 + 2.2) * 0.86;
  var by = 0.5 + flockReach * sin(orbitC16 + orbitA03) * 0.6;
  var cx = 0.5 + flockReach * sin(orbitB19 - 1.1) * 0.66;
  var cy = 0.5 + flockReach * cos(orbitA14 + orbitC) * 0.72;

  var dA = hypot(nx - ax, ny - ay);
  var dB = hypot(nx - bx, ny - by);
  var dC = hypot(nx - cx, ny - cy);

  var aGlow = pow(max(0.0, 1.0 - dA * flockFocus), contrast);
  var bGlow = pow(max(0.0, 1.0 - dB * flockFocus), contrast);
  var cGlow = pow(max(0.0, 1.0 - dC * flockFocus), contrast);

  var ribbon = wave((dA - dB + dC) * filamentDensity + time(currentScale * 0.27));
  var shadow = wave((nx * 1.3 - ny * 0.8) + time(currentScale * 0.13));
  var v = min(1.0, afterglow + aGlow * 0.75 + bGlow * 0.65 + cGlow * 0.6 + pow(ribbon, contrast) * 0.28);
  v *= 0.82 + shadow * 0.18;

  // Blend factor in [0,1]: how much of the rig leans toward attractors b/c
  // (cp2) vs attractor a (cp1).
  var totalGlow = aGlow + bGlow + cGlow;
  var tVal = totalGlow > 0.0 ? ((bGlow + cGlow) / totalGlow) : 0.0;
  tVal = max(0.0, min(1.0, tVal));

  var r = (pr1 + (pr2 - pr1) * tVal) * v;
  var g = (pg1 + (pg2 - pg1) * tVal) * v;
  var b = (pb1 + (pb2 - pb1) * tVal) * v;

  rgb(r, g, b);
}
