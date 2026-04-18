export function beforeRender(delta) {
  v = wave(time(0.05))
}
export function render(index) {
  hsv(0.6, 0.3, v)
}
