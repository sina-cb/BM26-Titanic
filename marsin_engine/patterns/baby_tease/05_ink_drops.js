/*
  Ink Drops (design doc 72, keeper K11).

  Pink and blue ink keeps blooming into the ship out of four nucleation sites.
  The sites bloom in counter-colored pairs — one pink and one blue open together
  and close together — so the two families always claim the same amount of hull,
  and the second pair opens half a cycle later at the other end of the ship so
  a bloom is always alive somewhere. Under the blooms lies a still marbled sea of both
  colors that the ink invades and then releases.

  The four sites are placed on the measured pixel cloud rather than on a tidy
  grid, so every named region of the ship is reachable by ink; where they used
  to sit, one whole beam side — both Front walls — lay outside every drop.
  See report _305 for the coverage census and the marble-vein fix below it.

  Local Speed is the safe first control. Level sets output. Drop Reach sets how
  far each bloom opens. Black is designed: the marbled sea is cut by exact-black
  veins that run straight through the blooms, so the ink reads as ink in water
  rather than as a wash, and each bloom carries a bright growing rim.

  World geometry uses the all-smokestack ship frame only; raw coordinates appear
  once each to build it. Bloom distance mixes hull length, height and ship width
  so neither rig's degenerate axis can flatten a drop. Vintage fixtures bloom
  from both ends and trade trios each cycle, with one rotating black separator
  head. Both TE signs carry the same paired bloom over their own marbled sea,
  byte-identical by address.
*/

var BABY_PINK_R = 1.000;
var BABY_PINK_G = 0.035;
var BABY_PINK_B = 0.360;
var BABY_BLUE_R = 0.033;
var BABY_BLUE_G = 0.450;
var BABY_BLUE_B = 1.000;
var SHIP_CENTER_X = 0.5219458333333333;
var SHIP_CENTER_Z = 0.5606541666666667;
var SHIP_AXIS_X = 0.7658426753447269;
var SHIP_AXIS_Z = -0.6430279905422711;
var PINK_TRIM = 0.97;
var PINK_BAR_TRIM = 0.80;
var FLOOR_I = 0.14;

export var localSpeed = 0.43;
export var level = 0.86;
export var dropReach = 0.5;

export function sliderLocalSpeed(value) { localSpeed = value; }
export function sliderLevel(value) { level = value; }
export function sliderDropReach(value) { dropReach = value; }

var dropClock = 0.0;
var shimmerClock = 0.0;
var liveLevel = 0.86;
var liveReach = 0.5;

function clamp01(value) {
  if (value < 0.0) return 0.0;
  if (value > 1.0) return 1.0;
  return value;
}

function emitBlue(intensity) {
  var k = max(FLOOR_I, min(1.0, intensity)) * liveLevel;
  rgbwau(BABY_BLUE_R * k, BABY_BLUE_G * k, BABY_BLUE_B * k, 0.0, 0.0, 0.0);
}

function emitPink(intensity) {
  var k = max(FLOOR_I, min(1.0, intensity)) * liveLevel * PINK_TRIM;
  if (fixtureType == FIX_BAR_18) k = k * PINK_BAR_TRIM;
  rgbwau(BABY_PINK_R * k, BABY_PINK_G * k, BABY_PINK_B * k, 0.0, 0.0, 0.0);
}

function emitBlack() {
  rgbwau(0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
}

export function beforeRender(delta) {
  var dt = min(0.10, max(0.0, delta / 1000.0));
  var speedScale = 0.35 + clamp01(localSpeed) * 1.65;
  // SPEED RETUNE (report _305). Base rates below are ×1.30 (operator: +~30%).
  // The show's reference operating point is global SPEED 25 and
  // sliderLocalSpeed 0.30. The engine's global knob is EXPONENTIAL —
  // engine.js createRenderLoop: multiplier = 0.25 * 16^speed, so 25 is
  // 0.50x wall clock — and speedScale below is linear, so pattern time
  // advances at 0.50 * 0.845 = 0.4225x there. The factor is the operator's
  // field note applied at that reference point. Saved playlist defaults
  // are UNCHANGED — the retune lives here, in the pattern's own base rate.
  dropClock = dropClock + dt * 0.117 * speedScale;
  shimmerClock = shimmerClock + dt * 0.2145 * speedScale;
  if (dropClock >= 4.0) dropClock = dropClock - 4.0;
  if (shimmerClock >= 10000.0) shimmerClock = shimmerClock - 10000.0;
  liveLevel = clamp01(level);
  liveReach = clamp01(dropReach);
}

export function render3D(index, x, y, z) {
  var ageEarly = dropClock;
  var ageLate = dropClock - 2.0;
  if (ageLate < 0.0) ageLate = ageLate + 4.0;
  var bloomEarly = pow(wave(ageEarly * 0.25 - 0.25), 0.65);
  var bloomLate = pow(wave(ageLate * 0.25 - 0.25), 0.65);

  if (fixtureType == FIX_VINTAGE_6) {
    var head = pixelLocalIndex % 6.0;
    var darkStep = floor(shimmerClock * 2.8) % 6.0;
    var darkHead = (darkStep % 2.0) * 3.0 + floor(darkStep * 0.5);
    if (head == darkHead) {
      emitBlack();
      return;
    }
    var headSide = 0.0;
    if (head >= 3.0) headSide = 1.0;
    var headParity = (headSide + floor(dropClock + 6.0)) % 2.0;
    var headFront = abs(head / 5.0 - 0.5) * 2.0;
    var headLevel = 0.42 + wave(headFront * 0.85 - dropClock * 0.55) * 0.26;
    if (bloomEarly > 0.82) headLevel = headLevel + 0.28;
    if (headParity < 1.0) emitBlue(headLevel);
    else emitPink(headLevel);
    return;
  }

  if (fixtureType == FIX_TE_SIGN) {
    var signAddress = index % 74.0;
    var signX = (signAddress % 10.0) / 9.0;
    var signY = floor(signAddress / 10.0) / 7.0;
    var signMarble = sin((signX * 1.70 + signY * 1.40 + 0.55) * PI2)
                   + sin((signY * 1.20 - signX * 0.90 + 0.50) * PI2);
    if (abs(signMarble) < 0.32) {
      emitBlack();
      return;
    }
    var signRadEarly = max(0.03, 0.44 * bloomEarly);
    var signRadLate = max(0.03, 0.44 * bloomLate);
    var sd0 = sqrt((signX - 0.30) * (signX - 0.30)
                 + (signY - 0.34) * (signY - 0.34) * 0.80) / signRadEarly;
    var sd1 = sqrt((signX - 0.70) * (signX - 0.70)
                 + (signY - 0.66) * (signY - 0.66) * 0.80) / signRadEarly;
    var sd2 = sqrt((signX - 0.72) * (signX - 0.72)
                 + (signY - 0.28) * (signY - 0.28) * 0.80) / signRadLate;
    var sd3 = sqrt((signX - 0.28) * (signX - 0.28)
                 + (signY - 0.72) * (signY - 0.72) * 0.80) / signRadLate;
    var signNear = sd0;
    var signBlue = 1.0;
    if (sd1 < signNear) {
      signNear = sd1;
      signBlue = 0.0;
    }
    if (sd2 < signNear) {
      signNear = sd2;
      signBlue = 0.0;
    }
    if (sd3 < signNear) {
      signNear = sd3;
      signBlue = 1.0;
    }
    if (signNear < 1.0) {
      var signInk = 0.46 + (1.0 - signNear) * 0.32
                  + wave(shimmerClock * 0.5 + signNear * 1.2) * 0.10;
      if (signNear > 0.82) signInk = 0.92;
      if (signBlue > 0.5) emitBlue(signInk);
      else emitPink(signInk);
      return;
    }
    var signSea = 0.40 + wave(signX * 0.8 + signY * 0.5 - shimmerClock * 0.4) * 0.42;
    if (signMarble > 0.0) emitBlue(signSea);
    else emitPink(signSea);
    return;
  }

  var dx = x - SHIP_CENTER_X;
  var dz = z - SHIP_CENTER_Z;
  var shipLong = 0.50 + dx * SHIP_AXIS_X + dz * SHIP_AXIS_Z;
  var shipWide = 0.50 + dx * (-SHIP_AXIS_Z) + dz * SHIP_AXIS_X;
  // COVERAGE FIX (report _305) — the marble vein used to eat the port bow.
  //
  // The old grating was
  //   sin((shipLong*2.70 + shipWide*2.10 + 0.66)*PI2) + sin((y*1.30 - shipWide*1.90 + 0.50)*PI2)
  // and on `Left Front Wall` its two terms ran at nearly the same spatial rate
  // in antiphase (d/dy 0.93 against 0.97), because that wall's shipLong, y and
  // shipWide are tightly correlated along its run. Their sum was pinned inside
  // +-0.22 for all 90 of its pixels, so the `emitBlack()` below fired on every
  // one of them, in every frame, forever — the wall was not dim, it was OFF,
  // and no spawn-site change could have reached it because this returns first.
  // Adding a shipLong term to the second grating decorrelates the pair so they
  // cannot run parallel along any flat wall.
  //
  // The seven constants are SOLVED, not tuned by hand, because this grating has
  // three jobs at once and they pull against each other:
  //
  //   1. No flat region may sit entirely inside the vein. `Left Front Wall`
  //      vein share is now 22.2%, and no 20+ pixel group exceeds 41.7%.
  //   2. The SEA takes its family from the sign of this sum, so these constants
  //      also set the sea's pink/blue split. The old grating ran 0.717 pink per
  //      blue and the drops leaned the other way to compensate. This one runs
  //      0.911 / 0.913, a deliberate half-step toward blue: the docs/72 §9
  //      weights value a pink byte at 1.095x a blue one, so a sea at exact
  //      pixel parity puts the PERCEIVED balance on the 1.11 ceiling.
  //   3. docs/72 L2: the sign must not be predictable from which half of an
  //      axis a pixel is on. This is the trap. The FIRST attempt at (1) used a
  //      shipLong rate of -1.92 against the first grating's +2.46; two nearly
  //      opposite rates beat at |2.46-1.92|/2, so the sum's sign held over half
  //      the hull and L2 shipLong predictability hit 0.634 against a 0.35
  //      limit — the exact bilateral split this redesign exists to remove,
  //      reintroduced by a coverage fix. The shipped rates keep every axis at
  //      0.062 or below.
  //
  // Whole-rig designed black lands at 20.1% / 20.5% (contract band 5-45%).
  var marble = sin((shipLong * 3.37 + shipWide * 2.21 + 0.702) * PI2)
             + sin((y * 3.10 - shipWide * 2.38 - shipLong * 2.14 + 0.096) * PI2);
  if (abs(marble) < 0.22) {
    emitBlack();
    return;
  }
  // FOUR sites, one counter-coloured pair per radius phase — the same shape the
  // design specifies, MOVED. The old four clustered around shipWide 0.379 while
  // the rig actually spans 0.320-0.741, and one of them sat off the hull
  // entirely (its nearest pixel was 0.71x its own radius away), so one whole
  // beam side — both Front walls — lay outside every drop and only 55.8% of the
  // 720 ship-field pixels could EVER be inked. These four are the minimax
  // covering centres of the real pixel cloud in this pattern's own weighted
  // metric: the farthest pixel on the ship is 0.293 from a site, and 0.264 for
  // every group bigger than four pixels, against a maximum radius of 0.325.
  //
  // Each phase's PAIR spans the hull end to end (0.764 against 0.093, then
  // 1.010 against 0.193) rather than sitting at the same end. That is a balance
  // requirement, not a taste one: within a phase the two drops split the rig
  // between them, so a pair whose two sites are co-located hands most of the
  // ink to whichever one is nearer the middle. Paired across the hull, the two
  // families take comparable territory and the per-frame energy stays inside
  // the feint band.
  //
  // FOUR and not more, deliberately. An eight-site version was measured and
  // reached 100% coverage with margin, but eight simultaneous blooms own so
  // much of the rig at once that docs/72 L2 shipLong predictability went to
  // 0.483 against a 0.35 limit — with few large territories the ink itself
  // becomes the bilateral split. The static 50/50 sea is what keeps this
  // pattern's L2 honest, so the ink must stay a minority of the rig.
  var dropCap = 0.260 + liveReach * 0.110;
  var radEarly = max(0.02, dropCap * bloomEarly);
  var radLate = max(0.02, dropCap * bloomLate);
  var d0l = shipLong - 0.737;
  var d0y = y - 0.430;
  var d0w = shipWide - 0.642;
  var d1l = shipLong - 0.470;
  var d1y = y - 0.414;
  var d1w = shipWide - 0.611;
  var d2l = shipLong - 0.812;
  var d2y = y - 0.298;
  var d2w = shipWide - 0.363;
  var d3l = shipLong - 0.206;
  var d3y = y - 0.493;
  var d3w = shipWide - 0.537;
  var n0 = sqrt(d0l * d0l + d0y * d0y * 0.50 + d0w * d0w * 0.60) / radEarly;
  var n1 = sqrt(d1l * d1l + d1y * d1y * 0.50 + d1w * d1w * 0.60) / radEarly;
  var n2 = sqrt(d2l * d2l + d2y * d2y * 0.50 + d2w * d2w * 0.60) / radLate;
  var n3 = sqrt(d3l * d3l + d3y * d3y * 0.50 + d3w * d3w * 0.60) / radLate;
  // Which half of each pair is pink was SOLVED against the balance metrics, not
  // chosen: the four assignments measure perceived balance 0.868 / 1.084 /
  // 0.997 / 1.227 on titanic, because the two sites in a pair capture unequal
  // shares of the real pixel cloud and the family that lands on the larger
  // share carries more ink. This is the centred one (0.997 titanic, 1.021
  // bench). It is a placement decision, NOT a per-pattern gain — the authority
  // block above is still byte-identical to every other keeper.
  var nearest = n0;
  var inkBlue = 0.0;
  if (n1 < nearest) {
    nearest = n1;
    inkBlue = 1.0;
  }
  if (n2 < nearest) {
    nearest = n2;
    inkBlue = 1.0;
  }
  if (n3 < nearest) {
    nearest = n3;
    inkBlue = 0.0;
  }
  if (nearest < 1.0) {
    // EVERY DROP CARRIES BOTH FAMILIES: a core in its own colour inside a halo
    // of the other. The split radius is 0.79 because a ball's volume is half
    // spent at 0.5^(1/3) = 0.794 of its radius, so core and halo hold roughly
    // equal numbers of pixels.
    //
    // This is not decoration, it is what makes the pattern's coverage fix
    // possible. Two sites per radius phase partition the rig between them, so a
    // monochrome drop makes the ink itself a plane split: at the coverage this
    // wave needs, the assignments that balanced the colours measured docs/72 L2
    // shipLong 0.48 against a 0.35 limit, and the assignments that satisfied L2
    // measured perceived balance 0.637 or 1.133 against a 0.90-1.11 window.
    // There was no assignment that did both. A drop that is internally 50/50
    // removes the choice: neither family can be predicted from which half of an
    // axis a pixel sits in, and neither can win on area, whatever the Voronoi
    // cells happen to be. The counter-coloured PAIR law is untouched — one pink
    // and one blue drop still open together at the same radius.
    if (nearest > 0.79) inkBlue = 1.0 - inkBlue;
    // CRISPER DROPS. The old profile ramped linearly from rim to core under a
    // flat bright band covering the outer 14% of the radius — a wide soft halo
    // that read as a blob at fifty feet. The body keeps its brightness (that is
    // what holds the >=8% bright-structure floor), but the edge is now three
    // bands instead of one: a dark shoulder, then a narrow bright rim, then the
    // sea. The rim reads as a drawn line because it has darkness on both sides.
    var reach = 1.0 - nearest;
    var inkLevel = 0.46 + reach * 0.32
                 + wave(shimmerClock * 0.5 + nearest * 1.2) * 0.08;
    if (nearest > 0.90) inkLevel = 0.95;
    else if (nearest > 0.82) inkLevel = 0.24;
    if (inkBlue > 0.5) emitBlue(inkLevel);
    else emitPink(inkLevel);
    return;
  }
  var seaLevel = 0.40 + wave(shipLong * 0.90 + y * 0.60 - shimmerClock * 0.35) * 0.44;
  if (marble > 0.0) emitBlue(seaLevel);
  else emitPink(seaLevel);
}
