/*
  21_pelagic_manta_rays.js — HD, audio-reactive oceanic manta-ray shadows.

  IDENTITY (preserved): smooth manta-ray silhouettes gliding across the rig in a
  sea<->reef palette, with white-foam crests and a UV undertow. Strict cp1<->cp2
  blended in RGB-space.

  WHAT'S NEW
    - render3D coords are 0..1 (no re-normalize — old (x+1.264)/3.125 was a
      black-rendering regression).
    - localSpeed drives delta-accumulated swim phases (creeps at 0, ~4x at 1).
    - Guarded `direction` control + AUTONOMOUS direction variation: the glide
      sign is the product of the user dir and a slow incommensurate auto-flip
      that OCCASIONALLY reverses on its own (period ~1/√7 turns), never in
      lockstep with the other patterns.
    - Audio sliders: level (PRIMARY brightness), kick (foam/brightness pop),
      radius (how far the rays travel + wing span), detail (wing-ripple sparkle).

  NON-REPEATING MATH
    Two swim phases accumulate at incommensurate rates (1.0 and 0.47), a third
    colour drift at 0.31, an auto-direction phase at 1/√7 ≈ 0.37796. Manta Y is
    sin(swimA + nx*3.6) + 0.5*sin(swimB - nx*5.0): the 3.6/5.0 spatial freqs and
    the 1.0/0.47 temporal ratio are mutually irrational so the silhouette never
    re-locks. Phases wrap at PHASE_WRAP=10000 turns (far from any in-frame use).

  AUDIO_MODULATION_V1:
    sliderLevel  <- micLow  range 0.40..1.00 curve linear # PRIMARY brightness (bass)
    sliderKick   <- micKick range 0.00..1.00 curve linear # foam / brightness pop (beat)
    sliderRadius <- micFlux range 0.40..0.90 curve linear # travel + wing span (build)
    sliderDetail <- micHigh range 0.30..0.90 curve linear # wing-ripple sparkle
  # sliderLevel range floor is 0.40 (not 0.30): below ~0.40 the dimmer manta
  # bodies stop spanning cp2 and hueSpread falls under 0.10.
  # Static (not audio-mapped): localSpeed, direction, whiteFoam, uvUndertow,
  # colorPalette1/2 — operator-set, not modulated.
*/

// ── Exported controls (UI order = declaration order) ──────────────────────────
export var localSpeed = 0.5;
export var direction = 0.75;   // 0..1; 0.5 center (guarded). >0.5 = forward glide;
                               // a directional glide is the oceanic identity (not 0.5).
export var level = 0.7;        // PRIMARY: overall brightness (audio: micLow). 0.7 not
                               // 0.5: below ~0.6 the dimmer manta bodies stop spanning
                               // cp2 and hueSpread falls under 0.10. 0.7 = lit + 2-colour.
export var kick = 0.0;         // brightness/foam pop (audio: micKick); 0 = no pop until beat
export var radius = 0.5;       // travel distance + wing span (audio: micFlux)
export var detail = 0.5;       // wing-ripple sparkle (audio: micHigh)
export var whiteFoam = 0.3;    // white foam crest amount (kept modest so foam accents,
                               // never washes the rig or decorrelates PRIMARY brightness)
export var uvUndertow = 0.3;   // UV undertow amount

export var cp1H = 0.60, cp1S = 1.0, cp1V = 1.0; // Sea (deep blue)
export var cp2H = 0.33, cp2S = 1.0, cp2V = 1.0; // Reef (green, wide hue sep)
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderDirection(v) {
  var d = (v * 2.0) - 1.0;
  if (d >= 0.0 && d < 0.06) d = 0.06; else if (d < 0.0 && d > -0.06) d = -0.06;
  direction = d;
}
export function sliderLevel(v) { level = v; }
export function sliderKick(v) { kick = v; }
export function sliderRadius(v) { radius = v; }
export function sliderDetail(v) { detail = v; }
export function sliderWhiteFoam(v) { whiteFoam = v; }
export function sliderUvUndertow(v) { uvUndertow = v; }

// ── Tunables ──────────────────────────────────────────────────────────────────
var MAX_RATE = 0.32;          // swim turns/sec at localSpeed = 1
var PHASE_WRAP = 10000.0;

// ── Persistent phases (delta-accumulated; §6/§7) ──────────────────────────────
var swimA = 0.0;
var swimB = 0.0;
var colDrift = 0.0;
var autoDir = 0.0;            // slow auto-direction phase
var swimAng = 0.0;            // swimA*TAU cached for render
var swimBng = 0.0;
var colAng = 0.0;
var effDir = 1.0;             // resolved glide sign this frame

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
  else             { pr1 = cp1V; pg1 = pv;   pb1 = qv;   }
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
  else             { pr2 = cp2V; pg2 = pv;   pb2 = qv;   }
}

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;
  var localMultiplier = pow(2.0, (localSpeed - 0.5) * 4.0);

  // Autonomous direction: a slow incommensurate phase whose sin gives a smooth
  // bias that occasionally crosses zero -> organic self-reversal. Combined with
  // the user's guarded direction so the user still has authority over the bias.
  autoDir = autoDir + dt * localMultiplier * 0.37796;   // 1/√7 turns/sec base
  if (autoDir >= PHASE_WRAP) autoDir = autoDir - PHASE_WRAP;
  var autoBias = sin(autoDir * 6.2831853 * 0.18);       // slow swell, ~ -1..1
  var blended = direction * (0.55 + 0.45 * autoBias);   // user dir modulated by auto swell
  effDir = blended >= 0.0 ? 1.0 : -1.0;
  if (blended < 0.04 && blended > -0.04) effDir = (autoBias >= 0.0) ? 1.0 : -1.0;

  // Travel rate scales gently with radius (audio: bigger reach -> faster glide).
  var rate = dt * localMultiplier * MAX_RATE * (0.7 + radius * 0.6) * effDir;
  swimA = swimA + rate;        if (swimA >= PHASE_WRAP) swimA = swimA - PHASE_WRAP; if (swimA < 0.0) swimA = swimA + PHASE_WRAP;
  swimB = swimB + rate * 0.47; if (swimB >= PHASE_WRAP) swimB = swimB - PHASE_WRAP; if (swimB < 0.0) swimB = swimB + PHASE_WRAP;
  colDrift = colDrift + dt * localMultiplier * 0.31; if (colDrift >= PHASE_WRAP) colDrift = colDrift - PHASE_WRAP;

  swimAng = swimA * 6.2831853;
  swimBng = swimB * 6.2831853;
  colAng = colDrift * 6.2831853;

  _hsv2rgb1();
  _hsv2rgb2();
}

export function render3D(index, x, y, z) {
  var nx = max(0.0, min(1.0, x));
  var ny = max(0.0, min(1.0, y));

  // Manta silhouette: wing span and vertical travel grow with `radius`.
  var span = 0.18 + radius * 0.34;
  var swing = 0.12 + radius * 0.16;
  var mantaY = 0.48 + sin(swimAng + nx * 3.6) * swing + sin(swimBng - nx * 5.0) * swing * 0.5;
  var wing = abs(ny - mantaY);
  var body = max(0.0, 1.0 - wing / span);
  body = pow(body, 2.0 + (1.0 - radius) * 1.5);  // crisp core; tighter when small

  // Wing ripple sparkle (audio: micHigh -> detail).
  var wingRipple = wave(nx * 3.2 + sin(swimBng + ny * 4.0) * 0.35);
  // Rolling ocean swell: a pow curve sharpens it into bright crests over deeper
  // troughs so the wash reads HIGH-DEF (crisp moving light over darker water),
  // not a flat field -- while it still sweeps the WHOLE rig (wash identity kept).
  var rollingLight = wave(ny * 2.0 - nx * 0.7 + colAng * 0.62 / 6.2831853);
  rollingLight = pow(rollingLight, 2.2);
  // A low non-black ambient floor (calm-but-visible in silence) + the swell crests
  // + a crisp manta body crest. The bright cores ride well above the deep troughs
  // so the bright/dark ratio is high (HD), without losing the lit wash.
  var ocean = 0.06 + rollingLight * 0.5 + body * (0.6 + wingRipple * (0.12 + detail * 0.5));

  // PRIMARY brightness gain (audio: micLow -> level). Level-driven gain does NOT
  // wobble with animation phase -> high corr. Small floor keeps silence visible.
  var gain = 0.16 + level * 1.3 + kick * 0.5;
  ocean = ocean * gain;
  ocean = max(0.0, min(1.4, ocean));

  // Colour: a wide spatial gradient sweeps cp1(sea, low nx) -> cp2(reef, high
  // nx) across the whole rig, and the manta body pushes hard toward cp2 — so
  // BOTH palette ends are always present (drives hueSpread). Slow drift keeps it
  // alive even in silence.
  // Colour spans the rig along nx (the only axis with full 0..1 range on the
  // bars): left = cp1 sea-blue, right = cp2 reef-green. A slow drift slides the
  // boundary; the manta body pushes its pixels toward cp2. Both ends always lit.
  var sweep = nx + 0.18 * sin(colAng * 0.31 + ny * 2.0);
  // The nx sweep (full 0..1 across the bars) guarantees BOTH palette ends are lit;
  // the manta body only nudges its pixels toward cp2 (reef) so wide wings (radius
  // high) don't collapse the rig onto one hue -- keeps hueSpread up at all radii.
  var colorMix = sweep * (1.0 - body * 0.4) + body * 0.45;
  colorMix = max(0.0, min(1.0, colorMix));
  // Gentle S-curve pushes pixels toward the two palette ENDS (more two-colour,
  // fewer washed mid-hues) while keeping a smooth gradient.
  colorMix = colorMix * colorMix * (3.0 - 2.0 * colorMix);
  colorMix = colorMix * colorMix * (3.0 - 2.0 * colorMix);
  var r = (pr1 + (pr2 - pr1) * colorMix) * ocean;
  var g = (pg1 + (pg2 - pg1) * colorMix) * ocean;
  var b = (pb1 + (pb2 - pb1) * colorMix) * ocean;

  // White foam crest + UV undertow; foam pops on the kick.
  var foamLine = pow(max(0.0, 1.0 - abs(ny - 0.88) * 7.0), 2.0);
  var white = min(1.0, (foamLine * rollingLight + body * 0.22) * whiteFoam * (1.0 + kick * 1.5));
  var uv = min(1.0, ((1.0 - ny) * rollingLight * 0.5 + body * 0.25) * uvUndertow);

  rgbwau(min(1.0, r), min(1.0, g), min(1.0, b), white, 0.0, uv);
}
