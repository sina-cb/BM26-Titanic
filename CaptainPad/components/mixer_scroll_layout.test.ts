import { describe, expect, it } from 'vitest';

import { BAND_HEADER_HEIGHT, MIN_BAND_CANVAS_HEIGHT } from '@/components/mixer/pixel_view_band_logic';

import {
  MIXER_BOUNDED_SCROLL_AREA,
  MIXER_CHANNEL_CARD_MAX_ROW_FRACTION,
  MIXER_CHANNEL_CARD_TRACK,
  MIXER_CHANNEL_CARD_WIDTH,
  MIXER_LANDSCAPE_PARAMS_PANEL_COLLAPSED,
  MIXER_LANDSCAPE_PARAMS_PANEL_EMPTY,
  MIXER_LANDSCAPE_PLAYLIST_PANEL_EXPANDED,
  MIXER_PORTRAIT_PARAMS_PANEL,
  MIXER_PORTRAIT_PARAMS_PANEL_COLLAPSED,
  MIXER_PORTRAIT_PLAYLIST_PANEL,
  MIXER_TALL_PORTRAIT_PARAMS_PANEL,
  MIXER_TALL_PORTRAIT_PLAYLIST_PANEL,
  MIXER_COMPACT_PORTRAIT_MAX_STRIP_HEIGHT,
  isCompactMixerPortrait,
  mixerChannelContentLayout,
  mixerChannelRowSizing,
  mixerLandscapeMediaBandSlot,
  mixerMediaColumnMode,
  mixerParamsColumnMode,
} from './mixer_scroll_layout';

describe('Mixer channel row — uniform cards and reachable overflow', () => {
  it('keeps the shipped 320pt track as the hard minimum without a flex shorthand', () => {
    expect(MIXER_CHANNEL_CARD_WIDTH).toBe(320);
    expect(MIXER_CHANNEL_CARD_TRACK).toEqual({
      width: 320,
      minWidth: 320,
      maxWidth: 320,
      flexGrow: 0,
      flexShrink: 0,
    });
    expect('flex' in MIXER_CHANNEL_CARD_TRACK).toBe(false);
    expect('flexBasis' in MIXER_CHANNEL_CARD_TRACK).toBe(false);
  });

  it('caps one channel at 50% and lets two fill the padded, gapped row', () => {
    expect(MIXER_CHANNEL_CARD_MAX_ROW_FRACTION).toBe(0.5);
    const one = mixerChannelRowSizing({
      viewportWidth: 1440,
      channelCount: 1,
      horizontalPadding: 16,
      gapWidths: [],
      fixedItemWidths: [],
    });
    const two = mixerChannelRowSizing({
      viewportWidth: 1440,
      channelCount: 2,
      horizontalPadding: 16,
      gapWidths: [16],
      fixedItemWidths: [],
    });

    expect(one.cardWidth).toBe(704);
    expect(one.cardWidth).toBe(one.availableChannelWidth * 0.5);
    expect(one.overflow).toBe(false);
    expect(two.cardWidth).toBe(696);
    expect(two.requiredContentWidth).toBe(1440);
    expect(two.overflow).toBe(false);
  });

  it('budgets explicit gaps, padding, fixed citizens, and group frames', () => {
    const layout = mixerChannelRowSizing({
      viewportWidth: 1600,
      channelCount: 2,
      horizontalPadding: 20,
      gapWidths: [16, 12],
      fixedItemWidths: [380, 18],
    });

    expect(layout.availableChannelWidth).toBe(1134);
    expect(layout.cardWidth).toBe(567);
    expect(layout.requiredContentWidth).toBe(1600);
    expect(layout.cardTrack.width).toBe(layout.cardTrack.maxWidth);
    expect(layout.cardTrack.width).toBe(layout.cardTrack.minWidth);
  });

  it('keeps all cards at the minimum and reports overflow when fit is too narrow', () => {
    const layout = mixerChannelRowSizing({
      viewportWidth: 1024,
      channelCount: 4,
      horizontalPadding: 16,
      gapWidths: [16, 16, 16],
      fixedItemWidths: [],
    });

    expect(layout.cardWidth).toBe(320);
    expect(layout.requiredContentWidth).toBe(1360);
    expect(layout.overflow).toBe(true);
  });

  it('fails loudly on malformed geometry', () => {
    expect(() => mixerChannelRowSizing({
      viewportWidth: 1024,
      channelCount: 1.5,
      horizontalPadding: 16,
      gapWidths: [],
      fixedItemWidths: [],
    })).toThrow('channelCount must be an integer');
  });
});

describe('Mixer bounded scroll layout', () => {
  it('allows a nested playlist viewport to shrink beneath fixed strip controls', () => {
    expect(MIXER_BOUNDED_SCROLL_AREA).toEqual({ minHeight: 0 });
  });

  it('prioritizes the playlist while bounding both compact-portrait panels', () => {
    expect(MIXER_PORTRAIT_PLAYLIST_PANEL).toEqual({
      flexGrow: 3,
      flexShrink: 1,
      flexBasis: 0,
      minHeight: 0,
    });
    expect(MIXER_PORTRAIT_PARAMS_PANEL).toEqual({
      flexGrow: 1,
      flexShrink: 1,
      flexBasis: 0,
      minHeight: 0,
    });
  });

  it('still bounds both panels on a tall portrait strip, giving params more relative room', () => {
    expect(MIXER_TALL_PORTRAIT_PLAYLIST_PANEL).toEqual({
      flexGrow: 2,
      flexShrink: 1,
      flexBasis: 0,
      minHeight: 0,
    });
    expect(MIXER_TALL_PORTRAIT_PARAMS_PANEL).toEqual({
      flexGrow: 1,
      flexShrink: 1,
      flexBasis: 0,
      minHeight: 0,
    });
    // The playlist keeps the larger share at every strip height.
    expect(MIXER_TALL_PORTRAIT_PLAYLIST_PANEL.flexGrow)
      .toBeGreaterThan(MIXER_TALL_PORTRAIT_PARAMS_PANEL.flexGrow);
  });

  it('never lets a portrait panel fall back to an unshrinkable minHeight floor', () => {
    for (const panel of [
      MIXER_PORTRAIT_PLAYLIST_PANEL,
      MIXER_PORTRAIT_PARAMS_PANEL,
      MIXER_TALL_PORTRAIT_PLAYLIST_PANEL,
      MIXER_TALL_PORTRAIT_PARAMS_PANEL,
    ]) {
      expect(panel.flexBasis).toBe(0);
      expect(panel.flexShrink).toBe(1);
      expect(panel.minHeight).toBe(0);
    }
  });

  it('uses the measured strip instead of a browser-reported window height', () => {
    expect(isCompactMixerPortrait(true, MIXER_COMPACT_PORTRAIT_MAX_STRIP_HEIGHT - 1)).toBe(true);
    expect(isCompactMixerPortrait(true, MIXER_COMPACT_PORTRAIT_MAX_STRIP_HEIGHT)).toBe(false);
    expect(isCompactMixerPortrait(false, 451)).toBe(false);
    expect(isCompactMixerPortrait(true, 0)).toBe(true);
  });
});

// ── The vacated params column (operator ask 2026-08-16) ─────────────────────
// "when hiding params, make room for the pattern list so we show more patterns
//  in the view — that was the whole purpose of hiding the params"

describe('Mixer params column — what it renders decides what it claims', () => {
  it('claims its full share only while it is actually showing something big', () => {
    // Edit mode, section shown: the sliders.
    expect(mixerParamsColumnMode({ perfActive: false, paramsShown: true, pixelsShown: true }))
      .toBe('full');
    expect(mixerParamsColumnMode({ perfActive: false, paramsShown: true, pixelsShown: false }))
      .toBe('full');
    // Perf mode: the dominant pixel band moves in and owns the column.
    expect(mixerParamsColumnMode({ perfActive: true, paramsShown: true, pixelsShown: true }))
      .toBe('full');
  });

  it('drops to the 28px stub when the operator hides the section in edit mode', () => {
    expect(mixerParamsColumnMode({ perfActive: false, paramsShown: false, pixelsShown: true }))
      .toBe('stub');
    expect(mixerParamsColumnMode({ perfActive: false, paramsShown: false, pixelsShown: false }))
      .toBe('stub');
  });

  it('claims nothing at all when perf mode has no band to put there either', () => {
    // docs/64 §2.6/§3.5 D4: perf never resurrects an operator-hidden band, so
    // this column genuinely renders nothing and must cost the row nothing.
    expect(mixerParamsColumnMode({ perfActive: true, paramsShown: true, pixelsShown: false }))
      .toBe('empty');
    expect(mixerParamsColumnMode({ perfActive: true, paramsShown: false, pixelsShown: false }))
      .toBe('empty');
  });

  it('ignores the stored params preference while perf mode owns the column', () => {
    // Perf has already replaced the sliders with the band, so `paramsShown`
    // cannot change what occupies the column — only `pixelsShown` can.
    for (const pixelsShown of [true, false]) {
      expect(mixerParamsColumnMode({ perfActive: true, paramsShown: true, pixelsShown }))
        .toBe(mixerParamsColumnMode({ perfActive: true, paramsShown: false, pixelsShown }));
    }
  });

  it('gives the freed PORTRAIT height away by dropping the panel flex weight', () => {
    // The defect this fixes: a hidden panel kept flexGrow 1 and held a
    // quarter/third of the body while rendering only its stub.
    expect(MIXER_PORTRAIT_PARAMS_PANEL.flexGrow).toBe(1);
    expect(MIXER_PORTRAIT_PARAMS_PANEL_COLLAPSED.flexGrow).toBe(0);
    expect(MIXER_PORTRAIT_PARAMS_PANEL_COLLAPSED.flexBasis).toBe('auto');
    // The stub itself must never be squeezed away by the playlist's growth —
    // the section would become unreachable on the card (docs/64 §3.1).
    expect(MIXER_PORTRAIT_PARAMS_PANEL_COLLAPSED.flexShrink).toBe(0);
    // Width is untouched: the portrait stub keeps spanning the strip, so the
    // chevron stays where the operator last saw it.
    expect('width' in MIXER_PORTRAIT_PARAMS_PANEL_COLLAPSED).toBe(false);
  });

  it('gives the freed LANDSCAPE width away by clearing the 40% column', () => {
    expect(MIXER_LANDSCAPE_PARAMS_PANEL_COLLAPSED.width).toBe('auto');
    expect(MIXER_LANDSCAPE_PARAMS_PANEL_COLLAPSED.flexGrow).toBe(0);
    expect(MIXER_LANDSCAPE_PARAMS_PANEL_COLLAPSED.flexBasis).toBe('auto');

    // …and the playlist beside it becomes the row's only grower.
    expect(MIXER_LANDSCAPE_PLAYLIST_PANEL_EXPANDED.width).toBe('auto');
    expect(MIXER_LANDSCAPE_PLAYLIST_PANEL_EXPANDED.flexGrow).toBe(1);
    expect(MIXER_LANDSCAPE_PLAYLIST_PANEL_EXPANDED.flexBasis).toBe(0);
    expect(MIXER_LANDSCAPE_PLAYLIST_PANEL_EXPANDED.minWidth).toBe(0);
  });

  it('docs/69 W3 MISS 1: the collapsed LANDSCAPE column can shrink but never below the docs/66 44pt floor', () => {
    // Was `flexShrink: 0` (`_279`'s deliberate rigidity, to keep the stub
    // tappable) — that rigidity is what let a 247.64 px collapsed PIXELS
    // header force the column wide instead of hugging its real content
    // (measured docs/69 §4.2, both PIXELS and LOCAL PARAMS hidden). The fix
    // is two-part: `pixel_view_band.tsx`'s `compactWhenCollapsed` prop stops
    // the header from BEING 247.64 px wide in the first place, and this
    // constant flips to a real, testable floor instead of rigidity so the
    // column can still give up space it doesn't need without ever losing the
    // tap target the rigidity was protecting.
    expect(MIXER_LANDSCAPE_PARAMS_PANEL_COLLAPSED.flexShrink).toBe(1);
    expect(MIXER_LANDSCAPE_PARAMS_PANEL_COLLAPSED.minWidth).toBe(44);
    // Clips at its own edge rather than spilling onto the playlist beside it
    // if content ever still exceeds the shrunk column.
    expect(MIXER_LANDSCAPE_PARAMS_PANEL_COLLAPSED.overflow).toBe('hidden');
  });

  it('never clears a width with `undefined`, which react-native-web ignores', () => {
    // The bug this pins cost a whole verification round: `width: undefined` in
    // a later style object does NOT override `width: '40%'` from an earlier
    // one on RNW (the resolver drops undefined instead of overwriting), so the
    // landscape column silently kept its full 40 % while rendering only the
    // stub. Every width these overrides set must be a REAL value.
    for (const panel of [
      MIXER_LANDSCAPE_PARAMS_PANEL_COLLAPSED,
      MIXER_LANDSCAPE_PARAMS_PANEL_EMPTY,
      MIXER_LANDSCAPE_PLAYLIST_PANEL_EXPANDED,
    ]) {
      expect(panel).toHaveProperty('width');
      expect(panel.width).not.toBeUndefined();
    }
  });

  it('lets an empty landscape column cost the row nothing, padding included', () => {
    expect(MIXER_LANDSCAPE_PARAMS_PANEL_EMPTY.width).toBe(0);
    expect(MIXER_LANDSCAPE_PARAMS_PANEL_EMPTY.flexGrow).toBe(0);
    expect(MIXER_LANDSCAPE_PARAMS_PANEL_EMPTY.flexBasis).toBe(0);
    // `paramsPanel` pads 8 all round; an empty column must not leave a ghost
    // 16pt gutter where the sliders used to be.
    expect(MIXER_LANDSCAPE_PARAMS_PANEL_EMPTY.padding).toBe(0);
  });

  it('keeps every collapsed panel inside the bounded-shrink chain', () => {
    for (const panel of [
      MIXER_PORTRAIT_PARAMS_PANEL_COLLAPSED,
      MIXER_LANDSCAPE_PARAMS_PANEL_COLLAPSED,
      MIXER_LANDSCAPE_PARAMS_PANEL_EMPTY,
      MIXER_LANDSCAPE_PLAYLIST_PANEL_EXPANDED,
    ]) {
      expect(panel.minHeight).toBe(0);
    }
  });

  it('never lets a flex shorthand co-flatten with a longhand-only collapsed constant (docs/69 §1/§2.4 class sweep)', () => {
    // A positive `flex: N` shorthand survives flattening over a longhand
    // `flexBasis: 'auto'` on native Yoga and forces basis 0 regardless — the
    // `_273`/`_275` portrait-rail trap (`master_bar_seat_yoga.test.ts`).
    // Every constant below is safe only because it composes over bases with
    // NO `flex` shorthand key; pin the absence so a future edit can't
    // reintroduce the class of bug here.
    for (const panel of [
      MIXER_PORTRAIT_PARAMS_PANEL_COLLAPSED,
      MIXER_LANDSCAPE_PARAMS_PANEL_COLLAPSED,
      MIXER_LANDSCAPE_PARAMS_PANEL_EMPTY,
      MIXER_LANDSCAPE_PLAYLIST_PANEL_EXPANDED,
      mixerLandscapeMediaBandSlot(true),
      mixerLandscapeMediaBandSlot(false),
    ]) {
      expect('flex' in panel).toBe(false);
    }
  });
});

// ── The patterns-first landscape card (docs/69 W3, operator order 3) ───────
// "in horizontal layout the pattern list is basically not showing up to
//  select patterns... rethink the layout to make the patterns themselves
//  show up please"

describe('Mixer media column — the relocated band + params, together', () => {
  const perfSwitch = [true, false];
  const portraitSwitch = [true, false];
  const shownSwitch = [true, false];

  it('delegates to mixerParamsColumnMode byte-for-byte whenever perf or portrait applies (do not re-derive)', () => {
    for (const perfActive of perfSwitch) {
      for (const isPortrait of portraitSwitch) {
        if (!perfActive && !isPortrait) continue; // the one NEW branch, covered below
        for (const paramsShown of shownSwitch) {
          for (const pixelsShown of shownSwitch) {
            expect(mixerMediaColumnMode({ perfActive, isPortrait, paramsShown, pixelsShown }))
              .toBe(mixerParamsColumnMode({ perfActive, paramsShown, pixelsShown }));
          }
        }
      }
    }
  });

  it('LANDSCAPE EDIT: claims its full share whenever EITHER occupant is showing something real', () => {
    // Required composition, docs/69 §4.2 — the crux of this wave.
    expect(mixerMediaColumnMode({ perfActive: false, isPortrait: false, paramsShown: true, pixelsShown: true }))
      .toBe('full');
    // params hidden, pixels shown → the band keeps the column's width.
    expect(mixerMediaColumnMode({ perfActive: false, isPortrait: false, paramsShown: false, pixelsShown: true }))
      .toBe('full');
    // pixels hidden, params shown → params keeps the column's width.
    expect(mixerMediaColumnMode({ perfActive: false, isPortrait: false, paramsShown: true, pixelsShown: false }))
      .toBe('full');
  });

  it('LANDSCAPE EDIT: hugs its stubs only when BOTH occupants are hidden', () => {
    expect(mixerMediaColumnMode({ perfActive: false, isPortrait: false, paramsShown: false, pixelsShown: false }))
      .toBe('stub');
  });

  it('LANDSCAPE EDIT never claims `empty` — unlike perf, there is always at least a stub to show', () => {
    for (const paramsShown of shownSwitch) {
      for (const pixelsShown of shownSwitch) {
        expect(mixerMediaColumnMode({ perfActive: false, isPortrait: false, paramsShown, pixelsShown }))
          .not.toBe('empty');
      }
    }
  });

  it('the full perfActive × isPortrait × paramsShown × pixelsShown matrix resolves without throwing and stays in the known set', () => {
    const known = new Set(['full', 'stub', 'empty']);
    for (const perfActive of perfSwitch) {
      for (const isPortrait of portraitSwitch) {
        for (const paramsShown of shownSwitch) {
          for (const pixelsShown of shownSwitch) {
            const mode = mixerMediaColumnMode({ perfActive, isPortrait, paramsShown, pixelsShown });
            expect(known.has(mode)).toBe(true);
          }
        }
      }
    }
  });

  it("bounds the relocated band's own slot with a floor that follows whether its picture is actually open", () => {
    // Picture open: the header AND the aspect-honest canvas's own floor
    // (`pixel_view_band_logic.MIN_BAND_CANVAS_HEIGHT`) must both stay
    // reachable before the band gives any more space to LOCAL PARAMS.
    const open = mixerLandscapeMediaBandSlot(true);
    expect(open.minHeight).toBe(BAND_HEADER_HEIGHT + MIN_BAND_CANVAS_HEIGHT);
    expect(open.flexShrink).toBe(1);
    expect(open.flexGrow).toBe(0);
    expect(open.flexBasis).toBe('auto');
    // Contained: a starved column clips the band at its own boundary rather
    // than painting over LOCAL PARAMS beneath it (`_285` §7).
    expect(open.overflow).toBe('hidden');

    // Picture collapsed: only the header renders, so the floor is just the
    // header — the stub costs the column nothing beyond its own 28 px.
    const collapsed = mixerLandscapeMediaBandSlot(false);
    expect(collapsed.minHeight).toBe(BAND_HEADER_HEIGHT);
  });

  it("never lowers CHANNEL_EDIT_CAP_HEIGHT — the band's own picture ceiling is untouched by its new slot", () => {
    // The slot bounds where the band SITS; it must never touch what the band
    // PAINTS. `mixerLandscapeMediaBandSlot`'s only keys are flex/overflow —
    // no `capHeight`, no `CHANNEL_EDIT_CAP_HEIGHT`, no sizing math at all.
    for (const pixelsShown of shownSwitch) {
      const slot = mixerLandscapeMediaBandSlot(pixelsShown);
      const keys = Object.keys(slot).sort();
      expect(keys).toEqual(['flexBasis', 'flexGrow', 'flexShrink', 'minHeight', 'overflow']);
    }
  });
});

describe('Mixer channel content — Performance preserves Edit geometry', () => {
  it('keeps 2D placement, expansion, and pattern/media allocation identical in both modes', () => {
    for (const isPortrait of [true, false]) {
      for (const paramsShown of [true, false]) {
        for (const pixelsShown of [true, false]) {
          const shared = { isPortrait, paramsShown, pixelsShown };
          const edit = mixerChannelContentLayout({
            ...shared,
            performanceModeActive: false,
          });
          const performance = mixerChannelContentLayout({
            ...shared,
            performanceModeActive: true,
          });

          expect(performance).toEqual(edit);
          expect(performance.forcePixelExpanded).toBe(false);
          expect(performance.showPortraitPixelBand).toBe(isPortrait);
          expect(performance.showLandscapePixelBand).toBe(!isPortrait);
          expect(performance.mediaColumnMode).not.toBe('empty');
        }
      }
    }
  });
});
