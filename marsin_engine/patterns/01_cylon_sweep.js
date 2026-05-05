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
export var globalDir = 1.0;

// Invert slider so maxing the UI makes the timeScale smaller (which loops the VM faster natively)
// Expanding the scale up to 0.8 yields a dramatically slow ~52-second scanner loop when dialed down!
export function speed(v) { timeScale = 0.01 + 0.79 * pow(1.0 - v, 3.0); }
export function size(v) { eyeWidth = 0.05 + v * 0.3; }  // Controls sharpness/spread
export function colorPalette1(h,s,v) { baseHue = h; }            // Primary target hue
export function sliderBackgroundGlow(v) { bgBrightness = v * 0.3; } // Base architectural glow
export function direction(v) { globalDir = (v * 2.0) - 1.0; }

var scanT = 0.0;

export function beforeRender(delta) {
  // Manually accumulate time phase so changing the timeScale (speed) slider doesn't cause glitches/jumps
  // Base time loop is 65.536 seconds. delta is in milliseconds.
  var phaseIncrement = (delta / 65536.0) / timeScale;
  scanT = (scanT + phaseIncrement * globalDir) % 1.0; 
  if (scanT < 0) scanT += 1.0;
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
  // --- Inline HSV to RGB Converter for perfectly accurate primary colors ---
  var r = 0.0;
  var g = 0.0;
  var b = 0.0;
  
  var h = abs(baseHue - floor(baseHue)); 
  var iObj = floor(h * 6);
  var fObj = h * 6 - iObj;
  var sObj = 1.0; // fully saturated core
  var pObj = v * (1.0 - sObj);
  var qObj = v * (1.0 - fObj * sObj);
  var tObj = v * (1.0 - (1.0 - fObj) * sObj);
  
  iObj = iObj % 6;
  if (iObj == 0)      { r = v; g = tObj; b = pObj; }
  else if (iObj == 1) { r = qObj; g = v; b = pObj; }
  else if (iObj == 2) { r = pObj; g = v; b = tObj; }
  else if (iObj == 3) { r = pObj; g = qObj; b = v; }
  else if (iObj == 4) { r = tObj; g = pObj; b = v; }
  else                { r = v; g = pObj; b = qObj; }
  
  // Push out the composite array triggering both the Primary RGB gradient and the physical Amber/White strikes!
  rgbwau(r, g, b, hardwareWhite, hardwareAmber, 0.0);
}