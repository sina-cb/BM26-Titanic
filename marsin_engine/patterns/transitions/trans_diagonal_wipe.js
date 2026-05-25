/*
  trans_diagonal_wipe.js — Diagonal Wipe (bottom-left -> top-right)
  Spatial wipe whose edge runs perpendicular to the (1,1) diagonal,
  so the new pattern (TO) is revealed starting at the bottom-left
  corner and the front sweeps to the top-right.

  Pixel-perfect endpoints — see trans_wipe_right.js docstring for the
  bias rationale.
  Uses transition built-ins: progress, fromR/G/B/W/A/U, toR/G/B/W/A/U
*/

export var feather = 0.1;
export function sliderFeather(v) { feather = 0.02 + v * 0.4; }

export function render(index, x, y, z) {
  // Diagonal coord: 0 at bottom-left (x=0,y=0), 1 at top-right (x=1,y=1).
  // pp = diag so the bottom-left reveals first.
  var pp = (x + y) * 0.5;
  var ep = progress * (1.0 + 2.0 * feather) - feather;
  var edge = smoothstep(pp - feather, pp + feather, ep);
  rgbwau(
    mix(fromR, toR, edge),
    mix(fromG, toG, edge),
    mix(fromB, toB, edge),
    mix(fromW, toW, edge),
    mix(fromA, toA, edge),
    mix(fromU, toU, edge)
  );
}
