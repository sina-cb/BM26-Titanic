/**
 * GlobalEffectMacros — v1 minimal performance grid (docs/28 §6).
 *
 * Renders the engine's 6 configured slots as a 2x3 button grid.
 * Each button maps action → label by the slot's `behavior`:
 *   toggle / hold  → ACTIVATE / DEACTIVATE
 *   trigger        → TRIGGER (instant fire)
 *   burst          → BURST (auto-timeout)
 *
 * The full UI polish described in docs/28 §6 (safety badges, hold
 * gesture handling for hold_only presets, slot configuration sheet)
 * is intentionally deferred — see the per-task report for the
 * follow-up list.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Colors } from '@/constants/theme';
import { globalStyles } from '@/styles/globalStyles';
import {
  fetchGlobalEffectSlots,
  fetchGlobalEffectSlotsStatus,
  dispatchGlobalEffectSlotAction,
  panicStopGlobalEffectMacros,
  GlobalEffectSlot,
  GlobalEffectSlotStatus,
} from '@/utils/api';
import { engineEvents } from '@/utils/engineEvents';

const C = Colors.light;

function actionForSlot(slot: GlobalEffectSlot | GlobalEffectSlotStatus, active: boolean): {
  label: string;
  action: 'activate' | 'deactivate' | 'trigger' | 'down' | 'up' | 'toggle';
} {
  switch (slot.behavior) {
    case 'trigger':
      return { label: 'TRIGGER', action: 'trigger' };
    case 'burst':
      return { label: 'BURST', action: 'trigger' };
    case 'hold':
      // Hold gesture handling is a follow-up; for v1 the button
      // behaves like a toggle but reports the underlying mode.
      return active ? { label: 'HOLD: UP', action: 'up' } : { label: 'HOLD: DOWN', action: 'down' };
    case 'toggle':
    default:
      return active ? { label: 'DEACTIVATE', action: 'deactivate' } : { label: 'ACTIVATE', action: 'activate' };
  }
}

function badgeColor(safetyTier: string | null | undefined): string {
  switch (safetyTier) {
    case 'warning':      return '#FFC107';
    case 'hold_only':    return '#FF6F00';
    case 'expert_burst': return C.error;
    default:             return C.ghostBorder;
  }
}

export const GlobalEffectMacros: React.FC = () => {
  const [slots, setSlots] = useState<GlobalEffectSlotStatus[]>([]);
  const [pendingPanic, setPendingPanic] = useState(false);

  const refresh = useCallback(async () => {
    const r = await fetchGlobalEffectSlotsStatus();
    if (r.ok && r.data?.slots) setSlots(r.data.slots);
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      // First-paint: pull /global-effect-slots so we render labels
      // immediately even if the status fetch is slow.
      const base = await fetchGlobalEffectSlots();
      if (alive && base.ok && base.data?.slots) {
        setSlots(base.data.slots.map((s: GlobalEffectSlot) => ({
          ...s, active: false, safetyTier: null, resolveError: null,
        })));
      }
      refresh();
    })();
    const unsub = engineEvents.subscribe((msg: any) => {
      if (!alive) return;
      if (msg && (msg.type === 'globalEffectMacroStatus' || msg.type === 'globalEffectSlots')) {
        // Server pushes a fresh snapshot; refresh from /status to keep
        // the active-flag derivation in one place.
        refresh();
      }
    });
    return () => { alive = false; unsub(); };
  }, [refresh]);

  const onPress = useCallback(async (slot: GlobalEffectSlotStatus) => {
    const { action } = actionForSlot(slot, slot.active);
    const r = await dispatchGlobalEffectSlotAction(slot.slotId, action);
    if (!r.ok) {
      // Show error in console — full toast UI is a follow-up.
      console.warn(`[GlobalEffectMacros] slot ${slot.slotId} ${action} failed:`, r.error);
    }
    refresh();
  }, [refresh]);

  const onPanic = useCallback(async () => {
    setPendingPanic(true);
    await panicStopGlobalEffectMacros();
    setPendingPanic(false);
    refresh();
  }, [refresh]);

  if (slots.length === 0) {
    return (
      <View style={{ paddingVertical: 16 }}>
        <Text style={{ color: C.secondary, fontSize: 12 }}>Loading global effect macros…</Text>
      </View>
    );
  }

  // Render as 2 rows × 3 cols.
  const rows: GlobalEffectSlotStatus[][] = [];
  for (let i = 0; i < slots.length; i += 3) rows.push(slots.slice(i, i + 3));

  return (
    <View style={{ paddingTop: 24, paddingBottom: 16, borderTopWidth: 1, borderTopColor: C.ghostBorder }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <Text style={globalStyles.headline}>Global Effect Macros</Text>
        <TouchableOpacity
          onPress={onPanic}
          activeOpacity={0.7}
          style={{
            paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6,
            backgroundColor: pendingPanic ? C.ghostBorder : C.error,
          }}
        >
          <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: '#FFF', fontSize: 11 }}>PANIC STOP</Text>
        </TouchableOpacity>
      </View>

      {rows.map((row, ri) => (
        <View key={ri} style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
          {row.map(slot => {
            const { label } = actionForSlot(slot, slot.active);
            const bg = slot.active ? C.primary : C.surfaceContainerHigh;
            const fg = slot.active ? '#FFF' : C.text;
            return (
              <TouchableOpacity
                key={slot.slotId}
                onPress={() => onPress(slot)}
                activeOpacity={0.7}
                style={{
                  flex: 1, minHeight: 78, padding: 10, borderRadius: 8,
                  backgroundColor: bg,
                  borderWidth: 2,
                  borderColor: badgeColor(slot.safetyTier),
                  justifyContent: 'space-between',
                }}
              >
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10, color: fg, opacity: 0.7 }}>
                    {`SLOT ${slot.slotId}`}
                  </Text>
                  <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 9, color: fg, opacity: 0.7 }}>
                    {(slot.effectId || '').toUpperCase()}
                  </Text>
                </View>
                <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 13, color: fg }} numberOfLines={1}>
                  {slot.label}
                </Text>
                <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10, color: fg, opacity: 0.85 }}>
                  {label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      ))}
    </View>
  );
};
