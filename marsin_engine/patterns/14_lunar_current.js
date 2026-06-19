/*
  14_lunar_current.js
  HD Lunar Current — wide, smooth moonlit currents drifting through the rig with
  caustic shimmer and a UV/white crown on the upper heads. Strict cp1<->cp2 in
  RGB space. cp1 = the cool current body, cp2 = the brighter caustic accent.

  Identity kept: broad longitudinal current + cross caustic, an upper crown
  glow, optional W/UV lift. Now HD, audio-reactive, with a slowly self-reversing
  current and a level/kick/radius audio surface, and NO coord re-normalization
  (the old (x+1.264)/3.125 rendered patterns black — coords are already 0..1).

  CORE NON-REPEATING MATH (skill 12 §3/§7):
    Two drift accumulators advance in the irrational ratio √3 (1.73205) and the
    caustic sample frequency is density*φ, so the current never re-locks. A third
    shimmer phase uses √2. Phases accumulate against a large PHASE_WRAP to avoid
    wrapped-then-scaled seams.

  SPEED / DIRECTION:
    localSpeed scales drift via rate = pow(2,(localSpeed-0.5)*4) (creeps at 0,
    ~4x at 1). `direction` (guarded off center) sets the current's travel; an
    autonomous incommensurate clock (~83s) occasionally reverses it on its own,
    like a tide turning.

  AUDIO (modulators-only — never read CPC audio globals natively):
  AUDIO_MODULATION_V1:
    sliderLevel   <- micLow  range 0.30..1.00 curve linear  # PRIMARY overall brightness (bass)
    sliderKick    <- micKick range 0.00..1.00 curve pow2    # caustic-crest brightness pop
    sliderRadius  <- micFlux range 0.40..0.90 curve linear  # current swell / caustic reach
    sliderShimmer <- micMid  range 0.30..0.85 curve linear  # caustic shimmer detail (mids -> geometry)
  # static (unmapped): direction, density, whiteLift, uvLift, palette pickers
*/

// ── Exported controls (UI order = declaration order) ─────────────────────────
export var localSpeed = 0.5;   // master motion rate
export var direction = 0.5;    // current travel direction (0.5 = guarded center)
export var level = 1.0;        // AUDIO: overall brightness (PRIMARY)
export var kick = 0.0;         // AUDIO: caustic-crest brightness pop
export var radius = 0.5;       // AUDIO: current swell / caustic reach
export var shimmer = 0.5;      // AUDIO: caustic shimmer detail
export var density = 0.5;      // current spatial frequency
export var whiteLift = 0.5;    // upper-crown white emitter
export var uvLift = 0.5;       // upper-crown UV emitter

export var cp1H = 0.68, cp1S = 0.95, cp1V = 1.0; // Current colour (deep indigo)
export var cp2H = 0.41, cp2S = 1.00, cp2V = 1.0; // Caustic accent (sea-green)
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderDirection(v) { direction = v; }
export function sliderLevel(v) { level = v; }
export function sliderKick(v) { kick = v; }
export function sliderRadius(v) { radius = v; }
export function sliderShimmer(v) { shimmer = v; }
export function sliderDensity(v) { density = v; }
export function sliderWhiteLift(v) { whiteLift = v; }
export function sliderUvLift(v) { uvLift = v; }

// ── Tunables ─────────────────────────────────────────────────────────────────
var MAX_RATE = 0.4;          // base current drift turns/sec at localSpeed = 1.0
var PHASE_WRAP = 10000.0;
var AUTO_PERIOD = 83.0;
var BASE_FLOOR = 0.05;       // small non-black floor (moonlit base glow)

// ── Palette RGB cache (verbatim from 27_swipe) ───────────────────────────────
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

// ── Persistent state ─────────────────────────────────────────────────────────
var driftA = 0.0;     // longitudinal current drift (direction-aware)
var driftB = 0.0;     // cross caustic drift (direction-aware)
var shimmerPhase = 0.0;
var autoClock = 0.0;
var effDir = 1.0;
var localMul = 1.0;
var tideBreath = 1.0;   // gentle autonomous tidal swell (rest motion, not level)

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  localMul = pow(2.0, (localSpeed - 0.5) * 4.0);

  var manDir = (direction * 2.0) - 1.0;
  if (manDir >= 0.0 && manDir < 0.06) manDir = 0.06;
  else if (manDir < 0.0 && manDir > -0.06) manDir = -0.06;

  autoClock = autoClock + dt;
  if (autoClock >= PHASE_WRAP) autoClock = autoClock - PHASE_WRAP;
  var autoSign = (sin(autoClock / AUTO_PERIOD * PI2) >= 0.0) ? 1.0 : -1.0;
  effDir = manDir * autoSign;

  driftA = driftA + dt * localMul * MAX_RATE * effDir;
  driftB = driftB + dt * localMul * MAX_RATE * 1.73205 * effDir;
  shimmerPhase = shimmerPhase + dt * localMul * MAX_RATE * 1.41421;
  if (driftA >= PHASE_WRAP) driftA = driftA - PHASE_WRAP;
  else if (driftA <= -PHASE_WRAP) driftA = driftA + PHASE_WRAP;
  if (driftB >= PHASE_WRAP) driftB = driftB - PHASE_WRAP;
  else if (driftB <= -PHASE_WRAP) driftB = driftB + PHASE_WRAP;
  if (shimmerPhase >= PHASE_WRAP) shimmerPhase = shimmerPhase - PHASE_WRAP;

  // Gentle autonomous tidal swell: the whole current rises and ebbs on a slow
  // incommensurate clock. This is a REST-motion breath (independent of level) so
  // the rig is never static in silence; level still dominates total brightness.
  tideBreath = 0.70 + 0.30 * wave(shimmerPhase * 0.8 + autoClock * 0.011);

  _hsv2rgb1();
  _hsv2rgb2();
}

export function render3D(index, x, y, z) {
  // Coords are already 0..1 — use directly (clamp only). NEVER re-normalize.
  var nx = clamp01(x);
  var ny = clamp01(y);

  var dens = 1.0 + density * 5.0;
  var reach = 0.7 + radius * 1.2;   // AUDIO: current swell / caustic reach

  // Broad longitudinal current + cross caustic (incommensurate frequencies).
  var longWave = wave((nx * dens) + (ny * 0.8) - driftA * 0.18);
  var crossWave = wave((ny * dens * 0.7 * reach) - (nx * 0.6) + driftB * 0.18
                       + shimmerPhase * 0.07 * shimmer);
  var currentRaw = (longWave * 0.65) + (crossWave * 0.35);
  var current = pow(currentRaw, 1.8);

  // Caustic crest gate — sharpens with shimmer, pops with kick.
  var crest = (crossWave > (0.86 - shimmer * 0.1)) ? 1.0 : 0.0;
  crest = crest * pow(currentRaw, 2.0);

  // Upper-head crown weighting.
  var crown = pow(ny, 1.6);

  // Single-expression brightness (avoid repeated `v=v*x` VM mis-compile).
  var swell = current * (0.6 + 0.4 * crown) + crest * (0.5 + kick * 0.8);
  var bri = (BASE_FLOOR + clamp01(swell) * (1.0 - BASE_FLOOR)) * level * tideBreath;

  // Strict cp1<->cp2 RGB lerp driven by the caustic; a contrasted curve spreads
  // pixels toward BOTH palette ends (caustic peaks -> cp2, troughs -> cp1) so
  // the rig genuinely shows two hues; crest fully pushes toward cp2.
  var spread2 = wave(crossWave * 1.3 + ny * 0.5 - driftB * 0.06);
  // Contrast curve centred so the rig genuinely shows BOTH palette ends at once
  // (troughs sit at cp1, crests reach cp2) rather than skewing all-caustic.
  var tColour = clamp01(pow(spread2, 1.15) * 1.05 + crest * 0.55);
  var r = (pr1 + (pr2 - pr1) * tColour) * bri;
  var g = (pg1 + (pg2 - pg1) * tColour) * bri;
  var b = (pb1 + (pb2 - pb1) * tColour) * bri;

  // Upper-crown white / UV emitters (kept audio-coupled via level).
  var w = (current * crown * whiteLift + crest * crown * kick * 0.5) * level;
  var u = (0.2 + crossWave * 0.8) * crown * uvLift * level;

  rgbwau(clamp01(r), clamp01(g), clamp01(b), clamp01(w), 0.0, clamp01(u));
}
