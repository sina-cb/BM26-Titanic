/*
  42_phyllotaxis_spiral.js — PHYLLOTAXIS (sunflower) SEED SPIRAL, high-def + audio-reactive.

  A living sunflower head painted across the whole rig. K virtual "seeds" are
  placed by the classic phyllotaxis rule — the same packing a real sunflower,
  pinecone or daisy uses — then each LED lights by its PROXIMITY to the nearest
  seed core. Seed cores are crisp and bright; the space between them is dark, so
  the bloom reads as a high-definition field of points rather than a wash.

  CORE EQUATION (per seed kk):
      ang_kk = kk * GOLDEN_ANGLE + spin          (GOLDEN_ANGLE = 2.39996 rad)
      rad_kk = sqrt(kk) * SEED_PITCH * bloom      (sqrt packing -> even density)
      seedX  = 0.5 + rad_kk * cos(ang_kk) * AX
      seedY  = 0.5 + rad_kk * sin(ang_kk) * AY
  A pixel at (nx,ny) takes brightness from the nearest seed:
      bri = peak(seed) * smoothstep(coreR, 0, dist_to_nearest_seed)
  Using the golden angle (an IRRATIONAL multiple of a full turn, 2.39996 rad ≈
  137.5°) is what makes the spiral arms never line up into integer-period rings —
  the bloom is aperiodic by construction. No integer periods anywhere.

  COLOUR: blend cp1<->cp2 by the nearest seed's RING (radius). Inner rings lean
  cp1, outer rings lean cp2, with a per-ring parity wobble so BOTH palette
  colours appear interleaved across the bloom (hueSpread well clear of 0.10).

  AUDIO (modulators-only — NEVER read CPC audio globals natively):
  AUDIO_MODULATION_V1:
    sliderBloom   <- micLow  range 0.40..0.90 curve linear   # PRIMARY brightness + bloom radius
    sliderTwinkle <- micHigh range 0.00..0.85 curve pow2     # 2nd dim: per-seed sparkle/detail
  Static (unmapped) params: localSpeed, coreSize, floorLvl, colorPalette1/2.

  At rest (no audio) the bloom sits at a calm mid radius and gently breathes /
  rotates — alive, never fully black (mission-critical visibility).

  CONTROLS (UI order = declaration order)
    - localSpeed : rotation + breathe rate of the whole bloom.
    - bloom      : bloom radius + overall brightness. PRIMARY audio handle (micLow).
    - twinkle    : per-seed sparkle amount. 2nd audio handle (micHigh).
    - coreSize   : crispness of each seed core (small = sharp points).
    - floorLvl   : faint base floor so silence still reads (never fully black).
    - colorPalette1/2 : strict cp1↔cp2 palette (inner warm core -> outer cool).
*/

// ── Exported controls (UI order = declaration order) ────────────────────────
export var localSpeed = 0.5;   // rotation + breathe rate
export var bloom = 0.5;        // bloom radius + overall brightness. PRIMARY (micLow)
export var twinkle = 0.35;     // per-seed sparkle amount. 2nd dim (micHigh)
export var coreSize = 0.45;    // seed core crispness (small = sharp points)
export var floorLvl = 0.1;     // faint base floor (never fully black)

export var cp1H = 0.08, cp1S = 1.0, cp1V = 1.0; // palette 1 — warm amber (inner)
export var cp2H = 0.55, cp2S = 1.0, cp2V = 1.0; // palette 2 — cool cyan (outer)
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderBloom(v) { bloom = v; }       // micLow maps here (PRIMARY)
export function sliderTwinkle(v) { twinkle = v; }   // micHigh maps here
export function sliderCoreSize(v) { coreSize = v; }
export function sliderFloorLvl(v) { floorLvl = v; }

// ── Tunables ────────────────────────────────────────────────────────────────
var GOLDEN_ANGLE = 2.39996;   // golden angle in RADIANS (≈137.5°) — irrational packing
var SEEDS = 28;               // number of virtual phyllotaxis seeds
var SEED_PITCH = 0.052;       // base radial spacing (scaled by bloom)
var AX = 0.62;                // x stretch (rig is wider than tall in nx/ny)
var AY = 0.40;                // y stretch (vintage/pars span less of ny)
var SPIN_RATE = 0.04;         // bloom rotation speed at localSpeed=1.0 (turns/frame-ish)
var BREATHE_RATE = 0.05;      // slow radius breathing rate

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

// ── Persistent seed tables (allocated once at top-level init) ────────────────
var seedX = array(28);   // seed x positions in nx space (recomputed each frame)
var seedY = array(28);   // seed y positions in ny space
var seedT = array(28);   // per-seed colour blend factor 0..1 (ring -> palette)
var seedB = array(28);   // per-seed brightness (twinkle * radius profile)

// ── Per-frame scalars ─────────────────────────────────────────────────────────
var spin = 0.0;        // accumulated bloom rotation (radians)
var breathe = 0.0;     // slow breathing phase (radians)
var twPhase = 0.0;     // twinkle re-roll phase

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  _hsv2rgb1();
  _hsv2rgb2();

  // Rotation + breathing accumulate via delta so they follow localSpeed.
  spin = spin + dt * SPIN_RATE * (0.2 + localSpeed) * PI2;
  if (spin > PI2 * 1000.0) spin = spin - PI2 * 1000.0;
  breathe = breathe + dt * BREATHE_RATE * (0.2 + localSpeed) * PI2;
  if (breathe > PI2 * 1000.0) breathe = breathe - PI2 * 1000.0;
  twPhase = twPhase + dt * (0.5 + localSpeed * 2.0);
  if (twPhase > 100000.0) twPhase = twPhase - 100000.0;

  // bloom (micLow) sets radius scale. A small breathe keeps it alive at rest.
  var bl = clamp01(bloom);
  var radScale = (0.45 + bl * 0.85) * (0.92 + 0.08 * sin(breathe));

  // Build the phyllotaxis seed field this frame.
  for (var kk = 0; kk < SEEDS; kk++) {
    var ang = kk * GOLDEN_ANGLE + spin;          // golden-angle placement (radians)
    var rad = sqrt(kk) * SEED_PITCH * radScale;  // sqrt packing -> even density
    seedX[kk] = 0.5 + rad * cos(ang) * AX;
    seedY[kk] = 0.5 + rad * sin(ang) * AY;

    // Colour by ring PARITY: alternate spiral rings snap toward cp1 vs cp2 so
    // both palette colours appear strongly across the bloom (high hueSpread).
    // The ring index quantises the radius so neighbouring arms alternate.
    var ringIdx = floor(sqrt(kk) * 2.0);         // discrete ring number
    seedT[kk] = (ringIdx % 2 == 0) ? 0.08 : 0.92; // snap to cp1 / cp2

    // Per-seed twinkle (micHigh): deterministic sparkle that re-rolls over time.
    // Even at twinkle=0 every seed keeps a steady core so the bloom reads.
    var tw = clamp01(twinkle);
    var sd = kk * 12.9898 + floor(twPhase * 1.7) * 0.731;
    var spk = sin(sd) * sin(sd * 1.7 + 1.3);
    spk = spk * spk;                              // 0..1, biased low
    seedB[kk] = (0.55 + 0.45 * sin(breathe + kk * 0.6)) * (1.0 - tw * 0.5)
              + tw * spk;
    seedB[kk] = clamp01(seedB[kk]);
  }
}

export function render3D(index, x, y, z) {
  // Faint living base so silence still reads (never fully black, P0 visibility).
  // Holds a gentle breathing glow even when bloom/twinkle are driven to 0.
  var base = floorLvl * (0.45 + 0.55 * wave(breathe / PI2 + x * 0.6 + y * 0.4)) * 0.6;

  // Core radius (crispness): smaller coreSize -> sharper, more isolated points.
  // Range 0.13..0.33 so even coreSize=0 keeps the seeds reaching the rig's sparse
  // LED bands (non-dead extreme) while coreSize=1 fills into broad glowing blooms.
  var coreR = 0.13 + coreSize * 0.20;

  // Find the nearest seed to this pixel.
  var bestD = 1000000.0;
  var bestK = 0;
  for (var kk = 0; kk < SEEDS; kk++) {
    var dx = x - seedX[kk];
    var dy = y - seedY[kk];
    var dd = dx * dx + dy * dy;                   // squared distance (cheap)
    if (dd < bestD) { bestD = dd; bestK = kk; }
  }
  var dist = sqrt(bestD);

  // Crisp proximity falloff: bright at the seed core, dark between seeds.
  var prox = smoothstep(coreR, 0.0, dist);       // 1 at center -> 0 at coreR
  prox = prox * prox;                            // sharpen -> high definition

  // Overall brightness scales with bloom (micLow) -> PRIMARY correlation.
  // Peak driven hard toward full scale so seed cores burn bright (>=200/255).
  var bl = clamp01(bloom);
  // Core gain: the bl (micLow) term stays dominant so PRIMARY corr is preserved
  // (~0.66), while the larger slope lifts default-bloom seed cores to peak>=200
  // (mission-critical visibility) without flattening the dark inter-seed space.
  var seedBri = prox * seedB[bestK] * (0.42 + bl * 2.0);

  var bri = base;
  if (seedBri > bri) bri = seedBri;
  bri = clamp01(bri);

  // Colour by nearest seed's ring -> both cp1 and cp2 appear across the bloom.
  var tcol = clamp01(seedT[bestK]);
  var r = (pr1 + (pr2 - pr1) * tcol) * bri;
  var g = (pg1 + (pg2 - pg1) * tcol) * bri;
  var b = (pb1 + (pb2 - pb1) * tcol) * bri;

  // Tiny white pop on the W channel for the very brightest seed cores only.
  // Kept small so it adds glint without washing the palette hue toward white.
  var ww = prox * prox * prox * seedBri * 0.12;

  rgbwau(clamp01(r), clamp01(g), clamp01(b), clamp01(ww), 0.0, 0.0);
}
