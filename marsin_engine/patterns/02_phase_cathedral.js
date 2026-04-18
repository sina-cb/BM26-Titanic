/*
  02_phase_cathedral.js
  A huge, beat-locked interference field made from several phase-shifted sine planes crossing the rig. 
  It reads like a living architectural waveform. Big, classy, intelligent, ravey.
*/

export var speed = 0.02;
export var radialDensity = 15.0;
export var ratioA = 1.618;
export var ratioB = 0.618;
export var sharpness = 4.0;
export var hueA = 0.6; // Deep Blue
export var hueB = 0.8; // Pink/Magenta

export function sliderSpeed(v) { speed = 0.005 + v * 0.05; }
export function sliderRadialDensity(v) { radialDensity = 2 + v * 20; }
export function sliderSharpness(v) { sharpness = 1 + v * 9; }
export function hsvPickerHueA(h, s, v) { hueA = h; }
export function hsvPickerHueB(h, s, v) { hueB = h; }

var beatPhase;

export function beforeRender(delta) {
  // beatPhase orbits 0 to 2*PI smoothly 
  beatPhase = time(speed) * 6.2831853;
}

export function render3D(index, x, y, z) {
  // Normalize coords based on rig bounding box
  var nx = (x + 1.264) / 3.125;
  var ny = y / 6.5; 
  if (nx < 0) nx = 0; 
  if (nx > 1) nx = 1;
  if (ny < 0) ny = 0; 
  if (ny > 1) ny = 1;

  // Build interference scalar fields using standard sin(radians) math
  // Removed unneeded sliders and hardcoded the structural densities as requested
  var f1 = sin(nx * 10.0 + beatPhase);
  var f2 = sin(ny * 10.0 - beatPhase * 0.5);
  var f3 = sin((nx + ny) * 5.0 + beatPhase * ratioA);
  
  var dx = nx - 0.5;
  var dy = ny - 0.85;
  var dist = sqrt(dx*dx + dy*dy);
  var f4 = sin(dist * radialDensity - beatPhase * ratioB);
  
  // Combine & Sharpen
  var field = (f1 + f2 + f3 + f4) * 0.25; 
  var magnitude = pow(abs(field), sharpness);
  
  // Two-tone palette using sign
  var h = hueB;
  if (field > 0) {
    h = hueA;
  }
  
  var s = 1.0;
  
  // Setup baseline outputs
  var finalW = 0.0;
  var finalA = 0.0;
  var finalU = 0.0;
  var finalV = magnitude;
  
  // --- FIXTURE SCALES ---
  
  // 1. 36 Bars (y < 1.8)
  if (y < 1.8) {
     finalV = magnitude;
  }
  
  // 2. 4 Huge Pars (y >= 1.8 && y < 4.0)
  else if (y < 4.0) {
    // parImpact is hardcoded to 0.8 (strongly favors zero-crossings)
    var zc = 1.0 - abs(field);
    zc = pow(zc, sharpness * 2); 
    finalV = (magnitude * 0.2) + (zc * 0.8);
  }
  
  // 3. 12 Vintage Whites (y > 6.0)
  else {
    // whiteBoost is hardcoded to 1.0
    finalW = magnitude;
    if (finalW > 1) finalW = 1;
    
    finalA = finalW * 0.25; 
    finalV = magnitude * 0.5; 
  }

  // --- Inline HSV to RGB Converter ---
  var outR = 0.0;
  var outG = 0.0;
  var outB = 0.0;
  
  h = abs(h - floor(h)); 
  var iObj = floor(h * 6);
  var fObj = h * 6 - iObj;
  var pObj = finalV * (1.0 - s);
  var qObj = finalV * (1.0 - fObj * s);
  var tObj = finalV * (1.0 - (1.0 - fObj) * s);
  
  iObj = iObj % 6;
  if (iObj == 0)      { outR = finalV; outG = tObj; outB = pObj; }
  else if (iObj == 1) { outR = qObj; outG = finalV; outB = pObj; }
  else if (iObj == 2) { outR = pObj; outG = finalV; outB = tObj; }
  else if (iObj == 3) { outR = pObj; outG = qObj; outB = finalV; }
  else if (iObj == 4) { outR = tObj; outG = pObj; outB = finalV; }
  else                { outR = finalV; outG = pObj; outB = qObj; }

  rgbwau(outR, outG, outB, finalW, finalA, finalU);
}
