/*
  test_dualband.js
  Dual band pattern using global colorPalette1 and colorPalette2 (HSV).
  The CPC auto-binds these to the global Color 1 and Color 2 parameters.
*/

export var colorPalette1 = 0.0;
export function sliderColorPalette1(h, s, v) { colorPalette1 = h; }

export var colorPalette2 = 0.5;
export function sliderColorPalette2(h, s, v) { colorPalette2 = h; }

export function render(index, x, y, z) {
  if (index % 20 < 10) {
    hsv(colorPalette1, 1.0, 1.0);
  } else {
    hsv(colorPalette2, 1.0, 1.0);
  }
}
