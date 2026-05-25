/*
  06_neon_elevator.js
  Neon Elevator
*/

export var speedTrim = 0.5;
export var stepCount = 5.0;
export var floorThickness = 0.2;
export var bloomPower = 3.0;

export var cp1H = 0.5, cp1S = 1.0, cp1V = 1.0; // Bottom color (Cyan default)
export var cp2H = 0.6, cp2S = 1.0, cp2V = 1.0; // Top color (Blue default)
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderSpeedTrim(v) { speedTrim = v; }
export function sliderSteps(v) { stepCount = 1.0 + floor(v * 20.0); }
export function sliderThickness(v) { floorThickness = 0.05 + v * 0.4; }
export function sliderBloom(v) { bloomPower = 1.0 + v * 4.0; }

var masterTime = 0;
var beatPhase = 0;
var arrivalPulse = 0;

export function beforeRender(delta) {
  var d = delta > 0.0 ? delta : 25.0; 
  masterTime += d / 1000.0;

  var localMultiplier = pow(2.0, (speedTrim - 0.5) * 4.0);
  beatPhase = time(0.05 / localMultiplier); 
  
  if (stepCount > 1.0) {
     var currentStep = floor(beatPhase * stepCount);
     var maxStep = stepCount - 1.0;
     
     if (currentStep >= maxStep) {
        var stepPhase = (beatPhase * stepCount) - currentStep;
        arrivalPulse = stepPhase;
     } else {
        arrivalPulse = 0.0;
     }
  } else {
     if (beatPhase > 0.9) {
        arrivalPulse = (beatPhase - 0.9) * 10.0;
     } else {
        arrivalPulse = 0.0;
     }
  }
}

export function render3D(index, wx, wy, wz) {
  var isPar = (sectionId == 1);
  var isVintage = (sectionId == 2);
  var isBar = (sectionId == 3);

  if (sectionId == 0) {
     isBar = wy < 1.8;
     isPar = wy >= 1.8 && wy < 4.0;
     isVintage = wy >= 4.0;
  }

  var visualY = 0.0;
  if (isBar) visualY = 0.0;
  else if (isPar) visualY = 0.5;
  else if (isVintage) visualY = 1.0;

  var targetY = beatPhase;
  if (stepCount > 1.0) {
     targetY = floor(beatPhase * stepCount) / (stepCount - 1.0);
  }

  var dist = abs(visualY - targetY);
  
  var v = max(0.0, 1.0 - (dist / floorThickness));
  v = pow(v, bloomPower);
  
  var outV = v;
  var outW = 0.0;
  var outA = 0.0;
  
  var mixRatio = visualY;
  
  var dh = cp2H - cp1H;
  if (dh > 0.5) dh -= 1.0;
  else if (dh < -0.5) dh += 1.0;
  
  var hue = cp1H + dh * mixRatio;
  var sat = cp1S + (cp2S - cp1S) * mixRatio;
  var maxVal = cp1V + (cp2V - cp1V) * mixRatio;
  
  if (isBar) {
     outV = v * 0.95;
     outV = max(outV, 0.05);
  }
  else if (isPar) {
     if (arrivalPulse > 0.0) {
        outV = arrivalPulse;
        outW = arrivalPulse * 0.9;
        hue = cp2H;
        sat = cp2S;
        maxVal = cp2V;
     } else {
        outV = v * 0.5;
     }
  }
  else if (isVintage) {
     outV = v;
     outA = v * 0.4;
     
     if (arrivalPulse > 0.0) {
        outW += arrivalPulse * 0.7;
     }
  }

  outV = max(0.0, min(1.0, outV));
  outW = max(0.0, min(1.0, outW));
  outA = max(0.0, min(1.0, outA));
  sat  = max(0.0, min(1.0, sat));
  
  var finalV = outV * maxVal;
  var rRaw = finalV * wave(hue + 0.000);
  var gRaw = finalV * wave(hue + 0.333);
  var bRaw = finalV * wave(hue + 0.666);

  var wLevel = finalV * (1.0 - sat);
  var r = max(0.0, min(1.0, wLevel + (rRaw * sat)));
  var g = max(0.0, min(1.0, wLevel + (gRaw * sat)));
  var b = max(0.0, min(1.0, wLevel + (bRaw * sat)));

  rgbwau(r, g, b, outW, outA, 0.0);
}
