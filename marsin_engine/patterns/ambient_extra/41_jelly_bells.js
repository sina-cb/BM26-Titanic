// DRAFT — pending operator review
/*
  41_jelly_bells.js — JELLY BELLS

  CONCEPT
    One to three translucent jelly bells float vertically through the ship.
    Each has a finite ellipsoidal umbrella, an attached family of trailing
    segmented filaments, and restrained phosphor tips. They are buoyant animals,
    not manta silhouettes, seaweed fronds, or a generic drifting field.

  INSTRUMENT STAGING
    FIX_BAR_18     — translucent umbrella caps and scalloped lower rims.
    FIX_RAW_LED    — attached, visibly segmented tentacles beneath every cap.
    FIX_VINTAGE_6  — sparse phosphor filament tips with matched native W+A.
    FIX_PAR        — stable inner bell cores that swell with each pulse.
    FIX_TE_SIGN    — identical full-surface jelly emblems on both TE signs.

  MOTION / MATH
    Each umbrella is a finite ellipsoidal-cap signed-distance field with a
    carved underside and scalloped rim. Three to seven tentacles are selected
    analytically from the nearest attachment point, avoiding a nested strand
    loop. Their curvature samples a delayed phase, so the filaments visibly
    follow rather than lead the bell pulse. Irrational phase offsets keep the
    three animals from synchronizing into a short loop.

  CONTROLS (declaration order = physical MIDI order)
    localSpeed  — vertical float and autonomous pulse cadence.
    bellCount   — exactly one, two, or three complete jelly bells.
    bellSize    — umbrella width, depth, and height.
    pulse       — strength of bell compression and phosphor energy.
    tentacle    — three-to-seven filament count, length, curl, and definition.
    jewelryTips — Vintage phosphor-tip brightness and matched W+A intensity.
    safetyFloor — minimum palette-derived whole-vessel visibility.

  AUDIO_MODULATION_V1:
    sliderPulse       <- micLow range 0.18..0.48 curve ease # PRIMARY: lows compress and illuminate the bells
    sliderJewelryTips <- micHigh range 0.03..0.28 curve pow2 # highs lift sparse Vintage phosphor tips
  Static (unmapped) params: localSpeed, bellCount, bellSize, tentacle,
    safetyFloor, colorPalette1/2.

  COLOR / OUTPUT
    Every RGB value lies on the selected cp1↔cp2 line. Native white is emitted
    only by Vintage phosphor tips and always has W=A. UV is always zero.
    Autonomous floating and pulsing remain complete and buoyant in silence.
*/

export var cp1H = 0.50, cp1S = 0.78, cp1V = 0.90;
export var cp2H = 0.79, cp2S = 0.62, cp2V = 1.00;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export var localSpeed = 0.30;
export var bellCount = 0.55;
export var bellSize = 0.56;
export var pulse = 0.34;
export var tentacle = 0.54;
export var jewelryTips = 0.18;
export var safetyFloor = 0.24;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderBellCount(v) { bellCount = v; }
export function sliderBellSize(v) { bellSize = v; }
export function sliderPulse(v) { pulse = v; }
export function sliderTentacle(v) { tentacle = v; }
export function sliderJewelryTips(v) { jewelryTips = v; }
export function sliderSafetyFloor(v) { safetyFloor = v; }

var PHASE_WRAP = 10000.0;
var PHI = 1.61803399;
var SQRT2 = 1.41421356;
var SQRT3 = 1.73205081;
var GOLDEN_ANGLE = 2.39996323;

var floatClock = 0.13;
var pulseClock = 0.31;
var trailClock = 0.23;
var activeBells = 2.0;
var activeTentacles = 5.0;

var bellX = array(3);
var bellY = array(3);
var bellZ = array(3);
var bellPulse = array(3);
var bellTrail = array(3);

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
  else if (iv == 4.0) { pr2 = tv;   pg2 = pv;   pb2 = cp2V; }
  else                 { pr2 = cp2V; pg2 = pv;   pb2 = qv;   }
}

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  var localMultiplier = 0.25 + clamp01(localSpeed)
    * (32.824 - 16.412 * clamp01(localSpeed));
  floatClock += dt * (0.012 + localMultiplier * 0.040);
  pulseClock += dt * (0.018 + localMultiplier * 0.066);
  trailClock += dt * (0.015 + localMultiplier * 0.055);
  if (floatClock >= PHASE_WRAP) floatClock -= PHASE_WRAP;
  if (pulseClock >= PHASE_WRAP) pulseClock -= PHASE_WRAP;
  if (trailClock >= PHASE_WRAP) trailClock -= PHASE_WRAP;

  activeBells = 1.0 + floor(clamp01(bellCount) * 2.999);
  activeTentacles = 3.0 + floor(clamp01(tentacle) * 4.999);

  var spacing = 0.28;
  var centerOffset = (activeBells - 1.0) * 0.5;
  var k = 0.0;
  for (k = 0.0; k < 3.0; k = k + 1.0) {
    var phaseOffset = k * PHI;
    var buoyancy = sin((floatClock * SQRT2 + phaseOffset) * PI2);
    var pulseWave = 0.5 + 0.5 * sin((pulseClock + phaseOffset) * PI2);
    var delayedWave = 0.5 + 0.5
                    * sin((trailClock + phaseOffset - 0.055) * PI2);
    bellX[k] = 0.50 + (k - centerOffset) * spacing
             + sin((floatClock * 0.37 + phaseOffset) * PI2) * 0.018;
    bellY[k] = 0.57 + buoyancy * (0.070 + bellSize * 0.030)
             + pulseWave * pulse * 0.025;
    bellZ[k] = 0.50 + sin(phaseOffset * GOLDEN_ANGLE
                         + floatClock * PI2 * 0.23) * 0.13;
    bellPulse[k] = pulseWave;
    bellTrail[k] = delayedWave;
  }

  _hsv2rgb1();
  _hsv2rgb2();
}

export function render3D(index, x, y, z) {
  var nx = clamp01(x);
  var ny = clamp01(y);
  var nz = clamp01(z);
  var isBar = fixtureType == FIX_BAR_18;
  var isRaw = fixtureType == FIX_RAW_LED;
  var isVintage = fixtureType == FIX_VINTAGE_6;
  var isPar = fixtureType == FIX_PAR;
  var isSign = fixtureType == FIX_TE_SIGN;

  if (isSign) {
    // Each 74-pixel sign spans 40- and 34-pixel fixtures whose local counters
    // restart. Fold model index over the complete 10x8 authored surface so the
    // lower fixture continues the emblem and both signs remain byte-identical.
    var signIndex = index % 74.0;
    nx = (signIndex % 10.0) / 9.0;
    ny = floor(signIndex / 10.0) / 7.0;
    nz = 0.50;
  }

  var size = 0.105 + clamp01(bellSize) * 0.115;
  if (isSign) size *= 0.80;
  var capField = 0.0;
  var rimField = 0.0;
  var tentacleField = 0.0;
  var tipField = 0.0;
  var coreField = 0.0;
  var colorField = 0.0;

  // Bell caps are separated horizontally at every supported count, so the
  // nearest X cohort is the only animal that can influence this pixel. This
  // spatial selector preserves all one-to-three complete bells without a
  // three-animal loop in the 40 fps pixel path.
  var k = 0.0;
  if (activeBells == 2.0 && nx >= 0.50) k = 1.0;
  else if (activeBells >= 3.0) {
    if (nx >= 0.64) k = 2.0;
    else if (nx >= 0.36) k = 1.0;
  }
  if (k < activeBells) {
      var cx = bellX[k];
      var cy = bellY[k];
      var cz = bellZ[k];
      if (isSign) {
        // Fit the same one-to-three emblem arrangement onto each local card.
        cx = 0.50 + (k - (activeBells - 1.0) * 0.5) * 0.28;
        cy = 0.61 + sin((floatClock * SQRT2 + k * PHI) * PI2) * 0.035;
        cz = 0.50;
      }

      var livePulse = clamp01(pulse) * bellPulse[k];
      var capWidth = size * (0.91 + livePulse * 0.22);
      var capDepth = size * (0.64 + livePulse * 0.12);
      var capHeight = size * (0.68 - livePulse * 0.16);
      var dx = nx - cx;
      var dy = ny - cy;
      var dz = nz - cz;
      var radialSquared = (dx * dx) / (capWidth * capWidth)
                        + (dz * dz) / (capDepth * capDepth);
      var vertical = (dy - capHeight * 0.18) / capHeight;
      var ellipsoidSquared = radialSquared + vertical * vertical;

      // The lower cut and carved inner surface turn the ellipsoid into an
      // umbrella rather than a sphere. A scalloped finite rim closes the cap.
      var outer = 0.0;
      if (dy > -capHeight * 0.18 && dy < capHeight * 1.12) {
        outer = smooth01(1.0 - (ellipsoidSquared - 0.52) / 0.61);
      }
      var innerVertical = (dy + capHeight * 0.03) / (capHeight * 0.50);
      var inner = smooth01(1.0 - radialSquared
                          - innerVertical * innerVertical);
      var translucentCap = max(0.0, outer - inner * 0.74);
      var rimTarget = 0.82 + livePulse * 0.08;
      var rimDistance = abs(radialSquared - rimTarget * rimTarget);
      var rimHeight = abs(dy + capHeight * 0.08);
      var scallop = 0.84;
      if (isBar || isSign) {
        scallop = 0.70 + 0.30
                * wave(dx / max(capWidth, 0.001) * 3.1
                     - dz / max(capDepth, 0.001) * 2.9 + k * PHI);
      }
      var rim = smooth01(1.0 - rimDistance / 0.34)
              * smooth01(1.0 - rimHeight / (capHeight * 0.28)) * scallop;
      var cap = clamp01(translucentCap * (0.46 + livePulse * 0.36)
                       + rim * 0.72);
      if (cap > capField) {
        capField = cap;
        colorField = clamp01(0.12 + k * 0.34 + livePulse * 0.18);
      }
      if (rim > rimField) rimField = rim;

      // PARs carry the stationary interior of each moving animal, not a
      // separate free-floating sparkle.
      var coreDistanceSquared = (dx * dx + dz * dz)
                              / max(capWidth * capWidth * 0.30, 0.0001)
                              + (dy * dy)
                              / max(capHeight * capHeight * 0.42, 0.0001);
      var core = smooth01(1.0 - coreDistanceSquared);
      core *= 0.64 + livePulse * 0.36;
      if (core > coreField) coreField = core;

      // The nearest attachment-point solve renders 3–7 separate filaments
      // without evaluating every strand. Every curve begins at the cap's
      // underside and ends after one finite, segmented tether length.
      if (isRaw || isVintage || isSign) {
        var strandCount = activeTentacles;
        if (isSign) strandCount = min(5.0, strandCount);
        var across = dx / max(capWidth * 1.34, 0.001) + 0.50;
        var strandIndex = floor(across * strandCount);
        if (strandIndex < 0.0) strandIndex = 0.0;
        if (strandIndex > strandCount - 1.0) strandIndex = strandCount - 1.0;
        var strandUnit = (strandIndex + 0.5) / strandCount - 0.5;
        var anchorX = cx + strandUnit * capWidth * 1.55;
        var anchorZ = cz + sin((strandIndex + 1.0) * GOLDEN_ANGLE)
                           * capDepth * 0.30;
        var tetherLength = size * (1.20 + clamp01(tentacle) * 1.85);
        if (isSign) tetherLength *= 0.72;
        var tetherProgress = (cy - capHeight * 0.10 - ny)
                           / max(tetherLength, 0.001);
        if (tetherProgress >= 0.0 && tetherProgress <= 1.0) {
          // A low attached veil guarantees the family reads across sparse
          // Silhouette coordinates; crisp analytic strands remain on top.
          var tetherEnvelope = smooth01(1.0
                              - abs(dx) / max(capWidth * 0.92, 0.001))
                            * (1.0 - tetherProgress * 0.62)
                            * (0.06 + clamp01(tentacle) * 0.24);
          if (tetherEnvelope > tentacleField) {
            tentacleField = tetherEnvelope;
          }
          var delayed = bellTrail[k];
          var sway = (0.014 + clamp01(tentacle) * 0.050)
                   * tetherProgress * tetherProgress;
          var curveX = anchorX + sin(tetherProgress * PI * 1.45
                                    + trailClock * PI2 * 0.71
                                    + strandIndex * PHI) * sway
                                * (0.65 + delayed * 0.35);
          // A sloped Z tail keeps the curve genuinely three-dimensional while
          // the delayed X wave supplies the visible follow-through.
          var curveZ = anchorZ + (tetherProgress - 0.5) * sway * SQRT2;
          var tetherDistanceSquared = (nx - curveX) * (nx - curveX)
                                    + (nz - curveZ) * (nz - curveZ);
          var tetherWidth = 0.008 + clamp01(tentacle) * 0.018;
          if (isSign) tetherWidth *= 1.65;
          var attached = smooth01(1.0 - tetherDistanceSquared
                                 / max(tetherWidth * tetherWidth, 0.000001));
          var segmentCount = 3.0 + floor(clamp01(tentacle) * 4.999);
          var segmentWave = wave(tetherProgress * segmentCount
                               - trailClock * 0.31
                               + strandIndex * 0.17);
          var segment = 0.48 + 0.52 * segmentWave * segmentWave
                      * (0.40 + segmentWave * 0.60);
          // Keep the first segment continuous at the rim attachment.
          if (tetherProgress < 0.11) segment = max(segment, 0.82);
          var filament = attached * segment
                       * (1.0 - tetherProgress * 0.26);
          if (filament > tentacleField) tentacleField = filament;

          var tip = attached * smoothstep(0.76, 0.96, tetherProgress);
          if (tip > tipField) tipField = tip;
        }
      }
  }

  var floorLevel = 0.050 + clamp01(safetyFloor) * 0.220;
  var pulseEnergy = 0.16 + clamp01(pulse) * 1.16;
  var brightness = floorLevel + capField * (0.20 + pulseEnergy * 0.66)
                 + rimField * 0.22 + coreField * pulseEnergy * 0.30;
  var paletteMix = clamp01(0.08 + colorField * 0.78
                          + rimField * 0.12);
  // A single broad bioluminescent current carries the detailed animals. The
  // foreground bells remain finite; this slow field only prevents the sparse
  // model and sign surface from reading as isolated static dots at distance.
  var currentCenter = 0.50 + 0.42 * sin(trailClock * PI2 * 0.41);
  var bellCurrent = 1.0 - smoothstep(0.12, 0.49,
                                    abs(nx - currentCenter));
  var currentField = wave(nx * 0.67 + ny * 0.31 - trailClock * 0.53)
                   * wave(ny * 0.59 - nx * 0.23 + trailClock * SQRT2);

  if (isRaw) {
    // Silhouette is the tether instrument: a restrained cap trace plus the
    // complete delayed filament family preserves the vessel outline.
    brightness = floorLevel + 0.045 + rimField * 0.24
               + tentacleField * (0.48 + tentacle * 0.42)
               + capField * 0.20;
    paletteMix = clamp01(0.16 + tentacleField * 0.70
                        + colorField * 0.16);
  } else if (isVintage) {
    // Jewelry holds only sparse finite tips. The whole rail responds enough
    // for its dedicated brightness control to remain truthful, but the native
    // white emitter is concentrated at actual tether endpoints below.
    var tipSeed = pow(wave(pixelLocalIndex * 0.38196601
                          + fixtureId * PHI), 9.0);
    var phosphor = tipField * (0.30 + tipSeed * 0.70);
    brightness = floorLevel * 0.82 + 0.035
               + jewelryTips * 1.05
               + phosphor * (0.16 + jewelryTips * 0.84);
    paletteMix = clamp01(0.52 + phosphor * 0.42);
  } else if (isPar) {
    // Organs are broad inner cores whose autonomous pulse remains visible in
    // silence and whose low-band modulation is never a harsh flash.
    brightness = floorLevel + 0.10
               + coreField * (0.30 + pulseEnergy * 0.54)
               + capField * 0.12;
    paletteMix = clamp01(0.12 + coreField * 0.74);
  } else if (isSign) {
    // Local jelly emblems include umbrella, attached tether, and core above a
    // firm identity floor. No world coordinate can imbalance the sign pair.
    var signFilaments = pow(wave(nx * activeTentacles
                               + ny * 0.17 - trailClock * 0.35), 7.0)
                      * (1.0 - ny) * clamp01(tentacle);
    brightness = max(0.30, floorLevel + 0.13
                   + capField * (0.28 + pulseEnergy * 0.38)
                   + rimField * 0.18 + tentacleField * 0.44
                   + signFilaments * 0.42 + coreField * 0.24
                   + bellCurrent * (0.15 + currentField * 0.22));
    paletteMix = clamp01(0.10 + colorField * 0.68
                        + tentacleField * 0.18
                        + signFilaments * 0.20 + coreField * 0.08
                        + currentField * 0.14 + bellCurrent * 0.08);
  }

  if (!isSign) {
    brightness += bellCurrent * (0.035 + currentField * 0.060);
    paletteMix += currentField * 0.06;
  }

  // Pulse is the low-band energy handle. Its restrained global lift makes the
  // complete translucent animal breathe with bass while preserving the final
  // Dimmer Rack authority and the independent safety-floor geometry.
  brightness *= 0.35 + clamp01(pulse) * 1.65;
  brightness = clamp01(brightness);
  paletteMix = clamp01(paletteMix);
  var outR = (pr1 + (pr2 - pr1) * paletteMix) * brightness;
  var outG = (pg1 + (pg2 - pg1) * paletteMix) * brightness;
  var outB = (pb1 + (pb2 - pb1) * paletteMix) * brightness;

  var white = 0.0;
  if (isVintage) {
    var whiteSeed = pow(wave(pixelLocalIndex * 0.38196601
                            + fixtureId * PHI), 9.0);
    var whiteTip = tipField * (0.30 + whiteSeed * 0.70);
    white = clamp01((0.10 + whiteTip * 0.90)
                  * clamp01(jewelryTips) * 0.92);
  }

  rgbwau(clamp01(outR), clamp01(outG), clamp01(outB), white, white, 0.0);
}
