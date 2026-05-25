/*
  03_dual_axis_crush.js
  A linear continuous attack pattern that spawns at the extreme left and right 
  edges of the room and collapses into the physical stage center forever.
*/

export var speedTrim = 0.5;
export var swipeLength = 0.8;
export var beamWidth = 0.5;
export var globalDir = 1.0;

export var cp1H = 0.55, cp1S = 1.0, cp1V = 1.0; // Cyan default
export var cp2H = 0.1, cp2S = 1.0, cp2V = 1.0;  // Orange default
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderSpeedTrim(v) { speedTrim = v; }
export function count(v) { swipeLength = 0.2 + v * 1.5; }
export function size(v) { beamWidth = 0.1 + v * 0.8; }
export function direction(v) { globalDir = (v * 2.0) - 1.0; }

var attackPos = 0.0;
var flashIntensity = 0;
var invBeamWidth = 1.0; 

export function beforeRender(delta) {
  var localMultiplier = pow(2.0, (speedTrim - 0.5) * 4.0);
  var phaseIncrement = (delta / 65536.0) / (0.05 / localMultiplier);
  attackPos = (attackPos + phaseIncrement * globalDir) % 1.0; 
  if (attackPos < 0) attackPos += 1.0;
  
  invBeamWidth = 1.0 / beamWidth;

  var flashPhase = attackPos % 1.0;
  flashIntensity = 0.0;
  if (flashPhase < 0.1) {
    flashIntensity = 1.0 - (flashPhase * 10.0);
    flashIntensity *= flashIntensity; 
  }
}

export function render3D(index, x, y, z) {
  var normDist = 0.0;
  if (x < 0.6) {
    normDist = (0.6 - x) * 0.5376;
  } else {
    normDist = (x - 0.6) * 0.7936;
  }
  
  var spatialPhase = normDist / swipeLength; 
  var cycle = (spatialPhase + attackPos) % 1.0;
  var distBehind = cycle * swipeLength;
  
  var tVal = min(1.0, distBehind * invBeamWidth);
  var brightness = max(0.0, 1.0 - tVal);
  brightness *= brightness;
  
  var dh = cp2H - cp1H;
  if (dh > 0.5) dh -= 1.0;
  else if (dh < -0.5) dh += 1.0;
  
  var pixelHue = cp1H + dh * tVal;
  var pixelSat = cp1S + (cp2S - cp1S) * tVal;
  var maxVal = cp1V + (cp2V - cp1V) * tVal;
  
  pixelSat = pixelSat * min(1.0, distBehind * 15.0);

  var centerProximity = max(0.0, 1.0 - normDist * 4.0);
  var localFlash = flashIntensity * centerProximity;
  
  pixelSat *= max(0.0, 1.0 - localFlash); 
  var finalV = max(brightness * maxVal, localFlash);
  
  hsv(pixelHue - floor(pixelHue), pixelSat, finalV);
}