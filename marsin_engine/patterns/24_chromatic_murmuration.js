/*
  24_chromatic_murmuration.js — HD, audio-reactive flocking colour storm.

  IDENTITY (preserved): a murmuration of three flock-attractors swirling across
  the rig, each a soft glow, woven by ribbon filaments and a drifting shadow, in
  a cp1<->cp2 colour storm. Strict cp1<->cp2 blended in RGB-space.

  WHAT'S NEW
    - render3D coords are 0..1 (no re-normalize — old (x+1.264)/3.125 was a
      black-rendering regression).
    - localSpeed drives delta-accumulated orbit phases (creeps at 0, ~4x at 1).
    - Guarded `direction` control + AUTONOMOUS flock-direction variation: the
      orbit advance sign is the user dir modulated by a slow incommensurate swell
      that OCCASIONALLY reverses the whole flock on its own (period 1/√11 turns),
      so the murmuration wheels one way, hesitates, then wheels back — organic,
      never in lockstep with sibling patterns.
    - Audio sliders: level (PRIMARY brightness), kick (brightness pop),
      radius (flockReach = how far the flock travels), detail (filament density).

  NON-REPEATING MATH
    Three orbit centres driven by six harmonics accumulating at mutually
    irrational rates derived from base/{1, 0.41, 0.67, 1.3, 0.2, 0.8, 1.6, 0.3,
    1.9, 1.4} — each its own accumulator so no wrapped phase is scaled by a
    non-integer (avoids the §7 seam). Auto-dir at 1/√11 ≈ 0.30151. Wrap at
    PHASE_WRAP=10000 turns. Ribbon = wave((dA-dB+dC)*density + drift).

  AUDIO_MODULATION_V1:
    sliderLevel  <- micLow  range 0.30..1.00 curve linear  # PRIMARY brightness budget
    sliderKick   <- micKick range 0.00..1.00 curve pow2    # additive core pop on the beat
    sliderRadius <- micFlux range 0.20..1.00 curve linear  # flock reach / travel (build = wider sweep)
    sliderDetail <- micHigh range 0.25..1.00 curve linear  # filament density (sparkle/detail)
  (static, omit from playlist: sliderDirection, sliderFlockFocus, sliderContrast,
   sliderAfterglow, sliderLocalSpeed — these are operator-set, not audio-driven.)
*/

// ── Exported controls (UI order = declaration order) ──────────────────────────
export var localSpeed = 0.5;
export var direction = 0.06;    // 0..1; 0.5 center (guarded), <0.5 reverse wheel
export var level = 0.5;         // PRIMARY: overall brightness (audio: micLow 0.30..1.00)
export var kick = 0.0;          // additive core pop (audio: micKick 0..1 pow2)
export var radius = 0.34;       // flock reach / travel (audio: micFlux 0.20..1.00)
export var detail = 0.5;        // filament density (audio: micHigh 0.25..1.00)
export var flockFocus = 3.0;
export var contrast = 3.0;
export var afterglow = 0.135;

export var cp1H = 0.62, cp1S = 0.94, cp1V = 1.0; // cool blue
export var cp2H = 0.03, cp2S = 0.94, cp2V = 1.0; // warm red (wide hue sep)
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderDirection(v) {
  var d = (v * 2.0) - 1.0;
  if (d >= 0.0 && d < 0.06) d = 0.06; else if (d < 0.0 && d > -0.06) d = -0.06;
  direction = d;
}
// Audio sliders map the incoming signal (0..1) into a SANE range: a silence
// floor (so the rig stays alive at 0) up to a bright peak at full signal.
export function sliderLevel(v) { level = 0.30 + v * 0.70; }           // micLow  0.30..1.00 (PRIMARY)
export function sliderKick(v) { kick = v * v; }                       // micKick 0..1 pow2 (snappy pop)
export function sliderRadius(v) { radius = 0.20 + v * 0.28; }         // micFlux 0.20..0.48 physical reach
export function sliderDetail(v) { detail = 0.25 + v * 0.75; }         // micHigh 0.25..1.00 filament density
export function sliderFlockFocus(v) { flockFocus = 1.4 + v * 3.2; } // 1.4..4.6
export function sliderContrast(v) { contrast = 1.2 + v * 3.6; }     // 1.2..4.8
export function sliderAfterglow(v) { afterglow = v * 0.27; }        // 0..0.27 floor

// ── Tunables ──────────────────────────────────────────────────────────────────
var BASE_RATE = 0.18;   // orbit turns/sec at localSpeed = 1
var FIL_BASE = 7.0;     // filament density base
var PHASE_WRAP = 10000.0;

// ── Persistent orbit accumulators (delta-driven; each its own; §7) ────────────
var oA = 0.0, oB = 0.0, oC = 0.0;
var oB13 = 0.0, oC02 = 0.0, oA08 = 0.0, oC16 = 0.0, oA03 = 0.0, oB19 = 0.0, oA14 = 0.0;
var autoDir = 0.0;
var ribDrift = 0.0, shadDrift = 0.0;
// cached *TAU angles
var orbitA = 0, orbitB = 0, orbitC = 0;
var orbitB13 = 0, orbitC02 = 0, orbitA08 = 0, orbitC16 = 0, orbitA03 = 0, orbitB19 = 0, orbitA14 = 0;

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
  var localMultiplier = pow(2.0, (localSpeed - 0.5) * 4.0);

  // Autonomous wheel: slow incommensurate swell occasionally flips the sign.
  autoDir = wrap(autoDir + dt * localMultiplier * 0.30151);   // 1/√11 turns/sec
  var autoBias = sin(autoDir * 6.2831853 * 0.12);
  var blended = direction * (0.5 + 0.5 * autoBias);
  var sign = blended >= 0.0 ? 1.0 : -1.0;
  if (blended < 0.04 && blended > -0.04) sign = (autoBias >= 0.0) ? 1.0 : -1.0;

  var base = dt * localMultiplier * BASE_RATE * sign;
  oA   = wrap(oA   + base);
  oB   = wrap(oB   + base * 0.41);
  oC   = wrap(oC   + base * 0.67);
  oB13 = wrap(oB13 + base * 0.41 * 1.3);
  oC02 = wrap(oC02 + base * 0.67 * 2.7);
  oA08 = wrap(oA08 + base * 1.25);
  oC16 = wrap(oC16 + base * 0.67 * 1.6);
  oA03 = wrap(oA03 + base * 3.33);
  oB19 = wrap(oB19 + base * 0.41 * 1.9);
  oA14 = wrap(oA14 + base * 1.4);
  ribDrift  = wrap(ribDrift  + dt * localMultiplier * 0.05 * sign);
  shadDrift = wrap(shadDrift + dt * localMultiplier * 0.024 * sign);

  var TAU = 6.2831853;
  orbitA = oA * TAU; orbitB = oB * TAU; orbitC = oC * TAU;
  orbitB13 = oB13 * TAU; orbitC02 = oC02 * TAU; orbitA08 = oA08 * TAU;
  orbitC16 = oC16 * TAU; orbitA03 = oA03 * TAU; orbitB19 = oB19 * TAU; orbitA14 = oA14 * TAU;

  _hsv2rgb1();
  _hsv2rgb2();
}

export function render3D(index, x, y, z) {
  var nx = max(0.0, min(1.0, x));
  var ny = max(0.0, min(1.0, y));

  // Flock reach scales with radius (audio: micFlux) — wider sweep on a build.
  var reach = radius;
  var ax = 0.5 + reach * sin(orbitA + sin(orbitB) * 0.6) * 0.75;
  var ay = 0.5 + reach * cos(orbitB13 - orbitC02) * 0.68;
  var bx = 0.5 + reach * cos(orbitA08 + 2.2) * 0.86;
  var by = 0.5 + reach * sin(orbitC16 + orbitA03) * 0.6;
  var cx = 0.5 + reach * sin(orbitB19 - 1.1) * 0.66;
  var cy = 0.5 + reach * cos(orbitA14 + orbitC) * 0.72;

  var dA = hypot(nx - ax, ny - ay);
  var dB = hypot(nx - bx, ny - by);
  var dC = hypot(nx - cx, ny - cy);

  var aGlow = pow(max(0.0, 1.0 - dA * flockFocus), contrast);
  var bGlow = pow(max(0.0, 1.0 - dB * flockFocus), contrast);
  var cGlow = pow(max(0.0, 1.0 - dC * flockFocus), contrast);

  // Ribbon filaments; density rises with detail (audio: micHigh).
  var dens = FIL_BASE * (0.5 + detail * 1.2);
  var ribbon = wave((dA - dB + dC) * dens + ribDrift);
  var shadow = wave((nx * 1.3 - ny * 0.8) + shadDrift);
  // Bright crisp cores (high-def): glows drive hard, ribbon adds woven structure.
  // A sharp additive core spike lifts the peak channel toward 255 without
  // flooding the negative space (keeps true-black between flock members).
  var coreSpike = pow(aGlow, 1.4) + pow(bGlow, 1.4) + pow(cGlow, 1.4);
  var structure = afterglow + aGlow * 1.1 + bGlow * 1.0 + cGlow * 0.95
        + coreSpike * 1.1 + pow(ribbon, contrast) * 0.4;
  structure = structure * (0.82 + shadow * 0.18);

  // PRIMARY brightness gain (audio: micLow -> level): the level scales the WHOLE
  // structure as one budget (no per-element phase wobble) -> high corr. A
  // level-coupled ambient term spread over the whole rig makes total brightness
  // track level tightly (so the autonomous core motion doesn't drown the signal).
  // Kick adds a separate core pop. Small floor keeps silence visible.
  var ambient = (0.04 + 1.0 * structure) * level;
  var v = structure * 0.4 + ambient + coreSpike * kick * 0.5;
  v = max(0.0, min(1.8, v));

  // Colour: which flock (cp1 vs cp2) dominates this pixel, plus a wide nx sweep
  // so BOTH palette ends always span the rig. S-curve sharpens the two ends.
  var totalGlow = aGlow + bGlow + cGlow;
  var flockMix = totalGlow > 0.0 ? ((bGlow + cGlow) / totalGlow) : 0.5;
  var sweep = 0.5 + 0.5 * sin(nx * 3.0 + ribDrift * 6.2831853);
  var tVal = flockMix * 0.55 + sweep * 0.45;
  tVal = max(0.0, min(1.0, tVal));
  tVal = tVal * tVal * (3.0 - 2.0 * tVal);
  tVal = tVal * tVal * (3.0 - 2.0 * tVal);

  var r = (pr1 + (pr2 - pr1) * tVal) * v;
  var g = (pg1 + (pg2 - pg1) * tVal) * v;
  var b = (pb1 + (pb2 - pb1) * tVal) * v;

  rgb(min(1.0, r), min(1.0, g), min(1.0, b));
}
