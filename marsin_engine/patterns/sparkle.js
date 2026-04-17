/*
  RPM Sparkle — Random white sparkles on colored background
  Background color per letter (R=red, P=green, M=blue).
  Random sparkle overlay proves render is running independently per pixel.
*/

export var t1

export function beforeRender(delta) {
  t1 = time(0.01)
}

export function render3D(index, x, y, z) {
  // Background: dim letter color
  var baseHue = (sectionId - 1) / 3
  var baseBright = 0.6
  
  // Sparkle: pseudo-random per pixel per frame
  var seed = index * 73.137 + t1 * 1000
  var sparkle = sin(seed) * sin(seed * 3.7) * sin(seed * 7.3)
  sparkle = sparkle * sparkle * sparkle * sparkle // sharpen
  
  if (sparkle > 0.4) {
    // White sparkle
    var intensity = (sparkle - 0.4) * 3
    if (intensity > 1) intensity = 1
    hsv(baseHue, 1 - intensity * 0.8, baseBright + intensity * 0.9)
  } else {
    // Background glow with gentle wave
    var breath = 0.1 + 0.04 * wave(t1 * 3 + sectionId * 0.3)
    hsv(baseHue, 1, breath)
  }
}
