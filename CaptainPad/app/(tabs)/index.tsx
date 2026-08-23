import React, { useState, useRef, useCallback, useEffect } from 'react';
import { View, Text, TouchableOpacity, Modal, Platform, StyleSheet, useWindowDimensions, type LayoutChangeEvent } from 'react-native';
import { CAPTAIN_PAD_MODAL_SUPPORTED_ORIENTATIONS } from '@/utils/modal_orientation';
import { opError, opInfo } from '@/utils/op_dialog';
import { retuneRejectionMessage } from '@/utils/color_autopilot_narration';
import { accentWash, useGlobalStyles } from '@/styles/globalStyles';
import { Radius, Space, Type } from '@/constants/theme';
import { usePalette } from '@/hooks/use-theme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { RigGlobals } from '@/components/RigGlobals';
import { EFFECTS_STRIP_HOST_HEIGHT } from '@/components/global_effect_macros_logic';
import { useLiveTouchCoordinator } from '@/components/live_touch_coordinator';
import { GlobalParams } from '@/components/GlobalParams';
import { ChannelSaveFeedback } from '@/components/channel_save_feedback';
import { CPCControls } from '@/components/CPCControls';
import { DeckTopBar } from '@/components/DeckTopBar';
import { DeckHueRow } from '@/components/deck_hue_row';
import {
  deckSwapCompleteReleasesLock,
  deckSwapWatchdogDelayMs,
} from '@/components/deck_swap_watchdog';
import { EntryLabelEditor } from '@/components/EntryLabelEditor';
import { PixelStrip } from '@/components/ui/PixelStrip';
import { AllModulationsPanel } from '@/components/AllModulationsPanel';
import { useFocusEffect } from 'expo-router';
import {
  getAutopilot, setAutopilot,
  setAutopilotProfile as apiSetAutopilotProfile,
  fetchDeckChannel, setDeckChannelControl,
  activateLayerSetting,
  fetchDeckTransitionConfig, setDeckTransitionConfig,
  fetchDeckColorAutopilot, setDeckColorAutopilot, patchDeckColorAutopilot,
  fetchPlaylists,
  fetchChannelPlaylist,
  setChannelPlaylist,
  setDeckPlaylistSplit,
  fetchDeckPlaylistSlots,
  type DeckTransitionConfig,
  type DeckColorAutopilotConfig,
  type PlaylistAssignment,
} from '@/utils/api';
import { setMidiActiveContext } from '@/hooks/useMidiControl';
import { setChannelColor, setChannelHue } from '@/utils/channelExtrasApi';
import { DeckOverlayStack } from '@/components/DeckOverlayStack';
import type { DeckOverlay, DeckOverlayAutopilot } from '@/utils/deckOverlaysApi';
import { useEngineConnection } from '@/hooks/useEngineConnection';
import type { EngineMessage, BusStatus } from '@/utils/engineEvents';
import { useOperatorTakeover } from '@/hooks/useTimeline';
import { PlanIndicatorPill, PLAN_INDICATOR_CYAN } from '@/components/timeline/PlanIndicatorPill';
import { useEngineLock } from '@/hooks/useEngineLock';
import { PlanLockBanner } from '@/components/PlanLockBanner';
import { PlanLockScrim } from '@/components/PlanLockScrim';
import { ColorAutopilotPanel } from '@/components/deck/ColorAutopilotPanel';
import { PatternAutopilotPanel } from '@/components/deck/pattern_autopilot_panel';
import { SplitPlaylistPanes } from '@/components/deck/split_playlist_panes';
// ── Deck WINDOW WORKSPACE (docs/53) ─────────────────────────────────────
// The three deck columns (+ the new COLORS window) are windows the operator
// can hide and restore from one compact bar. Layout management only: with the
// default layout the columns below render exactly as they always have.
import { useDeckWorkspace, DeckWorkspaceBar } from '@/components/deck/deck_workspace';
import {
  NARROW_PATTERNS_NATIVE_CLIP_STYLE,
  NARROW_PATTERNS_OUTER_MARGIN,
  deckWorkspaceIsWide,
  narrowStackSizing,
  narrowStackTrackStyles,
  type DeckSurfaceId,
  type NarrowStackTrackStyle,
} from '@/components/deck/deck_workspace_layout';
import { DeckWindow } from '@/components/deck/deck_window';
import { ColorsWindow } from '@/components/deck/colors_window';
import {
  PARAMETER_CARD_BOUNDARY_STYLE,
  PARAMETER_HEADER_ACTIONS_STYLE,
  PARAMETER_HEADER_LABEL_STYLE,
  PARAMETER_HEADER_STYLE,
} from '@/components/deck/parameter_header_layout';
import { PixelViewWindow } from '@/components/deck/pixel_view_window';
// NATIVE GESTURE ARMOR (see components/ui/scroll_lock.ts). The deck's two
// vertical scroll hosts are the ones a leaf drag control fights on the iPad —
// the COLORS hue dial and every HorizontalFader in these columns. On native a
// UIScrollView cannot see a JS responder living inside it, so those controls
// take a scroll_lock for the life of the gesture and this host honours it.
// Inert on web (nothing acquires there), so the _211 browser armor stands.
import { LockableScrollView } from '@/components/ui/lockable_scroll_view';
// ── COLORS yield rule (docs/61 §2.1, W3) ────────────────────────────────
// L2 (hide the COLORS window) and L3 (leave the Deck tab) both run the
// operator's navigation through the same §2.1 arbitration `yieldDecision`
// (colors_window_logic.ts, W1) via this pure bridge, so the rule is proven
// once and wired twice rather than re-implemented per call site.
import { runYieldGesture } from '@/components/deck/colors_yield_bridge';
import { rotationKind, type ColorsCard } from '@/components/deck/colors_window_logic';
import { subscribeDeckWindowRequests } from '@/utils/deck_window_requests';

// 8pt hitSlop on every edge → a 28×28 visual button gets a 44×44 interactive
// area (28 + 8 + 8 = 44), matching the mixer's touch-target floor.
const ICON_BTN_HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 } as const;

// Deck channel color accent palette (docs/39 §8.4 — channel `color` metadata,
// no render effect). Same curated high-contrast set the mixer strip uses so
// the deck and mixer read consistently; the "NO COLOR" option clears it
// (color = null). The engine accepts any string or null — this is purely the
// tap-to-pick surface.
const CHANNEL_COLOR_SWATCHES: string[] = [
  '#E53935', // red
  '#FB8C00', // orange
  '#FDD835', // yellow
  '#43A047', // green
  '#00ACC1', // cyan
  '#1E88E5', // blue
  '#8E24AA', // purple
  '#EC407A', // pink
];

// (Deck autopilot next-swap countdown moved to the self-ticking <SwapCountdown>
// in DeckTransitionControls — it owns its own 1 Hz interval so the whole deck
// screen no longer re-renders every second.)

// ── Global Effect Button moved to RigGlobals ────────────────────────────

// docs/54 row 12: the ON state is the shared translucent on-state
// (`accentWash(primary)` + a `borderStrong` selection ring), not a flat
// opaque repaint. A latched macro now reads like every other latched thing
// on the deck — and, because the wash keeps the accent as ink, the label is
// still legible on all five palettes without a hardcoded '#fff'. Height,
// flexBasis and the press handlers are untouched.
const ToggleButton = ({ id, name, initialValue = 0, onChange }: { id: number, name: string, initialValue?: number, onChange: Function }) => {
  const globalStyles = useGlobalStyles();
  const C = usePalette();
  const [isOn, setIsOn] = React.useState(initialValue > 0.5);
  React.useEffect(() => { setIsOn(initialValue > 0.5) }, [initialValue]);
  const on = accentWash(C.primary);
  return (
    <TouchableOpacity
      onPress={() => { const next = !isOn; setIsOn(next); onChange(id, next ? 1.0 : 0.0); }}
      style={[
        globalStyles.macroButton,
        { flexBasis: '30%' },
        isOn ? { backgroundColor: on.backgroundColor, borderColor: C.borderStrong } : {}
      ]}
    >
      <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 12, color: isOn ? on.color : C.text, textAlign: 'center' }}>
        {name.replace(/toggle|trigger/i, '').substring(0, 10).toUpperCase()}
      </Text>
    </TouchableOpacity>
  );
};

const MomentaryButton = ({ id, name, onChange }: { id: number, name: string, onChange: Function }) => {
  const globalStyles = useGlobalStyles();
  const C = usePalette();
  const [isPressed, setIsPressed] = React.useState(false);
  const pressed = accentWash(C.error);
  return (
    <TouchableOpacity
      onPressIn={() => { setIsPressed(true); onChange(id, 1.0); }}
      onPressOut={() => { setIsPressed(false); onChange(id, 0.0); }}
      activeOpacity={1}
      style={[
        globalStyles.macroButton,
        { flexBasis: '30%' },
        isPressed ? { backgroundColor: pressed.backgroundColor, borderColor: pressed.borderColor } : {}
      ]}
    >
      <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 12, color: isPressed ? pressed.color : C.text, textAlign: 'center' }}>
        {name.replace(/toggle|trigger/i, '').substring(0, 10).toUpperCase()}
      </Text>
    </TouchableOpacity>
  );
};

// Portrait/narrow deck layout: the PATTERNS column is PINNED (fixed height, does
// NOT scroll), and the PARAMETERS + AUTOPILOT columns scroll together BELOW it
// (operator request 2026-07-11). This wrapper IS that scroll region: a Fragment
// in the wide 3-column row (so col2/col3 stay flex siblings of the pinned col1),
// and a ScrollView in the narrow stack. Module-scoped so its component identity
// is stable — defining it inline in render would remount col2/col3 (losing their
// scroll position + state) on every parent render.
function ColumnsScrollRest({ isWide, collapsed, narrowStyle, children }: {
  isWide: boolean;
  collapsed?: boolean;
  narrowStyle: NarrowStackTrackStyle;
  children: React.ReactNode;
}) {
  // NOTE the region is still `flex:1` when it is not collapsed — it takes the
  // stack MINUS whatever `narrowStackSizing` gave PATTERNS. The arbitration
  // lives entirely in that one pure function (report _273); this component
  // does not compute a share of its own.
  // WIDE: a Fragment, so PARAMETERS and AUTOPILOT stay flex SIBLINGS of the
  // pinned PATTERNS column and render SIDE BY SIDE, each with its own scroll
  // (SectionHost). 2026-07-27: a stacked-in-one-scroll variant was tried and
  // REVERSED by the operator on the iPad — he wants the two columns beside
  // each other; only the PATTERNS column narrowed (flex 4→2).
  if (isWide) return <>{children}</>;
  return (
    // COLLAPSED (docs/55 §2.4): every window this region hosts is hidden, so it
    // yields its space to the PATTERNS fill instead of holding open a dead
    // scroll region. It STAYS MOUNTED with all its children — the no-remount
    // contract (docs/53 §3.4) is what preserves scroll offsets, in-progress
    // parameter edits and the live WS reconciles, and it applies just as much
    // to a window hidden by the performance overlay as to one the operator
    // minimized by hand.
    <LockableScrollView
      // The measured region basis comes from the SAME split as PATTERNS.
      // Longhands only: co-flattening a positive `flex` shorthand with an
      // explicit basis is a native Yoga trap even though web CSS accepts it.
      style={narrowStyle}
      contentContainerStyle={{ paddingBottom: collapsed ? 0 : 16 }}
      showsVerticalScrollIndicator={false}
      scrollEnabled={!collapsed}
    >
      {children}
    </LockableScrollView>
  );
}

// ── Connection Status Banner ────────────────────────────────────────────
const OfflineBanner = ({ error }: { error: string }) => {
  const C = usePalette();
  return (
    <View style={{
      // docs/54 row 18: the hand-rolled 'rgba(186, 26, 26, 0.12)' wash is
      // retired — `errorContainer` / `errorContainerBorder` are the tokens
      // that exist for exactly this box, and they are per-theme (the light
      // palette wants a lighter wash than the dark ones).
      backgroundColor: C.errorContainer,
      borderColor: C.errorContainerBorder,
      borderWidth: 1,
      borderRadius: Radius.card,
      padding: Space.lg,
      marginBottom: Space.lg,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12
    }}>
      <IconSymbol name="wifi.slash" size={24} color={C.error} />
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: C.error, fontSize: 14 }}>
          ENGINE OFFLINE
        </Text>
        <Text style={{ fontFamily: 'Inter_400Regular', color: C.error, fontSize: 12, marginTop: 4 }}>
          {error || 'Cannot reach MarsinEngine. Check Config tab for IP settings.'}
        </Text>
      </View>
    </View>
  );
};

export default function ControlDeckScreen() {
  const globalStyles = useGlobalStyles();
  const C = usePalette();
  const { waitForHandoff } = useLiveTouchCoordinator();
  // ── 3-COLUMN layout responsiveness (operator request June 2026) ──────────
  // The deck splits into three side-by-side columns on wide surfaces (iPad
  // landscape / web): PATTERNS | PARAMETERS | AUTOPILOT & SETTINGS. On narrow
  // widths (portrait phone, a too-narrow window) three columns would crush the
  // content, so we fall back to the previous vertical stack. We use the same
  // `useWindowDimensions` + `width < height` portrait idiom the mixer tab uses
  // (mixer.tsx), plus an absolute floor: below ~900px even a landscape phone is
  // too narrow to seat three readable columns, so it stacks too.
  const { width: winWidth, height: winHeight } = useWindowDimensions();
  // CaptainPad native is a landscape-only instrument. Keep its wide workspace
  // mounted even during iOS's brief rotation handoff so Fabric can never enter
  // the retired portrait stack. Web remains responsive for desktop tooling.
  const isWide = deckWorkspaceIsWide(Platform.OS, winWidth, winHeight);
  // NARROW STACK ARBITRATION (report _273): the columns host's MEASURED height.
  // The narrow split used to be computed from the device window alone, which is
  // how a 400 pt PATTERNS pin ended up inside a 309 pt stack (overflowing the
  // bottom bar, squeezing the reopened window to zero height). The host is a
  // `flex:1` sibling of the fixed chrome, so its height depends on the bars
  // above it and NOT on its own children — measuring it cannot feed back into
  // itself. Guarded on `!==` so a re-layout at the same height is a no-op.
  const [columnsHostHeight, setColumnsHostHeight] = useState<number | null>(null);
  const handleColumnsHostLayout = useCallback((e: LayoutChangeEvent) => {
    const h = e.nativeEvent.layout.height;
    setColumnsHostHeight((prev) => (prev !== null && Math.abs(prev - h) < 0.5 ? prev : h));
  }, []);
  // PATTERNS-PIN (operator request 2026-07-11): the columns host is now ALWAYS a
  // plain View. Wide = the 3-column row (unchanged). Narrow = a flex COLUMN whose
  // first child (PATTERNS) is pinned at a fixed height and whose remaining columns
  // (PARAMETERS + AUTOPILOT) scroll together inside <ColumnsScrollRest> below — so
  // the pattern list stays put while the rest of the deck scrolls under it.
  // Section host for the PARAMETERS + SETTINGS columns: ScrollView only when
  // the column has a bounded height (wide row — each column scrolls on its
  // own); a plain View in the stacked page-scroll (an inner ScrollView there
  // collapses to zero height — the party 2026-07-11 'third column missing'
  // bug). There is never a same-axis ScrollView nested inside another.
  // LockableScrollView, not ScrollView: this host is what the COLORS hue dial
  // and the column's faders freeze while a drag is in flight (native only —
  // it is a plain ScrollView in every other respect, `scrollEnabled` included).
  const SectionHost: React.ComponentType<any> = isWide ? LockableScrollView : View;
  const sectionHostProps = isWide
    ? { contentContainerStyle: { padding: 16, paddingBottom: 80 }, showsVerticalScrollIndicator: false }
    : { style: { padding: 16, paddingBottom: 24 } };
  // ── WINDOW WORKSPACE (docs/53 §3) ───────────────────────────────────────
  // Which of the four windows are open, persisted (closed-set ONLY) under
  // `deck_workspace_layout_v1`. A closed window keeps rendering — hidden with
  // display:'none', never unmounted — so its scroll offset, local edit state
  // and live WS reconciles survive a minimize/restore round trip. PATTERNS is
  // protected: it has no hide affordance and the reducer refuses to close it.
  const workspace = useDeckWorkspace();
  // Stable member references, extracted so a hook that depends on JUST the
  // function (below) reads as a plain identifier rather than an `object.method`
  // call — react-hooks/exhaustive-deps otherwise asks for the whole `workspace`
  // object (its `this`-binding heuristic for member calls), which would defeat
  // the point: `workspace` itself is a fresh object literal every render, while
  // `openWindow`/`closeWindow` are individually stable (`useDeckWorkspace`'s own
  // `useCallback([dispatch])`).
  const { openWindow: workspaceOpenWindow, closeWindow: workspaceCloseWindow } = workspace;
  // ── WINDOW TRACK SURFACE (docs/54 §3, restyle slice R2) ────────────────
  // Every OPEN window sits on the SAME `panel` recipe — one object: fill +
  // hairline + inset top highlight + ambient shadow. This is the restyle's
  // single biggest visual change: before it, PATTERNS was a pane while
  // PARAMETERS / AUTOPILOT / COLORS were bare transparent scroll columns
  // with floating cards, so the deck read as "one pane and some loose
  // stacks" instead of a set of instruments.
  //
  // Geometry, not paint: the tracks carry a symmetric 4pt horizontal margin
  // and the columns host carries the matching 4pt padding, so the gutter
  // between two windows is `Space.sm` (8) and the outer edges are 8 too.
  // Column WEIGHTS are untouched (they still come from `workspace.flexFor`).
  //
  // Why 4 and not 6: window chrome costs horizontal room, and the ALL-FOUR-
  // OPEN layout at 1194pt landscape is the binding case — at a 12pt gutter
  // the AUTOPILOT header clipped its PLAY/PAUSE control. Density is a
  // feature here (docs/54 §6 decision 5: the restyle preserves current
  // compactness), so the gutter yields, not the control.
  const windowTrack = isWide
    ? [globalStyles.panel, { marginVertical: 8, marginHorizontal: 4 }]
    : [
      globalStyles.panel,
      { marginVertical: NARROW_PATTERNS_OUTER_MARGIN / 2, marginHorizontal: 4 },
    ];
  const [deckChannel, setDeckChannel] = useState<any | null>(null);
  const [isConnected, setIsConnected] = useState<boolean | null>(null);
  const [connectionError, setConnectionError] = useState<string>('');
  // D6: floating ALL MODULATIONS overlay state. Placed at the screen
  // level so the panel can layer above every card on the deck without
  // borrowing the deck channel card's clipping context.
  const [showAllMods, setShowAllMods] = useState(false);

  // Deck channel color picker visibility (docs/39 §8.4). The swatch button
  // in the deck card header opens this modal; selecting a swatch (or NO
  // COLOR) routes through handleDeckColor.
  const [showColorPicker, setShowColorPicker] = useState(false);

  // Post-channel-split (May 2026): the deck channel comes from its
  // own /deck/channel endpoint and the WS `deck` event. The mixer's
  // `channels[]` array NEVER contains the deck channel anymore — that
  // was the source of countless "deck shows a mixer overlay's
  // exports" bugs. See docs/16_captain_pad.md and
  // marsin_engine/lib/pattern_mixer.js (channel-split note).
  const deckChannelId: string | null = deckChannel?.id ?? null;

  // ── Operator takeover (requests #3/#5) ─────────────────────────────────
  // When a plan is driving the rig and the operator touches a manual control
  // on this surface, they take it over: notifyInteraction() fires the takeover
  // ONCE then keeps the lease alive (throttled) while they keep working. The
  // PlanIndicatorPill (globals row, top-right) reflects plan/lease/countdown;
  // the inline warning strip surfaces the live-plan takeover non-intrusively
  // (no modal — never block a live performance).
  const { leaseHeld, notifyInteraction } =
    useOperatorTakeover();

  // ── Soft PLAN lock (CONTRACT: globalsState.controlLock ∈ {null,'portwatch',
  // 'plan'}) ──────────────────────────────────────────────────────────────
  // 'portwatch' is the FULL hard lockout (EngineLockoutOverlay, mounted in the
  // tab layout). 'plan' is the SOFTER lock: a yellow PlanLockBanner + the deck
  // pattern-selection controls disabled, while navigation/viewing stay live.
  // Taking over (the existing operator-takeover lease) re-enables the controls,
  // so the gate is `plan lock engaged AND no operator lease held`.
  const { planLocked } = useEngineLock();
  const planGate = planLocked && !leaseHeld;

  // Autopilot state (cycles through the active playlist on a timer)
  const [isPlaylistActive, setPlaylistActive] = useState<boolean>(false);
  const [playlistDelayStr, setPlaylistDelayStr] = useState<string>('30');
  const [isShuffle, setIsShuffle] = useState<boolean>(false);
  // PATTERN-GROUP LOCALITY (feat/optimize_channels): the DECK autopilot can
  // dwell within a window of adjacent playlist entries before grabbing a fresh
  // one. These three knobs live on the deck base channel's playlist.autopilot
  // (NOT the autopilot daemon's /autopilot state), so they hydrate from
  // GET /deck/playlist (see seed) and write through setAutopilot's group arg
  // (POST /deck/playlist/autopilot). Defaults mirror the engine's
  // AUTO_GROUP_SIZE_DEFAULT (3) / AUTO_GROUP_DWELL_DEFAULT (6).
  const [groupMode, setGroupMode] = useState<boolean>(false);
  const [groupSize, setGroupSize] = useState<number>(3);
  const [groupDwell, setGroupDwell] = useState<number>(6);
  // AUTOPILOT PROFILE (feat/autopilot_deck_improvement): the deck autopilot is a
  // set of named profiles. `random` (default — today's shuffle/sequential
  // cycling, byte-identical) and `audio_reactive` (audio-driven). The profile
  // lives on the deck base channel's playlist.autopilot and rides the
  // `autopilot` WS broadcast (`profile` + the selectable-list `profiles`). Seed
  // from GET /autopilot; reconcile in the `autopilot` WS branch; write through
  // setAutopilotProfile (POST /deck/playlist/autopilot {profile}). Defaults are
  // the ONE documented schema default (`'random'`) and a single-item list so the
  // dropdown renders even before the first broadcast.
  const [autopilotProfile, setAutopilotProfile] = useState<string>('random');
  const [autopilotProfiles, setAutopilotProfiles] = useState<string[]>(['random']);

  // DECK SPLIT PLAYLISTS (feat/autopilot_deck_improvement): the PATTERNS column
  // is two stacked, resizable playlist panes — `primary` (DECK A, today's main
  // list) and an OPTIONAL `secondary` (DECK B). The deck still plays one
  // pattern; the panes are stable name bindings the operator browses/drives.
  // These fields ride the `deck` WS message's `playlistSlots` (no new WS type),
  // seeded from GET /deck/playlist/slots. `splitRatio` is the divider's pane-1
  // share (0.15..0.85; the ONE documented default is 0.5). `secondaryBound`
  // drives whether pane 2 is shown expanded. PlaylistPanel (role="deckSlot")
  // reconciles each pane's own playlist off the same message, so this state only
  // needs the binding presence + ratio, not the full entry lists.
  const [deckSplitRatio, setDeckSplitRatio] = useState<number>(0.5);
  const [deckSecondaryBound, setDeckSecondaryBound] = useState<boolean>(false);

  // ── The NARROW stack split (report _273) ────────────────────────────────
  // ONE call, ONE authority. `narrowStackSizing` is pure and unit-tested; this
  // screen only measures the host and renders what it is told. `mode:'fill'`
  // IS the old `patternsFillsNarrow` predicate — same condition, now carried
  // by the same value that carries the split, so the PATTERNS track and the
  // ColumnsScrollRest can never disagree about which composition they are in.
  const narrowStack = narrowStackSizing({
    openCount: workspace.open.length,
    windowHeight: winHeight,
    hostHeight: columnsHostHeight,
    secondaryBound: deckSecondaryBound,
  });
  const narrowTracks = narrowStackTrackStyles(narrowStack);

  // Deck transition config (soft swap between patterns via server-side
  // double-buffer — see DECK TRANSITIONS in DeckTransitionControls.tsx
  // and triggerDeckPatternSwap in marsin_engine/lib/pattern_mixer.js).
  const [deckTxConfig, setDeckTxConfig] = useState<DeckTransitionConfig>({
    enabled: false,
    mode: 'trans_crossfade',
    durationMs: 1000,
    shuffle: false,
  });

  // Deck COLOR autopilot (operator request: "in the autopilot, select a set of
  // palettes that switch on their own timer"). Independent of the pattern
  // autopilot — this one cycles a chosen SET of color palettes on its own
  // timer. Seeded on focus from GET /deck/color-autopilot, then kept LIVE by the
  // `colorAutopilot` /ws/control broadcast (see onControl) so PLAN-driven cues
  // and per-tick palette advances show up on the deck in real time; each control
  // change posts optimistically (same shape as handleDeckTxChange).
  const [colorAutopilot, setColorAutopilot] = useState<DeckColorAutopilotConfig>({
    active: false,
    palettes: [],
    delay_s: 30,
    shuffle: false,
  });

  // ── COLORS yield rule (docs/61 §2.1, W3) ──────────────────────────────
  // L2 (hide the COLORS window) and L3 (leave the Deck tab) both need
  // GESTURE-TIME truth — the visible COLORS card, the daemon's kind off the
  // BROADCAST, and the disabled gate — read from a `useFocusEffect` cleanup
  // closure that was captured on an earlier render. A `useState` alone would
  // give that closure a STALE snapshot; these refs are the plain-object
  // mirrors the cleanup reads instead. `colorsCardRef` is written in the same
  // setter as `colorsCard` (`handleColorsCardChange`, below); the autopilot +
  // disabled mirrors are written every render (cheap, synchronous, and never
  // wrong by more than the current render — no effect indirection needed).
  const [colorsCard, setColorsCard] = useState<ColorsCard>('two');
  // Not read by this screen's own JSX today — only `colorsCardRef` is, by the
  // yield gestures below. Kept as real state (not just a ref) because it is
  // the value contract W3 was handed and the natural hook for a future
  // on-screen "which COLORS card is showing" affordance; `void` is the
  // codebase's existing idiom for state kept live but not yet rendered
  // (see `mixer.tsx`'s `inlinePlaylistVersion`).
  void colorsCard;
  const colorsCardRef = useRef<ColorsCard>('two');
  const handleColorsCardChange = useCallback((card: ColorsCard) => {
    colorsCardRef.current = card;
    setColorsCard(card);
  }, []);
  const colorAutopilotRef = useRef<DeckColorAutopilotConfig>(colorAutopilot);
  colorAutopilotRef.current = colorAutopilot;
  // Mirrors the exact `disabled` gate <ColorsWindow> renders with (below) —
  // one predicate, read fresh by the yield gestures the same way the window
  // itself is gated.
  const colorsDisabledRef = useRef<boolean>(false);
  colorsDisabledRef.current = isConnected === false || planGate;
  // L3's cleanup fires on blur — after this component has stopped
  // re-rendering — so it needs its own fresh mirror of whether the COLORS
  // window was open, rather than trusting `workspace.isOpen('colors')` from
  // whatever render last ran the effect body.
  const colorsWindowOpenRef = useRef<boolean>(false);
  colorsWindowOpenRef.current = workspace.isOpen('colors');

  // Next-swap countdowns (operator request 2026-07-02: "add 2 countdown timers
  // for the auto pilot pattern and auto pilot colors in the deck view... this
  // is a deck feature, but the plan needs to be using it too"). Both hold the
  // wall-clock ms of the next scheduled swap (null when the respective
  // autopilot is off). The engine stamps these in autopilot.js /
  // color_autopilot.js `_scheduleNext` and re-broadcasts on every cycle, so the
  // same field works identically whether the operator or a plan cue is driving
  // the cadence — no separate plan route. The absolute target ms is handed to
  // <SwapCountdown>, which owns the 1 Hz re-render itself (so the deck screen
  // doesn't re-render every second).
  const [patternNextSwapAtMs, setPatternNextSwapAtMs] = useState<number | null>(null);
  const [colorNextSwapAtMs, setColorNextSwapAtMs] = useState<number | null>(null);

  // Live swap state — the engine broadcasts `deckSwapStarted` / `…Complete`
  // around every soft swap. We use this to grey out the playlist (so taps
  // during the fade are ignored client-side — server also returns 409 if
  // a tap leaks through). Cleared on tab focus changes too: switching
  // away to the mixer tells the engine to finalize the swap, so when we
  // come back this flag is stale by definition.
  const [deckSwapInFlight, setDeckSwapInFlight] = useState(false);

  // Watchdog for a LOST `deckSwapComplete` (belt-and-braces vs the engine-side
  // cancelled-swap broadcast). While `deckSwapInFlight` is true the playlist
  // renders at 0.55 and every row is disabled — so if the completion event
  // never arrives (WS blip between started/complete; deckSwap events are not
  // replayed on reconnect) the list stays dim with all taps swallowed until a
  // tab switch remounts it. Armed on `deckSwapStarted` for the broadcast's own
  // durationMs + 2 s of slack, disarmed by the matching complete.
  const swapWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // `transitionId` of the swap the lock is currently held for, captured from
  // `deckSwapStarted`. A `deckSwapComplete` only releases the lock when its id
  // matches (or when either side has no id — see deckSwapCompleteReleasesLock),
  // so a stale complete for a superseded swap can never unlock a live one.
  const swapTransitionIdRef = useRef<string | null>(null);

  // Last engine-picked transition mode. When shuffle is enabled the
  // engine rolls a new style per swap (pickRandomTransitionMode in
  // api_server.js) and broadcasts it on `deckSwapStarted`. Without
  // this state the picker dropdown was stuck showing the operator's
  // pre-shuffle pick forever — operator report 2026-05-29: "the
  // dropdown doesn't change per transition." With this we surface the
  // actually-used mode so the operator can see what just played.
  const [lastSwapMode, setLastSwapMode] = useState<string | null>(null);

  // Parent-owned playlist library (May 2026 refactor — see mixer.tsx
  // for the full rationale). Fetched once on mount, then refreshed
  // from the engine's `playlistLibrary` WS event. Passed down to the
  // single PlaylistPanel below so it doesn't have to do its own
  // /playlists GET — which under load could race and return an empty
  // list, causing the "no playlists yet" symptom on the 3rd channel
  // (in the mixer; same fetch path here for consistency).
  const [playlistLibrary, setPlaylistLibrary] = useState<string[]>([]);

  // ── Deck dynamic VIEW OVERRIDES (engine #deck-overlays) ────────────────
  // View-scoped overlay decks layered OVER the main deck. Both the list and
  // the SHARED auto-cycle cadence ride the existing `deck` WS message (folded
  // in by the engine — no new WS type), so we read them in the `deck` branch
  // of onControl below and render the DeckOverlayStack beneath the deck
  // surface. The list IS the source of truth; we keep it in state only to
  // drive the cards (PlaylistPanel reconciles its own playlist off the same
  // `deck` message via role="deckOverlay").
  const [deckOverlays, setDeckOverlaysState] = useState<DeckOverlay[]>([]);
  const [overlayAutopilot, setOverlayAutopilot] = useState<DeckOverlayAutopilot>({
    active: false,
    delay_s: 30,
    shuffle: false,
  });

  // Pre-May-2026 the deck tab owned its own WS. The topic split
  // moved that into singleton buses (utils/engineEvents +
  // utils/engineVizEvents). This tab now just subscribes — no per-tab
  // socket, no double-parse of the mixer / vis firehose. The boot +
  // subscription lifecycle (resolve base, probe, nudge buses, AppState
  // re-seed, subscribe/teardown) is shared with the mixer via
  // useEngineConnection; the per-bus message handlers below are the
  // deck-specific part.
  const visDataRef = useRef<{ [key: string]: string | null }>({});
  const [, setVisVersion] = useState(0);
  const lastVisUpdateRef = useRef(0);

  useFocusEffect(
    useCallback(() => {
      void waitForHandoff('deck').then((handoffResult) => {
        if (handoffResult !== null) return;
        return activateLayerSetting('deck', { reason: 'captainpad_deck_tab' }).then((result) => {
          if (!result.ok) {
            opError('Deck activation failed', result.error || 'The engine rejected the Deck layer setting.');
          }
        });
      }).catch((error) => {
        opError('Deck handoff failed', error instanceof Error ? error.message : String(error));
      });
      // Switch the MIDI controller to its Deck mapping context.
      setMidiActiveContext('deck');
      // Tab unmount cleanup: any in-flight swap is finalized by the
      // engine when we navigate away (the /layers/activate POST does that
      // server-side), so clear the local flag so the next mount starts
      // with the lock OFF instead of a stale in-flight assumption.
      return () => {
        if (swapWatchdogRef.current) {
          clearTimeout(swapWatchdogRef.current);
          swapWatchdogRef.current = null;
        }
        swapTransitionIdRef.current = null;
        setDeckSwapInFlight(false);
        // ── L3 — leaving the Deck tab (docs/61 §2.1/§3) ────────────────────
        // Fires ONLY here, in the focus effect's CLEANUP (blur/unmount) —
        // never on mount, never on focus, never from a broadcast or a WS
        // reconnect (see the `onControl` guard below; `no_raw_alerts.test.ts`
        // is the idiom this file's own source-scan test follows to prove it).
        // Deliberately reads every input off the refs mirrored above rather
        // than a state variable: this closure was captured whenever
        // `waitForHandoff` last changed (the dep array is untouched, on
        // purpose — widening it would re-run the effect and re-arm this
        // cleanup on every render), so only `.current` reads are fresh at the
        // moment the operator actually blurs the tab.
        runYieldGesture({
          gesture: 'tab',
          card: colorsCardRef.current,
          colorsWindowOpen: colorsWindowOpenRef.current,
          kind: rotationKind(
            colorAutopilotRef.current.active,
            colorAutopilotRef.current.palettes,
            colorAutopilotRef.current.mode,
          ),
          disabled: colorsDisabledRef.current,
          post: (patch, failNote) => handleColorAutopilotChange(patch, failNote),
          say: (message) => opInfo('COLORS', message),
        });
      };
      // Deliberately NOT depending on `handleColorAutopilotChange` (or any of
      // the refs the cleanup reads): widening this array would re-run the
      // effect and re-arm the cleanup on every render, which is exactly what
      // W3's brief forbids — the cleanup closes over the current render's
      // `handleColorAutopilotChange` (stable enough via its own
      // `notifyInteraction`-only deps) and reads everything else through the
      // refs mirrored above, which are always fresh at blur time regardless
      // of when this effect itself last re-ran.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [waitForHandoff])
  );

  // ── App-wide COLOR chip's "open the COLORS window" request (docs/61 §4.4,
  // W4) ─────────────────────────────────────────────────────────────────
  // A UI hint from the shared header's chip (Sonnet D), fired through the
  // zero-import `deck_window_requests` pub/sub rather than a prop or a store,
  // because the chip renders on every tab and this screen owns the workspace
  // it wants restored. Purely additive — `workspace.openWindow` is the exact
  // handler already wired to the bar's own OPEN chips above — and it must
  // never post anything; it only ever opens a window, never touches the
  // colour-autopilot daemon.
  useEffect(() => subscribeDeckWindowRequests((id) => workspaceOpenWindow(id)), [workspaceOpenWindow]);

  // Control plane: deck channel state, autopilot, deck-transition
  // config, soft-swap lifecycle markers.
  const onControl = useCallback((msg: EngineMessage) => {
    if (msg.type === 'playlistLibrary' && Array.isArray(msg.names)) {
      setPlaylistLibrary(msg.names as string[]);
    }
    if (msg.type === 'deck') {
      setDeckChannel((msg.channel as any) || null);
      // Pattern-group locality knobs (GROUP toggle / SIZE / DWELL) ride ONLY
      // inside the deck message's channel.playlist.autopilot — they have no
      // dedicated WS channel, so without this they stayed at their seed value
      // and drifted from a cue/engine-driven change (the deck showed stale
      // group state). Per-field defensive merge (mirrors the deckTransition
      // reconcile) so an older playlist that omits them can't clobber the
      // operator's pick; these are pill taps, not drags, so no snap-back risk.
      const plAp = (msg.channel as { playlist?: { autopilot?: {
        groupMode?: unknown; groupSize?: unknown; groupDwell?: unknown;
      } } } | null | undefined)?.playlist?.autopilot;
      if (plAp && typeof plAp === 'object') {
        if (typeof plAp.groupMode === 'boolean') setGroupMode(plAp.groupMode);
        if (typeof plAp.groupSize === 'number') setGroupSize(plAp.groupSize);
        if (typeof plAp.groupDwell === 'number') setGroupDwell(plAp.groupDwell);
      }
      // Deck dynamic VIEW OVERRIDES ride the same `deck` message: the
      // overlay stack + the SHARED auto-cycle cadence. Reconcile both off
      // the broadcast (the engine is the source of truth — every add /
      // patch / reorder / autopilot change re-broadcasts).
      const ovs = (msg as { overlays?: unknown }).overlays;
      setDeckOverlaysState(Array.isArray(ovs) ? (ovs as DeckOverlay[]) : []);
      const ap = (msg as { overlayAutopilot?: any }).overlayAutopilot;
      if (ap && typeof ap === 'object') {
        setOverlayAutopilot({
          active: !!ap.active,
          delay_s: typeof ap.delay_s === 'number' ? ap.delay_s : 30,
          shuffle: !!ap.shuffle,
        });
      }
      // DECK SPLIT PLAYLISTS: the two panes' bindings + divider ratio ride the
      // same `deck` message's `playlistSlots` map (the engine folds it in — no
      // new WS type). We only track secondary presence + the ratio here; each
      // pane's PlaylistPanel (role="deckSlot") reconciles its own list off the
      // same map. Defensive: only adopt a well-typed ratio so a malformed field
      // can't jump the divider.
      const slots = (msg as { playlistSlots?: { secondary?: unknown; splitRatio?: unknown } }).playlistSlots;
      if (slots && typeof slots === 'object') {
        setDeckSecondaryBound(!!slots.secondary);
        if (typeof slots.splitRatio === 'number' && Number.isFinite(slots.splitRatio)) {
          setDeckSplitRatio(slots.splitRatio);
        }
      }
    } else if (msg.type === 'autopilot') {
      if (typeof msg.active === 'boolean') setPlaylistActive(msg.active);
      if (typeof msg.delay_s === 'string' && (msg.delay_s as string).length) {
        setPlaylistDelayStr(msg.delay_s as string);
      }
      if (typeof msg.shuffle === 'boolean') setIsShuffle(msg.shuffle);
      // AUTOPILOT PROFILE: the `autopilot` broadcast carries the active `profile`
      // (normalized string) + the selectable `profiles` list. Reconcile both so
      // the dropdown reflects an operator POST, a per-scene restore, OR a
      // plan-cue-driven profile change live. Defensive: only adopt well-typed
      // values so a malformed field can't blow away a good one (mirrors the
      // group-locality reconcile above).
      const apProfile = (msg as { profile?: unknown }).profile;
      if (typeof apProfile === 'string' && apProfile.length) setAutopilotProfile(apProfile);
      const apProfiles = (msg as { profiles?: unknown }).profiles;
      if (Array.isArray(apProfiles) && apProfiles.every((p) => typeof p === 'string') && apProfiles.length) {
        setAutopilotProfiles(apProfiles as string[]);
      }
      // Next-pattern-swap wall-clock ms (null when inactive) — the engine
      // re-broadcasts it on every cycle, so the deck countdown stays accurate
      // whether the operator OR a plan cue is driving the cadence.
      const nextSwap = (msg as { nextSwapAtMs?: unknown }).nextSwapAtMs;
      setPatternNextSwapAtMs(typeof nextSwap === 'number' ? nextSwap : null);
    } else if (msg.type === 'deckTransitionConfig') {
      setDeckTxConfig((prev) => ({
        enabled: typeof msg.enabled === 'boolean' ? msg.enabled : prev.enabled,
        mode: typeof msg.mode === 'string' ? msg.mode : prev.mode,
        durationMs: typeof msg.durationMs === 'number' ? msg.durationMs : prev.durationMs,
        shuffle: typeof msg.shuffle === 'boolean' ? msg.shuffle : prev.shuffle,
      }));
    } else if (msg.type === 'colorAutopilot') {
      // LIVE color-autopilot sync (feat/timeline_support). The engine
      // broadcasts `colorAutopilot` on /ws/control (broadcastColorAutopilot in
      // api_server.js; routed to CONTROL in ws_topic_routing.js) on EVERY
      // change — an operator POST, a per-tick palette advance, AND a
      // PLAN-driven cue (timeline_service._applyColorAutopilot). Reconciling it
      // here is what makes the deck's COLOR AUTOPILOT panel show the FULL
      // plan-driven config live (palettes + shuffle + delay + transition), not
      // a stale focus fetch — the operator sees exactly what they'd see if they
      // had set it by hand. Shape: {active, palettes, delay_s, shuffle,
      // transitionMs}. We merge per-field (same defensive posture as the
      // deckTransitionConfig branch) so a malformed field can't blow away a
      // good one; palettes is replaced wholesale (it IS the selection).
      //
      // MODE-SCOPED since docs/59: the payload carries exactly ONE mode's
      // fields, so a FOLLOW NOTE frame has no `palettes` at all. Keeping the
      // previous ones through a mode change would leave the window able to
      // render a rotation the daemon is not running — empty is the truth
      // there, and it is set explicitly rather than by omission.
      setColorAutopilot((prev) => {
        const mode = (msg.mode === 'followNote' || msg.mode === 'palettes') ? msg.mode : prev.mode;
        return {
          active: typeof msg.active === 'boolean' ? msg.active : prev.active,
          mode,
          palettes: Array.isArray(msg.palettes)
            ? (msg.palettes as string[])
            : (mode === 'followNote' ? [] : prev.palettes),
          delay_s: typeof msg.delay_s === 'number' ? msg.delay_s : prev.delay_s,
          shuffle: typeof msg.shuffle === 'boolean' ? msg.shuffle : prev.shuffle,
          transitionMs: typeof msg.transitionMs === 'number' ? msg.transitionMs : prev.transitionMs,
          // The follow-note block rides along in BOTH modes (inert in palettes
          // mode) so a mode toggle restores the operator's cycle tuning.
          followNote: (msg.followNote && typeof msg.followNote === 'object')
            ? (msg.followNote as DeckColorAutopilotConfig['followNote'])
            : prev.followNote,
          // Runtime facts — present only while following, and cleared when not,
          // so the card can never show a note letter for a parked daemon.
          currentScheme: mode === 'followNote' ? (msg.currentScheme as string | null ?? null) : undefined,
          notePc: mode === 'followNote' ? (msg.notePc as number | null ?? null) : undefined,
          noteHue: mode === 'followNote' ? (msg.noteHue as number | null ?? null) : undefined,
          nextMethodAtMs: mode === 'followNote' ? (msg.nextMethodAtMs as number | null ?? null) : undefined,
        };
      });
      // Next-palette-swap wall-clock ms (null when inactive) — mirrors the
      // pattern-autopilot countdown; re-broadcast on every color cycle, so it
      // ticks accurately under operator OR plan-cue drive.
      const nextColorSwap = (msg as { nextSwapAtMs?: unknown }).nextSwapAtMs;
      setColorNextSwapAtMs(typeof nextColorSwap === 'number' ? nextColorSwap : null);
    } else if (msg.type === 'deckSwapStarted') {
      setDeckSwapInFlight(true);
      const startedId = (msg as unknown as { transitionId?: unknown }).transitionId;
      swapTransitionIdRef.current = typeof startedId === 'string' && startedId
        ? startedId
        : null;
      if (swapWatchdogRef.current) clearTimeout(swapWatchdogRef.current);
      swapWatchdogRef.current = setTimeout(() => {
        swapWatchdogRef.current = null;
        swapTransitionIdRef.current = null;
        setDeckSwapInFlight(false);
      }, deckSwapWatchdogDelayMs((msg as unknown as { durationMs?: unknown }).durationMs));
      const tm = (msg as unknown as { transitionMode?: string }).transitionMode;
      if (typeof tm === 'string') setLastSwapMode(tm);
    } else if (msg.type === 'deckSwapComplete') {
      // Only the swap we are actually locked for may release the lock; a
      // complete for a superseded swap is ignored (watchdog stays armed).
      const completeId = (msg as unknown as { transitionId?: unknown }).transitionId;
      if (deckSwapCompleteReleasesLock(swapTransitionIdRef.current, completeId)) {
        if (swapWatchdogRef.current) {
          clearTimeout(swapWatchdogRef.current);
          swapWatchdogRef.current = null;
        }
        swapTransitionIdRef.current = null;
        setDeckSwapInFlight(false);
      }
      const tm = (msg as unknown as { transitionMode?: string }).transitionMode;
      if (typeof tm === 'string') setLastSwapMode(tm);
    }
  }, []);

  const onStatus = useCallback((s: BusStatus) => {
    setIsConnected(!!s.connected);
    setConnectionError(s.connected ? '' : (s.lastError || ''));
  }, []);

  // ── docs/63 §2.6 — gate the vis-driven re-render on the OUTPUT bar ───────
  // `onViz` below is a zero-dependency `useCallback`; its STABLE identity is
  // what keeps the engine-bus subscription from tearing down and
  // resubscribing on every render. Reading `workspace.isBarShown('outputBar')`
  // directly inside it would force adding a dependency, which would defeat
  // that — so instead the shown-ness is mirrored into a ref by a plain
  // effect, and `onViz` reads the REF. `visDataRef.current` is still written
  // on every message regardless of this gate (below) — only the React state
  // bump (`setVisVersion`) is skipped, so the strip paints the latest frame
  // the instant the bar comes back, with no missed data.
  const outputBarShown = workspace.isBarShown('outputBar');
  const outputBarShownRef = useRef(outputBarShown);
  useEffect(() => {
    outputBarShownRef.current = outputBarShown;
  }, [outputBarShown]);

  // Viz plane: master strip lives on the deck tab too.
  const onViz = useCallback((msg: EngineMessage) => {
    if (msg.type === 'vis') {
      visDataRef.current = (msg.vis as { [key: string]: string | null }) || {};
      const now = Date.now();
      if (outputBarShownRef.current && now - lastVisUpdateRef.current > 200) {
        lastVisUpdateRef.current = now;
        setVisVersion(v => v + 1);
      }
    }
  }, []);

  // ── Boot: warm REST seeds (the shared hook handles base resolution,
  // the connection probe, bus reconnect nudging, and AppState 'active'
  // re-seeding). Deck deliberately does NOT call /mixer — the deck tab
  // has no business surfacing overlay channels.
  const seed = useCallback(async (_base: string, connected: boolean) => {
    if (!connected) return;

    // Load autopilot state
    const apResult = await getAutopilot();
    if (apResult.ok && apResult.data) {
      setPlaylistActive(apResult.data.active);
      setPlaylistDelayStr(apResult.data.delay_s);
      setIsShuffle(apResult.data.shuffle);
      // AUTOPILOT PROFILE: seed the active profile + selectable list from the
      // same GET /autopilot the daemon fields come from (the engine folds
      // `profile`/`profiles` into that response). Only adopt well-typed values;
      // otherwise keep the documented `'random'` default.
      if (typeof apResult.data.profile === 'string' && apResult.data.profile.length) {
        setAutopilotProfile(apResult.data.profile);
      }
      if (Array.isArray(apResult.data.profiles) && apResult.data.profiles.length) {
        setAutopilotProfiles(apResult.data.profiles as string[]);
      }
    }

    // PATTERN-GROUP LOCALITY: the group knobs are NOT in the autopilot daemon
    // state above (the /autopilot GET has no slot for them and the `autopilot`
    // WS broadcast omits them too). They ride the deck base channel's
    // playlist.autopilot, so hydrate them off GET /deck/playlist — the same
    // read-back SHUFFLE/cadence would use if they lived there. Defaults
    // (false/3/6) match the engine when the fields are absent on an older
    // playlist.
    const deckPl = await fetchChannelPlaylist('deck', '');
    if (deckPl.ok && deckPl.data && (deckPl.data as any).autopilot) {
      const ap = (deckPl.data as any).autopilot;
      setGroupMode(!!ap.groupMode);
      if (typeof ap.groupSize === 'number') setGroupSize(ap.groupSize);
      if (typeof ap.groupDwell === 'number') setGroupDwell(ap.groupDwell);
    }

    // Load deck transition config
    const dtRes = await fetchDeckTransitionConfig();
    if (dtRes.ok && dtRes.data) {
      setDeckTxConfig(dtRes.data);
    }

    // Load deck COLOR autopilot config (palette-cycling autopilot).
    const caRes = await fetchDeckColorAutopilot();
    if (caRes.ok && caRes.data) {
      // NORMALIZE `palettes` (docs/59 §4.1). The payload is MODE-SCOPED: a
      // FOLLOW NOTE config carries no `palettes` at all, and seeding that
      // straight into state left every consumer of the (non-optional) field
      // holding `undefined` — the AUTOPILOT window's colour panel read
      // `.length` off it and white-screened the deck on load. The WS reconcile
      // below already guarantees an array; the focus seed must too, or the two
      // doors into the same state disagree about its shape.
      setColorAutopilot({
        ...caRes.data,
        palettes: Array.isArray(caRes.data.palettes) ? caRes.data.palettes : [],
      });
    }

    // Load initial deck channel state.
    const deckRes = await fetchDeckChannel();
    if (deckRes.ok && deckRes.data) {
      const ch = deckRes.data.channel || null;
      setDeckChannel(ch);
    }

    // DECK SPLIT PLAYLISTS: hydrate the divider ratio + secondary-slot presence
    // before the first `deck` broadcast so the panes render at the right split
    // (and pane 2 opens if a secondary was bound in a previous session). The
    // per-pane entry lists still come from each PlaylistPanel's own deckSlot
    // fetch/reconcile — this only seeds the parent-owned split chrome.
    const slotsRes = await fetchDeckPlaylistSlots();
    if (slotsRes.ok && slotsRes.data) {
      setDeckSecondaryBound(!!slotsRes.data.secondary);
      if (typeof slotsRes.data.splitRatio === 'number' && Number.isFinite(slotsRes.data.splitRatio)) {
        setDeckSplitRatio(slotsRes.data.splitRatio);
      }
    }

    // Seed the parent-owned playlist library (see comment on the
    // state declaration). Engine returns the cached in-memory list.
    const pLib = await fetchPlaylists();
    if (pLib.ok && pLib.data) setPlaylistLibrary(pLib.data);
  }, []);

  const { reconnect: connectToEngine } = useEngineConnection({ seed, onControl, onStatus, onViz });

  // Patch the deck transition config (optimistic local update + POST).
  // The server broadcasts `deckTransitionConfig` on success which we
  // already mirror in the WS handler — that's the source of truth, but
  // updating locally first avoids the visible "snap-back" on tap.
  const handleDeckTxChange = useCallback((patch: Partial<DeckTransitionConfig>) => {
    notifyInteraction();
    // Optimistic apply with rollback (C5). We snapshot the fields the
    // patch touches BEFORE applying so a rejected POST can restore
    // exactly those keys without clobbering any concurrent WS update to
    // other fields. Keeps the no-visible-snap UX on the happy path while
    // honoring Codex P0 — a server reject must NOT leave the UI showing a
    // value the engine refused. The `deckTransitionConfig` WS broadcast
    // remains the source of truth on success.
    let prevSnapshot: Partial<DeckTransitionConfig> = {};
    setDeckTxConfig((prev) => {
      const snap: Partial<DeckTransitionConfig> = {};
      for (const k of Object.keys(patch) as (keyof DeckTransitionConfig)[]) {
        (snap as any)[k] = prev[k];
      }
      prevSnapshot = snap;
      return { ...prev, ...patch };
    });
    void setDeckTransitionConfig(patch).then((res) => {
      if (!res.ok) {
        console.error('[Deck] Transition-config POST rejected:', res.error);
        setDeckTxConfig((prev) => ({ ...prev, ...prevSnapshot }));
        opError(
          'Transition setting not applied',
          `The engine rejected the change. ${res.error || ''} Reverted to the previous value.`.trim(),
        );
      }
    }).catch((err) => {
      console.error('[Deck] Transition-config POST failed:', err);
      setDeckTxConfig((prev) => ({ ...prev, ...prevSnapshot }));
      opError('Transition setting not applied', `Could not reach the engine. ${err?.message || ''} Reverted.`.trim());
    });
  }, [notifyInteraction]);

  // Patch the deck COLOR autopilot (optimistic local update + POST), mirroring
  // handleDeckTxChange exactly: snapshot the touched keys, apply optimistically,
  // POST, and on a rejected/failed POST restore ONLY those keys + Alert (Codex
  // P0 — never leave the UI showing a value the engine refused). On a SUCCESSFUL
  // POST the engine broadcasts `colorAutopilot` on /ws/control, which the
  // onControl handler above reconciles — that broadcast is the source of truth
  // (it also carries PLAN-driven and per-tick palette-advance changes), so the
  // optimistic value just avoids a tap-snap until the echo lands.
  // `failNote` (docs/61 §2.1, W3): the YIELD gestures (L2/L3, below) call this
  // as their POST path, and on a REJECTED/unreachable stop the operator needs
  // `YIELD_FAIL_SAY` ("Couldn't stop FOLLOW NOTE — it is still driving.") —
  // not the generic "reverted" sentence, because a yield's `patch` is
  // `{active:false}` with no prior snapshot worth narrating as a revert. Every
  // other caller omits it and gets the unchanged sentence.
  const handleColorAutopilotChange = useCallback((patch: Partial<DeckColorAutopilotConfig>, failNote?: string) => {
    notifyInteraction();
    let prevSnapshot: Partial<DeckColorAutopilotConfig> = {};
    setColorAutopilot((prev) => {
      const snap: Partial<DeckColorAutopilotConfig> = {};
      for (const k of Object.keys(patch) as (keyof DeckColorAutopilotConfig)[]) {
        (snap as any)[k] = prev[k];
      }
      prevSnapshot = snap;
      return { ...prev, ...patch };
    });
    void setDeckColorAutopilot(patch).then((res) => {
      if (!res.ok) {
        console.error('[Deck] Color-autopilot POST rejected:', res.error);
        setColorAutopilot((prev) => ({ ...prev, ...prevSnapshot }));
        opError(
          'Color autopilot not applied',
          [`The engine rejected the change. ${res.error || ''} Reverted to the previous value.`.trim(), failNote]
            .filter(Boolean).join(' '),
        );
      }
    }).catch((err) => {
      console.error('[Deck] Color-autopilot POST failed:', err);
      setColorAutopilot((prev) => ({ ...prev, ...prevSnapshot }));
      opError(
        'Color autopilot not applied',
        [`Could not reach the engine. ${err?.message || ''} Reverted.`.trim(), failNote].filter(Boolean).join(' '),
      );
    });
  }, [notifyInteraction]);

  // ── L2 — hiding the COLORS window (docs/61 §2.1/§3) ─────────────────────
  // The workspace bar's hide-COLORS chip runs through the same
  // `runYieldGesture` bridge as L3, THEN closes the window regardless of the
  // POST outcome — yield is fire-with-narration, never a navigation gate.
  // Every other window's hide (patterns is protected and has no chip;
  // parameters/autopilot/pixels have no running colour mode to leave) just
  // falls through to `workspace.closeWindow` unchanged. Widened to
  // `DeckSurfaceId` (docs/63 W3) because this is now also the bar chips'
  // `onClose` — closing/opening a BAR runs no yield, posts nothing; the
  // branch below stays keyed on `id === 'colors'` exactly as before, which
  // TypeScript narrows fine since `'colors'` is one member of the union.
  const handleWorkspaceClose = useCallback((id: DeckSurfaceId) => {
    if (id === 'colors') {
      runYieldGesture({
        gesture: 'hide',
        card: colorsCardRef.current,
        // L2's own gesture passes `true`: it fires BEFORE the close below, so
        // the window is still open at the moment the rule is evaluated.
        colorsWindowOpen: true,
        kind: rotationKind(colorAutopilot.active, colorAutopilot.palettes, colorAutopilot.mode),
        disabled: isConnected === false || planGate,
        post: (patch, failNote) => handleColorAutopilotChange(patch, failNote),
        say: (message) => opInfo('COLORS', message),
      });
    }
    workspaceCloseWindow(id);
  }, [colorAutopilot, isConnected, planGate, handleColorAutopilotChange, workspaceCloseWindow]);

  // LIVE RETUNE the running colour rotation (docs/59 §5.2). Deliberately NOT
  // handleColorAutopilotChange: that POSTs, and a POST is a full replace — the
  // daemon bumps its generation, kills the in-flight tween and re-arms the hold
  // from zero, which is the visible restart the operator asked us to remove.
  // This PATCHes the moved field in place.
  //
  // NO optimistic update. The retune fields the card sends live are the ones
  // the daemon may adopt at a boundary (a fade lands at its own duration; a
  // subset swap takes effect at the next advance), so painting the new value
  // immediately would claim a change the rig has not made yet. The broadcast
  // that follows the PATCH is the truth, and it arrives in one round trip.
  const handleColorAutopilotRetune = useCallback((patch: Record<string, unknown>, failNote?: string) => {
    notifyInteraction();
    void patchDeckColorAutopilot(patch).then((res) => {
      if (!res.ok) {
        console.error('[Deck] Color-autopilot PATCH rejected:', res.error);
        opError('Retune not applied', retuneRejectionMessage('rejected', res.error, failNote));
      }
    }).catch((err) => {
      console.error('[Deck] Color-autopilot PATCH failed:', err);
      opError('Retune not applied', retuneRejectionMessage('unreachable', err?.message, failNote));
    });
  }, [notifyInteraction]);

  // Set the AUTOPILOT PROFILE (optimistic + rollback + Alert), cloned exactly
  // from handleDeckTxChange: snapshot the previous profile, apply optimistically,
  // POST /deck/playlist/autopilot {profile}, and on a rejected/failed POST
  // restore the previous value + Alert (Codex P0 — never leave the UI showing a
  // value the engine refused; an unknown profile 400s loud). On success the
  // engine broadcasts `autopilot` with the new profile, which the onControl
  // handler reconciles — that broadcast is the source of truth. planGate-guarded
  // (the panel is also `disabled`, and the PlanLockScrim blankets it).
  const handleAutopilotProfileChange = useCallback((profile: string) => {
    if (planGate) return;
    notifyInteraction();
    let prevProfile = 'random';
    setAutopilotProfile((prev) => { prevProfile = prev; return profile; });
    void apiSetAutopilotProfile(profile).then((res) => {
      if (!res.ok) {
        console.error('[Deck] Autopilot-profile POST rejected:', res.error);
        setAutopilotProfile(prevProfile);
        opError(
          'Autopilot profile not applied',
          `The engine rejected the change. ${res.error || ''} Reverted to the previous value.`.trim(),
        );
      }
    }).catch((err) => {
      console.error('[Deck] Autopilot-profile POST failed:', err);
      setAutopilotProfile(prevProfile);
      opError('Autopilot profile not applied', `Could not reach the engine. ${err?.message || ''} Reverted.`.trim());
    });
  }, [notifyInteraction, planGate]);

  // DECK SPLIT: POST the new divider ratio on drag release (optimistic +
  // rollback + Alert). The split component already applied the ratio locally
  // during the drag; we snapshot the pre-drag stored ratio and restore it if the
  // engine rejects (an out-of-band ratio 400s — fail loud). On success the
  // engine broadcasts `deck` with the new splitRatio, which the onControl
  // handler reconciles (source of truth). planGate-guarded.
  const handleSplitRelease = useCallback((ratio: number) => {
    if (planGate) return;
    notifyInteraction();
    let prevRatio = 0.5;
    setDeckSplitRatio((prev) => { prevRatio = prev; return ratio; });
    void setDeckPlaylistSplit(ratio).then((res) => {
      if (!res.ok) {
        console.error('[Deck] Split-ratio POST rejected:', res.error);
        setDeckSplitRatio(prevRatio);
        opError(
          'Split not applied',
          `The engine rejected the divider position. ${res.error || ''} Reverted.`.trim(),
        );
      }
    }).catch((err) => {
      console.error('[Deck] Split-ratio POST failed:', err);
      setDeckSplitRatio(prevRatio);
      opError('Split not applied', `Could not reach the engine. ${err?.message || ''} Reverted.`.trim());
    });
  }, [notifyInteraction, planGate]);

  // DECK SPLIT: clear the SECONDARY pane's slot binding (✕ on pane 2). No
  // ConfirmSheet — clearing a slot destroys nothing. Optimistic collapse +
  // rollback + Alert; on success the engine broadcasts `deck` with the slot
  // cleared (source of truth). Clearing a LIVE secondary promotes it to primary
  // engine-side, which the WS reconcile then reflects.
  const handleCloseSecondary = useCallback(() => {
    if (planGate) return;
    notifyInteraction();
    const prevBound = deckSecondaryBound;
    setDeckSecondaryBound(false);
    void setChannelPlaylist('deckSlot', 'secondary', null).then((res) => {
      if (!res.ok) {
        console.error('[Deck] Clear secondary slot rejected:', res.error);
        setDeckSecondaryBound(prevBound);
        opError(
          'Second playlist not cleared',
          `The engine rejected the change. ${res.error || ''} Reverted.`.trim(),
        );
      }
    }).catch((err) => {
      console.error('[Deck] Clear secondary slot failed:', err);
      setDeckSecondaryBound(prevBound);
      opError('Second playlist not cleared', `Could not reach the engine. ${err?.message || ''} Reverted.`.trim());
    });
  }, [notifyInteraction, planGate, deckSecondaryBound]);

  // Per-channel color metadata (docs/39 §8.4) on the DECK channel. Pure
  // operator-facing accent (no render effect) — tints the deck card for
  // at-a-glance identification, matching the mixer strips. Same optimistic +
  // reconcile + fail-loud shape; a null color clears the accent and the engine
  // requires a string or null.
  const handleDeckColor = useCallback(async (channelId: string, color: string | null) => {
    // Soft PLAN lock — the swatch that opens the picker is inside the gated
    // DECK MAIN card, but the modal could already be open when the lock
    // engages; this write-path gate covers that edge.
    if (planGate) return;
    const prev = deckChannel?.color ?? null;
    setDeckChannel((c: any) => (c ? { ...c, color } : c));
    const res = await setChannelColor(channelId, color, { deck: true });
    if (!res.ok) {
      console.error(`[Deck] color change rejected for ${channelId}:`, res.error);
      setDeckChannel((c: any) => (c ? { ...c, color: prev } : c));
      opError(
        'Color not applied',
        `The engine rejected this color. ${res.error || ''} The deck kept its previous color.`.trim(),
      );
    }
  }, [deckChannel?.color, planGate]);

  // DECK CHANNEL per-channel hue (engine F-hue — hue is per-channel ONLY;
  // the global rig hue shifter was removed 2026-07 by operator decision).
  // Same optimistic + PATCH /deck/channel { hue } + revert-on-rejection
  // shape as handleDeckColor above and the mixer strip's HUE trim. The WS
  // `deck` broadcast reconciles the live value afterwards.
  const handleDeckHue = useCallback(async (degrees: number) => {
    // Soft PLAN lock — the DeckHueRow gates its own handlers too; this is
    // the belt-and-suspenders write-path gate.
    if (planGate) return;
    const prev = typeof deckChannel?.hue === 'number' ? deckChannel.hue : 0;
    setDeckChannel((c: any) => (c ? { ...c, hue: degrees } : c));
    const res = await setChannelHue(deckChannelId ?? '', degrees, { deck: true });
    if (!res.ok) {
      console.error('[Deck] hue change rejected:', res.error);
      setDeckChannel((c: any) => (c ? { ...c, hue: prev } : c));
      opError(
        'Hue not applied',
        `The engine rejected this hue. ${res.error || ''} The deck kept its previous hue.`.trim(),
      );
    }
  }, [deckChannel?.hue, deckChannelId, planGate]);

  const triggerChannelControl = (_channelId: string, id: number, v0: number, v1?: number, v2?: number) => {
    // Deck tab only ever writes to the deck channel — there's a single
    // dedicated route for that now. We ignore the channelId arg (kept
    // for API compatibility with the previous mixer-routed call).
    // Soft PLAN lock — the whole DECK MAIN card is pointerEvents-blocked
    // while gated; this is the belt-and-suspenders write-path gate.
    if (planGate) return;
    notifyInteraction();
    setDeckChannelControl(id, v0, v1, v2);
  };

  return (
    <View style={{ flex: 1, minHeight: 0, backgroundColor: C.background }}>
      {/* Soft PLAN lock banner — low-key YELLOW, non-blocking (box-none), only
          mounts when controlLock === 'plan'. Navigation/viewing stay live; the
          deck's pattern selection is the only thing disabled (below). The full
          red portwatch lockout stays in the tab layout. */}
      <PlanLockBanner surface="DECK" />
      {/* Top bar: title + connection status + master fader. Matches the
          Marsin Mixer header layout, minus channel-add buttons. Under the soft
          PLAN lock (planGate) the MASTER fader + FADE/TO BLACK/UP group and
          the whole GLOBALS row (SPEED/SIZE/SYNC/COLORS/QUEUE/TAP/BPM source)
          are disabled; taking over re-enables everything. */}
      {/* ── Plan-lock content region ──────────────────────────────────
          Everything the plan freezes lives inside this relative wrapper so
          the PlanLockScrim (bottom of the wrapper) can hermetically blanket
          it with ONE tap-catching layer — bulletproof against any control
          (present or future) that doesn't wire its own `disabled`, which is
          exactly how the deck overlay controls slipped through before. The
          floating PlanLockBanner (above, zIndex 1000) and the bottom global
          effects bar (a sibling BELOW this wrapper) stay OUTSIDE the scrim. */}
      <View style={{ flex: 1, minHeight: 0, position: 'relative' }}>
      <DeckTopBar isConnected={isConnected} disabled={planGate} />
      {/* ── docs/63 W3 — the view optimizer moves under GLOBALS ─────────────
          `DeckWorkspaceBar` ("the view optimizer") now renders INSIDE
          `CPCControls`, between row 1 (GLOBALS) and row 2 (AUDIO SIGNALS),
          via `optimizerSlot` — a sibling ROW, never an overlay, so it can
          never steal a fader / split-divider gesture; it still lives inside
          the plan-lock content wrapper, so the hermetic scrim freezes it with
          the rest of the deck while a plan is driving. `hideAudioRow` wires
          the AUDIO SIGNALS row (row 2) to the SAME chip mechanism (operator
          order 3). */}
      <CPCControls
        disabled={planGate}
        optimizerSlot={
          <DeckWorkspaceBar
            layout={workspace.layout}
            onOpen={workspace.openWindow}
            onClose={handleWorkspaceClose}
            perfActive={workspace.perfActive}
            trailing={
              <>
                {/* ── Plan-active lock indicator ──────────────────────────────────
                    When a plan is live the deck's mutating controls are fully frozen
                    (pointerEvents 'none' + dim, below) — a tap does NOTHING, so the
                    old "A TOUCH TAKES OVER" copy was a lie under the full freeze the
                    operator requested. This SUBTLE inline chip just states the truth:
                    controls are LOCKED. During takeover this chip disappears; the
                    compact status tile is the one lease countdown authority. */}
                {/* ONE PREDICATE. This chip claims "CONTROLS LOCKED", so it must be
                    driven by the SAME `planGate` that actually locks them — never by
                    a second, locally-derived plan-active flag. A chip that says
                    LOCKED over live controls (or stays lit after the operator
                    DISABLES the plan) is exactly the operator-reported failure this
                    guards against. Engine side: TimelineService._isPlanDrivingDeck
                    is the single source both `planActive` and the 'plan' controlLock
                    derive from, and it is false the instant the plan is disabled. */}
                {/* The locked chip uses the standard on-state recipe. The former
                    long amber takeover chip was redundant with PlanIndicatorPill
                    and is intentionally absent. */}
                {planGate ? (
                  <View style={{
                    flexDirection: 'row', alignItems: 'center', gap: 6,
                    paddingHorizontal: 8, paddingVertical: 4, borderRadius: Radius.control,
                    borderWidth: 1, ...accentWash(PLAN_INDICATOR_CYAN),
                  }}>
                    <Text style={{ ...Type.microCaps, textTransform: 'uppercase', letterSpacing: 0.6, color: PLAN_INDICATOR_CYAN }}>
                      PLAN LIVE · CONTROLS LOCKED
                    </Text>
                  </View>
                ) : null}
                {/* Compact plan-status glyph — RIGHTMOST in the globals row (request
                    #5). Matches the OscStatusPill idiom (48px tile, coloured
                    border/dot/label). During a lease, tapping it reopens the
                    dismissible RESUME NOW / GO TO PLAN notice. */}
                <PlanIndicatorPill />
              </>
            }
          />
        }
        hideAudioRow={!workspace.isBarShown('audioBar')}
      />
      {/* ── Channel Preview Visualization (docs/63 §2.6/§3) ─────────────────
          The `DECK MAIN · LIVE OUTPUT` caption and the 1D `<PixelStrip>` below
          it live and die together as ONE block, rendered only when the
          OUTPUT bar is effectively shown (operator order 1: PIXELS open
          suppresses it, or the operator hides it directly via its chip). When
          hidden, this whole wrapper is absent — no empty padded box remains,
          since reclaiming that height is the point of this wave. */}
      {workspace.isBarShown('outputBar') ? (
        <View style={{ paddingHorizontal: 16, paddingTop: 4 }}>
          {/* QA round8 #7: the solid bar below read ambiguously. Label it
              like the mixer's "MASTER OUTPUT" convention so it's clear this
              strip is the deck's live output preview. */}
          <Text style={{ ...Type.microCaps, textTransform: 'uppercase', color: C.icon, marginBottom: 4 }}>
            DECK MAIN · LIVE OUTPUT
          </Text>
          {/* "LIVE OUTPUT" preview = the engine's `preDimmer` composite — the
              composition AFTER global FX (invert / group color-locks)
              but BEFORE the section dimmer rack + blackout (operator request
              2026-06-29). So the deck preview (a) shows the global effects
              (and the per-channel hues baked into the composite), while (b)
              still ignoring the section
              dimmer-rack trim — it shows what the SHOW is producing, not the
              dimmed-down hardware output. The section dimmers are still applied to
              the actual sACN/DMX output — this is preview-only. The mixer master
              strip uses the same `preDimmer` key for parity. */}
          <PixelStrip base64Data={visDataRef.current.preDimmer ?? null} height={18} style={{ borderRadius: Radius.control }} />
        </View>
      ) : null}
      {/* ── 3-COLUMN deck layout (operator request June 2026) ───────────────
          On wide surfaces (iPad landscape / web) the deck is three side-by-side
          columns — PATTERNS | PARAMETERS | AUTOPILOT & SETTINGS — each
          independently scrollable so tall content (the param list, the palette
          panel) never gets cut off. On narrow widths (`!isWide`) the row wraps
          back to a single vertical stack (the previous behavior) so nothing is
          crushed in portrait. `globalStyles.container` is `flexDirection:'row',
          flex:1` already; we widen it to wrap on narrow so the columns stack.
          Column weights, wide: PATTERNS 4 / PARAMETERS 3 / AUTOPILOT 3 — the
          40/30/30 split. 2026-07-27 journey, recorded so nobody re-litigates
          it: the operator asked to halve PATTERNS (→2, 20/40/40) and to stack
          PARAMETERS over AUTOPILOT; he then tested both on the iPad and
          reversed both — the stack (he wants the two side by side) and the
          cut (20% truncated pattern names too hard). Final answer = these
          original weights. Do not "fix" this back to 20% without him. */}
      {/* party 2026-07-11 LAYOUT FIX: in the STACKED (non-wide) layout the
          PARAMETERS + SETTINGS sections collapsed to ZERO height (flex:0
          wrappers whose only children are ScrollViews have no intrinsic
          height) and there was no outer scroll to reach them — the operator
          saw ONLY the patterns card. Fix: the stacked layout hosts the three
          sections in ONE outer ScrollView (sections size to their content and
          the page scrolls, the standard RN pattern); the wide layout keeps the
          plain 3-column row. The sections' inner ScrollViews exist only in wide
          mode (SectionHost is a View when stacked) so stacked mode has a
          single, predictable scroll surface. */}
      <View
        // dataSet is an RN-web DOM marker (→ data-layouthost); it's not on the
        // native View prop types, so cast it in like the SectionHost host did.
        {...({ dataSet: { layouthost: 'columns' } } as object)}
        // The NARROW split is arbitrated against this box's MEASURED height
        // (report _273) — the pin used to be derived from the device window,
        // which is how a 400 pt PATTERNS pin ended up inside a 309 pt stack.
        // Harmless in wide mode: nothing there reads `columnsHostHeight`.
        onLayout={handleColumnsHostLayout}
        // paddingHorizontal 4 + each track's marginHorizontal 4 = an 8pt
        // gutter everywhere (R2 window rhythm — see `windowTrack`).
        style={[
          globalStyles.container,
          { minHeight: 0, paddingHorizontal: 4 },
          !isWide && { flexDirection: 'column' },
        ]}
      >
        {/* ── COLUMN 1 — PATTERNS ──────────────────────────────────────────
            The one-and-only pattern list (active playlist) + the global rig HUE
            shifter pinned above it. DECK MAIN's live preview strip stays in the
            header above (it is the deck's master output, not a per-column item).
            Padding is tightened from the default leftPane (24) so the playlist
            gets more vertical room. GLOBAL EFFECTS lives in the full-width
            bottom bar below (mirrors the mixer tab). The playlist shows ≥5
            entries on 11" iPad landscape; REFRESH/RECONNECT is the header ↻
            icon (PlaylistPanel `onRefreshConnection`). */}
        {/* WINDOW: PATTERNS — PROTECTED. It is the floor of the workspace, so
            it has no hide chip and the layout reducer refuses to close it; the
            column style below is passed to <DeckWindow> verbatim, so an open
            window is pixel-identical to the column it replaces. */}
        <DeckWindow id="patterns" open={workspace.isOpen('patterns')} style={[
          // R2: the shared window surface. This used to be `leftPane` (the
          // only pane on the deck); it is now the same `panel` recipe the
          // other three windows wear, so no window is special.
          ...windowTrack,
          { padding: 14, gap: 8 },
          // Wide: this column flexes to ~1.1 of the row. Narrow (stacked): the
          // leftPane's default flex:1 inside a column container would let it
          // eat all vertical space — pin a sensible min height instead so the
          // stack scrolls naturally with the columns below it. When a SECOND
          // playlist pane is bound in the narrow/stacked layout, raise the floor
          // 320→480 so the split card is tall enough to seat two MIN_PANE panes
          // (deck_split_playlists.md §Resizable split): below 2·MIN_PANE_PT the
          // divider forces a fixed 0.5, so the extra height keeps the drag live.
          // _225 NOTE: in the narrow stack the two panes are now SIDE BY SIDE
          // (see `sideBySide` at the SplitPlaylistPanes call below), so the
          // split axis is width and this raised floor is no longer what keeps
          // the divider draggable — the container's WIDTH is. The extra height
          // is kept anyway: two full-height playlist COLUMNS are exactly what
          // the taller card now buys, so the floor still earns its place.
          // party 2026-07-11: PATTERNS weight 1.1→1.6 (operator: the pattern
          // list is "too small" horizontally in landscape), then pinned to an
          // exact 40/30/30 split (flex 4/3/3) — operator: "patterns column 40%
          // and the other 60%". 2026-07-27: briefly halved to flex 2 (20%) at
          // the operator's request, then restored to 4 after he tested it —
          // 20% truncated the pattern names too hard. See the column-weights
          // note above for the full journey.
          // PATTERNS-PIN (narrow): a FIXED height so the column is pinned in
          // place — it never grows or scrolls as a unit; its own pattern list
          // scrolls INTERNALLY within this fixed panel while PARAMETERS +
          // AUTOPILOT scroll below it. We pin via flexBasis + flexGrow/Shrink:0
          // (NOT `flex:0`+height): leftPane sets flex:1, and in the narrow COLUMN
          // container a bare `height` is defeated by the flex model (the item
          // collapses to ~content height and the inner flex:1 goes to 0). An
          // explicit non-flexible basis is what actually fixes the box.
          // Height scales with the window (operator: 400pt fixed was "very
          // short and not usable" on iPad portrait; 55% was then too tall —
          // "reduce by 30%"): 38.5% of window height, floored at 400pt
          // (500pt with a second playlist bound — two MIN_PANE panes need
          // the room). iPad portrait 1080pt → ~416pt; 12.9" 1366pt → ~526pt.
          // The weight now comes from the workspace (docs/53 §3.1) — it is the
          // SAME 4 while PATTERNS is open, and the other windows' weights are
          // unchanged too, so the default layout is the 40/30/30 row above.
          // NARROW FULLSCREEN (docs/55 §2.4, operator intent 4: "when all
          // colors and params and auto pilot panels are hidden make sure the
          // pattern is always full screen"). With every other window hidden —
          // by the operator's own chips OR by the performance overlay — the
          // fixed pin leaves PATTERNS sitting above a DEAD scroll region, so
          // the deck shows a short card and a lot of nothing. In that ONE
          // composition the pin gives way to a flex fill.
          //
          // Wide mode never had the bug: its flex weights already renormalize,
          // so a lone PATTERNS track takes the whole row.
          //
          // Strictly conditional: `mode:'fill'` is true only when the EFFECTIVE
          // open set is exactly {patterns}.
          //
          // NARROW SPLIT, ARBITRATED (report _273 ruling, REVISED by _278).
          // The pinned branch's height is no longer a local
          // `max(400|500, 38.5 %)` expression: it comes from `narrowStackSizing`,
          // which measures it against the ACTUAL stack. With ANY secondary
          // window open on a stack tall enough for the pin, the returned
          // height IS the party 2026-07-11 pin, to the pixel — `_274`'s
          // one-secondary slack absorption is GONE (_278 operator ruling:
          // PATTERNS at 75 % after a reshow read as "not resizing from full
          // screen" with the restored window "overlaying" its bottom;
          // restoring a window now snaps the deck to its SHIPPED proportions,
          // the same thing `wideFlexFor` does in the wide row). The one case
          // the pin still bends:
          //   • stack shorter than the pin → the pin yields instead of
          //     overflowing the host and starving the region to zero.
          // `flexShrink:1` (was 0) and the dropped `height` are the structural
          // half of the same fix: even if the arbitrated height and the 4 pt
          // track margins disagree by a few points, flexbox absorbs it INSIDE
          // the host — PATTERNS can no longer spill past the host's bottom edge
          // and be painted over by the scroll region that follows it.
          isWide
            ? { flex: workspace.flexFor('patterns'), minWidth: 0 }
            : narrowTracks.patterns,
          // Fabric can commit the parent's fill->pin frame before every deep
          // playlist descendant has consumed the new height. A native View is
          // overflow-visible by default, so that one transition frame lets the
          // old full-height list paint into the lower window. Clip the narrow
          // native panel at its authoritative Yoga box; wide and web retain
          // their byte-identical surface/shadow behavior.
          !isWide && Platform.OS !== 'web' ? NARROW_PATTERNS_NATIVE_CLIP_STYLE : null,
        ]}>
          {isConnected === false && <OfflineBanner error={connectionError} />}

          {/* THE pattern list = the active playlist for the deck.
              No duplicate "all patterns" list — tap + on the panel to pick from the
              full library and add it as a new entry. */}
          {deckChannelId ? (
            <View key={deckChannelId} style={{ flex: 1, minHeight: 0 }}>
              {/* DECK CHANNEL HUE trim, pinned to the TOP of the deck's
                  pattern list — mirroring how the MIXER shows a compact HUE
                  row above each channel's playlist. This is the DECK
                  CHANNEL's per-channel hue (engine F-hue): the GLOBAL rig
                  hue shifter was REMOVED 2026-07 by operator decision
                  ("only the channel hue shifts, no global hidden one").
                  Value + write path live in this screen (deckChannel.hue +
                  handleDeckHue — optimistic PATCH /deck/channel, WS `deck`
                  reconcile), the same shape as the mixer strip's trim.
                  It's the deck's ONE-AND-ONLY hue control; the bottom
                  effects bar stays hue-less. Gated under the soft PLAN lock
                  like every other mutating deck control. */}
              <DeckHueRow
                hue={typeof deckChannel?.hue === 'number' ? deckChannel.hue : 0}
                onHueChange={handleDeckHue}
                disabled={planGate}
              />
              {/* DECK SPLIT PLAYLISTS: the single deck list is now two stacked,
                  resizable panes — DECK A (primary, today's list) and an OPTIONAL
                  DECK B (secondary). The deck still plays exactly one pattern;
                  tapping an entry in either pane drives it. Pane 2 is collapsed
                  by default (a "+ SECOND PLAYLIST" bar) so operators who never
                  add one see today's single list, pixel-identical. Both panes are
                  disabled during a soft-swap OR under the soft PLAN lock, exactly
                  as the single deck panel was. The PARAMETERS column (col 2) is
                  untouched — it still renders off the live deck channel. */}
              <SplitPlaylistPanes
                deckChannelId={deckChannelId}
                locked={!!deckChannel?.locked}
                primaryAssignment={(deckChannel?.playlist as PlaylistAssignment) || null}
                disabled={deckSwapInFlight || planGate}
                onRefreshConnection={connectToEngine}
                playlistLibrary={playlistLibrary}
                splitRatio={deckSplitRatio}
                secondaryBound={deckSecondaryBound}
                // Keep the outer PATTERNS window byte-identical; only divide its
                // existing interior into two vertical columns so both playlists
                // expose more pattern rows. The ratio, routes and DECK B's ✕
                // unbind lifecycle are unchanged.
                sideBySide
                onSplitRelease={handleSplitRelease}
                onCloseSecondary={handleCloseSecondary}
              />
            </View>
          ) : (
            <Text style={{ color: C.secondary, fontStyle: 'italic' }}>
              Waiting for deck…
            </Text>
          )}
        </DeckWindow>

        {/* PARAMETERS + AUTOPILOT scroll together below the pinned PATTERNS
            column in the narrow stack; in the wide row this is a Fragment so the
            two columns stay flex siblings of PATTERNS. See ColumnsScrollRest. */}
        <ColumnsScrollRest
          isWide={isWide}
          collapsed={narrowStack.mode === 'fill'}
          narrowStyle={narrowTracks.rest}
        >
        {/* ── COLUMN 2 — PARAMETERS ────────────────────────────────────────
            ONLY the deck's (local) parameter controls — the DECK MAIN channel
            card: entry-label editor, SAVED flash, color swatch, ◎ ALL
            modulations trigger, the PARAMETERS slider stack (GlobalParams), and
            the toggle/trigger button grid. This used to sit BELOW the settings
            stack in the old single right-pane scroll; it now stands alone in
            the middle column, independently scrollable. */}
        {/* WINDOW: PARAMETERS. Hidden = display:'none' (never unmounted), so
            the slider stack, the entry-label draft and the column's scroll
            offset are exactly where the operator left them on restore. */}
        <DeckWindow id="parameters" open={workspace.isOpen('parameters')} style={[
          // R2: the shared `panel` window surface (docs/54 §3). This track
          // used to be a bare transparent column.
          ...windowTrack,
          { padding: 0 },
          // minWidth:0 lets the column actually shrink to its flex share in
          // the row (RN children otherwise refuse below content width and
          // shove the SETTINGS column off-screen). Stacked: content-sized.
          isWide ? { flex: workspace.flexFor('parameters'), minWidth: 0 } : {},
        ]}>
          <SectionHost dataSet={{ layouthost: "section" }} {...sectionHostProps}>
            {/* Channel parameters for the deck (base) channel. The deck is
                hard-wired to the base channel; CaptainPad's MIXER tab is
                where multi-channel routing lives. */}
            <View style={{ gap: 24 }}>
              {(deckChannel ? [deckChannel] : []).map((channel) => {
                const channelTitle = "DECK MAIN";
                const exports = channel.exports || [];
                // GlobalParams (above) is now responsible for surfacing
                // CPC-matched local exports with a MATCHED badge. This
                // bottom strip just renders the operator-tappable ones,
                // so filter the matched toggles/triggers out here to
                // avoid double-listing them.
                const toggles = exports.filter((e: any) => e.kind === 2 && !e.cpcOwned);
                const triggers = exports.filter((e: any) => e.kind === 3 && !e.cpcOwned);

                return (
                  <View
                    key={channel.id}
                    // Soft PLAN lock: the WHOLE DECK MAIN card (entry-label
                    // editor, color swatch, ◎ ALL, the PARAMETERS sliders, the
                    // toggle/momentary grid) is a mutating surface, so it's
                    // gated as one section — pointerEvents 'none' stops every
                    // interactive child, the dim marks it disabled. Taking
                    // over (leaseHeld) clears planGate and re-enables it.
                    pointerEvents={planGate ? 'none' : 'auto'}
                    style={[
                      // docs/54 row 9: the DECK MAIN card is the canonical
                      // `cardOnPanel` — a card nested inside its window,
                      // not a peer of it.
                      globalStyles.cardOnPanel,
                      PARAMETER_CARD_BOUNDARY_STYLE,
                      // Color accent (docs/39 §8.4): tint the card's left edge so
                      // the operator can identify the deck at a glance — mirrors the
                      // mixer strip. The lock border still wins (operator-critical
                      // state); only paint the accent when the deck isn't locked.
                      // No layout shift when color is null (defaults to ghostBorder
                      // at the same 1px width).
                      !channel.locked && channel.color ? { borderColor: channel.color, borderLeftWidth: 4 } : null,
                      planGate ? { opacity: 0.45 } : null,
                    ]}>
                    {/* D6 trigger: ◎ ALL pill next to the entry label.
                        Disabled when no deck playlist is loaded — the
                        AllModulationsPanel renders an empty state in
                        that case but the disabled affordance is a
                        clearer signal up-front. */}
                    <View style={PARAMETER_HEADER_STYLE}>
                      <View style={PARAMETER_HEADER_LABEL_STYLE}>
                        {/* Renaming the active playlist entry: tap the title and type.
                            Auto-saves on blur; the PlaylistPanel listens for the same
                            `playlistSaved` broadcast and flashes its ✓ SAVED toast. */}
                        <EntryLabelEditor
                          channelId={channel.id}
                          role="deck"
                          channelLabel={channelTitle}
                          locked={!!channel.locked}
                        />
                      </View>
                      <View style={PARAMETER_HEADER_ACTIONS_STYLE}>
                      {/* SAVED flash moved up here from inside GlobalParams
                          so it never reflows the slider stack. The component
                          always reserves the same width/height — the inner
                          pill only fades in/out. */}
                      <ChannelSaveFeedback channelId={channel.id} />
                      {/* Color swatch (docs/39 §8.4) — taps open the accent
                          picker. The swatch fill IS the deck's current color
                          (or a hollow "no color" ring when null). Pure
                          metadata; tints the card for identification, no render
                          effect. Mirrors the mixer strip's swatch button. */}
                      <TouchableOpacity
                        onPress={() => setShowColorPicker(true)}
                        hitSlop={ICON_BTN_HIT_SLOP}
                        accessibilityRole="button"
                        accessibilityLabel={channel.color ? `Deck color ${channel.color}` : 'Set deck color'}
                        style={[
                          styles.deckSwatchBtn,
                          { borderColor: C.ghostBorder },
                          channel.color ? { backgroundColor: channel.color, borderColor: channel.color } : null,
                        ]}
                      >
                        <Text style={{
                          fontFamily: 'SpaceGrotesk_700Bold',
                          fontSize: 13,
                          color: channel.color ? '#FFFFFF' : C.secondary,
                        }}>{channel.color ? '●' : '○'}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => setShowAllMods(true)}
                        disabled={!channel.playlist?.name}
                        accessibilityLabel="Open all modulations panel"
                        accessibilityRole="button"
                        // Production-console touch target: the pill is
                        // visually compact (fontSize 11 + 4pt vertical
                        // padding) so we expand the tappable area with
                        // hitSlop + a 44pt min height/width instead of
                        // inflating the chrome, keeping the header tidy.
                        hitSlop={{ top: 12, bottom: 12, left: 10, right: 10 }}
                        // docs/54 row 11: the old '#00a86b' literal is the
                        // palette's `tertiary`, and the pill wears the shared
                        // quiet on-state wash instead of a bare outline.
                        style={{
                          paddingHorizontal: 12, borderRadius: Radius.control,
                          minHeight: 44, minWidth: 44,
                          alignItems: 'center', justifyContent: 'center',
                          borderWidth: 1,
                          ...accentWash(C.tertiary),
                          opacity: channel.playlist?.name ? 1 : 0.4,
                        }}
                      >
                        <Text style={{
                          fontFamily: 'SpaceGrotesk_700Bold', fontSize: 11,
                          color: C.tertiary, letterSpacing: 0.5,
                        }}>
                          ◎ ALL
                        </Text>
                      </TouchableOpacity>
                      </View>
                    </View>

                    {/* QA round8 #3: the PARAMETERS section spent ~32px of
                        chrome (16 label margin + 16 section margin) on a single
                        slider. Tightened both to 6 so the header rides compactly
                        — mirrors the AUTOPILOT card's tight header pattern. */}
                    <View style={{ marginBottom: 6 }}>
                      <Text style={{ ...Type.labelCaps, textTransform: 'uppercase', color: C.secondary, marginBottom: 6 }}>PARAMETERS</Text>
                      <GlobalParams variant="deck" channelId={channel.id} exports={exports} />
                    </View>

                    {(toggles.length > 0 || triggers.length > 0) ? (
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginTop: 8, gap: 8 }}>
                        {toggles.map((e: any) => (
                          <ToggleButton key={`toggle-${e.id}`} id={e.id} name={e.name} initialValue={e.v0 ?? 0} onChange={(id: number, v: number) => triggerChannelControl(channel.id, id, v)} />
                        ))}
                        {triggers.map((e: any) => (
                          <MomentaryButton key={`trigger-${e.id}`} id={e.id} name={e.name} onChange={(id: number, v: number) => triggerChannelControl(channel.id, id, v)} />
                        ))}
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </View>
          </SectionHost>
        </DeckWindow>

        {/* ── COLUMN 3 — AUTOPILOT & SETTINGS ──────────────────────────────
            The deck-settings stack that used to sit ABOVE the local parameters:
            AUTOPILOT (pattern playlist cycler + pattern-group locality),
            COLOR AUTOPILOT (palette cycler), DECK TRANSITIONS, and the DECK
            DYNAMIC VIEW OVERRIDES stack. Independently scrollable. */}
        {/* WINDOW: AUTOPILOT. Hidden windows stay mounted, so the pattern /
            color autopilot panels keep receiving their WS broadcasts (and
            their countdowns keep ticking) while minimized — a restored window
            is instantly current, with no refetch. */}
        <DeckWindow id="autopilot" open={workspace.isOpen('autopilot')} style={[
          ...windowTrack,
          { padding: 0 },
          // party 2026-07-11: SETTINGS weight 1.2→1, then 3 in the 40/30/30
          // split (see the column-weights note above).
          // minWidth:0 = same shrink guard as the PARAMETERS column; stacked
          // mode is content-sized inside the outer page scroll.
          isWide ? { flex: workspace.flexFor('autopilot'), minWidth: 0 } : {},
        ]}>
          {/* Padding tightened from 48 → 16 (QA round8 #1): the old 48px
              gutter plus the cards' inner paddingRight:24 wasted ~72px of the
              column's width, forcing the AUTOPILOT / OVERLAYS pill bars
              into horizontal scroll. paddingBottom keeps the last card clear
              of the bottom GLOBAL EFFECTS bar (its intrinsic height ~58px). */}
          <SectionHost dataSet={{ layouthost: "section" }} {...sectionHostProps}>
            {/* Offline Banner (settings column) */}
            {isConnected === false && (
              <OfflineBanner error={connectionError} />
            )}

            {/* ── AUTOPILOT TRANSITIONS ────────────────────────────────
                PLAY/PAUSE | preset pill-bar (1s … 180s) | SHUFFLE.
                The pill-bar replaced a native <Picker> wheel in May 2026 —
                the wheel was hard to hit, ate vertical space, and rendered
                inconsistently across iOS versions. Pills are direct-tap
                and scroll horizontally if the operator's currently-active
                pick is off-screen.
                Card-internal header (May 2026): the AUTOPILOT TRANSITIONS
                label was hoisted INSIDE the card to recover the ~24px the
                free-standing label + its 8px margin used to occupy. Same
                typography recipe as `labelCaps` (SpaceGrotesk_700Bold /
                10pt / 1.2 tracking / secondary / uppercase).
                Soft PLAN lock: the whole AUTOPILOT card (PLAY/PAUSE, SHUFFLE,
                GROUP, the cadence pills, SIZE/DWELL) changes what's playing,
                so it's gated as one section — pointerEvents 'none' stops every
                interactive child; the dim marks it disabled. Taking over
                (leaseHeld) clears planGate and re-enables it. */}
            <PatternAutopilotPanel
              title="AUTOPILOT PATTERNS"
              active={isPlaylistActive}
              delayStr={playlistDelayStr}
              shuffle={isShuffle}
              groupMode={groupMode}
              groupSize={groupSize}
              groupDwell={groupDwell}
              profile={autopilotProfile}
              profiles={autopilotProfiles}
              nextSwapAtMs={patternNextSwapAtMs}
              disabled={planGate}
              onInteraction={notifyInteraction}
              onChange={(patch) => {
                // Map each knob's patch key onto the EXACT write the inline card
                // used to fire. The panel emits one key per interaction.
                if (patch.active !== undefined) {
                  setPlaylistActive(patch.active);
                  setAutopilot(patch.active, playlistDelayStr, isShuffle);
                }
                if (patch.shuffle !== undefined) {
                  setIsShuffle(patch.shuffle);
                  setAutopilot(isPlaylistActive, playlistDelayStr, patch.shuffle);
                }
                if (patch.delayStr !== undefined) {
                  setPlaylistDelayStr(patch.delayStr);
                  setAutopilot(isPlaylistActive, patch.delayStr, isShuffle);
                }
                if (patch.groupMode !== undefined) {
                  setGroupMode(patch.groupMode);
                  setAutopilot(undefined, undefined, undefined, { groupMode: patch.groupMode });
                }
                if (patch.groupSize !== undefined) {
                  setGroupSize(patch.groupSize);
                  setAutopilot(undefined, undefined, undefined, { groupSize: patch.groupSize });
                }
                if (patch.groupDwell !== undefined) {
                  setGroupDwell(patch.groupDwell);
                  setAutopilot(undefined, undefined, undefined, { groupDwell: patch.groupDwell });
                }
                // AUTOPILOT PROFILE: the dropdown emits `profile`; route it
                // through the dedicated optimistic-rollback handler (its own POST
                // + Alert, NOT setAutopilot which would double-write).
                if (patch.profile !== undefined) {
                  handleAutopilotProfileChange(patch.profile);
                }
              }}
              // ── DECK TRANSITIONS (nested INTO the AUTOPILOT PATTERNS card,
              //    operator request 2026-07-04: "the Deck TX and the pattern
              //    autopilot are the same work"). When shuffle is on, show the
              //    actually-rolled style from the engine's most-recent broadcast
              //    instead of the operator's pre-shuffle pick (which the engine
              //    ignores in shuffle mode anyway). Falls back to the config mode
              //    before any swap has happened.
              deckTx={{
                enabled: deckTxConfig.enabled,
                mode: deckTxConfig.shuffle && lastSwapMode ? lastSwapMode : deckTxConfig.mode,
                durationMs: deckTxConfig.durationMs,
                shuffle: deckTxConfig.shuffle,
              }}
              onDeckTxChange={handleDeckTxChange}
            />

            {/* ── AUTOPILOT COLORS ────────────────────────────────────
                Cycles a chosen SET of color palettes on its own timer —
                INDEPENDENT of the pattern autopilot above (operator request:
                "in the autopilot, select a set of palettes that switch on their
                own timer"). Reads on focus, posts on change (optimistic +
                rollback, same shape as handleDeckTxChange). Disabled while
                offline or under the soft PLAN lock (planGate) — it still renders
                read-only so the operator sees the live cycle. */}
            <ColorAutopilotPanel
              config={colorAutopilot}
              onChange={handleColorAutopilotChange}
              disabled={isConnected === false || planGate}
              countdownTargetMs={colorNextSwapAtMs}
            />

          </SectionHost>
        </DeckWindow>

        {/* OVERLAYS is a first-class Deck workspace window, separate from
            automation. It stays mounted while hidden so its live Deck-message
            reconciliation and expanded-card state survive every chip toggle.
            It remains reachable in performance mode; only its mutating
            controls respect the same offline/plan gate as before. */}
        <DeckWindow id="overlays" open={workspace.isOpen('overlays')} style={[
          ...windowTrack,
          { padding: 0 },
          isWide ? { flex: workspace.flexFor('overlays'), minWidth: 0 } : {},
        ]}>
          <SectionHost dataSet={{ layouthost: "section" }} {...sectionHostProps}>
            {isConnected === false && <OfflineBanner error={connectionError} />}
            <DeckOverlayStack
              overlays={deckOverlays}
              overlayAutopilot={overlayAutopilot}
              playlistLibrary={playlistLibrary}
              disabled={isConnected === false || planGate}
            />
          </SectionHost>
        </DeckWindow>

        {/* ── WINDOW 4 — COLORS (docs/53 §4-§5) ────────────────────────────
            Closed by DEFAULT (it lives on the workspace bar's HIDDEN rail), so
            the out-of-the-box deck is still the 40/30/30 three-column row.
            SLICE A mounts the window SHELL: same track + SectionHost recipe as
            the PARAMETERS / AUTOPILOT columns, with <ColorsWindow> as the body.
            The colour work (two-colour hue ring + PALETTE TURNS) replaces that
            component's body — this mount point does not move. In the narrow
            stack it comes LAST, after AUTOPILOT, inside the same single
            ColumnsScrollRest scroll. */}
        <DeckWindow id="colors" open={workspace.isOpen('colors')} style={[
          ...windowTrack,
          { padding: 0 },
          isWide ? { flex: workspace.flexFor('colors'), minWidth: 0 } : {},
        ]}>
          <SectionHost dataSet={{ layouthost: "section" }} {...sectionHostProps}>
            {/* SLICE B/D: the two-colour wheel + PALETTE TURNS. The palette
                read/write stays self-contained inside the component
                (useSharedParamValues + updateParamCenter); the two props below
                are the SINGLE-WRITER gate (docs/53 §4.4) — the live
                colour-autopilot config makes the wheel read-only while the
                daemon owns colorPalette1/2, and the SAME optimistic +
                rollback + broadcast-reconcile handler the AUTOPILOT window
                uses is the ONLY path this window changes engine state
                through. No new state, no new fetch. */}
            <ColorsWindow
              disabled={isConnected === false || planGate}
              colorAutopilot={colorAutopilot}
              onColorAutopilotChange={handleColorAutopilotChange}
              onColorAutopilotRetune={handleColorAutopilotRetune}
              visible={workspace.isOpen('colors')}
              onCardChange={handleColorsCardChange}
            />
          </SectionHost>
        </DeckWindow>

        {/* ── WINDOW 5 — PIXELS (report _225) ──────────────────────────────
            The SIMULATION's own 2D pixel map, lit by the engine's live vis
            frames. Closed by DEFAULT (it waits on the workspace bar's HIDDEN
            rail), so the out-of-the-box deck is untouched.

            NO SectionHost here, unlike every window above it: the body is a
            single canvas that must FILL its track, and wrapping a flex:1
            canvas in a ScrollView gives it an unbounded height to fill, which
            collapses it to nothing. The window owns its own padding instead.
            In the narrow stack it comes LAST, inside the same single
            ColumnsScrollRest scroll, where `minHeight` gives it a real box. */}
        <DeckWindow id="pixels" open={workspace.isOpen('pixels')} style={[
          ...windowTrack,
          { padding: 16 },
          isWide
            ? { flex: workspace.flexFor('pixels'), minWidth: 0 }
            : { minHeight: 300 },
        ]}>
          <PixelViewWindow open={workspace.isOpen('pixels')} />
        </DeckWindow>
        </ColumnsScrollRest>
      </View>
        {/* Hermetic plan-lock scrim — blankets the whole content region above
            (top bar → 3 columns → overlays) with one tap-catching layer.
            Active only under the soft PLAN lock and NOT during an operator
            takeover (planGate = planLocked && !leaseHeld). */}
        <PlanLockScrim active={planGate} />
      </View>
      {/* ── Global Rig Controls (Bottom) ───────────────────────────────
          GLOBAL EFFECTS as a full-width horizontal strip pinned at the
          bottom of the deck — mirrors the mixer tab's bottom bar so the
          effect labels ("Vintage White", "Iceberg Flash", "Blackout"…)
          render at full width and stay legible, instead of being crammed
          into the narrow left playlist column (QA round2 deck fix). The
          two-pane `container` above is flex:1 so it fills the space above
          this bar and its right pane scrolls independently; this bar is
          intrinsic-height so it never overlaps or gets cut off. The HUE
          shifter is omitted by the strip variant itself (it has its
          own deck-grid placement) — see GlobalEffectMacros `mixer-strip`. */}
      <View style={[styles.globalRigBar, { backgroundColor: C.surfaceContainerLow, borderTopColor: C.ghostBorder }]}>
        <RigGlobals variant="mixer" />
      </View>
      {/* D6: floating ALL MODULATIONS overlay — rendered at the screen
          level so it draws above every card. */}
      <AllModulationsPanel
        visible={showAllMods}
        onClose={() => setShowAllMods(false)}
        playlistName={deckChannel?.playlist?.name ?? null}
        activeEntryId={deckChannel?.playlist?.activeEntryId ?? null}
      />
      {/* Deck channel color picker (docs/39 §8.4). A swatch grid + a "NO COLOR"
          clear option (color = null). Pure metadata — tints the deck card for
          identification, no render effect. Mirrors the mixer strip's picker.
          Screen-level so it draws above every card. */}
      <Modal transparent visible={showColorPicker} animationType="fade" onRequestClose={() => setShowColorPicker(false)} supportedOrientations={CAPTAIN_PAD_MODAL_SUPPORTED_ORIENTATIONS}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowColorPicker(false)}>
          <TouchableOpacity activeOpacity={1} onPress={() => {}}>
            <View style={[globalStyles.panel, styles.modalContent]}>
              <Text style={{ ...Type.labelCaps, textTransform: 'uppercase', color: C.secondary, marginBottom: 12 }}>DECK COLOR</Text>
              <View style={styles.swatchGrid}>
                {CHANNEL_COLOR_SWATCHES.map((hex) => {
                  const active = (deckChannel?.color ?? null) === hex;
                  return (
                    <TouchableOpacity
                      key={hex}
                      style={[styles.swatch, { backgroundColor: hex }, active && styles.swatchActive]}
                      hitSlop={ICON_BTN_HIT_SLOP}
                      onPress={() => { if (deckChannelId) handleDeckColor(deckChannelId, hex); setShowColorPicker(false); }}
                      accessibilityRole="button"
                      accessibilityLabel={`Set deck color ${hex}`}
                      accessibilityState={{ selected: active }}
                    >
                      {active ? <Text style={styles.swatchCheck}>✓</Text> : null}
                    </TouchableOpacity>
                  );
                })}
              </View>
              <TouchableOpacity
                style={[styles.clearColorBtn, { borderColor: C.ghostBorder, backgroundColor: C.surfaceContainerHigh }]}
                onPress={() => { if (deckChannelId) handleDeckColor(deckChannelId, null); setShowColorPicker(false); }}
                accessibilityRole="button"
                accessibilityLabel="Clear deck color"
              >
                <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 13, color: C.secondary }}>NO COLOR</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

// Local styles for the color-picker recipe (docs/39 §8.4).
// Palette-dependent colors are applied inline at the call site (this screen
// reads the palette via the usePalette hook, not a StyleSheet factory).
const styles = StyleSheet.create({
  // Bottom-pinned global-effects strip — the deck mirror of the mixer
  // tab's `globalRigBar`. Full-width, intentionally short (header + a
  // single ~36px button row + small padding) so it doesn't eat the
  // playlist / params real-estate above it. alignItems:'stretch' so the
  // inner GEM (flex:1 in mixer-strip mode) spans edge-to-edge instead of
  // collapsing to its intrinsic content width and floating left. Palette
  // colors (surfaceContainerLow bg + ghostBorder top) are applied inline
  // at the call site — this screen reads the palette via usePalette, not
  // a StyleSheet factory.
  globalRigBar: {
    flexShrink: 0,
    // RigGlobals and GEM both use flex:1 to own the strip width. Without an
    // explicit cross-axis size, Yoga can report a transient undersized
    // intrinsic height when an attached tab is reactivated after a modal or
    // orientation handoff; the final 20px then lands below the iPad viewport.
    // Reserve the complete 44px target + host padding + top rule every pass.
    height: EFFECTS_STRIP_HOST_HEIGHT,
    paddingHorizontal: 12,
    paddingTop: 4,
    paddingBottom: 6,
    borderTopWidth: 1,
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  deckSwatchBtn: {
    width: 44, height: 44, borderRadius: Radius.control,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // docs/54 row 19: a modal is a panel. Radius from the scale; the surface
  // + hairline + shadow come from `globalStyles.panel` at the call site.
  modalContent: {
    borderRadius: Radius.panel,
    borderWidth: 1,
    padding: 20,
  },
  swatchGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    maxWidth: 220,
    marginBottom: 12,
  },
  swatch: {
    width: 44, height: 44, borderRadius: Radius.control,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(0,0,0,0.15)',
  },
  swatchActive: {
    borderWidth: 3,
    borderColor: '#FFFFFF',
  },
  swatchCheck: {
    fontFamily: 'SpaceGrotesk_700Bold',
    fontSize: 18,
    color: '#FFFFFF',
  },
  clearColorBtn: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.control,
    borderWidth: 1,
  },
});
