/*
  46_dome_lockdown.js
  Security-lockdown reveal: red/amber rotating beacons on each edge (1-1-1
  cascade) sweep the dome while bars run security-strobe chases at <=3 Hz.
  TrianglePars flash red as alarm indicators in a 1-1-1 offset cascade.
  Blackout phase is brief, deliberate punctuation (<=25% of cycle, slider).

  E2 par visibility push: each par now holds a per-par amber simmer between
  flashes so the alarm indicators are always glowing, with an undampened
  brightness path that lets ON-flashes punch (floor ≥ 0.20, peak ≥ 0.80).
*/

export var localSpeed = 0.5;
export var beaconWidth = 0.45;
export var beaconPunch = 0.78;
export var strobeRate = 0.45;       // mapped to <= 3 Hz on bars
export var alarmCadence = 0.55;     // par flash cadence (Hz mapped)
export var spinDirection = 1.0;
export var holdBlackout = 0.15;     // 0..0.25 of cycle blacked out
export var amberMix = 0.45;
export var blackoutDepth = 0.30;    // never lets the rig fully die

export var cp1H = 0.00, cp1S = 0.96, cp1V = 0.85;   // red
export var cp2H = 0.08, cp2S = 0.92, cp2V = 0.80;   // amber/orange
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderBeaconWidth(v) { beaconWidth = v; }
export function sliderBeaconPunch(v) { beaconPunch = v; }
export function sliderStrobeRate(v) { strobeRate = v; }
export function sliderAlarmCadence(v) { alarmCadence = v; }
export function sliderSpinDirection(v) { spinDirection = v; }
export function sliderHoldBlackout(v) { holdBlackout = v; }
export function sliderAmberMix(v) { amberMix = v; }
export function sliderBlackoutDepth(v) { blackoutDepth = v; }

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

function clamp01(v) { if (v < 0.0) return 0.0; if (v > 1.0) return 1.0; return v; }
function wrap01(v) { v = v % 1.0; if (v < 0.0) v += 1.0; return v; }
function circDist(a, b) { var d = abs(a - b); if (d > 0.5) d = 1.0 - d; return d; }
function softPulse(dist, width) { var xVal = clamp01(1.0 - dist / width); return xVal * xVal * (3.0 - 2.0 * xVal); }

var tCycle = 0.0;     // door / blackout-hold cycle
var tBeacon = 0.0;    // beacon rotation
var tStrobe = 0.0;    // bar strobe phase (Hz capped)
var tAlarm = 0.0;     // par alarm phase

export function beforeRender(delta) {
  var localMult = pow(2.0, (localSpeed - 0.5) * 4.0);
  var dt = (delta / 1310.72) * localMult;
  var dir = spinDirection * 2.0 - 1.0;        // -1..+1

  tCycle  = wrap01(tCycle  + dt * 0.040);     // slow lockdown breath
  tBeacon = wrap01(tBeacon + dt * dir * (0.35 + 0.50));
  // Cap strobe at ~3 Hz. delta is ms, so cap = 3 cycles/sec * dt-in-seconds.
  // 1 unit of tStrobe per call here scales with (delta/1000) * Hz.
  var strobeHz = strobeRate * 3.0;            // 0..3 Hz hard cap (Rule 5)
  tStrobe = wrap01(tStrobe + (delta / 1000.0) * strobeHz);
  var alarmHz = 0.4 + alarmCadence * 2.0;     // 0.4..2.4 Hz
  tAlarm = wrap01(tAlarm + (delta / 1000.0) * alarmHz);

  _hsv2rgb1();
  _hsv2rgb2();
}

export function render3D(index, x, y, z) {
  var isTriangleEdge = sectionId == 1;
  var isTrianglePar = sectionId == 2 && y > 2.0;
  var isBar = sectionId == 2 && y <= 2.0;
  var isVintage = sectionId == 3;

  var theta = wrap01((atan2(z, x) / PI2) + 0.5);

  // Blackout phase: deliberate, capped to <=25% of the cycle.
  var holdSpan = 0.05 + clamp01(holdBlackout) * 0.20;   // 5..25% (Rule 4 cap)
  var inBlackout = (tCycle < holdSpan) ? 1.0 : 0.0;
  // Soft envelope on entry/exit so we don't snap (Rule 5 safety + look).
  var blackoutGate = 1.0;
  if (inBlackout > 0.5) {
    var distFromEdge = tCycle;
    var fadeIn = clamp01(distFromEdge / 0.04);
    var fadeOut = clamp01((holdSpan - distFromEdge) / 0.04);
    var soft = fadeIn; if (fadeOut < soft) soft = fadeOut;
    blackoutGate = 1.0 - soft;
  }

  // During blackout, the rig is intentionally suppressed but a faint baseline
  // amber pulse stays alive (Codex P0: deliberate dim, not "fall back").
  var stage = 0.0, white = 0.0, amber = 0.0, uv = 0.0;
  var mixv = 0.0;

  if (isTriangleEdge) {
    var edgeId = floor(index / 18.0);
    var edgeT = (index % 18) / 17.0;
    // 3 counter-rotating beacons, one per edge (Rule 1: 1-1-1 cascade).
    var edgeSign = (edgeId == 1) ? -1.0 : 1.0;
    var beaconPhase = wrap01(tBeacon * edgeSign + edgeId / 3.0);
    var beam = softPulse(abs(edgeT - beaconPhase), 0.025 + beaconWidth * 0.090);
    // Each edge gets its own rotating "tail" so motion reads clear.
    var tail = softPulse(abs(edgeT - wrap01(beaconPhase - 0.08 * edgeSign)), 0.060) * 0.45;

    stage = clamp01((beam * (0.65 + beaconPunch * 0.35) + tail * 0.50) * blackoutGate);
    white = clamp01(beam * beaconPunch * 0.70 * blackoutGate);
    amber = clamp01(tail * amberMix * 0.55 * blackoutGate);
    mixv  = clamp01(edgeId / 2.0 + beam * 0.30);
  } else if (isTrianglePar) {
    // Alarm cascade: each par flashes on its own offset (1-1-1, Rule 2 active).
    // E2 push: alarms now hold a persistent red/amber baseline between flashes
    // so the corner indicators are always visible, with a strong ON peak.
    var parId = index - 54;
    var phase = wrap01(tAlarm + parId / 3.0);
    // Square-ish pulse with soft edges; ON for ~25% of cycle.
    var on = (phase < 0.25) ? 1.0 : 0.0;
    var soft = on;
    if (on > 0.5) {
      var p = phase / 0.25;
      // ease-in-out so it's not a hard square (>=3Hz safety since alarmHz<=2.4).
      soft = 1.0 - softPulse(abs(p - 0.5), 0.5) * 0.3;
    }
    // Off-phase amber simmer per par (each par at its own slow phase) so the
    // alarm indicator is always glowing dimly (Rule B floor ≥ 0.18).
    var simmer = 0.22 + 0.18 * wave(tCycle * 6.0 + parId * 0.41);
    soft = soft * blackoutGate;
    var simmerLit = simmer * blackoutGate;

    stage = clamp01(simmerLit + soft * (0.55 + beaconPunch * 0.45));
    white = clamp01(soft * 0.25);              // mostly red-amber, not white
    amber = clamp01(simmerLit * 0.45 + soft * (0.30 + amberMix * 0.50));
    mixv  = parId / 2.0;
  } else if (isBar) {
    var barLocal = index - 57;
    var barIndex = floor(barLocal / 18.0);
    var barT = (barLocal % 18) / 17.0;

    // Strobe gate (<=3 Hz): square with 50% duty.
    var strobeOn = (tStrobe < 0.5) ? 1.0 : 0.0;
    // Chase head running along each bar — different speed than strobe so it
    // looks like a security-light scan rather than a flat flash.
    var chaseHead = wrap01(tBeacon * 1.7 + barIndex * 0.077);
    var chase = softPulse(abs(barT - chaseHead), 0.045 + beaconWidth * 0.060);
    // Azimuthal beacon hit on bars when one of the rotating beacons sweeps by.
    var azBeacon0 = softPulse(circDist(theta, wrap01(tBeacon)), 0.05 + beaconWidth * 0.08);
    var azBeacon1 = softPulse(circDist(theta, wrap01(-tBeacon + 0.333)), 0.05 + beaconWidth * 0.08);
    var azBeacon2 = softPulse(circDist(theta, wrap01(tBeacon * 0.7 + 0.667)), 0.05 + beaconWidth * 0.08);
    var azMax = azBeacon0; if (azBeacon1 > azMax) azMax = azBeacon1; if (azBeacon2 > azMax) azMax = azBeacon2;

    // Persistent red baseline so bars never go dark (Rule 3).
    var baseline = 0.18 + 0.08 * wave(barT * 4.0 + barIndex * 0.13 + tBeacon);
    var strobeKick = strobeOn * strobeRate * 0.55;

    stage = clamp01((baseline + chase * 0.70 + azMax * 0.75 + strobeKick) * blackoutGate);
    white = clamp01((chase * 0.35 + strobeKick * 0.50) * blackoutGate);
    amber = clamp01((azMax * amberMix * 0.45) * blackoutGate);
    mixv  = clamp01(barIndex / 13.0 + azMax * 0.40);
  } else if (isVintage) {
    var vintageLocal = index - 291;
    var fixtureNo = floor(vintageLocal / 6.0);
    // Soft warm flicker that survives blackout for "emergency lighting" feel.
    var filament = 0.45 + 0.30 * wave(tCycle * 4.0 + fixtureNo * 0.31);
    amber = clamp01(filament * (0.30 + amberMix * 0.40));
    stage = amber * 0.15;
    mixv = fixtureNo / 4.0;
  }

  // Floor glow — never let the rig die. Pulled down (but not off) in blackout.
  var floorGlow = (1.0 - blackoutDepth) * 0.022 * (0.35 + 0.65 * blackoutGate);
  var brightness = floorGlow + stage * (0.55 + beaconPunch * 0.25);
  if (isVintage) brightness = floorGlow * 0.40 + stage;
  // Pars: stronger curve so the alarm flashes punch and the simmer is visible.
  if (isTrianglePar) brightness = 0.14 * blackoutGate + stage * (0.78 + beaconPunch * 0.22);

  var r = (pr1 + (pr2 - pr1) * mixv) * brightness;
  var g = (pg1 + (pg2 - pg1) * mixv) * brightness;
  var b = (pb1 + (pb2 - pb1) * mixv) * brightness * 0.30;     // red/amber bias

  rgbwau(clamp01(r), clamp01(g), clamp01(b), clamp01(white), clamp01(amber), clamp01(uv));
}
