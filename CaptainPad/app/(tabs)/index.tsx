import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, TouchableOpacity, ScrollView, AppState } from 'react-native';
import { Picker } from '@react-native-picker/picker';
import { globalStyles } from '@/styles/globalStyles';
import { Colors } from '@/constants/theme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { RigGlobals } from '@/components/RigGlobals';
import { GlobalParams } from '@/components/GlobalParams';
import { CPCControls } from '@/components/CPCControls';
import { PlaylistPanel } from '@/components/PlaylistPanel';
import { EntryLabelEditor } from '@/components/EntryLabelEditor';
import { PixelStrip } from '@/components/ui/PixelStrip';
import { useFocusEffect } from 'expo-router';
import {
  getApiBaseAsync,
  getAutopilot, setAutopilot, testConnection,
  fetchMixerState, setMixerChannelControl,
  setMixerView,
} from '@/utils/api';
import { engineEvents } from '@/utils/engineEvents';

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
  const [mixerChannels, setMixerChannels] = useState<any[]>([]);
  const [isConnected, setIsConnected] = useState<boolean | null>(null);
  const [connectionError, setConnectionError] = useState<string>('');

  // The deck is always bound to its base channel — `mixerChannels[0]`.
  // The "TARGET CHANNEL" picker that used to let the operator preview
  // mixer channels from the deck was removed in May 2026; switching
  // between channels now happens via the active playlist instead.
  // See docs/16_captain_pad.md §"Target channel removal".
  const deckChannel = mixerChannels[0] ?? null;
  const deckChannelId: string | null = deckChannel?.id ?? null;

  // Autopilot state (cycles through the active playlist on a timer)
  const [isPlaylistActive, setPlaylistActive] = useState<boolean>(false);
  const [playlistDelayStr, setPlaylistDelayStr] = useState<string>('30');
  const [isShuffle, setIsShuffle] = useState<boolean>(false);

  const wsRef = useRef<WebSocket | null>(null);
  const apiBaseRef = useRef<string>('');
  const visDataRef = useRef<{ [key: string]: string | null }>({});
  const [, setVisVersion] = useState(0);
  const lastVisUpdateRef = useRef(0);

  useFocusEffect(
    useCallback(() => {
      setMixerView('deck');
    }, [])
  );

  const connectWebSocket = useCallback((base: string) => {
    // Close existing
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    const engineHost = base.replace(/^https?:\/\//, '').replace(/:\d+$/, '');
    const wsPort = base.split(':').pop();
    const wsUrl = `ws://${engineHost}:${wsPort}`;

    try {
      const ws = new WebSocket(wsUrl);
      ws.onopen = () => {
        setIsConnected(true);
        setConnectionError('');
      };
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          // Fan out to subscribers (PlaylistPanel, etc.) before any local
          // handling. Listeners only react to types they care about.
          engineEvents.emit(msg);
          if (msg.type === 'mixer') {
            setMixerChannels(msg.channels || []);
          } else if (msg.type === 'autopilot') {
            // The engine broadcasts every autopilot transition (so any
            // writer — this UI, PortWatch over LoRa, an HTTP script —
            // ends up rendered the same way). Mirror it into local state
            // so the toggle/picker on this tab tracks remote flips
            // without having to re-fetch on a timer.
            if (typeof msg.active === 'boolean') setPlaylistActive(msg.active);
            if (typeof msg.delay_s === 'string' && msg.delay_s.length) {
              setPlaylistDelayStr(msg.delay_s);
            }
            if (typeof msg.shuffle === 'boolean') setIsShuffle(msg.shuffle);
          } else if (msg.type === 'vis') {
            visDataRef.current = msg.vis || {};
            // Throttle UI updates to ~5fps (200ms)
            const now = Date.now();
            if (now - lastVisUpdateRef.current > 200) {
              lastVisUpdateRef.current = now;
              setVisVersion(v => v + 1);
            }
          }
        } catch {}
      };
      ws.onerror = () => {
        setIsConnected(false);
        setConnectionError('WebSocket connection failed');
      };
      ws.onclose = () => {
        // Auto-reconnect after 5 seconds
        setTimeout(() => {
          if (apiBaseRef.current) {
            connectWebSocket(apiBaseRef.current);
          }
        }, 5000);
      };
      wsRef.current = ws;
    } catch {}
  }, []);

  // ── Boot: wait for resolved API base, then connect ──────────────────
  const connectToEngine = useCallback(async () => {
    const base = await getApiBaseAsync();
    apiBaseRef.current = base;

    // 1. Test connection first
    const conn = await testConnection(base);
    setIsConnected(conn.ok);
    setConnectionError(conn.ok ? '' : (conn.error || 'Unknown error'));

    // Always start WebSocket so the 5s auto-reconnect loop can run
    connectWebSocket(base);

    if (!conn.ok) return;

    // Load autopilot state
    const apResult = await getAutopilot();
    if (apResult.ok && apResult.data) {
      setPlaylistActive(apResult.data.active);
      setPlaylistDelayStr(apResult.data.delay_s);
      setIsShuffle(apResult.data.shuffle);
    }

    // Load initial mixer state
    const mixerRes = await fetchMixerState();
    if (mixerRes.ok && mixerRes.data) {
      setMixerChannels(mixerRes.data.channels || []);
    }
  }, [connectWebSocket]);

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
      if (wsRef.current) wsRef.current.close();
    };
  }, [connectToEngine]);

  const triggerChannelControl = (channelId: string, id: number, v0: number, v1?: number, v2?: number) => {
    setMixerChannelControl(channelId, id, v0, v1, v2);
  };

  return (
    <View style={{ flex: 1, backgroundColor: Colors.light.background }}>
      <CPCControls wsRef={wsRef} />
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
        {/* Left Pane — Playlist (the one and only pattern list) */}
        <View style={globalStyles.leftPane}>
          {isConnected === false && <OfflineBanner error={connectionError} />}

          {/* THE pattern list = the active playlist for the deck.
              No duplicate "all patterns" list — tap + on the panel to pick from the
              full library and add it as a new entry. */}
          {deckChannelId ? (
            <View key={deckChannelId} style={{ flex: 1, minHeight: 0 }}>
              <PlaylistPanel channelId={deckChannelId} channelLabel="DECK MAIN" locked={!!deckChannel?.locked} />
            </View>
          ) : (
            <Text style={{ color: Colors.light.secondary, fontStyle: 'italic' }}>
              Waiting for deck…
            </Text>
          )}

          <TouchableOpacity onPress={connectToEngine} style={{ marginVertical: 12, padding: 10, alignItems: 'center', borderRadius: 8, borderWidth: 1, borderColor: Colors.light.ghostBorder }}>
            <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: Colors.light.primary, fontSize: 12 }}>REFRESH / RECONNECT</Text>
          </TouchableOpacity>

          <RigGlobals />
        </View>

        {/* Right Pane - Parameters & Macros (autopilot + channel exports) */}
        <View style={[globalStyles.rightPane, { padding: 0 }]}>
          <ScrollView contentContainerStyle={{ padding: 48, paddingBottom: 96 }} showsVerticalScrollIndicator={false}>
            {/* Offline Banner (right pane) */}
            {isConnected === false && (
              <OfflineBanner error={connectionError} />
            )}

            {/* Playlist Automator Row */}
            <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 12, color: Colors.light.secondary, marginBottom: 8 }}>AUTOPILOT TRANSITIONS</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 32, padding: 12, borderRadius: 8, backgroundColor: Colors.light.surfaceContainerHigh, ...globalStyles.ghostBorder }}>
              <TouchableOpacity
                onPress={() => { const nx = !isPlaylistActive; setPlaylistActive(nx); setAutopilot(nx, playlistDelayStr, isShuffle); }}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: isPlaylistActive ? Colors.light.primary : 'transparent', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 6, borderWidth: 1, borderColor: isPlaylistActive ? 'transparent' : Colors.light.ghostBorder }}
              >
                <IconSymbol name={isPlaylistActive ? "pause.fill" : "play.fill"} size={16} color={isPlaylistActive ? "#FFF" : Colors.light.text} />
                <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: isPlaylistActive ? "#FFF" : Colors.light.text, fontSize: 12 }}>
                  {isPlaylistActive ? 'PAUSE' : 'PLAY'}
                </Text>
              </TouchableOpacity>

              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1, marginHorizontal: 16 }}>
                <Text style={{ fontFamily: 'Inter_600SemiBold', color: Colors.light.secondary, fontSize: 12 }}>TIMER</Text>
                <View style={{ flex: 1, height: 48, justifyContent: 'center', overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 8, borderColor: Colors.light.ghostBorder, borderWidth: 1 }}>
                  <Picker
                    selectedValue={playlistDelayStr}
                    onValueChange={(itemValue) => {
                      setPlaylistDelayStr(itemValue);
                      setAutopilot(isPlaylistActive, itemValue, isShuffle);
                    }}
                    style={{ width: '100%', height: 48, color: Colors.light.primary, justifyContent: 'center' }}
                    itemStyle={{ color: Colors.light.primary, fontSize: 16, fontFamily: 'SpaceGrotesk_700Bold', height: 48 }}
                  >
                    {[...Array.from({ length: 30 }, (_, i) => i + 1), 45, 60, 90, 120, 180, 240, 300, 600, 1200].map(val => {
                      const m = Math.floor(val / 60);
                      const s = val % 60;
                      const label = m > 0 ? (s > 0 ? `${m}m ${s}s` : `${m}m`) : `${s}s`;
                      return <Picker.Item key={val} label={label} value={val.toString()} />;
                    })}
                  </Picker>
                </View>
              </View>

              <TouchableOpacity
                onPress={() => { const nx = !isShuffle; setIsShuffle(nx); setAutopilot(isPlaylistActive, playlistDelayStr, nx); }}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 8 }}
              >
                <IconSymbol name="shuffle" size={16} color={isShuffle ? Colors.light.primary : Colors.light.icon} />
                <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: isShuffle ? Colors.light.primary : Colors.light.icon, fontSize: 12 }}>SHUFFLE</Text>
              </TouchableOpacity>
            </View>

            {/* Channel parameters for the deck (base) channel. The deck is
                hard-wired to the base channel; CaptainPad's MIXER tab is
                where multi-channel routing lives. */}
            <View style={{ gap: 24, paddingRight: 24 }}>
              {(deckChannel ? [deckChannel] : []).map((channel) => {
                const channelTitle = "DECK MAIN";
                const exports = channel.exports || [];
                const toggles = exports.filter((e: any) => e.kind === 2);
                const triggers = exports.filter((e: any) => e.kind === 3);

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
