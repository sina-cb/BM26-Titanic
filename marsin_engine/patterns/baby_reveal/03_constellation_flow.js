/*
  Constellation Flow (design doc 73, keeper K03).

  Bright stars drift through a dim web of threads that stretch and snap
  between them. A sparse per-pixel hash seeds a handful of stars across the
  whole rig; everywhere else, a slow drifting interference field seeds a
  faint thread lattice whose zero set genuinely migrates, so the web
  stretches and snaps rather than just fading. Stars carry the bright tone,
  threads carry the dark tone, and the wide gaps between threads are the
  family's dim-band anchor. This is the family's colour-blind answer set:
  the pattern never knows which colour it is drawing — the authority block
  below resolves that from the engine's global colour palette, and every
  pixel this file emits is a scalar multiple of the single resolved triple.

  World geometry uses the all-smokestack ship frame only; raw coordinates
  appear once each to build it. Vintage fixtures carry one rotating star
  head against two dark thread heads. Because Organ pixels are ordinary
  world-field pixels like any hull pixel, a PAR occasionally catching the
  star hash reads as a slow four-step ladder with no dedicated branch
  required. Both TE signs carry the same drifting thread web plus 8 fixed
  star addresses, byte-identical by address.
*/

// ── BABY REVEAL COLOUR AUTHORITY (contract v2) ─────────────────────────────
// BYTE-IDENTICAL IN EVERY patterns/baby_reveal/*.js. Contract: docs/73 §3.
//
// This family does not know whether it is pink or blue. It renders THE GLOBAL
// COLOUR PALETTE: `colorPalette1` is the primary, and the second tone is
// DERIVED right here as that same colour very darkened (its value x DARK_K).
// `colorPalette2` is NOT read — ONE slot decides everything, which is what puts
// these looks on the DECK in whatever colour is live instead of only inside an
// armed show (operator ruling, docs/73 §2.4-v2).
//
// P0, NO FALLBACK: an INVALID palette — any component outside [0, 1] — renders
// BLACK on every pixel. The family never substitutes a colour of its own.
// What it cannot do is detect an ABSENT one, and that is a property of the VM,
// measured rather than assumed: the VM installs its own hsvPicker default
// (h 0, s 1, v 1 — the same triple the engine registry carries for
// colorPalette1) and calls the setter below at program init, whatever these
// declared values say. "Never pushed" and "pushed the engine default" are one
// indistinguishable state, so an unpushed pattern renders the default colour
// rather than black. Every live load path pushes the real palette first
// (finalizeCpcValues). docs/73 §2.4-v2.
export var cp1H = 0.0, cp1S = 1.0, cp1V = 1.0;   // mirrors the VM's own default
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }

var DARK_K = 0.28;              // THE second tone: the primary's value x this.
                                // Measured perfectly bimodal (docs/73 D3).
var FAMILY_TRIM = 1.00;         // whole-family output trim (one-line retune)
var FAMILY_BAR_TRIM = 1.00;     // extra trim on FIX_BAR_18 only
var FLOOR_I = 0.14;             // never-black floor for a LIT pixel

var famR = 0.0, famG = 0.0, famB = 0.0;   // the resolved PRIMARY triple
var famOk = 0.0;                          // 0 = refused; nothing may light
var liveLevel = 1.0;    // each pattern's beforeRender refreshes this. Declared
                        // HERE, not in the pattern: the VM resolves `var` in
                        // declaration order, so `emitTone` reading a liveLevel
                        // declared further down the file is a COMPILE FAILURE
                        // ("Undefined var liveLevel"). Verified against the
                        // real compiler, not assumed.

function clamp01(v) { if (v < 0.0) return 0.0; if (v > 1.0) return 1.0; return v; }

// Call ONCE per frame, first thing in beforeRender. Turns the live palette slot
// into the primary RGB triple; `emitDark` then scales that triple by DARK_K,
// which IS "the same colour, very darkened" — RGB scales linearly with HSV
// value, so the hue and the saturation survive the multiply by construction,
// and every emitted pixel stays an exact scalar multiple of ONE triple.
function resolvePalette() {
  famR = 0.0; famG = 0.0; famB = 0.0; famOk = 0.0;
  if (cp1H < 0.0 || cp1H > 1.0) return;
  if (cp1S < 0.0 || cp1S > 1.0) return;
  if (cp1V < 0.0 || cp1V > 1.0) return;
  var hv = cp1H - floor(cp1H);
  var iv = floor(hv * 6.0) % 6.0;
  var fv = hv * 6.0 - floor(hv * 6.0);
  var pv = cp1V * (1.0 - cp1S);
  var qv = cp1V * (1.0 - fv * cp1S);
  var tv = cp1V * (1.0 - (1.0 - fv) * cp1S);
  if      (iv == 0.0) { famR = cp1V; famG = tv;   famB = pv;   }
  else if (iv == 1.0) { famR = qv;   famG = cp1V; famB = pv;   }
  else if (iv == 2.0) { famR = pv;   famG = cp1V; famB = tv;   }
  else if (iv == 3.0) { famR = pv;   famG = qv;   famB = cp1V; }
  else if (iv == 4.0) { famR = tv;   famG = pv;   famB = cp1V; }
  else                { famR = cp1V; famG = pv;   famB = qv;   }
  famOk = 1.0;
}

function emitBlack() { rgbwau(0.0, 0.0, 0.0, 0.0, 0.0, 0.0); }

function emitTone(v, toneK) {
  if (famOk < 0.5) { emitBlack(); return; }
  var k = max(FLOOR_I, min(1.0, v)) * liveLevel * FAMILY_TRIM * toneK;
  if (fixtureType == FIX_BAR_18) k = k * FAMILY_BAR_TRIM;
  rgbwau(famR * k, famG * k, famB * k, 0.0, 0.0, 0.0);
}

function emitPrimary(v) { emitTone(v, 1.0); }
function emitDark(v) { emitTone(v, DARK_K); }
// ── END AUTHORITY BLOCK ─────────────────────────────────────────────────────

var SHIP_CENTER_X = 0.5219458333333333;
var SHIP_CENTER_Z = 0.5606541666666667;
var SHIP_AXIS_X = 0.7658426753447269;
var SHIP_AXIS_Z = -0.6430279905422711;

export var localSpeed = 0.30;
export var level = 0.90;
export var starSize = 0.54;
export var threadReach = 0.48;

export function sliderLocalSpeed(value) { localSpeed = value; }
export function sliderLevel(value) { level = value; }
export function sliderStarSize(value) { starSize = value; }
export function sliderThreadReach(value) { threadReach = value; }

var driftClock = 0.0;
var twinkleClock = 0.0;
var liveStarSize = 0.54;
var liveThreadReach = 0.48;

// SPEED. OPERATOR FIELD RETUNE 2026-08-17 (report `_311`): +15% on the rig,
// applied to BOTH clocks so the web's reshape and the twinkle keep their
// relationship. The factor lives in these base rates, not in the saved sliders,
// so the playlist still loads at the reference point (the `_305` method).
// Pre-retune rates were 0.05 and 4.5.
//
// Base rates at the reference operating point (global SPEED 25,
// sliderLocalSpeed 0.30 -> product g*speedScale = 0.4225, docs/73 §4.2):
//   driftClock   0.0575 cycles/s -> 0.0243 cycles/s (~41.2 s web reshape) at
//                reference.
//   twinkleClock 5.175 units/s -> 2.187 units/s at reference (lively twinkle;
//                this is the dimmest keeper by design, per docs/73 K03, so
//                twinkle liveliness carries most of the animated floor).
// Worst case is the legal maximum product 8.0 (18.93x reference):
//   driftClock -> 0.46 cycles/s; worst single-frame step (dt clamps to 0.1s,
//   speedScale maxes at 2.0x) = 0.1 * 0.0575 * 2.0 = 0.0115, 0.58% of the 2.0
//   wrap period — still two orders inside the aliasing ceiling.
//   twinkleClock -> 41.4 units/s; worst step 0.1 * 5.175 * 2.0 = 1.035,
//   negligible against its 10000 wrap (a shimmer texture clock, not a
//   structural phase with a hard threshold).
export function beforeRender(delta) {
  resolvePalette();
  var dt = min(0.1, max(0.0, delta / 1000.0));
  var speedScale = 0.35 + clamp01(localSpeed) * 1.65;
  driftClock = driftClock + dt * 0.0575 * speedScale;
  if (driftClock >= 2.0) driftClock = driftClock - 2.0;
  twinkleClock = twinkleClock + dt * 5.175 * speedScale;
  if (twinkleClock >= 10000.0) twinkleClock = twinkleClock - 10000.0;
  liveLevel = clamp01(level);
  liveStarSize = clamp01(starSize);
  liveThreadReach = clamp01(threadReach);
}

export function render3D(index, x, y, z) {
  // Widened from the docs/73 K03 starting point (0.962 - starSize*0.012):
  // at that gate stars carried only 24.9% of lit mass, under the R2 two-tone
  // floor (need >=25% bright, measured across a 30 s review). A sparse,
  // dim-web keeper like this one lives close to that edge by design. The
  // real fix (see the primary-tone floor below) was that a dim twinkle
  // trough (v as low as 0.58) sat close enough to the dark tone's byte
  // range that the review's percentile split occasionally folded it into
  // the valley bucket rather than counting it bright; this gate is widened
  // modestly on top of that for margin (target 30%+ bright mass).
  var starGate = 0.93 - liveStarSize * 0.014;

  if (fixtureType == FIX_VINTAGE_6) {
    var head = pixelLocalIndex % 6.0;
    var starHead = floor(twinkleClock * 0.7) % 6.0;
    var threadHeadA = (starHead + 2.0) % 6.0;
    var threadHeadB = (starHead + 4.0) % 6.0;
    if (head == starHead) {
      var headTwinkle = pow(wave(head * 11.0 + twinkleClock), 3.0);
      emitPrimary(0.72 + headTwinkle * 0.28);
      return;
    }
    if (head == threadHeadA || head == threadHeadB) {
      emitDark(0.58 + wave(head * 0.7 + driftClock * 3.0) * 0.24);
      return;
    }
    emitBlack();
    return;
  }

  if (fixtureType == FIX_TE_SIGN) {
    var signAddress = index % 74.0;
    var signX = (signAddress % 10.0) / 9.0;
    var signY = floor(signAddress / 10.0) / 7.0;
    var isStar = 0.0;
    if (signAddress == 7.0) isStar = 1.0;
    if (signAddress == 16.0) isStar = 1.0;
    if (signAddress == 25.0) isStar = 1.0;
    if (signAddress == 33.0) isStar = 1.0;
    if (signAddress == 48.0) isStar = 1.0;
    if (signAddress == 57.0) isStar = 1.0;
    if (signAddress == 62.0) isStar = 1.0;
    if (signAddress == 71.0) isStar = 1.0;
    if (isStar > 0.5) {
      var signTwinkle = pow(wave(signAddress * 3.7 + twinkleClock), 3.0);
      emitPrimary(0.72 + signTwinkle * 0.28);
      return;
    }
    var signW = sin((signX * 1.4 + signY * 0.8) * PI2 * 0.9 + driftClock * 0.30 * PI2)
              + sin((signY * 1.1 - signX * 0.6) * PI2 * 0.7 - driftClock * 0.21 * PI2);
    if (abs(signW) < (0.10 + liveThreadReach * 0.16)) {
      emitDark(0.60 + wave(signW * 0.9 + twinkleClock * 0.1) * 0.28);
      return;
    }
    emitBlack();
    return;
  }

  var dx = x - SHIP_CENTER_X;
  var dz = z - SHIP_CENTER_Z;
  var shipLong = 0.50 + dx * SHIP_AXIS_X + dz * SHIP_AXIS_Z;
  var shipWide = 0.50 + dx * (-SHIP_AXIS_Z) + dz * SHIP_AXIS_X;
  var hashSeed = sin(index * 12.9898) * 437.585;
  var hash = hashSeed - floor(hashSeed);
  if (hash > starGate) {
    var twinkle = pow(wave(hash * 37.0 + twinkleClock * (0.5 + hash)), 3.0);
    emitPrimary(0.72 + twinkle * 0.28);
    return;
  }
  var w = sin((shipLong * 1.4 + y * 0.8) * PI2 * 0.9 + driftClock * 0.30 * PI2)
        + sin((shipWide * 1.1 - y * 0.6) * PI2 * 0.7 - driftClock * 0.21 * PI2);
  if (abs(w) < (0.10 + liveThreadReach * 0.16)) {
    emitDark(0.60 + wave(w * 0.9 + twinkleClock * 0.1) * 0.28);
    return;
  }
  emitBlack();
}
