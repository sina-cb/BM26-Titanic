export function beforeRender(delta) {
  // Move 1 pixel every 100ms
  // time(0.1) cycles 0..1 every 6.5 seconds.
  // We want to reliably increment cleanly.
  // Using time() with a low value works.
  pos = floor(time(0.08) * pixelCount)
}

export function render(index) {
  if (index == pos) {
    // Current pixel is full white
    hsv(0, 0, 1)
  } else {
    // Off
    hsv(0, 0, 0)
  }
}
