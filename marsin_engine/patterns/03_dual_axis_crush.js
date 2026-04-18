/*
  03_dual_axis_crush_optimized.js
  A linear continuous attack pattern that spawns at the extreme left and right 
  edges of the room and collapses into the physical stage center forever.
  -- Refactored for Continuous Modulo Trailing --
*/

export var speed = 0.05;
export var swipeLength = 0.8; // Distance between continuous waves
export var beamWidth = 0.5; // Thicker default to show off the neon trail
export var hue = 0.55; 
export var sat = 1.0;
export var hueSpread = 0.5; // Allows the user to shift colors down the trail

export function sliderSpeed(v) { speed = 0.01 + v * 0.1; }
export function sliderSwipeLength(v) { swipeLength = 0.2 + v * 1.5; }
export function sliderBeamWidth(v) { beamWidth = 0.1 + v * 0.8; }
export function hsvPickerColor(h, s, v) { hue = h; sat = s; }
export function sliderHueSpread(v) { hueSpread = v * 2.0; }

var attackPos = 0;
var flashIntensity = 0;
var invBeamWidth = 1.0; 

export function beforeRender(delta) {
  // Drives the animation forward infinitely
  attackPos = time(speed); 
  
  // Pre-calculate multiplication inverse
  invBeamWidth = 1.0 / beamWidth;

  // Flash collision exactly when the attack hits the center (attackPos wraps at 1.0->0.0)
  var flashPhase = attackPos % 1.0;
  flashIntensity = 0.0;
  if (flashPhase < 0.1) {
    flashIntensity = 1.0 - (flashPhase * 10.0);
    flashIntensity *= flashIntensity; 
  }
}

export function render3D(index, x, y, z) {
  // --- ASYMMETRICAL X-AXIS MAPPING ---
  // Calculates exact distance from the physical stage center (x = 0.6)
  var normDist = 0.0;
  if (x < 0.6) {
    normDist = (0.6 - x) * 0.5376;
  } else {
    normDist = (x - 0.6) * 0.7936;
  }
  
  // --- CONTINUOUS NEON TRAIL LOGIC ---
  // Spatial phase increases as we move towards the outer walls
  var spatialPhase = normDist / swipeLength; 
  
  // Modulo wrap forces the wave to repeat infinitely inward.
  // cycle = 0.0 represents the absolute leading white core edge.
  var cycle = (spatialPhase + attackPos) % 1.0;
  
  // Maps the infinite cycle back to a physical trailing distance
  var distBehind = cycle * swipeLength;
  
  var brightness = 0.0;
  var pixelHue = hue;
  var pixelSat = sat;
  
  // The trail fades out smoothly the further back it is
  brightness = max(0.0, 1.0 - (distBehind * invBeamWidth));
  brightness *= brightness; // Curve preserves intense brightness closer to the head
  
  // NEON GRADIENT: The trailing wipe shifts through the color spectrum
  pixelHue = hue + (distBehind * hueSpread);
  
  // ARC-WELDER CORE: The absolute leading edge burns pure white.
  // It rapidly regains saturation as it moves backwards into the neon tail.
  pixelSat = sat * min(1.0, distBehind * 15.0);

  // --- IMPACT CRUSH BLAST ---
  // Center proximity fades out natively beyond distance threshold (1/4)
  var centerProximity = max(0.0, 1.0 - normDist * 4.0);
  
  // Calculate local pixel blast impact
  var localFlash = flashIntensity * centerProximity;
  
  // Mix saturations & peaks perfectly
  pixelSat *= max(0.0, 1.0 - localFlash); 
  brightness = max(brightness, localFlash);
  
  hsv(pixelHue, pixelSat, brightness);
}