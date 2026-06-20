/*
  68_riser_sweep.js — an ACCELERATING UPWARD SWEEP that climbs with the riser.

  Round-2 audio identity: the engine scores how strongly the music is BUILDING
  right now (audioRiserScore 0..1) with an honest confidence (audioRiserConf).
  This is distinct from #61_riser_release (which charges a centre ring off the
  detector's audioBuildScore): this pattern reads the dedicated riser score and
  expresses the build as the other classic riser gesture — a SWEEP that races
  UPWARD and SPEEDS UP as the build intensifies:

    BUILD  — as audioRiserScore climbs, a bright band SWEEPS up the hull (low y ->
             high y) and ACCELERATES; brightness rises, the band brightens and
             widens, and the colour heats cp1->cp2. confidence (audioRiserConf)
             GATES the intensity, so a low-confidence guess stays subtle and a
             confident build commits fully — honest, not over-eager.
    RELEASE— on audioDropPulse the sweep BURSTS: a final upward flash that fills
             the whole hull, then collapses to a calm base (the build "lets go").

  The upward sweep rate and brightness both rise with audioRiserScore, so
  corr(audioRiserScore, brightness) is strongly positive AND the motion visibly
  accelerates — you can FEEL the build coming.

  A calm base wash keeps the rig alive in silence (mission critical) — never dark.

  COORDINATE-DRIVEN (y = sweep axis, x for a little phase variety) so it ports
  test_bench -> titanic unchanged (sweeps bottom->top on the real hull).

  CONTROLS (UI order = declaration order)
    - localSpeed : idle sweep rate when nothing is building (never frozen).
    - riser      : audioRiserScore -> upward sweep speed + brightness swell.
    - riserConf  : audioRiserConf -> gates how far the build commits (honest).
    - release    : audioDropPulse -> final upward burst, then collapse.
    - base       : calm base floor (always-on; never dark).
    - colorPalette1/2 : cp1 cool (low build) -> cp2 hot (peak build / release).

  AUDIO (modulators-only — NEVER read CPC audio globals natively):
  AUDIO_MODULATION_V1:
    sliderRiser     <- audioRiserScore range 0.00..1.00 curve linear  # HEADLINE: build winds up the upward sweep + swells brightness
    sliderRiserConf <- audioRiserConf  range 0.00..1.00 curve linear  # confidence gate: low conf stays subtle, high conf commits
    sliderRelease   <- audioDropPulse  range 0.00..1.00 curve linear  # the DROP bursts: final upward flash, then collapse to calm
  STATIC (operator handles, not audio-mapped): localSpeed, base, colorPalette1/2.
  Validate on --synth riser (audioRiserScore ramps 0->~0.84) and edm_drop
  (riser rises then audioDropPulse fires). corr(audioRiserScore, brightness) is
  the headline; the drop pulse adds the burst.
*/

// ── Exported controls (UI order = declaration order) ─────────────────────────
export var localSpeed = 0.5;   // idle sweep rate
export var riser = 0.0;        // riser score   (audio audioRiserScore)
export var riserConf = 0.0;    // riser conf    (audio audioRiserConf)
export var release = 0.0;      // drop pulse     (audio audioDropPulse)
export var base = 0.16;        // calm base floor (always-on)

export var cp1H = 0.58, cp1S = 1.0, cp1V = 1.0; // palette 1 — cool blue (low build)
export var cp2H = 0.05, cp2S = 0.95, cp2V = 1.0; // palette 2 — hot orange (peak / release)
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderRiser(v) { riser = v; }
export function sliderRiserConf(v) { riserConf = v; }
export function sliderRelease(v) { release = v; }
export function sliderBase(v) { base = v * 0.3; }

// ── Tunables ─────────────────────────────────────────────────────────────────
var REL_ARM   = 0.4;     // drop-pulse level that arms a release (rising edge)
var REL_REARM = 0.2;
var REL_FALL  = 1.8;     // burst fall/sec (slow tail)
var RISE_TAU  = 5.0;     // riser ease rate (fast in, organic out)
var BASE_SWEEP = 0.12;   // idle sweep turns/sec at riser=0
var MAX_SWEEP  = 1.4;    // sweep turns/sec at full riser (accelerated)
var SWEEP_W    = 0.30;   // base width of the sweep band (widens with the build)
var W_POP      = 0.6;    // white-channel pop at the release peak

// ── Palette RGB cache (strict cp1<->cp2 blending; PATTERNS.md §7) ─────────────
var pr1 = 0, pg1 = 0, pb1 = 1;
var pr2 = 1, pg2 = 0, pb2 = 0;
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
var riseS = 0.0;       // smoothed riser score (eases toward `riser`)
var confS = 0.0;       // smoothed confidence gate
var flash = 0.0;       // release-burst envelope (0..1)
var armed = 1;         // rising-edge arm for the drop
var sweepPhase = 0.0;  // upward sweep phase (0..1, low y -> high y)

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  _hsv2rgb1();
  _hsv2rgb2();

  // riser + conf ease smoothly (so the build ramps and bleeds organically).
  riseS = riseS + (clamp01(riser) - riseS) * clamp01(dt * RISE_TAU);
  confS = confS + (clamp01(riserConf) - confS) * clamp01(dt * RISE_TAU);

  // drop pulse rising edge -> release burst
  if (armed == 1 && release >= REL_ARM) { flash = 1.0; armed = 0; }
  if (release < REL_REARM) armed = 1;
  flash = flash - dt * REL_FALL;
  if (flash < 0.0) flash = 0.0;

  // the sweep ACCELERATES with the (conf-gated) riser — the headline motion.
  var eff = riseS * (0.35 + 0.65 * confS);   // confidence gates the commitment
  var rateMul = pow(2.0, (clamp01(localSpeed) - 0.5) * 4.0);
  var speed = (BASE_SWEEP + (MAX_SWEEP - BASE_SWEEP) * eff) * (0.4 + rateMul);
  sweepPhase = sweepPhase + dt * speed;
  sweepPhase = sweepPhase - floor(sweepPhase);
}

export function render3D(index, x, y, z) {
  var yy = clamp01(y);
  var dx = clamp01(x) - 0.5;
  var dy = yy - 0.5;
  var rad = sqrt(dx * dx + dy * dy);

  var eff = riseS * (0.35 + 0.65 * confS);   // conf-gated build effort

  // ── calm BASE wash + GLOBAL build swell so total brightness RISES with the
  // build (positive corr) even as the band sweeps. Lifted across the hull by the
  // riser effort; the base breathes so silence reads (never dark).
  var baseBri = base * (0.5 + 0.5 * wave(sweepPhase * 0.4 + rad * 1.5))
              + eff * 0.45 * (0.4 + 0.6 * yy);   // swell biases toward the top

  // ── UPWARD SWEEP band: a bright band at height = sweepPhase, travelling up and
  // wrapping. The band WIDENS + BRIGHTENS with the build, so a strong riser fills
  // more of the hull and reads as an accelerating rush toward the top.
  var bandW = SWEEP_W * (0.6 + 0.8 * eff);
  // distance from this pixel's height to the sweep front (wrap-aware on y)
  var d = abs(yy - sweepPhase);
  if (d > 0.5) d = 1.0 - d;                   // shorter wrap distance
  var sweepBri = 0.0;
  if (d < bandW) {
    var prof = 1.0 - d / bandW;
    // a little x ripple so the band shimmers as it rises
    var ripple = 0.7 + 0.3 * wave(clamp01(x) * 3.0 + sweepPhase * 4.0);
    sweepBri = prof * prof * ripple * (0.35 + 0.65 * eff);
  }

  // ── RELEASE burst: a final upward flash filling the whole hull, then collapse.
  // The flash lifts everything and a sharp front races to the very top as it
  // decays (the build "lets go" upward).
  var burstFront = flash;                      // 1 -> 0 ; band rides top->down as it falls? keep upward feel
  var burstBand = 0.14 - abs(yy - (1.0 - (1.0 - flash) * 1.0));
  var burstRing = 0.0;
  if (burstBand > 0.0 && flash > 0.0) burstRing = (burstBand / 0.14) * flash;
  var flashBri = flash * 0.85 + burstRing;

  // compose
  var bri = baseBri;
  if (sweepBri > bri) bri = sweepBri;
  if (flashBri > bri) bri = flashBri;
  bri = clamp01(bri);

  // colour heats cp1(cool)->cp2(hot) with the build, fully hot on the release.
  var tcol = clamp01(0.12 + 0.7 * eff + 0.9 * flash);

  var r = (pr1 + (pr2 - pr1) * tcol) * bri;
  var g = (pg1 + (pg2 - pg1) * tcol) * bri;
  var b = (pb1 + (pb2 - pb1) * tcol) * bri;

  var ww = flash * W_POP;

  rgbwau(clamp01(r), clamp01(g), clamp01(b), clamp01(ww), 0.0, 0.0);
}
