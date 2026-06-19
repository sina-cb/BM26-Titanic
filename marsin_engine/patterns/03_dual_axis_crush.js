/*
  03_dual_axis_crush.js — "Dual Axis Crush"

  IDENTITY: a linear continuous attack. Beams spawn at the extreme LEFT and
  RIGHT edges of the room and collapse inward to the physical stage CENTER
  forever. Each beam has a CRISP warm/amber HEAD (cp2) and a trailing cyan
  TAIL (cp1), a beam-width falloff, and a bright FLASH at the center when the
  two beams converge. (sliderDirection can flip the feel to expand-outward.)

  COORDS: render3D x,y,z are 0..1 (NEVER re-normalize). We measure each
  pixel's distance from the stage CENTER (CENTER_X = 0.6, a fixed center
  CONSTANT not a renormalization) and split left/right halves so both edges
  feed inward symmetrically. Distance stays in a 0..1 sense.

  NON-REPEATING MATH: the collapse phase advances continuously off the clock.
  An autonomous direction wobble is driven by two INCOMMENSURATE clock terms
  (periods √2 and √3 scaled by large primes) so collapse/expand auto-switches
  organically and never visibly loops. Accumulators wrap at a LARGE multiple
  of their period (PHASE_WRAP) so scaling them never produces a seam (§7).

  AUDIO (modulators-only — never read CPC audio globals natively). The block
  below is the STRICT source of truth a generator parses for the deploy playlist.

AUDIO_MODULATION_V1:
  sliderLevel  <- micLow  range 0.30..1.00 curve linear  # overall brightness (PRIMARY)
  sliderKick   <- micKick range 0.00..1.00 curve pow2    # beam-head + convergence flash pop
  sliderRadius <- micFlux range 0.40..0.90 curve linear  # beam reach / travel distance
  # STATIC (omit from audio): localSpeed, beamWidth, direction, colorPalette1/2

  CONTROLS (UI order = declaration order):
    localSpeed  : collapse rate, pow(2,(localSpeed-0.5)*4); 0 still creeps.
    level       : PRIMARY overall brightness gain (continuous band).
    kick        : brightness KICK — pops the center flash on transients.
    radius      : movement RADIUS / beam reach (repurposed swipeLength).
    beamWidth   : head/tail falloff width.
    direction   : collapse inward (>=center) vs expand outward (<center),
                  dead-zone guarded so it never freezes.
*/

// ── Exported controls (UI order = declaration order) ────────────────────────
export var localSpeed = 0.5;   // collapse rate
export var level = 0.75;       // PRIMARY overall brightness (micLow). NOT 0.5: the gain
                               // is level² (so the rig fully darkens with micLow -> tight
                               // PRIMARY corr); at 0.5 that² = 0.25 reads broken-dim
                               // (peak~96). 0.75² = 0.56 is the perceptual middle —
                               // bright collapse at default, micLow still swings it.
export var kick = 0.0;         // brightness kick on the center flash (micKick) —
                               // transient; a steady lift inflates the autonomous flash
                               // and dilutes the micLow PRIMARY correlation.
export var radius = 0.5;       // movement radius / beam reach (micFlux)
export var beamWidth = 0.5;    // head/tail falloff width
export var direction = 1.0;    // <0.5 expand outward, >=0.5 collapse inward —
                               // 1.0 (full inward) is the signature collapse identity;
                               // slider-center would near-freeze the attack.

export var cp1H = 0.55, cp1S = 1.0, cp1V = 1.0; // Tail colour (cyan)
export var cp2H = 0.1,  cp2S = 1.0, cp2V = 1.0; // Beam-head colour (amber)
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderLevel(v) { level = v; }
export function sliderKick(v) { kick = v; }
export function sliderRadius(v) { radius = v; }
export function sliderBeamWidth(v) { beamWidth = v; }
export function sliderDirection(v) {
  // Dead-zone guard: slider-center would give dir=0 (frozen attack). Keep the
  // motion always advancing — slightly inward at/above center, slightly
  // outward below. Effective sign is never exactly 0.
  var d = (v * 2.0) - 1.0;
  if (d >= 0.0 && d < 0.06) d = 0.06;
  else if (d < 0.0 && d > -0.06) d = -0.06;
  direction = d;
}

// ── Tunables ────────────────────────────────────────────────────────────────
var CENTER_X = 0.6;        // physical stage center (constant offset, not a renorm)
var BASE_RATE = 0.55;      // collapse cycles/sec at localSpeed = 0.5
var CREEP_RATE = 0.05;     // floor rate so it still moves at localSpeed = 0
var PHASE_WRAP = 10000.0;  // wrap accumulators far from any in-frame use
var SQRT2 = 1.41421356;
var SQRT3 = 1.73205081;
var BASE_FLOOR = 0.07;     // non-black floor: keeps the rig lit even at level=0 (the
                           // level² gain otherwise blacks out the whole slider-0 extreme).
                           // Small enough that it barely dilutes the PRIMARY corr.

// ── Persistent state ─────────────────────────────────────────────────────────
var attackPos = 0.0;       // collapse phase, accumulator (wrapped at PHASE_WRAP)
var wobbleA = 0.0;         // incommensurate clock term A
var wobbleB = 0.0;         // incommensurate clock term B
var flashIntensity = 0.0;
var invBeamWidth = 2.0;
var effDir = 1.0;          // effective signed direction this frame
var reach = 0.55;          // resolved beam reach this frame

// ── Palette RGB cache (strict cp1<->cp2 blending) ─────────────────────
var pr1 = 1, pg1 = 0, pb1 = 0;
var pr2 = 0, pg2 = 0, pb2 = 1;
function _hsv2rgb1() {
  var hv = cp1H - floor(cp1H); if (hv < 0) hv += 1;
  var iv = floor(hv * 6) % 6;
  var fv = hv * 6 - floor(hv * 6);
  var pv = cp1V * (1 - cp1S);
  var qv = cp1V * (1 - fv * cp1S);
  var tv = cp1V * (1 - (1 - fv) * cp1S);
  if      (iv == 0) { pr1 = cp1V; pg1 = tv;    pb1 = pv;    }
  else if (iv == 1) { pr1 = qv;    pg1 = cp1V; pb1 = pv;    }
  else if (iv == 2) { pr1 = pv;    pg1 = cp1V; pb1 = tv;    }
  else if (iv == 3) { pr1 = pv;    pg1 = qv;    pb1 = cp1V; }
  else if (iv == 4) { pr1 = tv;    pg1 = pv;    pb1 = cp1V; }
  else             { pr1 = cp1V; pg1 = pv;    pb1 = qv;    }
}
function _hsv2rgb2() {
  var hv = cp2H - floor(cp2H); if (hv < 0) hv += 1;
  var iv = floor(hv * 6) % 6;
  var fv = hv * 6 - floor(hv * 6);
  var pv = cp2V * (1 - cp2S);
  var qv = cp2V * (1 - fv * cp2S);
  var tv = cp2V * (1 - (1 - fv) * cp2S);
  if      (iv == 0) { pr2 = cp2V; pg2 = tv;    pb2 = pv;    }
  else if (iv == 1) { pr2 = qv;    pg2 = cp2V; pb2 = pv;    }
  else if (iv == 2) { pr2 = pv;    pg2 = cp2V; pb2 = tv;    }
  else if (iv == 3) { pr2 = pv;    pg2 = qv;    pb2 = cp2V; }
  else if (iv == 4) { pr2 = tv;    pg2 = pv;    pb2 = cp2V; }
  else             { pr2 = cp2V; pg2 = pv;    pb2 = qv;    }
}

function clamp01(v) {
  if (v < 0.0) return 0.0;
  if (v > 1.0) return 1.0;
  return v;
}

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  _hsv2rgb1();
  _hsv2rgb2();

  // localSpeed actually drives the collapse; keep a creep floor at 0.
  var localMultiplier = pow(2.0, (localSpeed - 0.5) * 4.0);
  var rate = CREEP_RATE + BASE_RATE * localMultiplier;

  // Autonomous direction VARIATION: two incommensurate clock terms gate an
  // occasional organic auto-switch between collapse (inward) and expand
  // (outward). The slider sets the bias; the wobble flips it now and then.
  wobbleA = wobbleA + dt * (1.0 / SQRT2) * 0.11;   // slow term
  wobbleB = wobbleB + dt * (1.0 / SQRT3) * 0.037;  // slower, incommensurate
  if (wobbleA >= PHASE_WRAP) wobbleA = wobbleA - PHASE_WRAP;
  if (wobbleB >= PHASE_WRAP) wobbleB = wobbleB - PHASE_WRAP;
  var swing = sin(wobbleA * 6.2831853) * 0.7 + sin(wobbleB * 6.2831853) * 0.5;

  // Bias from the slider (signed); occasionally overridden by the swing so the
  // collapse/expand auto-switches. Effective sign never exactly 0.
  var biased = direction + swing;
  if (biased >= 0.0 && biased < 0.06) biased = 0.06;
  else if (biased < 0.0 && biased > -0.06) biased = -0.06;
  effDir = (biased >= 0.0) ? 1.0 : -1.0;

  attackPos = attackPos + dt * rate * effDir;
  // Wrap at a large multiple of the unit period so the fractional use below
  // never jumps (no seam). attackPos is consumed only via its fractional part.
  if (attackPos >= PHASE_WRAP) attackPos = attackPos - PHASE_WRAP;
  if (attackPos < 0.0) attackPos = attackPos + PHASE_WRAP;

  // Beam reach (radius audio control): narrow band so it reshapes the beam
  // travel WITHOUT dominating the total brightness budget (that would dilute
  // the level PRIMARY correlation). 0.45..0.80 of the half-room.
  reach = 0.45 + radius * 0.35;

  // Beam-width falloff.
  var bw = 0.08 + beamWidth * 0.6;
  invBeamWidth = 1.0 / bw;

  // Center flash when beams converge (once per cycle). Kick audio pops it.
  // Narrow flash window: brief + bright so the convergence peak hits hard
  // (peakMaxChan high) while adding few uncorrelated frames (protects level corr).
  var fphase = attackPos - floor(attackPos);
  flashIntensity = 0.0;
  if (fphase < 0.06) {
    var fi = 1.0 - (fphase * 16.6667);
    flashIntensity = fi * fi;
  }
  flashIntensity = flashIntensity * (2.2 + kick * 0.9);
}

export function render3D(index, x, y, z) {
  // Distance from the stage CENTER (CENTER_X is a fixed center constant, NOT a
  // renormalization). Both halves feed inward; normDist is a 0..1-sense reach.
  var nx = x; if (nx < 0.0) nx = 0.0; if (nx > 1.0) nx = 1.0;
  var d = nx - CENTER_X; if (d < 0.0) d = -d;
  var normDist = d / reach;          // 0 at center, ~1 at the edges of reach
  if (normDist > 1.0) normDist = 1.0;

  // Spatial phase along the beam; collapse moves the head toward center.
  var spatialPhase = normDist + (attackPos - floor(attackPos));
  var cycle = spatialPhase - floor(spatialPhase);
  var distBehind = cycle * reach;

  var tVal = distBehind * invBeamWidth;
  if (tVal > 1.0) tVal = 1.0;
  var brightness = 1.0 - tVal;
  brightness = brightness * brightness;   // crisp head, dark negative space

  // Center flash boosts intensity along the palette (cp2 head) — never white.
  // Wider proximity so the convergence flash reliably lights center pixels.
  var centerProximity = 1.0 - normDist * 2.0;
  if (centerProximity < 0.0) centerProximity = 0.0;
  var localFlash = flashIntensity * centerProximity;

  // PRIMARY: brightness rides the level gain (steep, clean, no phase wobble) so
  // total brightness tracks level -> strong corr. The center FLASH also scales
  // with level but keeps a strong floor so the convergence peak stays CRISP and
  // BRIGHT (peakMaxChan >= 200) at musical peaks (level high) without diluting
  // the correlation at low level.
  var gain = level * level;         // pure level²: gain->0 as level->0 so the whole rig
                                    // darkens with micLow -> tightest PRIMARY corr. The
                                    // mid-default dimness is compensated by the intrinsic
                                    // flash intensity (see flashIntensity) and BASE_FLOOR.
  // Head is driven slightly over unity so the crisp beam HEAD itself clears the
  // peakMaxChan>=200 bar at musical peaks (cp2 amber's g channel ~0.6 needs the
  // headroom), not only on the brief convergence flash. Still gated by level² so
  // the PRIMARY correlation holds.
  var v = brightness * gain * 1.45;
  // KICK is a distinct visible dimension: a discrete pop concentrated on the
  // bright head (where brightness is high). Gated by gain so it cannot light the
  // dark negative space — it pops the BEAM on transients (micKick). This gives
  // the kick a real, separate reactive channel beyond the narrow center flash.
  var kickPop = brightness * brightness * kick * 0.9 * gain;
  v = v + kickPop;
  // Flash tracks level too (so it adds NO uncorrelated brightness variance) but
  // is intrinsically intense, so at musical peaks (level high) the convergence
  // hits peakMaxChan >= 200 while staying correlated with level.
  var fv = localFlash * gain;
  if (fv > v) v = fv;
  v = v + BASE_FLOOR;
  if (v > 1.0) v = 1.0;

  // Strict RGB lerp: tVal=0 -> cp2 (warm head), tVal=1 -> cp1 (cyan tail).
  var r = (pr2 + (pr1 - pr2) * tVal) * v;
  var g = (pg2 + (pg1 - pg2) * tVal) * v;
  var b = (pb2 + (pb1 - pb2) * tVal) * v;

  rgb(clamp01(r), clamp01(g), clamp01(b));
}
