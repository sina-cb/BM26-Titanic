/**
 * ColorsWindow — the body of the Deck workspace's COLORS window
 * (contract: docs/53_deck_workspace_windows.md §4 two-colour select, §5 PALETTE
 * TURNS; interaction spec: the operator-approved prototype
 * docs/ui/color_palette_prototype.html, report _199).
 *
 * MOUNT CONTRACT (set by slice A, agent _208 — do not move it): this module
 * path, the `ColorsWindow` export name, and the `disabled` prop. The deck
 * screen mounts exactly one `<ColorsWindow>` inside `<DeckWindow id="colors">`,
 * inside the same SectionHost the PARAMETERS / AUTOPILOT columns use.
 *
 * WHAT IS REAL HERE, AND WHAT IS A PREVIEW — stated up front because a lighting
 * surface that blurs the two is a lie:
 *
 *   REAL (writes the rig): the two slots ARE the engine's CPC params
 *   `colorPalette1` / `colorPalette2`. Every edit — wheel drag, Live Touch
 *   chip, saved pair, show palette — goes out as ONE atomic `/param-center`
 *   POST of both slots, throttled to 33 Hz during a drag, and the engine slews
 *   the change over `colorTransitionMs` (docs/36). The handles also MOVE when
 *   another surface changes the palette (picker modal, QUEUE, Live Touch, a
 *   plan cue), because a control that does not reflect the rig is lying.
 *
 *   REAL (writes the engine): PALETTE TURNS posts a colour-autopilot config
 *   whose five entries are inline {c1,c2} pairs. The rotation then runs in the
 *   ENGINE's existing ColorAutopilot daemon — it survives an iPad sleep, an app
 *   kill and a tab close, and it is the single hue writer while it runs.
 *
 *   REAL (writes the engine): the CROSSFADE card too, as of docs/55 §2.2. It
 *   is the SAME daemon at ring length 2 — `[(A,B),(B,A)]`, fading over
 *   `transitionMs`, with `delay_s: 0` for the continuous triangle the operator
 *   approved in the prototype. The `_211` local preview loop is RETIRED: there
 *   is no `setInterval`/rAF anywhere in this file, because a tab clock driving
 *   the rig is the deadman-gap failure class the design rejects (docs/53 §5.2)
 *   and a tab clock NOT driving the rig is a picture that can disagree with it.
 *
 * THE GLASS SHOWS THE SHIP. The wash strip, the PAR strip, the blend readout
 * and the wheel handles all derive from the BROADCAST `colorPalette1/2` — the
 * engine's tween frames arrive on the throttled sharedParams broadcast, so the
 * card animates from truth with no local animation clock at all. STOP freezes
 * in place because the engine's `_cancelTween` abandons without writing.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, type DimensionValue } from 'react-native';

import { usePalette } from '@/hooks/use-theme';
import { useSharedParamValues } from '@/hooks/useEngineState';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { HorizontalFader } from '@/components/ui/HorizontalFader';
import { TimerPillBar, SwapCountdown } from '@/components/DeckTransitionControls';
import { DualSwatch } from '@/components/ColorPickerModal';
import { HueWheel } from '@/components/deck/hue_wheel';
import { PresetIcon } from '@/components/ui/preset_icon';
import {
  COLORS_MODE_BUTTON_STYLE,
  COLORS_MODE_HEADER_STYLE,
  COLORS_MODE_LABEL_STYLE,
  COLORS_MODE_RAIL_STYLE,
  COLORS_WINDOW_BOUNDARY_STYLE,
} from '@/components/deck/colors_window_layout';
import {
  getCachedColorPalettes, warmColorPalettesCache,
  updateParamCenter, fetchColorPairs, fetchColorPaletteVisibility, saveColorPairs,
} from '@/utils/api';
import type { DeckColorAutopilotConfig } from '@/utils/api';
import { opError, opPrompt } from '@/utils/op_dialog';
import {
  type Hsv, type SchemeId, type PairChannel, type SchemePairSel,
  type RotationCursor, type PalettePreset,
  colour, pinned, hueCss, hsvCss, mixHsv, degrees,
  LIVE_TOUCH_SWATCHES, slotIndexFor, pairIsLive, type LiveTouchSwatch,
  lerpHue, blendFromBroadcast, blendLabel,
  isTurnsConfig, turnsOrbit, rotationCursor, cursorRailSegments,
  orbitPhase, orbitDistance, orbitWindowSlots, ORBIT_DISTANCE_DEFAULT,
  turnsAutopilotPatch, manualWriteGate,
  paletteWritePayload, normalizeColorPairs, addPalettePreset, removeColorPairAt,
  buildPalettePreset, presetIconColours, presetLabel, presetDescription, PRESET_NAME_MAX,
  TURNS_SLOT_COUNT, COLOR_PAIRS_MAX,
  SCHEME_IDS, SCHEME_TITLES, generateScheme,
  SCHEME_PAIR_DEFAULT, PAIR_CHANNEL_LABELS, selectSchemePair, schemePairColours,
  rotationKind, schemeTapOutcome, crossfadeAutopilotPatch, hueOf,
  type ColorsCard, cardForKind, yieldDecision, YIELD_SAY, YIELD_FAIL_SAY,
  drivingStripModel, takeoverNote,
  ROTATION_HOLD_PRESETS_S, ROTATION_FADE_PRESETS_S,
  followNoteAutopilotPatch, followNoteStateLine, toggleSchemeSubset,
  rotationRetunePatch, retunableLive, retuneTiming, RETUNE_TIMING_TAGS,
  FOLLOW_NOTE_DEFAULT_SCHEMES, METHOD_HOLD_PRESETS_S, METHOD_HOLD_DEFAULT_S,
  METHOD_FADE_PRESETS_S, METHOD_FADE_DEFAULT_S,
  NOTE_FADE_PRESETS_MS, NOTE_FADE_DEFAULT_MS,
  type RetuneField,
} from '@/components/deck/colors_window_logic';
import { accentWash } from '@/styles/globalStyles';
import { filterCuratedColorPaletteMenu } from '@/components/color_preset_library';

// Live-apply throttle — the SAME 33 ms the COLORS picker modal uses, matched to
// the engine's sharedParams broadcast debounce.
const LIVE_THROTTLE_MS = 33;
// How long a local edit OWNS the slots before the broadcast is allowed to
// re-seed them. Without it, the echo of our own write (and any in-flight engine
// slew frames) fights the finger that is still on the wheel.
const LOCAL_SETTLE_MS = 700;
const PAR_COUNT = 15;
const RAMP_STOPS = 12;
// How long a refusal / confirmation line stays up before it clears itself.
const MESSAGE_MS = 4000;
// A scheme tap flashes its button for this long — Live Touch's 260 ms, so the
// momentary "it fired" acknowledgement reads identically on both surfaces.
const SCHEME_FLASH_MS = 260;

type Mode = ColorsCard;

// StyleSheet.absoluteFillObject, inlined so this file imports one fewer symbol.
const ABSOLUTE_FILL = { position: 'absolute' as const, left: 0, right: 0, top: 0, bottom: 0 };

// ── _279 RENDER-COST CONSTANTS ────────────────────────────────────────────
// Frozen module-level values, so a prop that never varies also never changes
// IDENTITY. A fresh `[]` or `['A','B']` on every render defeats the `React.memo`
// bail-outs below just as surely as a real change would.
const NO_STRIP: string[] = [];
const PAIR_WHEEL_LABELS: string[] = ['A', 'B'];
const TURNS_WHEEL_LABELS: string[] = ['1', '2', '3', '4', '5'];

export interface ColorsWindowProps {
  /** Offline or under the soft PLAN lock — every control renders read-only
   *  (the PlanLockScrim also blankets it while a plan is driving). */
  disabled?: boolean;
  /** The LIVE colour-autopilot config, straight off the deck screen's
   *  `colorAutopilot` /ws/control reconcile. Drives the single-writer gate and
   *  the PALETTE TURNS state display. */
  colorAutopilot?: DeckColorAutopilotConfig;
  /** The deck screen's `handleColorAutopilotChange` (optimistic + rollback +
   *  broadcast reconcile). The ONLY way this window changes engine autopilot
   *  state — it never posts to /deck/color-autopilot itself. The optional
   *  `failNote` (docs/61 §2.1) is a narration override the YIELD/STOP paths
   *  pass so a rejected bare-stop POST surfaces `YIELD_FAIL_SAY` instead of
   *  the deck screen's generic rollback sentence. */
  onColorAutopilotChange?: (patch: Partial<DeckColorAutopilotConfig>, failNote?: string) => void;
  /** LIVE RETUNE (docs/59 §5.2): PATCH one field of the RUNNING rotation
   *  instead of re-POSTing the whole config. A POST is a full replace — it
   *  restarts the rotation under the operator's finger — so every pill that
   *  can move while something is running routes here instead. */
  onColorAutopilotRetune?: (patch: Record<string, unknown>) => void;
  /** The deck workspace's `isOpen('colors')` — the COLORS window is never
   *  unmounted (`display:'none'`, `_208`), so this is the only signal a
   *  false→true transition (§4.3 entry auto-select) can read. Defaults to
   *  `true` so a caller that does not yet pass it behaves exactly as before
   *  (auto-select fires once, on mount). */
  visible?: boolean;
  /** Reports the visible card upward on every change — mode-button taps, the
   *  §4.3 entry auto-select — so a wave-C listener (workspace hide, tab blur)
   *  can drive `yieldDecision` with the SAME card this window is showing. */
  onCardChange?: (card: ColorsCard) => void;
}

export function ColorsWindow({
  disabled = false, colorAutopilot, onColorAutopilotChange, onColorAutopilotRetune,
  visible = true, onCardChange,
}: ColorsWindowProps) {
  const C = usePalette();

  // ── The two engine slots (live) ───────────────────────────────────────
  const shared = useSharedParamValues({
    colorPalette1: { h: 0, s: 1, v: 1 } as Hsv,
    colorPalette2: { h: 0.5, s: 1, v: 1 } as Hsv,
    colorTransitionMs: 800,
    // FOLLOW NOTE's silence sentence (docs/59 §8). It changes what the card
    // SAYS, never what the rig does: the companion holds the last committed
    // note through silence and the method cycle keeps breathing on that held
    // hue. Hold-with-a-sentence is the only behaviour compatible with the
    // no-fallback rule, so the sentence IS the feature.
    audioSilence: 0,
  }) as { colorPalette1: Hsv; colorPalette2: Hsv; colorTransitionMs: number; audioSilence: number };
  const engineH1 = typeof shared.colorPalette1?.h === 'number' ? shared.colorPalette1.h : 0;
  const engineH2 = typeof shared.colorPalette2?.h === 'number' ? shared.colorPalette2.h : 0.5;

  const [h1, setH1] = useState(engineH1);
  const [h2, setH2] = useState(engineH2);
  // Until this wall-clock ms, the LOCAL value wins over the broadcast: the
  // operator's finger outranks the echo of their own write.
  const settleUntilRef = useRef(0);
  useEffect(() => {
    if (Date.now() < settleUntilRef.current) return;
    setH1(engineH1);
    setH2(engineH2);
  }, [engineH1, engineH2]);

  const slots: Hsv[] = useMemo(() => [colour(h1, 1, 1), colour(h2, 1, 1)], [h1, h2]);

  /**
   * THE LIVE SLOT VALUES, MIRRORED FOR EVENT HANDLERS (_279).
   *
   * `h1`/`h2` track the broadcast, so while a colour autopilot tweens they
   * change ~25 times a second. Any `useCallback` that closed over them got a
   * fresh identity just as often — and `setSlot` did, which made
   * `loadIntoArmed`, `loadPair` and the dial's own handlers churn too, so every
   * memoized child below would have re-rendered on every engine frame anyway.
   *
   * Handlers read the CURRENT values here instead. `pairSurface` is only known
   * in the render section, so the write happens there (the same
   * assign-during-render idiom `hue_wheel.tsx` uses for its `stateRef`); every
   * reader is an event handler, which by definition runs after that render.
   */
  const liveRef = useRef({ pairSurface: true, h1: engineH1, h2: engineH2 });

  // ── Mode + armed slot ─────────────────────────────────────────────────
  const [mode, setMode] = useState<Mode>('two');
  const [armedTwo, setArmedTwo] = useState(0);
  const [armedTurn, setArmedTurn] = useState(0);
  const [message, setMessage] = useState<{ text: string; warn: boolean } | null>(null);
  const messageTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const say = useCallback((text: string, warn = false) => {
    if (messageTimer.current) clearTimeout(messageTimer.current);
    setMessage(text ? { text, warn } : null);
    if (text) messageTimer.current = setTimeout(() => setMessage(null), MESSAGE_MS);
  }, []);
  useEffect(() => () => { if (messageTimer.current) clearTimeout(messageTimer.current); }, []);

  // ── SINGLE-WRITER GATE (docs/53 §4.4) ─────────────────────────────────
  // While the colour-autopilot daemon is active its ticks OWN colorPalette1/2.
  // A manual write would fight it between ticks, so the two-colour surface goes
  // read-only with ONE explicit affordance — pausing an autopilot is an engine
  // state change and must be a deliberate operator act, never a silent
  // auto-pause underneath them.
  const rotationDriving = !!colorAutopilot?.active;
  // WHAT the daemon is running, not just THAT it is: the §2.6 interaction table
  // needs to tell a 2-entry crossfade from a five-colour ring from a library
  // palette set, and `active` alone cannot.
  const kind = rotationKind(colorAutopilot?.active, colorAutopilot?.palettes, colorAutopilot?.mode);

  // ── ENTRY AUTO-SELECT (docs/61 §4.3, D6) ────────────────────────────────
  // A FALSE→TRUE `visible` transition (mount with `visible===true` counts,
  // because `wasVisibleRef` starts `false`) ARMS a one-shot. It does NOT fire
  // by itself — on a COLD OPEN the window mounts before the deck screen's
  // `colorAutopilot` has been seeded from the engine, so `kind` is
  // momentarily 'none' and `cardForKind(kind)` is null right at the
  // transition. Instead the one-shot stays armed and FIRES on the first
  // later render where `cardForKind(kind) !== null` — the render the
  // broadcast's first usable truth arrives on — then disarms. `goCard` also
  // disarms it the moment the operator picks a card himself, so a broadcast
  // landing after that can never yank the selection out from under him.
  // Nothing re-arms it until the NEXT false→true transition: one entry
  // episode, one auto-select. GUARD: once disarmed, a later broadcast change
  // never moves the selection — only the strip.
  const wasVisibleRef = useRef(false);
  const armedRef = useRef(false);
  useEffect(() => {
    if (visible && !wasVisibleRef.current) armedRef.current = true;
    wasVisibleRef.current = visible;
    if (armedRef.current) {
      const card = cardForKind(kind);
      if (card !== null) {
        armedRef.current = false;
        setMode(card);
        onCardChange?.(card);
      }
    }
  }, [visible, kind, onCardChange]);

  // ── L1 YIELD ON THE MODE CARDS (docs/61 §2.1) ───────────────────────────
  // Every ModeButton routes through here instead of `setMode` directly. The
  // navigation ALWAYS completes — `setMode` runs regardless of the yield
  // POST's outcome — because yield is fire-with-narration, never a
  // navigation gate (§2.1 mechanics).
  const goCard = useCallback((next: Mode) => {
    // §4.3 D6: ANY deliberate tap on the mode selector retires the entry
    // one-shot for this visibility episode — including a tap on the card
    // already showing. Disarming must happen BEFORE the same-card early
    // return below, or a parked operator who never moves off his card (or
    // taps the one he's already on) leaves the one-shot armed forever, and a
    // family that arms itself later (another surface, a timeline cue) yanks
    // his selection out from under him. RESIDUAL, and it is intended §4.3
    // behaviour: if the operator never touches the mode selector at all, the
    // one-shot stays live and a remotely-armed family DOES select its own
    // card — §4.3 asks this window to show what is running until a tap pins
    // the operator's choice.
    armedRef.current = false;
    if (next === mode) return;
    const d = yieldDecision({ gesture: 'card', leavingCard: mode, kind, disabled });
    if (d.yield && d.post) {
      if (onColorAutopilotChange) { onColorAutopilotChange(d.post, YIELD_FAIL_SAY); say(d.say); }
      else say('Engine autopilot control is not wired here.', true);
    }
    setMode(next);
    onCardChange?.(next);
  }, [mode, kind, disabled, onColorAutopilotChange, onCardChange, say]);

  // ── THE DRIVING STRIP (docs/61 §4.1) ────────────────────────────────────
  const stripModel = drivingStripModel(kind, mode, {
    palettes: colorAutopilot?.palettes,
    delay_s: colorAutopilot?.delay_s,
    transitionMs: colorAutopilot?.transitionMs,
    notePc: colorAutopilot?.notePc,
    currentScheme: colorAutopilot?.currentScheme,
  });
  const onStripStop = useCallback(() => {
    if (!onColorAutopilotChange) { say('Engine autopilot control is not wired here.', true); return; }
    if (kind === 'follow-note') {
      // The strip's STOP on a remote-armed follow-note card is the SAME bare
      // stop the §2.1 yield rule posts, so it shares its narration pair.
      onColorAutopilotChange({ active: false }, YIELD_FAIL_SAY);
      say(YIELD_SAY);
      return;
    }
    onColorAutopilotChange({ active: false });
    say('Rotation paused — the colours are yours again.');
  }, [onColorAutopilotChange, kind, say]);

  // ── The atomic, throttled engine write ────────────────────────────────
  const throttleRef = useRef<{ last: number; timer: ReturnType<typeof setTimeout> | null; pending: [number, number] | null }>(
    { last: 0, timer: null, pending: null },
  );
  useEffect(() => () => { if (throttleRef.current.timer) clearTimeout(throttleRef.current.timer); }, []);

  const writeNow = useCallback((a: number, b: number) => {
    settleUntilRef.current = Date.now() + LOCAL_SETTLE_MS;
    void updateParamCenter(paletteWritePayload(a, b));
  }, []);

  /** Leading + trailing throttle so the LAST drag frame always lands. */
  const writeThrottled = useCallback((a: number, b: number) => {
    const t = throttleRef.current;
    t.pending = [a, b];
    const now = Date.now();
    const remaining = LIVE_THROTTLE_MS - (now - t.last);
    if (remaining <= 0) {
      t.last = now;
      writeNow(a, b);
    } else if (!t.timer) {
      t.timer = setTimeout(() => {
        t.last = Date.now();
        t.timer = null;
        if (t.pending) writeNow(t.pending[0], t.pending[1]);
      }, remaining);
    }
  }, [writeNow]);

  /** Set ONE slot and write BOTH (the unarmed slot keeps its value). */
  const setSlot = useCallback((index: number, hue: number, throttled = true) => {
    // The UNARMED slot's current value comes from `liveRef`, not from a
    // closure: closing over `h1`/`h2` gave this callback — and every callback
    // built on it — a new identity on every broadcast frame (_279). Same
    // values, read a moment later.
    const { h1: cur1, h2: cur2 } = liveRef.current;
    const a = index === 0 ? hue : cur1;
    const b = index === 1 ? hue : cur2;
    settleUntilRef.current = Date.now() + LOCAL_SETTLE_MS;
    if (index === 0) setH1(hue); else setH2(hue);
    if (throttled) writeThrottled(a, b); else writeNow(a, b);
  }, [writeThrottled, writeNow]);

  const setBothSlots = useCallback((a: number, b: number) => {
    settleUntilRef.current = Date.now() + LOCAL_SETTLE_MS;
    setH1(a);
    setH2(b);
    writeNow(a, b);
  }, [writeNow]);

  // The gate itself is a pure, unit-tested function, so "TURNS is running →
  // manual writes are refused, visibly" is a rule the suite checks rather than
  // a condition buried in a handler.
  const gate = manualWriteGate(disabled, kind);
  const refuse = useCallback(() => {
    const g = manualWriteGate(disabled, kind);
    if (!g.canWrite) say(g.reason, true);
  }, [kind, disabled, say]);

  /**
   * SEND A RETUNE. While the matching family is running the moved field goes
   * out as a sparse PATCH — cadence, phase and the in-flight fade all survive.
   * When nothing (or a different family) is running the value is staged
   * locally and the START button carries it, which is exactly the behaviour
   * the pills have always had.
   */
  const retune = useCallback((field: RetuneField, value: unknown) => {
    if (!retunableLive(kind, field)) return;
    if (!onColorAutopilotRetune) { say('Engine autopilot control is not wired here.', true); return; }
    onColorAutopilotRetune(rotationRetunePatch(kind, { [field]: value }));
  }, [kind, onColorAutopilotRetune, say]);


  // ── ONE SHARED TRANSPORT (_224 order 1) ───────────────────────────────
  // "the turning ... needs to happen on the same timescale as the two color
  // crossfader" / "use the same fade time out and interval as the two color".
  // So FADE and HOLD are ONE pair of values here, rendered as the same two pill
  // rows on both cards and posted as `transitionMs` / `delay_s` by both. The
  // old TURN EVERY cadence and its derived 25 % fade are gone: a derived fade
  // was a second opinion the surface could not show, and two timing models for
  // one daemon is exactly the drift the operator was looking at.
  const [fadeS, setFadeS] = useState(0.8);
  const [holdS, setHoldS] = useState(0); // 0 = CONT, the operator's prototype feel

  // LIVE RETUNE for the shared rows (docs/59 §5.2, the operator's follow-up
  // order: *"changing of the parameters for those existing ones too doesn't
  // need a full stop and start again"*). While the ring the pills describe is
  // RUNNING, the moved value goes out as a sparse PATCH — the daemon keeps its
  // generation, its tween and its phase — instead of the full POST that used to
  // restart the rotation under the operator's finger. Parked, or with a
  // different family running, the pills stage exactly as they always have.
  const onRingFade = useCallback((v: number) => { setFadeS(v); retune('transitionMs', Math.round(v * 1000)); }, [retune]);
  const onRingHold = useCallback((v: number) => { setHoldS(v); retune('delay_s', v); }, [retune]);

  // ── FOLLOW NOTE (docs/59) ─────────────────────────────────────────────
  // A THIRD rotation family on the SAME daemon: the live detected note drives
  // the base hue, and the scheme generator applied to it cycles on its own
  // timer. Mutual exclusion with TURNS / crossfade is by construction — one
  // daemon, one mode — so there is no second "is it running" flag here.
  //
  // Its two rows are deliberately NOT the shared transport above: that one is
  // the PAIR cadence (seconds-scale), this is a MOOD cadence (minutes-scale),
  // and folding them together would put 1 s method thrash one tap away.
  const [fnSchemes, setFnSchemes] = useState<SchemeId[]>([...FOLLOW_NOTE_DEFAULT_SCHEMES]);
  const [methodHoldS, setMethodHoldS] = useState(METHOD_HOLD_DEFAULT_S);
  const [methodFadeS, setMethodFadeS] = useState(METHOD_FADE_DEFAULT_S);
  const [noteFadeMs, setNoteFadeMs] = useState(NOTE_FADE_DEFAULT_MS);
  const followLive = kind === 'follow-note';

  // ADOPT the engine's block whenever it has one — running OR parked-but-stored
  // (the daemon carries the follow-note block inert through palettes mode, so a
  // mode toggle round-trips the operator's tuning rather than resetting it).
  const liveFollow = colorAutopilot?.followNote;
  useEffect(() => {
    if (!liveFollow) return;
    if (Array.isArray(liveFollow.schemes) && liveFollow.schemes.length > 0) {
      setFnSchemes(liveFollow.schemes as SchemeId[]);
    }
    if (typeof liveFollow.methodHoldS === 'number' && liveFollow.methodHoldS >= 0) setMethodHoldS(liveFollow.methodHoldS);
    if (typeof liveFollow.methodFadeS === 'number' && liveFollow.methodFadeS > 0) setMethodFadeS(liveFollow.methodFadeS);
    if (typeof liveFollow.noteFadeMs === 'number' && liveFollow.noteFadeMs >= 0) setNoteFadeMs(liveFollow.noteFadeMs);
  }, [liveFollow]);

  // WHICH TWO of the derived ring feed A and B. Indices, not colours (the
  // `_224` rule) — and here that is not a nicety but the only thing that could
  // work: the ring re-generates on every note, so a selection stored as a
  // colour would stop matching anything the instant the music moved.
  const [followSel, setFollowSel] = useState<SchemePairSel>(SCHEME_PAIR_DEFAULT);
  const liveFollowSel = liveFollow?.sel;
  useEffect(() => {
    if (Array.isArray(liveFollowSel) && liveFollowSel.length === 2) {
      setFollowSel([liveFollowSel[0], liveFollowSel[1]]);
    }
  }, [liveFollowSel]);

  /**
   * THE RING THE RIG IS CHOOSING FROM, re-derived here from the broadcast
   * method + note hue through the SAME generators the engine runs — pinned
   * byte-for-byte by the shared reference table (docs/59 §3). Empty until the
   * broadcast carries a usable pair, because a ring drawn from a guessed hue
   * would be a picture of nothing.
   */
  const liveScheme = colorAutopilot?.currentScheme;
  const liveNoteHue = colorAutopilot?.noteHue;
  const followRing = useMemo<Hsv[]>(() => {
    if (!followLive) return [];
    if (typeof liveScheme !== 'string' || !(SCHEME_IDS as readonly string[]).includes(liveScheme)) return [];
    if (typeof liveNoteHue !== 'number' || !Number.isFinite(liveNoteHue) || liveNoteHue < 0 || liveNoteHue > 1) return [];
    return generateScheme(liveScheme as SchemeId, liveNoteHue);
  }, [followLive, liveScheme, liveNoteHue]);

  /** Pick which ring slot feeds the ARMED channel — the window's existing
   *  arm-then-tap grammar, retuned LIVE so the rig follows the pick. */
  const onPickFollowSlot = useCallback((index: number) => {
    const channel = armedTwo as PairChannel;
    const res = selectSchemePair(followSel, channel, index, followRing.length || TURNS_SLOT_COUNT);
    if (!res.ok) { say(res.reason, true); return; }
    setFollowSel(res.sel);
    if (followLive) retune('sel', res.sel);
    say(`COLOUR ${PAIR_CHANNEL_LABELS[channel]} is now T${index + 1}.`);
  }, [armedTwo, followSel, followRing.length, followLive, retune, say]);

  /** Toggle one generator in the cycle. Emptying it is REFUSED with the
   *  sentence the engine's validator would also produce — the operator can
   *  reach that state with one tap, so it must not be a silent no-op. */
  const onToggleMethod = useCallback((id: SchemeId) => {
    const res = toggleSchemeSubset(fnSchemes, id);
    if (!res.ok) { say(res.reason, true); return; }
    setFnSchemes(res.schemes);
    if (followLive) retune('schemes', res.schemes);
  }, [fnSchemes, followLive, retune, say]);

  const onMethodHold = useCallback((v: number) => { setMethodHoldS(v); if (followLive) retune('methodHoldS', v); }, [followLive, retune]);
  const onMethodFade = useCallback((v: number) => { setMethodFadeS(v); if (followLive) retune('methodFadeS', v); }, [followLive, retune]);
  const onNoteFade = useCallback((v: number) => { setNoteFadeMs(v); if (followLive) retune('noteFadeMs', v); }, [followLive, retune]);

  const startFollowNote = useCallback(() => {
    if (!onColorAutopilotChange) { say('Engine autopilot control is not wired here.', true); return; }
    if (disabled) { refuse(); return; }
    // §5 row 1 — the takeover message names the loser. Captured BEFORE the
    // POST: the loser is whatever WAS running the instant this START fired.
    const prevKind = kind;
    // The builder mirrors the engine's validator refusal for refusal, so an
    // impossible cycle shows its sentence here instead of coming back as a 400.
    try {
      onColorAutopilotChange(followNoteAutopilotPatch({
        schemes: fnSchemes, methodHoldS, methodFadeS, noteFadeMs, sel: followSel,
      }) as unknown as Partial<DeckColorAutopilotConfig>);
    } catch (e: any) {
      say(e?.message || String(e), true);
      return;
    }
    const base = methodHoldS === 0
      ? 'Following the note in the engine, morphing between methods continuously.'
      : `Following the note in the engine, a new method every ${methodHoldS}s.`;
    const note = takeoverNote(prevKind, 'follow-note');
    say(note ? `${base} ${note}` : base);
  }, [onColorAutopilotChange, disabled, kind, fnSchemes, methodHoldS, methodFadeS, noteFadeMs, followSel, refuse, say]);

  // ── PALETTE TURNS draft ───────────────────────────────────────────────
  // A DRAFT, not engine state, until START. Seeded from the window's own five
  // Live Touch samples — the same five chips the presets pane shows — so the
  // ring is never empty and there is no "unset colour" to invent a value for.
  // The draft is FULL COLOURS now, not hues (D2): a HUE scheme is one hue at
  // five brightnesses, and a hue-only draft could not hold it.
  const [turnDraft, setTurnDraft] = useState<Hsv[]>(
    () => LIVE_TOUCH_SWATCHES.slice(0, TURNS_SLOT_COUNT).map((s) => colour(s.c.h, 1, 1)),
  );

  // WHICH TWO of the five feed A and B (_224 order 3), and — since the orbit —
  // the SHAPE OF THE RING ITSELF: the pair's index distance is the width of the
  // window that travels, and COLOUR A's slot is where the travelling starts.
  // Stored as RING INDICES, so a wheel re-theme carries the operator's choice
  // forward: slots 2+4 stay slots 2+4 in the regenerated palette. Default 1+2 —
  // Live Touch's ENGINE-backed pair, distance 1, which is the adjacent ring
  // TURNS has always run. Declared HERE rather than beside the scheme row
  // because START TURNS below reads it.
  const [pairSel, setPairSel] = useState<SchemePairSel>(SCHEME_PAIR_DEFAULT);

  // A LIVE turns ring on the engine is the visible truth: adopt it so the window
  // shows what the rig is actually rotating, not a stale local draft. A 2-entry
  // CROSSFADE ring is deliberately NOT adopted into the DRAFT — it is the other
  // card's config and would overwrite the five-slot ring with two colours the
  // operator did not pick for TURNS.
  const livePalettes = colorAutopilot?.palettes;
  const turnsLive = kind === 'turns';
  const liveOrbit = useMemo(() => (turnsLive ? turnsOrbit(livePalettes) : null), [turnsLive, livePalettes]);
  const liveRing = useMemo(() => liveOrbit?.ring ?? [], [liveOrbit]);
  const liveDistance = liveOrbit?.distance ?? ORBIT_DISTANCE_DEFAULT;
  // WHERE the wire's ring starts inside the staged one. The ring is posted
  // beginning at COLOUR A, so a non-default pick puts a ROTATION of the five
  // staged colours on the wire; recovering the phase is what keeps the
  // operator's T1..T5 numbering steady while the rail and the state line still
  // read the wire. null = the engine is rotating different colours entirely.
  const ringPhase = useMemo(
    () => (liveRing.length === TURNS_SLOT_COUNT ? orbitPhase(turnDraft, liveRing) : null),
    [turnDraft, liveRing],
  );
  useEffect(() => {
    if (liveRing.length !== TURNS_SLOT_COUNT) return;
    // A phase means the wire is THIS ring, merely started at a different slot —
    // adopting it would renumber the staged five under the operator's fingers
    // for no gain. Only genuinely different colours are adopted.
    if (ringPhase !== null) return;
    setTurnDraft(liveRing);
  }, [liveRing, ringPhase]);

  // The TIMING, however, IS adopted from either ring — it is one transport now,
  // so the pills must show what the daemon is actually running whichever card
  // started it. `delay_s: 0` is CONT and must be adopted like any other value:
  // the old `> 0` test here would have quietly refused to display the
  // operator's own continuous mode.
  const ringLive = kind === 'turns' || kind === 'crossfade';
  const liveDelay = colorAutopilot?.delay_s;
  const liveTransitionMs = colorAutopilot?.transitionMs;
  useEffect(() => {
    if (!ringLive) return;
    if (typeof liveDelay === 'number' && Number.isFinite(liveDelay) && liveDelay >= 0) setHoldS(liveDelay);
    if (typeof liveTransitionMs === 'number' && Number.isFinite(liveTransitionMs) && liveTransitionMs > 0) {
      setFadeS(liveTransitionMs / 1000);
    }
  }, [ringLive, liveDelay, liveTransitionMs]);

  /** Set ONE draft slot's HUE, keeping its saturation/brightness — dragging a
   *  HUE ring's third slot must not silently blow its brightness back to 1. */
  const setTurnSlot = useCallback((index: number, hue: number) => {
    setTurnDraft((prev) => prev.map((c, i) => (i === index ? colour(hue, c.s, c.v) : c)));
  }, []);

  const startTurns = useCallback(() => {
    if (!onColorAutopilotChange) { say('Engine autopilot control is not wired here.', true); return; }
    if (disabled) { refuse(); return; }
    // §5 row 1 — the takeover message names the loser, captured BEFORE the POST.
    const prevKind = kind;
    onColorAutopilotChange(turnsAutopilotPatch(turnDraft, holdS, fadeS, pairSel));
    const base = holdS === 0
      ? `Sliding through ${TURNS_SLOT_COUNT} colours continuously, ${fadeS}s a step, in the engine.`
      : `Sliding through ${TURNS_SLOT_COUNT} colours every ${holdS}s, ${fadeS}s a step, in the engine.`;
    // Name the ORBIT whenever it is not the adjacent one — the operator picked a
    // spacing and the sentence should confirm which pair is travelling.
    const d = orbitDistance(pairSel, TURNS_SLOT_COUNT);
    const span = d === ORBIT_DISTANCE_DEFAULT
      ? ''
      : ` T${pairSel[0] + 1}+T${pairSel[1] + 1} orbit right together, ${d} slots apart.`;
    const note = takeoverNote(prevKind, 'turns');
    say([`${base}${span}`, note].filter(Boolean).join(' '));
  }, [onColorAutopilotChange, disabled, kind, holdS, fadeS, turnDraft, pairSel, refuse, say]);

  const stopRotation = useCallback(() => {
    if (!onColorAutopilotChange) { say('Engine autopilot control is not wired here.', true); return; }
    onColorAutopilotChange({ active: false });
    say('Rotation paused — the colours are yours again.');
  }, [onColorAutopilotChange, say]);

  // ── CROSSFADE — DRIVES THE RIG (docs/55 §2.2) ─────────────────────────
  // No local clock. RUN posts a 2-entry chained ring to the ENGINE daemon; the
  // card's picture is derived from the broadcast slots, which move because the
  // engine's tween is writing them. Its FADE and HOLD are the shared transport
  // declared above — the same two values PALETTE TURNS runs on.
  const crossfadeLive = kind === 'crossfade';
  // C4 fix (docs/61 §5/§6): under FOLLOW NOTE, `endA/endB` fall back to the
  // daemon's OWN moving outputs (no 2-entry ring exists to read endpoints
  // from), so the blend ramp and scrubber are structurally meaningless — a
  // control drawn live but describing nothing. The TWO COLOUR card renders
  // them inert whenever the daemon is running that family, regardless of
  // which card is on screen (the strip names the cause).
  const followInert = kind === 'follow-note';

  // The ENDPOINTS of the crossfade: pair 0 of the live crossfade config when
  // one exists (a STOPPED config stays in the broadcast, so the scrubber keeps
  // its track), else the live A/B slots.
  const [endA, endB] = useMemo<[number, number]>(() => {
    const p = colorAutopilot?.palettes;
    if (Array.isArray(p) && p.length === 2 && isTurnsConfig(p)) {
      const first = p[0] as { c1: number | Hsv; c2: number | Hsv };
      return [hueOf(first.c1), hueOf(first.c2)];
    }
    return [h1, h2];
  }, [colorAutopilot?.palettes, h1, h2]);

  // WHERE THE RIG IS, read off the broadcast. null = the live palette is not on
  // the A→B arc at all, which the card says with "—" rather than a confident
  // wrong number.
  const blend = useMemo(() => blendFromBroadcast(endA, endB, engineH1), [endA, endB, engineH1]);

  // The picture: both live slots, straight from the broadcast. During an engine
  // tween these move every frame, so the strip animates from TRUTH.
  const liveC1 = shared.colorPalette1 && typeof shared.colorPalette1.h === 'number'
    ? shared.colorPalette1 : colour(engineH1, 1, 1);
  const liveC2 = shared.colorPalette2 && typeof shared.colorPalette2.h === 'number'
    ? shared.colorPalette2 : colour(engineH2, 1, 1);
  const washCss = hsvCss(liveC1);
  // BOTH STRIPS BELONG TO THE TWO COLOUR CARD (the `isTwo` branch in the
  // render). Their inputs are the LIVE broadcast slots, so while a colour
  // autopilot is tweening they changed on every engine frame — and _279 found
  // them rebuilding 27 colour strings ~25 times a second while PALETTE TURNS
  // was the visible card and neither strip was mounted at all. Deriving them
  // only for the card that draws them is not a shortcut: it is the same values
  // for the same picture, computed when that picture exists.
  const showPairStrips = mode === 'two';
  const parColours = useMemo(() => {
    if (!showPairStrips) return NO_STRIP;
    // The two slots spread ACROSS the rig — what patterns do with
    // colorPalette1/2. Both ends are live, so a fade travels the strip.
    const out: string[] = [];
    for (let i = 0; i < PAR_COUNT; i++) out.push(mixHsv(liveC1, liveC2, i / (PAR_COUNT - 1)));
    return out;
  }, [showPairStrips, liveC1, liveC2]);
  const rampStops = useMemo(() => {
    if (!showPairStrips) return NO_STRIP;
    const A = colour(endA, 1, 1);
    const B = colour(endB, 1, 1);
    const out: string[] = [];
    for (let i = 0; i < RAMP_STOPS; i++) out.push(mixHsv(A, B, i / (RAMP_STOPS - 1)));
    return out;
  }, [showPairStrips, endA, endB]);

  // ── THE SLIDING WINDOW (_224 order 2) ─────────────────────────────────
  // Which adjacent pair the engine's rotation is on, and how far through the
  // fade toward it — INVERTED from the broadcast palette, never clocked here.
  // It advances only when engine tween frames arrive, so the highlight slides
  // in step with the rig and stops the instant the rig does (deadman rule,
  // docs/53 §5.2).
  const cursor = useMemo(
    () => (ringLive ? rotationCursor(livePalettes, liveC1, liveC2) : null),
    [ringLive, livePalettes, liveC1, liveC2],
  );

  /**
   * BLEND SCRUB — gated, finger-driven manual writes. The deadman rule is
   * satisfied because nothing writes when the finger stops: this is the wheel's
   * existing throttled-drag recipe, not an autonomous clock. Because the write
   * uses the SAME `lerpHue` as the engine tween (D1), a frozen fade position
   * round-trips exactly to the scrubbed value.
   */
  const onScrub = useCallback((t: number) => {
    const g = manualWriteGate(disabled, kind);
    if (!g.canWrite) { say(g.reason, true); return; }
    const a = lerpHue(endA, endB, t);
    const b = lerpHue(endB, endA, t);
    setH1(a);
    setH2(b);
    writeThrottled(a, b);
  }, [disabled, kind, endA, endB, writeThrottled, say]);

  const runCrossfade = useCallback(() => {
    if (!onColorAutopilotChange) { say('Engine autopilot control is not wired here.', true); return; }
    if (disabled) { refuse(); return; }
    // §5 row 1 — the takeover message names the loser, captured BEFORE the POST.
    const prevKind = kind;
    onColorAutopilotChange(crossfadeAutopilotPatch(endA, endB, holdS, fadeS));
    const base = holdS === 0
      ? `Crossfading ${degrees(endA)}° ↔ ${degrees(endB)}° continuously in the engine.`
      : `Crossfading ${degrees(endA)}° ↔ ${degrees(endB)}° every ${holdS}s in the engine.`;
    const note = takeoverNote(prevKind, 'crossfade');
    say(note ? `${base} ${note}` : base);
  }, [onColorAutopilotChange, disabled, kind, endA, endB, holdS, fadeS, refuse, say]);

  // ── Saved PALETTES (scene-owned, shared by every iPad) ────────────────
  // The `_211` SAVE PAIR gallery, widened by `_242` to hold whole palettes:
  // every entry still carries the A/B pair it puts on the rig (so a v1 file
  // loads unchanged), and an entry saved with a ring also carries the five
  // staged colours, which two of them feed A and B, and the latched scheme.
  const [pairs, setPairs] = useState<PalettePreset[]>([]);
  const [pairsLoaded, setPairsLoaded] = useState(false);
  // A load failure is a STANDING condition, not a flash: the auto-clearing
  // message line would leave the gallery looking like "you have saved nothing"
  // when the truth is "we could not ask". This holds the reason on screen.
  const [pairsError, setPairsError] = useState<string | null>(null);
  const [pairsEditing, setPairsEditing] = useState(false);

  const loadPairs = useCallback(async () => {
    const res = await fetchColorPairs();
    if (!res.ok) {
      // P0 — say so. A gallery that silently shows nothing is indistinguishable
      // from a gallery the operator never saved into.
      setPairsLoaded(true);
      setPairsError(res.error || 'engine unreachable');
      return;
    }
    // `normalizeColorPairs` THROWS on a shape it does not understand (a
    // schemaVersion from a newer build, a half-written ring). That is the point
    // — it surfaces here as a standing error rather than as a gallery quietly
    // missing the palettes it could not read.
    try {
      setPairs(normalizeColorPairs(res.data));
      setPairsError(null);
    } catch (e: any) {
      setPairsError(e?.message || String(e));
    }
    setPairsLoaded(true);
  }, []);

  useEffect(() => { void loadPairs(); }, [loadPairs]);

  const persistPairs = useCallback(async (next: PalettePreset[], okMessage: string) => {
    const previous = pairs;
    setPairs(next);
    const res = await saveColorPairs(next);
    if (!res.ok) {
      setPairs(previous);
      say(`Not saved: ${res.error || 'engine unreachable'}. Reverted.`, true);
      return;
    }
    setPairsError(null);
    setPairs(normalizeColorPairs(res.data));
    say(okMessage);
  }, [pairs, say]);

  const onDeletePair = useCallback((index: number) => {
    void persistPairs(removeColorPairAt(pairs, index), 'Deleted.');
  }, [pairs, persistPairs]);

  // ── Show palette (the curated config.yaml library) ────────────────────
  const [showLibrary, setShowLibrary] = useState(false);
  const [hiddenLibraryIds, setHiddenLibraryIds] = useState<string[]>([]);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [, setLibVersion] = useState(0);
  useEffect(() => {
    let alive = true;
    void Promise.all([warmColorPalettesCache(), fetchColorPaletteVisibility()]).then(([, visibility]) => {
      if (!alive) return;
      if (!visibility.ok) {
        setLibraryError(visibility.error || 'palette visibility unavailable');
        return;
      }
      setHiddenLibraryIds(visibility.data?.hiddenPaletteIds ?? []);
      setLibraryError(null);
      setLibVersion((v) => v + 1);
    });
    return () => { alive = false; };
  }, []);
  const library = filterCuratedColorPaletteMenu(getCachedColorPalettes(), hiddenLibraryIds);

  // ── SCHEME GENERATORS (docs/55 §2.1) ──────────────────────────────────
  // A tap is MOMENTARY: it paints the five colours, flashes for 260 ms and
  // LATCHES. The latch is what makes a later wheel drag re-theme the whole
  // ring, exactly like Live Touch's applyWheel → groupSchemeSync.
  //
  // DEVIATION from Live Touch, deliberate (docs/55 §2.1): the latched scheme
  // wears the quiet accentWash on-state instead of being invisible. On the
  // Deck the latch has visible consequences — one wheel drag re-themes five
  // slots and (gate permitting) the rig — and an invisible mode that repaints
  // things is a trap. Grammar preserved, visibility added.
  //
  // THE LATCH CARRIES ITS BASE (_224). It used to be a bare `SchemeId`, with the
  // base hue re-derived from the armed slot on every read. That is circular once
  // A and B are themselves scheme slots: arming COLOUR B to pick B's slot moved
  // the base to B's hue, the ring re-themed underneath the pick, and A and B
  // could collapse onto ONE colour. A latch is a scheme AND the hue it was
  // generated from — two values that must never disagree, so they are one piece
  // of state.
  const [latched, setLatched] = useState<{ scheme: SchemeId; base: number } | null>(null);
  const [flashing, setFlashing] = useState<SchemeId | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (flashTimer.current) clearTimeout(flashTimer.current); }, []);

  // (`pairSel` — which two of the five feed A and B, and therefore the orbit's
  // spacing and start — is declared up with the TURNS draft, because START
  // TURNS reads it. COMPLEMENT still puts its far edge in slot 2 so the default
  // 1+2 pick lands on it.)

  /**
   * The base hue the scheme row generates from: the LATCH's base while one is
   * latched, else the ARMED slot's hue — the same hue the wheel is editing
   * (docs/55 §2.1). Freezing it to the latch is what makes A/B selection stable:
   * switching CONTRAST → TRIADIC keeps the operator's hue instead of jumping to
   * whichever slot happens to be armed, and only a WHEEL DRAG re-bases.
   */
  const baseHue = latched ? latched.base : (mode !== 'turns'
    ? (armedTwo === 0 ? h1 : h2)
    : (turnDraft[armedTurn]?.h ?? h1));

  /**
   * THE NINE SCHEME FACES, generated once per BASE HUE (_279).
   *
   * `generateScheme` used to run nine times inside the JSX, i.e. on every
   * render — and while a colour autopilot is tweening, the window renders at
   * the engine's broadcast rate. That rebuilt nine five-colour rings (45
   * swatch views) ~25 times a second to draw a row that only changes when the
   * operator moves the base hue. In PALETTE TURNS the base is the armed STAGED
   * slot, which no broadcast touches, so this row is now completely static
   * while the rig turns.
   */
  const schemeFaces = useMemo(
    () => SCHEME_IDS.map((id) => ({
      id, title: SCHEME_TITLES[id], colours: generateScheme(id, baseHue),
    })),
    [baseHue],
  );

  /**
   * Stage a scheme's five colours and do whatever §2.6 says for the rotation
   * that is currently running. `announce` is off for the wheel-drag re-theme
   * (a drag would otherwise spam the message line every frame).
   */
  const applyScheme = useCallback((scheme: SchemeId, base: number, sel: SchemePairSel, announce = true) => {
    const colours = generateScheme(scheme, base);
    setTurnDraft(colours);
    const title = SCHEME_TITLES[scheme];
    // C3 fix (docs/61 §5): the surface the operator tapped FROM decides the
    // outcome too, not just the engine kind — a COMPLEMENT tap on the TWO
    // COLOUR card while FOLLOW NOTE drives from its own card must stage only,
    // never silently PATCH the daemon's method.
    const outcome = schemeTapOutcome(
      rotationKind(colorAutopilot?.active, colorAutopilot?.palettes, colorAutopilot?.mode), title, mode);
    if (outcome.action === 'method-override') {
      // FOLLOW NOTE (docs/59 6). The tap does NOT restage a ring - there is no
      // ring to restage, the engine derives it from the note - it sets the
      // daemon's CURRENT METHOD through the daemon's own front door. The
      // crossfade to the tapped generator runs over the cycle's own
      // methodFadeS, so on the rig it is indistinguishable from a timer-driven
      // advance, which is exactly what it should look like.
      if (onColorAutopilotRetune) {
        onColorAutopilotRetune(rotationRetunePatch('follow-note', { method: scheme }));
        if (announce) say(outcome.message);
      } else if (announce) {
        say('Engine autopilot control is not wired here.', true);
      }
      return;
    }
    if (outcome.action === 'restage') {
      // ONE-TAP RESTAGE: a config write through the daemon's own front door, so
      // the daemon stays the single palette writer throughout. Cadence and
      // fade are kept; the engine's setState re-cycles cleanly and the next
      // fade ramps from wherever the rig currently is.
      if (onColorAutopilotChange) {
        // The restage carries the SELECTION, so the ring the daemon adopts is
        // the operator's pair at their spacing, starting on the pair already
        // lit — a cursor-resetting setState then plays that pair first and the
        // rig moves to the pick instead of jumping past it.
        onColorAutopilotChange(turnsAutopilotPatch(colours, holdS, fadeS, sel));
        if (announce) say(outcome.message);
      } else if (announce) {
        say('Engine autopilot control is not wired here.', true);
      }
      return;
    }
    if (outcome.action === 'stage-only') {
      // NEVER a silent auto-pause: name the button that would take over.
      if (announce) say(outcome.message, true);
      return;
    }
    // stage-and-write: A/B take the SELECTED two of the five as PINNED hues
    // (default slots 1+2, `_224` order 3). The two-colour surface keeps its
    // docs/36 S=V=1 pin — full HSV rides only in the rotation ring, so the pin
    // caption on the face stays true.
    const g = manualWriteGate(disabled, kind);
    if (!g.canWrite) { if (announce) say(g.reason, true); return; }
    const [a, b] = schemePairColours(colours, sel);
    setBothSlots(a.h, b.h);
    if (announce) say(outcome.message);
  }, [colorAutopilot?.active, colorAutopilot?.palettes, colorAutopilot?.mode,
    onColorAutopilotChange, onColorAutopilotRetune, holdS, fadeS,
    disabled, kind, mode, setBothSlots, say]);

  const onSchemeTap = useCallback((scheme: SchemeId) => {
    setLatched({ scheme, base: baseHue });
    setFlashing(scheme);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlashing(null), SCHEME_FLASH_MS);
    applyScheme(scheme, baseHue, pairSel);
  }, [applyScheme, baseHue, pairSel]);

  /**
   * PICK WHICH SLOT FEEDS THE ARMED CHANNEL (_224 order 3). The gesture is the
   * window's existing arm-then-tap grammar: COLOUR A / COLOUR B arm, a tap on a
   * scheme slot assigns it. The new selection is applied IMMEDIATELY through
   * the ordinary scheme path, so the rig follows the pick and every refusal
   * (rotation driving, offline, both channels on one slot) carries its sentence.
   */
  const onPickPairSlot = useCallback((index: number) => {
    if (!latched) return;
    const channel = armedTwo as PairChannel;
    const res = selectSchemePair(pairSel, channel, index);
    if (!res.ok) { say(res.reason, true); return; }
    // The SELECTION is the operator's local choice and is recorded either way —
    // what the gate can refuse is the WRITE. Refusing both would lose the pick
    // silently the moment the rotation stopped.
    setPairSel(res.sel);
    const g = manualWriteGate(disabled, kind);
    if (!g.canWrite) { say(g.reason, true); return; }
    // The LATCH's own base, never the armed slot's hue: A and B are scheme
    // slots now, so reading the base back off one of them would re-theme the
    // ring underneath the very pick being made.
    applyScheme(latched.scheme, latched.base, res.sel, false);
    say(`COLOUR ${PAIR_CHANNEL_LABELS[channel]} is now T${index + 1}.`);
  }, [latched, armedTwo, pairSel, applyScheme, disabled, kind, say]);

  // ── Load helpers shared by every preset surface ───────────────────────
  // Loading ANY non-scheme selection clears the latch: the ring is then no
  // longer the scheme, and keeping the latch would re-theme a ring the
  // operator just personalised on the next wheel drag.
  const loadIntoArmed = useCallback((c: Hsv) => {
    if (!gate.canWrite) { refuse(); return; }
    setLatched(null);
    setPairSel(SCHEME_PAIR_DEFAULT);
    const p = pinned(c);
    if (mode !== 'turns') setSlot(armedTwo, p.h, false);
    else setTurnSlot(armedTurn, p.h);
  }, [gate.canWrite, refuse, mode, armedTwo, armedTurn, setSlot, setTurnSlot]);

  const loadPair = useCallback((c1: number, c2: number) => {
    if (!gate.canWrite) { refuse(); return; }
    setLatched(null);
    setPairSel(SCHEME_PAIR_DEFAULT);
    if (mode !== 'turns') { setBothSlots(c1, c2); return; }
    // TURNS: fill the armed slot and the one after it, then step on — three
    // taps fill all five and both hues of a pair stay reachable (prototype
    // behaviour, stated on the face of the pane rather than discovered).
    const next = (armedTurn + 1) % TURNS_SLOT_COUNT;
    setTurnDraft((prev) => prev.map((v, i) => (
      i === armedTurn ? colour(c1, 1, 1) : i === next ? colour(c2, 1, 1) : v)));
    setArmedTurn((armedTurn + 2) % TURNS_SLOT_COUNT);
  }, [gate.canWrite, refuse, mode, armedTurn, setBothSlots]);

  // ── SAVE A PALETTE (_242 orders 2 + 4) ────────────────────────────────
  //
  // "add feature to store the colors as preset palettes" / "when storing
  // generate the icon and ask for a name too - by default accept an empty name
  // too for no name on the screen".
  //
  // WHAT GETS CAPTURED is decided by `buildPalettePreset`, not by this handler:
  // always the A/B pair, plus the five staged colours and their A/B selection
  // whenever there IS a ring worth keeping (TURNS mode, or a latched scheme in
  // two-colour mode), plus the latch itself so a recalled palette still
  // re-themes on a dial turn exactly as it did when it was saved.
  //
  // The NAME is asked for through the app's own themed dialog — never
  // `Alert.alert` (a silent no-op on the web build the podium runs) and never
  // `window.alert`. The card shows the GENERATED ICON while asking, so the
  // operator names the thing while looking at it. An empty answer is accepted
  // and stored as no name at all; only CANCEL abandons the save.
  const onSavePreset = useCallback(async () => {
    const ring = (mode === 'turns' || latched) ? turnDraft : undefined;
    const draft = buildPalettePreset({
      c1: h1, c2: h2, name: '',
      ring,
      sel: ring ? pairSel : undefined,
      latch: latched,
    });
    // Refuse BEFORE asking for a name: making the operator type a label for a
    // save that was never going to land is the rudest possible ordering.
    const probe = addPalettePreset(pairs, draft);
    if (!probe.ok) { say(probe.reason, true); return; }
    let name: string | null;
    try {
      name = await opPrompt({
        title: 'Name this palette',
        message: ring
          ? `${ring.length} colours, with A and B on T${pairSel[0] + 1} and T${pairSel[1] + 1}. Leave the name empty to save it unnamed.`
          : `${degrees(h1)}° and ${degrees(h2)}°. Leave the name empty to save it unnamed.`,
        placeholder: 'unnamed',
        maxLength: PRESET_NAME_MAX,
        submitLabel: 'SAVE',
        swatches: presetIconColours(draft),
      });
    } catch (e: any) {
      // The dialog host is mounted app-wide; if it is not, saying so is the
      // only honest move — silently saving under no name would hide the bug.
      opError('Could not ask for a name', e?.message || String(e));
      return;
    }
    if (name === null) { say('Save cancelled.'); return; }
    const res = addPalettePreset(pairs, { ...draft, ...(name.trim() ? { name: name.trim() } : {}) });
    if (!res.ok) { say(res.reason, true); return; }
    void persistPairs(res.presets, name.trim()
      ? `Saved "${name.trim()}" — every iPad has it.`
      : 'Saved unnamed — every iPad has it.');
  }, [mode, latched, turnDraft, pairSel, h1, h2, pairs, persistPairs, say]);

  /**
   * RECALL a saved palette. A bare pair behaves exactly as it always has (the
   * `loadPair` path). A palette WITH a ring restores the whole staged state in
   * one go — the five colours, which two feed A and B, and the latch — because
   * restoring only the pair would leave the operator looking at a scheme row
   * that no longer describes what is on the rig.
   */
  const loadPreset = useCallback((p: PalettePreset) => {
    if (!p.ring || !p.sel) { loadPair(p.c1, p.c2); return; }
    if (!gate.canWrite) { refuse(); return; }
    setTurnDraft(p.ring.map((c) => colour(c.h, c.s, c.v)));
    setPairSel([p.sel[0], p.sel[1]]);
    setLatched(p.scheme !== undefined && p.base !== undefined
      ? { scheme: p.scheme, base: p.base }
      : null);
    setBothSlots(p.c1, p.c2);
    say(`Loaded ${presetDescription(p)}.`);
  }, [loadPair, gate.canWrite, refuse, setBothSlots, say]);

  /**
   * WHEEL PICK. While a scheme is LATCHED the drag re-runs the scheme from the
   * new base hue, re-theming the whole staged ring (Live Touch's applyWheel →
   * groupSchemeSync). Otherwise it is the ordinary per-slot edit.
   */
  const onWheelPick = useCallback((i: number, hue: number) => {
    if (latched) {
      // A drag IS the re-base — the latch follows the finger (Live Touch's
      // applyWheel → groupSchemeSync), and the whole staged ring re-themes.
      setLatched({ scheme: latched.scheme, base: hue });
      applyScheme(latched.scheme, hue, pairSel, false);
      return;
    }
    if (mode !== 'turns') setSlot(i, hue); else setTurnSlot(i, hue);
  }, [latched, applyScheme, pairSel, mode, setSlot, setTurnSlot]);

  /** ARM a dial handle. Identity depends on the CARD, not on any live value. */
  const onWheelArm = useCallback((i: number) => {
    if (mode === 'two') setArmedTwo(i); else setArmedTurn(i);
  }, [mode]);
  /** Flush the drag's final value. Reads the hues at RELEASE time out of the
   *  ref, which is fresher than a render-time closure would have been. */
  const onWheelDragEnd = useCallback(() => {
    const s = liveRef.current;
    if (s.pairSurface) writeNow(s.h1, s.h2);
  }, [writeNow]);

  // ── Render ────────────────────────────────────────────────────────────
  const isTwo = mode === 'two';
  const isTurns = mode === 'turns';
  const isFollow = mode === 'follow';
  // THE WHEEL SHOWS A/B in both two-colour and FOLLOW NOTE mode: the dial stays
  // the manual base-hue editor everywhere, and in follow mode the ring belongs
  // to the music, not to five staged slots. Only PALETTE TURNS puts the
  // five-slot ring on the wheel.
  const pairSurface = !isTurns;
  // _279: each side memoized SEPARATELY, so the branch that is not on screen
  // cannot churn the branch that is. In PALETTE TURNS the dial's five handles
  // come from the STAGED draft, which a broadcast never moves — so `turnHues`
  // holds its identity across every engine frame and the memoized dial (90 ring
  // arcs + a `<G>` per handle) skips them all. In TWO COLOUR the dial follows
  // the rig, so `pairHues` legitimately changes per frame and the dial redraws:
  // that is the behaviour, unchanged.
  const pairHues = useMemo(() => [h1, h2], [h1, h2]);
  const turnHues = useMemo(() => turnDraft.map((c) => c.h), [turnDraft]);
  const wheelHues = pairSurface ? pairHues : turnHues;
  const wheelLabels = pairSurface ? PAIR_WHEEL_LABELS : TURNS_WHEEL_LABELS;
  const armed = pairSurface ? armedTwo : armedTurn;
  // The dial's handlers, read out of a ref at gesture time rather than closed
  // over per render — the SAME stale-closure discipline `hue_wheel.tsx` uses
  // internally. `onDragEnd` closing over `h1`/`h2` directly would have given the
  // dial a fresh prop on every broadcast frame and defeated its memo.
  liveRef.current = { pairSurface, h1, h2 };
  // The list the Live Touch chips compare their hue against for the A/B/T
  // badge. The TURNS side used to be rebuilt INSIDE the chip loop — one fresh
  // five-colour array per chip per render (_279).
  const turnPins = useMemo(() => turnDraft.map((c) => colour(c.h, 1, 1)), [turnDraft]);
  const swatchCompare = pairSurface ? slots : turnPins;
  // The live WINDOW, in STAGED slot numbers: pair `cursor.index` puts COLOUR A
  // on `phase + index` and COLOUR B `liveDistance` slots along, so those two
  // light. null when the rig is not on the ring, or when the engine is rotating
  // a ring that is not the staged five at all.
  const litWindow = useMemo(
    () => (turnsLive && cursor && ringPhase !== null
      ? orbitWindowSlots(cursor.index, liveDistance, ringPhase, TURNS_SLOT_COUNT)
      : null),
    [turnsLive, cursor, liveDistance, ringPhase],
  );
  const litIndex = litWindow ? litWindow[0] : -1;
  const litNext = litWindow ? litWindow[1] : -1;
  // While a scheme is latched, the two-colour surface shows the five staged
  // colours so the operator can pick WHICH TWO feed A and B (_224 order 3).
  const showSchemeSlots = isTwo && latched !== null;

  const label = (t: string, color = C.secondary) => (
    <Text style={{
      fontFamily: 'SpaceGrotesk_700Bold', fontSize: 9, letterSpacing: 1.2,
      color, textTransform: 'uppercase',
    }}>{t}</Text>
  );

  return (
    <View style={{
      ...COLORS_WINDOW_BOUNDARY_STYLE,
      backgroundColor: C.surfaceContainerLowest, borderRadius: 12,
      padding: 12, borderWidth: 1, borderColor: C.ghostBorder, gap: 10,
      opacity: disabled ? 0.55 : 1,
    }}>
      {/* ── Header: identity + mode toggle ───────────────────────────── */}
      <View style={COLORS_MODE_HEADER_STYLE}>
        {label('Colors', C.primary)}
        <View style={[COLORS_MODE_RAIL_STYLE, { backgroundColor: C.surfaceContainerHigh }]}>
          <ModeButton label="Two colour" active={isTwo} onPress={() => goCard('two')} />
          <ModeButton label="Palette turns" active={isTurns} onPress={() => goCard('turns')} />
          <ModeButton label="Follow note" active={isFollow} onPress={() => goCard('follow')} />
        </View>
      </View>

      {/* ── The DRIVING STRIP (docs/61 §4.1) ─────────────────────────────
          Replaces the old single-writer banner. 100 % broadcast-derived —
          `drivingStripModel` decides `show` from kind × visible card, so a
          rejected STOP simply leaves this showing the truth (ZERO optimistic
          hiding, no local "stopped" state anywhere near it). */}
      {stripModel.show ? (
        <View
          testID="colors-driving-strip"
          style={{
            flexDirection: 'row', alignItems: 'center', gap: 8,
            paddingHorizontal: 10, paddingVertical: 10, borderRadius: 8,
            borderWidth: 1, borderColor: C.primary, backgroundColor: C.surfaceContainerHigh,
          }}
        >
          <Text style={{ color: C.primary, fontSize: 14 }}>◉</Text>
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 11, color: C.primary, letterSpacing: 0.5 }}>
              {stripModel.title}
            </Text>
            <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 10, color: C.secondary }}>
              {stripModel.detail}
            </Text>
          </View>
          <TouchableOpacity
            testID="colors-driving-stop"
            onPress={onStripStop}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel={`Stop ${stripModel.title.toLowerCase()}`}
            style={{
              paddingHorizontal: 12, paddingVertical: 7, borderRadius: 6,
              backgroundColor: C.primary, opacity: disabled ? 0.4 : 1,
            }}
          >
            <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10, letterSpacing: 0.6, color: '#FFF' }}>
              STOP
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {/* ── The wheel ────────────────────────────────────────────────── */}
      <View style={{ alignItems: 'center', gap: 8 }}>
        <HueWheel
          size={190}
          hues={wheelHues}
          labels={wheelLabels}
          armed={armed}
          onArm={onWheelArm}
          onPick={onWheelPick}
          // While a scheme is latched the dial steers the LATCH'S BASE, not the
          // armed slot: a turn re-generates all five colours from it. Telling
          // the dial that is what keeps it jump-free when A is not ring slot 1.
          dialValue={latched ? latched.base : undefined}
          onDragEnd={onWheelDragEnd}
          readOnly={pairSurface ? !gate.canWrite : disabled}
          onRefused={refuse}
          handleStroke={C.ghostBorder}
          armedStroke={C.primary}
          centerFill={C.surfaceContainerLowest}
          mutedText={C.text}
        />
        <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 10, color: C.icon, textAlign: 'center' }}>
          Turn the dial — grab anywhere and rotate; a tap changes nothing. Hue only:
          saturation and brightness stay at 100% (house policy).
        </Text>
      </View>

      {/* ── SCHEMES (docs/55 §2.1) ───────────────────────────────────────
          The four Live Touch generators, ported verbatim, directly BELOW the
          wheel and ABOVE the slots — visible in both modes, because they paint
          the same five colours either way. A horizontal pill row (the
          sanctioned TimerPillBar axis); no new vertical scroll surface. */}
      <View style={{ gap: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          {label('Schemes')}
          <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 10, color: C.icon }}>
            {latched
              ? `base ${degrees(baseHue)}°`
              : `from ${wheelLabels[armed]} · ${degrees(baseHue)}°`}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 5, flexWrap: 'wrap' }}>
          {schemeFaces.map((face) => (
            <SchemeButton
              key={face.id}
              id={face.id}
              title={face.title}
              colours={face.colours}
              latched={latched?.scheme === face.id}
              flashing={flashing === face.id}
              disabled={disabled}
              onPress={onSchemeTap}
            />
          ))}
        </View>
        <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 10, color: C.icon }}>
          {latched
            ? `${SCHEME_TITLES[latched.scheme]} is latched at ${degrees(latched.base)}° — dragging the wheel re-themes all five slots from the new hue.`
            : 'A tap paints the five TURNS slots from the armed hue. MASTER/HUE carry real brightness; A and B stay hue-only.'}
        </Text>
      </View>

      {/* ── Slots ────────────────────────────────────────────────────── */}
      {pairSurface ? (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {[0, 1].map((i) => (
            <SlotButton
              key={i}
              index={i}
              name={`COLOUR ${wheelLabels[i]}`}
              hue={i === 0 ? h1 : h2}
              armed={armedTwo === i}
              onPress={setArmedTwo}
            />
          ))}
        </View>
      ) : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {turnDraft.map((c, i) => (
            <SlotButton
              key={i}
              index={i}
              name={`T${i + 1}`}
              hue={c.h}
              // The TRUE staged colour, not the hue at full brightness: a HUE
              // scheme's brightness ramp must be visible on the glass BEFORE it
              // ever reaches the rig.
              swatch={hsvCss(c)}
              armed={armedTurn === i}
              lit={i === litIndex || i === litNext}
              // WHICH TWO ARE THE ORBITING PAIR. Read-only here — the pick is
              // made with the arm-then-tap grammar on the TWO COLOUR card — but
              // the ring that plays has to be legible on the card that plays it.
              badge={pairSel[0] === i ? PAIR_CHANNEL_LABELS[0]
                : pairSel[1] === i ? PAIR_CHANNEL_LABELS[1] : null}
              compact
              onPress={setArmedTurn}
            />
          ))}
        </View>
      )}

      {/* ── The rotation's live WINDOW (_224 order 2) ────────────────────
          A 5-cell rail with the orbiting pair's two cells sitting exactly
          where the engine's cursor is: settled during the hold, sliding one
          slot right during the fade, keeping their spacing the whole way.
          Every frame of that slide comes from a broadcast palette — there is
          no clock in this file. */}
      {isTurns && turnsLive ? (
        <WindowRail
          cursor={cursor}
          ringLength={turnDraft.length}
          distance={liveDistance}
          phase={ringPhase}
        />
      ) : null}

      {/* ── WHICH TWO FEED A AND B (_224 order 3) ─────────────────────────
          Only while a scheme is latched: the five staged colours, with the
          two that are driving colorPalette1/2 badged. ARM A or B above, then
          tap a slot — the window's existing arm-then-tap grammar. */}
      {showSchemeSlots ? (
        <View style={{ gap: 4 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            {label('Scheme slots · pick A and B')}
            <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10, color: C.primary }}>
              {`A=T${pairSel[0] + 1} · B=T${pairSel[1] + 1}`}
            </Text>
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {turnDraft.map((c, i) => {
              const badge = pairSel[0] === i ? PAIR_CHANNEL_LABELS[0]
                : pairSel[1] === i ? PAIR_CHANNEL_LABELS[1] : null;
              return (
                <TouchableOpacity
                  key={i}
                  onPress={() => onPickPairSlot(i)}
                  disabled={disabled}
                  accessibilityRole="button"
                  accessibilityState={{ selected: badge !== null, disabled }}
                  accessibilityLabel={`Make T${i + 1} colour ${PAIR_CHANNEL_LABELS[armedTwo]}${badge ? `, currently colour ${badge}` : ''}`}
                  style={{
                    width: 52, paddingVertical: 6, paddingHorizontal: 4, borderRadius: 8, gap: 4,
                    alignItems: 'center',
                    borderWidth: badge ? 2 : 1,
                    borderColor: badge ? C.primary : C.ghostBorder,
                    backgroundColor: C.surface,
                    opacity: disabled ? 0.4 : 1,
                  }}
                >
                  <View style={{ width: 30, height: 18, borderRadius: 4, backgroundColor: hsvCss(c) }} />
                  <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 8, color: badge ? C.primary : C.icon }}>
                    {badge ?? `T${i + 1}`}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 10, color: C.icon }}>
            {`Tap a slot to make it COLOUR ${PAIR_CHANNEL_LABELS[armedTwo]} (arm the other above to change that one). The pick is by SLOT, so a wheel re-theme keeps it.`}
          </Text>
        </View>
      ) : null}

      {/* ── Mode transport ───────────────────────────────────────────── */}
      {isTwo ? (
        <View style={{ gap: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: C.ghostBorder }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            {label('Crossfade · drives the rig', crossfadeLive ? C.tertiary : C.secondary)}
            <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10, color: C.icon }}>
              {`ENGINE SLEW ${(Math.max(0, shared.colorTransitionMs || 0) / 1000).toFixed(1)}s`}
            </Text>
          </View>

          {/* WASH + PARS — DERIVED from the broadcast colorPalette1/2. There is
              no local clock: these move because the ENGINE's tween is writing
              the slots, so the glass shows the ship. */}
          <View style={{ height: 22, borderRadius: 6, backgroundColor: washCss, borderWidth: 1, borderColor: C.ghostBorder }} />
          <View style={{ flexDirection: 'row', gap: 2 }}>
            {parColours.map((css, i) => (
              <View key={i} style={{ flex: 1, height: 12, borderRadius: 3, backgroundColor: css }} />
            ))}
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <TouchableOpacity
              onPress={crossfadeLive ? stopRotation : runCrossfade}
              disabled={disabled}
              accessibilityRole="switch"
              accessibilityState={{ checked: crossfadeLive, disabled }}
              accessibilityLabel={crossfadeLive
                ? 'Stop the crossfade (the colours freeze where they are)'
                : 'Run the crossfade in the engine'}
              style={{
                flexDirection: 'row', alignItems: 'center', gap: 6,
                paddingHorizontal: 12, paddingVertical: 9, borderRadius: 6,
                backgroundColor: crossfadeLive ? C.primary : 'transparent',
                borderWidth: 1, borderColor: crossfadeLive ? 'transparent' : C.ghostBorder,
              }}
            >
              <IconSymbol name={crossfadeLive ? 'pause.fill' : 'play.fill'} size={13} color={crossfadeLive ? '#FFF' : C.text} />
              <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 11, color: crossfadeLive ? '#FFF' : C.text }}>
                {crossfadeLive ? 'RUNNING' : 'RUN CROSSFADE'}
              </Text>
            </TouchableOpacity>
            <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10, color: C.icon, flexShrink: 1 }}>
              {`${degrees(endA)}° ↔ ${degrees(endB)}°`}
            </Text>
          </View>
          {/* THE SHARED TRANSPORT — the same two rows PALETTE TURNS runs on
              (_224 order 1). FADE gets its own FULL-WIDTH row: squeezed beside
              the CROSSFADE button in a flex-3 column, the pill bar's horizontal
              scroll hid half the presets behind an edge nobody would think to
              drag. */}
          <TransportTiming fadeS={fadeS} holdS={holdS} onFade={onRingFade} onHold={onRingHold} />
          <LiveTimingLine show={ringLive} holdS={holdS} fadeS={fadeS} />
          <RetuneLine show={ringLive} fields={['delay_s', 'transitionMs']} />

          {/* BLEND POSITION — the track IS the fade it scrubs, and the thumb
              sits where the RIG is (derived from the broadcast). */}
          <View style={{ gap: 4 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              {label('Blend position')}
              <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10, color: C.text }}>
                {followInert ? '—' : blend === null ? '—' : blendLabel(blend)}
              </Text>
            </View>
            <View style={{ height: 24, borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: C.ghostBorder }}>
              {followInert ? (
                // C4 (docs/61 §6): a single flat track, no moving pseudo-ramp
                // and no mounted fader — there is no 2-entry ring for a thumb
                // to chase while the music is picking the hue.
                <View style={{ ...ABSOLUTE_FILL, backgroundColor: C.surfaceContainerHigh }} />
              ) : (
                <>
                  <View style={{ ...ABSOLUTE_FILL, flexDirection: 'row' }}>
                    {rampStops.map((css, i) => (
                      <View key={i} style={{ flex: 1, backgroundColor: css }} />
                    ))}
                  </View>
                  <HorizontalFader
                    value={blend ?? 0}
                    onChange={onScrub}
                    trackStyle={{ ...ABSOLUTE_FILL, backgroundColor: 'transparent' }}
                    fillStyle={{ position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: 'transparent' }}
                    thumbStyle={{ width: 4, top: 0, bottom: 0, marginLeft: -2, backgroundColor: C.text, borderRadius: 2 }}
                  />
                </>
              )}
            </View>
          </View>
          {followInert ? (
            <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 10, color: C.secondary }}>
              FOLLOW NOTE is driving — the blend has no endpoints while the music picks the hue.
            </Text>
          ) : (
            <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 10, color: C.icon }}>
              {crossfadeLive
                ? 'Running in the ENGINE — it keeps going if this iPad sleeps. STOP freezes the colours exactly where they are.'
                : 'RUN posts a two-colour rotation to the ENGINE. Starting PALETTE TURNS replaces it, and vice versa — one daemon, one config.'}
            </Text>
          )}
        </View>
      ) : isTurns ? (
        <View style={{ gap: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: C.ghostBorder }}>
          {/* THE SAME TWO ROWS THE CROSSFADE CARD RUNS ON (_224 order 1) — one
              transport, one timescale. The old TURN EVERY cadence and its
              derived 25 % fade are gone. */}
          <TransportTiming fadeS={fadeS} holdS={holdS} onFade={onRingFade} onHold={onRingHold} />
          <LiveTimingLine show={ringLive} holdS={holdS} fadeS={fadeS} />
          <RetuneLine show={ringLive} fields={['delay_s', 'transitionMs']} />
          <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 10, color: C.icon }}>
            {holdS === 0
              ? `Continuous: the window slides on without pausing, ${fadeS}s a step (${(fadeS * TURNS_SLOT_COUNT).toFixed(1)}s a lap). `
              : `Each step holds ${holdS}s, then fades ${fadeS}s to the next pair (${((holdS + fadeS) * TURNS_SLOT_COUNT).toFixed(1)}s a lap). `}
            The rotation runs in the ENGINE — it keeps going if this iPad sleeps.
          </Text>
          {/* THE ORBIT (operator: "keep their distance, and rotate them in a
              window to the right, and then loop back"). The pair is picked with
              the arm-then-tap grammar on the TWO COLOUR card while a scheme is
              latched; this line states what that pick means HERE. */}
          <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 10, color: C.icon }}>
            {`COLOUR A is T${pairSel[0] + 1}, COLOUR B is T${pairSel[1] + 1} — ${orbitDistance(pairSel, TURNS_SLOT_COUNT)} slot(s) apart. `}
            Both step one slot right per turn and keep that distance, looping past T5 back to T1.
            {' '}Pick the two on the TWO COLOUR card with a scheme latched.
          </Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TouchableOpacity
              onPress={turnsLive ? stopRotation : startTurns}
              disabled={disabled}
              accessibilityRole="button"
              accessibilityState={{ disabled }}
              accessibilityLabel={turnsLive ? 'Stop the palette rotation' : 'Start the palette rotation'}
              style={{
                flex: 1, alignItems: 'center', paddingVertical: 11, borderRadius: 8,
                backgroundColor: turnsLive ? 'transparent' : C.primary,
                borderWidth: 1, borderColor: turnsLive ? C.primary : 'transparent',
              }}
            >
              <Text style={{
                fontFamily: 'SpaceGrotesk_700Bold', fontSize: 12, letterSpacing: 0.6,
                color: turnsLive ? C.primary : '#FFF',
              }}>
                {turnsLive ? 'STOP TURNS' : 'START TURNS'}
              </Text>
            </TouchableOpacity>
          </View>
          {turnsLive ? (
            <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 10, color: C.secondary }}>
              {cursor === null
                ? 'The rig is not on the ring — something else wrote the palette.'
                : litWindow === null
                  ? 'The engine is rotating a different ring than the five staged here.'
                  : cursor.t >= 1
                    ? `On the rig now: T${litIndex + 1} + T${litNext + 1}, holding.`
                    : `Sliding to T${litIndex + 1} + T${litNext + 1} — ${Math.round(cursor.t * 100)}% through.`}
            </Text>
          ) : null}
        </View>
      ) : (
        /* ── FOLLOW NOTE (docs/59 §7) ─────────────────────────────────────
           The third transport card. Every word of its state line and every
           colour in its ring comes off the BROADCAST — the note, the current
           method, the hue — so the card is a report of the rig, not a second
           opinion about it. The one thing that ticks is the countdown chip,
           which owns its own 1 Hz timer (the `_211` idiom) so a 60 s method
           hold does not re-render this whole window sixty times. */
        <View style={{ gap: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: C.ghostBorder }}>
          <View style={{
            flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
            flexWrap: 'wrap', rowGap: 4,
          }}>
            {label('Follow note · the music picks the hue', followLive ? C.tertiary : C.secondary)}
            {followLive ? <SwapCountdown targetMs={colorAutopilot?.nextMethodAtMs ?? null} /> : null}
          </View>

          <Text style={{
            fontFamily: 'SpaceGrotesk_700Bold', fontSize: 11, letterSpacing: 0.4,
            color: followLive ? C.primary : C.icon,
          }}>
            {followNoteStateLine({
              active: followLive,
              currentScheme: (colorAutopilot?.currentScheme as SchemeId | null) ?? null,
              schemes: fnSchemes,
              notePc: colorAutopilot?.notePc ?? null,
              audioSilence: shared.audioSilence,
            })}
          </Text>

          {/* THE LIVE RING, generated on the CLIENT from the broadcast method +
              note hue. The generators are parity-pinned byte-for-byte against
              the engine's port (docs/59 §3), so these five swatches ARE the
              five colours the rig is choosing from — not a lookalike of them.
              The selection is by SLOT, so it survives every re-theme the music
              causes, which is the exact property `_224` built it for. */}
          {followLive && followRing.length > 0 ? (
            <View style={{ gap: 4 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                {label('On the rig · pick A and B')}
                <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10, color: C.primary }}>
                  {`A=T${followSel[0] + 1} · B=T${followSel[1] + 1}`}
                </Text>
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {followRing.map((c, i) => {
                  const badge = followSel[0] === i ? PAIR_CHANNEL_LABELS[0]
                    : followSel[1] === i ? PAIR_CHANNEL_LABELS[1] : null;
                  return (
                    <TouchableOpacity
                      key={i}
                      onPress={() => onPickFollowSlot(i)}
                      disabled={disabled}
                      accessibilityRole="button"
                      accessibilityState={{ selected: badge !== null, disabled }}
                      accessibilityLabel={`Make T${i + 1} colour ${PAIR_CHANNEL_LABELS[armedTwo]}${badge ? `, currently colour ${badge}` : ''}`}
                      style={{
                        width: 52, paddingVertical: 6, paddingHorizontal: 4, borderRadius: 8, gap: 4,
                        alignItems: 'center',
                        borderWidth: badge ? 2 : 1,
                        borderColor: badge ? C.primary : C.ghostBorder,
                        backgroundColor: C.surface,
                        opacity: disabled ? 0.4 : 1,
                      }}
                    >
                      <View style={{ width: 30, height: 18, borderRadius: 4, backgroundColor: hsvCss(c) }} />
                      <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 8, color: badge ? C.primary : C.icon }}>
                        {badge ?? `T${i + 1}`}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          ) : null}

          {/* THE CYCLE SUBSET. Lit = in the cycle. MASTER and HUE ship OFF —
              they render the pair monochrome and the mission's first line is
              night visibility — but they are one tap away, because a
              monochrome beat is a legitimate choice, just a deliberate one. */}
          <View style={{ gap: 4 }}>
            {label(`Methods in the cycle · ${fnSchemes.length}/${SCHEME_IDS.length}`)}
            <View style={{ flexDirection: 'row', gap: 5, flexWrap: 'wrap' }}>
              {SCHEME_IDS.map((id) => (
                <MethodChip
                  key={id}
                  title={SCHEME_TITLES[id]}
                  on={fnSchemes.includes(id)}
                  running={followLive && colorAutopilot?.currentScheme === id}
                  disabled={disabled}
                  onPress={() => onToggleMethod(id)}
                />
              ))}
            </View>
          </View>

          <TimerPillBar
            label="Method hold · before the next generator"
            compact
            presets={[...METHOD_HOLD_PRESETS_S]}
            value={methodHoldS}
            onChange={onMethodHold}
            formatter={(v) => (v === 0 ? 'CONT' : v < 60 ? `${v}s` : `${v / 60}m`)}
          />
          <TimerPillBar
            label="Method fade · one generator into the next"
            compact
            presets={[...METHOD_FADE_PRESETS_S]}
            value={methodFadeS}
            onChange={onMethodFade}
            formatter={(v) => `${v}s`}
          />
          <TimerPillBar
            label="Note fade · when the note changes"
            compact
            presets={[...NOTE_FADE_PRESETS_MS]}
            value={noteFadeMs}
            onChange={onNoteFade}
            formatter={(v) => (v === 0 ? 'SNAP' : `${v / 1000}s`)}
          />
          <RetuneLine show={followLive} fields={['methodHoldS', 'methodFadeS']} />

          <TouchableOpacity
            onPress={followLive ? stopRotation : startFollowNote}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityState={{ disabled }}
            accessibilityLabel={followLive ? 'Stop following the note' : 'Start following the note'}
            style={{
              alignItems: 'center', paddingVertical: 11, borderRadius: 8,
              backgroundColor: followLive ? 'transparent' : C.primary,
              borderWidth: 1, borderColor: followLive ? C.primary : 'transparent',
            }}
          >
            <Text style={{
              fontFamily: 'SpaceGrotesk_700Bold', fontSize: 12, letterSpacing: 0.6,
              color: followLive ? C.primary : '#FFF',
            }}>
              {followLive ? 'STOP FOLLOW NOTE' : 'START FOLLOW NOTE'}
            </Text>
          </TouchableOpacity>

          <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 10, color: C.icon }}>
            {followLive
              ? 'Running in the ENGINE, off the audio companion’s committed note — it keeps going if this iPad sleeps. If the music stops, the last note is HELD and the methods keep cycling on it.'
              : 'START posts a follow-note rotation to the ENGINE: the note picks the base hue, and the lit methods above take turns generating the palette from it. Starting it replaces whatever rotation is running.'}
          </Text>
          {rotationDriving && !followLive ? (
            <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 10, color: C.secondary }}>
              {kind === 'turns'
                ? 'PALETTE TURNS is running. START FOLLOW NOTE replaces it.'
                : kind === 'crossfade'
                  ? 'The crossfade is running. START FOLLOW NOTE replaces it.'
                  : 'A palette-set rotation is running from the AUTOPILOT window. START FOLLOW NOTE replaces it.'}
            </Text>
          ) : null}
        </View>
      )}

      {/* ── Message line (refusals + confirmations, never silent) ─────── */}
      {message ? (
        <Text style={{
          fontFamily: 'Inter_400Regular', fontSize: 11,
          color: message.warn ? C.error : C.secondary,
        }}>{message.text}</Text>
      ) : null}

      {/* ══ PRESETS PANE ═════════════════════════════════════════════════
          A visually distinct second surface: at a glance it must read as
          RECALL, not EDIT. It only ever calls the load helpers above. */}
      <View style={{
        marginTop: 2, padding: 10, borderRadius: 10, gap: 10,
        backgroundColor: C.surfaceContainerLow, borderWidth: 1, borderColor: C.ghostBorder,
      }}>
        {/* 1. Live Touch samples — badges are DERIVED from the live slots. */}
        <View style={{ gap: 6 }}>
          {label('Colour samples · build A/B')}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {LIVE_TOUCH_SWATCHES.map((sw) => {
              // The badge asks "is this chip's HUE, pinned, one of the slots?" —
              // so a TURNS draft is compared at the pin, not at its own
              // brightness (a HUE ring's dim turns are still that hue).
              const idx = slotIndexFor(sw.c, swatchCompare);
              return (
                <SwatchChip
                  key={sw.hex}
                  swatch={sw}
                  badge={idx >= 0 ? wheelLabels[idx] : null}
                  armedLabel={wheelLabels[armed]}
                  onPress={loadIntoArmed}
                />
              );
            })}
          </View>
          <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 10, color: C.icon }}>
            {`COLOUR ${wheelLabels[armed]} is armed. Tap a sample to put it there, arm the other slot, choose its sample, then SAVE PALETTE. The saved pair appears in the main COLORS preset menu on every iPad.`}
          </Text>
        </View>

        {/* 2. Saved palettes — SCENE-owned, so a save reaches every iPad.
            Each chip wears its GENERATED icon: a wedge per colour, drawn from
            the entry's own colours (`presetIconColours`), so a five-colour
            palette is visibly a different kind of thing from a pair. The label
            is the operator's name when they gave one, and the two angles when
            they deliberately did not (_242 order 4). */}
        <View style={{ gap: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            {label(`Saved palettes · ${pairs.length}/${COLOR_PAIRS_MAX}`)}
            <View style={{ flexDirection: 'row', gap: 6 }}>
              <PaneButton label="SAVE PALETTE" onPress={() => { void onSavePreset(); }} disabled={disabled} />
              <PaneButton
                label={pairsEditing ? 'DONE' : 'EDIT'}
                active={pairsEditing}
                disabled={disabled || pairs.length === 0}
                onPress={() => {
                  setPairsEditing((v) => !v);
                  say(pairsEditing ? '' : 'Tap a palette to delete it.');
                }}
              />
            </View>
          </View>
          {pairs.length === 0 ? (
            <Text style={{
              fontFamily: 'Inter_400Regular', fontSize: 10, fontStyle: 'italic',
              color: pairsError ? C.error : C.icon,
            }}>
              {pairsError
                ? `Saved palettes unavailable — ${pairsError}. (The engine needs the /color-pairs route: restart it.)`
                : pairsLoaded
                  ? 'Nothing saved yet. Set the colours, then tap SAVE PALETTE — every iPad gets it.'
                  : 'Loading saved palettes…'}
            </Text>
          ) : (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {pairs.map((p, i) => (
                // `pairIsLive` still runs every render — it is a couple of
                // numeric compares — but the CHIP is memoized on its BOOLEAN
                // result, so the generated SVG icon inside is not redrawn on
                // every broadcast frame merely because the live slots moved
                // (_279).
                <PresetChip
                  key={`${p.c1}-${p.c2}-${p.name ?? ''}-${i}`}
                  index={i}
                  preset={p}
                  live={pairIsLive(p, slots)}
                  editing={pairsEditing}
                  onLoad={loadPreset}
                  onDelete={onDeletePair}
                />
              ))}
            </View>
          )}
          <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 10, color: C.icon }}>
            {(mode === 'turns' || latched)
              ? 'SAVE PALETTE stores all five staged colours, which two feed A and B, and the latched scheme — a recall brings the whole thing back.'
              : 'SAVE PALETTE stores A and B. Latch a scheme (or switch to PALETTE TURNS) to store all five colours instead.'}
          </Text>
        </View>

        {/* 3. Show palette — the curated config.yaml library, collapsed. */}
        <View style={{ gap: 6 }}>
          <TouchableOpacity
            onPress={() => setShowLibrary((v) => !v)}
            accessibilityRole="button"
            accessibilityState={{ expanded: showLibrary }}
            accessibilityLabel={showLibrary ? 'Hide the show palette' : 'Show the show palette'}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4 }}
          >
            <IconSymbol name={showLibrary ? 'chevron.up' : 'chevron.right'} size={12} color={C.secondary} />
            {label(`Show palette · ${library.length}`)}
          </TouchableOpacity>
          {/* A plain WRAPPING View, never a ScrollView: this window's body
              already sits inside the column's vertical ScrollView in wide mode,
              and a same-axis scroll nested inside another is exactly the
              "third column missing" class of bug (docs/53 §3.3). The library is
              collapsed by default, so its full height only ever appears when
              the operator asks for it. */}
          {showLibrary ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {library.map((p) => (
                <TouchableOpacity
                  key={p.id}
                  onPress={() => loadPair(p.c1, p.c2)}
                  accessibilityRole="button"
                  accessibilityLabel={`Load palette ${p.name}`}
                  style={{
                    flexDirection: 'row', alignItems: 'center', gap: 6,
                    paddingHorizontal: 8, paddingVertical: 7, borderRadius: 8,
                    borderWidth: 1, borderColor: C.ghostBorder, backgroundColor: C.surface,
                  }}
                >
                  <DualSwatch h1={p.c1} h2={p.c2} size={16} />
                  <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10, color: C.text }} numberOfLines={1}>
                    {p.name.toUpperCase()}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : null}
          <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 10, color: C.icon }}>
            {libraryError
              ? `Show palette unavailable — ${libraryError}.`
              : pairSurface
                ? 'A tap loads BOTH hues — c1 into A, c2 into B.'
                : 'A tap drops c1 into the armed slot and c2 into the next one, then moves on. Three taps fill all five.'}
          </Text>
        </View>
      </View>
    </View>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────

/**
 * ONE LIVE TOUCH SAMPLE CHIP. Memoized (_279): its face is a constant, and its
 * only variable is the A/B/T badge, which changes on an operator edit — not on
 * the ~25 Hz broadcast the window re-renders at while a rotation runs.
 */
const SwatchChip = React.memo(function SwatchChip({ swatch, badge, armedLabel, onPress }: {
  swatch: LiveTouchSwatch; badge: string | null; armedLabel: string;
  onPress: (c: Hsv) => void;
}) {
  const C = usePalette();
  return (
    <TouchableOpacity
      onPress={() => onPress(swatch.c)}
      accessibilityRole="button"
      accessibilityLabel={`Load ${swatch.hex} into slot ${armedLabel}`}
      style={{
        width: 56, paddingVertical: 6, paddingHorizontal: 4, borderRadius: 8, gap: 4,
        alignItems: 'center',
        borderWidth: badge ? 2 : 1,
        borderColor: badge ? C.primary : C.ghostBorder,
        backgroundColor: C.surface,
      }}
    >
      <View style={{ width: 30, height: 20, borderRadius: 4, backgroundColor: swatch.hex }} />
      <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 8, color: badge ? C.primary : C.icon }}>
        {badge ? badge : swatch.role}
      </Text>
    </TouchableOpacity>
  );
});

/**
 * ONE SAVED PALETTE CHIP. Memoized (_279) because its face is a GENERATED SVG
 * — a wedge per colour — and the gallery holds up to `COLOR_PAIRS_MAX` of
 * them. Re-drawing every icon on every engine frame was the single largest
 * block of wasted work in the window whenever palettes were saved.
 *
 * It takes `preset` (a stable object out of state) and derives its own colours
 * and labels, so the parent hands it no freshly-built arrays.
 */
const PresetChip = React.memo(function PresetChip({
  index, preset, live, editing, onLoad, onDelete,
}: {
  index: number; preset: PalettePreset; live: boolean; editing: boolean;
  onLoad: (p: PalettePreset) => void; onDelete: (index: number) => void;
}) {
  const C = usePalette();
  return (
    <TouchableOpacity
      onPress={() => (editing ? onDelete(index) : onLoad(preset))}
      accessibilityRole="button"
      accessibilityLabel={editing
        ? `Delete ${presetDescription(preset)}`
        : `Load ${presetDescription(preset)}`}
      style={{
        flexDirection: 'row', alignItems: 'center', gap: 6,
        paddingHorizontal: 8, paddingVertical: 7, borderRadius: 8,
        borderWidth: live ? 2 : 1,
        borderColor: editing ? C.error : live ? C.primary : C.ghostBorder,
        backgroundColor: C.surface,
      }}
    >
      <PresetIcon colours={presetIconColours(preset)} size={20} borderColor={C.ghostBorder} />
      <Text
        style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10, color: C.text, maxWidth: 96 }}
        numberOfLines={1}
      >
        {presetLabel(preset)}
      </Text>
      {editing ? <IconSymbol name="xmark" size={10} color={C.error} /> : null}
    </TouchableOpacity>
  );
});

function ModeButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const C = usePalette();
  return (
    <TouchableOpacity
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={`${label} mode`}
      style={[COLORS_MODE_BUTTON_STYLE, {
        backgroundColor: active ? C.primary : 'transparent',
      }]}
    >
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.85}
        style={[COLORS_MODE_LABEL_STYLE, {
        fontFamily: 'SpaceGrotesk_700Bold', fontSize: 9, letterSpacing: 0.8,
        color: active ? '#FFF' : C.secondary, textTransform: 'uppercase',
        }]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

/**
 * THE SHARED TRANSPORT ROWS (_224 order 1). Both the crossfade card and the
 * PALETTE TURNS card render THIS — not two similar-looking pairs of pill rows —
 * so "the same fade time out and interval as the two color" is enforced by
 * there being one component and one pair of values, not by two call sites
 * agreeing.
 */
function TransportTiming({ fadeS, holdS, onFade, onHold }: {
  fadeS: number; holdS: number; onFade: (v: number) => void; onHold: (v: number) => void;
}) {
  return (
    <>
      <TimerPillBar
        label="Fade · one step"
        compact
        presets={[...ROTATION_FADE_PRESETS_S]}
        value={fadeS}
        onChange={onFade}
        formatter={(v) => `${v}s`}
      />
      <TimerPillBar
        label="Hold · before the next step"
        compact
        presets={[...ROTATION_HOLD_PRESETS_S]}
        value={holdS}
        onChange={onHold}
        formatter={(v) => (v === 0 ? 'CONT' : v < 60 ? `${v}s` : `${v / 60}m`)}
      />
    </>
  );
}

/**
 * The timing the ENGINE is actually running, spelled out. The pill rows can
 * only highlight a PRESET, and a rotation started elsewhere (a cue, the
 * AUTOPILOT window, an older config) can legitimately hold a value that is not
 * one of them — leaving every pill dark with no explanation. This line is the
 * truth in that case, and a harmless echo the rest of the time.
 */
function LiveTimingLine({ show, holdS, fadeS }: { show: boolean; holdS: number; fadeS: number }) {
  const C = usePalette();
  if (!show) return null;
  return (
    <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10, color: C.icon }}>
      {`ENGINE: FADE ${fadeS}s · HOLD ${holdS === 0 ? 'CONT' : `${holdS}s`}`}
    </Text>
  );
}

/**
 * LIVE-RETUNE HONESTY (docs/59 §7). While a family is running, its pill rows
 * say WHEN the value they just changed will show on the rig — "applies now"
 * for a hold, "from the next fade" for a fade. One caption line under the
 * rows, never a modal.
 *
 * This exists because live retune is otherwise INVISIBLY partial: a hold
 * re-arms the moment it is tapped, a fade lands only on the next transition,
 * and a surface that showed both as instant would be telling a small lie every
 * time the operator moved the FADE pill mid-fade and saw nothing happen. The
 * wording comes from `RETUNE_TIMING_TAGS`, i.e. from the same table the patch
 * builder obeys, so the caption cannot drift from the behaviour.
 */
function RetuneLine({ show, fields }: { show: boolean; fields: readonly RetuneField[] }) {
  const C = usePalette();
  if (!show) return null;
  const parts = fields.map((f) => `${RETUNE_FIELD_LABELS[f]} ${RETUNE_TIMING_TAGS[retuneTiming(f)]}`);
  return (
    <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 10, color: C.icon }}>
      {`Live: ${parts.join(' · ')} — no stop and start.`}
    </Text>
  );
}

/** Operator-facing names for the retune fields, so the caption reads like the
 *  pill row above it rather than like the wire. */
const RETUNE_FIELD_LABELS: Readonly<Record<RetuneField, string>> = {
  delay_s: 'HOLD',
  transitionMs: 'FADE',
  palettes: 'the ring',
  shuffle: 'SHUFFLE',
  methodHoldS: 'METHOD HOLD',
  methodFadeS: 'METHOD FADE',
  noteFadeMs: 'NOTE FADE',
  schemes: 'the method set',
  sel: 'the A/B pick',
  method: 'the method',
};

/**
 * ONE METHOD CHIP — a member of the cycle, not a button that paints something.
 *
 * Three states, and they are three different facts: OFF (not in the cycle), ON
 * (in the cycle, waiting its turn) and RUNNING (in the cycle and on the rig
 * right now). The third is derived from the broadcast `currentScheme`, so the
 * chip that is lit bright is the generator the ship is actually wearing.
 */
function MethodChip({ title, on, running, disabled, onPress }: {
  title: string; on: boolean; running: boolean; disabled?: boolean; onPress: () => void;
}) {
  const C = usePalette();
  const wash = accentWash(C.primary);
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="switch"
      accessibilityState={{ checked: on, disabled: !!disabled }}
      accessibilityLabel={`${title}${running ? ', on the rig now' : ''}, ${on ? 'in the cycle' : 'not in the cycle'}`}
      style={{
        paddingHorizontal: 8, paddingVertical: 6, borderRadius: 8, minWidth: 56,
        alignItems: 'center',
        borderWidth: running ? 2 : 1,
        borderColor: running ? C.primary : on ? wash.borderColor : C.ghostBorder,
        backgroundColor: on ? wash.backgroundColor : C.surface,
        opacity: disabled ? 0.4 : 1,
      }}
    >
      <Text style={{
        fontFamily: 'SpaceGrotesk_700Bold', fontSize: 8, letterSpacing: 0.6,
        color: running ? C.primary : on ? wash.color : C.icon,
      }}>{title}</Text>
    </TouchableOpacity>
  );
}

/**
 * THE ORBITING WINDOW, drawn (_224 order 2, widened by the orbit). A cell per
 * ring slot with the pair's highlight parked exactly where the engine's cursor
 * is: on a window during the hold, part-way to the next one during the fade.
 *
 * At the default spacing the two ends touch and it is ONE two-cell capsule —
 * the highlight this rail has always drawn. At a wider spacing they are two
 * separated cells that travel together, which is the operator's "keep their
 * distance" made visible.
 *
 * Every segment is drawn twice (at its offset and one lap back) inside a
 * clipping container, so a window straddling the T5→T1 seam slides through it
 * instead of teleporting.
 *
 * Every position comes from `rotationCursor`, i.e. from a broadcast palette.
 * There is no timer here; when the rig stops moving, so does this.
 */
function WindowRail({ cursor, ringLength, distance, phase }: {
  cursor: RotationCursor | null; ringLength: number; distance: number; phase: number | null;
}) {
  const C = usePalette();
  if (ringLength < 2) return null;
  // No phase means the engine is rotating a ring these cells do not name, so
  // the rail stays dark rather than lighting a window that is not this one.
  const segments = cursor && phase !== null
    ? cursorRailSegments(cursor, ringLength, distance, phase)
    : [];
  const pct = (x: number): DimensionValue => `${(x / ringLength) * 100}%` as DimensionValue;
  return (
    <View style={{ gap: 3 }}>
      <View style={{
        height: 8, borderRadius: 4, overflow: 'hidden',
        backgroundColor: C.surfaceContainerHigh, borderWidth: 1, borderColor: C.ghostBorder,
      }}>
        {segments.flatMap((seg, i) => [seg.left, seg.left - ringLength].map((left, j) => (
          <View
            key={`${i}-${j}`}
            style={{
              position: 'absolute', top: 0, bottom: 0,
              left: pct(left),
              width: pct(seg.width),
              backgroundColor: C.primary,
              borderRadius: 4,
            }}
          />
        )))}
      </View>
      <View style={{ flexDirection: 'row' }}>
        {Array.from({ length: ringLength }, (_, i) => (
          <Text
            key={i}
            style={{
              flex: 1, textAlign: 'center',
              fontFamily: 'SpaceGrotesk_700Bold', fontSize: 8, letterSpacing: 0.6,
              color: C.icon,
            }}
          >{`T${i + 1}`}</Text>
        ))}
      </View>
    </View>
  );
}

/**
 * One slot. The swatch IS the engine slot's colour; ARMED marks the one a ring
 * tap moves. LIT (turns mode) marks the pair the engine is showing right now.
 * BADGE marks a slot as COLOUR A or COLOUR B — the two the orbit carries.
 */
const SlotButton = React.memo(function SlotButton({
  index, name, hue, swatch, armed, lit, badge, compact, onPress,
}: {
  index: number; name: string; hue: number; swatch?: string;
  armed: boolean; lit?: boolean; badge?: string | null; compact?: boolean;
  // Takes its own INDEX back (_279), so the call sites can hand it the
  // `setArmed*` state setters — whose identities React keeps stable — instead
  // of a fresh arrow per render.
  onPress: (index: number) => void;
}) {
  const C = usePalette();
  return (
    <TouchableOpacity
      onPress={() => onPress(index)}
      accessibilityRole="button"
      accessibilityState={{ selected: armed }}
      accessibilityLabel={`${name}, hue ${degrees(hue)} degrees${badge ? `, colour ${badge}` : ''}${armed ? ', armed' : ''}`}
      style={{
        flexDirection: 'row', alignItems: 'center', gap: 6,
        flex: compact ? undefined : 1, minWidth: compact ? 0 : undefined,
        paddingHorizontal: 8, paddingVertical: 8, borderRadius: 8,
        borderWidth: armed ? 2 : 1,
        borderColor: armed ? C.primary : lit ? C.secondary : C.ghostBorder,
        backgroundColor: C.surface,
      }}
    >
      <View style={{ width: 18, height: 18, borderRadius: 4, backgroundColor: swatch ?? hueCss(hue) }} />
      <View>
        <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 9, color: armed || badge ? C.primary : C.secondary }}>
          {badge ? `${name} · ${badge}` : name}
        </Text>
        <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10, color: C.text }}>
          {`${degrees(hue)}°`}
        </Text>
      </View>
    </TouchableOpacity>
  );
});

/**
 * ONE SCHEME BUTTON. Its face carries the five colours the tap would paint —
 * so the operator picks by SEEING the result, not by remembering what
 * "COMPLEMENT" does, and the HUE ramp is legible before anything is committed.
 *
 * Two on-states, both from docs/54's vocabulary:
 *   FLASHING — the 260 ms momentary acknowledgement, Live Touch's `is-on`.
 *   LATCHED  — the quiet `accentWash`, the deviation recorded in docs/55 §2.1:
 *              a mode with visible consequences must itself be visible.
 */
const SchemeButton = React.memo(function SchemeButton({
  id, title, colours, latched, flashing, disabled, onPress,
}: {
  id: SchemeId; title: string; colours: Hsv[]; latched: boolean; flashing: boolean;
  // Takes its OWN id back (_279): a `() => onSchemeTap(id)` closure at the call
  // site would be a fresh prop on every render and defeat the memo.
  disabled?: boolean; onPress: (id: SchemeId) => void;
}) {
  const C = usePalette();
  const on = accentWash(C.primary);
  return (
    <TouchableOpacity
      onPress={() => onPress(id)}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ selected: latched, disabled: !!disabled }}
      accessibilityLabel={`Paint the ${title} scheme from the armed colour`}
      style={{
        // Sized so NINE generators lay out three-across in the narrow deck
        // column instead of two — five stacked rows of scheme buttons pushed
        // the TURNS transport off the bottom of the window (_224).
        paddingHorizontal: 5, paddingVertical: 6, borderRadius: 8, gap: 4,
        alignItems: 'center', minWidth: 56,
        borderWidth: latched || flashing ? 2 : 1,
        borderColor: flashing ? C.primary : latched ? on.borderColor : C.ghostBorder,
        backgroundColor: flashing ? on.backgroundColor : latched ? on.backgroundColor : C.surface,
        opacity: disabled ? 0.4 : 1,
      }}
    >
      <View style={{ flexDirection: 'row', gap: 1 }}>
        {colours.map((c, i) => (
          <View key={i} style={{ width: 8, height: 14, borderRadius: 2, backgroundColor: hsvCss(c) }} />
        ))}
      </View>
      <Text style={{
        fontFamily: 'SpaceGrotesk_700Bold', fontSize: 8, letterSpacing: 0.6,
        color: latched || flashing ? on.color : C.secondary,
      }}>{title}</Text>
    </TouchableOpacity>
  );
});

function PaneButton({ label, onPress, active, disabled }: {
  label: string; onPress: () => void; active?: boolean; disabled?: boolean;
}) {
  const C = usePalette();
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled, selected: !!active }}
      accessibilityLabel={label}
      style={{
        paddingHorizontal: 10, paddingVertical: 7, borderRadius: 6,
        borderWidth: 1, borderColor: active ? C.primary : C.ghostBorder,
        backgroundColor: active ? C.primary : 'transparent',
        opacity: disabled ? 0.4 : 1,
      }}
    >
      <Text style={{
        fontFamily: 'SpaceGrotesk_700Bold', fontSize: 9, letterSpacing: 0.8,
        color: active ? '#FFF' : C.text,
      }}>{label}</Text>
    </TouchableOpacity>
  );
}
