import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, TextInput, AppState, Modal, useWindowDimensions } from 'react-native';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { globalStyles } from '@/styles/globalStyles';
import { useFocusEffect } from 'expo-router';
import { HorizontalFader } from '@/components/ui/HorizontalFader';
import { RigGlobals } from '@/components/RigGlobals';
import {
  getApiBaseAsync, testConnection,
  fetchMixerState, updateMixerChannel, removeMixerChannel, setMixerChannelControl,
  addMixerChannel, updateMixerMaster,
  fetchChannelBlends, fetchTransitions, setMixerView,
  fetchPlaylists,
  captureMixerChannelDefaults, discardMixerChannelDefaults,
} from '@/utils/api';
import { engineEvents } from '@/utils/engineEvents';

import { CPCControls } from '@/components/CPCControls';
import { PlaylistPanel } from '@/components/PlaylistPanel';
import { MiniFader } from '@/components/ui/MiniFader';
import { PixelStrip } from '@/components/ui/PixelStrip';

const C = Colors.light;

// HorizontalFader moved to shared ui

// ── Global Rig Buttons moved to RigGlobals ────────────────────────────

// Mini Fader moved to GlobalParams.tsx

// ── Blend Mode Picker Modal ────────────────────────────────────────────
const BlendModePicker = ({ visible, current, onSelect, onClose, blends, title }: any) => {
  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={onClose}>
        <View style={styles.modalContent}>
          <Text style={[styles.labelCaps, {marginBottom: 12}]}>{title || 'BLEND MODE'}</Text>
          {(blends || []).map((id: string) => (
            <TouchableOpacity key={id} style={[styles.modalRow, id === current && styles.modalRowActive]} onPress={() => { onSelect(id); onClose(); }}>
              <Text style={[styles.valueReadout, id === current && {color: C.primary}]}>{id.replace(/^(blend_|trans_)/, '').toUpperCase()}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </TouchableOpacity>
    </Modal>
  );
};

// ── Channel Strip ──────────────────────────────────────────────────────
// "1 list to rule them all": the strip's body shows the channel's PlaylistPanel
// as its ONLY pattern list. Tapping a row swaps the active playlist entry; +/-
// inside the panel add or remove entries; SAVE persists. No parallel "all
// patterns" column anymore.
const ChannelStrip = React.memo(({ channel, index, blends, transitions, isSolo, isDeck, visData, onFaderChange, onMuteToggle, onSoloToggle, onModeChange, onControlChange, onDelete, onLockToggle, onTransition, onTransitionSettingsChange }: any) => {
  const [showBlendPicker, setShowBlendPicker] = useState(false);
  const [showTransPicker, setShowTransPicker] = useState(false);
  const [transTime, setTransTime] = useState(String(channel.transitionTime || 1.0));
  const [transMode, setTransMode] = useState(channel.transitionMode || "trans_crossfade");
  const locked = !!channel.locked;
  return (
    <View style={[styles.channelCard, locked && styles.channelCardLocked]}>
      <BlendModePicker visible={showBlendPicker} current={channel.mode} onSelect={(m: string) => onModeChange(channel.id, m)} onClose={() => setShowBlendPicker(false)} blends={blends} />
      <BlendModePicker visible={showTransPicker} current={transMode} onSelect={(m: string) => { setTransMode(m); onTransitionSettingsChange && onTransitionSettingsChange(channel.id, { transitionMode: m }); }} onClose={() => setShowTransPicker(false)} blends={transitions} title="TRANSITION STYLE" />
      {/* Header */}
      <View style={styles.channelHeader}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
          <View style={styles.channelBadge}>
            <Text style={[styles.valueReadout, { color: C.primary }]}>{index}</Text>
          </View>
          <TextInput
            style={[styles.headlineSm, { fontSize: 14, color: C.text, flex: 1, padding: 0 }]}
            defaultValue={channel.name || 'CH ' + index}
            onEndEditing={(e) => updateMixerChannel(channel.id, { name: e.nativeEvent.text })}
            placeholderTextColor={C.icon}
          />
        </View>
        <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
          <TouchableOpacity style={[styles.lockBtn, locked && styles.lockBtnActive]} onPress={() => onLockToggle(channel.id, !locked)}>
            <IconSymbol name={locked ? "lock.fill" : "lock.open.fill"} size={14} color={locked ? '#F5A623' : C.secondary} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.modeDropdown} onPress={() => { if (!locked) setShowBlendPicker(true); }} activeOpacity={locked ? 1.0 : 0.2}>
            <Text style={[styles.valueReadout, { color: locked ? C.secondary : C.primary, fontSize: 11 }]}>{(channel.mode || 'normal').replace('blend_', '').toUpperCase()}{locked ? '' : ' ▾'}</Text>
          </TouchableOpacity>
          {!locked && (
            <TouchableOpacity style={styles.deleteBtn} onPress={() => onDelete(channel.id)}>
              <IconSymbol name="trash" size={14} color={C.error} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Pixel Visualization */}
      <PixelStrip base64Data={visData} height={14} style={{ marginBottom: 6 }} />

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

      <View style={styles.channelBody}>
        {/* Left column = the playlist (this IS the pattern list — "1 list to
            rule them all"). Wider than the params column so long names fit. */}
        <View style={styles.patternListPanel}>
          <PlaylistPanel
            channelId={channel.id}
            channelLabel={isDeck ? 'DECK MAIN' : `CH ${index}`}
            compact
            locked={locked}
          />
        </View>

        {/* Right column = live parameter sliders only. Mute/Solo and the
            transition controls have moved to full-column-width rows BELOW
            this body so they stretch the full strip width (item 1). */}
        <View style={styles.paramsPanel}>
          <ScrollView nestedScrollEnabled style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 4 }}>
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
                <Text style={[styles.labelCaps, { textAlign: 'center', marginTop: 16 }]}>NO PARAMS</Text>
              )}
            </View>
          </ScrollView>
        </View>
      </View>

      {/* ── Bottom action rows: full strip width ─────────────────────── */}
      <View style={styles.muteSoloRow}>
        <TouchableOpacity
          style={[styles.toggleBtn, !channel.enabled && styles.toggleBtnMuted]}
          onPress={() => onMuteToggle(channel.id, !channel.enabled)}>
          <Text style={[styles.labelCaps, !channel.enabled && { color: '#FFF' }]}>Mute</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.toggleBtn, isSolo && { backgroundColor: '#00a86b', borderColor: '#00a86b' }]}
          onPress={() => onSoloToggle(channel.id)}>
          <Text style={[styles.labelCaps, isSolo && { color: '#FFF' }]}>Solo</Text>
        </TouchableOpacity>
      </View>

      {!isDeck && (
        <View style={styles.transitionBar}>
          <TouchableOpacity
            style={[styles.toggleBtn, styles.transitionBtn]}
            onPress={() => onTransition && onTransition(channel.id, parseFloat(transTime) || 2.0, transMode, channel.mode)}>
            <Text style={[styles.labelCaps, { color: '#FFF' }]}>Transition</Text>
          </TouchableOpacity>
          <View style={[styles.transitionDetails, { flex: 1 }]}>
            <TouchableOpacity style={[styles.modeDropdown, { flex: 1, height: 32, justifyContent: 'center' }]} onPress={() => setShowTransPicker(true)}>
              <Text style={[styles.valueReadout, { color: C.primary, fontSize: 11 }]}>{transMode.replace('trans_', '').toUpperCase()} ▾</Text>
            </TouchableOpacity>
            <TextInput
              style={[styles.displayMono, { width: 40, textAlign: 'center', backgroundColor: C.surface, borderWidth: 1, borderColor: C.ghostBorder, borderRadius: 4, height: 32, fontSize: 13 }]}
              value={transTime}
              onChangeText={setTransTime}
              onEndEditing={() => onTransitionSettingsChange && onTransitionSettingsChange(channel.id, { transitionTime: parseFloat(transTime) || 2.0 })}
              keyboardType="numeric"
            />
            <Text style={[styles.labelCaps, { width: 10 }]}>s</Text>
          </View>
        </View>
      )}
    </View>
  );
});
ChannelStrip.displayName = 'ChannelStrip';

// ── Main Mixer Screen ──────────────────────────────────────────────────
export default function MixerScreen() {
  const { width, height } = useWindowDimensions();
  const isPortrait = width < height;
  const [channels, setChannels] = useState<any[]>([]);
  const channelsRef = useRef<any[]>([]);
  
  // Sync channels to ref
  useEffect(() => { channelsRef.current = channels; }, [channels]);

  const [master, setMaster] = useState(1.0);
  const [isConnected, setIsConnected] = useState<boolean | null>(null);
  const [blends, setBlends] = useState<string[]>([]);
  const [transitionsList, setTransitionsList] = useState<string[]>([]);

  const wsRef = useRef<WebSocket | null>(null);
  const apiBaseRef = useRef('');
  // globalExports fetching moved to GlobalParams.tsx
  const throttleRef = useRef<{[key: string]: number}>({});
  const visDataRef = useRef<{[key: string]: string | null}>({});
  const [visVersion, setVisVersion] = useState(0);
  const lastVisUpdateRef = useRef(0);
  const transitionActiveRef = useRef(false);
  const transitionGenRef = useRef(0); // Cancels previous transition when a new one starts
  // Canonical blend modes per channel — only updated by engine state or user mode changes.
  // Transitions never touch this, so it always reflects the "true" saved blend mode.
  const savedModesRef = useRef<{[id: string]: string}>({});

  useFocusEffect(
    useCallback(() => {
      setMixerView('mixer');
    }, [])
  );

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
          // Fan out so nested components (PlaylistPanel etc.) can react to
          // engine broadcasts without owning their own socket.
          engineEvents.emit(msg);
          if (msg.type === 'mixer') {
            setMaster(msg.master);
            // During active transitions, ignore engine mixer echoes —
            // the iPad animation is the source of truth for fader values.
            if (!transitionActiveRef.current) {
              setChannels(msg.channels || []);
              // Update canonical blend modes from engine state (ignore intermediate trans modes)
              for (const ch of (msg.channels || [])) {
                if (ch.id && ch.mode && !ch.mode.startsWith('trans_')) savedModesRef.current[ch.id] = ch.mode;
              }
            } else {
              // Engine echo ignored during active transition
            }
          } else if (msg.type === 'vis') {
            visDataRef.current = msg.vis || {};
            // Throttle UI updates to ~5fps (200ms) to avoid re-render storm
            const now = Date.now();
            if (now - lastVisUpdateRef.current > 200) {
              lastVisUpdateRef.current = now;
              setVisVersion(v => v + 1);
            }
          }
        } catch(e) {}
      };
      ws.onclose = () => {
        setTimeout(() => { if (apiBaseRef.current) connectWebSocket(apiBaseRef.current); }, 5000);
      };
      wsRef.current = ws;
    } catch {}
  }, []);

  const loadAll = useCallback(async () => {
    const base = await getApiBaseAsync();
    apiBaseRef.current = base;
    const conn = await testConnection(base);
    setIsConnected(conn.ok);
    if (!conn.ok) return;

    const bRes = await fetchChannelBlends();
    if (bRes.ok && bRes.data) setBlends(bRes.data);

    const tRes = await fetchTransitions();
    if (tRes.ok && tRes.data) setTransitionsList(tRes.data);

    const mRes = await fetchMixerState();
    if (mRes.ok && mRes.data) {
      setMaster(mRes.data.master);
      setChannels(mRes.data.channels || []);
      for (const ch of (mRes.data.channels || [])) {
        if (ch.id && ch.mode && !ch.mode.startsWith('trans_')) savedModesRef.current[ch.id] = ch.mode;
      }
    }

    // Connect WS
    connectWebSocket(base);
  }, [connectWebSocket]);

  useEffect(() => {
    loadAll();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') loadAll();
    });
    return () => { sub.remove(); if (wsRef.current) wsRef.current.close(); };
  }, [loadAll]);

  // ── Handlers ───────────────────────────────────────────────────────
  // (Pattern selection is handled by the per-channel PlaylistPanel, which talks
  //  to /mixer/channels/:id/playlist/entry directly. No more "swap pattern"
  //  button — every pattern lives in a playlist entry.)

  const handleFaderChange = async (channelId: string, level: number) => {
    setChannels(chs => chs.map(c => c.id === channelId ? { ...c, fader: level } : c));
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'setChannelFader', channelId, fader: level }));
    } else {
      const now = Date.now();
      const key = `fader_${channelId}`;
      if (now - (throttleRef.current[key] || 0) > 100) {
        throttleRef.current[key] = now;
        updateMixerChannel(channelId, { fader: level }).catch(()=>{});
      }
    }
  };

  const handleMuteToggle = async (channelId: string, enabled: boolean) => {
    // If enabling a channel while solo is active, clear solo
    if (enabled && soloRef.current) {
      soloRef.current = null;
      preSoloStateRef.current = {};
    }
    setChannels(chs => chs.map(c => c.id === channelId ? { ...c, enabled } : c));
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'setChannelEnabled', channelId, enabled }));
    }
    updateMixerChannel(channelId, { enabled }).catch(() => {});
  };

  // Track which channel is solo'd (null = no solo)
  const soloRef = useRef<string | null>(null);
  // Track pre-solo state (enabled + fader) so we can restore
  const preSoloStateRef = useRef<{ [id: string]: { enabled: boolean; fader: number } }>({});

  const handleSoloToggle = async (channelId: string) => {
    if (soloRef.current === channelId) {
      // Un-solo: restore all channels to their pre-solo state
      soloRef.current = null;
      const restored = preSoloStateRef.current;
      setChannels(chs => chs.map(c => ({ 
        ...c, 
        enabled: restored[c.id]?.enabled ?? true,
        fader: restored[c.id]?.fader ?? c.fader
      })));
      for (const c of channelsRef.current) {
        const prev = restored[c.id];
        const enabled = prev?.enabled ?? true;
        const fader = prev?.fader ?? c.fader;
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'setChannelEnabled', channelId: c.id, enabled }));
          wsRef.current.send(JSON.stringify({ type: 'setChannelFader', channelId: c.id, fader }));
        }
        updateMixerChannel(c.id, { enabled, fader }).catch(() => {});
      }
      preSoloStateRef.current = {};
    } else {
      // Solo: save current state, enable + fader=1.0 only on target
      const saveState: { [id: string]: { enabled: boolean; fader: number } } = {};
      channelsRef.current.forEach(c => { saveState[c.id] = { enabled: c.enabled, fader: c.fader }; });
      preSoloStateRef.current = saveState;
      soloRef.current = channelId;

      setChannels(chs => chs.map(c => ({ 
        ...c, 
        enabled: c.id === channelId, 
        fader: c.id === channelId ? 1.0 : c.fader 
      })));
      for (const c of channelsRef.current) {
        const enabled = c.id === channelId;
        const fader = c.id === channelId ? 1.0 : c.fader;
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'setChannelEnabled', channelId: c.id, enabled }));
          if (c.id === channelId) {
            wsRef.current.send(JSON.stringify({ type: 'setChannelFader', channelId: c.id, fader: 1.0 }));
          }
        }
        updateMixerChannel(c.id, { enabled, ...(c.id === channelId ? { fader: 1.0 } : {}) }).catch(() => {});
      }
    }
  };

  const handleModeChange = async (channelId: string, newMode: string) => {
    setChannels(chs => chs.map(c => c.id === channelId ? { ...c, mode: newMode } : c));
    // Update canonical modes — this is a user-initiated change
    savedModesRef.current[channelId] = newMode;
    await updateMixerChannel(channelId, { mode: newMode });
  };

  // Unlock-dirty prompt. Engaged when the user toggles lock OFF on a channel
  // whose in-memory params differ from the saved playlist entry. The user
  // must decide whether to discard the live edits or capture them into the
  // playlist before the lock actually releases.
  const [unlockPrompt, setUnlockPrompt] = useState<{
    channelId: string;
    channelName: string;
    pending: boolean;
  } | null>(null);

  const handleLockToggle = async (channelId: string, locked: boolean) => {
    // Locking is always immediate — freezing playlist saves is a safe op.
    if (locked) {
      setChannels(chs => chs.map(c => c.id === channelId ? { ...c, locked: true } : c));
      await updateMixerChannel(channelId, { locked: true });
      return;
    }
    // Unlocking: if the channel accumulated edits while locked, intercept
    // and let the operator pick save-or-discard before we actually release
    // the lock. The engine's `dirty` flag rides in on every `mixer` WS
    // broadcast (see serializeMixerState).
    const ch = channelsRef.current.find(c => c.id === channelId);
    if (ch?.dirty) {
      setUnlockPrompt({ channelId, channelName: ch.name || ch.id, pending: false });
      return;
    }
    setChannels(chs => chs.map(c => c.id === channelId ? { ...c, locked: false } : c));
    await updateMixerChannel(channelId, { locked: false });
  };

  // Resolve the unlock-dirty prompt. `mode` is the user's choice:
  //   - 'save'    → capture live params into the playlist entry, then unlock
  //   - 'discard' → snap params back to the saved entry defaults, then unlock
  //   - 'cancel'  → close the modal, leave the channel locked
  const resolveUnlockPrompt = useCallback(async (mode: 'save' | 'discard' | 'cancel') => {
    const prompt = unlockPrompt;
    if (!prompt) return;
    if (mode === 'cancel') {
      setUnlockPrompt(null);
      return;
    }
    setUnlockPrompt({ ...prompt, pending: true });
    const op = mode === 'save'
      ? captureMixerChannelDefaults(prompt.channelId)
      : discardMixerChannelDefaults(prompt.channelId);
    const res = await op;
    if (!res.ok) {
      // Keep the channel locked and surface the failure. The user can retry.
      setUnlockPrompt({ ...prompt, pending: false });
      console.warn('[Mixer] Unlock-dirty resolve failed:', res.error);
      return;
    }
    // Persisted (or reverted) cleanly — now drop the lock.
    setChannels(chs => chs.map(c => c.id === prompt.channelId ? { ...c, locked: false, dirty: false } : c));
    await updateMixerChannel(prompt.channelId, { locked: false });
    setUnlockPrompt(null);
  }, [unlockPrompt]);

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

  // Adding a channel is playlist-first. The "+ ADD CHANNEL" button opens the
  // picker so the user can spin up a new layer with one tap. The first row is
  // always "+ DEFAULT" for the fastest possible add.
  const [addPickerOpen, setAddPickerOpen] = useState(false);
  const [addPickerPlaylists, setAddPickerPlaylists] = useState<string[]>([]);

  const openAddChannelPicker = async () => {
    const lib = await fetchPlaylists();
    setAddPickerPlaylists(lib.ok && lib.data ? lib.data : ['default']);
    setAddPickerOpen(true);
  };

  const handleAddChannelWithPlaylist = async (playlistName: string) => {
    setAddPickerOpen(false);
    await addMixerChannel({
      playlist: playlistName,
      name: playlistName === 'default' ? 'New Layer' : playlistName,
      mode: 'blend_screen',
      fader: 1.0,
    });
  };

  const handleMasterChange = async (val: number) => {
    setMaster(val);
    const now = Date.now();
    if (now - (throttleRef.current['master'] || 0) > 33) {
      throttleRef.current['master'] = now;
      await updateMixerMaster(val);
    }
  };

  const handleDeleteChannel = async (id: string) => {
    await removeMixerChannel(id);
  };

  const handleTransitionSettingsChange = useCallback((channelId: string, updates: { transitionMode?: string; transitionTime?: number }) => {
    updateMixerChannel(channelId, updates);
  }, []);

  const handleTransition = useCallback((targetChannelId: string, durationSec: number, transMode: string, originalMode: string) => {
    const durationMs = durationSec * 1000;
    const startTime = Date.now();
    const ws = wsRef.current;
    const wsOk = ws && ws.readyState === WebSocket.OPEN;
    
    // Lock out engine echoes during the transition — iPad is source of truth
    transitionActiveRef.current = true;
    // Cancel any previous transition by incrementing the generation
    transitionGenRef.current++;
    const myGen = transitionGenRef.current;

    // 1. Clear solo if active
    if (soloRef.current) {
      soloRef.current = null;
      preSoloStateRef.current = {};
    }

    // 2. Unmute ALL channels via WS only (no HTTP PATCH — avoids disk write + broadcast)
    setChannels(chs => chs.map(c => ({ ...c, enabled: true })));
    for (const c of channelsRef.current) {
      if (!c.enabled && wsOk) {
        ws!.send(JSON.stringify({ type: 'setChannelEnabled', channelId: c.id, enabled: true }));
      }
    }
    
    // 3. Set ALL overlay channels to the transition blend mode via WS only.
    //    savedModesRef is the canonical source — never modified by transitions.
    const currentChannels = channelsRef.current;
    for (const c of currentChannels) {
      if (c.id.startsWith('ch_base')) continue;
      // Protect canonical mode: if missing or invalid, default to 'blend_screen'
      if (!savedModesRef.current[c.id] || savedModesRef.current[c.id].startsWith('trans_')) {
        savedModesRef.current[c.id] = c.mode.startsWith('trans_') ? 'blend_screen' : c.mode;
      }
      if (wsOk) ws!.send(JSON.stringify({ type: 'setChannelMode', channelId: c.id, mode: transMode }));
    }
    const restoreModes = { ...savedModesRef.current };
    
    // 4. Snapshot starting faders for smooth interpolation
    // We intentionally DO NOT update the UI's mode to transMode.
    // The UI should stably display the target blend modes throughout.
    setChannels(chs => chs.map(c => {
      if (c.id.startsWith('ch_base')) return { ...c, enabled: true };
      return { ...c, enabled: true };
    }));

    const startFaders: {[id: string]: number} = {};
    const lastSentFaders: {[id: string]: number} = {};
    currentChannels.forEach(c => { 
      startFaders[c.id] = c.fader; 
      lastSentFaders[c.id] = c.fader; 
    });

    const animate = () => {
      // If a newer transition was started, bail out silently
      if (transitionGenRef.current !== myGen) return;

      const now = Date.now();
      const progress = Math.min((now - startTime) / durationMs, 1.0);
      const ease = progress * progress * (3 - 2 * progress); // smooth-step
      
      // WS fader updates at ~30fps (33ms) to match engine's 40fps render rate
      const needsWsUpdate = now - (throttleRef.current['transition'] || 0) > 33 || progress === 1.0;

      // Always update React state for smooth UI
      setChannels(chs => {
        const next = chs.map(c => {
          if (c.id.startsWith('ch_base') || startFaders[c.id] === undefined) return c;
          const start = startFaders[c.id];
          const target = c.id === targetChannelId ? 1.0 : 0.0;
          const val = start + (target - start) * ease;
          
          if (progress === 1.0) {
            return { ...c, fader: val, mode: restoreModes[c.id] || c.mode };
          }
          return { ...c, fader: val };
        });
        
        // Send WS fader updates at throttled rate
        if (needsWsUpdate && wsOk) {
          throttleRef.current['transition'] = now;
          next.forEach(c => {
            if (c.id.startsWith('ch_base') || startFaders[c.id] === undefined) return;
            if (Math.abs(c.fader - lastSentFaders[c.id]) > 0.005 || progress === 1.0) {
              lastSentFaders[c.id] = c.fader;
              ws!.send(JSON.stringify({ type: 'setChannelFader', channelId: c.id, fader: c.fader }));
              
              if (progress === 1.0) {
                // Restore saved blend mode via WS
                const restoreMode = restoreModes[c.id] || c.mode;
                ws!.send(JSON.stringify({ type: 'setChannelMode', channelId: c.id, mode: restoreMode }));
              }
            }
          });
        }
        return next;
      });
      
      if (progress < 1.0) {
        requestAnimationFrame(animate);
      } else {
        // Single save: persist final state to disk once
        if (wsOk) ws!.send(JSON.stringify({ type: 'saveMixerState' }));
        
        // Unlock engine echoes after a short delay to ensure any in-flight
        // WS broadcasts from the intermediate transition state are swallowed.
        setTimeout(() => {
          transitionActiveRef.current = false;
        }, 500);
      }
    };
    
    requestAnimationFrame(animate);
  }, []);

  return (
    <View style={styles.container}>
      {/* ── Top Header Bar ─────────────────────────────────────────── */}
      <View style={[styles.header, isPortrait && { paddingHorizontal: 8 }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: isPortrait ? 8 : 16 }}>
          <Text style={[styles.brandText, isPortrait && { fontSize: 16 }]}>Marsin Mixer</Text>
          <View style={[styles.statusBadge, isPortrait && { paddingHorizontal: 8, paddingVertical: 4 }]}>
            <View style={[styles.statusDot, !isConnected && {backgroundColor: C.error}]} />
            {!isPortrait && (
              <Text style={[styles.labelCaps, {color: isConnected ? '#00a86b' : C.error}]}>
                {isConnected ? 'CONNECTED' : 'OFFLINE'}
              </Text>
            )}
          </View>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: isPortrait ? 4 : 12 }}>
          {!isPortrait && <Text style={styles.labelCaps}>MASTER</Text>}
          <HorizontalFader 
            value={master} 
            onChange={handleMasterChange} 
            trackStyle={[styles.faderTrack, { width: 180 }]} 
            fillStyle={styles.faderFill} 
          />
          <Text style={[styles.displayMono, {fontSize: 16, width: 36, textAlign: 'right'}, isPortrait && { fontSize: 14, width: 28 }]}>{Math.round(master * 100)}</Text>
          {/* One-tap default add: fastest path */}
          <TouchableOpacity
            style={[styles.addBtn, isPortrait && { paddingHorizontal: 6, paddingVertical: 6 }]}
            onPress={() => handleAddChannelWithPlaylist('default')}
          >
            <Text style={[styles.labelCaps, {color: '#FFF'}, isPortrait && { fontSize: 9 }]}>+ DEFAULT</Text>
          </TouchableOpacity>
          {/* Open the playlist picker for a curated add */}
          <TouchableOpacity
            style={[styles.addBtn, { backgroundColor: C.surfaceContainerHigh, borderWidth: 1, borderColor: C.ghostBorder }, isPortrait && { paddingHorizontal: 6, paddingVertical: 6 }]}
            onPress={openAddChannelPicker}
          >
            <Text style={[styles.labelCaps, {color: C.primary}, isPortrait && { fontSize: 9 }]}>{isPortrait ? '+ PLAYLIST' : '+ FROM PLAYLIST…'}</Text>
          </TouchableOpacity>
        </View>
      </View>

      <CPCControls wsRef={wsRef} />

      {/* ── Master Visualization ────────────────────────────────────── */}
      <View style={{ paddingHorizontal: 16, paddingTop: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <Text style={[styles.labelCaps, { fontSize: 9 }]}>MASTER OUTPUT</Text>
        </View>
        <PixelStrip base64Data={visDataRef.current['master']} height={18} style={{ borderRadius: 6 }} />
      </View>

      {/* ── Channel Strips ─────────────────────────────────────────── */}
      <ScrollView horizontal scrollEnabled={false} contentContainerStyle={{ padding: 16, gap: 16, flexGrow: 1 }} style={{ flex: 1 }}>
        {channels.slice(1).map((channel, idx) => {
          const isSoloActive = soloRef.current === channel.id;
          return (
            <ChannelStrip
              key={channel.id}
              index={idx + 1}
              channel={channel}
              isSolo={isSoloActive}
              isDeck={false}
              blends={blends}
              transitions={transitionsList}
              visData={visDataRef.current[channel.id]}
              onFaderChange={handleFaderChange}
              onMuteToggle={handleMuteToggle}
              onSoloToggle={handleSoloToggle}
              onModeChange={handleModeChange}
              onControlChange={handleControlChange}
              onDelete={handleDeleteChannel}
              onLockToggle={handleLockToggle}
              onTransition={handleTransition}
              onTransitionSettingsChange={handleTransitionSettingsChange}
            />
          );
        })}
        {channels.length === 0 && (
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
            <Text style={[styles.labelCaps, { fontSize: 14 }]}>NO CHANNELS — TAP &quot;+ DEFAULT&quot; OR &quot;+ FROM PLAYLIST&quot;</Text>
          </View>
        )}
      </ScrollView>

      {/* ── Global Rig Controls (Bottom) ───────────────────────────── */}
      <View style={styles.globalRigBar}>
        <RigGlobals variant="mixer" />
      </View>

      {/* ── Add-channel playlist picker ─────────────────────────────── */}
      <Modal transparent visible={addPickerOpen} animationType="fade" onRequestClose={() => setAddPickerOpen(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setAddPickerOpen(false)}>
          <View style={styles.modalContent}>
            <Text style={[styles.labelCaps, {marginBottom: 12}]}>NEW CHANNEL · PICK A PLAYLIST</Text>
            <ScrollView style={{ maxHeight: 360 }}>
              {addPickerPlaylists.map(name => (
                <TouchableOpacity
                  key={name}
                  style={[styles.modalRow, name === 'default' && styles.modalRowActive]}
                  onPress={() => handleAddChannelWithPlaylist(name)}
                >
                  <Text style={[styles.valueReadout, name === 'default' && { color: C.primary }]}>
                    {name === 'default' ? '★ default' : name}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* ── Unlock-dirty prompt ─────────────────────────────────────── */}
      {/* Channel has unsaved param edits made while locked. The user must
          choose to either persist them into the playlist entry or roll
          back to the saved defaults before the lock actually releases. */}
      <Modal transparent visible={!!unlockPrompt} animationType="fade" onRequestClose={() => resolveUnlockPrompt('cancel')}>
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => { if (!unlockPrompt?.pending) resolveUnlockPrompt('cancel'); }}
        >
          <TouchableOpacity activeOpacity={1} onPress={() => {}}>
            <View style={[styles.modalContent, { maxWidth: 420 }]}>
              <Text style={[styles.labelCaps, { marginBottom: 8 }]}>UNSAVED PARAM CHANGES</Text>
              <Text style={{ color: C.text, fontSize: 14, lineHeight: 20, marginBottom: 16 }}>
                <Text style={{ fontFamily: 'SpaceGrotesk_700Bold' }}>{unlockPrompt?.channelName}</Text>
                {' was edited while locked. What should we do with those changes before unlocking?'}
              </Text>
              <View style={{ gap: 8 }}>
                <TouchableOpacity
                  style={[styles.unlockPromptBtn, styles.unlockPromptSave]}
                  onPress={() => resolveUnlockPrompt('save')}
                  disabled={!!unlockPrompt?.pending}
                >
                  <Text style={[styles.unlockPromptBtnText, { color: C.primary }]}>SAVE TO PLAYLIST</Text>
                  <Text style={styles.unlockPromptHint}>Capture current params into the active entry</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.unlockPromptBtn, styles.unlockPromptDiscard]}
                  onPress={() => resolveUnlockPrompt('discard')}
                  disabled={!!unlockPrompt?.pending}
                >
                  <Text style={[styles.unlockPromptBtnText, { color: '#B3261E' }]}>DISCARD CHANGES</Text>
                  <Text style={styles.unlockPromptHint}>Reload saved params from the playlist</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.unlockPromptBtn, styles.unlockPromptCancel]}
                  onPress={() => resolveUnlockPrompt('cancel')}
                  disabled={!!unlockPrompt?.pending}
                >
                  <Text style={[styles.unlockPromptBtnText, { color: C.secondary }]}>KEEP LOCKED</Text>
                  <Text style={styles.unlockPromptHint}>Stay locked, decide later</Text>
                </TouchableOpacity>
              </View>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
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
    // Stretch to the parent ScrollView's height so the playlist column fills
    // the entire visible strip area, regardless of how many entries exist.
    alignSelf: 'stretch',
    ...globalStyles.ambientShadow,
  },
  channelCardLocked: {
    borderColor: 'rgba(245,166,35,0.4)',
    borderWidth: 2,
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
  lockBtn: {
    width: 28, height: 28, borderRadius: 6,
    backgroundColor: C.surfaceContainerLowest,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: C.ghostBorder,
  },
  lockBtnActive: {
    backgroundColor: 'rgba(245,166,35,0.15)',
    borderColor: 'rgba(245,166,35,0.5)',
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
    minHeight: 0,
  },
  patternListPanel: {
    // Wider than params (item 1): the list is the channel's primary surface.
    width: '60%',
    padding: 6,
  },
  paramsPanel: {
    width: '40%',
    padding: 8,
  },
  // Mute / Solo span the full strip width below the body.
  muteSoloRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 4,
    borderTopWidth: 1,
    borderTopColor: C.ghostBorder,
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
  // Transition action + dropdown + time on its own full-width row.
  transitionBar: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingBottom: 12,
    paddingTop: 4,
    gap: 6,
  },
  transitionBtn: {
    backgroundColor: C.secondary,
    borderColor: C.secondary,
    height: 36,
  },
  transitionDetails: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
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
  unlockPromptBtn: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1,
    backgroundColor: C.surfaceContainerLowest,
  },
  unlockPromptSave: {
    borderColor: 'rgba(0,104,117,0.4)',
    backgroundColor: 'rgba(0,104,117,0.08)',
  },
  unlockPromptDiscard: {
    borderColor: 'rgba(179,38,30,0.4)',
    backgroundColor: 'rgba(179,38,30,0.06)',
  },
  unlockPromptCancel: {
    borderColor: C.ghostBorder,
  },
  unlockPromptBtnText: {
    fontFamily: 'SpaceGrotesk_700Bold',
    fontSize: 13,
    letterSpacing: 0.5,
  },
  unlockPromptHint: {
    fontFamily: 'Inter_400Regular',
    fontSize: 11,
    color: C.icon,
    marginTop: 2,
  },
});
