// DRAFT — pending operator review
/*
  01_harbor_glass.js — HARBOR GLASS

  CONCEPT
    Five immense stained-glass cells slowly rearrange across the ship. Their
    finite nearest/second-nearest Voronoi topology makes lead-thin seams and
    broad panes, while Jewelry catches a few close-range optical refractions.
    This is glass, not water: seed migration replaces ripple/flow math, and no
    repeated wave lattice constructs the picture.

  INSTRUMENT STAGING
    FIX_BAR_18     — broad luminous panes with dark hairline lead seams.
    FIX_RAW_LED    — a crisp direct-view perimeter drawing of those seams.
    FIX_VINTAGE_6  — sparse palette-line gem refractions with restrained
                     matched W=A catchlights on fewer than 8% of heads.
    FIX_PAR        — steady warm-endpoint pane anchors.
    FIX_TE_SIGN    — paired miniature 10x8 pane maps. Both 74-pixel signs use
                     the same local-index map, a reliable floor, and active X/Y.

  MOTION / MATH
    Each of five XYZ sites begins on a golden-angle distribution and migrates
    on its own slow delta-accumulated clock, far enough to visibly redraw the
    five panes inside a 40-second capture. Clocks wrap only at an integer 10000
    turns and are consumed unscaled as radians, so wraps are seam-safe.
    Per pixel, five fixed scalar distance checks find d1 and d2; seam=d2-d1.
    No arrays or allocation occur in render3D.

  CONTROLS (declaration order = physical MIDI order)
    localSpeed    — speed of all five independent seed migrations.
    cellSize      — pane breadth/lens scale and golden-site spread.
    borderWidth   — width of the lead seam network.
    drift         — distance each stained-glass seed migrates.
    refraction    — optical edge/lens contrast inside each pane.
    jewelryGlint  — density and intensity of sparse Jewelry catchlights.
    safetyFloor   — minimum whole-ship visibility in silence.

  AUDIO_MODULATION_V1:
    sliderRefraction   <- micFlux range 0.20..0.65 curve ease  # PRIMARY: flux deepens pane refraction
    sliderJewelryGlint <- micHigh range 0.05..0.45 curve pow2 # highs add sparse Jewelry catchlights
  Static (unmapped) params: localSpeed, cellSize, borderWidth, drift,
    safetyFloor, colorPalette1/2.

  COLOR / OUTPUT
    Every RGB output lies on the straight line between the two palette RGB
    endpoints; there are no hardcoded accent colors and UV is always zero.
    The only authored white is the restrained Jewelry catchlight, emitted with
    byte-identical W and A. Defaults form a complete, calm silence look.
*/

export var localSpeed = 0.30;
export var cellSize = 0.50;
export var borderWidth = 0.28;
export var drift = 0.35;
export var refraction = 0.42;
export var jewelryGlint = 0.22;
export var safetyFloor = 0.25;

export var cp1H = 0.51, cp1S = 0.82, cp1V = 0.92;
export var cp2H = 0.105, cp2S = 0.88, cp2V = 1.00;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderCellSize(v) { cellSize = v; }
export function sliderBorderWidth(v) { borderWidth = v; }
export function sliderDrift(v) { drift = v; }
export function sliderRefraction(v) { refraction = v; }
export function sliderJewelryGlint(v) { jewelryGlint = v; }
export function sliderSafetyFloor(v) { safetyFloor = v; }

var GOLDEN_ANGLE = 2.39996323;
var GOLDEN_FRACTION = 0.61803399;
var SQRT2 = 1.41421356;
var SQRT3 = 1.73205081;
var PHASE_WRAP = 10000.0;

var pr1 = 1.0, pg1 = 0.0, pb1 = 0.0;
var pr2 = 0.0, pg2 = 0.0, pb2 = 1.0;
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
  else if (iv == 4.0) { pr2 = tv;   pg2 = pv;   pb2 = qv;   }
  else                 { pr2 = cp2V; pg2 = pv;   pb2 = qv;   }
}

function clamp01(v) {
  if (v < 0.0) return 0.0;
  if (v > 1.0) return 1.0;
  return v;
}

var siteClock1 = 0.00;
var siteClock2 = 0.17;
var siteClock3 = 0.39;
var siteClock4 = 0.61;
var siteClock5 = 0.83;

var resolvedCellSize = 0.50;
var resolvedBorderWidth = 0.28;
var resolvedDrift = 0.35;
var resolvedRefraction = 0.42;
var resolvedJewelryGlint = 0.22;
var resolvedSafetyFloor = 0.25;

var site1x = 0.80, site1y = 0.50, site1z = 0.18;
var site2x = 0.28, site2y = 0.70, site2z = 0.58;
var site3x = 0.52, site3y = 0.20, site3z = 0.33;
var site4x = 0.65, site4y = 0.77, site4z = 0.73;
var site5x = 0.20, site5y = 0.35, site5z = 0.48;

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  // Parameter edits slew into the optical field instead of teleporting seed
  // sites or snapping seam luminance. Defaults initialize at their targets.
  var editResponse = min(1.0, dt * 4.0);
  resolvedCellSize += (cellSize - resolvedCellSize) * editResponse;
  resolvedBorderWidth += (borderWidth - resolvedBorderWidth) * editResponse;
  resolvedDrift += (drift - resolvedDrift) * editResponse;
  resolvedRefraction += (refraction - resolvedRefraction) * editResponse;
  resolvedJewelryGlint += (jewelryGlint - resolvedJewelryGlint) * editResponse;
  resolvedSafetyFloor += (safetyFloor - resolvedSafetyFloor) * editResponse;

  var localMultiplier = 0.25 + clamp01(localSpeed)
    * (32.824 - 16.412 * clamp01(localSpeed));
  siteClock1 += dt * 0.0180 * localMultiplier;
  siteClock2 += dt * 0.0229 * localMultiplier;
  siteClock3 += dt * 0.0164 * SQRT2 * localMultiplier;
  siteClock4 += dt * 0.0142 * SQRT3 * localMultiplier;
  siteClock5 += dt * 0.0203 * GOLDEN_FRACTION * localMultiplier;
  if (siteClock1 >= PHASE_WRAP) siteClock1 -= PHASE_WRAP;
  if (siteClock2 >= PHASE_WRAP) siteClock2 -= PHASE_WRAP;
  if (siteClock3 >= PHASE_WRAP) siteClock3 -= PHASE_WRAP;
  if (siteClock4 >= PHASE_WRAP) siteClock4 -= PHASE_WRAP;
  if (siteClock5 >= PHASE_WRAP) siteClock5 -= PHASE_WRAP;

  var spread = 0.36 - resolvedCellSize * 0.13;
  var migration = 0.018 + resolvedDrift * 0.145;

  site1x = 0.50 + spread * cos(0.0 * GOLDEN_ANGLE)
         + migration * cos(siteClock1 * PI2 + 0.0 * GOLDEN_ANGLE);
  site1y = 0.50 + spread * sin(0.0 * GOLDEN_ANGLE)
         + migration * sin(siteClock1 * PI2 + 0.5 * GOLDEN_ANGLE);
  site1z = 0.18 + migration * 0.72 * sin(siteClock1 * PI2 + 1.0 * GOLDEN_ANGLE);

  site2x = 0.50 + spread * cos(1.0 * GOLDEN_ANGLE)
         + migration * cos(siteClock2 * PI2 + 1.0 * GOLDEN_ANGLE);
  site2y = 0.50 + spread * sin(1.0 * GOLDEN_ANGLE)
         + migration * sin(siteClock2 * PI2 + 1.5 * GOLDEN_ANGLE);
  site2z = 0.18 + 0.64 * frac(GOLDEN_FRACTION)
         + migration * 0.72 * sin(siteClock2 * PI2 + 2.0 * GOLDEN_ANGLE);

  site3x = 0.50 + spread * cos(2.0 * GOLDEN_ANGLE)
         + migration * cos(siteClock3 * PI2 + 2.0 * GOLDEN_ANGLE);
  site3y = 0.50 + spread * sin(2.0 * GOLDEN_ANGLE)
         + migration * sin(siteClock3 * PI2 + 2.5 * GOLDEN_ANGLE);
  site3z = 0.18 + 0.64 * frac(2.0 * GOLDEN_FRACTION)
         + migration * 0.72 * sin(siteClock3 * PI2 + 3.0 * GOLDEN_ANGLE);

  site4x = 0.50 + spread * cos(3.0 * GOLDEN_ANGLE)
         + migration * cos(siteClock4 * PI2 + 3.0 * GOLDEN_ANGLE);
  site4y = 0.50 + spread * sin(3.0 * GOLDEN_ANGLE)
         + migration * sin(siteClock4 * PI2 + 3.5 * GOLDEN_ANGLE);
  site4z = 0.18 + 0.64 * frac(3.0 * GOLDEN_FRACTION)
         + migration * 0.72 * sin(siteClock4 * PI2 + 4.0 * GOLDEN_ANGLE);

  site5x = 0.50 + spread * cos(4.0 * GOLDEN_ANGLE)
         + migration * cos(siteClock5 * PI2 + 4.0 * GOLDEN_ANGLE);
  site5y = 0.50 + spread * sin(4.0 * GOLDEN_ANGLE)
         + migration * sin(siteClock5 * PI2 + 4.5 * GOLDEN_ANGLE);
  site5z = 0.18 + 0.64 * frac(4.0 * GOLDEN_FRACTION)
         + migration * 0.72 * sin(siteClock5 * PI2 + 5.0 * GOLDEN_ANGLE);

  _hsv2rgb1();
  _hsv2rgb2();
}

export function render3D(index, x, y, z) {
  var mx = clamp01(x);
  var my = clamp01(y);
  var mz = clamp01(z);

  if (fixtureType == FIX_TE_SIGN) {
    // Fold both physical 74-pixel signs onto one authored 10x8 surface. The
    // fixtures are patched as 40 + 34 pixels, so fixture-local indices would
    // repeat the lower half instead of completing the pane map.
    var signIndex = index % 74.0;
    mx = (signIndex % 10.0) / 9.0;
    my = floor(signIndex / 10.0) / 7.0;
    mz = 0.38 + mx * 0.14 + my * 0.08;
  }

  // Fixed five-site scalar nearest/second-nearest search. Distances are kept
  // squared for comparison, then converted once so the authored seam is the
  // literal difference d2-d1.
  var dx1 = mx - site1x;
  var dy1 = my - site1y;
  var dz1 = mz - site1z;
  var nearestDistance = dx1 * dx1 + dy1 * dy1 + dz1 * dz1;
  var secondDistance = 10.0;
  var cellId = 0.0;

  var dx2 = mx - site2x;
  var dy2 = my - site2y;
  var dz2 = mz - site2z;
  var candidateDistance = dx2 * dx2 + dy2 * dy2 + dz2 * dz2;
  if (candidateDistance < nearestDistance) {
    secondDistance = nearestDistance;
    nearestDistance = candidateDistance;
    cellId = 1.0;
  } else {
    secondDistance = candidateDistance;
  }

  var dx3 = mx - site3x;
  var dy3 = my - site3y;
  var dz3 = mz - site3z;
  candidateDistance = dx3 * dx3 + dy3 * dy3 + dz3 * dz3;
  if (candidateDistance < nearestDistance) {
    secondDistance = nearestDistance;
    nearestDistance = candidateDistance;
    cellId = 2.0;
  } else if (candidateDistance < secondDistance) {
    secondDistance = candidateDistance;
  }

  var dx4 = mx - site4x;
  var dy4 = my - site4y;
  var dz4 = mz - site4z;
  candidateDistance = dx4 * dx4 + dy4 * dy4 + dz4 * dz4;
  if (candidateDistance < nearestDistance) {
    secondDistance = nearestDistance;
    nearestDistance = candidateDistance;
    cellId = 3.0;
  } else if (candidateDistance < secondDistance) {
    secondDistance = candidateDistance;
  }

  var dx5 = mx - site5x;
  var dy5 = my - site5y;
  var dz5 = mz - site5z;
  candidateDistance = dx5 * dx5 + dy5 * dy5 + dz5 * dz5;
  if (candidateDistance < nearestDistance) {
    secondDistance = nearestDistance;
    nearestDistance = candidateDistance;
    cellId = 4.0;
  } else if (candidateDistance < secondDistance) {
    secondDistance = candidateDistance;
  }

  var d1 = sqrt(nearestDistance);
  var d2 = sqrt(secondDistance);
  var seam = d2 - d1;
  var seamWidth = 0.004 + resolvedBorderWidth * 0.060;
  var border = 1.0 - smoothstep(seamWidth * 0.62,
                                seamWidth * 1.38, seam);

  var lensRadius = 0.19 + resolvedCellSize * 0.29;
  var lens = clamp01(1.0 - d1 / lensRadius);
  lens = lens * lens * (3.0 - 2.0 * lens);
  var nearLead = clamp01(1.0 - seam / (seamWidth * 4.6));
  nearLead = nearLead * nearLead * (1.0 - border);
  var refracted = clamp01(lens * 0.48 + nearLead * 0.86);

  // Five broad, ordered palette positions make the topology readable while
  // every optical shift remains strictly on the selected RGB line.
  var paletteMix = 0.06;
  if      (cellId == 1.0) paletteMix = 0.28;
  else if (cellId == 2.0) paletteMix = 0.50;
  else if (cellId == 3.0) paletteMix = 0.72;
  else if (cellId == 4.0) paletteMix = 0.94;
  paletteMix = clamp01(paletteMix
                     + (refracted - 0.50) * resolvedRefraction * 0.16);

  var floorLevel = 0.04 + resolvedSafetyFloor * 0.40;
  // A fixed material value per finite cell makes the five panes read as
  // coarse glass at gallery scale. Refraction remains close detail instead
  // of turning the field into caustic shimmer.
  var paneTone = 0.58;
  if      (cellId == 1.0) paneTone = 0.76;
  else if (cellId == 2.0) paneTone = 0.64;
  else if (cellId == 3.0) paneTone = 0.84;
  else if (cellId == 4.0) paneTone = 0.70;
  var paneEnergy = paneTone + lens * 0.09
                 + refracted * resolvedRefraction * 0.10;
  var body = floorLevel + (1.0 - floorLevel) * paneEnergy
           * (1.0 - border * 0.91);
  var whiteLevel = 0.0;

  if (fixtureType == FIX_RAW_LED) {
    // Direct-view strands draw the topology as a sharp bright perimeter. A
    // lit pane floor between seams preserves the ship outline at playa range.
    body = floorLevel + (1.0 - floorLevel)
         * clamp01(0.18 + border * 0.82 + lens * 0.12);
    paletteMix = clamp01(paletteMix + border * 0.08);
  } else if (fixtureType == FIX_BAR_18) {
    // Bars are the stained-glass canvas: broad panes, dark lead, slow lensing.
    body = floorLevel + (1.0 - floorLevel)
         * clamp01((0.34 + paneTone * 0.56 + lens * 0.07
                  + refracted * resolvedRefraction * 0.10)
                 * (1.0 - border * 0.97));
  } else if (fixtureType == FIX_VINTAGE_6) {
    // Golden-angle indexing breaks fixture rows into isolated RGB jewelry
    // refractions; it does not construct the Voronoi topology.
    var gemPhase = 0.5 + 0.5 * sin(index * GOLDEN_ANGLE
                                 + siteClock3 * PI2);
    var gemCut = pow(gemPhase, 11.0) * refracted;
    body = floorLevel * 0.78
         + gemCut * (0.22 + resolvedRefraction * 0.66
                   + resolvedJewelryGlint * 1.45)
         + lens * 0.08;
    paletteMix = clamp01(paletteMix
                       + gemCut * (resolvedRefraction * 0.26
                                 + resolvedJewelryGlint * 0.42));

    // Even at full JewelryGlint, the analytic gate occupies under 8% of a
    // sine cycle. W and A share this exact restrained catchlight expression.
    var catchPhase = 0.5 + 0.5 * sin(index * GOLDEN_ANGLE * GOLDEN_FRACTION
                                   + siteClock5 * PI2);
    var catchGate = 0.998 - resolvedJewelryGlint * 0.012;
    if (catchPhase > catchGate && resolvedJewelryGlint > 0.0) {
      whiteLevel = (catchPhase - catchGate) / (1.0 - catchGate);
      whiteLevel = pow(clamp01(whiteLevel), 2.0)
                 * resolvedJewelryGlint * 0.45
                 * (0.35 + refracted * 0.65);
    }
  } else if (fixtureType == FIX_PAR) {
    // Pars pin toward the warm palette endpoint; no hardcoded amber RGB is
    // introduced, so a changed operator palette remains fully authoritative.
    paletteMix = clamp01(0.76 + paletteMix * 0.20);
    body = floorLevel + (1.0 - floorLevel)
         * clamp01(0.47 + lens * 0.22 - border * 0.24);
  } else if (fixtureType == FIX_TE_SIGN) {
    // Paired miniature panes keep a higher floor and use both pseudo-map axes.
    // Border, lens, and cell identity all remain active across each letter.
    body = clamp01(floorLevel + 0.14
                 + (1.0 - border) * 0.24
                 + lens * 0.13
                 + refracted * resolvedRefraction * 0.16
                 + border * 0.08);
    paletteMix = clamp01(paletteMix + (mx - 0.5) * 0.10
                       + (my - 0.5) * 0.08);
  }

  body = clamp01(body);
  whiteLevel = clamp01(whiteLevel);
  var red = (pr1 + (pr2 - pr1) * paletteMix) * body;
  var green = (pg1 + (pg2 - pg1) * paletteMix) * body;
  var blue = (pb1 + (pb2 - pb1) * paletteMix) * body;
  rgbwau(clamp01(red), clamp01(green), clamp01(blue),
         whiteLevel, whiteLevel, 0.0);
}
