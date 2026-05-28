/*
  113_tower_column_breath
  Slow architectural breath on the tower bars only — each tower's 18-pixel
  column inhales from the base to the canopy and exhales back, with a soft
  raised-cosine wave front sliding up and down the column. The 8 towers
  carry the same breath at staggered per-tower phase offsets so the ring
  ripples in/out around the audience.

  Concept (operator brief 2026-05-28: new tower-only pattern):
  vertical wave-front sweep + cool/warm palette gradient up the column +
  azimuthal phase ripple. Reads as a steady, meditative gesture — paired
  with the snappy 114_tower_ring_chase to give the operator a slow/fast
  duo of tower-only patterns. Steamboat-white pops on the wave-front crest
  for a glint on each inhale (sparing, motion-gated per pattern-00).

  Tower fixture map (summer_camp_logsville.js):
    TowerBars         0..143  (8 towers x 18 pixels each)
    TowerVintageLights 144..167 (4 towers x 6 heads)
    WallVintageLights  168..203 (6 walls x 6 heads)
    Redwoods          204..221 (DO NOT TOUCH from tower patterns)

  Audio sliders (default 0; pattern complete without audio per P0):
    audioBass — lifts breath amplitude and steamboat-white intensity
    audioMid  — accelerates the breath rate (capped at BREATH_HZ_MAX)

  View masks consumed:
    RedwoodPARs (0x40) — explicit zero output (per project tower-only rules)
    VintageOnly (0x80) — slow warm breath on tower-vintage + wall-vintage
*/

// Named view-mask bits (mirrors summer_camp_logsville.viewmasks.js).
var MASK_REDWOOD_PARS = 64;
var MASK_VINTAGE_ONLY = 128;

// Tower-bar pixel range (8 towers x 18 pixels). Vintage groups handled by
// the VintageOnly branch separately.
var TOWER_BAR_HI = 143;
var REDWOODS_LO  = 204;

// Strobe / motion cap on the breath rate (Hz). At max audio drive the
// wave-front still translates slower than the eye's flicker fusion.
var BREATH_HZ_MAX = 0.6;

// Golden-ratio per-tower phase offset — 8 towers stepped by 0.618 mod 1
// produces an aperiodic-looking azimuthal ripple even though the towers
// are evenly spaced.
var TOWER_OFFSET = 0.6180339;

export var localSpeed = 0.5;
export var breathRate = 0.45;     // 0..1 -> 0.05..BREATH_HZ_MAX Hz
export var bandWidth = 0.32;      // wave-front half-width in column units
export var brightness = 1.0;      // peak intensity of the wave front
export var baselineFloor = 0.12;  // off-front floor brightness on towers
export var vintageGlow = 0.45;    // warm vintage breath amplitude
export var steamboatWhite = 0.55; // steamboat-white pop on the inhale crest

// Audio sliders (default 0 — P0).
export var audioBass = 0.0;
export var audioMid  = 0.0;

// cp1 = cool base (deep blue), cp2 = warm canopy (gold). Bright defaults.
export var cp1H = 0.62, cp1S = 1.0, cp1V = 0.9;
export var cp2H = 0.12, cp2S = 1.0, cp2V = 1.0;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderBreathRate(v) { breathRate = v; }
export function sliderBandWidth(v) { bandWidth = v; }
export function sliderBrightness(v) { brightness = v; }
export function sliderBaselineFloor(v) { baselineFloor = v; }
export function sliderVintageGlow(v) { vintageGlow = v; }
export function sliderSteamboatWhite(v) { steamboatWhite = v; }
export function sliderAudioBass(v) { audioBass = v; }
export function sliderAudioMid(v) { audioMid = v; }

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

var tPhase = 0.0;
var breathPhase = 0.0; // 0..1; wave(breathPhase) drives the front position

export function beforeRender(delta) {
  var localMult = pow(2.0, (localSpeed - 0.5) * 5.4);
  var dt = delta / 1000.0;
  tPhase = (tPhase + (delta / 1310.72) * localMult) % 1.0;
  if (tPhase < 0.0) tPhase += 1.0;
  _hsv2rgb1();
  _hsv2rgb2();

  // Breath rate: audio mid lifts it but BREATH_HZ_MAX still bounds it.
  var midLift = clamp01(audioMid) * 0.4;
  var hz = 0.05 + (clamp01(breathRate) + midLift) * (BREATH_HZ_MAX - 0.05);
  if (hz > BREATH_HZ_MAX) hz = BREATH_HZ_MAX;
  breathPhase = (breathPhase + dt * hz) % 1.0;
  if (breathPhase < 0.0) breathPhase += 1.0;
}

// Engine convention: x, y, z are normalized pixel coords in [0,1].
export function render3D(index, x, y, z) {
  var isRedwood = (viewMask & MASK_REDWOOD_PARS) != 0;
  var isVintage = (viewMask & MASK_VINTAGE_ONLY) != 0;
  var r = 0.0, g = 0.0, b = 0.0, w = 0.0, a = 0.0, u = 0.0;

  // Tower-only rule: redwoods get zero output.
  if (isRedwood) {
    rgbwau(0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
    return;
  }

  var bassBoost = 1.0 + clamp01(audioBass) * 0.4;

  if (index <= TOWER_BAR_HI) {
    // TowerBar: vertical column = 18 pixels. barT in [0,1] from base to top.
    var towerIdx = floor(index / 18);
    var barT = (index % 18) / 17.0;
    var phaseOff = (towerIdx * TOWER_OFFSET) % 1.0;

    // wave(breathPhase + phaseOff) returns 0..1. Map to column position
    // 0..1 — front rides up then back down each breath cycle.
    var front = wave(breathPhase + phaseOff);

    // Soft raised-cosine slice around the front position.
    var d = barT - front;
    if (d < 0.0) d = -d;
    var slice = 0.0;
    if (d < bandWidth) {
      slice = 0.5 + 0.5 * cos(d / bandWidth * PI);
    }

    // Palette gradient: cool root -> warm canopy along barT (Rule G).
    var mix = barT;
    var rc = pr1 + (pr2 - pr1) * mix;
    var gc = pg1 + (pg2 - pg1) * mix;
    var bc = pb1 + (pb2 - pb1) * mix;

    // Inhale crest detection: front near top AND slice near 1.0 means the
    // breath is at its apex — gate steamboat-white to that moment.
    var crest = pow(slice, 3.0) * pow(front, 2.0);

    var lit = baselineFloor + (brightness - baselineFloor) * slice;
    lit = lit * bassBoost;
    if (lit > 1.0) lit = 1.0;
    r = rc * lit;
    g = gc * lit;
    b = bc * lit;
    // Steamboat-white per pattern-00 idiom — sparing, motion-gated.
    w = crest * steamboatWhite * bassBoost;
    if (w > 1.0) w = 1.0;
  } else if (isVintage) {
    // Vintage cluster (tower-vintage + wall-vintage): slow warm breath
    // synced to the same breathPhase but as a soft amber wash, no
    // wave-front. Gives the rig a quiet "lantern breathing" backdrop
    // beneath the tower column wave.
    var bell = 0.5 + 0.5 * wave(breathPhase + x * 0.3 + z * 0.2);
    var warm = vintageGlow * bell * bassBoost;
    if (warm > 1.0) warm = 1.0;
    // Bias toward cp2 (warm) for the vintage breath.
    var vmix = 0.75;
    r = (pr1 + (pr2 - pr1) * vmix) * warm * 0.6;
    g = (pg1 + (pg2 - pg1) * vmix) * warm * 0.6;
    b = (pb1 + (pb2 - pb1) * vmix) * warm * 0.6;
    a = warm * 0.9;
  }
  // Anything else (e.g. unflagged tower vintage if masks change) stays
  // at zero output rather than silently falling back — Rule P0.

  rgbwau(clamp01(r), clamp01(g), clamp01(b), clamp01(w), clamp01(a), clamp01(u));
}
