import { describe, expect, it } from 'vitest';
import {
  AUDIO_TAB_SUMMARY_SIGNAL_LIMIT,
  describePartySignal,
  nextPartySignalTruth,
  PARTY_SIGNAL_UNKNOWN,
  selectAudioTabSummarySignals,
  type PartySignalTruth,
} from './audioSignals';
import type { AudioSignalDescriptor } from '@/hooks/useEngineState';

function signal(key: string): AudioSignalDescriptor {
  return {
    key,
    postKey: key,
    rawKey: null,
    label: key,
    kind: 'intensity',
    max: 1,
  };
}

describe('Audio tab signal summary', () => {
  it('mounts only four familiar live signals by default', () => {
    const signals = [
      signal('audioGenre'),
      signal('audioHigh'),
      signal('audioKick'),
      signal('audioFlux'),
      signal('audioLow'),
      signal('audioMid'),
      signal('audioBuild'),
    ];

    expect(AUDIO_TAB_SUMMARY_SIGNAL_LIMIT).toBe(4);
    expect(selectAudioTabSummarySignals(signals).map((entry) => entry.key)).toEqual([
      'audioLow',
      'audioMid',
      'audioHigh',
      'audioKick',
    ]);
  });

  it('fills missing familiar slots from the live schema without inventing signals', () => {
    const signals = [
      signal('crowdRoar'),
      signal('audioHigh'),
      signal('audioBuild'),
    ];

    expect(selectAudioTabSummarySignals(signals).map((entry) => entry.key)).toEqual([
      'audioHigh',
      'crowdRoar',
      'audioBuild',
    ]);
  });

  it('rejects invalid limits instead of silently changing the render contract', () => {
    expect(() => selectAudioTabSummarySignals([], -1)).toThrow(/non-negative integer/);
  });
});

describe('describePartySignal', () => {
  it('shows unknown until a finite engine value arrives', () => {
    expect(describePartySignal(null)).toEqual({ label: 'PARTY SIGNAL …', tone: 'off' });
    expect(describePartySignal(undefined)).toEqual({ label: 'PARTY SIGNAL …', tone: 'off' });
    expect(describePartySignal(Number.NaN)).toEqual({ label: 'PARTY SIGNAL …', tone: 'off' });
  });

  it('uses the same 0.5 held-gate boundary as engine consumers', () => {
    expect(describePartySignal(0)).toEqual({ label: 'PARTY SIGNAL OFF', tone: 'off' });
    expect(describePartySignal(0.499)).toEqual({ label: 'PARTY SIGNAL OFF', tone: 'off' });
    expect(describePartySignal(0.5)).toEqual({ label: 'PARTY SIGNAL ON', tone: 'on' });
    expect(describePartySignal(1)).toEqual({ label: 'PARTY SIGNAL ON', tone: 'on' });
  });
});

// ── PARTY SIGNAL honesty across the live link ───────────────────────
//
// Drives the exact fold the AUDIO tab runs each render: observe the
// /ws/signals link + the live document in hand, then label it. `doc` values
// are opaque identities standing in for the parsed liveParams frames (a fresh
// object per WS message on the wire).
describe('party signal across connect / disconnect', () => {
  const docA = { frame: 'a' };
  const docB = { frame: 'b' };

  // What the operator actually reads on the pill for a given truth.
  const pill = (truth: PartySignalTruth): string => describePartySignal(truth.value).label;

  // Feed one observation and return the new truth.
  const observe = (
    prev: PartySignalTruth,
    connected: boolean,
    doc: object | null,
    value: number | null,
  ): PartySignalTruth => nextPartySignalTruth(prev, { connected, doc, value });

  it('startup — no link and no document yet reads unknown', () => {
    const truth = observe(PARTY_SIGNAL_UNKNOWN, false, null, null);
    expect(truth.value).toBeNull();
    expect(pill(truth)).toBe('PARTY SIGNAL …');
  });

  it('ON — a document that arrives on a live link is authoritative', () => {
    const truth = observe(PARTY_SIGNAL_UNKNOWN, true, docA, 1);
    expect(truth.value).toBe(1);
    expect(pill(truth)).toBe('PARTY SIGNAL ON');
  });

  it('OFF — a live zero is the detector declaring calm, not a gap', () => {
    const truth = observe(PARTY_SIGNAL_UNKNOWN, true, docA, 0);
    expect(truth.value).toBe(0);
    expect(pill(truth)).toBe('PARTY SIGNAL OFF');
  });

  it('disconnect after ON drops to unknown on the same frame, never a stale ON', () => {
    const on = observe(PARTY_SIGNAL_UNKNOWN, true, docA, 1);
    expect(pill(on)).toBe('PARTY SIGNAL ON');
    // The live cache still holds docA / value 1 — only the link went away.
    const dropped = observe(on, false, docA, 1);
    expect(dropped.value).toBeNull();
    expect(pill(dropped)).toBe('PARTY SIGNAL …');
    // Staying down keeps it unknown (and is a no-op — same object back).
    const stillDown = observe(dropped, false, docA, 1);
    expect(stillDown).toBe(dropped);
    expect(pill(stillDown)).toBe('PARTY SIGNAL …');
  });

  it('disconnect after OFF drops to unknown too — OFF is a claim, not a default', () => {
    const off = observe(PARTY_SIGNAL_UNKNOWN, true, docA, 0);
    expect(pill(off)).toBe('PARTY SIGNAL OFF');
    const dropped = observe(off, false, docA, 0);
    expect(dropped.value).toBeNull();
    expect(pill(dropped)).toBe('PARTY SIGNAL …');
  });

  it('reconnect resumes only when a fresh document arrives', () => {
    const on = observe(PARTY_SIGNAL_UNKNOWN, true, docA, 1);
    const dropped = observe(on, false, docA, 1);
    expect(pill(dropped)).toBe('PARTY SIGNAL …');
    // Socket back up, but React is still holding the pre-outage frame.
    const reconnected = observe(dropped, true, docA, 1);
    expect(reconnected.value).toBeNull();
    expect(pill(reconnected)).toBe('PARTY SIGNAL …');
    // The engine's frame lands: resume from THAT value, whatever it says.
    const fresh = observe(reconnected, true, docB, 0);
    expect(fresh.value).toBe(0);
    expect(pill(fresh)).toBe('PARTY SIGNAL OFF');
  });

  it('a live link with no audioParty in the document stays unknown', () => {
    const truth = observe(PARTY_SIGNAL_UNKNOWN, true, docA, null);
    expect(truth.value).toBeNull();
    expect(pill(truth)).toBe('PARTY SIGNAL …');
    // …and a non-finite reading is a gap, not a calm declaration.
    const garbage = observe(truth, true, docB, Number.NaN);
    expect(garbage.value).toBeNull();
    expect(pill(garbage)).toBe('PARTY SIGNAL …');
  });

  it('is idempotent and reference-stable while the stream repeats itself', () => {
    const on = observe(PARTY_SIGNAL_UNKNOWN, true, docA, 1);
    expect(observe(on, true, docA, 1)).toBe(on);
    // A new frame carrying the same verdict must not churn the truth object.
    expect(observe(on, true, docB, 1)).toBe(on);
  });
});
