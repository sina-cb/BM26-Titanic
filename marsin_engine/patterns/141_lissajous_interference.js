/*
  141_lissajous_interference.js — "Lissajous Interference"

  SUPERPOSITION. Two travelling sines whose wavenumbers stand in an irrational
  ratio (PHI) run along the line together, plus a STANDING component that does
  not travel at all. Brightness is the magnitude of the sum. Because the two
  carriers can never come back into step, the interference pattern beats: bright
  bands form, march, thin out and dissolve, and the next set arrives somewhere
  else. This is the only pattern in the family whose motion you cannot point at —
  nothing travels at the speed the bands appear to.

  GEOMETRY (rig-agnostic — normalized render3D coords only)
    u = x        position along the line (0..1 over the whole 330 px run).
    SEAM         the travel coordinate is CONTINUOUS across it (SEG2_FLOW), so
                 the fringe spacing stretches downstream, never breaks.
    moduleId     derived from z alone: floor(nz * 6) clamped to 0..5.
    Per-module character is a WAVENUMBER DETUNE of 1 + 0.03*moduleId: each line
    holds a slightly different fringe spacing, so a beat crosses the room as a
    slow diagonal instead of arriving everywhere at once. The detune closes as
    `cohesion` -> 1, where all six lines carry the identical interference.

  Nothing here reads fixtureType, section, group or index, so the composition is
  identical on test_bench / titanic / any other model.

AUDIO_MODULATION_V1:
  sliderStanding <- micFlux range 0.20..0.70 curve ease  # builds pin the pattern into a standing wave
  # STATIC: localSpeed, direction, detune, cohesion, whiteFoam, moduleHueShift, hueShiftFreq, colorPalette1/2
*/

// Export order is physical MIDI order. Local Speed is always first, Direction
// always second; the shared per-module hue shift pair is always declared LAST.
export var localSpeed = 0.44;
export var direction = 0.70;
export var detune = 0.45;
export var standing = 0.20;
export var cohesion = 0.40;
export var whiteFoam = 0.32;
export var moduleHueShift = 0.50;
export var hueShiftFreq = 0.30;

export var cp1H = 0.55, cp1S = 1.00, cp1V = 0.90; // deep teal-blue fringe body
export var cp2H = 0.09, cp2S = 0.50, cp2V = 1.00; // warm amber-white antinode
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderDirection(v) { direction = v; }
export function sliderDetune(v) { detune = v; }
export function sliderStanding(v) { standing = v; }
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
var BASE_RATE = 0.1450;    // carrier cycles/sec at localSpeed 0.5
var K_BASE = 5.6000;       // fringes across the run at detune 0

// The two carriers travel at irrationally related rates, so their relative phase
// never repeats and the beat pattern never loops.
var p1 = 0.0;
var p2 = 0.0;

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

  var step = dt * BASE_RATE * localGain * dSign * dMag;
  p1 = p1 + step;
  p2 = p2 + step * PHI;
  if (p1 >= PHASE_WRAP) p1 = p1 - PHASE_WRAP;
  if (p1 <= 0.0 - PHASE_WRAP) p1 = p1 + PHASE_WRAP;
  if (p2 >= PHASE_WRAP) p2 = p2 - PHASE_WRAP;
  if (p2 <= 0.0 - PHASE_WRAP) p2 = p2 + PHASE_WRAP;
}

export function render3D(index, x, y, z) {
  var u = clamp01(x);
  var s = travelOf(u);
  var mid = moduleIdOf(z);
  var spread = 1.0 - clamp01(cohesion);

  // Per-module wavenumber detune — the spec's 1 + 0.03*moduleId, with `detune`
  // setting how far it is pushed and `cohesion` closing it back to zero.
  var km = 1.0 + 0.03 * mid * spread * (0.40 + 1.60 * clamp01(detune));
  var k1 = K_BASE * km;
  var k2 = k1 * PHI;

  var w1 = 2.0 * wave(k1 * s - p1) - 1.0;
  var w2 = 2.0 * wave(k2 * s - p2) - 1.0;

  // The standing component is a product of a spatial and a temporal sine: its
  // nodes never move, they only breathe, which is exactly what pins the fringes.
  var sd = clamp01(standing);
  var st = (2.0 * wave(k1 * s) - 1.0) * (2.0 * wave(p1 * 0.6180339) - 1.0);

  var sum = w1 * 0.50 + w2 * 0.35 + st * sd * 0.60;
  var amp = clamp01(abs(sum) / (0.85 + sd * 0.60));

  // Shaped wet sheen floor — a node is dark water, never a bare strand.
  var bri = clamp01(0.070 + 0.080 * amp + 0.370 * pow(amp, 1.60));

  // cp2 is an ACCENT on the antinodes only, never a co-lead.
  var mix = clamp01(pow(amp, 4.00) * 0.26);

  var r = (mp1r[mid] + (mp2r[mid] - mp1r[mid]) * mix) * bri;
  var g = (mp1g[mid] + (mp2g[mid] - mp1g[mid]) * mix) * bri;
  var b = (mp1b[mid] + (mp2b[mid] - mp1b[mid]) * mix) * bri;

  var foam = clamp01((amp - 0.62) / 0.38) * clamp01(whiteFoam) * 0.90;
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
