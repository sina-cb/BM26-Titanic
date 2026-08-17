// DRAFT — pending operator review
/*
  126_cathedral_rib_wave.js — CATHEDRAL RIB WAVE

  Five to seven monumental vertical rib planes pass through the full model.
  A slow opening wave bows each plane in sequence while broad flying-buttress
  light reaches the outer hull, bow, and stern. The installation remains a
  breathing cathedral skeleton visible at distance, never a fine lattice.

  PORTABILITY
    The shared composition uses normalized XYZ plus the portable fixture-role
    ABI; it never depends on a raw id, controller, group, or section number.
    Bars carry wall buttresses, raw strands carry the skyline procession,
    Vintage fixtures carry restrained rib jewels, and pars carry lantern vaults.
    Each TE sign receives the same pixel-local rib-and-vault score. Matching
    sign topology therefore gives exact bilateral energy while retaining
    full-surface motion and legibility. Titanic and test_bench both provide the
    complete authored role set and compile the same work.

  SAFETY FLOOR
    sliderSafetyFloor maps only 0.10..0.20. Every pixel remains on a visible,
    palette-derived bed even while the rib wave is fully closed.

  AUDIO_MODULATION_V1:
    sliderLevel <- micLow  range 0.24..1.00 curve linear # cathedral luminosity
    sliderPulse <- micKick range 0.00..0.90 curve pow2   # whole-rib vault bloom
    sliderBow   <- micFlux range 0.22..0.88 curve ease   # ribs open on builds
  # STATIC: localSpeed, ribCount, ribWidth, safetyFloor, colorPalette1/2
*/

// Declaration order is physical MIDI order. Local Speed is always first.
export var localSpeed = 0.30;
export var level = 0.62;
export var ribCount = 0.50;
export var ribWidth = 0.52;
export var bow = 0.48;
export var safetyFloor = 0.50;
export var pulse = 0.00;

export var cp1H = 0.62, cp1S = 0.88, cp1V = 1.0;
export var cp2H = 0.10, cp2S = 0.48, cp2V = 1.0;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderLevel(v) { level = v; }
export function sliderRibCount(v) { ribCount = v; }
export function sliderRibWidth(v) { ribWidth = v; }
export function sliderBow(v) { bow = v; }
export function sliderSafetyFloor(v) { safetyFloor = v; }
export function sliderPulse(v) { pulse = v; }

// Stable fixture-capability ids from the canonical append-only registry.
var FIX_RAW_LED = 1;
var FIX_PAR = 2;
var FIX_VINTAGE_6 = 3;
var FIX_BAR_18 = 4;
var FIX_TE_SIGN = 7;

var PHASE_WRAP = 10000.0;
var openingClock = 0.0;
var vaultClock = 0.23;

var liveSpeed = 0.30;
var liveLevel = 0.62;
var liveCount = 0.50;
var liveWidth = 0.52;
var liveBow = 0.48;
var liveFloor = 0.50;
var livePulse = 0.00;

var resolvedCount = 6.0;
var resolvedWidth = 0.10;
var resolvedFloor = 0.15;

var pr1 = 1.0, pg1 = 0.0, pb1 = 0.0;
var pr2 = 0.0, pg2 = 1.0, pb2 = 1.0;

function clamp01(v) {
  if (v < 0.0) return 0.0;
  if (v > 1.0) return 1.0;
  return v;
}

function smoothUnit(v) {
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
  else if (iv == 4) { pr2 = tv;   pg2 = pv;   pb2 = cp2V; }
  else              { pr2 = cp2V; pg2 = pv;   pb2 = qv;   }
}

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  _hsv2rgb1();
  _hsv2rgb2();

  // Geometry controls ease into their new values so live edits bend the
  // cathedral instead of tearing it between frames. Pulse stays responsive.
  var geometryFollow = clamp01(dt * 3.2);
  var levelFollow = clamp01(dt * 10.0);
  var pulseFollow = clamp01(dt * 18.0);
  liveSpeed = liveSpeed + (clamp01(localSpeed) - liveSpeed) * geometryFollow;
  liveLevel = liveLevel + (clamp01(level) - liveLevel) * levelFollow;
  liveCount = liveCount + (clamp01(ribCount) - liveCount) * geometryFollow;
  liveWidth = liveWidth + (clamp01(ribWidth) - liveWidth) * geometryFollow;
  liveBow = liveBow + (clamp01(bow) - liveBow) * geometryFollow;
  liveFloor = liveFloor
            + (clamp01(safetyFloor) - liveFloor) * levelFollow;
  livePulse = livePulse + (clamp01(pulse) - livePulse) * pulseFollow;

  var rate = 0.018 + 0.13 * pow(2.0, (liveSpeed - 0.5) * 4.0);
  openingClock = openingClock + dt * rate;
  vaultClock = vaultClock + dt * rate * 0.371;
  if (openingClock >= PHASE_WRAP) openingClock -= PHASE_WRAP;
  if (vaultClock >= PHASE_WRAP) vaultClock -= PHASE_WRAP;

  resolvedCount = 5.0 + liveCount * 2.0;
  resolvedWidth = 0.035 + liveWidth * 0.115;
  resolvedFloor = 0.10 + liveFloor * 0.10;
}

export function render3D(index, x, y, z) {
  var nx = clamp01(x);
  var ny = clamp01(y);
  var nz = clamp01(z);
  var dx = nx - 0.5;
  var dz = nz - 0.5;

  // The upper vault is a single monumental arch. A small longitudinal drift
  // keeps its crown alive across the entire model without breaking its scale.
  var span = abs(dz) * 2.0;
  var endSpan = abs(dx) * 2.0;
  var perimeter = smoothUnit(max(span, endSpan));
  var vaultDrift = sin((openingClock * 0.44 + nx * 0.23
                     + span * 0.19) * PI2) * 0.035;
  var vaultArch = 0.18
                + 0.62 * sqrt(max(0.0, 1.0 - span * span))
                + vaultDrift;
  vaultArch = clamp01(vaultArch);

  // The opening procession reaches the side aisles as well as the nave. Its
  // depth offset prevents the whole ship from breathing as one repeated field.
  var sequence = wave(openingClock - nx * 0.71
                    + span * 0.17 + ny * 0.09);
  var opening = (0.035 + liveBow * 0.205) * (sequence * 2.0 - 1.0);
  var heightBow = (ny - 0.5) * (ny - 0.5) * opening * 1.65;
  var depthBow = sin((ny * 0.72 + vaultClock) * PI2)
               * opening * (0.56 + 0.44 * span);
  var ribTravel = sin((openingClock * 0.73 + span * 0.19) * PI2)
                * (0.022 + liveBow * 0.040);

  // A sine distance creates five to seven continuous rib planes. Bow shifts
  // their phase according to height/depth; there is no discrete reindex seam.
  var ribPhase = (nx + heightBow + depthBow + ribTravel) * resolvedCount;
  var planeDistance = abs(sin(ribPhase * PI));
  var plane = smoothUnit(1.0 - planeDistance / resolvedWidth);

  // Ribs stay strongest at the vault but the flying-buttress lift deliberately
  // energizes the model perimeter, so the cathedral is not a center-only halo.
  var vaultDistance = abs(ny - vaultArch);
  var vaultBand = smoothUnit(1.0 - vaultDistance / (0.11 + resolvedWidth * 0.72));
  var pillar = smoothUnit((vaultArch + 0.10 - ny) / 0.24);
  var buttress = perimeter
               * smoothUnit(1.0 - abs(ny - (0.24 + span * 0.34))
                                      / (0.22 + resolvedWidth));
  var rib = plane * (0.42 + pillar * 0.24
                    + vaultBand * 0.56 + buttress * 0.38);
  rib = clamp01(rib);

  // A wide, incommensurate procession binds neighboring ribs. The outer-aisle
  // term is restrained but visibly moves through bow, stern, and both sides.
  var openingGlow = smoothUnit(sequence) * (0.22 + liveBow * 0.30);
  var procession = smoothUnit(wave(openingClock * 0.73 - nx * 0.29
                                 + span * 0.17 + ny * 0.11));
  var aisleSweep = smoothUnit(wave(vaultClock * 1.618
                                 - nx * 0.31 + span * 0.27));
  var cathedralEnergy = rib * (0.80 + procession * 0.44)
                      + plane * openingGlow * 0.40
                      + plane * perimeter * aisleSweep * 0.30;
  var authored = liveLevel * 0.10
               + cathedralEnergy * (0.08 + liveLevel * 1.24)
               + rib * livePulse * 0.48;
  authored = min(0.92, clamp01(authored));
  var bri = resolvedFloor + (1.0 - resolvedFloor) * authored;

  var paletteMix = clamp01(0.12 + vaultBand * 0.50
                          + sequence * 0.16 + buttress * 0.16
                          + livePulse * rib * 0.10);

  if (fixtureType == FIX_BAR_18) {
    // Hull Canvas: broad wall buttresses make the wooden surface carry the
    // architecture. Only the moving planes are lifted; the dark bed stays calm.
    var wallPlane = smoothUnit(1.0 - planeDistance
                                    / (resolvedWidth * 2.20));
    var wallLift = wallPlane * (0.14 + buttress * 0.28
                              + openingGlow * 0.10);
    bri = min(0.94, bri + wallLift * 1.20);
    paletteMix = clamp01(paletteMix + buttress * 0.08);
  } else if (fixtureType == FIX_RAW_LED) {
    // Silhouette: an index-coherent procession walks the rope outline so the
    // vessel remains readable even while XYZ ribs bend through it.
    var outlineProcession = smoothUnit(wave(openingClock * 0.618
                                          - pixelLocalIndex * 0.013
                                          + ny * 0.17));
    var outlineLift = plane * (0.10 + outlineProcession * 0.18)
                    + rib * 0.08;
    bri = min(0.94, bri + (1.0 - bri) * outlineLift);
    paletteMix = clamp01(paletteMix + outlineProcession * 0.08);
  } else if (fixtureType == FIX_VINTAGE_6) {
    // Jewelry: restrained six-head rib jewels answer the traveling planes.
    // They stay palette-derived and architectural, never sparkle confetti.
    var jewelProcession = smoothUnit(wave(vaultClock * 1.414
                                        + pixelLocalIndex * 0.071
                                        - nx * 0.19));
    var jewelLift = plane * (0.12 + jewelProcession * 0.22)
                  + rib * jewelProcession * 0.10;
    bri = min(0.95, bri + (1.0 - bri) * jewelLift);
    paletteMix = clamp01(paletteMix + jewelProcession * 0.12);
  } else if (fixtureType == FIX_PAR) {
    // Organs: pars become slow lanterns at the moving vault intersections.
    var lantern = smoothUnit(wave(vaultClock * 1.732
                                - nx * 0.23 + span * 0.17));
    var lanternLift = plane * (0.14 + lantern * 0.24)
                    + vaultBand * lantern * 0.12;
    bri = min(0.95, bri + (1.0 - bri) * lanternLift);
    paletteMix = clamp01(paletteMix + lantern * 0.14);
  } else if (fixtureType == FIX_TE_SIGN) {
    // Both 74-pixel signs share the same two-fixture local topology. Using
    // pixelLocalIndex alone makes their output exactly symmetric while a wide
    // vault and narrower ribs travel across every letter stroke. The explicit
    // floor preserves the wordmark instead of letting animation erase it.
    var signPosition = pixelLocalIndex * 0.025;
    var signPlaneDistance = abs(sin((signPosition * resolvedCount
                                  + openingClock * 0.44) * PI));
    var signRib = smoothUnit(1.0 - signPlaneDistance
                                  / (0.15 + resolvedWidth * 0.65));
    var signVault = smoothUnit(wave(vaultClock * 0.73
                                  - signPosition * 0.62));
    var signProcession = smoothUnit(wave(openingClock * 0.37
                                       + signPosition * 0.23));
    var signFloor = min(0.36, resolvedFloor + 0.11);
    var signEnergy = 0.08 + signRib * (0.32 + liveLevel * 0.42)
                   + signVault * 0.20
                   + signRib * signProcession * 0.18
                   + signRib * livePulse * 0.34;
    bri = signFloor + (1.0 - signFloor) * clamp01(signEnergy);
    paletteMix = clamp01(0.24 + signVault * 0.38
                        + signProcession * 0.20 + signRib * 0.12);
  }

  // All visible light is strict cp1<->cp2 RGB. Native white and amber remain
  // identical zeros on every fixture and model.
  var r = (pr1 + (pr2 - pr1) * paletteMix) * bri;
  var g = (pg1 + (pg2 - pg1) * paletteMix) * bri;
  var b = (pb1 + (pb2 - pb1) * paletteMix) * bri;
  rgbwau(clamp01(r), clamp01(g), clamp01(b), 0.0, 0.0, 0.0);
}
