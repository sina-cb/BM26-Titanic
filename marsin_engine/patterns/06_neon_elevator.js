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

  WHITE (modulators-only):
      MODULATE sliderWhiteKick  (whiteKick)  <- micKick  // vintage-head blinder pop
      MODULATE sliderWhiteLevel (whiteLevel) <- micLow   // overall white keep

  AUDIO (modulators-only — never read CPC audio globals natively):
      MODULATE sliderLevel     (level)     <- micLow    // PRIMARY -> overall brightness
      MODULATE sliderWhiteKick (whiteKick) <- micKick   // arrival vintage blinder pop
      MODULATE sliderRadius    (radius)    <- micFlux   // car glow height / travel feel
*/

// ── Exported controls (UI order = declaration order) ────────────────────────
export var localSpeed = 0.5;
export var direction = 0.75;     // >0.5 up, <0.5 down (center guarded)
export var level = 0.7;          // AUDIO PRIMARY: overall brightness gain
export var kick = 0.0;           // AUDIO: arrival colour "ding" on the Par row
export var radius = 0.4;         // AUDIO: floor thickness / car glow height
export var stepCount = 5.0;      // floors in the stack
export var whiteLevel = 0.4;     // WHITE: vintage penthouse white keep
export var whiteKick = 0.0;      // WHITE: kick-driven vintage blinder bite
export var blinderBite = 0.6;    // WHITE: blinder attack/decay snap

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
var carY = 0.0;         // resolved car height this frame, 0..1
var targetY = 0.0;      // quantized floor target this frame, 0..1
var arrivalPulse = 0.0; // 0..1 arrival "ding" this frame

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

  // Ping-pong the wrapped phase into a 0..1 height (triangle of the fractional
  // part) so the car rides up and down the shaft smoothly, no teleport seam.
  var fr = carPhase - floor(carPhase);
  carY = fr < 0.5 ? fr * 2.0 : 2.0 - fr * 2.0;

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
  var thick = 0.22 + radius * 0.22;

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
  var gain = BASE_FLOOR + level * 0.96;
  var wash = gain * (0.34 + 0.40 * visualY); // two-colour gradient up the shaft
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
