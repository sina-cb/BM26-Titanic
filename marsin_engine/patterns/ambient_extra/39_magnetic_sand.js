// DRAFT — pending operator review
/*
  39_magnetic_sand.js — MAGNETIC SAND

  CONCEPT
    Fine deterministic filings align around two invisible magnetic poles.
    Each occupied cell contains one finite dash whose axis follows an analytic
    dipole vector. This remains sparse magnetic sand, never a continuous
    reaction-diffusion surface or a generic whole-rig wash.

  INSTRUMENT STAGING
    FIX_BAR_18     — sparse Hull filings over a protected field-dark bed.
    FIX_RAW_LED    — the dipole fringe and its strongest aligned grains.
    FIX_VINTAGE_6  — palette-RGB filings only; no native-white shortcut.
    FIX_PAR        — the two luminous magnetic poles.
    FIX_TE_SIGN    — identical paired fixture-local magnetic field cards.

  CONTROLS (declaration order = physical MIDI order)
    localSpeed    — pace of the autonomous whole-field rotation.
    fieldStrength — ordering force, filing length, and dipole fringe contrast.
    grainDensity  — number of deterministic filing cells across the model.
    poleGap       — physical separation between the two magnetic poles.
    alignment     — how tightly filing axes follow the analytic field vector.
    organPoles    — prominence of the two Organ pole cores.
    safetyFloor   — minimum palette-derived whole-vessel visibility.

  AUDIO_MODULATION_V1:
    sliderFieldStrength <- micMid range 0.22..0.58 curve linear # mids order the magnetic field
    sliderGrainDensity <- micHigh range 0.10..0.38 curve ease # highs populate fine filings
  Static (unmapped) params: localSpeed, poleGap, alignment, organPoles,
    safetyFloor, colorPalette1/2.

  COLOR / OUTPUT
    RGB stays strictly on the selected cp1-to-cp2 line. Native white, amber,
    and UV are all zero. The safety field keeps every physical pixel visible
    in silence while the high-contrast filing mask occupies a small area.
*/

export var cp1H = 0.585, cp1S = 0.84, cp1V = 0.90;
export var cp2H = 0.105, cp2S = 0.78, cp2V = 1.00;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export var localSpeed = 0.30;
export var fieldStrength = 0.42;
export var grainDensity = 0.27;
export var poleGap = 0.25;
export var alignment = 0.78;
export var organPoles = 0.60;
export var safetyFloor = 0.27;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderFieldStrength(v) { fieldStrength = v; }
export function sliderGrainDensity(v) { grainDensity = v; }
export function sliderPoleGap(v) { poleGap = v; }
export function sliderAlignment(v) { alignment = v; }
export function sliderOrganPoles(v) { organPoles = v; }
export function sliderSafetyFloor(v) { safetyFloor = v; }

var PHASE_WRAP = 10000.0;
var PHI = 1.61803399;
var SQRT2 = 1.41421356;
var SQRT3 = 1.73205081;
var GOLDEN_ANGLE = 2.39996323;

var fieldClock = 0.173;
var fieldCos = 1.0;
var fieldSin = 0.0;

var liveFieldStrength = 0.42;
var liveGrainDensity = 0.27;
var livePoleGap = 0.25;
var liveAlignment = 0.78;
var liveSafetyFloor = 0.27;

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

  // Live edits change continuous geometry through bounded pursuit, so density,
  // gap, and brightness controls cannot teleport the complete composition.
  var geometryFollow = min(1.0, dt * 4.5);
  var lightFollow = min(1.0, dt * 10.0);
  liveFieldStrength += (fieldStrength - liveFieldStrength) * lightFollow;
  liveGrainDensity += (grainDensity - liveGrainDensity) * geometryFollow;
  livePoleGap += (poleGap - livePoleGap) * geometryFollow;
  liveAlignment += (alignment - liveAlignment) * geometryFollow;
  liveSafetyFloor += (safetyFloor - liveSafetyFloor) * lightFollow;

  // Recalibrated after operator review: Local Speed 0.30 now equals the old
  // 0.10 motion, and the upper third is capped so the filing field can never
  // become an unreadably fast spin.
  var speedControl = min(clamp01(localSpeed) / 3.0, 0.24);
  var localMultiplier = 0.25 + speedControl
    * (32.824 - 16.412 * speedControl);
  fieldClock += dt * (0.010 + localMultiplier * 0.031);
  if (fieldClock >= PHASE_WRAP) fieldClock -= PHASE_WRAP;

  // An unbounded-angle sin/cos turn is seam-safe at the large bookkeeping
  // wrap because 10,000 complete turns land at the identical field angle.
  var fieldAngle = fieldClock * PI2;
  fieldCos = cos(fieldAngle);
  fieldSin = sin(fieldAngle);
  _hsv2rgb1();
  _hsv2rgb2();
}

export function render3D(index, x, y, z) {
  var ux = clamp01(x);
  var uy = clamp01(y);
  var uz = clamp01(z);
  var isSign = fixtureType == FIX_TE_SIGN;

  if (isSign) {
    // Each sign spans two physical fixtures. The complete 74-pixel fold keeps
    // every filing and both pole lobes continuous through the patch split.
    var signIndex = index % 74.0;
    ux = (signIndex % 10.0) / 9.0;
    uy = floor(signIndex / 10.0) / 7.0;
    uz = 0.50;
  }

  // Project the ship's X/Y/Z volume into a legible long field, then rotate the
  // coordinate frame slowly around its center. The poles themselves remain
  // fixed in this frame, so every filing follows one continuous moving field.
  var centeredX = (ux - 0.50) * 1.52;
  var centeredY = (uy - 0.50) * 0.74 + (uz - 0.50) * 0.34;
  var fieldX = centeredX * fieldCos + centeredY * fieldSin;
  var fieldY = -centeredX * fieldSin + centeredY * fieldCos;

  var gap = 0.18 + clamp01(livePoleGap) * 0.46;
  var poleHalfGap = gap * 0.50;

  // Deterministic cell coordinates. Density changes the population and scale
  // of filings, not merely their brightness.
  // Coarse physical cells survive Titanic's fixture spacing.  Density still
  // changes both grain count and scale, but never dissolves into a fine grid.
  var gridCount = 5.0 + floor(clamp01(liveGrainDensity) * 8.0);
  var gridX = (fieldX + 0.82) * gridCount;
  var gridY = (fieldY + 0.58) * gridCount;
  var cellX = floor(gridX);
  var cellY = floor(gridY);
  var cellHash = wave(cellX * 0.75487767 + cellY * 0.56984029
                    + cellX * cellY * 0.01351351);
  var cellHash2 = wave(cellX * PHI - cellY * SQRT2
                     + cellX * cellY * 0.02127659);
  var grainCenterX = (cellX + 0.34 + cellHash * 0.32) / gridCount - 0.82;
  var grainCenterY = (cellY + 0.34 + cellHash2 * 0.32) / gridCount - 0.58;

  // Analytic source/sink pair evaluated at each grain center. The inverse-r²
  // contributions curve the field axis around both finite pole locations.
  var toPositiveX = grainCenterX + poleHalfGap;
  var toPositiveY = grainCenterY;
  var toNegativeX = grainCenterX - poleHalfGap;
  var toNegativeY = grainCenterY;
  var positiveR2 = toPositiveX * toPositiveX
                 + toPositiveY * toPositiveY + 0.004;
  var negativeR2 = toNegativeX * toNegativeX
                 + toNegativeY * toNegativeY + 0.004;
  var vectorX = toPositiveX / positiveR2 - toNegativeX / negativeR2;
  var vectorY = toPositiveY / positiveR2 - toNegativeY / negativeR2;
  var vectorLength = sqrt(vectorX * vectorX + vectorY * vectorY) + 0.000001;
  var fieldUnitX = vectorX / vectorLength;
  var fieldUnitY = vectorY / vectorLength;

  // Low alignment permits deterministic disorder; high alignment converges
  // to the analytic axis. Field Strength increases order and filing length,
  // making both the declared slider and micMid mapping visually truthful.
  var order = clamp01(liveAlignment)
            * (0.35 + clamp01(liveFieldStrength) * 0.65);
  var randomX = cellHash * 2.0 - 1.0;
  var randomY = cellHash2 * 2.0 - 1.0;
  var randomScale = 1.0 / (abs(randomX) + abs(randomY) + 0.0001);
  randomX *= randomScale;
  randomY *= randomScale;
  var grainCos = fieldUnitX * order + randomX * (1.0 - order);
  var grainSin = fieldUnitY * order + randomY * (1.0 - order);
  var grainScale = 1.0 / (abs(grainCos) + abs(grainSin) + 0.0001);
  grainCos *= grainScale;
  grainSin *= grainScale;
  var fromCenterX = fieldX - grainCenterX;
  var fromCenterY = fieldY - grainCenterY;
  var alongGrain = fromCenterX * grainCos + fromCenterY * grainSin;
  var acrossGrain = -fromCenterX * grainSin + fromCenterY * grainCos;

  var cellScale = 1.0 / gridCount;
  var halfLength = cellScale
                 * (0.52 + clamp01(liveFieldStrength) * 0.40);
  var halfWidth = cellScale * (0.105 + cellHash2 * 0.050);
  var lengthMask = smooth01(1.0 - abs(alongGrain) / halfLength);
  var widthMask = smooth01(1.0 - abs(acrossGrain) / halfWidth);
  // A fixed population gate keeps the feature below a 20% area occupancy even
  // at maximum density; density increases resolution rather than filling space.
  var population = cellHash > 0.24;
  var grain = population * lengthMask * widthMask;

  // Two symmetric curved field-line lobes make the shared alignment visible
  // at distance. They only lift finite filings already present in a cell; the
  // field never turns into a continuous painted surface.
  var lobeX = fieldX / 0.72;
  var lobeHeight = 0.15 + lobeX * lobeX * 0.36;
  var lobeDistance = abs(abs(fieldY) - lobeHeight);
  var lobeGate = 1.0 - smoothstep(0.68, 0.88, abs(fieldX));
  var lobeBand = (1.0 - smoothstep(0.035, 0.115, lobeDistance))
               * lobeGate;
  grain *= 0.78 + lobeBand * 0.72;

  var distancePositiveSquared = (fieldX + poleHalfGap)
                              * (fieldX + poleHalfGap)
                              + fieldY * fieldY;
  var distanceNegativeSquared = (fieldX - poleHalfGap)
                              * (fieldX - poleHalfGap)
                              + fieldY * fieldY;
  var nearestPoleSquared = min(distancePositiveSquared,
                               distanceNegativeSquared);
  var poleCore = smooth01(1.0 - nearestPoleSquared / 0.013225);
  var fieldFringe = smooth01(1.0 - nearestPoleSquared / 0.1156)
                  - poleCore * 0.72;
  fieldFringe = max(0.0, fieldFringe);

  var floorLevel = 0.040 + clamp01(liveSafetyFloor) * 0.205;
  var brightness = floorLevel + grain * (0.44 + liveFieldStrength * 0.50)
                 + fieldFringe * (0.025 + liveFieldStrength * 0.11);
  var paletteMix = clamp01(0.10 + cellHash2 * 0.18
                          + grain * (0.48 + 0.18 * cellHash)
                          + poleCore * 0.14);

  if (fixtureType == FIX_BAR_18) {
    // Hull Canvas is the primary bed of crisp, isolated filings.
    brightness = floorLevel + grain * (0.52 + liveFieldStrength * 0.60)
               + fieldFringe * (0.02 + liveFieldStrength * 0.08)
               + lobeBand * grain * 0.18;
  } else if (fixtureType == FIX_RAW_LED) {
    // Silhouette reads the dipole fringe at distance while retaining sparse
    // sharp filings rather than becoming a continuous outline wash.
    brightness = floorLevel + 0.045
               + grain * (0.62 + liveFieldStrength * 0.56)
               + fieldFringe * (0.07 + liveFieldStrength * 0.18)
               + lobeBand * grain * 0.24;
    paletteMix = clamp01(0.08 + grain * 0.76 + fieldFringe * 0.18);
  } else if (fixtureType == FIX_VINTAGE_6) {
    // Jewelry is palette RGB only. Its finite filings are more legible but
    // there is intentionally no independent sparkle or native-white emitter.
    var jewelryFiling = max(grain, smooth01(1.0
                            - abs(alongGrain) / (halfLength * 1.28))
                            * smooth01(1.0
                            - abs(acrossGrain) / (halfWidth * 1.45)));
    brightness = floorLevel * 0.82 + 0.045
               + jewelryFiling * (0.30 + liveFieldStrength * 0.56)
               + fieldFringe * 0.08;
    paletteMix = clamp01(0.38 + jewelryFiling * 0.50);
  } else if (fixtureType == FIX_PAR) {
    // Organs are the two magnetic poles. Their independent control changes
    // both pole prominence and contrast without altering the protected floor.
    // The exported value is safe to read directly: this is a light envelope,
    // not a moving boundary, and immediate response is essential for a useful
    // physical Organ-level control. Geometry controls remain smoothed above.
    var organSide = fieldX < 0.0 ? 0.0 : 1.0;
    brightness = floorLevel + 0.10 + clamp01(organPoles) * 0.22
               + poleCore * (0.38 + clamp01(organPoles) * 1.08)
               + fieldFringe * (0.08 + clamp01(organPoles) * 0.12)
               + grain * 0.24;
    paletteMix = clamp01(0.08 + organSide * 0.76
                        + poleCore * 0.10 + grain * 0.06);
  } else if (isSign) {
    // Paired magnetic cards carry the same field curve and sparse filings,
    // above a firm identity floor so neither TE letter surface becomes static.
    brightness = max(0.28, floorLevel + 0.12
                   + grain * (0.44 + liveFieldStrength * 0.56)
                   + fieldFringe * (0.07 + liveFieldStrength * 0.16)
                   + lobeBand * grain * 0.22 + poleCore * 0.58);
    paletteMix = clamp01(0.10 + grain * 0.70
                        + fieldFringe * 0.14 + poleCore * 0.12);
  }

  // Preserve sharp, playa-readable filing cores after the physically weaker
  // wide-pole attenuation below. This adds light only where the sparse finite
  // dash already exists, so the surrounding field stays quiet and spacious.
  brightness += grain * (0.18 + liveFieldStrength * 0.42);
  if (fixtureType == FIX_PAR) {
    brightness += poleCore * clamp01(organPoles) * 0.42;
  }

  // Increasing pole separation weakens the field across the fixed vessel.
  // This physical attenuation also makes Pole Gap's magnitude semantics
  // measurable while the protected safety floor remains independent.
  var gapAttenuation = 1.0 - clamp01(livePoleGap) * 0.72;
  brightness = floorLevel + (brightness - floorLevel) * gapAttenuation;

  brightness = clamp01(brightness);
  paletteMix = clamp01(paletteMix);
  var outR = (pr1 + (pr2 - pr1) * paletteMix) * brightness;
  var outG = (pg1 + (pg2 - pg1) * paletteMix) * brightness;
  var outB = (pb1 + (pb2 - pb1) * paletteMix) * brightness;
  rgbwau(clamp01(outR), clamp01(outG), clamp01(outB), 0.0, 0.0, 0.0);
}
