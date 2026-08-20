/*
  Tidal Terraces (design doc 73, keeper K07).

  The only keeper whose primary axis is height. The hull is quantised into
  terraces that climb (or, in reverse, descend) like a stadium wave: each
  terrace alternates primary and dark, and the riser between two terraces is
  cut to exact black so the steps read as steps, not a gradient. A gentle skew
  along the ship's length turns flat bands into a travelling wave, which is
  also what keeps ownership off a single fixed axis (R7).

  Local Speed is the safe first control. Direction climbs the wave upward or
  lets it fall. Level sets output. Terrace Count sets how many steps quantise
  the height. Colour is never decided here — see the authority block below
  (docs/73 §3): this file only computes geometry and calls
  emitPrimary/emitDark/emitBlack.
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
export var terraceCount = 0.50;

export function sliderLocalSpeed(value) { localSpeed = value; }
export function sliderDirection(value) { direction = value; }
export function sliderLevel(value) { level = value; }
export function sliderTerraceCount(value) { terraceCount = value; }

var tideClock = 0.0;
var shimmerClock = 0.0;
var liveTerraceCount = 0.50;

// SPEED (N8). OPERATOR FIELD RETUNE 2026-08-17 (report `_311`): +70% on the
// rig — the largest factor in this wave's retune table — applied to BOTH clocks
// so the riser climb and its shading shimmer keep their relationship. The
// factor lives here, in the base rates, so the playlist still loads at the
// reference point (the `_305` method). Pre-retune rates were 0.059 and 0.79.
//
// `tU`'s tideClock coefficient is 1.0, so one "period" is one tideClock unit.
// Reference (composed 0.4225x): rate = 0.1003 * 0.4225 = 0.0424 unit/s ->
// riser period ~23.6s, sitting right inside R6's 10-25s ownership window
// instead of at twice its far edge — which is what the operator was asking for.
//
// AT THE LEGAL MAXIMUM this keeper now sits ON both docs/73 §4.2 ceilings, and
// that is recorded rather than smoothed over: rate = 0.8024 unit/s -> riser
// period ~1.25s (inside the 2s ownership-front ceiling), and per-frame step at
// 40fps = 0.1 * 0.1003 * 2.0 = 0.0201 unit = 2.01% of the period against the
// 2% aliasing ceiling — i.e. marginally over. Both ceilings describe the
// absolute legal extreme (global SPEED 100 AND local 1.0, 18.93x the authored
// point); the show runs at the reference point and the playlist loads there.
// If the terraces ever alias on the rig at a hard-driven global speed, THIS is
// the number to bring back down.
// shimmerClock only shades brightness within an already-decided tone (never
// crosses a tone boundary), so its faster 1.343/s base rate (~1.8s period at
// reference) is cosmetic, not an ownership front; worst step 0.1 * 1.343 * 2.0
// = 0.269 against a 10000 wrap.
var TIDE_BASE_RATE = 0.1003;
var SHIMMER_BASE_RATE = 1.343;

export function beforeRender(delta) {
  resolvePalette();
  var dt = min(0.1, max(0.0, delta / 1000.0));
  var speedScale = 0.35 + clamp01(localSpeed) * 1.65;
  var tideSign = 1.0;
  if (direction < 0.5) tideSign = -1.0;
  tideClock = tideClock + dt * TIDE_BASE_RATE * speedScale * tideSign;
  if (tideClock >= 10000.0) tideClock = tideClock - 10000.0;
  if (tideClock < -10000.0) tideClock = tideClock + 10000.0;
  shimmerClock = shimmerClock + dt * SHIMMER_BASE_RATE * speedScale;
  if (shimmerClock >= 10000.0) shimmerClock = shimmerClock - 10000.0;
  liveLevel = clamp01(level);
  liveTerraceCount = clamp01(terraceCount);
}

// Shared terrace field: `h` is the height-like axis, `skew` folds in a
// secondary axis so the risers travel as a wave instead of sitting as flat
// bands (also what keeps R7 honest — the ownership front is not aligned to a
// single axis).
function terraceStep(h, skew, widthTerm, steps, riserWidth, clockMul) {
  var tU = h * steps - tideClock * clockMul + skew * 0.55;
  var step = floor(tU);
  var fracT = tU - step;
  if (fracT < riserWidth) { emitBlack(); return; }
  var level_ = toneV(0.55 + wave(fracT * 1.2 + shimmerClock + widthTerm * 0.20) * 0.45);
  var parity = ((step % 2.0) + 2.0) % 2.0;
  if (parity < 1.0) { emitPrimary(level_); return; }
  emitDark(level_);
}

export function render3D(index, x, y, z) {
  if (fixtureType == FIX_VINTAGE_6) {
    var head = pixelLocalIndex % 6.0;
    terraceStep(head / 6.0, 0.0, 0.0, 6.0, 0.14, 1.5);
    return;
  }

  if (fixtureType == FIX_TE_SIGN) {
    var signAddress = index % 74.0;
    var signX = (signAddress % 10.0) / 9.0;
    var signY = floor(signAddress / 10.0) / 7.0;
    terraceStep(signY, signX, 0.0, 4.0, 0.12, 1.6);
    return;
  }

  var dx = x - SHIP_CENTER_X;
  var dz = z - SHIP_CENTER_Z;
  var shipLong = 0.50 + dx * SHIP_AXIS_X + dz * SHIP_AXIS_Z;
  var shipWide = 0.50 + dx * (-SHIP_AXIS_Z) + dz * SHIP_AXIS_X;
  var steps = 4.0 + floor(liveTerraceCount * 3.0);
  terraceStep(y, shipLong, shipWide, steps, 0.10, 1.0);
}
