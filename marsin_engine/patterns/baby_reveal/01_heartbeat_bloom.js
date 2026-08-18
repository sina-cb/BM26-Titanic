/*
  Heartbeat Bloom (design doc 73, keeper K01).

  A heartbeat blooms out of the ship's heart in nested shells, twice per
  beat. A cardiac envelope launches a shell train outward from the ship's
  radial centre on every thump; the shell face carries the bright tone, the
  body just behind the front carries the dark tone, and a faint echo train
  (half amplitude, half a shell behind) keeps the black gaps alive between
  beats. This is the family's colour-blind answer set: the pattern never
  knows which colour it is drawing — the authority block below resolves that
  from the engine's global colour palette, and every pixel this file emits
  is a scalar multiple of the single resolved triple.

  World geometry uses the all-smokestack ship frame only; raw coordinates
  appear once each to build it. The radial term mixes hull length, height
  and ship width so neither rig's degenerate axis can flatten the bloom.
  Vintage fixtures pass the shell front head to head with one rotating black
  separator head. Because the outermost shells are the ones that have
  travelled furthest by the time they reach the smokestacks, each thump's
  arrival there reads as the pattern's downbeat, chaining bottom-to-top up
  the PAR stacks with no dedicated branch required. Both TE signs carry a
  small thump-synced bullseye on the same clock, byte-identical by address.
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
export var level = 0.88;
export var bloomSharpness = 0.50;
export var echoDepth = 0.58;

export function sliderLocalSpeed(value) { localSpeed = value; }
export function sliderLevel(value) { level = value; }
export function sliderBloomSharpness(value) { bloomSharpness = value; }
export function sliderEchoDepth(value) { echoDepth = value; }

var beatClock = 0.0;
var shimmerClock = 0.0;
var liveSharpness = 0.50;
var liveEcho = 0.58;
var thump = 0.0;

// SPEED. OPERATOR FIELD RETUNE 2026-08-17 (report `_311`): Sina watched this
// keeper on the rig and called it "toooooo fast" without naming a number, so
// both clocks were scaled by 0.45x — an ESTIMATE, and the only estimate in this
// wave's retune table. The factor lives HERE, in the internal base rates, so the
// playlist still loads at the reference operating point (the `_305` method); if
// the rig says otherwise it is these two numbers that move, not the sliders.
// Pre-retune rates were 1.4675 and 0.45.
//
// Base rates at the reference operating point (global SPEED 25,
// sliderLocalSpeed 0.30 -> product g*speedScale = 0.4225, docs/73 §4.2):
//   beatClock    0.6604 beat-units/s -> 0.2790 beat/s (~16.7 bpm — a slow,
//                deliberate pulse, well under a resting heart) at reference.
//   shimmerClock 0.2025 units/s (cosmetic shimmer texture only, not a phase
//                the tone thresholds key off directly).
// Worst case is the legal maximum product 8.0 (18.93x reference):
//   beatClock -> 5.28 beat/s; worst single-frame step (dt clamps to 0.1s,
//   speedScale maxes at 2.0x) = 0.1 * 0.6604 * 2.0 = 0.1321 beat-units, i.e.
//   6.6% of the 2.0 wrap period — the retune HALVED this keeper's worst-case
//   step (it was 14.7%), so the runaway margin only improved.
//   shimmerClock worst step 0.1 * 0.2025 * 2.0 = 0.0405 units, negligible
//   against its 10000 wrap (it only offsets a shading wave).
function beatPulse(phase, start, end) {
  if (phase < start) return 0.0;
  if (phase > end) return 0.0;
  var width = end - start;
  if (width <= 0.0) return 0.0;
  var u = (phase - start) / width;
  return 0.5 - 0.5 * cos(u * PI2);
}

export function beforeRender(delta) {
  resolvePalette();
  var dt = min(0.1, max(0.0, delta / 1000.0));
  var speedScale = 0.35 + clamp01(localSpeed) * 1.65;
  beatClock = beatClock + dt * 0.6604 * speedScale;
  if (beatClock >= 2.0) beatClock = beatClock - 2.0;
  shimmerClock = shimmerClock + dt * 0.2025 * speedScale;
  if (shimmerClock >= 10000.0) shimmerClock = shimmerClock - 10000.0;
  liveLevel = clamp01(level);
  liveSharpness = clamp01(bloomSharpness);
  liveEcho = clamp01(echoDepth);
  var beat = beatClock - floor(beatClock);
  // TASK #69 SCANNER: this line matches the miscompile shape (a user function
  // with internal `var`s called as a NON-LEADING operand) and is a VERIFIED
  // FALSE POSITIVE — report `_311` §6.4 rewrote both calls to named variables
  // and the result rendered BYTE-IDENTICALLY over 49 sampled frames. Whatever
  // the real trigger is, `beatPulse`'s locals sitting behind early `return`s
  // does not hit it. Leave as written; `04_bubble_chorus` is the real instance.
  thump = beatPulse(beat, 0.00, 0.09) * 1.0 + beatPulse(beat, 0.17, 0.24) * 0.72;
}

export function render3D(index, x, y, z) {
  if (fixtureType == FIX_VINTAGE_6) {
    var head = pixelLocalIndex % 6.0;
    var dist = min(head, 5.0 - head);
    var darkHead = floor(shimmerClock * 0.8) % 6.0;
    if (head == darkHead) { emitBlack(); return; }
    var headU = dist * (1.4 + liveSharpness * 0.8) + 8.0 - beatClock * 2.0;
    var headShell = headU - floor(headU);
    if (headShell < 0.20) { emitPrimary(0.62 + thump * 0.38); return; }
    if (headShell < 0.55) { emitDark(0.60 + wave(headU * 0.8 + shimmerClock) * 0.28); return; }
    emitBlack();
    return;
  }

  if (fixtureType == FIX_TE_SIGN) {
    var signAddress = index % 74.0;
    var signX = (signAddress % 10.0) / 9.0;
    var signY = floor(signAddress / 10.0) / 7.0;
    var signDX = (signX - 0.50) * 1.15;
    var signDY = (signY - 0.50) * 0.90;
    var signR = sqrt(signDX * signDX + signDY * signDY);
    var signShellU = signR * 7.5 + 8.0 - beatClock * 3.0;
    var signShell = signShellU - floor(signShellU);
    if (signShell < 0.16) { emitPrimary(0.62 + thump * 0.38); return; }
    if (signShell < 0.46) { emitDark(0.58 + wave(signShellU * 0.8 + shimmerClock) * 0.26); return; }
    emitBlack();
    return;
  }

  var dx = x - SHIP_CENTER_X;
  var dz = z - SHIP_CENTER_Z;
  var shipLong = 0.50 + dx * SHIP_AXIS_X + dz * SHIP_AXIS_Z;
  var shipWide = 0.50 + dx * (-SHIP_AXIS_Z) + dz * SHIP_AXIS_X;
  var radialL = (shipLong - 0.50) * 1.15;
  var radialY = (y - 0.52) * 0.90;
  var radialW = (shipWide - 0.50) * 0.80;
  var r = sqrt(radialL * radialL + radialY * radialY + radialW * radialW);
  var shellU = r * (2.6 + liveSharpness * 1.8) + 8.0 - beatClock * 2.0;
  var shell = shellU - floor(shellU);
  if (shell < 0.16) { emitPrimary(0.62 + thump * 0.38); return; }
  if (shell < 0.46) { emitDark(0.60 + wave(shellU * 0.8 + shimmerClock) * 0.30); return; }
  var echoWidth = 0.03 + liveEcho * 0.13;
  var shellU2 = shellU + 0.5;
  var shell2 = shellU2 - floor(shellU2);
  if (shell2 < echoWidth) { emitDark(0.55 + wave(shellU2 * 0.8 + shimmerClock + 0.5) * 0.20); return; }
  emitBlack();
}
