/*
  01_cylon_sweep.js
  Classic Cylon/Scanner Sweep
  A high-intensity, sharp tracking beam that bounces bidirectionally across the geometric X-axis 
  with parameterized scaling and background structural glow.
*/

export var timeScale = 0.05;
export var eyeWidth = 0.15;
export var baseHue = 0.0; // Classic Red
export var bgBrightness = 0.05;

// Invert slider so maxing the UI makes the timeScale smaller (which loops the VM faster natively)
// Expanding the scale up to 0.8 yields a dramatically slow ~52-second scanner loop when dialed down!
export function sliderSpeed(v) { timeScale = 0.8 - (v * 0.78); }  // 0.8 (Very Slow) to 0.02 (Rapid)
export function sliderEyeWidth(v) { eyeWidth = 0.05 + v * 0.3; }  // Controls sharpness/spread
export function hsvPickerColor(h,s,v) { baseHue = h; }            // Primary target hue
export function sliderBackgroundGlow(v) { bgBrightness = v * 0.3; } // Base architectural glow

var scanT;

export function beforeRender(delta) {
  // Drives the main bouncing loop oscillation
  scanT = time(timeScale); 
}

export function render3D(index, x, y, z) {
  // Geometrically map the raw physical X bounds globally across the rig
  var normX = (x + 0.4) / 2.02; // Normalize approximately 0.0 to 1.0 bounding box
  if (normX < 0.0) normX = 0.0;
  if (normX > 1.0) normX = 1.0;
  
  // triangle() automatically oscillates 0.0 -> 1.0 -> 0.0 perfectly simulating a scanner bounce
  var scannerFocus = triangle(scanT); 
  
  // Calculate spatial distance from the physical pixel to the bouncing focal point
  var dist = abs(normX - scannerFocus);
  
  var v = bgBrightness;
  var hardwareWhite = 0.0;
  var hardwareAmber = 0.0;
  
  if (dist < eyeWidth) {
     // Synthesize a sharp convex curve for the scanner head
     var intensity = 1.0 - (dist / eyeWidth);
     intensity = pow(intensity, 2.0); // Quad sharpening for burning hot core
     
     // Hardware Chip Blowout logic inside the absolute center of the eye
     if (intensity > 0.9) {
         var blowout = (intensity - 0.9) * 10.0; // 0.0 to 1.0
         
         // Trigger the dedicated physical LED chips instead of fading RGB!
         hardwareWhite = blowout;
         hardwareAmber = blowout; 
     }
     
     v = max(v, intensity);
  }
  
  // Transform native primary hue into explicit RGB parameters seamlessly
  var r = v * wave(baseHue + 0.000);
  var g = v * wave(baseHue + 0.333);
  var b = v * wave(baseHue + 0.666);
  
  // Push out the composite array triggering both the Primary RGB gradient and the physical Amber/White strikes!
  rgbwau(r, g, b, hardwareWhite, hardwareAmber, 0.0);
}