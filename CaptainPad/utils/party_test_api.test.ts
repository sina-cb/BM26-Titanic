import { describe, expect, it, vi } from 'vitest';

vi.mock('./apiBase', () => ({ getApiBaseAsync: vi.fn() }));

import { parsePartyDetectorState, partyTestWsUrlFromApiBase } from './party_test_api';

describe('partyTestWsUrlFromApiBase', () => {
  it('targets the same allowed host on the fixed Companion websocket', () => {
    expect(partyTestWsUrlFromApiBase('http://127.0.0.1:6968'))
      .toBe('ws://127.0.0.1:6966/ws');
  });

  it('keeps secure transports secure', () => {
    expect(partyTestWsUrlFromApiBase('https://localhost:6968'))
      .toBe('wss://localhost:6966/ws');
  });

  it('refuses public or ambiguous destinations', () => {
    expect(() => partyTestWsUrlFromApiBase('https://example.com:6968'))
      .toThrow(/private-LAN engine address/);
  });
});

describe('parsePartyDetectorState', () => {
  it('keeps both qualification stages and debounce clocks intact', () => {
    const parsed = parsePartyDetectorState({
      party: false,
      publishedParty: false,
      qualify: true,
      levelOk: true,
      beatOk: true,
      shapeOk: true,
      quietOk: true,
      loudness: 0.83,
      kickRate: 3.43,
      kickReg: 0.68,
      lowShare: 0.4,
      highShare: 0.25,
      silence: 0,
      qualifyingForMs: 12300,
      disqualifyingForMs: 0,
      overrideMode: 'auto',
      params: {
        ambientFloor: 0.09,
        marginX: 2.5,
        kickRateMin: 1.2,
        kickRateMax: 3.8,
        kickRegMin: 0.45,
        shapeLowMin: 0.2,
        shapeHighMin: 0.12,
        silenceMax: 0.5,
        onSustainMs: 20000,
        offConfirmMs: 30000,
      },
    });
    expect(parsed.qualify).toBe(true);
    expect(parsed.qualifyingForMs).toBe(12300);
    expect(parsed.params.offConfirmMs).toBe(30000);
  });

  it('fails loudly when a gate is missing', () => {
    expect(() => parsePartyDetectorState({ party: false })).toThrow(/params/);
  });
});
