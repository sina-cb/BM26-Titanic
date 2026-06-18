/*
  boiler_glow
  Pressure-room heat for Summer Camp Dome.
  BarLights become rotating vent sectors; TriangleEdges are gauge needles;
  Vintage lamps carry filament heat while cooling gaps stay dark.

  Apex polish (E1):
  - 1-1-1 cure is now POSITION-based using φ-spaced offsets [0.0, 0.382, 0.764]
    rather than (0, 1/3, 2/3). The (1/3, 2/3) spacing is geometrically symmetric
    on an equilateral triangle, which made spots at edges 1 and 2 read as a
    mirror pair (the operator's reported 2-1 grouping). φ-spaced offsets break
    that mirror symmetry on both the spatial and temporal axis.
  - Flicker cure: the gauge "dialHeat" on TriangleEdges previously folded
    tFlicker (~1 Hz wave with pow 2.4) into the per-pixel brightness, which
    produced visible twitch on the apex. Replaced with a slow per-edge raised
    cosine using tNeedle, so the moving needle gesture is preserved but the
    high-frequency twitch is gone.
  - Vintage flameB removed (was wave(tFlicker * 2.71) → up to 12.7 Hz on lamps).
  - flashRate still rate-caps the soft envelope at ≤3 Hz.
*/

export var localSpeed = 0.5;
export var boilerHeat = 0.55;
export var flickerComplexity = 0.48;
export var ventWidth = 0.34;
export var steamFlash = 0.28;
export var triangleRPM = 0.52;
export var blackoutDepth = 0.64;
// New: hard-cap on flash cadence. 0 -> ~0.8 Hz, 1 -> ~3.0 Hz (safe ceiling).
export var flashRate = 0.45;

export var cp1H = 0.025, cp1S = 1.0, cp1V = 0.78;
export var cp2H = 0.115, cp2S = 0.92, cp2V = 0.62;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderBoilerHeat(v) { boilerHeat = v; }
export function sliderFlickerComplexity(v) { flickerComplexity = v; }
export function sliderVentWidth(v) { ventWidth = v; }
export function sliderSteamFlash(v) { steamFlash = v; }
export function sliderTriangleRPM(v) { triangleRPM = v; }
export function sliderBlackoutDepth(v) { blackoutDepth = v; }
export function sliderFlashRate(v) { flashRate = v; }

// Safe flash-rate band (cycles/sec). Maximum stays at/under 3 Hz.
var FLASH_RATE_MIN = 0.8;
var FLASH_RATE_MAX = 3.0;

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

function wrap01(v) {
  v = v % 1.0;
  if (v < 0.0) v += 1.0;
  return v;
}

function circDist(a, b) {
  var d = abs(a - b);
  if (d > 0.5) d = 1.0 - d;
  return d;
}

function softPulse(dist, width) {
  var xVal = clamp01(1.0 - dist / width);
  return xVal * xVal * (3.0 - 2.0 * xVal);
}

// Raised-cosine flash envelope: 0 outside (phase in [0,1) of a cycle), and
// soft attack/decay inside the active window. width is the fraction of the
// cycle that is "on"; we apply pow(., 4) so the tail decays gently after the
// peak rather than terminating in a step.
function softFlash(phase, width) {
  if (phase < 0.0 || phase > width) return 0.0;
  var nrm = phase / width;            // 0..1 across the on window
  var bell = 0.5 - 0.5 * cos(nrm * PI2);  // raised cosine, peak at center
  return pow(bell, 1.4);              // gentler than pow(., 4); keeps gesture
}

var tVent = 0.0;
var tNeedle = 0.0;
var tFlicker = 0.0;
var tFlash = 0.0;
var tRelease = 0.0;

export function beforeRender(delta) {
  var localMult = pow(2.0, (localSpeed - 0.5) * 4.0);
  var dt = (delta / 1310.72) * localMult;

  tVent = tVent + dt * (0.16 + boilerHeat * 0.62);
  tNeedle = tNeedle + dt * (0.24 + triangleRPM * 1.55);
  tFlicker = tFlicker + dt * (1.30 + flickerComplexity * 3.40);
  // tRelease is the slow background pressure breathing, unchanged.
  tRelease = tRelease + dt * (0.10 + steamFlash * 0.42);
  // tFlash drives the actual flash gestures — strictly clamped to <=3 Hz.
  var safeRate = flashRate;
  if (safeRate < 0.0) safeRate = 0.0;
  if (safeRate > 1.0) safeRate = 1.0;
  var flashHz = FLASH_RATE_MIN + safeRate * (FLASH_RATE_MAX - FLASH_RATE_MIN);
  tFlash = tFlash + dt * flashHz;

  _hsv2rgb1();
  _hsv2rgb2();
}

export function render3D(index, x, y, z) {
  var isTriangleEdge = sectionId == 1;
  var isTrianglePar = sectionId == 2 && y > 2.0;
  var isBar = sectionId == 2 && y <= 2.0;
  var isVintage = sectionId == 3;
  var isApex = isTriangleEdge || isTrianglePar;

  var theta = wrap01((atan2(z, x) / PI2) + 0.5);
  var width = 0.018 + ventWidth * 0.155;
  var pressure = clamp01(0.22 + boilerHeat * 0.68 + wave(tRelease * 0.73) * 0.10);

  // Width of the "on" portion of each flash cycle. Keep narrow so the gesture
  // reads as a puff, not a sustain. steamFlash modulates intensity, not width.
  var flashWidth = 0.32;

  var ventStage = 0.0;
  var coolingUv = 0.0;
  if (isBar) {
    var barLocal = index - 57;
    var barIndex = floor(barLocal / 18.0);
    var barT = (barLocal % 18) / 17.0;
    var sectorA = softPulse(circDist(theta, wrap01(tVent)), width);
    var sectorB = softPulse(circDist(theta, wrap01(0.43 - tVent * 0.57)), width * 0.72) * 0.70;
    // Soft-enveloped steam puff. Phase offset by barIndex/12 so the 12 bars
    // don't all puff in unison (Rule 3 / Rule 1 spirit).
    var puffPhase = wrap01(tFlash + barIndex / 12.0);
    var sectorC = softPulse(circDist(theta, wrap01(0.71 + tRelease * 1.31)), width * 0.46)
                * softFlash(puffPhase, flashWidth) * steamFlash;
    var piston = pow(wave(barT * 1.9 - tFlicker * 0.58 + barIndex * 0.137), 1.7);
    var shutter = pow(wave(theta * 6.0 + tNeedle * 0.39), 2.6);
    ventStage = sectorA;
    if (sectorB > ventStage) ventStage = sectorB;
    if (sectorC > ventStage) ventStage = sectorC;
    ventStage = ventStage * (0.33 + piston * 0.67) * (0.35 + shutter * 0.65);
    coolingUv = pow(clamp01(1.0 - ventStage), 3.2) * sectorC;
  }

  var gaugeStage = 0.0;
  var whiteStage = 0.0;
  if (isTriangleEdge) {
    var edgeId = floor(index / 18.0);
    var edgeT = (index % 18) / 17.0;
    // φ-spaced edge offsets [0.0, 0.382, 0.764] — break mirror symmetry of the
    // equilateral triangle so all three needles read as distinct positions
    // (not a 2-1 pair). Continuity: at edgeT=0.5, t=0.25, positions are
    // 0.25, 0.632, 0.014 → distances 0.25, 0.132, 0.486 → all unique. At
    // edgeT=0.5, t=0.5: 0.5, 0.882, 0.264 → distances 0, 0.382, 0.236 → all unique.
    var edgePhase = 0.0;
    if (edgeId == 1) edgePhase = 0.382;
    if (edgeId == 2) edgePhase = 0.764;
    var needleA = softPulse(circDist(edgeT, wrap01(tNeedle + edgePhase)), 0.030 + ventWidth * 0.085);
    var needleB = softPulse(circDist(edgeT, wrap01(0.5 - tNeedle * 0.64 + edgePhase)), 0.024 + ventWidth * 0.050) * 0.55;
    // dialHeat: slow per-edge raised-cosine envelope driven by tNeedle (≤~0.5 Hz)
    // not tFlicker. Preserves a moving "heat" gesture on each gauge without
    // injecting the high-frequency tFlicker twitch that caused the flicker.
    var dialT = wrap01(tNeedle * 0.30 + edgePhase);
    var dialEnv = (1.0 - cos(dialT * PI2)) * 0.5;
    var dialHeat = dialEnv * 0.22;
    gaugeStage = clamp01((needleA + needleB + dialHeat) * (0.36 + triangleRPM * 0.82));
    // Edge white-flash gets the soft envelope too — was previously gated by
    // steamFlash as a multiplier on raw needles.
    var edgeFlashPhase = wrap01(tFlash * 0.78 + edgePhase);
    whiteStage = clamp01((needleA * 0.40 + needleB * 0.22) * softFlash(edgeFlashPhase, flashWidth) * steamFlash);
  }

  // TrianglePars: 3 active pars (Rule 2). Each gets its own flash phase via
  // φ-spaced offsets [0.0, 0.382, 0.764] to break mirror symmetry, on the
  // soft raised-cosine envelope.
  var parBurst = 0.0;
  if (isTrianglePar) {
    var parId = index - 54;                  // 0, 1, 2
    var parOff = 0.0;
    if (parId == 1) parOff = 0.382;
    if (parId == 2) parOff = 0.764;
    var parPhase = wrap01(tFlash + parOff);
    var puff = softFlash(parPhase, flashWidth);
    // Slow underbreath so pars are never fully black (Rule 2 — always active).
    var underBreath = 0.10 + 0.10 * wave(tRelease * 0.81 + parOff);
    parBurst = clamp01(puff * steamFlash + underBreath * (0.40 + boilerHeat * 0.50));
  }

  var filament = 0.0;
  if (isVintage) {
    var vintageLocal = index - 291;
    var fixtureNo = floor(vintageLocal / 6.0);
    var lampNo = vintageLocal % 6;
    var bank = softPulse(circDist(wrap01(fixtureNo / 5.0), wrap01(tVent * 0.31 + 0.12)), 0.11 + ventWidth * 0.10);
    // Slow filament flicker only — tFlicker * 0.93 is ~1 Hz at full slider.
    // The previous tFlicker * 2.71 (~12.7 Hz) component was removed because
    // it produced visible high-frequency flicker on the lamps.
    var flameA = wave(tFlicker * 0.93 + fixtureNo * 0.271 + lampNo * 0.073);
    filament = (0.030 + bank * (0.32 + flameA * 0.30)) * boilerHeat;
  }

  var stage = 0.0;
  if (isBar) stage = ventStage;
  else if (isTriangleEdge) stage = gaugeStage;
  else if (isTrianglePar) stage = parBurst;
  else if (isVintage) stage = filament;

  var emberNoise = wave(tFlicker * 0.37 + x * 0.071 - z * 0.053 + y * 0.021);
  var colorMix = clamp01(0.10 + pressure * 0.48 + emberNoise * 0.24 + stage * 0.18);
  var floorGlow = (1.0 - blackoutDepth) * boilerHeat * 0.025;
  var brightness = floorGlow + stage * (0.28 + boilerHeat * 0.48);
  if (isVintage) brightness = floorGlow * 0.35 + filament * 0.24;
  if (isTrianglePar) brightness = floorGlow * 0.45 + parBurst * (0.20 + boilerHeat * 0.30);

  var r = (pr1 + (pr2 - pr1) * colorMix) * brightness;
  var g = (pg1 + (pg2 - pg1) * colorMix) * brightness;
  var b = (pb1 + (pb2 - pb1) * colorMix) * brightness * 0.30;
  var w = isApex ? clamp01(whiteStage + parBurst * 0.55) : 0.0;
  var a = isVintage ? clamp01(filament * (0.52 + boilerHeat * 0.58)) : 0.0;
  var u = clamp01(coolingUv + whiteStage * 0.12 + parBurst * 0.18);

  rgbwau(clamp01(r), clamp01(g), clamp01(b), clamp01(w), clamp01(a), clamp01(u));
}
