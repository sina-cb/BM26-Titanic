// SnapshotBar — named mixer snapshots / look recall (docs/39 §8.1, F-A).
//
// A snapshot ("look") is the FULL mixer state (master + deck + every overlay)
// captured under a name. This bar mounts in the mixer header area and lets the
// operator:
//   - CAPTURE the current look under a name (in-app name prompt; the engine
//     validates the slug and persists atomically).
//   - RECALL a saved look (the engine rebuilds the deck + overlays; the WS
//     `mixer` broadcast reconciles the strips — we do NOT optimistically flip
//     local state).
//   - DELETE a saved look (gated behind ConfirmSheet — destructive).
//
// The names list is reconciled from the WS control-plane `snapshots` event
// ({ action:'saved'|'deleted'|'recalled', name, snapshots }) plus an initial
// GET on mount. Codex P0 — fail loud: capture/recall/delete failures (over-cap
// 400, unknown 404, malformed 400, transport) surface via Alert; the clients
// honour res.ok and never fabricate success.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Modal, TextInput, Alert } from 'react-native';
import { usePalette } from '@/hooks/use-theme';
import { Palette } from '@/constants/theme';
import { ConfirmSheet } from '@/components/ui/ConfirmSheet';
import { engineEvents, type EngineMessage } from '@/utils/engineEvents';
import {
  fetchSnapshots, saveSnapshot, recallSnapshot, recallSnapshotFade, deleteSnapshot,
} from '@/utils/channelExtrasApi';

// Production-console touch target: expand small chips to the 44pt floor.
const HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 } as const;

// Snapshot morph (round-2 #1, docs/39 §10.8): MORPH ramps the recall over a
// chosen duration instead of the instant cut. These are the offered durations
// (seconds); 3s is the default. The engine validates finite > 0.
const MORPH_DURATIONS_S = [1, 3, 5, 10] as const;

// Engine snapshot name rule (docs/39 §8.1): `^[a-z0-9][a-z0-9_-]{0,63}$`.
// We lowercase + strip illegal chars locally so the prompt can preview the
// exact slug the engine will accept (the engine still validates — this is a
// UX nicety, not a substitute for the server check).
function sanitizeSnapshotName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .replace(/^[^a-z0-9]+/, '')
    .slice(0, 64);
}

export function SnapshotBar() {
  const C = usePalette();
  const styles = useMemo(() => makeStyles(C), [C]);

  const [snapshots, setSnapshots] = useState<string[]>([]);
  const [listOpen, setListOpen] = useState(false);
  const [nameOpen, setNameOpen] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [deletePrompt, setDeletePrompt] = useState<string | null>(null);
  // Which row has its MORPH duration pills expanded (snapshot name), or null.
  const [morphRow, setMorphRow] = useState<string | null>(null);

  // Initial seed + WS reconcile. The engine emits `snapshots` on every
  // mutation (save/delete/recall) carrying the fresh sorted list, so we
  // trust msg.snapshots verbatim and only GET on mount as the seed.
  useEffect(() => {
    let alive = true;
    fetchSnapshots().then((res) => {
      if (alive && res.ok && res.data) setSnapshots(res.data);
    });
    const unsub = engineEvents.subscribe((msg: EngineMessage) => {
      if (msg.type === 'snapshots' && Array.isArray(msg.snapshots)) {
        setSnapshots(msg.snapshots as string[]);
      }
    });
    return () => { alive = false; unsub(); };
  }, []);

  const cleanName = sanitizeSnapshotName(nameDraft);
  const nameExists = cleanName.length > 0 && snapshots.includes(cleanName);

  const handleCapture = useCallback(async () => {
    if (!cleanName || busy) return;
    setBusy(true);
    setNameOpen(false);
    const res = await saveSnapshot(cleanName);
    setBusy(false);
    if (!res.ok) {
      console.error('[SnapshotBar] Capture rejected:', res.error);
      Alert.alert('Snapshot not saved', `The engine rejected this look. ${res.error || ''}`.trim());
      return;
    }
    setNameDraft('');
    // The WS `snapshots` event reconciles the list; no optimistic insert.
  }, [cleanName, busy]);

  const handleRecall = useCallback(async (name: string) => {
    setListOpen(false);
    // Recall does NOT optimistically flip local mixer state — the engine
    // rebuilds the deck + overlays and the WS `mixer` broadcast reconciles
    // the strips (docs/39 §4.2). We just fire and surface failures.
    const res = await recallSnapshot(name);
    if (!res.ok) {
      console.error(`[SnapshotBar] Recall rejected for "${name}":`, res.error);
      Alert.alert(
        'Look not recalled',
        `The engine rejected recalling "${name}". ${res.error || ''} `.trim() +
          'A look with more overlays than the channel cap, or a malformed snapshot, cannot be recalled.',
      );
    }
  }, []);

  const handleMorph = useCallback(async (name: string, durationS: number) => {
    setMorphRow(null);
    setListOpen(false);
    // Like recall, the morph does NOT optimistically flip local state — the WS
    // `mixer` broadcast reconciles the strips as the ramp progresses and a
    // recall-fade-complete fires on landing (docs/39 §10.8). Fire + surface
    // failures (404 unknown, 400 over-cap/malformed/bad-duration).
    const res = await recallSnapshotFade(name, Math.round(durationS * 1000));
    if (!res.ok) {
      console.error(`[SnapshotBar] Morph rejected for "${name}":`, res.error);
      Alert.alert(
        'Look not morphed',
        `The engine rejected morphing to "${name}". ${res.error || ''} `.trim() +
          'A look with more overlays than the channel cap, or a malformed snapshot, cannot be recalled.',
      );
    }
  }, []);

  const confirmDelete = useCallback(async () => {
    const name = deletePrompt;
    if (!name) return;
    setDeletePrompt(null);
    const res = await deleteSnapshot(name);
    if (!res.ok) {
      console.error(`[SnapshotBar] Delete rejected for "${name}":`, res.error);
      Alert.alert('Snapshot not deleted', `The engine rejected deleting "${name}". ${res.error || ''}`.trim());
    }
    // WS `snapshots` event reconciles the list on success.
  }, [deletePrompt]);

  return (
    <View style={styles.bar}>
      <Text style={styles.barLabel}>LOOKS</Text>
      <TouchableOpacity
        style={styles.recallBtn}
        hitSlop={HIT_SLOP}
        onPress={() => setListOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`Recall a saved look (${snapshots.length} saved)`}
      >
        <Text style={styles.recallBtnText} numberOfLines={1}>
          RECALL{snapshots.length > 0 ? ` (${snapshots.length})` : ''} ▾
        </Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.captureBtn, busy && { opacity: 0.5 }]}
        hitSlop={HIT_SLOP}
        disabled={busy}
        onPress={() => { setNameDraft(''); setNameOpen(true); }}
        accessibilityRole="button"
        accessibilityLabel="Capture current mixer state as a new look"
      >
        <Text style={styles.captureBtnText}>{busy ? 'SAVING…' : '+ CAPTURE'}</Text>
      </TouchableOpacity>

      {/* ── Recall / delete list ─────────────────────────────────────── */}
      <Modal transparent visible={listOpen} animationType="fade" onRequestClose={() => { setMorphRow(null); setListOpen(false); }}>
        <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={() => { setMorphRow(null); setListOpen(false); }}>
          <TouchableOpacity activeOpacity={1} onPress={() => {}}>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>RECALL A LOOK</Text>
              <Text style={styles.cardHint}>TAP A NAME FOR AN INSTANT CUT, OR ⮕ MORPH TO CROSSFADE OVER N SECONDS.</Text>
              {snapshots.length === 0 ? (
                <Text style={styles.emptyText}>NO SAVED LOOKS — TAP &quot;+ CAPTURE&quot; TO SAVE THE CURRENT MIX</Text>
              ) : (
                <ScrollView style={{ maxHeight: 360 }}>
                  {snapshots.map((name) => (
                    <View key={name}>
                      <View style={styles.row}>
                        <TouchableOpacity
                          style={styles.rowRecall}
                          hitSlop={HIT_SLOP}
                          onPress={() => handleRecall(name)}
                          accessibilityRole="button"
                          accessibilityLabel={`Recall look ${name} (instant cut)`}
                        >
                          <Text style={styles.rowName} numberOfLines={1}>{name}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.rowMorph, morphRow === name && styles.rowMorphActive]}
                          hitSlop={HIT_SLOP}
                          onPress={() => setMorphRow(morphRow === name ? null : name)}
                          accessibilityRole="button"
                          accessibilityLabel={`Morph (crossfade) to look ${name}`}
                        >
                          <Text style={styles.rowMorphText}>MORPH</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.rowDelete}
                          hitSlop={HIT_SLOP}
                          onPress={() => setDeletePrompt(name)}
                          accessibilityRole="button"
                          accessibilityLabel={`Delete look ${name}`}
                        >
                          <Text style={styles.rowDeleteText}>DELETE</Text>
                        </TouchableOpacity>
                      </View>
                      {morphRow === name ? (
                        <View style={styles.morphPills}>
                          <Text style={styles.morphPillsLabel}>CROSSFADE OVER</Text>
                          {MORPH_DURATIONS_S.map((d) => (
                            <TouchableOpacity
                              key={d}
                              style={styles.morphPill}
                              hitSlop={HIT_SLOP}
                              onPress={() => handleMorph(name, d)}
                              accessibilityRole="button"
                              accessibilityLabel={`Morph to ${name} over ${d} seconds`}
                            >
                              <Text style={styles.morphPillText}>{d}s</Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      ) : null}
                    </View>
                  ))}
                </ScrollView>
              )}
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* ── Capture name prompt (in-app modal — RN-web drops Alert
          button callbacks, see ConfirmSheet's note) ──────────────── */}
      <Modal transparent visible={nameOpen} animationType="fade" onRequestClose={() => setNameOpen(false)}>
        <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={() => setNameOpen(false)}>
          <TouchableOpacity activeOpacity={1} onPress={() => {}}>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>CAPTURE LOOK</Text>
              <Text style={styles.hint}>
                {'Name this look. It captures the full mixer state — master, deck, and every overlay.'}
              </Text>
              <TextInput
                value={nameDraft}
                onChangeText={setNameDraft}
                placeholder="look name"
                placeholderTextColor={C.icon}
                autoFocus
                autoCapitalize="none"
                autoCorrect={false}
                onSubmitEditing={() => { if (cleanName) handleCapture(); }}
                returnKeyType="done"
                style={styles.input}
              />
              {cleanName && cleanName !== nameDraft ? (
                <Text style={styles.slugHint}>{`Saved as: ${cleanName}`}</Text>
              ) : null}
              {nameExists ? (
                <Text style={styles.warnText}>{`⚠ "${cleanName}" already exists — capturing will overwrite it.`}</Text>
              ) : null}
              <View style={styles.btnRow}>
                <TouchableOpacity
                  style={styles.cancelBtn}
                  hitSlop={HIT_SLOP}
                  onPress={() => setNameOpen(false)}
                  accessibilityRole="button"
                  accessibilityLabel="Cancel capture"
                >
                  <Text style={[styles.btnText, { color: C.text }]}>CANCEL</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.confirmBtn, !cleanName && { opacity: 0.4 }]}
                  hitSlop={HIT_SLOP}
                  disabled={!cleanName}
                  onPress={handleCapture}
                  accessibilityRole="button"
                  accessibilityLabel="Capture look"
                >
                  <Text style={[styles.btnText, { color: '#FFF' }]}>CAPTURE</Text>
                </TouchableOpacity>
              </View>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* ── Delete confirmation (destructive) ────────────────────────── */}
      <ConfirmSheet
        visible={!!deletePrompt}
        title="Delete look?"
        message={`This permanently removes the saved look "${deletePrompt ?? ''}". The live mix is not affected — only the saved snapshot is deleted.`}
        confirmLabel="DELETE LOOK"
        cancelLabel="CANCEL"
        onConfirm={confirmDelete}
        onCancel={() => setDeletePrompt(null)}
      />
    </View>
  );
}

function makeStyles(C: Palette) {
  return {
    bar: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: 6,
    },
    barLabel: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 10,
      letterSpacing: 1.2,
      color: C.secondary,
      textTransform: 'uppercase' as const,
    },
    recallBtn: {
      minHeight: 28,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 8,
      backgroundColor: C.surfaceContainerHigh,
      borderWidth: 1,
      borderColor: C.ghostBorder,
      maxWidth: 140,
      justifyContent: 'center' as const,
    },
    recallBtnText: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 10,
      letterSpacing: 0.8,
      color: C.primary,
      textTransform: 'uppercase' as const,
    },
    captureBtn: {
      minHeight: 28,
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 8,
      backgroundColor: C.primary,
      justifyContent: 'center' as const,
    },
    captureBtnText: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 10,
      letterSpacing: 0.8,
      color: '#FFF',
      textTransform: 'uppercase' as const,
    },
    overlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.5)',
      justifyContent: 'center' as const,
      alignItems: 'center' as const,
    },
    card: {
      backgroundColor: C.surfaceContainerLowest,
      borderRadius: 16,
      padding: 20,
      minWidth: 320,
      maxWidth: 440,
      borderWidth: 1,
      borderColor: C.ghostBorder,
    },
    cardTitle: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 12,
      letterSpacing: 1.2,
      color: C.secondary,
      textTransform: 'uppercase' as const,
      marginBottom: 12,
    },
    emptyText: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 10,
      letterSpacing: 1.0,
      color: C.secondary,
      textTransform: 'uppercase' as const,
      textAlign: 'center' as const,
      paddingVertical: 16,
    },
    row: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: 8,
      marginBottom: 6,
    },
    rowRecall: {
      flex: 1,
      minHeight: 44,
      justifyContent: 'center' as const,
      paddingHorizontal: 14,
      borderRadius: 8,
      backgroundColor: C.surfaceContainerHigh,
      borderWidth: 1,
      borderColor: C.ghostBorder,
    },
    rowName: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 13,
      color: C.text,
    },
    rowDelete: {
      minHeight: 44,
      minWidth: 72,
      justifyContent: 'center' as const,
      alignItems: 'center' as const,
      paddingHorizontal: 12,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: C.errorContainerBorder,
      backgroundColor: C.errorContainer,
    },
    rowDeleteText: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 10,
      letterSpacing: 0.8,
      color: C.error,
    },
    cardHint: {
      fontFamily: 'Inter_400Regular',
      fontSize: 11,
      lineHeight: 15,
      color: C.icon,
      marginBottom: 10,
    },
    rowMorph: {
      minHeight: 44,
      minWidth: 72,
      justifyContent: 'center' as const,
      alignItems: 'center' as const,
      paddingHorizontal: 12,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: C.ghostBorder,
      backgroundColor: C.surfaceContainerHigh,
    },
    rowMorphActive: {
      borderColor: C.primary,
      backgroundColor: C.surfaceContainerHigh,
    },
    rowMorphText: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 10,
      letterSpacing: 0.8,
      color: C.primary,
      textTransform: 'uppercase' as const,
    },
    morphPills: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: 8,
      marginBottom: 8,
      marginTop: -2,
      paddingLeft: 4,
      flexWrap: 'wrap' as const,
    },
    morphPillsLabel: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 9,
      letterSpacing: 0.8,
      color: C.secondary,
      textTransform: 'uppercase' as const,
    },
    morphPill: {
      minHeight: 36,
      minWidth: 44,
      justifyContent: 'center' as const,
      alignItems: 'center' as const,
      paddingHorizontal: 12,
      borderRadius: 8,
      backgroundColor: C.primary,
    },
    morphPillText: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 12,
      letterSpacing: 0.5,
      color: '#FFF',
    },
    hint: {
      fontFamily: 'Inter_400Regular',
      fontSize: 12,
      lineHeight: 17,
      color: C.icon,
      marginBottom: 10,
    },
    input: {
      paddingHorizontal: 10,
      paddingVertical: 10,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: C.ghostBorder,
      color: C.text,
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 14,
    },
    slugHint: {
      fontFamily: 'Inter_400Regular',
      fontSize: 11,
      color: C.secondary,
      marginTop: 6,
    },
    warnText: {
      fontFamily: 'Inter_400Regular',
      fontSize: 11,
      color: C.error,
      marginTop: 6,
    },
    btnRow: {
      flexDirection: 'row' as const,
      justifyContent: 'flex-end' as const,
      gap: 10,
      marginTop: 16,
    },
    cancelBtn: {
      minHeight: 44,
      minWidth: 96,
      paddingHorizontal: 18,
      borderRadius: 10,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      borderWidth: 1,
      borderColor: C.ghostBorder,
      backgroundColor: C.surfaceContainerHigh,
    },
    confirmBtn: {
      minHeight: 44,
      minWidth: 96,
      paddingHorizontal: 18,
      borderRadius: 10,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      backgroundColor: C.primary,
    },
    btnText: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 13,
      letterSpacing: 0.5,
    },
  };
}
