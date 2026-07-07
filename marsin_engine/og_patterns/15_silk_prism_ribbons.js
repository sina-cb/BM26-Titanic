/*
  15_silk_prism_ribbons.js
  RGB-only satin ribbons sliding through the rig with soft phase-locked color blends.
*/

export var localSpeed = 0.5;
export var ribbonCount = 4.0;
export var softness = 2.2;

export var cp1H = 0.52, cp1S = 0.92, cp1V = 1.0; // Ribbon A (Cyan default)
export var cp2H = 0.86, cp2S = 0.92, cp2V = 1.0; // Ribbon B (Magenta default)
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderRibbonCount(v) { ribbonCount = 1.0 + v * 9.0; }
export function sliderSoftness(v) { softness = 1.0 + v * 5.0; }

var phase = 0.0;
var slowPhase = 0.0;

export function beforeRender(delta) {
  var localMultiplier = pow(2.0, (localSpeed - 0.5) * 4.0);
  phase = time(0.045 / localMultiplier);
  slowPhase = time(0.014 / localMultiplier);
}

export function render3D(index, x, y, z) {
  var nx = (x + 1.264) / 3.125;
  var ny = y / 6.5;
  nx = max(0.0, min(1.0, nx));
  ny = max(0.0, min(1.0, ny));

  var ribbon = wave((nx * ribbonCount) + (ny * 1.7) - phase);
  var shadow = wave((ny * ribbonCount * 0.45) - (nx * 0.9) + slowPhase);
  var v = pow((ribbon * 0.8) + (shadow * 0.2), softness);

  var colorBlend = wave(nx * 0.7 + ny * 0.35 + slowPhase);
  var dh = cp2H - cp1H;
  if (dh > 0.5) dh -= 1.0;
  else if (dh < -0.5) dh += 1.0;
  var h = cp1H + dh * colorBlend;
  var s = cp1S + (cp2S - cp1S) * colorBlend;
  var maxVal = cp1V + (cp2V - cp1V) * colorBlend;

  hsv(h - floor(h), s, min(1.0, v * maxVal));
}
