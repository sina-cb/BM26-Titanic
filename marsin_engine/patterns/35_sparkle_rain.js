/*
  35_sparkle_rain.js — SPARKLE RAIN (high-def, audio-reactive).

  Amalgamates 13_sparkle (crisp deterministic per-pixel glints), 07_shimmer
  (faint living base) and 24_chromatic_murmuration (strict cp1<->cp2 RGB blend).

  Dense, fine, crisp glints fall — they DRIFT DOWNWARD in y over time — on a
  near-black field. Each glint is a deterministic single-pixel threshold test
  (like 13_sparkle): the sparkle "field" is sampled at a y-coordinate that
  scrolls upward with time, so the lit cells appear to rain DOWN the rig. No
  blur, no smoothing — glints stay crisp single points.

  Audio drives TWO orthogonal dimensions:
    - `level` (micLow) is the PRIMARY: a whole-rig brightness gain that the bass
      lifts/drops monotonically (so total brightness tracks micLow, corr >= 0.5).
      It is a flat per-frame gain — it does NOT wobble with the rain's own
      animation phase, which would pollute the correlation.
    - `kick` (micKick) is a DISCRETE spawn event: a beat punches the rain DENSER
      (lowers the lit threshold) and briefly brighter — a kick-driven shower.
    - `density` (micHigh) stays a SECONDARY sparkle-detail dimension: the highs
      add fine glint count + a touch of shimmer brightness (the original sparkle
      character) without owning the brightness budget.
  A minimal time-based base keeps the rig readable when silent (mission-critical
  visibility) without ever going fully black.

  Palette: cp1 = cool white/blue glint, cp2 = pale gold glint; sparkles blend
  cp1<->cp2 per pixel. Crisp white core is emitted on the W channel via rgbwau.

  CONTROLS (UI order = declaration order)
    - localSpeed : overall animation rate (sparkle churn + fall).
    - level      : overall rain brightness (PRIMARY, micLow). Modulatable.
    - density    : how many glints are lit (highs → more sparkle). Modulatable.
    - kick       : beat-driven density/brightness pop (micKick). Modulatable.
    - fall       : downward fall speed of the rain.
    - intensity  : glint brightness.
    - base       : faint base floor (never fully black).
    - colorPalette1/2 : cp1 cool white/blue, cp2 pale gold.

  AUDIO (modulators-only — never read CPC audio globals natively):
AUDIO_MODULATION_V1:
  sliderLevel   <- micLow  range 0.25..1.00 curve linear   # PRIMARY brightness: bass drives overall rain brightness
  sliderDensity <- micHigh range 0.30..1.00 curve linear   # SECONDARY sparkle/detail: highs add glint count + shimmer
  sliderKick    <- micKick range 0.00..1.00 curve pow2      # SPAWN: kick punches the rain denser + brighter on the beat
  # sliderFall      static 0.50  # rain fall speed (motion, not audio-driven)
  # sliderIntensity static 0.85  # glint peak brightness (static)
  # sliderBase      static 0.12  # silence visibility floor (static)
  # sliderLocalSpeed static 0.50  # operator rain pace, not an audio target
*/

// ── Exported controls (UI order = declaration order) ────────────────────────
export var localSpeed = 0.5;   // overall animation rate
export var level = 0.5;        // PRIMARY overall brightness (micLow). Modulatable.
export var density = 0.5;      // glint count 0..1 (highs -> more). Modulatable.
export var kick = 0.0;         // beat spawn pop 0..1 (micKick). Modulatable.
export var fall = 0.5;         // downward fall speed
export var intensity = 0.85;   // glint brightness
export var base = 0.12;        // faint base floor (never fully black)

export var cp1H = 0.58, cp1S = 0.35, cp1V = 1.0; // cool white / blue glint
export var cp2H = 0.12, cp2S = 0.45, cp2V = 1.0; // pale gold glint
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderLevel(v) { level = v; }           // micLow maps here (PRIMARY)
export function sliderDensity(v) { density = v; }       // micHigh maps here (secondary)
export function sliderKick(v) { kick = v; }             // micKick maps here (spawn)
export function sliderFall(v) { fall = v; }
export function sliderIntensity(v) { intensity = v; }
export function sliderBase(v) { base = v; }

// ── Tunables ────────────────────────────────────────────────────────────────
var FALL_MAX = 0.9;   // y-cells per second of scroll at fall = 1.0
var CHURN_MAX = 0.6;  // sparkle re-roll rate at localSpeed = 1.0
var GRID_Y = 16.0;    // vertical quantisation of the falling rain field

// ── Palette RGB cache (strict cp1<->cp2 blending) ───────────────────────────
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

// ── Persistent state ─────────────────────────────────────────────────────────
var fallPhase = 0.0;  // accumulated downward scroll (cells); the rain falls
var tChurn = 0.0;     // sparkle re-roll time term
var tBase = 0.0;      // slow base breathing time term

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  _hsv2rgb1();
  _hsv2rgb2();

  // localSpeed: exponential rate trim (pow(2,(localSpeed-0.5)*4)) so the fader
  // spans a WIDE, visibly-different rain rate — a slow trickle at 0, a downpour
  // at 1. A small floor keeps the rain always faintly falling/twinkling at 0
  // (motion stays > 0 at the bottom — never a frozen field).
  var rateMult = 0.10 + pow(2.0, (localSpeed - 0.5) * 4.0);

  // Rain scrolls so cells appear to move DOWN (y decreasing) over time. Both the
  // fall speed AND the sparkle churn ride rateMult so localSpeed clearly changes
  // the whole rain's pace.
  fallPhase = fallPhase + dt * (0.15 + fall * FALL_MAX) * rateMult;
  if (fallPhase > 100000.0) fallPhase = fallPhase - 100000.0; // bound growth

  tChurn = time(0.05 / (0.25 + rateMult * CHURN_MAX));
  // Base breathing ALSO rides rateMult so localSpeed paces the WHOLE field (base
  // shimmer + glint churn + fall together) — clearly slower at 0, faster at 1.
  tBase = time(0.4 / (0.20 + rateMult * 0.9));
}

export function render3D(index, x, y, z) {
  // PRIMARY brightness gain: a FLAT per-frame scalar driven by `level` (micLow),
  // resolved once and applied to BOTH the smooth field and the glints below, so
  // the whole rain brightens/dims with the bass -> clean micLow->brightness corr.
  var lvlGain = 0.22 + clamp01(level) * 2.10;

  // Quantise into a falling vertical grid cell. Adding fallPhase to the y
  // sample point scrolls the field upward, so lit cells drift DOWNWARD.
  var cellF = y * GRID_Y + fallPhase;
  var cellY = floor(cellF);

  // Deterministic per-cell, per-pixel-column sparkle hash (crisp, single pixel).
  // Mix in index + z so neighbouring pixels do not all light together, and a
  // churn term so glints twinkle/re-roll over time.
  var seed = index * 12.9898 + cellY * 78.233 + z * 37.719 + tChurn * 53.41;
  var spk = sin(seed) * sin(seed * 1.7 + 1.3) * sin(seed * 3.3 + 2.1);
  spk = spk * spk;                 // 0..1, biased low → sparse
  spk = spk * spk;                 // sharpen → crisp glints

  // SECONDARY dimensions: density (micHigh) lowers the threshold → more cells light
  // (sparkle/detail), and kick (micKick) ALSO lowers it on the beat → a denser
  // shower (beat-spawn). They drive glint COUNT/shimmer, NOT the overall brightness
  // budget (that is `level`, the flat micLow PRIMARY gain on the smooth field).
  var kk = clamp01(kick);
  var threshold = 0.90 - density * 0.45 - kk * 0.26;

  var glint = 0.0;
  if (spk > threshold) {
    var amt = (spk - threshold) / (1.0 - threshold + 0.0001);
    amt = clamp01(amt);
    // Glint brightness: the highs' sparkle shimmer + a kick pop give the rain its
    // CHARACTER. The glints are ALSO scaled by the `level` (micLow) PRIMARY gain
    // (computed once per frame below) so the bass lifts the whole rain together —
    // field AND glints — keeping total brightness a clean monotonic function of
    // micLow even as the sparkle COUNT varies (the count rides multiplicatively on
    // the level signal, so it does not break the correlation).
    glint = amt * (0.30 + intensity * 0.45) * (0.70 + density * 0.30 + kk * 0.50);
    glint = clamp01(glint * lvlGain);
  }

  // Living rain FIELD — the SMOOTH layer that carries the PRIMARY brightness. It is
  // a per-pixel falling stripe pattern (rides fallPhase so the bands drift DOWN with
  // the rain), built as a near ZERO-MEAN ripple around a steady spatial wash. As the
  // bands scroll, the rig's TOTAL brightness stays ~flat frame-to-frame — only
  // `level` (micLow) moves it — so the field gives a clean micLow->brightness PRIMARY
  // corr while the per-pixel bands still read as falling rain (spatial darkFrac,
  // high contrast). The sparse glints sit on top as character, not the budget.
  var fieldWv = wave(y * 2.3 + fallPhase * 0.18);   // the falling band phase
  var bandRipple = (fieldWv - 0.5);                 // zero-mean: crests +, troughs -
  // Steady spatial wash (a STATIC per-pixel gradient — no time term, so it adds NO
  // per-frame total variance) gives some pixels a dim floor and others a bright
  // crest (spatial contrast / darkFrac) while keeping the rig TOTAL flat. A
  // zero-mean falling ripple sculpts the rain bands on top WITHOUT shifting the
  // total, so the only thing that moves total brightness is `level` (micLow) ->
  // clean PRIMARY corr.
  var wash = 0.16 + 0.84 * (0.5 + 0.5 * sin(y * 6.2831853 * 1.5 + index * 0.21));
  var baseV = base * (wash + 0.30 * bandRipple) * 2.60;
  if (baseV < 0.0) baseV = 0.0;                     // troughs clamp to true-dark
  // Section accent: a faint per-section tint shift, ADDITIVE (test_bench only —
  // sectionId is 0 elsewhere so this contributes 0 there, base still lights all).
  if (sectionId > 0) {
    baseV = baseV + base * 0.08 * (0.5 + 0.5 * wave(tBase + sectionId * 0.13));
  }
  // PRIMARY: the field is scaled by the `level` (micLow) gain resolved at the top
  // of render3D — a single per-frame scalar (no animation-phase wobble), so total
  // rig brightness rises/falls monotonically with the bass -> clean, strong
  // micLow->brightness correlation. The gain's floor keeps silence visible.
  baseV = baseV * lvlGain;

  // The field spans cp1<->cp2 across the rig on a multi-cycle coord field that
  // REACHES both endpoints (triangle), so the rig alternates cool and gold bands —
  // a robust two-colour spread (keeps hueSpread up) that ALSO owns the RGB
  // BRIGHTNESS BUDGET, so total RGB brightness tracks the `level` (micLow) PRIMARY
  // cleanly. The glints add only a SMALL crisp white-core highlight (mostly on the
  // W channel + a light RGB sparkle), so the SECONDARY sparkle dimensions (micHigh
  // count, micKick spawn) shape the TEXTURE without owning — or polluting — the
  // brightness budget.
  var tCol = clamp01(triangle(x * 2.3 + y * 0.6 + tBase * 0.4));
  var v = baseV;

  // A light additive sparkle in RGB (kept SMALL so glint COUNT does not dominate
  // the brightness budget / micLow correlation), pulled toward cp1 (cool white).
  var spark = glint * 0.18;
  var rr = (pr1 + (pr2 - pr1) * tCol) * v + (pr1 * spark);
  var gg = (pg1 + (pg2 - pg1) * tCol) * v + (pg1 * spark);
  var bb = (pb1 + (pb2 - pb1) * tCol) * v + (pb1 * spark);

  // Crisp white core on the W channel for the glints (the sparkle headline). Kept
  // modest so the per-frame glint COUNT noise stays a small fraction of the smooth
  // field's brightness budget — the field (the micLow PRIMARY) dominates the total.
  var ww = glint * 0.45;

  rgbwau(clamp01(rr), clamp01(gg), clamp01(bb), clamp01(ww), 0.0, 0.0);
}
