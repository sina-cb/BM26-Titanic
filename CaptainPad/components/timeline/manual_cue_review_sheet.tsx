import React, { useMemo } from 'react';
import { ActivityIndicator, Modal, Text, TouchableOpacity, View } from 'react-native';

import { Palette, Type } from '@/constants/theme';
import { usePalette } from '@/hooks/use-theme';
import type { OverviewCue as TimelineCueWire } from '@/utils/timelineApi';
import { CAPTAIN_PAD_MODAL_SUPPORTED_ORIENTATIONS } from '@/utils/modal_orientation';

interface ManualCueReviewSheetProps {
  cue: TimelineCueWire | null;
  busy: boolean;
  disabled: boolean;
  onClose: () => void;
  onFire: (cue: TimelineCueWire) => void;
}

function detailLines(cue: TimelineCueWire): string[] {
  const action = cue.action;
  return [
    action.type === 'playlist' ? `Playlist · ${action.name}` : null,
    action.type === 'look' ? `Look · ${action.look}` : null,
    action.type === 'playlist' && action.palette ? `Palette · ${action.palette}` : null,
    action.type === 'playlist' && action.target
      ? `Target · ${action.target.channel}${action.target.id ? ` / ${action.target.id}` : ''}`
      : null,
    action.type === 'special_event' ? `Special Event · ${action.showId}` : null,
    action.type === 'sequence' ? `${action.steps.length} sequence steps` : null,
  ].filter((line): line is string => line !== null);
}

export function ManualCueReviewSheet({
  cue,
  busy,
  disabled,
  onClose,
  onFire,
}: ManualCueReviewSheetProps) {
  const C = usePalette();
  const styles = useMemo(() => makeStyles(C), [C]);
  if (!cue) return null;
  const details = detailLines(cue);

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={busy ? undefined : onClose}
      supportedOrientations={CAPTAIN_PAD_MODAL_SUPPORTED_ORIENTATIONS}
    >
      <View style={styles.backdrop}>
        <View style={styles.card} accessibilityViewIsModal>
          <Text style={styles.eyebrow}>ON DEMAND · REVIEW</Text>
          <Text style={styles.title}>{cue.label}</Text>
          <Text style={styles.body}>
            This cue never auto-fires. Nothing happens until FIRE is confirmed.
          </Text>
          <View style={styles.summary}>
            {details.length > 0 ? details.map((line) => (
              <Text key={line} style={styles.summaryLine}>{line}</Text>
            )) : <Text style={styles.summaryLine}>Engine-resolved cue action</Text>}
          </View>
          <View style={styles.warning}>
            <Text style={styles.warningTitle}>LIVE MUTATION</Text>
            <Text style={styles.warningBody}>
              Firing applies this cue to the rig immediately and may take Timeline ownership.
            </Text>
          </View>
          <View style={styles.actions}>
            <TouchableOpacity
              style={styles.cancelButton}
              onPress={onClose}
              disabled={busy}
              accessibilityRole="button"
            >
              <Text style={styles.cancelLabel}>CANCEL</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.fireButton, disabled && styles.disabled]}
              onPress={() => onFire(cue)}
              disabled={disabled || busy}
              accessibilityRole="button"
              accessibilityState={{ disabled: disabled || busy }}
            >
              {busy ? <ActivityIndicator size="small" color={C.onPrimary} /> : (
                <Text style={styles.fireLabel}>FIRE CUE…</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function makeStyles(C: Palette) {
  return {
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.68)',
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      padding: 24,
    },
    card: {
      width: '100%' as const,
      maxWidth: 620,
      borderRadius: 20,
      backgroundColor: C.surfaceContainerLowest,
      borderWidth: 1,
      borderColor: C.borderStrong,
      padding: 26,
      gap: 14,
    },
    eyebrow: {
      ...Type.timelineMeta,
      color: C.warning,
    },
    title: {
      ...Type.timelineTitle,
      color: C.text,
      textTransform: 'uppercase' as const,
    },
    body: {
      ...Type.timelineBody,
      color: C.secondary,
    },
    summary: {
      borderRadius: 12,
      backgroundColor: C.surfaceContainerHigh,
      padding: 14,
      gap: 7,
    },
    summaryLine: {
      ...Type.timelineCue,
      color: C.text,
    },
    warning: {
      borderRadius: 12,
      padding: 13,
      backgroundColor: C.warningContainer,
      borderWidth: 1,
      borderColor: C.warningContainerBorder,
    },
    warningTitle: {
      ...Type.timelineMeta,
      color: C.warning,
    },
    warningBody: {
      ...Type.timelineBody,
      color: C.text,
      marginTop: 3,
    },
    actions: {
      flexDirection: 'row' as const,
      gap: 12,
    },
    cancelButton: {
      flex: 1,
      minHeight: 56,
      borderRadius: 12,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      backgroundColor: C.surfaceContainerHigh,
    },
    cancelLabel: {
      ...Type.timelineMeta,
      color: C.text,
    },
    fireButton: {
      flex: 1,
      minHeight: 56,
      borderRadius: 12,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      backgroundColor: C.primary,
    },
    fireLabel: {
      ...Type.timelineMeta,
      color: C.onPrimary,
    },
    disabled: {
      opacity: 0.38,
    },
  };
}
