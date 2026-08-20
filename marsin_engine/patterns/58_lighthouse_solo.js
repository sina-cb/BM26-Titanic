/*
  58_lighthouse_solo.js — ONE crisp rotating lighthouse beam for the whole rig.

  Amalgamates 01_cylon_sweep (sharp sweeping high-contrast core) +
  51_abyssal_searchlight (single far-field searchlight on near-black) +
  115_tower_lighthouse_sweep (a beam that ROTATES around an axis). The result is
  a negative-space, far-field, high-definition LIGHTHOUSE: a single bright
  angular wedge rotates around the rig center on a deep night field. Maximally
  readable from far away — the beam is ALWAYS present (mission-critical
  visibility), even in silence (a steady dim rotating beam, never fully black).

  HOW IT WORKS
    - Each pixel's azimuth around the rig center (x,z = 0.5,0.5) is found with
      atan2 (radians → 0..1 turn). The beam is a sweeping target angle; a pixel
      lights when its angle is within the beam's angular half-width of the beam.
    - The beam BRIGHTNESS and WIDTH grow with `beam` (the level handle). A kick
      (`flash`) adds a bright flash / double-pulse on top.
    - Both TE signs share one pixelLocalIndex lens sweep. Its sqrt(2) texture
      ratio keeps the blue afterglow from visibly re-locking to the beam, while
      identical local paths give the two signs exact frame-by-frame balance.
    - Colour: beam CORE is cp1 (warm white / amber), the trailing edge of the
      wedge fades toward cp2 (deep blue night). A tunable nonzero floor keeps
      every fixture visible between passes.

  CONTROLS (UI order = declaration order)
    - localSpeed : rotation rate of the beam (0 = slow drift, 1 = fast sweep).
    - beam       : LEVEL → beam brightness + angular width (PRIMARY).
    - flash      : KICK → bright flash / double-pulse overlaid on the beam.
    - width      : BASE angular half-width of the beam; micFlux EXPANDS the
                   sweep reach (the wedge widens on a build) — still one beam.
    - safetyFloor: guaranteed whole-rig light floor; its full range maps to a
                   nonzero 3.5%..16% night field, so blackout is impossible.
    - colorPalette1/2 : cp1 warm-white/amber beam core, cp2 deep-blue night.

  SPARSE BY DESIGN: a single rotating beam on a near-black night. Audio only
  brightens/flashes/widens the ONE beam — it never fragments into many sources.

  AUDIO (modulators-only — never read CPC audio globals natively):
  AUDIO_MODULATION_V1:
    sliderBeam  <- micLow  range 0.30..1.00 curve linear   # PRIMARY beam brightness + width
    sliderFlash <- micKick range 0.00..1.00 curve linear   # KICK: bright flash / double-pulse
    sliderWidth <- micFlux range 0.40..0.90 curve linear   # MOVEMENT: build expands the beam sweep reach
*/

// ── Exported controls (UI order = declaration order) ─────────────────────────
// Canonical append-only optional fixture role; absent roles match no pixels.
var FIX_TE_SIGN = 7;

export var localSpeed = 0.5;   // rotation rate (0 = slow drift .. 1 = fast sweep)
export var beam = 0.5;         // PRIMARY: beam brightness + width (resting = visible)  <- micLow
export var flash = 0.0;        // kick: bright flash / double-pulse  <- micKick
export var width = 0.5;        // base half-width; build expands sweep reach  <- micFlux
export var safetyFloor = 0.5;  // hard night floor; maps strictly to 0.035..0.160

export var cp1H = 0.11, cp1S = 0.55, cp1V = 1.0; // beam core: warm white / amber
export var cp2H = 0.62, cp2S = 1.0,  cp2V = 0.5; // night: deep blue
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderBeam(v) { beam = v; }
export function sliderFlash(v) { flash = v; }
export function sliderWidth(v) { width = v; }
export function sliderSafetyFloor(v) { safetyFloor = v; }

// ── Tunables ─────────────────────────────────────────────────────────────────
var MAX_RATE = 0.5;     // turns per second at localSpeed = 1.0
var BASE_GLOW = 0.06;   // night floor inside the wedge so it always reads
var FLOOR_MIN = 0.035;  // control endpoint: never permit full blackout
var FLOOR_SPAN = 0.125; // safetyFloor 0..1 -> liveFloor 0.035..0.160

// ── Palette RGB cache (strict cp1<->cp2 blending; PATTERNS.md §7) ─────────────
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

// ── Persistent state ─────────────────────────────────────────────────────────
var beamPhase = 0.0;    // current beam angle, 0..1 turns
var signPhase = 0.0;    // independent long-running sign texture phase
var flashEnv = 0.0;     // decaying kick flash envelope
var halfW = 0.15;       // resolved beam half-width this frame (turns)
var beamLvl = 0.45;     // resolved beam level this frame
var flashAdd = 0.0;     // resolved flash brightness this frame
var liveFloor = 0.0975; // resolved guaranteed whole-rig light floor

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  _hsv2rgb1();
  _hsv2rgb2();

  // Rotate the beam. localSpeed scales the rate on an exponential curve with a
  // small floor, so the beam ALWAYS drifts (motion > 0 even at localSpeed = 0)
  // and clearly sweeps faster as localSpeed -> 1 (visible across the whole range).
  var rate = MAX_RATE * (0.10 + 0.90 * pow(2.0, (localSpeed - 0.5) * 4.0) * 0.25);
  var phaseStep = dt * rate;
  beamPhase = beamPhase + phaseStep;
  beamPhase = beamPhase - floor(beamPhase);
  signPhase = signPhase + phaseStep;
  if (signPhase >= 100000.0) signPhase = signPhase - 100000.0;

  // Beam half-width grows with level on top of the operator base width. `width`
  // (micFlux) EXPANDS the sweep reach — a build widens the one wedge.
  halfW = 0.04 + width * 0.18 + beam * 0.12;   // turns (0..1)
  beamLvl = beam;
  liveFloor = FLOOR_MIN + clamp01(safetyFloor) * FLOOR_SPAN;

  // Kick flash with a quick double-pulse decay (searchlight afterglow).
  if (flash > 0.5) flashEnv = 1.0;
  flashEnv = flashEnv - dt * 4.5;
  if (flashEnv < 0.0) flashEnv = 0.0;
  // double-pulse: a second smaller bump as the envelope crosses ~0.45
  flashAdd = flashEnv;
  if (flashEnv > 0.4 && flashEnv < 0.55) flashAdd = flashEnv + 0.25;
}

export function render3D(index, x, y, z) {
  // Azimuth around the ship in the horizontal XZ plane. The former XY plane
  // rotated vertically through decks instead of sweeping around the vessel.
  var dx = x - 0.5;
  var dz = z - 0.5;
  var ang = atan2(dz, dx) / PI2;   // -0.5..0.5
  ang = ang - floor(ang);          // 0..1

  // Shortest angular distance to the beam and its exact opposite. The mirrored
  // fan prevents one physical side of the Titanic from remaining dark while
  // preserving one coherent rotation phase and one Width control.
  var dd = ang - beamPhase;
  dd = dd - floor(dd + 0.5);       // wrap to -0.5..0.5
  var ad = abs(dd);
  var ddOpp = ang - (beamPhase + 0.5);
  ddOpp = ddOpp - floor(ddOpp + 0.5);
  var adOpp = abs(ddOpp);
  if (adOpp < ad) ad = adOpp;

  // Beam profile: bright crisp core, fading to the wedge edge.
  var bri = liveFloor;
  var tcol = 1.0;                  // 0 = core (cp1) ... 1 = night (cp2)
  var prof = 0.0;
  if (ad < halfW) {
    prof = 1.0 - (ad / halfW); // 1 at core -> 0 at edge
    prof = prof * prof;            // tighten the core (high-def)
    // brightness scales with level, with a guaranteed dim base so it always reads.
    // The level maps with a >1 headroom so the beam CORE burns bright (peak >=200)
    // at the default level while still ramping monotonically with micLow (corr).
    // PRIMARY: beam level maps with a >1 headroom AND a mild quadratic emphasis
    // so overall brightness tracks micLow steeply and monotonically (corr >= 0.5)
    // while the bright core still burns past 200 at the default level.
    var bl = clamp01(beamLvl);
    var lvl = BASE_GLOW + (1.95 - BASE_GLOW) * (0.30 * bl + 0.70 * bl * bl);
    var wedge = BASE_GLOW + (1.0 - BASE_GLOW) * prof;
    bri = wedge * lvl;
    if (bri < BASE_GLOW) bri = BASE_GLOW;   // never black inside the wedge
    if (bri < liveFloor) bri = liveFloor;   // the floor remains hard at every setting
    // kick flash brightens (and slightly widens via brightness) the whole beam
    bri = bri + flashAdd * prof;
    tcol = 1.0 - prof;             // core -> cp1, trailing edge -> cp2
  }

  bri = clamp01(bri);

  // Colour blends cp1 (core) -> cp2 (night) by tcol.
  var r = (pr1 + (pr2 - pr1) * tcol) * bri;
  var g = (pg1 + (pg2 - pg1) * tcol) * bri;
  var b = (pb1 + (pb2 - pb1) * tcol) * bri;

  // Instrument staging through portable fixture roles. Pars are the lighthouse
  // source, Vintage rails hold a warm afterglow, signs stay readable, and the
  // rotating fan remains strongest on the bar/strand canvas.
  // A small matched native-white component makes the safety floor physical
  // even if both palette endpoints are tuned black. W and A remain identical.
  var w = liveFloor * 0.16
        + prof * prof * (0.10 + beamLvl * 0.52 + flashAdd * 0.38);
  if (fixtureType == FIX_VINTAGE_6) {
    w = w + 0.045 + prof * 0.12;
    r = r + 0.08 * (0.25 + prof);
    g = g + 0.035 * (0.25 + prof);
  } else if (fixtureType == FIX_PAR) {
    var source = 0.035 + beamLvl * 0.075;
    r = r + source;
    g = g + source * 0.42;
    w = w + source * 0.45;
  } else if (fixtureType == FIX_TE_SIGN) {
    // Identity becomes a matched pair of miniature lighthouse surfaces. Each
    // letter path receives the same pixelLocalIndex beam and halo, so both
    // signs are byte-symmetric while every puck keeps a legible light floor.
    var signPath = pixelLocalIndex / 39.0;
    var signDelta = signPath - beamPhase;
    signDelta = signDelta - floor(signDelta + 0.5);
    var signCore = clamp01(1.0 - abs(signDelta) / 0.10);
    signCore = signCore * signCore;
    var signHalo = clamp01(1.0 - abs(signDelta) / 0.28);
    signHalo = signHalo * signHalo;
    var signTexture = wave(signPath * 0.61803 - signPhase * 1.41421);
    var signBri = clamp01(0.40 + liveFloor * 0.55 + signTexture * 0.06
                        + signHalo * 0.22 + signCore * 0.28);
    var signMix = clamp01(0.86 - signCore * 0.78 - signHalo * 0.10
                        + signTexture * 0.04);
    r = (pr1 + (pr2 - pr1) * signMix) * signBri;
    g = (pg1 + (pg2 - pg1) * signMix) * signBri;
    b = (pb1 + (pb2 - pb1) * signMix) * signBri;
    w = 0.025 + liveFloor * 0.20 + signHalo * 0.05 + signCore * 0.10;
  }

  w = clamp01(w);
  rgbwau(clamp01(r), clamp01(g), clamp01(b), w, w, 0.0);
}
