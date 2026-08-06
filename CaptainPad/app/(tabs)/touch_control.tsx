// TOUCH CONTROL — a manual, hands-on lighting surface.
//
// LEFT  : color (hue × saturation pad, brightness, palette fade)
// RIGHT : tempo, rig master brightness, and the 3D pad
//
// ── Additive by construction ─────────────────────────────────────────────
// This tab adds a route; it changes nothing that already exists. Every engine
// contract it uses is consumed READ-ONLY as already published:
//   • CPC writes ride the existing `/ws/control` bus via `setSharedParam` —
//     the exact envelope marsin_engine/lib/api_server.js destructures
//     (`paramCenter.set(d.key, d.value, 'ws', d.origin)`).
//   • Master brightness rides the existing `PATCH /mixer { master }` client.
//   • Tempo reuses the existing `use_tempo_tap` hooks unchanged.
// No existing component, hook, endpoint, or dependency was modified.
//
// ── Why WS for params and REST for master ────────────────────────────────
// A touch drag fires at display rate. `setSharedParam` is a WS frame the
// engine already accepts, so continuous colour/size/rotate/speed moves cost no
// HTTP round-trip and are gated to the engine's own 30 Hz CPC broadcast rate.
// The master has NO WS setter (verified against the `/ws/control` inbound
// handler, which accepts setChannelFader / setChannelControl / setSolo / bump /
// setSharedParam and nothing master-related), so it goes over REST at a
// deliberately slower gate. BOTH paths always send the settled value ungated on
// release, so the rig can never be left on a dropped intermediate frame.
//
// ── Codex P0 compliance ──────────────────────────────────────────────────
// No fallback behaviors: an unknown engine value renders as "—" and writes
// nothing; a refused write (`paramRejected`) raises a real Alert instead of
// being swallowed; a failed master PATCH surfaces the engine's own error.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, Alert, TouchableOpacity, useWindowDimensions } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { useGlobalStyles } from '@/styles/globalStyles';
import { usePalette } from '@/hooks/use-theme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { engineEvents, type EngineMessage, type BusStatus } from '@/utils/engineEvents';
import { useEngineConnection } from '@/hooks/useEngineConnection';
import { useEngineState, useSharedParamValues } from '@/hooks/useEngineState';
import { useEngineLock } from '@/hooks/useEngineLock';
import { useOperatorTakeover } from '@/hooks/useTimeline';
import {
  updateMixerMaster,
  fetchGlobalEffectSlotsStatus,
  dispatchGlobalEffectSlotAction,
  patchGlobalEffectSlot,
  setGroupFixedColor,
  clearGroupFixedColor,
  setDeckChannelControl,
  fetchPatterns,
  invalidatePatternsCache,
  setActivePattern,
  testConnection,
} from '@/utils/api';
import { ColorPanel, type Hsv, type ColorTarget, type PaletteAction } from '@/components/touch_control/color_panel';
import { MotionPanel } from '@/components/touch_control/motion_panel';
import { EffectsBar } from '@/components/touch_control/effects_bar';
import { PatternList } from '@/components/touch_control/pattern_list';
import { patternInfo } from '@/components/touch_control/pattern_catalog';
import {
  CPC,
  CPC_SEND_INTERVAL_MS,
  MASTER_SEND_INTERVAL_MS,
  createSendGate,
  sharedParamMessage,
  isParamRejected,
  describeRejection,
  isHsv,
  asFiniteNumber,
  clamp01,
  numbersConverged,
  hsvConverged,
  clampBrightness,
  padXToBrightness,
  isBpmSyncOn,
  BPM_SYNC_ON,
  BPM_SYNC_OFF,
  OVERRIDE_WATCHDOG_MS,
  findSlotFor,
  firstFreeSlotId,
  activeTracer,
  padZToSweepHz,
  slotsFor,
  uniformPalette,
  monochromePalette,
  complementaryPalette,
  contrastingPalette,
  hsvToColor6,
  effectTakesColor,
  isEngineBackedSlot,
  COLOR_SLOTS,
  TOUCH_EFFECTS,
  PAINT_ZONES,
  paintZoneFor,
  paintPayload,
  allPaintedGroups,
  findExportId,
  patternHueControlFor,
  patternValControlFor,
  cycleStepMs,
  cycleSoloAt,
  rotatedColorFor,
  rotationAt,
  type ColorSlot,
  type EffectSlotLike,
  type EffectSpec,
} from '@/components/touch_control/touch_control_logic';

/** Below this width three panels cannot be read side by side — same floor the
 *  deck uses for its column split. */
const WIDE_MIN_WIDTH = 900;

/** Don't re-alert the same rejected key more than once per this window; a
 *  drag can produce many refusals from one underlying cause and the operator
 *  needs the message, not a modal storm. */
const REJECT_ALERT_COOLDOWN_MS = 5000;

/** Per-device store for palette slots 3-5 (the ones with no CPC home). */
const EXTRA_COLORS_KEY = '@CaptainPad:touchControl:extraColors';

/** Per-device store for the ARM switch (is this panel the master?). */
const ARMED_KEY = '@CaptainPad:touchControl:armed';

export default function TouchControlScreen() {
  const globalStyles = useGlobalStyles();
  const C = usePalette();

  const { width: winWidth, height: winHeight } = useWindowDimensions();
  const isWide = winWidth >= winHeight && winWidth >= WIDE_MIN_WIDTH;

  const [isConnected, setIsConnected] = useState<boolean | null>(null);
  const [connectionError, setConnectionError] = useState<string>('');

  // ── Engine truth ────────────────────────────────────────────────────────
  const params = useSharedParamValues<{
    colorPalette1: unknown;
    colorPalette2: unknown;
    colorTransitionMs: unknown;
    size: unknown;
    rotate: unknown;
    speed: unknown;
    bpmSpeedSync: unknown;
  }>({
    colorPalette1: null,
    colorPalette2: null,
    colorTransitionMs: null,
    size: null,
    rotate: null,
    speed: null,
    bpmSpeedSync: null,
  });
  const engineState = useEngineState();
  const engineStateRef = useRef(engineState);
  engineStateRef.current = engineState;

  const engineColor1 = isHsv(params.colorPalette1) ? params.colorPalette1 : null;
  const engineColor2 = isHsv(params.colorPalette2) ? params.colorPalette2 : null;
  const engineFadeMs = asFiniteNumber(params.colorTransitionMs);
  const engineSize = asFiniteNumber(params.size);
  const engineRotate = asFiniteNumber(params.rotate);
  const engineSpeed = asFiniteNumber(params.speed);
  const engineMaster = asFiniteNumber(engineState.master);
  // Threshold matches the engine's own reading of this float-as-boolean.
  const bpmSpeedSyncOn = isBpmSyncOn(params.bpmSpeedSync);

  // ── Optimistic override + convergence ───────────────────────────────────
  // docs/39 §4.2 permits optimistic local state for FADER / PARAM moves (and
  // only those). The override we set on each drag frame is held until the
  // engine ECHOES the value back (converged) — NOT merely until the finger
  // lifts. Releasing authority on touch-up would snap the control to the
  // stale engine value for the frames before the echo lands, which reads as a
  // bounce on a live lighting surface. A watchdog drops the override if the
  // echo never arrives (dropped socket, refused write) so the UI can never
  // wedge showing a value the rig does not actually have.
  const [override, setOverride] = useState<{
    color1: Hsv | null;
    color2: Hsv | null;
    fadeMs: number | null;
    size: number | null;
    rotate: number | null;
    speed: number | null;
    master: number | null;
  }>({ color1: null, color2: null, fadeMs: null, size: null, rotate: null, speed: null, master: null });

  type OverrideKey = keyof typeof override;

  // Keys currently under the finger. While dragging we never run convergence
  // (an intermediate echo would yank the crosshair back mid-gesture).
  const draggingRef = useRef<Record<string, boolean>>({});
  const watchdogRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const clearOverride = useCallback((key: OverrideKey) => {
    setOverride((p) => (p[key] === null ? p : { ...p, [key]: null }));
    const t = watchdogRef.current[key];
    if (t) {
      clearTimeout(t);
      delete watchdogRef.current[key];
    }
  }, []);

  /** Arm/refresh the "echo never came" backstop for a key. */
  const armWatchdog = useCallback(
    (key: OverrideKey) => {
      const existing = watchdogRef.current[key];
      if (existing) clearTimeout(existing);
      watchdogRef.current[key] = setTimeout(() => {
        delete watchdogRef.current[key];
        if (draggingRef.current[key]) return; // still held — not stale
        setOverride((p) => (p[key] === null ? p : { ...p, [key]: null }));
      }, OVERRIDE_WATCHDOG_MS);
    },
    [],
  );

  // Drop each override once the engine confirms it. Skipped while the key is
  // under the finger.
  useEffect(() => {
    const settled: OverrideKey[] = [];
    if (!draggingRef.current.color1 && hsvConverged(engineColor1, override.color1)) settled.push('color1');
    if (!draggingRef.current.color2 && hsvConverged(engineColor2, override.color2)) settled.push('color2');
    if (!draggingRef.current.fadeMs && numbersConverged(engineFadeMs, override.fadeMs, 1)) settled.push('fadeMs');
    if (!draggingRef.current.size && numbersConverged(engineSize, override.size)) settled.push('size');
    if (!draggingRef.current.rotate && numbersConverged(engineRotate, override.rotate)) settled.push('rotate');
    if (!draggingRef.current.speed && numbersConverged(engineSpeed, override.speed)) settled.push('speed');
    if (!draggingRef.current.master && numbersConverged(engineMaster, override.master)) settled.push('master');
    for (const k of settled) clearOverride(k);
  }, [
    engineColor1, engineColor2, engineFadeMs, engineSize, engineRotate, engineSpeed, engineMaster,
    override, clearOverride,
  ]);

  // Clear every pending watchdog on unmount — a fired timer touching state
  // after teardown is a leak and a React warning.
  useEffect(
    () => () => {
      for (const t of Object.values(watchdogRef.current)) clearTimeout(t);
      watchdogRef.current = {};
    },
    [],
  );

  const color1 = override.color1 ?? engineColor1;
  const color2 = override.color2 ?? engineColor2;
  const fadeMs = override.fadeMs ?? engineFadeMs;
  const size = override.size ?? engineSize;
  const rotate = override.rotate ?? engineRotate;
  const speed = override.speed ?? engineSpeed;
  const master = override.master ?? engineMaster;

  const [activeSlot, setActiveSlot] = useState<ColorTarget>(1);
  /** The last individual slot chosen, so turning MASTER off returns there
   *  instead of arbitrarily snapping to slot 1. */
  const lastSingleSlotRef = useRef<ColorSlot>(1);
  useEffect(() => {
    if (activeSlot !== 'all') lastSingleSlotRef.current = activeSlot;
  }, [activeSlot]);

  // ── Palette slots 3-5 (tab-local) ───────────────────────────────────────
  // The CPC has only colorPalette1/2, so slots 3-5 have no engine home. They
  // live here and are persisted per-device, following the same AsyncStorage
  // best-effort pattern the audio-plot picker uses. They tint the
  // colour-capable EFFECTS rather than the pattern.
  const [extraColors, setExtraColors] = useState<(Hsv | null)[]>([null, null, null]);

  // Has the persisted palette been read yet? Until it has we must NOT seed,
  // or a slow AsyncStorage read would clobber the operator's saved colours.
  const extrasLoadedRef = useRef(false);

  useEffect(() => {
    AsyncStorage.getItem(EXTRA_COLORS_KEY)
      .then((raw) => {
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            setExtraColors([0, 1, 2].map((i) => (isHsv(parsed[i]) ? (parsed[i] as Hsv) : null)));
          }
        }
      })
      // Best-effort: a missing/corrupt store just leaves slots 3-5 unset and
      // the first-run seed below fills them in.
      .catch(() => undefined)
      .finally(() => { extrasLoadedRef.current = true; });
  }, []);

  const persistExtras = useCallback((next: (Hsv | null)[]) => {
    AsyncStorage.setItem(EXTRA_COLORS_KEY, JSON.stringify(next)).catch(() => undefined);
  }, []);

  // FIRST-RUN SEED for slots 3-5.
  //
  // These have no engine home, so on a fresh device they start empty — and an
  // empty slot correctly paints NOTHING, which made PAINT SHIP look broken on
  // first use (only the two engine-backed zones lit). Seed them ONCE, from a
  // COMPLEMENT (analogous) spread of the live colour 1, so the palette arrives
  // usable AND pleasing — the five share a neighbourhood of the wheel, so the
  // first thing the operator sees can't clash. (This used to seed from the
  // CONTRAST pentad, five fully-saturated hues from every part of the wheel,
  // which is the garish arrangement.) The dots show real colours to change.
  //
  // This is an explicit INITIALISATION, not a fallback: it happens once, it is
  // persisted like any operator edit, and it never overwrites a stored value.
  useEffect(() => {
    if (!extrasLoadedRef.current) return;
    if (!color1) return;
    if (extraColors.some((c) => c !== null)) return;
    const spread = complementaryPalette(color1).slice(2);
    setExtraColors(spread);
    persistExtras(spread);
  }, [color1, extraColors, persistExtras]);

  /** The five colours in slot order. 1-2 are engine truth, 3-5 are local. */
  const paletteColors: (Hsv | null)[] = [color1, color2, ...extraColors];
  // The cycle interval is created once per (cycling, fade) change, so it must
  // read the palette through a ref rather than a captured value.
  const paletteColorsRef = useRef(paletteColors);
  paletteColorsRef.current = paletteColors;

  // ── The palette the CYCLE runs off (a SNAPSHOT, deliberately) ───────────
  //
  // BUG THIS FIXES: slots 1-2 ARE colorPalette1/2 — the exact params the cycle
  // writes on every tick. Reading the live palette back would mean each tick
  // re-reads what the previous tick just wrote, so the operator's chosen set
  // (CONTRAST / COMPLEMENT / whatever) degenerates within a few steps and the
  // colours they picked are lost.
  //
  // So the cycle walks a snapshot, re-taken whenever the operator CHOOSES a
  // new set (a palette action, or settling a colour by hand). That is exactly
  // the requested behaviour: whatever colours you choose are the ones cycled.
  const cyclePaletteRef = useRef<(Hsv | null)[]>(paletteColors);
  // Mirrored in STATE as well, because the DASHBOARD renders from it while
  // cycling (see displayColors below) and a ref alone would not re-render.
  const [chosenPalette, setChosenPalette] = useState<(Hsv | null)[]>(paletteColors);
  const snapshotCyclePalette = useCallback((next?: (Hsv | null)[]) => {
    const snap = next ? [...next] : [...paletteColorsRef.current];
    cyclePaletteRef.current = snap;
    setChosenPalette(snap);
  }, []);

  // ── Global effect slots (STROBE / RANDOM / TRACERS) ─────────────────────
  // Live status, including each slot's `active` flag. Seeded from
  // GET /global-effect-slots/status and kept current by the
  // `globalEffectMacroStatus` broadcast the engine fires after every dispatch.
  const [effectSlots, setEffectSlots] = useState<EffectSlotLike[]>([]);

  const effectSlotsRef = useRef<EffectSlotLike[]>([]);
  effectSlotsRef.current = effectSlots;

  const seedEffectSlots = useCallback(async () => {
    const res = await fetchGlobalEffectSlotsStatus();
    if (!res.ok || !res.data) return;
    const list = (res.data as { slots?: unknown }).slots;
    if (Array.isArray(list)) setEffectSlots(list as EffectSlotLike[]);
  }, []);

  // ── Gates ───────────────────────────────────────────────────────────────
  // 'portwatch' (hard) is curtained globally by EngineLockoutOverlay in the
  // tab layout — nothing to do here. 'plan' (soft) must be self-gated, and an
  // operator who takes over re-enables the controls.
  const { leaseHeld, notifyInteraction, resumeNow } = useOperatorTakeover();
  const { planLocked } = useEngineLock();

  // ── ARM switch: is TOUCH CONTROL the master right now? ──────────────────
  // Operator request: one button that activates this panel and makes it the
  // controlling surface, so it can be toggled on and off.
  //
  // Defaults to OFF and FAILS CLOSED: an unarmed panel writes NOTHING, so a
  // stray touch on an iPad lying on a table cannot move the rig. Arming calls
  // notifyInteraction(), which is this system's OWN "this surface is driving
  // now" mechanism — it takes the rig over from a running plan (the same lease
  // the Deck uses). Disarming calls resumeNow() to hand the plan back.
  //
  // Deliberately NOT the engine's global CPC source-lock: that is shared state
  // that would make the engine ignore bpm-sync / OSC / autopilot writes for
  // EVERY surface, not just this tab. That is an operator decision, not a
  // side-effect of tapping a button here.
  const [armed, setArmed] = useState(false);
  const armedRef = useRef(false);
  armedRef.current = armed;

  useEffect(() => {
    AsyncStorage.getItem(ARMED_KEY)
      .then((raw) => { if (raw === '1') setArmed(true); })
      .catch(() => undefined);
  }, []);

  // ── PAINT SHIP — the five colours live on the rig ───────────────────────
  // Session-only state (deliberately NOT persisted): this pins real fixture
  // groups to flat colours, and a setting that silently re-paints the ship on
  // next launch is exactly the kind of surprise a show does not need.
  const [painting, setPainting] = useState(false);
  const paintingRef = useRef(false);
  paintingRef.current = painting;

  /** Push an arbitrary colour onto a zone's groups. The colour is a parameter
   *  rather than "that zone's slot" because CYCLE rotates the assignment. */
  const paintZoneColor = useCallback(async (zone: { groups: string[] } | null, c: Hsv | null) => {
    if (!zone || !c) return;
    const { color, brightness } = paintPayload(c);
    // Groups within a zone go out together too — same reason as the zone-level
    // parallelism in the cycle driver: a zone should change as one thing.
    const results = await Promise.all(zone.groups.map((g) => setGroupFixedColor(g, color, brightness)));
    const bad = results.find((r) => !r.ok);
    if (bad) {
      Alert.alert('Paint failed', bad.error || 'The engine refused a colour for a group.');
    }
  }, []);

  /** Push one colour onto ITS OWN zone (the un-rotated, resting assignment). */
  const paintSlot = useCallback(
    (slot: ColorSlot, c: Hsv | null) => paintZoneColor(paintZoneFor(slot), c),
    [paintZoneColor],
  );

  /**
   * Release every group this feature ever touches — the exact set, so we can
   * never leave a stray override behind on a rig we do not own.
   *
   * Attempts EVERY group even if one fails. An early return here stranded
   * two groups painted in testing: releasing is a cleanup path, and a cleanup
   * path that gives up halfway is worse than one that reports at the end.
   */
  const releasePaint = useCallback(async () => {
    const failed: string[] = [];
    for (const g of allPaintedGroups()) {
      const res = await clearGroupFixedColor(g);
      if (!res.ok) failed.push(g);
    }
    if (failed.length) {
      Alert.alert(
        'Release failed',
        `The engine refused to clear: ${failed.join(', ')}. Those groups are still pinned — clear them from the Dimmer Rack.`,
      );
    }
  }, []);

  /** Paint all five zones from the current palette. */
  const paintAll = useCallback(async () => {
    for (const slot of COLOR_SLOTS) {
      await paintSlot(slot, slot === 1 ? color1 : slot === 2 ? color2 : extraColors[slot - 3]);
    }
  }, [color1, color2, extraColors, paintSlot]);

  // Leaving the tab releases the ship. A hard crash cannot run this, so the
  // overrides could survive — that is stated to the operator rather than
  // pretended away — but every ORDERLY exit cleans up after itself.
  useEffect(
    () => () => {
      if (paintingRef.current) void releasePaint();
    },
    [releasePaint],
  );

  // NOTE: the side effect lives OUTSIDE the state updater on purpose. React
  // may invoke an updater function twice (dev double-invoke), and doing engine
  // I/O inside one fires the paint/release TWICE and races — that is what left
  // two groups still pinned after a release in testing. Updaters must be pure.
  const togglePaint = useCallback(() => {
    const next = !paintingRef.current;
    paintingRef.current = next; // keep the ref authoritative before any await
    setPainting(next);
    if (next) {
      notifyInteraction();
      void paintAll();
    } else {
      void releasePaint();
    }
  }, [notifyInteraction, paintAll, releasePaint]);

  // ── CYCLE — walk the two pattern slots through all five colours ─────────
  // Session-only, like PAINT: a mode that silently starts cycling the rig on
  // next launch is not something a show wants.
  const [cycling, setCycling] = useState(false);
  const cyclingRef = useRef(false);
  cyclingRef.current = cycling;

  // Side effects OUTSIDE the updater — see the note on togglePaint. A dev
  // double-invoke here would arm/disarm the rig twice.
  const toggleArmed = useCallback(() => {
    const next = !armedRef.current;
    armedRef.current = next;
    setArmed(next);
    AsyncStorage.setItem(ARMED_KEY, next ? '1' : '0').catch(() => undefined);
    if (next) {
      notifyInteraction();          // take the rig over from any running plan
    } else {
      resumeNow();                  // hand it back
      // Releasing control must also release the ship: painted groups are
      // ENGINE-GLOBAL state, so leaving them pinned after disarming would
      // hold the rig hostage from a panel that is no longer in control.
      if (paintingRef.current) {
        paintingRef.current = false;
        setPainting(false);
        void releasePaint();
      }
    }
  }, [notifyInteraction, resumeNow, releasePaint]);

  const disabled = !armed || (planLocked && !leaseHeld) || isConnected === false;

  // ── Rate gates ──────────────────────────────────────────────────────────
  const cpcGate = useRef(createSendGate(CPC_SEND_INTERVAL_MS)).current;
  const masterGate = useRef(createSendGate(MASTER_SEND_INTERVAL_MS)).current;

  /**
   * What the DASHBOARD shows.
   *
   * OPERATOR: "cycling should not change my dashboard, it should only change
   * to the colours I choose."
   *
   * Slots 1-2 READ colorPalette1/2 — the exact params the cycle WRITES. So
   * while cycling, the live values are the cycle's current step, and the dots
   * would flicker through the sequence instead of showing the palette the
   * operator chose. During a cycle the panel therefore renders the CHOSEN set
   * (the snapshot), which is stable; the rig cycles, the dashboard does not.
   *
   * When not cycling the two are the same thing, so this changes nothing.
   */
  const displayColors: (Hsv | null)[] = cycling ? chosenPalette : paletteColors;

  // ── Rejected-write surfacing (Codex P0: never swallow) ──────────────────
  const lastRejectRef = useRef<{ key: string; at: number }>({ key: '', at: 0 });

  const onControl = useCallback((msg: EngineMessage) => {
    // Slot LIVE state (carries `active`) — broadcast after every dispatch.
    if (msg.type === 'globalEffectMacroStatus' && Array.isArray(msg.slots)) {
      setEffectSlots(msg.slots as EffectSlotLike[]);
      return;
    }
    // Slot CONFIG changed (e.g. our own provisioning, or another surface
    // rebinding a slot). Carries no `active`, so we re-seed status rather
    // than overwrite live state with a config-only snapshot.
    if (msg.type === 'globalEffectSlots') {
      void seedEffectSlots();
      return;
    }
    if (!isParamRejected(msg)) return;
    const now = Date.now();
    const prev = lastRejectRef.current;
    if (prev.key === msg.key && now - prev.at < REJECT_ALERT_COOLDOWN_MS) return;
    lastRejectRef.current = { key: msg.key, at: now };
    Alert.alert(
      'The engine refused that change',
      `"${msg.key}" was not applied. ${describeRejection(msg.reason, msg.lockedTo)}`,
    );
  }, []);

  const onStatus = useCallback((status: BusStatus) => {
    setIsConnected(status.connected);
    setConnectionError(status.lastError || '');
  }, []);

  // CPC + master state arrive through the shared module-level subscriptions
  // (useSharedParamValues / useEngineState), which seed themselves. The effect
  // SLOT status is the one thing this screen must seed itself, because its
  // `active` flags only ever ride the post-dispatch broadcast. We do NOT poll
  // and we do NOT force a reconnect — this runs on mount and on AppState
  // 'active', exactly like the deck's and mixer's seeds.
  const seed = useCallback(
    (_base: string, connected: boolean) => {
      if (!connected) return;
      void seedEffectSlots();
    },
    [seedEffectSlots],
  );

  useEngineConnection({ seed, onControl, onStatus });

  // ── Writes ──────────────────────────────────────────────────────────────
  const sendCpc = useCallback(
    (key: string, val: unknown, commit: boolean) => {
      // A commit MUST go out — otherwise the rig keeps the last gated frame.
      if (!commit && !cpcGate.allow()) return;
      if (commit) cpcGate.reset();
      engineEvents.send(sharedParamMessage(key, val));
    },
    [cpcGate],
  );

  const sendMaster = useCallback(
    async (v: number, commit: boolean) => {
      if (!commit && !masterGate.allow()) return;
      if (commit) masterGate.reset();
      // THE floor. Every master write from this tab funnels through here, so
      // there is no path — pad, fader, or future control — that can take the
      // rig below MIN_BRIGHTNESS from the touch panel.
      const res = await updateMixerMaster(clampBrightness(v));
      if (!res.ok) {
        Alert.alert('Brightness change failed', res.error || 'The engine rejected the master level.');
      }
    },
    [masterGate],
  );

  /** Mark a control as under the finger; records the operator takeover once
   *  per gesture so a live plan hands the rig over on first touch. */
  const beginDrag = useCallback(
    (key: OverrideKey) => {
      if (!draggingRef.current[key]) notifyInteraction();
      draggingRef.current[key] = true;
    },
    [notifyInteraction],
  );

  /** Finger lifted. The override STAYS until the engine echoes it (or the
   *  watchdog fires) — see the convergence effect above. */
  const endDrag = useCallback(
    (key: OverrideKey) => {
      draggingRef.current[key] = false;
      armWatchdog(key);
    },
    [armWatchdog],
  );

  // ── Color ───────────────────────────────────────────────────────────────
  // `target` is 1, 2, or 'both'. BOTH writes the two palette keys from a
  // SINGLE gate decision so they always leave together — otherwise a
  // rate-gated drag could ship colorPalette1 and drop colorPalette2, and the
  // rig would sit on a two-tone gradient the operator never asked for.
  /**
   * Push a colour into every colour-capable effect slot this tab owns, so the
   * palette actually drives the effects and not just the pattern. Slot config
   * is PERSISTED, so this runs on commit only — never per drag frame — and
   * each patch is followed by `activate` when the effect is live, because
   * patchSlot does not re-apply to a running effect.
   */
  /** Tint ONE colour-capable effect. */
  const tintEffect = useCallback(
    async (spec: EffectSpec, c: Hsv | null) => {
      if (!c || !effectTakesColor(spec.effectId)) return;
      const slot = findSlotFor(effectSlotsRef.current, spec.effectId, spec.presetId);
      if (!slot) return; // not bound yet — it picks the colour up when provisioned
      const res = await patchGlobalEffectSlot(slot.slotId, {
        paramsOverride: { ...(slot.paramsOverride || spec.params || {}), color: hsvToColor6(c) },
      });
      if (!res.ok) {
        Alert.alert('Effect colour failed', res.error || `The engine refused a colour for ${spec.label}.`);
        return;
      }
      if (slot.active) await dispatchGlobalEffectSlotAction(slot.slotId, 'activate');
    },
    [],
  );

  /**
   * Give EACH colour-capable effect its own colour from the chosen set, so the
   * operator's palette drives the effects as well as the patterns.
   *
   * ONLY the tracers can be tinted. STROBE has no colour parameter (it is a
   * gate — it flashes whatever colour is already lit, so it inherits the
   * chosen colour for free) and RANDOM / Frost Sparkle is a WHITE-channel
   * glint with no colour at all. Verified against the engine's validateParams;
   * tinting them would need an engine change, so they are left alone rather
   * than pretending.
   */
  const applyColorsToEffects = useCallback(
    async (colors: (Hsv | null)[], step: number) => {
      const mine = TOUCH_EFFECTS.filter((sp) => effectTakesColor(sp.effectId));
      await Promise.all(
        mine.map((spec, i) => tintEffect(spec, rotatedColorFor(colors, i, step))),
      );
    },
    [tintEffect],
  );

  /**
   * Push palette slots 3-5 onto the RUNNING PATTERN's own hue sliders.
   *
   * The CPC has no colorPalette3..5, so a five-colour pattern carries the extra
   * three as LOCAL controls (`sliderHue3/4/5` on 66_five_colour_prism). This
   * resolves each control's numeric id by NAME from the deck channel's exports
   * and writes it. If the running pattern does not expose them — true of every
   * other pattern — nothing is written and nothing is faked.
   */
  const applyPatternHues = useCallback(
    async (colors: (Hsv | null)[]) => {
      const exports = (engineStateRef.current.deckChannel?.exports ?? []) as
        { id: number; name?: string }[];
      if (!exports.length) return;
      const writes: Promise<unknown>[] = [];
      for (const slot of COLOR_SLOTS) {
        const c = colors[slot - 1];
        if (!c) continue;
        const hueName = patternHueControlFor(slot);
        if (hueName) {
          const id = findExportId(exports, hueName);
          if (id !== null) writes.push(setDeckChannelControl(id, clamp01(c.h)));
        }
        // BRIGHTNESS too, when the pattern exposes it. Without this the HUE
        // button (one colour, five brightnesses) does nothing on slots 3-5,
        // because a hue is all the pattern would ever be told. A pattern that
        // does not declare these is skipped, not faked.
        const valName = patternValControlFor(slot);
        if (valName) {
          const id = findExportId(exports, valName);
          if (id !== null) writes.push(setDeckChannelControl(id, clamp01(c.v)));
        }
      }
      if (!writes.length) return;
      const results = (await Promise.all(writes)) as { ok: boolean; error?: string }[];
      const bad = results.find((r) => !r.ok);
      if (bad) {
        Alert.alert('Pattern colour failed', bad.error || 'The engine refused a pattern hue.');
      }
    },
    [],
  );

  /** Single-colour convenience for the hand-edit path. */
  const applyColorToEffects = useCallback(
    async (c: Hsv) => {
      const mine = TOUCH_EFFECTS.filter((sp) => effectTakesColor(sp.effectId));
      await Promise.all(mine.map((spec) => tintEffect(spec, c)));
    },
    [tintEffect],
  );

  const toggleCycle = useCallback(() => {
    const next = !cyclingRef.current;
    cyclingRef.current = next;
    setCycling(next);
    if (next) {
      // Freeze the CURRENT five as the set to walk — see cyclePaletteRef.
      snapshotCyclePalette();
      notifyInteraction();
      return;
    }
    // ── STOPPING: give the operator their palette back ───────────────────
    // Slots 1-2 ARE colorPalette1/2, which the cycle overwrites on every step
    // (and with the SAME colour in both, so they end up identical). Without
    // this, stopping would leave the operator's chosen colours 1 and 2
    // destroyed — replaced by whatever step the cycle happened to stop on.
    const chosen = cyclePaletteRef.current;
    if (chosen[0] || chosen[1]) {
      cpcGate.reset();
      if (chosen[0]) engineEvents.send(sharedParamMessage(CPC.COLOR_1, chosen[0]));
      if (chosen[1]) engineEvents.send(sharedParamMessage(CPC.COLOR_2, chosen[1]));
      setOverride((prev) => ({ ...prev, color1: chosen[0], color2: chosen[1] }));
    }
    // Put the painted zones and the effects back on the resting assignment
    // too, so nothing is left holding a rotated colour.
    if (paintingRef.current) {
      void Promise.all(PAINT_ZONES.map((zone, z) => paintZoneColor(zone, chosen[z])));
    }
    void applyColorsToEffects(chosen, 0);
    void applyPatternHues(chosen);
  }, [notifyInteraction, snapshotCyclePalette, cpcGate, paintZoneColor, applyColorsToEffects, applyPatternHues]);

  // The driver. Does BOTH things the operator asked for, on the same beat:
  //
  //   1. PATTERNS  — walks the two palette slots through all five colours, so
  //      every colour is used by the animating majority of the rig.
  //   2. ZONES     — rotates the zone -> colour assignment (only meaningful
  //      while PAINT is on), so several DIFFERENT colours sit on different
  //      fixtures at once and each colour visits each area in turn.
  //
  // Together: the ship is never one flat colour, and nothing is left unused.
  // Gated on ARMED + connected like every other write. Step interval leaves
  // room for the palette crossfade to finish before the next target is set.
  const cycleStepRef = useRef(0);
  useEffect(() => {
    if (!cycling || disabled) return;
    const stepMs = cycleStepMs(fadeMs);
    const tick = () => {
      const colors = cyclePaletteRef.current;
      const step = cycleStepRef.current;
      cycleStepRef.current += 1;

      // 1 — the patterns. BOTH slots get the SAME colour so the pattern's
      // palette interpolation collapses: the rig can only ever show a colour
      // from the chosen set, never an in-between hue the operator did not pick.
      const solo = cycleSoloAt(colors, step);
      if (solo) {
        cpcGate.reset();
        engineEvents.send(sharedParamMessage(CPC.COLOR_1, solo));
        engineEvents.send(sharedParamMessage(CPC.COLOR_2, solo));
      }

      // 1b — the colour-capable EFFECTS follow the same chosen set, offset so
      // a tracer is not always identical to the pattern colour.
      void applyColorsToEffects(colors, step);

      // 1c — rotate the PATTERN's own extra hues too, so a five-colour pattern
      // walks the chosen set exactly like the zones do.
      void applyPatternHues(rotationAt(colors, step));

      // 2 — the painted zones (nothing to rotate when PAINT is off)
      if (!paintingRef.current) return;
      const assignment = rotationAt(colors, step);
      // Fire every zone AT ONCE rather than in sequence. Sequential PUTs took
      // long enough that a rotation was visible as a stagger, and mid-update
      // two zones could momentarily hold the same colour — measured, not
      // theoretical. The engine has no batch endpoint for group colours (it is
      // one PUT per group), so parallel issue is as close to atomic as this
      // gets without an engine change.
      void Promise.all(
        PAINT_ZONES.map((zone, z) => paintZoneColor(zone, assignment[z])),
      );
    };
    tick(); // move immediately so the button feels instant
    const id = setInterval(tick, stepMs);
    return () => clearInterval(id);
  }, [cycling, disabled, fadeMs, cpcGate, paintZoneColor, applyColorsToEffects, applyPatternHues]);

  const handleColor = useCallback(
    (target: ColorTarget, next: Hsv, commit: boolean) => {
      const slots = slotsFor(target);
      // Only slots 1-2 have an engine home; 3-5 are tab-local palette storage.
      const engineSlots = slots.filter(isEngineBackedSlot);
      const stateKeys: OverrideKey[] = engineSlots.map((s) => (s === 1 ? 'color1' : 'color2'));

      if (!commit) stateKeys.forEach(beginDrag);
      setOverride((p) => {
        const patch: Partial<typeof p> = {};
        for (const k of stateKeys) patch[k] = next as never;
        return { ...p, ...patch };
      });

      // Slots 3-5 live here; update (and persist) them alongside.
      const localSlots = slots.filter((s) => !isEngineBackedSlot(s));
      if (localSlots.length) {
        setExtraColors((prev) => {
          const nextExtras = [...prev];
          for (const s of localSlots) nextExtras[s - 3] = next;
          if (commit) persistExtras(nextExtras);
          return nextExtras;
        });
      }

      if (commit) {
        cpcGate.reset();
        for (const s of engineSlots) {
          engineEvents.send(sharedParamMessage(s === 1 ? CPC.COLOR_1 : CPC.COLOR_2, next));
        }
        stateKeys.forEach(endDrag);
        // A hand-picked colour is also a CHOICE — fold it into the set the
        // cycle walks, so editing a colour mid-cycle is honoured instead of
        // being overwritten on the next tick.
        {
          const merged = [...cyclePaletteRef.current];
          for (const sl of slots) merged[sl - 1] = next;
          snapshotCyclePalette(merged);
        }
        // Slots 3-5 have no CPC home, so they reach the rig through the
        // running pattern's own hue sliders.
        {
          const merged2 = [...cyclePaletteRef.current];
          for (const sl of slots) merged2[sl - 1] = next;
          void applyPatternHues(merged2);
        }
        // The colour the operator just settled on also tints the effects...
        void applyColorToEffects(next);
        // ...and repaints its zone on the ship, so PAINT SHIP follows the
        // palette live instead of being a one-shot snapshot.
        if (paintingRef.current) {
          for (const s2 of slots) void paintSlot(s2, next);
        }
      }
      // ── NO intermediate colour writes while dragging (deliberate) ───────
      // The engine's palette slew ramps from wherever the colour currently
      // sits to each new target (param_center.tickColorTransitions →
      // makeHsvTransition, OKLCH shortest-arc). Streaming every drag frame
      // therefore re-targets the ramp ~30×/s and the rig SCRUBS through every
      // hue the finger crosses — the "fades through the rainbow" the operator
      // saw. Sending only the settled colour means the engine fades once,
      // directly from the previous colour to the chosen one, over COLOR FADE.
      // The crosshair still tracks the finger live via the local override, so
      // the pad feels identical; only the rig waits for the release.
    },
    [beginDrag, endDrag, cpcGate, persistExtras, applyColorToEffects],
  );

  /**
   * MASTER / HUE / COMPLEMENT / CONTRAST — palette generators.
   *
   * All three derive from the CURRENTLY SELECTED colour (slot 1 when MASTER is
   * already active), write every slot, and commit ungated. Complementary is
   * 180° opposite; contrasting is five hues spread evenly 72° apart, which is
   * the maximally-distinct arrangement for five slots.
   */
  const handlePalette = useCallback(
    (action: PaletteAction) => {
      if (disabled) return;

      // MASTER is a TOGGLE (operator request). A second tap while it is
      // engaged drops back to editing ONE slot, so the pad stops driving all
      // five together. It only changes what the pad targets — it never
      // repaints, so the colours you just set are left exactly as they are.
      if (action === 'master' && activeSlot === 'all') {
        setActiveSlot(lastSingleSlotRef.current);
        return;
      }

      const seedSlot: ColorSlot = activeSlot === 'all' ? 1 : activeSlot;
      const seed = seedSlot === 1 ? color1 : seedSlot === 2 ? color2 : extraColors[seedSlot - 3];
      if (!seed) {
        Alert.alert(
          'No colour to build from',
          `Colour ${seedSlot} has no value yet. Touch the pad to set it first.`,
        );
        return;
      }
      notifyInteraction();

      const next =
        action === 'master' ? uniformPalette(seed)
        : action === 'monochrome' ? monochromePalette(seed)
        : action === 'complement' ? complementaryPalette(seed)
        : contrastingPalette(seed);

      // Engine-backed slots go over the WS, ungated.
      cpcGate.reset();
      engineEvents.send(sharedParamMessage(CPC.COLOR_1, next[0]));
      engineEvents.send(sharedParamMessage(CPC.COLOR_2, next[1]));
      setOverride((p) => ({ ...p, color1: next[0], color2: next[1] }));
      endDrag('color1');
      endDrag('color2');

      // Local slots 3-5.
      const extras = [next[2], next[3], next[4]];
      setExtraColors(extras);
      persistExtras(extras);

      // MASTER selects the all-slots target so the pad keeps driving them
      // together; the other two leave the current selection alone.
      if (action === 'master') setActiveSlot('all');
      // (MASTER's OFF path is handled before we get here — see handlePalette's
      //  early return for a second tap.)

      // This IS the operator choosing a set — it becomes what CYCLE walks.
      snapshotCyclePalette(next);

      // Slots 3-5 go to the running pattern's own hue sliders.
      void applyPatternHues(next);

      // Effects follow the first colour of the new palette.
      void applyColorToEffects(next[0]);
      // A whole-palette change repaints every zone at once — this is what
      // makes MASTER / HUE / COMPLEMENT / CONTRAST flip the ship in one tap.
      if (paintingRef.current) {
        void (async () => {
          for (const slot of COLOR_SLOTS) await paintSlot(slot, next[slot - 1]);
        })();
      }
    },
    [
      disabled, activeSlot, color1, color2, extraColors, notifyInteraction,
      cpcGate, endDrag, persistExtras, applyColorToEffects, applyPatternHues,
      snapshotCyclePalette,
    ],
  );

  // ── Audio-engine BPM → SPEED sync ───────────────────────────────────────
  // One-tap hand-off of SPEED between the audio engine and the operator. This
  // is a discrete toggle, not a drag, so it always commits ungated. No local
  // override: the engine's echo is the only thing that should flip the button,
  // so a refused write leaves the button showing the TRUTH rather than a lie.
  const handleBpmSyncToggle = useCallback(
    (on: boolean) => {
      if (disabled) return;
      notifyInteraction();
      sendCpc(CPC.BPM_SPEED_SYNC, on ? BPM_SYNC_ON : BPM_SYNC_OFF, true);
    },
    [disabled, notifyInteraction, sendCpc],
  );

  const handleFade = useCallback(
    (ms: number, commit: boolean) => {
      if (!commit) beginDrag('fadeMs');
      setOverride((p) => ({ ...p, fadeMs: ms }));
      sendCpc(CPC.COLOR_FADE_MS, ms, commit);
      if (commit) endDrag('fadeMs');
    },
    [beginDrag, endDrag, sendCpc],
  );

  // ── Pad: X = master BRIGHTNESS, Y = rotate ─────────────────────────────
  // The two axes ride DIFFERENT transports now — brightness is REST-only
  // (there is no WS master setter) while rotate is a CPC param over the WS —
  // so each keeps its own rate gate. `padX` arrives as a unit pad position and
  // is mapped onto the floored brightness range here.
  const handlePad = useCallback(
    (padX: number, nextRotate: number, commit: boolean) => {
      const nextBright = padXToBrightness(padX);
      if (!commit) {
        beginDrag('master');
        beginDrag('rotate');
      }
      setOverride((p) => ({ ...p, master: nextBright, rotate: nextRotate }));

      if (commit) {
        cpcGate.reset();
        engineEvents.send(sharedParamMessage(CPC.ROTATE, nextRotate));
        void sendMaster(nextBright, true);
        endDrag('master');
        endDrag('rotate');
        return;
      }
      if (cpcGate.allow()) {
        engineEvents.send(sharedParamMessage(CPC.ROTATE, nextRotate));
      }
      // sendMaster applies its own (slower) gate internally.
      void sendMaster(nextBright, false);
    },
    [beginDrag, endDrag, cpcGate, sendMaster],
  );

  /**
   * Z drives the CPC `speed` (the pattern's animation rate) AND, on release,
   * the travelling speed of whichever tracer is currently lit.
   *
   * OPERATOR BUG: "when I turn off the sync the XY coordinates are not
   * controlling the speed of the effects at all." That was accurate — CPC
   * `speed` is the PATTERN clock; a tracer's travel rate is `speedHz`, a slot
   * parameter on a different system entirely, so Z never touched it.
   *
   * The engine exposes no runtime setter for `speedHz` (a sweep slot's
   * primary intensity is "Sweep Depth" and its mode wheel is "Sync" — neither
   * is the rate), so the only route is to patch the slot's paramsOverride.
   * That is a PERSISTED config write, so it happens ONCE on release — never
   * per drag frame — and is followed by an `activate` re-dispatch because
   * patchSlot alone does not re-apply to an already-running effect
   * (`_reapplyIfActive` is what does, and patchSlot does not call it).
   */
  const handleSpeed = useCallback(
    (v: number, commit: boolean) => {
      if (!commit) beginDrag('speed');
      setOverride((p) => ({ ...p, speed: v }));
      sendCpc(CPC.SPEED, v, commit);
      if (!commit) return;
      endDrag('speed');

      const lit = activeTracer(effectSlots);
      if (!lit) return;
      const speedHz = padZToSweepHz(v);
      void (async () => {
        const patch = await patchGlobalEffectSlot(lit.slot.slotId, {
          paramsOverride: { ...(lit.spec.params || {}), speedHz },
        });
        if (!patch.ok) {
          Alert.alert('Tracer speed failed', patch.error || 'The engine refused the tracer speed.');
          return;
        }
        // Re-apply live: a patch updates the stored config but does not push
        // it into the running effect.
        const re = await dispatchGlobalEffectSlotAction(lit.slot.slotId, 'activate');
        if (!re.ok) {
          Alert.alert('Tracer speed failed', re.error || 'The engine could not re-apply the tracer.');
        }
      })();
    },
    [beginDrag, endDrag, sendCpc, effectSlots],
  );

  // ── Master ──────────────────────────────────────────────────────────────
  const handleMaster = useCallback(
    (v: number, commit: boolean) => {
      if (!commit) beginDrag('master');
      setOverride((p) => ({ ...p, master: v }));
      void sendMaster(v, commit);
      if (commit) endDrag('master');
    },
    [beginDrag, endDrag, sendMaster],
  );

  // ── Global effects ──────────────────────────────────────────────────────
  // Resolve the effect to the slot ALREADY bound to it and toggle that slot,
  // so the operator's existing effect layout is reused rather than rewritten.
  // Only when an effect is bound nowhere do we provision it — and then only
  // into the invisible range (slotId >= 9), never over the 8 slots the
  // Deck/Mixer grid and VSN1 page display.
  const handleEffectToggle = useCallback(
    async (spec: EffectSpec) => {
      if (disabled) return;
      notifyInteraction();

      let slot = findSlotFor(effectSlots, spec.effectId, spec.presetId);

      if (!slot) {
        const freeId = firstFreeSlotId(effectSlots);
        if (freeId === null) {
          Alert.alert(
            'No free effect slot',
            `All 32 engine effect slots are in use, so ${spec.label} cannot be bound. Free a slot in the Deck's effects grid and try again.`,
          );
          return;
        }
        const patch = await patchGlobalEffectSlot(freeId, {
          effectId: spec.effectId,
          presetId: spec.presetId,
          behavior: 'toggle',
          label: spec.label,
          enabled: true,
          // Carries the tracer's axis/speed/colour. The engine merges this
          // OVER the preset's params and validates it, so an illegal value
          // 400s here rather than silently doing the wrong thing on the rig.
          ...(spec.params ? { paramsOverride: spec.params } : {}),
        });
        if (!patch.ok) {
          Alert.alert(
            `Could not bind ${spec.label}`,
            patch.error || 'The engine refused the slot configuration.',
          );
          return;
        }
        // Re-read so we hold the engine's own view of the new slot rather
        // than a guess about what it stored.
        await seedEffectSlots();
        const after = await fetchGlobalEffectSlotsStatus();
        const list = after.ok && after.data ? (after.data as { slots?: unknown }).slots : null;
        slot = Array.isArray(list)
          ? findSlotFor(list as EffectSlotLike[], spec.effectId, spec.presetId)
          : null;
        if (!slot) {
          Alert.alert(
            `Could not bind ${spec.label}`,
            'The engine accepted the slot but did not report it back. Nothing was changed.',
          );
          return;
        }
      }

      const res = await dispatchGlobalEffectSlotAction(slot.slotId, 'toggle');
      if (!res.ok) {
        Alert.alert(`${spec.label} failed`, res.error || 'The engine refused the effect toggle.');
        return;
      }
      // The engine broadcasts `globalEffectMacroStatus` on success, which is
      // what flips the button — no optimistic state, so a refused toggle can
      // never leave the button lying about the rig.
    },
    [disabled, effectSlots, notifyInteraction, seedEffectSlots],
  );

  // ── PATTERNS sheet ──────────────────────────────────────────────────────
  // Browse what the engine already has loaded and put one on the rig, so the
  // colour dots on this tab paint an existing pattern instead of only the
  // five-colour one. Additive: no engine route is new, nothing else on this
  // tab changes, and the sheet obeys the same ARM gate as every control here
  // (loading a pattern IS a write to the rig).
  const [patternsOpen, setPatternsOpen] = useState(false);
  const [patternNames, setPatternNames] = useState<string[]>([]);
  const [patternsLoading, setPatternsLoading] = useState(false);
  const [patternsError, setPatternsError] = useState<string | null>(null);
  const [activePatternName, setActivePatternName] = useState<string | null>(null);
  const [pendingPattern, setPendingPattern] = useState<string | null>(null);

  // The ENGINE is the source of truth for what is playing. `/status` (via
  // testConnection) already carries `activePattern`, so this needs no new
  // route. A failed read leaves the previous value and reports it — it never
  // invents "nothing is playing".
  const refreshActivePattern = useCallback(async () => {
    const res = await testConnection();
    if (!res.ok) {
      setPatternsError(res.error ? `Could not read the engine status: ${res.error}` : 'Could not read the engine status.');
      return;
    }
    const name = res.data?.activePattern;
    setActivePatternName(typeof name === 'string' && name.length > 0 ? name : null);
  }, []);

  const loadPatternList = useCallback(async () => {
    setPatternsLoading(true);
    setPatternsError(null);
    const res = await fetchPatterns();
    setPatternsLoading(false);
    if (!res.ok) {
      setPatternsError(
        res.error ? `Could not read the pattern list: ${res.error}` : 'Could not read the pattern list.',
      );
      return;
    }
    if (!Array.isArray(res.data)) {
      // "ok" with no array is a broken contract, not an empty rig. Say that
      // rather than rendering a silently empty list.
      setPatternsError('The engine returned a pattern list this app could not read.');
      return;
    }
    setPatternNames(res.data);
  }, []);

  // fetchPatterns() serves a 5s cache, so REFRESH drops it first — otherwise
  // the button would look like it re-read the engine when it did not.
  const refreshPatterns = useCallback(() => {
    invalidatePatternsCache();
    loadPatternList();
    refreshActivePattern();
  }, [loadPatternList, refreshActivePattern]);

  const openPatterns = useCallback(() => {
    setPatternsOpen(true);
    if (patternNames.length === 0) loadPatternList();
    refreshActivePattern();
  }, [patternNames.length, loadPatternList, refreshActivePattern]);

  const handleSelectPattern = useCallback(
    async (name: string) => {
      if (disabled) return;
      notifyInteraction();
      setPendingPattern(name);
      setPatternsError(null);

      const res = await setActivePattern(name);
      setPendingPattern(null);

      if (!res.ok) {
        // A pattern swap is gated while a show is live (409 PERFORMANCE_MODE).
        // Say so plainly and leave the row alone — never flip it optimistically.
        setPatternsError(
          res.code === 'PERFORMANCE_MODE'
            ? 'The engine is in performance mode and refused the pattern change.'
            : res.error || 'The engine refused the pattern change.',
        );
        return;
      }
      await refreshActivePattern();
    },
    [disabled, notifyInteraction, refreshActivePattern],
  );

  const activePatternLabel = activePatternName
    ? patternInfo(activePatternName)?.title ?? activePatternName
    : 'NONE READ YET';

  const colorPanel = (
    <ColorPanel
      active={activeSlot}
      onSelectActive={setActiveSlot}
      colors={displayColors}
      onColorDrag={(target, next) => handleColor(target, next, false)}
      onColorCommit={(target, next) => handleColor(target, next, true)}
      onPalette={handlePalette}
      painting={painting}
      onTogglePaint={togglePaint}
      cycling={cycling}
      onToggleCycle={toggleCycle}
      fadeMs={fadeMs}
      onFadeDrag={(ms) => handleFade(ms, false)}
      onFadeCommit={(ms) => handleFade(ms, true)}
      disabled={disabled}
    />
  );

  const motionPanel = (
    <MotionPanel
      master={master}
      onMasterDrag={(v) => handleMaster(v, false)}
      onMasterCommit={(v) => handleMaster(v, true)}
      size={size}
      rotate={rotate}
      speed={speed}
      onPadDrag={(s, r) => handlePad(s, r, false)}
      onPadCommit={(s, r) => handlePad(s, r, true)}
      onSpeedDrag={(v) => handleSpeed(v, false)}
      onSpeedCommit={(v) => handleSpeed(v, true)}
      bpmSpeedSyncOn={bpmSpeedSyncOn}
      onBpmSyncToggle={handleBpmSyncToggle}
      disabled={disabled}
    />
  );

  return (
    <View style={[globalStyles.container, { flexDirection: 'column' }]}>
      {/* Header */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          paddingHorizontal: 20,
          paddingTop: 16,
          paddingBottom: 8,
        }}
      >
        {/* MUST be a key of components/ui/icon-symbol.tsx's MAPPING. tsc does
            NOT protect this: module resolution picks icon-symbol.ios.tsx,
            whose `name` is the broad SF-Symbols union, so an unmapped name
            type-checks fine and then renders as a BLANK icon on web/Android
            (MAPPING[name] → undefined). 'square.grid.2x2' is mapped. */}
        <IconSymbol name="square.grid.2x2" size={26} color={C.primary} />
        <Text
          style={{
            fontFamily: 'SpaceGrotesk_700Bold',
            fontSize: 22,
            letterSpacing: 3,
            color: C.text,
          }}
        >
          TOUCH CONTROL
        </Text>
        <View style={{ flex: 1 }} />

        {/* PATTERNS — opens the browse sheet. Shows what is on the rig right
            now so the operator can read it without opening anything. */}
        <TouchableOpacity
          onPress={openPatterns}
          accessibilityRole="button"
          accessibilityLabel="Browse patterns"
          style={{
            minHeight: 48,
            paddingVertical: 8,
            paddingHorizontal: 16,
            borderRadius: 12,
            marginRight: 12,
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: 1,
            borderColor: C.ghostBorder,
            backgroundColor: C.surfaceContainerHigh,
          }}
        >
          <Text
            style={{
              fontFamily: 'SpaceGrotesk_700Bold',
              fontSize: 12,
              letterSpacing: 1,
              color: C.text,
            }}
          >
            PATTERNS
          </Text>
          <Text
            style={{
              fontFamily: 'Inter_400Regular',
              fontSize: 9,
              color: C.icon,
              marginTop: 1,
              maxWidth: 180,
            }}
            numberOfLines={1}
          >
            {activePatternLabel}
          </Text>
        </TouchableOpacity>

        {/* ARM / MASTER switch. Sits in the header because it gates every
            other control on the tab — the operator must always be able to see
            whether this panel is driving the rig. */}
        <TouchableOpacity
          onPress={toggleArmed}
          accessibilityRole="button"
          accessibilityLabel={armed ? 'Touch control is master, tap to release' : 'Take control, make touch control master'}
          accessibilityState={{ selected: armed }}
          style={{
            minHeight: 48,
            paddingVertical: 8,
            paddingHorizontal: 18,
            borderRadius: 12,
            marginRight: 12,
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: 2,
            borderColor: armed ? C.tertiary : C.ghostBorder,
            backgroundColor: armed ? C.tertiary : C.surfaceContainerHigh,
          }}
        >
          <Text
            style={{
              fontFamily: 'SpaceGrotesk_700Bold',
              fontSize: 13,
              letterSpacing: 1,
              color: armed ? C.onPrimary : C.text,
            }}
          >
            {armed ? '● MASTER — IN CONTROL' : '○ TAKE CONTROL'}
          </Text>
          <Text
            style={{
              fontFamily: 'Inter_400Regular',
              fontSize: 9,
              color: armed ? C.onPrimary : C.icon,
              marginTop: 1,
            }}
          >
            {armed ? 'tap to release the rig' : 'panel is off — nothing writes'}
          </Text>
        </TouchableOpacity>

        <View
          style={{
            paddingVertical: 6,
            paddingHorizontal: 12,
            borderRadius: 999,
            borderWidth: 1,
            borderColor: isConnected ? C.tertiary : C.error,
          }}
        >
          <Text
            style={{
              fontFamily: 'SpaceGrotesk_700Bold',
              fontSize: 10,
              letterSpacing: 1,
              color: isConnected ? C.tertiary : C.error,
            }}
          >
            {isConnected === null ? 'CONNECTING' : isConnected ? '● LIVE' : '● OFFLINE'}
          </Text>
        </View>
      </View>

      {isConnected === false && (
        <View
          style={{
            marginHorizontal: 20,
            marginBottom: 8,
            padding: 14,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: C.error,
            backgroundColor: C.errorContainer,
          }}
        >
          <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 13, color: C.error }}>
            ENGINE OFFLINE
          </Text>
          <Text
            style={{ fontFamily: 'Inter_400Regular', fontSize: 12, color: C.error, marginTop: 4 }}
          >
            {connectionError || 'Cannot reach MarsinEngine. Check the Config tab for IP settings.'}
          </Text>
        </View>
      )}

      {!armed && (
        <View
          style={{
            marginHorizontal: 20,
            marginBottom: 8,
            padding: 12,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: C.ghostBorder,
            backgroundColor: C.surfaceContainerLow,
          }}
        >
          <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 12, color: C.secondary }}>
            TOUCH CONTROL IS OFF — every control below is inert and nothing is written to the rig.
            Tap TAKE CONTROL to make this panel the master.
          </Text>
        </View>
      )}

      {planLocked && !leaseHeld && (
        <View
          style={{
            marginHorizontal: 20,
            marginBottom: 8,
            padding: 12,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: C.secondary,
            backgroundColor: C.surfaceContainerLow,
          }}
        >
          <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 12, color: C.secondary }}>
            A PLAN IS DRIVING THE RIG — controls are read-only until you take over.
          </Text>
        </View>
      )}

      {/* Content region. The PATTERNS sheet overlays THIS, not the whole tab,
          so the header — and specifically the ARM switch the sheet tells you
          to press — stays visible and usable while browsing. */}
      <View style={{ flex: 1 }}>
      {isWide ? (
        <View style={{ flex: 1, flexDirection: 'row' }}>
          <View style={{ flex: 1, borderRightWidth: 1, borderRightColor: C.ghostBorder }}>
            {colorPanel}
          </View>
          <View style={{ flex: 1 }}>{motionPanel}</View>
        </View>
      ) : (
        // Narrow: one page-level scroll. Never a same-axis ScrollView nested
        // inside another — that collapsed a deck column to zero height once.
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 32 }}>
          <View style={{ minHeight: 520 }}>{colorPanel}</View>
          <View style={{ minHeight: 560, borderTopWidth: 1, borderTopColor: C.ghostBorder }}>
            {motionPanel}
          </View>
        </ScrollView>
      )}

      {/* Effects span BOTH panels, so the row lives at the bottom of the whole
          tab rather than inside either one — consistent with this tab's rule
          that buttons sit at the bottom, without crowding a panel's own row. */}
      <EffectsBar slots={effectSlots} onToggle={handleEffectToggle} disabled={disabled} />

      {/* Overlays the panels rather than taking a third column, so the two
          pads keep their full size on an iPad. */}
      {patternsOpen && (
        <PatternList
          names={patternNames}
          activePattern={activePatternName}
          pendingPattern={pendingPattern}
          loading={patternsLoading}
          error={patternsError}
          disabled={disabled}
          onSelect={handleSelectPattern}
          onRefresh={refreshPatterns}
          onClose={() => setPatternsOpen(false)}
        />
      )}
      </View>
    </View>
  );
}
