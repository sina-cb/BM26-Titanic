// DRAFT — pending operator review
/*
  126_cathedral_rib_wave.js — CATHEDRAL RIB WAVE

  Five to seven monumental vertical rib planes pass through the full model.
  A slow opening wave bows each plane in sequence, turning the installation
  into a breathing cathedral skeleton visible at distance. The language is
  deliberately broad and architectural, never a fine lattice.

  PORTABILITY
    The shared composition uses normalized XYZ only. No authored view, raw id,
    controller, group, section, or load-bearing fixture role is required.
    FIX_TE_SIGN is an optional accent: where present, Identity holds a readable
    rib-vault intersection. Models without signs render the full work unchanged.

  SAFETY FLOOR
    sliderSafetyFloor maps only 0.10..0.20. Every pixel remains on a visible,
    palette-derived bed even while the rib wave is fully closed.

  AUDIO_MODULATION_V1:
    sliderLevel <- micLow  range 0.24..1.00 curve linear # cathedral luminosity
    sliderPulse <- micKick range 0.00..0.90 curve pow2   # whole-rib vault bloom
    sliderBow   <- micFlux range 0.22..0.88 curve ease   # ribs open on builds
  # STATIC: localSpeed, ribCount, ribWidth, safetyFloor, colorPalette1/2
*/

// Declaration order is physical MIDI order. Local Speed is always first.
export var localSpeed = 0.30;
export var level = 0.62;
export var ribCount = 0.50;
export var ribWidth = 0.52;
export var bow = 0.48;
export var safetyFloor = 0.50;
export var pulse = 0.00;

export var cp1H = 0.62, cp1S = 0.88, cp1V = 1.0;
export var cp2H = 0.10, cp2S = 0.48, cp2V = 1.0;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderLevel(v) { level = v; }
export function sliderRibCount(v) { ribCount = v; }
export function sliderRibWidth(v) { ribWidth = v; }
export function sliderBow(v) { bow = v; }
export function sliderSafetyFloor(v) { safetyFloor = v; }
export function sliderPulse(v) { pulse = v; }

// Optional accent role at the canonical append-only registry id.
var FIX_TE_SIGN = 7;

var PHASE_WRAP = 10000.0;
var openingClock = 0.0;
var vaultClock = 0.23;

var liveSpeed = 0.30;
var liveLevel = 0.62;
var liveCount = 0.50;
var liveWidth = 0.52;
var liveBow = 0.48;
var liveFloor = 0.50;
var livePulse = 0.00;

var resolvedCount = 6.0;
var resolvedWidth = 0.10;
var resolvedFloor = 0.15;

var pr1 = 1.0, pg1 = 0.0, pb1 = 0.0;
var pr2 = 0.0, pg2 = 1.0, pb2 = 1.0;

function clamp01(v) {
  if (v < 0.0) return 0.0;
  if (v > 1.0) return 1.0;
  return v;
}

function smoothUnit(v) {
  v = clamp01(v);
  return v * v * (3.0 - 2.0 * v);
}

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

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  _hsv2rgb1();
  _hsv2rgb2();

  // Geometry controls ease into their new values so live edits bend the
  // cathedral instead of tearing it between frames. Pulse stays responsive.
  var geometryFollow = clamp01(dt * 3.2);
  var levelFollow = clamp01(dt * 10.0);
  var pulseFollow = clamp01(dt * 18.0);
  liveSpeed = liveSpeed + (clamp01(localSpeed) - liveSpeed) * geometryFollow;
  liveLevel = liveLevel + (clamp01(level) - liveLevel) * levelFollow;
  liveCount = liveCount + (clamp01(ribCount) - liveCount) * geometryFollow;
  liveWidth = liveWidth + (clamp01(ribWidth) - liveWidth) * geometryFollow;
  liveBow = liveBow + (clamp01(bow) - liveBow) * geometryFollow;
  liveFloor = liveFloor
            + (clamp01(safetyFloor) - liveFloor) * levelFollow;
  livePulse = livePulse + (clamp01(pulse) - livePulse) * pulseFollow;

  var rate = 0.018 + 0.13 * pow(2.0, (liveSpeed - 0.5) * 4.0);
  openingClock = openingClock + dt * rate;
  vaultClock = vaultClock + dt * rate * 0.371;
  if (openingClock >= PHASE_WRAP) openingClock -= PHASE_WRAP;
  if (vaultClock >= PHASE_WRAP) vaultClock -= PHASE_WRAP;

  resolvedCount = 5.0 + liveCount * 2.0;
  resolvedWidth = 0.035 + liveWidth * 0.115;
  resolvedFloor = 0.10 + liveFloor * 0.10;
}

export function render3D(index, x, y, z) {
  var nx = clamp01(x);
  var ny = clamp01(y);
  var nz = clamp01(z);
  var dx = nx - 0.5;
  var dz = nz - 0.5;

  // The upper vault is a single monumental arch. Its opening wave travels
  // down X, causing successive planes to bow outward rather than translate.
  var span = abs(dz) * 2.0;
  var vaultArch = 0.16 + 0.68 * sqrt(max(0.0, 1.0 - span * span));
  var sequence = wave(openingClock - nx * 0.82);
  var opening = (0.035 + liveBow * 0.205) * (sequence * 2.0 - 1.0);
  var heightBow = (ny - 0.5) * (ny - 0.5) * opening * 1.65;
  var depthBow = sin((ny * 0.72 + vaultClock) * PI2)
               * opening * (0.30 + 0.70 * (1.0 - span));

  // A sine distance creates five to seven continuous rib planes. Bow shifts
  // their phase according to height/depth; there is no discrete reindex seam.
  var ribPhase = (nx + heightBow + depthBow) * resolvedCount;
  var planeDistance = abs(sin(ribPhase * PI));
  var plane = smoothUnit(1.0 - planeDistance / resolvedWidth);

  // The plane is brightest where it meets the cathedral vault, but remains a
  // broad vertical structural band below it so the skeleton reads at distance.
  var vaultDistance = abs(ny - vaultArch);
  var vaultBand = smoothUnit(1.0 - vaultDistance / (0.11 + resolvedWidth * 0.72));
  var pillar = smoothUnit((vaultArch + 0.10 - ny) / 0.24);
  var rib = plane * (0.38 + pillar * 0.28 + vaultBand * 0.70);
  rib = clamp01(rib);

  // A wide traveling opening glow binds neighboring ribs into a sequence
  // without adding fine texture or another lattice frequency.
  var openingGlow = smoothUnit(sequence) * (0.22 + liveBow * 0.30);
  var cathedralEnergy = rib * 0.92 + plane * openingGlow * 0.38;
  var authored = liveLevel * 0.18
               + cathedralEnergy * (0.06 + liveLevel * 1.18)
               + rib * livePulse * 0.48;
  authored = clamp01(authored);
  var bri = resolvedFloor + (1.0 - resolvedFloor) * authored;

  var paletteMix = clamp01(0.12 + vaultBand * 0.60
                          + sequence * 0.18 + livePulse * rib * 0.10);

  if (fixtureType == FIX_TE_SIGN) {
    // Identity is the readable rib-vault crossing: a protected floor holds
    // the letters while the same sequential planes visibly open through them.
    var signVault = smoothUnit(1.0 - abs(ny - vaultArch)
                            / (0.17 + resolvedWidth));
    var intersection = clamp01(plane * (0.46 + signVault * 0.72));
    var signFloor = resolvedFloor + 0.07;
    var signEnergy = intersection * (0.32 + liveLevel * 0.64)
                   + signVault * sequence * 0.18
                   + intersection * livePulse * 0.36;
    bri = max(bri, signFloor + (1.0 - signFloor) * clamp01(signEnergy));
    paletteMix = clamp01(0.30 + signVault * 0.42
                        + sequence * 0.16 + plane * 0.08);
  }

  // All visible light is strict cp1<->cp2 RGB. Native white and amber remain
  // identical zeros on every fixture and model.
  var r = (pr1 + (pr2 - pr1) * paletteMix) * bri;
  var g = (pg1 + (pg2 - pg1) * paletteMix) * bri;
  var b = (pb1 + (pb2 - pb1) * paletteMix) * bri;
  rgbwau(clamp01(r), clamp01(g), clamp01(b), 0.0, 0.0, 0.0);
}
