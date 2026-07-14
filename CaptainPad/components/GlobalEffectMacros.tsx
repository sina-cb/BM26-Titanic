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
import { shadow } from '@/styles/globalStyles';
import { notifyEffectsPanelLoaded } from '@/hooks/useMidiControl';
import {
  fetchGlobalEffectSlots,
  fetchGlobalEffectSlotsStatus,
  fetchGlobalEffectLibrary,
  dispatchGlobalEffectSlotAction,
  patchGlobalEffectSlot,
  setGlobalEffectBlackout,
  setGlobalEffectSlotIntensity,
  resetGlobalEffectSlotIntensity,
  cycleGlobalEffectSlotMode,
  setGlobalEffectSlotMode,
  fetchEffectsPage,
  setEffectsPage,
  GlobalEffectSlot,
  GlobalEffectSlotStatus,
} from '@/utils/api';
import { engineEvents } from '@/utils/engineEvents';
import { usePerfLock, usePerformanceMode } from '@/hooks/usePerformanceMode';
import {
  VISIBLE_SLOT_COUNT,
  EFFECTS_PAGE_COUNT,
  SHOW_EFFECT_PAGES,
  resolveEffectsPage,
  resolveEffectsPresentation,
  deployBannerMessage,
  modeBadge,
  slotIsBound,
  computeVisibleSlots,
  computePageActivity,
  ModeBadge as ModeBadgeInfo,
} from './global_effect_macros_logic';
import {
  buildPickerSections,
  isFavoritePreset,
  slotDisablesEncoder,
  resolveSlotEffectName,
  PickerLibrary,
} from './effect_picker_logic';
// (HorizontalFader import removed 2026-07 with the global hue fader row.)

// Hard UI contract (operator review May 2026): the rig surface shows
// EXACTLY this many slots. The engine can persist up to MAX_SLOTS (16)
// — anything beyond this is hidden from the strip. The operator
// re-binds the visible slots via long-press swap; the engine's library
// still contains every preset so swapping in vintageWhite, fogger,
// blastWhite, etc. is one tap of the SWAP modal.
// 8 slots (global-effects parity campaign, 2026-07): the engine supports
// up to MAX_SLOTS=16 and ships 13 default bindings. The visible strip is
// pinned to 8 so it maps 1:1 onto the APC mini mk2's 8 Scene Launch buttons
// (the physical column of 8), which the MIDI profile binds TOP→BOTTOM to
// UI slots LEFT→RIGHT (slot 1 = topmost button = left-most chip). Invert
// still ships in an assignable slot (default slot 9 engine-side) but no
// longer has a dedicated visible chip — swap it into any of the 8 visible
// slots via the ⋯ SWAP modal. Every visible slot is re-bindable. Shared by
// BOTH the deck and mixer bottom bars (same GlobalEffectMacros instance).
// Effects v2 (Sina 2026-07-08): the engine scales to 4 pages × 8 = 32 flat slots
// (ids 1..32); the strip shows 8 at a time (the ACTIVE PAGE). The slot geometry
// (VISIBLE_SLOT_COUNT / EFFECTS_PAGE_COUNT / slotIdForPage) and the bound/empty
// derivations (slotIsBound / computeVisibleSlots / computePageActivity) live in
// ./global_effect_macros_logic so they're unit-testable without react-native.
// The active page lives in ENGINE state (GET/PATCH /global-effects/page,
// WS-broadcast) — this component FOLLOWS the broadcast and writes changes
// THROUGH the engine, never keeping a private page (so the VSN1 side buttons +
// any other surface stay in lockstep).

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
  // The effects grid presentation is INVARIANT across the VSN1 controller profile
  // (operator: the CaptainPad effects UI must ALWAYS look and behave the same
  // regardless of profile). The profile is a VSN1 device-surface concept only —
  // it swaps the physical device's template set (via sb_2) but never touches this
  // grid, which always renders the full authoring UI. resolveEffectsPresentation
  // returns those constants; kept as a call for a stable shape + pinned tests.
  const presentation = resolveEffectsPresentation();
  // Performance mode (live-show structural lock) dims the ⋯ swap / "+" bind
  // affordances and drives the LOCKED mode badge. Read live so the badge clears
  // the moment performance mode is exited. This is SEPARATE from the profile.
  const performanceActive = usePerformanceMode().active;
  // VSN1 layout auto-deploy error banner (dismissible). The engine broadcasts
  // `vsn1LayoutDeploy` around every device re-flash; deployBannerMessage folds the
  // stream into an error string (a failed flash — e.g. the LCD budget overflow) or
  // clears it on a later `ok`. Pre-2026-07 CaptainPad ignored deploy errors, so a
  // silently-failed flash was invisible; this surfaces it.
  const [deployError, setDeployError] = useState<string | null>(null);
  // Effects v2: the active effects page (0..3). Mirrors ENGINE state — seeded
  // from GET /global-effects/page, followed via the `effectsPage` WS broadcast,
  // and changed ONLY by PATCHing the engine (never a private optimistic page).
  const [page, setPage] = useState(0);
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

  // The GLOBAL hue shifter that used to live at the top of this surface was
  // REMOVED end to end (2026-07, operator decision: "only the channel hue
  // shifts, no global hidden one"). Hue is PER-CHANNEL ONLY now — the deck's
  // DeckHueRow and each mixer strip's HUE trim are the hue controls.

  // Global color INVERT (docs/39 §F-invert) is no longer a dedicated control
  // here — it became an assignable slot effect (default slot 9) in the
  // channels-optimization campaign (2026-06-29) and rides the standard slot
  // dispatch + status path. No local invert state is needed in this component.

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
  // party 2026-07-11 single-page layout: `renderPage` is the page the GRID
  // actually shows. With SHOW_EFFECT_PAGES=false it is pinned to 0 even when the
  // engine broadcasts a non-zero `effectsPage` (VSN1 side buttons no longer page
  // — see resolveEffectsPage). The `page` state + all its plumbing (fetch/WS/
  // PATCH) stays live; only the RENDER page and the pager chrome are suppressed.
  const renderPage = resolveEffectsPage(page);
  const visibleSlots = useMemo(() => {
    if (!slots) return null;
    // The 8 cells show the ACTIVE PAGE's flat slot ids (8*page+1 .. 8*page+8).
    // A cleared slot (enabled:false, stale effectId kept by the engine) renders
    // EMPTY via slotIsBound — the "can't remove an effect" fix.
    return computeVisibleSlots<GlobalEffectSlotStatus>(
      slots,
      renderPage,
      (slotId) => ({ ...EMPTY_STENCIL, slotId } as unknown as GlobalEffectSlotStatus),
    );
  }, [slots, renderPage]);

  // party 2026-07-11 single-page guard (Codex P0: fail loud, but don't spam).
  // If the pager UI is hidden yet the engine reports a page other than 0 — a
  // stale persisted effectsPage, or a surface that still pages — we render page
  // 0 anyway (renderPage above) and warn ONCE so the discrepancy is visible in
  // the console without flooding it on every status broadcast.
  const warnedHiddenPageRef = useRef(false);
  useEffect(() => {
    if (!SHOW_EFFECT_PAGES && page !== 0 && !warnedHiddenPageRef.current) {
      warnedHiddenPageRef.current = true;
      console.warn(
        `[GEM] effects pages are hidden (party single-page layout) but the engine `
        + `reports page ${page}; rendering page 1 (index 0). Flip SHOW_EFFECT_PAGES `
        + `to restore the pager.`,
      );
    }
  }, [page]);

  // Per-page "something is running" flags for the page switcher's activity
  // dots — pure presentation derived from the SAME engine status array that
  // paints the chips (no extra fetch, no new state). Lets the operator see at
  // a glance that e.g. P3 has a live effect without leaving the current page.
  const pageActivity = useMemo(
    () => computePageActivity(slots ?? []),
    [slots],
  );

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
    // Effects v2 WELCOME: the effects panel just loaded — send the VSN1 a hello
    // + full feedback re-sync (task: hello on effects load). No-op when no VSN1
    // is connected; the reconnect path carries the hello otherwise.
    notifyEffectsPanelLoaded();
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
      // (The /globals hue seed + persisted-spin clear were removed 2026-07
      // with the global hue shifter — hue is per-channel only now.)
      // Effects v2: seed the active page from ENGINE state (single source of
      // truth). The WS `effectsPage` broadcast below keeps it live thereafter.
      fetchEffectsPage().then((r) => {
        if (alive && r.ok && typeof r.data?.effectsPage === 'number') setPage(r.data.effectsPage);
      });
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
      } else if (msg?.type === 'effectsPage' && typeof msg.effectsPage === 'number') {
        // Follow the engine's page broadcast (canonical key `effectsPage`) — a page
        // change from ANY source (this switcher, a VSN1 side button, another surface)
        // converges here.
        setPage(msg.effectsPage);
      } else if (msg?.type === 'vsn1LayoutDeploy') {
        // VSN1 layout auto-deploy result → surface (or clear) the error banner.
        // deployBannerMessage returns `undefined` for in-flight/irrelevant frames
        // (no change), `null` on a successful `ok` (clear), or the error string.
        const next = deployBannerMessage(msg);
        if (next !== undefined) setDeployError(next);
      }
      // (The `globalHueShift` WS reconcile was removed 2026-07 with the
      // global hue shifter.)
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

  // "Lost strobe" guard (Codex P0: fail loud). Warn ONCE per unknown id when a
  // BOUND slot references an effectId the engine library doesn't ship — a
  // renamed/removed effect must announce itself instead of silently
  // misbehaving. The chip still renders its own label (generic card); this is
  // just the alarm. resolveSlotEffectName emits the console.warn; the ref
  // dedupes so it fires once, not every status broadcast.
  const warnedUnknownRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!library || !slots) return;
    for (const s of slots) {
      if (!slotIsBound(s)) continue;
      const id = s.effectId;
      if (id && !library[id] && !warnedUnknownRef.current.has(id)) {
        warnedUnknownRef.current.add(id);
        resolveSlotEffectName(s, library as PickerLibrary);
      }
    }
  }, [library, slots]);

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

  // Page switch: write THROUGH the engine (PATCH /global-effects/page). The
  // engine's `effectsPage` broadcast flips our `page` state, so every surface —
  // this switcher, the VSN1 side buttons, any other client — converges. We
  // deliberately do NOT optimistically set `page` locally: the engine is the
  // single source of truth, so a rejected PATCH leaves the UI truthful. To keep
  // the tap feeling instant despite the round-trip, we set `page` immediately
  // AND write; if the PATCH fails we roll back to the engine-confirmed page.
  const onSelectPage = useCallback(async (next: number) => {
    if (next === page) return;
    const prev = page;
    setPage(next); // optimistic — reconciled by the broadcast (or rolled back)
    const r = await setEffectsPage(next);
    if (!r.ok) {
      console.warn(`[GEM] set effects page ${next} failed:`, r.error);
      setPage(prev);
      setError(r.error || 'Failed to change effects page');
    }
  }, [page]);

  // Slot intensity edit (UI): write the slot's value (0..1) to the engine. The
  // status broadcast reconciles the rendered value.
  const onSetIntensity = useCallback(async (slotId: number, value: number) => {
    const r = await setGlobalEffectSlotIntensity(slotId, value);
    if (!r.ok) console.warn(`[GEM] set slot ${slotId} intensity failed:`, r.error);
  }, []);

  // Slot intensity RESET (UI): the VSN1 encoder press is now mode-cycle, so the
  // intensity reset lives here (Effects v2 decision — documented in vsn1.yaml).
  const onResetIntensity = useCallback(async (slotId: number) => {
    const r = await resetGlobalEffectSlotIntensity(slotId);
    if (!r.ok) console.warn(`[GEM] reset slot ${slotId} intensity failed:`, r.error);
  }, []);

  // Slot mode edit (UI): cycle to the next mode value (same op the VSN1 encoder
  // press fires) or set an explicit value from the mode chip's picker.
  const onCycleMode = useCallback(async (slotId: number) => {
    const r = await cycleGlobalEffectSlotMode(slotId);
    if (!r.ok) console.warn(`[GEM] cycle slot ${slotId} mode failed:`, r.error);
  }, []);
  const onSetMode = useCallback(async (slotId: number, value: string | number | boolean) => {
    const r = await setGlobalEffectSlotMode(slotId, value);
    if (!r.ok) console.warn(`[GEM] set slot ${slotId} mode failed:`, r.error);
  }, []);

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
    if (!slotIsBound(slot)) return;   // empty/disabled slot — nothing to deactivate
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
  // Strip landscape grew 44→48 (2026-07 visual polish): the value/mode badge
  // gained 2px of height for legibility, and the chip needs the extra room so
  // a centred label clears it (see SlotButton's conditional paddingTop).
  // The chip height is the tuned base height (presentation.cellHeightScale is a
  // constant 1 now — the profile never grows the cells; the scale hook is kept
  // only so the geometry has a single documented multiplier point).
  const baseBtnHeight = isStrip
    ? (isPortrait ? 60 : 48)
    : (isPortrait ? 52 : 48);
  const btnHeight = Math.round(baseBtnHeight * presentation.cellHeightScale);
  // Deck portrait left-pane is the tightest 3-up width, so it drops to 9px to
  // guarantee a 7-char word ("Vintage", "Iceberg") fits a wrapped line clear of
  // the ⋯ gutter. The mixer strip (now 4-up wrapped) keeps 10px.
  // Landscape strip chips are ~150 px wide — plenty of room for a 12 px
  // label, and the extra point matters for arm's-length legibility at the
  // podium. The tight portrait sizes are unchanged (they were fitted to the
  // narrowest pane in QA round3/7).
  const btnFont   = isStrip
    ? (isPortrait ? 10 : 12)
    : (isPortrait ? 9 : 11);
  const gap       = 6;
  // Uniform deck grid columns. Landscape fits 4-up comfortably; the narrow
  // portrait left-pane needs 3-up so each chip is wide enough for its full
  // wrapped label (QA round3: 4-up portrait chips were ~90px and truncated).
  const deckCols  = isPortrait ? 3 : 4;

  // MODE BADGE — the passive LOCKED pill shown while performance mode is active
  // (it explains why the ⋯ swap / ＋ bind affordances are inert during a show).
  // Unlocked → no badge (the grid looks exactly as always). The controller
  // profile is NOT an input — it never changes this grid. Derived purely so the
  // state (locked vs no-badge) is unit-tested.
  const badge = modeBadge(performanceActive);
  const modeBadgeEl = badge ? (
    <ModeBadge key="mode-badge" badge={badge} />
  ) : null;

  // While we wait for the first /global-effect-slots response render
  // a thin skeleton row (matches final layout so the deck doesn't
  // visually jump). If both fetches fail, surface the error.
  if (visibleSlots === null) {
    return (
      <View style={{ paddingTop: 8 }}>
        {/* Strip: header line removed (label rides in-row once loaded). */}
        {isStrip ? null : <Header variant={variant} page={renderPage} badge={modeBadgeEl} />}
        {/* party 2026-07-11 — pager chrome hidden (single-page layout). */}
        {SHOW_EFFECT_PAGES ? (
          <PageSwitcher page={page} onSelect={onSelectPage} pageActivity={pageActivity} />
        ) : null}
        <View style={{ flexDirection: 'row', gap }}>
          {Array.from({ length: VISIBLE_SLOT_COUNT }).map((_, i) => (
            <View key={i} style={{ flex: 1, height: btnHeight, borderRadius: 8, backgroundColor: C.surfaceContainerHigh, borderWidth: 1, borderColor: C.ghostBorder }} />
          ))}
        </View>
        {error ? (
          <Text style={{ color: C.error, fontSize: 11, marginTop: 6 }}>{error}</Text>
        ) : null}
      </View>
    );
  }

  return (
    // In the strip variant the host bottom bar already draws the top rule —
    // GEM adding its own produced a doubled hairline mid-bar, so the inner
    // border only ships with the standalone deck grid.
    <View style={{ paddingTop: 6, borderTopWidth: isStrip ? 0 : 1, borderTopColor: C.ghostBorder, flex: isStrip ? 1 : undefined }}>
      {/* party 2026-07-11 — in the STRIP the header line is gone: the label
          rides IN the chip row (StripLabel below) to save a full line of
          vertical space in the bottom bar. The deck grid keeps its header. */}
      {isStrip ? null : <Header variant={variant} page={renderPage} badge={modeBadgeEl} />}
      {/* party 2026-07-11 — the 4-page switcher is HIDDEN (single-page layout;
          VSN1 side buttons no longer page). Flip SHOW_EFFECT_PAGES to restore. */}
      {SHOW_EFFECT_PAGES ? (
        <PageSwitcher page={page} onSelect={onSelectPage} pageActivity={pageActivity} />
      ) : null}
      {/* (The global hue shifter row that used to sit here was REMOVED
          2026-07 — hue is per-channel only: the deck's DeckHueRow and each
          mixer strip's HUE trim are the hue controls.) */}
      {error ? (
        <Text style={{ color: C.error, fontSize: 11, marginBottom: 4 }}>{error}</Text>
      ) : null}
      {/* VSN1 layout deploy FAILED — visible + dismissible (a silently failed
          flash used to be invisible). A later successful deploy clears it. */}
      {deployError ? (
        <DeployErrorBanner message={deployError} onDismiss={() => setDeployError(null)} />
      ) : null}
      {/* (The old `!isStrip`-gated "PLAY profile active" hint was REMOVED here:
          BOTH deck and mixer render the STRIP variant, so it never showed and
          PLAY was indistinguishable from a broken UI. The always-visible
          <ModeBadge> in the header/strip label supersedes it — it shows in
          BOTH variants and, in PLAY, is the tappable escape hatch to EDIT.) */}
      {(() => {
        // `minWidth` (set only for the portrait scroll strip) switches a
        // chip from flex:1 (share the bar width) to a fixed minWidth so it
        // can render a full 2-line label instead of being squeezed to a
        // mid-word-chopping ~70px (QA round7 BLOCKER).
        const renderCell = (slot: GlobalEffectSlotStatus, minWidth?: number) => {
          const slotId = slot.slotId as number;
          const isEmpty = !slotIsBound(slot);
          if (isEmpty) {
            // Empty slot → the tappable "+" socket that opens the swap sheet.
            // Always present (the authoring UI is invariant across profiles);
            // performance mode dims/disables it inside EmptySlotButton.
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
              onSetIntensity={(v) => onSetIntensity(slotId, v)}
              onResetIntensity={() => onResetIntensity(slotId)}
              onCycleMode={() => onCycleMode(slotId)}
              onSetMode={(v) => onSetMode(slotId, v)}
            />
          );
        };

        if (isStrip) {
          // The 8 slot chips. In LANDSCAPE they flex:1 to fill the bar
          // (plenty of width per chip — labels already fit, QA round7).
          // In PORTRAIT the bar is far too narrow for that many cells: at
          // flex:1 every chip squeezed to ~70px and the 2-word labels chopped
          // mid-word ("Vint ag…", "Ghos t …" — QA round7 BLOCKER). So in
          // portrait we drop the flex, give each chip a real minWidth
          // (~96px), and let ONLY THE SLOTS scroll horizontally — the
          // operator swipes to reach the trailing slots. BLACKOUT is pinned
          // OUTSIDE the scroller (QA round10 BLOCKER) so the e-stop never
          // scrolls off-screen. Invert is NO LONGER a dedicated button — it
          // is now an assignable slot (default slot 9), so it scrolls with
          // the other chips (invert is no longer a fixed chip — swap it into
          // any of the 8 slots via the ⋯ modal). The minWidth (96px) gives a 2-line label
          // ("Vintage\nWhite", "Iceberg\nFlash") room to render full.
          const SLOT_MIN_WIDTH = 96;
          const slotChips = visibleSlots.map((slot) =>
            renderCell(slot, isPortrait ? SLOT_MIN_WIDTH : undefined),
          );
          // party 2026-07-11 — the "Global Effects" label moved INTO the chip
          // row (two-line, narrow) so the strip drops its whole header line:
          // the bottom bar gets that vertical space back for the chips.
          const stripLabel = (
            <Text
              key="strip-label"
              style={{
                fontFamily: 'SpaceGrotesk_700Bold', fontSize: 9,
                color: C.secondary, letterSpacing: 1.1,
                textTransform: 'uppercase', lineHeight: 12,
                marginRight: 8, alignSelf: 'center',
              }}
            >
              {'Global\nEffects'}
            </Text>
          );
          // Blackout gets a FIXED width so it never shrinks — the e-stop
          // must keep a stable, recognisable footprint regardless of
          // orientation or how many slots are bound.
          const blackoutCell = (
            <BlackoutButton key="blackout" blackout={blackout} height={btnHeight} fontSize={btnFont} onPress={onPressBlackout} fixedWidth={isPortrait ? 96 : 112} />
          );
          // A small divider/gap separates the destructive BLACKOUT e-stop
          // from the slot chips so it never reads as "just another slot"
          // (QA round7 MAJOR).
          const Divider = (
            <View key="divider" style={{ width: 1, alignSelf: 'stretch', marginHorizontal: 6, backgroundColor: C.ghostBorder }} />
          );

          if (isPortrait) {
            // QA round10 BLOCKER: the whole strip used to be one horizontal
            // ScrollView, so BLACKOUT (the e-stop) scrolled OFF the right
            // edge with no discoverable cue — a clipped e-stop is a live-show
            // safety problem. Restructure: the row is a flex container where
            // ONLY the slot chips live inside a flex:1 horizontal ScrollView,
            // and divider + BLACKOUT are a FIXED trailing group pinned at the
            // right edge OUTSIDE the ScrollView. The operator scrolls to reach
            // the trailing slots, but the destructive e-stop is ALWAYS
            // on-screen.
            return (
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                {stripLabel}
                {modeBadgeEl}
                {/* Slots-only scroller. A right-edge fade peek hints there's
                    more to scroll (the chips run under the pinned group). */}
                <View style={{ flex: 1, minWidth: 0, position: 'relative' }}>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator
                    contentContainerStyle={{ flexDirection: 'row', alignItems: 'center', gap, paddingRight: 14 }}
                  >
                    {slotChips}
                  </ScrollView>
                  {/* Subtle right-edge fade so the scroll is discoverable. */}
                  <View
                    pointerEvents="none"
                    style={{
                      position: 'absolute', right: 0, top: 0, bottom: 0, width: 16,
                      backgroundColor: C.surfaceContainerHigh, opacity: 0.55,
                      borderTopRightRadius: 8, borderBottomRightRadius: 8,
                    }}
                  />
                </View>
                {/* Fixed trailing group — never scrolls. */}
                <View style={{ flexDirection: 'row', alignItems: 'center', marginLeft: gap }}>
                  {Divider}
                  {blackoutCell}
                </View>
              </View>
            );
          }
          // Landscape: ONE flat flex row, no scroll — the bar is wide enough.
          return (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap }}>
              {stripLabel}
              {modeBadgeEl}
              {slotChips}
              {Divider}
              {blackoutCell}
            </View>
          );
        }
        // Deck: one UNIFORM grid of every control (slots + BLACKOUT) chunked
        // into rows of `deckCols`. Every row carries exactly deckCols cells
        // (the last row is padded with invisible spacers) so chip widths are
        // identical across rows — fixing the old 3-up/5-up squeeze that
        // truncated the bottom-row labels (QA round1 #1). BLACKOUT is the
        // last cell so the destructive e-stop stays bottom-right. Invert is
        // no longer a dedicated cell — it is an assignable slot effect and
        // renders as one of the 8 slot chips above whenever the operator
        // swaps it in.
        const cells: React.ReactNode[] = [
          // NB: wrap in an arrow so Array.map's index arg is never passed as
          // `minWidth` — the deck grid wants flex:1 cells (minWidth undefined).
          ...visibleSlots.map((slot) => renderCell(slot)),
          <BlackoutButton key="blackout" blackout={blackout} height={btnHeight} fontSize={btnFont} onPress={onPressBlackout} />,
        ];
        const rows: React.ReactNode[][] = [];
        for (let i = 0; i < cells.length; i += deckCols) {
          rows.push(cells.slice(i, i + deckCols));
        }
        return rows.map((row, ri) => (
          <View key={ri} style={{ flexDirection: 'row', gap, marginBottom: 6 }}>
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

// (HueShiftSection — the global hue fader row — was REMOVED 2026-07 with the
// global hue shifter. Hue is per-channel only: see components/deck_hue_row.tsx
// and the mixer strip's HUE trim.)

// Effects v2 page switcher: four segmented buttons (P1..P4) selecting the
// engine's active effects page. The active page is highlighted; a tap writes
// THROUGH the engine (onSelect → PATCH), and the `effectsPage` WS broadcast
// flips the highlight so this switcher, the VSN1 side buttons, and every other
// surface stay in lockstep.
// Restyled as ONE recessed segmented control (2026-07 visual polish): the four
// loose ghost-bordered slabs became joined segments in a surfaceDim track —
// the same recessed-vs-raised language the empty slot sockets use, so "where
// you can go" (track) reads distinctly from "what you can fire" (chips).
// The active segment is a solid primary fill with `onPrimary` text — the old
// hardcoded '#FFF' washed out on the bright cyan/amber primaries of the dark
// themes. `pageActivity[p]` draws a small tertiary ("running" green) dot so a
// live effect on another page stays visible at a glance.
const PageSwitcher: React.FC<{
  page: number;
  onSelect: (p: number) => void;
  pageActivity?: boolean[];
}> = ({ page, onSelect, pageActivity }) => {
  const C = usePalette();
  return (
    <View
      style={{
        flexDirection: 'row', gap: 2, marginBottom: 6, padding: 2,
        borderRadius: 8, backgroundColor: C.surfaceDim,
        borderWidth: 1, borderColor: C.ghostBorder,
      }}
      accessibilityRole="tablist"
    >
      {Array.from({ length: EFFECTS_PAGE_COUNT }).map((_, p) => {
        const active = p === page;
        const hasLive = !!pageActivity?.[p];
        return (
          <TouchableOpacity
            key={p}
            onPress={() => onSelect(p)}
            activeOpacity={0.8}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={`Effects page ${p + 1}`}
            style={{
              flex: 1, height: 22, borderRadius: 6,
              backgroundColor: active ? C.primary : 'transparent',
              flexDirection: 'row', gap: 5,
              alignItems: 'center', justifyContent: 'center',
              ...(Platform.OS === 'web' ? { transitionDuration: '0s' as any } : {}),
            }}
          >
            {hasLive ? (
              <View style={{
                width: 5, height: 5, borderRadius: 3,
                backgroundColor: active ? C.onPrimary : C.tertiary,
              }} />
            ) : null}
            <Text style={{
              fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10,
              color: active ? C.onPrimary : C.secondary, letterSpacing: 0.8,
            }}>
              P{p + 1}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
};

// Top band: the "Global Effects" title + the CURRENT effects page index badge
// (P0-P3, Sina 2026-07-11). The badge shows the ENGINE's active page (0-based, the
// same index the VSN1 reports on its LCD) right next to the page switcher below,
// so the operator always sees which page the 8 visible slots belong to — the
// switcher's highlight tells you what you can select, this badge names where you
// ARE. 0-based on purpose: it matches the engine `effectsPage` value and the VSN1
// side-button/LCD numbering (the switcher buttons stay 1-based P1-P4 for humans).
// (2026-07 visual polish: the title now renders at 10px in BOTH variants —
// the 9px strip size was below the app's smallest legible caption step —
// so `variant` stays in the prop contract but is not consumed here.)
const Header: React.FC<{ variant: 'deck' | 'mixer-strip'; page: number; badge?: React.ReactNode }> = ({ page, badge }) => {
  const C = usePalette();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 }}>
        <Text style={{
          fontFamily: 'SpaceGrotesk_700Bold',
          fontSize: 10,
          color: C.secondary, letterSpacing: 1.2,
          textTransform: 'uppercase',
        }}>
          Global Effects
        </Text>
        {/* Always-visible mode badge (PLAY escape hatch / LOCKED status) rides
            next to the label — the non-strip twin of the strip's in-row badge. */}
        {badge}
      </View>
      {/* party 2026-07-11 — the "PAGE Pn" badge rides with the pager: hidden in
          the single-page layout (SHOW_EFFECT_PAGES=false) since there is only
          ever page 0. Flip SHOW_EFFECT_PAGES to restore it alongside the
          switcher. */}
      {SHOW_EFFECT_PAGES ? (
        <View
          accessibilityLabel={`Effects page ${page}`}
          style={{
            paddingHorizontal: 8, height: 18, borderRadius: 9,
            backgroundColor: C.surfaceContainerHigh, borderWidth: 1, borderColor: C.ghostBorder,
            alignItems: 'center', justifyContent: 'center',
          }}
        >
          <Text style={{
            fontFamily: 'SpaceGrotesk_700Bold', fontSize: 9,
            color: C.primary, letterSpacing: 0.8,
          }}>
            {`PAGE P${page}`}
          </Text>
        </View>
      ) : null}
    </View>
  );
};

// MODE BADGE — the passive LOCKED indicator that rides next to the "GLOBAL
// EFFECTS" label (deck Header) and the strip label (both variants).
//
//   - LOCKED → a passive RED status pill "LOCKED — performance mode" (palette
//     error tokens) explaining why the ⋯ swap / ＋ bind affordances are inert
//     while a show is live.
//
// (The old PLAY variant + on-screen escape hatch was removed with the profile
// UI-degradation: the grid no longer changes with the controller profile, so
// there is nothing to warn about or escape from.) The kind/copy decision is the
// pure `modeBadge()` derivation; this component only paints it.
const ModeBadge: React.FC<{ badge: ModeBadgeInfo }> = ({ badge }) => {
  const C = usePalette();
  return (
    <View
      accessibilityRole="alert"
      accessibilityLabel={badge.label}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'center',
        paddingHorizontal: 8, height: 18, borderRadius: 9,
        backgroundColor: C.errorContainer, borderWidth: 1, borderColor: C.error,
        ...(Platform.OS === 'web' ? { transitionDuration: '0s' as any } : {}),
      }}
    >
      <Text
        numberOfLines={1}
        style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 9, color: C.error, letterSpacing: 0.6 }}
      >
        {badge.label}
      </Text>
    </View>
  );
};

// Bound slot cell. The cell body is the tap target; the tiny edit
// pencil in the top-right corner opens the swap sheet. We deliberately
// dropped long-press-to-swap (operator review May 2026) — it was
// unreliable on web (no native long-press contract) and ambiguous on
// touch (gesture races with simple taps).
//
// Visual contract:
//   - toggle/hold ON  → primary fill, `onPrimary` text (theme-safe pairing)
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

// Effects v2: format a slot's discrete mode value for the inline chip. A boolean
// shows ON/OFF; a string/number shows as-is; absent → a dim '—'.
function formatMode(mode: string | number | boolean | null | undefined): string {
  if (mode === undefined || mode === null) return '—';
  if (typeof mode === 'boolean') return mode ? 'ON' : 'OFF';
  return String(mode);
}

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
  // Effects v2 value/mode edit callbacks.
  onSetIntensity: (value: number) => void;
  onResetIntensity: () => void;
  onCycleMode: () => void;
  onSetMode: (value: string | number | boolean) => void;
}> = ({ slot, isOn, height, fontSize, minWidth, onPress, onEdit, onSetIntensity, onResetIntensity, onCycleMode, onSetMode }) => {
  const C = usePalette();
  // PERFORMANCE MODE: rebinding/clearing a slot (the ⋯ swap sheet →
  // PATCH /global-effect-slots/:id) is a LAYOUT edit, 409-gated while a show
  // is live. Firing the effect (cell body), intensity and mode stay live —
  // those are runtime routes the engine deliberately allows.
  const perfLocked = usePerfLock();
  const isMomentary = slot.behavior === 'trigger' || slot.behavior === 'burst';
  // Favorite (⭐) marker — the operator's party picks (effect_picker_logic).
  const isFav = isFavoritePreset(slot.effectId, slot.presetId);
  const [ackAt, setAckAt] = useState<number | null>(null);
  // Effects v2: the value/mode detail sheet (precise intensity slider + mode
  // picker + reset) opens from the small "value" affordance on the chip.
  const [detailOpen, setDetailOpen] = useState(false);
  const hasIntensity = typeof slot.intensity === 'number';
  const hasMode = slot.mode !== undefined && slot.mode !== null;
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
  // `onPrimary`, not '#FFF': the dark themes use BRIGHT primaries (cyan,
  // amber) where white text washes out — onPrimary is each palette's
  // guaranteed-contrast pairing (2026-07 visual polish).
  const fg = showOn ? C.onPrimary : C.text;

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
          flex: 1, paddingHorizontal: 6, borderRadius: 8,
          backgroundColor: bg,
          borderWidth: 1,
          borderColor: showOn ? 'transparent' : C.ghostBorder,
          justifyContent: 'center', alignItems: 'center',
          // Two-band chip layout (2026-07 visual polish): the TOP band is
          // reserved for meta — value/mode badge (left) and the ⋯ edit
          // affordance (right) — and the label owns the band below it.
          // Uniform on every chip so labels sit on one shared baseline
          // across the strip instead of jumping per-chip with badge
          // presence.
          paddingTop: 14,
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
      {/* ⋯ swap/edit affordance — ALWAYS present (the authoring UI is invariant
          across controller profiles). Performance mode dims + disables it. */}
      <TouchableOpacity
        onPress={onEdit}
        disabled={perfLocked}
        activeOpacity={0.6}
        hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
        accessibilityLabel={`Edit slot ${slot.slotId}`}
        accessibilityState={{ disabled: perfLocked }}
        style={{
          opacity: perfLocked ? 0.45 : 1,
          // 2026-07 visual polish: back to the TOP-right corner — the chip
          // now reserves its whole top band for meta (paddingTop on the
          // body pushes the label below), so the corner is guaranteed clear
          // of the text. Pairs with the value/mode badge in the top-LEFT for
          // a symmetric meta row. (QA round7 had moved it to the bottom
          // corner because the label was vertically centred back then and
          // collided — that constraint no longer exists.)
          position: 'absolute', top: 4, right: 4,
          width: 18, height: 18, borderRadius: 9,
          backgroundColor: showOn ? 'rgba(255,255,255,0.28)' : C.surfaceContainerLowest,
          borderWidth: 1,
          borderColor: showOn ? 'transparent' : C.ghostBorder,
          alignItems: 'center', justifyContent: 'center',
        }}
      >
        <Text style={{
          fontFamily: 'SpaceGrotesk_700Bold',
          fontSize: 12,
          color: showOn ? C.onPrimary : C.text,
          lineHeight: 12,
        }}>⋯</Text>
      </TouchableOpacity>

      {/* Favorite (⭐) marker — bottom-right corner (mirror of the ⋯ edit chip),
          out of the centred label band. Rendered only for the operator's party
          picks so a starred effect is recognisable at a glance on the strip. */}
      {isFav ? (
        <View
          pointerEvents="none"
          accessibilityLabel={`Favorite slot ${slot.slotId}`}
          style={{ position: 'absolute', bottom: 3, right: 5 }}
        >
          <Text style={{ fontSize: 10, lineHeight: 12 }}>⭐</Text>
        </View>
      ) : null}

      {/* Effects v2: value + mode badge (top-left). Shows the slot's intensity %
          and current mode at a glance; tapping opens the detail sheet where the
          operator edits BOTH (a precise intensity slider + reset, and a mode
          cycle/picker). Only rendered when the engine threads intensity/mode —
          a pre-field slot shows nothing here rather than a fabricated 0. Always
          present (invariant across controller profiles). */}
      {(hasIntensity || hasMode) ? (
        <TouchableOpacity
          onPress={() => setDetailOpen(true)}
          activeOpacity={0.6}
          hitSlop={{ top: 6, right: 6, bottom: 6, left: 6 }}
          accessibilityLabel={`Edit slot ${slot.slotId} value and mode`}
          style={{
            position: 'absolute', top: 4, left: 4,
            flexDirection: 'row', alignItems: 'center', gap: 4,
            paddingHorizontal: 5, height: 16, borderRadius: 8,
            backgroundColor: showOn ? 'rgba(255,255,255,0.22)' : C.surfaceContainerLowest,
            borderWidth: 1, borderColor: showOn ? 'transparent' : C.ghostBorder,
          }}
        >
          {hasIntensity ? (
            <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 9, color: showOn ? C.onPrimary : C.secondary, lineHeight: 11 }}>
              {Math.round((slot.intensity as number) * 100)}%
            </Text>
          ) : null}
          {hasMode ? (
            <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 9, color: showOn ? C.onPrimary : C.icon, lineHeight: 11 }}>
              {formatMode(slot.mode)}
            </Text>
          ) : null}
        </TouchableOpacity>
      ) : null}

      <SlotDetailSheet
        open={detailOpen}
        slot={slot}
        onClose={() => setDetailOpen(false)}
        onSetIntensity={onSetIntensity}
        onResetIntensity={onResetIntensity}
        onCycleMode={onCycleMode}
        onSetMode={onSetMode}
      />
    </View>
  );
};

// Effects v2: per-slot value + mode editor. A precise intensity slider (0..100%)
// with a RESET (the intensity reset moved here from the VSN1 encoder press, which
// is now mode-cycle) and a mode editor — a CYCLE button plus, when the slot
// exposes its `modeValues`, a tappable list to pick an explicit value. Reads the
// LIVE slot values (engine is the source of truth); edits round-trip through the
// engine and the status broadcast reconciles the display.
const SlotDetailSheet: React.FC<{
  open: boolean;
  slot: GlobalEffectSlotStatus;
  onClose: () => void;
  onSetIntensity: (value: number) => void;
  onResetIntensity: () => void;
  onCycleMode: () => void;
  onSetMode: (value: string | number | boolean) => void;
}> = ({ open, slot, onClose, onSetIntensity, onResetIntensity, onCycleMode, onSetMode }) => {
  const C = usePalette();
  if (!open) return null;
  const intensity = typeof slot.intensity === 'number' ? slot.intensity : null;
  const modeValues = Array.isArray(slot.modeValues) ? slot.modeValues : [];
  // Fogger & friends: an effect with NO magnitude knob disables the value
  // encoder / intensity editor entirely (a dead knob is a live-show trap). The
  // engine's `valueParam:'none'` on the slot status drives this when present;
  // otherwise a hardcoded fallback table does (effect_picker_logic).
  const encoderDisabled = slotDisablesEncoder(slot);
  // The 5 quick intensity steps (0/25/50/75/100%) — a compact, touch-friendly
  // editor that avoids a drag-fader inside a modal (reliable on RN-web + native).
  const steps = [0, 0.25, 0.5, 0.75, 1];
  return (
    <Modal transparent animationType="fade" visible={open} onRequestClose={onClose}>
      <TouchableOpacity activeOpacity={1} onPress={onClose} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 24 }}>
        <TouchableOpacity activeOpacity={1} onPress={() => {}} style={{ alignSelf: 'center', width: '100%', maxWidth: 420 }}>
          {/* Sheet card (2026-07 visual polish): matches the app's card
              language — 16px radius, ghost border (essential in the dark
              themes where the sheet fill nearly matches the scrim), soft
              ambient drop. Sections read as label row (name left, LIVE value
              right in primary) + control row, separated by one hairline. */}
          <View style={{
            backgroundColor: C.surfaceContainerLowest, borderRadius: 16, padding: 20,
            borderWidth: 1, borderColor: C.ghostBorder,
            boxShadow: shadow(0, 12, 32, '#000000', 0.35),
          }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingBottom: 12, marginBottom: 14, borderBottomWidth: 1, borderBottomColor: C.ghostBorder }}>
              <View style={{ paddingHorizontal: 7, height: 18, borderRadius: 9, backgroundColor: C.surfaceContainerHigh, borderWidth: 1, borderColor: C.ghostBorder, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 9, color: C.secondary, letterSpacing: 0.8 }}>
                  {`SLOT ${slot.slotId}`}
                </Text>
              </View>
              <Text numberOfLines={1} style={{ flex: 1, fontFamily: 'SpaceGrotesk_700Bold', fontSize: 15, color: C.text, letterSpacing: 0.3 }}>
                {slot.label || slot.effectId || 'Empty'}
              </Text>
            </View>

            {/* Intensity (value) */}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10, color: C.secondary, letterSpacing: 1, textTransform: 'uppercase' }}>
                {slot.intensityLabel || 'Intensity'}
              </Text>
              <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 11, color: (intensity !== null && !encoderDisabled) ? C.primary : C.icon, letterSpacing: 0.5 }}>
                {encoderDisabled ? 'NO KNOB' : intensity !== null ? `${Math.round(intensity * 100)}%` : 'N/A'}
              </Text>
            </View>
            {encoderDisabled ? (
              // Value encoder disabled — this effect has no magnitude knob. Show
              // the greyed step row (non-interactive) so the operator sees WHY
              // the encoder does nothing, instead of a bare missing control.
              <>
                <View style={{ flexDirection: 'row', gap: 6, marginBottom: 8, opacity: 0.35 }} pointerEvents="none">
                  {steps.map((v) => (
                    <View
                      key={v}
                      style={{
                        flex: 1, height: 40, borderRadius: 8,
                        backgroundColor: C.surfaceContainerHigh,
                        borderWidth: 1, borderColor: C.ghostBorder,
                        alignItems: 'center', justifyContent: 'center',
                      }}
                    >
                      <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 12, color: C.icon }}>
                        {Math.round(v * 100)}
                      </Text>
                    </View>
                  ))}
                </View>
                <Text style={{ color: C.secondary, fontSize: 11, marginBottom: 10 }}>
                  This effect has no value knob — the encoder is disabled for it.
                </Text>
              </>
            ) : intensity !== null ? (
              <View style={{ flexDirection: 'row', gap: 6, marginBottom: 10 }}>
                {steps.map((v) => {
                  const active = Math.abs(intensity - v) < 0.001;
                  return (
                    <TouchableOpacity
                      key={v}
                      onPress={() => onSetIntensity(v)}
                      activeOpacity={0.8}
                      style={{
                        flex: 1, height: 40, borderRadius: 8,
                        backgroundColor: active ? C.primary : C.surfaceContainerHigh,
                        borderWidth: 1, borderColor: active ? 'transparent' : C.ghostBorder,
                        alignItems: 'center', justifyContent: 'center',
                      }}
                      accessibilityLabel={`Set intensity ${Math.round(v * 100)} percent`}
                    >
                      <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 12, color: active ? C.onPrimary : C.text }}>
                        {Math.round(v * 100)}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            ) : (
              <Text style={{ color: C.secondary, fontSize: 11, marginBottom: 10 }}>
                This slot has not reported an intensity value.
              </Text>
            )}
            {intensity !== null && !encoderDisabled ? (
              <TouchableOpacity
                onPress={onResetIntensity}
                activeOpacity={0.8}
                style={{ alignSelf: 'flex-start', paddingHorizontal: 12, height: 32, justifyContent: 'center', borderRadius: 8, backgroundColor: C.surfaceContainerHigh, borderWidth: 1, borderColor: C.ghostBorder, marginBottom: 16 }}
              >
                <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10, color: C.text, letterSpacing: 0.8 }}>RESET INTENSITY</Text>
              </TouchableOpacity>
            ) : null}

            <View style={{ height: 1, backgroundColor: C.ghostBorder, marginBottom: 14 }} />

            {/* Mode */}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10, color: C.secondary, letterSpacing: 1, textTransform: 'uppercase' }}>
                {slot.modeLabel || 'Mode'}
              </Text>
              {slot.mode !== undefined && slot.mode !== null ? (
                <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 11, color: C.primary, letterSpacing: 0.5 }}>
                  {formatMode(slot.mode)}
                </Text>
              ) : null}
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
              <TouchableOpacity
                onPress={onCycleMode}
                activeOpacity={0.8}
                style={{ paddingHorizontal: 14, height: 40, justifyContent: 'center', borderRadius: 8, backgroundColor: C.surfaceContainerHigh, borderWidth: 1, borderColor: C.ghostBorder }}
                accessibilityLabel={`Cycle slot ${slot.slotId} mode`}
              >
                <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 11, color: C.text, letterSpacing: 0.8 }}>CYCLE</Text>
              </TouchableOpacity>
              {modeValues.map((v, i) => {
                const active = v === slot.mode;
                return (
                  <TouchableOpacity
                    key={`${i}:${String(v)}`}
                    onPress={() => onSetMode(v)}
                    activeOpacity={0.8}
                    style={{
                      paddingHorizontal: 12, height: 40, justifyContent: 'center', borderRadius: 8,
                      backgroundColor: active ? C.primary : C.surfaceContainerHigh,
                      borderWidth: 1, borderColor: active ? 'transparent' : C.ghostBorder,
                    }}
                    accessibilityLabel={`Set mode ${formatMode(v)}`}
                  >
                    <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 12, color: active ? C.onPrimary : C.text }}>
                      {formatMode(v)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
              {modeValues.length === 0 ? (
                <Text style={{ color: C.secondary, fontSize: 11 }}>No mode values reported.</Text>
              ) : null}
            </View>

            <TouchableOpacity onPress={onClose} style={{ marginTop: 20, height: 46, borderRadius: 10, backgroundColor: C.surfaceContainerHigh, borderWidth: 1, borderColor: C.ghostBorder, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 12, color: C.text, letterSpacing: 1 }}>CLOSE</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
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
  // PERFORMANCE MODE: binding an effect into an empty slot is a layout edit
  // (PATCH /global-effect-slots/:id — 409-gated while a show is live).
  const perfLocked = usePerfLock();
  const sizing = minWidth !== undefined
    ? { width: minWidth, minWidth, flexGrow: 0, flexShrink: 0 }
    : { flex: 1 };
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={perfLocked}
      activeOpacity={1}
      accessibilityLabel={`Add effect to slot ${slotId}`}
      accessibilityState={{ disabled: perfLocked }}
      style={{
        opacity: perfLocked ? 0.45 : 1,
        ...sizing, height, borderRadius: 8,
        backgroundColor: C.surfaceDim,
        borderWidth: 1,
        borderStyle: 'dashed',
        borderColor: C.ghostBorder,
        justifyContent: 'center', alignItems: 'center',
        ...(Platform.OS === 'web' ? { transitionDuration: '0s' as any } : {}),
      }}
    >
      {/* QA round10 MINOR: the "+" was C.icon @ 0.7 opacity — near-invisible
          (light grey glyph on the recessed grey socket). Raised one contrast
          step to the muted-but-legible `secondary` colour at full opacity, so
          it's a clear "add" affordance. The recessed surfaceDim fill + dashed
          border still keep the cell reading as an empty socket, not a bound
          chip. */}
      <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 18, color: C.secondary, lineHeight: 20 }}>
        +
      </Text>
    </TouchableOpacity>
  );
};

// VSN1 layout-deploy FAILURE strip — visible + dismissible. Reuses the error
// idiom (C.error) already used for the load-failure Text above, wrapped in a
// tinted row with a ✕ so the operator can clear a handled failure. A later
// successful deploy clears it automatically (deployBannerMessage → null).
const DeployErrorBanner: React.FC<{ message: string; onDismiss: () => void }> = ({ message, onDismiss }) => {
  const C = usePalette();
  return (
    <View
      accessibilityRole="alert"
      style={{
        flexDirection: 'row', alignItems: 'center', gap: 8,
        paddingVertical: 4, paddingHorizontal: 8, marginBottom: 4,
        borderRadius: 8, backgroundColor: C.errorContainer,
        borderWidth: 1, borderColor: C.error,
      }}
    >
      <Text style={{ flex: 1, color: C.error, fontSize: 11, fontFamily: 'SpaceGrotesk_700Bold', letterSpacing: 0.2 }}>
        {message}
      </Text>
      <TouchableOpacity
        onPress={onDismiss}
        hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
        accessibilityLabel="Dismiss deploy error"
        style={{ width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: C.surfaceContainerLowest, borderWidth: 1, borderColor: C.error }}
      >
        <Text style={{ color: C.error, fontSize: 12, lineHeight: 12, fontFamily: 'SpaceGrotesk_700Bold' }}>×</Text>
      </TouchableOpacity>
    </View>
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
  // ON label: `background`, not '#FFF' — the dark themes soften `error` to a
  // LIGHT salmon/red where white text loses contrast; each palette's
  // background is its guaranteed opposite pole (near-black on the dark
  // themes, and light still gets its white-on-deep-red).
  const fg = isOn ? C.background : C.error;
  const sizing = fixedWidth !== undefined
    ? { width: fixedWidth, minWidth: fixedWidth, flexGrow: 0, flexShrink: 0 }
    : { flex: 1 };
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={1}
      style={{
        ...sizing, height, paddingHorizontal: 6, borderRadius: 8,
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
        style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize, color: fg, letterSpacing: 0.8 }}
      >
        BLACKOUT
      </Text>
    </TouchableOpacity>
  );
};

// NOTE (channels-optimization campaign, 2026-06-29): the dedicated
// InvertButton was REMOVED here. Global color invert is now an assignable
// slot effect (library id 'invert', default slot 9) rendered as an ordinary
// SlotButton chip and dispatched through the standard slot action route.
// The legacy POST /global-effect-invert route + `globalInvert` WS broadcast
// stay alive engine-side for back-compat; this component no longer owns a
// fixed invert control.

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
  // A disabled slot still reports its old effectId (the engine's clear only
  // flips `enabled`), so gate the REMOVE button + bound header on the SAME
  // enabled+effectId predicate the grid uses — a cleared slot's sheet shows
  // "Empty" and no REMOVE, not a phantom bound effect.
  const isBound = slotIsBound(slot);
  return (
    <Modal transparent animationType="fade" visible={slotId !== null} onRequestClose={onClose}>
      <TouchableOpacity activeOpacity={1} onPress={onClose} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 24 }}>
        <TouchableOpacity activeOpacity={1} onPress={() => {}} style={{ alignSelf: 'center', width: '100%', maxWidth: 560 }}>
          {/* Sheet card — same visual contract as SlotDetailSheet (16px
              radius, ghost border, ambient drop) so the two slot sheets read
              as one family. Preset rows carry the behavior as a right-aligned
              tag instead of a sub-line: one-line rows scan faster in a long
              library list and the tap target stays a comfortable 44px. */}
          <View style={{
            backgroundColor: C.surfaceContainerLowest, borderRadius: 16, padding: 20, maxHeight: '85%',
            borderWidth: 1, borderColor: C.ghostBorder,
            boxShadow: shadow(0, 12, 32, '#000000', 0.35),
          }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingBottom: 12, marginBottom: 14, borderBottomWidth: 1, borderBottomColor: C.ghostBorder }}>
              <View style={{ paddingHorizontal: 7, height: 18, borderRadius: 9, backgroundColor: C.surfaceContainerHigh, borderWidth: 1, borderColor: C.ghostBorder, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 9, color: C.secondary, letterSpacing: 0.8 }}>
                  {`SLOT ${slotId}`}
                </Text>
              </View>
              <Text numberOfLines={1} style={{ flex: 1, fontFamily: 'SpaceGrotesk_700Bold', fontSize: 15, color: C.text, letterSpacing: 0.3 }}>
                {isBound ? (slot?.label ?? '') : 'Empty'}
              </Text>
              {isBound ? (
                <TouchableOpacity
                  onPress={onClear}
                  style={{
                    paddingHorizontal: 12, height: 32, justifyContent: 'center', borderRadius: 8,
                    backgroundColor: C.errorContainer, borderWidth: 1, borderColor: C.error,
                  }}
                  accessibilityLabel="Remove effect from slot"
                >
                  <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 11, color: C.error, letterSpacing: 0.8 }}>REMOVE</Text>
                </TouchableOpacity>
              ) : null}
            </View>
            {!library ? (
              <Text style={{ color: C.secondary, fontSize: 12 }}>Loading library…</Text>
            ) : (
              <ScrollView style={{ maxHeight: 480 }}>
                {/* Sections are built from the engine registry (auto-discovery):
                    a few families get named group headers (Blast Effects /
                    Flashes / Color Replacement), every other effect renders
                    ungrouped under its ENGINE display name (fx.name) — so the
                    Pulse→Strobe rename flows through and nothing is ever
                    filtered out. Favorites render a ⭐. See effect_picker_logic. */}
                {buildPickerSections(library as PickerLibrary).map((section) => (
                  <View key={section.title} style={{ marginBottom: 16 }}>
                    <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10, color: C.secondary, marginBottom: 6, letterSpacing: 1, textTransform: 'uppercase' }}>
                      {section.title}
                    </Text>
                    {section.rows.map((row) => (
                      <TouchableOpacity
                        key={`${row.effectId}/${row.presetId}`}
                        onPress={() => onPicked(row.effectId, row.presetId, row.preset as unknown as LibPreset)}
                        style={{ minHeight: 44, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, marginBottom: 4, backgroundColor: C.surfaceContainerHigh, borderWidth: 1, borderColor: C.ghostBorder, flexDirection: 'row', alignItems: 'center', gap: 8 }}
                        accessibilityLabel={`${row.favorite ? 'Favorite ' : ''}${row.preset.label} (${row.effectId} / ${row.presetId})`}
                      >
                        {row.favorite ? (
                          <Text style={{ fontSize: 12, lineHeight: 16 }} accessibilityLabel="Favorite">⭐</Text>
                        ) : null}
                        <Text numberOfLines={1} style={{ flex: 1, fontFamily: 'SpaceGrotesk_700Bold', fontSize: 13, color: C.text }}>{row.preset.label}</Text>
                        <View style={{ paddingHorizontal: 7, height: 18, borderRadius: 9, backgroundColor: C.surfaceDim, borderWidth: 1, borderColor: C.ghostBorder, alignItems: 'center', justifyContent: 'center' }}>
                          <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 10, color: C.secondary, letterSpacing: 0.4 }}>
                            {row.preset.defaultBehavior}
                          </Text>
                        </View>
                      </TouchableOpacity>
                    ))}
                  </View>
                ))}
              </ScrollView>
            )}
            <TouchableOpacity onPress={onClose} style={{ marginTop: 16, height: 46, borderRadius: 10, backgroundColor: C.surfaceContainerHigh, borderWidth: 1, borderColor: C.ghostBorder, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 12, color: C.text, letterSpacing: 1 }}>CLOSE</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
};

