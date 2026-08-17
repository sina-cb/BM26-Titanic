import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Modal } from 'react-native';
import { usePalette } from '@/hooks/use-theme';
import { Palette } from '@/constants/theme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import {
  performanceExitChoices,
  dirtySummaryText,
  dirtyRestoreCaption,
  PASSCODE_REQUIRED_HINT,
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
//
// PASSCODE (docs/56 D2/D8). Leaving the lock now requires a FRESH operator
// passcode, verified per attempt by the engine, because the principal who types
// it becomes the edit session that decides what gets written to disk. The field
// uses the takeover_passcode_sheet idiom deliberately — a single useState wiped
// on submit and on close, no remember affordance, nothing persisted — and NOT
// PrivilegedAuthSheet, which mints the 30-minute session this flow ignores.
// The passcode rides on the SAME request as the exit action: one entry, one
// verification, atomic with the choice.
//
// KEEP & SAVE TUNING carries a "captain's passcode only" caption and stays
// TAPPABLE for everyone. The client cannot pre-know which principal is being
// typed (that would mean verifying before submit), so a sailor who picks it
// gets the engine's 400 rendered in the error box below — an honest refusal
// beats a button that lies about why it is greyed.

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
  /** True when this engine gates the exit on a passcode (auth enabled). False
   *  on benches / isolated test engines, where the field is not rendered at
   *  all and the sheet behaves exactly as it did before docs/56. */
  passcodeRequired?: boolean;
  /** The engine's refusal for the last attempt; never contains the passcode. */
  error?: string | null;
  onChoose: (action: PerformanceExitAction, passcode: string) => void;
  onCancel: () => void;
}

export const ExitPerformanceSheet: React.FC<ExitPerformanceSheetProps> = ({
  visible,
  pending = false,
  dirtyCount = 0,
  dirtyEntries = [],
  controllerHint = null,
  passcodeRequired = false,
  error = null,
  onChoose,
  onCancel,
}) => {
  const C = usePalette();
  const styles = useMemo(() => makeStyles(C), [C]);
  const isDirty = dirtyCount > 0;
  const choices = useMemo(() => performanceExitChoices(dirtyCount), [dirtyCount]);
  const summary = isDirty ? dirtySummaryText(dirtyCount, dirtyEntries) : '';
  const restoreCaption = isDirty ? dirtyRestoreCaption(dirtyCount) : '';

  const [passcode, setPasscode] = useState('');
  // Wipe on close. With the wipe on submit below, this component holds the
  // secret only while the operator is typing it.
  useEffect(() => {
    if (!visible) setPasscode('');
  }, [visible]);

  const choose = (action: PerformanceExitAction) => {
    const attempted = passcode;
    // Clear BEFORE handing it off: the request is in flight, nothing here needs
    // the value any more, and a rejection must start from an empty field.
    setPasscode('');
    onChoose(action, attempted);
  };
  // ONLY the in-flight request disables the choices (report _236).
  //
  // This used to also read `passcodeRequired && passcode.length === 0`, and that
  // was the operator's "the buttons aren't making progress anymore": with the
  // field empty BOTH exits rendered at 0.45 opacity, swallowed the tap, fired no
  // request, and printed no reason anywhere on screen. A refusal nobody can see
  // is exactly the silent behaviour codex P0 forbids — and the client was
  // guessing at a gate the ENGINE owns, so a pad holding a stale `authRequired`
  // could have bricked a legitimate exit on a bench.
  //
  // The engine is the single authority now: an empty passcode POSTs, and
  // `verifyPrincipalPasscode` answers 401 EXIT_AUTH_REQUIRED — which the caller
  // renders in the error box below. That refusal costs NOTHING against the
  // lockout ring (a missing header returns before `verifyPassphrase` is ever
  // reached, marsin_engine/lib/api_server.js), so mashing the button cannot lock
  // the operator out mid-show.
  const choicesDisabled = pending;

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

            {passcodeRequired ? (
              <>
                <TextInput
                  value={passcode}
                  onChangeText={setPasscode}
                  editable={!pending}
                  secureTextEntry
                  autoFocus
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="off"
                  textContentType="none"
                  placeholder="Operator passcode"
                  placeholderTextColor={C.secondary}
                  style={styles.input}
                  accessibilityLabel="Operator passcode to leave performance mode"
                />
                {/* Says WHY the field is there, before the operator finds out by
                    being refused (report _236). The choices stay tappable — this
                    is a hint, never a gate. */}
                <Text style={styles.passcodeHint}>{PASSCODE_REQUIRED_HINT}</Text>
              </>
            ) : null}
            {error ? (
              <View style={styles.errorBox} accessibilityRole="alert">
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            {choices.map(({ action, label, hint, tone, caption }) => {
              const isRestore = tone === 'restore';
              return (
                <TouchableOpacity
                  key={action}
                  style={[
                    styles.choiceBtn,
                    isRestore && styles.restoreBtn,
                    choicesDisabled && { opacity: 0.45 },
                  ]}
                  onPress={() => choose(action)}
                  disabled={choicesDisabled}
                  hitSlop={BTN_HIT_SLOP}
                  accessibilityRole="button"
                  accessibilityLabel={caption ? `${label} — ${caption}` : label}
                  accessibilityState={{ disabled: choicesDisabled }}
                >
                  <Text style={[styles.choiceLabel, isRestore && { color: C.tertiary }]}>
                    {label}
                  </Text>
                  <Text style={styles.choiceHint}>
                    {isRestore && restoreCaption ? `${hint} ${restoreCaption}` : hint}
                  </Text>
                  {caption ? <Text style={styles.choiceCaption}>{caption}</Text> : null}
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
    // Operator passcode field — mirrors takeover_passcode_sheet's input so the
    // two passcode moments in the app look and feel identical.
    input: {
      minHeight: 56,
      borderRadius: 10,
      borderWidth: 2,
      borderColor: C.ghostBorder,
      backgroundColor: C.surfaceContainerHigh,
      color: C.text,
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 20,
      letterSpacing: 2,
      paddingHorizontal: 16,
      marginBottom: 8,
    },
    // Standing explanation for the passcode field. Secondary ink so it reads as
    // a caption, not as an error — errors get the box below it.
    passcodeHint: {
      fontFamily: 'Inter_400Regular',
      fontSize: 12,
      lineHeight: 17,
      color: C.secondary,
      marginBottom: 14,
    },
    errorBox: {
      borderRadius: 10,
      borderWidth: 1,
      borderColor: C.errorContainerBorder,
      backgroundColor: C.errorContainer,
      paddingVertical: 10,
      paddingHorizontal: 12,
      marginBottom: 14,
    },
    errorText: {
      fontFamily: 'Inter_400Regular',
      fontSize: 13,
      lineHeight: 18,
      color: C.error,
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
    // The owner-only qualifier under KEEP & SAVE TUNING.
    choiceCaption: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 11,
      lineHeight: 16,
      letterSpacing: 0.4,
      color: C.warning,
      marginTop: 4,
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
