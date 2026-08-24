/**
 * split_playlist_panes — the deck PATTERNS column as two stacked, vertically
 * resizable playlist list-views (feat/autopilot_deck_improvement, per
 * .agent/projects/deck_split_playlists.md).
 *
 * Pane 1 (DECK A / `primary`) is the deck's main playlist — pixel-identical to
 * today's single list. Pane 2 (DECK B / `secondary`) is OPTIONAL and collapsed
 * by default: a slim "+ SECOND PLAYLIST" bar sits under pane 1 until the
 * operator opens it. Both are the SAME PlaylistPanel used for patterns, mounted
 * with role="deckSlot" and channelId = the slot key — a second instance is
 * directly mountable (nothing about the panel is singleton). The deck still
 * plays exactly one pattern: tapping an entry in either pane routes through the
 * engine's existing swap path.
 *
 * The divider is a core-RN PanResponder drag grip (NO new deps — gesture-handler
 * is deliberately avoided). Its idioms are cloned verbatim from
 * components/ui/HorizontalFader.tsx: the responder is built ONCE via useRef,
 * callbacks read through refs (stale-closure fix), it CAPTURES the gesture and
 * refuses termination so an ancestor ScrollView can't steal it, and it mirrors
 * onPanResponderTerminate → release (browser pointercancel). Live drag updates
 * LOCAL state only; the ratio is POSTed ONCE on release/terminate.
 *
 * ── SPLIT AXIS FOLLOWS THE APP'S LAYOUT MODE (operator order, report _225) ──
 *
 * "when in vertical layout for the whole app (the optional panels go under the
 * main playlist) spawn the 2nd playlist as a new column on the right of the
 * main playlist, when moved to horizontal layout, move the 2nd playlist to the
 * bottom of the main one as it is now."
 *
 * The two modes want OPPOSITE axes, and the reason is the shape of the space
 * PATTERNS is given:
 *
 *   WIDE (`isWide`, landscape): PATTERNS is one TALL, NARROW column in a row of
 *     windows. Height is the abundant axis, so the panes stack — DECK B under
 *     DECK A, exactly as before this change. Untouched.
 *
 *   NARROW (portrait / phone): the windows stack vertically, so PATTERNS is a
 *     FULL-WIDTH, short band. Width is now the abundant axis and height is the
 *     scarce one — stacking there gave two ~140pt-tall panes, while splitting
 *     sideways gives two full-height panes. So DECK B becomes a COLUMN TO THE
 *     RIGHT of DECK A.
 *
 * Everything else is axis-agnostic and shared: the SAME stored ratio (it is
 * "pane 1's share", which is meaningful on either axis), the SAME engine
 * clamp band, the SAME divider component, the SAME PanResponder. The axis
 * selects which layout property, which gesture delta and which minimum a pane
 * is measured against — nothing about the deck's engine contract moves, and
 * DECK B's lifecycle (its ✕ is the one authoritative unbind) is untouched.
 */
import React, { useRef, useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, PanResponder, Platform, type LayoutChangeEvent } from 'react-native';
import { usePalette } from '@/hooks/use-theme';
import { usePerfLock } from '@/hooks/usePerformanceMode';
import { PlaylistPanel } from '@/components/PlaylistPanel';
import type { PlaylistAssignment } from '@/utils/api';

// Minimum on-screen extent for either pane, in points, ALONG THE SPLIT AXIS.
// The effective ratio is clamped so neither pane can be dragged below this —
// bounded input validation (NOT a fallback): the engine also rejects a ratio
// outside [0.15,0.85], and we keep our drag inside that same band. Below 2×MIN
// (a tiny / stacked column) we render a fixed 0.5 and leave the stored ratio
// untouched.
//
// The two axes get different floors because a playlist pane is not square: a
// 140pt-TALL pane still shows two or three entries and its header, but a
// 140pt-WIDE one cannot hold an entry label and its LOAD… control at all. 200
// is the width at which the pane's own header row stops wrapping.
const MIN_PANE_PT = 140;
const MIN_PANE_W_PT = 200;
// Engine-enforced ratio band (POST /deck/playlist/split 400s outside this).
const RATIO_MIN = 0.15;
const RATIO_MAX = 0.85;

function clampRatio(r: number): number {
  return Math.max(RATIO_MIN, Math.min(RATIO_MAX, r));
}

export function SplitPlaylistPanes({
  deckChannelId,
  disabled,
  locked,
  playlistLibrary,
  onRefreshConnection,
  primaryAssignment,
  splitRatio,
  secondaryBound,
  sideBySide = false,
  onSplitRelease,
  onCloseSecondary,
}: {
  /** The deck base channel id (drives the pane keys' React remount). */
  deckChannelId: string;
  /** Soft-disable both panes (deck swap in flight OR plan gate). */
  disabled?: boolean;
  /** Deck channel lock — hides destructive controls in both panes. */
  locked?: boolean;
  /** Parent-owned playlist library (shared, kept fresh by WS). */
  playlistLibrary?: string[];
  /** Refresh/reconnect handler (renders the ↻ header icon on pane 1). */
  onRefreshConnection?: () => void;
  /** The deck's live primary assignment, for pane 1's first-paint label. */
  primaryAssignment?: PlaylistAssignment | null;
  /** Divider ratio (pane-1 share, 0.15..0.85) from engine state. */
  splitRatio: number;
  /** Whether the engine reports a bound secondary slot. When true, pane 2 is
   *  expanded regardless of the local toggle (the binding IS the source of
   *  truth); when false the pane collapses to the "+ SECOND PLAYLIST" bar
   *  unless the operator has locally opened it to assign one. */
  secondaryBound?: boolean;
  /** Put DECK B in a COLUMN TO THE RIGHT of DECK A instead of underneath it.
   *  Driven by the app's layout mode: TRUE in the narrow/vertical stack, FALSE
   *  in the wide/horizontal row (operator order, report _225 — see the header).
   *  Placement only: the stored ratio, the engine routes and DECK B's binding
   *  lifecycle are identical on both axes. */
  sideBySide?: boolean;
  /** POST the new ratio (fired ONCE on drag release/terminate). */
  onSplitRelease: (ratio: number) => void;
  /** Clear the secondary slot binding (✕ on pane 2). */
  onCloseSecondary: () => void;
}) {
  const C = usePalette();

  // Local expand toggle for an UNBOUND secondary: the operator taps
  // "+ SECOND PLAYLIST" to reveal an unassigned pane whose LOAD… dropdown binds
  // a playlist. Once the engine reports the binding (secondaryBound) the pane
  // stays open on its own; ✕ clears the binding AND collapses.
  const [localOpen, setLocalOpen] = useState(false);
  const expanded = !!secondaryBound || localOpen;
  // PERFORMANCE MODE: binding/clearing the secondary pane is a 409-gated route
  // (POST /deck/playlist/secondary) — grey the "+ SECOND PLAYLIST" affordance
  // while a show is live (the pane's own dropdown is separately perf-locked
  // inside PlaylistPanel, so an already-open pane can't bind either).
  const perfLocked = usePerfLock();

  // Container extent ALONG THE SPLIT AXIS (from onLayout) drives the MIN_PANE
  // clamp + px→ratio math: height when the panes stack, width when they sit
  // side by side.
  const containerHRef = useRef(1);
  // Live drag ratio (local only). null when not dragging → render `splitRatio`.
  const [dragRatio, setDragRatio] = useState<number | null>(null);
  // Refs so the once-built PanResponder reads live values (HorizontalFader idiom).
  const draggingRef = useRef(false);
  const startRatioRef = useRef(splitRatio);
  const splitRatioRef = useRef(splitRatio);
  splitRatioRef.current = splitRatio;
  const onSplitReleaseRef = useRef(onSplitRelease);
  onSplitReleaseRef.current = onSplitRelease;
  // The axis is a PROP that can flip while mounted (the operator rotates the
  // iPad mid-drag, in the worst case), and the PanResponder is built once — so
  // it reads the axis through a ref like every other live value here.
  const sideBySideRef = useRef(sideBySide);
  sideBySideRef.current = sideBySide;

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    containerHRef.current = Math.max(1, sideBySideRef.current ? width : height);
  }, []);

  // Effective clamp band given the current container height. When the column is
  // too short to seat two MIN_PANE panes we can't resize meaningfully, so we
  // force a fixed 0.5 split (per deck_split_playlists.md §Resizable split) — NOT
  // the raw `r`, which for a small `h` could compute `startRatio + dy/h` outside
  // [0,1] and produce a NEGATIVE flexGrow on pane 1. The STORED ratio is left
  // untouched (this only affects what's painted / POSTed while the column is too
  // short); it comes back the moment the column is tall enough again.
  const effectiveClamp = (r: number): number => {
    const h = containerHRef.current;
    const min = sideBySideRef.current ? MIN_PANE_W_PT : MIN_PANE_PT;
    if (h < 2 * min) return 0.5;
    const lo = Math.max(RATIO_MIN, min / h);
    const hi = Math.min(RATIO_MAX, 1 - min / h);
    return Math.max(lo, Math.min(hi, r));
  };

  // The gesture delta along the split axis: sideways when the panes are side
  // by side, vertical when they stack.
  const axisDelta = (gs: { dx: number; dy: number }): number =>
    (sideBySideRef.current ? gs.dx : gs.dy);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      // CAPTURE + refuse termination so the surrounding column ScrollView can't
      // steal the vertical drag (exactly the HorizontalFader fix, transposed to
      // the Y axis).
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponderCapture: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        draggingRef.current = true;
        startRatioRef.current = splitRatioRef.current;
        setDragRatio(splitRatioRef.current);
      },
      onPanResponderMove: (_evt, gs) => {
        const next = effectiveClamp(startRatioRef.current + axisDelta(gs) / containerHRef.current);
        setDragRatio(next);
      },
      onPanResponderRelease: (_evt, gs) => {
        const next = clampRatio(effectiveClamp(startRatioRef.current + axisDelta(gs) / containerHRef.current));
        draggingRef.current = false;
        setDragRatio(null);
        onSplitReleaseRef.current(next);
      },
      // A cancelled gesture (browser pointercancel / focus loss) never fires
      // Release — mirror it so draggingRef clears and the ratio still lands.
      onPanResponderTerminate: (_evt, gs) => {
        const next = clampRatio(effectiveClamp(startRatioRef.current + axisDelta(gs) / containerHRef.current));
        draggingRef.current = false;
        setDragRatio(null);
        onSplitReleaseRef.current(next);
      },
    })
  ).current;

  // The ratio actually painted: the live drag value while dragging, else the
  // engine's stored ratio, always run through the effective clamp so a stale /
  // out-of-band stored value can't crush a pane below MIN_PANE.
  const paintRatio = effectiveClamp(dragRatio ?? splitRatio);

  // ── Collapsed: today's single list + a slim "+ SECOND PLAYLIST" bar ──────
  // Pixel-identical to the pre-change deck for operators who never open pane 2.
  if (!expanded) {
    return (
      <View style={{ flex: 1, minHeight: 0 }}>
        {/* key on deckChannelId so a deck-channel-id change (e.g. a model/scene
            swap that re-IDs the deck base channel) remounts the pane with fresh
            per-instance panel state instead of carrying stale assignment/entry
            cache across the switch. The slot key ('primary') is stable; the deck
            id is what changes. */}
        <View key={`primary-${deckChannelId}`} style={{ flex: 1, minHeight: 0 }}>
          {/* midiWindowChannelId: the MIDI manager publishes the deck tab's
              playlist browse window under the DECK CHANNEL's engine id, not
              the slot key — pass it so this pane shows the same blue MIDI
              window highlight the mixer strips draw (PlaylistPanel gates
              it on the slot being the LIVE one). */}
          <PlaylistPanel
            channelId="primary"
            role="deckSlot"
            channelLabel="DECK A"
            locked={locked}
            initialAssignment={primaryAssignment ?? null}
            disabled={disabled}
            onRefreshConnection={onRefreshConnection}
            playlistLibrary={playlistLibrary}
            midiWindowChannelId={deckChannelId}
          />
        </View>
        <TouchableOpacity
          onPress={() => setLocalOpen(true)}
          disabled={disabled || perfLocked}
          accessibilityRole="button"
          accessibilityLabel="Add a second playlist pane"
          accessibilityState={{ disabled: disabled || perfLocked }}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={{
            marginTop: 8,
            paddingVertical: 10,
            borderRadius: 8,
            borderWidth: 1,
            borderStyle: 'dashed',
            borderColor: C.ghostBorder,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: (disabled || perfLocked) ? 0.4 : 1,
          }}
        >
          <Text style={{
            fontFamily: 'SpaceGrotesk_700Bold', fontSize: 11, letterSpacing: 0.8,
            color: C.secondary, textTransform: 'uppercase',
          }}>
            + SECOND PLAYLIST
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── Expanded: two panes + drag divider ───────────────────────────────────
  // `paneBox` is the ONE place the axis changes a pane's geometry: flexBasis:0
  // + flexGrow(share) does the splitting on either axis, and BOTH minimums are
  // zeroed so a flex child can actually shrink to its share (RN children
  // otherwise refuse to go below their content size and overflow the row).
  const paneBox = { flexBasis: 0, minHeight: 0, minWidth: 0 } as const;
  return (
    <View
      style={{ flex: 1, minHeight: 0, flexDirection: sideBySide ? 'row' : 'column' }}
      onLayout={onLayout}
    >
      {/* Pane 1 — DECK A (primary). flexGrow = ratio share; flexBasis:0 so it
          truly splits the container rather than sizing to its content. */}
      <View key={`primary-${deckChannelId}`} style={{ ...paneBox, flexGrow: paintRatio }}>
        {/* Both panes read the deck channel's MIDI browse window (the manager
            keys it by engine channel id, not slot key); PlaylistPanel's
            live-slot gate means only the pane hosting the deck's LIVE
            playlist paints the blue window highlight.

            `compactRows={perfLocked}` — operator request 2026-08-20: in
            PERFORMANCE MODE with two playlists open, each pane's share of the
            column is small (default 50/50 of a ~500pt column ≈ 250pt) and the
            live-show perf tier's ~62pt rows fit fewer than three patterns per
            pane. Under `perfCompact`, playlist_row_sizing yields the docs/66
            44pt-min floor with the padding-only diet (rowPadY:2, rowGap:1) —
            the same discipline docs/69 W3 R1 uses on the mixer strip — so
            more patterns are reachable at a glance without shrinking any
            glyph or per-control tap target. Off in edit mode (byte-identical
            to before) and off when the second pane is collapsed (see the
            branch above — only one big pane is on-screen there). */}
        <PlaylistPanel
          channelId="primary"
          role="deckSlot"
          channelLabel="DECK A"
          locked={locked}
          initialAssignment={primaryAssignment ?? null}
          disabled={disabled}
          onRefreshConnection={onRefreshConnection}
          playlistLibrary={playlistLibrary}
          midiWindowChannelId={deckChannelId}
          compactRows={perfLocked}
        />
      </View>

      {/* Divider — a ~14pt grip band ACROSS the split axis; hitSlop lifts the
          touch target to 44pt on the axis it is dragged along. Token colours
          only. A short centred grip bar marks it as draggable, turned to lie
          along the divider in both orientations. */}
      <View
        {...panResponder.panHandlers}
        accessibilityRole="adjustable"
        accessibilityLabel={sideBySide
          ? 'Resize the two playlist columns'
          : 'Resize the two playlist panes'}
        hitSlop={sideBySide
          ? { top: 0, bottom: 0, left: 15, right: 15 }
          : { top: 15, bottom: 15, left: 0, right: 0 }}
        style={[
          sideBySide
            ? { width: 14, alignItems: 'center', justifyContent: 'center', marginHorizontal: 2 }
            : { height: 14, alignItems: 'center', justifyContent: 'center', marginVertical: 2 },
          // Web + side-by-side only. This divider is dragged SIDEWAYS while it
          // sits inside the deck's vertical scroll region, and a browser starts
          // panning from a touch on a scrollable ancestor before React's
          // responder system hears about it (the same fix hue_wheel carries).
          // Scoped to the new axis so the shipped vertical divider — which has
          // worked since the split landed — is not touched.
          sideBySide && Platform.OS === 'web' ? ({ touchAction: 'none' } as any) : null,
        ]}
      >
        <View style={{
          width: sideBySide ? 4 : 44,
          height: sideBySide ? 44 : 4,
          borderRadius: 2,
          backgroundColor: dragRatio !== null ? C.primary : C.ghostBorder,
        }} />
      </View>

      {/* Pane 2 — DECK B (secondary). Complementary flexGrow share; ✕ (onClosePane)
          clears the slot binding AND collapses back to the "+ SECOND PLAYLIST"
          bar. Its binding lifecycle is identical on both axes — this is
          placement, nothing else. `compactRows={perfLocked}` mirrors DECK A —
          same rationale, same gate. */}
      <View key={`secondary-${deckChannelId}`} style={{ ...paneBox, flexGrow: 1 - paintRatio }}>
        <PlaylistPanel
          channelId="secondary"
          role="deckSlot"
          channelLabel="DECK B"
          locked={locked}
          disabled={disabled}
          playlistLibrary={playlistLibrary}
          onClosePane={() => { setLocalOpen(false); onCloseSecondary(); }}
          midiWindowChannelId={deckChannelId}
          compactRows={perfLocked}
        />
      </View>
    </View>
  );
}
