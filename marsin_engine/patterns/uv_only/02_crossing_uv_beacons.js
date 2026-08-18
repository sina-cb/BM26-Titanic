/*
  02_crossing_uv_beacons.js — "Crossing UV Beacons"  [UV ONLY family — wave _313]

  DERIVED FROM: patterns/120_crossing_beacons.js. Skeleton kept: two
  antipodal azimuth axes (each throws two opposed rays via a quarter-turn
  fold), counter-rotating on incommensurate clocks, each trailing its own
  directional afterglow, with a crossing control that opens/closes the angle
  between the two fan systems.
  IDENTITY (50 ft): two counter-rotating violet beams cross the four hull
  walls, leaving afterglow trails; the pars flash as a beam sweeps past.

  TEXTURE: the un-swept hull rests at a 0.15-0.22 violet keep; each beam body
  carries a 0.40-0.62 mid field; the crossing overlap and beam cores peak at
  0.88-1.00. Between passes the keep never drops near zero.
  SPEED: authored to global 25 / local 0.30, direction 0.75 (rate factor
  0.4225) — one full beam rotation ~= 18 s on the rig at the reference point.
  RUNAWAY (g=4.0 -> dt clamps at 0.1 s/frame; local 1.0 = 2.0x base, full
  direction = 1.0x sign): fastest clock is beam A at 0.1315 x 2.0 x 1.0 =
  0.263 cycles/s — far below the 10/s alias bar. Max per-frame clock jump
  0.1 x 0.263 = 0.0263 against PHASE_WRAP 4096 — wraps safe by five orders
  of magnitude.
  CONTROLS (declaration order = MFT knob order): localSpeed — rotation rate;
  direction — signed counter-rotation direction; beamWidth — angular width
  of both fan axes; crossing — opens/closes the angle between the two fans;
  afterglow — length of the two directional trails; level — overall UV
  intensity.

  AUDIO_MODULATION_V1:
    sliderLevel    <- micLow  range 0.35..1.00 curve linear # overall UV intensity (PRIMARY)
    sliderCrossing <- micFlux range 0.25..0.85 curve ease   # opens the crossing X on builds
    # STATIC (omit from audio): localSpeed, direction, beamWidth, afterglow
*/

export var localSpeed = 0.30;
export var direction = 0.75;
export var beamWidth = 0.45;
export var crossing = 0.55;
export var afterglow = 0.50;
export var level = 0.70;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderDirection(v) {
  direction = v;
  var dv = v * 2.0 - 1.0;
  if (dv >= 0.0 && dv < 0.06) dv = 0.06;
  else if (dv < 0.0 && dv > -0.06) dv = -0.06;
  spinDirection = dv;
}
export function sliderBeamWidth(v) { beamWidth = v; }
export function sliderCrossing(v) { crossing = v; }
export function sliderAfterglow(v) { afterglow = v; }
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

var spinPhaseA = 0.11;
var spinPhaseB = 0.61;
var glassPhase = 0.23;
var spinDirection = 0.50;

var liveBeamWidth = 0.45;
var liveCrossing = 0.55;
var liveAfterglow = 0.50;
var liveLevel = 0.70;

function axisDistance(angle, axis) {
  var d = angle - axis;
  d = d - floor(d + 0.5);
  d = abs(d);
  if (d > 0.25) d = 0.5 - d;
  return d;
}
function fanProfile(distance, halfWidth) {
  return smooth01(1.0 - distance / (halfWidth + 0.0001));
}

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;
  var speedScale = 0.35 + clamp01(localSpeed) * 1.65;

  var shapeFollow = min(1.0, dt * 4.2);
  var lightFollow = min(1.0, dt * 9.0);
  liveBeamWidth += (clamp01(beamWidth) - liveBeamWidth) * shapeFollow;
  liveCrossing += (clamp01(crossing) - liveCrossing) * shapeFollow;
  liveAfterglow += (clamp01(afterglow) - liveAfterglow) * shapeFollow;
  liveLevel += (clamp01(level) - liveLevel) * lightFollow;

  var signed = speedScale * spinDirection;
  // Full rotation ~= 18 s at the reference point: 1/(18 x 0.4225) = 0.1315.
  spinPhaseA += dt * 0.1315 * signed;
  spinPhaseB -= dt * 0.1034 * signed;
  if (spinPhaseA >= PHASE_WRAP) spinPhaseA -= PHASE_WRAP;
  if (spinPhaseA < 0.0) spinPhaseA += PHASE_WRAP;
  if (spinPhaseB >= PHASE_WRAP) spinPhaseB -= PHASE_WRAP;
  if (spinPhaseB < 0.0) spinPhaseB += PHASE_WRAP;
  // Independent unidirectional glass wobble keeps the crossing from a
  // mechanical repeat; it never reverses with direction.
  glassPhase += dt * 0.0813 * speedScale;
  if (glassPhase >= PHASE_WRAP) glassPhase -= PHASE_WRAP;
}

export function render3D(index, x, y, z) {
  var nx = clamp01(x);
  var ny = clamp01(y);
  var nz = clamp01(z);
  var dx = nx - 0.5;
  var dz = nz - 0.5;
  var angle = atan2(dz, dx) / PI2;
  angle = angle - floor(angle);

  var wobble = 0.020 * sin(glassPhase * PI2);
  var axisA = spinPhaseA - floor(spinPhaseA) + wobble;
  var axisB = spinPhaseB - floor(spinPhaseB);
  axisB = axisB + (liveCrossing - 0.5) * 0.14;
  axisB = axisB - wobble * 0.7;

  var halfWidth = 0.028 + liveBeamWidth * 0.115;
  var fanA = fanProfile(axisDistance(angle, axisA), halfWidth);
  var fanB = fanProfile(axisDistance(angle, axisB), halfWidth);

  var lag = 0.020 + liveAfterglow * 0.095;
  var tailWidth = halfWidth * (1.2 + liveAfterglow * 0.5);
  var tailA = fanProfile(axisDistance(angle, axisA - lag), tailWidth) * liveAfterglow;
  var tailB = fanProfile(axisDistance(angle, axisB + lag), tailWidth) * liveAfterglow;

  var primary = max(fanA, fanB);
  var trail = max(tailA, tailB);
  var overlap = min(fanA, fanB);

  var keep = 0.15 + ny * 0.07;
  var lvl = keep;
  lvl = lvl + primary * (0.52 + 0.34 * primary);
  lvl = lvl + trail * 0.28;
  lvl = lvl + overlap * (0.22 + liveCrossing * 0.30);

  if (fixtureType == FIX_PAR) {
    // Organs: a sharper, per-fixture-phased flash as either beam's core
    // sweeps this station, distinct from the broad wall wash.
    var station = fixtureId * 0.06191 - floor(fixtureId * 0.06191);
    var stationBoost = 1.0 + 0.35 * wave(station * 5.0 + glassPhase);
    var parBeam = pow(primary, 0.62) * stationBoost;
    lvl = keep * 0.88;
    lvl = lvl + parBeam * (0.55 + 0.40 * parBeam);
    lvl = lvl + trail * 0.22;
  }

  var authored = 0.30 + liveLevel * 0.70;
  emitUv(lvl * authored);
}
