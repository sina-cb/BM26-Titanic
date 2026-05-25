/*
  trans_iris.js — Iris / Radial Wipe (expands from center outward)
  True 2D radial wipe: the iris of TO expands from the center (0.5, 0.5)
  outward. Pixels closer to the center are revealed first; the leading
  edge sweeps outward as `progress` ramps 0 -> 1.

  Pixel-perfect endpoints — see trans_wipe_right.js docstring for the
  bias rationale.
  Uses transition built-ins: progress, fromR/G/B/W/A/U, toR/G/B/W/A/U
*/

export var feather = 0.08;
export function sliderFeather(v) { feather = 0.02 + v * 0.3; }

export function render(index, x, y, z) {
  // Normalized radial distance: 0 at center, ~1 at the corners.
  // hypot(0.5, 0.5) = 0.7071 puts the corner radius at 1.0 exactly.
  var pp = hypot(x - 0.5, y - 0.5) / 0.7071;
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
