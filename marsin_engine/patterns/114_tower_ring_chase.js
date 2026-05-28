/*
  114_tower_ring_chase
  Snappy azimuthal chase around the 8-tower ring. A bright cp1 wedge
  sweeps around the audience (clockwise/counter-clockwise selectable)
  leaving an exponentially-decaying cp2 trail. Each tower's full 18-pixel
  column lights together — towers behave as a single "lit" or "not lit"
  azimuthal slice — so the chase reads as architectural ring lighting
  rather than per-pixel scrolling. Capped at <= 3 Hz revolution to stay
  strobe-safe (precedent: pattern 47, pattern 48).

  Concept (operator brief 2026-05-28: second tower-only pattern):
  around-the-circle chase using atan2(z - 0.5, x - 0.5) on tower x/z.
  Paired with the slow 113_tower_column_breath to give the operator a
  contrasting fast/slow tower duo.

  Audio sliders (default 0; pattern complete without audio per P0):
    audioKick — fires an extra-bright wedge "snap" on every kick
    audioHigh — adds wedge sparkle (deterministic, no random)

  View masks consumed:
    RedwoodPARs (0x40) — explicit zero output (tower-only rule)
    VintageOnly (0x80) — soft directional wash following the wedge
*/

// Named view-mask bits (mirrors summer_camp_logsville.viewmasks.js).
var MASK_REDWOOD_PARS = 64;
var MASK_VINTAGE_ONLY = 128;

var TOWER_BAR_HI = 143;

// Strobe-safe revolution rate cap (Hz). 8 towers => one tower lights
// every 1/(8*hz) seconds; at 3 Hz that's 41 ms — still beyond per-pixel
// strobe perception because each tower also has a soft falloff trail.
var RING_HZ_MAX = 3.0;

// Tower-azimuth lookup: project the 8 towers onto an angular slot in
// [0, 1) revolutions around the ring centre (0.5, 0.5) in (nx, nz). The
// engine gives us normalized coords; we re-derive theta per tower from
// the bar's nx/nz so we stay consistent with the model — no hard-coded
// tower-index -> angle table that could drift if the model changes.
//
// Derivation is per-pixel via atan2; storing the per-tower angle would
// require an array. To stay engine-compatible (Rule 1: no JS arrays) we
// just compute it per-pixel — cheap, and (nx, nz) are stable per index.

export var localSpeed = 0.5;
export var ringRate = 0.5;        // 0..1 -> 0.2..RING_HZ_MAX Hz revolutions
export var wedgeWidth = 0.16;     // angular half-width of the bright wedge (revs)
export var trailLength = 0.45;    // 0 = no trail, 1 = trail wraps the ring
export var brightness = 1.0;      // peak intensity of the wedge
export var direction = 1.0;       // 0..1 -> reverse..forward (split at 0.5)
export var baselineFloor = 0.06;  // off-wedge floor
export var vintageWash = 0.5;     // soft vintage wedge follow

// Audio sliders (default 0 — P0).
export var audioKick = 0.0;
export var audioHigh = 0.0;

// Palette defaults — cp1 hot leading edge, cp2 cool trail.
export var cp1H = 0.05, cp1S = 1.0, cp1V = 1.0;  // warm amber
export var cp2H = 0.55, cp2S = 1.0, cp2V = 0.9;  // cool cyan
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderRingRate(v) { ringRate = v; }
export function sliderWedgeWidth(v) { wedgeWidth = v; }
export function sliderTrailLength(v) { trailLength = v; }
export function sliderBrightness(v) { brightness = v; }
export function sliderDirection(v) { direction = v; }
export function sliderBaselineFloor(v) { baselineFloor = v; }
export function sliderVintageWash(v) { vintageWash = v; }
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

// Shortest forward distance from `front` to `theta` in [0,1] revolutions —
// i.e. how far behind the front this azimuthal slot sits. Always in [0,1).
function trailDist(front, theta, dir) {
  // For forward chase (dir > 0): want positive distance from front to
  // theta measured *backward* around the circle. For reverse, swap.
  var d = (dir > 0.0) ? (front - theta) : (theta - front);
  d = d - floor(d);
  if (d < 0.0) d = d + 1.0;
  return d;
}

// Soft raised-cosine wedge: 1.0 at angular distance 0, smoothly to 0 at
// +/- width. Always bounded in [0,1].
function wedge(dist, width) {
  var dWrap = dist;
  if (dWrap > 0.5) dWrap = 1.0 - dWrap; // shortest wrap distance
  if (dWrap >= width) return 0.0;
  return 0.5 + 0.5 * cos(dWrap / width * PI);
}

var tPhase = 0.0;
var ringPhase = 0.0;        // front position in [0,1] revolutions
var prevKick = 0.0;
var snapBoost = 0.0;        // decaying brightness lift on kick

export function beforeRender(delta) {
  var localMult = pow(2.0, (localSpeed - 0.5) * 5.4);
  var dt = delta / 1000.0;
  tPhase = (tPhase + (delta / 1310.72) * localMult) % 1.0;
  if (tPhase < 0.0) tPhase += 1.0;
  _hsv2rgb1();
  _hsv2rgb2();

  // Revolution rate — independent of localSpeed so ambience knob cannot
  // accidentally drive into strobe territory (precedent: pattern 81).
  var hz = 0.2 + clamp01(ringRate) * (RING_HZ_MAX - 0.2);
  if (hz > RING_HZ_MAX) hz = RING_HZ_MAX;
  var dir = (direction >= 0.5) ? 1.0 : -1.0;
  ringPhase = (ringPhase + dt * hz * dir) % 1.0;
  if (ringPhase < 0.0) ringPhase += 1.0;

  // Audio-kick rising edge -> snap boost decays exponentially.
  var k = clamp01(audioKick);
  var kickRise = k - prevKick;
  prevKick = k;
  if (kickRise > 0.1) {
    snapBoost = 0.5;
  }
  snapBoost = snapBoost * pow(0.5, dt / 0.15); // ~150 ms half-life
}

// Engine convention: x, y, z are normalized pixel coords in [0,1].
export function render3D(index, x, y, z) {
  var isRedwood = (viewMask & MASK_REDWOOD_PARS) != 0;
  var isVintage = (viewMask & MASK_VINTAGE_ONLY) != 0;
  var r = 0.0, g = 0.0, b = 0.0, w = 0.0, a = 0.0, u = 0.0;

  if (isRedwood) {
    rgbwau(0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
    return;
  }

  // Pixel azimuth around the stage centre. Towers form a roughly circular
  // ring in (nx, nz); the centre (0.5, 0.5) is the natural pivot.
  var dx = x - 0.5;
  var dz = z - 0.5;
  var theta = atan2(dz, dx) / PI2;
  theta = theta - floor(theta);

  var dir = (direction >= 0.5) ? 1.0 : -1.0;

  if (index <= TOWER_BAR_HI) {
    // TowerBar: wedge + exponentially-decaying trail.
    var wedgeLevel = wedge(trailDist(ringPhase, theta, dir), wedgeWidth);

    // Trail: distance behind the front; exponential falloff over
    // trailLength revolutions.
    var behind = trailDist(ringPhase, theta, dir);
    var trailFrac = clamp01(trailLength);
    var trail = 0.0;
    if (trailFrac > 0.001 && behind < trailFrac) {
      // Smooth decay: cosine over the trail length.
      var tt = behind / trailFrac;
      trail = pow(1.0 - tt, 2.0) * 0.55;
    }

    // Per-pixel vertical detail so each tower column isn't flat — slight
    // top-bias keeps the bar reading as an "uplit" wedge.
    var barT = (index % 18) / 17.0;
    var verticalTint = 0.85 + 0.15 * barT;

    var lit = baselineFloor + (brightness - baselineFloor) * wedgeLevel;
    lit = lit + snapBoost * wedgeLevel; // kick snap pops the wedge harder
    if (lit > 1.5) lit = 1.5;            // soft cap; rgbwau clamps to 1.0

    // Leading edge cp1, trailing cp2 — gradient by wedge vs trail mix.
    var mix = (wedgeLevel > 0.05) ? 0.0 : 1.0;
    var rc = pr1 + (pr2 - pr1) * mix;
    var gc = pg1 + (pg2 - pg1) * mix;
    var bc = pb1 + (pb2 - pb1) * mix;

    var totalBright = max(lit, trail);
    r = rc * totalBright * verticalTint;
    g = gc * totalBright * verticalTint;
    b = bc * totalBright * verticalTint;

    // Audio-high sparkle: deterministic kernel (Rule 5). Sparkle only on
    // the wedge so it reads as the leading edge crackling, not random.
    var sparkSeed = (tPhase * 13.0 + index * 0.191) % 1.0;
    if (wedgeLevel > 0.5 && sparkSeed < 0.05 * clamp01(audioHigh)) {
      w = 0.75;
    }
  } else if (isVintage) {
    // Vintage wash follows the wedge — same wedge function but wider
    // angle so it reads as a soft directional warm/cool wash.
    var vw = wedge(trailDist(ringPhase, theta, dir), wedgeWidth * 2.5);
    var wash = vintageWash * vw;
    if (wash > 1.0) wash = 1.0;
    // Bias toward cp1 (leading edge colour).
    var vmix = 0.25;
    r = (pr1 + (pr2 - pr1) * vmix) * wash * 0.6;
    g = (pg1 + (pg2 - pg1) * vmix) * wash * 0.6;
    b = (pb1 + (pb2 - pb1) * vmix) * wash * 0.6;
    a = wash * 0.9;
  }
  // No fallback for unflagged groups — Rule P0.

  rgbwau(clamp01(r), clamp01(g), clamp01(b), clamp01(w), clamp01(a), clamp01(u));
}
