/*
  trans_split_vertical.js — Vertical Split / Curtain Reveal
  Opens from the vertical centerline (x=0.5) outward — like stage
  curtains parting. The new pattern (TO) is revealed at x=0.5 first
  and the two fronts travel toward x=0 and x=1 simultaneously.

  Pixel-perfect endpoints — see trans_wipe_right.js docstring for the
  bias rationale.
  Uses transition built-ins: progress, fromR/G/B/W/A/U, toR/G/B/W/A/U
*/

export var feather = 0.08;
export function sliderFeather(v) { feather = 0.02 + v * 0.3; }

export function render(index, x, y, z) {
  var pp = abs(x - 0.5) * 2.0;
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
