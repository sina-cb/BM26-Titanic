/*
  16_ghost_tide_uv.js
  Slow white surf and UV undertow, built for smooth motion without flashes.
*/

export var speedTrim = 0.5;
export var tideWidth = 0.38;
export var whiteLevel = 0.85;
export var uvLevel = 0.7;

export var cp1H = 0.62, cp1S = 1.0, cp1V = 1.0; // Mist (Violet/Blue default)
export var cp2H = 0.5, cp2S = 1.0, cp2V = 1.0;  // Undertow (Teal/Green default)
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderSpeedTrim(v) { speedTrim = v; }
export function sliderTideWidth(v) { tideWidth = 0.15 + v * 0.55; }
export function sliderWhiteLevel(v) { whiteLevel = v; }
export function sliderUvLevel(v) { uvLevel = v; }

var tide = 0.0;
var undertow = 0.0;

export function beforeRender(delta) {
  var localMultiplier = pow(2.0, (speedTrim - 0.5) * 4.0);
  tide = time(0.025 / localMultiplier);
  undertow = time(0.014 / localMultiplier);
}

export function render3D(index, x, y, z) {
  var nx = (x + 1.264) / 3.125;
  var ny = y / 6.5;
  nx = max(0.0, min(1.0, nx));
  ny = max(0.0, min(1.0, ny));

  var sweep = (nx * 0.75 + ny * 0.55 + tide) % 1.0;
  var edge = abs(sweep - 0.5) * 2.0;
  var foam = max(0.0, 1.0 - edge / tideWidth);
  foam = pow(foam, 2.4);

  var lowRoll = wave((ny * 2.2) - (nx * 0.8) + undertow);
  var mist = pow(lowRoll, 2.0) * (0.25 + foam * 0.45);

  var dh = cp2H - cp1H;
  if (dh > 0.5) dh -= 1.0;
  else if (dh < -0.5) dh += 1.0;
  var hue = cp1H + dh * lowRoll;
  var sat = cp1S + (cp2S - cp1S) * lowRoll;
  var maxVal = cp1V + (cp2V - cp1V) * lowRoll;

  var white = foam * whiteLevel * (1.0 - sat);
  var uv = ((1.0 - ny) * lowRoll * 0.45 + foam * 0.55) * uvLevel;

  var rgbV = mist * maxVal;
  var r = rgbV * wave(hue + 0.000);
  var g = rgbV * wave(hue + 0.333);
  var b = rgbV * wave(hue + 0.666);

  rgbwau(min(1.0, r), min(1.0, g), min(1.0, b), min(1.0, white), 0.0, min(1.0, uv));
}
