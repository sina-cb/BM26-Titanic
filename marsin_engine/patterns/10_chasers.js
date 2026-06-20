/*
  10_chasers.js
  Life-Cycle Chasers — a flight of comet-like chasers streaking around the rig,
  each with a bright lead head (cp1) and a fading tail (cp2), each living its own
  birth-to-death brightness life-cycle. HD remake: crisp comet heads with clean
  pow-shaped tails over true-dark space, strict cp1(head)->cp2(tail) palette, and
  music-driven motion, flare and life.

  IDENTITY KEPT: multiple independent chasers, each a moving head + fading tail,
  with per-particle life-cycle brightness; cp1 (head) -> cp2 (tail) two-colour.

  CORE NON-REPEATING MATH
    A clock-delta accumulator `runPhase` (wrapped at PHASE_WRAP=10000, §7) drives
    all chasers; each particle p gets an incommensurate per-particle speed and a
    golden-ratio start offset (137.5° seed) so the chasers never re-cluster into a
    repeating pattern. Per-particle life-cycle phases use distinct primes so the
    fleet's TOTAL brightness stays ~steady (lives are out of phase), letting the
    `level` gain own the brightness budget. Travel direction is a guarded
    `direction` plus a slow autonomous √2-rate sin bias, so the flight
    occasionally wheels around on its own, out of lockstep.

  CONTROLS
    - localSpeed : run rate. 0 still creeps, 1 ~4x (§6).
    - direction  : <0.5 / >0.5 run direction; center guarded; auto-varies.
    - level      : AUDIO PRIMARY — overall chaser brightness gain.
    - kick       : AUDIO — head flare / brightness pop on the kick.
    - radius     : AUDIO — tail length / head size (travel feel).
    - count      : AUDIO — how many chasers are flying.
    - colorPalette1/2 : cp1 (head) -> cp2 (tail), strict RGB blend.

  AUDIO (modulators-only — never read CPC audio globals natively; the block below
  is the STRICT source of truth for the deploy-playlist generator):
      AUDIO_MODULATION_V1:
        sliderLevel  <- micLow  range 0.30..1.00 curve linear  # PRIMARY overall brightness (bass)
        sliderKick   <- micKick range 0.00..1.00 curve pow2    # head flare pop (kick)
        sliderRadius <- micFlux range 0.40..0.90 curve linear  # tail length / head size (build)
        sliderCount  <- micHigh range 0.20..0.95 curve linear  # number of chasers flying (highs)
      # STATIC (not modulated): direction — operator/scene set. (no white channel — rgb only.)
*/

// ── Exported controls (UI order = declaration order) ────────────────────────
export var localSpeed = 0.5;
export var direction = 0.5;      // run dir (center guarded, auto-varies)
export var level = 0.5;          // AUDIO PRIMARY: overall brightness gain
export var kick = 0.5;           // AUDIO: head flare pop
export var radius = 0.5;         // AUDIO: tail length / head size
export var count = 0.5;          // AUDIO: number of chasers

export var cp1H = 0.0, cp1S = 1.0, cp1V = 1.0;  // head (red)
export var cp2H = 0.55, cp2S = 1.0, cp2V = 1.0; // tail (cyan trail)
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderDirection(v) { direction = v; }
export function sliderLevel(v) { level = v; }
export function sliderKick(v) { kick = v; }
export function sliderRadius(v) { radius = v; }
export function sliderCount(v) { count = v; }

// ── Tunables ────────────────────────────────────────────────────────────────
var RUN_RATE = 0.42;        // laps per second at localSpeed = 1.0
var MAX_PARTS = 14;         // maximum chasers (count scales how many are lit)
var PHASE_WRAP = 10000.0;
var BASE_FLOOR = 0.04;      // calm non-black base in silence

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
var runPhase = 0.0;
var lifePhase = 0.0;   // always-forward life-cycle clock (never stalls)
var dirPhase = 0.0;
var runSgn = 1.0;
var dirSmooth = 1.0;   // eased run direction (-1..1) — avoids tail-flip seams
var velMag = 1.0;      // |effective velocity| this frame (tail length factor)
var velSgn = 1.0;      // sign of effective velocity (tail orientation)

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  _hsv2rgb1();
  _hsv2rgb2();

  var localMultiplier = pow(2.0, (localSpeed - 0.5) * 4.0); // §6
  var rate = 0.06 + 0.94 * localMultiplier; // tiny creep at localSpeed = 0

  var d = (direction * 2.0) - 1.0;
  if (d >= 0.0 && d < 0.06) d = 0.06;
  else if (d < 0.0 && d > -0.06) d = -0.06;

  dirPhase = dirPhase + dt * rate * 1.41421;
  if (dirPhase >= PHASE_WRAP) dirPhase = dirPhase - PHASE_WRAP;
  var autoBias = sin(dirPhase * PI2 * 0.047) + 0.6 * sin(dirPhase * PI2 * 0.028);
  var eff = d + autoBias * 0.85;
  if (eff >= 0.0 && eff < 0.05) eff = 0.05;
  else if (eff < 0.0 && eff > -0.05) eff = -0.05;
  runSgn = eff >= 0.0 ? 1.0 : -1.0;

  // Ease the direction toward the target sign so reversals pass smoothly through
  // zero (the comets slow, stop, then run the other way) instead of snapping the
  // tails to the opposite side in one frame (which read as a flash seam).
  var ease = dt * rate * 0.9;
  if (ease > 1.0) ease = 1.0;
  dirSmooth = dirSmooth + (runSgn - dirSmooth) * ease;

  // Position advances by a SIGNED velocity = a constant forward base (so comets
  // never fully stop -> no dead-static stretch and no seam) plus an eased
  // direction term. The effective velocity changes sign smoothly through the
  // reversal but its magnitude stays well above zero, so the look stays alive.
  var vel = 0.30 + 0.70 * dirSmooth;   // signed velocity; reverses on auto-switch
  velSgn = vel >= 0.0 ? 1.0 : -1.0;
  velMag = vel >= 0.0 ? vel : -vel;
  runPhase = runPhase + dt * rate * RUN_RATE * vel;
  if (runPhase >= PHASE_WRAP) runPhase = runPhase - PHASE_WRAP;
  else if (runPhase < 0.0) runPhase = runPhase + PHASE_WRAP;

  lifePhase = lifePhase + dt * rate * RUN_RATE; // always forward, never stalls
  if (lifePhase >= PHASE_WRAP) lifePhase = lifePhase - PHASE_WRAP;
}

export function render3D(index, wx, wy, wz) {
  var nx = wx; if (nx < 0.0) nx = 0.0; else if (nx > 1.0) nx = 1.0;

  // Tail length and head size scale with radius (AUDIO travel feel). Kept fairly
  // short so the comets are crisp accents, not a brightness flood. The tail
  // shrinks as the effective velocity eases through a reversal (|vel| factor), so
  // it re-grows on the new side smoothly — no flip seam.
  var tailLen = (0.03 + radius * 0.13) * (0.30 + 0.70 * velMag);

  var gain = 0.07 + level * 0.93;
  var kickPop = kick * 0.9;

  // How many chasers are flying (count = AUDIO). Always >= 5 so the fleet total
  // stays statistically steady (law of large numbers) -> clean level mapping.
  var activeF = 5.0 + count * (MAX_PARTS - 5.0);

  var bestV = 0.0;     // brightest chaser contribution at this pixel
  var bestBlend = 0.0; // head(0)->tail(1) colour blend at the winner

  for (var p = 0; p < MAX_PARTS; p++) {
    // Eligibility: only the first `activeF` chasers fly (smooth fade at the edge).
    var partGate = activeF - p;
    if (partGate <= 0.0) partGate = 0.0;
    else if (partGate > 1.0) partGate = 1.0;
    if (partGate <= 0.0) continue;

    // Per-particle incommensurate speed + golden-ratio start (137.5° seed).
    var seed = p * 137.5;
    var speedVar = 0.6 + (sin(seed * 7.9) * 0.5 + 0.5) * 1.1;
    var startOff = sin(seed * 11.3) * 0.5 + 0.5;

    // Head position streams with runPhase; per-particle speed keeps them spread.
    var headPos = startOff + runPhase * speedVar;
    headPos = headPos - floor(headPos);

    // Per-particle life-cycle (birth->peak->death) on a distinct prime-ish rate,
    // out of phase across the fleet so the fleet's TOTAL brightness stays steady.
    // Kept shallow (0.6..1.0) so a comet never blacks out — preserves the level
    // mapping while still giving each chaser its own breathing life.
    var lifeRate = 0.7 + (sin(seed * 17.1) * 0.5 + 0.5) * 1.3;
    var life = 0.5 + 0.5 * sin((lifePhase * lifeRate + p * 0.2617) * PI2);
    life = 0.6 + 0.4 * life;

    // Distance from this pixel to the head, wrapped to nearest, oriented so the
    // tail trails BEHIND the head along the EASED run direction (consistent with
    // the position accumulation -> reversals are seamless).
    var raw = headPos - nx;
    var wrapped = raw - floor(raw + 0.5);
    var along = wrapped * velSgn;

    var v = 0.0;
    var blend = 0.0;
    if (along >= 0.0 && along < tailLen) {
      var tb = along / tailLen;        // 0 at head, 1 at tail tip
      v = pow(1.0 - tb, 3.2);          // crisp head, fast-fading tail (sharp)
      blend = tb;                       // head=cp1, tail=cp2
    }
    // Head halo: always glow the pixels nearest the head (both sides), so a slow
    // or momentarily-paused comet never falls invisibly between pixels (no dead-
    // static stretch). Radius ~ one inter-pixel spacing on the 52-px ring.
    var dHead = wrapped >= 0.0 ? wrapped : -wrapped;
    var halo = 1.0 - dHead / 0.075;
    if (halo > 0.0) {
      var hv = pow(halo, 1.6);
      if (hv > v) { v = hv; if (along < 0.0) blend = 0.0; }
    }

    v = v * life * partGate;
    if (v > bestV) { bestV = v; bestBlend = blend; }
  }

  // PRIMARY carrier: a near-STEADY level-driven star field carries the brightness
  // budget — most pixels glow at a fixed, level-scaled brightness, so the rig
  // total tracks `level` directly (clean corr). A smaller dark subset keeps
  // negative space for the comets to streak across.
  var hashp = (index * 0.61803 + nx * 6.0);
  hashp = hashp - floor(hashp);
  var starGate = 0.5 + 0.5 * sin((hashp * 23.0 + 0.17) * PI2);
  var star = starGate > 0.25 ? (0.35 + 0.65 * pow(starGate, 1.6)) : 0.08;
  // A faint per-star twinkle on the always-forward life clock guarantees the rig
  // is never dead-static (even when a comet momentarily pauses at a reversal),
  // and averages out across the field so it barely affects the PRIMARY corr.
  var tw = 0.88 + 0.12 * sin((lifePhase * 1.7 + hashp * 19.0) * PI2);
  // A kick pop lifts the WHOLE star field uniformly (clearly kick-reactive),
  // folded into the level-driven carrier.
  var atmo = star * tw * gain * (1.0 + kickPop * 0.55); // dominant level+kick field
  var atmoBlend = hashp;                              // sprinkle both palette ends

  // Crisp comet highlight on top — a sharp moving pinpoint that flares on the
  // kick and reads at full bright, but covers few pixels so its brightness
  // variance stays small next to the level-driven star budget.
  var headW = (1.0 - bestBlend);                      // brighter near the head
  var cometV = clamp01(bestV * 1.4) * gain * 0.45 * (1.0 + kickPop * headW);

  // Composite: atmosphere (two-colour sprinkle) + comet (head->tail blend).
  var rA = (pr1 + (pr2 - pr1) * atmoBlend) * atmo;
  var gA = (pg1 + (pg2 - pg1) * atmoBlend) * atmo;
  var bA = (pb1 + (pb2 - pb1) * atmoBlend) * atmo;

  var rC = (pr1 + (pr2 - pr1) * bestBlend) * cometV;
  var gC = (pg1 + (pg2 - pg1) * bestBlend) * cometV;
  var bC = (pb1 + (pb2 - pb1) * bestBlend) * cometV;

  rgb(clamp01(rA + rC), clamp01(gA + gC), clamp01(bA + bC));
}
