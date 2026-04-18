/*
  15_silk_prism_ribbons.js
  RGB-only satin ribbons sliding through the rig with soft phase-locked color blends.
*/

export var speed = 0.045;
export var ribbonCount = 4.0;
export var softness = 2.2;
export var hueA = 0.52;
export var hueB = 0.86;
export var hueC = 0.12;

export function sliderSpeed(v) { speed = 0.01 + v * 0.12; }
export function sliderRibbonCount(v) { ribbonCount = 1.0 + v * 9.0; }
export function sliderSoftness(v) { softness = 1.0 + v * 5.0; }
export function hsvPickerColorA(h, s, v) { hueA = h; }
export function hsvPickerColorB(h, s, v) { hueB = h; }
export function hsvPickerColorC(h, s, v) { hueC = h; }

var phase = 0.0;
var slowPhase = 0.0;

export function beforeRender(delta) {
  phase = time(speed);
  slowPhase = time(speed * 0.31);
}

export function render3D(index, x, y, z) {
  var nx = (x + 1.264) / 3.125;
  var ny = y / 6.5;
  nx = max(0.0, min(1.0, nx));
  ny = max(0.0, min(1.0, ny));

  var ribbon = wave((nx * ribbonCount) + (ny * 1.7) - phase);
  var shadow = wave((ny * ribbonCount * 0.45) - (nx * 0.9) + slowPhase);
  var v = pow((ribbon * 0.8) + (shadow * 0.2), softness);

  var colorPhase = (nx * 1.4 + ny * 0.7 + slowPhase * 1.5) % 3.0;
  if (colorPhase < 0.0) colorPhase += 3.0;

  var h = hueA;
  if (colorPhase < 1.0) {
    var dhAB = hueB - hueA;
    if (dhAB > 0.5) dhAB -= 1.0;
    else if (dhAB < -0.5) dhAB += 1.0;
    h = hueA + dhAB * colorPhase;
  } else if (colorPhase < 2.0) {
    var dhBC = hueC - hueB;
    if (dhBC > 0.5) dhBC -= 1.0;
    else if (dhBC < -0.5) dhBC += 1.0;
    h = hueB + dhBC * (colorPhase - 1.0);
  } else {
    var dhCA = hueA - hueC;
    if (dhCA > 0.5) dhCA -= 1.0;
    else if (dhCA < -0.5) dhCA += 1.0;
    h = hueC + dhCA * (colorPhase - 2.0);
  }

  hsv(h - floor(h), 0.92, min(1.0, v));
}
