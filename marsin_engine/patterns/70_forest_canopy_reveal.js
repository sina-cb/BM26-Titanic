/*
  70_forest_canopy_reveal — living redwood currents

  MarsinScript-safe:
  - No typeof, strings, objects, classes, groupId, or JS-only features.
  - Uses numeric viewMask + index fallback only.

  Geometry:
  - 18 RedwoodPARs total.
  - 3 redwood clusters.
  - 6 PARs around each tree.

  Creative goal:
  - Trees should feel like living circular surfaces, not static blobs.
  - The whole grove breathes and travels.
  - Each tree has internal circular current motion.
  - Moving shadow blades carve negative space through the canopy.
  - Tiny RGB palette glints add life without washing out cp1/cp2.

  Parameter rule:
  - localSpeed is first and mandatory.
  - Only four extra performance controls.

  Controls:
  - localSpeed: overall speed trim.
  - canopyGlow: dim mysterious grove -> bright living canopy.
  - treeSpread: giant tree masses -> individual PAR ring currents.
  - shimmer: calm surface -> complex leaf/firefly motion.
  - blackoutDepth: soft glow -> carved dark negative space.
*/

var MASK_REDWOOD_PARS = 64;
var MASK_VINTAGE_ONLY = 128;

var REDWOOD_START = 204;
var REDWOOD_END = 221;
var REDWOOD_COUNT = 18;
var PARS_PER_TREE = 6;
var TREE_COUNT = 3;

export var localSpeed = 0.5;
export var canopyGlow = 0.86;
export var treeSpread = 0.62;
export var shimmer = 0.54;
export var blackoutDepth = 0.56;

export var cp1H = 0.0, cp1S = 1.0, cp1V = 1.0;
export var cp2H = 0.08, cp2S = 1.0, cp2V = 1.0;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderCanopyGlow(v) { canopyGlow = v; }
export function sliderTreeSpread(v) { treeSpread = v; }
export function sliderShimmer(v) { shimmer = v; }
export function sliderBlackoutDepth(v) { blackoutDepth = v; }

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

function clamp01(vv) {
  if (vv < 0.0) return 0.0;
  if (vv > 1.0) return 1.0;
  return vv;
}

function wrap01(vv) {
  vv = vv % 1.0;
  if (vv < 0.0) vv += 1.0;
  return vv;
}

function circDist(av, bv) {
  var dv = abs(av - bv);
  if (dv > 0.5) dv = 1.0 - dv;
  return dv;
}

function smoothstep01(vv) {
  vv = clamp01(vv);
  return vv * vv * (3.0 - 2.0 * vv);
}

function softPulse(distv, widthv) {
  var xv = clamp01(1.0 - distv / widthv);
  return smoothstep01(xv);
}

function tri01(vv) {
  vv = wrap01(vv);
  if (vv < 0.5) return vv * 2.0;
  return 2.0 - vv * 2.0;
}

function hash01(vv) {
  var hv = sin(vv * 12.9898) * 43758.5453;
  return hv - floor(hv);
}

function pingPongTreePosition(vv) {
  return tri01(vv) * (TREE_COUNT - 1.0);
}

var GOLDEN = 0.6180339;
var SQRT2 = 1.4142136;

var tGrove = 0.0;
var tBreath = 0.0;
var tOrbitA = 0.0;
var tOrbitB = 0.0;
var tShadow = 0.0;
var tColor = 0.0;
var tSpark = 0.0;

export function beforeRender(delta) {
  var localMult = pow(2.0, (localSpeed - 0.5) * 5.4);
  var dt = (delta / 1000.0) * localMult;

  // Faster defaults than the original pattern, but still smooth and cinematic.
  tGrove  = wrap01(tGrove  + dt * (0.055 + canopyGlow * 0.145));
  tBreath = wrap01(tBreath + dt * (0.040 + canopyGlow * 0.070));
  tOrbitA = wrap01(tOrbitA + dt * (0.115 + treeSpread * 0.430 + shimmer * 0.130));
  tOrbitB = wrap01(tOrbitB + dt * (0.075 + treeSpread * 0.290 + shimmer * 0.185));
  tShadow = wrap01(tShadow + dt * (0.040 + blackoutDepth * 0.145 + shimmer * 0.070));
  tColor  = wrap01(tColor  + dt * (0.022 + canopyGlow * 0.030 + shimmer * 0.040));
  tSpark  = wrap01(tSpark  + dt * (0.70 + shimmer * 2.80));

  _hsv2rgb1();
  _hsv2rgb2();
}

export function render3D(index, x, y, z) {
  var isRedwoodByMask = (viewMask & MASK_REDWOOD_PARS) != 0;
  var isRedwoodByIndex = index >= REDWOOD_START && index <= REDWOOD_END;
  var isRedwood = isRedwoodByMask || isRedwoodByIndex;
  var isVintage = (viewMask & MASK_VINTAGE_ONLY) != 0;

  var rr = 0.0;
  var gg = 0.0;
  var bb = 0.0;
  var ww = 0.0;
  var aa = 0.0;
  var uu = 0.0;

  if (isRedwood) {
    var local = index - REDWOOD_START;
    if (local < 0 || local >= REDWOOD_COUNT) local = index % REDWOOD_COUNT;

    var treeId = floor(local / PARS_PER_TREE);
    if (treeId < 0) treeId = 0;
    if (treeId > 2) treeId = 2;

    var parId = local % PARS_PER_TREE;
    if (parId < 0) parId = parId + PARS_PER_TREE;
    var parAngle = parId / PARS_PER_TREE;

    // 1. Macro grove current: a soft energy body travels across the three trees.
    var activeTree = pingPongTreePosition(tGrove);
    var dTree = abs(treeId - activeTree);
    var groveCore = exp(-(dTree * dTree) / (0.36 + shimmer * 0.68));

    var trailingTree = pingPongTreePosition(wrap01(tGrove - 0.18 - shimmer * 0.08));
    var dTrail = abs(treeId - trailingTree);
    var groveTrail = exp(-(dTrail * dTrail) / 1.05) * (0.20 + shimmer * 0.30);

    // 2. Root-pressure breathing: different for each tree, never hard grouped.
    var rootBreath = pow(wave(tBreath + treeId * GOLDEN), 1.35);
    var rootRipple = pow(wave(tBreath * SQRT2 + treeId * 0.217 + parAngle * 0.33), 2.20);
    var rootLife = clamp01(rootBreath * 0.62 + rootRipple * 0.38);

    // 3. Counter-rotating ring currents around each tree.
    var headA = wrap01(tOrbitA + treeId * GOLDEN + tGrove * 0.08);
    var headB = wrap01(1.0 - tOrbitB + treeId * 0.271 + tBreath * 0.05);

    var currentA = softPulse(circDist(parAngle, headA), 0.110 + treeSpread * 0.115);
    var currentATail = softPulse(circDist(parAngle, wrap01(headA - 0.18)), 0.215 + treeSpread * 0.075) * 0.42;
    var currentB = softPulse(circDist(parAngle, headB), 0.085 + shimmer * 0.085) * (0.28 + shimmer * 0.42);

    // 4. Spiral leaf shimmer: phase-locked to tree and PAR angle, not random noise.
    var spiralArms = 2.0 + floor(shimmer * 4.0);
    var spiral = pow(wave(parAngle * spiralArms + tOrbitA * 0.52 + treeId * 0.117), 2.8);
    var spiral2 = pow(wave(parAngle * 3.0 - tOrbitB * 0.71 + treeId * 0.291), 3.8) * shimmer;
    var leafLife = clamp01(spiral * 0.28 + spiral2 * 0.32);

    // Whole-tree mass vs detailed PAR ring movement.
    var groveMass = clamp01(groveCore + groveTrail + rootLife * 0.23);
    var ringMass = clamp01(currentA + currentATail + currentB + leafLife);
    var livingMotion = groveMass * (1.0 - treeSpread) + ringMass * treeSpread;

    // Shimmer adds complexity without turning into chaos.
    livingMotion = clamp01(livingMotion * (0.74 + shimmer * 0.40) + rootLife * shimmer * 0.22);

    // 5. Moving shadow blades: they carve dark motion into the light.
    var shadowBladeA = pow(wave(parAngle * 2.0 - tShadow + treeId * 0.133), 2.0 + blackoutDepth * 5.2);
    var shadowBladeB = pow(wave(parAngle * 3.0 + tShadow * SQRT2 + treeId * 0.311), 3.5 + blackoutDepth * 3.0);
    var shadowBlade = clamp01(shadowBladeA * 0.62 + shadowBladeB * 0.38);

    // 6. Palette-locked tiny glints. RGB only, not white.
    var glintSeed = hash01(index * 23.17 + floor(tSpark * 17.0) + treeId * 3.1);
    var glint = 0.0;
    if (glintSeed > 0.935) {
      glint = (glintSeed - 0.935) * 15.38 * shimmer * (0.28 + livingMotion * 0.72);
    }

    // Brightness composition: organic floor + moving current + carved darkness.
    var forestFloor = (1.0 - blackoutDepth) * (0.018 + canopyGlow * 0.050);
    var breathFloor = rootLife * canopyGlow * 0.085 * (1.0 - blackoutDepth * 0.50);
    var motionLight = livingMotion * (0.30 + canopyGlow * 0.78);

    var brightness = forestFloor + breathFloor + motionLight + glint * 0.32;

    // Shadow blades carve, but never fully kill active currents.
    var carve = 1.0 - shadowBlade * blackoutDepth * (0.42 + 0.46 * (1.0 - livingMotion));
    brightness = clamp01(brightness * carve);

    // Color: strict cp1/cp2 palette drama with actual motion in the color field.
    var treeMix = treeId / (TREE_COUNT - 1.0);
    var ringMix = wave(tColor + parAngle * (0.70 + treeSpread * 1.10) + treeId * 0.183);
    var currentMix = wave(tColor * 0.61 + headA * 0.42 + headB * 0.31 + livingMotion * 0.22);
    var shadowMix = 1.0 - shadowBlade * 0.35;

    var colorMix = 0.50 * (1.0 - canopyGlow)
                 + canopyGlow * (0.37 * treeMix + 0.34 * ringMix + 0.29 * currentMix);

    // Active current pushes toward cp2, shadows retreat toward cp1.
    colorMix = colorMix * shadowMix + livingMotion * 0.13 + glint * 0.22;
    colorMix = clamp01(colorMix);

    rr = (pr1 + (pr2 - pr1) * colorMix) * brightness;
    gg = (pg1 + (pg2 - pg1) * colorMix) * brightness;
    bb = (pb1 + (pb2 - pb1) * colorMix) * brightness;

  } else if (isVintage) {
    // Very low palette-locked cabin flicker. It supports the grove but doesn't steal focus.
    var lanternPulse = pow(wave(tBreath * 0.73 + index * 0.029), 1.85);
    var lanternWaver = 0.78 + 0.22 * wave(tShadow * 0.55 + index * 0.011);
    var lanternBrightness = (0.014 + lanternPulse * 0.090 * canopyGlow) * lanternWaver;
    lanternBrightness = lanternBrightness * (1.0 - blackoutDepth * 0.28);

    var lanternMix = 0.50 * (1.0 - canopyGlow) + canopyGlow * wave(tColor * 0.57 + index * 0.017);
    lanternMix = clamp01(lanternMix);

    rr = (pr1 + (pr2 - pr1) * lanternMix) * lanternBrightness;
    gg = (pg1 + (pg2 - pg1) * lanternMix) * lanternBrightness;
    bb = (pb1 + (pb2 - pb1) * lanternMix) * lanternBrightness;
  }

  rgbwau(clamp01(rr), clamp01(gg), clamp01(bb), clamp01(ww), clamp01(aa), clamp01(uu));
}
