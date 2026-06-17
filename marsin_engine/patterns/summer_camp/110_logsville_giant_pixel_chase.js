/*
  110_logsville_giant_pixel_chase — molten grove chase

  Fix + optimization pass:
  - localSpeed is the first exported parameter.
  - sliderLocalSpeed is the first slider function.
  - Removed fragile mode/audio/section-count controls.
  - Adds index fallback for redwoods, so it still lights when viewMask metadata is missing.
  - Keeps the identity: redwoods behave as giant pixels, not 18 disconnected PARs.
  - Adds a visible base on all non-redwood pixels, so the pattern cannot collapse to black.

  Creative direction:
  - A molten chase rolls through the three redwood giants.
  - Each tree has a soft core, neighbor halo, and trailing memory.
  - The 6 PARs inside each tree get subtle internal swirl so the trees feel alive.
  - Vintage / walls mirror the chase as a low atmospheric wave.
  - RGB stays in strict cp1 <-> cp2 interpolation.
  - White / amber are derived as accents only.

  Controls:
  - localSpeed: speed trim.
  - chaseGlow: dim giant pixels -> bright molten grove.
  - sweepWidth: tight active core -> wide soft halo.
  - trail: clean chase -> long glowing memory.
  - blackoutDepth: steady ambient -> dramatic dark gaps.
*/

var MASK_REDWOOD_PARS = 64;
var MASK_VINTAGE_ONLY = 128;

var REDWOOD_START = 204;
var REDWOOD_END = 221;
var REDWOOD_COUNT = 18;
var PARS_PER_TREE = 6;
var TREE_COUNT = 3;

export var localSpeed = 0.5;
export var chaseGlow = 0.74;
export var sweepWidth = 0.42;
export var trail = 0.58;
export var blackoutDepth = 0.38;

export var cp1H = 0.05, cp1S = 1.0, cp1V = 1.0;
export var cp2H = 0.55, cp2S = 1.0, cp2V = 0.95;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderChaseGlow(v) { chaseGlow = v; }
export function sliderSweepWidth(v) { sweepWidth = v; }
export function sliderTrail(v) { trail = v; }
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

function clamp01(valClamp) {
  if (valClamp < 0.0) return 0.0;
  if (valClamp > 1.0) return 1.0;
  return valClamp;
}

function wrap01(valWrap) {
  valWrap = valWrap % 1.0;
  if (valWrap < 0.0) valWrap += 1.0;
  return valWrap;
}

function circDist(posA, posB) {
  var distC = abs(posA - posB);
  if (distC > 0.5) distC = 1.0 - distC;
  return distC;
}

function smoothstep01(valSmooth) {
  valSmooth = clamp01(valSmooth);
  return valSmooth * valSmooth * (3.0 - 2.0 * valSmooth);
}

function softPulse(distPulse, widthPulse) {
  var pulseX = clamp01(1.0 - distPulse / widthPulse);
  return smoothstep01(pulseX);
}

function tri01(valTri) {
  valTri = wrap01(valTri);
  if (valTri < 0.5) return valTri * 2.0;
  return 2.0 - valTri * 2.0;
}

function hash01(valHash) {
  var hashV = sin(valHash * 12.9898) * 43758.5453;
  return hashV - floor(hashV);
}

function pingPongTreePosition(valPing) {
  return tri01(valPing) * (TREE_COUNT - 1.0);
}

var GOLDEN = 0.6180339;
var SQRT2 = 1.4142136;

var tChase = 0.0;
var tTrail = 0.0;
var tSwirl = 0.0;
var tBreath = 0.0;
var tColor = 0.0;
var tSpark = 0.0;

export function beforeRender(delta) {
  var localMult = pow(2.0, (localSpeed - 0.5) * 5.4);
  var dt = (delta / 1000.0) * localMult;

  // Faster and always alive, but not twitchy.
  tChase  = wrap01(tChase  + dt * (0.070 + chaseGlow * 0.160));
  tTrail  = wrap01(tTrail  + dt * (0.035 + trail * 0.110));
  tSwirl  = wrap01(tSwirl  + dt * (0.105 + sweepWidth * 0.250));
  tBreath = wrap01(tBreath + dt * (0.030 + chaseGlow * 0.060));
  tColor  = wrap01(tColor  + dt * (0.018 + chaseGlow * 0.045));
  tSpark  = wrap01(tSpark  + dt * (0.45 + chaseGlow * 1.20));

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

  var colorMix = 0.0;
  var brightness = 0.0;

  if (isRedwood) {
    var localIdx = index - REDWOOD_START;
    if (localIdx < 0 || localIdx >= REDWOOD_COUNT) localIdx = index % REDWOOD_COUNT;

    var treeId = floor(localIdx / PARS_PER_TREE);
    if (treeId < 0) treeId = 0;
    if (treeId > 2) treeId = 2;

    var parId = localIdx % PARS_PER_TREE;
    if (parId < 0) parId = parId + PARS_PER_TREE;
    var parAngle = parId / PARS_PER_TREE;

    // Giant-pixel chase body: one tree blooms, neighbors hold halos.
    var headTree = pingPongTreePosition(tChase);
    var distTree = abs(treeId - headTree);
    var activeCore = softPulse(distTree, 0.34 + sweepWidth * 0.72);

    // Long molten memory behind the head.
    var trailTreeA = pingPongTreePosition(wrap01(tChase - 0.16 - trail * 0.10));
    var trailTreeB = pingPongTreePosition(wrap01(tChase - 0.33 - trail * 0.12));
    var distTrailA = abs(treeId - trailTreeA);
    var distTrailB = abs(treeId - trailTreeB);
    var trailA = softPulse(distTrailA, 0.52 + trail * 0.80) * (0.24 + trail * 0.34);
    var trailB = softPulse(distTrailB, 0.72 + trail * 1.05) * trail * 0.26;

    // Internal 6-PAR swirl so the giant pixels still breathe like physical trees.
    var swirlHead = wrap01(tSwirl + treeId * GOLDEN + tChase * 0.10);
    var swirlOpp = wrap01(1.0 - tSwirl * SQRT2 + treeId * 0.271 + tTrail * 0.07);
    var swirlA = softPulse(circDist(parAngle, swirlHead), 0.110 + sweepWidth * 0.130);
    var swirlB = softPulse(circDist(parAngle, swirlOpp), 0.080 + sweepWidth * 0.090) * 0.42;
    var swirlTail = softPulse(circDist(parAngle, wrap01(swirlHead - 0.18)), 0.220 + trail * 0.160) * 0.30;

    // Living floor so inactive trees are not dead black.
    var breath = pow(wave(tBreath + treeId * GOLDEN + parAngle * 0.19), 1.65);
    var floorGlow = (1.0 - blackoutDepth) * (0.040 + chaseGlow * 0.075);
    var neighborHalo = clamp01(trailA + trailB + breath * 0.12);
    var livingBody = clamp01(activeCore + neighborHalo + (swirlA + swirlB + swirlTail) * (0.22 + sweepWidth * 0.28));

    // Dramatic dark cuts, but never kill the active giant pixel.
    var shadow = pow(wave(parAngle * 2.0 - tTrail + treeId * 0.217), 2.1 + blackoutDepth * 4.2);
    brightness = floorGlow + livingBody * (0.28 + chaseGlow * 0.72);
    brightness = brightness * (1.0 - shadow * blackoutDepth * (0.22 + 0.40 * (1.0 - activeCore)));
    brightness = clamp01(brightness);

    // Color: each giant tree has an identity, but the moving head carries a color wave.
    var treeMix = treeId / (TREE_COUNT - 1.0);
    var ringMix = wave(tColor + parAngle * (0.65 + sweepWidth) + treeId * 0.19);
    var headMix = wave(tColor * 0.7 + activeCore * 0.35 + swirlHead * 0.27);
    colorMix = clamp01(0.44 * treeMix + 0.28 * ringMix + 0.28 * headMix);
    colorMix = clamp01(colorMix + activeCore * 0.12 - shadow * blackoutDepth * 0.08);

    // Palette-locked glints on the active giant pixel.
    var sparkSeed = hash01(index * 19.37 + floor(tSpark * 11.0) + treeId * 4.3);
    var glint = 0.0;
    if (sparkSeed > 0.955) {
      glint = (sparkSeed - 0.955) * 22.22 * chaseGlow * activeCore;
    }
    brightness = clamp01(brightness + glint * 0.18);
    colorMix = clamp01(colorMix + glint * 0.12);

    // Derived physical accents.
    ww = clamp01(activeCore * glint * 0.08 + activeCore * chaseGlow * 0.025);
    aa = clamp01(activeCore * chaseGlow * 0.045 + trailA * 0.025);

  } else if (isVintage) {
    // Soft cabin/vintage echo, visible but supportive.
    var vintageSweep = wave(x * 0.82 - tChase + z * 0.13);
    var vintageBreath = pow(wave(tBreath + index * 0.019), 1.9);
    var vintageShadow = pow(wave(x * 1.6 + tTrail + index * 0.007), 2.4 + blackoutDepth * 3.0);

    brightness = 0.035 + chaseGlow * (0.090 * vintageBreath + 0.150 * vintageSweep);
    brightness = brightness * (1.0 - vintageShadow * blackoutDepth * 0.32);
    brightness = clamp01(brightness);

    colorMix = clamp01(0.20 + 0.60 * vintageSweep + 0.20 * wave(tColor + index * 0.013));
    aa = clamp01(chaseGlow * vintageBreath * 0.035);

  } else {
    // Everything else gets a low sweeping atmosphere so the pattern is never black.
    var headPos = tChase;
    var distHead = circDist(x, headPos);
    var headGlow = softPulse(distHead, 0.24 + sweepWidth * 0.30);
    var atmosphere = pow(wave(tTrail + x * 0.31 + z * 0.23), 1.8);
    var shadow2 = pow(wave(x * 1.7 - tTrail + z * 0.41), 2.0 + blackoutDepth * 3.6);

    brightness = (1.0 - blackoutDepth) * 0.035
               + chaseGlow * (headGlow * 0.180 + atmosphere * 0.065);
    brightness = brightness * (1.0 - shadow2 * blackoutDepth * 0.38);
    brightness = clamp01(brightness);

    colorMix = clamp01(0.42 * wave(tColor + x * 0.45 + z * 0.11)
                     + 0.38 * headGlow
                     + 0.20 * atmosphere);
    aa = clamp01(headGlow * chaseGlow * 0.025);
  }

  rr = (pr1 + (pr2 - pr1) * colorMix) * brightness;
  gg = (pg1 + (pg2 - pg1) * colorMix) * brightness;
  bb = (pb1 + (pb2 - pb1) * colorMix) * brightness;

  rgbwau(clamp01(rr), clamp01(gg), clamp01(bb), clamp01(ww), clamp01(aa), clamp01(uu));
}
