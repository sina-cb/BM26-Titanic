/*
  30_bass_comet.js — a single high-def COMET that streaks the whole rig and
  leaves a fading tail via a coordinate trail-lane (LANG_SPEC §9.5(B)).

  CONCEPT (amalgamates 01_cylon_sweep + 10_chasers + 27_swipe trail):
    A persistent brightness lane `buf` of N=128 cells laid along the normalized X
    axis (0..1) — NOT one cell per physical pixel. Each frame we DECAY the whole
    lane, then PAINT the head cell at the comet's lane position. Every physical
    pixel samples the lane cell for its OWN x, giving a true paint-and-fade trail.

  RIG-AGNOSTIC: a coordinate lane (not a per-pixel buffer) is required because the
  VM caps an array at ~162 elements while rigs reach 970 px (NEVER pixelCount=144,
  NEVER 52). The comet streaks the full X axis and bounces at the lane ends, so it
  sweeps the whole rig on EVERY model — identical look on test_bench 52 and a full
  streak across titanic 970 / dome 266 / logsville 216. Every lane access is
  guarded 0..N-1.

  ── AUDIO IDENTITY: bass drives MOTION (the headline), not brightness ──────────
  The operator's chosen design: BASS is mapped to the comet's SPEED. Sweeping the
  low band visibly DRIVES the comet — quiet = a slow drifting ember, a bass hit =
  the comet FLIES across the whole rig. This is a POSITIONAL/MOTION reactivity
  (like 27_swipe), so the usual band->brightness correlation deliberately does NOT
  apply — the headline is the comet's velocity tracking the bass, measured as a
  large frame-to-frame MOTION delta on the sound clip vs near-silence.

    PRIMARY  (motion)    : micLow -> sliderBass     -> comet SPEED  (rate)
    secondary(brightness): micHigh-> sliderHeadKick -> head/tail brightness pop

  The bass->speed coupling is the headline; the high-band brightness kick is a
  separate, secondary visual axis so a brightness response still exists without
  being the PRIMARY. Bass intentionally leaves overall brightness ~flat so the
  motion read stays clean (a brightness-coupled speed would confound the two).

  HIGH-DEF / VISIBILITY: the head is a tight crisp core; un-painted pixels read
  near-black for contrast. The comet is ALWAYS well-lit and animating at rest
  (no audio, default controls): a strong constant head gain plus a time-based
  ember keep the head crawling and bright (peakMaxChan >= 200) in silence —
  never near-dark (mission-critical), never static, never a crash.
  Core speed equation (bass -> rate):
      bassSpeed = clamp01((bass - BASS_LO) / (BASS_HI - BASS_LO))^SPEED_GAMMA
      rate      = (MIN_RATE + (MAX_RATE - MIN_RATE) * localGain * bassSpeed * wob) * RATE_SCALE
  bass spans the rate from a slow crawl (MIN_RATE) to a full streak (MAX_RATE),
  so the comet's velocity is dominated by the low band.

  COLOR: cp1 = cyan head, cp2 = magenta tail; each pixel blends head->tail by how
  fresh its energy is (bright = head color, faded = tail color), and a dim shaped
  wash spans cp1<->cp2 across X so BOTH palette colours read on every rig.

  AUDIO (modulators-only — never read CPC audio globals natively):
AUDIO_MODULATION_V1:
  sliderBass     <- micLow   range 0.20..1.00 curve linear   # PRIMARY (motion): bass drives the comet SPEED (rate), not brightness
  sliderHeadKick <- micHigh  range 0.00..1.00 curve linear   # secondary (brightness): high band pops the head/tail brightness
  # sliderTail        static 0.55  # base tail length (operator-set, not audio-driven)
  # sliderLocalSpeed  static 0.50  # operator auto-rate, not an audio target
  # sliderDirection   static 0.50  # operator heading bias, not an audio target
*/

// ── Exported controls (UI order = declaration order) ─────────────────────────
export var localSpeed = 0.5;   // auto-animate base rate (pow2 law ~0.25x..4x)
export var bass = 0.5;         // 0..1 bass drive -> comet SPEED (PRIMARY/motion). Modulatable.
                               // Default 0.5 lands the no-audio comet at a lively
                               // mid speed; a bass sweep clearly accelerates it.
export var headKick = 0.0;     // 0..1 high-band brightness pop on the head/tail (secondary). Modulatable.
export var tail = 0.55;        // base tail length (decay). Operator-set.
export var direction = 0.5;    // <0.5 bias reverse, >=0.5 bias forward; centre = auto only

export var cp1H = 0.50, cp1S = 1.0, cp1V = 1.0; // palette 1 — cyan head
export var cp2H = 0.85, cp2S = 1.0, cp2V = 1.0; // palette 2 — magenta tail
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderBass(v) { bass = v; }
export function sliderHeadKick(v) { headKick = v; }
export function sliderTail(v) { tail = v; }
export function sliderDirection(v) { direction = v; }

// ── Tunables ─────────────────────────────────────────────────────────────────
// RIG-AGNOSTIC: the trail is a fixed N=128-cell lane along the normalized X axis,
// sampled per-pixel by each pixel's x. NOT one cell per physical pixel (the VM
// caps an array at ~162 elements; rigs reach 970 px), NEVER pixelCount (=144),
// NEVER 52. 128 < the array cap so the lane is real, and a 128-cell lane gives a
// crisp comet on the 52-px test_bench while still covering the 970-px titanic.
var N = 128;            // trail-lane resolution along X (under the VM array cap)
var MIN_RATE = 3.1241;  // lane-cells/sec floor (silence: a slow drifting comet) — irrational
var MAX_RATE = 96.7128; // lane-cells/sec at full speed + full bass (a fast streak) — irrational
var DECAY_SLOW = 0.62;  // per-frame keep factor at shortest tail (fast fade)
var DECAY_FAST = 0.93;  // per-frame keep factor at longest tail (slow fade)
var EMBER = 0.18;       // minimal time-based head floor (bass=0 still reads, never dead-black)
var HEAD_CELLS = 2.5;   // head half-width in lane cells (~the 52-px 1-2 px core)
var HEAD_BASE = 0.86;   // constant head brightness at rest (NOT bass-coupled) -> always bright

// BASS -> SPEED remap: micLow's musical low band sits in a narrow elevated window;
// we remap that window to a full 0..1 SPEED drive so a real bass peak drives the
// comet to its top streak speed while quiet stretches crawl. This is the PRIMARY
// (motion) coupling — bass dominates the rate, NOT the brightness.
var BASS_LO = 0.20;        // drive value treated as "crawl" (silence baseline speed)
var BASS_HI = 0.74;        // drive value that drives the comet to full streak speed
var SPEED_GAMMA = 0.80;    // response shape of the remapped speed drive (<1 = snappy low-end)
var SQRT3 = 1.73205;       // irrational ratio for the bounce-phase wobble
var PHI = 1.6180339;       // golden ratio for the autonomous direction cadence
var PHASE_WRAP = 10000.0;  // large wrap for accumulating phases (§7, avoids seams)

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
var buf = array(128);   // trail lane along normalized X (size = N), under VM cap
var headPos = 0.0;      // comet head position in continuous lane-cell space [0,N)
var dir = 1.0;          // sweep direction (+1 / -1) — bounces at the lane ends
var inited = 0;
var autoFlip = 0.0;     // slow accumulator for autonomous direction variation (§6 #2)
var prevAutoDir = 1.0;  // last autonomous heading sign — flip is EDGE-triggered
// The original rates were tuned for a 52-cell sweep (the test_bench rig length).
// The lane is now 128 cells, so scale rates by 128/52 to keep the comet's visual
// speed (sweeps of the whole rig per second) identical to the test_bench look.
var RATE_SCALE = 2.4615;  // 128/52 — preserves the test_bench sweep cadence
var bassSpeed = 0.0;      // remapped bass SPEED drive (resolved each frame)

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

  // localSpeed exponential law (§6 canonical): 0.5 -> 1x, 1 -> 4x, 0 -> 0.25x.
  var localGain = pow(2.0, (clamp01(localSpeed) - 0.5) * 4.0);

  // PRIMARY (motion): remap the narrow micLow musical window to a full 0..1 SPEED
  // drive (gamma-shaped, <1 so the low-end snaps). bass dominates the rate.
  bassSpeed = clamp01((bass - BASS_LO) / (BASS_HI - BASS_LO));
  bassSpeed = pow(bassSpeed, SPEED_GAMMA);

  // BASS drives SPEED: louder bass -> faster comet. An irrational SQRT3 phase term
  // gives the sweep a non-repeating wobble so it never locks to an integer period.
  var wob = 0.92 + 0.08 * wave(time(0.37) * SQRT3);
  // Rate is in lane-cells/sec, scaled by 128/52 so the comet sweeps the whole rig
  // at the same visual cadence as the original 52-cell test_bench look. The span
  // from MIN_RATE (crawl) to MAX_RATE (streak) is opened entirely by bassSpeed,
  // so sweeping the bass clearly accelerates the comet across the whole rig.
  var rate = (MIN_RATE + (MAX_RATE - MIN_RATE) * localGain * bassSpeed * wob) * RATE_SCALE;

  // Autonomous direction variation (§6 #2): a slow golden-ratio cadence yields a
  // heading sign that flips on its own occasionally. We apply it EDGE-TRIGGERED
  // (only when the sign CHANGES) as a one-shot mid-lane turnaround, so the comet
  // varies heading organically WITHOUT continuously fighting the end bounces
  // (a steady override would pin the head against a wall). The operator's
  // `direction` control biases the resting heading; the bounce always reverses
  // at the lane ends so the comet streaks the whole rig regardless.
  autoFlip = autoFlip + dt * localGain * 0.013;
  if (autoFlip >= PHASE_WRAP) autoFlip = autoFlip - PHASE_WRAP;
  var autoDir = wave(autoFlip * PHI) < 0.5 ? -1.0 : 1.0;
  var travel = rate * dt;

  // Advance the head and bounce at the lane ends so it streaks the whole X axis
  // (= the whole rig, on every model, since pixels sample the lane by their x).
  headPos = headPos + dir * travel;
  if (headPos >= N - 1.0) { headPos = N - 1.0; dir = -1.0; }  // bounce off far end
  if (headPos <= 0.0)     { headPos = 0.0;     dir = 1.0;  }  // bounce off near end

  // EDGE-triggered autonomous turnaround: when the auto cadence flips sign, turn
  // the comet around once if it is well clear of both ends (never pins a wall).
  if (autoDir != prevAutoDir && headPos > 4.0 && headPos < N - 5.0) {
    dir = autoDir;
  }
  prevAutoDir = autoDir;

  // Operator heading bias: a clear off-centre push forces the resting heading
  // (left/right), guarded so it never sits exactly at 0 (§6 #5). Near centre it
  // leaves heading to the bounce + autonomous cadence.
  if (clamp01(direction) >= 0.62 && dir < 0.0 && headPos > 4.0 && headPos < N - 5.0) dir = 1.0;
  if (clamp01(direction) <= 0.38 && dir > 0.0 && headPos > 4.0 && headPos < N - 5.0) dir = -1.0;

  // TAIL length (decay) — operator-set, NOT bass-coupled (keeps brightness off the
  // bass axis so the motion read stays clean). A small high-band kick can extend it.
  var keep = DECAY_SLOW + (DECAY_FAST - DECAY_SLOW) * clamp01(clamp01(tail) + clamp01(headKick) * 0.10);

  // Decay the whole buffer once per frame (O(N), in beforeRender — §9.1).
  for (var kk = 0; kk < N; kk++) {
    buf[kk] = buf[kk] * keep;
    if (buf[kk] < 0.002) buf[kk] = 0.0;
  }

  // HEAD brightness: a strong CONSTANT base (always bright at rest, peak >= 200),
  // plus a time-based EMBER so even an extreme keeps crawling, plus a SECONDARY
  // high-band brightness POP (headKick). Bass deliberately does NOT brighten the
  // head — bass is the SPEED (PRIMARY/motion) axis, brightness is the high band.
  var hb = clamp01(HEAD_BASE + (1.0 - HEAD_BASE) * clamp01(headKick));
  if (hb < EMBER) hb = EMBER;

  // Paint the head as a small bright cluster in the 128-cell lane. On the coarse
  // 52-px test_bench this was a 1–2 px core; on the fine lane it is ~HEAD_CELLS
  // wide so every rig's per-pixel sampling reliably catches the head.
  var ci = floor(headPos + 0.5);
  if (ci < 0) ci = 0;
  if (ci > N - 1) ci = N - 1;        // hard lane guard (never OOB)
  var core = clamp01(hb);
  var halfW = floor(HEAD_CELLS + 0.5);
  if (halfW < 1) halfW = 1;
  for (var hk = ci - halfW; hk <= ci + halfW; hk++) {
    if (hk >= 0 && hk <= N - 1) {
      var dh = hk - ci; if (dh < 0) dh = 0 - dh;
      var prof = 1.0 - dh / (halfW + 1.0);   // linear falloff -> crisp head
      var hvv = core * prof;
      if (hvv > buf[hk]) buf[hk] = hvv;
    }
  }
}

export function render3D(index, x, y, z) {
  // RIG-AGNOSTIC: sample the trail lane by this pixel's normalized X (0..1), so
  // the comet renders identically on every rig (52 / 970 / 266 / 216 px). The
  // lane index is guarded 0..N-1 (P0 — never read out of range).
  var ix = floor(clamp01(x) * (N - 1) + 0.5);
  if (ix < 0) ix = 0;
  if (ix > N - 1) ix = N - 1;

  var cometBri = buf[ix];

  // ── Ambient wash: a faint, spatially-structured cp1<->cp2 floor that keeps the
  //    rig calm-but-visible in silence and reads BOTH palette colours across X.
  //    A small high-band (headKick) term lifts it slightly — the SECONDARY
  //    brightness axis. Bass is intentionally absent here (motion, not brightness).
  //    Kept dim + shaped (dark troughs) so the comet head/tail still read crisp. ──
  var washShape = wave(x * 1.7);
  washShape = washShape * washShape;          // sharpen -> keep troughs dark
  var glow = (0.018 + clamp01(headKick) * 0.10) * washShape;

  // Colour: the COMET keeps its identity (fresh = cp1 head, faded = cp2 tail);
  // the WASH spans cp1<->cp2 by X so BOTH palette colours read across the whole
  // rig (preserves the two-colour spread the head-only comet would lose).
  var bri = cometBri;
  var tcol = clamp01(1.0 - cometBri);         // comet: fresh->cp1, faded->cp2
  if (glow > bri) {
    bri = glow;
    tcol = clamp01(x);                        // wash: cp1 at left -> cp2 at right
  }

  if (bri <= 0.0) { rgb(0, 0, 0); return; }   // near-black where un-painted

  var r = (pr1 + (pr2 - pr1) * tcol) * bri;
  var g = (pg1 + (pg2 - pg1) * tcol) * bri;
  var b = (pb1 + (pb2 - pb1) * tcol) * bri;

  rgb(clamp01(r), clamp01(g), clamp01(b));
}
