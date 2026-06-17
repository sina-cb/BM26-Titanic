/*
  26_dom_dancers_chevron.js

  TWO COMPOSITED LAYERS — a slow cross-fixture chevron background with a
  per-fixture "dancing ball" foreground driven by the dominant-frequency
  audio signal. Built for the Titanic exterior: bright, smooth, beautiful,
  and reactive without ever going dark when audio is silent (codex P0 —
  no fallbacks, the pattern is fully alive at zero audio).

  ─────────────────────────────────────────────────────────────────────────
  LAYER 2 — BACKGROUND: cross-fixture chevron (rendered FIRST)
  ─────────────────────────────────────────────────────────────────────────
  A single V / arrow shape spanning ALL fixtures along the global X axis.
  The chevron apex travels left<->right across the whole rig. Its base
  motion is a CONSTANT SLOW drift (CHEVRON_BASE_HZ). On top of that, the
  `chevronSpeedup` control adds extra travel speed:

      chevron_speed_hz = CHEVRON_BASE_HZ + chevronSpeedup * CHEVRON_AUDIO_HZ

  `chevronSpeedup` is an exported slider (default low, 0.0) that an operator
  can leave manual OR drive via a MODULATION mapping in the playlist. The
  intended audio source is the LOW band:

      MODULATE  sliderChevronSpeedup (chevronSpeedup)  <-  micLow

  so the chevron accelerates with the bass/kick of the music. Any [0,1]
  audio signal works as a modulation source (micKick for a punchier feel,
  micFlux for onset drive), but micLow is the documented default. The
  chevron is drawn from the cp1<->cp2 palette so it always honours the
  operator's colour pickers.

  ─────────────────────────────────────────────────────────────────────────
  LAYER 1 — FOREGROUND: per-fixture dom1 dancers (composited ON TOP)
  ─────────────────────────────────────────────────────────────────────────
  FIXTURE VIEWS / per-fixture coordinate space:
  MarsinScript exposes `fixtureId` (and `index`) per pixel. There is no
  separate per-fixture local-coordinate built-in, so — exactly as the
  production tower patterns do (see summer_camp/113_tower_column_breath.js,
  `barT = (index % 18)/17`) — we reconstruct each fixture's OWN 0..1 axis
  from `index` and the test_bench fixture layout (FIX_START / FIX_LEN
  tables below, keyed by fixtureId). `localPos` is the pixel's position
  WITHIN its own fixture, independent of where the fixture sits in the rig.
  That IS the fixture view: the dancer lives in each fixture's local space.

  Inside EACH fixture we render a bright "dancing ball": a soft orb at
  `ballPos` (0..1 in the fixture's local axis). The ball position TARGET is
  the `sliderDomPos` control (0..1, default 0.5 = fixture-centre) and the
  orb's brightness/size is driven by `sliderDomEnergy` (0..1, default 0.6).
  Both are exported SLIDER params — an operator can leave them manual OR, for
  audio reactivity, drive them via MODULATION mappings (modulators-only audio
  policy, operator decision 2026-06-17 — patterns never read CPC audio
  globals natively). The documented audio coupling is:

      MODULATE  sliderDomPos    (domPos)    <-  micDomEnergy1
      MODULATE  sliderDomEnergy (domEnergy) <-  micDomEnergy1

  (use micDomFreq1, normalized, on sliderDomPos if you want pitch to steer
  the ball's HEIGHT rather than energy.) The 0..1 position TARGET is run
  through a CRITICALLY-DAMPED SPRING — the exact "dance" math the Audio
  Companion's dancing-balls visualizer / the `danceMaker` op use
  (signal_post_processor.js: `danceSpringStep`, DANCE_OMEGA = 7):

      v += (k*(target - x) - c*v) * dt ;  x += v * dt    with k = w^2, c = 2w

  This makes the orb GLIDE to its target with no overshoot — the "dancing
  ball" gesture. `domEnergy` drives the orb's brightness and a little of its
  size, so a strong drive makes the dancer pop; a quiet drive makes it small
  and gentle. At rest (sliders at default) the orb idles near fixture-centre
  with a soft glow (no black-out — P0).

  COMPOSITING: background chevron is computed first, then the dancer is
  screen-blended on top (1-(1-bg)(1-fg)) so the orb never harshly clips the
  chevron and there is no popping — luminous, additive-but-bounded.

  ─────────────────────────────────────────────────────────────────────────
  AUDIO REACTIVITY (modulators-only — patterns never read CPC audio globals):
  The pattern exposes SLIDER params; audio reactivity is added by attaching
  a MODULATION mapping (source = any live audio key) to each slider in the
  playlist. At rest the defaults look good (the pattern is complete &
  beautiful without audio):
    domPos        (0..1) dancer position target  default 0.5  (fixture-centre)
    domEnergy     (0..1) dancer brightness/size  default 0.6  (lively at rest)
    chevronSpeedup(0..1) chevron travel speed-up default 0.0
  Default modulation mappings (sim test_bench default playlist):
    sliderDomPos    <- micDomEnergy1
    sliderDomEnergy <- micDomEnergy1
    sliderChevronSpeedup <- micLow
*/

// ── Per-fixture layout (test_bench.js fixtureId -> start index + length) ─────
// fId 1..4 = single-pixel Pars; fId 5,6 = 6-pixel Vintage strips;
// fId 7,8 = 18-pixel Bars. A length of 1 collapses localPos to 0.5 (the
// orb sits centred in a single-pixel fixture). This is the documented
// fixture-view reconstruction — index + known fixture geometry.
var FIX_COUNT = 8;
var fixStart = array(9); // 1-based by fixtureId; slot 0 unused
var fixLen   = array(9);

// ── Exported controls ───────────────────────────────────────────────────────
export var localSpeed = 0.5;          // standard first local slider

// Chevron (background) controls
export var chevronWidth = 0.22;       // half-width of the V arm falloff (X units)
export var chevronGlow = 0.85;        // peak chevron brightness
export var chevronFloor = 0.10;       // background floor so the rig never goes dark
export var chevronSpeedup = 0.0;      // MODULATE <- micLow. base-slow + this*audio

// Dancer (foreground) controls
export var ballSize = 0.30;           // base orb half-width in fixture-local units
export var ballGlow = 1.0;            // peak orb brightness
export var ballFloor = 0.08;          // idle orb glow at low energy

// Dancer drive (modulator-driven sliders — NOT native audio reads). An
// operator can leave these manual OR attach a MODULATION mapping in the
// playlist (e.g. sliderDomPos <- micDomEnergy1). Defaults look good at rest.
export var domPos = 0.5;              // 0..1 dancer position target (centre at rest)
export var domEnergy = 0.6;           // 0..1 dancer brightness/size drive

// Palette pickers (strict cp1<->cp2 RGB-space blending)
export var cp1H = 0.55, cp1S = 1.0, cp1V = 1.0; // chevron / dancer core (cyan)
export var cp2H = 0.92, cp2S = 1.0, cp2V = 1.0; // accent (magenta)
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderChevronWidth(v) { chevronWidth = 0.08 + v * 0.40; }
export function sliderChevronGlow(v) { chevronGlow = v; }
export function sliderChevronFloor(v) { chevronFloor = v * 0.30; }
export function sliderChevronSpeedup(v) { chevronSpeedup = v; }
export function sliderBallSize(v) { ballSize = 0.12 + v * 0.45; }
export function sliderBallGlow(v) { ballGlow = v; }
export function sliderBallFloor(v) { ballFloor = v * 0.25; }
export function sliderDomPos(v) { domPos = v; }      // 0..1 dancer position target
export function sliderDomEnergy(v) { domEnergy = v; } // 0..1 dancer brightness/size

// ── Chevron motion constants ─────────────────────────────────────────────────
var CHEVRON_BASE_HZ = 0.035;  // constant slow drift (full sweep ~28 s)
var CHEVRON_AUDIO_HZ = 0.45;  // extra Hz at chevronSpeedup = 1.0

// ── Dance spring (mirrors signal_post_processor.danceSpringStep) ─────────────
// Critically damped: k = w^2, c = 2w. w = 7 rad/s -> ~0.4 s settle, no
// overshoot. ONE explicit-Euler step per frame. Same math as the Companion
// dancing-balls visualizer / danceMaker op (one behaviour, no fork — P0).
var DANCE_OMEGA = 7.0;

// ── Palette RGB cache (strict cp1<->cp2 blending; see PATTERNS.md §7) ────────
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

// Screen blend: 1 - (1-a)(1-b). Luminous, additive, never clips hard.
function screen1(a, b) {
  return 1.0 - (1.0 - a) * (1.0 - b);
}

// ── Persistent state ─────────────────────────────────────────────────────────
var chevronPhase = 0.0; // 0..1 apex position sweep (triangle of this)
var ballTarget = 0.5;   // dom1 -> 0..1 fixture-local target (shared per frame)
var ballPos = 0.5;      // spring position x (the dancing ball local coord)
var ballVel = 0.0;      // spring velocity v

// ── Top-level init: build the per-fixture layout table ───────────────────────
// test_bench.js: fId1..4 -> single pixels at index 0..3; fId5 -> 4..9;
// fId6 -> 10..15; fId7 -> 16..33; fId8 -> 34..51. Encoded once here so the
// per-pixel path just looks up start/len by fixtureId (the "fixture view").
fixStart[1] = 0;  fixLen[1] = 1;
fixStart[2] = 1;  fixLen[2] = 1;
fixStart[3] = 2;  fixLen[3] = 1;
fixStart[4] = 3;  fixLen[4] = 1;
fixStart[5] = 4;  fixLen[5] = 6;
fixStart[6] = 10; fixLen[6] = 6;
fixStart[7] = 16; fixLen[7] = 18;
fixStart[8] = 34; fixLen[8] = 18;

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1; // clamp huge first-frame deltas so the spring is sane
  var localMult = pow(2.0, (localSpeed - 0.5) * 4.0);

  _hsv2rgb1();
  _hsv2rgb2();

  // ── Chevron travel: constant slow base + audio-driven speed-up ──────────
  // speedup is [0,1] (manual or bound to micLow). Result is an Hz that the
  // localSpeed trim also scales so the operator can globally retime it.
  var spd = clamp01(chevronSpeedup);
  var chevronHz = (CHEVRON_BASE_HZ + spd * CHEVRON_AUDIO_HZ) * localMult;
  chevronPhase = (chevronPhase + dt * chevronHz) % 1.0;
  if (chevronPhase < 0.0) chevronPhase += 1.0;

  // ── Dance target: the domPos slider IS the 0..1 target, then spring ──────
  // Done ONCE per frame in beforeRender (not per pixel): the dancer shares
  // the same local target/position across every fixture, so all fixtures
  // dance in unison while each renders it in ITS OWN local space. domPos is
  // a modulator-driven slider (e.g. micDomEnergy1 via a playlist modulation),
  // already normalized to 0..1 — no native audio read here.
  ballTarget = clamp01(domPos);

  // Critically-damped spring step (danceSpringStep parity).
  var k = DANCE_OMEGA * DANCE_OMEGA;
  var c = 2.0 * DANCE_OMEGA;
  ballVel = ballVel + (k * (ballTarget - ballPos) - c * ballVel) * dt;
  ballPos = ballPos + ballVel * dt;
  if (ballPos < 0.0) { ballPos = 0.0; ballVel = 0.0; }
  if (ballPos > 1.0) { ballPos = 1.0; ballVel = 0.0; }
}

// Engine convention: x, y, z are normalized pixel coords in [0,1].
export function render3D(index, x, y, z) {
  // ── LAYER 2 — BACKGROUND chevron (computed first) ───────────────────────
  // Apex sweeps across X via a triangle wave so it bounces edge-to-edge.
  var apex = triangle(chevronPhase); // 0..1 apex X position
  // Chevron shape: V/arrow. Distance from the apex along X, with a slight
  // upward (y) tilt on the arms so it reads as a chevron, not a vertical bar.
  var armX = abs(x - apex);
  var tilt = (1.0 - clamp01(y)) * 0.10; // arms ride a touch with height
  var d = armX - tilt;
  if (d < 0.0) d = -d;
  var chev = 0.0;
  if (d < chevronWidth) {
    // soft raised-cosine arm so there is no harsh edge / popping
    chev = 0.5 + 0.5 * cos(d / chevronWidth * PI);
    chev = chev * chevronGlow;
  }
  // Background = floor + chevron front. Colour walks cp1->cp2 along X so the
  // sweep paints a moving palette gradient (stays strictly on the picker line).
  var bgLevel = chevronFloor + chev;
  if (bgLevel > 1.0) bgLevel = 1.0;
  var bgMix = clamp01(x);
  var bgR = (pr1 + (pr2 - pr1) * bgMix) * bgLevel;
  var bgG = (pg1 + (pg2 - pg1) * bgMix) * bgLevel;
  var bgB = (pb1 + (pb2 - pb1) * bgMix) * bgLevel;

  // ── LAYER 1 — FOREGROUND per-fixture dom1 dancer (composited on top) ─────
  // Reconstruct THIS pixel's position inside its own fixture (fixture view).
  var localPos = 0.5;
  if (fixtureId >= 1 && fixtureId <= FIX_COUNT) {
    var lenF = fixLen[fixtureId];
    if (lenF > 1) {
      var rel = index - fixStart[fixtureId];
      if (rel < 0) rel = 0;
      if (rel > (lenF - 1)) rel = lenF - 1;
      localPos = rel / (lenF - 1);
    }
    // lenF == 1 -> single-pixel fixture: localPos stays 0.5 (orb centred).
  }
  // If there is no fixture metadata (fixtureId == 0, v1 model) we do NOT
  // silently fake a fixture — the dancer simply renders at fixture-centre
  // using localPos = 0.5, so it still shows but makes no false claim about
  // per-fixture geometry (P0: no fabricated fallback coordinate space).

  // Orb intensity & size grow with the energy drive; idle glow keeps it alive.
  var energy = clamp01(domEnergy);
  var halfW = ballSize * (0.6 + 0.4 * energy);
  if (halfW < 0.02) halfW = 0.02;
  var orbD = abs(localPos - ballPos);
  var orb = 0.0;
  if (orbD < halfW) {
    orb = 0.5 + 0.5 * cos(orbD / halfW * PI); // soft raised-cosine orb
  }
  var orbLevel = (ballFloor + (ballGlow - ballFloor) * energy) * orb;
  if (orbLevel < 0.0) orbLevel = 0.0;
  if (orbLevel > 1.0) orbLevel = 1.0;
  // Dancer colour = cp1 core warmed toward cp2 by energy (a hot dancer
  // leans to the accent picker). Strictly on the cp1<->cp2 line.
  var fgMix = clamp01(energy);
  var fgR = (pr1 + (pr2 - pr1) * fgMix) * orbLevel;
  var fgG = (pg1 + (pg2 - pg1) * fgMix) * orbLevel;
  var fgB = (pb1 + (pb2 - pb1) * fgMix) * orbLevel;

  // ── COMPOSITE: screen-blend dancer over chevron (smooth, no clipping) ───
  var r = screen1(clamp01(bgR), clamp01(fgR));
  var g = screen1(clamp01(bgG), clamp01(fgG));
  var b = screen1(clamp01(bgB), clamp01(fgB));
  rgb(r, g, b);
}
