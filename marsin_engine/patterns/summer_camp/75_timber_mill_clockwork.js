/*
  pattern_75_timber_mill_clockwork_optimized

  Creative direction:
    - Tower/bars become rotating mill gears with moving teeth.
    - Vintage bulbs become sharp mechanical tick lamps.
    - Redwoods become three giant pulley wheels, each with a rotating 6-PAR chase.
    - Stronger negative space so the motion reads from far away.
    - RGB is strict cp1 <-> cp2. W/A/UV are physical accents only.
*/

var MASK_REDWOOD_PARS = 64;
var MASK_VINTAGE_ONLY = 128;

export var localSpeed = 0.5;
export var gearDrive = 0.62;
export var toothWidth = 0.38;
export var boilerHeat = 0.55;
export var sparkImpact = 0.35;
export var blackoutDepth = 0.42;

export var cp1H = 0.08;
export var cp1S = 1.0;
export var cp1V = 1.0;
export var cp2H = 0.02;
export var cp2S = 1.0;
export var cp2V = 1.0;

export function colorPalette1(h, s, v) {
  cp1H = h;
  cp1S = s;
  cp1V = v;
}

export function colorPalette2(h, s, v) {
  cp2H = h;
  cp2S = s;
  cp2V = v;
}

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderGearDrive(v) { gearDrive = v; }
export function sliderToothWidth(v) { toothWidth = v; }
export function sliderBoilerHeat(v) { boilerHeat = v; }
export function sliderSparkImpact(v) { sparkImpact = v; }
export function sliderBlackoutDepth(v) { blackoutDepth = v; }

var pr1 = 1.0;
var pg1 = 0.0;
var pb1 = 0.0;
var pr2 = 0.0;
var pg2 = 0.0;
var pb2 = 1.0;

var pGear = 0.0;
var pTick = 0.0;
var pBelt = 0.0;
var pSpark = 0.0;
var pShadow = 0.0;

function clamp01(v) {
  if (v < 0.0) return 0.0;
  if (v > 1.0) return 1.0;
  return v;
}

function softShape(v) {
  var sv = clamp01(v);
  return sv * sv * (3.0 - 2.0 * sv);
}

function _hsv2rgb1() {
  var hv = cp1H - floor(cp1H);
  if (hv < 0.0) hv += 1.0;

  var iv = floor(hv * 6.0) % 6;
  var fv = hv * 6.0 - floor(hv * 6.0);
  var pv = cp1V * (1.0 - cp1S);
  var qv = cp1V * (1.0 - fv * cp1S);
  var tv = cp1V * (1.0 - (1.0 - fv) * cp1S);

  if (iv == 0) {
    pr1 = cp1V; pg1 = tv; pb1 = pv;
  } else if (iv == 1) {
    pr1 = qv; pg1 = cp1V; pb1 = pv;
  } else if (iv == 2) {
    pr1 = pv; pg1 = cp1V; pb1 = tv;
  } else if (iv == 3) {
    pr1 = pv; pg1 = qv; pb1 = cp1V;
  } else if (iv == 4) {
    pr1 = tv; pg1 = pv; pb1 = cp1V;
  } else {
    pr1 = cp1V; pg1 = pv; pb1 = qv;
  }
}

function _hsv2rgb2() {
  var hv = cp2H - floor(cp2H);
  if (hv < 0.0) hv += 1.0;

  var iv = floor(hv * 6.0) % 6;
  var fv = hv * 6.0 - floor(hv * 6.0);
  var pv = cp2V * (1.0 - cp2S);
  var qv = cp2V * (1.0 - fv * cp2S);
  var tv = cp2V * (1.0 - (1.0 - fv) * cp2S);

  if (iv == 0) {
    pr2 = cp2V; pg2 = tv; pb2 = pv;
  } else if (iv == 1) {
    pr2 = qv; pg2 = cp2V; pb2 = pv;
  } else if (iv == 2) {
    pr2 = pv; pg2 = cp2V; pb2 = tv;
  } else if (iv == 3) {
    pr2 = pv; pg2 = qv; pb2 = cp2V;
  } else if (iv == 4) {
    pr2 = tv; pg2 = pv; pb2 = cp2V;
  } else {
    pr2 = cp2V; pg2 = pv; pb2 = qv;
  }
}

function paletteR(mixAmount) {
  return pr1 + (pr2 - pr1) * clamp01(mixAmount);
}

function paletteG(mixAmount) {
  return pg1 + (pg2 - pg1) * clamp01(mixAmount);
}

function paletteB(mixAmount) {
  return pb1 + (pb2 - pb1) * clamp01(mixAmount);
}

export function beforeRender(delta) {
  _hsv2rgb1();
  _hsv2rgb2();

  var spd = clamp01(localSpeed);
  var drv = clamp01(gearDrive);

  var scaleGear = 0.38 - spd * 0.2763 - drv * 0.08;
  if (scaleGear < 0.055) scaleGear = 0.055;

  var scaleTick = 0.18 - spd * 0.1281 - drv * 0.045;
  if (scaleTick < 0.028) scaleTick = 0.028;

  var scaleBelt = 0.28 - spd * 0.2059;
  if (scaleBelt < 0.05) scaleBelt = 0.05;

  var scaleSpark = 0.065 - spd * 0.0487;
  if (scaleSpark < 0.018) scaleSpark = 0.018;

  pGear = time(scaleGear);
  pTick = time(scaleTick);
  pBelt = time(scaleBelt);
  pSpark = time(scaleSpark);
  pShadow = time(0.70 - spd * 0.4926);
}

export function render(index, x, y, z) {
  var nx = x;
  var ny = y;
  var nz = z;

  if (nx > 1.5) nx = nx / 33.0;
  if (ny > 1.5) ny = ny / 3.5;
  if (nz > 1.5) nz = nz / 24.0;

  nx = clamp01(nx);
  ny = clamp01(ny);
  nz = clamp01(nz);

  var isRedwood = (viewMask & MASK_REDWOOD_PARS) != 0;
  var isVintage = (viewMask & MASK_VINTAGE_ONLY) != 0;

  // Fallback for preview/model surfaces without view masks.
  if (!isRedwood && !isVintage) {
    if (z > 15.0 || nz > 0.62) {
      isRedwood = 1.0;
    }
  }

  var red = 0.0;
  var grn = 0.0;
  var blu = 0.0;
  var wht = 0.0;
  var amb = 0.0;
  var uvv = 0.0;

  // Shared mechanical tick envelope.
  var tickRaw = pTick * 16.0;
  var tickStep = floor(tickRaw);
  var tickFrac = tickRaw - tickStep;
  var tickEnv = pow(1.0 - tickFrac, 4.0);

  // Moving blackout shutter: makes the pattern punchier and less "always on".
  var shutter = wave(pShadow + nx * 0.72 - nz * 0.38);
  var darkCut = 1.0 - blackoutDepth * smoothstep(0.30, 0.92, shutter);

  if (isRedwood) {
    /*
      Redwoods = 3 giant pulley wheels.
      Each tree has a rotating six-PAR chase, plus a larger group pulse.
    */

    var tree = floor(nx * 3.0);
    if (tree > 2.0) tree = 2.0;

    var slot = index % 6.0;
    var treeOffset = tree * (0.21 + gearDrive * 0.19);

    var pulleyPos = (pGear * (6.0 + gearDrive * 14.0) + tree * 2.0) % 6.0;

    var slotDist = slot - pulleyPos;
    if (slotDist < -3.0) slotDist += 6.0;
    if (slotDist >  3.0) slotDist -= 6.0;

    var ringWidth = 0.28 + toothWidth * 1.65;
    var ringTooth = exp(-(slotDist * slotDist) / (2.0 * ringWidth * ringWidth));

    // Larger tree-scale clutch pulse, offset for each redwood.
    var clutch = wave(pBelt + treeOffset + nz * 0.19);
    clutch = softShape(clutch);

    // Belt stripe running through each tree, gives visible internal motion.
    var beltStripe = wave(
      pBelt * 2.0 +
      slot * 0.17 +
      treeOffset +
      nz * (0.28 + gearDrive * 0.48)
    );
    beltStripe = smoothstep(0.62, 0.98, beltStripe);

    var pulleyLit = ringTooth * (0.55 + 0.45 * clutch);
    var treeLit = max(pulleyLit, beltStripe * 0.42);
    treeLit = clamp01((0.08 + treeLit * 0.92) * darkCut);

    // Palette is not flat: slot + motion + tooth change the cp1/cp2 mix.
    var treeMix = clamp01(
      slot / 5.0 * 0.48 +
      ringTooth * 0.32 +
      clutch * 0.20
    );

    red = paletteR(treeMix) * treeLit;
    grn = paletteG(treeMix) * treeLit;
    blu = paletteB(treeMix) * treeLit;

    // UV sits in the pulley shadow, not full-time wash.
    uvv = (0.10 + 0.42 * (1.0 - ringTooth)) * clutch;
    uvv = uvv * (0.25 + gearDrive * 0.55);

    // White on the mechanical tooth edge.
    var edgeFlash = smoothstep(0.82, 0.99, ringTooth);
    wht = sparkImpact * edgeFlash * tickEnv * 0.55;

  } else if (isVintage) {
    /*
      Vintage = ticking boiler gauges.
      Sharp cp1/cp2 alternating ticks with warm amber body.
    */

    var alt = tickStep % 2.0;
    var tickMix = 0.0;
    if (alt >= 1.0) tickMix = 1.0;

    var localTick = wave(pTick * 4.0 + index * 0.173);
    var tickBody = clamp01((0.18 + 0.82 * tickEnv) * (0.65 + 0.35 * localTick));

    var vintageLevel = boilerHeat * tickBody;

    red = paletteR(tickMix) * vintageLevel * 0.62;
    grn = paletteG(tickMix) * vintageLevel * 0.62;
    blu = paletteB(tickMix) * vintageLevel * 0.62;

    // Amber is the boiler filament, but kept controlled for RGB fallback.
    amb = boilerHeat * (0.10 + 0.38 * tickBody);

    var sparkGate = smoothstep(
      0.955 - sparkImpact * 0.060,
      0.998,
      wave(pSpark * 8.0 + index * 0.317)
    );

    wht = sparkImpact * sparkGate * tickEnv * 0.75;

  } else {
    /*
      Tower/bars/walls = clockwork gear field.
      Rotating gear teeth + diagonal mill belt.
    */

    var barSlot = index % 18.0;

    var gearPos = (pGear * (18.0 + gearDrive * 34.0)) % 18.0;

    var gearDist = barSlot - gearPos;
    if (gearDist < -9.0) gearDist += 18.0;
    if (gearDist >  9.0) gearDist -= 18.0;

    var gearPosOpp = gearPos + 9.0;
    if (gearPosOpp >= 18.0) gearPosOpp -= 18.0;

    var gearDistOpp = barSlot - gearPosOpp;
    if (gearDistOpp < -9.0) gearDistOpp += 18.0;
    if (gearDistOpp >  9.0) gearDistOpp -= 18.0;

    var towerWidth = 0.55 + toothWidth * 3.20;

    var toothA = exp(-(gearDist * gearDist) / (2.0 * towerWidth * towerWidth));
    var toothB = exp(-(gearDistOpp * gearDistOpp) / (2.0 * towerWidth * towerWidth));

    var gearTooth = max(toothA, toothB * 0.72);

    // Diagonal belt across tower/wall so motion is not just index chasing.
    var belt = wave(
      pBelt * (1.4 + gearDrive * 1.8) +
      nx * (0.75 + gearDrive * 0.8) -
      nz * 0.34 +
      ny * 0.23
    );
    belt = smoothstep(0.56, 0.96, belt);

    var toothEdge = smoothstep(0.68, 0.98, gearTooth);
    var gearBody = clamp01((gearTooth * 0.88 + belt * 0.26) * darkCut);

    // Palette crawls around the gear, not hardcoded cp2.
    var gearMix = clamp01(
      0.12 +
      0.52 * wave(pGear * 0.7 + nx * 0.55 + nz * 0.21) +
      0.36 * toothEdge
    );

    red = paletteR(gearMix) * gearBody;
    grn = paletteG(gearMix) * gearBody;
    blu = paletteB(gearMix) * gearBody;

    // Boiler heat behind the teeth.
    amb = boilerHeat * belt * 0.16;

    // Impact glints on tooth edges.
    wht = sparkImpact * toothEdge * tickEnv * 0.42;
  }

  rgbwau(
    clamp01(red),
    clamp01(grn),
    clamp01(blu),
    clamp01(wht),
    clamp01(amb),
    clamp01(uvv)
  );
}