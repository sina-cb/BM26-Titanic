/*
  41_reaction_diffusion.js — GRAY-SCOTT reaction-diffusion on a feedback buffer.

  A living chemical skin for the whole rig. Two reagents (u = "substrate",
  v = "catalyst") share a feedback LANE of N=128 cells laid along the normalized
  X axis (0..1) — NOT one cell per physical pixel. Every physical pixel samples
  the catalyst lane cell for its OWN x, so the chemistry reads across the WHOLE
  rig on every model (test_bench 52, titanic 970, dome 266, logsville 216).

  RIG-AGNOSTIC: a coordinate lane (not a per-pixel buffer) is required because the
  VM caps an array at ~162 elements while rigs reach 970 px — so N is NEVER
  pixelCount (=144), NEVER a hardcoded 52, and never >162; every lane access is
  guarded 0..N-1. Each frame we run one Gray-Scott step over the lane in
  `beforeRender` (kept out of the per-pixel path, PATTERNS.md §10.5):

    DIFFUSE — every cell blends with its two index-neighbours using IRRATIONAL
              diffusion weights, so the reagents spread along the strands.
    REACT   — the classic Gray-Scott feed/kill nonlinearity
                  u' = u - u*v*v + feed*(1 - u)
                  v' = v + u*v*v - (feed + kill)*v
              breeds crawling spots / worms / stripes that NEVER repeat.

  Colour blends cp1<->cp2 by the catalyst concentration v: low v (quiet
  substrate) reads cp1 (deep teal water), high v (a live reaction front) snaps
  toward cp2 (hot coral), so the rig always shows BOTH colours at once and the
  two-colour gate is met with room to spare (cp1/cp2 ~0.55 apart on the wheel).

  FIXTURE COMPOSITION: bars carry the broad chemistry, raw strands trace its
  contours, Vintage fixtures catch sparse matched-W/A nuclei, pars hold a warm
  root pulse, and TE signs keep a stable substrate. Targeting uses portable
  FIX_* capability only; unknown fixture roles retain the generic chemistry.

  IRRATIONAL RATIOS (no integer periods) — equation in one line:
    diffusion weights wU = 1/SQRT2 = 0.70711 , wV = 1/SQRT3 = 0.57735 ;
    seed sites wander by the GOLDEN ANGLE  gp = wave(seedPhase*GOLD)  (GOLD=2.39996)
    with a PHI detune (PHI=1.61803) and a SQRT2 base advance — the reaction
    front locations never lock into a repeating grid.

  CONTROLS (declaration order = UI order)
    - localSpeed : reaction step rate (how fast the chemistry crawls).
    - level      : direct uniform final RGB/W/A gain. PRIMARY audio hook.
    - feed       : Gray-Scott feed rate — RESHAPES the pattern (spots<->stripes).
                   MODULATE micMid -> mids reshape the reaction (2nd dimension).
    - seed       : rising-edge catalyst trigger. Holding it high never repeats
                   injection; it must return below the hysteresis threshold.
    - base       : faint resting cp1 floor so still rig is never pure black.
    - colorPalette1/2 : cp1 deep teal (quiet substrate), cp2 hot coral (live
                   front). Reaction blends cp1<->cp2 by catalyst concentration.

  AUDIO (modulators-only — never read CPC audio globals natively):
  AUDIO_MODULATION_V1:
    sliderLevel <- micLow  range 0.30..1.00 curve linear   # PRIMARY brightness: bass lifts the teal floor + reaction-front gain
    sliderFeed  <- micMid  range 0.20..0.80 curve linear   # mids reshape the chemistry (spots <-> stripes geometry)
    sliderSeed  <- micKick range 0.00..1.00 curve linear   # kick: drops a fresh catalyst nucleus into the buffer
  STATIC (operator handles, not audio-mapped): localSpeed, base, colorPalette1/2.
*/

// ── Exported controls (UI order = declaration order) ────────────────────────
// Canonical append-only optional fixture roles; absent roles match no pixels.
var FIX_RAW_LED = 1;
var FIX_TE_SIGN = 7;

export var localSpeed = 0.5;   // reaction step rate
export var level = 0.5;        // overall brightness / gain (micLow — PRIMARY)
export var feed = 0.5;         // Gray-Scott feed rate — reshapes (micMid)
export var seed = 0.0;         // kick injection amount (micKick — discrete)
export var base = 0.06;        // faint resting cp1 floor (never fully black)

export var cp1H = 0.50, cp1S = 0.95, cp1V = 1.0; // deep teal  (quiet substrate)
export var cp2H = 0.04, cp2S = 1.00, cp2V = 1.0; // hot coral  (live reaction front)
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderLevel(v) { level = v; }   // micLow maps here (PRIMARY)
export function sliderFeed(v) { feed = v; }     // micMid maps here
var seedArmed = 1.0;
var seedPending = 0.0;
export function sliderSeed(v) {
  seed = v;
  // Hysteresis turns micKick into an event source. One threshold crossing makes
  // exactly one nucleus; the trigger must return low before it can fire again.
  if (v >= 0.18) {
    if (seedArmed > 0.5) {
      seedPending = v;
      seedArmed = 0.0;
    }
  } else if (v <= 0.08) {
    seedArmed = 1.0;
  }
}
export function sliderBase(v) { base = v; }     // faint resting cp1 floor

// ── Tunables ────────────────────────────────────────────────────────────────
// RIG-AGNOSTIC: the reaction runs on a fixed N=128-cell lane along the normalized
// X axis, sampled per-pixel by each pixel's x. NOT one cell per physical pixel
// (the VM caps an array at ~162 elements; rigs reach 970 px), NEVER pixelCount
// (=144), NEVER 52. 128 < the array cap so all four lane arrays are real, and a
// 128-cell lane gives plenty of reaction detail on every rig.
var N = 128;                // reaction-lane resolution along X (under the VM cap)
var BASE_FLOOR = 0.0;       // quiet substrate is (near) black
var PHI = 1.61803;          // golden ratio
var GOLD = 2.39996;         // golden angle (turns) — irrational seed wander
var SQRT2 = 1.41421;        // irrational base advance
var WU = 0.70711;           // 1/sqrt2 — substrate diffusion weight (irrational)
var WV = 0.57735;           // 1/sqrt3 — catalyst diffusion weight (irrational)
var KILL = 0.062;           // Gray-Scott kill rate (fixed; feed is the audio knob)
var STEP_RATE = 20.0;       // reaction sub-steps per second at localSpeed = 1.0 (crawls
                            //   visibly at rest so the chemistry reads ALIVE, not frozen)

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

// ── Persistent state ─────────────────────────────────────────────────────────
var bufU = array(128);      // substrate concentration (lane, under VM array cap)
var bufV = array(128);      // catalyst  concentration (the VISIBLE reagent)
var tmpU = array(128);      // scratch for one diffusion+react pass
var tmpV = array(128);
var bufInit = 0;
var seedPhase = 0.0;        // wandering seed-site phase (golden-angle advance)
var faintPhase = 0.0;       // slow phase for the silent-base shimmer
var stepClock = 0.0;        // accumulates time toward the next reaction sub-step
var feedExp = 2.0;          // resolved coral-front concentration exponent this frame (micMid -> geometry)
var seedFlash = 0.0;        // short visible life of the most recent edge event
var seedSite = 0;           // guarded lane cell hit by the most recent event

// Inject a small patch of catalyst (and deplete substrate) at a cell — this is
// how a kick "drops" a fresh reaction into the buffer. Soft 3-cell footprint so
// diffusion has a core to grow from.
function injectAt(center, amt) {
  if (center < 0) center = 0;
  if (center > N - 1) center = N - 1;           // hard lane guard
  bufV[center] = bufV[center] + amt;          if (bufV[center] > 1.0) bufV[center] = 1.0;
  bufU[center] = bufU[center] - amt * 0.5;    if (bufU[center] < 0.0) bufU[center] = 0.0;
  if (center > 0)     { bufV[center - 1] = bufV[center - 1] + amt * 0.5; if (bufV[center - 1] > 1.0) bufV[center - 1] = 1.0; }
  if (center < N - 1) { bufV[center + 1] = bufV[center + 1] + amt * 0.5; if (bufV[center + 1] > 1.0) bufV[center + 1] = 1.0; }
}

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  _hsv2rgb1();
  _hsv2rgb2();

  // ── First-frame seeding: substrate full, a few catalyst nuclei so the
  //    reaction has something to chew on (otherwise u=v=0 stays inert). Seeds
  //    spread across the WHOLE lane (= the whole rig in X). ──
  if (bufInit == 0) {
    for (var kk = 0; kk < N; kk++) { bufU[kk] = 1.0; bufV[kk] = 0.0; tmpU[kk] = 0.0; tmpV[kk] = 0.0; }
    injectAt(floor(N * 0.27), 0.7);
    injectAt(floor(N * 0.61), 0.7);
    injectAt(floor(N * 0.84), 0.7);
    bufInit = 1;
  }

  // localSpeed warps the chemistry crawl rate exponentially across 0..1
  // (2^((localSpeed-0.5)*4): 0.0625x at 0 .. 16x at 1) so the slider VISIBLY
  // changes how fast the reaction (and the living base shimmer) crawls; a small
  // floor keeps the rig always alive (never frozen, even at localSpeed=0).
  var localMult = 0.06 + pow(2.0, (localSpeed - 0.5) * 4.0);

  // Slow irrational wander of the seed sites + the silent-base shimmer. Both the
  // seed wander AND the resting shimmer track localSpeed so the rig's living
  // motion clearly speeds up/slows with the slider even with no audio.
  seedPhase = seedPhase + dt * 0.07 * localMult;
  seedPhase = seedPhase - floor(seedPhase);
  faintPhase = faintPhase + dt * 0.18 * localMult;
  faintPhase = faintPhase - floor(faintPhase);

  // micKick -> Seed is a rising-edge event, never continuous injection while
  // held. The event chooses an irrationally wandering site, mutates the real
  // reagent buffers once, and leaves a short nucleus flash at that exact cell.
  if (seedPending > 0.0) {
    var gp = wave(seedPhase * GOLD) * 0.6
           + wave(seedPhase * PHI * SQRT2 + 0.31) * 0.4;
    seedSite = floor(gp * (N - 1) + 0.5);
    injectAt(seedSite, 0.28 + seedPending * 0.62);
    seedFlash = 0.25 + seedPending * 0.75;
    seedPending = 0.0;
  }
  seedFlash = seedFlash - dt * 1.35;
  if (seedFlash < 0.0) seedFlash = 0.0;

  // ── Gray-Scott feed rate from `feed` (micMid). Mids push the chemistry
  //    between spot- and stripe-forming regimes -> the pattern RESHAPES, a
  //    different visual dimension from the brightness gain. ──
  var fr = 0.018 + clamp01(feed) * 0.044;     // ~0.018..0.062 feed regime

  // The Gray-Scott regime change is slow to read on a settled lane, so `feed`
  // (micMid) ALSO resolves a lag-free SHAPE term used in render: feedExp is the
  // exponent applied to catalyst concentration when shaping the front's
  // BRIGHTNESS profile (NOT its hue). Higher mids -> lower exponent -> the coral
  // fronts BROADEN / bloom (more lit front area); lower mids -> higher exponent
  // -> the fronts pull into tight crisp filaments. The hue mapping stays strong
  // and independent, so the two-colour split is preserved while the mids reshape
  // the front GEOMETRY the same frame — a distinct, lag-free visual dimension.
  feedExp = 1.7 - clamp01(feed) * 1.1;         // 1.7 (tight) .. 0.6 (broad)

  // ── Run reaction sub-steps. Each sub-step: diffuse (irrational weights) +
  //    react (feed/kill). Sub-step count scales with localSpeed so the crawl
  //    speed tracks the slider without exploding the per-frame work. ──
  stepClock = stepClock + dt * STEP_RATE * localMult;
  var steps = floor(stepClock);
  if (steps > 4) steps = 4;          // cap per-frame work (stability + budget)
  stepClock = stepClock - steps;
  if (stepClock > 2.0) stepClock = 2.0;

  for (var sStep = 0; sStep < steps; sStep++) {
    for (var kk = 0; kk < N; kk++) {
      var u = bufU[kk];
      var v = bufV[kk];
      // lane-neighbours (clamped at the lane ends)
      var ul = (kk > 0)     ? bufU[kk - 1] : u;
      var ur = (kk < N - 1) ? bufU[kk + 1] : u;
      var vl = (kk > 0)     ? bufV[kk - 1] : v;
      var vr = (kk < N - 1) ? bufV[kk + 1] : v;
      // Laplacian (1D, neighbour average minus centre), scaled by irrational
      // diffusion weights — u spreads faster than v (classic Gray-Scott split).
      var lapU = (ul + ur - 2.0 * u);
      var lapV = (vl + vr - 2.0 * v);
      var uvv = u * v * v;            // the autocatalytic reaction term
      var nu = u + (WU * 0.5 * lapU) - uvv + fr * (1.0 - u);
      var nv = v + (WV * 0.5 * lapV) + uvv - (fr + KILL) * v;
      // Clamp so the field can neither blow up nor die out of [0,1].
      if (nu < 0.0) nu = 0.0; if (nu > 1.0) nu = 1.0;
      if (nv < 0.0) nv = 0.0; if (nv > 1.0) nv = 1.0;
      tmpU[kk] = nu;
      tmpV[kk] = nv;
    }
    for (var kk = 0; kk < N; kk++) { bufU[kk] = tmpU[kk]; bufV[kk] = tmpV[kk]; }
  }
}

export function render3D(index, x, y, z) {
  var nx = clamp01(x);
  var ny = clamp01(y);
  var nz = clamp01(z);
  // Rig-agnostic chemistry: every fixture samples the same guarded X lane.
  var li = floor(nx * (N - 1) + 0.5);
  if (li < 0) li = 0;
  if (li > N - 1) li = N - 1;
  var conc = bufV[li];
  // Project the same living reagent lane through two additional XYZ axes. This
  // keeps the real Gray-Scott state while turning the former vertical bands
  // into a model-wide chemical skin with visible cells at playa distance.
  var liY = floor(clamp01(ny * 0.73 + nz * 0.27) * (N - 1) + 0.5);
  var liZ = floor(clamp01(nz * 0.61 + (1.0 - nx) * 0.39)
                * (N - 1) + 0.5);
  if (liY < 0) liY = 0;
  if (liY > N - 1) liY = N - 1;
  if (liZ < 0) liZ = 0;
  if (liZ > N - 1) liZ = N - 1;
  var fieldConc = max(conc, bufV[liY] * 0.82);
  fieldConc = max(fieldConc, bufV[liZ] * 0.68);
  var leftIndex = li - 1;
  var rightIndex = li + 1;
  if (leftIndex < 0) leftIndex = 0;
  if (rightIndex > N - 1) rightIndex = N - 1;
  var contour = abs(bufV[rightIndex] - bufV[leftIndex]);

  // Feed remains a chemistry/geometry control: it changes the actual equation
  // and this lag-free concentration exponent, never the final gain.
  var concShaped = pow(clamp01(fieldConc), feedExp);
  var shimmer = 0.24 + wave(faintPhase + x * 1.7 + y * 0.13) * 0.76;
  // A readable substrate keeps the complete ship visible even when the
  // chemistry enters a quiet regime; Base still owns its strength.
  var substrate = 0.040 + base * (0.55 + shimmer * 0.45);
  // Two counter-evolving observation planes expose the 1D reagent as smooth
  // cellular membranes across XYZ. The real concentration controls their
  // energy, so this remains chemistry—not a decorative background wave.
  var skinA = wave(nx * 1.73 + ny * 1.11 - nz * 0.67 + faintPhase);
  var skinB = wave(-nx * 0.91 + ny * 1.57 + nz * 1.23 - faintPhase);
  var chemicalSkin = pow(clamp01(1.0 - abs(skinA - skinB)), 3.1)
                   * (0.10 + concShaped * 0.90);
  var reaction = concShaped * 1.48 + chemicalSkin * 0.38;

  // The most recent edge-triggered seed remains visible at the same lane site
  // briefly, then decays. Holding Seed high cannot refresh this nucleus.
  var eventDistance = abs(li - seedSite) / (N - 1);
  var eventNucleus = clamp01(1.0 - eventDistance / 0.065) * seedFlash;

  var bri = substrate;
  var tcol = clamp01(fieldConc * 5.5);
  var matchedWhite = 0.0;
  var warmAdd = 0.0;

  if (fixtureType == FIX_BAR_18) {
    // Bars are the broad main chemical canvas.
    bri = substrate * 0.58 + reaction * 1.05 + eventNucleus * 0.34;
  } else if (fixtureType == FIX_RAW_LED) {
    // Strands trace chemical boundaries rather than duplicating the bar fill.
    var edge = clamp01(contour * 13.0 + concShaped * 0.13);
    bri = substrate * 0.46 + edge * 0.86 + eventNucleus * 0.44;
    tcol = clamp01(0.10 + edge * 0.90);
  } else if (fixtureType == FIX_VINTAGE_6) {
    // Sparse golden-white nuclei: deterministic per-pixel selection applied to
    // real catalyst concentration and the one-shot seed event.
    var nucleusSelect = pow(wave(index * 0.618034 + li * 0.071), 7.0);
    var nucleus = nucleusSelect * (concShaped * 0.66 + eventNucleus * 1.25);
    bri = substrate * 0.38 + reaction * 0.28 + nucleus * 0.48;
    matchedWhite = nucleus * 0.78;
    warmAdd = nucleus * 0.34;
    tcol = clamp01(conc * 3.2);
  } else if (fixtureType == FIX_PAR) {
    // Pars hold the warm root pulse beneath the faster chemistry.
    var rootPulse = concShaped
      * (0.32 + wave(faintPhase * 0.381966 + x * 0.31) * 0.68);
    bri = substrate * 0.52 + rootPulse * 0.72 + eventNucleus * 0.42;
    warmAdd = rootPulse * 0.31 + eventNucleus * 0.24;
    matchedWhite = rootPulse * 0.10 + eventNucleus * 0.16;
    tcol = clamp01(0.16 + conc * 3.4);
  } else if (fixtureType == FIX_TE_SIGN) {
    // Identity is readable petri glass sampling the REAL reagent lane through
    // an XYZ + letter-path coordinate. Catalyst nuclei and their concentration
    // gradients crawl and split in place; nothing translates the texture or
    // flat-breathes the whole sign.
    var signPath = pixelLocalIndex * 0.01351351351;
    var signCoord = clamp01(nx * 0.47 + ny * 0.23 + nz * 0.17
                          + signPath * 0.13);
    var signIndex = floor(signCoord * (N - 1) + 0.5);
    if (signIndex < 0) signIndex = 0;
    if (signIndex > N - 1) signIndex = N - 1;
    var signLeft = signIndex - 1;
    var signRight = signIndex + 1;
    if (signLeft < 0) signLeft = 0;
    if (signRight > N - 1) signRight = N - 1;
    var signConc = bufV[signIndex];
    var signGradient = abs(bufV[signRight] - bufV[signLeft]);
    // Three counter-evolving observation axes reveal the otherwise 1D reagent
    // as cellular 3D petri geometry. Their composite morphs instead of sliding
    // as one field; the real catalyst concentration biases where nuclei breed.
    var signChemA = wave((nx * 0.71 + ny * 1.37 - nz * 0.59) * 2.7
                       + signPath * 0.31 + faintPhase);
    var signChemB = wave((nx * 1.19 - ny * 0.47 + nz * 0.83) * 3.1
                       - signPath * 0.23 - faintPhase);
    var signChemC = wave((nx * 0.43 + ny * 0.89 + nz * 1.41) * 2.3
                       + signPath * 0.47 + faintPhase * 2.0);
    var signPotential = (signChemA + signChemB + signChemC) / 3.0;
    var signCellA = pow(clamp01(1.0 - abs(signChemA - signChemB)), 3.2);
    var signCellB = pow(clamp01(1.0 - abs(signChemB - signChemC)), 4.1);
    var signMembrane = signCellA * 0.58 + signCellB * 0.42;
    var signNucleus = pow(clamp01((signPotential + signConc * 0.24 - 0.52)
                                * 3.1), 1.35);
    var signFront = 1.0 - clamp01(abs(signPotential
                        - (0.48 + signConc * 0.10)) * 6.2);
    signFront = signFront * signFront;
    signNucleus = max(signNucleus,
      pow(clamp01(signConc * 4.8), 0.78) * 0.46);
    signFront = max(signFront,
      pow(clamp01(signGradient * 18.0), 0.72) * 0.42);
    bri = 0.46 + signMembrane * 0.36 + signNucleus * 0.42
        + signFront * 0.30
        + eventNucleus * 0.10;
    tcol = clamp01(0.04 + signMembrane * 0.34
                 + signNucleus * 0.52 + signFront * 0.24
                 + eventNucleus * 0.18);
  } else {
    // Portable fallback for a fixture role added after this pattern.
    bri = substrate * 0.58 + reaction * 0.82 + eventNucleus * 0.38;
  }

  bri = clamp01(bri);
  var r = (pr1 + (pr2 - pr1) * tcol) * bri;
  var g = (pg1 + (pg2 - pg1) * tcol) * bri;
  var b = (pb1 + (pb2 - pb1) * tcol) * bri;
  r += warmAdd;
  g += warmAdd * 0.43;
  b += warmAdd * 0.05;

  // Level is deliberately last and uniform across RGB and emitter lanes.
  var finalGain = clamp01(level);
  var w = clamp01(matchedWhite) * finalGain;
  rgbwau(clamp01(r) * finalGain, clamp01(g) * finalGain,
    clamp01(b) * finalGain, w, w, 0.0);
}
