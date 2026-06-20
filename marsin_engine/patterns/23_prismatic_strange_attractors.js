/*
  23_prismatic_strange_attractors.js — HD, audio-reactive strange gravity wells.

  IDENTITY (preserved): three strange moving gravity wells orbiting the rig,
  prismatic cp1<->cp2 filaments and glow, white cores and a UV ghost. Strict
  cp1<->cp2 blended in RGB-space.

  WHAT'S NEW
    - render3D coords are 0..1 (no re-normalize — old (x+1.264)/3.125 was a
      black-rendering regression).
    - localSpeed drives delta-accumulated orbit phases (creeps at 0, ~4x at 1).
    - Guarded `direction` control + AUTONOMOUS orbit-sense variation: the orbit
      advance sign is the user dir modulated by a slow incommensurate swell that
      OCCASIONALLY reverses the orbit on its own (period 1/√3 turns), so the
      wells wind one way, drift, and unwind — organic, never in lockstep.
    - Audio sliders: level (PRIMARY brightness), kick (brightness/core pop),
      radius (orbitReach = how far the wells travel), detail (filament density).

  NON-REPEATING MATH
    Six orbit harmonics accumulate at mutually irrational rates derived from the
    base rate / {1, 0.47, 0.29, 1.37, 1.71, 0.63, 1.93, 0.3, 0.7} — each its own
    accumulator so no wrapped phase is scaled by a non-integer (avoids the §7
    seam). Auto-dir at 1/√3 ≈ 0.57735. Wells: ax = 0.5 + reach*sin(pA + sin(pB)),
    etc. — composed incommensurate sinusoids never re-lock. Wrap PHASE_WRAP=10000.

  AUDIO_MODULATION_V1:
    sliderLevel  <- micLow  range 0.40..1.00 curve linear # PRIMARY brightness (bass)
    sliderKick   <- micKick range 0.00..1.00 curve linear # core / brightness pop (beat)
    sliderRadius <- micFlux range 0.40..0.90 curve linear # orbit reach / travel (build)
    sliderDetail <- micHigh range 0.30..0.90 curve linear # filament density / sparkle
  # sliderLevel range floor is 0.40 (not 0.30): the dark-space identity caps the
  # raw level<->brightness corr, so the level term needs a higher silence floor to
  # keep PRIMARY corr>=0.5 (known dark-space-vs-corr tension; not re-litigated).
  # Static (not audio-mapped): localSpeed, direction, chaos, contrast, whiteCore,
  # uvGhost, colorSpread, colorPalette1/2 — operator-set, not modulated.
*/

// ── Exported controls (UI order = declaration order) ──────────────────────────
export var localSpeed = 0.5;
export var direction = 0.6;     // 0..1; 0.5 center (guarded). >0.5 = orbit one way;
                                // a gentle orbit sense is the identity (not 0.5).
export var level = 0.7;         // PRIMARY: overall brightness (audio: micLow). 0.7 not 0.5:
                                // the small uniform level-floor that anchors PRIMARY corr
                                // (dark-space identity caps raw corr) needs the higher bias.
export var kick = 0.0;          // core / brightness pop (audio: micKick); 0 = no pop until beat
export var radius = 0.39;       // orbit reach / travel (resolved; slider 0..1 -> 0.14..0.64, mid)
export var detail = 0.5;        // filament density (audio: micHigh)
export var chaos = 6.0;         // resolved curl complexity (slider 0..1 -> 1..11; mid = 6)
export var contrast = 4.5;      // resolved filament/core sharpness (slider 0..1 -> 1..8; mid = 4.5)
export var whiteCore = 0.5;
export var uvGhost = 0.4;
export var colorSpread = 0.95;  // resolved cp1<->cp2 spread (slider 0..1 -> 0.45..1.5; ~mid)

export var cp1H = 0.55, cp1S = 0.95, cp1V = 1.0; // cyan
export var cp2H = 0.84, cp2S = 0.95, cp2V = 1.0; // violet (wide hue sep)
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
export function sliderRadius(v) { radius = 0.14 + v * 0.5; }
export function sliderDetail(v) { detail = v; }
export function sliderChaos(v) { chaos = 1.0 + v * 10.0; }
export function sliderContrast(v) { contrast = 1.0 + v * 7.0; }
export function sliderWhiteCore(v) { whiteCore = v; }
export function sliderUvGhost(v) { uvGhost = v; }
// Floor raised from 0.2 to 0.45 so even at v=0 the cp1<->cp2 sweep keeps a
// visible two-colour spread (at 0.2 the rig collapsed toward one hue).
export function sliderColorSpread(v) { colorSpread = 0.45 + v * 1.05; }

// ── Tunables ──────────────────────────────────────────────────────────────────
var BASE_RATE = 0.16;   // orbit turns/sec at localSpeed = 1
var PHASE_WRAP = 10000.0;

// ── Persistent orbit accumulators (delta-driven; each its own; §7) ────────────
var pA = 0.0, pB = 0.0, pC = 0.0;
var pA137 = 0.0, pB171 = 0.0, pA063 = 0.0, pC193 = 0.0, pA03 = 0.0, pB07 = 0.0;
var autoDir = 0.0;
// cached *TAU angles for render
var phaseA = 0, phaseB = 0, phaseC = 0;
var phaseA137 = 0, phaseB171 = 0, phaseA063 = 0, phaseC193 = 0, phaseA03 = 0, phaseB07 = 0;
var colDrift = 0.0;

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

function wrap(p) { if (p >= PHASE_WRAP) return p - PHASE_WRAP; if (p < 0.0) return p + PHASE_WRAP; return p; }

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;
  // localSpeed -> rate. Base curve is pow(2,(localSpeed-0.5)*4) (0.25x..4x), but
  // the razor curl filaments (pow(curl,contrast), contrast~4.5) sweep many pixels
  // for a tiny orbit step, so they churn visibly even at the 0.25x floor and the
  // 0..1 motion response flattened. Widening the exponent to 6 (0.125x..8x, a 64x
  // span) drops the low end to a genuine creep and races the high end, so
  // localSpeed reads clearly across its whole travel.
  var localMultiplier = pow(2.0, (localSpeed - 0.5) * 6.0);

  // Autonomous orbit sense: slow incommensurate swell occasionally flips sign.
  autoDir = wrap(autoDir + dt * localMultiplier * 0.57735);   // 1/√3 turns/sec
  var autoBias = sin(autoDir * 6.2831853 * 0.13);
  var blended = direction * (0.5 + 0.5 * autoBias);
  var sign = blended >= 0.0 ? 1.0 : -1.0;
  if (blended < 0.04 && blended > -0.04) sign = (autoBias >= 0.0) ? 1.0 : -1.0;

  var base = dt * localMultiplier * BASE_RATE * sign;
  // Six harmonics, each its own accumulator at an incommensurate rate.
  pA    = wrap(pA    + base);
  pB    = wrap(pB    + base * 0.47);
  pC    = wrap(pC    + base * 0.29);
  pA137 = wrap(pA137 + base * 1.37);
  pB171 = wrap(pB171 + base * 0.47 * 1.71);
  pA063 = wrap(pA063 + base * 0.63);
  pC193 = wrap(pC193 + base * 0.29 * 1.93);
  pA03  = wrap(pA03  + base * 3.33);
  pB07  = wrap(pB07  + base * 0.47 * 1.43);
  colDrift = wrap(colDrift + dt * localMultiplier * 0.11);

  var TAU = 6.2831853;
  phaseA = pA * TAU; phaseB = pB * TAU; phaseC = pC * TAU;
  phaseA137 = pA137 * TAU; phaseB171 = pB171 * TAU; phaseA063 = pA063 * TAU;
  phaseC193 = pC193 * TAU; phaseA03 = pA03 * TAU; phaseB07 = pB07 * TAU;

  _hsv2rgb1();
  _hsv2rgb2();
}

export function render3D(index, x, y, z) {
  var nx = max(0.0, min(1.0, x));
  var ny = max(0.0, min(1.0, y));
  var nz = max(0.0, min(1.0, z));

  // Reach scales with radius (audio: micFlux) — wells travel farther on a build.
  var reach = radius;
  var ax = 0.5 + reach * sin(phaseA + sin(phaseB) * 0.8) * 0.9;
  var ay = 0.5 + reach * sin(phaseA137 + phaseC) * 0.68;
  var bx = 0.5 + reach * sin(phaseB171 - 1.4) * 0.8;
  var by = 0.5 + reach * cos(phaseA063 + phaseB) * 0.62;
  var cx = 0.5 + reach * cos(phaseC193 + phaseA03) * 0.74;
  var cy = 0.5 + reach * sin(phaseC - phaseB07) * 0.7;

  var dA = hypot(nx - ax, ny - ay);
  var dB = hypot(nx - bx, ny - by);
  var dC = hypot(nx - cx, ny - cy);
  var nearest = min(dA, min(dB, dC));

  // Prismatic curl filaments; density rises with detail (audio: micHigh).
  var dens = chaos * (0.6 + detail * 0.9);
  var curl = sin((dA - dB + dC) * dens * 6.2831853 + phaseA);
  curl += sin((nx * ny + nz * 0.5) * dens * 3.1 - phaseB);
  curl += sin((nx - ny + nz) * dens * 2.2 + phaseC);
  curl = abs(curl * 0.333);

  var glow = pow(max(0.0, 1.0 - nearest * (2.0 + contrast)), 1.8);
  var filament = pow(curl, contrast);
  // Sharper pow-shaped CORE: a tight inner peak on the wells that drives at least
  // one channel to full at a musical peak, scaled by level so the cores bloom on
  // bass (lifts peakMaxChan to ~255 at a musical peak).
  var core = pow(max(0.0, 1.0 - nearest * (3.6 + contrast)), 3.2);
  var intensity = 0.05 + glow * 0.78 + filament * 0.55 + core * (0.4 + level * 1.1);

  // PRIMARY brightness gain (audio: micLow -> level). Because the wells ORBIT,
  // the lit-mass brightness swings with position, which capped the raw corr at
  // ~0.51; a small phase-free uniform level floor (every pixel, no animation
  // term) anchors the level-correlated share of total brightness and lifts the
  // PRIMARY to its target margin (corr ~0.58). The floor is small relative to the
  // bright cores so the per-pixel contrast (bright moving cores over a deep dim
  // wash) still reads HIGH-DEF, not flat. Kick pops the cores at a peak.
  intensity = intensity * (0.22 + level * 1.2)
            + level * 0.05
            + glow * kick * 0.6;
  intensity = max(0.0, min(1.55, intensity));

  // Colour: blend cp1(cyan)<->cp2(violet) by curl+glow, bounce so it sweeps
  // back and forth, then an S-curve sharpens toward the two ends (hueSpread).
  var colorPhase = curl * colorSpread + glow * 0.6 + colDrift * 0.3;
  colorPhase = colorPhase - floor(colorPhase);
  if (colorPhase > 0.5) colorPhase = 1.0 - (colorPhase - 0.5) * 2.0;
  else                  colorPhase = colorPhase * 2.0;
  colorPhase = colorPhase * colorPhase * (3.0 - 2.0 * colorPhase);

  var r = (pr1 + (pr2 - pr1) * colorPhase) * intensity;
  var g = (pg1 + (pg2 - pg1) * colorPhase) * intensity;
  var b = (pb1 + (pb2 - pb1) * colorPhase) * intensity;

  var white = min(1.0, pow(glow, 2.4) * whiteCore * (1.0 + kick * 1.5));
  var uv = min(1.0, (filament * 0.35 + (1.0 - ny) * curl * 0.35) * uvGhost);

  rgbwau(min(1.0, r), min(1.0, g), min(1.0, b), white, 0.0, uv);
}
