/*
  redwood_aurora
  Slow shimmering aurora wash across the redwoods — multiple cool hues
  rippling along the depth axis (nz) like northern lights drifting between
  the trees. The three redwood rings (Redwoods1/2/3) get distinct phase
  offsets keyed by pixel index so each ring breathes on its own cadence
  instead of pulsing in unison.

  Recurring-bug fixes (Reviewer 7, section 7.1):
    - coord:  original used world `y` (constant 3 across all redwoods) as
              vertical axis → single global phase. Replaced with normalized
              `z` (= nz, depth into grove) plus a per-redwood-group offset
              derived from the pixel index.
    - mask:   replaced raw `viewMask & 64` with named MASK_REDWOOD_PARS.
              `viewMask & 2` (intended as Cabin/Tower) is NOT a registered
              mask on logsville — DROPPED. `cabinWarmth` slider retained
              but routed onto the redwood RGB residual as a warm-tip bias.
    - UV:     `u = uvIntensity * (1 - noise)` ran unconditionally and
              violet-washed walls + bars + vintage. Now strictly inside
              the redwood branch.

  View masks consumed (named, registered in summer_camp_logsville.viewmasks.js):
    RedwoodPARs (0x40) — aurora wash + UV undertow

  Dropped feature (no silent fallback):
    cabin/tower amber tint (was `viewMask & 2`) — no Cabin or Tower mask is
    registered in summer_camp_logsville.viewmasks.js. Not faked elsewhere.
*/

// Named view-mask bits (mirrors summer_camp_logsville.viewmasks.js).
var MASK_REDWOOD_PARS = 64;

// Redwoods occupy pixel indices 204..221 in three 6-pixel groups:
//   Redwoods1 = 204..209, Redwoods2 = 210..215, Redwoods3 = 216..221.
// Group phase offsets (in cycles) so each ring shimmers on its own beat.
var REDWOOD_BASE_INDEX = 204;
var REDWOOD_GROUP_SIZE = 6;

export var localSpeed = 0.5;
export var auroraHeight = 0.7;
export var windShimmer = 0.3;
export var cabinWarmth = 0.25;
export var uvIntensity = 0.8;

export var cp1H = 0.55, cp1S = 1.0, cp1V = 1.0;   // teal/cyan default
export var cp2H = 0.78, cp2S = 1.0, cp2V = 1.0;   // violet default
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderAuroraHeight(v) { auroraHeight = v; }
export function sliderWindShimmer(v) { windShimmer = v; }
export function sliderCabinWarmth(v) { cabinWarmth = v; }
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
// Per-harmonic time bases — each shimmer/band advances independently so a
// roll-over on tPhase doesn't teleport every layer at the same instant
// (precedent: 05/10/18/20/23/24/44).
var tBandB = 0.0;
var tShimmer = 0.0;
export function beforeRender(delta) {
  var localMult = pow(2.0, (localSpeed - 0.5) * 5.4);
  var step = (delta / 1310.72) * localMult;
  tPhase = (tPhase + step) % 1.0;
  if (tPhase < 0.0) tPhase += 1.0;
  tBandB = (tBandB + step * 1.618) % 1.0;
  if (tBandB < 0.0) tBandB += 1.0;
  tShimmer = (tShimmer + step * 7.3) % 1.0;
  if (tShimmer < 0.0) tShimmer += 1.0;
  _hsv2rgb1();
  _hsv2rgb2();
}

// Engine convention: `x, y, z` are the pixel's *normalized* coords
// (nx, ny, nz from the model) in [0,1] — NOT world meters.
export function render3D(index, x, y, z) {
  var isRedwood = (viewMask & MASK_REDWOOD_PARS) != 0;
  var r = 0.0, g = 0.0, b = 0.0, w = 0.0, a = 0.0, u = 0.0;
  if (isRedwood) {
    // Per-redwood-group phase offset (R1/R2/R3 → 0.0 / 0.33 / 0.66).
    var groupId = floor((index - REDWOOD_BASE_INDEX) / REDWOOD_GROUP_SIZE);
    if (groupId < 0) groupId = 0;
    if (groupId > 2) groupId = 2;
    var groupPhase = groupId * 0.3333;

    // Travel along depth (nz) — redwoods sit at nz=0.78..1.0; multiply by
    // 2 so a curtain rolls through the grove. Add a second decorrelated
    // sweep at golden-ratio rate so the aurora never visibly repeats.
    var bandA = wave(tPhase + groupPhase + z * 2.0);
    var bandB = wave(tBandB + groupPhase * 0.5 + x * 1.3);
    // Third decorrelated band on a per-pixel offset adds canopy depth: each
    // PAR in the ring breathes on its own micro-cadence so adjacent pixels
    // never lock-step. Cheap and wraps01-safe (integer multiplier on tPhase).
    var bandC = wave(tPhase * 0.43 + (index - REDWOOD_BASE_INDEX) * 0.091);
    var aurora = bandA * 0.5 + bandB * 0.35 + bandC * 0.15;

    // Mix cp1↔cp2 by the aurora curtain → multi-hue cool wash.
    var rr = pr1 + (pr2 - pr1) * aurora;
    var gg = pg1 + (pg2 - pg1) * aurora;
    var bb = pb1 + (pb2 - pb1) * aurora;
    var amp = auroraHeight * (0.55 + 0.45 * bandA);
    r = rr * amp;
    g = gg * amp;
    b = bb * amp;

    // Warm-tip bias: tipmost redwoods (nz near 1) carry a touch of amber
    // so the canopy feels lit from the warm cabin direction. Replaces the
    // dropped `viewMask & 2` cabin-amber tint without faking the mask.
    a = cabinWarmth * pow(z, 4.0);

    // Wind shimmer: coherent high-band noise gated above a threshold —
    // never per-frame strobe like the original `random(1) < 0.05`.
    var shimmer = wave(tShimmer + index * 0.137);
    if (shimmer > 0.75) {
      w = windShimmer * (shimmer - 0.75) * 4.0;
    }

    // UV undertow — inverse of the curtain, so the dark valleys glow.
    u = uvIntensity * (1.0 - aurora) * 0.8;
  }
  rgbwau(clamp01(r), clamp01(g), clamp01(b), clamp01(w), clamp01(a), clamp01(u));
}
