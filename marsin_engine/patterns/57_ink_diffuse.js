/*
  57_ink_diffuse.js — soft analytic dye clouds moving through still water.

  Five independent clouds wander in normalized x/y/z space. Their centres,
  bloom clocks, and fixture accents all use independent large-wrap phases, so
  the motion is spatially truthful on Titanic, test_bench, and any other model:
  no serialized-index neighbours, compressed buffers, or rig-size assumptions.

  Fixture-capability staging stays portable:
    FIX_BAR_18     — saturated dye canvas and broad cloud body.
    FIX_RAW_LED    — blue/magenta reflection along the feathered cloud edge.
    FIX_VINTAGE_6  — palette-derived droplets with matched W+A emitters.
    FIX_PAR        — restrained low-band stirring pools.
    FIX_TE_SIGN    — paired, index-symmetric Identity ink windows.
  Other fixture types receive the complete water-and-ink composition.

  CONTROLS (declaration order = physical knob order)
    - localSpeed : wander, bloom, and reflection speed.
    - ink        : dye concentration and luminous cloud-core strength.
    - flow       : low-band stirring speed plus the broad water lift.
    - diffuse    : true cloud radius and edge softness; high is wider/softer.
    - base       : quiet deep-water visibility floor.

  AUDIO_MODULATION_V1:
    sliderFlow    <- micLow  range 0.20..0.95 curve ease  # PRIMARY: lows stir and lift the water
    sliderInk     <- micHigh range 0.00..1.00 curve linear # DETAIL: highs release vivid fresh dye
    sliderDiffuse <- micFlux range 0.15..0.90 curve ease  # MOTION: builds widen and soften the clouds
    # sliderBase       static 0.09 # silence-safe water floor
    # sliderLocalSpeed static 0.50 # operator motion rate
*/

// Exported controls — preserve this order.
// Canonical append-only optional fixture roles; absent roles match no pixels.
var FIX_RAW_LED = 1;
var FIX_TE_SIGN = 7;

export var localSpeed = 0.5;
export var ink = 0.5;
export var flow = 0.5;
export var diffuse = 0.5;
export var base = 0.09;

export var cp1H = 0.62, cp1S = 1.00, cp1V = 1.0;
export var cp2H = 0.85, cp2S = 1.00, cp2V = 1.0;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderInk(v) { ink = v; }
export function sliderFlow(v) { flow = v; }
export function sliderDiffuse(v) { diffuse = v; }
export function sliderBase(v) { base = v; }

var PHASE_WRAP = 10000.0;

var pr1 = 1.0, pg1 = 0.0, pb1 = 0.0;
var pr2 = 0.0, pg2 = 0.0, pb2 = 1.0;
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

function clamp01(v) {
  if (v < 0.0) return 0.0;
  if (v > 1.0) return 1.0;
  return v;
}

function wrapPhase(v) {
  if (v >= PHASE_WRAP) v = v - PHASE_WRAP;
  return v;
}

// Every visible oscillator owns its clock. No scaled wrapped phase is reused.
var aX = 0.00, aY = 0.19, aZ = 0.41, aLife = 0.12;
var bX = 0.27, bY = 0.53, bZ = 0.08, bLife = 0.47;
var cX = 0.61, cY = 0.31, cZ = 0.76, cLife = 0.81;
var dX = 0.17, dY = 0.73, dZ = 0.36, dLife = 0.29;
var eX = 0.84, eY = 0.11, eZ = 0.58, eLife = 0.66;
var waterT = 0.0, vintageT = 0.23, parT = 0.44, signT = 0.67;

// Resolved per-frame cloud state.
var aCx = 0.3, aCy = 0.4, aCz = 0.5, aPulse = 0.5;
var bCx = 0.7, bCy = 0.6, bCz = 0.3, bPulse = 0.5;
var cCx = 0.5, cCy = 0.3, cCz = 0.7, cPulse = 0.5;
var dCx = 0.2, dCy = 0.7, dCz = 0.4, dPulse = 0.5;
var eCx = 0.8, eCy = 0.2, eCz = 0.6, ePulse = 0.5;
var radiusSq = 0.04;
var edgePower = 1.8;
var waterLift = 0.12;

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  _hsv2rgb1();
  _hsv2rgb2();

  // The wider trim makes the operator's saved 0.85 visibly active while the
  // low end remains a calm drift rather than a frozen composition.
  var speed = pow(2.0, (localSpeed - 0.5) * 5.2);
  var stir = 0.55 + flow * 0.90;

  aX = wrapPhase(aX + dt * 0.043 * speed * stir);
  aY = wrapPhase(aY + dt * 0.027 * speed * stir);
  aZ = wrapPhase(aZ + dt * 0.018 * speed * stir);
  aLife = wrapPhase(aLife + dt * 0.087 * speed);

  bX = wrapPhase(bX + dt * 0.031 * speed * stir);
  bY = wrapPhase(bY + dt * 0.051 * speed * stir);
  bZ = wrapPhase(bZ + dt * 0.023 * speed * stir);
  bLife = wrapPhase(bLife + dt * 0.069 * speed);

  cX = wrapPhase(cX + dt * 0.057 * speed * stir);
  cY = wrapPhase(cY + dt * 0.016 * speed * stir);
  cZ = wrapPhase(cZ + dt * 0.039 * speed * stir);
  cLife = wrapPhase(cLife + dt * 0.059 * speed);

  dX = wrapPhase(dX + dt * 0.019 * speed * stir);
  dY = wrapPhase(dY + dt * 0.061 * speed * stir);
  dZ = wrapPhase(dZ + dt * 0.033 * speed * stir);
  dLife = wrapPhase(dLife + dt * 0.077 * speed);

  eX = wrapPhase(eX + dt * 0.047 * speed * stir);
  eY = wrapPhase(eY + dt * 0.021 * speed * stir);
  eZ = wrapPhase(eZ + dt * 0.053 * speed * stir);
  eLife = wrapPhase(eLife + dt * 0.049 * speed);

  waterT = wrapPhase(waterT + dt * 0.021 * speed);
  vintageT = wrapPhase(vintageT + dt * 0.37 * speed);
  parT = wrapPhase(parT + dt * 0.047 * (0.45 + flow));
  signT = wrapPhase(signT + dt * 0.47 * speed * stir);

  aCx = 0.12 + 0.76 * wave(aX);
  aCy = 0.14 + 0.70 * wave(aY);
  aCz = 0.14 + 0.72 * wave(aZ);
  bCx = 0.10 + 0.80 * wave(bX);
  bCy = 0.18 + 0.66 * wave(bY);
  bCz = 0.12 + 0.74 * wave(bZ);
  cCx = 0.16 + 0.68 * wave(cX);
  cCy = 0.12 + 0.74 * wave(cY);
  cCz = 0.18 + 0.64 * wave(cZ);
  dCx = 0.08 + 0.84 * wave(dX);
  dCy = 0.20 + 0.58 * wave(dY);
  dCz = 0.10 + 0.78 * wave(dZ);
  eCx = 0.20 + 0.60 * wave(eX);
  eCy = 0.08 + 0.84 * wave(eY);
  eCz = 0.22 + 0.56 * wave(eZ);

  aPulse = 0.22 + 0.78 * wave(aLife);
  bPulse = 0.18 + 0.82 * wave(bLife);
  cPulse = 0.20 + 0.80 * wave(cLife);
  dPulse = 0.16 + 0.84 * wave(dLife);
  ePulse = 0.18 + 0.82 * wave(eLife);

  var radius = 0.15 + diffuse * 0.28;
  radiusSq = radius * radius;
  edgePower = 3.1 - diffuse * 2.25;
  // Commissioned visibility lift: preserve the same Flow/Base ownership while
  // keeping the full water body readable on the large Titanic model.
  waterLift = base * 0.82 + flow * flow * 0.58;
}

function cloudAt(px, py, pz, cx, cy, cz, pulse) {
  var dx = px - cx;
  var dy = py - cy;
  var dz = pz - cz;
  var d2 = dx * dx + dy * dy * 0.82 + dz * dz * 0.58;
  var q = 1.0 - d2 / (radiusSq + 0.0001);
  q = clamp01(q);
  return pow(q, edgePower) * pulse;
}

function cloudAtShaped(px, py, pz, cx, cy, cz, pulse, yWeight, zWeight) {
  var dx = px - cx;
  var dy = py - cy;
  var dz = pz - cz;
  var d2 = dx * dx + dy * dy * yWeight + dz * dz * zWeight;
  var q = clamp01(1.0 - d2 / (radiusSq + 0.0001));
  return pow(q, edgePower) * pulse;
}

export function render3D(index, x, y, z) {
  var nx = clamp01(x);
  var ny = clamp01(y);
  var nz = clamp01(z);

  var ca = cloudAt(nx, ny, nz, aCx, aCy, aCz, aPulse);
  var cb = cloudAt(nx, ny, nz, bCx, bCy, bCz, bPulse);
  var cc = cloudAt(nx, ny, nz, cCx, cCy, cCz, cPulse);
  var cd = cloudAtShaped(nx, ny, nz, dCx, dCy, dCz, dPulse, 0.48, 1.28);
  var ce = cloudAtShaped(nx, ny, nz, eCx, eCy, eCz, ePulse, 1.34, 0.42);
  var cloud = ca + cb * 0.92 + cc * 0.86 + cd * 0.78 + ce * 0.74;
  var density = clamp01(cloud * ink * 3.90);
  // A white wet edge exists only where two independent dye-cloud boundaries
  // meet. The colored interiors stay saturated and the empty water stays dark.
  var rimA = clamp01(1.0 - abs(ca - 0.28) * 5.2);
  var rimB = clamp01(1.0 - abs(cb - 0.28) * 5.2);
  var rimC = clamp01(1.0 - abs(cc - 0.28) * 5.2);
  var wetCollision = max(min(rimA, rimB), max(min(rimB, rimC), min(rimC, rimA)));
  wetCollision = pow(wetCollision, 2.6);

  var wet = wave(waterT + nx * 0.19 + ny * 0.11 - nz * 0.13);
  var waterBri = 0.020 + base * (0.35 + 0.65 * wet)
               + waterLift * (0.36 + 0.64 * wet);
  var inkBri = density * (0.46 + ink * 1.90);
  var bri = waterBri;
  if (inkBri > bri) bri = inkBri;

  var colorConc = clamp01(density * 4.00);
  var cloudFamily = clamp01((cb + ce) * 1.45 + cc * 0.30);
  var blend = clamp01(0.04 + colorConc * (0.24 + cloudFamily * 0.72));
  blend = blend * blend * (3.0 - 2.0 * blend);

  // Bars are the dye canvas: retain the water underneath and add the whole
  // saturated cloud body so large surfaces carry the two-colour composition.
  if (fixtureType == FIX_BAR_18) {
    bri = waterBri + density * (0.46 + ink * 1.62);
  }

  // Raw strands catch the cloud boundary like a reflection on a wet edge.
  if (fixtureType == FIX_RAW_LED) {
    var rim = 1.0 - abs(density - 0.34) * 3.4;
    rim = clamp01(rim);
    bri = waterBri * 0.72 + rim * (0.10 + ink * 0.58) + density * 0.22;
    blend = clamp01(0.10 + rim * 0.55 + density * 0.25);
  }

  // PARs are restrained, low-band-driven stirring pools rather than pixels.
  if (fixtureType == FIX_PAR) {
    var lowStir = wave(parT + nx * 0.21 + nz * 0.17);
    bri = 0.025 + base * 0.45 + flow * (0.08 + lowStir * 0.28)
        + density * 0.24;
    blend = clamp01(0.08 + density * 0.42);
  }

  // Both TE signs contain the same two-fixture pixelLocalIndex topology. This
  // makes the dye motion exactly symmetric between signs while retaining the
  // letter geometry and giving every cell a reliable illuminated floor.
  var signWetEdge = 0.0;
  if (fixtureType == FIX_TE_SIGN) {
    var signPos = pixelLocalIndex / 39.0;
    var signBloomA = wave(signT * 0.29 + signPos * 0.83 + 0.07);
    var signBloomB = wave(signT * 0.17 - signPos * 1.37 + 0.31);
    var signVein = wave(signT * 0.11 + signPos * 2.21
                      + signBloomA * 0.18);
    var signDye = clamp01(signBloomA * 0.58 + signBloomB * 0.42);
    signDye = clamp01(signDye * (0.78 + signVein * 0.38));
    signWetEdge = pow(clamp01(1.0 - abs(signBloomA - signBloomB) * 4.2), 3.0);

    bri = 0.24 + base * 0.55 + flow * 0.13
        + ink * (0.10 + signDye * 0.43);
    blend = clamp01(0.10 + ink * (0.16 + signDye * 0.76));
  }

  bri = clamp01(bri);
  var r = (pr1 + (pr2 - pr1) * blend) * bri;
  var g = (pg1 + (pg2 - pg1) * blend) * bri;
  var b = (pb1 + (pb2 - pb1) * blend) * bri;

  // Vintage rails receive palette-derived droplets. W and A are always
  // driven together; no third authored RGB tint is introduced.
  var ww = signWetEdge * ink * 0.075;
  if (fixtureType == FIX_VINTAGE_6) {
    var sparkle = wave(vintageT + pixelLocalIndex * 0.381966
                     + nx * 0.17 + ny * 0.11);
    sparkle = sparkle * sparkle;
    sparkle = sparkle * sparkle;
    var droplet = density * sparkle * (0.16 + ink * 0.56)
                + wetCollision * (0.18 + ink * 0.82);
    var dropBlend = clamp01(0.22 + cloudFamily * 0.66);
    r = r + (pr1 + (pr2 - pr1) * dropBlend) * droplet * 0.62;
    g = g + (pg1 + (pg2 - pg1) * dropBlend) * droplet * 0.62;
    b = b + (pb1 + (pb2 - pb1) * dropBlend) * droplet * 0.62;
    ww = clamp01(droplet * 0.82);
  }

  rgbwau(clamp01(r), clamp01(g), clamp01(b), ww, ww, 0.0);
}
