/*
  Comet Lullaby (design doc 73, keeper K08).

  Four soft comet heads sail incommensurate Lissajous paths over the ship,
  each trailing a short dark tail of fading ghost positions through black.
  A head is the primary tone; its trailing ghosts are the dark tone; every
  pixel the comets are not currently near is exact black — "sail the hull ...
  through black" is the identity, so there is no background lattice standing
  in for negative space here.

  Local Speed is the safe first control. Direction reverses all four paths at
  once. Level sets output. Tail Length stretches how far behind the head the
  dark trail reaches. Colour is never decided here — see the authority block
  below (docs/73 §3): this file only computes geometry and calls
  emitPrimary/emitDark/emitBlack.

  Coverage note (docs/73 §5 K08): moving bodies over black are the same risk
  shape as the tease's `05_ink_drops` permanent-black-wall failure (report
  _305 §4). The four heads' amplitudes are set to sweep past the model's
  normalized bounds on every axis (not just to 0.34/0.24/0.18 as the spec's
  literal numbers), specifically so no named region of titanic goes
  permanently dark over a full orbit. Measured via the offline harness — see
  the implementation report.
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

function toneV(shape) { return 0.55 + clamp01(shape) * 0.45; }

export var localSpeed = 0.30;
export var direction = 1.0;
export var level = 0.88;
export var tailLength = 0.56;

export function sliderLocalSpeed(value) { localSpeed = value; }
export function sliderDirection(value) { direction = value; }
export function sliderLevel(value) { level = value; }
export function sliderTailLength(value) { tailLength = value; }

var orbitClock = 0.0;
var liveTail = 0.56;

// SPEED (N8). The head-position sine arguments carry `orbitClock * PI2 *
// freq`; the fastest per-head frequency is 1.0 (heads 0/2 below), so one
// "period" is one orbitClock unit. Base rate 0.059/s. Reference (composed
// 0.4225x): rate = 0.059 * 0.4225 = 0.0249 unit/s -> lap period ~40.1s,
// showing visible drift inside R6's 10-25s window well before a full lap.
// Legal maximum (18.93x reference): rate = 0.471 unit/s -> lap period
// ~2.12s (>= the 2s ownership-front ceiling); per-frame step at 40fps =
// 0.471/40 = 0.0118 unit, under the 0.02-of-period aliasing ceiling. Heads
// with a higher per-axis frequency (up to 1.6 below) stay proportionally
// inside the same bound since their coefficient never exceeds 1.6x this one.
var ORBIT_BASE_RATE = 0.059;

export function beforeRender(delta) {
  resolvePalette();
  var dt = min(0.1, max(0.0, delta / 1000.0));
  var speedScale = 0.35 + clamp01(localSpeed) * 1.65;
  var orbitSign = 1.0;
  if (direction < 0.5) orbitSign = -1.0;
  orbitClock = orbitClock + dt * ORBIT_BASE_RATE * speedScale * orbitSign;
  if (orbitClock >= 10000.0) orbitClock = orbitClock - 10000.0;
  if (orbitClock < -10000.0) orbitClock = orbitClock + 10000.0;
  liveLevel = clamp01(level);
  liveTail = clamp01(tailLength);
}

// One comet head plus its trailing ghost dots, evaluated against a pixel
// already expressed in the (u, v, w) coordinate the head paths live in.
// `freqU/V/W` are the head's own incommensurate rates; `phase` offsets it
// from its siblings; `ampU/V/W` are generous — wider than the docs/73 §5
// literal 0.34/0.24/0.18 — specifically so the swept path clears the model's
// full normalized extent on every axis (see the coverage note above).
function cometField(pu, pv, pw, freqU, freqV, freqW, phase, ampU, ampV, ampW, headR, tailR) {
  var a = orbitClock * PI2 * freqU + phase;
  var av = orbitClock * PI2 * freqV + phase * 1.31;
  var aw = orbitClock * PI2 * freqW + phase * 0.71;
  var hx = 0.5 + ampU * sin(a);
  var hy = 0.5 + ampV * sin(av);
  var hz = 0.5 + ampW * sin(aw);
  var d = hypot3(pu - hx, pv - hy, pw - hz);
  var headField = max(0.0, 1.0 - d / headR);
  var lagMax = 0.55 + liveTail * 0.75;
  var bestTail = 0.0;
  var lag = 0.14;
  var step = 0;
  // FIVE ghost samples, not three (operator field retune 2026-08-17, report
  // `_311`): the tail was three dots covering lag 0.14-0.42 of a ~0.97 window,
  // so the "long dim tail" this keeper is named for was mostly missing. Five
  // reaches lag 0.70. SIX OR MORE IS DEAD WORK and was measured as such: the
  // ghost weight is (1 - lag / lagMax), so a sample at lag >= 0.80 weighs under
  // the 0.18 tail threshold below and can never light a pixel. Seven samples
  // rendered byte-identically to five.
  while (step < 5) {
    if (lag < lagMax) {
      var ta = a - lag;
      var tav = av - lag * 1.31;
      var taw = aw - lag * 0.71;
      var tx = 0.5 + ampU * sin(ta);
      var ty = 0.5 + ampV * sin(tav);
      var tz = 0.5 + ampW * sin(taw);
      var td = hypot3(pu - tx, pv - ty, pw - tz);
      var tf = max(0.0, 1.0 - td / tailR) * (1.0 - lag / lagMax);
      if (tf > bestTail) bestTail = tf;
    }
    lag = lag + 0.14;
    step = step + 1;
  }
  if (headField > 0.30) { return 2.0 + headField; }
  if (bestTail > 0.18) { return 1.0 + bestTail; }
  return 0.0;
}

function bestOfFourComets(pu, pv, pw, ampU, ampV, ampW, headR, tailR) {
  var f0 = cometField(pu, pv, pw, 1.00, 1.30, 0.70, 0.00, ampU, ampV, ampW, headR, tailR);
  var f1 = cometField(pu, pv, pw, 0.62, 1.00, 1.55, 1.70, ampU, ampV, ampW, headR, tailR);
  var f2 = cometField(pu, pv, pw, 1.00, 0.55, 1.15, 3.35, ampU, ampV, ampW, headR, tailR);
  var f3 = cometField(pu, pv, pw, 0.83, 1.60, 0.45, 5.05, ampU, ampV, ampW, headR, tailR);
  var best = f0;
  if (f1 > best) best = f1;
  if (f2 > best) best = f2;
  if (f3 > best) best = f3;
  if (best >= 2.0) { emitPrimary(toneV(best - 2.0)); return; }
  if (best >= 1.0) { emitDark(toneV(best - 1.0)); return; }
  emitBlack();
}

export function render3D(index, x, y, z) {
  if (fixtureType == FIX_VINTAGE_6) {
    var head = pixelLocalIndex % 6.0;
    var chase = ((floor(orbitClock * 6.0) % 6.0) + 6.0) % 6.0;
    var tail1 = ((chase - 1.0) + 6.0) % 6.0;
    var tail2 = ((chase - 2.0) + 6.0) % 6.0;
    if (head == chase) { emitPrimary(0.94); return; }
    if (head == tail1) { emitDark(0.80); return; }
    if (head == tail2) { emitDark(0.62); return; }
    emitBlack();
    return;
  }

  if (fixtureType == FIX_TE_SIGN) {
    var signAddress = index % 74.0;
    var signX = (signAddress % 10.0) / 9.0;
    var signY = floor(signAddress / 10.0) / 7.0;
    bestOfFourComets(signX, signY, 0.5, 0.62, 0.62, 0.05, 0.44, 0.29);
    return;
  }

  var dx = x - SHIP_CENTER_X;
  var dz = z - SHIP_CENTER_Z;
  var shipLong = 0.50 + dx * SHIP_AXIS_X + dz * SHIP_AXIS_Z;
  var shipWide = 0.50 + dx * (-SHIP_AXIS_Z) + dz * SHIP_AXIS_X;
  // BODY RADII — operator field retune 2026-08-17 (report `_311`). Sina's note
  // on this keeper was "too little blue": at the old 0.30 head / 0.19 tail it
  // lit 12.0% of titanic, the sparsest look in the family by a wide margin, and
  // on the rig that reads as not enough of the answer's colour on the ship.
  // Raised to 0.52 / 0.34, which measures 25.9% lit — more than double, and
  // still 74% designed black, so "comets sailing through black" survives intact
  // (the thresholds below mean the EFFECTIVE head disc is 0.7 x headR).
  bestOfFourComets(shipLong, y, shipWide, 0.78, 0.70, 0.75, 0.52, 0.34);
}
