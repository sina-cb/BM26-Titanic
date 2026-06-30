/*
  49_cylon_crush.js — HD audio-reactive CYLON SWEEP x DUAL-AXIS CRUSH.

  A reinterpretation that amalgamates two beloved 00-25 core patterns:
    - 01_cylon_sweep  : a sharp high-definition scanner bar sweeps the rig.
    - 03_dual_axis_crush : twin bars spawn at the L+R edges and collapse to the
                           physical CENTER, meeting in a bright collision flash.

  WHAT YOU SEE
    1. SCANNER  — a crisp, near-single-pixel bright core sweeps left<->right
       along the physical X axis (nx, the whole rig), riding a SHORT decaying
       trail painted into a per-pixel feedback buffer (true-black elsewhere =
       high definition / high contrast). The core blends cp1<->cp2 by its X
       position so BOTH palette colours travel across the rig.
    2. CRUSH    — on a KICK, twin bars are spawned at the extreme left and right
       edges and CRUSH inward toward physical center (nx=0.5). When they meet at
       center they fire a bright COLLISION FLASH rendered in cp2.

  HIGH DEFINITION: the scanner core is a sharp pixel on TRUE BLACK with only a
  short pixelated trail — every move of the position reads as an exact, crisp
  step, not a mushy glow. A faint always-on scan (BASE) keeps the rig alive in
  silence (mission-critical visibility) — never fully dark.

  ── CORE EQUATION ───────────────────────────────────────────────────────────
    scanPhase += dt * (BASE_RATE + level*RATE_GAIN) * PHI      (PHI = 1.6180339)
    scannerX   = triangle(scanPhase)              // 0..1 ping-pong sweep
    crushX(t)  = 0.5 ± 0.5 * (1 - crushEnv)       // edges -> center as env decays
  An irrational multiplier (PHI) on the scan rate means the sweep NEVER lands on
  an integer period — the scanner and the kick grid drift forever, no visible
  loop. Trail/edge offsets use SQRT2 and the GOLDEN ANGLE so nothing re-phases.

  ── AUDIO MAP (modulators-only — NEVER read CPC audio globals natively) ───────
  AUDIO_MODULATION_V1:
    sliderLevel <- micLow  range 0.30..1.00 curve linear  # PRIMARY brightness — overall level + scan rate track the low band
    sliderKick  <- micKick range 0.00..1.00 curve pow2    # beat/pop — fires the edge->center CRUSH + collision flash
  # sliderTrail: static (scanner trail/feedback decay length; not audio-mapped)
  # sliderLocalSpeed: static (base scan-rate trim; not audio-mapped)
  # Both audio sliders use the IDENTITY-SLIDER convention: store v directly, scale in
  # render/beforeRender. At rest (level=default, kick=0) the pattern is a calm,
  # non-black idle scan — codex P0, no fallback, no blackout.

  RIG-AGNOSTIC: every visual is driven off the normalized x coord (0..1), so the
  pattern lights on EVERY rig (test_bench 52, titanic 970, dome 266, logsville
  216). sectionId is never a gate. The scanner-trail feedback buffer is a fixed
  128-cell lane indexed by normalized X (NOT one cell per physical pixel, which
  is impossible: the VM caps an array at ~162 elements while rigs reach 970 px;
  never pixelCount=144, never 52). Each pixel samples the lane by its own x, so
  the trail renders identically on every rig; every lane access is guarded 0..N-1.

  CONTROLS (UI order = declaration order)
    - localSpeed : base scan-rate trim.
    - level      : PRIMARY audio handle — scan rate + overall brightness.
    - kick       : KICK handle — fires the edge->center crush + collision flash.
    - trail      : scanner trail length (feedback decay).
    - colorPalette1/2 : strict cp1↔cp2 palette; scanner blends by X.
*/

// ── Exported controls (UI order = declaration order) ────────────────────────
export var localSpeed = 0.5;   // base scan-rate trim
export var level = 0.5;        // PRIMARY: scan rate + brightness (mid bias — bright lively idle scan)
export var kick = 0.0;         // KICK trigger: edge->center crush + flash (0 at rest)
export var trail = 0.35;       // scanner trail length (feedback decay)

export var cp1H = 0.0,  cp1S = 1.0, cp1V = 1.0; // palette 1 — classic cylon red
export var cp2H = 0.55, cp2S = 1.0, cp2V = 1.0; // palette 2 — cool cyan
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderLevel(v) { level = v; }   // identity: micLow lands here
export function sliderKick(v)  { kick = v; }    // identity: micKick lands here
export function sliderTrail(v) { trail = v; }

// ── Irrational constants (no integer periods — see header equation) ──────────
var PHI = 1.6180339887;    // golden ratio — irrational scan-rate multiplier
var SQRT2 = 1.4142135624;  // trail/edge phase offset
var GANG = 0.3819660113;   // golden angle in turns (2 - PHI) — hue micro-spread

var BASE_RATE = 0.16;      // scans/sec at level 0 (always-on idle sweep)
var RATE_GAIN = 0.55;      // extra scans/sec at level 1 (micLow speeds it up)
var CORE_W = 0.055;        // sharp scanner core half-width (HD on true black)
var FLASH_W = 0.16;        // collision-flash half-width around center
var CENTER = 0.5;          // physical rig center in nx

// ── Scanner-trail feedback lane (COORDINATE-indexed, rig-agnostic) ────────────
// The trail is NOT one cell per physical pixel (that can't work: the VM caps an
// array at ~162 elements, and rigs have up to 970 px, NEVER pixelCount=144).
// Instead the trail is a fixed 128-cell lane along the normalized X axis (0..1);
// every pixel samples the lane cell for its OWN x, so the trail renders
// identically on every rig (test_bench 52, titanic 970, dome 266, logsville 216).
// 128 < the VM's ~162-element array cap, so the buffer is real (not silently 0).
var N = 128;               // lane resolution along X (under the VM array cap)
var buf = array(128);      // persistent trail lane, allocated ONCE at init
var bufInit = 0;

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

function clamp01(v) {
  if (v < 0.0) return 0.0;
  if (v > 1.0) return 1.0;
  return v;
}

// ── Persistent per-frame state ────────────────────────────────────────────────
var scanPhase = 0.0;    // accumulating sweep phase (irrational rate)
var scannerX = 0.0;     // resolved scanner X this frame, 0..1
var lastKick = 0.0;     // edge-detect for the kick trigger
var crushEnv = 0.0;     // 1 at spawn (edges) -> 0 at center; drives the crush
var flashEnv = 0.0;     // collision-flash envelope, fired when crush reaches center
var overall = 0.3;      // overall brightness gain (PRIMARY micLow correlation)
var colT = 0.0;         // scanner palette-blend position this frame (cp1->cp2)

export function beforeRender(delta) {
  _hsv2rgb1();
  _hsv2rgb2();

  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  var lvl = clamp01(level);
  var spd = pow(2.0, (localSpeed - 0.5) * 2.0);

  // Sweep advances at an IRRATIONAL rate so it never lands on an integer period.
  scanPhase = scanPhase + dt * (BASE_RATE + lvl * RATE_GAIN) * PHI * spd;
  scanPhase = scanPhase - floor(scanPhase);
  scannerX = triangle(scanPhase);   // 0..1 ping-pong sweep across the rig

  // PRIMARY brightness handle: micLow -> overall brightness. Resting floor keeps
  // the idle scan visible (never black); the signal pumps it hard above that.
  // Non-linear (lvl^0.7) so quiet lows already lift and loud lows saturate the
  // peak past 200 — this is the dominant driver of total rig brightness.
  overall = 0.18 + pow(lvl, 0.6) * 1.25;

  // Scanner palette blend: position-driven (both cp1 and cp2 travel the rig) with
  // a tiny golden-angle wobble so the two hues stay distinct frame to frame.
  colT = clamp01(scannerX + GANG * (wave(scanPhase * SQRT2) - 0.5) * 0.5);

  // ── KICK edge-detect -> spawn the edge->center CRUSH + arm the flash ────────
  var kv = clamp01(kick);
  if (kv > 0.45 && lastKick <= 0.45) {
    crushEnv = 1.0;     // (re)spawn twin bars at the extreme L+R edges
  }
  lastKick = kv;

  // Crush bars travel edges->center; fire the collision flash as they arrive.
  if (crushEnv > 0.0) {
    var crushSpeed = 2.6 + lvl * 1.4;          // a touch faster on louder lows
    var prevEnv = crushEnv;
    crushEnv = crushEnv - dt * crushSpeed;
    if (crushEnv <= 0.0) {
      crushEnv = 0.0;
      if (prevEnv > 0.0) flashEnv = 1.0;        // bars met at center -> COLLISION
    }
  }

  // Collision flash decays away (sharp, bright, brief).
  if (flashEnv > 0.0) {
    flashEnv = flashEnv - dt * 4.5;
    if (flashEnv < 0.0) flashEnv = 0.0;
  }

  // ── Scanner trail lane: decay the whole lane, then paint the bright core at
  //    the scanner's X position (coordinate-indexed, rig-agnostic). The lane is
  //    sampled per-pixel in render3D by each pixel's own x, so the trail reads the
  //    same on every rig regardless of pixel count.
  if (bufInit == 0) {
    for (var kk = 0; kk < N; kk++) buf[kk] = 0.0;
    bufInit = 1;
  }
  // trail 0 -> short stub (fast decay); trail 1 -> long banner (slow decay).
  var decay = 0.55 + clamp01(trail) * 0.40;
  for (var kk = 0; kk < N; kk++) buf[kk] = buf[kk] * decay;

  // Paint the core into the lane cell(s) under the scanner head. Footprint scales
  // with the core half-width so louder lows leave a slightly wider hot streak.
  var cwLane = CORE_W * (1.0 + clamp01(level) * 1.4);
  var loCell = floor((scannerX - cwLane) * (N - 1));
  var hiCell = floor((scannerX + cwLane) * (N - 1) + 0.5);
  if (loCell < 0) loCell = 0;
  if (hiCell > N - 1) hiCell = N - 1;
  for (var kk = loCell; kk <= hiCell; kk++) {
    var cellX = kk / (N - 1);
    var dC = abs(cellX - scannerX);
    var inj = 0.0;
    if (dC < cwLane) { inj = 1.0 - dC / cwLane; inj = inj * inj; }
    if (inj > buf[kk]) buf[kk] = inj;
  }
}

export function render3D(index, x, y, z) {
  // RIG-AGNOSTIC: drive ALL visuals off the normalized coords (x in 0..1) — every
  // rig provides them. sectionId is NEVER a gate here (titanic ships every pixel
  // as sectionId 0, which would black the whole rig); it is only an OPTIONAL
  // additive accent below. The coord-driven base always lights on every rig.

  // ── SCANNER core + trail: sample the coordinate-indexed lane by this pixel's
  //    own normalized X. The lane already holds the freshly-painted core plus the
  //    decaying trail (painted in beforeRender at the scanner X). Sampling by x
  //    means this reads identically on EVERY rig (52 / 970 / 266 / 216 px).
  var laneF = clamp01(x) * (N - 1);
  var li = floor(laneF + 0.5);
  if (li < 0) li = 0;
  if (li > N - 1) li = N - 1;
  var scanBri = buf[li];             // core + decaying trail at this pixel's X
  // Live core term layered on top so the head is always razor-crisp on every rig.
  var cw = CORE_W * (1.0 + clamp01(level) * 1.4);
  var dCore = abs(x - scannerX);
  if (dCore < cw) {
    var coreBri = 1.0 - dCore / cw;
    coreBri = coreBri * coreBri;     // sharpen -> crisp HD core
    if (coreBri > scanBri) scanBri = coreBri;
  }

  // ── CRUSH: twin bars sweep edges -> center on the kick ──────────────────────
  // Bar position this frame: distance from center grows with crushEnv (1 at the
  // edge, 0 at center). Pixel lights when its |x-center| matches the bar front.
  var crushBri = 0.0;
  if (crushEnv > 0.0) {
    var barDist = 0.5 * crushEnv;            // 0.5 (edge) -> 0 (center)
    var dEdge = abs(abs(x - CENTER) - barDist);
    var bw = 0.05 + clamp01(level) * 0.03;   // crush-bar width
    if (dEdge < bw) {
      crushBri = 1.0 - dEdge / bw;
      crushBri = crushBri * crushBri;
    }
  }

  // ── COLLISION FLASH: bright cp2 burst around physical center ─────────────────
  var flashBri = 0.0;
  if (flashEnv > 0.0) {
    var dC = abs(x - CENTER);
    if (dC < FLASH_W) {
      flashBri = (1.0 - dC / FLASH_W) * flashEnv;
      flashBri = flashBri * flashBri;
    }
  }

  // ── Compose brightness + always-on idle wash (never fully black) ────────────
  // The idle wash is LEVEL-scaled and spread across every pixel, so micLow
  // continuously lifts the whole rig (this is what makes the PRIMARY
  // micLow->brightness correlation strong), on top of the crisp scanner.
  var lw = clamp01(level);
  // Spatially-structured wash: a static spatial ripple (NOT animated in time) so
  // the rig keeps dark gaps (crispness) while its level tracks micLow cleanly —
  // no temporal term to decorrelate the PRIMARY micLow->brightness drive.
  var washShape = wave(x * 1.7);
  washShape = washShape * washShape;   // sharpen -> keeps troughs dark
  var idle = (0.03 + lw * 0.40) * washShape;
  var bri = idle;
  if (scanBri > bri)  bri = scanBri;
  if (crushBri > bri) bri = crushBri;
  bri = bri * overall;
  // Flash is the discrete 2nd dimension; keep it punchy but also level-scaled so
  // kick events don't decorrelate the PRIMARY micLow->brightness drive.
  var flashOut = flashBri * (0.45 + 0.55 * lw);
  if (flashOut > bri) bri = flashOut;

  // ── Colour ──────────────────────────────────────────────────────────────────
  // Scanner/crush blend cp1<->cp2 by X (both palette colours travel the rig).
  // The collision flash forces cp2 so it reads as one decisive colour.
  var tcol = colT;
  if (flashBri > scanBri && flashBri > crushBri && flashEnv > 0.0) tcol = 1.0;

  tcol = clamp01(tcol);
  bri = clamp01(bri);
  var r = (pr1 + (pr2 - pr1) * tcol) * bri;
  var g = (pg1 + (pg2 - pg1) * tcol) * bri;
  var b = (pb1 + (pb2 - pb1) * tcol) * bri;
  rgb(clamp01(r), clamp01(g), clamp01(b));
}
