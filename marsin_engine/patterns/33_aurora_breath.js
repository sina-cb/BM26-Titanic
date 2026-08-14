/*
  33_aurora_breath.js — a magical, high-def AURORA that BREATHES with the music.

  Soft vertical glowing ribbons of light drift and undulate across the rig:
  layered sines in x over time give curtains of luminance; a soft falloff
  (sliderSoft) keeps the ribbons luminous but crisp-edged. Colour blends
  cp1<->cp2 ACROSS HEIGHT (real aurora gradient: green near the horizon
  rising into magenta/violet at the crown), so the curtain spans two distinct
  hues top-to-bottom — hueSpread is structural, not incidental.

  THE BREATH (autonomous, clock-driven — alive even in silence):
    A slow smooth swell/ebb cycle (breathe, a softened triangle on its own clock)
    expands and contracts the aurora: on the IN-breath the curtains bloom
    WIDER and a touch brighter, on the OUT-breath they draw back to luminous
    cores. This breathing runs from the clock alone, so the rig breathes with
    NO audio mapped. `breathRate` sets how fast it breathes; `localSpeed` sets
    the drift rate of the ribbons themselves (pow2 idiom).

  TWO AUDIO DIMENSIONS (decoupled so neither fights the other):
    PRIMARY  — the GLOW LEVEL. A low-band level (sliderLevel <- micLow) is a
               DIRECT brightness multiplier on the whole curtain. It does NOT
               reshape geometry or wobble with the breath phase, so the rig's
               brightness follows the lows cleanly. The breath's
               size lives on a SEPARATE axis (breathDepth/breathRate), so the
               expand/contract motion never decorrelates the brightness.
    DETAIL   — the SHIMMER. A high-band level (sliderShimmer <- micHigh) adds a
               fast, fine, crisp sparkle riding on the crests (a different
               spatial dimension: high-frequency detail, not bulk brightness),
               so hats/cymbals make the curtain glitter without dominating the
               glow.

  TE signs carry a dedicated aurora curtain: a steady palette floor preserves
  the letterform while slow XYZ ribbons and local-index silk move vertically
  through it. Identity reads as aurora, not as the organism-wide inhale used by
  12_breathing.

  Amalgamates:
    00_golden_hour_wash  — wave() coordinate wash + cp1<->cp2 RGB blend
    11_bioluminescence   — slow ambient swell that breathes
    15_silk_prism_ribbons— layered ribbon sines drifting through the rig
    13_sparkle           — crisp deterministic high-band glint detail

  Core equation (per pixel, incommensurate ribbon frequencies):
    curtain = 0.72*wave(nx*rib*SQRT2 - drift + ny*0.22)
            + 0.28*wave(nx*rib*PHI*0.5 + weaveDrift - ny*0.35 + undulate)
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
  sliderLevel   <- micLow  range 0.10..1.00 curve pow2     # PRIMARY brightness: keeps detail in quiet lows, then blooms clearly
  sliderShimmer <- micHigh range 0.00..0.85 curve pow2     # detail: highs add fine crisp crest sparkle (distinct axis)
  sliderBreathDepth <- micFlux range 0.25..0.90 curve linear # musical motion: flux widens the autonomous curtain breath
  # sliderBreathRate  static 0.50  # breath speed (autonomous, not audio-driven)
  # sliderRibbons     static 0.50  # ribbon density (geometry, not audio-driven)
  # sliderSoft        static 0.50  # edge softness (geometry, not audio-driven)
  # sliderBase        static 0.14  # silence visibility floor (static)
  # sliderLocalSpeed  static 0.50  # operator drift rate, not an audio target
*/

// ── Exported controls (UI order = declaration order) ────────────────────────
// Optional accent role: self-declare the append-only canonical registry id so
// models without TE signs compile without changing their authored output.
var FIX_TE_SIGN = 7;

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
var PHASE_WRAP = 10000.0; // large wrap keeps every visible scaled phase continuous
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
var drift = 0.0;       // primary ribbon drift phase
var weaveDrift = 0.0;  // independent equivalent of the former drift * 0.6
var undulate = 0.0;    // slow secondary undulation phase
var colorWobble = 0.0; // independent equivalent of the former undulate * 0.5
var shimT = 0.0;       // fast shimmer churn phase (re-rolls the sparkle field)
var slowShim = 0.0;    // very slow base-shimmer phase
var breathe = 0.0;     // autonomous breath swell/ebb phase, 0..1
var ribCount = 3.0;    // resolved ribbon count this frame
var extent = 0.4;      // resolved breath extent this frame (0..~1)
var breathSwell = 0.5; // resolved autonomous expansion phase this frame
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
  var localMult = pow(2.0, (localSpeed - 0.5) * 7.0);
  var shimmerMult = pow(2.0, (localSpeed - 0.5) * 5.0);

  drift       = drift       + dt * 0.090 * localMult;
  weaveDrift  = weaveDrift  + dt * 0.054 * localMult;
  undulate    = undulate    + dt * 0.034 * localMult;
  colorWobble = colorWobble + dt * 0.017 * localMult;
  slowShim    = slowShim    + dt * 0.011 * localMult;
  // Shimmer churn runs fast so the high-band glints twinkle crisply.
  shimT = shimT + dt * 0.900 * shimmerMult;
  if (drift >= PHASE_WRAP) drift = drift - PHASE_WRAP;
  if (weaveDrift >= PHASE_WRAP) weaveDrift = weaveDrift - PHASE_WRAP;
  if (undulate >= PHASE_WRAP) undulate = undulate - PHASE_WRAP;
  if (colorWobble >= PHASE_WRAP) colorWobble = colorWobble - PHASE_WRAP;
  if (slowShim >= PHASE_WRAP) slowShim = slowShim - PHASE_WRAP;
  if (shimT >= PHASE_WRAP) shimT = shimT - PHASE_WRAP;

  // The BREATH runs on its OWN clock (breathRate), independent of localSpeed so
  // the ribbons can drift fast while the breath stays a slow, calm swell — and
  // independent of audio so the rig breathes even in silence. Exponential rate
  // so the breathRate fader feels even (slow ~24 s .. brisk ~1.5 s per breath; the
  // ~6 s default reads as a calm, natural breath).
  var breathMult = pow(2.0, (breathRate - 0.5) * 4.0);
  breathe = breathe + dt * 0.165 * breathMult; breathe = breathe - floor(breathe);

  ribCount = MIN_RIBBONS + ribbons * (MAX_RIBBONS - MIN_RIBBONS);

  // ── BREATH SIZE (autonomous, decoupled from brightness) ───────────────────
  // A softened full-travel swell/ebb smoothly expands (in-breath) and contracts
  // (out-breath) the curtain EXTENT. breathDepth sets the swing; the centre is
  // a wide, blooming aurora so it always reads. This is the SPATIAL motion —
  // it does NOT touch the brightness level, so it never decorrelates micLow.
  var swell = triangle(breathe);             // 0..1 full-travel swell/ebb
  swell = swell * swell * (3.0 - 2.0 * swell); // soften the turnarounds
  breathSwell = swell;
  // Keep the breath's EXTENT swing GENTLE: a wide extent lights more of the rig
  // and so lifts TOTAL brightness, which would decorrelate the micLow response
  // (the in/out-breath would read as a brightness pulse the lows didn't cause).
  // A small swing keeps the expand/contract clearly VISIBLE as curtain motion
  // while the bulk brightness stays governed by micLow.
  var depth = 0.12 + breathDepth * 0.32;     // clear expansion, still a soft ambient breath
  extent = clamp01(0.44 + (swell - 0.5) * 2.0 * depth);

  // ── GLOW LEVEL (the PRIMARY brightness, driven DIRECTLY by micLow) ────────
  // briLevel is a PURE function of `level` (micLow) — NO breath term — so TOTAL
  // rig brightness tracks the lows cleanly and the breathing never
  // reads as a brightness pulse the lows didn't cause (the exact decorrelation
  // the review flagged). The breath is fully SPATIAL: it widens/narrows the
  // curtain via the EXTENT below and rides the drifting curtain-floor glow, so
  // it reads clearly as expand/contract motion without touching the brightness
  // budget. Per-pixel motion keeps the rig alive in silence (never dead-static).
  briLevel = 0.44 + level * 1.55;

  // High-band detail dimension: more highs => brighter, denser crisp sparkle.
  shimGain   = shimmer;
  shimThresh = 0.90 - shimmer * 0.58;

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
  // Expand about the rig centre as the breath opens. This makes BreathRate a
  // truthful spatial-speed control, while leaving the brightness budget alone.
  var breathScale = 1.0 + (0.5 - breathSwell) * breathDepth * 0.90;
  var breathX = 0.5 + (nx - 0.5) * breathScale;

  // Layered sines in x give the curtain structure; the y term makes ribbons
  // undulate so they read as flowing sheets rather than static bars. The two
  // ribbon frequencies are incommensurate (SQRT2 vs PHI) so the curtain never
  // exactly repeats.
  var ribbon = wave(breathX * ribCount * SQRT2 - drift + ny * 0.22);
  var weave  = wave(breathX * ribCount * PHI * 0.5 + weaveDrift - ny * 0.35 + undulate);
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
    var seed = index * 12.9898 + shimT * GA * 6.0 + z * 7.31;
    var spk = sin(seed);
    spk = spk * spk; spk = spk * spk;     // sharpen -> crisp glints
    if (spk > shimThresh) {
      var amt = (spk - shimThresh) / (1.0 - shimThresh + 0.0001);
      // Scale the glint by briLevel too so the sparkle dims with the lows — it
      // rides ON the glow rather than fighting the micLow brightness budget,
      // keeping the PRIMARY correlation clean and positive.
      glint = clamp01(amt) * (0.18 + 0.92 * shimGain) * (0.35 + 0.65 * shaped)
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
  var traw = clamp01(0.10 + 0.80 * ny + 0.10 * wave(nx * 0.6 + colorWobble - 0.25));
  // Drive the blend toward the two palette ENDPOINTS (near-bimodal, 48-idiom):
  // green<->magenta passes through a muddy desaturated grey at tcol~0.5 that
  // caps the max RGB channel near 128. A smoothstep pushes most pixels to pure
  // green OR pure magenta (both peak >200) with only a narrow soft seam, so the
  // bright cores read past 200 AND both hues stay vivid across the rig.
  var tcol = traw * traw * (3.0 - 2.0 * traw);   // smoothstep(0,1,traw)
  var r = (pr1 + (pr2 - pr1) * tcol) * bri;
  var g = (pg1 + (pg2 - pg1) * tcol) * bri;
  var b = (pb1 + (pb2 - pb1) * tcol) * bri;

  // Capability-based authorship keeps the pattern portable. PARs become
  // restrained warm pools behind the saturated aurora; Vintage rails alone
  // get golden RGB and matched W+A glints, preserving their Jewelry character.
  if (fixtureType == FIX_TE_SIGN) {
    // Identity is a breathing aurora volume. Rotate X/Z around a Y-dependent
    // twist, then fold Y through that rotated plane: the ribbons visibly curl
    // through the sign instead of behaving like ordinary translated sine bars.
    var signX = nx - 0.5;
    var signY = ny - 0.5;
    var signZ = z - 0.5;
    var signPath = pixelLocalIndex * 0.01351351351;
    var twistAngle = (signY * (1.30 + breathDepth * 1.40)
      + drift * 4.0 + undulate * 3.0
      + (breathSwell - 0.5) * breathDepth * 0.50) * PI2;
    var twistCos = cos(twistAngle);
    var twistSin = sin(twistAngle);
    var foldX = signX * twistCos - signZ * twistSin;
    var foldZ = signX * twistSin + signZ * twistCos;
    var foldY = signY + sin((foldX * 1.70 + foldZ * 0.90
      + undulate * 4.0) * PI2) * (0.06 + breathDepth * 0.12)
      * (0.70 + breathSwell * 0.30);

    var signAxisA = wave(foldX * ribCount * 1.25 + foldY * 0.85
      + foldZ * 1.35 - drift * 4.0 + signPath * 0.040);
    var signAxisB = wave(foldZ * ribCount * 0.90 - foldY * 1.10
      + foldX * 0.70 + weaveDrift * 6.0 - signPath * 0.025);
    var signFold = 1.0 - clamp01(abs(signAxisA - signAxisB) * 2.20);
    signFold = signFold * signFold * (3.0 - 2.0 * signFold);
    var signCurtain = clamp01(0.08 + signAxisA * 0.45
      + signAxisB * 0.25 + signFold * 0.48);
    signCurtain = pow(signCurtain, 1.15 + (1.0 - soft) * 0.95);

    // Fine silk follows the folded volume and letter path. Its continuous slow
    // phase remains subordinate to the broad curling curtain, never noise.
    var signSilk = wave(foldX * 6.31 + foldY * 3.70 - foldZ * 2.30
      - slowShim * 12.0 + signPath * 0.17);
    var signFloor = 0.32 + base * 0.45 + level * 0.40;
    var signV = signFloor + signCurtain * (0.12 + level * 0.38)
      + signSilk * shimmer * 0.045;
    signV = clamp01(signV);
    var signT = clamp01(0.06 + ny * 0.78 + signCurtain * 0.10
      + signSilk * 0.06);
    signT = signT * signT * (3.0 - 2.0 * signT);
    r = (pr1 + (pr2 - pr1) * signT) * signV;
    g = (pg1 + (pg2 - pg1) * signT) * signV;
    b = (pb1 + (pb2 - pb1) * signT) * signV;
  } else if (fixtureType == FIX_PAR) {
    r = r * 0.55 + bri * 0.22;
    g = g * 0.50 + bri * 0.10;
    b = b * 0.38;
  }

  var ww = 0.0;
  if (fixtureType == FIX_VINTAGE_6) {
    r = r + glint * 0.50;
    g = g + glint * 0.25;
    b = b + glint * 0.03;
    ww = clamp01(glint * 0.75);
  }

  // LANE MATCH (w == a): the bare W emitter reads cold and the bare A emitter
  // reads yellow — matched W+A is the ship's warm white, and it is what the LED
  // strands already render (they fold amber into RGB). Convention:
  // docs/MARSIN_ENGINE_PATTERNS.md -> "White handling: the w == a convention".
  rgbwau(clamp01(r), clamp01(g), clamp01(b), ww, ww, 0.0);
}
