/*
  32_caustic_shimmer.js — flowing teal/gold water caustics with crisp white
  shimmer and a travelling ripple accent.

  IDENTITY
    A broad interference field paints moving caustic veins between the two
    operator palette endpoints. Fine white glints skate across the brightest
    water, while a ripple control launches visible expanding rings through the
    field. This is an ambient bed at rest and a responsive water instrument
    when Shimmer and Ripple are modulated.

  PORTABILITY / AUTHORSHIP
    The main picture is driven only by normalized world x/y coordinates, so it
    renders on Titanic, test_bench, and other mapped scenes. Fixture type 3 is
    the canonical append-only Vintage-6 role; those pixels receive a restrained
    extra glint lift because their dedicated white heads are the Jewelry-like
    instrument where sparkle reads best. TE signs receive calm refracted-glass
    cells built from XYZ plus their letter-path index, with a reliable RGB floor
    so Identity stays readable. No scene-specific view is required.

  TIMING
    Every moving term has its own delta-accumulated phase. Phases are turns and
    wrap at the integer PHASE_WRAP, so wave() and sin(phase*PI2) are continuous
    across a wrap. No wrapped phase is multiplied by a non-integer temporal
    ratio; that removes the former frequent flowA*PHI / glintT*1.7 jumps.

  CONTROLS (declaration order = physical MIDI order; preserved)
    localSpeed — flow, glint-churn, and ripple-travel rate.
    shimmer    — density and brightness of crisp moving white glints.
    ripple     — strength of expanding ring highlights through the caustics.
    depth      — caustic vein contrast/sharpness.
    base       — quiet water-floor visibility.

  AUDIO_MODULATION_V1:
    sliderShimmer <- micHigh range 0.05..1.00 curve pow2   # PRIMARY: hats/highs create visible white scintillation
    sliderRipple  <- micKick range 0.00..1.00 curve pow2   # kick: expanding travelling ring highlight
  Static (unmapped) params: localSpeed, depth, base, colorPalette1/2.
*/

export var localSpeed = 0.5;
export var shimmer = 0.5;
export var ripple = 0.0;
export var depth = 0.6;
export var base = 0.12;

export var cp1H = 0.52, cp1S = 1.00, cp1V = 1.0;
export var cp2H = 0.10, cp2S = 0.90, cp2V = 1.0;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderShimmer(v) { shimmer = v; }
export function sliderRipple(v) { ripple = v; }
export function sliderDepth(v) { depth = v; }
export function sliderBase(v) { base = v; }

var CAUSTIC_DENSITY = 3.2;
var GLINT_DENSITY = 30.0;
var PHASE_WRAP = 10000.0;
var VINTAGE_TYPE = 3.0;
// Optional accent role. Self-declaring the canonical append-only id preserves
// compilation and output on models that carry no TE signs.
var FIX_TE_SIGN = 7;
var SQRT2 = 1.41421;
var SQRT3 = 1.73205;
var PHI = 1.61803;

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
  else if (iv == 4) { pr2 = tv;   pg2 = pv;   pb2 = qv;   }
  else              { pr2 = cp2V; pg2 = pv;   pb2 = qv;   }
}

function clamp01(v) {
  if (v < 0.0) return 0.0;
  if (v > 1.0) return 1.0;
  return v;
}

var flowA = 0.0;
var flowB = 0.0;
var flowC = 0.0;
var tiltPhase = 0.0;
var glintA = 0.0;
var glintB = 0.0;
var ripplePhase = 0.0;
var rippleLevel = 0.0;

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  var localMultiplier = pow(2.0, (localSpeed - 0.5) * 4.0);

  flowA = flowA + dt * 0.071 * localMultiplier;
  flowB = flowB + dt * 0.043 * localMultiplier;
  flowC = flowC + dt * 0.097 * localMultiplier;
  tiltPhase = tiltPhase + dt * 0.013 * localMultiplier;
  glintA = glintA + dt * 0.37 * localMultiplier;
  glintB = glintB + dt * 0.59 * localMultiplier;
  ripplePhase = ripplePhase + dt * 0.24 * localMultiplier;

  if (flowA >= PHASE_WRAP) flowA = flowA - PHASE_WRAP;
  if (flowB >= PHASE_WRAP) flowB = flowB - PHASE_WRAP;
  if (flowC >= PHASE_WRAP) flowC = flowC - PHASE_WRAP;
  if (tiltPhase >= PHASE_WRAP) tiltPhase = tiltPhase - PHASE_WRAP;
  if (glintA >= PHASE_WRAP) glintA = glintA - PHASE_WRAP;
  if (glintB >= PHASE_WRAP) glintB = glintB - PHASE_WRAP;
  if (ripplePhase >= PHASE_WRAP) ripplePhase = ripplePhase - PHASE_WRAP;

  // Fast attack and soft release keep a short kick legible without creating a
  // discontinuous frame. Held manual values remain truthful and stable.
  var response = ripple > rippleLevel ? 18.0 : 5.0;
  rippleLevel = rippleLevel + (ripple - rippleLevel) * min(1.0, dt * response);

  _hsv2rgb1();
  _hsv2rgb2();
}

export function render3D(index, x, y, z) {
  // The model ABI already supplies normalized 0..1 coordinates.
  var nx = clamp01(x);
  var ny = clamp01(y);
  var nz = clamp01(z);

  // Three independent clocks produce a continuously evolving interference
  // field. Temporal irrationality comes from the rates, never by multiplying a
  // wrapped phase at its use site.
  var w1 = wave(nx * CAUSTIC_DENSITY + ny * 0.70 - flowA);
  var w2 = wave(ny * CAUSTIC_DENSITY * SQRT2 * 0.50 - nx * 0.50 + flowB);
  var w3 = wave((nx + ny) * CAUSTIC_DENSITY * PHI * 0.30 + flowC);
  var field = w1 * 0.40 + w2 * 0.35 + w3 * 0.25;
  var sharp = 1.5 + depth * 4.2;
  var caustic = pow(field, sharp);

  var floorPulse = base * (0.38 + 0.62 * wave(ny * 0.63 + flowB));

  // Expanding rings travel from a slowly wandering source. Ripple changes the
  // ring energy, while localSpeed owns its motion rate.
  var centerX = 0.50 + sin(flowA * PI2) * 0.15;
  var centerY = 0.48 + sin(flowB * PI2) * 0.10;
  var ringDist = hypot(nx - centerX, ny - centerY);
  var ring = pow(wave(ringDist * 3.4 - ripplePhase), 9.0);
  var ringLift = ring * rippleLevel * (0.45 + 0.90 * caustic);

  var body = clamp01(floorPulse + caustic * 0.82 + ringLift * 0.90);

  // Keep the colour field strictly between the two operator endpoints. Teal
  // occupies the troughs; gold rides the caustic crests and ripple rings.
  var tiltLF = wave(nx * SQRT3 * 0.55 + ny * 0.45 + tiltPhase);
  var tcol = clamp01(tiltLF * 0.48 + caustic * 0.52 + ringLift * 0.20);
  var r = (pr1 + (pr2 - pr1) * tcol) * body;
  var g = (pg1 + (pg2 - pg1) * tcol) * body;
  var b = (pb1 + (pb2 - pb1) * tcol) * body;

  // Shimmer controls a distinct, visibly white scintillation layer. Density
  // rises by lowering the gate; brightness rises independently. Vintage heads
  // receive a modest lift, preserving their iconic jewelry-white role without
  // changing the coordinate picture on scenes where that fixture is absent.
  var glintField = wave(nx * GLINT_DENSITY + ny * 17.3 + glintA)
                 * wave(ny * GLINT_DENSITY * 0.91 - nx * 13.7 - glintB);
  var gate = 0.91 - shimmer * 0.60;
  var glint = 0.0;
  if (shimmer > 0.0 && glintField > gate) {
    var glintCore = (glintField - gate) / (1.0 - gate);
    glint = pow(clamp01(glintCore), 2.0) * shimmer * 1.65
          * (0.35 + caustic * 0.65);
  }
  // A broader moving sheen connects the sparse pinpricks on low-pixel-count
  // models. It remains white, caustic-shaped, and clock-driven, so the Shimmer
  // knob reads as scintillation rather than a flat brightness multiplier.
  var sheen = pow(caustic, 2.4) * wave(nx * 8.7 - ny * 5.3 + glintB)
            * shimmer * shimmer * 0.42;
  glint = glint + sheen;
  if (fixtureType == VINTAGE_TYPE) glint = glint * 1.35;
  var w = clamp01(glint);

  if (fixtureType == FIX_TE_SIGN) {
    // Identity is a pane of slowly deforming caustic glass, not a traveling
    // river. Three oblique XYZ refractions fold across each 74-pixel letter
    // path; pairwise near-equality makes a changing cellular wall network.
    // Walls, lens interiors, and triple-refraction focal nodes trade energy
    // locally, so no coherent band or foam front crosses the whole sign.
    var signPath = pixelLocalIndex * 0.01351351351;
    var glassA = wave((nx * 0.61 + ny * 1.13 + nz * 0.47) * 3.7
                    + signPath * 0.73 + flowA * 4.0);
    var glassB = wave((nx * 1.31 - ny * 0.43 + nz * 0.89) * 3.1
                    - signPath * 0.37 - flowB * 5.0);
    var glassC = wave((nx * -0.77 + ny * 0.83 + nz * 1.21) * 2.9
                    + signPath * 0.51 + flowC * 3.0);
    var foldAB = 1.0 - clamp01(abs(glassA - glassB) * 2.45);
    var foldBC = 1.0 - clamp01(abs(glassB - glassC) * 2.45);
    var foldCA = 1.0 - clamp01(abs(glassC - glassA) * 2.45);
    var cellWall = pow(max(foldAB, max(foldBC, foldCA)), 2.15);
    var lensSeed = wave(signPath * PHI + nx * 0.73 + ny * 0.51
                      + nz * 0.31 + flowC * 4.0);
    var cellLens = pow(clamp01((1.0 - cellWall) * 0.42
                             + lensSeed * 0.58), 2.1);
    var focusNode = pow(clamp01(foldAB * foldBC * foldCA * 5.0), 0.78);
    var energyTrade = wave(flowA * 3.0 - flowB * 4.0 + flowC * 2.0
                         + signPath * 0.23 + nx * 0.17 - nz * 0.11);
    var wallEnergy = cellWall * (0.62 + energyTrade * 0.38);
    var lensEnergy = cellLens * (1.0 - energyTrade * 0.28);
    var glassCell = clamp01(wallEnergy * 0.52 + lensEnergy * 0.32
                          + focusNode * 0.42);
    var signBody = clamp01(0.38 + base * 0.28 + wallEnergy * 0.15
                         + lensEnergy * 0.13 + focusNode * 0.12
                         + rippleLevel * cellWall * 0.14);
    var signMix = clamp01(0.08 + glassA * 0.20 + glassB * 0.15
                        + glassC * 0.17 + wallEnergy * 0.17
                        + lensEnergy * 0.11 + focusNode * 0.16);
    r = (pr1 + (pr2 - pr1) * signMix) * signBody;
    g = (pg1 + (pg2 - pg1) * signMix) * signBody;
    b = (pb1 + (pb2 - pb1) * signMix) * signBody;
    w = clamp01((0.010 + wallEnergy * shimmer * 0.060
              + focusNode * shimmer * 0.095)
              * (0.72 + wave(tiltPhase + nz * 0.11) * 0.28));
  }

  rgbwau(clamp01(r), clamp01(g), clamp01(b), w, w, 0.0);
}
