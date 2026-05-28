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
 * E-stop contract (May 2026 operator request):
 *   - BLACKOUT is a single-tap toggle. Tapping when off engages
 *     immediately (the rig is the e-stop's source of truth — there's
 *     no "I might have meant to tap something else" cost to a
 *     transient blackout). Tapping again releases. The pre-May-2026
 *     two-stage arm/confirm was removed because the slot grid above
 *     already separates the BLACKOUT button visually with the error
 *     colour + bordered cell, so accidental hits were rare and the
 *     extra tap was getting in the way of fast cuts.
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
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, Modal, ScrollView, Alert, Platform } from 'react-native';
import { usePalette } from '@/hooks/use-theme';
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

// Hard UI contract (operator review May 2026): the rig surface shows
// EXACTLY this many slots. The engine can persist up to MAX_SLOTS (16)
// — anything beyond this is hidden from the strip. The operator
// re-binds the visible 6 via long-press swap; the engine's library
// still contains every preset so swapping in vintageWhite, fogger,
// blastWhite, etc. is one tap of the SWAP modal.
const VISIBLE_SLOT_COUNT = 6;

type LibPreset = { id: string; label: string; defaultBehavior: string; safetyTier?: string; params: any };
type LibEffect = { id: string; name: string; category: string; behaviorTypes: string[]; presets: Record<string, LibPreset>; legacyEffectId?: string | null };
type Library = Record<string, LibEffect>;

interface Props {
  blackout: boolean;
  onBlackoutChange?: (v: boolean) => void;
  /**
   * Layout variant. Defaults to 'deck' (2-row grid, 44px buttons —
   * tall enough to fit slot labels in portrait, which was the
   * operator's reported pain point on the iPad Pro 11"). The mixer
   * tab passes 'mixer-strip' to render a single horizontal row of
   * all slots + BLACKOUT, full-width, taller buttons — designed to
   * be pinned to the bottom of the mixer surface.
   */
  variant?: 'deck' | 'mixer-strip';
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

// Slot stencil — the canonical "this is what an empty slot looks like".
// kept as a top-level const so referential identity is stable across
// re-renders (visibleSlots's useMemo would otherwise rebuild every tick).
const EMPTY_STENCIL = Object.freeze({
  label: '',
  effectId: '',
  presetId: '',
  behavior: 'toggle' as const,
  active: false,
  safetyTier: null,
  resolveError: null,
  enabled: false,
});

export const GlobalEffectMacros: React.FC<Props> = ({ blackout, onBlackoutChange, variant = 'deck' }) => {
  const C = usePalette();
  const [slots, setSlots] = useState<GlobalEffectSlotStatus[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [library, setLibrary] = useState<Library | null>(null);
  // Swap sheet target: slotId of the slot being edited, or null.
  const [swapTargetId, setSwapTargetId] = useState<number | null>(null);
  // Per-slot optimistic active override. Set immediately on tap; cleared
  // by either (a) a server-confirmed status update that already matches
  // our optimistic value, or (b) a fail-safe 800 ms timeout if the server
  // never confirmed. This is what fixes "tap to enable works, tap to
  // disable does nothing" — the local state changes IMMEDIATELY so the
  // next tap reads the new active value, instead of dispatching against
  // the stale active=false that the engine hadn't broadcast yet.
  const [optimisticActive, setOptimisticActive] = useState<Record<number, boolean>>({});
  const optimisticTimersRef = useRef<Record<number, ReturnType<typeof setTimeout>>>({});

  const refresh = useCallback(async () => {
    const r = await fetchGlobalEffectSlotsStatus();
    if (r.ok && r.data?.slots) {
      setSlots(r.data.slots);
      setError(null);
    } else if (!r.ok && r.error) {
      setError(r.error);
    }
  }, []);

  // Always render exactly VISIBLE_SLOT_COUNT cells. Engine slots beyond
  // 6 are hidden; if engine has fewer than 6 we pad with empty cells
  // (the operator taps the + to bind something to that slotId).
  //
  // Empty cells get a synthesized slotId = (i + 1) so PATCH /global-effect-
  // slots/:id can fill them in. The engine creates a slot record on first
  // PATCH if it doesn't exist (or, if it strictly validates, we'll find
  // out from the PATCH response and surface the error).
  const visibleSlots = useMemo(() => {
    if (!slots) return null;
    const realById = new Map<number, GlobalEffectSlotStatus>();
    for (const s of slots) {
      if (typeof s.slotId === 'number') realById.set(s.slotId, s);
    }
    const out: GlobalEffectSlotStatus[] = [];
    for (let i = 1; i <= VISIBLE_SLOT_COUNT; i++) {
      const real = realById.get(i);
      if (real && real.effectId) {
        out.push(real);
      } else {
        out.push({ ...EMPTY_STENCIL, slotId: i } as unknown as GlobalEffectSlotStatus);
      }
    }
    return out;
  }, [slots]);

  // Refs that let the boot useEffect run ONCE and never tear down
  // when a parent prop changes. Pre-fix the deps `[refresh,
  // onBlackoutChange]` rebuilt the closure on every parent render of
  // the bridge — which re-fired `fetchGlobalEffectSlots()` and that
  // call's `active:false` rewrite is what produced the off→on
  // flicker. The boot effect now has [] deps and routes through
  // refs for any callable side it needs to fire.
  const onBlackoutChangeRef = useRef(onBlackoutChange);
  useEffect(() => { onBlackoutChangeRef.current = onBlackoutChange; }, [onBlackoutChange]);
  const slotsLoadedRef = useRef(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      // Paint layout immediately from /global-effect-slots so operator
      // sees button placement even before /status lands. Skip if we
      // already have status data on screen — the original code
      // unconditionally overwrote real `active:true` slots with
      // `active:false` placeholders, producing the off→on flicker on
      // every re-mount.
      if (!slotsLoadedRef.current) {
        const base = await fetchGlobalEffectSlots();
        if (alive && base.ok && base.data?.slots) {
          const baseSlots = base.data.slots;
          setSlots(prev => prev ?? baseSlots.map((s: GlobalEffectSlot) => ({
            ...s, active: false, safetyTier: null, resolveError: null,
          })));
        } else if (alive && !base.ok) {
          setError(base.error || 'Failed to load global effect slots');
        }
      }
      const lib = await fetchGlobalEffectLibrary();
      if (alive && lib.ok && lib.data?.effects) setLibrary(lib.data.effects as Library);
      refresh().then(() => { slotsLoadedRef.current = true; });
    })();
    const unsub = engineEvents.subscribe((msg: any) => {
      if (!alive) return;
      // Operator review May 2026 #11: the engine's
      // globalEffectMacroStatus event ALREADY carries the full
      // `slots` payload (api_server.js line ~1697 — same shape as
      // GET /global-effect-slots/status). Pre-fix we fired a
      // refresh() (= another HTTP GET) on every broadcast, which
      // (a) hammered the engine on every effect tick and (b)
      // raced the GET against a fresh broadcast, occasionally
      // letting stale slot.active values land between the
      // optimistic flip and the engine confirmation — that race
      // is what made the toggle button look like it was
      // "flashing". Inline consumption removes both the perf hit
      // and the visual jitter; setSlots is a no-op if the array
      // is shallowly identical (React.memo on SlotButton handles
      // the cell-level redraw guard).
      if (msg?.type === 'globalEffectMacroStatus') {
        if (Array.isArray(msg.slots)) {
          setSlots(msg.slots);
          setError(null);
          slotsLoadedRef.current = true;
        }
        if (typeof msg.blackout === 'boolean') onBlackoutChangeRef.current?.(msg.blackout);
      } else if (msg?.type === 'globalEffectSlots') {
        // Slot config (PATCH-shaped) change — no inline status
        // payload here, so we still need to refetch to pick up
        // newly-bound effects' active flag.
        refresh();
      } else if (msg?.type === 'mixer' && typeof msg.blackout === 'boolean') {
        onBlackoutChangeRef.current?.(msg.blackout);
      }
    });
    return () => {
      alive = false;
      unsub();
      const timers = optimisticTimersRef.current;
      for (const k of Object.keys(timers)) {
        clearTimeout(timers[Number(k)]);
        delete timers[Number(k)];
      }
    };
    // Boot effect is intentionally mount-only — deps are routed
    // through refs (onBlackoutChangeRef, slotsLoadedRef) so a parent
    // prop churn never tears this down. `refresh` is a useCallback
    // with [] deps and is stable for the component lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reconcile optimistic state against authoritative engine state on
  // every status arrival. If the engine now agrees with our optimistic
  // value we drop the override; if it disagrees we still drop it (the
  // server is the source of truth) and the next render will reflect
  // the real state.
  useEffect(() => {
    if (!slots) return;
    setOptimisticActive(prev => {
      let changed = false;
      const next = { ...prev };
      for (const s of slots) {
        if (typeof s.slotId !== 'number') continue;
        if (s.slotId in next && next[s.slotId] === s.active) {
          delete next[s.slotId];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [slots]);

  // Cell tap: toggle/trigger/burst dispatch with optimistic local state.
  // The empty-cell path is handled by `onPressEmpty` (opens swap sheet).
  const onPressSlot = useCallback(async (slot: GlobalEffectSlotStatus) => {
    const slotId = slot.slotId;
    const isMomentary = slot.behavior === 'trigger' || slot.behavior === 'burst';
    if (!isMomentary) {
      // Optimistic flip for toggle/hold so the next tap reads the new
      // value even before the engine round-trip completes.
      const current = optimisticActive[slotId] ?? slot.active;
      const next = !current;
      setOptimisticActive(p => ({ ...p, [slotId]: next }));
      const t = optimisticTimersRef.current[slotId];
      if (t) clearTimeout(t);
      optimisticTimersRef.current[slotId] = setTimeout(() => {
        // Fail-safe: if the engine never confirmed (network hiccup),
        // clear the override after 800 ms so future renders reflect
        // whatever the engine has reported.
        setOptimisticActive(p => {
          if (!(slotId in p)) return p;
          const cp = { ...p }; delete cp[slotId]; return cp;
        });
        delete optimisticTimersRef.current[slotId];
      }, 800);
    }
    // Pick the action against the SAME value we just rendered with,
    // so the engine receives the dispatch the operator intended.
    const effectiveActive = isMomentary
      ? false
      : (optimisticActive[slotId] ?? slot.active);
    // For the optimistic update we already flipped, so the dispatch
    // should target the ORIGINAL (pre-flip) value's complement —
    // which is `next`. effectiveActive is the pre-tap value, so feed
    // it directly into actionForSlot which inverts internally.
    const { action } = actionForSlot(slot, effectiveActive);
    const r = await dispatchGlobalEffectSlotAction(slotId, action);
    if (!r.ok) {
      console.warn(`[GEM] slot ${slotId} ${action} failed:`, r.error);
      // Roll back optimistic state on failure so the cell reflects
      // reality (the engine never made the change).
      setOptimisticActive(p => {
        if (!(slotId in p)) return p;
        const cp = { ...p }; delete cp[slotId]; return cp;
      });
    }
    // No explicit refresh() — the engine broadcasts globalEffectMacroStatus
    // and the subscriber up top will reconcile. One less round-trip
    // and no double-fetch race.
  }, [optimisticActive]);

  // Empty cell tapped: open the swap sheet immediately (no tap-the-+
  // first / open-modal-second double action).
  const onPressEmpty = useCallback((slotId: number) => {
    setSwapTargetId(slotId);
  }, []);

  // Edit pencil tapped (top-right corner of a bound cell): open the
  // swap sheet for that slot. Separated from the cell-body tap so the
  // operator can't accidentally swap when they meant to fire.
  const onPressEdit = useCallback((slotId: number) => {
    setSwapTargetId(slotId);
  }, []);

  // Single-tap toggle (no 2-stage arm/confirm). E-stop is its own
  // distinct red cell — accidental hits are rare and the same tap
  // immediately releases.
  const onPressBlackout = useCallback(async () => {
    const next = !blackout;
    const r = await setGlobalEffectBlackout(next);
    if (r.ok) onBlackoutChange?.(next);
  }, [blackout, onBlackoutChange]);

  // Always deactivate a slot before mutating its binding. Without
  // this an operator who swaps an active legacy effect (e.g.
  // vintageWhite) to another effect leaves the controller's
  // c.effects.vintageWhite flag stranded ON — the new slot reads
  // its own preset's `active` state but the rig is still being
  // driven by the previous activate. Pre-deactivate guarantees the
  // controller state matches the slot binding state at every PATCH
  // boundary. The deactivate is best-effort: if the engine rejects
  // (slot already empty, network blip) we still proceed with the
  // PATCH because the caller wanted the binding gone either way.
  const ensureSlotOff = useCallback(async (slotId: number) => {
    const slot = visibleSlots?.find(s => s.slotId === slotId);
    if (!slot) return;
    if (!slot.effectId) return;       // empty slot — nothing to deactivate
    const optActive = optimisticActive[slotId];
    const isOn = optActive !== undefined ? optActive : slot.active;
    if (!isOn) return;
    try {
      await dispatchGlobalEffectSlotAction(slotId, 'deactivate');
    } catch (e) {
      console.warn(`[GEM] pre-swap deactivate slot ${slotId} failed:`, e);
    }
    // Drop our local optimistic so the cell snaps to the engine's
    // canonical "off" state before the new binding lands.
    setOptimisticActive(p => {
      if (!(slotId in p)) return p;
      const cp = { ...p }; delete cp[slotId]; return cp;
    });
  }, [visibleSlots, optimisticActive]);

  const onClearSlot = useCallback(async (slotId: number) => {
    setSwapTargetId(null);
    await ensureSlotOff(slotId);
    const r = await patchGlobalEffectSlot(slotId, { enabled: false });
    if (!r.ok) {
      console.warn(`[GEM] clear slot ${slotId} failed:`, r.error);
      Alert.alert('Slot clear failed', r.error || 'Engine rejected the PATCH.');
    }
    refresh();
  }, [refresh, ensureSlotOff]);

  const onPickSwap = useCallback(async (
    slotId: number,
    effectId: string,
    presetId: string,
    preset: LibPreset,
  ) => {
    const behavior = preset.defaultBehavior || 'toggle';
    const label = preset.label || presetId;
    setSwapTargetId(null);
    await ensureSlotOff(slotId);
    const r = await patchGlobalEffectSlot(slotId, {
      effectId, presetId, behavior, label, paramsOverride: {}, enabled: true,
    });
    if (!r.ok) {
      console.warn(`[GEM] swap slot ${slotId} failed:`, r.error);
      Alert.alert('Slot bind failed', r.error || 'Engine rejected the PATCH.');
    }
    refresh();
  }, [refresh, ensureSlotOff]);

  // Geometry per variant. Single source so the skeleton, real grid,
  // and blackout button all stay in lockstep.
  //
  // mixer-strip is now intentionally LESS TALL than the deck grid
  // (operator review May 2026: "make them less tall and shorter").
  // The mixer surface is already vertically constrained by the
  // channel strips; a 52 px row was eating fader real-estate.
  const isStrip   = variant === 'mixer-strip';
  const btnHeight = isStrip ? 36 : 44;
  const btnFont   = isStrip ? 11 : 11;
  const gap       = isStrip ? 4 : 5;

  // While we wait for the first /global-effect-slots response render
  // a thin skeleton row (matches final layout so the deck doesn't
  // visually jump). If both fetches fail, surface the error.
  if (visibleSlots === null) {
    return (
      <View style={{ paddingTop: 8 }}>
        <Header variant={variant} />
        <View style={{ flexDirection: 'row', gap }}>
          {Array.from({ length: VISIBLE_SLOT_COUNT }).map((_, i) => (
            <View key={i} style={{ flex: 1, height: btnHeight, borderRadius: 6, backgroundColor: C.surfaceContainerHigh, borderWidth: 1, borderColor: C.ghostBorder }} />
          ))}
        </View>
        {error ? (
          <Text style={{ color: C.error, fontSize: 10, marginTop: 6 }}>{error}</Text>
        ) : null}
      </View>
    );
  }

  return (
    <View style={{ paddingTop: 6, borderTopWidth: 1, borderTopColor: C.ghostBorder, flex: isStrip ? 1 : undefined }}>
      <Header variant={variant} />
      {error ? (
        <Text style={{ color: C.error, fontSize: 10, marginBottom: 4 }}>{error}</Text>
      ) : null}
      {(() => {
        const renderCell = (slot: GlobalEffectSlotStatus) => {
          const slotId = slot.slotId as number;
          const isEmpty = !slot.effectId;
          if (isEmpty) {
            return (
              <EmptySlotButton
                key={slotId}
                slotId={slotId}
                height={btnHeight}
                onPress={() => onPressEmpty(slotId)}
              />
            );
          }
          const optActive = optimisticActive[slotId];
          const isOn = optActive !== undefined ? optActive : slot.active;
          return (
            <SlotButton
              key={slotId}
              slot={slot}
              isOn={!!isOn}
              height={btnHeight}
              fontSize={btnFont}
              onPress={() => onPressSlot(slot)}
              onEdit={() => onPressEdit(slotId)}
            />
          );
        };

        if (isStrip) {
          return (
            <View style={{ flexDirection: 'row', gap }}>
              {visibleSlots.map(renderCell)}
              <BlackoutButton blackout={blackout} height={btnHeight} fontSize={btnFont} onPress={onPressBlackout} />
            </View>
          );
        }
        // Deck: 2 rows × 3 cols, BLACKOUT in bottom-right.
        const half = Math.ceil(visibleSlots.length / 2);
        const row1 = visibleSlots.slice(0, half);
        const row2 = visibleSlots.slice(half);
        return [row1, row2].map((row, ri) => (
          <View key={ri} style={{ flexDirection: 'row', gap, marginBottom: 4 }}>
            {row.map(renderCell)}
            {ri === 1 && row2.length < row1.length
              ? Array.from({ length: row1.length - row2.length }).map((_, i) => (
                  <View key={`pad-${i}`} style={{ flex: 1 }} />
                ))
              : null}
            {ri === 1 ? (
              <BlackoutButton blackout={blackout} height={btnHeight} fontSize={btnFont} onPress={onPressBlackout} />
            ) : null}
          </View>
        ));
      })()}

      <SwapSheet
        slotId={swapTargetId}
        slot={swapTargetId !== null ? visibleSlots.find(s => s.slotId === swapTargetId) ?? null : null}
        library={library}
        onClose={() => setSwapTargetId(null)}
        onPicked={(effectId, presetId, preset) => {
          if (swapTargetId !== null) onPickSwap(swapTargetId, effectId, presetId, preset);
        }}
        onClear={() => {
          if (swapTargetId !== null) onClearSlot(swapTargetId);
        }}
      />
    </View>
  );
};

const Header: React.FC<{ variant: 'deck' | 'mixer-strip' }> = ({ variant }) => {
  const C = usePalette();
  return (
    <Text style={{
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: variant === 'mixer-strip' ? 9 : 10,
      color: C.secondary, letterSpacing: 1.2,
      textTransform: 'uppercase',
      marginBottom: 4,
    }}>
      Global Effects
    </Text>
  );
};

// Bound slot cell. The cell body is the tap target; the tiny edit
// pencil in the top-right corner opens the swap sheet. We deliberately
// dropped long-press-to-swap (operator review May 2026) — it was
// unreliable on web (no native long-press contract) and ambiguous on
// touch (gesture races with simple taps).
//
// Visual contract:
//   - toggle/hold ON  → primary (teal) fill, white text
//   - toggle/hold OFF → ghost-bordered grey fill, dark text
//   - trigger/burst   → MOMENTARY. Tap pulses the body for 180 ms
//     (subtle surface lift), never tracks the engine `active` flag.
//     This kills the "20 Hz Burst keeps flashing red" complaint —
//     the engine still toggles active true→false for the burst, but
//     the cell visual is bound entirely to the local press ack, not
//     to that flag.
//   - safety tier     → NEVER a coloured border any more (the red
//     expert_burst border was the other half of the "flashing"
//     complaint). The tier shows as a tiny coloured dot in the
//     top-left corner instead, so the operator still has the
//     "this preset is dangerous" cue at a glance.
const SlotButton: React.FC<{
  slot: GlobalEffectSlotStatus;
  isOn: boolean;
  height: number;
  fontSize: number;
  onPress: () => void;
  onEdit: () => void;
}> = ({ slot, isOn, height, fontSize, onPress, onEdit }) => {
  const C = usePalette();
  const isMomentary = slot.behavior === 'trigger' || slot.behavior === 'burst';
  const [ackAt, setAckAt] = useState<number | null>(null);
  useEffect(() => {
    if (ackAt === null) return;
    const t = setTimeout(() => setAckAt(null), 180);
    return () => clearTimeout(t);
  }, [ackAt]);

  const onPressInternal = () => {
    if (isMomentary) setAckAt(Date.now());
    onPress();
  };

  const showOn = !isMomentary && isOn;
  const showAck = isMomentary && ackAt !== null;
  const bg = showOn
    ? C.primary
    : showAck
      ? C.surface
      : C.surfaceContainerHigh;
  const fg = showOn ? '#FFF' : C.text;

  return (
    <View style={{ flex: 1, height, position: 'relative' }}>
      <TouchableOpacity
        onPress={onPressInternal}
        // activeOpacity:1 + no transition → no press-time fade and no
        // bg color transition. Operator complaint May 2026: "the blue
        // is still flashing". On react-native-web the default
        // TouchableOpacity drops to 0.2 opacity on press and the View
        // animates background-color over 0.25s. Together those read
        // as a "flash" each time a status broadcast triggered a
        // re-render (even with the same on/off value). Disabling
        // both makes ON solid blue, OFF solid grey, instant.
        activeOpacity={1}
        style={{
          flex: 1, paddingHorizontal: 6, borderRadius: 6,
          backgroundColor: bg,
          borderWidth: 1,
          borderColor: showOn ? 'transparent' : C.ghostBorder,
          justifyContent: 'center', alignItems: 'center',
          // RN-Web only: kills the auto bg-color transition. Ignored
          // by native React Native (no-op there).
          ...(Platform.OS === 'web' ? { transitionDuration: '0s' as any } : {}),
        }}
      >
        <Text
          numberOfLines={2}
          adjustsFontSizeToFit
          minimumFontScale={0.7}
          style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize, color: fg, textAlign: 'center', letterSpacing: 0.3 }}
        >
          {slot.label}
        </Text>
      </TouchableOpacity>
      <TouchableOpacity
        onPress={onEdit}
        activeOpacity={0.6}
        hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
        accessibilityLabel={`Edit slot ${slot.slotId}`}
        style={{
          position: 'absolute', top: 2, right: 2,
          width: 16, height: 16, borderRadius: 8,
          backgroundColor: showOn ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.04)',
          alignItems: 'center', justifyContent: 'center',
        }}
      >
        <Text style={{
          fontFamily: 'SpaceGrotesk_700Bold',
          fontSize: 9,
          color: showOn ? '#FFF' : C.secondary,
          lineHeight: 9,
        }}>⋯</Text>
      </TouchableOpacity>
    </View>
  );
};

// (Removed: safetyDotColor — operator review May 2026 #10 asked for
// the corner pips to go away entirely. Strobes are toggle-only now,
// blackout is the only e-stop, so the per-cell safety pip carried no
// extra info. Safety tiers are still exposed via the slot status'
// `safetyTier` field for HIL tests and future telemetry.)

// Empty slot cell — single full-cell tap opens the swap sheet. Visually
// distinct (dashed border, faded fill, big +) so the operator knows
// they're staring at an unbound slot.
const EmptySlotButton: React.FC<{
  slotId: number;
  height: number;
  onPress: () => void;
}> = ({ slotId, height, onPress }) => {
  const C = usePalette();
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={1}
      accessibilityLabel={`Add effect to slot ${slotId}`}
      style={{
        flex: 1, height, borderRadius: 6,
        backgroundColor: C.surfaceContainerLowest,
        borderWidth: 1,
        borderStyle: 'dashed',
        borderColor: C.ghostBorder,
        justifyContent: 'center', alignItems: 'center',
        ...(Platform.OS === 'web' ? { transitionDuration: '0s' as any } : {}),
      }}
    >
      <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 18, color: C.icon, lineHeight: 20 }}>
        +
      </Text>
    </TouchableOpacity>
  );
};

const BlackoutButton: React.FC<{
  blackout: boolean;
  height: number;
  fontSize: number;
  onPress: () => void;
}> = ({ blackout, height, fontSize, onPress }) => {
  const C = usePalette();
  // When OFF the cell is a flat ghost-bordered surface with red text
  // (operator review May 2026: the always-on red border was reading
  // as "this is constantly active / flashing"). When ON the entire
  // cell becomes red — unambiguous e-stop state.
  const isOn = !!blackout;
  const bg = isOn ? C.error : C.surfaceContainerHigh;
  const fg = isOn ? '#FFF' : C.error;
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={1}
      style={{
        flex: 1, height, paddingHorizontal: 6, borderRadius: 6,
        backgroundColor: bg,
        borderWidth: 1,
        borderColor: isOn ? 'transparent' : C.ghostBorder,
        justifyContent: 'center', alignItems: 'center',
        ...(Platform.OS === 'web' ? { transitionDuration: '0s' as any } : {}),
      }}
      accessibilityLabel={isOn ? 'Release blackout e-stop' : 'Engage blackout e-stop'}
    >
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.7}
        style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize, color: fg, letterSpacing: 0.5 }}
      >
        {isOn ? 'RELEASE' : 'BLACKOUT'}
      </Text>
    </TouchableOpacity>
  );
};

// Floating swap sheet. Operator can:
//   - pick any preset from any library effect → binds it to this slot
//   - tap REMOVE (only shown when the slot is currently bound) →
//     PATCHes { enabled:false } so the cell reverts to + EMPTY.
//   - tap outside / CLOSE → cancels.
const SwapSheet: React.FC<{
  slotId: number | null;
  slot: GlobalEffectSlotStatus | null;
  library: Library | null;
  onClose: () => void;
  onPicked: (effectId: string, presetId: string, preset: LibPreset) => void;
  onClear: () => void;
}> = ({ slotId, slot, library, onClose, onPicked, onClear }) => {
  const C = usePalette();
  if (slotId === null) return null;
  const isBound = !!slot?.effectId;
  const title = isBound
    ? `Slot ${slotId} — ${slot?.label ?? ''}`
    : `Slot ${slotId} — Empty`;
  return (
    <Modal transparent animationType="fade" visible={slotId !== null} onRequestClose={onClose}>
      <TouchableOpacity activeOpacity={1} onPress={onClose} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 24 }}>
        <TouchableOpacity activeOpacity={1} onPress={() => {}} style={{ alignSelf: 'center', width: '100%', maxWidth: 560 }}>
          <View style={{ backgroundColor: C.surfaceContainerLowest, borderRadius: 12, padding: 16, maxHeight: '85%' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 12, color: C.secondary, letterSpacing: 1, textTransform: 'uppercase', flex: 1 }}>
                {title}
              </Text>
              {isBound ? (
                <TouchableOpacity
                  onPress={onClear}
                  style={{
                    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6,
                    backgroundColor: C.surfaceContainerHigh, borderWidth: 1, borderColor: C.error,
                  }}
                  accessibilityLabel="Remove effect from slot"
                >
                  <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 11, color: C.error, letterSpacing: 0.5 }}>REMOVE</Text>
                </TouchableOpacity>
              ) : null}
            </View>
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
                        style={{ paddingVertical: 8, paddingHorizontal: 12, borderRadius: 6, marginBottom: 4, backgroundColor: C.surfaceContainerHigh, borderWidth: 1, borderColor: C.ghostBorder, flexDirection: 'row', alignItems: 'center', gap: 8 }}
                      >
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 12, color: C.text }}>{p.label}</Text>
                          <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 10, color: C.secondary, marginTop: 2 }}>
                            {p.defaultBehavior}
                          </Text>
                        </View>
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
      </TouchableOpacity>
    </Modal>
  );
};

