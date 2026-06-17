/*
  lookout_gyro_vortex
  A rotating vortex centered on the lookout/tower cluster, with a slower
  counter-rotation drifting through the redwood canopy. The tower bars
  read as the spinning gyro core; the redwoods read as a wider counter-
  current of color sweeping through the trees.

  Recurring-bug fixes (Reviewer 7, section 7.1):
    - coord:  original used `atan2(z - 0.5, x - 0.5)` which treats the unit
              cube center as the rotation pivot. On logsville the tower
              cluster centroid sits at (nx≈0.51, nz≈0.35), so the original
              barely swept the redwoods (which all live at nz≈0.78..1.0).
              Now centered on the tower centroid (TOWER_NX/NZ); redwoods
              get a slower COUNTER-rotation around their own centroid so
              the whole stage reads as a coupled gyro.
    - mask:   replaced raw `viewMask & 2` (no Cabin/Tower mask is
              registered on logsville) with branch on RedwoodPARs only —
              and a deliberate non-redwood branch (towers/walls) for the
              core sweep. `outpostGlow` slider now drives the redwood
              counter-vortex amplitude.
    - UV:     `u = core * uvIntensity` ran unconditionally and flickered
              UV across the entire rig for ~50 ms per rotation. UV is now
              strictly inside the redwood branch and shaped as a smooth
              peak (no binary core flicker).

  View masks consumed (named, registered in summer_camp_logsville.viewmasks.js):
    RedwoodPARs (0x40) — slower counter-vortex + UV glow

  Tower centroid (nx≈0.51, nz≈0.35) computed from `TowerBars` group in
  marsin_engine/models/summer_camp_logsville.js (indices 0..143).
*/

// Named view-mask bits (mirrors summer_camp_logsville.viewmasks.js).
var MASK_REDWOOD_PARS = 64;

// Tower (lookout) centroid in normalized [0,1] coords — derived from the
// TowerBars group in summer_camp_logsville.js. This is the rotation pivot
// for the gyro vortex.
var TOWER_NX = 0.51;
var TOWER_NZ = 0.35;

// Redwood-grove centroid in normalized coords — approximate center of the
// 18 redwood PARs (Redwoods1/2/3) used as the pivot for the slower
// counter-rotation through the trees.
var REDWOOD_NX = 0.50;
var REDWOOD_NZ = 0.89;

export var localSpeed = 0.5;
export var vortexSpeed = 0.45;
export var sweepImpact = 0.35;
export var outpostGlow = 0.45;
export var uvIntensity = 0.7;

export var cp1H = 0.0,  cp1S = 1.0, cp1V = 1.0;   // hot red default
export var cp2H = 0.08, cp2S = 1.0, cp2V = 1.0;   // amber default
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderVortexSpeed(v) { vortexSpeed = v; }
export function sliderSweepImpact(v) { sweepImpact = v; }
export function sliderOutpostGlow(v) { outpostGlow = v; }
export function sliderUvIntensity(v) { uvIntensity = v; }

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

var tPhase = 0.0;
// Per-harmonic time accumulators (precedent: 05/10/18/20/23/24/44). Each
// rotates at its own rate and wraps independently so the layered counter-
// vortex never teleports at the moment any single accumulator rolls over.
var timeR1 = 0.0;
var timeR2 = 0.0;
var timeT1 = 0.0;
export function beforeRender(delta) {
  var localMult = pow(2.0, (localSpeed - 0.5) * 5.4);
  var step = (delta / 1310.72) * localMult;
  tPhase = (tPhase + step) % 1.0;
  if (tPhase < 0.0) tPhase += 1.0;
  // Redwood primary: slow (0.5x). Redwood secondary: irrational ratio (0.37x).
  // Tower primary: full vortexSpeed. Each wraps01 independently.
  timeR1 = (timeR1 + step * vortexSpeed * 0.5) % 1.0;
  if (timeR1 < 0.0) timeR1 += 1.0;
  timeR2 = (timeR2 + step * vortexSpeed * 0.37) % 1.0;
  if (timeR2 < 0.0) timeR2 += 1.0;
  timeT1 = (timeT1 + step * vortexSpeed) % 1.0;
  if (timeT1 < 0.0) timeT1 += 1.0;
  _hsv2rgb1();
  _hsv2rgb2();
}

// Engine convention: `x, y, z` are the pixel's *normalized* coords
// (nx, ny, nz from the model) in [0,1] — NOT world meters.
//
// Discontinuity fix (2026-05-28):
//   The prior version fed atan2's [-PI, +PI] output into wave() with
//   *non-integer* harmonic multipliers (e.g. `(angle/PI2) * 1.37`). At the
//   atan2 seam (±PI), neighboring pixels jumped 1.37 cycles instead of 1,
//   producing a visible discontinuity ring once per rotation. Now every
//   harmonic multiplier is an integer so the wave is 2*PI-periodic in the
//   angle, and we drive each harmonic with its own time accumulator so the
//   layered counter-current doesn't teleport when tPhase wraps. Same fix on
//   the tower branch.
export function render3D(index, x, y, z) {
  var isRedwood = (viewMask & MASK_REDWOOD_PARS) != 0;
  var r = 0.0, g = 0.0, b = 0.0, w = 0.0, a = 0.0, u = 0.0;
  if (isRedwood) {
    // Redwoods: slower COUNTER-rotation around the grove centroid.
    var dxR = x - REDWOOD_NX;
    var dzR = z - REDWOOD_NZ;
    var angleR = atan2(dzR, dxR);
    // Normalize angle to [0,1) so wave() sees a clean unit-period coord.
    var aR = angleR / PI2;
    aR = aR - floor(aR);
    // Primary sweep: 1 cycle per rotation (integer multiplier — seam-safe).
    var sweepR = wave(aR - timeR1);
    // Secondary sweep: 2 cycles per rotation (still integer — no seam jump),
    // driven by its OWN time base so the layered motion never wrap-teleports
    // when timeR1 rolls past 1.0 (precedent: 05/10/18/20/23/24/44).
    var sweepR2 = wave(aR * 2.0 + timeR2);
    var blendR = sweepR * 0.7 + sweepR2 * 0.3;
    var amp = outpostGlow;
    r = (pr1 + (pr2 - pr1) * blendR) * amp;
    g = (pg1 + (pg2 - pg1) * blendR) * amp;
    b = (pb1 + (pb2 - pb1) * blendR) * amp;
    // Smooth UV peak (not a binary core) so canopy underlight reads
    // continuously instead of strobing once per rotation.
    u = uvIntensity * pow(sweepR, 6.0);
  } else {
    // Towers / walls / vintage: fast vortex around the tower centroid.
    var dxT = x - TOWER_NX;
    var dzT = z - TOWER_NZ;
    var angleT = atan2(dzT, dxT);
    var aT = angleT / PI2;
    aT = aT - floor(aT);
    var sweepT = wave(aT + timeT1);
    // Smooth peak — pow(sweep, 8) replaces the harsh sweep>0.95 binary
    // core that flickered at low FPS.
    var corePeak = pow(sweepT, 8.0);
    r = (pr1 + (pr2 - pr1) * sweepT) * 0.55;
    g = (pg1 + (pg2 - pg1) * sweepT) * 0.55;
    b = (pb1 + (pb2 - pb1) * sweepT) * 0.55;
    w = corePeak * sweepImpact;
  }
  rgbwau(clamp01(r), clamp01(g), clamp01(b), clamp01(w), clamp01(a), clamp01(u));
}
