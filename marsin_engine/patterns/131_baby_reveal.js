// DRAFT — pending operator review
/*
  131_baby_reveal.js — "The Impossible Question"

  CINEMATIC IDEA
    The entire ship becomes a ninety-second mathematical oracle in six acts.
    Pink prophecy opens the question; blue answers; both families then divide
    the SAME evolving 3D field into orbit, cellular, and helix territories.
    Whole-ship alternation accelerates into a two-second flash barrage. The
    answer is never encoded in the tease. Two seconds of absolute black erase
    the question; then one colour family explodes outward and settles into a
    slow photo-safe rose.

  INSTRUMENT AUTHORSHIP
    Normalized XYZ is the load-bearing canvas, so the event works on Titanic,
    test_bench, and other models. Fixture roles change material, not topology:
    bars carry the deep field, strands trace its edges, pars broaden the major
    wavefronts, Identity receives a legible oracle weave, and Vintage Jewelry
    alone may emit matched W+A diamond highlights. No UV is emitted.

  COLOUR CONTRACT
    This pattern intentionally exports no global palette functions. Tease
    Every pixel is EITHER one of two pink shades OR one of two blue shades.
    Spatial duality acts may show both families on different pixels, but never
    interpolate between them, so no accidental purple/green/orange appears.
    The final scene uses only the selected family. Native white is confined to
    FIX_VINTAGE_6 and always has W == A.

  TIMELINE AT NEUTRAL GLOBAL SPEED
     0..14 s — pink prophecy / gyroid ribbons
    14..28 s — blue answer / orbit shells
    28..46 s — pink + blue spatial duality
    46..64 s — cellular territory chase
    64..78 s — counter-wound helix duel
    78..88 s — accelerating whole-ship alternation
    88..90 s — flash barrage, accelerating to ten cycles per second
    90..92 s — exact two-second six-lane blackout
    92 s+    — selected answer explodes outward, then remains photo-safe

  The engine scales delta by global SPEED; the event cue pins SPEED to its
  neutral value. localSpeed changes oracle/photo FIELD motion but never the
  reveal clock or pink/blue alternation, so it cannot corrupt 90 + 2 seconds.

  FINAL COLOR: sliderFinalColor = 0.0 is baby pink; 1.0 is baby blue.
  RESTART: any sliderRestartReveal call resets every clock to event time zero.
  No audio modulation: this is a rehearsed event, not an audio instrument.
*/

// Optional accent roles. Models without them simply match no pixels.
var FIX_VINTAGE_6 = 3;
var FIX_TE_SIGN = 7;

// Export order is physical MIDI knob order.
export var localSpeed = 0.32;       // field motion only; never event timing
export var finalColor = 0.0;        // 0 pink, 1 blue; unread before t=92
export var level = 0.90;
export var spatialDepth = 0.72;     // oracle topology depth and contrast
export var sparkle = 0.58;          // fine caustics + Jewelry diamonds
export var restartReveal = 0.0;     // setter call resets the event

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderFinalColor(v) { finalColor = v; }
export function sliderLevel(v) { level = v; }
export function sliderSpatialDepth(v) { spatialDepth = v; }
export function sliderSparkle(v) { sparkle = v; }
export function sliderRestartReveal(v) {
  restartReveal = v;
  revealClock = 0.0;
  photoA = 0.0;
  photoB = 0.0;
  oracleA = 0.0;
  oracleB = 0.0;
  teasePhase = 0.0;
}

var PHASE_WRAP = 10000.0;
var revealClock = 0.0;
var teasePhase = 0.0;
var oracleA = 0.0;
var oracleB = 0.0;
var photoA = 0.0;
var photoB = 0.0;

var liveLevel = 0.90;
var liveFinal = 0.0;
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

function revealFrequency(clockValue) {
  // The opening acts use this as a slow field breath. The last twelve seconds
  // turn it into a whole-ship question, ending in a deliberate flash barrage.
  if (clockValue < 28.0) return 0.095;
  if (clockValue < 64.0) return 0.14 + (clockValue - 28.0) * 0.004;
  if (clockValue < 78.0) return 0.284 + (clockValue - 64.0) * 0.018;
  if (clockValue < 88.0) return 0.536 + (clockValue - 78.0) * 0.1464;
  return 2.0 + (clockValue - 88.0) * 4.0;
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
  revealClock += dt;
  if (revealClock < 90.0) {
    teasePhase += dt * revealFrequency(revealClock);
    oracleA = wrapPhase(oracleA + dt * 0.06180339887 * localMultiplier);
    oracleB = wrapPhase(oracleB + dt * 0.04330127019 * localMultiplier);
  }
  if (revealClock >= 92.0) {
    photoA = wrapPhase(photoA + dt * 0.04142135624 * localMultiplier);
    photoB = wrapPhase(photoB + dt * 0.02732050808 * localMultiplier);
  }

  liveLevel = clamp01(level);
  liveFinal = clamp01(finalColor);
  liveDepth = clamp01(spatialDepth);
  liveSparkle = clamp01(sparkle);
}

export function render3D(index, x, y, z) {
  var nx = clamp01(x);
  var ny = clamp01(y);
  var nz = clamp01(z);

  if (revealClock >= 90.0 && revealClock < 92.0) {
    rgbwau(0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
    return;
  }

  var cx = nx - 0.5;
  var cy = ny - 0.5;
  var cz = nz - 0.5;
  var radial = sqrt(cx * cx + cz * cz);
  var volumeRadius = sqrt(cx * cx + cy * cy + cz * cz);
  var path = pixelLocalIndex * 0.01351351351;

  var blueFamily = 0.0;
  var shade = 0.0;
  var bri = 0.0;
  var outWhite = 0.0;

  if (revealClock < 90.0) {
    var teaseProgress = clamp01(revealClock / 90.0);
    var whole = teasePhase - floor(teasePhase);
    var half = whole * 2.0;
    var familyPhase = half - floor(half);
    var edgeDistance = min(familyPhase, 1.0 - familyPhase);
    var colorGate = 1.0;

    // Domain-warped triply-periodic minimal-surface vocabulary. The three
    // incommensurate axes keep the field from reading as repeated stripes.
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

    // Three oblique orbit shells expand through the ship on irrational clocks.
    var shellA = 1.0 - clamp01(abs(volumeRadius
      - (0.23 + 0.16 * wave(oracleA + nx * 0.19))) / (0.055 + liveDepth * 0.055));
    var ox = cx + 0.17 * (wave(oracleB * 0.73) - 0.5);
    var oy = cy - 0.12 * (wave(oracleA * 0.53) - 0.5);
    var shellBRadius = sqrt(ox * ox + oy * oy + cz * cz * 0.52);
    var shellB = 1.0 - clamp01(abs(shellBRadius
      - (0.18 + 0.14 * wave(oracleB + nz * 0.23))) / (0.045 + liveDepth * 0.045));
    var shells = max(pow(shellA, 1.5), pow(shellB, 1.7));

    // Cellular equality walls and focal nodes become dominant late in tease.
    var cellA = wave(warpX * 3.17 + warpY * 1.41 + oracleA * 1.13);
    var cellB = wave(warpY * 2.71 - warpZ * 1.73 - oracleB * 1.07);
    var cellC = wave(warpZ * 3.73 + warpX * 1.19 + oracleA * 0.83);
    var wallAB = 1.0 - clamp01(abs(cellA - cellB) * (5.5 + liveDepth * 5.0));
    var wallBC = 1.0 - clamp01(abs(cellB - cellC) * (5.5 + liveDepth * 5.0));
    var wallCA = 1.0 - clamp01(abs(cellC - cellA) * (5.5 + liveDepth * 5.0));
    var cells = max(wallAB, max(wallBC, wallCA));
    var nodes = pow(wallAB * wallBC * wallCA, 0.32);

    // Radial convergence provides the broad, far-field helix duel.
    var angle = atan2(cz, cx) / PI2;
    var spiral = wave(radial * (3.8 + teaseProgress * 5.2) - angle * 3.0
                    - oracleA * (0.9 + teaseProgress * 1.6) + cy * 0.47);
    var convergence = pow(spiral, 2.1 + liveDepth * 2.0)
                    * (0.55 + 0.45 * wave(volumeRadius * 2.3 - oracleB));

    // Each chapter has its own topology and colour choreography. Spatial acts
    // assign discrete pink/blue families per pixel; the late acts switch the
    // entire ship together. At no point are family RGB values interpolated.
    var oracle = gyroid;
    if (revealClock < 14.0) {
      blueFamily = 0.0;
      colorGate = 0.76 + wave(teasePhase) * 0.24;
    } else if (revealClock < 28.0) {
      blueFamily = 1.0;
      var orbitArrival = smooth01((revealClock - 14.0) / 1.4);
      oracle = max(gyroid * (1.0 - orbitArrival) * 0.72,
                   shells * (0.72 + orbitArrival * 0.28));
      colorGate = smooth01(abs(revealClock - 14.0) / 0.55);
    } else if (revealClock < 46.0) {
      oracle = max(gyroid * 0.68, shells);
      var duality = wave(nx * 0.61 - ny * 0.37 + nz * 0.53
                       + oracleA * 0.73 - oracleB * 0.41);
      if (duality >= 0.5) blueFamily = 1.0;
    } else if (revealClock < 64.0) {
      oracle = max(cells * (0.70 + liveDepth * 0.28),
                   nodes * (0.52 + liveSparkle * 0.48));
      if (cellB >= cellA) blueFamily = 1.0;
    } else if (revealClock < 78.0) {
      oracle = max(convergence, shells * 0.58);
      if (spiral >= 0.5) blueFamily = 1.0;
    } else {
      blueFamily = floor(half);
      oracle = max(convergence, max(cells * 0.76, nodes * liveSparkle));
      oracle = max(oracle, shells * 0.66);
      colorGate = smooth01(edgeDistance / 0.10);
      if (revealClock >= 88.0) {
        // A sharp luminous barrage separated by real dark seams. Frequency is
        // integrated in beforeRender, so the acceleration remains continuous.
        colorGate = smooth01(edgeDistance / 0.18);
        oracle = max(oracle, wave(teasePhase * 2.0) * 0.92);
      }
    }

    // Instrument materials remain portable fixture capabilities.
    if (fixtureType == FIX_TE_SIGN) {
      var signWeaveA = wave(path * 2.0 + nx * 0.37 - ny * 0.29 + oracleA * 1.7);
      var signWeaveB = wave(path * 3.0 - nz * 0.31 + ny * 0.41 - oracleB * 1.3);
      oracle = max(oracle, pow(1.0 - abs(signWeaveA - signWeaveB), 2.2) * 0.86);
    }

    var fine = pow(wave(nx * 17.0 + ny * 23.0 + nz * 29.0
                       + path * 5.0 + oracleB * 2.0),
                   7.0 + (1.0 - liveSparkle) * 9.0) * liveSparkle;
    var safety = 0.13 + liveDepth * 0.08;
    bri = (safety + oracle * (0.58 + liveDepth * 0.38) + fine * 0.22)
        * liveLevel * colorGate;
    shade = clamp01(0.18 + oracle * 0.68 + fine * 0.25);

    // White diamond seam only on Vintage Jewelry, strongest around a colour
    // change and at triple-field focal nodes. W and A share this exact scalar.
    if (fixtureType == FIX_VINTAGE_6) {
      var switchDiamond = 1.0 - smooth01(edgeDistance / 0.12);
      outWhite = clamp01((switchDiamond * 0.48 + nodes * 0.35 * liveSparkle)
                       * liveLevel * colorGate);
    }
  } else {
    blueFamily = smooth01(liveFinal);
    var arrivalT = revealClock - 92.0;
    var arrival = smooth01(arrivalT / 0.18);
    var flashTail = 1.0 - smooth01((arrivalT - 0.04) / 1.85);

    // A six-petal rose window wrapped around a breathing spherical caustic.
    // The topology morphs in place for photographs; it never changes family.
    var angle = atan2(cz, cx) / PI2;
    var petalRadius = 0.25 + 0.065 * wave(angle * 6.0 - photoA * 0.83);
    var roseDistance = abs(radial - petalRadius);
    var rose = 1.0 - clamp01(roseDistance / (0.075 + liveDepth * 0.045));
    rose = pow(rose, 1.35 + liveDepth * 1.2);

    var ribbonA = wave(nx * 0.73 + ny * 0.31 - nz * 0.47 - photoA);
    var ribbonB = wave(-nx * 0.41 + ny * 0.67 + nz * 0.37 + photoB);
    var silk = pow(1.0 - abs(ribbonA - ribbonB), 2.4 + liveDepth * 2.8);
    var halo = wave(volumeRadius * 1.9 - photoA * 0.61);
    var photoField = max(rose * (0.65 + halo * 0.35), silk * 0.78);

    // The answer arrives as an expanding spherical shock front and twelve
    // petal-rays, then yields cleanly to the photo-safe rose within two seconds.
    var blastRadius = arrivalT * 0.58;
    var blastFront = 1.0 - clamp01(abs(volumeRadius - blastRadius)
                                 / (0.055 + liveDepth * 0.045));
    var blastLife = 1.0 - smooth01((arrivalT - 0.35) / 1.65);
    var blastRays = pow(wave(angle * 12.0 + cy * 1.7 - photoA * 0.35), 5.2)
                  * blastLife;
    photoField = max(photoField, blastFront * blastLife);
    photoField = max(photoField, blastRays * 0.88);

    var seed = nx * 17.17 + ny * 31.73 + nz * 47.11 + path * 7.0;
    var diamond = pow(wave(seed + photoB * 2.0),
                      9.0 + (1.0 - liveSparkle) * 12.0) * liveSparkle;

    if (fixtureType == FIX_TE_SIGN) {
      var oracleSign = wave(path * 1.8 + nx * 0.43 - ny * 0.31
                          + nz * 0.27 - photoA * 1.35);
      var counterSign = wave(path * 2.7 - nx * 0.29 + ny * 0.37
                           + photoB * 1.73);
      photoField = max(photoField,
        0.42 + pow(1.0 - abs(oracleSign - counterSign), 2.0) * 0.48);
    }

    bri = clamp01((0.22 + photoField * (0.55 + liveDepth * 0.30)
                 + diamond * 0.22 + flashTail * 0.42) * liveLevel) * arrival;
    shade = clamp01(0.20 + photoField * 0.70 + diamond * 0.28);

    if (fixtureType == FIX_VINTAGE_6) {
      outWhite = clamp01((diamond * 0.48 + flashTail * 0.56)
                       * liveSparkle * liveLevel) * arrival;
    }
  }

  bri = clamp01(bri);
  outWhite = clamp01(outWhite);

  // Two shades inside one discrete family. Because blueFamily is binary during
  // tease and fixed after reveal, these branches never synthesize a third hue.
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
