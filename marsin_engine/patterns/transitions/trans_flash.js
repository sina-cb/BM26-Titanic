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
    var amt = progress * 2;
    amt = pow(amt, 0.5);
    rgbwau(
      mix(fromR, fR, amt),
      mix(fromG, fG, amt),
      mix(fromB, fB, amt),
      mix(fromW, 1, amt),
      fromA * (1 - amt),
      fromU * (1 - amt)
    );
  } else {
    // Second half: flash white → to pattern
    var amt = (progress - 0.5) * 2;
    amt = pow(amt, 2);
    rgbwau(
      mix(fR, toR, amt),
      mix(fG, toG, amt),
      mix(fB, toB, amt),
      mix(1, toW, amt),
      toA * amt,
      toU * amt
    );
  }
}
