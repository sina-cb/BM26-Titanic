/*
  112_logsville_giant_call_response
  Logsville redwoods as 3-5 GIANT pixels — the LEFT half "calls" in cp1
  and the RIGHT half "answers" in cp2. conversation picks the
  conversational shape (A->B / A<->B alternating / overlap-chord /
  round-robin sequence). Vintage cluster + walls are split the same way
  (left half cp1, right half cp2) so the entire grove participates in
  the call/response (Rule C). Floor and halo math from Rule B keep the
  trees organic, never a scoreboard.

  Audio sliders (default 0):
    audioBass — boosts cp1 (left / "call") side intensity
    audioMid  — boosts cp2 (right / "answer") side intensity
    audioKick — forces an immediate conversation turn flip

  View masks consumed (named, registered in summer_camp_logsville.viewmasks.js):
    RedwoodPARs (0x40) — left/right giant-pixel conversation
    VintageOnly (0x80) — split cp1/cp2 wash mirroring the redwoods
*/

// Named view-mask bits (mirrors summer_camp_logsville.viewmasks.js).
var MASK_REDWOOD_PARS = 64;
var MASK_VINTAGE_ONLY = 128;

// Redwood pixel range — derived count, defensive for future expansion.
var REDWOOD_BASE = 204;
var REDWOOD_END  = 221;
var NUM_REDWOOD_PIXELS = REDWOOD_END - REDWOOD_BASE + 1;

// Conversation mode enum.
var CONV_A_THEN_B  = 0;  // A speaks then B answers (call -> response)
var CONV_PINGPONG  = 1;  // alternating A, B, A, B every turn
var CONV_OVERLAP   = 2;  // both speak at once (chord) with slight phase
var CONV_ROUND     = 3;  // round-robin: each section lights in sequence
var CONV_COUNT     = 4;

export var localSpeed = 0.5;
export var sectionFloor = 0.08;
export var neighborWeight = 0.30;
export var turnBrightness = 1.0;
export var turnDecay = 0.55;
export var vintageMix = 0.55;

export var sectionCountSlider = 0.5;
export var conversation = 0.0;

// Audio sliders.
export var audioBass = 0.0;
export var audioMid  = 0.0;
export var audioKick = 0.0;

// Palette defaults — bright per Rule D.
export var cp1H = 0.62, cp1S = 1.0, cp1V = 1.0;   // blue (call)
export var cp2H = 0.0,  cp2S = 1.0, cp2V = 0.95;  // red  (answer)
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderSectionFloor(v) { sectionFloor = v; }
export function sliderNeighborWeight(v) { neighborWeight = v; }
export function sliderTurnBrightness(v) { turnBrightness = v; }
export function sliderTurnDecay(v) { turnDecay = v; }
export function sliderVintageMix(v) { vintageMix = v; }
export function sliderSectionCount(v) { sectionCountSlider = v; }
export function sliderConversation(v) { conversation = v; }
export function sliderAudioBass(v) { audioBass = v; }
export function sliderAudioMid(v) { audioMid = v; }
export function sliderAudioKick(v) { audioKick = v; }

var pr1 = 1, pg1 = 0, pb1 = 0;
var pr2 = 0, pg2 = 0, pb2 = 1;

function _hsv2rgb1() {
  var hv = cp1H - floor(cp1H); if (hv < 0) hv += 1;
  var iv = floor(hv * 6) % 6;
  var fv = hv * 6 - floor(hv * 6);
  var pv = cp1V * (1 - cp1S);
  var qv = cp1V * (1 - fv * cp1S);
  var tv = cp1V * (1 - (1 - fv) * cp1S);
  if      (iv == 0) { pr1 = cp1V; pg1 = tv;   pb1 = pv;   }
  else if (iv == 1) { pr1 = qv;   pg1 = cp1V; pb1 = pv;   }
  else if (iv == 2) { pr1 = pv;   pg1 = cp1V; pb1 = tv;   }
  else if (iv == 3) { pr1 = pv;   pg1 = qv;   pb1 = cp1V; }
  else if (iv == 4) { pr1 = tv;   pg1 = pv;   pb1 = cp1V; }
  else              { pr1 = cp1V; pg1 = pv;   pb1 = qv;   }
}

function _hsv2rgb2() {
  var hv = cp2H - floor(cp2H); if (hv < 0) hv += 1;
  var iv = floor(hv * 6) % 6;
  var fv = hv * 6 - floor(hv * 6);
  var pv = cp2V * (1 - cp2S);
  var qv = cp2V * (1 - fv * cp2S);
  var tv = cp2V * (1 - (1 - fv) * cp2S);
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

// State.
var tPhase = 0.0;
var turnPhase = 0.0;     // 0..1 across a single conversational turn
var turnCount = 0;       // which turn we're on
var aEnv = 0.0, bEnv = 0.0;  // envelopes for call (A=left=cp1), response (B=right=cp2)
var roundIdx = 0;        // active section for CONV_ROUND
var prevKick = 0.0;
var sectionCount = 4;
var convMode = 0;

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  var localMult = pow(2.0, (localSpeed - 0.5) * 5.4);
  tPhase = (tPhase + (delta / 1310.72) * localMult) % 1.0;
  if (tPhase < 0.0) tPhase += 1.0;

  _hsv2rgb1();
  _hsv2rgb2();

  sectionCount = 3 + floor(clamp01(sectionCountSlider + 0.001) * 2.99);
  if (sectionCount < 3) sectionCount = 3;
  if (sectionCount > 5) sectionCount = 5;

  convMode = floor(clamp01(conversation + 0.001) * (CONV_COUNT - 0.01));
  if (convMode < 0) convMode = 0;
  if (convMode >= CONV_COUNT) convMode = CONV_COUNT - 1;

  // One "turn" per ~1 second at localSpeed 0.5.
  var turnHz = 0.4 + localSpeed * 1.6;
  turnPhase = turnPhase + dt * turnHz;
  var advanced = 0;
  if (turnPhase >= 1.0) {
    advanced = floor(turnPhase);
    turnPhase = turnPhase - advanced;
    turnCount = (turnCount + advanced) % 1024;
    roundIdx = (roundIdx + advanced) % sectionCount;
  }

  // Audio kick forces a turn flip immediately.
  var kickRise = audioKick - prevKick;
  prevKick = audioKick;
  if (kickRise > 0.08) {
    turnCount = (turnCount + 1) % 1024;
    roundIdx = (roundIdx + 1) % sectionCount;
    turnPhase = 0.0;
    advanced = advanced + 1;
  }

  // Drive A/B envelopes based on mode and turnCount parity.
  if (advanced > 0) {
    if (convMode == CONV_A_THEN_B) {
      // Even turns: A speaks; odd turns: B answers.
      if ((turnCount & 1) == 0) aEnv = 1.0;
      else                       bEnv = 1.0;
    } else if (convMode == CONV_PINGPONG) {
      // Alternating, same as A_THEN_B but quicker, and we let the previous
      // env decay further before the new one fires.
      if ((turnCount & 1) == 0) aEnv = 1.0;
      else                       bEnv = 1.0;
    } else if (convMode == CONV_OVERLAP) {
      // Chord: both fire each turn, but offset so they're not identical.
      aEnv = 1.0;
      bEnv = 0.75;
    } else {
      // CONV_ROUND — single section lights, drives A or B depending on which
      // half of the grove it's in. roundIdx has already advanced.
      var halfSC = sectionCount * 0.5;
      if (roundIdx < halfSC) aEnv = 1.0;
      else                   bEnv = 1.0;
    }
  }

  // Decay envelopes — turnDecay sets half-life (snappy..lazy).
  var halfLife = 0.08 + turnDecay * 0.70;
  aEnv = aEnv * pow(0.5, dt / halfLife);
  bEnv = bEnv * pow(0.5, dt / halfLife);
}

// Engine convention: x, y, z are normalized pixel coords in [0,1].
export function render3D(index, x, y, z) {
  var isRedwood = (viewMask & MASK_REDWOOD_PARS) != 0;
  var isVintage = (viewMask & MASK_VINTAGE_ONLY) != 0;
  var r = 0.0, g = 0.0, b = 0.0, w = 0.0, a = 0.0, u = 0.0;

  if (isRedwood) {
    var localIdx = index - REDWOOD_BASE;
    if (localIdx < 0) localIdx = 0;
    if (localIdx >= NUM_REDWOOD_PIXELS) localIdx = NUM_REDWOOD_PIXELS - 1;
    var giantPixelId = floor(localIdx * sectionCount / NUM_REDWOOD_PIXELS);
    if (giantPixelId >= sectionCount) giantPixelId = sectionCount - 1;

    // Left = cp1 (call), Right = cp2 (answer). With odd sectionCount, the
    // middle section belongs to whichever side it tips toward; we keep it
    // on cp1 (left) so it always has a "home."
    var halfSC = sectionCount * 0.5;
    var sideIsA = (giantPixelId < halfSC);

    // Per-section "loudness" within the active side. CONV_ROUND lights only
    // the matching index — everyone else just shows the side floor / halo.
    var isThisRoundSection = (giantPixelId == roundIdx);

    var envA = aEnv * (1.0 + audioBass * 0.6);
    var envB = bEnv * (1.0 + audioMid  * 0.6);

    // Floor / halo (Rule B). Halo: nearest active-side section glows softly.
    // Per-section breath uses both tPhase AND a per-section offset so the
    // trees never read as static between turn boundaries — even when the
    // envelopes have decayed, each tree breathes with its own phase and
    // there's a slow traveling shimmer across the grove.
    var floorBreath = sectionFloor * (0.85 + 0.15 * wave(tPhase + giantPixelId * 0.17));

    var coreEnv = sideIsA ? envA : envB;
    var oppEnv  = sideIsA ? envB : envA;

    // Slow continuous traveling ripple across the trees, anchored to
    // tPhase (NOT just the discrete turn boundary). This is what the
    // operator wanted — the trees should always have visible motion, not
    // just snap at each turn flip.
    var ripple = 0.5 + 0.5 * wave(tPhase * 1.3 + giantPixelId * 0.22);
    var rippleLevel = (0.20 + 0.18 * max(coreEnv, oppEnv)) * ripple;

    // Brightness logic per mode.
    var coreLevel = 0.0;
    if (convMode == CONV_ROUND) {
      // Only the active round section pops; others on the active side stay
      // at neighborWeight.
      if (isThisRoundSection) coreLevel = turnBrightness * coreEnv;
      else if (coreEnv > 0.05) coreLevel = neighborWeight * coreEnv;
    } else if (convMode == CONV_OVERLAP) {
      // All sections on the active side glow together as a "chord."
      coreLevel = turnBrightness * coreEnv;
    } else {
      // A_THEN_B / PINGPONG — whole side lights with a small left/right edge
      // ramp so the conversation reads as direction, not a uniform slab.
      // Edge ramp is now modulated by the ripple so the slab "shimmers"
      // along its length instead of holding flat.
      var edgeRamp = sideIsA
          ? (1.0 - giantPixelId / halfSC)
          : ((giantPixelId - halfSC + 0.5) / halfSC);
      if (edgeRamp < 0.4) edgeRamp = 0.4;
      coreLevel = turnBrightness * coreEnv * edgeRamp * (0.75 + 0.25 * ripple);
    }

    // Opposite side gets a soft halo so it never goes fully dark
    // (organic / not a scoreboard).
    var oppLevel = neighborWeight * oppEnv * 0.5;

    var brightness = max(floorBreath, max(rippleLevel, max(coreLevel, oppLevel)));

    // Color: section primarily uses its side's color, with a tiny mix from
    // the opposing envelope (so the chord moment really does feel chordal).
    var sideRC = sideIsA ? pr1 : pr2;
    var sideGC = sideIsA ? pg1 : pg2;
    var sideBC = sideIsA ? pb1 : pb2;
    var oppRC  = sideIsA ? pr2 : pr1;
    var oppGC  = sideIsA ? pg2 : pg1;
    var oppBC  = sideIsA ? pb2 : pb1;

    var oppMix = clamp01(oppEnv * 0.35);
    var rc = sideRC + (oppRC - sideRC) * oppMix;
    var gc = sideGC + (oppGC - sideGC) * oppMix;
    var bc = sideBC + (oppBC - sideBC) * oppMix;

    r = rc * brightness;
    g = gc * brightness;
    b = bc * brightness;
    // Subtle amber on the active core to lend warmth on cool palettes.
    a = coreLevel * 0.25;
  } else if (isVintage) {
    // Vintage left/right split mirrors the redwoods. x is normalized [0,1];
    // 0.5 splits roughly across the stage.
    var leftSideVintage = (x < 0.5);
    var vEnv = leftSideVintage ? aEnv : bEnv;
    var rcV = leftSideVintage ? pr1 : pr2;
    var gcV = leftSideVintage ? pg1 : pg2;
    var bcV = leftSideVintage ? pb1 : pb2;
    var baseV = (0.15 + 0.55 * vEnv) * vintageMix;
    r = rcV * baseV;
    g = gcV * baseV;
    b = bcV * baseV;
    a = 0.30 * vEnv * vintageMix;
  } else {
    // Other surfaces: very low ambient that picks up whichever side is
    // currently "speaking" louder.
    var leftLouder = (aEnv > bEnv);
    var rcA = leftLouder ? pr1 : pr2;
    var gcA = leftLouder ? pg1 : pg2;
    var bcA = leftLouder ? pb1 : pb2;
    var ambient = 0.05 + 0.10 * max(aEnv, bEnv);
    r = rcA * ambient;
    g = gcA * ambient;
    b = bcA * ambient;
  }

  rgbwau(clamp01(r), clamp01(g), clamp01(b), clamp01(w), clamp01(a), clamp01(u));
}
