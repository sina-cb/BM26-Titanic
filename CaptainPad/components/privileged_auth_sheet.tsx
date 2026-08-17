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

interface PrivilegedAuthSheetProps {
  visible: boolean;
  pending: boolean;
  error: string | null;
  onSubmit: (passphrase: string, remember30: boolean) => void;
  onCancel: () => void;
}

export function PrivilegedAuthSheet({
  visible,
  pending,
  error,
  onSubmit,
  onCancel,
}: PrivilegedAuthSheetProps) {
  const C = usePalette();
  const styles = useMemo(() => makeStyles(C), [C]);
  const [passphrase, setPassphrase] = useState('');
  const [remember30, setRemember30] = useState(false);

  useEffect(() => {
    if (!visible) {
      setPassphrase('');
      setRemember30(false);
    }
  }, [visible]);

  const canSubmit = passphrase.length > 0 && !pending;

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={pending ? undefined : onCancel}>
      <TouchableOpacity
        style={styles.backdrop}
        activeOpacity={1}
        onPress={pending ? undefined : onCancel}
        accessibilityLabel="Dismiss privileged access"
      >
        <TouchableOpacity activeOpacity={1} onPress={() => {}}>
          <View style={styles.card} accessibilityViewIsModal accessibilityRole="alert">
            <View style={styles.titleRow}>
              <IconSymbol name="lock.open.fill" size={18} color={C.primary} />
              <Text style={styles.title}>Privileged edit access</Text>
            </View>
            <Text style={styles.message}>
              Use an authorized edit code from the show lead. After authentication, choose how to return the
              global show to Edit; other CaptainPads remain in Performance until you explicitly end it.
            </Text>
            <TextInput
              value={passphrase}
              onChangeText={setPassphrase}
              editable={!pending}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="off"
              textContentType="none"
              placeholder="Passphrase"
              placeholderTextColor={C.secondary}
              style={styles.input}
              returnKeyType="done"
              onSubmitEditing={() => {
                if (canSubmit) onSubmit(passphrase, remember30);
              }}
              accessibilityLabel="Privileged access passphrase"
            />
            <TouchableOpacity
              style={styles.rememberRow}
              onPress={() => setRemember30((value) => !value)}
              disabled={pending}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: remember30, disabled: pending }}
              accessibilityLabel="Remember privileged access on this device for 30 minutes"
            >
              <IconSymbol
                name={remember30 ? 'checkmark.circle.fill' : 'circle'}
                size={22}
                color={remember30 ? C.primary : C.secondary}
              />
              <View style={styles.rememberCopy}>
                <Text style={styles.rememberTitle}>Remember for 30 minutes</Text>
                <Text style={styles.rememberHint}>Stored only on this CaptainPad.</Text>
              </View>
            </TouchableOpacity>
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
                accessibilityState={{ disabled: pending }}
              >
                <Text style={[styles.buttonText, { color: C.text }]}>CANCEL</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.button, styles.editButton, !canSubmit && styles.buttonDisabled]}
                onPress={() => onSubmit(passphrase, remember30)}
                disabled={!canSubmit}
                accessibilityRole="button"
                accessibilityState={{ disabled: !canSubmit }}
              >
                {pending ? (
                  <ActivityIndicator size="small" color={C.onPrimary} />
                ) : (
                  <Text style={[styles.buttonText, { color: C.onPrimary }]}>OPEN EDIT</Text>
                )}
              </TouchableOpacity>
            </View>
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
    input: {
      minHeight: 48,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: C.ghostBorder,
      backgroundColor: C.surfaceContainerHigh,
      color: C.text,
      fontFamily: 'Inter_400Regular',
      fontSize: 16,
      paddingHorizontal: 14,
      marginBottom: 12,
    },
    rememberRow: {
      minHeight: 48,
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: 10,
      marginBottom: 14,
    },
    rememberCopy: {
      flex: 1,
    },
    rememberTitle: {
      fontFamily: 'Inter_600SemiBold',
      fontSize: 13,
      color: C.text,
    },
    rememberHint: {
      fontFamily: 'Inter_400Regular',
      fontSize: 12,
      color: C.secondary,
      marginTop: 2,
    },
    errorBox: {
      borderRadius: 8,
      borderWidth: 1,
      borderColor: C.errorContainerBorder,
      backgroundColor: C.errorContainer,
      paddingHorizontal: 12,
      paddingVertical: 10,
      marginBottom: 14,
    },
    errorText: {
      fontFamily: 'Inter_600SemiBold',
      fontSize: 12,
      color: C.error,
    },
    buttonRow: {
      flexDirection: 'row' as const,
      justifyContent: 'flex-end' as const,
      gap: 10,
    },
    button: {
      minHeight: 44,
      minWidth: 104,
      borderRadius: 10,
      paddingHorizontal: 16,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
    },
    cancelButton: {
      borderWidth: 1,
      borderColor: C.ghostBorder,
      backgroundColor: C.surfaceContainerHigh,
    },
    editButton: {
      backgroundColor: C.primary,
    },
    buttonDisabled: {
      opacity: 0.45,
    },
    buttonText: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 13,
      letterSpacing: 0.5,
    },
  };
}
