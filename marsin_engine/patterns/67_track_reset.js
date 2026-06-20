/*
  67_track_reset.js — graceful FADE-TO-CALM + palette reset between tracks.

  Round-2 audio identity: the engine latches audioSilence in a quiet gap between
  tracks and fires a one-shot audioTrackChange when a new track begins (gap
  re-onset / tempo relock / harmonic cut). The DJ-transition moment is where most
  rigs go dead-black or freeze; this pattern handles it with grace and the codex
  rule never-fully-dark-on-silence as a first principle:

    SILENCE — when audioSilence latches, the rig EASES into a slow, dim, calm
              breathing wash (a soft "standby" — clearly quieter, but ALIVE and
              welcoming, never dead). The longer the silence, the calmer + cooler
              it settles. It never goes black.
    RESET   — when audioTrackChange fires, the rig gently BLOOMS back up and SNAPS
              a fresh palette rotation — a clean recolour that says "new track" —
              with a soft wash-in (not a hard strobe), then settles into the new
              palette. Each track gets its own colour identity.

  The two events compose: a gap dims the rig, the new-track pulse re-blooms it on
  a new palette. corr(audioSilence, brightness) is NEGATIVE (silence dims) which
  is exactly the intent — the headline reactivity here is the DIM on silence and
  the palette STEP on the change.

  COORDINATE-DRIVEN (radius + a slow phase) so it ports test_bench -> titanic
  unchanged.

  CONTROLS (UI order = declaration order)
    - localSpeed : breathing rate (never frozen).
    - silence    : audioSilence -> ease to dim calm standby (never dark).
    - trackChange: audioTrackChange pulse -> bloom back + rotate palette.
    - base       : active base floor (always-on; never dark).
    - calmFloor  : the dim floor held during silence (still lit, mission critical).
    - colorPalette1/2 : cp1 <-> cp2 (the palette rotation walks between them).

  AUDIO (modulators-only — NEVER read CPC audio globals natively):
  AUDIO_MODULATION_V1:
    sliderSilence     <- audioSilence     range 0.00..1.00 curve linear  # HEADLINE: ease to a dim calm standby wash (never dark)
    sliderTrackChange <- audioTrackChange range 0.00..1.00 curve linear  # new-track pulse: bloom back + rotate to a fresh palette
  STATIC (operator handles, not audio-mapped): localSpeed, base, calmFloor, colorPalette1/2.
  Validate on a full->silence->full gap trace: audioSilence latches in the gap
  (rig dims, stays lit), audioTrackChange fires on the re-onset (rig blooms + the
  palette steps). corr(audioSilence, brightness) is NEGATIVE by design.
*/

// ── Exported controls (UI order = declaration order) ─────────────────────────
export var localSpeed = 0.5;   // breathing rate
export var silence = 0.0;      // quiet-gap latch (audio audioSilence)
export var trackChange = 0.0;  // new-track pulse  (audio audioTrackChange)
export var base = 0.5;         // active base floor (always-on)
export var calmFloor = 0.5;    // dim floor held during silence (never dark)

export var cp1H = 0.55, cp1S = 0.9, cp1V = 1.0; // palette 1 — cyan
export var cp2H = 0.78, cp2S = 0.9, cp2V = 1.0; // palette 2 — violet
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderSilence(v) { silence = v; }
export function sliderTrackChange(v) { trackChange = v; }
export function sliderBase(v) { base = 0.22 + v * 0.28; }       // active wash level
export function sliderCalmFloor(v) { calmFloor = 0.10 + v * 0.14; } // dim standby floor

// ── Tunables ─────────────────────────────────────────────────────────────────
var TC_ARM    = 0.4;     // track-change level that arms a reset (rising edge)
var TC_REARM  = 0.2;
var SIL_TAU   = 1.2;     // ease rate of the silence-dim level (slow, graceful)
var BLOOM_FALL = 0.8;    // re-bloom wash-in fall/sec (gentle, not a strobe)
var BASE_RATE = 0.06;    // breathing rate at localSpeed=0.5

// ── Palette RGB cache (strict cp1<->cp2 blending; PATTERNS.md §7) ─────────────
var pr1 = 0, pg1 = 1, pb1 = 1;
var pr2 = 1, pg2 = 0, pb2 = 1;
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
var silS = 0.0;        // smoothed silence level (eases 0..1) -> the dim
var bloomS = 0.0;      // re-bloom wash-in envelope (0..1) on a track change
var tcArmed = 1;       // rising-edge arm for the track change
var paletteRot = 0.0;  // palette anchor rotation, steps on each track change
var breathPhase = 0.0;

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  _hsv2rgb1();
  _hsv2rgb2();

  // silence level eases toward the latched silence flag (graceful dim/restore).
  var target = clamp01(silence);
  silS = silS + (target - silS) * clamp01(dt * SIL_TAU);

  // ── track-change rising edge -> bloom back + rotate the palette ─────────────
  if (tcArmed == 1 && trackChange >= TC_ARM) {
    bloomS = 1.0;
    paletteRot = paletteRot + 0.37;           // irrational-ish step -> fresh hue each track
    if (paletteRot >= 1.0) paletteRot = paletteRot - 1.0;
    tcArmed = 0;
  }
  if (trackChange < TC_REARM) tcArmed = 1;

  bloomS = bloomS - dt * BLOOM_FALL;           // gentle wash-in decay (not a strobe)
  if (bloomS < 0.0) bloomS = 0.0;

  var rateMul = pow(2.0, (clamp01(localSpeed) - 0.5) * 4.0);
  // breathing slows as the rig goes quiet (the standby is calmer)
  breathPhase = breathPhase + dt * BASE_RATE * (0.4 + rateMul) * (1.0 - 0.5 * silS);
  breathPhase = breathPhase - floor(breathPhase);
}

export function render3D(index, x, y, z) {
  var dx = clamp01(x) - 0.5;
  var dy = clamp01(y) - 0.5;
  var rad = sqrt(dx * dx + dy * dy);
  var radN = rad / 0.7; if (radN > 1.0) radN = 1.0;

  // ── ACTIVE wash level vs DIM standby: the floor eases between the active base
  // and the dim calmFloor as silence latches. Crucially the floor NEVER reaches
  // zero — calmFloor holds the rig lit and welcoming through the whole gap.
  var activeLvl = base;
  var standbyLvl = calmFloor;
  var lvl = activeLvl + (standbyLvl - activeLvl) * silS;   // ease active->standby

  // slow radial breathing wash; in standby it pulls toward centre (calmer, more
  // contained), active it spreads broader.
  var spread = 1.0 - 0.5 * silS;                 // active: broad, standby: tighter
  var coreFall = 1.0 - radN * (0.4 + 0.6 * silS);
  if (coreFall < 0.0) coreFall = 0.0;
  var breath = 0.6 + 0.4 * wave(breathPhase * 0.5 + rad * (1.0 + spread));
  var washBri = lvl * coreFall * breath;

  // ── RE-BLOOM on a track change: a soft global wash-in over the active level,
  // brightest at centre, easing out — the rig "comes back" for the new track.
  var bloomBri = bloomS * (0.5 + 0.5 * coreFall) * 0.7;

  var bri = washBri;
  if (bloomBri > bri) bri = bloomBri;
  bri = clamp01(bri);

  // colour: a slow position blend cp1<->cp2 walked by the palette rotation that
  // steps on each track change, so every track wears a different colour identity.
  // A gentle radial gradient keeps two colours visible across the hull.
  var tcol = paletteRot + radN * 0.5;
  tcol = tcol - floor(tcol);
  var mix = tcol < 0.5 ? tcol * 2.0 : (1.0 - tcol) * 2.0;  // triangle: strict cp1<->cp2
  // on the re-bloom, briefly bias toward cp2 so the new palette announces itself.
  mix = clamp01(mix + bloomS * 0.4 * (1.0 - mix));

  var r = (pr1 + (pr2 - pr1) * mix) * bri;
  var g = (pg1 + (pg2 - pg1) * mix) * bri;
  var b = (pb1 + (pb2 - pb1) * mix) * bri;

  rgbwau(clamp01(r), clamp01(g), clamp01(b), 0.0, 0.0, 0.0);
}
