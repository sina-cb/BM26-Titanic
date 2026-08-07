// DRAFT — pending operator review
/*
  68_calibration_z_plane.js — static model-calibration utility.

  A static, sharp plane marks one normalized world-Z coordinate across the
  entire loaded model. Move Position from 0 to 1 to verify depth placement;
  pixels that join the plane at the wrong setting have incorrect model Z.

  This diagnostic intentionally has no localSpeed: it does not animate.
  Position, Width, and Background are direct manual test handles in physical
  knob order. It also intentionally opts out of the show palette: fixed blue
  (the Z-axis marker) against faint warm gold makes mapping errors immediately
  recognizable and keeps calibration results independent of palette state.
  No fixture metadata or authored views are assumed, so it is model-portable.
*/

export var position = 0.67;
export var width = 0.2;
export var background = 0.2;

export function sliderPosition(v) { position = v; }
export function sliderWidth(v) { width = v; }
export function sliderBackground(v) { background = v; }

export function render3D(index, x, y, z) {
  var halfWidth = 0.005 + width * 0.095;
  if (abs(z - position) <= halfWidth) {
    rgb(0.02, 0.24, 1.0);
  }

  var floorLevel = 0.02 + background * 0.15;
  rgb(floorLevel, floorLevel * 0.32, 0.0);
}
