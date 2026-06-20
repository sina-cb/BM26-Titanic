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
    whiteLevel  : overall WHITE amount — pars W flash + vintage always-on keep. (audio)
    whiteKick   : kick-driven WHITE pop — the vintage-head BLINDER bite. (audio)
    whiteWarmth : tint of the vintage white: warm amber (A) at 0 -> cool/UV (U)
                  at 1, so the blinder reads tungsten-warm or cool-punch.
    colorPalette1/2 : strict cp1<->cp2; blended in RGB space.

  AUDIO (modulators-only — never read CPC audio globals natively). The block
  below is the STRICT source of truth a generator parses for the deploy playlist.

AUDIO_MODULATION_V1:
  sliderLevel      <- micLow  range 0.30..1.00 curve linear  # overall brightness (PRIMARY)
  sliderKick       <- micKick range 0.00..1.00 curve pow2    # beat pop + vintage W blinders
  sliderRadius     <- micFlux range 0.40..0.90 curve linear  # tunnel speed / arm spread
  sliderContrast   <- micMid  range 0.30..0.85 curve linear  # arm-crispness reshape (secondary)
  sliderWhiteLevel <- micLow  range 0.30..0.80 curve linear  # overall white keep
  sliderWhiteKick  <- micKick range 0.00..1.00 curve pow2    # vintage-head blinder pop
  # STATIC (omit from audio): localSpeed, sliderCount, twistFreq, direction, whiteWarmth, colorPalette1/2

  The vintage heads (sectionId==2) are the headline audience BLINDER: a small
  always-on warm-white keep (whiteLevel) glows tungsten between hits, and on the
  kick the W channel is driven HARD (whiteKick) for the punch. whiteWarmth splits
  the tint amber(A)↔cool/UV(U). The pars (sectionId==1) carry a subtler W flash
  scaled by whiteLevel. White is ADDITIVE over the cp1↔cp2 helix (hueSpread
  stays high). The beat `kick` slider still drives the body pulse; whiteKick is
  the dedicated white pop on top.
*/

// ── Exported controls (UI order = declaration order) ────────────────────────
export var localSpeed = 0.5;   // tunnel travel + spin rate (0 still creeps)
export var radius = 0.5;        // movement RADIUS (audio: micFlux)
export var kick = 0.0;          // brightness KICK (audio: micKick) — transient; steady
                                // lift flattens the beat pulse + dilutes PRIMARY corr.
export var level = 0.5;         // overall brightness PRIMARY (audio: micLow) — mid; swings up
export var count = 0.5;         // armCount selector (identity; scaled in beforeRender)
export var twistFreqN = 0.5;    // twistFreq selector (maps to -10..30)
export var contrast = 0.5;      // arm crispness (identity slider; scaled in beforeRender)
export var direction = 0.5;     // tunnel/spin heading (0.5 = center, guarded in setter)
export var whiteLevel = 0.5;    // WHITE: overall white amount / vintage keep (audio: micLow)
export var whiteKick = 0.3;     // WHITE: kick-driven blinder bite (transient; low static
                                // default so steady white does not wash the hue)
export var whiteWarmth = 0.3;   // WHITE: warm amber(A) <-> cool/UV(U) tint — low keeps the
                                // blinder tungsten-warm by default; UV at 1 cools it

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
export function sliderContrast(v) { contrast = v; }   // store directly; scale in beforeRender
export function sliderDirection(v) {
  var d = (v * 2.0) - 1.0;                       // -1..1
  if (d >= 0.0 && d < 0.06) d = 0.06;            // never sit at exactly 0
  else if (d < 0.0 && d > -0.06) d = -0.06;
  globalDir = d;
}
export function sliderWhiteLevel(v) { whiteLevel = v; }
export function sliderWhiteKick(v) { whiteKick = v; }
export function sliderWhiteWarmth(v) { whiteWarmth = v; }

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
var contrastPow = 5.0;     // resolved arm-crispness power this frame
var whiteKeep = 0.0;       // resolved overall white amount this frame
var whiteBite = 0.0;       // resolved kick-driven blinder bite this frame
var whiteTint = 0.0;       // resolved white tint: 0 warm(A) -> 1 cool/UV(U)

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
  armCount = 1.0 + floor(count * 12.0);        // 1..13 arms (mid 0.5 -> 7)
  twistFreq = -10.0 + twistFreqN * 40.0;       // -10..30 (mid 0.5 -> 10)
  contrastPow = 0.5 + contrast * 9.0;          // arm crispness 0.5..9.5 (mid 0.5 -> 5.0)

  // White controls resolved once per frame (clamped). whiteKeep = always-on
  // amount, whiteBite = kick-driven blinder pop, whiteTint = amber<->UV split.
  whiteKeep = clamp01(whiteLevel);
  whiteBite = clamp01(whiteKick);
  whiteTint = clamp01(whiteWarmth);
}

export function render3D(index, x, y, z) {
  // RIG-AGNOSTIC ROLE: every rig drives the helix from normalized coords. The
  // test_bench sectionId roles (1=pars core, 2=vintage blinder, 3=bars walls) are
  // mapped from Y height when no real sectionId is present (titanic/dome/logsville
  // report sId 0 or rig-specific ids). On test_bench the real sectionId wins, so
  // the original per-section look is preserved exactly; elsewhere `roleSec` is
  // derived from height so the same three behaviours drape the whole ship.
  //   - top band (high y)    -> vintage blinder accent (role 2)
  //   - upper-mid            -> pars beat-pop core (role 1)
  //   - body (lower)         -> bars depth-faded tunnel walls (role 3)
  var roleSec = 3;
  if (sectionId == 1 || sectionId == 2 || sectionId == 3) {
    roleSec = sectionId;                 // test_bench: keep the exact original role
  } else if (y >= 0.80) {
    roleSec = 2;                         // top heads -> vintage blinder accent
  } else if (y >= 0.62) {
    roleSec = 1;                         // upper -> pars beat-pop core
  } else {
    roleSec = 3;                         // body -> bars tunnel walls
  }

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
  v = pow(v, contrastPow);
  var floorv = 0.05;                            // non-black floor: lifts the dark tunnel
                                                // pixels above the visibility threshold so
                                                // the whole rig reads lit (mission-critical),
                                                // while the bright arms keep the contrast.

  var outV = floorv;
  var outW = 0.0;
  var outA = 0.0;
  var outU = 0.0;

  if (roleSec == 3) {
    // BARS — depth-faded helix tunnel walls (fade out toward the axis).
    var dfade = dist * 2.4; if (dfade > 1.0) dfade = 1.0;
    outV = floorv + v * 1.5 * dfade;
  } else if (roleSec == 1) {
    // PARS — beat-pop core + a subtler W flash on the beat, scaled by whiteLevel.
    outV = floorv + v * 0.6;
    if (beatPulse > 0.0 && field > 0.0) {
      outV = max(outV, 0.55 + 0.45 * beatPulse);
      // White flash: overall amount via whiteKeep, extra pop via whiteBite.
      outW = beatPulse * (0.30 + 0.55 * whiteKeep) * (0.6 + 0.7 * whiteBite);
    }
  } else {
    // VINTAGE (roleSec == 2) — headline audience BLINDER. Always-on warm-white
    // keep (whiteKeep) glows tungsten; on the kick whiteBite drives W HARD. The
    // beat pulse (carrying the kick slider) modulates the bite so it slams on
    // the beat. whiteTint splits the white between amber(A) warm and UV(U) cool.
    outV = floorv + v * 0.9;
    var ambW = whiteKeep * (0.20 + 0.30 * v);         // calm warm keep
    var hitW = whiteBite * (0.5 + 0.5 * v) + beatPulse * (0.5 + 0.7 * whiteKeep);
    outW = ambW + hitW;                                // drive W HARD on the kick
    var wmag = clamp01(outW);
    outA = wmag * (1.0 - whiteTint) * 0.6;             // tungsten warmth
    outU = wmag * whiteTint * 0.5;                     // cool / UV bite
  }

  // Colour: cp1<->cp2 blended in RGB space, drifting down the tunnel (√3 ratio).
  var colorBlend = wave(depth * 0.2 + helixPhase * (0.1 / PI2)
                      + driftPhase * 1.7320508);
  var r = pr1 + (pr2 - pr1) * colorBlend;
  var g = pg1 + (pg2 - pg1) * colorBlend;
  var b = pb1 + (pb2 - pb1) * colorBlend;

  // PRIMARY: level is a clean overall gain, applied uniformly (no animation-phase
  // term) so total brightness tracks micLow rather than the spin/beat wobble.
  var gain = 0.25 + 1.25 * level;   // mid default ~0.875; level=1 -> 1.50 push
  outV = clamp01(outV);
  r = clamp01(r * outV * gain);
  g = clamp01(g * outV * gain);
  b = clamp01(b * outV * gain);
  outW = clamp01(outW * gain);
  outA = clamp01(outA * gain);
  outU = clamp01(outU * gain);

  rgbwau(r, g, b, outW, outA, outU);
}
