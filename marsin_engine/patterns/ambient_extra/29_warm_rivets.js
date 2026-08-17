// DRAFT — pending operator review
/*
  29_warm_rivets.js — WARM RIVETS

  CONCEPT
    The ship is assembled from large dark plates joined by a connected network
    of glowing seams. Sparse hot rivets are fixed along staggered seams while
    one slow heat packet travels through the welded structure.

  INSTRUMENT STAGING
    FIX_BAR_18     — broad plate faces, connected seams, and traveling heat.
    FIX_RAW_LED    — a continuous welded silhouette with restrained heat lift.
    FIX_VINTAGE_6  — sparse palette-RGB hot rivets; never native white.
    FIX_PAR        — weighty seam anchors that receive the passing heat packet.
    FIX_TE_SIGN    — paired animated brass nameplates in fixture-local space.

  MOTION / MATH
    A rectangular X/(Y,Z) plate grid supplies an analytic seam distance. Rivets
    are signed-distance circles centered exactly on alternating grid seams and
    fade in by a deterministic density field, so they never detach from seams.
    One wrapped heat coordinate advances over the connected grid with a second
    irrational drift preventing a short visual repeat.

  CONTROLS (declaration order = physical MIDI order)
    localSpeed   — travel rate of the heat packet.
    plateSize    — scale of the large rectangular platework.
    seamWidth    — physical width and prominence of every connected weld.
    rivetDensity — number and visibility of sparse seam-junction rivets.
    heat         — size and energy of the traveling heat packet.
    jewelryGlow  — prominence of the Vintage hot-rivet treatment.
    safetyFloor  — minimum whole-rig plate visibility.

  AUDIO_MODULATION_V1:
    sliderHeat        <- micMid  range 0.15..0.48 curve ease # mids warm the traveling weld packet
    sliderJewelryGlow <- micHigh range 0.04..0.25 curve pow2 # highs reveal the rail rivets
  Static (unmapped) params: localSpeed, plateSize, seamWidth, rivetDensity,
    safetyFloor, colorPalette1/2.

  COLOR / OUTPUT
    Every RGB result lies on the cp1-to-cp2 line. Native white and UV remain
    zero, so W=A=U=0. The default is a complete ambient look in silence.
*/

export var cp1H = 0.055, cp1S = 0.88, cp1V = 0.72;
export var cp2H = 0.115, cp2S = 0.72, cp2V = 1.00;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export var localSpeed = 0.30;
export var plateSize = 0.52;
export var seamWidth = 0.38;
export var rivetDensity = 0.38;
export var heat = 0.30;
export var jewelryGlow = 0.18;
export var safetyFloor = 0.28;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderPlateSize(v) { plateSize = v; }
export function sliderSeamWidth(v) { seamWidth = v; }
export function sliderRivetDensity(v) { rivetDensity = v; }
export function sliderHeat(v) { heat = v; }
export function sliderJewelryGlow(v) { jewelryGlow = v; }
export function sliderSafetyFloor(v) { safetyFloor = v; }

var PHI = 1.61803399;
var SQRT2 = 1.41421356;
var PHASE_WRAP = 10000.0;

var heatClock = 0.0;
var driftClock = 0.0;
var livePlateSize = 0.52;
var liveSeamWidth = 0.38;
var liveRivetDensity = 0.38;
var liveHeat = 0.30;
var liveJewelryGlow = 0.18;
var liveSafetyFloor = 0.28;

var pr1 = 1.0, pg1 = 0.0, pb1 = 0.0;
var pr2 = 1.0, pg2 = 0.6, pb2 = 0.0;

function clamp01(v) {
  if (v < 0.0) return 0.0;
  if (v > 1.0) return 1.0;
  return v;
}

function _hsv2rgb1() {
  var hv = cp1H - floor(cp1H); if (hv < 0.0) hv += 1.0;
  var iv = floor(hv * 6.0) % 6.0;
  var fv = hv * 6.0 - floor(hv * 6.0);
  var pv = cp1V * (1.0 - cp1S);
  var qv = cp1V * (1.0 - fv * cp1S);
  var tv = cp1V * (1.0 - (1.0 - fv) * cp1S);
  if      (iv == 0.0) { pr1 = cp1V; pg1 = tv;   pb1 = pv;   }
  else if (iv == 1.0) { pr1 = qv;   pg1 = cp1V; pb1 = pv;   }
  else if (iv == 2.0) { pr1 = pv;   pg1 = cp1V; pb1 = tv;   }
  else if (iv == 3.0) { pr1 = pv;   pg1 = qv;   pb1 = cp1V; }
  else if (iv == 4.0) { pr1 = tv;   pg1 = pv;   pb1 = cp1V; }
  else                 { pr1 = cp1V; pg1 = pv;   pb1 = qv;   }
}

function _hsv2rgb2() {
  var hv = cp2H - floor(cp2H); if (hv < 0.0) hv += 1.0;
  var iv = floor(hv * 6.0) % 6.0;
  var fv = hv * 6.0 - floor(hv * 6.0);
  var pv = cp2V * (1.0 - cp2S);
  var qv = cp2V * (1.0 - fv * cp2S);
  var tv = cp2V * (1.0 - (1.0 - fv) * cp2S);
  if      (iv == 0.0) { pr2 = cp2V; pg2 = tv;   pb2 = pv;   }
  else if (iv == 1.0) { pr2 = qv;   pg2 = cp2V; pb2 = pv;   }
  else if (iv == 2.0) { pr2 = pv;   pg2 = cp2V; pb2 = tv;   }
  else if (iv == 3.0) { pr2 = pv;   pg2 = qv;   pb2 = cp2V; }
  else if (iv == 4.0) { pr2 = tv;   pg2 = pv;   pb2 = cp2V; }
  else                 { pr2 = cp2V; pg2 = pv;   pb2 = qv;   }
}

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  // Smoothing keeps live slider edits from teleporting the plate geometry.
  var follow = min(1.0, dt * 5.0);
  livePlateSize += (plateSize - livePlateSize) * follow;
  liveSeamWidth += (seamWidth - liveSeamWidth) * follow;
  liveRivetDensity += (rivetDensity - liveRivetDensity) * follow;
  liveHeat += (heat - liveHeat) * follow;
  liveJewelryGlow += (jewelryGlow - liveJewelryGlow) * follow;
  liveSafetyFloor += (safetyFloor - liveSafetyFloor) * follow;

  var localMultiplier = 0.25 + clamp01(localSpeed)
    * (32.824 - 16.412 * clamp01(localSpeed));
  heatClock += dt * (0.012 + localMultiplier * 0.047);
  driftClock += dt * (0.009 + localMultiplier * 0.021) * SQRT2;
  if (heatClock >= PHASE_WRAP) heatClock -= PHASE_WRAP;
  if (driftClock >= PHASE_WRAP) driftClock -= PHASE_WRAP;

  _hsv2rgb1();
  _hsv2rgb2();
}

export function render3D(index, x, y, z) {
  var ux = clamp01(x);
  var uy = clamp01(y);
  var uz = clamp01(z);
  var isSign = fixtureType == FIX_TE_SIGN;

  if (isSign) {
    // Each sign is patched as 40 + 34 pixels. Fold one complete row-major
    // 10x8/74-pixel nameplate so the second fixture extends the weld network
    // and both complete signs remain byte-identical.
    var signIndex = index % 74.0;
    ux = (signIndex % 10.0) / 9.0;
    uy = floor(signIndex / 10.0) / 7.0;
    uz = 0.36 + uy * 0.28;
  }

  // Large rectangular plates: X sets the long shipwise divisions while a
  // Y/Z blend keeps the network legible across vertical and top surfaces.
  var columns = 2.35 + clamp01(livePlateSize) * 3.65;
  var rows = 1.75 + clamp01(livePlateSize) * 2.25;
  var vertical = clamp01(uy * 0.72 + uz * 0.28);
  var gridX = ux * columns;
  var gridY = vertical * rows + 0.5 * (floor(gridX) % 2.0);
  var cellX = gridX - floor(gridX);
  var cellY = gridY - floor(gridY);
  var edgeX = min(cellX, 1.0 - cellX);
  var edgeY = min(cellY, 1.0 - cellY);
  var seamDistance = min(edgeX, edgeY);
  var seamSize = 0.018 + clamp01(liveSeamWidth) * 0.105;
  var seam = 1.0 - smoothstep(seamSize, seamSize * 2.15, seamDistance);

  // Rivets are circles centered directly on the nearest seam. Their fixed
  // 0.19-cell radius occupies 11.34% of a cell before density thinning, below
  // the 12% area ceiling; the zero cross-seam coordinate prevents detachment.
  var alongSeam = cellX;
  if (edgeX < edgeY) alongSeam = cellY;
  var alongDistance = abs(alongSeam - 0.50);
  var rivetDistanceSquared = seamDistance * seamDistance
                           + alongDistance * alongDistance;
  var junctionX = floor(gridX + 0.5);
  var junctionY = floor(gridY + 0.5);
  var staggerHash = wave(junctionX * 1.32471796
                       + junctionY * 2.39996323 + 0.173);
  var densityThreshold = 0.92 - clamp01(liveRivetDensity) * 0.68;
  var densityGate = smoothstep(densityThreshold,
                               densityThreshold + 0.10, staggerHash);
  var rivetRadius = 0.19;
  var rivetInner = rivetRadius * 0.55;
  var rivet = (1.0 - smoothstep(rivetInner * rivetInner,
                                rivetRadius * rivetRadius,
                                rivetDistanceSquared)) * densityGate;

  // The heat packet advances around a wrapped shipwise coordinate. A small
  // row-dependent phase makes it turn through junctions without splitting
  // into an all-over wave field.
  var networkPosition = ux + floor(gridY) * 0.137
                      + sin(driftClock * PI2 + floor(gridX) * PHI) * 0.035;
  networkPosition = networkPosition - floor(networkPosition);
  var heatPosition = heatClock - floor(heatClock);
  var heatDistance = abs(networkPosition - heatPosition);
  heatDistance = min(heatDistance, 1.0 - heatDistance);
  var heatWidth = 0.045 + clamp01(liveHeat) * 0.19;
  var heatPacket = 1.0 - smoothstep(heatWidth * 0.35,
                                    heatWidth, heatDistance);
  heatPacket *= seam * (0.32 + clamp01(liveHeat) * 0.68);

  var floorLevel = 0.055 + clamp01(liveSafetyFloor) * 0.205;
  var plateGrain = 0.5 + 0.5 * sin((cellX * 0.73 + cellY * 0.41) * PI2
                                 + junctionX * 0.37 - junctionY * 0.23);
  var plateFace = 0.10 + plateGrain * 0.055;
  var brightness = floorLevel + plateFace
                 + seam * (0.22 + clamp01(liveSeamWidth) * 0.30)
                 + rivet * (0.28 + clamp01(liveRivetDensity) * 0.24)
                 + heatPacket * (0.30 + clamp01(liveHeat) * 0.42);
  var paletteMix = clamp01(0.08 + seam * 0.28 + rivet * 0.40
                          + heatPacket * 0.56 + plateGrain * 0.06);

  if (fixtureType == FIX_RAW_LED) {
    // Silhouette is a continuous welded edge, not a dotted derivative of the
    // plate faces. Heat remains visible but can never erase the outline.
    var weldGrain = wave((pixelLocalIndex / 40.0) * SQRT2
                       + driftClock * 0.19);
    brightness = floorLevel + 0.16 + weldGrain * 0.10
               + heatPacket * (0.24 + liveHeat * 0.30);
    paletteMix = clamp01(0.16 + weldGrain * 0.14 + heatPacket * 0.52);
  } else if (fixtureType == FIX_VINTAGE_6) {
    // Each six-head rail carries two attached hot fasteners. They stay on the
    // palette line and emit no native white despite their golden appearance.
    var head = pixelLocalIndex % 6.0;
    var headDistance = min(abs(head - 1.0), abs(head - 4.0));
    var railRivet = 1.0 - smoothstep(0.18, 0.82, headDistance);
    var railHeat = 0.72 + 0.28 * wave(driftClock * 0.31
                                   + fixtureId * 0.61803399);
    brightness = 0.030 + liveJewelryGlow * 0.84
               + railRivet * railHeat * (0.035 + liveJewelryGlow * 0.22)
               + heatPacket * liveHeat * 0.18;
    paletteMix = clamp01(0.62 + railRivet * 0.30 + heatPacket * 0.08);
  } else if (fixtureType == FIX_PAR) {
    // Organs are large welded anchors, alternating by fixture and receiving a
    // single weighty lift as the packet reaches their longitudinal station.
    var anchor = 0.72 + 0.28 * wave(fixtureId * 0.61803399);
    brightness = floorLevel + 0.10 + anchor * 0.16
               + heatPacket * (0.30 + liveHeat * 0.42);
    paletteMix = clamp01(0.28 + anchor * 0.16 + heatPacket * 0.50);
  } else if (isSign) {
    // A framed brass nameplate remains readable while a narrow hot weld walks
    // across its letters. Both signs are exactly paired by local coordinates.
    var frameDistance = min(min(ux, 1.0 - ux), min(uy, 1.0 - uy));
    var frame = 1.0 - smoothstep(0.035, 0.105, frameDistance);
    var letterGroove = 1.0 - smoothstep(0.035, 0.11,
      min(abs(ux - 0.30 - (uy - 0.5) * 0.22),
          abs(ux - 0.70 + (uy - 0.5) * 0.22)));
    var signHeatDistance = abs(ux - heatPosition);
    signHeatDistance = min(signHeatDistance, 1.0 - signHeatDistance);
    var signHeat = 1.0 - smoothstep(0.035, 0.19, signHeatDistance);
    brightness = max(0.30, floorLevel + 0.13 + frame * 0.22
                   + letterGroove * 0.20 + signHeat * 0.28);
    paletteMix = clamp01(0.48 + frame * 0.18
                        + letterGroove * 0.12 + signHeat * 0.20);
  }

  brightness = clamp01(brightness);
  paletteMix = clamp01(paletteMix);
  var outR = (pr1 + (pr2 - pr1) * paletteMix) * brightness;
  var outG = (pg1 + (pg2 - pg1) * paletteMix) * brightness;
  var outB = (pb1 + (pb2 - pb1) * paletteMix) * brightness;
  rgbwau(clamp01(outR), clamp01(outG), clamp01(outB), 0.0, 0.0, 0.0);
}
