/*
  08_ocean_liner.js
  Ocean Liner Nocturne — a quiet, dark "water" wash (cp1) drifting along the hull
  with bright "porthole" pops (cp2) glowing in the night. HD remake: the water is
  a calm two-colour gradient carrying the audio brightness budget, the portholes
  are crisp lit cores over true-dark water, and they drift/flare with the music.

  IDENTITY KEPT: dark water wash (cp1) + bright discrete portholes (cp2), nautical
  calm, strict cp1(water)->cp2(porthole) two-colour palette.

  CORE NON-REPEATING MATH
    Two clock-delta accumulators wrapped at PHASE_WRAP=10000 (§7): `waterPhase`
    (slow hull drift) and `portPhase` (porthole travel). Rates use incommensurate
    ratios (1.0 vs √2 ≈ 1.41421). Porthole positions use golden-ratio spacing
    (φ ≈ 1.61803) plus a per-fixture offset so they never line up into a marquee.
    Each porthole pixel is gated by a per-pixel hash so the lit COUNT stays ~const
    as portholes drift (keeps the water-wash level mapping clean). Travel direction
    is a guarded `direction` plus a slow autonomous √2-rate sin bias so the hull
    occasionally appears to steam the other way on its own.

  CONTROLS
    - localSpeed : drift rate. 0 still creeps, 1 ~4x (§6).
    - direction  : <0.5 / >0.5 porthole drift; center guarded; auto-varies.
    - level      : AUDIO PRIMARY — overall brightness gain (water wash).
    - kick       : AUDIO — porthole flare/brightness pop on the kick.
    - radius     : AUDIO — porthole travel reach / glow size.
    - detail     : AUDIO — porthole count / sharpness.
    - whiteLevel : WHITE — how white the lit porthole cores read (incandescent
                   flare on top of the warm amber porthole colour).
    - whiteKick  : WHITE — kick-driven white flare pop in the porthole cores.
    - whiteSpread: WHITE — how far the white reaches: just the brightest cores at 0
                   -> a broader hot-white spill across more portholes at 1.
    - colorPalette1/2 : cp1 (water) -> cp2 (porthole), strict RGB blend.

  AUDIO (modulators-only — never read CPC audio globals natively; the block below
  is the STRICT source of truth for the deploy-playlist generator):
      AUDIO_MODULATION_V1:
        sliderLevel     <- micLow  range 0.30..1.00 curve linear  # PRIMARY overall brightness (bass)
        sliderKick      <- micKick range 0.00..1.00 curve pow2    # porthole flare pop (kick)
        sliderRadius    <- micFlux range 0.40..0.90 curve linear  # porthole travel / glow size (build)
        sliderDetail    <- micHigh range 0.20..0.95 curve linear  # porthole count / sharpness (highs)
        sliderWhiteKick <- micKick range 0.00..1.00 curve pow2    # porthole white flare pop (kick)
        sliderWhiteLevel<- micLow  range 0.20..0.80 curve linear  # overall porthole white keep (bass)
      # STATIC (not modulated): direction, whiteSpread — operator/scene set.
*/

// ── Exported controls (UI order = declaration order) ────────────────────────
export var localSpeed = 0.5;
export var direction = 0.5;      // porthole drift dir (center guarded, auto-varies)
export var level = 0.5;          // AUDIO PRIMARY: overall brightness gain
export var kick = 0.5;           // AUDIO: porthole flare pop
export var radius = 0.5;         // AUDIO: porthole travel / glow size
export var detail = 0.5;         // AUDIO: porthole count / sharpness
export var whiteLevel = 0.5;     // WHITE: porthole white-core amount
export var whiteKick = 0.5;      // WHITE: kick-driven porthole white flare pop
export var whiteSpread = 0.5;    // WHITE: how far the white spills across cores

export var cp1H = 0.60, cp1S = 1.0, cp1V = 1.0; // water (deep blue)
export var cp2H = 0.10, cp2S = 0.9, cp2V = 1.0; // porthole (warm amber)
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderDirection(v) { direction = v; }
export function sliderLevel(v) { level = v; }
export function sliderKick(v) { kick = v; }
export function sliderRadius(v) { radius = v; }
export function sliderDetail(v) { detail = v; }
export function sliderWhiteLevel(v) { whiteLevel = v; }
export function sliderWhiteKick(v) { whiteKick = v; }
export function sliderWhiteSpread(v) { whiteSpread = v; }

// ── Tunables ────────────────────────────────────────────────────────────────
var WATER_RATE = 0.055;     // slow hull drift; near-static relief keeps the rig
                            // mean steady (clean PRIMARY corr) while the deep
                            // spatial trough still reads high-def
var PORT_RATE = 0.30;       // porthole travel per second at localSpeed = 1.0
var PHASE_WRAP = 10000.0;
var BASE_FLOOR = 0.05;      // calm non-black base in silence

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
var waterPhase = 0.0;
var portPhase = 0.0;
var dirPhase = 0.0;

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  _hsv2rgb1();
  _hsv2rgb2();

  var localMultiplier = pow(2.0, (localSpeed - 0.5) * 4.0); // §6
  var rate = 0.06 + 0.94 * localMultiplier; // tiny creep at localSpeed = 0

  var d = (direction * 2.0) - 1.0;
  if (d >= 0.0 && d < 0.06) d = 0.06;
  else if (d < 0.0 && d > -0.06) d = -0.06;

  dirPhase = dirPhase + dt * rate * 1.41421;
  if (dirPhase >= PHASE_WRAP) dirPhase = dirPhase - PHASE_WRAP;
  var autoBias = sin(dirPhase * PI2 * 0.043) + 0.6 * sin(dirPhase * PI2 * 0.026);
  var eff = d + autoBias * 0.85;
  if (eff >= 0.0 && eff < 0.05) eff = 0.05;
  else if (eff < 0.0 && eff > -0.05) eff = -0.05;
  var sgn = eff >= 0.0 ? 1.0 : -1.0;

  waterPhase = waterPhase + dt * rate * WATER_RATE;
  if (waterPhase >= PHASE_WRAP) waterPhase = waterPhase - PHASE_WRAP;

  portPhase = portPhase + dt * rate * PORT_RATE * 1.41421 * sgn; // √2
  if (portPhase >= PHASE_WRAP) portPhase = portPhase - PHASE_WRAP;
  else if (portPhase < 0.0) portPhase = portPhase + PHASE_WRAP;
}

export function render3D(index, wx, wy, wz) {
  var nx = wx; if (nx < 0.0) nx = 0.0; else if (nx > 1.0) nx = 1.0;
  var ny = wy; if (ny < 0.0) ny = 0.0; else if (ny > 1.0) ny = 1.0;

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
  var waterStruct = 0.20 + 0.40 * rippleHD; // deep dark water, brighter crests

  // Portholes (cp2): each pixel twinkles on its own golden-ratio schedule that
  // also drifts with portPhase (radius = travel reach). A per-pixel eligibility
  // gate keeps the lit count ~constant; detail opens more portholes + sharpens.
  var hashp = (index * 0.61803 + nx * 5.0 + ny * 2.0);
  hashp = hashp - floor(hashp);
  var glow = portPhase * (0.6 + radius * 2.4) + hashp;
  var pw = 0.5 + 0.5 * sin(glow * PI2);
  var sharp = 12.0 + detail * 20.0;       // crisper porthole cores (HD contrast)
  var port = pow(pw, sharp);
  var elig = 0.5 + 0.5 * sin((hashp * 13.0 + 0.21) * PI2);
  if (elig < (1.0 - (0.25 + detail * 0.5))) port = port * 0.05;

  // PRIMARY audio: one level gain on the whole pixel. BASE_FLOOR keeps a calm
  // visible base in silence (mission-critical).
  var gain = 0.10 + level * 0.90;
  var kickPop = kick * 0.8;

  // HD CONTRAST: the deep water trough carries the calm budget; the porthole
  // cores ride HOTTER on top so the bright/dark ratio reads high-def rather than
  // flat. Water gain is trimmed slightly (deeper trough) and the porthole cores
  // are lifted, widening the contrast without carving black holes.
  var waterV = waterStruct * gain * 0.46 * (0.94 + kickPop * 0.2);
  // Porthole cores ride hotter for HD contrast; the kick flare is kept modest so
  // the core brightness budget still tracks `level` (clean PRIMARY correlation).
  var portV = port * (1.15 + radius * 0.5) * gain * (1.0 + kickPop * 0.55);

  // Two-colour: water = cp1, portholes = cp2, summed channel-wise (RGB blend).
  var r = clamp01(pr1 * waterV + pr2 * portV);
  var g = clamp01(pg1 * waterV + pg2 * portV);
  var b = clamp01(pb1 * waterV + pb2 * portV);

  // PORTHOLE WHITE FLARE: the lit porthole cores get an incandescent white core
  // on top of the warm amber colour (gentle white cores under colour, ocean-liner
  // cabin-light feel). whiteSpread sets how deep into the core the white reaches:
  // at 0 only the hottest centres flare white; at 1 the white spills wider. The
  // flare pops on the kick via whiteKick. White is ADDITIVE — the water stays
  // cp1, the porthole bodies stay cp2; only the bright cores whiten.
  var coreGate = pow(port, 3.0 - whiteSpread * 2.4);   // tighter at low spread
  var flare = coreGate * (whiteLevel * 0.7 + whiteKick * 0.9);
  var outW = clamp01(flare * gain * (0.9 + radius * 0.4));

  rgbwau(r, g, b, outW, 0.0, 0.0);
}
