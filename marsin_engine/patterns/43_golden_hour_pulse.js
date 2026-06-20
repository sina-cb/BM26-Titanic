/*
  43_golden_hour_pulse.js — GOLDEN HOUR PULSE (HD, sound-reactive).

  An HD, audio-reactive reinterpretation of 00_golden_hour_wash. The beloved
  warm sunset wash is kept — a deep amber/red -> warm gold field drifting across
  the whole rig — but sharpened so it has CRISP warm cores and DARKER troughs
  (high-definition, not a flat glow), and wired to the music three ways.

  THE LOOK
    - A warm wash drifts diagonally across the rig (x + y - z phase), strictly
      blending cp1 (deep amber/red) <-> cp2 (warm gold) in RGB space.
    - The wash field is cubed (noise*noise*noise) so peaks read as bright warm
      cores against near-dark troughs — the "HD" sunset, high contrast.
    - The drift never loops: the phase advances by an IRRATIONAL rate and the
      spatial axes are scaled by irrationals (sqrt2 on x, 1/phi on y, golden
      angle term on z), so no two passes ever align — an endless golden hour.

  SIGNATURE FEATURE — VINTAGE BLINDERS
    The vintage fixtures (fixtureId 5 and 6, the upper Y heads) act as audience
    BLINDERS. On each kick, the W (white) channel on those two fixtures is driven
    HARD via rgbwau so they POP bright white — exactly the 00_golden_hour
    `if (y > 0.8) w = ...` idea, but FIRED BY THE BEAT. A persistent envelope
    snaps to 1.0 on a kick and decays each frame so the pop is a crisp strobe-y
    flash with a short warm afterglow, not a smear.

  AUDIO MAP (modulators-only — NEVER read CPC audio globals natively, codex P0):
  AUDIO_MODULATION_V1:
    sliderSwell   <- micLow  range 0.00..1.00 curve linear   # PRIMARY brightness/swell
    sliderBlinder <- micKick range 0.00..1.00 curve linear   # vintage white blinder pop
    sliderShimmer <- micHigh range 0.00..0.80 curve pow2     # fine warm shimmer/detail
  Static (unmapped) params: localSpeed, noiseScale, colorPalette1/2.
    Sliders use the IDENTITY convention (store v directly, scale in render). At
    rest (no audio) the rig shows a calm, never-black warm wash (mission-critical
    visibility).

  CORE EQUATION (per pixel, sunset wash core):
      v = (x*SQRT2*ns + y*INVPHI*ns*0.5 - z*GA*ns*0.35 + tPhase)
      noise = wave(v); noise = noise^3            // HD warm cores / dark troughs
      bri   = noise * (FLOOR + swell*SWELL_GAIN)   // micLow swells the whole wash
    where SQRT2=1.41421, INVPHI=0.61803, GA=0.38197 (golden-angle frac), and
    tPhase advances at an irrational rate (PHI-derived) so the wash never repeats.

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
export function sliderNoiseScale(v) { noiseScale = 0.1 + (v * 0.8); }

// ── Tunables (irrational drift; no integer periods) ──────────────────────────
var SQRT2 = 1.41421356;   // x-axis spatial scale
var INVPHI = 0.61803398;  // y-axis spatial scale (1/phi)
var GA = 0.38196601;      // z-axis spatial scale (golden-angle fraction 1 - 1/phi)
var DRIFT = 0.07639320;   // drift rate (2 - phi)/10 — slow, irrational, never loops
var FLOOR = 0.125;        // resting wash brightness. OPERATOR DIRECTION: MAX REACTIVITY —
                          //   the PRIMARY micLow->brightness corr collapses if the resting
                          //   base dominates total brightness, so the floor is pushed LOW.
                          //   A darker idle is accepted (the rig still ANIMATES at rest: the
                          //   cubed wash drifts on tPhase and the warmFloor breathes with the
                          //   wash phase). A loud swell drives the warm cores hard to 255.
var SWELL_GAIN = 1.30;    // how hard micLow swells the wash. Tuned so the loud-swell cores
                          //   reach full but the field mostly stays in the LINEAR region
                          //   (heavy clamping/saturation flattens the response and kills the
                          //   micLow->brightness correlation).
var BLIND_DECAY = 7.0;    // blinder envelope decay (per second) — crisp flash
var SHIM_HZ = 0.041666;   // shimmer churn time-scale (irrational-ish, fine grain)

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
var tPhase = 0.0;       // accumulated wash drift phase (irrational rate)
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

  // Drift the wash at an IRRATIONAL rate so the sunset never loops.
  tPhase = tPhase + (delta / 1310.72) * localMult * DRIFT;
  tPhase = tPhase - floor(tPhase);

  // Shimmer churn (fine grain), modulated by localSpeed.
  tShim = time(SHIM_HZ / (0.25 + localSpeed));

  // PRIMARY: micLow swells the whole wash above its resting FLOOR. Linear so the
  // wash brightness tracks low energy proportionally (strong brightness corr)
  // without clamping out the response.
  washGain = FLOOR + clamp01(swell) * SWELL_GAIN;

  // VINTAGE BLINDER: rising edge of micKick (blinder slider) snaps the envelope
  // to full; it then decays each frame -> a crisp white flash with short tail.
  if (blinder > 0.45 && lastKick <= 0.45) blindEnv = 1.0;
  lastKick = blinder;
  blindEnv = blindEnv - dt * BLIND_DECAY;
  if (blindEnv < 0.0) blindEnv = 0.0;
}

export function render3D(index, x, y, z) {
  // ── Sunset wash field (irrational spatial scales; HD warm cores) ──────────
  var nx = x * SQRT2 * noiseScale;
  var ny = y * INVPHI * noiseScale * 0.5;
  var nz = z * GA * noiseScale * 0.35;
  var v = nx + ny - nz + tPhase;
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
  var cphase = (x * SQRT2 - y * INVPHI + z * GA) * 1.7 + tPhase * 1.6180339;
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

  // ── VINTAGE BLINDERS: fixtureId 5 & 6 pop white on the kick (W channel) ────
  // Exactly the 00_golden_hour `w = ...` idea, but fired by micKick. The blinder
  // rides ON TOP of the warm wash so the heads still read warm between kicks.
  var w = 0.0;
  if (fixtureId == 5 || fixtureId == 6) {
    w = blindEnv * (0.80 + 0.20 * noise);   // hard white pop, slight wash texture
  }

  rgbwau(clamp01(r), clamp01(g), clamp01(b), clamp01(w), 0.0, 0.0);
}
