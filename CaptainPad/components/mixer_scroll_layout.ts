import { BAND_HEADER_HEIGHT, MIN_BAND_CANVAS_HEIGHT } from '@/components/mixer/pixel_view_band_logic';

/**
 * Shared layout contract for a scrollable region inside a Mixer strip.
 *
 * Every flex ancestor between the strip and its ScrollView must be allowed to
 * shrink. On web, the default automatic minimum height is the playlist's full
 * content height, which otherwise puts entries beneath the strip's fixed
 * action and transition rows instead of giving the list a scroll viewport.
 */
export const MIXER_BOUNDED_SCROLL_AREA = {
  minHeight: 0,
} as const;

/** The shipped compact width is now the hard floor, not the fixed width. */
export const MIXER_CHANNEL_CARD_WIDTH = 320;
export const MIXER_CHANNEL_CARD_TRACK = {
  width: MIXER_CHANNEL_CARD_WIDTH,
  minWidth: MIXER_CHANNEL_CARD_WIDTH,
  maxWidth: MIXER_CHANNEL_CARD_WIDTH,
  flexGrow: 0,
  flexShrink: 0,
} as const;

export const MIXER_CHANNEL_CARD_MAX_ROW_FRACTION = 0.5;
export const MIXER_CHANNEL_ROW_PADDING = 16;
export const MIXER_CHANNEL_ROW_GAP = 16;
export const MIXER_GROUP_HORIZONTAL_PADDING = 8;
export const MIXER_GROUP_BORDER_WIDTH = 1;
export const MIXER_GROUP_MEMBER_GAP = 12;
export const MIXER_COLLAPSED_GROUP_WIDTH = 60;
export const MIXER_COLORS_CARD_WIDTH = 380;

export interface MixerChannelRowSizingOptions {
  viewportWidth: number;
  channelCount: number;
  horizontalPadding: number;
  /** Every actual row/group gap, expressed separately so tests and callers
   * cannot accidentally hide spacing inside a guessed viewport width. */
  gapWidths: readonly number[];
  /** Non-channel occupants and frames: COLORS, collapsed-group bars, and
   * expanded-group padding/borders. */
  fixedItemWidths: readonly number[];
}

export interface MixerChannelRowSizing {
  cardWidth: number;
  availableChannelWidth: number;
  requiredContentWidth: number;
  overflow: boolean;
  cardTrack: {
    width: number;
    minWidth: number;
    maxWidth: number;
    flexGrow: 0;
    flexShrink: 0;
  };
}

function assertNonNegativeFinite(label: string, value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`[mixer_scroll_layout] ${label} must be a non-negative finite number; got ${value}`);
  }
}

/**
 * Computes the one width shared by every expanded, visible Mixer channel.
 *
 * Fixed chrome is removed first. The remaining channel budget is divided
 * equally, capped at half of that budget, and floored at the shipped 320pt
 * width. The minimum deliberately wins when a narrow viewport makes the
 * minimum and 50% cap mutually exclusive; `overflow` then requires the native
 * horizontal host. Integer point widths avoid Yoga edge-rounding producing
 * visually unequal siblings from the same fractional style value.
 */
export function mixerChannelRowSizing(
  options: MixerChannelRowSizingOptions,
): MixerChannelRowSizing {
  assertNonNegativeFinite('viewportWidth', options.viewportWidth);
  assertNonNegativeFinite('channelCount', options.channelCount);
  assertNonNegativeFinite('horizontalPadding', options.horizontalPadding);
  if (!Number.isInteger(options.channelCount)) {
    throw new Error(`[mixer_scroll_layout] channelCount must be an integer; got ${options.channelCount}`);
  }
  options.gapWidths.forEach((width, index) => assertNonNegativeFinite(`gapWidths[${index}]`, width));
  options.fixedItemWidths.forEach((width, index) => assertNonNegativeFinite(`fixedItemWidths[${index}]`, width));

  const gapWidth = options.gapWidths.reduce((sum, width) => sum + width, 0);
  const fixedItemWidth = options.fixedItemWidths.reduce((sum, width) => sum + width, 0);
  const fixedChromeWidth = (options.horizontalPadding * 2) + gapWidth + fixedItemWidth;
  const availableChannelWidth = Math.max(0, options.viewportWidth - fixedChromeWidth);
  const equalFitWidth = options.channelCount > 0
    ? availableChannelWidth / options.channelCount
    : 0;
  const cappedWidth = Math.min(
    equalFitWidth,
    availableChannelWidth * MIXER_CHANNEL_CARD_MAX_ROW_FRACTION,
  );
  const cardWidth = options.channelCount > 0
    ? Math.max(MIXER_CHANNEL_CARD_WIDTH, Math.floor(cappedWidth))
    : MIXER_CHANNEL_CARD_WIDTH;
  const requiredContentWidth = fixedChromeWidth + (cardWidth * options.channelCount);
  const overflow = requiredContentWidth > options.viewportWidth;

  return {
    cardWidth,
    availableChannelWidth,
    requiredContentWidth,
    overflow,
    cardTrack: {
      width: cardWidth,
      minWidth: cardWidth,
      maxWidth: cardWidth,
      flexGrow: 0,
      flexShrink: 0,
    },
  };
}

export const MIXER_COMPACT_PORTRAIT_MAX_STRIP_HEIGHT = 560;

/** A browser can report an iPad-sized window while a narrow desktop window
 * clips the actual strip. Use the measured strip height—the value that bounds
 * its panels—instead of the global window height. */
export function isCompactMixerPortrait(isPortrait: boolean, stripHeight: number): boolean {
  return isPortrait
    && (stripHeight === 0 || stripHeight < MIXER_COMPACT_PORTRAIT_MAX_STRIP_HEIGHT);
}

/**
 * The bounded flex chain every portrait strip body uses, at every card
 * height (W0 fix, docs/64 §1 M3 / §3.7). Both panels are sized by flex
 * WEIGHT (flexBasis:0 + flexGrow + flexShrink:1), never by an unshrinkable
 * minHeight, so together they can never exceed the space `channelBody`'s own
 * flex box actually allotted them.
 *
 * Before this fix, only a "compact" (short/narrow) portrait strip got a
 * bounded chain — a real iPad portrait card measures ~1100+pt tall, well
 * past the compact gate (`MIXER_COMPACT_PORTRAIT_MAX_STRIP_HEIGHT` = 560), so
 * it kept the old unbounded `minHeight:220` playlist floor and an auto-height
 * params column below it. Neither has `flexShrink`, so they never
 * participated in the shrink negotiation: `channelBody` itself correctly
 * shrank to its allotted remainder (it has `minHeight:0`), but its two
 * children did not, and rendered past that remainder — clipped only at the
 * CARD's outer `overflow:hidden` boundary, not at the body's own. The
 * MUTE/SOLO/BUMP and TRANSITION rows, laid out right after the body using
 * its (correctly shrunk, too-small) box, ended up sharing screen space with
 * the still-overflowing body content instead of sitting cleanly below it —
 * and LOCAL PARAMS / the perf pixel view, stacked furthest down that
 * overflowing column, fell past the card's total height and were clipped
 * away entirely (present in the DOM, invisible on screen).
 *
 * The playlist keeps the larger share — it's the primary surface.
 */
export const MIXER_PORTRAIT_PLAYLIST_PANEL = {
  flexGrow: 3,
  flexShrink: 1,
  flexBasis: 0,
  ...MIXER_BOUNDED_SCROLL_AREA,
} as const;

export const MIXER_PORTRAIT_PARAMS_PANEL = {
  flexGrow: 1,
  flexShrink: 1,
  flexBasis: 0,
  ...MIXER_BOUNDED_SCROLL_AREA,
} as const;

/**
 * A tall portrait card (measured strip height at/above the compact
 * threshold) has room to spare: LOCAL PARAMS can afford more relative room
 * than the tight 3:1 split a cramped strip needs. (docs/64 §3.7 W5: the
 * perf-mode dominant pixel view no longer fills this column in portrait —
 * it renders full-card-width, aspect-fit, ABOVE the body instead, since a
 * ~470pt portrait card has no room for the landscape side-by-side split;
 * see `mixer.tsx`'s ChannelStrip. This tier now only ever holds LOCAL
 * PARAMS.) An explicit, tested tier rather than the old accidental "don't
 * bound it at all" behavior — still flex-weighted and shrinkable (never an
 * unshrinkable floor), so it stays safe right at the threshold boundary,
 * and the playlist
 * still keeps the larger share.
 */
export const MIXER_TALL_PORTRAIT_PLAYLIST_PANEL = {
  flexGrow: 2,
  flexShrink: 1,
  flexBasis: 0,
  ...MIXER_BOUNDED_SCROLL_AREA,
} as const;

export const MIXER_TALL_PORTRAIT_PARAMS_PANEL = {
  flexGrow: 1,
  flexShrink: 1,
  flexBasis: 0,
  ...MIXER_BOUNDED_SCROLL_AREA,
} as const;

// ── The vacated params column (operator ask 2026-08-16) ────────────────────
//
// "when hiding params, make room for the pattern list so we show more patterns
//  in the view — that was the whole purpose of hiding the params"
//
// Before this, hiding `sec/<id>/params` freed NOTHING. The panel kept its full
// share of the strip body in both orientations — its portrait flex WEIGHT
// (`MIXER_*_PORTRAIT_PARAMS_PANEL` above, flexGrow 1) and its landscape 40 %
// column width — while rendering only the 28 px micro-header stub. Measured on
// the shipped build at iPad sizes: the playlist scroller was byte-identical
// with params shown and hidden (portrait 158 pt / 2 rows either way; landscape
// 24 pt / 1 row either way) and the vacated area was simply dead: a ~100 pt
// empty band under the stub in portrait, a 135 × 102 pt empty column beside the
// list in landscape.
//
// The PIXELS section never had this defect and is the proof of what "correct"
// looks like: its band is a full-card-width block in the card's VERTICAL
// stack, so collapsing it to its own header returns the height to
// `channelBody` (flex: 1) and the playlist absorbs it for free — measured
// landscape 24 → 167 pt (0 → 2 rows), portrait 158 → 253 pt (2 → 4 rows), with
// no layout code of its own. Params could not inherit that because it is a
// SIBLING PANEL inside the body, not a block above it: nothing shrinks a flex
// child that still claims a weight (portrait) or a percentage width
// (landscape).
//
// So the fix is to stop claiming. A params column that is not showing sliders
// sizes to what it actually renders, and the playlist — the only remaining
// grower in the body — takes the rest.
//
// ORIENTATION MATTERS, and the honest consequence differs:
//   · PORTRAIT stacks playlist OVER params, so the freed space is HEIGHT and
//     it converts directly into visible pattern rows.
//   · LANDSCAPE puts params BESIDE the playlist, so the freed space is WIDTH.
//     The list gets meaningfully wider (long pattern names stop truncating)
//     but the row COUNT is bounded by the card height and does not change —
//     no flex rule can turn horizontal space into rows. Hiding PIXELS is the
//     lever that adds rows in landscape, and it already works.

/** What the LOCAL PARAMS column is actually rendering right now. Drives how
 *  much of the strip body it is entitled to claim. */
export type MixerParamsColumnMode =
  /** Sliders (edit mode, section shown) or the perf-mode pixel band — the
   *  column has real content and keeps its full share of the body. */
  | 'full'
  /** Edit mode, section hidden: only the 28 px "LOCAL PARAMS ▸" micro-header
   *  stub (docs/64 §3.1 — the stub always stays, so the section is never
   *  unreachable). Sizes to that stub and no more. */
  | 'stub'
  /** Performance mode with the pixel band hidden too: the column renders
   *  nothing at all, so it is entitled to nothing. */
  | 'empty';

/**
 * The one place that decides what the params column is showing. Mirrors
 * `ChannelStrip`'s own render branches exactly (mixer.tsx): in perf mode the
 * column holds the dominant pixel band and is gated on `pixelsShown` — perf
 * never resurrects an operator-hidden band (docs/64 §2.6/§3.5 D4) — and in
 * edit mode it holds the micro-header plus, when shown, the sliders.
 *
 * NOTE the perf asymmetry, and that it is deliberate: `paramsShown` is
 * irrelevant while perf is active, because perf has already replaced the
 * sliders with the band. A section the operator hid stays hidden either way;
 * this function only reports what occupies the column.
 */
export function mixerParamsColumnMode(opts: {
  perfActive: boolean;
  paramsShown: boolean;
  pixelsShown: boolean;
}): MixerParamsColumnMode {
  if (opts.perfActive) return opts.pixelsShown ? 'full' : 'empty';
  return opts.paramsShown ? 'full' : 'stub';
}

/**
 * PORTRAIT, params column not showing sliders. Drops the flex WEIGHT
 * (`flexGrow: 0` + `flexBasis: 'auto'`) so the panel is measured by its own
 * content — the micro-header stub — instead of taking a third/quarter of the
 * body. `flexShrink: 0` keeps the stub itself from being squeezed to nothing
 * by the playlist's growth, so the affordance can never become untappable.
 *
 * Deliberately does NOT touch `width`: the portrait panel spans the full strip
 * width (`paramsPanelPortrait`) in every state, and the stub must keep
 * spanning it so its chevron stays where the operator last saw it.
 */
export const MIXER_PORTRAIT_PARAMS_PANEL_COLLAPSED = {
  flexGrow: 0,
  flexShrink: 0,
  flexBasis: 'auto',
  ...MIXER_BOUNDED_SCROLL_AREA,
} as const;

/**
 * LANDSCAPE, params column not showing sliders. Clears the 40 % `width` and
 * hugs the content, so the column costs only what the stub actually needs
 * (`'empty'` costs nothing at all — see `MIXER_LANDSCAPE_PARAMS_PANEL_EMPTY`).
 *
 * docs/69 W3 MISS 1: when the media column also holds the relocated PIXELS
 * band (LANDSCAPE EDIT, both occupants hidden — `mixerMediaColumnMode` ===
 * 'stub'), "the stub" used to mean the PIXELS band's own 28 px header, which
 * — bug, now fixed at its source (`pixel_view_band.tsx`'s `compactWhenCollapsed`
 * prop) — used to render its view-picker chip AND honesty ratio even while
 * closed, measuring 247.64 px wide with nothing to shrink it
 * (`flexShrink: 0` was deliberate, `_279`'s "keep the stub tappable" choice —
 * see below). With the header itself now compact while collapsed, the widest
 * real content here is the LOCAL PARAMS micro-header row (~105 px) — this
 * constant no longer needs to accommodate a quarter-card-wide stub, but it
 * still carries `flexShrink: 1` + `minWidth: 44` (docs/66's floor, never
 * below) instead of the old rigid `flexShrink: 0`, so a column that somehow
 * still finds itself squeezed degrades gracefully toward a real floor
 * instead of forcing the fix to live entirely in the header. `overflow:
 * 'hidden'` means any content that still doesn't fit clips at this column's
 * own edge rather than spilling onto the playlist beside it.
 */
export const MIXER_LANDSCAPE_PARAMS_PANEL_COLLAPSED = {
  // `'auto'`, NOT `undefined`. A later style object's `undefined` does not
  // clear an earlier value on react-native-web — the resolver drops undefined
  // properties instead of overwriting with them — so `width: undefined` here
  // left the base `paramsPanel`'s `width: '40%'` standing and the column went
  // on claiming its 40 % while showing only the stub (measured: 135 × 102 pt,
  // identical shown vs hidden). `'auto'` is a real value, it overwrites, and
  // it means exactly what this column now wants: size to the stub.
  width: 'auto',
  flexGrow: 0,
  // Was `flexShrink: 0` (`_279`'s deliberate "keep the stub tappable"
  // choice). Now `1` + a real `minWidth` floor: with the header itself
  // compacted while collapsed (docs/69 W3 MISS 1), this column's content
  // rarely needs to shrink at all, but a real, testable floor is still
  // strictly safer than rigidity — the stub degrades toward 44 pt instead of
  // being unable to give up a single pixel it doesn't need.
  flexShrink: 1,
  flexBasis: 'auto',
  minWidth: 44,
  overflow: 'hidden',
  ...MIXER_BOUNDED_SCROLL_AREA,
} as const;

/**
 * LANDSCAPE, params column rendering NOTHING (perf mode with the pixel band
 * hidden). `width: 0` rather than unmounting the column: the render layer
 * keeps the element mounted so perf's own composition stays one straight-line
 * branch, and a zero-width, zero-grow box contributes nothing to the row.
 */
export const MIXER_LANDSCAPE_PARAMS_PANEL_EMPTY = {
  width: 0,
  flexGrow: 0,
  flexShrink: 0,
  flexBasis: 0,
  // The base `paramsPanel` pads 8 on every side. Zero it explicitly rather
  // than trusting border-box to clamp it, so an empty column really does cost
  // the row nothing instead of a 16 pt ghost gutter.
  padding: 0,
  ...MIXER_BOUNDED_SCROLL_AREA,
} as const;

/**
 * LANDSCAPE playlist panel while the params column beside it is collapsed.
 * Replaces the fixed 60 % with "take whatever the row has left", which is the
 * whole point: the freed column becomes list width rather than dead ground.
 * `minWidth: 0` keeps the flex chain shrinkable exactly like every other
 * bounded region in the strip (`MIXER_BOUNDED_SCROLL_AREA`'s sibling rule for
 * the cross axis) so a long pattern name can never push the row wider than the
 * card.
 */
export const MIXER_LANDSCAPE_PLAYLIST_PANEL_EXPANDED = {
  // `'auto'` for the same reason as the collapsed params column above: an
  // `undefined` would not clear the base 60 % / perf's 45 %.
  width: 'auto',
  flexGrow: 1,
  flexShrink: 1,
  flexBasis: 0,
  minWidth: 0,
  ...MIXER_BOUNDED_SCROLL_AREA,
} as const;

// ── The patterns-first landscape card (docs/69 W3, operator order 3) ───────
//
// "in horizontal layout the pattern list is basically not showing up to
//  select patterns... rethink the layout to make the patterns themselves
//  show up please"
//
// Measured (`_280`, `_285`): in LANDSCAPE EDIT the per-channel PIXELS band
// used to be a 208 pt full-width block in the card's VERTICAL stack — half
// of the card's unshrinkable chrome (~411 pt of ~411-560 pt) — leaving the
// pattern list a 0-56 pt sliver (0-4 rows) with everything default-shown,
// and crushing `channelBody` to literally 0 pt the moment MASTER VIEW
// opened (`_285` §3: the body is the card's ONLY shrinkable child, so it
// absorbed 100 % of the deficit).
//
// The fix is placement, not a squeeze: the band moves OUT of the vertical
// stack and into the TOP of the media column (the old "params" column),
// ABOVE the LOCAL PARAMS micro-header — perf mode's already-proven grammar
// (the band already occupies that column there, `_243`/`_270`), extended to
// edit mode. This removes the 208 pt block from the vertical stack by
// construction, which is what relieves the MASTER VIEW crush too — not a
// second, parallel fix (`_285` §7's recommendation, taken).
//
// The column is no longer just "the params column" — it now holds the band
// AND (optionally) params, so what it is entitled to claim depends on
// whether EITHER is showing something real, not on `paramsShown` alone:
// hiding params while pixels stays open must NOT collapse the column, since
// the band still needs the width to paint an honest picture ("band keeps
// the column's width").

/**
 * What the media column — band + params, now that the band has moved in —
 * is actually entitled to claim. Mirrors `mixerParamsColumnMode`'s exact
 * shape (same three inputs, same `MixerParamsColumnMode` output) and, per
 * docs/69 W3 item 2, does NOT re-derive it: perf mode and portrait delegate
 * to `mixerParamsColumnMode` byte-for-byte (they resolve exactly as `_279`
 * left them — the band there is either forced-open/dominant, perf, or left
 * in its old full-card-width position, portrait, never suppressed by this
 * rule), so the only genuinely NEW branch is LANDSCAPE EDIT.
 *
 * There, `'full'` whenever EITHER the band's picture or the params sliders
 * are showing — the column keeps its normal width because at least one of
 * its two occupants needs the room (hiding params while pixels stays open
 * must NOT collapse the column: the band still needs the width to paint an
 * honest picture). `'stub'` only when BOTH are hidden: the column then hugs
 * its two 28 px micro-header stubs (pixels' + params', both always reachable
 * per docs/64 §3.1) and the playlist claims nearly the whole card — `_279`'s
 * payoff, amplified. LANDSCAPE EDIT never returns `'empty'` — unlike perf,
 * there is always at least a stub to show, never nothing.
 */
export function mixerMediaColumnMode(opts: {
  perfActive: boolean;
  isPortrait: boolean;
  paramsShown: boolean;
  pixelsShown: boolean;
}): MixerParamsColumnMode {
  if (opts.perfActive || opts.isPortrait) {
    return mixerParamsColumnMode({
      perfActive: opts.perfActive,
      paramsShown: opts.paramsShown,
      pixelsShown: opts.pixelsShown,
    });
  }
  return (opts.paramsShown || opts.pixelsShown) ? 'full' : 'stub';
}

export interface MixerChannelContentLayoutOptions {
  /** Accepted explicitly so the invariant can be tested across both faces. */
  performanceModeActive: boolean;
  isPortrait: boolean;
  paramsShown: boolean;
  pixelsShown: boolean;
}

export interface MixerChannelContentLayout {
  mediaColumnMode: MixerParamsColumnMode;
  showPortraitPixelBand: boolean;
  showLandscapePixelBand: boolean;
  forcePixelExpanded: false;
}

/**
 * The per-channel content composition is intentionally mode-invariant.
 * Performance hides management chrome and overlays the channel lock, but it
 * must not enlarge the 2D view, replace LOCAL PARAMS, or reduce the pattern
 * list's normal share. The raw mode remains an input so a regression test can
 * compare both faces; no layout field is allowed to depend on it.
 */
export function mixerChannelContentLayout(
  opts: MixerChannelContentLayoutOptions,
): MixerChannelContentLayout {
  void opts.performanceModeActive;
  return {
    mediaColumnMode: mixerMediaColumnMode({
      perfActive: false,
      isPortrait: opts.isPortrait,
      paramsShown: opts.paramsShown,
      pixelsShown: opts.pixelsShown,
    }),
    showPortraitPixelBand: opts.isPortrait,
    showLandscapePixelBand: !opts.isPortrait,
    forcePixelExpanded: false,
  };
}

/**
 * The relocated band's OWN slot inside the media column (docs/69 W3 item 3):
 * a flex participant like every other bounded region here, but its floor is
 * NOT 0. `BAND_HEADER_HEIGHT` (`pixel_view_band_logic`) is the 28 px stub
 * that must always stay reachable (docs/64 §3.1 — it carries the chevron);
 * `MIN_BAND_CANVAS_HEIGHT` is the aspect-honest picture's own floor once the
 * section is open. Neither is a number this file re-guesses — both are the
 * same tokens `pixel_view_band_logic`/`pixel_view_band.tsx` already use to
 * size the picture, imported verbatim so the two can never drift apart.
 *
 * `flexShrink: 1` + `flexBasis: 'auto'` (never a `flex: N` shorthand — the
 * docs/69 §1 class-sweep trap) lets the band give up space to LOCAL PARAMS
 * below it when the column is genuinely short (the MASTER VIEW-open case);
 * it will shrink toward `minHeight` but never below it, so the header stays
 * tappable and the picture never goes narrower than its own honest floor.
 * `overflow: 'hidden'` is the containment `_285` §7 asked for: if the column
 * still cannot afford the floor at some extreme, the band clips at its own
 * boundary instead of painting over LOCAL PARAMS beneath it — never a second
 * crush recreated one level down.
 *
 * When the section is collapsed (`pixelsShown` false) only the header
 * renders (`pixel_view_band.tsx`'s own gate), so the floor drops to just the
 * header height — the stub costs the column nothing beyond its own 28 px.
 */
export function mixerLandscapeMediaBandSlot(pixelsShown: boolean) {
  return {
    flexGrow: 0,
    flexShrink: 1,
    flexBasis: 'auto',
    minHeight: BAND_HEADER_HEIGHT + (pixelsShown ? MIN_BAND_CANVAS_HEIGHT : 0),
    overflow: 'hidden',
  } as const;
}
