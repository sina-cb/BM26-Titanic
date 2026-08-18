/*
  12_porthole_liner.js — "Porthole Liner"  [WHITE ONLY family — wave _312]

  DERIVED FROM: patterns/08_ocean_liner.js. Skeleton kept: a gamma-shaped
  high-frequency ripple over a broad current band gives the hull wash its
  deep-trough relief; a hashed, per-pixel eligibility gate carries the
  discrete porthole field; per-fixture role weights split hull-wash from
  porthole duty exactly as the source staged Bars/Silhouette/Vintage/Organs.
  Direction stays fixed, as in the source.
  IDENTITY (50 ft): the ship steams at night — rows of brilliant white
  portholes over a soft gray hull wash.

  TEXTURE: the hull wash troughs rest at a 0.08 shadow; the lit hull-wash
  crests carry the 0.30-0.55 mid body; the crisp porthole cores (and their
  flare) carry the 0.85-1.0 crisp peaks.
  SPEED: authored to global 25 / local 0.30 (rate factor 0.4225); the
  water/porthole clocks keep the source's fixed 0.45/0.30 * sqrt(2) rate
  ratio and its FIXED_DIRECTION_RATE=0.50 heading multiplier baked in.
  RUNAWAY (g=4.0, local 1.0 = 8x base): fastest term is the porthole clock
  at (0.30 x 1.41421 x 0.50) x 8 = 1.70 cycles/s, below the 10/s alias bar.
  Max per-frame clock jump 0.1 x 0.212 x 2.0 = 0.042 against PHASE_WRAP
  4096 — wraps safe by many orders of magnitude.
  CONTROLS (declaration order = MFT knob order): localSpeed — water/
  porthole travel rate; detail — porthole count/texture; flare — decisive
  porthole punch; level — overall intensity with a visible floor.
*/

export var localSpeed = 0.30;
export var detail = 0.50;
export var flare = 0.35;
export var level = 0.65;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderDetail(v) { detail = v; }
export function sliderFlare(v) { flare = v; }
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

var WATER_RATE = 0.45;
var PORT_RATE = 0.30;
var PHASE_WRAP = 4096.0;
var FIXED_DIRECTION_RATE = 0.50;

var waterPhase = 2048.0;
var portPhase = 2048.0;

var liveDetail = 0.50;
var liveFlare = 0.35;
var liveLevel = 0.65;

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;
  var speedScale = 0.35 + clamp01(localSpeed) * 1.65;

  var paramFollow = clamp01(dt * 6.0);
  liveDetail += (clamp01(detail) - liveDetail) * paramFollow;
  liveFlare += (clamp01(flare) - liveFlare) * paramFollow;
  liveLevel += (clamp01(level) - liveLevel) * paramFollow;

  waterPhase += dt * speedScale * WATER_RATE * FIXED_DIRECTION_RATE;
  if (waterPhase >= PHASE_WRAP) waterPhase -= PHASE_WRAP;
  else if (waterPhase < 0.0) waterPhase += PHASE_WRAP;

  portPhase += dt * speedScale * PORT_RATE * 1.41421 * FIXED_DIRECTION_RATE;
  if (portPhase >= PHASE_WRAP) portPhase -= PHASE_WRAP;
  else if (portPhase < 0.0) portPhase += PHASE_WRAP;
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

  // Gamma-shaped high-frequency ripple deepens the water troughs (HD
  // contrast) while a broad current band keeps the travel readable.
  var ripple = 0.5 + 0.5 * sin((waterPhase + ux * 5.7 + uy * 3.3) * PI2);
  var rippleHD = pow(ripple, 1.7);
  var waterStruct = 0.55 + 0.45 * rippleHD;
  var currentBand = wave(ux * 0.85 - waterPhase * 1.7);
  waterStruct = waterStruct * (0.58 + currentBand * 0.42);

  // Hashed per-pixel gate: low Detail = fewer, softer portholes; high
  // Detail = more crisp points.
  var hashp = ux * 5.0 + uy * 2.0;
  hashp = hashp - floor(hashp);
  var glow = portPhase + hashp;
  glow = glow + ux * (0.5 + 0.48);
  glow = glow + uy * 0.176;
  var pw = 0.5 + 0.5 * sin(glow * PI2);
  var sharp = 7.0 + liveDetail * 18.0;
  var port = pow(pw, sharp);
  var portHalo = pow(pw, 3.0 + liveDetail * 4.0);
  var elig = 0.5 + 0.5 * sin((hashp * 13.0 + 0.21) * PI2);
  if (elig < (1.0 - (0.10 + liveDetail * 0.75))) port = port * 0.02;

  var waterRole = 0.24;
  var portRole = 0.16;
  if (fixtureType == FIX_BAR_18) {
    waterRole = 1.0;
    portRole = 0.38;
  } else if (fixtureType == FIX_RAW_LED) {
    waterRole = 0.38;
    portRole = 0.22;
  } else if (fixtureType == FIX_VINTAGE_6) {
    waterRole = 0.16;
    portRole = 1.0;
  } else if (fixtureType == FIX_PAR) {
    waterRole = 0.34;
    portRole = 0.60;
  } else if (isSign) {
    waterRole = 0.28;
    portRole = 0.14;
  }

  var flareShape = liveFlare * (2.0 - liveFlare);

  var shadow = 0.08;
  var midBody = waterStruct * waterRole * 0.40;
  var peakAcc = port * portRole * 2.60;
  peakAcc = peakAcc + portHalo * portRole * 0.35;
  peakAcc = peakAcc + flareShape * portRole * 0.40;

  var lvl = shadow + midBody;
  lvl = lvl + peakAcc;
  var nativeShare = 0.15 + port * portRole * 0.75;

  if (isSign) {
    // Identity: a calm XYZ tide crosses the letters while a separately
    // moving chain of soft porthole pools reveals the internal pixel path.
    var signTide = wave(ux * 0.79 + uy * 1.37 - uz * 0.51 - waterPhase + pixelLocalIndex * 0.008);
    var signPortWave = wave(portPhase * 2.0 + ux * 0.31 - uy * 0.57 + uz * 0.83 + pixelLocalIndex * 0.021);
    var signPort = pow(signPortWave, 3.2);

    var signMid = signTide * 0.16;
    signMid = signMid + currentBand * 0.05;
    var signPeak = signPort * 0.70;
    lvl = 0.24 + signMid;
    lvl = lvl + signPeak;
    nativeShare = 0.20 + signPort * 0.65;
  }

  var authored = 0.35 + liveLevel * 0.65;
  emitWhite(lvl * authored, nativeShare);
}
