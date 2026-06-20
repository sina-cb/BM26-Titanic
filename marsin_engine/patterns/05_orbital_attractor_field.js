/*
  05_orbital_attractor_field.js
  Orbital Attractor Field

  Three orbiting attractor points sweep the rig. Each orbit has its own radius
  (orbit1/2/3) and signed rate (r1/r2/r3 → per-orbit direction sense). Every
  pixel lights by its NEAREST attractor: distance → falloff → focus gives a
  crisp bright core that fades to a near-true-black field. Colour blends strict
  cp1 (red) → cp2 (yellow/orange) in RGB space (helpers copied verbatim from
  27_swipe), with a SUBTLE colorVariation drift. Per section:
    - bars    (sectionId 3) : plain colour cores
    - vintage (sectionId 2) : W + amber heads — kick-driven AUDIENCE BLINDERS
    - pars    (sectionId 1) : brighter cores + a white core punch
  A blackoutTexture knob carves moving dark cells over the field.

  COORDS: render3D x,y,z are ALREADY normalized 0..1 — used directly (clamped),
  never re-normalized (the old (wx+1.264)/3.125 & wy/6.5 rendered this black).

  SPEED / DIRECTION
    - localSpeed (first control) scales orbit motion: pow(2,(localSpeed-0.5)*4).
      At 0 the orbits still CREEP (a small floor rate); at 1 they sweep ~16x.
    - sliderDirection sets the OVERALL orbit rotation sense on top of the per-
      orbit r-signs. Guarded so the effective sign is never exactly 0 (no freeze
      at slider centre).
    - Autonomous direction VARIATION: an irrational-period accumulator drives a
      golden-ratio cadence that OCCASIONALLY auto-reverses the whole field's
      orbit sense on its own — organic, never in lockstep, never stalls.

  NON-REPEATING MATH: each orbit angle uses its own time() base divided by its
  irrational |rate|; colour drifts use wrap-clean 0.41/0.73/1.17 time bases; the
  auto-flip accumulator wraps at a LARGE multiple (PHASE_WRAP=10000) so a wrapped
  phase that is later multiplied never seams (skill §7).

  AUDIO (modulators-only — never read CPC audio globals natively). The block
  below is the STRICT source of truth a generator parses for the deploy playlist.

AUDIO_MODULATION_V1:
  sliderLevel          <- micLow  range 0.30..1.00 curve linear  # overall brightness (PRIMARY)
  sliderKick           <- micKick range 0.00..1.00 curve pow2    # vintage W blinder pop (sec 2)
  sliderRadius         <- micFlux range 0.40..0.90 curve linear  # how far attractors travel
  sliderColorVariation <- micHigh range 0.30..0.85 curve linear  # colour shimmer / warm-arc spread (secondary)
  sliderWhiteLevel     <- micLow  range 0.30..0.80 curve linear  # overall white keep
  sliderWhiteKick      <- micKick range 0.00..1.00 curve pow2    # vintage-head blinder pop
  # STATIC (omit from audio): localSpeed, direction, falloff, focus, blackoutTexture, blinderBite, colorPalette1/2

  The vintage heads (sectionId==2) are the headline audience BLINDER: a small
  always-on warm-white keep (whiteLevel) near attractor cores, driven HARD on the
  kick (whiteKick + the kick slider) for the punch. blinderBite shapes how
  snappy/hard the bite lands (pow on the kick envelope). The pars (sectionId==1)
  carry a gentler white core scaled by whiteLevel. White is ADDITIVE over the
  cp1↔cp2 field (hueSpread stays >=0.10 — never washes the rig white).
*/

// ── Exported controls (UI order = declaration order) ─────────────────────────
export var localSpeed = 0.5;       // FIRST — drives orbit motion rate
export var level = 0.5;            // PRIMARY overall brightness (micLow) — mid; swings up
export var kick = 0.0;            // kick brightness pop / vintage blinder (micKick) —
                                  // transient; steady lift dilutes the PRIMARY corr.
export var radius = 0.5;           // movement RADIUS boost (micFlux)
export var direction = 0.5;        // overall orbit sense (0.5 = neutral, guarded)
export var orbit1 = 0.40;          // internal config (no slider) — per-orbit radius
export var orbit2 = 0.50;
export var orbit3 = 0.30;
export var r1 = 1.0;               // internal config (no slider) — signed per-orbit rate
export var r2 = -1.5;
export var r3 = 2.0;
export var falloff = 0.5;          // core falloff (identity slider; scaled in render3D)
export var focus = 0.5;            // core focus power (identity slider; scaled in render3D)
export var colorVariation = 0.5;   // colour drift / warm-arc spread
export var blackoutTexture = 0.0;  // moving dark-cell mask — destructive; 0 default keeps
                                   // the field whole (mid-default punches mission-critical
                                   // visibility holes). Full 0..1 range still available.
export var whiteLevel = 0.5;       // WHITE: overall white amount / keep (micLow)
export var whiteKick = 0.3;        // WHITE: kick-driven blinder bite (transient; low static
                                   // default so steady white does not wash the hue)
export var blinderBite = 0.5;      // WHITE: how snappy/hard the blinder attack lands

export var cp1H = 0.92, cp1S = 1.0, cp1V = 1.0; // Classic Red (deep crimson-red)
export var cp2H = 0.18, cp2S = 1.0, cp2V = 1.0; // Yellow/Orange (gold->yellow)
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderLevel(v) { level = v; }
export function sliderKick(v) { kick = v; }
export function sliderRadius(v) { radius = v; }
export function sliderDirection(v) { direction = v; }
export function sliderFalloff(v) { falloff = v; }
export function sliderFocus(v) { focus = v; }
export function sliderColorVariation(v) { colorVariation = v; }
export function sliderBlackoutTexture(v) { blackoutTexture = v; }
export function sliderWhiteLevel(v) { whiteLevel = v; }
export function sliderWhiteKick(v) { whiteKick = v; }
export function sliderBlinderBite(v) { blinderBite = v; }

// ── Palette RGB cache — VERBATIM from 27_swipe (blend in RGB, not HSV) ────────
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
  else              { pr1 = cp1V; pg1 = pv;   pb1 = qv;   }
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
  else              { pr2 = cp2V; pg2 = pv;   pb2 = qv;   }
}

function clamp01(v) {
  if (v < 0.0) return 0.0;
  if (v > 1.0) return 1.0;
  return v;
}

// ── Persistent state ─────────────────────────────────────────────────────────
// Large wrap = an exact integer multiple of 2π so wrapping an accumulated ANGLE
// leaves cos/sin unchanged (no seam). 1000 * 2π.
var PHASE_WRAP = 6283.18530718;
var beatPhase = 0.0;          // for blackoutTexture animation
var b1 = 0.0, b2 = 0.0, b3 = 0.0;          // ACCUMULATED orbit angles (wrap-clean)
var beatPhase041 = 0.0, beatPhase073 = 0.0, beatPhase117 = 0.0; // colour drifts
var autoFlip = 0.0;           // irrational-period accumulator for auto-reverse
var heading = 1.0;            // smoothed overall orbit sense this frame (~±1)
var headTarget = 1.0;         // discrete target sense (occasionally flips)

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  _hsv2rgb1();
  _hsv2rgb2();

  // localSpeed: 0.5->1x, 1->16x, 0->~1/16x but with a non-zero creep floor.
  var localMultiplier = pow(2.0, (localSpeed - 0.5) * 4.0);

  // ── Direction: guarded manual sense (never exactly 0) ──────────────────────
  var manualDir = (direction * 2.0) - 1.0;
  if (manualDir >= 0.0 && manualDir < 0.06) manualDir = 0.06;
  else if (manualDir < 0.0 && manualDir > -0.06) manualDir = -0.06;

  // ── Autonomous direction variation: occasional self auto-reverse ───────────
  // Irrational golden cadence picks a discrete target sense; `heading` chases
  // it SMOOTHLY so a reversal eases through zero-ish (no instant position jump,
  // no seam). The angle is INTEGRATED (accumulated), so even at the moment the
  // sense flips the angle keeps advancing continuously, just decelerating then
  // re-accelerating the other way.
  autoFlip = autoFlip + dt * localMultiplier * 0.017;
  if (autoFlip >= 10000.0) autoFlip = autoFlip - 10000.0; // integer wrap for wave()
  headTarget = wave(autoFlip * 1.6180339) < 0.5 ? -1.0 : 1.0; // golden cadence
  // ease heading toward target (time-constant ~0.8s of pattern time)
  var ease = dt * localMultiplier * 1.2;
  if (ease > 1.0) ease = 1.0;
  heading = heading + (headTarget - heading) * ease;

  // overall sense = guarded manual bias × autonomous smoothed heading; never 0
  var sense = manualDir * heading;
  if (sense >= 0.0 && sense < 0.04) sense = 0.04;
  else if (sense < 0.0 && sense > -0.04) sense = -0.04;

  // ── Orbit angles: INTEGRATE per-orbit angular velocity (rate sign × sense) ─
  // base rate per orbit ∝ |r_k|, plus a small creep so motion never stops at
  // localSpeed=0. Wrap at a LARGE multiple (skill §7) — angles feed cos/sin.
  var rate = localMultiplier * 0.30 + 0.04;   // turns/sec-ish (creep floor)
  var sgn1 = (r1 >= 0.0 ? 1.0 : -1.0) * sense;
  var sgn2 = (r2 >= 0.0 ? 1.0 : -1.0) * sense;
  var sgn3 = (r3 >= 0.0 ? 1.0 : -1.0) * sense;
  b1 = b1 + dt * rate * abs(r1) * sgn1 * 6.28318;
  b2 = b2 + dt * rate * abs(r2) * sgn2 * 6.28318;
  b3 = b3 + dt * rate * abs(r3) * sgn3 * 6.28318;
  if (b1 >= PHASE_WRAP) b1 = b1 - PHASE_WRAP; else if (b1 <= -PHASE_WRAP) b1 = b1 + PHASE_WRAP;
  if (b2 >= PHASE_WRAP) b2 = b2 - PHASE_WRAP; else if (b2 <= -PHASE_WRAP) b2 = b2 + PHASE_WRAP;
  if (b3 >= PHASE_WRAP) b3 = b3 - PHASE_WRAP; else if (b3 <= -PHASE_WRAP) b3 = b3 + PHASE_WRAP;

  beatPhase = time(0.05 / (localMultiplier + 0.0001));
  var s = 0.05 / (localMultiplier + 0.0001);
  beatPhase041 = time(s / 0.41);
  beatPhase073 = time(s / 0.73);
  beatPhase117 = time(s / 1.17);
}

export function render3D(index, x, y, z) {
  // Coords already 0..1 — use directly (clamped). NEVER re-normalize.
  var nx = clamp01(x);
  var ny = clamp01(y);

  // Movement radius: micFlux pushes attractors farther out (kept in bounds).
  var rad = 1.0 + radius * 0.6;
  var o1 = orbit1 * rad;
  var o2 = orbit2 * rad;
  var o3 = orbit3 * rad;

  var ax1 = 0.5 + o1 * cos(b1);
  var ay1 = 0.5 + o1 * sin(b1);
  var ax2 = 0.5 + o2 * cos(b2);
  var ay2 = 0.5 + o2 * sin(b2);
  var ax3 = 0.5 + o3 * cos(b3);
  var ay3 = 0.5 + o3 * sin(b3);

  var d1 = hypot(nx - ax1, ny - ay1);
  var d2 = hypot(nx - ax2, ny - ay2);
  var d3 = hypot(nx - ax3, ny - ay3);
  var d = min(d1, min(d2, d3));

  // falloff/focus shape the core: bright at attractor, near-black away.
  // NOTE: the pow base is floored to a tiny epsilon (never EXACTLY 0). On the
  // VM pow(0, foc) returns NaN, which poisoned `bri` and zeroed entire strands
  // on rigs where pixels land exactly outside an attractor's reach (the dark
  // strand on titanic). With the epsilon the field stays finite everywhere and
  // the coord-driven floor below lights every pixel.
  var fall = 1.0 + falloff * 5.0;   // map slider 0..1 -> 1..6
  var foc  = 1.0 + focus * 4.0;     // map slider 0..1 -> 1..5
  var v = pow(max(0.000001, min(1.0, 1.0 - d * fall)), foc);

  // Per-attractor influence -> which colour end dominates here.
  var influence1 = pow(max(0.000001, 1.0 - d1 * fall), foc);
  var influence2 = pow(max(0.000001, 1.0 - d2 * fall), foc);
  var influence3 = pow(max(0.000001, 1.0 - d3 * fall), foc);
  var influenceTotal = influence1 + influence2 + influence3 + 0.0001;

  // tCol spans cp1<->cp2 across the rig: blend by which attractor wins + a
  // position gradient so both colours appear across the whole field.
  // tCol spans the FULL cp1<->cp2 arc across the rig: position is the dominant
  // driver (so one end is pure cp1, the far end pure cp2 -> real hue spread),
  // the winning attractor and a drift add organic movement on top.
  var attractorBlend = (influence2 + influence3 * 0.5) / influenceTotal;
  var posGradient = nx * 0.85 + ny * 0.55 - 0.20;
  var drift = (wave((d1 - d2) * 1.7 + d3 * 0.9 + beatPhase041) - 0.5)
              * colorVariation * 0.30;
  var tCol = clamp01(posGradient + (attractorBlend - 0.5) * 0.35 + drift);

  // Extend tCol slightly past the strict line via colorVariation so the rig
  // spans a wider warm arc (red -> orange -> gold/yellow) — more two-colour
  // separation across the LEDs while staying in the warm palette family.
  var tWide = (tCol - 0.5) * (1.25 + colorVariation * 0.6) + 0.5;
  tWide = clamp01(tWide);

  // Strict cp1->cp2 RGB lerp (helpers verbatim) — stays near the palette line.
  var cr = pr1 + (pr2 - pr1) * tWide;
  var cg = pg1 + (pg2 - pg1) * tWide;
  var cb = pb1 + (pb2 - pb1) * tWide;

  // Overall brightness gain (PRIMARY, clean level->gain, no phase wobble).
  // Lower floor + steeper slope -> level dominates the brightness budget (tighter corr).
  var gain = 0.20 + level * 1.05;

  var bri = v * gain;

  // Small non-black floor so silence is calm-but-visible (mission critical).
  // COORD-DRIVEN (nx/ny only) so EVERY pixel on ANY rig lights from coordinates
  // alone — sections are additive accents below, never the source of light.
  // Kept comfortably above the visibility threshold across the whole field even
  // after the master/output attenuation — a pure-cp1 pixel only carries this
  // floor on its dim channels, so it must be generous enough to stay readable.
  var floorV = 0.16 + 0.060 * wave(nx * 0.7 + ny * 0.5 + beatPhase073);

  var outR = cr * bri;
  var outG = cg * bri;
  var outB = cb * bri;
  var outW = 0.0;
  var outA = 0.0;

  // ── Per-section roles ──────────────────────────────────────────────────────
  // White controls (clamped). whiteKeep = overall amount, whiteBite = kick pop,
  // bite = attack snap (pow on the kick envelope so higher = harder/snappier).
  var whiteKeep = clamp01(whiteLevel);
  var whiteBite = clamp01(whiteKick);
  var bite = clamp01(blinderBite);
  // Combined kick envelope driving the blinder: the kick slider IS the beat
  // envelope; whiteKick adds extra pop on top; blinderBite sharpens the attack.
  var kickEnv = clamp01(kick * (0.7 + 0.6 * whiteBite));
  kickEnv = pow(kickEnv, 1.0 + bite * 2.0);

  if (sectionId == 3) {
    // bars — plain colour cores
  } else if (sectionId == 2) {
    // vintage — headline audience BLINDER. Always-on warm-white keep near cores
    // (whiteKeep) glows tungsten; on the kick the W channel is driven HARD
    // (kickEnv) for the punch. Amber rides the warm keep for tungsten feel.
    outW = outW + v * v * (0.30 + 0.60 * whiteKeep) * gain;     // warm keep near cores
    outA = outA + v * 0.4 * gain;
    var blind = kickEnv * (0.5 + 0.5 * v);   // kick pop, strongest near a core
    outW = outW + blind;
    outA = outA + blind * 0.4;
  } else if (sectionId == 1) {
    // pars — brighter cores + a crisp white core punch (scaled by whiteLevel,
    // with an extra kick pop so the cores flash on the beat).
    outR = outR * 1.15;
    outG = outG * 1.15;
    outB = outB * 1.15;
    var core = max(0.0, 1.0 - d * fall * 2.0);
    outW = outW + core * (0.25 + 0.45 * whiteKeep) * (1.0 + kickEnv * 0.8) * gain;
  }

  // Subtle colour-variation value shimmer (kept gentle so we hug the palette).
  var shim = 0.90 + colorVariation * 0.10
             + (wave(nx * 2.7 + ny * 1.9 + beatPhase117) - 0.5) * colorVariation * 0.18;
  outR = outR * shim;
  outG = outG * shim;
  outB = outB * shim;

  // Add the non-black floor (tinted along the palette so it spans cp1<->cp2,
  // keeping hue spread across the rig even in the dark field).
  outR = outR + cr * floorV;
  outG = outG + cg * floorV;
  outB = outB + cb * floorV;

  // ── blackoutTexture: moving dark cells carved across the field ─────────────
  if (blackoutTexture > 0.0) {
    var cell = floor(nx * 17.0 + ny * 29.0 + index * 0.071);
    var maskA = wave(cell * 0.371 + beatPhase * 0.19);
    var maskB = wave((nx - ny) * 3.7 + beatPhase * 0.43);
    var movingCut = pow(maskB, 2.0 + blackoutTexture * 5.0);
    var sparseCut = maskA > (0.72 - blackoutTexture * 0.34) ? 1.0 : 0.0;
    var blackMask = clamp(1.0 - sparseCut * movingCut * blackoutTexture, 0.0, 1.0);
    outR = outR * blackMask;
    outG = outG * blackMask;
    outB = outB * blackMask;
    outW = outW * blackMask;
    outA = outA * blackMask;
  }

  // Final guarantee that EVERY pixel clears the visibility floor on EVERY rig:
  // re-floor each colour channel against a freshly-evaluated coord-driven
  // minimum (tinted along the palette). This also defends against any single
  // accumulated channel collapsing to zero — the base must always read.
  var floorR = cr * floorV;
  var floorG = cg * floorV;
  var floorB = cb * floorV;
  if (outR < floorR) outR = floorR;
  if (outG < floorG) outG = floorG;
  if (outB < floorB) outB = floorB;

  rgbwau(clamp01(outR), clamp01(outG), clamp01(outB),
         clamp01(outW), clamp01(outA), 0.0);
}
