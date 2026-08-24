/*
  144_soliton_train.js — "Soliton Train"

  KdV SOLITONS — shallow-water solitary waves, the analytic sech-squared humps
  that keep their shape forever. The physics that makes them worth putting on a
  wall: a soliton's SPEED is set by its HEIGHT, so a tall one catches a short one,
  passes straight THROUGH it, and both come out the other side unchanged (only
  shifted along) instead of breaking. Five solitons per module, launched on
  irrational cadences, do that to each other continuously.

  GEOMETRY (rig-agnostic — normalized render3D coords only)
    u = x        position along the line (0..1 over the whole 330 px run).
    SEAM         the travel coordinate is CONTINUOUS across it (SEG2_FLOW), so a
                 soliton compresses slightly downstream, exactly as a wave does
                 when the channel narrows.
    moduleId     derived from z alone: floor(nz * 6) clamped to 0..5.
    Per-module character: launch cadence and amplitude set are irrational
    functions of moduleId, and below `cohesion` 0.5 the odd modules run against
    the `direction` knob — the +,-,+,-,+,- pattern. Both close as `cohesion` -> 1,
    where the six lines carry one identical train.

  Nothing here reads fixtureType, section, group or index, so the composition is
  identical on test_bench / titanic / any other model.

AUDIO_MODULATION_V1:
  sliderAmplitude <- micLow range 0.35..0.90 curve ease  # the low band raises the humps (and speeds them up)
  # STATIC: localSpeed, direction, spacing, cohesion, whiteFoam, moduleHueShift, hueShiftFreq, colorPalette1/2
*/

// Export order is physical MIDI order. Local Speed is always first, Direction
// always second; the shared per-module hue shift pair is always declared LAST.
export var localSpeed = 0.42;
export var direction = 0.74;
export var amplitude = 0.35;
export var spacing = 0.45;
export var cohesion = 0.35;
export var whiteFoam = 0.34;
export var moduleHueShift = 0.50;
export var hueShiftFreq = 0.30;

export var cp1H = 0.55, cp1S = 1.00, cp1V = 0.90; // deep teal-blue channel water
export var cp2H = 0.09, cp2S = 0.50, cp2V = 1.00; // warm amber-white soliton crown
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderDirection(v) { direction = v; }
export function sliderAmplitude(v) { amplitude = v; }
export function sliderSpacing(v) { spacing = v; }
export function sliderCohesion(v) { cohesion = v; }
export function sliderWhiteFoam(v) { whiteFoam = v; }
export function sliderModuleHueShift(v) { moduleHueShift = v; }
export function sliderHueShiftFreq(v) { hueShiftFreq = v; }

// ── Shared interior idiom (identical in 131-145) ─────────────────────────────
var SEAM = 0.5454545;         // Seg1/Seg2 boundary in normalized u (world x = 0.5)
var SEG2_FLOW = 1.15;         // downstream narrows: Seg2 runs ~15% faster
var PHI = 1.6180339;
var SQRT2 = 1.4142136;
var GOLDEN_ANGLE = 0.3819660; // 1 - 1/PHI — per-module step, never 1/6
var PHASE_WRAP = 10000.0;
var HUE_SHIFT_MAX = 0.054;    // hue-shift amplitude (~19 deg). Under the spec's
                              // 0.06 hard cap with margin: the cap is on the
                              // MEASURED output, and an 8-bit RGB frame only
                              // resolves hue to a few thousandths of a turn.

function clamp01(v) {
  if (v < 0.0) return 0.0;
  if (v > 1.0) return 1.0;
  return v;
}

// Module identity from geometry only: the six MODULES are parallel lines spread
// evenly along z, so nz alone names the module — floor(nz * 6) clamped to 0..5.
// Modules 1-3 (BoilderRoom-A) land on 0..2, modules 4-6 (BoilderRoom-B) on 3..5.
function moduleIdOf(zz) {
  var mid = floor(clamp01(zz) * 6.0);
  if (mid > 5.0) mid = 5.0;
  return mid;
}

// Continuous travel coordinate: Seg2 is compressed by SEG2_FLOW so the same
// phase covers more physical line there — the current speeds up downstream
// without a seam in the wave itself.
function travelOf(uu) {
  if (uu < SEAM) return uu;
  return SEAM + (uu - SEAM) / SEG2_FLOW;
}

// ── Shared per-module hue shift (identical in 136-145) ───────────────────────
// dH_m(t) = A * sin(2*pi*f*t + m * GOLDEN_ANGLE * 2*pi), with
// A = HUE_SHIFT_MAX * moduleHueShift and f = 0.005 + 0.095*hueShiftFreq^2 Hz.
// `wave(p)` IS 0.5 + 0.5*sin(2*pi*p); the phase is accumulated ALREADY SCALED by
// f, so the PHASE_WRAP (an integer number of turns) is exactly continuous and a
// slider move never steps. Only the HUE moves; at moduleHueShift 0 the baked
// palette equals the un-shifted palette exactly.
var hueShiftPhase = 0.0;
var bakeCursor = 0.0;         // round-robin pointer for the palette bake
var baked = 0;
var mp1r = array(6);
var mp1g = array(6);
var mp1b = array(6);
var mp2r = array(6);
var mp2g = array(6);
var mp2b = array(6);

function _hsvBake(hh, ss, vv, mm, slot) {
  var hv = hh - floor(hh); if (hv < 0.0) hv += 1.0;
  var iv = floor(hv * 6.0) % 6;
  var fv = hv * 6.0 - floor(hv * 6.0);
  var pv = vv * (1.0 - ss);
  var qv = vv * (1.0 - fv * ss);
  var tv = vv * (1.0 - (1.0 - fv) * ss);
  var rr = vv; var gg = tv; var bb = pv;
  if      (iv == 1) { rr = qv;   gg = vv;   bb = pv;   }
  else if (iv == 2) { rr = pv;   gg = vv;   bb = tv;   }
  else if (iv == 3) { rr = pv;   gg = qv;   bb = vv;   }
  else if (iv == 4) { rr = tv;   gg = pv;   bb = vv;   }
  else if (iv == 5) { rr = vv;   gg = pv;   bb = qv;   }
  if (slot == 1) { mp1r[mm] = rr; mp1g[mm] = gg; mp1b[mm] = bb; }
  else           { mp2r[mm] = rr; mp2g[mm] = gg; mp2b[mm] = bb; }
}

function _advanceHueShift(dt) {
  var hf = clamp01(hueShiftFreq);
  hueShiftPhase = hueShiftPhase + dt * (0.005 + 0.095 * hf * hf);
  if (hueShiftPhase >= PHASE_WRAP) hueShiftPhase = hueShiftPhase - PHASE_WRAP;
}

function _bakeOne(mm) {
  var amp = HUE_SHIFT_MAX * clamp01(moduleHueShift);
  var dh = amp * (2.0 * wave(hueShiftPhase + mm * GOLDEN_ANGLE) - 1.0);
  _hsvBake(cp1H + dh, cp1S, cp1V, mm, 1);
  _hsvBake(cp2H + dh, cp2S, cp2V, mm, 2);
}

// The VM caps beforeRender at ~2000 bytecode instructions PER FRAME (measured:
// past the cap the rest of beforeRender is silently skipped), and a full
// six-module HSV bake alone is a third of that. The hue shift is a slow sine —
// one full cycle is 10 s even at hueShiftFreq 1 — so ONE module is re-baked per
// frame, round-robin: every module is current within 6 frames (150 ms, 1/66 of
// the fastest cycle), which is still perfectly smooth, and the rest of the
// budget stays with the composition. The first frame bakes all six, so no
// module is ever unlit.
function _bakeModulePalettes() {
  if (baked == 0) {
    for (var mm = 0; mm < 6; mm++) _bakeOne(mm);
    baked = 1;
  } else {
    _bakeOne(bakeCursor);
    bakeCursor = bakeCursor + 1.0;
    if (bakeCursor > 5.0) bakeCursor = 0.0;
  }
}


// ── Composition state ────────────────────────────────────────────────────────
var NSOL = 5;              // solitons in the train, per module
var BASE_RATE = 0.1050;    // train cycles/sec at localSpeed 0.5

// Per-module phases are ACCUMULATED, never a scaled copy of one clock, so a
// reversal or a cohesion move changes the RATE and never jumps the train.
var sph = array(6);

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  _advanceHueShift(dt);
  _bakeModulePalettes();

  var localGain = pow(2.0, (clamp01(localSpeed) - 0.5) * 4.0);

  var dSign = 1.0;
  if (clamp01(direction) < 0.5) dSign = -1.0;
  var dMag = 0.30 + 1.40 * abs(clamp01(direction) - 0.5) * 2.0;

  var spread = 1.0 - clamp01(cohesion);
  for (var mm = 0; mm < 6; mm++) {
    var sgn = dSign;
    // The +,-,+,-,+,- reversal. This is a SNAP in the slider (never in time):
    // blending a heading through zero would leave those modules stalled, and a
    // stalled soliton is not a soliton.
    if (spread > 0.5 && (mm % 2) == 1) sgn = 0.0 - dSign;
    sph[mm] = sph[mm] + dt * BASE_RATE * localGain * sgn * dMag;
    if (sph[mm] >= PHASE_WRAP) sph[mm] = sph[mm] - PHASE_WRAP;
    if (sph[mm] <= 0.0 - PHASE_WRAP) sph[mm] = sph[mm] + PHASE_WRAP;
  }
}

export function render3D(index, x, y, z) {
  var u = clamp01(x);
  var s = travelOf(u);
  var mid = moduleIdOf(z);
  var ph = sph[mid];
  var spread = 1.0 - clamp01(cohesion);

  var am = clamp01(amplitude);
  var spc = clamp01(spacing);

  var wave2 = 0.0;
  var crown = 0.0;

  for (var kk = 0; kk < NSOL; kk++) {
    // Amplitude set: irrational in both the soliton index and the module, so no
    // two trains in the room are the same and none of them repeats.
    var hh = ((kk + 1.0) * SQRT2 + mid * PHI * spread) % 1.0;
    var aa = 0.30 + am * (0.25 + 0.75 * hh);

    // KdV: speed rises with amplitude, width falls with it. That is the whole
    // trick — the tall ones overtake the short ones and pass through.
    var spd = 0.55 + aa * 1.30;
    var wd = 0.016 + 0.034 / (0.45 + aa * 1.60);

    // Launch cadence, irrational per module.
    var off = kk * (0.13 + spc * 0.24) + mid * GOLDEN_ANGLE * 0.37 * spread;
    var pos = ph * spd + off;
    pos = pos - floor(pos);

    // Nearest image on the ring, so a soliton crossing the end of the run does
    // not tear.
    var dd = s - pos;
    if (dd > 0.5) dd = dd - 1.0;
    if (dd < -0.5) dd = dd + 1.0;

    // sech(t)^2 written with a single exp: sech = 2e/(1+e^2) for e = exp(-|t|).
    var ee = exp(0.0 - abs(dd) / wd);
    var sech = 2.0 * ee / (1.0 + ee * ee);
    var hump = aa * sech * sech;
    wave2 = wave2 + hump;
    crown = crown + pow(sech, 8.00) * aa;
  }

  var body = clamp01(wave2 * 0.85);
  crown = clamp01(crown);

  // Shaped wet sheen floor — the channel between humps is dark water, not a
  // bare strand.
  var bri = clamp01(0.070 + 0.330 * body + 0.180 * pow(body, 2.20));

  // cp2 is an ACCENT on the soliton crowns only, never a co-lead.
  var mix = clamp01(crown * 0.26);

  var r = (mp1r[mid] + (mp2r[mid] - mp1r[mid]) * mix) * bri;
  var g = (mp1g[mid] + (mp2g[mid] - mp1g[mid]) * mix) * bri;
  var b = (mp1b[mid] + (mp2b[mid] - mp1b[mid]) * mix) * bri;

  var foam = clamp01((crown - 0.35) / 0.65) * clamp01(whiteFoam) * 0.90;
  if (foam > 0.0) {
    var mx = r;
    if (g > mx) mx = g;
    if (b > mx) mx = b;
    r = r + (mx - r) * foam;
    g = g + (mx - g) * foam;
    b = b + (mx - b) * foam;
  }

  rgb(clamp01(r), clamp01(g), clamp01(b));
}
