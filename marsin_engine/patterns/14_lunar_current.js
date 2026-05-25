/*
  14_lunar_current.js
  Wide, smooth moonlit currents with white and UV riding through the upper layers.
*/

export var speedTrim = 0.5;
export var density = 2.8;
export var whiteLift = 0.5;
export var uvLift = 0.5;

export var cp1H = 0.58, cp1S = 0.85, cp1V = 1.0; // Current (Deep Blue default)
export var cp2H = 0.5, cp2S = 1.0, cp2V = 1.0;  // Caustic/Accent (Teal default)
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderSpeedTrim(v) { speedTrim = v; }
export function sliderDensity(v) { density = 1.0 + v * 5.0; }
export function sliderWhiteLift(v) { whiteLift = v; }
export function sliderUvLift(v) { uvLift = v; }

var driftA = 0.0;
var driftB = 0.0;

export function beforeRender(delta) {
  var localMultiplier = pow(2.0, (speedTrim - 0.5) * 4.0);
  driftA = time(0.035 / localMultiplier);
  driftB = time(0.015 / localMultiplier); 
}

export function render3D(index, x, y, z) {
  var nx = (x + 1.264) / 3.125;
  var ny = y / 6.5;
  nx = max(0.0, min(1.0, nx));
  ny = max(0.0, min(1.0, ny));

  var longWave = wave((nx * density) + (ny * 0.8) - driftA);
  var crossWave = wave((ny * density * 0.7) - (nx * 0.6) + driftB);
  var current = (longWave * 0.65) + (crossWave * 0.35);
  current = pow(current, 1.8);

  var crown = pow(max(0.0, ny), 1.6);
  
  var effWhiteLift = whiteLift * 1.5; 
  var effUvLift = uvLift * 1.1;       
  
  var white = current * crown * effWhiteLift * (1.0 - cp1S);
  var uv = (0.2 + crossWave * 0.8) * crown * effUvLift;

  var dh = cp2H - cp1H;
  if (dh > 0.5) dh -= 1.0;
  else if (dh < -0.5) dh += 1.0;
  var hue = cp1H + dh * crossWave;
  var sat = cp1S + (cp2S - cp1S) * crossWave;
  var maxVal = cp1V + (cp2V - cp1V) * crossWave;

  var rgbV = current * (0.35 + 0.45 * (1.0 - crown)) * maxVal;
  var effSat = sat * (0.75 + 0.25 * longWave);

  var base = rgbV * (1.0 - effSat);
  var r = base + (rgbV * wave(hue + 0.000) * effSat);
  var g = base + (rgbV * wave(hue + 0.333) * effSat);
  var b = base + (rgbV * wave(hue + 0.666) * effSat);

  rgbwau(min(1.0, r), min(1.0, g), min(1.0, b), min(1.0, white), 0.0, min(1.0, uv));
}
