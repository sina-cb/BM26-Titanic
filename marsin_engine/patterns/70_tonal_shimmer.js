/*
  70_tonal_shimmer.js — HELD glow (tonal) <-> fine GRAIN shimmer (percussive),
  crossfaded by harmonic tonal stability.

  Chroma identity: the engine publishes micTonalStabilityRaw — 0..1 chroma
  concentration. HIGH (=1) means the spectrum is harmonically HELD on a clear
  chord/note (a sustained pad, a held bassline, a tonal lead); LOW (~0) means the
  energy is spread/atonal/percussive (drum hits, hats, noise, stabs). This is the
  texture axis the rig has never had. The pattern crossfades two textures with it:

    TONAL  (stability high)  -> a smooth, HELD GLOW: a slow breathing two-colour
                               wash with soft wide bands, almost no grain — the
                               rig sits and *sustains*, calm and continuous.
    PERCUSSIVE (stability lo) -> a fine, fast GRAIN SHIMMER: a dense per-pixel
                               sparkle field that flickers and dances, true-black
                               negative space between glints — the rig gets gritty
                               and energetic, matching the percussion.

  The crossfade EASES (smoothed) so the texture morphs between glow and grain
  rather than snapping. micChromaFlux adds a brief shimmer BURST on harmonic
  change (a chord turn re-seeds the grain) so chord moves read even inside a
  held passage. A lifted glow floor keeps the rig clearly ALIVE in silence
  (mission critical — never near-black).

  COORDINATE-DRIVEN (x/y hashed grain + radius) so it ports test_bench ->
  titanic unchanged.

  CONTROLS (UI order = declaration order)
    - localSpeed : glow drift + grain animation rate (never frozen).
    - tonal      : micTonalStability -> HELD-glow <-> GRAIN-shimmer crossfade (HEADLINE).
    - flux       : micChromaFlux -> shimmer burst / re-seed on harmonic change.
    - base       : calm glow floor (always-on; never dark).
    - grainAmt   : how dense/strong the percussive grain gets (operator taste).
    - colorPalette1/2 : cp1 calm glow -> cp2 grain accent (hot).

  AUDIO (modulators-only — NEVER read CPC audio globals natively):
  AUDIO_MODULATION_V1:
    sliderTonal <- micTonalStabilityRaw range 0.00..1.00 curve linear  # HEADLINE: held-glow <-> grain-shimmer crossfade
    sliderFlux  <- micChromaFluxRaw      range 0.00..1.00 curve linear  # shimmer burst on harmonic change
  STATIC (operator handles, not audio-mapped): localSpeed, base, grainAmt, colorPalette1/2.
  Validate on --synth bassline (tonal HIGH ~0.7 -> held glow) vs hats/chord_stab
  (tonal ~0 -> grain shimmer). The crossfade is a TEXTURE change: corr is read on
  the per-frame brightness VARIANCE / dark-fraction (grain raises variance), and
  the held<->grain transition is visible in the clip.
*/

// ── Exported controls (UI order = declaration order) ─────────────────────────
export var localSpeed = 0.5;   // glow drift + grain rate
export var tonal = 0.0;        // tonal stability -> held<->grain (audio)
export var flux = 0.0;         // chroma flux -> shimmer burst (audio)
export var base = 0.5;         // calm glow floor (always-on; never near-dark)
export var grainAmt = 0.6;     // how strong the percussive grain gets

export var cp1H = 0.55, cp1S = 0.85, cp1V = 1.0; // palette 1 — calm glow (tonal)
export var cp2H = 0.92, cp2S = 0.85, cp2V = 1.0; // palette 2 — grain accent (percussive)
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderTonal(v) { tonal = v; }
export function sliderFlux(v) { flux = v; }
export function sliderBase(v) { base = 0.22 + v * 0.40; } // 0.22..0.62; never near-dark
export function sliderGrainAmt(v) { grainAmt = v; }

// ── Tunables ─────────────────────────────────────────────────────────────────
var TONAL_TAU = 1.6;    // ease rate of the held<->grain crossfade (per sec)
var FLUX_TAU  = 3.0;    // decay of the harmonic-change shimmer burst
var GLOW_RATE = 0.06;   // held-glow wash drift at localSpeed=0.5
var GRAIN_RATE = 1.4;   // grain animation rate (fast flicker) at localSpeed=0.5

// ── Palette RGB cache (strict cp1<->cp2 blending; PATTERNS.md §7) ─────────────
var pr1 = 0, pg1 = 0, pb1 = 1;
var pr2 = 1, pg2 = 1, pb2 = 0;
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

function clamp01(v) { if (v < 0.0) return 0.0; if (v > 1.0) return 1.0; return v; }

// deterministic per-pixel hash -> [0,1), no allocation. Stable per coordinate so
// each pixel keeps its own grain phase (the field looks like fixed noise that
// animates, not random per frame).
function hash01(a, b) {
  var s = sin(a * 127.1 + b * 311.7) * 43758.5453;
  return s - floor(s);
}

// ── Persistent state ─────────────────────────────────────────────────────────
var morph = 0.0;       // smoothed tonal stability (eased) -> 1 glow .. 0 grain
var fluxEnv = 0.0;     // smoothed harmonic-change shimmer burst
var glowPhase = 0.0;
var grainPhase = 0.0;

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  _hsv2rgb1();
  _hsv2rgb2();

  // crossfade EASES toward the tonal stability (morph 1=held glow, 0=grain).
  var target = clamp01(tonal);
  morph = morph + (target - morph) * clamp01(dt * TONAL_TAU);

  // harmonic-change shimmer burst: re-seeds/strengthens the grain briefly.
  var fx = clamp01(flux);
  if (fx > fluxEnv) fluxEnv = fx;
  fluxEnv = fluxEnv - dt * FLUX_TAU;
  if (fluxEnv < 0.0) fluxEnv = 0.0;

  var rateMul = pow(2.0, (clamp01(localSpeed) - 0.5) * 4.0);
  glowPhase = glowPhase + dt * GLOW_RATE * (0.4 + rateMul);
  glowPhase = glowPhase - floor(glowPhase);
  grainPhase = grainPhase + dt * GRAIN_RATE * (0.5 + rateMul);
  grainPhase = grainPhase - floor(grainPhase);
}

export function render3D(index, x, y, z) {
  var xn = clamp01(x);
  var yn = clamp01(y);
  var dx = xn - 0.5;
  var dy = yn - 0.5;
  var rad = sqrt(dx * dx + dy * dy);
  var radN = rad / 0.7; if (radN > 1.0) radN = 1.0;
  var coreFall = 1.0 - radN; if (coreFall < 0.0) coreFall = 0.0;

  // ── HELD GLOW texture (tonal, morph high): smooth breathing two-colour wash,
  // wide soft bands, no grain — lifted globally so it is clearly lit in silence.
  var washProf = 0.60 + 0.40 * coreFall;
  var glow = base * washProf * (0.76 + 0.24 * wave(glowPhase * 0.5 + rad * 1.2));

  // ── GRAIN SHIMMER texture (percussive, morph low): a dense per-pixel sparkle
  // field. Each pixel has its own phase from a stable hash; it lights when its
  // animated phase crosses a threshold, giving fast fine flicker with true-black
  // gaps. The flux burst widens the lit fraction (a chord turn re-seeds it).
  var ph = hash01(xn * 8.0, yn * 8.0);               // stable per-pixel seed
  var tw = wave(grainPhase + ph);                    // animated 0..1 per pixel
  var thr = 0.62 - 0.30 * fluxEnv;                   // burst opens more glints
  var glint = tw - thr;
  if (glint < 0.0) glint = 0.0;
  glint = glint / (1.0 - thr);                       // renormalize to 0..1
  var grain = grainAmt * glint * (0.55 + 0.45 * coreFall);

  // ── CROSSFADE held-glow (morph) <-> grain (1-morph). Keep a small glow floor
  // even in full grain so the rig never reads as just scattered dots, and keep
  // some grain energy even when held so a chord turn still sparkles.
  var glowW = 0.35 + 0.65 * morph;
  var grainW = 0.30 + 0.70 * (1.0 - morph);
  var bri = clamp01(glow * glowW + grain * grainW);

  // colour: held glow sits on cp1 (calm); grain biases toward cp2 (accent), and
  // the flux burst pushes the accent harder so a chord turn flashes the accent.
  var tcol = clamp01((1.0 - morph) * (0.45 + 0.55 * glint) + fluxEnv * 0.4);

  var r = (pr1 + (pr2 - pr1) * tcol) * bri;
  var g = (pg1 + (pg2 - pg1) * tcol) * bri;
  var b = (pb1 + (pb2 - pb1) * tcol) * bri;

  rgbwau(clamp01(r), clamp01(g), clamp01(b), 0.0, 0.0, 0.0);
}
