// DRAFT — pending operator review
/*
  calibration_x_plane.js — static model-mapping diagnostic.

  A manually positioned, hard-edged red plane cuts through the whole model on
  normalized world X. Use it to confirm that every fixture appears on the
  expected left/right coordinate and that no pixels jump to the wrong side.

  This intentionally has no motion clock and no localSpeed: sliderPosition is
  the diagnostic motion handle. sliderWidth controls the plane thickness, and
  sliderBackground keeps the rest of the model faintly visible for spotting
  missing or displaced pixels. It uses no views, fixture types, or model-sized
  state, so it is portable across titanic and test_bench.

  Palette opt-out: fixed red against dim cyan is deliberate axis-calibration
  language, not a show palette. No logical white is emitted.
*/

export var position = 0.25;
export function sliderPosition(v) { position = v; }

export var planeWidth = 0.12;
export function sliderWidth(v) { planeWidth = v; }

export var background = 0.25;
export function sliderBackground(v) { background = v; }

export function render3D(index, x, y, z) {
  var halfWidth = 0.006 + planeWidth * 0.094;
  var axisDistance = abs(x - position);
  var floorLevel = 0.01 + background * 0.15;

  if (axisDistance <= halfWidth) {
    rgb(1.0, 0.08, 0.01);
  } else {
    rgb(0.0, floorLevel * 0.45, floorLevel);
  }
}
