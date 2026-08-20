/*
  07_violet_eclipse.js — "Violet Eclipse"  [UV ONLY family — wave _313]

  DERIVED FROM: patterns/125_eclipse_orbit.js. Skeleton kept: one enormous
  soft 3D shadow body orbiting the ship on a single smooth legible orbit, a
  broad luminous annular rim revealing its edge, and a restrained
  mathematical gravity drift moving through the field outside the body.
  IDENTITY (50 ft): a dark eclipse disc orbits across a bright violet
  field, its rim blazing as it passes.

  TEXTURE: even inside the eclipse body the hull rests at a 0.14-0.20
  violet keep (never black); the outer field carries a 0.36-0.60 mid
  field; the annular rim peaks at 0.88-1.00. Field kept bright so darkFrac
  stays well under the 0.35 eclipse ceiling.
  SPEED: authored to global 25 / local 0.30, direction 0.75 (rate factor
  0.4225) — one full orbit ~= 22 s on the rig at the reference point.
  RUNAWAY (g=4.0 -> dt clamps at 0.1 s/frame; local 1.0 = 2.0x base, full
  direction = 1.0x sign): fastest clock is the orbit at 0.1076 x 2.0 x
  1.0 = 0.2152 cycles/s — far below the 10/s alias bar. Max per-frame clock
  jump 0.1 x 0.2152 = 0.02152 against PHASE_WRAP 4096 — wraps safe by five
  orders of magnitude.
  CONTROLS (declaration order = MFT knob order): localSpeed — orbit rate;
  direction — signed orbit direction; eclipseSize — shadow body radius;
  rimWidth — thickness of the annular rim; depth — body's 3D reach and
  orbital Z travel; level — overall UV intensity.

  AUDIO_MODULATION_V1:
    sliderLevel       <- micLow  range 0.35..1.00 curve linear # overall UV intensity (PRIMARY)
    sliderEclipseSize <- micFlux range 0.26..0.86 curve linear # builds enlarge the shadow body
    # STATIC (omit from audio): localSpeed, direction, rimWidth, depth
*/

export var localSpeed = 0.30;
export var direction = 0.75;
export var eclipseSize = 0.50;
export var rimWidth = 0.52;
export var depth = 0.55;
export var level = 0.70;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderDirection(v) {
  direction = v;
  var dv = v * 2.0 - 1.0;
  if (dv >= 0.0 && dv < 0.06) dv = 0.06;
  else if (dv < 0.0 && dv > -0.06) dv = -0.06;
  orbitDirection = dv;
}
export function sliderEclipseSize(v) { eclipseSize = v; }
export function sliderRimWidth(v) { rimWidth = v; }
export function sliderDepth(v) { depth = v; }
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

var orbitPhase = 0.0;
var fieldPhaseA = 0.0;
var fieldPhaseB = 0.37;
var orbitDirection = 0.50;

var liveSize = 0.50;
var liveRimWidth = 0.52;
var liveDepth = 0.55;
var liveLevel = 0.70;

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;
  var speedScale = 0.35 + clamp01(localSpeed) * 1.65;

  var shapeFollow = min(1.0, dt * 4.2);
  var lightFollow = min(1.0, dt * 9.0);
  liveSize += (clamp01(eclipseSize) - liveSize) * shapeFollow;
  liveRimWidth += (clamp01(rimWidth) - liveRimWidth) * shapeFollow;
  liveDepth += (clamp01(depth) - liveDepth) * shapeFollow;
  liveLevel += (clamp01(level) - liveLevel) * lightFollow;

  // One full orbit ~= 22 s at the reference point: 1/(22 x 0.4225) = 0.1076.
  orbitPhase += dt * 0.1076 * speedScale * orbitDirection;
  if (orbitPhase >= PHASE_WRAP) orbitPhase -= PHASE_WRAP;
  if (orbitPhase < 0.0) orbitPhase += PHASE_WRAP;
  // Independent unidirectional gravity-drift texture; never reverses.
  fieldPhaseA += dt * 0.0901 * speedScale;
  fieldPhaseB -= dt * 0.0557 * speedScale;
  if (fieldPhaseA >= PHASE_WRAP) fieldPhaseA -= PHASE_WRAP;
  if (fieldPhaseB < 0.0) fieldPhaseB += PHASE_WRAP;
}

export function render3D(index, x, y, z) {
  var nx = clamp01(x);
  var ny = clamp01(y);
  var nz = clamp01(z);

  var theta = orbitPhase * PI2;
  var depthAmount = liveDepth;
  var centerX = 0.50 + cos(theta) * 0.43;
  var centerY = 0.50 + sin(theta) * 0.30;
  var centerZ = 0.50 + sin(theta * 2.0 + 0.73) * (0.06 + depthAmount * 0.36);

  var dx = nx - centerX;
  var dy = ny - centerY;
  var dzScale = 0.55 + depthAmount * 0.75;
  var dz = (nz - centerZ) / dzScale;
  var distance = sqrt(dx * dx + dy * dy + dz * dz);

  var radius = 0.13 + liveSize * 0.35;
  var edgeSoftness = 0.055 + radius * 0.16;
  var outside = smooth01((distance - radius + edgeSoftness) / (edgeSoftness * 2.0));

  var rimSpan = 0.018 + liveRimWidth * 0.145;
  var rimDistance = abs(distance - radius);
  var rim = smooth01(1.0 - rimDistance / rimSpan);
  rim = pow(rim, 1.45);

  var fieldA = wave(nx * 0.78615 + ny * 0.46352 - nz * 0.61803 - fieldPhaseA);
  var fieldB = wave(nx * 0.41421 - ny * 0.73205 + nz * 0.53112 + fieldPhaseB);
  var gravityWalk = smooth01(fieldA * 0.58 + fieldB * 0.42);
  var fieldGain = 0.87 + gravityWalk * 0.27;

  var keep = 0.14 + outside * 0.06;
  var vesselEnergy = outside * fieldGain * (0.30 + 0.30 * outside);
  var rimEnergy = rim * (0.40 + 0.56 * rim);

  var lvl = keep;
  lvl = lvl + vesselEnergy;
  lvl = lvl + rimEnergy;

  if (fixtureType == FIX_PAR) {
    // Organs: a sharp per-fixture transit pulse as the shadow's edge nears
    // this station, distinct from the continuous wall field.
    var idOffset = fixtureId * 0.01873;
    var parPulse = smooth01(wave(idOffset + orbitPhase * 1.30 - distance * 3.0));
    lvl = keep * 0.90;
    lvl = lvl + vesselEnergy * 0.62;
    lvl = lvl + rimEnergy * 1.05;
    lvl = lvl + parPulse * 0.18;
  }

  var authored = 0.30 + liveLevel * 0.70;
  emitUv(lvl * authored);
}
