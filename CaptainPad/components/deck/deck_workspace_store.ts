/**
 * deck_workspace_store — the module-level, in-memory source of truth for the
 * deck workspace layout (contract: docs/53 §3.2, docs/63 §2.2).
 *
 * Deck and Mixer both mount `useDeckWorkspace()` while their tabs stay alive.
 * AsyncStorage alone cannot converge them — each hook instance would hold its
 * own React state and only re-read storage on mount. This store follows the
 * same subscription idiom as `usePerformanceMode`, `scroll_lock`, and
 * `spatial_fullscreen`: ONE layout snapshot, a Set of listeners, hydrate-once
 * from storage, and a single persist write per actual transition.
 *
 * ZERO react imports — vitest can exercise every decision here directly
 * (`deck_workspace_store.test.ts`). `deck_workspace.tsx`'s hook is a thin
 * `useSyncExternalStore` wrapper over this module.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  DECK_WORKSPACE_LAYOUT_KEY,
  DEFAULT_LAYOUT,
  layoutReducer,
  normalizeLayout,
  serializeLayout,
  type DeckWorkspaceLayout,
  type LayoutAction,
} from '@/components/deck/deck_workspace_layout';

export interface DeckWorkspaceStore {
  /** Stable reference until the closed set actually changes. */
  getLayout(): DeckWorkspaceLayout;
  /** Invalidation subscription for `useSyncExternalStore`. */
  subscribe(listener: () => void): () => void;
  dispatch(action: LayoutAction): void;
  /** Apply a raw AsyncStorage payload. Never persists. Idempotent. */
  hydrateFromStorageRaw(raw: string | null): void;
}

export function createDeckWorkspaceStore(
  onPersist: (layout: DeckWorkspaceLayout) => void,
): DeckWorkspaceStore {
  let layout: DeckWorkspaceLayout = DEFAULT_LAYOUT;
  let touched = false;
  let hydrated = false;
  const listeners = new Set<() => void>();

  function notify() {
    for (const listener of listeners) {
      try {
        listener();
      } catch {
        // A buggy subscriber must never break the broadcast pipeline.
      }
    }
  }

  function apply(next: DeckWorkspaceLayout, persist: boolean) {
    if (next === layout) return;
    layout = next;
    notify();
    if (persist) onPersist(next);
  }

  return {
    getLayout: () => layout,

    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },

    dispatch(action) {
      const next = layoutReducer(layout, action);
      if (next === layout) return;
      touched = true;
      apply(next, true);
    },

    hydrateFromStorageRaw(raw) {
      if (hydrated) return;
      hydrated = true;
      if (touched) return;
      if (raw == null) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch (err) {
        console.error('[Deck] workspace layout store is corrupt — using the default layout:', err);
        apply(normalizeLayout(null), false);
        return;
      }
      apply(normalizeLayout(parsed), false);
    },
  };
}

// ── Production singleton ───────────────────────────────────────────────────

let _singleton: DeckWorkspaceStore | null = null;
let _hydrateStarted = false;

function persistLayout(layout: DeckWorkspaceLayout) {
  AsyncStorage.setItem(
    DECK_WORKSPACE_LAYOUT_KEY,
    JSON.stringify(serializeLayout(layout)),
  ).catch((err) => {
    console.error('[Deck] workspace layout save failed:', err);
  });
}

/** The one store every `useDeckWorkspace()` consumer shares. */
export function getDeckWorkspaceStore(): DeckWorkspaceStore {
  if (!_singleton) {
    _singleton = createDeckWorkspaceStore(persistLayout);
  }
  if (!_hydrateStarted) {
    _hydrateStarted = true;
    AsyncStorage.getItem(DECK_WORKSPACE_LAYOUT_KEY)
      .then((raw) => _singleton!.hydrateFromStorageRaw(raw))
      .catch((err) => {
        console.error('[Deck] workspace layout read failed — using the default layout:', err);
        _singleton!.hydrateFromStorageRaw(null);
      });
  }
  return _singleton;
}

/** Test seam — never called by the app. */
export function __resetDeckWorkspaceStoreForTests(): void {
  _singleton = null;
  _hydrateStarted = false;
}
