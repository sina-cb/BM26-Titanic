import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadYoga } from 'yoga-layout/load';
import type { Yoga as YogaModule } from 'yoga-layout/load';

import {
  PARAMETER_CARD_BOUNDARY_STYLE,
  PARAMETER_HEADER_ACTIONS_STYLE,
  PARAMETER_HEADER_LABEL_STYLE,
  PARAMETER_HEADER_STYLE,
} from './parameter_header_layout';

const SCREENSHOT_PANEL_WIDTH = 460;
const NATIVE_POINT_PANEL_WIDTH = SCREENSHOT_PANEL_WIDTH / 2;
const CARD_HORIZONTAL_PADDING = 16;
const ACTION_WIDTHS = [70, 44, 44] as const;

let Yoga: YogaModule;

beforeAll(async () => {
  Yoga = await loadYoga();
});

describe('DECK PARAMETERS narrow landscape header', () => {
  it('keeps the editable identity on its own full-width row', () => {
    expect(PARAMETER_HEADER_STYLE).not.toHaveProperty('flexDirection');
    expect(PARAMETER_HEADER_LABEL_STYLE).toMatchObject({
      alignSelf: 'stretch',
      width: '100%',
      minWidth: 0,
    });
  });

  it('fits every action in one row at the screenshot panel width', () => {
    const usableWidth = NATIVE_POINT_PANEL_WIDTH - CARD_HORIZONTAL_PADDING * 2;
    const row = Yoga.Node.create();
    row.setWidth(usableWidth);
    row.setFlexDirection(Yoga.FLEX_DIRECTION_ROW);
    row.setJustifyContent(Yoga.JUSTIFY_FLEX_END);
    row.setGap(Yoga.GUTTER_COLUMN, PARAMETER_HEADER_ACTIONS_STYLE.gap as number);

    const actions = ACTION_WIDTHS.map((width) => {
      const action = Yoga.Node.create();
      action.setWidth(width);
      action.setHeight(44);
      row.insertChild(action, row.getChildCount());
      return action;
    });

    row.calculateLayout(usableWidth, undefined, Yoga.DIRECTION_LTR);

    expect(actions[0].getComputedLeft()).toBeGreaterThanOrEqual(0);
    expect(actions.at(-1)!.getComputedLeft() + actions.at(-1)!.getComputedWidth())
      .toBe(usableWidth);
    row.freeRecursive();
  });

  it('bounds the card without imposing a height that would defeat the column scroll host', () => {
    expect(PARAMETER_CARD_BOUNDARY_STYLE).toMatchObject({
      width: '100%',
      maxWidth: '100%',
      minWidth: 0,
      overflow: 'hidden',
    });
    expect(PARAMETER_CARD_BOUNDARY_STYLE).not.toHaveProperty('height');
    expect(PARAMETER_CARD_BOUNDARY_STYLE).not.toHaveProperty('maxHeight');
  });

  it('wires the two-row contract into the real Deck parameters card', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(join(here, '../../app/(tabs)/index.tsx'), 'utf8');
    expect(source).toContain('<View style={PARAMETER_HEADER_STYLE}>');
    expect(source).toContain('<View style={PARAMETER_HEADER_LABEL_STYLE}>');
    expect(source).toContain('<View style={PARAMETER_HEADER_ACTIONS_STYLE}>');
  });

  it('lets the real entry editor shrink its title instead of rotating the badge into a sliver', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(join(here, '../EntryLabelEditor.tsx'), 'utf8');
    expect(source).toMatch(/<View style=\{\{ flex: 1, minWidth: 0 \}\}>/);
    expect(source).toMatch(/row:\s*\{[\s\S]*?maxWidth: '100%' as const,[\s\S]*?minWidth: 0,/);
    expect(source).toMatch(/titleStatic:\s*\{\s*flexShrink: 1,\s*minWidth: 0,/);
  });
});
