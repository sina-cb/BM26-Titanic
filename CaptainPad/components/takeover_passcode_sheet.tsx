import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { Palette } from '@/constants/theme';
import { usePalette } from '@/hooks/use-theme';
import { IconSymbol } from '@/components/ui/icon-symbol';

// ── TakeoverPasscodeSheet ──────────────────────────────────────────────────
//
// The PER-ATTEMPT operator passcode prompt for taking the rig from the timeline
// while performance mode is live (operator ruling 2026-08-14, engine gate in
// marsin_engine/lib/api_server.js → checkTakeoverPasscode).
//
// Deliberately NOT PrivilegedAuthSheet: that sheet opens a 30-minute privileged
// SESSION and offers "remember on this device". Reusing it here would hand the
// operator exactly the thing the ruling forbids. This sheet shares its visual
// idiom (modal card, secure input, error box, CANCEL / primary pair) and drops
// every persistence affordance:
//
//   * no remember checkbox, no session, no storage — see the storage audit in
//     utils/takeover_passcode.ts;
//   * the typed passcode lives in ONE `useState` and is wiped on submit and on
//     close, so a re-open always starts empty;
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
  'Required for every takeover — this passcode is never stored on this CaptainPad.';

interface TakeoverPasscodeSheetProps {
  visible: boolean;
  pending: boolean;
  /** Engine refusal reason for the last attempt; never contains the passcode. */
  error: string | null;
  title: string;
  detail: string;
  /** Confirm-button caption. Defaults to the takeover wording. */
  submitLabel?: string;
  /** The reassurance line under the buttons. Defaults to the takeover wording;
   *  every variant must keep saying the passcode is not stored, because that
   *  is the promise utils/takeover_passcode.ts audits. */
  footnote?: string;
  onSubmit: (passcode: string) => void;
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
  onSubmit,
  onCancel,
}: TakeoverPasscodeSheetProps) {
  const C = usePalette();
  const styles = useMemo(() => makeStyles(C), [C]);
  const [passcode, setPasscode] = useState('');

  // Wipe on close. Combined with the wipe on submit below, the component holds
  // the secret only while the operator is typing it.
  useEffect(() => {
    if (!visible) setPasscode('');
  }, [visible]);

  const canSubmit = passcode.length > 0 && !pending;

  const submit = () => {
    if (!canSubmit) return;
    const attempted = passcode;
    // Clear BEFORE handing it off: the request is in flight, nothing in this
    // component needs the value any more, and a rejection must start fresh.
    setPasscode('');
    onSubmit(attempted);
  };

  return (
    <Modal
      transparent
      visible={visible}
      animationType="fade"
      onRequestClose={pending ? undefined : onCancel}
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
              returnKeyType="go"
              onSubmitEditing={submit}
              accessibilityLabel="Operator takeover passcode"
            />
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
      maxWidth: 520,
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
    input: {
      minHeight: 64,
      borderRadius: 12,
      borderWidth: 2,
      borderColor: C.ghostBorder,
      backgroundColor: C.surfaceContainerHigh,
      color: C.text,
      fontFamily: 'Inter_400Regular',
      fontSize: 22,
      letterSpacing: 2,
      paddingHorizontal: 18,
      marginBottom: 16,
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
