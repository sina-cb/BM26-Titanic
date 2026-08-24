import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const DECK = readFileSync(join(HERE, '..', 'app', '(tabs)', 'index.tsx'), 'utf8');
const MIXER = readFileSync(join(HERE, '..', 'app', '(tabs)', 'mixer.tsx'), 'utf8');
const TAB_LAYOUT = readFileSync(join(HERE, '..', 'app', '(tabs)', '_layout.tsx'), 'utf8');
const EFFECTS = readFileSync(join(HERE, 'GlobalEffectMacros.tsx'), 'utf8');

function styleBlock(source: string, name: string): string {
  const start = source.indexOf(`${name}: {`);
  const end = source.indexOf('\n  },', start);
  if (start < 0 || end < 0) throw new Error(`Could not isolate ${name}`);
  return source.slice(start, end);
}

describe('native iPad bottom effects layout', () => {
  it('keeps every Deck flex ancestor shrinkable above the fixed effects bar', () => {
    expect(DECK).toContain("<View style={{ flex: 1, minHeight: 0, position: 'relative' }}>");
    expect(DECK).toContain('{ minHeight: 0, paddingHorizontal: 4 }');
    expect(styleBlock(DECK, 'globalRigBar')).toContain('flexShrink: 0');
    expect(styleBlock(DECK, 'globalRigBar')).toContain('height: EFFECTS_STRIP_HOST_HEIGHT');
  });

  it('pins the Mixer effects bar while allowing the screen body to shrink', () => {
    expect(styleBlock(MIXER, 'container')).toContain('minHeight: 0');
    expect(styleBlock(MIXER, 'globalRigBar')).toContain('flexShrink: 0');
    expect(styleBlock(MIXER, 'globalRigBar')).toContain('height: EFFECTS_STRIP_HOST_HEIGHT');
    expect(MIXER).toContain('flex: 1, ...MIXER_BOUNDED_SCROLL_AREA, position:');
  });

  it('bounds the tab scene itself to the native viewport', () => {
    expect(TAB_LAYOUT).toMatch(/sceneStyle:\s*\{\s*flex:\s*1,\s*minHeight:\s*0,/);
  });

  it('allocates landscape effect slots only the width left after fixed controls', () => {
    const landscape = EFFECTS.slice(
      EFFECTS.indexOf('// Landscape: ONE flat flex row'),
      EFFECTS.indexOf('// Deck: one uniform grid'),
    );
    expect(landscape.match(/flex: 1, minWidth: 0, flexDirection: 'row'/g)).toHaveLength(2);
    expect(landscape).toContain('<View style={{ flex: 1, minWidth: 0, flexDirection:');
    expect(landscape).toContain('{slotChips}');
  });
});
