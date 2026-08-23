/*
  139_kuramoto_glow.js — "Kuramoto Glow"

  PHASE-COUPLED OSCILLATORS. Ten oscillators sit along each MODULE, each
  with its own natural frequency (spread by an irrational SQRT2 hash). They are
  coupled two ways: to their immediate NEIGHBOURS along the line with strength
  `coupling`, and — weakly, through a mean field — to the SAME index on the other
  five modules with strength `cohesion`. That is the Kuramoto model, and it does
  the one thing a hand-drawn chase can never do: the room slides in and out of
  synchrony on its own. Turn `spread` up and the nodes scatter into chaos; turn
  `coupling` up and they pull into lock-step; turn `cohesion` up and the six
  modules start breathing together.

    dtheta_i/dt = omega_i + K/2 * [sin(theta_left - theta_i) + sin(theta_right - theta_i)]
                           + Kc * R_i * sin(Psi_i - theta_i)

  cp2 rides the LOCAL order parameter — the coherence between the two
  oscillators a pixel sits between — so the accent appears exactly where the line
  has locked, and vanishes where it is still arguing.

  GEOMETRY (rig-agnostic — normalized render3D coords only)
    u = x        position along the line (0..1 over the whole 330 px run).
    SEAM         the travel coordinate is continuous across it; the oscillator
                 lattice does not know about a wiring seam.
    moduleId     derived from z alone: floor(nz * 6) clamped to 0..5.
    At `cohesion` 1 the per-module frequency offsets close AND the cross-module
    coupling is at full strength, so the six modules lock into one identical
    line; at 0 each module is its own argument.

  Nothing here reads fixtureType, section, group or index, so the composition is
  identical on test_bench / titanic / any other model.

  STABILITY: every phase is wrapped into 0..1 every frame so nothing drifts to a
  magnitude where float precision would granulate the motion, and the coupling
  nudge is bounded (MAX_NUDGE_DT) so a long frame can never fling a phase past
  its target and set the bank ringing.
*/

// Export order is physical MIDI order. Local Speed is always first; this
// composition has no direction control (oscillators do not travel). The shared
// per-module hue shift pair is always declared LAST.
export var localSpeed = 0.42;
export var coupling = 0.45;
export var spread = 0.40;
export var cohesion = 0.35;
export var whiteFoam = 0.26;
export var moduleHueShift = 0.50;
export var hueShiftFreq = 0.30;

export var cp1H = 0.55, cp1S = 1.00, cp1V = 0.90; // deep teal-blue node body
export var cp2H = 0.09, cp2S = 0.50, cp2V = 1.00; // warm amber-white lock
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderCoupling(v) { coupling = v; }
export function sliderSpread(v) { spread = v; }
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
var TAU = 6.2831853;

function clamp01(v) {
  if (v < 0.0) return 0.0;
  if (v > 1.0) return 1.0;
  return v;
}

// Module identity from geometry only: the six MODULES are parallel lines spread
// evenly along z, so nz alone names the module — floor(nz * 6) clamped to 0..5.
function moduleIdOf(zz) {
  var mid = floor(clamp01(zz) * 6.0);
  if (mid > 5.0) mid = 5.0;
  return mid;
}

// Continuous travel coordinate: Seg2 is compressed by SEG2_FLOW.
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

// ── The oscillator bank ──────────────────────────────────────────────────────
// TWO measured VM limits shape this section, neither a matter of taste:
//   * beforeRender is cut off after ~2000 bytecode instructions PER FRAME, and
//     a full Kuramoto sweep over the bank (a cross-module mean field plus a
//     coupled update for every oscillator) costs several times that;
//   * the array arena holds ~250 cells TOTAL across all of a pattern's arrays.
// So the bank is 10 oscillators per module (the spec's 24 does not fit), and
// the work is SPLIT: every frame each phase advances by its own natural
// frequency — cheap, and what keeps the glow perfectly smooth at frame rate —
// while the COUPLING (which is what actually makes them lock) is applied as a
// nudge to a round-robin slice of indices. Coupling is a slow force compared
// with the carrier, so refreshing it every 5 frames changes the dynamics not at
// all; only the carrier has to be per-frame, and it is.
var OSC = 10;              // oscillators per module
var BANK = 60;             // 6 modules * OSC
var BASE_FREQ = 0.1650;    // mean natural frequency, turns/sec at localSpeed 0.5
var SWEEP = 2.0;           // indices whose coupling is refreshed per frame
var MAX_NUDGE_DT = 0.150;  // s — bound on one coupling nudge, so a long frame
                           // (or a paused deck) can never fling a phase past
                           // its target and set the bank ringing

var osc = array(60);       // phase, in turns
var nat = array(60);       // natural frequency, in turns/sec
var seeded = 0.0;          // module seed cursor: 0..5, then 6 = ready
var sweepCursor = 0.0;

// Natural frequency of oscillator jj on module mm, in turns/second. The index
// spread is an irrational SQRT2 hash (never a repeating ramp); the MODULE offset
// is scaled by 1 - cohesion, so at cohesion 1 every module carries the same set
// of frequencies and the bank can genuinely lock across the room.
// Written as ONE expression with no local `var`s on purpose: a value-returning
// helper that declares a local reads back as 0 when it is called from
// beforeRender on this VM (measured — void helpers with locals are fine, and so
// is a single-expression helper like this one). Keeping it inline is what makes
// `spread` and `cohesion` actually reach the bank.
function _omega(jj, mm, sprd, modSpread) {
  return BASE_FREQ * (1.0
    + sprd * 0.55 * (2.0 * frac((jj + 1.0) * SQRT2) - 1.0)
    + modSpread * 0.35 * (2.0 * frac((jj + 1.0) * 0.7071068 + mm * PHI) - 1.0));
}

// Seeding is done ONE MODULE PER FRAME for the first six frames. Seeding the
// whole bank at once overruns the beforeRender budget, and the work that gets
// cut is whatever follows it — including the palette bake, which would leave the
// room black until the (never-completing) seed finally set its done flag.
function _seedModule(mm, sprd, modSpread) {
  for (var jj = 0; jj < OSC; jj++) {
    var idx = mm * OSC + jj;
    osc[idx] = ((idx + 1.0) * GOLDEN_ANGLE * PHI) % 1.0;
    nat[idx] = _omega(jj, mm, sprd, modSpread);
  }
}

// Refresh ONE index: recompute its six natural frequencies and apply the
// coupling nudge — neighbours along the line at `kLocal`, plus the cross-module
// mean field (order parameter R, mean phase Psi over the six modules) at
// `kCross`. Recomputing the mean field here rather than caching it costs six
// reads and saves two whole arrays the arena has no room for.
function _coupleIndex(jj, dtN, sprd, modSpread, kLocal, kCross) {
  var cs = 0.0;
  var sn = 0.0;
  for (var ma = 0; ma < 6; ma++) {
    var tha = osc[ma * OSC + jj];
    cs = cs + (2.0 * wave(tha + 0.25) - 1.0);
    sn = sn + (2.0 * wave(tha) - 1.0);
  }
  cs = cs / 6.0;
  sn = sn / 6.0;
  var rr = sqrt(cs * cs + sn * sn);
  var psi = atan2(sn, cs) / TAU;

  // OPEN chain, not a ring: a ring can lock into a TWISTED state with a nonzero
  // winding number, and two modules that pick different windings can never be
  // pulled together no matter how strong `cohesion` is. An open line has no such
  // topology, so full cohesion really does collapse the six modules onto one.
  var jl = jj - 1; if (jl < 0) jl = 0;
  var jr = jj + 1; if (jr > OSC - 1) jr = OSC - 1;

  for (var mb = 0; mb < 6; mb++) {
    var idx = mb * OSC + jj;
    var th = osc[idx];
    var dth = 0.5 * kLocal * ((2.0 * wave(osc[mb * OSC + jl] - th) - 1.0)
                            + (2.0 * wave(osc[mb * OSC + jr] - th) - 1.0))
            + kCross * rr * (2.0 * wave(psi - th) - 1.0);
    var nth = th + dtN * dth;
    osc[idx] = nth - floor(nth);
    nat[idx] = _omega(jj, mb, sprd, modSpread);
  }
}

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  _advanceHueShift(dt);
  _bakeModulePalettes();

  var sprd = clamp01(spread);
  var modSpread = 1.0 - clamp01(cohesion);

  if (seeded < 6.0) {
    _seedModule(seeded, sprd, modSpread);
    seeded = seeded + 1.0;
    return;
  }

  var localGain = pow(2.0, (clamp01(localSpeed) - 0.5) * 4.0);
  var dtSim = dt * localGain;
  var kLocal = clamp01(coupling) * 0.90;
  var kCross = clamp01(cohesion) * 0.70;

  // Carrier: every phase advances every frame, so the glow never steps.
  for (var kk = 0; kk < BANK; kk++) {
    var nth = osc[kk] + nat[kk] * dtSim;
    osc[kk] = nth - floor(nth);
  }

  // Coupling: a round-robin slice, with the nudge scaled by how long it has been
  // since this index was last touched.
  var dtN = dtSim * (OSC / SWEEP);
  if (dtN > MAX_NUDGE_DT) dtN = MAX_NUDGE_DT;
  for (var ss = 0; ss < SWEEP; ss++) {
    _coupleIndex(sweepCursor, dtN, sprd, modSpread, kLocal, kCross);
    sweepCursor = sweepCursor + 1.0;
    if (sweepCursor > OSC - 1.0) sweepCursor = 0.0;
  }
}

export function render3D(index, x, y, z) {
  var u = clamp01(x);
  var s = travelOf(u);
  var mid = moduleIdOf(z);
  var bas = mid * OSC;

  var pos = clamp01(s) * OSC;
  var j0 = floor(pos);
  if (j0 > OSC - 1.0) j0 = OSC - 1.0;
  var fr = pos - j0;
  var j1 = j0 + 1.0;
  if (j1 > OSC - 1.0) j1 = 0.0;

  var th0 = osc[bas + j0];
  var th1 = osc[bas + j1];

  // Each oscillator's own glow, blended across the gap with a smoothstep so the
  // lattice reads as a line of nodes rather than as 24 hard cells.
  var fs = fr * fr * (3.0 - 2.0 * fr);
  var g0 = pow(wave(th0), 2.20);
  var g1 = pow(wave(th1), 2.20);
  var glow = g0 + (g1 - g0) * fs;

  // Node envelope: brightest ON an oscillator, dimmest between two of them.
  var env = 0.34 + 0.66 * wave(pos + 0.25);

  // Shaped wet sheen floor — between two dark nodes the line still glows.
  var bri = clamp01(0.105 + 0.075 * glow + 0.360 * glow * env);

  // LOCAL order parameter: the coherence of the two oscillators this pixel sits
  // between. wave(d + 0.25) IS 0.5 + 0.5*cos(2*pi*d), which is 1 when locked.
  var order = wave(th0 - th1 + 0.25);
  var mix = clamp01(pow(order, 6.00) * 0.30 * glow);

  var r = (mp1r[mid] + (mp2r[mid] - mp1r[mid]) * mix) * bri;
  var g = (mp1g[mid] + (mp2g[mid] - mp1g[mid]) * mix) * bri;
  var b = (mp1b[mid] + (mp2b[mid] - mp1b[mid]) * mix) * bri;

  // whiteFoam desaturates a node only when it is BOTH bright and locked — the
  // pattern emits RGB only and the rig derives W natively.
  var foam = clamp01((glow * order - 0.55) / 0.45) * clamp01(whiteFoam) * 0.90;
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
