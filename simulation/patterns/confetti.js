// Confetti - Pink, Green, Blue, White
export function beforeRender(delta) {
  t1 = time(0.05)  // Controls flash speed - lower = faster
}

export function render(index) {
  // Pick a color slot (0-3) per pixel, randomized by index
  slot = (floor(t1 * 40 + index * 2.7) % 4)
  v = 1
  if (slot == 0) {
    hsv(0.92, 1, v)        // Bright pink
  } else if (slot == 1) {
    hsv(0.38, 1, v)        // Green
  } else if (slot == 2) {
    hsv(0.58, 1, v)        // Blue
  } else {
    hsv(0, 0, v)           // White
  }
}