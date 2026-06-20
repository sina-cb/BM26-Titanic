/*
  11_bioluminescence.js
  HD Bioluminescence — slow ambient cp1 swell with sharp pow-shaped cp2 crests
  and a gentle additive UV glow (the signature blacklight feel preserved).

  Identity kept: ambient = cp1, crests = cp2, additive UV undertow. Now HD,
  render3D-based, audio-reactive, and never dead-static.

  CORE NON-REPEATING MATH (documented per skill 12 §3/§7):
    Two drift accumulators advance at INCOMMENSURATE rates (ratio ~ √2) and a
    third caustic phase uses the golden angle (2.39996). Crests are sampled at
    spatial frequencies density and density*√2 so the swell never re-locks.
    Phases accumulate against a large PHASE_WRAP (no wrapped-then-scaled seam).

  SPEED / DIRECTION:
    localSpeed drives every drift via rate = pow(2,(localSpeed-0.5)*4) (creeps at
    0, ~4x at 1). `direction` is guarded off slider-center; an autonomous, clock
    driven sign (incommensurate ~91s period) occasionally flips the current's
    travel on its own so it feels organic, not mechanical.

  KICK-GATED PRIMARY: validate the micLow PRIMARY corr on --synth kick_4floor
  (full_track's low band is near-constant so corr reads lower there).

  AUDIO (modulators-only — never read CPC audio globals natively; the block below
  is the STRICT source of truth for the deploy-playlist generator):
      AUDIO_MODULATION_V1:
        sliderLevel     <- micLow  range 0.30..1.00 curve linear  # PRIMARY overall brightness (bass)
        sliderKick      <- micKick range 0.00..1.00 curve pow2    # crest brightness pop (kick)
        sliderRadius    <- micFlux range 0.40..0.90 curve linear  # crest travel / spread (build)
        sliderDetail    <- micHigh range 0.20..0.95 curve linear  # fine crest sharpness / shimmer (highs)
        sliderWhiteKick <- micKick range 0.00..1.00 curve pow2    # crest-core white pop (kick)
        sliderWhiteLevel<- micLow  range 0.20..0.80 curve linear  # overall white crest keep (bass)
      # STATIC (not modulated): direction, density, uvGlow, whiteWarmth — operator/scene set.
  GENTLE white pattern (no hard blinder — matches the soft blacklight feel): a
  crisp white SPARK rides only the crest peaks (additive under the cp1/cp2 colour),
  controlled by whiteLevel (amount) and whiteKick (kick pop). whiteWarmth tilts the
  white tint between warm amber (A) and cool/UV (U) — natural here since the
  pattern already carries a signature UV undertow on the u channel (uvIntensity).
  White is ADDITIVE (hueSpread stays high — never washes the rig white).
*/

// ── Exported controls (UI order = declaration order) ─────────────────────────
export var localSpeed = 0.5;   // master motion rate
export var direction = 0.5;    // current travel direction (0.5 = guarded center)
export var level = 0.5;        // AUDIO: overall brightness (PRIMARY)
export var kick = 0.5;         // AUDIO: crest brightness pop
export var radius = 0.5;       // AUDIO: crest travel / spread distance
export var detail = 0.5;       // AUDIO: crest sharpness / shimmer
export var density = 0.5;      // spatial frequency of the swell
export var uvIntensity = 0.5;  // additive UV undertow
export var whiteLevel = 0.5;   // WHITE: overall white crest amount / keep (micLow)
export var whiteKick = 0.5;    // WHITE: kick-driven crest-core white pop (micKick)
export var whiteWarmth = 0.5;  // WHITE: warm amber(A) <-> cool/UV(U) tint of the white

export var cp1H = 0.6, cp1S = 1.0, cp1V = 1.0; // Ambient swell
export var cp2H = 0.3, cp2S = 1.0, cp2V = 1.0; // Crest pop
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderDirection(v) { direction = v; }
export function sliderLevel(v) { level = v; }
export function sliderKick(v) { kick = v; }
export function sliderRadius(v) { radius = v; }
export function sliderDetail(v) { detail = v; }
export function sliderDensity(v) { density = v; }
export function sliderUvGlow(v) { uvIntensity = v; }
export function sliderWhiteLevel(v) { whiteLevel = v; }
export function sliderWhiteKick(v) { whiteKick = v; }
export function sliderWhiteWarmth(v) { whiteWarmth = v; }

// ── Tunables ─────────────────────────────────────────────────────────────────
var MAX_RATE = 0.55;         // base drift turns/sec at localSpeed = 1.0
var PHASE_WRAP = 10000.0;    // large wrap; far from any in-frame scale (§7)
var AUTO_PERIOD = 91.0;      // seconds for autonomous direction oscillation
var BASE_FLOOR = 0.05;       // small non-black floor so silence stays visible

// ── Palette RGB cache (verbatim from 27_swipe) ───────────────────────────────
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

function clamp01(v) {
  if (v < 0.0) return 0.0;
  if (v > 1.0) return 1.0;
  return v;
}

// ── Persistent state ─────────────────────────────────────────────────────────
var driftA = 0.0;     // primary swell drift
var driftB = 0.0;     // secondary (incommensurate) drift
var driftUV = 0.0;    // UV undertow drift
var autoClock = 0.0;  // seconds, for autonomous direction oscillation
var effDir = 1.0;     // resolved travel sign this frame
var localMul = 1.0;

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  // localSpeed: pow(2,(v-0.5)*4) gives 0.5=normal (factor 1.0), 1≈4x. A small
  // additive creep floor keeps v=0 CLEARLY slow-but-moving (not a near-freeze on
  // this dim pattern) while preserving factor 1.0 at the 0.5 default (0.06+0.94=1).
  localMul = 0.06 + 0.94 * pow(2.0, (localSpeed - 0.5) * 4.0);

  // Guard the slider center so the manual direction sign never sits at 0.
  var manDir = (direction * 2.0) - 1.0;
  if (manDir >= 0.0 && manDir < 0.06) manDir = 0.06;
  else if (manDir < 0.0 && manDir > -0.06) manDir = -0.06;

  // Autonomous, incommensurate direction oscillation (organic auto-switch).
  autoClock = autoClock + dt;
  if (autoClock >= PHASE_WRAP) autoClock = autoClock - PHASE_WRAP;
  var autoWave = sin(autoClock / AUTO_PERIOD * PI2);
  var autoSign = (autoWave >= 0.0) ? 1.0 : -1.0;
  effDir = manDir * autoSign;

  // Drift accumulators advance with localSpeed; √2 ratio = non-repeating.
  driftA = driftA + dt * localMul * MAX_RATE * effDir;
  driftB = driftB + dt * localMul * MAX_RATE * 1.41421 * effDir;
  driftUV = driftUV + dt * localMul * MAX_RATE * 0.37;
  if (driftA >= PHASE_WRAP) driftA = driftA - PHASE_WRAP;
  else if (driftA <= -PHASE_WRAP) driftA = driftA + PHASE_WRAP;
  if (driftB >= PHASE_WRAP) driftB = driftB - PHASE_WRAP;
  else if (driftB <= -PHASE_WRAP) driftB = driftB + PHASE_WRAP;
  if (driftUV >= PHASE_WRAP) driftUV = driftUV - PHASE_WRAP;

  _hsv2rgb1();
  _hsv2rgb2();
}

export function render3D(index, x, y, z) {
  // Coords are already 0..1 — use directly (clamp only).
  var pct = clamp01(x);
  var pcy = clamp01(y);

  var dens = 1.0 + density * 5.0;
  var spread = 0.6 + radius * 1.6;   // AUDIO: crest spatial reach

  // Ambient swell (cp1 dominates) — incommensurate sample frequencies. The
  // temporal drift weight (0.55) is brisk enough that the swell visibly breathes
  // within a couple of seconds even with NO audio, so the silent wash always
  // animates (never reads static) while the spatial frequency keeps the HD relief.
  var swell = wave(driftA * 0.55 + pct * dens + pcy * 0.31);
  var swell2 = wave(driftB * 0.55 + pct * dens * 1.41421 + pcy * 0.17);
  var combined = swell * 0.62 + swell2 * 0.38;

  // Crest sharpness: detail tightens the pow exponent for crisper cores.
  var sharp = 4.0 + detail * 6.0;
  var blend = pow(combined, sharp);

  // Crest gate travels/spreads with radius (AUDIO movement RADIUS).
  var crestField = wave(driftA * 0.55 * spread + pct * dens * spread + pcy * 0.23);
  var crest = (crestField > (0.84 - radius * 0.14)) ? 1.0 : 0.0;
  crest = crest * pow(combined, 2.0);

  // Brightness: ambient breathes, crest pops; kick adds a pop. The ambient is
  // gently swelled by a slow, spatially-coherent "tide" on the always-forward UV
  // drift clock so the whole field visibly rises & ebbs even with NO audio — the
  // silent wash is never static. Low amplitude so it barely touches the
  // level-driven PRIMARY brightness budget.
  // NOTE: this VM treats the bare name `v` as a reserved global (HSV value), so
  // assigning to a local `v` silently desyncs from the arithmetic chain — the
  // brightness local is named `bval` here so the floor/level chain is honoured.
  var bri = combined * 0.7;
  var crestBri = crest * (0.6 + kick * 0.8);
  var bval = max(bri, crestBri);
  // Calm-but-lit visibility FLOOR (0.11 — every pixel clears black in silence,
  // mission critical, but low enough to keep the deep two-colour HD relief) and
  // the AUDIO PRIMARY level gain mapped onto a USEFUL span (calm-but-lit at
  // slider 0, full at 1, bright at the 0.5 centre).
  bval = (0.11 + bval * 0.89) * (0.30 + level * 0.70);
  // Whole-rig "tide": a slow, spatially-coherent breath on the always-forward UV
  // drift clock so the field visibly swells & ebbs even with NO audio (never
  // static). Low amplitude so it barely touches the level-driven PRIMARY budget.
  bval = bval * (0.78 + 0.22 * wave(driftUV * 1.9 + 0.13));

  // Strict cp1->cp2 RGB lerp (crest pushes toward cp2).
  var tcol = clamp01(blend + crest * 0.5);
  var r = (pr1 + (pr2 - pr1) * tcol) * bval;
  var g = (pg1 + (pg2 - pg1) * tcol) * bval;
  var b = (pb1 + (pb2 - pb1) * tcol) * bval;

  // Additive UV undertow — the signature blacklight glow (kept on its own knob).
  var uvGlow = wave(driftUV * 0.55 - pct * 0.5 + pcy * 0.2);
  var outU = uvGlow * uvIntensity * 0.6 * (0.30 + level * 0.70);

  // WHITE crest spark (gentle, additive on the crest peaks only). whiteLevel sets
  // the amount, whiteKick the kick pop; gated by level so it tracks the PRIMARY.
  var whiteKeep = clamp01(whiteLevel);
  var whiteBite = clamp01(whiteKick);
  var whiteTint = clamp01(whiteWarmth);
  var outW = crest * (0.18 + 0.55 * whiteKeep) * (0.5 + kick * 0.5 + whiteBite * 0.7)
           * (0.30 + level * 0.70);
  outW = clamp01(outW);
  // Tint the white spark amber(A)<->cool/UV(U); the cool side reinforces the
  // blacklight feel, the warm side reads like a phosphorescent glow.
  var outA = outW * (1.0 - whiteTint) * 0.5;
  outU = outU + outW * whiteTint * 0.5;

  rgbwau(clamp01(r), clamp01(g), clamp01(b), outW, clamp01(outA), clamp01(outU));
}
