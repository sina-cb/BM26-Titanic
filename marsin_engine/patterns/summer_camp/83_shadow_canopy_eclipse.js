/*
  shadow_canopy_eclipse
  Golden-ratio rosette eclipse

  Distinct motion signature:
  - quasi-periodic eclipse center drift using irrational phase ratios
  - precessing rosette-warped umbra
  - braided wake field behind the eclipse
  - independently breathing corona

  Visual intent:
  - RedwoodPARs: the main eclipse body, cool/dark umbra, white corona rim,
    UV shadow memory
  - VintageOnly: steamboat-white rim accents + warm corona kiss
  - Others: sympathetic eclipse motion, but gentler than the redwoods

  Palette contract:
  - RGB stays strictly on cp1 <-> cp2 interpolation
  - W / A / U are physical emitters layered on top
*/

var MASK_REDWOOD_PARS = 64;
var MASK_VINTAGE_ONLY = 128;

// Irrational ratios used deliberately to avoid obvious looping.
// This is the pattern's mathematical signature.
var PHI = 1.618033;
var SILVER = 2.414214;

export var localSpeed = 0.34;
export var eclipseScale = 0.52;
export var coronaBloom = 0.48;
export var shadowDepth = 0.72;
export var warpAmount = 0.46;

export var cp1H = 0.08, cp1S = 1.0, cp1V = 1.0;
export var cp2H = 0.66, cp2S = 1.0, cp2V = 0.6;

export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderEclipseScale(v) { eclipseScale = v; }
export function sliderCoronaBloom(v) { coronaBloom = v; }
export function sliderShadowDepth(v) { shadowDepth = v; }
export function sliderWarpAmount(v) { warpAmount = v; }

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

var mixR = 0.0;
var mixG = 0.0;
var mixB = 0.0;

function mixPaletteRgb(tBlend, bright) {
  mixR = (pr1 + (pr2 - pr1) * tBlend) * bright;
  mixG = (pg1 + (pg2 - pg1) * tBlend) * bright;
  mixB = (pb1 + (pb2 - pb1) * tBlend) * bright;
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

function smoothBand(distVal, widthVal) {
  var n = 1.0 - distVal / widthVal;
  if (n < 0.0) n = 0.0;
  if (n > 1.0) n = 1.0;
  return n * n * (3.0 - 2.0 * n);
}

var phaseDrift = 0.0;
var phaseRosette = 0.0;
var phaseWake = 0.0;
var phaseCorona = 0.0;

export function beforeRender(delta) {
  var localMult = pow(2.0, (localSpeed - 0.5) * 6.75);

  phaseDrift = phaseDrift + (delta / 6100.0) * localMult;
  phaseRosette = phaseRosette + (delta / 4300.0) * localMult * 0.92;
  phaseWake = phaseWake + (delta / 7600.0) * localMult * 0.73;
  phaseCorona = phaseCorona + (delta / 2900.0) * localMult * 0.56;

  if (phaseDrift > 1024.0) phaseDrift -= floor(phaseDrift);
  if (phaseRosette > 1024.0) phaseRosette -= floor(phaseRosette);
  if (phaseWake > 1024.0) phaseWake -= floor(phaseWake);
  if (phaseCorona > 1024.0) phaseCorona -= floor(phaseCorona);

  _hsv2rgb1();
  _hsv2rgb2();
}

export function render3D(index, x, y, z) {
  var isRedwood = (viewMask & MASK_REDWOOD_PARS) != 0;
  var isVintage = (viewMask & MASK_VINTAGE_ONLY) != 0;

  var r = 0.0, g = 0.0, b = 0.0, w = 0.0, a = 0.0, u = 0.0;

  // ---- quasi-periodic eclipse center ----
  var centerX = 0.5 + (wave(phaseDrift) - 0.5) * (0.34 + eclipseScale * 0.10);
  var centerY = 0.5 + (wave(phaseDrift * PHI + 0.17) - 0.5) * (0.26 + eclipseScale * 0.08);

  var dx = x - centerX;
  var dy = y - centerY;
  var radial = hypot(dx, dy);

  var theta = atan2(dy, dx) / PI2;
  theta = wrap01(theta);

  // ---- unique signature field: rosette + braid ----
  var rosette = wave(theta * (4.0 + warpAmount * 3.2) + phaseRosette * SILVER + radial * 0.72);
  var braidA = wave((x + y * PHI) * (1.35 + warpAmount * 1.25) - phaseWake * 0.62);
  var braidB = wave((x * PHI - y) * (1.10 + warpAmount * 0.95) + phaseDrift * 0.28);
  var braid = braidA * braidB;

  var warp = 1.0
    + (rosette - 0.5) * warpAmount * 0.70
    + (braid - 0.25) * warpAmount * 0.34;

  var warpedRadial = radial * warp;

  var umbraRadius = 0.14 + eclipseScale * 0.22;
  var penumbraWidth = 0.14 + (1.0 - shadowDepth) * 0.12;
  var rimWidth = 0.028 + (1.0 - coronaBloom) * 0.075;

  // Main eclipse envelopes
  var umbra = 1.0 - smoothstep(umbraRadius, umbraRadius + penumbraWidth, warpedRadial);
  var penumbra = 1.0 - smoothstep(umbraRadius + 0.02, umbraRadius + 0.24 + (1.0 - shadowDepth) * 0.10, warpedRadial);
  var rim = 1.0 - smoothstep(0.0, rimWidth, abs(warpedRadial - umbraRadius));

  // Braided wake trailing through the canopy
  var wakeCoord = dx * 0.82 + dy * -0.57;
  var wakeField = wave(wakeCoord * (1.20 + warpAmount * 1.55) - phaseWake + theta * 0.48);
  var wake = clamp01((1.0 - umbra) * wakeField * (0.36 + 0.64 * penumbra));

  // Slow ambient breathing, separate from the macro drift
  var ambient = wave(radial * 1.12 - phaseCorona * 0.34 + theta * 0.22);
  var coronaPulse = 0.58 + 0.42 * wave(phaseCorona * 0.47 + theta * 0.63);

  if (isRedwood) {
    // cp1 outside, cp2 in the umbra and wake memory
    var tColor = clamp01(
      umbra * 0.82 +
      wake * 0.26 +
      rosette * 0.06
    );

    var bright = clamp01(
      (1.0 - umbra) * (0.18 + ambient * 0.24) +
      penumbra * 0.10 +
      wake * 0.18
    );

    mixPaletteRgb(tColor, bright);
    r = mixR;
    g = mixG;
    b = mixB;

    // White corona rim
    w = clamp01(
      rim * coronaBloom * (0.42 + 0.58 * coronaPulse) +
      rim * braid * 0.16
    );

    // UV shadow memory lives mainly on the redwoods
    u = clamp01(
      shadowDepth * (
        umbra * 0.42 +
        wake * 0.20 +
        penumbra * 0.08
      )
    );

    // tiny amber kiss at the corona edge only
    a = clamp01(
      rim * coronaBloom * 0.05
    );
  } else {
    // sympathetic stage / tower eclipse, gentler than the redwoods
    var tColorT = clamp01(
      umbra * 0.62 +
      wake * 0.20 +
      rosette * 0.04
    );

    var brightT = clamp01(
      (1.0 - umbra * 0.76) * (0.18 + ambient * 0.18) +
      rim * 0.08 +
      wake * 0.10
    );

    mixPaletteRgb(tColorT, brightT);
    r = mixR;
    g = mixG;
    b = mixB;

    // softer rim on towers/walls
    w = clamp01(
      rim * coronaBloom * 0.28
    );

    if (isVintage) {
      // steamboat-white / warm corona detail for vintage heads
      w = clamp01(
        rim * coronaBloom * (0.30 + 0.55 * coronaPulse) +
        rim * braid * 0.20
      );
      a = clamp01(
        rim * (0.12 + coronaBloom * 0.18) +
        penumbra * 0.04
      );
    } else {
      a = clamp01(
        wake * 0.03
      );
    }

    u = 0.0;
  }

  rgbwau(
    clamp01(r),
    clamp01(g),
    clamp01(b),
    clamp01(w),
    clamp01(a),
    clamp01(u)
  );
}