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

  HIGH-DEF + BRIGHT: reaction fronts are lifted hard so a musical peak burns a
  channel well past 200 (mission-critical visibility); the resting substrate is
  near-dark so fronts read as crisp coral filaments on near-black. A faint,
  slow time-based shimmer on cp1 keeps the rig calm-but-alive in silence (codex
  P0 — never fully black). The buffer is clamped every frame so the reaction can
  neither blow up nor die to all-black.

  IRRATIONAL RATIOS (no integer periods) — equation in one line:
    diffusion weights wU = 1/SQRT2 = 0.70711 , wV = 1/SQRT3 = 0.57735 ;
    seed sites wander by the GOLDEN ANGLE  gp = wave(seedPhase*GOLD)  (GOLD=2.39996)
    with a PHI detune (PHI=1.61803) and a SQRT2 base advance — the reaction
    front locations never lock into a repeating grid.

  CONTROLS (declaration order = UI order)
    - localSpeed : reaction step rate (how fast the chemistry crawls).
    - level      : overall output brightness / gain. PRIMARY audio hook —
                   MODULATE micLow -> bass lifts total brightness (corr>=0.5).
    - feed       : Gray-Scott feed rate — RESHAPES the pattern (spots<->stripes).
                   MODULATE micMid -> mids reshape the reaction (2nd dimension).
    - seed       : kick injection amount — a beat drops fresh catalyst into the
                   buffer. MODULATE micKick -> discrete seed events on the beat.
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
export function sliderSeed(v) { seed = v; }     // micKick maps here
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

  // ── micKick -> seed: a beat drops a fresh catalyst nucleus at a wandering
  //    site. Discrete event (the 2nd-but-distinct dimension): position chosen
  //    by golden-angle + phi detune so successive drops never tile. ──
  if (seed > 0.04) {
    var gp = wave(seedPhase * GOLD) * 0.6
           + wave(seedPhase * PHI * SQRT2 + 0.31) * 0.4;
    var site = floor(gp * (N - 1) + 0.5);
    injectAt(site, 0.35 + seed * 0.6);
  }

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
  // RIG-AGNOSTIC: sample the catalyst lane by this pixel's normalized X (0..1),
  // so the reaction reads across the WHOLE rig on every model (52/970/266/216 px).
  var li = floor(clamp01(x) * (N - 1) + 0.5);
  if (li < 0) li = 0;
  if (li > N - 1) li = N - 1;
  var conc = bufV[li];       // catalyst concentration at this pixel's X (guarded)

  // ── Faint resting cp1 wash so the still rig is never pure black (P0).
  //    Slow, per-pixel-phased shimmer so it reads "alive" not "stuck". The
  //    `level` (micLow) term lifts this teal floor the SAME frame the bass
  //    changes (lag-free) on EVERY pixel — this uniform component is what makes
  //    the rig's total brightness track micLow tightly (the PRIMARY corr). It
  //    rides strictly on cp1 so it does not pollute the reaction's coral hue. ──
  var faint = (base + level * 0.34) * (0.10 + 0.90 * wave(faintPhase + x * 1.7));

  // ── Reaction layer: catalyst concentration -> brightness, also gained by
  //    `level` so a live front during loud bass burns a channel hot (peak>200)
  //    and stays crisp on the dark substrate (high contrast / high def). The
  //    GEOMETRY of the front (how broad vs tight the lit coral band reads) is
  //    shaped by feedExp (micMid): pow(conc, feedExp) blooms the front at high
  //    mids and pinches it to a tight filament at low mids — a lag-free
  //    geometry dimension that does NOT recolour the rig. ──
  var concShaped = pow(clamp01(conc), feedExp);
  var reactBri = concShaped * (0.55 + level * 1.40);

  // Composite: brighter of faint-water vs reaction. Colour follows whichever
  // dominates — cp1 for the quiet substrate, cp1->cp2 by concentration for the
  // live front (snaps to coral for any meaningful reaction so fronts read hot).
  // The hue mapping rides RAW concentration (not the feed-shaped brightness), so
  // the strong two-colour split is independent of the mid-driven geometry.
  var tcol = 0.0;
  var bri = faint;
  if (reactBri > faint) {
    bri = reactBri;
    tcol = clamp01(conc * 6.0);            // any front edge -> coral fast (two-colour)
  }

  if (bri < BASE_FLOOR) bri = BASE_FLOOR;
  bri = clamp01(bri);

  var r = (pr1 + (pr2 - pr1) * tcol) * bri;
  var g = (pg1 + (pg2 - pg1) * tcol) * bri;
  var b = (pb1 + (pb2 - pb1) * tcol) * bri;

  rgb(clamp01(r), clamp01(g), clamp01(b));
}
