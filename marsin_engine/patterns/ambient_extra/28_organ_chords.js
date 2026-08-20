// DRAFT — pending operator review
/*
  28_organ_chords.js — ORGAN CHORDS

  CONCEPT
    Three to six spatially separated Organ voices hold a luminous chord, ease
    into a new voicing, and send a broad delayed resonance through the ship.
    This is a slow chord room, not a wave or interference field.

  INSTRUMENT STAGING
    FIX_PAR        — primary 3–6 voice chord, grouped by normalized position.
    FIX_BAR_18     — low Hull resonance lobes arriving after each chord change.
    FIX_RAW_LED    — the held chord's clean Silhouette outline.
    FIX_VINTAGE_6  — sparse palette-RGB overtones; no native white.
    FIX_TE_SIGN    — identical, stable chord emblems on both TE signs.

  MOTION / MATH
    A finite seven-state chord walk chooses a non-zero modular jump after each
    irrationally varied dwell. Voices remain quantized while held; only the
    chord change uses cubic easing. A separate piecewise envelope rises about
    0.4 seconds later, peaks near 0.8 seconds, and clears near 1.2 seconds at
    the ambient default, so the Hull
    visibly answers the Organ rather than flashing with it. A shallow
    irrational room breath prevents a visibly repeating mechanical loop.

  CONTROLS (declaration order = physical MIDI order)
    localSpeed  — cadence of chord changes and the restrained room breath.
    voiceCount  — three to six distinct spatial Organ voices.
    chordSpread — palette and energy distance between the held voices.
    hold        — duration of each stable chord state.
    attack      — softness and duration of the chord-to-chord interpolation.
    resonance   — strength and breadth of the delayed Hull answer.
    safetyFloor — dependable minimum visibility across the complete rig.

  AUDIO_MODULATION_V1:
    sliderChordSpread <- micMid  range 0.22..0.55 curve linear # mids open the held voicing
    sliderResonance   <- micFlux range 0.12..0.42 curve ease   # flux strengthens the delayed Hull answer
  Static (unmapped) params: localSpeed, voiceCount, hold, attack, safetyFloor,
    colorPalette1/2.

  COLOR / OUTPUT
    RGB stays strictly on the selected cp1-to-cp2 line. The pattern emits no
    native white and no UV, so W=A=U=0 exactly. Silence remains a complete,
    slowly changing ambient composition with a whole-rig safety floor.
*/

export var localSpeed = 0.30;
export var voiceCount = 0.48;
export var chordSpread = 0.42;
export var hold = 0.48;
export var attack = 0.38;
export var resonance = 0.28;
export var safetyFloor = 0.30;

export var cp1H = 0.585, cp1S = 0.82, cp1V = 0.90;
export var cp2H = 0.095, cp2S = 0.78, cp2V = 1.00;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderVoiceCount(v) { voiceCount = v; }
export function sliderChordSpread(v) {
  chordSpread = v;
  liveChordSpread = v;
}
export function sliderHold(v) { hold = v; }
export function sliderAttack(v) { attack = v; }
export function sliderResonance(v) { resonance = v; }
export function sliderSafetyFloor(v) { safetyFloor = v; }

var PHI = 1.61803399;
var SQRT2 = 1.41421356;
var GOLDEN_ANGLE = 2.39996323;
var CLOCK_WRAP = 10000.0;

// Begin near a change so a short offline or operator preview demonstrates the
// chord transition and its delayed Hull resonance immediately.
var chordAge = 5.0;
var roomClock = 0.0;
var chordStep = 0.0;
var oldChord = 0.0;
var newChord = 0.0;
var chordBlend = 1.0;
var resonanceEnvelope = 0.0;

var liveVoiceCount = 0.48;
var liveChordSpread = 0.42;
var liveHold = 0.48;
var liveAttack = 0.38;
var liveResonance = 0.28;
var liveSafetyFloor = 0.30;

var pr1 = 1.0, pg1 = 0.0, pb1 = 0.0;
var pr2 = 0.0, pg2 = 0.0, pb2 = 1.0;

function clamp01(v) {
  if (v < 0.0) return 0.0;
  if (v > 1.0) return 1.0;
  return v;
}

function smooth01(v) {
  v = clamp01(v);
  return v * v * (3.0 - 2.0 * v);
}

function fract01(v) {
  return v - floor(v);
}

function periodicDistance(a1, a2) {
  var distance = abs(a1 - a2);
  return min(distance, 1.0 - distance);
}

function _hsv2rgb1() {
  var hv = cp1H - floor(cp1H); if (hv < 0.0) hv += 1.0;
  var iv = floor(hv * 6.0) % 6.0;
  var fv = hv * 6.0 - floor(hv * 6.0);
  var pv = cp1V * (1.0 - cp1S);
  var qv = cp1V * (1.0 - fv * cp1S);
  var tv = cp1V * (1.0 - (1.0 - fv) * cp1S);
  if      (iv == 0.0) { pr1 = cp1V; pg1 = tv;   pb1 = pv;   }
  else if (iv == 1.0) { pr1 = qv;   pg1 = cp1V; pb1 = pv;   }
  else if (iv == 2.0) { pr1 = pv;   pg1 = cp1V; pb1 = tv;   }
  else if (iv == 3.0) { pr1 = pv;   pg1 = qv;   pb1 = cp1V; }
  else if (iv == 4.0) { pr1 = tv;   pg1 = pv;   pb1 = cp1V; }
  else                 { pr1 = cp1V; pg1 = pv;   pb1 = qv;   }
}

function _hsv2rgb2() {
  var hv = cp2H - floor(cp2H); if (hv < 0.0) hv += 1.0;
  var iv = floor(hv * 6.0) % 6.0;
  var fv = hv * 6.0 - floor(hv * 6.0);
  var pv = cp2V * (1.0 - cp2S);
  var qv = cp2V * (1.0 - fv * cp2S);
  var tv = cp2V * (1.0 - (1.0 - fv) * cp2S);
  if      (iv == 0.0) { pr2 = cp2V; pg2 = tv;   pb2 = pv;   }
  else if (iv == 1.0) { pr2 = qv;   pg2 = cp2V; pb2 = pv;   }
  else if (iv == 2.0) { pr2 = pv;   pg2 = cp2V; pb2 = tv;   }
  else if (iv == 3.0) { pr2 = pv;   pg2 = qv;   pb2 = cp2V; }
  else if (iv == 4.0) { pr2 = tv;   pg2 = pv;   pb2 = qv;   }
  else                 { pr2 = cp2V; pg2 = pv;   pb2 = qv;   }
}

export function beforeRender(delta) {
  var dt = delta / 1000.0;
  if (dt < 0.0) dt = 0.0;
  if (dt > 0.1) dt = 0.1;

  // Slew every live-editable geometry and energy control. Voice-count changes
  // still cross integer boundaries deliberately, but never chatter around one.
  var geometryFollow = min(1.0, dt * 3.5);
  var lightFollow = min(1.0, dt * 7.0);
  liveVoiceCount += (clamp01(voiceCount) - liveVoiceCount) * geometryFollow;
  liveChordSpread += (clamp01(chordSpread) - liveChordSpread) * geometryFollow;
  liveHold += (clamp01(hold) - liveHold) * geometryFollow;
  liveAttack += (clamp01(attack) - liveAttack) * geometryFollow;
  liveResonance += (clamp01(resonance) - liveResonance) * lightFollow;
  liveSafetyFloor += (clamp01(safetyFloor) - liveSafetyFloor) * lightFollow;

  var speedMultiplier = 0.25 + clamp01(localSpeed)
    * (32.824 - 16.412 * clamp01(localSpeed));
  chordAge += dt * speedMultiplier;
  roomClock += dt * speedMultiplier * 0.071 * SQRT2;
  if (roomClock >= CLOCK_WRAP) roomClock -= CLOCK_WRAP;

  // The irrational dwell offset changes with the chord walk, so no short
  // sequence repeats. Each jump is 1..6 and therefore never repeats a state.
  var dwellVariation = wave((chordStep * GOLDEN_ANGLE) / PI2);
  var dwell = 2.6 + liveHold * 4.8 + dwellVariation * 1.1;
  if (chordAge >= dwell) {
    chordAge -= dwell;
    oldChord = newChord;
    chordStep += 1.0;
    var jump = 1.0 + floor(wave(chordStep * GOLDEN_ANGLE / PI2
                              + chordStep * 0.071) * 5.999);
    newChord = (oldChord + jump) % 7.0;
  }

  var attackTime = 0.18 + liveAttack * 1.72;
  chordBlend = smooth01(chordAge / attackTime);

  // A genuine delayed answer: at the ambient default speed trim, this starts
  // near 0.4 s, crests near 0.8 s, and clears near 1.2 s after the change.
  resonanceEnvelope = 0.0;
  if (chordAge >= 0.42 && chordAge < 0.78) {
    resonanceEnvelope = smooth01((chordAge - 0.42) / 0.36);
  } else if (chordAge >= 0.78 && chordAge < 1.18) {
    resonanceEnvelope = 1.0 - smooth01((chordAge - 0.78) / 0.40);
  }

  _hsv2rgb1();
  _hsv2rgb2();
}

export function render3D(index, x, y, z) {
  var nx = clamp01(x);
  var ny = clamp01(y);
  var nz = clamp01(z);
  var isSign = fixtureType == FIX_TE_SIGN;

  if (isSign) {
    // Each sign is patched as 40 + 34 pixels. Fold one complete row-major
    // 10x8/74-pixel emblem so the lower fixture extends the surface and both
    // complete signs remain byte-identical.
    var signIndex = index % 74.0;
    nx = (signIndex % 10.0) / 9.0;
    ny = floor(signIndex / 10.0) / 7.0;
    nz = 0.50;
  }

  var count = floor(3.0 + liveVoiceCount * 3.999);
  // A slanted spatial wrap spans the entire Organ layout. Unlike raw world-X
  // binning, it reaches every requested bin on Titanic even though the stacks
  // and auditoriums occupy several disconnected coordinate islands.
  var sectorCoordinate = fract01(nx * 1.70 + nz * 1.30);
  var sectorIndex = floor(min(0.999999, sectorCoordinate) * count);
  var sectorCenter = (sectorIndex + 0.5) / count;
  var voiceRank = sectorIndex / max(1.0, count - 1.0);

  // The modular pitch formulas produce finite, held voice values. They move
  // only while chordBlend eases between two chord states.
  var oldPitch = ((oldChord * 2.0 + sectorIndex * 3.0
                 + sectorIndex * sectorIndex) % 7.0) / 6.0;
  var newPitch = ((newChord * 2.0 + sectorIndex * 3.0
                 + sectorIndex * sectorIndex) % 7.0) / 6.0;
  var pitch = oldPitch + (newPitch - oldPitch) * chordBlend;
  // Keep half of the raw handle in the render expression so a hand/audio
  // change is immediately legible; the other half is slewed for polish.
  var spreadControl = liveChordSpread * 0.50
                    + clamp01(chordSpread) * 0.50;
  var spread = 0.34 + spreadControl * 1.18;
  var voiceColor = clamp01(0.50 + (pitch - 0.50) * spread
                          + (voiceRank - 0.50) * 0.16);
  // Each held voice owns a materially different level as well as palette
  // position. This keeps the chord legible even when the chosen endpoints
  // happen to have similar luminance.
  var voiceEnergy = 0.24 + pitch * 0.62 + voiceRank * 0.10
                  + wave(sectorIndex * 0.381966 + newChord * 0.137) * 0.08;
  var voiceParity = sectorIndex % 2.0;
  voiceEnergy *= 0.74 + spreadControl
               * (0.16 + voiceParity * 0.42);

  var roomBreath = 0.965 + wave(roomClock + sectorIndex / max(1.0, count))
                            * 0.035;
  var floorLevel = 0.065 + liveSafetyFloor * 0.255;
  var brightness = floorLevel + 0.08;
  var colorMix = voiceColor;

  if (fixtureType == FIX_PAR) {
    // The primary instrument. Every normalized sector holds a distinct voice
    // with a stable plateau and an eased chord-to-chord handoff.
    brightness = floorLevel + 0.12 + voiceEnergy * 0.78 * roomBreath;
    brightness += (1.0 - chordBlend) * (0.12 + liveAttack * 0.16);
    colorMix = voiceColor;
  } else if (fixtureType == FIX_BAR_18) {
    // One broad lobe answers only after the Organ chord has landed. Its center
    // is quantized by the held root, making the causal response both spatial
    // and unmistakably later than the voice change.
    var resonanceCenter = fract01((newChord + 1.0) / 7.0 + 0.11);
    var lobeDistance = periodicDistance(sectorCoordinate, resonanceCenter);
    var lobeWidth = 0.20 + liveResonance * 0.18;
    var lobe = 1.0 - smoothstep(lobeWidth, lobeWidth * 1.85, lobeDistance);
    var lowBody = 0.5 + 0.5 * cos((ny * 0.58 + nz * 0.31
                                 + resonanceCenter * PHI) * PI2);
    brightness = floorLevel + 0.045 + lowBody * 0.035
               + lobe * resonanceEnvelope * (0.30 + liveResonance * 0.82);
    colorMix = clamp01(0.08 + (voiceColor - 0.50) * 0.16
                      + lobe * resonanceEnvelope * 0.82);
  } else if (fixtureType == FIX_RAW_LED) {
    // Silhouette outlines the chord: held sector colors remain clean and a
    // restrained delayed lift makes the ship's edge answer the Hull body.
    var outlineEdge = abs(fract01(sectorCoordinate * count) - 0.50) * 2.0;
    brightness = floorLevel + 0.18 + (1.0 - outlineEdge) * 0.13
               + resonanceEnvelope * liveResonance * 0.12;
    colorMix = clamp01(voiceColor * 0.78 + outlineEdge * 0.10);
  } else if (fixtureType == FIX_VINTAGE_6) {
    // Jewelry uses only palette RGB. Individual six-head overtones choose
    // chord degrees without becoming a white sparkle or a marching chase.
    var head = pixelLocalIndex % 6.0;
    var overtone = ((head * 2.0 + sectorIndex + newChord) % 7.0) / 6.0;
    var overtoneGate = pow(wave(head * 0.381966
                               + sectorIndex * 0.173205), 5.0);
    brightness = floorLevel * 0.76 + 0.075
               + overtoneGate * (0.12 + voiceEnergy * 0.18)
               + resonanceEnvelope * liveResonance * 0.08;
    colorMix = clamp01(0.58 + overtone * spread * 0.40);
  } else if (isSign) {
    // A paired diamond/rail emblem keeps both names legible. The emblem holds
    // steady with the chord and eases—never flashes—through chord changes.
    var signX = nx - 0.50;
    var signY = ny - 0.50;
    var diamondDistance = abs(signX) + abs(signY);
    var diamond = 1.0 - smoothstep(0.22, 0.38, diamondDistance);
    var rail = 1.0 - smoothstep(0.045, 0.13,
                               abs(abs(signX) - 0.27));
    var emblem = max(diamond, rail * (0.56 + voiceEnergy * 0.24));
    brightness = floorLevel + 0.24 + emblem * 0.31
               + (1.0 - chordBlend) * 0.09;
    colorMix = clamp01(0.28 + voiceColor * 0.50
                      + emblem * 0.10 + ny * 0.06);
  }

  // A low-amplitude triangular cadence trace makes localSpeed continuously
  // observable between chord changes without changing their held pitches.
  var cadenceTrace = triangle(roomClock * 1.70
                             + sectorCoordinate * 0.31);
  if (fixtureType != FIX_BAR_18) brightness += cadenceTrace * 0.035;

  // Spread also separates the voice energies, not only their hues. This makes
  // the handle unambiguous even when both selected palette endpoints happen
  // to have similar luminance.
  if (fixtureType != FIX_BAR_18) {
    brightness += spreadControl
                * (0.015 + voiceRank * 0.075 + voiceParity * 0.12);
  }
  // Attack visibly softens the entire room handoff; Organs remain the lead,
  // while their supporting instruments share only this restrained transient.
  if (fixtureType == FIX_PAR) {
    brightness += (1.0 - chordBlend) * liveAttack * 0.34;
  } else if (fixtureType != FIX_BAR_18) {
    brightness += (1.0 - chordBlend) * liveAttack * 0.10;
  }

  brightness = clamp01(brightness);
  colorMix = clamp01(colorMix);
  var outR = (pr1 + (pr2 - pr1) * colorMix) * brightness;
  var outG = (pg1 + (pg2 - pg1) * colorMix) * brightness;
  var outB = (pb1 + (pb2 - pb1) * colorMix) * brightness;
  rgbwau(clamp01(outR), clamp01(outG), clamp01(outB), 0.0, 0.0, 0.0);
}
