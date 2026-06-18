// OSC Config tab — operator surface for the engine's OSC listener.
//
// Sections:
//   1. STATUS — live pill (matches the deck banner state) + last sender
//   2. MASTER ENABLE / DISABLE
//   3. PORT / HOST — editable; PATCH stops + respawns the listener
//      bound to the new socket. Stays sticky for the run; persisting
//      to config.yaml is intentionally out of scope (config.yaml is
//      operator-hand-edited between shows).
//   4. ALLOWED SENDERS — name + ip pairs. Empty allow-list means
//      "accept from anyone" (the engine documents this in OscListener).
//   5. METRICS — bindings count + per-sec rx/mapped/dropped (read-only)

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput,
  ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { usePalette } from '@/hooks/use-theme';
import { Palette } from '@/constants/theme';
import { useGlobalStyles, GlobalStyles } from '@/styles/globalStyles';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { fetchOscConfig, patchOscConfig, getApiBaseAsync } from '@/utils/api';
import { useOscStatus } from '@/hooks/useEngineState';

const ACCENT_AUTO = '#1b9e77';

interface OscConfig {
  enabled: boolean;
  port: number | null;
  host: string | null;
  gainMax: number | null;
  allowedSenders: { name: string; ip: string }[];
  bindingsCount: number;
  running: boolean;
  status?: any;
}

// ── Audio Companion identity ─────────────────────────────────────────────
//
// The Marsin Audio Companion runs alongside the engine on the operator's
// machine and streams the curated /marsin/* audio signals into the engine's
// CPC over loopback OSC. The raw socket sender the engine reports is
// `osc:<name>` (when the packet origin is an allow-listed sender) or
// `osc:<ip>:<port>` (raw). We surface the human-friendly "Audio Companion"
// identity ONLY when the evidence supports it — a loopback sender AND active
// mapped throughput on the curated addresses — so we never mislabel a real
// remote sender (e.g. LX Studio on another box). Otherwise we lead with the
// raw socket details unchanged.
//
// `lastSender` shapes (see marsin_engine/lib/osc_listener.js):
//   osc:127.0.0.1:60583   raw loopback origin
//   osc:Companion         allow-listed origin named "Companion"
// Loopback is normalized engine-side to 127.0.0.1 (::1 / ::ffff:127.0.0.1
// all collapse to it), so a host check on 127.0.0.1 / localhost is enough.

interface CompanionIdentity {
  /** True when the evidence supports labelling the stream as the Companion. */
  isCompanion: boolean;
  /** The loopback host to show (e.g. "127.0.0.1"), when known. */
  host: string | null;
}

function senderHost(lastSender: string | null): string | null {
  if (!lastSender) return null;
  // Strip the leading "osc:" tag, then take the host portion. A named
  // allow-list origin ("osc:Companion") has no host — return the name so
  // the caller can still match a literal "companion" name if present.
  const body = lastSender.startsWith('osc:') ? lastSender.slice(4) : lastSender;
  // host:port → host (only split on the LAST colon to keep IPv6 intact;
  // loopback is normalized to IPv4 127.0.0.1 upstream so this is simple).
  const lastColon = body.lastIndexOf(':');
  if (lastColon > 0) {
    const maybePort = body.slice(lastColon + 1);
    if (/^\d+$/.test(maybePort)) return body.slice(0, lastColon);
  }
  return body;
}

function isLoopbackHost(host: string | null): boolean {
  if (!host) return false;
  const h = host.toLowerCase();
  return h === '127.0.0.1' || h === 'localhost' || h === '::1';
}

// Decide whether the live stream is the Audio Companion. Evidence required:
// a loopback sender (or an allow-list origin literally named for the
// companion) AND active MAPPED throughput on the curated /marsin/* bindings.
// No mapped traffic → we don't claim it, even on loopback (could be stray
// unmapped packets from a local debug tool).
function companionIdentity(stats: {
  lastSender: string | null;
  mappedMessagesPerSec: number;
} | null): CompanionIdentity {
  if (!stats) return { isCompanion: false, host: null };
  const host = senderHost(stats.lastSender);
  const loopback = isLoopbackHost(host);
  const namedCompanion = typeof host === 'string' && /companion/i.test(host);
  const mappedActive = (stats.mappedMessagesPerSec ?? 0) > 0;
  const isCompanion = mappedActive && (loopback || namedCompanion);
  return { isCompanion, host: loopback ? host : null };
}

function makeCard(C: Palette, globalStyles: GlobalStyles) {
  return {
    ...globalStyles.card,
    padding: 20,
    marginBottom: 20,
    alignSelf: 'stretch' as const,
    ...globalStyles.ambientShadow,
  };
}

function makeSubCard(C: Palette) {
  return {
    backgroundColor: C.surfaceContainerLow,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.ghostBorder,
    padding: 14,
    marginTop: 12,
  } as const;
}

function makeInputStyle(C: Palette) {
  return {
    backgroundColor: C.surfaceContainerLowest,
    color: C.text,
    height: 44,
    borderRadius: 8,
    paddingHorizontal: 12,
    fontFamily: 'Inter_400Regular' as const,
    fontSize: 14,
    borderWidth: 1,
    borderColor: C.ghostBorder,
  };
}

function SectionHeader({ icon, title, hint, right }: {
  icon: string; title: string; hint?: string; right?: React.ReactNode;
}) {
  const C = usePalette();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 16, gap: 12 }}>
      <View style={{
        width: 36, height: 36, borderRadius: 8,
        backgroundColor: C.primaryContainer, alignItems: 'center', justifyContent: 'center',
      }}>
        <IconSymbol name={icon as any} size={20} color={C.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 16, color: C.text, letterSpacing: 0.8 }}>
          {title}
        </Text>
        {hint ? (
          <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 12, color: C.secondary, marginTop: 2 }}>
            {hint}
          </Text>
        ) : null}
      </View>
      {right ? <View>{right}</View> : null}
    </View>
  );
}

function SubHeader({ title, right }: { title: string; right?: React.ReactNode }) {
  const C = usePalette();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
      <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 11, color: C.secondary, textTransform: 'uppercase', letterSpacing: 1 }}>
        {title}
      </Text>
      {right ?? null}
    </View>
  );
}

function MasterToggle({ on, busy, onPress, label, subtitle }: {
  on: boolean; busy?: boolean; onPress: () => void; label: string; subtitle?: string;
}) {
  const C = usePalette();
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={busy}
      style={{
        flexDirection: 'row', alignItems: 'center', gap: 14,
        paddingVertical: 14, paddingHorizontal: 18, borderRadius: 12,
        backgroundColor: on ? ACCENT_AUTO : C.surfaceContainerHigh,
        borderWidth: 1, borderColor: on ? ACCENT_AUTO : C.ghostBorder,
        opacity: busy ? 0.7 : 1,
      }}
    >
      <View style={{
        width: 22, height: 22, borderRadius: 11,
        backgroundColor: on ? '#000' : C.surface,
        borderWidth: 2, borderColor: on ? '#000' : C.ghostBorder,
        alignItems: 'center', justifyContent: 'center',
      }}>
        {on ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: ACCENT_AUTO }} /> : null}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 13, color: on ? '#000' : C.text, textTransform: 'uppercase', letterSpacing: 0.8 }}>
          {label}
        </Text>
        {subtitle ? (
          <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 11, color: on ? '#000' : C.secondary, marginTop: 2 }}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {busy ? <ActivityIndicator size="small" color={on ? '#000' : C.primary} /> : null}
    </TouchableOpacity>
  );
}

export default function OscConfigScreen() {
  const globalStyles = useGlobalStyles();
  const C = usePalette();
  const CARD = useMemo(() => makeCard(C, globalStyles), [C, globalStyles]);
  const SUB_CARD = useMemo(() => makeSubCard(C), [C]);
  const INPUT_STYLE = useMemo(() => makeInputStyle(C), [C]);
  const liveStatus = useOscStatus();
  const [cfg, setCfg] = useState<OscConfig | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [patchError, setPatchError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Local-only draft state for port/host so typing doesn't fire PATCH
  // on every keystroke. Committed via the explicit APPLY button.
  const [portDraft, setPortDraft] = useState<string>('');
  const [hostDraft, setHostDraft] = useState<string>('');

  // Allowed-senders editing — same model: stage locally, commit explicitly.
  const [sendersDraft, setSendersDraft] = useState<{ name: string; ip: string }[]>([]);
  const [newSenderName, setNewSenderName] = useState('');
  const [newSenderIp, setNewSenderIp] = useState('');

  const reload = useCallback(async () => {
    await getApiBaseAsync();
    const r = await fetchOscConfig();
    if (r.ok) {
      const d = r.data as OscConfig;
      setCfg(d); setLoadError(null);
      setPortDraft(d.port != null ? String(d.port) : '');
      setHostDraft(d.host ?? '');
      setSendersDraft(Array.isArray(d.allowedSenders) ? [...d.allowedSenders] : []);
    } else {
      setLoadError(r.error || 'unknown error');
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const toggleEnabled = useCallback(async () => {
    if (!cfg) return;
    setBusy('enable');
    setCfg(prev => prev && ({ ...prev, enabled: !prev.enabled }));
    const r = await patchOscConfig({ enabled: !cfg.enabled });
    setBusy(null);
    if (!r.ok) { setPatchError(r.error || 'failed to toggle'); reload(); }
    else { setPatchError(null); reload(); }
  }, [cfg, reload]);

  const applyBind = useCallback(async () => {
    if (!cfg) return;
    const partial: any = {};
    const p = parseInt(portDraft, 10);
    if (Number.isInteger(p) && p > 0 && p < 65536 && p !== cfg.port) partial.port = p;
    if (hostDraft && hostDraft !== cfg.host) partial.host = hostDraft;
    if (Object.keys(partial).length === 0) return;
    setBusy('bind');
    const r = await patchOscConfig(partial);
    setBusy(null);
    if (!r.ok) { setPatchError(r.error || 'failed to apply'); reload(); }
    else { setPatchError(null); reload(); }
  }, [cfg, portDraft, hostDraft, reload]);

  const addSender = useCallback(() => {
    const name = newSenderName.trim();
    const ip = newSenderIp.trim();
    if (!name || !ip) return;
    setSendersDraft(prev => [...prev, { name, ip }]);
    setNewSenderName(''); setNewSenderIp('');
  }, [newSenderName, newSenderIp]);

  const removeSender = useCallback((idx: number) => {
    setSendersDraft(prev => prev.filter((_, i) => i !== idx));
  }, []);

  const applySenders = useCallback(async () => {
    setBusy('senders');
    const r = await patchOscConfig({ allowedSenders: sendersDraft });
    setBusy(null);
    if (!r.ok) { setPatchError(r.error || 'failed to apply'); reload(); }
    else { setPatchError(null); reload(); }
  }, [sendersDraft, reload]);

  // ── Derived ────────────────────────────────────────────────────────
  const sendersDirty =
    cfg && (
      sendersDraft.length !== cfg.allowedSenders.length ||
      sendersDraft.some((s, i) => s.name !== cfg.allowedSenders[i]?.name || s.ip !== cfg.allowedSenders[i]?.ip)
    );
  const bindDirty = cfg && (
    portDraft !== String(cfg.port ?? '') || (hostDraft ?? '') !== (cfg.host ?? '')
  );

  // useOscStatus returns { state, label, stats } per OscPillState.
  // The throughput counters and lastSender live on `stats`, not at the
  // top level — earlier code accessed them as liveStatus.rxMessagesPerSec
  // etc. (always undefined → 0), so the OSC tab silently showed 0/0/0/0
  // even when the deck/mixer status pill correctly reported live
  // traffic. Operator bug May 26 2026.
  const pillState = liveStatus?.state ?? null;
  const oscStats = liveStatus?.stats ?? null;
  // Human-friendly sender identity — only labelled as the Audio Companion
  // when the evidence supports it (loopback sender + active mapped
  // throughput). Otherwise we lead with the raw socket details unchanged.
  const companion = useMemo(() => companionIdentity(oscStats), [oscStats]);
  const pillColor =
    pillState === 'live'      ? ACCENT_AUTO :
    pillState === 'unmapped'  ? C.error :
    pillState === 'idle'      ? C.error :
    pillState === 'off'       ? C.icon :
    C.icon;

  // ── Render ─────────────────────────────────────────────────────────
  if (loadError) {
    return (
      <View style={globalStyles.container}>
        <ScrollView contentContainerStyle={{ padding: 48 }} style={{ flex: 1 }}>
          <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: C.error, marginBottom: 8 }}>
            OSC CONFIG UNAVAILABLE
          </Text>
          <Text style={{ fontFamily: 'Inter_400Regular', color: C.text }}>{loadError}</Text>
          <TouchableOpacity onPress={reload} style={{ marginTop: 16, padding: 12, backgroundColor: C.primary, borderRadius: 8, alignSelf: 'flex-start' }}>
            <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: '#fff' }}>RETRY</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    );
  }
  if (!cfg) {
    return (
      <View style={globalStyles.container}>
        <ScrollView contentContainerStyle={{ padding: 48, alignItems: 'center' }} style={{ flex: 1 }}>
          <ActivityIndicator size="large" color={C.primary} />
          <Text style={{ fontFamily: 'Inter_400Regular', color: C.icon, marginTop: 16 }}>Loading OSC config…</Text>
        </ScrollView>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={globalStyles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 32, paddingBottom: 120 }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 32, gap: 16 }}>
          <IconSymbol name="antenna.radiowaves.left.and.right" size={32} color={C.primary} />
          <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 28, color: C.text, letterSpacing: 1.5 }}>
            OSC
          </Text>
        </View>

        {patchError ? (
          <View style={{ ...CARD, borderColor: C.error, backgroundColor: 'rgba(186, 26, 26, 0.06)' }}>
            <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: C.error, fontSize: 11, marginBottom: 4 }}>
              REQUEST REJECTED
            </Text>
            <Text style={{ fontFamily: 'Inter_400Regular', color: C.text, fontSize: 12 }}>{patchError}</Text>
          </View>
        ) : null}

        {/* ── 1. STATUS ────────────────────────────────────────────── */}
        <View style={CARD}>
          <SectionHeader
            icon="antenna.radiowaves.left.and.right"
            title="LISTENER STATUS"
            hint="Live socket health on the engine machine."
          />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: pillColor }} />
            <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 15, color: C.text }}>
              {cfg.running ? (pillState ?? 'running').toString().toUpperCase() : 'OFF'}
            </Text>
            <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 12, color: C.secondary }}>
              {cfg.running ? `${cfg.host}:${cfg.port}` : '—'}
            </Text>
          </View>
          {companion.isCompanion ? (
            <View style={{ marginBottom: 4 }}>
              <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 12, color: C.text }}>
                Source: 🎛 <Text style={{ color: ACCENT_AUTO }}>Audio Companion</Text>
                {companion.host ? <Text style={{ color: C.secondary }}> ({companion.host})</Text> : null}
              </Text>
              <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 11, color: C.secondary, marginTop: 2 }}>
                Audio Companion is streaming {oscStats?.mappedMessagesPerSec ?? 0} signals/sec into CPC.
              </Text>
              {oscStats?.lastSender ? (
                <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 10, color: C.icon, marginTop: 2 }}>
                  Socket: <Text style={{ color: C.secondary }}>{oscStats.lastSender}</Text>
                </Text>
              ) : null}
            </View>
          ) : oscStats?.lastSender ? (
            <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 11, color: C.icon }}>
              Last sender: <Text style={{ color: C.text }}>{oscStats.lastSender}</Text>
            </Text>
          ) : null}
          <View style={SUB_CARD}>
            <SubHeader title="THROUGHPUT (PER SEC)" />
            <View style={{ flexDirection: 'row', gap: 24 }}>
              {([
                { label: 'RX',      value: oscStats?.rxMessagesPerSec ?? 0,      color: C.text },
                { label: 'MAPPED',  value: oscStats?.mappedMessagesPerSec ?? 0,  color: ACCENT_AUTO },
                { label: 'DROPPED', value: oscStats?.droppedMessagesPerSec ?? 0, color: C.error },
                { label: 'INVALID', value: oscStats?.invalidMessagesPerSec ?? 0, color: C.error },
              ] as const).map(({ label, value, color }) => (
                <View key={label}>
                  <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10, color: C.secondary, textTransform: 'uppercase', letterSpacing: 0.6 }}>
                    {label}
                  </Text>
                  <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 18, color, marginTop: 2 }}>
                    {value}
                  </Text>
                </View>
              ))}
            </View>
            <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 11, color: C.icon, marginTop: 10 }}>
              Bindings: <Text style={{ color: C.text }}>{cfg.bindingsCount}</Text>
              {cfg.gainMax != null ? <>  ·  gain max: <Text style={{ color: C.text }}>{cfg.gainMax}</Text></> : null}
            </Text>
          </View>
        </View>

        {/* ── 2. ENABLE / DISABLE ──────────────────────────────────── */}
        <View style={CARD}>
          <SectionHeader
            icon="power"
            title="ENABLE LISTENER"
            hint="Disabling stops the UDP socket. Stems and BPM-sync will go silent."
          />
          <MasterToggle
            on={cfg.enabled}
            busy={busy === 'enable'}
            onPress={toggleEnabled}
            label={cfg.enabled ? '● ENABLED' : 'DISABLED'}
            subtitle={cfg.enabled
              ? `Bound to ${cfg.host}:${cfg.port}`
              : 'Tap to start the OSC listener.'}
          />
        </View>

        {/* ── 3. SOCKET ────────────────────────────────────────────── */}
        <View style={CARD}>
          <SectionHeader
            icon="network"
            title="SOCKET"
            hint="UDP bind for the OSC listener. Apply restarts the socket."
            right={
              <TouchableOpacity
                onPress={applyBind}
                disabled={!bindDirty || busy === 'bind'}
                style={{
                  paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8,
                  backgroundColor: bindDirty ? C.primary : C.surfaceContainerHigh,
                  borderWidth: 1, borderColor: bindDirty ? C.primary : C.ghostBorder,
                  opacity: busy === 'bind' ? 0.6 : 1,
                }}
              >
                <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 11, color: bindDirty ? '#fff' : C.secondary, textTransform: 'uppercase', letterSpacing: 0.8 }}>
                  {busy === 'bind' ? 'APPLYING…' : 'Apply'}
                </Text>
              </TouchableOpacity>
            }
          />
          <View style={{ flexDirection: 'row', gap: 16 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10, color: C.secondary, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6 }}>
                Host
              </Text>
              <TextInput
                style={INPUT_STYLE}
                value={hostDraft}
                onChangeText={setHostDraft}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="0.0.0.0"
                placeholderTextColor={C.icon}
              />
            </View>
            <View style={{ width: 130 }}>
              <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10, color: C.secondary, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6 }}>
                Port
              </Text>
              <TextInput
                style={INPUT_STYLE}
                value={portDraft}
                onChangeText={setPortDraft}
                keyboardType="number-pad"
                placeholder="10000"
                placeholderTextColor={C.icon}
              />
            </View>
          </View>
          <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 11, color: C.icon, marginTop: 10 }}>
            Host <Text style={{ color: C.text }}>0.0.0.0</Text> binds all interfaces. Changes are sticky for this engine run but not persisted to config.yaml.
          </Text>
        </View>

        {/* ── 4. ALLOWED SENDERS ───────────────────────────────────── */}
        <View style={CARD}>
          <SectionHeader
            icon="lock.fill"
            title="ALLOWED SENDERS"
            hint="IP allow-list. Empty list = accept from any sender."
            right={
              <TouchableOpacity
                onPress={applySenders}
                disabled={!sendersDirty || busy === 'senders'}
                style={{
                  paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8,
                  backgroundColor: sendersDirty ? C.primary : C.surfaceContainerHigh,
                  borderWidth: 1, borderColor: sendersDirty ? C.primary : C.ghostBorder,
                  opacity: busy === 'senders' ? 0.6 : 1,
                }}
              >
                <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 11, color: sendersDirty ? '#fff' : C.secondary, textTransform: 'uppercase', letterSpacing: 0.8 }}>
                  {busy === 'senders' ? 'APPLYING…' : 'Apply'}
                </Text>
              </TouchableOpacity>
            }
          />

          {sendersDraft.length === 0 ? (
            <View style={{ ...SUB_CARD, marginTop: 0 }}>
              <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 12, color: C.icon }}>
                Allow-list is empty — listener accepts packets from any IP. Add an entry below to lock it down.
              </Text>
            </View>
          ) : (
            sendersDraft.map((s, i) => (
              <View key={`${s.name}:${i}`} style={{
                flexDirection: 'row', alignItems: 'center', gap: 12,
                paddingVertical: 10, paddingHorizontal: 12,
                backgroundColor: C.surfaceContainerLowest, borderRadius: 8, marginTop: 8,
                borderWidth: 1, borderColor: C.ghostBorder,
              }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: C.text, fontSize: 13 }}>{s.name}</Text>
                  <Text style={{ fontFamily: 'Inter_400Regular', color: C.secondary, fontSize: 11 }}>{s.ip}</Text>
                </View>
                <TouchableOpacity
                  onPress={() => removeSender(i)}
                  style={{ paddingHorizontal: 10, paddingVertical: 6 }}
                >
                  <IconSymbol name="trash" size={20} color={C.error} />
                </TouchableOpacity>
              </View>
            ))
          )}

          <View style={SUB_CARD}>
            <SubHeader title="ADD SENDER" />
            <View style={{ flexDirection: 'row', gap: 10, marginBottom: 10 }}>
              <TextInput
                style={[INPUT_STYLE, { flex: 1 }]}
                value={newSenderName}
                onChangeText={setNewSenderName}
                placeholder="name (e.g. LX_STUDIO)"
                placeholderTextColor={C.icon}
                autoCapitalize="characters"
                autoCorrect={false}
              />
              <TextInput
                style={[INPUT_STYLE, { width: 180 }]}
                value={newSenderIp}
                onChangeText={setNewSenderIp}
                placeholder="192.168.1.50"
                placeholderTextColor={C.icon}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="numbers-and-punctuation"
              />
            </View>
            <TouchableOpacity
              onPress={addSender}
              disabled={!newSenderName.trim() || !newSenderIp.trim()}
              style={{
                flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
                paddingVertical: 10, borderRadius: 8,
                backgroundColor: (newSenderName.trim() && newSenderIp.trim()) ? C.primary : C.surfaceContainerHigh,
                borderWidth: 1, borderColor: (newSenderName.trim() && newSenderIp.trim()) ? C.primary : C.ghostBorder,
              }}
            >
              <IconSymbol name="plus.circle" size={18} color={(newSenderName.trim() && newSenderIp.trim()) ? '#fff' : C.secondary} />
              <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 12, color: (newSenderName.trim() && newSenderIp.trim()) ? '#fff' : C.secondary, textTransform: 'uppercase', letterSpacing: 0.8 }}>
                Add to allow-list
              </Text>
            </TouchableOpacity>
          </View>

          <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 11, color: C.icon, marginTop: 12 }}>
            Changes are queued locally. Tap APPLY to push them to the engine and restart the listener with the new allow-list.
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
