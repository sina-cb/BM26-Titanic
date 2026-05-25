/*
  17_rolling_color_dunes.js
  RGB-only rolling dunes of color with broad, slow movement across X and height.
*/

export var speedTrim = 0.5;
export var scale = 3.0;
export var contrast = 1.7;

export var cp1H = 0.08, cp1S = 0.88, cp1V = 1.0; // Low Color (Orange default)
export var cp2H = 0.47, cp2S = 0.88, cp2V = 1.0; // High Color (Teal default)
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderSpeedTrim(v) { speedTrim = v; }
export function sliderScale(v) { scale = 1.0 + v * 7.0; }
export function sliderContrast(v) { contrast = 0.8 + v * 3.5; }

var roll = 0.0;
var drift = 0.0;

export function beforeRender(delta) {
  var localMultiplier = pow(2.0, (speedTrim - 0.5) * 4.0);
  roll = time(0.035 / localMultiplier);
  drift = time(0.01 / localMultiplier); 
}

export function render3D(index, x, y, z) {
  var nx = (x + 1.264) / 3.125;
  var ny = y / 6.5;
  nx = max(0.0, min(1.0, nx));
  ny = max(0.0, min(1.0, ny));

  var duneA = wave(nx * scale - roll + ny * 0.9);
  var duneB = wave((nx + ny) * scale * 0.45 + drift);
  var dune = pow(duneA * 0.7 + duneB * 0.3, contrast);

  var blend = wave(ny * 0.8 + nx * 0.35 + drift);
  var dh = cp2H - cp1H;
  if (dh > 0.5) dh -= 1.0;
  else if (dh < -0.5) dh += 1.0;

  var h = cp1H + dh * blend;
  var s = cp1S + (cp2S - cp1S) * blend;
  var maxVal = cp1V + (cp2V - cp1V) * blend;
  var v = 0.08 + dune * 0.92;

  hsv(h - floor(h), s, min(1.0, v * maxVal));
}
