export function beforeRender(delta) {
  t1 = time(0.1)
  t2 = time(0.13)
}
export function render2D(index, x, y) {
  v1 = wave(x * 3 + t1)
  v2 = wave(y * 3 + t2)
  v3 = wave(hypot(x - 0.5, y - 0.5) * 4 - t1)
  v = (v1 + v2 + v3) / 3
  hsv(v + t1, 1, v)
}
