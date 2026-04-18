/*
  11_bioluminescence.js
  Party-Ready Bioluminescence
  Deep oceanic glows mixed with intense, strobing UV and white caps synced for high-energy sets.
*/

export var speed = 0.08;
export var density = 2.0; 
export var baseHue = 0.6; // Oceanic blue
export var uvIntensity = 0.6;
export var partyMode = 0.0; // 0 = chill ambient, 1.0 = sharp strobe caps

export function sliderSpeed(v) { speed = 0.02 + v * 0.2; }
export function sliderDensity(v) { density = 1.0 + v * 5.0; }
export function hsvPickerBaseColor(h,s,v) { baseHue = h; }
export function sliderUvGlow(v) { uvIntensity = v; }
export function sliderPartyMode(v) { partyMode = v; }

var t1, t2;
export function beforeRender(delta) {
  t1 = time(speed);
  t2 = time(speed * 0.5);
}

export function render(index) {
  var pct = index / (pixelCount > 0 ? pixelCount : 144);
  
  var v = wave(t1 + pct * density);
  var uv_glow = wave(t2 - pct * 0.5);
  
  // Sharp white crests capping the top of the wave forms
  var crest = (v > 0.9) ? 1.0 : 0.0;
  
  if (partyMode > 0.5) {
     // Trigger aggressive rhythmic strobe gating on the crests
     crest *= (time(0.1) % 0.1 < 0.05) ? 1.0 : 0.0;
  }
  
  var outW = crest;
  var outU = (uv_glow * uvIntensity) + (v * 0.4);
  
  var outV = v * 0.8;
  
  // Standard internal manual routing to synthesize RGB from Hue accurately 
  var r = outV * wave(baseHue + 0.000);
  var g = outV * wave(baseHue + 0.333);
  var b = outV * wave(baseHue + 0.666);
  
  rgbwau(r, g, b, outW, 0.0, outU);
}
