// DRAFT — pending operator review
/*
  121_spiral_wake.js — a monumental helical wake wrapping the whole vessel.

  Two broad, counter-curving spiral crests travel through normalized XYZ. The
  gesture is intentionally simple and enormous so it reads from far away; a
  palette-derived 10–20% safety floor keeps the complete ship visible between
  crests. No scene-specific topology is required. Identity gets a denser double
  helix using the same clocks and palette, never a separate unrelated effect.

  AUDIO_MODULATION_V1:
    sliderLevel       <- micLow  range 0.35..1.00 curve linear # bass lifts the wake
    sliderPulse       <- micKick range 0.00..1.00 curve pow2   # kick crowns both crests
    sliderSpiralWidth <- micFlux range 0.22..0.82 curve ease   # builds broaden the wake
*/

// Canonical optional accent role; absent roles match no pixels.
var FIX_TE_SIGN = 7;

export var localSpeed = 0.30;
export var level = 0.78;
export var spiralWidth = 0.50;
export var turns = 0.50;
export var wakeContrast = 0.58;
export var safetyFloor = 0.50;
export var pulse = 0.0;

export var cp1H = 0.56, cp1S = 0.92, cp1V = 1.0;
export var cp2H = 0.84, cp2S = 0.78, cp2V = 1.0;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderLevel(v) { level = v; }
export function sliderSpiralWidth(v) { spiralWidth = v; }
export function sliderTurns(v) { turns = v; }
export function sliderWakeContrast(v) { wakeContrast = v; }
export function sliderSafetyFloor(v) { safetyFloor = v; }
export function sliderPulse(v) { pulse = v; }

var pr1 = 1.0, pg1 = 0.0, pb1 = 0.0;
var pr2 = 0.0, pg2 = 0.0, pb2 = 1.0;
function _hsv2rgb1() {
  var hv = cp1H - floor(cp1H); if (hv < 0.0) hv += 1.0;
  var iv = floor(hv * 6.0) % 6;
  var fv = hv * 6.0 - floor(hv * 6.0);
  var pv = cp1V * (1.0 - cp1S);
  var qv = cp1V * (1.0 - fv * cp1S);
  var tv = cp1V * (1.0 - (1.0 - fv) * cp1S);
  if      (iv == 0) { pr1 = cp1V; pg1 = tv;   pb1 = pv;   }
  else if (iv == 1) { pr1 = qv;   pg1 = cp1V; pb1 = pv;   }
  else if (iv == 2) { pr1 = pv;   pg1 = cp1V; pb1 = tv;   }
  else if (iv == 3) { pr1 = pv;   pg1 = qv;   pb1 = cp1V; }
  else if (iv == 4) { pr1 = tv;   pg1 = pv;   pb1 = cp1V; }
  else              { pr1 = cp1V; pg1 = pv;   pb1 = qv;   }
}
function _hsv2rgb2() {
  var hv = cp2H - floor(cp2H); if (hv < 0.0) hv += 1.0;
  var iv = floor(hv * 6.0) % 6;
  var fv = hv * 6.0 - floor(hv * 6.0);
  var pv = cp2V * (1.0 - cp2S);
  var qv = cp2V * (1.0 - fv * cp2S);
  var tv = cp2V * (1.0 - (1.0 - fv) * cp2S);
  if      (iv == 0) { pr2 = cp2V; pg2 = tv;   pb2 = pv;   }
  else if (iv == 1) { pr2 = qv;   pg2 = cp2V; pb2 = pv;   }
  else if (iv == 2) { pr2 = pv;   pg2 = cp2V; pb2 = tv;   }
  else if (iv == 3) { pr2 = pv;   pg2 = qv;   pb2 = cp2V; }
  else if (iv == 4) { pr2 = tv;   pg2 = pv;   pb2 = cp2V; }
  else              { pr2 = cp2V; pg2 = pv;   pb2 = qv;   }
}

function clamp01(v) {
  if (v < 0.0) return 0.0;
  if (v > 1.0) return 1.0;
  return v;
}

var PHASE_WRAP = 10000.0;
var wakePhase = 0.0;
var echoPhase = 0.37;

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;
  var rate = pow(2.0, (localSpeed - 0.5) * 3.6);
  wakePhase = wakePhase + dt * 0.115 * rate;
  echoPhase = echoPhase + dt * 0.071 * rate;
  if (wakePhase >= PHASE_WRAP) wakePhase = wakePhase - PHASE_WRAP;
  if (echoPhase >= PHASE_WRAP) echoPhase = echoPhase - PHASE_WRAP;
  _hsv2rgb1();
  _hsv2rgb2();
}

export function render3D(index, x, y, z) {
  var nx = clamp01(x), ny = clamp01(y), nz = clamp01(z);
  var dx = nx - 0.5;
  var dz = nz - 0.5;
  var angle = atan2(dz, dx) / PI2;
  var radius = sqrt(dx * dx + dz * dz);
  var turnCount = 1.15 + turns * 2.35;
  var width = 0.10 + spiralWidth * 0.30;

  var helixA = wave(angle * turnCount + ny * 0.92
                  + radius * 0.55 - wakePhase);
  var helixB = wave(-angle * (turnCount * 0.62 + 0.38) + ny * 0.67
                  - radius * 0.81 + echoPhase);
  var crestA = clamp01(1.0 - abs(helixA - 0.5) * 2.0 / width);
  var crestB = clamp01(1.0 - abs(helixB - 0.5) * 2.0 / (width * 1.28));
  var exponent = 1.15 + wakeContrast * 3.2;
  crestA = pow(crestA, exponent);
  crestB = pow(crestB, exponent * 0.78);
  var crest = max(crestA, crestB * 0.68);
  var crown = max(crestA * crestB, crest * clamp01(pulse));

  var floorV = 0.10 + clamp01(safetyFloor) * 0.10;
  var energy = clamp01(crest * (0.52 + level * 0.48)
                     + crown * (0.18 + pulse * 0.42));
  var bri = floorV + (1.0 - floorV) * energy * clamp01(level);
  var mixPos = clamp01(helixA * 0.48 + helixB * 0.30
                     + crestB * 0.22);

  if (fixtureType == FIX_TE_SIGN) {
    var signPath = pixelLocalIndex * 0.01351351351;
    var signA = wave(angle * 2.0 + ny * 1.37 + signPath * 0.31
                   - wakePhase * 3.0);
    var signB = wave(-angle * 3.0 + ny * 0.83 - signPath * 0.23
                   + echoPhase * 5.0);
    var crossing = pow(clamp01(1.0 - abs(signA - signB)), 3.0);
    bri = clamp01(floorV + 0.08 + signA * 0.08 + signB * 0.07
                + crossing * (0.30 + pulse * 0.22));
    mixPos = clamp01(0.08 + signA * 0.28 + signB * 0.24
                   + crossing * 0.40);
  }

  var r = (pr1 + (pr2 - pr1) * mixPos) * bri;
  var g = (pg1 + (pg2 - pg1) * mixPos) * bri;
  var b = (pb1 + (pb2 - pb1) * mixPos) * bri;
  rgbwau(clamp01(r), clamp01(g), clamp01(b), 0.0, 0.0, 0.0);
}
