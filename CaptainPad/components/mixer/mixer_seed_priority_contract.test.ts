import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const mixerSource = fs.readFileSync(
  path.resolve(__dirname, '..', '..', 'app', '(tabs)', 'mixer.tsx'),
  'utf8',
);

describe('Mixer seed priority', () => {
  it('applies authoritative channels before waiting for secondary catalogs', () => {
    const seed = mixerSource.match(
      /const seed = useCallback\(async[\s\S]*?\n  \}, \[workspace\.commit\]\);/,
    )?.[0];
    expect(seed).toBeTruthy();
    expect(seed).toMatch(/const mixerRequest = fetchMixerState\(\)/);
    expect(seed).toMatch(/const catalogRequest = Promise\.all\(\[/);
    expect(seed).toMatch(/const mRes = await mixerRequest;\s*applyMixerSeed\(\);/);
    expect(seed).toMatch(/const \[bRes, tRes, vsRes, pLib\] = await catalogRequest/);
    expect(seed!.indexOf('applyMixerSeed();')).toBeLessThan(
      seed!.indexOf('await catalogRequest'),
    );
    expect(seed).toMatch(/function applyMixerSeed\(\)[\s\S]*setChannels\(mRes\.data\.channels \|\| \[\]\)/);
  });
});
