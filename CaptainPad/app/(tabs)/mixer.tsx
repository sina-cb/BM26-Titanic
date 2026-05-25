import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, TextInput, AppState, Modal, useWindowDimensions, Alert } from 'react-native';
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
  fetchPlaylists, fetchViewSelectionOptions,
  captureMixerChannelDefaults, discardMixerChannelDefaults,
  invalidatePlaylistsCache, invalidatePlaylistCache,
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
const ChannelStrip = React.memo(({ channel, index, blends, transitions, isSolo, isDeck, visData, onFaderChange, onMuteToggle, onSoloToggle, onModeChange, onControlChange, onDelete, onLockToggle, onTransition, onTransitionSettingsChange, viewSelectionGroups, onViewSelectionChange }: any) => {
  const [showBlendPicker, setShowBlendPicker] = useState(false);
  const [showTransPicker, setShowTransPicker] = useState(false);
  const [showViewPicker, setShowViewPicker] = useState(false);
  const [transTime, setTransTime] = useState(String(channel.transitionTime || 1.0));
  const [transMode, setTransMode] = useState(channel.transitionMode || "trans_crossfade");
  // Per-strip refresh nonce. Tapping the ↻ arrow on the channel name row
  // bumps this, which propagates to the PlaylistPanel via the
  // `refreshNonce` prop and forces it to re-fetch the playlist library +
  // this channel's playlist content (after busting both caches). This is
  // the operator's one-tap rescue for the "added a 3rd layer and patterns
  // aren't showing" failure mode — instead of having to delete and re-add
  // the channel, just tap the arrow next to the name.
  const [refreshNonce, setRefreshNonce] = useState(0);
  const locked = !!channel.locked;

  // View-selection state read straight from the channel (engine is the
  // source of truth — broadcasts overwrite local state on every mixer
  // event). v1 supports ALL vs one named GROUP per docs/27 §1.
  const viewSel = channel.viewSelection || { type: 'all', target: null, invert: false };
  const viewSelLabel = viewSel.type === 'all'
    ? 'ALL'
    : (viewSel.type === 'group' ? String(viewSel.target || '').toUpperCase() : viewSel.type.toUpperCase());
  return (
    <View style={[styles.channelCard, locked && styles.channelCardLocked]}>
      <BlendModePicker visible={showBlendPicker} current={channel.mode} onSelect={(m: string) => onModeChange(channel.id, m)} onClose={() => setShowBlendPicker(false)} blends={blends} />
      <BlendModePicker visible={showTransPicker} current={transMode} onSelect={(m: string) => { setTransMode(m); onTransitionSettingsChange && onTransitionSettingsChange(channel.id, { transitionMode: m }); }} onClose={() => setShowTransPicker(false)} blends={transitions} title="TRANSITION STYLE" />
      {/* Header */}
      <View style={styles.channelHeader}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
          <View style={styles.channelBadge}>
            <Text style={[styles.valueReadout, { color: C.primary }]}>{index}</Text>
          </View>
          <TextInput
            style={[styles.headlineSm, { fontSize: 14, color: C.text, flex: 1, padding: 0 }]}
            defaultValue={channel.name || 'CH ' + index}
            onEndEditing={(e) => updateMixerChannel(channel.id, { name: e.nativeEvent.text })}
            placeholderTextColor={C.icon}
          />
          {/* Per-channel refresh arrow. Tapped when a freshly-added
              layer didn't render its patterns list (the operator's
              reported failure mode for the 3rd channel add). Busts
              the playlist library cache + this channel's per-name
              playlist cache then re-fires PlaylistPanel.refresh() via
              the `refreshNonce` prop. Sits flush to the right of the
              name textbox so a one-tap rescue is always at hand. */}
          <TouchableOpacity
            onPress={() => {
              invalidatePlaylistsCache();
              const curName = channel.playlist?.name;
              if (curName) invalidatePlaylistCache(curName);
              setRefreshNonce(n => n + 1);
            }}
            accessibilityLabel="Refresh this channel's playlist + patterns list"
            accessibilityRole="button"
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            style={styles.channelRefreshBtn}
          >
            <IconSymbol name="arrow.clockwise" size={12} color={C.secondary} />
          </TouchableOpacity>
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
            initialAssignment={channel.playlist || null}
            refreshNonce={refreshNonce}
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

        {/* View-selection picker (v1: ALL vs GROUP). Tap to cycle ALL →
            each group → ALL. Full group/section/fixture picker UI is a
            follow-up; this is the minimum operator-flippable cut per
            the slot brief. */}
        {!locked && onViewSelectionChange && (
          <>
            <TouchableOpacity
              style={[styles.toggleBtn, viewSel.type !== 'all' && { backgroundColor: C.primary, borderColor: C.primary }]}
              onPress={() => setShowViewPicker(true)}>
              <Text style={[styles.labelCaps, viewSel.type !== 'all' && { color: '#FFF' }, { fontSize: 9 }]}>
                VIEW: {viewSelLabel}
              </Text>
            </TouchableOpacity>
            <Modal transparent visible={showViewPicker} animationType="fade" onRequestClose={() => setShowViewPicker(false)}>
              <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowViewPicker(false)}>
                <View style={styles.modalContent}>
                  <Text style={[styles.labelCaps, { marginBottom: 12 }]}>VIEW SELECTION</Text>
                  <TouchableOpacity
                    style={[styles.modalRow, viewSel.type === 'all' && styles.modalRowActive]}
                    onPress={() => { onViewSelectionChange(channel.id, { type: 'all', target: null, invert: false }); setShowViewPicker(false); }}>
                    <Text style={[styles.valueReadout, viewSel.type === 'all' && { color: C.primary }]}>ALL PIXELS</Text>
                  </TouchableOpacity>
                  {(viewSelectionGroups || []).map((g: string) => {
                    const active = viewSel.type === 'group' && viewSel.target === g;
                    return (
                      <TouchableOpacity
                        key={g}
                        style={[styles.modalRow, active && styles.modalRowActive]}
                        onPress={() => { onViewSelectionChange(channel.id, { type: 'group', target: g, invert: false }); setShowViewPicker(false); }}>
                        <Text style={[styles.valueReadout, active && { color: C.primary }]}>GROUP · {g.toUpperCase()}</Text>
                      </TouchableOpacity>
                    );
                  })}
                  {(viewSelectionGroups || []).length === 0 && (
                    <Text style={[styles.labelCaps, { textAlign: 'center', marginTop: 8 }]}>NO GROUPS IN MODEL</Text>
                  )}
                </View>
              </TouchableOpacity>
            </Modal>
          </>
        )}
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
  // Available view-selection groups (from /model/view-selection-options).
  // Used by the channel-strip view-selection picker. Sections / fixtures
  // / viewMask targets are deferred to a follow-up — v1 ships ALL vs
  // GROUP as the minimum operator-flippable cut. See docs/27 §1.
  const [viewSelectionGroups, setViewSelectionGroups] = useState<string[]>([]);

  const wsRef = useRef<WebSocket | null>(null);
  const apiBaseRef = useRef('');
  // globalExports fetching moved to GlobalParams.tsx
  const throttleRef = useRef<{[key: string]: number}>({});
  const visDataRef = useRef<{[key: string]: string | null}>({});
  const [visVersion, setVisVersion] = useState(0);
  const lastVisUpdateRef = useRef(0);
  // Note: previous versions tracked an `transitionActiveRef` echo-lockout
  // and a `transitionGenRef` cancellation token here. Both are gone —
  // transitions are now driven server-side (see handleTransition), so the
  // client just trusts every incoming mixer broadcast and the engine
  // handles cancellation natively when a new triggerMixerTransition lands.
  //
  // Per-channel "I just wrote this locally" timestamps. When the user
  // drags a slider we stamp the channel; broadcasts arriving within
  // LOCAL_WRITE_HOLD_MS afterward keep the local fader value instead of
  // snapping back to the stale broadcast value. This protects the
  // operator's finger against in-flight 10 Hz progress broadcasts that
  // were emitted just before their drag cancelled the transition.
  // Agent review (May 2026) §5.
  const localFaderWriteRef = useRef<{[id: string]: number}>({});
  const LOCAL_WRITE_HOLD_MS = 400;
  // Canonical blend modes per channel — only updated by engine state or user mode changes.
  // Transitions never touch this, so it always reflects the "true" saved blend mode.
  const savedModesRef = useRef<{[id: string]: string}>({});
  // Engine's canonical base/deck channel id (e.g. ch_base_1778870620551). Used
  // by handleTransition to robustly identify the deck channel — string-prefix
  // matching against "ch_base" is the legacy fallback only.
  const baseChannelIdRef = useRef<string | null>(null);
  // Engine-reported max channel cap (mirror of mixer.maxChannels from
  // config.yaml). Surfaced in the Alert when the user hits the cap so they
  // see the real number, not a stale UI constant.
  const maxChannelsRef = useRef<number>(3);

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
            if (msg.baseChannelId) baseChannelIdRef.current = msg.baseChannelId;
            if (typeof msg.maxChannels === 'number') maxChannelsRef.current = msg.maxChannels;
            // Always trust the engine: it owns transitions, mute/solo
            // bookkeeping, and saved state. The 10 Hz progress broadcasts
            // that arrive during a server-side transition animate the
            // slider UI smoothly.
            //
            // EXCEPTION: a channel the user just dragged (within
            // LOCAL_WRITE_HOLD_MS) keeps its local fader value. This
            // protects the slider from snapping back to a stale in-flight
            // broadcast that was emitted milliseconds before the drag
            // landed on the engine. The rest of the broadcast (enabled,
            // mode, exports, …) still applies normally.
            const incoming = msg.channels || [];
            const now = Date.now();
            setChannels(prev => {
              const prevById: { [id: string]: any } = {};
              for (const c of prev) prevById[c.id] = c;
              return incoming.map((ch: any) => {
                const localTs = localFaderWriteRef.current[ch.id] || 0;
                if (now - localTs < LOCAL_WRITE_HOLD_MS && prevById[ch.id]) {
                  return { ...ch, fader: prevById[ch.id].fader };
                }
                return ch;
              });
            });
            for (const ch of incoming) {
              if (ch.id && ch.mode && !ch.mode.startsWith('trans_')) savedModesRef.current[ch.id] = ch.mode;
            }
            // ── WS-driven add button clear ──────────────────────────
            // If we're waiting on an in-flight add, check if the
            // broadcast contains an id we DIDN'T know about when
            // the user tapped. That id IS the newly-added channel
            // — the engine has confirmed the add, so the "ADDING…"
            // label can flip back to "+ DEFAULT" immediately
            // (typically before the HTTP POST response even
            // finishes parsing). This is what makes the button
            // feel instant under load.
            const pending = pendingAddRef.current;
            if (pending) {
              let newlyAdded = false;
              for (const ch of incoming) {
                if (ch.id && !pending.knownIds.has(ch.id)) {
                  newlyAdded = true;
                  break;
                }
              }
              if (newlyAdded) {
                pendingAddRef.current = null;
                addBusyRef.current = false;
                setAddBusy(false);
              }
            }
          } else if (msg.type === 'vis') {
            visDataRef.current = msg.vis || {};
            // The engine throttles vis broadcasts to `vis.broadcastHz`
            // (config.yaml, default 1 Hz). At 1 Hz we don't need any
            // client-side rate limiting — the previous 5 Hz throttle
            // here was a defence against the legacy 10 Hz cadence
            // that was making the iPad strip re-render 50× faster
            // than the operator needed. Force a re-render every
            // broadcast so the strip always reflects the latest
            // frame; for higher engine rates we still cap at 5 Hz
            // so the iPad doesn't melt.
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

    // Cache view-selection options (groups only for v1). Failure is
    // non-fatal: the strip falls back to a disabled picker that just
    // shows "ALL" if the engine can't enumerate.
    const vsRes = await fetchViewSelectionOptions();
    if (vsRes.ok && vsRes.data) setViewSelectionGroups(vsRes.data.groups || []);

    const mRes = await fetchMixerState();
    if (mRes.ok && mRes.data) {
      setMaster(mRes.data.master);
      if (mRes.data.baseChannelId) baseChannelIdRef.current = mRes.data.baseChannelId;
      if (typeof mRes.data.maxChannels === 'number') maxChannelsRef.current = mRes.data.maxChannels;
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
    // Stamp BEFORE the WS send so any racing broadcast that arrives
    // during the round-trip is held off the slider's last finger position.
    localFaderWriteRef.current[channelId] = Date.now();
    setChannels(chs => chs.map(c => c.id === channelId ? { ...c, fader: level } : c));
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      // The engine's setChannelFader handler cancels any in-flight
      // transition for this channel automatically (see api_server.js),
      // so dragging a slider during a transition stops that channel's
      // server-side animation cleanly.
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
    // Mute remains interactive at all times — the operator must always be
    // able to drop a channel even during a transition. "Transitions take
    // precedence over mute/solo" is enforced at *transition start* time
    // (force-enable + clear solo); after that, the operator's manual
    // mute/solo input wins.
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
    // Solo remains interactive at all times (see handleMuteToggle).
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
  // ── "ADDING…" button state machine ───────────────────────────────────
  //
  // The previous design awaited the HTTP POST response before
  // clearing addBusy. That was correct in theory (try/finally always
  // runs) but visually broken: under heavy WS load the iPad's JS
  // thread is starved processing 10 Hz mixer + vis broadcasts, so
  // the fetch promise's continuation can sit in the microtask queue
  // for hundreds of ms behind those broadcasts. The button felt
  // stuck even though the engine had already created the channel.
  //
  // The fix: decouple the button state from HTTP timing. The button
  // is cleared by whichever signal arrives first —
  //
  //   A. The WS `mixer` broadcast that lists the NEW channel id
  //      (~10ms after the engine's POST handler runs; sometimes
  //      arrives BEFORE the HTTP response is fully parsed).
  //   B. The HTTP response itself (POST result, OK or error).
  //
  // Both paths clear the same single source of truth. The button is
  // therefore guaranteed to be released as soon as the engine
  // confirms the channel exists, regardless of which transport the
  // confirmation arrives on. No watchdog needed.
  //
  // pendingAddRef holds the ids we knew about at the moment the
  // user tapped — when a mixer broadcast arrives with a channel
  // whose id is NOT in that set, we know the add succeeded. We use
  // an id-set (not a counter) so concurrent remove+add operations
  // can't confuse the matcher.
  const addBusyRef = useRef(false);
  const [addBusy, setAddBusy] = useState(false);
  const pendingAddRef = useRef<{ knownIds: Set<string> } | null>(null);
  const clearAddBusy = useCallback(() => {
    pendingAddRef.current = null;
    addBusyRef.current = false;
    setAddBusy(false);
  }, []);

  const openAddChannelPicker = async () => {
    if (addBusyRef.current) return;
    addBusyRef.current = true;
    setAddBusy(true);
    try {
      const lib = await fetchPlaylists();
      setAddPickerPlaylists(lib.ok && lib.data ? lib.data : ['default']);
      setAddPickerOpen(true);
    } finally {
      addBusyRef.current = false;
      setAddBusy(false);
    }
  };

  const handleAddChannelWithPlaylist = (playlistName: string) => {
    if (addBusyRef.current) return;
    addBusyRef.current = true;
    setAddBusy(true);
    setAddPickerOpen(false);

    // Snapshot the channel ids we know about right NOW. The WS
    // handler in connectWebSocket() above will spot the newly-added
    // id when the engine's mixer broadcast lands and call
    // clearAddBusy().
    pendingAddRef.current = {
      knownIds: new Set(channelsRef.current.map((c) => c.id as string)),
    };

    // Fire the POST as fire-and-forget. The button is decoupled
    // from this promise's resolution — clearAddBusy() will fire
    // from the WS handler the moment the engine confirms the add,
    // typically faster than the HTTP response parses on the iPad.
    // We still observe the response so we can show an alert if the
    // engine rejected the add (over capacity, playlist missing,
    // etc.); that path also calls clearAddBusy() defensively.
    //
    // Both transports use fetchWithTimeout (8s AbortController) /
    // the WS connection's own keepalive, so there is NO codepath
    // where addBusy can remain set indefinitely. Worst case (WS
    // dropped a frame AND HTTP timed out): clearAddBusy fires from
    // the timeout-induced rejection. No watchdog needed.
    void addMixerChannel({
      playlist: playlistName,
      name: playlistName === 'default' ? 'New Layer' : playlistName,
      mode: 'blend_screen',
      fader: 1.0,
    }).then((result) => {
      if (!result.ok) {
        clearAddBusy();
        Alert.alert(
          'Add channel failed',
          result.error || 'Engine did not accept the new channel. Check that the engine is running and reachable, then try again.',
        );
      } else {
        // Idempotent clear — the WS handler probably already
        // cleared addBusy by the time this HTTP continuation runs,
        // but if not, this is the second guaranteed clear path.
        clearAddBusy();
      }
    }).catch((err) => {
      clearAddBusy();
      Alert.alert('Add channel failed', err?.message || String(err));
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

  // Per-channel view-selection update. Optimistic local apply + PATCH;
  // the engine validates and broadcasts a fresh `mixer` event with the
  // committed value, so a rejected PATCH (e.g. unknown group) is
  // visually corrected on the next broadcast. v1 ships ALL vs GROUP.
  const handleViewSelectionChange = useCallback((channelId: string, viewSelection: any) => {
    setChannels(chs => chs.map(c => c.id === channelId ? { ...c, viewSelection } : c));
    updateMixerChannel(channelId, { viewSelection }).catch(() => {});
  }, []);

  // ─────────────────────────────────────────────────────────────────────
  // handleTransition — server-driven (May 2026, third rewrite)
  //
  // What used to be ~150 lines of rAF + WS-throttle + ease-curve math
  // collapses to a single triggerMixerTransition WS message. The
  // marsin_engine owns the entire fader animation:
  // pattern_mixer.triggerMixerTransition() force-enables every overlay,
  // schedules a smooth-step interpolation for each channel, and ticks
  // them at the engine's 40 Hz render rate inside updateTransitions().
  // The engine then throttles the resulting mixer broadcasts to 10 Hz so
  // the iPad sliders animate smoothly without flooding the WS connection.
  //
  // Why this fixes the stepping/jumping the operator was seeing:
  //   - The DMX/SACN output is updated EVERY engine tick (40 Hz) with
  //     the smooth-step-interpolated fader value. No throttle dead-zones,
  //     no WS jitter, no rAF stepping.
  //   - Smooth-step (3t² − 2t³) is symmetric: derivative is 0 at both
  //     endpoints. Winner (start→1) and losers (start→0) ride the SAME
  //     curve in their respective directions, so brightness evolves
  //     symmetrically — no "creep then snap" artifacts that the
  //     asymmetric sin/cos pair produced.
  //   - The previous 250 ms echo lockout is gone. The iPad trusts every
  //     mixer broadcast unconditionally (with a tiny per-channel guard
  //     to protect against stale broadcasts arriving milliseconds after
  //     a user's slider drag — see localFaderWriteRef), so the final
  //     mixer-state broadcast that lands ~5 ms after the engine
  //     completes the transition snaps the UI into perfect sync
  //     immediately.
  //
  // See agent diagnostic "Mixer Transition Behavior Analysis" (May 2026)
  // for the full root-cause breakdown of the previous client-driven
  // implementation, and the agent review of the server-side plan for
  // why we use smooth-step (not sin/cos) + a single per-group completion
  // callback + manual-fader cancellation.
  //
  // `transMode` is the user-selected trans_* blend script (trans_flash,
  // trans_dissolve, trans_iris, trans_wipe_left/right/up, or
  // trans_crossfade). The engine swaps the target channel's blend mode
  // to this script for the duration of the fade so the visual effect
  // (flash white at midpoint, random-pixel dissolve, iris open, wipe
  // edge…) plays out across the requested time. trans_crossfade keeps
  // the cheaper fader-only smoothstep behavior (no script swap). See
  // pattern_mixer.triggerMixerTransition() for the full contract.
  // ─────────────────────────────────────────────────────────────────────
  const handleTransition = useCallback((targetChannelId: string, durationSec: number, transMode: string, _originalMode: string) => {
    const durationMs = Math.max(1, Math.min(30000, Math.round(durationSec * 1000)));
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.warn('[Mixer] Transition aborted: WS not open');
      return;
    }
    // Defensive: trans_* dropdown strings only. Anything else falls back
    // to crossfade so a stale UI state can't break the transition.
    const safeTransMode = (typeof transMode === 'string' && transMode.startsWith('trans_'))
      ? transMode
      : 'trans_crossfade';
    // Clear solo client-side so the SOLO button visually pops back to off
    // immediately. The engine's triggerMixerTransition() force-enables
    // every overlay and broadcasts the new state within 100 ms, but the
    // operator shouldn't have to wait that long to see the badge clear.
    soloRef.current = null;
    preSoloStateRef.current = {};
    ws.send(JSON.stringify({
      type: 'triggerMixerTransition',
      targetChannelId,
      durationMs,
      curve: 'smoothstep',
      mode: 'exclusiveOverlays',
      transitionMode: safeTransMode,
    }));
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
          {/* One-tap default add: fastest path. disabled+opacity gives the
              operator visual feedback while the POST is in flight, so they
              don't mash and queue 5 of them. */}
          <TouchableOpacity
            style={[styles.addBtn, isPortrait && { paddingHorizontal: 6, paddingVertical: 6 }, addBusy && { opacity: 0.5 }]}
            onPress={() => handleAddChannelWithPlaylist('default')}
            disabled={addBusy}
          >
            <Text style={[styles.labelCaps, {color: '#FFF'}, isPortrait && { fontSize: 9 }]}>{addBusy ? 'ADDING…' : '+ DEFAULT'}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.addBtn, { backgroundColor: C.surfaceContainerHigh, borderWidth: 1, borderColor: C.ghostBorder }, isPortrait && { paddingHorizontal: 6, paddingVertical: 6 }, addBusy && { opacity: 0.5 }]}
            onPress={openAddChannelPicker}
            disabled={addBusy}
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
      {/* Post-channel-split: /mixer.channels[] contains ONLY mixer
          overlays (the deck channel lives on /deck/channel). We
          iterate the array directly — no `.slice(1)` skip-the-deck
          dance. The engine's HIL test (hil_channel_isolation_test)
          guards this invariant. */}
      <ScrollView horizontal scrollEnabled={false} contentContainerStyle={{ padding: 16, gap: 16, flexGrow: 1 }} style={{ flex: 1 }}>
        {channels.map((channel, idx) => {
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
              viewSelectionGroups={viewSelectionGroups}
              onViewSelectionChange={handleViewSelectionChange}
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
  channelRefreshBtn: {
    width: 22, height: 22, borderRadius: 5,
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
