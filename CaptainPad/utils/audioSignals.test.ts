import { describe, expect, it } from 'vitest';
import { describePartySignal } from './audioSignals';

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
