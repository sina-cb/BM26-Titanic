/*
  11_bioluminescence.js
  Party-Ready Bioluminescence — slow ambient swell with bright crests.
  Strict palette: ambient = cp1, crests = cp2, no rainbow / W / UV leak.
*/

export var localSpeed = 0.5;
export var density = 2.0;
export var uvIntensity = 0.6;
export var partyMode = 0.0;

export var cp1H = 0.6, cp1S = 1.0, cp1V = 1.0; // Ambient swell
export var cp2H = 0.3, cp2S = 1.0, cp2V = 1.0; // Crest pop
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderDensity(v) { density = 1.0 + v * 5.0; }
export function sliderUvGlow(v) { uvIntensity = v; }
export function sliderPartyMode(v) { partyMode = v; }

var t1, t2;
var localMultiplier = 1.0;

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
  localMultiplier = pow(2.0, (localSpeed - 0.5) * 4.0);
  t1 = time(0.08 / localMultiplier);
  t2 = time(0.04 / localMultiplier);
  _hsv2rgb1();
  _hsv2rgb2();
}

export function render(index) {
  var pct = index / (pixelCount > 0 ? pixelCount : 144);

  var swell = wave(t1 + pct * density);
  var blend = pow(swell, 4.0); // sharpens crests, ambient dominates elsewhere

  var crest = (swell > 0.9) ? 1.0 : 0.0;
  if (partyMode > 0.5) {
     var strobeClock = time(0.1 / localMultiplier);
     crest *= (strobeClock * 10.0 % 1.0 < 0.5) ? 1.0 : 0.0;
  }

  // Brightness floor uses the wave so the rig "breathes" even when not
  // at a crest; full brightness only at the crest peak.
  var v = max(swell * 0.8, crest);

  // Strict RGB lerp between cp1 (ambient) and cp2 (crest)
  var r = (pr1 + (pr2 - pr1) * blend) * v;
  var g = (pg1 + (pg2 - pg1) * blend) * v;
  var b = (pb1 + (pb2 - pb1) * blend) * v;

  // UV glow rides the slow underwater wave — restored as an additive
  // emitter so the pattern still has its signature blacklight feel.
  // Set sliderUvGlow to 0 if you want strict RGB-only output.
  var uvGlow = wave(t2 - pct * 0.5);
  var outU = uvGlow * uvIntensity * 0.6;
  // Crest "spark" gets a little white pop when the cp2 colour is heavily
  // saturated — keeps the highlight crisp without injecting non-palette hue.
  var outW = crest * 0.4;

  rgbwau(r, g, b, outW, 0.0, outU);
}
