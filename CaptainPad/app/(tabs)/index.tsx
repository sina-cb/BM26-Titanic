import React, { useState, useRef, useCallback } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Alert, Modal, StyleSheet } from 'react-native';
import { useGlobalStyles } from '@/styles/globalStyles';
import { usePalette } from '@/hooks/use-theme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { HorizontalFader } from '@/components/ui/HorizontalFader';
import { RigGlobals } from '@/components/RigGlobals';
import { GlobalParams, DeckSavedFlash } from '@/components/GlobalParams';
import { CPCControls } from '@/components/CPCControls';
import { DeckTopBar } from '@/components/DeckTopBar';
import { PlaylistPanel } from '@/components/PlaylistPanel';
import { EntryLabelEditor } from '@/components/EntryLabelEditor';
import { PixelStrip } from '@/components/ui/PixelStrip';
import { AutopilotTimerPills, DeckTransitionControls } from '@/components/DeckTransitionControls';
import { AllModulationsPanel } from '@/components/AllModulationsPanel';
import { useFocusEffect } from 'expo-router';
import {
  getAutopilot, setAutopilot,
  fetchDeckChannel, setDeckChannelControl,
  setMixerView,
  fetchDeckTransitionConfig, setDeckTransitionConfig,
  fetchPlaylists,
  type DeckTransitionConfig,
} from '@/utils/api';
import { setChannelFaderMax, setChannelColor } from '@/utils/channelExtrasApi';
import { useEngineConnection } from '@/hooks/useEngineConnection';
import type { EngineMessage, BusStatus } from '@/utils/engineEvents';

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

  // Autopilot state (cycles through the active playlist on a timer)
  const [isPlaylistActive, setPlaylistActive] = useState<boolean>(false);
  const [playlistDelayStr, setPlaylistDelayStr] = useState<string>('30');
  const [isShuffle, setIsShuffle] = useState<boolean>(false);

  // Deck transition config (soft swap between patterns via server-side
  // double-buffer — see DECK TRANSITIONS in DeckTransitionControls.tsx
  // and triggerDeckPatternSwap in marsin_engine/lib/pattern_mixer.js).
  const [deckTxConfig, setDeckTxConfig] = useState<DeckTransitionConfig>({
    enabled: false,
    mode: 'trans_crossfade',
    durationMs: 1000,
    shuffle: false,
  });

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
    } else if (msg.type === 'autopilot') {
      if (typeof msg.active === 'boolean') setPlaylistActive(msg.active);
      if (typeof msg.delay_s === 'string' && (msg.delay_s as string).length) {
        setPlaylistDelayStr(msg.delay_s as string);
      }
      if (typeof msg.shuffle === 'boolean') setIsShuffle(msg.shuffle);
    } else if (msg.type === 'deckTransitionConfig') {
      setDeckTxConfig((prev) => ({
        enabled: typeof msg.enabled === 'boolean' ? msg.enabled : prev.enabled,
        mode: typeof msg.mode === 'string' ? msg.mode : prev.mode,
        durationMs: typeof msg.durationMs === 'number' ? msg.durationMs : prev.durationMs,
        shuffle: typeof msg.shuffle === 'boolean' ? msg.shuffle : prev.shuffle,
      }));
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

    // Load deck transition config
    const dtRes = await fetchDeckTransitionConfig();
    if (dtRes.ok && dtRes.data) {
      setDeckTxConfig(dtRes.data);
    }

    // Load initial deck channel state.
    const deckRes = await fetchDeckChannel();
    if (deckRes.ok && deckRes.data) {
      setDeckChannel(deckRes.data.channel || null);
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
  }, []);

  // Per-channel intensity clamp (faderMax, docs/39 §8.3) on the DECK channel.
  // A hard ceiling on the deck's OWN contribution — the level fader and
  // scripted transitions can ride up to this ceiling but never above it
  // (effectiveFader = min(fader, faderMax)). WAVE 5 pattern: optimistic local
  // apply + PATCH /deck/channel (via setChannelFaderMax {deck:true}), then the
  // engine's `deck` WS broadcast reconciles canonical state (onControl above).
  // Fail loud (Codex P0): a rejected ceiling reverts locally + Alerts; the
  // next deck broadcast re-syncs too. Validated by the engine identically to a
  // fader (finite, clamped to [0,1]; non-finite ⇒ 400).
  const handleDeckFaderMax = useCallback(async (channelId: string, faderMax: number) => {
    const prev = deckChannel?.faderMax;
    setDeckChannel((c: any) => (c ? { ...c, faderMax } : c));
    const res = await setChannelFaderMax(channelId, faderMax, { deck: true });
    if (!res.ok) {
      console.error(`[Deck] faderMax change rejected for ${channelId}:`, res.error);
      setDeckChannel((c: any) => (c ? { ...c, faderMax: prev ?? 1.0 } : c));
      Alert.alert(
        'Intensity ceiling not applied',
        `The engine rejected this ceiling. ${res.error || ''} The deck kept its previous limit.`.trim(),
      );
    }
  }, [deckChannel?.faderMax]);

  // Per-channel color metadata (docs/39 §8.4) on the DECK channel. Pure
  // operator-facing accent (no render effect) — tints the deck card for
  // at-a-glance identification, matching the mixer strips. Same optimistic +
  // reconcile + fail-loud shape; a null color clears the accent and the engine
  // requires a string or null.
  const handleDeckColor = useCallback(async (channelId: string, color: string | null) => {
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
  }, [deckChannel?.color]);

  const triggerChannelControl = (_channelId: string, id: number, v0: number, v1?: number, v2?: number) => {
    // Deck tab only ever writes to the deck channel — there's a single
    // dedicated route for that now. We ignore the channelId arg (kept
    // for API compatibility with the previous mixer-routed call).
    setDeckChannelControl(id, v0, v1, v2);
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.background }}>
      {/* Top bar: title + connection status + master fader. Matches the
          Marsin Mixer header layout, minus channel-add buttons. */}
      <DeckTopBar isConnected={isConnected} />
      <CPCControls />
      {/* ── Channel Preview Visualization ───────────────────────────── */}
      <View style={{ paddingHorizontal: 16, paddingTop: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 9, letterSpacing: 1.5, textTransform: 'uppercase', color: C.icon }}>
            DECK MAIN
          </Text>
        </View>
        <PixelStrip base64Data={visDataRef.current[deckChannelId || 'master']} height={18} style={{ borderRadius: 6 }} />
      </View>
      <View style={globalStyles.container}>
        {/* Left Pane — Playlist (the one and only pattern list).
            Padding is tightened from the default leftPane (24) so the
            playlist + Rig globals strip get more vertical room. The
            playlist now shows ≥5 entries on 11" iPad landscape and the
            REFRESH/RECONNECT button moved INTO the playlist header
            (top-right ↻ icon, see PlaylistPanel `onRefreshConnection`)
            so the old full-width button below the list is gone. */}
        <View style={[globalStyles.leftPane, { padding: 14, gap: 8 }]}>
          {isConnected === false && <OfflineBanner error={connectionError} />}

          {/* THE pattern list = the active playlist for the deck.
              No duplicate "all patterns" list — tap + on the panel to pick from the
              full library and add it as a new entry. */}
          {deckChannelId ? (
            <View key={deckChannelId} style={{ flex: 1, minHeight: 0 }}>
              <PlaylistPanel
                channelId={deckChannelId}
                role="deck"
                channelLabel="DECK MAIN"
                locked={!!deckChannel?.locked}
                initialAssignment={deckChannel?.playlist || null}
                // During a deck pattern soft-swap we grey out the list +
                // disable taps. The engine also rejects taps server-side
                // with 409 — this is just the UX layer of the contract.
                disabled={deckSwapInFlight}
                onRefreshConnection={connectToEngine}
                playlistLibrary={playlistLibrary}
              />
            </View>
          ) : (
            <Text style={{ color: C.secondary, fontStyle: 'italic' }}>
              Waiting for deck…
            </Text>
          )}

          <RigGlobals />
        </View>

        {/* Right Pane - Parameters & Macros (autopilot + channel exports) */}
        <View style={[globalStyles.rightPane, { padding: 0 }]}>
          <ScrollView contentContainerStyle={{ padding: 48, paddingBottom: 96 }} showsVerticalScrollIndicator={false}>
            {/* Offline Banner (right pane) */}
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
                10pt / 1.2 tracking / secondary / uppercase). */}
            <View style={{ marginBottom: 12, paddingHorizontal: 8, paddingTop: 6, paddingBottom: 8, borderRadius: 8, backgroundColor: C.surfaceContainerHigh, ...globalStyles.ghostBorder, gap: 6 }}>
              {/* Header sits on the SAME row as PLAY/PAUSE + SHUFFLE so it
                  costs zero extra vertical height — the label rides the
                  baseline of the tallest control next to it. */}
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 }}>
                  <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10, letterSpacing: 1.2, color: C.secondary, textTransform: 'uppercase' }}>AUTOPILOT</Text>
                  <TouchableOpacity
                    onPress={() => { const nx = !isPlaylistActive; setPlaylistActive(nx); setAutopilot(nx, playlistDelayStr, isShuffle); }}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: isPlaylistActive ? C.primary : 'transparent', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 6, borderWidth: 1, borderColor: isPlaylistActive ? 'transparent' : C.ghostBorder }}
                  >
                    <IconSymbol name={isPlaylistActive ? "pause.fill" : "play.fill"} size={16} color={isPlaylistActive ? "#FFF" : C.text} />
                    <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: isPlaylistActive ? "#FFF" : C.text, fontSize: 12 }}>
                      {isPlaylistActive ? 'PAUSE' : 'PLAY'}
                    </Text>
                  </TouchableOpacity>
                </View>

                <TouchableOpacity
                  onPress={() => { const nx = !isShuffle; setIsShuffle(nx); setAutopilot(isPlaylistActive, playlistDelayStr, nx); }}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 8, paddingVertical: 8 }}
                  accessibilityRole="switch"
                  accessibilityLabel={isShuffle ? 'Disable autopilot shuffle' : 'Enable autopilot shuffle'}
                >
                  <IconSymbol name="shuffle" size={16} color={isShuffle ? C.primary : C.icon} />
                  <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: isShuffle ? C.primary : C.icon, fontSize: 12, letterSpacing: 0.5 }}>SHUFFLE</Text>
                </TouchableOpacity>
              </View>

              {/* Row 2: timer pill-bar */}
              <AutopilotTimerPills
                value={parseInt(playlistDelayStr, 10) || 30}
                onChange={(v) => {
                  const str = String(v);
                  setPlaylistDelayStr(str);
                  setAutopilot(isPlaylistActive, str, isShuffle);
                }}
              />
            </View>

            {/* ── DECK TRANSITIONS ───────────────────────────────────
                Soft-swap pattern changes via the engine's hidden deck
                shadow channel (see triggerDeckPatternSwap in the engine
                mixer). Independent of AUTOPILOT — playlist auto-cycling
                and per-tap entry swaps BOTH route through this when
                enabled. */}
            <DeckTransitionControls
              enabled={deckTxConfig.enabled}
              // When shuffle is on, show the actually-rolled style from
              // the engine's most-recent broadcast instead of the
              // operator's pre-shuffle pick (which the engine ignores
              // in shuffle mode anyway). Falls back to the config mode
              // before any swap has happened.
              mode={deckTxConfig.shuffle && lastSwapMode ? lastSwapMode : deckTxConfig.mode}
              durationMs={deckTxConfig.durationMs}
              shuffle={deckTxConfig.shuffle}
              onChange={handleDeckTxChange}
            />

            {/* Channel parameters for the deck (base) channel. The deck is
                hard-wired to the base channel; CaptainPad's MIXER tab is
                where multi-channel routing lives. */}
            <View style={{ gap: 24, paddingRight: 24 }}>
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
                  <View key={channel.id} style={[
                    { width: '100%', backgroundColor: C.surfaceContainerLowest, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: C.ghostBorder },
                    // Color accent (docs/39 §8.4): tint the card's left edge so
                    // the operator can identify the deck at a glance — mirrors the
                    // mixer strip. The lock border still wins (operator-critical
                    // state); only paint the accent when the deck isn't locked.
                    // No layout shift when color is null (defaults to ghostBorder
                    // at the same 1px width).
                    !channel.locked && channel.color ? { borderColor: channel.color, borderLeftWidth: 4 } : null,
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

                    <View style={{ marginBottom: 16 }}>
                      <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10, color: C.secondary, marginBottom: 16, textTransform: 'uppercase' }}>PARAMETERS</Text>
                      <GlobalParams variant="deck" channelId={channel.id} exports={exports} />
                    </View>

                    {/* Intensity ceiling (faderMax, docs/39 §8.3). A hard cap on
                        the deck channel's OWN contribution — the level fader (on
                        DeckTopBar) and scripted transitions can ride up to this
                        ceiling but never above it. faderMax defaults to 1.0;
                        faderMax=0 fully suppresses the deck. Disabled while the
                        deck is locked (matches the mixer CAP lock behaviour). The
                        cap slider's fill is amber to distinguish it from a level
                        fader. Mirrors the mixer strip's CAP row. */}
                    <View style={[styles.capRow, { borderBottomColor: C.ghostBorder }]}>
                      <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10, letterSpacing: 1.2, color: C.secondary, textTransform: 'uppercase', width: 36 }}>CAP</Text>
                      <HorizontalFader
                        value={channel.faderMax ?? 1}
                        onChange={(v: number) => { if (!channel.locked) handleDeckFaderMax(channel.id, v); }}
                        trackStyle={[styles.faderTrack, { backgroundColor: C.surfaceContainerHigh, flex: 1, marginHorizontal: 6, opacity: channel.locked ? 0.5 : 1 }]}
                        fillStyle={styles.capFill}
                      />
                      <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 13, color: '#F5A623', width: 32, textAlign: 'right' }}>
                        {Math.round((channel.faderMax ?? 1) * 100)}
                      </Text>
                    </View>

                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginTop: 16, gap: 8 }}>
                      {toggles.map((e: any) => (
                        <ToggleButton key={`toggle-${e.id}`} id={e.id} name={e.name} initialValue={e.v0 ?? 0} onChange={(id: number, v: number) => triggerChannelControl(channel.id, id, v)} />
                      ))}
                      {triggers.map((e: any) => (
                        <MomentaryButton key={`trigger-${e.id}`} id={e.id} name={e.name} onChange={(id: number, v: number) => triggerChannelControl(channel.id, id, v)} />
                      ))}
                    </View>
                  </View>
                );
              })}
            </View>
          </ScrollView>
        </View>
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

// Local styles mirror the mixer strip's CAP row + color-picker recipe (docs/39
// §8.3/§8.4). Palette-dependent colors are applied inline at the call site
// (this screen reads the palette via the usePalette hook, not a StyleSheet
// factory), keeping these to layout + the fixed amber cap fill.
const styles = StyleSheet.create({
  deckSwatchBtn: {
    width: 44, height: 44, borderRadius: 8,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1,
  },
  capRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    marginBottom: 16,
  },
  faderTrack: {
    height: 16,
    borderRadius: 4,
  },
  capFill: {
    position: 'absolute',
    left: 0, top: 0, bottom: 0,
    backgroundColor: '#F5A623',
    borderRadius: 4,
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
