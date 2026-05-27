/*
  trans_iris_close.js — Iris Close (radial collapse inward)
  Inverse of trans_iris: the outgoing pattern (FROM) collapses inward
  toward the center (0.5, 0.5), revealing the new pattern (TO) from
  the corners in. Pixels at the corners see TO first; the center is
  the last to switch.

  Pixel-perfect endpoints — see trans_wipe_right.js docstring for the
  bias rationale.
  Uses transition built-ins: progress, fromR/G/B/W/A/U, toR/G/B/W/A/U
*/

export var feather = 0.08;
export function sliderFeather(v) { feather = 0.02 + v * 0.3; }

export function render(index, x, y, z) {
  // Distance from center, normalized to [0, 1]. Corners reveal first
  // (high distance, low pp); center reveals last (pp=1).
  // So pp = 1 - dist.
  var dist = hypot(x - 0.5, y - 0.5) / 0.7071;
  var pp = 1.0 - dist;
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
