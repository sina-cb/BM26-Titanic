/**
 * audio_reactive_profile.js — PLACEHOLDER (filled in E2).
 *
 * E1 registers the profile name so the seam, registry, and REST/WS surface are
 * complete and testable. The real event-driven behaviour (advance on
 * `audioSwitchPattern`, palette on `audioSwitchColor`, bpmSpeedSync speed,
 * silence/maxDwell gates) lands in E2 per
 * `.agent/projects/autopilot_profiles_audio_reactive.md`.
 *
 * Until then this instance behaves like a timer-driven profile that reuses the
 * shared picker, so selecting it never breaks the deck — but it is intentionally
 * NOT yet reactive. (This file is replaced wholesale in E2.)
 */

import { pickNextAutoCycleEntry } from '../autopilot_pick.js';

export class AudioReactiveProfile {
  constructor() {
    this.name = 'audio_reactive';
  }

  nextDelayMs(state) {
    const delayS = parseInt(state && state.delay_s, 10) || 30;
    return delayS * 1000;
  }

  pickNextEntry(pl, autopilot, curEntryId, groupRuntime) {
    return pickNextAutoCycleEntry(pl, autopilot, curEntryId, groupRuntime);
  }

  validateState(_wire) {}

  attach(_ctx) {}

  detach() {}
}

export default AudioReactiveProfile;
