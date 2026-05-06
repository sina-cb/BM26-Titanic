/*
  test_const.js
  Single constant color using global colorPalette1 (HSV).
  The CPC auto-binds this to the global Color 1 parameter.
*/

export var colorPalette1 = 0.0;
export function sliderColorPalette1(h, s, v) { colorPalette1 = h; }

export function render(index, x, y, z) {
  hsv(colorPalette1, 1.0, 1.0);
}
