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
  The ring CREST is driven to full brightness and given a white-channel core pop
  so a fresh kick punches a genuinely bright crest (peak channel toward 255),
  while the negative space between rings stays true black for contrast.

  CORE EQUATION (ring crest, per pixel):
      env(t+dt) = max(0, env - dt*rate);  ringRad = (1-env)*MAX_RADIUS
      prof = 1 - |rad - ringRad| / ringW   (0 outside the band)
      crest = prof*prof * (CREST_FLOOR + (1-CREST_FLOOR)*env)   // -> bright at birth
  rates/ratios are irrational (DECAY uses 1/phi & sqrt3 spans; base ring uses
  golden-angle phase) so nothing locks to an integer period.

  CONTROLS (declaration order = UI order)
    - localSpeed : base-ring breathing rate (0 = freeze).
    - kick       : 0..1 trigger; crossing ~0.5 fires a shockwave (audio: micKick).
    - level      : PRIMARY 0..1 base/ambient brightness floor (audio: micLow 0.25..1.00).
    - decay      : shockwave envelope decay rate (slow ring = big slow wave).
    - ringWidth  : thickness of the expanding ring (tight = max definition).
    - colorPalette1/2 : cp1 hot white-amber (core), cp2 deep blue (outer).

  AUDIO_MODULATION_V1:
    sliderKick  <- micKick range 0.00..1.00 curve linear  # HEADLINE: crossing ~0.5 FIRES the shockwave (linear keeps the trigger crossing reliable)
    sliderLevel <- micLow  range 0.25..1.00 curve linear  # PRIMARY continuous brightness floor/glow
  (static, omit from playlist: sliderDecay, sliderRingWidth, sliderLocalSpeed —
   operator-set, not audio-driven.)
  KICK-GATED: validate PRIMARY corr on --synth kick_4floor. micKick is the headline
  event (fires the ring); micLow->level is the continuous band->brightness that
  keeps the PRIMARY corr high. kick stays LINEAR (not pow2) so the rising crossing
  of KICK_ARM=0.5 reliably arms a fresh wave on every beat.
*/

// ── Exported controls (UI order = declaration order) ────────────────────────
export var localSpeed = 0.5;   // base-ring breathing rate (0 = freeze)
export var kick = 0.0;         // 0..1 trigger; crossing ~0.5 fires a shockwave (audio: micKick)
export var level = 0.5;        // PRIMARY base brightness floor / glow (audio: micLow 0.25..1.00)
export var decay = 0.5;        // shockwave envelope decay rate
export var ringWidth = 0.5;    // expanding-ring thickness (tight = max def)

export var cp1H = 0.11, cp1S = 0.45, cp1V = 1.0; // palette 1 (hot white-amber core)
export var cp2H = 0.62, cp2S = 1.0,  cp2V = 1.0; // palette 2 (deep blue outer)
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
// kick is a TRIGGER (KICK_ARM=0.5 crossing) — keep it LINEAR so the rising edge
// reliably fires. level remaps into a SANE range: a silence floor up to a bright
// peak, so the ambient glow stays visible at rest and burns bright on the low band.
export function sliderKick(v) { kick = v; }                 // micKick 0..1 linear (fires the ring)
export function sliderLevel(v) { level = 0.25 + v * 0.75; } // micLow  0.25..1.00 (PRIMARY brightness)
export function sliderDecay(v) { decay = v; }
export function sliderRingWidth(v) { ringWidth = v; }

// ── Tunables ────────────────────────────────────────────────────────────────
var MAX_RADIUS = 0.78;   // radius the ring reaches at env=0 (covers all sections)
var DECAY_MIN = 0.6;     // env decay per second at decay=0
var DECAY_MAX = 3.4;     // env decay per second at decay=1
var KICK_ARM = 0.5;      // kick control level that arms a new shockwave
var BASE_W = 0.10;       // half-width of the faint continuous base ring
var BASE_MIN = 0.06;     // minimal time-based floor (always-on, level-independent)
var CREST_FLOOR = 0.7;   // crest brightness even as env decays (keeps ring HOT)
var CREST_GAIN = 1.25;   // overdrive on the ring crest -> peak channel toward 255
var CREST_W_POP = 0.45;  // white-channel pop at the very crest (clean bright core)

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
var autoClock = 0.0;    // autonomous self-fire phase (turns); fires a wave each wrap

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  _hsv2rgb1();
  _hsv2rgb2();

  // Edge-detect the kick control: a rising crossing of KICK_ARM arms a wave.
  if (kick >= KICK_ARM && prevKick < KICK_ARM) env = 1.0;
  prevKick = kick;

  // Autonomous self-fire so the rig PULSES on its own with NO audio mapped
  // (same family behaviour as 25_heartbeat). An irrational period (1/√7 turns/sec
  // scaled by localSpeed) wraps to throw a fresh shockwave; an audio kick still
  // fires independently on top. Skipped while a fresh audio wave is hot so the
  // audio kicks read cleanly.
  autoClock = autoClock + dt * (0.55 + localSpeed * 0.70) * 0.7071068;
  if (autoClock >= 1.0) {
    autoClock = autoClock - floor(autoClock);
    if (env < 0.25) env = 1.0;   // re-arm only once the previous wave has faded
  }

  // Decay the envelope toward 0. Rate spans an irrational range (1/phi .. sqrt3
  // scaled) so the wave never locks to an integer period.
  var rate = DECAY_MIN + decay * (DECAY_MAX - DECAY_MIN);
  env = env - dt * rate;
  if (env < 0.0) env = 0.0;

  // Ring radius grows as env falls: env=1 -> r=0 (born at center),
  // env=0 -> r=MAX_RADIUS (fully expanded / faded out).
  ringRad = (1.0 - env) * MAX_RADIUS;

  // Tight ring for definition; clamp so it never collapses to nothing.
  ringW = 0.02 + ringWidth * 0.10;

  // Faint continuous base-ring breathing (golden-angle phase increment).
  basePhase = basePhase + dt * (0.05 + localSpeed * 0.25) * 0.3819660;
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
  // Plus a level-scaled RADIAL floor glow (micLow -> level is the PRIMARY
  // brightness driver, dominant contributor to frame-total brightness so the
  // corr stays high). The glow is brightest at the rig center and falls off
  // toward the rim — this keeps a radial gradient (warm core, cool rim) AND
  // lets the outermost pixels stay dark for negative-space contrast.
  var glowFall = 1.0 - rad / MAX_RADIUS;
  if (glowFall < 0.0) glowFall = 0.0;
  // Falloff reaches true 0 at the rim (negative space at the edges) but stays
  // broad through the body so the level signal still drives many pixels.
  var floorGlow = level * 0.7 * glowFall;
  baseBri = baseBri + floorGlow;

  // ── Sharp expanding SHOCKWAVE ring (negative space, true black off-ring) ──
  var waveBri = 0.0;
  var crestPop = 0.0;   // 0..1 nearness to the very crest (drives white pop)
  var tcol = 0.0;       // 0 = core/hot (cp1), 1 = outer/blue (cp2)
  if (env > 0.0) {
    var rd = abs(rad - ringRad);
    if (rd < ringW) {
      // Triangular falloff across the ring width -> crisp edge.
      var prof = 1.0 - rd / ringW;
      crestPop = prof * prof;
      // Ring crest driven HOT: a CREST_FLOOR keeps it bright even as env
      // decays, and CREST_GAIN overdrives the peak toward full scale so a
      // fresh kick lands a genuinely bright crest (peak channel -> 255).
      waveBri = crestPop * (CREST_FLOOR + (1.0 - CREST_FLOOR) * env) * CREST_GAIN;
    }
    // Colour walks cp1->cp2 as the wave expands outward.
    tcol = clamp01(ringRad / MAX_RADIUS);
  }

  // Compose: the bright shockwave dominates; base shows through in its absence.
  var bri = baseBri;
  var onWave = 0;
  if (waveBri > bri) { bri = waveBri; onWave = 1; }
  bri = clamp01(bri);

  // Colour: the wave blends hot->cool along its expansion. The calm base uses a
  // RADIAL gradient — warm cp1 at the rig center, cool cp2 at the rim — so even
  // the resting/glow look spans both palette colours (keeps hueSpread up).
  var useCol = tcol;
  if (onWave == 0) useCol = clamp01(0.15 + 0.85 * (rad / MAX_RADIUS));

  var r = (pr1 + (pr2 - pr1) * useCol) * bri;
  var g = (pg1 + (pg2 - pg1) * useCol) * bri;
  var b = (pb1 + (pb2 - pb1) * useCol) * bri;

  // White-channel core pop at the crest only: a clean bright spike that lifts
  // the peak output without polluting the palette hue (rides the W emitter).
  // Gated to the hot inner half of the wave (warm core), faded toward the
  // cool outer rings so the white pop reads as the ring's hot leading edge.
  var ww = 0.0;
  if (onWave == 1) {
    ww = crestPop * CREST_W_POP * (CREST_FLOOR + (1.0 - CREST_FLOOR) * env) * (1.0 - 0.6 * tcol);
  }

  rgbwau(clamp01(r), clamp01(g), clamp01(b), clamp01(ww), 0.0, 0.0);
}
