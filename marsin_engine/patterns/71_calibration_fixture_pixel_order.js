// DRAFT — pending operator review
/*
  71_calibration_fixture_pixel_order.js — CALIBRATION diagnostic utility.

  Selects one pixelLocalIndex across every fixture. The selected pixel is
  white, its immediately previous neighbour is red, and its next neighbour is
  green. This exposes reversed fixtures, swapped heads, broken local ordering,
  and partial strand/bar mappings. All other pixels retain a dim blue floor.

  `position` spans local indices 0..73, covering the Titanic's 74-pixel sign
  panels. Shorter fixtures correctly show only the background when the selected
  index lies beyond their physical length.

  This is intentionally static test content, not a production show pattern:
  no motion, no localSpeed, and fixed diagnostic colours.

  CONTROLS
    - position   : selected local pixel index, 0 -> index 0, 1 -> index 73.
    - background : blue visibility floor for unselected pixels.
*/

export var position = 0.0;
export var background = 0.03;

export function sliderPosition(v) { position = v; }
export function sliderBackground(v) { background = v; }

function clamp01(value) {
  if (value < 0.0) return 0.0;
  if (value > 1.0) return 1.0;
  return value;
}

export function render3D(index, x, y, z) {
  var targetIndex = floor(clamp01(position) * 73.999);
  var backgroundLevel = clamp01(background) * 0.25;

  if (pixelLocalIndex == targetIndex) {
    rgb(1.0, 1.0, 1.0);
  } else if (pixelLocalIndex == targetIndex - 1) {
    rgb(1.0, 0.0, 0.0);
  } else if (pixelLocalIndex == targetIndex + 1) {
    rgb(0.0, 1.0, 0.0);
  } else {
    rgb(0.0, 0.0, backgroundLevel);
  }
}
