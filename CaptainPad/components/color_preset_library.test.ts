import { describe, expect, it } from 'vitest';

import {
  buildColorPresetLibrary,
  canRemoveColorPalette,
  filterCuratedColorPaletteMenu,
} from '@/components/color_preset_library';

const CURATED = [
  { id: 'baby_reveal_duet', name: 'Baby Reveal - Pink + Blue', c1: 0.94, c2: 0.56 },
  { id: 'baby_pink', name: 'Baby Pink', c1: 0.92, c2: 0.98 },
  { id: 'baby_blue', name: 'Baby Blue', c1: 0.52, c2: 0.61 },
  { id: 'laser_lime', name: 'Laser Lime ★', c1: 0.28, c2: 0.78 },
  { id: 'sunset_coral', name: 'Sunset Coral', c1: 0.03, c2: 0.5 },
];

describe('operator color preset library', () => {
  it('removes Baby event palettes from normal menus while retaining house palettes', () => {
    expect(filterCuratedColorPaletteMenu(CURATED).map((p) => p.id)).toEqual([
      'laser_lime',
      'sunset_coral',
    ]);
  });

  it('merges scene-saved pairs into the same menu with stable source indexes', () => {
    const menu = buildColorPresetLibrary(CURATED, [
      { c1: 0.1, c2: 0.2, name: 'My Pair' },
      { c1: 0.25, c2: 0.75 },
    ], []);
    expect(menu.map((p) => p.name)).toEqual([
      'Laser Lime ★',
      'Sunset Coral',
      'My Pair',
      '90° / 270°',
    ]);
    expect(menu[2]).toMatchObject({ source: 'saved', savedIndex: 0, protected: false });
    expect(menu[3]).toMatchObject({ source: 'saved', savedIndex: 1, protected: false });
  });

  it('applies scene-shared curated visibility and never marks starred entries removable', () => {
    const menu = buildColorPresetLibrary(CURATED, [], ['sunset_coral']);
    expect(menu.map((p) => p.id)).toEqual(['laser_lime']);
    expect(canRemoveColorPalette(menu[0])).toBe(false);
  });

  it('allows saved and ordinary curated entries to be removed', () => {
    const menu = buildColorPresetLibrary(CURATED, [{ c1: 0.4, c2: 0.9 }], []);
    expect(canRemoveColorPalette(menu.find((p) => p.id === 'sunset_coral')!)).toBe(true);
    expect(canRemoveColorPalette(menu.find((p) => p.source === 'saved')!)).toBe(true);
  });
});
