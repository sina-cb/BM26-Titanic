/*
  02_phase_cathedral.js — "Phase Cathedral"

  A huge, beat-locked interference field made from several phase-shifted sine
  planes crossing the whole rig. Four planes f1..f4 cross on golden-ratio
  INCOMMENSURATE ratios (φ=1.618 / 1/φ=0.618) plus a radial term, summed and
  crushed with a sharpness power so the field collapses to crisp bright cores
  with near-black nodes. Deep-blue -> pink/magenta palette, blended in RGB space
  (strict cp1<->cp2 line). Fixture-capability authorship keeps it portable:
    - Bars carry the broad interference field.
    - Pars carry restrained zero-crossing cores.
    - Vintage rails carry matched-W+A cathedral glints and the kick blinder.
    - RGBW strands carry a brighter saturated contour.
    - TE signs carry a calm XYZ stained-glass rose window with a readable floor.

  NON-REPEATING MATH
    The four planes advance from ONE beat clock multiplied by incommensurate
    factors: f1 = +1, f2 = -0.5, f3 = +φ (1.618), f4 = -1/φ (0.618). Because φ
    is irrational, f3/f4 never re-phase with f1/f2 — the cathedral never visibly
    loops. The operator direction is the sole drift sign, so its endpoints remain
    deterministic and visibly opposite.

  SPEED / DIRECTION
    - localSpeed scales the drift rate: pow(2,(localSpeed-0.5)*4). At 0 it still
      CREEPS (a non-zero base rate), at 1 it is clearly faster.
    - sliderDirection selects one of two deterministic signs, so it never changes
      speed or freezes the field; endpoints produce opposite travel.

  PHASE WRAP (seam discipline, skill §7)
    f3/f4 multiply beatPhase by irrational ratios, so wrapping beatPhase at 2π
    would jump (2π·φ mod 2π ≠ 0) -> a visible flash every cycle. We wrap at a
    LARGE multiple of 2π (10000·2π) so float64 precision holds and any seam is
    pushed ~14 hours out.

  AUDIO (modulators-only — never read CPC audio globals natively). The block
  below is the STRICT source of truth a generator parses for the deploy playlist.

AUDIO_MODULATION_V1:
  sliderLevel     <- micLow  range 0.30..1.00 curve linear  # final whole-pattern brightness (PRIMARY)
  sliderKick      <- micKick range 0.00..1.00 curve pow2    # whole-ship light strike + W/A punch
  sliderRadius    <- micFlux range 0.08..0.92 curve linear  # visible arch expands from apex to hull
  sliderSharpness <- micMid  range 0.30..0.80 curve linear  # node-crush reshape (secondary geometry)
  # STATIC (omit from audio): localSpeed, sliderCount (radialDensity), direction, colorPalette1/2
*/

// ── Exported controls (UI order = declaration order) ─────────────────────────
export var localSpeed = 0.5;     // FIRST control: drift rate (still creeps at 0)
export var level = 0.5;          // PRIMARY audio: overall brightness — mid; swings up
export var kick = 0.0;           // audio: kick pop + vintage blinder — transient; a
                                 // steady lift flattens the pulse (kills ANIMATING).
export var radius = 0.5;         // audio: field expansion / radial travel
export var sharpness = 0.5;      // node crush power (identity slider; scaled in render3D)
export var radialDensity = 0.5;  // radial ring density (identity slider; scaled in render3D)
export var globalDir = 1.0;      // resolved sign; sliderDirection owns no speed scaling

export var cp1H = 0.6, cp1S = 1.0, cp1V = 1.0; // Deep Blue
export var cp2H = 0.8, cp2S = 1.0, cp2V = 1.0; // Pink / Magenta
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderDirection(v) {
  // Direction chooses a sign only; localSpeed remains the sole rate control.
  if (v < 0.5) globalDir = -1.0;
  else globalDir = 1.0;
}
export function sliderLevel(v) { level = v; }        // store v directly
export function sliderKick(v) { kick = v; }          // store v directly
export function sliderRadius(v) { radius = v; }       // store v directly
export function sliderSharpness(v) { sharpness = v; }       // store directly; scale in render3D
export function sliderCount(v) { radialDensity = v; }        // store directly; scale in render3D

// ── Palette RGB cache (strict cp1<->cp2, blend in RGB space; copied verbatim
//    from 27_swipe.js) ────────────────────────────────────────────────────────
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

// ── Tunables ──────────────────────────────────────────────────────────────────
var BASE_RATE = 0.18;   // creep rate (cycles/s) at localSpeed=0 — never static
var SPAN_RATE = 0.90;   // additional rate (cycles/s) added by localSpeed scaling
var GOLDEN = 1.618;     // φ — incommensurate plane ratio
var INVGOLDEN = 0.618;  // 1/φ — incommensurate plane ratio

// Optional accent role: canonical append-only id from
// lib/fixture_type_constants.js. Self-declaring it keeps this shared pattern
// compilable on scenes without TE signs; it is never a load-bearing target.
var FIX_TE_SIGN = 7;

// ── Persistent state ───────────────────────────────────────────────────────────
var beatPhase = 0.0;    // master interference clock (radians)

// Wrap at a LARGE multiple of 2π (skill §7): f3/f4 scale beatPhase by irrational
// ratios, so a 2π wrap would flash. 10000·2π keeps float64 precision intact.
var BEAT_WRAP = 62831.853;  // 10000 * 2π

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  _hsv2rgb1();
  _hsv2rgb2();

  // localSpeed scales drift rate; BASE_RATE keeps a non-zero creep at 0.
  var localMultiplier = pow(2.0, (localSpeed - 0.5) * 4.0);
  var rate = BASE_RATE + SPAN_RATE * localMultiplier;   // cycles per second

  // Manual direction is authoritative and resolves to a sign only, so the field
  // always moves and localSpeed remains the sole rate control.
  beatPhase = beatPhase + dt * rate * 6.2831853 * globalDir;
  beatPhase = beatPhase % BEAT_WRAP;
  if (beatPhase < 0.0) beatPhase = beatPhase + BEAT_WRAP;
}

export function render3D(index, x, y, z) {
  var nx = clamp01(x);
  var ny = clamp01(y);
  var nz = clamp01(z);

  // Identity-slider scaling: map the stored 0..1 controls to their working spans.
  var sharpPow = 1.0 + sharpness * 7.0;       // node crush power 1..8 (mid 0.5 -> 4.5);
                                              // capped at 8 so the crush extreme stays lit
  var ringDens = 2.0 + radialDensity * 18.0;  // radial ring density 2..20 (mid -> 11)

  // Radius has one plain spatial meaning: move the dominant cathedral arch
  // from the apex at the top-centre to the outside/lower hull. It does not
  // alter clock rate, phase, density, or an unrelated brightness term.
  var archRadius = 0.05 + radius * 0.90;
  var dens = ringDens;

  var f1 = sin((nx * 10.0) * PI2 + beatPhase);
  var f2 = sin((ny * 10.0) * PI2 - beatPhase * 0.5);
  var f3 = sin(((nx + ny) * 5.0) * PI2 + beatPhase * GOLDEN);

  var dx = nx - 0.5;
  var dy = ny - 0.85;
  var dist = sqrt(dx * dx + dy * dy);
  var f4 = sin((dist * dens) * PI2 - beatPhase * INVGOLDEN);

  var field = (f1 + f2 + f3 + f4) * 0.25;
  var interference = pow(abs(field), sharpPow);
  var archDistance = abs(dist - archRadius);
  var arch = 1.0 - smoothstep(0.018, 0.095, archDistance);
  // One broad buttress travels horizontally through the cathedral. Its head
  // is derived from the signed master phase, making Direction endpoints
  // visibly and deterministically opposite even while the interference field
  // itself contains several incommensurate plane velocities.
  var travelHead = frac((beatPhase / PI2) * 0.55);
  if (travelHead < 0.0) travelHead = travelHead + 1.0;
  var ribDistance = abs(nx - travelHead);
  ribDistance = min(ribDistance, 1.0 - ribDistance);
  var travelingRib = 1.0 - smoothstep(0.035, 0.14, ribDistance);
  var magnitude = max(interference * 0.82,
                      arch * (0.48 + abs(field) * 0.52));
  magnitude = magnitude * 0.38 + travelingRib * (0.68 + arch * 0.22);
  // Tiny brightness floor: the field crushes to ~0 at nodes and all planes can
  // hit a zero-crossing at once. Keep only a faint glow so the cathedral is NEVER
  // fully black (mission-critical visibility) while RESTORING og's near-black
  // negative space between the bright interference cores (was 0.08 -> too lifted).
  magnitude = 0.02 + magnitude * 0.98;

  if (magnitude > 1.0) magnitude = 1.0;

  // ── Colour: blend cp1<->cp2 in RGB space along the field sign/strength ──────
  // Positive field leans cp1 (blue), negative leans cp2 (magenta); |field|
  // pushes toward the saturated end so the rig spans both palette ends.
  // Push toward the palette ENDS (not the desaturated midpoint) so the rig
  // decisively spans both cp1 and cp2 -> healthy hueSpread.
  var tcol = clamp01(0.5 - field * 1.8);   // -1 -> cp2 end (1), +1 -> cp1 end (0)
  var baseR = pr1 + (pr2 - pr1) * tcol;
  var baseG = pg1 + (pg2 - pg1) * tcol;
  var baseB = pb1 + (pb2 - pb1) * tcol;

  var outR = baseR * magnitude;
  var outG = baseG * magnitude;
  var outB = baseB * magnitude;
  var finalW = 0.0;
  var finalA = 0.0;
  var finalU = 0.0;

  if (fixtureType == FIX_BAR_18) {
    // Hull bars: the broad interference field is the main cathedral canvas.
  }
  else if (fixtureType == FIX_PAR) {
    // Pars: restrained zero-crossing cores. Keep these structural sources
    // readable without letting single-pixel fixtures overpower the field.
    var zc = 1.0 - abs(field);
    zc = pow(zc, sharpPow * 2.0);
    var coreBri = (magnitude * 0.34) + (zc * 0.66);
    if (coreBri > 1.0) coreBri = 1.0;
    outR = baseR * coreBri;
    outG = baseG * coreBri;
    outB = baseB * coreBri;
  }
  else if (fixtureType == FIX_VINTAGE_6) {
    // Jewelry: a restrained matched-white keep becomes a decisive golden-white
    // kick. W and A are assigned from the same expression below.
    var emit = magnitude * 0.62;
    finalW = emit * 0.28;
    if (finalW > 1.0) finalW = 1.0;
    outR = baseR * emit;
    outG = baseG * emit;
    outB = baseB * emit;
  }
  else if (fixtureType == FIX_TE_SIGN) {
    // Identity: a coherent stained-glass rose window, not the generic RGBW
    // contour. Broad world-space planes preserve the cathedral's XYZ motion;
    // the low-amplitude per-fixture index term keeps each letter articulated
    // without turning the sign into independent sparkle noise.
    // Two counter-rotating architectural planes make the rose window visibly
    // turn within one review pass. Their 0.185/0.073 turn ratios both land on
    // integer cycles at BEAT_WRAP (1850/730), so the distant wrap is seamless.
    var signPlane = wave(nx * 1.414 + ny * 0.618 + nz * 1.732
                         - beatPhase / PI2 * 0.185);
    var signLead = wave(pixelLocalIndex * 0.0309 + nx * 0.73
                        + ny * 0.41 + nz * 0.59
                        + beatPhase / PI2 * 0.073);
    var signGlass = signPlane * 0.72 + signLead * 0.28;
    var signBlend = clamp01(tcol * 0.68 + signGlass * 0.32);
    var signR = pr1 + (pr2 - pr1) * signBlend;
    var signG = pg1 + (pg2 - pg1) * signBlend;
    var signB = pb1 + (pb2 - pb1) * signBlend;

    // A strong, calm floor keeps both TE letterforms readable at distance;
    // the original cathedral interference remains visible above that floor.
    var signBri = 0.34 + magnitude * 0.42 + signGlass * 0.14;
    if (signBri > 1.0) signBri = 1.0;
    outR = signR * signBri;
    outG = signG * signBri;
    outB = signB * signBri;
  }
  else {
    // RGBW strands and signs keep a clearer saturated contour so the ship's
    // silhouette and identity stay readable while the bars carry the detail.
    var readable = 0.10 + magnitude * 0.90;
    outR = baseR * readable;
    outG = baseG * readable;
    outB = baseB * readable;
  }

  // Kick is deliberately unmistakable: it lifts the full RGB composition and
  // adds a matched-W+A strike everywhere, strongest on Jewelry and the
  // RGBWAU bars/pars. It is no longer hidden inside a clipped multiplier.
  var kickField = kick * (0.55 + arch * 0.45);
  outR = outR + (0.12 + baseR * 0.88) * kickField * 0.90;
  outG = outG + (0.12 + baseG * 0.88) * kickField * 0.90;
  outB = outB + (0.12 + baseB * 0.88) * kickField * 0.90;

  if (fixtureType == FIX_VINTAGE_6) {
    finalW = finalW + kick * (0.58 + arch * 0.42);
  }
  else if (fixtureType == FIX_BAR_18 || fixtureType == FIX_PAR) {
    finalW = finalW + kick * (0.28 + arch * 0.32);
  }
  else {
    finalW = finalW + kick * (0.14 + arch * 0.18);
  }

  // Level is a true FINAL gain. No fixture-specific readability floor can
  // bypass it, and it scales the RGB field, kick strike, and white together.
  var finalGain = level * 1.20;
  outR = outR * finalGain;
  outG = outG * finalGain;
  outB = outB * finalGain;
  finalW = finalW * finalGain;
  finalU = finalU * finalGain;

  // LANE MATCH (w == a): the bare W emitter reads cold and the bare A emitter
  // reads yellow — matched W+A is the ship's warm white, and it is what the LED
  // strands already render (they fold amber into RGB). Convention:
  // docs/MARSIN_ENGINE_PATTERNS.md -> "White handling: the w == a convention".
  finalA = finalW;

  rgbwau(clamp01(outR), clamp01(outG), clamp01(outB), clamp01(finalW), clamp01(finalA), clamp01(finalU));
}
