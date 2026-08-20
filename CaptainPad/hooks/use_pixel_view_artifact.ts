/**
 * use_pixel_view_artifact — ONE fetch of the simulation's resolved pixel map,
 * shared by every surface that draws it (docs/58 §3.2).
 *
 * The deck's PIXELS window fetched the artifact per mount, which was correct
 * when there was exactly one such window. The mixer puts up to NINE pixel-view
 * bands on screen (8 channels + master), and nine mounts fetching the same
 * ~1 MB artifact — plus nine `/model/group-layout` probes — is nine times the
 * work for one identical answer.
 *
 * So the fetch lives here, module-cached: ONE in-flight promise per document,
 * shared by every consumer including the deck window. The artifact is
 * immutable for a session (it is a static export from the simulator), so a
 * cache with no invalidation is the honest shape.
 *
 * ── FAILURE IS NOT CACHED ───────────────────────────────────────────────────
 *
 * A rejected load clears the slot, so the next mount retries rather than
 * inheriting a dead promise forever (the simulator is frequently started
 * AFTER CaptainPad). Consumers still see the real error text — codex P0: the
 * band names its refusal, it never paints an empty ship and calls it fine.
 *
 * The engine pixel-count probe is separately cached and separately fallible:
 * it exists ONLY to power the stale-artifact guard, so a missing answer
 * disables that guard (null) and never takes down the picture, which comes
 * from a different service entirely.
 */
import { useEffect, useState } from 'react';

import { getApiBaseAsync } from '@/utils/api';
import { simulationOriginFromApiBase } from '@/utils/simulation_url';
import {
  PIXEL_VIEW_ARTIFACT_PATH,
  parsePixelViewArtifact,
  type PixelViewArtifact,
} from '@/components/deck/pixel_view_logic';

let _artifact: Promise<PixelViewArtifact> | null = null;
let _pixelCount: Promise<number | null> | null = null;

/** The shared artifact load. Every caller gets the same promise. */
export function loadPixelViewArtifact(): Promise<PixelViewArtifact> {
  if (_artifact) return _artifact;
  const pending = getApiBaseAsync().then(async (base: string) => {
    const origin = simulationOriginFromApiBase(base);
    const res = await fetch(`${origin}${PIXEL_VIEW_ARTIFACT_PATH}`);
    if (!res.ok) {
      throw new Error(
        `the simulation (${origin}) answered HTTP ${res.status} for its pixel map — `
        + 'is the simulator running?',
      );
    }
    return parsePixelViewArtifact(await res.json());
  });
  _artifact = pending;
  // Drop a FAILED load from the cache so a later mount can retry. The
  // `.catch` is on a derived promise, so it also keeps a rejection that
  // nobody happened to await from surfacing as an unhandled rejection.
  pending.catch(() => { if (_artifact === pending) _artifact = null; });
  return pending;
}

/**
 * The engine's model size, for the stale-artifact guard.
 *
 * `/model/group-layout` is the cheapest route that reports `pixelCount` (a
 * couple of dozen group records); `/model/pixel-layout` would be ~168 KB of
 * geometry the artifact already carries.
 */
export function loadEnginePixelCount(): Promise<number | null> {
  if (_pixelCount) return _pixelCount;
  const pending = getApiBaseAsync()
    .then((base: string) => fetch(`${base}/model/group-layout`))
    .then((res) => (res.ok ? res.json() : null))
    .then((data: { pixelCount?: unknown } | null) => {
      if (!data) return null;
      if (typeof data.pixelCount === 'number' && Number.isFinite(data.pixelCount)) {
        return data.pixelCount;
      }
      return null;
    })
    .catch(() => null);
  _pixelCount = pending;
  return pending;
}

export interface PixelViewArtifactState {
  artifact: PixelViewArtifact | null;
  /** null = the guard is disabled (engine did not answer), not "zero pixels". */
  enginePixelCount: number | null;
  /** The artifact load's error text, verbatim. */
  error: string | null;
}

/**
 * Subscribe to the shared artifact.
 *
 * `enabled` is the platform gate (the bands and the deck window only draw on
 * web): a disabled consumer never touches the network and never resolves.
 */
export function usePixelViewArtifact(enabled: boolean): PixelViewArtifactState {
  const [state, setState] = useState<PixelViewArtifactState>({
    artifact: null,
    enginePixelCount: null,
    error: null,
  });

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    loadPixelViewArtifact()
      .then((artifact) => {
        if (alive) setState((prev) => ({ ...prev, artifact, error: null }));
      })
      .catch((err: unknown) => {
        if (alive) {
          setState((prev) => ({
            ...prev,
            error: err instanceof Error ? err.message : String(err),
          }));
        }
      });
    loadEnginePixelCount().then((count) => {
      if (alive) setState((prev) => ({ ...prev, enginePixelCount: count }));
    });
    return () => { alive = false; };
  }, [enabled]);

  return state;
}

/** Test seam: forget both cached documents. */
export function resetPixelViewArtifactCache(): void {
  _artifact = null;
  _pixelCount = null;
}
