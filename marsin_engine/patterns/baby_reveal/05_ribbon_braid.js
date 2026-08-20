/*
  Ribbon Braid (design doc 73, keeper K05).

  Three thick ribbons braid the length of the ship, passing over and under
  each other. Each ribbon's centre sways across the ship's width as a
  travelling sine wave, offset a third of a turn from its neighbours; a
  companion cosine term gives each ribbon a "depth" at every point along the
  hull, and whichever ribbon has the largest depth there is the one drawn on
  top. The topmost ribbon at a pixel carries the bright tone, an occluded
  ribbon under it carries the dark tone, and a thin black rim separates
  every ribbon edge and every over/under crossing so the weave reads as
  drawn, not merged. This is the family's colour-blind answer set: the
  pattern never knows which colour it is drawing — the authority block
  below resolves that from the engine's global colour palette, and every
  pixel this file emits is a scalar multiple of the single resolved triple.

  World geometry uses the all-smokestack ship frame only; raw coordinates
  appear once each to build it. Vintage fixtures carry three two-head ribbon
  segments with the same over/under rule, plus one rotating black separator
  head. Organ pixels are ordinary world-field pixels, so a stack flaring as
  a ribbon swings onto its bearing needs no dedicated branch. Both TE signs
  carry a three-strand mini braid running corner to corner with the same
  occlusion rule, byte-identical by address.
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
export var direction = 1.0;
export var level = 0.89;
export var braidAmount = 0.56;

export function sliderLocalSpeed(value) { localSpeed = value; }
export function sliderDirection(value) { direction = value; }
export function sliderLevel(value) { level = value; }
export function sliderBraidAmount(value) { braidAmount = value; }

var braidClock = 0.0;
var shimmerClock = 0.0;
var liveBraid = 0.56;

var z0 = 0.0, z1 = 0.0, z2 = 0.0;

// SPEED. OPERATOR FIELD RETUNE 2026-08-17 (report `_311`): +15% on the rig,
// applied to BOTH clocks so the braid and its Vintage separator keep step. The
// factor lives in these base rates, not in the saved sliders, so the playlist
// still loads at the reference point (the `_305` method). Pre-retune rates were
// 0.045 and 0.5.
//
// Base rates at the reference operating point (global SPEED 25,
// sliderLocalSpeed 0.30 -> product g*speedScale = 0.4225, docs/73 §4.2):
//   braidClock   0.05175 cycles/s -> 0.0219 cycles/s (~45.7 s/braid cycle) at
//                reference.
//   shimmerClock 0.575 units/s (Vintage separator-head rotation only).
// Worst case is the legal maximum product 8.0 (18.93x reference):
//   braidClock rises to 8x its reference rate; worst single-frame step (dt
//   clamps to 0.1s, speedScale maxes at 2.0x) = 0.1 * 0.05175 * 2.0 = 0.01035,
//   0.52% of the 2.0 wrap period — still an order inside the ceiling.
//   shimmerClock worst step 0.1 * 0.575 * 2.0 = 0.115, negligible against its
//   10000 wrap.
export function beforeRender(delta) {
  resolvePalette();
  var dt = min(0.1, max(0.0, delta / 1000.0));
  var speedScale = 0.35 + clamp01(localSpeed) * 1.65;
  var dirSign = 1.0;
  if (direction < 0.5) dirSign = -1.0;
  braidClock = braidClock + dt * 0.05175 * speedScale * dirSign;
  if (braidClock >= 2.0) braidClock = braidClock - 2.0;
  if (braidClock < 0.0) braidClock = braidClock + 2.0;
  shimmerClock = shimmerClock + dt * 0.575 * speedScale;
  if (shimmerClock >= 10000.0) shimmerClock = shimmerClock - 10000.0;
  liveLevel = clamp01(level);
  liveBraid = clamp01(braidAmount);

  z0 = cos(braidClock * PI2);
  z1 = cos(braidClock * PI2 + PI2 / 3.0);
  z2 = cos(braidClock * PI2 + PI2 * 2.0 / 3.0);
}

export function render3D(index, x, y, z) {
  if (fixtureType == FIX_VINTAGE_6) {
    var head = pixelLocalIndex % 6.0;
    var darkHead = floor(shimmerClock * 0.7) % 6.0;
    if (head == darkHead) { emitBlack(); return; }
    var ribbonIdx = floor(head / 2.0);
    var zHead = z0;
    if (ribbonIdx == 1.0) zHead = z1;
    if (ribbonIdx == 2.0) zHead = z2;
    var zTop = z0;
    if (z1 > zTop) zTop = z1;
    if (z2 > zTop) zTop = z2;
    var headLevel = 0.60 + wave(shimmerClock * 0.6 + head * 0.2) * 0.20;
    if (zHead >= zTop) { emitPrimary(headLevel + 0.16); return; }
    emitDark(headLevel);
    return;
  }

  if (fixtureType == FIX_TE_SIGN) {
    var signAddress = index % 74.0;
    var signX = (signAddress % 10.0) / 9.0;
    var signY = floor(signAddress / 10.0) / 7.0;
    var signAlong = (signX + signY) * 0.5;
    var signAcross = (signX - signY) * 0.5 + 0.5;
    var signArg = signAlong * PI2 * 3.2 - braidClock * PI2;
    var signC0 = 0.5 + 0.24 * sin(signArg);
    var signC1 = 0.5 + 0.24 * sin(signArg + PI2 / 3.0);
    var signC2 = 0.5 + 0.24 * sin(signArg + PI2 * 2.0 / 3.0);
    var signZ0 = cos(signArg);
    var signZ1 = cos(signArg + PI2 / 3.0);
    var signZ2 = cos(signArg + PI2 * 2.0 / 3.0);
    var signD0 = abs(signAcross - signC0);
    var signD1 = abs(signAcross - signC1);
    var signD2 = abs(signAcross - signC2);

    var signNearestD = signD0;
    var signNearZ = signZ0;
    if (signD1 < signNearestD) { signNearestD = signD1; signNearZ = signZ1; }
    if (signD2 < signNearestD) { signNearestD = signD2; signNearZ = signZ2; }

    var signHw = 0.075 + liveBraid * 0.075;
    if (signNearestD >= signHw) { emitBlack(); return; }
    var signEffHw = signHw - 0.02;
    if (signEffHw < 0.02) signEffHw = 0.02;
    if (signNearestD >= signEffHw) { emitBlack(); return; }

    var signTop = signZ0;
    if (signZ1 > signTop) signTop = signZ1;
    if (signZ2 > signTop) signTop = signZ2;

    if (signNearZ >= signTop) {
      emitPrimary(0.62 + (1.0 - signNearestD / signEffHw) * 0.30);
      return;
    }
    emitDark(0.58 + (1.0 - signNearestD / signEffHw) * 0.20);
    return;
  }

  var dx = x - SHIP_CENTER_X;
  var dz = z - SHIP_CENTER_Z;
  var shipLong = 0.50 + dx * SHIP_AXIS_X + dz * SHIP_AXIS_Z;
  var shipWide = 0.50 + dx * (-SHIP_AXIS_Z) + dz * SHIP_AXIS_X;
  var arg = shipLong * PI2 * 0.8 - braidClock * PI2;
  var c0 = 0.5 + 0.26 * sin(arg);
  var c1 = 0.5 + 0.26 * sin(arg + PI2 / 3.0);
  var c2 = 0.5 + 0.26 * sin(arg + PI2 * 2.0 / 3.0);
  var d0 = abs(shipWide - c0);
  var d1 = abs(shipWide - c1);
  var d2 = abs(shipWide - c2);

  var nearestD = d0;
  var nearZ = z0;
  if (d1 < nearestD) { nearestD = d1; nearZ = z1; }
  if (d2 < nearestD) { nearestD = d2; nearZ = z2; }

  var hw = 0.055 + liveBraid * 0.055;
  if (nearestD >= hw) { emitBlack(); return; }
  var effHw = hw - 0.012;
  if (effHw < 0.012) effHw = 0.012;
  if (nearestD >= effHw) { emitBlack(); return; }

  var top = z0;
  if (z1 > top) top = z1;
  if (z2 > top) top = z2;

  if (nearZ >= top) {
    emitPrimary(0.62 + (1.0 - nearestD / effHw) * 0.30);
    return;
  }
  emitDark(0.58 + (1.0 - nearestD / effHw) * 0.20);
}
