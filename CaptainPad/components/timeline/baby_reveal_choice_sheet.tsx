import React, { useMemo } from 'react';
import { Modal, Text, TouchableOpacity, View } from 'react-native';

import { Palette, Type } from '@/constants/theme';
import { usePalette } from '@/hooks/use-theme';
import type { OverviewCue } from '@/utils/timelineApi';
import { CAPTAIN_PAD_MODAL_SUPPORTED_ORIENTATIONS } from '@/utils/modal_orientation';

interface BabyRevealChoiceSheetProps {
  visible: boolean;
  pinkCue: OverviewCue | null;
  blueCue: OverviewCue | null;
  disabled: boolean;
  onChoose: (cue: OverviewCue) => void;
  onClose: () => void;
}

export function BabyRevealChoiceSheet({
  visible,
  pinkCue,
  blueCue,
  disabled,
  onChoose,
  onClose,
}: BabyRevealChoiceSheetProps) {
  const C = usePalette();
  const styles = useMemo(() => makeStyles(C), [C]);
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      supportedOrientations={CAPTAIN_PAD_MODAL_SUPPORTED_ORIENTATIONS}
    >
      <View style={styles.backdrop}>
        <View style={styles.card} accessibilityViewIsModal>
          <Text style={styles.eyebrow}>PROTECTED ON-DEMAND CUE</Text>
          <Text style={styles.title}>BABY REVEAL</Text>
          <Text style={styles.body}>
            Choose the outcome first. The next screen repeats that choice before anything fires.
          </Text>
          <View style={styles.choiceRow}>
            <Choice
              label="PINK"
              cue={pinkCue}
              color={C.warning}
              disabled={disabled}
              onChoose={onChoose}
            />
            <Choice
              label="BLUE"
              cue={blueCue}
              color={C.primary}
              disabled={disabled}
              onChoose={onChoose}
            />
          </View>
          <TouchableOpacity
            style={styles.cancel}
            onPress={onClose}
            accessibilityRole="button"
          >
            <Text style={styles.cancelLabel}>CANCEL</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

function Choice({
  label,
  cue,
  color,
  disabled,
  onChoose,
}: {
  label: string;
  cue: OverviewCue | null;
  color: string;
  disabled: boolean;
  onChoose: (cue: OverviewCue) => void;
}) {
  const C = usePalette();
  const styles = useMemo(() => makeStyles(C), [C]);
  const unavailable = disabled || !cue;
  return (
    <TouchableOpacity
      style={[
        styles.choice,
        { borderColor: color },
        unavailable && styles.disabled,
      ]}
      onPress={() => cue && onChoose(cue)}
      disabled={unavailable}
      accessibilityRole="button"
      accessibilityLabel={`Choose ${label} Baby Reveal`}
      accessibilityState={{ disabled: unavailable }}
    >
      <View style={[styles.choiceDot, { backgroundColor: color }]} />
      <Text style={[styles.choiceLabel, { color }]}>{label}</Text>
      <Text style={styles.choiceMeta}>CHOOSE &amp; REVIEW</Text>
    </TouchableOpacity>
  );
}

function makeStyles(C: Palette) {
  return {
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.72)',
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      padding: 24,
    },
    card: {
      width: '100%' as const,
      maxWidth: 700,
      borderRadius: 20,
      backgroundColor: C.surfaceContainerLowest,
      borderWidth: 1,
      borderColor: C.borderStrong,
      padding: 28,
      gap: 14,
    },
    eyebrow: {
      ...Type.timelineMeta,
      color: C.warning,
    },
    title: {
      ...Type.timelineHero,
      color: C.text,
    },
    body: {
      ...Type.timelineBody,
      color: C.secondary,
    },
    choiceRow: {
      flexDirection: 'row' as const,
      gap: 14,
      marginVertical: 6,
    },
    choice: {
      flex: 1,
      minHeight: 150,
      borderRadius: 16,
      borderWidth: 3,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      gap: 8,
      backgroundColor: C.surfaceContainerHigh,
    },
    choiceDot: {
      width: 24,
      height: 24,
      borderRadius: 12,
    },
    choiceLabel: {
      ...Type.timelineTitle,
    },
    choiceMeta: {
      ...Type.timelineMeta,
      color: C.secondary,
    },
    cancel: {
      minHeight: 52,
      borderRadius: 12,
      backgroundColor: C.surfaceContainerHigh,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
    },
    cancelLabel: {
      ...Type.timelineMeta,
      color: C.text,
    },
    disabled: {
      opacity: 0.38,
    },
  };
}
