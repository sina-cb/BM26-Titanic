/*
  52_silk_ribbons.js — HD, SOUND-REACTIVE SILK PRISM RIBBONS.

  An audio-reactive reinterpretation of 15_silk_prism_ribbons. Smooth satin
  ribbons (bright sinuous bands) slide across the whole rig. Each ribbon is a
  crisp bright band whose centerline MEANDERS on an irrational sine sum, so the
  ribbons never loop. Between ribbons the field is dark (high contrast / HD).
  Colour blends cp1<->cp2 smoothly along AND across the ribbons so both palette
  colours flow through the silk.

  HD: each ribbon has a crisp bright CORE with a soft cosine falloff to the
  darker gaps — sharp where it counts, satin where it should be. A faint living
  base keeps the rig readable in silence (mission-critical, never fully black).

  ── Core equation (per ribbon k, RIBBONS bands evenly spaced in ny) ───────────
    centerline:  c_k(nx,t) = lane_k
                 + AMP * ( sin( (nx*SQRT2 + t      ) * PI2 + k*GOLDEN )
                         + 0.62*sin( (nx*SQRT3 - t*0.61) * PI2 + k*PHI )
                         + 0.37*sin( (nx*PHI   + t*1.37) * PI2 + k*SQRT2 ) )
    distance:    d = |ny - c_k|
    core:        core_k = exp-like cosine lobe of d over (HALF*width)
    Irrational ratios SQRT2, SQRT3, PHI + the golden-angle phase offsets make
    the meander quasi-periodic (no integer period) — the ribbons never repeat.

  ── AUDIO MAP (modulators-only — NEVER read CPC audio globals natively) ───────
  AUDIO_MODULATION_V1:
    sliderAudioLevel <- micLow  range 0.30..1.00 curve linear  # PRIMARY brightness — ribbon width + core brightness + overall track the low band
    sliderShimmer    <- micHigh range 0.00..1.00 curve pow2    # sparkle/detail — high-freq glint riding the bright ribbon crests
  # sliderRibbons: static (ribbon band count; not audio-mapped)
  # sliderSoftness: static (core falloff softness, crisp<->satin; not audio-mapped)
  # sliderLocalSpeed: static (ribbon glide rate; not audio-mapped)
  # micHigh shimmer is a DISTINCT dimension (crest glint), gated to the bright
  # cores so it adds detail without driving the low-band mass — micLow stays PRIMARY.

  CONTROLS (UI order = declaration order)
    - localSpeed  : ribbon glide rate.
    - audioLevel  : ribbon width + brightness + overall (PRIMARY). micLow here.
    - shimmer     : highlight glint on ribbon crests (2nd dim). micHigh here.
    - ribbons     : how many ribbon bands cross the rig.
    - softness    : core falloff softness (low = crisp HD core, high = satin).
    - colorPalette1/2 : strict cp1↔cp2 silk palette.
*/

// ── Exported controls (UI order = declaration order) ────────────────────────
export var localSpeed = 0.5;   // ribbon glide rate
export var audioLevel = 0.5;   // PRIMARY: width + brightness + overall (micLow)
export var shimmer = 0.5;      // 2nd dim: crest highlight glint (micHigh)
export var ribbons = 0.5;      // ribbon band count
export var softness = 0.5;     // core falloff softness

export var cp1H = 0.52, cp1S = 0.92, cp1V = 1.0; // Silk A — cyan default
export var cp2H = 0.86, cp2S = 0.92, cp2V = 1.0; // Silk B — magenta default
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

// IDENTITY-SLIDER convention: store v directly, scale in render/beforeRender.
export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderAudioLevel(v) { audioLevel = v; }  // micLow maps here
export function sliderShimmer(v) { shimmer = v; }        // micHigh maps here
export function sliderRibbons(v) { ribbons = v; }
export function sliderSoftness(v) { softness = v; }

// ── Irrational constants (no integer periods — quasi-periodic meander) ───────
var SQRT2 = 1.41421356;
var SQRT3 = 1.73205081;
var PHI = 1.61803399;
var GOLDEN = 2.39996323;   // golden angle (radians) — per-ribbon phase offset
var AMP = 0.11;            // meander amplitude in ny units
var GLIDE = 0.11;          // ribbon glide turns/sec at localSpeed = 1.0

// ── Palette RGB cache (strict cp1<->cp2 blending; PATTERNS.md §7) ────────────
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

// ── Persistent state / per-frame scalars ─────────────────────────────────────
var phase = 0.0;       // accumulated glide phase (turns)
var nRib = 3.0;        // resolved ribbon count this frame
var halfW = 0.07;      // resolved ribbon half-width (ny units)
var ribBri = 0.6;      // resolved ribbon core brightness
var overall = 0.5;     // resolved overall brightness multiplier
var soft = 1.8;        // resolved falloff exponent
var shim = 0.25;       // resolved shimmer amount
var tShim = 0.0;       // fast shimmer time term
var tBase = 0.0;       // slow living-base time term

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  _hsv2rgb1();
  _hsv2rgb2();

  // Glide the ribbons (accumulated so speed drags don't phase-jump). localSpeed
  // drives the canonical exponential rate pow(2,(localSpeed-0.5)*4): ~0.25x at 0,
  // 1x at 0.5, ~4x at 1 — a genuinely effective 16x span across the slider.
  var localMult = pow(2.0, (localSpeed - 0.5) * 4.0);
  phase = phase + dt * GLIDE * 1.125 * localMult;
  if (phase > 100000.0) phase = phase - 100000.0;

  // Fast irrational shimmer clock + slow base breathing clock. Kept on its own
  // cadence (independent of localSpeed) so the micHigh glint doesn't add
  // localSpeed-coupled brightness flicker that would dilute the PRIMARY corr.
  tShim = time(0.012 / (0.3 + localSpeed));
  tBase = time(0.07);

  // ── Resolve audio-driven look ───────────────────────────────────────────
  // PRIMARY micLow -> audioLevel: widens ribbons, brightens cores, AND lifts
  // overall brightness. All three rise together so total brightness tracks the
  // low signal (corr >= 0.5).
  var lv = clamp01(audioLevel);
  nRib = 2.0 + ribbons * 6.0;                 // 2..8 ribbons (non-integer ok)
  halfW = 0.045 + lv * 0.085;                 // wider silk on bass
  ribBri = 0.50 + lv * 1.10;                  // brighter cores on bass (peak >1 -> 255)
  overall = 0.22 + lv * 1.05;                 // overall brightness tracks micLow
  soft = 1.2 + softness * 3.5;                // crisp(1.2) -> satin(4.7)
  shim = clamp01(shimmer);                     // 2nd dim: crest highlight
}

export function render3D(index, x, y, z) {
  // test_bench is normalized: nx,ny already in 0..1. Use them directly so the
  // ribbons sweep the whole rig (pars high, bars mid, vintage low).
  var nx = clamp01(x);
  var ny = clamp01(y);

  // ── Find the brightest ribbon core covering this pixel ───────────────────
  var bri = 0.0;
  var shape = 0.0;    // raw ribbon lobe 0..1 (pre-brightness, for silence floor)
  var along = 0.0;    // 0..1 position ALONG the ribbon (for colour flow)
  var kk = 0;
  for (kk = 0; kk < 8; kk++) {
    if (kk >= nRib) break;
    var lane = (kk + 0.5) / nRib;            // evenly spaced lanes in ny

    // Meandering centerline — irrational sine sum (quasi-periodic, no loop).
    var m1 = sin((nx * SQRT2 + phase)        * PI2 + kk * GOLDEN);
    var m2 = sin((nx * SQRT3 - phase * 0.61) * PI2 + kk * PHI);
    var m3 = sin((nx * PHI   + phase * 1.37) * PI2 + kk * SQRT2);
    var center = lane + AMP * (m1 + 0.62 * m2 + 0.37 * m3) * 0.5;

    var dd = ny - center; if (dd < 0.0) dd = -dd;
    if (dd < halfW) {
      // Crisp cosine core: 1 at centerline, 0 at the half-width edge.
      var u = dd / halfW;                    // 0..1
      var lobe = 0.5 + 0.5 * cos(u * PI);    // 1 -> 0 cosine falloff
      lobe = pow(lobe, soft);                // soft exponent: crisp <-> satin
      var v = lobe * ribBri;
      if (v > bri) {
        bri = v;
        shape = lobe;                        // raw lobe for the silence floor
        along = nx;                          // colour flows along the ribbon
      }
    }
  }

  // Overall brightness tracks micLow (PRIMARY correlation).
  bri = bri * overall;

  // ── Faint living SILK FLOOR so silence still reads (never fully black) ────
  // Applied AFTER the overall multiplier so the ribbons stay faintly visible
  // even when audioLevel (micLow) is 0. Kept low so it never competes with the
  // music-driven mass, and it breathes slowly so the rig is alive at rest.
  var floorBri = (0.05 + 0.12 * shape) * (0.6 + 0.4 * wave(tBase + nx * 0.7 + ny * 0.4));
  if (floorBri > bri) { bri = floorBri; }

  // ── Silky crest SHIMMER (2nd dimension, micHigh) ────────────────────────
  // A fast irrational glint that rides ONLY the bright ribbon crests. It adds
  // highlight/white pop where the silk is brightest — a different dimension
  // than the low-driven mass. Gated by `bri` so gaps stay dark.
  var crest = clamp01((bri - 0.30) / 0.70);  // 1 on crests, 0 in gaps
  var sparkPh = nx * 7.0 + ny * 4.0 + index * 0.37 + tShim * 11.0;
  var spk = sin(sparkPh * PI2) * sin(sparkPh * SQRT2 * PI2 + 1.3);
  spk = spk * spk;                            // 0..1, biased crisp
  var glint = shim * crest * spk * 0.18;

  // ── Colour: blend cp1<->cp2 along AND across the silk (both colours flow) ─
  var across = 0.0;
  if (bri > 0.0) {
    // mix the ALONG position with a slow cross term so colour drifts in 2D
    across = clamp01(0.5 + 0.5 * sin((along * 1.0 + ny * 1.5 + phase * 0.5) * PI2));
  }
  var tcol = across;

  var r = (pr1 + (pr2 - pr1) * tcol) * bri;
  var g = (pg1 + (pg2 - pg1) * tcol) * bri;
  var b = (pb1 + (pb2 - pb1) * tcol) * bri;

  // Add the shimmer as a near-white highlight on the crests (RGB + W channel).
  r = r + glint;
  g = g + glint;
  b = b + glint;
  var ww = glint * 0.7;

  rgbwau(clamp01(r), clamp01(g), clamp01(b), clamp01(ww), 0.0, 0.0);
}
