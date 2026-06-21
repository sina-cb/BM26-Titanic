/*
  69_harmonic_warmth.js — a WARM<->COOL palette sweep driven by harmonic timbre.

  Chroma identity: the engine publishes micChromaTiltRaw — a level-robust
  0..1 spectral brightness of the *pitched* band (bass-dark -> treble-bright).
  Bass-heavy, dark material (a deep techno groove, a sub-bassline) reads LOW;
  shimmering, treble-rich material (open chords, hats, melodic leads) reads HIGH.
  This pattern turns that timbre into a slow palette TEMPERATURE sweep over a
  calm, breathing two-colour wash:

    DARK / BASSY (tilt low)   -> the rig settles toward the COOL anchor (cp1):
                                 deep indigo/teal, a calm cellar glow.
    BRIGHT / TREBLE (tilt hi) -> the rig warms toward the HOT anchor (cp2):
                                 amber/gold, a lifted, open, warm wash.

  The temperature EASES toward the tilt (smoothed, never snaps) so the colour
  drifts with the music's timbre like a slow sunrise/sunset across the hull,
  not a strobe. A gentle diagonal warmth gradient + breathing wash give it
  motion and high-def contrast; a lifted global floor keeps the rig clearly
  ALIVE and welcoming in silence (mission critical — never near-black).

  COORDINATE-DRIVEN (x + y diagonal + radius) so it ports test_bench -> titanic
  unchanged.

  CONTROLS (UI order = declaration order)
    - localSpeed : idle wash + warmth-gradient drift rate (never frozen).
    - warmth     : micChromaTilt -> WARM<->COOL palette temperature (HEADLINE).
    - flux       : micChromaFlux -> a small saturation/brightness lift on
                   harmonic change so chord turns sparkle the warmth a touch.
    - base       : calm base floor (always-on; never dark).
    - colorPalette1/2 : cp1 COOL (dark/bassy) -> cp2 WARM (bright/treble).

  AUDIO (modulators-only — NEVER read CPC audio globals natively):
  AUDIO_MODULATION_V1:
    sliderWarmth <- micChromaTiltRaw range 0.00..1.00 curve linear  # HEADLINE: warm<->cool palette temperature from spectral brightness
    sliderFlux   <- micChromaFluxRaw range 0.00..1.00 curve linear  # small lift on harmonic change
  STATIC (operator handles, not audio-mapped): localSpeed, base, colorPalette1/2.
  Validate on --synth sine_sweep (tilt sweeps 0->1 -> full cool->warm arc) and
  full_track (tilt is bass-low). corr(micChromaTiltRaw, warmth-temperature) is
  the headline (it is a HUE/temperature shift, so colour-temperature corr — not
  brightness — is the right axis; tracked via the cp1->cp2 blend term).
*/

// ── Exported controls (UI order = declaration order) ─────────────────────────
export var localSpeed = 0.5;   // idle wash + gradient drift rate
export var warmth = 0.0;       // chroma tilt -> warm<->cool temperature (audio)
export var flux = 0.0;         // chroma flux -> small change-lift (audio)
export var base = 0.5;         // calm base floor (always-on; never near-dark)

export var cp1H = 0.58, cp1S = 0.95, cp1V = 1.0; // palette 1 — COOL: deep teal/indigo (dark/bassy)
export var cp2H = 0.07, cp2S = 0.95, cp2V = 1.0; // palette 2 — WARM: amber/gold (bright/treble)
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderWarmth(v) { warmth = v; }
export function sliderFlux(v) { flux = v; }
export function sliderBase(v) { base = 0.22 + v * 0.40; } // 0.22..0.62; never near-dark

// ── Tunables ─────────────────────────────────────────────────────────────────
var WARM_TAU  = 1.1;    // ease rate of the temperature toward the tilt (per sec)
var FLUX_TAU  = 4.0;    // faster decay for the harmonic-change sparkle
var BASE_RATE = 0.07;   // idle wash drift at localSpeed=0.5
var GRAD_RATE = 0.04;   // warmth-gradient drift across the hull

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

// ── Persistent state ─────────────────────────────────────────────────────────
var temp = 0.0;        // smoothed temperature (eased toward the tilt) -> cp1->cp2
var fluxEnv = 0.0;     // smoothed harmonic-change envelope (sparkle lift)
var washPhase = 0.0;
var gradPhase = 0.0;

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  _hsv2rgb1();
  _hsv2rgb2();

  // temperature EASES toward the chroma tilt (slow sunrise/sunset, never snaps).
  var target = clamp01(warmth);
  temp = temp + (target - temp) * clamp01(dt * WARM_TAU);

  // harmonic-change sparkle: a chord turn (flux) lifts, then fades smoothly.
  var fx = clamp01(flux);
  if (fx > fluxEnv) fluxEnv = fx;
  fluxEnv = fluxEnv - dt * FLUX_TAU;
  if (fluxEnv < 0.0) fluxEnv = 0.0;

  var rateMul = pow(2.0, (clamp01(localSpeed) - 0.5) * 4.0);
  washPhase = washPhase + dt * BASE_RATE * (0.4 + rateMul);
  washPhase = washPhase - floor(washPhase);
  gradPhase = gradPhase + dt * GRAD_RATE * (0.4 + rateMul);
  gradPhase = gradPhase - floor(gradPhase);
}

export function render3D(index, x, y, z) {
  var xn = clamp01(x);
  var yn = clamp01(y);
  var dx = xn - 0.5;
  var dy = yn - 0.5;
  var rad = sqrt(dx * dx + dy * dy);                 // 0..~0.7 from centre
  var radN = rad / 0.7; if (radN > 1.0) radN = 1.0;  // 0 centre .. 1 rim

  // ── calm BASE wash (always-on, never dark): a breathing two-colour body that
  // is strongest at centre and lifted globally so the whole rig is clearly lit
  // and welcoming at silence (mission critical, never near-black).
  var coreFall = 1.0 - radN; if (coreFall < 0.0) coreFall = 0.0;
  var washProf = 0.60 + 0.40 * coreFall;             // 0.60 rim .. 1.0 centre
  var baseBri = base * washProf * (0.74 + 0.26 * wave(washPhase * 0.5 + rad * 1.3));

  // ── WARMTH GRADIENT: the temperature isn't flat across the hull — it drifts
  // along a slow diagonal so you SEE the warm front move (high-def motion). The
  // local temperature = global temp + a small spatial ripple around it.
  var diag = (xn + yn) * 0.5;                         // 0..1 diagonal coordinate
  var grad = 0.5 + 0.5 * wave(gradPhase + diag * 0.8);
  var localTemp = clamp01(temp * (0.72 + 0.28 * grad));

  // ── harmonic-change sparkle: on a chord turn, lift brightness + push the warm
  // a touch (so changes read as a little flare of warmth), strongest at centre.
  var sparkle = fluxEnv * (0.35 + 0.65 * coreFall);

  var bri = clamp01(baseBri + sparkle * 0.5);

  // colour blends COOL(cp1) -> WARM(cp2) with the local temperature. The flux
  // sparkle nudges the blend a touch warmer at the moment of change.
  var tcol = clamp01(localTemp + sparkle * 0.25);

  var r = (pr1 + (pr2 - pr1) * tcol) * bri;
  var g = (pg1 + (pg2 - pg1) * tcol) * bri;
  var b = (pb1 + (pb2 - pb1) * tcol) * bri;

  // a touch of amber channel when fully warm so the hot end reads as real warmth.
  var aa = clamp01(localTemp) * clamp01(localTemp) * 0.30 * bri;

  rgbwau(clamp01(r), clamp01(g), clamp01(b), 0.0, clamp01(aa), 0.0);
}
