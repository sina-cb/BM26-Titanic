// DRAFT — pending operator review
/*
  21_pendulum_room.js — PENDULUM ROOM

  CONCEPT
    Two to five luminous pendulums inhabit one quiet architectural room. Each
    has a finite pivot, rod, travel arc and bob. Their irrational natural
    periods keep the motion from becoming a repeated chase; weak coupling
    draws neighboring clocks toward one another without phase-locking them.

  INSTRUMENT STAGING
    FIX_BAR_18     — a restrained paneled room behind the clock geometry.
    FIX_RAW_LED    — fine travel arcs and the clearest rod silhouettes.
    FIX_VINTAGE_6  — moving golden-white bobs with matched W=A lanes.
    FIX_PAR        — weighty pivot lamps at the top of each pendulum.
    FIX_TE_SIGN    — identical paired miniature pendulum clocks, held bright
                     enough for the Titanic identity to remain readable.

  CONTROLS (declaration order = physical MIDI order)
    localSpeed    — pace of all pendulum clocks.
    pendulumCount — smoothly introduces two through five complete pendulums.
    arc           — width of the pendulums' swing.
    coupling      — how strongly neighboring clocks influence their spacing.
    bobSize       — diameter and halo of each luminous bob.
    jewelryBob    — matched native W+A lift on Vintage bob pixels only.
    safetyFloor   — minimum palette-derived whole-rig visibility.

  AUDIO_MODULATION_V1:
    sliderArc      <- micLow range 0.22..0.52 curve ease   # low energy opens the swing
    sliderCoupling <- micMid range 0.12..0.45 curve linear # mids gather the clocks without locking them
  Static (unmapped) params: localSpeed, pendulumCount, bobSize, jewelryBob,
    safetyFloor, colorPalette1/2.

  COLOR / OUTPUT
    RGB stays strictly on the cp1-to-cp2 line. Only Vintage emits native
    white; its W and A lanes are byte-identical. UV is always zero. Silence
    remains a complete, continuously moving ambient composition.
*/

export var localSpeed = 0.30;
export var pendulumCount = 0.48;
export var arc = 0.36;
export var coupling = 0.26;
export var bobSize = 0.42;
export var jewelryBob = 0.72;
export var safetyFloor = 0.28;

export var cp1H = 0.61, cp1S = 0.72, cp1V = 0.88;
export var cp2H = 0.095, cp2S = 0.72, cp2V = 1.00;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderPendulumCount(v) { pendulumCount = v; }
export function sliderArc(v) { arc = v; }
export function sliderCoupling(v) { coupling = v; }
export function sliderBobSize(v) { bobSize = v; }
export function sliderJewelryBob(v) { jewelryBob = v; }
export function sliderSafetyFloor(v) { safetyFloor = v; }

var SQRT2 = 1.41421356;
var SQRT3 = 1.73205081;
var PHI = 1.61803399;
var SQRT5 = 2.23606798;
var PHASE_WRAP = 62831.85307;

var phase1 = 0.0;
var phase2 = 1.17;
var phase3 = 2.71;
var phase4 = 4.13;
var phase5 = 5.42;

var livePendulumCount = 0.48;
var liveArc = 0.36;
var liveCoupling = 0.26;
var liveBobSize = 0.42;
var liveJewelryBob = 0.72;
var liveSafetyFloor = 0.28;

var bobX1 = 0.12, bobY1 = 0.625;
var bobX2 = 0.31, bobY2 = 0.558;
var bobX3 = 0.50, bobY3 = 0.561;
var bobX4 = 0.69, bobY4 = 0.625;
var bobX5 = 0.88, bobY5 = 0.558;
var liveHorizontalReach = 0.16;

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

  // Geometry controls slew so MIDI and audio edits bend the room instead of
  // teleporting it. Count uses fractional introduction for the same reason.
  var follow = min(1.0, dt * 4.5);
  livePendulumCount += (pendulumCount - livePendulumCount) * follow;
  liveArc += (arc - liveArc) * follow;
  liveCoupling += (coupling - liveCoupling) * follow;
  liveBobSize += (bobSize - liveBobSize) * follow;
  liveJewelryBob += (jewelryBob - liveJewelryBob) * follow;
  liveSafetyFloor += (safetyFloor - liveSafetyFloor) * follow;

  var localMultiplier = 0.25 + clamp01(localSpeed)
    * (32.824 - 16.412 * clamp01(localSpeed));
  var baseRate = 0.41 * localMultiplier;
  phase1 += dt * baseRate;
  phase2 += dt * baseRate * SQRT2;
  phase3 += dt * baseRate * SQRT3;
  phase4 += dt * baseRate * PHI;
  phase5 += dt * baseRate * SQRT5;
  if (phase1 >= PHASE_WRAP) phase1 -= PHASE_WRAP;
  if (phase2 >= PHASE_WRAP) phase2 -= PHASE_WRAP;
  if (phase3 >= PHASE_WRAP) phase3 -= PHASE_WRAP;
  if (phase4 >= PHASE_WRAP) phase4 -= PHASE_WRAP;
  if (phase5 >= PHASE_WRAP) phase5 -= PHASE_WRAP;

  _hsv2rgb1();
  _hsv2rgb2();

  // Solve the five clocks once per frame. render3D only measures distance to
  // these points; expensive trigonometry never repeats for every pixel.
  var amplitude = 0.16 + clamp01(liveArc) * 0.62;
  var couplingAmount = clamp01(liveCoupling);
  var roomBase = phase1 * 0.37 + phase4 * 0.23;
  var angle1 = amplitude * (sin(phase1) * (1.0 - couplingAmount * 0.45)
             + sin(phase2) * couplingAmount * 0.28
             + sin(roomBase) * couplingAmount * 0.17);
  var angle2 = amplitude * (sin(phase2) * (1.0 - couplingAmount * 0.45)
             + sin(phase3 + 0.37) * couplingAmount * 0.28
             + sin(roomBase + PHI) * couplingAmount * 0.17);
  var angle3 = amplitude * (sin(phase3) * (1.0 - couplingAmount * 0.45)
             + sin(phase4 + 0.74) * couplingAmount * 0.28
             + sin(roomBase + PHI * 2.0) * couplingAmount * 0.17);
  var angle4 = amplitude * (sin(phase4) * (1.0 - couplingAmount * 0.45)
             + sin(phase5 + 1.11) * couplingAmount * 0.28
             + sin(roomBase + PHI * 3.0) * couplingAmount * 0.17);
  var angle5 = amplitude * (sin(phase5) * (1.0 - couplingAmount * 0.45)
             + sin(phase1 + 1.48) * couplingAmount * 0.28
             + sin(roomBase + PHI * 4.0) * couplingAmount * 0.17);
  bobX1 = 0.12 + sin(angle1) * 0.275;
  bobY1 = 0.90 - cos(angle1) * 0.275;
  bobX2 = 0.31 + sin(angle2) * 0.307;
  bobY2 = 0.865 - cos(angle2) * 0.307;
  bobX3 = 0.50 + sin(angle3) * 0.339;
  bobY3 = 0.90 - cos(angle3) * 0.339;
  bobX4 = 0.69 + sin(angle4) * 0.275;
  bobY4 = 0.865 - cos(angle4) * 0.275;
  bobX5 = 0.88 + sin(angle5) * 0.307;
  bobY5 = 0.90 - cos(angle5) * 0.307;
  liveHorizontalReach = sin(amplitude) + 0.0001;
}

export function render3D(index, x, y, z) {
  var geomX = clamp01(x);
  var geomY = clamp01(y);
  var isSign = fixtureType == FIX_TE_SIGN;
  var isVintage = fixtureType == FIX_VINTAGE_6;
  var isBar = fixtureType == FIX_BAR_18;

  if (isSign) {
    // Each physical sign is patched as 40 + 34 pixels. Fold the global index
    // onto one complete 74-pixel, row-major 10x8 clock face so the second
    // fixture continues the drawing instead of repeating its first 34 cells.
    var signIndex = index % 74.0;
    geomX = (signIndex % 10.0) / 9.0;
    geomY = floor(signIndex / 10.0) / 7.0;
  }

  var countLevel = 2.0 + clamp01(livePendulumCount) * 3.0;
  var bobRadius = 0.022 + clamp01(liveBobSize) * 0.066;
  var rodWidth = 0.009 + clamp01(liveBobSize) * 0.009;
  // The 10x8 Identity surface is much coarser than the spatial instruments;
  // author a broader miniature clock so its moving bob and rod cross actual
  // sign cells throughout the swing instead of quantizing into a static seal.
  if (isSign) {
    bobRadius = 0.062 + clamp01(liveBobSize) * 0.074;
    rodWidth = 0.020 + clamp01(liveBobSize) * 0.018;
  }
  var bobRadiusSq = bobRadius * bobRadius;
  var bobOuterSq = bobRadiusSq * 5.76;
  var rodWidthSq = rodWidth * rodWidth;
  var rodOuterSq = rodWidthSq * 6.76;
  var jewelryInner = bobRadius * 1.05;
  var jewelryOuter = bobRadius * 2.65;
  var isPar = fixtureType == FIX_PAR;
  var needsArc = fixtureType == FIX_RAW_LED || isSign;
  var jewelryU = 0.0;
  if (isVintage) jewelryU = (pixelLocalIndex + 0.5) / 6.0;

  var strongestBob = 0.0;
  var strongestRod = 0.0;
  var strongestArc = 0.0;
  var strongestPivot = 0.0;
  var weightedColor = 0.0;
  var shapeWeight = 0.0001;
  var vintageBob = 0.0;

  var slot = 0.0;
  var firstSlot = 0.0;
  var finalSlot = countLevel;
  // Silhouette resolves only completed rod/arc assemblies; Jewelry performs
  // the fractional crossfade for the next bob. This avoids spending a full
  // geometric solve on an outline too faint to read at distance.
  if (fixtureType == FIX_RAW_LED) finalSlot = floor(countLevel + 0.50);
  if (finalSlot > 5.0) finalSlot = 5.0;
  // Each TE sign is one miniature clock and the Organs are its shared central
  // pivot. Solving only the middle oscillator for those roles preserves their
  // authored identity while keeping the five-clock geometry on the much more
  // spatially expressive Silhouette and Jewelry instruments.
  if (isSign || isPar) {
    firstSlot = 2.0;
    finalSlot = 3.0;
  }
  // Hull is explicitly the quiet room behind the clock. It renders its
  // architectural field directly below and does not spend four-channel VM
  // budget solving fine pendulum geometry that the broad bars cannot resolve.
  if (!isBar) for (slot = firstSlot; slot < finalSlot; slot = slot + 1.0) {
    // The third through fifth clocks fade in continuously as Count rises.
    var activeWeight = countLevel - slot;
    if (activeWeight > 1.0) activeWeight = 1.0;
    if (isSign || isPar) activeWeight = 1.0;
    if (activeWeight > 0.0) {
      var pivotX = 0.12 + slot * 0.19;
      var pivotY = 0.90;
      var length = 0.275;
      var lengthSq = 0.075625;
      var invLengthSq = 13.22314050;
      var invTwoLength = 1.81818182;
      var bobX = bobX1;
      var bobY = bobY1;
      if (slot == 1.0) {
        pivotY = 0.865;
        length = 0.307;
        lengthSq = 0.094249;
        invLengthSq = 10.61019215;
        invTwoLength = 1.62866450;
        bobX = bobX2; bobY = bobY2;
      } else if (slot == 2.0) {
        length = 0.339;
        lengthSq = 0.114921;
        invLengthSq = 8.70163016;
        invTwoLength = 1.47492625;
        bobX = bobX3; bobY = bobY3;
      }
      else if (slot == 3.0) { bobX = bobX4; bobY = bobY4; }
      else if (slot == 4.0) {
        pivotY = 0.865;
        length = 0.307;
        lengthSq = 0.094249;
        invLengthSq = 10.61019215;
        invTwoLength = 1.62866450;
        bobX = bobX5; bobY = bobY5;
      }
      if (slot == 3.0) pivotY = 0.865;

      // Fixture-specific staging also keeps per-pixel work tight: Vintage
      // needs only its 1D bob position, pars need only pivots, and Hull does
      // not pay to solve the Silhouette-only travel arcs.
      if (!isVintage) {
        var bobShape = 0.0;
        var rodShape = 0.0;
        var arcShape = 0.0;
        var pivotDistanceSq = (geomX - pivotX) * (geomX - pivotX)
                            + (geomY - pivotY) * (geomY - pivotY);
        var pivotShape = 1.0 - smoothstep(0.000324, 0.002500,
                                          pivotDistanceSq);

        if (!isPar) {
          var rodX = bobX - pivotX;
          var rodY = bobY - pivotY;
          var alongRod = ((geomX - pivotX) * rodX
                        + (geomY - pivotY) * rodY) * invLengthSq;
          alongRod = clamp01(alongRod);
          var nearestX = pivotX + alongRod * rodX;
          var nearestY = pivotY + alongRod * rodY;
          var rodDistanceSq = (geomX - nearestX) * (geomX - nearestX)
                            + (geomY - nearestY) * (geomY - nearestY);
          rodShape = 1.0 - smoothstep(rodWidthSq,
                                      rodOuterSq,
                                      rodDistanceSq);

          // Jewelry owns the five moving bobs. Only the miniature Identity
          // clock needs a 2D bob solve; Silhouette spends its budget on the
          // much more legible rods and full travel arcs.
          if (isSign) {
            var bobDistanceSq = (geomX - bobX) * (geomX - bobX)
                              + (geomY - bobY) * (geomY - bobY);
            bobShape = 1.0 - smoothstep(bobRadiusSq,
                                        bobOuterSq,
                                        bobDistanceSq);
          }
        }

        if (needsArc) {
          // Finite lower arc, clipped to this clock's maximum reach. Near the
          // circumference |d²-L²|/(2L) is radial distance, avoiding sqrt.
          var radialDistance = abs(pivotDistanceSq - lengthSq)
                             * invTwoLength;
          arcShape = 1.0 - smoothstep(0.009, 0.027, radialDistance);
          var horizontalReach = length * liveHorizontalReach + 0.035;
          var insideReach = 1.0 - smoothstep(horizontalReach,
                                             horizontalReach + 0.045,
                                             abs(geomX - pivotX));
          if (geomY > pivotY + 0.015) insideReach = 0.0;
          arcShape *= insideReach;
        }

        bobShape *= activeWeight;
        rodShape *= activeWeight;
        arcShape *= activeWeight;
        pivotShape *= activeWeight;
        strongestBob = max(strongestBob, bobShape);
        strongestRod = max(strongestRod, rodShape);
        strongestArc = max(strongestArc, arcShape);
        strongestPivot = max(strongestPivot, pivotShape);

        var featureWeight = bobShape + rodShape * 0.44 + arcShape * 0.24
                          + pivotShape * 0.32;
        weightedColor += (0.10 + slot * 0.20) * featureWeight;
        shapeWeight += featureWeight;
      }

      if (isVintage) {
        var jewelryDistance = abs(jewelryU - bobX);
        var jewelryShape = 1.0 - smoothstep(jewelryInner,
                                            jewelryOuter,
                                            jewelryDistance);
        vintageBob = max(vintageBob, jewelryShape * activeWeight);
      }
    }
  }

  var paletteMix = clamp01(weightedColor / shapeWeight);
  var floorLevel = 0.055 + clamp01(liveSafetyFloor) * 0.245;
  var brightness = floorLevel;
  var outW = 0.0;
  // The clock room has one broad travelling pool of light behind its finite
  // pendulums. It is deliberately simpler than the clockwork foreground, so
  // the gesture reads from afar while two oblique waves reward close viewing.
  var roomCenter = 0.50 + 0.43 * sin(phase1 * 0.61);
  var roomTravel = 1.0 - smoothstep(0.14, 0.53,
                                   abs(geomX - roomCenter));
  var roomField = wave(geomX * 0.67 + geomY * 0.31 + phase3 * 0.11)
                * wave(geomY * 0.53 - geomX * 0.29 - phase4 * 0.09);

  if (isBar) {
    // A quiet paneled room: spatially structured enough to read up close, but
    // subordinate to the finite clock geometry drawn over it.
    var wallPanel = 0.5 + 0.5 * cos((geomX * 4.0 + z * 1.25) * PI2);
    var roomDepth = 0.5 + 0.5 * cos((geomY * 1.35 - z * 0.72) * PI2
                                  + phase1 * 0.08);
    var room = 0.08 + wallPanel * roomDepth * 0.16
             + roomTravel * (0.10 + roomField * 0.15);
    brightness = clamp01(floorLevel + room);
    paletteMix = clamp01(paletteMix * 0.70 + roomDepth * 0.18);
  } else if (fixtureType == FIX_RAW_LED) {
    // The rope outline is the far-field mechanical drawing. Keep its resting
    // bed quiet, then give complete arcs and rods enough contrast to remain
    // legible from outside the room rather than dissolving into blue dots.
    brightness = clamp01(floorLevel * 0.62 + 0.045
                       + strongestArc * 0.62 + strongestRod * 0.86
                       + strongestBob * 0.92);
    paletteMix = clamp01(paletteMix + strongestArc * 0.15
                       + strongestRod * 0.08);
  } else if (isVintage) {
    brightness = clamp01(floorLevel * 0.70 + 0.08
                       + vintageBob * 0.76 + strongestRod * 0.08);
    paletteMix = clamp01(0.68 + vintageBob * 0.26);
    outW = clamp01(vintageBob * clamp01(liveJewelryBob));
  } else if (fixtureType == FIX_PAR) {
    brightness = clamp01(floorLevel + 0.15
                       + strongestPivot * 0.64 + strongestRod * 0.12);
    paletteMix = clamp01(0.26 + strongestPivot * 0.52);
  } else if (isSign) {
    // A firm base preserves letter readability; identical fixture-local
    // geometry makes the two signs a balanced pair of miniature clock rooms.
    brightness = clamp01(max(0.34, floorLevel + 0.15
                       + strongestArc * 0.32 + strongestRod * 0.52
                       + strongestBob * 0.72 + strongestPivot * 0.30
                       + roomTravel * (0.18 + roomField * 0.25)));
    paletteMix = clamp01(paletteMix * 0.72 + geomY * 0.10
                       + roomField * 0.18 + roomTravel * 0.12);
  }

  if (!isSign && !isBar) {
    brightness += roomTravel * (0.055 + roomField * 0.085);
    paletteMix += roomField * 0.10 + roomTravel * 0.06;
  }

  brightness = clamp01(brightness);
  paletteMix = clamp01(paletteMix);
  var outR = (pr1 + (pr2 - pr1) * paletteMix) * brightness;
  var outG = (pg1 + (pg2 - pg1) * paletteMix) * brightness;
  var outB = (pb1 + (pb2 - pb1) * paletteMix) * brightness;
  rgbwau(clamp01(outR), clamp01(outG), clamp01(outB), outW, outW, 0.0);
}
