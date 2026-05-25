/*
  trans_dissolve.js — Random Pixel Dissolve Transition
  Each pixel crossfades at a unique deterministic threshold so the
  reveal is granular (per-pixel "dissolve"), not a smooth global lerp.
  At any progress in (0, 1) some pixels have already flipped to TO,
  some are still FROM, and a feather-width slice is mid-crossfade.

  Why we don't use `random()`:
    The VM's `random(n)` returns a single value per call — the SAME
    value across every pixel within one render frame (it advances the
    VM-wide PRNG between calls, not per-pixel). That degenerates the
    dissolve into a uniform crossfade. We instead derive a stable
    per-pixel `th` from the pixel `index` using a sin/fract hash
    (same idiom as 13_sparkle.js).

  Why `th` and `raw` instead of `threshold` and `random`:
    The MarsinScript VM's symbol table treats certain identifiers
    (notably `threshold`, `random`, `t`) as reserved or special. Using
    `var threshold` silently desyncs the value between read and write
    sites — at progress=0.5 every pixel ends up looking mid-faded
    instead of binary. Short variable names sidestep the collision.

  Pixel-perfect endpoints:
    - At progress=0, amt < 0 for every th ∈ [0,1] → clamp to 0
      → output = FROM.
    - At progress=1, amt > 1 for every th ∈ [0,1] → clamp to 1
      → output = TO.
  Achieved by mapping progress into the slightly-widened domain
  [-grain, 1+grain] so the amt formula reaches both ends cleanly.

  Uses transition built-ins: progress, fromR/G/B/W/A/U, toR/G/B/W/A/U
*/

// `grain` controls the per-pixel crossfade window width. Smaller =
// more pixels read as fully A or fully B at any given progress (looks
// more like a TV-static dissolve); larger = wider mid-fade band (looks
// closer to a gauzy crossfade with sparkle). Default chosen so the
// dissolve visibly reads as per-pixel binary, not as an averaged blend
// (hil_transition_visual_test.mjs §TEST 3 expects >=70% binary pixels).
//
// Why no `export function sliderGrain`: the WASM VM treats any
// `export function slider<Name>(v)` as a UI control and invokes it at
// compile/init with v=0.5 — which would silently overwrite our default
// (sliderGrain(0.5) sets grain = 0.02 + 0.5*0.4 = 0.22, three times the
// intended width). Transitions don't get channel-wired by CPC anyway,
// so the export was dead weight; we keep the setter as a private fn so
// a future "transition param" engine API can call it via setControl
// without changing the source.
export var grain = 0.08;
function _setGrain(v) { grain = 0.02 + v * 0.4; }

export function render(index, x, y, z) {
  // Deterministic per-pixel hash → th in [0, 1].
  // Adapted from the classic GLSL one-liner `fract(sin(seed) * 43758)`,
  // which is uncorrelated enough at adjacent integer indices to look
  // like noise to the eye. MarsinScript has no fract(); use raw -
  // floor(raw), then guard against negative residue from sin's range.
  var seed = index * 12.9898 + 78.233;
  var raw = sin(seed) * 43758.5453;
  var th = raw - floor(raw);
  if (th < 0) th = th + 1.0;

  // Bias progress to [-grain, 1+grain] so amt cleanly hits 0 / 1
  // at the endpoints regardless of th.
  var ep = progress * (1.0 + 2.0 * grain) - grain;
  var amt = clamp((ep - th + grain) / (grain * 2.0), 0.0, 1.0);
  rgbwau(
    mix(fromR, toR, amt),
    mix(fromG, toG, amt),
    mix(fromB, toB, amt),
    mix(fromW, toW, amt),
    mix(fromA, toA, amt),
    mix(fromU, toU, amt)
  );
}
