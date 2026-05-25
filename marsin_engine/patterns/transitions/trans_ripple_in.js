/*
  trans_ripple_in.js — Concentric Ripple Reveal
  Concentric rings (Titanic stone dropped in still water) sweep
  outward from the center. Each pixel crosses through several rings
  before settling on the new pattern, giving a watery, undulating
  reveal. The ring frequency is tunable; the bias toward the new
  pattern ramps with progress so the transition still lands.
  Uses transition built-ins: progress, fromR/G/B/W/A/U, toR/G/B/W/A/U
*/

export var ringCount = 5.0;
export function sliderRings(v) { ringCount = 2.0 + v * 10.0; }

export function render(index, x, y, z) {
  var dist = hypot(x - 0.5, y - 0.5) / 0.7071;
  // Travelling sine wave in the radial direction. Argument is in
  // radians (sin is radian-based in this VM).
  // PI2 ~= 6.2831853 — VM constant.
  var phase = (dist * ringCount - progress * 2.0) * PI2;
  var ring = 0.5 + 0.5 * sin(phase);
  // Blend ring oscillation with a progress floor so we reach 1.0
  // at the end. mix(ring, 1, progress) sweeps the floor up.
  var amt = mix(ring * progress, 1.0, progress);
  amt = clamp(amt, 0.0, 1.0);
  rgbwau(
    mix(fromR, toR, amt),
    mix(fromG, toG, amt),
    mix(fromB, toB, amt),
    mix(fromW, toW, amt),
    mix(fromA, toA, amt),
    mix(fromU, toU, amt)
  );
}
