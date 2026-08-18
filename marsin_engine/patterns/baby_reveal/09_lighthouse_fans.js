/*
  Lighthouse Fans (design doc 73, keeper K09).

  Rotating lighthouse blades sweep the whole ship through crisp black
  shutters. A blade is the primary tone; the wake immediately behind it (in
  the direction of travel) is the dark tone; everything else is the shutter,
  exact black. A `trailFrac` coordinate — zero the instant a blade passes a
  pixel, increasing with elapsed time since — is what lets the wake always
  trail correctly whether the fan spins forward or in reverse, without ever
  swapping which numeric band means "blade" (see the direction handling
  below).

  Local Speed is the safe first control. Direction reverses the spin (below
  0.5 reverses) and keeps the wake trailing. Level sets output. Fan Count
  picks how many blades share the sweep. Colour is never decided here — see
  the authority block below (docs/73 §3): this file only computes geometry
  and calls emitPrimary/emitDark/emitBlack.
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
export var level = 0.90;
export var fanCount = 0.45;

export function sliderLocalSpeed(value) { localSpeed = value; }
export function sliderDirection(value) { direction = value; }
export function sliderLevel(value) { level = value; }
export function sliderFanCount(value) { fanCount = value; }

var spinClock = 0.0;
var breathClock = 0.0;
var liveFanCount = 0.45;
var dirForward = 1.0;

// SPEED (N8). `u`'s spinClock coefficient is 1.0, so one "period" is one
// spinClock unit (one blade passing a fixed point). Base rate 0.059/s.
// Reference (composed 0.4225x): rate = 0.059 * 0.4225 = 0.0249 unit/s ->
// blade period ~40.1s, comfortably inside R6's 10-25s "visible motion"
// floor well before a full lap. Legal maximum (18.93x reference): rate =
// 0.471 unit/s -> blade period ~2.12s (>= the 2s ownership-front ceiling);
// per-frame step at 40fps = 0.471/40 = 0.0118 unit, under the
// 0.02-of-period aliasing ceiling. breathClock only nudges the blade edge by
// +-0.05 turns (cosmetic scallop, not a tone boundary), so its faster
// 0.79/s base rate is not an ownership front.
var SPIN_BASE_RATE = 0.059;
var BREATH_BASE_RATE = 0.79;

export function beforeRender(delta) {
  resolvePalette();
  var dt = min(0.1, max(0.0, delta / 1000.0));
  var speedScale = 0.35 + clamp01(localSpeed) * 1.65;
  var spinSign = 1.0;
  if (direction < 0.5) spinSign = -1.0;
  spinClock = spinClock + dt * SPIN_BASE_RATE * speedScale * spinSign;
  if (spinClock >= 10000.0) spinClock = spinClock - 10000.0;
  if (spinClock < -10000.0) spinClock = spinClock + 10000.0;
  breathClock = breathClock + dt * BREATH_BASE_RATE * speedScale;
  if (breathClock >= 10000.0) breathClock = breathClock - 10000.0;
  liveLevel = clamp01(level);
  liveFanCount = clamp01(fanCount);
  dirForward = 1.0;
  if (direction < 0.5) dirForward = 0.0;
}

// Shared blade sweep. `ang` is a top-plane bearing in turns (0..1); `rad`
// feeds the depth contour that shades the blade band only (never the
// boundary — R3). `blades`/`blockClock`/`wakeWidth` let the Vintage/Sign
// branches drive a different blade count and spin multiplier than the world
// path while sharing the same trailFrac trick.
function fanSweep(ang, rad, wobble, blades, blockClock, primaryBand, wakeBand) {
  var u = ang * blades + blockClock + wobble;
  var fracU = u - floor(u);
  var trailFrac = fracU;
  if (dirForward < 0.5) trailFrac = 1.0 - fracU;
  if (trailFrac < primaryBand) {
    var contour = wave(rad * 2.1 - breathClock * 0.42 + wobble * 0.6);
    emitPrimary(toneV(contour));
    return;
  }
  if (trailFrac < wakeBand) {
    var wakeShape = 1.0 - (trailFrac - primaryBand) / (wakeBand - primaryBand);
    emitDark(toneV(wakeShape));
    return;
  }
  emitBlack();
}

export function render3D(index, x, y, z) {
  if (fixtureType == FIX_VINTAGE_6) {
    var head = pixelLocalIndex % 6.0;
    fanSweep(head / 6.0, head / 5.0, 0.0, 6.0, spinClock * 1.5, 0.22, 0.55);
    return;
  }

  if (fixtureType == FIX_TE_SIGN) {
    var signAddress = index % 74.0;
    var signX = (signAddress % 10.0) / 9.0;
    var signY = floor(signAddress / 10.0) / 7.0;
    var signDX = signX - 0.5;
    var signDY = signY - 0.5;
    var signAng = atan2(signDY, signDX) / PI2 + 0.5;
    var signRad = hypot(signDX, signDY);
    fanSweep(signAng, signRad, 0.0, 4.0, spinClock / 3.0, 0.24, 0.55);
    return;
  }

  var dx = x - SHIP_CENTER_X;
  var dz = z - SHIP_CENTER_Z;
  var shipLong = 0.50 + dx * SHIP_AXIS_X + dz * SHIP_AXIS_Z;
  var shipWide = 0.50 + dx * (-SHIP_AXIS_Z) + dz * SHIP_AXIS_X;
  var ang = atan2(shipWide - 0.5, shipLong - 0.5) / PI2 + 0.5;
  var rad = hypot(shipLong - 0.5, shipWide - 0.5);
  var blades = 3.0 + floor(liveFanCount * 3.0);
  var wobble = sin(y * PI2 + breathClock * 0.7) * 0.05;
  fanSweep(ang, rad, wobble, blades, spinClock, 0.22, 0.55);
}
