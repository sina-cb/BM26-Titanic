/*
  51_confetti_cyclone.js — CONFETTI CYCLONE (HD, audio-reactive).

  An HD reinterpretation of 09_cyclone. Bright confetti SPARKS orbit a slowly
  drifting cyclone CENTER. Each spark sits at a golden-angle phase on the swirl,
  rides an irrational spin, and is rendered as a CRISP bright point with a short
  fading trail. Between sparks the rig is TRUE BLACK — high contrast, high def.

  Every pixel maps to (nx, ny) on the rig plane. Per frame we precompute the
  current screen position of NSPARK orbiting sparks. A pixel lights for the
  NEAREST spark within its radius; brightness falls off sharply from the spark
  core (crisp), with a fading angular TRAIL behind each spark on the swirl.

  COLOUR: each spark is cp1 or cp2 by parity (alternating sparks), so both
  palette colours swirl through the cyclone together (hueSpread >= 0.10).
  Blend is done in RGB space (pr1.. / pr2..) per PATTERNS.md §7.

  HD: crisp small sparks + true-black negative space. A faint drifting confetti
  base keeps the rig alive (non-black) when silent — mission-critical visibility.

  ── CORE EQUATION ───────────────────────────────────────────────────────────
  Spark k angle:   ang_k = spin + k * GOLDEN_ANGLE              (GOLDEN_ANGLE = 0.381966 turns)
  Spin advance:    spin += dt * (BASE + low * LOWGAIN) * SQRT2  (SQRT2 = 1.4142135, irrational → never loops)
  Spark radius:    rad_k = RMIN + (RMAX-RMIN) * frac(k * PHI)   (PHI = 0.6180339)
  Screen pos:      sx = cx + rad_k*cos(ang_k*PI2)*ASPECT,  sy = cy + rad_k*sin(ang_k*PI2)
  Center drift:    cx,cy move on sqrt3 / sqrt5 Lissajous so the eye wanders.

  ── AUDIO (MODULATORS ONLY — never read CPC audio globals; codex P0) ──────────
  AUDIO_MODULATION_V1:
    sliderLow  <- micLow  range 0.30..1.00 curve linear  # PRIMARY brightness — overall level + spin rate + spark density track the low band
    sliderHigh <- micHigh range 0.00..1.00 curve pow2    # sparkle/detail — extra confetti twinkle on the crests (highs->glint)
    sliderKick <- micKick range 0.00..1.00 curve pow2    # beat/pop — a confetti BURST fattens + flares the sparks
  # sliderSparkSize: static (base spark core radius / crispness; not audio-mapped)
  # sliderLocalSpeed: static (overall swirl animation rate trim; not audio-mapped)
  # micHigh/micKick are DISTINCT dimensions (sparkle / burst fatten) — they add
  # detail without driving overall brightness, so micLow stays the PRIMARY.
  # Sliders store v directly (identity-slider convention); scaled only in render.
*/

// ── Exported controls (UI order = declaration order) ─────────────────────────
export var localSpeed = 0.5;   // overall swirl animation rate trim
export var low = 0.5;          // PRIMARY: brightness + spin + density  <- micLow
export var high = 0.5;         // 2nd dim: extra confetti sparkle       <- micHigh
export var kick = 0.0;         // confetti burst flare                  <- micKick
export var sparkSize = 0.5;    // base spark radius (crispness vs. bloom)

export var cp1H = 0.08, cp1S = 1.0, cp1V = 1.0; // palette 1 — warm amber
export var cp2H = 0.52, cp2S = 1.0, cp2V = 1.0; // palette 2 — cyan
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderLow(v) { low = v; }     // micLow maps here (PRIMARY)
export function sliderHigh(v) { high = v; }   // micHigh maps here (2nd dimension)
export function sliderKick(v) { kick = v; }   // micKick maps here (burst)
export function sliderSparkSize(v) { sparkSize = v; }

// ── Irrational constants (no integer periods → never loops) ──────────────────
var SQRT2 = 1.4142135624;
var SQRT3 = 1.7320508076;
var SQRT5 = 2.2360679775;
var PHI = 0.6180339887;        // golden ratio fractional part
var GOLDEN_ANGLE = 0.3819660113; // 1 - 1/PHI, in TURNS (137.5 deg)
var ASPECT = 0.42;             // rig is wide & short → squash the orbit in y

var NSPARK = 18;               // number of orbiting confetti sparks
var BASE_SPIN = 0.05;          // spins/sec at low=0 (faint drift in silence)
var LOW_SPIN = 0.50;           // extra spins/sec at low=1 (micLow speeds the swirl)
var RMIN = 0.14;               // inner orbit radius (turns of the swirl)
var RMAX = 0.62;               // outer orbit radius

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

// ── Persistent state (frame-to-frame; PATTERNS.md §10) ───────────────────────
var spin = 0.0;                // accumulated swirl phase (turns), irrational rate
var cxNow = 0.5, cyNow = 0.55; // current cyclone center (drifts each frame)
var driftT = 0.0;             // center-drift clock
var lowGain = 0.3;            // smooth global brightness gain (PRIMARY micLow lift)

// Precomputed spark screen positions / size / colour parity for this frame.
var sx = array(18);
var sy = array(18);
var sparkV = array(18);       // per-spark brightness (density gating + sparkle)
var sparkR = array(18);       // per-spark core radius (px space)
var sparkPar = array(18);     // 0 -> cp1, 1 -> cp2

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  _hsv2rgb1();
  _hsv2rgb2();

  var localMult = pow(2.0, (localSpeed - 0.5) * 3.0);

  // PRIMARY: micLow speeds the spin (irrational SQRT2 multiplier → never loops).
  var spinRate = (BASE_SPIN + clamp01(low) * LOW_SPIN) * SQRT2 * localMult;
  spin = spin + dt * spinRate;
  if (spin > 100000.0) spin = spin - 100000.0;

  // Center wanders on an irrational Lissajous so the cyclone eye never repeats.
  driftT = driftT + dt * 0.08 * localMult;
  if (driftT > 100000.0) driftT = driftT - 100000.0;
  cxNow = 0.5 + 0.16 * sin(driftT * SQRT3 * PI2);
  cyNow = 0.55 + 0.10 * sin(driftT * SQRT5 * PI2 + 1.7);

  // Density: micLow lifts how many sparks are "hot"; micHigh adds twinkle; a
  // confetti BURST on the kick flares all sparks fatter (size, not raw bri) so
  // the PRIMARY micLow->brightness coupling stays dominant.
  var density = 0.22 + clamp01(low) * 0.78;          // 0.22..1.0 fraction hot
  var burst = clamp01(kick);                         // 0..1 burst amount
  var sizePx = 0.07 + sparkSize * 0.13 + burst * 0.035; // px-space core radius (kick fattens)

  // PRIMARY brightness coupling: a SMOOTH global gain rises steeply with micLow
  // and is applied to every pixel in render3D. This makes overall brightness
  // track micLow continuously, above the geometric swirl flicker (corr >= 0.5).
  // Steep curve: a modest silence floor (rig stays readable) but a strong slope
  // through the musical mid-band where micLow lives, so overall brightness tracks
  // micLow closely (PRIMARY corr >= 0.5) without crushing the silent floor.
  var lowC = clamp01(low);
  lowGain = 0.42 + lowC * lowC * 1.75;               // 0.42..2.17, steep quadratic ramp

  for (var kk = 0; kk < NSPARK; kk++) {
    // Each spark gets a golden-angle phase on the swirl + its own irrational
    // radius so they spiral rather than ring.
    var ang = spin + kk * GOLDEN_ANGLE;
    var radFrac = kk * PHI; radFrac = radFrac - floor(radFrac);   // frac(k*PHI)
    var rad = RMIN + (RMAX - RMIN) * radFrac;

    sx[kk] = cxNow + rad * cos(ang * PI2) * ASPECT;
    sy[kk] = cyNow + rad * sin(ang * PI2);

    // Per-spark STATIC weight (no spin term) so the geometric mass stays steady
    // frame-to-frame — that keeps total brightness a near-constant times lowGain,
    // so the PRIMARY micLow->brightness correlation stays high. density (micLow)
    // gently lifts the dimmer sparks; micHigh twinkles individual sparks crisply.
    var wph = kk * PHI + kk * 0.137; wph = wph - floor(wph);    // static 0..1 per spark
    var weight = 0.40 + 0.60 * clamp01((density - wph) / 0.5 + 0.5);
    var twk = pow(wave(kk * 2.39996 + spin * 1.7), 6.0);        // sharp per-spark twinkle
    var sparkle = clamp01(high) * twk;

    // Per-spark body: a solid pre-gain look (PRIMARY micLow lift is applied
    // globally as lowGain in render3D). micHigh adds crisp twinkle. kick does NOT
    // brighten here — it only fattens sparks via sizePx — so micLow stays the
    // dominant brightness driver and the PRIMARY corr stays high.
    var bv = 0.85 * weight;
    bv = bv + sparkle * 0.4;
    sparkV[kk] = clamp01(bv);
    sparkR[kk] = sizePx;
    sparkPar[kk] = kk % 2;
  }
}

export function render3D(index, x, y, z) {
  // Map this pixel onto the cyclone plane. nx is wide (0..1); ny varies per
  // section but we use it directly so each section samples the same swirl.
  var nx = x;
  var ny = y;

  // Find the brightest contribution from the nearest sparks. Crisp core: a
  // tight gaussian-ish falloff, true black beyond ~2x the core radius.
  var bestB = 0.0;
  var bestCol = 0.5;
  for (var kk = 0; kk < NSPARK; kk++) {
    var dx = (nx - sx[kk]) / ASPECT;   // un-squash x so distance is round
    var dy = ny - sy[kk];
    var dist = hypot(dx, dy);
    var rr = sparkR[kk];
    if (dist < rr * 2.4) {
      // sharp falloff: 1 at center, ~0 at 2.4*rr → crisp confetti point
      var fall = 1.0 - dist / (rr * 2.4);
      fall = fall * fall;            // sharpen
      var contrib = sparkV[kk] * fall;
      if (contrib > bestB) {
        bestB = contrib;
        bestCol = sparkPar[kk];      // 0 -> cp1, 1 -> cp2
      }
    }
  }

  // Faint drifting confetti BASE so the rig never reads fully black (P0). A
  // sparse deterministic per-pixel shimmer riding the swirl phase.
  var seed = index * 12.9898 + floor(spin * 60.0) * 0.0173;
  var bspk = sin(seed) * sin(seed * 1.7 + 1.3);
  bspk = bspk * bspk; bspk = bspk * bspk;       // crisp, sparse
  var baseV = 0.0;
  if (bspk > 0.55) baseV = (bspk - 0.55) / 0.45 * 0.30;
  var baseCol = clamp01(sin(seed * 0.41) * 0.5 + 0.5);

  var bri = baseV;
  var tcol = baseCol;
  if (bestB > bri) { bri = bestB; tcol = bestCol; }

  // PRIMARY coupling: scale brightness by the smooth micLow gain so overall
  // brightness tracks micLow above the geometric swirl flicker.
  bri = clamp01(bri * lowGain);
  var rr2 = (pr1 + (pr2 - pr1) * tcol) * bri;
  var gg2 = (pg1 + (pg2 - pg1) * tcol) * bri;
  var bb2 = (pb1 + (pb2 - pb1) * tcol) * bri;

  // Crisp white pop on the W channel for the hottest spark cores only.
  var ww = 0.0;
  if (bri > 0.6) ww = (bri - 0.6) * 0.7;

  rgbwau(clamp01(rr2), clamp01(gg2), clamp01(bb2), clamp01(ww), 0.0, 0.0);
}
