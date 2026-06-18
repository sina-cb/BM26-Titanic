/*
  96_logsville_ember_storm
  High-intensity ember storm — companion to the calm 72_outpost_campfire.
  Gesture: embers swirl chaotically across the grove with peaks of brightness;
  whole-rig fire field at maximum. The vintage cluster carries a multi-octave
  irrational-ratio warm noise field (reds/oranges/yellows); redwoods get a
  per-group z-phased ember backdrop (UV + low warm pulse); bars/walls
  outside the registered masks get a rising heat-haze texture (gated by
  index range, since no Tower/Wall view-mask is registered).
  Math: three waves at irrational ratios (sqrt(2), pi*ish, golden) mixed +
  deterministic time-jittered sparkle kernel; flash rate ≤ 3 Hz.
  Audio: sliderAudioKick punches flash peaks, sliderAudioBass swells ember
  glow base, sliderAudioHigh lifts sparkle density. Sliders default to 0 —
  visible motion comes from localSpeed-driven accumulators (codex P0).
  View masks consumed (named, registered in summer_camp_logsville.viewmasks.js):
    VintageOnly  (0x80) — primary ember noise field + soft flashes
    RedwoodPARs  (0x40) — UV glow backdrop + per-group warm pulse
*/

// Named view-mask bits (mirrors summer_camp_logsville.viewmasks.js).
var MASK_REDWOOD_PARS = 64;
var MASK_VINTAGE_ONLY = 128;

// Index ranges for unregistered fixture groups (must use ranges, not bits).
var TOWER_BAR_HI    = 143;   // 0..143    = TowerBars
var TOWER_VINT_LO   = 144;   // 144..167  = TowerVintageLights (also VintageOnly)
var WALL_VINT_LO    = 168;   // 168..203  = WallVintageLights (also VintageOnly)
var REDWOODS1_LO    = 204;   // 204..209  = Redwoods1
var REDWOODS2_LO    = 210;   // 210..215  = Redwoods2
var REDWOODS3_LO    = 216;   // 216..221  = Redwoods3

// Engine-side hard cap on operator-tunable flash rate (Hz). Precedent: 48, 84.
var FLASH_RATE_MAX_HZ = 3.0;

export var localSpeed = 0.6;
export var emberSpeed = 0.7;
export var heatIntensity = 0.85;
export var sparkleDensity = 0.4;
// Slider scales 0..1 -> 0..FLASH_RATE_MAX_HZ (3 Hz). Strobe-safe.
export var flashRate = 0.45;
export var uvIntensity = 0.7;

// Audio sliders (default 0 = no audio; CPC modulations bind them live).
export var audioBass = 0.0;
export var audioKick = 0.0;
export var audioHigh = 0.0;

// cp1 = red core, cp2 = amber/yellow tip. Bright defaults per Rule 4.
export var cp1H = 0.0,  cp1S = 1.0, cp1V = 1.0;
export var cp2H = 0.12, cp2S = 1.0, cp2V = 1.0;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderEmberSpeed(v) { emberSpeed = v; }
export function sliderHeatIntensity(v) { heatIntensity = v; }
export function sliderSparkleDensity(v) { sparkleDensity = v; }
export function sliderFlashRate(v) { flashRate = v; }
export function sliderUvIntensity(v) { uvIntensity = v; }
export function sliderAudioBass(v) { audioBass = v; }
export function sliderAudioKick(v) { audioKick = v; }
export function sliderAudioHigh(v) { audioHigh = v; }

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

// Per-redwood-group phase offsets — Rule 1: fake verticality with group ID,
// since redwood ny is constant ~0.777. nz varies (0.78/0.89/1.0) but group
// identity gives an unambiguous "ring" separation regardless of slider sweep.
function groupPhase(idx) {
  if (idx >= REDWOODS3_LO) return 0.66;
  if (idx >= REDWOODS2_LO) return 0.33;
  if (idx >= REDWOODS1_LO) return 0.0;
  return 0.0;
}

var tPhase = 0.0;
var flashPhase = 0.0;
var roarBreath = 1.0;
var kickPulse = 0.0;
export function beforeRender(delta) {
  var localMult = pow(2.0, (localSpeed - 0.5) * 5.4);
  var dt = delta / 1000.0;
  tPhase = (tPhase + (delta / 1310.72) * localMult) % 1.0;
  if (tPhase < 0.0) tPhase += 1.0;
  // Flash rate hard-capped at FLASH_RATE_MAX_HZ (Rule 5). Audio kick can lift
  // the *amplitude* of the bell, but never the rate — strobe-safe.
  var hz = clamp01(flashRate) * FLASH_RATE_MAX_HZ;
  flashPhase = (flashPhase + dt * hz) % 1.0;
  if (flashPhase < 0.0) flashPhase += 1.0;
  // Soft envelope (smooth bell) — peak ~0.6 from rate, kicks add up to +0.35.
  roarBreath = pow(wave(flashPhase), 2.0) * 0.6;
  // Audio kick adds a snappy envelope on top — bounded so total stays in [0,1].
  kickPulse = clamp01(audioKick) * 0.35;
  _hsv2rgb1();
  _hsv2rgb2();
}

// Multi-octave warm noise: three irrational ratios (sqrt(2)≈1.414, e≈2.718,
// pi≈3.141) so the field never visibly repeats — Rule 8.
function emberNoise(nx, nz, idx) {
  var s = emberSpeed;
  var a = wave(nz * 3.0   + tPhase * s * 4.0  + idx * 0.07);
  var b = wave(nx * 2.718 - tPhase * s * 5.41 + idx * 0.13);
  var c = wave((nx + nz) * 5.18 + tPhase * s * 7.31 + idx * 0.21);
  return clamp01(a * 0.55 + b * 0.30 + c * 0.30);
}

// Rising heat haze for bars/walls — slow vertical shimmer using nz (depth)
// plus a faster horizontal shimmer on nx. Decoupled from the vintage noise
// so the rig has spatial variety.
function heatHaze(nx, nz, idx) {
  var rise = wave(nz * 1.7 + tPhase * 3.3 + idx * 0.05);
  var shimmer = wave(nx * 4.1 - tPhase * 5.7 + idx * 0.11);
  return clamp01(rise * 0.6 + shimmer * 0.5);
}

// Engine convention: `x, y, z` are the pixel's *normalized* coords (nx, ny, nz
// from the model) in [0,1] — NOT world meters. ny is constant ~0.777 on
// redwoods/towers — never use it for vertical motion.
export function render3D(index, x, y, z) {
  var isVintage = (viewMask & MASK_VINTAGE_ONLY) != 0;
  var isRedwood = (viewMask & MASK_REDWOOD_PARS) != 0;
  var isTowerBar = (index <= TOWER_BAR_HI);
  var r = 0.0, g = 0.0, b = 0.0, w = 0.0, a = 0.0, u = 0.0;

  // Audio bass lifts the ember-glow base brightness (Rule 6 binding).
  var bassBoost = 1.0 + clamp01(audioBass) * 0.4;
  // Audio high lifts sparkle density (deterministic kernel, not random) so
  // hats sparkle without strobe-fizz.
  var sparkleScale = sparkleDensity * (1.0 + clamp01(audioHigh) * 1.5);

  if (isVintage) {
    var n = emberNoise(x, z, index);
    var heat = heatIntensity * bassBoost * (0.55 + roarBreath + kickPulse);
    // Palette gradient red->amber by noise height (Rule 7).
    var glow = n * heat;
    r = (pr1 + (pr2 - pr1) * n) * glow;
    g = (pg1 + (pg2 - pg1) * n) * glow;
    b = (pb1 + (pb2 - pb1) * n) * glow;
    // Amber channel always-on under noise — gives lamps their kiln body.
    a = glow * 0.9;
    // Steamboat-white on bright ember crests (gated to vintage by branch).
    // Pattern-00 idiom: w scales with motion intensity (noise * heat), so
    // it pops on roaring peaks and disappears on the quiet field. Soft
    // gate via pow(n,3) — no hard threshold means no visible knee.
    var motionIntensity = pow(n, 3.0) * heat;
    w = motionIntensity * 0.85;
    if (w > 1.0) w = 1.0;
    // Deterministic time-jittered sparkle (Rule 5 / pattern-84 precedent).
    var sparkSeed = (tPhase * 11.0 + index * 0.137) % 1.0;
    if (sparkSeed < 0.04 * sparkleScale) {
      w = max(w, 0.95);
    }
  } else if (isRedwood) {
    // Per-group z phase — Redwoods1/2/3 fire at staggered offsets so the
    // grove reads as three trees breathing, not one wall.
    var gp = groupPhase(index);
    var bell = wave(tPhase * 0.8 + gp + z * 0.3);
    // Low warm pulse: cp1 (red) base tinted with cp2 (amber) on the crest.
    var warm = (0.25 + 0.45 * bell) * bassBoost * heatIntensity;
    var mix = bell;
    r = (pr1 + (pr2 - pr1) * mix) * warm;
    g = (pg1 + (pg2 - pg1) * mix) * warm;
    b = (pb1 + (pb2 - pb1) * mix) * warm;
    // UV strictly gated inside the redwood branch (Rule 3). Group offsets
    // give a non-uniform "ember glow" backdrop.
    u = uvIntensity * (0.55 + 0.45 * wave(tPhase * 0.6 + gp + z * 0.4));
    // Per-tree flare on audio kick — amplitude only, no rate change.
    var flare = kickPulse * (0.5 + 0.5 * wave(tPhase * 2.0 + gp));
    w = max(w, flare * 0.8);
  } else if (isTowerBar) {
    // Towers (and any wall) — rising heat-haze texture in warm gradient.
    var h = heatHaze(x, z, index);
    var hot = h * heatIntensity * bassBoost * (0.45 + 0.4 * roarBreath + kickPulse * 0.6);
    r = (pr1 + (pr2 - pr1) * h) * hot;
    g = (pg1 + (pg2 - pg1) * h) * hot;
    b = (pb1 + (pb2 - pb1) * h) * hot;
    // Deterministic sparkle kernel — slow stride so towers feel like flying
    // sparks, not strobe.
    var towerSpark = (tPhase * 7.3 + index * 0.211) % 1.0;
    if (towerSpark < 0.03 * sparkleScale) {
      w = 0.7;
    }
  }
  // No UV, no W, no A outside the branches above — guards against the
  // historical stage-wide UV-leak bug (R7/R8).
  rgbwau(clamp01(r), clamp01(g), clamp01(b), clamp01(w), clamp01(a), clamp01(u));
}
