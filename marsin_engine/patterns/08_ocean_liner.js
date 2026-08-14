/*
  08_ocean_liner.js — "Ocean Liner Nocturne"

  A calm deep-water hull wash with discrete warm portholes. Bars carry the water,
  strands trace the silhouette, and Vintage rails carry the hot cabin lights.
  The pattern is portable because authorship follows fixture capabilities.

  Direction is fixed near the operator-approved 0.75 setting; it was not a useful
  live control. The localSpeed curve is shifted so 0.30 now reproduces the former
  ambient motion at 0.49 while leaving substantially more fast range above it.
  Detail clearly changes porthole count/texture. Kick is one decisive porthole
  flare in both color and white. PortholeWhite is the only white control: zero
  emits no white, and white is authored only on Vintage fixtures.

AUDIO_MODULATION_V1:
  sliderLevel         <- micLow  range 0.30..1.00 curve linear  # water + porthole brightness
  sliderKick          <- micKick range 0.00..1.00 curve pow2    # decisive porthole flare
  sliderDetail        <- micHigh range 0.20..0.95 curve linear  # porthole count/texture
  # STATIC (omit from audio): localSpeed, portholeWhite, colorPalette1/2
*/

// ── Exported controls (UI order = declaration order) ────────────────────────
// Canonical append-only optional fixture roles; absent roles match no pixels.
var FIX_RAW_LED = 1;
var FIX_TE_SIGN = 7;

export var localSpeed = 0.5;
export var level = 0.5;           // AUDIO PRIMARY: whole-look brightness
export var kick = 0.5;            // AUDIO: colored + white porthole flare
export var detail = 0.5;          // AUDIO: porthole count / texture
export var portholeWhite = 0.5;   // WHITE: Vintage-only cabin-light amount

export var cp1H = 0.60, cp1S = 1.0, cp1V = 1.0; // water (deep blue)
export var cp2H = 0.10, cp2S = 0.9, cp2V = 1.0; // porthole (warm amber)
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderLevel(v) { level = v; }
export function sliderKick(v) { kick = v; }
export function sliderDetail(v) { detail = v; }
export function sliderPortholeWhite(v) { portholeWhite = v; }

// ── Tunables ────────────────────────────────────────────────────────────────
var WATER_RATE = 0.45;      // visibly directional hull-current drift
                            // mean steady (clean PRIMARY corr) while the deep
                            // spatial trough still reads high-def
var PORT_RATE = 0.30;       // porthole travel per second at localSpeed = 1.0
var PHASE_WRAP = 10000.0;
var BASE_FLOOR = 0.05;      // calm non-black base in silence
var FIXED_DIRECTION_RATE = 0.50; // equivalent to the approved direction ~= 0.75
var PORTHOLE_SPREAD = 0.08;     // preserves the approved former Radius setting
var WHITE_SPREAD = 0.79;        // preserves the approved broad cabin-light core

// ── Palette RGB cache ─────────────────────────────────────────────────────────
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
// Start mid-wrap for a long continuous launch window.
var waterPhase = 5000.0;
var portPhase = 5000.0;

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  _hsv2rgb1();
  _hsv2rgb2();

  // Shifted calibration: 0.30 now equals the former 0.49 ambient rate.
  // The wider upper range gives the same pattern useful faster settings.
  var localMultiplier = pow(2.0, (localSpeed - 0.31) * 4.0);
  var rate = 0.06 + 0.94 * localMultiplier;

  waterPhase = waterPhase + dt * rate * WATER_RATE * FIXED_DIRECTION_RATE;
  if (waterPhase >= PHASE_WRAP) waterPhase = waterPhase - PHASE_WRAP;
  else if (waterPhase < 0.0) waterPhase = waterPhase + PHASE_WRAP;

  portPhase = portPhase + dt * rate * PORT_RATE * 1.41421 * FIXED_DIRECTION_RATE; // √2
  if (portPhase >= PHASE_WRAP) portPhase = portPhase - PHASE_WRAP;
  else if (portPhase < 0.0) portPhase = portPhase + PHASE_WRAP;
}

export function render3D(index, wx, wy, wz) {
  var nx = wx; if (nx < 0.0) nx = 0.0; else if (nx > 1.0) nx = 1.0;
  var ny = wy; if (ny < 0.0) ny = 0.0; else if (ny > 1.0) ny = 1.0;
  var nz = wz; if (nz < 0.0) nz = 0.0; else if (nz > 1.0) nz = 1.0;

  // Calm water wash (cp1), near-uniform per frame so total brightness tracks
  // `level`. A high-frequency travelling ripple gives life that averages out
  // across the rig (no rig-wide brightness pulse → clean PRIMARY correlation).
  // HD CONTRAST: the ripple is gamma-shaped (pow 1.8) so the dark-water troughs
  // sit DEEPER (high-def, not a flat midtone wash) while the crests still catch
  // light — a sharper water relief. A small floor keeps the deep water visible,
  // never an artificial black hole (silence stays calm-but-visible).
  // HD CONTRAST without temporal wobble: deepen the spatial trough using a
  // gamma on a HIGH SPATIAL-FREQUENCY ripple (many cycles across the rig) so the
  // rig-wide MEAN stays ~constant frame to frame (clean PRIMARY corr) while the
  // pixel-to-pixel relief reads deep & high-def. A small floor keeps the deep
  // water visible — never an artificial black hole.
  var ripple = 0.5 + 0.5 * sin((waterPhase + nx * 5.7 + ny * 3.3) * PI2);
  var rippleHD = pow(ripple, 1.7);        // deepen troughs, keep crests bright
  var waterStruct = 0.55 + 0.45 * rippleHD; // lit blue wash (og), ripple relief on top
  // A broad current band makes the fixed ship-scale travel readable while the
  // fine ripple keeps the water texture.
  var currentBand = wave(nx * 0.85 - waterPhase * 1.7);
  waterStruct = waterStruct * (0.58 + currentBand * 0.42);

  // Portholes (cp2): Detail now has one coherent role—low values produce
  // fewer, softer cabin lights; high values produce more crisp points.
  // The misleading Radius knob is gone; its approved .08 spacing is retained.
  var hashp = (index * 0.61803 + nx * 5.0 + ny * 2.0);
  hashp = hashp - floor(hashp);
  var glow = portPhase + hashp
           + nx * (0.5 + PORTHOLE_SPREAD * 6.0)
           + ny * PORTHOLE_SPREAD * 2.2;
  var pw = 0.5 + 0.5 * sin(glow * PI2);
  var sharp = 7.0 + detail * 18.0;
  var port = pow(pw, sharp);
  // A wider reflection around each crisp porthole gives the hull bars enough
  // secondary-palette area to read clearly against the deep water color.
  var portHalo = pow(pw, 3.0 + detail * 4.0);
  var elig = 0.5 + 0.5 * sin((hashp * 13.0 + 0.21) * PI2);
  if (elig < (1.0 - (0.10 + detail * 0.75))) port = port * 0.02;

  // PRIMARY audio: one level gain on the whole pixel. BASE_FLOOR keeps a calm
  // visible base in silence (mission-critical).
  var gain = 0.08 + level * 0.72;
  var kickPop = clamp01(kick);
  var kickShape = kickPop * (2.0 - kickPop);

  // HD CONTRAST: the deep water trough carries the calm budget; the porthole
  // cores ride HOTTER on top so the bright/dark ratio reads high-def rather than
  // flat. Water gain is trimmed slightly (deeper trough) and the porthole cores
  // are lifted, widening the contrast without carving black holes.
  // Lit blue wash (og): water carries a bright base on top of the level gain so
  // the default nocturne reads as lit blue water, not near-black; `level` scales it.
  // Portable instrument roles: bars carry the hull water; raw strands trace a
  // dim outline; Vintage rails are the portholes; signs remain readable.
  var waterRole = 0.24;
  var portRole = 0.10;
  if (fixtureType == FIX_BAR_18) {
    waterRole = 1.0;
    portRole = 0.20;
  } else if (fixtureType == FIX_RAW_LED) {
    waterRole = 0.38;
    portRole = 0.14;
  } else if (fixtureType == FIX_VINTAGE_6) {
    waterRole = 0.16;
    portRole = 1.0;
  } else if (fixtureType == FIX_PAR) {
    waterRole = 0.34;
    portRole = 0.52;
  } else if (fixtureType == FIX_TE_SIGN) {
    waterRole = 0.28;
    portRole = 0.08;
  }
  var kickRole = 0.08;
  if (fixtureType == FIX_VINTAGE_6) kickRole = 1.0;
  else if (fixtureType == FIX_PAR) kickRole = 0.65;
  else if (fixtureType == FIX_RAW_LED) kickRole = 0.18;
  else if (fixtureType == FIX_BAR_18) kickRole = 0.10;
  var waterBright = 0.16 + 0.54 * gain;
  var waterV = waterStruct * waterBright * waterRole * 0.94;
  // Porthole cores ride hotter for HD contrast; the kick flare is kept modest so
  // the core brightness budget still tracks `level` (clean PRIMARY correlation).
  // Portholes ride HOT so they punch clearly through the lit blue water (og had
  // bright water AND distinct bright portholes — keep the two-colour contrast).
  var portV = port * portRole * (1.25 + PORTHOLE_SPREAD * 0.75)
            * (0.40 + 0.60 * gain) * (1.0 + kickShape * 1.60)
            + kickShape * kickRole * 0.60;
  if (fixtureType == FIX_BAR_18) {
    // Broad amber cabin-light reflections alternate with the blue water on the
    // hull canvas; the sharp portholes remain independently visible on top.
    portV = portV + portHalo * (0.18 + detail * 0.34)
          * (0.45 + gain * 0.55);
  }

  // Two-colour: water = cp1, portholes = cp2, summed channel-wise (RGB blend).
  var r = clamp01(pr1 * waterV + pr2 * portV);
  var g = clamp01(pg1 * waterV + pg2 * portV);
  var b = clamp01(pb1 * waterV + pb2 * portV);
  if (fixtureType == FIX_BAR_18) {
    g = clamp01(g + b * 0.22);
    b = b * 0.76;
  } else if (fixtureType == FIX_PAR) {
    r = clamp01(r + portV * 0.15);
    g = clamp01(g + portV * 0.07);
    b = b * 0.58;
  } else if (fixtureType == FIX_TE_SIGN) {
    // Identity is a readable liner crest rather than a dim copy of the water
    // wash. A calm XYZ tide crosses the physical letters while a separately
    // moving chain of soft porthole pools reveals their internal pixel path.
    // Both clocks use integer wrap multipliers, so a phase wrap cannot jump.
    var signTide = wave(nx * 0.79 + ny * 1.37 - nz * 0.51
                      - waterPhase + pixelLocalIndex * 0.008);
    var signPortWave = wave(portPhase * 2.0 + nx * 0.31 - ny * 0.57
                          + nz * 0.83 + pixelLocalIndex * 0.021);
    var signPort = pow(signPortWave, 3.2);
    var signV = (0.34 + signTide * 0.18 + signPort * 0.11
                + currentBand * 0.025)
              * (0.78 + level * 0.22);
    var signMix = clamp01(0.07 + signTide * 0.16 + signPort * 0.54);
    r = (pr1 + (pr2 - pr1) * signMix) * signV;
    g = (pg1 + (pg2 - pg1) * signMix) * signV;
    b = (pb1 + (pb2 - pb1) * signMix) * signV;
  }

  // One honest white control: Vintage-only matched W+A cabin lights.
  // Kick strengthens those same cores, replacing the redundant WhiteKick knob.
  var outW = 0.0;
  if (fixtureType == FIX_VINTAGE_6) {
    var coreGate = pow(port, 4.5 - WHITE_SPREAD * 4.2);
    var whiteCore = coreGate * (1.0 + kickShape * 0.90)
                  + kickShape * 0.42;
    // 2.95 preserves the approved white level near saved Level=.22 while
    // keeping the complete cabin-light output honestly coupled to Level.
    outW = clamp01(whiteCore * clamp01(portholeWhite) * 1.25
                 * gain * 2.95);
    r = clamp01(r + outW * 0.17);
    g = clamp01(g + outW * 0.07);
  }

  // LANE MATCH (w == a): the bare W emitter reads cold and the bare A emitter
  // reads yellow — matched W+A is the ship's warm white, and it is what the LED
  // strands already render (they fold amber into RGB). Convention:
  // docs/MARSIN_ENGINE_PATTERNS.md -> "White handling: the w == a convention".
  rgbwau(r, g, b, outW, outW, 0.0);
}
