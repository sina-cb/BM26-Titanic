/*
  34_moire_interference.js — magical MATHEMATICAL CRISP moiré.

  Two crisp, high-frequency wavefront grids sweep across the rig's x,y at
  SLIGHTLY DIFFERENT spatial ratios. Where their phases align they reinforce;
  where they oppose they cancel — the classic moiré beat. A pow() contrast
  squeezes the beat into sharp, high-def bands that crawl and breathe as the
  two grids drift at an irrational time ratio.

    grid A : frequency = BASE_FREQ
    grid B : frequency = BASE_FREQ * (1 + ratio)      (ratio = the detuning)
    moiré  = (waveA * waveB) sharpened by pow(.,contrast)

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
    - colorPalette1/2 : cp1 cyan, cp2 deep blue / indigo. Blend along moiré.

  AUDIO (modulators-only — never read CPC audio globals natively):
      MODULATE sliderRatio (ratio) <- micMid
      MODULATE sliderLevel (level) <- micLow
      MODULATE sliderPulse (pulse) <- micKick

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

export var cp1H = 0.50, cp1S = 1.0, cp1V = 1.0;  // palette 1 — cyan
export var cp2H = 0.66, cp2S = 1.0, cp2V = 1.0;  // palette 2 — deep blue / indigo
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderRatio(v) { ratio = 0.04 + v * 0.55; }   // detune span
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

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  _hsv2rgb1();
  _hsv2rgb2();

  // Two grids drift at an irrational ratio so the moiré never re-locks.
  driftA = driftA + dt * localSpeed * MAX_RATE;
  driftA = driftA - floor(driftA);
  driftB = driftB + dt * localSpeed * MAX_RATE * 1.272;
  driftB = driftB - floor(driftB);

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
  var waveA = wave(u * BASE_FREQ + driftA);
  var waveB = wave(u * freqB     + driftB);

  // Moiré = product of the two grids. Where they align -> ~1, opposed -> ~0.
  // Lift to 0..1 then sharpen with pow() for high-def bands on black.
  var beat = (waveA * waveB) * 0.5 + 0.5;        // 0..1
  var sharp = contrast + pulseEnv * 3.5;          // kick sharpens the bands
  var moire = pow(beat, sharp);

  // Brightness: faint always-on base + level-scaled moiré + kick brighten.
  var bri = BASE_FLOOR * (0.5 + 0.5 * waveA) + moire * level;
  bri = bri * (1.0 + pulseEnv * 0.8);
  bri = clamp01(bri);

  // Colour blends cp1 (cyan) -> cp2 (indigo) along the moiré value: deepest
  // bands ride cp1, the field falls toward cp2.
  var tcol = clamp01(moire);
  var r = (pr2 + (pr1 - pr2) * tcol) * bri;
  var g = (pg2 + (pg1 - pg2) * tcol) * bri;
  var b = (pb2 + (pb1 - pb2) * tcol) * bri;

  rgb(clamp01(r), clamp01(g), clamp01(b));
}
