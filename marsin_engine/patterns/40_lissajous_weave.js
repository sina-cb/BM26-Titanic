/*
  40_lissajous_weave.js — a LISSAJOUS curve woven across the whole rig.

  A single parametric Lissajous figure is sampled into a moving polyline and
  painted onto the rig. Each pixel lights by its DISTANCE to the nearest point on
  the curve: a crisp bright core where the weave passes, TRUE BLACK far away. The
  two palette colours travel ALONG the curve (cp1 at one end of the parameter,
  cp2 at the other), so both hues thread through the weave as it moves.

  The curve uses INCOMMENSURATE frequencies so the woven path NEVER repeats:
      cx = 0.5 + amp * sin( (s*FX*SQRT2 + phase)        * PI2 )
      cy = 0.5 + amp * sin( (s*FY*SQRT3 + phase*PHI + d) * PI2 )
  SQRT2 (1.41421) on X and SQRT3 (1.73205) on Y are irrational and mutually
  incommensurate; the phase drift advances by the golden ratio PHI (1.61803) on
  Y so the lobes precess forever. `s` runs 0..1 over the sample points.

  CORE EQUATION (header bar 3):
      bri = (core / (1 + (dist*sharp)^2)) ;
      cx=0.5+amp*sin((s*FX*SQRT2+ph)*PI2), cy=0.5+amp*sin((s*FY*SQRT3+ph*PHI+kickPhase)*PI2)

  RIG COVERAGE: pixels are placed in one shared normalized plane (nx,ny) derived
  from x,y. Pars (fId1-4, top, by X), vintage (fId5-6, vertical, by Y) and bars
  (fId7-8, full width, by X) are all sampled against the SAME curve, so the weave
  reads as one continuous figure draped over the entire rig. Unknown fixtures are
  TRUE BLACK (P0 self-filter).

  HIGH-DEF + BRIGHT: the core falls off as a sharp inverse-square in distance, so
  the lit weave is a crisp filament on dark negative space. A tiny time-based base
  keeps the rig alive (never fully black) in silence (mission-critical).

  AUDIO (modulators-only — NEVER read CPC audio globals natively). Map on the
  playlist entry:
  AUDIO_MODULATION_V1:
    sliderLevel  <- micLow  range 0.30..1.00 curve linear   # PRIMARY brightness: bass drives curve amplitude + overall brightness
    sliderDetail <- micHigh range 0.10..0.85 curve linear   # highs: sparkle glints riding the filament (detail)
    sliderKick   <- micKick range 0.00..1.00 curve linear   # kick: discrete phase-jump of the weave on the beat
  STATIC (operator handles, not audio-mapped): localSpeed, spread, base, colorPalette1/2.

  IDENTITY-SLIDER convention: each slider stores v directly; scaling happens in
  render so the modulation range stays predictable.
*/

// ── Exported controls (UI order = declaration order) ─────────────────────────
export var localSpeed = 0.5;   // weave drift / precession rate
export var level = 0.5;        // PRIMARY: curve amplitude + overall brightness (micLow)
export var detail = 0.4;       // core sharpness + sparkle along the curve (micHigh)
export var kick = 0.0;         // discrete phase-jump of the weave (micKick)
export var spread = 0.6;       // how many lobes the figure draws (frequency scale)
export var base = 0.1;         // faint living floor (never fully black)

export var cp1H = 0.52, cp1S = 1.0, cp1V = 1.0; // palette 1 — cyan (one end of weave)
export var cp2H = 0.92, cp2S = 1.0, cp2V = 1.0; // palette 2 — magenta (other end)
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderLevel(v) { level = v; }   // micLow  -> here (PRIMARY)
export function sliderDetail(v) { detail = v; } // micHigh -> here
export function sliderKick(v) { kick = v; }     // micKick -> here
export function sliderSpread(v) { spread = v; }
export function sliderBase(v) { base = v; }

// ── Irrational / incommensurate constants (header bar 3) ─────────────────────
var SQRT2 = 1.41421356;
var SQRT3 = 1.73205081;
var PHI   = 1.61803399;
var FX = 3.0;          // base X lobe count (scaled by spread)
var FY = 2.0;          // base Y lobe count (scaled by spread)
var MAX_RATE = 0.18;   // phase drift (turns/sec) at localSpeed = 1.0
var SAMPLES = 48;      // curve sample points (the woven polyline)

// ── Palette RGB cache (strict cp1<->cp2 blending; PATTERNS.md §7) ─────────────
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
var phase = 0.0;            // weave drift phase (turns)
var kickPhase = 0.0;        // accumulated discrete phase-jump (turns)
var lastKick = 0.0;         // edge-detect for the kick event
var amp = 0.3;              // resolved curve amplitude this frame (from level)
var sharp = 8.0;            // resolved core sharpness this frame (from detail)
var coreBri = 0.6;          // resolved overall brightness this frame (from level)
var sparkAmt = 0.0;         // resolved sparkle amount this frame (from detail)
var tBase = 0.0;            // slow base shimmer phase

// Sampled curve points (the woven polyline) — recomputed once per frame.
var curX = array(48);
var curY = array(48);
var curT = array(48);       // palette parameter 0..1 at each sample

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  _hsv2rgb1();
  _hsv2rgb2();

  // Drift + golden-ratio precession (never-repeating). localSpeed warps the
  // drift rate exponentially across 0..1 (2^((localSpeed-0.5)*4): 0.0625x at 0
  // .. 16x at 1) so the slider VISIBLY changes how fast the weave precesses; a
  // small floor keeps the figure always drifting (never frozen, even at 0).
  var rateMul = 0.06 + pow(2.0, (localSpeed - 0.5) * 4.0);
  phase = phase + dt * rateMul * MAX_RATE;
  phase = phase - floor(phase);

  // micKick -> discrete phase-jump of the curve (rising edge fires a jump).
  if (kick > 0.5 && lastKick <= 0.5) {
    kickPhase = kickPhase + 0.3183; // ~1/PI turn — irrational-ish jump, no integer period
    kickPhase = kickPhase - floor(kickPhase);
  }
  lastKick = kick;

  // micLow -> PRIMARY: amplitude of the figure AND overall brightness. Brightness
  // is dominated by level (small base) so total brightness tracks micLow strongly.
  amp = 0.18 + clamp01(level) * 0.30;        // 0.18..0.48 (stays on the rig)
  coreBri = 0.08 + clamp01(level) * 1.30;    // overall brightness tracks micLow

  // micHigh -> 2nd dimension: ADDITIVE sparkle along the filament (no inverse
  // brightness coupling). Sharpness is held ~constant so detail never fights the
  // primary micLow->brightness mapping.
  sharp = 11.0;
  sparkAmt = clamp01(detail);

  tBase = time(0.4);

  // Resolve the woven polyline once per frame (incommensurate Lissajous).
  var fx = FX * (0.6 + spread * 1.2);
  var fy = FY * (0.6 + spread * 1.2);
  for (var kk = 0; kk < SAMPLES; kk++) {
    var sv = kk / SAMPLES;                    // 0..1 along the curve
    var ax = (sv * fx * SQRT2 + phase) ;
    var ay = (sv * fy * SQRT3 + phase * PHI + kickPhase);
    curX[kk] = 0.5 + amp * sin(ax * PI2);
    curY[kk] = 0.5 + amp * sin(ay * PI2);
    curT[kk] = sv;                            // palette travels along parameter
  }
}

export function render3D(index, x, y, z) {
  // ── Map this fixture into the shared normalized weave plane (nx,ny) ────────
  // All groups are sampled against the SAME curve so the figure drapes the rig.
  // RIG-AGNOSTIC: on test_bench the fixtureId lanes reproduce the original
  // placement (pars top row, vintage vertical strips, bars full-width band).
  // On ANY other rig (titanic/dome/logsville, fId not 1..8) the pixel's OWN
  // normalized coords (x,y) ARE the weave plane, so the Lissajous figure drapes
  // the whole ship directly from coordinates. NEVER returns black.
  var nx = 0.0;
  var ny = 0.0;
  if (fixtureId >= 1 && fixtureId <= 4) {
    // Pars — top row, position by X across the rig.
    nx = (x - 0.135) / (0.812 - 0.135);
    ny = 0.92;
  } else if (fixtureId >= 5 && fixtureId <= 6) {
    // Vintage — vertical strips; position by Y, X by which strip.
    nx = (fixtureId == 5) ? 0.34 : 0.66;
    ny = (y - 0.0) / (0.273 - 0.0);
  } else if (fixtureId >= 7 && fixtureId <= 8) {
    // Bars — full-width row; position by X.
    nx = x;
    ny = 0.5;
  } else {
    // Coordinate plane straight from normalized coords (every other rig).
    nx = x;
    ny = y;
  }
  nx = clamp01(nx);
  ny = clamp01(ny);

  // ── Nearest point on the woven polyline (distance field) ───────────────────
  var best = 999.0;
  var bestT = 0.0;
  for (var kk = 0; kk < SAMPLES; kk++) {
    var ddx = nx - curX[kk];
    var ddy = ny - curY[kk];
    var d2 = ddx * ddx + ddy * ddy;
    if (d2 < best) { best = d2; bestT = curT[kk]; }
  }
  var dist = sqrt(best);

  // Crisp inverse-square core: bright on the filament, true black far away.
  var bri = 1.0 / (1.0 + (dist * sharp) * (dist * sharp));
  // Hard knee so the negative space is genuinely dark (high-def).
  bri = bri - 0.30;
  if (bri < 0.0) bri = 0.0;
  bri = bri / 0.70;

  // Sparkle (2nd visual dimension): micHigh adds crisp flickering glints riding
  // the filament — deterministic per-pixel, gated to lit cells only.
  if (sparkAmt > 0.0 && bri > 0.02) {
    var seed = index * 12.9898 + floor(tBase * 240.0) * 0.137 + z * 7.31;
    var spk = sin(seed) * sin(seed * 3.3 + 1.7);
    spk = spk * spk; spk = spk * spk;          // sharpen -> crisp
    if (spk > (0.86 - sparkAmt * 0.5)) {
      var add = sparkAmt * 0.5 * bri;
      bri = bri + add;
    }
  }

  // micLow -> overall brightness (PRIMARY coupling).
  bri = bri * coreBri;

  // Faint living base so silence still reads (mission-critical, never black).
  var baseV = base * 0.12 * (0.5 + 0.5 * wave(tBase + ny * 0.4 + sectionId * 0.17));
  if (baseV > bri) bri = baseV;
  bri = clamp01(bri);

  // Colour travels ALONG the curve: cp1 at one end, cp2 at the other.
  var tcol = clamp01(bestT);
  var r = (pr1 + (pr2 - pr1) * tcol) * bri;
  var g = (pg1 + (pg2 - pg1) * tcol) * bri;
  var b = (pb1 + (pb2 - pb1) * tcol) * bri;
  rgb(clamp01(r), clamp01(g), clamp01(b));
}
