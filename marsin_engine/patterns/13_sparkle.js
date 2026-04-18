/*
  13_sparkle.js
  Distributed Section Sparkle
  Randomized pure white bursts sitting overtop dynamic, fading base-hues specifically 
  routed to isolated sections (Bars, Pars, Vintage).
*/

export var bgFadeSpeed = 0.02;     // The pace the background turns on/off
export var sparkleSpeed = 0.01;
export var sparkleDensity = 0.4;   // Controls how frequently bursts pop

export var bgHue1 = 0.0;    // Section 1 (Pars)
export var bgHue2 = 0.33;   // Section 2 (Vintage)
export var bgHue3 = 0.66;   // Section 3 (Bars)

export function sliderBackgroundFade(v) { bgFadeSpeed = v * 0.1; }
export function sliderSparkleSpeed(v) { sparkleSpeed = 0.005 + v * 0.05; }
export function sliderSparkleDensity(v) { sparkleDensity = 0.1 + v * 0.8; }

export function hsvPickerSection1(h,s,v) { bgHue1 = h; }
export function hsvPickerSection2(h,s,v) { bgHue2 = h; }
export function hsvPickerSection3(h,s,v) { bgHue3 = h; }

var tFade;
var tSparkle;

export function beforeRender(delta) {
  tFade = time(bgFadeSpeed);
  tSparkle = time(sparkleSpeed);
}

export function render3D(index, x, y, z) {
  // Use explicit V2 Section Routing for color matching!
  var baseHue = bgHue1; // Unassigned mappings default here
  if (sectionId == 2) baseHue = bgHue2;
  else if (sectionId == 3) baseHue = bgHue3;
  
  // Background slow fade logic
  // The temporal wave causes the ambient colored background to smoothly swell and drain
  var bgAlpha = wave(tFade + (sectionId * 0.2)); 
  
  // Sparkle pseudo-random stateless generation per pixel, decoupled across time
  var seed = index * 73.137 + tSparkle * 1000.0;
  var sparkle = sin(seed) * sin(seed * 3.7) * sin(seed * 7.3);
  sparkle = sparkle * sparkle * sparkle * sparkle; // spike sharpening transform
  
  if (sparkle > sparkleDensity) {
     var intensity = (sparkle - sparkleDensity) * 3.0; // scale up the remaining gap
     if (intensity > 1.0) intensity = 1.0;
     
     // Blast pure white foreground sparkle overtop with desaturation logic!
     hsv(baseHue, 1.0 - intensity, intensity);
  } else {
     // Yield back to the fading ambient colored background
     hsv(baseHue, 1.0, bgAlpha * 0.5); // cap at 50% brightness so foreground sparkles jump out immediately
  }
}
