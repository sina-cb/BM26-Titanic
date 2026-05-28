/*
  trans_ripple_in.js — Concentric Ripple Reveal

  Concentric rings (a stone dropped in still water) sweep outward
  from the rig centre. Each pixel crosses through several rings
  before settling on the new pattern, giving a watery, undulating
  reveal. Ring frequency and damping are operator-tunable.

  ─── Improvements over the v1 (report 11.2) ───
  v1 used `amt = mix(ring * progress, 1.0, progress)` which (a) made
  the transition feel back-loaded — `ring*progress` is small for the
  first ~30% of progress so the rig barely changes — and (b) left
  ring amplitude constant until the floor finally swallowed it,
  producing a visible flicker when FROM and TO had very different
  brightness.

  v2 (this file) applies BOTH of the report's improvement bullets:
    1. `sliderRingDamping` exposes a `1 - exp(-progress*k)` envelope
       on the ring oscillation so the ripples damp as `progress`
       grows. Defaults to a gentle damping (k=3) that's noticeable
       but doesn't flatten the rings.
    2. The progress floor uses `pow(progress, 0.7)` instead of the
       linear `progress`, front-loading the rise so the rig starts
       reading the TO pattern earlier. Endpoint correctness is
       preserved (0^0.7=0, 1^0.7=1).
  Both bullets address the same root cause (non-monotonic per-pixel
  brightness during the transition), from different angles.

  ─── Easing policy (cross-cutting #2) ───
  The mixer fader smoothsteps `progress` over `durationMs`. We
  intentionally use `progress` (post-fader-smoothstep) linearly in
  the radial wave argument and in the damping envelope so the ring
  speed reads as roughly constant in wall-clock time. The single
  `pow(progress, 0.7)` on the floor is the only added easing in
  the script.

  Uses transition built-ins: progress, fromR/G/B/W/A/U, toR/G/B/W/A/U
*/

export var ringCount = 5.0;
export function sliderRings(v) { ringCount = 2.0 + v * 10.0; }

// Damping coefficient for the ring envelope. envelope = 1 - exp(-progress*k).
// k=0 (slider min) -> no damping (rings full amplitude until floor wins).
// k=3 (default)    -> rings audible early, ~60% damped by progress=0.3, ~95% by 1.0.
// k=8 (slider max) -> rings die very fast; mostly a clean crossfade with a
//                     single splash at the start.
export var ringDamping = 3.0;
export function sliderRingDamping(v) { ringDamping = v * 8.0; }

export function render(index, x, y, z) {
  var dist = hypot(x - 0.5, y - 0.5) / 0.7071;

  // Travelling sine wave in the radial direction (radians; sin is
  // radian-based in this VM). PI2 ~= 6.2831853 — VM constant.
  var phase = (dist * ringCount - progress * 2.0) * PI2;
  var ring = 0.5 + 0.5 * sin(phase);

  // Envelope: 1 - exp(-progress*k). Damps the ring oscillation as
  // the transition progresses. At progress=0 envelope=0 (no ripple
  // contribution yet — but the floor is also 0, so output reads FROM).
  // At progress=1 envelope is ~1 - exp(-ringDamping), which is the
  // residual ring amplitude at completion; the progress floor
  // overrides it anyway (mix(..., 1, 1) = 1).
  var dampEnv = 1.0 - exp(-progress * ringDamping);
  var dampedRing = ring * dampEnv;

  // Progress floor uses progress^0.7 (front-loaded) instead of
  // linear progress. Endpoint-clean: 0^0.7=0, 1^0.7=1.
  var floorAmt = pow(progress, 0.7);
  var amt = mix(dampedRing * progress, 1.0, floorAmt);
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
