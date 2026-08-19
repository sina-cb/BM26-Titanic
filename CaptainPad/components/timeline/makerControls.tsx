/**
 * makerControls — themed, touch-first primitives for the Timeline maker.
 *
 * No keyboard walls (Codex / brief): every value is set by stepper,
 * segmented control, or dropdown. Visual recipe matches the scheduler /
 * deck idioms — SpaceGrotesk caps labels, pill borders, primary accent,
 * 44pt touch targets.
 *
 *   Segmented   — a horizontal row of mutually-exclusive options.
 *   Stepper     — − value +  with a formatter (time, offset, minutes…).
 *   Dropdown    — tap-to-open modal list (looks, playlists, sun events…).
 *   ToggleChip  — on/off pill.
 *   FieldLabel  — caps section label.
 */
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Modal, Pressable } from 'react-native';
import { CAPTAIN_PAD_MODAL_SUPPORTED_ORIENTATIONS } from '@/utils/modal_orientation';
import { usePalette } from '@/hooks/use-theme';

export function FieldLabel({ children }: { children: React.ReactNode }) {
  const C = usePalette();
  return (
    <Text style={{
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 10,
      letterSpacing: 1.2,
      color: C.icon,
      textTransform: 'uppercase',
      marginBottom: 6,
    }}>
      {children}
    </Text>
  );
}

// ── Segmented ───────────────────────────────────────────────────────────
export function Segmented<T extends string>({
  options, value, onChange,
}: {
  options: { id: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  const C = usePalette();
  return (
    <View style={{
      flexDirection: 'row',
      borderRadius: 8,
      borderWidth: 1,
      borderColor: C.ghostBorder,
      overflow: 'hidden',
    }}>
      {options.map((opt, i) => {
        const active = opt.id === value;
        return (
          <TouchableOpacity
            key={opt.id}
            onPress={() => onChange(opt.id)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={opt.label}
            style={{
              flex: 1,
              paddingVertical: 10,
              paddingHorizontal: 8,
              minHeight: 44,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: active ? C.primary : 'transparent',
              borderLeftWidth: i === 0 ? 0 : 1,
              borderLeftColor: C.ghostBorder,
            }}
          >
            <Text style={{
              fontFamily: 'SpaceGrotesk_700Bold',
              fontSize: 11,
              letterSpacing: 0.6,
              color: active ? C.onPrimary : C.text,
              textTransform: 'uppercase',
            }}>
              {opt.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// ── Stepper ─────────────────────────────────────────────────────────────
export function Stepper({
  value, onChange, step = 1, min = -Infinity, max = Infinity, format, wrap = false,
}: {
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  format: (v: number) => string;
  wrap?: boolean;
}) {
  const C = usePalette();
  const clamp = (v: number) => {
    if (wrap) {
      if (v > max) return min;
      if (v < min) return max;
      return v;
    }
    return Math.max(min, Math.min(max, v));
  };
  const btn = (label: string, delta: number, accLabel: string) => (
    <TouchableOpacity
      onPress={() => onChange(clamp(value + delta))}
      accessibilityRole="button"
      accessibilityLabel={accLabel}
      style={{
        width: 48,
        height: 44,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: C.primary,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'transparent',
      }}
    >
      <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 20, color: C.primary, lineHeight: 22 }}>
        {label}
      </Text>
    </TouchableOpacity>
  );
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      {btn('−', -step, 'Decrease')}
      <View style={{
        flex: 1,
        minHeight: 44,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: C.ghostBorder,
        backgroundColor: C.surfaceContainerHigh,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 12,
      }}>
        <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 16, color: C.text, letterSpacing: 0.5 }}>
          {format(value)}
        </Text>
      </View>
      {btn('+', step, 'Increase')}
    </View>
  );
}

// ── Dropdown (modal list) ───────────────────────────────────────────────
export function Dropdown({
  value, options, onSelect, placeholder = 'Select…', emptyHint,
}: {
  value: string | null;
  options: { id: string; label: string; hint?: string }[];
  onSelect: (id: string) => void;
  placeholder?: string;
  emptyHint?: string;
}) {
  const C = usePalette();
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.id === value);
  return (
    <>
      <TouchableOpacity
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={current ? current.label : placeholder}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          paddingHorizontal: 14,
          paddingVertical: 12,
          minHeight: 44,
          borderRadius: 8,
          borderWidth: 1,
          borderColor: current ? C.primary : C.ghostBorder,
          backgroundColor: C.surfaceContainerHigh,
        }}
      >
        <Text
          numberOfLines={1}
          style={{
            flex: 1,
            fontFamily: 'SpaceGrotesk_700Bold',
            fontSize: 13,
            color: current ? C.text : C.icon,
            letterSpacing: 0.4,
          }}
        >
          {current ? current.label : placeholder}
        </Text>
        <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 13, color: C.primary }}>▾</Text>
      </TouchableOpacity>
      <Modal
        transparent
        visible={open}
        animationType="fade"
        onRequestClose={() => setOpen(false)}
        supportedOrientations={CAPTAIN_PAD_MODAL_SUPPORTED_ORIENTATIONS}
      >
        <Pressable
          onPress={() => setOpen(false)}
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: 24 }}
        >
          <Pressable
            onPress={(e) => e.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: 420,
              maxHeight: '75%',
              backgroundColor: C.surfaceContainerLowest,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: C.ghostBorder,
              padding: 16,
            }}
          >
            {options.length === 0 ? (
              <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 13, color: C.secondary, paddingVertical: 12 }}>
                {emptyHint || 'No options available.'}
              </Text>
            ) : (
              <ScrollView style={{ maxHeight: 440 }}>
                {options.map((opt) => {
                  const active = opt.id === value;
                  return (
                    <TouchableOpacity
                      key={opt.id}
                      onPress={() => { onSelect(opt.id); setOpen(false); }}
                      style={{
                        paddingVertical: 12,
                        paddingHorizontal: 14,
                        borderRadius: 8,
                        marginBottom: 6,
                        minHeight: 44,
                        justifyContent: 'center',
                        borderWidth: 1,
                        borderColor: active ? C.primary : C.ghostBorder,
                        backgroundColor: active ? C.sidebarActiveBackground : 'transparent',
                      }}
                    >
                      <Text style={{
                        fontFamily: 'SpaceGrotesk_700Bold',
                        fontSize: 13,
                        color: active ? C.primary : C.text,
                        letterSpacing: 0.4,
                      }}>
                        {opt.label}
                      </Text>
                      {opt.hint ? (
                        <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 11, color: C.secondary, marginTop: 2 }}>
                          {opt.hint}
                        </Text>
                      ) : null}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

// ── ToggleChip ──────────────────────────────────────────────────────────
export function ToggleChip({
  on, onToggle, label,
}: {
  on: boolean;
  onToggle: () => void;
  label: string;
}) {
  const C = usePalette();
  return (
    <TouchableOpacity
      onPress={onToggle}
      accessibilityRole="switch"
      accessibilityState={{ checked: on }}
      accessibilityLabel={label}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 14,
        paddingVertical: 10,
        minHeight: 44,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: on ? 'transparent' : C.ghostBorder,
        backgroundColor: on ? C.tertiary : 'transparent',
        alignSelf: 'flex-start',
      }}
    >
      <View style={{
        width: 14, height: 14, borderRadius: 7,
        backgroundColor: on ? '#FFF' : 'transparent',
        borderWidth: on ? 0 : 1.5, borderColor: C.icon,
      }} />
      <Text style={{
        fontFamily: 'SpaceGrotesk_700Bold',
        fontSize: 11,
        letterSpacing: 0.6,
        color: on ? '#FFF' : C.text,
        textTransform: 'uppercase',
      }}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}
