import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, TextInput, PanResponder, AppState, Animated, Modal } from 'react-native';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { globalStyles } from '@/styles/globalStyles';
import { useFocusEffect } from 'expo-router';
import { HorizontalFader } from '@/components/ui/HorizontalFader';
import { RigGlobals } from '@/components/RigGlobals';
import { 
  fetchPatterns, getApiBaseAsync, testConnection,
  fetchMixerState, updateMixerChannel, removeMixerChannel, setMixerChannelControl,
  addMixerChannel, updateMixerMaster, setGlobalEffect, setGlobalBlackout, fetchExports,
  fetchChannelBlends, setMixerView
} from '@/utils/api';

import { GlobalParams } from '@/components/GlobalParams';
import { CPCControls } from '@/components/CPCControls';
import { MiniFader } from '@/components/ui/MiniFader';

const C = Colors.light;

// HorizontalFader moved to shared ui

// ── Global Rig Buttons moved to RigGlobals ────────────────────────────

// Mini Fader moved to GlobalParams.tsx

// ── Blend Mode Picker Modal ────────────────────────────────────────────
const BlendModePicker = ({ visible, current, onSelect, onClose, blends }: any) => {
  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={onClose}>
        <View style={styles.modalContent}>
          <Text style={[styles.labelCaps, {marginBottom: 12}]}>BLEND MODE</Text>
          {(blends || []).map((id: string) => (
            <TouchableOpacity key={id} style={[styles.modalRow, id === current && styles.modalRowActive]} onPress={() => { onSelect(id); onClose(); }}>
              <Text style={[styles.valueReadout, id === current && {color: C.primary}]}>{id.replace('blend_', '').toUpperCase()}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </TouchableOpacity>
    </Modal>
  );
};

// ── Channel Strip ──────────────────────────────────────────────────────
const ChannelStrip = ({ channel, index, patterns, blends, isSolo, onPatternSelect, onFaderChange, onMuteToggle, onSoloToggle, onModeChange, onControlChange, onDelete, onAddPattern, onRemovePattern }: any) => {
  const [showBlendPicker, setShowBlendPicker] = useState(false);
  return (
    <View style={styles.channelCard}>
      <BlendModePicker visible={showBlendPicker} current={channel.mode} onSelect={(m: string) => onModeChange(channel.id, m)} onClose={() => setShowBlendPicker(false)} blends={blends} />
      {/* Header */}
      <View style={styles.channelHeader}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
          <View style={styles.channelBadge}>
            <Text style={[styles.valueReadout, {color: C.primary}]}>{index}</Text>
          </View>
          <TextInput 
            style={[styles.headlineSm, {fontSize: 14, color: C.text, flex: 1, padding: 0}]}
            defaultValue={channel.name || 'CH ' + index}
            onEndEditing={(e) => updateMixerChannel(channel.id, { name: e.nativeEvent.text })}
            placeholderTextColor={C.icon}
          />
        </View>
        <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
          <TouchableOpacity style={styles.modeDropdown} onPress={() => setShowBlendPicker(true)}>
            <Text style={[styles.valueReadout, {color: C.primary, fontSize: 11}]}>{(channel.mode || 'normal').toUpperCase()} ▾</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.deleteBtn} onPress={() => onDelete(channel.id)}>
            <IconSymbol name="trash" size={14} color={C.error} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Level Fader */}
      <View style={styles.levelRow}>
        <Text style={[styles.labelCaps, { width: 36 }]}>LEVEL</Text>
        <HorizontalFader 
          value={channel.fader} 
          onChange={(v: number) => onFaderChange(channel.id, v)} 
          trackStyle={[styles.faderTrack, { flex: 1, marginHorizontal: 6 }]} 
          fillStyle={styles.faderFill} 
        />
        <Text style={[styles.displayMono, { width: 32, textAlign: 'right', fontSize: 13 }]}>
          {Math.round(channel.fader * 100)}
        </Text>
      </View>

      {/* Hue Shift (disabled placeholder) */}
      <View style={[styles.levelRow, { opacity: 0.35 }]} pointerEvents="none">
        <Text style={[styles.labelCaps, { width: 36 }]}>HUE</Text>
        <View style={[styles.faderTrack, { flex: 1, marginHorizontal: 6 }]} />
        <Text style={[styles.displayMono, { width: 32, textAlign: 'right', fontSize: 10, color: C.secondary }]}>OFF</Text>
      </View>

      <View style={styles.channelBody}>
        {/* Pattern List (Left) */}
        <View style={styles.patternListPanel}>
          <View style={styles.patternListHeader}>
            <Text style={styles.labelCaps}>PATTERN</Text>
          </View>
          <ScrollView style={{ flex: 1, padding: 4 }} nestedScrollEnabled>
            {patterns.map((p: string, i: number) => {
              const isActive = channel.pattern === p;
              return (
                <TouchableOpacity 
                  key={p} 
                  style={[styles.patternRow, isActive && styles.patternRowActive]}
                  onPress={() => onPatternSelect(channel.id, p)}
                >
                  <Text style={[styles.patternNumber, isActive && {color: C.primary}]}>{(i+1).toString().padStart(2, '0')}</Text>
                  <Text style={[styles.patternName, isActive && {color: C.primary}]} numberOfLines={1}>{p}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>

        {/* Parameters (Right) */}
        <View style={styles.paramsPanel}>
          <ScrollView nestedScrollEnabled>
            <View style={{ gap: 4 }}>
              {(channel.exports || []).map((exp: any) => (
                <MiniFader 
                  key={exp.id}
                  label={exp.name.replace(/_v\d+$/, '').toUpperCase().substring(0, 12)}
                  value={exp.v0 !== undefined ? exp.v0 : 0.5}
                  onChange={(v: number) => onControlChange(channel.id, exp.id, v)}
                />
              ))}
              {(!channel.exports || channel.exports.length === 0) && (
                <Text style={[styles.labelCaps, {textAlign: 'center', marginTop: 16}]}>NO PARAMS</Text>
              )}
            </View>
          </ScrollView>

          {/* Mute/Solo */}
          <View style={styles.muteSoloRow}>
            <TouchableOpacity 
              style={[styles.toggleBtn, !channel.enabled && styles.toggleBtnMuted]}
              onPress={() => onMuteToggle(channel.id, !channel.enabled)}>
              <Text style={[styles.labelCaps, !channel.enabled && {color: '#FFF'}]}>Mute</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={[styles.toggleBtn, isSolo && { backgroundColor: '#00a86b', borderColor: '#00a86b' }]}
              onPress={() => onSoloToggle(channel.id)}>
              <Text style={[styles.labelCaps, isSolo && {color: '#FFF'}]}>Solo</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </View>
  );
};

// ── Main Mixer Screen ──────────────────────────────────────────────────
export default function MixerScreen() {
  const [patterns, setPatterns] = useState<string[]>([]);
  const [channels, setChannels] = useState<any[]>([]);
  const [master, setMaster] = useState(1.0);
  const [isConnected, setIsConnected] = useState<boolean | null>(null);
  const [blends, setBlends] = useState<string[]>([]);

  const wsRef = useRef<WebSocket | null>(null);
  const apiBaseRef = useRef('');
  // globalExports fetching moved to GlobalParams.tsx
  const throttleRef = useRef<{[key: string]: number}>({});

  useFocusEffect(
    useCallback(() => {
      setMixerView('mixer');
    }, [])
  );

  const loadAll = useCallback(async () => {
    const base = await getApiBaseAsync();
    apiBaseRef.current = base;
    const conn = await testConnection(base);
    setIsConnected(conn.ok);
    if (!conn.ok) return;

    const pRes = await fetchPatterns();
    if (pRes.ok && pRes.data) setPatterns(pRes.data);

    const bRes = await fetchChannelBlends();
    if (bRes.ok && bRes.data) setBlends(bRes.data);

    const mRes = await fetchMixerState();
    if (mRes.ok && mRes.data) {
      setMaster(mRes.data.master);
      setChannels(mRes.data.channels || []);
    }

    // Connect WS
    connectWebSocket(base);
  }, []);

  const connectWebSocket = useCallback((base: string) => {
    if (wsRef.current) wsRef.current.close();
    const engineHost = base.replace(/^https?:\/\//, '').replace(/:\d+$/, '');
    const wsPort = base.split(':').pop();
    const wsUrl = `ws://${engineHost}:${wsPort}`;
    try {
      const ws = new WebSocket(wsUrl);
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === 'mixer') {
            setMaster(msg.master);
            setChannels(msg.channels || []);
          }
        } catch(e) {}
      };
      ws.onclose = () => {
        setTimeout(() => { if (apiBaseRef.current) connectWebSocket(apiBaseRef.current); }, 5000);
      };
      wsRef.current = ws;
    } catch {}
  }, []);

  useEffect(() => {
    loadAll();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') loadAll();
    });
    return () => { sub.remove(); if (wsRef.current) wsRef.current.close(); };
  }, [loadAll]);

  // ── Handlers ───────────────────────────────────────────────────────
  const handlePatternSelect = async (channelId: string, pattern: string) => {
    const channel = channels.find(c => c.id === channelId);
    if (!channel || channel.pattern === pattern) return;
    setChannels(chs => chs.map(c => c.id === channelId ? { ...c, pattern } : c));
    await updateMixerChannel(channelId, { pattern });
  };

  const handleFaderChange = async (channelId: string, level: number) => {
    setChannels(chs => chs.map(c => c.id === channelId ? { ...c, fader: level } : c));
    // Throttle network calls to ~10/sec
    const now = Date.now();
    const key = `fader_${channelId}`;
    if (now - (throttleRef.current[key] || 0) > 100) {
      throttleRef.current[key] = now;
      await updateMixerChannel(channelId, { fader: level });
    }
  };

  const handleMuteToggle = async (channelId: string, enabled: boolean) => {
    setChannels(chs => chs.map(c => c.id === channelId ? { ...c, enabled } : c));
    await updateMixerChannel(channelId, { enabled });
  };

  const handleSoloToggle = async (channelId: string) => {
    setChannels(chs => chs.map(c => ({ ...c, enabled: c.id === channelId })));
    for (const c of channels) {
      const targetEnabled = (c.id === channelId);
      if (c.enabled !== targetEnabled) {
        await updateMixerChannel(c.id, { enabled: targetEnabled });
      }
    }
  };

  const handleModeChange = async (channelId: string, newMode: string) => {
    setChannels(chs => chs.map(c => c.id === channelId ? { ...c, mode: newMode } : c));
    await updateMixerChannel(channelId, { mode: newMode });
  };

  const handleControlChange = (channelId: string, controlId: number, val: number) => {
    setChannels(chs => chs.map(c => {
      if (c.id !== channelId) return c;
      return { ...c, exports: (c.exports || []).map((e: any) => e.id === controlId ? { ...e, v0: val } : e) };
    }));
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'setChannelControl', channelId, id: controlId, v0: val, v1: 0, v2: 0 }));
    } else {
      setMixerChannelControl(channelId, controlId, val, 0, 0);
    }
  };

  const handleAddChannel = async () => {
    await addMixerChannel(patterns[0] || '08_ocean_liner', 'New Layer', 'blend_screen', 1.0);
  };

  const handleMasterChange = async (val: number) => {
    setMaster(val);
    const now = Date.now();
    if (now - (throttleRef.current['master'] || 0) > 100) {
      throttleRef.current['master'] = now;
      await updateMixerMaster(val);
    }
  };

  const handleDeleteChannel = async (id: string) => {
    await removeMixerChannel(id);
  };

  return (
    <View style={styles.container}>
      {/* ── Top Header Bar ─────────────────────────────────────────── */}
      <View style={styles.header}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
          <Text style={styles.brandText}>Marsin Mixer</Text>
          <View style={styles.statusBadge}>
            <View style={[styles.statusDot, !isConnected && {backgroundColor: C.error}]} />
            <Text style={[styles.labelCaps, {color: isConnected ? '#00a86b' : C.error}]}>
              {isConnected ? 'CONNECTED' : 'OFFLINE'}
            </Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Text style={styles.labelCaps}>MASTER</Text>
          <HorizontalFader 
            value={master} 
            onChange={handleMasterChange} 
            trackStyle={[styles.faderTrack, { width: 180 }]} 
            fillStyle={styles.faderFill} 
          />
          <Text style={[styles.displayMono, {fontSize: 16, width: 36, textAlign: 'right'}]}>{Math.round(master * 100)}</Text>
          <TouchableOpacity style={styles.addBtn} onPress={handleAddChannel}>
            <Text style={[styles.labelCaps, {color: '#FFF'}]}>+ ADD CHANNEL</Text>
          </TouchableOpacity>
        </View>
      </View>

      <CPCControls wsRef={wsRef} />

      {/* ── Channel Strips ─────────────────────────────────────────── */}
      <ScrollView horizontal scrollEnabled={false} contentContainerStyle={{ padding: 16, gap: 16, flexGrow: 1 }} style={{ flex: 1 }}>
        {channels.slice(1).map((channel, idx) => {
          const isSoloActive = channel.enabled && channels.filter(c => c.enabled).length === 1;
          return (
            <ChannelStrip 
              key={channel.id} 
              index={idx + 1} 
              channel={channel} 
              isSolo={isSoloActive}
              patterns={patterns} 
              blends={blends}
              onPatternSelect={handlePatternSelect}
              onFaderChange={handleFaderChange}
              onMuteToggle={handleMuteToggle}
              onSoloToggle={handleSoloToggle}
              onModeChange={handleModeChange}
              onControlChange={handleControlChange}
              onDelete={handleDeleteChannel}
            />
          );
        })}
        {channels.length === 0 && (
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
            <Text style={[styles.labelCaps, {fontSize: 14}]}>NO CHANNELS — TAP "+ ADD CHANNEL"</Text>
          </View>
        )}
      </ScrollView>

      {/* ── Global Rig Controls (Bottom) ───────────────────────────── */}
      <View style={styles.globalRigBar}>
        <RigGlobals variant="mixer" />
      </View>
    </View>
  );
}

// ── Styles (Using Colors.light for consistency with other tabs) ────────
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.background,
  },
  header: {
    height: 64,
    backgroundColor: C.surfaceContainerLow,
    borderBottomWidth: 1,
    borderBottomColor: C.ghostBorder,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
  },
  globalParamsBar: {
    backgroundColor: C.surfaceContainerHigh,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.ghostBorder,
    flexDirection: 'row',
    alignItems: 'center',
  },
  globalRigBar: {
    backgroundColor: C.surfaceContainerLow,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: C.ghostBorder,
    flexDirection: 'row',
    alignItems: 'center',
  },
  globalBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: C.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: C.ghostBorder,
    borderRadius: 8,
    minWidth: 100,
    alignItems: 'center',
    ...globalStyles.ambientShadow,
  },
  brandText: {
    color: C.primary,
    fontSize: 20,
    fontFamily: 'SpaceGrotesk_700Bold',
    letterSpacing: -0.5,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: C.surfaceContainerHigh,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.ghostBorder,
  },
  statusDot: {
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: '#00a86b',
  },
  labelCaps: {
    fontFamily: 'SpaceGrotesk_700Bold',
    fontSize: 10,
    letterSpacing: 1.2,
    color: C.secondary,
    textTransform: 'uppercase',
  },
  valueReadout: {
    fontFamily: 'SpaceGrotesk_700Bold',
    fontSize: 13,
    color: C.text,
  },
  headlineSm: {
    fontFamily: 'SpaceGrotesk_700Bold',
    fontSize: 18,
    color: C.text,
    textTransform: 'uppercase',
  },
  displayMono: {
    fontFamily: 'SpaceGrotesk_700Bold',
    fontSize: 18,
    color: C.primary,
  },
  addBtn: {
    backgroundColor: C.primary,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    ...globalStyles.ambientShadow,
  },
  channelCard: {
    width: 320,
    backgroundColor: C.surfaceContainerLowest,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.ghostBorder,
    overflow: 'hidden',
    ...globalStyles.ambientShadow,
  },
  channelHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    backgroundColor: C.surfaceContainerHigh,
    borderBottomWidth: 1,
    borderBottomColor: C.ghostBorder,
  },
  channelBadge: {
    width: 24, height: 24, borderRadius: 6,
    backgroundColor: 'rgba(0,104,117,0.1)',
    borderWidth: 1, borderColor: C.primary,
    alignItems: 'center', justifyContent: 'center'
  },
  modeDropdown: {
    backgroundColor: C.surfaceContainerLowest,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6,
    borderWidth: 1, borderColor: C.ghostBorder,
  },
  deleteBtn: {
    width: 28, height: 28, borderRadius: 6,
    backgroundColor: C.surfaceContainerLowest,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: C.ghostBorder,
  },
  levelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: C.ghostBorder,
  },
  faderTrack: {
    height: 16,
    backgroundColor: C.surfaceContainerHigh,
    borderRadius: 4,
  },
  faderFill: {
    position: 'absolute',
    left: 0, top: 0, bottom: 0,
    backgroundColor: C.primaryFixedDim,
    borderRadius: 4,
  },
  channelBody: {
    flex: 1,
    flexDirection: 'row',
  },
  patternListPanel: {
    width: '50%',
    borderRightWidth: 1,
    borderRightColor: C.ghostBorder,
  },
  patternListHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 8,
    backgroundColor: C.surfaceContainerHigh,
    borderBottomWidth: 1,
    borderBottomColor: C.ghostBorder,
  },
  patternRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 6,
  },
  patternRowActive: {
    backgroundColor: 'rgba(0,104,117,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(0,104,117,0.3)',
  },
  patternNumber: {
    fontFamily: 'SpaceGrotesk_700Bold',
    fontSize: 10,
    color: C.secondary,
  },
  patternName: {
    fontFamily: 'SpaceGrotesk_700Bold',
    fontSize: 11,
    color: C.text,
    flex: 1,
  },
  paramsPanel: {
    width: '50%',
    padding: 12,
    justifyContent: 'space-between',
  },
  muteSoloRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  toggleBtn: {
    flex: 1, height: 32,
    backgroundColor: C.surfaceContainerHigh,
    borderRadius: 6, borderWidth: 1, borderColor: C.ghostBorder,
    alignItems: 'center', justifyContent: 'center',
  },
  toggleBtnMuted: {
    backgroundColor: C.error,
    borderColor: C.error,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: C.surfaceContainerLowest,
    borderRadius: 16,
    padding: 24,
    minWidth: 200,
    borderWidth: 1,
    borderColor: C.ghostBorder,
    ...globalStyles.ambientShadow,
  },
  modalRow: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginBottom: 4,
  },
  modalRowActive: {
    backgroundColor: 'rgba(0,104,117,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(0,104,117,0.3)',
  },
});
