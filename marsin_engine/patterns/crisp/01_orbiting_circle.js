// DRAFT — pending operator review
/*
  01_orbiting_circle.js - ORBITING CIRCLE

  CONCEPT
    Up to five solid circular fireflies wander through the normalized X/Z
    plane on deterministic, incommensurate cosine/sine orbits. Their main
    bodies and finite geometric echoes retain hard black gaps and sharp
    antialiased edges. There is no backbuffer and no per-pixel allocation.

  DISCRETE COLOR CONTRACT
    Every RGB pixel is a scalar multiple of exactly palette endpoint 1 or
    exactly palette endpoint 2. Overlaps use a deterministic winner; neither
    body intersections nor antialiasing ever interpolate RGB between endpoints.
    W=A=U=0 everywhere. Safety Floor is also endpoint-colored, never neutral.

  INSTRUMENT STAGING
    FIX_BAR_18     - large filled X/Z circles and finite echoes on the Hull.
    FIX_RAW_LED    - sharp circle rims and body intersections on Silhouette.
    FIX_VINTAGE_6  - one sparse moving exact-color pearl per six-head fixture.
    FIX_PAR        - low, steady endpoint anchors reinforced by nearby bodies.
    FIX_TE_SIGN    - paired local 10x8/74-pixel orbit plaques, using index%74.

  MOTION / MATH
    Each body combines a primary orbit with sqrt(2), sqrt(3), and phi wobble.
    Spacing changes the inter-body phase fan. Trail adds up to two smaller
    earlier-phase circles with explicit gaps rather than temporal feedback.

  CONTROLS (declaration order = physical MIDI order)
    localSpeed  - cadence of every body and finite echo.
    bodyRadius  - radius of the solid antialiased circles.
    count       - one through five active circular bodies.
    spacing     - angular separation and radial fan between bodies.
    trail       - separation, size, and count of finite geometric echoes.
    safetyFloor - black at zero, endpoint-colored minimum visibility above it.

  Static (unmapped) params: all controls and colorPalette1/2.
*/

export var cp1H = 0.040, cp1S = 1.00, cp1V = 1.00;
export var cp2H = 0.520, cp2S = 1.00, cp2V = 1.00;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export var localSpeed = 0.30;
export var bodyRadius = 0.56;
export var count = 0.50;
export var spacing = 0.58;
export var trail = 0.46;
export var safetyFloor = 0.00;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderBodyRadius(v) { bodyRadius = v; }
export function sliderCount(v) { count = v; }
export function sliderSpacing(v) { spacing = v; }
export function sliderTrail(v) { trail = v; }
export function sliderSafetyFloor(v) { safetyFloor = v; }

var SQRT2 = 1.41421356;
var SQRT3 = 1.73205081;
var PHI = 1.61803399;
var GOLDEN_FRACTION = 0.61803399;
var PHASE_WRAP = 10000.0;
var BODY_LIMIT = 5;
var ECHO_LIMIT = 3;

// Five bodies x one head plus two finite echoes. Allocated once at load.
var bodyX = array(15);
var bodyZ = array(15);

var orbitPhase = 0.137;
var activeBodies = 3;
var liveBodyRadius = 0.56;
var liveSpacing = 0.58;
var liveTrail = 0.46;
var liveSafetyFloor = 0.00;
var circleRadius = 0.15;
var echoGap = 0.08;

var pr1 = 1.0, pg1 = 0.0, pb1 = 0.0;
var pr2 = 0.0, pg2 = 1.0, pb2 = 1.0;

function clamp01(value) {
  if (value < 0.0) return 0.0;
  if (value > 1.0) return 1.0;
  return value;
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

function circleFill(distanceValue, radiusValue, edgeValue) {
  return 1.0 - smoothstep(radiusValue - edgeValue,
                          radiusValue + edgeValue, distanceValue);
}

function circleRim(distanceValue, radiusValue, edgeValue) {
  return 1.0 - smoothstep(edgeValue * 0.45, edgeValue * 2.25,
                          abs(distanceValue - radiusValue));
}

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  var follow = min(1.0, dt * 6.0);
  liveBodyRadius += (clamp01(bodyRadius) - liveBodyRadius) * follow;
  liveSpacing += (clamp01(spacing) - liveSpacing) * follow;
  liveTrail += (clamp01(trail) - liveTrail) * follow;
  liveSafetyFloor += (clamp01(safetyFloor) - liveSafetyFloor) * follow;
  activeBodies = 1.0 + floor(clamp01(count) * 4.999);

  var localMultiplier = pow(2.0, (clamp01(localSpeed) - 0.5) * 4.0);
  orbitPhase += dt * (0.045 + localMultiplier * 0.100);
  if (orbitPhase >= PHASE_WRAP) orbitPhase -= PHASE_WRAP;

  circleRadius = 0.070 + liveBodyRadius * 0.185;
  echoGap = 0.040 + liveTrail * 0.145;
  var spacingPhase = 0.105 + liveSpacing * 0.185;
  var orbitRadius = 0.205 + liveSpacing * 0.155;

  var bodyIndex = 0;
  for (bodyIndex = 0; bodyIndex < BODY_LIMIT; bodyIndex = bodyIndex + 1.0) {
    var echoIndex = 0;
    for (echoIndex = 0; echoIndex < ECHO_LIMIT; echoIndex = echoIndex + 1.0) {
      var slot = bodyIndex * ECHO_LIMIT + echoIndex;
      var echoPhase = orbitPhase - echoIndex * echoGap;
      var bodyPhase = echoPhase * (1.0 + bodyIndex * 0.073)
                    + bodyIndex * spacingPhase;
      var wobblePhase = echoPhase * (SQRT2 + bodyIndex * 0.061)
                      - bodyIndex * spacingPhase * 0.73;
      var angleA = bodyPhase * PI2;
      var angleB = wobblePhase * PI2;
      var radialFan = orbitRadius * (0.82 + bodyIndex * 0.045);
      bodyX[slot] = 0.5 + radialFan
        * (0.78 * cos(angleA) + 0.18 * cos(angleB * PHI + bodyIndex));
      bodyZ[slot] = 0.5 + radialFan
        * (0.72 * sin(angleA * SQRT2 + bodyIndex * 0.31)
         + 0.20 * sin(angleB * SQRT3));
    }
  }

  _hsv2rgb1();
  _hsv2rgb2();
}

export function render3D(index, x, y, z) {
  var geometryX = clamp01(x);
  var geometryZ = clamp01(z);
  var isIdentity = fixtureType == FIX_TE_SIGN;
  if (isIdentity) {
    // Each physical sign is a 40+34 fixture pair. Folding the global address
    // authors one complete 74-pixel surface instead of repeating 0..33.
    var signIndex = index % 74.0;
    geometryX = (signIndex % 10.0) / 9.0;
    geometryZ = floor(signIndex / 10.0) / 7.0;
  }

  var edge = 0.009;
  var roleRadius = circleRadius;
  if (isIdentity) {
    edge = 0.026;
    roleRadius = 0.095 + liveBodyRadius * 0.070;
  }

  var winnerEnergy = 0.0;
  var winnerBody = 0.0;
  var boundaryEnergy = 0.0;
  var strongestCore = 0.0;
  var secondCore = 0.0;
  var bodyIndex = 0;

  for (bodyIndex = 0; bodyIndex < BODY_LIMIT; bodyIndex = bodyIndex + 1.0) {
    if (bodyIndex < activeBodies) {
      var slot = bodyIndex * ECHO_LIMIT;
      var centerX = bodyX[slot];
      var centerZ = bodyZ[slot];
      if (isIdentity) {
        centerX = 0.5 + (centerX - 0.5) * 0.88;
        centerZ = 0.5 + (centerZ - 0.5) * 0.88;
      }
      var dx = geometryX - centerX;
      var dz = geometryZ - centerZ;
      var distanceValue = sqrt(dx * dx + dz * dz);
      var bodyCore = circleFill(distanceValue, roleRadius, edge);
      var bodyEnergy = bodyCore;
      var bodyRim = circleRim(distanceValue, roleRadius, edge);

      var echoIndex = 1;
      for (echoIndex = 1; echoIndex < ECHO_LIMIT; echoIndex = echoIndex + 1.0) {
        slot = bodyIndex * ECHO_LIMIT + echoIndex;
        centerX = bodyX[slot];
        centerZ = bodyZ[slot];
        if (isIdentity) {
          centerX = 0.5 + (centerX - 0.5) * 0.88;
          centerZ = 0.5 + (centerZ - 0.5) * 0.88;
        }
        dx = geometryX - centerX;
        dz = geometryZ - centerZ;
        distanceValue = sqrt(dx * dx + dz * dz);

        var echoStrength = liveTrail;
        var echoScale = 0.60 + liveTrail * 0.10;
        if (echoIndex == 2.0) {
          echoStrength = clamp01((liveTrail - 0.18) * 1.22);
          echoScale = 0.47 + liveTrail * 0.09;
        }
        var echoRadius = roleRadius * echoScale;
        var echoEnergy = circleFill(distanceValue, echoRadius, edge)
                       * echoStrength;
        bodyEnergy = max(bodyEnergy, echoEnergy);
        bodyRim = max(bodyRim,
          circleRim(distanceValue, echoRadius, edge) * echoStrength);
      }

      if (bodyCore > strongestCore) {
        secondCore = strongestCore;
        strongestCore = bodyCore;
      } else if (bodyCore > secondCore) {
        secondCore = bodyCore;
      }
      boundaryEnergy = max(boundaryEnergy, bodyRim);
      if (bodyEnergy > winnerEnergy) {
        winnerEnergy = bodyEnergy;
        winnerBody = bodyIndex;
      }
    }
  }

  var brightness = winnerEnergy;
  var useColor2 = winnerBody % 2.0;

  if (fixtureType == FIX_RAW_LED) {
    // Silhouette keeps the analytic rim and reinforces true body crossings.
    var intersection = sqrt(strongestCore * secondCore);
    brightness = max(winnerEnergy * 0.24,
                     max(boundaryEnergy, intersection));
  } else if (fixtureType == FIX_VINTAGE_6) {
    // One moving pearl per six-head rail; all pearls remain palette-exact RGB.
    var pearlHead = floor((orbitPhase * 6.0
                         + fixtureId * GOLDEN_FRACTION) % 6.0);
    var pearlGate = pixelLocalIndex == pearlHead;
    brightness = pearlGate
      * (0.58 + 0.42 * wave(orbitPhase * 0.37
                           + fixtureId * GOLDEN_FRACTION));
    useColor2 = floor(fixtureId * GOLDEN_FRACTION
                    + orbitPhase * 2.0) % 2.0;
  } else if (fixtureType == FIX_PAR) {
    // Organs are the stable gravity anchors under the wandering circles.
    brightness = 0.18 + winnerEnergy * 0.82;
  } else if (isIdentity) {
    // A balanced local orbit track completes the paired 74-pixel plaques.
    var signDx = geometryX - 0.5;
    var signDz = geometryZ - 0.5;
    var signRadius = sqrt(signDx * signDx + signDz * signDz);
    var orbitTrack = 1.0 - smoothstep(0.018, 0.068,
                                     abs(signRadius - 0.42));
    if (orbitTrack * 0.58 > brightness) {
      brightness = orbitTrack * 0.58;
      useColor2 = (floor(geometryX * 4.0)
                 + floor(geometryZ * 4.0)) % 2.0;
    }
  }

  var floorLevel = liveSafetyFloor * 0.12;
  if (brightness < floorLevel) {
    brightness = floorLevel;
    useColor2 = (floor(clamp01(x) * 8.0)
               + floor(clamp01(z) * 8.0) + fixtureType) % 2.0;
  }
  brightness = clamp01(brightness);

  if (useColor2) {
    rgbwau(pr2 * brightness, pg2 * brightness, pb2 * brightness,
           0.0, 0.0, 0.0);
  } else {
    rgbwau(pr1 * brightness, pg1 * brightness, pb1 * brightness,
           0.0, 0.0, 0.0);
  }
}
