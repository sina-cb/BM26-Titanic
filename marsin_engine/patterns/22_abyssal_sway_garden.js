/*
  22_abyssal_sway_garden.js
  RGB-only deep-water kelp and caustic currents swaying in layered mathematical arcs.
*/

export var speedTrim = 0.5;
export var stalkCount = 7.0;
export var causticScale = 5.5;
export var softness = 2.8;

export var cp1H = 0.61, cp1S = 0.9, cp1V = 1.0; // Deep Color (Oceanic blue default)
export var cp2H = 0.38, cp2S = 0.9, cp2V = 1.0; // Kelp Color (Kelp green default)
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderSpeedTrim(v) { speedTrim = v; }
export function sliderStalkCount(v) { stalkCount = 2.0 + v * 14.0; }
export function sliderCausticScale(v) { causticScale = 2.0 + v * 10.0; }
export function sliderSoftness(v) { softness = 1.0 + v * 5.0; }

var currentA = 0.0;
var currentB = 0.0;
var currentScale = 0.22;

export function beforeRender(delta) {
  var localMultiplier = pow(2.0, (speedTrim - 0.5) * 4.0);
  currentScale = 0.22 / localMultiplier;
  currentA = time(currentScale) * 6.2831853;
  currentB = time(currentScale * 0.39) * 6.2831853;
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

  var causticA = wave((nx + sway) * causticScale + ny * 1.4 + time(currentScale * 0.57));
  var causticB = wave((ny - nx) * causticScale * 0.48 - time(currentScale * 0.71));
  var caustic = pow(causticA * 0.65 + causticB * 0.35, 2.0);

  var depthFade = 0.25 + ny * 0.75;
  var v = min(1.0, 0.06 + caustic * 0.35 + stalk * depthFade * 0.65);

  var hueMix = min(1.0, stalk * 0.85 + caustic * 0.25);
  var dh = cp2H - cp1H;
  if (dh > 0.5) dh -= 1.0;
  else if (dh < -0.5) dh += 1.0;
  
  var hue = cp1H + dh * hueMix;
  var sat = cp1S + (cp2S - cp1S) * hueMix;
  var maxVal = cp1V + (cp2V - cp1V) * hueMix;

  hsv(hue - floor(hue), sat, v * maxVal);
}
