// DRAFT - pending operator review
/* Baby-blue hull constellations drift over a persistent full-ship photo wash. */

var COLOR_R_DARK = 0.008;
var COLOR_G_DARK = 0.130;
var COLOR_B_DARK = 0.620;
var COLOR_R_LIGHT = 0.033;
var COLOR_G_LIGHT = 0.450;
var COLOR_B_LIGHT = 1.000;

export var localSpeed = 0.31;
export var level = 0.94;
export var starSize = 0.54;
export var connectorContrast = 0.46;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderLevel(v) { level = v; }
export function sliderStarSize(v) { starSize = v; }
export function sliderConnectorContrast(v) { connectorContrast = v; }

var driftPhase = 0.0;
var weavePhase = 0.0;
var liveLevel = 0.94;
var liveSize = 0.54;
var liveConnectors = 0.46;

function clamp01(v) {
  if (v < 0.0) return 0.0;
  if (v > 1.0) return 1.0;
  return v;
}

function emitColor(shade, bri) {
  var s = clamp01(shade);
  rgbwau((COLOR_R_DARK + (COLOR_R_LIGHT - COLOR_R_DARK) * s) * bri,
         (COLOR_G_DARK + (COLOR_G_LIGHT - COLOR_G_DARK) * s) * bri,
         (COLOR_B_DARK + (COLOR_B_LIGHT - COLOR_B_DARK) * s) * bri,
         0.0, 0.0, 0.0);
}

export function beforeRender(delta) {
  var dt = min(0.1, max(0.0, delta / 1000.0));
  var speedMultiplier = pow(2.0, (clamp01(localSpeed) - 0.5) * 4.0);
  driftPhase = driftPhase + dt * 0.244 * speedMultiplier;
  weavePhase = weavePhase + dt * 0.17253404 * speedMultiplier;
  if (driftPhase >= 10000.0) driftPhase = driftPhase - 10000.0;
  if (weavePhase >= 10000.0) weavePhase = weavePhase - 10000.0;
  liveLevel = clamp01(level);
  liveSize = clamp01(starSize);
  liveConnectors = clamp01(connectorContrast);
}

export function render3D(index, x, y, z) {
  var cells = 4.0;
  var gridX = x * cells;
  var gridY = y * cells;
  var gridZ = z * cells;
  var cellX = floor(gridX);
  var cellY = floor(gridY);
  var cellZ = floor(gridZ);
  var localX = gridX - cellX;
  var localY = gridY - cellY;
  var localZ = gridZ - cellZ;
  var seed = wave(cellX * 0.173 + cellY * 0.371 + cellZ * 0.619);

  var pointAX = 0.34 + 0.18 * sin((driftPhase + seed * 0.37) * PI2);
  var pointAY = 0.34 + 0.18 * sin((weavePhase + seed * 0.61) * PI2);
  var pointAZ = 0.34 + 0.18 * sin((driftPhase * 0.73 + seed * 0.83) * PI2);
  var pointBX = 0.66 + 0.18 * sin((weavePhase + seed * 0.47) * PI2);
  var pointBY = 0.66 + 0.18 * sin((driftPhase * 0.79 + seed * 0.71) * PI2);
  var pointBZ = 0.66 + 0.18 * sin((weavePhase * 0.67 + seed * 0.29) * PI2);

  var lineX = pointBX - pointAX;
  var lineY = pointBY - pointAY;
  var lineZ = pointBZ - pointAZ;
  var fromX = localX - pointAX;
  var fromY = localY - pointAY;
  var fromZ = localZ - pointAZ;
  var lineLength = lineX * lineX + lineY * lineY + lineZ * lineZ;
  var along = clamp01((fromX * lineX + fromY * lineY + fromZ * lineZ) / lineLength);
  var nearX = pointAX + lineX * along;
  var nearY = pointAY + lineY * along;
  var nearZ = pointAZ + lineZ * along;
  var linkX = localX - nearX;
  var linkY = localY - nearY;
  var linkZ = localZ - nearZ;
  var linkDistance = sqrt(linkX * linkX + linkY * linkY + linkZ * linkZ);

  var starRadius = 0.120 + liveSize * 0.280;
  var distAX = localX - pointAX;
  var distAY = localY - pointAY;
  var distAZ = localZ - pointAZ;
  var distBX = localX - pointBX;
  var distBY = localY - pointBY;
  var distBZ = localZ - pointBZ;
  var distanceA = sqrt(distAX * distAX + distAY * distAY + distAZ * distAZ);
  var distanceB = sqrt(distBX * distBX + distBY * distBY + distBZ * distBZ);
  var starA = pow(clamp01(1.0 - distanceA / starRadius), 1.7);
  var starB = pow(clamp01(1.0 - distanceB / starRadius), 1.7);
  var connectorWidth = 0.110 + liveSize * 0.220;
  var connector = pow(clamp01(1.0 - linkDistance / connectorWidth), 1.05) *
                  liveConnectors;
  var stars = max(starA, starB);
  var field = clamp01(stars * 1.12 + connector * 1.35);
  var breathe = 0.76 + 0.24 * wave(weavePhase + x * 0.19 + y * 0.13 + z * 0.17);
  var bri = clamp01((0.30 + field * 0.66) * liveLevel * breathe);
  emitColor(0.10 + stars * 0.90 + connector * 1.05, bri);
}
