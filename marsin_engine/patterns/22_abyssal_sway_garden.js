/*
  22_abyssal_sway_garden.js
  RGB-only deep-water kelp and caustic currents swaying in layered mathematical arcs.
*/

export var timeScale = 0.22;
export var stalkCount = 7.0;
export var causticScale = 5.5;
export var softness = 2.8;
export var deepHue = 0.61;
export var kelpHue = 0.38;

export function sliderSpeed(v) { timeScale = 0.8 - v * 0.77; }
export function sliderStalkCount(v) { stalkCount = 2.0 + v * 14.0; }
export function sliderCausticScale(v) { causticScale = 2.0 + v * 10.0; }
export function sliderSoftness(v) { softness = 1.0 + v * 5.0; }
export function hsvPickerDeepWater(h, s, v) { deepHue = h; }
export function hsvPickerKelpGlow(h, s, v) { kelpHue = h; }

var currentA = 0.0;
var currentB = 0.0;

export function beforeRender(delta) {
  currentA = time(timeScale) * 6.2831853;
  currentB = time(timeScale * 0.39) * 6.2831853;
}

export function render3D(index, x, y, z) {
  var nx = (x + 1.264) / 3.125;
  var ny = y / 6.5;
  nx = max(0.0, min(1.0, nx));
  ny = max(0.0, min(1.0, ny));

  var sway = sin(currentA + ny * 3.5) * 0.08 + sin(currentB - ny * 7.0) * 0.045;
  var stalkPhase = (nx + sway) * stalkCount;
  var stalkCenter = abs((stalkPhase - floor(stalkPhase)) - 0.5) * 2.0;
  var stalk = pow(max(0.0, 1.0 - stalkCenter * 3.0), softness);

  var causticA = wave((nx + sway) * causticScale + ny * 1.4 + time(timeScale * 0.57));
  var causticB = wave((ny - nx) * causticScale * 0.48 - time(timeScale * 0.71));
  var caustic = pow(causticA * 0.65 + causticB * 0.35, 2.0);

  var depthFade = 0.25 + ny * 0.75;
  var v = min(1.0, 0.06 + caustic * 0.35 + stalk * depthFade * 0.65);

  var hueMix = min(1.0, stalk * 0.85 + caustic * 0.25);
  var dh = kelpHue - deepHue;
  if (dh > 0.5) dh -= 1.0;
  else if (dh < -0.5) dh += 1.0;
  var hue = deepHue + dh * hueMix;

  hsv(hue - floor(hue), 0.9, v);
}
