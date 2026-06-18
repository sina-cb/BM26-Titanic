/*
  100_logsville_root_to_canopy_pulse
  Literal root-to-canopy sweep — a pulse rises through the grove from base
  to top via fixture-class sequencing (walls -> towers -> redwoods), the
  most unambiguous reading of "root to canopy" on a rig whose redwoods sit
  at flat world y=3. Walls/floor light first (roots), then tower bars
  (trunks), then redwoods at the top (canopy). Each cascade phase smoothly
  crossfades into the next. Within the canopy phase, Redwoods1 fires before
  Redwoods2 before Redwoods3 — a left-to-right wave through the trees.
  Math: cycle phase p(t) in [0,1] over ~6 s base. Per-class triangle
  envelopes overlap at the boundaries. Color lerps cool->warm as p climbs.
  Audio: sliderAudioBass swells pulse intensity, sliderAudioKick triggers a
  fresh root-to-canopy sweep, sliderAudioMid lifts midground (tower) accent.
  Sliders default to 0 — visible motion comes from localSpeed (codex P0).
  View masks consumed (named, registered in summer_camp_logsville.viewmasks.js):
    RedwoodPARs  (0x40) — canopy phase + UV crown
    VintageOnly  (0x80) — root phase amber lift (walls + tower lanterns)
  Fixture-class sequencing uses index ranges (no Tower/Wall mask registered).
*/

// Named view-mask bits (mirrors summer_camp_logsville.viewmasks.js).
var MASK_REDWOOD_PARS = 64;
var MASK_VINTAGE_ONLY = 128;

// Index ranges for unregistered fixture groups (must use ranges, not bits).
var TOWER_BAR_HI    = 143;   // 0..143
var TOWER_VINT_LO   = 144;   // 144..167 (also VintageOnly)
var WALL_VINT_LO    = 168;   // 168..203 (also VintageOnly)
var REDWOODS1_LO    = 204;   // 204..209
var REDWOODS2_LO    = 210;   // 210..215
var REDWOODS3_LO    = 216;   // 216..221

// Strobe-safety cap — kick-triggered sweep can't restart faster than 3 Hz.
var SWEEP_RESET_MIN_S = 0.34;

export var localSpeed = 0.5;
export var cycleSpeed = 0.5;        // 0.5 ~ ~6 s cycle
export var pulseIntensity = 0.85;
export var canopyApexBoost = 0.6;
export var blackoutDepth = 0.30;    // Rule 4: bright by default
export var uvIntensity = 0.7;

// Audio sliders (default 0 = no audio). CPC modulations bind these live.
export var audioBass = 0.0;
export var audioKick = 0.0;
export var audioMid = 0.0;

// cp1 = cool root (deep blue), cp2 = warm canopy (gold). Bright defaults.
export var cp1H = 0.62, cp1S = 1.0, cp1V = 0.85;
export var cp2H = 0.12, cp2S = 1.0, cp2V = 1.0;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderCycleSpeed(v) { cycleSpeed = v; }
export function sliderPulseIntensity(v) { pulseIntensity = v; }
export function sliderCanopyApexBoost(v) { canopyApexBoost = v; }
export function sliderBlackoutDepth(v) { blackoutDepth = v; }
export function sliderUvIntensity(v) { uvIntensity = v; }
export function sliderAudioBass(v) { audioBass = v; }
export function sliderAudioKick(v) { audioKick = v; }
export function sliderAudioMid(v) { audioMid = v; }

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

// Smooth triangle envelope peaking at the centre of [lo, hi]. Smooth-stepped
// edges (cosine-shaped) so cascade phases crossfade without a visible knee.
function envelope(p, lo, hi) {
  if (p < lo || p > hi) return 0.0;
  // local name avoids `t` which is reserved in MarsinScript.
  var tEnv = (p - lo) / (hi - lo);
  // wave(tEnv/2) gives a half-cycle from 0->1->0 across tEnv in [0,1].
  return wave(tEnv * 0.5 - 0.25) * 0.5 + 0.5;
}

// Per-redwood-group ordering: 0 -> 1 -> 2 within the canopy phase.
// Returns 0..1 offset within the canopy stage.
function redwoodGroupOffset(idx) {
  if (idx >= REDWOODS3_LO) return 0.66;
  if (idx >= REDWOODS2_LO) return 0.33;
  return 0.0; // Redwoods1
}

var cyclePhase = 0.0;
var prevKick = 0.0;
var resetTimer = 0.0;
export function beforeRender(delta) {
  var localMult = pow(2.0, (localSpeed - 0.5) * 5.4);
  var dt = delta / 1000.0;
  // Base period: cycleSpeed 0.5 -> ~6 s/cycle (per L15 spec).
  var rate = (1.0 / 6.0) * pow(2.0, (cycleSpeed - 0.5) * 2.0) * localMult;
  cyclePhase = (cyclePhase + dt * rate) % 1.0;
  if (cyclePhase < 0.0) cyclePhase += 1.0;
  // Kick-triggered sweep: rising edge on audioKick resets the cycle so the
  // root-to-canopy pulse restarts on the beat. Min interval enforced
  // (strobe-safe: hard cap of one restart per SWEEP_RESET_MIN_S = ~3 Hz max).
  if (resetTimer > 0.0) {
    resetTimer = resetTimer - dt;
    if (resetTimer < 0.0) resetTimer = 0.0;
  }
  var k = clamp01(audioKick);
  if (k > 0.6 && prevKick <= 0.6 && resetTimer <= 0.0) {
    cyclePhase = 0.0;
    resetTimer = SWEEP_RESET_MIN_S;
  }
  prevKick = k;
  _hsv2rgb1();
  _hsv2rgb2();
}

// Engine convention: `x, y, z` are the pixel's *normalized* coords (nx, ny, nz
// from the model) in [0,1] — NOT world meters. Redwoods/towers share a
// constant ny ~0.777, so the sequencing here is based on fixture class
// (index range), NOT world y (Rule 1 / L15 spec).
export function render3D(index, x, y, z) {
  var isVintage = (viewMask & MASK_VINTAGE_ONLY) != 0;
  var isRedwood = (viewMask & MASK_REDWOOD_PARS) != 0;
  var isWallVint = (index >= WALL_VINT_LO && index < REDWOODS1_LO);
  var isTowerVint = (index >= TOWER_VINT_LO && index < WALL_VINT_LO);
  var isTowerBar = (index <= TOWER_BAR_HI);

  var p = cyclePhase;
  // Three overlapping windows: roots [0.00..0.40], trunks [0.25..0.70],
  // canopy [0.55..1.00]. Crossfades at the boundaries (per L15 spec).
  var rootEnv   = envelope(p, 0.00, 0.40);
  var trunkEnv  = envelope(p, 0.25, 0.70);
  var canopyEnv = envelope(p, 0.55, 1.00);

  // Audio bindings (Rule 6).
  var bassBoost = 1.0 + clamp01(audioBass) * 0.5;  // pulse intensity
  var midAccent = clamp01(audioMid);               // tower accent

  // Color climbs cool->warm with p (each cycle warms as it climbs).
  var tColor = p;
  var rMix = pr1 + (pr2 - pr1) * tColor;
  var gMix = pg1 + (pg2 - pg1) * tColor;
  var bMix = pb1 + (pb2 - pb1) * tColor;

  // Brightness floor so the rig never fully blacks out (Rule 4).
  var floor_ = 1.0 - clamp01(blackoutDepth);
  // Floor is small and decorative — irrational-ratio shimmer so the off
  // tiers aren't dead between cascade peaks (Rule 8: complex motion).
  var shim = wave(p * 1.414 + index * 0.0411) * 0.08;

  // Horizontal ripple riding inside each cascade stage — gives the bare
  // "root-to-canopy" sweep extra spatial detail without distorting the
  // overall vertical reading. Two phase-offset wavefronts on nx + nz at
  // an irrational ratio so the texture never visibly tiles. Multiplies
  // each stage envelope before it reaches its branch — branches stay
  // responsible for color/audio.
  var ripple = 0.78 + 0.22 * wave(x * 1.7 + z * 1.1 + p * 2.718);
  var crossfront = 0.85 + 0.15 * wave(x * 0.9 - z * 0.6 + p * 1.618 + index * 0.013);
  var detail = ripple * crossfront;
  rootEnv = rootEnv * detail;
  trunkEnv = trunkEnv * detail;
  canopyEnv = canopyEnv * detail;

  var r = 0.0, g = 0.0, b = 0.0, w = 0.0, a = 0.0, u = 0.0;

  if (isRedwood) {
    // Canopy phase + per-group offset (Redwoods1 -> 2 -> 3 wave-through).
    // Each group fires at a fractional sub-window inside the canopy stage.
    var gOff = redwoodGroupOffset(index);
    // Local stage progress shifted by group: peak migrates left-to-right.
    var pStage = p - 0.55 - gOff * 0.10;  // sub-stage progress 0..~0.45
    var perGroup = 1.0;
    if (pStage < 0.0) {
      perGroup = max(0.0, 1.0 + pStage * 3.0);  // soft attack
    } else if (pStage > 0.30) {
      perGroup = max(0.0, 1.0 - (pStage - 0.30) * 5.0);  // soft decay
    }
    var redBright = canopyEnv * perGroup * pulseIntensity * bassBoost;
    // Bias toward cp2 (warm gold) — Hue hook: vocals would push this via CPC.
    var canopyMix = 0.7;
    var cr = pr1 + (pr2 - pr1) * canopyMix;
    var cg = pg1 + (pg2 - pg1) * canopyMix;
    var cb = pb1 + (pb2 - pb1) * canopyMix;
    r = cr * redBright;
    g = cg * redBright;
    b = cb * redBright;
    // Apex accent at the peak of the canopy phase — fires brightest on
    // Redwoods2 (centre/back trees) for a "tree-tops" feel.
    var apexT = canopyEnv * pulseIntensity;
    if (index >= REDWOODS2_LO && index < REDWOODS3_LO) {
      w = canopyApexBoost * apexT * 0.8;
    } else {
      w = canopyApexBoost * apexT * 0.4;
    }
    // UV strictly gated inside redwood branch (Rule 3).
    u = uvIntensity * canopyEnv * (0.55 + 0.45 * wave(p * 1.618 + z * 0.4));
    // Off-stage floor so the canopy isn't fully dark while roots/trunks lead.
    var floorBright = floor_ * 0.10 * (1.0 + shim);
    r = max(r, cr * floorBright);
    g = max(g, cg * floorBright);
    b = max(b, cb * floorBright);
  } else if (isWallVint) {
    // ROOTS — wall vintage carries the root phase. Bright amber lift on
    // the rising edge; cp1 cool tint at the back of the cycle.
    var rootBright = rootEnv * pulseIntensity * bassBoost;
    a = rootBright * 0.95;
    // Bias toward cp1 (cool root) so palette read holds.
    var rootMix = 0.15;
    r = (pr1 + (pr2 - pr1) * rootMix) * rootBright * 0.6;
    g = (pg1 + (pg2 - pg1) * rootMix) * rootBright * 0.6;
    b = (pb1 + (pb2 - pb1) * rootMix) * rootBright * 0.6;
    // Off-phase floor amber so walls aren't dark during canopy stage.
    a = max(a, floor_ * 0.20 * (0.9 + shim));
    // Steamboat-white on the rising root peak — gated to wall-vintage by
    // branch, gated to crest by pow(rootEnv, 3). Sparing per pattern-00.
    var rootMotion = pow(rootEnv, 3.0) * bassBoost;
    w = rootMotion * 0.65;
    if (w > 1.0) w = 1.0;
  } else if (isTowerVint) {
    // TowerVintage also part of VintageOnly — sits between roots and trunks.
    // Lights with rootEnv tail + trunkEnv lead so towers feel "passed through".
    var towerVbright = (rootEnv * 0.6 + trunkEnv * 0.8) * pulseIntensity * bassBoost;
    a = towerVbright * 0.85;
    r = rMix * towerVbright * 0.4;
    g = gMix * towerVbright * 0.4;
    b = bMix * towerVbright * 0.4;
    a = max(a, floor_ * 0.18 * (0.9 + shim));
  } else if (isTowerBar) {
    // TRUNKS — tower bars carry the midground (trunk) phase. Audio mid
    // accent amplifies this stage (Rule 6 binding).
    var trunkBright = trunkEnv * pulseIntensity * bassBoost * (1.0 + midAccent * 0.6);
    r = rMix * trunkBright;
    g = gMix * trunkBright;
    b = bMix * trunkBright;
    // White accent on trunk peak — gives the towers a bright "trunk pulse".
    w = trunkEnv * trunkBright * 0.35;
    // Floor so towers aren't dark during root/canopy stages.
    var trunkFloor = floor_ * 0.12 * (1.0 + shim);
    r = max(r, rMix * trunkFloor);
    g = max(g, gMix * trunkFloor);
    b = max(b, bMix * trunkFloor);
  }
  // No UV, no W, no A outside the branches above — guards against the
  // historical stage-wide UV-leak bug (R7/R8).
  rgbwau(clamp01(r), clamp01(g), clamp01(b), clamp01(w), clamp01(a), clamp01(u));
}
