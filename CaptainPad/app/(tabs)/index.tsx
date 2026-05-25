import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, TouchableOpacity, ScrollView, AppState } from 'react-native';
import { globalStyles } from '@/styles/globalStyles';
import { Colors } from '@/constants/theme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { RigGlobals } from '@/components/RigGlobals';
import { GlobalParams } from '@/components/GlobalParams';
import { CPCControls } from '@/components/CPCControls';
import { DeckTopBar } from '@/components/DeckTopBar';
import { PlaylistPanel } from '@/components/PlaylistPanel';
import { EntryLabelEditor } from '@/components/EntryLabelEditor';
import { PixelStrip } from '@/components/ui/PixelStrip';
import { AutopilotTimerPills, DeckTransitionControls } from '@/components/DeckTransitionControls';
import { useFocusEffect } from 'expo-router';
import {
  getApiBaseAsync,
  getAutopilot, setAutopilot, testConnection,
  fetchDeckChannel, setDeckChannelControl,
  setMixerView,
  fetchDeckTransitionConfig, setDeckTransitionConfig,
  type DeckTransitionConfig,
} from '@/utils/api';
import { engineControlBus, engineVizBus, isControlConnected } from '@/utils/engineBus';

// ── Global Effect Button moved to RigGlobals ────────────────────────────

const ToggleButton = ({ id, name, initialValue = 0, onChange }: { id: number, name: string, initialValue?: number, onChange: Function }) => {
  const [isOn, setIsOn] = React.useState(initialValue > 0.5);
  React.useEffect(() => { setIsOn(initialValue > 0.5) }, [initialValue]);
  return (
    <TouchableOpacity 
      onPress={() => { const next = !isOn; setIsOn(next); onChange(id, next ? 1.0 : 0.0); }}
      style={[
        globalStyles.macroButton, 
        { flexBasis: '30%' }, 
        isOn ? { backgroundColor: Colors.light.primary, borderColor: Colors.light.primary } : {}
      ]}
    >
      <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 12, color: isOn ? '#fff' : Colors.light.text, textAlign: 'center' }}>
        {name.replace(/toggle|trigger/i, '').substring(0, 10).toUpperCase()}
      </Text>
    </TouchableOpacity>
  );
};

const MomentaryButton = ({ id, name, onChange }: { id: number, name: string, onChange: Function }) => {
  const [isPressed, setIsPressed] = React.useState(false);
  return (
    <TouchableOpacity 
      onPressIn={() => { setIsPressed(true); onChange(id, 1.0); }}
      onPressOut={() => { setIsPressed(false); onChange(id, 0.0); }}
      activeOpacity={1}
      style={[
        globalStyles.macroButton, 
        { flexBasis: '30%' }, 
        isPressed ? { backgroundColor: Colors.light.error, borderColor: Colors.light.error } : {}
      ]}
    >
      <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 12, color: isPressed ? '#fff' : Colors.light.text, textAlign: 'center' }}>
        {name.replace(/toggle|trigger/i, '').substring(0, 10).toUpperCase()}
      </Text>
    </TouchableOpacity>
  );
};

// ── Connection Status Banner ────────────────────────────────────────────
const OfflineBanner = ({ error }: { error: string }) => (
  <View style={{ 
    backgroundColor: 'rgba(186, 26, 26, 0.12)', 
    borderColor: Colors.light.error, 
    borderWidth: 1, 
    borderRadius: 12, 
    padding: 16, 
    marginBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12
  }}>
    <IconSymbol name="wifi.slash" size={24} color={Colors.light.error} />
    <View style={{ flex: 1 }}>
      <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: Colors.light.error, fontSize: 14 }}>
        ENGINE OFFLINE
      </Text>
      <Text style={{ fontFamily: 'Inter_400Regular', color: Colors.light.error, fontSize: 12, marginTop: 4 }}>
        {error || 'Cannot reach MarsinEngine. Check Config tab for IP settings.'}
      </Text>
    </View>
  </View>
);

export default function ControlDeckScreen() {
  const [deckChannel, setDeckChannel] = useState<any | null>(null);
  const [isConnected, setIsConnected] = useState<boolean | null>(null);
  const [connectionError, setConnectionError] = useState<string>('');

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

  const apiBaseRef = useRef<string>('');
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

  // The WS lifecycle now lives on the app-level engineBus (one
  // singleton socket per engine topic, opened by RigGlobals at boot).
  // This tab just subscribes to the two topics it actually cares
  // about: /ws/control for state events and /ws/viz for the deck's
  // preview strip. The audio analyser's /ws/signals and /ws/params
  // are intentionally NOT subscribed here — the deck doesn't render
  // any audio meters and shouldn't pay for parsing those frames.
  useEffect(() => {
    const unsubControl = engineControlBus.subscribe((msg) => {
      // Defensive: legacy engineEvents.emit was the broadcast catchall
      // here, but engineBus already mirrors into engineEvents itself.
      // No second emit needed — that would double-fire every consumer.
      if (msg.type === 'deck') {
        // The deck channel arrives on its own event (post channel
        // split) — see `serializeDeckState` in
        // marsin_engine/lib/api_server.js. The mixer event is
        // explicitly ignored by the deck tab; it carries overlay
        // channels that the deck doesn't render.
        setDeckChannel((msg as any).channel || null);
      } else if (msg.type === 'autopilot') {
        // The engine broadcasts every autopilot transition (so any
        // writer — this UI, PortWatch over LoRa, an HTTP script —
        // ends up rendered the same way). Mirror it into local state
        // so the toggle/picker on this tab tracks remote flips
        // without having to re-fetch on a timer.
        const m = msg as any;
        if (typeof m.active === 'boolean') setPlaylistActive(m.active);
        if (typeof m.delay_s === 'string' && m.delay_s.length) {
          setPlaylistDelayStr(m.delay_s);
        }
        if (typeof m.shuffle === 'boolean') setIsShuffle(m.shuffle);
      } else if (msg.type === 'deckTransitionConfig') {
        const m = msg as any;
        setDeckTxConfig((prev) => ({
          enabled: typeof m.enabled === 'boolean' ? m.enabled : prev.enabled,
          mode: typeof m.mode === 'string' ? m.mode : prev.mode,
          durationMs: typeof m.durationMs === 'number' ? m.durationMs : prev.durationMs,
          shuffle: typeof m.shuffle === 'boolean' ? m.shuffle : prev.shuffle,
        }));
      } else if (msg.type === 'deckSwapStarted') {
        // Engine just kicked off a soft-swap. Lock the playlist so
        // operator taps during the fade are silently ignored (the
        // server will also reject with 409, but locking the UI
        // gives clear visual feedback that we're mid-transition).
        setDeckSwapInFlight(true);
      } else if (msg.type === 'deckSwapComplete') {
        setDeckSwapInFlight(false);
      }
    });
    const unsubViz = engineVizBus.subscribe((msg) => {
      if (msg.type !== 'vis') return;
      visDataRef.current = ((msg as any).vis as { [k: string]: string | null }) || {};
      // Throttle UI updates to ~5fps (200ms). The engine throttles
      // upstream too (vis.broadcastHz config), but this is a belt-and-
      // braces guard against rates >5 Hz.
      const now = Date.now();
      if (now - lastVisUpdateRef.current > 200) {
        lastVisUpdateRef.current = now;
        setVisVersion((v) => v + 1);
      }
    });
    // Reflect the singleton control socket's connect status into the
    // local "engine offline" UI. The bus auto-reconnects every 5 s, so
    // this poll converges to truth without a per-tab WS.
    const conPoll = setInterval(() => {
      const ok = isControlConnected();
      setIsConnected((prev) => (prev === ok ? prev : ok));
      if (ok) setConnectionError('');
    }, 1000);
    return () => {
      unsubControl();
      unsubViz();
      clearInterval(conPoll);
    };
  }, []);

  // ── Boot: wait for resolved API base, then connect ──────────────────
  const connectToEngine = useCallback(async () => {
    const base = await getApiBaseAsync();
    apiBaseRef.current = base;

    // 1. Test connection first
    const conn = await testConnection(base);
    setIsConnected(conn.ok);
    setConnectionError(conn.ok ? '' : (conn.error || 'Unknown error'));

    // WS lifecycle is owned by the app-level engineBus (see RigGlobals
    // useEffect) — nothing per-tab to start here. The bus subscriptions
    // above are already active.

    if (!conn.ok) return;

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

    // Load initial deck channel state. We deliberately do NOT
    // call /mixer here — the deck tab has no business surfacing
    // overlay channels.
    const deckRes = await fetchDeckChannel();
    if (deckRes.ok && deckRes.data) {
      setDeckChannel(deckRes.data.channel || null);
    }
  }, []);

  // Patch the deck transition config (optimistic local update + POST).
  // The server broadcasts `deckTransitionConfig` on success which we
  // already mirror in the WS handler — that's the source of truth, but
  // updating locally first avoids the visible "snap-back" on tap.
  const handleDeckTxChange = useCallback((patch: Partial<DeckTransitionConfig>) => {
    setDeckTxConfig((prev) => ({ ...prev, ...patch }));
    setDeckTransitionConfig(patch);
  }, []);

  useEffect(() => {
    connectToEngine();

    // Reconnect when app comes to foreground
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        connectToEngine();
      }
    });

    return () => {
      sub.remove();
    };
  }, [connectToEngine]);

  const triggerChannelControl = (_channelId: string, id: number, v0: number, v1?: number, v2?: number) => {
    // Deck tab only ever writes to the deck channel — there's a single
    // dedicated route for that now. We ignore the channelId arg (kept
    // for API compatibility with the previous mixer-routed call).
    setDeckChannelControl(id, v0, v1, v2);
  };

  return (
    <View style={{ flex: 1, backgroundColor: Colors.light.background }}>
      {/* Top bar: title + connection status + master fader. Matches the
          Marsin Mixer header layout, minus channel-add buttons. */}
      <DeckTopBar isConnected={isConnected} />
      <CPCControls />
      {/* ── Channel Preview Visualization ───────────────────────────── */}
      <View style={{ paddingHorizontal: 16, paddingTop: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 9, letterSpacing: 1.5, textTransform: 'uppercase', color: Colors.light.icon }}>
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
              />
            </View>
          ) : (
            <Text style={{ color: Colors.light.secondary, fontStyle: 'italic' }}>
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
            <View style={{ marginBottom: 12, paddingHorizontal: 8, paddingTop: 6, paddingBottom: 8, borderRadius: 8, backgroundColor: Colors.light.surfaceContainerHigh, ...globalStyles.ghostBorder, gap: 6 }}>
              {/* Header sits on the SAME row as PLAY/PAUSE + SHUFFLE so it
                  costs zero extra vertical height — the label rides the
                  baseline of the tallest control next to it. */}
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 }}>
                  <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10, letterSpacing: 1.2, color: Colors.light.secondary, textTransform: 'uppercase' }}>AUTOPILOT</Text>
                  <TouchableOpacity
                    onPress={() => { const nx = !isPlaylistActive; setPlaylistActive(nx); setAutopilot(nx, playlistDelayStr, isShuffle); }}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: isPlaylistActive ? Colors.light.primary : 'transparent', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 6, borderWidth: 1, borderColor: isPlaylistActive ? 'transparent' : Colors.light.ghostBorder }}
                  >
                    <IconSymbol name={isPlaylistActive ? "pause.fill" : "play.fill"} size={16} color={isPlaylistActive ? "#FFF" : Colors.light.text} />
                    <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: isPlaylistActive ? "#FFF" : Colors.light.text, fontSize: 12 }}>
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
                  <IconSymbol name="shuffle" size={16} color={isShuffle ? Colors.light.primary : Colors.light.icon} />
                  <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: isShuffle ? Colors.light.primary : Colors.light.icon, fontSize: 12, letterSpacing: 0.5 }}>SHUFFLE</Text>
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
              mode={deckTxConfig.mode}
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
                  <View key={channel.id} style={{ width: '100%', backgroundColor: Colors.light.surfaceContainerLowest, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: Colors.light.ghostBorder }}>
                    {/* Renaming the active playlist entry: tap the title and type.
                        Auto-saves on blur; the PlaylistPanel listens for the same
                        `playlistSaved` broadcast and flashes its ✓ SAVED toast. */}
                    <EntryLabelEditor
                      channelId={channel.id}
                      channelLabel={channelTitle}
                      locked={!!channel.locked}
                    />

                    <View style={{ marginBottom: 16 }}>
                      <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10, color: Colors.light.secondary, marginBottom: 16, textTransform: 'uppercase' }}>PARAMETERS</Text>
                      <GlobalParams variant="deck" channelId={channel.id} exports={exports} />
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
    </View>
  );
}
