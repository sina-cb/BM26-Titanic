// use_master_fade — the in-flight grand-master fade descriptor, shared by the
// deck top bar (DeckTopBar) and the mixer header (app/(tabs)/mixer.tsx) so both
// surfaces read the SAME fade state and animate their master sliders the same
// way. Extracted from DeckTopBar (was deck-only) when the mixer gained the
// TO BLACK / UP affordance via the shared MasterFadeGroup — one source of fade
// truth, no duplicated subscription logic.
//
// This is NOT a new polling path: `mixer` / `deck` are push events the engine
// already broadcasts (docs/39 §8.2), and they carry `masterFade`. We only pull
// the one field useEngineState does not currently surface.

import { useEffect, useState } from 'react';
import { engineEvents, type EngineMessage } from '@/utils/engineEvents';

// In-flight fade descriptor, exactly as the engine reports it on the
// `mixer` / `deck` WS broadcasts. `null`/absent ⇒ idle.
export interface MasterFade {
  active: boolean;
  from: number;
  to: number;
  durationMs: number;
  elapsedMs: number;
  remainingMs: number;
}

/**
 * Subscribe to the control bus and surface the in-flight `masterFade`
 * descriptor (or null when steady).
 */
export function useMasterFade(): MasterFade | null {
  const [fade, setFade] = useState<MasterFade | null>(null);
  useEffect(() => {
    const onMessage = (msg: EngineMessage) => {
      if (msg.type !== 'mixer' && msg.type !== 'deck') return;
      const raw = (msg as unknown as { masterFade?: unknown }).masterFade;
      if (raw && typeof raw === 'object' && (raw as MasterFade).active === true) {
        setFade(raw as MasterFade);
      } else {
        // null / 'none' / absent ⇒ steady. Clear without churning the
        // reference when it's already idle (avoids needless re-render).
        setFade((prev) => (prev === null ? prev : null));
      }
    };
    const unsubscribe = engineEvents.subscribe(onMessage);
    return () => {
      // Buses return an unsubscribe fn; guard in case a legacy shim
      // returns void so we never throw on unmount.
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, []);
  return fade;
}
