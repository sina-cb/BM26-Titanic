/*
  trans_wipe_down.js — Vertical Wipe (reveal sweeps from y=1 downward)
  Spatial wipe across y axis with feathered edge: the new pattern is
  uncovered starting at y=1 (the "top" in our coord system) and the
  boundary travels toward y=0 as `progress` ramps 0 -> 1.

  Pixel-perfect endpoints — see trans_wipe_right.js docstring for the
  bias rationale.
  Uses transition built-ins: progress, fromR/G/B/W/A/U, toR/G/B/W/A/U
*/

export var feather = 0.08;
export function sliderFeather(v) { feather = 0.02 + v * 0.3; }

export function render(index, x, y, z) {
  // Top (y=1) reveals first → pp = 1 - y.
  var pp = 1.0 - y;
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
