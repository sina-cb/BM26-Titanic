/*
  65_climax_hold.js — the BIGGEST SUSTAINED LOOK, locked on the climax.

  Round-2 audio identity: the engine raises audioClimax on a sustained full-
  spectrum peak plateau (loud + bright top + bass body, held ~900ms) — i.e. the
  drop/chorus where the track is at its biggest. This pattern answers that with
  the rig's maximum statement:

    CLIMAX  — as audioClimax ramps up, the rig BLOOMS to FULL COVERAGE at maximum
              brightness: the calm two-colour wash expands until every pixel is
              lit hot, a slow grand sweep crosses the hull, and the palette pushes
              fully to cp2 (hot). This is the sustained "everything on" look — the
              rig holds it for as long as the climax holds (no strobing; a climax
              is POWER, not flicker).
    RELAX   — when audioclimax falls (the section ends) the bloom RECEDES smoothly
              back to a calm, breathing two-colour wash with true-black negative
              space at the edges. The come-down is graceful, never a hard cut.

  audioBeat adds a subtle locked pulse on top of the held bloom so the sustained
  look still breathes with the groove without breaking the "held" feel.

  The held value EASES toward audioClimax (attack/release smoothed) so the bloom
  ramps in and recedes out — corr(audioClimax, brightness) is strongly positive.
  A calm base wash keeps the rig alive in silence (mission critical), never dark.

  COORDINATE-DRIVEN (radius + a sweep phase) so it ports test_bench -> titanic
  unchanged.

  CONTROLS (UI order = declaration order)
    - localSpeed : idle wash + sweep rate (never frozen).
    - climax     : audioClimax -> bloom to full coverage + max brightness.
    - beat       : audioBeat -> subtle locked pulse over the held bloom.
    - base       : calm base floor (always-on; never dark).
    - bloom      : how far the climax pushes coverage (operator taste).
    - colorPalette1/2 : cp1 calm -> cp2 hot (climax).

  AUDIO (modulators-only — NEVER read CPC audio globals natively):
  AUDIO_MODULATION_V1:
    sliderClimax <- audioClimax range 0.00..1.00 curve linear  # HEADLINE: bloom to full-coverage max-brightness held look
    sliderBeat   <- audioBeat   range 0.00..1.00 curve linear  # subtle locked pulse on top of the held bloom
  STATIC (operator handles, not audio-mapped): localSpeed, base, bloom, colorPalette1/2.
  Validate on --synth full_track (audioClimax ~0.94 sustained) and edm_drop
  (climax rises on the drop). corr(audioClimax, brightness) is the headline.
*/

// ── Exported controls (UI order = declaration order) ─────────────────────────
export var localSpeed = 0.5;   // idle wash + sweep rate
export var climax = 0.0;       // sustained peak (audio audioClimax)
export var beat = 0.0;         // beat pulse     (audio audioBeat)
export var base = 0.18;        // calm base floor (always-on)
export var bloom = 0.6;        // how far the climax pushes coverage

export var cp1H = 0.60, cp1S = 1.0, cp1V = 1.0; // palette 1 — calm indigo (relaxed)
export var cp2H = 0.08, cp2S = 0.9, cp2V = 1.0; // palette 2 — hot gold (climax)
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderClimax(v) { climax = v; }
export function sliderBeat(v) { beat = v; }
export function sliderBase(v) { base = v * 0.32; }
export function sliderBloom(v) { bloom = v; }

// ── Tunables ─────────────────────────────────────────────────────────────────
var ATTACK_TAU = 3.0;    // ease rate UP toward the climax (per sec) — blooms in
var RELEASE_TAU = 1.4;   // ease rate DOWN when the climax falls (slower come-down)
var BASE_RATE  = 0.08;   // idle wash drift at localSpeed=0.5
var SWEEP_RATE = 0.06;   // grand sweep rate across the hull at full climax
var BEAT_LIFT  = 0.10;   // how much a beat pulse lifts the held bloom

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

// ── Persistent state ─────────────────────────────────────────────────────────
var held = 0.0;        // smoothed climax level (attack/release eased) -> the bloom
var beatPulse = 0.0;   // smoothed beat envelope for the locked pulse
var washPhase = 0.0;
var sweepPhase = 0.0;

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  _hsv2rgb1();
  _hsv2rgb2();

  // attack/release ease: blooms IN fast on the climax, RECEDES slower on relax.
  var target = clamp01(climax);
  var tau = target > held ? ATTACK_TAU : RELEASE_TAU;
  held = held + (target - held) * clamp01(dt * tau);

  // beat pulse: quick attack, smooth fall, so the held bloom breathes on-beat.
  var b = clamp01(beat);
  if (b > beatPulse) beatPulse = b;
  beatPulse = beatPulse - dt * 3.0;
  if (beatPulse < 0.0) beatPulse = 0.0;

  var rateMul = pow(2.0, (clamp01(localSpeed) - 0.5) * 4.0);
  washPhase = washPhase + dt * BASE_RATE * (0.4 + rateMul);
  washPhase = washPhase - floor(washPhase);
  // the grand sweep speeds up with the climax (the big look is in motion)
  sweepPhase = sweepPhase + dt * SWEEP_RATE * (0.5 + 1.5 * held) * (0.4 + rateMul);
  sweepPhase = sweepPhase - floor(sweepPhase);
}

export function render3D(index, x, y, z) {
  var dx = clamp01(x) - 0.5;
  var dy = clamp01(y) - 0.5;
  var rad = sqrt(dx * dx + dy * dy);                 // 0..~0.7 from centre
  var radN = rad / 0.7; if (radN > 1.0) radN = 1.0;  // 0 centre .. 1 rim

  // ── calm BASE wash (always-on, never dark) — strongest at centre, fading
  // toward the rim for high-def contrast, but with a small GLOBAL floor term so
  // the whole rig stays clearly ALIVE and welcoming in silence (mission critical,
  // never near-black), not just a dim core dot.
  var coreFall = 1.0 - radN; if (coreFall < 0.0) coreFall = 0.0;
  var washProf = 0.30 + 0.70 * coreFall;             // 0.30 floor at the rim .. 1.0 at centre
  var baseBri = base * washProf * (0.5 + 0.5 * wave(washPhase * 0.5 + rad * 1.4));

  // ── CLIMAX BLOOM: as `held` climbs, the lit core EXPANDS outward to full
  // coverage (the rim fills in), brightness rises, and a grand sweep crosses.
  // At held=1 every pixel is lit hot; at held=0 only the centre breathes.
  var reach = clamp01(bloom) * held;                 // 0..bloom : how far coverage reaches
  // coverage falls off past `reach` from centre; lifted globally by held so the
  // whole rig brightens (positive corr) even as the front expands.
  var cover = 1.0 - (radN - reach) * 2.2;
  if (cover > 1.0) cover = 1.0;
  if (cover < 0.0) cover = 0.0;
  // grand sweep: a soft moving brightness band across X at full climax
  var sweep = 0.7 + 0.3 * wave(sweepPhase + clamp01(x));
  var bloomBri = held * (0.45 + 0.55 * cover) * sweep;

  // ── beat pulse rides on top of whatever is held (subtle, never strobe) ──────
  var beatBri = beatPulse * BEAT_LIFT * (0.4 + 0.6 * held);

  // compose: base + bloom (bloom dominates at climax); beat lifts the whole.
  var bri = baseBri;
  if (bloomBri > bri) bri = bloomBri;
  bri = bri + beatBri;
  bri = clamp01(bri);

  // colour pushes cp1(calm)->cp2(hot) with the held climax.
  var tcol = clamp01(0.12 + 0.85 * held);

  var r = (pr1 + (pr2 - pr1) * tcol) * bri;
  var g = (pg1 + (pg2 - pg1) * tcol) * bri;
  var b = (pb1 + (pb2 - pb1) * tcol) * bri;

  // a touch of white channel at full climax to make the held look read as POWER.
  var ww = held * held * 0.35 * bri;

  rgbwau(clamp01(r), clamp01(g), clamp01(b), clamp01(ww), 0.0, 0.0);
}
