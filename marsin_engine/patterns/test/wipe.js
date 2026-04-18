export function beforeRender(delta) {
  pos = wave(time(0.05)) * pixelCount
}
export function render(index) {
  d = abs(index - pos)
  v = clamp(1 - d / 5, 0, 1)
  v = v * v
  hsv(0.6, 1, v)
}
