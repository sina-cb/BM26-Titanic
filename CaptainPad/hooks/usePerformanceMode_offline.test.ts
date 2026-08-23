// Offline LOCAL VIEW OVERRIDE (report `_250`).
//
// Operator order: "even when engine is down, allow me to switch between edit
// and performance so I can check the config". The engine owns performance mode
// and the flip is an engine route, so with the control bus down the pad had no
// way off the boot-locked performance face (docs/56 D1) — exactly when CONFIG
// matters most.
//
// These tests pin the whole contract at the module boundary (vitest runs in
// plain Node, so the singleton's imperative reads stand in for the React
// hooks, same as usePerformanceMode.test.ts): the override exists ONLY while
// disconnected, it never touches engine state, it is discarded on reconnect
// and cannot be resurrected by a later disconnect, and it is refused outright
// while the engine is reachable.

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  canMountCaptainPadRoute,
  isCaptainPadTabVisible,
  performanceNavigationLocked,
} from '@/utils/captainpad_tab_policy';
import {
  DEFAULT_LAYOUT,
  effectiveOpenWindows,
} from '@/components/deck/deck_workspace_layout';
import { resolveLocalViewOverride } from '@/components/performance_mode_logic';

const statusListeners: ((s: { connected: boolean }) => void)[] = [];

vi.mock('@/utils/engineEvents', () => ({
  engineEvents: {
    subscribe: () => () => undefined,
    subscribeStatus: (listener: (s: { connected: boolean }) => void) => {
      // The real bus calls a new listener immediately with its current status,
      // which starts disconnected. Mirror that or the module would never learn
      // it is offline.
      listener({ connected: false });
      statusListeners.push(listener);
      return () => undefined;
    },
  },
}));

vi.mock('@/utils/api', () => ({
  // No REST seed in these tests: every engine fact arrives through
  // applyPerformanceModeResponse so the sequencing is explicit.
  fetchPerformanceMode: async () => ({ ok: false }),
}));

vi.mock('@/hooks/use_captainpad_access', () => ({
  useCaptainPadAccess: () => ({ session: null, loading: false }),
}));

import {
  applyPerformanceModeResponse,
  getPerformanceModeState,
  getPerformanceModeView,
  isPerformanceModeReady,
  setLocalPerformanceView,
} from './usePerformanceMode';

const ENTERED_AT = '2026-08-15T04:12:00.000Z';

function emitStatus(connected: boolean) {
  statusListeners.forEach((l) => l({ connected }));
}

/** Put the singleton in a known ONLINE state with the engine's answer applied. */
function connectedWithEngineFace(active: boolean) {
  emitStatus(true);
  applyPerformanceModeResponse({
    active,
    enteredAt: active ? ENTERED_AT : null,
    dirtyCount: 0,
    dirtyEntries: [],
  });
}

/**
 * The REAL navigation rule `app/(tabs)/_layout.tsx` and
 * `performance_route_guard.tsx` compute, fed from the live singleton. Calling
 * the shared helper (rather than re-typing its expression here) is the point:
 * these tests fail if the rule and its consumers ever drift apart.
 */
function navLocked(): boolean {
  const view = getPerformanceModeView();
  return performanceNavigationLocked({
    ready: isPerformanceModeReady(),
    active: view.active,
    engineOffline: view.engineOffline,
  });
}

describe('resolveLocalViewOverride', () => {
  it('presents the engine answer whenever the bus is connected', () => {
    // The reconnect guarantee in one line: a connected bus ignores the
    // override no matter what it holds.
    expect(resolveLocalViewOverride(true, true, false))
      .toEqual({ active: true, localOverride: false });
    expect(resolveLocalViewOverride(false, true, true))
      .toEqual({ active: false, localOverride: false });
  });

  it('presents the local pick only while disconnected AND a pick exists', () => {
    expect(resolveLocalViewOverride(true, false, null))
      .toEqual({ active: true, localOverride: false });
    expect(resolveLocalViewOverride(true, false, false))
      .toEqual({ active: false, localOverride: true });
    expect(resolveLocalViewOverride(false, false, true))
      .toEqual({ active: true, localOverride: true });
  });
});

describe('offline local view override', () => {
  beforeEach(() => {
    // Every test starts online, with the engine reporting a live show — the
    // boot-locked face the operator gets stranded on.
    connectedWithEngineFace(true);
  });

  it('leaves the pad on the engine face when the bus drops and nothing is picked', () => {
    emitStatus(false);

    expect(getPerformanceModeView()).toMatchObject({
      active: true,
      localOverride: false,
      engineOffline: true,
    });
    // Unchanged from before `_250`: no engine answer on this connection and no
    // local pick means no definite answer, and the tab policy keeps the
    // performance nav — never a guess in the operator's favour.
    expect(isPerformanceModeReady()).toBe(false);
  });

  it('switches this pad to the edit view offline, without touching engine state', () => {
    emitStatus(false);
    setLocalPerformanceView(false);

    expect(getPerformanceModeView()).toMatchObject({
      active: false,
      localOverride: true,
      engineOffline: true,
    });
    // A local pick IS a definite answer — this is what unlocks the tab policy
    // and the route guard so CONFIG can mount.
    expect(isPerformanceModeReady()).toBe(true);
    // The engine's own state is untouched: nothing was sent, nothing merged.
    expect(getPerformanceModeState()).toMatchObject({ active: true, enteredAt: ENTERED_AT });
  });

  it('switches back to the performance face offline (the toggle goes both ways)', () => {
    emitStatus(false);
    setLocalPerformanceView(false);
    setLocalPerformanceView(true);

    expect(getPerformanceModeView()).toMatchObject({ active: true, localOverride: true });
  });

  it('can present the performance face offline even when the engine last said edit', () => {
    connectedWithEngineFace(false);
    emitStatus(false);
    setLocalPerformanceView(true);

    expect(getPerformanceModeView()).toMatchObject({ active: true, localOverride: true });
    expect(getPerformanceModeState().active).toBe(false);
  });

  it('discards the override the instant the bus reconnects', () => {
    emitStatus(false);
    setLocalPerformanceView(false);
    expect(getPerformanceModeView().active).toBe(false);

    emitStatus(true);

    // The engine broadcast is authoritative again — the local pick is gone,
    // not merged, and the passcode-gated flow owns the mode once more.
    expect(getPerformanceModeView()).toMatchObject({
      active: true,
      localOverride: false,
      engineOffline: false,
    });
  });

  it('does not resurrect a discarded override on a LATER disconnect', () => {
    emitStatus(false);
    setLocalPerformanceView(false);
    emitStatus(true);
    emitStatus(false);

    expect(getPerformanceModeView()).toMatchObject({
      active: true,
      localOverride: false,
      engineOffline: true,
    });
  });

  it('refuses a local flip while the engine is reachable', () => {
    // Codex P0 — no fallbacks, and no client-side lie about a globally shared
    // lock: with a live engine the only way to change mode is the gated POST.
    expect(() => setLocalPerformanceView(false)).toThrow(/engine is connected/);
    expect(getPerformanceModeView()).toMatchObject({ active: true, localOverride: false });
  });

  it('keeps the online view byte-identical to the engine answer', () => {
    expect(getPerformanceModeView()).toMatchObject({
      active: true,
      enteredAt: ENTERED_AT,
      localOverride: false,
      engineOffline: false,
    });

    applyPerformanceModeResponse({ active: false, enteredAt: null, dirtyCount: 0, dirtyEntries: [] });
    expect(getPerformanceModeView()).toMatchObject({
      active: false,
      enteredAt: null,
      localOverride: false,
      engineOffline: false,
    });
  });
});

describe('consumers of the effective performance face', () => {
  beforeEach(() => {
    connectedWithEngineFace(true);
  });

  it('reaches CONFIG offline once the operator takes the local edit view', () => {
    emitStatus(false);

    // Before the pick the engine's last-known face was PERFORMANCE, so the nav
    // stays locked and CONFIG is hidden (report `_283` reversed `_250`: CONFIG
    // is no longer on the performance surface).
    expect(navLocked()).toBe(true);
    expect(canMountCaptainPadRoute('config', navLocked())).toBe(false);

    // The offline exit: ONE tap, no engine, no request, no passcode.
    setLocalPerformanceView(false);

    expect(navLocked()).toBe(false);
    expect(canMountCaptainPadRoute('config', navLocked())).toBe(true);
    expect(canMountCaptainPadRoute('timeline', navLocked())).toBe(true);
    expect(isCaptainPadTabVisible('audio', navLocked())).toBe(true);
  });

  it('gives the deck workspace back its performance-hidden windows offline', () => {
    // The _217 deck overlay reads `usePerformanceMode().active` raw for screen
    // composition, so the offline pick has to move it too.
    emitStatus(false);
    const hidden = effectiveOpenWindows(DEFAULT_LAYOUT, getPerformanceModeView().active);

    setLocalPerformanceView(false);
    const shown = effectiveOpenWindows(DEFAULT_LAYOUT, getPerformanceModeView().active);

    expect(shown.length).toBeGreaterThan(hidden.length);
    expect(hidden.every((id) => shown.includes(id))).toBe(true);
  });

  it('still renders the performance face offline when the operator picks it', () => {
    emitStatus(false);
    setLocalPerformanceView(true);

    expect(navLocked()).toBe(true);
    // CONFIG remains hidden. Timeline is intentionally still reachable as the
    // show-status surface; its mutations are locked while Performance is live.
    expect(canMountCaptainPadRoute('config', navLocked())).toBe(false);
    expect(canMountCaptainPadRoute('timeline', navLocked())).toBe(true);
  });

  it('gives a pad that never reached an engine its full navigation', () => {
    // Cold boot pointed at a dead address: no engine answer ever arrives, so
    // readiness never resolves on its own. Fail-closed here would be permanent,
    // and CONFIG — the surface that repoints the pad — would be unreachable.
    // This is the recovery `_283` depends on, and it costs ZERO taps.
    //
    // Cold boot = the engine face is DEFAULT-OFF and nothing has resolved. The
    // connect clears any override and applies `active:false`; the drop then
    // un-resolves readiness, leaving exactly the state a pad reaches when its
    // configured address never answers.
    connectedWithEngineFace(false);
    emitStatus(false);

    expect(isPerformanceModeReady()).toBe(false);
    expect(getPerformanceModeView()).toMatchObject({
      active: false, localOverride: false, engineOffline: true,
    });
    expect(navLocked()).toBe(false);
    expect(canMountCaptainPadRoute('config', navLocked())).toBe(true);
  });
});
