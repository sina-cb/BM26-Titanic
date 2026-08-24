import { describe, expect, it } from 'vitest';

import {
  buildMixerBarPlan,
  channelChipLabel,
  AUDIO_TITLE,
  COLORS_TITLE,
  MIXER_BAR_OVERFLOW_EPSILON,
  shouldShowBarOverflowHint,
  type MixerBarChannelInput,
  type MixerBarChipEntry,
} from './mixer_workspace_bar_logic';
import {
  channelSurfaceId,
  citizenSurfaceId,
  initialLayout,
  layoutReducer,
  type MixerWorkspaceLayout,
} from './mixer_workspace_layout';

function ch(id: string, index: number, title: string, opts: Partial<MixerBarChannelInput> = {}): MixerBarChannelInput {
  return { id, index, title, groupColor: null, muted: false, ...opts };
}

const THREE: MixerBarChannelInput[] = [
  ch('a', 1, 'Sparkle'),
  ch('b', 2, 'Ocean Liner'),
  ch('c', 3, 'Bioluminescence'),
];

function rosterOf(channels: MixerBarChannelInput[]): string[] {
  return channels.map((c) => c.id);
}

function freshLayout(channels: MixerBarChannelInput[]): MixerWorkspaceLayout {
  return initialLayout(rosterOf(channels));
}

function close(layout: MixerWorkspaceLayout, id: string, roster: string[]): MixerWorkspaceLayout {
  return layoutReducer(layout, { type: 'close', id, roster });
}

describe('channelChipLabel', () => {
  it('composes the index dot label + title verbatim (case preserved — textTransform is a style concern)', () => {
    expect(channelChipLabel(1, 'Sparkle')).toBe('1 · Sparkle');
    expect(channelChipLabel(12, 'ALREADY CAPS')).toBe('12 · ALREADY CAPS');
  });
});

describe('buildMixerBarPlan — shown chips, canonical order', () => {
  it('lists every channel shown in canonical (roster) order when nothing is hidden', () => {
    const layout = freshLayout(THREE);
    const plan = buildMixerBarPlan(THREE, layout, false, null);
    const ids = plan.shown.filter((e) => e.kind === 'channel').map((e) => (e as any).channelId);
    expect(ids).toEqual(['a', 'b', 'c']);
  });

  it('places COLORS after all visible channels', () => {
    const layout = freshLayout(THREE);
    const opened = layoutReducer(layout, { type: 'open', id: citizenSurfaceId('colors') });
    const plan = buildMixerBarPlan(THREE, opened, false, null);
    const kinds = plan.shown.map((e) => (
      e.kind === 'citizen' ? e.citizen : e.kind === 'channel' ? e.channelId : e.surfaceId
    ));
    expect(kinds).toEqual(['a', 'b', 'c', 'colors']);
    expect(plan.shown[3].label).toBe(COLORS_TITLE);
  });

  it('COLORS defaults closed and is therefore absent from `shown`, present on the rail', () => {
    const layout = freshLayout(THREE);
    const plan = buildMixerBarPlan(THREE, layout, false, null);
    expect(plan.shown.some((e) => e.kind === 'citizen' && e.citizen === 'colors')).toBe(false);
    expect(plan.rail.some((e) => e.kind === 'citizen' && e.citizen === 'colors')).toBe(true);
  });

  it('places AUDIO in the same shown/hidden workspace bar as channels and COLORS', () => {
    const layout = freshLayout(THREE);
    const shown = buildMixerBarPlan(THREE, layout, false, null, true);
    expect(shown.shown.at(-1)).toMatchObject({
      kind: 'audio',
      surfaceId: 'audioBar',
      label: AUDIO_TITLE,
      open: true,
    });
    expect(shown.rail.some((entry) => entry.kind === 'audio')).toBe(false);

    const hidden = buildMixerBarPlan(THREE, layout, false, null, false);
    expect(hidden.shown.some((entry) => entry.kind === 'audio')).toBe(false);
    expect(hidden.rail.at(-1)).toMatchObject({
      kind: 'audio',
      surfaceId: 'audioBar',
      label: AUDIO_TITLE,
      open: false,
    });
  });

  it('does not expose the retired master 2D citizen on either side of the bar', () => {
    const layout = freshLayout(THREE);
    const legacyOpened = layoutReducer(layout, { type: 'open', id: citizenSurfaceId('masterBand') });
    for (const candidate of [layout, legacyOpened]) {
      const plan = buildMixerBarPlan(THREE, candidate, false, null);
      expect(plan.shown.some((e) => e.label === 'MASTER VIEW')).toBe(false);
      expect(plan.rail.some((e) => e.label === 'MASTER VIEW')).toBe(false);
      expect(plan.rail.map((e) => (
        e.kind === 'citizen' ? e.citizen : e.kind === 'channel' ? e.channelId : e.surfaceId
      )))
        .toEqual(['colors']);
      expect(plan.showHiddenDivider).toBe(true);
    }
  });

  it('a closed channel leaves `shown`; survivors keep canonical order', () => {
    const layout = freshLayout(THREE);
    const closed = close(layout, channelSurfaceId('b'), rosterOf(THREE));
    const plan = buildMixerBarPlan(THREE, closed, false, null);
    const ids = plan.shown.filter((e) => e.kind === 'channel').map((e) => (e as any).channelId);
    expect(ids).toEqual(['a', 'c']);
  });
});

describe('buildMixerBarPlan — the rail, close order', () => {
  it('lists hidden channels in the order they were closed, not roster order', () => {
    const layout = freshLayout(THREE);
    const roster = rosterOf(THREE);
    let l = close(layout, channelSurfaceId('c'), roster);
    l = close(l, channelSurfaceId('a'), roster);
    const plan = buildMixerBarPlan(THREE, l, false, null);
    const ids = plan.rail.filter((e) => e.kind === 'channel').map((e) => (e as any).channelId);
    // 'c' closed first, then 'a' — close order, NOT ['a', 'c'] roster order.
    expect(ids).toEqual(['c', 'a']);
  });

  it('interleaves channels and citizens in the exact order they were closed', () => {
    // The persisted store still understands the retired master id for
    // upgrade safety, but the bar deliberately ignores it.
    const layout = freshLayout(THREE);
    const roster = rosterOf(THREE);
    let l = layoutReducer(layout, { type: 'open', id: citizenSurfaceId('masterBand') });
    l = close(l, channelSurfaceId('b'), roster);
    l = layoutReducer(l, { type: 'close', id: citizenSurfaceId('masterBand'), roster });
    l = close(l, channelSurfaceId('a'), roster);
    const plan = buildMixerBarPlan(THREE, l, false, null);
    const railIds = plan.rail.map((e) => (
      e.kind === 'channel' ? e.channelId : e.kind === 'citizen' ? e.citizen : e.surfaceId
    ));
    expect(railIds).toEqual(['colors', 'b', 'a']);
  });

  it('omits a rail entry for a channel no longer in the roster (deleted, retained-but-not-rendered)', () => {
    const layout = freshLayout(THREE);
    const roster = rosterOf(THREE);
    const closed = close(layout, channelSurfaceId('b'), roster);
    const shrunk = THREE.filter((c) => c.id !== 'b'); // 'b' deleted from the roster
    const plan = buildMixerBarPlan(shrunk, closed, false, null);
    expect(plan.rail.some((e) => e.kind === 'channel' && e.channelId === 'b')).toBe(false);
  });

  it('showHiddenDivider is true iff the rail is non-empty', () => {
    // Opening COLORS empties the visible bar's citizen rail. The retired
    // master preference is ignored rather than rendered.
    const withColors = layoutReducer(freshLayout(THREE), { type: 'open', id: citizenSurfaceId('colors') });
    const layout = withColors;
    expect(buildMixerBarPlan(THREE, layout, false, null).showHiddenDivider).toBe(false);
    const closed = close(layout, channelSurfaceId('a'), rosterOf(THREE));
    expect(buildMixerBarPlan(THREE, closed, false, null).showHiddenDivider).toBe(true);
    // And the shipped default (COLORS closed) already shows a divider.
    expect(buildMixerBarPlan(THREE, freshLayout(THREE), false, null).showHiddenDivider).toBe(true);
  });
});

describe('buildMixerBarPlan — the floor', () => {
  it('marks exactly the given floorChannelId as floorDisabled, and only among shown channels', () => {
    const layout = freshLayout(THREE);
    const closed = layoutReducer(
      layoutReducer(layout, { type: 'close', id: channelSurfaceId('b'), roster: rosterOf(THREE) }),
      { type: 'close', id: channelSurfaceId('c'), roster: rosterOf(THREE) },
    );
    const plan = buildMixerBarPlan(THREE, closed, false, 'a');
    const shownChannels = plan.shown.filter((e): e is Extract<MixerBarChipEntry, { kind: 'channel' }> => e.kind === 'channel');
    expect(shownChannels).toHaveLength(1);
    expect(shownChannels[0].channelId).toBe('a');
    expect(shownChannels[0].floorDisabled).toBe(true);
  });

  it('floorChannelId null/undefined disables nothing', () => {
    const layout = freshLayout(THREE);
    const planNull = buildMixerBarPlan(THREE, layout, false, null);
    const planUndef = buildMixerBarPlan(THREE, layout, false, undefined);
    for (const plan of [planNull, planUndef]) {
      const shownChannels = plan.shown.filter((e): e is Extract<MixerBarChipEntry, { kind: 'channel' }> => e.kind === 'channel');
      expect(shownChannels.every((e) => e.floorDisabled === false)).toBe(true);
    }
  });

  it('a rail (hidden) chip is never floorDisabled, even if its id happens to match', () => {
    const layout = freshLayout(THREE);
    const closed = close(layout, channelSurfaceId('a'), rosterOf(THREE));
    const plan = buildMixerBarPlan(THREE, closed, false, 'a');
    const railA = plan.rail.find((e) => e.kind === 'channel' && e.channelId === 'a') as Extract<MixerBarChipEntry, { kind: 'channel' }>;
    expect(railA.floorDisabled).toBe(false);
  });
});

describe('buildMixerBarPlan — muted styling (docs/64 §2.4)', () => {
  it('showMutedStyle is true ONLY for a hidden AND muted channel', () => {
    const channels = [ch('a', 1, 'Sparkle', { muted: true }), ch('b', 2, 'Ocean Liner', { muted: false })];
    const roster = rosterOf(channels);
    const layout = initialLayout(roster);
    // Close 'a' (2 visible → 1, allowed). A second close would hit the floor
    // (1 visible channel left) and no-op, so 'b' deterministically stays open.
    const closed = layoutReducer(layout, { type: 'close', id: channelSurfaceId('a'), roster });
    const plan = buildMixerBarPlan(channels, closed, false, null);

    const railA = plan.rail.find((e) => e.kind === 'channel' && e.channelId === 'a') as Extract<MixerBarChipEntry, { kind: 'channel' }>;
    const shownB = plan.shown.find((e) => e.kind === 'channel' && e.channelId === 'b') as Extract<MixerBarChipEntry, { kind: 'channel' }>;
    expect(railA.showMutedStyle).toBe(true); // hidden AND muted
    expect(shownB.showMutedStyle).toBe(false); // shown — never carries the flag
  });

  it('a shown-and-muted channel never carries the muted style (the strip already shows mute there)', () => {
    const channels = [ch('a', 1, 'Sparkle', { muted: true }), ch('b', 2, 'Ocean Liner')];
    const layout = initialLayout(rosterOf(channels));
    const plan = buildMixerBarPlan(channels, layout, false, null);
    const a = plan.shown.find((e) => e.kind === 'channel' && e.channelId === 'a') as Extract<MixerBarChipEntry, { kind: 'channel' }>;
    expect(a.muted).toBe(true);
    expect(a.showMutedStyle).toBe(false);
  });
});

describe('buildMixerBarPlan — performance mode', () => {
  it('does not reserve a non-actionable performance caption slot', () => {
    const layout = freshLayout(THREE);
    expect(buildMixerBarPlan(THREE, layout, false, null)).not.toHaveProperty('showPerfCaption');
    expect(buildMixerBarPlan(THREE, layout, true, null)).not.toHaveProperty('showPerfCaption');
  });

  it('perf mode never hides/removes a channel chip (it only suppresses PARAMS sections, out of this bar\'s scope)', () => {
    const layout = freshLayout(THREE);
    const off = buildMixerBarPlan(THREE, layout, false, null);
    const on = buildMixerBarPlan(THREE, layout, true, null);
    const idsOff = off.shown.filter((e) => e.kind === 'channel').map((e) => (e as any).channelId);
    const idsOn = on.shown.filter((e) => e.kind === 'channel').map((e) => (e as any).channelId);
    expect(idsOn).toEqual(idsOff);
  });

  it('perf mode never widens citizen visibility beyond what the operator closed', () => {
    const layout = freshLayout(THREE); // colors defaults CLOSED
    const on = buildMixerBarPlan(THREE, layout, true, null);
    expect(on.shown.some((e) => e.kind === 'citizen' && e.citizen === 'colors')).toBe(false);
  });
});

describe('buildMixerBarPlan — label composition', () => {
  it('channel entries carry the index-dot label and citizen entries carry their fixed title', () => {
    const layout = freshLayout(THREE);
    const plan = buildMixerBarPlan(THREE, layout, false, null);
    const a = plan.shown.find((e) => e.kind === 'channel' && e.channelId === 'a')!;
    expect(a.label).toBe('1 · Sparkle');
    const colors = plan.rail.find((e) => e.kind === 'citizen' && e.citizen === 'colors')!;
    expect(colors.label).toBe(COLORS_TITLE);
  });
});

describe('buildMixerBarPlan — determinism', () => {
  it('the same inputs produce a structurally identical plan every time', () => {
    const layout = freshLayout(THREE);
    const p1 = buildMixerBarPlan(THREE, layout, false, null);
    const p2 = buildMixerBarPlan(THREE, layout, false, null);
    expect(p1).toEqual(p2);
  });
});

// ── docs/67 §4.2 — the overflow hint's one decision ────────────────────────

describe('shouldShowBarOverflowHint (docs/67 §4.2, decision D4)', () => {
  it('is FALSE before the first layout pass (nothing measured yet)', () => {
    expect(shouldShowBarOverflowHint({ content: 0, viewport: 0, offset: 0 })).toBe(false);
    // Content measured, viewport not: still nothing to compare against.
    expect(shouldShowBarOverflowHint({ content: 904, viewport: 0, offset: 0 })).toBe(false);
  });

  it('is FALSE when the content fits the viewport', () => {
    expect(shouldShowBarOverflowHint({ content: 700, viewport: 831, offset: 0 })).toBe(false);
    expect(shouldShowBarOverflowHint({ content: 831, viewport: 831, offset: 0 })).toBe(false);
  });

  it('is TRUE for the measured fresh-store overflow (904 pt of chips in an 831 pt bar)', () => {
    // The §1.2 repro: this is the state where the COLORS chip was left a
    // 38 pt sliver past the fold with nothing advertising the scroll.
    expect(shouldShowBarOverflowHint({ content: 904, viewport: 831, offset: 0 })).toBe(true);
  });

  it('is FALSE once the operator has scrolled to the end — the hint never lies', () => {
    const atEnd = { content: 904, viewport: 831, offset: 904 - 831 };
    expect(shouldShowBarOverflowHint(atEnd)).toBe(false);
    // Mid-scroll it is still true: there IS more to the right.
    expect(shouldShowBarOverflowHint({ ...atEnd, offset: 20 })).toBe(true);
  });

  it('is FALSE under iOS rubber-band overscroll past the end (negative remaining)', () => {
    expect(shouldShowBarOverflowHint({ content: 904, viewport: 831, offset: 140 })).toBe(false);
  });

  it('absorbs sub-pixel rounding on both comparisons via the 1 pt epsilon', () => {
    expect(MIXER_BAR_OVERFLOW_EPSILON).toBe(1);
    // Content a hair over the viewport is NOT a fold.
    expect(shouldShowBarOverflowHint({ content: 831.4, viewport: 831, offset: 0 })).toBe(false);
    // A hair short of the end is NOT "more to see".
    expect(shouldShowBarOverflowHint({ content: 904, viewport: 831, offset: 72.4 })).toBe(false);
  });
});
