/*
  22_abyssal_sway_garden.js — HD, audio-reactive underwater frond garden.

  IDENTITY (preserved): a garden of vertical fronds swaying in a slow abyssal
  current, phosphorescent tips flickering at the top, deep blue base fading into
  bioluminescent green. Strict cp1<->cp2 blended in RGB-space.

  WHAT'S NEW
    - localSpeed drives delta-accumulated current/flicker/tide phases (creeps at
      0, ~4x at 1).
    - Guarded `direction` control + AUTONOMOUS sway-direction variation: the
      current's lateral sign is the user dir modulated by a slow incommensurate
      swell that OCCASIONALLY reverses the bend on its own (period 1/√5 turns),
      so the garden leans one way, drifts, then leans back — never mechanical,
      never in lockstep with sibling patterns.
    - Audio sliders: level (PRIMARY brightness), kick (tip-flash brightness pop),
      radius (sway amplitude = how far fronds travel), detail (tip sparkle).

  NON-REPEATING MATH
    Current phase accumulates at 1.0, flicker at 5.3, tide at 0.073, auto-dir at
    1/√5 ≈ 0.44721 — mutually irrational rates. Per-frond offset
    sin(swayedX*11.7)*0.13 and frondPhase = swayedX*frondDensity de-sync the
    stalks. Phases wrap at PHASE_WRAP=10000 turns (far from any in-frame use).

  AUDIO (modulators-only — never read CPC audio globals natively):
      MODULATE sliderLevel  (level)  <- micLow    // PRIMARY -> overall brightness
      MODULATE sliderKick   (kick)   <- micKick   // tip-flash / brightness pop
      MODULATE sliderRadius (radius) <- micFlux   // sway amplitude (travel)
      MODULATE sliderDetail (detail) <- micHigh   // tip sparkle
*/

// ── Exported controls (UI order = declaration order) ──────────────────────────
export var localSpeed = 0.5;
export var direction = 0.7;     // 0..1; 0.5 center (guarded), <0.5 lean reverse
export var level = 0.7;         // PRIMARY: overall brightness (audio: micLow)
export var kick = 0.0;          // tip-flash / brightness pop (audio: micKick)
export var radius = 0.5;        // sway amplitude / travel (audio: micFlux)
export var detail = 0.45;       // tip sparkle (audio: micHigh)
export var frondDensity = 7.0;
export var tipGlow = 0.55;
export var baseDarkness = 0.55;

export var cp1H = 0.60, cp1S = 0.95, cp1V = 1.0; // deep abyssal blue
export var cp2H = 0.33, cp2S = 0.95, cp2V = 1.0; // bioluminescent green (wide sep)
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
export function sliderFrondDensity(v) { frondDensity = 3.0 + v * 14.0; }
export function sliderTipGlow(v) { tipGlow = v; }
export function sliderBaseDarkness(v) { baseDarkness = v; }

// ── Tunables ──────────────────────────────────────────────────────────────────
var CURRENT_RATE = 0.16;   // current turns/sec at localSpeed = 1
var PHASE_WRAP = 10000.0;

// ── Persistent phases (delta-accumulated; §6/§7) ──────────────────────────────
var current = 0.0;
var flicker = 0.0;
var tide = 0.0;
var autoDir = 0.0;
var tCurrent = 0.0;        // current*TAU cached
var tFlicker = 0.0;
var tTide = 0.0;           // raw turns (used in sin(tTide*TAU))
var swayAmp = 0.35;        // resolved sway amplitude (signed) this frame

// ── Palette RGB cache ─────────────────────────────────────────────────────────
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

  // Autonomous lean: slow incommensurate swell occasionally flips the bend sign.
  autoDir = autoDir + dt * localMultiplier * 0.44721;  // 1/√5 turns/sec
  if (autoDir >= PHASE_WRAP) autoDir = autoDir - PHASE_WRAP;
  var autoBias = sin(autoDir * 6.2831853 * 0.15);      // slow -1..1 swell
  var blended = direction * (0.5 + 0.5 * autoBias);
  var sign = blended >= 0.0 ? 1.0 : -1.0;
  if (blended < 0.04 && blended > -0.04) sign = (autoBias >= 0.0) ? 1.0 : -1.0;

  // Sway amplitude grows with radius (audio: micFlux). Signed by lean direction.
  swayAmp = (0.18 + radius * 0.55) * sign;

  current = current + dt * localMultiplier * CURRENT_RATE;
  if (current >= PHASE_WRAP) current = current - PHASE_WRAP;
  flicker = flicker + dt * localMultiplier * CURRENT_RATE * 5.3;
  if (flicker >= PHASE_WRAP) flicker = flicker - PHASE_WRAP;
  tide = tide + dt * localMultiplier * CURRENT_RATE * 0.073;
  if (tide >= PHASE_WRAP) tide = tide - PHASE_WRAP;

  tCurrent = current * 6.2831853;
  tFlicker = flicker * 6.2831853;
  tTide = tide;

  _hsv2rgb1();
  _hsv2rgb2();
}

export function render3D(index, x, y, z) {
  var nx = max(0.0, min(1.0, x));
  var ny = max(0.0, min(1.0, y));

  // Tall Vintage heads (sectionId == 2) are the tallest fronds with the
  // brightest tips — lift their effective height + tip strength.
  var tall = 0.0;
  if (sectionId == 2) tall = 1.0;
  var nyEff = max(0.0, min(1.0, ny + tall * 0.22));

  // Per-frond lateral sway — higher fronds bend more (cantilever ny^2). The
  // bend sign is the autonomous+user direction; amplitude tracks radius/audio.
  var bend = sin(tCurrent + nx * 4.0) * swayAmp * nyEff * nyEff;
  var bendSlow = sin(tCurrent * 0.41 + nx * 2.3) * swayAmp * nyEff * 0.5;
  var swayedX = nx + bend + bendSlow;

  // Vertical fronds: a phase pattern in x produces tall thin stalks.
  var frondPhase = swayedX * frondDensity + sin(swayedX * 11.7) * 0.13;
  var frond = wave(frondPhase);
  frond = pow(frond, 1.8);                 // crisp spine, soft sides (wider stalk)

  var heightWeight = 0.35 + pow(nyEff, 1.2) * 0.65;
  var body = frond * heightWeight;

  // Phosphorescent tip flicker — top band only, jittered per frond. Tip sparkle
  // scales with detail (audio: micHigh); tips flash brighter on the kick.
  var tipBand = pow(max(0.0, nyEff - 0.55) / 0.45, 1.5);
  var flick = wave(tFlicker + swayedX * 7.3 + nyEff * 2.1);
  flick = pow(flick, 4.0);
  var tipFlicker = tipBand * flick * tipGlow * (1.0 + tall * 0.6) * frond
                 * (0.5 + detail * 1.0) * (1.0 + kick * 1.8);

  // Long slow tide breath of the whole garden.
  var tideBreath = 0.8 + sin(tTide * 6.2831853) * 0.2;

  // Non-black bioluminescent floor so silence is calm-but-visible.
  var glowFloor = (0.06 + baseDarkness * 0.10) * (0.6 + 0.4 * heightWeight);
  var shimmer = 0.5 + 0.5 * sin(tCurrent * 0.7 + nx * 5.0 + ny * 3.0);
  var v = body * 0.85 + tipFlicker;
  v = v * tideBreath + glowFloor * (0.7 + 0.3 * shimmer);

  // PRIMARY brightness gain (audio: micLow -> level). Level-driven gain that
  // does NOT wobble with animation phase -> high corr. Kick adds a small pop.
  v = v * (0.22 + level * 1.25) + body * kick * 0.25;
  v = max(0.0, min(1.4, v));

  // Palette spans the rig: a slow nx sweep (full 0..1 across the bars) sets the
  // base hue from cp1(blue, left) to cp2(green, right); height + tip flicker
  // push toward cp2 (tips glow green). An S-curve sharpens to the two ENDS so
  // the rig reads as a crisp two-colour garden (drives hueSpread).
  var hueSweep = nx + 0.2 * sin(tCurrent * 0.3 + ny * 2.0);
  var tVal = hueSweep * 0.7 + pow(nyEff, 1.3) * 0.35 + tipFlicker * 0.6;
  tVal = max(0.0, min(1.0, tVal));
  tVal = tVal * tVal * (3.0 - 2.0 * tVal);
  tVal = tVal * tVal * (3.0 - 2.0 * tVal);

  var r = (pr1 + (pr2 - pr1) * tVal) * v;
  var g = (pg1 + (pg2 - pg1) * tVal) * v;
  var b = (pb1 + (pb2 - pb1) * tVal) * v;

  rgb(min(1.0, r), min(1.0, g), min(1.0, b));
}
