// DRAFT — pending operator review
/*
  07_keel_glow.js — KEEL GLOW

  A continuous low luminous keel carries the ship from bow to stern. A single
  broad, slow intensity window travels along its shallow parabolic line while
  sparse structural lifts reveal ribs, stacks, rail jewelry, and the paired TE
  signs. This is an underbody drawing, not another horizon or repeated field.

  Bars hold the broad under-hull glow. Strands sharpen the keel and curl it into
  finite bow/stern hooks. Vintage heads become sparse palette-RGB rivets (this
  pattern authors no native white). Pars are restrained structural lifts. Each
  TE sign receives the same calm fixture-local keel reflection, with a firm
  legibility floor and a window that traverses the full two-dimensional face.

  The core math is signed distance to y = low + curvature * (2x-1)^2. Motion is
  delta-accumulated: an eased center glides end-to-end, while an irrationally
  related relief clock gently changes the window without a short re-lock.

  AUDIO_MODULATION_V1:
    sliderLift        <- micLow  range 0.20..0.55 curve ease   # low end raises the structural lift
    sliderTraceLength <- micFlux range 0.45..0.78 curve linear # flux broadens the traveling keel trace
  # STATIC: localSpeed, keelWidth, organGlow, level, safetyFloor,
  #         colorPalette1/2
*/

// Declaration order is the physical MIDI order. No direction control: the
// window eases back and forth, and reversal is not an operator-facing idea.
export var localSpeed = 0.30;
export var keelWidth = 0.38;
export var lift = 0.34;
export var traceLength = 0.54;
export var organGlow = 0.38;
export var level = 0.62;
export var safetyFloor = 0.32;

export var cp1H = 0.565, cp1S = 0.86, cp1V = 0.88;
export var cp2H = 0.105, cp2S = 0.76, cp2V = 1.00;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderKeelWidth(v) { keelWidth = v; }
export function sliderLift(v) { lift = v; }
export function sliderTraceLength(v) { traceLength = v; }
export function sliderOrganGlow(v) { organGlow = v; }
export function sliderLevel(v) { level = v; }
export function sliderSafetyFloor(v) { safetyFloor = v; }

var PHASE_WRAP = 10000.0;
var GOLDEN_ANGLE = 2.3999632297;
var transitPhase = 0.08;
var reliefPhase = 0.31;

var liveKeelWidth = 0.38;
var liveLift = 0.34;
var liveTraceLength = 0.54;
var liveOrganGlow = 0.38;
var organEnergy = 0.055;
var liveLevel = 0.62;
var liveSafetyFloor = 0.32;

var windowCenter = 0.50;
var reliefShift = 0.0;
var pr1 = 1.0, pg1 = 0.0, pb1 = 0.0;
var pr2 = 1.0, pg2 = 0.55, pb2 = 0.0;

function clamp01(v) {
  if (v < 0.0) return 0.0;
  if (v > 1.0) return 1.0;
  return v;
}

function smooth01(v) {
  v = clamp01(v);
  return v * v * (3.0 - 2.0 * v);
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

  // All live controls slew; changing geometry never teleports the keel.
  var geometryFollow = clamp01(dt * 4.5);
  var lightFollow = clamp01(dt * 8.0);
  liveKeelWidth += (clamp01(keelWidth) - liveKeelWidth) * geometryFollow;
  liveLift += (clamp01(lift) - liveLift) * lightFollow;
  liveTraceLength += (clamp01(traceLength) - liveTraceLength)
                   * geometryFollow;
  liveOrganGlow += (clamp01(organGlow) - liveOrganGlow) * lightFollow;
  // Cubic staging keeps the saved Organ punctuation subordinate while still
  // giving the full control range a decisive, truthful structural response.
  organEnergy = liveOrganGlow * liveOrganGlow * liveOrganGlow;
  liveLevel += (clamp01(level) - liveLevel) * lightFollow;
  liveSafetyFloor += (clamp01(safetyFloor) - liveSafetyFloor)
                   * lightFollow;

  var localMultiplier = 0.25 + clamp01(localSpeed)
    * (32.824 - 16.412 * clamp01(localSpeed));
  // The saved tune completes a legible bow-to-stern-to-bow gesture inside a
  // long review clip while retaining a calm, eased reversal at each end.
  transitPhase += dt * 0.043 * localMultiplier;
  reliefPhase += dt * 0.0091 * 1.41421356237 * localMultiplier;
  if (transitPhase >= PHASE_WRAP) transitPhase -= PHASE_WRAP;
  if (reliefPhase >= PHASE_WRAP) reliefPhase -= PHASE_WRAP;

  // A sinusoidal center gives smooth, readable end reversals with no wrap jump.
  windowCenter = 0.50 + sin(transitPhase * PI2) * 0.47;
  reliefShift = (wave(reliefPhase) - 0.5) * 0.055;
  _hsv2rgb1();
  _hsv2rgb2();
}

export function render3D(index, x, y, z) {
  var nx = clamp01(x);
  var ny = clamp01(y);
  var nz = clamp01(z);

  // Shallow parabolic underbody: low amidships, lifting at bow and stern.
  var centeredX = nx * 2.0 - 1.0;
  var keelHeight = 0.105 + centeredX * centeredX * 0.185;
  var width = 0.035 + liveKeelWidth * 0.155;
  var keelDistance = abs(ny - keelHeight);
  var keelCore = smooth01(1.0 - keelDistance / width);
  var keelHalo = smooth01(1.0 - keelDistance / (width * 2.65));

  // One broad low-frequency window travels over the fixed keel. Trace Length
  // changes its longitudinal reach, not the width of the keel geometry.
  var traceRadius = 0.11 + liveTraceLength * 0.43;
  var longitudinalDistance = abs(nx - windowCenter);
  var traceWindow = smooth01(1.0 - longitudinalDistance / traceRadius);
  var traceCore = smooth01(1.0 - longitudinalDistance
                                  / (traceRadius * 0.46));

  // A very sparse cross-section relief lifts structure without becoming a
  // second repeated field. The partial spatial turns never tile the model.
  var sectionRelief = wave(nz * 0.43 + ny * 0.19 + reliefPhase
                          + nx * 0.11);
  sectionRelief = 0.32 + sectionRelief * 0.68;
  // A broad palette-material wake makes the keel's longitudinal travel read
  // across the whole vessel at playa distance. Two low-frequency fields add
  // close-range grain, while the single moving window remains the hero shape.
  var hullField = wave(nx * 0.61 + ny * 0.29 - reliefPhase * 0.71)
                * wave(nz * 0.47 - nx * 0.23 + reliefPhase * 1.41421356);
  var hullWake = smooth01(1.0 - longitudinalDistance
                                / (traceRadius * 1.65));
  var liftedKeel = keelCore * (0.26 + traceWindow * 0.74);
  var liftEnergy = liveLift * traceWindow
                 * (0.28 + keelHalo * 0.52 + sectionRelief * 0.20);
  var floorV = 0.030 + liveSafetyFloor * 0.105;
  var authored = keelHalo * 0.22 + liftedKeel * 0.72
               + traceCore * keelCore * 0.26 + liftEnergy * 0.30
               + hullWake * (0.14 + hullField * 0.18);
  var colorMix = clamp01(0.10 + keelCore * 0.28
                        + traceWindow * 0.38 + traceCore * 0.16
                        + sectionRelief * 0.08);

  if (fixtureType == FIX_BAR_18) {
    // Broad under-hull canvas: nearly all authority is on the fixed curve.
    authored = keelHalo * 0.16 + liftedKeel * 1.02
             + traceCore * keelCore * 0.64 + liftEnergy * 0.22;
  } else if (fixtureType == FIX_RAW_LED) {
    // Continuous sharp keel plus finite hooks rising at both extremities.
    var endReach = smooth01((abs(centeredX) - 0.60) / 0.34);
    var hookHeight = keelHeight + endReach * 0.28;
    var hookDistance = abs(ny - hookHeight);
    var hook = smooth01(1.0 - hookDistance / (width * 0.72)) * endReach;
    authored = 0.025 + keelCore * 0.92 + hook * 1.04
             + traceWindow * max(keelCore, hook) * 0.72;
    colorMix = clamp01(0.08 + keelCore * 0.22 + hook * 0.18
                      + traceWindow * 0.46);
  } else if (fixtureType == FIX_VINTAGE_6) {
    // Small palette-RGB rivets; no native white is used by this composition.
    var rivetSeed = 0.5 + 0.5 * sin(index * GOLDEN_ANGLE
                                  + reliefPhase * PI2);
    var rivet = pow(rivetSeed, 8.0)
              * (0.28 + traceWindow * 0.72);
    authored = 0.035 + rivet * (0.30 + liveLift * 0.52)
             + keelHalo * 0.07;
    colorMix = clamp01(0.26 + rivet * 0.56 + traceWindow * 0.10);
  } else if (fixtureType == FIX_PAR) {
    // Organs reveal the structure above the keel rather than imitating it.
    var verticalLift = smooth01((ny - keelHeight) / 0.55);
    var upperStructure = smooth01((ny - 0.27) / 0.60);
    var ribSeed = 0.5 + 0.5 * cos((nz * 0.77 + nx * 0.23
                                 + reliefPhase * 0.31) * PI2);
    var ribGate = pow(ribSeed, 7.0);
    var organBody = organEnergy
                  * (0.34 + traceWindow * 0.82 + sectionRelief * 0.42);
    authored = 0.025 + organBody * (1.50 + verticalLift * 1.30)
             + liftEnergy * 0.34
             + ribGate * upperStructure * organEnergy * 0.78;
    colorMix = clamp01(0.42 + organEnergy * 0.44
                      + traceWindow * 0.10 + verticalLift * 0.06);
  } else if (fixtureType == FIX_TE_SIGN) {
    // Paired fixture-local low-line reflections. pixelLocalIndex repeats for
    // the two 74-pixel faces, guaranteeing identical topology and brightness.
    var signIndex = index % 74.0;
    var signX = (signIndex % 10.0) / 9.0;
    var signY = floor(signIndex / 10.0) / 7.0;
    var signCenteredX = signX * 2.0 - 1.0;
    var signKeelHeight = 0.18 + signCenteredX * signCenteredX * 0.17;
    var signLine = smooth01(1.0 - abs(signY - signKeelHeight)
                                  / (0.075 + liveKeelWidth * 0.10));
    var signTraceDistance = abs(signX - windowCenter);
    var signTrace = smooth01(1.0 - signTraceDistance / traceRadius);
    var signRelief = wave(signY * 0.37 + signX * 0.29
                         + reliefPhase + reliefShift);
    var signField = wave(signX * 0.73 + signY * 0.41
                        - reliefPhase * 0.71)
                  * wave(signY * 0.59 - signX * 0.31
                        + reliefPhase * 1.41421356);
    var signWake = smooth01(1.0 - signTraceDistance
                                  / (traceRadius * 1.65));
    authored = 0.18 + signLine * 0.42 + signTrace * signLine * 0.40
             + signRelief * 0.045 + liveLift * signTrace * 0.10
             + signWake * (0.18 + signField * 0.28);
    colorMix = clamp01(0.16 + signLine * 0.24 + signTrace * 0.46
                      + signRelief * 0.08 + signField * 0.14);
    floorV = max(floorV, 0.14);
  }

  // Lift is the whole structural response above the persistent keel. Its wide
  // energy travel is intentional: micLow can visibly raise the ship without
  // erasing the autonomous silence composition or changing its geometry.
  if (fixtureType != FIX_TE_SIGN) {
    authored += liveLift * traceWindow
              * (keelHalo * 1.08 + keelCore * 0.88);
    // Both brightness handles remain measurable without restoring the
    // rejected upper wash: Lift raises only the lower underbody, while Organ
    // Glow leaks a sparse palette reflection into keel material beneath pars.
    var lowerBody = smooth01((0.56 - ny) / 0.42);
    authored += liveLift * lowerBody * (0.090 + keelHalo * 0.17);
    authored += organEnergy * keelHalo
              * (0.14 + sectionRelief * 0.40);
  }

  var levelGain = 0.08 + liveLevel * 1.20;
  var brightness = floorV
                 + (1.0 - floorV) * levelGain * clamp01(authored);
  brightness = clamp01(brightness);
  var red = (pr1 + (pr2 - pr1) * colorMix) * brightness;
  var green = (pg1 + (pg2 - pg1) * colorMix) * brightness;
  var blue = (pb1 + (pb2 - pb1) * colorMix) * brightness;

  // Palette RGB only: native white, amber, and UV are exactly zero.
  rgbwau(clamp01(red), clamp01(green), clamp01(blue), 0.0, 0.0, 0.0);
}
