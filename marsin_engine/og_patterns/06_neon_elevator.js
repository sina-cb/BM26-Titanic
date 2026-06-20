/*
  06_neon_elevator.js
  Neon Elevator — strict palette-driven floor stack.
*/

export var localSpeed = 0.5;
export var stepCount = 5.0;
export var floorThickness = 0.2;
export var bloomPower = 3.0;

export var cp1H = 0.5, cp1S = 1.0, cp1V = 1.0; // Bottom floor colour
export var cp2H = 0.6, cp2S = 1.0, cp2V = 1.0; // Top floor colour
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderSteps(v) { stepCount = 1.0 + floor(v * 20.0); }
export function sliderThickness(v) { floorThickness = 0.05 + v * 0.4; }
export function sliderBloom(v) { bloomPower = 1.0 + v * 4.0; }

var masterTime = 0;
var beatPhase = 0;
var arrivalPulse = 0;

// ── Palette RGB cache ─────────────────────────────────────────────────
var pr1 = 1, pg1 = 0, pb1 = 0;
var pr2 = 0, pg2 = 0, pb2 = 1;
function _hsv2rgb1() {
  var hv = cp1H - floor(cp1H); if (hv < 0) hv += 1;
  var iv = floor(hv * 6) % 6;
  var fv = hv * 6 - floor(hv * 6);
  var pv = cp1V * (1 - cp1S);
  var qv = cp1V * (1 - fv * cp1S);
  var tv = cp1V * (1 - (1 - fv) * cp1S);
  if      (iv == 0) { pr1 = cp1V; pg1 = tv;    pb1 = pv;    }
  else if (iv == 1) { pr1 = qv;    pg1 = cp1V; pb1 = pv;    }
  else if (iv == 2) { pr1 = pv;    pg1 = cp1V; pb1 = tv;    }
  else if (iv == 3) { pr1 = pv;    pg1 = qv;    pb1 = cp1V; }
  else if (iv == 4) { pr1 = tv;    pg1 = pv;    pb1 = cp1V; }
  else             { pr1 = cp1V; pg1 = pv;    pb1 = qv;    }
}
function _hsv2rgb2() {
  var hv = cp2H - floor(cp2H); if (hv < 0) hv += 1;
  var iv = floor(hv * 6) % 6;
  var fv = hv * 6 - floor(hv * 6);
  var pv = cp2V * (1 - cp2S);
  var qv = cp2V * (1 - fv * cp2S);
  var tv = cp2V * (1 - (1 - fv) * cp2S);
  if      (iv == 0) { pr2 = cp2V; pg2 = tv;    pb2 = pv;    }
  else if (iv == 1) { pr2 = qv;    pg2 = cp2V; pb2 = pv;    }
  else if (iv == 2) { pr2 = pv;    pg2 = cp2V; pb2 = tv;    }
  else if (iv == 3) { pr2 = pv;    pg2 = qv;    pb2 = cp2V; }
  else if (iv == 4) { pr2 = tv;    pg2 = pv;    pb2 = cp2V; }
  else             { pr2 = cp2V; pg2 = pv;    pb2 = qv;    }
}

export function beforeRender(delta) {
  var d = delta > 0.0 ? delta : 25.0;
  masterTime += d / 1000.0;

  var localMultiplier = pow(2.0, (localSpeed - 0.5) * 4.0);
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
     arrivalPulse = (beatPhase > 0.9) ? (beatPhase - 0.9) * 10.0 : 0.0;
  }
  _hsv2rgb1();
  _hsv2rgb2();
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

  // visualY in [0,1] acts as the cp1->cp2 blend factor (bottom -> top).
  // On the "par" section we briefly snap the colour to cp2 + boost
  // brightness during the arrival pulse so the top-floor "ding" reads.
  var tColour = visualY;
  var outV = v;

  if (isBar) {
     outV = max(v * 0.95, 0.05);
  } else if (isPar) {
     if (arrivalPulse > 0.0) {
        outV = max(arrivalPulse, v * 0.5);
        tColour = 1.0; // arrival flashes the top palette colour
     } else {
        outV = v * 0.5;
     }
  } else if (isVintage) {
     outV = v;
     if (arrivalPulse > 0.0) outV = max(outV, arrivalPulse * 0.7);
  }

  outV = max(0.0, min(1.0, outV));

  // Strict RGB lerp — no rainbow synthesis.
  var r = (pr1 + (pr2 - pr1) * tColour) * outV;
  var g = (pg1 + (pg2 - pg1) * tColour) * outV;
  var b = (pb1 + (pb2 - pb1) * tColour) * outV;

  // Arrival "ding" white pop (restored). Only fires on the PAR row at
  // top-of-stack, so it reads as a beat impact, not a palette change.
  var outW = (isPar && arrivalPulse > 0.0) ? arrivalPulse * 0.9 : 0.0;
  // Vintage row keeps a little amber for warmth — additive on top of
  // the palette colour, not replacing it.
  var outA = (isVintage) ? outV * 0.25 : 0.0;
  rgbwau(r, g, b, outW, outA, 0.0);
}
