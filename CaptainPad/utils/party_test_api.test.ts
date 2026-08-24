import { describe, expect, it, vi } from 'vitest';

vi.mock('./apiBase', () => ({ getApiBaseAsync: vi.fn() }));

import {
  parsePartyDetectorState,
  partySignalHeadline,
  partySignalSourceControl,
  partyTestWsUrlFromApiBase,
  type PartyDetectorState,
} from './party_test_api';

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

// ── SIGNAL SOURCE (companion-owned; the pad only exposes it) ────────────────

const DETECTOR_WIRE = {
  party: false,
  publishedParty: false,
  qualify: false,
  levelOk: false,
  beatOk: false,
  shapeOk: false,
  quietOk: false,
  loudness: 0.1,
  kickRate: 0,
  kickReg: 0,
  lowShare: 0,
  highShare: 0,
  silence: 0,
  qualifyingForMs: 0,
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
};

describe('parsePartyDetectorState signal source', () => {
  it('keeps the source and both verdicts when the companion reports them', () => {
    const parsed = parsePartyDetectorState({
      ...DETECTOR_WIRE,
      source: 'simple',
      qualifiedParty: false,
      simpleParty: true,
    });
    expect(parsed.source).toBe('simple');
    expect(parsed.qualifiedParty).toBe(false);
    expect(parsed.simpleParty).toBe(true);
  });

  it('reports an absent source as null instead of defaulting it', () => {
    const parsed = parsePartyDetectorState(DETECTOR_WIRE);
    expect(parsed.source).toBeNull();
    expect(parsed.qualifiedParty).toBeNull();
    expect(parsed.simpleParty).toBeNull();
  });

  it('fails loudly on an unknown source or a non-boolean verdict', () => {
    expect(() => parsePartyDetectorState({ ...DETECTOR_WIRE, source: 'sophisticated' }))
      .toThrow(/source must be one of qualified\/simple/);
    expect(() => parsePartyDetectorState({ ...DETECTOR_WIRE, simpleParty: 1 }))
      .toThrow(/simpleParty' must be a boolean when present/);
  });
});

function detectorWith(patch: Partial<PartyDetectorState>): PartyDetectorState {
  return { ...parsePartyDetectorState(DETECTOR_WIRE), ...patch };
}

describe('partySignalSourceControl', () => {
  const live = { connected: true, locked: false, pending: false };

  it('hides itself entirely until the companion telemetry arrives', () => {
    const control = partySignalSourceControl({ detector: null, ...live });
    expect(control.visible).toBe(false);
    expect(control.hiddenNote).toBeNull();
    expect(control.source).toBeNull();
  });

  it('hides itself — with a reason — when the companion reports no source', () => {
    const control = partySignalSourceControl({ detector: detectorWith({ source: null }), ...live });
    expect(control.visible).toBe(false);
    expect(control.hiddenNote).toMatch(/DOES NOT REPORT A SIGNAL SOURCE/);
    expect(control.source).toBeNull();
  });

  it('shows the companion selection and both options', () => {
    const control = partySignalSourceControl({ detector: detectorWith({ source: 'qualified' }), ...live });
    expect(control.visible).toBe(true);
    expect(control.source).toBe('qualified');
    expect(control.options.map((o) => o.id)).toEqual(['qualified', 'simple']);
    expect(control.disabled).toBe(false);
    expect(control.note).toMatch(/four gates below are what drives the signal/);
  });

  it('says the gates are NOT driving while SIMPLE is selected', () => {
    const control = partySignalSourceControl({ detector: detectorWith({ source: 'simple' }), ...live });
    expect(control.note).toMatch(/NOT driving/);
  });

  it('disables the write while offline, locked, or pending', () => {
    const detector = detectorWith({ source: 'qualified' });
    expect(partySignalSourceControl({ detector, ...live, connected: false }).disabled).toBe(true);
    expect(partySignalSourceControl({ detector, ...live, locked: true }).disabled).toBe(true);
    expect(partySignalSourceControl({ detector, ...live, pending: true }).disabled).toBe(true);
    // …and still SHOWS the current selection: a locked control must not lie.
    expect(partySignalSourceControl({ detector, ...live, locked: true }).source).toBe('qualified');
  });
});

describe('partySignalHeadline', () => {
  it('names the source that is driving the published signal', () => {
    expect(partySignalHeadline(detectorWith({ source: 'simple', publishedParty: true })))
      .toBe('SIGNAL ON · VIA SIMPLE');
    expect(partySignalHeadline(detectorWith({ source: 'qualified', publishedParty: false })))
      .toBe('SIGNAL OFF · VIA QUALIFIED');
    expect(partySignalHeadline(detectorWith({ source: 'qualified', publishedParty: null })))
      .toBe('SIGNAL … · VIA QUALIFIED');
  });

  it('claims no source when the companion does not report one', () => {
    expect(partySignalHeadline(detectorWith({ source: null, publishedParty: true }))).toBe('SIGNAL ON');
  });
});
