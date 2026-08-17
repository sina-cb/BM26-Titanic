// DRAFT — pending operator review
/*
  08_quiet_signal.js — QUIET SIGNAL

  CONCEPT
    The resting ship holds a calm, legible night outline. Once every 17–29
    scaled seconds, both TE signs raise one gracious full-surface signal; the
    Organs answer a beat later, the Hull carries a soft expanding halo, and
    Jewelry offers one warm-white courtesy glint. The active ceremony occupies
    less than 10% of a cycle, so the punctuation remains rare.

  INSTRUMENT STAGING
    FIX_BAR_18     — low palette resonance plus the broad signal halo.
    FIX_RAW_LED    — dependable Silhouette outline with a quiet halo echo.
    FIX_VINTAGE_6  — restrained palette bed and one matched W=A courtesy head.
    FIX_PAR        — the delayed, weighty Organ answer.
    FIX_TE_SIGN    — synchronized paired 10x8 maps; both 74-pixel surfaces are
                     byte-balanced because they use only pixelLocalIndex.

  MOTION / MATH
    A delta clock selects a 17–29 second interval. A second clock advances at
    sqrt(2)/phi against it, changing the low spatial resonance and halo texture
    without changing the ceremony's readable timing. Piecewise cubic envelopes
    give the sign a soft rise/hold/fall and the Organs a delayed response. Both
    clocks wrap only at large seam-safe integer boundaries.

  CONTROLS (declaration order = physical MIDI order)
    localSpeed   — cadence of the rare signal and all quiet drift.
    interval     — time between signals, from 17 to 29 scaled seconds.
    signLevel    — prominence of the shared signal, strongest on Identity.
    signHold     — duration of the graceful sign hold within the rare event.
    organAnswer  — strength of the delayed stack/auditorium reply.
    halo         — breadth and presence of the ship-wide response halo.
    safetyFloor  — minimum visibility of the complete resting ship.

  AUDIO_MODULATION_V1:
    sliderHalo        <- micFlux range 0.08..0.35 curve ease   # flux opens the restrained response halo
    sliderOrganAnswer <- micMid  range 0.10..0.40 curve linear # mids strengthen the delayed Organ answer
  Static (unmapped) params: localSpeed, interval, signLevel, signHold,
    safetyFloor, colorPalette1/2.

  COLOR / OUTPUT
    Every RGB value stays on the selected cp1→cp2 line. Native white appears
    only as the brief Vintage courtesy glint and is emitted with W=A. UV is
    always zero. Silence is a complete, attractive, non-black ship.
*/

export var localSpeed = 0.30;
export var interval = 0.50;
export var signLevel = 0.72;
export var signHold = 0.44;
export var organAnswer = 0.45;
export var halo = 0.22;
export var safetyFloor = 0.28;

export var cp1H = 0.075, cp1S = 0.84, cp1V = 1.00;
export var cp2H = 0.015, cp2S = 0.91, cp2V = 0.88;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderInterval(v) { interval = v; }
export function sliderSignLevel(v) { signLevel = v; }
export function sliderSignHold(v) { signHold = v; }
export function sliderOrganAnswer(v) { organAnswer = v; }
export function sliderHalo(v) { halo = v; }
export function sliderSafetyFloor(v) { safetyFloor = v; }

var SQRT2 = 1.41421356;
var PHI = 1.61803399;
var GOLDEN_ANGLE = 2.39996323;
var CLOCK_WRAP = 10000.0;

var eventClock = 0.0;
var eventAge = 0.0;
var detailClock = 0.0;
var liveInterval = 0.50;
var liveSignLevel = 0.72;
var liveSignHold = 0.44;
var liveOrganAnswer = 0.45;
var liveHalo = 0.22;
var liveSafetyFloor = 0.28;

var eventPhase = 0.0;
var signEnvelope = 0.0;
var organEnvelope = 0.0;
var courtesyEnvelope = 0.0;
var haloFront = 0.0;

var pr1 = 1.0, pg1 = 0.0, pb1 = 0.0;
var pr2 = 0.0, pg2 = 0.0, pb2 = 1.0;

function clamp01(v) {
  if (v < 0.0) return 0.0;
  if (v > 1.0) return 1.0;
  return v;
}

function smooth01(v) {
  var q = clamp01(v);
  return q * q * (3.0 - 2.0 * q);
}

function pulseEnvelope(age, rise, hold, fall) {
  if (age < 0.0) return 0.0;
  if (age < rise) return smooth01(age / rise);
  if (age < rise + hold) return 1.0;
  if (age < rise + hold + fall) {
    return 1.0 - smooth01((age - rise - hold) / fall);
  }
  return 0.0;
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

  // Live edits ease into the ceremony and never teleport its brightness.
  var follow = min(1.0, dt * 4.0);
  liveInterval += (interval - liveInterval) * follow;
  liveSignLevel += (signLevel - liveSignLevel) * follow;
  liveSignHold += (signHold - liveSignHold) * follow;
  liveOrganAnswer += (organAnswer - liveOrganAnswer) * follow;
  liveHalo += (halo - liveHalo) * follow;
  liveSafetyFloor += (safetyFloor - liveSafetyFloor) * follow;

  var localMultiplier = 0.25 + clamp01(localSpeed)
    * (32.824 - 16.412 * clamp01(localSpeed));
  eventClock += dt * localMultiplier;
  eventAge += dt;
  detailClock += dt * localMultiplier * localMultiplier * SQRT2 / PHI;
  if (detailClock >= CLOCK_WRAP) detailClock -= CLOCK_WRAP;

  var eventPeriod = 17.0 + clamp01(liveInterval) * 12.0;
  if (eventClock >= eventPeriod) {
    eventClock -= eventPeriod;
    eventAge = 0.0;
  }
  // The first gracious cue has the same envelope at every localSpeed setting;
  // localSpeed changes how soon the next cue arrives, not how violently the
  // current cue is truncated.
  eventPhase = eventAge / eventPeriod;

  // The longest sign envelope is 9.2% of its interval. The delayed Organ
  // answer and courtesy glint also finish before the 10% active-duty mark.
  var signRise = 0.012;
  var signHoldTime = 0.008 + clamp01(liveSignHold) * 0.022;
  var signFall = 0.025 + clamp01(liveSignHold) * 0.025;
  signEnvelope = pulseEnvelope(eventPhase, signRise, signHoldTime, signFall);
  organEnvelope = pulseEnvelope(eventPhase - 0.026, 0.014, 0.010, 0.032);
  courtesyEnvelope = pulseEnvelope(eventPhase - 0.018, 0.006, 0.003, 0.010);
  haloFront = clamp01(eventPhase / 0.082);

  _hsv2rgb1();
  _hsv2rgb2();
}

export function render3D(index, x, y, z) {
  var nx = clamp01(x);
  var ny = clamp01(y);
  var nz = clamp01(z);
  var isSign = fixtureType == FIX_TE_SIGN;

  if (isSign) {
    // Both contiguous 74-pixel fixtures receive the same complete face map.
    // index % 74 explicitly replays the radial reveal across the sign reset.
    var signIndex = index % 74.0;
    nx = (signIndex % 10.0) / 9.0;
    ny = floor(signIndex / 10.0) / 7.0;
    nz = 0.42 + ny * 0.16;
  }

  var floorLevel = 0.035 + clamp01(liveSafetyFloor) * 0.180;
  var slowField = 0.5 + 0.5 * sin((nx * 0.67 + nz * 0.43
                                + ny * 0.21 + detailClock * 0.117) * PI2);
  var crossField = 0.5 + 0.5 * cos((nx * -0.31 + nz * 0.59
                                  + detailClock * 0.071 * PHI) * PI2);
  var resonance = 0.62 * slowField + 0.38 * crossField;
  // A very low-amplitude triangular pilot tone makes localSpeed perceptually
  // honest even during the long resting interval: its slope is constant, so
  // faster settings cannot disappear at a sine turning point.
  var quietTick = triangle(detailClock * 0.20 + nx * 0.31 + nz * 0.17);

  var dx = nx - 0.50;
  var dz = nz - 0.50;
  var radius = (dx * dx + dz * dz) / 0.5041;
  var haloWidth = 0.075 + clamp01(liveHalo) * 0.135;
  var haloDistance = abs(radius - haloFront * haloFront);
  var responseHalo = 1.0 - smoothstep(haloWidth, haloWidth * 1.85,
                                     haloDistance);
  responseHalo *= signEnvelope * (0.12 + clamp01(liveHalo) * 0.88);

  var paletteMix = clamp01(0.16 + resonance * 0.70
                          + responseHalo * 0.10);
  var brightness = floorLevel + 0.07 + resonance * 0.10
                 + responseHalo * 0.24;
  var whiteLevel = 0.0;

  if (fixtureType == FIX_BAR_18) {
    // Hull: a quiet palette resonance carries the broad circular reply.
    brightness = floorLevel + 0.035 + resonance * 0.080
               + responseHalo * (0.10 + liveHalo * 0.18);
    paletteMix = clamp01(0.66 + resonance * 0.25
                       + responseHalo * 0.08);
  } else if (fixtureType == FIX_RAW_LED) {
    // Silhouette: always readable, with only a restrained echo of the halo.
    brightness = floorLevel + 0.10 + resonance * 0.055
               + responseHalo * (0.06 + liveHalo * 0.09);
    paletteMix = clamp01(0.08 + resonance * 0.34
                       + responseHalo * 0.12);
  } else if (fixtureType == FIX_VINTAGE_6) {
    // One courtesy head per Vintage fixture receives the brief native-white
    // glint. The other five remain a restrained palette-derived Jewelry bed.
    var head = pixelLocalIndex % 6.0;
    var courtesyHead = 0.0;
    if (head >= 2.0 && head < 3.0) courtesyHead = 1.0;
    var jewelDrift = 0.5 + 0.5 * sin(index * GOLDEN_ANGLE
                                   + detailClock * 0.021);
    brightness = floorLevel * 0.72 + 0.055 + jewelDrift * 0.105
               + signEnvelope * 0.06;
    paletteMix = clamp01(0.72 + jewelDrift * 0.20);
    whiteLevel = courtesyHead * courtesyEnvelope
               * (0.14 + liveSignLevel * 0.28);
  } else if (fixtureType == FIX_PAR) {
    // Organs answer after the sign rather than flashing with it.
    brightness = floorLevel + 0.10 + resonance * 0.08
               + organEnvelope * (0.16 + liveOrganAnswer * 0.66);
    paletteMix = clamp01(0.66 + resonance * 0.20
                       + organEnvelope * 0.11);
  } else if (isSign) {
    // The resting sign stays legible. During the cue a single broad golden
    // iris opens through the full orange face, led by one thick reveal edge.
    // This is a surface wipe, not Twin Seals' continuously held ring signets.
    var localFacet = 0.5 + 0.5 * sin((nx * 0.73 + ny * 0.41
                                    + detailClock * 0.089) * PI2);
    var signDx = nx - 0.50;
    var signDy = ny - 0.50;
    var signRadius = sqrt(signDx * signDx + signDy * signDy) / 0.71;
    var revealFront = haloFront * 1.18;
    var revealEdgeDistance = abs(signRadius - revealFront);
    var revealEdge = (1.0 - smoothstep(0.065, 0.145,
                                      revealEdgeDistance)) * signEnvelope;
    var revealedDisc = smooth01((revealFront - signRadius) / 0.22)
                     * signEnvelope;
    var centerStamp = smooth01((0.30 - signRadius) / 0.12)
                    * signEnvelope;
    brightness = floorLevel + 0.11 + liveSignLevel * 0.34
               + localFacet * 0.035
               + revealedDisc * (0.30 + liveSignLevel * 0.42)
               + revealEdge * (0.40 + liveSignLevel * 0.44)
               + centerStamp * 0.14;
    // The orange resting material yields to the first palette endpoint inside
    // the disc, producing a visibly different Identity object at distance.
    paletteMix = clamp01(0.78 + localFacet * 0.12
                       - revealedDisc * 0.68 - revealEdge * 0.18);
  }

  brightness += quietTick * (0.018 + clamp01(localSpeed) * 0.062);

  // Signal-level and hold remain measurable on rigs without Identity: the
  // Silhouette carries a restrained shared echo while TE signs stay primary.
  if (fixtureType == FIX_RAW_LED) {
    brightness += liveSignLevel * 0.035
                + signEnvelope * liveSignLevel * 0.12;
  }

  brightness = clamp01(brightness);
  whiteLevel = clamp01(whiteLevel);
  var outR = (pr1 + (pr2 - pr1) * paletteMix) * brightness;
  var outG = (pg1 + (pg2 - pg1) * paletteMix) * brightness;
  var outB = (pb1 + (pb2 - pb1) * paletteMix) * brightness;
  rgbwau(clamp01(outR), clamp01(outG), clamp01(outB),
         whiteLevel, whiteLevel, 0.0);
}
