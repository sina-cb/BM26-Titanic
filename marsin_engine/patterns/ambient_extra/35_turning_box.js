// DRAFT — pending operator review
/*
  35_turning_box.js — TURNING BOX

  CONCEPT
    One immense wireframe box turns through the whole vessel. Its geometry is
    literal: twelve finite edges and eight corners, with broad translucent
    faces behind them. It is a rectilinear polyhedron, never a ring or vortex.

  INSTRUMENT STAGING
    FIX_BAR_18     — broad face panes crossed by the twelve box edges.
    FIX_RAW_LED    — the strongest far-field wireframe edge drawing.
    FIX_VINTAGE_6  — sparse palette-RGB corner gems with restrained W=A glints.
    FIX_PAR        — the eight vertex cohorts, held as large luminous pools.
    FIX_TE_SIGN    — paired miniature wireframe cubes using both sign axes.

  MOTION / MATH
    Centered XYZ is depth-sheared, then inverse-rotated around Y and X. Three
    analytic finite-segment distances cover the four X-, four Y-, and four
    Z-parallel edges. A separate nearest-corner distance exposes all eight
    signed vertex cohorts. Rotation accumulates at an irrational tilt ratio
    and wraps only after complete turns, so there is no visible phase seam.

  CONTROLS (declaration order = physical MIDI order)
    localSpeed  — speed of the continuous rigid-body rotation.
    direction   — genuine signed angular velocity; endpoints reverse travel.
    boxSize     — half-extent of the rotating polyhedron.
    edgeWidth   — thickness of all twelve finite wireframe edges.
    perspective — depth shear and secondary-axis tilt of the 3D projection.
    cornerGlow  — prominence of the eight vertex cohorts and Jewelry glints.
    safetyFloor — minimum whole-ship visibility outside the box.

  AUDIO_MODULATION_V1:
    sliderPerspective <- micFlux range 0.20..0.55 curve ease # flux opens the depth projection
    sliderCornerGlow  <- micHigh range 0.04..0.28 curve pow2 # highs illuminate the eight vertices
  Static (unmapped) params: localSpeed, direction, boxSize, edgeWidth,
    safetyFloor, colorPalette1/2.

  COLOR / OUTPUT
    Every RGB value lies on the straight cp1-to-cp2 line. Only Vintage fixtures
    emit native white, always with byte-identical W=A; UV is always zero. The
    complete box remains visible in silence above a whole-vessel safety floor.
*/

export var cp1H = 0.565, cp1S = 0.82, cp1V = 0.92;
export var cp2H = 0.095, cp2S = 0.80, cp2V = 1.00;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export var localSpeed = 0.30;
export var direction = 0.75;
export var boxSize = 0.54;
export var edgeWidth = 0.42;
export var perspective = 0.34;
export var cornerGlow = 0.20;
export var safetyFloor = 0.27;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderDirection(v) {
  direction = v;
  var dv = v * 2.0 - 1.0;
  if (dv >= 0.0 && dv < 0.06) dv = 0.06;
  else if (dv < 0.0 && dv > -0.06) dv = -0.06;
  signedDirection = dv;
}
export function sliderBoxSize(v) { boxSize = v; }
export function sliderEdgeWidth(v) { edgeWidth = v; }
export function sliderPerspective(v) { perspective = v; }
export function sliderCornerGlow(v) { cornerGlow = v; }
export function sliderSafetyFloor(v) { safetyFloor = v; }

var PHASE_WRAP = 10000.0;
var SQRT2 = 1.41421356;
var SQRT3 = 1.73205081;
var GOLDEN_ANGLE = 2.39996323;
var GOLDEN_FRACTION = 0.61803399;

var rotationPhase = 0.083;
var signedDirection = 0.50;
var cosineYaw = 1.0;
var sineYaw = 0.0;
var cosinePitch = 1.0;
var sinePitch = 0.0;

var liveBoxSize = 0.54;
var liveEdgeWidth = 0.42;
var livePerspective = 0.34;
var liveCornerGlow = 0.20;
var liveSafetyFloor = 0.27;

var pr1 = 1.0, pg1 = 0.0, pb1 = 0.0;
var pr2 = 0.0, pg2 = 0.0, pb2 = 1.0;

function clamp01(v) {
  if (v < 0.0) return 0.0;
  if (v > 1.0) return 1.0;
  return v;
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

  // Live edits converge into the geometry rather than teleporting its edges.
  var follow = min(1.0, dt * 5.0);
  liveBoxSize += (boxSize - liveBoxSize) * follow;
  liveEdgeWidth += (edgeWidth - liveEdgeWidth) * follow;
  livePerspective += (perspective - livePerspective) * follow;
  liveCornerGlow += (cornerGlow - liveCornerGlow) * follow;
  liveSafetyFloor += (safetyFloor - liveSafetyFloor) * follow;

  var localMultiplier = 0.25 + clamp01(localSpeed)
    * (32.824 - 16.412 * clamp01(localSpeed));
  rotationPhase += dt * (0.020 + localMultiplier * 0.078) * signedDirection;
  if (rotationPhase >= PHASE_WRAP) rotationPhase -= PHASE_WRAP;
  if (rotationPhase < 0.0) rotationPhase += PHASE_WRAP;

  var yaw = rotationPhase * PI2;
  // The irrational pitch ratio prevents the cube from visibly returning to a
  // short repeating pose while remaining a rigid rectilinear object.
  var pitch = rotationPhase * PI2 * SQRT2
            + (livePerspective - 0.5) * 0.72;
  cosineYaw = cos(yaw);
  sineYaw = sin(yaw);
  cosinePitch = cos(pitch);
  sinePitch = sin(pitch);

  _hsv2rgb1();
  _hsv2rgb2();
}

export function render3D(index, x, y, z) {
  var px = clamp01(x);
  var py = clamp01(y);
  var pz = clamp01(z);
  var isSign = fixtureType == FIX_TE_SIGN;

  if (isSign) {
    // Each sign spans a 40-pixel fixture plus a 34-pixel fixture. Address one
    // complete 74-pixel projection so every edge continues across the split.
    var signIndex = index % 74.0;
    px = (signIndex % 10.0) / 9.0;
    py = floor(signIndex / 10.0) / 7.0;
    pz = 0.50 + (py - 0.50) * 0.14;
  }

  var centeredX = px - 0.50;
  var centeredY = py - 0.50;
  var centeredZ = pz - 0.50;

  // Perspective is a true depth projection handle: increasing it separates
  // the near and far edge families before the inverse rigid-body rotation.
  var depthShear = (livePerspective - 0.50) * 0.76;
  var projectedX = centeredX + centeredZ * depthShear;
  var projectedY = centeredY - centeredZ * depthShear * 0.48;

  var yawX = projectedX * cosineYaw + centeredZ * sineYaw;
  var yawZ = -projectedX * sineYaw + centeredZ * cosineYaw;
  var boxX = yawX;
  var boxY = projectedY * cosinePitch + yawZ * sinePitch;
  var boxZ = -projectedY * sinePitch + yawZ * cosinePitch;

  var absX = abs(boxX);
  var absY = abs(boxY);
  var absZ = abs(boxZ);
  var halfExtent = 0.17 + clamp01(liveBoxSize) * 0.27;

  // Exact distance to each set of four finite parallel segments. Along-axis
  // excess is clamped to the segment endpoints; the other two axes measure
  // distance to either signed face. min(x,y,z) covers all twelve box edges.
  var excessX = max(0.0, absX - halfExtent);
  var excessY = max(0.0, absY - halfExtent);
  var excessZ = max(0.0, absZ - halfExtent);
  var faceX = abs(absX - halfExtent);
  var faceY = abs(absY - halfExtent);
  var faceZ = abs(absZ - halfExtent);

  var xEdgeDistance = sqrt(excessX * excessX
                         + faceY * faceY + faceZ * faceZ);
  var yEdgeDistance = sqrt(faceX * faceX
                         + excessY * excessY + faceZ * faceZ);
  var zEdgeDistance = sqrt(faceX * faceX
                         + faceY * faceY + excessZ * excessZ);
  var edgeDistance = min(xEdgeDistance,
                         min(yEdgeDistance, zEdgeDistance));

  // A generous physical core keeps all twelve finite families connected on
  // the sparse ship while still leaving the translucent faces subordinate.
  var width = 0.024 + clamp01(liveEdgeWidth) * 0.105;
  var edgeCore = 1.0 - smoothstep(width * 0.38, width, edgeDistance);
  var edgeHalo = 1.0 - smoothstep(width, width * 2.65, edgeDistance);

  // Sparse fixture topology cannot sample every true 3D edge continuously.
  // This orthographic projection is of the same inverse-rotated cuboid and
  // keeps connected corner junctions legible while the XYZ SDF supplies its
  // changing depth and face family.
  var projectedXEdgeDistance = sqrt(excessX * excessX
                                  + faceY * faceY);
  var projectedYEdgeDistance = sqrt(faceX * faceX
                                  + excessY * excessY);
  var projectedEdgeDistance = min(projectedXEdgeDistance,
                                  projectedYEdgeDistance);
  var projectedWidth = width * 1.55;
  var projectedEdgeCore = 1.0 - smoothstep(projectedWidth * 0.34,
                                           projectedWidth,
                                           projectedEdgeDistance);
  var projectedEdgeHalo = 1.0 - smoothstep(projectedWidth,
                                           projectedWidth * 2.20,
                                           projectedEdgeDistance);

  // Nearest of all eight signed vertices. The sign of each centered axis
  // selects the cohort; the analytic distance preserves all eight corners.
  var cornerDistance = sqrt(faceX * faceX
                          + faceY * faceY + faceZ * faceZ);
  var cornerRadius = 0.045 + clamp01(liveCornerGlow) * 0.160;
  var cornerCore = 1.0 - smoothstep(cornerRadius * 0.30,
                                    cornerRadius, cornerDistance);
  var cornerHalo = 1.0 - smoothstep(cornerRadius,
                                    cornerRadius * 2.35, cornerDistance);
  var projectedCornerDistance = sqrt(faceX * faceX + faceY * faceY);
  var projectedCornerCore = 1.0 - smoothstep(cornerRadius * 0.30,
                                             cornerRadius * 1.10,
                                             projectedCornerDistance);
  var projectedCornerHalo = 1.0 - smoothstep(cornerRadius,
                                             cornerRadius * 2.10,
                                             projectedCornerDistance);
  var visibleEdgeCore = max(edgeCore, projectedEdgeCore);
  var visibleEdgeHalo = max(edgeHalo, projectedEdgeHalo);
  var visibleCornerCore = max(cornerCore, projectedCornerCore);
  var visibleCornerHalo = max(cornerHalo, projectedCornerHalo);

  // A thin cuboid shell is the broad-face layer. It gives the Hull a readable
  // pane while leaving enough negative space for the rectilinear edges.
  var maximumAxis = max(absX, max(absY, absZ));
  var faceDistance = abs(maximumAxis - halfExtent);
  var insideGate = 1.0 - smoothstep(halfExtent,
                                    halfExtent + 0.035, maximumAxis);
  var facePane = (1.0 - smoothstep(0.014, 0.070, faceDistance))
               * insideGate;

  // Corner cohort index (0..7) supplies an ordered palette distinction rather
  // than inventing colors outside the operator's selected line.
  var cornerCohort = 0.0;
  if (boxX >= 0.0) cornerCohort += 1.0;
  if (boxY >= 0.0) cornerCohort += 2.0;
  if (boxZ >= 0.0) cornerCohort += 4.0;

  var floorLevel = 0.035 + clamp01(liveSafetyFloor) * 0.205;
  var brightness = floorLevel + facePane * 0.055
                 + visibleEdgeHalo * 0.28 + visibleEdgeCore * 0.76
                 + visibleCornerHalo * liveCornerGlow * 0.34
                 + visibleCornerCore * liveCornerGlow * 0.48;
  var paletteMix = clamp01(0.10 + cornerCohort / 7.0 * 0.78
                          + edgeCore * 0.08);
  var nativeWhite = 0.0;

  if (fixtureType == FIX_BAR_18) {
    // Hull Canvas carries broad translucent faces and an exact edge overlay.
    var faceFacet = 0.5 + 0.5 * (boxX + boxY * SQRT2 - boxZ * SQRT3)
                  / (halfExtent * (1.0 + SQRT2 + SQRT3));
    brightness = floorLevel + facePane * (0.020 + faceFacet * 0.040)
               + visibleEdgeHalo * 0.36 + visibleEdgeCore * 1.02
               + visibleCornerHalo * liveCornerGlow * 0.56
               + visibleCornerCore * liveCornerGlow * 0.48;
    paletteMix = clamp01(0.08 + faceFacet * 0.66
                       + edgeCore * 0.18 + cornerCore * 0.10);
  } else if (fixtureType == FIX_RAW_LED) {
    // Silhouette is the far-field wireframe: the twelve finite edge families
    // are dominant while the bed preserves the vessel outline between them.
    brightness = floorLevel + 0.045 + facePane * 0.012
               + visibleEdgeHalo * 0.52 + visibleEdgeCore * 1.24
               + visibleCornerHalo * liveCornerGlow * 0.62
               + visibleCornerCore * liveCornerGlow * 0.72;
    paletteMix = clamp01(0.10 + cornerCohort / 7.0 * 0.70
                       + edgeCore * 0.16);
  } else if (fixtureType == FIX_VINTAGE_6) {
    // Jewelry marks sparse cube corners. The glint gate is deterministic,
    // palette-derived RGB remains underneath, and native white is matched W=A.
    var gemPhase = 0.5 + 0.5
                 * sin(pixelLocalIndex * GOLDEN_ANGLE
                       + cornerCohort * GOLDEN_FRACTION
                       + rotationPhase * PI2 * 0.37);
    var gem = pow(gemPhase, 10.0)
            * (0.24 + max(visibleCornerHalo,
                          visibleEdgeCore * 0.35) * 0.76);
    brightness = floorLevel * 0.70 + 0.045
               + visibleEdgeHalo * 0.14
               + visibleCornerHalo * liveCornerGlow * 0.28
               + gem * (0.28 + liveCornerGlow * 0.76);
    paletteMix = clamp01(0.18 + cornerCohort / 7.0 * 0.72
                       + gem * 0.10);
    nativeWhite = gem * liveCornerGlow * 0.32;
  } else if (fixtureType == FIX_PAR) {
    // Organs are the eight large vertex cohorts, not a generic wash.
    var organVertex = 0.5 + 0.5
                    * sin(pixelLocalIndex * GOLDEN_ANGLE
                          + rotationPhase * PI2 * GOLDEN_FRACTION);
    brightness = floorLevel + 0.08
               + visibleCornerHalo * (0.18 + liveCornerGlow * 0.52)
               + visibleCornerCore * (0.28 + liveCornerGlow * 0.72)
               + visibleEdgeCore * 0.15
               + pow(organVertex, 8.0) * liveCornerGlow * 0.46;
    paletteMix = clamp01(0.08 + cornerCohort / 7.0 * 0.86);
  } else if (isSign) {
    // Each TE sign receives a complete paired miniature cube at a protected
    // identity floor, with active faces, edges, depth, and all corner cohorts.
    brightness = max(0.28, floorLevel + 0.12 + facePane * 0.018
                   + visibleEdgeHalo * 0.54 + visibleEdgeCore * 1.12
                   + visibleCornerHalo * liveCornerGlow * 0.62
                   + visibleCornerCore * liveCornerGlow * 0.72);
    paletteMix = clamp01(0.10 + cornerCohort / 7.0 * 0.76
                       + edgeCore * 0.12);
  }

  brightness = clamp01(brightness);
  nativeWhite = clamp01(nativeWhite);
  paletteMix = clamp01(paletteMix);
  var outR = (pr1 + (pr2 - pr1) * paletteMix) * brightness;
  var outG = (pg1 + (pg2 - pg1) * paletteMix) * brightness;
  var outB = (pb1 + (pb2 - pb1) * paletteMix) * brightness;
  rgbwau(clamp01(outR), clamp01(outG), clamp01(outB),
         nativeWhite, nativeWhite, 0.0);
}
