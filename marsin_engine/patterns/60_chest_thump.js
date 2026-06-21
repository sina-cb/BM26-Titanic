/*
  60_chest_thump.js — full-rig SUB-BASS CHEST-HIT slam over a calm hull wash.

  Round-2 audio identity: audioChestHit is a narrow ~30–60 Hz sub-bass transient
  pulse — the "felt in the chest" slam on the big low moments. Here it drives a
  WHOLE-RIG brightness SLAM: a calm slow palette wash breathes underneath, and on
  every chest hit the entire hull punches to full output, then decays back to the
  calm base. The slam is global (every pixel), so total frame brightness tracks
  the chest-hit pulse tightly — the rig literally thumps with the sub.

  Two visual layers:
    BASE  — a slow two-colour wash (cp1<->cp2 across X) that gently breathes so
            the rig is alive and readable in silence (mission-critical), never
            fully dark, never frozen.
    SLAM  — a persistent envelope armed to 1.0 on each chest-hit rising edge,
            decaying each frame. It lifts EVERY pixel's brightness toward full
            and adds a clean white-channel core pop at the peak, so a hit reads
            as a hot full-hull flash. A faint radial vignette keeps the rim a
            touch darker than the core for depth (still bright, still high-def).

  The chest-hit slam is a BRIGHTNESS reactivity (global), so frame brightness
  correlates strongly with audioChestHit — the intended headline.

  COORDINATE-DRIVEN (x + radius from center) so it ports test_bench -> titanic
  unchanged.

  CONTROLS (UI order = declaration order)
    - localSpeed : calm base wash breathing rate (0 = freeze the wash).
    - thump      : CHEST-HIT trigger (audio audioChestHit) -> full-rig slam.
    - base       : calm base brightness floor (always-on; never dark).
    - decay      : slam envelope fall rate (slow = long thump tail).
    - colorPalette1/2 : strict cp1<->cp2 wash colours.

  AUDIO (modulators-only — NEVER read CPC audio globals natively):
  AUDIO_MODULATION_V1:
    sliderThump <- audioChestHit range 0.00..1.00 curve linear  # HEADLINE: sub-bass chest hit SLAMS the whole rig to full, then decays
    sliderBase  <- micLow        range 0.18..0.70 curve linear  # secondary: calm base floor leans up with sustained low energy
  STATIC (operator handles, not audio-mapped): localSpeed, decay, colorPalette1/2.
  GLOBAL-SLAM pattern: validate on --synth kick_4floor / edm_drop (audioChestHit
  fires). The slam is whole-rig, so corr(audioChestHit, frame brightness) is the
  headline and reads HIGH; micLow->base is the gentle continuous floor.
*/

// ── Exported controls (UI order = declaration order) ─────────────────────────
export var localSpeed = 0.5;   // calm base wash breathing rate
export var thump = 0.0;        // CHEST-HIT trigger -> full-rig slam (audio audioChestHit)
export var base = 0.42;        // calm base brightness floor (always-on; never near-dark) —
                               //   the idle wash reads clearly at silence (mission-critical
                               //   night-visibility), matching the 64/65/66 reference floor.
export var decay = 0.5;        // slam envelope fall rate

export var cp1H = 0.62, cp1S = 1.0, cp1V = 1.0; // palette 1 — deep blue (calm)
export var cp2H = 0.92, cp2S = 0.9, cp2V = 1.0; // palette 2 — magenta   (hot)
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderThump(v) { thump = v; }
export function sliderBase(v) { base = 0.18 + v * 0.42; } // 0.18..0.60; never near-dark
export function sliderDecay(v) { decay = v; }

// ── Tunables ─────────────────────────────────────────────────────────────────
var ARM_THRESH = 0.35;   // chest-hit level that arms a fresh slam (rising edge)
var REARM      = 0.18;   // hysteresis re-arm
var DECAY_MIN  = 1.8;    // slam fall/sec at decay=0 (long thump)
var DECAY_MAX  = 6.0;    // slam fall/sec at decay=1 (snappy)
var SLAM_GAIN  = 0.95;   // how much of full output a fresh slam reaches
var W_POP      = 0.5;    // white-channel core pop at the slam peak
var VIGNETTE   = 0.30;   // rim darkening depth (0 = flat, keeps the core hotter)

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

function clamp01(v) { if (v < 0.0) return 0.0; if (v > 1.0) return 1.0; return v; }

// ── Persistent slam envelope + arm ───────────────────────────────────────────
var slam = 0.0;     // 0..1, armed on a chest hit, decays each frame
var armed = 1;      // rising-edge arm
var tWash = 0.0;    // calm wash phase
var fall = 3.0;     // resolved slam fall rate this frame

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  _hsv2rgb1();
  _hsv2rgb2();

  // calm wash cadence (pow2 law) so localSpeed visibly changes the breathing.
  var rate = pow(2.0, (localSpeed - 0.5) * 4.0);
  tWash = time(0.10 / rate);

  fall = DECAY_MIN + clamp01(decay) * (DECAY_MAX - DECAY_MIN);

  // chest-hit rising edge -> slam to 1.0
  if (armed == 1 && thump >= ARM_THRESH) { slam = 1.0; armed = 0; }
  if (thump < REARM) armed = 1;

  slam = slam - dt * fall;
  if (slam < 0.0) slam = 0.0;
}

export function render3D(index, x, y, z) {
  // ── calm BASE wash: two-colour gradient across X that gently breathes ───────
  var breath = 0.5 + 0.5 * wave(tWash + x * 0.6);     // 0..1
  var baseBri = base * (0.55 + 0.45 * breath);         // never fully dark

  // palette blend position: a slow traveling gradient across X so BOTH colours
  // read on every rig; the slam pushes the whole frame toward cp2 (hot) at peak.
  var washCol = clamp01(x * 0.7 + 0.15 * wave(tWash * 0.6));

  // ── SLAM: whole-rig brightness lift on a chest hit ──────────────────────────
  // A faint radial vignette keeps the rim a touch darker than the core for depth
  // (still bright). The slam dominates every pixel, so total brightness tracks
  // audioChestHit tightly (the headline correlation).
  var dx = clamp01(x) - 0.5;
  var dy = clamp01(y) - 0.5;
  var rad = sqrt(dx * dx + dy * dy);                   // 0..~0.7
  var vig = 1.0 - VIGNETTE * (rad / 0.7);
  if (vig < 0.0) vig = 0.0;
  var slamBri = slam * SLAM_GAIN * vig;

  // compose: base shows through, slam lifts the whole rig
  var bri = baseBri + slamBri;
  bri = clamp01(bri);

  // on a slam the palette blends toward cp2 (hot) so the thump also reads as a
  // colour shift, not just a brightness lift.
  var tcol = clamp01(washCol + 0.55 * slam);

  var r = (pr1 + (pr2 - pr1) * tcol) * bri;
  var g = (pg1 + (pg2 - pg1) * tcol) * bri;
  var b = (pb1 + (pb2 - pb1) * tcol) * bri;

  // white-channel core pop at the slam peak: a clean bright spike, hottest at
  // the rig core, that lifts the peak channel toward 255 on a fresh thump.
  var ww = slam * W_POP * vig;

  rgbwau(clamp01(r), clamp01(g), clamp01(b), clamp01(ww), 0.0, 0.0);
}
