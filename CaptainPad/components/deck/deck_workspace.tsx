/**
 * deck_workspace — the Deck tab's window workspace: the layout controller hook
 * plus the workspace BAR that minimizes and restores windows
 * (contract: docs/53_deck_workspace_windows.md §3, design report _196).
 *
 * The tracks themselves stay in app/(tabs)/index.tsx wrapped in <DeckWindow>
 * (their content is the deck screen's own state), so this module owns exactly
 * two things:
 *
 *   • `useDeckWorkspace()` — the reducer state + AsyncStorage hydrate/persist.
 *     LAYOUT ONLY: the closed set, under the versioned key
 *     `deck_workspace_layout_v1`. Never engine state, never a selection, never
 *     the split ratio (that one is engine-owned via /deck/playlist/slots).
 *     A layout op sends NO REST/WS traffic — minimize is not close: the ✕ on
 *     DECK B inside SplitPlaylistPanes remains the one and only
 *     engine-authoritative unbind.
 *
 *   • `<DeckWorkspaceBar>` — ONE compact row directly under the LIVE OUTPUT
 *     header listing every window: open windows as "hide" chips (canonical
 *     order) and, after a HIDDEN divider, the restore rail — the closed
 *     windows in CLOSE order (Live Touch rule 2: a window with no chip is
 *     unreachable, which is worse than one that is always there). PATTERNS
 *     renders as a static chip with no press handler at all, because an
 *     affordance that always refuses should not exist (Live Touch rule 3,
 *     sharpened in docs/53 §3.1).
 *
 * The bar is a normal sibling ROW — never an overlay — so it can never steal a
 * fader/split-divider PanResponder gesture, and it lives inside the plan-lock
 * content wrapper so the hermetic PlanLockScrim freezes the window chrome
 * along with everything else it covers (docs/38 outranks the convenience of
 * re-arranging windows mid-plan).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { usePalette } from '@/hooks/use-theme';
import { Palette, Space, Type } from '@/constants/theme';
import { MIDI_ACCENT, AUDIO_BAND_FALLBACK as ACCENT_AUTO } from '@/constants/identity';
import { identityDot } from '@/styles/design_recipes';
import { useSharedParamValues } from '@/hooks/useEngineState';
import { DualSwatch } from '@/components/ColorPickerModal';
import { usePerformanceMode } from '@/hooks/usePerformanceMode';
import { WorkspaceChip } from '@/components/ui/workspace_chip';
import {
  DECK_BAR_TITLES,
  DECK_WINDOW_TITLES,
  DECK_WORKSPACE_LAYOUT_KEY,
  DEFAULT_LAYOUT,
  PERF_BAR_CAPTION,
  PERF_HIDDEN_WINDOWS,
  PIXELS_BAR_CAPTION,
  PIXELS_SUPPRESSES,
  PROTECTED_WINDOW,
  effectiveOpenWindows,
  effectiveShownBars,
  isDeckWindowId,
  layoutReducer,
  normalizeLayout,
  railSurfaces,
  serializeLayout,
  wideFlexFor,
  type DeckBarId,
  type DeckSurfaceId,
  type DeckWindowId,
  type DeckWorkspaceLayout,
  type LayoutAction,
} from '@/components/deck/deck_workspace_layout';

// The 8pt hitSlop / 44pt hit-target floor is the shared `<WorkspaceChip>`'s
// concern now (`components/ui/workspace_chip.tsx`, `WORKSPACE_CHIP_HIT_SLOP`).

// ── WINDOW IDENTITY (docs/54 §3, restyle slice R2) ──────────────────────
//
// Each window owns a colour. The chip's dot wears it whether the window is
// open or on the HIDDEN rail, so closing and restoring reads as the SAME
// object moving rather than a chip appearing somewhere else. The chip's
// GROUND (not its dot) is what carries open-vs-hidden.
//
//   PATTERNS   `primary`   — the deck's own accent; this is the floor window.
//   PARAMETERS MIDI violet — the params ARE the physical-knob surface, and
//                            violet is already the app-wide family for that
//                            (constants/identity.ts). Theme-independent on
//                            purpose: a mapped encoder is the same encoder
//                            on every palette.
//   AUTOPILOT  `tertiary`  — the palette's auto-driven/synced green, which is
//                            literally this window's semantic.
//   COLORS     LIVE C1/C2  — the truthful option: this window's identity IS
//                            the current palette, so its "dot" is a live
//                            DualSwatch of the engine's two colour slots.
//   PIXELS     `secondary`  — the palette's NEUTRAL ink (report _225). Every
//                            other accent in this row means "this window is
//                            about X"; PIXELS is about the rig's own colour,
//                            so claiming an accent of its own would compete
//                            with the thing it displays. Neutral is the
//                            statement. Contrast-guarded like the rest:
//                            `secondary` clears the 3:1 UI-component bar on
//                            BOTH chip grounds on all five themes (worst case
//                            gruvbox, 4.72) and collides with no other dot —
//                            `restyle_contrast.test.ts` pins both.
//
// Violet is QUIET-only (R0 finding: '#7c5cff' clears neither ink at 4.5:1),
// which is exactly how it is used here — an 8pt dot, never a fill.
//
// ── BAR IDENTITY (docs/63 §3.3, W2) ──────────────────────────────────────
//
//   AUDIO (`audioBar`)  → `ACCENT_AUTO` (imported here from
//                          `constants/identity.ts` under its re-export name
//                          `AUDIO_BAND_FALLBACK`) — the app-wide
//                          "audio/tempo is driving" green, '#1b9e77'.
//                          MEASURED worst case: light theme's OPEN chip
//                          ground at 3.074:1 — it clears the 3:1 gate (just),
//                          so the doc's default stands; no need to fall back
//                          to `tertiary`.
//   OUTPUT (`outputBar`) → docs/63 §3.3 names `C.icon`, but MEASURED it fails
//                          badly on the light theme: 1.549:1 on the open chip
//                          ground, 1.705:1 on the hidden one (both light chip
//                          grounds are near-white, and light's `icon` is
//                          `#bac9cc` — a pale outline-variant tuned for
//                          darker chrome, not a dot on near-white). That is
//                          nowhere near 3:1, so shipping it would be a silent
//                          failure, not a rounding edge. Applying the SAME
//                          escape valve §3.3 grants `audioBar` (measure; if
//                          it fails, pick a working neutral and record the
//                          substitution): `outputBar` uses `C.text` instead —
//                          the app's own ink colour, which clears both 3:1
//                          and AA text 4.5:1 on every chip ground of every
//                          theme (worst case 9.571:1, gruvbox open ground),
//                          and is a distinct hex from `secondary` (PIXELS'
//                          dot) on every theme, so the two neutrals never
//                          collide. `restyle_contrast.test.ts` pins all of
//                          the above.
function identityColorFor(id: DeckSurfaceId, C: Palette): string {
  switch (id) {
    case 'patterns': return C.primary;
    case 'parameters': return MIDI_ACCENT;
    case 'autopilot': return C.tertiary;
    case 'pixels': return C.secondary;
    // Never rendered — the COLORS chip draws <ColorsIdentityDot> instead.
    // Kept total so a future surface id cannot silently fall through.
    case 'colors': return C.primary;
    case 'audioBar': return ACCENT_AUTO;
    case 'outputBar': return C.text;
    default: throw new Error(`[deck_workspace] no identity colour for surface '${id}'`);
  }
}

/**
 * Chip grounds (docs/54 §3) — HIDDEN → `surfaceContainerLowest` +
 * `ghostBorder`, OPEN → `surfaceContainerLow` + `borderStrong` (the chip
 * wears the same surface as the WINDOW it stands for, `panel` is
 * `surfaceContainerLow`, so the bar reads as a row of little windows).
 * CONTRAST NOTE: the PARAMETERS dot is the fixed MIDI violet, which measures
 * under the 3:1 WCAG 1.4.11 bar on `surfaceContainerHigh` (gruvbox 2.67:1)
 * but clears it on `surfaceContainerLow` on every theme (gruvbox 3.02:1, the
 * binding case) — the reason the open ground is not a step "up" in surface.
 * `restyle_contrast.test.ts` pins that. Painting the grounds is now the
 * shared `<WorkspaceChip>`'s job (`components/ui/workspace_chip.tsx`,
 * docs/64 §10 convergence) — this file supplies only the DOT, the LABEL and
 * the ACCESSIBILITY wording per surface id.
 */

/** The COLORS window's dot: a live two-tone swatch of the engine's
 *  `colorPalette1` / `colorPalette2`. Subscribes to the same broadcast slice
 *  the COLORS window itself reads — a read-only subscription, no traffic. */
const ColorsIdentityDot = React.memo(function ColorsIdentityDot() {
  const shared = useSharedParamValues({
    colorPalette1: { h: 0 } as { h: number },
    colorPalette2: { h: 0.5 } as { h: number },
  }) as { colorPalette1: { h: number }; colorPalette2: { h: number } };
  const h1 = typeof shared.colorPalette1?.h === 'number' ? shared.colorPalette1.h : 0;
  const h2 = typeof shared.colorPalette2?.h === 'number' ? shared.colorPalette2.h : 0.5;
  return <DualSwatch h1={h1} h2={h2} size={10} />;
});

export interface DeckWorkspaceController {
  /** The live PERSISTED layout (closed set, in close order). Untouched by the
   *  performance overlay in either direction. */
  layout: DeckWorkspaceLayout;
  /** Open windows in canonical render order, AFTER the performance overlay. */
  open: DeckWindowId[];
  isOpen: (id: DeckWindowId) => boolean;
  /** Wide-mode flex weight for a track (0 when the window is not shown).
   *  WINDOW-ONLY (docs/63 §2.1) — bars never receive a flex weight, never a
   *  track, never a vote in `patternsFillsNarrow`. */
  flexFor: (id: DeckWindowId) => number;
  /** Bars shown after the PIXELS suppression (docs/63 §2.4), in canonical
   *  order. THE DERIVATION ORDER IS FIXED (§2.4): persisted layout → perf
   *  overlay (windows, via the `open` memo above) → pixels suppression
   *  (bars) — there is exactly one effective-open-windows computation in
   *  this hook, and `barsShown` is derived from it, never a second one. */
  barsShown: DeckBarId[];
  isBarShown: (id: DeckBarId) => boolean;
  openWindow: (id: DeckSurfaceId) => void;
  closeWindow: (id: DeckSurfaceId) => void;
  /** Is the performance overlay composing the screen right now? */
  perfActive: boolean;
}

/**
 * Layout state + persistence. Hydrates once on mount; every transition writes
 * the new closed set back fire-and-forget. A corrupt stored PREFERENCE resets
 * loudly to the default (console.error) — this is a view preference, not
 * engine state, and refusing to render the Deck over a stale layout cookie
 * would invert the mission priority (docs/53 §3.2).
 */
export function useDeckWorkspace(): DeckWorkspaceController {
  const [layout, setLayout] = useState<DeckWorkspaceLayout>(DEFAULT_LAYOUT);
  // Mirror of the live layout so the dispatcher can stay a zero-dependency
  // stable callback (a changing callback identity would re-render every chip).
  const layoutRef = useRef<DeckWorkspaceLayout>(DEFAULT_LAYOUT);
  // If the operator minimizes something before the async hydrate lands, their
  // action wins — the stored preference must never overwrite a live intent.
  const touchedRef = useRef(false);

  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(DECK_WORKSPACE_LAYOUT_KEY).then((raw) => {
      if (!alive || touchedRef.current || raw == null) return;
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(raw);
      } catch (err) {
        console.error('[Deck] workspace layout store is corrupt — using the default layout:', err);
        const fresh = normalizeLayout(null);
        layoutRef.current = fresh;
        setLayout(fresh);
        return;
      }
      const next = normalizeLayout(parsed);
      layoutRef.current = next;
      setLayout(next);
    }).catch((err) => {
      console.error('[Deck] workspace layout read failed — using the default layout:', err);
    });
    return () => { alive = false; };
  }, []);

  const dispatch = useCallback((action: LayoutAction) => {
    const prev = layoutRef.current;
    const next = layoutReducer(prev, action);
    // The reducer returns the SAME reference for a no-op (e.g. close(patterns)),
    // so nothing re-renders and nothing is written.
    if (next === prev) return;
    touchedRef.current = true;
    layoutRef.current = next;
    setLayout(next);
    // `serializeLayout` stamps the set of windows this build knows about
    // alongside the closed set, so a LATER build that adds a window can tell
    // "he opened it" from "it did not exist yet" (report _225).
    AsyncStorage.setItem(
      DECK_WORKSPACE_LAYOUT_KEY,
      JSON.stringify(serializeLayout(next)),
    ).catch((err) => {
      // The in-memory layout stays authoritative for this session.
      console.error('[Deck] workspace layout save failed:', err);
    });
  }, []);

  const openWindow = useCallback((id: DeckSurfaceId) => dispatch({ type: 'open', id }), [dispatch]);
  const closeWindow = useCallback((id: DeckSurfaceId) => dispatch({ type: 'close', id }), [dispatch]);

  // THE PERFORMANCE OVERLAY (docs/55 §2.5). Derived HERE, at the isOpen /
  // flexFor / rail boundary — never through the reducer, never through
  // AsyncStorage. `app/(tabs)/index.tsx` keeps calling `workspace.isOpen(id)`
  // unchanged and the two windows hide and reappear on their own.
  //
  // Read RAW (`usePerformanceMode().active`), NOT `usePerfLock()`: the lock's
  // captain-session bypass is about EDIT RIGHTS, not screen composition —
  // "performance mode hides the panels" should mean the mode, for every
  // session, symmetric on exit. An unresolved state defaults to inactive
  // (everything shown), because hiding on unknown state would be a fallback
  // behavior (codex P0).
  const perfActive = usePerformanceMode().active;

  const open = useMemo(() => effectiveOpenWindows(layout, perfActive), [layout, perfActive]);
  const isOpen = useCallback((id: DeckWindowId) => open.includes(id), [open]);
  const flexFor = useCallback((id: DeckWindowId) => wideFlexFor(open, id), [open]);

  // THE PIXELS → OUTPUT suppression (docs/63 §2.4), derived — never
  // persisted, never a reducer action, exactly like the performance overlay
  // above. `open` is ALREADY the perf-overlay-effective window set, so
  // `pixelsShown` here IS the effective visibility `effectiveShownBars`
  // requires — there is no second effective-open computation in this hook.
  const pixelsShown = open.includes('pixels');
  const barsShown = useMemo(() => effectiveShownBars(layout, pixelsShown), [layout, pixelsShown]);
  const isBarShown = useCallback((id: DeckBarId) => barsShown.includes(id), [barsShown]);

  return { layout, open, isOpen, flexFor, barsShown, isBarShown, openWindow, closeWindow, perfActive };
}

// ── The workspace bar ────────────────────────────────────────────────────

interface WindowChipProps {
  id: DeckSurfaceId;
  open: boolean;
  onPress: ((id: DeckSurfaceId) => void) | null;
}

/** One chip — window OR bar (docs/63 §3.2/§3.3: the two tiers share this
 *  exact recipe, same grounds, same ▾/▸ glyphs, same 44pt hit target, so a
 *  bar chip and a window chip are indistinguishable in everything except
 *  which title/colour they carry). Thin wrapper over the shared
 *  `<WorkspaceChip>` (`components/ui/workspace_chip.tsx`, docs/64 §10
 *  convergence): this module keeps only the DECK-SPECIFIC knowledge — which
 *  id maps to which title/dot/kind, and the deck's own accessibility
 *  wording ("window"/"bar" in the sentence, PATTERNS' "always shown" vs a
 *  restore/hide verb). Module-scoped (stable identity) + memoized: a layout
 *  change must not churn the chips of the surfaces it did not touch. */
const WindowChip = React.memo(function WindowChip({ id, open, onPress }: WindowChipProps) {
  const C = usePalette();
  const handlePress = useCallback(() => { if (onPress) onPress(id); }, [onPress, id]);
  const isWindow = isDeckWindowId(id);
  const title = isWindow ? DECK_WINDOW_TITLES[id] : DECK_BAR_TITLES[id];
  const kind = isWindow ? 'window' : 'bar';

  // The identity dot is the SAME in both states (docs/54 §3) — the chip's
  // ground and its ▾/▸ glyph carry open-vs-hidden, not the colour.
  const dot = id === 'colors'
    ? <ColorsIdentityDot />
    : <View style={identityDot(identityColorFor(id, C), 10)} />;

  // PATTERNS: no press handler, no chevron — the deck's pattern lists are the
  // floor of the workspace, so the chip is a status label, not a control.
  // This branch only ever sees PATTERNS (both bars close freely, docs/63
  // §2.2), so `kind` here is always 'window'.
  const accessibilityLabel = onPress
    ? (open ? `Hide the ${title} ${kind}` : `Show the ${title} ${kind}`)
    : `${title} ${kind} is always shown`;

  return (
    <WorkspaceChip
      label={title}
      dot={dot}
      open={open}
      onPress={onPress ? handlePress : null}
      accessibilityLabel={accessibilityLabel}
    />
  );
});

export interface DeckWorkspaceBarProps {
  layout: DeckWorkspaceLayout;
  onOpen: (id: DeckSurfaceId) => void;
  onClose: (id: DeckSurfaceId) => void;
  /** Performance overlay active — PARAMETERS/AUTOPILOT chips are SUPPRESSED
   *  and one static caption stands in their place (docs/55 D3). */
  perfActive?: boolean;
  /** Rendered OUTSIDE the horizontal chip ScrollView, right-aligned, and
   *  never scrolled away or clipped (docs/63 §3.2) — this is where the
   *  plan-lock cluster (PLAN LIVE / TOOK OVER chips + `PlanIndicatorPill`)
   *  lands: those are safety-relevant and must never be one swipe away.
   *  `undefined` renders the bar exactly as it rendered before this prop
   *  existed — no wrapper, no reserved space. */
  trailing?: React.ReactNode;
}

export const DeckWorkspaceBar = React.memo(function DeckWorkspaceBar(
  { layout, onOpen, onClose, perfActive = false, trailing }: DeckWorkspaceBarProps,
) {
  const C = usePalette();

  // The bar derives its OWN composition from `layout` + `perfActive` using
  // the exact same pure functions `useDeckWorkspace` uses — `effectiveOpenWindows`,
  // `effectiveShownBars`, `railSurfaces` — so the hook's state and what this
  // bar renders can never diverge (docs/63 §3.2/§3.3).
  const openWindowIds = useMemo(() => effectiveOpenWindows(layout, perfActive), [layout, perfActive]);
  const pixelsShown = openWindowIds.includes('pixels');
  const shownBarIds = useMemo(() => effectiveShownBars(layout, pixelsShown), [layout, pixelsShown]);
  // The restore rail across BOTH tiers, in close order. `railSurfaces`
  // already interleaves windows and bars exactly as they were closed; this
  // filter applies the SAME two suppression predicates `effectiveRailWindows`
  // (perf-hidden windows) and `effectiveShownBars` (pixels-suppressed bars)
  // apply, just over the combined list, so the interleaving survives.
  const rail = useMemo(() => {
    const all = railSurfaces(layout);
    return all.filter((id) => (
      isDeckWindowId(id)
        ? !(perfActive && PERF_HIDDEN_WINDOWS.includes(id))
        : !(pixelsShown && PIXELS_SUPPRESSES.includes(id))
    ));
  }, [layout, perfActive, pixelsShown]);

  return (
    <View
      {...({ dataSet: { deckworkspacebar: '1' } } as object)}
      style={styles.bar}
    >
      {/* Horizontal pill-bar idiom (TimerPillBar): chips fit an iPad
          landscape row easily and scroll rather than wrap on a narrow phone,
          so the bar is always exactly one row tall. `scrollArea` gives this
          ScrollView its own flex context so `trailing` (below) can claim its
          own space instead of being pushed off. */}
      <ScrollView
        horizontal
        style={styles.scrollArea}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.barContent}
        keyboardShouldPersistTaps="handled"
      >
        {openWindowIds.map((id) => (
          <WindowChip
            key={id}
            id={id}
            open
            onPress={id === PROTECTED_WINDOW ? null : onClose}
          />
        ))}
        {shownBarIds.map((id) => (
          <WindowChip key={id} id={id} open onPress={onClose} />
        ))}
        {rail.length > 0 ? (
          <>
            {/* The HIDDEN divider is a real boundary between two kinds of
                chip, so it wears `borderStrong` (≥3:1 on every surface) —
                `ghostBorder` is decoration and disappeared against the bar. */}
            <View style={[styles.divider, { backgroundColor: C.borderStrong }]} />
            <Text style={[styles.railCaption, { color: C.icon }]}>HIDDEN</Text>
          </>
        ) : null}
        {rail.map((id) => (
          <WindowChip key={id} id={id} open={false} onPress={onOpen} />
        ))}
        {/* D3: where the two suppressed chips were, ONE static caption. The
            windows are deliberately unreachable during a show, so no chip
            pretends otherwise — but "where did my windows go" still has an
            answer on the same row they vanished from. */}
        {perfActive ? (
          <>
            <View style={[styles.divider, { backgroundColor: C.borderStrong }]} />
            <Text style={[styles.railCaption, { color: C.icon }]}>{PERF_BAR_CAPTION}</Text>
          </>
        ) : null}
        {/* docs/63 §2.4: while PIXELS is effectively shown, the OUTPUT chip
            is absent from BOTH the open row and the rail regardless of the
            operator's persisted preference for it, so this caption's wording
            is true either way — it renders on `pixelsShown` alone, and can
            appear alongside the perf caption above. */}
        {pixelsShown ? (
          <>
            <View style={[styles.divider, { backgroundColor: C.borderStrong }]} />
            <Text style={[styles.railCaption, { color: C.icon }]}>{PIXELS_BAR_CAPTION}</Text>
          </>
        ) : null}
      </ScrollView>
      {trailing !== undefined ? <View style={styles.trailingCluster}>{trailing}</View> : null}
    </View>
  );
});

const styles = StyleSheet.create({
  // One slim row. Horizontal padding matches the LIVE OUTPUT header above it
  // so the chips line up with the "DECK MAIN · LIVE OUTPUT" label.
  // `flexDirection: 'row'` + `alignItems: 'center'` is the docs/63 §3.2
  // addition (the `trailing` cluster sits beside the ScrollView, not below
  // it) — with a single child and no `trailing`, a flex row with one
  // `flex: 1` item lays out identically to the old plain block, so this is
  // not a visible change on its own.
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 2,
  },
  // The chip ScrollView's own flex context (docs/63 §3.2): `flex: 1` lets it
  // claim the row's available width, `minWidth: 0` is the flexbox escape
  // hatch that lets it actually SHRINK below its content width once
  // `trailing` needs room, instead of the row overflowing.
  scrollArea: {
    flex: 1,
    minWidth: 0,
  },
  barContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
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
  // The plan-lock cluster's slot (docs/63 §3.2) — outside the ScrollView, so
  // it can never scroll away. `flexShrink: 0` protects it from the
  // ScrollView's `flex: 1` squeezing it to nothing.
  trailingCluster: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
    marginLeft: Space.sm,
  },
});
