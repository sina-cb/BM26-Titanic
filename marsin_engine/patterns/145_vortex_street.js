/*
  145_vortex_street.js — "Vortex Street"

  A VON KARMAN VORTEX STREET: the double row of counter-rotating eddies that
  peels off the back of anything sitting in a current — a piling, a smokestack, a
  hull. Vortices are shed alternately, one sign then the other, at a Strouhal-like
  cadence, then ride downstream and decay. Brightness is the magnitude of the
  vorticity, so the line reads as a procession of paired eddies; the two SIGNS
  are carried in colour, with cp2 kept inside the palette blend rather than
  swapped in, so the street stays one temperature.

  GEOMETRY (rig-agnostic — normalized render3D coords only)
    u = x        position along the line (0..1 over the whole 330 px run).
    SEAM         the travel coordinate is continuous across it (SEG2_FLOW): the
                 eddies compress downstream where the run narrows.
    moduleId     derived from z alone: floor(nz * 6) clamped to 0..5.
    Per-module character: the shedding phase alternates by module, so
    neighbouring lines are ANTI-PHASE — where one module is releasing a positive
    eddy its neighbour is releasing a negative one, and the wall reads as a
    braid. `direction` moves the invisible post from u ~ 0.08 to u ~ 0.92 and
    sends the street the other way.

  Nothing here reads fixtureType, section, group or index, so the composition is
  identical on test_bench / titanic / any other model.

AUDIO_MODULATION_V1:
  sliderShedRate <- micFlux range 0.30..0.80 curve linear  # builds shed eddies faster
  # STATIC: localSpeed, direction, decay, whiteFoam, moduleHueShift, hueShiftFreq, colorPalette1/2
*/

// Export order is physical MIDI order. Local Speed is always first, Direction
// always second; the shared per-module hue shift pair is always declared LAST.
export var localSpeed = 0.44;
export var direction = 0.72;
export var shedRate = 0.30;
export var decay = 0.45;
export var whiteFoam = 0.30;
export var moduleHueShift = 0.50;
export var hueShiftFreq = 0.30;

export var cp1H = 0.55, cp1S = 1.00, cp1V = 0.90; // deep teal-blue eddy of one sign
export var cp2H = 0.09, cp2S = 0.50, cp2V = 1.00; // warm amber-white eddy of the other
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderDirection(v) { direction = v; }
export function sliderShedRate(v) { shedRate = v; }
export function sliderDecay(v) { decay = v; }
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
var NVORT = 8;             // eddies in flight per module
var BASE_RATE = 0.4200;    // sheds per second at localSpeed 0.5, shedRate 0.5
var POST_A = 0.080;        // where the invisible post stands, forward
var POST_B = 0.920;        // ... and reversed
var STEP = 0.135;          // downstream spacing between successive sheds

// Per-module shed phases are ACCUMULATED, so a direction or rate change alters
// the cadence and never jumps the street.
var shed = array(6);

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  _advanceHueShift(dt);
  _bakeModulePalettes();

  var localGain = pow(2.0, (clamp01(localSpeed) - 0.5) * 4.0);
  var dMag = 0.30 + 1.40 * abs(clamp01(direction) - 0.5) * 2.0;
  var sr = 0.45 + clamp01(shedRate) * 1.60;

  for (var mm = 0; mm < 6; mm++) {
    // Shedding always runs forward in its own time; `direction` moves the POST
    // and the downstream sense, not the clock, so the cadence never stalls.
    shed[mm] = shed[mm] + dt * BASE_RATE * localGain * sr * dMag;
    if (shed[mm] >= PHASE_WRAP) shed[mm] = shed[mm] - PHASE_WRAP;
  }
}

export function render3D(index, x, y, z) {
  var u = clamp01(x);
  var s = travelOf(u);
  var mid = moduleIdOf(z);

  // Neighbouring modules are anti-phase: a half-shed offset, so the wall braids.
  // The small golden-angle ramp on top keeps modules two apart from landing on
  // the SAME phase — strict alternation alone would make 1/3/5 identical lines.
  var ph = shed[mid] + 0.5 * (mid % 2) + mid * GOLDEN_ANGLE * 0.18;
  var base = ph - floor(ph);
  var whole = floor(ph);

  var fwd = 1.0;
  var post = POST_A;
  if (clamp01(direction) < 0.5) { fwd = -1.0; post = POST_B; }

  var dk = 0.35 + clamp01(decay) * 2.60;
  var width = 0.030;

  var vs = 0.0;             // signed vorticity
  var vm = 0.0;             // magnitude, for the brightness

  for (var kk = 0; kk < NVORT; kk++) {
    var age = base + kk;                       // age in shed intervals
    var pos = post + fwd * age * STEP;
    // Sign alternates shed by shed. As `whole` ticks over, every eddy's index
    // rises by one at the same moment, so a given eddy KEEPS its sign — the
    // alternation is continuous, never a flip in place.
    var sg = 1.0;
    if (((kk + whole) % 2) == 1) sg = -1.0;
    // Fade IN over the first quarter interval (an eddy grows off the post) and
    // decay downstream: nothing ever pops.
    var str = exp(0.0 - dk * age) * clamp01(age / 0.250);
    var dd = (s - pos) / width;
    var gg = exp(0.0 - dd * dd);
    vs = vs + sg * str * gg;
    vm = vm + str * gg;
  }

  vm = clamp01(vm * 1.45);

  // Which sign is winning here, 0 = one, 1 = the other. Colour-aware: this
  // drives a BLEND toward cp2, not a swap, so the street stays one temperature.
  var sgnShare = clamp01(0.5 - 0.5 * vs / (vm + 0.02));

  // Shaped wet sheen floor — the wake between eddies is dark water.
  var bri = clamp01(0.130 + 0.170 * vm + 0.320 * pow(vm, 1.50));

  var mix = clamp01(pow(sgnShare, 2.00) * 0.30 * vm);

  var r = (mp1r[mid] + (mp2r[mid] - mp1r[mid]) * mix) * bri;
  var g = (mp1g[mid] + (mp2g[mid] - mp1g[mid]) * mix) * bri;
  var b = (mp1b[mid] + (mp2b[mid] - mp1b[mid]) * mix) * bri;

  var foam = clamp01((vm - 0.60) / 0.40) * clamp01(whiteFoam) * 0.90;
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
