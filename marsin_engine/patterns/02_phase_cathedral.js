/*
  02_phase_cathedral.js — "Phase Cathedral"

  A huge, beat-locked interference field made from several phase-shifted sine
  planes crossing the whole rig. Four planes f1..f4 cross on golden-ratio
  INCOMMENSURATE ratios (φ=1.618 / 1/φ=0.618) plus a radial term, summed and
  crushed with a sharpness power so the field collapses to crisp bright cores
  with near-black nodes. Deep-blue -> pink/magenta palette, blended in RGB space
  (strict cp1<->cp2 line). Per-section treatment:
    - Bars    (sectionId 3) : plain interference field
    - Pars    (sectionId 1) : zero-crossing cored (bright nodes)
    - Vintage (sectionId 2) : white/amber emitters + kick-driven blinder

  NON-REPEATING MATH
    The four planes advance from ONE beat clock multiplied by incommensurate
    factors: f1 = +1, f2 = -0.5, f3 = +φ (1.618), f4 = -1/φ (0.618). Because φ
    is irrational, f3/f4 never re-phase with f1/f2 — the cathedral never visibly
    loops. Autonomous drift sign is steered by an independent slow clock whose
    period is an irrational number of seconds, so the field OCCASIONALLY
    auto-reverses on its own, organically (never on a round beat).

  SPEED / DIRECTION
    - localSpeed scales the drift rate: pow(2,(localSpeed-0.5)*4). At 0 it still
      CREEPS (a non-zero base rate), at 1 it is clearly faster.
    - sliderDirection: dead-zone-guarded so slider-center never freezes the field.
    - Autonomous auto-reverse: a slow incommensurate clock occasionally flips the
      drift sign so direction is not always one way; the effective sign is never
      exactly 0 (a guarded floor keeps the field always moving).

  PHASE WRAP (seam discipline, skill §7)
    f3/f4 multiply beatPhase by irrational ratios, so wrapping beatPhase at 2π
    would jump (2π·φ mod 2π ≠ 0) -> a visible flash every cycle. We wrap at a
    LARGE multiple of 2π (10000·2π) so float64 precision holds and any seam is
    pushed ~14 hours out. The autonomous-direction clock has its own large wrap.

  AUDIO (modulators-only — never read CPC audio globals natively). The block
  below is the STRICT source of truth a generator parses for the deploy playlist.

AUDIO_MODULATION_V1:
  sliderLevel     <- micLow  range 0.30..1.00 curve linear  # overall brightness (PRIMARY)
  sliderKick      <- micKick range 0.00..1.00 curve pow2    # kick pop + vintage W blinder
  sliderRadius    <- micFlux range 0.40..0.90 curve linear  # field expansion / radial travel
  sliderSharpness <- micMid  range 0.30..0.80 curve linear  # node-crush reshape (secondary geometry)
  # STATIC (omit from audio): localSpeed, sliderCount (radialDensity), direction, colorPalette1/2
*/

// ── Exported controls (UI order = declaration order) ─────────────────────────
export var localSpeed = 0.5;     // FIRST control: drift rate (still creeps at 0)
export var level = 0.5;          // PRIMARY audio: overall brightness — mid; swings up
export var kick = 0.0;           // audio: kick pop + vintage blinder — transient; a
                                 // steady lift flattens the pulse (kills ANIMATING).
export var radius = 0.5;         // audio: field expansion / radial travel
export var sharpness = 0.5;      // node crush power (identity slider; scaled in render3D)
export var radialDensity = 0.5;  // radial ring density (identity slider; scaled in render3D)
export var globalDir = 0.5;      // base drift direction (identity slider; guarded in setter)

export var cp1H = 0.6, cp1S = 1.0, cp1V = 1.0; // Deep Blue
export var cp2H = 0.8, cp2S = 1.0, cp2V = 1.0; // Pink / Magenta
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderLevel(v) { level = v; }        // store v directly
export function sliderKick(v) { kick = v; }          // store v directly
export function sliderRadius(v) { radius = v; }       // store v directly
export function sliderSharpness(v) { sharpness = v; }       // store directly; scale in render3D
export function sliderCount(v) { radialDensity = v; }        // store directly; scale in render3D
export function sliderDirection(v) {
  // Dead-zone guard: slider-center would give globalDir=0 (frozen field). Keep the
  // interference always drifting — slightly forward at/above center, slightly reverse below.
  var d = (v * 2.0) - 1.0;
  if (d >= 0.0 && d < 0.06) d = 0.06;
  else if (d < 0.0 && d > -0.06) d = -0.06;
  globalDir = d;
}

// ── Palette RGB cache (strict cp1<->cp2, blend in RGB space; copied verbatim
//    from 27_swipe.js) ────────────────────────────────────────────────────────
var pr1 = 1, pg1 = 0, pb1 = 0;
var pr2 = 0, pg2 = 0, pb2 = 1;
function _hsv2rgb1() {
  var hv = cp1H - floor(cp1H); if (hv < 0) hv += 1;
  var iv = floor(hv * 6) % 6;
  var fv = hv * 6 - floor(hv * 6);
  var pv = cp1V * (1 - cp1S);
  var qv = cp1V * (1 - fv * cp1S);
  var tv = cp1V * (1 - (1 - fv) * cp1S);
  if      (iv == 0) { pr1 = cp1V; pg1 = tv;   pb1 = pv;   }
  else if (iv == 1) { pr1 = qv;   pg1 = cp1V; pb1 = pv;   }
  else if (iv == 2) { pr1 = pv;   pg1 = cp1V; pb1 = tv;   }
  else if (iv == 3) { pr1 = pv;   pg1 = qv;   pb1 = cp1V; }
  else if (iv == 4) { pr1 = tv;   pg1 = pv;   pb1 = cp1V; }
  else              { pr1 = cp1V; pg1 = pv;   pb1 = qv;   }
}
function _hsv2rgb2() {
  var hv = cp2H - floor(cp2H); if (hv < 0) hv += 1;
  var iv = floor(hv * 6) % 6;
  var fv = hv * 6 - floor(hv * 6);
  var pv = cp2V * (1 - cp2S);
  var qv = cp2V * (1 - fv * cp2S);
  var tv = cp2V * (1 - (1 - fv) * cp2S);
  if      (iv == 0) { pr2 = cp2V; pg2 = tv;   pb2 = pv;   }
  else if (iv == 1) { pr2 = qv;   pg2 = cp2V; pb2 = pv;   }
  else if (iv == 2) { pr2 = pv;   pg2 = cp2V; pb2 = tv;   }
  else if (iv == 3) { pr2 = pv;   pg2 = qv;   pb2 = cp2V; }
  else if (iv == 4) { pr2 = tv;   pg2 = pv;   pb2 = cp2V; }
  else              { pr2 = cp2V; pg2 = pv;   pb2 = qv;   }
}

function clamp01(v) {
  if (v < 0.0) return 0.0;
  if (v > 1.0) return 1.0;
  return v;
}

// ── Tunables ──────────────────────────────────────────────────────────────────
var BASE_RATE = 0.18;   // creep rate (cycles/s) at localSpeed=0 — never static
var SPAN_RATE = 0.90;   // additional rate (cycles/s) added by localSpeed scaling
var DIR_PERIOD = 23.140692; // s; irrational period of the auto-reverse clock (~ e·8.5)
var GOLDEN = 1.618;     // φ — incommensurate plane ratio
var INVGOLDEN = 0.618;  // 1/φ — incommensurate plane ratio

// ── Persistent state ───────────────────────────────────────────────────────────
var beatPhase = 0.0;    // master interference clock (radians)
var dirPhase = 0.0;     // autonomous-direction clock (radians)
var autoSign = 1.0;     // current autonomous drift sign (never 0)

// Wrap at a LARGE multiple of 2π (skill §7): f3/f4 scale beatPhase by irrational
// ratios, so a 2π wrap would flash. 10000·2π keeps float64 precision intact.
var BEAT_WRAP = 62831.853;  // 10000 * 2π
var DIR_WRAP = 62831.853;   // independent large wrap for the direction clock

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  _hsv2rgb1();
  _hsv2rgb2();

  // localSpeed scales drift rate; BASE_RATE keeps a non-zero creep at 0.
  var localMultiplier = pow(2.0, (localSpeed - 0.5) * 4.0);
  var rate = BASE_RATE + SPAN_RATE * localMultiplier;   // cycles per second

  // Autonomous direction: a slow incommensurate clock whose sine occasionally
  // changes sign — organic, clock-driven, never on a round beat. Guard so the
  // effective sign is NEVER exactly 0 (no momentary freeze).
  dirPhase = dirPhase + dt * (6.2831853 / DIR_PERIOD);
  if (dirPhase >= DIR_WRAP) dirPhase = dirPhase - DIR_WRAP;
  var dw = sin(dirPhase);
  if (dw >= 0.0) autoSign = 1.0; else autoSign = -1.0;

  // Effective sign = operator base direction × autonomous sign. globalDir is
  // dead-zone guarded (never 0); autoSign is ±1, so the product is never 0.
  var effDir = globalDir * autoSign;

  beatPhase = beatPhase + dt * rate * 6.2831853 * effDir;
  beatPhase = beatPhase % BEAT_WRAP;
  if (beatPhase < 0.0) beatPhase = beatPhase + BEAT_WRAP;
}

export function render3D(index, x, y, z) {
  var nx = clamp01(x);
  var ny = clamp01(y);

  // Identity-slider scaling: map the stored 0..1 controls to their working spans.
  var sharpPow = 1.0 + sharpness * 7.0;       // node crush power 1..8 (mid 0.5 -> 4.5);
                                              // capped at 8 so the crush extreme stays lit
  var ringDens = 2.0 + radialDensity * 18.0;  // radial ring density 2..20 (mid -> 11)

  // radius (micFlux) expands the field: planes shift outward and the radial ring
  // density travels. Travel is additive so it never zeroes the geometry.
  var expand = radius * 6.0;            // 0..6 cycles of plane shift
  var dens = ringDens + radius * 18.0;  // radial rings travel outward

  var f1 = sin((nx * 10.0) * PI2 + beatPhase + expand);
  var f2 = sin((ny * 10.0) * PI2 - beatPhase * 0.5 - expand);
  var f3 = sin(((nx + ny) * 5.0) * PI2 + beatPhase * GOLDEN);

  var dx = nx - 0.5;
  var dy = ny - 0.85;
  var dist = sqrt(dx * dx + dy * dy);
  var f4 = sin((dist * dens) * PI2 - beatPhase * INVGOLDEN);

  var field = (f1 + f2 + f3 + f4) * 0.25;
  var magnitude = pow(abs(field), sharpPow);
  // Small brightness floor: the field crushes to ~0 at nodes and all planes can
  // hit a zero-crossing at once. Keep a faint glow so the cathedral is NEVER
  // fully black (mission-critical visibility).
  magnitude = 0.08 + magnitude * 0.92;

  // PRIMARY: overall brightness gain from level (micLow). A clean level->gain,
  // no animation-phase wobble, so corr stays high. Range biased so peaks reach
  // full channel and level dominates the brightness budget.
  var gain = 0.25 + 1.45 * level;   // mid default ~0.97; level=1 -> 1.70 push
  // Kick (micKick) pops brightness across the rig.
  var kickPop = 1.0 + kick * 0.9;
  magnitude = magnitude * gain * kickPop;
  if (magnitude > 1.0) magnitude = 1.0;

  // ── Colour: blend cp1<->cp2 in RGB space along the field sign/strength ──────
  // Positive field leans cp1 (blue), negative leans cp2 (magenta); |field|
  // pushes toward the saturated end so the rig spans both palette ends.
  // Push toward the palette ENDS (not the desaturated midpoint) so the rig
  // decisively spans both cp1 and cp2 -> healthy hueSpread.
  var tcol = clamp01(0.5 - field * 1.8);   // -1 -> cp2 end (1), +1 -> cp1 end (0)
  var baseR = pr1 + (pr2 - pr1) * tcol;
  var baseG = pg1 + (pg2 - pg1) * tcol;
  var baseB = pb1 + (pb2 - pb1) * tcol;

  var outR = baseR * magnitude;
  var outG = baseG * magnitude;
  var outB = baseB * magnitude;
  var finalW = 0.0;
  var finalA = 0.0;
  var finalU = 0.0;

  if (sectionId == 3) {
    // Bars: plain interference field (outR/G/B already set).
  }
  else if (sectionId == 1) {
    // Pars: zero-crossing cored — bright at the nodes. zc^(sharpness*2) crushes
    // hard away from nodes; keep a faint floor so all 4 pars stay lit.
    var zc = 1.0 - abs(field);
    zc = pow(zc, sharpPow * 2.0);
    var coreBri = (magnitude * 0.35) + (zc * 0.85 * gain * kickPop);
    if (coreBri > 1.0) coreBri = 1.0;
    outR = baseR * coreBri;
    outG = baseG * coreBri;
    outB = baseB * coreBri;
  }
  else {
    // Vintage: white/amber emitters. Kick drives W HARD as an audience blinder.
    var emit = magnitude * 0.5;
    finalW = emit + kick * 0.9 * (0.4 + 0.6 * abs(field));
    if (finalW > 1.0) finalW = 1.0;
    finalA = finalW * 0.25;
    outR = baseR * emit;
    outG = baseG * emit;
    outB = baseB * emit;
  }

  rgbwau(clamp01(outR), clamp01(outG), clamp01(outB), clamp01(finalW), clamp01(finalA), clamp01(finalU));
}
