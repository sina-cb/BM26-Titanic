/*
  43_golden_hour_pulse.js — GOLDEN HOUR PULSE (HD, sound-reactive).

  An HD, audio-reactive companion to 00_golden_hour_wash. Pattern 00 remains
  the iconic, continuous bread-and-butter Golden Hour look; this pattern is
  its explicitly MUSICAL pulse variant. The beloved warm sunset palette is
  kept — a deep amber/red -> warm gold field drifting across the whole rig —
  but sharpened into crisp warm cores and darker troughs, with three handles
  intended for modulation.

  THE LOOK
    - A warm wash drifts diagonally across the rig (x + y - z phase), strictly
      blending cp1 (deep amber/red) <-> cp2 (warm gold) in RGB space.
    - The wash field is cubed (noise*noise*noise) so peaks read as bright warm
      cores against near-dark troughs — the "HD" sunset, high contrast.
    - The drift never loops: the phase advances by an IRRATIONAL rate and the
      spatial axes are scaled by irrationals (sqrt2 on x, 1/phi on y, golden
      angle term on z), so no two passes ever align — an endless golden hour.

  SIGNATURE FEATURE — VINTAGE GOLDEN PULSE
    Every FIX_VINTAGE_6 rail — the Jewelry instrument on Titanic — acts as a
    warm audience pulse. On each kick, matched W+A rises beneath an added RGB
    gold bias, so the native-white Vintage heads pop golden rather than clinical.
    Targeting is by portable fixture capability, never bench-only fixture IDs.
    A persistent envelope snaps to 1.0 on a kick and decays into a short warm
    afterglow.

  IDENTITY INSTRUMENT
    TE signs hold a readable warm RGB emblem, then contract and bloom in a
    gentle double heartbeat driven by the engine/local-speed clock. XYZ and
    pixelLocalIndex introduce a small phase across the physical letterforms so
    the pulse has depth without becoming a chase. They emit no authored white:
    Pattern 00's Vintage golden-white swipe remains the iconic signature.

  AUDIO MAP (modulators-only — NEVER read CPC audio globals natively, codex P0):
  AUDIO_MODULATION_V1:
    sliderSwell   <- micLow  range 0.00..1.00 curve linear   # PRIMARY brightness/swell
    sliderBlinder <- micKick range 0.00..1.00 curve linear   # Vintage golden pulse
    sliderShimmer <- micHigh range 0.00..0.80 curve pow2     # fine warm shimmer/detail
  Static (unmapped) params: localSpeed, noiseScale, colorPalette1/2.
    Sliders use the IDENTITY convention (store v directly, scale in render). At
    rest (no audio) the rig shows a calm, never-black warm wash (mission-critical
    visibility).

  CORE EQUATION (per pixel, sunset wash core):
      v = (x*SQRT2*ns + y*INVPHI*ns*0.5 - z*GA*ns*0.35 + washPhase)
      noise = wave(v); noise = noise^3            // HD warm cores / dark troughs
      bri   = noise * (FLOOR + swell*SWELL_GAIN)   // micLow swells the whole wash
    where SQRT2=1.41421, INVPHI=0.61803, GA=0.38197 (golden-angle frac), and
    independent wash/color phases advance at irrationally related rates.

  CONTROLS (UI order = declaration order)
    - localSpeed : wash drift rate.
    - swell      : overall wash brightness/swell. PRIMARY audio handle (micLow).
    - blinder    : vintage white-blinder pop level. Kick handle (micKick).
    - shimmer    : fine warm shimmer on the wash. Highs handle (micHigh).
    - noiseScale : spatial scale of the wash (how many warm bands across the rig).
    - colorPalette1/2 : strict cp1↔cp2 palette (deep amber/red -> warm gold).
*/

// ── Exported controls (UI order = declaration order) ────────────────────────
export var localSpeed = 0.5;   // wash drift rate
export var swell = 0.0;        // PRIMARY: overall wash brightness/swell (micLow)
export var blinder = 0.0;      // vintage white-blinder pop level (micKick)
export var shimmer = 0.0;      // fine warm shimmer on the wash (micHigh)
export var noiseScale = 0.5;   // spatial scale of the wash

export var cp1H = 0.0, cp1S = 1.0, cp1V = 1.0;   // palette 1 — deep red / amber
export var cp2H = 0.18, cp2S = 1.0, cp2V = 1.0;  // palette 2 — warm gold
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderSwell(v) { swell = v; }      // micLow maps here (PRIMARY)
export function sliderBlinder(v) { blinder = v; }  // micKick maps here
export function sliderShimmer(v) { shimmer = v; }  // micHigh maps here
export function sliderNoiseScale(v) { noiseScale = v; }

// ── Tunables (irrational drift; no integer periods) ──────────────────────────
var SQRT2 = 1.41421356;   // x-axis spatial scale
var INVPHI = 0.61803398;  // y-axis spatial scale (1/phi)
var GA = 0.38196601;      // z-axis spatial scale (golden-angle fraction 1 - 1/phi)
var DRIFT = 0.07639320;   // drift rate (2 - phi)/10 — slow, irrational, never loops
var FLOOR = 0.125;        // resting wash brightness. OPERATOR DIRECTION: MAX REACTIVITY —
                          //   the PRIMARY micLow->brightness corr collapses if the resting
                          //   base dominates total brightness, so the floor is pushed LOW.
                          //   A darker idle is accepted (the rig still ANIMATES at rest: the
                          //   cubed wash drifts on washPhase and the warmFloor breathes with the
                          //   wash phase). A loud swell drives the warm cores hard to 255.
var SWELL_GAIN = 1.30;    // how hard micLow swells the wash. Tuned so the loud-swell cores
                          //   reach full but the field mostly stays in the LINEAR region
                          //   (heavy clamping/saturation flattens the response and kills the
                          //   micLow->brightness correlation).
var BLIND_DECAY = 7.0;    // blinder envelope decay (per second) — crisp flash
var SHIM_HZ = 0.041666;   // shimmer churn time-scale (irrational-ish, fine grain)
// Optional accent role. Self-declaring its canonical append-only id preserves
// compilation and output on models with no TE signs.
var FIX_TE_SIGN = 7;

// ── Palette RGB cache (strict cp1<->cp2 blending; PATTERNS.md §7) ────────────
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
var PHASE_WRAP = 10000.0; // integer-turn wrap; safe for every wave() consumer
var washPhase = 0.0;    // brightness-field drift, in turns
var colorPhase = 0.0;   // independent palette-field drift, in turns
var tShim = 0.0;        // shimmer churn time term
var blindEnv = 0.0;     // vintage blinder envelope (snaps to 1 on kick, decays)
var lastKick = 0.0;     // previous-frame blinder level for rising-edge detect
var washGain = FLOOR;   // resolved wash brightness gain this frame (FLOOR + swell)

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  _hsv2rgb1();
  _hsv2rgb2();

  // Local speed trim (00_golden_hour convention: v=0.5 -> 1x, exponential feel).
  var localMult = pow(2.0, (localSpeed - 0.5) * 4.0);

  // Independent accumulators prevent the old 17-second seam: tPhase used to
  // wrap at 1.0 and was then multiplied by 1.6180339 for colour, so every wrap
  // jumped the entire palette field. Each consumer now advances at its own
  // irrational rate and wraps only by an integer number of wave() turns.
  var phaseStep = (delta / 1310.72) * localMult * DRIFT;
  washPhase = washPhase + phaseStep;
  colorPhase = colorPhase + phaseStep * 1.6180339;
  if (washPhase >= PHASE_WRAP) washPhase = washPhase - PHASE_WRAP;
  if (colorPhase >= PHASE_WRAP) colorPhase = colorPhase - PHASE_WRAP;

  // Shimmer churn (fine grain), modulated by localSpeed.
  tShim = time(SHIM_HZ / (0.25 + localSpeed));

  // PRIMARY: micLow swells the whole wash above its resting FLOOR. Linear so the
  // wash brightness tracks low energy proportionally (strong brightness corr)
  // without clamping out the response.
  washGain = FLOOR + clamp01(swell) * SWELL_GAIN;

  // VINTAGE GOLDEN PULSE: a rising edge snaps the envelope to full; it then
  // decays each frame into a crisp warm flash with a short tail.
  if (blinder > 0.45 && lastKick <= 0.45) blindEnv = 1.0;
  lastKick = blinder;
  blindEnv = blindEnv - dt * BLIND_DECAY;
  if (blindEnv < 0.0) blindEnv = 0.0;
}

export function render3D(index, x, y, z) {
  // ── Sunset wash field (irrational spatial scales; HD warm cores) ──────────
  var liveNoiseScale = 0.1 + noiseScale * 0.8;
  var nx = x * SQRT2 * liveNoiseScale;
  var ny = y * INVPHI * liveNoiseScale * 0.5;
  var nz = z * GA * liveNoiseScale * 0.35;
  var v = nx + ny - nz + washPhase;
  var raw = wave(v);               // smooth 0..1 wash field (used for COLOR)
  // HD shaping: warm cores stay near-full, troughs still drop dark for contrast.
  // A gentle gamma (not a hard square) keeps the bright cores hot (peak>=200 at
  // rest) while preserving the dark/bright split that makes the wash read HD.
  var noise = raw * (0.55 + 0.45 * raw);

  // A second, decorrelated wash phase drives the COLOR blend so cp1<->cp2 spread
  // evenly across the rig (irrational offset -> hues span the full palette line,
  // not clustered at one end). Brightness stays cubed for the HD contrast.
  // The color phase carries its OWN, larger spatial frequency (independent of
  // noiseScale) so BOTH palette ends are always present across the rig even when
  // the wash is dim at rest -> keeps the measured hueSpread up at silence without
  // touching the brightness/reactivity path (colour-only).
  var cphase = (x * SQRT2 - y * INVPHI + z * GA) * 1.7 + colorPhase;
  var craw = wave(cphase);

  // Fine warm shimmer (micHigh): a small deterministic per-pixel sparkle layered
  // on the wash so highs add glint without breaking the palette.
  var shim = 0.0;
  if (shimmer > 0.0) {
    var seed = index * 12.9898 + floor(tShim * 180.0) * 0.137 + z * 7.3;
    var sp = sin(seed) * sin(seed * 1.7 + 1.3);
    sp = sp * sp; sp = sp * sp;             // sharpen to crisp glints
    var thr = 0.78 - clamp01(shimmer) * 0.30;
    if (sp > thr) shim = (sp - thr) / (1.0 - thr + 0.0001) * clamp01(shimmer) * 0.28;
  }

  // Wash brightness: cubed field swelled by micLow, plus shimmer glints.
  var bri = noise * washGain + shim;
  // COORD-DRIVEN non-black floor, kept SMALL (operator: MAX reactivity, darker
  // idle accepted): driven by the wash field's smooth phase so the rig still
  // ANIMATES (and never goes fully black) at rest, but small enough that it
  // barely dilutes the micLow->brightness correlation.
  var warmFloor = 0.018 + 0.022 * raw;
  bri = bri + warmFloor;

  // The pattern's unmistakable identity is a ceremonial whole-ship double
  // sunrise: one broad gold bloom, then a smaller answering beat. It remains
  // elegant at rest and gives Swell/Blinder audio energy a composition to
  // reinforce instead of leaving a generic drifting wash when modulators are
  // absent. Integer phase multipliers preserve the very-late wrap exactly.
  var ceremonyPhase = washPhase * 10.0;
  var ceremonyA = pow(wave(ceremonyPhase), 12.0);
  var ceremonyB = pow(wave(ceremonyPhase - 0.12), 16.0) * 0.58;
  var ceremony = max(ceremonyA, ceremonyB);
  var aureole = pow(wave(abs(x - 0.5) * 0.65 + y * 0.22 - z * 0.18
                       - washPhase * 2.0), 3.0);
  bri = bri * (0.82 + ceremony * 0.22)
      + aureole * ceremony * (0.050 + swell * 0.080);
  bri = clamp01(bri);

  // Palette blend cp1 (deep red/amber) <-> cp2 (warm gold) along a decorrelated
  // wash phase so both hues are present across the rig (hue spread). Push the
  // blend toward the two endpoints (bimodal) so pixels read as distinctly cp1 OR
  // cp2 rather than a muddy midpoint -> wider measured hue spread.
  var tcol = clamp01(craw);
  tcol = tcol * tcol * (3.0 - 2.0 * tcol);   // smoothstep -> bias toward 0 and 1
  var r = (pr1 + (pr2 - pr1) * tcol) * bri;
  var g = (pg1 + (pg2 - pg1) * tcol) * bri;
  var b = (pb1 + (pb2 - pb1) * tcol) * bri;

  // ── VINTAGE GOLDEN PULSE: portable fixture role, never bench-only IDs ─────
  // The matched white pair supplies the luminous core. An RGB gold bias warms
  // the Vintage rail's native W emitter; the Vintage profile has no amber lane,
  // while RGBWAU fixtures would still receive byte-identical W and A.
  var w = 0.0;
  if (fixtureType == FIX_VINTAGE_6) {
    var goldPulse = blindEnv * (0.82 + 0.18 * noise);
    r = r + goldPulse * 0.72;
    g = g + goldPulse * 0.38;
    b = b + goldPulse * 0.05;
    w = goldPulse * 0.78;
  } else if (fixtureType == FIX_TE_SIGN) {
    // Identity is a coherent warm emblem with a clear double heartbeat, not
    // the continuous full-sign wash used by Pattern 00. Fixed XYZ/path relief
    // gives the physical strokes depth without turning the pulse into a chase.
    var signPath = pixelLocalIndex * 0.01351351351;
    var signSpace = clamp01(x * 0.43 + y * 0.34 + z * 0.23);
    var signRelief = wave(signPath * 1.61803 + x * 1.17
                        - y * 0.71 + z * 0.43);
    var emblemPhase = ceremonyPhase
                    + (signRelief - 0.5) * 0.018;

    // A decisive primary contraction/bloom is followed by a smaller second
    // beat about one tenth-cycle later. High smooth powers separate the beats
    // cleanly while retaining several interpolation frames at the edges.
    var pulseA = wave(emblemPhase);
    pulseA = pow(pulseA, 18.0);
    var pulseB = wave(emblemPhase - 0.10);
    pulseB = pow(pulseB, 22.0) * 0.60;
    var emblemPulse = max(pulseA, pulseB);
    var signBody = clamp01(0.25 + swell * 0.24
                         + emblemPulse * (0.27 + swell * 0.20)
                           * (0.82 + signRelief * 0.18));
    var signMix = clamp01(0.10 + signSpace * 0.55
                        + signRelief * 0.08 + pulseA * 0.10
                        + pulseB * 0.18);
    r = (pr1 + (pr2 - pr1) * signMix) * signBody;
    g = (pg1 + (pg2 - pg1) * signMix) * signBody;
    b = (pb1 + (pb2 - pb1) * signMix) * signBody;
  }

  // LANE MATCH (w == a): the bare W emitter reads cold and the bare A emitter
  // reads yellow — matched W+A is the ship's warm white, and it is what the LED
  // strands already render (they fold amber into RGB). Convention:
  // docs/MARSIN_ENGINE_PATTERNS.md -> "White handling: the w == a convention".
  rgbwau(clamp01(r), clamp01(g), clamp01(b), clamp01(w), clamp01(w), 0.0);
}
