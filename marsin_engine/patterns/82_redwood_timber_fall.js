/*
  redwood_timber_fall
  Per-operator: "trees too dim -> make it circles around the trees."
  Each of the 3 redwood groups is a 6-PAR ring. We now render a chasing
  arc that travels around each ring at PAR brightness (no 0.07 floor),
  and the three rings rotate at slightly different speeds + phase offsets
  so the grove reads as three orbiting halos rather than one slab. The
  original "timber fall" gesture is preserved as a periodic accent: every
  N cycles one tree's ring collapses (impact) and then settles, but the
  baseline behavior is BRIGHT circular sweeps so the trees never look dim.

  View masks consumed (named, registered in summer_camp_logsville.viewmasks.js):
    RedwoodPARs (0x40) — the only meaningful surface for this pattern;
      one of the three Redwood groups falls at a time, others stand quiet.

  Note: previous draft used world `x` and world `y` (constant 3.0 across
  every redwood) against a [0,1] wave, producing a near-static dim wash.
  Rewrite uses cycle-driven fall + per-group sequencing. The "standing"
  trees and the falling tree share the RedwoodPARs view-mask — the engine
  does not expose per-group named masks, so we identify groups by their
  known pixel index range. If summer_camp_logsville.viewmasks.js later
  registers per-group masks (Redwoods1/2/3) we should switch to those.
*/

// Named view-mask bits (mirrors summer_camp_logsville.viewmasks.js).
var MASK_REDWOOD_PARS = 64;

// Redwood group index ranges (from summer_camp_logsville.js):
//   Redwoods1: 204..209
//   Redwoods2: 210..215
//   Redwoods3: 216..221
var REDWOOD_BASE = 204;
var GROUP_SIZE = 6;
var GROUP_COUNT = 3;

export var localSpeed = 0.5;
export var fallDuration = 0.5;  // 0..1 -> 12..3 s per tree (slow..fast)
export var standBrightness = 0.4;
export var canopyBrightness = 1.0;
export var impactFlash = 0.8;   // brightness of the "ground" hit
export var dustGlow = 0.5;      // UV cloud lingering after impact

export var cp1H = 0.0, cp1S = 1.0, cp1V = 1.0;
export var cp2H = 0.08, cp2S = 1.0, cp2V = 1.0;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderFallDuration(v) { fallDuration = v; }
export function sliderStandBrightness(v) { standBrightness = v; }
export function sliderCanopyBrightness(v) { canopyBrightness = v; }
export function sliderImpactFlash(v) { impactFlash = v; }
export function sliderDustGlow(v) { dustGlow = v; }

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

// Per-cycle phases — split each cycle into still / falling / settled.
var STILL_END = 0.18;     // upright stillness: 0 .. 0.18
var FALL_END = 0.70;      // accelerating fall: 0.18 .. 0.70
                          // settle (post-impact glow): 0.70 .. 1.0

// One full cycle covers all three groups, so each tree gets 1/GROUP_COUNT
// of the cycle. cycleSec ranges 3..12 s based on fallDuration slider.
var cyclePhase = 0.0;
var tPhase = 0.0;

export function beforeRender(delta) {
  var localMult = pow(2.0, (localSpeed - 0.5) * 5.4);
  tPhase = (tPhase + (delta / 1310.72) * localMult) % 1.0;
  if (tPhase < 0.0) tPhase += 1.0;
  _hsv2rgb1();
  _hsv2rgb2();

  // Per-tree time: 3 s (fast) .. 12 s (slow). Multiply by GROUP_COUNT for
  // the full cycle through all three trees.
  var perTreeSec = 12.0 - fallDuration * 9.0;
  var fullCycleSec = perTreeSec * GROUP_COUNT;
  if (fullCycleSec < 1.0) fullCycleSec = 1.0;
  cyclePhase = (cyclePhase + (delta / 1000.0) / fullCycleSec) % 1.0;
  if (cyclePhase < 0.0) cyclePhase += 1.0;
}

// Engine convention: x, y, z are normalized pixel coords in [0,1].
export function render3D(index, x, y, z) {
  var isRedwood = (viewMask & MASK_REDWOOD_PARS) != 0;
  var r = 0.0, g = 0.0, b = 0.0, w = 0.0, a = 0.0, u = 0.0;

  if (isRedwood) {
    var local = index - REDWOOD_BASE;
    if (local < 0) local = 0;
    var groupId = floor(local / GROUP_SIZE);
    if (groupId >= GROUP_COUNT) groupId = GROUP_COUNT - 1;
    var posInGroup = local - groupId * GROUP_SIZE;
    // ringPos: 0..1 around the 6-PAR ring. Position 0 is the front PAR,
    // 0.5 is the back PAR.
    var ringPos = posInGroup / GROUP_SIZE;

    // Per-group rotation: each ring spins at a slightly different rate
    // so the three trees aren't synchronized — gives the "orbiting halo"
    // read the operator asked for.
    var groupSpeed = 1.0 + groupId * 0.18;
    var groupPhase = tPhase * groupSpeed + groupId * 0.27;
    var ringHeadA = groupPhase - floor(groupPhase);              // primary head
    var ringHeadB = (groupPhase + 0.5) - floor(groupPhase + 0.5); // counter head

    // Circular distance around the ring (wrap-aware).
    var dA = abs(ringPos - ringHeadA);
    if (dA > 0.5) dA = 1.0 - dA;
    var dB = abs(ringPos - ringHeadB);
    if (dB > 0.5) dB = 1.0 - dB;

    // Wide soft arcs — at width ≈ 0.30 the falloff covers ~2 of the 6 PARs
    // per arc, so the ring reads as a sweeping crescent rather than a
    // pinpoint. Falloff is quadratic for soft edges.
    var arcWidth = 0.32;
    var arcA = 0.0, arcB = 0.0;
    if (dA < arcWidth) { var nA = 1.0 - dA / arcWidth; arcA = nA * nA; }
    if (dB < arcWidth) { var nB = 1.0 - dB / arcWidth; arcB = nB * nB; }

    // ── PAR baseline brightness ──────────────────────────────────────
    // Operator: "trees too dim". Redwoods are PARs; floor at 0.55 with
    // arc lift up to ~1.0. standBrightness slider scales the floor.
    var floorPAR = 0.55 * standBrightness * (0.85 + 0.15 * wave(tPhase + groupId * 0.33));
    var arcLift = (arcA + arcB * 0.7) * canopyBrightness * 0.45;
    var brightness = floorPAR + arcLift;
    if (brightness > 1.0) brightness = 1.0;

    // Color: cp1 dominates the arc-A leading head, cp2 dominates arc-B
    // counter-head, so the ring has two distinct colored sweepers.
    var rcA = pr1, gcA = pg1, bcA = pb1;
    var rcB = pr2, gcB = pg2, bcB = pb2;
    var rwash = pr1 * 0.5 + pr2 * 0.5;
    var gwash = pg1 * 0.5 + pg2 * 0.5;
    var bwash = pb1 * 0.5 + pb2 * 0.5;
    // Mix: floor uses palette wash, arcs paint their colors over it.
    r = rwash * floorPAR + rcA * arcA * canopyBrightness * 0.45 + rcB * arcB * canopyBrightness * 0.3;
    g = gwash * floorPAR + gcA * arcA * canopyBrightness * 0.45 + gcB * arcB * canopyBrightness * 0.3;
    b = bwash * floorPAR + bcA * arcA * canopyBrightness * 0.45 + bcB * arcB * canopyBrightness * 0.3;
    // Amber on the leading arc for warmth.
    a = arcA * 0.40;
    // UV glow around the grove.
    u = 0.15 + arcB * dustGlow * 0.50;

    // ── Periodic timber-fall accent ──────────────────────────────────
    // Preserve the original gesture as a bright punctuation: at each
    // cyclePhase boundary one tree's ring gets an "impact" flash.
    var activeGroup = floor(cyclePhase * GROUP_COUNT);
    if (activeGroup >= GROUP_COUNT) activeGroup = GROUP_COUNT - 1;
    var treePhase = (cyclePhase * GROUP_COUNT) - activeGroup;

    if (groupId == activeGroup && treePhase > FALL_END) {
      // Settle window: bright white impact on the whole ring, decaying.
      var sP = (treePhase - FALL_END) / (1.0 - FALL_END);
      var hit = 0.5 + 0.5 * cos(sP * PI); // 1 at sP=0
      w = impactFlash * hit * 0.85;
      a = a + hit * 0.35;
      u = u + dustGlow * hit * 0.5;
    } else if (groupId == activeGroup && treePhase > STILL_END && treePhase < FALL_END) {
      // Fall window: lift the active ring brighter so it "blooms" before
      // collapsing — gives the visual hook of "this tree is the one."
      var fP = (treePhase - STILL_END) / (FALL_END - STILL_END);
      r = r + pr1 * 0.25 * fP;
      g = g + pg1 * 0.25 * fP;
      b = b + pb1 * 0.25 * fP;
      a = a + 0.25 * fP;
    }
  }
  rgbwau(clamp01(r), clamp01(g), clamp01(b), clamp01(w), clamp01(a), clamp01(u));
}
