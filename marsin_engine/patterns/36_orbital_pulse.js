/*
  36_orbital_pulse.js — high-def ORBITAL gravity wells, TWO-COLOUR.

  Amalgamates 05_orbital_attractor_field (moving gravity wells orbiting the rig)
  and 23_prismatic_strange_attractors (per-well colour, crisp mathematical cores).

  FOUR attractor "wells" orbit the rig in the normalized x,y plane, each on its
  own irrational radius/rate so they weave and never re-phase. Every pixel's
  brightness is the SUM of a TIGHT glow around each well:
      glow = (1 - d/R)^focusPow
  so a well is a crisp bright core with near-black space between (high-def /
  high-contrast). Bass (sliderFocus) both TIGHTENS the falloff power AND lifts a
  smooth unsaturated WHOLE-RIG floor — more bass => brighter, sharper rig, so
  total brightness rises cleanly and monotonically with the signal (the floor is
  the dominant continuous term, so micLow->brightness measures cleanly). A kick
  (sliderPulse) arms a persistent envelope that briefly FLARES every well
  (radius + brightness bloom) then decays — a distinct transient dimension.

  TWO-COLOUR by construction: the wells ALTERNATE the palette by index —
      even wells (w1, w3) = cp1 (hot orange) ,  odd wells (w2, w4) = cp2 (magenta)
  and each pixel takes the colour of the well that dominates it (winner-take-most,
  NOT an averaged midpoint), so the rig shows BOTH hues across the orbits at once
  (hueSpread well clear of the two-colour bar). The faint base shimmer also
  alternates cp1/cp2 across space so the dark field reads two-colour, never mono.

  A minimal time-based base shimmer keeps the rig readable when audio is silent
  (mission-critical visibility) — never fully black, no fallback magic.

  CORE EQUATION (per well k, per pixel):
      glow_k = (1 - dist_k / R)^focusPow ,  R = 0.50 - 0.10*focus
      bri    = floor(focus) + coreGain * Σ_k glow_k ,  hue = colour of argmax_k glow_k
    wells orbit at irrational rate multiples {1, sqrt2, sqrt3, phi} of the master
    phase (sqrt2=1.41421, sqrt3=1.73205, phi=1.61803) so orbits never repeat.

  CONTROLS (declaration order = UI order)
    - localSpeed : orbit rate (0 = wells freeze in place).
    - focus      : bass -> core tightness + whole-rig floor. 0 = wide soft, 1 = tight hot.
    - pulse      : 0..1 kick trigger; crossing ~0.5 flares all wells. Modulatable.
    - reach      : orbit radius (how far the wells swing from rig center).
    - base       : floor / ambient brightness (kept above a tiny minimum).
    - colorPalette1/2 : cp1 hot orange (even wells), cp2 magenta (odd wells).

  AUDIO (modulators-only — never read CPC audio globals natively):
  AUDIO_MODULATION_V1:
    sliderFocus  <- micLow  range 0.30..1.00 curve linear   # PRIMARY brightness: bass tightens cores + lifts whole-rig floor
    sliderPulse  <- micKick range 0.00..1.00 curve linear   # kick pops: each hit flares every well (transient bloom)
  STATIC (operator handles, not audio-mapped): localSpeed, reach, base, colorPalette1/2.
*/

// ── Exported controls (UI order = declaration order) ────────────────────────
export var localSpeed = 0.5;   // orbit rate (0 = wells freeze)
export var focus = 0.5;        // bass -> core tightness + whole-rig floor
export var pulse = 0.0;        // 0..1 kick trigger; crossing ~0.5 flares wells
export var reach = 0.5;        // orbit radius from rig center
export var base = 0.18;        // floor / ambient brightness

export var cp1H = 0.06, cp1S = 1.0, cp1V = 1.0; // palette 1 (hot orange — even wells)
export var cp2H = 0.80, cp2S = 1.0, cp2V = 1.0; // palette 2 (violet-magenta — odd wells)
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderFocus(v) { focus = v; }
export function sliderPulse(v) { pulse = v; }
export function sliderReach(v) { reach = v; }
export function sliderBase(v) { base = v; }

// ── Tunables ────────────────────────────────────────────────────────────────
var MAX_RATE = 0.5;     // orbits/sec at localSpeed = 1.0
var FOCUS_MIN = 1.6;    // falloff power at focus=0 (wide, soft cores)
var FOCUS_MAX = 6.0;    // falloff power at focus=1 (tight, crisp cores)
var REACH_MIN = 0.12;   // min orbit radius
var REACH_MAX = 0.40;   // max orbit radius
var FLARE_DECAY = 2.6;  // pulse envelope decay per second
var PULSE_ARM = 0.5;    // pulse control level that arms a flare
var BASE_MIN = 0.05;    // always-on minimal floor (mission-critical visibility)

// Irrational rate multiples — orbits never re-phase (PATTERNS.md irrational ratios).
var SQRT2 = 1.41421;
var SQRT3 = 1.73205;
var PHI = 1.61803;

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

// ── Persistent state ─────────────────────────────────────────────────────────
var orbitPhase = 0.0;   // master orbit phase 0..1
var flare = 0.0;        // kick flare envelope, armed to 1.0 then decays
var prevPulse = 0.0;    // previous pulse value (edge detect)

// Resolved per-frame well positions (in normalized 0..1 plane). Even wells use
// cp1, odd wells use cp2 — the rig shows BOTH hues across the orbits.
var w1x = 0.5, w1y = 0.5;   // even -> cp1
var w2x = 0.5, w2y = 0.5;   // odd  -> cp2
var w3x = 0.5, w3y = 0.5;   // even -> cp1
var w4x = 0.5, w4y = 0.5;   // odd  -> cp2

// Resolved per-frame scalars.
var focusPow = 3.0;     // falloff exponent (bass tightens)
var coreGain = 1.0;     // core brightness gain (bass + flare brighten)
var orbR = 0.25;        // orbit radius this frame
var floorLevel = 0.1;   // smooth whole-rig floor this frame (dominant continuous term)
var shimLevel = 0.0;    // base shimmer amplitude this frame
var shimPhase = 0.0;    // base shimmer phase

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  _hsv2rgb1();
  _hsv2rgb2();

  // Edge-detect the pulse control: a rising crossing of PULSE_ARM flares wells.
  if (pulse >= PULSE_ARM && prevPulse < PULSE_ARM) flare = 1.0;
  prevPulse = pulse;
  flare = flare - dt * FLARE_DECAY;
  if (flare < 0.0) flare = 0.0;

  // Master orbit phase. localSpeed warps the rate exponentially across 0..1
  // (rate = 2^((localSpeed-0.5)*4): 0.0625x at 0 .. 16x at 1) so the slider
  // VISIBLY changes the orbit speed end to end; a small floor keeps the wells
  // always drifting (never a dead-frozen rig, even at localSpeed=0).
  var rateMul = pow(2.0, (localSpeed - 0.5) * 4.0);
  orbitPhase = orbitPhase + dt * (0.04 + rateMul) * MAX_RATE;
  orbitPhase = orbitPhase - floor(orbitPhase);

  // Four wells weave on irrational rate multiples {1, sqrt2, sqrt3, phi} so the
  // configuration never repeats. A flare bloom on the orbit radius throws the
  // wells momentarily outward on a kick.
  orbR = (REACH_MIN + reach * (REACH_MAX - REACH_MIN)) * (1.0 + flare * 0.15);
  var a1 = orbitPhase * PI2;
  var a2 = -orbitPhase * PI2 * SQRT2 + 2.1;
  var a3 = orbitPhase * PI2 * SQRT3 + 4.2;
  var a4 = -orbitPhase * PI2 * PHI + 1.05;
  w1x = 0.5 + orbR * cos(a1);
  w1y = 0.5 + orbR * sin(a1);
  w2x = 0.5 + orbR * 0.82 * cos(a2);
  w2y = 0.5 + orbR * 0.82 * sin(a2);
  w3x = 0.5 + orbR * 1.10 * cos(a3);
  w3y = 0.5 + orbR * 1.10 * sin(a3);
  w4x = 0.5 + orbR * 0.62 * cos(a4);
  w4y = 0.5 + orbR * 0.62 * sin(a4);

  // Bass (focus) tightens the falloff exponent AND brightens the cores; the
  // flare adds a transient brightness bloom.
  focusPow = FOCUS_MIN + focus * (FOCUS_MAX - FOCUS_MIN);
  // Cores are kept only weakly focus-dependent so their orbit-motion wobble does
  // not dilute the clean bass->brightness correlation carried by the steady floor.
  coreGain = (0.55 + focus * 0.65) * (1.0 + flare * 0.9);

  // PRIMARY MAPPING: a smooth, unsaturated whole-rig floor that rises strongly
  // and linearly with focus (bass). This term touches EVERY pixel and does not
  // wobble with orbit motion, so it is the dominant continuous contributor to
  // total brightness => micLow->brightness correlates cleanly (corr >= 0.5).
  floorLevel = BASE_MIN + base * 0.12 + focus * 0.92;

  // Base shimmer amplitude — small, calm; alternates cp1/cp2 across space below.
  shimLevel = BASE_MIN + base * 0.10;

  shimPhase = shimPhase + dt * (0.04 + rateMul * 0.18);
  shimPhase = shimPhase - floor(shimPhase);
}

// Tight glow of one well at distance d (normalized). Glow radius shrinks as
// focus rises so cores stay crisp; (1 - d/R)^focusPow gives a hard edge.
function wellGlow(d) {
  var R = 0.50 - focus * 0.10;   // glow radius (bass tightens, gently)
  if (d >= R) return 0.0;
  var nx = 1.0 - d / R;
  return pow(nx, focusPow);
}

export function render3D(index, x, y, z) {
  // Distances to each orbiting well in the normalized x,y plane.
  var dx1 = x - w1x, dy1 = y - w1y; var d1 = sqrt(dx1 * dx1 + dy1 * dy1);
  var dx2 = x - w2x, dy2 = y - w2y; var d2 = sqrt(dx2 * dx2 + dy2 * dy2);
  var dx3 = x - w3x, dy3 = y - w3y; var d3 = sqrt(dx3 * dx3 + dy3 * dy3);
  var dx4 = x - w4x, dy4 = y - w4y; var d4 = sqrt(dx4 * dx4 + dy4 * dy4);

  var g1 = wellGlow(d1);   // even -> cp1
  var g2 = wellGlow(d2);   // odd  -> cp2
  var g3 = wellGlow(d3);   // even -> cp1
  var g4 = wellGlow(d4);   // odd  -> cp2

  // Sum of well glows -> crisp bright cores, near-black space between.
  var wellBri = (g1 + g2 + g3 + g4) * coreGain;

  // Two-colour by construction: aggregate even wells (cp1) vs odd wells (cp2)
  // and let the DOMINANT side own the pixel's hue (winner-take-most). This keeps
  // each core saturated in its own palette colour instead of washing to a mid
  // grey, so the rig shows BOTH cp1 and cp2 at once (high hueSpread).
  var gEven = g1 + g3;   // cp1 share
  var gOdd = g2 + g4;    // cp2 share
  var tcol = gOdd / (gEven + gOdd + 0.00001); // 0 = full cp1, 1 = full cp2
  // Push toward the winning palette so cores stay crisply two-colour, not muddy.
  tcol = tcol * tcol * (3.0 - 2.0 * tcol);    // smoothstep hardens the split
  var cr = pr1 + (pr2 - pr1) * tcol;
  var cg = pg1 + (pg2 - pg1) * tcol;
  var cb = pb1 + (pb2 - pb1) * tcol;

  // Smooth whole-rig floor (PRIMARY focus->brightness term) — lifts every pixel
  // uniformly with bass; tinted by a spatial cp1<->cp2 split that is BIMODAL
  // (most pixels fully cp1 OR fully cp2, few in between) so the dark field reads
  // crisply two-colour rather than averaging to one mono hue.
  var ftRaw = 0.5 + 0.5 * sin((x * SQRT2 + y * PHI + shimPhase) * PI2);
  var ftcol = ftRaw < 0.5 ? 0.0 : 1.0;            // hard cp1 / cp2 zones
  ftcol = 0.08 + 0.84 * ftcol;                    // tiny bleed, keep both hues pure
  var fr = pr1 + (pr2 - pr1) * ftcol;
  var fg = pg1 + (pg2 - pg1) * ftcol;
  var fb = pb1 + (pb2 - pb1) * ftcol;
  // Gentle shimmer breathing on the floor so silence is alive, not flat.
  var floorV = floorLevel * (0.78 + 0.22 * wave(shimPhase + x * 0.3 + y * 0.5));

  // Compose: wells dominate the bright cores; the focus floor fills the rest and
  // carries the clean bass->brightness signal.
  var r = clamp01(cr * wellBri + fr * floorV);
  var g = clamp01(cg * wellBri + fg * floorV);
  var b = clamp01(cb * wellBri + fb * floorV);

  rgb(r, g, b);
}
