/*
  blend_flash.js — Flash/Burn Transition
  Blasts to white then reveals the incoming pattern.
  First half: from → white. Second half: white → to.
  Uses transition built-ins: progress, fromR/G/B/W/A/U, toR/G/B/W/A/U
*/

export var flashHue = 0.0;
export var flashSat = 0.0;
export function hsvPickerFlash(h, s, v) { flashHue = h; flashSat = s; }

export function render(index, x, y, z) {
  // Convert flash color from HSV to approximate RGB
  var fR = 1;
  var fG = 1;
  var fB = 1;

  if (progress < 0.5) {
    // First half: from pattern → flash white
    var t = progress * 2;
    t = pow(t, 0.5);
    rgbwau(
      mix(fromR, fR, t),
      mix(fromG, fG, t),
      mix(fromB, fB, t),
      mix(fromW, 1, t),
      fromA * (1 - t),
      fromU * (1 - t)
    );
  } else {
    // Second half: flash white → to pattern
    var t = (progress - 0.5) * 2;
    t = pow(t, 2);
    rgbwau(
      mix(fR, toR, t),
      mix(fG, toG, t),
      mix(fB, toB, t),
      mix(1, toW, t),
      toA * t,
      toU * t
    );
  }
}
