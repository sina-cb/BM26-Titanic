/*
  14_lunar_current.js — "Moon River"

  One coherent moonlit current meanders through the model instead of repeating
  a generic full-rig wave field. Dark banks frame a broad river; a separately
  phased interference lace creates caustic filaments and nodes inside it.

  Every live-editable control is continuously followed in beforeRender. No
  accumulated phase is ever multiplied by a slider in render and no parameter
  reseeds a hash. Travel has one calm forward heading, leaving Local Speed as
  the only rate control. Width and Detail
  morph rather than teleporting the topology; Shimmer fades stable caustic lace
  in and out without changing its phase history.

  PORTABLE INSTRUMENT STAGING:
    FIX_BAR_18     — primary moon-river canvas and UV undertow.
    FIX_RAW_LED    — saturated silhouette edge and lace tracing.
    FIX_VINTAGE_6  — sparse golden Jewelry reflections with matched W+A.
    FIX_PAR        — restrained warm lunar pools and UV depth.
    FIX_TE_SIGN    — calm readable Identity bed with a deliberate river pass.

  AUDIO_MODULATION_V1:
    sliderLevel        <- micLow  range 0.22..0.74 curve linear # whole-look energy
    sliderKick         <- micKick range 0.00..0.72 curve pow2   # lunar crest flash
    sliderCurrentWidth <- micFlux range 0.16..0.78 curve ease   # river opens on builds
    sliderShimmer      <- micMid  range 0.12..0.82 curve linear # caustic lace energy
    # STATIC: localSpeed, detail, jewelryWhite, uvUndertow, palettes
*/

// Exported controls — declaration order is physical MIDI knob order.
// Canonical append-only optional fixture role; absent roles match no pixels.
var FIX_RAW_LED = 1;

export var localSpeed = 0.50;
export var level = 1.00;
export var kick = 0.00;
export var currentWidth = 0.50;
export var shimmer = 0.50;
export var detail = 0.50;
export var jewelryWhite = 0.50;
export var uvUndertow = 0.50;

export var cp1H = 0.58, cp1S = 0.85, cp1V = 1.0;
export var cp2H = 0.50, cp2S = 1.00, cp2V = 1.0;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderLevel(v) { level = v; }
export function sliderKick(v) { kick = v; }
export function sliderCurrentWidth(v) { currentWidth = v; }
export function sliderShimmer(v) { shimmer = v; }
export function sliderDetail(v) { detail = v; }
export function sliderJewelryWhite(v) { jewelryWhite = v; }
export function sliderUvUndertow(v) { uvUndertow = v; }

// Optional append-only role id. Models without TE signs simply have no type 7.
var FIX_TE_SIGN = 7;
var PHASE_WRAP = 10000.0;
var FLOW_DIRECTION = 1.0;

var currentPhase = 0.0;
var lacePhase = 0.0;
var tidePhase = 0.0;

// Smoothed live controls. Geometry follows more slowly than audio intensity so
// edits are visually continuous while kick and level remain musically useful.
var smSpeed = 0.50;
var smLevel = 1.00;
var smKick = 0.00;
var smWidth = 0.50;
var smShimmer = 0.50;
var smDetail = 0.50;
var smWhite = 0.50;
var smUv = 0.50;

var pr1 = 1.0, pg1 = 0.0, pb1 = 0.0;
var pr2 = 0.0, pg2 = 1.0, pb2 = 1.0;

function clamp01(v) {
  if (v < 0.0) return 0.0;
  if (v > 1.0) return 1.0;
  return v;
}

function smooth01(v) {
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
  else if (iv == 4) { pr2 = tv;   pg2 = pv;   pb2 = qv;   }
  else              { pr2 = cp2V; pg2 = pv;   pb2 = qv;   }
}

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  var geometryFollow = clamp01(dt * 2.6);
  var speedFollow = clamp01(dt * 3.4);
  var levelFollow = clamp01(dt * 9.0);
  var kickFollow = clamp01(dt * 18.0);

  smSpeed = smSpeed + (clamp01(localSpeed) - smSpeed) * speedFollow;
  smLevel = smLevel + (clamp01(level) - smLevel) * levelFollow;
  smKick = smKick + (clamp01(kick) - smKick) * kickFollow;
  smWidth = smWidth + (clamp01(currentWidth) - smWidth) * geometryFollow;
  smShimmer = smShimmer + (clamp01(shimmer) - smShimmer) * geometryFollow;
  smDetail = smDetail + (clamp01(detail) - smDetail) * geometryFollow;
  smWhite = smWhite + (clamp01(jewelryWhite) - smWhite) * levelFollow;
  smUv = smUv + (clamp01(uvUndertow) - smUv) * levelFollow;

  var rate = pow(2.0, (smSpeed - 0.5) * 4.0);
  currentPhase = currentPhase + dt * rate * FLOW_DIRECTION * 0.22;
  // Caustic structure drifts far more slowly than the river. Spatial detail is
  // crisp; temporal motion stays liquid instead of scintillating frame to frame.
  lacePhase = lacePhase + dt * rate * 0.017;
  tidePhase = tidePhase + dt * (0.012 + rate * 0.004);

  if (currentPhase >= PHASE_WRAP) currentPhase -= PHASE_WRAP;
  else if (currentPhase <= -PHASE_WRAP) currentPhase += PHASE_WRAP;
  if (lacePhase >= PHASE_WRAP) lacePhase -= PHASE_WRAP;
  if (tidePhase >= PHASE_WRAP) tidePhase -= PHASE_WRAP;

  _hsv2rgb1();
  _hsv2rgb2();
}

export function render3D(index, x, y, z) {
  var nx = clamp01(x);
  var ny = clamp01(y);
  var nz = clamp01(z);

  // A single curved river centerline. The two broad bends are incommensurate
  // and depth-aware, so the path feels organic without tiling the whole model.
  var bendA = wave(nx * 1.13 - currentPhase + nz * 0.23) - 0.5;
  var bendB = wave(nx * 1.87 + currentPhase * 0.618 - nz * 0.41) - 0.5;
  var centerY = 0.50 + bendA * 0.38 + bendB * 0.14;
  var width = 0.055 + smWidth * 0.32;
  var riverDistance = abs(ny - centerY);
  var river = smooth01(1.0 - riverDistance / width);

  // A narrow bank line and a broad shadow bank create depth and negative space.
  var bankDistance = abs(riverDistance - width * 0.78);
  var bank = smooth01(1.0 - bankDistance / (0.025 + width * 0.16));
  var shadow = smooth01(1.0 - riverDistance / (width * 1.65));
  shadow = shadow * (1.0 - river);

  // Caustic lace: two oblique coordinate fields interfere only inside the
  // river. Detail changes bounded spatial frequency; Shimmer changes amplitude
  // and sharpness but never multiplies an accumulated phase.
  // The wider 0.20..6.22 span makes Detail an unmistakable broad-pool -> fine
  // lace control while preserving the operator's saved .88 look (~5.50 cycles).
  // smDetail is eased in beforeRender, so live edits do not snap the topology.
  var laceFreq = 0.20 + smDetail * 6.02;
  var laceA = wave((nx * 0.83 + ny * 1.31 + nz * 0.47) * laceFreq
                 + lacePhase);
  var laceB = wave((nx * -1.17 + ny * 0.71 + nz * 0.93) * laceFreq
                 - lacePhase * 0.618);
  var filament = 1.0 - clamp01(abs(laceA - laceB)
                             * (1.5 + smDetail * 3.0));
  filament = smooth01(filament);
  var node = pow(clamp01(laceA * laceB * 1.12), 1.5 + smDetail * 2.0);
  var laceShape = clamp01(filament * 0.62 + node * 0.38 - 0.05) * river;
  var lace = laceShape * smShimmer;
  var laceCore = pow(laceShape, 1.85) * smShimmer;

  var tide = 0.78 + wave(tidePhase + nx * 0.09 + nz * 0.07) * 0.22;
  var kickShape = smKick * (2.0 - smKick);
  // The existing kickShape keeps the saved low value (.12) as a restrained
  // lunar crest. A second quadratic stage opens only when the operator pushes
  // Kick high, making the manual 0 -> 1 sweep unmistakable without retuning
  // the approved ambient bed.
  var kickBurst = smKick * smKick;
  var lunarFlash = kickShape * clamp01(river * 0.48 + laceCore * 0.92
                                     + bank * 0.18);
  var broadBurst = kickBurst * smooth01(clamp01(0.10 + river * 0.72
                                              + bank * 0.28));

  // Low ambient haze, one coherent body, crisp cp2 lace, and dark banks. The
  // current remains legible at low width without filling the entire rig.
  var bodyBri = (0.008 + river * (0.33 + river * 0.78)
               + bank * 0.075 + lace * 0.26 + laceCore * 0.46
               + lunarFlash * 0.70 + broadBurst * 0.62) * tide * smLevel;
  bodyBri = clamp01(bodyBri);
  var colorMix = clamp01(0.08 + lace * 0.48 + laceCore * 0.54
                       + lunarFlash * 0.36 + broadBurst * 0.24);

  var r = (pr1 + (pr2 - pr1) * colorMix) * bodyBri;
  var g = (pg1 + (pg2 - pg1) * colorMix) * bodyBri;
  var b = (pb1 + (pb2 - pb1) * colorMix) * bodyBri;
  var w = 0.0;
  var u = 0.0;

  if (fixtureType == FIX_BAR_18) {
    // Hull: retain palette authorship but bias blue toward visible teal on wood.
    r = r * 0.52 + bodyBri * 0.018;
    g = g * 0.88 + bodyBri * 0.11;
    b = b * 0.66 + bodyBri * 0.07;
    u = clamp01(smUv * smLevel * (river * 0.12 + lace * 0.62
                                + lunarFlash * 0.36));
  } else if (fixtureType == FIX_RAW_LED) {
    // Silhouette: saturated tracing on banks and caustic cores.
    var trace = clamp01(bodyBri * 0.24 + bank * smLevel * 0.16
                      + laceCore * smLevel * 0.72 + lunarFlash * 0.28
                      + broadBurst * 0.42);
    r = trace * 0.025;
    g = trace * 0.29;
    b = trace;
  } else if (fixtureType == FIX_VINTAGE_6) {
    // Jewelry: sparse champagne reflections, with honest matched native white.
    var fleckSeed = wave(pixelLocalIndex * 0.371 + nx * 1.73 + ny * 0.83
                       + lacePhase * 0.19);
    var fleck = pow(fleckSeed, 5.5 + smDetail * 3.5)
              * clamp01(bank * 0.42 + laceCore * 0.88
                                             + lunarFlash * 0.74);
    var warm = clamp01((river * 0.050 + fleck * 0.74 + lunarFlash * 0.22)
                     * smLevel);
    r = warm;
    g = warm * 0.43;
    b = warm * 0.045;
    w = clamp01(smWhite * smLevel * (river * 0.045 + fleck * 1.34
                                   + lunarFlash * 0.52 + broadBurst * 0.72));
  } else if (fixtureType == FIX_PAR) {
    // Organs: palette-authored pools below the current with UV depth. These
    // deliberately follow the selected colors instead of imposing orange.
    var pool = clamp01((river * 0.22 + bank * 0.11 + lunarFlash * 0.22)
                     * smLevel + broadBurst * 0.46);
    var poolMix = clamp01(0.18 + river * 0.34 + lace * 0.32
                        + lunarFlash * 0.16);
    r = (pr1 + (pr2 - pr1) * poolMix) * pool;
    g = (pg1 + (pg2 - pg1) * poolMix) * pool;
    b = (pb1 + (pb2 - pb1) * poolMix) * pool;
    u = clamp01(smUv * smLevel * (shadow * 0.18 + lace * 0.34
                                + lunarFlash * 0.22));
  } else if (fixtureType == FIX_TE_SIGN) {
    // Identity: the physical pixels already draw the letters, so preserve that
    // silhouette with a firm moonlit floor. One broad current front crosses
    // the actual XYZ letter geometry; the local index only bends that front
    // around the strokes. There is no second lattice or per-pixel flicker.
    var signFlowCoord = nx * 0.37 + ny * 0.91 - nz * 0.67
                      + pixelLocalIndex * 0.003;
    var signCurrent = wave(signFlowCoord - currentPhase * 0.75);
    var signBody = smooth01(signCurrent);
    var signCrest = smooth01(1.0 - abs(signCurrent - 0.78) / 0.34);
    var signBri = (0.27 + signBody * 0.12 + signCrest * 0.12
                 + river * 0.025 + lunarFlash * 0.10 + broadBurst * 0.28)
                 * (0.78 + smLevel * 0.22);
    var signMix = clamp01(0.16 + signBody * 0.35 + signCrest * 0.25
                        + river * 0.08 + lunarFlash * 0.16);
    r = (pr1 + (pr2 - pr1) * signMix) * signBri;
    g = (pg1 + (pg2 - pg1) * signMix) * signBri;
    b = (pb1 + (pb2 - pb1) * signMix) * signBri;
  }

  rgbwau(clamp01(r), clamp01(g), clamp01(b), w, w, u);
}
