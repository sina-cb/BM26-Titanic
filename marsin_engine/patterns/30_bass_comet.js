/*
  30_bass_comet.js — a single high-def COMET that streaks the whole rig and
  leaves a fading tail via a per-pixel feedback buffer (LANG_SPEC §9.5(B)).

  CONCEPT (amalgamates 01_cylon_sweep + 10_chasers + 27_swipe trail):
    A persistent brightness buffer `buf[index]` (N = 52, the full test_bench:
    pars 0..3, vintage 4..15, bars 16..51 — one contiguous index lane, so the
    comet streaks pars → vintage → bars and back). Each frame we DECAY the whole
    buffer, then PAINT the head cell at the comet position. Reading buf[index]
    per pixel gives a true paint-and-fade pixel trail.

    Everything scales with BASS (sliderBass, fed by micLow):
      - SPEED : more bass → the comet flies faster (more sweeps/sec).
      - TAIL  : more bass → slower decay → a LONGER tail (more cells lit).
      - HEAD  : more bass → a BRIGHTER head.
    So louder bass = a longer, brighter comet ⇒ higher TOTAL brightness, a
    strong measurable corr(micLow, brightness).

  HIGH-DEF / VISIBILITY: BASE_FLOOR = 0 → un-painted pixels are TRUE BLACK and
  the head is a tight 1–2 px core. But a minimal time-based "ember" floor keeps
  the head crawling and faintly lit even in silence — never fully dark
  (mission-critical), never a crash.

  COLOR: cp1 = cyan head, cp2 = magenta tail; each pixel blends head→tail by how
  fresh its energy is (bright = head color, faded = tail color).

  AUDIO (modulators-only — never read CPC audio globals natively):
      MODULATE sliderBass <- micLow
*/

// ── Exported controls (UI order = declaration order) ─────────────────────────
export var localSpeed = 0.5;   // auto-animate base rate (0 = slowest crawl)
export var bass = 0.0;         // 0..1 bass drive (speed + tail + head) — modulatable
export var tail = 0.5;         // base tail length (decay); bass extends it further
export var headBright = 1.0;   // base head brightness; bass scales it

export var cp1H = 0.50, cp1S = 1.0, cp1V = 1.0; // palette 1 — cyan head
export var cp2H = 0.85, cp2S = 1.0, cp2V = 1.0; // palette 2 — magenta tail
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderBass(v) { bass = v; }
export function sliderTail(v) { tail = v; }
export function sliderHeadBright(v) { headBright = v; }

// ── Tunables ─────────────────────────────────────────────────────────────────
var N = 52;             // feedback buffer size — explicit constant, NOT pixelCount
var MIN_RATE = 0.12;    // cells/sec floor (silence: a slow faint comet)
var MAX_RATE = 28.0;    // cells/sec at full speed + full bass
var DECAY_SLOW = 0.62;  // per-frame keep factor at shortest tail (fast fade)
var DECAY_FAST = 0.93;  // per-frame keep factor at longest tail (slow fade)
var EMBER = 0.10;       // minimal head floor in silence (never fully black)

// ── Palette RGB cache (strict cp1<->cp2 blending; PATTERNS.md §7) ─────────────
var pr1 = 0, pg1 = 1, pb1 = 1;
var pr2 = 1, pg2 = 0, pb2 = 1;
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

// ── Persistent state (carried across frames) ─────────────────────────────────
var buf = array(52);    // per-pixel brightness feedback buffer (size = N)
var headPos = 0.0;      // comet head position in continuous cell space [0,N)
var dir = 1.0;          // sweep direction (+1 / -1) — bounces at the ends
var inited = 0;

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  _hsv2rgb1();
  _hsv2rgb2();

  if (inited == 0) {
    for (var kk = 0; kk < N; kk++) buf[kk] = 0.0;
    inited = 1;
  }

  // BASS drives speed: louder bass → faster comet.
  var rate = MIN_RATE + (MAX_RATE - MIN_RATE) * clamp01(localSpeed) * clamp01(0.18 + 0.82 * bass);

  // Advance the head and bounce at the rail ends so it streaks the whole rig.
  headPos = headPos + dir * rate * dt;
  if (headPos >= N - 1.0) { headPos = N - 1.0; dir = -1.0; }
  if (headPos <= 0.0)     { headPos = 0.0;     dir = 1.0;  }

  // BASS drives tail: louder bass → slower decay → longer tail.
  var keep = DECAY_SLOW + (DECAY_FAST - DECAY_SLOW) * clamp01(clamp01(tail) * 0.55 + bass * 0.45);

  // Decay the whole buffer once per frame (O(N), in beforeRender — §9.1).
  for (var kk = 0; kk < N; kk++) {
    buf[kk] = buf[kk] * keep;
    if (buf[kk] < 0.002) buf[kk] = 0.0;
  }

  // BASS drives head brightness: louder bass → brighter head (+ an ember floor
  // so silence still shows a faint crawling comet, never fully black).
  var hb = clamp01(headBright) * (EMBER + (1.0 - EMBER) * bass);
  if (hb < EMBER) hb = EMBER;

  // Paint the head cell (and a tight half-bright neighbour for a crisp 1–2 px
  // core) — additive into the feedback buffer.
  var ci = floor(headPos + 0.5);
  if (ci < 0) ci = 0;
  if (ci > N - 1) ci = N - 1;
  if (hb > buf[ci]) buf[ci] = hb;

  var ni = ci + dir;
  if (ni >= 0 && ni <= N - 1) {
    var nb = hb * 0.45;
    if (nb > buf[ni]) buf[ni] = nb;
  }
}

export function render3D(index, x, y, z) {
  // Guard the buffer index (P0 — never read out of range).
  var ix = index;
  if (ix < 0) ix = 0;
  if (ix > N - 1) ix = N - 1;

  var bri = buf[ix];
  if (bri <= 0.0) { rgb(0, 0, 0); return; }   // true black where un-painted

  // Fresh energy = head colour (cp1), faded energy = tail colour (cp2).
  var tcol = clamp01(1.0 - bri);
  var r = (pr1 + (pr2 - pr1) * tcol) * bri;
  var g = (pg1 + (pg2 - pg1) * tcol) * bri;
  var b = (pb1 + (pb2 - pb1) * tcol) * bri;

  rgb(clamp01(r), clamp01(g), clamp01(b));
}
