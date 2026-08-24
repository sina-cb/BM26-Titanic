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
  forcePartySession,
  resetPartyCooldown,
  returnPartyToLiveAudio,
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
  partyTimerReadouts,
  partyButtonRules,
  partyReadinessChips,
  formatPartyClock,
  formatPartyClockOnDay,
  PARTY_FIELD_BOUNDS,
  type PartyConfig,
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

describe('Party live commands', () => {
  it('posts Force Party, Return to Live Audio, and Reset Cooldown to distinct engine commands', async () => {
    for (const [call, path] of [
      [forcePartySession, '/party/force'],
      [returnPartyToLiveAudio, '/party/live-audio'],
      [resetPartyCooldown, '/party/cooldown/reset'],
    ] as const) {
      stubFetch(CONFIG);
      const result = await call();
      expect(result.ok).toBe(true);
      expect(lastUrl).toBe(`http://engine.test${path}`);
      expect(lastInit?.method).toBe('POST');
    }
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
    expect(parsePartyConfig({ ...base, effectiveState: 'waiting_window' }).effectiveState).toBe('waiting_window');
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
      sessionForced: false,
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

describe('partyTimerReadouts — only the live stage counts', () => {
  const readiness = {
    enabled: true,
    planActive: true,
    partyWindowOpen: true,
    planDriving: true,
    triggerArmed: true,
    cooldownClear: true,
  };

  it('counts sustain down to its threshold without displaying unbounded held time', () => {
    const timers = partyTimerReadouts({
      ...CONFIG,
      effectiveState: 'armed',
      strongSignal: true,
      sustainHeldSec: 12,
      sustainRequiredSec: 30,
      readiness,
    }, 1_000_000);
    expect(timers[0]).toMatchObject({
      id: 'sustain',
      value: '0:18 LEFT',
      detail: '0:12 OF 0:30',
      tone: 'active',
    });
    expect(timers[1].value).toBe('WAITING');
    expect(timers[2].value).toBe('READY');
  });

  it('stops sustain at COMPLETE and starts only the Party Time clock in session', () => {
    const timers = partyTimerReadouts({
      ...CONFIG,
      effectiveState: 'in_session',
      strongSignal: true,
      sustainHeldSec: 377,
      sustainRequiredSec: 30,
      effectiveDurationMin: 12,
      effectiveCooldownEnabled: true,
      effectiveCooldownSec: 120,
      sessionFollowsMusic: false,
      sessionEndsAtMs: 1_090_000,
      signalLossHeldSec: 0,
      signalLossRequiredSec: 15,
      signalLossProgress: 0,
      readiness,
    }, 1_000_000);
    expect(timers[0]).toMatchObject({
      label: 'TIMELINE RELEASE',
      value: 'READY',
      detail: '0:15 AFTER DETECTOR',
    });
    expect(timers[1]).toMatchObject({ value: '1:30 LEFT', tone: 'active' });
    expect(timers[2]).toMatchObject({ value: 'READY', tone: 'ready' });
  });

  it('counts the 15-second no-party hold while a fixed session loses detection', () => {
    const timers = partyTimerReadouts({
      ...CONFIG,
      effectiveState: 'in_session',
      strongSignal: false,
      sustainHeldSec: 0,
      sustainRequiredSec: 30,
      effectiveDurationMin: 12,
      effectiveCooldownEnabled: true,
      sessionFollowsMusic: false,
      sessionEndsAtMs: 1_600_000,
      signalLossHeldSec: 6,
      signalLossRequiredSec: 15,
      signalLossProgress: 0.4,
      readiness,
    }, 1_000_000);
    expect(timers[0]).toMatchObject({
      label: 'TIMELINE RELEASE',
      value: '0:09 LEFT',
      detail: 'AFTER DETECTOR OFF',
      tone: 'active',
    });
  });

  it('shows that detector state is ignored while the operator-forced session is latched', () => {
    const timers = partyTimerReadouts({
      ...CONFIG,
      effectiveState: 'in_session',
      strongSignal: false,
      sessionForced: true,
      sessionFollowsMusic: false,
      sessionEndsAtMs: 1_600_000,
      signalLossHeldSec: 0,
      signalLossRequiredSec: 15,
      readiness,
    }, 1_000_000);
    expect(timers[0]).toMatchObject({
      label: 'LIVE AUDIO',
      value: 'FORCED',
      detail: 'SIGNAL IGNORED',
      tone: 'active',
    });
  });

  it('starts only cooldown after Party Time ends', () => {
    const timers = partyTimerReadouts({
      ...CONFIG,
      effectiveState: 'cooldown',
      strongSignal: false,
      cooldownRemainingSec: 95,
      effectiveCooldownEnabled: true,
      readiness: { ...readiness, cooldownClear: false, triggerArmed: false },
    }, 1_000_000);
    expect(timers.map((timer) => timer.value)).toEqual(['WAITING', 'WAITING', '1:35 LEFT']);
    expect(timers[2].tone).toBe('active');
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

  it('parses engine-owned sustain progress and readiness facts', () => {
    const cfg = parsePartyConfig({
      ...LIVE,
      strongSignal: true,
      sustainHeldSec: 12,
      sustainRequiredSec: 30,
      sustainProgress: 0.4,
      readiness: {
        enabled: true,
        planActive: true,
        partyWindowOpen: true,
        planDriving: true,
        triggerArmed: true,
        cooldownClear: true,
      },
    });
    expect(cfg.strongSignal).toBe(true);
    expect(cfg.sustainProgress).toBe(0.4);
    expect(cfg.readiness?.partyWindowOpen).toBe(true);
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
  it('says the timed Party Window is closed instead of claiming detection is armed', () => {
    const s = describePartyStatus({ enabled: true, effectiveState: 'waiting_window' });
    expect(s.label).toBe('WINDOW CLOSED');
    expect(s.detail).toMatch(/cannot switch playlists/i);
  });

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

// ── _356 §4: the button matrix and the readiness chips ──────────────────
// Both are PURE and both are the code the card actually runs. Before _356 the
// two session buttons rendered enabled in every state (F5) and the chip row
// could not express "a session is live" at all (F6).

function partyConfig(overrides: Partial<PartyConfig> = {}): PartyConfig {
  return {
    ...CONFIG,
    availablePlaylists: CONFIG.availablePlaylists.slice(),
    effectiveState: 'armed',
    partyCueId: 'c_party',
    cooldownRemainingSec: 0,
    strongSignal: false,
    sessionForced: false,
    readiness: {
      enabled: true,
      planActive: true,
      partyWindowOpen: true,
      planDriving: true,
      triggerArmed: true,
      cooldownClear: true,
    },
    ...overrides,
  };
}

const READY = partyConfig().readiness!;
const LIVE = { connected: true, locked: false, pending: false };

describe('partyButtonRules — one rule set for every control', () => {
  it('IDLE and armed: FORCE is live, RETURN is not (no session to end)', () => {
    const r = partyButtonRules({ config: partyConfig(), ...LIVE });
    expect(r.force).toEqual({ enabled: true, label: 'FORCE PARTY' });
    expect(r.returnToAudio).toEqual({ enabled: false, label: 'END PARTY SESSION' });
    expect(r.resetCooldown.enabled).toBe(false);
    expect(r.enabledToggle).toEqual({ enabled: true, label: 'ENABLED' });
    expect(r.settings).toEqual({ enabled: true, label: 'SETTINGS' });
  });

  it('FORCED session: FORCE reads PARTY FORCED and is disabled; RETURN TO LIVE AUDIO is armed', () => {
    const r = partyButtonRules({
      config: partyConfig({ effectiveState: 'in_session', sessionForced: true }),
      ...LIVE,
    });
    expect(r.force).toEqual({ enabled: false, label: 'PARTY FORCED' });
    expect(r.returnToAudio).toEqual({ enabled: true, label: 'RETURN TO LIVE AUDIO' });
  });

  it('DETECTED session: the same button ends it, labelled END PARTY SESSION', () => {
    const r = partyButtonRules({
      config: partyConfig({ effectiveState: 'in_session', sessionForced: false }),
      ...LIVE,
    });
    expect(r.returnToAudio).toEqual({ enabled: true, label: 'END PARTY SESSION' });
    expect(r.force.enabled).toBe(false);
  });

  it('COOLDOWN: RESET COOLDOWN is the only session control that changes state', () => {
    const r = partyButtonRules({
      config: partyConfig({
        effectiveState: 'cooldown',
        cooldownRemainingSec: 42,
        readiness: { ...READY, cooldownClear: false },
      }),
      ...LIVE,
    });
    expect(r.resetCooldown.enabled).toBe(true);
    expect(r.returnToAudio.enabled).toBe(false);
    expect(r.force.enabled).toBe(true);
  });

  it('DISCONNECTED: every write is off, SETTINGS still opens', () => {
    const r = partyButtonRules({
      config: partyConfig({ effectiveState: 'in_session', cooldownRemainingSec: 42 }),
      connected: false,
      locked: false,
      pending: false,
    });
    expect([r.force.enabled, r.returnToAudio.enabled, r.resetCooldown.enabled, r.enabledToggle.enabled])
      .toEqual([false, false, false, false]);
    expect(r.settings.enabled).toBe(true);
  });

  it('LOCKED (performance mode) and PENDING behave like disconnected for writes', () => {
    const config = partyConfig({ effectiveState: 'in_session', cooldownRemainingSec: 42 });
    for (const flags of [{ ...LIVE, locked: true }, { ...LIVE, pending: true }]) {
      const r = partyButtonRules({ config, ...flags });
      expect([r.force.enabled, r.returnToAudio.enabled, r.resetCooldown.enabled, r.enabledToggle.enabled])
        .toEqual([false, false, false, false]);
      expect(r.settings.enabled).toBe(true);
    }
  });

  it('no config yet, or no party cue in the plan, cannot force', () => {
    expect(partyButtonRules({ config: null, ...LIVE }).force.enabled).toBe(false);
    expect(partyButtonRules({ config: null, ...LIVE }).enabledToggle).toEqual({
      enabled: false, label: 'DISABLED',
    });
    expect(partyButtonRules({ config: partyConfig({ partyCueId: null }), ...LIVE }).force.enabled)
      .toBe(false);
  });

  it('a dormant plan cannot force even with a cue authored', () => {
    const config = partyConfig({ readiness: { ...READY, planActive: false } });
    expect(partyButtonRules({ config, ...LIVE }).force.enabled).toBe(false);
  });

  it('SETTINGS is the disclosure label and flips to LESS when open', () => {
    expect(partyButtonRules({ config: partyConfig(), ...LIVE, expanded: true }).settings)
      .toEqual({ enabled: true, label: 'LESS' });
  });
});

describe('partyReadinessChips — engine fields only', () => {
  const texts = (config: PartyConfig, options = {}) =>
    partyReadinessChips(config, options).map((c) => c.text);
  const byId = (config: PartyConfig, id: string, options = {}) =>
    partyReadinessChips(config, options).find((c) => c.id === id)!;

  it('renders the seven _356 chips in order, PARTY ON and SESSION renamed', () => {
    expect(partyReadinessChips(partyConfig()).map((c) => c.id)).toEqual([
      'plan', 'deck', 'window', 'partyOn', 'signal', 'session', 'cooldown',
    ]);
    expect(texts(partyConfig())).toContain('✓ PARTY ON');
    expect(texts(partyConfig())).toContain('✓ SESSION ARMED');
    expect(texts(partyConfig()).join(' ')).not.toMatch(/DETECTOR/);
  });

  it('PLAN and DECK are separate facts (a takeover breaks only DECK)', () => {
    const config = partyConfig({ readiness: { ...READY, planDriving: false } });
    expect(byId(config, 'plan')).toMatchObject({ text: '✓ PLAN', tone: 'ready' });
    expect(byId(config, 'deck')).toMatchObject({ text: '× DECK', tone: 'alert' });
  });

  it('a closed WINDOW names the time it opens, in the PLAN tz', () => {
    const config = partyConfig({
      effectiveState: 'waiting_window',
      partyWindowOpensAtMs: Date.UTC(2026, 7, 24, 4, 0), // Mon 21:00 PDT
      readiness: { ...READY, partyWindowOpen: false },
    });
    // Same plan-tz calendar day as NOW (Mon 18:00 PDT) → bare clock.
    expect(byId(config, 'window', {
      planTz: 'America/Los_Angeles',
      nowMs: Date.UTC(2026, 7, 24, 1, 0),
    })).toEqual({
      id: 'window', text: '× WINDOW · opens 21:00', tone: 'alert',
    });
  });

  // The live bug (2026-08-23): a window that had been authored onto TOMORROW
  // read "opens 09:00" at 09:23 in the morning, which the operator reasonably
  // took to mean "in a moment". The day is part of the answer.
  it('a WINDOW opening on ANOTHER plan-tz day names the weekday too', () => {
    const config = partyConfig({
      effectiveState: 'waiting_window',
      partyWindowOpensAtMs: Date.UTC(2026, 7, 24, 16, 0), // Mon 09:00 PDT
      readiness: { ...READY, partyWindowOpen: false },
    });
    expect(byId(config, 'window', {
      planTz: 'America/Los_Angeles',
      nowMs: Date.UTC(2026, 7, 23, 16, 23), // Sun 09:23 PDT
    })).toEqual({
      id: 'window', text: '× WINDOW · opens Mon 09:00', tone: 'alert',
    });
  });

  it('with no nowMs the WINDOW chip keeps the weekday (never a bare, ambiguous time)', () => {
    const config = partyConfig({
      partyWindowOpensAtMs: Date.UTC(2026, 7, 24, 16, 0),
      readiness: { ...READY, partyWindowOpen: false },
    });
    expect(byId(config, 'window', { planTz: 'America/Los_Angeles' }).text)
      .toBe('× WINDOW · opens Mon 09:00');
  });

  it('without a plan tz the WINDOW chip omits the time rather than using device local', () => {
    const config = partyConfig({
      partyWindowOpensAtMs: Date.UTC(2026, 7, 24, 4, 0),
      readiness: { ...READY, partyWindowOpen: false },
    });
    expect(byId(config, 'window').text).toBe('× WINDOW');
  });

  it('a FORCED session bypasses the window instead of flagging it red', () => {
    const config = partyConfig({
      effectiveState: 'in_session',
      sessionForced: true,
      readiness: { ...READY, partyWindowOpen: false },
    });
    expect(byId(config, 'window')).toEqual({ id: 'window', text: '· WINDOW BYPASSED', tone: 'neutral' });
  });

  it('SIGNAL reports the evaluator input: party, calm (neutral), or STALE (red)', () => {
    expect(byId(partyConfig({ strongSignal: true }), 'signal'))
      .toMatchObject({ text: '✓ SIGNAL', tone: 'ready' });
    expect(byId(partyConfig({ strongSignal: false }), 'signal'))
      .toMatchObject({ text: '× SIGNAL', tone: 'neutral' });
    expect(byId(partyConfig({ strongSignal: true }), 'signal', { moodStale: true }))
      .toMatchObject({ text: '× SIGNAL STALE', tone: 'alert' });
    // The engine's own party-config field wins over the /timeline/state one.
    expect(byId(partyConfig({ strongSignal: true, moodStale: true }), 'signal', { moodStale: false }))
      .toMatchObject({ text: '× SIGNAL STALE', tone: 'alert' });
  });

  it('SESSION says LIVE (not red) during a session and red ONLY on a cue error', () => {
    const live = partyConfig({
      effectiveState: 'in_session',
      readiness: { ...READY, triggerArmed: false },
    });
    expect(byId(live, 'session')).toEqual({ id: 'session', text: '· SESSION LIVE', tone: 'live' });

    const errored = partyConfig({
      cueError: 'playlist "party_bangers" not found',
      readiness: { ...READY, triggerArmed: false },
    });
    expect(byId(errored, 'session')).toEqual({ id: 'session', text: '× SESSION ERROR', tone: 'alert' });

    const noCue = partyConfig({
      partyCueId: null,
      readiness: { ...READY, triggerArmed: null },
    });
    expect(byId(noCue, 'session')).toEqual({ id: 'session', text: '× SESSION NO CUE', tone: 'neutral' });
  });

  it('COOLDOWN counts the lockout down as m:ss', () => {
    const config = partyConfig({
      effectiveState: 'cooldown',
      cooldownRemainingSec: 95,
      readiness: { ...READY, cooldownClear: false },
    });
    expect(byId(config, 'cooldown')).toEqual({ id: 'cooldown', text: '× COOLDOWN · 1:35', tone: 'alert' });
  });

  it('an engine that sends no readiness block gets no chip row (never a guessed one)', () => {
    const bare = partyConfig();
    delete bare.readiness;
    expect(partyReadinessChips(bare)).toEqual([]);
  });
});

describe('formatPartyClock', () => {
  it('formats an instant in the plan tz, 24h, zero padded', () => {
    expect(formatPartyClock(Date.UTC(2026, 7, 24, 4, 0), 'America/Los_Angeles')).toBe('21:00');
    expect(formatPartyClock(Date.UTC(2026, 7, 24, 16, 5), 'America/Los_Angeles')).toBe('09:05');
  });

  it('says nothing when the instant or the tz is unusable', () => {
    expect(formatPartyClock(null, 'America/Los_Angeles')).toBeNull();
    expect(formatPartyClock(Date.UTC(2026, 7, 24, 4, 0), null)).toBeNull();
    expect(formatPartyClock(Date.UTC(2026, 7, 24, 4, 0), 'Not/AZone')).toBeNull();
  });
});

describe('formatPartyClockOnDay', () => {
  const TZ = 'America/Los_Angeles';

  it('drops the weekday only when the instant is TODAY in the plan tz', () => {
    // Sun 09:23 PDT "now"; both instants are Sun in PDT.
    const now = Date.UTC(2026, 7, 23, 16, 23);
    expect(formatPartyClockOnDay(Date.UTC(2026, 7, 23, 16, 0), TZ, now)).toBe('09:00');
    expect(formatPartyClockOnDay(Date.UTC(2026, 7, 24, 4, 0), TZ, now)).toBe('21:00');
  });

  it('keeps the weekday for another plan-tz day, past or future', () => {
    const now = Date.UTC(2026, 7, 23, 16, 23);                      // Sun 09:23 PDT
    expect(formatPartyClockOnDay(Date.UTC(2026, 7, 24, 16, 0), TZ, now)).toBe('Mon 09:00');
    expect(formatPartyClockOnDay(Date.UTC(2026, 7, 22, 16, 0), TZ, now)).toBe('Sat 09:00');
  });

  it('uses the PLAN tz for the day boundary, not UTC', () => {
    // 2026-08-24T04:00Z is Monday in UTC but Sunday 21:00 in PDT.
    const now = Date.UTC(2026, 7, 23, 16, 23); // Sun 09:23 PDT
    expect(formatPartyClockOnDay(Date.UTC(2026, 7, 24, 4, 0), TZ, now)).toBe('21:00');
  });

  it('keeps the weekday when no clock was injected, and says nothing without a tz', () => {
    expect(formatPartyClockOnDay(Date.UTC(2026, 7, 24, 4, 0), TZ)).toBe('Sun 21:00');
    expect(formatPartyClockOnDay(Date.UTC(2026, 7, 24, 4, 0), null, Date.now())).toBeNull();
    expect(formatPartyClockOnDay(null, TZ, Date.now())).toBeNull();
    expect(formatPartyClockOnDay(Date.UTC(2026, 7, 24, 4, 0), 'Not/AZone', Date.now())).toBeNull();
  });
});

describe('parsePartyConfig — the _356 additions', () => {
  it('accepts cueError and the Party Window boundaries, null included', () => {
    const parsed = parsePartyConfig({
      ...CONFIG,
      cueError: 'playlist missing',
      partyWindowOpensAtMs: 1_700_000_000_000,
      partyWindowClosesAtMs: null,
      moodStale: true,
    });
    expect(parsed.cueError).toBe('playlist missing');
    expect(parsed.partyWindowOpensAtMs).toBe(1_700_000_000_000);
    expect(parsed.partyWindowClosesAtMs).toBeNull();
    expect(parsed.moodStale).toBe(true);
  });

  it('omits them entirely on a pre-_356 engine', () => {
    const parsed = parsePartyConfig(CONFIG);
    expect('cueError' in parsed).toBe(false);
    expect('partyWindowOpensAtMs' in parsed).toBe(false);
  });

  it('throws on a wrong-typed addition instead of coercing it', () => {
    expect(() => parsePartyConfig({ ...CONFIG, cueError: 7 })).toThrow(/cueError/);
    expect(() => parsePartyConfig({ ...CONFIG, partyWindowOpensAtMs: 'soon' }))
      .toThrow(/partyWindowOpensAtMs/);
    expect(() => parsePartyConfig({ ...CONFIG, moodStale: 'yes' })).toThrow(/moodStale/);
  });
});
