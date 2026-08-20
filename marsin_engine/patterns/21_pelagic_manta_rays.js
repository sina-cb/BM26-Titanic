/*
  21_pelagic_manta_rays.js — two anatomically readable manta rays crossing a
  deep pelagic current, one swimming bowward and one sternward.

  IDENTITY
    The Hull Canvas and Silhouette carry two broad, swept-wing manta forms:
    rounded nose, cephalic lobes, spine, attached wing veins, concave trailing
    edge, and a tapering tail. Jewelry catches sparse white foam. Organs hold
    quiet palette-colored current markers. Both TE signs use the same fixture-
    local manta procession, giving them an exact, continuously readable twin.

  MOTION
    Independent forward clocks use irrationally related rates (1 and 1/sqrt2)
    while a third sqrt3-related clock moves the current. All accumulators wrap
    far from their fractional consumers, so live edits and long runs stay
    continuous. Local Speed is the only rate control.

  COLOR
    Every RGB output is a straight RGB-space interpolation between the two
    operator palette endpoints. No authored third tint exists. White Foam uses
    the dedicated W+A lanes, and UV Undertow uses only UV-capable fixtures.

  CONTROL OWNERSHIP (physical MIDI order preserved)
    localSpeed — all manta, current, wing and sign motion rates.
    level      — visible-water and manta luminance.
    kick       — transient body, wake, and foam lift.
    radius     — manta length and wing span, never speed or hardness.
    detail     — attached anatomy and current-filament definition.
    whiteFoam  — sparse Jewelry white strength.
    uvUndertow — violet strength on bars and pars only.

  AUDIO_MODULATION_V1:
    sliderLevel  <- micLow  range 0.28..1.00 curve linear # bass reveals the rays
    sliderKick   <- micKick range 0.00..1.00 curve pow2   # beat foam/ocean punch
    sliderRadius <- micFlux range 0.32..0.92 curve linear # builds widen coherent wings
    sliderDetail <- micHigh range 0.25..0.95 curve linear # highs articulate anatomy
  Static params: localSpeed, whiteFoam, uvUndertow, colorPalette1/2.
*/

// Canonical append-only optional roles. Self-declaration preserves compilation
// on portable models where an absent role simply has no matching pixels.
var FIX_RAW_LED = 1;
var FIX_TE_SIGN = 7;

export var localSpeed = 0.5;
export var level = 0.7;
export var kick = 0.0;
export var radius = 0.5;
export var detail = 0.5;
export var whiteFoam = 0.55;
export var uvUndertow = 0.3;

export var cp1H = 0.55, cp1S = 1.0, cp1V = 1.0;
export var cp2H = 0.44, cp2S = 1.0, cp2V = 1.0;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderLevel(v) { level = v; }
export function sliderKick(v) { kick = v; }
export function sliderRadius(v) { radius = v; }
export function sliderDetail(v) { detail = v; }
export function sliderWhiteFoam(v) { whiteFoam = v; }
export function sliderUvUndertow(v) { uvUndertow = v; }

var pr1 = 1.0, pg1 = 0.0, pb1 = 0.0;
var pr2 = 0.0, pg2 = 0.0, pb2 = 1.0;
function _hsv2rgb1() {
  var hv = cp1H - floor(cp1H); if (hv < 0) hv += 1;
  var iv = floor(hv * 6) % 6;
  var fv = hv * 6 - floor(hv * 6);
  var pv = cp1V * (1 - cp1S);
  var qv = cp1V * (1 - fv * cp1S);
  var tv = cp1V * (1 - (1 - fv) * cp1S);
  if      (iv == 0) { pr1 = cp1V; pg1 = tv;   pb1 = pv;   }
  else if (iv == 1) { pr1 = qv;   pg1 = cp1V; pb1 = pv;   }
  else if (iv == 2) { pr1 = pv;   pg1 = cp1V; pb1 = tv;   }
  else if (iv == 3) { pr1 = pv;   pg1 = qv;   pb1 = cp1V; }
  else if (iv == 4) { pr1 = tv;   pg1 = pv;   pb1 = cp1V; }
  else              { pr1 = cp1V; pg1 = pv;   pb1 = qv;   }
}
function _hsv2rgb2() {
  var hv = cp2H - floor(cp2H); if (hv < 0) hv += 1;
  var iv = floor(hv * 6) % 6;
  var fv = hv * 6 - floor(hv * 6);
  var pv = cp2V * (1 - cp2S);
  var qv = cp2V * (1 - fv * cp2S);
  var tv = cp2V * (1 - (1 - fv) * cp2S);
  if      (iv == 0) { pr2 = cp2V; pg2 = tv;   pb2 = pv;   }
  else if (iv == 1) { pr2 = qv;   pg2 = cp2V; pb2 = pv;   }
  else if (iv == 2) { pr2 = pv;   pg2 = cp2V; pb2 = tv;   }
  else if (iv == 3) { pr2 = pv;   pg2 = qv;   pb2 = cp2V; }
  else if (iv == 4) { pr2 = tv;   pg2 = pv;   pb2 = cp2V; }
  else              { pr2 = cp2V; pg2 = pv;   pb2 = qv;   }
}

function clamp01(v) {
  if (v < 0.0) return 0.0;
  if (v > 1.0) return 1.0;
  return v;
}

function wrappedDelta(v, center) {
  var d = v - center;
  if (d > 0.5) d = d - 1.0;
  if (d < -0.5) d = d + 1.0;
  return d;
}

function softCore(distance, width) {
  var qv = 1.0 - clamp01(distance / max(0.001, width));
  return qv * qv * (3.0 - 2.0 * qv);
}

// Planform in the ray's moving frame. `forward` points toward the rounded
// nose; `lateral` spans the wings. The rear boundary recedes toward each
// wingtip, producing the manta's characteristic concave trailing edge.
function mantaBody(forward, lateral, bodyLength, wingSpan, flap) {
  var side = lateral / max(0.001, wingSpan);
  var sideAbs = abs(side);
  if (sideAbs >= 1.0) return 0.0;

  var liftedSide = side - flap * sin(side * PI) * 0.72;
  sideAbs = abs(liftedSide);
  if (sideAbs >= 1.0) return 0.0;

  var along = forward / max(0.001, bodyLength);
  var rear = -0.22 - pow(sideAbs, 1.36) * 0.58;
  var front = 0.60 - pow(sideAbs, 1.72) * 0.25;
  if (along <= rear || along >= front) return 0.0;

  var rearFade = clamp01((along - rear) / 0.16);
  var frontFade = clamp01((front - along) / 0.15);
  var tipFade = clamp01((1.0 - sideAbs) / 0.12);
  var core = rearFade * frontFade * tipFade;
  return core * core * (3.0 - 2.0 * core);
}

function mantaTail(forward, lateral, bodyLength, wingSpan) {
  var along = forward / max(0.001, bodyLength);
  if (along >= -0.14 || along <= -1.58) return 0.0;
  var tailProgress = clamp01((-along - 0.14) / 1.44);
  var tailWidth = wingSpan * (0.070 - tailProgress * 0.052);
  var centerCurl = sin(tailProgress * PI * 1.35) * wingSpan * 0.055;
  return softCore(abs(lateral - centerCurl), tailWidth)
       * pow(1.0 - tailProgress, 0.48);
}

function mantaAnatomy(forward, lateral, bodyLength, wingSpan, body, phase) {
  if (body <= 0.001) return 0.0;
  var along = forward / max(0.001, bodyLength);
  var side = lateral / max(0.001, wingSpan);
  var sideAbs = abs(side);

  // Spine and two cephalic lobes stay attached to the nose.
  var spine = softCore(abs(lateral), wingSpan * 0.075)
            * softCore(abs(along - 0.12), 0.72) * body;
  var lobeAlong = abs(along - 0.48);
  var lobeSide = abs(sideAbs - 0.16);
  var lobes = softCore(lobeAlong, 0.16) * softCore(lobeSide, 0.105) * body;

  // Curved wing ribs radiate from the spine and remain in the moving frame.
  var ribCoord = sideAbs * (3.20 + detail * 2.35)
               + along * (0.42 + sideAbs * 0.58) + phase * 0.035;
  var ribs = pow(wave(ribCoord), 13.0) * body * sideAbs;

  // A thin leading edge makes the swept planform readable at ship distance.
  var front = 0.60 - pow(sideAbs, 1.72) * 0.25;
  var edge = softCore(abs(front - along), 0.055) * body;
  return clamp01(spine * 0.72 + lobes * 0.88 + ribs * 0.78 + edge * 0.62);
}

var PHASE_WRAP = 10000.0;
var swimA = 0.08;
var swimB = 0.57;
var wingPhase = 0.0;
var currentPhase = 0.0;
var levelGain = 1.0;

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  var rate = pow(2.0, (localSpeed - 0.5) * 4.0);
  swimA = swimA + dt * (0.014 + rate * 0.043);
  swimB = swimB + dt * (0.011 + rate * 0.0304056);
  wingPhase = wingPhase + dt * (0.019 + rate * 0.071);
  currentPhase = currentPhase + dt * (0.008 + rate * 0.024826);

  if (swimA >= PHASE_WRAP) swimA = swimA - PHASE_WRAP;
  if (swimB >= PHASE_WRAP) swimB = swimB - PHASE_WRAP;
  if (wingPhase >= PHASE_WRAP) wingPhase = wingPhase - PHASE_WRAP;
  if (currentPhase >= PHASE_WRAP) currentPhase = currentPhase - PHASE_WRAP;

  levelGain = 0.22 + level * 1.12;
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

  // Both 74-pixel signs deliberately depend on fixture-local index and shared
  // clocks only. Matching local indices therefore emit byte-identical RGBW,
  // an exact left/right energy and legibility proof.
  if (isSign) {
    var signX = clamp01(pixelLocalIndex / 73.0);
    var signCenterA = swimA - floor(swimA);
    var signCenterB = 1.0 - (swimB - floor(swimB));
    var signDistA = abs(wrappedDelta(signX, signCenterA));
    var signDistB = abs(wrappedDelta(signX, signCenterB));
    var signRayA = softCore(signDistA, 0.155 + radius * 0.115);
    var signRayB = softCore(signDistB, 0.135 + radius * 0.095);
    var signWingA = signRayA * (0.74 + wave(signX * 5.0 - wingPhase) * 0.26);
    var signWingB = signRayB * (0.72 + wave(signX * 4.0 + wingPhase * 0.7071) * 0.28);
    var signCurrent = wave(signX * 1.61803 - currentPhase * 0.71)
                    * wave(signX * 2.41421 + currentPhase * 0.43);
    var signFloor = 0.205 + level * 0.105;
    var signValue = (signFloor + signCurrent * 0.080
                    + signWingA * 0.36 + signWingB * 0.31
                    + kick * (signRayA + signRayB) * 0.16)
                   * (0.72 + level * 0.28);
    var signMix = clamp01(0.16 + signCurrent * 0.24
                         + signRayA * 0.22 + signRayB * 0.66);
    var signR = (pr1 + (pr2 - pr1) * signMix) * signValue;
    var signG = (pg1 + (pg2 - pg1) * signMix) * signValue;
    var signB = (pb1 + (pb2 - pb1) * signMix) * signValue;
    rgbwau(clamp01(signR), clamp01(signG), clamp01(signB), 0.0, 0.0, 0.0);
    return;
  }

  var centerAX = swimA - floor(swimA);
  var centerBX = 1.0 - (swimB - floor(swimB));
  var centerAY = 0.64 + sin(swimB * PI2 * 0.7071) * 0.055;
  var centerBY = 0.34 + sin(swimA * PI2 * 0.57735 + 1.9) * 0.048;
  var bodyLength = 0.115 + radius * 0.235;
  var wingSpan = 0.085 + radius * 0.205;
  var flapA = sin(wingPhase * PI2) * (0.035 + radius * 0.030);
  var flapB = sin(wingPhase * PI2 * 0.7071 + 2.2) * (0.030 + radius * 0.027);

  var forwardA = wrappedDelta(nx, centerAX);
  var forwardB = -wrappedDelta(nx, centerBX);
  var lateralA = ny - centerAY;
  var lateralB = ny - centerBY;
  var bodyA = mantaBody(forwardA, lateralA, bodyLength, wingSpan, flapA);
  var bodyB = mantaBody(forwardB, lateralB, bodyLength * 0.88,
                        wingSpan * 0.82, flapB);
  var tailA = mantaTail(forwardA, lateralA, bodyLength, wingSpan);
  var tailB = mantaTail(forwardB, lateralB, bodyLength * 0.88, wingSpan * 0.82);
  var anatomyA = mantaAnatomy(forwardA, lateralA, bodyLength, wingSpan,
                              bodyA, wingPhase);
  var anatomyB = mantaAnatomy(forwardB, lateralB, bodyLength * 0.88,
                              wingSpan * 0.82, bodyB, -wingPhase * 0.7071);

  // Theme-specific pelagic current: two oblique pressure sheets plus fine
  // depth filaments. Their irrational ratios prevent generic field repetition.
  var broadCurrent = wave(nx * 0.83 - ny * 1.37 + nz * 0.61
                         - currentPhase * 0.83);
  var crossingCurrent = wave(nx * 1.41421 + ny * 0.71 - nz * 1.19
                            + currentPhase * 0.57735);
  var current = broadCurrent * crossingCurrent;
  var filament = pow(wave(nx * 3.17 - ny * 2.73 + nz * 2.41421
                         + currentPhase * 0.31), 10.0) * detail;

  var wakeA = 0.0;
  var wakeB = 0.0;
  if (forwardA < -bodyLength * 0.10 && forwardA > -bodyLength * 1.70) {
    wakeA = softCore(abs(lateralA), wingSpan * 0.58)
          * clamp01(1.0 + forwardA / (bodyLength * 1.70));
  }
  if (forwardB < -bodyLength * 0.09 && forwardB > -bodyLength * 1.48) {
    wakeB = softCore(abs(lateralB), wingSpan * 0.50)
          * clamp01(1.0 + forwardB / (bodyLength * 1.48));
  }

  var body = max(bodyA, bodyB);
  var tails = max(tailA, tailB);
  var anatomy = max(anatomyA, anatomyB) * detail;
  var wakes = wakeA * 0.62 + wakeB * 0.54;
  var water = 0.072 + current * 0.115 + filament * 0.075;
  var rayValue = bodyA * 0.72 + bodyB * 0.66 + tails * 0.62
               + anatomy * 0.72 + wakes * 0.16;
  var value = (water + rayValue + kick * (body * 0.44 + wakes * 0.12))
            * levelGain;

  var mixField = 0.18 + broadCurrent * 0.20 + crossingCurrent * 0.12;
  var colorMix = clamp01(mixField * (1.0 - bodyA * 0.70 - bodyB * 0.70)
                        + bodyA * 0.14 + bodyB * 0.86
                        + anatomyB * 0.10);

  var white = 0.0;
  var uv = 0.0;
  if (isRaw) {
    // Direct-view strands emphasize the complete silhouette and tail.
    value = (water * 0.72 + pow(body, 0.62) * 0.82 + tails * 0.74
            + anatomy * 0.86 + wakes * 0.12 + kick * body * 0.32) * levelGain;
  } else if (isVintage) {
    var foam = pow(wave(pixelLocalIndex * 0.381966 + nx * 1.73
                       - currentPhase * 0.77 + body * 0.37), 12.0);
    foam = foam * (body * 0.78 + tails * 0.18 + current * 0.22);
    value = (0.055 + current * 0.095 + body * 0.42 + anatomy * 0.34
            + foam * 0.52 + kick * foam * 0.45) * levelGain;
    white = clamp01(foam * whiteFoam * (1.20 + level * 2.30)
                  * (1.0 + kick * 1.25));
  } else if (isPar) {
    // Single-pixel organs carry slow pressure markers, still palette-only.
    var organCurrent = wave(nx * 0.71 + ny * 1.13 + nz * 1.61
                           - currentPhase * 0.57);
    value = (0.075 + organCurrent * 0.15 + body * 0.31
            + kick * (0.06 + body * 0.16)) * levelGain;
    colorMix = clamp01(0.22 + organCurrent * 0.58 + bodyB * 0.18);
    uv = clamp01((organCurrent * 0.07 + body * 0.12)
               * uvUndertow * (0.38 + level * 0.60));
  } else if (isBar) {
    uv = clamp01((current * 0.075 + body * 0.24 + anatomy * 0.10
                 + kick * body * 0.12)
               * uvUndertow * (0.40 + level * 0.72));
  }

  var r = (pr1 + (pr2 - pr1) * colorMix) * value;
  var g = (pg1 + (pg2 - pg1) * colorMix) * value;
  var b = (pb1 + (pb2 - pb1) * colorMix) * value;
  rgbwau(clamp01(r), clamp01(g), clamp01(b), white, white, uv);
}
