/*
  72_chroma_phrase_bloom.js — a structural BLOOM that grows across the musical
  phrase, COLOURED by the harmonic timbre (chroma tilt) and SURFACED by tonal
  stability. The chroma + structure combo: the big building look, painted by the
  harmony.

  Design note (honest): this slice's parent branch (post Wave-E) gates audioClimax
  hard, so it does NOT fire on the deterministic synth bank (verified: audioClimax
  reads 0.00 even on 65_climax_hold here). audioPhrasePhase, by contrast, ramps
  0->1 across each 8-bar phrase and is strongly REACTIVE (corr 0.90 on full_track),
  so this pattern uses the PHRASE as the structural build driver — the rig fills up
  as the phrase advances, then wraps. Same "big look that builds" intent, on a
  signal that actually moves.

    PHRASE  (audioPhrasePhase 0->1) -> the lit core EXPANDS outward across the
                                       phrase to full coverage at max brightness
                                       (you can SEE the wrap coming); resets at the
                                       phrase boundary. Smooth growth — power, not
                                       strobe.
    TILT    (micChromaTilt)         -> sets the bloom TEMPERATURE: a dark, bass-
                                       heavy passage blooms COOL (deep indigo/teal),
                                       a bright, treble-rich passage blooms WARM
                                       (amber/gold). The same build reads different
                                       with the harmony.
    TONAL   (micTonalStability)     -> sets the bloom SURFACE: a harmonically HELD
                                       passage (tonal) blooms as a SMOOTH glow; a
                                       PERCUSSIVE passage (atonal) blooms with a
                                       fine energetic GRAIN on top, so a banging
                                       techno build sparkles where a melodic
                                       chord-build glows.

  All audio drivers EASE (smoothed) so colour/texture/coverage morph rather than
  snap. A lifted calm base keeps the rig clearly ALIVE in silence (mission
  critical — never near-black).

  COORDINATE-DRIVEN (radius + sweep + hashed grain) so it ports test_bench ->
  titanic unchanged.

  CONTROLS (UI order = declaration order)
    - localSpeed : idle wash + sweep + grain rate (never frozen).
    - phrase     : audioPhrasePhase -> bloom grows across the phrase (HEADLINE).
    - warmth     : micChromaTilt -> bloom temperature (cool dark <-> warm bright).
    - tonal      : micTonalStability -> bloom surface (smooth glow <-> grain).
    - base       : calm base floor (always-on; never dark).
    - bloom      : how far the phrase pushes coverage (operator taste).
    - colorPalette1/2 : cp1 COOL anchor <-> cp2 WARM anchor.

  AUDIO (modulators-only — NEVER read CPC audio globals natively):
  AUDIO_MODULATION_V1:
    sliderPhrase <- audioPhrasePhase     range 0.00..1.00 curve linear  # HEADLINE: bloom grows across the 8-bar phrase
    sliderWarmth <- micChromaTiltRaw     range 0.00..1.00 curve linear  # bloom temperature (cool dark <-> warm bright)
    sliderTonal  <- micTonalStabilityRaw range 0.00..1.00 curve linear  # bloom surface (smooth glow <-> grain)
  STATIC (operator handles, not audio-mapped): localSpeed, base, bloom, colorPalette1/2.
  Validate on --synth full_track (phrasePhase ramps -> bloom grows; tilt bass-low
  -> cool; tonal mid). corr(audioPhrasePhase, brightness) is the headline; the
  tilt/tonal axes are colour/texture (corr->warmth, corr->variance).
*/

// ── Exported controls (UI order = declaration order) ─────────────────────────
export var localSpeed = 0.5;   // idle wash + sweep + grain rate
export var phrase = 0.0;       // audioPhrasePhase -> bloom growth (audio)
export var warmth = 0.0;       // micChromaTilt -> temperature (audio)
export var tonal = 0.0;        // micTonalStability -> surface (audio)
export var base = 0.46;        // calm base floor (always-on; never near-dark)
export var bloom = 0.6;        // how far the phrase pushes coverage

export var cp1H = 0.58, cp1S = 0.95, cp1V = 1.0; // palette 1 — COOL anchor (dark/bassy)
export var cp2H = 0.07, cp2S = 0.92, cp2V = 1.0; // palette 2 — WARM anchor (bright/treble)
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderPhrase(v) { phrase = v; }
export function sliderWarmth(v) { warmth = v; }
export function sliderTonal(v) { tonal = v; }
export function sliderBase(v) { base = 0.20 + v * 0.42; } // 0.20..0.62; never near-dark
export function sliderBloom(v) { bloom = v; }

// ── Tunables ─────────────────────────────────────────────────────────────────
var PHRASE_TAU = 2.4;    // ease of the bloom toward the phrase phase (per sec)
var WARM_TAU   = 1.2;    // ease of the temperature toward the tilt
var TONAL_TAU  = 1.6;    // ease of the surface toward the tonal stability
var BASE_RATE  = 0.07;   // idle wash drift at localSpeed=0.5
var SWEEP_RATE = 0.06;   // grand sweep rate at full bloom
var GRAIN_RATE = 1.3;    // grain animation rate at localSpeed=0.5

// ── Palette RGB cache (strict cp1<->cp2 blending; PATTERNS.md §7) ─────────────
var pr1 = 0, pg1 = 0, pb1 = 1;
var pr2 = 1, pg2 = 1, pb2 = 0;
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

function hash01(a, b) {
  var s = sin(a * 113.5 + b * 197.3) * 51234.987;
  return s - floor(s);
}

// ── Persistent state ─────────────────────────────────────────────────────────
var grown = 0.0;       // smoothed phrase phase -> the bloom coverage/brightness
var temp = 0.0;        // smoothed temperature (eased toward the tilt)
var surf = 0.0;        // smoothed surface (eased toward the tonal stability)
var washPhase = 0.0;
var sweepPhase = 0.0;
var grainPhase = 0.0;

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  _hsv2rgb1();
  _hsv2rgb2();

  // bloom grows toward the phrase phase (eased so the wrap-reset is graceful).
  var target = clamp01(phrase);
  grown = grown + (target - grown) * clamp01(dt * PHRASE_TAU);

  // temperature + surface ease toward their chroma drivers.
  var tw = clamp01(warmth);
  temp = temp + (tw - temp) * clamp01(dt * WARM_TAU);
  var ts = clamp01(tonal);
  surf = surf + (ts - surf) * clamp01(dt * TONAL_TAU);

  var rateMul = pow(2.0, (clamp01(localSpeed) - 0.5) * 4.0);
  washPhase = washPhase + dt * BASE_RATE * (0.4 + rateMul);
  washPhase = washPhase - floor(washPhase);
  sweepPhase = sweepPhase + dt * SWEEP_RATE * (0.5 + 1.5 * grown) * (0.4 + rateMul);
  sweepPhase = sweepPhase - floor(sweepPhase);
  grainPhase = grainPhase + dt * GRAIN_RATE * (0.5 + rateMul);
  grainPhase = grainPhase - floor(grainPhase);
}

export function render3D(index, x, y, z) {
  var xn = clamp01(x);
  var yn = clamp01(y);
  var dx = xn - 0.5;
  var dy = yn - 0.5;
  var rad = sqrt(dx * dx + dy * dy);
  var radN = rad / 0.7; if (radN > 1.0) radN = 1.0;
  var coreFall = 1.0 - radN; if (coreFall < 0.0) coreFall = 0.0;

  // ── calm BASE wash (always-on, never dark) — lifted globally so the rig is
  // clearly lit and welcoming in silence.
  var washProf = 0.62 + 0.38 * coreFall;
  var baseBri = base * washProf * (0.74 + 0.26 * wave(washPhase * 0.5 + rad * 1.3));

  // ── PHRASE BLOOM: as `grown` climbs across the phrase, the lit core EXPANDS to
  // full coverage and brightness rises; a grand sweep crosses at full bloom.
  var reach = clamp01(bloom) * grown;
  var cover = 1.0 - (radN - reach) * 2.2;
  if (cover > 1.0) cover = 1.0;
  if (cover < 0.0) cover = 0.0;
  var sweep = 0.7 + 0.3 * wave(sweepPhase + xn);
  var bloomBri = grown * (0.45 + 0.55 * cover) * sweep;

  // ── SURFACE: a held passage (surf high) is SMOOTH; a percussive passage (surf
  // low) gets a fine grain on top of the bloom — only where the bloom lights, so
  // the energetic passage sparkles instead of glowing flat.
  var ph = hash01(xn * 9.0, yn * 9.0);
  var tw = wave(grainPhase + ph);
  var grainGate = 1.0 - surf;                        // 0 held .. 1 percussive
  var glint = tw - 0.55;
  if (glint < 0.0) glint = 0.0;
  glint = glint / 0.45;
  var grain = grainGate * glint * (baseBri + bloomBri) * 0.40;

  // compose: base + bloom (bloom dominates as it grows); grain rides on top.
  var bri = baseBri;
  if (bloomBri > bri) bri = bloomBri;
  bri = bri + grain;
  bri = clamp01(bri);

  // ── COLOUR TEMPERATURE from the chroma tilt: cool(cp1) -> warm(cp2). The bloom
  // pushes a touch warmer at its peak (a build leans hot), but the harmony's tilt
  // sets the anchor so a dark passage stays cool.
  var tcol = clamp01(temp * 0.85 + grown * 0.15);

  var r = (pr1 + (pr2 - pr1) * tcol) * bri;
  var g = (pg1 + (pg2 - pg1) * tcol) * bri;
  var b = (pb1 + (pb2 - pb1) * tcol) * bri;

  // a touch of white at full bloom so the big look reads as POWER; biased to
  // amber when warm so a hot passage is genuinely warm-white.
  var ww = grown * grown * 0.30 * bri;
  var aa = clamp01(temp) * grown * 0.20 * bri;

  rgbwau(clamp01(r), clamp01(g), clamp01(b), clamp01(ww), clamp01(aa), 0.0);
}
