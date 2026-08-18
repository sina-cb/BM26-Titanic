import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadYoga } from 'yoga-layout/load';
import type { Node as YogaNode, Yoga as YogaModule } from 'yoga-layout/load';

import {
  PALETTE_LIBRARY_ACTIONS_STYLE,
  PALETTE_LIBRARY_CHIP_STYLE,
  PALETTE_LIBRARY_GRID_STYLE,
  PALETTE_LIBRARY_HEADER_STYLE,
  PALETTE_LIBRARY_TITLE_STYLE,
  PALETTE_PICKER_CARD_ITEM_STYLE,
  PALETTE_PICKER_CARD_STYLE,
} from './color_preset_library_layout';

const NARROW_WORKSPACE_WIDTH = 214;
const IPAD_LANDSCAPE_WIDTH = 1194;

let Yoga: YogaModule;

beforeAll(async () => {
  Yoga = await loadYoga();
});

function applyChipStyle(node: YogaNode): void {
  node.setFlexShrink(PALETTE_LIBRARY_CHIP_STYLE.flexShrink as number);
  node.setMaxWidthPercent(Number.parseFloat(PALETTE_LIBRARY_CHIP_STYLE.maxWidth as string));
  node.setMinWidth(PALETTE_LIBRARY_CHIP_STYLE.minWidth as number);
}

describe('shared saved-palette library native layout', () => {
  it('makes the modal card bounded on both narrow and iPad landscape screens', () => {
    expect(PALETTE_PICKER_CARD_STYLE).toMatchObject({
      alignSelf: 'center',
      maxWidth: 440,
      minWidth: 0,
      width: '92%',
    });
    expect(Math.min(IPAD_LANDSCAPE_WIDTH * 0.92, PALETTE_PICKER_CARD_STYLE.maxWidth as number))
      .toBe(440);
    expect(NARROW_WORKSPACE_WIDTH * 0.92).toBeLessThanOrEqual(NARROW_WORKSPACE_WIDTH);
  });

  it('keeps long saved-palette chips within a measured narrow gallery', () => {
    const grid = Yoga.Node.create();
    grid.setWidth(NARROW_WORKSPACE_WIDTH);
    grid.setFlexDirection(Yoga.FLEX_DIRECTION_ROW);
    grid.setFlexWrap(Yoga.WRAP_WRAP);
    grid.setGap(Yoga.GUTTER_COLUMN, PALETTE_LIBRARY_GRID_STYLE.gap as number);

    const chips = Array.from({ length: 24 }, () => {
      const chip = Yoga.Node.create();
      applyChipStyle(chip);
      // A deliberately overlong label's intrinsic requirement is bounded by
      // the chip's maxWidth, as the real Text `numberOfLines={1}` is.
      chip.setWidth(320);
      grid.insertChild(chip, grid.getChildCount());
      return chip;
    });

    grid.calculateLayout(NARROW_WORKSPACE_WIDTH, undefined, Yoga.DIRECTION_LTR);
    for (const chip of chips) {
      expect(chip.getComputedLeft() + chip.getComputedWidth()).toBeLessThanOrEqual(NARROW_WORKSPACE_WIDTH);
    }
    grid.freeRecursive();
  });

  it('uses wrapping, shrinkable header and action contracts instead of intrinsic overflow', () => {
    expect(PALETTE_LIBRARY_HEADER_STYLE).toMatchObject({
      flexDirection: 'row', flexWrap: 'wrap', minWidth: 0,
    });
    expect(PALETTE_LIBRARY_TITLE_STYLE).toMatchObject({
      flexBasis: 0, flexGrow: 1, flexShrink: 1, minWidth: 0,
    });
    expect(PALETTE_LIBRARY_ACTIONS_STYLE).toMatchObject({
      flexDirection: 'row', flexWrap: 'wrap', flexShrink: 1, minWidth: 0,
    });
    expect(PALETTE_PICKER_CARD_ITEM_STYLE).toMatchObject({
      flexBasis: '47%', flexGrow: 1, flexShrink: 1, maxWidth: '49%', minWidth: 0,
    });
  });

  it('proves Deck and Mixer use the same saved-palette component and layout contract', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const colors = readFileSync(join(here, 'deck/colors_window.tsx'), 'utf8');
    const deck = readFileSync(join(here, '../app/(tabs)/index.tsx'), 'utf8');
    const mixer = readFileSync(join(here, '../app/(tabs)/mixer.tsx'), 'utf8');
    const picker = readFileSync(join(here, 'ColorPickerModal.tsx'), 'utf8');

    expect(deck).toContain('<ColorsWindow');
    expect(mixer).toContain('<ColorsWindow');
    expect(colors).toContain('PALETTE_LIBRARY_HEADER_STYLE');
    expect(colors).toContain('PALETTE_LIBRARY_GRID_STYLE');
    expect(picker).toContain('PALETTE_PICKER_CARD_STYLE');
    expect(picker).toContain('PALETTE_PICKER_GRID_STYLE');
  });

  it('requires confirmation and server authority before a saved gallery tile disappears', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const colors = readFileSync(join(here, 'deck/colors_window.tsx'), 'utf8');

    expect(colors).toContain('opConfirm');
    expect(colors).toContain("title: 'Delete saved palette?'");
    expect(colors).toContain('Current rig colours will not change.');
    expect(colors).toContain('const res = await saveColorPairs(next);');
    expect(colors).not.toContain('setPairs(next);');
  });
});
