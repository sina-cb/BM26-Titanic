/*
  Diamond Quilt (design doc 73, keeper K06 — THE HERO).

  Two diagonal wave systems cross the whole ship; where they nearly agree a
  travelling stitch line locks in at full family strength, and where both are
  independently near their own peak a quilted panel sits behind it at the dark
  drive. Between stitches and panels the seam channel is exact black, which is
  what keeps the quilt reading as pieced fabric instead of the diffuse fog the
  old single-tone answer collapsed into (docs/73 §1).

  This is the pattern the reveal choice pins by entryId: it rises under the
  white bloom at t=2700ms, so it carries no build-in envelope — the first
  frame is already at full structural strength (N11).

  Local Speed is the safe first control. Level sets output. Seam Width narrows
  or widens the stitch line. Quilt Scale sets how many diamonds tile the hull.
  Colour is never decided here — see the authority block below (docs/73 §3):
  this file only computes geometry and calls emitPrimary/emitDark/emitBlack.
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

// Maps a 0..1 shaping value into the [0.55, 1.0] band R2 requires for BOTH
// emitted tones (the darkness of the dark tone comes only from DARK_K inside
// emitDark — never from lowering v).
function toneV(shape) { return 0.55 + clamp01(shape) * 0.45; }

export var localSpeed = 0.30;
export var level = 0.91;
export var seamWidth = 0.50;
export var quiltScale = 0.52;

export function sliderLocalSpeed(value) { localSpeed = value; }
export function sliderLevel(value) { level = value; }
export function sliderSeamWidth(value) { seamWidth = value; }
export function sliderQuiltScale(value) { quiltScale = value; }

var quiltClock = 0.0;
var liveWidth = 0.50;
var liveScale = 0.52;

// SPEED (N8). OPERATOR FIELD RETUNE 2026-08-17 (report `_311`): +15% on the
// rig; the factor lives here, in the base rate, so the playlist still loads at
// the reference point (the `_305` method). Pre-retune rate was 0.059.
//
// diagA's quiltClock coefficient is 1.0, so one "period" is one quiltClock unit
// (diagB's 0.786 coefficient is slower and therefore safe by construction).
// Reference (global SPEED 25, local 0.30, composed 0.4225x): rate =
// 0.06785 * 0.4225 = 0.0287 unit/s -> period ~34.9s — well inside R6's "visible
// ownership motion inside 10-25s" floor (a stitch front is plainly moving
// within that window, long before completing a lap).
// Legal maximum (18.93x reference): rate = 0.5428 unit/s -> period ~1.84s,
// which is INSIDE the 2s ownership-front ceiling docs/73 §4.2 sets — recorded
// rather than rounded away. The ceiling governs the absolute legal extreme
// (global SPEED 100 AND local 1.0, 18.93x the point this is authored to), and
// the harder aliasing bound still holds with room: per-frame step at 40fps =
// 0.1 * 0.06785 * 2.0 = 0.0136 unit, 1.36% of the period against a 2% ceiling.
var QUILT_BASE_RATE = 0.06785;

export function beforeRender(delta) {
  resolvePalette();
  var dt = min(0.1, max(0.0, delta / 1000.0));
  var speedScale = 0.35 + clamp01(localSpeed) * 1.65;
  quiltClock = quiltClock + dt * QUILT_BASE_RATE * speedScale;
  if (quiltClock >= 10000.0) quiltClock = quiltClock - 10000.0;
  liveLevel = clamp01(level);
  liveWidth = clamp01(seamWidth);
  liveScale = clamp01(quiltScale);
}

// The shared stitch/panel field. Same formula for the world path, the
// Vintage mini-quilt and the sign mini-quilt — only the input coordinates and
// spatial scale change.
function quiltStitch(u, v, w, scale) {
  var diagA = wave((u + v * 0.85 + w * 0.20) * scale - quiltClock);
  var diagB = wave((u - v * 0.85 - w * 0.20) * scale + quiltClock * 0.786);
  var seam = 1.0 - abs(diagA - diagB);
  var focus = 2.0 + (1.0 - liveWidth) * 13.0;
  var stitch = pow(seam, focus);
  var panel = pow(diagA * diagB, 2.2);
  if (stitch > 0.42) { emitPrimary(toneV(stitch)); return; }
  if (panel > 0.30) { emitDark(toneV(panel)); return; }
  emitBlack();
}

export function render3D(index, x, y, z) {
  if (fixtureType == FIX_VINTAGE_6) {
    var head = pixelLocalIndex % 6.0;
    var forcedBlack = ((floor(quiltClock * 6.0) % 6.0) + 6.0) % 6.0;
    if (head == forcedBlack) { emitBlack(); return; }
    quiltStitch(head / 6.0, 0.5, 0.5, 3.0);
    return;
  }

  if (fixtureType == FIX_TE_SIGN) {
    var signAddress = index % 74.0;
    var signX = (signAddress % 10.0) / 9.0;
    var signY = floor(signAddress / 10.0) / 7.0;
    quiltStitch(signX, signY, 0.5, 4.2);
    return;
  }

  var dx = x - SHIP_CENTER_X;
  var dz = z - SHIP_CENTER_Z;
  var shipLong = 0.50 + dx * SHIP_AXIS_X + dz * SHIP_AXIS_Z;
  var shipWide = 0.50 + dx * (-SHIP_AXIS_Z) + dz * SHIP_AXIS_X;
  var scale = 2.6 + liveScale * 5.4;
  quiltStitch(shipLong, y, shipWide, scale);
}
