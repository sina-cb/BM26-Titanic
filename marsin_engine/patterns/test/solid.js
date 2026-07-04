/*
  solid.js
  Solid color fill that breathes gently in and out: brightness rides a
  slow sine between ~60% and 100% over roughly 4.5 seconds. Test-bench
  pattern for verifying fixtures show a steady, whole-model wash.

  Uses global colorPalette1 (HSV) like test_const.js — the CPC
  auto-binds it to the global Color 1 parameter.
*/

export var colorPalette1 = 0.0;
export function sliderColorPalette1(h, s, v) { colorPalette1 = h; }

export function beforeRender(delta) {
  // time(0.07) -> ~4.6 s period; wave() -> 0..1 sine.
  // Map to 0.6..1.0 so the breath stays subtle, never dark.
  breath = 0.6 + 0.4 * wave(time(0.07))
}

export function render(index, x, y, z) {
  hsv(colorPalette1, 1.0, breath)
}
