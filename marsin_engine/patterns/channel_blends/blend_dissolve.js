/*
  blend_dissolve.js — Random Pixel Dissolve Transition
  Each pixel crossfades at a unique random threshold,
  creating a cinematic dissolve between the two patterns.
  Uses transition built-ins: progress, fromR/G/B/W/A/U, toR/G/B/W/A/U
*/

export var grain = 0.15;
export function sliderGrain(v) { grain = 0.02 + v * 0.4; }

export function render(index, x, y, z) {
  var threshold = random(1);
  var t = clamp((progress - threshold + grain) / (grain * 2), 0, 1);
  rgbwau(
    mix(fromR, toR, t),
    mix(fromG, toG, t),
    mix(fromB, toB, t),
    mix(fromW, toW, t),
    mix(fromA, toA, t),
    mix(fromU, toU, t)
  );
}
