// DRAFT — pending operator review
/*
  11_paper_fold.js — PAPER FOLD

  CONCEPT
    One immense luminous sheet folds through the vessel. Three permanent fold
    planes and three smoothly recruited planes divide it into broad shaded
    facets, with razor-fine creases drawn across the physical outline.

  INSTRUMENT STAGING
    FIX_BAR_18     — the main sheet: large shaded facets and crisp creases.
    FIX_RAW_LED    — the continuous fold perimeter, always visibly outlined.
    FIX_VINTAGE_6  — restrained palette-RGB pins placed on select creases.
    FIX_PAR        — hinge anchors that brighten where fold planes converge.
    FIX_TE_SIGN    — balanced paired 10x8 folded stamps with a strong floor.

  MOTION / MATH
    Six independently oriented analytic planes drift at irrationally related
    rates. Coordinates are conditionally reflected across each plane in turn;
    the reflection is continuous at the plane and its strength is controlled
    by foldAngle. The minimum plane distance is a crease SDF, while the final
    reflected normal supplies facet shading and palette position. There is no
    wave lattice, rib field, noise, array, or allocation in render3D.

  CONTROLS (declaration order = physical MIDI order)
    localSpeed  — drift rate of all fold-plane orientations.
    creaseCount — smoothly recruits folds four through six and tightens facets.
    foldAngle   — depth and angular separation of adjacent paper facets.
    creaseWidth — literal width and prominence of the crease drawing.
    facetDepth  — contrast between shaded facet orientations.
    level       — expressive light level above the safety floor.
    safetyFloor — minimum whole-ship visibility in silence.

  AUDIO_MODULATION_V1:
    sliderFoldAngle   <- micFlux range 0.22..0.62 curve ease   # flux opens the folded sheet
    sliderCreaseWidth <- micHigh range 0.06..0.25 curve linear # highs sharpen the crease drawing
  Static (unmapped) params: localSpeed, creaseCount, facetDepth, level,
    safetyFloor, colorPalette1/2.

  COLOR / OUTPUT
    Every RGB value lies strictly on the cp1-to-cp2 RGB line. Jewelry pins are
    palette RGB rather than native white; W=A=U=0 exactly. The unmapped silence
    defaults form a complete, legible ambient composition.
*/

// Global palette controls precede every local control.
export var cp1H = 0.59, cp1S = 0.80, cp1V = 0.88;
export var cp2H = 0.105, cp2S = 0.82, cp2V = 1.00;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export var localSpeed = 0.30;
export var creaseCount = 0.48;
export var foldAngle = 0.42;
export var creaseWidth = 0.18;
export var facetDepth = 0.58;
export var level = 0.68;
export var safetyFloor = 0.28;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderCreaseCount(v) { creaseCount = v; }
export function sliderFoldAngle(v) { foldAngle = v; }
export function sliderCreaseWidth(v) { creaseWidth = v; }
export function sliderFacetDepth(v) { facetDepth = v; }
export function sliderLevel(v) { level = v; }
export function sliderSafetyFloor(v) { safetyFloor = v; }

var PHASE_WRAP = 10000.0;
var GOLDEN_ANGLE = 2.39996323;
var PHI = 1.61803399;
var SQRT2 = 1.41421356;
var SQRT3 = 1.73205081;

var foldClock = 0.071;
var liveCount = 0.48;
var liveAngle = 0.42;
var liveWidth = 0.18;
var liveDepth = 0.58;
var liveLevel = 0.68;
var liveFloor = 0.28;

var n1x = 0.70, n1y = 0.22, n1z = 0.68;
var n2x = -0.31, n2y = 0.88, n2z = 0.36;
var n3x = 0.55, n3y = -0.64, n3z = 0.54;
var n4x = -0.77, n4y = -0.18, n4z = 0.61;
var n5x = 0.18, n5y = 0.62, n5z = -0.76;
var n6x = 0.88, n6y = -0.41, n6z = -0.24;

var o1 = -0.16, o2 = 0.19, o3 = -0.02;
var o4 = 0.13, o5 = -0.21, o6 = 0.06;

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

  // Every editable quality slews into the sheet; no knob teleports geometry.
  var shapeFollow = min(1.0, dt * 4.2);
  var lightFollow = min(1.0, dt * 8.0);
  liveCount += (clamp01(creaseCount) - liveCount) * shapeFollow;
  liveAngle += (clamp01(foldAngle) - liveAngle) * shapeFollow;
  liveWidth += (clamp01(creaseWidth) - liveWidth) * shapeFollow;
  liveDepth += (clamp01(facetDepth) - liveDepth) * shapeFollow;
  liveLevel += (clamp01(level) - liveLevel) * lightFollow;
  liveFloor += (clamp01(safetyFloor) - liveFloor) * lightFollow;

  var localMult = 0.25 + clamp01(localSpeed)
    * (32.824 - 16.412 * clamp01(localSpeed));
  foldClock += dt * (0.006 + localMult * 0.027);
  if (foldClock >= PHASE_WRAP) foldClock -= PHASE_WRAP;

  // Irrationally related angular rates prevent a short visual relock.
  var a1 = foldClock * PI2;
  var a2 = foldClock * PI2 * SQRT2 + GOLDEN_ANGLE;
  var a3 = foldClock * PI2 * SQRT3 + GOLDEN_ANGLE * 2.0;
  var a4 = foldClock * PI2 * PHI + GOLDEN_ANGLE * 3.0;
  var a5 = foldClock * PI2 * 0.75487767 + GOLDEN_ANGLE * 4.0;
  var a6 = foldClock * PI2 * 1.32471796 + GOLDEN_ANGLE * 5.0;

  n1x = cos(a1) * 0.88; n1y = sin(a1 * 0.37) * 0.28; n1z = sin(a1) * 0.88;
  n2x = cos(a2) * 0.73; n2y = sin(a2) * 0.56; n2z = sin(a2) * 0.73;
  n3x = cos(a3) * 0.62; n3y = cos(a3) * 0.68; n3z = sin(a3) * 0.62;
  n4x = cos(a4) * 0.81; n4y = sin(a4) * 0.38; n4z = sin(a4) * 0.81;
  n5x = cos(a5) * 0.67; n5y = cos(a5) * 0.62; n5z = sin(a5) * 0.67;
  n6x = cos(a6) * 0.76; n6y = sin(a6) * 0.49; n6z = sin(a6) * 0.76;

  // Plane offsets drift slowly but remain finite inside the model bounds.
  o1 = -0.17 + 0.035 * sin(a2 * 0.19);
  o2 = 0.18 + 0.040 * cos(a3 * 0.17);
  o3 = -0.01 + 0.045 * sin(a4 * 0.13);
  o4 = 0.13 + 0.035 * cos(a5 * 0.23);
  o5 = -0.20 + 0.040 * sin(a6 * 0.16);
  o6 = 0.055 + 0.035 * cos(a1 * 0.29);

  _hsv2rgb1();
  _hsv2rgb2();
}

export function render3D(index, x, y, z) {
  var ux = clamp01(x);
  var uy = clamp01(y);
  var uz = clamp01(z);
  var isSign = fixtureType == FIX_TE_SIGN;

  if (isSign) {
    // The sign's 40 + 34 fixture split must become one complete 74-pixel
    // surface before the shared 10x8 folded stamp is evaluated.
    var signIndex = index % 74.0;
    ux = (signIndex % 10.0) / 9.0;
    uy = floor(signIndex / 10.0) / 7.0;
    uz = 0.43 + ux * 0.08 + uy * 0.10;
  }

  var fx = ux - 0.50;
  var fy = uy - 0.50;
  var fz = uz - 0.50;
  var reflectStrength = 0.12 + liveAngle * 0.82;

  // Three planes are permanent. Planes four through six recruit smoothly as
  // creaseCount rises, preserving continuity while spanning roughly 3..6.
  var countSpan = liveCount * 3.0;
  // Keep the default composition to three immense facets and one dominant
  // hinge. Additional planes arrive late in the knob range, so Crease Count
  // still spans the full 3..6 topology without turning the ambient default
  // into the six-fold visual density reserved for Folded Flags.
  var w4 = smooth01(countSpan - 0.65);
  var w5 = smooth01(countSpan - 1.45);
  var w6 = smooth01(countSpan - 2.25);

  var d1 = fx * n1x + fy * n1y + fz * n1z - o1;
  var heroDistance = abs(d1);
  var heroFace = d1 > 0.0;
  var creaseDistance = abs(d1);
  var orientation = 0.0;
  if (d1 > 0.0) {
    fx -= 2.0 * d1 * n1x * reflectStrength;
    fy -= 2.0 * d1 * n1y * reflectStrength;
    fz -= 2.0 * d1 * n1z * reflectStrength;
    orientation += 0.30;
  } else orientation -= 0.30;

  var d2 = fx * n2x + fy * n2y + fz * n2z - o2;
  creaseDistance = min(creaseDistance, abs(d2));
  if (d2 > 0.0) {
    fx -= 2.0 * d2 * n2x * reflectStrength;
    fy -= 2.0 * d2 * n2y * reflectStrength;
    fz -= 2.0 * d2 * n2z * reflectStrength;
    orientation += 0.10;
  } else orientation -= 0.10;

  var d3 = fx * n3x + fy * n3y + fz * n3z - o3;
  creaseDistance = min(creaseDistance, abs(d3));
  if (d3 > 0.0) {
    fx -= 2.0 * d3 * n3x * reflectStrength;
    fy -= 2.0 * d3 * n3y * reflectStrength;
    fz -= 2.0 * d3 * n3z * reflectStrength;
    orientation += 0.08;
  } else orientation -= 0.08;

  var d4 = fx * n4x + fy * n4y + fz * n4z - o4;
  creaseDistance = min(creaseDistance, abs(d4) + (1.0 - w4) * 2.0);
  if (d4 > 0.0) {
    fx -= 2.0 * d4 * n4x * reflectStrength * w4;
    fy -= 2.0 * d4 * n4y * reflectStrength * w4;
    fz -= 2.0 * d4 * n4z * reflectStrength * w4;
    orientation += 0.09 * w4;
  } else orientation -= 0.09 * w4;

  var d5 = fx * n5x + fy * n5y + fz * n5z - o5;
  creaseDistance = min(creaseDistance, abs(d5) + (1.0 - w5) * 2.0);
  if (d5 > 0.0) {
    fx -= 2.0 * d5 * n5x * reflectStrength * w5;
    fy -= 2.0 * d5 * n5y * reflectStrength * w5;
    fz -= 2.0 * d5 * n5z * reflectStrength * w5;
    orientation += 0.07 * w5;
  } else orientation -= 0.07 * w5;

  var d6 = fx * n6x + fy * n6y + fz * n6z - o6;
  creaseDistance = min(creaseDistance, abs(d6) + (1.0 - w6) * 2.0);
  if (d6 > 0.0) {
    fx -= 2.0 * d6 * n6x * reflectStrength * w6;
    fy -= 2.0 * d6 * n6y * reflectStrength * w6;
    fz -= 2.0 * d6 * n6z * reflectStrength * w6;
    orientation += 0.06 * w6;
  } else orientation -= 0.06 * w6;

  var width = 0.008 + liveWidth * 0.060;
  var crease = 1.0 - smoothstep(width, width * 2.6, creaseDistance);
  var heroCrease = 1.0 - smoothstep(width * 1.25, width * 4.2,
                                    heroDistance);
  var foldShade = clamp01(0.50 + orientation * (0.50 + liveDepth * 1.05)
                        + (fx * 0.28 + fy * 0.17 - fz * 0.22) * liveDepth);
  var facetContrast = 0.20 + liveDepth * 0.68;
  var paletteMix = clamp01(0.50 + orientation * 0.92
                         + (foldShade - 0.50) * facetContrast * 0.44
                         + (heroFace ? 0.16 : -0.16));

  var floorLevel = 0.045 + liveFloor * 0.255;
  // The primary plane changes the material luminance face-to-face. This
  // produces the unmistakable giant folded-sheet read at playa distance;
  // secondary creases remain close-detail articulation.
  var heroFaceLight = heroFace ? 0.17 : -0.075;
  var face = 0.34 + foldShade * (0.18 + facetContrast * 0.34)
           + heroFaceLight;
  var brightness = floorLevel + (1.0 - floorLevel)
                 * liveLevel * clamp01(face
                   + crease * (0.11 + liveWidth * 0.30)
                   + heroCrease * (0.22 + liveWidth * 0.52));

  if (fixtureType == FIX_RAW_LED) {
    // Silhouette draws the fold perimeter and cannot vanish between creases.
    brightness = clamp01(floorLevel + 0.15 + liveLevel
                       * (0.16 + crease * (0.20 + liveWidth * 0.20)
                        + heroCrease * (0.48 + liveWidth * 0.34)
                        + foldShade * 0.08));
    paletteMix = clamp01(paletteMix + heroCrease * 0.19);
  } else if (fixtureType == FIX_VINTAGE_6) {
    // Golden-angle pin selection avoids regimented chases. All pin light is
    // still strict palette RGB and remains restrained at ambient defaults.
    var pinPhase = 0.5 + 0.5 * cos(pixelLocalIndex * GOLDEN_ANGLE
                                  + foldClock * PI2 * 0.41);
    var pin = pow(pinPhase, 10.0) * max(crease * 0.45, heroCrease);
    brightness = clamp01(floorLevel * 0.72 + 0.055
                       + liveLevel * (foldShade * 0.08 + pin * 0.62));
    paletteMix = clamp01(0.68 + orientation * 0.28 + pin * 0.12);
  } else if (fixtureType == FIX_PAR) {
    // Organs are hinge anchors: intersections of close planes gain weight.
    var near1 = 1.0 - smoothstep(width * 1.5, width * 8.0, abs(d1));
    var near2 = 1.0 - smoothstep(width * 1.5, width * 8.0, abs(d2));
    var near3 = 1.0 - smoothstep(width * 1.5, width * 8.0, abs(d3));
    var hingeAnchor = clamp01((near1 + near2 + near3) * 0.52);
    brightness = clamp01(floorLevel + 0.14 + liveLevel
                       * (0.20 + hingeAnchor * 0.50 + foldShade * 0.12));
    paletteMix = clamp01(0.22 + hingeAnchor * 0.58 + orientation * 0.18);
  } else if (fixtureType == FIX_BAR_18) {
    // Hull is the luminous paper sheet: broad shade blocks, fine dark/light
    // crease relief, and enough floor for its overall mass to remain legible.
    brightness = clamp01(floorLevel + liveLevel
                       * (0.22 + foldShade * (0.27 + liveDepth * 0.34)
                        + crease * (0.08 + liveWidth * 0.20)
                        + heroCrease * (0.27 + liveWidth * 0.42)));
  } else if (isSign) {
    // Both signs receive the identical fixture-local folded stamp. The firm
    // floor protects Identity while facet shading and crease motion stay live.
    brightness = clamp01(max(0.34, floorLevel + 0.19 + liveLevel
                       * (0.16 + foldShade * 0.22
                        + crease * (0.12 + liveWidth * 0.18)
                        + heroCrease * (0.31 + liveWidth * 0.34))));
    paletteMix = clamp01(paletteMix + (ux - 0.50) * 0.08
                       + (uy - 0.50) * 0.07);
  }

  brightness = clamp01(brightness);
  paletteMix = clamp01(paletteMix);
  var outR = (pr1 + (pr2 - pr1) * paletteMix) * brightness;
  var outG = (pg1 + (pg2 - pg1) * paletteMix) * brightness;
  var outB = (pb1 + (pb2 - pb1) * paletteMix) * brightness;
  rgbwau(clamp01(outR), clamp01(outG), clamp01(outB), 0.0, 0.0, 0.0);
}
