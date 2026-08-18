/*
  Rose Unfurl (design doc 73, keeper K02).

  A great rose of counter-wound petals opens and closes over the whole ship.
  A five-fold rose curve in the ship's top plane sets the petal boundary; a
  slow breathing clock scales how far each petal reaches out from the
  ship's heart, so the whole flower unfurls and folds back. The petal face
  carries the bright tone, the petal's under-curl carries the dark tone, and
  a one-pixel black rib at every petal seam keeps the five lobes visually
  separate instead of smearing into a disc. This is the family's
  colour-blind answer set: the pattern never knows which colour it is
  drawing — the authority block below resolves that from the engine's global
  colour palette, and every pixel this file emits is a scalar multiple of
  the single resolved triple.

  World geometry uses the all-smokestack ship frame only; raw coordinates
  appear once each to build it. Vintage fixtures carry a six-head radial fan
  (three bright, two dark, one black) that rotates with the spin clock.
  Because the smokestacks sit outside the rose's mean reach, they read as a
  five-beat metronome each revolution as a petal tip sweeps their bearing —
  no dedicated branch required. Both TE signs carry a small five-petal
  breathing rose on the same clocks, byte-identical by address.
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
export var level = 0.87;
export var petalWidth = 0.52;

export function sliderLocalSpeed(value) { localSpeed = value; }
export function sliderDirection(value) { direction = value; }
export function sliderLevel(value) { level = value; }
export function sliderPetalWidth(value) { petalWidth = value; }

var spinClock = 0.0;
var breathClock = 0.0;
var livePetal = 0.52;

// SPEED. Base rates at the reference operating point (global SPEED 25,
// sliderLocalSpeed 0.30 -> product g*speedScale = 0.4225, docs/73 §4.2):
//   spinClock   0.06 turns/s -> 0.02535 turns/s (~39.5 s/revolution) at ref.
//   breathClock 0.09 cycles/s -> 0.0380 cycles/s (~26.3 s open-close) at ref.
// Worst case is the legal maximum product 8.0 (18.93x reference):
//   spinClock -> 0.48 turns/s; worst single-frame step (dt clamps to 0.1s,
//   speedScale maxes at 2.0x) = 0.1 * 0.06 * 2.0 = 0.012 turns, 0.6% of the
//   2.0 wrap period.
//   breathClock -> 0.72 cycles/s; worst step 0.1 * 0.09 * 2.0 = 0.018,
//   0.9% of the 2.0 wrap period. Both bounded; no aliasing risk.
export function beforeRender(delta) {
  resolvePalette();
  var dt = min(0.1, max(0.0, delta / 1000.0));
  var speedScale = 0.35 + clamp01(localSpeed) * 1.65;
  var dirSign = 1.0;
  if (direction < 0.5) dirSign = -1.0;
  spinClock = spinClock + dt * 0.06 * speedScale * dirSign;
  if (spinClock >= 2.0) spinClock = spinClock - 2.0;
  if (spinClock < 0.0) spinClock = spinClock + 2.0;
  breathClock = breathClock + dt * 0.09 * speedScale;
  if (breathClock >= 2.0) breathClock = breathClock - 2.0;
  liveLevel = clamp01(level);
  livePetal = clamp01(petalWidth);
}

export function render3D(index, x, y, z) {
  if (fixtureType == FIX_VINTAGE_6) {
    var head = pixelLocalIndex % 6.0;
    var headPhase = (head + floor(spinClock * 6.0)) % 6.0;
    var headLevel = 0.60 + wave(breathClock + head * 0.13) * 0.22;
    if (headPhase < 3.0) { emitPrimary(headLevel + 0.16); return; }
    if (headPhase < 5.0) { emitDark(headLevel); return; }
    emitBlack();
    return;
  }

  if (fixtureType == FIX_TE_SIGN) {
    var signAddress = index % 74.0;
    var signX = (signAddress % 10.0) / 9.0;
    var signY = floor(signAddress / 10.0) / 7.0;
    var signAng = atan2(signY - 0.50, signX - 0.50) / PI2 + 0.50;
    var signDX = signX - 0.50;
    var signDY = signY - 0.50;
    var signRad = sqrt(signDX * signDX * 1.30 + signDY * signDY);
    var signRose = abs(cos(signAng * PI2 * 2.5 + spinClock * PI2));
    var signEdge = signRose * (0.30 + livePetal * 0.34) + 0.10;
    var signUnfurl = 0.55 + wave(breathClock * 1.4) * 0.35;
    var signReach = signEdge * signUnfurl;
    if (signRose < 0.06) { emitBlack(); return; }
    if (signRad < signReach) { emitPrimary(0.60 + (1.0 - signRad / signReach) * 0.40); return; }
    if (signRad < signReach * 1.75) { emitDark(0.58 + wave(signRad * 3.0 - breathClock) * 0.22); return; }
    emitBlack();
    return;
  }

  var dx = x - SHIP_CENTER_X;
  var dz = z - SHIP_CENTER_Z;
  var shipLong = 0.50 + dx * SHIP_AXIS_X + dz * SHIP_AXIS_Z;
  var shipWide = 0.50 + dx * (-SHIP_AXIS_Z) + dz * SHIP_AXIS_X;
  var ang = atan2(shipWide - 0.50, shipLong - 0.50) / PI2 + 0.50;
  var radialL = (shipLong - 0.50) * 1.15;
  var radialY = (y - 0.52) * 0.90;
  var radialW = (shipWide - 0.50) * 0.80;
  var rad = sqrt(radialL * radialL + radialY * radialY + radialW * radialW);
  var rose = abs(cos(ang * PI2 * 2.5 + spinClock * PI2));
  var edge = rose * (0.30 + livePetal * 0.34) + 0.10;
  var unfurl = 0.55 + wave(breathClock) * 0.35;
  var reach = edge * unfurl;
  if (rose < 0.06) { emitBlack(); return; }
  if (rad < reach) { emitPrimary(0.60 + (1.0 - rad / reach) * 0.40); return; }
  // Widened from the docs/73 K02 starting point (reach*1.42): measured on
  // the real titanic model, "Right Small SmokeStack" — a 4-pixel accent at
  // the extreme stern corner (rad ~0.88-0.9) — sat just outside the dark
  // band's outer edge at every phase and was permanently black.
  if (rad < reach * 1.75) { emitDark(0.58 + wave(rad * 3.0 - breathClock) * 0.22); return; }
  emitBlack();
}
