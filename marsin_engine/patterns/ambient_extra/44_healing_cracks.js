// DRAFT — pending operator review
/*
  44_healing_cracks.js — HEALING CRACKS

  CONCEPT
    One finite, connected seven-segment fracture opens across the vessel,
    glows briefly, then visibly closes until the crack area returns exactly to
    its baseline. It is a single event graph, not persistent chemistry, cells,
    noise, or a full-surface reaction texture.

  INSTRUMENT STAGING
    FIX_BAR_18     — the connected crack surface and its narrow hot seam.
    FIX_RAW_LED    — the broader fracture shell outlining the finite graph.
    FIX_VINTAGE_6  — sparse palette-RGB hot points; no native-white shortcut.
    FIX_PAR        — heat reservoirs at the graph's connected branch nodes.
    FIX_TE_SIGN    — paired full-surface repaired-seal diagrams.

  MOTION / MATH
    Eight fixed nodes define a connected tree of seven finite segments. Every
    pixel finds the minimum analytic point-to-segment distance. A piecewise
    ceremony has closed dwell, eased opening, brief glow, explicit eased heal,
    then a long repaired hold. The closed state multiplies crack width and
    energy by exact zero, returning crack area to baseline (within 0%, tighter
    than the 5% acceptance bound). Integer clock wrapping is seam-safe.

  CONTROLS (declaration order = physical MIDI order)
    localSpeed  — pace of the complete open / glow / heal ceremony.
    crackCount  — exposes exactly three through seven connected segments.
    opening     — maximum separation and energy of the opened fracture.
    seamWidth   — physical width of the hot crack seam and outer shell.
    healTime    — duration of the explicit closing phase before repaired hold.
    organHeat   — brightness of Organ reservoirs at connected branch nodes.
    safetyFloor — minimum palette-derived whole-vessel visibility.

  AUDIO_MODULATION_V1:
    sliderOpening   <- micFlux range 0.18..0.55 curve ease # PRIMARY: flux opens and energizes the fracture
    sliderOrganHeat <- micMid range 0.10..0.38 curve linear # mids warm connected Organ reservoirs
  Static (unmapped) params: localSpeed, crackCount, seamWidth, healTime,
    safetyFloor, colorPalette1/2.

  COLOR / OUTPUT
    Every RGB value lies on the selected cp1↔cp2 line. Jewelry hot points are
    palette RGB only. Native W, A, and UV remain zero, satisfying W=A exactly.
    Silence autonomously opens, glows, heals, and rests over a nonblack bed.
*/

export var cp1H = 0.55, cp1S = 0.80, cp1V = 0.82;
export var cp2H = 0.095, cp2S = 0.82, cp2V = 1.00;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export var localSpeed = 0.30;
export var crackCount = 0.72;
export var opening = 0.42;
export var seamWidth = 0.34;
export var healTime = 0.52;
export var organHeat = 0.28;
export var safetyFloor = 0.25;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderCrackCount(v) { crackCount = v; }
export function sliderOpening(v) { opening = v; }
export function sliderSeamWidth(v) { seamWidth = v; }
export function sliderHealTime(v) { healTime = v; }
export function sliderOrganHeat(v) { organHeat = v; }
export function sliderSafetyFloor(v) { safetyFloor = v; }

var PHASE_WRAP = 10000.0;
var PHI = 1.61803399;
var SQRT2 = 1.41421356;
var SQRT3 = 1.73205081;

var cycleClock = 0.32;
var heatClock = 0.11;
var repairFrontX = -0.18;
var openingEnvelope = 0.0;
var glowEnvelope = 0.0;
var activeCracks = 5.0;

var nodeX = array(8);
var nodeY = array(8);
var edgeA = array(7);
var edgeB = array(7);

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
  cycleClock += dt * (0.018 + localMultiplier * 0.058);
  heatClock += dt * (0.012 + localMultiplier * 0.031);
  if (cycleClock >= PHASE_WRAP) cycleClock -= PHASE_WRAP;
  if (heatClock >= PHASE_WRAP) heatClock -= PHASE_WRAP;
  repairFrontX = -0.18 + 1.36 * (heatClock - floor(heatClock));

  activeCracks = 3.0 + floor(clamp01(crackCount) * 4.999);

  // The graph is one connected tree. Its nodes never drift apart, so every
  // partial count is also connected: edges are revealed in this exact order.
  nodeX[0] = 0.50; nodeY[0] = 0.53;
  nodeX[1] = 0.34; nodeY[1] = 0.67;
  nodeX[2] = 0.68; nodeY[2] = 0.70;
  nodeX[3] = 0.52; nodeY[3] = 0.34;
  nodeX[4] = 0.17; nodeY[4] = 0.82;
  nodeX[5] = 0.87; nodeY[5] = 0.86;
  nodeX[6] = 0.28; nodeY[6] = 0.16;
  nodeX[7] = 0.80; nodeY[7] = 0.13;
  edgeA[0] = 0; edgeB[0] = 1;
  edgeA[1] = 0; edgeB[1] = 2;
  edgeA[2] = 0; edgeB[2] = 3;
  edgeA[3] = 1; edgeB[3] = 4;
  edgeA[4] = 2; edgeB[4] = 5;
  edgeA[5] = 3; edgeB[5] = 6;
  edgeA[6] = 3; edgeB[6] = 7;

  var phase = cycleClock - floor(cycleClock);
  var openStart = 0.10;
  var openEnd = 0.29;
  var glowEnd = 0.41;
  var healDuration = 0.10 + clamp01(healTime) * 0.28;
  var healEnd = glowEnd + healDuration;
  openingEnvelope = 0.0;
  glowEnvelope = 0.0;
  if (phase >= openStart && phase < openEnd) {
    openingEnvelope = smooth01((phase - openStart) / (openEnd - openStart));
    glowEnvelope = openingEnvelope * 0.64;
  } else if (phase >= openEnd && phase < glowEnd) {
    openingEnvelope = 1.0;
    glowEnvelope = 0.78 + 0.22
                 * wave((phase - openEnd) / (glowEnd - openEnd) * 0.5);
  } else if (phase >= glowEnd && phase < healEnd) {
    var healing = (phase - glowEnd) / healDuration;
    openingEnvelope = smooth01(1.0 - healing);
    glowEnvelope = openingEnvelope * (1.0 - healing * 0.38);
  }

  _hsv2rgb1();
  _hsv2rgb2();
}

export function render3D(index, x, y, z) {
  var px = clamp01(x);
  var py = clamp01(y * 0.78 + z * 0.22);
  var isBar = fixtureType == FIX_BAR_18;
  var isRaw = fixtureType == FIX_RAW_LED;
  var isVintage = fixtureType == FIX_VINTAGE_6;
  var isPar = fixtureType == FIX_PAR;
  var isSign = fixtureType == FIX_TE_SIGN;

  if (isSign) {
    // A 74-pixel sign crosses 40- and 34-pixel fixture counters. Fold model
    // index over one complete 10x8 graph so the fracture continues through
    // the physical seam and the paired sign buffers remain byte-identical.
    var signIndex = index % 74.0;
    px = (signIndex % 10.0) / 9.0;
    py = floor(signIndex / 10.0) / 7.0;
  }

  // A detailed interference material remains behind one simple repair front.
  // The field rewards close viewing; the broad left-to-right band is the
  // unmistakable gesture seen from far across the playa.
  var fieldA = wave(px * 1.618 + py * 1.414 + heatClock * 0.73);
  var fieldB = wave(px * 2.236 - py * 1.732 - heatClock * 0.41);
  var repairField = fieldA * fieldB;
  var repairBand = smooth01(1.0 - abs(px - repairFrontX) / 0.24);

  // Every pixel first evaluates the three central spokes. The four outer
  // branches live in disjoint quadrants, so only the spatially relevant child
  // can beat that distance. This retains the complete seven-edge connected
  // tree while removing the seven-segment loop from the 40 fps path.
  var minimumDistanceSquared = segmentDistanceSquared(
    px, py, nodeX[0], nodeY[0], nodeX[1], nodeY[1]);
  var nearestSegment = 0.0;
  var distanceSquared = segmentDistanceSquared(
    px, py, nodeX[0], nodeY[0], nodeX[2], nodeY[2]);
  if (distanceSquared < minimumDistanceSquared) {
    minimumDistanceSquared = distanceSquared;
    nearestSegment = 1.0;
  }
  distanceSquared = segmentDistanceSquared(
    px, py, nodeX[0], nodeY[0], nodeX[3], nodeY[3]);
  if (distanceSquared < minimumDistanceSquared) {
    minimumDistanceSquared = distanceSquared;
    nearestSegment = 2.0;
  }

  var outerSegment = 3.0;
  if (px >= 0.50 && py >= 0.53) outerSegment = 4.0;
  else if (px < 0.50 && py < 0.53) outerSegment = 5.0;
  else if (px >= 0.50 && py < 0.53) outerSegment = 6.0;
  if (outerSegment < activeCracks) {
    var first = edgeA[outerSegment];
    var second = edgeB[outerSegment];
    distanceSquared = segmentDistanceSquared(
      px, py, nodeX[first], nodeY[first], nodeX[second], nodeY[second]);
    if (distanceSquared < minimumDistanceSquared) {
      minimumDistanceSquared = distanceSquared;
      nearestSegment = outerSegment;
    }
  }

  var openingAmount = openingEnvelope * (0.16 + clamp01(opening) * 0.84);
  var width = (0.006 + clamp01(seamWidth) * 0.040)
            * (0.24 + openingAmount * 0.76);
  var widthSquared = width * width;
  var seam = 0.0;
  var shell = 0.0;
  if (openingEnvelope > 0.0) {
    seam = smooth01(1.0 - minimumDistanceSquared
                   / max(widthSquared, 0.000001));
    shell = smooth01(1.0 - minimumDistanceSquared
                    / max(widthSquared * 8.0, 0.000001)) - seam * 0.62;
    shell = max(0.0, shell);
  }

  // Heat reservoirs sit at connected branch nodes 0–3. Squared distances keep
  // the single-pixel Organ path cheap and stationary throughout the ceremony.
  var reservoir = 0.0;
  if (isPar || isSign) {
    var reservoirWidthSquared = 0.016 + openingAmount * 0.010;
    var nodeIndex = 0.0;
    for (nodeIndex = 0.0; nodeIndex < 4.0; nodeIndex = nodeIndex + 1.0) {
      var ndx = px - nodeX[nodeIndex];
      var ndy = py - nodeY[nodeIndex];
      var nodeHeat = smooth01(1.0 - (ndx * ndx + ndy * ndy)
                             / reservoirWidthSquared);
      if (nodeHeat > reservoir) reservoir = nodeHeat;
    }
  }

  var segmentHeat = 0.68 + 0.32
                  * wave(nearestSegment * PHI + heatClock * 0.47);
  var floorLevel = 0.050 + clamp01(safetyFloor) * 0.225;
  var brightness = floorLevel + shell * openingAmount * 0.28
                 + seam * openingAmount * (0.46 + glowEnvelope * 0.42);
  var paletteMix = clamp01(0.08 + shell * 0.34
                          + seam * (0.48 + segmentHeat * 0.22));

  if (isBar) {
    // Hull Canvas carries the finite crack surface with one crisp hot center.
    brightness = floorLevel + shell * openingAmount * 0.34
               + seam * openingAmount * (0.54 + glowEnvelope * 0.42);
  } else if (isRaw) {
    // Silhouette is the broader fracture shell, keeping the ship outline alive
    // while the inner seam opens and heals.
    brightness = floorLevel + 0.045
               + shell * openingAmount * 0.68
               + seam * openingAmount * 0.28;
    paletteMix = clamp01(0.12 + shell * 0.54 + seam * 0.28);
  } else if (isVintage) {
    // Sparse deterministic hot points remain palette RGB only.
    var pointSeed = pow(wave(pixelLocalIndex * 0.38196601
                            + fixtureId * SQRT3
                            + nearestSegment * PHI), 10.0);
    var hotPoint = seam * pointSeed * openingAmount;
    brightness = floorLevel * 0.82 + 0.04
               + shell * openingAmount * 0.12
               + hotPoint * (0.58 + glowEnvelope * 0.34);
    paletteMix = clamp01(0.36 + hotPoint * 0.60);
  } else if (isPar) {
    // Organ heat is independent of Opening but spatially anchored to the
    // connected graph. Its mid-band range produces a warm, non-flashing lift.
    var reservoirHeat = reservoir * openingEnvelope;
    brightness = floorLevel + 0.08 + organHeat * 1.80
               + reservoirHeat * (0.18 + organHeat * 0.78)
               + seam * openingAmount * 0.18;
    paletteMix = clamp01(0.14 + reservoirHeat * 0.76);
  } else if (isSign) {
    // The repaired seal becomes visually plain again at envelope zero; during
    // the event its local connected graph, shell, and reservoirs stay legible.
    // A quiet repair sheen traverses the full plane continuously, keeping the
    // paired Identity treatment alive even during the long exact-zero dwell.
    var repairSheen = wave(px * 0.79 + py * 0.43 + heatClock * 0.37);
    brightness = max(0.30, floorLevel + 0.13
                   + shell * openingAmount * 0.42
                   + seam * openingAmount * 0.58
                   + reservoir * openingEnvelope * 0.22
                   + repairSheen * 0.10
                   + repairField * 0.18
                   + repairBand * (0.54 + repairField * 0.32));
    paletteMix = clamp01(0.10 + shell * 0.34
                        + seam * 0.48 + reservoir * 0.12
                        + repairSheen * 0.08 + repairField * 0.14
                        - repairBand * 0.28);
  }

  if (!isSign) {
    brightness += repairField * 0.12
                + repairBand * (0.44 + repairField * 0.24);
    paletteMix = clamp01(paletteMix + repairField * 0.12
                        - repairBand * 0.26);
  }

  // Flux-driven Opening raises fracture energy gently across the finite event,
  // making its audio mapping visible without lifting the repaired-state floor.
  if (openingEnvelope > 0.0) {
    brightness *= 0.72 + clamp01(opening) * 0.64;
    brightness += seam * openingAmount * 0.42;
  }
  brightness = clamp01(brightness);
  paletteMix = clamp01(paletteMix);
  var outR = (pr1 + (pr2 - pr1) * paletteMix) * brightness;
  var outG = (pg1 + (pg2 - pg1) * paletteMix) * brightness;
  var outB = (pb1 + (pb2 - pb1) * paletteMix) * brightness;
  rgbwau(clamp01(outR), clamp01(outG), clamp01(outB), 0.0, 0.0, 0.0);
}
