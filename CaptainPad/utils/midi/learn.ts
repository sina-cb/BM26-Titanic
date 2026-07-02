// MIDI-learn — the pure half of binding a physical control to a local param.
//
// "Learn" is the modulator-style flow Sina asked for: the operator presses a
// per-param MIDI button, ARMS capture, then moves a fader; the next inbound
// control binds to that param (stored per-pattern, applied by CaptainPad — see
// utils/api.ts MidiMapping + manager.ts). Everything here is dependency-free
// (no transport, no timers) so it is unit-testable with synthetic events; the
// impure wiring (transport listener, coalescer, dispatch) lives in manager.ts.

import { DecodedMidi } from './midi_message';

/** The physical control a binding captures. channel 0-15; number = CC number
 *  (type 'cc') or note (type 'note'). Mirrors MidiMapping.control in api.ts. */
export interface MidiControlRef {
  type: 'cc' | 'note';
  channel: number;
  number: number;
}

const MIDI_MAX = 127;

/** Scale a raw 0-127 MIDI value into [min, max] (engine units). Clamped so an
 *  out-of-spec byte can't overshoot the range. */
export function scaleMidiToRange(value: number, range: readonly [number, number]): number {
  const v = Math.max(0, Math.min(MIDI_MAX, value));
  const [min, max] = range;
  return min + (v / MIDI_MAX) * (max - min);
}

/** Extract a learnable control + its raw value from a decoded event, or null.
 *  We learn from continuous CC (faders/knobs — the common case) and from Note
 *  On (a pad). Note Off and 'other' never bind — that silence is the signal. */
export function controlRefFromEvent(
  ev: DecodedMidi,
): { ref: MidiControlRef; value: number; continuous: boolean } | null {
  if (ev.type === 'cc') {
    return { ref: { type: 'cc', channel: ev.channel, number: ev.cc }, value: ev.value, continuous: true };
  }
  if (ev.type === 'noteOn') {
    return { ref: { type: 'note', channel: ev.channel, number: ev.note }, value: ev.velocity, continuous: false };
  }
  return null;
}

/** Does a decoded event match a stored binding's control? Note On only for
 *  notes (Note Off never drives a value). */
export function bindingMatches(control: MidiControlRef, ev: DecodedMidi): boolean {
  if (control.type === 'cc' && ev.type === 'cc') {
    return ev.channel === control.channel && ev.cc === control.number;
  }
  if (control.type === 'note' && ev.type === 'noteOn') {
    return ev.channel === control.channel && ev.note === control.number;
  }
  return false;
}

/** A human-readable label for a captured control (Config tab + popover). */
export function describeControlRef(ref: MidiControlRef): string {
  return ref.type === 'cc'
    ? `CC ${ref.number}${ref.channel ? ` ch${ref.channel + 1}` : ''}`
    : `Note ${ref.number}${ref.channel ? ` ch${ref.channel + 1}` : ''}`;
}

export type LearnCallback = (ref: MidiControlRef) => void;

/**
 * Shared "capture the next control" state for MIDI-learn. The manager owns one
 * and passes it to every controller runtime; arming makes the next learnable
 * control route HERE (and be swallowed — it binds, it does not also dispatch).
 * Disarms automatically on capture, or via cancel(). Pure (no timers / no
 * transport) so it is unit-testable.
 */
export class LearnController {
  private cb: LearnCallback | null = null;

  isArmed(): boolean {
    return this.cb !== null;
  }

  /** Arm capture. A second arm() replaces the pending callback (last writer
   *  wins) so re-opening the learn popover can't strand a stale listener. */
  arm(cb: LearnCallback): void {
    this.cb = cb;
  }

  cancel(): void {
    this.cb = null;
  }

  /** Called by a runtime on a learnable control while armed. Fires the callback
   *  once, disarms, and returns true (the control was consumed by learn).
   *  Returns false when not armed (the control dispatches normally). */
  capture(ref: MidiControlRef): boolean {
    const cb = this.cb;
    if (!cb) return false;
    this.cb = null;
    cb(ref);
    return true;
  }
}

// ── Soft-takeover ("pickup") ────────────────────────────────────────────────
//
// When a binding becomes active (focus changes, the active pattern changes, the
// app just connected) the physical fader is almost never sitting where the
// param's stored value is. Writing immediately would JUMP the param to wherever
// the fader happens to be. Pickup mode holds the param ("locked") until the
// fader crosses the current value, then unlocks and tracks normally — the
// standard DJ-mixer behaviour. The matching UI affordance is the track button
// flashing while a fader is locked (per Sina's LED spec).

export interface PickupState {
  locked: boolean;
  /** Last incoming value seen (engine units), for crossing detection. */
  last: number | null;
}

export function freshPickup(): PickupState {
  return { locked: true, last: null };
}

/**
 * Decide whether to WRITE this frame and return the next pickup state. Pure —
 * the caller persists `next`. Unlocks when the incoming value lands within
 * `eps` of the current value OR crosses it since the last reading.
 */
export function pickup(
  state: PickupState,
  current: number,
  incoming: number,
  eps = 0.02,
): { write: boolean; next: PickupState } {
  if (!state.locked) {
    return { write: true, next: { locked: false, last: incoming } };
  }
  const within = Math.abs(incoming - current) <= eps;
  let crossed = false;
  if (state.last !== null) {
    crossed = (state.last <= current && incoming >= current)
      || (state.last >= current && incoming <= current);
  }
  if (within || crossed) {
    return { write: true, next: { locked: false, last: incoming } };
  }
  return { write: false, next: { locked: true, last: incoming } };
}
