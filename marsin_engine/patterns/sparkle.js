export function beforeRender(delta) {
  t1 = time(0.01)
}
export function render(index) {
  v = random(1)
  v = pow(v, 10)
  hsv(t1, 0.5, v)
}
