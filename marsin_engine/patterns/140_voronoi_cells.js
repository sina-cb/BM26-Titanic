/*
  140_voronoi_cells.js — "Voronoi Cells"

  A 1-D VORONOI TESSELLATION that will not hold still. Each MODULE owns a handful
  of seed points that wander along the line on LISSAJOUS paths (two incommensurate
  frequencies, so a seed's route never repeats). Every pixel belongs to whichever
  seed is nearest, and its brightness falls off with that distance — soft bright
  cells that slide into each other, squeeze, and pop, the way bubbles move under
  a sheet of ice. cp2 rides the BOUNDARY: the ridge where the nearest and the
  second-nearest seed are equally far, which is the actual Voronoi edge.

  GEOMETRY (rig-agnostic — normalized render3D coords only)
    u = x        position along the line (0..1 over the whole 330 px run).
    SEAM         the travel coordinate is continuous across it; cells drift over
                 the seam without a break.
    moduleId     derived from z alone: floor(nz * 6) clamped to 0..5.
    Per-module character: the SEED COUNT is 4 + (moduleId * PHI mod 3), so the
    modules carry 4, 5, 4, 5, 4 and 6 cells, and the ODD modules drift the
    opposite way to the `direction` knob. Neighbouring lines therefore slide
    against each other instead of marching together.

  Nothing here reads fixtureType, section, group or index, so the composition is
  identical on test_bench / titanic / any other model.

AUDIO_MODULATION_V1:
  sliderEdge <- micHigh range 0.30..0.90 curve linear  # the highs light the cell walls
  # STATIC: localSpeed, direction, cells, whiteFoam, moduleHueShift, hueShiftFreq, colorPalette1/2
*/

// Export order is physical MIDI order. Local Speed is always first, Direction
// always second; the shared per-module hue shift pair is always declared LAST.
export var localSpeed = 0.38;
export var direction = 0.70;
export var cells = 0.55;
export var edge = 0.30;
export var whiteFoam = 0.30;
export var moduleHueShift = 0.50;
export var hueShiftFreq = 0.30;

export var cp1H = 0.55, cp1S = 1.00, cp1V = 0.90; // deep teal-blue cell body
export var cp2H = 0.09, cp2S = 0.50, cp2V = 1.00; // warm amber-white cell wall
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderDirection(v) { direction = v; }
export function sliderCells(v) { cells = v; }
export function sliderEdge(v) { edge = v; }
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


// ── The seed field ───────────────────────────────────────────────────────────
// MAXSEEDS is the spec's own ceiling: 4 + (moduleId * PHI mod 3) never exceeds 6.
var MAXSEEDS = 6;
var BASE_RATE = 0.0640;    // seed drift cycles/sec at localSpeed 0.5
var CELL_R = 0.240;        // cell radius in u — how far a seed's glow reaches

var driftPhase = 0.0;
var sPos = array(36);      // 6 modules * MAXSEEDS seed positions along u

// How many cells this module carries: the spec's irrational count, so the six
// lines are never the same tessellation.
function _seedCount(mm) {
  return 4.0 + floor((mm * PHI) % 3.0);
}

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

  driftPhase = driftPhase + dt * BASE_RATE * localGain * dSign * dMag;
  if (driftPhase >= PHASE_WRAP) driftPhase = driftPhase - PHASE_WRAP;
  if (driftPhase <= 0.0 - PHASE_WRAP) driftPhase = driftPhase + PHASE_WRAP;

  // Lissajous drift: two incommensurate frequencies per seed, so a seed's path
  // along the line never closes and no two seeds ever share a route. Odd modules
  // run the phase the other way, which is what makes neighbouring lines slide
  // against each other.
  for (var mm = 0; mm < 6; mm++) {
    var sgn = 1.0;
    if ((mm % 2) == 1) sgn = -1.0;
    var ph = driftPhase * sgn;
    for (var kk = 0; kk < MAXSEEDS; kk++) {
      var o1 = (kk + 1.0) * GOLDEN_ANGLE + mm * PHI * 0.37;
      var f1 = 0.62 + kk * 0.13;
      var f2 = f1 * PHI;
      var pp = 0.5 + 0.30 * (2.0 * wave(ph * f1 + o1) - 1.0)
                   + 0.16 * (2.0 * wave(ph * f2 + o1 * SQRT2) - 1.0);
      if (pp < 0.02) pp = 0.02;
      if (pp > 0.98) pp = 0.98;
      sPos[mm * MAXSEEDS + kk] = pp;
    }
  }
}

export function render3D(index, x, y, z) {
  var u = clamp01(x);
  var s = travelOf(u);
  var mid = moduleIdOf(z);
  var bas = mid * MAXSEEDS;

  // `cells` fades the higher seeds IN rather than switching them on: a seed
  // whose activity is partial is pushed away in distance, so it grows out of the
  // line instead of popping into it.
  var nSeed = _seedCount(mid);
  var cellsF = 1.5 + clamp01(cells) * (nSeed - 1.0);

  var d1 = 9.0;
  var d2 = 9.0;
  for (var kk = 0; kk < MAXSEEDS; kk++) {
    var act = clamp01(cellsF - kk);
    if (kk > nSeed - 1.0) act = 0.0;
    var dd = abs(s - sPos[bas + kk]) + (1.0 - act) * 4.0;
    if (dd < d1) { d2 = d1; d1 = dd; }
    else if (dd < d2) { d2 = dd; }
  }

  var cell = clamp01(1.0 - d1 / CELL_R);
  var eg = clamp01(edge);

  // The Voronoi BOUNDARY: where the nearest and second-nearest seeds are equally
  // far. `edge` narrows the ridge, which reads as the wall getting crisper.
  var wall = clamp01(1.0 - (d2 - d1) / (0.070 - eg * 0.045));

  // Shaped wet sheen floor — between two cells the line still glows.
  var bri = clamp01(0.070 + 0.090 * cell + 0.360 * pow(cell, 1.30) + 0.070 * wall * eg);

  // cp2 is an ACCENT on the wall only, never a co-lead.
  var mix = clamp01(pow(wall, 3.00) * (0.12 + eg * 0.20));

  var r = (mp1r[mid] + (mp2r[mid] - mp1r[mid]) * mix) * bri;
  var g = (mp1g[mid] + (mp2g[mid] - mp1g[mid]) * mix) * bri;
  var b = (mp1b[mid] + (mp2b[mid] - mp1b[mid]) * mix) * bri;

  var foam = clamp01((wall - 0.55) / 0.45) * clamp01(whiteFoam) * 0.90;
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
