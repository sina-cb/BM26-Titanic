/**
 * workspace_chip — the ONE chip recipe every workspace bar in the app draws
 * with (docs/54_deck_ui_restyle.md §3, docs/63_deck_declutter_view_optimizer.md
 * §3.2/§3.3, docs/64_mixer_relayout.md §2.4/§10).
 *
 * CONVERGENCE NOTE (docs/64 §10 / docs/63 §8): the deck's window/bar chips
 * and the mixer's channel/citizen chips grew as two hand-rolled copies of the
 * exact same recipe — same grounds, same ▾/▸ glyphs, same 44pt hit target,
 * same "open never changes the dot colour" rule. This module is the single
 * extraction both bars now render through. It knows NOTHING about windows,
 * bars, channels, citizens, group ids or any other domain concept — only
 * about "a chip": a dot, a label, an open/closed ground, and a press (or its
 * deliberate absence). Every caller keeps its own id → label/dot mapping and
 * its own accessibility wording; this module renders the plan it is handed.
 *
 * Design choices, so a future third bar doesn't re-litigate them:
 *   - `dot` is a `ReactNode` SLOT, not a colour prop. The deck's PIXELS/
 *     PATTERNS/etc dots are a flat `identityDot(hex, 10)`, but COLORS (both
 *     screens) draws a live `DualSwatch` of the engine's two palette hues —
 *     that is DATA, not a token, and cannot be expressed as a colour prop
 *     without this module reaching into engine state. A slot serves both
 *     honestly; a `dotColor?: string` prop would have forced the two
 *     COLORS chips to keep hand-rolling their own render anyway.
 *   - `onPress: (() => void) | null` — `null` is not "disabled", it is
 *     UNPRESSABLE BY DESIGN (docs/53 §3.1: "an affordance that always
 *     refuses should not exist"). The deck's protected PATTERNS window and
 *     the mixer's floor-protected last-visible channel both render as a
 *     plain status `View` with no chevron, not a greyed-out button. Which
 *     case applies, and why, is caller knowledge — expressed here as a
 *     boolean-shaped fact (is there a handler or not), never as a domain
 *     flag like `protected` or `floorDisabled`.
 *   - `accessibilityLabel` is a plain string the caller composes in full.
 *     The deck and the mixer word "why can't I press this" differently
 *     ("PATTERNS window is always shown" vs "CH 1 is the only visible
 *     channel and cannot be hidden") — that phrasing is exactly the kind of
 *     domain knowledge this module refuses to own.
 *   - `muted` is the one boolean flag this module DOES carry, because it is
 *     genuinely chip-shaped: "render this label a step quieter" has no
 *     simpler expression as a slot, and the deck simply never sets it
 *     (defaults to `false`, so the deck's chips are byte-identical to
 *     before this extraction).
 *
 * Zero decision logic lives here — `open` picks a ground/border/glyph/label
 * style, `onPress === null` picks static-View vs TouchableOpacity, `muted`
 * toggles one opacity style. Everything upstream of those four inputs (which
 * surfaces are open, what order they render in, what a chip's label/dot/
 * press/accessibility text should be) is decided by each bar's own pure
 * logic module (`deck_workspace_layout.ts`, `mixer_workspace_bar_logic.ts`)
 * — this file cannot be vitest-covered itself (`.tsx` is excluded from the
 * suite, see `vitest.config.ts`), so it is deliberately kept free of any
 * decision the suite would otherwise fail to catch.
 */
import React, { useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

import { usePalette } from '@/hooks/use-theme';
import { Palette, Radius, Type } from '@/constants/theme';

// 8pt hitSlop on every edge → the 28pt-high chips get a 44pt interactive
// area, matching the deck/mixer touch-target floor.
export const WORKSPACE_CHIP_HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 } as const;

/**
 * The chip label's width ceiling, in points (docs/67 §4.1).
 *
 * A chip's width used to be its label's INTRINSIC width, which is fine for the
 * deck (a closed enum of static titles) and hostile on the mixer, where a
 * channel title is runtime data (`deriveChannelTitle`: rename → active
 * playlist entry label/pattern → playlist name). Measured on the operator's
 * repro: a 40-character title rendered a **349 pt** chip inside an 831 pt bar
 * viewport — one channel eating 42 % of the row and pushing the tail chips
 * past the fold, where they became unreachable.
 *
 * 168 is derived, not taste: `Type.labelCaps` uppercase runs measured
 * 6.7 pt/char (296 pt over 44 chars), so 168 pt ≈ 25 characters. Every
 * real-world title the operator has shown ("GOLDEN HOUR WASH", 16 ch ≈ 110 pt)
 * renders WHOLE; the pathological 40-char title tops out at ≈ 218 pt of total
 * chip. Because the index prefix `N · ` is the HEAD of the string and RN's
 * default ellipsizeMode is `tail`, truncation keeps the channel number
 * prominent by construction — no label recomposition needed.
 *
 * The cap lives at the STYLE level (pixel-honest across fonts and themes),
 * never as a character cap in `channelChipLabel` — the pure plan keeps the
 * FULL title so nothing downstream loses data, and each caller's
 * `accessibilityLabel` still speaks the whole thing.
 *
 * DECK IMPACT: ZERO. The deck's longest static label ("PERFORMANCE") measures
 * ≈ 80 pt, less than half the cap, so every deck chip renders byte-identically
 * (the shared chip/contrast suites are the standing proof).
 */
export const WORKSPACE_CHIP_LABEL_MAX_WIDTH = 168;

/**
 * OPEN chip ground (docs/54 §3): the chip wears the same surface as the
 * window/citizen/channel it stands for (`panel` is `surfaceContainerLow`),
 * so the bar reads as a row of little windows. HIDDEN chips sit on
 * `surfaceContainerLowest`, applied inline at the call site below — the
 * design's literal "quiet-chip paint" for the restore rail.
 *
 * CONTRAST NOTE (pinned by `restyle_contrast.test.ts`): `surfaceContainerLow`
 * is NOT an arbitrary choice — the PARAMETERS dot is a fixed MIDI violet that
 * measures under the 3:1 WCAG 1.4.11 bar on `surfaceContainerHigh` (gruvbox
 * 2.67:1) but clears it on every theme on `surfaceContainerLow` (gruvbox
 * 3.02:1, the binding case). Exported so both bars' contrast tests exercise
 * the exact ground this component paints, never a copy of the token name.
 */
export const workspaceChipOpenGround = (C: Palette) => ({ backgroundColor: C.surfaceContainerLow });

export interface WorkspaceChipProps {
  /** Chip text — a window/bar title, a mixer channel's `1 · SPARKLE`, or a
   *  citizen title. Visual upper-casing is this module's TEXT STYLE
   *  (`textTransform: 'uppercase'`), so callers pass whatever case their
   *  title arrived in. */
  label: string;
  /** The identity dot — a flat `identityDot(hex, 10)` View, a live
   *  `DualSwatch`, or any other chip-shaped decoration. See the module doc
   *  for why this is a slot and not a colour prop. */
  dot: React.ReactNode;
  /** Is this chip's surface currently shown? Drives ground, border, glyph
   *  and label weight — NEVER the dot's own colour/content (docs/54 §3: the
   *  identity moves between the open row and the rail, it never swaps hue,
   *  so closing and restoring reads as the SAME object moving). */
  open: boolean;
  /** `null` marks this chip UNPRESSABLE BY DESIGN (see module doc) — it
   *  renders as a static `View` with no chevron. A function makes the chip a
   *  live restore/hide control. */
  onPress: (() => void) | null;
  /** Full accessibility string, composed by the caller (see module doc for
   *  why the wording is not this module's decision). */
  accessibilityLabel: string;
  /** Render the label a step quieter (the mixer's hidden-and-muted-channel
   *  case, docs/64 §2.4). Defaults to `false` — the deck never sets this,
   *  so its chips are unaffected by the flag's existence. */
  muted?: boolean;
}

/** One chip. Memoized: a layout change must not churn the chips of the
 *  surfaces it did not touch (the discipline both the deck's former
 *  `WindowChip` and the mixer's former `MixerWorkspaceChip` already
 *  followed). */
export const WorkspaceChip = React.memo(function WorkspaceChip({
  label,
  dot,
  open,
  onPress,
  accessibilityLabel,
  muted = false,
}: WorkspaceChipProps) {
  const C = usePalette();
  const handlePress = useCallback(() => { if (onPress) onPress(); }, [onPress]);

  // `numberOfLines={1}` + the width cap are the chip diet (docs/67 §4.1): one
  // line, tail-ellipsized at WORKSPACE_CHIP_LABEL_MAX_WIDTH. No `flexShrink`
  // on the label — a chip never shrinks below its truncated width, so the
  // 44 pt effective target (minHeight 28 + the exported 8 pt hitSlop) holds
  // at every bar width.
  const labelNode = (
    <Text
      numberOfLines={1}
      style={[
        open ? styles.chipLabel : styles.railChipLabel,
        styles.chipLabelCap,
        { color: open ? C.text : C.secondary },
        muted ? styles.mutedChipLabel : null,
      ]}
    >
      {label}
    </Text>
  );

  // UNPRESSABLE BY DESIGN: no press handler, no chevron — a status label,
  // not a control (docs/53 §3.1: an affordance that always refuses should
  // not exist).
  if (!onPress) {
    return (
      <View
        style={[styles.chip, { borderColor: C.borderStrong }, workspaceChipOpenGround(C)]}
        accessibilityLabel={accessibilityLabel}
      >
        {dot}
        {labelNode}
      </View>
    );
  }

  return (
    <TouchableOpacity
      onPress={handlePress}
      hitSlop={WORKSPACE_CHIP_HIT_SLOP}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ expanded: open }}
      style={[
        styles.chip,
        { borderColor: open ? C.borderStrong : C.ghostBorder },
        open ? workspaceChipOpenGround(C) : { backgroundColor: C.surfaceContainerLowest },
      ]}
    >
      {dot}
      {labelNode}
      <Text style={[styles.chipGlyph, { color: open ? C.secondary : C.primary }]}>
        {open ? '▾' : '▸'}
      </Text>
    </TouchableOpacity>
  );
});

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 28,
    paddingHorizontal: 10,
    // The radius scale's `control` step — a chip-shaped BUTTON, which is
    // what these are (docs/54 §3 rail spec).
    borderRadius: Radius.control,
    borderWidth: 1,
  },
  /** An OPEN chip carries the surface's title, so it wears the title
   *  recipe. */
  chipLabel: {
    ...Type.labelCaps,
    textTransform: 'uppercase',
  },
  /** A HIDDEN chip is a restore affordance, one step quieter (docs/54 §3:
   *  "identity dot + name in microCaps"). */
  railChipLabel: {
    ...Type.microCaps,
    textTransform: 'uppercase',
  },
  /** The width ceiling both label recipes wear (docs/67 §4.1). Applied as its
   *  own style entry AFTER the recipe so it composes with either without
   *  either having to restate the number. See
   *  `WORKSPACE_CHIP_LABEL_MAX_WIDTH` for the derivation and the deck's
   *  zero-impact proof. */
  chipLabelCap: {
    maxWidth: WORKSPACE_CHIP_LABEL_MAX_WIDTH,
  },
  /** A hidden-AND-muted mixer channel's label (docs/64 §2.4) — a hidden-and-
   *  silenced layer must be discoverable at a glance. Opacity dimming,
   *  matching the codebase's existing "muted" visual convention (`GroupRail`'s
   *  faded gang fader, the mixer strip's `dimmedBySolo`) rather than a new
   *  colour token. */
  mutedChipLabel: {
    opacity: 0.55,
  },
  chipGlyph: {
    fontFamily: 'SpaceGrotesk_700Bold',
    fontSize: 10,
  },
});
