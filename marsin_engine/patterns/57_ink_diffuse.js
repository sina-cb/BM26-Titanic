/*
  57_ink_diffuse.js — high-def near-field INK IN WATER.

  Colored dye dropped into still water: bright blooms appear at a slowly
  wandering point, then DIFFUSE softly outward and FADE, organically. The
  motion lives in a persistent per-pixel feedback buffer (PATTERNS.md §9.2 /
  §10.2): every frame each cell decays a little AND bleeds a fraction of itself
  toward its index-neighbours, so a single bright drop spreads into a soft,
  feathered cloud over many frames instead of snapping on/off. New ink is
  injected at a drifting head, and MORE/brighter ink when the highs are strong
  (hats, cymbals → fresh blooms). Index order follows each strand, so blooms
  diffuse along the pars row, up the vintage columns, and across the bars.

  HIGH-DEF: BASE_FLOOR is near-zero — un-inked water is true black, and each
  bloom reads as a crisp, soft-edged cloud on darkness. A minimal, slow
  time-based shimmer keeps the rig faintly alive when audio is silent
  (mission-critical visibility, codex P0 — never fully dark).

  CONTROLS (declaration order = UI order)
    - localSpeed : how fast the injection head wanders / blooms refresh.
    - ink        : injection amount + bloom brightness. MODULATE micHigh ->
                   highs spawn more/brighter ink (the audio hook).
    - diffuse    : spread + decay rate — low = tight slow-fading drops,
                   high = wide fast-dissolving clouds.
    - base       : faint resting floor so still water never goes pure black.
    - colorPalette1/2 : cp1 deep indigo (still water / faint ink), cp2 luminous
                   teal-green (hot fresh ink). Ink blends cp1<->cp2 by intensity.

  AUDIO (modulators-only — never read CPC audio globals natively):
      MODULATE sliderInk (ink) <- micHigh
*/

// ── Exported controls (UI order = declaration order) ────────────────────────
export var localSpeed = 0.5;   // wander / refresh rate
export var ink = 0.45;         // injection amount + bloom brightness (micHigh)
export var diffuse = 0.5;      // spread + decay rate
export var base = 0.06;        // faint resting floor (never fully black)

export var cp1H = 0.68, cp1S = 0.95, cp1V = 1.0; // deep indigo (still / faint)
export var cp2H = 0.45, cp2S = 1.00, cp2V = 1.0; // luminous teal-green (hot ink)
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderInk(v) { ink = v; }
export function sliderDiffuse(v) { diffuse = v; }
export function sliderBase(v) { base = v; }

// ── Tunables ────────────────────────────────────────────────────────────────
var N = 52;                 // feedback buffer size (explicit; do NOT use pixelCount)
var BASE_FLOOR = 0.0;       // un-inked water is true black

// ── Palette RGB cache (strict cp1<->cp2 blending; PATTERNS.md §7) ────────────
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

// ── Persistent state ─────────────────────────────────────────────────────────
var buf = array(52);        // per-pixel ink concentration (feedback buffer)
var tmp = array(52);        // scratch for one diffusion pass
var bufInit = 0;
var headPhase = 0.0;        // wandering injection head, 0..1
var dropClock = 0.0;        // accumulates time toward the next ink drop
var faintPhase = 0.0;       // slow phase for the silent-base shimmer

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  _hsv2rgb1();
  _hsv2rgb2();

  if (bufInit == 0) {
    for (var kk = 0; kk < N; kk++) { buf[kk] = 0.0; tmp[kk] = 0.0; }
    bufInit = 1;
  }

  var localMult = pow(2.0, (localSpeed - 0.5) * 2.0);

  // Slow, organic wander of the injection head (two drifting sines blended).
  headPhase = headPhase + dt * 0.05 * localMult;
  headPhase = headPhase - floor(headPhase);
  faintPhase = faintPhase + dt * 0.08;
  faintPhase = faintPhase - floor(faintPhase);

  // ── Decay + diffuse the whole buffer once per frame (O(N), kept out of
  //    the per-pixel path). spread = fraction bled to each index-neighbour so
  //    blooms feather outward; decay pulls every cell toward zero so they fade.
  //    Decay is gentle (long persistence) so sustained highs ACCUMULATE ink and
  //    total brightness tracks the signal; diffuse mainly widens the cloud. ──
  var spread = 0.12 + diffuse * 0.20;            // 0.12..0.32 to each side
  var decay  = 1.0 - (0.10 + diffuse * 0.14);    // fade (0.90..0.76) — equilibrium
                                                 // concentration tracks drop rate
  for (var kk = 0; kk < N; kk++) {
    var c = buf[kk];
    var ln = (kk > 0)     ? buf[kk - 1] : c;
    var rn = (kk < N - 1) ? buf[kk + 1] : c;
    var blended = c + (ln - c) * spread + (rn - c) * spread;
    tmp[kk] = blended * decay;
  }
  for (var kk = 0; kk < N; kk++) buf[kk] = tmp[kk];

  // ── Inject fresh ink at the wandering head. The injection RATE scales hard
  //    with `ink` (driven by micHigh) so more highs => more, brighter blooms =>
  //    higher total brightness (the measurable audio coupling). At ink~0 no
  //    ink is laid down and the water just keeps dissolving (silence behaves). ──
  var dropRate = ink * ink * 14.0;               // drops/sec, steep in `ink`
  dropClock = dropClock + dt * dropRate * localMult;
  if (ink > 0.02) {
    var guard = 0;
    while (dropClock >= 1.0 && guard < 8) {
      dropClock = dropClock - 1.0;
      guard = guard + 1;
      // head meanders across the strip; jitter so successive drops differ
      var hp = wave(headPhase + guard * 0.11) * 0.55
             + wave(headPhase * 2.37 + 0.31 + guard * 0.07) * 0.45;
      var center = floor(hp * (N - 1) + 0.5);
      if (center < 0) center = 0;
      if (center > N - 1) center = N - 1;
      var amt = 0.35 + ink * 0.45;               // brighter ink on strong highs
      // seed a small 3-cell bloom so diffusion has a soft core to spread.
      // Buffer is NOT clamped here: gentle headroom lets total brightness keep
      // rising with sustained highs instead of pinning flat at 1.0 (render
      // clamps for display). Cap modestly so a single cell can't run away.
      buf[center] = buf[center] + amt;     if (buf[center] > 1.6) buf[center] = 1.6;
      if (center > 0)     buf[center - 1] = buf[center - 1] + amt * 0.5;
      if (center < N - 1) buf[center + 1] = buf[center + 1] + amt * 0.5;
    }
    if (dropClock > 2.0) dropClock = 2.0;        // cap backlog
  } else {
    if (dropClock > 1.0) dropClock = 1.0;        // don't bank drops while silent
  }
}

export function render3D(index, x, y, z) {
  var conc = 0.0;
  if (index >= 0 && index < N) conc = buf[index];

  // Faint, slow resting shimmer so still water is never pure black (P0).
  var faint = base * (0.35 + 0.65 * wave(faintPhase + index * 0.013));

  // Immediate "wet sheen": a soft glow that tracks `ink` (micHigh) the same
  // frame it changes, so total brightness rises and falls WITH the highs (the
  // measurable, lag-free audio coupling). It rides on top of the diffusing
  // blooms — strong highs brighten the whole near-field of water, gently.
  var sheen = ink * 0.45 * (0.30 + 0.70 * wave(faintPhase * 1.7 + index * 0.05));

  var bri = conc + faint + sheen;
  if (bri < BASE_FLOOR) bri = BASE_FLOOR;
  bri = clamp01(bri);

  // Colour blends cp1 (faint indigo water) -> cp2 (hot teal ink) by intensity.
  var tcol = clamp01(conc * 1.2);
  var r = (pr1 + (pr2 - pr1) * tcol) * bri;
  var g = (pg1 + (pg2 - pg1) * tcol) * bri;
  var b = (pb1 + (pb2 - pb1) * tcol) * bri;

  rgb(clamp01(r), clamp01(g), clamp01(b));
}
