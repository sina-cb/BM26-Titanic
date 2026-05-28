/**
 * LibraryEffectPicker — modal that lets the operator bind a scheduled
 * task to a specific (effectId, presetId) from the engine's global
 * effect library. Mirrors the GEM swap-sheet pattern (see
 * GlobalEffectMacros.tsx → SwapSheet) so the operator feels at home —
 * same modal chrome (transparent backdrop + outer-Pressable dismiss +
 * inner-Pressable panel), same row recipe (preset label + behaviour
 * subtext), same close button.
 *
 * Differences from the GEM swap:
 *   - Groups by `category` (per docs/31 open Q #4 default) so the
 *     operator scans atmospherics / strobes / colour separately.
 *   - No REMOVE action — a scheduled task always has a binding (the
 *     row's TRASH icon deletes the whole task, not just the binding).
 *   - Tap a preset → fires `onPick({effectId, presetId, label, behavior})`
 *     and closes. The caller decides whether to PATCH or POST.
 *
 * Library fetch is shared across pickers by way of the existing
 * `fetchGlobalEffectLibrary` helper. The modal accepts a `library`
 * prop so the parent can hold the cache (one HTTP fetch covers every
 * row's picker).
 */
import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Modal, Pressable } from 'react-native';
import { usePalette } from '@/hooks/use-theme';

export type LibPreset = {
  id: string;
  label: string;
  defaultBehavior: string;
  safetyTier?: string;
  params?: Record<string, unknown>;
};

export type LibEffect = {
  id: string;
  name: string;
  category: string;
  behaviorTypes: string[];
  presets: Record<string, LibPreset>;
  legacyEffectId?: string | null;
};

export type Library = Record<string, LibEffect>;

export type LibraryPick = {
  effectId: string;
  presetId: string;
  label: string;
  behavior: string;
};

// Operator-curated allowlist of effects that are pickable in the
// scheduler. Everything else in the library still renders (so the
// operator sees the full surface) but is greyed out and non-tappable.
// To re-enable an effect, add its library id below.
//
// Today's allowlist: uvBlast + fogger. Per operator request 2026-05-28
// after a ghost-ship feedbackTrails scheduling caused a render-stomp.
export const SCHEDULER_ALLOWED_EFFECT_IDS: ReadonlySet<string> = new Set([
  'uvBlast',
  'fogger',
]);

export function isSchedulerAllowedEffect(effectId: string): boolean {
  return SCHEDULER_ALLOWED_EFFECT_IDS.has(effectId);
}

interface Props {
  visible: boolean;
  library: Library | null;
  currentEffectId: string | null;
  currentPresetId: string | null;
  onClose: () => void;
  onPick: (pick: LibraryPick) => void;
}

// Group library entries by `category`. Effects without a category fall
// into "OTHER" (rare — every library entry as of docs/28 declares one).
// Returned shape preserves the insertion order of categories in the
// library map so consecutive opens of the modal don't reshuffle.
function groupByCategory(library: Library): { category: string; effects: LibEffect[] }[] {
  const map = new Map<string, LibEffect[]>();
  for (const fx of Object.values(library)) {
    const cat = (fx.category || 'OTHER').toUpperCase();
    const bucket = map.get(cat);
    if (bucket) bucket.push(fx);
    else map.set(cat, [fx]);
  }
  return Array.from(map.entries()).map(([category, effects]) => ({ category, effects }));
}

export const LibraryEffectPicker: React.FC<Props> = ({
  visible,
  library,
  currentEffectId,
  currentPresetId,
  onClose,
  onPick,
}) => {
  const C = usePalette();
  const grouped = useMemo(() => (library ? groupByCategory(library) : []), [library]);

  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        style={{
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.45)',
          justifyContent: 'center',
          padding: 24,
        }}
      >
        <Pressable
          onPress={(e) => e.stopPropagation()}
          style={{ alignSelf: 'center', width: '100%', maxWidth: 560 }}
        >
          <View style={{
            backgroundColor: C.surfaceContainerLowest,
            borderRadius: 12,
            padding: 16,
            maxHeight: '85%',
            borderWidth: 1,
            borderColor: C.ghostBorder,
          }}>
            <Text style={{
              fontFamily: 'SpaceGrotesk_700Bold',
              fontSize: 12,
              color: C.secondary,
              letterSpacing: 1,
              textTransform: 'uppercase',
              marginBottom: 12,
            }}>
              Pick effect + preset
            </Text>

            {!library ? (
              <Text style={{
                fontFamily: 'Inter_400Regular',
                fontSize: 12,
                color: C.secondary,
              }}>
                Loading library…
              </Text>
            ) : grouped.length === 0 ? (
              <Text style={{
                fontFamily: 'Inter_400Regular',
                fontSize: 12,
                color: C.secondary,
              }}>
                Engine reports no effects in the global library.
              </Text>
            ) : (
              <ScrollView style={{ maxHeight: 480 }}>
                {grouped.map((group) => (
                  <View key={group.category} style={{ marginBottom: 16 }}>
                    <Text style={{
                      fontFamily: 'SpaceGrotesk_700Bold',
                      fontSize: 10,
                      color: C.primary,
                      letterSpacing: 1.2,
                      marginBottom: 8,
                      textTransform: 'uppercase',
                    }}>
                      {group.category}
                    </Text>
                    {group.effects.map((fx) => {
                      const fxAllowed = isSchedulerAllowedEffect(fx.id);
                      return (
                      <View key={fx.id} style={{ marginBottom: 12, opacity: fxAllowed ? 1 : 0.35 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                          <Text style={{
                            fontFamily: 'SpaceGrotesk_700Bold',
                            fontSize: 11,
                            color: C.icon,
                            letterSpacing: 0.5,
                            textTransform: 'uppercase',
                          }}>
                            {fx.name}
                          </Text>
                          {!fxAllowed ? (
                            <Text style={{
                              fontFamily: 'SpaceGrotesk_700Bold',
                              fontSize: 9,
                              color: C.icon,
                              letterSpacing: 0.8,
                              textTransform: 'uppercase',
                            }}>
                              · disabled
                            </Text>
                          ) : null}
                        </View>
                        {Object.entries(fx.presets).map(([pid, preset]) => {
                          const active = fx.id === currentEffectId && pid === currentPresetId;
                          return (
                            <TouchableOpacity
                              key={pid}
                              onPress={() => {
                                // Defence-in-depth: even if a tap reaches a
                                // disabled row (it shouldn't, since the
                                // TouchableOpacity is disabled), refuse to
                                // dispatch. The greyed visual is the operator
                                // signal; this is the second gate.
                                if (!fxAllowed) return;
                                onPick({
                                  effectId: fx.id,
                                  presetId: pid,
                                  label: `${fx.id} / ${pid}`,
                                  behavior: preset.defaultBehavior || 'toggle',
                                });
                                onClose();
                              }}
                              disabled={!fxAllowed}
                              style={{
                                paddingVertical: 8,
                                paddingHorizontal: 12,
                                borderRadius: 6,
                                marginBottom: 4,
                                backgroundColor: active
                                  ? 'rgba(0, 104, 117, 0.10)'
                                  : C.surfaceContainerHigh,
                                borderWidth: 1,
                                borderColor: active ? C.primary : C.ghostBorder,
                                flexDirection: 'row',
                                alignItems: 'center',
                                gap: 8,
                                minHeight: 44,
                              }}
                              accessibilityRole="button"
                              accessibilityState={{ disabled: !fxAllowed, selected: active }}
                              accessibilityLabel={
                                fxAllowed
                                  ? `Pick ${fx.id} / ${pid}`
                                  : `${fx.id} / ${pid} disabled — not in scheduler allowlist`
                              }
                            >
                              <View style={{ flex: 1 }}>
                                <Text style={{
                                  fontFamily: 'SpaceGrotesk_700Bold',
                                  fontSize: 12,
                                  color: active ? C.primary : C.text,
                                }}>
                                  {preset.label || pid}
                                </Text>
                                <Text style={{
                                  fontFamily: 'Inter_400Regular',
                                  fontSize: 10,
                                  color: C.secondary,
                                  marginTop: 2,
                                }}>
                                  {fx.id} / {pid} · {preset.defaultBehavior}
                                </Text>
                              </View>
                              {active ? (
                                <Text style={{
                                  fontFamily: 'SpaceGrotesk_700Bold',
                                  fontSize: 16,
                                  color: C.primary,
                                  lineHeight: 16,
                                }}>
                                  ✓
                                </Text>
                              ) : null}
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                      );
                    })}
                  </View>
                ))}
              </ScrollView>
            )}

            <TouchableOpacity
              onPress={onClose}
              style={{
                marginTop: 12,
                paddingVertical: 12,
                borderRadius: 6,
                backgroundColor: C.surfaceContainerHigh,
                alignItems: 'center',
                minHeight: 44,
                justifyContent: 'center',
              }}
              accessibilityRole="button"
              accessibilityLabel="Close picker"
            >
              <Text style={{
                fontFamily: 'SpaceGrotesk_700Bold',
                fontSize: 12,
                color: C.text,
                letterSpacing: 0.5,
              }}>
                CLOSE
              </Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
};
