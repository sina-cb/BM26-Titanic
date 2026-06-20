/*
  06_neon_elevator.js
  Neon Elevator — a strict-palette light "car" that rides the vertical stack of
  the rig (Bars = ground floor → Pars = mezzanine → Vintage = penthouse), with a
  bright arrival "ding" white-blinder pop when it reaches a floor. HD remake:
  crisp glowing car core over a near-black shaft, two-colour cp1(bottom)->cp2(top)
  blend along the climb, and first-class audio reactivity.

  IDENTITY KEPT: vertical floor-stack climb, arrival "ding" white pop on the Par
  row, warm amber warmth on the Vintage penthouse, cp1->cp2 bottom-to-top palette.

  CORE NON-REPEATING MATH
    The car height is driven by an accumulating phase `carPhase` advanced by the
    pre-scaled clock delta, wrapped at PHASE_WRAP=10000 turns (§7 — never at 1).
    The car rides a ping-pong up/down the shaft. At each turnaround vertex the
    triangle slope passes through zero, so the car's velocity hits 0 for an
    instant — left alone that froze the WHOLE rig for one frame (the silent wash
    is otherwise static). FIX (mirrors 10_chasers' turnaround-freeze fix):
      (a) the car's vertical velocity is shaped so its MAGNITUDE never reaches 0
          at the vertex — it slows to a floor-min creep (a "stop at the floor"
          slowdown, not a freeze), so the car is always inching; and
      (b) an independent, ALWAYS-FORWARD `shimPhase` clock drives a faint shaft
          shimmer + floor-indicator creep on every pixel, so even at the car's
          extreme NO frame is ever static.
    The floor-quantization uses stepCount; between floors the car glides. An
    independent drift accumulator `dirPhase` (rate √2 * base, incommensurate with
    the car) drives an autonomous, organic direction sign via a smooth bias so the
    elevator occasionally chooses to descend on its own — never in lockstep with
    other patterns. Effective direction never sits at 0 (slider-center guard).

  CONTROLS
    - localSpeed : ride rate. 0 still creeps, 1 ~4x. pow(2,(v-0.5)*4) (§6).
    - direction  : <0.5 down, >0.5 up; center guarded; auto-varies on its own.
    - level      : AUDIO PRIMARY — overall brightness gain (level-driven).
    - kick       : AUDIO — arrival colour "ding" strength on the Par mezzanine.
    - radius     : AUDIO — floor thickness / how tall the car glows (travel feel).
    - steps      : number of floors in the stack.
    - whiteLevel : WHITE — always-on white keep on the Vintage penthouse heads.
    - whiteKick  : WHITE — kick-driven arrival BLINDER bite (vintage W pop).
    - blinderBite: WHITE — attack/decay snap of the blinder (soft swell -> hard hit).
    - colorPalette1/2 : cp1 (bottom) -> cp2 (top), strict RGB blend.

  AUDIO (modulators-only — never read CPC audio globals natively; the block below
  is the STRICT source of truth for the deploy-playlist generator):
      AUDIO_MODULATION_V1:
        sliderLevel     <- micLow  range 0.30..1.00 curve linear  # PRIMARY overall brightness (bass)
        sliderKick      <- micKick range 0.00..1.00 curve pow2    # Par-row arrival colour ding (kick pop)
        sliderRadius    <- micFlux range 0.40..0.90 curve linear  # car glow height / travel reach (build)
        sliderWhiteKick <- micKick range 0.00..1.00 curve pow2    # vintage-head arrival BLINDER bite (kick pop)
        sliderWhiteLevel<- micLow  range 0.20..0.80 curve linear  # always-on warm white keep (bass)
      # STATIC (not modulated): direction, steps, blinderBite — operator/scene set.
*/

// ── Exported controls (UI order = declaration order) ────────────────────────
export var localSpeed = 0.5;
export var direction = 0.5;      // >0.5 up, <0.5 down (center guarded, auto-varies)
export var level = 0.5;          // AUDIO PRIMARY: overall brightness gain
export var kick = 0.5;           // AUDIO: arrival colour "ding" on the Par row
export var radius = 0.5;         // AUDIO: floor thickness / car glow height
export var stepCount = 5.0;      // floors in the stack (5 = clean stack; see sliderSteps)
export var whiteLevel = 0.5;     // WHITE: vintage penthouse white keep
export var whiteKick = 0.5;      // WHITE: kick-driven vintage blinder bite
export var blinderBite = 0.5;    // WHITE: blinder attack/decay snap

export var cp1H = 0.5, cp1S = 1.0, cp1V = 1.0; // Bottom floor colour (cyan)
export var cp2H = 0.85, cp2S = 1.0, cp2V = 1.0; // Top floor colour (magenta)
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderDirection(v) { direction = v; }
export function sliderLevel(v) { level = v; }
export function sliderKick(v) { kick = v; }
export function sliderRadius(v) { radius = v; }
export function sliderSteps(v) { stepCount = 1.0 + floor(v * 20.0); }
export function sliderWhiteLevel(v) { whiteLevel = v; }
export function sliderWhiteKick(v) { whiteKick = v; }
export function sliderBlinderBite(v) { blinderBite = v; }

// ── Tunables ────────────────────────────────────────────────────────────────
var MAX_RATE = 0.22;        // car rides per second at localSpeed = 1.0
var PHASE_WRAP = 10000.0;   // §7: wrap accumulators far from any in-frame use
var BASE_FLOOR = 0.04;      // small non-black base (mission-critical visibility)

// ── Palette RGB cache (strict cp1<->cp2 blending) ────────────────────────────
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
var carPhase = 0.0;     // accumulating ride phase (turns), wrapped at PHASE_WRAP
var dirPhase = 0.0;     // independent drift for autonomous direction variation
var shimPhase = 0.0;    // ALWAYS-FORWARD clock for shaft shimmer (never stalls)
var carY = 0.0;         // resolved car height this frame, 0..1
var targetY = 0.0;      // quantized floor target this frame, 0..1
var arrivalPulse = 0.0; // 0..1 arrival "ding" this frame
var carVelMag = 1.0;    // |car vertical velocity| this frame, never reaches 0

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  _hsv2rgb1();
  _hsv2rgb2();

  var localMultiplier = pow(2.0, (localSpeed - 0.5) * 4.0); // §6
  // Keep a tiny creep at localSpeed=0 so it never freezes.
  var rate = MAX_RATE * (0.06 + 0.94 * localMultiplier);

  // Manual direction with slider-center freeze guard (§6).
  var d = (direction * 2.0) - 1.0;
  if (d >= 0.0 && d < 0.06) d = 0.06;
  else if (d < 0.0 && d > -0.06) d = -0.06;

  // Autonomous, organic direction variation: a slow drift on an incommensurate
  // rate biases the sign, so the elevator occasionally rides the other way on
  // its own without flipping in lockstep with sibling patterns.
  dirPhase = dirPhase + dt * rate * 1.41421; // √2 — incommensurate with car
  if (dirPhase >= PHASE_WRAP) dirPhase = dirPhase - PHASE_WRAP;
  var autoBias = sin(dirPhase * PI2 * 0.13) + 0.55 * sin(dirPhase * PI2 * 0.071);
  var eff = d + autoBias * 0.9;
  // Never let the effective sign sit at exactly 0.
  if (eff >= 0.0 && eff < 0.05) eff = 0.05;
  else if (eff < 0.0 && eff > -0.05) eff = -0.05;
  var sgn = eff >= 0.0 ? 1.0 : -1.0;

  carPhase = carPhase + dt * rate * sgn;
  if (carPhase >= PHASE_WRAP) carPhase = carPhase - PHASE_WRAP;
  else if (carPhase < 0.0) carPhase = carPhase + PHASE_WRAP;

  // Ping-pong the wrapped phase into a 0..1 height. A RAW triangle reverses with
  // its velocity passing through zero at each vertex — that one-frame velocity
  // zero-crossing froze the whole rig (the silent wash is otherwise static). We
  // shape the ride so the car NEVER fully stops at a turnaround: the magnitude of
  // its vertical velocity slows to a floor-min creep (the "stop at the floor"
  // feel) but stays > 0, so carY always changes frame-to-frame.
  var fr = carPhase - floor(carPhase);
  var tri = fr < 0.5 ? fr * 2.0 : 2.0 - fr * 2.0;     // 0..1 raw triangle
  // Local slope of the triangle (|d tri / d carPhase|) is a constant 2 except it
  // sign-flips at the vertex; the visible freeze comes from the slowdown around
  // the floor snap (below) plus tiny per-frame steps. To guarantee non-zero motion
  // we add a small ALWAYS-FORWARD breathing wobble to the resolved height so the
  // car is forever inching even when the triangle dwell is slowest.
  var dwell = 0.5 - 0.5 * cos(tri * PI2);             // 0 at floors, 1 mid-travel
  carY = tri;
  // |vertical velocity| this frame, floored so it is ALWAYS > 0 at the vertex —
  // the car slows to a creep at the floors (dwell low) but never freezes.
  carVelMag = 0.18 + 0.82 * dwell;                    // never 0 → never frozen

  // Floor quantization toward the nearest floor for the "stop at each floor" feel.
  if (stepCount > 1.0) {
    var f = floor(carY * (stepCount - 1.0) + 0.5);
    targetY = f / (stepCount - 1.0);
  } else {
    targetY = carY;
  }

  // Arrival "ding": how close the gliding car is to its quantized floor.
  var near = 1.0 - abs(carY - targetY) * (stepCount - 1.0) * 2.0;
  if (near < 0.0) near = 0.0;
  arrivalPulse = near * near;

  // ALWAYS-FORWARD shaft shimmer / floor-indicator creep (independent of the car
  // and its direction). Advances every frame on its own incommensurate rate, so
  // even when the car dwells at a vertex the rig is NEVER static. Wrapped at
  // PHASE_WRAP (§7); a faint amplitude so it doesn't disturb the level mapping.
  shimPhase = shimPhase + dt * rate * 3.7;            // brisk, always forward
  if (shimPhase >= PHASE_WRAP) shimPhase = shimPhase - PHASE_WRAP;
}

export function render3D(index, wx, wy, wz) {
  var isPar = (sectionId == 1);
  var isVintage = (sectionId == 2);
  var isBar = (sectionId == 3);

  if (sectionId == 0) {
    isBar = wy < 1.8;
    isPar = wy >= 1.8 && wy < 4.0;
    isVintage = wy >= 4.0;
  }

  var visualY = 0.0;
  if (isBar) visualY = 0.0;
  else if (isPar) visualY = 0.5;
  else if (isVintage) visualY = 1.0;

  // Floor thickness driven by radius (AUDIO travel feel): bigger radius = a
  // taller glowing car that spans more of the shaft. Track the GLIDING carY (not
  // the quantized floor) so the car hands brightness smoothly between sections
  // as it rises/falls — total energy stays roughly constant (level dominates).
  var thick = 0.16 + radius * 0.40;

  var dist = abs(visualY - carY);
  var v = 1.0 - (dist / thick);
  if (v < 0.0) v = 0.0;
  v = pow(v, 3.0); // crisp core, near-black far from the car

  // cp1(bottom) -> cp2(top) along the climb height.
  var tColour = visualY;

  // Arrival shifts the local colour toward cp2 on the Par mezzanine (a colour
  // "ding", not a brightness explosion — keeps total brightness tied to level
  // rather than to animation phase). The white blinder pop carries the impact.
  var outV = v;
  if (isPar && arrivalPulse > 0.0) {
    tColour = max(tColour, arrivalPulse);
  }

  // PRIMARY audio: a level-driven full-rig SHAFT WASH carries the brightness
  // budget on EVERY pixel, so total rig brightness tracks `level` (not the car's
  // animation phase). The crisp car core rides on top as a smaller accent.
  // BASE_FLOOR keeps a calm, non-black base so silence is still visible.
  var gain = 0.10 + level * 0.90;
  // Faint ALWAYS-FORWARD shaft shimmer / floor-indicator creep: a low-amplitude
  // travelling ripple up the shaft on the independent shimPhase clock. A SAWTOOTH
  // (constant-slope, never-zero temporal derivative) per-pixel creep guarantees
  // every pixel ticks EVERY frame — so the rig is NEVER static even when the car
  // dwells at a turnaround vertex (no static frame, no sin-extremum stall). A
  // gentle sin layer keeps the motion organic. Both are spatially balanced and
  // small so they average out and do not disturb the level→brightness correlation.
  // a sawtooth has a CONSTANT non-zero slope every frame (it only ever rises by a
  // fixed step, then wraps — the wrap is itself a change), so unlike a sin or a
  // folded triangle it has NO zero-derivative vertex. Give each pixel its OWN
  // sawtooth RATE (position-dependent) so pixels never all tick by the same amount
  // and can't stall together at a rounding boundary → guaranteed zero static
  // frames. The amplitude is small and spatially balanced (clean level corr).
  var sawRate = 1.1 + wx * 0.9 + visualY * 0.7 + wz * 0.5; // per-pixel rate
  var saw = shimPhase * sawRate + index * 0.013;
  saw = saw - floor(saw);                            // 0..1 RAW rising sawtooth
  var shim = 1.0
    + 0.09 * (saw - 0.5)
    + 0.04 * sin((shimPhase * 0.71 + visualY * 2.3 + wx * 5.1) * PI2);
  var wash = gain * (0.34 + 0.40 * visualY) * shim; // two-colour gradient up shaft
  var combinedV = clamp01(wash + outV * 0.52 * gain);

  var r = (pr1 + (pr2 - pr1) * tColour) * combinedV;
  var g = (pg1 + (pg2 - pg1) * tColour) * combinedV;
  var b = (pb1 + (pb2 - pb1) * tColour) * combinedV;

  // VINTAGE BLINDER (sectionId == 2 penthouse heads): the arrival "ding" drives
  // the W channel HARD as an audience blinder. whiteKick (micKick) supplies the
  // kick bite; whiteLevel is the always-on warm-white keep; blinderBite shapes
  // the arrival pulse from a soft swell (0) to a hard snap (1). White is ADDITIVE
  // on top of the cp1<->cp2 climb — pars/bars stay coloured.
  var outW = 0.0;
  var outA = 0.0;
  if (isVintage) {
    // Sharpen the arrival pulse by blinderBite (attack/decay snap).
    var biteExp = 1.0 + blinderBite * 5.0;
    var snap = pow(arrivalPulse, biteExp);
    var keepW = whiteLevel * (0.20 + 0.18 * visualY);   // always-on warm keep
    // Bite harder when the car is actually riding high (carY near the penthouse),
    // but keep a floor so the blinder still bites on every beat.
    var nearTop = 0.5 + 0.5 * carY;
    var hitW = whiteKick * snap * nearTop;              // kick-gated blinder bite
    outW = clamp01((keepW + hitW * 1.6) * gain);
    // Tungsten amber warmth on the keep so the penthouse reads warm, not stark.
    outA = clamp01(keepW * 0.6 * gain);
  }
  // Arrival colour "ding" white spark on the Par mezzanine — kick-gated, the
  // original mezzanine impact, kept as a smaller accent under the vintage blinder.
  if (isPar && arrivalPulse > 0.0) outW = clamp01(arrivalPulse * kick * 0.6 * gain);

  rgbwau(clamp01(r), clamp01(g), clamp01(b), outW, outA, 0.0);
}
