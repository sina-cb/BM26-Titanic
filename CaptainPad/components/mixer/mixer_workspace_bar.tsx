/**
 * mixer_workspace_bar — the Mixer's workspace BAR: one row of chips that
 * hides and restores channels + the two static citizens (MASTER VIEW,
 * COLORS) (contract: docs/64_mixer_relayout.md §2.4, §2.5, §3.6).
 *
 * A self-contained component: it makes NO engine calls of any kind — every
 * press dispatches a LAYOUT action (`onOpen`/`onClose`) only. Hiding a
 * channel is view-only, exactly like closing a deck window; it never mutes,
 * never solos, never touches engine state (docs/64 §2.5).
 *
 * Every decision this bar makes — chip order, shown vs railed, label
 * composition, the muted-style flag, the floor-disabled flag — lives in the
 * pure `mixer_workspace_bar_logic.ts` module, which vitest can actually
 * exercise (this file cannot be: the
 * vitest config only admits pure `.ts` under `components/**`, and RN
 * components are `.tsx`). This file is a thin render of that module's plan.
 *
 * The chip recipe is the SAME one the deck's `DeckWorkspaceBar` renders with
 * (`components/ui/workspace_chip.tsx`, docs/64 §10 convergence): same
 * grounds, same ▾/▸ glyphs, same 44pt hit target, same HIDDEN divider. This
 * file supplies only the MIXER-SPECIFIC knowledge — which surface id maps to
 * which dot/label, the index-dot label composition, the muted/floor flags —
 * and renders through the shared `<WorkspaceChip>` rather than hand-rolling
 * its own chip render.
 */
import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';

import { usePalette } from '@/hooks/use-theme';
import { Space, Type } from '@/constants/theme';
import { AUDIO_BAND_FALLBACK as AUDIO_ACCENT } from '@/constants/identity';
import { identityDot } from '@/styles/design_recipes';
import { useSharedParamValues } from '@/hooks/useEngineState';
import { DualSwatch } from '@/components/ColorPickerModal';
import { WorkspaceChip } from '@/components/ui/workspace_chip';
import {
  buildMixerBarPlan,
  shouldShowBarOverflowHint,
  type MixerBarChannelInput,
  type MixerBarChipEntry,
  type MixerBarScrollExtent,
} from '@/components/mixer/mixer_workspace_bar_logic';
import type {
  MixerChannelId,
  MixerSurfaceId,
  MixerWorkspaceLayout,
} from '@/components/mixer/mixer_workspace_layout';

/** The COLORS citizen's identity dot: a live two-tone swatch of the engine's
 *  `colorPalette1`/`colorPalette2` — the exact port of the deck's
 *  `ColorsIdentityDot` (`deck_workspace.tsx`), because the reasoning is
 *  identical: the chip's identity IS the current palette, so a static hex
 *  would be a lie the moment the rig's colours move. A read-only broadcast
 *  subscription, not an engine call — the chip still never WRITES anything. */
const MixerColorsIdentityDot = React.memo(function MixerColorsIdentityDot() {
  const shared = useSharedParamValues({
    colorPalette1: { h: 0 } as { h: number },
    colorPalette2: { h: 0.5 } as { h: number },
  }) as { colorPalette1: { h: number }; colorPalette2: { h: number } };
  const h1 = typeof shared.colorPalette1?.h === 'number' ? shared.colorPalette1.h : 0;
  const h2 = typeof shared.colorPalette2?.h === 'number' ? shared.colorPalette2.h : 0.5;
  return <DualSwatch h1={h1} h2={h2} size={10} />;
});

export interface MixerBarChannel {
  /** Engine channel id. */
  id: string;
  /** 1-based position, for the chip's index dot label. */
  index: number;
  /** Already-derived channel title (caller uses `deriveChannelTitle`). */
  title: string;
  /** Group tint, or null when ungrouped. */
  groupColor: string | null;
  /** `channel.enabled === false`. */
  muted: boolean;
}

export interface MixerWorkspaceBarProps {
  layout: MixerWorkspaceLayout;
  /** ALL channels (shown and hidden), CANONICAL engine order. */
  channels: readonly MixerBarChannel[];
  onOpen: (id: MixerSurfaceId) => void;
  onClose: (id: MixerSurfaceId) => void;
  audioBarOpen: boolean;
  onAudioOpen: () => void;
  onAudioClose: () => void;
  /** Perf overlay active — feeds the bar PLAN (which citizens are shown).
   *  It renders NO caption: report _308 removed every explainer label from
   *  the chip bar, perf mode included. */
  perfActive?: boolean;
  /** The channel the floor protects (last visible). Its chip renders with no
   *  press handler and an accessibility label saying why — docs/53 §3.1: an
   *  affordance that always refuses should not exist. null when >1 visible. */
  floorChannelId?: string | null;
}

// ── One chip ─────────────────────────────────────────────────────────────

interface MixerChipProps {
  entry: MixerBarChipEntry;
  onPress: ((id: MixerSurfaceId) => void) | null;
}

/** One chip — channel OR citizen. Thin wrapper over the shared
 *  `<WorkspaceChip>` (`components/ui/workspace_chip.tsx`, docs/64 §10
 *  convergence): this module keeps only the MIXER-SPECIFIC knowledge — the
 *  dot (group-tinted, MASTER VIEW's neutral, or the live COLORS swatch), the
 *  label, the floor/muted flags, and the mixer's own accessibility wording.
 *  Module-scoped (stable identity) + memoized: a layout change must not
 *  churn the chips of the surfaces it did not touch (same discipline as the
 *  deck's `WindowChip`). */
const MixerWorkspaceChip = React.memo(function MixerWorkspaceChip({ entry, onPress }: MixerChipProps) {
  const C = usePalette();
  const handlePress = useCallback(() => { if (onPress) onPress(entry.surfaceId); }, [onPress, entry.surfaceId]);

  const isColorsCitizen = entry.kind === 'citizen' && entry.citizen === 'colors';
  // Channel dot: tinted by group colour when grouped, else the palette's
  // neutral `secondary` (same "about the rig's own content, not its own
  // accent" reasoning the deck's PIXELS dot uses). MASTER VIEW gets the same
  // neutral for the same reason — it IS the rig's own pixel picture.
  const dot = isColorsCitizen
    ? <MixerColorsIdentityDot />
    : <View style={identityDot(
        entry.kind === 'audio'
          ? AUDIO_ACCENT
          : entry.kind === 'channel'
            ? (entry.groupColor ?? C.secondary)
            : C.secondary,
        10,
      )} />;

  const showMutedStyle = entry.kind === 'channel' && entry.showMutedStyle;
  const isFloor = entry.kind === 'channel' && entry.floorDisabled;

  // The floor chip (last visible channel): no press handler, no chevron —
  // exactly the deck's PATTERNS treatment. Its accessibility label says WHY,
  // per docs/53 §3.1 ("an affordance that always refuses should not exist"
  // — this one exists as a STATUS label, not a control).
  const unpressable = isFloor || !onPress;
  const mutedSuffix = showMutedStyle ? ' (muted)' : '';
  const accessibilityLabel = unpressable
    ? (isFloor
        ? `${entry.label} is the only visible channel and cannot be hidden`
        : `${entry.label} is always shown`)
    : `${entry.open ? 'Hide' : 'Show'} ${entry.label}${mutedSuffix}`;

  return (
    <WorkspaceChip
      label={entry.label}
      dot={dot}
      open={entry.open}
      onPress={unpressable ? null : handlePress}
      accessibilityLabel={accessibilityLabel}
      muted={showMutedStyle}
    />
  );
});

// ── Overflow affordance (docs/67 §4.2) ───────────────────────────────────

/** The pinned right-edge hint that says "this row continues" (docs/67 §4.2,
 *  decision D4). A plain `Text` glyph — deliberately NOT a gradient fade:
 *  `expo-linear-gradient` is not in the tree and the playa's offline-readiness
 *  rule makes adding a dependency for one glyph a bad trade. With §4.1's label
 *  cap the overflow state itself becomes rare; the hint is for the residual
 *  many-channel case.
 *
 *  This component MEASURES; `shouldShowBarOverflowHint` (pure, vitest-covered)
 *  DECIDES — the same split every other decision in this bar already obeys.
 *  Purely render-layer either way: the measurement never reaches the layout
 *  store, and the glyph is hidden from the accessibility tree, since a screen
 *  reader already walks every chip and announcing a decoration is noise. */
const ZERO_EXTENT: MixerBarScrollExtent = { content: 0, viewport: 0, offset: 0 };

// ── The bar ──────────────────────────────────────────────────────────────

export const MixerWorkspaceBar = React.memo(function MixerWorkspaceBar(
  {
    layout,
    channels,
    onOpen,
    onClose,
    audioBarOpen,
    onAudioOpen,
    onAudioClose,
    perfActive = false,
    floorChannelId = null,
  }: MixerWorkspaceBarProps,
) {
  const C = usePalette();

  const channelInputs = useMemo<MixerBarChannelInput[]>(
    () => channels.map((c) => ({ id: c.id, index: c.index, title: c.title, groupColor: c.groupColor, muted: c.muted })),
    [channels],
  );
  const plan = useMemo(
    () => buildMixerBarPlan(
      channelInputs,
      layout,
      perfActive,
      floorChannelId as MixerChannelId | null,
      audioBarOpen,
    ),
    [channelInputs, layout, perfActive, floorChannelId, audioBarOpen],
  );
  const handleOpen = useCallback((id: MixerSurfaceId) => {
    if (id === 'audioBar') onAudioOpen();
    else onOpen(id);
  }, [onAudioOpen, onOpen]);
  const handleClose = useCallback((id: MixerSurfaceId) => {
    if (id === 'audioBar') onAudioClose();
    else onClose(id);
  }, [onAudioClose, onClose]);

  // Scroll extent for the overflow hint. ONE state object rather than three,
  // so a layout pass that reports content + viewport together costs one
  // render, not two; every setter short-circuits on an unchanged value so a
  // steady scroll at the end of the row stops re-rendering entirely.
  const [extent, setExtent] = useState<MixerBarScrollExtent>(ZERO_EXTENT);

  const handleContentSizeChange = useCallback((w: number) => {
    setExtent((prev) => (Math.abs(prev.content - w) < 0.5 ? prev : { ...prev, content: w }));
  }, []);
  const handleLayout = useCallback((e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    setExtent((prev) => (Math.abs(prev.viewport - w) < 0.5 ? prev : { ...prev, viewport: w }));
  }, []);
  const handleScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const x = e.nativeEvent.contentOffset.x;
    setExtent((prev) => (Math.abs(prev.offset - x) < 0.5 ? prev : { ...prev, offset: x }));
  }, []);

  const showOverflowHint = shouldShowBarOverflowHint(extent);

  return (
    <View
      {...({ dataSet: { mixerworkspacebar: '1' } } as object)}
      style={styles.bar}
    >
      {/* Horizontal pill-bar idiom, same as the deck's bar: chips fit an
          iPad landscape row and scroll rather than wrap on a narrow one, so
          the bar is always exactly one row tall. */}
      <ScrollView
        horizontal
        style={styles.scrollArea}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.barContent}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={handleContentSizeChange}
        onLayout={handleLayout}
        onScroll={handleScroll}
        scrollEventThrottle={16}
      >
        {plan.shown.map((entry) => (
          <MixerWorkspaceChip key={entry.surfaceId} entry={entry} onPress={handleClose} />
        ))}
        {plan.showHiddenDivider ? (
          <>
            {/* The HIDDEN divider is a real boundary between two kinds of
                chip, so it wears `borderStrong` (≥3:1 on every surface) —
                `ghostBorder` is decoration and disappears against the bar
                (same reasoning as the deck's divider). */}
            <View style={[styles.divider, { backgroundColor: C.borderStrong }]} />
            <Text style={[styles.railCaption, { color: C.icon }]}>HIDDEN</Text>
          </>
        ) : null}
        {plan.rail.map((entry) => (
          <MixerWorkspaceChip key={entry.surfaceId} entry={entry} onPress={handleOpen} />
        ))}
      </ScrollView>
      {/* docs/67 §4.2 — the fold becomes visible. Pinned OUTSIDE the scroller
          so it stays at the row's right edge instead of scrolling away with
          the content it is describing. */}
      {showOverflowHint ? (
        <Text
          style={[styles.overflowHint, { color: C.icon }]}
          accessibilityElementsHidden
          importantForAccessibility="no"
        >
          ›
        </Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    // docs/67 §6 C5: was 4/2. With the rail as the portrait column's own row
    // (§3.2) the 2 pt lopsidedness read as a misalignment against the master
    // strip above it; symmetric padding costs 2 pt and reads level.
    paddingTop: 4,
    paddingBottom: 4,
  },
  scrollArea: {
    flex: 1,
    minWidth: 0,
  },
  barContent: {
    flexDirection: 'row',
    alignItems: 'center',
    // docs/67 §6 C4 (decision D7): was `Space.sm` (8). Each chip carries an
    // 8 pt hitSlop on both sides, so an 8 pt gap left adjacent hit regions
    // OVERLAPPING — a tap on the seam could fire the neighbour, the milder
    // cousin of the `_272` BPM-boundary finding. 12 gives the seam real
    // separation while keeping every chip's own 44 pt target intact (the
    // alternative, trimming hitSlop to 4, would have shrunk that target
    // below the docs/66 floor).
    gap: Space.md,
  },
  divider: {
    width: 1,
    height: 16,
    marginHorizontal: 2,
  },
  railCaption: {
    ...Type.microCaps,
    textTransform: 'uppercase',
  },
  /** The pinned `›` overflow hint (docs/67 §4.2). `microCaps` size so it sits
   *  in the same optical register as the HIDDEN caption; `flexShrink:0` so it
   *  is the one thing in the row that never gives ground. */
  overflowHint: {
    ...Type.microCaps,
    fontSize: 12,
    flexShrink: 0,
    paddingHorizontal: 4,
  },
  // The pinned perf-caption slot docs/67 §4.3 once specified here is GONE
  // (report _308, operator order: no explainer captions in the chip bar) —
  // its styles went with it. `perfActive` survives as a PLAN input only: it
  // decides which citizens the bar shows, never any narration.
});
