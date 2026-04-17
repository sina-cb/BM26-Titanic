/*
  RPM Heartbeat — Synchronized heartbeat pulse across the sign
  All letters pulse together in white, then fade to letter color.
  Proves swarm time sync works perfectly across controllers.
*/

export var minBright = 0.04;
export var t1, beat

export function beforeRender(delta) {
  t1 = time(0.012)
  
  // Double-beat pattern (like a heartbeat: lub-dub)
  var cycle = t1 % 1
  beat = 0
  if (cycle < 0.08) {
    beat = wave(cycle / 0.08)  // first beat
  } else if (cycle > 0.12 && cycle < 0.18) {
    beat = wave((cycle - 0.12) / 0.06) * 0.7  // second beat (softer)
  }
}

export function render3D(index, x, y, z) {
  // Letter's resting color
  var hue = (sectionId - 1) / 3
  
  // During heartbeat: all flash white-hot, then fade to color
  var sat = 1.0 - beat * 0.9
  var bright = minBright + beat * (1.0 - minBright)
  
  // Add subtle x-wave delay so the beat "ripples" across the sign
  var delay = x * 0.03
  var delayedBeat = beat
  // Slight position-based intensity variation
  var posMod = 1.0 - abs(y - 0.5) * 0.3
  
  hsv(hue, sat, bright * posMod)
}