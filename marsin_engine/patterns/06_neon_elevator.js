/*
  06_neon_elevator.js
  Neon Elevator
  A horizontal block of color climbs upward like an old-school elevator platform.
  Optimized for sparse visual arrays via single chunky Y-axis banding interpolation!
*/

export var speed = 0.05;

export var stepCount = 5.0; // The elevator moves "step by step". Quantizes spatial movement cleanly.
export var floorThickness = 0.2;
export var bloomPower = 3.0; // Shapes the trailing aura edge of the platform

// Three fully independent and continuously evaluated UI color pickers
export var hueBottom = 0.5;
export var satBottom = 1.0; 

export var hueTop = 0.6;
export var satTop = 1.0;

export var hueArrival = 0.0;
export var satArrival = 0.0; // Default Pure White setup for the Arrival blasts

export function sliderSpeed(v) { speed = 0.01 + v * 0.15; }
export function sliderSteps(v) { stepCount = 1.0 + floor(v * 20.0); }
export function sliderThickness(v) { floorThickness = 0.05 + v * 0.4; }
export function sliderBloom(v) { bloomPower = 1.0 + v * 4.0; }

export function hsvPickerHueBottom(h,s,v) { hueBottom = h; satBottom = s; }
export function hsvPickerHueTop(h,s,v) { hueTop = h; satTop = s; }
export function hsvPickerHueArrival(h,s,v) { hueArrival = h; satArrival = s; }

var masterTime = 0;
var beatPhase = 0;
var arrivalPulse = 0;

export function beforeRender(delta) {
  // Graceful WASM delta clock failsafe system
  var d = delta > 0.0 ? delta : 25.0; 
  masterTime += d / 1000.0;

  // The elevator phase continually loops from 0.0 (bottom floor) to 1.0 (destination top)
  beatPhase = time(speed); 
  
  // Calculate exact moment of physical arrival
  if (stepCount > 1.0) {
     var currentStep = floor(beatPhase * stepCount);
     var maxStep = stepCount - 1.0;
     
     if (currentStep >= maxStep) {
        // We have successfully arrived at destination!
        // Ramp up an explosive pulse explicitly timed to the duration of the final step phase.
        var stepPhase = (beatPhase * stepCount) - currentStep;
        arrivalPulse = stepPhase; // Linear slope 0->1
     } else {
        arrivalPulse = 0.0;
     }
  } else {
     // If stepCount is exactly 1 (Smooth Sweeping mode), simply flash when hitting crest
     if (beatPhase > 0.9) {
        arrivalPulse = (beatPhase - 0.9) * 10.0;
     } else {
        arrivalPulse = 0.0;
     }
  }
}

export function render3D(index, wx, wy, wz) {
  // --- HARDWARE-AWARE METADATA ROUTING ---
  // Euclidean coordinates are completely bypassed here in favor of explicit V2 compiler topology.
  // We use the natively injected `sectionId` to categorize the groups explicitly, eliminating spatial drift!
  var isPar = (sectionId == 1);
  var isVintage = (sectionId == 2);
  var isBar = (sectionId == 3);

  // Fallback map exclusively for missing/legacy firmware configurations (sectionId = 0)
  if (sectionId == 0) {
     isBar = wy < 1.8;
     isPar = wy >= 1.8 && wy < 4.0;
     isVintage = wy >= 4.0;
  }

  // Assign smooth visual progression explicitly to the target topological groups
  var visualY = 0.0;
  if (isBar) visualY = 0.0;          // Launch Pad
  else if (isPar) visualY = 0.5;     // Midway Transit
  else if (isVintage) visualY = 1.0; // Final Destination

  // Compute platform destination based on master time clock
  var targetY = beatPhase;
  if (stepCount > 1.0) {
     targetY = floor(beatPhase * stepCount) / (stepCount - 1.0);
  }

  // Calculate distance structurally against semantic layer routing
  var dist = abs(visualY - targetY);
  
  // Synthesize solid sweeping horizontal geometry with soft tapering edges
  var v = max(0.0, 1.0 - (dist / floorThickness));
  v = pow(v, bloomPower);
  
  var outV = v;
  var outW = 0.0;
  var outA = 0.0;
  
  // --- COLOR PALETTE GRADIENT BLENDING ---
  var mixRatio = visualY; // Color strictly syncs to semantic height!
  
  // Short path hue-wrap routing wrapper
  var dh = hueTop - hueBottom;
  if (dh > 0.5) dh -= 1.0;
  else if (dh < -0.5) dh += 1.0;
  
  var hue = hueBottom + dh * mixRatio;
  hue = hue - floor(hue); // Secure compiler fallback clamping 0..1
  var sat = (satBottom * (1.0 - mixRatio)) + (satTop * mixRatio);
  
  // --- PHYSICAL LAYER OVERRIDES ---
  if (isBar) {
     outV = v * 0.95;
     outV = max(outV, 0.05); // Add a permanent subtle glowing ambient base to the structural pads
  }
  else if (isPar) {
     // Pars initially act as part of the climbing ladder block, but explicitly OVERRIDE 
     // when the elevator reaches the absolute ceiling, triggering the destination flash!
     if (arrivalPulse > 0.0) {
        outV = arrivalPulse;
        outW = arrivalPulse * 0.9;
        hue = hueArrival;
        sat = satArrival;
     } else {
        outV = v * 0.5; // Dimmer midway ladder
     }
  }
  else if (isVintage) {
     outV = v;
     outA = v * 0.4; // Core structural Amber block tracking element
     
     // Mirror the destination blast into the upper crown
     if (arrivalPulse > 0.0) {
        outW += arrivalPulse * 0.7;
     }
  }

  // Safety bounding matrix
  outV = max(0.0, min(1.0, outV));
  outW = max(0.0, min(1.0, outW));
  outA = max(0.0, min(1.0, outA));
  sat  = max(0.0, min(1.0, sat));
  
  // --- NATIVE TRUE SATURATION RGB SOLVER ---
  var rRaw = outV * wave(hue + 0.000);
  var gRaw = outV * wave(hue + 0.333);
  var bRaw = outV * wave(hue + 0.666);

  var wLevel = outV * (1.0 - sat); // Lift the base noise ceiling cleanly
  var r = max(0.0, min(1.0, wLevel + (rRaw * sat)));
  var g = max(0.0, min(1.0, wLevel + (gRaw * sat)));
  var b = max(0.0, min(1.0, wLevel + (bRaw * sat)));

  rgbwau(r, g, b, outW, outA, 0.0);
}
