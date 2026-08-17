/**
 * Yoga-executed proof for the native Deck fill -> pin transition.
 *
 * The browser was already measured clean. This suite instead runs the same
 * Yoga 3 C++ algorithm React Native Fabric uses, with the shipped 834x1194
 * portrait host and the real PATTERNS/lower-region flex-family style chains.
 * It deliberately keeps the playlist child at its preceding full-height
 * frame while the parent commits the smaller pinned frame: that is the one
 * native transition frame whose paint must be contained.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { loadYoga } from 'yoga-layout/load';
import type { Node as YogaNode, Yoga as YogaModule } from 'yoga-layout/load';

import {
  NARROW_PATTERNS_NATIVE_CLIP_STYLE,
  NARROW_PATTERNS_OUTER_MARGIN,
  narrowStackSizing,
  narrowStackTrackStyles,
  type NarrowStackTrackStyle,
} from './deck_workspace_layout';

const VIEWPORT_HEIGHT = 1194;
const COLUMNS_HOST_HEIGHT = 843;
const COLUMNS_HOST_WIDTH = 834;
const FULL_PATTERNS_CONTENT_HEIGHT = COLUMNS_HOST_HEIGHT - NARROW_PATTERNS_OUTER_MARGIN;
const LOWER_WINDOW_CONTENT_HEIGHT = 1010;

let Yoga: YogaModule;

beforeAll(async () => {
  Yoga = await loadYoga();
});

function applyTrackStyle(node: YogaNode, style: NarrowStackTrackStyle): void {
  node.setFlexGrow(style.flexGrow);
  node.setFlexShrink(style.flexShrink);
  node.setFlexBasis(style.flexBasis);
  node.setMinHeight(style.minHeight);
}

type DeckYogaChain = Readonly<{
  host: YogaNode;
  patterns: YogaNode;
  patternsContent: YogaNode;
  rest: YogaNode;
  restContent: YogaNode;
}>;

function createDeckYogaChain(hostHeight = COLUMNS_HOST_HEIGHT): DeckYogaChain {
  const host = Yoga.Node.create();
  host.setFlexDirection(Yoga.FLEX_DIRECTION_COLUMN);
  host.setWidth(COLUMNS_HOST_WIDTH);
  host.setHeight(hostHeight);

  const patterns = Yoga.Node.create();
  patterns.setMargin(Yoga.EDGE_TOP, NARROW_PATTERNS_OUTER_MARGIN / 2);
  patterns.setMargin(Yoga.EDGE_BOTTOM, NARROW_PATTERNS_OUTER_MARGIN / 2);
  if (NARROW_PATTERNS_NATIVE_CLIP_STYLE.overflow !== 'hidden') {
    throw new Error('the native PATTERNS containment style must remain overflow:hidden');
  }
  patterns.setOverflow(Yoga.OVERFLOW_HIDDEN);

  // Models the Fabric transition pressure directly: the deep playlist child
  // may still carry the preceding fill frame when its parent has committed
  // the smaller pinned frame.
  const patternsContent = Yoga.Node.create();
  patternsContent.setHeight(FULL_PATTERNS_CONTENT_HEIGHT);
  patterns.insertChild(patternsContent, 0);

  const rest = Yoga.Node.create();
  // React Native ScrollView's real baseVertical style, flattened BEFORE the
  // caller style (RN 0.81 ScrollView.js): longhands only, no `flex` shorthand.
  rest.setFlexGrow(1);
  rest.setFlexShrink(1);
  rest.setFlexDirection(Yoga.FLEX_DIRECTION_COLUMN);
  rest.setOverflow(Yoga.OVERFLOW_SCROLL);

  const restContent = Yoga.Node.create();
  restContent.setHeight(LOWER_WINDOW_CONTENT_HEIGHT);
  rest.insertChild(restContent, 0);

  host.insertChild(patterns, 0);
  host.insertChild(rest, 1);
  return { host, patterns, patternsContent, rest, restContent };
}

function calculate(chain: DeckYogaChain): void {
  chain.host.calculateLayout(COLUMNS_HOST_WIDTH, COLUMNS_HOST_HEIGHT, Yoga.DIRECTION_LTR);
}

describe('Deck narrow workspace - Yoga-executed native fill -> pin transition', () => {
  it('pins PATTERNS at 460, bounds the lower region at 375, and clips a stale fill-height child', () => {
    const chain = createDeckYogaChain();
    const fillTracks = narrowStackTrackStyles(narrowStackSizing({
      openCount: 1,
      windowHeight: VIEWPORT_HEIGHT,
      hostHeight: COLUMNS_HOST_HEIGHT,
      secondaryBound: false,
    }));
    applyTrackStyle(chain.patterns, fillTracks.patterns);
    applyTrackStyle(chain.rest, fillTracks.rest);
    calculate(chain);

    expect(chain.patterns.getComputedHeight()).toBe(835);
    expect(chain.rest.getComputedHeight()).toBe(0);

    const pinnedTracks = narrowStackTrackStyles(narrowStackSizing({
      openCount: 2,
      windowHeight: VIEWPORT_HEIGHT,
      hostHeight: COLUMNS_HOST_HEIGHT,
      secondaryBound: false,
    }));
    applyTrackStyle(chain.patterns, pinnedTracks.patterns);
    applyTrackStyle(chain.rest, pinnedTracks.rest);
    calculate(chain);

    expect(chain.patterns.getComputedTop()).toBe(4);
    expect(chain.patterns.getComputedHeight()).toBe(460);
    expect(chain.rest.getComputedTop()).toBe(468);
    expect(chain.rest.getComputedHeight()).toBe(375);
    expect(chain.rest.getComputedTop() + chain.rest.getComputedHeight()).toBe(COLUMNS_HOST_HEIGHT);

    // The child intentionally still exceeds its newly pinned parent. The
    // native containment style is therefore load-bearing, not decorative.
    expect(chain.patternsContent.getComputedHeight()).toBe(835);
    expect(chain.patternsContent.getComputedHeight()).toBeGreaterThan(
      chain.patterns.getComputedHeight(),
    );
    expect(chain.patterns.getOverflow()).toBe(Yoga.OVERFLOW_HIDDEN);
    expect(NARROW_PATTERNS_NATIVE_CLIP_STYLE).toEqual({ overflow: 'hidden' });

    chain.host.freeRecursive();
  });

  it('falsifies the null-host hypothesis at 834x1194: the flexible first frame still splits 460/375', () => {
    const chain = createDeckYogaChain();
    const tracks = narrowStackTrackStyles(narrowStackSizing({
      openCount: 2,
      windowHeight: VIEWPORT_HEIGHT,
      hostHeight: null,
      secondaryBound: false,
    }));
    applyTrackStyle(chain.patterns, tracks.patterns);
    applyTrackStyle(chain.rest, tracks.rest);
    calculate(chain);

    expect(chain.patterns.getComputedHeight()).toBe(460);
    expect(chain.rest.getComputedTop()).toBe(468);
    expect(chain.rest.getComputedHeight()).toBe(375);

    chain.host.freeRecursive();
  });

  it('keeps both shipped track chains free of Yoga flex-shorthand precedence', () => {
    const sizing = narrowStackSizing({
      openCount: 2,
      windowHeight: VIEWPORT_HEIGHT,
      hostHeight: COLUMNS_HOST_HEIGHT,
      secondaryBound: false,
    });
    const tracks = narrowStackTrackStyles(sizing);

    expect('flex' in tracks.patterns).toBe(false);
    expect('flex' in tracks.rest).toBe(false);
    expect(tracks.patterns.flexBasis).toBe(460);
    expect(tracks.rest.flexBasis).toBe(375);
  });

  it('gives a short native portrait host two real tracks instead of a 72pt sliver', () => {
    const shortHostHeight = 309;
    const chain = createDeckYogaChain(shortHostHeight);
    const tracks = narrowStackTrackStyles(narrowStackSizing({
      openCount: 2,
      windowHeight: 620,
      hostHeight: shortHostHeight,
      secondaryBound: false,
    }));
    applyTrackStyle(chain.patterns, tracks.patterns);
    applyTrackStyle(chain.rest, tracks.rest);
    calculate(chain);

    expect(chain.patterns.getComputedTop()).toBe(4);
    expect(chain.patterns.getComputedHeight()).toBe(155);
    expect(chain.rest.getComputedTop()).toBe(163);
    expect(chain.rest.getComputedHeight()).toBe(146);
    expect(chain.rest.getComputedTop() + chain.rest.getComputedHeight()).toBe(shortHostHeight);

    chain.host.freeRecursive();
  });
});
