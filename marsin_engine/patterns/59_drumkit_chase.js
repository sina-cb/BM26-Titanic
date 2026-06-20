/*
  59_drumkit_chase.js — PER-BAND SPATIAL CHASE that follows the drum kit.

  Round-2 audio identity: the three per-band ONSET pulses each own one hull zone,
  so the rig reads like a drum kit laid out across the Titanic:

    micOnsetLow  -> BARS    (sId 3, the wide X spine)  : a KICK onset slams a
                    bright twin-front that bursts outward from the rig CENTER
                    (x=0.5) and decays — the low-drum body, the dominant mass.
    micOnsetMid  -> VINTAGE (sId 2, the Y columns)     : a SNARE/clap onset
                    flashes the columns bottom->top and decays — the mid kit.
    micOnsetHigh -> PARS    (sId 1, the crisp glints)  : a HAT onset sprinkles
                    crisp glints across the four pars and decays — the cymbals.

  Each band drives its OWN persistent decay envelope (armed on a rising onset
  edge), so a busy groove makes the three zones strobe in counterpoint — the
  drum-kit-following chase. Between hits each zone falls to true black (negative
  space, high contrast); a tiny always-on time base keeps the rig readable on
  silence (mission-critical visibility), never fully dark.

  COLOUR: strict cp1<->cp2 RGB blend (PATTERNS.md §7). Low/bars lean cp1 (hot),
  high/pars lean cp2 (cool), mid blends by height — the kit reads as a palette
  line across the hull.

  COORDINATE-DRIVEN (x,y + sectionId) so it ports test_bench 52 -> titanic 970
  unchanged: the bars burst is radial in X, the columns fill in Y, the glints are
  index/seed based.

  CONTROLS (UI order = declaration order)
    - localSpeed : base shimmer + glint cadence (0 = freeze the idle base).
    - lowHit     : LOW-band onset trigger  (audio micOnsetLow)  -> bars burst.
    - midHit     : MID-band onset trigger  (audio micOnsetMid)  -> column flash.
    - highHit    : HIGH-band onset trigger (audio micOnsetHigh) -> par glints.
    - decay      : how fast each zone's envelope falls (slow = long after-glow).
    - floor      : minimum time-based base brightness (0..~0.14).
    - colorPalette1/2 : cp1 hot (kick), cp2 cool (hats).

  AUDIO (modulators-only — NEVER read CPC audio globals natively):
  AUDIO_MODULATION_V1:
    sliderLowHit  <- micOnsetLow  range 0.00..1.00 curve linear  # HEADLINE: kick onset bursts the bars (rising edge arms the envelope)
    sliderMidHit  <- micOnsetMid  range 0.00..1.00 curve linear  # snare/clap onset flashes the vintage columns
    sliderHighHit <- micOnsetHigh range 0.00..1.00 curve linear  # hat onset sprinkles the par glints
  STATIC (operator handles, not audio-mapped): localSpeed, decay, floor, colorPalette1/2.
  PER-BAND PULSE pattern: validate on --synth hats (micOnsetHigh/Mid fire) and
  kick_4floor (micOnsetLow fires). Onsets are PULSES, so the reactivity reads as a
  positive corr of EACH band's onset with its zone lighting up (frame brightness
  tracks the union of the three envelopes).
*/

// ── Exported controls (UI order = declaration order) ─────────────────────────
export var localSpeed = 0.5;   // base shimmer + glint cadence
export var lowHit = 0.0;       // LOW onset trigger  -> bars burst  (audio micOnsetLow)
export var midHit = 0.0;       // MID onset trigger  -> columns     (audio micOnsetMid)
export var highHit = 0.0;      // HIGH onset trigger -> par glints   (audio micOnsetHigh)
export var decay = 0.5;        // envelope fall rate (slow = long after-glow)
export var floor_ = 0.58;      // minimum time-based base brightness (0..~0.7); 0.58
                               //   keeps the rig CLEARLY visible at silence (mission-
                               //   critical: night-visibility) — silence peak lands
                               //   ~70/255 like the 62/67 reference patterns — while
                               //   the per-band onset hits still slam to 255 (max-
                               //   composite), so true-black negative space returns
                               //   the instant a zone is between hits under audio.

export var cp1H = 0.03, cp1S = 0.85, cp1V = 1.0; // palette 1 — hot red-amber (kick)
export var cp2H = 0.55, cp2S = 1.0,  cp2V = 1.0; // palette 2 — cool cyan      (hats)
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderLowHit(v) { lowHit = v; }
export function sliderMidHit(v) { midHit = v; }
export function sliderHighHit(v) { highHit = v; }
export function sliderDecay(v) { decay = v; }
export function sliderFloor(v) { floor_ = 0.18 + v * 0.52; } // 0.18..0.70; never near-dark

// ── Tunables ─────────────────────────────────────────────────────────────────
var ARM_THRESH = 0.30;   // onset level that arms a fresh zone burst (rising edge)
var REARM      = 0.16;   // hysteresis: onset must fall below this to re-arm
var DECAY_MIN  = 1.4;    // envelope fall/sec at decay=0 (long after-glow)
var DECAY_MAX  = 5.2;    // envelope fall/sec at decay=1 (snappy)
var VINT_BOT   = 0.0;    // vintage bottom in normalized Y
var VINT_TOP   = 0.2727; // vintage top in normalized Y (from model)
var BARS_W     = 0.10;   // half-width of the bright bars FRONT band
var EDGE       = 0.05;   // soft edge width

// ── Palette RGB cache (strict cp1<->cp2 blending; PATTERNS.md §7) ─────────────
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

function clamp01(v) { if (v < 0.0) return 0.0; if (v > 1.0) return 1.0; return v; }
function softEdge(inside) { if (inside <= 0.0) return 0.0; if (inside >= EDGE) return 1.0;
  var u = inside / EDGE; return u * u * (3.0 - 2.0 * u); }

// ── Persistent per-band envelopes + edge arms ────────────────────────────────
var envLow = 0.0, envMid = 0.0, envHigh = 0.0;
var armLow = 1, armMid = 1, armHigh = 1;
var tBase = 0.0, tGlint = 0.0;
var fallRate = 3.0;

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  _hsv2rgb1();
  _hsv2rgb2();

  // localSpeed warps the idle shimmer/glint cadence (pow2 law ~0.25x..4x) so the
  // base is never frozen and the slider visibly changes its speed.
  var rate = pow(2.0, (localSpeed - 0.5) * 4.0);
  tBase = time(0.05 / rate);
  tGlint = time(0.012 / rate);

  fallRate = DECAY_MIN + clamp01(decay) * (DECAY_MAX - DECAY_MIN);

  // ── Per-band rising-edge arm -> envelope = 1.0, then decay ──────────────────
  if (armLow == 1 && lowHit >= ARM_THRESH) { envLow = 1.0; armLow = 0; }
  if (lowHit < REARM) armLow = 1;
  if (armMid == 1 && midHit >= ARM_THRESH) { envMid = 1.0; armMid = 0; }
  if (midHit < REARM) armMid = 1;
  if (armHigh == 1 && highHit >= ARM_THRESH) { envHigh = 1.0; armHigh = 0; }
  if (highHit < REARM) armHigh = 1;

  envLow = envLow - dt * fallRate;   if (envLow < 0.0) envLow = 0.0;
  envMid = envMid - dt * fallRate;   if (envMid < 0.0) envMid = 0.0;
  envHigh = envHigh - dt * fallRate; if (envHigh < 0.0) envHigh = 0.0;
}

export function render3D(index, x, y, z) {
  // Time-based traveling base so silence still reads (never fully dark). Speed
  // set by the localSpeed cadence (tBase rate) so localSpeed is visible at rest.
  var travel = wave(tBase * 1.4 + x * 0.9 + y * 0.4);
  var bri = floor_ * (0.74 + 0.26 * travel);   // solid floor (0.74..1.0 of floor_) so
                                               //   the idle palette line is clearly lit
                                               //   across the whole rig at silence
  var tcol = 0.5;

  if (sectionId == 3) {
    // ── BARS: kick onset bursts a twin-front outward from center along X ──────
    // The front position walks from center (env=1) to the rim (env=0); a bright
    // band rides the front so a fresh kick reads as an expanding slam.
    var d = abs(clamp01(x) - 0.5);                 // 0..~0.5 from center
    var frontPos = (1.0 - envLow) * 0.5;           // front radius this frame
    var band = BARS_W - abs(d - frontPos);         // >0 on the moving front
    var e = softEdge(band);
    if (e > 0.0 && envLow > 0.0) {
      // crest stays HOT even as env decays so each kick lands bright (peak->255)
      var v = e * (0.45 + 0.55 * envLow);
      if (v > bri) { bri = v; tcol = 0.08; }       // bars lean cp1 (hot)
    }
    // a faint env-scaled center glow keeps the low band reading on a slam body
    var glow = envLow * 0.35 * (1.0 - d / 0.5);
    if (glow > bri) { bri = glow; tcol = 0.12; }
  } else if (sectionId == 2) {
    // ── VINTAGE: snare/clap onset fills the columns bottom->top ──────────────
    var ny = (clamp01(y) - VINT_BOT) / (VINT_TOP - VINT_BOT);
    ny = clamp01(ny);
    if (envMid > 0.0) {
      var fillH = envMid;                          // fill height tracks envelope
      var inside = fillH - ny;                     // >0 below the fill line
      var e2 = softEdge(inside);
      if (e2 > 0.0) {
        var front2 = 1.0 - (fillH - ny);           // brightest at the fill front
        var v2 = e2 * (0.4 + 0.6 * front2) * (0.5 + 0.5 * envMid);
        if (v2 > bri) { bri = v2; tcol = 0.30 + 0.45 * ny; } // blend up the column
      }
    }
  } else if (sectionId == 1) {
    // ── PARS: hat onset sprinkles crisp deterministic glints ─────────────────
    var seed = index * 97.13 + floor(tGlint * 240.0) * 0.151;
    var spark = sin(seed) * sin(seed * 3.7) * sin(seed * 8.3);
    spark = spark * spark; spark = spark * spark;
    var thr = 0.9 - envHigh * 0.7;                 // more env => more glints
    if (envHigh > 0.0 && spark > thr) {
      var inten = (spark - thr) / (1.0 - thr + 0.0001);
      var v3 = clamp01(inten) * (0.5 + 0.5 * envHigh);
      if (v3 > bri) { bri = v3; tcol = 0.92; }     // glints lean cp2 (cool)
    }
  }

  bri = clamp01(bri);
  tcol = clamp01(tcol);
  var r = (pr1 + (pr2 - pr1) * tcol) * bri;
  var g = (pg1 + (pg2 - pg1) * tcol) * bri;
  var b = (pb1 + (pb2 - pb1) * tcol) * bri;
  rgb(clamp01(r), clamp01(g), clamp01(b));
}
