// DRAFT — pending operator review
/*
  132_baby_tease.js — "The Impossible Question"

  OUTCOME-BLIND EVENT
    One 158-second, whole-ship question. Pink and blue occupy discrete pixels—
    never a blended third hue—through heavy-color rounds, fast side-to-side
    scarcity swings, and a Pink / All / Blue / All barrage. Five full-rig white
    blasts close the question. At exactly 158 seconds every lane becomes black
    and STAYS black.
    The operator then manually pushes baby_girl or baby_boy.

  TIMELINE AT NEUTRAL GLOBAL SPEED
      0..60 s — 2.5 s pink-heavy / blue-heavy rounds, always mixed
     60..120 s — fast scarcity swings across alternating ship sides
    120..150 s — Pink / All / Blue / All flash sequence
    150..158 s — five very bright whole-rig white flashes
    158 s+     — exact, indefinite six-lane blackout

  Normalized XYZ is load-bearing and portable. TE signs carry a legible oracle
  weave; Vintage Jewelry alone may emit matched W+A diamonds. UV is always 0.
  localSpeed changes field motion only, never the authored 158-second clock.
  Any sliderRestartTease call resets every clock to event time zero.
  sliderReplayFinale is a pulse action: a rising edge jumps to 120 seconds so
  the operator may extend the finale without replaying the first two minutes.
*/

var FIX_VINTAGE_6 = 3;
var FIX_TE_SIGN = 7;

export var localSpeed = 0.32;
export var level = 0.90;
export var spatialDepth = 0.72;
export var sparkle = 0.58;
export var restartTease = 0.0;
export var replayFinale = 0.0;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderLevel(v) { level = v; }
export function sliderSpatialDepth(v) { spatialDepth = v; }
export function sliderSparkle(v) { sparkle = v; }
export function sliderRestartTease(v) {
  restartTease = v;
  teaseClock = 0.0;
  teasePhase = 0.0;
  oracleA = 0.0;
  oracleB = 0.0;
}
export function sliderReplayFinale(v) {
  if (v >= 0.5 && replayFinale < 0.5) {
    teaseClock = 120.0;
    teasePhase = 0.0;
    oracleA = 0.0;
    oracleB = 0.0;
  }
  replayFinale = v;
}

var PHASE_WRAP = 10000.0;
var teaseClock = 0.0;
var teasePhase = 0.0;
var oracleA = 0.0;
var oracleB = 0.0;
var liveLevel = 0.90;
var liveDepth = 0.72;
var liveSparkle = 0.58;

function clamp01(v) {
  if (v < 0.0) return 0.0;
  if (v > 1.0) return 1.0;
  return v;
}

function smooth01(v) {
  v = clamp01(v);
  return v * v * (3.0 - 2.0 * v);
}

function teaseFrequency(clockValue) {
  if (clockValue < 60.0) return 0.16;
  if (clockValue < 120.0) return 0.31;
  return 0.82;
}

function wrapPhase(v) {
  if (v >= PHASE_WRAP) return v - PHASE_WRAP;
  return v;
}

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;
  var localMultiplier = pow(2.0, (clamp01(localSpeed) - 0.32) * 2.4);
  teaseClock += dt;
  if (teaseClock < 150.0) {
    teasePhase += dt * teaseFrequency(teaseClock);
    oracleA = wrapPhase(oracleA + dt * 0.06180339887 * localMultiplier);
    oracleB = wrapPhase(oracleB + dt * 0.04330127019 * localMultiplier);
  }
  liveLevel = clamp01(level);
  liveDepth = clamp01(spatialDepth);
  liveSparkle = clamp01(sparkle);
}

export function render3D(index, x, y, z) {
  if (teaseClock >= 158.0) {
    rgbwau(0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
    return;
  }

  if (teaseClock >= 150.0) {
    var whiteClock = teaseClock - 150.0;
    var whiteCycle = whiteClock / 1.6;
    var whitePhase = whiteCycle - floor(whiteCycle);
    var whiteFlash = 0.0;
    if (whitePhase < 0.34) whiteFlash = 1.0;
    rgbwau(whiteFlash, whiteFlash, whiteFlash,
           whiteFlash, whiteFlash, 0.0);
    return;
  }

  var nx = clamp01(x);
  var ny = clamp01(y);
  var nz = clamp01(z);
  var cx = nx - 0.5;
  var cy = ny - 0.5;
  var cz = nz - 0.5;
  var radial = sqrt(cx * cx + cz * cz);
  var volumeRadius = sqrt(cx * cx + cy * cy + cz * cz);
  var path = pixelLocalIndex * 0.01351351351;
  var teaseProgress = clamp01(teaseClock / 150.0);
  var whole = teasePhase - floor(teasePhase);
  var half = whole * 2.0;
  var familyPhase = half - floor(half);
  var edgeDistance = min(familyPhase, 1.0 - familyPhase);
  var blueFamily = 0.0;
  var colorGate = 1.0;

  var warpX = cx + (wave(ny * 0.73 + nz * 0.41 + oracleB) - 0.5)
                    * (0.10 + liveDepth * 0.13);
  var warpY = cy + (wave(nz * 0.67 - nx * 0.53 - oracleA * 0.73) - 0.5)
                    * (0.08 + liveDepth * 0.11);
  var warpZ = cz + (wave(nx * 0.59 + ny * 0.47 + oracleB * 0.61) - 0.5)
                    * (0.10 + liveDepth * 0.12);

  var gx = wave(warpX * 1.37 + oracleA);
  var gy = wave(warpY * 1.73 - oracleB);
  var gz = wave(warpZ * 2.11 + oracleA * 0.61803398875);
  var gyroid = 1.0 - clamp01(abs((gx - 0.5) * (gy * 2.0 - 1.0)
                               + (gy - 0.5) * (gz * 2.0 - 1.0)
                               + (gz - 0.5) * (gx * 2.0 - 1.0))
                             * (3.4 + liveDepth * 2.8));
  gyroid = pow(gyroid, 1.2 + liveDepth * 1.8);

  var shellA = 1.0 - clamp01(abs(volumeRadius
    - (0.23 + 0.16 * wave(oracleA + nx * 0.19))) / (0.055 + liveDepth * 0.055));
  var ox = cx + 0.17 * (wave(oracleB * 0.73) - 0.5);
  var oy = cy - 0.12 * (wave(oracleA * 0.53) - 0.5);
  var shellBRadius = sqrt(ox * ox + oy * oy + cz * cz * 0.52);
  var shellB = 1.0 - clamp01(abs(shellBRadius
    - (0.18 + 0.14 * wave(oracleB + nz * 0.23))) / (0.045 + liveDepth * 0.045));
  var shells = max(pow(shellA, 1.5), pow(shellB, 1.7));

  var cellA = wave(warpX * 3.17 + warpY * 1.41 + oracleA * 1.13);
  var cellB = wave(warpY * 2.71 - warpZ * 1.73 - oracleB * 1.07);
  var cellC = wave(warpZ * 3.73 + warpX * 1.19 + oracleA * 0.83);
  var wallAB = 1.0 - clamp01(abs(cellA - cellB) * (5.5 + liveDepth * 5.0));
  var wallBC = 1.0 - clamp01(abs(cellB - cellC) * (5.5 + liveDepth * 5.0));
  var wallCA = 1.0 - clamp01(abs(cellC - cellA) * (5.5 + liveDepth * 5.0));
  var cells = max(wallAB, max(wallBC, wallCA));
  var nodes = pow(wallAB * wallBC * wallCA, 0.32);

  var angle = atan2(cz, cx) / PI2;
  var spiral = wave(radial * (3.8 + teaseProgress * 5.2) - angle * 3.0
                  - oracleA * (0.9 + teaseProgress * 1.6) + cy * 0.47);
  var convergence = pow(spiral, 2.1 + liveDepth * 2.0)
                  * (0.55 + 0.45 * wave(volumeRadius * 2.3 - oracleB));

  var selector = index * 0.61803398875 + nx * 0.61 - ny * 0.37 + nz * 0.53
               + oracleA * 0.73 - oracleB * 0.41;
  selector = selector - floor(selector);
  var oracle = max(gyroid * 0.72, shells * 0.84);
  if (teaseClock < 60.0) {
    var heavyRound = floor(teaseClock / 2.5);
    if ((heavyRound % 2.0) < 1.0) {
      if (selector >= 0.82) blueFamily = 1.0;
    } else {
      if (selector >= 0.18) blueFamily = 1.0;
    }
    oracle = max(oracle, cells * 0.52);
  } else if (teaseClock < 120.0) {
    var swingClock = teaseClock - 60.0;
    var swingCycle = floor(swingClock / 3.0);
    var swingPhase = (swingClock / 3.0) - swingCycle;
    var swingMode = swingCycle % 4.0;
    var leftSide = 0.0;
    if (nx < 0.5) leftSide = 1.0;
    var threshold = 0.50;
    if (swingMode < 1.0) {
      threshold = 0.44;
      if (leftSide > 0.5) threshold = 0.94;
    } else if (swingMode < 2.0) {
      threshold = 0.56;
      if (leftSide < 0.5) threshold = 0.06;
    } else if (swingMode < 3.0) {
      threshold = 0.44;
      if (leftSide < 0.5) threshold = 0.94;
    } else {
      threshold = 0.56;
      if (leftSide > 0.5) threshold = 0.06;
    }
    if (selector >= threshold) blueFamily = 1.0;
    var seamDistance = min(swingPhase, 1.0 - swingPhase);
    colorGate = smooth01(seamDistance / 0.04);
    oracle = max(cells * (0.72 + liveDepth * 0.26),
                 max(nodes * liveSparkle, convergence * 0.70));
  } else {
    var flashClock = teaseClock - 120.0;
    var roundPhase = flashClock / 3.0;
    var roundFraction = roundPhase - floor(roundPhase);
    var flashStep = floor(roundFraction * 4.0);
    var stepPhase = roundFraction * 4.0 - flashStep;
    colorGate = 0.16 + (1.0 - smooth01((stepPhase - 0.18) / 0.42)) * 0.84;
    if (flashStep < 1.0) {
      blueFamily = 0.0;
    } else if (flashStep < 2.0) {
      if (selector >= 0.5) blueFamily = 1.0;
    } else if (flashStep < 3.0) {
      blueFamily = 1.0;
    } else {
      if (selector >= 0.5) blueFamily = 1.0;
    }
    oracle = max(convergence, max(cells * 0.78, nodes * liveSparkle));
    oracle = max(oracle, wave(teasePhase * 2.0) * 0.88);
  }

  if (fixtureType == FIX_TE_SIGN) {
    var signA = wave(path * 2.0 + nx * 0.37 - ny * 0.29 + oracleA * 1.7);
    var signB = wave(path * 3.0 - nz * 0.31 + ny * 0.41 - oracleB * 1.3);
    oracle = max(oracle, pow(1.0 - abs(signA - signB), 2.2) * 0.86);
  }

  var fine = pow(wave(nx * 17.0 + ny * 23.0 + nz * 29.0
                     + path * 5.0 + oracleB * 2.0),
                 7.0 + (1.0 - liveSparkle) * 9.0) * liveSparkle;
  var bri = (0.13 + liveDepth * 0.08
           + oracle * (0.58 + liveDepth * 0.38) + fine * 0.22)
          * liveLevel * colorGate;
  var shade = clamp01(0.18 + oracle * 0.68 + fine * 0.25);
  var outWhite = 0.0;
  if (fixtureType == FIX_VINTAGE_6) {
    var switchDiamond = 1.0 - smooth01(edgeDistance / 0.12);
    outWhite = clamp01((switchDiamond * 0.48
                      + nodes * 0.35 * liveSparkle) * liveLevel * colorGate);
  }

  bri = clamp01(bri);
  var r;
  var g;
  var b;
  if (blueFamily >= 0.5) {
    r = (0.008 + shade * 0.030) * bri;
    g = (0.15 + shade * 0.34) * bri;
    b = (0.58 + shade * 0.42) * bri;
  } else {
    r = (0.60 + shade * 0.40) * bri;
    g = (0.008 + shade * 0.030) * bri;
    b = (0.16 + shade * 0.20) * bri;
  }
  rgbwau(clamp01(r), clamp01(g), clamp01(b), outWhite, outWhite, 0.0);
}
