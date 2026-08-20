/*
  09_rib_vault.js — "Rib Vault"  [WHITE ONLY family — wave _312]

  DERIVED FROM: patterns/126_cathedral_rib_wave.js. Skeleton kept: an
  analytic vault arch traces across normalized Y while a slow bow-phase
  offsets a five-to-seven-plane sine-distance rib field through X; the same
  vault/pillar/buttress terms shape rib strength, and each fixture role
  keeps its own procession/jewel/lantern accent. TE signs share one
  pixel-local rib-and-vault score.
  IDENTITY (50 ft): bowed cathedral ribs travel the hull as bright white
  arcs over a stone-gray vault.

  TEXTURE: the open bay between ribs rests at a 0.10 shadow; the cathedral
  energy field (vault glow, aisle sweep, procession) carries the 0.30-0.55
  mid body; the traveling rib planes and vault band carry the 0.85-1.0
  crisp peaks.
  SPEED: authored to global 25 / local 0.30 (rate factor 0.4225) — one full
  opening procession ~= 14 s on the rig at the reference point
  (1/(14 x 0.4225) = 0.169).
  RUNAWAY (g=4.0, local 1.0 = 8x base): fastest term is the opening clock at
  0.169 x 8 = 1.35 cycles/s (vaultClock trails at 0.371x that); both are far
  below the 10/s alias bar. Max per-frame clock jump 0.1 x 0.169 x 2.0 =
  0.034 against PHASE_WRAP 4096 — wraps safe by many orders of magnitude.
  CONTROLS (declaration order = MFT knob order): localSpeed — procession
  rate; ribCount — five to seven rib planes; ribWidth — rib plane
  thickness; bow — depth of the opening/bowing motion; level — overall
  intensity with a visible floor.
*/

export var localSpeed = 0.30;
export var ribCount = 0.50;
export var ribWidth = 0.52;
export var bow = 0.48;
export var level = 0.68;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderRibCount(v) { ribCount = v; }
export function sliderRibWidth(v) { ribWidth = v; }
export function sliderBow(v) { bow = v; }
export function sliderLevel(v) { level = v; }

// ── WHITE AUTHORITY (white_only family block — byte-identical across
//    patterns/white_only/*; hash-gated by white_only_contract.test.js) ──
// The family renders WHITE ONLY, as grayscale intensity art:
//   zero chroma (R = G = B exactly, every pixel, every frame); native white
//   W = A matched; UV = 0 always; and NO colorPalette exports, so the family
//   is untintable by design (house convention from patterns/60_white_wash.js).
var WHITE_RGB_SHARE = 0.88;
var WHITE_NATIVE_SHARE = 0.62;
function clamp01(v) {
  if (v < 0.0) return 0.0;
  if (v > 1.0) return 1.0;
  return v;
}
function smooth01(v) {
  var sv = clamp01(v);
  return sv * sv * (3.0 - 2.0 * sv);
}
function emitWhite(level, nativeShare) {
  var lit = clamp01(level);
  var rgb = lit * WHITE_RGB_SHARE;
  var nat = clamp01(lit * WHITE_NATIVE_SHARE * clamp01(nativeShare));
  rgbwau(rgb, rgb, rgb, nat, nat, 0.0);
}
// ── end WHITE AUTHORITY ──

var PHASE_WRAP = 4096.0;

var openingClock = 0.0;
var vaultClock = 0.23;

var liveCount = 0.50;
var liveWidth = 0.52;
var liveBow = 0.48;
var liveLevel = 0.68;

var resolvedCount = 6.0;
var resolvedWidth = 0.10;

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;
  var speedScale = 0.35 + clamp01(localSpeed) * 1.65;

  var geometryFollow = clamp01(dt * 3.2);
  var levelFollow = clamp01(dt * 10.0);
  liveCount += (clamp01(ribCount) - liveCount) * geometryFollow;
  liveWidth += (clamp01(ribWidth) - liveWidth) * geometryFollow;
  liveBow += (clamp01(bow) - liveBow) * geometryFollow;
  liveLevel += (clamp01(level) - liveLevel) * levelFollow;

  // One opening procession ~= 14 s at the reference point: 1/(14 x 0.4225)
  // = 0.169.
  var openingRate = 0.169 * speedScale;
  openingClock += dt * openingRate;
  vaultClock += dt * openingRate * 0.371;
  if (openingClock >= PHASE_WRAP) openingClock -= PHASE_WRAP;
  if (vaultClock >= PHASE_WRAP) vaultClock -= PHASE_WRAP;

  resolvedCount = 5.0 + liveCount * 2.0;
  resolvedWidth = 0.075 + liveWidth * 0.185;
}

export function render3D(index, x, y, z) {
  var ux = clamp01(x);
  var uy = clamp01(y);
  var uz = clamp01(z);
  var isSign = fixtureType == FIX_TE_SIGN;

  if (isSign) {
    // The physical sign is split across two fixtures. Fold the global index
    // across the full 74-pixel object so both signs stay byte-identical.
    var signIndex = index % 74.0;
    ux = (signIndex % 10.0) / 9.0;
    uy = floor(signIndex / 10.0) / 7.0;
    uz = 0.44 + ux * 0.12;
  }

  var dx = ux - 0.5;
  var dz = uz - 0.5;

  // The upper vault is a single monumental arch with a small longitudinal
  // drift keeping its crown alive across the whole model.
  var span = abs(dz) * 2.0;
  var endSpan = abs(dx) * 2.0;
  var perimeter = smooth01(max(span, endSpan));
  var vaultDrift = sin((openingClock * 0.44 + ux * 0.23 + span * 0.19) * PI2)
                  * 0.035;
  var vaultArch = 0.18;
  vaultArch = vaultArch + 0.62 * sqrt(max(0.0, 1.0 - span * span));
  vaultArch = vaultArch + vaultDrift;
  vaultArch = clamp01(vaultArch);

  // The opening procession reaches the aisles as well as the nave.
  var sequence = wave(openingClock - ux * 0.71 + span * 0.17 + uy * 0.09);
  var opening = (0.035 + liveBow * 0.205) * (sequence * 2.0 - 1.0);
  var heightBow = (uy - 0.5) * (uy - 0.5) * opening * 1.65;
  var depthBow = sin((uy * 0.72 + vaultClock) * PI2)
               * opening * (0.56 + 0.44 * span);
  var ribTravel = sin((openingClock * 0.73 + span * 0.19) * PI2)
                * (0.022 + liveBow * 0.040);

  // A sine distance creates five to seven continuous rib planes.
  var ribAxis = ux;
  ribAxis = ribAxis + heightBow;
  ribAxis = ribAxis + depthBow;
  ribAxis = ribAxis + ribTravel;
  var ribPhase = ribAxis * resolvedCount;
  var planeDistance = abs(sin(ribPhase * PI));
  var plane = smooth01(1.0 - planeDistance / resolvedWidth);

  // Ribs stay strongest at the vault; flying-buttress lift energizes the
  // perimeter so the cathedral is not a center-only halo.
  var vaultDistance = abs(uy - vaultArch);
  var vaultBand = smooth01(1.0 - vaultDistance / (0.11 + resolvedWidth * 0.72));
  var pillar = smooth01((vaultArch + 0.10 - uy) / 0.24);
  var buttress = perimeter
               * smooth01(1.0 - abs(uy - (0.24 + span * 0.34))
                                     / (0.22 + resolvedWidth));
  var rib = 0.42;
  rib = rib + pillar * 0.24;
  rib = rib + vaultBand * 0.56;
  rib = rib + buttress * 0.38;
  rib = plane * rib;
  rib = clamp01(rib);

  var openingGlow = smooth01(sequence) * (0.22 + liveBow * 0.30);
  var procession = smooth01(wave(openingClock * 0.73 - ux * 0.29 + span * 0.17 + uy * 0.11));
  var aisleSweep = smooth01(wave(vaultClock * 1.618 - ux * 0.31 + span * 0.27));
  var cathedralEnergy = rib * (0.80 + procession * 0.44);
  cathedralEnergy = cathedralEnergy + plane * openingGlow * 0.40;
  cathedralEnergy = cathedralEnergy + plane * perimeter * aisleSweep * 0.30;
  cathedralEnergy = clamp01(cathedralEnergy);

  var shadow = 0.10;
  var midBody = cathedralEnergy * 0.42;
  var peakAcc = rib * 1.90;
  peakAcc = peakAcc + vaultBand * 1.05;

  var lvl = shadow + midBody;
  lvl = lvl + peakAcc;
  var nativeShare = 0.18 + rib * 0.55;

  if (fixtureType == FIX_BAR_18) {
    // Hull Canvas: broad wall buttresses make the wooden surface carry the
    // architecture. Only the moving planes are lifted.
    var wallPlane = smooth01(1.0 - planeDistance / (resolvedWidth * 2.20));
    var wallLift = wallPlane * (0.14 + buttress * 0.28 + openingGlow * 0.10);
    lvl = lvl + wallLift * 0.55;
    nativeShare = nativeShare + wallPlane * 0.10;
  } else if (fixtureType == FIX_RAW_LED) {
    // Silhouette: an index-coherent procession walks the outline.
    var outlineProcession = smooth01(wave(openingClock * 0.618 - pixelLocalIndex * 0.013 + uy * 0.17));
    var outlineLift = plane * (0.10 + outlineProcession * 0.18);
    outlineLift = outlineLift + rib * 0.08;
    lvl = 0.16 + outlineLift * 0.7;
    lvl = lvl + rib * 0.30;
    nativeShare = 0.20 + outlineProcession * 0.40;
  } else if (fixtureType == FIX_VINTAGE_6) {
    // Jewelry: restrained six-head rib jewels answer the traveling planes.
    var jewelProcession = smooth01(wave(vaultClock * 1.414 + pixelLocalIndex * 0.071 - ux * 0.19));
    var jewelLift = plane * (0.12 + jewelProcession * 0.22);
    jewelLift = jewelLift + rib * jewelProcession * 0.10;
    lvl = 0.10 + jewelLift;
    nativeShare = 0.25 + jewelProcession * 0.65;
  } else if (fixtureType == FIX_PAR) {
    // Organs: pars become slow lanterns at the moving vault intersections.
    var lantern = smooth01(wave(vaultClock * 1.732 - ux * 0.23 + span * 0.17));
    var lanternLift = plane * (0.14 + lantern * 0.24);
    lanternLift = lanternLift + vaultBand * lantern * 0.12;
    lvl = 0.12 + lanternLift * 0.8;
    nativeShare = 0.20 + lantern * 0.35;
  } else if (isSign) {
    // Both signs share the same two-fixture local topology.
    var signPosition = pixelLocalIndex * 0.025;
    var signPlaneDistance = abs(sin((signPosition * resolvedCount + openingClock * 0.44) * PI));
    var signRib = smooth01(1.0 - signPlaneDistance
                                  / (0.15 + resolvedWidth * 0.65));
    var signVault = smooth01(wave(vaultClock * 0.73 - signPosition * 0.62));
    var signProcession = smooth01(wave(openingClock * 0.37 + signPosition * 0.23));
    var signMid = signVault * 0.20;
    signMid = signMid + signRib * signProcession * 0.18;
    var signPeak = signRib * 0.55;
    lvl = 0.28 + signMid;
    lvl = lvl + signPeak;
    nativeShare = 0.25 + signRib * 0.55;
  }

  var authored = 0.35 + liveLevel * 0.65;
  emitWhite(lvl * authored, nativeShare);
}
