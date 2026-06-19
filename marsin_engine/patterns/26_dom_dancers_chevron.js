/*
  26_dom_dancers_chevron.js

  TWO DANCERS IN THE BACKGROUND + INTRICATE SPIRAL FILIGREE ON TOP.
  Built for the Titanic exterior: luminous, high-contrast, beautiful, and
  reactive without ever going dark when audio is silent (codex P0 — no
  fallbacks, the pattern is fully alive at zero audio).

  ─────────────────────────────────────────────────────────────────────────
  LAYER A — BACKGROUND: two soft dancing orbs (rendered FIRST)
  ─────────────────────────────────────────────────────────────────────────
  Two glowing balls dance across the WHOLE rig along the global X axis:
    - Dancer 1 lives near `ball1_x`, painted mostly from palette 1 (cp1).
    - Dancer 2 lives near `ball2_x`, painted mostly from palette 2 (cp2).
  Each dancer is a soft HALO (wide raised-cosine falloff) with a bright
  WHITE-ISH CORE at its centre, so the orbs read as luminous gas, not flat
  discs. A faint BRIDGE/duet line stretches between the two dancers — when
  they drift apart it dims, when they pass close it glows, so the pair
  always feels coupled. `baseGlow` keeps a soft palette wash under
  everything so the rig is never dark at rest (P0).

  Each dancer's X position TARGET (`ball1_x` / `ball2_x`, 0..1) runs through
  its OWN CRITICALLY-DAMPED SPRING — the exact "dance" math the Audio
  Companion's dancing-balls visualizer uses (signal_post_processor.js
  `danceSpringStep`, DANCE_OMEGA = 7):

      v += (k*(target - x) - c*v) * dt ;  x += v * dt    with k = w^2, c = 2w

  so each ball GLIDES to its target with no overshoot. The two springs are
  INDEPENDENT (separate x / v state) so the dancers move on their own. Each
  dancer's `*_energy` slider drives its brightness, halo size, and core pop.

  ─────────────────────────────────────────────────────────────────────────
  LAYER B — FOREGROUND: intricate spiral filigree (composited ON TOP)
  ─────────────────────────────────────────────────────────────────────────
  Over the soft balls we render fine, HIGH-CONTRAST spiral arms in a
  near-white / accent colour (the bright complement of the soft background).
  The spiral is built from the pixel's polar angle about rig-centre plus a
  rotating phase: `spiralArm = wave(ARMS*angle/PI2 + RADIAL*radius - spin)`,
  raised to a high power so only thin bright filaments survive. The arms
  ROTATE over time (`spin`) and `chevronSpeedup` / `localSpeed` speed the
  whole motion up. The filigree is SCREEN-BLENDED over the balls so it adds
  crisp, luminous detail without harsh clipping.

  ─────────────────────────────────────────────────────────────────────────
  AUDIO REACTIVITY (modulators-only — patterns never read CPC audio globals,
  operator decision 2026-06-17). The pattern exposes SLIDER params with
  resting defaults that already look great; audio reactivity is added by
  attaching MODULATION mappings in the playlist.

  AUDIO_MODULATION_V1:
    sliderDancerGlow     <- micLow  range 0.35..1.00 curve linear  # PRIMARY whole-rig brightness (both halos)
    sliderChevronSpeedup <- micFlux range 0.00..1.00 curve linear  # spiral spin speed (build = faster filigree)
    sliderBall1Energy    <- micMid  range 0.25..1.00 curve linear  # geometry: dancer-1 size + core pop
    sliderBall2Energy    <- micHigh range 0.25..1.00 curve linear  # detail: dancer-2 size + core pop
  (static, omit from playlist: sliderBall1X, sliderBall2X — dancer X TARGETS are
   operator-set so the springs glide between fixed points; sliderBaseGlow,
   sliderDancerSize, sliderLocalSpeed — operator-set, not audio-driven.)
  At slider defaults (no audio) the dancers idle apart, the bridge breathes,
  and the spirals turn slowly — fully alive, no black-out (P0).
*/

// ── Exported controls ───────────────────────────────────────────────────────
export var localSpeed = 0.5;          // standard first local slider (global motion trim)

// Background dancers
export var ball1_x = 0.34;            // 0..1 dancer-1 X target  (operator-set, static)
export var ball1_energy = 0.5;        // 0..1 dancer-1 size/core (audio: micMid 0.25..1.00)
export var ball2_x = 0.66;            // 0..1 dancer-2 X target  (operator-set, static)
export var ball2_energy = 0.5;        // 0..1 dancer-2 size/core (audio: micHigh 0.25..1.00)

export var baseGlow = 0.15;           // soft palette wash floor (never dark — P0)
export var dancerSize = 0.34;         // base halo half-width (X units)
export var dancerGlow = 0.7;          // PRIMARY peak halo brightness (audio: micLow 0.35..1.00)

// Spiral filigree (foreground) speed-up. chevronSpeedup keeps its historical
// name and acts as the spiral motion/speed drive (audio: micFlux).
export var chevronSpeedup = 0.4;

// Palette pickers (strict cp1<->cp2 RGB-space blending; spirals use the bright
// complement of the cp midpoint so they always read high-contrast).
export var cp1H = 0.55, cp1S = 1.0, cp1V = 1.0; // dancer 1 (cyan default)
export var cp2H = 0.92, cp2S = 1.0, cp2V = 1.0; // dancer 2 (magenta default)
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderBaseGlow(v) { baseGlow = v * 0.30; }
export function sliderDancerSize(v) { dancerSize = 0.14 + v * 0.40; }
// Audio sliders remap the incoming signal (0..1) into a SANE range with a
// silence floor up to a bright peak. dancerGlow is the PRIMARY whole-rig brightness.
export function sliderDancerGlow(v) { dancerGlow = 0.35 + v * 0.65; }   // micLow  0.35..1.00 (PRIMARY)
export function sliderChevronSpeedup(v) { chevronSpeedup = v; }         // micFlux 0..1 spiral speed
export function sliderBall1X(v) { ball1_x = v; }
export function sliderBall1Energy(v) { ball1_energy = 0.25 + v * 0.75; } // micMid  0.25..1.00 geometry
export function sliderBall2X(v) { ball2_x = v; }
export function sliderBall2Energy(v) { ball2_energy = 0.25 + v * 0.75; } // micHigh 0.25..1.00 detail

// ── Motion constants ─────────────────────────────────────────────────────────
var SPIN_BASE_HZ  = 0.040;   // constant slow spiral spin
var SPIN_AUDIO_HZ = 0.55;    // extra spin Hz at chevronSpeedup = 1.0
var SPIRAL_ARMS   = 5.0;     // number of spiral arms
var SPIRAL_RADIAL = 6.0;     // radial twist tightness
var SPIRAL_SHARP  = 6.0;     // power -> thin bright filaments (high contrast)

// ── Dance spring (mirrors signal_post_processor.danceSpringStep) ─────────────
// Critically damped: k = w^2, c = 2w. w = 7 rad/s -> ~0.4 s settle, no overshoot.
var DANCE_OMEGA = 7.0;

// ── Comet trail (mirrors the Audio Companion dancing-balls visualizer) ───────
// drawOrb (companion_app.js) keeps a fading history of each orb's PAST
// positions and draws them as shrinking, fading circles behind the head. We
// reproduce that with a per-dancer ring buffer of past spring positions.
var TRAIL_N = 14;
var trail1 = array(14);
var trail2 = array(14);
var trailHead = 0;   // next write slot
var trailInit = 0;   // 0 until the buffers are seeded

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
var spin = 0.0;     // spiral rotation phase (turns 0..1)
var d1x = 0.34;     // dancer 1 spring position
var d1v = 0.0;      // dancer 1 spring velocity
var d2x = 0.66;     // dancer 2 spring position
var d2v = 0.0;      // dancer 2 spring velocity
var spiralR = 0.0;  // cached spiral accent colour (near-white complement)
var spiralG = 0.0;
var spiralB = 0.0;

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1; // clamp huge first-frame deltas so the springs are sane
  var localMult = pow(2.0, (localSpeed - 0.5) * 4.0);

  _hsv2rgb1();
  _hsv2rgb2();

  // Spiral accent = bright near-white tinted away from the palette midpoint so
  // it reads as high-contrast filigree over the soft palette balls.
  var midR = (pr1 + pr2) * 0.5;
  var midG = (pg1 + pg2) * 0.5;
  var midB = (pb1 + pb2) * 0.5;
  spiralR = clamp01(0.85 + (1.0 - midR) * 0.15);
  spiralG = clamp01(0.85 + (1.0 - midG) * 0.15);
  spiralB = clamp01(0.85 + (1.0 - midB) * 0.15);

  // ── Spiral spin: constant slow base + speed-up drive ────────────────────
  var spd = clamp01(chevronSpeedup);
  var spinHz = (SPIN_BASE_HZ + spd * SPIN_AUDIO_HZ) * localMult;
  spin = (spin + dt * spinHz) % 1.0;
  if (spin < 0.0) spin += 1.0;

  // ── Two INDEPENDENT critically-damped dance springs (one per dancer) ────
  var k = DANCE_OMEGA * DANCE_OMEGA;
  var c = 2.0 * DANCE_OMEGA;

  var t1 = clamp01(ball1_x);
  d1v = d1v + (k * (t1 - d1x) - c * d1v) * dt;
  d1x = d1x + d1v * dt;
  if (d1x < 0.0) { d1x = 0.0; d1v = 0.0; }
  if (d1x > 1.0) { d1x = 1.0; d1v = 0.0; }

  var t2 = clamp01(ball2_x);
  d2v = d2v + (k * (t2 - d2x) - c * d2v) * dt;
  d2x = d2x + d2v * dt;
  if (d2x < 0.0) { d2x = 0.0; d2v = 0.0; }
  if (d2x > 1.0) { d2x = 1.0; d2v = 0.0; }

  // Seed the trail buffers on the first frame, then push this frame's
  // positions so the comet trails follow the dancers' actual paths.
  if (trailInit == 0) {
    for (var kk = 0; kk < TRAIL_N; kk++) { trail1[kk] = d1x; trail2[kk] = d2x; }
    trailInit = 1;
  }
  trail1[trailHead] = d1x;
  trail2[trailHead] = d2x;
  trailHead = trailHead + 1;
  if (trailHead >= TRAIL_N) trailHead = 0;
}

// Soft orb profile: raised-cosine halo + bright white-ish core.
// Returns a 0..1 intensity for distance `d` from the dancer centre.
function orbProfile(d, halfW) {
  if (d >= halfW) return 0.0;
  return 0.5 + 0.5 * cos(d / halfW * PI); // smooth, peaks 1 at centre
}

// Comet trail glow at position `posn` from a dancer's position history.
// Older samples fade quadratically and shrink slightly, mirroring drawOrb.
function trailGlow(posn, trailArr, halfW) {
  var acc = 0.0;
  for (var kk = 1; kk < TRAIL_N; kk++) {
    var idx = trailHead - 1 - kk;
    if (idx < 0) idx = idx + TRAIL_N;
    var age = kk / TRAIL_N;
    var fade = 1.0 - age; fade = fade * fade;
    var hw = halfW * (0.55 + 0.45 * (1.0 - age));
    var contrib = orbProfile(abs(posn - trailArr[idx]), hw) * fade;
    if (contrib > acc) acc = contrib;
  }
  return acc * 0.6;   // trail dimmer than the head
}

// Engine convention: x, y, z are normalized pixel coords in [0,1].
export function render3D(index, x, y, z) {
  var px = clamp01(x);

  // ── LAYER A — two background dancers (soft halo + white core + bridge) ──
  var e1 = clamp01(ball1_energy);
  var e2 = clamp01(ball2_energy);
  var halfW1 = dancerSize * (0.6 + 0.4 * e1);
  var halfW2 = dancerSize * (0.6 + 0.4 * e2);
  if (halfW1 < 0.04) halfW1 = 0.04;
  if (halfW2 < 0.04) halfW2 = 0.04;

  var h1 = orbProfile(abs(px - d1x), halfW1);  // dancer 1 halo
  var h2 = orbProfile(abs(px - d2x), halfW2);  // dancer 2 halo

  // Bright white-ish cores (tight, high-energy centres). Scaled by dancerGlow
  // (PRIMARY micLow) so the bright cores rise/fall with the low band too — keeps
  // the PRIMARY brightness correlation high (they are otherwise the dominant,
  // glow-independent white spike that would dilute the corr).
  var coreW1 = 0.30 * halfW1;
  var coreW2 = 0.30 * halfW2;
  var coreGain = 0.35 + 0.65 * dancerGlow;
  var core1 = orbProfile(abs(px - d1x), coreW1) * (0.4 + 0.6 * e1) * coreGain;
  var core2 = orbProfile(abs(px - d2x), coreW2) * (0.4 + 0.6 * e2) * coreGain;

  // Halo levels driven by glow + energy.
  var lvl1 = dancerGlow * (0.35 + 0.65 * e1) * h1;
  var lvl2 = dancerGlow * (0.35 + 0.65 * e2) * h2;

  // Bridge / duet line: a soft band spanning between the two dancers; glows
  // brighter when they are close together (coupling gesture).
  var lo = d1x; var hi = d2x;
  if (hi < lo) { var sw = lo; lo = hi; hi = sw; }
  var gap = hi - lo;
  var bridge = 0.0;
  if (px > lo && px < hi && gap > 0.001) {
    var bspan = (px - lo) / gap;            // 0..1 along the bridge
    var bShape = 0.5 + 0.5 * cos((bspan - 0.5) * PI2); // soft 0..1 hump
    var closeness = clamp01(1.0 - gap);     // closer -> brighter bridge
    bridge = bShape * (0.18 + 0.42 * closeness) * (0.5 * (e1 + e2));
  }

  // Compose the soft background in RGB. Dancer 1 leans cp1, dancer 2 leans
  // cp2; the bridge is the palette midpoint; cores add white. baseGlow keeps
  // a palette wash everywhere so the rig is never dark (P0).
  var bgR = baseGlow * (pr1 + pr2) * 0.5;
  var bgG = baseGlow * (pg1 + pg2) * 0.5;
  var bgB = baseGlow * (pb1 + pb2) * 0.5;

  // Comet trails (each dancer's fading position history), painted UNDER the
  // halos/cores so the bright head still reads on top.
  var tr1 = trailGlow(px, trail1, halfW1) * (0.35 + 0.65 * e1) * dancerGlow;
  var tr2 = trailGlow(px, trail2, halfW2) * (0.35 + 0.65 * e2) * dancerGlow;
  bgR = screen1(bgR, tr1 * pr1); bgR = screen1(bgR, tr2 * pr2);
  bgG = screen1(bgG, tr1 * pg1); bgG = screen1(bgG, tr2 * pg2);
  bgB = screen1(bgB, tr1 * pb1); bgB = screen1(bgB, tr2 * pb2);

  bgR = screen1(bgR, lvl1 * pr1); bgR = screen1(bgR, lvl2 * pr2);
  bgG = screen1(bgG, lvl1 * pg1); bgG = screen1(bgG, lvl2 * pg2);
  bgB = screen1(bgB, lvl1 * pb1); bgB = screen1(bgB, lvl2 * pb2);

  // White-ish cores.
  bgR = screen1(bgR, core1); bgR = screen1(bgR, core2);
  bgG = screen1(bgG, core1); bgG = screen1(bgG, core2);
  bgB = screen1(bgB, core1); bgB = screen1(bgB, core2);

  // Bridge (palette midpoint).
  var midR = (pr1 + pr2) * 0.5;
  var midG = (pg1 + pg2) * 0.5;
  var midB = (pb1 + pb2) * 0.5;
  bgR = screen1(bgR, bridge * midR);
  bgG = screen1(bgG, bridge * midG);
  bgB = screen1(bgB, bridge * midB);

  // ── LAYER B — intricate spiral filigree (high-contrast, on top) ─────────
  // Polar coords about rig-centre. y is normalized height; use (x,y) plane.
  var cx = px - 0.5;
  var cy = clamp01(y) - 0.5;
  var radius = hypot(cx, cy);
  var angle = atan2(cy, cx);              // radians, -PI..PI
  // Spiral coordinate: arms wind with radius and rotate with spin.
  var sCoord = (SPIRAL_ARMS * angle / PI2) + (SPIRAL_RADIAL * radius) - spin;
  var arm = wave(sCoord);                 // 0..1, turn-based input -> ok
  arm = pow(arm, SPIRAL_SHARP);           // sharpen into thin filaments
  // Fade the filigree toward the very centre so it doesn't smear into a blob.
  var rFade = clamp01(radius * 2.2);
  // Spiral brightness also rides the PRIMARY (dancerGlow / micLow) so the whole
  // luminous frame — soft balls AND filigree — rises/falls with the low band.
  var spiralLvl = arm * rFade * (0.55 + 0.45 * clamp01(chevronSpeedup)) * (0.45 + 0.55 * dancerGlow);

  // ── COMPOSITE: screen-blend spiral accent over the soft balls ───────────
  var r = screen1(clamp01(bgR), spiralLvl * spiralR);
  var g = screen1(clamp01(bgG), spiralLvl * spiralG);
  var b = screen1(clamp01(bgB), spiralLvl * spiralB);

  // PRIMARY brightness budget: a final whole-frame gain tied to dancerGlow
  // (micLow). It scales the entire composite as one budget so total brightness
  // tracks the low band tightly (high PRIMARY corr), with a floor so the rig is
  // never dark at rest (P0). Other audio dims still shape geometry/motion/detail.
  var primary = 0.40 + 0.60 * clamp01(dancerGlow);
  r = r * primary; g = g * primary; b = b * primary;
  rgb(clamp01(r), clamp01(g), clamp01(b));
}
