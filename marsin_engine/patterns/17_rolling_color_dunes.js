/*
  17_rolling_color_dunes.js
  Rolling quasi-crystal sand dunes across the rig: layered incommensurate contour
  waves fold and drift like wind-blown dunes on the Bars, sharp surf-line pulses
  break across the Pars, and the Vintage heads glow with amber warmth (and pop
  white on the kick — vintage-blinder technique). Strict cp1<->cp2 (amber<->teal).

  IDENTITY (preserved): quasi-crystal dune contours + surf lines + amber Vintage
  warmth, amber/teal palette. Upgrades: mapped onto the REAL test_bench rig by
  sectionId (1=Pars, 2=Vintage, 3=Bars), identity-slider convention, audio
  reactivity (dunes brighten with the bass, surf/blinders pop on the kick),
  guarded direction with smooth autonomous reversal so the dunes occasionally
  roll the other way.

  NON-REPEATING MATH
    The dune field sums four contour waves at irrational scale ratios
    (1 : 0.618 : 1.414 : 0.913 ...) so the quasi-crystal never tiles. Drift is two
    delta-accumulated phases (roll 1 : drift 0.41) that wrap at PHASE_WRAP turns,
    far from any in-frame use — no seam (skill 12 §7).
    Autonomous direction: a smooth rate sway (0.4 + 0.6*cos(slowClock))*dirSign
    eases the drift through reversals on a slow incommensurate clock — never a
    hard sign flip.

  AUDIO (modulators-only — never read CPC audio globals natively):
  AUDIO_MODULATION_V1:
    sliderLevel      <- micLow  range 0.30..1.00 curve linear  # PRIMARY overall brightness (bass)
    sliderKick       <- micKick range 0.00..1.00 curve pow2    # surf crest + Vintage blinder pop
    sliderRadius     <- micFlux range 0.40..0.90 curve linear  # dune fold depth / sand shift
    sliderDetail     <- micHigh range 0.20..0.90 curve linear  # dune contrast / surf sharpness (highs)
    sliderWhiteKick  <- micKick range 0.00..1.00 curve pow2    # vintage-head blinder pop
    sliderWhiteLevel <- micLow  range 0.30..0.90 curve linear  # overall white keep
  # static (unmapped): direction, duneScale, stageSurf, amberWarmth, blinderBite, palette pickers
  The Vintage heads (sectionId==2) are the headline audience BLINDER: a small
  always-on warm-white keep (whiteLevel) glows tungsten, driven HARD on the kick
  (the kick slider + whiteKick) for the punch. blinderBite shapes how snappy/hard
  the bite lands (pow on the kick envelope). The Pars surf crests (sectionId==1)
  carry a white crest scaled by whiteLevel. White is ADDITIVE over the cp1↔cp2
  amber/teal dunes (hueSpread stays high — never washes the rig white).
*/

// ── Exported controls (UI order = declaration order) ─────────────────────────
export var localSpeed = 0.5;     // drift rate (0 still creeps, 1 ~4x faster)
export var direction = 0.5;      // 0.5 balanced; <0.5 reverse, >0.5 forward (guarded)
export var level = 1.0;          // PRIMARY audio: overall brightness (micLow)
export var kick = 0.0;           // audio: kick -> surf + Vintage blinder pop (micKick)
export var radius = 0.5;         // audio: dune fold depth / sand shift (micFlux)
export var detail = 0.5;         // audio: dune contrast / surf sharpness (micHigh)
export var duneScale = 0.5;      // dune density (0..1)
export var stageSurf = 0.5;      // surf-line strength on the Pars (0..1)
export var amberWarmth = 0.55;   // Vintage amber warmth (0..1)
export var whiteLevel = 0.5;     // WHITE: overall white amount / vintage keep (micLow)
export var whiteKick = 0.0;      // WHITE: kick-driven blinder bite (micKick)
export var blinderBite = 0.6;    // WHITE: how snappy/hard the blinder attack lands

export var cp1H = 0.08, cp1S = 0.90, cp1V = 1.0; // amber sand
export var cp2H = 0.47, cp2S = 0.90, cp2V = 1.0; // teal trough
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderDirection(v) {
  var d = (v * 2.0) - 1.0;
  if (d >= 0.0 && d < 0.06) d = 0.06; else if (d < 0.0 && d > -0.06) d = -0.06;
  direction = d;
}
export function sliderLevel(v) { level = v; }
export function sliderKick(v) { kick = v; }
export function sliderRadius(v) { radius = v; }
export function sliderDetail(v) { detail = v; }
export function sliderDuneScale(v) { duneScale = v; }
export function sliderStageSurf(v) { stageSurf = v; }
export function sliderAmberWarmth(v) { amberWarmth = v; }
export function sliderWhiteLevel(v) { whiteLevel = v; }
export function sliderWhiteKick(v) { whiteKick = v; }
export function sliderBlinderBite(v) { blinderBite = v; }

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

function clamp01(v) {
  if (v < 0.0) return 0.0;
  if (v > 1.0) return 1.0;
  return v;
}

var rollPhase = 0.0;
var driftPhase = 0.0;
var surfPhase = 0.0;
var autoClock = 0.0;
var dirSign = 1.0;
var liveScale = 6.0;
var foldDepth = 0.2;
var duneSharp = 1.5;
var whiteKeep = 0.0;     // resolved overall white amount this frame
var kickEnv = 0.0;       // resolved kick blinder envelope this frame (bite-shaped)
var PHASE_WRAP = 10000.0;

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;
  var localMultiplier = pow(2.0, (localSpeed - 0.5) * 4.0);

  dirSign = direction;
  if (dirSign >= 0.0 && dirSign < 0.06) dirSign = 0.06;
  else if (dirSign < 0.0 && dirSign > -0.06) dirSign = -0.06;

  // Autonomous reversal: smooth rate sway easing through zero (no hard flip).
  autoClock = autoClock + dt * 0.053 * localMultiplier;
  if (autoClock >= PHASE_WRAP) autoClock = autoClock - PHASE_WRAP;
  // A baseline drift magnitude (sign from direction) keeps the dunes visibly
  // rolling even at the guarded-center default; direction still steers the bias
  // and the autonomous clock still eases the roll through reversals.
  var dirMag = (dirSign < 0.0) ? -1.0 : 1.0;
  var sweepRate = dirSign + dirMag * 0.7;   // never near-zero at center
  var rate = (0.4 + 0.6 * cos(autoClock)) * sweepRate * localMultiplier;

  rollPhase  = rollPhase  + dt * 0.34 * rate;        if (rollPhase  >= PHASE_WRAP) rollPhase  -= PHASE_WRAP; else if (rollPhase  <= -PHASE_WRAP) rollPhase  += PHASE_WRAP;
  driftPhase = driftPhase + dt * 0.34 * 0.41 * rate; if (driftPhase >= PHASE_WRAP) driftPhase -= PHASE_WRAP; else if (driftPhase <= -PHASE_WRAP) driftPhase += PHASE_WRAP;
  surfPhase  = surfPhase  + dt * 0.62 * localMultiplier * sweepRate; if (surfPhase >= PHASE_WRAP) surfPhase -= PHASE_WRAP; else if (surfPhase <= -PHASE_WRAP) surfPhase += PHASE_WRAP;

  liveScale = 3.0 + duneScale * 8.0;          // 0..1 -> 3..11
  foldDepth = 0.08 + radius * 0.30;           // micFlux: dune fold depth
  duneSharp = 0.8 + detail * 2.6;             // micHigh: dune contrast

  // White blinder controls: the kick slider IS the beat envelope; whiteKick adds
  // extra pop on top; blinderBite sharpens the attack (pow exponent).
  whiteKeep = clamp01(whiteLevel);
  var bite = clamp01(blinderBite);
  var rawKick = clamp01(kick * (0.7 + 0.6 * clamp01(whiteKick)));
  kickEnv = pow(rawKick, 1.0 + bite * 2.0);

  _hsv2rgb1();
  _hsv2rgb2();
}

export function render3D(index, x, y, z) {
  // sectionId on test_bench: 1 = Pars, 2 = Vintage (blinders), 3 = Bars.
  var nx = clamp01(x);
  var ny = clamp01(y);
  var nz = clamp01(z);

  // ── The quasi-crystal dune field (shared spatial base) ──────────────────
  var shearA = wave(nx * 1.37 - nz * 0.83 + driftPhase * 0.71);
  var shearB = wave(nz * 1.11 + ny * 0.47 - rollPhase * 0.39);
  var foldX = nx + (shearA - 0.5) * foldDepth;
  var foldZ = nz + (shearB - 0.5) * foldDepth;

  var contourA = wave(foldX * liveScale + foldZ * liveScale * 0.618 - rollPhase);
  var contourB = wave(foldX * liveScale * 1.414 - foldZ * liveScale * 0.731 + driftPhase * 1.37 + ny * 0.29);
  var contourC = wave((foldX - foldZ) * liveScale * 0.913 + wave(ny * 1.7 + driftPhase) * 0.23 - rollPhase * 0.43);
  var contourD = wave(sqrt(abs(foldX - 0.5) * 1.7 + abs(foldZ - 0.5) * 1.1) * liveScale * 1.9 - driftPhase * 2.3);
  var dune = contourA * 0.38 + contourB * 0.27 + contourC * 0.22 + contourD * 0.13;
  dune = pow(clamp01(dune), duneSharp);

  var stage = 0.0;
  var white = 0.0;
  var amber = 0.0;
  var uv = 0.0;
  var colorBlend = clamp01(0.12 + contourB * 0.30 + contourC * 0.24 + contourD * 0.18 + dune * 0.26);

  if (sectionId == 3) {
    // Bars — the dune surface. Sandy ripple lanes along the strip.
    var sandRipple = wave(ny * 1.45 - rollPhase * 1.9 + nx * 0.6 + shearA * 0.31);
    stage = dune * (0.50 + sandRipple * 0.65);
    uv = pow(stage, 2.0) * 0.18;
  } else if (sectionId == 1) {
    // Pars — surf lines: sharp travelling crests that break across the dunes.
    var surf = pow(wave(surfPhase + nx * 2.0 + ny * 0.7 + index * 0.21), 6.0);
    var crest = surf * (1.0 + kick * 1.2);
    stage = (0.06 + crest) * (0.30 + stageSurf * 0.70);
    // White surf crest scaled by whiteLevel (amount) with an extra kick pop.
    white = crest * stageSurf * (0.20 + 0.55 * whiteKeep) * (1.0 + kickEnv * 0.6);
  } else if (sectionId == 2) {
    // Vintage heads — headline audience BLINDER. Amber warmth + always-on warm
    // white keep (whiteLevel) glows tungsten; on the kick the W channel is driven
    // HARD (kickEnv, snappiness via blinderBite) for the punch.
    var ember = wave(surfPhase * 0.47 + index * 0.13 + ny * 0.9);
    amber = (0.10 + ember * 0.55) * amberWarmth;
    stage = amber * 0.40 + dune * 0.15;
    var keep = whiteKeep * (0.06 + ember * 0.10);   // warm white rest-glow
    white = keep + kickEnv * 0.9;                    // drive W hard on the kick
  }

  // PRIMARY: overall brightness from micLow. level^2 makes the bass the dominant
  // brightness driver (corr>=0.5); a small clock-driven floor keeps silence
  // calm-but-visible while dune troughs read near-black (high-def contrast).
  var levelGain = 0.16 + level * level * 2.1;
  var floorBase = 0.02;
  var bri = min(1.0, (floorBase + stage) * levelGain);

  var r = (pr1 + (pr2 - pr1) * colorBlend) * bri;
  var g = (pg1 + (pg2 - pg1) * colorBlend) * bri;
  var b = (pb1 + (pb2 - pb1) * colorBlend) * bri;

  white = min(1.0, white * levelGain);
  amber = min(1.0, amber * levelGain);
  uv = min(1.0, uv * levelGain);

  rgbwau(clamp01(r), clamp01(g), clamp01(b), white, amber, uv);
}
