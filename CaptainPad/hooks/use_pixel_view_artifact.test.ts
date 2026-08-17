import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/utils/api', () => ({
  getApiBaseAsync: async () => 'http://engine.test:6968',
}));

vi.mock('@/utils/simulation_url', () => ({
  simulationOriginFromApiBase: () => 'http://sim.test:6969',
}));

import {
  loadEnginePixelCount,
  loadPixelViewArtifact,
  resetPixelViewArtifactCache,
} from './use_pixel_view_artifact';

/** The smallest artifact `parsePixelViewArtifact` accepts. */
const ARTIFACT = {
  schemaVersion: 4,
  design: { width: 100, height: 40, panelGap: 8 },
  modelPixelCount: 4,
  views: [
    {
      id: 'top_down',
      label: 'Top Down',
      panels: [{
        id: 'ship',
        label: 'Ship',
        weight: 1,
        glyphs: [0, 1, 2, 3].map((i) => ({
          pixelIndex: i, x: i * 10, y: 5, sizeX: 2, sizeY: 2, shape: 'square',
        })),
      }],
    },
  ],
};

function installFetch(handlers: { [url: string]: () => unknown }) {
  const calls: string[] = [];
  const fetchImpl = vi.fn(async (url: string) => {
    calls.push(url);
    const key = Object.keys(handlers).find((k) => url.includes(k));
    if (!key) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => handlers[key]() };
  });
  (globalThis as { fetch?: unknown }).fetch = fetchImpl;
  return { calls, fetchImpl };
}

describe('use_pixel_view_artifact', () => {
  beforeEach(() => {
    resetPixelViewArtifactCache();
  });

  it('fetches the artifact ONCE however many consumers ask', async () => {
    const { fetchImpl } = installFetch({
      'touch_control_pixel_views.json': () => ARTIFACT,
    });

    // Nine bands mounting in the same tick — the mixer's worst case.
    const results = await Promise.all(
      Array.from({ length: 9 }, () => loadPixelViewArtifact()),
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    // Every consumer got the SAME parsed document, not nine copies.
    for (const r of results) expect(r).toBe(results[0]);
    expect(results[0].views[0].id).toBe('top_down');
    expect(results[0].modelPixelCount).toBe(4);

    // A later mount is served straight from the cache.
    await loadPixelViewArtifact();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('asks the sim origin for the artifact and the engine for the pixel count', async () => {
    const { calls } = installFetch({
      'touch_control_pixel_views.json': () => ARTIFACT,
      'group-layout': () => ({ pixelCount: 964 }),
    });

    await loadPixelViewArtifact();
    await loadEnginePixelCount();

    expect(calls).toContain('http://sim.test:6969/docs/ui/touch_control_pixel_views.json');
    expect(calls).toContain('http://engine.test:6968/model/group-layout');
  });

  it('caches the pixel-count probe too', async () => {
    const { fetchImpl } = installFetch({ 'group-layout': () => ({ pixelCount: 964 }) });
    const counts = await Promise.all([
      loadEnginePixelCount(), loadEnginePixelCount(), loadEnginePixelCount(),
    ]);
    expect(counts).toEqual([964, 964, 964]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('reports a missing pixel count as null (the guard is off, not zero)', async () => {
    installFetch({});
    await expect(loadEnginePixelCount()).resolves.toBeNull();
  });

  it('surfaces the simulator HTTP failure verbatim and does NOT cache it', async () => {
    const failing = vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) }));
    (globalThis as { fetch?: unknown }).fetch = failing;

    await expect(loadPixelViewArtifact()).rejects.toThrow(/answered HTTP 503/);
    // The next mount RETRIES — the simulator is routinely started after the pad.
    const { fetchImpl } = installFetch({ 'touch_control_pixel_views.json': () => ARTIFACT });
    await expect(loadPixelViewArtifact()).resolves.toMatchObject({ modelPixelCount: 4 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("propagates a malformed artifact as the parser's own loud error", async () => {
    installFetch({
      'touch_control_pixel_views.json': () => ({ ...ARTIFACT, schemaVersion: 3 }),
    });
    await expect(loadPixelViewArtifact()).rejects.toThrow(/schemaVersion is 3/);
  });
});
