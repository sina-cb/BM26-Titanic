// DRAFT — pending operator review
/*
  74_calibration_bpm_ruler.js — global SPEED / BPM calibration ruler.

  A cyan line crosses normalized world X once per four-beat reference bar.
  At engine SPEED 0.50 (the 1x clock), the bar lasts exactly 2 seconds, so its
  four full-rig ticks represent 120 BPM. The first tick is a stronger warm-
  white downbeat; the other three are smaller white beat ticks. Dim markers at
  quarter positions make it easy to see whether the runner reaches each point
  on the corresponding song beat.

  This is deliberately a clocked calibration utility, not a production look:
  it has NO localSpeed because that would contaminate the global SPEED
  measurement. `t` is already scaled by the engine's global clock. It uses no
  views, fixture metadata, or model-sized state, so it is portable across the
  Titanic, test_bench, and future scenes.

  Fixed cyan, magenta, and warm-white diagnostic colors intentionally opt out
  of the show palette. Logical white always drives matched W and A lanes.

  CONTROLS
    - phaseOffset : align the strong downbeat to the song without changing rate.
    - lineWidth   : runner and quarter-marker width.
    - level       : overall output level.
    - background  : visibility floor between the ruler marks.
*/

export var phaseOffset = 0.0;
export function sliderPhaseOffset(v) { phaseOffset = v; }

export var lineWidth = 0.28;
export function sliderWidth(v) { lineWidth = v; }

export var level = 0.8;
export function sliderLevel(v) { level = v; }

export var background = 0.18;
export function sliderBackground(v) { background = v; }

var barPhase = 0.0;
var beatPhase = 0.0;
var beatNumber = 0.0;

export function beforeRender(delta) {
  barPhase = frac(t * 0.5 + phaseOffset);
  if (barPhase < 0.0) barPhase = barPhase + 1.0;

  var beatPosition = barPhase * 4.0;
  beatNumber = floor(beatPosition);
  beatPhase = beatPosition - beatNumber;
}

export function render3D(index, x, y, z) {
  var runnerWidth = 0.006 + lineWidth * 0.055;
  var markerWidth = 0.004 + lineWidth * 0.010;

  var runnerDistance = abs(x - barPhase);
  var runner = 1.0 - smoothstep(runnerWidth, runnerWidth * 2.2, runnerDistance);

  var markerDistance = min(abs(x - 0.25), abs(x - 0.5));
  markerDistance = min(markerDistance, abs(x - 0.75));
  var marker = 1.0 - smoothstep(markerWidth, markerWidth * 2.0, markerDistance);

  var beatTick = 1.0 - smoothstep(0.0, 0.16, beatPhase);
  var downbeatTick = beatTick * (beatNumber == 0.0);
  var floorLevel = 0.004 + background * 0.07;

  var outR = floorLevel * 0.18 + marker * 0.18 + runner * 0.04
    + beatTick * 0.08 + downbeatTick * 0.34;
  var outG = floorLevel * 0.30 + marker * 0.03 + runner * 0.82
    + beatTick * 0.08 + downbeatTick * 0.16;
  var outB = floorLevel + marker * 0.16 + runner
    + beatTick * 0.08 + downbeatTick * 0.03;
  var outW = beatTick * 0.15 + downbeatTick * 0.45;

  rgbwau(outR * level, outG * level, outB * level,
         outW * level, outW * level, 0.0);
}
