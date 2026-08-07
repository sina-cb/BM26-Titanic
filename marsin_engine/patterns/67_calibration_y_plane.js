// DRAFT — pending operator review
/*
  67_calibration_y_plane.js — static model-calibration utility.

  A sharp plane marks an operator-selected normalized world Y coordinate on
  every mapped pixel. The whole model carries it; there are deliberately no
  fixture, section, or view assumptions, so the same diagnostic is useful on
  titanic, test_bench, and future scenes.

  This diagnostic intentionally opts out of the show palette: bright green is
  the conventional Y-axis marker, while a faint magenta background keeps every
  mapped pixel visible and makes the selected plane unmistakable. It is a
  manual utility, not a production show pattern, so it has no motion and no
  localSpeed control.
*/

export var position = 0.25;
export function sliderPosition(v) { position = v; }

export var width = 0.25;
export function sliderWidth(v) { width = v; }

export var background = 0.2;
export function sliderBackground(v) { background = v; }

export function render3D(index, x, y, z) {
  var halfWidth = 0.005 + width * 0.145;
  var floorLevel = 0.012 + background * 0.148;

  if (abs(y - position) <= halfWidth) {
    rgb(0.0, 1.0, 0.0);
  } else {
    rgb(floorLevel, 0.0, floorLevel);
  }
}
