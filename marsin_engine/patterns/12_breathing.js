/*
  12_breathing.js — "The Ship Breathes"

  The entire model inhales and exhales as one organism. Every pixel shares one
  asymmetric breath envelope: a shorter inhale, a held crest, and a longer
  exhale. Spatial structure never changes that shared timing. Bars reveal the
  ribcage, Vintage rails carry golden matched-W+A lungs, and every other fixture
  follows the same palette body through the generic portable path.

  There is no Direction or traveling phase. BreathDepth controls the luminance
  swing, BreathShape moves from broad meditation to a tight held inhale,
  Bloom controls cp1→cp2 transformation, Ribbing reveals static structural
  light, and Sparkle adds slow directionless life. A sparse secondary-color
  field occupies the exhale's negative space; FieldDetail transforms it from
  broad islands into a five-axis quasicrystal of filaments, cells, and nodes.
  The global breath rises over it without turning the ship into a flat wash.
  TE signs carry a calmer two-axis filigree over a readable palette floor: the
  same global breath remains unmistakable without the field voids erasing the
  letterform during exhale.
  Kick is an immediate whole-model heartbeat visible at every point in the breath.

AUDIO_MODULATION_V1:
  sliderLevel   <- micLow  range 0.20..0.72 curve linear # whole-model energy
  sliderKick    <- micKick range 0.00..0.72 curve pow2   # immediate heartbeat
  sliderSparkle <- micHigh range 0.04..0.72 curve ease   # high-frequency scintillation
  # STATIC: localSpeed, breathDepth, breathShape, bloom, ribbing, fieldDetail, whiteGlow, palettes
*/

// Optional accent role: the append-only canonical id keeps this shared pattern
// compilable on models without TE signs while preserving a loud numeric target.
var FIX_TE_SIGN = 7;

// Exported controls — declaration order is physical MIDI knob order.
export var localSpeed = 0.30;
export var level = 0.45;
export var kick = 0.00;
export var breathDepth = 0.50;
export var breathShape = 0.40;
export var bloomAmount = 0.50;
export var ribbing = 0.45;
export var sparkle = 0.12;
export var whiteGlow = 0.45;
export var fieldDetail = 0.72;

export var cp1H = 0.0, cp1S = 1.0, cp1V = 1.0;
export var cp2H = 0.1, cp2S = 1.0, cp2V = 1.0;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderLevel(v) { level = v; }
export function sliderKick(v) { kick = v; }
export function sliderBreathDepth(v) { breathDepth = v; }
export function sliderBreathShape(v) { breathShape = v; }
export function sliderBloom(v) { bloomAmount = v; }
export function sliderRibbing(v) { ribbing = v; }
export function sliderSparkle(v) { sparkle = v; }
export function sliderWhiteGlow(v) { whiteGlow = v; }
export function sliderFieldDetail(v) { fieldDetail = v; }

var PHASE_WRAP = 10000.0;
var breathPhase = 0.0;
var sparklePhase = 0.0;
var fieldPhase = 0.0;

var pr1 = 1.0, pg1 = 0.0, pb1 = 0.0;
var pr2 = 1.0, pg2 = 0.5, pb2 = 0.0;

function clamp01(v) {
  if (v < 0.0) return 0.0;
  if (v > 1.0) return 1.0;
  return v;
}

function _hsv2rgb1() {
  var hv = cp1H - floor(cp1H); if (hv < 0.0) hv += 1.0;
  var iv = floor(hv * 6.0) % 6;
  var fv = hv * 6.0 - floor(hv * 6.0);
  var pv = cp1V * (1.0 - cp1S);
  var qv = cp1V * (1.0 - fv * cp1S);
  var tv = cp1V * (1.0 - (1.0 - fv) * cp1S);
  if (iv == 0) { pr1 = cp1V; pg1 = tv; pb1 = pv; }
  else if (iv == 1) { pr1 = qv; pg1 = cp1V; pb1 = pv; }
  else if (iv == 2) { pr1 = pv; pg1 = cp1V; pb1 = tv; }
  else if (iv == 3) { pr1 = pv; pg1 = qv; pb1 = cp1V; }
  else if (iv == 4) { pr1 = tv; pg1 = pv; pb1 = cp1V; }
  else { pr1 = cp1V; pg1 = pv; pb1 = qv; }
}

function _hsv2rgb2() {
  var hv = cp2H - floor(cp2H); if (hv < 0.0) hv += 1.0;
  var iv = floor(hv * 6.0) % 6;
  var fv = hv * 6.0 - floor(hv * 6.0);
  var pv = cp2V * (1.0 - cp2S);
  var qv = cp2V * (1.0 - fv * cp2S);
  var tv = cp2V * (1.0 - (1.0 - fv) * cp2S);
  if (iv == 0) { pr2 = cp2V; pg2 = tv; pb2 = pv; }
  else if (iv == 1) { pr2 = qv; pg2 = cp2V; pb2 = pv; }
  else if (iv == 2) { pr2 = pv; pg2 = cp2V; pb2 = tv; }
  else if (iv == 3) { pr2 = pv; pg2 = qv; pb2 = cp2V; }
  else if (iv == 4) { pr2 = tv; pg2 = pv; pb2 = cp2V; }
  else { pr2 = cp2V; pg2 = pv; pb2 = qv; }
}

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  _hsv2rgb1();
  _hsv2rgb2();

  // Calibrated scale: new .30 equals the former .65 breathing rate, while
  // new 1.00 reaches the former extrapolated 1.40 rate.
  var equivalentOldSpeed = 0.3285714 + localSpeed * 1.0714286;
  var localMult = pow(2.0, (equivalentOldSpeed - 0.5) * 4.0);
  breathPhase = breathPhase + dt * (0.035 + localMult * 0.16);
  // Sparkles and the under-field are supporting textures, deliberately much
  // slower than the calibrated breath clock.
  sparklePhase = sparklePhase + dt * (0.020 + localMult * 0.065);
  fieldPhase = fieldPhase + dt * (0.006 + localMult * 0.018);
  if (breathPhase >= PHASE_WRAP) breathPhase = breathPhase - PHASE_WRAP;
  if (sparklePhase >= PHASE_WRAP) sparklePhase = sparklePhase - PHASE_WRAP;
  if (fieldPhase >= PHASE_WRAP) fieldPhase = fieldPhase - PHASE_WRAP;
}

export function render3D(index, x, y, z) {
  var nx = clamp01(x);
  var ny = clamp01(y);
  var nz = clamp01(z);

  // One frame-global asymmetric envelope. Coordinates never enter this phase.
  var p = breathPhase - floor(breathPhase);
  var q = 0.0;
  var rawBreath = 0.0;
  if (p < 0.40) {
    q = p / 0.40;
    rawBreath = q * q * (3.0 - 2.0 * q);
  } else {
    q = (p - 0.40) / 0.60;
    q = q * q * (3.0 - 2.0 * q);
    rawBreath = 1.0 - q;
  }
  var shapedBreath = pow(rawBreath, 0.65 + breathShape * 3.0);
  var depth = clamp01(breathDepth);
  var breathBody = (1.0 - depth) + depth * (0.08 + shapedBreath * 0.92);

  // Static symmetric ribcage structure. It brightens and dims with the exact
  // same global breath; it never travels or breaks synchronization.
  var centerX = abs(nx - 0.5);
  var ribWave = wave(centerX * 9.0 + ny * 2.0 + nz * 3.0);
  var ribCore = pow(ribWave, 2.0 + ribbing * 7.0);
  var ribs = ribCore * ribbing;

  // Five incommensurate axes form a 3D quasicrystal beneath the breath.
  // FieldDetail redistributes one visual energy budget from broad cells into
  // narrower ridges and intersection nodes. It changes complexity, not speed.
  // The top frequency is intentionally bounded so detail 1 remains legible on
  // sparse models instead of collapsing into single-pixel alias noise.
  var detail = clamp01(fieldDetail);
  var fieldFreq = 2.4 + detail * 5.6;
  var q0 = wave((nx + ny * 0.19 + nz * 0.31) * fieldFreq
    + fieldPhase);
  var q1 = wave((nx * 0.309 + ny * 0.951 - nz * 0.47) * fieldFreq
    - fieldPhase * 0.618);
  var q2 = wave((nx * -0.809 + ny * 0.588 + nz * 0.73) * fieldFreq
    + fieldPhase * 0.414);
  var q3 = wave((nx * -0.809 - ny * 0.588 - nz * 0.27) * fieldFreq
    - fieldPhase * 0.732);
  var q4 = wave((nx * 0.309 - ny * 0.951 + nz * 0.61) * fieldFreq
    + fieldPhase * 0.271);
  var quasi = (q0 + q1 + q2 + q3 + q4) * 0.20;

  // Separate topology layers are important: halos describe the broad cell
  // walls, cores make thin filaments, and nodes exist only at intersections.
  // They are composed differently below instead of being summed into one wash.
  var ridgeHalo = 1.0 - clamp01(abs(quasi - 0.50)
    * (3.0 + detail * 5.0));
  var ridgeCore = pow(ridgeHalo, 1.7 + detail * 3.0);
  var crossHalo = 1.0 - clamp01(abs(q0 - q3)
    * (1.9 + detail * 3.7));
  var crossCore = pow(crossHalo, 1.8 + detail * 2.8);
  var cellSeed = pow(clamp01(q1 * q2 * 1.28), 1.15 + detail * 2.0);
  var intersection = clamp01(ridgeCore * crossCore * 2.0);
  var fieldNode = pow(clamp01(intersection * 0.95 + cellSeed * 0.55 - 0.17),
    1.15 + detail * 1.6);
  var fieldHalo = clamp01(ridgeHalo * 0.58 + crossHalo * 0.36
    + cellSeed * 0.28 - 0.24);
  var fieldCore = clamp01(ridgeCore * 0.82 + crossCore * 0.45
    + intersection * 0.48 - 0.34);

  // A slow broad gate chooses where the mathematical field is allowed to live.
  // The untouched regions are real voids rather than a low red coating.
  var regionWave = wave(nx * 1.37 - ny * 2.11 + nz * 1.73
    + fieldPhase * 0.37);
  var regionGate = clamp01((regionWave - 0.23) * 1.85);
  fieldHalo = fieldHalo * regionGate;
  fieldCore = fieldCore * regionGate;
  fieldNode = fieldNode * regionGate;

  // Directionless scintillation: per-pixel phase decorrelation with one shared
  // clock. Sparkle energy is strongest during inhale and remains subtle at rest.
  var sparkWave = wave(sparklePhase + pixelLocalIndex * 0.137
    + nx * 0.31 + ny * 0.19 + nz * 0.23);
  var sparkCore = pow(sparkWave, 8.0 + sparkle * 10.0);
  var sparks = sparkCore * sparkle * (0.22 + shapedBreath * 0.78);

  // Kick transfer curve and fixture role weights are unchanged. It remains an
  // immediate whole-model heartbeat; the exhale composition below carves the
  // complete broad body so true negative space can exist between structures.
  var kickPop = clamp01(kick);
  var kickShape = kickPop * (2.0 - kickPop);
  var kickRole = 0.72;
  if (fixtureType == FIX_BAR_18) kickRole = 0.82;
  else if (fixtureType == FIX_VINTAGE_6) kickRole = 1.0;
  var heartbeat = kickShape * kickRole;

  // Build one broad synchronized breath, then multiplicatively reveal the
  // mathematical surface only as the ship exhales. During inhale bodyCarve and
  // underCut both converge continuously to 1.0, so the whole model rises as one.
  var surfaceGain = 0.70 + fieldHalo * 0.10 + ridgeHalo * 0.06
    + cellSeed * 0.04;
  var rawBody = (0.002 + breathBody * 0.14 + shapedBreath * 0.33)
    * surfaceGain
    + ribs * 0.11 + sparks * 0.20 + heartbeat * 0.58
    + bloomAmount * shapedBreath * 0.12;
  var exhaleWeight = pow(1.0 - shapedBreath, 1.20);

  // Cp1 survives as selected cell halos, not a full-model floor. Cp2 cores and
  // nodes punch holes through that halo so the two palette endpoints separate
  // spatially instead of mixing into orange everywhere.
  var haloOnly = fieldHalo
    * (1.0 - clamp01(fieldCore * 0.90 + fieldNode * 0.80));
  var exhaleMask = clamp01(0.010 + haloOnly * 2.0 + fieldHalo * 0.035);
  var bodyCarve = (1.0 - exhaleWeight) + exhaleWeight * exhaleMask;
  var underCut = 1.0 - exhaleWeight
    * clamp01(fieldCore * 0.66 + fieldNode * 0.78);
  var body = rawBody * bodyCarve * underCut;

  var fixtureGain = 0.88;
  if (fixtureType == FIX_BAR_18) fixtureGain = 0.96;
  else if (fixtureType == FIX_VINTAGE_6) fixtureGain = 0.82;

  // Level is a final gain over every authored lane.
  var levelGain = clamp01(level);
  var bri = clamp01(body * levelGain * fixtureGain);

  // The cp2 field has three luminance strata. As detail rises, broad halo energy
  // is traded into thinner cores and nodes. fieldScale compensates the shrinking
  // ridge occupancy so FieldDetail changes complexity far more than mean level.
  var fieldHaloBri = fieldHalo
    * (0.016 + (1.0 - shapedBreath) * 0.052)
    * (1.0 - detail * 0.25);
  var fieldCoreBri = fieldCore
    * (0.050 + (1.0 - shapedBreath) * 0.340)
    * (0.82 + detail * 0.18);
  var fieldNodeBri = fieldNode
    * (0.035 + (1.0 - shapedBreath) * 0.480)
    * detail;
  var fieldRaw = (fieldHaloBri + fieldCoreBri + fieldNodeBri)
    * (1.02 - detail * 0.08) * levelGain * fixtureGain;
  var fieldScale = 0.65 + detail * 2.60 + detail * detail * 1.50;
  fieldRaw = fieldRaw * fieldScale;

  // Soft compression protects rare multi-axis intersections without flattening
  // their hierarchy or relying on the final channel clamp as a look.
  var fieldBri = fieldRaw / (1.0 + fieldRaw * 0.60);

  // Bloom alone owns the inhale's cp1→cp2 travel. Ribbing and Sparkle add
  // small secondary-color structure without leaving the selected palette line.
  var colorMix = bloomAmount * (0.06 + shapedBreath * 0.82)
    + ribs * 0.12 + sparks * 0.18 + heartbeat * 0.18;
  colorMix = clamp01(colorMix);

  // Cp2 is explicit under-field light, not a tint on the cp1 body. At exhale,
  // cp1 halos, cp2 filaments/nodes, and black voids occupy different regions.
  var r = (pr1 + (pr2 - pr1) * colorMix) * bri + pr2 * fieldBri;
  var g = (pg1 + (pg2 - pg1) * colorMix) * bri + pg2 * fieldBri;
  var b = (pb1 + (pb2 - pb1) * colorMix) * bri + pb2 * fieldBri;

  // Vintage-only golden matched-W+A lungs. The white lane now follows a much
  // deeper exhale envelope so it does not erase the surrounding cp1/cp2 color.
  // The W/A outputs remain byte-identical by construction.
  var w = 0.0;
  if (fixtureType == FIX_TE_SIGN) {
    // Identity breath: three smooth XYZ contours interfere into moving ribbons
    // and nodes. The local index follows the letter strokes; integer multiples
    // of the large-wrap clocks keep every contour seam-safe and continuously
    // live. The frame-global inhale/exhale remains the dominant luminance arc.
    var signAxisA = wave(nx * 1.61803 + ny * 2.39996 + nz * 1.41421
      + pixelLocalIndex * 0.013 + sparklePhase * 2.0 + fieldPhase * 5.0);
    var signAxisB = wave(nx * 2.39996 - ny * 1.41421 + nz * 1.73205
      - pixelLocalIndex * 0.008 - sparklePhase * 3.0 - fieldPhase * 7.0);
    var signAxisC = wave(nx * -1.73205 + ny * 1.61803 + nz * 2.39996
      + pixelLocalIndex * 0.005 + sparklePhase - fieldPhase * 11.0);
    var signRibbon = 1.0 - clamp01(abs(signAxisA - signAxisB) * 2.35);
    signRibbon = signRibbon * signRibbon * (3.0 - 2.0 * signRibbon);
    var signNode = pow(clamp01(signAxisA * signAxisB * signAxisC * 1.35), 1.65);
    var signRibbonGain = 0.38 + sparkle * 0.64865;
    var signNodeGain = 0.28 + sparkle * 0.81081;
    var signFiligree = clamp01(0.08 + signRibbon * signRibbonGain
      + signNode * signNodeGain);
    var signV = levelGain * (0.22
      + (0.10 + shapedBreath * 0.40) * (0.68 + signFiligree * 0.32)
      + signFiligree * (0.035 + (1.0 - shapedBreath) * 0.10)
      + heartbeat * 0.28);
    signV = clamp01(signV);
    var signMix = bloomAmount * (0.08 + shapedBreath * 0.76)
      + signFiligree * 0.32 + heartbeat * 0.12;
    signMix = clamp01(signMix);
    r = (pr1 + (pr2 - pr1) * signMix) * signV;
    g = (pg1 + (pg2 - pg1) * signMix) * signV;
    b = (pb1 + (pb2 - pb1) * signMix) * signV;
  } else if (fixtureType == FIX_VINTAGE_6) {
    var whiteBody = 0.06 + shapedBreath * 0.62 + sparks * 0.40
      + heartbeat * 0.78;
    var whiteEnvelope = 0.14 + shapedBreath * 0.86;
    w = clamp01(clamp01(whiteGlow) * levelGain * whiteBody * whiteEnvelope);
    r = r + w * 0.14;
    g = g + w * 0.055;
  }

  rgbwau(clamp01(r), clamp01(g), clamp01(b), w, w, 0.0);
}
