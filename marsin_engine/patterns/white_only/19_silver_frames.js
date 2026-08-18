/*
  19_silver_frames.js — "Silver Frames"  [WHITE ONLY family — wave _312]

  DERIVED FROM: patterns/ambient_extra/12_floating_frames.js. Skeleton kept:
  two-to-four finite box-frame SDFs cut into oblique planes travel through the
  vessel's depth, each with its own bounded rotation, pendulum hanging point
  and phase; depth resets happen fully off-model; direction truly reverses.
  IDENTITY (50 ft): immense silver picture frames drift through the ship,
  their bright rails cutting white rectangles out of a gray dusk.

  TEXTURE: the dusk field rests at 0.12-0.24 with a slow drift; frame faces
  lift the mid body toward 0.35-0.5; the rectangular rails carry 0.9-1.0
  crisp peaks with a strong native-white share.
  SPEED: authored to global 25 / local 0.30 (rate factor 0.4225) — a frame
  crosses the ship in ~16 s on the rig at the reference point.
  RUNAWAY (g=4.0, local 1.0 = 8x base): travel clock 0.148 x 8 = 1.18
  cycles/s; the fastest pendulum harmonic (x0.59) stays under 0.7/s — far
  below the 10/s alias bar. Max per-frame clock jump 0.1 x 0.148 x 2.0 =
  0.030 against PHASE_WRAP 4096 — wraps safe.
  CONTROLS (declaration order = MFT knob order): localSpeed — travel and
  rotation pace; direction — genuine forward/reverse travel; frameCount —
  recruits the third and fourth frames; frameWidth — rail width; twist —
  bounded rotation and tilt; level — overall intensity with a visible floor.
*/

export var localSpeed = 0.30;
export var direction = 0.76;
export var frameCount = 0.46;
export var frameWidth = 0.24;
export var twist = 0.44;
export var level = 0.70;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderDirection(v) {
  direction = v;
  var dv = v * 2.0 - 1.0;
  if (dv >= 0.0 && dv < 0.06) dv = 0.06;
  else if (dv < 0.0 && dv > -0.06) dv = -0.06;
  targetHeading = dv;
}
export function sliderFrameCount(v) { frameCount = v; }
export function sliderFrameWidth(v) { frameWidth = v; }
export function sliderTwist(v) { twist = v; }
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
var PHI = 1.61803399;
var SQRT2 = 1.41421356;
var SQRT3 = 1.73205081;
var FRAME_DEPTH = 0.48;

var travelClock = 0.13;
var rotationClock = 0.21;
var targetHeading = 0.52;
var liveHeading = 0.52;
var liveCount = 0.46;
var liveWidth = 0.24;
var liveTwist = 0.44;
var liveLevel = 0.70;

var angle1 = 0.0, angle2 = 0.0, angle3 = 0.0, angle4 = 0.0;
var center1 = 0.0, center2 = 0.0, center3 = 0.0, center4 = 0.0;
var centerX1 = 0.25, centerY1 = 0.64;
var centerX2 = 0.73, centerY2 = 0.37;
var centerX3 = 0.36, centerY3 = 0.29;
var centerX4 = 0.66, centerY4 = 0.72;
var cos1 = 1.0, sin1 = 0.0, cos2 = 1.0, sin2 = 0.0;
var cos3 = 1.0, sin3 = 0.0, cos4 = 1.0, sin4 = 0.0;

function wrappedCenter(phaseOffset) {
  var phase = travelClock + phaseOffset;
  phase -= floor(phase);
  // Resets happen 55% of a model length beyond either end, off-model.
  return -0.55 + phase * 2.10;
}

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;
  var speedScale = 0.35 + clamp01(localSpeed) * 1.65;

  var shapeFollow = min(1.0, dt * 4.5);
  var lightFollow = min(1.0, dt * 9.0);
  var headingFollow = min(1.0, dt * 16.0);
  liveHeading += (targetHeading - liveHeading) * headingFollow;
  liveCount += (clamp01(frameCount) - liveCount) * shapeFollow;
  liveWidth += (clamp01(frameWidth) - liveWidth) * shapeFollow;
  liveTwist += (clamp01(twist) - liveTwist) * shapeFollow;
  liveLevel += (clamp01(level) - liveLevel) * lightFollow;

  // One frame crossing ~16 s at the reference point: 1/(16 x 0.4225) = 0.148.
  var phaseStep = dt * 0.148 * speedScale;
  travelClock += phaseStep * liveHeading;
  rotationClock += phaseStep * 0.34 * liveHeading;
  if (travelClock >= PHASE_WRAP) travelClock -= PHASE_WRAP;
  if (travelClock < 0.0) travelClock += PHASE_WRAP;
  if (rotationClock >= PHASE_WRAP) rotationClock -= PHASE_WRAP;
  if (rotationClock < 0.0) rotationClock += PHASE_WRAP;

  center1 = wrappedCenter(0.00);
  center2 = wrappedCenter(0.50);
  center3 = wrappedCenter(0.25);
  center4 = wrappedCenter(0.75);

  var twistReach = 0.10 + liveTwist * 0.58;
  angle1 = 0.18 + twistReach * sin(rotationClock * PI2);
  angle2 = -0.43 + twistReach * 0.78
         * sin(rotationClock * PI2 * SQRT2 + 1.31);
  angle3 = 0.72 + twistReach * 0.62
         * sin(rotationClock * PI2 * SQRT3 + 2.47);
  angle4 = -0.86 + twistReach * 0.54
         * sin(rotationClock * PI2 * PHI + 4.12);

  cos1 = cos(angle1); sin1 = sin(angle1);
  cos2 = cos(angle2); sin2 = sin(angle2);
  cos3 = cos(angle3); sin3 = sin(angle3);
  cos4 = cos(angle4); sin4 = sin(angle4);

  // Independent pendulum hanging points (source skeleton).
  centerX1 = 0.24 + sin(rotationClock * PI2 * 0.41) * 0.075;
  centerY1 = 0.64 + cos(rotationClock * PI2 * 0.37) * 0.055;
  centerX2 = 0.74 + cos(rotationClock * PI2 * 0.47 + 1.1) * 0.070;
  centerY2 = 0.36 + sin(rotationClock * PI2 * 0.31 + 0.7) * 0.060;
  centerX3 = 0.36 + sin(rotationClock * PI2 * 0.53 + 2.2) * 0.065;
  centerY3 = 0.27 + cos(rotationClock * PI2 * 0.43 + 1.8) * 0.050;
  centerX4 = 0.65 + cos(rotationClock * PI2 * 0.59 + 3.4) * 0.060;
  centerY4 = 0.73 + sin(rotationClock * PI2 * 0.29 + 2.6) * 0.050;
}

function frameSdf(px, py, pz, centerX, centerY, centerZ, ca, sa,
                  tiltX, tiltY, halfW, halfH) {
  var dx = px - centerX;
  var dy = py - centerY;
  var dz = pz - centerZ;
  var u = dx * ca + dy * sa + dz * tiltX;
  var v = -dx * sa + dy * ca + dz * tiltY;
  var planeDistance = abs(dz + dx * tiltY * 0.46 - dy * tiltX * 0.46);
  var outer = max(abs(u) / halfW, abs(v) / halfH);
  var edgeDistance = abs(outer - 1.0) * min(halfW, halfH);
  var width = 0.035 + liveWidth * 0.165;
  var edge = 1.0 - smoothstep(width, width + 0.060, edgeDistance);
  var planeReach = 0.160 + FRAME_DEPTH * 0.255;
  var planeGate = 1.0 - smoothstep(planeReach, planeReach + 0.120,
                                   planeDistance);
  var face = (1.0 - smoothstep(0.88, 1.02, outer)) * planeGate;
  return clamp01(edge * planeGate + face * 0.095);
}

export function render3D(index, x, y, z) {
  var ux = clamp01(x);
  var uy = clamp01(y);
  var uz = clamp01(z);
  var isSign = fixtureType == FIX_TE_SIGN;

  if (isSign) {
    // Both 74-pixel signs receive the same local 10x8 coordinate stamp.
    var signIndex = index % 74.0;
    ux = (signIndex % 10.0) / 9.0;
    uy = floor(signIndex / 10.0) / 7.0;
    uz = 0.50;
  }

  var tiltReach = 0.10 + liveTwist * 0.24;
  var countSpan = liveCount * 3.0;
  var weight3 = smooth01(countSpan - 1.45);
  var weight4 = smooth01(countSpan - 2.00);
  var f1 = frameSdf(ux, uy, uz, centerX1, centerY1, center1, cos1, sin1,
                    tiltReach, -tiltReach * 0.58, 0.29, 0.24);
  var f2 = frameSdf(ux, uy, uz, centerX2, centerY2, center2, cos2, sin2,
                    -tiltReach * 0.72, tiltReach, 0.25, 0.31);
  var f3 = 0.0;
  var f4 = 0.0;
  if (weight3 > 0.0) {
    f3 = frameSdf(ux, uy, uz, centerX3, centerY3, center3, cos3, sin3,
                  tiltReach * 0.64, tiltReach * 0.48, 0.27, 0.19) * weight3;
  }
  if (weight4 > 0.0) {
    f4 = frameSdf(ux, uy, uz, centerX4, centerY4, center4, cos4, sin4,
                  -tiltReach, -tiltReach * 0.36, 0.21, 0.30) * weight4;
  }

  var outerFrame = max(f1, f2);
  var innerFrame = max(f3, f4);
  var sumAcc = f1;
  sumAcc = sumAcc + f2;
  sumAcc = sumAcc + f3;
  sumAcc = sumAcc + f4;
  var frameEnergy = clamp01(max(outerFrame, innerFrame) + sumAcc * 0.16);

  // A slow gray dusk keeps the whole rig visible between frame passes.
  var duskAcc = 0.50;
  duskAcc = duskAcc + 0.28 * sin((ux * 1.21 + uz * 0.87) * PI2
                                 + rotationClock * PI2 * 0.23);
  duskAcc = duskAcc + 0.22 * cos((uy * 1.47 - ux * 0.53) * PI2);
  var dusk = clamp01(duskAcc);

  var lvl = 0.12 + dusk * 0.10;
  lvl = lvl + frameEnergy * 1.45;
  var nativeShare = 0.15 + frameEnergy * 0.55;

  if (fixtureType == FIX_RAW_LED) {
    // Silhouette is the hero outer frame over a firm outline floor.
    lvl = 0.22 + dusk * 0.08;
    lvl = lvl + outerFrame * 1.30;
    lvl = lvl + innerFrame * 0.80;
    nativeShare = 0.18 + outerFrame * 0.60;
  } else if (fixtureType == FIX_VINTAGE_6) {
    // Jewelry: rail-end corner cuts spark as a frame passes.
    var railU = (pixelLocalIndex % 6.0 + 0.5) / 6.0;
    var cornerCut = smooth01((abs(railU - 0.50) - 0.18) / 0.30);
    var cornerPulse = cornerCut * frameEnergy;
    lvl = 0.12 + dusk * 0.10;
    lvl = lvl + cornerPulse * 1.35;
    nativeShare = 0.22 + cornerPulse * 0.78;
  } else if (fixtureType == FIX_PAR) {
    // Organs anchor the architecture where frames cross them.
    var anchorWave = 0.5 + 0.5 * sin((x + z) * PI2
                                     + rotationClock * PI2 * 0.37);
    var anchor = max(frameEnergy, anchorWave * 0.5);
    lvl = 0.15 + dusk * 0.08;
    lvl = lvl + anchor * 0.85;
    nativeShare = 0.18 + frameEnergy * 0.45;
  } else if (isSign) {
    // Identity: nested local rectangles over a firm letterform floor.
    var sx = abs(ux - 0.50);
    var sy = abs(uy - 0.50);
    var outerBox = max(sx / 0.45, sy / 0.43);
    var innerScale = 0.50 + 0.08 * sin(rotationClock * PI2 * 0.71);
    var innerBox = max(sx / (0.45 * innerScale), sy / (0.43 * innerScale));
    var signWidth = 0.085 + liveWidth * 0.130;
    var nestedOuter = 1.0 - smoothstep(signWidth, signWidth + 0.055,
                                       abs(outerBox - 1.0));
    var nestedInner = 1.0 - smoothstep(signWidth, signWidth + 0.055,
                                       abs(innerBox - 1.0));
    var signFrames = max(nestedOuter, nestedInner * 0.80);
    lvl = 0.30 + dusk * 0.08;
    lvl = lvl + signFrames * 0.85;
    nativeShare = 0.20 + signFrames * 0.50;
  }

  var authored = 0.35 + liveLevel * 0.65;
  emitWhite(lvl * authored, nativeShare);
}
