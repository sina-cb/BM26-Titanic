/*
  00_golden_hour_wash.js
  Extremely warm, ambient, shifting sunset lighting.
*/

export var noiseScale = 0.5;
export var fadeSpeed = 0.02; // Default much faster to make the movement visible

export function sliderNoiseScale(v) { noiseScale = 0.1 + (v * 2.0); }
export function sliderFadeSpeed(v) { fadeSpeed = 0.005 + (v * 0.05); }

var tPhase;

export function beforeRender(delta) {
  // Returns 0..1 based on cycle speed. 0.02 is a very fast cycle.
  tPhase = time(fadeSpeed); 
}

export function render3D(index, x, y, z) {
  // Combine axes into a single sweeping spatial coordinate, adding the phase for motion
  // This ensures the entire wave sweeps across the volume rather than destructively interfering
  var v = (x * noiseScale) + (y * noiseScale * 0.5) - (z * noiseScale * 0.5) + tPhase;
  
  // wave() returns 0..1
  var noise = wave(v);
  
  // Power of 3 to create high contrast (sharp bright areas, deep dark areas)
  noise = noise * noise * noise;
  
  // Base golden hour wash
  var r = 0.5 * noise;
  var g = 0.0;
  var b = 0.0;
  var w = noise;
  var a = noise;
  var u = 0.0;
  
  // Emphasize the bright white specifically for the Vintage lights.
  // In the test_bench.js model, VintageLights have high y and z values.
  if (y > 0.8 || z > 0.8) {
    w = noise * 2.5; // push it significantly harder
    if (w > 1.0) w = 1.0;
  }

  // Use the 6-channel RGBWAU output
  rgbwau(r, g, b, w, a, u);
}
