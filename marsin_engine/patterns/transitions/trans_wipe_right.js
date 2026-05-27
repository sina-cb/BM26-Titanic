/*
  trans_wipe_right.js — Horizontal Wipe (TO is revealed left -> right)
  Spatial wipe across x axis with feathered edge. The new pattern (TO)
  appears first at x=0 and the boundary travels rightward as `progress`
  ramps 0 -> 1.

  Pixel-perfect endpoints (the "pixel-perfect" contract for every
  feathered wipe in this directory):
    - At progress=0, every pixel reads FROM exactly (no feather bleed).
    - At progress=1, every pixel reads TO   exactly.
  Achieved by biasing progress to `ep ∈ [-feather, 1+feather]` so the
  full smoothstep window stays outside the [0,1] per-pixel `pp` domain
  at endpoints. Without the bias, at p=0 the window [p-f, p+f] = [-f, f]
  overlaps the pixel `pp` range and pixels near the leading edge
  half-blend to TO — i.e. the transition is already partially complete
  at "0%". Same artifact, mirrored, at p=1.

  Uses transition built-ins: progress, fromR/G/B/W/A/U, toR/G/B/W/A/U
*/

export var feather = 0.08;
export function sliderFeather(v) { feather = 0.02 + v * 0.3; }

export function render(index, x, y, z) {
  // pp = "this pixel reveals when progress crosses pp". For wipe_right
  // the leftmost pixel (x=0) reveals first, so pp = x.
  var pp = x;
  // Bias progress to [-feather, 1+feather] so endpoints clamp cleanly.
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
