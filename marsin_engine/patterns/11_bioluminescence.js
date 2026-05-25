/*
  11_bioluminescence.js
  Party-Ready Bioluminescence
*/

export var speedTrim = 0.5;
export var density = 2.0; 
export var uvIntensity = 0.6;
export var partyMode = 0.0; 

export var cp1H = 0.6, cp1S = 1.0, cp1V = 1.0; // Ambient (Oceanic blue default)
export var cp2H = 0.3, cp2S = 1.0, cp2V = 1.0; // Crest (Bioluminescent green default)
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderSpeedTrim(v) { speedTrim = v; }
export function sliderDensity(v) { density = 1.0 + v * 5.0; }
export function sliderUvGlow(v) { uvIntensity = v; }
export function sliderPartyMode(v) { partyMode = v; }

var t1, t2;
var localMultiplier = 1.0;

export function beforeRender(delta) {
  localMultiplier = pow(2.0, (speedTrim - 0.5) * 4.0);
  t1 = time(0.08 / localMultiplier);
  t2 = time(0.04 / localMultiplier);
}

export function render(index) {
  var pct = index / (pixelCount > 0 ? pixelCount : 144);
  
  var v = wave(t1 + pct * density);
  var uv_glow = wave(t2 - pct * 0.5);
  
  var crest = (v > 0.9) ? 1.0 : 0.0;
  
  if (partyMode > 0.5) {
     var strobeClock = time(0.1 / localMultiplier);
     crest *= (strobeClock * 10.0 % 1.0 < 0.5) ? 1.0 : 0.0;
  }
  
  var blend = pow(v, 4.0);
  var dh = cp2H - cp1H;
  if (dh > 0.5) dh -= 1.0;
  else if (dh < -0.5) dh += 1.0;
  
  var hue = cp1H + dh * blend;
  var sat = cp1S + (cp2S - cp1S) * blend;
  var val = (cp1V + (cp2V - cp1V) * blend) * v;

  var outW = crest * (1.0 - cp2S);
  var outU = ((uv_glow * uvIntensity) + (v * 0.4)) * cp1V;
  var outV = val * 0.8;
  
  var r = outV * wave(hue + 0.000);
  var g = outV * wave(hue + 0.333);
  var b = outV * wave(hue + 0.666);
  
  rgbwau(r, g, b, outW, 0.0, outU);
}
