// /timeline/state ownership contract (report _356 P0-4): `deckOwner` and
// `partyWindow`. These two fields are the pad's ONLY honest answers to "what
// owns the deck" and "is the Party Window open" — every pad-side derivation of
// either (a ribbon segment, `currentPhase`) disagrees with the engine's own
// evaluator across midnight, which is exactly the class of bug _356 closes.
//
// So the parsing rule is strict in one direction only: ABSENT is fine (an
// older engine has no answer and the readers degrade to the ribbon path), a
// PRESENT-but-wrong-shaped field is a loud throw. Never coerced, never
// defaulted, never silently dropped.
//
// timelineApi.ts pulls api.ts (RN `Platform` + engineEvents) and apiBase, so
// this node-env suite stubs them the way party_api.test.ts does.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));
vi.mock('./engineEvents', () => ({ engineEvents: { subscribe: () => () => undefined } }));
vi.mock('./apiBase', () => ({
  api_base: 'http://engine.test',
  getApiBase: () => 'http://engine.test',
  getApiBaseAsync: async () => 'http://engine.test',
  getDefaultApiBase: () => 'http://engine.test',
  setApiBase: () => undefined,
}));

import {
  fetchTimelineState,
  parseTimelineDeckOwner,
  parseTimelinePartyWindow,
  parseTimelineState,
} from './timelineApi';

const STATE = {
  mode: 'armed',
  scene: 'titanic',
  activePlan: 'test_week',
  controller: 'autopilot',
  autopilotEnabled: true,
  planActive: true,
  activeProgram: null,
  activeCue: null,
  pendingProgram: null,
  moodValue: 0,
  party: 0,
  engineConnected: true,
  nextCue: null,
  sun: {},
  phases: {},
  cues: [],
  recentFires: [],
  lastError: null,
};

const OWNER = { kind: 'cue', cueId: 'pwb', label: 'Party Window baseline', untilMs: 1_700_000_000_000 };
const WINDOW = { open: true, phaseId: 'pw_c_party', opensAtMs: 1_699_000_000_000, closesAtMs: null };

function stubFetch(body: unknown, ok = true, status = 200) {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok, status, json: async () => body } as Response)));
}

beforeEach(() => {
  stubFetch(STATE);
});

describe('parseTimelineDeckOwner', () => {
  it('accepts the full contract shape, nullable members included', () => {
    expect(parseTimelineDeckOwner(OWNER)).toEqual(OWNER);
    expect(parseTimelineDeckOwner({ kind: 'baseline', cueId: null, label: 'Plan baseline', untilMs: null }))
      .toEqual({ kind: 'baseline', cueId: null, label: 'Plan baseline', untilMs: null });
  });

  it('accepts all four owner kinds', () => {
    for (const kind of ['program', 'cue', 'defaultCue', 'baseline'] as const) {
      expect(parseTimelineDeckOwner({ ...OWNER, kind })?.kind).toBe(kind);
    }
  });

  it('passes an ABSENT field through as absent, and an explicit null as null', () => {
    expect(parseTimelineDeckOwner(undefined)).toBeUndefined();
    expect(parseTimelineDeckOwner(null)).toBeNull();
  });

  it('throws on an unknown kind instead of guessing one', () => {
    expect(() => parseTimelineDeckOwner({ ...OWNER, kind: 'party' }))
      .toThrow(/'deckOwner.kind' must be one of program\|cue\|defaultCue\|baseline/);
    expect(() => parseTimelineDeckOwner({ ...OWNER, kind: undefined })).toThrow(/deckOwner.kind/);
  });

  it('throws on wrong-typed members rather than coercing them', () => {
    expect(() => parseTimelineDeckOwner({ ...OWNER, label: 7 })).toThrow(/'deckOwner.label' must be a string/);
    expect(() => parseTimelineDeckOwner({ ...OWNER, cueId: 7 })).toThrow(/'deckOwner.cueId' must be a string or null/);
    expect(() => parseTimelineDeckOwner({ ...OWNER, untilMs: 'soon' }))
      .toThrow(/'deckOwner.untilMs' must be a finite number or null/);
    expect(() => parseTimelineDeckOwner({ ...OWNER, untilMs: NaN })).toThrow(/deckOwner.untilMs/);
    expect(() => parseTimelineDeckOwner('cue')).toThrow(/'deckOwner' must be an object or null/);
    expect(() => parseTimelineDeckOwner([OWNER])).toThrow(/'deckOwner' must be an object or null/);
  });
});

describe('parseTimelinePartyWindow', () => {
  it('accepts the full contract shape, nullable members included', () => {
    expect(parseTimelinePartyWindow(WINDOW)).toEqual(WINDOW);
    expect(parseTimelinePartyWindow({ open: false, phaseId: null, opensAtMs: null, closesAtMs: null }))
      .toEqual({ open: false, phaseId: null, opensAtMs: null, closesAtMs: null });
  });

  it('passes an ABSENT field through as absent, and an explicit null as null', () => {
    expect(parseTimelinePartyWindow(undefined)).toBeUndefined();
    expect(parseTimelinePartyWindow(null)).toBeNull();
  });

  it('throws when `open` is anything but a boolean — a truthy string is not "open"', () => {
    expect(() => parseTimelinePartyWindow({ ...WINDOW, open: 'yes' }))
      .toThrow(/'partyWindow.open' must be a boolean/);
    expect(() => parseTimelinePartyWindow({ ...WINDOW, open: 1 })).toThrow(/partyWindow.open/);
    expect(() => parseTimelinePartyWindow({ ...WINDOW, open: undefined })).toThrow(/partyWindow.open/);
  });

  it('throws on wrong-typed members rather than coercing them', () => {
    expect(() => parseTimelinePartyWindow({ ...WINDOW, phaseId: 3 }))
      .toThrow(/'partyWindow.phaseId' must be a string or null/);
    expect(() => parseTimelinePartyWindow({ ...WINDOW, opensAtMs: '21:00' }))
      .toThrow(/'partyWindow.opensAtMs' must be a finite number or null/);
    expect(() => parseTimelinePartyWindow({ ...WINDOW, closesAtMs: Infinity }))
      .toThrow(/partyWindow.closesAtMs/);
  });
});

describe('parseTimelineState', () => {
  it('keeps both fields when the engine sends them', () => {
    const parsed = parseTimelineState({ ...STATE, deckOwner: OWNER, partyWindow: WINDOW });
    expect(parsed.deckOwner).toEqual(OWNER);
    expect(parsed.partyWindow).toEqual(WINDOW);
  });

  it('leaves them ABSENT on a pre-_356 engine (never synthesised)', () => {
    const parsed = parseTimelineState(STATE);
    expect('deckOwner' in parsed).toBe(false);
    expect('partyWindow' in parsed).toBe(false);
  });

  it('does not disturb the rest of the state document', () => {
    expect(parseTimelineState(STATE)).toEqual(STATE);
  });

  it('throws on a malformed addition and on a non-object body', () => {
    expect(() => parseTimelineState({ ...STATE, deckOwner: { kind: 'cue' } })).toThrow(/deckOwner.label/);
    expect(() => parseTimelineState({ ...STATE, partyWindow: { open: 'yes' } })).toThrow(/partyWindow.open/);
    expect(() => parseTimelineState(null)).toThrow(/expected an object/);
  });
});

describe('fetchTimelineState — the contract check runs on the wire', () => {
  it('returns the parsed state on a good payload', async () => {
    stubFetch({ ...STATE, deckOwner: OWNER, partyWindow: WINDOW });
    const r = await fetchTimelineState();
    expect(r.ok).toBe(true);
    expect(r.data?.deckOwner).toEqual(OWNER);
    expect(r.data?.partyWindow?.open).toBe(true);
  });

  it('fails LOUDLY on a malformed ownership field instead of rendering a guess', async () => {
    stubFetch({ ...STATE, deckOwner: { kind: 'party', cueId: null, label: 'x', untilMs: null } });
    const r = await fetchTimelineState();
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/deckOwner.kind/);
    expect(r.data).toBeUndefined();
  });

  it('still surfaces an engine error body verbatim', async () => {
    stubFetch({ error: 'no scene loaded' }, false, 503);
    const r = await fetchTimelineState();
    expect(r.ok).toBe(false);
    expect(r.error).toBe('no scene loaded');
    expect(r.status).toBe(503);
  });
});
