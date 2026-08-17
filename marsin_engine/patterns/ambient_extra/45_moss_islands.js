// DRAFT — pending operator review
/*
  45_moss_islands.js — MOSS ISLANDS

  CONCEPT
    Three to six large anchored moss islands rise from a dark sea, touch through
    finite land bridges, merge into shared coasts, and recede while their roots
    remain fixed. They are legible land masses, never a drifting scalar wash.

  INSTRUMENT STAGING
    FIX_BAR_18     — broad moss plateaus separated by protected dark sea.
    FIX_RAW_LED    — bright union coasts and unmistakable merger necks.
    FIX_VINTAGE_6  — sparse palette-RGB shoreline spores; no native white.
    FIX_PAR        — rooted island centers with slow stored energy.
    FIX_TE_SIGN    — identical complete 74-pixel island maps.

  MOTION / MATH
    Six fixed centers own anisotropic organic shorelines. Their finite union is
    joined only by five explicit point-to-segment land bridges, so merger necks
    have visible sides and termini rather than emerging from an unbounded field.
    One union threshold yields the plateau and its continuous outer coast.
    Drift adds at most 0.03 normalized units of bounded center motion.

  CONTROLS (declaration order = physical MIDI order)
    localSpeed   — cadence of autonomous growth and recession.
    islandCount  — selects exactly three, four, five, or six anchored islands.
    growth       — mean radius and merger reach of every island.
    edgeDetail   — definition and fine structure of the threshold coastline.
    drift        — bounded anchor movement, always less than 0.03 units.
    jewelrySpore — prominence of sparse palette-RGB Vintage coast spores.
    safetyFloor  — minimum palette-derived whole-vessel visibility.

  AUDIO_MODULATION_V1:
    sliderGrowth       <- micLow range 0.22..0.55 curve ease # PRIMARY: lows expand and merge the islands
    sliderJewelrySpore <- micHigh range 0.03..0.24 curve pow2 # highs lift sparse Vintage spores
  Static (unmapped) params: localSpeed, islandCount, edgeDetail, drift,
    safetyFloor, colorPalette1/2.

  COLOR / OUTPUT
    Every RGB value lies on the selected cp1↔cp2 line. Jewelry spores remain
    palette RGB. Native white, amber, and UV stay zero, so W=A exactly. Silence
    retains autonomous growth/recession over a complete nonblack safety bed.
*/

export var cp1H = 0.365, cp1S = 0.76, cp1V = 0.82;
export var cp2H = 0.105, cp2S = 0.74, cp2V = 1.00;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export var localSpeed = 0.30;
export var islandCount = 0.48;
export var growth = 0.44;
export var edgeDetail = 0.52;
export var drift = 0.24;
export var jewelrySpore = 0.16;
export var safetyFloor = 0.25;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderIslandCount(v) { islandCount = v; }
export function sliderGrowth(v) { growth = v; }
export function sliderEdgeDetail(v) { edgeDetail = v; }
export function sliderDrift(v) { drift = v; }
export function sliderJewelrySpore(v) { jewelrySpore = v; }
export function sliderSafetyFloor(v) { safetyFloor = v; }

var PHASE_WRAP = 10000.0;
var PHI = 1.61803399;
var SQRT2 = 1.41421356;
var SQRT3 = 1.73205081;

var growthClockA = 0.17;
var growthClockB = 0.43;
var driftClock = 0.09;
var activeIslands = 4.0;
var mergeTide = 0.5;

var centerX = array(6);
var centerY = array(6);
var radiusX = array(6);
var radiusY = array(6);

var pr1 = 1.0, pg1 = 0.0, pb1 = 0.0;
var pr2 = 0.0, pg2 = 0.0, pb2 = 1.0;

function clamp01(v) {
  if (v < 0.0) return 0.0;
  if (v > 1.0) return 1.0;
  return v;
}

function smooth01(v) {
  var sv = clamp01(v);
  return sv * sv * (3.0 - 2.0 * sv);
}

function segmentDistanceSquared(px, py, ax, ay, bx, by) {
  var vx = bx - ax;
  var vy = by - ay;
  var wx = px - ax;
  var wy = py - ay;
  var lengthSquared = vx * vx + vy * vy + 0.000001;
  var along = clamp01((wx * vx + wy * vy) / lengthSquared);
  var dx = px - (ax + vx * along);
  var dy = py - (ay + vy * along);
  return dx * dx + dy * dy;
}

function _hsv2rgb1() {
  var hv = cp1H - floor(cp1H); if (hv < 0.0) hv += 1.0;
  var iv = floor(hv * 6.0) % 6.0;
  var fv = hv * 6.0 - floor(hv * 6.0);
  var pv = cp1V * (1.0 - cp1S);
  var qv = cp1V * (1.0 - fv * cp1S);
  var tv = cp1V * (1.0 - (1.0 - fv) * cp1S);
  if      (iv == 0.0) { pr1 = cp1V; pg1 = tv;   pb1 = pv;   }
  else if (iv == 1.0) { pr1 = qv;   pg1 = cp1V; pb1 = pv;   }
  else if (iv == 2.0) { pr1 = pv;   pg1 = cp1V; pb1 = tv;   }
  else if (iv == 3.0) { pr1 = pv;   pg1 = qv;   pb1 = cp1V; }
  else if (iv == 4.0) { pr1 = tv;   pg1 = pv;   pb1 = cp1V; }
  else                 { pr1 = cp1V; pg1 = pv;   pb1 = qv;   }
}

function _hsv2rgb2() {
  var hv = cp2H - floor(cp2H); if (hv < 0.0) hv += 1.0;
  var iv = floor(hv * 6.0) % 6.0;
  var fv = hv * 6.0 - floor(hv * 6.0);
  var pv = cp2V * (1.0 - cp2S);
  var qv = cp2V * (1.0 - fv * cp2S);
  var tv = cp2V * (1.0 - (1.0 - fv) * cp2S);
  if      (iv == 0.0) { pr2 = cp2V; pg2 = tv;   pb2 = pv;   }
  else if (iv == 1.0) { pr2 = qv;   pg2 = cp2V; pb2 = pv;   }
  else if (iv == 2.0) { pr2 = pv;   pg2 = cp2V; pb2 = tv;   }
  else if (iv == 3.0) { pr2 = pv;   pg2 = qv;   pb2 = cp2V; }
  else if (iv == 4.0) { pr2 = tv;   pg2 = pv;   pb2 = qv;   }
  else                 { pr2 = cp2V; pg2 = pv;   pb2 = qv;   }
}

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  var localMultiplier = 0.25 + clamp01(localSpeed)
    * (32.824 - 16.412 * clamp01(localSpeed));
  growthClockA += dt * (0.012 + localMultiplier * 0.041);
  growthClockB += dt * (0.009 + localMultiplier * 0.028765);
  driftClock += dt * (0.007 + localMultiplier * 0.019);
  if (growthClockA >= PHASE_WRAP) growthClockA -= PHASE_WRAP;
  if (growthClockB >= PHASE_WRAP) growthClockB -= PHASE_WRAP;
  if (driftClock >= PHASE_WRAP) driftClock -= PHASE_WRAP;

  activeIslands = 3.0 + floor(clamp01(islandCount) * 3.999);

  var baseRadius = 0.075 + clamp01(growth) * 0.055;
  var driftExtent = 0.003 + clamp01(drift) * 0.027;
  // A shared tide expands the anchored landforms and separately opens the
  // explicit bridge necks. No center follows the tide.
  var sharedGrowthA = 0.5 + 0.5 * sin(growthClockA * PI2);
  var sharedGrowthB = 0.5 + 0.5 * sin(growthClockB * PI2);
  var sharedRadius = baseRadius
                   * (0.78 + sharedGrowthA * 0.30 + sharedGrowthB * 0.12);
  mergeTide = smooth01((sharedGrowthA * 0.72 + sharedGrowthB * 0.28 - 0.34)
                       / 0.52);
  var k = 0.0;
  for (k = 0.0; k < 6.0; k = k + 1.0) {
    var anchorX = 0.68;
    var anchorY = 0.82;
    if (k == 0.0) { anchorX = 0.28; anchorY = 0.62; }
    else if (k == 1.0) { anchorX = 0.38; anchorY = 0.47; }
    else if (k == 2.0) { anchorX = 0.69; anchorY = 0.66; }
    else if (k == 3.0) { anchorX = 0.28; anchorY = 0.34; }
    else if (k == 4.0) { anchorX = 0.78; anchorY = 0.38; }

    // Centers move only inside a bounded 0.03-unit disk at maximum Drift.
    centerX[k] = anchorX + sin((driftClock + k * PHI) * PI2)
                           * driftExtent;
    centerY[k] = anchorY + sin((driftClock * 0.73 + k * SQRT2) * PI2)
                           * driftExtent * 0.72;
    var islandBreath = 0.96
                     + 0.04 * sin((growthClockB * 0.31 + k * PHI) * PI2);
    radiusX[k] = sharedRadius * islandBreath
               * (0.88 + 0.12 * wave(k * PHI));
    radiusY[k] = sharedRadius * islandBreath
               * (0.68 + 0.15 * wave(k * SQRT2));
  }

  _hsv2rgb1();
  _hsv2rgb2();
}

export function render3D(index, x, y, z) {
  var px = clamp01(x);
  var py = clamp01(y * 0.76 + z * 0.24);
  var isBar = fixtureType == FIX_BAR_18;
  var isRaw = fixtureType == FIX_RAW_LED;
  var isVintage = fixtureType == FIX_VINTAGE_6;
  var isPar = fixtureType == FIX_PAR;
  var isSign = fixtureType == FIX_TE_SIGN;

  if (isSign) {
    // The physical sign is split across 40- and 34-pixel fixtures. Fold the
    // complete model index so one authored 10x8 archipelago crosses that seam
    // and both signs receive the same dynamic 74-pixel map.
    var signIndex = index % 74.0;
    px = (signIndex % 10.0) / 9.0;
    py = floor(signIndex / 10.0) / 7.0;
  }

  var islandField = 0.0;
  var neckField = 0.0;
  var rootField = 0.0;
  var nearestIsland = 0.0;
  var nearestNormalizedDistance = 100.0;
  var countLimit = 3.0 + floor(clamp01(islandCount) * 3.999);
  var k = 0.0;
  for (k = 0.0; k < 6.0; k = k + 1.0) {
    if (k < countLimit) {
      var dx = px - centerX[k];
      var dy = py - centerY[k];
      var islandRadiusX = radiusX[k];
      var islandRadiusY = radiusY[k];
      var normalizedDistance = sqrt(
        (dx * dx) / max(islandRadiusX * islandRadiusX, 0.000001)
        + (dy * dy) / max(islandRadiusY * islandRadiusY, 0.000001));
      if (normalizedDistance < nearestNormalizedDistance) {
        nearestNormalizedDistance = normalizedDistance;
        nearestIsland = k;
      }
      // Two fixed harmonics corrugate this island's own boundary. Because they
      // are centered on the anchor, detail cannot become a drifting texture.
      var shoreA = wave(dx / max(islandRadiusX, 0.001) * 1.73
                      + dy / max(islandRadiusY, 0.001) * 1.11 + k * PHI);
      var shoreB = wave(dx / max(islandRadiusX, 0.001) * -2.07
                      + dy / max(islandRadiusY, 0.001) * 1.57 + k * SQRT2);
      var boundary = 0.94 + clamp01(edgeDetail)
                   * ((shoreA - 0.5) * 0.22 + (shoreB - 0.5) * 0.14);
      var coastSoftness = 0.025 + (1.0 - clamp01(edgeDetail)) * 0.100;
      var island = smooth01((boundary - normalizedDistance + coastSoftness)
                           / (coastSoftness * 2.0));
      if (island > islandField) islandField = island;
      var root = smooth01(1.0 - normalizedDistance / 0.42);
      if (root > rootField) rootField = root;
    }
  }

  // Five finite bridge segments connect the six anchors as a tree. A bridge
  // appears only when both endpoint islands are active and the shared tide is
  // high enough; its visible side coasts are part of the same union below.
  var bridge = 0.0;
  for (bridge = 0.0; bridge < 5.0; bridge = bridge + 1.0) {
    var first = 0.0;
    var second = 1.0;
    if (bridge == 1.0) { first = 1.0; second = 2.0; }
    else if (bridge == 2.0) { first = 0.0; second = 3.0; }
    else if (bridge == 3.0) { first = 2.0; second = 4.0; }
    else if (bridge == 4.0) { first = 2.0; second = 5.0; }
    if (second < countLimit) {
      var bridgeDistanceSquared = segmentDistanceSquared(
        px, py, centerX[first], centerY[first], centerX[second], centerY[second]);
      var neckWidth = 0.010 + clamp01(growth) * 0.026
                    + mergeTide * 0.028;
      var neck = smooth01(1.0 - bridgeDistanceSquared
                         / max(neckWidth * neckWidth, 0.000001));
      neck *= smooth01((mergeTide - 0.20) / 0.42);
      if (neck > neckField) neckField = neck;
    }
  }

  // Deriving coast from the max-union removes false internal outlines where
  // islands overlap and leaves one continuous perimeter around merger necks.
  var body = max(islandField, neckField);
  var coastWidth = 0.16 + (1.0 - clamp01(edgeDetail)) * 0.16;
  var coast = smooth01(1.0 - abs(body - 0.50) / coastWidth);
  var coastGrain = wave(px * 5.17 + py * 3.11
                       + nearestIsland * PHI + growthClockB * 0.07);
  coast *= 0.62 + clamp01(edgeDetail)
         * (0.16 + coastGrain * 0.46);
  coast = clamp01(coast);
  var mossEtching = body * clamp01(edgeDetail)
                  * pow(wave(px * 8.17 - py * 6.53
                           + nearestIsland * SQRT3),
                        2.0 + clamp01(edgeDetail) * 5.0);
  // Distinct plateau heights make each newly admitted island spatially
  // legible; Count reveals whole terraces rather than raising a global level.
  var mossTerrace = body * nearestIsland / 5.0;
  var seaTexture = 0.5 + 0.5 * wave(px * 0.73 - py * 0.61
                                  + growthClockB * 0.11);

  var floorLevel = 0.025 + clamp01(safetyFloor) * 0.150;
  var brightness = floorLevel + seaTexture * 0.025
                 + body * 0.58 + coast * 0.36 + mossEtching * 0.20
                 + mossTerrace * 0.20;
  var paletteMix = clamp01(0.04 + body * 0.58 + coast * 0.30
                          + nearestIsland * 0.100);

  if (isBar) {
    // Hull Canvas carries the broad thresholded island bodies.
    brightness = floorLevel + seaTexture * 0.018
               + body * 0.70 + coast * 0.30 + mossEtching * 0.24
               + mossTerrace * 0.24;
    paletteMix = clamp01(0.04 + body * 0.60 + coast * 0.30
                        + nearestIsland * 0.090);
  } else if (isRaw) {
    // Silhouette privileges the merged coastline and its fine contour.
    brightness = floorLevel + 0.030 + body * 0.10 + coast * 0.82
               + neckField * 0.28 + mossEtching * 0.30
               + mossTerrace * 0.18;
    paletteMix = clamp01(0.08 + body * 0.28 + coast * 0.58);
  } else if (isVintage) {
    // Spores remain sparse and palette-RGB. A small rail-wide lift makes the
    // dedicated high-band control truthful without introducing native white.
    var sporeSeed = pow(wave(pixelLocalIndex * 0.38196601
                            + fixtureId * PHI
                            + nearestIsland * SQRT3), 10.0);
    var spore = coast * sporeSeed;
    brightness = floorLevel * 0.82 + 0.025
               + jewelrySpore * 0.54
               + spore * (0.14 + jewelrySpore * 0.86)
               + mossEtching * 0.18 + mossTerrace * 0.14;
    paletteMix = clamp01(0.40 + coast * 0.24 + spore * 0.34);
  } else if (isPar) {
    // Organs are rooted energy points at the nearly stationary island centers.
    brightness = floorLevel + 0.07 + rootField * 0.84
               + coast * 0.10 + neckField * 0.14 + mossEtching * 0.22
               + mossTerrace * 0.16;
    paletteMix = clamp01(0.12 + rootField * 0.76 + coast * 0.08);
  } else if (isSign) {
    // Paired local maps show full body, coastline, and roots above a strong
    // identity floor. A slow tide sheen crosses both full surfaces identically
    // so the islands remain visibly alive between discrete merger chapters.
    var tideSheen = wave(px * 0.83 - py * 0.47 + growthClockA * 0.61);
    brightness = max(0.27, floorLevel + 0.10
                   + body * 0.52 + coast * 0.54 + rootField * 0.18
                   + neckField * 0.16 + tideSheen * 0.075
                   + mossEtching * 0.26 + mossTerrace * 0.20);
    paletteMix = clamp01(0.10 + body * 0.42
                        + coast * 0.34 + rootField * 0.12
                        + tideSheen * 0.060);
  }

  // Growth is the low-band area handle. Its gentle whole-island energy lift
  // makes the audio relationship visible while the body geometry remains the
  // dominant, independently measured effect.
  brightness *= 0.72 + clamp01(growth) * 0.66;
  brightness = clamp01(brightness);
  paletteMix = clamp01(paletteMix);
  var outR = (pr1 + (pr2 - pr1) * paletteMix) * brightness;
  var outG = (pg1 + (pg2 - pg1) * paletteMix) * brightness;
  var outB = (pb1 + (pb2 - pb1) * paletteMix) * brightness;
  rgbwau(clamp01(outR), clamp01(outG), clamp01(outB), 0.0, 0.0, 0.0);
}
