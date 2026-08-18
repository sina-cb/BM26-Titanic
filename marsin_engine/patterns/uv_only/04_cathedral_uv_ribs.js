/*
  04_cathedral_uv_ribs.js — "Cathedral UV Ribs"  [UV ONLY family — wave _313]

  DERIVED FROM: patterns/126_cathedral_rib_wave.js. Skeleton kept: five to
  seven continuous vertical rib planes marching along X via a sine-distance
  field, a slow bow that offsets each plane's phase by height/depth rather
  than reindexing, and a vault arch plus flying-buttress lift that reaches
  the outer hull instead of a center-only halo.
  IDENTITY (50 ft): bowed violet ribs march along the hull like a cathedral
  nave lit in blacklight.

  TEXTURE: the un-ribbed hull rests at a 0.19-0.26 violet keep; the rib
  bodies and vault band carry a 0.36-0.60 mid field; the vault crown and
  buttress crests peak at 0.86-1.00, with real but sparing area.
  SPEED: authored to global 25 / local 0.30, direction 0.75 (rate factor
  0.4225) — one full rib procession ~= 24 s on the rig at the reference
  point.
  RUNAWAY (g=4.0 -> dt clamps at 0.1 s/frame; local 1.0 = 2.0x base, full
  direction = 1.0x sign): fastest clock is the rib procession at 0.0986 x
  2.0 x 1.0 = 0.1972 cycles/s — far below the 10/s alias bar. Max per-frame
  clock jump 0.1 x 0.1972 = 0.01972 against PHASE_WRAP 4096 — wraps safe by
  five orders of magnitude.
  CONTROLS (declaration order = MFT knob order): localSpeed — procession
  rate; direction — signed procession direction; ribCount — five to seven
  ribs; ribWidth — thickness of each rib plane; bow — how far ribs bow with
  height/depth; level — overall UV intensity.

  AUDIO_MODULATION_V1:
    sliderLevel <- micLow  range 0.35..1.00 curve linear # overall UV intensity (PRIMARY)
    sliderBow   <- micFlux range 0.22..0.88 curve ease   # ribs bow deeper on builds
    # STATIC (omit from audio): localSpeed, direction, ribCount, ribWidth
*/

export var localSpeed = 0.30;
export var direction = 0.75;
export var ribCount = 0.50;
export var ribWidth = 0.50;
export var bow = 0.48;
export var level = 0.70;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderDirection(v) {
  direction = v;
  var dv = v * 2.0 - 1.0;
  if (dv >= 0.0 && dv < 0.06) dv = 0.06;
  else if (dv < 0.0 && dv > -0.06) dv = -0.06;
  ribDirection = dv;
}
export function sliderRibCount(v) { ribCount = v; }
export function sliderRibWidth(v) { ribWidth = v; }
export function sliderBow(v) { bow = v; }
export function sliderLevel(v) { level = v; }

// ── UV AUTHORITY (uv_only family block — byte-identical across
//    patterns/uv_only/*; hash-gated by uv_only_contract.test.js) ──
// The family renders UV ONLY: violet-intensity art on the fixtures that
// physically carry a U emitter — the Hull Canvas ShehdsBars (FIX_BAR_18)
// and the Organ UkingPars (FIX_PAR). Silhouette strands, Jewelry rails and
// the TE signs have NO violet die, so those pixels are held at exact zero
// and the sim, the gallery and the playa all tell the same truth (house
// convention from patterns/65_uv_only.js). R = G = B = W = A = 0 on every
// pixel of every frame, and NO colorPalette exports — untintable by design.
function clamp01(v) {
  if (v < 0.0) return 0.0;
  if (v > 1.0) return 1.0;
  return v;
}
function smooth01(v) {
  var sv = clamp01(v);
  return sv * sv * (3.0 - 2.0 * sv);
}
function emitUv(uvLevel) {
  var uLane = clamp01(uvLevel);
  if (fixtureType != FIX_BAR_18 && fixtureType != FIX_PAR) uLane = 0.0;
  rgbwau(0.0, 0.0, 0.0, 0.0, 0.0, uLane);
}
// ── end UV AUTHORITY ──

var PHASE_WRAP = 4096.0;

var ribClock = 0.0;
var vaultClock = 0.21;
var ribDirection = 0.50;

var liveRibCount = 0.50;
var liveRibWidth = 0.50;
var liveBow = 0.48;
var liveLevel = 0.70;

var resolvedCount = 6.0;
var resolvedWidth = 0.10;

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;
  var speedScale = 0.35 + clamp01(localSpeed) * 1.65;

  var shapeFollow = min(1.0, dt * 4.2);
  var lightFollow = min(1.0, dt * 9.0);
  liveRibCount += (clamp01(ribCount) - liveRibCount) * shapeFollow;
  liveRibWidth += (clamp01(ribWidth) - liveRibWidth) * shapeFollow;
  liveBow += (clamp01(bow) - liveBow) * shapeFollow;
  liveLevel += (clamp01(level) - liveLevel) * lightFollow;

  // One full procession ~= 24 s at the reference point: 1/(24 x 0.4225) = 0.0986.
  ribClock += dt * 0.0986 * speedScale * ribDirection;
  if (ribClock >= PHASE_WRAP) ribClock -= PHASE_WRAP;
  if (ribClock < 0.0) ribClock += PHASE_WRAP;
  // Independent unidirectional vault texture; never reverses with direction.
  vaultClock += dt * 0.0366 * speedScale;
  if (vaultClock >= PHASE_WRAP) vaultClock -= PHASE_WRAP;

  resolvedCount = 5.0 + liveRibCount * 2.0;
  resolvedWidth = 0.075 + liveRibWidth * 0.175;
}

export function render3D(index, x, y, z) {
  var nx = clamp01(x);
  var ny = clamp01(y);
  var nz = clamp01(z);
  var dx = nx - 0.5;
  var dz = nz - 0.5;

  var span = abs(dz) * 2.0;
  var endSpan = abs(dx) * 2.0;
  var perimeter = smooth01(max(span, endSpan));
  var vaultDrift = sin((ribClock * 0.44 + nx * 0.23 + span * 0.19) * PI2) * 0.035;
  var vaultArch = 0.18 + 0.62 * sqrt(max(0.0, 1.0 - span * span)) + vaultDrift;
  vaultArch = clamp01(vaultArch);

  var sequence = wave(ribClock - nx * 0.71 + span * 0.17 + ny * 0.09);
  var opening = (0.035 + liveBow * 0.205) * (sequence * 2.0 - 1.0);
  var heightBow = (ny - 0.5) * (ny - 0.5) * opening * 1.65;
  var depthBow = sin((ny * 0.72 + vaultClock) * PI2) * opening * (0.56 + 0.44 * span);
  var ribTravel = sin((ribClock * 0.73 + span * 0.19) * PI2) * (0.022 + liveBow * 0.040);

  var ribPhase = (nx + heightBow + depthBow + ribTravel) * resolvedCount;
  var planeDistance = abs(sin(ribPhase * PI));
  var plane = smooth01(1.0 - planeDistance / resolvedWidth);

  var vaultDistance = abs(ny - vaultArch);
  var vaultBand = smooth01(1.0 - vaultDistance / (0.11 + resolvedWidth * 0.72));
  var pillar = smooth01((vaultArch + 0.10 - ny) / 0.24);
  var buttressFalloff = smooth01(1.0 - abs(ny - (0.24 + span * 0.34)) / (0.22 + resolvedWidth));
  var buttress = perimeter * buttressFalloff;

  var rib = plane * (0.42 + pillar * 0.24 + vaultBand * 0.56 + buttress * 0.38);
  rib = clamp01(rib);

  var openingGlow = smooth01(sequence) * (0.22 + liveBow * 0.30);
  var procession = smooth01(wave(ribClock * 0.73 - nx * 0.29 + span * 0.17 + ny * 0.11));
  var aisleSweep = smooth01(wave(vaultClock * 1.618 - nx * 0.31 + span * 0.27));

  var keep = 0.19 + ny * 0.07;
  var lvl = keep;
  lvl = lvl + rib * (0.42 + 0.36 * rib);
  lvl = lvl + plane * openingGlow * 0.56;
  lvl = lvl + plane * perimeter * aisleSweep * 0.38 * (0.6 + procession * 0.4);

  if (fixtureType == FIX_PAR) {
    // Organs: slow lanterns at the moving vault intersections, not the
    // marching rib itself.
    var lantern = smooth01(wave(vaultClock * 1.732 - nx * 0.23 + span * 0.17));
    lvl = keep * 0.88;
    lvl = lvl + lantern * (0.35 + rib * 0.35);
    lvl = lvl + vaultBand * lantern * 0.15;
  }

  var authored = 0.30 + liveLevel * 0.70;
  emitUv(lvl * authored);
}
