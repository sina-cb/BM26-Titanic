/*
  Celebration Burst (design doc 73, keeper K10 — the finale).

  Three launch sites spaced along the ship's length fire a staggered impulse
  train: each shell's rim is the primary tone (freshest = brightest), an
  angular ray comb inside a still-growing shell is the dark tone, and
  everything else is black — the night the shells are climbing through.

  Local Speed is the safe first control. Level sets output. Burst Width
  thickens the rim and adds more rays. Burst Reach sets how far a shell grows
  before it resets. Colour is never decided here — see the authority block
  below (docs/73 §3): this file only computes geometry and calls
  emitPrimary/emitDark/emitBlack.

  Density note (docs/73 §5 K10): this is the busiest keeper in the set, and
  the rim width stays at the spec's value so the primary tone never bloats
  into a solid disc — "thin the rays, not the rims." The ray duty cycle
  (frac(rayU) < RAY_DUTY) is the one number changed from the spec's literal
  0.30: measured on titanic, 0.30 put only 18.3% of lit mass in the dark
  tone against G5's 20% floor (the rim was reading as three thin bright
  circles with too little ray fill behind them); 0.38 measured 19.7%, 0.44
  measured 23.1%. RAY_DUTY ships at 0.52, measured at 27.0% dark / 73.0%
  bright / 0.0% valley / 5.85:1 tonal ratio — real headroom above the floor,
  not a hairline pass. See the implementation report for the measurements.

  Coverage note (docs/73 §5 K10, and the general N-check for moving-body
  keepers): the literal spec radius `R_k = burstReach*0.62*pow(age,0.62)`
  left several titanic named regions (both Small SmokeStacks, Right
  Auditorium, all four silhouette corners, half of every Vintage fixture)
  permanently unlit over a 200s/4 full-cycle capture — the shells never grew
  far enough to reach them. The world path's rim-reach multiplier (2.4x) and
  the Vintage local radius multiplier (5.5x, up from a first attempt at
  3.0x, which still left the two centre heads on every Vintage permanently
  black — see burstSite's `localR`) are both raised past the spec's implied
  reach for exactly this reason; measured full coverage of every named
  region afterward. See the implementation report for the measurements.
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
export var level = 0.92;
export var burstWidth = 0.52;
export var burstReach = 0.64;

export function sliderLocalSpeed(value) { localSpeed = value; }
export function sliderLevel(value) { level = value; }
export function sliderBurstWidth(value) { burstWidth = value; }
export function sliderBurstReach(value) { burstReach = value; }

var burstClock = 0.0;
var liveWidth = 0.52;
var liveReach = 0.64;

// SPEED (N8). `ageK = frac(burstClock*0.5 + k/3)` has period 2.0 burstClock
// units per shell cycle (coefficient 0.5). Base rate 0.118/s. Reference
// (composed 0.4225x): rate = 0.118 * 0.4225 = 0.0499 unit/s -> shell cycle
// = 2.0/0.0499 ~= 40.1s, showing a full launch-to-reset arc across the
// review window while still reading as motion well inside R6's 10-25s
// floor. Legal maximum (18.93x reference): rate = 0.944 unit/s -> shell
// cycle ~= 2.12s (>= the 2s ownership-front ceiling); per-frame step at
// 40fps expressed as a fraction of the 2.0-unit cycle = (0.944/40)/2.0 =
// 0.0118, under the 0.02-of-period aliasing ceiling.
var BURST_BASE_RATE = 0.118;
var RAY_DUTY = 0.52; // changed from the docs/73 §5 literal 0.30 — see the
                      // density note above (G5 two-tone dark-mass floor).

export function beforeRender(delta) {
  resolvePalette();
  var dt = min(0.1, max(0.0, delta / 1000.0));
  var speedScale = 0.35 + clamp01(localSpeed) * 1.65;
  burstClock = burstClock + dt * BURST_BASE_RATE * speedScale;
  if (burstClock >= 10000.0) burstClock = burstClock - 10000.0;
  liveLevel = clamp01(level);
  liveWidth = clamp01(burstWidth);
  liveReach = clamp01(burstReach);
}

// One launch site's shell+ray field against a pixel already expressed in
// (pu, pv, pw) — the same coordinate space the site centre `(cu, cv, cw)`
// lives in. `siteK` selects the staggered age offset (0, 1/3, 2/3).
function burstSite(pu, pv, pw, cu, cv, cw, siteK, rimScale, rayReach, rimW) {
  var ageU = burstClock * 0.5 + siteK / 3.0;
  var age = ageU - floor(ageU);
  var rK = rayReach * 0.62 * pow(age, 0.62) * rimScale;
  var du = pu - cu;
  var dv = pv - cv;
  var dw = pw - cw;
  var d = hypot3(du, dv, dw);
  if (abs(d - rK) < rimW) { return 2.0 + (0.68 + (1.0 - age) * 0.32); }
  if (d < rK) {
    var rayCount = 7.0 + floor(liveWidth * 5.0);
    var ang = atan2(dw, du) / PI2 + 0.5;
    var rayU = ang * rayCount + siteK * 0.13;
    var rayFrac = rayU - floor(rayU);
    if (rayFrac < RAY_DUTY) { return 1.0 + (0.55 + (1.0 - age) * 0.30); }
  }
  return 0.0;
}

function bestOfThreeBursts(pu, pv, pw, c0u, c1u, c2u, cv, cw, rimScale, rayReach, rimW) {
  var s0 = burstSite(pu, pv, pw, c0u, cv, cw, 0.0, rimScale, rayReach, rimW);
  var s1 = burstSite(pu, pv, pw, c1u, cv, cw, 1.0, rimScale, rayReach, rimW);
  var s2 = burstSite(pu, pv, pw, c2u, cv, cw, 2.0, rimScale, rayReach, rimW);
  var best = s0;
  if (s1 > best) best = s1;
  if (s2 > best) best = s2;
  if (best >= 2.0) { emitPrimary(best - 2.0); return; }
  if (best >= 1.0) { emitDark(best - 1.0); return; }
  emitBlack();
}

export function render3D(index, x, y, z) {
  if (fixtureType == FIX_VINTAGE_6) {
    var head = pixelLocalIndex % 6.0;
    var distFromEnd = min(head, 5.0 - head);
    var ageU = burstClock * 0.5;
    var age = ageU - floor(ageU);
    var localR = liveReach * 0.62 * pow(age, 0.62) * 5.5;
    var rimW = 0.35 + liveWidth * 0.35;
    if (abs(distFromEnd - localR) < rimW) { emitPrimary(0.68 + (1.0 - age) * 0.32); return; }
    if (distFromEnd < localR) { emitDark(0.55 + (1.0 - age) * 0.30); return; }
    emitBlack();
    return;
  }

  if (fixtureType == FIX_TE_SIGN) {
    var signAddress = index % 74.0;
    var signX = (signAddress % 10.0) / 9.0;
    var signY = floor(signAddress / 10.0) / 7.0;
    bestOfThreeBursts(signX, signY, 0.5, 0.22, 0.50, 0.78, 0.5, 0.5, 1.40, 0.62, 0.06);
    return;
  }

  var dx = x - SHIP_CENTER_X;
  var dz = z - SHIP_CENTER_Z;
  var shipLong = 0.50 + dx * SHIP_AXIS_X + dz * SHIP_AXIS_Z;
  var shipWide = 0.50 + dx * (-SHIP_AXIS_Z) + dz * SHIP_AXIS_X;
  var rimW = 0.030 + liveWidth * 0.030;
  bestOfThreeBursts(shipLong, y, shipWide, 0.18, 0.50, 0.82, 0.5, 0.5, 2.4, liveReach, rimW);
}
