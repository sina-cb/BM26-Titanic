/*
  00_golden_hour_wash.js — "Golden Hour Wash"
  Extremely warm, ambient, shifting sunset lighting. A soft warm NOISE WASH
  drifts across the rig in an analogous red -> sunset-orange palette
  (cp1H ~ 0.0, cp2H ~ 0.08). This is the SIGNATURE VINTAGE-BLINDER pattern:
  the vintage heads (sectionId == 2) act as audience blinders — on the KICK we
  drive the W (white) channel HARD on those fixtures via rgbwau, for contrast on
  an otherwise calm analogous warm palette.

  CORE (non-repeating) MATH — the wash field is a sum of incommensurate waves
  evaluated at a drifting coordinate:
      v = nx*SX*radius + ny*SY*radius*0.61803 - nz*SZ*radius*0.41421 + driftA
      noise = wave(v) blended with wave(v*1.73205 + driftB*0.7) ; cubed for soft cores
  driftA / driftB accumulate at irrational-ratio rates (√2, √3, φ) so the field
  never visibly re-locks. Direction auto-varies via a slow incommensurate
  oscillator that occasionally flips the drift sign on its own.

  CONTROLS (UI order = declaration order)
    - localSpeed : FIRST control. Drives wash drift rate via pow(2,(v-0.5)*4).
                   v=0 still creeps, v=1 clearly faster.
    - direction  : drift direction. Slider-center freeze guard; effective sign
                   never exactly 0. Combined with autonomous auto-switching.
    - sliderLevel  : overall brightness (PRIMARY audio target).
    - sliderKick   : kick brightness pop — drives vintage W hard (blinder).
    - sliderRadius : movement RADIUS / scale of the wash features.
    - sliderWarmth : warm glow lift (pushes value toward cp2 + warm floor).
    - colorPalette1/2 : strict cp1<->cp2 warm palette.

  AUDIO (modulators-only — never read CPC audio globals natively):
      MODULATE sliderLevel  (level)  <- micLow   // PRIMARY -> overall brightness
      MODULATE sliderKick   (kick)   <- micKick  // vintage W blinder pop
      MODULATE sliderRadius (radius) <- micFlux  // wash feature scale / build
*/

// ── Exported controls (UI order = declaration order) ─────────────────────────
export var localSpeed = 0.5;   // FIRST: wash drift rate
export var direction  = 0.5;   // drift direction (0.5 center -> guarded freeze)
export var level      = 1.0;   // overall brightness (PRIMARY)
export var kick       = 0.0;   // kick brightness pop -> vintage W blinder
export var radius     = 0.5;   // movement radius / feature scale
export var warmth     = 0.4;   // warm glow lift

export var cp1H = 0.0,  cp1S = 1.0, cp1V = 1.0;  // deep red
export var cp2H = 0.18, cp2S = 1.0, cp2V = 1.0;  // sunset amber-gold
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

// Identity sliders — store v DIRECTLY; scale inside render3D / beforeRender.
export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderDirection(v) {
  // Guard the slider center so the effective sign is never exactly 0.
  var d = (v * 2.0) - 1.0;
  if (d >= 0.0 && d < 0.06) d = 0.06;
  else if (d < 0.0 && d > -0.06) d = -0.06;
  direction = d;
}
export function sliderLevel(v)  { level = v; }
export function sliderKick(v)   { kick = v; }
export function sliderRadius(v) { radius = v; }
export function sliderWarmth(v) { warmth = v; }

// ── Tunables ─────────────────────────────────────────────────────────────────
var MAX_RATE = 0.55;          // drift turns/sec at localSpeed = 1.0
var BASE_RATE = 0.06;         // creep so motion never fully stops at localSpeed=0
var PHASE_WRAP = 10000.0;     // wrap accumulators far from any in-frame use (§7)

// ── Palette RGB cache (verbatim from 27_swipe) ───────────────────────────────
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
var driftA = 0.0;      // primary wash drift accumulator
var driftB = 0.0;      // secondary (incommensurate) drift accumulator
var dirOsc = 0.0;      // autonomous direction oscillator accumulator
var autoSign = 1.0;    // current autonomous drift sign (occasionally flips)
var levGain = 1.0;     // resolved overall brightness gain this frame
var radScale = 0.5;    // resolved radius this frame
var kickW = 0.0;       // resolved vintage W blinder amount this frame
var warmLift = 0.0;    // resolved warm glow lift this frame

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  _hsv2rgb1();
  _hsv2rgb2();

  // localSpeed drives drift rate (canonical idiom). Keep a base creep so the
  // wash still moves at localSpeed = 0.
  var localMult = pow(2.0, (localSpeed - 0.5) * 4.0);
  var rate = (BASE_RATE + MAX_RATE * localMult);

  // Autonomous direction VARIATION: a slow incommensurate oscillator. When it
  // crosses zero we flip the autonomous sign — clock-driven, irrational period,
  // so flips feel organic, not metronomic.
  var prevOsc = sin(dirOsc);
  dirOsc = dirOsc + dt * 0.137;        // slow, ~0.137 rad/s (incommensurate)
  if (dirOsc >= PHASE_WRAP) dirOsc = dirOsc - PHASE_WRAP;
  var curOsc = sin(dirOsc * 1.41421);  // √2 multiplier -> non-repeating crossings
  if ((prevOsc <= 0.0 && curOsc > 0.0) || (prevOsc >= 0.0 && curOsc < 0.0)) {
    autoSign = -autoSign;
  }

  // Effective drift sign: user direction (guarded, never 0) * autonomous sign.
  var effDir = direction;
  if (effDir >= 0.0 && effDir < 0.06) effDir = 0.06;
  else if (effDir < 0.0 && effDir > -0.06) effDir = -0.06;
  var signedRate = rate * effDir * autoSign;

  // Two accumulators at irrational-ratio rates -> non-repeating field.
  driftA = driftA + dt * signedRate;
  if (driftA >= PHASE_WRAP) driftA = driftA - PHASE_WRAP;
  else if (driftA <= -PHASE_WRAP) driftA = driftA + PHASE_WRAP;
  driftB = driftB + dt * signedRate * 0.61803;  // φ-related ratio
  if (driftB >= PHASE_WRAP) driftB = driftB - PHASE_WRAP;
  else if (driftB <= -PHASE_WRAP) driftB = driftB + PHASE_WRAP;

  // Resolve audio-driven controls once per frame (clean level->gain; no phase
  // wobble so the PRIMARY correlation stays high).
  levGain = 0.25 + 0.75 * clamp01(level);     // calm non-black floor at level=0
  radScale = 0.35 + clamp01(radius) * 1.3;    // feature scale
  kickW = clamp01(kick);                       // vintage W blinder amount
  warmLift = clamp01(warmth);
}

export function render3D(index, x, y, z) {
  var nx = clamp01(x);
  var ny = clamp01(y);
  var nz = clamp01(z);

  // Drifting incommensurate noise field (the wash).
  var v = nx * 2.3 * radScale
        + ny * 1.7 * radScale * 0.61803
        - nz * 1.9 * radScale * 0.41421
        + driftA;
  var n1 = wave(v);
  var n2 = wave(v * 1.73205 + driftB * 0.7);    // √3 -> second incommensurate layer
  var nraw = n1 * 0.6 + n2 * 0.4;               // 0..1 field, evenly distributed
  var noise = nraw * nraw * nraw;               // soft, gentle cores (brightness)

  // Warm palette blend in RGB space (cp1 deep red -> cp2 sunset amber-gold). Use
  // the RAW field, then push it toward the two ENDS (smootherstep-style contrast)
  // so the rig reads as two warm colours, not a muddy single mid-hue. This keeps
  // hue energy at both cp1 and cp2 -> healthy hueSpread on an analogous palette.
  var tc = clamp01(nraw);
  // Hard contrast curve -> hue energy concentrates at BOTH ends (cp1 & cp2),
  // giving real hueSpread on this analogous warm palette while staying smooth
  // enough to look like a wash (not a hard split).
  var tcol;
  if (tc < 0.5) { var lo = 2.0 * tc; tcol = 0.5 * lo * lo * lo * lo * lo; }
  else { var u = 2.0 * (1.0 - tc); tcol = 1.0 - 0.5 * u * u * u * u * u; }
  var r = pr1 + (pr2 - pr1) * tcol;
  var g = pg1 + (pg2 - pg1) * tcol;
  var b = pb1 + (pb2 - pb1) * tcol;

  // Value: cubed noise core + small non-black warm base + warm glow lift.
  var bri = noise * 0.85 + 0.08 + warmLift * 0.12;
  bri = bri * levGain;

  r = r * bri;
  g = g * bri;
  b = b * bri;

  var w = 0.0;
  var a = 0.0;

  // VINTAGE BLINDER: sectionId == 2 heads. Drive W hard on the kick. Even with
  // no kick there is a gentle warm W shimmer so the blinders read warm.
  if (sectionId == 2) {
    var ambW = noise * 0.08;                    // calm warm white shimmer (subtle)
    var hitW = kickW * (0.6 + 0.4 * noise);     // hard blinder pop on kick
    w = ambW + hitW * 2.0;                       // drive W HARD on the kick
    w = w * (0.35 + 0.65 * levGain);            // still gated by overall level
    if (w > 1.0) w = 1.0;
    // Lift the warm core slightly so the heads glow warm, not just go white.
    r = r + kickW * 0.12;
    g = g + kickW * 0.05;
  }

  rgbwau(clamp01(r), clamp01(g), clamp01(b), clamp01(w), clamp01(a), 0.0);
}
