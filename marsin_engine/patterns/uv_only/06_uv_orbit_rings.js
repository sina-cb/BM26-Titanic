/*
  06_uv_orbit_rings.js — "UV Orbit Rings"  [UV ONLY family — wave _313]

  DERIVED FROM: patterns/118_grand_orbit_rings.js. Skeleton kept: three
  enormous oblique luminous hoops, each a true circular tube in a moving
  plane, orbiting on incommensurate clocks with a travelling bright arc per
  tube and a broad soft penumbra so the geometry reads as monumental
  wrapped-around-the-ship structure rather than travelling bars.
  IDENTITY (50 ft): tilted orbital rings of violet sweep through the hull
  in slow procession, their arcs and intersections flaring bright.

  TEXTURE: the un-ringed hull rests at a 0.15-0.22 violet keep; the ring
  penumbras and travelling arcs carry a 0.35-0.58 mid field; the ring cores
  and intersections peak at 0.88-1.00.
  SPEED: authored to global 25 / local 0.30, direction 0.75 (rate factor
  0.4225) — one full ring A orbit ~= 36 s on the rig at the reference
  point.
  RUNAWAY (g=4.0 -> dt clamps at 0.1 s/frame; local 1.0 = 2.0x base, full
  direction = 1.0x sign): fastest clock is ring C at 0.06575 x 1.37 x 2.0
  x 1.0 = 0.1802 cycles/s — far below the 10/s alias bar. Max per-frame
  clock jump 0.1 x 0.1802 = 0.01802 against PHASE_WRAP 4096 — wraps safe by
  five orders of magnitude.
  CONTROLS (declaration order = MFT knob order): localSpeed — orbit rate;
  direction — signed orbit direction; ringWidth — hoop tube thickness;
  orbitTilt — how oblique the three ring planes sit; contrast — core
  sharpness of each hoop; level — overall UV intensity.

  AUDIO_MODULATION_V1:
    sliderLevel     <- micLow  range 0.35..1.00 curve linear # overall UV intensity (PRIMARY)
    sliderRingWidth <- micFlux range 0.20..0.85 curve ease   # hoop tube expansion on builds
    # STATIC (omit from audio): localSpeed, direction, orbitTilt, contrast
*/

export var localSpeed = 0.30;
export var direction = 0.75;
export var ringWidth = 0.48;
export var orbitTilt = 0.58;
export var contrast = 0.60;
export var level = 0.70;

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderDirection(v) {
  direction = v;
  var dv = v * 2.0 - 1.0;
  if (dv >= 0.0 && dv < 0.06) dv = 0.06;
  else if (dv < 0.0 && dv > -0.06) dv = -0.06;
  orbitDirection = dv;
}
export function sliderRingWidth(v) { ringWidth = v; }
export function sliderOrbitTilt(v) { orbitTilt = v; }
export function sliderContrast(v) { contrast = v; }
export function sliderLevel(v) { level = v; }

// ── UV AUTHORITY (uv_only family block — byte-identical across
//    patterns/uv_only/*; hash-gated by uv_only_contract.test.js) ──
// The family renders UV ONLY: violet-intensity art on the fixtures that
// physically carry a U emitter — the Hull Canvas ShehdsBars (FIX_BAR_18)
// and the Organ UkingPars (FIX_PAR). Silhouette strands, Jewelry rails and
// the TE signs have NO violet die, so those pixels are held at exact zero
// and the sim, the gallery and the playa all tell the same truth (house
// convention from patterns/65_uv_only.js). R = G = B = W = A = 0 on every
// pixel of every frame, and NO colorPalette exports — untintable by design.
function clamp01(v) {
  if (v < 0.0) return 0.0;
  if (v > 1.0) return 1.0;
  return v;
}
function smooth01(v) {
  var sv = clamp01(v);
  return sv * sv * (3.0 - 2.0 * sv);
}
function emitUv(uvLevel) {
  var uLane = clamp01(uvLevel);
  if (fixtureType != FIX_BAR_18 && fixtureType != FIX_PAR) uLane = 0.0;
  rgbwau(0.0, 0.0, 0.0, 0.0, 0.0, uLane);
}
// ── end UV AUTHORITY ──

var PHASE_WRAP = 4096.0;

var orbitA = 0.0;
var orbitB = 0.0;
var orbitC = 0.0;
var orbitDirection = 0.50;

var c1x = 0.0, c1y = 0.0, c1z = 0.0;
var c2x = 0.0, c2y = 0.0, c2z = 0.0;
var c3x = 0.0, c3y = 0.0, c3z = 0.0;
var n1x = 0.0, n1y = 1.0, n1z = 0.0;
var n2x = 1.0, n2y = 0.0, n2z = 0.0;
var n3x = 0.0, n3y = 0.0, n3z = 1.0;

var liveWidth = 0.12;
var liveSharp = 2.0;
var liveLevel = 0.70;

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;
  var speedScale = 0.35 + clamp01(localSpeed) * 1.65;

  var shapeFollow = min(1.0, dt * 4.2);
  var lightFollow = min(1.0, dt * 9.0);
  liveWidth += (clamp01(ringWidth) - liveWidth) * shapeFollow;
  liveSharp += (0.85 + clamp01(contrast) * 3.65 - liveSharp) * shapeFollow;
  liveLevel += (clamp01(level) - liveLevel) * lightFollow;

  // Ring A orbit ~= 36 s at the reference point: 1/(36 x 0.4225) = 0.06575.
  var signed = speedScale * orbitDirection;
  orbitA += dt * 0.06575 * signed;
  orbitB += dt * 0.06575 * 0.73 * signed;
  orbitC += dt * 0.06575 * 1.37 * signed;
  if (orbitA >= PHASE_WRAP) orbitA -= PHASE_WRAP;
  if (orbitA < 0.0) orbitA += PHASE_WRAP;
  if (orbitB >= PHASE_WRAP) orbitB -= PHASE_WRAP;
  if (orbitB < 0.0) orbitB += PHASE_WRAP;
  if (orbitC >= PHASE_WRAP) orbitC -= PHASE_WRAP;
  if (orbitC < 0.0) orbitC += PHASE_WRAP;

  var a = orbitA * PI2;
  var b = orbitB * PI2;
  var c = orbitC * PI2;
  var tilt = 0.22 + clamp01(orbitTilt) * 0.96;
  var st = sin(tilt);
  var ct = cos(tilt);

  n1x = st * cos(a); n1y = ct;          n1z = st * sin(a);
  n2x = ct;          n2y = st * sin(b); n2z = st * cos(b);
  n3x = st * sin(c); n3y = st * cos(c); n3z = ct;

  c1x = sin(b) * 0.115; c1y = cos(c) * 0.070; c1z = sin(a) * 0.085;
  c2x = cos(c) * 0.090; c2y = sin(a) * 0.110; c2z = cos(b) * 0.065;
  c3x = sin(a) * 0.080; c3y = cos(b) * 0.080; c3z = sin(c) * 0.110;
}

export function render3D(index, x, y, z) {
  var px = clamp01(x) - 0.5;
  var py = clamp01(y) - 0.5;
  var pz = clamp01(z) - 0.5;

  var x1 = px - c1x, y1 = py - c1y, z1 = pz - c1z;
  var plane1 = x1 * n1x + y1 * n1y + z1 * n1z;
  var radial1 = sqrt(max(0.0, x1 * x1 + y1 * y1 + z1 * z1 - plane1 * plane1));
  var dist1 = hypot(radial1 - 0.43, plane1);

  var x2 = px - c2x, y2 = py - c2y, z2 = pz - c2z;
  var plane2 = x2 * n2x + y2 * n2y + z2 * n2z;
  var radial2 = sqrt(max(0.0, x2 * x2 + y2 * y2 + z2 * z2 - plane2 * plane2));
  var dist2 = hypot(radial2 - 0.36, plane2);

  var x3 = px - c3x, y3 = py - c3y, z3 = pz - c3z;
  var plane3 = x3 * n3x + y3 * n3y + z3 * n3z;
  var radial3 = sqrt(max(0.0, x3 * x3 + y3 * y3 + z3 * z3 - plane3 * plane3));
  var dist3 = hypot(radial3 - 0.51, plane3);

  var width = liveWidth * 0.170 + 0.055;
  var ring1 = 1.0 - clamp01(dist1 / width);
  var ring2 = 1.0 - clamp01(dist2 / width);
  var ring3 = 1.0 - clamp01(dist3 / width);
  ring1 = pow(smooth01(ring1), liveSharp);
  ring2 = pow(smooth01(ring2), liveSharp);
  ring3 = pow(smooth01(ring3), liveSharp);

  var arc1 = 0.58 + wave(atan2(y1, z1) / PI2 + orbitB * 0.83 + orbitC * 0.17) * 0.42;
  var arc2 = 0.58 + wave(atan2(z2, x2) / PI2 - orbitC * 0.71 + orbitA * 0.23) * 0.42;
  var arc3 = 0.58 + wave(atan2(x3, y3) / PI2 + orbitA * 0.61 - orbitB * 0.19) * 0.42;
  var lit1 = ring1 * arc1;
  var lit2 = ring2 * arc2;
  var lit3 = ring3 * arc3;

  var haloWidth = width * 2.85;
  var halo1 = 1.0 - clamp01(dist1 / haloWidth);
  var halo2 = 1.0 - clamp01(dist2 / haloWidth);
  var halo3 = 1.0 - clamp01(dist3 / haloWidth);
  halo1 = halo1 * halo1;
  halo2 = halo2 * halo2;
  halo3 = halo3 * halo3;

  var intersection = clamp01(ring1 * ring2 + ring2 * ring3 + ring3 * ring1);
  var haloEnergy = clamp01((halo1 + halo2 + halo3) * 0.16);
  var brightest = max(lit1, max(lit2, lit3));

  var keep = 0.15 + (py + 0.5) * 0.07;
  var lvl = keep;
  lvl = lvl + brightest * (0.44 + 0.40 * brightest);
  lvl = lvl + haloEnergy * 0.24;
  lvl = lvl + intersection * (0.30 + contrast * 0.24);

  if (fixtureType == FIX_PAR) {
    // Organs: a restrained per-fixture pulse when any hoop core passes near,
    // distinct from the continuous wall arcs.
    var station = fixtureId * 0.04481 - floor(fixtureId * 0.04481);
    var pulse = smooth01(brightest * 1.4) * (0.70 + wave(station * 4.0 + orbitA) * 0.30);
    lvl = keep * 0.88;
    lvl = lvl + pulse * (0.55 + brightest * 0.45);
    lvl = lvl + haloEnergy * 0.24;
  }

  var authored = 0.30 + liveLevel * 0.70;
  emitUv(lvl * authored);
}
