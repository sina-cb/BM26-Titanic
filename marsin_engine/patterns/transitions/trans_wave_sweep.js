/*
  trans_wave_sweep.js — Sinusoidal Wave-Front Sweep (left -> right)
  Like trans_wipe_right but the leading edge is a sine wave instead
  of a straight vertical line — evokes a tide rolling across the hull.
  Wave amplitude is gated by an envelope that goes to 0 at progress=0
  and progress=1, so the wavy edge is purely cosmetic and never lets
  pixels leak TO before the transition starts.

  Pixel-perfect endpoints — same bias trick as trans_wipe_right, plus
  the envelope ensures `disp = 0` at p=0 and p=1 so the wavefront
  collapses to a flat vertical line at the endpoints.
  Uses transition built-ins: progress, fromR/G/B/W/A/U, toR/G/B/W/A/U
*/

export var feather = 0.08;
export var waveFreq = 3.0;
export var waveAmp = 0.15;
export function sliderFeather(v) { feather = 0.02 + v * 0.3; }
export function sliderWaveFreq(v) { waveFreq = 1.0 + v * 8.0; }
export function sliderWaveAmp(v)  { waveAmp = v * 0.4; }

export function render(index, x, y, z) {
  // Per-pixel reveal threshold: leftmost pixels (x=0) want pp=0
  // (reveal first). The wave displacement perturbs pp along y so the
  // leading edge becomes wavy. env is 0 at both endpoints so disp
  // vanishes there — pp collapses to x and the endpoint behavior
  // matches a straight wipe_right.
  var env = 4.0 * progress * (1.0 - progress);
  var disp = sin(y * waveFreq * PI2) * waveAmp * env;
  var pp = x - disp;
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
