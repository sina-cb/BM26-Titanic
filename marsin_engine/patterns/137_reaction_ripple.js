/*
  137_reaction_ripple.js — "Reaction Ripple"

  GRAY-SCOTT REACTION-DIFFUSION, one independent 1-D culture per MODULE. Two
  reagents share a small lane of cells inside each module; every step diffuses
  them along the lane and then applies the classic feed/kill nonlinearity

      u' = u + Du*lap(u) - u*v*v + f*(1 - u)
      v' = v + Dv*lap(v) + u*v*v - (f + k)*v

  near the "worms" regime, so slow organic spots appear, crawl, SPLIT and merge
  — a living pond film rather than any kind of travelling wave. cp2 marks the
  catalyst maxima. Each module runs its OWN chemistry with its own feed offset
  (PHI * moduleId * 1e-3), so the six lines never grow the same texture: one
  will be holding fat spots while its neighbour is splitting into worms.

  GEOMETRY (rig-agnostic — normalized render3D coords only)
    u = x        position along the line (0..1 over the whole 330 px run).
    SEAM         the Seg1/Seg2 boundary; the culture is continuous across it —
                 chemistry does not know about a wiring seam, so the travel
                 coordinate is used unchanged and no seam feature is drawn.
    moduleId     derived from z alone: the six modules are parallel lines spread
                 evenly across z, so moduleId = floor(nz * 6) clamped to 0..5.
    `stir` adds a slow DIRECTION-LESS drift of where each module's culture is
    observed — the film crawls both ways, it never becomes a current.

  Nothing here reads fixtureType, section, group or index, so the composition is
  identical on test_bench / titanic / any other model.

  STABILITY: the lane is integrated with a FIXED step size at a step rate
  measured in steps/second, so the chemistry runs at the same pace whatever the
  frame rate; both reagents are clamped to 0..1 after every step; and a very
  gentle chemostat blend (never an additive kick) at one slowly wandering site
  per module keeps a culture from settling into a dead uniform equilibrium —
  the same device 41_reaction_diffusion uses for the same reason.
*/

// Export order is physical MIDI order. Local Speed is always first; this
// composition has no direction control (a culture has no current). The shared
// per-module hue shift pair is always declared LAST.
export var localSpeed = 0.46;
export var feed = 0.48;
export var stir = 0.35;
export var contrast = 0.45;
export var whiteFoam = 0.24;
export var moduleHueShift = 0.50;
export var hueShiftFreq = 0.30;

export var cp1H = 0.55, cp1S = 1.00, cp1V = 0.90; // deep teal substrate
export var cp2H = 0.09, cp2S = 0.50, cp2V = 1.00; // warm amber-white catalyst
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderFeed(v) { feed = v; }
export function sliderStir(v) { stir = v; }
export function sliderContrast(v) { contrast = v; }
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
// phase covers more physical line there.
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

// ── The cultures ─────────────────────────────────────────────────────────────
// TWO limits shape this section, both measured against this VM, neither a
// matter of taste:
//   * the array arena holds ~250 cells TOTAL across every array in a pattern,
//     so two reagent lanes plus the 36-cell palette bake buys 16 cells per
//     module (the spec's 48 would need 288 for the lanes alone);
//   * beforeRender is cut off after ~2000 bytecode instructions PER FRAME, so
//     a 96-cell Gray-Scott step cannot run in one frame. The lane is therefore
//     swept module by module, round-robin — each module is an INDEPENDENT
//     culture with no cross-module term, so sweeping them on different frames
//     changes nothing about the chemistry, only when each one is observed.
// The lane is read back with a smoothstep interpolation, so 16 cells render as
// a continuous film rather than as 16 visible bars.
var CELLS = 16;
var DU = 0.0600;           // substrate diffusion
var DV = 0.0300;           // catalyst diffusion (classic 2:1 ratio)
var KILL = 0.0620;         // kill rate. (DU, KILL, feed range) were chosen by
                           // sweeping the lane offline: this is the window where
                           // ALL SIX modules — including the extremes of the
                           // PHI*moduleId feed offset — stay alive, patterned and
                           // still crawling after a long run. A 16-cell lane is a
                           // knife edge; a wider feed base kills the low modules.
var SWEEP_RATE = 90.0;     // module-steps per second at localSpeed 0.5
var MAX_MODS = 3.0;        // module-steps per frame — the beforeRender budget

var gu = array(96);
var gv = array(96);
var seedCursor = 0.0;
var sweepCursor = 0.0;
var sweepAcc = 0.0;
var stirPhase = 0.0;

// One module's lane is seeded per frame for the first six frames — seeding all
// six at once would itself overrun the beforeRender budget and leave the last
// modules unseeded.
function _seedModule(mm) {
  var bas = mm * CELLS;
  for (var cc = 0; cc < CELLS; cc++) { gu[bas + cc] = 1.0; gv[bas + cc] = 0.0; }
  // Three catalyst nuclei per module at irrational sites — deterministic, never
  // random, and never on a 1/6 grid, so no two modules start alike.
  for (var kk = 0; kk < 3; kk++) {
    var frac = ((kk + 1.0) * SQRT2 + mm * PHI) % 1.0;
    var pos = floor(frac * (CELLS - 2.0)) + 1.0;
    var idx = bas + pos;
    gu[idx] = 0.30; gv[idx] = 0.55;
    gu[idx - 1] = 0.55; gv[idx - 1] = 0.28;
    gu[idx + 1] = 0.55; gv[idx + 1] = 0.28;
  }
}

// One fixed-size integration step over ONE module's lane, in place. The old
// left-neighbour value is carried in a scalar, which is what lets the update run
// without a second pair of scratch lanes the arena has no room for. The step
// size is FIXED; how often a step happens is what localSpeed changes, so the
// chemistry runs at the same pace whatever the frame rate.
function _reactModule(mm) {
  var bas = mm * CELLS;
  var fm = 0.0420 + clamp01(feed) * 0.0100 + PHI * mm * 0.001;  // per-module feed offset
  var oldLU = gu[bas];                 // no-flux boundary: cell -1 == cell 0
  var oldLV = gv[bas];
  for (var cc = 0; cc < CELLS; cc++) {
    var idx = bas + cc;
    var uu = gu[idx];
    var vv = gv[idx];
    var rU = uu;
    var rV = vv;
    if (cc < CELLS - 1) { rU = gu[idx + 1]; rV = gv[idx + 1]; }
    var nu = uu + DU * (oldLU + rU - 2.0 * uu) - uu * vv * vv + fm * (1.0 - uu);
    var nv = vv + DV * (oldLV + rV - 2.0 * vv) + uu * vv * vv - (fm + KILL) * vv;
    if (nu < 0.0) nu = 0.0;
    if (nu > 1.0) nu = 1.0;
    if (nv < 0.0) nv = 0.0;
    if (nv > 1.0) nv = 1.0;
    oldLU = uu;
    oldLV = vv;
    gu[idx] = nu;
    gv[idx] = nv;
  }
  // Chemostat: a gentle BLEND (never an additive kick, so it can never spike) at
  // one slowly wandering site. Keeps a culture from dying into a flat
  // equilibrium over a long show without ever showing as a pop.
  var site = floor(clamp01(0.5 + 0.44 * (2.0 * wave(stirPhase * 0.13 + mm * GOLDEN_ANGLE) - 1.0)) * (CELLS - 1.0));
  var sidx = bas + site;
  gv[sidx] = gv[sidx] + (0.30 - gv[sidx]) * 0.020;
  gu[sidx] = gu[sidx] + (0.45 - gu[sidx]) * 0.020;
}

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  _advanceHueShift(dt);
  _bakeModulePalettes();

  var localGain = pow(2.0, (clamp01(localSpeed) - 0.5) * 4.0);

  stirPhase = stirPhase + dt * 0.0700 * localGain;
  if (stirPhase >= PHASE_WRAP) stirPhase = stirPhase - PHASE_WRAP;

  if (seedCursor < 6.0) {
    _seedModule(seedCursor);
    seedCursor = seedCursor + 1.0;
  } else {
    // Step COUNT derived from wall time, step SIZE fixed. Above localSpeed ~0.72
    // the frame budget caps the sweep at MAX_MODS module-steps; past that point
    // localSpeed still drives the stir drift, which is what keeps the knob live.
    sweepAcc = sweepAcc + dt * SWEEP_RATE * localGain;
    var nMods = floor(sweepAcc);
    if (nMods > MAX_MODS) { nMods = MAX_MODS; sweepAcc = MAX_MODS; }
    sweepAcc = sweepAcc - nMods;
    for (var ss = 0; ss < nMods; ss++) {
      _reactModule(sweepCursor);
      sweepCursor = sweepCursor + 1.0;
      if (sweepCursor > 5.0) sweepCursor = 0.0;
    }
  }
}

export function render3D(index, x, y, z) {
  var u = clamp01(x);
  var s = travelOf(u);
  var mid = moduleIdOf(z);
  var bas = mid * CELLS;

  // stir: a slow, direction-less drift of the observation point. It oscillates,
  // so the film crawls up and back — it never becomes a current.
  var off = clamp01(stir) * 2.60 * (2.0 * wave(stirPhase * 0.31 + mid * GOLDEN_ANGLE * PHI) - 1.0);
  var pos = clamp01(s) * (CELLS - 1.0) + off;
  if (pos < 0.0) pos = 0.0;
  if (pos > CELLS - 1.0) pos = CELLS - 1.0;

  var c0 = floor(pos);
  var fr = pos - c0;
  var c1 = c0 + 1.0;
  if (c1 > CELLS - 1.0) c1 = CELLS - 1.0;
  // Smoothstep across the cell so a 16-cell lane renders as a continuous film.
  var fs = fr * fr * (3.0 - 2.0 * fr);
  var vv = gv[bas + c0] + (gv[bas + c1] - gv[bas + c0]) * fs;

  var vn = clamp01(vv * 2.80);
  var ct = clamp01(contrast);
  var sharp = pow(vn, 0.55 + ct * 1.90);

  // Shaped wet sheen floor — the substrate is never bare, never blown out.
  var bri = clamp01(0.070 + 0.055 * vn + 0.340 * sharp);

  // cp2 marks the catalyst MAXIMA only: a high exponent keeps the accent well
  // under a third of the line, so the room still reads as one colour.
  var mix = clamp01(pow(vn, 4.00) * 0.30);

  var r = (mp1r[mid] + (mp2r[mid] - mp1r[mid]) * mix) * bri;
  var g = (mp1g[mid] + (mp2g[mid] - mp1g[mid]) * mix) * bri;
  var b = (mp1b[mid] + (mp2b[mid] - mp1b[mid]) * mix) * bri;

  // whiteFoam desaturates the brightest catalyst caps toward S ~= 0.1; the
  // pattern emits RGB only and the rig derives W natively.
  var foam = clamp01((sharp - 0.60) / 0.40) * clamp01(whiteFoam) * 0.90;
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
