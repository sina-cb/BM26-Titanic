/*
  DRAFT — pending operator review.

  23_deck_hull_exchange.js — "Deck Hull Exchange" [WHITE DAY]

  CONCEPT: a few bright white marks answer between the Hull Canvas and the
  ship's direct-view outline/details, like a friendly conversation.
  INSTRUMENTS: bars trade with ropes, Jewelry, Organs, and Identity.
  MOTION: a slow exchange envelope and an incommensurate traveling stripe.
  SHOW HOME: daytime sparkle bed; no audio dependency.
  CONTROLS: localSpeed — exchange pace; spacing — distance between marks;
  pulse — answer strength; level — overall output ceiling.
*/

export var localSpeed = 0.22;
export var spacing = 0.36;
export var pulse = 0.82;
export var level = 0.76;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderSpacing(v) { spacing = v; }
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
var exchangeClock = 0.0;
var stripeClock = 89.0;
var liveSpacing = 0.36;
var livePulse = 0.82;
var liveLevel = 0.76;

export function beforeRender(delta) {
  var dt = clamp01(delta / 100.0) * 0.1;
  var speedScale = 0.35 + clamp01(localSpeed) * 1.65;
  var follow = min(1.0, dt * 7.0);
  liveSpacing += (clamp01(spacing) - liveSpacing) * follow;
  livePulse += (clamp01(pulse) - livePulse) * follow;
  liveLevel += (clamp01(level) - liveLevel) * follow;

  exchangeClock += dt * 0.024 * speedScale;
  stripeClock += dt * 0.03394113 * speedScale;
  if (exchangeClock >= PHASE_WRAP) exchangeClock -= PHASE_WRAP;
  if (stripeClock >= PHASE_WRAP) stripeClock -= PHASE_WRAP;
}

export function render3D(index, x, y, z) {
  var exchange = wave(exchangeClock);
  var hullEnvelope = pow(exchange, 5.0);
  var deckEnvelope = pow(1.0 - exchange, 5.0);
  var groupEnvelope = deckEnvelope;
  if (fixtureType == FIX_BAR_18) groupEnvelope = hullEnvelope;

  var marks = 3.0 + liveSpacing * 10.0;
  var stripe = wave(x * marks + z * 1.61803399 - stripeClock);
  stripe = pow(stripe, 10.0);
  var cross = wave(y * (2.0 + liveSpacing * 6.0) + index * 0.0618
                   + stripeClock * 0.61803399);
  cross = pow(cross, 7.0);
  var mark = stripe * cross;
  if (fixtureType == FIX_TE_SIGN) {
    var signCatch = wave(pixelLocalIndex * 0.0618 + stripeClock * 0.73);
    mark = max(mark, pow(signCatch, 10.0));
  }

  var lvl = mark * groupEnvelope * (0.28 + livePulse * 1.08)
            * (0.34 + liveLevel * 0.86) * 3.0;
  emitWhite(lvl, 0.22 + mark * 0.78);
}
