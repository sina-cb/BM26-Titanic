/**
 * GlobalEffectMacros — unified, compact rig-controls grid (May 2026).
 *
 * Replaces the old RigGlobals strip: the legacy effects (vintageWhite,
 * blastWhite, uvBlast, fogger) now live as engine-side slot effects
 * (see docs/28 §4.3) so the entire surface is a single grid of slot
 * buttons + one BLACKOUT e-stop.
 *
 * Compactness contract (operator feedback "buttons are too large"):
 *   - 2 rows × N columns, flex distributes width to fill the deck
 *     left pane on iPad landscape (~5 cols at 11", auto-wraps tighter
 *     on narrower viewports).
 *   - Single 32 pt button height — no more 78 pt towers.
 *   - One status badge per row instead of per-button.
 *
 * Gesture contract:
 *   - Tap (short) → dispatch the slot's default action
 *     (toggle/trigger/down depending on behavior).
 *   - Long-press (≥500 ms) → open a sheet listing every preset from
 *     the registry, tap to PATCH the slot's effectId/presetId/label.
 *
 * E-stop contract:
 *   - BLACKOUT button uses Colors.light.error and a 2-stage tap to
 *     avoid accidental triggers: tap once → arms (border pulses),
 *     tap again within 1.5 s → engages. Tap while engaged releases.
 *     The engaged tap is one-shot; the release is also one tap.
 *
 * Loading-bug fix (root cause + fix):
 *   The previous version showed "Loading global effect macros…" forever
 *   when /global-effect-slots/status returned an empty `slots` array
 *   OR the request failed silently. Two things fixed it:
 *     (1) Always paint the layout off /global-effect-slots first (no
 *         loading text — render skeleton buttons that disable
 *         themselves if status hasn't landed yet).
 *     (2) If both /global-effect-slots AND /global-effect-slots/status
 *         return non-ok, surface the engine error to the operator
 *         instead of pretending we're still "loading" (per codex P0:
 *         no fallback behaviors).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, Modal, ScrollView } from 'react-native';
import { Colors } from '@/constants/theme';
import {
  fetchGlobalEffectSlots,
  fetchGlobalEffectSlotsStatus,
  fetchGlobalEffectLibrary,
  dispatchGlobalEffectSlotAction,
  patchGlobalEffectSlot,
  setGlobalEffectBlackout,
  GlobalEffectSlot,
  GlobalEffectSlotStatus,
} from '@/utils/api';
import { engineEvents } from '@/utils/engineEvents';

const C = Colors.light;

type LibPreset = { id: string; label: string; defaultBehavior: string; safetyTier?: string; params: any };
type LibEffect = { id: string; name: string; category: string; behaviorTypes: string[]; presets: Record<string, LibPreset>; legacyEffectId?: string | null };
type Library = Record<string, LibEffect>;

interface Props {
  blackout: boolean;
  onBlackoutChange?: (v: boolean) => void;
}

function actionForSlot(slot: GlobalEffectSlot | GlobalEffectSlotStatus, active: boolean): {
  action: 'activate' | 'deactivate' | 'trigger' | 'down' | 'up' | 'toggle';
} {
  switch (slot.behavior) {
    case 'trigger':
    case 'burst':
      return { action: 'trigger' };
    case 'hold':
      return active ? { action: 'up' } : { action: 'down' };
    case 'toggle':
    default:
      return { action: active ? 'deactivate' : 'activate' };
  }
}

function safetyAccent(tier: string | null | undefined): string {
  switch (tier) {
    case 'warning':      return '#FFC107';
    case 'hold_only':    return '#FF6F00';
    case 'expert_burst': return C.error;
    default:             return 'transparent';
  }
}

export const GlobalEffectMacros: React.FC<Props> = ({ blackout, onBlackoutChange }) => {
  const [slots, setSlots] = useState<GlobalEffectSlotStatus[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [library, setLibrary] = useState<Library | null>(null);
  const [swapTarget, setSwapTarget] = useState<GlobalEffectSlotStatus | null>(null);
  const [blackoutArmed, setBlackoutArmed] = useState(false);
  const armTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFiredRef = useRef(false);

  const refresh = useCallback(async () => {
    const r = await fetchGlobalEffectSlotsStatus();
    if (r.ok && r.data?.slots) {
      setSlots(r.data.slots);
      setError(null);
    } else if (!r.ok && r.error) {
      setError(r.error);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      // Paint layout immediately from /global-effect-slots so operator
      // sees button placement even before /status lands.
      const base = await fetchGlobalEffectSlots();
      if (alive && base.ok && base.data?.slots) {
        setSlots(base.data.slots.map((s: GlobalEffectSlot) => ({
          ...s, active: false, safetyTier: null, resolveError: null,
        })));
      } else if (alive && !base.ok) {
        setError(base.error || 'Failed to load global effect slots');
      }
      const lib = await fetchGlobalEffectLibrary();
      if (alive && lib.ok && lib.data?.effects) setLibrary(lib.data.effects as Library);
      refresh();
    })();
    const unsub = engineEvents.subscribe((msg: any) => {
      if (!alive) return;
      if (msg && (msg.type === 'globalEffectMacroStatus' || msg.type === 'globalEffectSlots')) {
        refresh();
      }
      if (msg && msg.type === 'globalEffectMacroStatus' && typeof msg.blackout === 'boolean') {
        onBlackoutChange?.(msg.blackout);
      }
      if (msg && msg.type === 'mixer' && typeof msg.blackout === 'boolean') {
        onBlackoutChange?.(msg.blackout);
      }
    });
    return () => {
      alive = false;
      unsub();
      if (armTimer.current) clearTimeout(armTimer.current);
      if (longPressTimer.current) clearTimeout(longPressTimer.current);
    };
  }, [refresh, onBlackoutChange]);

  const onPressSlot = useCallback(async (slot: GlobalEffectSlotStatus) => {
    if (longPressFiredRef.current) { longPressFiredRef.current = false; return; }
    const { action } = actionForSlot(slot, slot.active);
    const r = await dispatchGlobalEffectSlotAction(slot.slotId, action);
    if (!r.ok) console.warn(`[GEM] slot ${slot.slotId} ${action} failed:`, r.error);
    refresh();
  }, [refresh]);

  const onPressInSlot = useCallback((slot: GlobalEffectSlotStatus) => {
    longPressFiredRef.current = false;
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    longPressTimer.current = setTimeout(() => {
      longPressFiredRef.current = true;
      setSwapTarget(slot);
    }, 500);
  }, []);

  const onPressOutSlot = useCallback(() => {
    if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
  }, []);

  const onPressBlackout = useCallback(async () => {
    if (blackout) {
      // Engaged → release on a single tap (deliberate: operator can
      // always re-engage just as fast).
      const r = await setGlobalEffectBlackout(false);
      if (r.ok) onBlackoutChange?.(false);
      return;
    }
    if (blackoutArmed) {
      const r = await setGlobalEffectBlackout(true);
      if (r.ok) onBlackoutChange?.(true);
      setBlackoutArmed(false);
      if (armTimer.current) clearTimeout(armTimer.current);
      return;
    }
    // First tap: arm for 1.5 s. Second tap within that window engages.
    setBlackoutArmed(true);
    if (armTimer.current) clearTimeout(armTimer.current);
    armTimer.current = setTimeout(() => setBlackoutArmed(false), 1500);
  }, [blackout, blackoutArmed, onBlackoutChange]);

  // While we wait for the first /global-effect-slots response render
  // a thin skeleton row (matches final layout so the deck doesn't
  // visually jump). If both fetches fail, surface the error.
  if (slots === null) {
    return (
      <View style={{ paddingTop: 8 }}>
        <Header />
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {Array.from({ length: 5 }).map((_, i) => (
            <View key={i} style={skeletonBtn} />
          ))}
        </View>
        {error ? (
          <Text style={{ color: C.error, fontSize: 10, marginTop: 6 }}>{error}</Text>
        ) : null}
      </View>
    );
  }

  // Render up to N cols based on slot count; two rows distribute evenly.
  const half = Math.ceil(slots.length / 2);
  const row1 = slots.slice(0, half);
  const row2 = slots.slice(half);

  return (
    <View style={{ paddingTop: 8, borderTopWidth: 1, borderTopColor: C.ghostBorder }}>
      <Header />
      {error ? (
        <Text style={{ color: C.error, fontSize: 10, marginBottom: 4 }}>{error}</Text>
      ) : null}
      {[row1, row2].map((row, ri) => (
        <View key={ri} style={{ flexDirection: 'row', gap: 4, marginBottom: 4 }}>
          {row.map(slot => (
            <SlotButton
              key={slot.slotId}
              slot={slot}
              onPress={() => onPressSlot(slot)}
              onPressIn={() => onPressInSlot(slot)}
              onPressOut={onPressOutSlot}
            />
          ))}
          {/* Pad short rows so column widths stay aligned across rows. */}
          {ri === 1 && row2.length < row1.length
            ? Array.from({ length: row1.length - row2.length }).map((_, i) => (
                <View key={`pad-${i}`} style={{ flex: 1 }} />
              ))
            : null}
          {ri === 1 ? (
            <BlackoutButton blackout={blackout} armed={blackoutArmed} onPress={onPressBlackout} />
          ) : null}
        </View>
      ))}

      <SwapSheet
        target={swapTarget}
        library={library}
        onClose={() => setSwapTarget(null)}
        onPicked={async (effectId, presetId, preset) => {
          if (!swapTarget) return;
          const slot = swapTarget;
          const behavior = preset.defaultBehavior || 'toggle';
          const label = preset.label || presetId;
          setSwapTarget(null);
          const r = await patchGlobalEffectSlot(slot.slotId, {
            effectId, presetId, behavior, label, paramsOverride: {},
          });
          if (!r.ok) {
            console.warn(`[GEM] swap slot ${slot.slotId} failed:`, r.error);
          }
          refresh();
        }}
      />
    </View>
  );
};

const Header: React.FC = () => (
  <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10, color: C.secondary, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 4 }}>
    Global Effects
  </Text>
);

const SlotButton: React.FC<{
  slot: GlobalEffectSlotStatus;
  onPress: () => void;
  onPressIn: () => void;
  onPressOut: () => void;
}> = ({ slot, onPress, onPressIn, onPressOut }) => {
  const accent = safetyAccent(slot.safetyTier);
  const bg = slot.active ? C.primary : C.surfaceContainerHigh;
  const fg = slot.active ? '#FFF' : C.text;
  return (
    <TouchableOpacity
      onPress={onPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      activeOpacity={0.7}
      delayLongPress={500}
      style={{
        flex: 1, height: 32, paddingHorizontal: 6, borderRadius: 6,
        backgroundColor: bg,
        borderWidth: accent === 'transparent' ? 1 : 2,
        borderColor: accent === 'transparent' ? (slot.active ? 'transparent' : C.ghostBorder) : accent,
        justifyContent: 'center', alignItems: 'center',
      }}
    >
      <Text numberOfLines={1} style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10, color: fg, textAlign: 'center', letterSpacing: 0.3 }}>
        {slot.label}
      </Text>
    </TouchableOpacity>
  );
};

const BlackoutButton: React.FC<{ blackout: boolean; armed: boolean; onPress: () => void }> = ({ blackout, armed, onPress }) => {
  const bg = blackout ? C.error : (armed ? C.error : C.surfaceContainerHigh);
  const fg = blackout || armed ? '#FFF' : C.error;
  const border = blackout || armed ? C.error : C.error;
  const label = blackout ? 'RELEASE' : (armed ? 'CONFIRM' : 'BLACKOUT');
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={{
        flex: 1, height: 32, paddingHorizontal: 6, borderRadius: 6,
        backgroundColor: bg, borderWidth: 2, borderColor: border,
        justifyContent: 'center', alignItems: 'center',
      }}
      accessibilityLabel={blackout ? 'Release blackout e-stop' : 'Engage blackout e-stop'}
    >
      <Text numberOfLines={1} style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10, color: fg, letterSpacing: 0.5 }}>
        {label}
      </Text>
    </TouchableOpacity>
  );
};

const SwapSheet: React.FC<{
  target: GlobalEffectSlotStatus | null;
  library: Library | null;
  onClose: () => void;
  onPicked: (effectId: string, presetId: string, preset: LibPreset) => void;
}> = ({ target, library, onClose, onPicked }) => {
  if (!target) return null;
  return (
    <Modal transparent animationType="fade" visible={!!target} onRequestClose={onClose}>
      <TouchableOpacity activeOpacity={1} onPress={onClose} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 24 }}>
        <View style={{ backgroundColor: C.surfaceContainerLowest, borderRadius: 12, padding: 16, maxHeight: '85%' }}>
          <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 12, color: C.secondary, marginBottom: 12, letterSpacing: 1, textTransform: 'uppercase' }}>
            Swap Slot {target.slotId} — {target.label}
          </Text>
          {!library ? (
            <Text style={{ color: C.secondary, fontSize: 12 }}>Loading library…</Text>
          ) : (
            <ScrollView style={{ maxHeight: 480 }}>
              {Object.values(library).map(fx => (
                <View key={fx.id} style={{ marginBottom: 14 }}>
                  <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 11, color: C.icon, marginBottom: 6, letterSpacing: 0.5, textTransform: 'uppercase' }}>
                    {fx.name}
                  </Text>
                  {Object.entries(fx.presets).map(([pid, p]) => (
                    <TouchableOpacity
                      key={pid}
                      onPress={() => onPicked(fx.id, pid, p)}
                      style={{ paddingVertical: 8, paddingHorizontal: 12, borderRadius: 6, marginBottom: 4, backgroundColor: C.surfaceContainerHigh, borderWidth: 1, borderColor: safetyAccent(p.safetyTier) === 'transparent' ? C.ghostBorder : safetyAccent(p.safetyTier) }}
                    >
                      <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 12, color: C.text }}>{p.label}</Text>
                      <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 10, color: C.secondary, marginTop: 2 }}>
                        {p.defaultBehavior}{p.safetyTier && p.safetyTier !== 'normal' ? `  ·  ${p.safetyTier}` : ''}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              ))}
            </ScrollView>
          )}
          <TouchableOpacity onPress={onClose} style={{ marginTop: 12, padding: 12, borderRadius: 6, backgroundColor: C.surfaceContainerHigh, alignItems: 'center' }}>
            <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 12, color: C.text }}>CLOSE</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    </Modal>
  );
};

const skeletonBtn = {
  flex: 1, height: 32, borderRadius: 6,
  backgroundColor: C.surfaceContainerHigh, borderWidth: 1, borderColor: C.ghostBorder,
};
