/*
  16_frosted_panes.js — "Frosted Panes"  [WHITE ONLY family — wave _312]

  DERIVED FROM: patterns/ambient_extra/01_harbor_glass.js. Skeleton kept: five
  XYZ Voronoi sites on a golden-angle spread, each migrating on its own slow
  delta-accumulated clock; per pixel a fixed five-site nearest/second-nearest
  search yields d1, d2 and the seam = d2 - d1.
  IDENTITY (50 ft): five huge frosted-glass panes slowly rearrange across the
  ship, their borders drawn as crisp white frost lines.

  TEXTURE: each pane holds its own fixed mid-gray tone (0.30-0.52 — five
  visibly different whites); the seam network carries the 0.9-1.0 crisp peaks;
  a thin chill band beside each seam dips toward 0.10 shadow for contrast.
  SPEED: authored to global 25 / local 0.30 (rate factor 0.4225) — the panes
  visibly redraw over ~45 s on the rig at the reference point.
  RUNAWAY (g=4.0, local 1.0 = 8x base): fastest site clock 0.055 x 1.73 x 8
  = 0.76 cycles/s — far below the 10/s alias bar. Max per-frame clock jump
  0.1 x 0.095 x 2.0 = 0.019 against PHASE_WRAP 4096 — wraps safe.
  CONTROLS (declaration order = MFT knob order): localSpeed — migration pace;
  paneSize — pane breadth and site spread; seamWidth — width of the frost
  lines; drift — how far each pane migrates; seamGlow — frost-line intensity;
  level — overall intensity with a visible floor.
*/

export var localSpeed = 0.30;
export var paneSize = 0.50;
export var seamWidth = 0.34;
export var drift = 0.40;
export var seamGlow = 0.62;
export var level = 0.70;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderPaneSize(v) { paneSize = v; }
export function sliderSeamWidth(v) { seamWidth = v; }
export function sliderDrift(v) { drift = v; }
export function sliderSeamGlow(v) { seamGlow = v; }
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

var GOLDEN_ANGLE = 2.39996323;
var GOLDEN_FRACTION = 0.61803399;
var SQRT2 = 1.41421356;
var SQRT3 = 1.73205081;
var PHASE_WRAP = 4096.0;

var siteClock1 = 0.00;
var siteClock2 = 0.17;
var siteClock3 = 0.39;
var siteClock4 = 0.61;
var siteClock5 = 0.83;

var livePaneSize = 0.50;
var liveSeamWidth = 0.34;
var liveDrift = 0.40;
var liveSeamGlow = 0.62;
var liveLevel = 0.70;

var site1x = 0.80, site1y = 0.50, site1z = 0.18;
var site2x = 0.28, site2y = 0.70, site2z = 0.58;
var site3x = 0.52, site3y = 0.20, site3z = 0.33;
var site4x = 0.65, site4y = 0.77, site4z = 0.73;
var site5x = 0.20, site5y = 0.35, site5z = 0.48;

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;
  var speedScale = 0.35 + clamp01(localSpeed) * 1.65;

  var editFollow = min(1.0, dt * 4.0);
  livePaneSize += (clamp01(paneSize) - livePaneSize) * editFollow;
  liveSeamWidth += (clamp01(seamWidth) - liveSeamWidth) * editFollow;
  liveDrift += (clamp01(drift) - liveDrift) * editFollow;
  liveSeamGlow += (clamp01(seamGlow) - liveSeamGlow) * editFollow;
  liveLevel += (clamp01(level) - liveLevel) * editFollow;

  // Panes visibly redraw over ~45 s at the reference point:
  // base rates ~= 1/(45 x 0.4225) spread over irrational ratios.
  siteClock1 += dt * 0.048 * speedScale;
  siteClock2 += dt * 0.061 * speedScale;
  siteClock3 += dt * 0.044 * SQRT2 * speedScale;
  siteClock4 += dt * 0.038 * SQRT3 * speedScale;
  siteClock5 += dt * 0.054 * GOLDEN_FRACTION * speedScale;
  if (siteClock1 >= PHASE_WRAP) siteClock1 -= PHASE_WRAP;
  if (siteClock2 >= PHASE_WRAP) siteClock2 -= PHASE_WRAP;
  if (siteClock3 >= PHASE_WRAP) siteClock3 -= PHASE_WRAP;
  if (siteClock4 >= PHASE_WRAP) siteClock4 -= PHASE_WRAP;
  if (siteClock5 >= PHASE_WRAP) siteClock5 -= PHASE_WRAP;

  var spread = 0.36 - livePaneSize * 0.13;
  var migration = 0.030 + liveDrift * 0.150;

  site1x = 0.50 + spread * cos(0.0 * GOLDEN_ANGLE);
  site1x = site1x + migration * cos(siteClock1 * PI2 + 0.0 * GOLDEN_ANGLE);
  site1y = 0.50 + spread * sin(0.0 * GOLDEN_ANGLE);
  site1y = site1y + migration * sin(siteClock1 * PI2 + 0.5 * GOLDEN_ANGLE);
  site1z = 0.18 + migration * 0.72 * sin(siteClock1 * PI2 + 1.0 * GOLDEN_ANGLE);

  site2x = 0.50 + spread * cos(1.0 * GOLDEN_ANGLE);
  site2x = site2x + migration * cos(siteClock2 * PI2 + 1.0 * GOLDEN_ANGLE);
  site2y = 0.50 + spread * sin(1.0 * GOLDEN_ANGLE);
  site2y = site2y + migration * sin(siteClock2 * PI2 + 1.5 * GOLDEN_ANGLE);
  site2z = 0.18 + 0.64 * frac(GOLDEN_FRACTION);
  site2z = site2z + migration * 0.72 * sin(siteClock2 * PI2 + 2.0 * GOLDEN_ANGLE);

  site3x = 0.50 + spread * cos(2.0 * GOLDEN_ANGLE);
  site3x = site3x + migration * cos(siteClock3 * PI2 + 2.0 * GOLDEN_ANGLE);
  site3y = 0.50 + spread * sin(2.0 * GOLDEN_ANGLE);
  site3y = site3y + migration * sin(siteClock3 * PI2 + 2.5 * GOLDEN_ANGLE);
  site3z = 0.18 + 0.64 * frac(2.0 * GOLDEN_FRACTION);
  site3z = site3z + migration * 0.72 * sin(siteClock3 * PI2 + 3.0 * GOLDEN_ANGLE);

  site4x = 0.50 + spread * cos(3.0 * GOLDEN_ANGLE);
  site4x = site4x + migration * cos(siteClock4 * PI2 + 3.0 * GOLDEN_ANGLE);
  site4y = 0.50 + spread * sin(3.0 * GOLDEN_ANGLE);
  site4y = site4y + migration * sin(siteClock4 * PI2 + 3.5 * GOLDEN_ANGLE);
  site4z = 0.18 + 0.64 * frac(3.0 * GOLDEN_FRACTION);
  site4z = site4z + migration * 0.72 * sin(siteClock4 * PI2 + 4.0 * GOLDEN_ANGLE);

  site5x = 0.50 + spread * cos(4.0 * GOLDEN_ANGLE);
  site5x = site5x + migration * cos(siteClock5 * PI2 + 4.0 * GOLDEN_ANGLE);
  site5y = 0.50 + spread * sin(4.0 * GOLDEN_ANGLE);
  site5y = site5y + migration * sin(siteClock5 * PI2 + 4.5 * GOLDEN_ANGLE);
  site5z = 0.18 + 0.64 * frac(4.0 * GOLDEN_FRACTION);
  site5z = site5z + migration * 0.72 * sin(siteClock5 * PI2 + 5.0 * GOLDEN_ANGLE);
}

export function render3D(index, x, y, z) {
  var mx = clamp01(x);
  var my = clamp01(y);
  var mz = clamp01(z);
  var isSign = fixtureType == FIX_TE_SIGN;

  if (isSign) {
    // Fold both physical 74-pixel signs onto one authored 10x8 surface so the
    // paired identities stay byte-identical.
    var signIndex = index % 74.0;
    mx = (signIndex % 10.0) / 9.0;
    my = floor(signIndex / 10.0) / 7.0;
    mz = 0.38 + mx * 0.14 + my * 0.08;
  }

  // Fixed five-site scalar nearest/second-nearest search (source skeleton).
  var dx1 = mx - site1x;
  var dy1 = my - site1y;
  var dz1 = mz - site1z;
  var nearestDistance = dx1 * dx1 + dy1 * dy1 + dz1 * dz1;
  var secondDistance = 10.0;
  var cellId = 0.0;

  var dx2 = mx - site2x;
  var dy2 = my - site2y;
  var dz2 = mz - site2z;
  var candidateDistance = dx2 * dx2 + dy2 * dy2 + dz2 * dz2;
  if (candidateDistance < nearestDistance) {
    secondDistance = nearestDistance;
    nearestDistance = candidateDistance;
    cellId = 1.0;
  } else {
    secondDistance = candidateDistance;
  }

  var dx3 = mx - site3x;
  var dy3 = my - site3y;
  var dz3 = mz - site3z;
  candidateDistance = dx3 * dx3 + dy3 * dy3 + dz3 * dz3;
  if (candidateDistance < nearestDistance) {
    secondDistance = nearestDistance;
    nearestDistance = candidateDistance;
    cellId = 2.0;
  } else if (candidateDistance < secondDistance) {
    secondDistance = candidateDistance;
  }

  var dx4 = mx - site4x;
  var dy4 = my - site4y;
  var dz4 = mz - site4z;
  candidateDistance = dx4 * dx4 + dy4 * dy4 + dz4 * dz4;
  if (candidateDistance < nearestDistance) {
    secondDistance = nearestDistance;
    nearestDistance = candidateDistance;
    cellId = 3.0;
  } else if (candidateDistance < secondDistance) {
    secondDistance = candidateDistance;
  }

  var dx5 = mx - site5x;
  var dy5 = my - site5y;
  var dz5 = mz - site5z;
  candidateDistance = dx5 * dx5 + dy5 * dy5 + dz5 * dz5;
  if (candidateDistance < nearestDistance) {
    secondDistance = nearestDistance;
    nearestDistance = candidateDistance;
    cellId = 4.0;
  } else if (candidateDistance < secondDistance) {
    secondDistance = candidateDistance;
  }

  var d1 = sqrt(nearestDistance);
  var d2 = sqrt(secondDistance);
  var seam = d2 - d1;
  var seamHalf = 0.006 + liveSeamWidth * 0.055;
  var frostLine = 1.0 - smoothstep(seamHalf * 0.62, seamHalf * 2.10, seam);
  // A thin chill band just beyond the frost line dips toward shadow, so the
  // bright seam always has darkness on one side and a pane on the other.
  var chillDistance = abs(seam - seamHalf * 2.1);
  var chillBand = 1.0 - smoothstep(seamHalf * 0.5, seamHalf * 2.0,
                                   chillDistance);
  chillBand = chillBand * (1.0 - frostLine);

  // Five fixed mid-gray pane tones — visibly different whites, never a wash.
  var paneTone = 0.34;
  if      (cellId == 1.0) paneTone = 0.48;
  else if (cellId == 2.0) paneTone = 0.38;
  else if (cellId == 3.0) paneTone = 0.52;
  else if (cellId == 4.0) paneTone = 0.42;
  var lensRadius = 0.19 + livePaneSize * 0.29;
  var lens = smooth01(1.0 - d1 / lensRadius);

  var lvl = 0.10;
  lvl = lvl + paneTone * (1.0 - chillBand * 0.75);
  lvl = lvl + lens * 0.10;
  lvl = lvl + frostLine * (0.75 + liveSeamGlow * 0.80);
  var nativeShare = 0.16 + frostLine * 0.55;

  if (fixtureType == FIX_RAW_LED) {
    // Silhouette draws the seam topology as a bright perimeter over a firm
    // outline floor — the ship contour never goes dark.
    lvl = 0.24;
    lvl = lvl + lens * 0.12;
    lvl = lvl + frostLine * (0.80 + liveSeamGlow * 0.70);
    nativeShare = 0.18 + frostLine * 0.60;
  } else if (fixtureType == FIX_VINTAGE_6) {
    // Jewelry: sparse ice glints where a seam crosses a head.
    var glintPhase = 0.5 + 0.5 * sin(index * GOLDEN_ANGLE + siteClock3 * PI2);
    var glint = frostLine * pow(glintPhase, 7.0);
    lvl = 0.13 + paneTone * 0.28;
    lvl = lvl + glint * (0.95 + liveSeamGlow * 0.55);
    nativeShare = 0.22 + glint * 0.78;
  } else if (fixtureType == FIX_PAR) {
    // Organs anchor the panes: steady tone, seam-kissed.
    lvl = 0.14 + paneTone * 0.55;
    lvl = lvl + frostLine * (0.35 + liveSeamGlow * 0.55);
    nativeShare = 0.20 + frostLine * 0.35;
  } else if (isSign) {
    // Identity: miniature pane map over a readable floor.
    lvl = 0.30 + paneTone * 0.35;
    lvl = lvl + lens * 0.10;
    lvl = lvl + frostLine * (0.55 + liveSeamGlow * 0.50);
    nativeShare = 0.22 + frostLine * 0.45;
  }

  var authored = 0.35 + liveLevel * 0.65;
  emitWhite(lvl * authored, nativeShare);
}
