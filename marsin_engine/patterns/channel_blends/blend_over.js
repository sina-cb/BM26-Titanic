/*
  blend_over.js — Alpha-Over Blend Mode
  Standard alpha compositing: to paints over from using progress as alpha.
  Uses transition built-ins: progress, fromR/G/B/W/A/U, toR/G/B/W/A/U
*/

export function render(index, x, y, z) {
  var a = progress;
  var ia = 1 - a;
  rgbwau(
    fromR * ia + toR * a,
    fromG * ia + toG * a,
    fromB * ia + toB * a,
    fromW * ia + toW * a,
    fromA * ia + toA * a,
    fromU * ia + toU * a
  );
}
