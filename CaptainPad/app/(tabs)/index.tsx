import React, { useState, useRef, useCallback } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Alert, Modal, StyleSheet, useWindowDimensions } from 'react-native';
import { useGlobalStyles } from '@/styles/globalStyles';
import { usePalette } from '@/hooks/use-theme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { RigGlobals } from '@/components/RigGlobals';
import { GlobalParams, DeckSavedFlash } from '@/components/GlobalParams';
import { CPCControls } from '@/components/CPCControls';
import { DeckTopBar } from '@/components/DeckTopBar';
import { PlaylistPanel } from '@/components/PlaylistPanel';
import { GlobalHueRow } from '@/components/global_hue_row';
import { EntryLabelEditor } from '@/components/EntryLabelEditor';
import { PixelStrip } from '@/components/ui/PixelStrip';
import { AllModulationsPanel } from '@/components/AllModulationsPanel';
import { useFocusEffect } from 'expo-router';
import {
  getAutopilot, setAutopilot,
  fetchDeckChannel, setDeckChannelControl,
  setMixerView,
  fetchDeckTransitionConfig, setDeckTransitionConfig,
  fetchDeckColorAutopilot, setDeckColorAutopilot,
  fetchPlaylists,
  fetchChannelPlaylist,
  type DeckTransitionConfig,
  type DeckColorAutopilotConfig,
} from '@/utils/api';
import { engineEvents } from '@/utils/engineEvents';
import { engineVizEvents } from '@/utils/engineVizEvents';
import { setMidiActiveContext } from '@/hooks/useMidiControl';
import { setChannelColor } from '@/utils/channelExtrasApi';
import { panicMixer } from '@/utils/channelOpsApi';
import { ConfirmSheet } from '@/components/ui/ConfirmSheet';
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

const ToggleButton = ({ id, name, initialValue = 0, onChange }: { id: number, name: string, initialValue?: number, onChange: Function }) => {
  const globalStyles = useGlobalStyles();
  const C = usePalette();
  const [isOn, setIsOn] = React.useState(initialValue > 0.5);
  React.useEffect(() => { setIsOn(initialValue > 0.5) }, [initialValue]);
  return (
    <TouchableOpacity 
      onPress={() => { const next = !isOn; setIsOn(next); onChange(id, next ? 1.0 : 0.0); }}
      style={[
        globalStyles.macroButton, 
        { flexBasis: '30%' }, 
        isOn ? { backgroundColor: C.primary, borderColor: C.primary } : {}
      ]}
    >
      <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 12, color: isOn ? '#fff' : C.text, textAlign: 'center' }}>
        {name.replace(/toggle|trigger/i, '').substring(0, 10).toUpperCase()}
      </Text>
    </TouchableOpacity>
  );
};

const MomentaryButton = ({ id, name, onChange }: { id: number, name: string, onChange: Function }) => {
  const globalStyles = useGlobalStyles();
  const C = usePalette();
  const [isPressed, setIsPressed] = React.useState(false);
  return (
    <TouchableOpacity 
      onPressIn={() => { setIsPressed(true); onChange(id, 1.0); }}
      onPressOut={() => { setIsPressed(false); onChange(id, 0.0); }}
      activeOpacity={1}
      style={[
        globalStyles.macroButton, 
        { flexBasis: '30%' }, 
        isPressed ? { backgroundColor: C.error, borderColor: C.error } : {}
      ]}
    >
      <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 12, color: isPressed ? '#fff' : C.text, textAlign: 'center' }}>
        {name.replace(/toggle|trigger/i, '').substring(0, 10).toUpperCase()}
      </Text>
    </TouchableOpacity>
  );
};

// ── Connection Status Banner ────────────────────────────────────────────
const OfflineBanner = ({ error }: { error: string }) => {
  const C = usePalette();
  return (
    <View style={{
      // 'rgba(186, 26, 26, 0.12)' — translucent error wash; reads as
      // alarm on both light and dark surfaces, so we keep it as a
      // literal rather than burning a palette token.
      backgroundColor: 'rgba(186, 26, 26, 0.12)',
      borderColor: C.error,
      borderWidth: 1,
      borderRadius: 12,
      padding: 16,
      marginBottom: 16,
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
  // ── 3-COLUMN layout responsiveness (operator request June 2026) ──────────
  // The deck splits into three side-by-side columns on wide surfaces (iPad
  // landscape / web): PATTERNS | PARAMETERS | AUTOPILOT & SETTINGS. On narrow
  // widths (portrait phone, a too-narrow window) three columns would crush the
  // content, so we fall back to the previous vertical stack. We use the same
  // `useWindowDimensions` + `width < height` portrait idiom the mixer tab uses
  // (mixer.tsx), plus an absolute floor: below ~900px even a landscape phone is
  // too narrow to seat three readable columns, so it stacks too.
  const { width: winWidth, height: winHeight } = useWindowDimensions();
  const isPortrait = winWidth < winHeight;
  const isWide = !isPortrait && winWidth >= 900;
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
  const { planActive, leaseHeld, leaseRemainingSec, notifyInteraction, resumeNow } =
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
      setMixerView('deck');
      // Switch the MIDI controller to its Deck mapping context.
      setMidiActiveContext('deck');
      // Tab unmount cleanup: any in-flight swap is finalized by the
      // engine when we navigate away (the /mixer/view POST does that
      // server-side), so clear the local flag so the next mount starts
      // with the lock OFF instead of a stale in-flight assumption.
      return () => setDeckSwapInFlight(false);
    }, [])
  );

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
    } else if (msg.type === 'autopilot') {
      if (typeof msg.active === 'boolean') setPlaylistActive(msg.active);
      if (typeof msg.delay_s === 'string' && (msg.delay_s as string).length) {
        setPlaylistDelayStr(msg.delay_s as string);
      }
      if (typeof msg.shuffle === 'boolean') setIsShuffle(msg.shuffle);
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
      setColorAutopilot((prev) => ({
        active: typeof msg.active === 'boolean' ? msg.active : prev.active,
        palettes: Array.isArray(msg.palettes) ? (msg.palettes as string[]) : prev.palettes,
        delay_s: typeof msg.delay_s === 'number' ? msg.delay_s : prev.delay_s,
        shuffle: typeof msg.shuffle === 'boolean' ? msg.shuffle : prev.shuffle,
        transitionMs: typeof msg.transitionMs === 'number' ? msg.transitionMs : prev.transitionMs,
      }));
      // Next-palette-swap wall-clock ms (null when inactive) — mirrors the
      // pattern-autopilot countdown; re-broadcast on every color cycle, so it
      // ticks accurately under operator OR plan-cue drive.
      const nextColorSwap = (msg as { nextSwapAtMs?: unknown }).nextSwapAtMs;
      setColorNextSwapAtMs(typeof nextColorSwap === 'number' ? nextColorSwap : null);
    } else if (msg.type === 'deckSwapStarted') {
      setDeckSwapInFlight(true);
      const tm = (msg as unknown as { transitionMode?: string }).transitionMode;
      if (typeof tm === 'string') setLastSwapMode(tm);
    } else if (msg.type === 'deckSwapComplete') {
      setDeckSwapInFlight(false);
      const tm = (msg as unknown as { transitionMode?: string }).transitionMode;
      if (typeof tm === 'string') setLastSwapMode(tm);
    }
  }, []);

  const onStatus = useCallback((s: BusStatus) => {
    setIsConnected(!!s.connected);
    setConnectionError(s.connected ? '' : (s.lastError || ''));
  }, []);

  // Viz plane: master strip lives on the deck tab too.
  const onViz = useCallback((msg: EngineMessage) => {
    if (msg.type === 'vis') {
      visDataRef.current = (msg.vis as { [key: string]: string | null }) || {};
      const now = Date.now();
      if (now - lastVisUpdateRef.current > 200) {
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
      setColorAutopilot(caRes.data);
    }

    // Load initial deck channel state.
    const deckRes = await fetchDeckChannel();
    if (deckRes.ok && deckRes.data) {
      const ch = deckRes.data.channel || null;
      setDeckChannel(ch);
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
        Alert.alert(
          'Transition setting not applied',
          `The engine rejected the change. ${res.error || ''} Reverted to the previous value.`.trim(),
        );
      }
    }).catch((err) => {
      console.error('[Deck] Transition-config POST failed:', err);
      setDeckTxConfig((prev) => ({ ...prev, ...prevSnapshot }));
      Alert.alert('Transition setting not applied', `Could not reach the engine. ${err?.message || ''} Reverted.`.trim());
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
  const handleColorAutopilotChange = useCallback((patch: Partial<DeckColorAutopilotConfig>) => {
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
        Alert.alert(
          'Color autopilot not applied',
          `The engine rejected the change. ${res.error || ''} Reverted to the previous value.`.trim(),
        );
      }
    }).catch((err) => {
      console.error('[Deck] Color-autopilot POST failed:', err);
      setColorAutopilot((prev) => ({ ...prev, ...prevSnapshot }));
      Alert.alert('Color autopilot not applied', `Could not reach the engine. ${err?.message || ''} Reverted.`.trim());
    });
  }, [notifyInteraction]);

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
      Alert.alert(
        'Color not applied',
        `The engine rejected this color. ${res.error || ''} The deck kept its previous color.`.trim(),
      );
    }
  }, [deckChannel?.color, planGate]);

  // ── PANIC / HOME (docs/39 §6b #9) — mission-critical safe LIT reset ─────
  // Mirrors the mixer tab's PANIC tile (same panicMixer api + ConfirmSheet
  // gating). Previously the deck had NO panic, so recovery forced an
  // operator to switch to the mixer tab mid-emergency. It cancels in-flight
  // fades / transitions / deck swaps, clears blackout, brings the master up,
  // and recalls the `home` look (or a safe LIT default). The engine
  // broadcasts fresh state — every control on this tab reconciles from those.
  // Fail loud: a malformed/over-cap `home` is the ONE sanctioned loud
  // fallback (400, but the rig is STILL lit) and we Alert so the operator
  // knows while reassuring them the exterior stays lit.
  const [panicPrompt, setPanicPrompt] = useState(false);
  const [panicBusy, setPanicBusy] = useState(false);
  const confirmPanic = useCallback(async () => {
    setPanicPrompt(false);
    setPanicBusy(true);
    try {
      const res = await panicMixer(true);
      if (!res.ok) {
        console.error('[Deck] Panic reported a loud fallback:', res.error, res.data);
        const rigLit = (res.data as any)?.rigLit === true;
        Alert.alert(
          'Panic — home look not loaded',
          `${res.error || 'The "home" snapshot could not be recalled.'} `
            + (rigLit
              ? 'The rig is still LIT (blackout cleared, master up).'
              : 'Check the engine and re-run panic.'),
        );
      }
    } catch (err: any) {
      console.error('[Deck] Panic request failed:', err);
      Alert.alert('Panic failed', `Could not reach the engine. ${err?.message || ''}`.trim());
    } finally {
      setPanicBusy(false);
    }
  }, []);

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
    <View style={{ flex: 1, backgroundColor: C.background }}>
      {/* Soft PLAN lock banner — low-key YELLOW, non-blocking (box-none), only
          mounts when controlLock === 'plan'. Navigation/viewing stay live; the
          deck's pattern selection is the only thing disabled (below). The full
          red portwatch lockout stays in the tab layout. */}
      <PlanLockBanner />
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
          floating PlanLockBanner (above, zIndex 1000) and the bottom safety
          bar (PANIC/BLACKOUT, a sibling BELOW this wrapper) stay OUTSIDE the
          scrim so emergency recovery is never locked behind a takeover. */}
      <View style={{ flex: 1, position: 'relative' }}>
      <DeckTopBar isConnected={isConnected} disabled={planGate} />
      <CPCControls disabled={planGate} />
      {/* ── Channel Preview Visualization ───────────────────────────── */}
      <View style={{ paddingHorizontal: 16, paddingTop: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4, minHeight: 44 }}>
          {/* QA round8 #7: the solid bar below read ambiguously. Label it
              like the mixer's "MASTER OUTPUT" convention so it's clear this
              strip is the deck's live output preview. */}
          <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 9, letterSpacing: 1.5, textTransform: 'uppercase', color: C.icon }}>
            DECK MAIN · LIVE OUTPUT
          </Text>
          <View style={{ flex: 1 }} />
          {/* ── Plan-active lock indicator ──────────────────────────────────
              When a plan is live the deck's mutating controls are fully frozen
              (pointerEvents 'none' + dim, below) — a tap does NOTHING, so the
              old "A TOUCH TAKES OVER" copy was a lie under the full freeze the
              operator requested. This SUBTLE inline chip just states the truth:
              controls are LOCKED. To edit, use DISABLE PLAN in the amber banner
              (pauses the plan) or take over from the MIXER's TAKE-OVER prompt.
              While a lease IS held (taken over via that prompt) it becomes the
              "plan resumes in M:SS" countdown + a one-tap RESUME affordance. */}
          {planActive && !leaseHeld ? (
            <View style={{
              flexDirection: 'row', alignItems: 'center', gap: 6,
              paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6,
              borderWidth: 1, borderColor: PLAN_INDICATOR_CYAN,
            }}>
              <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 9, letterSpacing: 0.6, color: PLAN_INDICATOR_CYAN, textTransform: 'uppercase' }}>
                PLAN LIVE · CONTROLS LOCKED
              </Text>
            </View>
          ) : leaseHeld ? (
            <View style={{
              flexDirection: 'row', alignItems: 'center', gap: 8,
              paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6,
              borderWidth: 1, borderColor: '#f5a623',
            }}>
              <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 9, letterSpacing: 0.6, color: '#f5a623', textTransform: 'uppercase' }}>
                {`TOOK OVER · PLAN RESUMES ${leaseRemainingSec === null ? '—' : `${Math.floor(leaseRemainingSec / 60)}:${String(leaseRemainingSec % 60).padStart(2, '0')}`}`}
              </Text>
              <TouchableOpacity
                onPress={() => { void resumeNow(); }}
                hitSlop={ICON_BTN_HIT_SLOP}
                accessibilityRole="button"
                accessibilityLabel="Resume the plan now"
              >
                <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 9, letterSpacing: 0.6, color: '#f5a623', textTransform: 'uppercase' }}>
                  RESUME NOW
                </Text>
              </TouchableOpacity>
            </View>
          ) : null}
          {/* Compact plan-status glyph — RIGHTMOST in the globals row (request
              #5). Matches the OscStatusPill idiom (48px tile, coloured
              border/dot/label). Tapping routes to the Timeline tab. */}
          <PlanIndicatorPill />
        </View>
        {/* "LIVE OUTPUT" preview = the engine's `preDimmer` composite — the
            composition AFTER global FX (hue shift / invert / group color-locks)
            but BEFORE the section dimmer rack + blackout (operator request
            2026-06-29). So the deck preview (a) recolors with the GlobalHueRow
            and shows the global effects, while (b) still ignoring the section
            dimmer-rack trim — it shows what the SHOW is producing, not the
            dimmed-down hardware output. The section dimmers are still applied to
            the actual sACN/DMX output — this is preview-only. The mixer master
            strip uses the same `preDimmer` key for parity. */}
        <PixelStrip base64Data={visDataRef.current.preDimmer ?? null} height={18} style={{ borderRadius: 6 }} />
      </View>
      {/* ── 3-COLUMN deck layout (operator request June 2026) ───────────────
          On wide surfaces (iPad landscape / web) the deck is three side-by-side
          columns — PATTERNS | PARAMETERS | AUTOPILOT & SETTINGS — each
          independently scrollable so tall content (the param list, the palette
          panel) never gets cut off. On narrow widths (`!isWide`) the row wraps
          back to a single vertical stack (the previous behavior) so nothing is
          crushed in portrait. `globalStyles.container` is `flexDirection:'row',
          flex:1` already; we widen it to wrap on narrow so the columns stack.
          Column flex weights: PATTERNS 1.1 / PARAMETERS 1 / SETTINGS 1.2 — the
          pattern grid and the settings stack are a touch wider than the params
          column to seat their wider controls (pill bars, palette swatches). */}
      <View style={[globalStyles.container, !isWide && { flexDirection: 'column' }]}>
        {/* ── COLUMN 1 — PATTERNS ──────────────────────────────────────────
            The one-and-only pattern list (active playlist) + the global rig HUE
            shifter pinned above it. DECK MAIN's live preview strip stays in the
            header above (it is the deck's master output, not a per-column item).
            Padding is tightened from the default leftPane (24) so the playlist
            gets more vertical room. GLOBAL EFFECTS lives in the full-width
            bottom bar below (mirrors the mixer tab). The playlist shows ≥5
            entries on 11" iPad landscape; REFRESH/RECONNECT is the header ↻
            icon (PlaylistPanel `onRefreshConnection`). */}
        <View style={[
          globalStyles.leftPane,
          { padding: 14, gap: 8 },
          // Wide: this column flexes to ~1.1 of the row. Narrow (stacked): the
          // leftPane's default flex:1 inside a column container would let it
          // eat all vertical space — pin a sensible min height instead so the
          // stack scrolls naturally with the columns below it.
          isWide ? { flex: 1.1 } : { flex: 0, minHeight: 320 },
        ]}>
          {isConnected === false && <OfflineBanner error={connectionError} />}

          {/* THE pattern list = the active playlist for the deck.
              No duplicate "all patterns" list — tap + on the panel to pick from the
              full library and add it as a new entry. */}
          {deckChannelId ? (
            <View key={deckChannelId} style={{ flex: 1, minHeight: 0 }}>
              {/* Global rig HUE shifter, pinned to the TOP of the deck's
                  pattern list (operator request June 2026). The deck's
                  GLOBAL EFFECTS strip (mixer-strip variant, bottom bar) has
                  no room for a hue row, so the global hue control lives here
                  — mirroring how the MIXER shows a compact HUE row above each
                  channel's playlist. Self-contained wiring (own state, seed,
                  WS reconcile, POST) so it's the deck's ONE-AND-ONLY hue
                  control; the bottom effects bar stays hue-less. Gated under
                  the soft PLAN lock like every other mutating deck control. */}
              <GlobalHueRow disabled={planGate} />
              <PlaylistPanel
                channelId={deckChannelId}
                role="deck"
                channelLabel="DECK MAIN"
                locked={!!deckChannel?.locked}
                initialAssignment={deckChannel?.playlist || null}
                // During a deck pattern soft-swap we grey out the list +
                // disable taps. The engine also rejects taps server-side
                // with 409 — this is just the UX layer of the contract.
                // ALSO disabled under the soft PLAN lock (planGate): pattern
                // selection changes "what's playing", which the plan owns until
                // the operator takes over. The greyed/disabled list IS the
                // "take over to change" affordance — taking over (any control
                // touch fires the takeover lease) clears planGate and re-enables
                // it.
                disabled={deckSwapInFlight || planGate}
                onRefreshConnection={connectToEngine}
                playlistLibrary={playlistLibrary}
              />
            </View>
          ) : (
            <Text style={{ color: C.secondary, fontStyle: 'italic' }}>
              Waiting for deck…
            </Text>
          )}
        </View>

        {/* ── COLUMN 2 — PARAMETERS ────────────────────────────────────────
            ONLY the deck's (local) parameter controls — the DECK MAIN channel
            card: entry-label editor, SAVED flash, color swatch, ◎ ALL
            modulations trigger, the PARAMETERS slider stack (GlobalParams), and
            the toggle/trigger button grid. This used to sit BELOW the settings
            stack in the old single right-pane scroll; it now stands alone in
            the middle column, independently scrollable. */}
        <View style={[
          { padding: 0 },
          isWide ? { flex: 1 } : { flex: 0 },
        ]}>
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 80 }} showsVerticalScrollIndicator={false}>
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
                      { width: '100%', backgroundColor: C.surfaceContainerLowest, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: C.ghostBorder },
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
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <View style={{ flex: 1 }}>
                        {/* Renaming the active playlist entry: tap the title and type.
                            Auto-saves on blur; the PlaylistPanel listens for the same
                            `playlistSaved` broadcast and flashes its ✓ SAVED toast. */}
                        <EntryLabelEditor
                          channelId={channel.id}
                          channelLabel={channelTitle}
                          locked={!!channel.locked}
                        />
                      </View>
                      {/* SAVED flash moved up here from inside GlobalParams
                          so it never reflows the slider stack. The component
                          always reserves the same width/height — the inner
                          pill only fades in/out. */}
                      <DeckSavedFlash deckChannelId={channel.id} />
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
                        style={{
                          paddingHorizontal: 12, borderRadius: 6,
                          minHeight: 44, minWidth: 44,
                          alignItems: 'center', justifyContent: 'center',
                          borderWidth: 1, borderColor: '#00a86b',
                          backgroundColor: 'transparent',
                          opacity: channel.playlist?.name ? 1 : 0.4,
                        }}
                      >
                        <Text style={{
                          fontFamily: 'SpaceGrotesk_700Bold', fontSize: 11,
                          color: '#00a86b', letterSpacing: 0.5,
                        }}>
                          ◎ ALL
                        </Text>
                      </TouchableOpacity>
                    </View>

                    {/* QA round8 #3: the PARAMETERS section spent ~32px of
                        chrome (16 label margin + 16 section margin) on a single
                        slider. Tightened both to 6 so the header rides compactly
                        — mirrors the AUTOPILOT card's tight header pattern. */}
                    <View style={{ marginBottom: 6 }}>
                      <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10, color: C.secondary, marginBottom: 6, textTransform: 'uppercase' }}>PARAMETERS</Text>
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
          </ScrollView>
        </View>

        {/* ── COLUMN 3 — AUTOPILOT & SETTINGS ──────────────────────────────
            The deck-settings stack that used to sit ABOVE the local parameters:
            AUTOPILOT (pattern playlist cycler + pattern-group locality),
            COLOR AUTOPILOT (palette cycler), DECK TRANSITIONS, and the DECK
            DYNAMIC VIEW OVERRIDES stack. Independently scrollable. */}
        <View style={[
          { padding: 0 },
          isWide ? { flex: 1.2 } : { flex: 0 },
        ]}>
          {/* Padding tightened from 48 → 16 (QA round8 #1): the old 48px
              gutter plus the cards' inner paddingRight:24 wasted ~72px of the
              column's width, forcing the AUTOPILOT / OVERLAYS pill bars
              into horizontal scroll. paddingBottom keeps the last card clear
              of the bottom GLOBAL EFFECTS bar (its intrinsic height ~58px). */}
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 80 }} showsVerticalScrollIndicator={false}>
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

            {/* ── DECK DYNAMIC VIEW OVERRIDES (engine #deck-overlays) ──────
                View-scoped overlay decks layered OVER the main deck. Each
                overlay is a CLEAN, self-contained, color-tagged card that
                collapses to a one-line header and expands on tap; a single
                shared header drives the unison auto-cycle cadence for the
                whole group, and a "+ ADD OVERLAY" affordance (hidden at the
                4-overlay cap) opens a view + playlist picker. Reads the
                overlay list + shared autopilot off the same `deck` WS message
                this tab already consumes; PlaylistPanel (role="deckOverlay")
                drives each overlay's playlist. */}
            <DeckOverlayStack
              overlays={deckOverlays}
              overlayAutopilot={overlayAutopilot}
              playlistLibrary={playlistLibrary}
              // Disabled while offline OR under the soft PLAN lock (planGate):
              // overlay add/auto/shuffle/timer/per-overlay controls all change
              // what's playing, which the plan owns until the operator takes
              // over.
              disabled={isConnected === false || planGate}
            />
          </ScrollView>
        </View>
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
          intrinsic-height so it never overlaps or gets cut off. The PANIC
          (safe-lit recovery) tile mirrors the mixer's bottom-bar PANIC so an
          operator never has to switch tabs mid-emergency (QA round8 #2). The
          HUE shifter is omitted by the strip variant itself (it has its
          own deck-grid placement) — see GlobalEffectMacros `mixer-strip`. */}
      <View style={[styles.globalRigBar, { backgroundColor: C.surfaceContainerLow, borderTopColor: C.ghostBorder }]}>
        {/* PANIC / HOME (docs/39 §6b #9) — same panicMixer handler + ConfirmSheet
            gating as the mixer tab. Distinct AMBER so it reads as the rig's "get
            me back to safe" button, visually separate from the GEM grid + the
            e-stop BLACKOUT inside it. */}
        <TouchableOpacity
          style={[styles.panicBtn, panicBusy && { opacity: 0.5 }]}
          onPress={() => setPanicPrompt(true)}
          disabled={panicBusy}
          accessibilityRole="button"
          accessibilityLabel="Panic — reset rig to a safe lit state"
          accessibilityState={{ disabled: panicBusy }}
        >
          <Text style={styles.panicBtnText}>{panicBusy ? 'PANIC…' : 'PANIC'}</Text>
          <Text style={styles.panicBtnHint}>HOME / SAFE LIT</Text>
        </TouchableOpacity>
        <RigGlobals variant="mixer" />
      </View>
      {/* ── Panic / Home confirmation (docs/39 §6b #9) ──────────────── */}
      <ConfirmSheet
        visible={panicPrompt}
        title="Panic to safe state?"
        message={'Resets the rig to a safe LIT state: cancels in-flight fades, transitions and deck swaps, clears solo, un-mutes groups, brings the master up, and clears blackout. Recalls the "home" look if one is saved, otherwise a safe default. The exterior stays lit throughout.'}
        confirmLabel="PANIC"
        cancelLabel="CANCEL"
        onConfirm={confirmPanic}
        onCancel={() => setPanicPrompt(false)}
      />
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
      <Modal transparent visible={showColorPicker} animationType="fade" onRequestClose={() => setShowColorPicker(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowColorPicker(false)}>
          <TouchableOpacity activeOpacity={1} onPress={() => {}}>
            <View style={[styles.modalContent, { backgroundColor: C.surfaceContainerHigh, borderColor: C.ghostBorder }]}>
              <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10, letterSpacing: 1.2, color: C.secondary, textTransform: 'uppercase', marginBottom: 12 }}>DECK COLOR</Text>
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
    paddingHorizontal: 12,
    paddingTop: 4,
    paddingBottom: 6,
    borderTopWidth: 1,
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  // PANIC / HOME (docs/39 §6b #9) — deck mirror of the mixer tab's panicBtn.
  // AMBER literals (matched to mixer.tsx) so it reads as the rig's
  // mission-critical "back to safe" action, distinct from the teal GEM grid
  // and the red BLACKOUT e-stop inside it. Pinned at the left of the bottom
  // bar where the operator's thumb can find it. Min 44pt touch target.
  panicBtn: {
    minWidth: 96,
    minHeight: 52,
    paddingHorizontal: 14,
    marginRight: 10,
    borderRadius: 8,
    backgroundColor: 'rgba(245,166,35,0.18)',
    borderWidth: 1.5,
    borderColor: '#F5A623',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'stretch',
  },
  panicBtnText: {
    fontFamily: 'SpaceGrotesk_700Bold',
    fontSize: 14,
    letterSpacing: 1.2,
    color: '#F5A623',
  },
  panicBtnHint: {
    fontFamily: 'SpaceGrotesk_700Bold',
    fontSize: 8,
    letterSpacing: 0.6,
    color: '#F5A623',
    opacity: 0.8,
    marginTop: 1,
  },
  deckSwatchBtn: {
    width: 44, height: 44, borderRadius: 8,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalContent: {
    borderRadius: 12,
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
    width: 44, height: 44, borderRadius: 10,
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
    borderRadius: 8,
    borderWidth: 1,
  },
});
