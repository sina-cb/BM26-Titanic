/*
  130_spatial_paint.js — "Spatial Paint"

  IDENTITY: a soft, moving POOL of the operator's colour that follows a point
  the operator touches in the ship's top-down plane. Drag the point and the
  light travels with it; lift and it keeps breathing where it was left. Away
  from the pool the rig stays on a dim wash of the second colour, so the ship
  never goes dark and the pool always reads as a deliberate highlight.

  WHY THIS PATTERN EXISTS: the engine exposes NO positional parameter. Its
  spatial concept is view/group masks, not Cartesian space, so a touch surface
  that wants to say "light HERE" has nowhere to put the coordinate. Rather than
  add engine-wide params for one surface, the target rides this pattern's own
  LOCAL sliders (§3.2) — the same trick 128/129 use for their extra colours.
  Nothing else in the engine changes and no other pattern is touched.

  THE COORDINATE CONTRACT (read this before changing anything):
    targetX / targetY arrive in WORLD normalized space — targetX is nx, targetY
    is nz. They are NOT screen coordinates and NOT the sim's 2D pixel-map
    layout. The CLIENT owns the rectification: models/titanic.js has a MEASURED
    25% dead band on nx (0.40..0.65 holds zero pixels) and the hull runs
    diagonally through the nx/nz plane, so a raw screen-aligned pad would be
    ~74% dead. The touch surface therefore draws the operator's compressed
    top-down map and converts back to world before writing here. This pattern
    deliberately does the SIMPLE, honest thing — straight world-space distance
    — because a pattern that tried to second-guess the layout would fight the
    map the operator can actually see.

  NEVER DEAD-BLACK (§0 rule 4, and the mission — the ship must read at night):
    the wash floor is non-zero, so an operator who parks the pool in a corner
    still leaves the rest of the ship visible.

  MOTION (§0 rules 1, 2, 5 — never static, never re-locking):
    the pool BREATHES on its own clock at localSpeed, and its radius wobbles on
    a second incommensurate clock (PHI), so even a stationary finger leaves the
    rig alive. There is no travel direction to guard here — the operator's
    finger IS the direction — so rule 5 is satisfied by the autonomous breath
    rather than by a sign guard.

AUDIO_MODULATION_V1:
  sliderLevel   <- micLow  range 0.30..1.00 curve linear  # pool brightness (PRIMARY)
  sliderKick    <- micKick range 0.00..1.00 curve pow2    # pool punch on the beat
  sliderRadius  <- micFlux range 0.25..0.85 curve linear  # pool size breathes with the mix
  sliderGlow    <- micHigh range 0.10..0.55 curve linear  # background wash level
  # STATIC (omit from audio): localSpeed, targetX, targetY, touch, pulse,
  # hue3, hue4, hue5, val3, val4, val5,
  # colorPalette1/2 — the operator's touch position and the touch envelope must
  # NEVER be moved by the music; the finger is the only thing that drives them.
*/

// ── Exported controls (UI order = declaration order) ─────────────────────────
export var localSpeed = 0.5;   // FIRST control (§0 rule 1) — breath rate
export var level = 1.0;        // pool brightness gain (PRIMARY audio target)
export var kick = 0.0;         // beat punch. Defaults 0 so it is pure headroom
export var radius = 0.45;      // pool size
export var glow = 0.30;        // background wash so the ship is never dark
export var targetX = 0.5;      // WORLD nx of the pool centre (client-rectified)
export var targetY = 0.5;      // WORLD nz of the pool centre (client-rectified)
export var hue3 = 0.33;        // COLOUR 3 hue (this pattern's own palette entry)
export var hue4 = 0.55;        // COLOUR 4 hue
export var hue5 = 0.80;        // COLOUR 5 hue
export var val3 = 1.0;         // COLOUR 3 brightness (its own, not colour 1's)
export var val4 = 1.0;         // COLOUR 4 brightness
export var val5 = 1.0;         // COLOUR 5 brightness
export var touch = 0.0;        // 1 while the operator's finger is DOWN, else 0
export var pulse = 0.6;        // how hard the touched area flares

// ── DRAWING: A LINGERING TRAIL, AND WHAT IT DOES ────────────────────────────
//
// The operator asked to DRAW on the pad and have the light linger behind the
// finger, with the stroke driving several different behaviours.
//
// WHY THE TRAIL LIVES HERE AND NOT IN THE CLIENT: the surface can only send a
// handful of scalars (this pattern's local sliders), so a PATH of points does
// not fit on the wire and would not scale with stroke length. Instead every
// pixel remembers its own HEAT: a pixel the finger passes over is stamped to
// 1, and every frame all heat decays. That reproduces a stroke exactly, costs
// one array slot per pixel, needs no history, and is O(pixels) — the same work
// the render already does. Top-level `array()`s retain their values across
// frames (lang spec §7), which is what makes this possible at all.
//
// HEAT_MAX is a fixed allocation because array() needs a compile-time size.
// 2048 is comfortably above the titanic's 964 pixels; an index beyond it is
// simply not trailed rather than corrupting memory (guarded in render3D).
var HEAT_MAX = 2048;
var heat = array(HEAT_MAX);

export var drawMode = 0.0;     // 0 POOL · 1 TRAIL · 2 ERASE · 3 IGNITE
export var trailFade = 2.0 / 7.0; // 0.1..1.5 s; default 0.5 s

// Trail energy, measured LAST frame and read THIS frame. Accumulated during
// render3D (where every pixel is already being visited) rather than in a
// second loop over the array.
var trailEnergy = 0.0;
var energyAcc = 0.0;
var energySeen = 0.0;
var heatFadeStep = 0.0;        // linear heat removed per frame

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderLevel(v) { level = v; }
export function sliderKick(v) { kick = v; }
export function sliderRadius(v) { radius = v; }
export function sliderGlow(v) { glow = v; }
// The two that make this pattern what it is. Named targetX/targetY rather than
// x/y because MarsinScript reserves single letters for builtin slots (§7.3).
export function sliderTargetX(v) { targetX = v; }
export function sliderTargetY(v) { targetY = v; }
// The finger itself. The client writes 1 on touch/move and 0 on release, so the
// pattern knows the difference between "parked here" and "being touched right
// now" — which is what makes the lights PULSE under the finger rather than just
// sit lit.
export function sliderHue3(v) { hue3 = v; }
export function sliderHue4(v) { hue4 = v; }
export function sliderHue5(v) { hue5 = v; }
export function sliderVal3(v) { val3 = v; }
export function sliderVal4(v) { val4 = v; }
export function sliderVal5(v) { val5 = v; }
export function sliderTouch(v) { touch = v; }
export function sliderPulse(v) { pulse = v; }
// Sliders arrive 0..1, so the four draw behaviours are spread across that
// range rather than sent as a raw index — the surface has no way to send a 3.
//   0.00-0.16 POOL · 0.17-0.49 TRAIL · 0.50-0.83 ERASE · 0.84-1.00 IGNITE
export function sliderDrawMode(v) { drawMode = clamp(v, 0.0, 1.0) * 3.0; }
export function sliderTrailFade(v) { trailFade = v; }

// ── Global palette pickers (§3.1) ────────────────────────────────────────────
export var cp1H = 0.08, cp1S = 1.0, cp1V = 1.0;   // the POOL colour
export var cp2H = 0.58, cp2S = 1.0, cp2V = 1.0;   // the WASH colour
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

// ── Constants ────────────────────────────────────────────────────────────────
var BASE_RATE  = 0.05;    // breath rate at localSpeed = 0 (never dead-static)
var SPAN_RATE  = 0.30;    // additional breath rate at localSpeed = 1
var WOBBLE_RATE = 0.037;  // independent radius-wobble clock
var PHASE_WRAP = 1024.0;  // wrap at a LARGE multiple so no fractional jump
var PHI = 1.6180339887;

// Pool radius bounds, in the model's NORMALIZED space (nx/nz, 0..1).
//
// R_SPAN is set so the pool reaches EVERY pixel at full radius.
//
// MEASURED EXHAUSTIVELY on titanic (all 964x964 pairs, no sampling — two
// earlier SAMPLED estimates were both wrong): the farthest pixel pair is
// **1.3230** apart, Left Small SmokeStack (0.04,0.92) to Right Small
// SmokeStack (1.00,0.00). The original max radius of 0.75 could not reach a
// fifth of the rig from mid-ship at ANY radius — that is what "not all the
// lights are being affected" was.
//
// 0.22 + 1.30 = 1.52 clears the 1.3230 worst case with headroom, verified to
// give 964/964 coverage from EVERY pixel. Low radius still gives a tight spot,
// so the range now spans "one fixture" to "the whole ship".
/* Keep the full-radius MINIMUM above the measured 1.323 diagonal even at the
   wobble trough: (0.22 + 1.30) * 0.88 = 1.3376. The prior 1.2496 contradicted
   the coverage claim, and the default centre/radius could miss every Titanic
   pixel because the model has a real centre dead band. */
var R_MIN = 0.22;
var R_SPAN = 1.30;

var breathPhase = 0.0;
var wobblePhase = 0.0;
// Touch envelope: snaps UP the instant the finger lands, and decays after it
// lifts, so passing over an area leaves a flare that fades instead of a hard
// on/off edge. Attack is much faster than release — that asymmetry is what
// reads as a PULSE rather than a fade-in.
var touchEnv = 0.0;
var pulsePhase = 0.0;
var ATTACK_PER_S  = 14.0;   // ~70 ms to full
var RELEASE_PER_S = 2.2;    // ~450 ms to fade out
var PULSE_HZ = 3.2;         // throb rate while held

// Scratch outputs for the converter (MarsinScript has no multi-return).
var cr = 0, cg = 0, cb = 0;
function _hsv2rgb(hIn, sIn, vIn) {
  var hv = hIn - floor(hIn); if (hv < 0) hv += 1;
  var iv = floor(hv * 6) % 6;
  var fv = hv * 6 - floor(hv * 6);
  var pv = vIn * (1 - sIn);
  var qv = vIn * (1 - fv * sIn);
  var tv = vIn * (1 - (1 - fv) * sIn);
  if      (iv == 0) { cr = vIn; cg = tv;  cb = pv;  }
  else if (iv == 1) { cr = qv;  cg = vIn; cb = pv;  }
  else if (iv == 2) { cr = pv;  cg = vIn; cb = tv;  }
  else if (iv == 3) { cr = pv;  cg = qv;  cb = vIn; }
  else if (iv == 4) { cr = tv;  cg = pv;  cb = vIn; }
  else              { cr = vIn; cg = pv;  cb = qv;  }
}

// Cached palette RGB — all FIVE, converted ONCE per frame, never per pixel.
// Locals use the *v suffix / digit suffix because MarsinScript reserves the
// single letters h/i/f/p/q/t/r/g/b for builtin slots (§7.3).
var pr0 = 1, pg0 = 0, pb0 = 0;
var pr1 = 0, pg1 = 1, pb1 = 0;
var pr2 = 0, pg2 = 0, pb2 = 1;
var pr3 = 1, pg3 = 1, pb3 = 0;
var pr4 = 1, pg4 = 0, pb4 = 1;

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;   // clamp a stalled frame so the pool never jumps
  var rate = BASE_RATE + clamp(localSpeed, 0.0, 1.0) * SPAN_RATE;
  breathPhase = breathPhase + dt * rate;
  if (breathPhase > PHASE_WRAP) breathPhase = breathPhase - PHASE_WRAP;
  wobblePhase = wobblePhase + dt * WOBBLE_RATE * PHI;
  if (wobblePhase > PHASE_WRAP) wobblePhase = wobblePhase - PHASE_WRAP;

  // Envelope toward the finger state. Rate-based (not a fixed per-frame step)
  // so it behaves identically at any frame rate.
  // NOTE the name: `envRate`, NOT `rate` — `rate` is already the breath rate a
  // few lines up, and reusing it worked only by accident of ordering.
  var want = clamp(touch, 0.0, 1.0);
  var envRate = want > touchEnv ? ATTACK_PER_S : RELEASE_PER_S;
  touchEnv = touchEnv + (want - touchEnv) * clamp(dt * envRate, 0.0, 1.0);
  pulsePhase = pulsePhase + dt * PULSE_HZ;
  if (pulsePhase > PHASE_WRAP) pulsePhase = pulsePhase - PHASE_WRAP;

  // ── TRAIL BOOKKEEPING ─────────────────────────────────────────────────────
  // Direct wall-clock time-to-zero: 0 -> 0.1 s, 1 -> 1.5 s. Subtracting the
  // elapsed fraction makes the displayed durations exact at every frame rate.
  var fadeSeconds = 0.1 + clamp(trailFade, 0.0, 1.0) * 1.4;
  heatFadeStep = dt / fadeSeconds;

  // Roll last frame's accumulation into the value render3D reads, then reset.
  // IGNITE uses this to raise the WHOLE ship with the stroke and let it fall as
  // the stroke cools, which is impossible to know per-pixel.
  if (energySeen > 0.0) trailEnergy = energyAcc / energySeen;
  else trailEnergy = 0.0;
  energyAcc = 0.0;
  energySeen = 0.0;

  // STRICT PALETTE COMPLIANCE (§7): a pixel wears the pool colour or the wash
  // colour — the pattern NEVER interpolates between the two HUES, because that
  // walks the colour wheel through hues the operator never picked. Only
  // BRIGHTNESS crossfades between them.
  // All FIVE. Colours 1-2 carry full HSV from the engine's own pickers;
  // colours 3-5 are this pattern's local palette and take cp1's SATURATION
  // (so the set reads as one family) but carry their OWN brightness via
  // val3/4/5 — exactly the convention 128/129 use.
  _hsv2rgb(cp1H, cp1S, cp1V);                    pr0 = cr; pg0 = cg; pb0 = cb;
  _hsv2rgb(cp2H, cp2S, cp2V);                    pr1 = cr; pg1 = cg; pb1 = cb;
  _hsv2rgb(hue3, cp1S, clamp(val3, 0.0, 1.0));   pr2 = cr; pg2 = cg; pb2 = cb;
  _hsv2rgb(hue4, cp1S, clamp(val4, 0.0, 1.0));   pr3 = cr; pg3 = cg; pb3 = cb;
  _hsv2rgb(hue5, cp1S, clamp(val5, 0.0, 1.0));   pr4 = cr; pg4 = cg; pb4 = cb;
}

export function render3D(index, x, y, z) {
  var nx = clamp(x, 0.0, 1.0);
  var nz = clamp(z, 0.0, 1.0);

  // ── Distance from this pixel to the operator's point, in the top-down
  //    plane. Height (ny) is deliberately IGNORED: the operator is aiming at a
  //    place on the ship, not at an altitude, and including height would make
  //    a deck light and the rail above it respond differently to the same
  //    touch — which reads as the pad being broken.
  var dx = nx - clamp(targetX, 0.0, 1.0);
  var dz = nz - clamp(targetY, 0.0, 1.0);
  // SQUARED distance, compared against a squared radius — no sqrt().
  // Measured: with sqrt() the pool never lit AT ANY RADIUS (max byte 7 with the
  // target dead centre and radius 1.0, while the wash rendered fine at 84), so
  // the pool test was always false. Comparing squares avoids the call
  // entirely, is cheaper per pixel, and gives a slightly rounder falloff.
  var d2 = dx * dx + dz * dz;

  // ── Pool radius: operator size, breathing on its own clock so a parked
  //    finger still leaves the rig alive (§0 rule 2).
  var wob = 0.88 + 0.12 * wave(wobblePhase);
  var rad = (R_MIN + clamp(radius, 0.0, 1.0) * R_SPAN) * wob;

  // Soft-edged falloff: 1 at the centre, 0 at the rim. Squared so the core
  // reads crisp against genuinely dark negative space (§0 rule 3) rather than
  // smearing the whole hull into a haze.
  // `falloff`, not `t`: MarsinScript reserves the single letters
  // h/i/f/p/q/t/r/g/b for builtin slots and rejects them as declarations
  // (§7.3) — the compiler catches it as "Cannot declare reserved name 't'".
  var r2 = rad * rad;
  var pool = 0.0;
  if (d2 < r2) {
    var falloff = 1.0 - (d2 / r2);
    pool = falloff * falloff;
  }

  // Breath: the pool stays alive even when nothing is moving.
  var breath = 0.82 + 0.18 * wave(breathPhase);
  pool = pool * breath;

  // ── THE PULSE UNDER THE FINGER ──────────────────────────────────────────
  // While the finger is down the pool THROBS and is driven far brighter; when
  // it lifts, the envelope decays and the area settles back to the wash. So the
  // lights the operator passes over pulse in the chosen colour, and only there
  // — everywhere outside the pool radius `pool` is already 0, so the flare
  // cannot leak onto the rest of the ship.
  var throb = 0.55 + 0.45 * wave(pulsePhase);
  var flare = 1.0 + clamp(pulse, 0.0, 1.0) * 2.2 * touchEnv * throb;
  pool = clamp(pool * flare, 0.0, 1.0);

  // Kick is pure audio headroom on top of the pool, never on the wash — a
  // beat should punch the highlight, not flash the whole ship.
  pool = clamp(pool * (1.0 + clamp(kick, 0.0, 1.0) * 0.9), 0.0, 1.0);
  pool = pool * clamp(level, 0.0, 1.0);

  // ── THE STROKE ────────────────────────────────────────────────────────────
  // Decay first, then stamp, so a pixel under the finger is always full even on
  // the frame it is painted. `raw` is the geometric pool BEFORE the flare and
  // level gain, so the stroke has the shape of the brush rather than of the
  // audio.
  var myHeat = 0.0;
  if (index >= 0 && index < HEAT_MAX) {
    myHeat = max(0.0, heat[index] - heatFadeStep);
    // Only a finger that is DOWN paints. Lifting leaves the stroke to cool
    // rather than erasing it — that is what "lingering" means.
    if (touch > 0.5 && d2 < r2) {
      var stamp = 1.0 - (d2 / r2);
      if (stamp > myHeat) myHeat = stamp;
    }
    heat[index] = myHeat;
    energyAcc = energyAcc + myHeat;
    energySeen = energySeen + 1.0;
  }

  // Background wash. NON-ZERO floor: the mission is that the ship reads at
  // night, so parking the pool in one corner must not black out the rest.
  /* The parked background must remain visibly alive even when the pool centre
     sits in the model's dead band. Previously only `pool` breathed; when no
     pixel intersected it the entire real Live channel was byte-static. */
  var washBreath = 0.88 + 0.12 * wave(breathPhase * 0.618 + 0.17);
  var wash = (0.03 + clamp(glow, 0.0, 1.0) * 0.30) * washBreath;

  // ── WHAT THE STROKE DOES ──────────────────────────────────────────────────
  // Mode 0 POOL is the ORIGINAL behaviour, untouched and still the default, so
  // an operator who never opens the mode control sees exactly what they had.
  var dmode = clamp(drawMode, 0.0, 3.0);
  if (dmode >= 0.5 && dmode < 1.5) {
    // TRAIL — the stroke lingers behind the finger in the chosen colour. The
    // live pool still reads brightest because it is stamped at 1 each frame.
    if (myHeat > pool) pool = myHeat;
  } else if (dmode >= 1.5 && dmode < 2.5) {
    // ERASE — drawing takes light AWAY. The stroke cuts a dark path through the
    // wash and heals as it cools. Floored, not zeroed: even an erase must not
    // punch a permanently black hole in a ship whose job is to be seen, so the
    // darkest a stroke can drive a pixel is a quarter of the wash.
    pool = 0.0;
    wash = wash * (1.0 - 0.75 * myHeat);
  } else if (dmode >= 2.5) {
    // IGNITE — the whole ship comes up with the stroke and falls as it cools.
    // Driven by the AVERAGE heat over the rig, so one dab lifts everything a
    // little and a long scribble lifts it a lot; when the trail dies the ship
    // settles back to the wash on its own.
    var ign = clamp(trailEnergy * 6.0, 0.0, 1.0);
    if (myHeat > pool) pool = myHeat;
    if (ign > pool) pool = ign;
  }

  // ── WHICH OF THE FIVE COLOURS DOES THIS PIXEL WEAR? ─────────────────────
  // By `sectionId`, NOT by an axis. That is the rule this ship forces: its
  // named areas do not separate along nx/ny/nz (the hull runs diagonally and
  // nx 0.40..0.65 is empty), which is exactly why 129_five_colour_stations
  // branches on sectionId too. Every section keeps ONE colour, so all five are
  // on the rig at once and dragging over an area pulses it in ITS OWN colour.
  var zone = sectionId % 5;
  if (zone < 0) zone = zone + 5;
  var zr = pr0; var zg = pg0; var zb = pb0;
  if      (zone == 1) { zr = pr1; zg = pg1; zb = pb1; }
  else if (zone == 2) { zr = pr2; zg = pg2; zb = pb2; }
  else if (zone == 3) { zr = pr3; zg = pg3; zb = pb3; }
  else if (zone == 4) { zr = pr4; zg = pg4; zb = pb4; }

  // STRICT PALETTE COMPLIANCE (§7): a pixel only ever wears ONE of the five
  // colours the operator chose — the pattern never interpolates between two
  // HUES, which would walk the wheel through colours nobody picked. Only
  // BRIGHTNESS varies: dim at wash level, full under the finger.
  var bri = wash + (1.0 - wash) * pool;
  var rOut = zr * bri;
  var gOut = zg * bri;
  var bOut = zb * bri;

  rgb(clamp(rOut, 0.0, 1.0), clamp(gOut, 0.0, 1.0), clamp(bOut, 0.0, 1.0));
}
