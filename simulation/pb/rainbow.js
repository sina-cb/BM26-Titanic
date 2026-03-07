export function beforeRender(delta) {
  t1 = time(0.1)
}
export function render(index) {
  hsv(t1 + index / pixelCount, 1, 1)
}
