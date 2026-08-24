/*
  DRAFT — pending operator review.

  24_constellation_drift.js — "Constellation Drift" [WHITE DAY]

  CONCEPT: thin drifting coordinate lines meet only occasionally, forming
  bright star-nodes distributed across the entire ship.
  INSTRUMENTS: all five instruments equally participate.
  MOTION: two line families drift at phi and sqrt(3) ratios without relocking.
  SHOW HOME: sparse daylight geometry, calm in silence.
  CONTROLS: localSpeed — drift rate; density — line count; width — node size;
  twinkle — node punch; level — overall output ceiling.
*/

export var localSpeed = 0.20;
export var density = 0.32;
export var width = 0.18;
export var twinkle = 0.84;
export var level = 0.74;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderDensity(v) { density = v; }
export function sliderWidth(v) { width = v; }
export function sliderTwinkle(v) { twinkle = v; }
export function sliderLevel(v) { level = v; }

// ── WHITE AUTHORITY (white_only family block — byte-identical across
//    patterns/white_only/*; hash-gated by white_only_contract.test.js) ──
// The family renders WHITE ONLY, as grayscale intensity art:
//   zero chroma (R = G = B exactly, every pixel, every frame); native white
//   W = A matched; UV = 0 always; and NO colorPalette exports, so the family
//   is untintable by design (house convention from patterns/60_white_wash.js).
var WHITE_RGB_SHARE = 0.88;
var WHITE_NATIVE_SHARE = 0.62;
function clamp01(v) {
  if (v < 0.0) return 0.0;
  if (v > 1.0) return 1.0;
  return v;
}
function smooth01(v) {
  var sv = clamp01(v);
  return sv * sv * (3.0 - 2.0 * sv);
}
function emitWhite(level, nativeShare) {
  var lit = clamp01(level);
  var rgb = lit * WHITE_RGB_SHARE;
  var nat = clamp01(lit * WHITE_NATIVE_SHARE * clamp01(nativeShare));
  rgbwau(rgb, rgb, rgb, nat, nat, 0.0);
}
// ── end WHITE AUTHORITY ──

var PHASE_WRAP = 4096.0;
var lineClockA = 0.0;
var lineClockB = 317.0;
var liveDensity = 0.32;
var liveWidth = 0.18;
var liveTwinkle = 0.84;
var liveLevel = 0.74;

export function beforeRender(delta) {
  var dt = clamp01(delta / 100.0) * 0.1;
  var speedScale = 0.35 + clamp01(localSpeed) * 1.65;
  var follow = min(1.0, dt * 7.0);
  liveDensity += (clamp01(density) - liveDensity) * follow;
  liveWidth += (clamp01(width) - liveWidth) * follow;
  liveTwinkle += (clamp01(twinkle) - liveTwinkle) * follow;
  liveLevel += (clamp01(level) - liveLevel) * follow;

  lineClockA += dt * 0.019 * speedScale;
  lineClockB += dt * 0.03290897 * speedScale;
  if (lineClockA >= PHASE_WRAP) lineClockA -= PHASE_WRAP;
  if (lineClockB >= PHASE_WRAP) lineClockB -= PHASE_WRAP;
}

export function render3D(index, x, y, z) {
  var lines = 3.0 + liveDensity * 9.0;
  var waveA = wave(x * lines + y * 1.61803399 + z * 0.37 + lineClockA);
  var waveB = wave(z * (lines * 0.73) - y * 1.73205081 + x * 0.29
                   - lineClockB);
  var distanceA = abs(waveA - 0.50) * 2.0;
  var distanceB = abs(waveB - 0.50) * 2.0;
  var lineWidth = 0.024 + liveWidth * 0.070;
  var lineA = 1.0 - smoothstep(lineWidth, lineWidth * 3.0, distanceA);
  var lineB = 1.0 - smoothstep(lineWidth, lineWidth * 3.0, distanceB);
  var node = lineA * lineB;

  var star = wave(index * 0.38196601 + lineClockA * 0.73
                  - lineClockB * 0.41);
  star = 0.60 + pow(star, 5.0) * (0.15 + liveTwinkle * 0.65);
  var lvl = node * star * (0.35 + liveLevel * 0.86) * 2.25;
  emitWhite(lvl, 0.20 + node * 0.80);
}
