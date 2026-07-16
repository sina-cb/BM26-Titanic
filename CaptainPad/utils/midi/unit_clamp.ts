// The ONE unit-interval clamp shared across the MIDI layer. Every focused/global
// param value lives in [0, 1]; both the manager's dispatch path and the LED
// projector's ring math clamp to it. Extracted here so the two can't drift
// (was duplicated as manager.clamp01 + led_projector.clampUnit).

/** Clamp a number to the unit interval [0, 1]. */
export function clampUnit(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
