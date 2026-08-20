/**
 * pixel_view_band_store — the AsyncStorage side of the pixel band's per-band
 * view choice (docs/64_mixer_relayout.md §7 D7: "Persist band view choice
 * too? — YES, fold it into a store" — resolved here without touching
 * `mixer_workspace_layout.ts`'s pinned three-action shape, see the header of
 * `pixel_view_band_logic.ts`'s session-store section for the full reasoning).
 *
 * `pixel_view_band_logic.ts` stays React/RN-free on purpose (its own file
 * header, and `use_mixer_workspace.ts`'s file header for the house
 * precedent) so vitest can drive its session store in plain Node. This file
 * is the seam that gives that pure store real persistence: it is imported
 * ONLY by component code (`pixel_view_band.tsx`) — never by the pure module,
 * never by a test.
 *
 * Hydrate-once, write-on-real-change-only — the same discipline
 * `use_mixer_workspace.ts` uses for the workspace layout store. A corrupt or
 * unreadable stored blob resets loudly to defaults (console.error) rather
 * than crashing the mixer over a view-choice cookie: this is a view
 * preference, not rig state, same reasoning as that file's own hydrate.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  BAND_VIEW_STORAGE_KEY,
  hydrateBandSessions,
  serializeBandSessions,
  setBandSessionPersistListener,
} from '@/components/mixer/pixel_view_band_logic';

let started = false;

function persistNow(): void {
  AsyncStorage.setItem(
    BAND_VIEW_STORAGE_KEY,
    JSON.stringify(serializeBandSessions()),
  ).catch((err) => {
    // The in-memory store stays authoritative for this session.
    console.error('[Mixer] band view save failed:', err);
  });
}

/**
 * Wires the persist listener and kicks off the one-time hydrate read.
 * Idempotent — every `PixelViewBand` instance calls this on mount (there can
 * be up to nine on screen at once, docs/58) but only the first call does
 * anything, since there is no single app-startup site to call this from
 * instead (D7's mechanism note: no `mixer.tsx` change).
 */
export function initBandSessionPersistence(): void {
  if (started) return;
  started = true;

  setBandSessionPersistListener(persistNow);

  AsyncStorage.getItem(BAND_VIEW_STORAGE_KEY).then((raw) => {
    let parsed: unknown = null;
    if (raw != null) {
      try {
        parsed = JSON.parse(raw);
      } catch (err) {
        console.error('[Mixer] band view store is corrupt — using defaults:', err);
        parsed = null;
      }
    }
    hydrateBandSessions(parsed);
  }).catch((err) => {
    console.error('[Mixer] band view read failed — using defaults:', err);
  });
}
