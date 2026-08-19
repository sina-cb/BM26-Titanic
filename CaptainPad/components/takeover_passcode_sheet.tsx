import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { OperatorPasscodeKeypad } from '@/components/operator_passcode_keypad';
import { OperatorPasscodeRememberRow } from '@/components/operator_passcode_remember_row';
import { Palette } from '@/constants/theme';
import { usePalette } from '@/hooks/use-theme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { CAPTAIN_PAD_MODAL_SUPPORTED_ORIENTATIONS } from '@/utils/modal_orientation';

// ── TakeoverPasscodeSheet ──────────────────────────────────────────────────
//
// The operator passcode prompt for performance-mode gates: timeline takeover,
// special-event ARM, edit-session escalation, and similar surfaces.
//
// Deliberately NOT PrivilegedAuthSheet: that sheet opens a 30-minute privileged
// SESSION for structural performance-lock bypass. This sheet may optionally mint
// a separate 30-minute passcode WAIVER (operator ruling 2026-08-18) that
// authorises only operator-passcode gates — never privileged editing.
//
//   * the typed passcode lives in ONE `useState` and is wiped on submit and on
//     close;
//   * Remember for 30 minutes stores only an opaque waiver token bound to the
//     engine origin — never the raw passcode;
//   * a rejected attempt shows the engine's reason and NEVER echoes what was
//     typed.
//
// MID-SHOW, AT NIGHT, WITH BIG THUMBS: this is used on a dark playa in the
// middle of a set. The input is 64pt tall at 22pt type, both buttons are 56pt,
// the whole card is 380-520pt wide, and every colour comes from the theme
// palette so it tracks light/dark like the rest of the app.

/** Big-thumb minimum for every touch target here (well over the 44pt floor). */
const TOUCH_TARGET = 56;

/** Defaults keep every existing call site (the timeline/special-event takeover
 *  prompts) byte-identical; the edit-session escalation sheet overrides them. */
const DEFAULT_SUBMIT_LABEL = 'TAKE OVER';
const DEFAULT_FOOTNOTE =
  'When Remember is off, the passcode is used once and never stored.';

interface TakeoverPasscodeSheetProps {
  visible: boolean;
  pending: boolean;
  /** Engine refusal reason for the last attempt; never contains the passcode. */
  error: string | null;
  title: string;
  detail: string;
  /** Confirm-button caption. Defaults to the takeover wording. */
  submitLabel?: string;
  /** The reassurance line under the buttons. */
  footnote?: string;
  /** When false, hide the Remember row (exit sheet manages its own copy). */
  showRemember?: boolean;
  onSubmit: (passcode: string, remember30: boolean) => void;
  onCancel: () => void;
}

export function TakeoverPasscodeSheet({
  visible,
  pending,
  error,
  title,
  detail,
  submitLabel = DEFAULT_SUBMIT_LABEL,
  footnote = DEFAULT_FOOTNOTE,
  showRemember = true,
  onSubmit,
  onCancel,
}: TakeoverPasscodeSheetProps) {
  const C = usePalette();
  const styles = useMemo(() => makeStyles(C), [C]);
  const [passcode, setPasscodeState] = useState('');
  const passcodeRef = useRef('');
  const setPasscode = (next: string) => {
    passcodeRef.current = next;
    setPasscodeState(next);
  };
  const [remember30, setRemember30State] = useState(false);
  const remember30Ref = useRef(false);
  const setRemember30 = (next: boolean) => {
    remember30Ref.current = next;
    setRemember30State(next);
  };
  const toggleRemember30 = () => setRemember30(!remember30Ref.current);

  // Wipe on close. Combined with the wipe on submit below, the component holds
  // the secret only while the operator is typing it.
  useEffect(() => {
    if (!visible) {
      passcodeRef.current = '';
      setPasscodeState('');
      remember30Ref.current = false;
      setRemember30State(false);
    }
  }, [visible]);

  const canSubmit = passcode.length > 0 && !pending;

  const submit = () => {
    if (!canSubmit) return;
    const attempted = passcodeRef.current;
    const remember = remember30Ref.current;
    // Clear BEFORE handing it off: the request is in flight, nothing in this
    // component needs the value any more, and a rejection must start fresh.
    passcodeRef.current = '';
    setPasscodeState('');
    remember30Ref.current = false;
    setRemember30State(false);
    onSubmit(attempted, remember);
  };

  return (
    <Modal
      transparent
      visible={visible}
      animationType="fade"
      onRequestClose={pending ? undefined : onCancel}
      supportedOrientations={CAPTAIN_PAD_MODAL_SUPPORTED_ORIENTATIONS}
    >
      <TouchableOpacity
        style={styles.backdrop}
        activeOpacity={1}
        onPress={pending ? undefined : onCancel}
        accessibilityLabel="Dismiss the takeover passcode prompt"
      >
        <TouchableOpacity activeOpacity={1} onPress={() => {}}>
          <View style={styles.card} accessibilityViewIsModal accessibilityRole="alert">
            <View style={styles.titleRow}>
              <IconSymbol name="lock.fill" size={22} color={C.primary} />
              <Text style={styles.title}>{title}</Text>
            </View>
            <Text style={styles.message}>{detail}</Text>
            <OperatorPasscodeKeypad
              value={passcode}
              onChange={setPasscode}
              disabled={pending}
            />
            {showRemember ? (
              <OperatorPasscodeRememberRow
                checked={remember30}
                onToggle={toggleRemember30}
                disabled={pending}
              />
            ) : null}
            {error ? (
              <View style={styles.errorBox} accessibilityRole="alert">
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}
            <View style={styles.buttonRow}>
              <TouchableOpacity
                style={[styles.button, styles.cancelButton]}
                onPress={onCancel}
                disabled={pending}
                accessibilityRole="button"
                accessibilityLabel="Cancel the takeover and leave the plan running"
                accessibilityState={{ disabled: pending }}
              >
                <Text style={[styles.buttonText, { color: C.text }]}>CANCEL</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.button, styles.takeOverButton, !canSubmit && styles.buttonDisabled]}
                onPress={submit}
                disabled={!canSubmit}
                accessibilityRole="button"
                accessibilityLabel={`Submit the passcode: ${submitLabel}`}
                accessibilityState={{ disabled: !canSubmit }}
              >
                {pending ? (
                  <ActivityIndicator size="small" color={C.onPrimary} />
                ) : (
                  <Text style={[styles.buttonText, { color: C.onPrimary }]}>{submitLabel}</Text>
                )}
              </TouchableOpacity>
            </View>
            <Text style={styles.footnote}>{footnote}</Text>
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

function makeStyles(C: Palette) {
  return {
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.62)',
      justifyContent: 'center' as const,
      alignItems: 'center' as const,
    },
    card: {
      backgroundColor: C.surfaceContainerLowest,
      borderRadius: 18,
      padding: 28,
      minWidth: 380,
      maxWidth: 560,
      borderWidth: 1,
      borderColor: C.ghostBorder,
    },
    titleRow: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: 10,
      marginBottom: 12,
    },
    title: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 16,
      letterSpacing: 0.5,
      color: C.text,
      textTransform: 'uppercase' as const,
      flexShrink: 1,
    },
    message: {
      fontFamily: 'Inter_400Regular',
      fontSize: 15,
      lineHeight: 22,
      color: C.secondary,
      marginBottom: 20,
    },
    errorBox: {
      borderRadius: 10,
      borderWidth: 1,
      borderColor: C.errorContainerBorder,
      backgroundColor: C.errorContainer,
      paddingHorizontal: 14,
      paddingVertical: 12,
      marginBottom: 16,
    },
    errorText: {
      fontFamily: 'Inter_600SemiBold',
      fontSize: 14,
      lineHeight: 20,
      color: C.error,
    },
    buttonRow: {
      flexDirection: 'row' as const,
      gap: 12,
    },
    button: {
      flex: 1,
      minHeight: TOUCH_TARGET,
      borderRadius: 12,
      paddingHorizontal: 18,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
    },
    cancelButton: {
      borderWidth: 1,
      borderColor: C.ghostBorder,
      backgroundColor: C.surfaceContainerHigh,
    },
    takeOverButton: {
      backgroundColor: C.primary,
    },
    buttonDisabled: {
      opacity: 0.45,
    },
    buttonText: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 15,
      letterSpacing: 0.6,
    },
    footnote: {
      fontFamily: 'Inter_400Regular',
      fontSize: 12,
      lineHeight: 17,
      color: C.secondary,
      marginTop: 14,
      textAlign: 'center' as const,
    },
  };
}
