// DRAFT — pending operator review
/*
  24_bead_counter.js — BEAD COUNTER

  CONCEPT
    The Vintage six-head rails become a room-sized base-six counter. Each rail
    holds one readable digit for most of an interval, then only the heads whose
    mathematical place must carry crossfade to their next state. This is slow,
    deterministic counting—never random sparkle.

  INSTRUMENT STAGING
    Jewelry is the hero counter with matched native W+A on each selected bead.
    Hull Canvas repeats the active heads as broad place-value ribs, Silhouette
    holds a stable palette baseline with restrained digit notches, Organs mark
    genuine carry events, and both Identity fixtures draw the same six-step
    counter glyph across each complete 74-pixel Identity surface.

  MOTION / MATH
    One continuous accumulator advances an integer odometer modulo 6^6. A
    base-six divisor extracts the old and next digit for every spatial place.
    An eased carry occupies at most the final 20% of an interval, so settled
    states remain readable for at least 80%. The long modulo is an intentional
    complete odometer rollover, not a fractional phase seam.

  CONTROLS (declaration order = physical MIDI order)
    localSpeed    — rate of integer advances.
    places        — two through five active base-six place values.
    hold          — duration of each settled state before the eased carry.
    beadGlow      — prominence of the selected bead on every counter surface.
    carryFlash    — brightness of mathematically genuine carry marks.
    jewelryWhite — matched W+A intensity on the Vintage selected beads.
    safetyFloor   — palette-derived whole-rig visibility floor.

  AUDIO_MODULATION_V1:
    sliderCarryFlash <- micFlux range 0.05..0.35 curve ease  # builds illuminate genuine carries
    sliderBeadGlow   <- micHigh range 0.18..0.48 curve pow2  # highs polish the selected beads
  Static (unmapped) params: localSpeed, places, hold, jewelryWhite,
    safetyFloor, colorPalette1/2.

  COLOR / OUTPUT
    RGB stays on the straight cp1-to-cp2 line. Only Vintage rails emit native
    white; W and A are identical and UV is always zero. Silence is a complete,
    slowly counting ambient composition with no accidental blackout.
*/

export var cp1H = 0.585, cp1S = 0.78, cp1V = 0.82;
export var cp2H = 0.105, cp2S = 0.62, cp2V = 1.00;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export var localSpeed = 0.34;
export var places = 0.10;
export var hold = 0.62;
export var beadGlow = 0.38;
export var carryFlash = 0.20;
export var jewelryWhite = 0.72;
export var safetyFloor = 0.28;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderPlaces(v) { places = v; }
export function sliderHold(v) { hold = v; }
export function sliderBeadGlow(v) { beadGlow = v; }
export function sliderCarryFlash(v) { carryFlash = v; }
export function sliderJewelryWhite(v) { jewelryWhite = v; }
export function sliderSafetyFloor(v) { safetyFloor = v; }

var COUNTER_WRAP = 46656.0;
// Begin inside the first long hold, near enough to its carry that an operator
// sees the counting grammar promptly after load. Every later interval still
// spends the full authored 80–96% in a settled state.
var counterPhase = 0.70;
var stateCurrent = 0.0;
var stateNext = 1.0;
var carryEase = 0.0;
var carryPulse = 0.0;
var settleGauge = 0.0;
var settleGaugeWidth = 0.10;

var livePlaces = 4.0;
var liveHold = 0.62;
var liveBeadGlow = 0.38;
var liveCarryFlash = 0.20;
var liveJewelryWhite = 0.72;
var liveSafetyFloor = 0.28;

var pr1 = 1.0, pg1 = 0.0, pb1 = 0.0;
var pr2 = 0.0, pg2 = 0.0, pb2 = 1.0;

function clamp01(value) {
  if (value < 0.0) return 0.0;
  if (value > 1.0) return 1.0;
  return value;
}

function smooth01(value) {
  var sv = clamp01(value);
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

  var follow = min(1.0, dt * 6.0);
  liveHold += (clamp01(hold) - liveHold) * follow;
  liveBeadGlow += (clamp01(beadGlow) - liveBeadGlow) * follow;
  liveCarryFlash += (clamp01(carryFlash) - liveCarryFlash) * follow;
  liveJewelryWhite += (clamp01(jewelryWhite) - liveJewelryWhite) * follow;
  liveSafetyFloor += (clamp01(safetyFloor) - liveSafetyFloor) * follow;
  // Preserve the full two-to-five-place range while giving the restrained
  // saved value three visible places. The square-root taper reserves useful
  // travel for low-count editing instead of hiding the third place until a
  // large knob move.
  livePlaces = 2.0 + floor(sqrt(clamp01(places)) * 3.999);

  var localMult = 0.25 + clamp01(localSpeed)
    * (32.824 - 16.412 * clamp01(localSpeed));
  counterPhase += dt * 0.22 * localMult;
  if (counterPhase >= COUNTER_WRAP) counterPhase -= COUNTER_WRAP;

  stateCurrent = floor(counterPhase);
  stateNext = stateCurrent + 1.0;
  if (stateNext >= COUNTER_WRAP) stateNext = 0.0;

  var intervalPhase = counterPhase - stateCurrent;
  var holdBoundary = 0.80 + liveHold * 0.16;
  settleGauge = smooth01(intervalPhase / holdBoundary);
  // A short hold draws a broad elapsed-time ribbon; a long hold narrows it to
  // a precise pointer. This makes the timing choice readable before the carry
  // without changing which numerical heads are selected.
  settleGaugeWidth = 0.055 + (1.0 - liveHold) * 0.175;
  carryEase = smooth01((intervalPhase - holdBoundary)
                     / (1.0 - holdBoundary));
  carryPulse = 4.0 * carryEase * (1.0 - carryEase);

  _hsv2rgb1();
  _hsv2rgb2();
}

export function render3D(index, x, y, z) {
  var isBar = fixtureType == FIX_BAR_18;
  var isRaw = fixtureType == FIX_RAW_LED;
  var isVintage = fixtureType == FIX_VINTAGE_6;
  var isPar = fixtureType == FIX_PAR;
  var isSign = fixtureType == FIX_TE_SIGN;

  // Unlike the six-head Vintage fixtures, each sign is one physical 74-pixel
  // surface patched as 40 + 34. Keep these coordinates separate so the sign
  // can author complete place columns without changing Jewelry head logic.
  var signIndex = 0.0;
  var signColumn = 0.0;
  var signRow = 0.0;
  if (isSign) {
    signIndex = index % 74.0;
    signColumn = signIndex % 10.0;
    signRow = floor(signIndex / 10.0);
  }

  // Assign every counter surface to one place value. At the saved default the
  // sign's ten columns resolve into three broad, visibly separate places.
  var placeIndex = 0.0;
  if (isVintage) placeIndex = fixtureId % livePlaces;
  else if (isSign) placeIndex = floor((signColumn + 0.5)
                                     * livePlaces / 10.0);
  else placeIndex = floor(clamp01(x * 0.47 + z * 0.53) * livePlaces);
  if (placeIndex >= livePlaces) placeIndex = livePlaces - 1.0;

  var divisor = 1.0;
  var placeStep = 0.0;
  for (placeStep = 0.0; placeStep < 5.0; placeStep = placeStep + 1.0) {
    if (placeStep < placeIndex) divisor = divisor * 6.0;
  }
  var digitCurrent = floor(stateCurrent / divisor) % 6.0;
  var digitNext = floor(stateNext / divisor) % 6.0;
  var changed = 0.0;
  if (digitCurrent != digitNext) changed = 1.0;

  // Every instrument projects its local pixels onto the same six discrete
  // heads. Three Hull pixels and roughly seven Silhouette pixels share a head;
  // Vintage heads remain fixture-local. Identity uses rows 1..6 as its six
  // bead positions, leaving rows 0 and 7 to frame the multi-place display.
  var head = 0.0;
  if (isVintage) head = pixelLocalIndex % 6.0;
  else if (isSign) head = signRow - 1.0;
  else if (isBar) head = floor(pixelLocalIndex / 3.0);
  else if (isRaw) head = floor(pixelLocalIndex * 6.0 / 40.0);
  else head = floor(clamp01(y * 0.68 + z * 0.32) * 5.999);

  var selectedCurrent = 0.0;
  var selectedNext = 0.0;
  if (head == digitCurrent) selectedCurrent = 1.0;
  if (head == digitNext) selectedNext = 1.0;
  var selected = selectedCurrent + (selectedNext - selectedCurrent) * carryEase;

  // Unchanged places stay byte-stable through the carry. Only mathematically
  // changed places receive a transient carry mark.
  var carryMark = changed * carryPulse * liveCarryFlash;
  var floorLevel = 0.045 + liveSafetyFloor * 0.185;
  var colorMix = (digitCurrent + carryEase * changed) / 5.0;
  var brightness = floorLevel;
  var nativeWhite = 0.0;

  var signFrame = 0.0;
  var signDivider = 0.0;
  if (isSign) {
    if (signRow == 0.0 || signRow == 7.0) signFrame = 1.0;
    var signPlacePhase = ((signColumn + 0.5) * livePlaces / 10.0);
    signPlacePhase = signPlacePhase - floor(signPlacePhase);
    signDivider = smoothstep(0.31, 0.48,
                             abs(signPlacePhase - 0.50));
  }

  if (isVintage) {
    brightness = floorLevel * 0.78
               + 0.045 + selected * (0.25 + liveBeadGlow * 0.72)
               + carryMark * 0.12;
    colorMix = 0.66 + colorMix * 0.30;
    nativeWhite = (0.020 + selected * (0.18 + liveBeadGlow * 0.64)
                 + carryMark * 0.16) * liveJewelryWhite;
  } else if (isBar) {
    var placeRib = 0.64 + 0.36
                 * wave((x * 1.19 - z * 1.73) + placeIndex * 0.16180339);
    var hullGaugeAxis = clamp01(x * 0.47 + z * 0.53);
    var hullGauge = smooth01(1.0 - abs(hullGaugeAxis - settleGauge)
                           / settleGaugeWidth);
    brightness = floorLevel + placeRib * 0.075
               + selected * (0.11 + liveBeadGlow * 0.66)
               + carryMark * 0.10 + hullGauge * 0.085;
    colorMix = clamp01(0.10 + colorMix * 0.64 + placeRib * 0.12);
  } else if (isRaw) {
    var outline = 0.76 + 0.24
                * wave(z * 1.41421356 + x * 0.61803399);
    var strandGaugeAxis = clamp01(x * 0.47 + z * 0.53);
    var strandGauge = smooth01(1.0 - abs(strandGaugeAxis - settleGauge)
                             / (settleGaugeWidth * 1.20));
    brightness = floorLevel * 1.18 + outline * 0.075
               + selected * (0.075 + liveBeadGlow * 0.48)
               + strandGauge * 0.055;
    colorMix = clamp01(0.12 + colorMix * 0.52);
  } else if (isPar) {
    // Pars announce only real odometer carries. The quiet armed glow ensures
    // the carry control remains legible between transitions without faking an
    // event or disturbing the long numerical hold.
    brightness = floorLevel * 1.22 + 0.075
               + liveCarryFlash * 0.035 + carryMark * 0.66;
    colorMix = clamp01(0.74 + colorMix * 0.20);
  } else if (isSign) {
    var counterSheen = wave(signColumn * 0.073 + signRow * 0.047
                           - counterPhase * 0.89)
                      * wave(signRow * 0.061 - signColumn * 0.031
                           + counterPhase * 1.41421356);
    brightness = max(floorLevel * 1.40,
                     0.12 + signFrame * 0.22 + signDivider * 0.13
                     + selected * (0.24 + liveBeadGlow * 0.72)
                     + carryMark * 0.24 + counterSheen * 0.20);
    var placeColor = placeIndex / max(1.0, livePlaces - 1.0);
    colorMix = clamp01(0.10 + colorMix * 0.42
                     + placeColor * 0.27 + signFrame * 0.11
                     + counterSheen * 0.15);
  }

  brightness = clamp01(brightness);
  nativeWhite = clamp01(nativeWhite);
  colorMix = clamp01(colorMix);
  var red = (pr1 + (pr2 - pr1) * colorMix) * brightness;
  var green = (pg1 + (pg2 - pg1) * colorMix) * brightness;
  var blue = (pb1 + (pb2 - pb1) * colorMix) * brightness;
  rgbwau(clamp01(red), clamp01(green), clamp01(blue),
         nativeWhite, nativeWhite, 0.0);
}
