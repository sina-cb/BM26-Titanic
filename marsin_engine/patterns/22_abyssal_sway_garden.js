/*
  22_abyssal_sway_garden.js — HD, audio-reactive underwater frond garden.

  IDENTITY (preserved): a garden of vertical fronds swaying in a slow abyssal
  current, phosphorescent tips flickering at the top, deep blue base fading into
  bioluminescent green. TE signs hold a rooted botanical emblem with slowly
  articulating fronds and tips. Strict cp1<->cp2 blended in RGB-space.

  WHAT'S NEW
    - localSpeed drives delta-accumulated current/flicker/tide phases (creeps at
      0, ~4x at 1).
    - The travelling current has one calm forward heading; Local Speed is its
      only rate control.
    - Audio sliders: level (PRIMARY brightness), kick (tip-flash brightness pop),
      radius (sway amplitude = how far fronds travel), detail (tip sparkle).

  NON-REPEATING MATH
    Current phase accumulates at 1.0, flicker at 5.3 and tide at 0.073.
    Per-frond offset
    sin(swayedX*11.7)*0.13 and frondPhase = swayedX*frondDensity de-sync the
    stalks. Phases wrap at PHASE_WRAP=10000 turns (far from any in-frame use).

  AUDIO_MODULATION_V1:
    sliderLevel  <- micLow  range 0.30..1.00 curve pow2   # PRIMARY brightness (bass)
    sliderKick   <- micKick range 0.00..1.00 curve linear # tip-flash / brightness pop (beat)
    sliderRadius <- micFlux range 0.40..0.90 curve linear # sway amplitude / travel (build)
    sliderDetail <- micHigh range 0.30..0.90 curve linear # tip sparkle
  # Static (not audio-mapped): localSpeed, frondDensity, tipGlow,
  # baseDarkness, colorPalette1/2 — operator-set, not modulated.
*/

// ── Exported controls (UI order = declaration order) ──────────────────────────
export var localSpeed = 0.5;
export var level = 0.5;         // PRIMARY: overall brightness (audio: micLow); mid = calm-but-lit
export var kick = 0.0;          // tip-flash / brightness pop (audio: micKick); 0 = no pop until beat
export var radius = 0.5;        // sway amplitude / travel (audio: micFlux)
export var detail = 0.5;        // tip sparkle (audio: micHigh)
export var frondDensity = 0.5;  // raw slider value; resolved to 3..17 at use
export var tipGlow = 0.5;
export var baseDarkness = 0.5;

export var cp1H = 0.55, cp1S = 0.95, cp1V = 1.0; // deep abyssal blue (og default)
export var cp2H = 0.38, cp2S = 0.95, cp2V = 1.0; // bioluminescent green (og default)
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderLevel(v) { level = v; }
export function sliderKick(v) { kick = v; }
export function sliderRadius(v) { radius = v; }
export function sliderDetail(v) { detail = v; }
export function sliderFrondDensity(v) { frondDensity = v; }
export function sliderTipGlow(v) { tipGlow = v; }
export function sliderBaseDarkness(v) { baseDarkness = v; }

// ── Tunables ──────────────────────────────────────────────────────────────────
var CURRENT_RATE = 0.16;   // current turns/sec at localSpeed = 1
var PHASE_WRAP = 10000.0;

// Optional accent role: canonical append-only id from
// lib/fixture_type_constants.js. Self-declaring it keeps this shared pattern
// compilable on scenes without TE signs; it is never a load-bearing target.
var FIX_TE_SIGN = 7;

// ── Persistent phases (delta-accumulated; §6/§7) ──────────────────────────────
var current = 0.0;
var flicker = 0.0;
var tide = 0.0;
var tCurrent = 0.0;        // current*TAU cached
var tFlicker = 0.0;
var tTide = 0.0;           // raw turns (used in sin(tTide*TAU))
var swayAmp = 0.35;        // resolved sway amplitude this frame

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
  // localSpeed -> rate. Base curve is pow(2,(localSpeed-0.5)*4) (0.25x..4x). The
  // sharp tip-flicker (pow(flick,4) at 5.3x the current rate) churns visibly even
  // at the 0.25x floor, which flattened the 0..1 motion response; widening the
  // exponent to 6 (0.125x..8x, a 64x span) makes the low end genuinely creep and
  // the high end clearly race, so localSpeed reads across its whole travel.
  var localMultiplier = pow(2.0, (localSpeed - 0.5) * 6.0);

  // Radius owns reach only; the current advances forward at a fixed heading.
  swayAmp = 0.10 + radius * 0.62;

  current = current + dt * localMultiplier * CURRENT_RATE;
  if (current >= PHASE_WRAP) current = current - PHASE_WRAP;
  flicker = flicker + dt * localMultiplier * CURRENT_RATE * 5.3;
  if (flicker >= PHASE_WRAP) flicker = flicker - PHASE_WRAP;
  tide = tide + dt * localMultiplier * CURRENT_RATE * 0.073;
  if (tide >= PHASE_WRAP) tide = tide - PHASE_WRAP;

  tCurrent = current * 6.2831853;
  tFlicker = flicker * 6.2831853;
  tTide = tide;

  _hsv2rgb1();
  _hsv2rgb2();
}

export function render3D(index, x, y, z) {
  var nx = max(0.0, min(1.0, x));
  var ny = max(0.0, min(1.0, y));
  var nz = max(0.0, min(1.0, z));

  // Vintage rails are the garden's phosphorescent jewelry on every model that
  // carries them. Fixture capability is portable; section numbering is not.
  var tall = 0.0;
  if (fixtureType == FIX_VINTAGE_6) tall = 1.0;
  var nyEff = max(0.0, min(1.0, ny + tall * 0.22));

  // Per-frond lateral sway: higher fronds bend more (cantilever ny^2).
  var travel = tCurrent;
  var bend = sin(travel + nx * 4.0) * swayAmp * nyEff * nyEff;
  var bendSlow = sin(travel * 0.41 + nx * 2.3) * swayAmp * nyEff * 0.5;
  var swayedX = nx + bend + bendSlow;

  // Vertical fronds: a phase pattern in x produces tall thin stalks. A SHARPER
  // pow exponent + a contrast stretch crisps each spine to a bright moving core
  // and deepens the gaps between stalks into darker troughs -- this is the HD
  // contrast: crisp bright fronds over a deeper wash, not a flat field.
  var resolvedDensity = 3.0 + frondDensity * 14.0;
  var frondPhase = swayedX * resolvedDensity + sin(swayedX * 11.7) * 0.13;
  var frond = wave(frondPhase);
  frond = pow(frond, 2.6);                 // crisper spine, deeper trough sides
  frond = frond * (0.55 + frond * 0.45);   // contrast stretch (bright/dark ratio up)

  var heightWeight = 0.3 + pow(nyEff, 1.35) * 0.7;
  var body = frond * heightWeight;

  // Phosphorescent tip flicker — top band only, jittered per frond. Tip sparkle
  // scales with detail (audio: micHigh); tips flash brighter on the kick.
  var tipBand = pow(max(0.0, nyEff - 0.55) / 0.45, 1.5);
  // Detail owns small phosphor beads without changing the main frond count.
  var beadScale = 4.0 + detail * 22.0;
  var beads = wave(swayedX * beadScale + nyEff * (3.0 + detail * 9.0)
                 - tFlicker * 0.17);
  beads = pow(beads, 3.0 + detail * 4.0);
  var crossGrain = wave(nx * (5.0 + detail * 38.0)
                      + nyEff * (3.0 + detail * 31.0) - tFlicker * 0.09);
  crossGrain = pow(crossGrain, 2.0 + detail * 5.0);
  var flick = wave(tFlicker + swayedX * 7.3 + nyEff * 2.1);
  flick = pow(flick, 4.0);
  var tipFlicker = tipBand * (0.20 + flick * 0.80)
                 * (0.08 + tipGlow * 1.92) * (1.0 + tall * 0.8) * frond
                 * (0.28 + beads * (0.45 + detail * 1.35))
                 * (1.0 + kick * 1.8);

  // Long slow tide breath of the whole garden.
  var tideBreath = 0.8 + sin(tTide * 6.2831853) * 0.2;

  // Non-black bioluminescent floor so silence is calm-but-visible. Kept small so
  // the inter-frond troughs stay dark (HD contrast) while never going black.
  // Clockwise now removes the abyssal floor instead of adding light.
  var glowFloor = (0.012 + (1.0 - baseDarkness) * 0.16)
                * (0.55 + 0.45 * heightWeight);
  var shimmer = 0.5 + 0.5 * sin(tCurrent * 0.7 + nx * 5.0 + ny * 3.0);
  body = body + crossGrain * detail * 0.30 * heightWeight;
  var tipAura = tipBand * frond * tipGlow * (0.18 + 0.42 * heightWeight);
  var v = body * 0.95 + tipFlicker + tipAura;
  v = v * tideBreath + glowFloor * (0.7 + 0.3 * shimmer);

  // PRIMARY brightness gain (audio: micLow -> level). The bright frond BODY is the
  // level-correlated signal; a level-driven gain whose slope dominates the small
  // phase-only floor/tide terms keeps the PRIMARY corr high and steady (validated
  // on bassline, where micLow actually varies). Kick adds a small pop.
  v = v * (0.2 + level * 1.3) + body * kick * 0.25;
  v = max(0.0, min(1.4, v));

  // Palette spans the rig: a slow nx sweep (full 0..1 across the bars) sets the
  // base hue from cp1(blue, left) to cp2(green, right); height + tip flicker
  // push toward cp2 (tips glow green). An S-curve sharpens to the two ENDS so
  // the rig reads as a crisp two-colour garden (drives hueSpread).
  var hueSweep = nx + 0.2 * sin(tCurrent * 0.3 + ny * 2.0);
  var tVal = hueSweep * 0.7 + pow(nyEff, 1.3) * 0.35 + tipFlicker * 0.6;
  tVal = max(0.0, min(1.0, tVal));
  tVal = tVal * tVal * (3.0 - 2.0 * tVal);
  tVal = tVal * tVal * (3.0 - 2.0 * tVal);

  var r = (pr1 + (pr2 - pr1) * tVal) * v;
  var g = (pg1 + (pg2 - pg1) * tVal) * v;
  var b = (pb1 + (pb2 - pb1) * tVal) * v;

  if (fixtureType == FIX_TE_SIGN) {
    // Identity: a botanical emblem rather than a crop of the garden field.
    // Titanic's signs occupy a compact vertical band; normalized Y supplies
    // root-to-tip height while X/Z keep both physical faces spatially coherent.
    var emblemHeight = max(0.0, min(1.0, (ny - 0.50) * 6.2));
    var root = pow(1.0 - emblemHeight, 1.7);
    var signPath = pixelLocalIndex * 0.01351351351;

    // Two opposing, incommensurate-looking current sheets cross the traced
    // letters in 3-5 second phrases. Their clocks use integer phase gains, so
    // the 10000-turn accumulator wrap remains seamless.
    var currentNear = wave(current * 4.0 + signPath * 0.37
                         + ny * 0.31 + nz * 0.19);
    var currentFar = wave(-current * 7.0 + signPath * 0.61
                        - ny * 0.43 + nx * 0.23 + nz * 0.11);
    var currentCross = currentNear * currentFar;
    var currentVeil = pow(currentNear * 0.56 + currentFar * 0.44, 2.1);

    // Foreground and background stalk lattices are separately anchored. Their
    // bend grows with height squared, so roots remain planted while the canopy
    // describes the layered water flow; no temporal hash or reseed is used.
    var stemAnchor = signPath * (2.8 + frondDensity * 3.6)
                   + nx * 0.83 + ny * 0.31 + nz * 1.27;
    var backAnchor = signPath * (4.1 + frondDensity * 4.8)
                   - nx * 0.47 + ny * 0.19 + nz * 0.73 + 0.17;
    var swayNear = (sin((current * 4.0 + signPath + nz * 0.37) * 6.2831853)
                   * 0.67
                   + sin((-current * 7.0 + signPath * 0.63 + ny * 0.29)
                         * 6.2831853) * 0.33)
                 * swayAmp * emblemHeight * emblemHeight * 0.72;
    var swayFar = (sin((current * 5.0 + signPath * 0.71 + nz * 0.23)
                       * 6.2831853) * 0.55
                  + (currentFar - 0.5) * 0.45)
                * swayAmp * emblemHeight * emblemHeight * 0.48;
    var stemNear = pow(wave(stemAnchor + swayNear),
                       2.4 + frondDensity * 1.8);
    var stemFar = pow(wave(backAnchor + swayFar),
                      3.0 + frondDensity * 1.4);

    // Each foreground stalk forks above mid-height. The current changes the
    // opening angle while both prongs stay connected to the same rooted phase.
    var crownRegion = smoothstep(0.36, 0.86, emblemHeight);
    var forkSpread = crownRegion * (0.09 + radius * 0.22)
                   * (0.72 + currentNear * 0.28);
    var forkA = pow(wave(stemAnchor + swayNear + forkSpread),
                    2.6 + frondDensity * 1.2);
    var forkB = pow(wave(stemAnchor + swayNear - forkSpread),
                    2.6 + frondDensity * 1.2);
    var forks = max(forkA, forkB);
    var stem = stemNear * (1.0 - crownRegion * 0.58)
             + forks * crownRegion;
    stem = stem * (0.28 + emblemHeight * 0.72);
    var backStem = stemFar * (0.24 + emblemHeight * 0.76);
    var stemLife = wave(current * 5.0 + signPath * 0.35
                      + nz * 0.20 + currentCross * 0.11);
    stemLife = stemLife * stemLife * (3.0 - 2.0 * stemLife);

    // Fixed crown nodes carry a smooth phosphorescent lifecycle. Faster motion
    // belongs only to the tips; the addresses themselves never change.
    var tipNodes = wave(signPath * (8.0 + detail * 9.0)
                      + nx * 1.17 + ny * 2.31 + nz * 1.73);
    tipNodes = pow(tipNodes, 5.5 + detail * 3.5);
    var tipMotion = wave(flicker + signPath * 0.43
                       - emblemHeight * 0.31 + currentFar * 0.09);
    tipMotion = tipMotion * tipMotion * (3.0 - 2.0 * tipMotion);
    var emblemTip = pow(tipMotion, 2.0 + detail * 1.8)
                  * crownRegion * (0.22 + detail * 0.78)
                  * (0.22 + tipGlow * 0.98)
                  * (0.20 + forks * 0.52 + tipNodes * 0.58)
                  * (1.0 + kick * 0.82);

    // Stable cp1 root/floor makes Identity legible without flattening it; cp2
    // rises through the stems and lives at the tips. Level remains a strong
    // gain while a small identity floor survives its zero endpoint.
    var emblemFloor = 0.38 + (1.0 - baseDarkness) * 0.12;
    var emblemV = emblemFloor + root * 0.07
                + currentVeil * (0.050 + emblemHeight * 0.094)
                + currentCross * emblemHeight * 0.078
                + backStem * (0.080 + currentFar * 0.134)
                + stem * (0.174 + stemLife * 0.456) + emblemTip * 0.70;
    var emblemGain = 0.28 + level * 0.92;
    emblemV = min(1.0, emblemV * emblemGain);
    var emblemBlend = max(0.0, min(1.0,
      0.07 + emblemHeight * 0.40 + currentFar * 0.08
      + backStem * 0.10 + forks * crownRegion * 0.19 + emblemTip * 0.48));
    r = (pr1 + (pr2 - pr1) * emblemBlend) * emblemV;
    g = (pg1 + (pg2 - pg1) * emblemBlend) * emblemV;
    b = (pb1 + (pb2 - pb1) * emblemBlend) * emblemV;
  }

  // Vintage gets the only native white. W and A share one scalar by design.
  var w = 0.0;
  if (fixtureType == FIX_VINTAGE_6) {
    w = min(1.0, tipFlicker * (0.18 + tipGlow * 0.82));
    r = r + w * 0.18;
    g = g + w * 0.08;
  }
  rgbwau(min(1.0, r), min(1.0, g), min(1.0, b), w, w, 0.0);
}
