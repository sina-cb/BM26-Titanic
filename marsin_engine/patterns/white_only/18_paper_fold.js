/*
  18_paper_fold.js — "Paper Fold"  [WHITE ONLY family — wave _312]

  DERIVED FROM: patterns/ambient_extra/11_paper_fold.js. Skeleton kept: six
  independently oriented analytic fold planes drifting at irrationally related
  rates; coordinates conditionally reflected across each plane; the minimum
  plane distance is the crease SDF and the accumulated orientation supplies
  facet shading. Three planes permanent, three recruited by creaseCount.
  IDENTITY (50 ft): one immense sheet of white paper folds through the ship —
  broad facets in different grays, every crease a razor of white light.

  TEXTURE: facet shading spreads the mid body across 0.16-0.55 (each facet a
  visibly different gray); the hero crease and secondary creases carry
  0.85-1.0 crisp peaks; the deepest shaded face rests near 0.12 shadow.
  SPEED: authored to global 25 / local 0.30 (rate factor 0.4225) — the sheet
  visibly re-folds over ~35 s on the rig at the reference point.
  RUNAWAY (g=4.0, local 1.0 = 8x base): fold clock 0.068 x 8 = 0.54 turns/s;
  its fastest harmonic (x1.73) is 0.94/s — far below the 10/s alias bar.
  Max per-frame clock jump 0.1 x 0.068 x 2.0 = 0.014 against PHASE_WRAP 4096.
  CONTROLS (declaration order = MFT knob order): localSpeed — fold drift
  rate; creaseCount — recruits folds four to six; foldAngle — facet angular
  depth; creaseWidth — width of the white crease drawing; facetDepth — facet
  shading contrast; level — overall intensity with a visible floor.
*/

export var localSpeed = 0.30;
export var creaseCount = 0.48;
export var foldAngle = 0.42;
export var creaseWidth = 0.24;
export var facetDepth = 0.58;
export var level = 0.70;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderCreaseCount(v) { creaseCount = v; }
export function sliderFoldAngle(v) { foldAngle = v; }
export function sliderCreaseWidth(v) { creaseWidth = v; }
export function sliderFacetDepth(v) { facetDepth = v; }
export function sliderLevel(v) { level = v; }

// ── WHITE AUTHORITY (white_only family block — byte-identical across
//    patterns/white_only/*; hash-gated by white_only_contract.test.js) ──
// The family renders WHITE ONLY, as grayscale intensity art:
//   zero chroma (R = G = B exactly, every pixel, every frame); native white
//   W = A matched; UV = 0 always; and NO colorPalette exports, so the family
//   is untintable by design (house convention from patterns/60_white_wash.js).
var WHITE_RGB_SHARE = 0.88;
var WHITE_NATIVE_SHARE = 0.62;
function clamp01(v) {
  if (v < 0.0) return 0.0;
  if (v > 1.0) return 1.0;
  return v;
}
function smooth01(v) {
  var sv = clamp01(v);
  return sv * sv * (3.0 - 2.0 * sv);
}
function emitWhite(level, nativeShare) {
  var lit = clamp01(level);
  var rgb = lit * WHITE_RGB_SHARE;
  var nat = clamp01(lit * WHITE_NATIVE_SHARE * clamp01(nativeShare));
  rgbwau(rgb, rgb, rgb, nat, nat, 0.0);
}
// ── end WHITE AUTHORITY ──

var PHASE_WRAP = 4096.0;
var GOLDEN_ANGLE = 2.39996323;
var PHI = 1.61803399;
var SQRT2 = 1.41421356;
var SQRT3 = 1.73205081;

var foldClock = 0.071;
var liveCount = 0.48;
var liveAngle = 0.42;
var liveWidth = 0.24;
var liveDepth = 0.58;
var liveLevel = 0.70;

var n1x = 0.70, n1y = 0.22, n1z = 0.68;
var n2x = -0.31, n2y = 0.88, n2z = 0.36;
var n3x = 0.55, n3y = -0.64, n3z = 0.54;
var n4x = -0.77, n4y = -0.18, n4z = 0.61;
var n5x = 0.18, n5y = 0.62, n5z = -0.76;
var n6x = 0.88, n6y = -0.41, n6z = -0.24;

var o1 = -0.16, o2 = 0.19, o3 = -0.02;
var o4 = 0.13, o5 = -0.21, o6 = 0.06;

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;
  var speedScale = 0.35 + clamp01(localSpeed) * 1.65;

  var shapeFollow = min(1.0, dt * 4.2);
  var lightFollow = min(1.0, dt * 8.0);
  liveCount += (clamp01(creaseCount) - liveCount) * shapeFollow;
  liveAngle += (clamp01(foldAngle) - liveAngle) * shapeFollow;
  liveWidth += (clamp01(creaseWidth) - liveWidth) * shapeFollow;
  liveDepth += (clamp01(facetDepth) - liveDepth) * shapeFollow;
  liveLevel += (clamp01(level) - liveLevel) * lightFollow;

  // The sheet visibly re-folds over ~35 s at the reference point:
  // 1/(35 x 0.4225) ~= 0.068.
  foldClock += dt * 0.068 * speedScale;
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

  o1 = -0.17 + 0.035 * sin(a2 * 0.19);
  o2 = 0.18 + 0.040 * cos(a3 * 0.17);
  o3 = -0.01 + 0.045 * sin(a4 * 0.13);
  o4 = 0.13 + 0.035 * cos(a5 * 0.23);
  o5 = -0.20 + 0.040 * sin(a6 * 0.16);
  o6 = 0.055 + 0.035 * cos(a1 * 0.29);
}

export function render3D(index, x, y, z) {
  var ux = clamp01(x);
  var uy = clamp01(y);
  var uz = clamp01(z);
  var isSign = fixtureType == FIX_TE_SIGN;

  if (isSign) {
    // Fold both physical 74-pixel signs onto one authored 10x8 surface.
    var signIndex = index % 74.0;
    ux = (signIndex % 10.0) / 9.0;
    uy = floor(signIndex / 10.0) / 7.0;
    uz = 0.43 + ux * 0.08 + uy * 0.10;
  }

  var fx = ux - 0.50;
  var fy = uy - 0.50;
  var fz = uz - 0.50;
  var reflectStrength = 0.12 + liveAngle * 0.82;

  // Three permanent planes; four to six recruit smoothly (source skeleton).
  var countSpan = liveCount * 3.0;
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
  var heroCrease = 1.0 - smoothstep(width * 1.25, width * 4.2, heroDistance);

  // Facet shading spreads the paper across visibly different grays.
  var shadeAcc = 0.50;
  shadeAcc = shadeAcc + orientation * (0.50 + liveDepth * 1.05);
  shadeAcc = shadeAcc + (fx * 0.28 + fy * 0.17 - fz * 0.22) * liveDepth;
  var foldShade = clamp01(shadeAcc);
  var heroFaceLight = 0.0;
  if (heroFace) heroFaceLight = 0.09;
  else heroFaceLight = -0.05;

  var lvl = 0.12;
  lvl = lvl + foldShade * (0.18 + liveDepth * 0.26);
  lvl = lvl + heroFaceLight;
  lvl = lvl + crease * (0.28 + liveWidth * 0.30);
  lvl = lvl + heroCrease * (0.42 + liveWidth * 0.40);
  var nativeShare = 0.16 + heroCrease * 0.55;

  if (fixtureType == FIX_RAW_LED) {
    // Silhouette draws the fold perimeter; the outline never vanishes.
    lvl = 0.22 + foldShade * 0.10;
    lvl = lvl + crease * (0.22 + liveWidth * 0.20);
    lvl = lvl + heroCrease * (0.44 + liveWidth * 0.34);
    nativeShare = 0.18 + heroCrease * 0.60;
  } else if (fixtureType == FIX_VINTAGE_6) {
    // Jewelry: golden-angle pins spark only where a crease crosses a head.
    var pinPhase = 0.5 + 0.5 * cos(pixelLocalIndex * GOLDEN_ANGLE
                                   + foldClock * PI2 * 0.41);
    var pin = pow(pinPhase, 10.0) * max(crease * 0.45, heroCrease);
    lvl = 0.12 + foldShade * 0.16;
    lvl = lvl + pin * 0.70;
    nativeShare = 0.22 + pin * 0.78;
  } else if (fixtureType == FIX_PAR) {
    // Organs are hinge anchors: converging planes gain weight.
    var near1 = 1.0 - smoothstep(width * 1.5, width * 8.0, abs(d1));
    var near2 = 1.0 - smoothstep(width * 1.5, width * 8.0, abs(d2));
    var near3 = 1.0 - smoothstep(width * 1.5, width * 8.0, abs(d3));
    var hingeAcc = near1;
    hingeAcc = hingeAcc + near2;
    hingeAcc = hingeAcc + near3;
    var hingeAnchor = clamp01(hingeAcc * 0.52);
    lvl = 0.16 + foldShade * 0.14;
    lvl = lvl + hingeAnchor * 0.50;
    nativeShare = 0.18 + hingeAnchor * 0.45;
  } else if (isSign) {
    // Identity: the folded stamp over a firm letterform floor.
    lvl = 0.30 + foldShade * 0.20;
    lvl = lvl + crease * (0.12 + liveWidth * 0.18);
    lvl = lvl + heroCrease * (0.28 + liveWidth * 0.30);
    nativeShare = 0.20 + heroCrease * 0.45;
  }

  var authored = 0.35 + liveLevel * 0.65;
  emitWhite(lvl * authored, nativeShare);
}
