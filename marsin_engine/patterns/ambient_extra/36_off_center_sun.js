// DRAFT — pending operator review
/*
  36_off_center_sun.js — OFF-CENTER SUN

  CONCEPT
    One immense filled sun hangs deliberately away from the ship's center.
    Its soft asymmetric corona breathes and its center wanders gently, but the
    mass never becomes an eclipse, annulus, orbit, or generic whole-rig wash.

  INSTRUMENT STAGING
    FIX_BAR_18     — the Hull carries the broad filled solar body and shadow.
    FIX_RAW_LED    — the Silhouette splits across the sun's palette-lit rim.
    FIX_VINTAGE_6  — sparse palette-RGB corona points; no native white.
    FIX_PAR        — the dense solar core, held as large luminous pools.
    FIX_TE_SIGN    — paired miniature off-center sunspot windows.

  MOTION / MATH
    A compact smoothstep field makes one continuously filled mass. A second
    broader positive-only falloff makes the corona, so no radial dark annulus can
    form. The center follows three irrational rates offset by the golden angle
    while a fixed signed displacement keeps it visibly off-center.

  CONTROLS (declaration order = physical MIDI order)
    localSpeed  — cadence of the gentle golden-angle center drift.
    sunSize     — radius of the one filled solar mass.
    offset      — distance of the sun from the ship's center.
    corona      — reach and prominence of the asymmetric outer glow.
    shadowDepth — contrast between the sun and the surrounding field.
    level       — prominence of the whole solar composition above its floor.
    safetyFloor — minimum whole-ship visibility outside the sun.

  AUDIO_MODULATION_V1:
    sliderLevel  <- micLow  range 0.35..0.72 curve linear # lows lift the filled solar mass
    sliderCorona <- micFlux range 0.12..0.42 curve ease   # flux opens the asymmetric corona
  Static (unmapped) params: localSpeed, sunSize, offset, shadowDepth,
    safetyFloor, colorPalette1/2.

  COLOR / OUTPUT
    RGB remains strictly on the selected cp1-to-cp2 line. This pattern emits
    no native white and no UV: W=A=U=0 exactly. A protected palette-derived
    floor keeps the complete vessel visible in silence.
*/

export var localSpeed = 0.30;
export var sunSize = 0.58;
export var offset = 0.58;
export var corona = 0.24;
export var shadowDepth = 0.54;
export var level = 0.55;
export var safetyFloor = 0.29;

export var cp1H = 0.61, cp1S = 0.78, cp1V = 0.88;
export var cp2H = 0.095, cp2S = 0.72, cp2V = 1.00;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderSunSize(v) { sunSize = v; }
export function sliderOffset(v) { offset = v; }
export function sliderCorona(v) { corona = v; }
export function sliderShadowDepth(v) { shadowDepth = v; }
export function sliderLevel(v) { level = v; }
export function sliderSafetyFloor(v) { safetyFloor = v; }

var PHASE_WRAP = 10000.0;
var PHI = 1.61803399;
var SQRT2 = 1.41421356;
var SQRT3 = 1.73205081;
var GOLDEN_ANGLE = 2.39996323;

var driftClock = 0.137;
var sunCenterX = 0.22;
var sunCenterY = 0.57;
var sunCenterZ = 0.50;

var liveSunSize = 0.58;
var liveOffset = 0.58;
var liveCorona = 0.24;
var liveShadowDepth = 0.54;
var liveLevel = 0.55;
var liveSafetyFloor = 0.29;

var pr1 = 1.0, pg1 = 0.0, pb1 = 0.0;
var pr2 = 0.0, pg2 = 0.0, pb2 = 1.0;

function clamp01(v) {
  if (v < 0.0) return 0.0;
  if (v > 1.0) return 1.0;
  return v;
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

  // Every live edit converges into the current composition without moving a
  // hard boundary or teleporting the mass across the vessel.
  var geometryFollow = min(1.0, dt * 4.5);
  var lightFollow = min(1.0, dt * 11.0);
  liveSunSize += (sunSize - liveSunSize) * geometryFollow;
  liveOffset += (offset - liveOffset) * geometryFollow;
  liveCorona += (corona - liveCorona) * lightFollow;
  liveShadowDepth += (shadowDepth - liveShadowDepth) * lightFollow;
  liveLevel += (level - liveLevel) * lightFollow;
  liveSafetyFloor += (safetyFloor - liveSafetyFloor) * lightFollow;

  var localMultiplier = 0.25 + clamp01(localSpeed)
    * (32.824 - 16.412 * clamp01(localSpeed));
  driftClock += dt * (0.014 + localMultiplier * 0.052);
  if (driftClock >= PHASE_WRAP) driftClock -= PHASE_WRAP;

  // The displacement never shrinks below 0.23. The smaller irrational drift
  // stays subordinate to it; at the default the solar centroid remains far
  // enough off axis to read immediately across the full physical vessel.
  // Keep the centroid *inside* the physical ship while preserving a large,
  // unmistakable offset.  The earlier range pushed the default center almost
  // beyond x=0, leaving only a dim radial tail on the sparse Titanic model.
  var displacement = 0.145 + clamp01(liveOffset) * 0.300;
  sunCenterX = 0.50 - displacement
             + 0.024 * sin(driftClock * PI2 * PHI + GOLDEN_ANGLE);
  sunCenterY = 0.54
             + 0.105 * sin(driftClock * PI2 * SQRT2 + GOLDEN_ANGLE * 0.5)
             + 0.024 * cos(driftClock * PI2 * SQRT3);
  sunCenterZ = 0.50
             + 0.105 * cos(driftClock * PI2 * SQRT3 + GOLDEN_ANGLE)
             + 0.020 * sin(driftClock * PI2 * PHI);

  _hsv2rgb1();
  _hsv2rgb2();
}

export function render3D(index, x, y, z) {
  var px = clamp01(x);
  var py = clamp01(y);
  var pz = clamp01(z);
  var isSign = fixtureType == FIX_TE_SIGN;
  var centerX = sunCenterX;
  var centerY = sunCenterY;
  var centerZ = sunCenterZ;

  if (isSign) {
    // Each sign spans a 40-pixel fixture plus a 34-pixel fixture. Address the
    // complete 74-pixel surface so the second fixture continues the sunspot.
    var signIndex = index % 74.0;
    px = (signIndex % 10.0) / 9.0;
    py = floor(signIndex / 10.0) / 7.0;
    pz = 0.50;
    centerX = 0.29 + 0.055
            * sin(driftClock * PI2 * PHI + GOLDEN_ANGLE);
    centerY = 0.54 + 0.075
            * sin(driftClock * PI2 * SQRT2 + GOLDEN_ANGLE * 0.5);
    centerZ = 0.50;
  }

  var dx = px - centerX;
  var dy = py - centerY;
  // Compress depth so one huge mass crosses both physical faces instead of
  // reading as separate front and back dots.
  var dz = (pz - centerZ) * 0.56;
  var distanceSquared = dx * dx + dy * dy + dz * dz;
  var distance = sqrt(distanceSquared);

  // This is a monumental body, not a point light.  At the saved default its
  // diameter spans most of one broadside while the opposite side stays cool.
  var radius = 0.205 + clamp01(liveSunSize) * 0.415;
  var core = 1.0 - smoothstep(radius * 0.20,
                              radius * 1.04, distance);
  // Positive monotonic extension of the same filled body. Corona changes
  // reach, never subtracts light, so an annular dark band cannot appear.  The
  // compact falloff avoids two per-pixel exponentials at 40 fps.
  var coronaReach = radius * (1.06 + clamp01(liveCorona) * 0.92);
  var coronaField = 1.0 - smoothstep(radius * 0.68,
                                     coronaReach, distance);
  var coronaTail = max(0.0, coronaField - core * 0.58);

  // Slow uneven photospheric structure exists only as a positive modulation
  // inside the mass. It makes the sun alive without fragmenting its silhouette.
  var solarGrainA = wave(px * 1.71 + py * SQRT2 - pz * 0.63
                       + driftClock * 0.17);
  var solarGrainB = wave(py * PHI - px * 0.83 + pz * SQRT3
                       - driftClock * 0.11);
  var photosphere = 0.82 + 0.18 * solarGrainA * solarGrainB;
  var body = clamp01(core * photosphere);

  var floorLevel = 0.055 + clamp01(liveSafetyFloor) * 0.255;
  var shadowBed = (1.0 - clamp01(liveShadowDepth)) * 0.40;
  var broadField = wave(px * 0.41 + py * 0.57 - pz * 0.29
                      + driftClock * 0.047);
  var background = shadowBed * (0.54 + broadField * 0.46);
  var solarLevel = 0.28 + clamp01(liveLevel) * 0.72;
  var coronaLevel = 0.06 + clamp01(liveCorona) * 0.34;

  var brightness = floorLevel + background
                 + body * solarLevel + coronaTail * coronaLevel;
  // Palette position grows monotonically toward the core. The corona's
  // asymmetry is supplied by its grain, never by introducing a third hue.
  var asymmetry = clamp01(0.52 + dx / (radius + 0.0001) * 0.28
                         - dy / (radius + 0.0001) * 0.16
                         + (wave(driftClock * 0.09) - 0.5) * 0.22);
  var paletteMix = clamp01(0.025 + body * 0.94
                          + coronaTail * (0.04 + asymmetry * 0.14));

  if (fixtureType == FIX_BAR_18) {
    // Hull Canvas is the physical solar body: filled, broad and asymmetric.
    brightness = floorLevel + background * 0.72
               + body * (0.46 + solarLevel * 0.82)
               + coronaTail * coronaLevel * (0.76 + asymmetry * 0.44);
    paletteMix = clamp01(0.02 + body * 0.94
                       + coronaTail * asymmetry * 0.24);
  } else if (fixtureType == FIX_RAW_LED) {
    // Silhouette uses a palette split across the filled edge: the near side
    // carries the hot endpoint while the far side retains the cool outline.
    var nearSide = clamp01(0.5 + (centerX - px) * 1.20
                          + (centerY - py) * 0.32);
    brightness = floorLevel + 0.075 + background * 0.28
               + body * (0.42 + solarLevel * 0.86)
               + coronaTail * coronaLevel * (1.10 + asymmetry * 0.42);
    paletteMix = clamp01(0.03 + body * 0.82
                       + nearSide * (0.10 + body * 0.12));
  } else if (fixtureType == FIX_VINTAGE_6) {
    // Jewelry holds deterministic palette-RGB corona sparks. There is no
    // native-white shortcut: every point remains on the selected color line.
    var pointPhase = wave(index * 0.61803399
                         + pixelLocalIndex * GOLDEN_ANGLE / PI2
                         + driftClock * (0.31 + pixelLocalIndex * 0.013));
    var coronaPoint = pow(pointPhase, 9.0)
                   * clamp01(coronaField * 1.35 - core * 0.22);
    brightness = floorLevel * 0.78 + 0.055 + background * 0.28
               + body * solarLevel * 0.46
               + coronaTail * coronaLevel * 0.54
               + coronaPoint * (0.28 + liveCorona * 0.62);
    paletteMix = clamp01(0.18 + body * 0.64
                       + coronaPoint * 0.18);
  } else if (fixtureType == FIX_PAR) {
    // Organs carry dense, large luminous pools from the same single core.
    var organHeat = pow(core, 0.62);
    brightness = floorLevel + 0.08 + background * 0.22
               + organHeat * (0.48 + solarLevel * 0.80)
               + coronaTail * coronaLevel * 0.36;
    paletteMix = clamp01(0.08 + organHeat * 0.88
                       + asymmetry * 0.08);
  } else if (isSign) {
    // Both TE surfaces receive a complete filled sunspot window, with enough
    // protected light to preserve identity outside the miniature solar body.
    var solarSheen = wave(px * 0.67 + py * 0.37 - driftClock * 0.79);
    brightness = max(0.31, floorLevel + 0.16 + background * 0.25
                   + body * (0.34 + solarLevel * 0.66)
                   + coronaTail * coronaLevel * (0.72 + asymmetry * 0.34)
                   + solarSheen * 0.13);
    paletteMix = clamp01(0.10 + body * 0.78
                       + coronaTail * asymmetry * 0.18
                       + solarSheen * 0.10);
  }

  // Level is the final expressive envelope over every authored ray, while
  // Safety Floor remains independent and can never be pulled toward black.
  brightness = floorLevel + (brightness - floorLevel)
             * (0.30 + clamp01(liveLevel) * 0.92);
  // Restore a true high-luminance photosphere after the ambient envelope.
  // This keeps the off-center mass visibly "sun" instead of a dim fog patch.
  brightness += body * (0.055 + clamp01(liveLevel) * 0.32);
  brightness = clamp01(brightness);
  paletteMix = clamp01(paletteMix);
  var outR = (pr1 + (pr2 - pr1) * paletteMix) * brightness;
  var outG = (pg1 + (pg2 - pg1) * paletteMix) * brightness;
  var outB = (pb1 + (pb2 - pb1) * paletteMix) * brightness;
  rgbwau(clamp01(outR), clamp01(outG), clamp01(outB), 0.0, 0.0, 0.0);
}
