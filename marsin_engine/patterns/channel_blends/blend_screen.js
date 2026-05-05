/*
  blend_screen.js — Screen Blend Mode
  Composites using: 1 - (1-from)(1-to), faded by progress.
  Prevents hard clipping for luminous patterns.
  Uses transition built-ins: progress, fromR/G/B/W/A/U, toR/G/B/W/A/U
*/

function screenCh(base, top) {
  return 1 - (1 - base) * (1 - top);
}

function apply(base, top) {
  return mix(base, screenCh(base, top), progress);
}

export function render(index, x, y, z) {
  rgbwau(
    apply(fromR, toR),
    apply(fromG, toG),
    apply(fromB, toB),
    apply(fromW, toW),
    apply(fromA, toA),
    apply(fromU, toU)
  );
}
