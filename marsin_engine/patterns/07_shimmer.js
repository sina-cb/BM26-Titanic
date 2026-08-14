/*
  07_shimmer.js — "Shimmering Glow"

  A warm, slow-breathing ambient wash with crisp traveling glints, like
  candlelight moving across water. The fixture-capability composition stays
  portable: colored shimmer crosses the rig, while Vintage rails alone carry
  the rich matched-W+A Jewelry shimmer. TE signs keep the same palette and
  candle-shimmer language, with fixed XYZ/local-index points that ignite and
  decay over a steady floor so the letterform stays readable between blinks.

  The shimmer has one intentional fixed travel direction. A direction knob was
  not artistically useful here, so localSpeed is the only motion-rate control.
  Detail controls sparkle texture/count. Kick produces a clear colored glint
  punch and strengthens the Jewelry white cores. JewelryWhite is the one honest
  white control: 0 emits no white; 1 gives full Vintage golden-white shimmer.

AUDIO_MODULATION_V1:
  sliderLevel        <- micLow  range 0.30..1.00 curve linear  # whole-pattern brightness
  sliderDetail       <- micHigh range 0.20..0.95 curve linear  # shimmer texture/count
  sliderKick         <- micKick range 0.00..1.00 curve pow2    # colored + Jewelry glint punch
  # STATIC (omit from audio): localSpeed, jewelryWhite, colorPalette1/2
*/

// Optional accent role: self-declared at its append-only canonical registry id
// so scenes without TE signs still compile; the branch simply has no members.
var FIX_TE_SIGN = 7;

// ── Exported controls (UI order = declaration order) ────────────────────────
export var localSpeed = 0.5;
export var level = 0.5;          // AUDIO PRIMARY: overall brightness gain
export var detail = 0.5;         // AUDIO: shimmer texture / count
export var kick = 0.5;           // AUDIO: colored + Jewelry glint punch
export var jewelryWhite = 0.5;   // WHITE: Vintage-only golden-white shimmer

export var cp1H = 0.08, cp1S = 1.0, cp1V = 1.0; // base wash (warm amber)
export var cp2H = 0.17, cp2S = 1.0, cp2V = 1.0; // shimmer glints (warm amber/gold)
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderLevel(v) { level = v; }
export function sliderDetail(v) { detail = v; }
export function sliderKick(v) { kick = v; }
export function sliderJewelryWhite(v) { jewelryWhite = v; }

// ── Tunables ────────────────────────────────────────────────────────────────
var BREATH_RATE = 0.12;     // breaths per second at localSpeed = 1.0
var SHIMMER_RATE = 0.55;    // glint drift per second at localSpeed = 1.0
var PHASE_WRAP = 10000.0;
var BASE_FLOOR = 0.05;      // calm non-black base in silence
var SHIMMER_SPREAD = 0.83; // preserves the operator-approved spatial spread

// ── Palette RGB cache ─────────────────────────────────────────────────────────
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

// ── Persistent state ─────────────────────────────────────────────────────────
var breathPhase = 0.0;
var shimmerPhase = 0.0;
var glintDrift = 0.0; // resolved signed glint drift this frame

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  _hsv2rgb1();
  _hsv2rgb2();

  var localMultiplier = pow(2.0, (localSpeed - 0.5) * 4.0); // §6
  var rate = 0.06 + 0.94 * localMultiplier; // tiny creep at localSpeed = 0

  breathPhase = breathPhase + dt * rate * BREATH_RATE;          // rate ×1.0
  if (breathPhase >= PHASE_WRAP) breathPhase = breathPhase - PHASE_WRAP;

  shimmerPhase = shimmerPhase - dt * rate * SHIMMER_RATE * 1.73205; // √3
  if (shimmerPhase >= PHASE_WRAP) shimmerPhase = shimmerPhase - PHASE_WRAP;
  else if (shimmerPhase < 0.0) shimmerPhase = shimmerPhase + PHASE_WRAP;

  glintDrift = shimmerPhase;
}

export function render3D(index, wx, wy, wz) {
  // Spatial coordinate along the rig (use x for horizontal flow; clamp 0..1).
  var nx = wx;
  if (nx < 0.0) nx = 0.0; else if (nx > 1.0) nx = 1.0;
  var ny = wy;
  if (ny < 0.0) ny = 0.0; else if (ny > 1.0) ny = 1.0;

  // Slow breathing wash (cp1). A gentle spatial gradient keeps it alive even
  // when frozen, and the swell is driven by breathPhase.
  // Wash brightness is spatially near-uniform per frame (so total rig brightness
  // tracks `level`, not animation phase). The "breathing" lives as a gentle
  // per-pixel SHIMMER of brightness that averages out across the rig, plus the
  // travelling glints below — the look moves without total-brightness wobble.
  var breathe = 0.5 + 0.5 * sin((breathPhase + nx * 2.7 + ny * 1.3) * PI2);
  var washStruct = 0.80 + 0.20 * breathe; // mostly uniform; small live shimmer

  // Crisp shimmer glints: Detail changes texture/count. The old Radius knob
  // actually changed phase density, not radius, so its approved .83 spread is
  // now an internal composition constant instead of a misleading control.
  var hashp = (index * 0.61803 + nx * 7.0 + ny * 3.0);
  hashp = hashp - floor(hashp);
  var tw = glintDrift + hashp
         + nx * (0.7 + SHIMMER_SPREAD * 5.5)
         + ny * SHIMMER_SPREAD * 2.3;
  var sWave = 0.5 + 0.5 * sin(tw * PI2);
  var sharp = 6.0 + detail * 18.0;
  var glint = pow(sWave, sharp);
  var elig = 0.5 + 0.5 * sin((hashp * 11.0 + 0.37) * PI2);
  if (elig < (1.0 - (0.3 + detail * 0.6))) glint = glint * 0.15;

  // PRIMARY audio: one level-driven gain on the whole pixel so total brightness
  // tracks level (not animation phase). BASE_FLOOR keeps silence calm/visible.
  var gain = 0.08 + level * 0.72;

  // Glint amount adds the cp2 colour on top of the wash; kick gives a uniform
  // brightness pop (gain-scaled so it doesn't decorrelate the PRIMARY).
  var glintAmt = glint * (1.0 + SHIMMER_SPREAD * 0.5);
  var kickPop = clamp01(kick);
  var kickShape = kickPop * (2.0 - kickPop);

  // Lit warm base wash (og identity: a bright candlelit glow, not a dim floor).
  // Kick acts on the shimmer, not the base wash, so it reads as a crisp hit.
  var washV = washStruct * gain * 0.76 * 0.90;
  var glintV = glintAmt * gain * (1.0 + kickShape * 1.80);

  // Two-colour: wash = cp1, glint = cp2, summed channel-wise (blend in RGB).
  var r = clamp01(pr1 * washV + pr2 * glintV);
  var g = clamp01(pg1 * washV + pg2 * glintV);
  var b = clamp01(pb1 * washV + pb2 * glintV);

  // One honest white control: Vintage-only matched W+A golden shimmer.
  // Kick strengthens the same cores instead of requiring a competing white-kick knob.
  var outW = 0.0;
  if (fixtureType == FIX_VINTAGE_6) {
    var whiteKeep = clamp01(jewelryWhite);
    outW = clamp01(whiteKeep * gain * (0.10 + glint * 0.90)
                 * (0.68 + kickShape * 1.65));
    r = clamp01(r + outW * 0.18);
    g = clamp01(g + outW * 0.08);
  } else if (fixtureType == FIX_TE_SIGN) {
    // Identity: fixed letter-stroke points ignite and decay like candle jewels.
    // XYZ plus pixelLocalIndex creates immutable addresses; time never re-seeds
    // them, so this is discrete shimmer rather than noise or a traveling wave.
    var signZ = wz;
    if (signZ < 0.0) signZ = 0.0; else if (signZ > 1.0) signZ = 1.0;
    var signSeed = wave(pixelLocalIndex * 0.381966 + nx * 1.61803
                      + ny * 2.39996 + signZ * 1.41421);
    var signPhaseOffset = pixelLocalIndex * 0.618034 + nx * 0.173
                        + ny * 0.113 + signZ * 0.271;
    var signRelief = wave(pixelLocalIndex * 0.017 + nx * 0.83
                        - ny * 1.31 + signZ * 0.73);
    var signSelected = (signSeed < 0.15 + detail * 0.18) ? 1.0 : 0.0;

    // shimmerPhase runs backward, so negating it yields an increasing lifecycle.
    // Its 10000-turn wrap is an integer and this consumer has unit clock gain;
    // the envelope is zero both at life=0 and throughout the tail to life=1.
    var signLife = -glintDrift + signPhaseOffset;
    signLife = signLife - floor(signLife);
    var signEnv = 0.0;
    if (signLife < 0.12) {
      var signAttack = signLife / 0.12;
      signEnv = signAttack * signAttack * (3.0 - 2.0 * signAttack);
    } else if (signLife < 0.72) {
      var signDecay = (0.72 - signLife) / 0.60;
      signEnv = signDecay * signDecay * (3.0 - 2.0 * signDecay);
    }
    var signCore = pow(signEnv, 2.6) * signSelected;

    // The warm bed keeps every stroke legible. Every address receives only a
    // restrained ember halo; selected addresses carry the bright cp2 jewel.
    var signFloor = (0.15 + level * 0.46) * (0.90 + signRelief * 0.10);
    var signHalo = signEnv * (0.025 + signSelected * 0.035);
    var signBlink = signCore * gain * (0.65 + detail * 0.35)
                  * (1.0 + kickShape * 0.45);
    var signV = signFloor + signHalo + signBlink;
    signV = clamp01(signV);
    var signBlend = clamp01(0.10 + signRelief * 0.12
                          + signEnv * 0.08 + signCore * 0.70);
    r = (pr1 + (pr2 - pr1) * signBlend) * signV;
    g = (pg1 + (pg2 - pg1) * signBlend) * signV;
    b = (pb1 + (pb2 - pb1) * signBlend) * signV;
  }
  var outA = outW;
  var outU = 0.0;

  // LANE MATCH (w == a): the bare W emitter reads cold and the bare A emitter
  // reads yellow — matched W+A is the ship's warm white, and it is what the LED
  // strands already render (they fold amber into RGB). Convention:
  // docs/MARSIN_ENGINE_PATTERNS.md -> "White handling: the w == a convention".
  outA = outW;

  rgbwau(r, g, b, outW, clamp01(outA), clamp01(outU));
}
