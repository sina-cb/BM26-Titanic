/*
  53_neon_elevator_hd.js — HD, SOUND-REACTIVE NEON ELEVATOR (source: 06_neon_elevator).

  A vertical stack of glowing NEON FLOORS rises along the rig's unified Y. Each
  floor is a crisp bright band separated by TRUE-BLACK gaps; floors alternate /
  blend strictly between cp1 and cp2 so both palette colours read clearly across
  the rig. The stack scrolls UPWARD continuously at an IRRATIONAL rate so it never
  loops, and on the KICK it STEPS up one whole floor (discrete jump on top of the
  smooth scroll).

  Unified vertical floor coordinate `fc` (0 = bottom .. 1 = top), assigned per
  section so the rig reads as one tall elevator shaft, bottom -> top:
    BARS    (sId 3, ny 0.636) -> lower shaft  fc in [0.00 .. 0.45], with a gentle
            x-tilt so each band shimmers crisply across the long bars (HD detail).
    PARS    (sId 1, ny ~1.0)  -> mid shaft     fc in [0.45 .. 0.70].
    VINTAGE (sId 2, fId 5-6)  -> TOP floor     fc in [0.70 .. 1.00], the higher
            heads (head_1, ny 0.2727) are the very top of the shaft.

  SIGNATURE (source 06 + 00_golden_hour blinder technique): when a floor ARRIVES
  at the top of the shaft (a bright band reaches fc ~ 1.0) AND on every kick, the
  TOP floor lands on the VINTAGE heads (fId 5-6) and we POP their W (white)
  channel via rgbwau as a vintage-filament BLINDER. Crisp impact, not a palette
  change.

  HIGH DEFINITION: floors are narrow bands on true black (gaps = 0). The band
  profile is a sharpened raised-cosine (pow), so every scroll/step reads as an
  exact, crisp move — never a mushy glow. A tiny breathing base keeps the shaft
  alive (non-black) in silence (mission-critical visibility).

  ── CORE EQUATION ────────────────────────────────────────────────────────────
    band(fc) = pow( 0.5 + 0.5*cos( PI2 * floorCount * (fc - scroll) ), sharp )
    scroll  += dt * (SCROLL_BASE + level*SCROLL_GAIN) * SQRT2     // irrational
    floorCount = 5 + PHI                                          // irrational
    on kick: scroll += 1/floorCount  (step one floor) + W blinder on vintage top

  IRRATIONALITY: scroll rate carries a SQRT2 (1.41421356…) factor and floorCount
  = 5 + PHI (6.6180339…, PHI = golden ratio) so the band lattice has no integer
  period — the stack never repeats. Step size 1/floorCount is likewise irrational.

  CONTROLS (UI order = declaration order)
    - localSpeed : base scroll rate trim.
    - level      : floor brightness + scroll speed + overall brightness (PRIMARY).
    - kick       : discrete floor STEP + top-floor vintage W blinder (2nd dim).
    - sharp      : band crispness (higher = thinner, harder-edged floors) — GEOMETRY.
    - floorCount : number of floors in the shaft (irrational base, +PHI).
    - colorPalette1/2 : strict cp1<->cp2 (alternate floors carry cp1 vs cp2).

  AUDIO (modulators-only — NEVER read CPC audio globals natively):
  AUDIO_MODULATION_V1:
    sliderLevel <- micLow  range 0.30..1.00 curve linear   # PRIMARY brightness + scroll speed
    sliderKick  <- micKick range 0.00..1.00 curve linear   # discrete floor STEP + vintage W blinder
    sliderSharp <- micMid  range 0.30..0.85 curve linear   # GEOMETRY: mids thin/crisp the floor bands
    # sliderFloorCount static (shaft floor count — operator geometry, not audio)

  RIG-AGNOSTIC: the floor-coordinate fc is driven off the normalized Y coord
  (0..1) as a base, so the shaft lights on EVERY rig (test_bench 52, titanic 970,
  dome 266, logsville 216). The known test_bench sections (1/3 pars/bars, 2
  vintage) refine fc and add the vintage-head W blinder as OPTIONAL ACCENTS only;
  sectionId is never a gate, so titanic (all sectionId 0) still lights.
*/

// ── Exported controls (UI order = declaration order) ─────────────────────────
export var localSpeed = 0.5;   // base scroll rate trim
export var level = 0.55;       // PRIMARY: floor brightness + scroll speed + overall (micLow)
export var kick = 0.0;         // floor STEP + vintage top blinder (micKick)
export var sharp = 0.5;        // band crispness (higher = thinner, crisper floors)
export var floorCount = 0.5;   // number-of-floors knob (mapped to irrational count)

export var cp1H = 0.83, cp1S = 1.0, cp1V = 1.0; // palette 1 — neon magenta (odd floors)
export var cp2H = 0.50, cp2S = 1.0, cp2V = 1.0; // palette 2 — neon cyan    (even floors)
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderLevel(v) { level = v; }
export function sliderKick(v) { kick = v; }
export function sliderSharp(v) { sharp = v; }
export function sliderFloorCount(v) { floorCount = v; }

// ── Tunables (all irrational where it matters) ───────────────────────────────
var SQRT2 = 1.4142135623730951;  // irrational scroll multiplier (no integer period)
var PHI   = 1.6180339887498949;  // golden ratio — irrational floor-count offset
var SCROLL_BASE = 0.045;         // floors/sec scrolled at rest (alive in silence)
var SCROLL_GAIN = 0.22;          // extra scroll from `level` (drops scroll faster)
var BASE_FLOOR  = 0.05;          // breathing base so silence is non-black
var STEP_MIN    = 0.30;          // kick must exceed this to count as a beat

// ── Palette RGB cache (strict cp1<->cp2 blending; PATTERNS.md §7) ─────────────
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

// ── Persistent / per-frame state ─────────────────────────────────────────────
var scroll = 0.0;        // continuous upward scroll position (0..1 wrapped, irrational rate)
var nFloors = 6.618;     // resolved irrational floor count this frame
var sharpPow = 6.0;      // resolved band sharpening exponent this frame
var bri0 = 0.18;         // resolved overall brightness multiplier (level-driven)
var breathe = 0.0;       // slow breathing phase for the silence base
var blinder = 0.0;       // top-floor vintage W blinder envelope (0..1), decays
var arriveGlow = 0.0;    // smooth top-arrival glow (band crossing fc=1.0)
var kickPrev = 0.0;      // previous kick value (rising-edge detect)

export function beforeRender(delta) {
  _hsv2rgb1();
  _hsv2rgb2();

  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  var localMult = pow(2.0, (localSpeed - 0.5) * 4.0);   // localSpeed 0..1 -> 0.25x..4x scroll rate

  // Resolve irrational floor count: 5 + PHI base, knob nudges +/- a few floors.
  nFloors = 5.0 + PHI + floor(floorCount * 6.0); // 6.618 .. ~12.618, never integer

  // Sharpness: thin, crisp bands. Map slider to a strong exponent.
  sharpPow = 3.0 + sharp * 12.0;                  // 3 .. 15

  // PRIMARY: micLow -> level. Brighter floors + faster scroll + brighter overall.
  // Steep curve so overall brightness tracks micLow tightly (corr target >=0.5).
  var lv = clamp01(level);
  var lvc = lv * lv;                               // emphasise the signal
  bri0 = 0.10 + lvc * 0.95;                         // overall brightness 0.10..1.05 (steep quadratic)

  // Continuous UPWARD scroll at an IRRATIONAL rate (SQRT2), faster on the drops.
  var rate = (SCROLL_BASE + lv * SCROLL_GAIN) * SQRT2 * localMult;
  scroll = scroll + dt * rate;
  scroll = scroll - floor(scroll);

  // Slow breathing for the silence base (irrational phase so it never syncs).
  breathe = breathe + dt * 0.11 * SQRT2;
  breathe = breathe - floor(breathe);

  // KICK (2nd dimension, DISCRETE): on a rising kick edge, STEP up one whole
  // floor and fire the vintage top-floor W blinder. Step size = 1/nFloors is
  // irrational, keeping the lattice non-repeating.
  var kv = clamp01(kick);
  if (kv > STEP_MIN && kickPrev <= STEP_MIN) {
    scroll = scroll + 1.0 / nFloors;
    scroll = scroll - floor(scroll);
    blinder = 1.0;                                 // snap blinder on the beat
  }
  kickPrev = kv;

  // Decay the blinder envelope (crisp pop, quick fade — the vintage filament).
  blinder = blinder - dt * 6.0;
  if (blinder < 0.0) blinder = 0.0;
  // Sustain a little blinder from continuous kick energy so heavy beats glow.
  if (kv * 0.8 > blinder) blinder = kv * 0.8;

  // Smooth top-arrival glow: how close any band center is to fc = 1.0 (the top).
  // band centers sit at scroll + k/nFloors; nearest distance to the top.
  var topPhase = (1.0 - scroll) * nFloors;
  topPhase = topPhase - floor(topPhase);           // 0..1 distance (in floors) to next band above top
  var nearTop = 1.0 - topPhase;                    // ~1 when a band is right at the top
  arriveGlow = pow(clamp01(nearTop), 3.0);
}

// Floor band intensity at unified floor-coordinate fc (crisp band on black).
function bandAt(fc) {
  var ph = (fc - scroll) * nFloors;                // floor-lattice phase
  var c = 0.5 + 0.5 * cos(ph * PI2);               // 0..1 raised cosine per floor
  return pow(c, sharpPow);                          // sharpen -> crisp thin band
}

// Which palette colour this floor uses (alternate cp1 / cp2 by floor index).
function floorTcol(fc) {
  var fk = floor((fc - scroll) * nFloors + 0.5);   // nearest floor index
  var odd = fk - floor(fk / 2.0) * 2.0;            // fk % 2  (0 or 1)
  return odd;                                       // 0 -> cp1, 1 -> cp2
}

export function render3D(index, x, y, z) {
  // ── Assign this pixel a unified vertical floor-coordinate fc (0 bottom..1 top)
  // RIG-AGNOSTIC BASE: drive fc straight off the normalized Y coord (0..1) so the
  // elevator shaft reads on EVERY rig (titanic ships every pixel as sectionId 0;
  // a sectionId gate here would black the whole rig). The known test_bench
  // sections then ADD their bespoke layout on top as an optional accent, so the
  // test_bench look is unchanged.
  var fc = clamp01(y);                              // coord-driven shaft: bottom..top
  var isVintage = 0;
  if (sectionId == 3) {
    // BARS: lower shaft 0.00..0.45. Gentle x-tilt -> crisp diagonal shimmer (HD).
    fc = 0.04 + 0.40 * (0.5 + (x - 0.5) * 0.30);   // 0.04..0.44 across the bars
  } else if (sectionId == 1) {
    // PARS: mid shaft 0.45..0.70 spread across the four pars by x.
    fc = 0.47 + 0.21 * x;                          // ~0.47..0.68
  } else if (sectionId == 2) {
    // VINTAGE: TOP floor 0.70..1.00; higher heads (bigger ny) are the very top.
    var ny = y / 0.2727;                            // vintage strip 0..1 (head6..head1)
    fc = 0.72 + 0.28 * clamp01(ny);                 // 0.72..1.00
    isVintage = 1;
  }

  // ── Crisp neon floor band on true black ──────────────────────────────────
  var band = bandAt(fc);

  // Breathing base so silence still reads (never fully dark). Scales partly with
  // bri0 so the whole shaft brightens with micLow (helps PRIMARY correlation),
  // but keeps a floor in silence (non-black).
  var base = (BASE_FLOOR + 0.06 * bri0) * (0.45 + 0.55 * wave(breathe + fc * 0.5));

  var bri = band * bri0;
  if (base > bri) bri = base;

  // Palette: alternate floors carry cp1 vs cp2 so BOTH colours show across rig.
  var tcol = floorTcol(fc);
  // Base (gap) light leans toward whichever colour is nearer — keep two-colour.
  if (band < 0.05) tcol = wave(fc * 1.7 + breathe) > 0.5 ? 0.0 : 1.0;

  var r = (pr1 + (pr2 - pr1) * tcol) * bri;
  var g = (pg1 + (pg2 - pg1) * tcol) * bri;
  var b = (pb1 + (pb2 - pb1) * tcol) * bri;

  // ── VINTAGE top-floor W BLINDER (signature) ───────────────────────────────
  // When a floor lands on the top (vintage heads) and/or on the kick, pop the
  // white filament. Strongest on the very top heads, scaled by how lit this
  // vintage pixel's own band is so it reads as the floor *arriving* here.
  var w = 0.0;
  if (isVintage == 1) {
    var topW = clamp01(fc - 0.70) / 0.30;           // 0 at base of vintage, 1 at top head
    topW = topW * topW;                             // bias to the very top heads
    var pop = blinder * 0.85 + arriveGlow * 0.45;
    w = clamp01(pop * topW * (0.4 + 0.6 * band));
    // keep a faint warm filament so vintage never goes stone dark
    if (w < base * 0.5) w = base * 0.5;
  }

  rgbwau(clamp01(r), clamp01(g), clamp01(b), w, 0.0, 0.0);
}
