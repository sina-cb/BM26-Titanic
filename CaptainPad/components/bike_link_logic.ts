/**
 * bike_link_logic — PURE state derivations for the BIKE COLOR LINK card
 * (config.tsx → BikeColorLinkCard). No React / react-native imports so
 * vitest can pin the logic in plain Node (same posture as
 * engine_settings_logic.ts / deck_tx_logic.ts).
 *
 * WHAT THE CARD SHOWS: whether the engine is currently pushing the show
 * palette out to BM26 bikes (MarsinLED controllers riding around camp), and
 * the live registry of bikes it has discovered. Every state the fetch can
 * land in gets an EXPLICIT panel state — codex P0 fail-loudly — so an old
 * engine build, a missing feature module, or zero discovered bikes each
 * read as their own honest sentence instead of collapsing into a blank list.
 *
 * SELF-REVERT SEMANTICS (the one fact every copy string near the toggle must
 * carry): while enabled, the engine pushes the active palette to every
 * LINKED bike every ~30 s under a 60 s firmware-held lease. The firmware
 * itself — not this app, not the engine — reverts a bike to its own colors
 * once two pushes are missed. So disabling the link (or the engine going
 * away) is a ~60 s FADE OUT, not an instant snap back, and there is no
 * "revert" request to send — the lease simply expires.
 */

import type {
  BikeLinkState,
  BikePushStats,
  BikeShareStats,
  BikeSnapshot,
  BikesSnapshot,
  FetchBikesResult,
} from '@/utils/api';

// ── Wire-shape re-exports ───────────────────────────────────────────────
// Re-exported from utils/api.ts (the single source of truth for the wire
// shape) so call sites that only need the logic don't also have to import
// the transport module.
export type {
  BikeLinkState,
  BikePushStats,
  BikeShareConfig,
  BikeShareStats,
  BikeSnapshot,
  BikesSnapshot,
  FetchBikesResult,
} from '@/utils/api';

// ── Sort order ───────────────────────────────────────────────────────────
// LINKED first (the bikes actually showing the palette right now), then the
// states an operator would want to triage in descending urgency, GONE last
// (about to be dropped from the registry entirely). Stable within a state by
// controllerId so the list doesn't visibly reshuffle between polls.
const STATE_SORT_ORDER: Record<BikeLinkState, number> = {
  LINKED: 0,
  DISCOVERED: 1,
  STALE: 2,
  UNSUPPORTED: 3,
  GONE: 4,
};

export function sortBikes(bikes: BikeSnapshot[]): BikeSnapshot[] {
  return [...bikes].sort((a, b) => {
    const orderDiff = STATE_SORT_ORDER[a.state] - STATE_SORT_ORDER[b.state];
    if (orderDiff !== 0) return orderDiff;
    return a.controllerId < b.controllerId ? -1 : a.controllerId > b.controllerId ? 1 : 0;
  });
}

// ── Visual role mapping ──────────────────────────────────────────────────
// Palette TOKEN ROLE names, not hex — the component resolves these against
// `usePalette()` so the card stays correct across all five themes. LINKED is
// the "working as intended" state (tertiary, the app's live/success accent);
// DISCOVERED is neutral-forward (primary, "seen, not yet confirmed
// supported"); STALE is a caution (warning); UNSUPPORTED is a hard stop
// (error — old firmware, no fallback write path, ever); GONE is deliberately
// dim (icon) — it is on its way out of the registry.
export type BikeVisualRole = 'primary' | 'tertiary' | 'warning' | 'error' | 'icon';

const STATE_VISUAL_ROLE: Record<BikeLinkState, BikeVisualRole> = {
  LINKED: 'tertiary',
  DISCOVERED: 'primary',
  STALE: 'warning',
  UNSUPPORTED: 'error',
  GONE: 'icon',
};

export function bikeVisualRole(state: BikeLinkState): BikeVisualRole {
  return STATE_VISUAL_ROLE[state];
}

// ── Panel state ────────────────────────────────────────────────────────
// One discriminated union covering every honest thing the card can show.
// `loading` only applies before the FIRST fetch resolves — after that, a
// failed poll keeps the last good state on screen (see BikeColorLinkCard)
// rather than falling back to `loading` or `unavailable`.
export type BikeLinkPanelState =
  | { kind: 'loading' }
  | { kind: 'engine_predates' }
  | { kind: 'unavailable'; message: string }
  | { kind: 'disabled'; knownBikeCount: number; targets: string }
  | { kind: 'enabled_empty'; targets: string; targetsConfigured: boolean }
  | { kind: 'list'; bikes: BikeSnapshot[]; targets: string; stats: BikeShareStats };

/**
 * Map a fetchBikes() result to the panel state the card renders.
 *
 * `previous` (optional) lets the card keep showing the last good `list` /
 * `disabled` / `enabled_empty` snapshot underneath an error row when a poll
 * fails, instead of collapsing to `unavailable` and hiding data the operator
 * could still act on. Pass it only for a FAILED result; the first call (no
 * previous state yet) has nothing to fall back to and returns the honest
 * `unavailable` / `engine_predates` state outright.
 */
export function derivePanelState(
  result: FetchBikesResult,
  previous?: BikeLinkPanelState,
): BikeLinkPanelState {
  if (result.ok) {
    const snapshot: BikesSnapshot = result.data;
    const targets = snapshot.config?.targets ?? '';
    if (!snapshot.enabled) {
      return { kind: 'disabled', knownBikeCount: snapshot.bikes.length, targets };
    }
    if (snapshot.bikes.length === 0) {
      return { kind: 'enabled_empty', targets, targetsConfigured: targets.trim().length > 0 };
    }
    return { kind: 'list', bikes: sortBikes(snapshot.bikes), targets, stats: snapshot.stats };
  }

  if (result.status === 404) {
    return { kind: 'engine_predates' };
  }

  // A failed poll with a usable previous snapshot keeps that snapshot's KIND
  // on screen (the card layers the error row on top) rather than discarding
  // real data because one poll hiccuped.
  if (previous && (previous.kind === 'list' || previous.kind === 'disabled' || previous.kind === 'enabled_empty')) {
    return previous;
  }

  const message = 'error' in result ? result.error : 'Bike color link unavailable';
  return { kind: 'unavailable', message };
}

// ── Formatters (pure — clock injected) ────────────────────────────────────

/** "42 s" / "—" for null or non-positive (already expired / unknown). */
export function formatLeaseRemaining(ms: number | null): string {
  if (ms === null || ms <= 0) return '—';
  return `${Math.round(ms / 1000)} s`;
}

/**
 * "3 s ago" / "2 m ago" / "1 h ago" / "—" for null. `nowMs` is injected (not
 * Date.now()) so this stays pure and the tests are deterministic. Negative
 * skew (epochMs slightly ahead of nowMs — the engine and iPad clocks are two
 * independent devices and will never be perfectly synced) clamps to 0 rather
 * than printing "-2 s ago", which would read as a bug.
 */
export function formatAge(nowMs: number, epochMs: number | null): string {
  if (epochMs === null) return '—';
  const deltaMs = Math.max(0, nowMs - epochMs);
  const seconds = Math.floor(deltaMs / 1000);
  if (seconds < 60) return `${seconds} s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours} h ago`;
}

/** "12 ok / 0 failed" — the compact per-bike push tally. */
export function formatPushStats(stats: BikePushStats): string {
  return `${stats.ok} ok / ${stats.failed} failed`;
}

// ── Target editor ───────────────────────────────────────────────────────

/**
 * Polls may refresh the draft only while the operator is not interacting
 * with it and has no unsaved text. This keeps server truth authoritative
 * without eating an in-progress edit every three seconds.
 */
export function reconcileTargetsDraft(
  currentDraft: string,
  serverTargets: string,
  isEditing: boolean,
  isDirty: boolean,
): string {
  return isEditing || isDirty ? currentDraft : serverTargets;
}

/** The first start must save targets and enable in ONE validated write. */
export function startBikeLinkPatch(targets: string): { enabled: true; targets: string } {
  return { enabled: true, targets: targets.trim() };
}

/** Updating live targets leaves the enabled state under engine ownership. */
export function saveBikeTargetsPatch(targets: string): { targets: string } {
  return { targets: targets.trim() };
}

// ── Operator-facing copy (pinned here, unit-testable, no drift into JSX) ──

/** Disable confirmation — must state plainly that this is not an instant
 *  revert: bikes fade back to their own colors over the firmware lease. */
export const DISABLE_BIKE_LINK_CONFIRM_TITLE = 'Disable bike color link?';
export const DISABLE_BIKE_LINK_CONFIRM_MESSAGE =
  'The engine will stop pushing the show palette to bikes. Each linked bike keeps its last-pushed '
  + 'colors until its firmware lease runs out, then reverts to its OWN colors on its own — about '
  + '60 seconds after the last push, with no revert traffic sent from here.';

/** Persistent hint shown near the enable/disable control — the same fact,
 *  short enough to sit under the pills at all times. */
export const BIKE_LINK_REVERT_HINT =
  'Disabling does not push a revert — each bike returns to its own colors on its own, '
  + 'about 60 seconds after its last push (firmware lease expiry).';

/** This engine build has no /bikes route at all (404, not 503) — the
 *  feature module was never wired up because the build predates it. */
export const ENGINE_PREDATES_BIKE_LINK_MESSAGE =
  'This engine build predates the bike link — restart the engine on the new build to see bikes here.';

/** Honest copy for the "enabled, zero bikes yet" state, distinguishing an
 *  empty target list (nothing configured to scan) from a configured-but-
 *  quiet scan (still discovering, or nothing answering yet). */
export function enabledEmptyMessage(targetsConfigured: boolean, targets: string): string {
  return targetsConfigured
    ? `Scanning ${targets} — no bikes found yet.`
    : 'Enabled, but no scan targets are configured — nothing to scan. Set targets to start discovery.';
}

/** Honest copy for the "disabled" state. */
export function disabledMessage(knownBikeCount: number): string {
  return knownBikeCount > 0
    ? `Bike color link is off. ${knownBikeCount} previously-seen bike${knownBikeCount === 1 ? ' is' : 's are'} `
      + 'running their own colors.'
    : 'Bike color link is off. Bikes run their own colors.';
}
