/*
  134_surge.js — "Surge"

  The sound-reactive INTERIOR primary. A quiet floor current runs the whole
  length of every line (a dim river_run), and on top of it a KICK launches a
  bright wavefront from the head of the line that crosses all 330 px in about
  1.2 seconds, flashing whiteFoam at the Seg1/Seg2 lip as it goes over.

  Bass level widens the wavefront; the flux band drives the clock. At rest,
  with no audio at all, the piece still breathes: the floor current keeps
  moving and an ambient surge fires by itself roughly every eight seconds, so
  a silent room is never a dead room.

  `stagger` at 0 fires all six modules in unison; turned up, the surge ripples
  across the room in module order (1 -> 6).

  WAVEFRONT BANK — why there is a ring buffer here
    A new onset must never CANCEL the wavefront already crossing the room.
    Fronts live in an 8-slot ring: an onset writes a NEW slot (age 0, its own
    birth amplitude) and touches nothing else, so every in-flight front keeps
    its position and rides its own envelope to zero. render3D SUMS the live
    fronts, so a burst of kicks stacks into a brighter, wider surge instead of
    chopping the previous one off mid-travel. Slots retire only once their
    envelope has reached 0 on the LAST module to fire (age > LIFE + the stagger
    lag), so a retirement is never a visible edge; the ring cursor recycles the
    OLDEST (most faded) slot when all eight are busy. Nothing in this pattern is
    ever rewound or zeroed by audio: floorPhase, every fAge and surgeEnv only
    ever move forward or smoothly.

  GEOMETRY (rig-agnostic — normalized render3D coords only)
    u = x, SEAM = the Seg1/Seg2 boundary (world x = 0.5 -> u ~ 0.545),
    lineId from z as in 131_river_run (floor(nz * 6), one id per module).

AUDIO_MODULATION_V1:
  sliderSurge      <- micKick range 0.00..1.00 curve linear # every kick launches a wavefront
  sliderWidth      <- micLow  range 0.30..0.80 curve linear # bass level widens the front
  sliderLocalSpeed <- micFlux range 0.30..0.70 curve linear # builds drive the whole clock
  # STATIC: direction, stagger, whiteFoam, colorPalette1/2
*/

// Export order is physical MIDI order. Local Speed first, Direction second.
export var localSpeed = 0.50;
export var direction = 0.72;
export var surge = 0.00;
export var width = 0.40;
export var stagger = 0.40;
export var whiteFoam = 0.55;

export var cp1H = 0.55, cp1S = 1.00, cp1V = 0.90; // deep teal-blue floor current
export var cp2H = 0.09, cp2S = 0.50, cp2V = 1.00; // warm amber-white wavefront
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderDirection(v) { direction = v; }
export function sliderSurge(v) { surge = v; }
export function sliderWidth(v) { width = v; }
export function sliderStagger(v) { stagger = v; }
export function sliderWhiteFoam(v) { whiteFoam = v; }

var SEAM = 0.5454545;
var SEG2_FLOW = 1.15;
var PHI = 1.6180339;
var GOLDEN_ANGLE = 0.3819660;
var PHASE_WRAP = 10000.0;
var FLOOR_RATE = 0.1180;   // floor current cycles/sec at localSpeed 0.5
var TRAVEL_SEC = 1.2;      // head of the line to the tail, one wavefront
var LIFE = 1.5;            // = 1.25 * TRAVEL_SEC: age at which a front is spent
var DEAD = 99.0;           // sentinel age for an empty slot (fails the LIFE test)
var AMBIENT_SEC = 8.0;     // self-launch cadence when nothing is driving surge
var RETRIGGER_SEC = 0.07;  // input debounce, REAL seconds (~3 frames at 40 fps)
var TRIGGER = 0.55;        // surge level that counts as a kick
var STAGGER_SEC = 0.16;    // per-lineId launch delay at stagger 1
var ENV_ATTACK = 0.18;     // surgeEnv follower, seconds (rise)
var ENV_RELEASE = 0.45;    // surgeEnv follower, seconds (fall)

var floorPhase = 0.0;
var prevSurge = 0.0;
var flowSign = 1.0;

// Wavefront ring, 8 slots (16 of the VM's ~250 array cells). fAge[k] = seconds
// of LOCAL clock since slot k launched (DEAD = empty); fAmp[k] = the birth
// amplitude that slot decays from. The 8 is written as a literal at every loop
// bound and array() below so the two can never drift apart.
var fAge = array(8);
var fAmp = array(8);
var fIdx = 0.0;            // ring write cursor — O(1), always the oldest slot
var seeded = 0;
var sinceLaunch = 99.0;    // local-clock seconds since the last launch (ambient)
var debounce = 99.0;       // REAL seconds since the last launch (retrigger guard)
var surgeEnv = 0.0;        // smoothed surge — a global gain that never steps

var pr1 = 0.0, pg1 = 0.6, pb1 = 0.9;
var pr2 = 1.0, pg2 = 0.8, pb2 = 0.5;

function clamp01(v) {
  if (v < 0.0) return 0.0;
  if (v > 1.0) return 1.0;
  return v;
}

function smoothUnit(v) {
  v = clamp01(v);
  return v * v * (3.0 - 2.0 * v);
}

function _hsv2rgb1() {
  var hv = cp1H - floor(cp1H); if (hv < 0.0) hv += 1.0;
  var iv = floor(hv * 6.0) % 6;
  var fv = hv * 6.0 - floor(hv * 6.0);
  var pv = cp1V * (1.0 - cp1S);
  var qv = cp1V * (1.0 - fv * cp1S);
  var tv = cp1V * (1.0 - (1.0 - fv) * cp1S);
  if      (iv == 0) { pr1 = cp1V; pg1 = tv;   pb1 = pv;   }
  else if (iv == 1) { pr1 = qv;   pg1 = cp1V; pb1 = pv;   }
  else if (iv == 2) { pr1 = pv;   pg1 = cp1V; pb1 = tv;   }
  else if (iv == 3) { pr1 = pv;   pg1 = qv;   pb1 = cp1V; }
  else if (iv == 4) { pr1 = tv;   pg1 = pv;   pb1 = cp1V; }
  else              { pr1 = cp1V; pg1 = pv;   pb1 = qv;   }
}

function _hsv2rgb2() {
  var hv = cp2H - floor(cp2H); if (hv < 0.0) hv += 1.0;
  var iv = floor(hv * 6.0) % 6;
  var fv = hv * 6.0 - floor(hv * 6.0);
  var pv = cp2V * (1.0 - cp2S);
  var qv = cp2V * (1.0 - fv * cp2S);
  var tv = cp2V * (1.0 - (1.0 - fv) * cp2S);
  if      (iv == 0) { pr2 = cp2V; pg2 = tv;   pb2 = pv;   }
  else if (iv == 1) { pr2 = qv;   pg2 = cp2V; pb2 = pv;   }
  else if (iv == 2) { pr2 = pv;   pg2 = cp2V; pb2 = tv;   }
  else if (iv == 3) { pr2 = pv;   pg2 = qv;   pb2 = cp2V; }
  else if (iv == 4) { pr2 = tv;   pg2 = pv;   pb2 = cp2V; }
  else              { pr2 = cp2V; pg2 = pv;   pb2 = qv;   }
}

// Line identity from geometry only: the six MODULES are parallel lines spread
// evenly along z, so nz alone names the line — floor(nz * 6) clamped to 0..5.
// Modules 1-3 (BoilderRoom-A) land on 0..2, modules 4-6 (BoilderRoom-B) on 3..5.
// Cheap floor math, no fixture metadata; on a model whose pixels share one z
// this collapses to a single line and the composition still runs.
function lineIdOf(zz) {
  var lid = floor(clamp01(zz) * 6.0);
  if (lid > 5.0) lid = 5.0;
  return lid;
}

function travelOf(uu) {
  if (uu < SEAM) return uu;
  return SEAM + (uu - SEAM) / SEG2_FLOW;
}

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  _hsv2rgb1();
  _hsv2rgb2();

  if (seeded == 0) {
    for (var k = 0; k < 8; k++) { fAge[k] = DEAD; fAmp[k] = 0.0; }
    seeded = 1;
  }

  var localGain = pow(2.0, (clamp01(localSpeed) - 0.5) * 4.0);

  var dSign = 1.0;
  if (clamp01(direction) < 0.5) dSign = -1.0;
  flowSign = dSign;
  var dMag = 0.30 + 1.40 * abs(clamp01(direction) - 0.5) * 2.0;

  floorPhase = floorPhase + dt * FLOOR_RATE * localGain * dSign * dMag;
  if (floorPhase >= PHASE_WRAP) floorPhase = floorPhase - PHASE_WRAP;
  if (floorPhase <= 0.0 - PHASE_WRAP) floorPhase = floorPhase + PHASE_WRAP;

  // Every live front advances on the SAME clock, monotonically. A slot retires
  // only once its tail envelope has already reached 0, so retirement is not an
  // edge; nothing here is ever rewound by an onset.
  // The retirement threshold carries the stagger lag: render3D reads slot k at
  // (fAge[k] - lineId * stagger * STAGGER_SEC), so the LAST module to fire is
  // still mid-travel when fAge passes LIFE. Retiring on the bare LIFE would
  // chop that module's front off exactly the way an onset used to.
  var hold = LIFE + 5.0 * clamp01(stagger) * STAGGER_SEC;
  for (var k = 0; k < 8; k++) {
    if (fAge[k] < DEAD) {
      fAge[k] = fAge[k] + dt * localGain;
      if (fAge[k] > hold) fAge[k] = DEAD;
    }
  }

  sinceLaunch = sinceLaunch + dt * localGain;
  if (sinceLaunch > DEAD) sinceLaunch = DEAD;
  debounce = debounce + dt;
  if (debounce > DEAD) debounce = DEAD;

  var s = clamp01(surge);

  // Smoothed follower. The live kick value lifts the whole bank, but only
  // through this one-pole, so a spike RAISES the room over ~180 ms instead of
  // stepping it — the control stays audibly (and measurably) live without the
  // in-flight fronts flashing on every onset. It rests at 1.0x, so with no
  // audio at all this pattern renders bit-identically to the single-front
  // version it replaces.
  var kf = ENV_RELEASE;
  if (s > surgeEnv) kf = ENV_ATTACK;
  kf = clamp01(dt / kf);
  surgeEnv = surgeEnv + (s - surgeEnv) * kf;

  // Edge-triggered launch on a rising kick, plus a self-launch so the piece
  // still breathes with no audio at all (never a dead room — codex mission).
  // A launch INJECTS a new front into a free ring slot; it never touches the
  // fronts already crossing the room.
  var launch = 0;
  if (s > TRIGGER && prevSurge <= TRIGGER && debounce > RETRIGGER_SEC) launch = 1;
  if (sinceLaunch > AMBIENT_SEC) launch = 1;
  if (launch == 1) {
    fAge[fIdx] = 0.0;
    fAmp[fIdx] = 0.55 + s * 0.45;
    fIdx = fIdx + 1.0;
    if (fIdx > 7.0) fIdx = 0.0;
    sinceLaunch = 0.0;
    debounce = 0.0;
  }
  prevSurge = s;
}

export function render3D(index, x, y, z) {
  var u = clamp01(x);
  var s = travelOf(u);
  var lid = lineIdOf(z);

  // ── Floor current: a dim river that runs whether or not anything is playing.
  var f1 = wave(s * 1.7208 - floorPhase + lid * GOLDEN_ANGLE);
  var f2 = wave(s * 2.7841 - floorPhase * PHI + lid * 0.2360679);
  var flr = f1 * 0.60 + f2 * 0.40;
  var bri = 0.03 + flr * 0.12;

  // ── Wavefront bank. stagger 0 fires all six modules together; turned up it
  //    ripples across the room in lineId (module 1 -> 6) order. Every live slot
  //    contributes; they SUM, so a new onset adds light on top of the fronts
  //    still in flight rather than replacing them.
  var st = lid * clamp01(stagger) * STAGGER_SEC;
  var w = 0.035 + clamp01(width) * 0.300;
  var gain = 1.0 + surgeEnv * 0.20;
  var du = abs(u - SEAM);
  var frontSum = 0.0;
  var foamSum = 0.0;
  for (var k = 0; k < 8; k++) {
    var age = fAge[k] - st;
    if (age >= 0.0 && age <= LIFE) {
      var travel = age / TRAVEL_SEC;
      var pos = travel;
      if (flowSign < 0.0) pos = 1.0 - travel;
      // Early-out: smoothUnit() is already 0 outside the front's half-width, so
      // this guard is exact — it just keeps the 8-slot sweep cheap on the ~95 %
      // of pixels no given front is touching.
      var dp = abs(u - pos);
      if (dp < w) {
        var fr = smoothUnit(1.0 - dp / w);
        fr = fr * clamp01((1.25 - travel) / 0.25);
        fr = fr * fAmp[k] * gain;
        frontSum = frontSum + fr;
        foamSum = foamSum + fr * 0.80;
        // whiteFoam flashes at the lip as THIS front goes over the seam.
        if (du < 0.05) {
          var lipFlash = smoothUnit(1.0 - abs(pos - SEAM) / 0.06)
                       * smoothUnit(1.0 - du / 0.05);
          foamSum = foamSum + lipFlash * fr * 1.40;
        }
      }
    }
  }

  bri = clamp01(bri + frontSum * 0.84);
  var mix = clamp01(frontSum * 1.10);

  var r = (pr1 + (pr2 - pr1) * mix) * bri;
  var g = (pg1 + (pg2 - pg1) * mix) * bri;
  var b = (pb1 + (pb2 - pb1) * mix) * bri;

  var foam = clamp01(foamSum) * clamp01(whiteFoam) * 0.90;
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
