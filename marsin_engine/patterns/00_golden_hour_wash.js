/*
  00_golden_hour_wash.js — "Golden Hour Wash"

  The bread-and-butter warm look: late sunlight moving across a ship that is
  already glowing from within. The red-to-sunset-orange palette and soft wash
  remain recognizable on the test bench, while fixture capability gives the
  full ship a deliberate hierarchy:

    - Bars carry the broad moving sunset field.
    - Vintage rail lights are the jewelry. They alone emit matched W+A, giving
      them the bright golden-white signature and the beat flash.
    - Every other light carries a calmer RGB-only contour so strands and signs
      remain readable and pars feel like a warm interior glow.

  No direction control: this is an ambient drift, not a directional chase.
  Three ordinary controls are intentionally strong audio targets: level moves
  the whole look, emberSwell expands the warm body, and jewelryFlash makes the
  Vintage rails visibly answer a kick. The pattern never reads audio directly.

AUDIO_MODULATION_V1:
  sliderLevel        <- micLow  range 0.42..0.92 curve ease  # whole-ship breathing
  sliderEmberSwell   <- micFlux range 0.08..0.95 curve ease  # broad warm expansion
  sliderJewelryFlash <- micKick range 0.00..1.00 curve pow2  # Vintage-only golden-white hit
  # STATIC (omit from audio): localSpeed, grain, jewelryWhite, colorPalette1/2
*/

// Exported controls — declaration order is physical MIDI knob order.
export var localSpeed    = 0.42;
export var level         = 0.62;
export var grain         = 0.36;
export var emberSwell    = 0.28;
export var jewelryWhite  = 0.56;
export var jewelryFlash  = 0.0;

export var cp1H = 0.0,   cp1S = 1.0, cp1V = 1.0;
export var cp2H = 0.085, cp2S = 1.0, cp2V = 1.0;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v)    { localSpeed = v; }
export function sliderLevel(v)         { level = v; }
export function sliderGrain(v)         { grain = v; }
export function sliderEmberSwell(v)    { emberSwell = v; }
export function sliderJewelryWhite(v)  { jewelryWhite = v; }
export function sliderJewelryFlash(v)  { jewelryFlash = v; }

var FULL_TURN = 6.283185307179586;
// Every phase consumer below uses a coefficient whose product with 1000 is an
// integer. A large 1000-turn wrap therefore preserves every wave/sin/cos value
// exactly instead of injecting the visible jumps caused by the old 1-turn wrap.
var PHASE_WRAP = 1000.0;

var pr1 = 1.0, pg1 = 0.0, pb1 = 0.0;
var pr2 = 1.0, pg2 = 0.5, pb2 = 0.0;

function clamp01(v) {
  if (v < 0.0) return 0.0;
  if (v > 1.0) return 1.0;
  return v;
}

function _hsv2rgb1() {
  var hv = cp1H - floor(cp1H); if (hv < 0.0) hv += 1.0;
  var iv = floor(hv * 6.0) % 6;
  var fv = hv * 6.0 - floor(hv * 6.0);
  var pv = cp1V * (1.0 - cp1S);
  var qv = cp1V * (1.0 - fv * cp1S);
  var tv = cp1V * (1.0 - (1.0 - fv) * cp1S);
  if      (iv == 0) { pr1 = cp1V; pg1 = tv;   pb1 = pv;   }
  else if (iv == 1) { pr1 = qv;   pg1 = cp1V; pb1 = pv;   }
  else if (iv == 2) { pr1 = pv;   pg1 = cp1V; pb1 = tv;   }
  else if (iv == 3) { pr1 = pv;   pg1 = qv;   pb1 = cp1V; }
  else if (iv == 4) { pr1 = tv;   pg1 = pv;   pb1 = cp1V; }
  else              { pr1 = cp1V; pg1 = pv;   pb1 = qv;   }
}

function _hsv2rgb2() {
  var hv = cp2H - floor(cp2H); if (hv < 0.0) hv += 1.0;
  var iv = floor(hv * 6.0) % 6;
  var fv = hv * 6.0 - floor(hv * 6.0);
  var pv = cp2V * (1.0 - cp2S);
  var qv = cp2V * (1.0 - fv * cp2S);
  var tv = cp2V * (1.0 - (1.0 - fv) * cp2S);
  if      (iv == 0) { pr2 = cp2V; pg2 = tv;   pb2 = pv;   }
  else if (iv == 1) { pr2 = qv;   pg2 = cp2V; pb2 = pv;   }
  else if (iv == 2) { pr2 = pv;   pg2 = cp2V; pb2 = tv;   }
  else if (iv == 3) { pr2 = pv;   pg2 = qv;   pb2 = cp2V; }
  else if (iv == 4) { pr2 = tv;   pg2 = pv;   pb2 = cp2V; }
  else              { pr2 = cp2V; pg2 = pv;   pb2 = qv;   }
}

var phaseA = 0.0;
var phaseB = 0.0;
var phaseC = 0.0;
var jewelryPhase = 0.0;
var levelGain = 0.0;
var grainScale = 0.0;
var emberAmount = 0.0;
var jewelryKeep = 0.0;
var jewelryHit = 0.0;

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  _hsv2rgb1();
  _hsv2rgb2();

  // Global speed is already inside delta; localSpeed is only the local trim.
  var localMult = pow(2.0, (localSpeed - 0.5) * 4.0);
  // Wide but useful range: localSpeed=0 stays an ambient creep, while 1.0 is
  // unmistakably fast even with the engine's global SPEED around halfway.
  var rate = 0.008 + 0.080 * localMult;
  phaseA += dt * rate;
  phaseB += dt * rate * 1.41421356237;
  phaseC += dt * rate * 0.61803398875;
  // The jewelry swipe has its own gentler clock: movement speed can become
  // energetic without turning the occasional Vintage signature into a strobe.
  jewelryPhase += dt * (0.018 + 0.015 * localMult);
  if (phaseA >= PHASE_WRAP) phaseA -= PHASE_WRAP;
  if (phaseB >= PHASE_WRAP) phaseB -= PHASE_WRAP;
  if (phaseC >= PHASE_WRAP) phaseC -= PHASE_WRAP;
  if (jewelryPhase >= PHASE_WRAP) jewelryPhase -= PHASE_WRAP;

  levelGain = 0.26 + 0.86 * clamp01(level);
  grainScale = 0.75 + 3.25 * clamp01(grain);
  emberAmount = clamp01(emberSwell);
  jewelryKeep = clamp01(jewelryWhite);
  jewelryHit = clamp01(jewelryFlash);
}

export function render3D(index, x, y, z) {
  var nx = clamp01(x);
  var ny = clamp01(y);
  var nz = clamp01(z);

  // Three phase orbits use irrationally related rates. They wrap only after a
  // large integer number of turns, with every consumer remaining phase-exact.
  var ox = sin(phaseA * FULL_TURN) * 0.22;
  var oy = cos(phaseB * FULL_TURN) * 0.18;
  var oz = sin(phaseC * FULL_TURN) * 0.14;
  var q = (nx + ox) * 1.35 * grainScale
        + (ny + oy) * 0.90 * grainScale * 0.61803398875
        - (nz + oz) * 1.10 * grainScale * 0.41421356237;
  var n1 = wave(q + phaseA);
  var n2 = wave(q * 1.41421356237 - phaseB * 0.7);
  var n3 = wave(q * 0.61803398875 + phaseC * 1.3);
  var field = n1 * 0.50 + n2 * 0.32 + n3 * 0.18;
  var core = field * field;

  // Strict palette blend. The contrast curve preserves both warm endpoints
  // instead of collapsing the ship into one muddy orange.
  var blend = field * field * (3.0 - 2.0 * field);
  var r = pr1 + (pr2 - pr1) * blend;
  var g = pg1 + (pg2 - pg1) * blend;
  var b = pb1 + (pb2 - pb1) * blend;

  var emberWave = wave(phaseB + nx * 0.31 + nz * 0.17);
  var body = 0.24 + core * 0.50
           + emberAmount * (0.10 + emberWave * 0.30);

  // Bars are the broad canvas. Other non-Vintage fixtures use a steadier RGB
  // contour so silhouettes and letterforms stay readable while the wash moves.
  if (fixtureType == FIX_BAR_18) {
    body += emberAmount * field * 0.12;
  } else if (fixtureType != FIX_VINTAGE_6) {
    var contour = wave(phaseC * 0.55 + pixelLocalIndex * 0.018 + nx * 0.13);
    body = 0.42 + field * 0.20 + contour * 0.07
         + emberAmount * (0.08 + emberWave * 0.12);
  }

  var w = 0.0;
  var u = 0.0;

  if (fixtureType == FIX_VINTAGE_6) {
    // Jewelry treatment: an incandescent RGB body with the only authored white
    // in the pattern. Matched W+A reads as rich golden white on six-head rails.
    // A narrow traveling crest restores the original occasional white swipe.
    var jewelDrift = wave(phaseA * 0.65 + pixelLocalIndex * 0.137
                        + nx * 0.23 + nz * 0.11);
    var glint = jewelDrift * jewelDrift;
    glint = glint * glint;
    var swipe = wave(nx * 0.85 - jewelryPhase);
    swipe = swipe * swipe;
    swipe = swipe * swipe;
    swipe = swipe * swipe;
    body = 0.48 + field * 0.20 + emberAmount * 0.16;
    w = jewelryKeep * (0.10 + glint * 0.22 + swipe * 1.35)
      + jewelryHit * (0.34 + glint * 0.66);
    r += jewelryKeep * (0.10 + swipe * 0.13) + jewelryHit * 0.14;
    g += jewelryKeep * (0.045 + swipe * 0.075) + jewelryHit * 0.07;
  }

  body *= levelGain;
  r *= body;
  g *= body;
  b *= body;
  w = clamp01(w * (0.45 + levelGain * 0.72));

  // White is Vintage-only; W and A remain byte-identical by construction.
  rgbwau(clamp01(r), clamp01(g), clamp01(b), w, w, u);
}
