// DRAFT — pending operator review
/*
  05_open_gate.js — OPEN GATE

  CONCEPT
    Two immense dark vertical doors part from the ship's center, revealing a
    luminous interior chamber, then hold open in welcome before closing. This
    is aperture/occlusion topology: symmetric finite slabs and a bright jamb,
    not the traveling wave walls of 123_mirrored_broadside_call.

  INSTRUMENT STAGING
    FIX_BAR_18     — the dark door slabs and luminous chamber they uncover.
    FIX_RAW_LED    — an always-visible doorway outline at playa distance.
    FIX_VINTAGE_6  — palette-gold RGB hinge pins at each rail's outer heads.
    FIX_PAR        — deep interior lamps that warm as the chamber opens.
    FIX_TE_SIGN    — paired, readable 10x8 chamber maps inside the reveal.

  MOTION / MATH
    A delta-driven piecewise cycle has four explicit states: closed dwell,
    eased opening, open dwell, and eased closing. The full ceremony completes
    inside 40 seconds even at the slow end of Local Speed. The aperture cuts
    two symmetric signed-distance slabs. Y/Z parallax folds reveal successive
    interior planes while a narrow jamb remains bright at the moving edge.
    Clocks wrap only at an integer 10000 cycles, so there is no visible seam.

  CONTROLS (declaration order = physical MIDI order)
    localSpeed  — speed of the complete open / hold / close ceremony.
    aperture    — maximum width of the revealed chamber.
    edgeWidth   — width of the luminous jamb around each moving door edge.
    hold        — fraction of each cycle spent fully open and welcoming.
    depth       — separation and parallax contrast of the interior planes.
    level       — chamber and structural energy above the safety floor.
    safetyFloor — minimum whole-ship visibility while the doors are closed.

  AUDIO_MODULATION_V1:
    sliderAperture  <- micFlux range 0.30..0.72 curve ease   # PRIMARY: flux opens the chamber
    sliderEdgeWidth <- micHigh range 0.10..0.38 curve linear # highs broaden the luminous jamb
  Static (unmapped) params: localSpeed, hold, depth, level, safetyFloor,
    colorPalette1/2.

  COLOR / OUTPUT
    Every emitted RGB colour lies on the selected cp1-to-cp2 line. The default
    warm endpoint makes Jewelry hinge pins read as gold without hardcoding a
    third hue. Native white and UV remain zero, so W=A exactly. Silence is a
    complete ambient look with a lit outline and a deliberate visibility floor.
*/

export var cp1H = 0.56, cp1S = 0.82, cp1V = 0.76;
export var cp2H = 0.105, cp2S = 0.76, cp2V = 1.00;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export var localSpeed = 0.30;
export var aperture = 0.58;
export var edgeWidth = 0.24;
export var hold = 0.46;
export var depth = 0.56;
export var level = 0.66;
export var safetyFloor = 0.28;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderAperture(v) { aperture = v; }
export function sliderEdgeWidth(v) { edgeWidth = v; }
export function sliderHold(v) { hold = v; }
export function sliderDepth(v) { depth = v; }
export function sliderLevel(v) { level = v; }
export function sliderSafetyFloor(v) { safetyFloor = v; }

var PHASE_WRAP = 10000.0;
var SQRT2 = 1.41421356;
var SQRT3 = 1.73205081;
var PHI = 1.61803399;

var gateClock = 0.0;
var chamberClock = 0.0;
var gateStage = 0.0;
var liveAperture = 0.58;
var liveEdgeWidth = 0.24;
var liveHold = 0.46;
var liveDepth = 0.56;
var liveLevel = 0.66;
var liveFloor = 0.28;

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
  else if (iv == 4.0) { pr2 = tv;   pg2 = pv;   pb2 = qv;   }
  else                 { pr2 = cp2V; pg2 = pv;   pb2 = qv;   }
}

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  var follow = min(1.0, dt * 4.0);
  liveAperture += (aperture - liveAperture) * follow;
  liveEdgeWidth += (edgeWidth - liveEdgeWidth) * follow;
  liveHold += (hold - liveHold) * follow;
  liveDepth += (depth - liveDepth) * follow;
  liveLevel += (level - liveLevel) * follow;
  liveFloor += (safetyFloor - liveFloor) * follow;

  var localMultiplier = 0.25 + clamp01(localSpeed)
    * (32.824 - 16.412 * clamp01(localSpeed));
  var cycleRate = 0.020 + localMultiplier * 0.050;
  gateClock += dt * cycleRate;
  chamberClock += dt * cycleRate * SQRT2;
  if (gateClock >= PHASE_WRAP) gateClock -= PHASE_WRAP;
  if (chamberClock >= PHASE_WRAP) chamberClock -= PHASE_WRAP;

  var cyclePhase = gateClock - floor(gateClock);
  var closedDwell = 0.10;
  var openDwell = 0.08 + clamp01(liveHold) * 0.34;
  var travelTime = (1.0 - closedDwell - openDwell) * 0.5;
  var openingEnd = closedDwell + travelTime;
  var holdEnd = openingEnd + openDwell;

  if (cyclePhase < closedDwell) {
    gateStage = 0.0;
  } else if (cyclePhase < openingEnd) {
    gateStage = smooth01((cyclePhase - closedDwell) / travelTime);
  } else if (cyclePhase < holdEnd) {
    gateStage = 1.0;
  } else {
    // Ease a decreasing input directly. This avoids a MarsinVM expression
    // quirk observed when subtracting a helper-call return from a literal.
    var closingProgress = (cyclePhase - holdEnd) / travelTime;
    gateStage = smooth01(1.0 - closingProgress);
  }

  _hsv2rgb1();
  _hsv2rgb2();
}

export function render3D(index, x, y, z) {
  var nx = clamp01(x);
  var ny = clamp01(y);
  var nz = clamp01(z);
  var isSign = fixtureType == FIX_TE_SIGN;

  if (isSign) {
    // Each 74-pixel sign receives the same local 10x8 chamber. This keeps the
    // pair byte-balanced while both local axes articulate the lettering.
    var signIndex = index % 74.0;
    nx = (signIndex % 10.0) / 9.0;
    ny = floor(signIndex / 10.0) / 7.0;
    nz = 0.34 + ny * 0.24;
  }

  var centerDistance = abs(nx - 0.5) * 2.0;
  var maxOpening = 0.08 + clamp01(liveAperture) * 0.90;
  // A slim welcome crack remains even during the closed dwell. Aperture owns
  // both that crack and the fully-open reach, so its whole range is visible.
  var opening = 0.012 + maxOpening * (0.10 + gateStage * 0.90);
  var signedDoor = centerDistance - opening;

  // Signed-distance jamb around the moving inner edge of each finite slab.
  var jambWidth = 0.008 + clamp01(liveEdgeWidth) * 0.200;
  var edgeDistance = abs(signedDoor);
  var jamb = 1.0 - smoothstep(jambWidth * 0.35,
                              jambWidth * 1.45, edgeDistance);
  var inside = 1.0 - smoothstep(-jambWidth * 0.30,
                                jambWidth * 0.55, signedDoor);
  var door = smoothstep(-jambWidth * 0.20,
                         jambWidth * 0.70, signedDoor);

  // Three receding interior planes make Depth a real parallax handle. Their
  // irrational Y/Z folds avoid turning the chamber into a repeated lattice.
  var plane1 = wave((ny * SQRT2 + nz * 0.37) * PI2
                  + chamberClock * PI2 * 0.31);
  var plane2 = wave((ny * 0.43 - nz * SQRT3) * PI2
                  - chamberClock * PI2 * 0.19);
  var plane3 = wave(((ny + nz) * PHI + centerDistance * 0.27) * PI2
                  + chamberClock * PI2 * 0.13);
  var depthMix = clamp01(liveDepth);
  var chamberGrain = 0.30 + plane1 * 0.22
                   + plane2 * depthMix * 0.20
                   + plane3 * depthMix * depthMix * 0.18;
  var innerDistance = clamp01(centerDistance / max(opening, 0.025));
  var chamberCore = inside * clamp01(chamberGrain
                                   + (1.0 - innerDistance) * 0.30);

  // Door faces remain deliberately dark, but engraved vertical grain keeps
  // them dimensional while closed. The seam itself is always readable.
  var slabGrain = wave((ny * 1.37 + nz * 0.61) * PI2
                     + sin((ny * 0.31 + nz * 0.53) * PI2) * 0.42);
  var floorLevel = 0.055 + clamp01(liveFloor) * 0.195;
  var authoredLevel = 0.18 + clamp01(liveLevel) * 0.82;
  // Closed slabs are massive negative-space objects. Their restrained grain
  // is enough to show material, while the revealed room and jamb occupy a
  // clearly different warm/high-luminance register.
  var brightness = floorLevel * 0.48 + authoredLevel * 0.025
                 + door * slabGrain * (0.008 + depthMix * 0.018)
                 + chamberCore * authoredLevel * 0.92
                 + jamb * authoredLevel * (0.58 + depthMix * 0.32);
  var paletteMix = clamp01(0.02 + chamberCore * 0.82
                          + jamb * 0.72 + plane3 * 0.035);

  if (fixtureType == FIX_RAW_LED) {
    // The outline never disappears: direct-view rope pixels carry the door
    // frame while the jamb brightens the opening ceremony.
    var outlineGrain = wave((pixelLocalIndex / 40.0) * SQRT2
                          + chamberClock * 0.11);
    brightness = floorLevel * 1.30 + 0.08 + authoredLevel * 0.12
               + jamb * authoredLevel * 0.58
               + inside * outlineGrain * 0.12;
    paletteMix = clamp01(0.12 + jamb * 0.34 + inside * 0.18);
  } else if (fixtureType == FIX_VINTAGE_6) {
    // The outer heads are RGB hinge pins. The inner four heads are restrained
    // chamber trim; no native white is used, keeping this palette-derived.
    var localHead = pixelLocalIndex % 6.0;
    var hinge = (localHead < 0.65 || localHead > 4.35) ? 1.0 : 0.0;
    var hingeBreath = 0.78 + 0.22 * wave(chamberClock * 0.17
                                      + fixtureId * 0.61803399);
    brightness = floorLevel * 0.62
               + hinge * hingeBreath * (0.12 + gateStage * 0.56) * authoredLevel
               + (1.0 - hinge) * jamb * 0.18;
    paletteMix = clamp01(0.78 + hinge * 0.18);
  } else if (fixtureType == FIX_PAR) {
    // Organs are deep interior lamps: broad, weighty, and explicitly tied to
    // the revealed volume rather than sparkling at the door edge.
    var lampBreath = 0.70 + 0.30 * wave(chamberClock * 0.23
                                      + nx * 0.17 + nz * 0.31);
    brightness = floorLevel * 0.72 + 0.018 + authoredLevel * 0.055
               + gateStage * authoredLevel * lampBreath * 0.82;
    paletteMix = clamp01(0.68 + lampBreath * 0.24);
  } else if (isSign) {
    // The lettering lives inside a compact chamber with a stronger floor.
    // Broad local-coordinate jambs animate without breaking sign legibility.
    var signFrame = 1.0 - smoothstep(0.055, 0.16,
                                    min(abs(nx - 0.08), abs(nx - 0.92)));
    var signRoom = inside * (0.34 + chamberGrain * 0.34);
    var welcomeSheen = wave(nx * 0.67 + ny * 0.39
                           - chamberClock * 0.73)
                      * wave(ny * 0.53 - nx * 0.31
                           + chamberClock * 1.41421356);
    brightness = max(floorLevel + 0.13 + authoredLevel * 0.10,
                     floorLevel + authoredLevel * 0.10
                   + signRoom * authoredLevel
                   + jamb * authoredLevel * 0.38 + signFrame * 0.12
                   + welcomeSheen * 0.20);
    paletteMix = clamp01(0.20 + signRoom * 0.52 + jamb * 0.18
                       + welcomeSheen * 0.16);
  }

  brightness = clamp01(brightness);
  paletteMix = clamp01(paletteMix);
  var outR = (pr1 + (pr2 - pr1) * paletteMix) * brightness;
  var outG = (pg1 + (pg2 - pg1) * paletteMix) * brightness;
  var outB = (pb1 + (pb2 - pb1) * paletteMix) * brightness;
  rgbwau(clamp01(outR), clamp01(outG), clamp01(outB), 0.0, 0.0, 0.0);
}
