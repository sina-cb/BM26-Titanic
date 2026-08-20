// DRAFT — pending operator review
/*
  19_split_lens.js — SPLIT LENS

  CONCEPT
    The ship is one constant-area lenticular sheet. Broad finite lens bands
    keep their footprint while a slowly turning plane normal flips each band
    between the two palette materials. This is an angular material change,
    not a luminous lattice or a traveling brightness wash.

  INSTRUMENT STAGING
    FIX_BAR_18     — the full lenticular sheet and its restrained lens seams.
    FIX_RAW_LED    — a bright perimeter reading of the same angular material.
    FIX_VINTAGE_6  — sparse palette-RGB glints at lens crossings; no white.
    FIX_PAR        — four normal markers that hand the material around Organs.
    FIX_TE_SIGN    — paired fixture-local lenticular cards; both signs use the
                     same coordinate map and therefore remain byte-balanced.

  MOTION / MATH
    Two signed delta accumulators turn an X/Z plane normal at incommensurate
    1:sqrt(2) rates. A dot product projects every pixel onto that normal. Broad
    finite bands use a narrow cubic transition around their midpoint, leaving
    most pixels close to a palette endpoint while total lit area stays fixed.

  CONTROLS (declaration order = physical MIDI order)
    localSpeed  — angular speed of the rotating lens normal.
    direction   — genuine signed reversal; centre keeps a guarded slow motion.
    splitAngle  — resting angular bias of the lenticular sheet.
    bandWidth   — width of each broad finite lens band.
    parallax    — depth/y displacement of the material flip.
    contrast    — endpoint separation and shallow lenticular relief.
    safetyFloor — dependable whole-rig minimum light.

  AUDIO_MODULATION_V1:
    sliderParallax <- micFlux range 0.22..0.58 curve ease   # flux shifts the lens depth
    sliderContrast <- micMid  range 0.30..0.65 curve linear # mids separate the two materials
  Static (unmapped) params: localSpeed, direction, splitAngle, bandWidth,
    safetyFloor, colorPalette1/2.

  COLOR / OUTPUT
    Every RGB result lies on the cp1-to-cp2 line before scalar intensity.
    Native white and UV are intentionally absent: W=A=U=0 exactly.
*/

export var localSpeed = 0.30;
export var direction = 0.78;
export var splitAngle = 0.46;
export var bandWidth = 0.53;
export var parallax = 0.38;
export var contrast = 0.72;
export var safetyFloor = 0.28;

export var cp1H = 0.55, cp1S = 0.82, cp1V = 0.92;
export var cp2H = 0.09, cp2S = 0.88, cp2V = 1.00;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderDirection(v) { direction = v; }
export function sliderSplitAngle(v) { splitAngle = v; }
export function sliderBandWidth(v) { bandWidth = v; }
export function sliderParallax(v) { parallax = v; }
export function sliderContrast(v) { contrast = v; }
export function sliderSafetyFloor(v) { safetyFloor = v; }

var SQRT2 = 1.41421356;
var GOLDEN_ANGLE = 2.39996323;
var PHASE_WRAP = 10000.0;

var lensPhase = 0.0;
var depthPhase = 0.0;
var normalX = 1.0;
var normalY = 0.0;
var normalZ = 0.0;
var depthShift = 0.0;

var liveDirection = 0.78;
var liveSplitAngle = 0.46;
var liveBandWidth = 0.53;
var liveParallax = 0.38;
var liveContrast = 0.72;
var liveSafetyFloor = 0.28;

var pr1 = 1.0, pg1 = 0.0, pb1 = 0.0;
var pr2 = 0.0, pg2 = 0.0, pb2 = 1.0;

function clamp01(v) {
  if (v < 0.0) return 0.0;
  if (v > 1.0) return 1.0;
  return v;
}

function smooth01(v) {
  var sv = clamp01(v);
  return sv * sv * (3.0 - 2.0 * sv);
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

  // Geometry-bearing live edits slew into the sheet instead of jumping.
  var follow = min(1.0, dt * 5.0);
  liveDirection += (direction - liveDirection) * follow;
  liveSplitAngle += (splitAngle - liveSplitAngle) * follow;
  liveBandWidth += (bandWidth - liveBandWidth) * follow;
  liveParallax += (parallax - liveParallax) * follow;
  liveContrast += (contrast - liveContrast) * follow;
  liveSafetyFloor += (safetyFloor - liveSafetyFloor) * follow;

  var heading = liveDirection * 2.0 - 1.0;
  if (heading >= 0.0 && heading < 0.06) heading = 0.06;
  else if (heading < 0.0 && heading > -0.06) heading = -0.06;

  var localMultiplier = 0.25 + clamp01(localSpeed)
    * (32.824 - 16.412 * clamp01(localSpeed));
  var rate = 0.028 + localMultiplier * 0.065;
  lensPhase += dt * rate * heading;
  depthPhase += dt * rate * SQRT2 * heading;
  if (lensPhase >= PHASE_WRAP) lensPhase -= PHASE_WRAP;
  else if (lensPhase < 0.0) lensPhase += PHASE_WRAP;
  if (depthPhase >= PHASE_WRAP) depthPhase -= PHASE_WRAP;
  else if (depthPhase < 0.0) depthPhase += PHASE_WRAP;

  var biasAngle = (liveSplitAngle - 0.5) * PI * 1.60;
  var movingAngle = biasAngle + lensPhase * PI2;
  normalX = cos(movingAngle);
  normalZ = sin(movingAngle);
  normalY = sin(depthPhase * PI2) * (0.07 + liveParallax * 0.46);
  var normalLength = sqrt(normalX * normalX + normalY * normalY
                        + normalZ * normalZ) + 0.0001;
  normalX /= normalLength;
  normalY /= normalLength;
  normalZ /= normalLength;
  depthShift = sin(depthPhase * PI2 + GOLDEN_ANGLE)
             * (0.018 + liveParallax * 0.145);

  _hsv2rgb1();
  _hsv2rgb2();
}

export function render3D(index, x, y, z) {
  var ux = clamp01(x);
  var uy = clamp01(y);
  var uz = clamp01(z);
  var isSign = fixtureType == FIX_TE_SIGN;

  if (isSign) {
    // Fold both physical fixtures across the complete 74-pixel lenticular
    // card. The final 10x8 row is partial by authored topology.
    var signIndex = index % 74.0;
    ux = (signIndex % 10.0) / 9.0;
    uy = floor(signIndex / 10.0) / 7.0;
    uz = 0.50 + (uy - 0.50) * 0.18;
  }

  var qx = ux - 0.50;
  var qy = uy - 0.50;
  var qz = uz - 0.50;
  var projection = qx * normalX + qy * normalY + qz * normalZ;
  projection += depthShift * (0.30 + liveParallax * 0.70);

  // BandWidth changes physical band size, never the illuminated footprint.
  // The fixed offset prevents a sheet-wide seam from sitting at coordinate 0.
  var physicalWidth = 0.105 + liveBandWidth * 0.245;
  var bandCoordinate = projection / physicalWidth + 17.0;
  var bandIndex = floor(bandCoordinate);
  var bandU = bandCoordinate - bandIndex;

  // Adjacent broad lenses face opposite ways. Only a narrow middle portion
  // blends; most of each finite band is pinned close to a palette endpoint.
  var lensU = bandU;
  if ((bandIndex % 2.0) != 0.0) lensU = 1.0 - lensU;
  var transitionHalf = 0.035 + (1.0 - liveContrast) * 0.115;
  var materialMix = smooth01((lensU - (0.50 - transitionHalf))
                           / (transitionHalf * 2.0));

  // A shallow relief reveals the sheet without turning it into a brightness
  // lattice. Its mean remains constant as the normal turns.
  var centerDistance = abs(bandU - 0.50) * 2.0;
  var centerRelief = 1.0 - smooth01(centerDistance);
  var edgeDistance = min(bandU, 1.0 - bandU);
  var seam = 1.0 - smooth01(edgeDistance / 0.075);
  var relief = (centerRelief - 0.50) * (0.025 + liveContrast * 0.090);
  // At the upper end the safety control deliberately lifts the darkest lens
  // separators and Jewelry bed; at the lower end the rib contrast remains.
  var floorLevel = 0.06 + liveSafetyFloor * 0.44;
  // Narrow dark separators make this unmistakably one ribbed lenticular
  // sheet with many finite lenses, not two flat halves exchanging color.
  var brightness = 0.60 + relief - seam * (0.025 + liveContrast * 0.075);

  if (fixtureType == FIX_RAW_LED) {
    // The Silhouette carries a brighter perimeter reading of the same lens.
    brightness = 0.70 + relief * 0.76 - seam * 0.055;
  } else if (fixtureType == FIX_VINTAGE_6) {
    // Palette-RGB jewelry glints at sparse lens crossings. No native white.
    var sparkleWave = 0.5 + 0.5 * cos(pixelLocalIndex * GOLDEN_ANGLE
                                   + lensPhase * PI2
                                   + bandIndex * SQRT2);
    var sparkle = pow(sparkleWave, 12.0);
    brightness = 0.28 + centerRelief * 0.10 + sparkle * 0.57;
    materialMix = clamp01(materialMix + sparkle * 0.16);
  } else if (fixtureType == FIX_PAR) {
    // Organs mark the normal's four broad quadrants instead of reproducing
    // fine lens bands on single-pixel fixtures.
    var markerAngle = (pixelLocalIndex % 4.0) * PI * 0.5;
    var markerFacing = 0.5 + 0.5
                     * (normalX * cos(markerAngle) + normalZ * sin(markerAngle));
    brightness = 0.46 + markerFacing * 0.36;
    materialMix = smooth01((markerFacing - 0.30) / 0.40);
  } else if (isSign) {
    // Identity is a paired, high-contrast lenticular card with a firm floor.
    brightness = 0.59 + centerRelief * 0.10 - seam * 0.065;
    materialMix = clamp01(materialMix + (uy - 0.50) * 0.035);
  }

  // Material contrast changes the luminance separation of the two faces as
  // well as sharpening their color boundary. The symmetric factors preserve
  // mean lit area while making the control visually and metrically truthful.
  var materialLight = 1.0 - liveContrast * 0.25
                    + materialMix * liveContrast * 0.50;
  // A restrained face-light follows the signed plane normal. Besides giving
  // the sheet physical depth, this makes clockwise/counter-clockwise motion
  // visibly reverse instead of rotating an entirely symmetric brightness map.
  var normalLight = projection * (0.045 + liveContrast * 0.095);
  brightness = brightness * materialLight + normalLight;
  brightness = max(floorLevel, clamp01(brightness));
  materialMix = clamp01(materialMix);
  var outR = (pr1 + (pr2 - pr1) * materialMix) * brightness;
  var outG = (pg1 + (pg2 - pg1) * materialMix) * brightness;
  var outB = (pb1 + (pb2 - pb1) * materialMix) * brightness;
  rgbwau(clamp01(outR), clamp01(outG), clamp01(outB), 0.0, 0.0, 0.0);
}
