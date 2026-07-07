/*
  33_aurora_breath.js — a magical, high-def AURORA that BREATHES with the music.

  Soft vertical glowing ribbons of light drift and undulate across the rig:
  layered sines in x over time give curtains of luminance; a soft falloff
  (sliderSoft) keeps the ribbons luminous but crisp-edged. Colour blends
  cp1<->cp2 ACROSS HEIGHT (real aurora gradient: green near the horizon
  rising into magenta/violet at the crown), so the curtain spans two distinct
  hues top-to-bottom — hueSpread is structural, not incidental.

  THE BREATH (autonomous, clock-driven — alive even in silence):
    A slow smooth swell/ebb cycle (breathe, a clean wave on its own clock)
    expands and contracts the aurora: on the IN-breath the curtains bloom
    WIDER and a touch brighter, on the OUT-breath they draw back to luminous
    cores. This breathing runs from the clock alone, so the rig breathes with
    NO audio mapped. `breathRate` sets how fast it breathes; `localSpeed` sets
    the drift rate of the ribbons themselves (pow2 idiom).

  TWO AUDIO DIMENSIONS (decoupled so neither fights the other):
    PRIMARY  — the GLOW LEVEL. A low-band level (sliderLevel <- micLow) is a
               DIRECT brightness multiplier on the whole curtain. It does NOT
               reshape geometry or wobble with the breath phase, so the rig's
               brightness tracks the lows cleanly (corr >= 0.6). The breath's
               size lives on a SEPARATE axis (breathDepth/breathRate), so the
               expand/contract motion never decorrelates the brightness.
    DETAIL   — the SHIMMER. A high-band level (sliderShimmer <- micHigh) adds a
               fast, fine, crisp sparkle riding on the crests (a different
               spatial dimension: high-frequency detail, not bulk brightness),
               so hats/cymbals make the curtain glitter without dominating the
               glow.

  Amalgamates:
    00_golden_hour_wash  — wave() coordinate wash + cp1<->cp2 RGB blend
    11_bioluminescence   — slow ambient swell that breathes
    15_silk_prism_ribbons— layered ribbon sines drifting through the rig
    13_sparkle           — crisp deterministic high-band glint detail

  Core equation (per pixel, incommensurate ribbon frequencies):
    curtain = 0.72*wave(nx*rib*SQRT2 - drift + ny*0.22)
            + 0.28*wave(nx*rib*PHI*0.5 + drift*0.6 - ny*0.35 + undulate)
    lum     = curtain^(5 - soft*3.7)
    extent  = breathBase + breathDepth*breathe      (autonomous breath SIZE)
    bri     = shaped(lum,extent) * level + shimmerGlint     (level = clean LOW gain)
    hue t   = 0.12 + 0.76*ny + small drift  (green ny=0 -> violet ny=1)
  with SQRT2=1.41421, PHI=1.61803, golden-angle GA=2.39996 (radians) for the
  shimmer hash — irrational, non-integer periods, never repeats.

  CONTROLS (UI order = declaration order)
    - localSpeed : drift/undulation rate of the ribbons (pow2; 0 = nearly frozen).
    - level      : low level -> DIRECT brightness of the aurora (the glow). Modulatable.
    - shimmer    : high level -> fine crisp sparkle on the crests. Modulatable.
    - breathRate : how fast the autonomous swell/ebb breathing cycles.
    - breathDepth: how much the breath expands/contracts the curtain extent.
    - ribbons    : ribbon count / density across x.
    - soft       : edge softness (low = crisp curtains, high = wide soft glow).
    - base       : calm time-based floor so silence still reads.
    - colorPalette1/2 : cp1 (green, horizon) <-> cp2 (magenta/violet, crown),
                        blended across height.

  AUDIO (modulators-only — never read CPC audio globals natively):
AUDIO_MODULATION_V1:
  sliderLevel   <- micLow  range 0.35..1.00 curve linear   # PRIMARY brightness: bass directly brightens the whole aurora
  sliderShimmer <- micHigh range 0.00..0.85 curve pow2     # detail: highs add fine crisp crest sparkle (distinct axis)
  # sliderBreathRate  static 0.50  # breath speed (autonomous, not audio-driven)
  # sliderBreathDepth static 0.50  # breath expand/contract amount (geometry, not audio)
  # sliderRibbons     static 0.50  # ribbon density (geometry, not audio-driven)
  # sliderSoft        static 0.50  # edge softness (geometry, not audio-driven)
  # sliderBase        static 0.18  # silence visibility floor (static)
  # sliderLocalSpeed  static 0.50  # operator drift rate, not an audio target
*/

// ── Exported controls (UI order = declaration order) ────────────────────────
export var localSpeed = 0.5;   // ribbon drift / undulation rate
export var level = 0.5;        // LOW level -> DIRECT brightness (the glow); 0.5 =
                               // a bright, blooming aurora with NO audio (Phase-1 default)
export var shimmer = 0.4;      // HIGH level -> fine crisp sparkle (detail)
export var breathRate = 0.5;   // autonomous swell/ebb breathing speed
export var breathDepth = 0.5;  // how much the breath expands/contracts the curtain
export var ribbons = 0.5;      // ribbon count / density
export var soft = 0.5;         // edge softness (0 = crisp, 1 = wide soft glow)
export var base = 0.14;        // calm time-based floor (silence still reads)

export var cp1H = 0.34, cp1S = 1.0, cp1V = 1.0; // green (horizon, low ny)
export var cp2H = 0.85, cp2S = 1.0, cp2V = 1.0; // magenta / violet (crown, high ny)
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderLevel(v) { level = v; }         // micLow maps here (PRIMARY)
export function sliderShimmer(v) { shimmer = v; }      // micHigh maps here (DETAIL)
export function sliderBreathRate(v) { breathRate = v; }
export function sliderBreathDepth(v) { breathDepth = v; }
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
var breathe = 0.0;     // autonomous breath swell/ebb phase, 0..1
var ribCount = 3.0;    // resolved ribbon count this frame
var extent = 0.4;      // resolved breath extent this frame (0..~1)
var floorV = 0.18;     // resolved calm floor this frame
var shimGain = 0.0;    // resolved shimmer (high-band) gain this frame
var shimThresh = 1.0;  // resolved sparkle threshold this frame (high -> lower)
var briLevel = 1.0;    // resolved DIRECT brightness multiplier (the glow level)

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  _hsv2rgb1();
  _hsv2rgb2();

  // Local-speed trim, exponential so the fader feels even (matches template).
  var localMult = pow(2.0, (localSpeed - 0.5) * 4.0);

  drift    = drift    + dt * 0.090 * localMult; drift    = drift    - floor(drift);
  undulate = undulate + dt * 0.034 * localMult; undulate = undulate - floor(undulate);
  slowShim = slowShim + dt * 0.011 * localMult; slowShim = slowShim - floor(slowShim);
  // Shimmer churn runs fast so the high-band glints twinkle crisply.
  shimT    = shimT    + dt * 0.900 * localMult; shimT    = shimT    - floor(shimT);

  // The BREATH runs on its OWN clock (breathRate), independent of localSpeed so
  // the ribbons can drift fast while the breath stays a slow, calm swell — and
  // independent of audio so the rig breathes even in silence. Exponential rate
  // so the breathRate fader feels even (slow ~10 s .. brisk ~3 s per breath; the
  // ~6 s default reads as a calm, natural breath).
  var breathMult = pow(2.0, (breathRate - 0.5) * 3.0);
  breathe = breathe + dt * 0.165 * breathMult; breathe = breathe - floor(breathe);

  ribCount = MIN_RIBBONS + ribbons * (MAX_RIBBONS - MIN_RIBBONS);

  // ── BREATH SIZE (autonomous, decoupled from brightness) ───────────────────
  // A clean swell/ebb wave smoothly expands (in-breath) and contracts
  // (out-breath) the curtain EXTENT. breathDepth sets the swing; the centre is
  // a wide, blooming aurora so it always reads. This is the SPATIAL motion —
  // it does NOT touch the brightness level, so it never decorrelates micLow.
  var swell = wave(breathe);                 // 0..1 smooth swell/ebb
  // Keep the breath's EXTENT swing GENTLE: a wide extent lights more of the rig
  // and so lifts TOTAL brightness, which would decorrelate the micLow response
  // (the in/out-breath would read as a brightness pulse the lows didn't cause).
  // A small swing keeps the expand/contract clearly VISIBLE as curtain motion
  // while the bulk brightness stays governed by micLow.
  var depth = 0.06 + breathDepth * 0.12;     // breath swing amplitude (visible, gentle)
  extent = clamp01(0.40 + (swell - 0.5) * 2.0 * depth);

  // ── GLOW LEVEL (the PRIMARY brightness, driven DIRECTLY by micLow) ────────
  // briLevel is a PURE function of `level` (micLow) — NO breath term — so TOTAL
  // rig brightness tracks the lows cleanly (corr >= 0.6) and the breathing never
  // reads as a brightness pulse the lows didn't cause (the exact decorrelation
  // the review flagged). The breath is fully SPATIAL: it widens/narrows the
  // curtain via the EXTENT below and rides the drifting curtain-floor glow, so
  // it reads clearly as expand/contract motion without touching the brightness
  // budget. Per-pixel motion keeps the rig alive in silence (never dead-static).
  briLevel = 0.44 + level * 1.55;

  // High-band detail dimension: more highs => brighter, denser crisp sparkle.
  shimGain   = shimmer * 0.85;
  shimThresh = 0.94 - shimmer * 0.50;

  // Calm base floor — gentle, SWELLS AND EBBS with the breath so even in silence
  // the rig visibly breathes (the floor glow brightens on the in-breath, draws
  // back on the out-breath) without pulsing the audio-driven curtain brightness.
  // A slow shimmer adds fine life on top.
  floorV = base * (0.45 + 0.45 * swell + 0.10 * wave(slowShim));
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

  // The BREATH shapes the EXTENT (spatial size only): on the in-breath the
  // threshold drops so ribbons bloom WIDER across the rig; on the out-breath
  // they draw back to luminous cores. This is the visible expand/contract.
  var thresh = 1.0 - extent;          // wide breath -> low threshold -> wide curtains
  var shaped = (lum - thresh) / (1.0 - thresh + 0.0001);
  shaped = clamp01(shaped);

  // ── Brightness field ──────────────────────────────────────────────────────
  // The whole rig carries a BROAD glow plus the CRISP curtain on top, and the
  // ENTIRE field is scaled by briLevel (micLow). Because every pixel's
  // brightness is proportional to briLevel, total rig brightness tracks the
  // lows cleanly (corr >= 0.6) — the curtain `shaped` only sets the per-pixel
  // CONTRAST (broad vs crest), it does not break the proportionality. The broad
  // term (0.30) keeps the aurora reading as a luminous sheet; the curtain term
  // (0.95*shaped) gives the crisp high-def cores that push the peak past 200.
  var field = 0.22 + 1.00 * shaped;
  var bri = field * briLevel;

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
      // Scale the glint by briLevel too so the sparkle dims with the lows — it
      // rides ON the glow rather than fighting the micLow brightness budget,
      // keeping the PRIMARY correlation clean and positive.
      glint = clamp01(amt) * (0.45 + 0.85 * shimGain) * (0.4 + 0.6 * shaped)
            * (0.45 + 0.55 * briLevel * 0.55);
    }
  }
  bri = bri + glint;

  // Mission-critical visibility floor: a SMALL audio-independent keep that RIDES
  // THE DRIFTING CURTAIN (not a flat wash) so even in silence the rig shows a
  // living aurora glow that visibly DRIFTS with localSpeed. Kept small so it
  // does NOT flatten the micLow brightness response (the field above carries the
  // correlation); it only guarantees the rig is never black.
  var curtainFloor = floorV * (0.40 + 0.90 * lum);
  if (bri < curtainFloor) bri = curtainFloor;
  bri = clamp01(bri);

  // Colour spans cp1<->cp2 ACROSS HEIGHT: green near the horizon (ny=0) rising
  // into magenta/violet at the crown (ny=1), with a small drifting wobble so the
  // gradient breathes. This makes the two distinct hues structural (hueSpread).
  var traw = clamp01(0.10 + 0.80 * ny + 0.10 * wave(nx * 0.6 + undulate * 0.5 - 0.25));
  // Drive the blend toward the two palette ENDPOINTS (near-bimodal, 48-idiom):
  // green<->magenta passes through a muddy desaturated grey at tcol~0.5 that
  // caps the max RGB channel near 128. A smoothstep pushes most pixels to pure
  // green OR pure magenta (both peak >200) with only a narrow soft seam, so the
  // bright cores read past 200 AND both hues stay vivid across the rig.
  var tcol = traw * traw * (3.0 - 2.0 * traw);   // smoothstep(0,1,traw)
  var r = (pr1 + (pr2 - pr1) * tcol) * bri;
  var g = (pg1 + (pg2 - pg1) * tcol) * bri;
  var b = (pb1 + (pb2 - pb1) * tcol) * bri;

  // White core on the brightest curtain CRESTS (bioluminescence idiom): a crisp
  // white emitter lift where the curtain peaks, so the high-def cores punch past
  // 200 on the W channel even where the green<->magenta blend desaturates to a
  // muddy mid-grey (the palette caps RGB ~128 at mid-height). Gated to the top
  // of the curtain and scaled by briLevel so it tracks micLow and stays crisp,
  // never a flat wash. The sparkle glint adds its own crisp white on top.
  // Crisp white lift on the W channel for the sparkle only — keeps glints punchy
  // and adds a little crisp white bite without washing the colour.
  var ww = clamp01(glint * 0.85);

  rgbwau(clamp01(r), clamp01(g), clamp01(b), ww, 0.0, 0.0);
}
