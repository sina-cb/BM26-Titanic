import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, Modal } from 'react-native';
import { usePalette } from '@/hooks/use-theme';
import { Palette } from '@/constants/theme';
import { IconSymbol } from '@/components/ui/icon-symbol';

// ── ConfirmSheet ────────────────────────────────────────────────────────
// Reusable destructive-action confirmation for the production lighting
// console. The deck and mixer are a live show surface; an accidental tap
// on a delete / remove control must NOT mutate state silently. Every
// destructive affordance routes through this sheet so the operator gets
// one deliberate confirmation step.
//
// Why an in-app Modal and not Alert.alert: CaptainPad ships a web build
// (npm run web:build) and RN-web drops Alert.alert button callbacks, so a
// confirm-via-Alert would never resolve on the podium's web client (see
// the same note in PlaylistPanel's NewPlaylistNameModal). The backdrop
// pattern mirrors PlaylistPanel's modals: outer TouchableOpacity closes
// (treated as cancel), inner swallows taps so the card is opaque to
// dismissal.
//
// Codex P0 — NO fallback behaviors: onConfirm is invoked verbatim; this
// component never swallows or substitutes the caller's action.

// The buttons already render at the 44pt min touch target (see `btn`
// style), but an 8pt hitSlop on every edge guarantees the *interactive*
// zone clears 44pt even if a future style shrinks the visual footprint,
// and gives the operator margin for error on a moving show surface.
const BTN_HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 } as const;

export interface ConfirmSheetProps {
  visible: boolean;
  title: string;
  /** Body copy describing exactly what will happen. */
  message: string;
  /** Label for the destructive button. Defaults to "DELETE". */
  confirmLabel?: string;
  /** Label for the safe escape button. Defaults to "CANCEL". */
  cancelLabel?: string;
  /** Fired when the operator confirms the destructive action. */
  onConfirm: () => void;
  /** Fired on cancel button, backdrop tap, or hardware back. */
  onCancel: () => void;
}

export const ConfirmSheet: React.FC<ConfirmSheetProps> = ({
  visible,
  title,
  message,
  confirmLabel = 'DELETE',
  cancelLabel = 'CANCEL',
  onConfirm,
  onCancel,
}) => {
  const C = usePalette();
  const styles = useMemo(() => makeStyles(C), [C]);
  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onCancel}>
      <TouchableOpacity
        style={styles.backdrop}
        activeOpacity={1}
        onPress={onCancel}
        accessibilityLabel="Dismiss confirmation"
      >
        {/* Inner wrapper swallows taps so the card stays open. */}
        <TouchableOpacity activeOpacity={1} onPress={() => {}}>
          <View style={styles.card} accessibilityViewIsModal accessibilityRole="alert">
            <View style={styles.titleRow}>
              <IconSymbol name="exclamationmark.triangle.fill" size={18} color={C.error} />
              <Text style={styles.title}>{title}</Text>
            </View>
            <Text style={styles.message}>{message}</Text>
            <View style={styles.btnRow}>
              <TouchableOpacity
                style={[styles.btn, styles.cancelBtn]}
                onPress={onCancel}
                hitSlop={BTN_HIT_SLOP}
                accessibilityRole="button"
                accessibilityLabel={cancelLabel}
              >
                <Text style={[styles.btnText, { color: C.text }]}>{cancelLabel}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btn, styles.confirmBtn]}
                onPress={onConfirm}
                hitSlop={BTN_HIT_SLOP}
                accessibilityRole="button"
                accessibilityLabel={confirmLabel}
              >
                <Text style={[styles.btnText, { color: '#FFF' }]}>{confirmLabel}</Text>
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
      // 'rgba(0,0,0,0.5)' — modal-dimmer tint, identical in both themes
      // (matches PlaylistPanel's modal backdrop).
      backgroundColor: 'rgba(0,0,0,0.5)',
      justifyContent: 'center' as const,
      alignItems: 'center' as const,
    },
    card: {
      backgroundColor: C.surfaceContainerLowest,
      borderRadius: 16,
      padding: 24,
      minWidth: 320,
      maxWidth: 440,
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
      marginBottom: 20,
    },
    btnRow: {
      flexDirection: 'row' as const,
      justifyContent: 'flex-end' as const,
      gap: 10,
    },
    // 44pt minimum touch target per the production-console safety bar.
    btn: {
      minHeight: 44,
      minWidth: 96,
      paddingHorizontal: 18,
      borderRadius: 10,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
    },
    cancelBtn: {
      borderWidth: 1,
      borderColor: C.ghostBorder,
      backgroundColor: C.surfaceContainerHigh,
    },
    confirmBtn: {
      backgroundColor: C.error,
    },
    btnText: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 13,
      letterSpacing: 0.5,
    },
  };
}
