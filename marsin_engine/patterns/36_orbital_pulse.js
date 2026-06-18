/*
  36_orbital_pulse.js — high-def ORBITAL gravity wells.

  Amalgamates 05_orbital_attractor_field (moving gravity wells orbiting the rig)
  and 23_prismatic_strange_attractors (per-well colour, crisp mathematical cores).

  THREE attractor "wells" orbit the rig in the normalized x,y plane, each on its
  own radius/rate so they weave. Every pixel's brightness is the SUM of a TIGHT
  glow around each well: glow = (1 - d/reach)^focusPow, so a well is a crisp bright
  core with TRUE-BLACK space between (high-def / high-contrast). Bass (sliderFocus)
  both TIGHTENS the falloff power AND BRIGHTENS the cores — more bass => brighter,
  sharper wells, so total brightness rises with the signal (measurable reactivity).
  A kick (sliderPulse) arms a persistent envelope that briefly FLARES every well
  (radius + brightness bloom) then decays.

  Colour: each well owns a hue (cp1 hot orange, cp2 magenta, + a midpoint), and the
  per-pixel hue is the influence-weighted blend of the contributing wells, so the
  core nearest a well takes that well's colour.

  A minimal time-based base shimmer keeps the rig readable when audio is silent
  (mission-critical visibility) — never fully black, no fallback magic.

  CONTROLS (declaration order = UI order)
    - localSpeed : orbit rate (0 = wells freeze in place).
    - focus      : bass -> core tightness + brightness. 0 = wide soft, 1 = tight hot.
    - pulse      : 0..1 kick trigger; crossing ~0.5 flares all wells. Modulatable.
    - reach      : orbit radius (how far the wells swing from rig center).
    - base       : floor / ambient brightness (kept above a tiny minimum).
    - colorPalette1/2 : cp1 hot orange (well 1), cp2 magenta (well 3); well 2 mid.

  AUDIO (modulators-only — never read CPC audio globals natively):
      MODULATE sliderFocus (focus) <- micLow
      MODULATE sliderPulse (pulse) <- micKick
*/

// ── Exported controls (UI order = declaration order) ────────────────────────
export var localSpeed = 0.5;   // orbit rate (0 = wells freeze)
export var focus = 0.5;        // bass -> core tightness + brightness
export var pulse = 0.0;        // 0..1 kick trigger; crossing ~0.5 flares wells
export var reach = 0.5;        // orbit radius from rig center
export var base = 0.18;        // floor / ambient brightness

export var cp1H = 0.06, cp1S = 1.0, cp1V = 1.0; // palette 1 (hot orange — well 1)
export var cp2H = 0.88, cp2S = 1.0, cp2V = 1.0; // palette 2 (magenta — well 3)
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

// Resolved per-frame well positions (in normalized 0..1 plane).
var w1x = 0.5, w1y = 0.5;
var w2x = 0.5, w2y = 0.5;
var w3x = 0.5, w3y = 0.5;
// Mid-well colour (blend of cp1/cp2) for well 2.
var prM = 0.5, pgM = 0.0, pbM = 0.5;
// Resolved per-frame scalars.
var focusPow = 3.0;     // falloff exponent (bass tightens)
var coreGain = 1.0;     // core brightness gain (bass + flare brighten)
var orbR = 0.25;        // orbit radius this frame
var baseLevel = 0.1;    // resolved base floor this frame
var shimPhase = 0.0;    // base shimmer phase

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  _hsv2rgb1();
  _hsv2rgb2();
  // Mid well colour = midpoint of cp1/cp2 in RGB space.
  prM = (pr1 + pr2) * 0.5;
  pgM = (pg1 + pg2) * 0.5;
  pbM = (pb1 + pb2) * 0.5;

  // Edge-detect the pulse control: a rising crossing of PULSE_ARM flares wells.
  if (pulse >= PULSE_ARM && prevPulse < PULSE_ARM) flare = 1.0;
  prevPulse = pulse;
  flare = flare - dt * FLARE_DECAY;
  if (flare < 0.0) flare = 0.0;

  // Master orbit phase.
  orbitPhase = orbitPhase + dt * localSpeed * MAX_RATE;
  orbitPhase = orbitPhase - floor(orbitPhase);

  // Three wells weave on different rates (radians via * PI2) + a flare bloom on
  // the orbit radius so a kick momentarily throws the wells outward.
  orbR = (REACH_MIN + reach * (REACH_MAX - REACH_MIN)) * (1.0 + flare * 0.15);
  var a1 = orbitPhase * PI2;
  var a2 = -orbitPhase * PI2 * 1.7 + 2.1;
  var a3 = orbitPhase * PI2 * 0.6 + 4.2;
  w1x = 0.5 + orbR * cos(a1);
  w1y = 0.5 + orbR * sin(a1);
  w2x = 0.5 + orbR * 0.78 * cos(a2);
  w2y = 0.5 + orbR * 0.78 * sin(a2);
  w3x = 0.5 + orbR * 1.12 * cos(a3);
  w3y = 0.5 + orbR * 1.12 * sin(a3);

  // Bass (focus) tightens the falloff exponent AND brightens the cores; the
  // flare adds a transient brightness bloom. The core-gain ramp is strong enough
  // that the brightening dominates the slight area-loss from tightening, so total
  // brightness rises monotonically with focus => micLow->focus is REACTIVE.
  focusPow = FOCUS_MIN + focus * (FOCUS_MAX - FOCUS_MIN);
  coreGain = (0.35 + focus * 1.4) * (1.0 + flare * 0.9);

  // Base floor: always above a tiny minimum so the rig never goes fully dark.
  // It ALSO rises with focus (bass) — an unsaturated whole-rig glow that lifts
  // every pixel linearly, so total brightness tracks micLow cleanly (REACTIVE)
  // without depending on already-saturated core pixels.
  baseLevel = BASE_MIN + base * 0.20 + focus * 0.42;

  shimPhase = shimPhase + dt * (0.04 + localSpeed * 0.18);
  shimPhase = shimPhase - floor(shimPhase);
}

// Tight glow of one well at distance d (normalized). reach radius shrinks as
// focus rises so cores stay crisp; (1 - d/R)^focusPow gives a hard edge.
function wellGlow(d) {
  var R = 0.50 - focus * 0.10;   // glow radius (bass tightens, gently)
  if (d >= R) return 0.0;
  var n = 1.0 - d / R;
  return pow(n, focusPow);
}

export function render3D(index, x, y, z) {
  // Distances to each orbiting well in the normalized x,y plane.
  var dx1 = x - w1x, dy1 = y - w1y; var d1 = sqrt(dx1 * dx1 + dy1 * dy1);
  var dx2 = x - w2x, dy2 = y - w2y; var d2 = sqrt(dx2 * dx2 + dy2 * dy2);
  var dx3 = x - w3x, dy3 = y - w3y; var d3 = sqrt(dx3 * dx3 + dy3 * dy3);

  var g1 = wellGlow(d1);
  var g2 = wellGlow(d2);
  var g3 = wellGlow(d3);

  // Sum of well glows -> crisp bright cores, true-black space between.
  var wellBri = (g1 + g2 + g3) * coreGain;

  // Influence-weighted hue: blend each well's RGB by its glow share.
  var wsum = g1 + g2 + g3 + 0.00001;
  var cr = (pr1 * g1 + prM * g2 + pr2 * g3) / wsum;
  var cg = (pg1 * g1 + pgM * g2 + pg2 * g3) / wsum;
  var cb = (pb1 * g1 + pbM * g2 + pb2 * g3) / wsum;

  // Minimal time-based base shimmer (calm, cool-leaning) so silence still reads.
  var shim = baseLevel * (0.6 + 0.4 * wave(shimPhase + x * 0.3 + y * 0.5));
  var br = (pr1 + pr2) * 0.5;
  var bg = (pg1 + pg2) * 0.5;
  var bb = (pb1 + pb2) * 0.5;

  // Compose: wells dominate; base shows in the dark space between them.
  var r = clamp01(cr * wellBri + br * shim);
  var g = clamp01(cg * wellBri + bg * shim);
  var b = clamp01(cb * wellBri + bb * shim);

  rgb(r, g, b);
}
