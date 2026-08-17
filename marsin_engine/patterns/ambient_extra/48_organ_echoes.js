// DRAFT — pending operator review
/*
  48_organ_echoes.js — ORGAN ECHOES

  CONCEPT
    One slow phrase begins in the Organs and crosses a fixed instrument graph:
    Organs → Jewelry → Hull → Silhouette → Identity. Five scalar decay
    envelopes carry the phrase between roles. Nothing expands from a spatial
    center, so the result is an instrumental echo chain, never radial rings.

  INSTRUMENT STAGING
    FIX_PAR        — the initiating Organ source.
    FIX_VINTAGE_6  — a crisp palette-RGB and matched W=A catch.
    FIX_BAR_18     — the broad Hull resonance.
    FIX_RAW_LED    — the delayed outline echo.
    FIX_TE_SIGN    — the final held, exactly paired Identity answer.

  CONTROLS (declaration order = physical MIDI order)
    localSpeed   — pace of the complete five-role phrase clock.
    echoCount    — how many consecutive role nodes answer the Organ source.
    delay        — positive time separation between adjacent instrument roles.
    decay        — persistence of every role envelope after its arrival.
    organLevel   — source drive propagated through the complete echo graph.
    jewelryCatch — palette-RGB and W=A prominence of the Jewelry response.
    safetyFloor  — minimum resting visibility between the rare phrases.

  AUDIO_MODULATION_V1:
    sliderOrganLevel <- micKick range 0.10..0.48 curve pow2 # kicks strengthen the Organ-led phrase
    sliderDecay <- micFlux range 0.18..0.45 curve ease # flux lengthens the five-role answer
  Static (unmapped) params: localSpeed, echoCount, delay, jewelryCatch,
    safetyFloor, colorPalette1/2.

  COLOR / OUTPUT
    RGB remains strictly on the selected cp1-to-cp2 line. Only Vintage fixtures
    emit native white, always with byte-identical W=A. UV is always zero. A
    complete palette-derived resting bed remains visible between phrases.
*/

export var cp1H = 0.605, cp1S = 0.82, cp1V = 0.90;
export var cp2H = 0.095, cp2S = 0.70, cp2V = 1.00;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export var localSpeed = 0.30;
export var echoCount = 0.88;
export var delay = 0.42;
export var decay = 0.38;
export var organLevel = 0.62;
export var jewelryCatch = 0.54;
export var safetyFloor = 0.29;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderEchoCount(v) { echoCount = v; }
export function sliderDelay(v) { delay = v; liveDelay = v; }
export function sliderDecay(v) { decay = v; liveDecay = v; }
export function sliderOrganLevel(v) { organLevel = v; liveOrganLevel = v; }
export function sliderJewelryCatch(v) { jewelryCatch = v; }
export function sliderSafetyFloor(v) { safetyFloor = v; }

var PHI = 1.61803399;
var SQRT2 = 1.41421356;
var SQRT3 = 1.73205081;
var GOLDEN_ANGLE = 2.39996323;
var PHRASE_INTERVAL = 7.0 * PHI;

// Boot directly into a phrase so short previews show the complete role chain.
// Every later phrase starts after the same golden-ratio interval.
var phraseAge = 0.0;
var restClock = 0.137;

var liveEchoCount = 0.88;
var liveDelay = 0.42;
var liveDecay = 0.38;
var liveOrganLevel = 0.62;
var liveJewelryCatch = 0.54;
var liveSafetyFloor = 0.29;

var organEnvelope = 0.0;
var jewelryEnvelope = 0.0;
var hullEnvelope = 0.0;
var silhouetteEnvelope = 0.0;
var identityEnvelope = 0.0;

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
  else if (iv == 4.0) { pr2 = tv;   pg2 = pv;   pb2 = qv;   }
  else                 { pr2 = cp2V; pg2 = pv;   pb2 = qv;   }
}

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  // Live controls slew into the five scalar envelopes without moving a hard
  // spatial boundary. Organ and Jewelry gains follow quickly for audio use.
  var geometryFollow = min(1.0, dt * 4.5);
  var lightFollow = min(1.0, dt * 10.0);
  liveEchoCount += (clamp01(echoCount) - liveEchoCount) * geometryFollow;
  liveDelay += (clamp01(delay) - liveDelay) * geometryFollow;
  liveDecay += (clamp01(decay) - liveDecay) * geometryFollow;
  liveOrganLevel += (clamp01(organLevel) - liveOrganLevel) * lightFollow;
  liveJewelryCatch += (clamp01(jewelryCatch) - liveJewelryCatch) * lightFollow;
  liveSafetyFloor += (clamp01(safetyFloor) - liveSafetyFloor) * lightFollow;

  var speedMultiplier = 0.25 + clamp01(localSpeed)
    * (32.824 - 16.412 * clamp01(localSpeed));
  phraseAge += dt * speedMultiplier;
  if (phraseAge >= PHRASE_INTERVAL) phraseAge -= PHRASE_INTERVAL;
  // The resting field carries a continuously measurable cadence across the
  // complete speed range; it never changes the role-delay ordering.
  restClock += dt * (0.030 + speedMultiplier * 0.250);
  if (restClock >= 1.0) restClock -= 1.0;

  var roleDelay = 0.16 + clamp01(liveDelay) * 0.62;
  var decaySeconds = 0.04 + clamp01(liveDecay) * 3.40;
  var sourceDrive = 0.10 + clamp01(liveOrganLevel) * 0.90;
  var echoBudget = 1.0 + clamp01(liveEchoCount) * 4.0;

  // Compute the five scalar nodes explicitly once per frame. Keeping the
  // delayed ages visible here makes the positive role ordering auditable and
  // prevents any role-local spatial math from becoming a hidden delay source.
  organEnvelope = 0.0;
  jewelryEnvelope = 0.0;
  hullEnvelope = 0.0;
  silhouetteEnvelope = 0.0;
  identityEnvelope = 0.0;
  var organAge = phraseAge;
  var jewelryAge = phraseAge - roleDelay;
  var hullAge = phraseAge - roleDelay * 2.0;
  var silhouetteAge = phraseAge - roleDelay * 3.0;
  var identityAge = phraseAge - roleDelay * 4.0;
  if (organAge > 0.0) {
    organEnvelope = smooth01(organAge / 0.11)
                  * exp(-organAge / (decaySeconds * 0.82)) * sourceDrive;
  }
  if (jewelryAge > 0.0) {
    jewelryEnvelope = smooth01(jewelryAge / 0.11)
                    * exp(-jewelryAge / (decaySeconds * 0.92))
                    * sourceDrive * smooth01(echoBudget - 1.0);
  }
  if (hullAge > 0.0) {
    hullEnvelope = smooth01(hullAge / 0.11)
                 * exp(-hullAge / (decaySeconds * 1.06))
                 * sourceDrive * smooth01(echoBudget - 2.0);
  }
  if (silhouetteAge > 0.0) {
    silhouetteEnvelope = smooth01(silhouetteAge / 0.11)
                       * exp(-silhouetteAge / (decaySeconds * 1.18))
                       * sourceDrive * smooth01(echoBudget - 3.0);
  }
  if (identityAge > 0.0) {
    identityEnvelope = smooth01(identityAge / 0.11)
                     * exp(-identityAge / (decaySeconds * 1.62))
                     * sourceDrive * smooth01(echoBudget - 4.0);
  }

  _hsv2rgb1();
  _hsv2rgb2();
}

export function render3D(index, x, y, z) {
  var ux = clamp01(x);
  var uy = clamp01(y);
  var uz = clamp01(z);
  var isSign = fixtureType == FIX_TE_SIGN;

  if (isSign) {
    // Each 74-pixel sign spans two fixtures whose pixelLocalIndex counters
    // reset. Model-index folding preserves one complete emblem per sign and
    // makes the two Titanic answers byte-identical.
    var signIndex = index % 74.0;
    ux = (signIndex % 10.0) / 9.0;
    uy = floor(signIndex / 10.0) / 7.0;
    uz = 0.50;
  }

  // The resting field is deliberately broad and weak. Its incommensurate
  // projection gives the quiet ship dimensional life but contains no radius,
  // distance-from-center, expanding front, ring, or wave topology.
  var restA = wave(ux * 0.43 + uy * 0.29 - uz * 0.37 + restClock);
  var restB = wave(ux * SQRT2 - uy * 0.31 + uz * PHI
                 - restClock * 2.0);
  var restField = 0.58 * restA + 0.42 * restB;
  var floorLevel = 0.055 + clamp01(liveSafetyFloor) * 0.225;
  var brightness = floorLevel + 0.045 + restField * 0.055;
  var paletteMix = clamp01(0.08 + restA * 0.13 + restB * 0.10);
  var nativeWhite = 0.0;

  if (fixtureType == FIX_PAR) {
    // Organs speak first as four finite source voices, differentiated only by
    // fixture-local phase and palette—not by a spatial propagation field.
    var sourceVoice = 0.78 + 0.22
                    * wave(pixelLocalIndex * 0.25 + restClock);
    brightness = floorLevel + 0.12 + restField * 0.055
               + organEnvelope * sourceVoice * 0.84;
    paletteMix = clamp01(0.12 + sourceVoice * 0.18
                        + organEnvelope * 0.66);
  } else if (fixtureType == FIX_VINTAGE_6) {
    // Jewelry catches the second envelope with a crisp fixed head pattern.
    // Its white output is always matched W=A and never leaks to other roles.
    var head = pixelLocalIndex % 6.0;
    var crispHead = 0.0;
    if (head == 1.0 || head == 4.0) crispHead = 1.0;
    var catchAmount = clamp01(liveJewelryCatch);
    var catchShape = 0.38 + crispHead * 0.62;
    brightness = floorLevel * 0.78 + 0.045 + restField * 0.030
               + jewelryEnvelope * catchShape
               * (0.34 + catchAmount * 0.58);
    paletteMix = clamp01(0.54 + crispHead * 0.18
                        + jewelryEnvelope * 0.24);
    nativeWhite = clamp01(jewelryEnvelope * crispHead
                         * catchAmount * 0.76);
  } else if (fixtureType == FIX_BAR_18) {
    // Hull is a broad resonance of the third scalar envelope. Its longitudinal
    // ribs remain fixed while only their energy follows the instrument chain.
    var hullRib = 0.62 + 0.38
                * wave(ux * 1.63 + uz * 0.71 + fixtureId * 0.137);
    brightness = floorLevel + 0.07 + restField * 0.060
               + hullEnvelope * hullRib * 0.80;
    paletteMix = clamp01(0.16 + hullRib * 0.20
                        + hullEnvelope * 0.52);
  } else if (fixtureType == FIX_RAW_LED) {
    // Silhouette receives the fourth role delay as an outline-wide answer.
    // A fixed local contour gives definition without an expanding ring front.
    var outlineContour = 0.72 + 0.28
                       * wave(pixelLocalIndex * 0.061803 + ux * 0.37);
    brightness = floorLevel + 0.12 + restField * 0.048
               + silhouetteEnvelope * outlineContour * 0.74;
    paletteMix = clamp01(0.10 + outlineContour * 0.16
                        + silhouetteEnvelope * 0.58);
  } else if (isSign) {
    // The final held answer fills the complete paired local emblem.
    var signX = ux - 0.50;
    var signY = uy - 0.50;
    var diagonalA = 1.0 - smoothstep(0.045, 0.15,
                                     abs(signY - signX * 0.68));
    var diagonalB = 1.0 - smoothstep(0.045, 0.15,
                                     abs(signY + signX * 0.68));
    var heldEmblem = max(diagonalA, diagonalB);
    var echoTrace = wave(ux * 0.67 + uy * 0.37 - restClock * 0.83)
                  * wave(uy * 0.59 - ux * 0.31
                        + restClock * 1.41421356);
    brightness = max(0.30, floorLevel + 0.15 + restField * 0.050
                   + identityEnvelope * (0.42 + heldEmblem * 0.40)
                   + echoTrace * 0.14);
    paletteMix = clamp01(0.16 + heldEmblem * 0.18
                        + identityEnvelope * 0.58 + echoTrace * 0.10);
  }

  // Organ Level is the source drive for the complete instrument graph. It
  // scales every authored layer above the independent safety floor, while the
  // five delayed envelopes retain their additional sourceDrive shaping.
  brightness = floorLevel + (brightness - floorLevel)
             * (0.30 + clamp01(liveOrganLevel) * 0.70);
  // A broad resting timbre trace makes Local Speed continuously legible even
  // between rare phrases. It moves color along the existing palette line only;
  // role brightness—and therefore the five measured delays—stays untouched.
  var cadenceColor = wave(restClock + ux * 0.23 - uy * 0.17 + uz * 0.11);
  paletteMix += (cadenceColor - 0.50) * 0.42;
  brightness += cadenceColor * 0.14;
  brightness = clamp01(brightness);
  paletteMix = clamp01(paletteMix);
  nativeWhite = clamp01(nativeWhite);
  var outR = (pr1 + (pr2 - pr1) * paletteMix) * brightness;
  var outG = (pg1 + (pg2 - pg1) * paletteMix) * brightness;
  var outB = (pb1 + (pb2 - pb1) * paletteMix) * brightness;
  rgbwau(clamp01(outR), clamp01(outG), clamp01(outB),
         nativeWhite, nativeWhite, 0.0);
}
