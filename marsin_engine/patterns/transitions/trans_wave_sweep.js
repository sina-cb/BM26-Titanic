/*
  trans_wave_sweep.js — Sinusoidal Wave-Front Sweep (left -> right)
  Like trans_wipe_right but the leading edge is a sine wave instead
  of a straight vertical line — evokes a tide rolling across the hull.
  Wave amplitude shrinks as progress nears 0 or 1 so start/end remain
  clean. Frequency is tunable.
  Uses transition built-ins: progress, fromR/G/B/W/A/U, toR/G/B/W/A/U
*/

export var feather = 0.08;
export var waveFreq = 3.0;
export var waveAmp = 0.15;
export function sliderFeather(v) { feather = 0.02 + v * 0.3; }
export function sliderWaveFreq(v) { waveFreq = 1.0 + v * 8.0; }
export function sliderWaveAmp(v)  { waveAmp = v * 0.4; }

export function render(index, x, y, z) {
  // Amplitude envelope: zero at the endpoints, max near the middle,
  // so the wavy edge never juts past the [0,1] band at t=0 or t=1.
  var env = 4.0 * progress * (1.0 - progress);
  // Sine displacement along y. PI2 is the VM's 2*pi constant; sin
  // is radian-based, so multiply phase by PI2 to get y in [0,1] to
  // map across `waveFreq` full cycles.
  var disp = sin(y * waveFreq * PI2) * waveAmp * env;
  var edgePos = progress + disp;
  var edge = 1.0 - smoothstep(edgePos - feather, edgePos + feather, x);
  rgbwau(
    mix(fromR, toR, edge),
    mix(fromG, toG, edge),
    mix(fromB, toB, edge),
    mix(fromW, toW, edge),
    mix(fromA, toA, edge),
    mix(fromU, toU, edge)
  );
}
