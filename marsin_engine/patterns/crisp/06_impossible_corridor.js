// DRAFT — pending operator review
/*
  06_impossible_corridor.js — IMPOSSIBLE CORRIDOR

  A thick rectilinear void is carved directly across the ship's lit surfaces.
  It advances, makes one impossible right-angle fold, opens into a room, grows
  a finite parallel route, and rejoins without relying on a tube in empty 3D.

  FIX_BAR_18     — broad architectural slabs, black passage, fold, and room.
  FIX_RAW_LED    — doorway jambs and wall edges only.
  FIX_VINTAGE_6  — at most two separated jamb bolts per six-head rail.
  FIX_PAR        — sparse lamps at the turn and room; no global baseline.
  FIX_TE_SIGN    — two complete 74-pixel floor plans with opposite chirality.

  AUDIO_MODULATION_V1:
    sliderCorridorWidth <- micMid range 0.24..0.68 curve ease # mids widen the black passage
    sliderPerspectiveDepth <- micLow range 0.18..0.74 curve ease # bass deepens the impossible fold
    sliderRoomScale <- micKick range 0.20..0.88 curve pow2 # kicks expand the destination room
    sliderSplitWidth <- micFlux range 0.08..0.72 curve ease # flux separates and rejoins the finite second route
  Static (unmapped) params: localSpeed, safetyFloor, colorPalette1/2.

  Every lit pixel chooses one exact endpoint and an intensity tier. The
  corridor void is black and W=A=U=0.
*/

export var cp1H = 0.035, cp1S = 1.00, cp1V = 1.00;
export var cp2H = 0.535, cp2S = 1.00, cp2V = 1.00;
export function colorPalette1(hv, sv, vv) { cp1H = hv; cp1S = sv; cp1V = vv; }
export function colorPalette2(hv, sv, vv) { cp2H = hv; cp2S = sv; cp2V = vv; }

export var localSpeed = 0.30;
export var corridorWidth = 0.48;
export var perspectiveDepth = 0.58;
export var roomScale = 0.42;
export var split = 0.34;
export var safetyFloor = 0.00;

export function sliderLocalSpeed(value) { localSpeed = value; }
export function sliderCorridorWidth(value) { corridorWidth = value; }
export function sliderPerspectiveDepth(value) { perspectiveDepth = value; }
export function sliderRoomScale(value) { roomScale = value; }
export function sliderSplitWidth(value) { split = value; }
export function sliderSafetyFloor(value) { safetyFloor = value; }

var PHASE_WRAP = 10.0;
var storyPhase = 0.0;

var liveWidth = 0.48;
var livePerspective = 0.58;
var liveRoom = 0.42;
var liveSplit = 0.34;
var liveFloor = 0.00;
var authoredWidth = 0.48;
var authoredPerspective = 0.58;
var authoredRoom = 0.42;
var authoredSplit = 0.34;
var authoredFloor = 0.00;
var roomEnvelope = 0.0;
var splitEnvelope = 0.0;
var entryX = 0.28, turnZ = 0.48, roomX = 0.70, roomZ = 0.67;

var pr1 = 1.0, pg1 = 0.0, pb1 = 0.0;
var pr2 = 0.0, pg2 = 1.0, pb2 = 1.0;

function clamp01(value) {
  if (value < 0.0) return 0.0;
  if (value > 1.0) return 1.0;
  return value;
}

function rectDistance(pointX, pointZ, centerX, centerZ, halfX, halfZ) {
  return max(abs(pointX - centerX) - halfX,
             abs(pointZ - centerZ) - halfZ);
}

function _hsv2rgb1() {
  var hueValue = cp1H - floor(cp1H); if (hueValue < 0.0) hueValue += 1.0;
  var sectorValue = floor(hueValue * 6.0) % 6.0;
  var fractionValue = hueValue * 6.0 - floor(hueValue * 6.0);
  var lowValue = cp1V * (1.0 - cp1S);
  var downValue = cp1V * (1.0 - fractionValue * cp1S);
  var upValue = cp1V * (1.0 - (1.0 - fractionValue) * cp1S);
  if      (sectorValue == 0.0) { pr1 = cp1V; pg1 = upValue; pb1 = lowValue; }
  else if (sectorValue == 1.0) { pr1 = downValue; pg1 = cp1V; pb1 = lowValue; }
  else if (sectorValue == 2.0) { pr1 = lowValue; pg1 = cp1V; pb1 = upValue; }
  else if (sectorValue == 3.0) { pr1 = lowValue; pg1 = downValue; pb1 = cp1V; }
  else if (sectorValue == 4.0) { pr1 = upValue; pg1 = lowValue; pb1 = cp1V; }
  else                          { pr1 = cp1V; pg1 = lowValue; pb1 = downValue; }
}

function _hsv2rgb2() {
  var hueValue = cp2H - floor(cp2H); if (hueValue < 0.0) hueValue += 1.0;
  var sectorValue = floor(hueValue * 6.0) % 6.0;
  var fractionValue = hueValue * 6.0 - floor(hueValue * 6.0);
  var lowValue = cp2V * (1.0 - cp2S);
  var downValue = cp2V * (1.0 - fractionValue * cp2S);
  var upValue = cp2V * (1.0 - (1.0 - fractionValue) * cp2S);
  if      (sectorValue == 0.0) { pr2 = cp2V; pg2 = upValue; pb2 = lowValue; }
  else if (sectorValue == 1.0) { pr2 = downValue; pg2 = cp2V; pb2 = lowValue; }
  else if (sectorValue == 2.0) { pr2 = lowValue; pg2 = cp2V; pb2 = upValue; }
  else if (sectorValue == 3.0) { pr2 = lowValue; pg2 = downValue; pb2 = cp2V; }
  else if (sectorValue == 4.0) { pr2 = upValue; pg2 = lowValue; pb2 = cp2V; }
  else                          { pr2 = cp2V; pg2 = lowValue; pb2 = downValue; }
}

export function beforeRender(delta) {
  var deltaSeconds = delta / 1000.0;
  if (deltaSeconds < 0.0) deltaSeconds = 0.0;
  if (deltaSeconds > 0.1) deltaSeconds = 0.1;

  var followRate = min(1.0, deltaSeconds * 7.0);
  liveWidth += (clamp01(corridorWidth) - liveWidth) * followRate;
  livePerspective += (clamp01(perspectiveDepth) - livePerspective) * followRate;
  liveRoom += (clamp01(roomScale) - liveRoom) * followRate;
  liveSplit += (clamp01(split) - liveSplit) * followRate;
  liveFloor += (clamp01(safetyFloor) - liveFloor) * followRate;

  // Default-centered response expansion preserves the operator-approved saved
  // frame exactly while making both ends of every architectural control
  // unmistakable in direct sweeps.
  authoredWidth = clamp01(0.48 + (liveWidth - 0.48) * 1.65);
  authoredPerspective = clamp01(0.58 + (livePerspective - 0.58) * 1.65);
  authoredRoom = clamp01(0.42 + (liveRoom - 0.42) * 1.90);
  authoredSplit = clamp01(0.34 + (liveSplit - 0.34) * 2.00);
  authoredFloor = clamp01(liveFloor * 1.80);

  var speedControl = clamp01(localSpeed);
  storyPhase += deltaSeconds * (0.018 + speedControl * 0.036);
  if (storyPhase >= PHASE_WRAP) storyPhase -= PHASE_WRAP;

  var storyAngle = frac(storyPhase) * PI2;
  roomEnvelope = 0.18 + authoredRoom
    * (0.42 + 0.30 * wave(1.0 + storyPhase - 0.08));
  splitEnvelope = authoredSplit * pow(wave(storyPhase + 0.16), 3.0);
  entryX = 0.25 + 0.10 * sin(storyAngle);
  turnZ = 0.44 + 0.10 * cos(storyAngle + 0.4);
  roomX = 0.70 + 0.08 * cos(storyAngle + 1.3);
  roomZ = 0.68 + 0.07 * sin(storyAngle + 0.7);

  _hsv2rgb1();
  _hsv2rgb2();
}

export function render3D(index, x, y, z) {
  var worldX = clamp01(x);
  var geometryX = worldX;
  var geometryY = clamp01(y);
  var geometryZ = clamp01(z);
  var signSide = worldX < 0.5 ? -1.0 : 1.0;
  var isIdentity = fixtureType == FIX_TE_SIGN;

  if (isIdentity) {
    var signAddress = index % 74.0;
    var signX = (signAddress % 10.0) / 9.0;
    var signZ = floor(signAddress / 10.0) / 7.0;
    if (signSide > 0.0) signX = 1.0 - signX;

    var signAngle = frac(storyPhase) * PI2 + signSide * 0.68;
    var signEntryX = 0.23 + 0.13 * sin(signAngle);
    var signTurnZ = 0.42 + 0.12 * cos(signAngle + 0.4);
    var signRoomX = 0.70 + 0.10 * cos(signAngle + 1.3);
    var signRoomZ = 0.69 + 0.10 * sin(signAngle + 0.7);
    var signHalfWidth = 0.180 + authoredWidth * 0.140;
    var signSegmentA = rectDistance(signX, signZ,
      signEntryX, signTurnZ * 0.5, signHalfWidth, signTurnZ * 0.5);
    var signSegmentB = rectDistance(signX, signZ,
      (signEntryX + signRoomX) * 0.5, signTurnZ,
      abs(signRoomX - signEntryX) * 0.5, signHalfWidth);
    var signRoom = rectDistance(signX, signZ,
      signRoomX, signRoomZ, 0.12 + roomEnvelope * 0.12,
      0.11 + roomEnvelope * 0.10);
    var signSplitZ = signTurnZ + 0.18 + splitEnvelope * 0.10 * signSide;
    var signSplitRoute = rectDistance(signX, signZ,
      (signEntryX + signRoomX) * 0.5, signSplitZ,
      abs(signRoomX - signEntryX) * 0.5, signHalfWidth * 0.72)
      + (1.0 - splitEnvelope) * 0.60;
    var signPassage = min(min(signSegmentA, signSegmentB),
                          min(signRoom, signSplitRoute));
    var signWallWidth = 0.055;
    var signWall = 1.0 - smoothstep(signWallWidth,
      signWallWidth + 0.050, abs(signPassage));
    var signOuter = smoothstep(signWallWidth + 0.025,
      signWallWidth + 0.060, signPassage);
    signOuter *= 1.0 - smoothstep(signWallWidth + 0.13,
      signWallWidth + 0.23, signPassage);
    var signBrightness = 0.0;
    var signUseColor2 = 1.0;
    if (signPassage > 0.0) signBrightness = signOuter * 0.22;
    if (signWall > signBrightness) {
      signBrightness = signWall * 0.78;
      signUseColor2 = 0.0;
    }
    signBrightness = clamp01(signBrightness);
    if (signUseColor2) {
      rgbwau(pr2 * signBrightness, pg2 * signBrightness,
             pb2 * signBrightness, 0.0, 0.0, 0.0);
    } else {
      rgbwau(pr1 * signBrightness, pg1 * signBrightness,
             pb1 * signBrightness, 0.0, 0.0, 0.0);
    }
    return;
  }

  var storyAngle = frac(storyPhase) * PI2;
  var foldAmount = 0.04 + authoredPerspective * 0.20;
  var projectedX = geometryX
                 + (geometryY - 0.5) * foldAmount * cos(storyAngle + 0.5);
  var projectedZ = geometryZ
                 + (geometryY - 0.5) * foldAmount * sin(storyAngle + 0.5);
  var halfWidth = 0.420 + authoredWidth * 0.180;

  var firstHalfZ = max(0.08, turnZ * 0.5);
  var segmentA = rectDistance(projectedX, projectedZ,
    entryX, firstHalfZ, halfWidth, firstHalfZ);
  var segmentB = rectDistance(projectedX, projectedZ,
    (entryX + roomX) * 0.5, turnZ,
    max(0.08, abs(roomX - entryX) * 0.5), halfWidth);
  var roomDistance = rectDistance(projectedX, projectedZ,
    roomX, roomZ, 0.10 + roomEnvelope * 0.13,
    0.09 + roomEnvelope * 0.11);

  var splitDirection = sin(storyAngle + 0.9);
  var splitAuthority = sqrt(splitEnvelope);
  var splitZ = turnZ + splitDirection * splitAuthority * 0.34;
  var rawSplitRoute = rectDistance(projectedX, projectedZ,
    (entryX + roomX) * 0.5, splitZ,
    max(0.08, abs(roomX - entryX) * 0.5),
    halfWidth * (0.05 + authoredSplit * 1.90));
  var splitRoute = rawSplitRoute + (1.0 - splitEnvelope) * 0.55;

  var passageDistance = min(min(segmentA, segmentB),
                            min(roomDistance, splitRoute));
  var wallThickness = 0.045 + authoredPerspective * 0.035;
  var edgeWidth = 0.016;
  var wall = 1.0 - smoothstep(wallThickness,
    wallThickness + edgeWidth, abs(passageDistance));
  var splitWall = splitAuthority * (1.0 - smoothstep(wallThickness,
    wallThickness + edgeWidth, abs(rawSplitRoute)));
  var splitArchitecture = splitAuthority
    * smoothstep(wallThickness + 0.015, wallThickness + 0.060, rawSplitRoute)
    * (1.0 - smoothstep(wallThickness + 0.26,
                        wallThickness + 0.44, rawSplitRoute));
  var splitVoid = splitAuthority
    * (1.0 - smoothstep(-0.10, -0.02, rawSplitRoute));
  var outerArchitecture = smoothstep(wallThickness + 0.025,
    wallThickness + 0.060, passageDistance);
  outerArchitecture *= 1.0 - smoothstep(wallThickness + 0.14,
    wallThickness + 0.25, passageDistance);

  var doorwayA = 1.0 - smoothstep(0.025, 0.075,
    abs(projectedZ - 0.04));
  doorwayA *= 1.0 - smoothstep(halfWidth + wallThickness,
    halfWidth + wallThickness + 0.04, abs(projectedX - entryX));
  var doorwayB = 1.0 - smoothstep(0.025, 0.075,
    abs(projectedX - roomX));
  doorwayB *= 1.0 - smoothstep(0.10 + roomEnvelope * 0.13,
    0.15 + roomEnvelope * 0.13, abs(projectedZ - roomZ));
  var doorway = max(doorwayA, doorwayB);

  var brightness = 0.0;
  var useColor2 = 1.0;
  if (passageDistance > 0.0) {
    var bodyMotion = 0.10 + 0.08
      * (0.5 + 0.5 * cos((geometryZ * 0.55
        + frac(storyPhase)) * PI2));
    brightness = outerArchitecture * (bodyMotion + authoredFloor * 0.70);
    var framePhase = frac(17.0
                        + projectedZ * (4.0 + authoredPerspective * 2.0)
                        - storyPhase * 1.7);
    var frameDistance = abs(framePhase - 0.5);
    var travelingFrame = 1.0 - smoothstep(0.035, 0.105, frameDistance);
    brightness = max(brightness, outerArchitecture * travelingFrame * 0.62);
  }
  if (wall > brightness) {
    brightness = wall * 0.72;
    useColor2 = 0.0;
  }
  if (splitWall > brightness) {
    brightness = splitWall * 0.92;
    useColor2 = 1.0;
  }
  if (splitArchitecture * 0.48 > brightness) {
    brightness = splitArchitecture * 0.48;
    useColor2 = 1.0;
  }
  if (doorway > brightness) {
    brightness = doorway * 0.82;
    useColor2 = 0.0;
  }
  brightness *= 1.0 - clamp01(splitVoid * 1.40);
  var alcovePhase = abs(sin((projectedZ * 1.50
                           - frac(storyPhase * 0.80)) * PI2));
  var blackAlcove = 1.0 - smoothstep(0.10, 0.20, alcovePhase);
  brightness *= 1.0 - blackAlcove;

  if (fixtureType == FIX_RAW_LED) {
    brightness = max(wall * 0.66, doorway * 0.86);
  } else if (fixtureType == FIX_VINTAGE_6) {
    var jambNear = max(wall, doorway);
    var jambPairA = pixelLocalIndex == 0.0 || pixelLocalIndex == 3.0;
    var jambPairB = pixelLocalIndex == 1.0 || pixelLocalIndex == 4.0;
    var jambGate = splitDirection > 0.0 ? jambPairA : jambPairB;
    var jambPosition = 0.08 + 0.84 * wave(storyPhase + 0.18);
    var jambPassage = 1.0 - smoothstep(0.030, 0.095,
      abs(geometryZ - jambPosition));
    brightness = jambGate * max(jambPassage, jambNear * 0.28)
               * (0.24 + roomEnvelope * 0.24);
    useColor2 = 0.0;
  } else if (fixtureType == FIX_PAR) {
    var thresholdPosition = 0.08 + 0.84 * wave(storyPhase + 0.31);
    var thresholdPassage = 1.0 - smoothstep(0.025, 0.080,
      abs(geometryZ - thresholdPosition));
    var roomAnchorDistance = hypot(projectedX - roomX, projectedZ - roomZ);
    var roomRelevance = 0.36 + 0.64
      * (1.0 - smoothstep(0.10, 0.28, roomAnchorDistance));
    var parCohort = floor(fixtureId + floor(storyPhase * 8.0)) % 4.0;
    var parGate = parCohort == 0.0;
    brightness = parGate * max(0.16,
      thresholdPassage * roomRelevance * (0.28 + roomEnvelope * 0.26));
    useColor2 = roomRelevance > 0.64;
  }

  brightness = clamp01(brightness);
  if (useColor2) {
    rgbwau(pr2 * brightness, pg2 * brightness, pb2 * brightness,
           0.0, 0.0, 0.0);
  } else {
    rgbwau(pr1 * brightness, pg1 * brightness, pb1 * brightness,
           0.0, 0.0, 0.0);
  }
}
