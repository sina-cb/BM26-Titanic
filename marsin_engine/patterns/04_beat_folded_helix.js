/*
  04_beat_folded_helix.js
  "Beat-Folded Helix" — a pseudo-3D helix tunnel.

  IDENTITY (preserved): spiraling arms (armCount) twisting down a depth tunnel
  (twistFreq, tunnelZ) with a beat pulse that pops pars/vintage and drives white.
  Cyan -> red palette. Per-section roles:
    - sectionId 3 (Bars)    : depth-faded helix arms (the tunnel walls).
    - sectionId 1 (Pars)    : beat-pop core + W flash.
    - sectionId 2 (Vintage) : W + amber blinders, driven HARD by the kick.

  COORDS: render3D x,y,z are ALREADY 0..1 — used directly, never re-normalized.
  Section behaviour branches on sectionId (1=pars, 2=vintage, 3=bars), never on
  raw y thresholds.

  NON-REPEATING MATH: tunnel travel, spin, beat phase, colour drift and the
  autonomous direction flip each ride their OWN accumulator, advanced per-frame
  and wrapped at a LARGE multiple (PHASE_WRAP) of their period so a wrap never
  jumps an in-frame use (no seam). Incommensurate irrational multipliers
  (√2, √3, φ, golden angle) keep the look from ever re-locking:
      helixPhase = ang*armCount + (depth*twistFreq*1.41421 - tunnelZ + spinPhase)*PI2
      beat   cadence  ~ φ-ish    colour drift ~ √3    auto-flip ~ golden ratio

  CONTROLS (UI order = declaration order):
    localSpeed  : tunnel-travel + spin rate. pow(2,(localSpeed-0.5)*4). 0 still creeps.
    radius      : movement RADIUS — tunnel speed / arm spread / twist travel. (audio)
    kick        : brightness KICK — drives the beat pulse + vintage W blinders. (audio)
    level       : overall brightness PRIMARY (clean level->gain, no phase wobble). (audio)
    count       : armCount (helix arm count).
    twistFreq   : tunnel twist frequency.
    contrast    : arm crispness (true-black-ish negative space).
    direction   : tunnel travel into/out-of screen + spin direction (guarded,
                  never freezes). The pattern ALSO auto-reverses on its own on an
                  incommensurate golden-ratio cadence (organic, not lockstep).
    colorPalette1/2 : strict cp1<->cp2; blended in RGB space.

  AUDIO (modulators-only — never read CPC audio globals natively):
      MODULATE sliderLevel  (level)  <- micLow    // PRIMARY -> overall brightness
      MODULATE sliderKick   (kick)   <- micKick   // beat pop + vintage W blinders
      MODULATE sliderRadius (radius) <- micFlux   // tunnel speed / arm spread
*/

// ── Exported controls (UI order = declaration order) ────────────────────────
export var localSpeed = 0.5;   // tunnel travel + spin rate (0 still creeps)
export var radius = 0.5;        // movement RADIUS (audio: micFlux)
export var kick = 0.0;          // brightness KICK (audio: micKick)
export var level = 1.0;         // overall brightness PRIMARY (audio: micLow)
export var count = 0.18;        // armCount selector
export var twistFreqN = 0.625;  // twistFreq selector (maps to -10..30)
export var contrast = 1.5;      // arm crispness
export var direction = 0.75;    // tunnel/spin heading (0.5 = center)

export var cp1H = 0.5, cp1S = 1.0, cp1V = 1.0; // Cyan default (cp1)
export var cp2H = 0.0, cp2S = 1.0, cp2V = 1.0; // Red default  (cp2)
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderRadius(v) { radius = v; }
export function sliderKick(v) { kick = v; }
export function sliderLevel(v) { level = v; }
export function sliderCount(v) { count = v; }
export function sliderTwistFreq(v) { twistFreqN = v; }
export function sliderContrast(v) { contrast = 0.5 + v * 9.0; }
export function sliderDirection(v) {
  var d = (v * 2.0) - 1.0;                       // -1..1
  if (d >= 0.0 && d < 0.06) d = 0.06;            // never sit at exactly 0
  else if (d < 0.0 && d > -0.06) d = -0.06;
  globalDir = d;
}

// ── Tunables ────────────────────────────────────────────────────────────────
var TRAVEL_RATE = 0.55;   // tunnel turns/sec at localSpeed=1, radius=0.5
var SPIN_RATE   = 0.21;   // spin turns/sec at localSpeed=1
var BEAT_RATE   = 0.62;   // beat cadence (φ-ish) turns/sec
var DRIFT_RATE  = 0.07;   // colour drift turns/sec
var FLIP_RATE   = 0.013;  // autonomous direction flip drift rate
var PHASE_WRAP  = 10000.0;// wrap far from any in-frame use (no seam, §7)

// ── Palette RGB cache (verbatim from 27_swipe; blend in RGB space) ───────────
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

// ── Persistent state (each consumer owns its accumulator) ────────────────────
var globalDir = 0.5;       // resolved heading from direction slider (set in setter)
var tunnelZ = 0.0;         // tunnel-travel accumulator
var spinPhase = 0.0;       // spin accumulator
var beatPhase = 0.0;       // beat-cadence accumulator
var driftPhase = 0.0;      // colour-drift accumulator
var autoFlip = 0.0;        // autonomous direction flip accumulator
var beatPulse = 0.0;       // 0..1 beat pulse this frame
var headingNow = 1.0;      // resolved heading this frame (manual x auto-flip)
var armCount = 3.0;        // resolved arm count this frame
var twistFreq = 4.0;       // resolved twist freq this frame

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  _hsv2rgb1();
  _hsv2rgb2();

  // localSpeed: pow(2,(localSpeed-0.5)*4) -> 0->0.25x, 0.5->1x, 1->4x.
  var localMultiplier = pow(2.0, (localSpeed - 0.5) * 4.0);
  // Movement RADIUS scales travel/spin speed; keep a creep floor so 0 still moves.
  var radScale = 0.35 + radius * 1.3;

  // Autonomous direction variation: autoFlip drifts on an irrational period and
  // occasionally flips heading (golden-ratio cadence) so the rig never flips in
  // lockstep. The manual direction slider biases the sign.
  autoFlip = autoFlip + dt * localMultiplier * FLIP_RATE;
  if (autoFlip >= PHASE_WRAP) autoFlip = autoFlip - PHASE_WRAP;
  var autoDir = wave(autoFlip * 1.6180339) < 0.5 ? -1.0 : 1.0;
  headingNow = globalDir * autoDir;            // manual bias x autonomous flip
  // globalDir is guarded away from 0 in the setter; default (no setter call) is
  // 0.5 -> still non-zero, so heading never resolves to a frozen 0.

  // Each accumulator advances per-frame and wraps at a large multiple (no seam).
  var travel = dt * localMultiplier * radScale * TRAVEL_RATE * headingNow;
  tunnelZ = tunnelZ + travel;
  if (tunnelZ >= PHASE_WRAP) tunnelZ = tunnelZ - PHASE_WRAP;
  else if (tunnelZ < 0.0) tunnelZ = tunnelZ + PHASE_WRAP;

  spinPhase = spinPhase + dt * localMultiplier * SPIN_RATE * headingNow;
  if (spinPhase >= PHASE_WRAP) spinPhase = spinPhase - PHASE_WRAP;
  else if (spinPhase < 0.0) spinPhase = spinPhase + PHASE_WRAP;

  beatPhase = beatPhase + dt * localMultiplier * BEAT_RATE;
  if (beatPhase >= PHASE_WRAP) beatPhase = beatPhase - PHASE_WRAP;

  driftPhase = driftPhase + dt * localMultiplier * DRIFT_RATE;
  if (driftPhase >= PHASE_WRAP) driftPhase = driftPhase - PHASE_WRAP;

  // Beat pulse: fires from the clock alone (keeps the pattern alive with no
  // audio) but the clock contribution is kept SMALL so it doesn't dominate the
  // brightness budget and decorrelate the level PRIMARY. The audio KICK is what
  // makes it slam (and that lands as a separate, kick-correlated dimension).
  var beatFrac = beatPhase - floor(beatPhase);
  var clockBeat = (beatFrac < 0.14) ? 1.0 : 0.0;
  beatPulse = clamp01(clockBeat * 0.16 + kick * 0.95);

  // Resolved controls.
  armCount = 1.0 + floor(count * 12.0);        // 1..13 arms
  twistFreq = -10.0 + twistFreqN * 40.0;       // -10..30
}

export function render3D(index, x, y, z) {
  // Self-filter: only known sections render (P0).
  if (sectionId != 1 && sectionId != 2 && sectionId != 3) { rgb(0, 0, 0); return; }

  // Coords are ALREADY 0..1 — used directly. Build a tunnel centred on the rig.
  var cx = (x - 0.5) * 2.0;                     // -1..1 across X
  var cy = (y - 0.5) * 2.0;                     // -1..1 across Y

  var ang = atan2(cy, cx);
  var dist = hypot(cx, cy);
  if (dist < 0.04) dist = 0.04;

  var depth = 1.0 / dist;                        // near-axis = "far down the tunnel"
  // Incommensurate twist so the helix never re-locks. tunnelZ/spinPhase carry sign.
  var helixPhase = (ang * armCount)
                 + (depth * twistFreq * 1.41421356 - tunnelZ + spinPhase) * PI2;
  var field = sin(helixPhase);

  // Crisp arms with true-black-ish negative space; contrast sharpens the cores.
  var v = field > 0.0 ? field : 0.0;
  v = pow(v, contrast);
  var floorv = 0.012;                           // small non-black floor (visibility)

  var outV = floorv;
  var outW = 0.0;
  var outA = 0.0;

  if (sectionId == 3) {
    // BARS — depth-faded helix tunnel walls (fade out toward the axis).
    var dfade = dist * 2.4; if (dfade > 1.0) dfade = 1.0;
    outV = floorv + v * 1.5 * dfade;
  } else if (sectionId == 1) {
    // PARS — beat-pop core + W flash on the beat.
    outV = floorv + v * 0.6;
    if (beatPulse > 0.0 && field > 0.0) {
      outV = max(outV, 0.55 + 0.45 * beatPulse);
      outW = 0.85 * beatPulse;
    }
  } else {
    // VINTAGE (sectionId == 2) — W + amber blinders, driven HARD by the kick.
    outV = floorv + v * 0.9;
    outW = (0.25 * v + 0.9 * beatPulse) * (0.5 + 0.5 * kick);
    outA = 0.45 * v + 0.35 * beatPulse;
  }

  // Colour: cp1<->cp2 blended in RGB space, drifting down the tunnel (√3 ratio).
  var colorBlend = wave(depth * 0.2 + helixPhase * (0.1 / PI2)
                      + driftPhase * 1.7320508);
  var r = pr1 + (pr2 - pr1) * colorBlend;
  var g = pg1 + (pg2 - pg1) * colorBlend;
  var b = pb1 + (pb2 - pb1) * colorBlend;

  // PRIMARY: level is a clean overall gain, applied uniformly (no animation-phase
  // term) so total brightness tracks micLow rather than the spin/beat wobble.
  var gain = level;
  outV = clamp01(outV);
  r = clamp01(r * outV * gain);
  g = clamp01(g * outV * gain);
  b = clamp01(b * outV * gain);
  outW = clamp01(outW * gain);
  outA = clamp01(outA * gain);

  rgbwau(r, g, b, outW, outA, 0.0);
}
