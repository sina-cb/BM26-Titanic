/**
 * Pinned logic tests for the BIKE COLOR LINK card (config.tsx →
 * BikeColorLinkCard). Mock payloads only — no engine contact.
 *
 * Covers: all five bike states (visual role + sort order), 404 →
 * engine_predates, 503/network error → unavailable (and a failed poll
 * keeping the last good snapshot instead of blanking), disabled snapshot,
 * enabled+empty with and without targets configured, formatter edges
 * (null lease, lease 0, negative clock skew, hour-scale ages), and the
 * disable-confirm copy's ~60 s revert claim.
 */
import { describe, expect, it } from 'vitest';

import {
  BIKE_LINK_REVERT_HINT,
  DISABLE_BIKE_LINK_CONFIRM_MESSAGE,
  DISABLE_BIKE_LINK_CONFIRM_TITLE,
  ENGINE_PREDATES_BIKE_LINK_MESSAGE,
  bikeVisualRole,
  derivePanelState,
  disabledMessage,
  enabledEmptyMessage,
  formatAge,
  formatLeaseRemaining,
  formatPushStats,
  reconcileTargetsDraft,
  saveBikeTargetsPatch,
  sortBikes,
  startBikeLinkPatch,
  type BikeLinkPanelState,
  type BikeLinkState,
  type BikePushStats,
  type BikeShareConfig,
  type BikeShareStats,
  type BikeSnapshot,
  type BikesSnapshot,
  type FetchBikesResult,
} from './bike_link_logic';

// ── Fixtures ───────────────────────────────────────────────────────────

const CONFIG: BikeShareConfig = {
  enabled: false,
  targets: '',
  port: 80,
  scanIntervalMs: 15000,
  probeTimeoutMs: 2000,
  probeStaggerMs: 50,
  pushIntervalMs: 30000,
  pushTimeoutMs: 3000,
  staleAfterFailures: 2,
  goneAfterMs: 300000,
  dropAfterMs: 1800000,
};

const STATS: BikeShareStats = {
  sweeps: 0,
    pushCycles: 0,
    changePushCycles: 0,
    pushCycleOverruns: 0,
  pushesOk: 0,
  pushesFailed: 0,
    paletteErrors: 0,
    paletteChangeNotifications: 0,
    paletteChangeNotificationsCoalesced: 0,
  };

const pushStats = (patch: Partial<BikePushStats> = {}): BikePushStats => ({
  ok: 0, failed: 0, consecutiveFailures: 0, lastPushMs: null, ...patch,
});

const bike = (patch: Partial<BikeSnapshot> = {}): BikeSnapshot => ({
  controllerId: 'bike_ab12',
  address: '10.1.1.50:80',
  ip: '10.1.1.50',
  port: 80,
  state: 'LINKED',
  firmwareTag: 'v2.1.0',
  activePattern: 'rainbow',
  mac: null,
  lastSeenMs: 1000,
  leaseMsRemaining: 42000,
  pushStats: pushStats(),
  ...patch,
});

const snapshot = (patch: Partial<BikesSnapshot> = {}): BikesSnapshot => ({
  enabled: false,
  config: CONFIG,
  stats: STATS,
  bikes: [],
  ...patch,
});

// ── Sort + visual role ────────────────────────────────────────────────

describe('bikeVisualRole', () => {
  it('maps each of the five states to its documented token role', () => {
    const expected: Record<BikeLinkState, string> = {
      LINKED: 'tertiary',
      DISCOVERED: 'primary',
      STALE: 'warning',
      UNSUPPORTED: 'error',
      GONE: 'icon',
    };
    for (const [state, role] of Object.entries(expected) as [BikeLinkState, string][]) {
      expect(bikeVisualRole(state)).toBe(role);
    }
  });
});

describe('sortBikes', () => {
  it('orders LINKED, DISCOVERED, STALE, UNSUPPORTED, GONE', () => {
    const bikes = [
      bike({ controllerId: 'g1', state: 'GONE' }),
      bike({ controllerId: 'u1', state: 'UNSUPPORTED' }),
      bike({ controllerId: 's1', state: 'STALE' }),
      bike({ controllerId: 'd1', state: 'DISCOVERED' }),
      bike({ controllerId: 'l1', state: 'LINKED' }),
    ];
    expect(sortBikes(bikes).map((b) => b.state)).toEqual([
      'LINKED', 'DISCOVERED', 'STALE', 'UNSUPPORTED', 'GONE',
    ]);
  });

  it('is stable within a state by controllerId', () => {
    const bikes = [
      bike({ controllerId: 'bike_c', state: 'LINKED' }),
      bike({ controllerId: 'bike_a', state: 'LINKED' }),
      bike({ controllerId: 'bike_b', state: 'LINKED' }),
    ];
    expect(sortBikes(bikes).map((b) => b.controllerId)).toEqual(['bike_a', 'bike_b', 'bike_c']);
  });

  it('does not mutate the input array', () => {
    const bikes = [bike({ controllerId: 'z' }), bike({ controllerId: 'a' })];
    const original = [...bikes];
    sortBikes(bikes);
    expect(bikes).toEqual(original);
  });
});

// ── derivePanelState ───────────────────────────────────────────────────

describe('derivePanelState', () => {
  it('404 → engine_predates, regardless of any previous state', () => {
    const result: FetchBikesResult = { ok: false, status: 404 };
    expect(derivePanelState(result)).toEqual({ kind: 'engine_predates' });
    const previous: BikeLinkPanelState = { kind: 'list', bikes: [], targets: '', stats: STATS };
    expect(derivePanelState(result, previous)).toEqual({ kind: 'engine_predates' });
  });

  it('503 with no previous state → unavailable, carrying the engine message', () => {
    const result: FetchBikesResult = { ok: false, status: 503, error: 'bike color share unavailable' };
    expect(derivePanelState(result)).toEqual({
      kind: 'unavailable', message: 'bike color share unavailable',
    });
  });

  it('network error with no previous state → unavailable, carrying the transport message', () => {
    const result: FetchBikesResult = { ok: false, error: 'Network request failed' };
    expect(derivePanelState(result)).toEqual({
      kind: 'unavailable', message: 'Network request failed',
    });
  });

  it('a failed poll KEEPS the last good list state instead of blanking it', () => {
    const previous: BikeLinkPanelState = {
      kind: 'list', bikes: [bike()], targets: '10.1.1.50', stats: STATS,
    };
    const result: FetchBikesResult = { ok: false, error: 'Network request failed' };
    expect(derivePanelState(result, previous)).toBe(previous);
  });

  it('a failed poll keeps the last good disabled/enabled_empty state too', () => {
    const disabled: BikeLinkPanelState = { kind: 'disabled', knownBikeCount: 2, targets: '10.1.1.50' };
    const empty: BikeLinkPanelState = { kind: 'enabled_empty', targets: '', targetsConfigured: false };
    const result: FetchBikesResult = { ok: false, status: 503, error: 'unavailable' };
    expect(derivePanelState(result, disabled)).toBe(disabled);
    expect(derivePanelState(result, empty)).toBe(empty);
  });

  it('a failed poll does NOT fall back to a stale loading/unavailable/engine_predates previous', () => {
    const result: FetchBikesResult = { ok: false, error: 'down' };
    expect(derivePanelState(result, { kind: 'loading' })).toEqual({ kind: 'unavailable', message: 'down' });
    expect(derivePanelState(result, { kind: 'engine_predates' })).toEqual({ kind: 'unavailable', message: 'down' });
  });

  it('disabled snapshot → disabled state, carrying known bike count + targets', () => {
    const result: FetchBikesResult = {
      ok: true,
      data: snapshot({ enabled: false, config: { ...CONFIG, targets: '10.1.1.50-10.1.1.60' }, bikes: [bike()] }),
    };
    expect(derivePanelState(result)).toEqual({
      kind: 'disabled', knownBikeCount: 1, targets: '10.1.1.50-10.1.1.60',
    });
  });

  it('enabled + zero bikes + targets configured → enabled_empty, targetsConfigured true', () => {
    const result: FetchBikesResult = {
      ok: true,
      data: snapshot({ enabled: true, config: { ...CONFIG, enabled: true, targets: '10.1.1.50' }, bikes: [] }),
    };
    expect(derivePanelState(result)).toEqual({
      kind: 'enabled_empty', targets: '10.1.1.50', targetsConfigured: true,
    });
  });

  it('enabled + zero bikes + NO targets configured → enabled_empty, targetsConfigured false', () => {
    const result: FetchBikesResult = {
      ok: true,
      data: snapshot({ enabled: true, config: { ...CONFIG, enabled: true, targets: '' }, bikes: [] }),
    };
    expect(derivePanelState(result)).toEqual({
      kind: 'enabled_empty', targets: '', targetsConfigured: false,
    });
  });

  it('enabled + bikes → list state, sorted', () => {
    const result: FetchBikesResult = {
      ok: true,
      data: snapshot({
        enabled: true,
        config: { ...CONFIG, enabled: true, targets: '10.1.1.50' },
        bikes: [bike({ controllerId: 'z', state: 'GONE' }), bike({ controllerId: 'a', state: 'LINKED' })],
        stats: { ...STATS, sweeps: 3 },
      }),
    };
    const state = derivePanelState(result);
    expect(state.kind).toBe('list');
    if (state.kind === 'list') {
      expect(state.bikes.map((b) => b.controllerId)).toEqual(['a', 'z']);
      expect(state.stats.sweeps).toBe(3);
      expect(state.targets).toBe('10.1.1.50');
    }
  });
});

// ── Formatters ─────────────────────────────────────────────────────────

describe('formatLeaseRemaining', () => {
  it('renders null as "—"', () => {
    expect(formatLeaseRemaining(null)).toBe('—');
  });

  it('renders 0 (and any non-positive value) as "—", not "0 s"', () => {
    expect(formatLeaseRemaining(0)).toBe('—');
    expect(formatLeaseRemaining(-500)).toBe('—');
  });

  it('renders a positive remainder rounded to whole seconds', () => {
    expect(formatLeaseRemaining(42000)).toBe('42 s');
    expect(formatLeaseRemaining(1499)).toBe('1 s');
  });
});

describe('formatAge', () => {
  const nowMs = 1_000_000;

  it('renders null as "—"', () => {
    expect(formatAge(nowMs, null)).toBe('—');
  });

  it('clamps negative clock skew (epoch slightly ahead of now) to "0 s ago"', () => {
    expect(formatAge(nowMs, nowMs + 5000)).toBe('0 s ago');
  });

  it('renders sub-minute ages in seconds', () => {
    expect(formatAge(nowMs, nowMs - 3000)).toBe('3 s ago');
    expect(formatAge(nowMs, nowMs - 59_000)).toBe('59 s ago');
  });

  it('renders sub-hour ages in minutes', () => {
    expect(formatAge(nowMs, nowMs - 60_000)).toBe('1 m ago');
    expect(formatAge(nowMs, nowMs - 120_000)).toBe('2 m ago');
  });

  it('renders hour-scale ages in hours', () => {
    expect(formatAge(nowMs, nowMs - 3_600_000)).toBe('1 h ago');
    expect(formatAge(nowMs, nowMs - 7_200_000)).toBe('2 h ago');
  });
});

describe('formatPushStats', () => {
  it('renders "N ok / M failed"', () => {
    expect(formatPushStats(pushStats({ ok: 12, failed: 0 }))).toBe('12 ok / 0 failed');
    expect(formatPushStats(pushStats({ ok: 0, failed: 3 }))).toBe('0 ok / 3 failed');
  });
});

describe('target editor', () => {
  it('starts atomically with the trimmed targets in the same write', () => {
    expect(startBikeLinkPatch('  10.1.1.50,10.1.1.51  ')).toEqual({
      enabled: true,
      targets: '10.1.1.50,10.1.1.51',
    });
  });

  it('saves only targets while the link is already live', () => {
    expect(saveBikeTargetsPatch(' 10.1.1.50 ')).toEqual({ targets: '10.1.1.50' });
  });

  it('accepts server truth only when no edit is in progress', () => {
    expect(reconcileTargetsDraft('draft', 'server', false, false)).toBe('server');
    expect(reconcileTargetsDraft('draft', 'server', true, false)).toBe('draft');
    expect(reconcileTargetsDraft('draft', 'server', false, true)).toBe('draft');
    expect(reconcileTargetsDraft('draft', 'server', true, true)).toBe('draft');
  });
});

// ── Copy strings ──────────────────────────────────────────────────────

describe('disable confirm copy', () => {
  it('states the ~60 s self-revert plainly (title + message)', () => {
    expect(DISABLE_BIKE_LINK_CONFIRM_TITLE.length).toBeGreaterThan(0);
    expect(DISABLE_BIKE_LINK_CONFIRM_MESSAGE).toMatch(/60 seconds/);
    expect(DISABLE_BIKE_LINK_CONFIRM_MESSAGE).toMatch(/own colors/i);
  });

  it('the persistent hint near the control repeats the same ~60 s fact', () => {
    expect(BIKE_LINK_REVERT_HINT).toMatch(/60 seconds/);
    expect(BIKE_LINK_REVERT_HINT).toMatch(/own colors/i);
  });
});

describe('engine_predates copy', () => {
  it('names the restart-on-new-build remedy in plain operator language', () => {
    expect(ENGINE_PREDATES_BIKE_LINK_MESSAGE).toMatch(/predates/i);
    expect(ENGINE_PREDATES_BIKE_LINK_MESSAGE).toMatch(/restart the engine/i);
  });
});

describe('enabledEmptyMessage', () => {
  it('names the configured targets when present', () => {
    expect(enabledEmptyMessage(true, '10.1.1.50-10.1.1.60')).toMatch(/10\.1\.1\.50-10\.1\.1\.60/);
  });

  it('states plainly that nothing is configured when targets is empty', () => {
    expect(enabledEmptyMessage(false, '')).toMatch(/no scan targets/i);
  });
});

describe('disabledMessage', () => {
  it('names a known bike count when present, singular vs plural (noun AND verb)', () => {
    expect(disabledMessage(1)).toMatch(/1 previously-seen bike is running/);
    expect(disabledMessage(3)).toMatch(/3 previously-seen bikes are running/);
  });

  it('falls back to a plain statement when nothing is known yet', () => {
    expect(disabledMessage(0)).toBe('Bike color link is off. Bikes run their own colors.');
  });
});
