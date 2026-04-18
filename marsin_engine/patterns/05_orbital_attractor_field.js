/*
  05_orbital_attractor_field.js
  Orbital Attractor Field
  Hypnotic gravity wells that orbit the stage with a unified, gracefully dancing color palette.
*/

export var speed = 0.05;

// Orbit radii (how far they stray from the center)
export var orbit1 = 0.4;
export var orbit2 = 0.5;
export var orbit3 = 0.3;

// Orbit speeds and directions
export var r1 = 1.0;
export var r2 = -1.5;
export var r3 = 2.0;

export var falloff = 2.5; 
export var focus = 1.5;
export var baseHue = 0.0; // The defined master Hue
export var colorSpread = 0.1; // Determines how far "adjacent" it drifts

export function sliderSpeed(v) { speed = 0.01 + v * 0.15; }
export function hsvPickerBaseColor(h, s, v) { baseHue = h; }
export function sliderColorSpread(v) { colorSpread = v * 0.3; } // Keeps shifting tight!
export function sliderFalloff(v) { falloff = 1.0 + v * 5.0; }
export function sliderFocus(v) { focus = 1.0 + v * 4.0; }

var beatPhase = 0.0;

export function beforeRender(delta) {
  // Sync all orbital rotations natively to the master speed tracker
  beatPhase = time(speed); 
}

export function render3D(index, wx, wy, wz) {
  // Normalize layout mapping tightly to the standard boundaries
  var nx = (wx + 1.264) / 3.125;
  var ny = wy / 6.5; 
  nx = max(0.0, min(1.0, nx));
  ny = max(0.0, min(1.0, ny));

  // The 3 attractors explicitly moving smoothly across the X and Y axes
  var b1 = beatPhase * 6.28318 * r1;
  var b2 = beatPhase * 6.28318 * r2;
  var b3 = beatPhase * 6.28318 * r3;

  var ax1 = 0.5 + orbit1 * cos(b1);
  var ay1 = 0.5 + orbit1 * sin(b1);
  
  var ax2 = 0.5 + orbit2 * cos(b2);
  var ay2 = 0.5 + orbit2 * sin(b2);
  
  var ax3 = 0.5 + orbit3 * cos(b3);
  var ay3 = 0.5 + orbit3 * sin(b3);

  // Compute Euclidean distances to each smoothly moving gravity well
  var d1 = hypot(nx - ax1, ny - ay1);
  var d2 = hypot(nx - ax2, ny - ay2);
  var d3 = hypot(nx - ax3, ny - ay3);

  // Isolate the absolute closest gravity well
  var d = min(d1, min(d2, d3));

  // Smooth liquid intensity field 
  var v = pow(max(0.0, min(1.0, 1.0 - d * falloff)), focus);

  var outV = v;
  var outW = 0.0;
  var outA = 0.0;
  
  // --- COLOR BIBLE IMPLEMENTATION ---
  // Calculates an iridescent hue that ripples beautifully but strictly adheres
  // to the chosen base color! It only varies smoothly up and down the color spread scale.
  var hueShift = (d1 * 1.5) - (d2 * 0.8) + (beatPhase * 2.0);
  // Re-map the continuous math into a strict oscillating boundary (-0.5 to 0.5)
  hueShift = (sin(hueShift * 6.28318) * 0.5); 
  
  // Add exactly adjacent drifts on top of the "Bible" Base Hue
  var hue = baseHue + (hueShift * colorSpread);

  // --- PHYSICAL LAYER LOGIC ---
  var isBar = wy < 1.8;
  var isPar = wy >= 1.8 && wy < 4.0;
  var isVintage = wy >= 4.0;

  if (isBar) {
     // Default logic smoothly sweeps across the bars organically on the X/Y flow
  } 
  else if (isVintage) {
     // Elegant rolling Halo blooms completely independent from binary flashes
     outW += v * v * 0.6; // Quadratic scaling ensures extremely smooth dimming and brightening
     outA += v * 0.4;
  } 
  else if (isPar) {
     // Pars gently surge out and dance
     outV = v * 0.9;
     // Soft white aura only in the absolute deep center core, completely smooth gradient
     outW += max(0.0, 1.0 - (d * 5.0)) * 0.5; 
  }

  // Clamping matrix
  outV = max(0.0, min(1.0, outV));
  outW = max(0.0, min(1.0, outW));
  outA = max(0.0, min(1.0, outA));
  
  // Custom RGB resolver integration 
  var r = max(0.0, min(1.0, outV * wave(hue + 0.000)));
  var g = max(0.0, min(1.0, outV * wave(hue + 0.333)));
  var b = max(0.0, min(1.0, outV * wave(hue + 0.666)));

  rgbwau(r, g, b, outW, outA, 0.0);
}
