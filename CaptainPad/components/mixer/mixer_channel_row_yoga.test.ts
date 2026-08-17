import { beforeAll, describe, expect, it } from 'vitest';

import {
  MIXER_CHANNEL_CARD_TRACK,
  mixerChannelRowScrollEnabled,
} from '@/components/mixer_scroll_layout';

let Yoga: typeof import('yoga-layout').default;

beforeAll(async () => {
  Yoga = (await import('yoga-layout')).default;
});

function applyCardTrack(node: import('yoga-layout').Node): void {
  node.setWidth(MIXER_CHANNEL_CARD_TRACK.width);
  node.setMinWidth(MIXER_CHANNEL_CARD_TRACK.minWidth);
  node.setMaxWidth(MIXER_CHANNEL_CARD_TRACK.maxWidth);
  node.setFlexGrow(MIXER_CHANNEL_CARD_TRACK.flexGrow);
  node.setFlexShrink(MIXER_CHANNEL_CARD_TRACK.flexShrink);
}

function computeThreeCardRow(viewportWidth: number): {
  viewport: number;
  content: number;
  cards: number[];
} {
  const viewport = Yoga.Node.create();
  viewport.setWidth(viewportWidth);

  const content = Yoga.Node.create();
  content.setFlexDirection(Yoga.FLEX_DIRECTION_ROW);
  content.setGap(Yoga.GUTTER_COLUMN, 16);
  content.setPadding(Yoga.EDGE_LEFT, 16);
  content.setPadding(Yoga.EDGE_RIGHT, 16);

  const cards = Array.from({ length: 3 }, () => {
    const card = Yoga.Node.create();
    applyCardTrack(card);
    content.insertChild(card, content.getChildCount());
    return card;
  });

  viewport.insertChild(content, 0);
  viewport.calculateLayout(viewportWidth, 500, Yoga.DIRECTION_LTR);

  const result = {
    viewport: viewport.getComputedWidth(),
    content: 16 + cards.reduce((sum, card) => sum + card.getComputedWidth(), 0) + (2 * 16) + 16,
    cards: cards.map((card) => card.getComputedWidth()),
  };
  viewport.freeRecursive();
  return result;
}

describe('Mixer channel row — Yoga-executed native layout', () => {
  it('keeps all three channel cards exactly 320pt even when their row overflows', () => {
    const layout = computeThreeCardRow(900);
    expect(layout.viewport).toBe(900);
    expect(layout.cards).toEqual([320, 320, 320]);
    expect(layout.content).toBe(1024);
    expect(layout.content).toBeGreaterThan(layout.viewport);
  });

  it('pairs three-card overflow with an enabled horizontal host', () => {
    expect(mixerChannelRowScrollEnabled(false, 3, false)).toBe(true);
  });
});
