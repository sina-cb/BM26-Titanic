/*
  20_parametric_sway_field.js
  RGB parametric field with dancing attractors. Three glowing attractors wander
  the rig on a Lissajous of incommensurate harmonics; pixels glow by proximity,
  with a strict cp1<->cp2 colour mix in RGB-space (never hsv() interpolation).

  IDENTITY (preserved): the "dancing attractors" feel — soft glowing nodes that
  swim across the rig and trail colour between two palette ends.

  NON-REPEATING MATH
    Each attractor angle is a delta-accumulated phase advanced at its own rate
    base*k with k ∈ {1, 1.37, 0.73, 1.91, 1.21, 0.61, ...} — irrational ratios so
    the attractors never re-phase. Phases accumulate continuously and wrap at a
    large multiple of TAU (PHASE_WRAP = 10000*TAU) far from any in-frame use, so
    there is no seam (skill 12 §7).
    Autonomous direction: each phase is multiplied by a SMOOTHLY-varying rate
    sway (0.3 + 0.7*cos(slowClock)) * dirSign on two incommensurate slow clocks,
    so the effective rate eases through zero and occasionally reverses — never an
    instant sign flip (which would seam a wrapped phase), and the attractors
    never reverse in lockstep.

  AUDIO_MODULATION_V1:
    sliderLevel  <- micLow  range 0.30..1.00 curve pow2   # PRIMARY brightness (bass)
    sliderKick   <- micKick range 0.00..1.00 curve linear # beat brightness pop
    sliderRadius <- micFlux range 0.40..0.90 curve linear # attractor travel / movement
    sliderDetail <- micHigh range 0.30..0.90 curve linear # glow sharpness / sparkle
  # Static (not audio-mapped): localSpeed, direction, focus, trailBlend,
  # colorPalette1/2 — operator-set geometry/colour, not modulated.
*/

// ── Exported controls (UI order = declaration order) ─────────────────────────
export var localSpeed = 0.5;   // motion rate (0 still creeps, 1 ~4x faster)
export var direction = 0.5;    // 0.5 = balanced; <0.5 reverse, >0.5 forward (guarded)
export var level = 0.5;        // PRIMARY audio: overall brightness gain (micLow); mid = calm-but-lit
export var kick = 0.0;         // audio: kick brightness pop (micKick); 0 = no pop until beat
export var radius = 0.5;       // audio: movement radius / attractor travel (micFlux)
export var detail = 0.5;       // audio: glow sharpness / sparkle (micHigh)
export var focus = 0.5;        // base glow tightness 0..1 (scaled in render)
export var trailBlend = 0.5;   // colour-trail strength between attractors

export var cp1H = 0.55, cp1S = 0.92, cp1V = 1.0; // cyan
export var cp2H = 0.86, cp2S = 0.92, cp2V = 1.0; // violet/magenta
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
export function sliderFocus(v) { focus = v; }
export function sliderTrailBlend(v) { trailBlend = v; }

// Accumulating phase angles (radians). Each advances by delta * its own
// incommensurate rate * a SMOOTHLY-varying directional multiplier, so reversals
// are continuous (no seam) — never an instant sign flip on a wrapped phase.
var pA = 0.0, pB = 0.0, pC = 0.0, pD = 0.0, pE = 0.0, pF = 0.0;
var qA = 0.0, qB = 0.0, qC = 0.0, qD = 0.0, qE = 0.0;
var trailPhase = 0.0, mixPhase = 0.0;
var autoClockA = 0.0, autoClockB = 0.0; // slow clocks for autonomous reversal
var dirSign = 1.0;       // resolved slider direction this frame
var travel = 0.42;       // resolved movement radius this frame
var glowSharp = 1.6;
var PHASE_WRAP = 62831.853; // 10000*TAU — wrap far from any in-frame use (§7)

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

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;
  var localMultiplier = pow(2.0, (localSpeed - 0.5) * 4.0);

  // Slider direction (guarded away from 0) — never sits at a static center.
  dirSign = direction;
  if (dirSign >= 0.0 && dirSign < 0.06) dirSign = 0.06;
  else if (dirSign < 0.0 && dirSign > -0.06) dirSign = -0.06;

  // Autonomous direction variation: two SLOW incommensurate clocks whose cosine
  // smoothly crosses zero, so the effective rate eases through a reversal (no
  // seam). They run on different periods so attractors never flip in lockstep.
  autoClockA = autoClockA + dt * 0.105 * localMultiplier;
  autoClockB = autoClockB + dt * 0.071 * localMultiplier;
  if (autoClockA >= PHASE_WRAP) autoClockA = autoClockA - PHASE_WRAP;
  if (autoClockB >= PHASE_WRAP) autoClockB = autoClockB - PHASE_WRAP;
  // Bias toward +dirSign so motion mostly follows the slider but occasionally
  // eases backward; range ~[-0.4..+1.0] * dirSign.
  var swayA = (0.3 + 0.7 * cos(autoClockA)) * dirSign;
  var swayB = (0.3 + 0.7 * cos(autoClockB + 1.1)) * dirSign;

  // Base angular rate (rad/s) per harmonic; advanced by delta so localSpeed
  // (and the global SPEED fader) drive the rate. Incommensurate ratios.
  var base = 0.94 * localMultiplier; // ≈ old time(0.15)*TAU rate
  pA = pA + dt * base * 1.00  * swayA; if (pA >= PHASE_WRAP) pA -= PHASE_WRAP; else if (pA <= -PHASE_WRAP) pA += PHASE_WRAP;
  pB = pB + dt * base * 1.37  * swayB; if (pB >= PHASE_WRAP) pB -= PHASE_WRAP; else if (pB <= -PHASE_WRAP) pB += PHASE_WRAP;
  pC = pC + dt * base * 0.73  * swayA; if (pC >= PHASE_WRAP) pC -= PHASE_WRAP; else if (pC <= -PHASE_WRAP) pC += PHASE_WRAP;
  pD = pD + dt * base * 1.91  * swayB; if (pD >= PHASE_WRAP) pD -= PHASE_WRAP; else if (pD <= -PHASE_WRAP) pD += PHASE_WRAP;
  pE = pE + dt * base * 1.21  * swayA; if (pE >= PHASE_WRAP) pE -= PHASE_WRAP; else if (pE <= -PHASE_WRAP) pE += PHASE_WRAP;
  pF = pF + dt * base * 0.61  * swayB; if (pF >= PHASE_WRAP) pF -= PHASE_WRAP; else if (pF <= -PHASE_WRAP) pF += PHASE_WRAP;
  var baseQ = 0.50 * localMultiplier;
  qA = qA + dt * baseQ * 1.00 * swayA; if (qA >= PHASE_WRAP) qA -= PHASE_WRAP; else if (qA <= -PHASE_WRAP) qA += PHASE_WRAP;
  qB = qB + dt * baseQ * 0.70 * swayB; if (qB >= PHASE_WRAP) qB -= PHASE_WRAP; else if (qB <= -PHASE_WRAP) qB += PHASE_WRAP;
  qC = qC + dt * baseQ * 1.90 * swayA; if (qC >= PHASE_WRAP) qC -= PHASE_WRAP; else if (qC <= -PHASE_WRAP) qC += PHASE_WRAP;
  qD = qD + dt * baseQ * 0.50 * swayB; if (qD >= PHASE_WRAP) qD -= PHASE_WRAP; else if (qD <= -PHASE_WRAP) qD += PHASE_WRAP;
  qE = qE + dt * baseQ * 0.40 * swayA; if (qE >= PHASE_WRAP) qE -= PHASE_WRAP; else if (qE <= -PHASE_WRAP) qE += PHASE_WRAP;
  trailPhase = trailPhase + dt * 0.42 * localMultiplier * dirSign; if (trailPhase >= PHASE_WRAP) trailPhase -= PHASE_WRAP; else if (trailPhase <= -PHASE_WRAP) trailPhase += PHASE_WRAP;
  mixPhase   = mixPhase   + dt * 0.18 * localMultiplier * dirSign; if (mixPhase   >= PHASE_WRAP) mixPhase   -= PHASE_WRAP; else if (mixPhase   <= -PHASE_WRAP) mixPhase   += PHASE_WRAP;

  travel = 0.18 + radius * 0.55;
  glowSharp = 0.9 + detail * 3.0;
  _hsv2rgb1();
  _hsv2rgb2();
}

export function render3D(index, x, y, z) {
  // Coords arrive already normalized in [0,1]; use directly (clamped).
  var nx = max(0.0, min(1.0, x));
  var ny = max(0.0, min(1.0, y));

  var ax = 0.5 + travel * sin(pA) * cos(qB);
  var ay = 0.5 + travel * sin(pB + 0.8) * 0.62 + sin(qC) * 0.09;

  var bx = 0.5 + travel * sin(pC + 2.1) * 0.75;
  var by = 0.5 + travel * sin(pD - qE) * 0.55;

  var cx = 0.5 + travel * sin(pE - 1.4) * cos(qD) * 0.8;
  var cy = 0.5 + travel * sin(pF + qA + 1.2) * 0.58;

  var dA = hypot(nx - ax, ny - ay);
  var dB = hypot(nx - bx, ny - by);
  var dC = hypot(nx - cx, ny - cy);

  var nearest = min(dA, min(dB, dC));
  var focusK = 1.0 + focus * 3.5;   // 0..1 -> 1..4.5 (higher = crisper cores)
  var glow = pow(max(0.0, 1.0 - nearest * focusK), glowSharp) * 1.6;

  var trail = wave((dA - dB + dC) * 3.0 + trailPhase);
  // Small clock-driven base floor so silence stays calm-but-visible, but low
  // enough that the negative space reads near-black (high-def contrast).
  var v = 0.018 + glow + trail * trailBlend * 0.14;

  // PRIMARY: overall brightness from micLow. A small level-driven ambient floor
  // lifts the WHOLE rig with the bass (clean monotonic coupling, no phase wobble),
  // plus a level gain on the glow — together these make total brightness track
  // micLow strongly (corr>=0.5) while keeping crisp cores.
  // Ambient floor is gated by proximity to an attractor so true voids stay dark
  // (high-def negative space) while lit regions track the bass.
  var prox = max(0.0, 1.0 - nearest * 1.6);
  var ambient = level * 0.18 * prox;
  var gain = 0.12 + level * 1.30;
  // Kick pop: a clean additive brightness lift from micKick (kept secondary so
  // micLow stays the dominant brightness driver for PRIMARY corr).
  var pop = kick * 0.38;
  v = min(1.0, ambient + (v + pop) * gain);

  // Colour identity per attractor so BOTH palette ends span the rig (hueSpread):
  // attractor A pulls toward cp1 (mix 0), B toward cp2 (mix 1), C sits mid. The
  // nearest attractor dominates the local hue, plus a small positional drift.
  var mixVal = 0.5;
  if (dA <= dB && dA <= dC) mixVal = 0.04;
  else if (dB <= dA && dB <= dC) mixVal = 0.96;
  else mixVal = 0.5;
  mixVal = mixVal + (wave(nx * 0.5 + mixPhase) - 0.5) * 0.18;
  mixVal = max(0.0, min(1.0, mixVal));

  // Strict RGB lerp — no hsv() interpolation, no hue drift past cp1/cp2.
  var r = (pr1 + (pr2 - pr1) * mixVal) * v;
  var g = (pg1 + (pg2 - pg1) * mixVal) * v;
  var b = (pb1 + (pb2 - pb1) * mixVal) * v;

  rgb(r, g, b);
}
