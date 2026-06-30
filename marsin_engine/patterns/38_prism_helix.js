/*
  38_prism_helix.js — Prism Helix Tunnel (high-def, audio-reactive)

  Amalgamates 04_beat_folded_helix (pseudo-3D atan2/radius helix tunnel),
  09_cyclone (rotating swirl) and 17_rolling_color_dunes (color rolling along
  depth). Multiple crisp, bright helical arms wind around a tunnel axis: per
  pixel we center the world (x,y), take atan2 for the swirl ANGLE and the
  radius for tunnel DEPTH, then fold angle*arms + depth*twist - spin into one
  helix phase. sin() of that phase makes alternating bright arms / dark gaps;
  raising it to a contrast power tightens the arms into bright prisms with
  true-black gaps. The result is a hypnotic, pseudo-3D rotating prism tunnel.

  HIGH-DEF: BASE_FLOOR ~ 0 in the gaps (contrast power crushes them to black),
  tight bright cores overdriven past 1.0 so a musical peak SNAPS the strand
  cores to full white (peakMaxChan -> 255). The dark tunnel negative space is
  preserved for contrast. A tiny time-based shimmer floor keeps the rig faintly
  alive when audio is silent (mission-critical visibility) — never fully dark.

  AUDIO COUPLING (two orthogonal dimensions):
    PRIMARY  — micLow drives a clean OVERALL-BRIGHTNESS gain (`level`) applied
               as a master multiplier on the WHOLE strand body. It does NOT
               wobble with the helix rotation, so total rig brightness tracks
               micLow cleanly (corr >= 0.5). The strand body (not just the
               sharp cores) carries this gain so the coupling is continuous,
               not gated by where an arm happens to be.
    SECONDARY — micHigh drives `shimmerAmt`: a fine, fast per-pixel prism
               SHIMMER / detail sparkle riding on top of the arms. This is a
               DIFFERENT dimension (high-frequency texture, not master level),
               so the two signals never collapse into one.

  AUDIO_MODULATION_V1:
    sliderLevel   <- micLow  range 0.30..1.00 curve linear   # PRIMARY brightness: bass drives whole-strand master gain
    sliderShimmer <- micHigh range 0.10..0.85 curve linear   # highs: fine fast prism sparkle / detail texture
  STATIC (operator handles, not audio-mapped): localSpeed, twist, contrast, arms, colorPalette1/2.

  CONTRAST/twist remain operator handles (static at rest, modulatable if a show
  wants kick-snap), but are NOT wired to a band that fights the level coupling.

  IRRATIONAL RATIOS (no integer periods — see core equation in header below):
    helixTurns = ang*arms + depth*(twist*0.1)*PHI - flyPhase*SQRT2 + spinPhase
    spin/fly rates use SQRT2 / SQRT3, shimmer grid uses the golden angle 0.381966
    so arms, twist and shimmer never phase-lock into a repeating period.

  CORE EQUATION:
    bri = clamp( ( pow(wave(helixTurns), contrast)*CORE_GAIN
                   + wave(helixTurns)^2 * BODY + shimmerAmt*sparkle ) * level )

  COORDINATE-DRIVEN & PORTABLE: drives purely off centered world (x,y) +
  sectionId for per-group weighting, so it works on test_bench and the real rig.
  test_bench: sId 1=Pars (X), 2=Vintage (Y), 3=Bars (X).

  CONTROLS (UI order = declaration order)
    - localSpeed : tunnel spin / fly-through rate (0 = frozen helix).
    - level      : overall brightness master  (PRIMARY ← micLow).
    - shimmer    : prism shimmer / detail amt (SECONDARY ← micHigh).
    - twist      : helical twist frequency along depth (the "screw" pitch).
    - contrast   : arm sharpen — high = tight bright arms, hard black gaps.
    - arms       : number of helical arms around the tunnel.
    - colorPalette1/2 : cp1 cyan -> cp2 hot red, blended along the arm/depth.
*/

// ── Exported controls (UI order = declaration order) ─────────────────────────
export var localSpeed = 0.5;   // tunnel spin / fly-through rate
export var level = 0.6;        // overall brightness master (PRIMARY ← micLow). 0.6 (near
                               //   mid): bright cores still snap to 255 at rest with good
                               //   dark-gap contrast, and the micLow corr is preserved.
export var shimmerAmt = 0.25;  // prism shimmer / detail amt (SECONDARY ← micHigh)
export var twist = 4.0;        // helical twist frequency along depth
export var contrast = 2.2;     // arm sharpen (tight bright arms, hard black gaps)
export var arms = 3.0;         // number of helical arms

export var cp1H = 0.5, cp1S = 1.0, cp1V = 1.0;  // palette 1 — cyan
export var cp2H = 0.0, cp2S = 1.0, cp2V = 1.0;  // palette 2 — hot red
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
// IDENTITY-SLIDER convention: store v directly, scale in render/beforeRender.
export function sliderLevel(v) { level = v; }       // micLow -> master brightness
export function sliderShimmer(v) { shimmerAmt = v; } // micHigh -> prism shimmer
export function sliderTwist(v) { twist = -8.0 + v * 32.0; }
export function sliderContrast(v) { contrast = 0.6 + v * 8.0; }
export function sliderArms(v) { arms = 1.0 + floor(v * 9.0); }

// ── Tunables ──────────────────────────────────────────────────────────────────
var SQRT2 = 1.41421356;   // irrational fly ratio
var SQRT3 = 1.73205081;   // irrational spin/shimmer ratio
var PHI = 1.61803399;     // golden ratio — twist scaling
var GANGLE = 0.38196601;  // golden angle (turns) — shimmer grid offset
var SPIN_RATE = 0.5;      // base tunnel spins/sec at localSpeed = 1.0
var FLY_RATE = 0.35;      // base depth fly-through turns/sec at localSpeed = 1.0
var BASE_FLOOR = 0.16;    // faint time-based glow so it's never fully dark
var CORE_GAIN = 1.9;      // overdrive on the sharp arm cores (peaks -> 255)
var BODY = 0.55;          // steady strand-body weight (carries the level gain)
var LEVEL_MIN = 0.14;     // master gain at micLow=0 (calm, non-black)
var LEVEL_SPAN = 0.96;    // master gain reach (LEVEL_MIN .. LEVEL_MIN+SPAN)
var CX = 0.45;            // tunnel axis center in world X (test_bench rig span)
var CY = 1.3;             // tunnel axis center in world Y

// ── Palette RGB cache (strict cp1<->cp2 blending; PATTERNS.md §7) ─────────────
var pr1 = 0, pg1 = 1, pb1 = 1;
var pr2 = 1, pg2 = 0, pb2 = 0;
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
var masterTime = 0.0;   // seconds since start
var spinPhase = 0.0;    // tunnel rotation (turns)
var flyPhase = 0.0;     // fly-through along depth (turns)
var shimmer = 0.0;      // base shimmer phase (turns)
var sparkTime = 0.0;    // fast prism-shimmer churn phase (turns)
var levelGain = 0.14;   // resolved master gain this frame (micLow -> brightness)

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  _hsv2rgb1();
  _hsv2rgb2();

  masterTime = masterTime + dt;
  var localMultiplier = pow(2.0, (localSpeed - 0.5) * 4.0);

  // Irrational spin/fly ratios so arms never phase-lock to a repeating period.
  spinPhase = spinPhase + dt * SPIN_RATE * SQRT3 * localMultiplier;
  spinPhase = spinPhase - floor(spinPhase);

  flyPhase = flyPhase + dt * FLY_RATE * SQRT2 * localMultiplier;
  flyPhase = flyPhase - floor(flyPhase);

  shimmer = shimmer + dt * 0.15;
  shimmer = shimmer - floor(shimmer);

  // Fast churn for the high-frequency prism shimmer (micHigh dimension).
  sparkTime = sparkTime + dt * (1.7 + localMultiplier * 1.3);
  sparkTime = sparkTime - floor(sparkTime);

  // PRIMARY coupling resolved ONCE per frame, independent of helix rotation:
  // the whole strand body is multiplied by this, so total brightness tracks
  // micLow (via sliderLevel) cleanly across the rig. A gentle expansion curve
  // (pow < 1) widens the response so the narrow live micLow band still swings
  // overall brightness hard, sharpening the corr.
  var lv = clamp01(level);
  lv = pow(lv, 1.6);                       // expand: low audio reads darker
  levelGain = LEVEL_MIN + lv * LEVEL_SPAN;
}

export function render3D(index, x, y, z) {
  // Center the world coords on the tunnel axis.
  var dx = x - CX;
  var dy = y - CY;

  // ANGLE (swirl) and DEPTH (radius) → pseudo-3D tunnel.
  var ang = atan2(dy, dx) / PI2;        // 0..1 turn around the axis
  var dist = hypot(dx, dy);
  if (dist < 0.02) dist = 0.02;
  var depth = 1.0 / dist;               // near axis = deep, far = shallow

  // Fold the helix (irrational depth/fly ratios — see header core equation).
  var helixTurns = ang * arms + depth * twist * 0.1 * PHI - flyPhase * SQRT2 + spinPhase;
  var field = wave(helixTurns);         // 0..1 turn → 0..1 brightness band

  // Sharp bright arm CORES, overdriven so a musical peak snaps them to white.
  var arm = pow(field, contrast) * CORE_GAIN;

  // Steady strand BODY: an un-crushed glow that follows the helix everywhere so
  // the PRIMARY level gain moves the whole strand body's brightness (clean
  // micLow -> overall-brightness coupling), not just the sharp cores.
  var body = field * field * BODY;

  var strand = arm;
  if (body > strand) strand = body;

  // SECONDARY dimension — micHigh prism shimmer: a fine, fast per-pixel sparkle
  // riding ON the strand (detail/texture), distinct from the master level.
  var seed = index * 12.9898 + floor((sparkTime + ang) * 96.0) * GANGLE + z * 7.31;
  var spk = sin(seed) * sin(seed * 1.7 + 1.3) * sin(seed * 3.3 + 2.1);
  spk = spk * spk;                      // 0..1, biased low
  var sparkle = spk * spk;              // sharpen → crisp prism glints
  var shim = shimmerAmt * sparkle * (0.4 + 0.6 * field); // brightest on the arms
  strand = strand + shim;

  // PRIMARY: clean master gain on the WHOLE strand body (no rotation wobble).
  strand = strand * levelGain;

  // Faint time-based shimmer floor so it's never fully dark when silent. Mostly
  // scaled BY levelGain (so it does not add level-independent brightness that
  // dilutes the micLow correlation), plus a tiny absolute term for silence
  // safety (mission-critical: never fully black).
  var floorWave = 0.5 + 0.5 * wave(shimmer + depth * 0.05 + ang);
  var floorShim = BASE_FLOOR * floorWave * (0.18 + 0.82 * levelGain);

  var bri = strand;
  if (floorShim > bri) bri = floorShim;

  // Per-section weighting so the whole rig reads sensibly.
  var secW = 1.0;
  if (sectionId == 1) secW = 0.95;        // pars — bold body
  else if (sectionId == 2) secW = 1.0;    // vintage — brightest cores
  else if (sectionId == 3) secW = 0.92;   // bars — fine helix detail

  bri = bri * secW;

  // Color blends cp1 -> cp2 along the arm/depth of the helix.
  var tcol = clamp01(wave(depth * 0.12 + helixTurns * 0.2));
  var r = (pr1 + (pr2 - pr1) * tcol) * bri;
  var g = (pg1 + (pg2 - pg1) * tcol) * bri;
  var b = (pb1 + (pb2 - pb1) * tcol) * bri;

  rgb(clamp01(r), clamp01(g), clamp01(b));
}
