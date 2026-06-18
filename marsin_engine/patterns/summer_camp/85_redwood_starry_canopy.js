/*
  pattern_85_redwood_starry_canopy_optimized

  Creative direction:
    - Redwoods become three giant star constellations.
    - Each tree has a rotating 6-PAR star crown + comet trail.
    - Tower/wall gets a high-energy orbital palette sweep.
    - Wall/vintage hits pulse like a triumphant downbeat.
    - Strong negative space keeps stars readable.
    - RGB is strict cp1 <-> cp2. W/A/UV are physical accents only.
*/

var MASK_REDWOOD_PARS = 64;
var MASK_VINTAGE_ONLY = 128;

export var localSpeed = 0.5;
export var starEnergy = 0.72;
export var towerSpin = 0.62;
export var wallHit = 0.48;
export var blackoutDepth = 0.42;

export var cp1H = 0.66;
export var cp1S = 1.0;
export var cp1V = 1.0;
export var cp2H = 0.55;
export var cp2S = 0.6;
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
export function sliderStarEnergy(v) { starEnergy = v; }
export function sliderTowerSpin(v) { towerSpin = v; }
export function sliderWallHit(v) { wallHit = v; }
export function sliderBlackoutDepth(v) { blackoutDepth = v; }

var pr1 = 1.0;
var pg1 = 0.0;
var pb1 = 0.0;
var pr2 = 0.0;
var pg2 = 0.0;
var pb2 = 1.0;

var pCanopy = 0.0;
var pOrbit = 0.0;
var pTower = 0.0;
var pPulse = 0.0;
var pSpark = 0.0;
var pShadow = 0.0;

function clamp01(value) {
  if (value < 0.0) return 0.0;
  if (value > 1.0) return 1.0;
  return value;
}

function softShape(value) {
  var shaped = clamp01(value);
  return shaped * shaped * (3.0 - 2.0 * shaped);
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

function ringDist(slotValue, posValue) {
  var diff = slotValue - posValue;
  if (diff < -3.0) diff += 6.0;
  if (diff > 3.0) diff -= 6.0;
  return abs(diff);
}

export function beforeRender(delta) {
  _hsv2rgb1();
  _hsv2rgb2();

  var spd = clamp01(localSpeed);

  // Speed-widen: top-end scaled ~1.35x faster (floors lowered, slopes steepened).
  var canopyScale = 0.42 - spd * 0.378;
  if (canopyScale < 0.0444) canopyScale = 0.0444;

  var orbitScale = 0.22 - spd * 0.1958;
  if (orbitScale < 0.0281) orbitScale = 0.0281;

  var towerScale = 0.18 - spd * 0.1620;
  if (towerScale < 0.0237) towerScale = 0.0237;

  var pulseScale = 0.135 - spd * 0.1148;
  if (pulseScale < 0.0222) pulseScale = 0.0222;

  var sparkScale = 0.052 - spd * 0.0459;
  if (sparkScale < 0.0133) sparkScale = 0.0133;

  pCanopy = time(canopyScale);
  pOrbit = time(orbitScale);
  pTower = time(towerScale);
  pPulse = time(pulseScale);
  pSpark = time(sparkScale);
  pShadow = time(0.74 - spd * 0.5178);
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
  var white = 0.0;
  var amber = 0.0;
  var uvv = 0.0;

  // Rhythmic darkness so the climax breathes instead of staying full-on.
  var shadowWave = wave(pShadow + nx * 0.63 - nz * 0.41 + ny * 0.17);
  var darkCut = 1.0 - blackoutDepth * smoothstep(0.35, 0.94, shadowWave);

  // Downbeat-ish pulse, used differently per fixture group.
  var pulseRaw = pPulse * 8.0;
  var pulseFrac = pulseRaw - floor(pulseRaw);
  var pulseHit = pow(1.0 - pulseFrac, 5.0);

  if (isRedwood) {
    /*
      Redwoods = three giant constellations.
      Big canopy drift + rotating 6-PAR crown + comet/star flashes.
    */

    var tree = floor(nx * 3.0);
    if (tree > 2.0) tree = 2.0;

    var slot = index % 6.0;
    var treeOffset = tree * (0.18 + starEnergy * 0.16);

    // Slow whole-tree glow, staggered per redwood.
    var canopyGlow = wave(pCanopy + treeOffset + nz * 0.22);
    canopyGlow = softShape(canopyGlow);

    // Rotating star crown inside each 6-PAR tree cluster.
    var orbitPos = (pOrbit * (6.0 + starEnergy * 18.0) + tree * 2.0) % 6.0;
    var orbitDistance = ringDist(slot, orbitPos);

    var starWidth = 0.26 + starEnergy * 0.72;
    var crownStar = exp(-(orbitDistance * orbitDistance) / (2.0 * starWidth * starWidth));

    // Opposite dim crown creates a richer constellation, not one chase dot.
    var oppositePos = orbitPos + 3.0;
    if (oppositePos >= 6.0) oppositePos -= 6.0;

    var oppositeDistance = ringDist(slot, oppositePos);
    var oppositeStar = exp(-(oppositeDistance * oppositeDistance) / (2.0 * (starWidth * 1.25) * (starWidth * 1.25)));

    // Comet trail traveling around the tree.
    var comet = wave(
      pOrbit * 1.7 +
      slot * 0.166 +
      treeOffset +
      nz * 0.23
    );
    comet = smoothstep(0.55, 0.98, comet);

    // Tiny scintillation, deterministic instead of random frame noise.
    var sparkleWave = wave(
      pSpark * 9.0 +
      index * 0.377 +
      tree * 0.29 +
      nz * 0.31
    );

    var sparkle = smoothstep(
      0.950 - starEnergy * 0.060,
      0.998,
      sparkleWave
    );

    var starBody = clamp01(
      canopyGlow * 0.20 +
      crownStar * 0.78 +
      oppositeStar * 0.32 +
      comet * 0.34 +
      sparkle * starEnergy * 0.90
    );

    var brightness = clamp01((0.08 + starBody * (0.58 + starEnergy * 0.72)) * darkCut);

    // Palette movement is obvious across each star event.
    var colorMix = clamp01(
      0.12 +
      canopyGlow * 0.26 +
      crownStar * 0.32 +
      comet * 0.18 +
      sparkle * 0.30
    );

    red = paletteR(colorMix) * brightness;
    grn = paletteG(colorMix) * brightness;
    blu = paletteB(colorMix) * brightness;

    // Steamboat-white star tips, gated to redwoods only.
    white = clamp01(
      crownStar * 0.22 +
      sparkle * 0.82 +
      pulseHit * crownStar * 0.38
    ) * starEnergy;

    // UV is the night-sky/canopy halo, not a full wash.
    uvv = clamp01(
      0.10 +
      canopyGlow * 0.30 +
      (1.0 - crownStar) * 0.18
    ) * (0.38 + starEnergy * 0.34);

  } else if (isVintage) {
    /*
      Vintage = warm downbeat bulbs.
      They support the climax without stealing the redwood stars.
    */

    var vintageWave = wave(pPulse + index * 0.113 + nx * 0.17);
    var vintageHit = clamp01(pulseHit * 0.85 + vintageWave * 0.22);

    var vintageLevel = wallHit * vintageHit * darkCut;

    var vintageMix = clamp01(0.20 + pulseHit * 0.62 + vintageWave * 0.18);

    red = paletteR(vintageMix) * vintageLevel * 0.62;
    grn = paletteG(vintageMix) * vintageLevel * 0.62;
    blu = paletteB(vintageMix) * vintageLevel * 0.62;

    amber = vintageLevel * 0.34;
    white = pulseHit * wallHit * 0.26;

  } else {
    /*
      Tower / wall / bars = orbiting celebration ring.
      Uses both x and z so the sweep has depth and does not read static.
    */

    var orbitA = wave(
      pTower * (1.0 + towerSpin * 2.8) +
      nx * (0.80 + towerSpin * 1.2) +
      nz * 0.38
    );

    var orbitB = wave(
      pTower * (1.4 + towerSpin * 2.2) -
      nx * 0.36 +
      nz * (0.72 + towerSpin * 0.95) +
      ny * 0.16
    );

    var ring = orbitA * 0.58 + orbitB * 0.42;
    ring = softShape(ring);

    // A sharp traveling crest gives actual motion, not just wash.
    var crest = smoothstep(0.66, 0.98, ring);

    var towerLevel = clamp01(
      ring * (0.22 + towerSpin * 0.50) +
      crest * (0.18 + starEnergy * 0.24) +
      pulseHit * wallHit * 0.18
    ) * darkCut;

    var towerMix = clamp01(
      0.10 +
      orbitA * 0.34 +
      orbitB * 0.28 +
      crest * 0.28
    );

    red = paletteR(towerMix) * towerLevel;
    grn = paletteG(towerMix) * towerLevel;
    blu = paletteB(towerMix) * towerLevel;

    amber = pulseHit * wallHit * 0.14;
    white = crest * starEnergy * 0.16;
  }

  // Keep WAU accents from washing out cp1/cp2 on RGB fallback.
  white = white * 0.70;
  amber = amber * 0.68;
  uvv = uvv * 0.68;

  rgbwau(
    clamp01(red),
    clamp01(grn),
    clamp01(blu),
    clamp01(white),
    clamp01(amber),
    clamp01(uvv)
  );
}