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

/** WHY a learn capture was rejected — DATA, not a pre-baked sentence, so every
 *  surface (capture toast, popover inline error) formats it once through
 *  `learnRejectMessage` and the copy composes grammatically everywhere.
 *  Forward-compat hook: when the planned custom-mapping UI opens MFT banks 2-4
 *  to operator assignments, only the `reserved-bank` branch (manager guard +
 *  message) changes — the reason vocabulary already distinguishes it. */
export type LearnRejectReason =
  // The control resolves to a STATIC profile action (master, pads, …) —
  // capturing it would permanently shadow that action. `controlId` names it.
  | { kind: 'profile-claimed'; controlId: string }
  // An MFT bank-1 endless encoder / push: knobs map to the focused pattern's
  // params BY ORDER (and their CC "value" is a relative delta code — absolute
  // scaling would pin the param to ~0.5 jitter), so they are never learnable.
  | { kind: 'order-mapped-encoder' }
  // An MFT bank-2/3/4 encoder: reserved for the future custom-mapping UI.
  | { kind: 'reserved-bank' }
  // The focused pattern already has an ENABLED learned binding on this control
  // — a second binding would silently fight it (P2-2).
  | { kind: 'already-bound'; parameter: string };

/** The fader set free for MIDI-learn on the APC (7 joined when its global-speed
 *  reservation moved to the MFT). ONE home for the hint copy. */
const LEARN_HINT = ' Use a MIDI-learn fader (4–8) or a free pad.';

/** Well-known reserved profile controls → friendly copy. Everything else names
 *  the control id verbatim. */
const KNOWN_CLAIMED: Record<string, string> = {
  fader_9_master: 'That fader is MASTER.',
};

/** Format a LearnRejectReason into ONE clean operator-facing sentence. The
 *  single copy home for both the capture toast and the popover inline error. */
export function learnRejectMessage(reason: LearnRejectReason): string {
  switch (reason.kind) {
    case 'profile-claimed': {
      const named = KNOWN_CLAIMED[reason.controlId]
        ?? `That control is already mapped ('${reason.controlId}').`;
      return `${named}${LEARN_HINT}`;
    }
    case 'order-mapped-encoder':
      return `MFT knobs aren't learnable — they map to the focused pattern's params by order.${LEARN_HINT}`;
    case 'reserved-bank':
      return `That MFT bank is reserved for future custom mappings.${LEARN_HINT}`;
    case 'already-bound':
      return `That control is already learned to '${reason.parameter}' — free it first or pick another control.`;
    default: {
      // Exhaustiveness guard — a new reason kind must add a message.
      const k = (reason as { kind: string }).kind;
      throw new Error(`learnRejectMessage: unhandled reject reason '${k}'`);
    }
  }
}

/** The outcome delivered to a learn callback: a captured control, or a
 *  structured rejection (see LearnRejectReason). Learning is REJECTED on
 *  conflict so a profile action / order-mapped encoder / existing binding can
 *  never be shadowed. */
export type LearnResult = { ref: MidiControlRef } | { conflict: LearnRejectReason };

export type LearnCallback = (result: LearnResult) => void;

/**
 * Shared "capture the next control" state for MIDI-learn. The manager owns one
 * and passes it to every controller runtime; arming makes the next learnable
 * control route HERE (and be swallowed — it binds, it does not also dispatch).
 * Disarms automatically on capture / conflict, or via cancel(). Pure (no
 * timers / no transport) so it is unit-testable.
 */
export class LearnController {
  private cb: LearnCallback | null = null;
  /** Monotonic arm token. cancel(token) only disarms if the CURRENT arm still
   *  owns the token — so a stale popover's cancel can't kill a newer arm. */
  private token = 0;

  isArmed(): boolean {
    return this.cb !== null;
  }

  /** Arm capture. A second arm() replaces the pending callback (last writer
   *  wins) so re-opening the learn popover can't strand a stale listener.
   *  Returns the arm's token — pass it to cancel() to scope the cancel to
   *  THIS arm (a later arm bumps the token, so a stale cancel is a no-op). */
  arm(cb: LearnCallback): number {
    this.cb = cb;
    this.token += 1;
    return this.token;
  }

  /** Disarm. With a token, only cancels when it matches the current arm (a
   *  stale closure can't cancel a newer arm). Without a token, cancels
   *  unconditionally (the manager-level "cancel everything"). */
  cancel(token?: number): void {
    if (token !== undefined && token !== this.token) return;
    this.cb = null;
  }

  /** Called by a runtime on a learnable control while armed. Fires the callback
   *  once with the captured ref, disarms, and returns true (the control was
   *  consumed by learn). Returns false when not armed (the control dispatches
   *  normally). */
  capture(ref: MidiControlRef): boolean {
    const cb = this.cb;
    if (!cb) return false;
    this.cb = null;
    cb({ ref });
    return true;
  }

  /** Called by a runtime while armed to REJECT the capture — the moved control
   *  is profile-claimed, an order-mapped MFT encoder, a reserved-bank encoder,
   *  or already bound (see LearnRejectReason). Fires the callback once with the
   *  STRUCTURED reason (surfaces format it via learnRejectMessage), disarms,
   *  and returns true (consumed). Returns false when not armed. */
  reject(reason: LearnRejectReason): boolean {
    const cb = this.cb;
    if (!cb) return false;
    this.cb = null;
    cb({ conflict: reason });
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
