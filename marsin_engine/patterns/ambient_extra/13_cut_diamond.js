// DRAFT — pending operator review
/*
  13_cut_diamond.js — CUT DIAMOND

  CONCEPT
    One immense rotating cut-gem octahedron passes through the whole ship.
    Broad triangular faces, a precise diamond perimeter, and sparse cut points
    make it read as a single faceted object rather than a ring or wave field.

  INSTRUMENT STAGING
    FIX_BAR_18     — the broad Hull facets and their planar color changes.
    FIX_RAW_LED    — a bright, precise Silhouette diamond perimeter.
    FIX_VINTAGE_6  — sparse cut highlights with matched native W=A.
    FIX_PAR        — the six octahedral vertices, held as structural jewels.
    FIX_TE_SIGN    — identical paired miniature gemstone seals with a firm
                     legibility floor and internally moving facet light.

  MOTION / MATH
    Centered model coordinates rotate around two axes at irrationally related
    rates. The exact shell is the octahedron SDF
    abs(rx)+abs(ry)+abs(rz)-radius. Six to ten broad analytic facet cuts cross
    its faces; their orientation selects a position on the cp1-to-cp2 RGB
    line. Accumulators wrap only at 10000 turns, far from an in-frame seam.

  CONTROLS (declaration order = physical MIDI order)
    localSpeed  — rate of the continuous two-axis gemstone rotation.
    facetCount  — apparent count of broad major cut planes, six through ten.
    diamondSize — radius and model reach of the octahedral shell.
    turn        — depth and obliqueness of the rotating presentation.
    edgeWidth   — literal width and prominence of the diamond perimeter.
    jewelryCut  — strength of sparse Vintage cut highlights and native white.
    safetyFloor — minimum palette-derived visibility across the whole rig.

  AUDIO_MODULATION_V1:
    sliderDiamondSize <- micFlux range 0.32..0.68 curve ease  # flux expands the cut gemstone through the ship
    sliderJewelryCut   <- micHigh range 0.04..0.38 curve pow2 # highs reveal sparse white cut points
  Static (unmapped) params: localSpeed, facetCount, turn, edgeWidth,
    safetyFloor, colorPalette1/2.

  COLOR / OUTPUT
    RGB always lies on the selected cp1-to-cp2 line. Only Vintage fixtures
    emit native white, with W and A byte-identical. UV is always zero. The
    safety floor leaves a complete, attractive silhouette in silence.
*/

export var cp1H = 0.56, cp1S = 0.80, cp1V = 0.88;
export var cp2H = 0.105, cp2S = 0.70, cp2V = 1.00;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export var localSpeed = 0.30;
export var facetCount = 0.48;
export var diamondSize = 0.52;
export var turn = 0.58;
export var edgeWidth = 0.34;
export var jewelryCut = 0.28;
export var safetyFloor = 0.28;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderFacetCount(v) { facetCount = v; }
export function sliderDiamondSize(v) { diamondSize = v; }
export function sliderTurn(v) { turn = v; }
export function sliderEdgeWidth(v) { edgeWidth = v; }
export function sliderJewelryCut(v) { jewelryCut = v; }
export function sliderSafetyFloor(v) { safetyFloor = v; }

var SQRT2 = 1.41421356;
var SQRT3 = 1.73205081;
var PHI = 1.61803399;
var GOLDEN_ANGLE = 2.39996323;
var PHASE_WRAP = 10000.0;

var rotationPhase = 0.0;
var secondaryPhase = 0.0;
var cosYaw = 1.0, sinYaw = 0.0;
var cosPitch = 1.0, sinPitch = 0.0;

var liveFacetCount = 7.92;
var liveRadius = 0.51;
var liveTurn = 0.58;
var liveEdgeWidth = 0.34;
var liveJewelryCut = 0.28;
var liveFloor = 0.28;

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

  // Every edit is slewed. Geometry, edge width, light and floor therefore
  // change continuously while the operator works the physical controls.
  var shapeFollow = min(1.0, dt * 4.5);
  var lightFollow = min(1.0, dt * 8.0);
  liveFacetCount += (6.0 + clamp01(facetCount) * 4.0 - liveFacetCount)
                  * shapeFollow;
  liveRadius += (0.30 + clamp01(diamondSize) * 0.40 - liveRadius)
              * shapeFollow;
  liveTurn += (clamp01(turn) - liveTurn) * shapeFollow;
  liveEdgeWidth += (clamp01(edgeWidth) - liveEdgeWidth) * shapeFollow;
  liveJewelryCut += (clamp01(jewelryCut) - liveJewelryCut) * lightFollow;
  liveFloor += (clamp01(safetyFloor) - liveFloor) * lightFollow;

  var localMult = 0.25 + clamp01(localSpeed)
    * (32.824 - 16.412 * clamp01(localSpeed));
  var rotationRate = 0.055 + localMult * 0.145;
  rotationPhase += dt * rotationRate;
  secondaryPhase += dt * rotationRate * SQRT2;
  if (rotationPhase >= PHASE_WRAP) rotationPhase -= PHASE_WRAP;
  if (secondaryPhase >= PHASE_WRAP) secondaryPhase -= PHASE_WRAP;

  var turnReach = 0.16 + liveTurn * 0.70;
  var yaw = rotationPhase * PI2;
  var pitch = sin(secondaryPhase * PI2) * turnReach
            + sin(rotationPhase * PI2 * 0.38196601) * turnReach * 0.24;
  cosYaw = cos(yaw);
  sinYaw = sin(yaw);
  cosPitch = cos(pitch);
  sinPitch = sin(pitch);

  _hsv2rgb1();
  _hsv2rgb2();
}

export function render3D(index, x, y, z) {
  var ux = clamp01(x);
  var uy = clamp01(y);
  var uz = clamp01(z);
  var isSign = fixtureType == FIX_TE_SIGN;

  if (isSign) {
    // The local 10x8 map is identical for both 74-pixel fixtures. It keeps
    // the two signs balanced while giving each one a complete gemstone seal.
    var signIndex = index % 74.0;
    ux = (signIndex % 10.0) / 9.0;
    uy = floor(signIndex / 10.0) / 7.0;
    uz = 0.50;
  }

  var px = ux - 0.50;
  var py = uy - 0.50;
  var pz = uz - 0.50;

  // Rotate first around Y, then around X. Both matrices remain orthonormal,
  // so the octahedral signed distance retains its precise straight faces.
  var yawX = px * cosYaw - pz * sinYaw;
  var yawZ = px * sinYaw + pz * cosYaw;
  var rx = yawX;
  var ry = py * cosPitch - yawZ * sinPitch;
  var rz = py * sinPitch + yawZ * cosPitch;

  var ax = abs(rx);
  var ay = abs(ry);
  var az = abs(rz);
  var sumAbs = ax + ay + az;
  var signedDistance = sumAbs - liveRadius;
  var shellDistance = abs(signedDistance);
  var edgeSize = 0.012 + liveEdgeWidth * 0.070;
  var perimeter = 1.0 - smoothstep(edgeSize, edgeSize + 0.032,
                                    shellDistance);
  var inside = 1.0 - smoothstep(0.0, 0.095, signedDistance);

  // An oblique orthographic projection of the octahedron produces its
  // characteristic six-vertex closed shell. This macro outline survives the
  // Titanic's sparse samples while the 3D SDF still carries triangular faces.
  var projectedRadius = liveRadius * (0.76 + liveTurn * 0.12);
  var screenX = rx + rz * 0.34;
  var screenY = ry - rz * 0.27;
  var hexRadius = projectedRadius * 0.92;
  var hexNorm = max(abs(screenY),
                    abs(screenX) * 0.86602540 + abs(screenY) * 0.50);
  var projectedDistance = abs(hexNorm - hexRadius);
  var projectedEdge = 1.0 - smoothstep(edgeSize * 1.20,
                                      edgeSize * 2.8 + 0.035,
                                      projectedDistance);
  var projectedInside = 1.0 - smoothstep(0.0, 0.070,
                                        hexNorm - hexRadius);

  // This analytic cut coordinate makes six to ten broad major facet planes.
  // Facet shading is stable inside each plane, while narrow bevels articulate
  // the cuts. Its orientation also chooses the palette position.
  var safeRadius = liveRadius + 0.0001;
  var cutCoordinate = (rx * 0.68 + ry * 0.48 - rz * 0.62)
                    / safeRadius;
  var cutPhase = cutCoordinate * liveFacetCount
               + secondaryPhase * 0.043;
  var cutCell = cutPhase - floor(cutPhase);
  var cutDistance = abs(cutCell - 0.50) * 2.0;
  var broadFacet = smooth01(cutDistance);
  var bevel = 1.0 - smoothstep(0.76, 0.96, cutDistance);
  var cutRidge = 1.0 - smoothstep(0.10, 0.34, cutDistance);

  // True octahedron-face orientation: each sign triplet addresses one of the
  // eight triangular faces. Continuous coordinate detail avoids flat panels.
  var faceOrientation = 0.50
                      + (rx * 0.47 + ry * 0.31 - rz * 0.39) / safeRadius;
  faceOrientation = clamp01(faceOrientation);
  // Eight signed triangular face families become broad, high-authority
  // material regions rather than a continuously mottled teal/gold wash.
  var faceFamily = 0.50;
  faceFamily += rx >= 0.0 ? 0.22 : -0.22;
  faceFamily += ry >= 0.0 ? 0.13 : -0.13;
  faceFamily += rz >= 0.0 ? 0.09 : -0.09;
  faceFamily = clamp01(faceFamily);
  var facetLight = clamp01(0.10 + broadFacet * 0.62
                          + faceFamily * 0.28);

  var largestAxis = max(ax, max(ay, az));
  var minorAxes = sumAbs - largestAxis;
  var vertexShape = smooth01(1.0 - minorAxes / (safeRadius * 0.38));
  var vertexReach = smooth01(1.0
                            - abs(largestAxis - liveRadius)
                            / (edgeSize * 2.8 + 0.055));
  var vertex = vertexShape * vertexReach;

  var floorLevel = 0.045 + liveFloor * 0.245;
  var brightness = floorLevel
                 + projectedInside * (0.045 + facetLight * 0.31)
                 + projectedEdge * (0.31 + liveEdgeWidth * 0.24)
                 + inside * (0.025 + facetLight * 0.10)
                 + perimeter * (0.12 + liveEdgeWidth * 0.18)
                 + broadFacet * inside * 0.26
                 + bevel * inside * 0.08 + cutRidge * inside * 0.14;
  var paletteMix = clamp01(0.04 + faceFamily * 0.72
                          + broadFacet * 0.25 - cutRidge * 0.14);
  var nativeWhite = 0.0;

  if (fixtureType == FIX_BAR_18) {
    // Hull Canvas carries the large triangular material faces. The perimeter
    // stays subordinate here so facet orientation remains the hero.
    brightness = floorLevel
               + projectedInside * (0.035 + facetLight * 0.40)
               + projectedEdge * (0.29 + liveEdgeWidth * 0.25)
               + inside * 0.055 + perimeter * 0.11
               + broadFacet * inside * 0.34
               + bevel * inside * 0.035 + cutRidge * inside * 0.30;
    paletteMix = clamp01(0.03 + faceFamily * 0.72
                        + broadFacet * 0.28);
  } else if (fixtureType == FIX_RAW_LED) {
    // Silhouette is the crisp outline that makes the gemstone readable from
    // across playa, with a continuous lit bed outside the active shell.
    brightness = floorLevel + 0.075 + projectedInside * 0.055
               + projectedEdge * (0.69 + liveEdgeWidth * 0.27)
               + perimeter * 0.22 + vertex * 0.14
               + broadFacet * inside * 0.18
               + cutRidge * inside * 0.18;
    paletteMix = clamp01(0.04 + faceFamily * 0.66
                        + projectedEdge * 0.26);
  } else if (fixtureType == FIX_VINTAGE_6) {
    // Sparse golden-angle cuts keep native white exclusive to Jewelry. W and
    // A share the exact expression; RGB remains on the selected palette line.
    var cutPulse = wave(pixelLocalIndex * GOLDEN_ANGLE
                       + secondaryPhase * SQRT3 + x * 0.37 + z * 0.23);
    var sparseCut = pow(cutPulse, 10.0);
    var cutEnergy = sparseCut
                  * (0.12 + perimeter * 0.48 + projectedEdge * 0.52);
    brightness = floorLevel * 0.78 + 0.06 + inside * 0.10
               + cutEnergy * (0.20 + liveJewelryCut * 0.58);
    paletteMix = clamp01(0.60 + faceOrientation * 0.28
                        + sparseCut * 0.10);
    nativeWhite = clamp01(cutEnergy * liveJewelryCut * 0.82);
  } else if (fixtureType == FIX_PAR) {
    // Organs become the six axis vertices rather than repeating the face fill.
    brightness = floorLevel + 0.09 + vertex * 0.72
               + projectedEdge * 0.25 + perimeter * 0.12
               + facetLight * 0.07;
    paletteMix = clamp01(0.18 + faceOrientation * 0.62
                        + vertex * 0.18);
  } else if (isSign) {
    // Paired gemstone seals: a stable name bed, bright diamond perimeter and
    // broad interior cuts. The same local coordinates make both signs exact.
    var signX = ux - 0.50;
    var signY = uy - 0.50;
    var signTurn = rotationPhase * PI2 * 0.73;
    var signCos = cos(signTurn);
    var signSin = sin(signTurn);
    var signRx = signX * signCos - signY * signSin;
    var signRy = signX * signSin + signY * signCos;
    var signRadius = 0.34 + liveRadius * 0.16;
    var signSdf = max(abs(signRy),
                      abs(signRx) * 0.86602540 + abs(signRy) * 0.50)
                - signRadius;
    var signEdge = 1.0 - smoothstep(edgeSize, edgeSize + 0.045,
                                    abs(signSdf));
    var signInside = 1.0 - smoothstep(0.0, 0.075, signSdf);
    var signCut = wave((signRx * 1.37 - signRy * SQRT2)
                      * liveFacetCount + secondaryPhase * 0.31);
    brightness = max(0.34, floorLevel + 0.15 + signInside * 0.09
                    + signEdge * (0.66 + liveEdgeWidth * 0.26)
                    + signCut * signInside * 0.12);
    // Cyan interior versus a gold perimeter makes the paired seal read as a
    // diamond at a glance instead of another mixed-color sign texture.
    paletteMix = clamp01(0.045 + signInside * 0.10
                        + signEdge * 0.88 + signCut * signInside * 0.14);
  }

  brightness = clamp01(brightness);
  paletteMix = clamp01(paletteMix);
  nativeWhite = clamp01(nativeWhite);
  var outR = (pr1 + (pr2 - pr1) * paletteMix) * brightness;
  var outG = (pg1 + (pg2 - pg1) * paletteMix) * brightness;
  var outB = (pb1 + (pb2 - pb1) * paletteMix) * brightness;
  rgbwau(clamp01(outR), clamp01(outG), clamp01(outB),
         nativeWhite, nativeWhite, 0.0);
}
