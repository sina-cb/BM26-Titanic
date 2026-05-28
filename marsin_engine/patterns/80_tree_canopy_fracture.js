/*
  canopy_fracture — thunder crown shatter

  Rewritten for Pattern Optimization Rules:
  - localSpeed is the first exported parameter.
  - sliderLocalSpeed is the first slider function.
  - Only four extra performance controls.
  - RGB stays in strict cp1 <-> cp2 interpolation.
  - White / amber / UV are derived internally as lightning accents.

  Distinct idea:
  - This is not a constant UV wash.
  - The grove sits in charged darkness, then branching lightning crawls
    through the 3 redwood crowns and shatters around the 6-PAR rings.
  - Aftershocks leave ghost color memory across the rest of the rig.
  - Motion uses several non-matching clocks so hits feel storm-like,
    not like a simple repeated strobe.

  Controls:
  - localSpeed: motion speed trim.
  - fractureAmount: quiet storm -> dense branching fracture field.
  - branchSharpness: soft electric veins -> razor-sharp lightning cracks.
  - aftershock: short dry hits -> long glowing storm memory.
  - blackoutDepth: luminous storm wash -> deep dramatic darkness.
*/

var MASK_REDWOOD_PARS = 64;

var REDWOOD_START = 204;
var REDWOOD_END = 221;
var REDWOOD_COUNT = 18;
var PARS_PER_TREE = 6;
var TREE_COUNT = 3;

export var localSpeed = 0.5;
export var fractureAmount = 0.62;
export var branchSharpness = 0.58;
export var aftershock = 0.46;
export var blackoutDepth = 0.68;

export var cp1H = 0.0, cp1S = 1.0, cp1V = 1.0;
export var cp2H = 0.08, cp2S = 1.0, cp2V = 1.0;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderFractureAmount(v) { fractureAmount = v; }
export function sliderBranchSharpness(v) { branchSharpness = v; }
export function sliderAftershock(v) { aftershock = v; }
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

var tCharge = 0.0;
var tStrike = 0.0;
var tForkA = 0.0;
var tForkB = 0.0;
var tAfter = 0.0;
var tColor = 0.0;
var tSpark = 0.0;

export function beforeRender(delta) {
  var localMult = pow(2.0, (localSpeed - 0.5) * 5.4);
  var dt = (delta / 1000.0) * localMult;

  // Storm clocks: intentionally non-matching so the fracture does not loop obviously.
  tCharge = wrap01(tCharge + dt * (0.032 + fractureAmount * 0.070));
  tStrike = wrap01(tStrike + dt * (0.090 + fractureAmount * 0.310));
  tForkA  = wrap01(tForkA  + dt * (0.135 + branchSharpness * 0.380));
  tForkB  = wrap01(tForkB  + dt * (0.073 + branchSharpness * 0.260 + fractureAmount * 0.070));
  tAfter  = wrap01(tAfter  + dt * (0.024 + aftershock * 0.120));
  tColor  = wrap01(tColor  + dt * (0.018 + fractureAmount * 0.050));
  tSpark  = wrap01(tSpark  + dt * (0.80 + fractureAmount * 2.90));

  _hsv2rgb1();
  _hsv2rgb2();
}

export function render3D(index, x, y, z) {
  var isRedwoodByMask = (viewMask & MASK_REDWOOD_PARS) != 0;
  var isRedwoodByIndex = index >= REDWOOD_START && index <= REDWOOD_END;
  var isRedwood = isRedwoodByMask || isRedwoodByIndex;

  var rr = 0.0;
  var gg = 0.0;
  var bb = 0.0;
  var ww = 0.0;
  var aa = 0.0;
  var uu = 0.0;

  var colorMix = 0.0;
  var brightness = 0.0;

  if (isRedwood) {
    var local = index - REDWOOD_START;
    if (local < 0 || local >= REDWOOD_COUNT) local = index % REDWOOD_COUNT;

    var treeId = floor(local / PARS_PER_TREE);
    if (treeId < 0) treeId = 0;
    if (treeId > 2) treeId = 2;

    var parId = local % PARS_PER_TREE;
    if (parId < 0) parId = parId + PARS_PER_TREE;
    var parAngle = parId / PARS_PER_TREE;

    // 1. Charged storm body: a dark pressure field moves through the three trees.
    var chargeTree = pingPongTreePosition(tCharge);
    var dCharge = abs(treeId - chargeTree);
    var chargeBody = exp(-(dCharge * dCharge) / (0.62 + aftershock * 0.62));

    // 2. Primary fracture strikes: soft tree focus, razor ring cracks.
    var strikeTreeA = pingPongTreePosition(tStrike);
    var strikeTreeB = pingPongTreePosition(wrap01(tStrike + 0.371 + tAfter * 0.031));

    var dStrikeA = abs(treeId - strikeTreeA);
    var dStrikeB = abs(treeId - strikeTreeB);
    var treeFocusA = exp(-(dStrikeA * dStrikeA) / (0.24 + fractureAmount * 0.52));
    var treeFocusB = exp(-(dStrikeB * dStrikeB) / (0.32 + fractureAmount * 0.70)) * 0.72;

    var boltGateA = pow(wave(tStrike * 2.0 + treeId * 0.113), 9.0 + branchSharpness * 14.0);
    var boltGateB = pow(wave(tForkB * 1.7 + treeId * 0.231), 7.0 + branchSharpness * 12.0) * fractureAmount;

    var mainHead = wrap01(tForkA + treeId * GOLDEN + strikeTreeA * 0.057);
    var forkHead = wrap01(1.0 - tForkB * SQRT2 + treeId * 0.271 + strikeTreeB * 0.071);
    var crossHead = wrap01(mainHead + 0.31 + wave(tCharge + treeId * 0.19) * 0.18);

    var crackWidth = 0.045 + (1.0 - branchSharpness) * 0.120;
    var mainCrack = softPulse(circDist(parAngle, mainHead), crackWidth);
    var forkCrack = softPulse(circDist(parAngle, forkHead), crackWidth * 0.78 + 0.018);
    var crossCrack = softPulse(circDist(parAngle, crossHead), crackWidth * 0.65 + 0.014) * 0.65;

    // 3. Jagged branch veins: moving darkness and light through the crown.
    var veinA = pow(wave(parAngle * 2.0 - tForkA + treeId * 0.137), 2.0 + branchSharpness * 6.0);
    var veinB = pow(wave(parAngle * 3.0 + tForkB * SQRT2 + treeId * 0.311), 3.0 + branchSharpness * 5.0);
    var branchVeins = clamp01(veinA * 0.55 + veinB * 0.45);

    // 4. Crown shatter: end trees explode outward, center catches the echo.
    var endTree = 0.0;
    if (treeId == 0) endTree = 1.0;
    if (treeId == 2) endTree = 1.0;

    var centerTree = 0.0;
    if (treeId == 1) centerTree = 1.0;

    var crownPulse = pow(wave(tStrike * 0.83 + treeId * 0.173), 12.0 + fractureAmount * 10.0);
    var crownShatter = crownPulse * (endTree * 0.80 + centerTree * 0.45) * clamp01(mainCrack + forkCrack + branchVeins * 0.42);

    // 5. Tiny random-looking branch sparks, deterministic but irregular.
    var eventBucket = floor(tSpark * 29.0);
    var sparkSeed = hash01(index * 31.17 + eventBucket * 7.23 + treeId * 5.91);
    var spark = 0.0;
    if (sparkSeed > 0.940) {
      spark = (sparkSeed - 0.940) * 16.66 * fractureAmount * (0.35 + branchVeins * 0.65);
    }

    var primaryStrike = treeFocusA * boltGateA * clamp01(mainCrack + crossCrack);
    var secondaryStrike = treeFocusB * boltGateB * clamp01(forkCrack + branchVeins * 0.35);
    var fractureLight = clamp01(primaryStrike + secondaryStrike + crownShatter + spark);

    // 6. Aftershock memory: colored ghosts remain after the white crack fades.
    var afterWave = pow(wave(tAfter + treeId * GOLDEN + parAngle * 0.31), 1.55);
    var afterMemory = aftershock * afterWave * clamp01(chargeBody * 0.60 + branchVeins * 0.40 + fractureLight * 0.42);

    // Carved darkness keeps the wow hits dramatic.
    var darkVein = pow(wave(parAngle * 2.0 + tAfter * SQRT2 + treeId * 0.223), 2.1 + blackoutDepth * 5.0);
    var stormFloor = (1.0 - blackoutDepth) * (0.018 + aftershock * 0.040);

    brightness = stormFloor
               + chargeBody * aftershock * 0.070
               + afterMemory * 0.42
               + fractureLight * (0.50 + fractureAmount * 0.70);

    var carve = 1.0 - darkVein * blackoutDepth * (0.35 + 0.45 * (1.0 - fractureLight));
    brightness = clamp01(brightness * carve);

    // Creative color, still strict cp1 <-> cp2 interpolation.
    // Charge starts near cp1; active fractures snap toward cp2; aftershock drifts between.
    var treeMix = treeId / (TREE_COUNT - 1.0);
    var ringMix = wave(tColor + parAngle * (0.80 + branchSharpness * 0.70) + treeId * 0.193);
    var lightningMix = clamp01(fractureLight * 0.82 + crownShatter * 0.18);
    var afterMix = wave(tColor * 0.63 + tAfter + branchVeins * 0.23 + treeId * 0.17);

    colorMix = clamp01(
      0.18 * treeMix +
      0.27 * ringMix +
      0.22 * afterMix +
      0.33 * lightningMix
    );

    // Darkness pulls toward cp1; fracture pulls toward cp2.
    colorMix = clamp01(colorMix - darkVein * blackoutDepth * 0.12 + fractureLight * 0.22 + spark * 0.12);

    // Physical channel accents. Strong enough to feel like lightning, not enough to erase palette.
    ww = clamp01((primaryStrike * 0.55 + crownShatter * 0.42 + spark * 0.16) * branchSharpness);
    uu = clamp01((darkVein * blackoutDepth * 0.075 + afterMemory * 0.080 + secondaryStrike * 0.130));
    aa = clamp01(aftershock * afterMemory * 0.055 + crownShatter * 0.035);

  } else {
    // Everything else receives only a low storm-memory wash.
    // This keeps the eye on the redwood fractures but avoids dead black between hits.
    var ambient = pow(wave(tAfter + x * 0.23 + z * 0.31), 1.80);
    var pressure = pow(wave(tCharge * 0.83 + x * 0.41 - z * 0.17), 2.60);
    var shadow = pow(wave(tAfter * SQRT2 + x * 0.65 + z * 0.29), 2.0 + blackoutDepth * 3.5);

    brightness = (1.0 - blackoutDepth) * 0.015 + aftershock * (ambient * 0.045 + pressure * 0.030);
    brightness = clamp01(brightness * (1.0 - shadow * blackoutDepth * 0.45));

    colorMix = clamp01(0.35 + 0.45 * wave(tColor * 0.7 + x * 0.37 + z * 0.19) + pressure * 0.20);

    aa = clamp01(aftershock * ambient * 0.030);
    uu = clamp01(blackoutDepth * shadow * 0.025);
  }

  rr = (pr1 + (pr2 - pr1) * colorMix) * brightness;
  gg = (pg1 + (pg2 - pg1) * colorMix) * brightness;
  bb = (pb1 + (pb2 - pb1) * colorMix) * brightness;

  rgbwau(clamp01(rr), clamp01(gg), clamp01(bb), clamp01(ww), clamp01(aa), clamp01(uu));
}
