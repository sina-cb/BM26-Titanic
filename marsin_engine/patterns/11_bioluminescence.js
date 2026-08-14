/*
  11_bioluminescence.js — "Bioluminescence"

  A deep aquatic swell with branching phosphor filaments, ultraviolet undertow,
  and fast golden-white plankton on Vintage rails. Fixture capabilities keep the
  composition portable: Bars and Pars carry UV, strands carry saturated edges,
  and Vintage carries the matched-W+A plankton.

  Direction is fixed to the operator-approved 0.60 setting; it was not a useful
  live control. Detail now grows genuine multi-scale filament branches and micro
  nodes instead of merely changing one exponent. Kick launches an obvious
  whole-ship bioluminescent bloom, strongest in Organs and Jewelry. WhiteLevel is
  a true zero-to-full Vintage plankton amount, and WhiteSpeed independently trims
  only the plankton motion.

AUDIO_MODULATION_V1:
  sliderLevel     <- micLow  range 0.30..1.00 curve linear  # whole-look brightness
  sliderKick      <- micKick range 0.00..1.00 curve pow2    # bioluminescent bloom
  sliderRadius    <- micFlux range 0.40..0.90 curve linear  # crest spread
  sliderDetail    <- micHigh range 0.20..0.95 curve linear  # filament complexity
  sliderUvGlow    <- micHigh range 0.18..0.72 curve linear  # UV undertow
  # STATIC (omit from audio): localSpeed, density, whiteLevel, whiteSpeed, palettes
*/

// ── Exported controls (UI order = declaration order) ─────────────────────────
// Canonical append-only optional fixture roles; absent roles match no pixels.
var FIX_RAW_LED = 1;
var FIX_TE_SIGN = 7;

export var localSpeed = 0.5;   // master motion rate
export var level = 0.5;        // AUDIO: whole-look brightness
export var kick = 0.5;         // AUDIO: bioluminescent bloom
export var radius = 0.5;       // AUDIO: crest spread distance
export var detail = 0.5;       // AUDIO: filament complexity
export var density = 0.5;      // broad swell frequency
export var uvIntensity = 0.5;  // additive UV undertow
export var whiteLevel = 0.5;   // WHITE: Vintage plankton amount
export var whiteSpeed = 0.5;   // WHITE: independent plankton speed

export var cp1H = 0.6, cp1S = 1.0, cp1V = 1.0; // Ambient swell
export var cp2H = 0.3, cp2S = 1.0, cp2V = 1.0; // Crest pop
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderLevel(v) { level = v; }
export function sliderKick(v) { kick = v; }
export function sliderRadius(v) { radius = v; }
export function sliderDetail(v) { detail = v; }
export function sliderDensity(v) { density = v; }
export function sliderUvGlow(v) { uvIntensity = v; }
export function sliderWhiteLevel(v) { whiteLevel = v; }
export function sliderWhiteSpeed(v) { whiteSpeed = v; }

// ── Tunables ─────────────────────────────────────────────────────────────────
var MAX_RATE = 1.6;          // base drift turns/sec at localSpeed = 1.0 (restored to og time(0.08) cadence)
var PHASE_WRAP = 10000.0;    // large wrap; far from any in-frame scale (§7)
var BASE_FLOOR = 0.05;       // small non-black floor
var FIXED_DIRECTION_RATE = 0.20; // equivalent to approved direction 0.60

// ── Palette RGB cache (verbatim from 27_swipe) ───────────────────────────────
var pr1 = 1, pg1 = 0, pb1 = 0;
var pr2 = 0, pg2 = 0, pb2 = 1;
function _hsv2rgb1() {
  var hv = cp1H - floor(cp1H); if (hv < 0) hv += 1;
  var iv = floor(hv * 6) % 6;
  var fv = hv * 6 - floor(hv * 6);
  var pv = cp1V * (1 - cp1S);
  var qv = cp1V * (1 - fv * cp1S);
  var tv = cp1V * (1 - (1 - fv) * cp1S);
  if      (iv == 0) { pr1 = cp1V; pg1 = tv;    pb1 = pv;    }
  else if (iv == 1) { pr1 = qv;    pg1 = cp1V; pb1 = pv;    }
  else if (iv == 2) { pr1 = pv;    pg1 = cp1V; pb1 = tv;    }
  else if (iv == 3) { pr1 = pv;    pg1 = qv;    pb1 = cp1V; }
  else if (iv == 4) { pr1 = tv;    pg1 = pv;    pb1 = cp1V; }
  else             { pr1 = cp1V; pg1 = pv;    pb1 = qv;    }
}
function _hsv2rgb2() {
  var hv = cp2H - floor(cp2H); if (hv < 0) hv += 1;
  var iv = floor(hv * 6) % 6;
  var fv = hv * 6 - floor(hv * 6);
  var pv = cp2V * (1 - cp2S);
  var qv = cp2V * (1 - fv * cp2S);
  var tv = cp2V * (1 - (1 - fv) * cp2S);
  if      (iv == 0) { pr2 = cp2V; pg2 = tv;    pb2 = pv;    }
  else if (iv == 1) { pr2 = qv;    pg2 = cp2V; pb2 = pv;    }
  else if (iv == 2) { pr2 = pv;    pg2 = cp2V; pb2 = tv;    }
  else if (iv == 3) { pr2 = pv;    pg2 = qv;    pb2 = cp2V; }
  else if (iv == 4) { pr2 = tv;    pg2 = pv;    pb2 = cp2V; }
  else             { pr2 = cp2V; pg2 = pv;    pb2 = qv;    }
}

function clamp01(v) {
  if (v < 0.0) return 0.0;
  if (v > 1.0) return 1.0;
  return v;
}

// ── Persistent state ─────────────────────────────────────────────────────────
var driftA = 0.0;     // primary swell drift
var driftB = 0.0;     // secondary (incommensurate) drift
var driftUV = 0.0;    // UV undertow drift
var driftWhite = 0.0; // independent Vintage plankton drift
var localMul = 1.0;

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  // localSpeed: pow(2,(v-0.5)*4) gives 0.5=normal (factor 1.0), 1≈4x. A small
  // additive creep floor keeps v=0 CLEARLY slow-but-moving (not a near-freeze on
  // this dim pattern) while preserving factor 1.0 at the 0.5 default (0.06+0.94=1).
  localMul = 0.06 + 0.94 * pow(2.0, (localSpeed - 0.5) * 4.0);


  // Drift accumulators advance with localSpeed; √2 ratio = non-repeating.
  driftA = driftA + dt * localMul * MAX_RATE * FIXED_DIRECTION_RATE;
  driftB = driftB + dt * localMul * MAX_RATE * 1.41421 * FIXED_DIRECTION_RATE;
  driftUV = driftUV + dt * localMul * MAX_RATE * 0.9;
  var whiteMul = pow(2.0, (whiteSpeed - 0.5) * 4.0);
  driftWhite = driftWhite + dt * localMul * (0.12 + whiteMul * 0.65);
  if (driftA >= PHASE_WRAP) driftA = driftA - PHASE_WRAP;
  else if (driftA <= -PHASE_WRAP) driftA = driftA + PHASE_WRAP;
  if (driftB >= PHASE_WRAP) driftB = driftB - PHASE_WRAP;
  else if (driftB <= -PHASE_WRAP) driftB = driftB + PHASE_WRAP;
  if (driftUV >= PHASE_WRAP) driftUV = driftUV - PHASE_WRAP;
  if (driftWhite >= PHASE_WRAP) driftWhite = driftWhite - PHASE_WRAP;

  _hsv2rgb1();
  _hsv2rgb2();
}

export function render3D(index, x, y, z) {
  // Coords are already 0..1 — use directly (clamp only).
  var pct = clamp01(x);
  var pcy = clamp01(y);
  var pcz = clamp01(z);

  var dens = 1.0 + density * 5.0;
  var spread = 0.6 + radius * 1.6;   // AUDIO: crest spatial reach

  // Ambient swell (cp1 dominates) — incommensurate sample frequencies. The
  // temporal drift weight (0.55) is brisk enough that the swell visibly breathes
  // within a couple of seconds even with NO audio, so the silent wash always
  // animates (never reads static) while the spatial frequency keeps the HD relief.
  var swell = wave(driftA * 1.4 + pct * dens + pcy * 0.31);
  var swell2 = wave(driftB * 1.4 + pct * dens * 1.41421 + pcy * 0.17);
  var combined = swell * 0.62 + swell2 * 0.38;

  // Detail grows multi-scale branching phosphor instead of merely adjusting
  // one exponent: crossing filaments make veins, while micro nodes make sparks.
  var fineA = wave(pct * (4.0 + detail * 26.0)
                 + pcy * (3.0 + detail * 19.0)
                 + pcz * (5.0 + detail * 31.0) - driftB * 0.23);
  var fineB = wave((pct - pcy) * (7.0 + detail * 37.0)
                 + pcz * (6.0 + detail * 23.0) + driftA * 0.37);
  var filament = pow(fineA * fineB, 1.5 + detail * 5.0);
  var micro = wave(pct * (13.0 + detail * 41.0)
                 + pcy * (11.0 + detail * 29.0)
                 + pcz * (17.0 + detail * 43.0) + driftB * 0.61);
  micro = pow(micro, 8.0 + detail * 12.0);
  var fine = max(filament, micro * (0.30 + detail * 0.70));
  var zRidge = wave(pcz * (3.0 + detail * 57.0)
                  + pct * 0.70 - driftA * 0.15);
  zRidge = pow(zRidge, 5.0 + detail * 10.0);
  fine = max(fine, zRidge * detail);

  // Morph the dominant field itself: low Detail is broad liquid swell, while
  // high Detail replaces most of that body with branching filament structure.
  var morphology = combined * (1.0 - detail * 0.82)
                 + fine * detail * 0.95;
  var sharp = 2.0 + detail * 5.0;
  var blend = clamp01(pow(morphology, sharp) + fine * detail * 0.60);

  // Crest gate travels/spreads with radius (AUDIO movement RADIUS). A hard
  // (crestField > edge) ? 1 : 0 binary gate teleports the crest on in a single
  // frame (a real visual seam: px jumps ~140/255 between consecutive frames as
  // the rising swell crosses the edge). Replace with a STEEP smoothstep over a
  // narrow band so the crest still reads as a crisp bioluminescent pop (identity
  // preserved — same edge, same sharpness via pow below) but rises continuously
  // across the crossing instead of instantaneously.
  var crestField = wave(driftA * 1.4 * spread + pct * dens * spread + pcy * 0.23);
  var crestEdge = 0.84 - radius * 0.14;
  var crestBand = 0.04;                       // narrow -> still a crisp pop
  var crestU = (crestField - (crestEdge - crestBand)) / (crestBand * 2.0);
  crestU = clamp01(crestU);
  var crest = crestU * crestU * (3.0 - 2.0 * crestU); // smoothstep(edge-band, edge+band)
  crest = crest * pow(combined, 2.0);

  // Brightness: ambient breathes, crest pops; kick adds a pop. The ambient is
  // gently swelled by a slow, spatially-coherent "tide" on the always-forward UV
  // drift clock so the whole field visibly rises & ebbs even with NO audio — the
  // silent wash is never static. Low amplitude so it barely touches the
  // level-driven PRIMARY brightness budget.
  // NOTE: this VM treats the bare name `v` as a reserved global (HSV value), so
  // assigning to a local `v` silently desyncs from the arithmetic chain — the
  // brightness local is named `bval` here so the floor/level chain is honoured.
  var kickPop = clamp01(kick);
  var kickShape = kickPop * (2.0 - kickPop);
  var kickRole = 0.28;
  if (fixtureType == FIX_VINTAGE_6) kickRole = 1.0;
  else if (fixtureType == FIX_PAR) kickRole = 0.90;
  else if (fixtureType == FIX_BAR_18) kickRole = 0.58;
  else if (fixtureType == FIX_RAW_LED) kickRole = 0.48;
  else if (fixtureType == FIX_TE_SIGN) kickRole = 0.20;

  var bri = combined * (0.70 - detail * 0.28) + fine * detail * 0.72;
  var crestBri = crest * (0.60 + kickShape * 1.35);
  var bloom = kickShape * kickRole * (0.18 + crest * 0.82);
  var bval = max(bri, crestBri) + fine * detail * 0.18 + bloom;
  // Calm-but-lit visibility FLOOR (0.11 — every pixel clears black in silence,
  // mission critical, but low enough to keep the deep two-colour HD relief) and
  // the AUDIO PRIMARY level gain mapped onto a USEFUL span (calm-but-lit at
  // slider 0, full at 1, bright at the 0.5 centre).
  var levelGain = 0.30 + level * 0.70;
  bval = (0.11 + bval * 0.89) * levelGain;
  // Whole-rig "tide": a slow, spatially-coherent breath on the always-forward UV
  // drift clock so the field visibly swells & ebbs even with NO audio (never
  // static). Low amplitude so it barely touches the level-driven PRIMARY budget.
  bval = bval * (0.78 + 0.22 * wave(driftUV * 1.9 + 0.13));

  // Strict cp1->cp2 RGB lerp (crest pushes toward cp2).
  var tcol = clamp01(blend + crest * 0.5);
  var r = (pr1 + (pr2 - pr1) * tcol) * bval;
  var g = (pg1 + (pg2 - pg1) * tcol) * bval;
  var b = (pb1 + (pb2 - pb1) * tcol) * bval;

  if (fixtureType == FIX_TE_SIGN) {
    // Identity is a calm bioluminescent reef emblem. The firm palette floor
    // protects the letterform while one broad XYZ swell turns visibly through
    // the traced pixels. 1.36 * PHASE_WRAP is exactly 13600 cycles, so the
    // distant accumulator wrap remains seamless; localSpeed owns its cadence.
    var signReef = wave(pct * 0.71 + pcy * 1.31 - pcz * 0.59
                      + driftA * 1.36 + pixelLocalIndex * 0.008);
    var signBri = (0.38 + signReef * 0.14 + crest * 0.045
                 + kickShape * 0.035) * (0.80 + level * 0.20);
    var signMix = clamp01(0.12 + signReef * 0.60 + crest * 0.18);
    r = (pr1 + (pr2 - pr1) * signMix) * signBri;
    g = (pg1 + (pg2 - pg1) * signMix) * signBri;
    b = (pb1 + (pb2 - pb1) * signMix) * signBri;
  }

  // Additive UV undertow — the signature blacklight glow (kept on its own knob).
  var uvGlow = wave(driftUV * 1.4 - pct * 0.5 + pcy * 0.2);
  var uvCapable = (fixtureType == FIX_BAR_18) || (fixtureType == FIX_PAR);
  var outU = 0.0;
  if (uvCapable) {
    outU = (uvGlow * uvIntensity * 0.60
           + kickShape * (0.16 + crest * 0.44)) * levelGain;
  }

  // Honest Vintage-only white: Level controls amount from true zero; the
  // independent phase makes WhiteSpeed plainly visible; Kick blooms those sparks.
  var outW = 0.0;
  if (fixtureType == FIX_VINTAGE_6) {
    var whiteWave = wave(driftWhite + pixelLocalIndex * 0.137
                       + pct * 0.51 + pcy * 0.23);
    var whiteSpark = pow(whiteWave, 8.0);
    outW = clamp01(clamp01(whiteLevel) * levelGain
          * (0.05 + whiteSpark * 0.78 + fine * detail * 0.28)
          * (0.72 + kickShape * 1.85));
    r = r + outW * 0.18;
    g = g + outW * 0.08;
  }
  var outA = outW;

  // LANE MATCH (w == a): the bare W emitter reads cold and the bare A emitter
  // reads yellow — matched W+A is the ship's warm white, and it is what the LED
  // strands already render (they fold amber into RGB). Convention:
  // docs/MARSIN_ENGINE_PATTERNS.md -> "White handling: the w == a convention".
  rgbwau(clamp01(r), clamp01(g), clamp01(b), outW, clamp01(outA), clamp01(outU));
}
