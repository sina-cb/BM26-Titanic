/*
  08_uv_broadside_call.js — "UV Broadside Call"  [UV ONLY family — wave _313]

  DERIVED FROM: patterns/123_mirrored_broadside_call.js. Skeleton kept:
  abs(x - 0.5) supplies exact mirrored symmetry so the two opposing hull
  wall groups (real pixels only exist outside the empty normalized X band
  0.3861..0.6575) call outward from center together, then answer by
  returning inward; a trailing echo wall and Y/Z warp keep the wavefront
  reading as a broad 3D surface rather than a flat bar.
  IDENTITY (50 ft): opposing hull walls call and answer in alternating
  violet swells, an expanding wavefront traveling out then back.

  TEXTURE: the un-swept hull rests at a 0.15-0.21 violet keep; the wall
  and echo bodies carry a 0.36-0.58 mid field; the call/answer meeting
  points peak at 0.86-1.00.
  SPEED: authored to global 25 / local 0.30, direction 0.75 (rate factor
  0.4225) — one full call-and-answer cycle ~= 20 s on the rig at the
  reference point.
  RUNAWAY (g=4.0 -> dt clamps at 0.1 s/frame; local 1.0 = 2.0x base, full
  direction = 1.0x sign): fastest clock is the call at 0.1183 x 2.0 x
  1.0 = 0.2366 cycles/s — far below the 10/s alias bar. Max per-frame
  clock jump 0.1 x 0.2366 = 0.02366 against PHASE_WRAP 4096 — wraps safe
  by five orders of magnitude.
  CONTROLS (declaration order = MFT knob order): localSpeed — call rate;
  direction — signed call direction; wallWidth — thickness of the main
  and echo walls; expansion — how far the call reaches before answering;
  contrast — core sharpness of the walls; level — overall UV intensity.

  AUDIO_MODULATION_V1:
    sliderLevel     <- micLow  range 0.35..1.00 curve linear # overall UV intensity (PRIMARY)
    sliderExpansion <- micFlux range 0.35..1.00 curve ease   # broadside reach on builds
    # STATIC (omit from audio): localSpeed, direction, wallWidth, contrast
*/

export var localSpeed = 0.30;
export var direction = 0.75;
export var wallWidth = 0.48;
export var expansion = 0.70;
export var contrast = 0.60;
export var level = 0.70;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderDirection(v) {
  direction = v;
  var dv = v * 2.0 - 1.0;
  if (dv >= 0.0 && dv < 0.06) dv = 0.06;
  else if (dv < 0.0 && dv > -0.06) dv = -0.06;
  callDirection = dv;
}
export function sliderWallWidth(v) { wallWidth = v; }
export function sliderExpansion(v) { expansion = v; }
export function sliderContrast(v) { contrast = v; }
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

var callClock = 0.0;
var shapeClock = 0.0;
var depthClock = 0.0;
var callDirection = 0.50;

var wallPosition = 0.0;
var echoPosition = 0.0;
var warpSin = 0.0;
var warpCos = 1.0;

var liveWallWidth = 0.48;
var liveExpansion = 0.70;
var liveContrast = 0.60;
var liveLevel = 0.70;

var resolvedWidth = 0.13;
var resolvedSharp = 2.14;

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;
  var speedScale = 0.35 + clamp01(localSpeed) * 1.65;

  var shapeFollow = min(1.0, dt * 4.2);
  var lightFollow = min(1.0, dt * 9.0);
  liveWallWidth += (clamp01(wallWidth) - liveWallWidth) * shapeFollow;
  liveExpansion += (clamp01(expansion) - liveExpansion) * shapeFollow;
  liveContrast += (clamp01(contrast) - liveContrast) * shapeFollow;
  liveLevel += (clamp01(level) - liveLevel) * lightFollow;

  // One call-and-answer ~= 20 s at the reference point: 1/(20 x 0.4225) = 0.1183.
  callClock += dt * 0.1183 * speedScale * callDirection;
  if (callClock >= PHASE_WRAP) callClock -= PHASE_WRAP;
  if (callClock < 0.0) callClock += PHASE_WRAP;
  // Independent unidirectional warp texture; never reverses with direction.
  shapeClock += dt * 0.0864 * speedScale;
  depthClock += dt * 0.1621 * speedScale;
  if (shapeClock >= PHASE_WRAP) shapeClock -= PHASE_WRAP;
  if (depthClock >= PHASE_WRAP) depthClock -= PHASE_WRAP;

  resolvedWidth = 0.045 + liveWallWidth * 0.180;
  resolvedSharp = 0.80 + liveContrast * 3.90;

  var callWave = wave(callClock);
  var reach = 0.65 + liveExpansion * 0.35;
  wallPosition = callWave * reach;

  var velocity = cos(callClock * PI2);
  echoPosition = clamp01(wallPosition - velocity * (0.10 + resolvedWidth * 0.35));
  warpSin = sin(shapeClock * PI2);
  warpCos = cos(depthClock * PI2);
}

export function render3D(index, x, y, z) {
  var nx = clamp01(x);
  var ny = clamp01(y);
  var nz = clamp01(z);

  var mirrorX = abs(nx - 0.5) * 2.0;
  var yzWarp = (ny - 0.5) * warpSin * 0.13;
  yzWarp = yzWarp + (nz - 0.5) * warpCos * 0.11;
  yzWarp = yzWarp + sin((ny * 0.63 + nz * 0.37) * PI2 + shapeClock * PI2 * 2.0) * 0.025;
  var curvedX = clamp01(mirrorX + yzWarp * (0.45 + liveExpansion * 0.55));

  var mainWall = smooth01(1.0 - abs(curvedX - wallPosition) / resolvedWidth);
  var echoWall = smooth01(1.0 - abs(curvedX - echoPosition) / (resolvedWidth * 1.28));
  mainWall = pow(mainWall, resolvedSharp);
  echoWall = pow(echoWall, resolvedSharp + 0.65) * 0.58;

  var meeting = pow(clamp01(1.0 - wallPosition * 3.6), 2.2);
  var broadside = pow(clamp01((wallPosition - 0.78) * 4.55), 2.0);
  var wallEnergy = clamp01(max(mainWall, echoWall) + mainWall * echoWall * 0.35);

  var keep = 0.15 + ny * 0.06;
  var lvl = keep;
  lvl = lvl + wallEnergy * (0.40 + 0.36 * wallEnergy);
  lvl = lvl + meeting * 0.28;
  lvl = lvl + broadside * 0.24;

  if (fixtureType == FIX_PAR) {
    // Organs: pars answer at the exact call/broadside moments with a sharp
    // per-fixture-phased pulse, distinct from the continuous wall wash.
    var station = fixtureId * 0.02703 - floor(fixtureId * 0.02703);
    var parPulse = smooth01(wave(station * 3.0 + callClock * 1.30));
    lvl = keep * 0.88;
    lvl = lvl + wallEnergy * 0.62;
    lvl = lvl + parPulse * (0.34 + broadside * 0.38 + meeting * 0.38);
  }

  var authored = 0.30 + liveLevel * 0.70;
  emitUv(lvl * authored);
}
