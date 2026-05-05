import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, TouchableOpacity, ScrollView, TextInput, AppState, PanResponder, StyleSheet } from 'react-native';
import { Picker } from '@react-native-picker/picker';
import { globalStyles } from '@/styles/globalStyles';
import { Colors } from '@/constants/theme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { HorizontalFader } from '@/components/ui/HorizontalFader';
import { RigGlobals } from '@/components/RigGlobals';
import { GlobalParams } from '@/components/GlobalParams';
import { CPCControls } from '@/components/CPCControls';
import { useFocusEffect } from 'expo-router';
import { 
  fetchPatterns, setActivePattern, sendControl, getApiBase, getApiBaseAsync,
  fetchExports, setGlobalEffect, getAutopilot, setAutopilot, testConnection,
  fetchMixerState, updateMixerChannel, removeMixerChannel, setMixerChannelControl,
  setMixerView
} from '@/utils/api';

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
  const [patterns, setPatterns] = useState<string[]>([]);
  const [mixerChannels, setMixerChannels] = useState<any[]>([]);
  const [mixerMaster, setMixerMaster] = useState<number>(1.0);
  const [compileError, setCompileError] = useState<string | null>(null);
  const [isScrollEnabled, setScrollEnabled] = useState<boolean>(true);
  const [isConnected, setIsConnected] = useState<boolean | null>(null); // null = checking
  const [connectionError, setConnectionError] = useState<string>('');
  
  // Playlist Automator State
  const [isPlaylistActive, setPlaylistActive] = useState<boolean>(false);
  const [playlistDelayStr, setPlaylistDelayStr] = useState<string>('30');
  const [isShuffle, setIsShuffle] = useState<boolean>(false);

  const scrollViewRef = useRef<ScrollView>(null);
  const itemLayouts = useRef<{ [key: string]: number }>({});
  const wsRef = useRef<WebSocket | null>(null);
  const apiBaseRef = useRef<string>('');

  useFocusEffect(
    useCallback(() => {
      setMixerView('deck');
    }, [])
  );

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

    // 2. Load patterns
    const pResult = await fetchPatterns();
    if (pResult.ok && pResult.data) {
      setPatterns(pResult.data);
    }

    // 3. Load autopilot state
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
      setMixerMaster(mixerRes.data.master || 1.0);
    }
  }, [connectWebSocket]);

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
          if (msg.type === 'mixer') {
            setMixerChannels(msg.channels || []);
            setMixerMaster(msg.master || 1.0);
          } else if (msg.type === 'pattern') {
            // legacy, ignore if we are using mixer
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

  // Auto-scroll logic removed, since we have multiple channels.

  const handleSelectPattern = async (pattern: string) => {
    // For now, selecting a pattern will just set the base pattern 
    // to maintain compatibility.
    const res = await setActivePattern(pattern); 
    if (res.ok && res.data && res.data.error) {
      setCompileError(res.data.error);
    } else if (!res.ok) {
      setCompileError(res.error || 'Network error');
    } else {
      setCompileError(null);
    }
  };

  const triggerChannelControl = (channelId: string, id: number, v0: number, v1?: number, v2?: number) => {
    setMixerChannelControl(channelId, id, v0, v1, v2);
  };

  return (
    <View style={{ flex: 1, backgroundColor: Colors.light.background }}>
      <CPCControls wsRef={wsRef} />
      <View style={globalStyles.container}>
        {/* Left Pane - Pattern Queue */}
        <View style={globalStyles.leftPane}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 32 }}>
          <Text style={globalStyles.headline}>Pattern Queue</Text>
          <IconSymbol name="slider.vertical.3" size={24} color={Colors.light.secondary} />
        </View>

        <ScrollView ref={scrollViewRef} showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 32, paddingBottom: 32 }} style={{ flex: 1 }}>
          <View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {patterns.map((ptn) => {
                // If there's a base channel, highlight it
                const baseChannel = mixerChannels[0];
                const isLive = baseChannel && baseChannel.pattern === ptn;
                return (
                  <TouchableOpacity 
                    key={ptn} 
                    onPress={() => handleSelectPattern(ptn)}
                    onLayout={(e) => { itemLayouts.current[ptn] = e.nativeEvent.layout.y; }}
                    style={{ 
                       height: 48, paddingHorizontal: 16, borderRadius: 8, justifyContent: 'center', alignItems: 'center',
                       backgroundColor: isLive ? Colors.light.primary : Colors.light.surfaceContainerHigh,
                       borderWidth: 1, borderColor: isLive ? 'transparent' : Colors.light.ghostBorder,
                       ...(isLive && globalStyles.ambientShadow),
                       flexGrow: 1
                    }}
                  >
                    <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 13, color: isLive ? '#FFF' : Colors.light.text, textAlign: 'center' }}>
                       {ptn}
                    </Text>
                  </TouchableOpacity>
                )
              })}
              {patterns.length === 0 && isConnected === false && (
                <OfflineBanner error={connectionError} />
              )}
              {patterns.length === 0 && isConnected !== false && (
                <Text style={{color: Colors.light.secondary, fontStyle: 'italic'}}>No patterns loaded...</Text>
              )}
            </View>
          </View>
        </ScrollView>

        <TouchableOpacity onPress={connectToEngine} style={{ marginVertical: 16, padding: 12, alignItems: 'center', borderRadius: 8, borderWidth: 1, borderColor: Colors.light.ghostBorder }}>
          <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: Colors.light.primary, fontSize: 13 }}>REFRESH / RECONNECT</Text>
        </TouchableOpacity>


        <RigGlobals />
      </View>

      {/* Right Pane - Parameters & Macros */}
      <View style={[globalStyles.rightPane, { padding: 0 }]}>
        <ScrollView scrollEnabled={isScrollEnabled} contentContainerStyle={{ padding: 48, paddingBottom: 96 }} showsVerticalScrollIndicator={false}>
        
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
               <IconSymbol name={isPlaylistActive ? "pause.fill" : "play.fill"} size={16} color={isPlaylistActive ? "#000" : Colors.light.text} />
               <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: isPlaylistActive ? "#000" : Colors.light.text, fontSize: 12 }}>
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
                   {[...Array.from({length: 30}, (_, i) => i + 1), 45, 60, 90, 120, 180, 240, 300, 600, 1200].map(val => {
                     const m = Math.floor(val / 60);
                     const s = val % 60;
                     const label = m > 0 ? (s > 0 ? `${m}m ${s}s` : `${m}m`) : `${s}s`;
                     return <Picker.Item key={val} label={label} value={val.toString()} />
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

          {/* Channels Row */}
          <View style={{ gap: 24, paddingRight: 24 }}>
            {mixerChannels.slice(0, 1).map((channel, idx) => {
              const exports = channel.exports || [];
              const sliders = exports.filter((e: any) => e.kind === 1);
              const toggles = exports.filter((e: any) => e.kind === 2);
              const triggers = exports.filter((e: any) => e.kind === 3);
              const colorPickers = exports.filter((e: any) => e.kind === 6);

              return (
                <View key={channel.id} style={{ width: '100%', backgroundColor: Colors.light.surfaceContainerLowest, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: Colors.light.ghostBorder }}>
                  <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 14, color: Colors.light.primary, marginBottom: 8, textTransform: 'uppercase' }}>CH {idx + 1}: {channel.name || channel.pattern}</Text>
                  
                  {/* Channel Controls (Fader, Mode, Enabled) */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: Colors.light.ghostBorder }}>
                    <TouchableOpacity onPress={() => updateMixerChannel(channel.id, { enabled: !channel.enabled })} style={{ padding: 8, backgroundColor: channel.enabled ? Colors.light.primary : Colors.light.surfaceContainerHigh, borderRadius: 4 }}>
                      <Text style={{ color: channel.enabled ? '#000' : '#fff', fontFamily: 'SpaceGrotesk_700Bold', fontSize: 12 }}>{channel.enabled ? 'ON' : 'OFF'}</Text>
                    </TouchableOpacity>
                    <Text style={{ color: Colors.light.text, fontFamily: 'SpaceGrotesk_700Bold', fontSize: 12 }}>MODE: {channel.mode.toUpperCase()}</Text>
                  </View>

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
