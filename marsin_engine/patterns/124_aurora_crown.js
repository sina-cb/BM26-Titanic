// DRAFT — pending operator review
/*
  124_aurora_crown.js — four enormous aurora arcs crown the installation.

  Broad concentric arcs occupy normalized upper Y and curl around the XZ axis.
  Three-lobe and four-lobe crown profiles counter-sweep through one another, so
  the ship appears to wear a slowly moving luminous crown at long distance.
  This is intentionally monumental rather than 33's close-up folded ribbons.

  A palette-derived safety floor is hard-constrained to 0.10..0.20 on every
  pixel. All visible colour lies strictly on the cp1<->cp2 RGB line. Geometry is
  normalized XYZ only; the optional TE-sign branch turns arc intersections into
  a crown jewel without using an authored view, controller, or raw fixture id.

  CONTROLS (declaration order = physical MIDI order)
    localSpeed  — crown sweep/curl rate; zero still creeps.
    level       — luminous crown energy above the safety floor.
    crownHeight — raises the crown and increases its upper-Y reach.
    arcWidth    — broad angular-sheet thickness of all four arcs.
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

  var cp1Arc = max(a1, a3 * 0.90);
  var cp2Arc = max(a2, a4 * 0.90);
  var crown = max(cp1Arc, cp2Arc);
  var intersection = sqrt(max(0.0, cp1Arc * cp2Arc));
  var crownSignal = crown * 0.90 + intersection * 0.48;
  var pulseBloom = livePulse * (crown * 0.62 + intersection * 0.58);
  var levelGain = 0.10 + liveLevel * 1.16;
  var authored = clamp01(crownSignal * levelGain + pulseBloom);
  var bri = resolvedFloor + (1.0 - resolvedFloor) * authored;

  // A palette-derived bed makes the safety floor spatially intentional. Crown
  // families retain distinct palette identities; overlaps become mixed light.
  var bedMix = clamp01(0.18 + ny * 0.58 + radial * 0.22);
  var mixValue = (cp2Arc + bedMix * 0.18)
               / (cp1Arc + cp2Arc + 0.18);
  mixValue = clamp01(mixValue);

  if (fixtureType == FIX_TE_SIGN) {
    // Identity crown jewel: broad arc intersections refract through XYZ. The
    // prism is continuous and subordinate to the same monumental crown field.
    var jewelFold = wave(dx * 1.73 + (ny - 0.5) * 2.39 - dz * 1.41
                         + sweepA - sweepB);
    var jewel = clamp01(intersection * 1.35
                      + crown * jewelFold * 0.30);
    var signKeep = resolvedFloor + 0.06;
    var signBri = signKeep + (1.0 - signKeep)
                * clamp01(authored * 0.82 + jewel * 0.52);
    if (signBri > bri) bri = signBri;
    mixValue = clamp01(0.42 + (cp2Arc - cp1Arc) * 0.42
                     + jewelFold * 0.13 + (ny - 0.5) * 0.18);
  }

  var r = (pr1 + (pr2 - pr1) * mixValue) * bri;
  var g = (pg1 + (pg2 - pg1) * mixValue) * bri;
  var b = (pb1 + (pb2 - pb1) * mixValue) * bri;

  // No native white/amber is needed; both lanes remain exactly zero.
  rgbwau(clamp01(r), clamp01(g), clamp01(b), 0.0, 0.0, 0.0);
}
