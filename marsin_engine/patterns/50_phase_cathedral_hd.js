/*
  50_phase_cathedral_hd.js — HD, SOUND-REACTIVE PHASE CATHEDRAL.

  An HD reinterpretation of the beloved 02_phase_cathedral. A huge interference
  field is built from FOUR phase-shifted sine PLANES that cross the rig at
  INCOMMENSURATE angles & frequencies (sqrt2, sqrt3, phi and the golden angle).
  Because every plane's spatial frequency and the relative phase rates are
  mutually irrational, the constructive/destructive node lattice NEVER repeats —
  bright "cathedral-window" nodes form where the planes constructively add and
  true-dark "naves" where they cancel.

  HD: the raw interference value is sharpened with pow() so constructive nodes
  become crisp bright cores and cancellation regions go true black (high
  contrast, high definition — the audio signal reads cleanly through the lattice).

  COLOUR (strict cp1<->cp2, RGB-space blend; PATTERNS.md §7): the blend factor IS
  the interference value, so CANCELLATION -> cp1 (cool nave) and CONSTRUCTIVE ->
  cp2 (hot window core). Both palette colours are always present across the rig,
  cp1 in the dim field and cp2 in the bright nodes (hueSpread >= 0.10).

  ── CORE EQUATION ───────────────────────────────────────────────────────────
    plane_k = sin( (a_k·nx + b_k·ny)·F_k·2pi  +  R_k·shift  +  driftPhase )
    field   = (p1 + p2 + p3 + p4) / 4                       // -1..1, raw lattice
    node    = pow(|field|, sharp)                            // HD: crisp cores
    with  F = {SQRT2, SQRT3, PHI, GOLDEN_ANGLE/2pi} (irrational => never repeats)
          R = {1, PHI, SQRT2, SQRT3}                         // incommensurate
          a_k,b_k from the golden-angle fan (incommensurate crossing planes)

  ── AUDIO MAP (modulators-only; codex P0 — NEVER read CPC audio globals) ──────
  AUDIO_MODULATION_V1:
    sliderNodeContrast <- micLow  range 0.30..1.00 curve linear  # PRIMARY brightness — node brightness + contrast track the low band
    sliderPhaseShift   <- micMid  range 0.00..1.00 curve linear  # geometry — slides the four plane phases (lattice slides/breathes)
    sliderKickLock     <- micKick range 0.00..1.00 curve pow2    # beat — jolts the drift phase forward (re-bloom on the kick)
  # sliderSharpBase: static (resting HD node sharpness; not audio-mapped)
  # sliderLocalSpeed: static (base lattice drift rate; not audio-mapped)
  # phaseShift/kickLock are DISTINCT dimensions from brightness (geometry / beat
  # re-bloom), so they reshape the lattice without correlating to overall level.

  Calm, non-black field in silence: at slider rest a slow drift keeps the lattice
  gently breathing with a dim cp1 floor — the rig always reads (mission critical),
  never fully black, and a peak constructive node still burns bright.

  CONTROLS (UI order = declaration order)
    - localSpeed   : base drift rate of the lattice.
    - nodeContrast : node brightness + contrast (PRIMARY audio handle).
    - phaseShift   : slides the four plane phases (lattice position).
    - kickLock     : beat jolt to the drift phase (re-bloom on kick).
    - sharpBase    : resting HD sharpness of the node cores.
    - colorPalette1/2 : strict cp1 (nave / cancellation) <-> cp2 (window / node).
*/

// ── Exported controls (UI order = declaration order) ────────────────────────
export var localSpeed = 0.5;     // base drift rate of the interference lattice
export var nodeContrast = 0.5;   // PRIMARY: node brightness + contrast (micLow) — mid: bright lit lattice in silence
export var phaseShift = 0.0;     // slides the four plane phases (micMid)
export var kickLock = 0.0;       // beat jolt to drift phase (micKick)
export var sharpBase = 0.45;     // resting HD sharpness of node cores

export var cp1H = 0.60, cp1S = 1.0, cp1V = 1.0; // palette 1 — cool nave (cancellation)
export var cp2H = 0.08, cp2S = 1.0, cp2V = 1.0; // palette 2 — hot window (constructive)
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderNodeContrast(v) { nodeContrast = v; }
export function sliderPhaseShift(v) { phaseShift = v; }
export function sliderKickLock(v) { kickLock = v; }
export function sliderSharpBase(v) { sharpBase = v; }

// ── Irrational constants (incommensurate => the lattice never repeats) ───────
var SQRT2 = 1.4142135624;
var SQRT3 = 1.7320508076;
var PHI = 1.6180339887;
var GA = 2.3999632297;     // golden angle in radians (~137.5 deg)

// Per-plane spatial frequencies (cycles across the unit rig) — irrational set.
var F1 = 4.2426406871;     // 3 * SQRT2
var F2 = 5.1961524227;     // 3 * SQRT3
var F3 = 4.8541019662;     // 3 * PHI
var F4 = 3.8197186342;     // GA * 1.5915494309 (GA / 2pi * 10)

// Per-plane phase-shift response rates (incommensurate) for the micMid handle.
var R1 = 1.0;
var R2 = PHI;
var R3 = SQRT2;
var R4 = SQRT3;

// Per-plane crossing directions from the golden-angle fan (cos/sin of k*GA).
// Precomputed so the per-pixel path stays light.
var A1 = 1.0,         B1 = 0.0;          // cos(0),   sin(0)
var A2 = -0.7374,     B2 = 0.6755;       // cos(GA),  sin(GA)
var A3 = 0.0874,      B3 = -0.9962;      // cos(2GA), sin(2GA)
var A4 = 0.6173,      B4 = 0.7868;       // cos(3GA), sin(3GA)

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

// ── Persistent per-frame state ───────────────────────────────────────────────
var driftPhase = 0.0;    // base drift (radians) — keeps the lattice alive
var shiftRad = 0.0;      // micMid phase offset (radians), this frame
var sharpNow = 4.0;      // resolved HD sharpness this frame
var briGain = 0.0;       // resolved node brightness gain this frame
var floorBri = 0.0;      // resting cp1 floor this frame
var lastKick = 0.0;      // edge-detect for the kick jolt
var BEAT_WRAP = 62831.853; // 10000 * 2pi — wrap far out to keep float precision

export function beforeRender(delta) {
  _hsv2rgb1();
  _hsv2rgb2();

  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  // Base drift of the whole lattice (incommensurate rates already in F/R).
  var rate = pow(2.0, (localSpeed - 0.5) * 3.0);
  driftPhase = driftPhase + dt * rate * 0.9;

  // micKick jolt: a rising kick pushes the drift forward => the lattice
  // re-blooms on the beat (phase-lock for kick_4floor).
  if (kickLock > 0.5 && lastKick <= 0.5) {
    driftPhase = driftPhase + 1.7;
  }
  lastKick = kickLock;

  driftPhase = driftPhase % BEAT_WRAP;
  if (driftPhase < 0.0) driftPhase += BEAT_WRAP;

  // micMid slides the plane phases (a DIFFERENT visual dimension from
  // brightness) — the window lattice slides/breathes across the rig.
  shiftRad = phaseShift * 6.2831853;

  // PRIMARY (micLow): lift node brightness AND sharpen contrast. At rest a calm
  // dim floor keeps the rig alive (non-black in silence); the signal pops the
  // constructive nodes up to a bright peak and crisps the cores.
  var nc = clamp01(nodeContrast);
  briGain = 0.40 + nc * 1.25;                 // node brightness gain (peak pop, micLow-coupled)
  sharpNow = (1.0 + sharpBase * 2.5) + nc * 3.0; // HD sharpness: crisper on louder lows
  floorBri = 0.10 + 0.16 * nc;               // cp1 nave field (visible, micLow-coupled)
}

export function render3D(index, x, y, z) {
  // Coordinates arrive normalized 0..1 (nx,ny). Build the four crossing planes.
  var nx = x;
  var ny = y;

  var p1 = sin((A1 * nx + B1 * ny) * F1 * 6.2831853 + R1 * shiftRad + driftPhase);
  var p2 = sin((A2 * nx + B2 * ny) * F2 * 6.2831853 + R2 * shiftRad + driftPhase * 0.6180339887);
  var p3 = sin((A3 * nx + B3 * ny) * F3 * 6.2831853 + R3 * shiftRad + driftPhase * 1.6180339887);
  var p4 = sin((A4 * nx + B4 * ny) * F4 * 6.2831853 + R4 * shiftRad - driftPhase * 1.4142135624);

  var field = (p1 + p2 + p3 + p4) * 0.25;     // -1..1 raw interference lattice

  // HD: sharpen |field| into crisp constructive cores / true-black cancellation.
  var node = pow(abs(field), sharpNow);

  // Brightness: bright cathedral-window cores on a faint cp1 nave floor.
  var bri = floorBri + briGain * node;
  bri = clamp01(bri);

  // Colour blend IS the interference value: cancellation->cp1 (cool nave),
  // constructive->cp2 (hot window). Use sqrt(node) so the partially-constructive
  // mid-field already reads cp2 while deep cancellation stays cp1 — a real
  // population of BOTH palette colours across the rig (hueSpread).
  var tcol = clamp01(pow(node, 0.40));

  var rr = (pr1 + (pr2 - pr1) * tcol) * bri;
  var gg = (pg1 + (pg2 - pg1) * tcol) * bri;
  var bb = (pb1 + (pb2 - pb1) * tcol) * bri;

  rgb(clamp01(rr), clamp01(gg), clamp01(bb));
}
