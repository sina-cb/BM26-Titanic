// ParamPresetMenu — per-channel param presets (#9 engine, merged at 8ec8a7d).
//
// A param preset is a NAMED capture of ONE channel's current local pattern
// params, scoped to the pattern it was captured on. This is the per-channel
// analogue of the full-mixer SnapshotBar "look": same CAPTURE / RECALL / list
// / DELETE shape, same in-app name prompt, same fail-loud Alert on 4xx, same
// ConfirmSheet gate on the destructive DELETE.
//
// Placement decision: the mixer strip header is already dense (the readability
// fix a5ee521 must not regress), so this is a COMPACT single button on the
// strip that opens a modal sheet holding everything (capture + list +
// recall/delete). The strip gains one row, not a sprawl of controls.
//
// The list is GLOBAL (GET /mixer/param-presets returns every preset, each with
// its `name` + the `pattern` it is scoped to). Recall onto a channel running a
// DIFFERENT pattern is refused by the engine with 409
// code:'PARAM_PRESET_PATTERN_MISMATCH'; we ALSO grey those rows out locally as
// a UX nicety (channel.pattern vs preset.pattern) and surface a friendly Alert
// if a mismatch slips through (e.g. the channel changed pattern mid-modal).
//
// Codex P0 — fail loud: capture/recall/delete failures surface via Alert; the
// client honours res.ok and never fabricates success. The list is reconciled
// from the WS control-plane `paramPresets` event ({ action, name,
// paramPresets:[{name,pattern,savedAt}] }) plus an initial GET on mount, so it
// stays live across clients — we never optimistically mutate it.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Modal, TextInput } from 'react-native';
import { CAPTAIN_PAD_MODAL_SUPPORTED_ORIENTATIONS } from '@/utils/modal_orientation';
import { opError, opWarn } from '@/utils/op_dialog';
import { usePalette } from '@/hooks/use-theme';
import { Palette } from '@/constants/theme';
import { ConfirmSheet } from '@/components/ui/ConfirmSheet';
import { engineEvents, type EngineMessage } from '@/utils/engineEvents';
import {
  listParamPresets,
  captureParamPreset,
  recallParamPreset,
  deleteParamPreset,
  PARAM_PRESET_PATTERN_MISMATCH,
  type ParamPresetInfo,
} from '@/utils/channelExtrasApi';

// Production-console touch target: expand small chips to the 44pt floor.
const HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 } as const;

// Engine preset name rule (param_preset_manager VALID_NAME): identical to the
// snapshot rule — `^[a-z0-9][a-z0-9_-]{0,63}$`. Lowercase + strip illegal
// chars locally so the prompt previews the exact slug the engine will accept
// (the engine still validates — UX nicety, not a substitute for the check).
function sanitizePresetName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .replace(/^[^a-z0-9]+/, '')
    .slice(0, 64);
}

type Props = {
  channelId: string;
  // The pattern this channel is currently running, if the mixer state carries
  // it. Used only to grey out mismatched recalls locally; the engine's 409 is
  // the authoritative guard.
  channelPattern?: string | null;
  // Disable mutations (mirrors the strip's lock gate on the sibling rows).
  locked?: boolean;
};

export function ParamPresetMenu({ channelId, channelPattern, locked }: Props) {
  const C = usePalette();
  const styles = useMemo(() => makeStyles(C), [C]);

  const [presets, setPresets] = useState<ParamPresetInfo[]>([]);
  const [listOpen, setListOpen] = useState(false);
  const [nameOpen, setNameOpen] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [deletePrompt, setDeletePrompt] = useState<string | null>(null);

  // Initial seed + WS reconcile. The engine emits `paramPresets` on every
  // mutation (capture/recall/delete) carrying the fresh sorted list, so we
  // trust msg.paramPresets verbatim and only GET on mount as the seed.
  useEffect(() => {
    let alive = true;
    listParamPresets().then((res) => {
      if (alive && res.ok && res.data) setPresets(res.data);
    });
    const unsub = engineEvents.subscribe((msg: EngineMessage) => {
      if (msg.type === 'paramPresets' && Array.isArray(msg.paramPresets)) {
        setPresets(msg.paramPresets as ParamPresetInfo[]);
      }
    });
    return () => { alive = false; unsub(); };
  }, []);

  const cleanName = sanitizePresetName(nameDraft);
  const nameExists = cleanName.length > 0 && presets.some((p) => p.name === cleanName);

  const handleCapture = useCallback(async () => {
    if (!cleanName || busy) return;
    setBusy(true);
    setNameOpen(false);
    const res = await captureParamPreset(channelId, cleanName);
    setBusy(false);
    if (!res.ok) {
      console.error('[ParamPresetMenu] Capture rejected:', res.error);
      opError('Preset not saved', `The engine rejected this preset. ${res.error || ''}`.trim());
      return;
    }
    setNameDraft('');
    // The WS `paramPresets` event reconciles the list; no optimistic insert.
  }, [cleanName, busy, channelId]);

  const handleRecall = useCallback(async (name: string) => {
    setListOpen(false);
    // Recall does NOT optimistically flip local state — the engine replays the
    // saved controls and the WS mixer broadcast reconciles the strip. We fire
    // and surface failures; the 409 pattern mismatch gets a friendly Alert.
    const res = await recallParamPreset(channelId, name);
    if (!res.ok) {
      console.error(`[ParamPresetMenu] Recall rejected for "${name}":`, res.error);
      const code = (res.data as { code?: string } | undefined)?.code;
      if (code === PARAM_PRESET_PATTERN_MISMATCH) {
        opWarn(
          'Wrong pattern for this preset',
          `This preset was captured on a different pattern than this channel is ` +
            `running, so its params don't apply here. Switch the channel to the ` +
            `preset's pattern, then recall again.`,
        );
        return;
      }
      opError('Preset not recalled', `The engine rejected recalling "${name}". ${res.error || ''}`.trim());
    }
  }, [channelId]);

  const confirmDelete = useCallback(async () => {
    const name = deletePrompt;
    if (!name) return;
    setDeletePrompt(null);
    const res = await deleteParamPreset(name);
    if (!res.ok) {
      console.error(`[ParamPresetMenu] Delete rejected for "${name}":`, res.error);
      opError('Preset not deleted', `The engine rejected deleting "${name}". ${res.error || ''}`.trim());
    }
    // WS `paramPresets` event reconciles the list on success.
  }, [deletePrompt]);

  return (
    <View style={styles.row}>
      <Text style={[styles.labelCaps, { width: 36 }]}>PARAMS</Text>
      <TouchableOpacity
        style={[styles.openBtn, locked && { opacity: 0.5 }]}
        hitSlop={HIT_SLOP}
        disabled={locked}
        onPress={() => setListOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`Param presets for this channel (${presets.length} saved)`}
      >
        <Text style={styles.openBtnText} numberOfLines={1}>
          PRESETS{presets.length > 0 ? ` (${presets.length})` : ''} ▾
        </Text>
      </TouchableOpacity>

      {/* ── Recall / capture / delete sheet ──────────────────────────── */}
      <Modal transparent visible={listOpen} animationType="fade" onRequestClose={() => setListOpen(false)} supportedOrientations={CAPTAIN_PAD_MODAL_SUPPORTED_ORIENTATIONS}>
        <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={() => setListOpen(false)}>
          <TouchableOpacity activeOpacity={1} onPress={() => {}}>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>PARAM PRESETS</Text>
              <Text style={styles.cardHint}>
                {channelPattern
                  ? `THIS CHANNEL IS RUNNING "${channelPattern.toUpperCase()}". A PRESET RECALLS ONLY IF IT WAS CAPTURED ON THE SAME PATTERN.`
                  : 'A PRESET RECALLS ONLY ONTO A CHANNEL RUNNING THE SAME PATTERN IT WAS CAPTURED ON.'}
              </Text>

              <TouchableOpacity
                style={[styles.captureBtn, (busy || locked) && { opacity: 0.5 }]}
                hitSlop={HIT_SLOP}
                disabled={busy || locked}
                onPress={() => { setNameDraft(''); setListOpen(false); setNameOpen(true); }}
                accessibilityRole="button"
                accessibilityLabel="Capture this channel's current params as a new preset"
              >
                <Text style={styles.captureBtnText}>{busy ? 'SAVING…' : '+ CAPTURE THIS CHANNEL'}</Text>
              </TouchableOpacity>

              {presets.length === 0 ? (
                <Text style={styles.emptyText}>NO SAVED PRESETS — TAP &quot;+ CAPTURE&quot; TO SAVE THIS CHANNEL&apos;S PARAMS</Text>
              ) : (
                <ScrollView style={{ maxHeight: 320 }}>
                  {presets.map((p) => {
                    // Grey out recall when this channel's pattern is known and
                    // differs from the preset's scope (the engine 409s anyway).
                    const mismatch = !!channelPattern && p.pattern !== channelPattern;
                    return (
                      <View key={p.name} style={styles.presetRow}>
                        <TouchableOpacity
                          style={[styles.rowRecall, (mismatch || locked) && { opacity: 0.4 }]}
                          hitSlop={HIT_SLOP}
                          disabled={mismatch || locked}
                          onPress={() => handleRecall(p.name)}
                          accessibilityRole="button"
                          accessibilityLabel={
                            mismatch
                              ? `Preset ${p.name} was captured on ${p.pattern}; not applicable to this channel`
                              : `Recall preset ${p.name} onto this channel`
                          }
                        >
                          <Text style={styles.rowName} numberOfLines={1}>{p.name}</Text>
                          <Text style={styles.rowPattern} numberOfLines={1}>{p.pattern}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.rowDelete}
                          hitSlop={HIT_SLOP}
                          disabled={locked}
                          onPress={() => setDeletePrompt(p.name)}
                          accessibilityRole="button"
                          accessibilityLabel={`Delete preset ${p.name}`}
                        >
                          <Text style={styles.rowDeleteText}>DELETE</Text>
                        </TouchableOpacity>
                      </View>
                    );
                  })}
                </ScrollView>
              )}
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* ── Capture name prompt (in-app modal — RN-web drops Alert button
          callbacks, see ConfirmSheet's note) ─────────────────────────── */}
      <Modal transparent visible={nameOpen} animationType="fade" onRequestClose={() => setNameOpen(false)} supportedOrientations={CAPTAIN_PAD_MODAL_SUPPORTED_ORIENTATIONS}>
        <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={() => setNameOpen(false)}>
          <TouchableOpacity activeOpacity={1} onPress={() => {}}>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>CAPTURE PRESET</Text>
              <Text style={styles.hint}>
                {channelPattern
                  ? `Name this preset. It captures this channel's current params, scoped to "${channelPattern}".`
                  : "Name this preset. It captures this channel's current pattern params."}
              </Text>
              <TextInput
                value={nameDraft}
                onChangeText={setNameDraft}
                placeholder="preset name"
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
                  accessibilityLabel="Capture preset"
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
        title="Delete preset?"
        message={`This permanently removes the saved param preset "${deletePrompt ?? ''}". Live channels are not affected — only the saved preset is deleted.`}
        confirmLabel="DELETE PRESET"
        cancelLabel="CANCEL"
        onConfirm={confirmDelete}
        onCancel={() => setDeletePrompt(null)}
      />
    </View>
  );
}

function makeStyles(C: Palette) {
  return {
    row: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: 6,
      marginTop: 4,
    },
    labelCaps: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 10,
      letterSpacing: 1.0,
      color: C.secondary,
      textTransform: 'uppercase' as const,
    },
    openBtn: {
      minHeight: 28,
      flex: 1,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 8,
      backgroundColor: C.surfaceContainerHigh,
      borderWidth: 1,
      borderColor: C.ghostBorder,
      justifyContent: 'center' as const,
    },
    openBtnText: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 10,
      letterSpacing: 0.8,
      color: C.primary,
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
      marginBottom: 8,
    },
    cardHint: {
      fontFamily: 'Inter_400Regular',
      fontSize: 11,
      lineHeight: 15,
      color: C.icon,
      marginBottom: 12,
    },
    captureBtn: {
      minHeight: 44,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 10,
      backgroundColor: C.primary,
      justifyContent: 'center' as const,
      alignItems: 'center' as const,
      marginBottom: 12,
    },
    captureBtnText: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 11,
      letterSpacing: 0.8,
      color: '#FFF',
      textTransform: 'uppercase' as const,
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
    presetRow: {
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
    rowPattern: {
      fontFamily: 'Inter_400Regular',
      fontSize: 10,
      color: C.secondary,
      marginTop: 1,
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
