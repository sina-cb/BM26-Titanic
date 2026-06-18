/*
  29_kick_shockwave.js — negative-space high-def SHOCKWAVE.

  Amalgamates 25_heartbeat (persistent pulse envelope), 03_dual_axis_crush
  (collapse/expand from rig center) and 65_dome_kick (kick-triggered burst).

  A normalized radial coordinate is taken from the rig center (~0.5,0.5) using
  x,y. A persistent scalar envelope `env` is armed to 1.0 whenever the kick
  control crosses ~0.5, then decays each frame. The visual is a SHARP expanding
  RING: its radius grows as env falls (radius = (1-env) * MAX_RADIUS), and only a
  thin band at that radius lights — true black everywhere else (negative space).

  A faint continuous BASE ring/glow (brightness scaled by sliderLevel) keeps the
  rig from ever being fully dark and makes level-reactivity measurable.

  Ring colour blends cp1 (hot core) -> cp2 (deep-blue outer) as the wave expands.

  CONTROLS (declaration order = UI order)
    - localSpeed : base-ring breathing rate (0 = freeze).
    - kick       : 0..1 trigger; crossing ~0.5 fires a shockwave. Modulatable.
    - level      : 0..1 base/ambient brightness floor. Modulatable.
    - decay      : shockwave envelope decay rate (slow ring = big slow wave).
    - ringWidth  : thickness of the expanding ring (tight = max definition).
    - colorPalette1/2 : cp1 hot white-amber (core), cp2 deep blue (outer).

  AUDIO (modulators-only — never read CPC audio globals natively):
      MODULATE sliderKick  (kick)  <- micKick
      MODULATE sliderLevel (level) <- micLow
*/

// ── Exported controls (UI order = declaration order) ────────────────────────
export var localSpeed = 0.5;   // base-ring breathing rate (0 = freeze)
export var kick = 0.0;         // 0..1 trigger; crossing ~0.5 fires a shockwave
export var level = 0.25;       // 0..1 base brightness floor (ambient ring/glow)
export var decay = 0.5;        // shockwave envelope decay rate
export var ringWidth = 0.4;    // expanding-ring thickness (tight = max def)

export var cp1H = 0.11, cp1S = 0.45, cp1V = 1.0; // palette 1 (hot white-amber core)
export var cp2H = 0.62, cp2S = 1.0,  cp2V = 1.0; // palette 2 (deep blue outer)
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderKick(v) { kick = v; }
export function sliderLevel(v) { level = v; }
export function sliderDecay(v) { decay = v; }
export function sliderRingWidth(v) { ringWidth = v; }

// ── Tunables ────────────────────────────────────────────────────────────────
var MAX_RADIUS = 0.78;   // radius the ring reaches at env=0 (covers all sections)
var DECAY_MIN = 0.6;     // env decay per second at decay=0
var DECAY_MAX = 3.4;     // env decay per second at decay=1
var KICK_ARM = 0.5;      // kick control level that arms a new shockwave
var BASE_W = 0.10;       // half-width of the faint continuous base ring
var BASE_MIN = 0.06;     // minimal time-based floor (always-on, level-independent)

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
var env = 0.0;          // shockwave envelope, armed to 1.0 on a kick, decays down
var prevKick = 0.0;     // previous kick value (edge detection)
var ringRad = 1.0;      // resolved ring radius this frame (1.0 = off-screen / done)
var ringW = 0.06;       // resolved ring half-width this frame
var basePhase = 0.0;    // base-ring breathing phase 0..1

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  _hsv2rgb1();
  _hsv2rgb2();

  // Edge-detect the kick control: a rising crossing of KICK_ARM arms a wave.
  if (kick >= KICK_ARM && prevKick < KICK_ARM) env = 1.0;
  prevKick = kick;

  // Decay the envelope toward 0 (rate set by the decay slider).
  var rate = DECAY_MIN + decay * (DECAY_MAX - DECAY_MIN);
  env = env - dt * rate;
  if (env < 0.0) env = 0.0;

  // Ring radius grows as env falls: env=1 -> r=0 (born at center),
  // env=0 -> r=MAX_RADIUS (fully expanded / faded out).
  ringRad = (1.0 - env) * MAX_RADIUS;

  // Tight ring for definition; clamp so it never collapses to nothing.
  ringW = 0.02 + ringWidth * 0.10;

  // Faint continuous base-ring breathing.
  basePhase = basePhase + dt * (0.05 + localSpeed * 0.25);
  basePhase = basePhase - floor(basePhase);
}

export function render3D(index, x, y, z) {
  // Normalized radial coordinate from the rig center (~0.5, 0.5).
  var dx = x - 0.5;
  var dy = y - 0.5;
  var rad = sqrt(dx * dx + dy * dy);

  // ── Faint continuous BASE ring/glow (never fully dark; level-reactive) ──
  // A slow breathing ring whose radius walks the rig, brightness from level.
  var baseR = 0.18 + 0.30 * (0.5 + 0.5 * wave(basePhase));
  var bd = abs(rad - baseR);
  var baseBri = 0.0;
  if (bd < BASE_W) {
    // Minimal time-based ring floor (BASE_MIN) so the rig ALWAYS reads, even
    // when level is modulated to 0 by silence; level scales it up on top.
    baseBri = (1.0 - bd / BASE_W) * (BASE_MIN + level * 0.55);
  }
  // Plus a gentle level-scaled floor glow so the whole rig reads on loud lows.
  baseBri = baseBri + level * 0.10;

  // ── Sharp expanding SHOCKWAVE ring (negative space, true black off-ring) ──
  var waveBri = 0.0;
  var tcol = 0.0;       // 0 = core/hot (cp1), 1 = outer/blue (cp2)
  if (env > 0.0) {
    var rd = abs(rad - ringRad);
    if (rd < ringW) {
      // Triangular falloff across the ring width -> crisp edge.
      var prof = 1.0 - rd / ringW;
      // Ring intensity is strongest at birth, fades with env.
      waveBri = prof * prof * (0.35 + 0.65 * env);
    }
    // Colour walks cp1->cp2 as the wave expands outward.
    tcol = clamp01(ringRad / MAX_RADIUS);
  }

  // Compose: the bright shockwave dominates; base shows through in its absence.
  var bri = baseBri;
  if (waveBri > bri) bri = waveBri;
  bri = clamp01(bri);

  // Colour: base uses the outer (cool) end so it stays calm; wave blends hot->cool.
  var useCol = tcol;
  if (waveBri <= baseBri) useCol = 0.78;  // calm base leans cool

  var r = (pr1 + (pr2 - pr1) * useCol) * bri;
  var g = (pg1 + (pg2 - pg1) * useCol) * bri;
  var b = (pb1 + (pb2 - pb1) * useCol) * bri;

  rgb(clamp01(r), clamp01(g), clamp01(b));
}
