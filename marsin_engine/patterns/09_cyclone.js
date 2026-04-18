/*
  09_cyclone.js
  Confetti Cyclone
  Fragmented pixels flowing rapidly upwards in a spiral, like blown confetti.
*/

export var speed = 0.6;
export var density = 30;
export var particleSize = 0.5;
export var hue1 = 0.0; // Red
export var hue2 = 0.33; // Green

export function sliderSpeed(v) { speed = v * 1.5; }
export function sliderDensity(v) { density = 5.0 + v * 50.0; }
export function sliderParticleSize(v) { particleSize = 0.1 + v * 0.8; }
export function hsvPickerColorA(h,s,v) { hue1 = h; }
export function hsvPickerColorB(h,s,v) { hue2 = h; }

var t1;
export function beforeRender(delta) {
  t1 = time(speed);
}

export function render(index) {
  var pct = index / (pixelCount > 0 ? pixelCount : 144);

  // Upward spiral motion (sawtooth wave 0->1)
  var pos = (t1 * density - pct * density) % 1.0;
  if (pos < 0.0) pos += 1.0;

  // Dynamic Array mapping based on index modulo to force sharp fragmentation!
  var colorIdx = index % 3;
  var h = hue1;
  var s = 1.0;

  if (colorIdx == 1) {
     h = hue2;
  } else if (colorIdx == 2) {
     // A bridging harmonic tone slightly desaturated for richness
     h = (hue1 + hue2) / 2.0; 
     s = 0.8;
  }

  var v = 0.1; // Default ambient background

  // DRAW CONFETTI PARTICLE
  if (pos < particleSize) {
      // Brightness fades cleanly from head to tail
      var particleB = 1.0 - (pos / particleSize);
      particleB = particleB * particleB; // Quad decay for sharp heads
      v = max(v, particleB);
  }

  // ADD THE SMOOTH SPARKLE OVERLAY (extra glitz on top)
  var starTimer = (index * 23.3) + time(0.3);
  var star = pow(triangle(starTimer), 20.0);

  if (star > 0.1) {
      var sparkleB = star * 0.5;
      if (sparkleB > v) { // Force overlay
          h = (hue1 + hue2) / 2.0; 
          s = 0.3; 
          v = sparkleB;
      }
  }

  hsv(h, s, v);
}
