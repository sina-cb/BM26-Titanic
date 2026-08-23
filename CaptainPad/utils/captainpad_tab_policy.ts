import type { IconSymbolName } from '@/components/ui/icon-symbol';

export interface CaptainPadTabPolicy {
  title: string;
  tabBarIconName: IconSymbolName;
  tabBarGroup?: string;
  showInPerformance: boolean;
  /**
   * Route this surface lives INSIDE (operator ruling 2026-08-15). A parented
   * route is still a REAL route — same mount/focus/deep-link semantics, so
   * `router.push('/midi')` from the header chip keeps working — it is simply
   * not drawn in the sidebar rail; the parent tab's pill stays highlighted
   * while it is on screen and the surface carries a back-to-parent frame.
   * Rail real estate is the scarce resource; STUDIO / MIDI / OSC are
   * setup surfaces, not performance surfaces.
   */
  parentRoute?: string;
  /** One-line description on the parent's entry card. Required when parented. */
  subviewSummary?: string;
}

export const CAPTAINPAD_TAB_POLICIES = Object.freeze({
  index: { title: 'Deck', tabBarIconName: 'slider.vertical.3', tabBarGroup: 'Layers', showInPerformance: true },
  mixer: { title: 'Mixer', tabBarIconName: 'slider.horizontal.3', tabBarGroup: 'Layers', showInPerformance: true },
  touch_control: { title: 'Live Touch', tabBarIconName: 'square.grid.2x2', tabBarGroup: 'Layers', showInPerformance: true },
  // SPECIAL EVENTS (docs/52 §4). `showInPerformance: true` on purpose:
  // performance mode exists to freeze STRUCTURE during a live set, and a
  // special event IS the live set. Shows are read-only data authored
  // off-playa; every button on that tab is a performance action, and you must
  // be able to reach the tab to arm one. The engine likewise does not
  // performance-gate `/special-events/*`.
  special_events: { title: 'Events', tabBarIconName: 'sparkles', tabBarGroup: 'Show', showInPerformance: true },
  audio: { title: 'Audio', tabBarIconName: 'waveform', showInPerformance: false },
  timeline: { title: 'Timeline', tabBarIconName: 'sun.max', showInPerformance: false },
  scheduler: { title: 'Scheduler', tabBarIconName: 'calendar.badge.clock', showInPerformance: false },
  dimmer_rack: { title: 'Dimmer Rack', tabBarIconName: 'lightbulb.fill', showInPerformance: false },
  // CONFIG SUB-VIEWS (operator ruling 2026-08-15). Three setup surfaces that
  // used to own a rail slot each and were almost never opened during a show.
  // They keep their routes — only the rail entry moves; CONFIG lists them as
  // separate cards, in THIS declaration order.
  //
  // `showInPerformance: false` on all four (CONFIG + its sub-views) — operator
  // ruling 2026-08-16, report `_283`. This REVERSES report `_250`, which had
  // set them true so a pad stranded on a locked face could still reach the
  // engine-address card. That escape hatch was the right fix for the wrong
  // door: it put a setup surface on the live-show rail permanently, for a
  // failure mode that only ever happens with the engine unreachable.
  //
  // The escape hatch moves to where it belongs — the EXIT itself. Leaving
  // performance mode now works with the engine fully offline (the `_250` local
  // view override, plus the navigation rule in performanceNavigationLocked()
  // below), so the recovery path is: perf mode → EXIT PERFORMANCE → edit mode
  // → CONFIG → point the pad at a live engine. CONFIG is a setup surface, not
  // a performance surface, and during a show the rail should carry only what
  // the operator plays with.
  //
  // The sub-views flip WITH their parent so the "a sub-view is exactly as
  // reachable as its parent" invariant stays true and meaningful.
  studio: {
    title: 'Studio',
    tabBarIconName: 'curlybraces',
    showInPerformance: false,
    parentRoute: 'config',
    subviewSummary: 'Pattern code editor — browse, edit and compile pattern files on the engine.',
  },
  midi: {
    title: 'MIDI',
    tabBarIconName: 'metronome',
    showInPerformance: false,
    parentRoute: 'config',
    subviewSummary: 'Controller status, live event monitor and the per-tab mapping profile.',
  },
  osc: {
    title: 'OSC',
    tabBarIconName: 'antenna.radiowaves.left.and.right',
    showInPerformance: false,
    parentRoute: 'config',
    subviewSummary: 'OSC listener — enable, port/host, allowed senders and live metrics.',
  },
  bike_link: {
    title: 'Bike Link',
    tabBarIconName: 'network',
    showInPerformance: false,
    parentRoute: 'config',
    subviewSummary: 'Targets, link lifecycle and per-bike palette lease health.',
  },
  config: { title: 'Config', tabBarIconName: 'gear', showInPerformance: false },
  simulation: { title: '2D Simulator', tabBarIconName: 'square.grid.2x2', tabBarGroup: 'Tools', showInPerformance: false },
} satisfies Record<string, CaptainPadTabPolicy>);

export type CaptainPadRouteName = keyof typeof CAPTAINPAD_TAB_POLICIES;

export function captainPadTabPolicy(routeName: string): CaptainPadTabPolicy {
  const policy = CAPTAINPAD_TAB_POLICIES[routeName as CaptainPadRouteName];
  if (!policy) throw new Error(`Missing CaptainPad tab policy for route: ${routeName}`);
  return policy;
}

export function captainPadTabOptions(routeName: string) {
  const { title, tabBarIconName, tabBarGroup } = captainPadTabPolicy(routeName);
  return { title, tabBarIconName, tabBarGroup };
}

export function isCaptainPadTabVisible(routeName: string, globalPerformanceActive: boolean): boolean {
  const policy = captainPadTabPolicy(routeName);
  return !globalPerformanceActive || policy.showInPerformance;
}

/** What the navigation lock is computed from. */
export interface PerformanceNavigationState {
  /** `usePerformanceModeReady()` — this pad has a definite answer to render. */
  ready: boolean;
  /** `usePerformanceMode().active` — the EFFECTIVE, override-aware face. */
  active: boolean;
  /** `usePerformanceMode().engineOffline` — the /ws/control bus is down. */
  engineOffline: boolean;
}

/**
 * Should navigation be restricted to the performance surfaces right now?
 *
 * ONE rule, shared by the sidebar rail (`app/(tabs)/_layout.tsx`) and the deep-
 * link guard (`components/performance_route_guard.tsx`) so the two can never
 * disagree about which tabs exist.
 *
 * ONLINE — unchanged, and deliberately fail-closed: an unanswered engine counts
 * as locked, so a cold pad never flashes the edit navigation over a live show
 * in the milliseconds before the first `GET /performance-mode` lands.
 *
 * OFFLINE — the presented face IS the answer, and `ready` is ignored (operator
 * ruling 2026-08-16, report `_283`). Fail-closed is only honest when the answer
 * is on its way: with the bus down, readiness NEVER arrives on its own
 * (`usePerformanceMode` resolves offline only once the operator takes a local
 * view), so treating not-ready as locked is not caution, it is a permanent
 * lock-out. That trapped the exact recovery this reversal depends on — a pad
 * that boots pointed at a dead engine reports `active: false` (the DEFAULT-OFF
 * state, no show anywhere) yet had its whole rail frozen and CONFIG hidden,
 * with no way to reach the address card that would fix it.
 *
 * This is presentation only, and it loosens NO gate: with the engine
 * unreachable there is no request to gate, every real gate is enforced
 * engine-side per request (docs/56 D2/D3/D6), and the moment the bus
 * reconnects the engine's broadcast wins outright (`_250`). It is also not a
 * silent fallback — the mode chip carries a standing `ENGINE OFFLINE` caption
 * the whole time, so the pad says exactly what it is doing.
 */
export function performanceNavigationLocked(
  { ready, active, engineOffline }: PerformanceNavigationState,
): boolean {
  if (engineOffline) return active;
  return !ready || active;
}

export function canMountCaptainPadRoute(routeName: string, globalPerformanceActive: boolean): boolean {
  return isCaptainPadTabVisible(routeName, globalPerformanceActive);
}

/** True for routes that own a slot in the sidebar rail (i.e. not parented). */
export function isCaptainPadRailTab(routeName: string): boolean {
  return captainPadTabPolicy(routeName).parentRoute === undefined;
}

/**
 * Which rail pill lights up while `routeName` is on screen. A sub-view lights
 * its parent — otherwise opening MIDI from CONFIG would leave the whole rail
 * dark and the operator with no "where am I".
 */
export function captainPadRailRouteName(routeName: string): string {
  const parent = captainPadTabPolicy(routeName).parentRoute;
  if (parent === undefined) return routeName;
  // A parent must itself be a registered, rail-level route: no chains.
  if (!isCaptainPadRailTab(parent)) {
    throw new Error(`CaptainPad sub-view ${routeName} points at non-rail parent: ${parent}`);
  }
  return parent;
}

export interface CaptainPadSubview {
  routeName: string;
  title: string;
  tabBarIconName: IconSymbolName;
  summary: string;
}

/** The sub-views a parent tab must list, in policy declaration order. */
export function captainPadSubviewRoutes(parentRoute: string): CaptainPadSubview[] {
  captainPadTabPolicy(parentRoute); // parent must be a registered route
  const entries = Object.entries(CAPTAINPAD_TAB_POLICIES) as [string, CaptainPadTabPolicy][];
  return entries
    .filter(([, policy]) => policy.parentRoute === parentRoute)
    .map(([routeName, policy]) => {
      if (!policy.subviewSummary) {
        throw new Error(`CaptainPad sub-view ${routeName} is missing subviewSummary`);
      }
      return {
        routeName,
        title: policy.title,
        tabBarIconName: policy.tabBarIconName,
        summary: policy.subviewSummary,
      };
    });
}

/** Expo-router path for a registered route ('index' is the tab group root). */
export function captainPadRouteHref(routeName: string): string {
  captainPadTabPolicy(routeName);
  return routeName === 'index' ? '/' : `/${routeName}`;
}
