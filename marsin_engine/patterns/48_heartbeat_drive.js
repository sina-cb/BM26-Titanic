/*
  48_heartbeat_drive.js — HD, SOUND-REACTIVE HEARTBEAT (source: 25_heartbeat).

  An HD reinterpretation of the beloved double-pulse heartbeat. On every KICK a
  synchronized LUB-DUB (two quick swells) re-arms and a bright SHELL expands from
  the rig CENTER outward across the whole rig, riding over a continuous cp1<->cp2
  gradient. Between beats the rig is dark/crisp; the shell is the high-def event.

    BODY  : cp1 (deep red) — the resting muscle, brightness set by micLow.
    SHELL : cp2 (warm / white) — the bright expanding pulse front, so both
            palette colours always read across the rig.
    BLINDER (SIGNATURE): on the BIG kick, the VINTAGE fixtures (fId 5-6, the
            upper heads) get their W (white) channel driven HARD via rgbwau —
            a vintage filament BLINDER POP (technique from 00_golden_hour_wash).

  HD / CONTRAST: shell is a thin crisp bright band on a dark body (true-black
  floor between beats apart from a faint resting glow), so each kick reads as an
  exact, punchy expansion — high contrast + high definition.

  ── AUDIO (modulators-only; codex P0 — pattern NEVER reads CPC audio globals) ──
  AUDIO_MODULATION_V1:
    sliderLow  <- micLow  range 0.30..1.00 curve linear  # PRIMARY brightness — body level tracks the low band
    sliderKick <- micKick range 0.00..1.00 curve pow2    # beat/pop — rising edge fires lub-dub + shell + vintage blinder
  # sliderLocalSpeed: static (resting breath rate + envelope decay trim; not audio-mapped)
  # NOTE: 48 is KICK-GATED (the shell/blinder fire on micKick), but micLow keeps a
  # band->brightness PRIMARY so overall level still tracks the low band (corr>=0.5).
  # Each slider stores v directly (identity-slider convention); all scaling is in
  # render. At rest (no audio) a calm non-black glow breathes — never blacks out.

  ── IRRATIONAL INTER-BEAT DRIFT (no integer periods, never loops) ─────────────
    gradient phase:  gPhase += dt * (GOLD_ANGLE / PI2)      GOLD_ANGLE = PI*(3-sqrt5)
    shell offset:    shellPos = envPos * sqrt2  - gPhase*INV_PHI
  Two mutually irrational rates (golden angle 2.39996.. rad/turn and sqrt2) mean
  the colour gradient and the shell phase never re-sync — the look never repeats.

  CONTROLS (UI order = declaration order)
    - localSpeed : resting-glow breath rate + envelope decay trim.
    - kick       : PRIMARY pulse trigger (0..1). Rising edge fires the lub-dub.
    - low        : baseline body brightness (0..1), continuous 2nd dimension.
    - colorPalette1/2 : strict cp1↔cp2 palette (deep red body -> warm shell).
*/

// ── Exported controls (UI order = declaration order) ─────────────────────────
export var localSpeed = 0.5;   // resting breath rate + envelope decay trim
export var kick = 0.0;         // PRIMARY: micKick -> lub-dub pulse + shell + blinder
export var low = 0.5;          // micLow -> baseline body gradient brightness (mid: lit body in silence)

export var cp1H = 0.0,  cp1S = 1.0, cp1V = 1.0; // BODY  — deep red
export var cp2H = 0.17, cp2S = 1.0, cp2V = 1.0; // SHELL — warm amber-gold
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderKick(v) { kick = v; }
export function sliderLow(v) { low = v; }

// ── Irrational constants (no integer periods) ────────────────────────────────
var SQRT2 = 1.4142135623730951;
var SQRT5 = 2.23606797749979;
var GOLD_ANGLE = PI * (3.0 - SQRT5); // golden angle ≈ 2.39996 rad
var INV_PHI = 0.6180339887498949;    // 1/phi

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

function clamp01(v) {
  if (v < 0.0) return 0.0;
  if (v > 1.0) return 1.0;
  return v;
}

// ── Tunables ─────────────────────────────────────────────────────────────────
var KICK_ON = 0.45;     // rising-edge threshold for a fresh beat
var SHELL_W = 0.16;     // half-width of the bright shell band (normalized radius)
var REST_GLOW = 0.16;   // resting body floor in silence (never fully black) — lifted so the muscle reads
var AUTO_BEAT = 0.62;   // autonomous resting heartbeat period (turns) — keeps the beat alive with NO audio
var KICK_HOLD = 4.0;    // turns of self-beat suppression after a real audio kick (audio takes over)
var RIG_CX = 0.5;       // rig center, normalized X (pars/bars span 0..1)
var RIG_CY = 0.55;      // rig center, normalized Y (shell radiates in X & Y)

// ── Persistent frame state ───────────────────────────────────────────────────
var envPhase = 1.0;     // 0..1 progress since last beat (1 = idle/finished)
var lubdub = 0.0;       // 0..1 lub-dub envelope amplitude (drives shell brightness)
var bigKick = 0.0;      // 0..1 blinder amplitude for the vintage W pop (decays)
var prevKick = 0.0;     // previous-frame kick value (edge detect)
var gPhase = 0.0;       // irrational gradient drift phase
var shellPos = 0.0;     // 0..1 current shell radius from center
var bodyBri = 0.0;      // resolved baseline body brightness this frame
var restBreath = 0.0;   // slow resting breath phase 0..1
var autoBeat = 0.5;     // autonomous resting-beat timer (turns since last self-beat; pre-armed so the first beat fires early)
var kickHold = 0.0;     // turns remaining of self-beat suppression after an audio kick

// Double-bump (lub-dub) envelope over post-beat phase pp in 0..1.
// Two quick swells: a big LUB near pp~0.10 and a smaller DUB near pp~0.42.
function lubDubEnv(pp) {
  if (pp >= 1.0) return 0.0;
  var lub = 0.0;
  if (pp < 0.20) lub = wave(pp / 0.20 * 0.5);          // rising half-wave swell
  var dub = 0.0;
  if (pp > 0.30 && pp < 0.55) dub = wave((pp - 0.30) / 0.25 * 0.5) * 0.62;
  var e = lub; if (dub > e) e = dub;
  return e;
}

export function beforeRender(delta) {
  var localMult = pow(2.0, (localSpeed - 0.5) * 4.0);
  var dt = (delta / 1310.72) * localMult;
  if (dt < 0.0) dt = 0.0;

  _hsv2rgb1();
  _hsv2rgb2();

  // Resting breath (alive in silence). Irrational-ish slow rate.
  restBreath = restBreath + dt * 0.18;
  restBreath = restBreath - floor(restBreath);

  // Irrational gradient drift — golden angle per turn, never an integer period.
  gPhase = gPhase + dt * (GOLD_ANGLE / PI2);
  gPhase = gPhase - floor(gPhase);

  // PRIMARY trigger: rising edge of the kick re-arms the lub-dub from pp=0.
  // A real audio kick also suppresses the autonomous resting beat for a while so
  // the music drives the rhythm cleanly (audio takes over from the self-beat).
  if (kick >= KICK_ON && prevKick < KICK_ON) {
    envPhase = 0.0;
    bigKick = clamp01(kick);   // blinder strength scales with the punch
    kickHold = KICK_HOLD;      // hand the rhythm to the audio
    autoBeat = 0.0;
  }
  prevKick = kick;

  // AUTONOMOUS RESTING HEARTBEAT (codex P0: pattern reads at default with NO
  // audio). When no audio kick is driving the beat, an internal timer fires the
  // same lub-dub on a calm resting period — the heart keeps beating in silence.
  if (kickHold > 0.0) {
    kickHold = kickHold - dt;
    if (kickHold < 0.0) kickHold = 0.0;
  } else {
    autoBeat = autoBeat + dt;
    if (autoBeat >= AUTO_BEAT) {
      autoBeat = autoBeat - AUTO_BEAT;
      envPhase = 0.0;          // re-arm the lub-dub from the top (self-beat)
    }
  }

  // Advance the post-beat phase. ~0.62 turns/frame-block tuned so the lub-dub
  // resolves in roughly a kick interval; decay trims via localSpeed.
  envPhase = envPhase + dt * (1.05 + (1.0 - localSpeed) * 0.4);
  if (envPhase > 1.0) envPhase = 1.0;
  lubdub = lubDubEnv(envPhase);

  // Shell radius expands outward from center as the beat ages. Mix the envelope
  // phase (sqrt2) against the irrational gradient drift (1/phi) so the shell
  // position and the colour gradient never re-sync.
  shellPos = envPhase * SQRT2 - gPhase * INV_PHI;
  shellPos = shellPos - floor(shellPos);

  // Blinder decays after each big kick (vintage W pop afterglow).
  bigKick = bigKick - dt * 2.6;
  if (bigKick < 0.0) bigKick = 0.0;

  // Baseline body brightness: micLow is the continuous 2nd dimension; a small
  // breathing floor keeps the body alive in silence.
  bodyBri = REST_GLOW * (0.6 + 0.4 * wave(restBreath)) + clamp01(low) * 0.65;
}

export function render3D(index, x, y, z) {
  // Radial distance from rig center, normalized to ~0..1 across the rig.
  var dxv = (x - RIG_CX) * 1.05;
  var dyv = (y - RIG_CY) * 0.9;
  var rad = hypot(dxv, dyv);
  if (rad > 1.0) rad = 1.0;

  // ── BODY: red->gold gradient muscle. The baseline gradient runs along the
  // radius and DRIFTS on the irrational gPhase so it never loops; brightness is
  // the micLow 2nd dimension. This keeps BOTH palette colours on the rig at all
  // times (deep-red core -> warm-gold rim), independent of the beat.
  var grad = wave(rad * 0.85 + gPhase);   // 0..1, irrational drift, no integer period
  // Drive toward the two palette ENDPOINTS (near-bimodal) so both hues read
  // strongly across the rig — pure deep-red zones AND pure amber zones, with a
  // narrow soft seam. Maximises two-colour read.
  var grd = smoothstep(0.35, 0.65, grad);
  var bri = bodyBri;
  var tcol = grd;                         // body spans full red(cp1)->amber(cp2)

  // ── SHELL: bright crisp band expanding outward from center on each beat ─────
  var dShell = abs(rad - shellPos);
  if (dShell < SHELL_W && lubdub > 0.0) {
    // Smooth crisp band profile (cos falloff) — thin, high-def front.
    var band = 0.5 + 0.5 * cos(dShell / SHELL_W * PI);
    var shellBri = lubdub * band;
    if (shellBri > bri) { bri = shellBri; tcol = 0.55 + 0.45 * band; } // pulse -> warm
  }

  bri = clamp01(bri);
  tcol = clamp01(tcol);

  var r = (pr1 + (pr2 - pr1) * tcol) * bri;
  var g = (pg1 + (pg2 - pg1) * tcol) * bri;
  var b = (pb1 + (pb2 - pb1) * tcol) * bri;

  // ── SIGNATURE BLINDER: vintage heads (fId 5-6) pop W hard on the big kick ──
  if (fixtureId == 5 || fixtureId == 6) {
    var wch = bigKick * (0.55 + 0.45 * lubdub);
    rgbwau(clamp01(r), clamp01(g), clamp01(b), clamp01(wch), 0.0, 0.0);
    return;
  }

  rgb(clamp01(r), clamp01(g), clamp01(b));
}
