// PARTY MODE contract from the CaptainPad side: GET/PUT /party-config wire
// shape, loud 400 surfacing (no silent revert), and the pure status
// derivation + steppers/formatters the TIMELINE tab's PARTY MODE card renders.
//
// party_api.ts pulls api.ts (which imports RN `Platform` + engineEvents) and
// apiBase, so this node-env suite stubs all three plus global fetch, mirroring
// effect_banks_api.test.ts.

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
  fetchPartyConfig,
  setPartyConfig,
  parsePartyConfig,
  describePartyStatus,
  describePartyRows,
  describeEffectiveNote,
  coalescePartyPatches,
  mergePartyPatch,
  stepPartyField,
  formatMinSec,
  formatMinutes,
  PARTY_FIELD_BOUNDS,
} from './party_api';

const CONFIG = {
  enabled: true,
  playlist: 'party_bangers',
  availablePlaylists: ['party_bangers', 'chill'],
  minDwellSec: 120,
  durationEnabled: true,
  durationMin: 12,
  cooldownEnabled: true,
  cooldownSec: 120,
};

let lastUrl: string | undefined;
let lastInit: RequestInit | undefined;

function stubFetch(body: unknown, ok = true, status = 200) {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    lastUrl = url;
    lastInit = init;
    return { ok, status, json: async () => body } as Response;
  }));
}

beforeEach(() => {
  lastUrl = undefined;
  lastInit = undefined;
  stubFetch(CONFIG);
});

describe('fetchPartyConfig — GET /party-config', () => {
  it('hits the engine base and returns the parsed config', async () => {
    const r = await fetchPartyConfig();
    expect(lastUrl).toBe('http://engine.test/party-config');
    expect(r.ok).toBe(true);
    expect(r.data).toEqual(CONFIG);
  });

  it('surfaces the engine error body on a non-2xx', async () => {
    stubFetch({ error: 'party mode not configured for this scene' }, false, 500);
    const r = await fetchPartyConfig();
    expect(r.ok).toBe(false);
    expect(r.error).toBe('party mode not configured for this scene');
    expect(r.status).toBe(500);
  });

  it('reports a transport failure instead of inventing a config', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Network request failed'); }));
    const r = await fetchPartyConfig();
    expect(r.ok).toBe(false);
    expect(r.error).toBe('Network request failed');
    expect(r.data).toBeUndefined();
  });
});

describe('setPartyConfig — PUT /party-config', () => {
  it('PUTs only the supplied keys and returns the full new state', async () => {
    stubFetch({ ...CONFIG, enabled: false });
    const r = await setPartyConfig({ enabled: false });
    expect(lastUrl).toBe('http://engine.test/party-config');
    expect(lastInit?.method).toBe('PUT');
    expect(JSON.parse(String(lastInit?.body))).toEqual({ enabled: false });
    expect(r.ok).toBe(true);
    expect(r.data?.enabled).toBe(false);
  });

  it('sends a playlist-only patch', async () => {
    stubFetch({ ...CONFIG, playlist: 'chill' });
    const r = await setPartyConfig({ playlist: 'chill' });
    expect(JSON.parse(String(lastInit?.body))).toEqual({ playlist: 'chill' });
    expect(r.data?.playlist).toBe('chill');
  });

  it('surfaces a 400 message verbatim (no silent revert)', async () => {
    stubFetch({ error: "unknown playlist 'nope'" }, false, 400);
    const r = await setPartyConfig({ playlist: 'nope' });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(400);
    expect(r.error).toBe("unknown playlist 'nope'");
    expect(r.data).toBeUndefined();
  });
});

describe('parsePartyConfig — fail loudly on a malformed payload', () => {
  const base = { ...CONFIG };
  it('rejects a missing/!boolean enabled', () => {
    expect(() => parsePartyConfig({ ...base, enabled: undefined })).toThrow(/'enabled' must be a boolean/);
  });
  it('rejects a non-string playlist', () => {
    expect(() => parsePartyConfig({ ...base, playlist: 3 })).toThrow(/'playlist' must be a string/);
  });
  it('rejects a non string[] availablePlaylists', () => {
    expect(() => parsePartyConfig({ ...base, availablePlaylists: [1] })).toThrow(/must be a string\[\]/);
  });
  it('rejects a non-object body', () => {
    expect(() => parsePartyConfig(null)).toThrow(/expected an object/);
  });
  it('rejects missing / non-boolean mode flags (contract fields missing = loud)', () => {
    expect(() => parsePartyConfig({ ...base, durationEnabled: undefined })).toThrow(/'durationEnabled' must be a boolean/);
    expect(() => parsePartyConfig({ ...base, cooldownEnabled: 'yes' })).toThrow(/'cooldownEnabled' must be a boolean/);
  });
  it('rejects missing / non-finite session numbers', () => {
    expect(() => parsePartyConfig({ ...base, minDwellSec: undefined })).toThrow(/'minDwellSec' must be a finite number/);
    expect(() => parsePartyConfig({ ...base, durationMin: '12' })).toThrow(/'durationMin' must be a finite number/);
    expect(() => parsePartyConfig({ ...base, cooldownSec: NaN })).toThrow(/'cooldownSec' must be a finite number/);
  });
  it('accepts an omitted effectiveState but rejects an unknown one', () => {
    expect(parsePartyConfig(base).effectiveState).toBeUndefined();
    expect(parsePartyConfig({ ...base, effectiveState: 'cooldown' }).effectiveState).toBe('cooldown');
    expect(() => parsePartyConfig({ ...base, effectiveState: 'partying' })).toThrow(/'effectiveState' must be one of/);
  });

  // The TIMELINE tab's PARTY MODE card feeds the engine's `partyConfig` WS
  // BROADCAST straight into this parser (report 20260725_22, defect D6). The
  // broadcast payload is `{ type:'partyConfig', ...getPartyStatus(),
  // availablePlaylists }` — the same body as GET plus WS/status extras, so it
  // must parse cleanly and the extras must be ignored, not tripped over.
  it('parses the partyConfig WS BROADCAST payload (extra keys ignored)', () => {
    const broadcast = {
      type: 'partyConfig',
      ...CONFIG,
      effectiveState: 'in_session',
      planActive: true,
      inFestivalWindow: true,
      controller: 'autopilot',
      mode: 'armed',
      partyCueId: 'c_mood_to_party',
      sessionFollowsMusic: false,
      sessionEndsAtMs: 1_800_000_000_000,
      cooldownRemainingSec: 0,
    };
    const cfg = parsePartyConfig(broadcast);
    expect(cfg.effectiveState).toBe('in_session');
    expect(cfg.enabled).toBe(CONFIG.enabled);
    expect(cfg.playlist).toBe(CONFIG.playlist);
    expect(cfg.cooldownRemainingSec).toBe(0);
    expect((cfg as unknown as Record<string, unknown>).type).toBeUndefined();
  });

  it('a malformed broadcast is a LOUD error, never a half-populated card', () => {
    expect(() => parsePartyConfig({ type: 'partyConfig', ...CONFIG, enabled: 'yes' }))
      .toThrow(/'enabled' must be a boolean/);
  });
});

describe('stepPartyField — clamped, snapped steppers', () => {
  it('steps each field by its own increment', () => {
    expect(stepPartyField('minDwellSec', 120, 1)).toBe(135);
    expect(stepPartyField('durationMin', 12, -1)).toBe(11);
    expect(stepPartyField('cooldownSec', 900, 1)).toBe(960);
  });
  it('clamps to the field bounds instead of going negative / unbounded', () => {
    expect(stepPartyField('minDwellSec', 0, -1)).toBe(PARTY_FIELD_BOUNDS.minDwellSec.min);
    expect(stepPartyField('durationMin', 1, -1)).toBe(PARTY_FIELD_BOUNDS.durationMin.min);
    expect(stepPartyField('durationMin', PARTY_FIELD_BOUNDS.durationMin.max, 1)).toBe(PARTY_FIELD_BOUNDS.durationMin.max);
    expect(stepPartyField('cooldownSec', PARTY_FIELD_BOUNDS.cooldownSec.max, 1)).toBe(PARTY_FIELD_BOUNDS.cooldownSec.max);
  });
  it('snaps an off-grid value onto the step grid', () => {
    // 130 s + 15 s = 145 → snapped to the nearest 15 s multiple (150).
    expect(stepPartyField('minDwellSec', 130, 1)).toBe(150);
    expect(stepPartyField('minDwellSec', 130, -1)).toBe(120);
  });
});

describe('formatters', () => {
  it('formatMinSec renders m:ss', () => {
    expect(formatMinSec(0)).toBe('0:00');
    expect(formatMinSec(120)).toBe('2:00');
    expect(formatMinSec(135)).toBe('2:15');
    expect(formatMinSec(-5)).toBe('0:00');
  });
  it('formatMinutes renders whole and half minutes', () => {
    expect(formatMinutes(900)).toBe('15 min');
    expect(formatMinutes(0)).toBe('0 min');
    expect(formatMinutes(90)).toBe('1.5 min');
  });
});

describe('describePartyStatus', () => {
  it('reports CHECKING before the server state is known', () => {
    expect(describePartyStatus({ enabled: null }).label).toBe('CHECKING…');
  });

  it('reports ENGINE OFFLINE ahead of everything else', () => {
    const s = describePartyStatus({ enabled: true, party: 1, engineOffline: true });
    expect(s.label).toBe('ENGINE OFFLINE');
    expect(s.tone).toBe('unknown');
  });

  it("prefers the engine's effectiveState over the derived state", () => {
    // Locally this would derive IN SESSION; the engine says cooldown, engine wins.
    const s = describePartyStatus({ enabled: true, party: 1, effectiveState: 'cooldown' });
    expect(s.label).toBe('COOLDOWN');
    expect(describePartyStatus({ enabled: true, effectiveState: 'no_plan' }).label).toBe('NO PLAN');
    expect(describePartyStatus({ enabled: true, effectiveState: 'disabled' }).label).toBe('DISABLED');
    expect(describePartyStatus({ enabled: false, effectiveState: 'armed' }).label).toBe('ARMED');
  });

  it('DISABLED wins over an in-flight session (disable kills the session)', () => {
    const s = describePartyStatus({ enabled: false, party: 1, currentMood: 'party' });
    expect(s.label).toBe('DISABLED');
    expect(s.tone).toBe('off');
  });

  it('reports IN SESSION for a numeric or boolean party flag, naming the mood', () => {
    expect(describePartyStatus({ enabled: true, party: 1, currentMood: 'party' }).label).toBe('IN SESSION');
    expect(describePartyStatus({ enabled: true, party: true }).tone).toBe('live');
    expect(describePartyStatus({ enabled: true, party: 1, currentMood: 'party' }).detail).toMatch(/mood party/);
  });

  it('reports COOLDOWN with the remaining time as m:ss', () => {
    const s = describePartyStatus({ enabled: true, party: 0, cooldownRemainingSec: 135 });
    expect(s.label).toBe('COOLDOWN');
    expect(s.detail).toMatch(/2:15/);
  });

  it('reports NO PLAN when enabled but no timeline plan is running', () => {
    const s = describePartyStatus({ enabled: true, party: 0, planActive: false });
    expect(s.label).toBe('NO PLAN');
    expect(s.tone).toBe('noplan');
  });

  it('reports ARMED when enabled, plan running, idle and out of cooldown', () => {
    const s = describePartyStatus({ enabled: true, party: 0, planActive: true, cooldownRemainingSec: 0 });
    expect(s.label).toBe('ARMED');
    expect(s.tone).toBe('armed');
  });
});


describe('describePartyRows — session-length ⇄ cooldown rule', () => {
  it('fixed-length mode: duration on, cooldown live', () => {
    const r = describePartyRows({ durationEnabled: true, cooldownEnabled: true });
    expect(r).toEqual({
      durationEnabled: true,
      releaseMode: false,
      cooldownEnabled: true,
      cooldownToggleDisabled: false,
      cooldownHint: null,
    });
  });

  it('fixed-length mode with cooldown off: toggle stays operator-changeable', () => {
    const r = describePartyRows({ durationEnabled: true, cooldownEnabled: false });
    expect(r.cooldownEnabled).toBe(false);
    expect(r.cooldownToggleDisabled).toBe(false);
    expect(r.cooldownHint).toBeNull();
  });

  it('follow-the-music mode FORCES cooldown off, greys the toggle, and says why', () => {
    // Even when the engine still reports cooldownEnabled true, duration off wins.
    const r = describePartyRows({ durationEnabled: false, cooldownEnabled: true });
    expect(r.releaseMode).toBe(true);
    expect(r.cooldownEnabled).toBe(false);
    expect(r.cooldownToggleDisabled).toBe(true);
    expect(r.cooldownHint).toMatch(/follow-the-music/i);
  });
});

describe('edit coalescing — playa-proof against flapping fingers', () => {
  it('collapses a mashed toggle into the FINAL intent (one PUT body)', () => {
    const merged = coalescePartyPatches([
      { enabled: true }, { enabled: false }, { enabled: true }, { enabled: false },
    ]);
    expect(merged).toEqual({ enabled: false });
  });

  it('keeps distinct fields while collapsing repeats of the same one', () => {
    const merged = coalescePartyPatches([
      { durationMin: 12 }, { cooldownEnabled: false }, { durationMin: 13 }, { durationMin: 14 },
    ]);
    expect(merged).toEqual({ durationMin: 14, cooldownEnabled: false });
  });

  it('an empty queue coalesces to an empty body (nothing is sent)', () => {
    expect(coalescePartyPatches([])).toEqual({});
  });

  it('mergePartyPatch shows server truth with the pending edit on top', () => {
    const view = mergePartyPatch(CONFIG, { durationEnabled: false, cooldownEnabled: true });
    expect(view.durationEnabled).toBe(false);
    expect(view.playlist).toBe(CONFIG.playlist);
    // …and the row rule still forces cooldown off in the merged view.
    expect(describePartyRows(view).cooldownEnabled).toBe(false);
  });
});

describe('engine unreachable mid-edit', () => {
  it('a PUT transport failure returns the error and NO data (caller keeps its edits)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Network request failed'); }));
    const r = await setPartyConfig({ durationMin: 20 });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('Network request failed');
    expect(r.data).toBeUndefined();
    expect(r.status).toBeUndefined();
  });

  it('a retry after the engine returns succeeds with the same body', async () => {
    stubFetch({ ...CONFIG, durationMin: 20 });
    const r = await setPartyConfig({ durationMin: 20 });
    expect(JSON.parse(String(lastInit?.body))).toEqual({ durationMin: 20 });
    expect(r.ok).toBe(true);
    expect(r.data?.durationMin).toBe(20);
  });
});


// ── Landed contract additions (engine live on titanic-ext, 2026-07-27) ────
// Six-value effectiveState, engine-effective values, and the live session /
// cooldown readouts. All optional on the wire: a pre-addition engine omits
// them and the derivation falls back to the timeline-state fields.

describe('parsePartyConfig — live-view additions', () => {
  const LIVE = {
    ...CONFIG,
    effectiveState: 'no_plan',
    effectiveDurationMin: 12,
    effectiveCooldownEnabled: true,
    effectiveCooldownSec: 120,
    sessionFollowsMusic: null,
    sessionEndsAtMs: null,
    cooldownRemainingSec: 0,
    planActive: false,
    inFestivalWindow: false,
    partyCueId: 'c_mood_to_party',
  };

  it('accepts the real titanic-ext payload verbatim', () => {
    const cfg = parsePartyConfig(LIVE);
    expect(cfg.effectiveState).toBe('no_plan');
    expect(cfg.effectiveDurationMin).toBe(12);
    expect(cfg.effectiveCooldownEnabled).toBe(true);
    expect(cfg.effectiveCooldownSec).toBe(120);
    expect(cfg.sessionFollowsMusic).toBeNull();
    expect(cfg.sessionEndsAtMs).toBeNull();
    expect(cfg.cooldownRemainingSec).toBe(0);
    expect(cfg.planActive).toBe(false);
    expect(cfg.inFestivalWindow).toBe(false);
    expect(cfg.partyCueId).toBe('c_mood_to_party');
  });

  it('accepts a payload WITHOUT the additions (pre-addition engine)', () => {
    const cfg = parsePartyConfig(CONFIG);
    expect(cfg.effectiveDurationMin).toBeUndefined();
    expect(cfg.cooldownRemainingSec).toBeUndefined();
  });

  it("accepts 'manual' as an effectiveState", () => {
    expect(parsePartyConfig({ ...LIVE, effectiveState: 'manual' }).effectiveState).toBe('manual');
  });

  it('type-checks the additions when present', () => {
    expect(() => parsePartyConfig({ ...LIVE, effectiveDurationMin: '12' })).toThrow(/'effectiveDurationMin' must be a finite number when present/);
    expect(() => parsePartyConfig({ ...LIVE, effectiveCooldownEnabled: 1 })).toThrow(/'effectiveCooldownEnabled' must be a boolean when present/);
    expect(() => parsePartyConfig({ ...LIVE, sessionEndsAtMs: 'soon' })).toThrow(/'sessionEndsAtMs' must be a finite number or null/);
    expect(() => parsePartyConfig({ ...LIVE, sessionFollowsMusic: 'yes' })).toThrow(/'sessionFollowsMusic' must be a boolean or null/);
    expect(() => parsePartyConfig({ ...LIVE, partyCueId: 7 })).toThrow(/'partyCueId' must be a string or null/);
  });
});

describe('describePartyRows — engine effective flag is authority', () => {
  it("prefers effectiveCooldownEnabled where it disagrees with the raw toggle", () => {
    const r = describePartyRows({ durationEnabled: true, cooldownEnabled: true, effectiveCooldownEnabled: false });
    expect(r.cooldownEnabled).toBe(false);
  });

  it('still greys instantly on a pending duration-off, before the engine catches up', () => {
    const r = describePartyRows({ durationEnabled: false, cooldownEnabled: true, effectiveCooldownEnabled: true });
    expect(r.cooldownEnabled).toBe(false);
    expect(r.cooldownToggleDisabled).toBe(true);
  });
});

describe('describeEffectiveNote', () => {
  it('is silent when raw and effective agree, or the engine sent nothing', () => {
    expect(describeEffectiveNote(12, 12, (n) => `${n} min`)).toBeNull();
    expect(describeEffectiveNote(12, undefined, (n) => `${n} min`)).toBeNull();
  });
  it('names the engine value when they differ', () => {
    expect(describeEffectiveNote(12, 20, (n) => `${n} min`)).toBe('engine uses 20 min');
  });
});

describe('describePartyStatus — the six landed states', () => {
  it('MANUAL is its own state, not NO PLAN', () => {
    const s = describePartyStatus({ enabled: true, effectiveState: 'manual' });
    expect(s.label).toBe('MANUAL');
    expect(s.tone).toBe('manual');
    expect(s.detail).toMatch(/operator has the deck/i);
  });

  it('no_plan OUTSIDE the festival window says so', () => {
    const s = describePartyStatus({ enabled: true, effectiveState: 'no_plan', inFestivalWindow: false });
    expect(s.label).toBe('OUT OF WINDOW');
    expect(s.detail).toMatch(/festival window/i);
  });

  it('no_plan INSIDE the window (or unknown) stays NO PLAN', () => {
    expect(describePartyStatus({ enabled: true, effectiveState: 'no_plan', inFestivalWindow: true }).label).toBe('NO PLAN');
    expect(describePartyStatus({ enabled: true, effectiveState: 'no_plan' }).label).toBe('NO PLAN');
  });

  it('in_session with a fixed duration counts down to sessionEndsAtMs', () => {
    const s = describePartyStatus({
      enabled: true, effectiveState: 'in_session',
      sessionEndsAtMs: 1_000_000 + 135_000, nowMs: 1_000_000,
      sessionFollowsMusic: false, currentMood: 'party',
    });
    expect(s.label).toBe('IN SESSION');
    expect(s.detail).toMatch(/ends in 2:15/);
    expect(s.detail).toMatch(/mood party/);
  });

  it('a past end time clamps at 0:00 rather than going negative', () => {
    const s = describePartyStatus({
      enabled: true, effectiveState: 'in_session', sessionEndsAtMs: 900_000, nowMs: 1_000_000,
    });
    expect(s.detail).toMatch(/ends in 0:00/);
  });

  it('in_session that follows the music names the music, not a clock', () => {
    const s = describePartyStatus({
      enabled: true, effectiveState: 'in_session', sessionFollowsMusic: true,
      sessionEndsAtMs: null, nowMs: 1_000_000,
    });
    expect(s.detail).toMatch(/follows the music/i);
    expect(s.detail).not.toMatch(/ends in/);
  });

  it('cooldown shows the remaining time as m:ss', () => {
    const s = describePartyStatus({ enabled: true, effectiveState: 'cooldown', cooldownRemainingSec: 95 });
    expect(s.label).toBe('COOLDOWN');
    expect(s.detail).toMatch(/1:35/);
  });
});
