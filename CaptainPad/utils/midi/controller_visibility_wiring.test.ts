import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

function source(...parts: string[]): string {
  return readFileSync(join(HERE, ...parts), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('controller-specific UI visibility wiring', () => {
  it('gates the APC playlist window on a connected APC Mini MK2', () => {
    const hooks = source('..', '..', 'hooks', 'useMidiControl.ts');
    expect(hooks).toMatch(
      /midiControllerConnected\(midi\.statuses,\s*['"]apc_mini_mk2['"]\)/,
    );
    expect(hooks).toMatch(
      /apcConnected\s*&&\s*channelId\s*\?\s*_windows\.get\(channelId\)/,
    );
  });

  it('gates every physical MFT knob legend on a connected MFT', () => {
    const files = [
      source('..', '..', 'components', 'GlobalParams.tsx'),
      source('..', '..', 'components', 'CPCControls.tsx'),
      source('..', '..', 'components', 'deck_hue_row.tsx'),
      source('..', '..', 'app', '(tabs)', 'mixer.tsx'),
    ];
    for (const file of files) {
      expect(file).toMatch(/useMidiControllerConnected\(['"]mft['"]\)/);
      expect(file).toMatch(/\bmftConnected\b/);
    }
  });

  it('omits disconnected controller cards and gates VSN1-specific presentation', () => {
    const config = source('..', '..', 'components', 'MidiConfigSection.tsx');
    const effects = source('..', '..', 'components', 'GlobalEffectMacros.tsx');
    expect(config).toMatch(
      /statuses\.filter\(\(status\)\s*=>\s*status\.kind\s*!==\s*['"]disconnected['"]\)/,
    );
    expect(effects).toMatch(/useMidiControllerConnected\(['"]vsn1['"]\)/);
    expect(effects).toMatch(
      /deployError\?\.kind\s*===\s*['"]error['"]\s*&&\s*vsn1Connected/,
    );
    expect(effects).toMatch(/matchVsn1Color=\{vsn1Connected\}/);
    expect(effects).toMatch(/vsn1LayoutRgb\(slot\.slotId,\s*slot\.color,\s*true\)/);
  });
});
