/*
  13_sparkle.js — "First-Class Constellations"

  Elegant high-definition sparkle, not another moving field. Every selected star
  follows a continuous three-act lifecycle: ignition, diamond bloom, and fading
  afterglow. The envelope is zero at both ends, so lifecycle wrap never flashes.

  Titanic instrument staging is resolved through portable fixture capabilities:
    - Hull Canvas / Bars: a restrained saturated constellation over velvet cp1.
    - Silhouette / long strands: crisp tracing stars with little background.
    - Jewelry / Vintage: hero golden matched-W+A diamonds.
    - Organs / point fixtures: rare cp2 pulses and decisive kick punctuation.
    - Identity / TE signs: dark velvet letterforms with restrained constellation points.
  This keeps the five-instrument composition on Titanic without hard-binding the
  shared pattern to Titanic-only view names; test_bench and legacy scenes compile.

  There is no Direction, Radius, or generic background knob. StarCount,
  Brilliance, TwinkleFocus, Afterglow, and StarChorus describe actual
  stellar behavior. StarChorus blends independent twinkles into coordinated,
  mirrored regional phrases. Burst reveals a dormant constellation rather
  than flashing a wash.

  The four audio-driven controls used to be NAMED for their signal
  (sliderLOW_Level, sliderHIGH_Brilliance, sliderFLUX_StarCount,
  sliderKICK_Burst). That hack rendered as garbage on the operator's screen
  ("L O W_ L EVEL") and hard-coded a suggestion into an identifier. The
  suggestion now lives in the AUDIO_MODULATION_V1 block below, where the
  engine reads it and CaptainPad shows it as a badge — the parameter names
  are plain again (report 20260806_184). Declaration order is UNCHANGED, so
  every MFT knob still drives the same control.

AUDIO_MODULATION_V1:
  sliderLevel      <- micLow  range 0.20..0.72 curve linear # total elegance budget
  sliderBrilliance <- micHigh range 0.16..0.76 curve linear # high-frequency diamonds
  sliderStarCount  <- micFlux range 0.12..0.86 curve ease   # build reveals more stars
  sliderBurst      <- micKick range 0.00..0.78 curve pow2   # constellation burst
  # STATIC: localSpeed, twinkleFocus, afterglow, starChorus, jewelryWhite, uvStars, palettes
*/

// Exported controls — declaration order is physical MIDI knob order.
export var localSpeed = 0.30;
export var level = 0.45;
export var starCount = 0.50;
export var brilliance = 0.70;
export var twinkleFocus = 0.50;
export var afterglow = 0.50;
export var starChorus = 0.55;
export var kick = 0.00;
export var jewelryWhite = 0.50;
export var uvStars = 0.30;

export var cp1H = 0.61, cp1S = 0.82, cp1V = 1.0;  // deep sapphire velvet
export var cp2H = 0.105, cp2S = 0.48, cp2V = 1.0; // champagne / ice-gold
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderLevel(v) { level = v; }
export function sliderStarCount(v) { starCount = v; }
export function sliderBrilliance(v) { brilliance = v; }
export function sliderTwinkleFocus(v) { twinkleFocus = v; }
export function sliderAfterglow(v) { afterglow = v; }
export function sliderStarChorus(v) { starChorus = v; }
export function sliderBurst(v) { kick = v; }
export function sliderJewelryWhite(v) { jewelryWhite = v; }
export function sliderUvStars(v) { uvStars = v; }

var PHASE_WRAP = 10000.0;
var starPhase = 0.0;
var bedPhase = 0.0;

// Optional accent role: canonical append-only id from
// lib/fixture_type_constants.js. Self-declaring it keeps this shared pattern
// compilable on scenes without TE signs; it is never a load-bearing target.
var FIX_TE_SIGN = 7;

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

function starEnvelope(life, focus, tail) {
  var attackWidth = 0.035 + (1.0 - focus) * 0.14;
  if (life < attackWidth) {
    return smoothUnit(life / attackWidth);
  }
  var decay = 1.0 - (life - attackWidth) / (1.0 - attackWidth);
  decay = smoothUnit(decay);
  var decayPower = 4.8 - tail * 4.15;
  return pow(decay, decayPower) * (0.72 + focus * 0.28);
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

  // Calibrated scale: new .30 equals the former .55 rate. New 1.00 reaches
  // former 1.15, leaving a modestly faster top end for energetic sparkle.
  var equivalentOldSpeed = 0.2928571 + localSpeed * 0.8571429;
  var localMult = pow(2.0, (equivalentOldSpeed - 0.5) * 4.0);
  starPhase = starPhase + dt * (0.055 + localMult * 0.43);
  bedPhase = bedPhase + dt * (0.006 + localMult * 0.018);
  if (starPhase >= PHASE_WRAP) starPhase = starPhase - PHASE_WRAP;
  if (bedPhase >= PHASE_WRAP) bedPhase = bedPhase - PHASE_WRAP;
}

export function render3D(index, x, y, z) {
  var nx = clamp01(x);
  var ny = clamp01(y);
  var nz = clamp01(z);

  // Stable star identities and different lifecycle rates prevent lockstep.
  var seedA = wave(index * 0.618034 + nx * 3.17 + ny * 5.31 + nz * 7.13);
  var seedB = wave(index * 0.414214 + nx * 7.19 - ny * 2.71 + nz * 5.17);
  var seedC = wave(index * 0.732051 - nx * 4.11 + ny * 6.23 + nz * 3.07);

  var countScale = 0.82;
  var starGain = 0.92;
  var bedGain = 0.72;
  var kickGain = 0.72;

  if (fixtureType == FIX_BAR_18) {
    // Hull Canvas: enough stars to read, but the saturated field stays elegant.
    countScale = 0.78;
    starGain = 0.88;
    bedGain = 0.82;
    kickGain = 0.78;
  } else if (fixtureType == FIX_VINTAGE_6) {
    // Jewelry: the hero diamond instrument.
    countScale = 1.35;
    starGain = 1.24;
    bedGain = 0.38;
    kickGain = 1.0;
  } else if (pixelCount <= 2) {
    // Organs / point fixtures: rare punctuation, strong heartbeat.
    countScale = 0.34;
    starGain = 0.92;
    bedGain = 0.46;
    kickGain = 1.18;
  } else if (fixtureType == FIX_TE_SIGN) {
    // Identity gets an explicit treatment below. These values preserve the
    // existing star lifecycle feeding that branch.
    countScale = 0.42;
    starGain = 0.76;
    bedGain = 0.92;
    kickGain = 0.48;
  } else if (pixelCount > 60) {
    // Other very long fixtures retain their existing generic treatment.
    countScale = 0.42;
    starGain = 0.76;
    bedGain = 0.92;
    kickGain = 0.48;
  } else if (pixelCount > 20) {
    // Silhouette-like long strands: tracing points and almost no wash.
    countScale = 0.90;
    starGain = 1.0;
    bedGain = 0.34;
    kickGain = 0.82;
  }

  // Count stays pointillist across the entire knob. Even the operator's high
  // saved .89 remains a field of individual diamonds instead of a filled wash.
  var threshold = clamp01((0.015 + starCount * starCount * 0.28) * countScale);
  var selectedA = (seedA < threshold) ? 1.0 : 0.0;
  var selectedB = (seedB < threshold * 0.46) ? 1.0 : 0.0;

  // Constellation draws independent points into elegant regional choruses.
  // Symmetric-X grouping mirrors the two sides without imposing travel.
  var groupX = floor(abs(nx - 0.5) * 7.0);
  var groupY = floor(ny * 5.0);
  var groupZ = floor(nz * 4.0);
  var groupSeed = wave(groupX * 17.17 + groupY * 31.13 + groupZ * 47.11);
  var chorus = clamp01(starChorus);
  var rateA = (0.58 + seedB * 0.82) * (1.0 - chorus)
            + (0.72 + groupSeed * 0.36) * chorus;
  var rateB = 0.41 + seedC * 0.67;
  var phaseOffsetA = seedC * (1.0 - chorus) + groupSeed * chorus;
  var lifeA = starPhase * rateA + phaseOffsetA;
  lifeA = lifeA - floor(lifeA);
  var lifeB = starPhase * rateB + seedA * 0.73;
  lifeB = lifeB - floor(lifeB);

  var focus = clamp01(twinkleFocus);
  var tail = clamp01(afterglow);
  var envA = starEnvelope(lifeA, focus, tail) * selectedA;
  var envB = starEnvelope(lifeB, focus * 0.72, tail * 0.84) * selectedB;

  // Diamond focus adds a very tight core without losing the elegant tail.
  var diamondA = pow(envA, 1.0 + focus * 5.0);
  var diamondB = pow(envB, 1.4 + focus * 3.6);
  var stars = max(envA * 0.46 + diamondA * 0.78,
                  envB * 0.32 + diamondB * 0.54);

  // Kick reveals a separate dormant constellation; no full-rig white flash.
  var kickPop = clamp01(kick);
  var kickShape = kickPop * (2.0 - kickPop);
  var dormant = (seedC < 0.28 * countScale) ? 1.0 : 0.0;
  var burstLife = starPhase * (0.72 + seedA * 0.36) + seedB;
  burstLife = burstLife - floor(burstLife);
  var burst = starEnvelope(burstLife, 0.82, 0.38) * dormant
            * kickShape * kickGain;

  // Afterglow lengthens tails and gently raises their retained energy, making
  // Afterglow visually legible under a changing audio signal.
  var starEnergy = (stars * clamp01(brilliance) * starGain + burst)
                 * (0.72 + kickShape * 0.52) * (0.90 + tail * 0.77);

  // Velvet background is deliberately low-frequency and subordinate.
  var velvet = wave(nx * 0.37 + ny * 0.23 + nz * 0.19 + bedPhase);
  var bed = bedGain * (0.020 + velvet * 0.055);
  var levelGain = clamp01(level);

  // Background is pure cp1; stars are pure cp2. They remain visibly distinct.
  var r = (pr1 * bed + pr2 * starEnergy) * levelGain;
  var g = (pg1 * bed + pg2 * starEnergy) * levelGain;
  var b = (pb1 * bed + pb2 * starEnergy) * levelGain;

  if (fixtureType == FIX_TE_SIGN) {
    // Identity: the letterforms stay legible as cp1 velvet while fixed sparse
    // cp2 diamonds ignite and decay across both signs. XYZ shapes the broad
    // constellation; pixelLocalIndex pins each star to an individual letter
    // stroke, so there is no moving wash or unrelated per-frame noise.
    var signVelvet = wave(nx * 1.414 + ny * 0.618 + nz * 1.732
                          + bedPhase * 0.73);
    var signSeed = wave(pixelLocalIndex * 0.381966 + nx * 2.17
                        + ny * 3.11 + nz * 5.07);
    // A denser but still restrained set of fixed letter-stroke stars keeps
    // their ignition/decay readable across the full Identity instrument.
    var signThreshold = 0.064 + clamp01(starCount) * 0.185;
    var signSelected = (signSeed < signThreshold) ? 1.0 : 0.0;
    var signLife = starPhase * (0.42 + signSeed * 0.22)
                 + signSeed * 0.67 + nx * 0.11 + ny * 0.07 + nz * 0.05;
    signLife = signLife - floor(signLife);
    var signEnv = starEnvelope(signLife, focus, tail) * signSelected;
    var signDiamond = pow(signEnv, 1.3 + focus * 4.7);

    // Burst reveals a second tiny constellation; it never becomes a sign-wide
    // white or RGB flash.
    var signBurstSeed = wave(pixelLocalIndex * 0.618034 - nx * 3.17
                             + ny * 2.13 + nz * 4.19);
    var signDormant = (signBurstSeed < 0.055) ? 1.0 : 0.0;
    var signBurstLife = starPhase * 0.23 + signBurstSeed * 0.79;
    signBurstLife = signBurstLife - floor(signBurstLife);
    var signBurst = starEnvelope(signBurstLife, 0.84, 0.34)
                  * signDormant * kickShape;

    // The readable floor remains positive at Level=0: Identity must not
    // vanish. Level still gives a broad, perceptible gain over the floor.
    var signBed = 0.46 + signVelvet * 0.10 + velvet * 0.04;
    var signLevelGain = 0.36 + levelGain * 0.64;
    var signStars = (signDiamond * clamp01(brilliance)
                    * (0.78 + chorus * 0.22) + signBurst * 0.72)
                  * (0.88 + tail * 0.44) * 2.40;
    r = (pr1 * signBed + pr2 * signStars) * signLevelGain;
    g = (pg1 * signBed + pg2 * signStars) * signLevelGain;
    b = (pb1 * signBed + pb2 * signStars) * signLevelGain;
  }

  // Vintage Jewelry alone receives native golden matched-W+A diamonds.
  var w = 0.0;
  if (fixtureType == FIX_VINTAGE_6) {
    var whiteCore = diamondA * 0.82 + diamondB * 0.58 + burst * 0.74;
    w = clamp01(clamp01(jewelryWhite) * levelGain * whiteCore * 1.35);
    r = r + w * 0.18;
    g = g + w * 0.08;
  }

  // UV stays star-shaped rather than becoming a wash: Bars carry the main
  // ultraviolet constellation and PARs echo it as restrained point sources.
  // Multiplication by uvStars gives a true zero endpoint; all other fixture
  // families keep U=0 and retain their existing RGB/W output byte-for-byte.
  var u = 0.0;
  if (fixtureType == FIX_BAR_18 || fixtureType == FIX_PAR) {
    var uvRole = 1.0;
    if (fixtureType == FIX_PAR) uvRole = 0.68;
    var uvCore = diamondA * 0.78 + envA * 0.22
               + envB * 0.38 + burst * 0.52;
    u = clamp01(clamp01(uvStars) * levelGain * uvCore * 2.35 * uvRole);
  }

  rgbwau(clamp01(r), clamp01(g), clamp01(b), w, w, u);
}
