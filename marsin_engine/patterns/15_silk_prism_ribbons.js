/*
  15_silk_prism_ribbons.js
  HD Silk Prism Ribbons — smooth satin ribbons of light sliding through the rig,
  their colour blending softly between cp1 and cp2 (now blended in RGB space, so
  the silk never traverses off-palette hues). cp1 = Ribbon A, cp2 = Ribbon B.

  Identity kept: multiple soft ribbons sliding with a slow cross-shadow and a
  travelling colour blend. Now HD, audio-reactive, with ribbons that slide one
  way then occasionally reverse, a level/kick/radius audio surface, RGB-space
  blending, and NO coord re-normalization (coords are already 0..1).

  CORE NON-REPEATING MATH (skill 12 §3/§7):
    Two ribbon phases advance in the golden ratio φ (1.61803); the cross-shadow
    drifts at √2 and the colour blend at √3 — all incommensurate, so the silk
    never re-locks. Phases accumulate against a large PHASE_WRAP to avoid the
    wrapped-then-scaled seam.

  SPEED / DIRECTION:
    localSpeed scales every phase via rate = pow(2,(localSpeed-0.5)*4) (creeps at
    0, ~4x at 1). `direction` (guarded off center) sets the ribbons' slide; an
    autonomous incommensurate clock (~79s) occasionally reverses the slide on its
    own so the silk drifts back and forth organically.

  AUDIO (modulators-only — never read CPC audio globals natively):
  AUDIO_MODULATION_V1:
    sliderLevel   <- micLow  range 0.30..1.00 curve linear  # PRIMARY overall brightness (bass)
    sliderKick    <- micKick range 0.00..1.00 curve pow2    # ribbon-crest brightness pop
    sliderRadius  <- micFlux range 0.40..0.90 curve linear  # ribbon width / spread (movement)
    sliderShimmer <- micHigh range 0.20..0.90 curve linear  # satin sheen / fine detail (highs)
  # static (unmapped): direction, ribbonCount, softness, palette pickers
*/

// ── Exported controls (UI order = declaration order) ─────────────────────────
export var localSpeed = 0.5;   // master motion rate
export var direction = 0.5;    // ribbon slide direction (0.5 = guarded center)
export var level = 1.0;        // AUDIO: overall brightness (PRIMARY)
export var kick = 0.0;         // AUDIO: ribbon-crest brightness pop
export var radius = 0.5;       // AUDIO: ribbon width / spread
export var shimmer = 0.5;      // AUDIO: satin sheen / fine detail
export var ribbonCount = 0.5;  // number of ribbons across the rig
export var softness = 0.4;     // ribbon edge softness

export var cp1H = 0.52, cp1S = 1.0, cp1V = 1.0; // Ribbon A (cyan default)
export var cp2H = 0.86, cp2S = 1.0, cp2V = 1.0; // Ribbon B (magenta default)
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderDirection(v) { direction = v; }
export function sliderLevel(v) { level = v; }
export function sliderKick(v) { kick = v; }
export function sliderRadius(v) { radius = v; }
export function sliderShimmer(v) { shimmer = v; }
export function sliderRibbonCount(v) { ribbonCount = v; }
export function sliderSoftness(v) { softness = v; }

// ── Tunables ─────────────────────────────────────────────────────────────────
var MAX_RATE = 0.45;         // base ribbon slide turns/sec at localSpeed = 1.0
var PHASE_WRAP = 10000.0;
var AUTO_PERIOD = 79.0;
var BASE_FLOOR = 0.05;       // small non-black floor (silk never fully dark)

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
var phaseA = 0.0;     // ribbon A slide (direction-aware)
var phaseB = 0.0;     // ribbon B slide (direction-aware, φ ratio)
var shadowPhase = 0.0;
var colourPhase = 0.0;
var autoClock = 0.0;
var effDir = 1.0;
var localMul = 1.0;
var silkBreath = 1.0;   // gentle autonomous satin swell (rest motion, not level)

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

  phaseA = phaseA + dt * localMul * MAX_RATE * effDir;
  phaseB = phaseB + dt * localMul * MAX_RATE * 1.61803 * effDir;
  shadowPhase = shadowPhase + dt * localMul * MAX_RATE * 1.41421;
  colourPhase = colourPhase + dt * localMul * MAX_RATE * 1.73205 * 0.25;
  if (phaseA >= PHASE_WRAP) phaseA = phaseA - PHASE_WRAP;
  else if (phaseA <= -PHASE_WRAP) phaseA = phaseA + PHASE_WRAP;
  if (phaseB >= PHASE_WRAP) phaseB = phaseB - PHASE_WRAP;
  else if (phaseB <= -PHASE_WRAP) phaseB = phaseB + PHASE_WRAP;
  if (shadowPhase >= PHASE_WRAP) shadowPhase = shadowPhase - PHASE_WRAP;
  if (colourPhase >= PHASE_WRAP) colourPhase = colourPhase - PHASE_WRAP;

  // Gentle autonomous satin swell: the silk brightens and dims as a whole on a
  // slow incommensurate clock so the rig is never static in silence. REST motion
  // (independent of level); level still dominates the brightness budget.
  silkBreath = 0.84 + 0.16 * wave(shadowPhase * 0.7 + autoClock * 0.009);

  _hsv2rgb1();
  _hsv2rgb2();
}

export function render3D(index, x, y, z) {
  // Coords are already 0..1 — use directly (clamp only). NEVER re-normalize.
  var nx = clamp01(x);
  var ny = clamp01(y);

  var count = 1.0 + ribbonCount * 9.0;
  var width = 0.7 + radius * 1.4;     // AUDIO: ribbon width / spread
  var soft = 1.0 + softness * 5.0;

  // Two sliding ribbon fields (φ-ratio) + a slow cross-shadow.
  var ribA = wave((nx * count * width) + (ny * 1.7) - phaseA * 0.18);
  var ribB = wave((nx * count * width * 0.5) - (ny * 1.1) + phaseB * 0.18);
  var ribbon = ribA * 0.6 + ribB * 0.4;
  var shadow = wave((ny * count * 0.45) - (nx * 0.9) + shadowPhase * 0.18);

  // Satin sheen: shimmer (micHigh) adds a fine high-frequency sparkle on the
  // ribbon body — the fine-detail dimension, a measurable sheen lift on highs.
  var sheen = wave(nx * 9.0 + ny * 5.0 + shadowPhase * 0.4) * shimmer * 0.30;

  // Single-expression brightness (avoid repeated `v=v*x` VM mis-compile). Ribbon
  // cores get a crisp highlight so they reach a true 255 channel (high-def),
  // with an extra kick-driven pop on top. Kick lifts BOTH the ribbon crests and a
  // small whole-body amount, so the beat reads across the rig (distinct pop dim).
  var body = pow((ribbon * 0.8) + (shadow * 0.2), soft) + sheen;
  var crest = (ribbon > 0.74) ? (ribbon - 0.74) * 5.0 : 0.0;
  var lit = clamp01(body * (1.0 + kick * 0.35) + crest * (0.7 + kick * 1.1));
  // PRIMARY: level^2 gain (matching 16/17) makes micLow the DOMINANT total-
  // brightness driver (corr>=0.5); the silkBreath rest-swell is kept gentle so it
  // does not swamp the bass correlation, and still keeps the rig alive in silence.
  var levelGain = 0.18 + level * level * 1.9;
  var bri = (BASE_FLOOR + lit * (1.0 - BASE_FLOOR)) * levelGain * silkBreath;

  // Travelling colour blend across the rig — strict cp1<->cp2 RGB lerp.
  var colourBlend = clamp01(wave(nx * 0.7 + ny * 0.35 + colourPhase * 0.18));
  var r = (pr1 + (pr2 - pr1) * colourBlend) * bri;
  var g = (pg1 + (pg2 - pg1) * colourBlend) * bri;
  var b = (pb1 + (pb2 - pb1) * colourBlend) * bri;

  rgb(clamp01(r), clamp01(g), clamp01(b));
}
