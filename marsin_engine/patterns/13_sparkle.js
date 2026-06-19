/*
  13_sparkle.js
  HD Distributed Section Sparkle — a dim two-colour wash (cp1 left, cp2 right)
  with crisp sparkle bursts that flash between the two palette colours, never
  desaturating to a third hue. Optional W/A/UV glints keep the sparks crisp.

  Identity kept: smooth left->right cp1/cp2 wash + per-pixel deterministic
  sparkle bursts leaning cp2, with white/amber/UV glints. Now HD, audio-reactive,
  with a travelling (occasionally self-reversing) wash and a level/kick/radius
  audio surface, never dead-static.

  CORE NON-REPEATING MATH (skill 12 §3/§7):
    The wash sums three wave() fields whose spatial frequencies use distinct
    irrational ratios (1.7, 2.3, 1.9 with a √2-scaled drift), so it never
    re-locks. Sparkles are a deterministic product of three sines at primes
    (3.7, 7.3) seeded by index + a sparkle clock — dense, never periodic. Phases
    accumulate against a large PHASE_WRAP (no wrapped-then-scaled seam).

  SPEED / DIRECTION:
    localSpeed scales every drift via rate = pow(2,(localSpeed-0.5)*4) (creeps at
    0, ~4x at 1). `direction` (guarded off center) sets wash travel; an
    autonomous incommensurate clock (~67s) occasionally reverses it on its own.

  AUDIO (modulators-only — never read CPC audio globals natively):
  AUDIO_MODULATION_V1:
    sliderLevel      <- micLow  range 0.30..1.00 curve linear  # PRIMARY overall brightness (bass)
    sliderKick       <- micKick range 0.00..1.00 curve pow2    # sparkle-burst brightness pop
    sliderRadius     <- micFlux range 0.40..0.90 curve linear  # sparkle bloom reach / spread
    sliderDensity    <- micHigh range 0.20..0.90 curve linear  # how many sparkles fire (hats)
    sliderWhiteKick  <- micKick range 0.00..1.00 curve pow2    # white-hot sparkle pop + vintage blinder
    sliderWhiteLevel <- micLow  range 0.30..0.90 curve linear  # overall white-glint amount
  # static (unmapped): direction, sparkleIntensity, sparkleSize, backgroundLevel,
  #   whiteGlint, amberGlint, uvGlint, whiteWarmth, palette pickers
    Sparkles throw a crisp W glint (white-hot on the kick); sliderWhiteWarmth
    tints that glint toward warm amber (a) vs cool UV (u). On the kick the VINTAGE
    heads (sectionId == 2) also fire a white blinder pop. White is ADDITIVE over
    the strict cp1/cp2 wash — only the sparks/heads carry it, never washing the
    whole rig white. The legacy whiteGlint/amberGlint/uvGlint knobs set the base
    glint mix; the white_* controls scale + kick-drive it.
*/

// ── Exported controls (UI order = declaration order) ─────────────────────────
export var localSpeed = 0.5;     // master motion rate
export var direction = 0.5;      // wash travel direction (0.5 = guarded center)
export var level = 1.0;          // AUDIO: overall brightness (PRIMARY)
export var kick = 0.0;           // AUDIO: sparkle-burst brightness pop
export var radius = 0.5;         // AUDIO: sparkle spread / bloom reach
export var density = 0.5;        // AUDIO: how many sparkles fire
export var sparkleIntensity = 0.7;
export var sparkleSize = 0.5;
export var backgroundLevel = 0.3;
export var whiteGlint = 0.5;
export var amberGlint = 0.3;
export var uvGlint = 0.3;
export var whiteLevel = 0.5;   // WHITE: overall white-glint amount (scales the glint mix)
export var whiteKick = 0.0;    // WHITE: kick-driven white-hot sparkle pop + blinder (audio target)
export var whiteWarmth = 0.5;  // WHITE: glint tint, 0=cool/UV .. 1=warm/amber

export var cp1H = 0.55, cp1S = 1.0, cp1V = 1.0; // Left / "A" colour (cyan)
export var cp2H = 0.08, cp2S = 1.0, cp2V = 1.0; // Right / "B" colour (amber)
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderDirection(v) { direction = v; }
export function sliderLevel(v) { level = v; }
export function sliderKick(v) { kick = v; }
export function sliderRadius(v) { radius = v; }
export function sliderDensity(v) { density = v; }
export function sliderSparkleIntensity(v) { sparkleIntensity = v; }
export function sliderSparkleSize(v) { sparkleSize = v; }
export function sliderBackgroundLevel(v) { backgroundLevel = v; }
export function sliderWhiteGlint(v) { whiteGlint = v; }
export function sliderAmberGlint(v) { amberGlint = v; }
export function sliderUvGlint(v) { uvGlint = v; }
export function sliderWhiteLevel(v) { whiteLevel = v; }
export function sliderWhiteKick(v) { whiteKick = v; }
export function sliderWhiteWarmth(v) { whiteWarmth = v; }

// ── Tunables ─────────────────────────────────────────────────────────────────
var MAX_RATE = 0.5;          // base wash drift turns/sec at localSpeed = 1.0
var SPARKLE_RATE = 0.9;      // sparkle clock turns/sec at localSpeed = 1.0
var PHASE_WRAP = 10000.0;
var AUTO_PERIOD = 67.0;
var BASE_FLOOR = 0.04;       // small non-black floor

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
var washDrift = 0.0;     // wash travel phase (direction-aware)
var sparkleClock = 0.0;  // sparkle re-seed phase
var autoClock = 0.0;
var effDir = 1.0;
var localMul = 1.0;

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  localMul = pow(2.0, (localSpeed - 0.5) * 4.0);

  var manDir = (direction * 2.0) - 1.0;
  if (manDir >= 0.0 && manDir < 0.06) manDir = 0.06;
  else if (manDir < 0.0 && manDir > -0.06) manDir = -0.06;

  autoClock = autoClock + dt;
  if (autoClock >= PHASE_WRAP) autoClock = autoClock - PHASE_WRAP;
  var autoSign = (sin(autoClock / AUTO_PERIOD * PI2) >= 0.0) ? 1.0 : -1.0;
  effDir = manDir * autoSign;

  washDrift = washDrift + dt * localMul * MAX_RATE * effDir;
  sparkleClock = sparkleClock + dt * localMul * SPARKLE_RATE;
  if (washDrift >= PHASE_WRAP) washDrift = washDrift - PHASE_WRAP;
  else if (washDrift <= -PHASE_WRAP) washDrift = washDrift + PHASE_WRAP;
  if (sparkleClock >= PHASE_WRAP) sparkleClock = sparkleClock - PHASE_WRAP;

  _hsv2rgb1();
  _hsv2rgb2();
}

export function render3D(index, x, y, z) {
  var nx = clamp01(x);
  var ny = clamp01(y);

  // Smooth left->right wash, three incommensurate fields + travel drift.
  var theta = (atan2(z, x) / PI2) + 0.5;
  theta = theta - floor(theta);
  var fA = wave(nx * 1.7 + ny * 0.061 - washDrift * 0.45);
  var fB = wave(theta * 2.3 + z * 0.037 + washDrift * 0.22);
  var fC = wave((nx - theta) * 1.9 + sectionId * 0.17 + washDrift * 0.31);
  var bgBlend = clamp01(fA * 0.42 + fB * 0.38 + fC * 0.20);
  var bgAlpha = wave(washDrift * 0.18 + sectionId * 0.2 + bgBlend * 0.35);

  // Per-pixel deterministic sparkle. The SPATIAL scramble (primes on a static
  // per-pixel seed) is decoupled from the CLOCK so localSpeed genuinely controls
  // the flicker RATE: previously the clock was multiplied through the *7.3 prime
  // (≈250×/turn) so the field fully re-rolled every frame at ANY speed and
  // localSpeed had no visible effect. Now the clock advances the sparkle phase at
  // a modest rate (×6) added inside ONE sine — a slow shimmer at speed 0, a brisk
  // strobe at speed 1 (frame-to-frame change scales with the localSpeed rate).
  var pseed = index * 73.137;
  var ph = sparkleClock * 6.0;
  var sp = sin(pseed + ph) * sin(pseed * 3.7) * sin(pseed * 7.3 + ph * 0.5);
  sp = sp * sp * sp * sp;
  var bloom = sin(pseed * 0.071 + ph * 0.2 + x * 0.37 + y * 0.19 + z * 0.11);
  bloom = bloom * bloom;
  // density sets how MANY sparkles fire (count); radius (micFlux) widens the
  // bloom REACH — a distinct spatial-expansion dimension — and also softly lowers
  // the fire threshold on a build so the sparkle field swells outward.
  var threshold = 0.96 - (0.1 + density * 0.8) * 0.62 - radius * 0.06;

  // Background brightness (level-scaled). Kick also lifts the wash a little so
  // the burst reads across the whole rig, not just the few firing pixels.
  var bgBri = bgAlpha * backgroundLevel * (1.0 + kick * 1.2);
  var fired = (sp > threshold) ? 1.0 : 0.0;
  var sparkRaw = (sp - threshold) / (1.0 - threshold + 0.0001);
  var sparkShaped = pow(clamp01(sparkRaw), 1.0 + (1.0 - sparkleSize) * 4.0);
  // radius widens the bloom reach; kick pops the burst brightness.
  var sparkV = fired * clamp01(sparkShaped * (0.55 + sparkleIntensity * 1.45)
               + bloom * sparkleSize * sparkleIntensity * (0.35 + radius * 1.1))
               * (1.0 + kick * 0.7);
  sparkV = clamp01(sparkV);

  // Single-expression brightness (avoid repeated `v=v*x` VM mis-compile).
  var bri = (BASE_FLOOR + clamp01(max(bgBri, sparkV)) * (1.0 - BASE_FLOOR)) * level;

  // Sparkle leans cp2; wash follows bgBlend. Strict cp1<->cp2 RGB lerp.
  var tColour = (fired > 0.5)
    ? clamp01(bgBlend * 0.28 + 0.68 + bloom * 0.18)
    : bgBlend;
  var r = (pr1 + (pr2 - pr1) * tColour) * bri;
  var g = (pg1 + (pg2 - pg1) * tColour) * bri;
  var b = (pb1 + (pb2 - pb1) * tColour) * bri;

  // WHITE — crisp glints on the spark, now controllable + kick-driven. whiteLevel
  // scales the base glint mix; whiteKick makes the spark go WHITE-HOT on the beat;
  // whiteWarmth tints the glint between cool UV (0) and warm amber (1). Additive
  // over the strict cp1/cp2 wash — only the firing sparks carry the white.
  var wl = clamp01(whiteLevel);
  var wk = clamp01(whiteKick);
  var warm = clamp01(whiteWarmth);
  var glint = sparkV * level * (0.35 + 1.3 * wl) * (1.0 + wk * 1.8);
  var w = glint * whiteGlint;
  // Warmth crossfades the glint's secondary emitter between amber and UV.
  var a = glint * amberGlint * warm;
  var u = glint * uvGlint * (1.0 - warm);

  // VINTAGE BLINDER: on the kick the upper heads punch white for the audience.
  if (sectionId == 2) {
    var keep = wl * 0.12;                          // calm warm-white keep
    var hit = wk * (0.7 + 0.5 * sparkV);          // hard blinder pop on kick
    w = clamp01(w + (keep + hit * 1.6) * level);
    a = clamp01(a + w * 0.16 * warm);
  }

  rgbwau(clamp01(r), clamp01(g), clamp01(b), clamp01(w), clamp01(a), clamp01(u));
}
