import { beforeAll, describe, expect, it } from 'vitest';

import {
  MIXER_CHANNEL_CARD_WIDTH,
  mixerChannelRowSizing,
  type MixerChannelRowSizing,
} from '@/components/mixer_scroll_layout';

let Yoga: typeof import('yoga-layout').default;

beforeAll(async () => {
  Yoga = (await import('yoga-layout')).default;
});

interface YogaRowOptions {
  viewportWidth: number;
  channelCount: number;
  horizontalPadding?: number;
  gap?: number;
  fixedItemWidths?: readonly number[];
}

interface YogaRowResult {
  sizing: MixerChannelRowSizing;
  viewportWidth: number;
  cardWidths: number[];
}

function computeYogaRow(options: YogaRowOptions): YogaRowResult {
  const horizontalPadding = options.horizontalPadding ?? 16;
  const gap = options.gap ?? 16;
  const fixedItemWidths = options.fixedItemWidths ?? [];
  const itemCount = options.channelCount + fixedItemWidths.length;
  const gapWidths = Array.from({ length: Math.max(0, itemCount - 1) }, () => gap);
  const sizing = mixerChannelRowSizing({
    viewportWidth: options.viewportWidth,
    channelCount: options.channelCount,
    horizontalPadding,
    gapWidths,
    fixedItemWidths,
  });

  const viewport = Yoga.Node.create();
  viewport.setWidth(options.viewportWidth);

  const content = Yoga.Node.create();
  content.setFlexDirection(Yoga.FLEX_DIRECTION_ROW);
  content.setGap(Yoga.GUTTER_COLUMN, gap);
  content.setPadding(Yoga.EDGE_LEFT, horizontalPadding);
  content.setPadding(Yoga.EDGE_RIGHT, horizontalPadding);
  content.setMinWidth(options.viewportWidth);

  const cards = Array.from({ length: options.channelCount }, () => {
    const card = Yoga.Node.create();
    card.setWidth(sizing.cardTrack.width);
    card.setMinWidth(sizing.cardTrack.minWidth);
    card.setMaxWidth(sizing.cardTrack.maxWidth);
    card.setFlexGrow(sizing.cardTrack.flexGrow);
    card.setFlexShrink(sizing.cardTrack.flexShrink);
    content.insertChild(card, content.getChildCount());
    return card;
  });
  fixedItemWidths.forEach((width) => {
    const item = Yoga.Node.create();
    item.setWidth(width);
    item.setFlexShrink(0);
    content.insertChild(item, content.getChildCount());
  });

  viewport.insertChild(content, 0);
  viewport.calculateLayout(options.viewportWidth, 500, Yoga.DIRECTION_LTR);
  const result = {
    sizing,
    viewportWidth: viewport.getComputedWidth(),
    cardWidths: cards.map((card) => card.getComputedWidth()),
  };
  viewport.freeRecursive();
  return result;
}

function expectUniform(result: YogaRowResult, expectedWidth: number): void {
  expect(new Set(result.cardWidths)).toEqual(new Set([expectedWidth]));
  expect(result.cardWidths.every((width) => width >= MIXER_CHANNEL_CARD_WIDTH)).toBe(true);
}

describe('Mixer channel row â€” Yoga-executed adaptive native layout', () => {
  it('caps one iPad-landscape card at exactly half the usable row', () => {
    const result = computeYogaRow({ viewportWidth: 1194, channelCount: 1 });

    expect(result.viewportWidth).toBe(1194);
    expectUniform(result, 581);
    expect(result.sizing.overflow).toBe(false);
  });

  it('splits iPad landscape exactly 50/50 between two equal cards', () => {
    const result = computeYogaRow({ viewportWidth: 1194, channelCount: 2 });

    expectUniform(result, 573);
    expect(result.sizing.requiredContentWidth).toBe(1194);
    expect(result.sizing.overflow).toBe(false);
  });

  it('keeps three iPad-landscape cards equal above the minimum', () => {
    const result = computeYogaRow({ viewportWidth: 1194, channelCount: 3 });

    expectUniform(result, 376);
    expect(result.sizing.overflow).toBe(false);
  });

  it('holds four iPad-landscape cards at 320pt and exposes overflow', () => {
    const result = computeYogaRow({ viewportWidth: 1194, channelCount: 4 });

    expectUniform(result, 320);
    expect(result.sizing.requiredContentWidth).toBe(1360);
    expect(result.sizing.overflow).toBe(true);
  });

  it('lets four desktop cards grow uniformly, then overflows at five', () => {
    const four = computeYogaRow({ viewportWidth: 1600, channelCount: 4 });
    const five = computeYogaRow({ viewportWidth: 1600, channelCount: 5 });

    expectUniform(four, 380);
    expect(four.sizing.requiredContentWidth).toBe(1600);
    expect(four.sizing.overflow).toBe(false);
    expectUniform(five, 320);
    expect(five.sizing.overflow).toBe(true);
  });

  it('recomputes every card together across dynamic add/remove sequences', () => {
    const two = computeYogaRow({ viewportWidth: 1600, channelCount: 2 });
    const four = computeYogaRow({ viewportWidth: 1600, channelCount: 4 });
    const one = computeYogaRow({ viewportWidth: 1600, channelCount: 1 });
    const three = computeYogaRow({ viewportWidth: 1600, channelCount: 3 });

    expectUniform(two, 776);
    expectUniform(four, 380);
    expectUniform(one, 784);
    expectUniform(three, 512);
  });

  it('fills an iPad row with two equal cards inside a padded, bordered group', () => {
    const sizing = mixerChannelRowSizing({
      viewportWidth: 1194,
      channelCount: 2,
      horizontalPadding: 16,
      gapWidths: [12],
      fixedItemWidths: [18],
    });
    const viewport = Yoga.Node.create();
    viewport.setWidth(1194);
    viewport.setPadding(Yoga.EDGE_LEFT, 16);
    viewport.setPadding(Yoga.EDGE_RIGHT, 16);
    const group = Yoga.Node.create();
    group.setFlexDirection(Yoga.FLEX_DIRECTION_ROW);
    group.setPadding(Yoga.EDGE_LEFT, 8);
    group.setPadding(Yoga.EDGE_RIGHT, 8);
    group.setBorder(Yoga.EDGE_LEFT, 1);
    group.setBorder(Yoga.EDGE_RIGHT, 1);
    group.setGap(Yoga.GUTTER_COLUMN, 12);
    const cards = Array.from({ length: 2 }, () => {
      const card = Yoga.Node.create();
      card.setWidth(sizing.cardWidth);
      card.setMinWidth(sizing.cardWidth);
      card.setMaxWidth(sizing.cardWidth);
      card.setFlexShrink(0);
      group.insertChild(card, group.getChildCount());
      return card;
    });
    viewport.insertChild(group, 0);
    viewport.calculateLayout(1194, 500, Yoga.DIRECTION_LTR);

    expect(cards.map((card) => card.getComputedWidth())).toEqual([566, 566]);
    expect(group.getComputedWidth()).toBe(1162);
    expect(sizing.requiredContentWidth).toBe(1194);
    expect(sizing.overflow).toBe(false);
    viewport.freeRecursive();
  });

  it('accounts for custom padding, gaps, and a fixed COLORS-width citizen', () => {
    const custom = computeYogaRow({
      viewportWidth: 1600,
      channelCount: 2,
      horizontalPadding: 24,
      gap: 20,
    });
    const withColors = computeYogaRow({
      viewportWidth: 1600,
      channelCount: 2,
      fixedItemWidths: [380],
    });

    expectUniform(custom, 766);
    expect(custom.sizing.requiredContentWidth).toBe(1600);
    expectUniform(withColors, 578);
    expect(withColors.sizing.requiredContentWidth).toBe(1600);
  });
});
