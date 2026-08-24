/*
  DRAFT — pending operator review.

  22_porthole_wink.js — "Porthole Wink" [WHITE DAY]

  CONCEPT: small orderly rows of portholes wink on, trade places, and vanish.
  The structure reads as ship detail rather than a wash.
  INSTRUMENTS: whole ship; Jewelry carries the crispest wink.
  MOTION: indexed rows advance against a sqrt(2) secondary clock.
  SHOW HOME: playful daylight punctuation, silence-safe.
  CONTROLS: localSpeed — wink cadence; count — number of eligible portholes;
  width — wink duration; level — overall output ceiling.
*/

export var localSpeed = 0.26;
export var count = 0.28;
export var width = 0.22;
export var level = 0.80;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderCount(v) { count = v; }
export function sliderWidth(v) { width = v; }
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
var winkClock = 0.0;
var rowClock = 211.0;
var liveCount = 0.28;
var liveWidth = 0.22;
var liveLevel = 0.80;

export function beforeRender(delta) {
  var dt = clamp01(delta / 100.0) * 0.1;
  var speedScale = 0.35 + clamp01(localSpeed) * 1.65;
  var follow = min(1.0, dt * 7.0);
  liveCount += (clamp01(count) - liveCount) * follow;
  liveWidth += (clamp01(width) - liveWidth) * follow;
  liveLevel += (clamp01(level) - liveLevel) * follow;

  winkClock += dt * 0.110 * speedScale;
  rowClock += dt * 0.07778175 * speedScale;
  if (winkClock >= PHASE_WRAP) winkClock -= PHASE_WRAP;
  if (rowClock >= PHASE_WRAP) rowClock -= PHASE_WRAP;
}

export function render3D(index, x, y, z) {
  var columns = 7.0 + liveCount * 14.0;
  var rows = 4.0 + liveCount * 8.0;
  var cellX = floor(clamp01(x) * columns);
  var cellY = floor(clamp01(y) * rows);
  var seed = sin(cellX * 17.17 + cellY * 41.73 + floor(z * 11.0) * 9.13
                 + index * 0.173) * 43758.5453;
  seed = seed - floor(seed);

  var eligible = 0.0;
  if (seed > 0.90 - liveCount * 0.28) eligible = 1.0;

  var phase = winkClock * 4.0 + seed * 0.83 + cellY * 0.071
              - rowClock * 0.31;
  phase = phase - floor(phase);
  var distance = abs(phase - 0.50);
  var liveWindow = 0.012 + liveWidth * 0.055;
  var wink = 1.0 - smoothstep(liveWindow, liveWindow * 2.8, distance);

  var cellPoint = wave(x * columns + z * 2.7 + seed);
  cellPoint = pow(cellPoint, 8.0);
  var glint = wink * eligible * (0.42 + cellPoint * 0.95);

  if (fixtureType == FIX_VINTAGE_6) glint *= 1.22;
  else if (fixtureType == FIX_PAR) glint *= 0.62;

  var lvl = glint * (0.50 + liveLevel * 1.30);
  emitWhite(lvl, 0.28 + glint * 0.72);
}
