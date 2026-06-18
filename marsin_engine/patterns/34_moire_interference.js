/*
  34_moire_interference.js — magical MATHEMATICAL CRISP two-colour moiré.

  Two crisp, high-frequency wavefront grids sweep across the rig's x,y at
  SLIGHTLY DIFFERENT spatial ratios. Where their phases align they reinforce;
  where they oppose they cancel — the classic moiré beat. A pow() contrast
  squeezes the beat into sharp, high-def bands that crawl and breathe as the
  two grids drift at an irrational time ratio.

    grid A : freqA = BASE_FREQ
    grid B : freqB = BASE_FREQ * (1 + ratio)              (ratio = the detuning)
    waveA  = wave(u*freqA + driftA),  waveB = wave(u*freqB + driftB)
    moire  = pow((waveA*waveB)*0.5 + 0.5, contrast)       (band envelope)
    tcol   = waveA / (waveA + waveB)                       (which grid leads)

  TWO COLOURS: grid A is dressed in cp1, grid B in cp2. The colour at each pixel
  is the cp1<->cp2 blend by which grid currently DOMINATES that point — so the
  moiré fringes read as a travelling TWO-COLOUR BEAT: cp1 crests ride one wave
  set, cp2 crests ride the other, and the interference nodes hand colour back
  and forth across the rig. (The old build blended by the scalar moiré value, so
  every band was the same hue — MONO, hueSpread 0.03. Blending by the per-grid
  lead is what gives the beat its colour.)

  Amalgamates 02_phase_cathedral (interfering wavefronts), 19_swaying_lattice
  (two decorrelated grids over x,y) and 20_parametric_sway_field (RGB-space
  cp1<->cp2 blend, time()-based continuous phases).

  CONTROLS (UI order = declaration order)
    - localSpeed : drift rate of the two grids (0 = frozen lattice).
    - ratio      : DETUNE between grid A and grid B. Small = wide slow moiré
                   bands; larger = tighter, faster-morphing interference.
    - level      : overall brightness (the headline audio target).
    - contrast   : pow() sharpness — high = razor bands on black, low = soft.
    - pulse      : kick — a brief sharpen + brighten flash (visual hook).
    - colorPalette1/2 : cp1 cyan (grid A), cp2 deep blue / indigo (grid B).

  AUDIO (modulators-only — never read CPC audio globals natively):
      MODULATE sliderLevel (level) <- micLow     (primary: brightness pumps on bass)
      MODULATE sliderRatio (ratio) <- micMid     (2nd dim: detune morphs the beat)
      MODULATE sliderPulse (pulse) <- micKick    (kick: sharpen + brighten flash)

  IRRATIONAL RATIOS (no integer periods, never re-locks):
    grid B drift = grid A drift * 1.41421 (sqrt2); colour spin axis * 1.73205
    (sqrt3); base detune offset uses the silver-ish 1.272 leg. The spatial
    detune `ratio` is operator/audio-driven and held off any integer multiple.

  High-def: BASE_FLOOR ~ 0, so off-band pixels are true black. A minimal
  time-based base keeps a faint crisp grid alive when audio is silent
  (mission-critical visibility — never fully dark).
*/

// ── Exported controls ────────────────────────────────────────────────────────
export var localSpeed = 0.5;   // grid drift rate (0 = frozen)
export var ratio = 0.18;       // detune between grid A and B
export var level = 0.85;       // overall brightness (audio headline)
export var contrast = 3.2;     // pow() band sharpness
export var pulse = 0.0;        // kick flash (0..1)

export var cp1H = 0.50, cp1S = 1.0, cp1V = 1.0;  // palette 1 — cyan    (grid A)
export var cp2H = 0.80, cp2S = 1.0, cp2V = 1.0;  // palette 2 — magenta (grid B)
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderRatio(v) { ratio = 0.04 + v * 0.30; }   // detune span (geometry, ~brightness-neutral)
export function sliderLevel(v) { level = v; }
export function sliderContrast(v) { contrast = 1.4 + v * 5.0; }
export function sliderPulse(v) { pulse = v; }

// ── Tunables ──────────────────────────────────────────────────────────────────
var BASE_FREQ = 9.0;     // cycles of grid A across the rig (crisp = high)
var MAX_RATE = 0.5;      // grid drifts per second at localSpeed = 1.0
var BASE_FLOOR = 0.04;   // faint always-on crisp base (silent-audio visibility)

// ── Palette RGB cache (strict cp1<->cp2 in RGB space; PATTERNS.md §7) ─────────
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

// ── Persistent state ──────────────────────────────────────────────────────────
var driftA = 0.0;     // phase drift of grid A (turns, 0..1)
var driftB = 0.0;     // phase drift of grid B (turns, 0..1)
var freqB = 0.0;      // grid B frequency (resolved each frame)
var pulseEnv = 0.0;   // smoothed kick flash envelope
var colSpin = 0.0;    // slow colour-axis rotation (sqrt3 leg) so the two-colour
                      // assignment itself drifts — keeps the beat from staling

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  _hsv2rgb1();
  _hsv2rgb2();

  // Two grids drift at an irrational ratio (sqrt2) so the moiré never re-locks.
  driftA = driftA + dt * localSpeed * MAX_RATE;
  driftA = driftA - floor(driftA);
  driftB = driftB + dt * localSpeed * MAX_RATE * 1.41421;
  driftB = driftB - floor(driftB);

  // Colour axis spins on a third incommensurate leg (sqrt3) — the two-colour
  // hand-off between cp1 and cp2 slowly precesses across the rig.
  colSpin = colSpin + dt * localSpeed * MAX_RATE * 0.13 * 1.73205;
  colSpin = colSpin - floor(colSpin);

  // Grid B is grid A, detuned — the source of the beat.
  freqB = BASE_FREQ * (1.0 + ratio);

  // Kick flash: fast attack toward `pulse`, slow decay — a brief sharpen/bright.
  var target = clamp01(pulse);
  if (target > pulseEnv) pulseEnv = target;
  else pulseEnv = pulseEnv + (target - pulseEnv) * (1.0 - pow(0.0007, dt));
}

export function render3D(index, x, y, z) {
  // x,y arrive normalized 0..1 (engine setCoords) — portable across rigs.
  // Diagonal coordinate makes the moiré read on both X-axis (pars/bars) and
  // Y-axis (vintage) fixtures so the whole rig participates.
  var u = x * 0.72 + y * 0.40;

  // Two crisp wavefront grids. wave() takes a 0..1 turn input (radians-free).
  // waveA/waveB are 0..1; their peaks are the two interfering wave sets.
  var waveA = wave(u * BASE_FREQ + driftA + colSpin);
  var waveB = wave(u * freqB     + driftB);

  // Moiré ENVELOPE = product of the two grids. Where they align -> ~1, opposed
  // -> ~0. Lift to 0..1 then sharpen with pow() for high-def bands on black.
  var beat = (waveA * waveB) * 0.5 + 0.5;        // 0..1
  var sharp = contrast + pulseEnv * 1.4;          // kick lightly sharpens bands
  var moire = pow(beat, sharp);

  // Brightness. LEVEL (micLow) is the headline. It is applied as a SHARED,
  // pixel-independent gain `lgain` over a field that combines (a) a smooth
  // level-scaled WASH `fill` present on every pixel and (b) the crisp moiré
  // band texture on top. The wash makes the per-frame TOTAL dominated by
  // `level` (so frame brightness tracks micLow tightly), while the band texture
  // keeps it crisp/high-def — peaks tower over the wash. ratio/pulse only
  // re-shape the fringes; they do not set the budget, so they cannot dilute the
  // low-band correlation.
  var lgain = 0.35 + level * (0.65 + level * 0.5);   // monotonic in level
  // LEVEL-BORNE WASH on a SLOW, RATIO-INDEPENDENT spatial term. `washPat` is a
  // low-frequency standing pattern (3.5 cycles, irrational drift) that the
  // detune `ratio` never touches, so its per-frame total is set by `level`
  // alone — micMid/ratio cannot dilute the micLow correlation. It is still
  // HARD-GATED (only its upper lobe lights) so the dark background stays crisp
  // and high-def; the sharpened `moire` bands ride on top for the two-colour
  // fringe detail.
  var washPat = wave(u * 3.5 + driftA * 0.5);         // 0..1, slow, ratio-free
  var washIn = washPat - 0.45;
  var fill = 0.0;
  if (washIn > 0.0) fill = washIn * washIn * 1.7;
  var bri = BASE_FLOOR * (0.5 + 0.5 * waveA) + (fill + moire) * lgain;
  bri = bri * (1.0 + pulseEnv * 0.18);               // tiny kick lift (keeps peak crisp)
  bri = clamp01(bri);

  // TWO-COLOUR BEAT: colour is driven by the moiré BEAT PHASE — the slow
  // DIFFERENCE frequency (freqB - freqA) that the two grids trace across the
  // rig. The bright fringes sit where the grids ALIGN, but successive fringes
  // sit at successive beat phases, so colouring by that slow phase paints
  // adjacent fringes in DIFFERENT palette positions: a cp1 fringe, then a cp2
  // fringe, marching across the rig as a two-colour beat. (Colouring by the
  // band envelope alone — the old build — made every fringe one hue: MONO.)
  var beatPhase = u * (freqB - BASE_FREQ) + (driftB - driftA) + colSpin;
  // triangle() gives a full-travel 0..1..0 ramp that REACHES both endpoints
  // (unlike wave(), which lingers near the midpoint) — so lit fringes actually
  // span cp1 and cp2 and the rig shows a true two-colour beat.
  var tcol = triangle(beatPhase);                  // 0..1, full sweep, slow
  tcol = clamp01(tcol);

  var r = (pr1 + (pr2 - pr1) * tcol) * bri;
  var g = (pg1 + (pg2 - pg1) * tcol) * bri;
  var b = (pb1 + (pb2 - pb1) * tcol) * bri;

  rgb(clamp01(r), clamp01(g), clamp01(b));
}
