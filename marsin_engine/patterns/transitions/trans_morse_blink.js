/*
  trans_morse_blink.js — Morse SOS Blink Reveal
  The from-pattern dims and the new pattern flashes in through a
  three-pulse SOS-style staccato (three short bursts) before settling
  on the new pattern. A wink to the Titanic's distress signal, used
  sparingly because it's visually intense.

  Timeline (in `progress` space):
    [0.00 .. 0.70] — three short bursts of `to` overlaid on `from`,
                     each burst a smoothstep up/down lasting ~0.07
                     progress units; gaps between bursts are dark.
    [0.70 .. 1.00] — final smooth crossfade from `from` to `to`.

  Uses transition built-ins: progress, fromR/G/B/W/A/U, toR/G/B/W/A/U
*/

// Burst pulse: returns 0..1, smooth ramp up then back down across width.
function _pulse(p, center, halfWidth) {
  var d = abs(p - center);
  // Inside the half-width: smoothstep from edge to center.
  return 1.0 - smoothstep(0.0, halfWidth, d);
}

export function render(index, x, y, z) {
  var burst;
  if (progress < 0.70) {
    var p1 = _pulse(progress, 0.10, 0.05);
    var p2 = _pulse(progress, 0.30, 0.05);
    var p3 = _pulse(progress, 0.50, 0.05);
    // max of the three pulses — only one is "on" at a time.
    burst = max(p1, max(p2, p3));
    rgbwau(
      mix(fromR, toR, burst),
      mix(fromG, toG, burst),
      mix(fromB, toB, burst),
      mix(fromW, toW, burst),
      mix(fromA, toA, burst),
      mix(fromU, toU, burst)
    );
  } else {
    // Final crossfade: map progress [0.70 .. 1.00] -> [0 .. 1] with smoothstep.
    // (Note: `t` is reserved in the MarsinScript VM — use `amt`.)
    var amt = (progress - 0.70) / 0.30;
    amt = smoothstep(0.0, 1.0, amt);
    rgbwau(
      mix(fromR, toR, amt),
      mix(fromG, toG, amt),
      mix(fromB, toB, amt),
      mix(fromW, toW, amt),
      mix(fromA, toA, amt),
      mix(fromU, toU, amt)
    );
  }
}
