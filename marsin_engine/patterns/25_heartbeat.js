/*
  25_heartbeat.js
  Synchronized Double-Pulse Heartbeat
*/

export var speedTrim = 0.5;
export var minBright = 0.04;
export var rippleAmount = 0.0; 

export var cp1H = 0.0, cp1S = 1.0, cp1V = 1.0; // Core (Red default)
export var cp2H = 0.33, cp2S = 1.0, cp2V = 1.0; // Secondary (Green default)
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderSpeedTrim(v) { speedTrim = v; }
export function sliderDormantGlow(v) { minBright = v * 0.3; }
export function sliderRippleSweep(v) { rippleAmount = v * 0.5; }

var t1;

export function beforeRender(delta) {
  var localMultiplier = pow(2.0, (speedTrim - 0.5) * 4.0);
  t1 = time(0.012 / localMultiplier);
}

export function render3D(index, x, y, z) {
  var hue = cp1H;
  var sat = cp1S;
  var maxVal = cp1V;
  if (sectionId == 2) {
    hue = cp2H; sat = cp2S; maxVal = cp2V;
  }
  else if (sectionId == 3) {
    var dh = cp2H - cp1H;
    if (dh > 0.5) dh -= 1.0;
    else if (dh < -0.5) dh += 1.0;
    hue = cp1H + dh * 0.5;
    sat = 0.5 * (cp1S + cp2S);
    maxVal = 0.5 * (cp1V + cp2V);
  }
  
  var normX = (x + 0.4) / 2.02; 
  if (normX < 0.0) normX = 0.0;
  if (normX > 1.0) normX = 1.0;
  
  var localCycle = (t1 - (normX * rippleAmount)) % 1.0;
  if (localCycle < 0.0) localCycle += 1.0; 
  
  var localBeat = 0.0;
  if (localCycle < 0.08) {
     localBeat = wave(localCycle / 0.08);
  } else if (localCycle > 0.12 && localCycle < 0.18) {
     localBeat = wave((localCycle - 0.12) / 0.06) * 0.7;
  }
  
  var effSat = sat * (1.0 - (localBeat * 0.9));
  var bright = minBright + localBeat * (1.0 - minBright);
  bright = bright * maxVal;
  
  var posMod = 1.0 - abs((y / 6.5) - 0.5) * 0.3;
  
  hsv(hue - floor(hue), effSat, bright * posMod);
}
