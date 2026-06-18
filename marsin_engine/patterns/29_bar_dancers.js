/*
  29_bar_dancers.js

  TWO COMET DANCERS ON THE BARS — self-filtered to fixtureId 7..8 only.

  SELF-FILTER (P0): render3D returns black immediately for any pixel whose
  fixtureId is < 7 or > 8. Only the two 18-pixel ShehdsBar strips light up;
  the pars (1..4) and vintage (5,6) stay dark under this pattern.

  LONG LANES: each bar is an 18-pixel horizontal lane. From test_bench.js,
  fId7 (Bar LEFT) = index 16..33, fId8 (Bar RIGHT) = index 34..51. We
  reconstruct each pixel's position WITHIN its own bar from `index` (the
  "fixture view"):
      rel = index - fixStart[fId];  localPos = rel / 17   (0 .. 1 along bar)

  COMET / TRAIL: each dancer is a bright HEAD at `ball*_x` (0..1 along the
  lane) with a fading TAIL behind it. The trail DIRECTION follows the dancer's
  spring VELOCITY — a dancer moving right trails to the left and vice-versa —
  so the comet leans into its motion. The head runs through its OWN critically-
  damped dance spring (DANCE_OMEGA = 7). Dancer 1 leans palette 1, dancer 2
  leans palette 2. Both comets render on BOTH bars (the lanes mirror the duet).

  SHARED APPROACH PULSE: when the two dancers near each other, a shared phase
  brightens the whole rig — a "they're about to meet" flare. `approach` =
  closeness of the two heads; it pulses (a slow shared sine) and lifts every
  pixel's level, peaking when the dancers are closest. `baseGlow` keeps a
  palette wash so the bars are never dark (P0).

  AUDIO (modulators-only — never read CPC audio globals natively):
      MODULATE sliderBall1X      (ball1_x)      <- micDomEnergy1
      MODULATE sliderBall2X      (ball2_x)      <- micDomEnergy2
      MODULATE sliderBall1Energy (ball1_energy) <- micDomEnergy1
      MODULATE sliderBall2Energy (ball2_energy) <- micDomEnergy2
      MODULATE sliderChevronSpeedup (chevronSpeedup) <- micLow
*/

// ── Per-fixture layout (only the bars matter here) ───────────────────────────
var fixStart = array(9);
var fixLen   = array(9);
fixStart[7] = 16; fixLen[7] = 18;  // Bar LEFT  (index 16..33)
fixStart[8] = 34; fixLen[8] = 18;  // Bar RIGHT (index 34..51)

// ── Exported controls (consistent across 27/28/29) ──────────────────────────
export var localSpeed = 0.5;
export var baseGlow = 0.12;
export var dancerSize = 0.30;          // comet half-length scale
export var dancerGlow = 1.0;
export var chevronSpeedup = 0.0;       // global motion / pulse drive (MODULATE <- micLow)
export var ball1_x = 0.30;
export var ball1_energy = 0.6;
export var ball2_x = 0.70;
export var ball2_energy = 0.6;

export var cp1H = 0.55, cp1S = 1.0, cp1V = 1.0; // dancer 1 (cyan)
export var cp2H = 0.92, cp2S = 1.0, cp2V = 1.0; // dancer 2 (magenta)
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderBaseGlow(v) { baseGlow = v * 0.30; }
export function sliderDancerSize(v) { dancerSize = 0.14 + v * 0.45; }
export function sliderDancerGlow(v) { dancerGlow = v; }
export function sliderChevronSpeedup(v) { chevronSpeedup = v; }
export function sliderBall1X(v) { ball1_x = v; }
export function sliderBall1Energy(v) { ball1_energy = v; }
export function sliderBall2X(v) { ball2_x = v; }
export function sliderBall2Energy(v) { ball2_energy = v; }

var DANCE_OMEGA = 7.0;
var PULSE_HZ = 0.8;     // shared approach-pulse base frequency

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
function screen1(a, b) {
  return 1.0 - (1.0 - a) * (1.0 - b);
}

// Comet profile: bright head, exponentially fading tail behind the head.
// `s` = signed distance ALONG the lane from the head, with tail behind = the
// side OPPOSITE the travel direction `dir` (dir = +1 moving right, -1 left).
function cometProfile(localPos, head, dir, halfLen) {
  var off = localPos - head;        // >0 = pixel is to the right of the head
  // Tail lives behind the head: behind = -dir side. Project onto -dir.
  var behind = -off * dir;          // >0 when pixel is on the trailing side
  var bright = 0.0;
  // Sharp head: tight raised-cosine right at the head.
  var dHead = abs(off);
  if (dHead < halfLen * 0.35) {
    bright = 0.6 + 0.4 * cos(dHead / (halfLen * 0.35) * PI);
  }
  // Trailing tail: exponential falloff for pixels behind the head.
  if (behind > 0.0 && behind < halfLen) {
    var tail = (1.0 - behind / halfLen);
    tail = tail * tail;             // quadratic fade for a cometlike streak
    if (tail > bright) bright = tail;
  }
  return bright;
}

// ── Persistent state ─────────────────────────────────────────────────────────
var d1x = 0.30, d1v = 0.0;
var d2x = 0.70, d2v = 0.0;
var dir1 = 1.0, dir2 = -1.0;  // smoothed travel directions (+1 right / -1 left)
var pulsePhase = 0.0;         // shared approach-pulse phase (turns)
var approach = 0.0;           // 0..1 closeness of the two dancers (this frame)

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;
  var localMult = pow(2.0, (localSpeed - 0.5) * 4.0);

  _hsv2rgb1();
  _hsv2rgb2();

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

  // Smooth the travel direction from velocity (keeps the tail stable at rest).
  if (d1v > 0.02) dir1 = dir1 + (1.0 - dir1) * 0.25;
  else if (d1v < -0.02) dir1 = dir1 + (-1.0 - dir1) * 0.25;
  if (d2v > 0.02) dir2 = dir2 + (1.0 - dir2) * 0.25;
  else if (d2v < -0.02) dir2 = dir2 + (-1.0 - dir2) * 0.25;

  // Shared approach: closer dancers -> stronger pulse.
  var gap = abs(d1x - d2x);
  approach = clamp01(1.0 - gap * 1.4);
  var pulseHz = PULSE_HZ * (0.5 + clamp01(chevronSpeedup)) * localMult;
  pulsePhase = (pulsePhase + dt * pulseHz) % 1.0;
  if (pulsePhase < 0.0) pulsePhase += 1.0;
}

export function render3D(index, x, y, z) {
  // ── SELF-FILTER: only the two bars (fId 7..8) ───────────────────────────
  if (fixtureId < 7 || fixtureId > 8) { rgb(0, 0, 0); return; }

  var lenF = fixLen[fixtureId];
  var rel = index - fixStart[fixtureId];
  if (rel < 0) rel = 0;
  if (rel > (lenF - 1)) rel = lenF - 1;
  var localPos = rel / (lenF - 1); // 0 .. 1 along the 18-pixel bar

  var e1 = clamp01(ball1_energy);
  var e2 = clamp01(ball2_energy);
  var halfLen1 = dancerSize * (0.7 + 0.6 * e1);
  var halfLen2 = dancerSize * (0.7 + 0.6 * e2);
  if (halfLen1 < 0.12) halfLen1 = 0.12;
  if (halfLen2 < 0.12) halfLen2 = 0.12;

  var c1 = cometProfile(localPos, d1x, dir1, halfLen1) * (0.35 + 0.65 * e1) * dancerGlow;
  var c2 = cometProfile(localPos, d2x, dir2, halfLen2) * (0.35 + 0.65 * e2) * dancerGlow;

  // Shared approach pulse: brightens everything when the dancers are close.
  var pulse = approach * (0.5 + 0.5 * cos(pulsePhase * PI2));

  var midR = (pr1 + pr2) * 0.5;
  var midG = (pg1 + pg2) * 0.5;
  var midB = (pb1 + pb2) * 0.5;

  var r = baseGlow * midR;
  var g = baseGlow * midG;
  var b = baseGlow * midB;

  // Comets in their palettes.
  r = screen1(r, c1 * pr1); r = screen1(r, c2 * pr2);
  g = screen1(g, c1 * pg1); g = screen1(g, c2 * pg2);
  b = screen1(b, c1 * pb1); b = screen1(b, c2 * pb2);

  // Approach pulse adds a palette-midpoint flare across the whole bar.
  var pl = pulse * 0.5;
  r = screen1(r, pl * midR);
  g = screen1(g, pl * midG);
  b = screen1(b, pl * midB);

  rgb(clamp01(r), clamp01(g), clamp01(b));
}
