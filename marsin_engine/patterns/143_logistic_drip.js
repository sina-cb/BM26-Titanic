/*
  143_logistic_drip.js — "Logistic Drip"

  THE LOGISTIC MAP, made visible. Each MODULE runs its own iteration of
  x <- r*x*(1 - x), the textbook route to chaos, and every iterate releases a drip
  at u = x that then slides downstream with a soft tail and a splash where it
  crosses the seam. With `chaos` low the map is periodic and the drips fall in a
  steady rhythm at the same two or four places; raise it through the
  period-doubling cascade and the rhythm splits, splits again, and finally breaks
  into irregular drips that never repeat. You are watching a bifurcation diagram
  fall down a wall.

  GEOMETRY (rig-agnostic — normalized render3D coords only)
    u = x        position along the line (0..1 over the whole 330 px run).
    SEAM         used as a FEATURE here: a drip crossing the Seg1/Seg2 boundary
                 throws a `splash` of foam, because that is where the run
                 narrows and the water has to speed up.
    moduleId     derived from z alone: floor(nz * 6) clamped to 0..5.
    Per-module character: each module's control parameter r is offset by
    0.02*moduleId, which is enough to put one module in a clean period-2 rhythm
    while its neighbour is already chaotic.

  Nothing here reads fixtureType, section, group or index, so the composition is
  identical on test_bench / titanic / any other model.

  SMOOTHNESS: a drip fades IN over its first 2% of travel and fades OUT over the
  last 15%, so nothing ever pops on or off; and a drip's position is derived from
  an accumulated travel phase rather than from wall time, so changing localSpeed
  changes the pace without teleporting anything.

AUDIO_MODULATION_V1:
  sliderChaos  <- micFlux range 0.30..0.90 curve linear  # builds drive the map through the cascade
  sliderSplash <- micKick range 0.20..1.00 curve pow2    # the kick throws foam at the seam
  # STATIC: localSpeed, tail, whiteFoam, moduleHueShift, hueShiftFreq, colorPalette1/2
*/

// Export order is physical MIDI order. Local Speed is always first; this
// composition has no direction control (drips only ever fall downstream). The
// shared per-module hue shift pair is always declared LAST.
export var localSpeed = 0.46;
export var chaos = 0.30;
export var tail = 0.50;
export var splash = 0.20;
export var whiteFoam = 0.40;
export var moduleHueShift = 0.50;
export var hueShiftFreq = 0.30;

export var cp1H = 0.55, cp1S = 1.00, cp1V = 0.90; // deep teal-blue wet line
export var cp2H = 0.09, cp2S = 0.50, cp2V = 1.00; // warm amber-white drip head
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderChaos(v) { chaos = v; }
export function sliderTail(v) { tail = v; }
export function sliderSplash(v) { splash = v; }
export function sliderWhiteFoam(v) { whiteFoam = v; }
export function sliderModuleHueShift(v) { moduleHueShift = v; }
export function sliderHueShiftFreq(v) { hueShiftFreq = v; }

// ── Shared interior idiom (identical in 131-145) ─────────────────────────────
var SEAM = 0.5454545;         // Seg1/Seg2 boundary in normalized u (world x = 0.5)
var SEG2_FLOW = 1.15;         // downstream narrows: Seg2 runs ~15% faster
var PHI = 1.6180339;
var SQRT2 = 1.4142136;
var GOLDEN_ANGLE = 0.3819660; // 1 - 1/PHI — per-module step, never 1/6
var PHASE_WRAP = 10000.0;
var HUE_SHIFT_MAX = 0.054;    // hue-shift amplitude (~19 deg). Under the spec's
                              // 0.06 hard cap with margin: the cap is on the
                              // MEASURED output, and an 8-bit RGB frame only
                              // resolves hue to a few thousandths of a turn.

function clamp01(v) {
  if (v < 0.0) return 0.0;
  if (v > 1.0) return 1.0;
  return v;
}

// Module identity from geometry only: the six MODULES are parallel lines spread
// evenly along z, so nz alone names the module — floor(nz * 6) clamped to 0..5.
// Modules 1-3 (BoilderRoom-A) land on 0..2, modules 4-6 (BoilderRoom-B) on 3..5.
function moduleIdOf(zz) {
  var mid = floor(clamp01(zz) * 6.0);
  if (mid > 5.0) mid = 5.0;
  return mid;
}

// Continuous travel coordinate: Seg2 is compressed by SEG2_FLOW so the same
// phase covers more physical line there — the current speeds up downstream
// without a seam in the wave itself.
function travelOf(uu) {
  if (uu < SEAM) return uu;
  return SEAM + (uu - SEAM) / SEG2_FLOW;
}

// ── Shared per-module hue shift (identical in 136-145) ───────────────────────
// dH_m(t) = A * sin(2*pi*f*t + m * GOLDEN_ANGLE * 2*pi), with
// A = HUE_SHIFT_MAX * moduleHueShift and f = 0.005 + 0.095*hueShiftFreq^2 Hz.
// `wave(p)` IS 0.5 + 0.5*sin(2*pi*p); the phase is accumulated ALREADY SCALED by
// f, so the PHASE_WRAP (an integer number of turns) is exactly continuous and a
// slider move never steps. Only the HUE moves; at moduleHueShift 0 the baked
// palette equals the un-shifted palette exactly.
var hueShiftPhase = 0.0;
var bakeCursor = 0.0;         // round-robin pointer for the palette bake
var baked = 0;
var mp1r = array(6);
var mp1g = array(6);
var mp1b = array(6);
var mp2r = array(6);
var mp2g = array(6);
var mp2b = array(6);

function _hsvBake(hh, ss, vv, mm, slot) {
  var hv = hh - floor(hh); if (hv < 0.0) hv += 1.0;
  var iv = floor(hv * 6.0) % 6;
  var fv = hv * 6.0 - floor(hv * 6.0);
  var pv = vv * (1.0 - ss);
  var qv = vv * (1.0 - fv * ss);
  var tv = vv * (1.0 - (1.0 - fv) * ss);
  var rr = vv; var gg = tv; var bb = pv;
  if      (iv == 1) { rr = qv;   gg = vv;   bb = pv;   }
  else if (iv == 2) { rr = pv;   gg = vv;   bb = tv;   }
  else if (iv == 3) { rr = pv;   gg = qv;   bb = vv;   }
  else if (iv == 4) { rr = tv;   gg = pv;   bb = vv;   }
  else if (iv == 5) { rr = vv;   gg = pv;   bb = qv;   }
  if (slot == 1) { mp1r[mm] = rr; mp1g[mm] = gg; mp1b[mm] = bb; }
  else           { mp2r[mm] = rr; mp2g[mm] = gg; mp2b[mm] = bb; }
}

function _advanceHueShift(dt) {
  var hf = clamp01(hueShiftFreq);
  hueShiftPhase = hueShiftPhase + dt * (0.005 + 0.095 * hf * hf);
  if (hueShiftPhase >= PHASE_WRAP) hueShiftPhase = hueShiftPhase - PHASE_WRAP;
}

function _bakeOne(mm) {
  var amp = HUE_SHIFT_MAX * clamp01(moduleHueShift);
  var dh = amp * (2.0 * wave(hueShiftPhase + mm * GOLDEN_ANGLE) - 1.0);
  _hsvBake(cp1H + dh, cp1S, cp1V, mm, 1);
  _hsvBake(cp2H + dh, cp2S, cp2V, mm, 2);
}

// The VM caps beforeRender at ~2000 bytecode instructions PER FRAME (measured:
// past the cap the rest of beforeRender is silently skipped), and a full
// six-module HSV bake alone is a third of that. The hue shift is a slow sine —
// one full cycle is 10 s even at hueShiftFreq 1 — so ONE module is re-baked per
// frame, round-robin: every module is current within 6 frames (150 ms, 1/66 of
// the fastest cycle), which is still perfectly smooth, and the rest of the
// budget stays with the composition. The first frame bakes all six, so no
// module is ever unlit.
function _bakeModulePalettes() {
  if (baked == 0) {
    for (var mm = 0; mm < 6; mm++) _bakeOne(mm);
    baked = 1;
  } else {
    _bakeOne(bakeCursor);
    bakeCursor = bakeCursor + 1.0;
    if (bakeCursor > 5.0) bakeCursor = 0.0;
  }
}


// ── The maps and their drips ─────────────────────────────────────────────────
var DRIPS = 8;             // drips in flight per module (a ring buffer)
var BASE_RATE = 0.1900;    // travel: runs per second at localSpeed 0.5
var TICK_RATE = 0.5600;    // map iterations per second at localSpeed 0.5
var FADE_IN = 0.020;       // travel over which a new drip fades in (~150 ms)

var travel = 0.0;          // accumulated downstream travel, in runs
var tickPhase = 0.0;       // accumulated map iterations
var lgx = array(6);        // each module's logistic state
var lastTick = array(6);   // last integer tick each module acted on
var drIdx = array(6);      // ring-buffer write cursor per module
var drPos = array(48);     // launch position of each drip
var drBorn = array(48);    // travel phase at which it was launched
var seeded = 0;

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  _advanceHueShift(dt);
  _bakeModulePalettes();

  if (seeded == 0) {
    for (var mm = 0; mm < 6; mm++) {
      lgx[mm] = 0.30 + 0.4 * ((mm * SQRT2) % 1.0);
      lastTick[mm] = -1.0;
      drIdx[mm] = 0.0;
    }
    for (var kk = 0; kk < 48; kk++) { drPos[kk] = 0.0; drBorn[kk] = -9.0; }
    seeded = 1;
  }

  var localGain = pow(2.0, (clamp01(localSpeed) - 0.5) * 4.0);

  travel = travel + dt * BASE_RATE * localGain;
  if (travel >= PHASE_WRAP) travel = travel - PHASE_WRAP;
  tickPhase = tickPhase + dt * TICK_RATE * localGain;
  if (tickPhase >= PHASE_WRAP) tickPhase = tickPhase - PHASE_WRAP;

  // r sweeps 3.20..3.90 — periodic, then period-2, 4, 8, then chaos. The
  // per-module offset puts each line at a different point of the cascade.
  var rBase = 3.2000 + clamp01(chaos) * 0.7000;

  for (var ma = 0; ma < 6; ma++) {
    // Each module's clock is offset by the golden angle, so the six modules
    // never drip on the same beat.
    var tn = floor(tickPhase + ma * GOLDEN_ANGLE);
    if (tn != lastTick[ma]) {
      lastTick[ma] = tn;
      var rr = rBase + 0.0200 * ma;
      var xx = lgx[ma] * rr * (1.0 - lgx[ma]);
      if (xx < 0.0020) xx = 0.0020;
      if (xx > 0.9980) xx = 0.9980;
      lgx[ma] = xx;
      var slot = ma * DRIPS + drIdx[ma];
      drPos[slot] = xx;
      drBorn[slot] = travel;
      drIdx[ma] = drIdx[ma] + 1.0;
      if (drIdx[ma] > DRIPS - 1.0) drIdx[ma] = 0.0;
    }
  }
}

export function render3D(index, x, y, z) {
  var u = clamp01(x);
  var s = travelOf(u);
  var mid = moduleIdOf(z);
  var bas = mid * DRIPS;

  var tl = clamp01(tail);
  var tailLen = 0.030 + tl * 0.130;
  var sp = clamp01(splash);

  var wet = 0.0;
  var head = 0.0;
  var splashAmt = 0.0;

  for (var kk = 0; kk < DRIPS; kk++) {
    var age = travel - drBorn[bas + kk];
    if (age < 0.0) age = 0.0;
    var pos = drPos[bas + kk] + age;
    if (pos <= 1.1) {
      // Fade in over the first 2% of travel, fade out over the last 15% of the
      // run: a drip never appears or vanishes on a frame boundary.
      var life = clamp01(age / FADE_IN) * clamp01((1.10 - pos) / 0.150);
      if (drBorn[bas + kk] > -1.0) {
        var dd = pos - s;
        var gg = 0.0;
        if (dd >= 0.0) gg = exp(0.0 - dd / tailLen);        // the trailing tail
        else gg = exp(dd / 0.012);                          // the sharp leading face
        wet = wet + gg * life * 0.80;
        head = head + pow(gg, 6.00) * life;
        // The seam is where the run narrows: a drip crossing it throws foam.
        splashAmt = splashAmt + life * exp(0.0 - abs(pos - SEAM) / 0.045) * pow(gg, 3.00);
      }
    }
  }

  wet = clamp01(wet);
  head = clamp01(head);
  splashAmt = clamp01(splashAmt * sp * 1.60);

  // Shaped wet sheen floor — the strand is always damp between drips.
  var bri = clamp01(0.130 + 0.300 * wet + 0.240 * head + 0.130 * splashAmt);

  // cp2 is an ACCENT on the drip HEAD and the splash, never a co-lead.
  var mix = clamp01(head * 0.22 + splashAmt * 0.20);

  var r = (mp1r[mid] + (mp2r[mid] - mp1r[mid]) * mix) * bri;
  var g = (mp1g[mid] + (mp2g[mid] - mp1g[mid]) * mix) * bri;
  var b = (mp1b[mid] + (mp2b[mid] - mp1b[mid]) * mix) * bri;

  var foam = clamp01(head * 0.90 + splashAmt * 1.20) * clamp01(whiteFoam) * 0.90;
  if (foam > 0.0) {
    var mx = r;
    if (g > mx) mx = g;
    if (b > mx) mx = b;
    r = r + (mx - r) * foam;
    g = g + (mx - g) * foam;
    b = b + (mx - b) * foam;
  }

  rgb(clamp01(r), clamp01(g), clamp01(b));
}
