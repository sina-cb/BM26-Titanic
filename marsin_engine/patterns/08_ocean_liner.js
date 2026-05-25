/*
  08_ocean_liner.js
  Ocean Liner Nocturne
*/

export var speedTrim = 0.5;
export var windowCount = 8.0;
export var windowFocus = 6.0;
export var contrastAmount = 1.0;

export var cp1H = 0.6, cp1S = 1.0, cp1V = 1.0; // Water (Deep Blue default)
export var cp2H = 0.08, cp2S = 0.9, cp2V = 1.0; // Windows (Amber default)
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderSpeedTrim(v) { speedTrim = v; }
export function sliderContrast(v) { contrastAmount = 1.0 + v * 4.0; }
export function sliderWindowCount(v) { windowCount = 1.0 + v * 20.0; }
export function sliderWindowFocus(v) { windowFocus = 1.0 + v * 15.0; }

var t1, t2;

export function beforeRender(delta) {
  var localMultiplier = pow(2.0, (speedTrim - 0.5) * 4.0);
  var scale = 0.15 / localMultiplier;
  t1 = time(scale * 0.5);
  t2 = time(scale * 2.0);
}

export function render(index) {
  var pct = index / (pixelCount > 0 ? pixelCount : 144);

  var shimmer = 0.88 + 0.12 * wave(t2 + pct * 2.0);
  var pulse = 0.75 + 0.25 * wave(t1);
  var baseV = pulse * shimmer;
  
  baseV = pow(baseV, contrastAmount);

  var wPhase = (pct * windowCount + t2) % 1.0;
  var wSharp = triangle(wPhase);
  
  var wTrigger = 0.80;
  var windows = wSharp > wTrigger ? (wSharp - wTrigger) * windowFocus : 0.0;
  windows = min(1.0, windows);

  // Compute base water using cp1
  var r1 = baseV * cp1V * wave(cp1H + 0.000);
  var g1 = baseV * cp1V * wave(cp1H + 0.333);
  var b1 = baseV * cp1V * wave(cp1H + 0.666);
  
  var m1 = min(r1, min(g1, b1));
  r1 = m1 * (1.0 - cp1S) + r1 * cp1S;
  g1 = m1 * (1.0 - cp1S) + g1 * cp1S;
  b1 = m1 * (1.0 - cp1S) + b1 * cp1S;

  // Compute bright windows using cp2
  var r2 = windows * cp2V * wave(cp2H + 0.000);
  var g2 = windows * cp2V * wave(cp2H + 0.333);
  var b2 = windows * cp2V * wave(cp2H + 0.666);
  
  var m2 = min(r2, min(g2, b2));
  r2 = m2 * (1.0 - cp2S) + r2 * cp2S;
  g2 = m2 * (1.0 - cp2S) + g2 * cp2S;
  b2 = m2 * (1.0 - cp2S) + b2 * cp2S;

  rgb(min(1.0, r1 + r2), min(1.0, g1 + g2), min(1.0, b1 + b2));
}
