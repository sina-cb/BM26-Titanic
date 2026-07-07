/*
  25_heartbeat.js — HD, audio-reactive synchronized double-pulse heartbeat.

  IDENTITY (preserved): a lub-DUB double-pulse that lifts the whole rig in a
  continuous cp1<->cp2 gradient (left->right), with a small dormant glow between
  beats. Strict cp1<->cp2 blended in RGB-space.

  WHAT'S NEW
    - render3D coords are 0..1 (no re-normalize — old (x+0.4)/2.02 was a
      black-rendering regression).
    - localSpeed drives a delta-accumulated beat clock (creeps at 0, ~4x at 1)
      so it pulses on its own with no audio mapped.
    - The beat FRONT sweeps across the rig (ripple); a guarded `direction`
      control sets which way it travels, with AUTONOMOUS variation: a slow
      incommensurate swell OCCASIONALLY reverses the sweep on its own (period
      1/√13 turns) so it isn't always one direction, never in lockstep.
    - Vintage-blinder technique: on the kick, sectionId==2 heads drive the W
      (white) channel hard — audience blinders punch on each beat.
    - Audio sliders: level (PRIMARY brightness budget), kick (beat-amplitude +
      blinder pop), radius (ripple spread = how far the beat front travels),
      detail (secondary lub/dub crispness).

  KICK-GATED: validate PRIMARY corr on --synth kick_4floor (full_track's low
  band is near-constant so corr reads lower there).

  NON-REPEATING MATH
    Beat clock accumulates at 1.0; the ripple front position uses nx so the lub
    and dub fronts traverse the rig; auto-dir at 1/√13 ≈ 0.27735, mutually
    irrational with the beat rate so the sweep direction drifts independently of
    the pulse cadence. Phases wrap at PHASE_WRAP=10000 turns.

  AUDIO_MODULATION_V1:
    sliderKick       <- micKick range 0.00..1.00 curve pow2    # HEADLINE beat/blinder pop (kick-gated)
    sliderLevel      <- micLow  range 0.30..1.00 curve linear  # PRIMARY continuous brightness budget
    sliderRadius     <- micFlux range 0.00..1.00 curve linear  # ripple spread / travel (build = wider sweep)
    sliderDetail     <- micHigh range 0.20..1.00 curve linear  # lub/dub crispness (sparkle/detail)
    sliderWhiteKick  <- micKick range 0.00..1.00 curve pow2    # extra white blinder pop on the beat
    sliderWhiteLevel <- micLow  range 0.30..1.00 curve linear  # overall white amount / keep
  (static, omit from playlist: sliderDirection, sliderDormantGlow, sliderBlinder,
   sliderBlinderBite, sliderLocalSpeed — operator-set, not audio-driven.)
  KICK-GATED PRIMARY: validate corr on --synth kick_4floor (full_track's low band
  is near-constant). micKick is the headline event; micLow->level is the continuous
  band->brightness so the PRIMARY corr holds.
  WHITE control set: the vintage heads (sectionId==2) are the headline audience
  BLINDER. The blinder bite is driven by the BEAT envelope (the `kick` slider, =
  micKick), so the heads PUNCH white on every beat with the standard kick mapping;
  `whiteKick` is an optional extra white boost on top. whiteLevel sets the overall
  white amount (and a small always-on warm keep so the heads read warm at rest),
  blinderBite shapes how snappy/hard the blinder attack lands. A subtle white core
  also rides the beat on pars/bars so the pulse has a bright center. White is
  ADDITIVE over the strict cp1/cp2 sweep (hueSpread stays high — never washes out).
  PRIMARY corr validated on kick_4floor with micKick->sliderKick wired.
*/

// ── Exported controls (UI order = declaration order) ──────────────────────────
export var localSpeed = 0.5;
export var direction = 0.06;    // 0..1; 0.5 center (guarded), <0.5 reverse sweep
export var level = 0.5;         // PRIMARY: overall brightness budget (audio: micLow 0.30..1.00)
export var kick = 0.0;          // beat amplitude + blinder pop (audio: micKick pow2)
export var radius = 0.5;        // ripple spread / travel (audio: micFlux 0..1)
export var detail = 0.5;        // lub/dub crispness (audio: micHigh 0.20..1.00)
export var minBright = 0.075;   // dormant glow between beats
export var blinder = 0.5;       // vintage-head white-blinder strength (structural)
export var whiteLevel = 0.5;    // WHITE: overall white amount / keep (audio: micLow 0.30..1.00)
export var whiteKick = 0.0;     // WHITE: beat-driven white pop (audio: micKick pow2)
export var blinderBite = 0.5;   // WHITE: how snappy/hard the blinder attack lands

export var cp1H = 0.0,  cp1S = 1.0, cp1V = 1.0; // Pulse core (red)
export var cp2H = 0.33, cp2S = 1.0, cp2V = 1.0; // Pulse accent (green, wide sep)
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderDirection(v) {
  var d = (v * 2.0) - 1.0;
  if (d >= 0.0 && d < 0.06) d = 0.06; else if (d < 0.0 && d > -0.06) d = -0.06;
  direction = d;
}
// Audio sliders remap the incoming signal (0..1) into a SANE range with a
// silence floor up to a bright peak. kick params use pow2 for a snappy beat.
export function sliderLevel(v) { level = 0.30 + v * 0.70; }       // micLow  0.30..1.00 (PRIMARY)
export function sliderKick(v) { kick = v * v; }                   // micKick 0..1 pow2 (headline beat)
export function sliderRadius(v) { radius = v; }                   // micFlux 0..1 ripple spread
export function sliderDetail(v) { detail = 0.20 + v * 0.80; }     // micHigh 0.20..1.00 crispness
export function sliderDormantGlow(v) { minBright = v * 0.3; }
export function sliderBlinder(v) { blinder = v; }
export function sliderWhiteLevel(v) { whiteLevel = 0.30 + v * 0.70; } // micLow  0.30..1.00 white keep
export function sliderWhiteKick(v) { whiteKick = v * v; }             // micKick 0..1 pow2 white pop
export function sliderBlinderBite(v) { blinderBite = v; }

// ── Tunables ──────────────────────────────────────────────────────────────────
var BEAT_RATE = 0.85;   // beats(cycles)/sec at localSpeed = 1 (~51 bpm base)
var PHASE_WRAP = 10000.0;

// ── Persistent phases (delta-accumulated; §6/§7) ──────────────────────────────
var beat = 0.0;         // beat cycle phase, accumulates (not wrapped to 1 — see render)
var autoDir = 0.0;
var beatCycle = 0.0;    // beat % 1.0, cached for render
var sweepSign = 1.0;    // resolved sweep direction this frame

// ── Palette RGB cache ─────────────────────────────────────────────────────────
var pr1 = 1, pg1 = 0, pb1 = 0;
var pr2 = 0, pg2 = 0, pb2 = 1;
function _hsv2rgb1() {
  var hv = cp1H - floor(cp1H); if (hv < 0) hv += 1;
  var iv = floor(hv * 6) % 6;
  var fv = hv * 6 - floor(hv * 6);
  var pv = cp1V * (1 - cp1S);
  var qv = cp1V * (1 - fv * cp1S);
  var tv = cp1V * (1 - (1 - fv) * cp1S);
  if      (iv == 0) { pr1 = cp1V; pg1 = tv;    pb1 = pv;    }
  else if (iv == 1) { pr1 = qv;    pg1 = cp1V; pb1 = pv;    }
  else if (iv == 2) { pr1 = pv;    pg1 = cp1V; pb1 = tv;    }
  else if (iv == 3) { pr1 = pv;    pg1 = qv;    pb1 = cp1V; }
  else if (iv == 4) { pr1 = tv;    pg1 = pv;    pb1 = cp1V; }
  else             { pr1 = cp1V; pg1 = pv;    pb1 = qv;    }
}
function _hsv2rgb2() {
  var hv = cp2H - floor(cp2H); if (hv < 0) hv += 1;
  var iv = floor(hv * 6) % 6;
  var fv = hv * 6 - floor(hv * 6);
  var pv = cp2V * (1 - cp2S);
  var qv = cp2V * (1 - fv * cp2S);
  var tv = cp2V * (1 - (1 - fv) * cp2S);
  if      (iv == 0) { pr2 = cp2V; pg2 = tv;    pb2 = pv;    }
  else if (iv == 1) { pr2 = qv;    pg2 = cp2V; pb2 = pv;    }
  else if (iv == 2) { pr2 = pv;    pg2 = cp2V; pb2 = tv;    }
  else if (iv == 3) { pr2 = pv;    pg2 = qv;    pb2 = cp2V; }
  else if (iv == 4) { pr2 = tv;    pg2 = pv;    pb2 = cp2V; }
  else             { pr2 = cp2V; pg2 = pv;    pb2 = qv;    }
}

function wrap(p) { if (p >= PHASE_WRAP) return p - PHASE_WRAP; if (p < 0.0) return p + PHASE_WRAP; return p; }

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;
  var localMultiplier = pow(2.0, (localSpeed - 0.5) * 4.0);

  // Autonomous sweep direction: slow incommensurate swell occasionally flips.
  autoDir = wrap(autoDir + dt * localMultiplier * 0.27735);   // 1/√13 turns/sec
  var autoBias = sin(autoDir * 6.2831853 * 0.11);
  var blended = direction * (0.5 + 0.5 * autoBias);
  sweepSign = blended >= 0.0 ? 1.0 : -1.0;
  if (blended < 0.04 && blended > -0.04) sweepSign = (autoBias >= 0.0) ? 1.0 : -1.0;

  // Autonomous beat clock (kick events ALSO punch via the kick slider; this
  // keeps it pulsing with no audio mapped). Beat slightly faster on a build.
  beat = wrap(beat + dt * localMultiplier * BEAT_RATE * (0.85 + radius * 0.4));
  beatCycle = beat - floor(beat);

  _hsv2rgb1();
  _hsv2rgb2();
}

export function render3D(index, x, y, z) {
  var nx = max(0.0, min(1.0, x));
  var ny = max(0.0, min(1.0, y));

  // Ripple: the beat front sweeps across the rig. Spread grows with radius;
  // direction set by the guarded+autonomous sweepSign.
  var spread = (0.1 + radius * 0.5) * sweepSign;
  var localCycle = beatCycle - nx * spread;
  localCycle = localCycle - floor(localCycle);

  // Double pulse (lub-DUB). Crispness rises with detail (audio: micHigh).
  var sharp = 0.06 - detail * 0.03;     // narrower windows = crisper beat
  var lub = 0.0;
  if (localCycle < 0.08) {
    lub = wave(localCycle / 0.08);
  } else if (localCycle > 0.12 && localCycle < 0.12 + (0.06 + sharp)) {
    lub = wave((localCycle - 0.12) / (0.06 + sharp)) * 0.7;
  }

  // The heart pulses two ways and the BRIGHTER wins:
  //  (1) an autonomous lub-DUB on the clock — keeps it beating with NO audio;
  //  (2) an audio-driven pound: the kick slider IS the beat envelope, so on
  //      kick_4floor the rig brightens on every kick -> brightness tracks the
  //      low-band energy (high PRIMARY corr; kick-gated as documented).
  var autoBeat = lub;                         // silence pulse
  var audioBeat = kick * (0.7 + 0.3 * lub);   // audio pound (slightly beat-shaped)
  var beatBri = max(autoBeat * 0.62, audioBeat);

  // PRIMARY brightness budget (audio: micLow -> level): level scales the whole
  // beat so the rig rises/falls WITH the low band. Dormant glow keeps it
  // calm-but-visible in silence.
  var posMod = 1.0 - abs(ny - 0.5) * 0.3;
  var pulse = minBright + beatBri * (0.3 + level * 1.5);
  var v = pulse * posMod;
  v = max(0.0, min(1.6, v));

  // Continuous cp1<->cp2 gradient across the room (nx spans the bars 0..1).
  var tColour = nx;

  var r = (pr1 + (pr2 - pr1) * tColour) * v;
  var g = (pg1 + (pg2 - pg1) * tColour) * v;
  var b = (pb1 + (pb2 - pb1) * tColour) * v;

  // WHITE — controllable via the white_* set, additive over the cp1/cp2 sweep.
  var wAmt = max(0.0, min(1.0, whiteLevel));
  var wKick = max(0.0, min(1.0, whiteKick));
  var bite = max(0.0, min(1.0, blinderBite));

  // Subtle white CORE on the pulse for pars/bars so the beat has a bright center
  // (kept modest so the rig never washes white; gated by the beat + whiteLevel).
  // beatBri already carries the kick envelope; whiteKick adds extra pop on top.
  var white = beatBri * (0.15 + 0.35 * wAmt) * (0.5 + wKick * 0.6) * (0.4 + level * 0.8);

  // VINTAGE-BLINDER headline: the upper Y heads (sectionId==2) PUNCH their W hard
  // on each beat. The BEAT envelope (beatBri, driven by the kick slider) is the
  // bite source; blinder = structural strength; blinderBite = attack snappiness
  // (higher = kick-dominated punch); whiteLevel adds a small always-on warm keep
  // so the heads read warm at rest; whiteKick is an additive extra white pop.
  if (sectionId == 2) {
    var keep = 0.06 * wAmt;                                   // warm white rest-glow
    var soft = beatBri * (1.0 - bite * 0.5);                  // softer swell part
    var punch = beatBri * (0.6 + bite * 0.9) * (1.0 + wKick * 0.8); // snappy bite
    var blind = blinder * (0.4 + 0.8 * wAmt) * (0.4 + level) * (soft * 0.4 + punch);
    white = keep + blind;
    // warm core lift so the heads glow warm, not just blank white
    r = r + beatBri * 0.10 * bite;
    g = g + beatBri * 0.04 * bite;
  }
  white = max(0.0, min(1.0, white));

  rgbwau(min(1.0, r), min(1.0, g), min(1.0, b), white, 0.0, 0.0);
}
