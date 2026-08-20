// pixel_view_band_collapsed_header.test.ts — source-text guards for the
// docs/69 W3 MISS 1 fix (the "both hidden" media column widening bug).
//
// WHY SOURCE TEXT, not RTL. `pixel_view_band.tsx` and `mixer.tsx` are RN
// components (`.tsx`) that `vitest.config.ts` deliberately keeps out of its
// glob (see that file's own comment) — there is no React Native test
// renderer wired into this suite. The DECISIONS this wave adds are JSX/prop
// facts only the source can state: whether the collapsed header actually
// drops its optional chrome, whether the chevron survives regardless, and
// which call sites opt in. Same idiom as `mixer_polish_source_guards.test.ts`
// and `native_gesture_armor.test.ts`.
//
// Every guard below is MUTATION-HONEST — delete the line it describes and
// the test goes red — and each block carries a positive sanity assertion so
// an over-eager regex cannot pass by matching nothing.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function read(...parts: string[]): string {
  return stripComments(readFileSync(join(HERE, ...parts), 'utf8'));
}

const BAND = read('pixel_view_band.tsx');
const MIXER = read('..', '..', 'app', '(tabs)', 'mixer.tsx');

describe('docs/69 W3 MISS 1 — PixelViewBand drops optional chrome only while collapsed AND opted in', () => {
  it('declares compactWhenCollapsed, defaulted false, so every existing mount is unaffected', () => {
    expect(BAND).toMatch(/compactWhenCollapsed\?\s*:\s*boolean/);
    expect(BAND).toMatch(/compactWhenCollapsed\s*=\s*false/);
  });

  it('derives hideOptionalChrome from BOTH the prop and the actual collapsed state', () => {
    expect(BAND).toMatch(
      /hideOptionalChrome\s*=\s*compactWhenCollapsed\s*&&\s*effectiveCollapsed/,
    );
  });

  it('gates the view-picker chip on hideOptionalChrome', () => {
    expect(BAND).toMatch(/!hideOptionalChrome\s*\?\s*\(\s*<TouchableOpacity/);
  });

  it('gates the honesty ratio on hideOptionalChrome', () => {
    expect(BAND).toMatch(/ratio\s*&&\s*!hideOptionalChrome\s*\?/);
  });

  it('never gates the chevron on hideOptionalChrome — it is the only way back (docs/64 §3.1)', () => {
    // The chevron's own render guard must still read exactly `allowCollapse`.
    const chevronBlockMatch = BAND.match(/allowCollapse \? \([\s\S]{0,600}?chevronGlyph/);
    expect(chevronBlockMatch).not.toBeNull();
    expect(chevronBlockMatch![0]).not.toMatch(/hideOptionalChrome/);
  });
});

describe('docs/69 W3 MISS 1 — exactly one PixelViewBand call site opts in', () => {
  it('the LANDSCAPE EDIT media-column band passes compactWhenCollapsed', () => {
    // The call site sits inside `mixerLandscapeMediaBandSlot(pixelsShown)`'s
    // wrapping View — grab that block and confirm the prop is there.
    const slotBlockMatch = MIXER.match(
      /<View style=\{mixerLandscapeMediaBandSlot\(pixelsShown\)\}>[\s\S]{0,800}?<\/View>/,
    );
    expect(slotBlockMatch).not.toBeNull();
    expect(slotBlockMatch![0]).toMatch(/compactWhenCollapsed/);
  });

  it('every OTHER PixelViewBand mount omits compactWhenCollapsed (portrait + master stay byte-identical)', () => {
    const occurrences = MIXER.split('<PixelViewBand').length - 1;
    const withProp = MIXER.split('compactWhenCollapsed').length - 1;
    expect(occurrences).toBe(3); // sanity: the retired master 2D mount stays absent
    expect(withProp).toBe(1); // exactly the one call site above
  });
});
