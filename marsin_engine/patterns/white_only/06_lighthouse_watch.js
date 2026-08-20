/*
  06_lighthouse_watch.js — "Lighthouse Watch"  [WHITE ONLY family — wave _312]

  DERIVED FROM: patterns/58_lighthouse_solo.js. Skeleton kept: azimuth
  around the rig center (x,z = 0.5,0.5) found with atan2; ONE beam rotates
  and is mirrored to its exact opposite so no physical side stays dark; a
  tight high-definition core sits inside a much broader halo; a guaranteed
  whole-rig floor makes blackout impossible.
  IDENTITY (50 ft): a single brilliant lighthouse beam sweeps the ship above
  a calm gray sea-glow.

  TEXTURE: the far night field rests at a 0.09-0.13 shadow (safetyFloor);
  the broad halo around the beam carries the 0.28-0.46 mid body (the sea-
  glow); the tight rotating core carries 0.85-1.0 crisp peaks.
  SPEED: authored to global 25 / local 0.30 (rate factor 0.4225) — one full
  rotation ~= 14 s on the rig at the reference point.
  RUNAWAY (g=4.0, local 1.0 = 8x base): fastest term is the beam clock at
  0.169 x 8 = 1.35 cycles/s, far below the 10/s alias bar. Max per-frame
  clock jump 0.1 x 0.169 x 2.0 = 0.034 against PHASE_WRAP 4096 — wraps safe
  by 5 orders of magnitude.
  CONTROLS (declaration order = MFT knob order): localSpeed — rotation
  rate; width — sweep reach of the halo/core; safetyFloor — guaranteed
  night floor; level — overall beam intensity with a visible floor.
*/

export var localSpeed = 0.30;
export var width = 0.50;
export var safetyFloor = 0.50;
export var level = 0.72;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderWidth(v) { width = v; }
export function sliderSafetyFloor(v) { safetyFloor = v; }
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
var BEAM_BASE = 0.169;
var SIGN_BASE = 0.0394;
var FLOOR_MIN = 0.09;
var FLOOR_SPAN = 0.04;

var beamPhase = 0.0;
var signPhase = 0.0;

var liveWidth = 0.50;
var liveFloor = 0.11;
var liveLevel = 0.72;
var halfW = 0.15;

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;
  var speedScale = 0.35 + clamp01(localSpeed) * 1.65;

  var lightFollow = min(1.0, dt * 9.0);
  liveWidth += (clamp01(width) - liveWidth) * lightFollow;
  liveLevel += (clamp01(level) - liveLevel) * lightFollow;
  var targetFloor = FLOOR_MIN + clamp01(safetyFloor) * FLOOR_SPAN;
  liveFloor += (targetFloor - liveFloor) * lightFollow;

  // One full rotation ~= 14 s at the reference point:
  // 1/(0.169 x 0.4225) ~= 14.0 s.
  beamPhase += dt * BEAM_BASE * speedScale;
  beamPhase = beamPhase - floor(beamPhase);
  signPhase += dt * SIGN_BASE * speedScale;
  if (signPhase >= PHASE_WRAP) signPhase -= PHASE_WRAP;

  halfW = 0.05 + liveWidth * 0.20 + liveLevel * 0.10;
}

export function render3D(index, x, y, z) {
  var nx = clamp01(x);
  var ny = clamp01(y);
  var nz = clamp01(z);
  var isSign = fixtureType == FIX_TE_SIGN;

  if (isSign) {
    // The physical sign is split across two fixtures. Fold the global index
    // across the full 74-pixel object so both signs stay byte-identical.
    var signIndex = index % 74.0;
    nx = (signIndex % 10.0) / 9.0;
    ny = floor(signIndex / 10.0) / 7.0;
    nz = 0.44 + nx * 0.12;
  }

  // Azimuth around the ship in the horizontal XZ plane.
  var dx = nx - 0.5;
  var dz = nz - 0.5;
  var ang = atan2(dz, dx) / PI2;
  ang = ang - floor(ang);

  // Shortest angular distance to the beam and its exact opposite. The
  // mirrored fan prevents one physical side of the ship from staying dark.
  var dd = ang - beamPhase;
  dd = dd - floor(dd + 0.5);
  var ad = abs(dd);
  var ddOpp = ang - (beamPhase + 0.5);
  ddOpp = ddOpp - floor(ddOpp + 0.5);
  var adOpp = abs(ddOpp);
  if (adOpp < ad) ad = adOpp;

  // Broad halo (sea-glow, wide reach) and a tight crisp core inside it.
  var haloWidth = halfW * 2.7;
  var haloProf = clamp01(1.0 - ad / haloWidth);
  haloProf = smooth01(haloProf);
  var coreProf = 0.0;
  if (ad < halfW) {
    coreProf = 1.0 - (ad / halfW);
    coreProf = coreProf * coreProf;
  }

  var shadow = liveFloor;
  var midAcc = haloProf * (0.22 + haloProf * 0.18);
  var peakAcc = coreProf * (0.60 + liveLevel * 0.35);

  var lvl = shadow + midAcc;
  lvl = lvl + peakAcc;
  var nativeShare = 0.14 + coreProf * 0.82;

  if (fixtureType == FIX_VINTAGE_6) {
    // Jewelry: warm (here: crisp) afterglow that lingers past the core.
    var vintAcc = shadow * 0.6 + haloProf * 0.22;
    vintAcc = vintAcc + coreProf * 0.70;
    lvl = vintAcc;
    nativeShare = 0.30 + coreProf * 0.65;
  } else if (fixtureType == FIX_PAR) {
    // Organs: the lighthouse source itself — restrained, always present.
    var parAcc = shadow * 0.9 + haloProf * 0.16;
    parAcc = parAcc + coreProf * 0.30;
    lvl = parAcc;
    nativeShare = 0.16 + coreProf * 0.45;
  } else if (isSign) {
    // Identity becomes a matched pair of miniature lighthouse surfaces.
    // Each letter path receives the same pixelLocalIndex beam and halo, so
    // both signs are byte-symmetric while every puck keeps a legible floor.
    var signPath = pixelLocalIndex / 39.0;
    var signDelta = signPath - beamPhase;
    signDelta = signDelta - floor(signDelta + 0.5);
    var signCore = clamp01(1.0 - abs(signDelta) / 0.10);
    signCore = signCore * signCore;
    var signHalo = clamp01(1.0 - abs(signDelta) / 0.28);
    signHalo = signHalo * signHalo;
    var signTexture = wave(signPath * 0.61803 - signPhase * 1.41421);
    var signAcc = 0.32;
    signAcc = signAcc + signHalo * 0.20;
    signAcc = signAcc + signCore * 0.30;
    signAcc = signAcc + signTexture * 0.05;
    lvl = signAcc;
    nativeShare = 0.18 + signCore * 0.55;
  }

  var authored = 0.35 + liveLevel * 0.65;
  emitWhite(lvl * authored, nativeShare);
}
