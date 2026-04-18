/*
  04_beat_folded_helix.js
  Beat-Folded Pseudo-3D Helix Tunnel
  Optimized for sparse horizontal arrays with proper perspective mathematics!
*/

export var speed = 0.05; // Standardized speed property
export var armCount = 3.0;
export var twistFreq = 4.0;
export var colorSpread = 1.0;
export var contrast = 1.5;

export function sliderSpeed(v) { speed = 0.05 + v * 0.25; }
export function sliderArmCount(v) { armCount = 1.0 + floor(v * 12.0); }
export function sliderTwistFreq(v) { twistFreq = -10.0 + v * 40.0; }
export function sliderColorSpread(v) { colorSpread = 0.1 + v * 5.0; }
export function sliderContrast(v) { contrast = 0.5 + v * 9.0; }

var masterTime = 0;
var tunnelZ = 0;
var spinPhase = 0;
var beatPulse = 0;

export function beforeRender(delta) {
  // Continuous hardware-synchronized clock with WASM NaN failsafe
  var d = delta > 0.0 ? delta : 25.0; 
  masterTime += d / 1000.0;
  
  // Continuous time variables prevent phase-snapping artifacts entirely
  tunnelZ = masterTime * (speed * 120.0);
  spinPhase = masterTime * (speed * 40.0);
  
  // Percussive hit logic synced tightly to master time
  var beatFrac = (masterTime * speed * 40.0);
  beatFrac = beatFrac - floor(beatFrac);
  beatPulse = (beatFrac < 0.1) ? 1.0 : 0.0;
}

export function render3D(index, wx, wy, wz) {
  // --- 1. PROJECTION MAPPING ---
  // Normalize layout around the LED Bar visual focal center (wx=0.6).
  // IMPORTANT: cx MUST retain signed negative values to allow atan2() to calculate 
  // accurate 360-degree circular geometry! Absolute magnitude completely destroys rotation.
  var cx = 0.0;
  if (wx < 0.6) {
    cx = -(0.6 - wx) * 0.5376;
  } else {
    cx = (wx - 0.6) * 0.7936;
  }
  
  // Normalize Y (Floor to Top Mast)
  var ny = max(0.0, min(1.0, wy / 6.5));
  
  // Shift spatial vanishing point to Y=3.0 (Mid-air, dead center between Pars and Vintage)
  var cy = ny - 0.45; 
  
  // --- 2. 3D TUNNEL DEPTH CALCULATION ---
  var ang = atan2(cy, cx); 
  var dist = hypot(cx, cy);
  dist = max(0.02, dist); // Prevent division by zero at the literal dead-center singularity
  
  // "Depth" translates standard 2D flat coordinates into walls rushing forward into the screen
  var depth = (1.0 / dist);
  
  // --- 3. HELIX FIELD GENERATION ---
  // Combines 2D spirals (ang * arms) with tunnel projection (depth) and time flow
  var helixPhase = (ang * armCount) + (depth * twistFreq) - tunnelZ + spinPhase;
  var field = sin(helixPhase);
  
  var v = max(0.0, field);
  v = pow(v, contrast); // Mathematically compress the walls based on the Contrast slider
  
  // --- 4. FIXTURE LAYER BEHAVIORS ---
  var isBar = wy < 1.8;
  var isPar = wy >= 1.8 && wy < 4.0;
  var isVintage = wy >= 4.0;
  
  var outV = 0.0;
  var outW = 0.0;
  var outA = 0.0;
  
  // Master Hue cycles smoothly as the tunnel descends backwards into the void
  var hue = 0.5 + (depth * 0.1 * colorSpread) + masterTime * speed; 
  
  if (isBar) {
     // Floor Runway: Keep the center horizon totally 100% black by multiplying by distance
     outV = v * 1.5;
     outV *= min(1.0, dist * 3.0); 
  } 
  else if (isPar) {
     // Structural Walls: Hard punches explicitly synced to percussion beat logic
     outV = v * 0.6;
     if (beatPulse > 0.0 && field > 0.0) {
       outV = 1.0;
       outW = 0.8; // Harsh strobe burst
     }
  }
  else if (isVintage) {
     // Crown ceiling: Ember trails glowing deep Amber/White
     outV = v;
     outW = v * beatPulse * 0.6; 
     outA = v * 0.4;
     hue -= 0.1;
  }

  outV = max(0.0, min(1.0, outV));
  outW = max(0.0, min(1.0, outW));
  outA = max(0.0, min(1.0, outA));
  
  var sat = 1.0;
  
  // --- 5. RGB OUTPUT INTEGRATION ---
  // Retains hsv-to-rgb wave math explicitly so structural white targets preserve fixture scaling
  var r = max(0.0, min(1.0, outV * wave(hue + 0.000)));
  var g = max(0.0, min(1.0, outV * wave(hue + 0.333)));
  var b = max(0.0, min(1.0, outV * wave(hue + 0.666)));

  rgbwau(r, g, b, outW, outA, 0.0);
}
