// DRAFT — pending operator review
/*
  12_floating_frames.js — FLOATING FRAMES

  CONCEPT
    Two to four immense rectangular light frames drift through the vessel's
    depth like suspended architecture. Each frame is a finite box-frame SDF
    cut into its own oblique plane: these are distinct planar objects, never
    rings, a tunnel, or a repeating wave field.

  INSTRUMENT STAGING
    FIX_BAR_18     — broad frame faces and architectural edge light.
    FIX_RAW_LED    — the strongest outer-frame silhouette at playa distance.
    FIX_VINTAGE_6  — restrained palette-RGB cuts at the physical corners.
    FIX_PAR        — luminous anchor points where frames cross the organs.
    FIX_TE_SIGN    — paired, balanced nested rectangles preserving identity.

  MOTION / MATH
    Four finite signed-distance rectangles travel continuously from behind the
    model to beyond its bow. Their depth resets occur while fully off-model.
    Each plane has its own bounded rotation, tilt, aspect and phase offset.
    Direction genuinely reverses travel; live geometry controls slew so edits
    reshape the architecture without a hard visual jump.

  CONTROLS (declaration order = physical MIDI order)
    localSpeed  — speed of depth travel and the slow independent rotations.
    direction   — genuine forward/reverse travel, second local control.
    frameCount  — smoothly recruits the third and fourth suspended frames.
    frameWidth  — literal width and prominence of every rectangular edge.
    depth       — thickness and parallax reach of the oblique frame planes.
    twist       — bounded independent rotation and tilt of the rectangles.
    level       — expressive frame energy above the visibility floor.
    safetyFloor — minimum palette-derived whole-rig visibility.

  AUDIO_MODULATION_V1:
    sliderDepth      <- micFlux range 0.25..0.65 curve ease   # flux deepens the suspended planes
    sliderFrameWidth <- micHigh range 0.08..0.28 curve linear # highs broaden the architectural edges
  Static (unmapped) params: localSpeed, direction, frameCount, twist, level,
    safetyFloor, colorPalette1/2.

  COLOR / OUTPUT
    Every RGB output lies strictly on the cp1-to-cp2 RGB line. Jewelry accents
    use palette RGB, not native white. W=A=U=0 exactly. Silence remains a full,
    readable ambient composition on both Titanic and the portable test bench.
*/

export var cp1H = 0.60, cp1S = 0.82, cp1V = 0.82;
export var cp2H = 0.105, cp2S = 0.72, cp2V = 1.00;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export var localSpeed = 0.31;
export var direction = 0.76;
export var frameCount = 0.46;
export var frameWidth = 0.19;
export var depth = 0.48;
export var twist = 0.44;
export var level = 0.70;
export var safetyFloor = 0.28;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderDirection(v) { direction = v; }
export function sliderFrameCount(v) { frameCount = v; }
export function sliderFrameWidth(v) { frameWidth = v; }
export function sliderDepth(v) { depth = v; }
export function sliderTwist(v) { twist = v; }
export function sliderLevel(v) { level = v; }
export function sliderSafetyFloor(v) { safetyFloor = v; }

var PHASE_WRAP = 10000.0;
var PHI = 1.61803399;
var SQRT2 = 1.41421356;
var SQRT3 = 1.73205081;

var travelClock = 0.13;
var rotationClock = 0.21;
var liveHeading = 0.52;
var liveCount = 0.46;
var liveWidth = 0.19;
var liveDepth = 0.48;
var liveTwist = 0.44;
var liveLevel = 0.70;
var liveFloor = 0.28;

var angle1 = 0.0, angle2 = 0.0, angle3 = 0.0, angle4 = 0.0;
var center1 = 0.0, center2 = 0.0, center3 = 0.0, center4 = 0.0;
var centerX1 = 0.25, centerY1 = 0.64;
var centerX2 = 0.73, centerY2 = 0.37;
var centerX3 = 0.36, centerY3 = 0.29;
var centerX4 = 0.66, centerY4 = 0.72;
var cos1 = 1.0, sin1 = 0.0, cos2 = 1.0, sin2 = 0.0;
var cos3 = 1.0, sin3 = 0.0, cos4 = 1.0, sin4 = 0.0;

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

function wrappedCenter(phaseOffset) {
  var phase = travelClock + phaseOffset;
  phase -= floor(phase);
  // The reset happens 55% of a model length beyond either end. Even the
  // widest, most oblique plane gate is exactly zero there, so forward and
  // reverse wraps are both invisible rather than merely hidden by a floor.
  return -0.55 + phase * 2.10;
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

  var shapeFollow = min(1.0, dt * 4.5);
  var lightFollow = min(1.0, dt * 9.0);
  var targetHeading = clamp01(direction) * 2.0 - 1.0;
  if (targetHeading >= 0.0 && targetHeading < 0.06) targetHeading = 0.06;
  else if (targetHeading < 0.0 && targetHeading > -0.06) targetHeading = -0.06;
  var headingFollow = min(1.0, dt * 16.0);
  liveHeading += (targetHeading - liveHeading) * headingFollow;
  liveCount += (clamp01(frameCount) - liveCount) * shapeFollow;
  liveWidth += (clamp01(frameWidth) - liveWidth) * shapeFollow;
  liveDepth += (clamp01(depth) - liveDepth) * shapeFollow;
  liveTwist += (clamp01(twist) - liveTwist) * shapeFollow;
  liveLevel += (clamp01(level) - liveLevel) * lightFollow;
  liveFloor += (clamp01(safetyFloor) - liveFloor) * lightFollow;

  var localMult = 0.25 + clamp01(localSpeed)
    * (32.824 - 16.412 * clamp01(localSpeed));
  var phaseStep = dt * (0.024 + localMult * 0.105);
  travelClock += phaseStep * liveHeading;
  // Direction reverses the entire hanging-object choreography. Keeping the
  // pendulum and rotation clocks signed with depth travel makes both endpoints
  // perceptually unambiguous even while a frame is crossing sparse pixels.
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

  // Plane bases are frame-wide state. Computing these eight trig values once
  // here removes eight transcendental calls from every pixel render.
  cos1 = cos(angle1); sin1 = sin(angle1);
  cos2 = cos(angle2); sin2 = sin(angle2);
  cos3 = cos(angle3); sin3 = sin(angle3);
  cos4 = cos(angle4); sin4 = sin(angle4);

  // Every object owns a different lateral hanging point. Their slow,
  // bounded pendulum drift prevents a shared-center perspective stack and
  // is the decisive split from Deep Window's common vanishing point.
  centerX1 = 0.24 + sin(rotationClock * PI2 * 0.41) * 0.075;
  centerY1 = 0.64 + cos(rotationClock * PI2 * 0.37) * 0.055;
  centerX2 = 0.74 + cos(rotationClock * PI2 * 0.47 + 1.1) * 0.070;
  centerY2 = 0.36 + sin(rotationClock * PI2 * 0.31 + 0.7) * 0.060;
  centerX3 = 0.36 + sin(rotationClock * PI2 * 0.53 + 2.2) * 0.065;
  centerY3 = 0.27 + cos(rotationClock * PI2 * 0.43 + 1.8) * 0.050;
  centerX4 = 0.65 + cos(rotationClock * PI2 * 0.59 + 3.4) * 0.060;
  centerY4 = 0.73 + sin(rotationClock * PI2 * 0.29 + 2.6) * 0.050;

  _hsv2rgb1();
  _hsv2rgb2();
}

function frameSdf(px, py, pz, centerX, centerY, centerZ, ca, sa,
                  tiltX, tiltY, halfW, halfH) {
  var dx = px - centerX;
  var dy = py - centerY;
  var dz = pz - centerZ;

  // A rotated local basis, then a bounded depth shear, forms one oblique
  // rectangular plane. max(abs(u)/w,abs(v)/h)==1 is its finite box edge.
  var u = dx * ca + dy * sa + dz * tiltX;
  var v = -dx * sa + dy * ca + dz * tiltY;
  var planeDistance = abs(dz + dx * tiltY * 0.46 - dy * tiltX * 0.46);
  var outer = max(abs(u) / halfW, abs(v) / halfH);
  var edgeDistance = abs(outer - 1.0) * min(halfW, halfH);
  // Deliberately broad continuous rails survive the Titanic's sparse physical
  // sampling as closed rectangles instead of isolated corner cohorts.
  var width = 0.035 + liveWidth * 0.165;
  var edge = 1.0 - smoothstep(width, width + 0.035, edgeDistance);
  var planeReach = 0.160 + liveDepth * 0.255;
  var planeGate = 1.0 - smoothstep(planeReach, planeReach + 0.120,
                                   planeDistance);
  var face = (1.0 - smoothstep(0.88, 1.02, outer)) * planeGate;
  return clamp01(edge * planeGate + face * (0.045 + liveDepth * 0.105));
}

export function render3D(index, x, y, z) {
  var ux = clamp01(x);
  var uy = clamp01(y);
  var uz = clamp01(z);
  var isSign = fixtureType == FIX_TE_SIGN;

  if (isSign) {
    // Both 74-pixel signs receive the same local 10x8 coordinate stamp.
    // That guarantees exact pair balance while preserving the letters' bed.
    var signIndex = index % 74.0;
    ux = (signIndex % 10.0) / 9.0;
    uy = floor(signIndex / 10.0) / 7.0;
    uz = 0.50;
  }

  var tiltReach = 0.10 + liveTwist * 0.24;
  // Two opposing outer frames are permanent. Count smoothly recruits the
  // third and fourth; inactive planes are not evaluated per pixel.
  // The saved midpoint carries two complete hero frames. Frames three and
  // four arrive only above the midpoint, reducing both visual clutter and VM
  // work while preserving the full two-to-four authored control range.
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
  var frameEnergy = clamp01(max(outerFrame, innerFrame)
                           + (f1 + f2 + f3 + f4) * 0.16);
  var frameWeight = f1 + f2 + f3 + f4 + 0.0001;
  var frameColor = clamp01((f1 * 0.08 + f2 * 0.88
                          + f3 * 0.34 + f4 * 0.68) / frameWeight);

  var floorLevel = 0.045 + liveFloor * 0.245;
  var brightness = floorLevel + liveLevel * (0.050 + frameEnergy * 0.88);
  var paletteMix = clamp01(0.035 + frameColor * 0.91
                          + frameEnergy * 0.04);

  if (fixtureType == FIX_BAR_18) {
    // Hull Canvas carries the broad illuminated faces and crisp perimeter.
    brightness = floorLevel + liveLevel
               * (0.055 + frameEnergy * (0.78 + liveDepth * 0.22));
  } else if (fixtureType == FIX_RAW_LED) {
    // Silhouette is the hero outer frame and never loses the ship outline.
    brightness = floorLevel + 0.11 + liveLevel
               * (0.10 + outerFrame * 0.84 + innerFrame * 0.60);
    paletteMix = clamp01(0.07 + frameColor * 0.84
                        + innerFrame * 0.08);
  } else if (fixtureType == FIX_VINTAGE_6) {
    // End heads on each six-pixel rail act as corner cuts. They stay pure
    // palette RGB, avoiding a third color and keeping native white at zero.
    var railU = (pixelLocalIndex % 6.0 + 0.5) / 6.0;
    var cornerCut = smooth01((abs(railU - 0.50) - 0.18) / 0.30);
    var cornerPulse = cornerCut * (0.28 + frameEnergy * 0.72);
    brightness = floorLevel * 0.72 + 0.05 + liveLevel
               * (0.06 + cornerPulse * 0.58);
    paletteMix = clamp01(0.62 + frameColor * 0.28 + cornerCut * 0.08);
  } else if (fixtureType == FIX_PAR) {
    // Organs are architectural anchor points: stable mass with crossings.
    var anchor = max(frameEnergy,
                     0.5 + 0.5 * sin((x + z) * PI2
                                   + rotationClock * PI2 * 0.37));
    brightness = floorLevel + 0.13 + liveLevel
               * (0.15 + anchor * 0.54);
    paletteMix = clamp01(0.24 + frameColor * 0.46 + anchor * 0.18);
  } else if (isSign) {
    // Nested local rectangles animate independently of sparse world geometry.
    // The complete 74-pixel fold keeps both signs exactly balanced.
    var sx = abs(ux - 0.50);
    var sy = abs(uy - 0.50);
    var outerBox = max(sx / 0.45, sy / 0.43);
    var innerScale = 0.50 + 0.08
                   * sin(rotationClock * PI2 * 0.71);
    var innerBox = max(sx / (0.45 * innerScale),
                       sy / (0.43 * innerScale));
    var signWidth = 0.085 + liveWidth * 0.130;
    var nestedOuter = 1.0 - smoothstep(signWidth, signWidth + 0.055,
                                       abs(outerBox - 1.0));
    var nestedInner = 1.0 - smoothstep(signWidth, signWidth + 0.055,
                                       abs(innerBox - 1.0));
    var signFrames = max(nestedOuter, nestedInner * (0.76 + liveDepth * 0.24));
    var signTravel = wave(travelClock * 0.73 + ux * 0.21 + uy * 0.13);
    brightness = max(0.34, floorLevel + 0.17 + liveLevel
                   * (0.06 + signFrames * 0.82 + signTravel * 0.07));
    paletteMix = clamp01(0.08 + nestedOuter * 0.80
                        + nestedInner * 0.36 + signTravel * 0.10);
  }

  // Depth and edge width remain geometric first, but their audio mappings
  // also lift the material very slightly across every instrument. A flux
  // build or high-frequency shimmer is therefore legible at playa distance
  // even while a moving plane happens to sit between sparse physical pixels.
  brightness += liveLevel * (liveDepth * 0.070 + liveWidth * 0.100);
  brightness = clamp01(brightness);
  paletteMix = clamp01(paletteMix);
  var outR = (pr1 + (pr2 - pr1) * paletteMix) * brightness;
  var outG = (pg1 + (pg2 - pg1) * paletteMix) * brightness;
  var outB = (pb1 + (pb2 - pb1) * paletteMix) * brightness;
  rgbwau(clamp01(outR), clamp01(outG), clamp01(outB), 0.0, 0.0, 0.0);
}
