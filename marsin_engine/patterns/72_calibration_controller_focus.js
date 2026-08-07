// DRAFT — pending operator review
/*
  72_calibration_controller_focus.js — CALIBRATION diagnostic utility.

  Isolates one canonical controller id at full white while every other
  controller remains dimly colour-coded by id. Use it to prove controller
  membership, detect fixtures patched to the wrong box, and walk CTRL_1..18
  without changing mixer views.

  `controller` maps 0..1 onto ids 1..18. The test bench currently exposes ids
  inside that same range. A pixel with controllerId 0 is deliberately magenta,
  making missing controller metadata unmistakable.

  This is intentionally static test content, not a production show pattern:
  no motion, no localSpeed, and fixed diagnostic colours.

  CONTROLS
    - controller : focused controller id (0 = CTRL_1, 1 = CTRL_18).
    - background : brightness of non-focused controller colours.
*/

export var controller = 0.0;
export var background = 0.05;

export function sliderController(v) { controller = v; }
export function sliderBackground(v) { background = v; }

function clamp01(value) {
  if (value < 0.0) return 0.0;
  if (value > 1.0) return 1.0;
  return value;
}

export function render3D(index, x, y, z) {
  var focusId = floor(clamp01(controller) * 17.0 + 1.5);
  var backgroundLevel = clamp01(background) * 0.35;

  if (controllerId == focusId) {
    rgb(1.0, 1.0, 1.0);
  } else if (controllerId == 0) {
    rgb(1.0, 0.0, 1.0);
  } else {
    hsv(frac(controllerId * 0.618033), 1.0, backgroundLevel);
  }
}
