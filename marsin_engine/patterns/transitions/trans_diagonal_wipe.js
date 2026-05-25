/*
  trans_diagonal_wipe.js — Diagonal Wipe (bottom-left -> top-right)
  Spatial wipe whose edge runs perpendicular to the (1,1) diagonal,
  so the new pattern is revealed starting at the bottom-left corner
  and the front sweeps to the top-right.
  Uses transition built-ins: progress, fromR/G/B/W/A/U, toR/G/B/W/A/U
*/

export var feather = 0.1;
export function sliderFeather(v) { feather = 0.02 + v * 0.4; }

export function render(index, x, y, z) {
  // Diagonal coordinate normalized to [0, 1]: low at bottom-left
  // (x=0, y=0) -> 0, high at top-right (x=1, y=1) -> 1.
  var diag = (x + y) * 0.5;
  // Edge is 1 once the diagonal front has passed this pixel.
  var edge = smoothstep(progress - feather, progress + feather, 1.0 - diag);
  // Flip so low diag pixels (bottom-left) flip to `to` first.
  edge = 1.0 - edge;
  rgbwau(
    mix(fromR, toR, edge),
    mix(fromG, toG, edge),
    mix(fromB, toB, edge),
    mix(fromW, toW, edge),
    mix(fromA, toA, edge),
    mix(fromU, toU, edge)
  );
}
