export function beforeRender(delta) {
  pos = floor(time(0.08) * pixelCount)
}

export function render(index) {
  if (index == pos) {
    // Red channel map test
    rgb(1, 0, 0)
  } else if (index == (pos - 1 + pixelCount) % pixelCount) {
    // Green channel map test
    rgb(0, 1, 0)
  } else if (index == (pos - 2 + pixelCount) % pixelCount) {
    // Blue channel map test
    rgb(0, 0, 1)
  } else {
    rgb(0, 0, 0)
  }
}
