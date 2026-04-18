/*
  07_shimmer.js
  Shimmering Glow
  A hyper-parameterized, multi-layered shimmer overlay sitting on top of a breathing ambient pulse.
*/

export var speed = 0.1;
export var shimmerSpeed = 0.5;
export var shimmerDensity = 10.0;
export var baseHue = 0.1;
export var colorSpread = 0.1;
export var breathingInt = 0.4;
export var minBrightness = 0.2;

export function sliderMacroSpeed(v) { speed = v * 0.5; }
export function sliderShimmerSpeed(v) { shimmerSpeed = v * 2.0; }
export function sliderDensity(v) { shimmerDensity = 2.0 + v * 30.0; }
export function hsvPickerBaseColor(h, s, v) { baseHue = h; }
export function sliderColorSpread(v) { colorSpread = v * 0.3; }
export function sliderBreathing(v) { breathingInt = v; }

var tBreathing;
var tShimmer;

export function beforeRender(delta) {
  var d = delta > 0.0 ? delta : 25.0; 
  tBreathing = time(speed);
  tShimmer = time(shimmerSpeed);
}

export function render(index) {
  var pct = index / (pixelCount > 0 ? pixelCount : 144);
  
  // Micro Shimmer noise layer
  var sWave = wave(pct * shimmerDensity - tShimmer);
  sWave = pow(sWave, 3); // sharpen the shimmer peaks
  
  // Macro breathing background layer
  var bWave = wave(pct + tBreathing);
  var intensity = minBrightness + (bWave * breathingInt);
  
  var finalV = intensity + (sWave * 0.4);
  finalV = max(0.0, min(1.0, finalV));
  
  // Drift hue dynamically around the user's selected base spectrum
  var hueShift = sin(pct * 5.0 + tBreathing * PI2) * colorSpread;
  var finalHue = baseHue + hueShift;
  
  // Fallback compiler bounding
  finalHue = finalHue - floor(finalHue);
  hsv(finalHue, 1.0, finalV);
}
