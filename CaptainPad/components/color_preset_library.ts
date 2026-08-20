import type { ColorPairWire } from '@/utils/api';

export type ColorPalettePreset = {
  id: string;
  name: string;
  c1: number;
  c2: number;
};

export type MenuColorPalettePreset = ColorPalettePreset & {
  source: 'curated' | 'saved';
  protected: boolean;
  savedIndex: number | null;
};

// Baby Reveal owns its own event UI and hardcoded pattern colours. Keeping
// these engine palettes available for show/timeline resolution while removing
// them from the everyday operator chooser avoids polluting the normal menu.
export const COLOR_PRESET_MENU_EXCLUDED_IDS = [
  'baby_reveal_duet',
  'baby_pink',
  'baby_blue',
] as const;

const EXCLUDED_ID_SET = new Set<string>(COLOR_PRESET_MENU_EXCLUDED_IDS);

export function isProtectedColorPalette(preset: Pick<ColorPalettePreset, 'name'>): boolean {
  return preset.name.includes('\u2605');
}

function savedPaletteName(pair: ColorPairWire): string {
  if (typeof pair.name === 'string' && pair.name.trim()) return pair.name.trim();
  const c1 = Math.round(pair.c1 * 360);
  const c2 = Math.round(pair.c2 * 360);
  return `${c1}\u00b0 / ${c2}\u00b0`;
}

/**
 * Build the ONE operator-facing preset menu from the immutable show catalog
 * plus the scene-owned saves. Curated items keep their engine ids; saved items
 * retain their source index so deletion removes exactly the selected row.
 */
export function buildColorPresetLibrary(
  curated: readonly ColorPalettePreset[],
  saved: readonly ColorPairWire[],
  hiddenPaletteIds: readonly string[],
): MenuColorPalettePreset[] {
  const hidden = new Set(hiddenPaletteIds);
  const visibleCurated = curated
    .filter((p) => !EXCLUDED_ID_SET.has(p.id) && !hidden.has(p.id))
    .map((p) => ({
      ...p,
      source: 'curated' as const,
      protected: isProtectedColorPalette(p),
      savedIndex: null,
    }));
  const visibleSaved = saved.map((p, savedIndex) => ({
    id: `saved:${savedIndex}:${p.c1.toFixed(6)}:${p.c2.toFixed(6)}`,
    name: savedPaletteName(p),
    c1: p.c1,
    c2: p.c2,
    source: 'saved' as const,
    protected: false,
    savedIndex,
  }));
  return [...visibleCurated, ...visibleSaved];
}

export function canRemoveColorPalette(preset: MenuColorPalettePreset): boolean {
  return preset.source === 'saved' || !preset.protected;
}

export function filterCuratedColorPaletteMenu(
  curated: readonly ColorPalettePreset[],
  hiddenPaletteIds: readonly string[] = [],
): ColorPalettePreset[] {
  const hidden = new Set(hiddenPaletteIds);
  return curated.filter((p) => !EXCLUDED_ID_SET.has(p.id) && !hidden.has(p.id));
}
