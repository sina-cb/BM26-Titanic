/*
  mill_pressure_release
  Rebuilt for richer, less repetitive motion.

  Look:
  - Vintage cluster = hot boiler core, layered amber convection,
    orbiting pressure pockets, white steam release.
  - RedwoodPARs = shockwave + cooling plume tail, palette-driven heat bloom,
    UV recovery haze.

  Parameters:
  - localSpeed       (required)
  - pressure         overall cycle speed / force
  - boilerHeat       amber thermal body
  - ventFlash        white steam-release impact
  - coolingAfterglow redwood tail brightness + UV recovery
*/

var MASK_REDWOOD_PARS = 64;
var MASK_VINTAGE_ONLY = 128;
var VENT_HZ_MAX = 3.0;

export var localSpeed = 0.56;
export var pressure = 0.54;
export var boilerHeat = 0.62;
export var ventFlash = 0.72;
export var coolingAfterglow = 0.66;

export var cp1H = 0.0, cp1S = 1.0, cp1V = 1.0;
export var cp2H = 0.08, cp2S = 1.0, cp2V = 1.0;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderPressure(v) { pressure = v; }
export function sliderBoilerHeat(v) { boilerHeat = v; }
export function sliderVentFlash(v) { ventFlash = v; }
export function sliderCoolingAfterglow(v) { coolingAfterglow = v; }

// ---- strict cp1 <-> cp2 palette cache ----
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
  v = v - floor(v);
  if (v < 0.0) v += 1.0;
  return v;
}

function smoothPulse(v, center, halfWidth) {
  var d = abs(v - center);
  if (d >= halfWidth) return 0.0;
  var n = 1.0 - d / halfWidth;
  return n * n * (3.0 - 2.0 * n);
}

function mixRgb(tBlend, bright) {
  var rr = (pr1 + (pr2 - pr1) * tBlend) * bright;
  var gg = (pg1 + (pg2 - pg1) * tBlend) * bright;
  var bb = (pb1 + (pb2 - pb1) * tBlend) * bright;
  return [rr, gg, bb];
}

// Free-running clocks
var phaseDrift = 0.0;
var phaseConvect = 0.0;
var phaseOrbit = 0.0;
var phaseShear = 0.0;
var cyclePhase = 0.0;

// Smoothed envelopes
var buildEnv = 0.0;
var ventEnv = 0.0;
var coolEnv = 0.0;
var buildEnvS = 0.0;
var ventEnvS = 0.0;
var coolEnvS = 0.0;
var releaseEnvS = 0.0;

export function beforeRender(delta) {
  var localMult = pow(2.0, (localSpeed - 0.5) * 6.75);
  var energy = 0.55 + pressure * 0.9;

  phaseDrift = phaseDrift + (delta / 2300.0) * localMult;
  phaseConvect = phaseConvect + (delta / 3700.0) * localMult * energy;
  phaseOrbit = phaseOrbit + (delta / 4200.0) * localMult * (0.7 + pressure * 0.8);
  phaseShear = phaseShear + (delta / 3100.0) * localMult * (0.8 + pressure * 0.7);

  if (phaseDrift > 1024.0) phaseDrift -= floor(phaseDrift);
  if (phaseConvect > 1024.0) phaseConvect -= floor(phaseConvect);
  if (phaseOrbit > 1024.0) phaseOrbit -= floor(phaseOrbit);
  if (phaseShear > 1024.0) phaseShear -= floor(phaseShear);

  _hsv2rgb1();
  _hsv2rgb2();

  var ventHz = 0.16 + pressure * (VENT_HZ_MAX - 0.16);
  if (ventHz > VENT_HZ_MAX) ventHz = VENT_HZ_MAX;
  cyclePhase = wrap01(cyclePhase + (delta / 1000.0) * ventHz);

  // Long inhale, short burst, then cooling tail.
  if (cyclePhase < 0.78) {
    var bp = cyclePhase / 0.78;
    buildEnv = smoothstep(0.0, 1.0, bp);
  } else {
    buildEnv = 1.0;
  }

  ventEnv = smoothPulse(cyclePhase, 0.88, 0.10);

  if (cyclePhase >= 0.88) {
    var cp = (cyclePhase - 0.88) / 0.12;
    if (cp > 1.0) cp = 1.0;
    coolEnv = cp;
  } else {
    coolEnv = 0.0;
  }

  var dt = delta / 1000.0;
  var lpFast = 1.0 - exp(-dt * 10.0);
  var lpSlow = 1.0 - exp(-dt * 6.0);

  buildEnvS = buildEnvS + (buildEnv - buildEnvS) * lpSlow;
  ventEnvS = ventEnvS + (ventEnv - ventEnvS) * lpFast;
  coolEnvS = coolEnvS + (coolEnv - coolEnvS) * lpSlow;

  var releaseRaw = ventEnvS * 1.3 + buildEnvS * 0.25;
  if (releaseRaw > 1.0) releaseRaw = 1.0;
  releaseEnvS = releaseEnvS + (releaseRaw - releaseEnvS) * lpFast;
}

export function render3D(index, x, y, z) {
  var isVintage = (viewMask & MASK_VINTAGE_ONLY) != 0;
  var isRedwood = (viewMask & MASK_REDWOOD_PARS) != 0;

  var rv = 0.0, gv = 0.0, bv = 0.0, wv = 0.0, av = 0.0, uv = 0.0;

  if (isVintage) {
    var nx = x - 0.5;
    var ny = y - 0.5;
    var rr = hypot(nx, ny);
    var ang = atan2(ny, nx) / PI2;
    ang = wrap01(ang);

    // two slowly orbiting thermal cores
    var orbA = phaseOrbit;
    var orbB = phaseOrbit * 1.31 + 0.37;

    var ox1 = 0.5 + cos(orbA * PI2) * 0.18;
    var oy1 = 0.5 + sin(orbA * PI2) * 0.16;
    var ox2 = 0.5 + cos(wrap01(orbB) * PI2) * 0.11;
    var oy2 = 0.5 + sin(wrap01(orbB) * PI2) * 0.22;

    var d1 = hypot(x - ox1, y - oy1);
    var d2 = hypot(x - ox2, y - oy2);

    var coreA = 1.0 - clamp01(d1 / 0.28);
    var coreB = 1.0 - clamp01(d2 / 0.22);
    coreA = coreA * coreA;
    coreB = coreB * coreB;

    // multi-source convection fields
    var convA = wave(x * 1.7 + y * 1.1 - phaseDrift);
    var convB = wave(x * 3.2 - y * 2.3 + phaseConvect * 1.13);
    var swirl = wave(ang * 2.4 + rr * 1.8 - phaseShear);
    var veins = wave((x + y) * 2.1 + phaseConvect * 0.7) * wave((x - y) * 1.7 - phaseDrift * 0.9);

    // palette blend inside the hot RGB body
    var tColor = clamp01(
      0.10 +
      convA * 0.20 +
      convB * 0.12 +
      swirl * 0.14 +
      coreA * 0.18 +
      coreB * 0.16
    );

    var body = clamp01(
      0.05 +
      buildEnvS * (0.24 + convA * 0.18 + convB * 0.12 + veins * 0.10) +
      coreA * 0.14 +
      coreB * 0.12
    );

    var rgbv = mixRgb(tColor, body);
    rv = rgbv[0];
    gv = rgbv[1];
    bv = rgbv[2];

    // Amber is the main thermal emitter
    av = clamp01(
      boilerHeat * (
        0.10 +
        buildEnvS * (0.38 + convA * 0.20 + swirl * 0.10) +
        coreA * 0.18 +
        coreB * 0.14
      )
    );

    // White = steam release + upper-stack sparkle
    var upperMask = 0.0;
    if (y > 0.72) upperMask = upperMask + (y - 0.72) * 3.0;
    if (z > 0.72) upperMask = upperMask + (z - 0.72) * 2.0;
    upperMask = clamp01(upperMask);

    var steamSheet = wave(x * 2.4 + y * 1.6 + phaseShear * 1.25);
    steamSheet = steamSheet * steamSheet;

    wv = clamp01(
      ventFlash * ventEnvS * (0.50 + 0.35 * steamSheet + 0.25 * coreA) +
      upperMask * releaseEnvS * (0.25 + 0.45 * steamSheet)
    );

    // UV only tiny on vintage, just a shadow accent
    uv = clamp01(coolEnvS * 0.06);
  }
  else if (isRedwood) {
    var nx2 = x - 0.5;
    var ny2 = y - 0.5;
    var rr2 = hypot(nx2, ny2);
    var ang2 = atan2(ny2, nx2) / PI2;
    ang2 = wrap01(ang2);

    // vent shock front + drifting cooling plume
    var shock = smoothPulse(wrap01(rr2 * 1.3 + coolEnvS * 0.85), 0.78, 0.18);
    var plumeA = wave(x * 1.4 + z * 0.38 - phaseDrift * 0.85);
    var plumeB = wave(y * 1.9 - z * 0.25 + phaseConvect * 0.92);
    var curl = wave(ang2 * 2.8 - rr2 * 2.1 + phaseOrbit * 0.7);
    var veil = wave((x + y) * 1.5 + phaseShear * 0.6) * wave((x - y) * 1.2 - phaseDrift * 0.5);

    var tTree = clamp01(
      0.14 +
      plumeA * 0.18 +
      plumeB * 0.14 +
      curl * 0.16 +
      shock * 0.22
    );

    var tailBright = clamp01(
      coolingAfterglow * (
        coolEnvS * (0.22 + plumeA * 0.22 + plumeB * 0.12 + veil * 0.08) +
        ventEnvS * shock * 0.35
      )
    );

    var rgbt = mixRgb(tTree, tailBright);
    rv = rgbt[0];
    gv = rgbt[1];
    bv = rgbt[2];

    // White catches the shockfront and release peaks
    wv = clamp01(
      ventFlash * (
        shock * ventEnvS * 0.58 +
        veil * shock * 0.18
      )
    );

    // small amber thermal afterglow
    av = clamp01(
      boilerHeat * coolEnvS * (0.08 + plumeA * 0.08)
    );

    // UV recovery haze
    uv = clamp01(
      coolingAfterglow * (
        0.10 +
        coolEnvS * (0.26 + curl * 0.18 + (1.0 - plumeA) * 0.12)
      )
    );
  }

  rgbwau(
    clamp01(rv),
    clamp01(gv),
    clamp01(bv),
    clamp01(wv),
    clamp01(av),
    clamp01(uv)
  );
}