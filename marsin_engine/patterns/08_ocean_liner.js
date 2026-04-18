/*
  08_ocean_liner.js
  Ocean Liner Nocturne
  Rolling deep oceanic breathes with warm interior structural windows sweeping across.
*/

export var timeScale = 0.15;
export var windowCount = 8.0;
export var windowFocus = 6.0;
export var contrastAmount = 1.0;

export var waterHue = 0.6; // Deep Blue
export var waterSat = 1.0;

export var windowHue = 0.08; // Warm amber-orange
export var windowSat = 0.9;

// In PB, smaller time scalars yield FASTER loops. We invert the UI mapping so higher slider = higher speed!
export function sliderSpeed(v) { timeScale = 0.3 - (v * 0.28); } // 0.3 (slow) to 0.02 (rapid)
export function sliderContrast(v) { contrastAmount = 1.0 + v * 4.0; }
export function sliderWindowCount(v) { windowCount = 1.0 + v * 20.0; }
export function sliderWindowFocus(v) { windowFocus = 1.0 + v * 15.0; }

export function hsvPickerWaterColor(h,s,v) { waterHue = h; waterSat = s; }
export function hsvPickerWindowColor(h,s,v) { windowHue = h; windowSat = s; }

var t1, t2;

export function beforeRender(delta) {
  t1 = time(timeScale * 0.5); // Core breathing pulse
  t2 = time(timeScale * 2.0); // Sweeping motion
}

export function render(index) {
  var pct = index / (pixelCount > 0 ? pixelCount : 144);

  // Soft motion base layer
  var shimmer = 0.88 + 0.12 * wave(t2 + pct * 2.0);
  var pulse = 0.75 + 0.25 * wave(t1);
  var baseV = pulse * shimmer;
  
  // Apply dynamic structural contrast 
  baseV = pow(baseV, contrastAmount);

  // Repeating geometric groupings (the "Windows")
  var wPhase = (pct * windowCount + t2) % 1.0;
  var wSharp = triangle(wPhase);
  
  var wTrigger = 0.80; // Only expose the brightest 20% of the wave crest
  var windows = wSharp > wTrigger ? (wSharp - wTrigger) * windowFocus : 0.0;
  windows = min(1.0, windows);

  // Compute base water
  var r1 = baseV * wave(waterHue + 0.000);
  var g1 = baseV * wave(waterHue + 0.333);
  var b1 = baseV * wave(waterHue + 0.666);
  
  // Convert natively away from full saturation
  var m1 = min(r1, min(g1, b1));
  r1 = m1 * (1.0 - waterSat) + r1 * waterSat;
  g1 = m1 * (1.0 - waterSat) + g1 * waterSat;
  b1 = m1 * (1.0 - waterSat) + b1 * waterSat;

  // Compute bright window overlays
  var r2 = windows * wave(windowHue + 0.000);
  var g2 = windows * wave(windowHue + 0.333);
  var b2 = windows * wave(windowHue + 0.666);
  
  var m2 = min(r2, min(g2, b2));
  r2 = m2 * (1.0 - windowSat) + r2 * windowSat;
  g2 = m2 * (1.0 - windowSat) + g2 * windowSat;
  b2 = m2 * (1.0 - windowSat) + b2 * windowSat;

  // Additive Blend
  rgb(min(1.0, r1 + r2), min(1.0, g1 + g2), min(1.0, b1 + b2));
}
