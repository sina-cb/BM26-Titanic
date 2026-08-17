// DRAFT — pending operator review
/*
  46_twin_seals.js — TWIN SEALS

  CONCEPT
    Both TE signs become exact luminous hero seals: three concentric rings and
    eight to sixteen finite inscription ticks turn together through long,
    ceremonial holds. The vessel forms a rectilinear frame around the paired
    signets; circular geometry never spills into generic whole-rig arcs.

  INSTRUMENT STAGING
    FIX_BAR_18     — a restrained two-color field behind the ceremony.
    FIX_RAW_LED    — the long rectilinear outer frame and its beaded echo.
    FIX_VINTAGE_6  — sparse signet studs with restrained native W=A.
    FIX_PAR        — four steady corner-anchor cohorts.
    FIX_TE_SIGN    — dominant paired local seals, byte-identical by local index.

  MOTION / MATH
    Each sign maps to the same local 10x8 plane. Three analytic ring distances
    and a finite radial tick field form the seal. Tick angle follows one smooth
    phase compressed by v/(k+|v|), producing slow inscription rotation with
    long holds and no discontinuity. Outside Identity, only finite line and
    bead fields frame the ship.

  CONTROLS (declaration order = physical MIDI order)
    localSpeed  — cadence of the inscription's held rotation.
    sealSize    — radius of the complete three-ring sign seal.
    ringWidth   — thickness of the three ring strokes.
    inscription — selects 8–16 ticks and their engraved prominence.
    signLevel   — brightness authority for the paired Identity seals.
    echo        — strength of finite beads repeating around the ship frame.
    safetyFloor — protected whole-vessel visibility beneath the ceremony.

  AUDIO_MODULATION_V1:
    sliderInscription <- micMid range 0.18..0.45 curve linear # mids articulate the radial inscription
    sliderEcho        <- micFlux range 0.08..0.32 curve ease # flux lifts the ceremonial frame echoes
  Static (unmapped) params: localSpeed, sealSize, ringWidth, signLevel,
    safetyFloor, colorPalette1/2.

  COLOR / OUTPUT
    RGB remains strictly on the cp1-to-cp2 segment. Only Vintage fixtures emit
    native white and always W=A. UV is always zero. Silence retains fully
    legible paired signs, a complete ship frame, and no flashes or blackout.
*/

export var cp1H = 0.610, cp1S = 0.78, cp1V = 0.92;
export var cp2H = 0.105, cp2S = 0.74, cp2V = 1.00;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export var localSpeed = 0.30;
export var sealSize = 0.52;
export var ringWidth = 0.36;
export var inscription = 0.38;
export var signLevel = 0.82;
export var echo = 0.22;
export var safetyFloor = 0.28;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderSealSize(v) { sealSize = v; }
export function sliderRingWidth(v) { ringWidth = v; }
export function sliderInscription(v) { inscription = v; }
export function sliderSignLevel(v) { signLevel = v; }
export function sliderEcho(v) { echo = v; }
export function sliderSafetyFloor(v) { safetyFloor = v; }

var GOLDEN_FRACTION = 0.61803399;
var GOLDEN_ANGLE = 2.39996323;
var SQRT2 = 1.41421356;
var PHASE_WRAP = 10000.0;

var inscriptionPhase = 0.173;
var heldInscriptionAngle = 0.0;
var frameTravel = 0.0;
var activeTickCount = 11.0;

var liveSealSize = 0.52;
var liveRingWidth = 0.36;
var liveInscription = 0.38;
var liveSignLevel = 0.82;
var liveEcho = 0.22;
var liveSafetyFloor = 0.28;

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

  var follow = min(1.0, dt * 5.0);
  liveSealSize += (sealSize - liveSealSize) * follow;
  liveRingWidth += (ringWidth - liveRingWidth) * follow;
  liveInscription += (inscription - liveInscription) * follow;
  liveSignLevel += (signLevel - liveSignLevel) * follow;
  liveEcho += (echo - liveEcho) * follow;
  liveSafetyFloor += (safetyFloor - liveSafetyFloor) * follow;

  var localMultiplier = 0.25 + clamp01(localSpeed)
    * (32.824 - 16.412 * clamp01(localSpeed));
  inscriptionPhase += dt * (0.012 + localMultiplier * 0.043);
  if (inscriptionPhase >= PHASE_WRAP) inscriptionPhase -= PHASE_WRAP;

  // Rational compression holds near ±1 for most of each sine lobe, then
  // crosses the midpoint continuously. There is no stepped timeline or flash.
  var inscriptionSine = sin(inscriptionPhase * PI2);
  var heldWave = inscriptionSine
               / (0.18 + 0.82 * abs(inscriptionSine));
  heldInscriptionAngle = heldWave * 0.78;
  frameTravel = inscriptionPhase - floor(inscriptionPhase);
  activeTickCount = floor(8.0 + clamp01(liveInscription) * 8.999);

  _hsv2rgb1();
  _hsv2rgb2();
}

export function render3D(index, x, y, z) {
  var px = clamp01(x);
  var py = clamp01(y * 0.86 + z * 0.14);
  var isSign = fixtureType == FIX_TE_SIGN;

  if (isSign) {
    // A physical TE sign is one 74-pixel instrument assembled from 40- and
    // 34-pixel fixtures, so pixelLocalIndex resets halfway through the sign.
    // Fold the model index into the complete 74-pixel surface instead. The
    // Titanic's two consecutive signs then receive byte-identical maps; the
    // test bench receives the same complete map with a harmless cyclic offset.
    var signIndex = index % 74.0;
    px = (signIndex % 10.0) / 9.0;
    py = floor(signIndex / 10.0) / 7.0;
  }

  var centeredX = px - 0.50;
  var centeredY = py - 0.50;
  var absX = abs(centeredX);
  var absY = abs(centeredY);
  // The seals sit inside a broad ceremonial light passage. This provides the
  // camp-distance motion while a pair of low-frequency fields keeps the
  // material alive between the engraved rings and frame beads.
  var ceremonyCenter = 0.50 + 0.44
    * sin(inscriptionPhase * PI2 * 0.37);
  var ceremonyBand = 1.0 - smoothstep(0.13, 0.52,
                                     abs(px - ceremonyCenter));
  var ceremonyField = wave(px * 0.71 + py * 0.37
                          - inscriptionPhase * 0.53)
                     * wave(py * 0.61 - px * 0.29
                          + inscriptionPhase * SQRT2);

  // The surrounding vessel uses only rectilinear frame geometry. A moving
  // finite bead train follows this frame; no radial seal field escapes Identity.
  var frameDistance = min(abs(absX - 0.43), abs(absY - 0.39));
  var frameGate = max(absX / 0.47, absY / 0.43);
  var finiteFrame = (1.0 - smoothstep(0.012, 0.042, frameDistance))
                  * (1.0 - smoothstep(0.98, 1.08, frameGate));
  var frameCoordinate = absX > absY
                      ? (centeredX + 0.50) : (centeredY + 0.50);
  var beadWave = 0.5 + 0.5
               * cos((frameCoordinate * 13.0 - frameTravel) * PI2);
  var frameBeads = finiteFrame * pow(beadWave, 8.0);

  var floorLevel = 0.050 + clamp01(liveSafetyFloor) * 0.245;
  var echoAmount = clamp01(liveEcho);
  var brightness = floorLevel + finiteFrame * 0.10
                 + frameBeads * echoAmount * 0.36;
  var paletteMix = clamp01(0.10 + px * 0.34 + py * 0.18
                          + frameBeads * 0.28);
  var nativeWhite = 0.0;

  if (fixtureType == FIX_BAR_18) {
    // Hull Canvas is the restrained satin field inside the ceremony frame.
    var fieldFold = 0.5 + 0.5
      * sin((px * SQRT2 + py * GOLDEN_FRACTION) * PI2
            + inscriptionPhase * PI2 * 0.17);
    brightness = floorLevel + 0.05 + fieldFold * 0.075
               + finiteFrame * 0.12 + frameBeads * echoAmount * 0.30;
    paletteMix = clamp01(0.08 + fieldFold * 0.56
                       + frameBeads * 0.22);
  } else if (fixtureType == FIX_RAW_LED) {
    // Silhouette is the strong long-frame outline and its finite bead echo.
    brightness = floorLevel + 0.07 + finiteFrame * 0.46
               + frameBeads * echoAmount * 0.62;
    paletteMix = clamp01(0.12 + finiteFrame * 0.48
                       + frameBeads * 0.34);
  } else if (fixtureType == FIX_VINTAGE_6) {
    // Sparse signet studs use native white only here, always with exact W=A.
    var studHash = 0.5 + 0.5
      * sin(pixelLocalIndex * GOLDEN_ANGLE + inscriptionPhase * PI2 * 0.23);
    var signetStud = pow(studHash, 14.0)
                   * (0.42 + finiteFrame * 0.58);
    brightness = floorLevel * 0.78 + 0.06 + finiteFrame * 0.16
               + signetStud * (0.30 + echoAmount * 0.48);
    paletteMix = clamp01(0.18 + finiteFrame * 0.50
                       + signetStud * 0.26);
    nativeWhite = signetStud * (0.08 + echoAmount * 0.30);
  } else if (fixtureType == FIX_PAR) {
    // Four local-index cohorts are the stable corners of the ceremonial frame.
    var anchorCohort = pixelLocalIndex % 4.0;
    var anchorPulse = 0.78 + 0.22
      * sin(inscriptionPhase * PI2 * 0.31 + anchorCohort * GOLDEN_ANGLE);
    brightness = floorLevel + 0.14 + anchorPulse * 0.34
               + frameBeads * echoAmount * 0.20;
    paletteMix = clamp01(0.12 + anchorCohort / 3.0 * 0.72
                       + anchorPulse * 0.08);
  } else if (isSign) {
    // Identity alone receives the circular seal geometry.
    var sealRadius = 0.12 + clamp01(liveSealSize) * 0.40;
    var ringStroke = 0.003 + clamp01(liveRingWidth) * 0.065;
    var radius = sqrt(centeredX * centeredX + centeredY * centeredY);

    var outerRing = 1.0 - smoothstep(ringStroke, ringStroke * 2.25,
                                     abs(radius - sealRadius));
    var middleRing = 1.0 - smoothstep(ringStroke, ringStroke * 2.25,
                                      abs(radius - sealRadius * 0.70));
    var innerRing = 1.0 - smoothstep(ringStroke, ringStroke * 2.25,
                                     abs(radius - sealRadius * 0.40));
    var rings = max(outerRing, max(middleRing, innerRing));

    var inscriptionAngle = atan2(centeredY, centeredX)
                         - heldInscriptionAngle;
    var angularTick = abs(sin(inscriptionAngle * activeTickCount * 0.50));
    // The sign surface is only 74 pixels, so the finite ticks are deliberately
    // broad enough to remain countable on that real topology rather than only
    // existing between emitters in continuous math.
    var tickStroke = 1.0 - smoothstep(0.08, 0.55, angularTick);
    var tickCenter = sealRadius * 0.84;
    var tickHalfLength = sealRadius * (0.10 + liveInscription * 0.12);
    var tickRadial = 1.0 - smoothstep(tickHalfLength,
                                      tickHalfLength * 1.55,
                                      abs(radius - tickCenter));
    var ticks = tickStroke * tickRadial;

    var centerMedallion = 1.0 - smoothstep(sealRadius * 0.12,
                                           sealRadius * 0.28, radius);
    var engravingSheen = wave(centeredX * 0.77 + centeredY * 0.43
                             - inscriptionPhase * 0.91);
    var inscriptionLight = wave(px * 0.61 + py * 0.37
                               - inscriptionPhase * 1.31);
    var inscriptionAmount = 0.26 + clamp01(liveInscription) * 0.74;
    var signAmount = 0.18 + clamp01(liveSignLevel) * 0.82;
    brightness = floorLevel * 0.62 + 0.06 + signAmount * 0.52
               + rings * (0.28 + signAmount * 0.56)
               + ticks * inscriptionAmount * signAmount * 0.78
               + centerMedallion * signAmount * 0.34
               + ceremonyBand * (0.16 + ceremonyField * 0.24)
               + engravingSheen * 0.22 + inscriptionLight * 0.17;
    // Modulate the full engraved material instead of adding another bright
    // object. This keeps high-energy ring pixels out of a saturation plateau,
    // so every part of the 74-pixel sign visibly participates in the turn.
    brightness *= 0.70 + inscriptionLight * 0.30;
    brightness = max(floorLevel + 0.06, brightness);
    paletteMix = clamp01(0.08 + outerRing * 0.18
                       + middleRing * 0.52 + innerRing * 0.78
                       + ticks * 0.28 + centerMedallion * 0.56
                       + ceremonyField * 0.16 + ceremonyBand * 0.08
                       + engravingSheen * 0.16 + inscriptionLight * 0.12);
  }

  if (!isSign) {
    brightness += ceremonyBand * (0.045 + ceremonyField * 0.075);
    paletteMix += ceremonyField * 0.07;
  }

  brightness = clamp01(brightness);
  paletteMix = clamp01(paletteMix);
  nativeWhite = clamp01(nativeWhite);
  var outR = (pr1 + (pr2 - pr1) * paletteMix) * brightness;
  var outG = (pg1 + (pg2 - pg1) * paletteMix) * brightness;
  var outB = (pb1 + (pb2 - pb1) * paletteMix) * brightness;
  rgbwau(clamp01(outR), clamp01(outG), clamp01(outB),
         nativeWhite, nativeWhite, 0.0);
}
