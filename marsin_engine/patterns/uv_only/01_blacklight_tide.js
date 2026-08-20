/*
  01_blacklight_tide.js — "Blacklight Tide"  [UV ONLY family — wave _313]

  DERIVED FROM: patterns/119_bow_stern_tidal_push.js. Skeleton kept: one
  delta-accumulated surge phase drives a broad wall of light bow -> stern
  along X, a recoil term pulls the wall partway back before the next push,
  and the crest is a crisp band riding the front edge of the wall.
  IDENTITY (50 ft): a violet tidal wall surges down the ship and snaps back,
  its crest a thin blazing blacklight line.

  TEXTURE: the un-swept hull rests at a 0.16-0.24 violet keep; the wall body
  carries a 0.38-0.62 mid field; the crest line peaks at 0.90-1.00. The
  shadow behind the crest dips to 0.05 for a moving beat, never parked.
  SPEED: authored to global 25 / local 0.30 (rate factor 0.4225) — one full
  bow->stern surge ~= 21 s on the rig at the reference point.
  RUNAWAY (g=4.0 -> dt clamps at 0.1 s/frame; local 1.0 = 2.0x base): fastest
  clock is the surge at 0.112 x 2.0 = 0.224 cycles/s — far below the 10/s
  alias bar. Max per-frame clock jump 0.1 x 0.224 = 0.0224 against
  PHASE_WRAP 4096 — wraps safe by five orders of magnitude.
  CONTROLS (declaration order = MFT knob order): localSpeed — surge rate;
  direction — signed surge direction; waveWidth — thickness of the tidal
  wall; recoil — how far the wall snaps back between pushes; crest —
  strength of the crisp crest line; level — overall UV intensity.

  AUDIO_MODULATION_V1:
    sliderLevel <- micLow  range 0.35..1.00 curve linear  # overall UV intensity (PRIMARY)
    sliderCrest <- micKick range 0.20..1.00 curve pow2    # crest line bite on the kick
    # STATIC (omit from audio): localSpeed, direction, waveWidth, recoil
*/

export var localSpeed = 0.30;
export var direction = 0.75;
export var waveWidth = 0.45;
export var recoil = 0.60;
export var crest = 0.65;
export var level = 0.70;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderDirection(v) {
  direction = v;
  var dv = v * 2.0 - 1.0;
  if (dv >= 0.0 && dv < 0.06) dv = 0.06;
  else if (dv < 0.0 && dv > -0.06) dv = -0.06;
  surgeDirection = dv;
}
export function sliderWaveWidth(v) { waveWidth = v; }
export function sliderRecoil(v) { recoil = v; }
export function sliderCrest(v) { crest = v; }
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

var surgeClock = 0.0;
var swayClock = 0.13;
var surgeDirection = 0.50;

var liveWaveWidth = 0.45;
var liveRecoil = 0.60;
var liveCrest = 0.65;
var liveLevel = 0.70;

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;
  var speedScale = 0.35 + clamp01(localSpeed) * 1.65;

  var shapeFollow = min(1.0, dt * 4.2);
  var lightFollow = min(1.0, dt * 9.0);
  liveWaveWidth += (clamp01(waveWidth) - liveWaveWidth) * shapeFollow;
  liveRecoil += (clamp01(recoil) - liveRecoil) * shapeFollow;
  liveCrest += (clamp01(crest) - liveCrest) * lightFollow;
  liveLevel += (clamp01(level) - liveLevel) * lightFollow;

  // One surge ~= 21 s at the reference point: 1/(21 x 0.4225) = 0.112.
  surgeClock += dt * 0.112 * speedScale * surgeDirection;
  if (surgeClock >= PHASE_WRAP) surgeClock -= PHASE_WRAP;
  if (surgeClock < 0.0) surgeClock += PHASE_WRAP;
  // Independent slow sway keeps the wall from reading as a metronome.
  swayClock += dt * 0.112 * 0.41421356 * speedScale;
  if (swayClock >= PHASE_WRAP) swayClock -= PHASE_WRAP;
}

export function render3D(index, x, y, z) {
  var ux = clamp01(x);
  var uy = clamp01(y);
  var uz = clamp01(z);

  // The surge phase runs 0..1; recoil folds the second half of the cycle
  // back toward the bow so the wall pushes long and snaps back short —
  // the source pattern's push/recoil identity.
  var cyc = surgeClock - floor(surgeClock);
  var push = cyc * 2.0;
  if (push > 1.0) {
    var back = (push - 1.0);
    push = 1.0 - back * liveRecoil;
  }
  var wallCenter = -0.12 + push * 1.24;

  // Slow sway tilts the wall slightly in Y so the crest is never a flat
  // screen-space bar; the tilt term is small enough to keep the tide reading.
  var tilt = (0.5 - uy) * (0.10 + 0.10 * sin(swayClock * PI2));
  var along = ux + tilt;

  var halfWidth = 0.10 + liveWaveWidth * 0.22;
  var fromCenter = along - wallCenter;
  var absFrom = abs(fromCenter);

  // Wall body: a smooth slab of violet centred on the wall.
  var body = 1.0 - smooth01(absFrom / halfWidth);

  // Crest: a crisp thin line on the LEADING edge of the wall.
  var crestDistance = abs(fromCenter + halfWidth * 0.72);
  var crestLine = 1.0 - smoothstep(0.012, 0.055, crestDistance);

  // Shadow beat: a short dark trough directly behind the crest, moving with
  // it — a sparing dark accent that never parks on one region.
  var troughDistance = abs(fromCenter - halfWidth * 0.55);
  var trough = 1.0 - smoothstep(0.02, 0.10, troughDistance);

  // Violet keep so the whole hull stays present between surges; the vertical
  // grade keeps the keep from reading flat.
  var keep = 0.16 + uy * 0.08;

  var lvl = keep;
  lvl = lvl + body * (0.24 + 0.20 * smooth01(1.0 - absFrom));
  lvl = lvl - trough * keep * 0.72;
  lvl = lvl + crestLine * (0.42 + liveCrest * 0.62);

  if (fixtureType == FIX_PAR) {
    // Organs: each par blooms once as the crest passes its station, with a
    // per-fixture phase so the landmarks fire in sequence, not in unison.
    var station = fixtureId * 0.037;
    var bloomDistance = abs(fromCenter + station - floor(station) * 1.0 - 0.02);
    var bloom = 1.0 - smoothstep(0.03, 0.16, bloomDistance);
    lvl = keep * 0.85;
    lvl = lvl + bloom * (0.35 + liveCrest * 0.50);
  }

  var authored = 0.30 + liveLevel * 0.70;
  emitUv(lvl * authored);
}
