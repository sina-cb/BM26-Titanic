export function beforeRender(delta) {
  t1 = time(0.08) // Speed of the moving wave
  t2 = time(0.04) // Deep slow UV glow cycle
}

export function render(index) {
  // Create a spatial moving wave
  v = wave(t1 + index / pixelCount * 2)
  
  // Create a secondary UV ambiance
  uv_glow = wave(t2 - index / pixelCount * 0.5)

  // Color mix: Deep oceanic blue + bioluminescent UV and sharp white crests
  r = 0
  g = v * 0.15          // Hint of teal
  b = v * 0.8           // Strong deep blue
  w = (v > 0.9) ? 1 : 0 // Sharp white sparkle at the absolute crest of the wave
  a = 0                 // No amber
  u = (uv_glow * 0.6) + (v * 0.4) // Intense UV that breathes

  rgbwau(r, g, b, w, a, u)
}
