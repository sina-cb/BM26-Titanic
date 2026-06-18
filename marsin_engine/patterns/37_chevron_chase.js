/*
  37_chevron_chase.js — EDM / structural CHEVRON CHASE.

  Crisp repeating chevron / arrow bands that CHASE along the rig. Each chevron
  is a sharp V (arrow) pointing along the chase direction: bright leading edge,
  true black in the gap behind it = high contrast, high-def. The chevron shape
  comes from offsetting the chase coordinate by the pixel's distance from the
  rig's vertical centre (|y-0.5|), so the band bends into an arrowhead instead
  of a flat vertical bar — readable across pars (top), bars (mid), vintage
  (lower) all at once.

  BEAT-LOCKED STEPPING (the EDM hook):
    A persistent `chasePhase` advances the whole chevron field. On every KICK it
    JUMPS one discrete step forward (rising-edge detect on the kick slider
    crossing a threshold). Between kicks it free-runs slowly at `localSpeed` so
    the chase never freezes (P0 — always alive, even in silence). The stepping
    reads as the chevrons SNAPPING forward on each kick.

  BRIGHTNESS scales with `level` (sliderBright) — louder = brighter — over a
  small time-based base floor so the rig is never fully dark at silence.

  COLOUR blends cp1 (lime/green) -> cp2 (hot pink) along the chase coordinate,
  strict RGB-space cp1<->cp2 blend (PATTERNS.md §7).

  CONTROLS (UI order = declaration order)
    - localSpeed : free-run chase rate when no kicks arrive.
    - step       : KICK input. Rising edge past threshold -> advance one step.
    - bright     : overall LEVEL -> brightness (dark gaps stay black).
    - width      : chevron sharpness (low = razor leading edges, high = soft).
    - count      : how many chevrons span the chase.
    - colorPalette1/2 : cp1 (lime) -> cp2 (hot pink); colour blends along chase.

  AUDIO (modulators-only — NEVER read CPC audio globals natively):
      MODULATE sliderStep   (step)   <- micKick   // beat-locked stepping
      MODULATE sliderBright  (bright) <- micLow    // level -> brightness (REACTIVE)
*/

// ── Exported controls ────────────────────────────────────────────────────────
export var localSpeed = 0.5;   // free-run chase rate when no kicks
export var step = 0.0;         // KICK signal (MODULATE <- micKick); edge -> step
export var bright = 0.7;       // LEVEL (MODULATE <- micLow) -> brightness
export var width = 0.35;       // chevron sharpness (0 = razor edge)
export var count = 0.4;        // how many chevrons span the chase

export var cp1H = 0.30, cp1S = 1.0, cp1V = 1.0; // lime / green (chase start)
export var cp2H = 0.92, cp2S = 1.0, cp2V = 1.0; // hot pink     (chase end)
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderStep(v) { step = v; }
export function sliderBright(v) { bright = v; }
export function sliderWidth(v) { width = v; }
export function sliderCount(v) { count = v; }

// ── Tunables ─────────────────────────────────────────────────────────────────
var FREE_RATE   = 0.18;   // free-run chase turns/sec at localSpeed = 1.0
var STEP_COUNT  = 8.0;    // discrete steps per full chase cycle (one step/kick)
var KICK_THRESH = 0.18;   // kick slider level that counts as a hit (rising edge)
var MIN_CHEV    = 1.0;    // fewest chevrons
var MAX_CHEV    = 7.0;    // most chevrons
var CHEV_BEND   = 1.6;    // how far the arrowhead bends with |y-0.5|
var BASE_FLOOR  = 0.06;   // tiny always-on base so the rig is never black (P0)

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

// ── Persistent state across frames ───────────────────────────────────────────
var chasePhase = 0.0;   // chase position, 0..1 (wraps)
var kickArmed = 1;      // 1 = ready to detect a new rising edge
var nChev = 3.0;        // resolved chevron count this frame
var sharp = 6.0;        // resolved edge sharpness power this frame
var lvl = 0.7;          // resolved brightness level this frame

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  _hsv2rgb1();
  _hsv2rgb2();

  // Resolve controls into render-ready values.
  nChev = MIN_CHEV + clamp01(count) * (MAX_CHEV - MIN_CHEV);
  // width 0 -> razor (high power), width 1 -> soft (low power).
  sharp = 1.5 + (1.0 - clamp01(width)) * 10.0;
  lvl = clamp01(bright);

  // ── Beat-locked stepping: rising edge of the kick slider -> +1 step ──────
  var stepSize = 1.0 / STEP_COUNT;
  if (kickArmed == 1 && step >= KICK_THRESH) {
    chasePhase = chasePhase + stepSize;     // SNAP forward one discrete step
    kickArmed = 0;                          // wait for kick to fall before re-arming
  }
  if (step < KICK_THRESH * 0.6) kickArmed = 1; // hysteresis re-arm

  // ── Free-run between kicks so the chase is never frozen (P0) ─────────────
  chasePhase = chasePhase + dt * FREE_RATE * clamp01(localSpeed);
  chasePhase = chasePhase - floor(chasePhase);
}

export function render3D(index, x, y, z) {
  // Chase coordinate: pixel X bent into an arrowhead by its distance from the
  // rig's vertical centre, then offset by the running chase phase. Coordinate-
  // driven (x,y) so it ports from test_bench to the real rig.
  var bend = abs(clamp01(y) - 0.5) * CHEV_BEND;
  var coord = clamp01(x) + bend - chasePhase;

  // Repeating chevron field. wave() takes a 0..1 turn input -> a sawtooth-ish
  // ramp per chevron; raise the leading slope to a high power for a sharp
  // bright edge with a true-black gap behind it (high contrast / high-def).
  var phase = coord * nChev;
  var frac = phase - floor(phase);     // 0..1 within one chevron cell
  // Leading edge bright near frac=1 (the arrow tip), black toward frac=0.
  var edge = pow(frac, sharp);

  // Brightness = level-scaled chevron edge over a tiny always-on base.
  var base = BASE_FLOOR * (0.6 + 0.4 * wave(chasePhase));
  var bri = base + edge * (0.18 + 0.82 * lvl);
  bri = clamp01(bri);

  // Colour blends cp1 -> cp2 along the chase coordinate (wrapped).
  var tcol = coord - floor(coord);     // 0..1
  var r = (pr1 + (pr2 - pr1) * tcol) * bri;
  var g = (pg1 + (pg2 - pg1) * tcol) * bri;
  var b = (pb1 + (pb2 - pb1) * tcol) * bri;

  rgb(clamp01(r), clamp01(g), clamp01(b));
}
