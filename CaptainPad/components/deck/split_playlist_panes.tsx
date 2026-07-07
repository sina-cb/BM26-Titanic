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
 */
import React, { useRef, useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, PanResponder, type LayoutChangeEvent } from 'react-native';
import { usePalette } from '@/hooks/use-theme';
import { PlaylistPanel } from '@/components/PlaylistPanel';
import type { PlaylistAssignment } from '@/utils/api';

// Minimum on-screen height for either pane, in points. The effective ratio is
// clamped so neither pane can be dragged below this — bounded input validation
// (NOT a fallback): the engine also rejects a ratio outside [0.15,0.85], and we
// keep our drag inside that same band. Below 2×MIN (a tiny / stacked column) we
// render a fixed 0.5 and leave the stored ratio untouched.
const MIN_PANE_PT = 140;
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

  // Container height (from onLayout) drives the MIN_PANE clamp + px→ratio math.
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

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    containerHRef.current = Math.max(1, e.nativeEvent.layout.height);
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
    if (h < 2 * MIN_PANE_PT) return 0.5;
    const lo = Math.max(RATIO_MIN, MIN_PANE_PT / h);
    const hi = Math.min(RATIO_MAX, 1 - MIN_PANE_PT / h);
    return Math.max(lo, Math.min(hi, r));
  };

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
        const next = effectiveClamp(startRatioRef.current + gs.dy / containerHRef.current);
        setDragRatio(next);
      },
      onPanResponderRelease: (_evt, gs) => {
        const next = clampRatio(effectiveClamp(startRatioRef.current + gs.dy / containerHRef.current));
        draggingRef.current = false;
        setDragRatio(null);
        onSplitReleaseRef.current(next);
      },
      // A cancelled gesture (browser pointercancel / focus loss) never fires
      // Release — mirror it so draggingRef clears and the ratio still lands.
      onPanResponderTerminate: (_evt, gs) => {
        const next = clampRatio(effectiveClamp(startRatioRef.current + gs.dy / containerHRef.current));
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
        <View style={{ flex: 1, minHeight: 0 }}>
          <PlaylistPanel
            channelId="primary"
            role="deckSlot"
            channelLabel="DECK A"
            locked={locked}
            initialAssignment={primaryAssignment ?? null}
            disabled={disabled}
            onRefreshConnection={onRefreshConnection}
            playlistLibrary={playlistLibrary}
          />
        </View>
        <TouchableOpacity
          onPress={() => setLocalOpen(true)}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel="Add a second playlist pane"
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
            opacity: disabled ? 0.4 : 1,
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
  return (
    <View style={{ flex: 1, minHeight: 0 }} onLayout={onLayout}>
      {/* Pane 1 — DECK A (primary). flexGrow = ratio share; flexBasis:0 +
          minHeight:0 so it truly splits the container rather than sizing to its
          content. */}
      <View style={{ flexGrow: paintRatio, flexBasis: 0, minHeight: 0 }}>
        <PlaylistPanel
          channelId="primary"
          role="deckSlot"
          channelLabel="DECK A"
          locked={locked}
          initialAssignment={primaryAssignment ?? null}
          disabled={disabled}
          onRefreshConnection={onRefreshConnection}
          playlistLibrary={playlistLibrary}
        />
      </View>

      {/* Divider — a ~14pt grip row; hitSlop lifts the touch target to 44pt.
          Token colours only. A short centered grip bar marks it as draggable. */}
      <View
        {...panResponder.panHandlers}
        accessibilityRole="adjustable"
        accessibilityLabel="Resize the two playlist panes"
        hitSlop={{ top: 15, bottom: 15, left: 0, right: 0 }}
        style={{
          height: 14,
          alignItems: 'center',
          justifyContent: 'center',
          marginVertical: 2,
        }}
      >
        <View style={{
          width: 44,
          height: 4,
          borderRadius: 2,
          backgroundColor: dragRatio !== null ? C.primary : C.ghostBorder,
        }} />
      </View>

      {/* Pane 2 — DECK B (secondary). Complementary flexGrow share; ✕ (onClosePane)
          clears the slot binding AND collapses back to the "+ SECOND PLAYLIST"
          bar. */}
      <View style={{ flexGrow: 1 - paintRatio, flexBasis: 0, minHeight: 0 }}>
        <PlaylistPanel
          channelId="secondary"
          role="deckSlot"
          channelLabel="DECK B"
          locked={locked}
          disabled={disabled}
          playlistLibrary={playlistLibrary}
          onClosePane={() => { setLocalOpen(false); onCloseSecondary(); }}
        />
      </View>
    </View>
  );
}
