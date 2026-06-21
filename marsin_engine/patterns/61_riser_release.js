/*
  61_riser_release.js — BUILD-UP CHARGE that RELEASES on the drop.

  Round-2 audio identity: the engine scores build-ups (audioBuildScore ramps
  0->1 across a riser) and fires a sharp pulse on the drop (audioDropPulse). This
  pattern turns that arc into a charge-and-release:

    CHARGE  — as audioBuildScore climbs, a ring of energy WINDS UP: a chase tightens
              and ACCELERATES, brightness swells, and the colour heats from cp1
              (cool) toward cp2 (hot). The rig visibly "loads" — anticipation.
    RELEASE — on audioDropPulse the whole rig FLASHES to full white-hot, the wound
              chase snaps free into a fast expanding burst, then settles back to a
              calm base. The drop literally discharges the build.

  CHARGE state is a persistent `charge` scalar that EASES toward audioBuildScore
  (so it ramps smoothly with the build) and is SLAMMED to a release flash that
  decays on each drop pulse. Between events a calm low-energy base wash keeps the
  rig alive and readable in silence (mission-critical), never fully dark.

  The build->brightness coupling makes frame brightness track audioBuildScore
  (the charge), and the drop pulse adds the discharge flash — both reactive.

  COORDINATE-DRIVEN (radius from center + a chase phase) so it ports test_bench
  -> titanic unchanged.

  CONTROLS (UI order = declaration order)
    - localSpeed : idle chase rate when nothing is building (never frozen).
    - charge     : BUILD-UP score (audio audioBuildScore) -> wind-up + brightness.
    - release    : DROP pulse (audio audioDropPulse) -> discharge flash + burst.
    - base       : calm base floor (always-on; never dark).
    - decay      : release-flash fall rate (slow = long discharge tail).
    - colorPalette1/2 : cp1 cool (charging) -> cp2 hot (released).

  AUDIO (modulators-only — NEVER read CPC audio globals natively):
  AUDIO_MODULATION_V1:
    sliderCharge  <- audioBuildScore range 0.00..1.00 curve linear  # HEADLINE: build winds up the chase + swells brightness (anticipation)
    sliderRelease <- audioDropPulse  range 0.00..1.00 curve linear  # the DROP discharges: full-rig flash + expanding burst
  STATIC (operator handles, not audio-mapped): localSpeed, base, decay, colorPalette1/2.
  ARC pattern: validate on --synth riser (audioBuildScore ramps 0->~1) and
  edm_drop (build then audioDropPulse fires). corr(audioBuildScore, brightness) is
  the charge headline; the drop pulse adds the discharge flash.
*/

// ── Exported controls (UI order = declaration order) ─────────────────────────
export var localSpeed = 0.5;   // idle chase rate
export var charge = 0.0;       // BUILD score -> wind-up + brightness (audio audioBuildScore)
export var release = 0.0;      // DROP pulse  -> discharge flash      (audio audioDropPulse)
export var base = 0.25;        // calm base floor (always-on; never fully dark — visibility floor)
export var decay = 0.5;        // release-flash fall rate

export var cp1H = 0.55, cp1S = 1.0, cp1V = 1.0; // palette 1 — cool cyan (charging)
export var cp2H = 0.06, cp2S = 0.9, cp2V = 1.0; // palette 2 — hot amber (released)
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderCharge(v) { charge = v; }
export function sliderRelease(v) { release = v; }
export function sliderBase(v) { base = 0.25 + v * 0.20; }  // clamped: never below the visibility floor (codex: never fully dark)
export function sliderDecay(v) { decay = v; }

// ── Tunables ─────────────────────────────────────────────────────────────────
var ARM_THRESH = 0.4;    // drop-pulse level that arms a release (rising edge)
var REARM      = 0.2;    // hysteresis re-arm
var DECAY_MIN  = 1.2;    // release fall/sec at decay=0 (long discharge)
var DECAY_MAX  = 4.5;    // release fall/sec at decay=1 (snappy)
var CHARGE_TAU = 4.0;    // charge ease rate toward the build score (per sec)
var BASE_RATE  = 0.10;   // idle chase turns/sec at localSpeed=0.5
var W_POP      = 0.6;    // white-channel pop at the release peak

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

// ── Persistent state ─────────────────────────────────────────────────────────
var chargeS = 0.0;   // smoothed charge level (eases toward `charge`)
var flash = 0.0;     // release-flash envelope (0..1), armed on a drop pulse
var armed = 1;       // rising-edge arm for the drop
var chasePhase = 0.0;
var fall = 3.0;

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  _hsv2rgb1();
  _hsv2rgb2();

  fall = DECAY_MIN + clamp01(decay) * (DECAY_MAX - DECAY_MIN);

  // charge eases smoothly toward the live build score (a build winds up, a quiet
  // passage lets it bleed back down) — so brightness ramps with the anticipation.
  var target = clamp01(charge);
  chargeS = chargeS + (target - chargeS) * clamp01(dt * CHARGE_TAU);

  // drop pulse rising edge -> release flash to 1.0
  if (armed == 1 && release >= ARM_THRESH) { flash = 1.0; armed = 0; }
  if (release < REARM) armed = 1;
  flash = flash - dt * fall;
  if (flash < 0.0) flash = 0.0;

  // the chase ACCELERATES with the charge (anticipation) and SNAPS fast on the
  // flash (discharge). localSpeed sets the idle rate floor so it never freezes.
  var rateMul = pow(2.0, (clamp01(localSpeed) - 0.5) * 4.0);
  var speed = BASE_RATE * (0.4 + rateMul) * (1.0 + 4.0 * chargeS + 8.0 * flash);
  chasePhase = chasePhase + dt * speed;
  chasePhase = chasePhase - floor(chasePhase);
}

export function render3D(index, x, y, z) {
  var dx = clamp01(x) - 0.5;
  var dy = clamp01(y) - 0.5;
  var rad = sqrt(dx * dx + dy * dy);                  // 0..~0.7 from center

  // ── calm BASE wash + CHARGE SWELL: a slow radial breathing so silence reads,
  // lifted by a GLOBAL charge term so total brightness RISES with the build (the
  // anticipation swell) — this makes corr(audioBuildScore, brightness) positive
  // even as the wind-up ring tightens. The swell is broadest at the rig core and
  // fades toward the rim so the edges stay darker for high-def contrast.
  var coreFall = 1.0 - rad / 0.7; if (coreFall < 0.0) coreFall = 0.0;
  var baseBri = base * (0.5 + 0.5 * wave(chasePhase * 0.5 + rad * 1.5))
              + chargeS * 0.55 * coreFall;

  // ── CHARGE ring: a band that TIGHTENS toward the center as charge climbs ────
  // ringPos walks inward (rim -> center) with the charge, and the ring narrows,
  // so the wind-up reads as energy spiraling in. Brightness swells with charge.
  var ringPos = 0.6 * (1.0 - chargeS);               // 0.6 (idle) -> 0 (full charge)
  var ringW = 0.16 - 0.10 * chargeS;                 // tightens as it charges
  var rd = abs(rad - ringPos);
  var chargeBri = 0.0;
  if (rd < ringW) {
    var prof = 1.0 - rd / ringW;
    // add a moving chase ripple along the ring so it spins faster as it charges
    var ripple = 0.6 + 0.4 * wave(chasePhase * 3.0 + rad * 4.0);
    chargeBri = prof * prof * ripple * (0.25 + 0.75 * chargeS);
  }

  // ── RELEASE flash: whole-rig discharge + an expanding burst ring ────────────
  // The flash lifts every pixel (the bang), and a sharp ring rides outward from
  // center as the flash decays (the discharge wave).
  var burstR = (1.0 - flash) * 0.7;                  // burst radius grows as flash falls
  var burstBand = 0.10 - abs(rad - burstR);
  var burstBri = 0.0;
  if (burstBand > 0.0) burstBri = (burstBand / 0.10) * flash;
  var flashBri = flash * 0.85 + burstBri;            // global flash + burst ring

  // compose: brightest of base / charge / flash dominates; base shows through.
  var bri = baseBri;
  if (chargeBri > bri) bri = chargeBri;
  if (flashBri > bri) bri = flashBri;
  bri = clamp01(bri);

  // colour heats cp1(cool)->cp2(hot) with the charge, then jumps fully hot on
  // the flash (the discharge is white-hot amber).
  var tcol = clamp01(0.15 + 0.6 * chargeS + 0.85 * flash);

  var r = (pr1 + (pr2 - pr1) * tcol) * bri;
  var g = (pg1 + (pg2 - pg1) * tcol) * bri;
  var b = (pb1 + (pb2 - pb1) * tcol) * bri;

  // white-channel pop at the release peak: a clean bright spike (the bang).
  var ww = flash * W_POP;

  rgbwau(clamp01(r), clamp01(g), clamp01(b), clamp01(ww), 0.0, 0.0);
}
