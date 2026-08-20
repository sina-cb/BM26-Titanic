import { beforeAll, describe, expect, it } from 'vitest';
import { loadYoga } from 'yoga-layout/load';
import type { Node as YogaNode, Yoga as YogaModule } from 'yoga-layout/load';

import { audioPageLayout } from './audio_configuration_logic';

let Yoga: YogaModule;

beforeAll(async () => {
  Yoga = await loadYoga();
});

function calculateGrid(windowWidth: number, signalCount: number): {
  root: YogaNode;
  cells: YogaNode[];
} {
  const layout = audioPageLayout(windowWidth);
  const contentWidth = layout.routeWidth - layout.pagePadding * 2;
  const root = Yoga.Node.create();
  root.setWidth(contentWidth);
  root.setFlexDirection(Yoga.FLEX_DIRECTION_ROW);
  root.setFlexWrap(Yoga.WRAP_WRAP);
  const cells: YogaNode[] = [];
  for (let index = 0; index < signalCount; index += 1) {
    const cell = Yoga.Node.create();
    cell.setWidthPercent(100 / layout.meterColumns);
    cell.setHeight(80);
    root.insertChild(cell, index);
    cells.push(cell);
  }
  root.calculateLayout(contentWidth, undefined, Yoga.DIRECTION_LTR);
  return { root, cells };
}

function calculateNativeMonitorFlow(signalColumnFlex: boolean) {
  const screen = Yoga.Node.create();
  screen.setWidth(1068);
  screen.setHeight(1110);
  screen.setFlexDirection(Yoga.FLEX_DIRECTION_COLUMN);

  const scroll = Yoga.Node.create();
  scroll.setFlexGrow(1);
  screen.insertChild(scroll, 0);

  const content = Yoga.Node.create();
  content.setWidth(1004);
  scroll.insertChild(content, 0);

  const meterGrid = Yoga.Node.create();
  meterGrid.setWidth(1004);
  meterGrid.setFlexDirection(Yoga.FLEX_DIRECTION_ROW);
  meterGrid.setFlexWrap(Yoga.WRAP_WRAP);
  content.insertChild(meterGrid, 0);

  for (let index = 0; index < 3; index += 1) {
    const cell = Yoga.Node.create();
    cell.setWidthPercent(100 / 3);
    meterGrid.insertChild(cell, index);

    const signalColumn = Yoga.Node.create();
    if (signalColumnFlex) signalColumn.setFlex(1);
    else signalColumn.setWidthPercent(100);
    cell.insertChild(signalColumn, 0);
    for (const height of [20, 6, 68, 12]) {
      const row = Yoga.Node.create();
      row.setHeight(height);
      signalColumn.insertChild(row, signalColumn.getChildCount());
    }
  }

  const configurationBody = Yoga.Node.create();
  configurationBody.setHeight(300);
  content.insertChild(configurationBody, 1);

  screen.calculateLayout(1068, 1110, Yoga.DIRECTION_LTR);
  const result = {
    gridHeight: meterGrid.getComputedHeight(),
    signalHeight: meterGrid.getChild(0).getChild(0).getComputedHeight(),
    configurationTop: configurationBody.getComputedTop(),
    contentHeight: content.getComputedHeight(),
  };
  screen.freeRecursive();
  return result;
}

describe('Audio meter grid - Yoga-executed native wrapping', () => {
  it.each([
    [1180, 3, 8],
    [568, 2, 12],
    [430, 1, 24],
  ])('wraps 24 signals at %ipx into %i columns without overflow', (windowWidth, columns, rows) => {
    const { root, cells } = calculateGrid(windowWidth, 24);
    expect(audioPageLayout(windowWidth).meterColumns).toBe(columns);
    expect(root.getComputedHeight()).toBe(rows * 80);
    for (const cell of cells) {
      expect(cell.getComputedLeft() + cell.getComputedWidth())
        .toBeLessThanOrEqual(root.getComputedWidth());
    }
    root.freeRecursive();
  });

  it('keeps the Edit configuration body below auto-height native meter columns', () => {
    const formerFlexTrap = calculateNativeMonitorFlow(true);
    expect(formerFlexTrap).toEqual({
      gridHeight: 0,
      signalHeight: 0,
      configurationTop: 0,
      contentHeight: 300,
    });

    const fixedFlow = calculateNativeMonitorFlow(false);
    expect(fixedFlow).toEqual({
      gridHeight: 106,
      signalHeight: 106,
      configurationTop: 106,
      contentHeight: 406,
    });
  });
});
