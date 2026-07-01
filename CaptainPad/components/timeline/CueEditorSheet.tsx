/**
 * CueEditorSheet — themed modal to add / edit a single cue (docs/38 §15.3).
 *
 * Pure pill / stepper / segmented / dropdown inputs — NO keyboard walls.
 * Operates on a LOCAL working copy of a PlanCue; commits via onSave (the
 * parent inserts/replaces in the draft plan and fires a debounced preview).
 *
 *   CUE NAME  text input  the operator-facing label for this cue
 *   KIND      segmented   program | mood | ambient
 *   TRIGGER   segmented   clock | sun | phase | mood | manual
 *               clock → HH:MM stepper
 *               sun   → event dropdown + offset ±min stepper
 *               phase → phase dropdown
 *               mood  → from/to segmented + dwell/cooldown steppers + whenPhase
 *   ACTION    (fixed)     playlist only        (look + scene removed)
 *               playlist → dropdown (GET /playlists), deck-only target,
 *                          TRANSITION (default|crossfade|flash|dissolve),
 *                          OVERLAYS (leave|enable|disable),
 *                          pattern AUTOPILOT + COLOR AUTOPILOT
 *   HOLD      none | minutes stepper            (programs only)
 *   DAYS      This day | All days | Pick…       (Pick = day-index toggles)
 *
 * PLAYLIST is the ONLY action the maker authors now (operator decision:
 * "remove look all together"). The CueAction union still carries `look` /
 * `globals` for hand-authored plans, but this editor never emits them. The
 * `scene` action is likewise NOT authored here: a scene switch restarts the
 * engine — dangerous + irrelevant inside the maker.
 */
import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, Modal, Pressable, StyleSheet } from 'react-native';
import { Palette } from '@/constants/theme';
import { usePalette } from '@/hooks/use-theme';
import {
  PlanCue, PlanDefaultCue, CueKind, CueTrigger, CueAction, ActionPlaylist, SunEvent, CueDays, ShowPlan,
  DeckTransitionMode, ActionOverlays, DECK_TRANSITION_MODES, DECK_TRANSITION_MODE_LABEL,
} from '@/utils/timelineApi';
import {
  hhmmToMinutes, minutesToHHMM, minutesTo12h, hhmmTo12h, SUN_EVENT_OPTIONS, MOOD_VALUES,
} from './timelineTemplate';
import { Segmented, Stepper, Dropdown, ToggleChip, FieldLabel } from './makerControls';
import { DayTimePicker, DayTimeContextCue } from './DayTimePicker';
import { DualSwatch } from '@/components/ColorPickerModal';

// Crossfade presets for the cue's COLOR AUTOPILOT transition (ms under the
// hood). 0 = hard cut; the rest ramp the palette params over the window. Mirror
// of the deck panel's transition pills (DECK TX crossfade idiom).
const COLOR_TRANSITION_PRESETS_MS = [0, 500, 1000, 2000, 3000];

// Pattern (deck TX) crossfade-time presets (ms > 0), mirroring the deck panel's
// DECK TX "CROSSFADE TIME" pills. Shown once a transition mode is chosen.
const PATTERN_TRANSITION_PRESETS_MS = [200, 500, 1000, 1500, 2000, 3000];
function formatColorTransition(ms: number): string {
  if (ms <= 0) return 'CUT';
  return ms % 1000 === 0 ? `${ms / 1000}s` : `${(ms / 1000).toFixed(1)}s`;
}

// Deck transition mode options for the playlist action. "Default" means DON'T
// emit a `transition` field — the cue inherits the deck's standing transition
// config. Picking a named mode emits `transition: { mode }`.
const TRANSITION_OPTIONS: { id: 'default' | DeckTransitionMode; label: string }[] = [
  { id: 'default', label: 'Default' },
  ...DECK_TRANSITION_MODES.map((m) => ({ id: m, label: DECK_TRANSITION_MODE_LABEL[m] })),
];

// Cue-level overlay intent. "Leave as-is" emits nothing; the other two emit
// `overlays: 'enable' | 'disable'` on the playlist action.
const OVERLAY_OPTIONS: { id: 'asis' | ActionOverlays; label: string }[] = [
  { id: 'asis', label: 'Leave as-is' },
  { id: 'enable', label: 'Enable overlays' },
  { id: 'disable', label: 'Disable overlays' },
];

// DURATION presets (minutes). A cue is an EVENT that owns the deck for this
// many minutes after it fires; "None" emits no `durationMin` (point event).
// Mirrors the HOLD stepper idiom but with quick playa-friendly presets.
const DURATION_PRESETS_MIN = [15, 30, 60, 90, 120, 180];

// ── Overlap detection (operator: "disallow overlapping cues") ──────────────
// A cue owns the deck for [start, start+durationMin). Two cues conflict only
// when their DAY-SETS intersect AND their windows overlap. Touching endpoints
// do NOT overlap: [10:00,11:00) and [11:00,12:00) are fine. These are pure
// module-level helpers so the SAVE handler can validate before calling onSave.

// Resolve a cue's window START (minutes-of-day) for overlap math. ONLY the
// CLOCK trigger has an editor-resolvable start; a SUN trigger's per-day time
// isn't computed here, so we return null and the caller SKIPS that pair rather
// than false-positive. Anything else (phase/mood/manual) has no time-of-day
// anchor either → null (skip).
function cueStartMinutes(cue: PlanCue): number | null {
  if (cue.trigger.type === 'clock') return hhmmToMinutes(cue.trigger.at);
  return null;
}

// Two half-open windows [aStart, aEnd) and [bStart, bEnd) overlap iff they
// share more than a touching endpoint: aStart < bEnd AND bStart < aEnd.
function windowsOverlap(aStart: number, aDur: number, bStart: number, bDur: number): boolean {
  return aStart < bStart + bDur && bStart < aStart + aDur;
}

// Do two cue DAY-SETS intersect? 'all' (or absent) matches EVERY day, so it
// intersects anything. Otherwise both are arrays (number indices OR date
// strings); we intersect element-wise. A numeric day-set and a date-string
// day-set can't be compared here (different representations) → treat as
// NON-intersecting (skip) rather than guess.
function daySetsIntersect(a: CueDays | undefined, b: CueDays | undefined): boolean {
  const aAll = a === 'all' || a === undefined;
  const bAll = b === 'all' || b === undefined;
  if (aAll || bAll) return true;
  // Both are arrays here. Compare only when they share a representation.
  const aArr = a as (number | string)[];
  const bArr = b as (number | string)[];
  const bSet = new Set(bArr);
  return aArr.some((d) => bSet.has(d));
}

function defaultTrigger(type: CueTrigger['type']): CueTrigger {
  switch (type) {
    case 'clock': return { type: 'clock', at: '20:00' };
    case 'sun': return { type: 'sun', event: 'sunset', offsetMin: 0 };
    case 'phase': return { type: 'phase', phase: '' };
    case 'mood': return { type: 'mood', from: 'calm', to: 'party', minDwellSec: 30, cooldownSec: 300 };
    case 'manual': return { type: 'manual' };
  }
}

// Smart default start for a fresh CLOCK trigger (operator: a new cue should
// default to "~5 minutes from now", snapped UP to the time UI's 5-minute
// increments, never uncomfortably close). "Now" is read in the PLAN's tz via
// Intl — the same idiom as timeline.tsx nowPartsInTz, replicated here WITH
// SECONDS; a malformed tz makes Intl throw (fail loud per codex — no
// device-tz fallback). Pinned rule:
//   nextBoundarySec = ceil(nowSec / 300) * 300
//   if (nextBoundarySec - nowSec < 60) nextBoundarySec += 300
// Examples: 3:31:00 → 3:35 · 3:34:20 → 3:40 (too close) · 3:35:00 → 3:40.
function smartDefaultClockAt(tz: string): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
  const parts = fmt.formatToParts(new Date());
  const num = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? NaN);
  let hour = num('hour');
  if (hour === 24) hour = 0; // some engines emit '24' for midnight under hour12:false
  const nowSec = hour * 3600 + num('minute') * 60 + num('second');
  if (!Number.isFinite(nowSec)) {
    throw new Error(`CueEditorSheet: cannot read "now" in plan tz '${tz}'`);
  }
  let boundarySec = Math.ceil(nowSec / 300) * 300;
  if (boundarySec - nowSec < 60) boundarySec += 300;
  // 23:59 rolls over to 00:00 (next day) — the % 1440 wrap matches the wire's
  // minutes-of-day domain.
  return minutesToHHMM(Math.floor(boundarySec / 60) % 1440);
}

// The maker authors PLAYLIST cues only now (look removed). This always
// returns a fresh, deck-targeted playlist action — the editor's single
// default and reset shape.
function defaultPlaylistAction(): ActionPlaylist {
  return { type: 'playlist', name: 'default', target: { channel: 'deck', id: null } };
}

export function CueEditorSheet({
  visible, mode = 'cue', initialCue, initialDefaultCue, plan, playlists, palettes, dayIndex,
  onSave, onSaveDefault, onDelete, onClose,
}: {
  visible: boolean;
  /**
   * Editor mode:
   *   'cue'         → full cue editor (name/kind/trigger/action/hold/duration/days).
   *   'defaultCue'  → the plan's DEFAULT CUE: name + ACTION only. No trigger,
   *                   kind, hold, duration, or days — the default cue is the
   *                   standing fallback, not a scheduled event. Saves via
   *                   onSaveDefault (a PlanDefaultCue), not onSave.
   */
  mode?: 'cue' | 'defaultCue';
  /** null = adding a new cue. Ignored in 'defaultCue' mode. */
  initialCue: PlanCue | null;
  /** The plan's current default cue, seeded when mode==='defaultCue'. */
  initialDefaultCue?: PlanDefaultCue | null;
  plan: ShowPlan;
  playlists: string[];
  /**
   * Color-palette options for the COLOR AUTOPILOT multi-select, sourced from
   * the engine's /color-palettes list (see utils/api.ts getCachedColorPalettes
   * / fetchColorPalettes). Passed in the same way as `playlists` because the
   * engine fetch lives outside this component's lease. Defaults to [] so the
   * control degrades to an empty-state hint when the parent hasn't wired it.
   * `c1`/`c2` are the palette's two hues (0..1) — when present we render the
   * REAL split swatch (DualSwatch) so a chip shows its true colors, not a name.
   */
  palettes?: { id: string; name: string; c1?: number; c2?: number }[];
  /** The day the editor was opened from — seeds DAYS "This day". */
  dayIndex: number;
  onSave: (cue: PlanCue) => void;
  /** Called (mode==='defaultCue' only) with the edited plan default cue. */
  onSaveDefault?: (dc: PlanDefaultCue) => void;
  onDelete: (() => void) | null;
  onClose: () => void;
}) {
  const isDefaultMode = mode === 'defaultCue';
  const C = usePalette();
  const styles = useMemo(() => makeStyles(C), [C]);

  const paletteOptions = palettes ?? [];
  const paletteById = useMemo(
    () => new Map(paletteOptions.map((p) => [p.id, p])),
    [paletteOptions],
  );
  const phaseNames = Object.keys(plan.phases);

  // Fresh trigger for a given type. CLOCK gets the smart "~5 min from now"
  // default (plan tz) instead of a fixed time — used when seeding a NEW cue
  // and when the operator switches the TRIGGER segmented control. Opening an
  // EXISTING cue still seeds its stored trigger untouched.
  const makeTrigger = (type: CueTrigger['type']): CueTrigger =>
    type === 'clock'
      ? { type: 'clock', at: smartDefaultClockAt(plan.location.tz) }
      : defaultTrigger(type);

  type DaysMode = 'all' | 'this' | 'pick';

  // Classify a saved `days` value into an initial segmented mode. A date-string
  // array (e.g. ['2026-08-31']) has no grid representation, so we surface it as
  // 'pick' (read-only) rather than clobbering it.
  const initialDaysMode = (d: CueDays | undefined): DaysMode => {
    if (d === 'all' || d === undefined) return 'all';
    if (Array.isArray(d) && d.length === 1 && d[0] === dayIndex) return 'this';
    return 'pick';
  };

  // Working copy. Re-seeded each time the sheet opens with a different cue.
  const [kind, setKind] = useState<CueKind>('program');
  const [label, setLabel] = useState<string>('');
  const [trigger, setTrigger] = useState<CueTrigger>(defaultTrigger('clock'));
  const [action, setAction] = useState<CueAction>(defaultPlaylistAction());
  const [holdMin, setHoldMin] = useState<number | null>(null);
  // Cue DURATION (minutes) — REQUIRED. A cue always owns the deck for this window
  // after it fires (operator: "new CUEs must have a duration, no None"). Default 60.
  const [durationMin, setDurationMin] = useState<number>(60);
  const [days, setDays] = useState<CueDays>('all');
  // DAYS mode is EXPLICIT state, driven by the segmented control — NOT derived
  // from `days` on every render (deriving made "Pick…" snap back to "This day").
  const [daysMode, setDaysModeState] = useState<DaysMode>('all');
  // COLOR AUTOPILOT "+ add" popover: collapsed by default so the section shows
  // only the SELECTED palettes (operator feedback: don't dump the full grid).
  const [caAdding, setCaAdding] = useState(false);
  const [seedKey, setSeedKey] = useState<string>('');
  // Inline validation error surfaced near the SAVE button. Set when a save is
  // BLOCKED (e.g. overlapping cue); cleared on the next save attempt. null =
  // no error (nothing renders).
  const [saveError, setSaveError] = useState<string | null>(null);

  // Seed when the sheet opens / target cue changes. We key on mode + cue id +
  // visibility so re-opening the SAME cue after an external edit re-seeds.
  const wantKey = `${visible ? 'v' : 'h'}:${mode}:${initialCue?.id ?? 'new'}:${dayIndex}`;
  if (visible && wantKey !== seedKey) {
    setSeedKey(wantKey);
    setSaveError(null); // fresh sheet → clear any stale blocked-save message
    if (isDefaultMode) {
      // DEFAULT CUE: only label + action apply. Normalise a non-playlist action
      // to a fresh deck playlist so the editor always has something to render.
      const dc = initialDefaultCue ?? null;
      setLabel(dc?.label || '');
      setAction(dc && dc.action.type === 'playlist' ? dc.action : defaultPlaylistAction());
      // The following are inert in default mode but reset for hygiene.
      setKind('program');
      setTrigger(defaultTrigger('manual'));
      setHoldMin(null);
      setDurationMin(60);
      setDays('all');
      setDaysModeState('all');
    } else if (initialCue) {
      setKind(initialCue.kind || (initialCue.trigger.type === 'mood' ? 'mood' : 'program'));
      setLabel(initialCue.label || '');
      setTrigger(initialCue.trigger);
      // A hand-authored cue could carry a look/globals action; the maker only
      // edits playlist actions, so normalise anything else to a fresh playlist
      // so the editor never gets stuck on an action it can't render.
      setAction(initialCue.action.type === 'playlist' ? initialCue.action : defaultPlaylistAction());
      setHoldMin(initialCue.hold && 'min' in initialCue.hold ? initialCue.hold.min : null);
      // DURATION is required; seed from a saved positive durationMin, else 60.
      setDurationMin(
        typeof initialCue.durationMin === 'number' && initialCue.durationMin > 0
          ? initialCue.durationMin
          : 60,
      );
      setDays(initialCue.days ?? 'all');
      setDaysModeState(initialDaysMode(initialCue.days));
    } else {
      setKind('program');
      setLabel('');
      // NEW cue: the clock trigger defaults to ~5 min from NOW in the plan tz,
      // snapped up to the next comfortable 5-minute boundary (smartDefaultClockAt).
      setTrigger(makeTrigger('clock'));
      setAction(defaultPlaylistAction());
      setHoldMin(null);
      // A cue is an EVENT with a REQUIRED duration; a fresh cue defaults to 60 min
      // (renders as a deck-owned block on the day overview).
      setDurationMin(60);
      setDays([dayIndex]); // new cue defaults to "this day"
      setDaysModeState('this');
    }
  }

  // True when `days` holds date strings (no grid representation; read-only).
  const isDateStringDays = Array.isArray(days) && days.some((d) => typeof d === 'string');

  const setDaysMode = (mode: DaysMode) => {
    setDaysModeState(mode);
    if (mode === 'all') setDays('all');
    else if (mode === 'this') setDays([dayIndex]);
    else {
      // entering "pick": keep an existing numeric/date selection; otherwise
      // seed from this day so the grid opens with something selected.
      if (Array.isArray(days) && days.length > 0) return; // preserve as-is
      setDays([dayIndex]);
    }
  };

  const togglePickDay = (idx: number) => {
    // Toggling is only meaningful for numeric (grid) selections; a date-string
    // array is shown read-only and left untouched.
    if (isDateStringDays) return;
    const cur = Array.isArray(days) && days.every((d) => typeof d === 'number') ? (days as number[]) : [];
    const next = cur.includes(idx) ? cur.filter((d) => d !== idx) : [...cur, idx].sort((a, b) => a - b);
    setDays(next.length ? next : [dayIndex]);
  };

  const festivalDays = plan.festival?.days ?? 8;

  // The plan's OTHER cues resolvable on the SELECTED day, for the visual day
  // pane's context blocks. Only CLOCK triggers have a client-resolvable start
  // (same limitation as the overlap check) — sun/phase/mood/manual cues are
  // skipped rather than guessed. Date-string day-sets are skipped too (no
  // index representation). The cue being edited is excluded by id.
  const dayContextCues = useMemo<DayTimeContextCue[]>(() => {
    const out: DayTimeContextCue[] = [];
    for (const c of plan.cues ?? []) {
      if (initialCue && c.id === initialCue.id) continue;
      const d = c.days;
      const onDay =
        d === 'all' || d === undefined
        || (Array.isArray(d) && (d as (number | string)[]).includes(dayIndex));
      if (!onDay) continue;
      const start = cueStartMinutes(c);
      if (start === null) continue;
      out.push({
        startMinutes: start,
        durationMin: typeof c.durationMin === 'number' && c.durationMin > 0 ? c.durationMin : 0,
        kind: c.kind ?? 'program',
        label: c.label,
      });
    }
    return out;
  }, [plan, dayIndex, initialCue]);

  // Normalize the working ACTION into a valid, emittable CueAction. Shared by
  // buildCue and buildDefaultCue so the deck-target / autopilot / color-autopilot
  // discipline is identical in both paths.
  const buildNormalizedAction = (): CueAction => {
    let outAction: CueAction = action;
    if (action.type === 'playlist') {
      // Force the deck-only target (mixer authoring removed) and NORMALIZE the
      // optional autopilot block so the emitted JSON always satisfies the
      // engine's strict validateAutopilot (active + delay_s>0 + shuffle, no
      // defaults). We emit `autopilot` ONLY when active===true; an inactive /
      // absent block is OMITTED (it's optional on a playlist action). When we
      // do emit it, delay_s is clamped to a positive value (default 30) and
      // shuffle defaults to false — guaranteeing validity regardless of the
      // order the operator touched the autopilot controls.
      const pl: ActionPlaylist = { ...action, target: { channel: 'deck' as const, id: null } };
      if (pl.autopilot && pl.autopilot.active) {
        const d = pl.autopilot.delay_s;
        pl.autopilot = {
          active: true,
          delay_s: typeof d === 'number' && d > 0 ? d : 30,
          shuffle: pl.autopilot.shuffle ?? false,
        };
      } else {
        delete pl.autopilot;
      }
      // COLOR AUTOPILOT — same discipline as the pattern autopilot above. Emit
      // the block ONLY when active===true; otherwise OMIT it. When emitted,
      // ALWAYS supply a positive delay_s (clamp/default 30), a NON-EMPTY
      // palettes array (the toggle can't turn on without ≥1 palette, but we
      // re-guard here so the emitted JSON can never be active+empty), and a
      // boolean shuffle (default false). This satisfies the engine's strict
      // validateColorAutopilot regardless of UI interaction order.
      const ca = pl.colorAutopilot;
      if (ca && ca.active && Array.isArray(ca.palettes) && ca.palettes.length > 0) {
        // transitionMs (crossfade): normalize like the other fields — a
        // non-finite / negative value collapses to 0 (hard cut) so the emitted
        // JSON always satisfies the engine's transitionMs >= 0 validator.
        const tm = ca.transitionMs;
        pl.colorAutopilot = {
          active: true,
          palettes: ca.palettes,
          delay_s: typeof ca.delay_s === 'number' && ca.delay_s > 0 ? ca.delay_s : 30,
          shuffle: ca.shuffle ?? false,
          transitionMs: typeof tm === 'number' && Number.isFinite(tm) && tm >= 0 ? tm : 0,
        };
      } else {
        delete pl.colorAutopilot;
      }
      outAction = pl;
    }
    return outAction;
  };

  const buildCue = (): PlanCue => {
    // The maker emits a DECK-only playlist target (mixer authoring removed) —
    // same discipline as how the `scene` action was dropped. The action is
    // normalized (deck target + autopilot/color-autopilot discipline) by
    // buildNormalizedAction, shared with the default-cue path.
    const outAction = buildNormalizedAction();
    // Spread the ORIGINAL cue first so fields the editor doesn't surface
    // (e.g. `catchUp`, and any future/unknown keys) survive a round-trip;
    // then overlay only what the editor manages.
    const cue: PlanCue = {
      ...(initialCue ?? {}),
      id: initialCue?.id ?? '', // parent mints id for new cues
      kind,
      trigger,
      action: outAction,
      days,
    };
    if (label.trim()) cue.label = label.trim();
    else delete cue.label;
    if (kind === 'program' && holdMin && holdMin > 0) cue.hold = { min: holdMin };
    else delete cue.hold;
    // DURATION is REQUIRED — always emit (durationMin is always a positive number).
    cue.durationMin = durationMin;
    return cue;
  };

  // Validate the candidate cue against every OTHER cue in the plan and return a
  // human-readable BLOCK message if it overlaps one, else null. Overlap rule:
  // day-sets intersect AND [start, start+durationMin) windows overlap (touching
  // endpoints are fine). The cue being edited is EXCLUDED by id (never conflicts
  // with itself). A candidate we can't resolve a start for (e.g. a SUN trigger)
  // skips the whole check — better than a false-positive. Likewise any OTHER
  // cue whose start we can't resolve here is skipped pairwise.
  const findOverlapError = (candidate: PlanCue): string | null => {
    const candStart = cueStartMinutes(candidate);
    // Best-effort: if this cue has no editor-resolvable start (sun/phase/mood/
    // manual), we can't place its window on the clock here → allow the save.
    if (candStart === null) return null;
    const candDur = candidate.durationMin ?? 0;
    if (candDur <= 0) return null; // no owned window → nothing to overlap

    const others = plan.cues ?? [];
    for (const other of others) {
      // Never conflict with self. New cues have id '' (parent mints it on
      // insert); match by id so editing an existing cue skips its own row.
      if (candidate.id && other.id === candidate.id) continue;
      if (!daySetsIntersect(candidate.days, other.days)) continue;
      const otherStart = cueStartMinutes(other);
      if (otherStart === null) continue; // unresolved (e.g. sun) → skip pair
      const otherDur = other.durationMin ?? 0;
      if (otherDur <= 0) continue; // other owns no window
      if (windowsOverlap(candStart, candDur, otherStart, otherDur)) {
        const name = other.label?.trim() || 'another cue';
        // Window in AM/PM for the operator (file convention: clock reads 12h).
        const from = hhmmTo12h(minutesToHHMM(otherStart));
        const to = hhmmTo12h(minutesToHHMM(otherStart + otherDur));
        return `Overlaps '${name}' (${from}–${to}) on this day — cues can't overlap.`;
      }
    }
    return null;
  };

  // Build the plan DEFAULT CUE from the label + normalized action. NO trigger /
  // kind / hold / duration / days — the default cue is the standing fallback.
  const buildDefaultCue = (): PlanDefaultCue => {
    const dc: PlanDefaultCue = { action: buildNormalizedAction() };
    if (label.trim()) dc.label = label.trim();
    return dc;
  };

  // ── Trigger sub-editors ──
  const renderTriggerBody = () => {
    if (trigger.type === 'clock') {
      const mins = hhmmToMinutes(trigger.at) ?? 1200;
      return (
        <View style={styles.subBlock}>
          <FieldLabel>TIME</FieldLabel>
          {/* AM/PM summary of the chosen 24h stepper value (operator preference:
              clock times read as AM/PM everywhere). The steppers stay 24h. */}
          <Text style={[styles.hint, { marginBottom: 8, color: C.text }]}>{minutesTo12h(mins)}</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Stepper
                value={Math.floor(mins / 60)}
                onChange={(h) => setTrigger({ type: 'clock', at: minutesToHHMM(h * 60 + (mins % 60)) })}
                min={0} max={23} wrap
                format={(h) => `${String(h).padStart(2, '0')}h`}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Stepper
                value={mins % 60}
                step={5}
                onChange={(m) => setTrigger({ type: 'clock', at: minutesToHHMM(Math.floor(mins / 60) * 60 + m) })}
                min={0} max={55} wrap
                format={(m) => `${String(m).padStart(2, '0')}m`}
              />
            </View>
          </View>

          {/* VISUAL day pane — place the cue on the 24h column by touch: tap
              sets START (5-min snap), dragging the block's bottom-edge pill
              sets DURATION. Two-way synced with the steppers above and the
              DURATION presets/stepper below (all drive the same state). Sun
              shading is omitted here — the sheet has no overview sun table
              (see DayTimePicker header). min/max mirror the DURATION stepper. */}
          <View style={{ height: 14 }} />
          <FieldLabel>PLACE ON DAY</FieldLabel>
          <DayTimePicker
            startMinutes={mins}
            durationMin={durationMin}
            kind={kind}
            others={dayContextCues}
            onChangeStart={(m) => setTrigger({ type: 'clock', at: minutesToHHMM(m) })}
            onChangeDuration={setDurationMin}
            minDuration={5}
            maxDuration={720}
          />
        </View>
      );
    }
    if (trigger.type === 'sun') {
      return (
        <View style={styles.subBlock}>
          <FieldLabel>SUN EVENT</FieldLabel>
          <Dropdown
            value={trigger.event}
            options={SUN_EVENT_OPTIONS.map((s) => ({ id: s.id, label: s.label }))}
            onSelect={(id) => setTrigger({ ...trigger, event: id as SunEvent })}
          />
          <View style={{ height: 8 }} />
          <FieldLabel>OFFSET (MIN)</FieldLabel>
          <Stepper
            value={trigger.offsetMin ?? 0}
            step={5}
            onChange={(v) => setTrigger({ ...trigger, offsetMin: v })}
            min={-180} max={180}
            format={(v) => `${v > 0 ? '+' : ''}${v} min`}
          />
        </View>
      );
    }
    if (trigger.type === 'phase') {
      return (
        <View style={styles.subBlock}>
          <FieldLabel>PHASE</FieldLabel>
          <Dropdown
            value={trigger.phase || null}
            options={phaseNames.map((p) => ({ id: p, label: p }))}
            onSelect={(id) => setTrigger({ type: 'phase', phase: id })}
            placeholder="Pick a phase…"
            emptyHint="This plan defines no phases."
          />
        </View>
      );
    }
    if (trigger.type === 'mood') {
      return (
        <View style={styles.subBlock}>
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <View style={{ flex: 1 }}>
              <FieldLabel>FROM</FieldLabel>
              <Segmented
                options={MOOD_VALUES.map((m) => ({ id: m, label: m }))}
                value={trigger.from}
                onChange={(v) => setTrigger({ ...trigger, from: v })}
              />
            </View>
            <View style={{ flex: 1 }}>
              <FieldLabel>TO</FieldLabel>
              <Segmented
                options={MOOD_VALUES.map((m) => ({ id: m, label: m }))}
                value={trigger.to}
                onChange={(v) => setTrigger({ ...trigger, to: v })}
              />
            </View>
          </View>
          <View style={{ height: 8 }} />
          <FieldLabel>MIN DWELL (SEC)</FieldLabel>
          <Stepper
            value={trigger.minDwellSec ?? 0}
            step={10}
            onChange={(v) => setTrigger({ ...trigger, minDwellSec: v })}
            min={0} max={600}
            format={(v) => `${v}s`}
          />
          <View style={{ height: 8 }} />
          <FieldLabel>COOLDOWN (SEC)</FieldLabel>
          <Stepper
            value={trigger.cooldownSec ?? 0}
            step={30}
            onChange={(v) => setTrigger({ ...trigger, cooldownSec: v })}
            min={0} max={3600}
            format={(v) => `${v}s`}
          />
          <View style={{ height: 8 }} />
          <FieldLabel>WHEN PHASE (OPTIONAL)</FieldLabel>
          <Dropdown
            value={trigger.whenPhase ?? null}
            options={[{ id: '', label: '— any phase —' }, ...phaseNames.map((p) => ({ id: p, label: p }))]}
            onSelect={(id) => setTrigger({ ...trigger, whenPhase: id || undefined })}
            placeholder="— any phase —"
          />
        </View>
      );
    }
    return (
      <View style={styles.subBlock}>
        <Text style={styles.hint}>Manual cues fire only when the operator taps FIRE.</Text>
      </View>
    );
  };

  // ── Action sub-editors ──
  const renderActionBody = () => {
    if (action.type === 'playlist') {
      const ap = action.autopilot ?? {};
      const ca = action.colorAutopilot ?? { active: false, palettes: [] as string[], delay_s: 30 };
      // Target is always the main deck now (mixer removed from the maker UI).
      const transitionMode: 'default' | DeckTransitionMode = action.transition?.mode ?? 'default';
      const overlayMode: 'asis' | ActionOverlays = action.overlays ?? 'asis';
      return (
        <View style={styles.subBlock}>
          <FieldLabel>PLAYLIST</FieldLabel>
          <Dropdown
            value={action.name || null}
            options={playlists.map((p) => ({ id: p, label: p }))}
            onSelect={(id) => setAction({ ...action, name: id })}
            placeholder="Pick a playlist…"
            emptyHint="Engine reports no playlists."
          />
          <View style={{ height: 8 }} />
          {/* TARGET is deck-only now — the playlist always drives the main deck.
              We keep target on the action so the wire shape stays stable. */}
          <FieldLabel>TARGET</FieldLabel>
          <Text style={styles.hint}>Deck — the main deck (mixer authoring removed).</Text>
          <View style={{ height: 8 }} />
          {/* TRANSITION — deck transition mode override. "Default" emits no
              `transition` field, so the cue inherits the deck's standing config. */}
          <FieldLabel>TRANSITION</FieldLabel>
          <Dropdown
            value={transitionMode}
            options={TRANSITION_OPTIONS}
            onSelect={(id) => {
              if (id === 'default') {
                const next = { ...action };
                delete next.transition;
                setAction(next);
              } else {
                setAction({ ...action, transition: { ...action.transition, mode: id as DeckTransitionMode } });
              }
            }}
          />
          <Text style={[styles.hint, { marginTop: 8 }]}>
            How this cue crossfades onto the deck. Default keeps the deck's current setting.
          </Text>
          {transitionMode !== 'default' ? (
            <View style={{ marginTop: 10 }}>
              <FieldLabel>TRANSITION TIME</FieldLabel>
              <View style={styles.chipRow}>
                {PATTERN_TRANSITION_PRESETS_MS.map((ms) => {
                  const sel = (action.transition?.durationMs ?? -1) === ms;
                  return (
                    <TouchableOpacity
                      key={ms}
                      onPress={() => setAction({ ...action, transition: { mode: transitionMode as DeckTransitionMode, durationMs: ms } })}
                      style={[styles.dayPill, sel && { backgroundColor: C.primary, borderColor: C.primary }]}
                      accessibilityRole="button"
                      accessibilityState={{ selected: sel }}
                      accessibilityLabel={`${ms} millisecond transition time`}
                    >
                      <Text style={[styles.dayPillText, sel && { color: C.onPrimary }]}>
                        {ms >= 1000 ? `${ms / 1000}s` : `${ms}ms`}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <Text style={[styles.hint, { marginTop: 8 }]}>Crossfade time for this cue&apos;s deck swap.</Text>
            </View>
          ) : null}
          <View style={{ height: 8 }} />
          {/* OVERLAYS — cue-level overlay intent. "Leave as-is" emits nothing. */}
          <FieldLabel>OVERLAYS</FieldLabel>
          <Segmented
            options={OVERLAY_OPTIONS}
            value={overlayMode}
            onChange={(id) => {
              if (id === 'asis') {
                const next = { ...action };
                delete next.overlays;
                setAction(next);
              } else {
                setAction({ ...action, overlays: id as ActionOverlays });
              }
            }}
          />
          <Text style={[styles.hint, { marginTop: 8 }]}>
            Overlays = extra pattern layers stacked over the deck; ‘disable’ blacks them out for this cue.
          </Text>
          <View style={{ height: 8 }} />
          <ToggleChip
            on={!!ap.active}
            onToggle={() => {
              if (ap.active) {
                // Turning OFF: drop the autopilot block entirely so the emitted
                // action omits the field (it's optional on a playlist action).
                const next = { ...action };
                delete next.autopilot;
                setAction(next);
              } else {
                // Turning ON: seed a COMPLETE, valid block. The engine's
                // validateAutopilot is strict (active + delay_s>0 + shuffle,
                // no defaults), so we must supply delay_s/shuffle here — not
                // leave them undefined for the operator to (maybe) fill in.
                setAction({
                  ...action,
                  autopilot: {
                    active: true,
                    delay_s: ap.delay_s && ap.delay_s > 0 ? ap.delay_s : 30,
                    shuffle: ap.shuffle ?? false,
                  },
                });
              }
            }}
            label={ap.active ? 'AUTOPILOT ON' : 'AUTOPILOT OFF'}
          />
          {ap.active ? (
            <>
              <View style={{ height: 8 }} />
              <FieldLabel>AUTOPILOT DELAY (SEC)</FieldLabel>
              <Stepper
                value={ap.delay_s ?? 30}
                step={5}
                onChange={(v) => setAction({ ...action, autopilot: { ...ap, delay_s: v } })}
                min={5} max={600}
                format={(v) => `${v}s`}
              />
              <View style={{ height: 8 }} />
              <ToggleChip
                on={!!ap.shuffle}
                onToggle={() => setAction({ ...action, autopilot: { ...ap, shuffle: !ap.shuffle } })}
                label={ap.shuffle ? 'SHUFFLE ON' : 'SHUFFLE OFF'}
              />
            </>
          ) : null}

          {/* COLOR AUTOPILOT — cycles the deck's color palette over time,
              distinct from the pattern autopilot above. Same emit discipline:
              the block is only present while active, and turning it on seeds a
              COMPLETE, valid block (≥1 palette + positive delay_s + shuffle) so
              the emitted JSON can never be active+empty. */}
          <View style={{ height: 12 }} />
          <ToggleChip
            on={!!ca.active}
            onToggle={() => {
              if (ca.active) {
                // Turning OFF: drop the block entirely (optional on the action).
                const next = { ...action };
                delete next.colorAutopilot;
                setAction(next);
              } else {
                // Turning ON requires ≥1 palette — without a palette to seed
                // we can't emit a valid block, so keep the toggle OFF and let
                // the empty-state hint tell the operator why.
                if (paletteOptions.length === 0) return;
                const seedPalette =
                  ca.palettes && ca.palettes.length > 0 ? ca.palettes : [paletteOptions[0].id];
                setAction({
                  ...action,
                  colorAutopilot: {
                    active: true,
                    palettes: seedPalette,
                    delay_s: ca.delay_s && ca.delay_s > 0 ? ca.delay_s : 30,
                    shuffle: ca.shuffle ?? false,
                  },
                });
              }
            }}
            label={ca.active ? 'COLOR AUTOPILOT ON' : 'COLOR AUTOPILOT OFF'}
          />
          {paletteOptions.length === 0 ? (
            <Text style={[styles.hint, { marginTop: 8 }]}>
              No color palettes reported by the engine — color autopilot unavailable.
            </Text>
          ) : null}
          {ca.active ? (
            <>
              <View style={{ height: 8 }} />
              <FieldLabel>COLOR PALETTES</FieldLabel>
              {/* COMPACT, SELECTED-ONLY chips (operator feedback): show only the
                  chosen palettes as removable chips with their REAL c1/c2
                  swatch, plus a "+ ADD" affordance that expands the rest inline.
                  We never render the whole library grid by default. */}
              <View style={[styles.chipRow, { alignItems: 'center' }]}>
                {(ca.palettes ?? []).map((id) => {
                  const p = paletteById.get(id);
                  if (!p) return null;
                  const canRemove = (ca.palettes ?? []).length > 1;
                  return (
                    <TouchableOpacity
                      key={id}
                      disabled={!canRemove}
                      onPress={() => {
                        // Never let the active selection drop to empty (the block
                        // must stay valid while ON) — last chip is non-removable.
                        if (!canRemove) return;
                        const palettes = (ca.palettes ?? []).filter((x) => x !== id);
                        setAction({ ...action, colorAutopilot: { ...ca, active: true, palettes } });
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={`Remove palette ${p.name}`}
                      style={[styles.caChip, { borderColor: C.primary, backgroundColor: C.primary }]}
                    >
                      {typeof p.c1 === 'number' && typeof p.c2 === 'number'
                        ? <DualSwatch h1={p.c1} h2={p.c2} size={14} />
                        : null}
                      <Text style={[styles.caChipText, { color: C.onPrimary }]}>{p.name.toUpperCase()}</Text>
                    </TouchableOpacity>
                  );
                })}
                <TouchableOpacity
                  onPress={() => setCaAdding((v) => !v)}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: caAdding }}
                  accessibilityLabel={caAdding ? 'Close palette picker' : 'Add palettes'}
                  style={[styles.caChip, { borderColor: C.ghostBorder, borderStyle: 'dashed', backgroundColor: 'transparent' }]}
                >
                  <Text style={[styles.caChipText, { color: C.text }]}>{caAdding ? 'DONE' : '+ ADD'}</Text>
                </TouchableOpacity>
              </View>
              {/* Inline library popover — only the UNSELECTED palettes; tap to
                  add. Collapsed by default to keep the sheet compact. */}
              {caAdding ? (
                <View style={styles.caPopover}>
                  <View style={[styles.chipRow, { marginTop: 0 }]}>
                    {paletteOptions.filter((p) => !(ca.palettes ?? []).includes(p.id)).length === 0 ? (
                      <Text style={styles.hint}>All palettes selected.</Text>
                    ) : (
                      paletteOptions.filter((p) => !(ca.palettes ?? []).includes(p.id)).map((p) => (
                        <TouchableOpacity
                          key={p.id}
                          onPress={() => {
                            const palettes = [...(ca.palettes ?? []), p.id];
                            setAction({ ...action, colorAutopilot: { ...ca, active: true, palettes } });
                          }}
                          accessibilityRole="button"
                          accessibilityLabel={`Add palette ${p.name}`}
                          style={[styles.caChip, { borderColor: C.ghostBorder, backgroundColor: 'transparent' }]}
                        >
                          {typeof p.c1 === 'number' && typeof p.c2 === 'number'
                            ? <DualSwatch h1={p.c1} h2={p.c2} size={14} />
                            : null}
                          <Text style={[styles.caChipText, { color: C.text }]}>{p.name.toUpperCase()}</Text>
                        </TouchableOpacity>
                      ))
                    )}
                  </View>
                </View>
              ) : null}
              <View style={{ height: 8 }} />
              <FieldLabel>COLOR DELAY (SEC)</FieldLabel>
              <Stepper
                value={ca.delay_s ?? 30}
                step={5}
                onChange={(v) => setAction({ ...action, colorAutopilot: { ...ca, active: true, palettes: ca.palettes ?? [], delay_s: v } })}
                min={5} max={600}
                format={(v) => `${v}s`}
              />
              <View style={{ height: 8 }} />
              {/* TRANSITION (crossfade) — palette analogue of DECK TX crossfade
                  time. CUT = hard switch; the rest ramp the palette params. */}
              <FieldLabel>COLOR TRANSITION</FieldLabel>
              <Segmented
                options={COLOR_TRANSITION_PRESETS_MS.map((ms) => ({ id: String(ms), label: formatColorTransition(ms) }))}
                value={String(ca.transitionMs ?? 0)}
                onChange={(id) => setAction({ ...action, colorAutopilot: { ...ca, active: true, palettes: ca.palettes ?? [], transitionMs: Number(id) } })}
              />
              <View style={{ height: 8 }} />
              <ToggleChip
                on={!!ca.shuffle}
                onToggle={() => setAction({ ...action, colorAutopilot: { ...ca, active: true, palettes: ca.palettes ?? [], shuffle: !ca.shuffle } })}
                label={ca.shuffle ? 'COLOR SHUFFLE ON' : 'COLOR SHUFFLE OFF'}
              />
            </>
          ) : null}
        </View>
      );
    }
    return null;
  };

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: 24 }}
      >
        <Pressable onPress={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 560, maxHeight: '90%' }}>
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>
                {isDefaultMode ? 'DEFAULT CUE' : (initialCue ? 'EDIT CUE' : 'ADD CUE')}
              </Text>
              {!isDefaultMode && onDelete ? (
                <TouchableOpacity onPress={onDelete} style={styles.trashBtn} accessibilityLabel="Delete cue">
                  <Text style={styles.trashLabel}>DELETE</Text>
                </TouchableOpacity>
              ) : null}
            </View>

            {/* paddingBottom clears the sticky footer (≈48pt button + 16pt
                margin + slack) so the last DAYS / SHUFFLE controls aren't
                hidden behind it. */}
            <ScrollView style={{ maxHeight: 560 }} contentContainerStyle={{ paddingBottom: 80 }} showsVerticalScrollIndicator={false}>
              {/* NAME — the operator-facing label (optional). */}
              <FieldLabel>{isDefaultMode ? 'DEFAULT CUE NAME' : 'CUE NAME'}</FieldLabel>
              <TextInput
                value={label}
                onChangeText={setLabel}
                placeholder={isDefaultMode ? 'Name the default…' : 'Name this cue…'}
                placeholderTextColor={C.icon}
                autoCapitalize="sentences"
                autoCorrect={false}
                style={styles.textInput}
                accessibilityLabel={isDefaultMode ? 'Default cue name' : 'Cue name'}
              />

              {isDefaultMode ? (
                <Text style={[styles.hint, { marginTop: 10 }]}>
                  The default cue is the deck&apos;s standing fallback — it runs in the gaps between
                  planned cues and when the plan has no cues. It has no trigger, kind, or days.
                </Text>
              ) : null}

              {/* KIND / TRIGGER — cue-only (the default cue is not a scheduled event). */}
              {!isDefaultMode ? (
                <>
                  <View style={{ height: 14 }} />
                  <FieldLabel>KIND</FieldLabel>
                  <Segmented
                    options={[
                      { id: 'program', label: 'Program' },
                      { id: 'mood', label: 'Mood' },
                      { id: 'ambient', label: 'Ambient' },
                    ]}
                    value={kind}
                    onChange={(v) => setKind(v as CueKind)}
                  />

                  <View style={{ height: 14 }} />
                  <FieldLabel>TRIGGER</FieldLabel>
                  <Segmented
                    options={[
                      { id: 'clock', label: 'Clock' },
                      { id: 'sun', label: 'Sun' },
                      { id: 'phase', label: 'Phase' },
                      { id: 'mood', label: 'Mood' },
                      { id: 'manual', label: 'Manual' },
                    ]}
                    value={trigger.type}
                    onChange={(v) => setTrigger(makeTrigger(v as CueTrigger['type']))}
                  />
                  {renderTriggerBody()}
                </>
              ) : null}

              {/* ACTION — PLAYLIST only now (look removed; operator decision).
                  No segmented switch: the maker authors a single action type.
                  Reused verbatim by the DEFAULT CUE editor. */}
              <View style={{ height: 14 }} />
              <FieldLabel>ACTION</FieldLabel>
              <Text style={styles.hint}>Playlist — the only cue action (looks removed).</Text>
              {renderActionBody()}

              {/* DURATION — cue-only. A cue owns the deck for this window after it
                  fires; outside it (and in the gaps) the default cue runs. */}
              {!isDefaultMode ? (
                <>
                  <View style={{ height: 14 }} />
                  <FieldLabel>DURATION</FieldLabel>
                  <View style={styles.chipRow}>
                    {DURATION_PRESETS_MIN.map((m) => {
                      const sel = durationMin === m;
                      return (
                        <TouchableOpacity
                          key={m}
                          onPress={() => setDurationMin(m)}
                          style={[styles.dayPill, sel && { backgroundColor: C.primary, borderColor: C.primary }]}
                          accessibilityRole="button"
                          accessibilityState={{ selected: sel }}
                          accessibilityLabel={`${m} minute duration`}
                        >
                          <Text style={[styles.dayPillText, sel && { color: C.onPrimary }]}>
                            {m >= 60 && m % 60 === 0 ? `${m / 60}h` : `${m}m`}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                  <View style={{ marginTop: 8 }}>
                    <Stepper
                      value={durationMin}
                      step={15}
                      onChange={setDurationMin}
                      min={5} max={720}
                      format={(v) => `${v} min`}
                    />
                  </View>
                  <Text style={[styles.hint, { marginTop: 8 }]}>
                    This cue owns the deck for {durationMin} min after it fires; the default cue fills the gaps.
                  </Text>
                </>
              ) : null}

              {/* HOLD (programs only) */}
              {!isDefaultMode && kind === 'program' ? (
                <>
                  <View style={{ height: 14 }} />
                  <FieldLabel>HOLD</FieldLabel>
                  <Segmented
                    options={[{ id: 'none', label: 'None' }, { id: 'min', label: 'Minutes' }]}
                    value={holdMin && holdMin > 0 ? 'min' : 'none'}
                    onChange={(v) => setHoldMin(v === 'min' ? (holdMin || 30) : null)}
                  />
                  {holdMin && holdMin > 0 ? (
                    <View style={{ marginTop: 8 }}>
                      <Stepper
                        value={holdMin}
                        step={15}
                        onChange={setHoldMin}
                        min={5} max={480}
                        format={(v) => `${v} min`}
                      />
                    </View>
                  ) : null}
                </>
              ) : null}

              {/* DAYS — cue-only (the default cue applies to every day/gap). */}
              {!isDefaultMode ? (
                <>
              <View style={{ height: 14 }} />
              <FieldLabel>DAYS</FieldLabel>
              <Segmented
                options={[
                  { id: 'this', label: 'This day' },
                  { id: 'all', label: 'All days' },
                  { id: 'pick', label: 'Pick…' },
                ]}
                value={daysMode}
                onChange={(v) => setDaysMode(v as 'all' | 'this' | 'pick')}
              />
              {daysMode === 'pick' && isDateStringDays ? (
                // Saved as explicit date strings — no grid representation.
                // Show read-only so we never clobber the operator's dates.
                <View style={styles.subBlock}>
                  <Text style={styles.hint}>
                    {`Specific dates: ${(days as string[]).join(', ')} (edit dates in the plan file).`}
                  </Text>
                </View>
              ) : daysMode === 'pick' ? (
                <View style={styles.pickRow}>
                  {Array.from({ length: festivalDays }, (_, i) => i).map((i) => {
                    const sel = Array.isArray(days) && (days as number[]).includes(i);
                    return (
                      <TouchableOpacity
                        key={i}
                        onPress={() => togglePickDay(i)}
                        style={[styles.dayPill, sel && { backgroundColor: C.primary, borderColor: C.primary }]}
                        accessibilityLabel={`Day ${i + 1}`}
                        accessibilityState={{ selected: sel }}
                      >
                        <Text style={[styles.dayPillText, sel && { color: C.onPrimary }]}>{`D${i + 1}`}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              ) : null}
                </>
              ) : null}
            </ScrollView>

            {/* BLOCKED-SAVE reason (e.g. overlapping cue). Sits directly above
                the footer so it's visible regardless of scroll position; only
                renders while a save is blocked. */}
            {saveError ? (
              <View style={styles.errorBanner} accessibilityRole="alert">
                <Text style={styles.errorText}>{saveError}</Text>
              </View>
            ) : null}

            {/* Footer */}
            <View style={styles.footer}>
              <TouchableOpacity onPress={onClose} style={[styles.footerBtn, styles.footerCancel]} accessibilityLabel="Cancel">
                <Text style={[styles.footerBtnText, { color: C.text }]}>CANCEL</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => {
                  if (isDefaultMode) {
                    // Codex P0: fail loud rather than silently no-op if the parent
                    // opened default mode without wiring the save handler.
                    if (!onSaveDefault) throw new Error('CueEditorSheet: defaultCue mode requires onSaveDefault');
                    onSaveDefault(buildDefaultCue());
                  } else {
                    // Validate BEFORE committing: a cue owns the deck for its
                    // window, and two cues can't own it at once on a shared day.
                    const candidate = buildCue();
                    const overlap = findOverlapError(candidate);
                    if (overlap) {
                      // BLOCK the save — surface WHY inline, don't call onSave.
                      setSaveError(overlap);
                      return;
                    }
                    setSaveError(null);
                    onSave(candidate);
                  }
                }}
                style={[styles.footerBtn, { backgroundColor: C.primary }]}
                accessibilityLabel={isDefaultMode ? 'Save default cue' : 'Save cue'}
              >
                <Text style={[styles.footerBtnText, { color: C.onPrimary }]}>
                  {isDefaultMode ? 'SAVE DEFAULT' : (initialCue ? 'SAVE CUE' : 'ADD CUE')}
                </Text>
              </TouchableOpacity>
            </View>
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
    sheetHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 14,
    },
    sheetTitle: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 15,
      letterSpacing: 1,
      color: C.text,
      textTransform: 'uppercase',
    },
    trashBtn: {
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: C.error,
    },
    trashLabel: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 11,
      letterSpacing: 0.6,
      color: C.error,
    },
    subBlock: {
      marginTop: 10,
      padding: 12,
      borderRadius: 10,
      backgroundColor: C.surfaceContainerLowest,
      borderWidth: 1,
      borderColor: C.ghostBorder,
    },
    hint: {
      fontFamily: 'Inter_400Regular',
      fontSize: 12,
      color: C.secondary,
    },
    textInput: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 14,
      color: C.text,
      minHeight: 44,
      paddingVertical: 10,
      paddingHorizontal: 14,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: C.ghostBorder,
      backgroundColor: C.surfaceContainerHigh,
    },
    pickRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      marginTop: 10,
    },
    chipRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      marginTop: 8,
    },
    caChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 10,
      paddingVertical: 7,
      borderRadius: 8,
      borderWidth: 1,
    },
    caChipText: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 11,
      letterSpacing: 0.4,
    },
    caPopover: {
      marginTop: 8,
      padding: 8,
      borderRadius: 8,
      backgroundColor: C.surfaceContainerHigh,
      borderWidth: 1,
      borderColor: C.ghostBorder,
    },
    dayPill: {
      minWidth: 44,
      paddingVertical: 8,
      paddingHorizontal: 10,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: C.ghostBorder,
      alignItems: 'center',
      justifyContent: 'center',
    },
    dayPillText: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 12,
      color: C.text,
    },
    errorBanner: {
      marginTop: 14,
      paddingVertical: 10,
      paddingHorizontal: 12,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: C.error,
      backgroundColor: C.surfaceContainerLowest,
    },
    errorText: {
      fontFamily: 'Inter_400Regular',
      fontSize: 12,
      color: C.error,
    },
    footer: {
      flexDirection: 'row',
      gap: 10,
      marginTop: 16,
    },
    footerBtn: {
      flex: 1,
      minHeight: 48,
      borderRadius: 8,
      alignItems: 'center',
      justifyContent: 'center',
    },
    footerCancel: {
      borderWidth: 1,
      borderColor: C.ghostBorder,
      backgroundColor: 'transparent',
    },
    footerBtnText: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 13,
      letterSpacing: 0.8,
    },
  });
}
