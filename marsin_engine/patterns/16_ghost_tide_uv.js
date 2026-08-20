/*
  16_ghost_tide_uv.js
  Slow tidal sweep with a ghostly foam crest and a UV undertow. A bright foam
  line sweeps across the rig over a deep cp1<->cp2 mist; the foam drives the W
  (white) channel hard and a UV glow swells beneath — the W/UV are the whole
  point of "ghost_tide_UV". Bioluminescent, vintage-blinder-friendly.

  IDENTITY (preserved): tidal foam sweep + UV undertow + explicit white/UV, mist
  colour blend cp1<->cp2. Upgrades: 0..1 coords used directly (no re-normalize),
  identity-slider convention, audio reactivity (foam crest pops on the kick,
  whole tide brightens with the bass), and one calm forward heading with a
  smooth autonomous rate sway. Every RGB contribution is derived from the
  cp1<->cp2 palette; only the named white/amber foam and UV undertow use their
  dedicated emitters.

  NON-REPEATING MATH
    The sweep and undertow are two delta-accumulated phases at an irrational ratio
    (tide rate 0.38; undertow ratio 0.58017). Phases accumulate continuously
    and wrap at PHASE_WRAP turns, far from any in-frame use — no seam (skill 12 §7).
    Autonomous tidal sway: a smooth rate envelope (0.55 + 0.45*wave(slowClock))
    on a slow incommensurate clock eases the tide between a slow creep and a
    faster surge. The envelope keeps a positive floor so the sweep never freezes
    mid-stroke (the og identity is a continuous, never-stalling tidal sweep).

  AUDIO (modulators-only — never read CPC audio globals natively):
  AUDIO_MODULATION_V1:
    sliderLevel   <- micLow  range 0.15..1.00 curve ease    # PRIMARY overall brightness (bass)
    sliderKick    <- micKick range 0.00..1.00 curve pow2    # foam / white crest pop
    sliderRadius  <- micFlux range 0.10..0.95 curve ease    # true surge excursion, independent of foam width
    sliderUvLevel <- micHigh range 0.20..0.90 curve linear  # UV undertow glow (highs / sparkle band)
  # static (unmapped): tideWidth, whiteLevel, palette pickers
*/

// ── Exported controls (UI order = declaration order) ─────────────────────────
// Canonical append-only optional fixture roles; absent roles match no pixels.
var FIX_RAW_LED = 1;
var FIX_TE_SIGN = 7;

export var localSpeed = 0.5;   // tide rate (0 still creeps, 1 ~4x faster)
export var level = 1.0;        // PRIMARY audio: overall brightness (micLow)
export var kick = 0.0;         // audio: kick -> foam/white crest pop (micKick)
export var radius = 0.5;       // audio: surge/travel excursion (micFlux)
export var tideWidth = 0.5;    // base foam width (0..1; scaled in render)
export var whiteLevel = 0.6;   // foam white-channel level
export var uvLevel = 0.6;      // UV undertow glow (audio: micHigh)

export var cp1H = 0.70, cp1S = 1.0, cp1V = 1.0; // mist colour (blue/indigo)
export var cp2H = 0.45, cp2S = 1.0, cp2V = 1.0; // undertow colour (cyan/green)
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderLevel(v) { level = v; }
export function sliderKick(v) { kick = v; }
export function sliderRadius(v) { radius = v; }
export function sliderTideWidth(v) { tideWidth = v; }
export function sliderWhiteLevel(v) { whiteLevel = v; }
export function sliderUvLevel(v) { uvLevel = v; }

var tide = 0.0;          // sweep phase (turns, accumulated)
var undertow = 0.0;      // undertow phase
var autoClock = 0.0;     // slow clock for autonomous rate sway
var surgeClock = 0.17;   // independent travel/excursion clock
var vintageClock = 0.31; // independent Jewelry sparkle clock
var parClock = 0.47;     // independent organ-pool clock
var signClock = 0.63;    // independent Identity bloom clock
var liveWidth = 0.42;    // resolved foam width this frame
var surgeTravel = 0.0;   // resolved Radius-driven phase excursion
var PHASE_WRAP = 10000.0;
var FLOW_DIRECTION = 1.0;

// ── Palette RGB cache ─────────────────────────────────────────────────
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
  else             { pr1 = cp1V; pg1 = pv;   pb1 = qv;   }
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
  else             { pr2 = cp2V; pg2 = pv;   pb2 = qv;   }
}

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;
  var localMultiplier = pow(2.0, (localSpeed - 0.5) * 4.0);

  // Autonomous tidal ebb/flow: a smooth rate sway that eases the tide between a
  // slow creep and a faster surge on a slow incommensurate clock. The envelope
  // keeps a positive floor (0.10..1.00) so the sweep NEVER freezes mid-stroke —
  // an earlier (0.4 + 0.6*cos) envelope reached zero at cos=-0.667 and stalled
  // the whole rig for ~1s on every cycle, which the discontinuity detector
  // flagged. The fixed forward heading keeps the original continuous,
  // never-stalling tidal identity without exposing a direction control.
  autoClock = autoClock + dt * 0.049 * localMultiplier;
  if (autoClock >= PHASE_WRAP) autoClock = autoClock - PHASE_WRAP;
  var rate = (0.55 + 0.45 * wave(autoClock))
           * FLOW_DIRECTION * localMultiplier;

  // Two phases at an irrational ratio (1 : 0.58) so the look never re-locks.
  tide = tide + dt * 0.38 * rate;
  if (tide >= PHASE_WRAP) tide -= PHASE_WRAP;
  else if (tide <= -PHASE_WRAP) tide += PHASE_WRAP;
  undertow = undertow + dt * 0.38 * 0.58017 * rate;
  if (undertow >= PHASE_WRAP) undertow -= PHASE_WRAP;
  else if (undertow <= -PHASE_WRAP) undertow += PHASE_WRAP;

  // Radius owns a genuine back-and-forth travel excursion. TideWidth alone
  // owns crest thickness, so the two controls no longer describe one width.
  surgeClock = surgeClock + dt * 0.071 * localMultiplier;
  if (surgeClock >= PHASE_WRAP) surgeClock = surgeClock - PHASE_WRAP;
  surgeTravel = (wave(surgeClock) - 0.5) * 2.0 * (0.04 + radius * 0.48);
  liveWidth = 0.08 + tideWidth * 0.34;

  vintageClock = vintageClock + dt * 0.31 * localMultiplier;
  if (vintageClock >= PHASE_WRAP) vintageClock = vintageClock - PHASE_WRAP;
  parClock = parClock + dt * 0.037 * localMultiplier;
  if (parClock >= PHASE_WRAP) parClock = parClock - PHASE_WRAP;
  // Identity owns an independent, visible ghost-current clock. Integer
  // consumers below keep its very-late PHASE_WRAP continuous.
  signClock = signClock + dt * 0.041 * localMultiplier;
  if (signClock >= PHASE_WRAP) signClock = signClock - PHASE_WRAP;
  _hsv2rgb1();
  _hsv2rgb2();
}

export function render3D(index, x, y, z) {
  var nx = max(0.0, min(1.0, x));
  var ny = max(0.0, min(1.0, y));
  var nz = max(0.0, min(1.0, z));

  // Radius shifts the whole tide through a real travel excursion. TideWidth
  // changes only the thickness of this crest below.
  var sweep = wave(nx * 0.42 + ny * 0.30 + tide + surgeTravel);
  var edge = abs(sweep - 0.5) * 2.0;
  var foam = max(0.0, 1.0 - edge / liveWidth);
  foam = pow(foam, 2.4);

  var lowRoll = wave((ny * 2.2) - (nx * 0.8) + undertow);
  var mist = pow(lowRoll, 2.0) * (0.14 + foam * 0.42);

  var crest = foam * (1.0 + kick * 1.4);
  var tColour = max(0.0, min(1.0, (lowRoll - 0.5) * 1.5 + 0.5));
  var body = mist + crest * 0.22;
  var rBase = (pr1 + (pr2 - pr1) * tColour) * body;
  var gBase = (pg1 + (pg2 - pg1) * tColour) * body;
  var bBase = (pb1 + (pb2 - pb1) * tColour) * body;

  // Quieter default than the former 2.16x silence gain. The bass mapping still
  // has a wide, direct range and kick can make the crest decisive.
  var levelGain = 0.12 + level * 0.65;
  var floorBase = 0.006;
  var floorMix = 0.5;
  var r = (rBase + (pr1 + (pr2 - pr1) * floorMix) * floorBase) * levelGain;
  var g = (gBase + (pg1 + (pg2 - pg1) * floorMix) * floorBase) * levelGain;
  var b = (bBase + (pb1 + (pb2 - pb1) * floorMix) * floorBase) * levelGain;
  var white = 0.0;
  var uv = 0.0;

  if (fixtureType == FIX_BAR_18) {
    // Hull bars carry the complete foam + undertow picture. Foam is rendered
    // in the selected palette so the W/A emitters remain reserved for Jewelry.
    var pale = crest * whiteLevel * levelGain * 0.52;
    var foamMix = max(0.0, min(1.0, 0.35 + lowRoll * 0.30));
    r = r + (pr1 + (pr2 - pr1) * foamMix) * pale;
    g = g + (pg1 + (pg2 - pg1) * foamMix) * pale;
    b = b + (pb1 + (pb2 - pb1) * foamMix) * pale;
    uv = ((1.0 - ny) * lowRoll * 0.40 + foam * 0.60)
       * uvLevel * levelGain;
  }
  else if (fixtureType == FIX_RAW_LED) {
    // Silhouette strands trace a palette-authored crest and have no UV emitter.
    var trace = crest * levelGain * 0.72;
    var traceMix = max(0.0, min(1.0, 0.45 + lowRoll * 0.45));
    r = r * 0.42 + (pr1 + (pr2 - pr1) * traceMix) * trace;
    g = g * 0.42 + (pg1 + (pg2 - pg1) * traceMix) * trace;
    b = b * 0.42 + (pb1 + (pb2 - pb1) * traceMix) * trace;
  }
  else if (fixtureType == FIX_VINTAGE_6) {
    // Sparse palette-colored foam droplets with matched native W+A.
    var sparkle = wave(vintageClock + pixelLocalIndex * 0.381966
                     + nx * 0.17 + ny * 0.11);
    sparkle = sparkle * sparkle; sparkle = sparkle * sparkle;
    var jewelryFoam = crest * sparkle * whiteLevel * levelGain;
    var jewelryMix = max(0.0, min(1.0, 0.20 + lowRoll * 0.55));
    r = r * 0.35 + (pr1 + (pr2 - pr1) * jewelryMix) * jewelryFoam;
    g = g * 0.35 + (pg1 + (pg2 - pg1) * jewelryMix) * jewelryFoam;
    b = b * 0.35 + (pb1 + (pb2 - pb1) * jewelryMix) * jewelryFoam;
    white = jewelryFoam;
  }
  else if (fixtureType == FIX_PAR) {
    // Organs hold restrained palette/UV pools stirred by the low undertow.
    var pool = wave(parClock + nx * 0.17 + nz * 0.13);
    var poolBri = levelGain * (0.08 + lowRoll * 0.22 + pool * 0.12);
    var poolMix = max(0.0, min(1.0, 0.15 + lowRoll * 0.55 + foam * 0.25));
    var poolLift = poolBri + crest * levelGain * 0.12;
    r = (pr1 + (pr2 - pr1) * poolMix) * poolLift;
    g = (pg1 + (pg2 - pg1) * poolMix) * poolLift;
    b = (pb1 + (pb2 - pb1) * poolMix) * poolLift;
    uv = (lowRoll * 0.24 + foam * 0.30) * uvLevel * levelGain;
  }
  else if (fixtureType == FIX_TE_SIGN) {
    // Identity is a miniature ghost sea: one broad oblique foam front crosses
    // the letters while two counter-flowing XYZ currents continuously open and
    // close phosphorescent cells behind it. This is visibly more intricate
    // than Moon River's single river or Caustic Shimmer's glass lenses, while
    // every edge remains continuous (no temporal hashes or threshold flicker).
    var signSweep = wave(nx * 0.57 + ny * 0.33 - nz * 0.19
                       + tide + surgeTravel + pixelLocalIndex * 0.0025);
    var signEdge = abs(signSweep - 0.5) * 2.0;
    var signFoam = max(0.0, 1.0 - signEdge / (liveWidth * 0.78));
    signFoam = pow(signFoam, 2.8);
    var signCurrentA = wave(nx * 1.73 + ny * 2.31 - nz * 0.83
                         + signClock * 3.0 + pixelLocalIndex * 0.0060);
    var signCurrentB = wave(-nx * 2.17 + ny * 1.37 + nz * 1.91
                         - signClock * 5.0 + pixelLocalIndex * 0.0035);
    var signCell = 1.0 - abs(signCurrentA - signCurrentB);
    signCell = pow(max(0.0, signCell), 3.2);
    var signMist = wave(ny * 1.70 - nx * 0.60 + nz * 0.90
                      + undertow + signCell * 0.23);
    signMist = pow(signMist, 2.0);
    var signBri = (0.255 + signMist * 0.090 + signCell * 0.145
                 + signFoam * 0.245 + kick * 0.050)
                 * (0.78 + level * 0.22);
    var signMix = max(0.0, min(1.0, 0.10 + signCurrentA * 0.19
                            + signCurrentB * 0.16 + signMist * 0.17
                            + signFoam * 0.30));
    r = (pr1 + (pr2 - pr1) * signMix) * signBri;
    g = (pg1 + (pg2 - pg1) * signMix) * signBri;
    b = (pb1 + (pb2 - pb1) * signMix) * signBri;
  }

  // Only the capable bar and PAR fixtures receive UV above. Vintage W and A
  // are byte-identical by construction; every other fixture leaves both zero.
  rgbwau(min(1.0, r), min(1.0, g), min(1.0, b),
         min(1.0, white), min(1.0, white), min(1.0, uv));
}
