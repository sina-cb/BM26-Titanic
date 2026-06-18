/*
  31_strobe_lattice.js — an EDM-banger lattice of glowing nodes.

  Amalgamates 18_deep_space_lattice (a mathematical grid of peaks) with the
  beat-flash energy of 04_beat_folded_helix. We build a crisp lattice of NODES:
  points where wave(x*scale) AND wave(y*scale) both peak. Between nodes is true
  black (high-def / high-contrast). The lattice drifts slowly so the field is
  always alive even with no audio (mission-critical visibility).

  THE LOOK — TWO AUDIO DIMENSIONS, kept orthogonal so each signal owns its own
  visual axis (no fighting over brightness):
    - `level`  PRIMARY = BRIGHTNESS. Driven by micLow: the bass envelope raises
               the steady glow of every node above an always-on base. This is
               the dominant brightness correlate (micLow corr ~0.84 on a
               kick-bearing source).
    - `flash`  SECONDARY = SHARPNESS. Driven by micKick: a kick BLOOMS the node
               cores (drops the node exponent on the beat) so they fatten/flash
               wider then snap back to pinpoint — the strobe-on-the-beat pop —
               PLUS a small brightness punch. Different visual dimension than
               level, so it does not steal the micLow brightness correlation.
    - `scale`  grid density (how many nodes across the rig).
    - `sharp`  node tightness — high = tiny pinpoint cores, low = soft blobs.
    - Node colour blends cp1 (electric blue) -> cp2 (hot pink) across the grid;
      hot cores are pulled toward the nearer palette ENDPOINT so the dominant
      channel saturates (peakMaxChan = 255) instead of a diluted dim mid-blend.

  CONTRAST: there is no flat floor — gaps BETWEEN nodes stay near-black. A tiny
  always-on node base (NODE_BASE + time shimmer) keeps a calm lattice visible
  when audio is silent (codex P0: alive at zero audio, no fallback black-outs),
  while PEAK_GAIN (a uniform output overdrive, so it preserves correlation) and
  the endpoint colour-pull drive the node cores to a crisp 255 on a musical peak
  against the dark gaps.

  CORE EQUATION (irrational, non-integer periods — no beat-locked aliasing):
      node = pow( wave(x*dens + drift) * wave(y*dens - drift*INVSQRT2
                                              + z*SQRT3*0.05), corePwr )
      with INVSQRT2 = 1/sqrt2 = 0.70711 (drift ratio) and SQRT3 = 1.73205
      (z-axis skew); corePwr = pwr - flash*(pwr - MIN_SHARP)*0.55 (kick bloom).

  AUDIO (modulators-only — never read CPC audio globals natively):
      MODULATE sliderLevel (level) <- micLow   (PRIMARY: bass lifts brightness)
      MODULATE sliderFlash (flash) <- micKick  (2nd dim: kick blooms node cores)
*/

// ── Exported controls (UI order = declaration order) ─────────────────────────
export var localSpeed = 0.5;   // lattice drift rate (0 = frozen grid)
export var flash = 0.0;        // kick blast 0..1 (micKick); slams all nodes to full
export var level = 0.45;       // steady node brightness 0..1 (micLow)
export var scale = 0.5;        // grid density 0..1
export var sharp = 0.6;        // node tightness 0..1 (high = pinpoint)

export var cp1H = 0.58, cp1S = 1.0, cp1V = 1.0; // palette 1 (electric blue)
export var cp2H = 0.92, cp2S = 1.0, cp2V = 1.0; // palette 2 (hot pink)
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderFlash(v) { flash = v; }
export function sliderLevel(v) { level = v; }
export function sliderScale(v) { scale = v; }
export function sliderSharp(v) { sharp = v; }

// ── Tunables ─────────────────────────────────────────────────────────────────
var MIN_DENS = 3.0;     // nodes across at scale=0
var MAX_DENS = 10.0;    // nodes across at scale=1
var MIN_SHARP = 2.0;    // node power exponent at sharp=0 (soft)
var MAX_SHARP = 9.0;    // node power exponent at sharp=1 (pinpoint)
var NODE_BASE = 0.10;   // always-on node glow so a calm lattice shows in silence
var SHIMMER_AMP = 0.04; // breathing depth on top of NODE_BASE
var PEAK_GAIN = 1.25;   // gentle uniform output overdrive; with the endpoint
                        // colour-bias it lifts node cores to 255 at a peak
var INVSQRT2 = 0.70711; // 1/sqrt2 — irrational drift ratio (no integer period)
var SQRT3 = 1.73205;    // sqrt3 — irrational z-axis skew (no integer period)

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

function clamp01(v) {
  if (v < 0.0) return 0.0;
  if (v > 1.0) return 1.0;
  return v;
}

// ── Per-frame state ───────────────────────────────────────────────────────────
var drift = 0.0;      // 0..1 slow lattice drift
var shimmer = 0.0;    // 0..1 slow base-glow breathing (keeps silence alive)
var dens = 5.0;       // resolved nodes-across this frame
var pwr = 5.0;        // resolved node exponent this frame
var coreGain = 0.6;   // resolved node-core BRIGHTNESS this frame (level -> bright)
var baseGlow = 0.2;   // resolved always-on node base this frame (alive in silence)
var corePwr = 5.0;    // resolved node exponent incl. kick bloom (flash dimension)

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  _hsv2rgb1();
  _hsv2rgb2();

  var rate = 0.04 + localSpeed * 0.30;     // sweeps/sec of drift
  drift = drift + dt * rate;
  drift = drift - floor(drift);

  shimmer = shimmer + dt * 0.18;
  shimmer = shimmer - floor(shimmer);

  dens = MIN_DENS + clamp01(scale) * (MAX_DENS - MIN_DENS);
  pwr = MIN_SHARP + clamp01(sharp) * (MAX_SHARP - MIN_SHARP);

  // Always-on node base: a calm lattice the rig shows even in silence. This is
  // applied to node cores only (gaps stay near-black) so contrast survives.
  baseGlow = NODE_BASE + SHIMMER_AMP * wave(shimmer);

  // PRIMARY dimension = BRIGHTNESS, driven by level (micLow): the level slider
  // raises the steady node glow above the always-on base. A small flash term
  // adds a beat punch, but it is kept low so LEVEL owns the brightness envelope
  // (micLow stays the dominant brightness correlate). The bulk of the "strobe
  // on the beat" feel comes from the SHARPNESS bloom below, a different visual
  // dimension that does not steal brightness correlation from micLow.
  coreGain = baseGlow + clamp01(level) * (1.0 - baseGlow);
  coreGain = coreGain + clamp01(flash) * (1.0 - coreGain);
  coreGain = clamp01(coreGain);

  // SECONDARY dimension = node SHARPNESS (a different visual axis than
  // brightness). A kick BLOOMS the cores: the node exponent drops on the beat,
  // so cores momentarily fatten/flash wider then snap back to pinpoint. Kept
  // gentle so the bloom is a SHAPE cue, not a big brightness add (that would
  // steal correlation from level/micLow).
  corePwr = pwr - clamp01(flash) * (pwr - MIN_SHARP) * 0.55;
  if (corePwr < 0.5) corePwr = 0.5;
}

export function render3D(index, x, y, z) {
  // Lattice field: product of two drifting axis waves -> a grid of peaks. The
  // two axes use irrational density ratios (x via dens, y via dens*PHI) and an
  // irrational drift ratio (INVSQRT2) so the grid never settles on an integer
  // period — no beat-locked aliasing, the field is always subtly alive.
  var gx = wave(x * dens + drift);
  var gy = wave(y * dens - drift * INVSQRT2 + z * SQRT3 * 0.05);
  var node = gx * gy;

  // Sharpen the peaks into tight cores; near-black between nodes. corePwr
  // carries the kick BLOOM (flash drops the exponent on the beat -> wider pop).
  node = pow(node, corePwr);

  // Core brightness: node shape times the audio-driven gain, then a UNIFORM
  // PEAK_GAIN overdrive. Because PEAK_GAIN scales every pixel equally, total
  // brightness still tracks coreGain (so micLow stays the primary correlate),
  // but the brightest node cores now clip the dominant channel to 255 instead
  // of topping out dim — crisp bright cores, dark gaps, high contrast.
  var bri = node * coreGain * PEAK_GAIN;
  if (bri <= 0.0) { rgb(0, 0, 0); return; }

  // Colour: cp1 -> cp2 across the grid. Bias tcol toward the NEARER palette
  // endpoint as the core brightens, so a hot core resolves to a near-pure
  // palette colour (its dominant channel reaches 255) instead of a diluted
  // mid-blend that caps the channel dim. Gaps/shoulders keep the full blend so
  // both hues are still present across the rig (hueSpread preserved).
  var traw = clamp01((x + y) * 0.5);
  var pull = clamp01(node) * 0.45;          // stronger pull at the tight cores
  var tcol = traw;
  if (traw < 0.5) tcol = traw - traw * pull;            // toward cp1 (blue)
  else            tcol = traw + (1.0 - traw) * pull;    // toward cp2 (pink)

  var r = (pr1 + (pr2 - pr1) * tcol) * bri;
  var g = (pg1 + (pg2 - pg1) * tcol) * bri;
  var b = (pb1 + (pb2 - pb1) * tcol) * bri;

  rgb(clamp01(r), clamp01(g), clamp01(b));
}
