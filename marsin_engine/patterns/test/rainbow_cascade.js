/*
  RPM Rainbow Cascade — Continuous rainbow flowing across all letters
  The rainbow spans the full x-axis (0→1) so each letter gets
  a different slice. Proves global coordinate mapping is correct.
*/

export var speed = 1.0;
export var smoothness = 1.0;
export var t1

export function beforeRender(delta) {
  t1 = time(0.02 * speed)
}

export function render3D(index, x, y, z) {
  // Rainbow based on global x position + time
  var hue = (x / max(0.1, smoothness)) + t1
  
  // Add vertical wave for depth
  var wave_y = sin(y * 6.28 + t1 * 12) * 0.1
  hue = hue + wave_y
  
  // Brightness based on a rolling wave across x
  var bright = 0.3 + 0.7 * wave(x - t1 * 2)
  
  // Subtle pulse per letter
  var letterPulse = 1.0 - 0.15 * sin(sectionId * 2.1 + t1 * 20)
  
  hsv(hue, 0.9, bright * letterPulse)
}