/*
  25_heartbeat.js
  Synchronized Double-Pulse Heartbeat
  Drives an aggressive, volumetric "lub-dub" double-pulse across the entire rig.
  Features parameterized speed logic, physical X-axis rippling, and section-based color routing.
*/

export var timeScale = 0.012;
export var minBright = 0.04;
export var rippleAmount = 0.0; // 0 = perfectly synchronized. > 0 = sweeping physics wave

export var bgHue1 = 0.0;    // Section 1 (Pars)
export var bgHue2 = 0.33;   // Section 2 (Vintage)
export var bgHue3 = 0.66;   // Section 3 (Bars)

// Invert slider so maxing the UI loops the VM faster natively
export function sliderSpeed(v) { timeScale = 0.1 - (v * 0.09); } // 0.1 (Slow: ~6.5sec) to 0.01 (Rapid: ~0.6sec)
export function sliderDormantGlow(v) { minBright = v * 0.3; }
export function sliderRippleSweep(v) { rippleAmount = v * 0.5; }

export function hsvPickerSection1(h,s,v) { bgHue1 = h; }
export function hsvPickerSection2(h,s,v) { bgHue2 = h; }
export function hsvPickerSection3(h,s,v) { bgHue3 = h; }

var t1;

export function beforeRender(delta) {
  // Master global clock tracking for the heartbeat
  t1 = time(timeScale);
}

export function render3D(index, x, y, z) {
  // Dynamically pull section colors based on V2 hardware semantic routing
  var hue = bgHue1;
  if (sectionId == 2) hue = bgHue2;
  else if (sectionId == 3) hue = bgHue3;
  
  // Geometrically map the raw physical X bounds globally across the rig
  var normX = (x + 0.4) / 2.02; 
  if (normX < 0.0) normX = 0.0;
  if (normX > 1.0) normX = 1.0;
  
  // Calculate localized temporal phase (shifts the wave in time depending on physical location!)
  var localCycle = (t1 - (normX * rippleAmount)) % 1.0;
  if (localCycle < 0.0) localCycle += 1.0; // secure bounds
  
  // Generate the complex "lub-dub" waveform natively per pixel
  var localBeat = 0.0;
  if (localCycle < 0.08) {
     // First violent stroke (The Lub)
     localBeat = wave(localCycle / 0.08);
  } else if (localCycle > 0.12 && localCycle < 0.18) {
     // Secondary trailing stroke (The Dub - slightly softer)
     localBeat = wave((localCycle - 0.12) / 0.06) * 0.7;
  }
  
  // Structural modifications:
  // Fades from pure white (sat = 0) at stroke peak, resolving down to the section hue at rest!
  var sat = 1.0 - (localBeat * 0.9);
  var bright = minBright + localBeat * (1.0 - minBright);
  
  // Apply a slight spatial vignette based on Y height to simulate organic volume
  var posMod = 1.0 - abs((y / 6.5) - 0.5) * 0.3;
  
  hsv(hue, sat, bright * posMod);
}
