/*
  trans_split_horizontal.js — Horizontal Split / Bay-Doors Reveal
  Opens from the horizontal centerline (y=0.5) outward — like the
  steel bay doors of a hull splitting apart. The new pattern (TO)
  is revealed at y=0.5 first and the two fronts travel toward y=0
  and y=1 simultaneously.

  Pixel-perfect endpoints — see trans_wipe_right.js docstring for the
  bias rationale.
  Uses transition built-ins: progress, fromR/G/B/W/A/U, toR/G/B/W/A/U
*/

export var feather = 0.08;
export function sliderFeather(v) { feather = 0.02 + v * 0.3; }

export function render(index, x, y, z) {
  // Centerline (y=0.5) reveals first → pp = distance from centerline.
  // abs(y-0.5) ∈ [0, 0.5] so we *2 to put pp ∈ [0, 1].
  var pp = abs(y - 0.5) * 2.0;
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
