/**
 * PlanPickerSheet — switch the active plan, load a plan into the maker,
 * duplicate, or seed a fresh BRC template (docs/38 §15.3).
 *
 * Themed modal matching the rest of the maker. Pure taps — no keyboard:
 * duplicate / new mint a slug name client-side (`<base>_copy`, `brc_2026`).
 */
import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Modal, Pressable, StyleSheet } from 'react-native';
import { Palette } from '@/constants/theme';
import { usePalette } from '@/hooks/use-theme';
import { IconSymbol } from '@/components/ui/icon-symbol';

export function PlanPickerSheet({
  visible, plans, activePlan, draftName, onLoad, onActivate, onDuplicate, onNewTemplate, onClose,
}: {
  visible: boolean;
  plans: string[];
  activePlan: string | null;
  draftName: string | null;
  onLoad: (name: string) => void;
  onActivate: (name: string) => void;
  onDuplicate: (name: string) => void;
  onNewTemplate: () => void;
  onClose: () => void;
}) {
  const C = usePalette();
  const styles = useMemo(() => makeStyles(C), [C]);

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: 24 }}
      >
        <Pressable onPress={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 480, maxHeight: '80%' }}>
          <View style={styles.sheet}>
            <Text style={styles.title}>PLANS</Text>

            <TouchableOpacity onPress={onNewTemplate} style={styles.newBtn} accessibilityLabel="New plan from BRC template">
              <IconSymbol name="plus.circle" size={18} color={C.onPrimary} />
              <Text style={styles.newBtnText}>NEW FROM BRC TEMPLATE</Text>
            </TouchableOpacity>

            {plans.length === 0 ? (
              <Text style={styles.empty}>No saved plans yet. Start from the template.</Text>
            ) : (
              <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ paddingVertical: 4 }}>
                {plans.map((name) => {
                  const isActive = name === activePlan;
                  const isDraft = name === draftName;
                  return (
                    <View key={name} style={[styles.row, isDraft && { borderColor: C.primary }]}>
                      <TouchableOpacity
                        onPress={() => onLoad(name)}
                        style={{ flex: 1, minWidth: 0 }}
                        accessibilityLabel={`Load plan ${name} into maker`}
                      >
                        <Text style={[styles.rowName, isDraft && { color: C.primary }]} numberOfLines={1}>{name}</Text>
                        <View style={{ flexDirection: 'row', gap: 6, marginTop: 4 }}>
                          {isActive ? <Text style={styles.tagActive}>● ACTIVE</Text> : null}
                          {isDraft ? <Text style={styles.tagDraft}>EDITING</Text> : null}
                        </View>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => onDuplicate(name)}
                        style={styles.actionBtn}
                        accessibilityLabel={`Duplicate ${name}`}
                      >
                        <Text style={styles.actionBtnText}>DUPLICATE</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => onActivate(name)}
                        style={[styles.actionBtn, { borderColor: C.tertiary }]}
                        accessibilityLabel={`Activate ${name}`}
                      >
                        <Text style={[styles.actionBtnText, { color: C.tertiary }]}>ACTIVATE</Text>
                      </TouchableOpacity>
                    </View>
                  );
                })}
              </ScrollView>
            )}

            <TouchableOpacity onPress={onClose} style={styles.closeBtn} accessibilityLabel="Close plan picker">
              <Text style={styles.closeBtnText}>CLOSE</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function makeStyles(C: Palette) {
  return StyleSheet.create({
    sheet: {
      backgroundColor: C.surfaceContainerLow,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: C.ghostBorder,
      padding: 20,
    },
    title: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 15,
      letterSpacing: 1,
      color: C.text,
      textTransform: 'uppercase',
      marginBottom: 14,
    },
    newBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      minHeight: 48,
      borderRadius: 8,
      backgroundColor: C.primary,
      marginBottom: 14,
    },
    newBtnText: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 12,
      letterSpacing: 0.8,
      color: C.onPrimary,
    },
    empty: {
      fontFamily: 'Inter_400Regular',
      fontSize: 13,
      color: C.secondary,
      paddingVertical: 12,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 12,
      paddingHorizontal: 12,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: C.ghostBorder,
      marginBottom: 8,
    },
    rowName: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 14,
      color: C.text,
    },
    tagActive: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 9,
      letterSpacing: 0.6,
      color: C.tertiary,
    },
    tagDraft: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 9,
      letterSpacing: 0.6,
      color: C.primary,
    },
    actionBtn: {
      paddingHorizontal: 10,
      paddingVertical: 8,
      minHeight: 40,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: C.ghostBorder,
      alignItems: 'center',
      justifyContent: 'center',
    },
    actionBtnText: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 10,
      letterSpacing: 0.5,
      color: C.text,
    },
    closeBtn: {
      marginTop: 12,
      minHeight: 44,
      borderRadius: 8,
      backgroundColor: C.surfaceContainerHigh,
      alignItems: 'center',
      justifyContent: 'center',
    },
    closeBtnText: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 12,
      letterSpacing: 0.6,
      color: C.text,
    },
  });
}
