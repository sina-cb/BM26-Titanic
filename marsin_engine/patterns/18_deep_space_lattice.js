/*
  18_deep_space_lattice.js
  Drifting interference lattice — two crossed wave grids plus a diagonal weave
  slide across the rig, lighting crisp lattice lines over a near-black void with
  a slow cp1<->cp2 colour-depth gradient. The "deep space" feel: a cool grid that
  breathes and drifts like a starfield seen through a lens.

  IDENTITY (preserved): the crossed-grid lattice + diagonal weave + colour depth.
  Upgrades: 0..1 coords used directly (no re-normalize), strict cp1<->cp2 in RGB
  space, audio reactivity, and a calm fixed forward drift.

  NON-REPEATING MATH
    Three drift phases accumulate by delta at incommensurate rates
    (1.000 : 0.394 : 1.000/0.7) — irrational ratios so the grids never re-lock.
    Phases wrap at PHASE_WRAP = 10000 turns, far from any in-frame use, and the
    diagonal weave has its OWN accumulator (not a scaled copy of another wrapped
    phase) so no seam appears at a wrap (skill 12 §7).
    LocalSpeed is the sole rate magnitude. Radius changes spatial warp
    excursion without changing clock rate.

  AUDIO_MODULATION_V1:
    sliderLevel  <- micLow  range 0.30..1.00 curve pow2   # PRIMARY brightness (bass)
    sliderKick   <- micKick range 0.00..1.00 curve linear # beat pop on the lattice
    sliderRadius <- micFlux range 0.40..0.90 curve linear # lattice displacement excursion
    sliderDetail <- micHigh range 0.30..0.90 curve linear # star/node microstructure
  # Static (not audio-mapped): localSpeed, latticeScale, lineSoftness,
  # colorPalette1/2 — operator-set geometry/colour, not modulated.
*/

// ── Exported controls (UI order = declaration order) ─────────────────────────
// Canonical append-only optional fixture roles; absent roles match no pixels.
var FIX_RAW_LED = 1;
var FIX_TE_SIGN = 7;

export var localSpeed = 0.5;   // drift rate (0 still creeps, 1 ~4x faster)
export var level = 0.5;        // PRIMARY audio: overall brightness (micLow); mid = calm-but-lit
export var kick = 0.0;         // audio: kick brightness pop (micKick); 0 = no pop until beat
export var radius = 0.5;       // audio: lattice displacement excursion (micFlux)
export var detail = 0.5;       // audio: distinct star/node microstructure (micHigh)
export var latticeScale = 0.5; // base grid density (0..1; scaled in render)
export var lineSoftness = 0.5; // base line crispness (0..1; scaled in render)

export var cp1H = 0.68, cp1S = 0.95, cp1V = 1.0; // base (blue)
export var cp2H = 0.92, cp2S = 0.95, cp2V = 1.0; // accent (pink/magenta)
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderLevel(v) { level = v; }
export function sliderKick(v) { kick = v; }
export function sliderRadius(v) { radius = v; }
export function sliderDetail(v) { detail = v; }
export function sliderLatticeScale(v) { latticeScale = v; }
export function sliderLineSoftness(v) { lineSoftness = v; }

var phaseA = 0.0;
var phaseB = 0.0;
var phaseAd = 0.0;       // diagonal weave — its OWN accumulator (no scaled share)
var phaseDepth = 0.0;    // colour-depth drift
var liveScale = 6.0;     // resolved lattice scale this frame
var liveSoft = 2.0;      // resolved line softness this frame
var PHASE_WRAP = 10000.0;

// ── Palette RGB cache ─────────────────────────────────────────────────
var pr1 = 1, pg1 = 0, pb1 = 0;
var pr2 = 0, pg2 = 0, pb2 = 1;
function _hsv2rgb1() {
  var hv = cp1H - floor(cp1H); if (hv < 0) hv += 1;
  var iv = floor(hv * 6) % 6;
  var fv = hv * 6 - floor(hv * 6);
  var pv = cp1V * (1 - cp1S);
  var qv = cp1V * (1 - fv * cp1S);
  var tv = cp1V * (1 - (1 - fv) * cp1S);
  if      (iv == 0) { pr1 = cp1V; pg1 = tv;   pb1 = pv;   }
  else if (iv == 1) { pr1 = qv;   pg1 = cp1V; pb1 = pv;   }
  else if (iv == 2) { pr1 = pv;   pg1 = cp1V; pb1 = tv;   }
  else if (iv == 3) { pr1 = pv;   pg1 = qv;   pb1 = cp1V; }
  else if (iv == 4) { pr1 = tv;   pg1 = pv;   pb1 = cp1V; }
  else             { pr1 = cp1V; pg1 = pv;   pb1 = qv;   }
}
function _hsv2rgb2() {
  var hv = cp2H - floor(cp2H); if (hv < 0) hv += 1;
  var iv = floor(hv * 6) % 6;
  var fv = hv * 6 - floor(hv * 6);
  var pv = cp2V * (1 - cp2S);
  var qv = cp2V * (1 - fv * cp2S);
  var tv = cp2V * (1 - (1 - fv) * cp2S);
  if      (iv == 0) { pr2 = cp2V; pg2 = tv;   pb2 = pv;   }
  else if (iv == 1) { pr2 = qv;   pg2 = cp2V; pb2 = pv;   }
  else if (iv == 2) { pr2 = pv;   pg2 = cp2V; pb2 = tv;   }
  else if (iv == 3) { pr2 = pv;   pg2 = qv;   pb2 = cp2V; }
  else if (iv == 4) { pr2 = tv;   pg2 = pv;   pb2 = cp2V; }
  else             { pr2 = cp2V; pg2 = pv;   pb2 = qv;   }
}

function clamp01(v) {
  if (v < 0.0) return 0.0;
  if (v > 1.0) return 1.0;
  return v;
}

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;
  var localMultiplier = pow(2.0, (localSpeed - 0.5) * 4.0);

  // Radius never enters the clocks; render uses it only as warp excursion.
  // Fixed positive heading keeps the drift predictable; LocalSpeed is the
  // sole rate control.
  var travelRate = localMultiplier;

  // Incommensurate drift rates (turns/sec); the diagonal weave gets its own
  // accumulator so a wrap never seams.
  phaseA  = phaseA  + dt * 0.90 * travelRate;  if (phaseA  >= PHASE_WRAP) phaseA  -= PHASE_WRAP; else if (phaseA  <= -PHASE_WRAP) phaseA  += PHASE_WRAP;
  phaseB  = phaseB  + dt * 0.355 * travelRate; if (phaseB  >= PHASE_WRAP) phaseB  -= PHASE_WRAP; else if (phaseB  <= -PHASE_WRAP) phaseB  += PHASE_WRAP;
  phaseAd = phaseAd + dt * 1.286 * travelRate; if (phaseAd >= PHASE_WRAP) phaseAd -= PHASE_WRAP; else if (phaseAd <= -PHASE_WRAP) phaseAd += PHASE_WRAP;
  phaseDepth = phaseDepth + dt * 0.21 * travelRate; if (phaseDepth >= PHASE_WRAP) phaseDepth -= PHASE_WRAP; else if (phaseDepth <= -PHASE_WRAP) phaseDepth += PHASE_WRAP;

  // LatticeScale owns grid density; LineSoftness alone owns line width.
  liveScale = 2.0 + latticeScale * 12.0;        // 0..1 -> 2..14 (density)
  // 0 is narrow/crisp; 1 is broad/soft.
  liveSoft = 4.8 - lineSoftness * 3.8;
  _hsv2rgb1();
  _hsv2rgb2();
}

export function render3D(index, x, y, z) {
  // Coords are already 0..1 — use directly (clamped). (No re-normalize: that was
  // the historical regression that rendered this pattern dim/black.)
  var nx = clamp01(x);
  var ny = clamp01(y);
  var nz = clamp01(z);

  // Radius is spatial excursion only. These moving warps travel on existing
  // clocks, so increasing Radius moves lines farther without changing rate.
  var warpX = (wave(ny * 1.37 + phaseB * 0.21) - 0.5) * radius * 0.34;
  var warpY = (wave(nx * 1.91 - phaseA * 0.17) - 0.5) * radius * 0.34;
  var gridX = wave((nx + warpX) * liveScale + phaseA);
  var gridY = wave((ny + warpY) * liveScale * 0.72 - phaseB);
  var diagonal = wave((nx - ny + warpX - warpY) * liveScale * 0.38 + phaseAd);

  // Crossed grids + diagonal weave. PRODUCT of the two grids (og identity): the
  // crossed-grid product lights crisp lattice intersections over a near-black void
  // — that high contrast is what makes the drift read as motion. (A sum-of-ridges
  // washed the rig and hid the drift.)
  var lattice = max(gridX * gridY, diagonal * 0.65);
  lattice = pow(lattice, liveSoft);

  // Detail adds a separate node/star layer. It never enters liveSoft and
  // therefore cannot silently act as a second line-width control.
  var starSeed = wave(index * 0.618034 + phaseAd * 0.173
    + nx * 2.31 - ny * 1.73);
  var microStar = pow(starSeed, 14.0 - detail * 9.0) * detail;
  var nodeMicro = pow(gridX * gridY, 2.4) * detail;
  var micro = max(microStar, nodeMicro * 0.72);

  // Colour depth blends cp1<->cp2 in RGB space (no hsv() hue traversal).
  var depth = wave(nx * 0.6 + ny * 0.9 + phaseDepth);

  // Brightness: crisp lattice over a tiny clock-driven base floor so silence is
  // calm-but-visible and voids read near-black (og used 0.04 + lattice*0.9).
  var bri = 0.014 + lattice * 0.92;
  var matchedWhite = 0.0;
  var warmAdd = 0.0;

  if (fixtureType == FIX_BAR_18) {
    // Bars are the main crossed-lattice canvas.
    bri = 0.012 + lattice * 0.96 + micro * 0.22;
  } else if (fixtureType == FIX_RAW_LED) {
    // Opposing X/Y edge travel lets strands trace the lattice perimeter.
    var opposingEdges = max(pow(gridX, liveSoft * 0.78),
      pow(gridY, liveSoft * 0.78));
    bri = 0.010 + opposingEdges * 0.62 + micro * 0.18;
  } else if (fixtureType == FIX_VINTAGE_6) {
    // Sparse golden-white stars are the Jewelry layer.
    bri = 0.010 + lattice * 0.20 + microStar * 0.68;
    matchedWhite = microStar * (0.22 + detail * 0.66);
    warmAdd = microStar * 0.24;
  } else if (fixtureType == FIX_PAR) {
    // Pars pulse warmly only at lattice nodes.
    var nodePulse = nodeMicro * (0.34 + wave(phaseDepth * 0.381966) * 0.66);
    bri = 0.012 + lattice * 0.26 + nodePulse * 0.52;
    warmAdd = nodePulse * 0.34;
    matchedWhite = nodePulse * 0.09;
  } else if (fixtureType == FIX_TE_SIGN) {
    // Identity is a rigid cosmic instrument: two straight lattice axes move
    // in opposition while a diagonal weave crosses them. XYZ fixes the grid
    // geometry to the ship; there is deliberately no organic warp or sway.
    var signGridX = wave(nx * 3.70 + ny * 0.31 + nz * 0.17
      + phaseA * 0.66);
    var signGridY = wave(ny * 3.10 - nx * 0.29 + nz * 0.23
      - phaseB * 2.58);
    var signCross = pow(signGridX * signGridY, 2.15);
    var signDiagonal = pow(wave((nx - ny) * 2.80 + nz * 0.37
      + phaseAd * 0.37), 4.2);
    var signLattice = max(signCross, signDiagonal * 0.62);

    // Star locations are immutable letter-stroke addresses. Only their smooth
    // lifecycle changes, so the sign reads as a constellation rather than a
    // traveling wash or per-frame sparkle noise.
    var signStarSeed = wave(pixelLocalIndex * 0.381966
      + nx * 1.17 + ny * 0.69 + nz * 0.43);
    var signStarSelected = (signStarSeed < 0.12 + detail * 0.10) ? 1.0 : 0.0;
    var signStarLife = wave(phaseAd * (0.39 + signStarSeed * 0.165)
      + signStarSeed * 0.73 + nx * 0.07 - ny * 0.05);
    var signStars = pow(signStarLife, 3.7 + detail * 2.3)
      * signStarSelected;

    // The palette-derived floor keeps both letterforms continuously readable;
    // moving lattice intersections and fixed stars provide the cosmic depth.
    bri = 0.30 + signLattice * 0.22 + signStars * 0.31;
    depth = 0.08 + signLattice * 0.31 + signStars * 0.45;
  } else {
    bri = 0.014 + lattice * 0.78 + micro * 0.28;
  }

  // PRIMARY: overall brightness from micLow. Brightness is dominated by a strong
  // level term so total brightness tracks micLow (corr>=0.5); the lattice shapes
  // WHERE the light is, the bass sets HOW BRIGHT. Voids stay near-black.
  // level^2 keeps micLow dominant (PRIMARY corr) but the curve is lifted so the
  // mid default reads well-lit: 0 -> dim wash (not black), 0.5 -> bright lattice,
  // 1 -> full punch.
  // Static term kept low so the default look matches the og (crisp lattice over a
  // near-black void, no static wash): at level=0.5 the gain is ~1.0 (og parity),
  // while the bass still drives the punch and voids stay near-black.
  var levelGain = 0.16 + level * (1.0 + level * 1.7); // 0:0.16 0.5:1.09 1:2.86
  var pop = kick * 0.55 * (lattice + micro * 0.48);
  bri = min(1.0, (bri + pop) * levelGain);

  var r = (pr1 + (pr2 - pr1) * depth) * bri;
  var g = (pg1 + (pg2 - pg1) * depth) * bri;
  var b = (pb1 + (pb2 - pb1) * depth) * bri;
  r += warmAdd * levelGain;
  g += warmAdd * levelGain * 0.42;
  b += warmAdd * levelGain * 0.06;

  var w = clamp01(matchedWhite * levelGain);
  rgbwau(clamp01(r), clamp01(g), clamp01(b), w, w, 0.0);
}
