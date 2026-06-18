/*
  76_outpost_lockdown — organic lockdown currents

  Rewritten for Pattern Optimization Rules:
  - localSpeed is the first exported parameter.
  - sliderLocalSpeed is the first slider function.
  - Only four extra performance controls.
  - RGB stays in strict cp1 <-> cp2 interpolation.
  - White / amber / UV are derived internally and kept as accents.

  Creative direction:
  - Not a repetitive alarm scanner.
  - The outpost feels like a living mechanical organism locking itself down.
  - Tower bars draw breathing containment ribs.
  - Redwoods receive organic warning currents through the 3 trees x 6 PAR geometry.
  - Vintage lamps flicker like nervous cabin instruments.
  - Motion uses several non-matching clocks and organic fields to avoid obvious loops.

  Controls:
  - localSpeed: motion speed trim.
  - lockdownPressure: calm patrol -> intense lockdown energy.
  - sweepWidth: thin laser ribs -> wide containment sheets.
  - impact: soft warning -> white-hot impact flashes and filament hits.
  - blackoutDepth: glowing atmosphere -> carved dark negative space.
*/

var MASK_REDWOOD_PARS = 64;
var MASK_VINTAGE_ONLY = 128;

var REDWOOD_START = 204;
var REDWOOD_END = 221;
var REDWOOD_COUNT = 18;
var PARS_PER_TREE = 6;
var TREE_COUNT = 3;

export var localSpeed = 0.5;
export var lockdownPressure = 0.68;
export var sweepWidth = 0.38;
export var impact = 0.48;
export var blackoutDepth = 0.58;

export var cp1H = 0.60, cp1S = 1.0, cp1V = 1.0;
export var cp2H = 0.88, cp2S = 1.0, cp2V = 1.0;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderLockdownPressure(v) { lockdownPressure = v; }
export function sliderSweepWidth(v) { sweepWidth = v; }
export function sliderImpact(v) { impact = v; }
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

var tGate = 0.0;
var tCrawl = 0.0;
var tPulse = 0.0;
var tShadow = 0.0;
var tColor = 0.0;
var tSpark = 0.0;

export function beforeRender(delta) {
  var localMult = pow(2.0, (localSpeed - 0.5) * 5.4);
  var dt = (delta / 1000.0) * localMult;

  // Non-matching clocks: organic, less repetitive, still controllable.
  tGate   = wrap01(tGate   + dt * (0.055 + lockdownPressure * 0.180));
  tCrawl  = wrap01(tCrawl  + dt * (0.035 + lockdownPressure * 0.120 + sweepWidth * 0.070));
  tPulse  = wrap01(tPulse  + dt * (0.090 + impact * 0.260));
  tShadow = wrap01(tShadow + dt * (0.026 + blackoutDepth * 0.135 + lockdownPressure * 0.035));
  tColor  = wrap01(tColor  + dt * (0.018 + lockdownPressure * 0.048));
  tSpark  = wrap01(tSpark  + dt * (0.55 + impact * 2.50));

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
  var widthv = 0.030 + sweepWidth * 0.260;

  if (isRedwood) {
    var local = index - REDWOOD_START;
    if (local < 0 || local >= REDWOOD_COUNT) local = index % REDWOOD_COUNT;

    var treeId = floor(local / PARS_PER_TREE);
    if (treeId < 0) treeId = 0;
    if (treeId > 2) treeId = 2;

    var parId = local % PARS_PER_TREE;
    if (parId < 0) parId = parId + PARS_PER_TREE;
    var parAngle = parId / PARS_PER_TREE;

    // Grove lockdown current travels through the 3-tree canopy.
    var activeTree = pingPongTreePosition(tGate);
    var dTree = abs(treeId - activeTree);
    var groveCore = exp(-(dTree * dTree) / (0.34 + sweepWidth * 0.75));

    var trailTree = pingPongTreePosition(wrap01(tGate - 0.18));
    var dTrail = abs(treeId - trailTree);
    var groveTrail = exp(-(dTrail * dTrail) / 1.10) * 0.38 * lockdownPressure;

    // Counter-rotating organic currents around the 6 PAR ring.
    var headA = wrap01(tCrawl + treeId * GOLDEN + tGate * 0.08);
    var headB = wrap01(1.0 - tCrawl * SQRT2 + treeId * 0.271 + tShadow * 0.10);
    var currentA = softPulse(circDist(parAngle, headA), widthv * 0.72 + 0.060);
    var currentB = softPulse(circDist(parAngle, headB), widthv * 0.50 + 0.045) * (0.28 + lockdownPressure * 0.34);
    var currentTrail = softPulse(circDist(parAngle, wrap01(headA - 0.21)), widthv * 0.95 + 0.055) * 0.35;

    // Branch-like organic shimmer locked to the PAR circle.
    var leaf1 = pow(wave(parAngle * 2.0 + tCrawl * 0.67 + treeId * 0.13), 2.70);
    var leaf2 = pow(wave(parAngle * 3.0 - tShadow * 0.91 + treeId * 0.31), 4.30) * lockdownPressure;
    var leafMotion = clamp01(leaf1 * 0.25 + leaf2 * 0.30);

    // Moving darkness blades carve the canopy.
    var shadowA = pow(wave(parAngle * 2.0 - tShadow + treeId * 0.17), 2.0 + blackoutDepth * 4.8);
    var shadowB = pow(wave(parAngle * 3.0 + tShadow * SQRT2 + treeId * 0.29), 3.0 + blackoutDepth * 3.4);
    var shadowBlade = clamp01(shadowA * 0.60 + shadowB * 0.40);

    var living = clamp01(groveCore + groveTrail + currentA + currentB + currentTrail + leafMotion);
    living = clamp01(living * (0.48 + lockdownPressure * 0.68));

    var floorGlow = (1.0 - blackoutDepth) * (0.018 + lockdownPressure * 0.040);
    brightness = floorGlow + living * (0.25 + lockdownPressure * 0.72);

    var carve = 1.0 - shadowBlade * blackoutDepth * (0.36 + 0.48 * (1.0 - living));
    brightness = clamp01(brightness * carve);

    // Palette movement: tree identity + PAR angle + living current.
    var treeMix = treeId / (TREE_COUNT - 1.0);
    var ringMix = wave(tColor + parAngle * 1.35 + treeId * 0.19);
    var currentMix = wave(tColor * 0.61 + headA * 0.41 + headB * 0.29 + living * 0.24);
    colorMix = clamp01(0.34 * treeMix + 0.36 * ringMix + 0.30 * currentMix);

    // Active warning current leans cp2; shadow retreats toward cp1.
    colorMix = clamp01(colorMix * (1.0 - shadowBlade * 0.28) + living * 0.16);

    // Derived physical channels: accents only.
    var impactBlink = pow(wave(tPulse + treeId * 0.123), 10.0) * impact;
    ww = clamp01(impactBlink * living * 0.34);
    uu = clamp01(blackoutDepth * shadowBlade * 0.10 + currentB * impact * 0.08);
    aa = clamp01(impact * groveCore * 0.06);

  } else if (isVintage) {
    // Nervous cabin instruments: warm accents, but RGB palette carries the actual color.
    var lampLocal = index % 6;
    var lampPos = lampLocal / 5.0;

    var tick = pow(wave(tPulse * 1.35 + lampLocal * 0.137), 5.0 + impact * 5.0);
    var ember = pow(wave(tCrawl * 0.74 + index * 0.031), 2.1);
    var scanner = softPulse(circDist(lampPos, wrap01(tGate + index * 0.013)), widthv + 0.08);

    var jitterSeed = hash01(index * 7.13 + floor(tSpark * 6.0));
    var jitter = 0.82 + jitterSeed * 0.18;

    brightness = clamp01((0.030 + ember * 0.090 + scanner * 0.180 + tick * impact * 0.330) * jitter);
    brightness = brightness * (1.0 - blackoutDepth * 0.24);

    colorMix = clamp01(0.45 * wave(tColor * 0.7 + index * 0.017)
                     + 0.35 * scanner
                     + 0.20 * tick);

    aa = clamp01(impact * (ember * 0.12 + tick * 0.18));
    ww = clamp01(impact * tick * 0.28);

  } else {
    // Tower / wall structure: breathing lockdown ribs with non-repeating color currents.
    var barPix = index % 18;
    var barPos = barPix / 17.0;
    var barId = floor(index / 18.0);

    // Two containment ribs sweep in opposite directions down/up the bar pixels.
    var ribPosA = tri01(tGate + barId * 0.071);
    var ribPosB = tri01(1.0 - tGate * SQRT2 + barId * 0.043);
    var ribA = softPulse(abs(barPos - ribPosA), widthv);
    var ribB = softPulse(abs(barPos - ribPosB), widthv * 0.72 + 0.025) * (0.32 + lockdownPressure * 0.42);

    // Organic crawl across fixture IDs so bars do not all repeat together.
    var crawl = pow(wave(barId * 0.137 + barPos * 0.45 - tCrawl), 2.20);
    var pressureWave = wave(barPos * 2.0 + barId * 0.071 + tPulse * 0.5);
    var structureBreath = crawl * 0.34 + pressureWave * 0.18;

    var shadowRib = pow(wave(barPos * 3.0 - tShadow + barId * 0.091), 2.3 + blackoutDepth * 4.2);

    var ribEnergy = clamp01(ribA + ribB + structureBreath);
    brightness = (1.0 - blackoutDepth) * 0.018 + ribEnergy * (0.28 + lockdownPressure * 0.80);
    brightness = clamp01(brightness * (1.0 - shadowRib * blackoutDepth * 0.62));

    var barMix = wave(tColor + barId * 0.053 + barPos * (0.70 + sweepWidth));
    var ribMix = wave(tColor * 0.7 + ribPosA * 0.31 + ribEnergy * 0.23);
    colorMix = clamp01(0.42 * barMix + 0.35 * ribMix + 0.23 * barPos);

    // White-hot warning line only at the strongest rib/impact intersections.
    var impactHit = pow(wave(tPulse + barId * 0.037), 9.0) * impact;
    ww = clamp01((ribA * 0.24 + ribB * 0.14 + impactHit * 0.35) * impact);
    uu = clamp01(shadowRib * blackoutDepth * 0.055);
    aa = clamp01(crawl * impact * 0.040);
  }

  rr = (pr1 + (pr2 - pr1) * colorMix) * brightness;
  gg = (pg1 + (pg2 - pg1) * colorMix) * brightness;
  bb = (pb1 + (pb2 - pb1) * colorMix) * brightness;

  rgbwau(clamp01(rr), clamp01(gg), clamp01(bb), clamp01(ww), clamp01(aa), clamp01(uu));
}
