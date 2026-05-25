/*
  trans_split_horizontal.js — Horizontal Split / Bay-Doors Reveal
  Opens from the horizontal centerline (y=0.5) outward — like the
  steel bay doors of a hull splitting apart. The new pattern is
  revealed at y=0.5 first and the two fronts travel toward y=0 and
  y=1 simultaneously.
  Uses transition built-ins: progress, fromR/G/B/W/A/U, toR/G/B/W/A/U
*/

export var feather = 0.08;
export function sliderFeather(v) { feather = 0.02 + v * 0.3; }

export function render(index, x, y, z) {
  // Distance from the horizontal centerline, in [0, 0.5].
  // Scale to [0, 1] so progress maps cleanly across the full range.
  var dy = abs(y - 0.5) * 2.0;
  // Edge is 1 once the opening front has passed this pixel.
  var edge = smoothstep(progress - feather, progress + feather, 1.0 - dy);
  rgbwau(
    mix(fromR, toR, edge),
    mix(fromG, toG, edge),
    mix(fromB, toB, edge),
    mix(fromW, toW, edge),
    mix(fromA, toA, edge),
    mix(fromU, toU, edge)
  );
}
