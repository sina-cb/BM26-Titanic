/*
  DRAFT — pending operator review.

  21_playa_glint_field.js — "Playa Glint Field" [WHITE DAY]

  CONCEPT: isolated sun-catch glints wander across every instrument like
  sequins on the ship. Individual points stay crisp and bright; the field is
  dark most of the time so daylight output remains intentionally sparse.
  INSTRUMENTS: whole ship, with Jewelry slightly favored as the sparkle edge.
  MOTION: two incommensurate analytic fields drift at sqrt(2) and phi ratios.
  SHOW HOME: daytime sparkle bed; silent and free-running.
  CONTROLS: localSpeed — drift rate; density — active point duty; sparkle —
  glint punch; level — overall output ceiling.
*/

export var localSpeed = 0.24;
export var density = 0.22;
export var sparkle = 0.86;
export var level = 0.78;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderDensity(v) { density = v; }
export function sliderSparkle(v) { sparkle = v; }
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
var driftClock = 0.0;
var crossClock = 173.0;
var liveDensity = 0.22;
var liveSparkle = 0.86;
var liveLevel = 0.78;

export function beforeRender(delta) {
  var dt = clamp01(delta / 100.0) * 0.1;
  var speedScale = 0.35 + clamp01(localSpeed) * 1.65;
  var follow = min(1.0, dt * 7.0);
  liveDensity += (clamp01(density) - liveDensity) * follow;
  liveSparkle += (clamp01(sparkle) - liveSparkle) * follow;
  liveLevel += (clamp01(level) - liveLevel) * follow;

  driftClock += dt * 0.031 * speedScale;
  crossClock += dt * 0.02192031 * speedScale;
  if (driftClock >= PHASE_WRAP) driftClock -= PHASE_WRAP;
  if (crossClock >= PHASE_WRAP) crossClock -= PHASE_WRAP;
}

export function render3D(index, x, y, z) {
  var seed = sin(index * 12.9898 + x * 37.719 + y * 19.173 + z * 71.337);
  var fieldA = wave(seed * 2.173 + x * 7.1 + y * 11.3 + z * 5.7
                    + driftClock);
  var fieldB = wave(seed * 3.117 - x * 4.7 + y * 6.2 + z * 9.1
                    - crossClock);
  var candidate = fieldA * fieldB;
  var threshold = 0.955 - liveDensity * 0.105;
  var glint = smooth01((candidate - threshold) / (1.0 - threshold));
  glint = pow(glint, 0.42);

  var jewelBoost = 1.0;
  if (fixtureType == FIX_VINTAGE_6) jewelBoost = 1.20;
  else if (fixtureType == FIX_PAR) jewelBoost = 0.72;

  var punch = 0.70 + liveSparkle * 1.52;
  var lvl = glint * punch * jewelBoost * (0.36 + liveLevel * 0.82);
  var nativeShare = 0.20 + glint * 0.78;
  emitWhite(lvl, nativeShare);
}
