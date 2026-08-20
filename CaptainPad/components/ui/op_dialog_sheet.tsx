import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Modal } from 'react-native';
import { CAPTAIN_PAD_MODAL_SUPPORTED_ORIENTATIONS } from '@/utils/modal_orientation';

import { usePalette } from '@/hooks/use-theme';
import { type Palette, Radius, Space, Type } from '@/constants/theme';
import { accentFill, useGlobalStyles } from '@/styles/globalStyles';
import { opToneColors } from '@/styles/op_tone';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { PresetIcon } from '@/components/ui/preset_icon';
import { OP_PROMPT_SUBMIT, type OpDialog, type OpDialogAction } from '@/utils/op_dialog';

// ── OpDialogSheet ──────────────────────────────────────────────────────────
//
// The MODAL half of the op_dialog system (see utils/op_dialog.ts for why the
// system exists at all). Rendered only by components/op_dialog_host.tsx.
//
// This is the imperative twin of components/ui/ConfirmSheet.tsx and copies its
// treatment deliberately, so the two are indistinguishable on screen:
//   * docs/54 row 19 — "a modal IS a panel": surface, hairline, radius and
//     shadow all come from `globalStyles.panel`; the local `card` entry only
//     SIZES it.
//   * backdrop `TouchableOpacity` dismisses; an inner one swallows taps so the
//     card is opaque to dismissal.
//   * 44pt minimum touch target plus an 8pt hitSlop on every button edge.
//
// The difference from ConfirmSheet is the calling convention: ConfirmSheet is
// DECLARATIVE (a component owns `visible` state), this one is driven by a
// promise from anywhere in the app — including non-React code. Both stay.
//
// Codex P0 — no fallback: `dialog.resolve` is called with the operator's
// literal choice. Dismissal resolves `null`, which is NOT the same value as
// any action id, so a caller can always tell "cancelled" from "chose cancel".

const BTN_HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 } as const;

export interface OpDialogSheetProps {
  /** The live dialog, or null when nothing is being asked. */
  dialog: OpDialog | null;
}

export const OpDialogSheet: React.FC<OpDialogSheetProps> = ({ dialog }) => {
  const C = usePalette();
  const globalStyles = useGlobalStyles();
  const styles = useMemo(() => makeStyles(C), [C]);
  // Hooks must run unconditionally, so the tone is resolved with a safe
  // stand-in while closed; nothing is painted from it in that state.
  const tone = useMemo(() => opToneColors(C, dialog?.tone ?? 'info'), [C, dialog?.tone]);
  const danger = useMemo(() => accentFill(C.error), [C.error]);
  const primary = useMemo(() => accentFill(C.primary), [C.primary]);

  // ── The optional TEXT FIELD (_242 order 4) ───────────────────────────────
  // Local to the sheet and re-seeded per dialog id, so two prompts in a row
  // never inherit each other's text. The value travels back through
  // `resolve(actionId, value)` — the empty string included, because "no name"
  // is an answer the operator is allowed to give (see opPrompt).
  const [value, setValue] = useState('');
  const dialogId = dialog?.id ?? null;
  const initialValue = dialog?.input?.initialValue ?? '';
  useEffect(() => { setValue(initialValue); }, [dialogId, initialValue]);

  const dismiss = () => dialog?.resolve(null);
  const choose = (actionId: string) => dialog?.resolve(actionId, dialog.input ? value : undefined);

  const actionStyle = (action: OpDialogAction) => {
    if (action.kind === 'destructive') {
      return { box: { backgroundColor: danger.backgroundColor }, ink: danger.color };
    }
    if (action.kind === 'cancel') {
      return { box: styles.cancelBtn, ink: C.text };
    }
    return { box: { backgroundColor: primary.backgroundColor }, ink: primary.color };
  };

  return (
    <Modal
      transparent
      visible={dialog !== null}
      animationType="fade"
      onRequestClose={dismiss}
      supportedOrientations={CAPTAIN_PAD_MODAL_SUPPORTED_ORIENTATIONS}
    >
      <TouchableOpacity
        style={styles.backdrop}
        activeOpacity={1}
        onPress={dismiss}
        accessibilityLabel="Dismiss dialog"
      >
        {/* Inner wrapper swallows taps so the card stays open. */}
        <TouchableOpacity activeOpacity={1} onPress={() => {}}>
          <View
            style={[globalStyles.panel, styles.card]}
            accessibilityViewIsModal
            accessibilityRole="alert"
          >
            <View style={styles.titleRow}>
              <IconSymbol name={tone.icon} size={18} color={tone.accent} />
              <Text style={[styles.title, { color: tone.title }]}>
                {dialog?.title ?? ''}
              </Text>
            </View>
            <Text style={styles.message}>{dialog?.message ?? ''}</Text>
            {/* THE GENERATED ICON. Same component, same colour list, as the
                chip this will become — so what the operator approves here is
                literally what lands in the gallery. */}
            {dialog?.swatches && dialog.swatches.length > 0 ? (
              <View style={styles.iconRow}>
                <PresetIcon colours={dialog.swatches} size={44} borderColor={C.ghostBorder} />
              </View>
            ) : null}
            {dialog?.input ? (
              <TextInput
                style={styles.input}
                value={value}
                onChangeText={setValue}
                placeholder={dialog.input.placeholder}
                placeholderTextColor={C.icon}
                maxLength={dialog.input.maxLength}
                autoFocus
                autoCorrect={false}
                returnKeyType="done"
                onSubmitEditing={() => choose(OP_PROMPT_SUBMIT)}
                accessibilityLabel={dialog.input.placeholder ?? dialog.title}
              />
            ) : null}
            <View style={styles.btnRow}>
              {(dialog?.actions ?? []).map((action) => {
                const paint = actionStyle(action);
                return (
                  <TouchableOpacity
                    key={action.id}
                    style={[styles.btn, paint.box]}
                    onPress={() => choose(action.id)}
                    hitSlop={BTN_HIT_SLOP}
                    accessibilityRole="button"
                    accessibilityLabel={action.label}
                  >
                    <Text style={[styles.btnText, { color: paint.ink }]}>{action.label}</Text>
                  </TouchableOpacity>
                );
              })}
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
      // 'rgba(0,0,0,0.5)' — the modal-dimmer tint, identical in both themes
      // and byte-identical to ConfirmSheet's so the two never differ.
      backgroundColor: 'rgba(0,0,0,0.5)',
      justifyContent: 'center' as const,
      alignItems: 'center' as const,
    },
    // Surface / hairline / radius / shadow all come from `globalStyles.panel`
    // (docs/54 row 19 — a modal is a panel); this entry only sizes it.
    card: {
      padding: Space.xl,
      minWidth: 320,
      maxWidth: 440,
    },
    titleRow: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: Space.sm,
      marginBottom: 10,
    },
    title: {
      ...Type.labelCaps,
      fontSize: 14,
      letterSpacing: 0.5,
      flexShrink: 1,
    },
    message: {
      ...Type.body,
      lineHeight: 20,
      color: C.secondary,
      marginBottom: 20,
    },
    iconRow: {
      alignItems: 'center' as const,
      marginBottom: Space.md,
    },
    // 44pt tall like every other touch target on this card, and painted with
    // the same surface/hairline vocabulary as the cancel button so the field
    // reads as part of the panel rather than a browser control.
    input: {
      minHeight: 44,
      paddingHorizontal: 12,
      borderRadius: Radius.control,
      borderWidth: 1,
      borderColor: C.ghostBorder,
      backgroundColor: C.surfaceContainerHigh,
      color: C.text,
      fontFamily: 'Inter_400Regular',
      fontSize: 15,
      marginBottom: 20,
    },
    btnRow: {
      flexDirection: 'row' as const,
      justifyContent: 'flex-end' as const,
      flexWrap: 'wrap' as const,
      gap: 10,
    },
    // 44pt minimum touch target per the production-console safety bar.
    btn: {
      minHeight: 44,
      minWidth: 96,
      paddingHorizontal: 18,
      borderRadius: Radius.control,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
    },
    cancelBtn: {
      borderWidth: 1,
      borderColor: C.ghostBorder,
      backgroundColor: C.surfaceContainerHigh,
    },
    btnText: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 13,
      letterSpacing: 0.5,
    },
  };
}
