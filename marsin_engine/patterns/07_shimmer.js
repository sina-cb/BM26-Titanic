/*
  07_shimmer.js
  Shimmering Glow — a warm, slow-breathing ambient wash (cp1) overlaid with
  crisp travelling shimmer glints (cp2), like candlelight on water. HD remake:
  the glints are sharp pow-shaped cores over a calm two-colour wash, the wash
  carries the audio brightness budget, and the glint field drifts and reverses
  organically so it never reads as a fixed marquee.

  IDENTITY KEPT: warm breathing base wash + fine shimmer glints, cp1 (wash) ->
  cp2 (glint) palette, soft calm feel.

  CORE NON-REPEATING MATH
    Two independent accumulators advanced by the pre-scaled clock delta and
    wrapped at PHASE_WRAP=10000 (§7): `breathPhase` (slow swell) and
    `shimmerPhase` (fast glints). Their rates use incommensurate ratios (1.0 vs
    √3 ≈ 1.73205) so swell and shimmer never re-lock. The glint spatial frequency
    uses golden-angle-ish spacing across the rig. Glint travel direction is set
    by a guarded `direction` plus a slow autonomous bias (sin on √2-rate drift)
    so the shimmer occasionally reverses on its own, out of lockstep.

  CONTROLS
    - localSpeed : breathing/shimmer rate. 0 still creeps, 1 ~4x (§6).
    - direction  : <0.5 glints drift one way, >0.5 the other; center guarded;
                   auto-varies on its own.
    - level      : AUDIO PRIMARY — overall brightness gain (level-driven wash).
    - detail     : AUDIO — shimmer glint sharpness/density (highs/sparkle).
    - radius     : AUDIO — how far glints travel per breath / glint reach.
    - kick       : AUDIO — brightness pop on the kick.
    - colorPalette1/2 : cp1 (wash) -> cp2 (glint), strict RGB blend.

  AUDIO (modulators-only — never read CPC audio globals natively):
      MODULATE sliderLevel  (level)  <- micLow    // PRIMARY -> overall brightness
      MODULATE sliderDetail (detail) <- micHigh   // shimmer sparkle
      MODULATE sliderRadius (radius) <- micFlux   // glint reach / travel
      MODULATE sliderKick   (kick)   <- micKick   // brightness pop
*/

// ── Exported controls (UI order = declaration order) ────────────────────────
export var localSpeed = 0.5;
export var direction = 0.7;      // glint drift dir (center guarded, auto-varies)
export var level = 0.7;          // AUDIO PRIMARY: overall brightness gain
export var detail = 0.4;         // AUDIO: shimmer sharpness / density
export var radius = 0.4;         // AUDIO: glint travel reach
export var kick = 0.0;           // AUDIO: kick brightness pop

export var cp1H = 0.08, cp1S = 1.0, cp1V = 1.0; // base wash (warm amber)
export var cp2H = 0.52, cp2S = 0.85, cp2V = 1.0; // shimmer glints (cool moonlight)
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderDirection(v) { direction = v; }
export function sliderLevel(v) { level = v; }
export function sliderDetail(v) { detail = v; }
export function sliderRadius(v) { radius = v; }
export function sliderKick(v) { kick = v; }

// ── Tunables ────────────────────────────────────────────────────────────────
var BREATH_RATE = 0.12;     // breaths per second at localSpeed = 1.0
var SHIMMER_RATE = 0.55;    // glint drift per second at localSpeed = 1.0
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
var breathPhase = 0.0;
var shimmerPhase = 0.0;
var dirPhase = 0.0;
var glintDrift = 0.0; // resolved signed glint drift this frame

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  _hsv2rgb1();
  _hsv2rgb2();

  var localMultiplier = pow(2.0, (localSpeed - 0.5) * 4.0); // §6
  var rate = 0.06 + 0.94 * localMultiplier; // tiny creep at localSpeed = 0

  // Manual direction with slider-center freeze guard (§6).
  var d = (direction * 2.0) - 1.0;
  if (d >= 0.0 && d < 0.06) d = 0.06;
  else if (d < 0.0 && d > -0.06) d = -0.06;

  // Autonomous organic direction variation (incommensurate √2 drift).
  dirPhase = dirPhase + dt * rate * 1.41421;
  if (dirPhase >= PHASE_WRAP) dirPhase = dirPhase - PHASE_WRAP;
  var autoBias = sin(dirPhase * PI2 * 0.05) + 0.6 * sin(dirPhase * PI2 * 0.029);
  var eff = d + autoBias * 0.85;
  if (eff >= 0.0 && eff < 0.05) eff = 0.05;
  else if (eff < 0.0 && eff > -0.05) eff = -0.05;
  var sgn = eff >= 0.0 ? 1.0 : -1.0;

  breathPhase = breathPhase + dt * rate * BREATH_RATE;          // rate ×1.0
  if (breathPhase >= PHASE_WRAP) breathPhase = breathPhase - PHASE_WRAP;

  shimmerPhase = shimmerPhase + dt * rate * SHIMMER_RATE * 1.73205 * sgn; // √3
  if (shimmerPhase >= PHASE_WRAP) shimmerPhase = shimmerPhase - PHASE_WRAP;
  else if (shimmerPhase < 0.0) shimmerPhase = shimmerPhase + PHASE_WRAP;

  glintDrift = shimmerPhase;
}

export function render3D(index, wx, wy, wz) {
  // Spatial coordinate along the rig (use x for horizontal flow; clamp 0..1).
  var nx = wx;
  if (nx < 0.0) nx = 0.0; else if (nx > 1.0) nx = 1.0;
  var ny = wy;
  if (ny < 0.0) ny = 0.0; else if (ny > 1.0) ny = 1.0;

  // Slow breathing wash (cp1). A gentle spatial gradient keeps it alive even
  // when frozen, and the swell is driven by breathPhase.
  // Wash brightness is spatially near-uniform per frame (so total rig brightness
  // tracks `level`, not animation phase). The "breathing" lives as a gentle
  // per-pixel SHIMMER of brightness that averages out across the rig, plus the
  // travelling glints below — the look moves without total-brightness wobble.
  var breathe = 0.5 + 0.5 * sin((breathPhase + nx * 2.7 + ny * 1.3) * PI2);
  var washStruct = 0.80 + 0.20 * breathe; // mostly uniform; small live shimmer

  // Crisp shimmer glints (cp2): each pixel twinkles on its OWN incommensurate
  // schedule (per-pixel hash phase), so the count lit stays ~constant as glints
  // come and go — no coherent rig-wide pulse to decorrelate the PRIMARY. The
  // glint field also DRIFTS spatially with glintDrift (radius = travel reach).
  var hashp = (index * 0.61803 + nx * 7.0 + ny * 3.0);
  hashp = hashp - floor(hashp);
  var tw = glintDrift * (1.0 + radius * 3.0) + hashp;
  var sWave = 0.5 + 0.5 * sin(tw * PI2);
  var sharp = 6.0 + detail * 18.0;     // higher detail = sharper, sparklier
  var glint = pow(sWave, sharp);
  // detail also raises how many pixels are eligible to glint (density feel).
  var elig = 0.5 + 0.5 * sin((hashp * 11.0 + 0.37) * PI2);
  if (elig < (1.0 - (0.3 + detail * 0.6))) glint = glint * 0.15;

  // PRIMARY audio: one level-driven gain on the whole pixel so total brightness
  // tracks level (not animation phase). BASE_FLOOR keeps silence calm/visible.
  var gain = BASE_FLOOR + level * 0.95;

  // Glint amount adds the cp2 colour on top of the wash; kick gives a uniform
  // brightness pop (gain-scaled so it doesn't decorrelate the PRIMARY).
  var glintAmt = glint * (1.0 + radius * 0.5);
  var kickPop = kick * 0.7;

  var washV = washStruct * gain * 0.55 * (0.9 + kickPop * 0.4);
  var glintV = glintAmt * gain * (1.0 + kickPop);

  // Two-colour: wash = cp1, glint = cp2, summed channel-wise (blend in RGB).
  var r = clamp01(pr1 * washV + pr2 * glintV);
  var g = clamp01(pg1 * washV + pg2 * glintV);
  var b = clamp01(pb1 * washV + pb2 * glintV);

  // A whisper of amber warmth on the vintage heads keeps the candlelight feel.
  var outA = (sectionId == 2) ? clamp01(washV * 0.2) : 0.0;

  rgbwau(r, g, b, 0.0, outA, 0.0);
}
