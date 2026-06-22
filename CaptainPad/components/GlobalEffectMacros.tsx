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
import { View, Text, TouchableOpacity, Modal, ScrollView, Alert, Platform, useWindowDimensions } from 'react-native';
import { usePalette } from '@/hooks/use-theme';
import {
  fetchGlobalEffectSlots,
  fetchGlobalEffectSlotsStatus,
  fetchGlobalEffectLibrary,
  dispatchGlobalEffectSlotAction,
  patchGlobalEffectSlot,
  setGlobalEffectBlackout,
  setGlobalInvert,
  fetchGlobals,
  GlobalEffectSlot,
  GlobalEffectSlotStatus,
} from '@/utils/api';
import { setGlobalHue } from '@/utils/channelExtrasApi';
import { HorizontalFader } from '@/components/ui/HorizontalFader';
import { engineEvents } from '@/utils/engineEvents';

// Hard UI contract (operator review May 2026): the rig surface shows
// EXACTLY this many slots. The engine can persist up to MAX_SLOTS (16)
// — anything beyond this is hidden from the strip. The operator
// re-binds the visible slots via long-press swap; the engine's library
// still contains every preset so swapping in vintageWhite, fogger,
// blastWhite, etc. is one tap of the SWAP modal.
// 8 slots (operator request 2026-06-22): the engine supports up to MAX_SLOTS=16
// and ships 12 default bindings, so slots 7–8 surface real effects (Vintage
// Wht / Blast Wht) — or empty + assignable if the engine returns fewer. Shared
// by BOTH the deck and mixer bottom bars (same GlobalEffectMacros instance).
const VISIBLE_SLOT_COUNT = 8;

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
  // Orientation signal — same pattern as DeckTopBar / CPCControls. Portrait
  // panes are far narrower, so the deck grid drops to 3 columns and the mixer
  // strip wraps to two rows. This is what lets every effect label render at a
  // real, fully-legible font instead of an ellipsis stub (QA round3).
  const { width, height } = useWindowDimensions();
  const isPortrait = width < height;
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

  // Global hue shifter (docs/39 §F-hue). `degrees` is the live rig hue offset,
  // reflecting the engine's `globalHueShift` broadcast. The SPIN (auto-rotate)
  // control was removed (June 2026), so we no longer track a spin rate in
  // state — every hue write forces it to 0 and the mount clear zeroes any
  // persisted spin.
  const [hueShift, setHueShift] = useState<{ degrees: number }>({ degrees: 0 });
  // While the operator is dragging the degrees fader the engine may also be
  // auto-rotating — we don't want the incoming broadcast to yank the thumb out
  // from under their finger. This holds the live drag target; cleared on release.
  const hueDraggingRef = useRef(false);

  // Global color INVERT (docs/39 §F-invert). A first-class boolean toggle,
  // sibling of blackout — seeded from /globals.invert at mount, kept live by
  // the `globalInvert` WS broadcast. Mirrors how `blackout` is plumbed.
  const [invert, setInvert] = useState(false);

  // SPIN was removed from the hue section (June 2026). The auto-rotate rate is
  // persisted engine-side, so a previously-set spin would keep silently
  // rotating the hue with no visible control to stop it. Guard so we send
  // exactly ONE setGlobalHue(degrees, 0) at mount to force spin off — once the
  // seeded degrees have landed, not while the operator is dragging the hue
  // fader, and never more than once per mount.
  const spinClearedRef = useRef(false);

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
  // VISIBLE_SLOT_COUNT are hidden; if engine has fewer we pad with empty
  // cells (the operator taps the + to bind something to that slotId).
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
      // Seed the global hue knob from /globals (the engine's persisted
      // hueShift). The globalHueShift WS broadcast keeps it live afterwards.
      const globals = await fetchGlobals();
      if (alive && globals.ok && globals.data) {
        // Seed the global color INVERT toggle from /globals.invert (mirror of
        // the blackout/hue seed). The `globalInvert` WS broadcast keeps it
        // live afterwards.
        if (typeof globals.data.invert === 'boolean') {
          setInvert(globals.data.invert);
        }
        if (globals.data.hueShift && !hueDraggingRef.current) {
          const hs = globals.data.hueShift;
          if (typeof hs.degrees === 'number') {
            setHueShift({ degrees: hs.degrees });
          }
          // SPIN control was removed (June 2026): force any persisted
          // auto-rotate off exactly once at mount so the hue can't keep
          // spinning invisibly. We use the SEEDED degrees as the start
          // offset and only fire if there's actually a residual spin and
          // the operator isn't mid-drag. The ref guards against a second
          // fire on any later re-run of this effect.
          if (!spinClearedRef.current && !hueDraggingRef.current
              && typeof hs.autoRotateDegPerSec === 'number' && Math.round(hs.autoRotateDegPerSec) !== 0) {
            spinClearedRef.current = true;
            const seededDegrees = typeof hs.degrees === 'number' ? hs.degrees : 0;
            setGlobalHue(seededDegrees, 0).then(r => {
              if (!r.ok) console.warn('[GEM] failed to clear persisted hue spin:', r.error);
            });
          }
        }
      }
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
      } else if (msg?.type === 'globalHueShift' && msg.hueShift) {
        // The engine is authoritative for the live degrees. Reflect them
        // UNLESS the operator is mid-drag on the degrees fader, in which case
        // we'd be fighting their finger. SPIN was removed (June 2026), so we
        // no longer reconcile autoRotateDegPerSec — only the hue degrees.
        const hs = msg.hueShift;
        const degrees = typeof hs.degrees === 'number' ? hs.degrees : 0;
        setHueShift(prev => ({ degrees: hueDraggingRef.current ? prev.degrees : degrees }));
      } else if (msg?.type === 'globalInvert' && typeof msg.invert === 'boolean') {
        // Engine is authoritative for the INVERT toggle (mirror of the
        // blackout reconciliation). Reflect every broadcast.
        setInvert(msg.invert);
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

  // Single-tap INVERT toggle (mirror of onPressBlackout). Optimistic flip so
  // the cell responds instantly; the `globalInvert` WS broadcast reconciles
  // the authoritative state. Fail-loud: roll back + surface a rejection.
  const onPressInvert = useCallback(async () => {
    const next = !invert;
    setInvert(next);
    const r = await setGlobalInvert(next);
    if (!r.ok) {
      console.warn('[GEM] global invert rejected:', r.error);
      setInvert(invert);
      Alert.alert('Invert not applied', r.error || 'The engine rejected the global invert.');
    }
  }, [invert]);

  // Global hue degrees fader (0-360°). Optimistic local set + POST. The
  // HorizontalFader throttles onChange to ~50 ms during a drag, so each POST
  // is naturally rate-limited. Fail-loud: surface a rejection.
  //
  // SPIN removed (June 2026): the auto-rotate control is gone, so EVERY hue
  // write now FORCES autoRotateDegPerSec: 0. Without this, a previously
  // persisted spin would survive (the engine keeps the last rate) and the hue
  // would keep rotating invisibly with no control to stop it. Pairs with the
  // one-shot mount clear in the boot effect.
  const onHueDegreesChange = useCallback(async (deg: number) => {
    setHueShift({ degrees: deg });
    const r = await setGlobalHue(deg, 0);
    if (!r.ok) {
      console.warn('[GEM] global hue degrees rejected:', r.error);
      Alert.alert('Hue not applied', r.error || 'The engine rejected the global hue.');
    }
  }, []);

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
  // QA round1 #1: the deck grid was 3-up (row1) then 5-up (row2), so the
  // bottom row's chips (Ghost Trails / UV Blast / Iceberg Flash / INVERT /
  // BLACKOUT) were squeezed below their legible width and truncated to
  // unreadable stubs ("Gh o…", "BLA…") in portrait — a clipped destructive
  // BLACKOUT is a live-show safety problem. The deck grid is now a UNIFORM
  // N-column wrap: every row has the same column count, so every chip is the
  // same width and labels wrap to 2 lines (SlotButton numberOfLines={2}) with
  // NO mid-word truncation. 48px tall so a 2-line label fits.
  // QA round3: `adjustsFontSizeToFit` is a NO-OP on react-native-web, so a font
  // that doesn't fit just truncates with an ellipsis. We no longer rely on it —
  // every label below picks a REAL fontSize that fits at the column width, and
  // wraps cleanly to 2 lines (no ellipsis) when a two-word name needs it.
  //
  // Portrait panes (deck left-pane, mixer bottom strip) are much narrower than
  // landscape, so we use fewer columns AND a smaller font there. The taller
  // chip (52px in portrait) guarantees a 2-line wrapped label
  // ("5 Hz\nPunch", "Vintage\nWhite") fits without clipping.
  // Strip (mixer + deck bottom bar): ONE flat row of 8 controls in both
  // orientations (operator request 2026-06-22). Portrait chips are narrower,
  // so they're made TALLER (60px) to give a 2-line wrapped label room without
  // truncating; landscape bumps to 44px to match the beefier touch target.
  const btnHeight = isStrip
    ? (isPortrait ? 60 : 44)
    : (isPortrait ? 52 : 48);
  // Deck portrait left-pane is the tightest 3-up width, so it drops to 9px to
  // guarantee a 7-char word ("Vintage", "Iceberg") fits a wrapped line clear of
  // the ⋯ gutter. The mixer strip (now 4-up wrapped) keeps 10px.
  const btnFont   = isStrip
    ? (isPortrait ? 10 : 11)
    : (isPortrait ? 9 : 11);
  const gap       = isStrip ? 4 : 5;
  // Uniform deck grid columns. Landscape fits 4-up comfortably; the narrow
  // portrait left-pane needs 3-up so each chip is wide enough for its full
  // wrapped label (QA round3: 4-up portrait chips were ~90px and truncated).
  const deckCols  = isPortrait ? 3 : 4;

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
      {/* Global hue shifter (docs/39 §F-hue). A first-class rig knob (NOT a GEM
          slot): a continuous RGB-only hue rotation applied post-composite on
          the whole output. W/A/UV (mission-critical exterior whites) are never
          touched. June 2026: collapsed to a single inline row and MOVED to the
          TOP of GLOBAL EFFECTS (above the slot grid) per operator request.
          Omitted on the constrained mixer-strip variant — that single-row
          strip is pinned to the bottom of the mixer surface and has no room
          for an extra control. */}
      {!isStrip && (
        <HueShiftSection
          degrees={hueShift.degrees}
          onDegreesChange={onHueDegreesChange}
          onDegreesDragStart={() => { hueDraggingRef.current = true; }}
          onDegreesRelease={() => { hueDraggingRef.current = false; }}
        />
      )}
      {error ? (
        <Text style={{ color: C.error, fontSize: 10, marginBottom: 4 }}>{error}</Text>
      ) : null}
      {(() => {
        // `minWidth` (set only for the portrait scroll strip) switches a
        // chip from flex:1 (share the bar width) to a fixed minWidth so it
        // can render a full 2-line label instead of being squeezed to a
        // mid-word-chopping ~70px (QA round7 BLOCKER).
        const renderCell = (slot: GlobalEffectSlotStatus, minWidth?: number) => {
          const slotId = slot.slotId as number;
          const isEmpty = !slot.effectId;
          if (isEmpty) {
            return (
              <EmptySlotButton
                key={slotId}
                slotId={slotId}
                height={btnHeight}
                minWidth={minWidth}
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
              minWidth={minWidth}
              onPress={() => onPressSlot(slot)}
              onEdit={() => onPressEdit(slotId)}
            />
          );
        };

        if (isStrip) {
          // The 8 slot chips. In LANDSCAPE they flex:1 to fill the bar
          // (plenty of width per chip — labels already fit, QA round7).
          // In PORTRAIT the bar is far too narrow for 10 cells: at flex:1
          // every chip squeezed to ~70px and the 2-word labels chopped
          // mid-word ("Vint ag…", "Ghos t …" — QA round7 BLOCKER). So in
          // portrait we drop the flex, give each chip a real minWidth
          // (~96px), and let the WHOLE row scroll horizontally — the
          // operator swipes the strip instead of reading mangled stubs. The
          // minWidth (96px) gives a 2-line label ("Vintage\nWhite",
          // "Iceberg\nFlash") room to render in full.
          const SLOT_MIN_WIDTH = 96;
          const slotChips = visibleSlots.map((slot) =>
            renderCell(slot, isPortrait ? SLOT_MIN_WIDTH : undefined),
          );
          // Invert + Blackout get FIXED widths so they never shrink — the
          // e-stop must keep a stable, recognisable footprint regardless of
          // orientation or how many slots are bound.
          const invertCell = (
            <InvertButton key="invert" invert={invert} height={btnHeight} fontSize={btnFont} onPress={onPressInvert} fixedWidth={isPortrait ? 78 : undefined} />
          );
          const blackoutCell = (
            <BlackoutButton key="blackout" blackout={blackout} height={btnHeight} fontSize={btnFont} onPress={onPressBlackout} fixedWidth={isPortrait ? 96 : 112} />
          );
          // A small divider/gap separates the destructive BLACKOUT e-stop
          // from the slot grid so it never reads as "just another slot"
          // (QA round7 MAJOR). Invert sits with the slots (non-destructive);
          // the divider is between Invert and Blackout.
          const Divider = (
            <View key="divider" style={{ width: 1, alignSelf: 'stretch', marginHorizontal: 4, backgroundColor: C.ghostBorder }} />
          );

          if (isPortrait) {
            // ONE row, horizontally scrollable. Slots scroll; Invert +
            // divider + Blackout are pinned in the scroll content at the end
            // (operator requirement: keep it a single row — no wrap).
            return (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator
                contentContainerStyle={{ flexDirection: 'row', alignItems: 'center', gap, paddingRight: 2 }}
              >
                {slotChips}
                {invertCell}
                {Divider}
                {blackoutCell}
              </ScrollView>
            );
          }
          // Landscape: ONE flat flex row, no scroll — the bar is wide enough.
          return (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap }}>
              {slotChips}
              {invertCell}
              {Divider}
              {blackoutCell}
            </View>
          );
        }
        // Deck: one UNIFORM grid of every control (slots + INVERT + BLACKOUT)
        // chunked into rows of `deckCols`. Every row carries exactly deckCols
        // cells (the last row is padded with invisible spacers) so chip widths
        // are identical across rows — fixing the old 3-up/5-up squeeze that
        // truncated the bottom-row labels (QA round1 #1). INVERT and BLACKOUT
        // are the last two cells so the destructive e-stop stays bottom-right.
        const cells: React.ReactNode[] = [
          // NB: wrap in an arrow so Array.map's index arg is never passed as
          // `minWidth` — the deck grid wants flex:1 cells (minWidth undefined).
          ...visibleSlots.map((slot) => renderCell(slot)),
          <InvertButton key="invert" invert={invert} height={btnHeight} fontSize={btnFont} onPress={onPressInvert} />,
          <BlackoutButton key="blackout" blackout={blackout} height={btnHeight} fontSize={btnFont} onPress={onPressBlackout} />,
        ];
        const rows: React.ReactNode[][] = [];
        for (let i = 0; i < cells.length; i += deckCols) {
          rows.push(cells.slice(i, i + deckCols));
        }
        return rows.map((row, ri) => (
          <View key={ri} style={{ flexDirection: 'row', gap, marginBottom: 4 }}>
            {row}
            {row.length < deckCols
              ? Array.from({ length: deckCols - row.length }).map((_, i) => (
                  <View key={`pad-${i}`} style={{ flex: 1 }} />
                ))
              : null}
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

// Global hue shifter UI (docs/39 §F-hue). A single HUE 0-360° fader — the
// rig-wide chroma offset. Always reflects the engine's reported degrees, but
// the parent suppresses the broadcast while the operator is dragging.
//
// SPIN removed (June 2026): the auto-rotate fader was deleted. Every hue write
// now forces autoRotateDegPerSec: 0 (see onHueDegreesChange) and the component
// clears any persisted spin once at mount, so the hue can never rotate
// invisibly without a control to stop it.
//
// ONE-ROW LAYOUT (June 2026): the section is now a single horizontal row —
// HUE label + fader + degree readout + live hue swatch, all inline — matching
// the app's one-row control idiom (cf. the old CAP row / mixer strips). It is
// rendered at the TOP of the GLOBAL EFFECTS area (above the slot grid).
//
// The fader is normalized 0..1 (HorizontalFader's contract); engineering units
// map across that range at the boundary. The row is ≥44pt tall for a
// comfortable touch target. A live swatch previews the current hue.
const HueShiftSection: React.FC<{
  degrees: number;
  onDegreesChange: (deg: number) => void;
  onDegreesDragStart: () => void;
  onDegreesRelease: () => void;
}> = ({ degrees, onDegreesChange, onDegreesDragStart, onDegreesRelease }) => {
  const C = usePalette();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 44, marginBottom: 6 }}>
      <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10, color: C.secondary, width: 40, letterSpacing: 0.5, textTransform: 'uppercase' }}>HUE</Text>
      {/* QA round1 #15: the track was given `flex: 1` directly, but the
          HorizontalFader root's onLayout width didn't grow on react-native-web
          (the flex shorthand resolved flexBasis:auto and the track sized to
          content ~28%). Wrap it in a flex:1 / minWidth:0 spacer and let the
          track fill that wrapper at width:100% so it spans the row; the value
          stays right-aligned in its fixed column. */}
      <View style={{ flex: 1, minWidth: 0, marginHorizontal: 8 }}>
        <HorizontalFader
          value={Math.max(0, Math.min(1, degrees / 360))}
          onChange={(v: number) => onDegreesChange(Math.round(v * 360))}
          onDragStart={onDegreesDragStart}
          onRelease={onDegreesRelease}
          trackStyle={{ width: '100%', height: 12, backgroundColor: C.surfaceContainerHigh, borderRadius: 6, justifyContent: 'center' }}
          fillStyle={{ position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: C.primaryFixedDim, borderRadius: 6 }}
          thumbStyle={{ position: 'absolute', width: 16, height: 22, backgroundColor: C.surfaceContainerLowest, borderRadius: 4, borderWidth: 1, borderColor: C.ghostBorder, transform: [{ translateX: -8 }] }}
        />
      </View>
      <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 12, color: C.text, width: 40, textAlign: 'right' }}>{Math.round(degrees)}°</Text>
      <View
        style={{
          width: 20, height: 20, borderRadius: 4, marginLeft: 8,
          borderWidth: 1, borderColor: C.ghostBorder,
          backgroundColor: `hsl(${Math.round(degrees)}, 80%, 55%)`,
        }}
        accessibilityLabel={`Current global hue ${Math.round(degrees)} degrees`}
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
// QA round7: the ⋯ edit affordance moved to the BOTTOM-right corner (out of
// the centred label's text band), so the label no longer reserves any
// right-side gutter — it uses the full chip width and wraps cleanly to 2
// lines. (The old EDIT_AFFORDANCE_GUTTER constant was removed with that fix.)

const SlotButton: React.FC<{
  slot: GlobalEffectSlotStatus;
  isOn: boolean;
  height: number;
  fontSize: number;
  // When set, the chip uses a fixed minWidth (portrait scroll strip) so a
  // full 2-line label fits; otherwise it flex:1's to share the bar width.
  minWidth?: number;
  onPress: () => void;
  onEdit: () => void;
}> = ({ slot, isOn, height, fontSize, minWidth, onPress, onEdit }) => {
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

  // flex:1 (share the bar) vs. fixed minWidth + flexGrow:0 (portrait scroll
  // strip — the chip must keep a width that fits its full label).
  const sizing = minWidth !== undefined
    ? { width: minWidth, minWidth, flexGrow: 0, flexShrink: 0 }
    : { flex: 1 };
  return (
    <View style={{ ...sizing, height, position: 'relative' }}>
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
          ellipsizeMode="tail"
          // QA round7: ellipsizeMode is "tail" (was "clip") so any residual
          // overflow is a clean trailing "…" at a word boundary — never a
          // mid-word chop like "Vint ag…". With the portrait scroll strip
          // giving each chip a real minWidth (~96px) the 2-word labels now
          // wrap to two full lines and don't overflow at all; "tail" is just
          // the safety net. The ⋯ edit chip lives in the BOTTOM-right corner
          // (out of the centred label's band), so the label no longer needs a
          // right-side gutter and keeps the full chip width.
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
          // QA round7: MOVED to the BOTTOM-right corner (was top-right, where
          // it overlapped the first line of the centred 2-line label). The
          // label is now vertically centred, so the bottom corner is clear of
          // its text band. Raised contrast (visible chip background + bolder
          // glyph colour) and a touch larger (16px) so the edit affordance is
          // legible, while staying small enough that it never steals label
          // width (no gutter reserved on the label any more).
          position: 'absolute', bottom: 1, right: 1,
          width: 16, height: 16, borderRadius: 8,
          backgroundColor: showOn ? 'rgba(255,255,255,0.28)' : C.surfaceContainerLowest,
          borderWidth: 1,
          borderColor: showOn ? 'transparent' : C.ghostBorder,
          alignItems: 'center', justifyContent: 'center',
        }}
      >
        <Text style={{
          fontFamily: 'SpaceGrotesk_700Bold',
          fontSize: 11,
          color: showOn ? '#FFF' : C.text,
          lineHeight: 11,
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

// Empty slot cell — single full-cell tap opens the swap sheet.
//
// QA round7 MAJOR: empty slots used `surfaceContainerLowest` (pure WHITE in
// the light theme) which made the UNBOUND placeholders the BRIGHTEST tiles in
// the strip — out-contrasting the real bound effects they're meant to sit
// behind. They are now RECESSED: filled with `surfaceDim` (a notch BELOW the
// bar background so the cell reads as a depression, not a raised chip), a
// subtle dashed ghost border, and a DIM centred "+" in the muted icon colour.
// Bound effect chips are now the clear visual foreground; an empty slot reads
// as an empty socket.
const EmptySlotButton: React.FC<{
  slotId: number;
  height: number;
  // Fixed minWidth for the portrait scroll strip (matches SlotButton);
  // flex:1 otherwise so the cell shares the bar width.
  minWidth?: number;
  onPress: () => void;
}> = ({ slotId, height, minWidth, onPress }) => {
  const C = usePalette();
  const sizing = minWidth !== undefined
    ? { width: minWidth, minWidth, flexGrow: 0, flexShrink: 0 }
    : { flex: 1 };
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={1}
      accessibilityLabel={`Add effect to slot ${slotId}`}
      style={{
        ...sizing, height, borderRadius: 6,
        backgroundColor: C.surfaceDim,
        borderWidth: 1,
        borderStyle: 'dashed',
        borderColor: C.ghostBorder,
        justifyContent: 'center', alignItems: 'center',
        ...(Platform.OS === 'web' ? { transitionDuration: '0s' as any } : {}),
      }}
    >
      <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 16, color: C.icon, lineHeight: 18, opacity: 0.7 }}>
        +
      </Text>
    </TouchableOpacity>
  );
};

const BlackoutButton: React.FC<{
  blackout: boolean;
  height: number;
  fontSize: number;
  // Fixed width (set on the strip variants) so the e-stop keeps a stable,
  // recognisable footprint and never shrinks below its slot neighbours.
  fixedWidth?: number;
  onPress: () => void;
}> = ({ blackout, height, fontSize, fixedWidth, onPress }) => {
  const C = usePalette();
  // QA round7 MAJOR: the OFF blackout cell was a flat ghost-bordered grey
  // surface — it BLENDED into the slot grid and was hard to find in a hurry.
  // The e-stop must be unmistakable at all times, so it now carries a
  // PERSISTENT 2px red outline even when OFF (red text on a faint red-tinted
  // surface), and a FULL red fill + white label when ON. The destructive
  // signal is the error-red outline that is ALWAYS present — distinct from
  // INVERT (non-destructive, tertiary accent) and from the slot chips (no red
  // anywhere). Label is ALL CAPS "BLACKOUT" so it reads as a hard control,
  // not a slot. Single-tap behaviour is unchanged (deliberate prior decision —
  // no confirm/hold gate).
  const isOn = !!blackout;
  const bg = isOn ? C.error : C.errorContainer;
  const fg = isOn ? '#FFF' : C.error;
  const sizing = fixedWidth !== undefined
    ? { width: fixedWidth, minWidth: fixedWidth, flexGrow: 0, flexShrink: 0 }
    : { flex: 1 };
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={1}
      style={{
        ...sizing, height, paddingHorizontal: 6, borderRadius: 6,
        backgroundColor: bg,
        // Persistent red outline in BOTH states. When ON the fill is solid
        // red so the border merges into it; when OFF the 2px error border is
        // what makes the e-stop pop out of the grid.
        borderWidth: 2,
        borderColor: C.error,
        justifyContent: 'center', alignItems: 'center',
        ...(Platform.OS === 'web' ? { transitionDuration: '0s' as any } : {}),
      }}
      accessibilityLabel={isOn ? 'Release blackout e-stop' : 'Engage blackout e-stop'}
    >
      <Text
        numberOfLines={1}
        ellipsizeMode="tail"
        // The e-stop label MUST stay fully legible. "BLACKOUT" fits on one
        // line at `fontSize` in the fixed-width cell; "tail" is a safety net
        // only (never expected to trigger).
        style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize, color: fg, letterSpacing: 0.5 }}
      >
        BLACKOUT
      </Text>
    </TouchableOpacity>
  );
};

// Global color INVERT toggle. Sibling of BlackoutButton, same size/style
// language (single-tap toggle, 1 px ghost border when OFF, filled accent
// when ON). Uses the palette's `tertiary` accent — a DISTINCT colour from
// blackout's e-stop `error` red AND from the hue knob's `primary` cyan — so
// the operator never confuses a colour-invert with the e-stop.
//   - OFF → flat ghost-bordered surface, tertiary-accent text
//   - ON  → filled tertiary cell, white text (unambiguous "inverted" state)
//
// Label casing (QA round1 #20): Title Case ("Invert") to match the slot-chip
// convention — the chip group is now ONE casing. Destructiveness/state is
// flagged by colour + bold weight (tertiary accent, error-red for blackout),
// NOT by SHOUTING CAPS.
const InvertButton: React.FC<{
  invert: boolean;
  height: number;
  fontSize: number;
  // Fixed width (set on the strip variants) so INVERT keeps a stable footprint
  // alongside the fixed-width BLACKOUT and never shrinks below its neighbours.
  fixedWidth?: number;
  onPress: () => void;
}> = ({ invert, height, fontSize, fixedWidth, onPress }) => {
  const C = usePalette();
  const isOn = !!invert;
  const bg = isOn ? C.tertiary : C.surfaceContainerHigh;
  const fg = isOn ? '#FFF' : C.tertiary;
  const sizing = fixedWidth !== undefined
    ? { width: fixedWidth, minWidth: fixedWidth, flexGrow: 0, flexShrink: 0 }
    : { flex: 1 };
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={1}
      style={{
        ...sizing, height, paddingHorizontal: 6, borderRadius: 6,
        backgroundColor: bg,
        borderWidth: 1,
        borderColor: isOn ? 'transparent' : C.ghostBorder,
        justifyContent: 'center', alignItems: 'center',
        ...(Platform.OS === 'web' ? { transitionDuration: '0s' as any } : {}),
      }}
      accessibilityLabel={isOn ? 'Disable global color invert' : 'Enable global color invert'}
    >
      <Text
        numberOfLines={1}
        ellipsizeMode="tail"
        // "Invert" fits on one line at `fontSize` in every chip width; "tail"
        // is a safety net only. Title Case keeps INVERT visually distinct from
        // the ALL-CAPS destructive BLACKOUT e-stop (QA round7).
        style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize, color: fg, letterSpacing: 0.5 }}
      >
        Invert
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

