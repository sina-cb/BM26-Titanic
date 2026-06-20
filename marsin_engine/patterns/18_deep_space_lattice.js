/*
  18_deep_space_lattice.js
  Drifting interference lattice — two crossed wave grids plus a diagonal weave
  slide across the rig, lighting crisp lattice lines over a near-black void with
  a slow cp1<->cp2 colour-depth gradient. The "deep space" feel: a cool grid that
  breathes and drifts like a starfield seen through a lens.

  IDENTITY (preserved): the crossed-grid lattice + diagonal weave + colour depth.
  Upgrades: 0..1 coords used directly (no re-normalize), strict cp1<->cp2 in RGB
  space, audio reactivity, guarded direction with autonomous reversal.

  NON-REPEATING MATH
    Three drift phases accumulate by delta at incommensurate rates
    (1.000 : 0.394 : 1.000/0.7) — irrational ratios so the grids never re-lock.
    Phases wrap at PHASE_WRAP = 10000 turns, far from any in-frame use, and the
    diagonal weave has its OWN accumulator (not a scaled copy of another wrapped
    phase) so no seam appears at a wrap (skill 12 §7).
    Autonomous direction: a smooth rate sway (0.35 + 0.65*cos(slowClock))*dirSign
    eases the drift through reversals on a slow incommensurate clock — not a hard
    sign flip — so motion is never one-way and never seams.

  AUDIO_MODULATION_V1:
    sliderLevel  <- micLow  range 0.30..1.00 curve pow2   # PRIMARY brightness (bass)
    sliderKick   <- micKick range 0.00..1.00 curve linear # beat pop on the lattice
    sliderRadius <- micFlux range 0.40..0.90 curve linear # drift travel / movement
    sliderDetail <- micHigh range 0.30..0.90 curve linear # line sharpness / sparkle
  # Static (not audio-mapped): localSpeed, direction, latticeScale, lineSoftness,
  # colorPalette1/2 — operator-set geometry/colour, not modulated.
*/

// ── Exported controls (UI order = declaration order) ─────────────────────────
export var localSpeed = 0.5;   // drift rate (0 still creeps, 1 ~4x faster)
export var direction = 0.5;    // 0.5 balanced; <0.5 reverse, >0.5 forward (guarded)
export var level = 0.5;        // PRIMARY audio: overall brightness (micLow); mid = calm-but-lit
export var kick = 0.0;         // audio: kick brightness pop (micKick); 0 = no pop until beat
export var radius = 0.5;       // audio: lattice scale / travel (micFlux)
export var detail = 0.5;       // audio: line sharpness / sparkle (micHigh)
export var latticeScale = 0.5; // base grid density (0..1; scaled in render)
export var lineSoftness = 0.5; // base line crispness (0..1; scaled in render)

export var cp1H = 0.62, cp1S = 0.95, cp1V = 1.0; // base (blue)
export var cp2H = 0.90, cp2S = 0.95, cp2V = 1.0; // accent (pink/magenta)
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderDirection(v) {
  var d = (v * 2.0) - 1.0;
  if (d >= 0.0 && d < 0.06) d = 0.06; else if (d < 0.0 && d > -0.06) d = -0.06;
  direction = d;
}
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
var autoClock = 0.0;     // slow clock for autonomous reversal
var dirSign = 1.0;
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

  dirSign = direction;
  if (dirSign >= 0.0 && dirSign < 0.06) dirSign = 0.06;
  else if (dirSign < 0.0 && dirSign > -0.06) dirSign = -0.06;

  // Autonomous reversal: smooth rate sway easing through zero (no hard flip).
  autoClock = autoClock + dt * 0.063 * localMultiplier;
  if (autoClock >= PHASE_WRAP) autoClock = autoClock - PHASE_WRAP;
  var sway = (0.35 + 0.65 * cos(autoClock)) * dirSign;

  // radius (micFlux) boosts the drift rate — lattice travels farther/faster.
  var travelRate = (0.6 + radius * 1.4) * localMultiplier * sway;

  // Incommensurate drift rates (turns/sec); the diagonal weave gets its own
  // accumulator so a wrap never seams.
  phaseA  = phaseA  + dt * 0.90 * travelRate;  if (phaseA  >= PHASE_WRAP) phaseA  -= PHASE_WRAP; else if (phaseA  <= -PHASE_WRAP) phaseA  += PHASE_WRAP;
  phaseB  = phaseB  + dt * 0.355 * travelRate; if (phaseB  >= PHASE_WRAP) phaseB  -= PHASE_WRAP; else if (phaseB  <= -PHASE_WRAP) phaseB  += PHASE_WRAP;
  phaseAd = phaseAd + dt * 1.286 * travelRate; if (phaseAd >= PHASE_WRAP) phaseAd -= PHASE_WRAP; else if (phaseAd <= -PHASE_WRAP) phaseAd += PHASE_WRAP;
  phaseDepth = phaseDepth + dt * 0.21 * localMultiplier * sway; if (phaseDepth >= PHASE_WRAP) phaseDepth -= PHASE_WRAP; else if (phaseDepth <= -PHASE_WRAP) phaseDepth += PHASE_WRAP;

  // radius drives how FAR the lattice lines travel per frame (movement), via a
  // drift-rate boost — it does NOT change the lit-area budget, so it doesn't
  // fight the level->brightness coupling. detail adds a touch of sharpness.
  liveScale = 2.0 + latticeScale * 12.0;        // 0..1 -> 2..14 (density)
  // line crispness: 0 -> broad glow bands, 0.5 -> balanced lattice, 1 -> razor lines.
  liveSoft = 1.0 + lineSoftness * 2.0 + detail * 0.7; // 0..1 -> ~1..3.7 (+detail)
  _hsv2rgb1();
  _hsv2rgb2();
}

export function render3D(index, x, y, z) {
  // Coords are already 0..1 — use directly (clamped). (No re-normalize: that was
  // the historical regression that rendered this pattern dim/black.)
  var nx = clamp01(x);
  var ny = clamp01(y);

  var gridX = wave(nx * liveScale + phaseA);
  var gridY = wave(ny * liveScale * 0.72 - phaseB);
  var diagonal = wave((nx - ny) * liveScale * 0.38 + phaseAd);

  // Crossed grids + diagonal weave. Sum-of-ridges (not pure product) keeps more
  // of the rig lit so the lattice reads bright and colour spans both palette ends,
  // while the softness power still sharpens the lines for a high-def look.
  var ridge = (gridX + gridY) * 0.5;
  var lattice = max(ridge, diagonal * 0.6);
  lattice = pow(lattice, liveSoft);

  // Colour depth blends cp1<->cp2 in RGB space (no hsv() hue traversal).
  var depth = wave(nx * 0.6 + ny * 0.9 + phaseDepth);

  // Brightness: crisp lattice over a tiny clock-driven base floor so silence is
  // calm-but-visible and voids read near-black.
  var bri = 0.02 + lattice * 1.10;

  // PRIMARY: overall brightness from micLow. Brightness is dominated by a strong
  // level term so total brightness tracks micLow (corr>=0.5); the lattice shapes
  // WHERE the light is, the bass sets HOW BRIGHT. Voids stay near-black.
  // level^2 keeps micLow dominant (PRIMARY corr) but the curve is lifted so the
  // mid default reads well-lit: 0 -> dim wash (not black), 0.5 -> bright lattice,
  // 1 -> full punch.
  var levelGain = 0.5 + level * (2.0 + level * 1.7); // 0:0.5 0.5:1.93 1:4.2
  var pop = kick * 0.55 * lattice;               // kick pop only on the lattice
  bri = min(1.0, (bri + pop) * levelGain);

  var r = (pr1 + (pr2 - pr1) * depth) * bri;
  var g = (pg1 + (pg2 - pg1) * depth) * bri;
  var b = (pb1 + (pb2 - pb1) * depth) * bri;

  rgb(clamp01(r), clamp01(g), clamp01(b));
}
