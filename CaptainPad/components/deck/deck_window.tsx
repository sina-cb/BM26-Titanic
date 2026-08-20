/**
 * DeckWindow — one track of the Deck window workspace
 * (contract: docs/53_deck_workspace_windows.md §3.3/§3.4).
 *
 * This component IS the column View the Deck already had: the caller passes
 * the column's style array, so the window owns layout management, not
 * geometry. RESTYLE (docs/54 §3, slice R2): the caller now passes the shared
 * `panel` recipe as the first entry of that array, so every open window sits
 * on the SAME one-object surface (fill + hairline + inset highlight + ambient
 * shadow). Before the restyle PATTERNS was a pane while PARAMETERS/AUTOPILOT/
 * COLORS were bare transparent scroll columns with floating cards — the
 * single biggest visual delta of the reskin. The window itself still adds
 * exactly two things:
 *
 *   1. `display: 'none'` when closed. The window is NEVER unmounted, which is
 *      what keeps playlist scroll offsets, in-flight parameter edits and the
 *      live WS reconciles alive while it is off screen. A closed window leaves
 *      the layout ENTIRELY (a `display:'none'` box is not laid out), so the
 *      survivors reflow into its space and there are no empty tracks.
 *   2. Its identity for accessibility + validators (`expanded` state, a
 *      `data-deckwindow` marker on web).
 *
 * There is deliberately NO in-window header row: the minimize/restore
 * affordances all live in the single DeckWorkspaceBar above the tracks, so
 * window chrome adds ZERO height inside a track (default-layout parity) and
 * never sits over a card's own controls or a PanResponder gesture zone.
 */
import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import {
  DECK_WINDOW_TITLES,
  windowDisplay,
  type DeckWindowId,
} from '@/components/deck/deck_workspace_layout';

export interface DeckWindowProps {
  id: DeckWindowId;
  /** From the workspace layout state — hidden, not unmounted, when false. */
  open: boolean;
  /** The track's existing column style, passed through untouched. */
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}

export function DeckWindow({ id, open, style, children }: DeckWindowProps) {
  return (
    <View
      // dataSet is an RN-web DOM marker (→ data-deckwindow); it is not on the
      // native View prop types, so cast it in like the columns host does.
      {...({ dataSet: { deckwindow: id, deckwindowopen: open ? '1' : '0' } } as object)}
      accessibilityLabel={`${DECK_WINDOW_TITLES[id]} window`}
      accessibilityState={{ expanded: open }}
      style={[style, { display: windowDisplay(open) }]}
    >
      {children}
    </View>
  );
}
