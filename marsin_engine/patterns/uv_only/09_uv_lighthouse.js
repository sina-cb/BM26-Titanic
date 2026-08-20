/*
  09_uv_lighthouse.js — "UV Lighthouse"  [UV ONLY family — wave _313]

  DERIVED FROM: patterns/58_lighthouse_solo.js. Skeleton kept: one crisp
  high-definition beam finds its azimuth around the ship center via atan2
  and sweeps continuously, brightness and width tied to a tightened core
  profile, with a guaranteed non-zero night field so the rig never blacks
  out between passes.
  IDENTITY (50 ft): a single violet lighthouse beam sweeps the ship,
  punctuated by a slow automatic double-flash.

  TEXTURE: the un-swept night field rests at a 0.14-0.23 violet keep; the
  beam's tapering edge carries a 0.36-0.60 mid field; the beam core and
  flash peaks reach 0.88-1.00.
  SPEED: authored to global 25 / local 0.30, direction 0.75 (rate factor
  0.4225) — one full sweep ~= 15 s on the rig at the reference point.
  RUNAWAY (g=4.0 -> dt clamps at 0.1 s/frame; local 1.0 = 2.0x base, full
  direction = 1.0x sign): fastest clock is the sweep at 0.1578 x 2.0 x
  1.0 = 0.3156 cycles/s — far below the 10/s alias bar. Max per-frame
  clock jump 0.1 x 0.3156 = 0.03156 against PHASE_WRAP 4096 — wraps safe
  by five orders of magnitude.
  CONTROLS (declaration order = MFT knob order): localSpeed — sweep rate;
  direction — signed sweep direction; beamWidth — angular half-width of
  the beam; flash — strength of the automatic slow double-flash;
  floorLevel — guaranteed night-field floor; level — overall UV intensity.

  AUDIO_MODULATION_V1:
    sliderLevel <- micLow  range 0.35..1.00 curve linear # overall UV intensity (PRIMARY)
    sliderFlash <- micKick range 0.20..1.00 curve pow2   # kick brightens the double-flash
    # STATIC (omit from audio): localSpeed, direction, beamWidth, floorLevel
*/

export var localSpeed = 0.30;
export var direction = 0.75;
export var beamWidth = 0.45;
export var flash = 0.55;
export var floorLevel = 0.55;
export var level = 0.70;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderDirection(v) {
  direction = v;
  var dv = v * 2.0 - 1.0;
  if (dv >= 0.0 && dv < 0.06) dv = 0.06;
  else if (dv < 0.0 && dv > -0.06) dv = -0.06;
  sweepDirection = dv;
}
export function sliderBeamWidth(v) { beamWidth = v; }
export function sliderFlash(v) { flash = v; }
export function sliderFloorLevel(v) { floorLevel = v; }
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

var beamPhase = 0.0;
var flashClock = 0.0;
var sweepDirection = 0.50;

var liveBeamWidth = 0.45;
var liveFlash = 0.55;
var liveFloorLevel = 0.55;
var liveLevel = 0.70;

var resolvedHalfW = 0.14;
var resolvedFloor = 0.18;
var flashEnv = 0.0;

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;
  var speedScale = 0.35 + clamp01(localSpeed) * 1.65;

  var shapeFollow = min(1.0, dt * 4.2);
  var lightFollow = min(1.0, dt * 9.0);
  liveBeamWidth += (clamp01(beamWidth) - liveBeamWidth) * shapeFollow;
  liveFlash += (clamp01(flash) - liveFlash) * lightFollow;
  liveFloorLevel += (clamp01(floorLevel) - liveFloorLevel) * shapeFollow;
  liveLevel += (clamp01(level) - liveLevel) * lightFollow;

  // One full sweep ~= 15 s at the reference point: 1/(15 x 0.4225) = 0.1578.
  beamPhase += dt * 0.1578 * speedScale * sweepDirection;
  if (beamPhase >= PHASE_WRAP) beamPhase -= PHASE_WRAP;
  if (beamPhase < 0.0) beamPhase += PHASE_WRAP;
  // Independent unidirectional flash clock; the double-flash cadence stays
  // steady regardless of sweep direction. ~30 s between flashes.
  flashClock += dt * 0.0789 * speedScale;
  if (flashClock >= PHASE_WRAP) flashClock -= PHASE_WRAP;

  resolvedHalfW = 0.05 + liveBeamWidth * 0.20;
  resolvedFloor = 0.14 + liveFloorLevel * 0.09;

  var flashCycle = flashClock - floor(flashClock);
  var pulseA = smooth01(1.0 - flashCycle / 0.10);
  var pulseB = smooth01(1.0 - abs(flashCycle - 0.16) / 0.06) * 0.60;
  flashEnv = max(pulseA, pulseB) * liveFlash;
}

export function render3D(index, x, y, z) {
  var nx = clamp01(x);
  var ny = clamp01(y);
  var nz = clamp01(z);
  var dx = nx - 0.5;
  var dz = nz - 0.5;
  var ang = atan2(dz, dx) / PI2;
  ang = ang - floor(ang);

  var dd = ang - (beamPhase - floor(beamPhase));
  dd = dd - floor(dd + 0.5);
  var ad = abs(dd);

  var core = smooth01(1.0 - ad / resolvedHalfW);
  core = core * core;

  var lvl = resolvedFloor;
  lvl = lvl + core * (0.52 + 0.36 * core);
  lvl = lvl + flashEnv * (0.10 + core * 0.34);

  if (fixtureType == FIX_PAR) {
    // Organs: the lamp housing itself, a steadier glow that still tracks
    // the sweeping core and pulses with the double-flash.
    lvl = resolvedFloor * 0.92;
    lvl = lvl + core * (0.58 + 0.32 * core);
    lvl = lvl + flashEnv * (0.16 + core * 0.30);
  }

  var authored = 0.30 + liveLevel * 0.70;
  emitUv(lvl * authored);
}
