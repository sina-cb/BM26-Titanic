/*
  16_ghost_tide_uv.js
  Slow tidal sweep with a ghostly foam crest and a UV undertow. A bright foam
  line sweeps across the rig over a deep cp1<->cp2 mist; the foam drives the W
  (white) channel hard and a UV glow swells beneath — the W/UV are the whole
  point of "ghost_tide_UV". Bioluminescent, vintage-blinder-friendly.

  IDENTITY (preserved): tidal foam sweep + UV undertow + explicit white/UV, mist
  colour blend cp1<->cp2. Upgrades: 0..1 coords used directly (no re-normalize),
  identity-slider convention, audio reactivity (foam crest pops on the kick,
  whole tide brightens with the bass), guarded direction with smooth autonomous
  reversal so the tide occasionally turns.

  NON-REPEATING MATH
    The sweep and undertow are two delta-accumulated phases at an irrational ratio
    (tide rate 0.025 : undertow 0.0145 ≈ 1 : 0.58). Phases accumulate continuously
    and wrap at PHASE_WRAP turns, far from any in-frame use — no seam (skill 12 §7).
    Autonomous direction: a smooth rate sway (0.4 + 0.6*cos(slowClock))*dirSign
    eases the tide through reversals on a slow incommensurate clock — never a hard
    sign flip — so the tide is not one-way and the turn is gradual.

  AUDIO (modulators-only — never read CPC audio globals natively):
  AUDIO_MODULATION_V1:
    sliderLevel   <- micLow  range 0.30..1.00 curve linear  # PRIMARY overall brightness (bass)
    sliderKick    <- micKick range 0.00..1.00 curve pow2    # foam / white crest pop
    sliderRadius  <- micFlux range 0.40..0.90 curve linear  # foam crest width / how far it surges
    sliderUvLevel <- micHigh range 0.20..0.90 curve linear  # UV undertow glow (highs / sparkle band)
  # static (unmapped): direction, tideWidth, whiteLevel, palette pickers
*/

// ── Exported controls (UI order = declaration order) ─────────────────────────
export var localSpeed = 0.5;   // tide rate (0 still creeps, 1 ~4x faster)
export var direction = 0.5;    // 0.5 balanced; <0.5 reverse, >0.5 forward (guarded)
export var level = 1.0;        // PRIMARY audio: overall brightness (micLow)
export var kick = 0.0;         // audio: kick -> foam/white crest pop (micKick)
export var radius = 0.5;       // audio: foam crest width / surge (micFlux)
export var tideWidth = 0.5;    // base foam width (0..1; scaled in render)
export var whiteLevel = 0.6;   // foam white-channel level
export var uvLevel = 0.6;      // UV undertow glow (audio: micHigh)

export var cp1H = 0.70, cp1S = 1.0, cp1V = 1.0; // mist colour (blue/indigo)
export var cp2H = 0.45, cp2S = 1.0, cp2V = 1.0; // undertow colour (cyan/green)
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderDirection(v) {
  var d = (v * 2.0) - 1.0;
  if (d >= 0.0 && d < 0.06) d = 0.06; else if (d < 0.0 && d > -0.06) d = -0.06;
  direction = d;
}
export function sliderLevel(v) { level = v; }
export function sliderKick(v) { kick = v; }
export function sliderRadius(v) { radius = v; }
export function sliderTideWidth(v) { tideWidth = v; }
export function sliderWhiteLevel(v) { whiteLevel = v; }
export function sliderUvLevel(v) { uvLevel = v; }

var tide = 0.0;          // sweep phase (turns, accumulated)
var undertow = 0.0;      // undertow phase
var autoClock = 0.0;     // slow clock for autonomous reversal
var dirSign = 1.0;
var liveWidth = 0.42;    // resolved foam width this frame
var PHASE_WRAP = 10000.0;

// ── Palette RGB cache ─────────────────────────────────────────────────
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
  else             { pr1 = cp1V; pg1 = pv;   pb1 = qv;   }
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
  else             { pr2 = cp2V; pg2 = pv;   pb2 = qv;   }
}

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;
  var localMultiplier = pow(2.0, (localSpeed - 0.5) * 4.0);

  dirSign = direction;
  if (dirSign >= 0.0 && dirSign < 0.06) dirSign = 0.06;
  else if (dirSign < 0.0 && dirSign > -0.06) dirSign = -0.06;

  // Autonomous reversal: smooth rate sway easing through zero (no hard flip).
  autoClock = autoClock + dt * 0.049 * localMultiplier;
  if (autoClock >= PHASE_WRAP) autoClock = autoClock - PHASE_WRAP;
  // A baseline sweep magnitude (sign from direction) keeps the tide visibly
  // sweeping even at the guarded-center default; direction still steers the bias
  // and the autonomous clock still eases it through reversals.
  var dirBias = dirSign;
  var dirMag = (dirBias < 0.0) ? -1.0 : 1.0;
  var sweepRate = dirBias + dirMag * 0.7;   // never near-zero at center
  var rate = (0.4 + 0.6 * cos(autoClock)) * sweepRate * localMultiplier;

  // Two phases at an irrational ratio (1 : 0.58) so the look never re-locks.
  tide = tide + dt * 0.50 * rate;          if (tide >= PHASE_WRAP) tide -= PHASE_WRAP; else if (tide <= -PHASE_WRAP) tide += PHASE_WRAP;
  undertow = undertow + dt * 0.29 * rate;  if (undertow >= PHASE_WRAP) undertow -= PHASE_WRAP; else if (undertow <= -PHASE_WRAP) undertow += PHASE_WRAP;

  // Foam width: base + audio surge (micFlux). Kept in a sane range.
  liveWidth = 0.15 + tideWidth * 0.45 + radius * 0.30;
  _hsv2rgb1();
  _hsv2rgb2();
}

export function render3D(index, x, y, z) {
  // Coords are already 0..1 — use directly (clamped). No re-normalize (the old
  // (x+1.264)/3.125 form was the regression that rendered this dim/black).
  var nx = max(0.0, min(1.0, x));
  var ny = max(0.0, min(1.0, y));

  // The sweeping foam line. tide is in turns; wave() keeps it periodic & smooth.
  var sweep = wave(nx * 0.42 + ny * 0.30 + tide);
  var edge = abs(sweep - 0.5) * 2.0;
  var foam = max(0.0, 1.0 - edge / liveWidth);
  foam = pow(foam, 2.4);

  // Slow undertow roll under the foam — sets the mist colour & UV swell.
  var lowRoll = wave((ny * 2.2) - (nx * 0.8) + undertow);
  var mist = pow(lowRoll, 2.0) * (0.22 + foam * 0.50);

  // Kick pops the foam crest (white + mist), only where there is foam.
  var crest = foam * (1.0 + kick * 1.4);

  // Contrast the mist blend so both palette ends read at once (troughs sit at
  // cp1, crests reach cp2) instead of hovering around a single mid hue.
  var tColour = max(0.0, min(1.0, (lowRoll - 0.5) * 1.5 + 0.5));
  var rBase = (pr1 + (pr2 - pr1) * tColour) * (mist + crest * 0.25);
  var gBase = (pg1 + (pg2 - pg1) * tColour) * (mist + crest * 0.25);
  var bBase = (pb1 + (pb2 - pb1) * tColour) * (mist + crest * 0.25);

  var white = crest * whiteLevel;
  var uv = ((1.0 - ny) * lowRoll * 0.45 + foam * 0.55) * uvLevel;

  // PRIMARY: overall brightness from micLow. level^2 makes the bass the dominant
  // brightness driver across every channel (corr>=0.5); a small clock-driven
  // base floor keeps silence calm-but-visible, while troughs read near-black.
  var levelGain = 0.16 + level * level * 2.0;
  var floorBase = 0.015;
  var r = min(1.0, (rBase + floorBase) * levelGain);
  var g = min(1.0, (gBase + floorBase) * levelGain);
  var b = min(1.0, (bBase + floorBase) * levelGain);
  white = min(1.0, white * levelGain);
  uv = min(1.0, uv * levelGain);

  rgbwau(r, g, b, white, 0.0, uv);
}
