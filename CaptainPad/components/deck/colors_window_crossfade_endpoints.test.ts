import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  crossfadeAutopilotPatch,
  crossfadeRetargetRing,
  type PaletteEntry,
} from './colors_window_logic';
import { crossfadeEndpoints } from './colors_window_crossfade_endpoints';

describe('crossfade endpoints', () => {
  const stale = crossfadeAutopilotPatch(0.61, 0.34, 2, 0.8).palettes as PaletteEntry[];

  it('starts a new crossfade from the latest selected A/B pair, not a stopped old ring', () => {
    expect(crossfadeEndpoints('none', stale, 0.08, 0.92)).toEqual([0.08, 0.92]);
  });

  it('uses the driving crossfade ring only while that ring is authoritative', () => {
    expect(crossfadeEndpoints('crossfade', stale, 0.08, 0.92)).toEqual([0.61, 0.34]);
  });

  it('seeds and retargets from the latest two-colour selection after a preset or fader change', () => {
    const latest: [number, number] = [0.08, 0.92];
    const endpoints = crossfadeEndpoints('none', stale, ...latest);

    expect(crossfadeAutopilotPatch(...endpoints, 0, 0.8).palettes).toEqual([
      { c1: latest[0], c2: latest[1] },
      { c1: latest[1], c2: latest[0] },
    ]);
    expect(crossfadeRetargetRing(...latest)).toEqual([
      { c1: latest[0], c2: latest[1] },
      { c1: latest[1], c2: latest[0] },
    ]);
  });

  it('wires the authoritative selection through the real RUN and retarget paths', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(join(here, 'colors_window.tsx'), 'utf8');

    expect(source).toContain('crossfadeEndpoints(kind, colorAutopilot?.palettes, h1, h2)');
    expect(source).toContain('crossfadeAutopilotPatch(endA, endB, holdS, fadeS)');
    expect(source).toContain('crossfadeRetargetRing(c1, c2)');
  });
});
