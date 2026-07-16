import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, Modal } from 'react-native';
import { usePalette } from '@/hooks/use-theme';
import { Palette } from '@/constants/theme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import {
  performanceExitChoices,
  dirtySummaryText,
  dirtyRestoreCaption,
  type DeckDirtyEntry,
  type PerformanceExitAction,
} from '@/components/performance_mode_logic';

// ── ExitPerformanceSheet ──────────────────────────────────────────────────
// Exit choice for PERFORMANCE MODE. Modeled on ConfirmSheet's in-app Modal
// skeleton (RN-web drops Alert.alert callbacks on the podium web client, so a
// confirm-via-Alert would never resolve — same reason ConfirmSheet exists).
//
// The sheet is DIRTY-AWARE (operator ruling 2026-07-13: going back to EDIT must
// ASK whether to save the tuned parameter state, friendly + identical wherever
// the exit flow appears — and this is the one shared component, so deck + mixer
// match automatically):
//   • CLEAN (dirtyCount === 0) — renders exactly as before:
//       KEEP LIVE STATE   → exitAction:'keep'    (leave, nothing to save)
//       RESTORE PRE-SHOW  → exitAction:'restore' (discard tweaks, restore capture)
//   • DIRTY (dirtyCount > 0) — a warm summary of what was tuned + an explicit
//     save-ask:
//       KEEP & SAVE TUNING  → exitAction:'keep-save' (write tuning to playlists)
//       KEEP WITHOUT SAVING → exitAction:'keep'      (keep live look, drop backlog)
//       RESTORE PRE-SHOW    → exitAction:'restore'   (discard tuning + tweaks)
// CANCEL always stays in performance mode. The button list + copy come from
// performanceExitChoices() so the wording is vitest-pinned and can't drift.
// No optimistic flip — the caller awaits the engine WS echo; a brief `pending`
// spinner label covers the round-trip.

const BTN_HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 } as const;

export interface ExitPerformanceSheetProps {
  visible: boolean;
  /** True while a keep/restore POST is in flight — buttons disable + show a hint. */
  pending?: boolean;
  /** How many deck entries carry unsaved tuning (0 → the original clean sheet). */
  dirtyCount?: number;
  /** The dirty entries, for naming them in the summary (≤3 names shown). */
  dirtyEntries?: DeckDirtyEntry[];
  /** MIDI-controller hint (e.g. "SOLO closes this sheet — choose KEEP or
   *  RESTORE here on the iPad."). One physical button cannot pick between the
   *  exits, so a second press only closes; this line says so. Null / absent
   *  → no controller connected → the sheet renders exactly as before. */
  controllerHint?: string | null;
  onChoose: (action: PerformanceExitAction) => void;
  onCancel: () => void;
}

export const ExitPerformanceSheet: React.FC<ExitPerformanceSheetProps> = ({
  visible,
  pending = false,
  dirtyCount = 0,
  dirtyEntries = [],
  controllerHint = null,
  onChoose,
  onCancel,
}) => {
  const C = usePalette();
  const styles = useMemo(() => makeStyles(C), [C]);
  const isDirty = dirtyCount > 0;
  const choices = useMemo(() => performanceExitChoices(dirtyCount), [dirtyCount]);
  const summary = isDirty ? dirtySummaryText(dirtyCount, dirtyEntries) : '';
  const restoreCaption = isDirty ? dirtyRestoreCaption(dirtyCount) : '';
  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onCancel}>
      <TouchableOpacity
        style={styles.backdrop}
        activeOpacity={1}
        onPress={pending ? undefined : onCancel}
        accessibilityLabel="Dismiss performance-mode exit"
      >
        <TouchableOpacity activeOpacity={1} onPress={() => {}}>
          <View style={styles.card} accessibilityViewIsModal accessibilityRole="alert">
            <View style={styles.titleRow}>
              <IconSymbol name="lock.fill" size={18} color={C.tertiary} />
              <Text style={styles.title}>Back to edit mode</Text>
            </View>
            <Text style={styles.message}>
              {isDirty
                ? 'You tuned some patterns while you were live. Want to save that tuning before heading back to edit mode?'
                : 'You went live and made changes. Keep them, or roll the whole rig back to the pre-show snapshot.'}
            </Text>
            {summary ? (
              <View style={styles.summaryRow} accessibilityRole="text">
                <IconSymbol name="slider.horizontal.3" size={15} color={C.text} />
                <Text style={styles.summaryText}>{summary}</Text>
              </View>
            ) : null}
            {controllerHint ? (
              <Text style={styles.controllerHint}>{controllerHint}</Text>
            ) : null}

            {choices.map(({ action, label, hint, tone }) => {
              const isRestore = tone === 'restore';
              return (
                <TouchableOpacity
                  key={action}
                  style={[styles.choiceBtn, isRestore && styles.restoreBtn, pending && { opacity: 0.5 }]}
                  onPress={() => onChoose(action)}
                  disabled={pending}
                  hitSlop={BTN_HIT_SLOP}
                  accessibilityRole="button"
                  accessibilityLabel={label}
                  accessibilityState={{ disabled: pending }}
                >
                  <Text style={[styles.choiceLabel, isRestore && { color: C.tertiary }]}>
                    {label}
                  </Text>
                  <Text style={styles.choiceHint}>
                    {isRestore && restoreCaption ? `${hint} ${restoreCaption}` : hint}
                  </Text>
                </TouchableOpacity>
              );
            })}

            <View style={styles.footerRow}>
              {pending ? <Text style={styles.pending}>Applying…</Text> : null}
              <TouchableOpacity
                style={[styles.cancelBtn, pending && { opacity: 0.5 }]}
                onPress={onCancel}
                disabled={pending}
                hitSlop={BTN_HIT_SLOP}
                accessibilityRole="button"
                accessibilityLabel="Cancel — stay in performance mode"
                accessibilityState={{ disabled: pending }}
              >
                <Text style={[styles.btnText, { color: C.text }]}>CANCEL</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
};

function makeStyles(C: Palette) {
  return {
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.5)',
      justifyContent: 'center' as const,
      alignItems: 'center' as const,
    },
    card: {
      backgroundColor: C.surfaceContainerLowest,
      borderRadius: 16,
      padding: 24,
      minWidth: 340,
      maxWidth: 460,
      borderWidth: 1,
      borderColor: C.ghostBorder,
    },
    titleRow: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: 8,
      marginBottom: 10,
    },
    title: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 14,
      letterSpacing: 0.5,
      color: C.text,
      textTransform: 'uppercase' as const,
    },
    message: {
      fontFamily: 'Inter_400Regular',
      fontSize: 14,
      lineHeight: 20,
      color: C.secondary,
      marginBottom: 18,
    },
    // Dirty summary — a soft-highlighted row naming what was tuned this session
    // so the save-ask is concrete ("Aurora, Cylon were tuned…"), not abstract.
    summaryRow: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: 8,
      backgroundColor: C.surfaceContainerHigh,
      borderRadius: 10,
      paddingVertical: 10,
      paddingHorizontal: 12,
      marginBottom: 16,
    },
    summaryText: {
      flex: 1,
      fontFamily: 'Inter_400Regular',
      fontSize: 13,
      lineHeight: 18,
      color: C.text,
    },
    // MIDI-controller hint — amber caption in the plan-lock family so it reads
    // as "hardware affordance note", visually distinct from the body copy.
    controllerHint: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 11,
      lineHeight: 16,
      letterSpacing: 0.4,
      color: '#8a6a1f',
      marginTop: -10,
      marginBottom: 14,
    },
    choiceBtn: {
      minHeight: 56,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: C.ghostBorder,
      backgroundColor: C.surfaceContainerHigh,
      paddingHorizontal: 16,
      paddingVertical: 10,
      justifyContent: 'center' as const,
      marginBottom: 10,
    },
    restoreBtn: {
      borderColor: C.tertiary,
    },
    choiceLabel: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 13,
      letterSpacing: 0.5,
      color: C.text,
    },
    choiceHint: {
      fontFamily: 'Inter_400Regular',
      fontSize: 12,
      lineHeight: 16,
      color: C.secondary,
      marginTop: 3,
    },
    footerRow: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      justifyContent: 'flex-end' as const,
      gap: 12,
      marginTop: 4,
    },
    pending: {
      fontFamily: 'Inter_400Regular',
      fontSize: 12,
      color: C.secondary,
    },
    cancelBtn: {
      minHeight: 44,
      minWidth: 96,
      paddingHorizontal: 18,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: C.ghostBorder,
      backgroundColor: C.surfaceContainerHigh,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
    },
    btnText: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 13,
      letterSpacing: 0.5,
    },
  };
}
