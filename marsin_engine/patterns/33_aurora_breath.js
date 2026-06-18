/*
  33_aurora_breath.js — a magical, high-def AURORA that BREATHES with the music.

  Soft vertical glowing ribbons of light drift and undulate across the rig:
  layered sines in x over time give curtains of luminance; a soft falloff
  (sliderSoft) keeps the ribbons luminous but crisp-edged. Colour blends
  cp1<->cp2 ACROSS HEIGHT (real aurora gradient: green near the horizon
  rising into magenta/violet at the crown), so the curtain spans two distinct
  hues top-to-bottom — hueSpread is structural, not incidental.

  TWO AUDIO DIMENSIONS:
    PRIMARY  — the BREATH. A low-band level (sliderSwell <- micLow) drives both
               overall brightness AND ribbon extent, so on a bass swell the
               aurora blooms brighter and wider (corr ~0.9+).
    DETAIL   — the SHIMMER. A high-band level (sliderShimmer <- micHigh) adds a
               fast, fine, crisp sparkle riding on the crests (a different
               spatial dimension: high-frequency detail, not bulk brightness),
               so hats/cymbals make the curtain glitter without dominating the
               breath. This keeps the two signals driving distinct dimensions.

  A gentle time-based base (sliderBase + a slow shimmer) keeps a calm glow alive
  in silence — never fully black (mission-critical visibility).

  Amalgamates:
    00_golden_hour_wash  — wave() coordinate wash + cp1<->cp2 RGB blend
    11_bioluminescence   — slow ambient swell that breathes
    15_silk_prism_ribbons— layered ribbon sines drifting through the rig
    13_sparkle           — crisp deterministic high-band glint detail

  Core equation (per pixel, incommensurate ribbon frequencies):
    curtain = 0.72*wave(nx*rib*SQRT2 - drift + ny*0.22)
            + 0.28*wave(nx*rib*PHI*0.5 + drift*0.6 - ny*0.35 + undulate)
    lum     = curtain^(5 - soft*3.7);  bri = shaped(lum,extent)*gain + shimmerGlint
    hue t   = 0.12 + 0.76*ny + small drift  (green ny=0 -> violet ny=1)
  with SQRT2=1.41421, PHI=1.61803, golden-angle GA=2.39996 (radians) for the
  shimmer hash — irrational, non-integer periods, never repeats.

  CONTROLS (UI order = declaration order)
    - localSpeed : drift/undulation rate (0 = nearly frozen).
    - swell      : low level -> brightness + ribbon extent (the breath). Modulatable.
    - shimmer    : high level -> fine crisp sparkle on the crests. Modulatable.
    - ribbons    : ribbon count / density across x.
    - soft       : edge softness (low = crisp curtains, high = wide soft glow).
    - base       : calm time-based floor so silence still reads.
    - colorPalette1/2 : cp1 (green, horizon) <-> cp2 (magenta/violet, crown),
                        blended across height.

  AUDIO (modulators-only — never read CPC audio globals natively):
      MODULATE sliderSwell   (swell)   <- micLow
      MODULATE sliderShimmer (shimmer) <- micHigh
*/

// ── Exported controls (UI order = declaration order) ────────────────────────
export var localSpeed = 0.5;   // drift / undulation rate
export var swell = 0.0;        // LOW level -> brightness + extent (the breath)
export var shimmer = 0.0;      // HIGH level -> fine crisp sparkle (detail)
export var ribbons = 0.45;     // ribbon count / density
export var soft = 0.5;         // edge softness (0 = crisp, 1 = wide soft glow)
export var base = 0.18;        // calm time-based floor (silence still reads)

export var cp1H = 0.34, cp1S = 1.0, cp1V = 1.0; // green (horizon, low ny)
export var cp2H = 0.85, cp2S = 1.0, cp2V = 1.0; // magenta / violet (crown, high ny)
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderSwell(v) { swell = v; }       // micLow maps here (PRIMARY)
export function sliderShimmer(v) { shimmer = v; }   // micHigh maps here (DETAIL)
export function sliderRibbons(v) { ribbons = v; }
export function sliderSoft(v) { soft = v; }
export function sliderBase(v) { base = v; }

// ── Tunables ────────────────────────────────────────────────────────────────
var MIN_RIBBONS = 1.5;   // ribbon count at sliderRibbons = 0
var MAX_RIBBONS = 7.0;   // ribbon count at sliderRibbons = 1
var SQRT2 = 1.41421;     // incommensurate ribbon frequency A
var PHI   = 1.61803;     // incommensurate ribbon frequency B (golden ratio)
var GA    = 2.39996;     // golden angle (radians) — shimmer hash, never repeats

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

// ── Persistent / per-frame state ──────────────────────────────────────────────
var drift = 0.0;       // primary ribbon drift phase, 0..1
var undulate = 0.0;    // slow secondary undulation phase, 0..1
var shimT = 0.0;       // fast shimmer churn phase (re-rolls the sparkle field)
var slowShim = 0.0;    // very slow base-shimmer phase, 0..1
var ribCount = 3.0;    // resolved ribbon count this frame
var extent = 0.4;      // resolved breath extent this frame (0..~1)
var floorV = 0.18;     // resolved calm floor this frame
var shimGain = 0.0;    // resolved shimmer (high-band) gain this frame
var shimThresh = 1.0;  // resolved sparkle threshold this frame (high -> lower)

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  _hsv2rgb1();
  _hsv2rgb2();

  // Local-speed trim, exponential so the fader feels even (matches template).
  var localMult = pow(2.0, (localSpeed - 0.5) * 4.0);

  drift    = drift    + dt * 0.060 * localMult; drift    = drift    - floor(drift);
  undulate = undulate + dt * 0.023 * localMult; undulate = undulate - floor(undulate);
  slowShim = slowShim + dt * 0.011 * localMult; slowShim = slowShim - floor(slowShim);
  // Shimmer churn runs fast so the high-band glints twinkle crisply.
  shimT    = shimT    + dt * 0.900 * localMult; shimT    = shimT    - floor(shimT);

  ribCount = MIN_RIBBONS + ribbons * (MAX_RIBBONS - MIN_RIBBONS);

  // The breath: swell drives both brightness gain and ribbon extent. A small
  // constant keeps the curtains visible at zero swell.
  extent = 0.30 + swell * 0.70;

  // High-band detail dimension: more highs => brighter, denser crisp sparkle.
  shimGain   = shimmer * 0.85;
  shimThresh = 0.94 - shimmer * 0.50;

  // Calm base floor — gentle, breathes a touch with the slow shimmer so even
  // in silence the rig is alive (never fully black).
  floorV = base * (0.55 + 0.45 * wave(slowShim));
}

export function render3D(index, x, y, z) {
  // Vertical aurora curtains: ribbons live along X, undulate along Y, drift in t.
  var nx = clamp01(x);
  var ny = clamp01(y);

  // Layered sines in x give the curtain structure; the y term makes ribbons
  // undulate so they read as flowing sheets rather than static bars. The two
  // ribbon frequencies are incommensurate (SQRT2 vs PHI) so the curtain never
  // exactly repeats.
  var ribbon = wave(nx * ribCount * SQRT2 - drift + ny * 0.22);
  var weave  = wave(nx * ribCount * PHI * 0.5 + drift * 0.6 - ny * 0.35 + undulate);
  var curtain = ribbon * 0.72 + weave * 0.28;

  // Soft falloff: low `soft` => sharp luminous cores; high `soft` => wide glow.
  // sharpen exponent runs ~5 (crisp) .. ~1.3 (soft).
  var sharp = 5.0 - soft * 3.7;
  var lum = pow(curtain, sharp);

  // The breath shapes the EXTENT: at low swell only the brightest crests live;
  // as swell rises the threshold drops so ribbons bloom wider across the rig.
  var thresh = 1.0 - extent;          // high swell -> low threshold -> wide
  var shaped = (lum - thresh) / (1.0 - thresh + 0.0001);
  shaped = clamp01(shaped);

  // Brightness: shaped curtains gained hard by the breath, over the calm floor.
  // Gain pushes the musical peak past 200 on the dominant channel.
  var gain = 0.85 + swell * 0.75;     // breath also lifts overall brightness
  var bri = shaped * gain;

  // ── High-band SHIMMER (a SECOND dimension: fine crisp detail) ──────────────
  // Deterministic per-pixel sparkle that rides ONLY on the lit crests, churned
  // fast by shimT and seeded by the golden angle so it never tiles. It adds
  // glitter on top of the breath without inflating the bulk brightness floor.
  var glint = 0.0;
  if (shaped > 0.04 && shimGain > 0.0) {
    var seed = index * 12.9898 + floor(shimT * 240.0) * GA + z * 7.31;
    var spk = sin(seed) * sin(seed * 1.7 + 1.3) * sin(seed * 3.3 + 2.1);
    spk = spk * spk; spk = spk * spk;     // sharpen -> crisp glints
    if (spk > shimThresh) {
      var amt = (spk - shimThresh) / (1.0 - shimThresh + 0.0001);
      glint = clamp01(amt) * (0.45 + 0.85 * shimGain) * (0.4 + 0.6 * shaped);
    }
  }
  bri = bri + glint;

  if (bri < floorV) bri = floorV;     // calm time-based base so it always reads
  bri = clamp01(bri);

  // Colour spans cp1<->cp2 ACROSS HEIGHT: green near the horizon (ny=0) rising
  // into magenta/violet at the crown (ny=1), with a small drifting wobble so the
  // gradient breathes. This makes the two distinct hues structural (hueSpread).
  var tcol = clamp01(0.12 + 0.76 * ny + 0.10 * wave(nx * 0.6 + undulate * 0.5 - 0.25));
  var r = (pr1 + (pr2 - pr1) * tcol) * bri;
  var g = (pg1 + (pg2 - pg1) * tcol) * bri;
  var b = (pb1 + (pb2 - pb1) * tcol) * bri;

  // Crisp white lift on the W channel for the sparkle only — keeps glints punchy
  // and helps the musical peak read past 200 without washing the colour.
  var ww = glint * 0.85;

  rgbwau(clamp01(r), clamp01(g), clamp01(b), clamp01(ww), 0.0, 0.0);
}
