/**
 * PlanPickerSheet — switch the active plan, load a plan into the maker,
 * duplicate, or create a new plan (docs/38 §15.3).
 *
 * Themed modal matching the rest of the maker. Creating a NEW plan (template
 * or from scratch) REQUIRES a name first: tapping either new-plan button opens
 * an inline NAME prompt (required field, slug-normalised, duplicate-blocked)
 * with ADD / CANCEL — the plan is only created on ADD (operator requirement).
 */
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, Modal, Pressable, StyleSheet } from 'react-native';
import { Palette } from '@/constants/theme';
import { usePalette } from '@/hooks/use-theme';
import { IconSymbol } from '@/components/ui/icon-symbol';

// Engine plan names must match show_plan.js assertSlug: /^[a-z0-9][a-z0-9_-]{0,63}$/.
// Normalise free text toward that shape; validity is re-checked against the
// same regex afterwards (an all-symbols input can still normalise to invalid).
const PLAN_SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
function slugifyPlanName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^[_-]+/, '')
    .slice(0, 64);
}

export function PlanPickerSheet({
  visible, plans, activePlan, draftName, onLoad, onActivate, onDuplicate, onDelete, onNewTemplate, onNewBlank, onClose,
}: {
  visible: boolean;
  plans: string[];
  activePlan: string | null;
  draftName: string | null;
  onLoad: (name: string) => void;
  onActivate: (name: string) => void;
  onDuplicate: (name: string) => void;
  /** Delete a saved plan (the engine refuses the ACTIVE plan; we hide it there). */
  onDelete: (name: string) => void;
  /** Create from the BRC template under the operator-entered (required) name. */
  onNewTemplate: (name: string) => void;
  /** Seed a fresh BLANK plan (no BRC cues/looks/phases) under the required name. */
  onNewBlank: (name: string) => void;
  onClose: () => void;
}) {
  const C = usePalette();
  const styles = useMemo(() => makeStyles(C), [C]);

  // Which new-plan flow is awaiting a name (null = prompt hidden).
  const [naming, setNaming] = useState<'template' | 'blank' | null>(null);
  const [nameInput, setNameInput] = useState('');
  // Two-tap delete confirm (inline — avoids a nested Modal that RN-web
  // mis-stacks): first tap arms the plan, second CONFIRM deletes.
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  useEffect(() => { if (!visible) setPendingDelete(null); }, [visible]);
  useEffect(() => {
    if (!visible) { setNaming(null); setNameInput(''); }
  }, [visible]);

  const slug = slugifyPlanName(nameInput);
  const nameEmpty = nameInput.trim().length === 0;
  const slugInvalid = !PLAN_SLUG_RE.test(slug);
  const duplicate = plans.includes(slug);
  const nameError = nameEmpty
    ? 'Plan name is required.'
    : slugInvalid
      ? 'Name must contain at least one letter or number.'
      : duplicate
        ? `A plan named “${slug}” already exists.`
        : null;
  const canAdd = nameError === null;

  const confirmAdd = () => {
    if (!canAdd || naming === null) return;
    const kind = naming;
    setNaming(null);
    setNameInput('');
    if (kind === 'template') onNewTemplate(slug);
    else onNewBlank(slug);
  };

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: 24 }}
      >
        <Pressable onPress={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 480, maxHeight: '80%' }}>
          <View style={styles.sheet}>
            <Text style={styles.title}>PLANS</Text>

            <View style={styles.newRow}>
              <TouchableOpacity
                onPress={() => setNaming('template')}
                style={[styles.newBtn, styles.newBtnHalf, naming === 'template' && { opacity: 0.7 }]}
                accessibilityLabel="New plan from BRC template"
              >
                <IconSymbol name="plus.circle" size={18} color={C.onPrimary} />
                <Text style={styles.newBtnText}>FROM BRC TEMPLATE</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setNaming('blank')}
                style={[styles.newBtnGhost, styles.newBtnHalf, naming === 'blank' && { borderWidth: 2 }]}
                accessibilityLabel="New blank plan from scratch"
              >
                <IconSymbol name="plus.circle" size={18} color={C.text} />
                <Text style={styles.newBtnGhostText}>FROM SCRATCH</Text>
              </TouchableOpacity>
            </View>

            {/* NAME PROMPT — a new plan is only created once a valid, unique
                name is entered and ADD is tapped (name is a REQUIRED field). */}
            {naming !== null ? (
              <View style={styles.namePrompt}>
                <Text style={styles.namePromptLabel}>
                  {naming === 'template' ? 'NAME THE NEW TEMPLATE PLAN' : 'NAME THE NEW BLANK PLAN'}
                </Text>
                <TextInput
                  value={nameInput}
                  onChangeText={setNameInput}
                  placeholder="e.g. burn_week"
                  placeholderTextColor={C.icon}
                  autoFocus
                  autoCapitalize="none"
                  autoCorrect={false}
                  onSubmitEditing={confirmAdd}
                  style={styles.nameInput}
                  accessibilityLabel="New plan name (required)"
                />
                {nameError ? (
                  <Text style={styles.nameError}>{nameError}</Text>
                ) : (
                  <Text style={styles.nameResolved}>{`Will be saved as “${slug}”`}</Text>
                )}
                <View style={styles.namePromptRow}>
                  <TouchableOpacity
                    onPress={() => { setNaming(null); setNameInput(''); }}
                    style={[styles.actionBtn, { flex: 1 }]}
                    accessibilityLabel="Cancel new plan"
                  >
                    <Text style={styles.actionBtnText}>CANCEL</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={confirmAdd}
                    disabled={!canAdd}
                    style={[styles.newBtn, { flex: 1, minHeight: 44 }, !canAdd && { opacity: 0.4 }]}
                    accessibilityLabel="Add new plan"
                    accessibilityState={{ disabled: !canAdd }}
                  >
                    <Text style={styles.newBtnText}>ADD</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : null}

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
                      {/* ACTIVATE — hidden for the ACTIVE plan (it's already
                          running; the ● ACTIVE tag says so). */}
                      {isActive ? null : (
                        <TouchableOpacity
                          onPress={() => onActivate(name)}
                          style={[styles.actionBtn, { borderColor: C.tertiary }]}
                          accessibilityLabel={`Activate ${name}`}
                        >
                          <Text style={[styles.actionBtnText, { color: C.tertiary }]}>ACTIVATE</Text>
                        </TouchableOpacity>
                      )}
                      {/* DELETE — hidden for the ACTIVE plan (the engine refuses
                          it: you can't delete a running plan). Two-tap confirm:
                          DELETE arms, CONFIRM? deletes. */}
                      {isActive ? null : pendingDelete === name ? (
                        <TouchableOpacity
                          onPress={() => { onDelete(name); setPendingDelete(null); }}
                          style={[styles.actionBtn, { borderColor: C.error, backgroundColor: C.error }]}
                          accessibilityLabel={`Confirm delete ${name}`}
                        >
                          <Text style={[styles.actionBtnText, { color: '#FFF' }]}>CONFIRM?</Text>
                        </TouchableOpacity>
                      ) : (
                        <TouchableOpacity
                          onPress={() => setPendingDelete(name)}
                          style={[styles.actionBtn, { borderColor: C.error }]}
                          accessibilityLabel={`Delete ${name}`}
                        >
                          <Text style={[styles.actionBtnText, { color: C.error }]}>DELETE</Text>
                        </TouchableOpacity>
                      )}
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
    newRow: {
      flexDirection: 'row',
      gap: 10,
      marginBottom: 14,
    },
    namePrompt: {
      borderWidth: 1,
      borderColor: C.primary,
      borderRadius: 10,
      padding: 12,
      marginBottom: 14,
      gap: 8,
    },
    namePromptLabel: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 11,
      letterSpacing: 0.8,
      color: C.secondary,
    },
    nameInput: {
      borderWidth: 1,
      borderColor: C.ghostBorder,
      borderRadius: 8,
      minHeight: 44,
      paddingHorizontal: 12,
      fontFamily: 'Inter_400Regular',
      fontSize: 14,
      color: C.text,
      backgroundColor: C.surfaceContainerHigh,
    },
    nameError: {
      fontFamily: 'Inter_400Regular',
      fontSize: 12,
      color: C.error,
    },
    nameResolved: {
      fontFamily: 'Inter_400Regular',
      fontSize: 12,
      color: C.secondary,
    },
    namePromptRow: {
      flexDirection: 'row',
      gap: 10,
      marginTop: 2,
    },
    newBtnHalf: {
      flex: 1,
      minWidth: 0,
    },
    newBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      minHeight: 48,
      paddingHorizontal: 10,
      borderRadius: 8,
      backgroundColor: C.primary,
    },
    newBtnText: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 12,
      letterSpacing: 0.8,
      color: C.onPrimary,
    },
    newBtnGhost: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      minHeight: 48,
      paddingHorizontal: 10,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: C.primary,
      backgroundColor: 'transparent',
    },
    newBtnGhostText: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 12,
      letterSpacing: 0.8,
      color: C.text,
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
