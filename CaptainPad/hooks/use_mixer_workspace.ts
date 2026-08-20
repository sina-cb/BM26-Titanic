/**
 * use_mixer_workspace — the AsyncStorage-backed controller hook over the
 * mixer's pure workspace store (contract: docs/64_mixer_relayout.md §2,
 * §2.2, §2.3; W3b of the mixer relayout wave). Modelled on the deck's
 * equivalent (`useDeckWorkspace`, `components/deck/deck_workspace.tsx`):
 * same hydrate-once discipline, same write-on-change discipline (the
 * reducer's same-reference no-op IS the persistence gate), same "a live
 * operator gesture beats a slow hydrate" rule.
 *
 * One structural difference from the deck, and the reason the actual
 * decision-making below is factored OUT of the React hook into
 * `createMixerWorkspaceEngine` (a plain closure, zero React imports): this
 * repo's vitest config (`vitest.config.ts`) only discovers `hooks/**\/*.test.ts`
 * and `components/**\/*.test.ts` — there is no React renderer in devDependencies
 * (no `react-test-renderer`, no `@testing-library/react-*`), so a hook that
 * lives entirely inside `useState`/`useEffect` closures cannot be exercised by
 * this suite (exactly why `deck_workspace.tsx`'s `useDeckWorkspace` itself has
 * no direct test — only its pure `deck_workspace_layout.ts` does).
 * `usePerformanceMode.ts` sets the house precedent for the fix: split a hook's
 * DECISIONS into a plain, non-React engine that a plain vitest file can drive
 * directly, and make the `useX()` hook a thin, largely mechanical wrapper
 * around it. `use_mixer_workspace.test.ts` exercises `createMixerWorkspaceEngine`
 * exhaustively; this file's own hook body is exactly that thin.
 *
 * ── The roster race, and why `commit()` can defer itself ───────────────────
 * `commit(roster, confirmed)` is not a user gesture — it fires automatically
 * off every confirmed mixer broadcast, so (unlike open/close/reset) it must
 * NEVER be allowed to persist a "fresh defaults" layout over the operator's
 * real stored preferences just because it happened to run before the
 * AsyncStorage read resolved. So a `commit()` that arrives before hydrate
 * lands only updates the tracked roster (so `close()`'s floor check has the
 * best available answer immediately) and stashes itself; hydrate applies the
 * stash, if any, AFTER normalizing the real stored value, never before.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  MIXER_WORKSPACE_LAYOUT_KEY,
  commitRoster,
  initialLayout,
  layoutReducer,
  normalizeLayout,
  serializeLayout,
  type MixerChannelId,
  type MixerSurfaceId,
  type MixerWorkspaceLayout,
} from '@/components/mixer/mixer_workspace_layout';

// ── The pure engine (no React) ──────────────────────────────────────────

export interface MixerWorkspaceEngine {
  getLayout(): MixerWorkspaceLayout;
  /** Applies a hydrated AsyncStorage value. Idempotent past the first call
   *  (hydrate-ONCE) and a no-op for the normalize step once a live gesture
   *  has touched the engine — but a `commit()` that arrived before this call
   *  is still replayed against the resulting base either way (see the file
   *  header). Never persists: hydrate reads, it never writes. */
  hydrate(raw: unknown): void;
  open(id: MixerSurfaceId): void;
  close(id: MixerSurfaceId): void;
  reset(): void;
  /** roster/confirmed semantics are exactly `commitRoster`'s (docs/64 §2.3):
   *  an unconfirmed roster never prunes. The tracked roster updates
   *  unconditionally (needed for `close()`'s floor check even pre-hydrate,
   *  pre-confirmation), independent of whether the store itself changes. */
  commit(roster: readonly MixerChannelId[], confirmed: boolean): void;
}

/**
 * `onChange` fires with the new layout on every actual state transition
 * (drives the React re-render); `onPersist` fires ONLY when that transition
 * should be written to storage — the two are separate parameters (rather than
 * one "did it change" callback) because hydrate and a pre-hydrate `commit`
 * both need `onChange` semantics without ever triggering `onPersist`.
 */
export function createMixerWorkspaceEngine(
  onChange: (layout: MixerWorkspaceLayout) => void,
  onPersist: (layout: MixerWorkspaceLayout, roster: readonly MixerChannelId[]) => void,
): MixerWorkspaceEngine {
  let layout: MixerWorkspaceLayout = initialLayout([]);
  let roster: readonly MixerChannelId[] = [];
  let touched = false;
  let hydrated = false;
  let pendingCommit: { roster: readonly MixerChannelId[]; confirmed: boolean } | null = null;

  // THE WRITE GATE: `layoutReducer`/`commitRoster` both return the SAME
  // reference for a no-op (docs/64 §2 — the reducer's own documented
  // discipline), so `next === layout` is the one and only "did anything
  // change" check. Nothing downstream re-derives it.
  function apply(next: MixerWorkspaceLayout, persist: boolean) {
    if (next === layout) return;
    layout = next;
    onChange(layout);
    if (persist) onPersist(layout, roster);
  }

  function applyCommit(nextRoster: readonly MixerChannelId[], confirmed: boolean) {
    roster = nextRoster;
    apply(commitRoster(layout, nextRoster, confirmed), true);
  }

  return {
    getLayout: () => layout,

    hydrate(raw) {
      if (hydrated) return;
      hydrated = true;
      // If the operator already touched the workspace (hid/showed/reset
      // something) before this async read landed, their live action wins —
      // the stored preference must never overwrite a live intent (same rule
      // as the deck's `useDeckWorkspace`). We still never write here either
      // way: hydrate only ever reads.
      if (!touched) apply(normalizeLayout(raw, roster), false);
      // Replay a `commit` that arrived before hydrate — against the just-
      // hydrated (or gesture-touched) base, never against the pre-hydrate
      // `initialLayout([])` default. See the file header.
      if (pendingCommit) {
        const p = pendingCommit;
        pendingCommit = null;
        applyCommit(p.roster, p.confirmed);
      }
    },

    open(id) {
      touched = true;
      apply(layoutReducer(layout, { type: 'open', id }), true);
    },
    close(id) {
      touched = true;
      apply(layoutReducer(layout, { type: 'close', id, roster }), true);
    },
    reset() {
      touched = true;
      apply(layoutReducer(layout, { type: 'reset' }), true);
    },
    commit(nextRoster, confirmed) {
      if (!hydrated) {
        roster = nextRoster;
        pendingCommit = { roster: nextRoster, confirmed };
        return;
      }
      applyCommit(nextRoster, confirmed);
    },
  };
}

// ── The hook ─────────────────────────────────────────────────────────────

export interface MixerWorkspaceController {
  /** The live persisted layout. Untouched by the performance overlay in
   *  either direction — perf composes OUTSIDE this hook, purely derived
   *  (docs/64 §2.6), via `effectiveSectionShown`/`effectiveCitizenShown`
   *  from `mixer_workspace_layout.ts` applied directly to this `layout` by
   *  the caller. This hook has no notion of performance mode at all — it
   *  cannot write from a perf transition because it never hears about one. */
  layout: MixerWorkspaceLayout;
  open: (id: MixerSurfaceId) => void;
  /** No roster parameter — the hook tracks the latest roster itself via
   *  `commit()` and uses it for the floor check (docs/64 §2 D1). */
  close: (id: MixerSurfaceId) => void;
  reset: () => void;
  /** Call exactly once per CONFIRMED mixer broadcast (connected + mixer doc
   *  received), passing the full channel-id roster in canonical order.
   *  `confirmed=false` (boot/reconnect snapshot) never prunes — see
   *  `commitRoster` in `mixer_workspace_layout.ts`. No timers: nothing here
   *  self-prunes without a caller-supplied broadcast. */
  commit: (roster: readonly MixerChannelId[], confirmed: boolean) => void;
}

/**
 * Layout state + persistence. Hydrates once on mount; every transition that
 * actually changes the layout writes the new store back fire-and-forget
 * (AsyncStorage key `MIXER_WORKSPACE_LAYOUT_KEY`). A corrupt stored
 * PREFERENCE resets loudly to the default (console.error) — this is a view
 * preference, not engine state, and refusing to render the mixer over a
 * stale layout cookie would invert the mission priority (same reasoning as
 * `useDeckWorkspace`, docs/53 §3.2).
 */
export function useMixerWorkspace(): MixerWorkspaceController {
  const [layout, setLayout] = useState<MixerWorkspaceLayout>(() => initialLayout([]));

  // Stable across the hook's lifetime (empty deps) — created once and handed
  // to the lazily-constructed engine below, so the engine's `onPersist`
  // closure never goes stale.
  const persist = useCallback((next: MixerWorkspaceLayout, roster: readonly MixerChannelId[]) => {
    AsyncStorage.setItem(
      MIXER_WORKSPACE_LAYOUT_KEY,
      JSON.stringify(serializeLayout(next, roster)),
    ).catch((err) => {
      // The in-memory layout stays authoritative for this session.
      console.error('[Mixer] workspace layout save failed:', err);
    });
  }, []);

  const engineRef = useRef<MixerWorkspaceEngine | null>(null);
  if (!engineRef.current) {
    engineRef.current = createMixerWorkspaceEngine(setLayout, persist);
  }
  const engine = engineRef.current;

  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(MIXER_WORKSPACE_LAYOUT_KEY).then((raw) => {
      if (!alive) return;
      let parsed: unknown = null;
      if (raw != null) {
        try {
          parsed = JSON.parse(raw);
        } catch (err) {
          console.error('[Mixer] workspace layout store is corrupt — using the default layout:', err);
          parsed = null;
        }
      }
      engine.hydrate(parsed);
    }).catch((err) => {
      console.error('[Mixer] workspace layout read failed — using the default layout:', err);
    });
    return () => { alive = false; };
  }, [engine]);

  const open = useCallback((id: MixerSurfaceId) => engine.open(id), [engine]);
  const close = useCallback((id: MixerSurfaceId) => engine.close(id), [engine]);
  const reset = useCallback(() => engine.reset(), [engine]);
  const commit = useCallback(
    (roster: readonly MixerChannelId[], confirmed: boolean) => engine.commit(roster, confirmed),
    [engine],
  );

  return { layout, open, close, reset, commit };
}

export type { MixerChannelId, MixerSurfaceId, MixerWorkspaceLayout };
