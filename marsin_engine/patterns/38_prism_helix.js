/*
  38_prism_helix.js — Prism Helix Tunnel (high-def, audio-reactive)

  Amalgamates 04_beat_folded_helix (pseudo-3D atan2/radius helix tunnel),
  09_cyclone (rotating swirl) and 17_rolling_color_dunes (color rolling along
  depth). Multiple crisp, bright helical arms wind around a tunnel axis: per
  pixel we center the world (x,y), take atan2 for the swirl ANGLE and the
  radius for tunnel DEPTH, then fold angle*arms + depth*twist - spin into one
  helix phase. sin() of that phase makes alternating bright arms / dark gaps;
  raising it to a contrast power tightens the arms into bright prisms with
  true-black gaps. The result is a hypnotic, pseudo-3D rotating prism tunnel.

  HIGH-DEF: BASE_FLOOR ~ 0 in the gaps (contrast power crushes them to black),
  tight bright cores. A tiny time-based shimmer floor keeps the rig faintly
  alive when audio is silent (mission-critical visibility) — never fully dark.

  COORDINATE-DRIVEN & PORTABLE: drives purely off centered world (x,y) +
  sectionId for per-group weighting, so it works on test_bench and the real rig.
  test_bench: sId 1=Pars (X), 2=Vintage (Y), 3=Bars (X).

  CONTROLS (UI order = declaration order)
    - localSpeed : tunnel spin / fly-through rate (0 = frozen helix).
    - twist      : helical twist frequency along depth (the "screw" pitch).
    - level      : overall brightness (low band → master level).
    - contrast   : arm sharpen — high = tight bright arms, hard black gaps (kick punch).
    - arms       : number of helical arms around the tunnel.
    - colorPalette1/2 : cp1 cyan -> cp2 hot red, blended along the arm/depth.

  AUDIO (modulators-only — never read CPC audio globals natively):
      MODULATE sliderTwist    (twist)    <- micMid
      MODULATE sliderLevel    (level)    <- micLow
      MODULATE sliderContrast (contrast) <- micKick
*/

// ── Exported controls ────────────────────────────────────────────────────────
export var localSpeed = 0.5;   // tunnel spin / fly-through rate
export var twist = 4.0;        // helical twist frequency along depth
export var level = 1.0;        // overall brightness (low band → master)
export var contrast = 2.5;     // arm sharpen (kick → snap contrast)
export var arms = 3.0;         // number of helical arms

export var cp1H = 0.5, cp1S = 1.0, cp1V = 1.0;  // palette 1 — cyan
export var cp2H = 0.0, cp2S = 1.0, cp2V = 1.0;  // palette 2 — hot red
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderTwist(v) { twist = -8.0 + v * 32.0; }   // mid-band twist
export function sliderLevel(v) { level = 0.25 + v * 0.75; }   // low-band master level (calm floor at 0)
export function sliderContrast(v) { contrast = 0.6 + v * 8.0; } // kick snaps arms tight
export function sliderArms(v) { arms = 1.0 + floor(v * 9.0); }

// ── Tunables ──────────────────────────────────────────────────────────────────
var SPIN_RATE = 0.5;    // tunnel spins per second at localSpeed = 1.0
var FLY_RATE = 0.35;    // depth fly-through turns per second at localSpeed = 1.0
var BASE_FLOOR = 0.18;  // faint time-based glow so it's never fully dark
var CX = 0.45;          // tunnel axis center in world X (test_bench rig span)
var CY = 1.3;           // tunnel axis center in world Y

// ── Palette RGB cache (strict cp1<->cp2 blending; PATTERNS.md §7) ─────────────
var pr1 = 0, pg1 = 1, pb1 = 1;
var pr2 = 1, pg2 = 0, pb2 = 0;
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
var masterTime = 0.0;   // seconds since start
var spinPhase = 0.0;    // tunnel rotation (turns)
var flyPhase = 0.0;     // fly-through along depth (turns)
var shimmer = 0.0;      // base shimmer phase (turns)

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  _hsv2rgb1();
  _hsv2rgb2();

  masterTime = masterTime + dt;
  var localMultiplier = pow(2.0, (localSpeed - 0.5) * 4.0);

  spinPhase = spinPhase + dt * SPIN_RATE * localMultiplier;
  spinPhase = spinPhase - floor(spinPhase);

  flyPhase = flyPhase + dt * FLY_RATE * localMultiplier;
  flyPhase = flyPhase - floor(flyPhase);

  shimmer = shimmer + dt * 0.15;
  shimmer = shimmer - floor(shimmer);
}

export function render3D(index, x, y, z) {
  // Center the world coords on the tunnel axis.
  var dx = x - CX;
  var dy = y - CY;

  // ANGLE (swirl) and DEPTH (radius) → pseudo-3D tunnel.
  var ang = atan2(dy, dx) / PI2;        // 0..1 turn around the axis
  var dist = hypot(dx, dy);
  if (dist < 0.02) dist = 0.02;
  var depth = 1.0 / dist;               // near axis = deep, far = shallow

  // Fold the helix: arms around the angle, twist along depth, spin/fly in time.
  var helixTurns = ang * arms + depth * twist * 0.1 - flyPhase + spinPhase;
  var field = wave(helixTurns);         // 0..1 turn → 0..1 brightness band

  // Sharpen into tight bright arms with true-black gaps (kick → contrast).
  var arm = pow(field, contrast);

  // A soft, un-crushed glow that follows the helix everywhere (so LEVEL — the
  // low band — moves the WHOLE rig's brightness, giving measurable reactivity).
  var glow = field * field;

  // Faint time-based shimmer floor so it's never fully dark when silent.
  var floorShim = BASE_FLOOR * (0.5 + 0.5 * wave(shimmer + depth * 0.05 + ang));

  var bri = arm;
  if (glow > bri) bri = glow;
  if (floorShim > bri) bri = floorShim;

  // Per-section weighting so the whole rig reads sensibly.
  var secW = 1.0;
  if (sectionId == 1) secW = 0.95;        // pars — bold body
  else if (sectionId == 2) secW = 1.0;    // vintage — brightest cores
  else if (sectionId == 3) secW = 0.9;    // bars — fine helix detail

  bri = bri * secW * level;

  // Color blends cp1 -> cp2 along the arm/depth of the helix.
  var tcol = clamp01(wave(depth * 0.12 + helixTurns * 0.2));
  var r = (pr1 + (pr2 - pr1) * tcol) * bri;
  var g = (pg1 + (pg2 - pg1) * tcol) * bri;
  var b = (pb1 + (pb2 - pb1) * tcol) * bri;

  rgb(clamp01(r), clamp01(g), clamp01(b));
}
