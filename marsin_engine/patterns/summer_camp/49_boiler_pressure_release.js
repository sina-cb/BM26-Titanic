/*
  boiler_pressure_release
  Three independent steam puffs travel up the TriangleEdges (one per edgeId
  at phase edgeId/3.0). When a puff completes, the matching TrianglePar
  pulses as a "pressure valve" venting. BarLights render rising steam:
  vertical-leaning bands with brighter top pixels and a slow upward drift.

  Enhancements (D3 push):
  - 1-1-1 cascade across edges; per-edge valve pars (Rule 2 active).
  - Bars: rising steam pixel art + arc bursts on release.
  - Background simmer floor so rig never goes empty.

  E2 par visibility push: each par now carries a "fill curve" (pressure gauge)
  on top of its halo so the valve indicator is always visibly building, with
  an undampened brightness path so the release burst punches (floor ≥ 0.18,
  peak ≥ 0.90 at slider defaults).
*/

export var localSpeed = 0.5;
export var pressure = 0.50;
export var releaseThreshold = 0.68;
export var ventWidth = 0.40;
export var heatBloom = 0.55;
export var ventFlash = 0.40;
export var coolingAfterglow = 0.55;
export var steamRise = 0.50;
export var blackoutDepth = 0.30;

export var cp1H = 0.03, cp1S = 1.0, cp1V = 0.85;
export var cp2H = 0.12, cp2S = 0.92, cp2V = 0.78;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderPressure(v) { pressure = v; }
export function sliderReleaseThreshold(v) { releaseThreshold = v; }
export function sliderVentWidth(v) { ventWidth = v; }
export function sliderHeatBloom(v) { heatBloom = v; }
export function sliderVentFlash(v) { ventFlash = v; }
export function sliderCoolingAfterglow(v) { coolingAfterglow = v; }
export function sliderSteamRise(v) { steamRise = v; }
export function sliderBlackoutDepth(v) { blackoutDepth = v; }

var pr1 = 1, pg1 = 0, pb1 = 0;
var pr2 = 0, pg2 = 0, pb2 = 1;
function _hsv2rgb1() { var hv = cp1H - floor(cp1H); if (hv < 0) hv += 1; var iv = floor(hv * 6) % 6; var fv = hv * 6 - floor(hv * 6); var pv = cp1V * (1 - cp1S); var qv = cp1V * (1 - fv * cp1S); var tv = cp1V * (1 - (1 - fv) * cp1S); if (iv == 0) { pr1 = cp1V; pg1 = tv; pb1 = pv; } else if (iv == 1) { pr1 = qv; pg1 = cp1V; pb1 = pv; } else if (iv == 2) { pr1 = pv; pg1 = cp1V; pb1 = tv; } else if (iv == 3) { pr1 = pv; pg1 = qv; pb1 = cp1V; } else if (iv == 4) { pr1 = tv; pg1 = pv; pb1 = cp1V; } else { pr1 = cp1V; pg1 = pv; pb1 = qv; } }
function _hsv2rgb2() { var hv = cp2H - floor(cp2H); if (hv < 0) hv += 1; var iv = floor(hv * 6) % 6; var fv = hv * 6 - floor(hv * 6); var pv = cp2V * (1 - cp2S); var qv = cp2V * (1 - fv * cp2S); var tv = cp2V * (1 - (1 - fv) * cp2S); if (iv == 0) { pr2 = cp2V; pg2 = tv; pb2 = pv; } else if (iv == 1) { pr2 = qv; pg2 = cp2V; pb2 = pv; } else if (iv == 2) { pr2 = pv; pg2 = cp2V; pb2 = tv; } else if (iv == 3) { pr2 = pv; pg2 = qv; pb2 = cp2V; } else if (iv == 4) { pr2 = tv; pg2 = pv; pb2 = cp2V; } else { pr2 = cp2V; pg2 = pv; pb2 = qv; } }
function clamp01(v) { if (v < 0.0) return 0.0; if (v > 1.0) return 1.0; return v; }
function wrap01(v) { v = v % 1.0; if (v < 0.0) v += 1.0; return v; }
function circDist(a, b) { var d = abs(a - b); if (d > 0.5) d = 1.0 - d; return d; }
function softPulse(dist, width) { var xVal = clamp01(1.0 - dist / width); return xVal * xVal * (3.0 - 2.0 * xVal); }

var tBuild = 0.0;
var tHeat = 0.0;
var tSteam = 0.0;

export function beforeRender(delta) {
  var localMult = pow(2.0, (localSpeed - 0.5) * 4.0);
  var dt = (delta / 1310.72) * localMult;
  tBuild = tBuild + dt * (0.15 + pressure * 0.85);
  tHeat = tHeat + dt * (0.62 + heatBloom * 1.60);
  // Slow upward steam drift for the bars.
  tSteam = tSteam + dt * (0.20 + steamRise * 0.85);
  _hsv2rgb1();
  _hsv2rgb2();
}

export function render3D(index, x, y, z) {
  var isTriangleEdge = sectionId == 1;
  var isTrianglePar = sectionId == 2 && y > 2.0;
  var isBar = sectionId == 2 && y <= 2.0;
  var isVintage = sectionId == 3;
  var theta = wrap01((atan2(z, x) / PI2) + 0.5);
  // Global pressure cycle (used for vintage warmth + colour mix).
  var globalPhase = wrap01(tBuild);
  var threshold = 0.55 + releaseThreshold * 0.30;
  var globalBuild = globalPhase < threshold ? globalPhase / threshold : 1.0;
  var stage = 0.0, white = 0.0, amber = 0.0, uv = 0.0;
  var apexBurstAccum = 0.0; // used by pars (computed in edge branch context too via parId)

  if (isTriangleEdge) {
    // Per-edge unique phase (Rule 1): puff travels edgeT upward.
    // KEY GESTURE: per-edge steam puff cascade.
    var edgeId = floor(index / 18.0);
    var edgeT = (index % 18) / 17.0;
    var puffPhase = wrap01(tBuild + edgeId / 3.0);
    // Gauge rises from base to apex during build, then a short burst at top.
    var localBuild = puffPhase < threshold ? puffPhase / threshold : 1.0;
    var localRelease = puffPhase >= threshold ? (puffPhase - threshold) / (1.0 - threshold) : 0.0;
    var gauge = softPulse(abs(edgeT - localBuild), 0.040 + ventWidth * 0.085);
    var burst = softPulse(abs(edgeT - 1.0), 0.06 + ventFlash * 0.10) * pow(1.0 - localRelease, 3.0);
    // Subtle background simmer so edges always glow a touch.
    var simmer = 0.10 + 0.06 * wave(tHeat * 0.4 + edgeT * 1.3 + edgeId * 0.31);
    stage = clamp01(simmer + gauge * (0.45 + pressure * 0.55) + burst * (0.55 + ventFlash * 0.55));
    white = clamp01(burst * (0.70 + ventFlash * 0.30));
    uv = clamp01(burst * coolingAfterglow * 0.35 + simmer * 0.10);
  } else if (isBar) {
    // Rising steam: bars are vertical-ish in 3D but in pixel order each bar
    // has 18 pixels (barT 0..1). Use barT as height inside the bar; brighter
    // at the top (barT high), with a slow upward-drifting puff.
    var barLocal = index - 57;
    var barIdx = floor(barLocal / 18.0);
    var barT = (barLocal % 18) / 17.0;
    // Three steam columns around the ring, drifting independently.
    var col1 = softPulse(circDist(theta, wrap01(tBuild * 0.31 + 0.00)), 0.05 + ventWidth * 0.10);
    var col2 = softPulse(circDist(theta, wrap01(tBuild * 0.39 + 0.36)), 0.04 + ventWidth * 0.09) * 0.70;
    var col3 = softPulse(circDist(theta, wrap01(tBuild * 0.47 + 0.71)), 0.04 + ventWidth * 0.08) * 0.55;
    var columnArc = clamp01(col1 + col2 + col3);
    // Rising puff: bright pixel at the top, fading down, drifting up over time.
    var puffPos = wrap01(tSteam + barIdx * 0.137 + theta * 0.42);
    var risePuff = softPulse(abs(barT - puffPos), 0.10 + steamRise * 0.18);
    // Top-bias: pixels with higher barT are brighter (steam at top).
    var topBias = 0.30 + 0.70 * pow(barT, 1.4);
    // Background simmer floor so bars are never dead.
    var simmerBg = 0.14 + 0.10 * wave(tHeat * 0.3 + barT * 1.1 + barIdx * 0.19);
    stage = clamp01(simmerBg + columnArc * topBias * (0.40 + pressure * 0.50) + risePuff * 0.45);
    white = clamp01(columnArc * pow(1.0 - globalBuild + 0.05, 0.0) * 0.0 + risePuff * 0.35 * ventFlash);
    // White flash on global release moment.
    var gFlash = globalPhase >= threshold ? pow(1.0 - (globalPhase - threshold) / (1.0 - threshold), 4.0) : 0.0;
    white = clamp01(white + columnArc * gFlash * ventFlash * 0.85);
    uv = clamp01((columnArc + risePuff) * coolingAfterglow * 0.30);
  } else if (isTrianglePar) {
    // PARS ACTIVE (Rule 2): each par = pressure valve, pulses when its edge
    // puff reaches apex. parId 0/1/2 matches the same edgeId offset.
    // E2 push: each par also "fills" through the cycle so the valve gauge is
    // always visible — the burst rides on top of the fill peak.
    var parId = index - 54;
    var parPuffPhase = wrap01(tBuild + parId / 3.0);
    // Burst when puff approaches top (phase near 1).
    var valveBurst = softPulse(circDist(parPuffPhase, 0.97), 0.07 + ventFlash * 0.10);
    // Fill curve: 0..1 as pressure builds toward the burst, holds high briefly.
    var fill = parPuffPhase < 0.92 ? (parPuffPhase / 0.92) : 1.0;
    // Slow halo so pars are never fully off (counter-rhythm wave).
    var halo = 0.18 + 0.12 * wave(tHeat * 0.5 + parId * 0.41);
    stage = clamp01(halo + fill * 0.45 + valveBurst * (0.55 + heatBloom * 0.55));
    white = clamp01(valveBurst * (0.65 + ventFlash * 0.35) + fill * 0.15);
    amber = clamp01(fill * (0.30 + heatBloom * 0.45) + valveBurst * 0.40);
    uv = clamp01(valveBurst * coolingAfterglow * 0.30 + halo * 0.15);
  } else if (isVintage) {
    var vintageLocal = index - 291;
    var heat = globalBuild * (0.55 + 0.45 * wave(tHeat + vintageLocal * 0.063));
    var gFlash = globalPhase >= threshold ? pow(1.0 - (globalPhase - threshold) / (1.0 - threshold), 4.0) : 0.0;
    amber = clamp01((0.04 + heat * 0.45 + gFlash * 0.30) * heatBloom);
    stage = amber * 0.10;
  }

  var colorMix = clamp01(0.18 + globalBuild * 0.55 + 0.16 * wave(tHeat * 0.25 + theta));
  var brightness = (1.0 - blackoutDepth) * 0.035 + stage * (0.45 + heatBloom * 0.32);
  // Pars: stronger curve so the valve fill + burst read prominently.
  if (isTrianglePar) brightness = 0.14 + stage * (0.78 + heatBloom * 0.20);
  var r = (pr1 + (pr2 - pr1) * colorMix) * brightness;
  var g = (pg1 + (pg2 - pg1) * colorMix) * brightness;
  var b = (pb1 + (pb2 - pb1) * colorMix) * brightness * 0.45;
  rgbwau(clamp01(r), clamp01(g), clamp01(b), clamp01(white), clamp01(amber), clamp01(uv));
}
