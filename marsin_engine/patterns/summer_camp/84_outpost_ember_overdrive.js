/*
  outpost_ember_overdrive
  High-intensity sibling of 72_outpost_campfire: the vintage outpost cluster
  roars like a kiln. A multi-octave warm noise field (reds/oranges/yellows)
  floods the lamps with soft-envelope brightness modulation — no hard strobe.
  An operator-tunable flash rate is clamped to ≤3 Hz (precedent: pattern 48).

  View masks consumed (named, registered in summer_camp_logsville.viewmasks.js):
    VintageOnly (0x80) — the outpost itself: noise field + soft flashes + W/A
    RedwoodPARs (0x40) — UV-only backdrop so the trees frame the kiln glow

  Note: there is no registered "tower" or "wall" mask in the Logsville sidecar,
  so the original tower-bar burst is intentionally dropped rather than gated on
  an unregistered bit. If a Towers mask is added later, route a dim ember tint
  there by name.
*/

// Named view-mask bits (mirrors summer_camp_logsville.viewmasks.js).
var MASK_REDWOOD_PARS = 64;
var MASK_VINTAGE_ONLY = 128;

// Engine-side hard cap on operator-tunable flash rate (Hz). Pattern 48 set
// this precedent after a strobe-safety pass.
var FLASH_RATE_MAX_HZ = 3.0;

export var localSpeed = 0.6;
export var emberSpeed = 0.6;
export var heatIntensity = 0.85;
export var sparkleDensity = 0.35;
// Default deliberately low; slider scales 0..1 -> 0..FLASH_RATE_MAX_HZ (3 Hz).
export var flashRate = 0.4;
export var uvIntensity = 0.6;

export var cp1H = 0.0,  cp1S = 1.0, cp1V = 1.0;  // red core
export var cp2H = 0.12, cp2S = 1.0, cp2V = 1.0;  // amber/yellow tip
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderEmberSpeed(v) { emberSpeed = v; }
export function sliderHeatIntensity(v) { heatIntensity = v; }
export function sliderSparkleDensity(v) { sparkleDensity = v; }
export function sliderFlashRate(v) { flashRate = v; }
export function sliderUvIntensity(v) { uvIntensity = v; }

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

var tPhase = 0.0;
var flashPhase = 0.0;
var roarBreath = 1.0;
// Per-octave time accumulators — each wraps01 independently so a tPhase
// roll-over never teleports all three octaves at the same instant
// (precedent: 05/10/18/20/23/24/44). Was the original "too basic" feel: a
// single tPhase scaled three ways = all octaves rolled together.
var tOctA = 0.0;
var tOctB = 0.0;
var tOctC = 0.0;
// Slow secondary breath under the fast flash — adds depth ("too basic" fix).
var emberDrift = 0.0;
// Pulse-ring center walks slowly through the cluster — gives the field a
// felt source ("the kiln has a hot spot"), not a uniform glow.
var ringCx = 0.5;
var ringCz = 0.5;
var ringPhase = 0.0;
// Smoothed roar for steamboat-white motion gate.
var motionIntensity = 0.0;
export function beforeRender(delta) {
  var localMult = pow(2.0, (localSpeed - 0.5) * 5.4);
  var dt = delta / 1000.0;
  var step = (delta / 1310.72) * localMult;
  tPhase = (tPhase + step) % 1.0;
  if (tPhase < 0.0) tPhase += 1.0;
  // Per-octave time bases — same effective rates as the prior tPhase*4/5.41/
  // 7.31 mix but each wraps01 independently.
  tOctA = (tOctA + step * emberSpeed * 4.0)  % 1.0; if (tOctA < 0.0) tOctA += 1.0;
  tOctB = (tOctB + step * emberSpeed * 5.41) % 1.0; if (tOctB < 0.0) tOctB += 1.0;
  tOctC = (tOctC + step * emberSpeed * 7.31) % 1.0; if (tOctC < 0.0) tOctC += 1.0;
  // Slow drifting hot-spot center walks a Lissajous so the kiln has a
  // felt source. Sub-Hz; no strobe risk.
  ringPhase = (ringPhase + step * 0.13) % 1.0;
  if (ringPhase < 0.0) ringPhase += 1.0;
  // Hot-spot walks [0.15, 0.85] in both axes — wave returns [0,1], so
  // 0.15 + 0.7 * wave(...) spans [0.15, 0.85]. Two waves at irrational ratio
  // give a Lissajous so the center never visibly cycles.
  ringCx = 0.15 + 0.7 * wave(ringPhase);
  ringCz = 0.15 + 0.7 * wave(ringPhase * 0.618 + 0.25);
  // Flash rate is clamped to FLASH_RATE_MAX_HZ regardless of slider abuse.
  var hz = clamp01(flashRate) * FLASH_RATE_MAX_HZ;
  flashPhase = (flashPhase + dt * hz) % 1.0;
  if (flashPhase < 0.0) flashPhase += 1.0;
  // Soft envelope (smooth bell, never a hard 1.0 step) — gives "roar"
  // brightness without a strobe edge. Peak ≈ 0.6, floor ≈ 0.0.
  roarBreath = pow(wave(flashPhase), 2.0) * 0.6;
  // Slower 0.3 Hz drift breath rides under the fast flash so the cluster
  // has a long-form inhale/exhale on top of the per-flash roar.
  emberDrift = 0.5 + 0.5 * wave(ringPhase * 2.3);
  // Smoothed motion meter for steamboat gate.
  var lp = 1.0 - exp(-dt * 6.0);
  var rawMotion = roarBreath * 1.4 + emberDrift * 0.3;
  if (rawMotion > 1.0) rawMotion = 1.0;
  motionIntensity = motionIntensity + (rawMotion - motionIntensity) * lp;
  _hsv2rgb1();
  _hsv2rgb2();
}

// Multi-octave warm noise: three irrational-ratio waves combined so the
// field never visibly repeats and reads as a rolling fire texture. Each
// octave has its own time base (tOctA/B/C) for seam-safe wrapping.
function emberNoise(nx, nz, idx) {
  var a = wave(nz * 3.0  + tOctA + idx * 0.07);
  var b = wave(nx * 2.7  - tOctB + idx * 0.13);
  var c = wave((nx + nz) * 5.18 + tOctC + idx * 0.21);
  // Weighted blend, biased to the lowest-frequency octave for body.
  return clamp01(a * 0.55 + b * 0.30 + c * 0.30);
}

// Raised-cosine pulse ring centered on (cx,cz). Returns [0,1], 1 at center,
// smoothly to 0 at radius `w`. Used for the slow-walking hot-spot bloom.
function spot(nx, nz, cx, cz, w) {
  var dx = nx - cx;
  var dz = nz - cz;
  var d = sqrt(dx * dx + dz * dz);
  if (d >= w) return 0.0;
  return 0.5 + 0.5 * cos((d / w) * PI);
}

// Engine convention: `x, y, z` are the pixel's *normalized* coords
// (nx, ny, nz from the model) in [0,1] — NOT world meters. ny is constant
// ~0.777 on this rig — never use it for vertical motion.
export function render3D(index, x, y, z) {
  var isVintage = (viewMask & MASK_VINTAGE_ONLY) != 0;
  var isRedwood = (viewMask & MASK_REDWOOD_PARS) != 0;
  var r = 0.0, g = 0.0, b = 0.0, w = 0.0, a = 0.0, u = 0.0;
  if (isVintage) {
    var n = emberNoise(x, z, index);
    // Drifting hot-spot bloom (raised-cosine ring, slow-walking center).
    // This is the depth fix for the "too basic" note — without it every
    // lamp got the same global heat envelope. Now there's a felt source
    // walking through the cluster.
    var hotSpot = spot(x, z, ringCx, ringCz, 0.45);
    // Soft global brightness envelope (≤3 Hz, smooth bell — never a strobe).
    // Plus a per-pixel hotspot boost on top so brightness varies spatially.
    var heat = heatIntensity * (0.45 + roarBreath + 0.35 * hotSpot * emberDrift);
    // Warm gradient: cp1 (red core) -> cp2 (amber tip) by noise * hotspot.
    // Folding hotSpot into the gradient mix pushes the kiln center toward cp2
    // (amber tip) while the edges stay cp1 (red core) — readable depth.
    var mixT = clamp01(n * 0.7 + hotSpot * 0.5);
    var glow = n * heat;
    r = (pr1 + (pr2 - pr1) * mixT) * glow;
    g = (pg1 + (pg2 - pg1) * mixT) * glow;
    b = (pb1 + (pb2 - pb1) * mixT) * glow;
    // Amber channel always-on under the noise — gives the lamps their kiln body.
    a = glow * 0.9;
    // White only on bright crests so the rig feels hot, not flat amber.
    // pow(n,3) is a soft gate, no hard threshold = no per-frame snapping.
    w = pow(n, 3.0) * heat * 0.7;
    // Steamboat-white (pattern 00 idiom): bright vintage W on the
    // upper/back of the cluster (high y OR deep z), gated by both the
    // hot-spot proximity and the smoothed motion intensity. The kiln
    // *roar* punches through the upper stacks — literal ember overdrive.
    if (y > 0.8 || z > 0.8) {
      var sb = motionIntensity * (0.55 + 0.45 * hotSpot) * 2.5;
      if (sb > 1.0) sb = 1.0;
      if (sb > w) w = sb;
    }
    // Tiny sparkle on a deterministic time-jittered kernel rather than
    // per-frame random — avoids strobe-fizz at 60 fps.
    var sparkSeed = (tPhase * 11.0 + index * 0.137) % 1.0;
    if (sparkSeed < 0.04 * sparkleDensity) {
      if (w < 0.85) w = 0.85;
    }
  } else if (isRedwood) {
    // UV backdrop only — frames the kiln glow without competing with it.
    u = uvIntensity * (0.55 + 0.45 * wave(tPhase * 0.6 + z * 0.4));
  }
  // No UV, no W, no A outside the branches above — historical R7/R8 bugs
  // (unconditional UV/floor channels leaking stage-wide) explicitly avoided.
  rgbwau(clamp01(r), clamp01(g), clamp01(b), clamp01(w), clamp01(a), clamp01(u));
}
