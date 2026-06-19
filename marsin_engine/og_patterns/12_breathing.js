/*
  12_breathing.js
  Enhanced Synchronized Breathing
*/

export var localSpeed = 0.5;
export var spatialOffset = 0.0; 
export var breathSharpness = 1.0; 

export var cp1H = 0.0, cp1S = 1.0, cp1V = 1.0; // Exhale (Red default)
export var cp2H = 0.1, cp2S = 1.0, cp2V = 1.0; // Inhale (Orange default)
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderRipple(v) { spatialOffset = v * 2.0; }
export function sliderSharpness(v) { breathSharpness = 1.0 + v * 8.0; }

var t1;
export function beforeRender(delta) {
  var localMultiplier = pow(2.0, (localSpeed - 0.5) * 4.0);
  t1 = time(0.05 / localMultiplier);
}

export function render(index) {
  var pct = index / (pixelCount > 0 ? pixelCount : 144);
  
  var w = wave(t1 + (pct * spatialOffset));
  var v = pow(w, breathSharpness);
  
  var dh = cp2H - cp1H;
  if (dh > 0.5) dh -= 1.0;
  else if (dh < -0.5) dh += 1.0;
  
  var hue = cp1H + dh * w;
  var sat = cp1S + (cp2S - cp1S) * w;
  var maxVal = cp1V + (cp2V - cp1V) * w;
  
  hsv(hue - floor(hue), sat, v * maxVal);
}
