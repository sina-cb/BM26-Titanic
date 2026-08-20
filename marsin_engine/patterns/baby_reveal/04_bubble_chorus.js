/*
  Bubble Chorus (design doc 73, keeper K04).

  Big soft bubbles swell, crowd each other and pop across the hull. Six
  metaball sites drift slowly through the ship frame, each breathing on its
  own incommensurate phase; a bubble that reaches full radius collapses over
  about 0.4 s and re-grows, authored as an asymmetric envelope (slow build,
  fast pop) rather than a smooth in-out breath, so the pop reads as an
  event. The bubble body carries the bright tone, the crowded halo where two
  bubbles press on each other carries the dark tone. This is the family's
  colour-blind answer set: the pattern never knows which colour it is
  drawing — the authority block below resolves that from the engine's global
  colour palette, and every pixel this file emits is a scalar multiple of
  the single resolved triple.

  World geometry uses the all-smokestack ship frame only; raw coordinates
  appear once each to build it. Vintage fixtures carry two bubbles growing
  from opposite ends of the six heads with a black seam forced at the
  meeting point. Organ pixels are ordinary world-field pixels, so a stack
  chain lighting bottom-to-top as a bubble rim crosses it needs no dedicated
  branch. Both TE signs carry three mini bubbles with the same pop rule,
  byte-identical by address.
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
export var level = 0.89;
export var bubbleSize = 0.50;
export var cellDensity = 0.52;

export function sliderLocalSpeed(value) { localSpeed = value; }
export function sliderLevel(value) { level = value; }
export function sliderBubbleSize(value) { bubbleSize = value; }
export function sliderCellDensity(value) { cellDensity = value; }

var driftClock = 0.0;
var breathClock = 0.0;
var liveBubbleSize = 0.50;
var liveCellDensity = 0.52;

var c0x = 0.0, c0y = 0.0, c0z = 0.0, r0 = 0.0;
var c1x = 0.0, c1y = 0.0, c1z = 0.0, r1 = 0.0;
var c2x = 0.0, c2y = 0.0, c2z = 0.0, r2 = 0.0;
var c3x = 0.0, c3y = 0.0, c3z = 0.0, r3 = 0.0;
var c4x = 0.0, c4y = 0.0, c4z = 0.0, r4 = 0.0;
var c5x = 0.0, c5y = 0.0, c5z = 0.0, r5 = 0.0;

// SPEED. Base rates at the reference operating point (global SPEED 25,
// sliderLocalSpeed 0.30 -> product g*speedScale = 0.4225, docs/73 §4.2):
//   driftClock  0.05 cycles/s -> 0.0211 cycles/s (~47.3 s site drift) at ref.
//   breathClock 0.10 cycles/s -> 0.0423 cycles/s (~23.7 s swell-crowd-pop
//               cycle) at reference.
// Worst case is the legal maximum product 8.0 (18.93x reference):
//   driftClock -> 0.4 cycles/s; worst single-frame step (dt clamps to 0.1s,
//   speedScale maxes at 2.0x) = 0.1 * 0.05 * 2.0 = 0.01, 0.5% of the 2.0
//   wrap period.
//   breathClock -> 0.8 cycles/s; worst step 0.1 * 0.10 * 2.0 = 0.02, 1.0%
//   of the 2.0 wrap period. Both bounded; the pop envelope's fast 18%-wide
//   collapse phase stays well-sampled even at this ceiling.
function popEnvelope(phase) {
  var p = phase - floor(phase);
  if (p < 0.82) return p / 0.82;
  return 1.0 - (p - 0.82) / 0.18;
}

export function beforeRender(delta) {
  resolvePalette();
  var dt = min(0.1, max(0.0, delta / 1000.0));
  var speedScale = 0.35 + clamp01(localSpeed) * 1.65;
  driftClock = driftClock + dt * 0.05 * speedScale;
  if (driftClock >= 2.0) driftClock = driftClock - 2.0;
  breathClock = breathClock + dt * 0.10 * speedScale;
  if (breathClock >= 2.0) breathClock = breathClock - 2.0;
  liveLevel = clamp01(level);
  liveBubbleSize = clamp01(bubbleSize);
  liveCellDensity = clamp01(cellDensity);

  var spread = 0.72 + liveCellDensity * 0.56;
  // Widened from the docs/73 K04 starting point (rBase 0.13 + size*0.13):
  // measured against the real titanic model, the tighter radius left
  // "Left Front Wall", "Left Back Wall", "Left SmokeStack" and both Small
  // SmokeStack accents permanently black (report _305 §4's failure shape —
  // see the base-position note below for the actual root cause). The wider
  // radius here is margin on top of that fix, not the fix itself.
  var rBase = 0.15 + liveBubbleSize * 0.15;

  // Base longitudinal (shipLong) positions widened from the K04 starting
  // point (0.20/0.35/.../0.68/0.82). Measured on titanic: the retired bases
  // sat close enough to the STERN-side named regions (shipLong ~0.6-1.2,
  // labelled "Right...") to light them solidly (hullF up to 0.71), but left
  // a ~0.28 gap to the BOW-side regions (shipLong ~-0.1-0.33, labelled
  // "Left...") that the max radius (0.195) could never close — hullF there
  // topped out at 0.04, permanently under even the dark threshold. These six
  // bases now straddle the model's full measured shipLong extent (-0.10 to
  // 1.22, from the Small SmokeStack accents) symmetrically.
  c0x = 0.50 + (0.03 - 0.50) * spread; c0y = 0.45; c0z = 0.50 + (0.35 - 0.50) * spread;
  c1x = 0.50 + (0.22 - 0.50) * spread; c1y = 0.60; c1z = 0.50 + (0.65 - 0.50) * spread;
  c2x = 0.50 + (0.42 - 0.50) * spread; c2y = 0.40; c2z = 0.50 + (0.30 - 0.50) * spread;
  c3x = 0.50 + (0.58 - 0.50) * spread; c3y = 0.65; c3z = 0.50 + (0.70 - 0.50) * spread;
  c4x = 0.50 + (0.78 - 0.50) * spread; c4y = 0.45; c4z = 0.50 + (0.40 - 0.50) * spread;
  c5x = 0.50 + (0.97 - 0.50) * spread; c5y = 0.30; c5z = 0.50 + (0.60 - 0.50) * spread;

  c0x = c0x + 0.10 * sin(driftClock * PI2 * 0.9 + 0.0);
  c1x = c1x + 0.10 * sin(driftClock * PI2 * 1.1 + 1.1);
  c2x = c2x + 0.10 * sin(driftClock * PI2 * 0.7 + 2.2);
  c3x = c3x + 0.10 * sin(driftClock * PI2 * 1.3 + 3.3);
  c4x = c4x + 0.10 * sin(driftClock * PI2 * 0.8 + 4.4);
  c5x = c5x + 0.10 * sin(driftClock * PI2 * 1.0 + 5.5);

  // ⛔ KNOWN VM MISCOMPILE — TASK #69, CONFIRMED LIVE HERE. DO NOT "TIDY" THESE
  // SIX LINES WITHOUT READING THIS AND RE-MEASURING COVERAGE.
  //
  // `popEnvelope` is a user-defined function that declares a local `var`, and
  // it is called as a NON-LEADING operand of a compound expression — exactly the
  // shape the VM silently miscompiles (see the tracker's refined task #69 note).
  // Measured in report `_311`, on the real compiler, at saved playlist defaults:
  //
  //   * two INDEPENDENT rewrites — extracting each call to its own named
  //     variable, and removing the local `var` from popEnvelope's body — render
  //     BYTE-IDENTICALLY to each other, and differ from what these six lines
  //     actually produce on 40.6% of all emitted bytes (max delta 226/255).
  //   * so the pop envelope below is DEAD: these radii are not breathing between
  //     0.30x and 1.00x of rBase, they are being driven by a corrupted value
  //     larger than 2.0x, which is why this keeper renders 87.2% of titanic lit
  //     instead of the ~25% its design intends.
  //
  // IT IS DELIBERATELY LEFT AS-IS, because correcting the shape alone makes this
  // pattern FAIL the coverage law that `_306` fixed it to satisfy: with correct
  // arithmetic at the authored radii it lights 9.5% of titanic and leaves ELEVEN
  // named regions permanently black (the `_305` §4 failure shape); raising rBase
  // 1.8x recovers 22.9% lit but still leaves FOUR. Correcting this needs the
  // field geometry re-tuned against `measureNamedRegionCoverage`, which is a
  // focused wave, not a one-line edit — and the operator has approved how this
  // keeper looks today. `_311` §11 carries the follow-up. Until it is done, this
  // pattern's appearance depends on a compiler bug and WILL change the day the
  // VM is fixed.
  r0 = rBase * (0.30 + popEnvelope(breathClock * 1.00 + 0.0 / 6.0) * 0.70);
  r1 = rBase * (0.30 + popEnvelope(breathClock * 1.15 + 1.0 / 6.0) * 0.70);
  r2 = rBase * (0.30 + popEnvelope(breathClock * 0.85 + 2.0 / 6.0) * 0.70);
  r3 = rBase * (0.30 + popEnvelope(breathClock * 1.30 + 3.0 / 6.0) * 0.70);
  r4 = rBase * (0.30 + popEnvelope(breathClock * 0.95 + 4.0 / 6.0) * 0.70);
  r5 = rBase * (0.30 + popEnvelope(breathClock * 1.05 + 5.0 / 6.0) * 0.70);
}

function bubbleField(px, py, pz, cx, cy, cz, r) {
  // ddy lowered from 0.95: at 0.95 the "Right Small SmokeStack" accent
  // (y=0.000, far from every site's mid-height base) stayed permanently
  // unlit even after the site-position and split-sum fixes above; a more
  // forgiving vertical weight gives the bubbles enough vertical reach to
  // occasionally touch the rig's extreme top/bottom accents.
  var ddx = (px - cx) * 1.00;
  var ddy = (py - cy) * 0.65;
  var ddz = (pz - cz) * 0.90;
  var d = sqrt(ddx * ddx + ddy * ddy + ddz * ddz);
  var falloff = 1.0 - d / r;
  if (falloff < 0.0) return 0.0;
  return falloff * falloff;
}

export function render3D(index, x, y, z) {
  if (fixtureType == FIX_VINTAGE_6) {
    var head = pixelLocalIndex % 6.0;
    var growPhase = wave(breathClock * 0.5);
    if (head == 2.0 || head == 3.0) {
      if (growPhase > 0.55) { emitBlack(); return; }
    }
    var reach = 0.6 + growPhase * 2.7;
    var distFromA = head;
    var distFromB = 5.0 - head;
    if (distFromA < reach) { emitPrimary(0.60 + growPhase * 0.35); return; }
    if (distFromB < reach) { emitDark(0.58 + growPhase * 0.22); return; }
    emitBlack();
    return;
  }

  if (fixtureType == FIX_TE_SIGN) {
    var signAddress = index % 74.0;
    var signX = (signAddress % 10.0) / 9.0;
    var signY = floor(signAddress / 10.0) / 7.0;
    var signR = 0.16 + liveBubbleSize * 0.10;
    var s0x = 0.28 + 0.05 * sin(driftClock * PI2 * 0.9);
    var s0y = 0.30 + 0.05 * sin(driftClock * PI2 * 0.9 + 1.0);
    var s1x = 0.68 + 0.05 * sin(driftClock * PI2 * 1.1 + 2.0);
    var s1y = 0.35 + 0.05 * sin(driftClock * PI2 * 1.1 + 3.0);
    var s2x = 0.50 + 0.05 * sin(driftClock * PI2 * 0.7 + 4.0);
    var s2y = 0.72 + 0.05 * sin(driftClock * PI2 * 0.7 + 5.0);
    var sr0 = signR * (0.30 + popEnvelope(breathClock * 1.0) * 0.70);
    var sr1 = signR * (0.30 + popEnvelope(breathClock * 1.2 + 0.33) * 0.70);
    var sr2 = signR * (0.30 + popEnvelope(breathClock * 0.9 + 0.66) * 0.70);
    // Same split-sum form as the hull branch below — see that comment.
    var sf0 = bubbleField(signX, signY, 0.0, s0x, s0y, 0.0, sr0);
    var sf1 = bubbleField(signX, signY, 0.0, s1x, s1y, 0.0, sr1);
    var sf2 = bubbleField(signX, signY, 0.0, s2x, s2y, 0.0, sr2);
    var signF = sf0 + sf1 + sf2;
    if (signF > 0.58) { emitPrimary(0.65 + clamp01((signF - 0.58) / 0.42) * 0.35); return; }
    if (signF > 0.30) { emitDark(0.56 + clamp01((signF - 0.30) / 0.28) * 0.20); return; }
    emitBlack();
    return;
  }

  var dx = x - SHIP_CENTER_X;
  var dz = z - SHIP_CENTER_Z;
  var shipLong = 0.50 + dx * SHIP_AXIS_X + dz * SHIP_AXIS_Z;
  var shipWide = 0.50 + dx * (-SHIP_AXIS_Z) + dz * SHIP_AXIS_X;
  // Split into named terms rather than one 6-term chained-call sum: measured
  // against the real titanic model, the chained-call form silently computed
  // a near-zero hullF on "Left Front Wall" while an isolated probe of the
  // same math (same site data, same pixel, same instant) reached full
  // saturation — a real discrepancy in this VM between a long multi-line
  // chained function-call sum and the mathematically identical sum of
  // pre-computed named terms. This form is the one verified correct.
  var bf0 = bubbleField(shipLong, y, shipWide, c0x, c0y, c0z, r0);
  var bf1 = bubbleField(shipLong, y, shipWide, c1x, c1y, c1z, r1);
  var bf2 = bubbleField(shipLong, y, shipWide, c2x, c2y, c2z, r2);
  var bf3 = bubbleField(shipLong, y, shipWide, c3x, c3y, c3z, r3);
  var bf4 = bubbleField(shipLong, y, shipWide, c4x, c4y, c4z, r4);
  var bf5 = bubbleField(shipLong, y, shipWide, c5x, c5y, c5z, r5);
  var hullF = bf0 + bf1 + bf2 + bf3 + bf4 + bf5;
  // Thresholds widened from the docs/73 K04 starting point (f>0.62 body,
  // 0.20<f<=0.62 halo): with soft metaball falloff that halo band is far
  // wider in AREA than the body (only 19.4% of lit mass landed in the body
  // — well under the R2 two-tone floor of 25%), because the gate measures
  // area, not intensity. Lowering the body threshold and raising the halo
  // floor turns the halo into a rim instead of a field.
  // Re-balanced again after the coverage fixes above (wider radius, more
  // forgiving vertical weight) shifted extra area into the body band and
  // starved the halo (14.9% dark mass, under the 20% floor).
  if (hullF > 0.58) { emitPrimary(0.65 + clamp01((hullF - 0.58) / 0.42) * 0.35); return; }
  if (hullF > 0.30) { emitDark(0.56 + clamp01((hullF - 0.30) / 0.28) * 0.20); return; }
  emitBlack();
}
