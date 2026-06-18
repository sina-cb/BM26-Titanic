/*
  111_logsville_giant_pixel_heartbeat
  Logsville redwoods as 3-5 GIANT pixels. All sections sit at a low
  baseline (Rule B floor); on each beat one or two pop hard, then
  decay back to the baseline. heartbeatPattern picks which
  section(s) fire per beat (single-rotating / pair-rotating /
  all-on-beat / random-deterministic). Vintage cluster pulses in
  sync with the same envelope so the whole grove "breathes" as a
  single organism (Rule C). Audio is additive — the heartbeat still
  ticks via localSpeed when no audio is present (Rule F).

  Audio sliders (default 0):
    audioKick — triggers the pop (each rising kick = one heartbeat)
    audioBass — raises the baseline / floor brightness
    audioMid  — widens the halo around the popping section

  View masks consumed (named, registered in summer_camp_logsville.viewmasks.js):
    RedwoodPARs (0x40) — the giant-pixel heartbeat
    VintageOnly (0x80) — synced amber glow on the beat
*/

// Named view-mask bits (mirrors summer_camp_logsville.viewmasks.js).
var MASK_REDWOOD_PARS = 64;
var MASK_VINTAGE_ONLY = 128;

// Redwood pixel range — derived count, defensive for future expansion.
var REDWOOD_BASE = 204;
var REDWOOD_END  = 221;
var NUM_REDWOOD_PIXELS = REDWOOD_END - REDWOOD_BASE + 1;

// Heartbeat pattern enum.
var HB_SINGLE_ROT = 0;
var HB_PAIR_ROT   = 1;
var HB_ALL        = 2;
var HB_RANDOM     = 3;
var HB_COUNT      = 4;

export var localSpeed = 0.5;
export var sectionFloor = 0.08;       // 5-10% baseline (Rule B)
export var neighborWeight = 0.30;     // 20-35% halo (Rule B)
export var popBrightness = 1.0;       // pop intensity
export var popDecay = 0.55;           // 0 = snappy, 1 = lazy decay
export var vintageMix = 0.55;

export var sectionCountSlider = 0.5;    // 3 / 4 / 5
export var heartbeatPattern = 0.0;

// Audio sliders.
export var audioKick = 0.0;
export var audioBass = 0.0;
export var audioMid  = 0.0;

// Palette defaults — bright per Rule D.
export var cp1H = 0.0,  cp1S = 1.0, cp1V = 1.0;   // hot red
export var cp2H = 0.75, cp2S = 1.0, cp2V = 0.9;   // violet
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderSectionFloor(v) { sectionFloor = v; }
export function sliderNeighborWeight(v) { neighborWeight = v; }
export function sliderPopBrightness(v) { popBrightness = v; }
export function sliderPopDecay(v) { popDecay = v; }
export function sliderVintageMix(v) { vintageMix = v; }
export function sliderSectionCount(v) { sectionCountSlider = v; }
export function sliderHeartbeatPattern(v) { heartbeatPattern = v; }
export function sliderAudioKick(v) { audioKick = v; }
export function sliderAudioBass(v) { audioBass = v; }
export function sliderAudioMid(v) { audioMid = v; }

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

// Internal state.
var tPhase = 0.0;
var beatEnv = 0.0;          // 1.0 at heartbeat moment, decays toward 0
var beatPhase = 0.0;        // 0..1 phase between beats (localSpeed-driven)
var beatCount = 0;          // increments each heartbeat — picks active section
var prevKick = 0.0;
var sectionCount = 4;
var pattern = 0;

// Per-frame: which sections are popping right now? Bitfield (up to 5 bits).
var popMask = 0;

function _popMaskFor(pat, beat, sc) {
  if (pat == HB_ALL) {
    var allMask = 0;
    // local name avoids `i` which is reserved in MarsinScript.
    var ix = 0;
    while (ix < sc) {
      allMask = allMask | (1 << ix);
      ix = ix + 1;
    }
    return allMask;
  }
  if (pat == HB_PAIR_ROT) {
    var a = beat % sc;
    var b = (beat + 1) % sc;
    return (1 << a) | (1 << b);
  }
  if (pat == HB_RANDOM) {
    // Deterministic-but-busy: jitter beat by a coprime stride so it doesn't
    // cycle predictably 0,1,2,3,...
    var j = (beat * 3 + floor(beat / sc)) % sc;
    return 1 << j;
  }
  // HB_SINGLE_ROT (default)
  return 1 << (beat % sc);
}

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  var localMult = pow(2.0, (localSpeed - 0.5) * 5.4);

  tPhase = (tPhase + (delta / 1310.72) * localMult) % 1.0;
  if (tPhase < 0.0) tPhase += 1.0;

  _hsv2rgb1();
  _hsv2rgb2();

  sectionCount = 3 + floor(clamp01(sectionCountSlider + 0.001) * 2.99);
  if (sectionCount < 3) sectionCount = 3;
  if (sectionCount > 5) sectionCount = 5;

  pattern = floor(clamp01(heartbeatPattern + 0.001) * (HB_COUNT - 0.01));
  if (pattern < 0) pattern = 0;
  if (pattern >= HB_COUNT) pattern = HB_COUNT - 1;

  // Base BPM-ish heartbeat from localSpeed. ~60 BPM at slider 0.5,
  // ~30 BPM at 0, ~120 BPM at 1.
  var beatHz = 0.5 + localSpeed * 1.5;
  var prevBeatPhase = beatPhase;
  beatPhase = beatPhase + dt * beatHz;
  if (beatPhase >= 1.0) {
    var beats = floor(beatPhase);
    beatPhase = beatPhase - beats;
    beatCount = (beatCount + beats) % 1024;
    beatEnv = 1.0;
    popMask = _popMaskFor(pattern, beatCount, sectionCount);
  }

  // Audio-kick rising edge — overrides timing and pops immediately.
  var kickRise = audioKick - prevKick;
  prevKick = audioKick;
  if (kickRise > 0.08) {
    beatCount = (beatCount + 1) % 1024;
    beatEnv = 1.0;
    popMask = _popMaskFor(pattern, beatCount, sectionCount);
    beatPhase = 0.0;
  }

  // Decay the envelope. popDecay slider sets the half-life.
  // Snappy at popDecay=0 (~50ms), lazy at popDecay=1 (~700ms).
  var halfLife = 0.05 + popDecay * 0.65;
  beatEnv = beatEnv * pow(0.5, dt / halfLife);
}

// Engine convention: x, y, z are normalized pixel coords in [0,1].
export function render3D(index, x, y, z) {
  var isRedwood = (viewMask & MASK_REDWOOD_PARS) != 0;
  var isVintage = (viewMask & MASK_VINTAGE_ONLY) != 0;
  var r = 0.0, g = 0.0, b = 0.0, w = 0.0, a = 0.0, u = 0.0;

  if (isRedwood) {
    var localIdx = index - REDWOOD_BASE;
    if (localIdx < 0) localIdx = 0;
    if (localIdx >= NUM_REDWOOD_PIXELS) localIdx = NUM_REDWOOD_PIXELS - 1;
    var giantPixelId = floor(localIdx * sectionCount / NUM_REDWOOD_PIXELS);
    if (giantPixelId >= sectionCount) giantPixelId = sectionCount - 1;

    var isPopping = ((popMask >> giantPixelId) & 1) != 0;

    // Floor (Rule B) — lifted by bass.
    var bassLift = audioBass * 0.18;
    var floorBreath = (sectionFloor + bassLift) * (0.85 + 0.15 * wave(tPhase * 0.5 + giantPixelId * 0.21));

    // Neighbor halo radius driven by sliderAudioMid (Rule E).
    var haloRadius = 1 + (audioMid > 0.5 ? 1 : 0);
    var nearestPopDist = sectionCount; // big
    var j = 0;
    while (j < sectionCount) {
      if (((popMask >> j) & 1) != 0) {
        var d = abs(giantPixelId - j);
        if (d < nearestPopDist) nearestPopDist = d;
      }
      j = j + 1;
    }

    var coreBoost = isPopping ? 1.0 : 0.0;
    var haloBoost = 0.0;
    if (!isPopping && nearestPopDist <= haloRadius) {
      // Soft falloff — Rule B: neighbors at 20-35%.
      haloBoost = neighborWeight * pow(1.0 - nearestPopDist / (haloRadius + 1.0), 2.0);
    }

    var envelope = beatEnv;
    var brightness = floorBreath;
    if (coreBoost > 0.0) {
      brightness = max(brightness, popBrightness * envelope);
    }
    if (haloBoost > 0.0) {
      brightness = max(brightness, haloBoost * envelope);
    }

    // Palette gradient across sections (Rule G).
    var mix = (sectionCount > 1) ? (giantPixelId / (sectionCount - 1)) : 0.5;
    var rc = pr1 + (pr2 - pr1) * mix;
    var gc = pg1 + (pg2 - pg1) * mix;
    var bc = pb1 + (pb2 - pb1) * mix;

    r = rc * brightness;
    g = gc * brightness;
    b = bc * brightness;
    // Amber kicks on the pop only — helps the beat punch through.
    if (isPopping) a = 0.4 * envelope;
  } else if (isVintage) {
    // Vintage glows with the same envelope. Rule C — vintage complements.
    var baseV = 0.15 + audioBass * 0.20;
    var pulseV = baseV + 0.55 * beatEnv * vintageMix;
    // Tint with a slow palette blend so palette swaps register.
    var mixV = wave(tPhase * 0.3 + x * 0.5);
    r = (pr1 + (pr2 - pr1) * mixV) * pulseV * 0.7;
    g = (pg1 + (pg2 - pg1) * mixV) * pulseV * 0.7;
    b = (pb1 + (pb2 - pb1) * mixV) * pulseV * 0.7;
    a = 0.35 * beatEnv * vintageMix;
  } else {
    // Towers / other: each beat sends a vertical pulse climbing the tower
    // column — same envelope as the redwood pop so the rig reads as one
    // organism. Column = 18 pixels each; barT is 0 at bottom, 1 at top.
    // The pulse "front" travels from 0 to 1 as beatEnv decays 1 -> 0.
    var isTowerBar = (index <= 143);
    if (isTowerBar) {
      var barT = (index % 18) / 17.0;
      var pulseFront = 1.0 - beatEnv;       // 0 at the beat, climbs to 1
      // Soft raised-cosine slice around the front. Width scales with
      // popDecay so lazy decays paint a fat band, snappy decays a thin
      // bright bar.
      var bandWidth = 0.18 + 0.22 * popDecay;
      var d = barT - pulseFront;
      if (d < 0.0) d = -d;
      var pulseBright = 0.0;
      if (d < bandWidth) {
        pulseBright = 0.5 + 0.5 * cos(d / bandWidth * PI);
      }
      // Tower-wide ambient breathing so the towers never go fully dark
      // between beats. Bass lift mirrors redwood branch.
      var towerBass = audioBass * 0.10;
      var ambient = 0.04 + towerBass + 0.06 * beatEnv;
      // Per-tower stagger so the 8 towers don't all flash identically —
      // each tower's pulse phase is offset by towerIdx * golden ratio.
      var towerIdx = floor(index / 18);
      var towerOffset = (towerIdx * 0.618) % 1.0;
      var mixT = wave(barT * 0.5 + tPhase * 0.4 + towerOffset);
      var lit = max(ambient, pulseBright * beatEnv * popBrightness * 0.55);
      r = (pr1 + (pr2 - pr1) * mixT) * lit;
      g = (pg1 + (pg2 - pg1) * mixT) * lit;
      b = (pb1 + (pb2 - pb1) * mixT) * lit;
    } else {
      // TowerVintage (144-167) / WallVintage (168-203) when not flagged
      // VintageOnly fall through to a low ambient floor — keep parity
      // with original behaviour, no historic regression.
      var ambient = 0.05 + 0.10 * beatEnv;
      var mixT = wave(x + tPhase * 0.3);
      r = (pr1 + (pr2 - pr1) * mixT) * ambient;
      g = (pg1 + (pg2 - pg1) * mixT) * ambient;
      b = (pb1 + (pb2 - pb1) * mixT) * ambient;
    }
  }

  rgbwau(clamp01(r), clamp01(g), clamp01(b), clamp01(w), clamp01(a), clamp01(u));
}
