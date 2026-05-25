/*
  19_swaying_lattice_ballet.js
  RGB-only nested lattice ribbons that rise, dip, curl upward, and settle back down.
*/

export var localSpeed = 0.5;
export var density = 5.5;
export var width = 0.22;
export var softness = 2.6;

export var cp1H = 0.68, cp1S = 0.9, cp1V = 1.0; // Base Color (Purple default)
export var cp2H = 0.48, cp2S = 0.9, cp2V = 1.0; // Accent Color (Teal default)
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderDensity(v) { density = 2.0 + v * 10.0; }
export function sliderWidth(v) { width = 0.08 + v * 0.38; }
export function sliderSoftness(v) { softness = 1.0 + v * 5.0; }

var mainPhase = 0.0;
var tSlow = 0.0;
var currentScale = 0.032;

export function beforeRender(delta) {
  var localMultiplier = pow(2.0, (localSpeed - 0.5) * 4.0);
  currentScale = 0.032 / localMultiplier;
  mainPhase = time(currentScale) * 6.2831853;
  tSlow = time(currentScale * 0.37) * 6.2831853;
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
  var cross = wave((nx - ny) * density * 0.42 + time(currentScale * 0.61));
  var v = ribbon * (0.55 + sideCurl * 0.3 + cross * 0.25);

  var colorMix = wave(nx * 0.7 + ny * 1.4 + time(currentScale * 0.43));
  var dh = cp2H - cp1H;
  if (dh > 0.5) dh -= 1.0;
  else if (dh < -0.5) dh += 1.0;

  var h = cp1H + dh * colorMix;
  var s = cp1S + (cp2S - cp1S) * colorMix;
  var maxVal = cp1V + (cp2V - cp1V) * colorMix;

  hsv(h - floor(h), s, min(1.0, v * maxVal));
}
