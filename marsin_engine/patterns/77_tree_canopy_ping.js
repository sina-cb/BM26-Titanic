/*
  tree_canopy_ping — organic crown ripple

  Rewritten for Pattern Optimization Rules:
  - localSpeed is the first exported parameter.
  - sliderLocalSpeed is the first slider function.
  - Only four extra performance controls.
  - RGB stays in strict cp1 <-> cp2 interpolation.
  - White / amber / UV are derived internally as accents.

  Distinct idea:
  - Not a lockdown scanner.
  - Not a simple stripe moving on z.
  - This is a living canopy ping: seed pulses jump between the 3 trees,
    then bloom into circular ripples through the 6 PARs around each crown.
  - Several non-matching clocks keep the movement organic and less repetitive.

  Controls:
  - localSpeed: motion speed trim.
  - pingGlow: dim canopy pulses -> bright living crown pings.
  - rippleWidth: tight seed points -> wide soft canopy blooms.
  - crownImpact: soft glow -> white crown hits and RGB glints.
  - trailDepth: short clean pings -> long ghost trails and deeper shadows.
*/

var MASK_REDWOOD_PARS = 64;

var REDWOOD_START = 204;
var REDWOOD_END = 221;
var REDWOOD_COUNT = 18;
var PARS_PER_TREE = 6;
var TREE_COUNT = 3;

export var localSpeed = 0.5;
export var pingGlow = 0.76;
export var rippleWidth = 0.42;
export var crownImpact = 0.46;
export var trailDepth = 0.58;

export var cp1H = 0.0, cp1S = 1.0, cp1V = 1.0;
export var cp2H = 0.08, cp2S = 1.0, cp2V = 1.0;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderPingGlow(v) { pingGlow = v; }
export function sliderRippleWidth(v) { rippleWidth = v; }
export function sliderCrownImpact(v) { crownImpact = v; }
export function sliderTrailDepth(v) { trailDepth = v; }

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

var tSeed = 0.0;
var tBloom = 0.0;
var tTrail = 0.0;
var tCrown = 0.0;
var tColor = 0.0;
var tSpark = 0.0;

export function beforeRender(delta) {
  var localMult = pow(2.0, (localSpeed - 0.5) * 5.4);
  var dt = (delta / 1000.0) * localMult;

  // Non-matching rates: organic and less obviously looped.
  tSeed  = wrap01(tSeed  + dt * (0.060 + pingGlow * 0.150));
  tBloom = wrap01(tBloom + dt * (0.085 + rippleWidth * 0.260));
  tTrail = wrap01(tTrail + dt * (0.035 + trailDepth * 0.115));
  tCrown = wrap01(tCrown + dt * (0.080 + crownImpact * 0.340));
  tColor = wrap01(tColor + dt * (0.018 + pingGlow * 0.055));
  tSpark = wrap01(tSpark + dt * (0.42 + crownImpact * 2.20));

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

  if (isRedwood) {
    var local = index - REDWOOD_START;
    if (local < 0 || local >= REDWOOD_COUNT) local = index % REDWOOD_COUNT;

    var treeId = floor(local / PARS_PER_TREE);
    if (treeId < 0) treeId = 0;
    if (treeId > 2) treeId = 2;

    var parId = local % PARS_PER_TREE;
    if (parId < 0) parId = parId + PARS_PER_TREE;
    var parAngle = parId / PARS_PER_TREE;

    // Three living seed pulses move through the grove, but not as identical bands.
    var seedA = pingPongTreePosition(tSeed);
    var seedB = pingPongTreePosition(wrap01(tSeed + 0.347 + tTrail * 0.043));
    var seedC = pingPongTreePosition(wrap01(tSeed + 0.681 - tBloom * 0.031));

    var dA = abs(treeId - seedA);
    var dB = abs(treeId - seedB);
    var dC = abs(treeId - seedC);

    var treeA = exp(-(dA * dA) / (0.28 + rippleWidth * 0.58));
    var treeB = exp(-(dB * dB) / (0.34 + rippleWidth * 0.72)) * 0.72;
    var treeC = exp(-(dC * dC) / (0.42 + trailDepth * 0.82)) * 0.52;

    // Each seed blooms into the 6-PAR ring with a different angular behavior.
    var headA = wrap01(tBloom + treeId * GOLDEN + seedA * 0.071);
    var headB = wrap01(1.0 - tBloom * SQRT2 + treeId * 0.271 + seedB * 0.059);
    var headC = wrap01(tTrail + treeId * 0.193 + seedC * 0.083);

    var widthA = 0.065 + rippleWidth * 0.185;
    var widthB = 0.050 + rippleWidth * 0.135;
    var widthC = 0.115 + trailDepth * 0.255;

    var ringA = softPulse(circDist(parAngle, headA), widthA);
    var ringATrail = softPulse(circDist(parAngle, wrap01(headA - 0.19)), widthC) * 0.42;
    var ringB = softPulse(circDist(parAngle, headB), widthB) * (0.34 + crownImpact * 0.38);
    var ringC = softPulse(circDist(parAngle, headC), widthC) * (0.18 + trailDepth * 0.42);

    // Organic canopy texture. This prevents the ping from reading as a repeated stripe.
    var leafA = pow(wave(parAngle * 2.0 + tTrail + treeId * 0.137), 2.1);
    var leafB = pow(wave(parAngle * 3.0 - tBloom * 0.61 + treeId * 0.311), 3.8);
    var leafLife = clamp01(leafA * 0.22 + leafB * 0.28 * trailDepth);

    // Crown hit: brightest when a seed reaches an outer/end tree and a ring current is active.
    var endTree = 0.0;
    if (treeId == 0) endTree = 1.0;
    if (treeId == 2) endTree = 1.0;
    var crownWindow = pow(wave(tCrown + treeId * 0.173), 8.0 + crownImpact * 5.0);
    var crownHit = crownWindow * endTree * crownImpact * clamp01(treeA + treeB + ringA + ringB);

    // Ghost trail behind the living ping.
    var trailWave = pow(wave(tTrail * 0.73 + treeId * GOLDEN + parAngle * 0.37), 1.7);
    var ghostTrail = trailDepth * trailWave * clamp01(treeC + ringC + ringATrail);

    var pingBody = clamp01(treeA * ringA + treeB * ringB + treeC * ringC + ringATrail + leafLife);
    var living = clamp01(pingBody * (0.54 + pingGlow * 0.74) + ghostTrail * 0.54 + crownHit * 0.42);

    // Dark gaps make the motion readable and less like a constant wash.
    var shadowVein = pow(wave(parAngle * 2.0 - tTrail + treeId * 0.21), 2.2 + trailDepth * 4.8);
    var floorGlow = (1.0 - trailDepth) * (0.018 + pingGlow * 0.055);
    var brightness = floorGlow + living * (0.30 + pingGlow * 0.78);
    var carve = 1.0 - shadowVein * trailDepth * (0.25 + 0.55 * (1.0 - living));
    brightness = clamp01(brightness * carve);

    // Creative color, still strict cp1 <-> cp2.
    // A is younger/brighter, B is counter-current, C is trailing memory.
    var treeMix = treeId / (TREE_COUNT - 1.0);
    var ringMix = wave(tColor + parAngle * (0.70 + rippleWidth) + treeId * 0.193);
    var seedMix = clamp01(treeA * 0.18 + treeB * 0.55 + treeC * 0.82);
    var currentMix = wave(tColor * 0.73 + headA * 0.35 + headB * 0.27 + living * 0.21);

    var colorMix = clamp01(0.25 * treeMix + 0.27 * ringMix + 0.28 * seedMix + 0.20 * currentMix);

    // Impact pushes toward cp2; shadow veins pull toward cp1.
    colorMix = clamp01(colorMix + crownHit * 0.22 - shadowVein * trailDepth * 0.13);

    // Palette-locked firefly sparkles, not white wash.
    var sparkSeed = hash01(index * 17.31 + floor(tSpark * 19.0) + treeId * 4.7);
    var spark = 0.0;
    if (sparkSeed > 0.948) {
      spark = (sparkSeed - 0.948) * 19.23 * crownImpact * (0.25 + living * 0.75);
    }
    brightness = clamp01(brightness + spark * 0.20);
    colorMix = clamp01(colorMix + spark * 0.18);

    rr = (pr1 + (pr2 - pr1) * colorMix) * brightness;
    gg = (pg1 + (pg2 - pg1) * colorMix) * brightness;
    bb = (pb1 + (pb2 - pb1) * colorMix) * brightness;

    // Derived physical accents: keep palette readable.
    ww = clamp01(crownHit * 0.32 + spark * 0.10);
    aa = clamp01(crownImpact * ghostTrail * 0.045);
    uu = clamp01(trailDepth * shadowVein * 0.070 + ghostTrail * 0.060);
  }

  rgbwau(clamp01(rr), clamp01(gg), clamp01(bb), clamp01(ww), clamp01(aa), clamp01(uu));
}
