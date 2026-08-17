// DRAFT — pending operator review
/*
  02_brass_compass.js — "Brass Compass"

  One immense compass rose holds the vessel with a north-locked slender
  needle. The topology is fixed: a filled XZ dial, four finite cardinal rays,
  and sixteen circular ticks. The needle makes only a small signed correction
  around north; it never scans the dial. Unlike 23_needle_gauge, this is a
  navigational emblem with a stable reference frame, not a moving pointer.

  INSTRUMENT STAGING
    - Bars carry the broad rose face, finite cardinal rays, ticks, and needle.
    - RAW strands hold the outer cardinal ring as the far-field outline.
    - Vintage heads are restrained, palette-derived tick jewelry with matched
      native W/A.
    - PARs are four fixed cardinal poles, never accents following the needle.
    - Both TE signs receive the same fixture-local, two-dimensional compass
      dial. Matching A/B puck indices make the physical sign pair byte-balanced
      while a deliberate floor preserves the lettering.

  MOTION AND CONTROLS
    localSpeed  — precession rate; 0 still creeps and 1 is clearly faster.
    direction   — genuine signed angular velocity; endpoints reverse and the
                  guarded center never freezes.
    dialRadius  — dial reach, mapped 0.20..0.46 (130% endpoint change).
    needleWidth — width of the single finite needle.
    tickGlow    — brightness of the sixteen engraved ticks.
    level       — rose energy above the guaranteed floor.
    safetyFloor — whole-rig visibility floor, mapped 0.055..0.155.

  All RGB lies strictly on the cp1<->cp2 line. Native white is reserved for
  Jewelry tick engraving and is always emitted with W == A. There is no UV.

  AUDIO_MODULATION_V1:
    sliderLevel    <- micLow  range 0.35..0.72 curve linear # rose face energy
    sliderTickGlow <- micHigh range 0.08..0.42 curve ease   # engraved tick light
  # STATIC: localSpeed, direction, dialRadius, needleWidth, safetyFloor,
  #         colorPalette1/2
*/

// Global palette pickers precede local controls.
export var cp1H = 0.105, cp1S = 0.72, cp1V = 1.0;
export var cp2H = 0.555, cp2S = 0.78, cp2V = 0.72;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

// Declaration order is the physical MIDI order.
export var localSpeed = 0.30;
export var direction = 0.75;
export var dialRadius = 0.60;
export var needleWidth = 0.28;
export var tickGlow = 0.30;
export var level = 0.58;
export var safetyFloor = 0.25;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderDirection(v) {
  direction = v;
  var dv = v * 2.0 - 1.0;
  if (dv >= 0.0 && dv < 0.06) dv = 0.06;
  else if (dv < 0.0 && dv > -0.06) dv = -0.06;
  correctionHeading = dv;
}
export function sliderDialRadius(v) { dialRadius = v; }
export function sliderNeedleWidth(v) { needleWidth = v; }
export function sliderTickGlow(v) { tickGlow = v; }
export function sliderLevel(v) { level = v; }
export function sliderSafetyFloor(v) { safetyFloor = v; }

var PHASE_WRAP = 10000.0;
var GOLDEN_ANGLE = 2.3999632297;

// The needle never scans: it remains within a small correction arc around
// north. Signed phase travel keeps Direction truthful without borrowing the
// full-dial pointer grammar owned by Needle Gauge.
var correctionPhase = 0.08;
var correctionHeading = 0.5;
var needleCos = 1.0;
var needleSin = 0.0;
var sweepCenterX = -0.18;

var liveRadius = 0.356;
var liveNeedleWidth = 0.023;
var liveTickGlow = 0.30;
var liveLevel = 0.58;
var liveFloor = 0.08;

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
  var iv = floor(hv * 6.0) % 6;
  var fv = hv * 6.0 - floor(hv * 6.0);
  var pv = cp1V * (1.0 - cp1S);
  var qv = cp1V * (1.0 - fv * cp1S);
  var tv = cp1V * (1.0 - (1.0 - fv) * cp1S);
  if      (iv == 0) { pr1 = cp1V; pg1 = tv;   pb1 = pv;   }
  else if (iv == 1) { pr1 = qv;   pg1 = cp1V; pb1 = pv;   }
  else if (iv == 2) { pr1 = pv;   pg1 = cp1V; pb1 = tv;   }
  else if (iv == 3) { pr1 = pv;   pg1 = qv;   pb1 = cp1V; }
  else if (iv == 4) { pr1 = tv;   pg1 = pv;   pb1 = cp1V; }
  else              { pr1 = cp1V; pg1 = pv;   pb1 = qv;   }
}

function _hsv2rgb2() {
  var hv = cp2H - floor(cp2H); if (hv < 0.0) hv += 1.0;
  var iv = floor(hv * 6.0) % 6;
  var fv = hv * 6.0 - floor(hv * 6.0);
  var pv = cp2V * (1.0 - cp2S);
  var qv = cp2V * (1.0 - fv * cp2S);
  var tv = cp2V * (1.0 - (1.0 - fv) * cp2S);
  if      (iv == 0) { pr2 = cp2V; pg2 = tv;   pb2 = pv;   }
  else if (iv == 1) { pr2 = qv;   pg2 = cp2V; pb2 = pv;   }
  else if (iv == 2) { pr2 = pv;   pg2 = cp2V; pb2 = tv;   }
  else if (iv == 3) { pr2 = pv;   pg2 = qv;   pb2 = cp2V; }
  else if (iv == 4) { pr2 = tv;   pg2 = pv;   pb2 = qv;   }
  else              { pr2 = cp2V; pg2 = pv;   pb2 = qv;   }
}

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  _hsv2rgb1();
  _hsv2rgb2();

  // Geometry and light controls follow live edits without snapping the dial.
  var geometryFollow = clamp01(dt * 7.0);
  var lightFollow = clamp01(dt * 12.0);
  var targetRadius = 0.20 + clamp01(dialRadius) * 0.26;
  var widthControl = clamp01(needleWidth);
  // The square keeps the shipped needle slender while the upper half of the
  // control can broaden it decisively enough for sparse physical coordinates.
  var targetWidth = 0.012 + widthControl * widthControl * 0.288;
  liveRadius = liveRadius + (targetRadius - liveRadius) * geometryFollow;
  liveNeedleWidth = liveNeedleWidth
                  + (targetWidth - liveNeedleWidth) * geometryFollow;
  liveTickGlow = liveTickGlow
               + (clamp01(tickGlow) - liveTickGlow) * lightFollow;
  liveLevel = liveLevel + (clamp01(level) - liveLevel) * lightFollow;
  var targetFloor = 0.055 + clamp01(safetyFloor) * 0.100;
  liveFloor = liveFloor + (targetFloor - liveFloor) * lightFollow;

  // A signed correction phase moves the needle only within 7.5 degrees of
  // north. Reversing Direction reverses that small correction trajectory;
  // the fixed rose, ticks, and cardinal poles never rotate.
  var localMult = 0.25 + clamp01(localSpeed)
    * (32.824 - 16.412 * clamp01(localSpeed));
  var rate = 0.026 + localMult * 0.095;
  correctionPhase = correctionPhase + dt * rate * correctionHeading;
  if (correctionPhase >= PHASE_WRAP) correctionPhase -= PHASE_WRAP;
  if (correctionPhase < 0.0) correctionPhase += PHASE_WRAP;
  var needleAngle = PI * 0.5 + sin(correctionPhase * PI2) * 0.131;
  needleCos = cos(needleAngle);
  needleSin = sin(needleAngle);
  // The compass keeps its fine dial work, but one broad meridian now crosses
  // the whole vessel so its motion reads clearly from playa distance.
  sweepCenterX = -0.18 + 1.36 * (correctionPhase - floor(correctionPhase));
}

export function render3D(index, x, y, z) {
  // Identity has its own fixture-local dial. Emit it before evaluating the
  // world dial so 148 sign pixels do not pay for two complete SDFs per frame.
  // rgbwau terminates this pixel's render, as all color builtins do.
  if (fixtureType == FIX_TE_SIGN) {
    var signIndex = index % 74.0;
    var signX = (signIndex % 10.0) / 9.0 - 0.50;
    var signY = floor(signIndex / 10.0) / 7.0 - 0.50;
    var signRadius = hypot(signX, signY);
    var signAngle = atan2(signY, signX);
    var signDialRadius = 0.22 + clamp01(dialRadius) * 0.23;
    var signFace = smooth01((signDialRadius - signRadius) / 0.095);
    var signRing = smooth01(1.0
                          - abs(signRadius - signDialRadius) / 0.075);
    var signAxes = max(smooth01(1.0 - abs(signX) / 0.095),
                       smooth01(1.0 - abs(signY) / 0.095));
    signAxes *= smooth01((signDialRadius - signRadius) / 0.060);
    var signAlong = signX * needleCos + signY * needleSin;
    var signPerp = abs(-signX * needleSin + signY * needleCos);
    var signNeedle = 0.0;
    var signNeedleHalo = 0.0;
    if (signAlong >= -0.020 && signAlong <= signDialRadius) {
      var signWidthControl = clamp01(needleWidth);
      var signWidth = 0.015
                    + signWidthControl * signWidthControl * 0.220;
      signNeedle = smooth01(1.0 - signPerp / signWidth);
      signNeedleHalo = smooth01(1.0
                               - signPerp / (signWidth * 1.85 + 0.025));
      signNeedle *= smooth01((signDialRadius - signAlong) / 0.065);
      signNeedleHalo *= smooth01((signDialRadius - signAlong) / 0.085);
    }
    var signTick = smooth01(1.0 - abs(sin(signAngle * 8.0)) / 0.30)
                 * signRing;
    var signUnitX = signX + 0.50;
    var signUnitY = signY + 0.50;
    var signFieldA = 0.5 + 0.5
      * sin((signUnitX * 1.618 + signUnitY * 1.414) * PI2
            + correctionPhase * PI2 * 2.0);
    var signFieldB = 0.5 + 0.5
      * sin((signUnitX * 2.236 - signUnitY * 1.732) * PI2
            - correctionPhase * PI2);
    var signField = signFieldA * signFieldB;
    var signSweep = smooth01(1.0
      - abs(signUnitX - sweepCenterX) / 0.26);
    var signEnergy = 0.27 + signFace * 0.09 + signAxes * 0.44
                   + signTick * liveTickGlow * 1.80
                   + signNeedleHalo * 0.16 + signNeedle * 0.54
                   + signField * 0.38
                   + signSweep * (0.72 + signField * 0.42);
    var signColorMix = clamp01(0.70 - signAxes * 0.38
                             - signNeedleHalo * 0.12 - signNeedle * 0.40
                             + signTick * 0.12 + signField * 0.16
                             - signSweep * 0.32);
    var signBrightness = liveFloor
                       + (1.0 - liveFloor) * liveLevel * clamp01(signEnergy);
    signBrightness = clamp01(signBrightness
                           + liveTickGlow * 0.075
                           + signTick * liveTickGlow * 0.55);
    signBrightness = max(0.20, signBrightness
      * (0.32 + signField * 0.20 + signSweep * 1.22));
    var signR = (pr1 + (pr2 - pr1) * signColorMix) * signBrightness;
    var signG = (pg1 + (pg2 - pg1) * signColorMix) * signBrightness;
    var signB = (pb1 + (pb2 - pb1) * signColorMix) * signBrightness;
    rgbwau(clamp01(signR), clamp01(signG), clamp01(signB),
           0.0, 0.0, 0.0);
  }

  var dx = x - 0.5;
  var dz = z - 0.5;
  var radial = hypot(dx, dz);
  var angle = atan2(dz, dx);
  var modelX = clamp01(x);
  var modelY = clamp01(y * 0.70 + z * 0.30);
  var fieldA = 0.5 + 0.5
    * sin((modelX * 1.618 + modelY * 1.414) * PI2
          + correctionPhase * PI2 * 2.0);
  var fieldB = 0.5 + 0.5
    * sin((modelX * 2.236 - modelY * 1.732) * PI2
          - correctionPhase * PI2);
  var compassField = fieldA * fieldB;
  var meridianSweep = smooth01(1.0
    - abs(modelX - sweepCenterX) / 0.24);

  // Fixed dial SDF: a filled face, four finite cardinal rays, and a circular
  // mask of sixteen ticks. None of these terms follows the moving needle.
  var face = smooth01((liveRadius - radial) / 0.060);
  var radialLimit = smooth01((liveRadius - radial) / 0.045);
  // Broad fixed rays are the compass's title-free playa-scale discriminator.
  // They remain stationary while only the slender north needle corrects.
  var rayX = smooth01(1.0 - abs(dz) / 0.060) * radialLimit;
  var rayZ = smooth01(1.0 - abs(dx) / 0.060) * radialLimit;
  var cardinalRays = max(rayX, rayZ);
  var cardinalTips = cardinalRays
                   * smooth01((radial - liveRadius * 0.44)
                            / (liveRadius * 0.34));

  var ringDistance = abs(radial - liveRadius);
  var outerRing = smooth01(1.0 - ringDistance / 0.030);
  // A narrow reflection travels around the fixed compass glass with the same
  // signed correction clock as the needle. It makes Direction perceptible at
  // ship scale without turning the north-locked needle into a gauge sweep.
  var rimGlint = smooth01((sin(angle - correctionPhase * PI2) - 0.18) / 0.62)
               * outerRing;
  var tickDistance = abs(sin(angle * 8.0));
  // Ticks are finite radial engravings around the dial rather than an entire
  // luminous shell. The broad radial mask lets the sparse Vintage rails carry
  // real marks while the sixteen narrow angular gates preserve tick topology.
  var tickBand = smooth01(1.0 - ringDistance / 0.160);
  var tickMask = smooth01(1.0 - tickDistance / 0.50) * tickBand;
  var cardinalMask = smooth01((abs(cos(angle * 2.0)) - 0.76) / 0.24);

  // Distance to one finite, center-to-tip segment. It is visibly locked to
  // north and only corrects inside its small signed arc.
  var along = dx * needleCos + dz * needleSin;
  var perpendicular = abs(-dx * needleSin + dz * needleCos);
  var needle = 0.0;
  var needleHalo = 0.0;
  var needleLength = liveRadius * 0.94;
  if (along >= -0.012 && along <= needleLength) {
    needle = smooth01(1.0 - perpendicular / liveNeedleWidth);
    needleHalo = smooth01(1.0
                         - perpendicular / (liveNeedleWidth * 2.25 + 0.025));
    needle *= smooth01((needleLength - along) / 0.040);
    needleHalo *= smooth01((needleLength - along) / 0.065);
  }
  var hub = smooth01(1.0 - radial / (liveNeedleWidth * 1.75 + 0.010));
  needle = max(needle, hub);
  needleHalo = max(needleHalo, hub);

  // The luminous cap belongs to the same north needle. Its small moving
  // centroid makes Direction measurable without becoming a gauge scan.
  var tipX = dx - needleCos * needleLength * 0.88;
  var tipZ = dz - needleSin * needleLength * 0.88;
  var needleTip = smooth01(1.0
                          - hypot(tipX, tipZ) / (liveNeedleWidth + 0.060));

  var energy = face * 0.16;
  var colorMix = 0.74 - face * 0.16;
  var nativeWhite = liveFloor * 0.18;

  if (fixtureType == FIX_BAR_18) {
    // Rose face: broad engraving, four axes, sixteen ticks, and one needle.
    energy = face * 0.14 + cardinalRays * 0.76 + cardinalTips * 0.34
           + tickMask * liveTickGlow * 2.85
           + needleHalo * 0.30 + needle * 1.35 + needleTip * 0.65
           + rimGlint * 0.72;
    colorMix = clamp01(0.82 - cardinalRays * 0.48
                     - tickMask * 0.24 - needleHalo * 0.18
                     - needle * 0.50 - needleTip * 0.28);
    nativeWhite += cardinalRays * 0.035
                 + tickMask * liveTickGlow * 0.220
                 + needleHalo * 0.025 + needle * 0.070;
  } else if (fixtureType == FIX_RAW_LED) {
    // The far-field strand outline is a true outer cardinal ring, not a beam.
    energy = outerRing * (0.32 + cardinalMask * 0.68)
           + cardinalRays * 0.48 + cardinalTips * 0.28
           + tickMask * liveTickGlow * 2.10 + face * 0.04
           + rimGlint * 0.86;
    colorMix = clamp01(0.70 - cardinalMask * 0.38
                     + tickMask * 0.12);
    nativeWhite += outerRing * cardinalMask * 0.028
                 + tickMask * liveTickGlow * 0.110;
  } else if (fixtureType == FIX_VINTAGE_6) {
    // Jewelry stays restrained: fixed ticks, palette RGB, matched native W/A.
    energy = 0.12 + tickMask * (0.10 + liveTickGlow * 2.40)
           + cardinalMask * 0.10 + rimGlint * 0.46;
    colorMix = clamp01(0.30 + tickMask * 0.22);
    nativeWhite += 0.018 + tickMask * liveTickGlow * 0.260;
  } else if (fixtureType == FIX_PAR) {
    // Four fixed structural poles. Needle motion is deliberately absent here.
    energy = 0.18 + cardinalMask * 0.72;
    colorMix = clamp01(0.18 + (1.0 - cardinalMask) * 0.28);
    nativeWhite += 0.035 + cardinalMask * 0.145;
  }

  // Fine interference animates the background material; the simpler bright
  // band is the distant gesture. Both remain strictly palette-derived.
  energy += compassField * 0.34
          + meridianSweep * (0.78 + compassField * 0.42);
  colorMix = clamp01(colorMix + compassField * 0.12
                   - meridianSweep * 0.30);

  // Level scales authored light while the palette-derived and native-white
  // floor remain. This preserves attractive silence and honest micLow travel.
  var brightness = liveFloor
                 + (1.0 - liveFloor) * liveLevel * clamp01(energy);
  if (fixtureType != FIX_PAR) {
    // The engraved marks cast a restrained brass halo across their material.
    // This keeps Tick Glow a plainly visible brightness control even where
    // the sparse physical samples land between individual angular cuts.
    brightness += liveTickGlow * 0.075
                + tickMask * liveTickGlow * 0.65;
  }
  // The brass engraving must remain legible at playa distance; this is a
  // material exposure lift, not a whole-rig white wash.
  brightness = clamp01(brightness * 1.60);
  brightness = max(liveFloor, brightness
    * (0.42 + compassField * 0.18 + meridianSweep * 0.96));
  var outR = (pr1 + (pr2 - pr1) * colorMix) * brightness;
  var outG = (pg1 + (pg2 - pg1) * colorMix) * brightness;
  var outB = (pb1 + (pb2 - pb1) * colorMix) * brightness;
  // Native white is a Jewelry material, never a flat whole-ship wash. The
  // other instruments keep their compass engraving entirely in palette RGB.
  var outW = fixtureType == FIX_VINTAGE_6
           ? clamp01(nativeWhite * (0.55 + liveLevel * 0.45))
           : 0.0;

  rgbwau(clamp01(outR), clamp01(outG), clamp01(outB), outW, outW, 0.0);
}
