/*
 * Reliable transport for one-hop audio events.
 *
 * Analyzer-side event producers intentionally emit a one-hop 0/1 pulse. That
 * representation is useful inside the DSP graph, but it is not safe to place
 * behind the Companion's rate throttle: an event that lands between scheduled
 * OSC frames disappears. This adapter gives each event two wire forms:
 *
 *   - the existing key becomes a short decaying envelope for visual modulation;
 *   - a monotonic integer sequence is force-sent on every rising edge for
 *     automation consumers that must observe every event exactly once.
 */

export const EVENT_SEQUENCE_MAX = 2_147_483_647;
export const EVENT_ENVELOPE_MS = 150;

export const AUDIO_EVENT_SPECS = Object.freeze([
  Object.freeze({ key: 'audioDownbeat', sequenceKey: 'audioDownbeatSeq' }),
  Object.freeze({ key: 'audioPhraseBoundary', sequenceKey: 'audioPhraseBoundarySeq' }),
  Object.freeze({ key: 'audioTrackChange', sequenceKey: 'audioTrackChangeSeq' }),
  Object.freeze({ key: 'audioSwitchPattern', sequenceKey: 'audioSwitchPatternSeq' }),
  Object.freeze({ key: 'audioSwitchColor', sequenceKey: 'audioSwitchColorSeq' }),
]);

export class AudioEventTransport {
  constructor({ envelopeMs = EVENT_ENVELOPE_MS } = {}) {
    if (!Number.isFinite(envelopeMs) || envelopeMs <= 0) {
      throw new Error('AudioEventTransport envelopeMs must be finite and > 0');
    }
    this.envelopeMs = envelopeMs;
    this._state = new Map(AUDIO_EVENT_SPECS.map((spec) => [
      spec.key,
      { high: false, remainingMs: 0, sequence: 0 },
    ]));
  }

  tick(values, dtMs) {
    if (!values || typeof values !== 'object') {
      throw new Error('AudioEventTransport values must be an object');
    }
    if (!Number.isFinite(dtMs) || dtMs < 0) {
      throw new Error('AudioEventTransport dtMs must be finite and >= 0');
    }

    return AUDIO_EVENT_SPECS.map((spec) => {
      const raw = values[spec.key];
      if (!Number.isFinite(raw)) {
        throw new Error(`AudioEventTransport missing finite value for ${spec.key}`);
      }
      const state = this._state.get(spec.key);
      const high = raw > 0;
      const rising = high && !state.high;
      if (rising) {
        state.sequence = state.sequence >= EVENT_SEQUENCE_MAX ? 1 : state.sequence + 1;
        state.remainingMs = this.envelopeMs;
      } else {
        state.remainingMs = Math.max(0, state.remainingMs - dtMs);
      }
      state.high = high;
      return {
        ...spec,
        rising,
        sequence: state.sequence,
        envelope: state.remainingMs / this.envelopeMs,
      };
    });
  }
}
