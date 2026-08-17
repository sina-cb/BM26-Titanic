import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadYoga } from 'yoga-layout/load';
import type { Node as YogaNode, Yoga as YogaModule } from 'yoga-layout/load';

import {
  COLORS_MODE_BUTTON_STYLE,
  COLORS_MODE_RAIL_STYLE,
  COLORS_WINDOW_BOUNDARY_STYLE,
} from './colors_window_layout';

// The screenshot's COLORS content card is about 214 native layout points wide
// after the iPad's 2x screenshot scale. This is the tight real-world case that
// exposed FOLLOW NOTE beyond the right border.
const CARD_WIDTH = 214;
const MODE_COUNT = 3;

let Yoga: YogaModule;

beforeAll(async () => {
  Yoga = await loadYoga();
});

function applyModeButtonStyle(node: YogaNode): void {
  node.setFlexGrow(COLORS_MODE_BUTTON_STYLE.flexGrow as number);
  node.setFlexShrink(COLORS_MODE_BUTTON_STYLE.flexShrink as number);
  node.setFlexBasis(COLORS_MODE_BUTTON_STYLE.flexBasis as number);
  node.setMinWidth(COLORS_MODE_BUTTON_STYLE.minWidth as number);
  node.setPadding(Yoga.EDGE_HORIZONTAL, COLORS_MODE_BUTTON_STYLE.paddingHorizontal as number);
  node.setPadding(Yoga.EDGE_VERTICAL, COLORS_MODE_BUTTON_STYLE.paddingVertical as number);
}

describe('COLORS window native boundary contract', () => {
  it('contains the card horizontally while leaving its height content-owned', () => {
    expect(COLORS_WINDOW_BOUNDARY_STYLE).toMatchObject({
      alignSelf: 'stretch',
      width: '100%',
      maxWidth: '100%',
      minWidth: 0,
      overflow: 'hidden',
    });
    expect(COLORS_WINDOW_BOUNDARY_STYLE).not.toHaveProperty('height');
    expect(COLORS_WINDOW_BOUNDARY_STYLE).not.toHaveProperty('maxHeight');
  });

  it('keeps all three equal-share tabs inside the measured iPad card width', () => {
    const rail = Yoga.Node.create();
    rail.setWidth(CARD_WIDTH);
    rail.setFlexDirection(Yoga.FLEX_DIRECTION_ROW);
    rail.setPadding(Yoga.EDGE_ALL, COLORS_MODE_RAIL_STYLE.padding as number);
    rail.setGap(Yoga.GUTTER_COLUMN, COLORS_MODE_RAIL_STYLE.gap as number);

    const buttons = Array.from({ length: MODE_COUNT }, () => {
      const button = Yoga.Node.create();
      applyModeButtonStyle(button);
      rail.insertChild(button, rail.getChildCount());
      return button;
    });

    rail.calculateLayout(CARD_WIDTH, undefined, Yoga.DIRECTION_LTR);

    const railRight = rail.getComputedWidth();
    const widths = buttons.map((button) => button.getComputedWidth());
    for (const button of buttons) {
      expect(button.getComputedLeft() + button.getComputedWidth()).toBeLessThanOrEqual(railRight);
    }
    expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(1);
    expect(buttons.at(-1)!.getComputedLeft() + buttons.at(-1)!.getComputedWidth())
      .toBe(CARD_WIDTH - (COLORS_MODE_RAIL_STYLE.padding as number));

    rail.freeRecursive();
  });

  it('uses longhand flex with a zero basis so label intrinsic widths cannot widen a tab', () => {
    expect(COLORS_MODE_BUTTON_STYLE).toMatchObject({
      flexGrow: 1,
      flexShrink: 1,
      flexBasis: 0,
      minWidth: 0,
    });
    expect(COLORS_MODE_BUTTON_STYLE).not.toHaveProperty('flex');
  });

  it('keeps vertical overflow owned by the existing wide SectionHost scroll', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const colorsSource = readFileSync(join(here, 'colors_window.tsx'), 'utf8');
    const deckSource = readFileSync(join(here, '../../app/(tabs)/index.tsx'), 'utf8');
    const colorsMount = deckSource.match(
      /<DeckWindow id="colors"[\s\S]*?<SectionHost[\s\S]*?<ColorsWindow[\s\S]*?<\/SectionHost>[\s\S]*?<\/DeckWindow>/,
    );

    expect(colorsMount).not.toBeNull();
    expect(deckSource).toContain(
      'const SectionHost: React.ComponentType<any> = isWide ? LockableScrollView : View;',
    );
    expect(colorsSource).not.toMatch(/import\s*\{[^}]*\bScrollView\b[^}]*\}\s*from\s*'react-native'/);
  });
});
