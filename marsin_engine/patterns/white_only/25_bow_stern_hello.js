/*
  DRAFT — pending operator review.

  25_bow_stern_hello.js — "Bow Stern Hello" [WHITE DAY]

  CONCEPT: the two ends of the ship exchange small white greetings, followed
  by one thin courier glint crossing the length between them.
  INSTRUMENTS: whole ship over the cycle; endpoints answer, center relays.
  MOTION: a long call/response cycle with a golden-ratio courier sparkle.
  SHOW HOME: playful daylight punctuation, silence-safe.
  CONTROLS: localSpeed — conversation pace; pulse — greeting strength;
  level — overall output ceiling.
*/

export var localSpeed = 0.21;
export var pulse = 0.86;
export var level = 0.78;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderPulse(v) { pulse = v; }
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
var helloClock = 0.15;
var sparkleClock = 433.0;
var livePulse = 0.86;
var liveLevel = 0.78;

function cyclePulse(phase, center, width) {
  var distance = abs(phase - center);
  distance = min(distance, 1.0 - distance);
  return 1.0 - smoothstep(width, width * 2.2, distance);
}

export function beforeRender(delta) {
  var dt = clamp01(delta / 100.0) * 0.1;
  var speedScale = 0.35 + clamp01(localSpeed) * 1.65;
  var follow = min(1.0, dt * 7.0);
  livePulse += (clamp01(pulse) - livePulse) * follow;
  liveLevel += (clamp01(level) - liveLevel) * follow;

  helloClock += dt * 0.021 * speedScale;
  sparkleClock += dt * 0.03397872 * speedScale;
  if (helloClock >= PHASE_WRAP) helloClock -= PHASE_WRAP;
  if (sparkleClock >= PHASE_WRAP) sparkleClock -= PHASE_WRAP;
}

export function render3D(index, x, y, z) {
  var phase = helloClock - floor(helloClock);
  var endDepth = 0.10;
  var front = 1.0 - smoothstep(endDepth, endDepth + 0.075, clamp01(z));
  var back = 1.0 - smoothstep(endDepth, endDepth + 0.075, 1.0 - clamp01(z));
  var frontCall = cyclePulse(phase, 0.18, 0.055);
  var backCall = cyclePulse(phase, 0.68, 0.055);

  var localSpark = wave(index * 0.61803399 + x * 3.7 + y * 5.1
                        + sparkleClock);
  localSpark = pow(localSpark, 9.0);
  var greeting = (front * frontCall + back * backCall) * localSpark;

  var courierHead = smooth01((phase - 0.30) / 0.20);
  var courierGate = cyclePulse(phase, 0.43, 0.10);
  var courierDistance = abs(clamp01(z) - courierHead);
  var courier = (1.0 - smoothstep(0.018, 0.065, courierDistance))
                * courierGate * pow(localSpark, 0.62);

  var mark = greeting + courier * 0.82;
  var lvl = mark * (0.30 + livePulse * 1.05)
            * (0.35 + liveLevel * 0.86) * 2.10;
  emitWhite(lvl, 0.22 + clamp01(mark) * 0.78);
}
