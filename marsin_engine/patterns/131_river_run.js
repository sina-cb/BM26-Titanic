/*
  131_river_run.js — "River Run"

  The default INTERIOR flow: a continuous laminar current running the length of
  every boiler-room MODULE. Three aperiodic sine "eddies" travel along the line;
  brightness follows their crests, so the run reads as moving water rather than
  as a chase. cp1 carries the body, cp2 rides the faster eddy, and whiteFoam
  tints only the sharpest crest so an RGBW rig's W element actually lights.

  GEOMETRY (rig-agnostic — normalized render3D coords only)
    u = x        position along the line (0..1 over the whole 330 px run).
    SEAM         the Seg1/Seg2 boundary (world x = 0.5 -> u ~ 0.545). Seg2 is
                 the narrower downstream half and runs SEG2_FLOW faster. The
                 travel coordinate is CONTINUOUS across the seam (no visual
                 break) — the wavelength stretches, the water does not jump.
    lineId       derived from z alone: the six modules are parallel lines
                 spread evenly across z, so lineId = floor(nz * 6) clamped to
                 0..5. Modules 1-3 (BoilderRoom-A) are 0..2, modules 4-6
                 (BoilderRoom-B) are 3..5.
    Per-line variation is a deterministic golden-angle phase offset — never
    random, never an integer period. `cohesion` -> 1 collapses every module onto
    one synchronous current across the whole room.

  Nothing here reads fixtureType, section, group or index, so the composition is
  identical on test_bench / titanic / any other model.

AUDIO_MODULATION_V1:
  sliderLevel      <- micLow  range 0.45..0.85 curve ease    # the body swells with the low band
  sliderTurbulence <- micFlux range 0.30..0.80 curve linear  # builds sharpen and multiply the eddies
  # STATIC: localSpeed, direction, cohesion, whiteFoam, colorPalette1/2
*/

// Export order is physical MIDI order. Local Speed is always first, and
// Direction is always second (memory note `pattern-param-order`).
export var localSpeed = 0.42;
export var direction = 0.72;
export var level = 0.62;
export var cohesion = 0.55;
export var turbulence = 0.40;
export var whiteFoam = 0.28;

export var cp1H = 0.55, cp1S = 1.00, cp1V = 0.90; // deep teal-blue body
export var cp2H = 0.09, cp2S = 0.50, cp2V = 1.00; // warm amber-white crest
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderDirection(v) { direction = v; }
export function sliderLevel(v) { level = v; }
export function sliderCohesion(v) { cohesion = v; }
export function sliderTurbulence(v) { turbulence = v; }
export function sliderWhiteFoam(v) { whiteFoam = v; }

// ── Interior geometry constants ──────────────────────────────────────────────
var SEAM = 0.5454545;      // Seg1/Seg2 boundary in normalized u (world x = 0.5)
var SEG2_FLOW = 1.15;      // downstream narrows: Seg2 runs ~15% faster
var PHI = 1.6180339;
var SQRT2 = 1.4142136;
var GOLDEN_ANGLE = 0.3819660; // 1 - 1/PHI — per-line phase step, never 1/6
var PHASE_WRAP = 10000.0;
var BASE_RATE = 0.1732;    // primary eddy cycles/sec at localSpeed 0.5

var flowPhase = 0.0;

var pr1 = 0.0, pg1 = 0.6, pb1 = 0.9;
var pr2 = 1.0, pg2 = 0.8, pb2 = 0.5;

function clamp01(v) {
  if (v < 0.0) return 0.0;
  if (v > 1.0) return 1.0;
  return v;
}

function _hsv2rgb1() {
  var hv = cp1H - floor(cp1H); if (hv < 0.0) hv += 1.0;
  var iv = floor(hv * 6.0) % 6;
  var fv = hv * 6.0 - floor(hv * 6.0);
  var pv = cp1V * (1.0 - cp1S);
  var qv = cp1V * (1.0 - fv * cp1S);
  var tv = cp1V * (1.0 - (1.0 - fv) * cp1S);
  if      (iv == 0) { pr1 = cp1V; pg1 = tv;   pb1 = pv;   }
  else if (iv == 1) { pr1 = qv;   pg1 = cp1V; pb1 = pv;   }
  else if (iv == 2) { pr1 = pv;   pg1 = cp1V; pb1 = tv;   }
  else if (iv == 3) { pr1 = pv;   pg1 = qv;   pb1 = cp1V; }
  else if (iv == 4) { pr1 = tv;   pg1 = pv;   pb1 = cp1V; }
  else              { pr1 = cp1V; pg1 = pv;   pb1 = qv;   }
}

function _hsv2rgb2() {
  var hv = cp2H - floor(cp2H); if (hv < 0.0) hv += 1.0;
  var iv = floor(hv * 6.0) % 6;
  var fv = hv * 6.0 - floor(hv * 6.0);
  var pv = cp2V * (1.0 - cp2S);
  var qv = cp2V * (1.0 - fv * cp2S);
  var tv = cp2V * (1.0 - (1.0 - fv) * cp2S);
  if      (iv == 0) { pr2 = cp2V; pg2 = tv;   pb2 = pv;   }
  else if (iv == 1) { pr2 = qv;   pg2 = cp2V; pb2 = pv;   }
  else if (iv == 2) { pr2 = pv;   pg2 = cp2V; pb2 = tv;   }
  else if (iv == 3) { pr2 = pv;   pg2 = qv;   pb2 = cp2V; }
  else if (iv == 4) { pr2 = tv;   pg2 = pv;   pb2 = cp2V; }
  else              { pr2 = cp2V; pg2 = pv;   pb2 = qv;   }
}

// Line identity from geometry only: the six MODULES are parallel lines spread
// evenly along z, so nz alone names the line — floor(nz * 6) clamped to 0..5.
// Modules 1-3 (BoilderRoom-A) land on 0..2, modules 4-6 (BoilderRoom-B) on 3..5.
// Cheap floor math, no fixture metadata; on a model whose pixels share one z
// this collapses to a single line and the composition still runs.
function lineIdOf(zz) {
  var lid = floor(clamp01(zz) * 6.0);
  if (lid > 5.0) lid = 5.0;
  return lid;
}

// Continuous travel coordinate: Seg2 is compressed by SEG2_FLOW so the same
// phase covers more physical line there — the current speeds up downstream
// without a seam in the wave itself.
function travelOf(uu) {
  if (uu < SEAM) return uu;
  return SEAM + (uu - SEAM) / SEG2_FLOW;
}

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  _hsv2rgb1();
  _hsv2rgb2();

  // Canonical local-speed law: 0.5 -> 1x, 1 -> 4x, 0 -> 0.25x.
  var localGain = pow(2.0, (clamp01(localSpeed) - 0.5) * 4.0);

  // Direction is a true reversal: the two ends of the range travel opposite
  // ways. The centre still drifts (a river never stops) but at the slowest
  // magnitude, so the knob reads as "how hard, which way".
  var dSign = 1.0;
  if (clamp01(direction) < 0.5) dSign = -1.0;
  var dMag = 0.30 + 1.40 * abs(clamp01(direction) - 0.5) * 2.0;

  flowPhase = flowPhase + dt * BASE_RATE * localGain * dSign * dMag;
  if (flowPhase >= PHASE_WRAP) flowPhase = flowPhase - PHASE_WRAP;
  if (flowPhase <= 0.0 - PHASE_WRAP) flowPhase = flowPhase + PHASE_WRAP;
}

export function render3D(index, x, y, z) {
  var u = clamp01(x);
  var s = travelOf(u);
  var lid = lineIdOf(z);

  // cohesion 1 = one river down both walls; 0 = six independent phases.
  var spread = 1.0 - clamp01(cohesion);
  var ph = lid * GOLDEN_ANGLE * spread;

  var turb = clamp01(turbulence);
  var w3 = 0.06 + turb * 0.28;

  // Three eddies on irrational spatial ratios and irrational relative speeds —
  // the sum never repeats, so the current never reads as a loop.
  var e1 = wave(s * 1.7208 - flowPhase + ph);
  var e2 = wave(s * 2.7841 - flowPhase * PHI + ph * SQRT2);
  var e3 = wave(s * 4.3607 - flowPhase * 0.6180339 + ph * 1.3195);

  var body = (e1 * 0.52 + e2 * 0.31 + e3 * w3) / (0.83 + w3);
  var crest = pow(clamp01(body), 1.60 + turb * 3.00);

  // Floor is shaped, never flat and never black (interior mission rule). The
  // troughs stay genuinely dark so the crests read as MOVING water rather than
  // as a lit line that merely changes tint.
  // The crest gain deliberately stops short of full scale: on the sim's LED
  // preview (and on the real strand) a saturated cp1 blown to full white reads
  // as a lit tube, not as water. Keeping the body around 0.10-0.20 with crests
  // near 0.45 is what makes the teal read as depth and the peaks as foam.
  var lvl = clamp01(level);
  var bri = clamp01(0.16 + (0.05 + lvl * 0.34) * crest + 0.13 * body);

  // cp2 is an ACCENT on the faster eddy, never a co-lead. The high exponent
  // keeps it off the body of the river, which stays cp1: the default cp2 is a
  // half-saturated warm white, so even a 30% blend visibly bleaches the whole
  // line instead of tipping a crest. Turbulence lets a little more through.
  var mix = clamp01(pow(e2, 6.00) * (0.06 + turb * 0.16) + crest * 0.05);

  var r = (pr1 + (pr2 - pr1) * mix) * bri;
  var g = (pg1 + (pg2 - pg1) * mix) * bri;
  var b = (pb1 + (pb2 - pb1) * mix) * bri;

  // whiteFoam desaturates the sharpest crest toward S ~= 0.1. The pattern emits
  // RGB only — the rig derives W natively — so a near-white crest is what
  // actually lights the W element.
  var foam = clamp01((crest - 0.52) / 0.48) * clamp01(whiteFoam) * 0.90;
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
