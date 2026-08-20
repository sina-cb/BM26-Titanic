// DRAFT — pending operator review
/*
  33_rope_constellation.js — ROPE CONSTELLATION

  CONCEPT
    An irregular, connected constellation is stretched across the ship rather
    than scattered as sparkle points. Five to nine deterministic stars drift
    subtly while a finite ten-edge graph keeps the drawing legible and sparse.

  INSTRUMENT STAGING
    FIX_RAW_LED    — the Silhouette carries the crisp connected graph.
    FIX_BAR_18     — a low velvet field stages the drawing without copying it.
    FIX_VINTAGE_6 — palette RGB nodes with matched W+A stellar cores.
    FIX_PAR       — steady constellation anchors, never flash punches.
    FIX_TE_SIGN   — identical paired miniature graph medallions.

  MOTION / TOPOLOGY
    Nine fixed non-grid nodes use small irrationally phased offsets. The edge
    list is a nearest-neighbor growth tree plus two short links: 10 edges at
    nine nodes gives mean degree 2.22. Node Count softly reveals nodes 6–9 and
    their incident links; it never regenerates or teleports an existing node.

  CONTROLS (declaration order = physical MIDI order)
    localSpeed   — speed of the subtle stellar drift and independent twinkle.
    nodeCount    — softly reveals five through nine graph nodes.
    linkWidth    — physical reach of the connected line segments.
    drift        — spatial excursion of nodes around their fixed positions.
    twinkle      — prominence of asynchronous node pulses.
    jewelryNodes — matched W+A stellar cores on Vintage fixtures only.
    safetyFloor  — whole-rig minimum visibility beneath the graph.

  AUDIO_MODULATION_V1:
    sliderNodeCount <- micFlux range 0.35..0.72 curve ease # flux opens more of the fixed constellation
    sliderTwinkle   <- micHigh range 0.04..0.30 curve pow2 # highs lift restrained node scintillation
  Static (unmapped) params: localSpeed, linkWidth, drift, jewelryNodes,
    safetyFloor, colorPalette1/2.

  COLOR / OUTPUT
    RGB remains on the selected cp1-to-cp2 line. Native white is emitted only
    on Jewelry node cores and always as W=A; UV remains zero. Silence retains
    the entire ship on a complete velvet safety bed.
*/

export var localSpeed = 0.30;
export var nodeCount = 0.52;
export var linkWidth = 0.46;
export var drift = 0.34;
export var twinkle = 0.18;
export var jewelryNodes = 0.58;
export var safetyFloor = 0.28;

export var cp1H = 0.62, cp1S = 0.78, cp1V = 0.82;
export var cp2H = 0.10, cp2S = 0.66, cp2V = 1.00;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderNodeCount(v) { nodeCount = v; }
export function sliderLinkWidth(v) { linkWidth = v; }
export function sliderDrift(v) { drift = v; }
export function sliderTwinkle(v) { twinkle = v; }
export function sliderJewelryNodes(v) { jewelryNodes = v; }
export function sliderSafetyFloor(v) { safetyFloor = v; }

var NODE_MAX = 9;
var EDGE_MAX = 10;
var PHASE_WRAP = 40000.0;
var PHI = 1.61803399;
var SQRT2 = 1.41421356;
var SQRT3 = 1.73205081;

// Fixed allocations only. Base coordinates deliberately avoid regular spacing.
var baseX = array(9);
var baseY = array(9);
var baseZ = array(9);
var nodeX = array(9);
var nodeY = array(9);
var nodeZ = array(9);
var nodePulse = array(9);
var nodeOn = array(9);
var edgeA = array(10);
var edgeB = array(10);

var initialized = 0.0;
var driftClock = 0.0;
var twinkleClock = 0.0;
var liveNodeCount = 0.52;
var liveLinkWidth = 0.46;
var liveDrift = 0.34;
var liveTwinkle = 0.18;
var liveJewelryNodes = 0.58;
var liveSafetyFloor = 0.28;

var pr1 = 1.0, pg1 = 0.0, pb1 = 0.0;
var pr2 = 0.0, pg2 = 0.0, pb2 = 1.0;

function clamp01(v) {
  if (v < 0.0) return 0.0;
  if (v > 1.0) return 1.0;
  return v;
}

function smooth01(v) {
  var q = clamp01(v);
  return q * q * (3.0 - 2.0 * q);
}

function initializeGraph() {
  baseX[0] = 0.08; baseY[0] = 0.22; baseZ[0] = 0.18;
  baseX[1] = 0.38; baseY[1] = 0.49; baseZ[1] = 0.06;
  baseX[2] = 0.19; baseY[2] = 0.76; baseZ[2] = 0.37;
  baseX[3] = 0.50; baseY[3] = 0.87; baseZ[3] = 0.84;
  baseX[4] = 0.84; baseY[4] = 0.52; baseZ[4] = 0.63;
  baseX[5] = 0.91; baseY[5] = 0.27; baseZ[5] = 0.31;
  baseX[6] = 0.76; baseY[6] = 0.79; baseZ[6] = 0.09;
  baseX[7] = 0.42; baseY[7] = 0.35; baseZ[7] = 0.72;
  baseX[8] = 0.72; baseY[8] = 0.16; baseZ[8] = 0.90;

  edgeA[0] = 0; edgeB[0] = 1;
  edgeA[1] = 1; edgeB[1] = 2;
  edgeA[2] = 2; edgeB[2] = 3;
  edgeA[3] = 3; edgeB[3] = 4;
  edgeA[4] = 4; edgeB[4] = 5;
  edgeA[5] = 5; edgeB[5] = 6;
  edgeA[6] = 4; edgeB[6] = 7;
  edgeA[7] = 7; edgeB[7] = 8;
  edgeA[8] = 7; edgeB[8] = 3;
  edgeA[9] = 8; edgeB[9] = 4;
}

function nodeActivation(nodeIndex) {
  return nodeOn[nodeIndex];
}

function pointDistanceSquared(px, py, pz, nodeIndex) {
  var dx = px - nodeX[nodeIndex];
  var dy = py - nodeY[nodeIndex];
  // The graph is authored onto the Silhouette. Depth remains a real XYZ
  // parallax term, but is compressed so sparse rope pixels can form connected
  // projected links rather than isolated hits in a deep volume.
  var dz = (pz - nodeZ[nodeIndex]) * 0.14;
  return dx * dx + dy * dy + dz * dz;
}

function segmentDistanceSquared(px, py, pz, firstNode, secondNode) {
  var ax = nodeX[firstNode];
  var ay = nodeY[firstNode];
  var az = nodeZ[firstNode];
  var bx = nodeX[secondNode];
  var by = nodeY[secondNode];
  var bz = nodeZ[secondNode];
  var vx = bx - ax;
  var vy = by - ay;
  var vz = (bz - az) * 0.14;
  var wx = px - ax;
  var wy = py - ay;
  var wz = (pz - az) * 0.14;
  var lengthSquared = vx * vx + vy * vy + vz * vz + 0.000001;
  var along = clamp01((wx * vx + wy * vy + wz * vz) / lengthSquared);
  var dx = px - (ax + vx * along);
  var dy = py - (ay + vy * along);
  var dz = (pz - az) * 0.14 - vz * along;
  return dx * dx + dy * dy + dz * dz;
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
  else if (iv == 4.0) { pr2 = tv;   pg2 = pv;   pb2 = cp2V; }
  else                 { pr2 = cp2V; pg2 = pv;   pb2 = qv;   }
}

export function beforeRender(delta) {
  if (initialized == 0.0) {
    initializeGraph();
    initialized = 1.0;
  }

  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  var follow = min(1.0, dt * 4.5);
  liveNodeCount += (nodeCount - liveNodeCount) * follow;
  liveLinkWidth += (linkWidth - liveLinkWidth) * follow;
  liveDrift += (drift - liveDrift) * follow;
  liveTwinkle += (twinkle - liveTwinkle) * follow;
  liveJewelryNodes += (jewelryNodes - liveJewelryNodes) * follow;
  liveSafetyFloor += (safetyFloor - liveSafetyFloor) * follow;

  var localMultiplier = 0.25 + clamp01(localSpeed)
    * (32.824 - 16.412 * clamp01(localSpeed));
  driftClock += dt * 0.031 * localMultiplier;
  twinkleClock += dt * 0.071 * localMultiplier;
  if (driftClock >= PHASE_WRAP) driftClock -= PHASE_WRAP;
  if (twinkleClock >= PHASE_WRAP) twinkleClock -= PHASE_WRAP;

  var excursion = 0.008 + clamp01(liveDrift) * 0.075;
  var count = 5.0 + clamp01(liveNodeCount) * 4.0;
  for (var k = 0.0; k < NODE_MAX; k++) {
    var seed = k * 2.39996323;
    nodeX[k] = baseX[k] + excursion
             * sin(driftClock * (SQRT2 + k * 0.037) * PI2 + seed);
    nodeY[k] = baseY[k] + excursion * 0.74
             * cos(driftClock * (SQRT3 + k * 0.029) * PI2 + seed * PHI);
    nodeZ[k] = baseZ[k] + excursion
             * sin(driftClock * (PHI + k * 0.043) * PI2 + seed * SQRT2);
    nodePulse[k] = 0.5 + 0.5
                 * sin(twinkleClock * (PHI + k * 0.071) * PI2 + seed);
    nodeOn[k] = smoothstep(k + 0.04, k + 0.94, count);
  }

  _hsv2rgb1();
  _hsv2rgb2();
}

export function render3D(index, x, y, z) {
  var px = clamp01(x);
  var py = clamp01(y);
  var pz = clamp01(z);
  var isSign = fixtureType == FIX_TE_SIGN;
  var isRaw = fixtureType == FIX_RAW_LED;
  var isVintage = fixtureType == FIX_VINTAGE_6;
  var needsGraph = isRaw || isSign;
  var needsNodes = needsGraph;

  if (isSign) {
    // Each sign spans two physical fixtures. The complete 74-pixel fold makes
    // the lower 34 pixels continue one graph medallion instead of repeating.
    var signIndex = index % 74.0;
    px = (signIndex % 10.0) / 9.0;
    py = floor(signIndex / 10.0) / 7.0;
    pz = 0.50;
  }

  // Evaluate the nine permanent irregular XYZ nodes and the literal ten-edge
  // incidence list. No analytic wave or infinite backbone substitutes for
  // these finite segments: every visible branch terminates at a real node.
  var nodeCore = 0.0;
  var nodeHalo = 0.0;
  var nodeColor = 0.50;
  var lineCore = 0.0;
  var lineHalo = 0.0;
  var lineColor = 0.50;
  if (needsGraph) {
    var nodeRadius = 0.042 + clamp01(liveLinkWidth) * 0.052;
    var nodeCoreRadius2 = nodeRadius * nodeRadius * 0.36;
    var nodeHaloRadius2 = nodeRadius * nodeRadius * 4.84;
    for (var nodeIndex = 0.0; nodeIndex < NODE_MAX; nodeIndex++) {
      var activeNode = nodeOn[nodeIndex];
      var nodeDistance2 = pointDistanceSquared(px, py, pz, nodeIndex);
      var nodePulseGain = 1.0 + clamp01(liveTwinkle)
                        * (0.12 + nodePulse[nodeIndex] * 0.88);
      var coreCandidate = (1.0 - smoothstep(nodeCoreRadius2,
                                            nodeRadius * nodeRadius,
                                            nodeDistance2))
                        * activeNode * nodePulseGain;
      var haloCandidate = (1.0 - smoothstep(nodeRadius * nodeRadius,
                                            nodeHaloRadius2,
                                            nodeDistance2))
                        * activeNode * nodePulseGain;
      if (coreCandidate > nodeCore) nodeColor = nodeIndex / 8.0;
      nodeCore = max(nodeCore, coreCandidate);
      nodeHalo = max(nodeHalo, haloCandidate);
    }

    var lineRadius = 0.026 + clamp01(liveLinkWidth) * 0.078;
    var lineRadius2 = lineRadius * lineRadius;
    var lineCoreStart2 = lineRadius2 * 0.16;
    var lineHaloEnd2 = lineRadius2 * 4.84;
    for (var edgeIndex = 0.0; edgeIndex < EDGE_MAX; edgeIndex++) {
      var firstNode = edgeA[edgeIndex];
      var secondNode = edgeB[edgeIndex];
      var activeEdge = min(nodeOn[firstNode], nodeOn[secondNode]);
      var edgeDistance2 = segmentDistanceSquared(px, py, pz,
                                                  firstNode, secondNode);
      var edgeCoreCandidate = (1.0 - smoothstep(lineCoreStart2,
                                                lineRadius2,
                                                edgeDistance2)) * activeEdge;
      var edgeHaloCandidate = (1.0 - smoothstep(lineRadius2,
                                                lineHaloEnd2,
                                                edgeDistance2)) * activeEdge;
      if (edgeCoreCandidate > lineCore) lineColor = edgeIndex / 9.0;
      lineCore = max(lineCore, edgeCoreCandidate);
      lineHalo = max(lineHalo, edgeHaloCandidate);
    }
  }

  var floorLevel = 0.045 + clamp01(liveSafetyFloor) * 0.220;
  var brightness = floorLevel;
  var paletteMix = 0.20;
  var outW = 0.0;
  var jewelryStar = 0.0;
  if (isVintage) {
    // Each six-head rail becomes a compact node register. This fixture-local
    // mapping guarantees visible matched-white stars even when no physical
    // rail pixel happens to lie near a world-space graph node.
    var jewelrySlot = pixelLocalIndex % 6.0;
    jewelryStar = pow(nodePulse[jewelrySlot], 5.0)
                * nodeActivation(jewelrySlot);
  }

  if (isRaw) {
    brightness = clamp01(floorLevel + lineHalo * 0.24
                       + lineCore * 0.96 + nodeHalo * 0.20
                       + nodeCore * 0.88);
    paletteMix = clamp01(lineColor * 0.72 + nodeColor * 0.28);
  } else if (fixtureType == FIX_BAR_18) {
    // Broad non-lattice velvet folds stage the sparse graph. Their irrational
    // axes and low contrast avoid becoming a competing whole-rig wave field.
    var velvetA = wave(px * 0.73 + pz * SQRT2 - driftClock * 0.19);
    var velvetB = wave(py * PHI - px * 0.41 + driftClock * 0.13);
    var velvet = velvetA * 0.58 + velvetB * 0.42;
    brightness = clamp01(floorLevel + velvet * 0.065);
    paletteMix = clamp01(0.08 + velvetB * 0.26 + lineColor * 0.12);
  } else if (isVintage) {
    brightness = clamp01(floorLevel * 0.68 + 0.045
                       + jewelryStar * (0.34 + liveTwinkle * 0.52));
    paletteMix = clamp01(0.52 + jewelrySlot * 0.075);
    outW = clamp01(jewelryStar * clamp01(liveJewelryNodes) * 0.92);
  } else if (fixtureType == FIX_PAR) {
    // Point-source organs become stable anchors selected from the same finite
    // node topology. Twinkle only adds a restrained breathing lift.
    var anchor = pixelLocalIndex % 5.0;
    var anchorOn = nodeActivation(anchor);
    var anchorPulse = nodePulse[anchor];
    brightness = clamp01(floorLevel + 0.16 + anchorOn * 0.24
                       + anchorPulse * clamp01(liveTwinkle) * 0.16);
    paletteMix = clamp01(0.16 + anchor * 0.17);
  } else if (isSign) {
    var signSky = wave(px * 0.73 + py * 0.41 - driftClock * 0.71)
                * wave(py * 0.59 - px * 0.31
                      + driftClock * 1.41421356);
    brightness = clamp01(max(0.27, floorLevel + 0.12
                       + lineHalo * 0.26 + lineCore * 0.72
                       + nodeHalo * 0.22 + nodeCore * 0.70
                       + signSky * 0.22));
    paletteMix = clamp01(lineColor * 0.60 + nodeColor * 0.40
                       + signSky * 0.16);
  }

  brightness = clamp01(brightness);
  paletteMix = clamp01(paletteMix);
  var outR = (pr1 + (pr2 - pr1) * paletteMix) * brightness;
  var outG = (pg1 + (pg2 - pg1) * paletteMix) * brightness;
  var outB = (pb1 + (pb2 - pb1) * paletteMix) * brightness;
  rgbwau(clamp01(outR), clamp01(outG), clamp01(outB), outW, outW, 0.0);
}
