/*
  trans_iris.js — Iris / Radial Wipe Transition
  True 2D radial wipe: expands from the center (0.5, 0.5) outward.
  Pixels closer to the center are revealed first; the edge sweeps
  outward as `progress` ramps 0 -> 1. Uses radian-free Euclidean
  distance (hypot) for the radial metric.
  Uses transition built-ins: progress, fromR/G/B/W/A/U, toR/G/B/W/A/U
*/

export var feather = 0.08;
export function sliderFeather(v) { feather = 0.02 + v * 0.3; }

export function render(index, x, y, z) {
  // Radial distance from center, normalized so the corners sit at ~1.
  // hypot(0.5, 0.5) = 0.707, so dividing by 0.707 puts corners at ~1.0
  // and the center at 0. Multiplying progress by 1.0 means at p=1 the
  // edge has swept past every pixel.
  var dist = hypot(x - 0.5, y - 0.5) / 0.7071;
  // Edge = 1 when the radial sweep has passed this pixel (show `to`),
  // 0 when it hasn't (show `from`). Feathered for a smooth boundary.
  var edge = smoothstep(progress - feather, progress + feather, 1.0 - dist);
  rgbwau(
    mix(fromR, toR, edge),
    mix(fromG, toG, edge),
    mix(fromB, toB, edge),
    mix(fromW, toW, edge),
    mix(fromA, toA, edge),
    mix(fromU, toU, edge)
  );
}
