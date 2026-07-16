/**
 * random_profile.js — the DEFAULT autopilot profile.
 *
 * This is today's deck autopilot behaviour, unchanged: a fixed `delay_s` timer
 * advances the deck to the next entry picked by `pickNextAutoCycleEntry`
 * (group-locality → shuffle → sequential). Wrapping the existing pure picker
 * BYTE-IDENTICALLY is the whole point — the `random` profile must be
 * indistinguishable from the pre-profile engine so an operator who never
 * touches the dropdown sees zero behaviour change.
 *
 * The profile is a thin adapter: it holds no state of its own (group-dwell
 * state still lives on the deck channel's transient `_autoGroup`, owned by the
 * selection callback in api_server.js). `attach`/`detach` are no-ops because
 * `random` subscribes to nothing and sets no CPC globals.
 */

import { pickNextAutoCycleEntry } from '../autopilot_pick.js';

export class RandomProfile {
  constructor() {
    this.name = 'random';
  }

  // Timer-driven: arm the existing self-rescheduling setTimeout at delay_s.
  // Returns a number of ms (never null) so the host stays on its timer path —
  // exactly the pre-profile behaviour (`delay_s * 1000`, floored to 30 when the
  // stored value doesn't parse, matching the legacy `parseInt(...) || 30`).
  nextDelayMs(state) {
    const delayS = parseInt(state && state.delay_s, 10) || 30;
    return delayS * 1000;
  }

  // Selection is the SHARED pure picker — the SAME function the mixer/overlay
  // auto-cycles use, so the deck and overlays can never drift. Byte-identical to
  // the pre-profile selection callback.
  pickNextEntry(pl, autopilot, curEntryId, groupRuntime) {
    return pickNextAutoCycleEntry(pl, autopilot, curEntryId, groupRuntime);
  }

  // `random` carries no profile-specific wire fields, so nothing to validate.
  validateState(_wire) {}

  // No subscriptions, no CPC globals — attach/detach are intentionally empty.
  attach(_ctx) {}

  detach() {}
}

export default RandomProfile;
