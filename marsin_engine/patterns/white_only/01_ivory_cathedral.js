/*
  01_ivory_cathedral.js — "Ivory Cathedral"  [WHITE ONLY family — wave _312]

  DERIVED FROM: patterns/02_phase_cathedral.js. Skeleton kept: four
  golden-ratio incommensurate phase-shifted sine planes (f1..f4) summed and
  crushed by a sharpness power into an interference field, a radial arch
  band, and one traveling rib whose head is driven by the signed beat clock.
  IDENTITY (50 ft): phased cathedral waves sweep the ship as ivory arches
  with crisp white crests.

  TEXTURE: interference nodes rest at a 0.09 shadow; the radial arch band
  carries the 0.30-0.50 mid body; crushed interference cores and the
  traveling rib carry 0.85-1.0 crisp peaks.
  SPEED: authored to global 25 / local 0.30 (rate factor 0.4225) — one full
  beat drift ~= 6 s on the rig at the reference point (0.395 x 0.4225 ~= 1
  cycle per 6s... i.e. period = 1/(0.395*0.4225)).
  RUNAWAY (g=4.0, local 1.0 = 8x base): fastest term is the beat clock at
  0.395 x 8 = 3.16 cycles/s, well below the 10/s alias bar. Max per-frame
  clock jump 0.1 x 0.395 x 2.0 = 0.079 against PHASE_WRAP 4096 — wraps safe
  by 4+ orders of magnitude.
  CONTROLS (declaration order = MFT knob order): localSpeed — beat drift
  rate; direction — signed drift direction; radius — arch position from
  apex to hull; sharpness — interference node-crush power; count — radial
  ring density; level — overall intensity with a visible floor.
*/

export var localSpeed = 0.30;
export var direction = 0.75;
export var radius = 0.50;
export var sharpness = 0.50;
export var count = 0.50;
export var level = 0.70;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderDirection(v) {
  direction = v;
  var dv = v * 2.0 - 1.0;
  if (dv >= 0.0 && dv < 0.06) dv = 0.06;
  else if (dv < 0.0 && dv > -0.06) dv = -0.06;
  beatDirection = dv;
}
export function sliderRadius(v) { radius = v; }
export function sliderSharpness(v) { sharpness = v; }
export function sliderCount(v) { count = v; }
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
var GOLDEN = 1.618;
var INVGOLDEN = 0.618;
var BEAT_BASE = 0.395;

var beatDirection = 0.50;
var beatClock = 0.0;

var liveSharp = 4.5;
var liveCount = 11.0;
var liveRadius = 0.50;
var liveLevel = 0.70;

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;
  var speedScale = 0.35 + clamp01(localSpeed) * 1.65;

  var lightFollow = min(1.0, dt * 9.0);
  var targetSharp = 1.0 + clamp01(sharpness) * 3.6;
  var targetCount = 2.0 + clamp01(count) * 18.0;
  liveSharp += (targetSharp - liveSharp) * lightFollow;
  liveCount += (targetCount - liveCount) * lightFollow;
  liveRadius += (clamp01(radius) - liveRadius) * lightFollow;
  liveLevel += (clamp01(level) - liveLevel) * lightFollow;

  // One full beat drift cycle ~= 6 s at the reference point:
  // 1/(0.395 x 0.4225) ~= 6.0 s.
  var beatRate = BEAT_BASE * speedScale;
  beatClock += dt * beatRate * beatDirection;
  if (beatClock >= PHASE_WRAP) beatClock -= PHASE_WRAP;
  if (beatClock < 0.0) beatClock += PHASE_WRAP;
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

  var beatRad = beatClock * PI2;

  var f1 = sin((nx * 10.0) * PI2 + beatRad);
  var f2 = sin((ny * 10.0) * PI2 - beatRad * 0.5);
  var f3 = sin(((nx + ny) * 5.0) * PI2 + beatRad * GOLDEN);

  var dx = nx - 0.5;
  var dy = ny - 0.85;
  var dist = sqrt(dx * dx + dy * dy);
  var f4 = sin((dist * liveCount) * PI2 - beatRad * INVGOLDEN);

  var fieldAcc = f1;
  fieldAcc = fieldAcc + f2;
  fieldAcc = fieldAcc + f3;
  fieldAcc = fieldAcc + f4;
  var field = fieldAcc * 0.25;
  var interference = pow(abs(field), liveSharp);

  var archRadius = 0.05 + liveRadius * 0.90;
  var archDistance = abs(dist - archRadius);
  var arch = 1.0 - smoothstep(0.03, 0.17, archDistance);
  // A broad radial vault glow (NOT the thin ring) gives the cathedral a real
  // satin mid body instead of a near-empty field between crisp ring peaks.
  var archGlow = 1.0 - smoothstep(0.05, 0.95, dist);

  // One broad traveling rib crosses horizontally; its head is derived from
  // the signed beat clock so Direction endpoints are visibly opposite.
  var travelHead = beatClock * 0.55;
  travelHead = travelHead - floor(travelHead);
  var ribDistance = abs(nx - travelHead);
  ribDistance = min(ribDistance, 1.0 - ribDistance);
  var travelingRib = 1.0 - smoothstep(0.035, 0.14, ribDistance);

  var shadow = 0.10;
  var midAcc = archGlow * (0.26 + abs(field) * 0.20);
  var peakAcc = interference * 1.05;
  peakAcc = peakAcc + arch * (0.75 + abs(field) * 0.25);
  peakAcc = peakAcc + travelingRib * (0.45 + arch * 0.20);

  var lvl = shadow + midAcc;
  lvl = lvl + peakAcc;
  var nativeShare = 0.16 + interference * 0.55 + travelingRib * 0.25;

  if (fixtureType == FIX_PAR) {
    // Organs: restrained zero-crossing cores, never overpowering the field.
    var zc = 1.0 - abs(field);
    zc = pow(zc, liveSharp * 2.0);
    var coreAcc = arch * 0.12;
    coreAcc = coreAcc + zc * 0.80;
    lvl = shadow * 0.8 + coreAcc;
    nativeShare = 0.20 + zc * 0.55;
  } else if (fixtureType == FIX_VINTAGE_6) {
    // Jewelry: a restrained catch that becomes a decisive white kick at cores.
    var jewelAcc = interference * 0.95;
    lvl = 0.08 + jewelAcc;
    nativeShare = 0.30 + interference * 0.65;
  } else if (isSign) {
    // Identity: a coherent rose window — two counter-rotating architectural
    // planes preserved from the source, with a strong readable floor so both
    // letterforms stay legible above the interference.
    var signPlane = wave(nx * 1.414 + ny * 0.618 + nz * 1.732
                         - beatClock * 0.185);
    var signLead = wave(pixelLocalIndex * 0.0309 + nx * 0.73
                        + ny * 0.41 + nz * 0.59 + beatClock * 0.073);
    var signGlass = signPlane * 0.72 + signLead * 0.28;
    var signAcc = 0.32;
    signAcc = signAcc + interference * 0.30;
    signAcc = signAcc + signGlass * 0.16;
    lvl = signAcc;
    nativeShare = 0.20 + interference * 0.40;
  }

  var authored = 0.35 + liveLevel * 0.65;
  emitWhite(lvl * authored, nativeShare);
}
