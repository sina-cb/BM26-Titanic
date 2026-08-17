// DRAFT — pending operator review
/*
  124_aurora_crown.js — four enormous aurora arcs crown the installation.

  Broad concentric arcs occupy normalized upper Y and curl around the XZ axis.
  Three-lobe and four-lobe crown profiles counter-sweep through ship-length
  diadem arcs, while their slow descending veils carry related motion through
  the lower hull. The ship wears one moving luminous crown at long distance;
  this is intentionally monumental rather than 33's close-up folded ribbons.

  A palette-derived safety floor is hard-constrained to 0.10..0.20 on every
  pixel. All visible colour lies strictly on the cp1<->cp2 RGB line. Geometry is
  normalized XYZ only. The optional TE-sign branch traces the same broad crown
  phrase across each sign's paired 40/34-pixel paths. Because that branch
  depends on pixelLocalIndex rather than world-side position, both 74-pixel
  signs are exactly balanced without an authored view or raw fixture id.

  CONTROLS (declaration order = physical MIDI order)
    localSpeed  — crown sweep/curl rate; zero still creeps.
    level       — luminous crown energy above the safety floor.
    crownHeight — raises the crown and increases its upper-Y reach.
    arcWidth    — broad sheet thickness of the radial and ship-length arcs.
    curl        — twists the crown around XZ as height/radius change.
    safetyFloor — hard palette-derived floor, constrained to 10%..20%.
    pulse       — immediate crown bloom without fragmenting the arcs.

  AUDIO_MODULATION_V1:
    sliderLevel       <- micLow  range 0.25..1.00 curve linear # crown brightness
    sliderPulse       <- micKick range 0.00..1.00 curve pow2   # whole-crown bloom
    sliderCrownHeight <- micFlux range 0.30..0.85 curve ease   # crown rises on builds
  # STATIC: localSpeed, arcWidth, curl, safetyFloor, palettes
*/

// Optional accent role at the append-only canonical registry id. On models
// without TE signs this branch simply has no members.
var FIX_TE_SIGN = 7;

export var localSpeed = 0.32;
export var level = 0.65;
export var crownHeight = 0.55;
export var arcWidth = 0.50;
export var curl = 0.45;
export var safetyFloor = 0.50;
export var pulse = 0.00;

export var cp1H = 0.36, cp1S = 0.92, cp1V = 1.0;
export var cp2H = 0.82, cp2S = 0.90, cp2V = 1.0;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderLevel(v) { level = v; }
export function sliderCrownHeight(v) { crownHeight = v; }
export function sliderArcWidth(v) { arcWidth = v; }
export function sliderCurl(v) { curl = v; }
export function sliderSafetyFloor(v) { safetyFloor = v; }
export function sliderPulse(v) { pulse = v; }

var PHASE_WRAP = 10000.0;
var sweepA = 0.0;
var sweepB = 0.37;
var curlClock = 0.19;

var liveSpeed = 0.32;
var liveLevel = 0.65;
var liveHeight = 0.55;
var liveWidth = 0.50;
var liveCurl = 0.45;
var liveFloor = 0.50;
var livePulse = 0.00;

var crownBase = 0.63;
var crownLift = 0.17;
var resolvedWidth = 0.08;
var resolvedFloor = 0.15;

var pr1 = 1.0, pg1 = 0.0, pb1 = 0.0;
var pr2 = 0.0, pg2 = 0.0, pb2 = 1.0;

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
  else if (iv == 4) { pr2 = tv;   pg2 = pv;   pb2 = qv;   }
  else              { pr2 = cp2V; pg2 = pv;   pb2 = qv;   }
}

function arcProfile(heightDelta, radiusDelta, width) {
  var distance = sqrt(heightDelta * heightDelta
                     + radiusDelta * radiusDelta * 0.32);
  var q = clamp01(1.0 - distance / (width + 0.0001));
  return q * q * (3.0 - 2.0 * q);
}

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  _hsv2rgb1();
  _hsv2rgb2();

  var geometryFollow = clamp01(dt * 3.0);
  var levelFollow = clamp01(dt * 10.0);
  var pulseFollow = clamp01(dt * 18.0);
  liveSpeed = liveSpeed + (clamp01(localSpeed) - liveSpeed) * geometryFollow;
  liveLevel = liveLevel + (clamp01(level) - liveLevel) * levelFollow;
  liveHeight = liveHeight
             + (clamp01(crownHeight) - liveHeight) * geometryFollow;
  liveWidth = liveWidth + (clamp01(arcWidth) - liveWidth) * geometryFollow;
  liveCurl = liveCurl + (clamp01(curl) - liveCurl) * geometryFollow;
  liveFloor = liveFloor
            + (clamp01(safetyFloor) - liveFloor) * levelFollow;
  livePulse = livePulse + (clamp01(pulse) - livePulse) * pulseFollow;

  var rate = 0.014 + 0.14 * pow(2.0, (liveSpeed - 0.5) * 4.0);
  sweepA = sweepA + dt * rate;
  sweepB = sweepB - dt * rate * 0.731;
  curlClock = curlClock + dt * rate * 0.413;
  if (sweepA >= PHASE_WRAP) sweepA -= PHASE_WRAP;
  if (sweepB < 0.0) sweepB += PHASE_WRAP;
  if (curlClock >= PHASE_WRAP) curlClock -= PHASE_WRAP;

  crownBase = 0.52 + liveHeight * 0.20;
  crownLift = 0.10 + liveHeight * 0.15;
  resolvedWidth = (0.035 + liveWidth * 0.105) * (1.0 + livePulse * 0.22);
  resolvedFloor = 0.10 + liveFloor * 0.10;
}

export function render3D(index, x, y, z) {
  var nx = clamp01(x);
  var ny = clamp01(y);
  var nz = clamp01(z);
  var dx = nx - 0.5;
  var dz = nz - 0.5;
  var radial = sqrt(dx * dx + dz * dz);
  var angle = atan2(dz, dx) / PI2;
  angle = angle - floor(angle);

  // Curl changes with height and radius, so the broad crown wraps around the
  // ship rather than sliding as flat horizontal bands.
  var curled = angle + (ny - 0.5) * liveCurl * 0.32
             + radial * liveCurl * 0.18
             + sin((radial * 0.73 + curlClock) * PI2) * liveCurl * 0.055;

  var lobe3A = wave(curled * 3.0 - sweepA);
  var lobe3B = wave(curled * 3.0 + sweepB + 0.3333333);
  var lobe4A = wave(curled * 4.0 + sweepB + 0.125);
  var lobe4B = wave(curled * 4.0 - sweepA + 0.625);

  // Two incommensurate, ship-length phrases let the diadem travel all the way
  // from bow to stern. Their gentle Z coupling prevents front/back surfaces
  // from reading as copies, while remaining one coherent crown.
  var spanA = wave(nx * 1.41421356 + nz * 0.437
                 - sweepA * 0.619
                 + sin((ny * 0.773 + curlClock * 0.191) * PI2)
                 * liveCurl * 0.065);
  var spanB = wave(nx * 1.73205081 - nz * 0.311
                 + sweepB * 0.527
                 + sin((nx * 0.618 + curlClock * 0.271) * PI2)
                 * liveCurl * 0.052);

  // Four monumental sheets at different radii. Each height profile is broad,
  // upper-Y, and crown-shaped; no high-frequency ribbon texture is present.
  var h1 = crownBase + crownLift * pow(lobe3A, 0.72);
  var h2 = crownBase - 0.035 + crownLift * 0.88 * pow(lobe3B, 0.78);
  var h3 = crownBase + 0.020 + crownLift * 0.78 * pow(lobe4A, 0.74);
  var h4 = crownBase - 0.070 + crownLift * 0.68 * pow(lobe4B, 0.82);
  var a1 = arcProfile(ny - h1, radial - 0.20, resolvedWidth);
  var a2 = arcProfile(ny - h2, radial - 0.34, resolvedWidth * 1.05);
  var a3 = arcProfile(ny - h3, radial - 0.48, resolvedWidth * 1.10);
  var a4 = arcProfile(ny - h4, radial - 0.62, resolvedWidth * 1.14);

  // Long diadem rails keep the upper-ship identity but remove the old radial
  // centre bias. They are intentionally broad across Z and occupy every X.
  var h5 = crownBase - 0.090 + crownLift * 0.74 * pow(spanA, 0.78);
  var h6 = crownBase - 0.145 + crownLift * 0.62 * pow(spanB, 0.84);
  var a5 = arcProfile(ny - h5, dz * 0.22, resolvedWidth * 1.20);
  var a6 = arcProfile(ny - h6, dz * 0.18, resolvedWidth * 1.27);

  var cp1Arc = max(max(a1, a3 * 0.90), a5 * 0.92);
  var cp2Arc = max(max(a2, a4 * 0.90), a6 * 0.88);
  var crown = max(cp1Arc, cp2Arc);
  var intersection = sqrt(max(0.0, cp1Arc * cp2Arc));

  // The crown casts two slow, broad aurora veils down through the whole model.
  // Only a few incommensurate folds span the ship, avoiding a repeated texture
  // field while keeping every region visibly related to the upper arcs.
  var veilA = wave(nx * 1.41421356 + nz * 0.61803399
                 + ny * 0.327 - sweepA * 0.347
                 + sin((ny * 1.73205081 + curlClock * 0.223) * PI2)
                 * liveCurl * 0.075);
  var veilB = wave(nx * 0.57735027 - nz * 1.27201965
                 - ny * 0.241 + sweepB * 0.293
                 + sin((nx * 0.80901699 - curlClock * 0.179) * PI2)
                 * liveCurl * 0.061);
  var veil = pow(max(veilA, veilB * 0.92), 1.32);
  var veilReach = 0.48 + ny * 0.30;
  var veilSignal = veil * veilReach * (0.20 + liveWidth * 0.18);
  var crownSignal = crown * 0.90 + intersection * 0.48;
  var pulseBloom = livePulse * (crown * 0.62 + intersection * 0.58);
  var levelGain = 0.10 + liveLevel * 1.16;
  var authored = clamp01((crownSignal + veilSignal) * levelGain + pulseBloom);
  var bri = resolvedFloor + (1.0 - resolvedFloor) * authored;

  // A palette-derived bed makes the safety floor spatially intentional. Crown
  // families retain distinct palette identities; overlaps become mixed light.
  var bedMix = clamp01(0.18 + ny * 0.43 + radial * 0.14
                     + (veilB - veilA) * 0.16);
  var mixValue = (cp2Arc + veilB * 0.16 + bedMix * 0.18)
               / (cp1Arc + cp2Arc + (veilA + veilB) * 0.16 + 0.18);
  mixValue = clamp01(mixValue);

  if (fixtureType == FIX_TE_SIGN) {
    // Identity crown script: each 74-pixel sign carries the same full-surface
    // diadem and facets. pixelLocalIndex makes left/right output byte-identical
    // while the nonzero floor preserves the physical T/E letter shapes.
    var signU = clamp01(pixelLocalIndex / 39.0);
    var signArch = wave(signU * 1.0 - sweepA * 0.553
                     + sin((signU * 0.61803399 + curlClock * 0.173) * PI2)
                     * liveCurl * 0.082);
    var signFacet = wave(signU * 2.0 + sweepB * 0.419
                      + sin((signU * 1.41421356 - curlClock * 0.137) * PI2)
                      * liveCurl * 0.047);
    var signCrown = clamp01(pow(signArch, 0.74) * 0.72
                          + pow(signFacet, 1.65) * 0.38);
    var signKeep = resolvedFloor + 0.09;
    var signBri = signKeep + (1.0 - signKeep)
                * clamp01(signCrown * (0.34 + liveLevel * 0.56)
                        + livePulse * 0.24);
    bri = signBri;
    mixValue = clamp01(0.30 + signU * 0.32
                     + (signFacet - signArch) * 0.22);
  }

  var r = (pr1 + (pr2 - pr1) * mixValue) * bri;
  var g = (pg1 + (pg2 - pg1) * mixValue) * bri;
  var b = (pb1 + (pb2 - pb1) * mixValue) * bri;

  // No native white/amber is needed; both lanes remain exactly zero.
  rgbwau(clamp01(r), clamp01(g), clamp01(b), 0.0, 0.0, 0.0);
}
