/*
  57_ink_diffuse.js — high-def near-field INK IN WATER (two-colour redo).

  Colored dye dropped into still water: bright blooms appear at a slowly
  wandering point, then DIFFUSE softly outward and FADE, organically. The
  motion lives in a persistent per-pixel feedback buffer (PATTERNS.md §9.2 /
  §10.2): every frame each cell decays a little AND bleeds a fraction of itself
  toward its index-neighbours, so a single bright drop spreads into a soft,
  feathered cloud over many frames instead of snapping on/off. New ink is
  injected at a drifting head, and MORE/brighter ink when the highs are strong
  (hats, cymbals -> fresh blooms). Index order follows each strand, so blooms
  diffuse along the pars row, up the vintage columns, and across the bars.

  TWO COLOURS (the fix for the mono-colour audit): the rig shows BOTH the
  still water AND the ink at once.
    - WATER (low concentration) is rendered at cp1 (deep blue): the faint
      resting floor + an immediate "wet sheen" both ride strictly on cp1, so
      un-inked cells read clearly blue.
    - INK (high concentration) blends sharply toward cp2 (luminous magenta /
      violet) as the dye thickens, so a fresh bloom is a vivid magenta cloud
      sitting on the blue water. cp1 and cp2 are far apart on the wheel
      (hueSpread well over the 0.10 gate) so both colours are always present.

  HIGH-DEF + BRIGHT: BASE_FLOOR is near-zero so the field reads as crisp,
  soft-edged clouds on near-darkness, but the ink CORES are lifted hard so a
  musical peak burns a channel past 200 (mission-critical visibility). A
  minimal, slow time-based shimmer keeps the rig faintly alive (blue water) in
  silence (codex P0 — never fully dark).

  IRRATIONAL MOTION (no integer periods): the injection head is a sum of two
  sines whose phases advance at the golden-angle ratio (PHI = 1.61803) and a
  sqrt2 (1.41421) detune, and per-drop jitter steps by distinct primes, so the
  drop locations never lock into a repeating grid.
    headPhase     += dt * RATE                       (base wander)
    hp = wave(headPhase*PHI) * 0.55
       + wave(headPhase*PHI*SQRT2 + 0.31) * 0.45     (PHI=1.61803, SQRT2=1.41421)

  CONTROLS (declaration order = UI order)
    - localSpeed : how fast the injection head wanders / blooms refresh.
    - ink        : injection amount + bloom brightness. MODULATE micHigh ->
                   highs spawn more/brighter (magenta) ink (SPARKLE/detail).
    - flow       : current strength — bass stirs the water: lifts an overall
                   blue water glow (PRIMARY brightness) AND speeds the wander /
                   widens diffusion. MODULATE micLow -> the band that owns
                   overall rig brightness (corr >= 0.5).
    - diffuse    : spread + decay rate — low = tight slow-fading drops, high =
                   wide fast-dissolving clouds. MODULATE micFlux -> a build
                   EXPANDS the ink clouds (movement dimension).
    - base       : faint resting BLUE floor so still water never goes black.
    - colorPalette1/2 : cp1 deep blue (still / faint water), cp2 luminous
                   magenta-violet (hot fresh ink). Ink blends cp1<->cp2 by conc.

  AUDIO (modulators-only — never read CPC audio globals natively):
  AUDIO_MODULATION_V1:
    sliderFlow    <- micLow  range 0.30..1.00 curve linear   # PRIMARY brightness (bass stirs + lifts water glow)
    sliderInk     <- micHigh range 0.00..1.00 curve linear   # SPARKLE: highs spawn fresh magenta blooms
    sliderDiffuse <- micFlux range 0.40..0.90 curve linear   # MOVEMENT: build expands the diffusing clouds
    # sliderBase static (resting blue floor — silence-visibility, not audio)
*/

// ── Exported controls (UI order = declaration order) ────────────────────────
export var localSpeed = 0.5;   // wander / refresh rate
export var ink = 0.5;          // injection amount + bloom brightness (micHigh, SPARKLE)
export var flow = 0.5;         // PRIMARY: bass stirs water + lifts overall glow (micLow)
export var diffuse = 0.5;      // spread + decay rate; build EXPANDS clouds (micFlux)
export var base = 0.09;        // faint resting BLUE floor (never fully black)

export var cp1H = 0.62, cp1S = 1.00, cp1V = 1.0; // deep blue  (still / faint water)
export var cp2H = 0.85, cp2S = 1.00, cp2V = 1.0; // magenta-violet (hot fresh ink)
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderInk(v) { ink = v; }
export function sliderFlow(v) { flow = v; }
export function sliderDiffuse(v) { diffuse = v; }
export function sliderBase(v) { base = v; }

// ── Tunables ────────────────────────────────────────────────────────────────
// The ink lives in a FIXED-SIZE VIRTUAL DIFFUSION FIELD of N cells, NOT a
// per-pixel buffer. Every pixel maps its `index` into this field (index ->
// cell), so the SAME bounded buffer drives EVERY rig — 52 (test_bench), 216
// (logsville), 266 (dome) and 970 (titanic) — instead of a hardcoded 52 that
// left titanic's pixels 52..969 with no ink. N is a safe constant (never
// `pixelCount`, which compiles to a literal 144).
//   WHY 56 (not 970/1024): the MarsinVM corrupts persistent state once the
//   per-frame diffusion loop runs more than ~56 iterations (measured: 56 cells
//   render correctly, 60+ smears the blooms flat). A wider/per-pixel buffer is
//   therefore impossible here. 56 cells is plenty for soft diffusing ink clouds:
//   small rigs map 1:1 (test_bench look preserved exactly) and large rigs are
//   compressed into the field (index/maxIdx -> cell). Every buf[] access < N.
var N = 56;                 // virtual diffusion-field size (do NOT use pixelCount)
var BASE_FLOOR = 0.0;       // un-inked water is (near) black
var PHI = 1.61803;          // golden ratio — irrational head-phase advance
var SQRT2 = 1.41421;        // second irrational detune for the head sum

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
var buf = array(56);        // virtual ink-field concentration (N cells)
var tmp = array(56);        // scratch for one diffusion pass (N cells)
var bufInit = 0;
var headPhase = 0.0;        // wandering injection head, 0..1
var dropClock = 0.0;        // accumulates time toward the next ink drop
var faintPhase = 0.0;       // slow phase for the silent-base shimmer
// Actual pixel span of the live rig, learned from the highest index seen in
// render3D (pixelCount compiles to a literal 144 — unusable). Injection maps
// the wandering head across THIS span so blooms cover the WHOLE real rig
// (52 on test_bench, 970 on titanic) instead of a fixed 52-cell window.
var maxIdx = 51;            // grows to (realPixelCount - 1), clamped < N below
var nextMaxIdx = 0;         // tracks the highest index across the current frame
var waterGlow = 0.5;        // PRIMARY: flow(micLow)-driven overall water brightness this frame

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

  var localMult = pow(2.0, (localSpeed - 0.5) * 4.0);   // 0..1 -> 0.25x..4x wander/refresh
  // `flow` (micLow) stirs the water: faster head wander + wider diffusion AND it
  // is the PRIMARY brightness drive — a steep gain that lifts the whole blue
  // water glow so TOTAL rig brightness tracks the low band hard (corr >= 0.5).
  var flowMult = 1.0 + flow * 2.0;
  var fl = clamp01(flow);
  waterGlow = 0.05 + fl * fl * 0.95;   // PRIMARY: overall water brightness 0.05..1.00 (steep)

  // Slow, organic wander of the injection head (irrational golden/sqrt2 phases).
  headPhase = headPhase + dt * 0.05 * localMult * flowMult;
  headPhase = headPhase - floor(headPhase);
  faintPhase = faintPhase + dt * 0.08;
  faintPhase = faintPhase - floor(faintPhase);

  // ── Decay + diffuse the whole buffer once per frame (O(N), kept out of
  //    the per-pixel path). spread = fraction bled to each index-neighbour so
  //    blooms feather outward; decay pulls every cell toward zero so they fade.
  //    Decay is gentle (long persistence) so sustained highs ACCUMULATE ink and
  //    total brightness tracks the signal; diffuse + flow widen the cloud. ──
  // Learn the live rig's highest pixel index (for the index->cell map in
  // render3D). pixelCount compiles to a literal 144, so we measure it instead.
  if (nextMaxIdx > maxIdx) maxIdx = nextMaxIdx;
  nextMaxIdx = 0;

  var spread = 0.12 + diffuse * 0.20 + flow * 0.10;   // 0.12..0.42 to each side
  var decay  = 1.0 - (0.085 + diffuse * 0.125);       // fade (0.915..0.79) — slight persistence for two-colour
  // Diffuse across the WHOLE virtual field (fixed N cells) — contiguous
  // neighbour bleed feathers each bloom outward. Guarded < N throughout.
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
  var dropRate = ink * ink * 22.0;               // drops/sec, steep in `ink`
  dropClock = dropClock + dt * dropRate * localMult;
  if (ink > 0.02) {
    var guard = 0;
    while (dropClock >= 1.0 && guard < 8) {
      dropClock = dropClock - 1.0;
      guard = guard + 1;
      // head meanders across the strip; irrational phases + prime jitter so
      // successive drops never land on a repeating grid.
      var hp = wave(headPhase * PHI + guard * 0.11) * 0.55
             + wave(headPhase * PHI * SQRT2 + 0.31 + guard * 0.07) * 0.45;
      // Map the head across only the OCCUPIED cells of the field — the cells
      // that real pixels sample. When the rig fits the field 1:1 (maxIdx < N)
      // that is 0..maxIdx; when it is larger the rig fills the whole field so
      // it is 0..N-1. (Without this, drops would land in unused cells on small
      // rigs and the blooms would never read — the test_bench regression.)
      var headSpan = maxIdx;
      if (headSpan > N - 1) headSpan = N - 1;
      if (headSpan < 1) headSpan = 1;
      var center = floor(hp * headSpan + 0.5);
      if (center < 0) center = 0;
      if (center > N - 1) center = N - 1;          // hard buffer guard (< N)
      // brighter ink on strong highs — steep in `ink` so total brightness
      // tracks the signal (corr), modest floor so silence/low-highs stay dim.
      var amt = 0.35 + ink * 1.05;
      // seed a soft 5-cell bloom so diffusion has a wide core to spread —
      // a wider magenta footprint keeps the ink colour present across the rig.
      // Buffer is NOT clamped here: gentle headroom lets total brightness keep
      // rising with sustained highs instead of pinning flat (render clamps for
      // display). Cap modestly so a single cell can't run away.
      // Neighbour writes guarded < N so every access stays in-bounds.
      buf[center] = buf[center] + amt;     if (buf[center] > 1.9) buf[center] = 1.9;
      if (center > 0)     buf[center - 1] = buf[center - 1] + amt * 0.60;
      if (center < N - 1) buf[center + 1] = buf[center + 1] + amt * 0.60;
      if (center > 1)     buf[center - 2] = buf[center - 2] + amt * 0.30;
      if (center < N - 2) buf[center + 2] = buf[center + 2] + amt * 0.30;
    }
    if (dropClock > 2.0) dropClock = 2.0;        // cap backlog
  } else {
    if (dropClock > 1.0) dropClock = 1.0;        // don't bank drops while silent
  }
}

export function render3D(index, x, y, z) {
  // Learn the live rig's pixel span (highest index) so the index->cell map
  // below spans the whole virtual field on any rig. pixelCount is unusable
  // (compiles to a literal 144), so we measure the real span here.
  if (index > nextMaxIdx) nextMaxIdx = index;

  // Map this pixel's index into the fixed virtual diffusion field. When the rig
  // fits inside the field (index < N — test_bench 52, logsville 216) the map is
  // 1:1 so the look is IDENTICAL to the original per-pixel buffer. When the rig
  // is larger than the field (titanic 970, dome 266) the index is compressed
  // into the N cells (index/maxIdx -> 0..N-1) so the SAME bounded field still
  // drives every pixel. Guarded < N.
  var cell = index;
  if (maxIdx > N - 1) {
    var span = maxIdx; if (span < 1) span = 1;
    cell = floor(index * (N - 1) / span + 0.5);
  }
  if (cell < 0) cell = 0;
  if (cell > N - 1) cell = N - 1;

  var conc = 0.0;
  if (cell >= 0 && cell < N) conc = buf[cell];

  // ── WATER layer (cp1, deep blue): a DIM resting wash so still water reads
  //    blue without swamping the ink. Kept low (and the sheen tighter) so that
  //    inked cells are clearly the brightest thing on the rig — that contrast
  //    is what lets the magenta ink dominate the colour mix (high hueSpread). ──
  // Faint, slow resting shimmer so still water is never pure black (P0). The
  // `base` floor stays constant (silence-safe), but a PRIMARY flow(micLow) glow
  // is layered on top so the whole blue water sheet brightens with the low band
  // -> overall rig brightness tracks micLow hard (corr >= 0.5).
  var faint = base * (0.30 + 0.70 * wave(faintPhase + index * 0.013));
  var primaryGlow = waterGlow * 0.55 * (0.45 + 0.55 * wave(faintPhase * 1.3 + index * 0.021));
  // ...plus a gentle "wet sheen" that tracks `ink` (micHigh) the same frame it
  // changes, so highs add a sparkle lift independent of the low-band glow.
  // All ride strictly on cp1 so water stays blue.
  var sheen = ink * 0.20 * (0.25 + 0.75 * wave(faintPhase * 1.7 + index * 0.05));
  var waterBri = faint + primaryGlow + sheen;

  // ── INK layer (blends cp1 -> cp2 by concentration): vivid magenta clouds ──
  // tcol snaps to cp2 for ANY meaningful concentration, so the whole diffused
  // cloud (core AND feathered tail) reads magenta, not just the hot center —
  // this is what gives the rig a large magenta area against the blue water and
  // pushes hueSpread well over the gate. inkBri is lifted so blooms are the
  // brightest, most saturated thing on the rig.
  var tcol = clamp01(conc * 15.0);                // any ink edge -> magenta fast
  var inkBri = conc * 1.70;                       // lifted core so magenta blooms out-punch the brighter water

  // Composite: take the brighter of water vs ink so the field is crisp, but
  // colour follows whichever is dominant (water=cp1, ink=cp1->cp2 by tcol).
  var bri = waterBri;
  var blend = 0.0;                                // 0 = pure cp1 (water)
  if (inkBri > waterBri) {
    bri = inkBri;
    blend = tcol;                                 // ink hue rises with conc
  } else {
    // where water dominates keep it pure blue (cp1) for maximum colour split
    blend = 0.0;
  }

  if (bri < BASE_FLOOR) bri = BASE_FLOOR;
  bri = clamp01(bri);

  var r = (pr1 + (pr2 - pr1) * blend) * bri;
  var g = (pg1 + (pg2 - pg1) * blend) * bri;
  var b = (pb1 + (pb2 - pb1) * blend) * bri;

  rgb(clamp01(r), clamp01(g), clamp01(b));
}
