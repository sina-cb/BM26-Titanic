export function beforeRender(delta) {
  t1 = time(0.08)
}
export function render2D(index, x, y) {
  n = perlinFbm(x * 3, y * 3 - t1 * 5, 0, 2, 0.5, 4)
  n = n * (1 - y)
  hsv(n * 0.1, 1, n * n)
}
