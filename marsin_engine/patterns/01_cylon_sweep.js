/*
  01_cylon_sweep.js
  Classic Cylon/Scanner Sweep
*/

export var speedTrim = 0.5;
export var eyeWidth = 0.15;
export var bgBrightness = 0.05;
export var globalDir = 1.0;

export var cp1H = 0.0, cp1S = 1.0, cp1V = 1.0; // Classic Red default
export var cp2H = 0.6, cp2S = 1.0, cp2V = 0.5; // Blue background default
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderSpeedTrim(v) { speedTrim = v; }
export function size(v) { eyeWidth = 0.05 + v * 0.3; }
export function sliderBackgroundGlow(v) { bgBrightness = v * 0.3; }
export function direction(v) { globalDir = (v * 2.0) - 1.0; }

var scanT = 0.0;

export function beforeRender(delta) {
  var localMultiplier = pow(2.0, (speedTrim - 0.5) * 4.0);
  var phaseIncrement = (delta / 65536.0) / (0.05 / localMultiplier);
  scanT = (scanT + phaseIncrement * globalDir) % 1.0; 
  if (scanT < 0) scanT += 1.0;
}

export function render3D(index, x, y, z) {
  var normX = (x + 0.4) / 2.02;
  if (normX < 0.0) normX = 0.0;
  if (normX > 1.0) normX = 1.0;
  
  var scannerFocus = triangle(scanT); 
  var dist = abs(normX - scannerFocus);
  
  var intensity = 0.0;
  if (dist < eyeWidth) {
     intensity = 1.0 - (dist / eyeWidth);
     intensity = pow(intensity, 2.0);
  }
  
  var hardwareWhite = 0.0;
  var hardwareAmber = 0.0;
  
  if (intensity > 0.9) {
      var blowout = (intensity - 0.9) * 10.0;
      hardwareWhite = blowout * (1.0 - cp1S);
      hardwareAmber = blowout * cp1S * (1.0 - min(1.0, abs(cp1H - 0.08) * 4.0));
  }
  
  // Interpolate between cp2 (bg) and cp1 (beam) based on intensity (using tVal instead of t)
  var tVal = intensity;
  var dh = cp1H - cp2H;
  if (dh > 0.5) dh -= 1.0;
  else if (dh < -0.5) dh += 1.0;
  var h = cp2H + dh * tVal;
  var s = cp2S + (cp1S - cp2S) * tVal;
  var val = (cp2V * bgBrightness) + (cp1V - cp2V * bgBrightness) * tVal;
  
  // Custom hsv to rgb
  h = abs(h - floor(h));
  var iObj = floor(h * 6);
  var fObj = h * 6 - iObj;
  var pObj = val * (1.0 - s);
  var qObj = val * (1.0 - fObj * s);
  var tObj = val * (1.0 - (1.0 - fObj) * s);
  var r = 0, g = 0, b = 0;
  iObj = iObj % 6;
  if (iObj == 0)      { r = val; g = tObj; b = pObj; }
  else if (iObj == 1) { r = qObj; g = val; b = pObj; }
  else if (iObj == 2) { r = pObj; g = val; b = tObj; }
  else if (iObj == 3) { r = pObj; g = qObj; b = val; }
  else if (iObj == 4) { r = tObj; g = pObj; b = val; }
  else                { r = val; g = pObj; b = qObj; }
  
  rgbwau(r, g, b, hardwareWhite, hardwareAmber, 0.0);
}