import { describe, expect, it } from 'vitest';

import {
  CAPTAINPAD_TAB_POLICIES,
  canMountCaptainPadRoute,
  captainPadRailRouteName,
  captainPadRouteHref,
  captainPadSubviewRoutes,
  captainPadTabPolicy,
  isCaptainPadRailTab,
  isCaptainPadTabVisible,
  performanceNavigationLocked,
} from './captainpad_tab_policy';

describe('CaptainPad tab policy', () => {
  it('exposes only Deck, Mixer, Live Touch and Events during global Performance', () => {
    // docs/52 §4: SPECIAL EVENTS joined the performance nav. Performance mode
    // freezes STRUCTURE; a special event IS the live set, and the operator has
    // to be able to reach the tab to arm one.
    const performanceRoutes = ['index', 'mixer', 'touch_control', 'special_events'];
    expect(performanceRoutes.every((route) => isCaptainPadTabVisible(route, true))).toBe(true);
    expect(Object.keys(CAPTAINPAD_TAB_POLICIES)
      .filter((route) => !performanceRoutes.includes(route))
      .every((route) => isCaptainPadTabVisible(route, true) === false)).toBe(true);
  });

  it('hides CONFIG and its sub-views while the show lock is on', () => {
    // Operator ruling 2026-08-16 (report `_283`), REVERSING `_250`: CONFIG is a
    // setup surface, not a performance surface, so it leaves the live-show rail.
    // `_250` had put it there as an escape hatch for a pad stranded on a locked
    // face — that hatch moved to the EXIT itself, which now works with the
    // engine offline (see performanceNavigationLocked below). The recovery path
    // is EXIT PERFORMANCE → edit → CONFIG, not CONFIG-during-the-show.
    for (const routeName of ['config', 'studio', 'midi', 'osc']) {
      expect(isCaptainPadTabVisible(routeName, true)).toBe(false);
      expect(canMountCaptainPadRoute(routeName, true)).toBe(false);
    }
    // The rail still only draws CONFIG — the sub-views remain parented.
    expect(isCaptainPadRailTab('config')).toBe(true);
    expect(['studio', 'midi', 'osc'].every((r) => isCaptainPadRailTab(r) === false)).toBe(true);
  });

  it('returns CONFIG and its sub-views to the rail in edit mode', () => {
    // The other half of the reversal: hiding CONFIG during a show is only
    // acceptable because edit mode still has it, one tap from the exit.
    for (const routeName of ['config', 'studio', 'midi', 'osc']) {
      expect(isCaptainPadTabVisible(routeName, false)).toBe(true);
      expect(canMountCaptainPadRoute(routeName, false)).toBe(true);
    }
  });

  it('still freezes the surfaces that are structural authoring, not diagnostics', () => {
    for (const routeName of ['audio', 'timeline', 'scheduler', 'dimmer_rack', 'simulation']) {
      expect(isCaptainPadTabVisible(routeName, true)).toBe(false);
    }
  });

  it('restores the complete edit navigation when global Performance is inactive', () => {
    expect(Object.keys(CAPTAINPAD_TAB_POLICIES)
      .every((route) => isCaptainPadTabVisible(route, false))).toBe(true);
  });

  it('does not register Audio Companion as a standalone route', () => {
    expect(() => captainPadTabPolicy('audio_companion')).toThrow('Missing CaptainPad tab policy');
  });

  it('blocks every non-performance deep route before it can mount', () => {
    expect(canMountCaptainPadRoute('audio', true)).toBe(false);
    expect(isCaptainPadTabVisible('simulation', true)).toBe(false);
    expect(canMountCaptainPadRoute('simulation', true)).toBe(false);
  });

  it('requires every registered route to declare an explicit policy', () => {
    expect(() => captainPadTabPolicy('unregistered')).toThrow('Missing CaptainPad tab policy');
    expect(Object.keys(CAPTAINPAD_TAB_POLICIES)).toHaveLength(13);
  });

  it('keeps STUDIO, MIDI and OSC off the sidebar rail as CONFIG sub-views', () => {
    // Operator ruling 2026-08-15: three setup surfaces were eating rail slots
    // they never earned. They stay REAL routes (mount/focus/deep-link
    // semantics unchanged — the header MIDI chip still pushes '/midi'); only
    // the rail entry moved into CONFIG.
    for (const routeName of ['studio', 'midi', 'osc']) {
      expect(isCaptainPadRailTab(routeName)).toBe(false);
      expect(captainPadRailRouteName(routeName)).toBe('config');
      expect(canMountCaptainPadRoute(routeName, false)).toBe(true);
    }
    expect(isCaptainPadRailTab('config')).toBe(true);
    expect(captainPadRailRouteName('config')).toBe('config');
  });

  it('lists the CONFIG sub-views in policy order with an icon and a summary', () => {
    const subviews = captainPadSubviewRoutes('config');
    expect(subviews.map((s) => s.routeName)).toEqual(['studio', 'midi', 'osc']);
    expect(subviews.map((s) => s.title)).toEqual(['Studio', 'MIDI', 'OSC']);
    expect(subviews.every((s) => s.tabBarIconName.length > 0)).toBe(true);
    expect(subviews.every((s) => s.summary.length > 0)).toBe(true);
    // Rail-level tabs own no sub-views unless the policy says so.
    expect(captainPadSubviewRoutes('mixer')).toEqual([]);
    expect(() => captainPadSubviewRoutes('nope')).toThrow('Missing CaptainPad tab policy');
  });

  it('never hides a performance-visible surface behind a performance-hidden parent', () => {
    // A sub-view is only as reachable as the tab it lives in: if the parent is
    // frozen out during a show, so is the child. Catching this in policy beats
    // discovering it at 2am on the playa.
    for (const [routeName, policy] of Object.entries(CAPTAINPAD_TAB_POLICIES)) {
      const parent = (policy as { parentRoute?: string }).parentRoute;
      if (!parent) continue;
      expect(policy.showInPerformance).toBe(captainPadTabPolicy(parent).showInPerformance);
    }
  });

  it('resolves route hrefs, with the tab-group root as /', () => {
    expect(captainPadRouteHref('index')).toBe('/');
    expect(captainPadRouteHref('midi')).toBe('/midi');
    expect(captainPadRouteHref('config')).toBe('/config');
    expect(() => captainPadRouteHref('nope')).toThrow('Missing CaptainPad tab policy');
  });

  it('registers SPECIAL EVENTS as a performance-visible Show surface', () => {
    const policy = captainPadTabPolicy('special_events');
    expect(policy).toEqual({
      title: 'Events',
      tabBarIconName: 'sparkles',
      tabBarGroup: 'Show',
      showInPerformance: true,
    });
    expect(canMountCaptainPadRoute('special_events', true)).toBe(true);
  });
});

describe('performanceNavigationLocked', () => {
  // The rule the sidebar rail and the deep-link guard BOTH compute. Hiding
  // CONFIG during a show (above) is only safe if the exit out of the show is
  // reachable with the engine dead — these pin that.

  it('is fail-closed online while the engine has not answered yet', () => {
    // A cold pad must not flash the edit navigation over a live show.
    expect(performanceNavigationLocked({
      ready: false, active: false, engineOffline: false,
    })).toBe(true);
  });

  it('follows the engine face online once it has answered', () => {
    expect(performanceNavigationLocked({
      ready: true, active: true, engineOffline: false,
    })).toBe(true);
    expect(performanceNavigationLocked({
      ready: true, active: false, engineOffline: false,
    })).toBe(false);
  });

  it('unlocks a pad that boots with the engine unreachable', () => {
    // THE regression this exists to prevent. Offline readiness never arrives on
    // its own, so fail-closed here is a permanent lock-out: the operator would
    // face a frozen rail with CONFIG hidden and no way to reach the address
    // card that fixes it. DEFAULT-OFF `active` means no show is known anywhere.
    expect(performanceNavigationLocked({
      ready: false, active: false, engineOffline: true,
    })).toBe(false);
    expect(canMountCaptainPadRoute('config', performanceNavigationLocked({
      ready: false, active: false, engineOffline: true,
    }))).toBe(true);
  });

  it('keeps the performance face offline until the operator leaves it', () => {
    // Engine died mid-show: the last-known face is still performance, so the
    // rail stays locked and CONFIG stays hidden — the operator has to EXIT.
    const held = performanceNavigationLocked({
      ready: false, active: true, engineOffline: true,
    });
    expect(held).toBe(true);
    expect(canMountCaptainPadRoute('config', held)).toBe(false);

    // ONE tap on the offline chip (setLocalPerformanceView(false)) and CONFIG
    // is reachable — no engine, no passcode, no request.
    const afterExit = performanceNavigationLocked({
      ready: true, active: false, engineOffline: true,
    });
    expect(afterExit).toBe(false);
    expect(canMountCaptainPadRoute('config', afterExit)).toBe(true);
  });
});
