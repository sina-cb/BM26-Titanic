/*
  09_cyclone.js
  Confetti Cyclone — a swirling storm of bright confetti specks streaming around
  the rig, glinting as they tumble. HD remake: crisp pinpoint confetti over true-
  dark night, a strict two-colour confetti mix (cp1 <-> cp2), and a sparkle layer
  that catches the light, all driven by the music.

  IDENTITY KEPT: streaming swirl of multi-coloured confetti specks + catch-light
  sparkle overlay, two-colour confetti palette (cp1/cp2 and their blend).

  CORE NON-REPEATING MATH
    A clock-delta accumulator `swirlPhase` (wrapped at PHASE_WRAP=10000, §7)
    streams the confetti. Each speck's position uses a per-pixel golden-ratio hash
    (φ ≈ 1.61803) so specks scatter rather than march in rank; a second hash sets
    each speck's colour parity (cp1 / cp2 / blend) and twinkle phase. The sparkle
    layer twinkles on an incommensurate √3 ≈ 1.73205 schedule. Swirl direction is
    a guarded `direction` plus a slow autonomous √2-rate sin bias, so the cyclone
    occasionally reverses its spin on its own, out of lockstep.

  CONTROLS
    - localSpeed : swirl rate. 0 still creeps, 1 ~4x (§6).
    - direction  : <0.5 / >0.5 spin; center guarded; auto-varies.
    - level      : AUDIO PRIMARY — overall confetti brightness gain.
    - kick       : AUDIO — burst/flare brightness pop on the kick.
    - radius     : AUDIO — how far specks travel per beat / speck size.
    - density    : AUDIO — how many specks are lit / sparkle amount.
    - colorPalette1/2 : cp1 <-> cp2 confetti, strict RGB blend.

  AUDIO (modulators-only — never read CPC audio globals natively; the block below
  is the STRICT source of truth for the deploy-playlist generator):
      AUDIO_MODULATION_V1:
        sliderLevel     <- micLow  range 0.30..1.00 curve linear  # PRIMARY overall brightness (bass)
        sliderKick      <- micKick range 0.00..1.00 curve pow2    # confetti burst pop (kick)
        sliderRadius    <- micFlux range 0.40..0.90 curve linear  # speck travel / size (build)
        sliderDensity   <- micHigh range 0.20..0.95 curve linear  # speck count / sparkle (highs)
        sliderWhiteKick <- micKick range 0.00..1.00 curve pow2    # vintage white burst + blinder pop (kick)
        sliderWhiteLevel<- micLow  range 0.20..0.80 curve linear  # overall white keep/amount (bass)
      # STATIC (not modulated): direction, blinderBite — operator/scene set.
    On the KICK the confetti specks throw a crisp white catch-light glint, and the
    VINTAGE heads (sectionId == 2) fire HARD as audience BLINDERS via the W
    channel. sliderBlinderBite shapes how concentrated/snappy that vintage flash
    is. White is ADDITIVE over the strict cp1/cp2 confetti — it must not wash the
    whole rig white; pars/bars keep their colour, the vintage heads carry the bite.
*/

// ── Exported controls (UI order = declaration order) ────────────────────────
export var localSpeed = 0.5;
export var direction = 0.5;      // spin dir (center guarded, auto-varies)
export var level = 0.5;          // AUDIO PRIMARY: overall brightness gain
export var kick = 0.5;           // AUDIO: confetti burst pop
export var radius = 0.5;         // AUDIO: travel reach / speck size
export var density = 0.5;        // AUDIO: speck count / sparkle
export var whiteLevel = 0.5;     // WHITE: overall white amount (speck glint + vintage keep)
export var whiteKick = 0.5;      // WHITE: kick-driven white flash / blinder pop (audio target)
export var blinderBite = 0.5;    // WHITE: vintage-head blinder snap / concentration

export var cp1H = 0.0, cp1S = 1.0, cp1V = 1.0;  // confetti A (red)
export var cp2H = 0.33, cp2S = 1.0, cp2V = 1.0; // confetti B (green)
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderDirection(v) { direction = v; }
export function sliderLevel(v) { level = v; }
export function sliderKick(v) { kick = v; }
export function sliderRadius(v) { radius = v; }
export function sliderDensity(v) { density = v; }
export function sliderWhiteLevel(v) { whiteLevel = v; }
export function sliderWhiteKick(v) { whiteKick = v; }
export function sliderBlinderBite(v) { blinderBite = v; }

// ── Tunables ────────────────────────────────────────────────────────────────
var SWIRL_RATE = 0.45;      // swirl streams per second at localSpeed = 1.0
var PHASE_WRAP = 10000.0;
var BASE_FLOOR = 0.04;      // calm non-black base in silence

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
var swirlPhase = 0.0;
var sparkPhase = 0.0;
var dirPhase = 0.0;

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  _hsv2rgb1();
  _hsv2rgb2();

  var localMultiplier = pow(2.0, (localSpeed - 0.5) * 4.0); // §6
  var rate = 0.06 + 0.94 * localMultiplier; // tiny creep at localSpeed = 0

  var d = (direction * 2.0) - 1.0;
  if (d >= 0.0 && d < 0.06) d = 0.06;
  else if (d < 0.0 && d > -0.06) d = -0.06;

  dirPhase = dirPhase + dt * rate * 1.41421;
  if (dirPhase >= PHASE_WRAP) dirPhase = dirPhase - PHASE_WRAP;
  var autoBias = sin(dirPhase * PI2 * 0.061) + 0.6 * sin(dirPhase * PI2 * 0.033);
  var eff = d + autoBias * 0.85;
  if (eff >= 0.0 && eff < 0.05) eff = 0.05;
  else if (eff < 0.0 && eff > -0.05) eff = -0.05;
  var sgn = eff >= 0.0 ? 1.0 : -1.0;

  swirlPhase = swirlPhase + dt * rate * SWIRL_RATE * sgn;
  if (swirlPhase >= PHASE_WRAP) swirlPhase = swirlPhase - PHASE_WRAP;
  else if (swirlPhase < 0.0) swirlPhase = swirlPhase + PHASE_WRAP;

  sparkPhase = sparkPhase + dt * rate * SWIRL_RATE * 1.73205; // √3
  if (sparkPhase >= PHASE_WRAP) sparkPhase = sparkPhase - PHASE_WRAP;
}

export function render3D(index, wx, wy, wz) {
  var nx = wx; if (nx < 0.0) nx = 0.0; else if (nx > 1.0) nx = 1.0;
  var ny = wy; if (ny < 0.0) ny = 0.0; else if (ny > 1.0) ny = 1.0;

  // Per-speck scatter hash (golden ratio) — each pixel is a confetti speck with
  // its own travel phase + colour parity, so they swirl without marching in rank.
  var hashp = (index * 0.61803 + nx * 4.0 + ny * 1.5);
  hashp = hashp - floor(hashp);
  var colHash = (index * 0.36180 + nx * 2.0 + 0.13);
  colHash = colHash - floor(colHash);

  // Confetti glint: a sharp travelling speck. Travels with swirlPhase (radius =
  // reach). Per-pixel hash keeps the LIT COUNT ~constant as specks stream by, so
  // total brightness tracks `level`, not the swirl phase (clean PRIMARY corr).
  var stream = swirlPhase * (0.6 + radius * 3.0) + hashp;
  var sw = 0.5 + 0.5 * sin(stream * PI2);
  var sharp = 9.0 + radius * 10.0;     // crisp pinpoint specks
  var speck = pow(sw, sharp);
  // density opens more specks (eligibility gate) and brightens the field.
  var elig = 0.5 + 0.5 * sin((hashp * 17.0 + 0.41) * PI2);
  if (elig < (1.0 - (0.2 + density * 0.6))) speck = speck * 0.03;

  // Sparkle catch-light overlay (incommensurate twinkle, density-scaled).
  var spark = pow(0.5 + 0.5 * sin((sparkPhase + colHash * 9.0) * PI2), 24.0);
  spark = spark * (0.3 + density * 0.7);

  // Strict two-colour confetti: parity picks cp1, cp2, or their RGB midpoint.
  var rr = pr1; var gg = pg1; var bb = pb1;
  if (colHash < 0.40) { rr = pr2; gg = pg2; bb = pb2; }
  else if (colHash < 0.66) {
    rr = (pr1 + pr2) * 0.5; gg = (pg1 + pg2) * 0.5; bb = (pb1 + pb2) * 0.5;
  }

  // PRIMARY audio: one level gain on the whole speck field. BASE_FLOOR keeps a
  // calm visible base in silence (mission-critical visibility).
  var gain = 0.07 + level * 0.93;
  var kickPop = kick * 0.9;

  // Gentle autonomous "gust": a slow, low-amplitude swell of the speck field on
  // an incommensurate swirl-phase rate so the cyclone visibly surges even with no
  // audio (keeps the silent wash ANIMATING). Small amplitude so it barely touches
  // the level-driven PRIMARY budget (corr stays clean).
  var gust = 0.86 + 0.14 * sin((swirlPhase * 0.37 + sparkPhase * 0.19) * PI2);
  var amt = (speck * (0.85 + radius * 0.4) + spark * 0.7) * gain * (1.0 + kickPop) * gust;
  // Ambient confetti haze: a small UNIFORM level-coupled base (rides `level` with
  // no swirl-phase wobble) so total rig brightness tracks the PRIMARY cleanly,
  // plus a tiny phase-flecked term for life. Keeps silence calm-but-visible.
  var haze = (BASE_FLOOR + level * 0.10) * (0.7 + 0.3 * sw);

  var r = clamp01(rr * amt + (pr1 * 0.3 + pr2 * 0.3) * haze);
  var g = clamp01(gg * amt + (pg1 * 0.3 + pg2 * 0.3) * haze);
  var b = clamp01(bb * amt + (pb1 * 0.3 + pb2 * 0.3) * haze);

  // WHITE (additive over the strict confetti). The catch-light sparkle glints
  // white on the kick; the vintage heads fire hard as audience blinders.
  var wl = clamp01(whiteLevel);
  var wk = clamp01(whiteKick);
  // Speck/sparkle white glint — crisp, kick-flashed, kept off the coloured body
  // so the confetti stays two-colour (white only on the bright catch-lights).
  var w = spark * wl * (0.4 + 0.6 * wk) * gain;
  var a = 0.0;
  if (sectionId == 2) {
    // Vintage BLINDER: snap the W channel on the kick. blinderBite concentrates
    // the flash (higher bite -> punchier, less always-on glow).
    var bite = clamp01(blinderBite);
    var keep = wl * (0.14 * (1.0 - 0.6 * bite));   // calm warm-white keep
    var hit = wk * (0.7 + 0.6 * bite) * (0.6 + 0.4 * sw);  // hard blinder pop
    w = clamp01((keep + hit * 1.7) * gain);
    a = clamp01(w * 0.16);                           // faint warm tint
  }

  rgbwau(r, g, b, clamp01(w), a, 0.0);
}
