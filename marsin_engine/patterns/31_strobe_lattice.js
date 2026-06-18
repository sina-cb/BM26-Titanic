/*
  31_strobe_lattice.js — an EDM-banger lattice of glowing nodes.

  Amalgamates 18_deep_space_lattice (a mathematical grid of peaks) with the
  beat-flash energy of 04_beat_folded_helix. We build a crisp lattice of NODES:
  points where wave(x*scale) AND wave(y*scale) both peak. Between nodes is true
  black (high-def / high-contrast). The lattice drifts slowly so the field is
  always alive even with no audio (mission-critical visibility).

  THE LOOK
    - `level`  sets the steady brightness of every node (the resting glow).
    - `flash`  is a KICK blast: on each kick it briefly slams ALL nodes to full,
               then the slider falls back (driven by micKick via modulation),
               giving a hard strobe-on-the-beat banger feel.
    - `scale`  grid density (how many nodes across the rig).
    - `sharp`  node tightness — high = tiny pinpoint cores, low = soft blobs.
    - Node colour blends cp1 (electric blue) -> cp2 (hot pink) across the grid.

  CONTRAST: there is no flat floor — un-lit pixels are true black. A tiny
  time-based shimmer keeps a minimum node glow so the rig never blacks out when
  audio is silent (codex P0: alive at zero audio, no fallback black-outs).

  AUDIO (modulators-only — never read CPC audio globals natively):
      MODULATE sliderFlash <- micKick
      MODULATE sliderLevel <- micLow
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
var MIN_DENS = 3.0;    // nodes across at scale=0
var MAX_DENS = 10.0;   // nodes across at scale=1
var MIN_SHARP = 2.0;   // node power exponent at sharp=0 (soft)
var MAX_SHARP = 9.0;   // node power exponent at sharp=1 (pinpoint)
var BASE_GLOW = 0.06;  // minimum node glow so silence is never fully black

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
var nodeBri = 0.45;   // resolved steady node brightness this frame

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

  // Steady brightness: the level slider plus a small breathing base so the
  // lattice is always visible; flash (kick) blasts the whole thing to full.
  var base = BASE_GLOW + 0.04 * wave(shimmer);
  nodeBri = base + clamp01(level) * (1.0 - base);
  nodeBri = nodeBri + clamp01(flash) * (1.0 - nodeBri);
  nodeBri = clamp01(nodeBri);
}

export function render3D(index, x, y, z) {
  // Lattice field: product of two drifting axis waves -> a grid of peaks.
  var gx = wave(x * dens + drift);
  var gy = wave(y * dens - drift * 0.6);
  var node = gx * gy;

  // Sharpen the peaks into tight cores; true black between nodes.
  node = pow(node, pwr);

  var bri = node * nodeBri;
  if (bri <= 0.0) { rgb(0, 0, 0); return; }

  // Colour blends cp1 -> cp2 across the grid (diagonal position).
  var tcol = clamp01((x + y) * 0.5);
  var r = (pr1 + (pr2 - pr1) * tcol) * bri;
  var g = (pg1 + (pg2 - pg1) * tcol) * bri;
  var b = (pb1 + (pb2 - pb1) * tcol) * bri;

  rgb(clamp01(r), clamp01(g), clamp01(b));
}
