/*
  64_drop_countdown.js — 4-3-2-1 STROBE BUILD that RELEASES on the drop.

  Round-2 audio identity: when a riser is genuinely PEAKING the engine emits a
  beat-synced pulse train on audioDropCountdown (peak-gated, NOT on false builds)
  and then fires audioDropPulse / audioSwitchPattern when the drop actually lands.
  This pattern turns that into the classic festival count-in:

    COUNT  — each audioDropCountdown pulse SLAMS the whole rig to a hard strobe
             flash, and a stack of count rings fills inward from the rim toward
             centre, one ring per counted beat — the rig visibly "counts down"
             4-3-2-1 as the drop approaches. The strobe colour heats cp1->cp2
             across the count.
    RELEASE — audioDropPulse (or audioSwitchPattern) BLOWS the whole rig white-hot
             and snaps an expanding shock ring outward, clearing the count stack.
             The release discharges everything the count-in loaded.

  Between events a calm low base wash keeps the rig alive in silence (mission
  critical) — never fully dark. The count NEVER runs on a steady track (the
  countdown signal is peak-hold-gated upstream), so this pattern only strobes when
  a real drop is imminent.

  COORDINATE-DRIVEN (radius from centre + a ring index) so it ports test_bench 52
  -> titanic 970 unchanged.

  CONTROLS (UI order = declaration order)
    - localSpeed : idle wash drift when nothing is counting (never frozen).
    - countdown  : audioDropCountdown pulse train -> strobe flash + a count ring.
    - release    : audioDropPulse / audioSwitchPattern -> white-hot shock release.
    - base       : calm base floor (always-on; never dark).
    - decay      : strobe-flash fall rate (slow = long flash tail).
    - colorPalette1/2 : cp1 cool (early count) -> cp2 hot (last beats / drop).

  AUDIO (modulators-only — NEVER read CPC audio globals natively):
  AUDIO_MODULATION_V1:
    sliderCountdown <- audioDropCountdown range 0.00..1.00 curve linear  # HEADLINE: each count pulse strobes + stacks a ring inward
    sliderRelease   <- audioDropPulse     range 0.00..1.00 curve linear  # the DROP discharges: white-hot shock ring outward, clears the count
  STATIC (operator handles, not audio-mapped): localSpeed, base, decay, colorPalette1/2.
  ARC pattern: validate on --synth riser / edm_drop (audioDropCountdown pulses in
  the final build beats, audioDropPulse fires on the drop). corr(audioDropCountdown,
  brightness) is the strobe headline; the drop pulse adds the shock release.
*/

// ── Exported controls (UI order = declaration order) ─────────────────────────
export var localSpeed = 0.5;   // idle wash drift
export var countdown = 0.0;    // count pulse train (audio audioDropCountdown)
export var release = 0.0;      // drop pulse      (audio audioDropPulse)
export var base = 0.42;        // calm base floor (always-on; never near-dark) — the
                               //   idle wash reads clearly at silence (mission-critical
                               //   night-visibility, ~70/255 like 62/67) while the count
                               //   strobe + drop shock still slam to 255 (max-composite).
export var decay = 0.5;        // strobe-flash fall rate

export var cp1H = 0.55, cp1S = 1.0, cp1V = 1.0; // palette 1 — cool cyan (early count)
export var cp2H = 0.02, cp2S = 1.0, cp2V = 1.0; // palette 2 — hot red (last beats / drop)
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderCountdown(v) { countdown = v; }
export function sliderRelease(v) { release = v; }
export function sliderBase(v) { base = 0.18 + v * 0.42; } // 0.18..0.60; never near-dark
export function sliderDecay(v) { decay = v; }

// ── Tunables ─────────────────────────────────────────────────────────────────
var COUNT_ARM   = 0.5;    // countdown level that arms a count beat (rising edge)
var COUNT_REARM = 0.25;   // hysteresis re-arm
var REL_ARM     = 0.4;    // drop-pulse level that arms a release (rising edge)
var REL_REARM   = 0.2;
var DECAY_MIN   = 2.5;    // strobe fall/sec at decay=0
var DECAY_MAX   = 7.0;    // strobe fall/sec at decay=1 (snappy)
var REL_FALL    = 1.6;    // release shock fall/sec (slow, big tail)
var RINGS_MAX   = 4;      // count rings (4-3-2-1)
var COUNT_HOLD  = 1.6;    // sec a count ring persists with no new pulse, then clears
var BASE_RATE   = 0.10;   // idle wash drift at localSpeed=0.5
var W_POP       = 0.7;    // white-channel pop at the release peak

// ── Palette RGB cache (strict cp1<->cp2 blending; PATTERNS.md §7) ─────────────
var pr1 = 0, pg1 = 1, pb1 = 1;
var pr2 = 1, pg2 = 0, pb2 = 0;
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
var strobe = 0.0;      // strobe-flash envelope (0..1), armed on a count pulse
var countArmed = 1;    // rising-edge arm for a count beat
var ringsLit = 0;      // how many count rings are currently filled (0..4)
var ringTimer = 0.0;   // sec since last count pulse (clears the stack)
var shock = 0.0;       // release shock envelope (0..1)
var relArmed = 1;      // rising-edge arm for the drop
var washPhase = 0.0;
var fall = 4.0;

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  _hsv2rgb1();
  _hsv2rgb2();

  fall = DECAY_MIN + clamp01(decay) * (DECAY_MAX - DECAY_MIN);

  // ── count pulse rising edge -> strobe flash + stack one ring inward ─────────
  if (countArmed == 1 && countdown >= COUNT_ARM) {
    strobe = 1.0;
    countArmed = 0;
    ringsLit = ringsLit + 1;
    if (ringsLit > RINGS_MAX) ringsLit = RINGS_MAX;
    ringTimer = 0.0;
  }
  if (countdown < COUNT_REARM) countArmed = 1;

  // ring stack persists between beats, then clears if the countdown stalls
  ringTimer = ringTimer + dt;
  if (ringTimer > COUNT_HOLD) ringsLit = 0;

  // ── drop pulse rising edge -> shock release (also clears the count stack) ───
  if (relArmed == 1 && release >= REL_ARM) { shock = 1.0; relArmed = 0; ringsLit = 0; }
  if (release < REL_REARM) relArmed = 1;

  // envelope decays
  strobe = strobe - dt * fall;       if (strobe < 0.0) strobe = 0.0;
  shock  = shock  - dt * REL_FALL;   if (shock  < 0.0) shock  = 0.0;

  // idle wash drift (never frozen)
  var rateMul = pow(2.0, (clamp01(localSpeed) - 0.5) * 4.0);
  var speed = BASE_RATE * (0.4 + rateMul);
  washPhase = washPhase + dt * speed;
  washPhase = washPhase - floor(washPhase);
}

export function render3D(index, x, y, z) {
  var dx = clamp01(x) - 0.5;
  var dy = clamp01(y) - 0.5;
  var rad = sqrt(dx * dx + dy * dy);                 // 0..~0.7 from centre

  // ── calm BASE wash so silence reads (never fully dark) ──────────────────────
  // Keep a solid floor (0.72..1.0 of `base`) so the wash is evenly visible across
  // the whole hull even at the dim phase of the breathing wave — mission-critical
  // night-visibility, not a faint flicker.
  var baseBri = base * (0.72 + 0.28 * wave(washPhase * 0.5 + rad * 1.4));

  // ── COUNT rings: filled from the rim INWARD, one ring per counted beat. ─────
  // ringsLit rings occupy radial bands from the outside in, so 4-3-2-1 reads as
  // the rig progressively filling toward centre as the drop nears.
  var radN = rad / 0.7; if (radN > 1.0) radN = 1.0;  // 0 centre .. 1 rim
  var countBri = 0.0;
  if (ringsLit > 0) {
    // each lit ring is a band; outermost fills first. band index of THIS pixel:
    var bandSize = 1.0 / RINGS_MAX;
    var litFloor = 1.0 - ringsLit * bandSize;        // pixels with radN >= litFloor are lit
    if (radN >= litFloor) {
      var prof = 0.6 + 0.4 * wave(washPhase * 2.0 + radN * 5.0);  // gentle ripple inside the fill
      countBri = prof * (0.35 + 0.65 * (ringsLit / RINGS_MAX));   // brighter as more rings stack
    }
  }

  // ── STROBE: the whole-rig hard flash on each count pulse ─────────────────────
  var strobeBri = strobe * strobe;                   // sharp attack on each beat

  // ── RELEASE shock: an expanding ring + a global lift on the drop ────────────
  var shockR = (1.0 - shock) * 0.7;                  // grows outward as shock falls
  var shockBand = 0.11 - abs(rad - shockR);
  var shockRing = 0.0;
  if (shockBand > 0.0) shockRing = (shockBand / 0.11) * shock;
  var shockBri = shock * 0.9 + shockRing;

  // compose: brightest layer wins; base shows through
  var bri = baseBri;
  if (countBri  > bri) bri = countBri;
  if (strobeBri > bri) bri = strobeBri;
  if (shockBri  > bri) bri = shockBri;
  bri = clamp01(bri);

  // colour heats cp1(cool)->cp2(hot) as the count stack grows + on the strobe,
  // and goes fully hot on the shock release.
  var heat = (ringsLit / RINGS_MAX) * 0.7 + strobe * 0.4 + shock * 1.0;
  var tcol = clamp01(0.1 + heat);

  var r = (pr1 + (pr2 - pr1) * tcol) * bri;
  var g = (pg1 + (pg2 - pg1) * tcol) * bri;
  var b = (pb1 + (pb2 - pb1) * tcol) * bri;

  // white-channel pop at the strobe + shock peaks (the bang).
  var ww = (strobe * 0.4 + shock * W_POP);

  rgbwau(clamp01(r), clamp01(g), clamp01(b), clamp01(ww), 0.0, 0.0);
}
