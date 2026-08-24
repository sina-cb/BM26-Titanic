/**
 * CueEditorSheet — themed modal to add / edit a single cue (docs/38 §15.3).
 *
 * Pure pill / stepper / segmented / dropdown inputs — NO keyboard walls.
 * Operates on a LOCAL working copy of a PlanCue; commits via onSave (the
 * parent inserts/replaces in the draft plan and fires a debounced preview).
 *
 *   CUE NAME  text input  the operator-facing label for this cue
 *   KIND      segmented   program | mood | ambient
 *   TRIGGER   segmented   clock | sun | phase | party | mood | manual
 *               clock → HH:MM stepper
 *               sun   → event dropdown + offset ±min stepper
 *               phase → phase dropdown
 *               party → audio sustain/cooldown + optional phase gate
 *               mood  → from/to segmented + dwell/cooldown steppers + whenPhase
 *   ACTION                playlist; manual cues may start a Special Event
 *               playlist → dropdown (GET /playlists), deck-only target,
 *                          TRANSITION (default|crossfade|flash|dissolve),
 *                          OVERLAYS (leave|enable|disable),
 *                          pattern AUTOPILOT + COLOR AUTOPILOT
 *   DAYS      This day | All days | Pick…       (Pick = day-index toggles)
 *
 * PLAYLIST remains the normal cue action. Manual cues may instead select a
 * staged Special Event; clock/sun/party cues never expose that action.
 *
 * Two authoring surfaces REMOVED (operator rulings 2026-08-03), both engine-
 * intact — see cue_edit_logic.ts for the pinned round-trip rules:
 *   - HOLD: gone from the UI ("remove hold from the cue UI to avoid
 *     confusion, but keep it for the party"). An existing cue.hold round-trips
 *     through an edit UNTOUCHED; new cues emit none (engine: holds until the
 *     next program). The party program's hold in the plan YAML stays.
 *   - cue-level `size` global: unused in cues. Accepted on read, shed on
 *     save, never shown. The DECK-level size global is a real control and is
 *     not affected.
 */
import React, { useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Modal, Pressable, StyleSheet } from 'react-native';
import { CAPTAIN_PAD_MODAL_SUPPORTED_ORIENTATIONS } from '@/utils/modal_orientation';
import { Palette } from '@/constants/theme';
import { usePalette } from '@/hooks/use-theme';
import {
  PlanCue, PlanDefaultCue, CueKind, CueTrigger, CueAction, ActionPlaylist, ActionSpecialEvent, SunEvent, CueDays, ShowPlan,
  DeckTransitionMode, ActionOverlays, PlanAutopilotInline,
} from '@/utils/timelineApi';
import {
  hhmmToMinutes, minutesToHHMM, minutesTo12h, hhmmTo12h, SUN_EVENT_OPTIONS, MOOD_VALUES,
} from './timelineTemplate';
import { Segmented, Stepper, Dropdown, ToggleChip, FieldLabel } from './makerControls';
import {
  assembleCue,
  DEFAULT_CUE_DURATION_MIN,
  defaultCuePlaylistAction,
  isPartyCueTrigger,
  partyPlaylistActionForEditor,
  programCueAutopilotError,
  stripEmptyCuePalette,
  stripCueSizeGlobal,
  wireDaysForOperatorDay,
  wireDayToOperatorDay,
} from './cue_edit_logic';
import { DayTimePicker, DayTimeContextCue } from './DayTimePicker';
import { DeckTransitionControls } from '@/components/DeckTransitionControls';
import { PatternAutopilotPanel } from '@/components/deck/pattern_autopilot_panel';
import { HorizontalFader } from '@/components/ui/HorizontalFader';
import { LockableScrollView } from '@/components/ui/lockable_scroll_view';
import { CueColorThemeEditor } from './cue_color_theme_editor';
import { normalizeCueColorAutopilot } from './cue_color_theme_logic';
import { useSpecialEvents } from '@/hooks/useSpecialEvents';
import {
  isPartyWindowImplementationCue,
  partyWindowDaysSummary,
  partyWindowSeed,
  partyWindowStartDays,
  type PartyWindowSpec,
} from './party_window_logic';

// HSV(h°, 1, 1) → #rrggbb for the HUE fader fill (ColorPickerModal's
// hsvToRgbString is module-private, so we restate the few lines here). Full
// saturation + value so the swatch reads as the pure hue at that degree.
function hueToHex(deg: number): string {
  const h = (((deg % 360) + 360) % 360) / 60;
  const c = 1;
  const x = c * (1 - Math.abs((h % 2) - 1));
  let r = 0, g = 0, b = 0;
  if (h < 1) { r = c; g = x; }
  else if (h < 2) { r = x; g = c; }
  else if (h < 3) { g = c; b = x; }
  else if (h < 4) { g = x; b = c; }
  else if (h < 5) { r = x; b = c; }
  else { r = c; b = x; }
  const to = (v: number) => Math.round(v * 255).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

// A titled CARD wrapper matching the live deck's autopilot cards (surfaceContainerHigh
// bg + ghostBorder + rounded, small uppercase header). `right` hosts the section's
// ON/OFF ToggleChip so the header row reads like the deck's card headers.
function ActionCard({ title, right, children }: { title: string; right?: React.ReactNode; children?: React.ReactNode }) {
  const C = usePalette();
  return (
    <View style={{ marginTop: 12, padding: 12, borderRadius: 10, backgroundColor: C.surfaceContainerHigh, borderWidth: 1, borderColor: C.ghostBorder, gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10, letterSpacing: 1.2, color: C.secondary, textTransform: 'uppercase' }}>{title}</Text>
        {right ?? null}
      </View>
      {children}
    </View>
  );
}

// Inherit-vs-override control for the playlist action's deck transition. "Deck
// default" means DON'T emit a `transition` field — the cue inherits the deck's
// standing Deck TX config. "Custom" emits a full `transition` block edited via
// the shared DeckTransitionControls (all 16 blends + time + shuffle).
const TRANSITION_SOURCE_OPTIONS: { id: 'default' | 'custom'; label: string }[] = [
  { id: 'default', label: 'Deck default' },
  { id: 'custom', label: 'Custom' },
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
const CUE_DURATION_PRESETS_MIN = [0.5, 5, 15, 30, 60, 90, 120, 180];

function formatDurationMinutes(minutes: number): string {
  if (minutes < 1) return `${Math.round(minutes * 60)} sec`;
  if (minutes >= 60 && minutes % 60 === 0) return `${minutes / 60}h`;
  return `${minutes} min`;
}

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
  if (cue.trigger.type === 'manual') return hhmmToMinutes(cue.trigger.placementAt ?? null);
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
    // Generic Mood defaults to the non-PARTY direction. A calm→party
    // transition is authored through the dedicated PARTY mode below.
    case 'mood': return { type: 'mood', from: 'party', to: 'calm', minDwellSec: 30, cooldownSec: 300 };
    case 'manual': return { type: 'manual', placementAt: '20:00' };
  }
}

type TriggerEditorMode = CueTrigger['type'] | 'party';

function defaultPartyTrigger(): CueTrigger {
  return {
    type: 'mood',
    from: 'calm',
    to: 'party',
    minDwellSec: 30,
    cooldownSec: 300,
  };
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

function nextCueLabel(plan: ShowPlan, prefix: 'Cue' | 'Party'): string {
  const used = new Set<number>();
  const pattern = new RegExp(`^${prefix}\\s+(\\d+)$`, 'i');
  for (const cue of plan.cues ?? []) {
    const match = pattern.exec(cue.label?.trim() ?? '');
    if (match) used.add(Number(match[1]));
  }
  let index = 1;
  while (used.has(index)) index += 1;
  return `${prefix} ${index}`;
}

function isPrefilledCueLabel(value: string): boolean {
  return /^(?:Cue|Party)\s+\d+$/i.test(value.trim());
}

/** Copy all Deck behavior while keeping each Party state's playlist independent. */
function copyPlaylistSettings(source: ActionPlaylist, destination: ActionPlaylist): ActionPlaylist {
  const { name: _sourceName, ...settings } = source;
  return {
    ...destination,
    ...settings,
    name: destination.name,
    target: { channel: 'deck', id: null },
  };
}

function stripPlaylistSizeGlobal(source: ActionPlaylist): ActionPlaylist {
  const stripped = stripCueSizeGlobal(source);
  if (stripped.type !== 'playlist') {
    throw new Error('Playlist normalization changed the action type.');
  }
  return stripped;
}

export type CueSaveResult =
  | { ok: true }
  | { ok: false; error: string };

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
  onSave: (cue: PlanCue, partyWindow?: PartyWindowSpec) => Promise<CueSaveResult>;
  /** Called (mode==='defaultCue' only) with the edited plan default cue. */
  onSaveDefault?: (dc: PlanDefaultCue) => Promise<CueSaveResult>;
  onDelete: (() => void) | null;
  onClose: () => void;
}) {
  const isDefaultMode = mode === 'defaultCue';
  const C = usePalette();
  const styles = useMemo(() => makeStyles(C), [C]);
  const { state: specialEventsState } = useSpecialEvents();

  const paletteOptions = palettes ?? [];
  const phaseNames = Object.keys(plan.phases);
  const specialEventShows = useMemo(
    () => (specialEventsState?.catalog.shows ?? []).filter((show) => show.playlistsUsable),
    [specialEventsState?.catalog.shows],
  );

  // Fresh trigger for a given type. CLOCK gets the smart "~5 min from now"
  // default (plan tz) instead of a fixed time — used when seeding a NEW cue
  // and when the operator switches the TRIGGER segmented control. Opening an
  // EXISTING cue still seeds its stored trigger untouched.
  const makeTrigger = (type: CueTrigger['type']): CueTrigger =>
    type === 'clock'
      ? { type: 'clock', at: smartDefaultClockAt(plan.location.tz) }
      : type === 'manual'
        ? { type: 'manual', placementAt: smartDefaultClockAt(plan.location.tz) }
      : defaultTrigger(type);
  const makeEditorTrigger = (mode: TriggerEditorMode): CueTrigger =>
    mode === 'party' ? defaultPartyTrigger() : makeTrigger(mode);

  type DaysMode = 'all' | 'this' | 'pick';

  // Extract the clock "HH:MM" from a cue's trigger when it has an editor-
  // resolvable time-of-day anchor. Morning-clock cues stored on wire day D+1
  // belong to operator day D — we need the clock to reverse that mapping.
  const clockOfTrigger = (t: CueTrigger | undefined): string | null => {
    if (!t) return null;
    if (t.type === 'clock') return t.at;
    if (t.type === 'manual') return t.placementAt ?? null;
    return null;
  };

  // Classify a saved `days` value into an initial segmented mode. A date-string
  // array (e.g. ['2026-08-31']) has no grid representation, so we surface it as
  // 'pick' (read-only) rather than clobbering it. A single wire-day array is
  // rewound through operator-day math so a 9 AM cue stored on wire day D+1
  // still reads as "this day" on operator day D's card.
  const initialDaysMode = (
    d: CueDays | undefined,
    trigger: CueTrigger | undefined,
  ): DaysMode => {
    if (d === 'all' || d === undefined) return 'all';
    if (Array.isArray(d) && d.length === 1 && typeof d[0] === 'number') {
      const wireDay = d[0] as number;
      const operatorDay = wireDayToOperatorDay(wireDay, clockOfTrigger(trigger));
      if (operatorDay === dayIndex) return 'this';
    }
    return 'pick';
  };

  // Working copy. Re-seeded each time the sheet opens with a different cue.
  const [kind, setKind] = useState<CueKind>('program');
  const [label, setLabel] = useState<string>('');
  const [trigger, setTrigger] = useState<CueTrigger>(defaultTrigger('clock'));
  const [action, setAction] = useState<CueAction>(defaultCuePlaylistAction());
  // NOTE: no hold state — HOLD left the cue UI (operator ruling 2026-08-03).
  // An existing cue.hold rides through assembleCue's spread untouched.
  // Cue DURATION (minutes) — REQUIRED. A cue always owns the deck for this window
  // after it fires (operator: "new CUEs must have a duration, no None"). Default 30 sec.
  const [durationMin, setDurationMin] = useState<number>(DEFAULT_CUE_DURATION_MIN);
  const [partyStartAt, setPartyStartAt] = useState<string>('20:00');
  const [partyWindowDurationMin, setPartyWindowDurationMin] = useState<number>(240);
  const [partyAction, setPartyAction] = useState<ActionPlaylist>(defaultCuePlaylistAction());
  const [partySessionDurationMin, setPartySessionDurationMin] = useState<number>(12);
  const [days, setDays] = useState<CueDays>('all');
  // DAYS mode is EXPLICIT state, driven by the segmented control — NOT derived
  // from `days` on every render (deriving made "Pick…" snap back to "This day").
  const [daysMode, setDaysModeState] = useState<DaysMode>('all');
  const [seedKey, setSeedKey] = useState<string>('');
  // Inline validation error surfaced near the SAVE button. Set when a save is
  // BLOCKED (e.g. overlapping cue); cleared on the next save attempt. null =
  // no error (nothing renders).
  const [saveError, setSaveError] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);
  const partyTrigger = isPartyCueTrigger(trigger);

  // Seed when the sheet OPENS or its target changes. Merely putting `visible`
  // in the key is insufficient: hidden renders intentionally do not seed, so
  // close→reopen would otherwise compare the same `v:` key and preserve stale
  // state (including a successful save's VALIDATING flag).
  const wasVisibleRef = useRef(false);
  const opening = visible && !wasVisibleRef.current;
  wasVisibleRef.current = visible;
  const wantKey = `${mode}:${initialCue?.id ?? 'new'}:${dayIndex}`;
  if (visible && (opening || wantKey !== seedKey)) {
    setSeedKey(wantKey);
    setSaveError(null); // fresh sheet → clear any stale blocked-save message
    setValidating(false);
    if (isDefaultMode) {
      // DEFAULT CUE: only label + action apply. Normalise a non-playlist action
      // to a fresh deck playlist so the editor always has something to render.
      const dc = initialDefaultCue ?? null;
      setLabel(dc?.label || '');
      // Legacy `size` is shed at load (accept-and-ignore, never re-emitted).
      setAction(dc && dc.action.type === 'playlist' ? stripCueSizeGlobal(dc.action) : defaultCuePlaylistAction());
      // The following are inert in default mode but reset for hygiene.
      setKind('program');
      setTrigger(defaultTrigger('manual'));
      setDurationMin(DEFAULT_CUE_DURATION_MIN);
      setPartyStartAt('20:00');
      setPartyWindowDurationMin(240);
      setPartyAction(defaultCuePlaylistAction());
      setPartySessionDurationMin(12);
      setDays('all');
      setDaysModeState('all');
    } else if (initialCue) {
      setKind(initialCue.kind || (initialCue.trigger.type === 'mood' ? 'mood' : 'program'));
      setLabel(initialCue.label || '');
      setTrigger(initialCue.trigger);
      const partySeed = partyWindowSeed(plan, initialCue);
      const legacyPartyAction = isPartyCueTrigger(initialCue.trigger)
        ? partyPlaylistActionForEditor(initialCue, plan.looks)
        : null;
      const defaultBaselineAction = isPartyCueTrigger(initialCue.trigger) && plan.defaultCue
        ? partyPlaylistActionForEditor(
            { ...initialCue, action: plan.defaultCue.action },
            plan.looks,
          )
        : null;
      // A hand-authored cue could carry a look/globals action; the maker only
      // edits playlist actions, so normalise anything else to a fresh playlist
      // so the editor never gets stuck on an action it can't render. Legacy
      // `size` is shed at load (accept-and-ignore, never re-emitted). The
      // cue's hold (if any) is NOT loaded — it round-trips via assembleCue.
      setAction(
        partySeed
          ? stripCueSizeGlobal(partySeed.baselineAction)
          : isPartyCueTrigger(initialCue.trigger) && defaultBaselineAction
            ? stripCueSizeGlobal(defaultBaselineAction)
          : initialCue.action.type === 'playlist'
            ? stripCueSizeGlobal(initialCue.action)
          : initialCue.action.type === 'special_event'
            ? initialCue.action
            : partyPlaylistActionForEditor(initialCue, plan.looks) ?? defaultCuePlaylistAction(),
      );
      // DURATION is required; seed from a saved positive durationMin, else 60.
      setDurationMin(
        typeof initialCue.durationMin === 'number' && initialCue.durationMin > 0
          ? initialCue.durationMin
          : DEFAULT_CUE_DURATION_MIN,
      );
      setPartyStartAt(partySeed?.startAt ?? smartDefaultClockAt(plan.location.tz));
      setPartyWindowDurationMin(partySeed?.windowDurationMin ?? 240);
      setPartyAction(
        partySeed
          ? stripPlaylistSizeGlobal(partySeed.partyAction)
          : legacyPartyAction
            ? stripPlaylistSizeGlobal(legacyPartyAction)
            : defaultCuePlaylistAction(),
      );
      setPartySessionDurationMin(partySeed?.sessionDurationMin ?? initialCue.durationMin ?? 12);
      setDays(initialCue.days ?? 'all');
      setDaysModeState(initialDaysMode(initialCue.days, initialCue.trigger));
    } else {
      setKind('program');
      setLabel(nextCueLabel(plan, 'Cue'));
      // NEW cue: the clock trigger defaults to ~5 min from NOW in the plan tz,
      // snapped up to the next comfortable 5-minute boundary (smartDefaultClockAt).
      setTrigger(makeTrigger('clock'));
      setAction(defaultCuePlaylistAction());
      // A cue is an EVENT with a REQUIRED duration; a fresh cue defaults to 30 sec
      // (renders as a deck-owned block on the day overview).
      setDurationMin(DEFAULT_CUE_DURATION_MIN);
      setPartyStartAt(smartDefaultClockAt(plan.location.tz));
      setPartyWindowDurationMin(240);
      setPartyAction(defaultCuePlaylistAction());
      setPartySessionDurationMin(12);
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

  // The explicit "which calendar day does this window open on" line rendered
  // under DAYS for a Party Window. Null only while the working clock/length are
  // not yet a resolvable window (the summary builder rejects those loudly, and
  // a render is the one place we must not throw).
  const partyDaysSummary = partyTrigger
    && hhmmToMinutes(partyStartAt) !== null
    && partyWindowDurationMin > 0
    && partyWindowDurationMin <= 1440
    ? partyWindowDaysSummary({
      plan,
      days,
      startAt: partyStartAt,
      windowDurationMin: partyWindowDurationMin,
    })
    : null;

  // Serialize the operator-day `days` selection to the wire-day form the
  // engine consumes. Only numeric arrays are rewound (date-string arrays or
  // 'all' pass through untouched). Each numeric operator-day index maps to a
  // wire day via the same 6 PM boundary math as the calendar view, so a 9 AM
  // cue on operator day 0 becomes wire day 1 and shows on operator day 0's
  // card exactly where it was authored. Returns an overflow error when a
  // numeric entry rolls past the festival span so the caller can fail loudly.
  const wireDaysForOperatorSelection = (
    selection: CueDays | undefined,
    atHHMM: string | null,
  ): { days: CueDays | undefined; overflowError: string | null } => {
    if (selection === undefined || selection === 'all') {
      return { days: selection, overflowError: null };
    }
    if (!Array.isArray(selection)) {
      return { days: selection, overflowError: null };
    }
    if (selection.every((d) => typeof d === 'string')) {
      return { days: selection, overflowError: null };
    }
    const mapped: number[] = [];
    let overflowError: string | null = null;
    for (const entry of selection as (number | string)[]) {
      if (typeof entry !== 'number') continue;
      const res = wireDaysForOperatorDay(entry, atHHMM, festivalDays);
      if (res.overflowError) {
        overflowError ??= res.overflowError;
        continue;
      }
      for (const wireDay of res.wireDays) {
        if (!mapped.includes(wireDay)) mapped.push(wireDay);
      }
    }
    mapped.sort((a, b) => a - b);
    return {
      days: mapped.length > 0 ? mapped : selection,
      overflowError,
    };
  };

  // The plan's OTHER cues resolvable on the SELECTED day, for the visual day
  // pane's context blocks. Only CLOCK triggers have a client-resolvable start
  // (same limitation as the overlap check) — sun/phase/mood/manual cues are
  // skipped rather than guessed. Date-string day-sets are skipped too (no
  // index representation). The cue being edited is excluded by id.
  const dayContextCues = useMemo<DayTimeContextCue[]>(() => {
    const out: DayTimeContextCue[] = [];
    for (const c of plan.cues ?? []) {
      if (initialCue && c.id === initialCue.id) continue;
      if (isPartyWindowImplementationCue(c, plan.cues ?? [])) continue;
      const d = c.days;
      // A cue belongs to the currently-editing operator day when its wire-day
      // set contains either D (evening half) or D+1 (morning half, rolled back
      // via wireDayToOperatorDay). 'all'/undefined naturally match every day.
      const partySeed = partyWindowSeed(plan, c);
      const start = partySeed
        ? hhmmToMinutes(partySeed.startAt)
        : cueStartMinutes(c);
      if (start === null) continue;
      const clock = partySeed?.startAt
        ?? (c.trigger.type === 'clock'
          ? c.trigger.at
          : c.trigger.type === 'manual'
            ? c.trigger.placementAt ?? null
            : null);
      const onDay = (() => {
        if (d === 'all' || d === undefined) return true;
        if (!Array.isArray(d)) return false;
        return (d as (number | string)[]).some((entry) => {
          if (typeof entry !== 'number') return false;
          // A Party Window's days are CALENDAR days anchored on the day it
          // opens (THE PARTY WINDOW DAY RULE) — no operator-day rewind.
          if (partySeed) return entry === dayIndex;
          return wireDayToOperatorDay(entry, clock) === dayIndex;
        });
      })();
      if (!onDay) continue;
      out.push({
        startMinutes: start,
        durationMin: partySeed?.windowDurationMin
          ?? (typeof c.durationMin === 'number' && c.durationMin > 0 ? c.durationMin : 0),
        kind: c.kind ?? 'program',
        label: c.label,
      });
    }
    return out;
  }, [plan, dayIndex, initialCue]);

  // Normalize the working ACTION into a valid, emittable CueAction. Shared by
  // buildCue and buildDefaultCue so the deck-target / autopilot / color-autopilot
  // discipline is identical in both paths.
  const buildNormalizedAction = (source: CueAction = action): CueAction => {
    let outAction: CueAction = source;
    if (source.type === 'playlist') {
      // Force the deck-only target (mixer authoring removed) and NORMALIZE the
      // optional autopilot block so the emitted JSON always satisfies the
      // engine's strict validateAutopilot (active + delay_s>0 + shuffle, no
      // defaults). We emit `autopilot` ONLY when active===true; an inactive /
      // absent block is OMITTED (it's optional on a playlist action). When we
      // do emit it, delay_s is clamped to a positive value (default 30) and
      // shuffle defaults to false — guaranteeing validity regardless of the
      // order the operator touched the autopilot controls.
      const pl: ActionPlaylist = { ...source, target: { channel: 'deck' as const, id: null } };
      // The AUTOPILOT PATTERNS card gates on BLOCK PRESENCE (card ON = block
      // present), and the reused panel's PLAY/PAUSE drives `active`. So emit the
      // block whenever it's present — preserving active:false ("this cue PAUSES
      // autopilot", a legal, meaningful wire state) instead of dropping it — and
      // CARRY the GROUP LOCALITY fields the card authors (groupMode/groupSize/
      // groupDwell); the engine validates + applies them on a cue (commit
      // c775790). Only card OFF (absent block) omits it. delay_s clamps positive,
      // shuffle defaults false, so the emitted JSON always satisfies the engine's
      // strict validateAutopilot regardless of the order the operator toggled.
      if (pl.autopilot) {
        const a = pl.autopilot;
        const norm: PlanAutopilotInline = {
          active: !!a.active,
          delay_s: typeof a.delay_s === 'number' && a.delay_s > 0 ? a.delay_s : 30,
          shuffle: a.shuffle ?? false,
        };
        if (a.groupMode !== undefined) norm.groupMode = !!a.groupMode;
        if (typeof a.groupSize === 'number') norm.groupSize = a.groupSize;
        if (typeof a.groupDwell === 'number') norm.groupDwell = a.groupDwell;
        pl.autopilot = norm;
      } else {
        delete pl.autopilot;
      }
      // COLOR THEME — same PRESENCE discipline as pattern autopilot. The pure
      // normalizer preserves active:false and accepts every Deck color mode:
      // saved palettes, two-tone crossfade (`delay_s:0` included), five-tone
      // rotation, and Follow Note sampling. Invalid hand-authored state fails
      // loudly into the sheet's SAVE error instead of being silently clamped.
      const ca = pl.colorAutopilot;
      if (ca) {
        pl.colorAutopilot = normalizeCueColorAutopilot(ca);
      } else {
        delete pl.colorAutopilot;
      }
      outAction = pl;
    }
    // Shed the legacy cue-level `size` on EVERY emit path (cue + default cue):
    // accepted when reading an old plan, never written back.
    return stripEmptyCuePalette(stripCueSizeGlobal(outAction));
  };

  // Assembly (spread-the-original + overlay managed fields) lives in the PURE
  // cue_edit_logic.assembleCue so the hold round-trip and the size shed are
  // pinned by plain-node vitest. Notably: `hold` is NOT touched here — an
  // existing cue keeps its hold byte-identical; a new cue emits none. `days`
  // is rewound from operator-day to wire-day via wireDaysForOperatorSelection
  // so a 9 AM cue authored on operator day D serializes to wire day D+1 and
  // still lands on operator day D's calendar card on the next read.
  const buildCue = (): { cue: PlanCue; overflowError: string | null } => {
    const clock = trigger.type === 'clock'
      ? trigger.at
      : trigger.type === 'manual'
        ? trigger.placementAt ?? null
        : null;
    // A PARTY WINDOW's days are CALENDAR festival days anchored on the day the
    // window OPENS — the engine resolves them against `nightStartMs`, never
    // against a 6 PM operator boundary. Running them through the operator-day
    // shift moved a daytime window (09:00 → 17:00) onto the next day.
    // See THE PARTY WINDOW DAY RULE in party_window_logic.ts.
    const serialised = partyTrigger
      ? partyWindowStartDays(days, festivalDays)
      : wireDaysForOperatorSelection(days, clock);
    // `days: CueDays` is required by `assembleCue`. When the caller left it
    // undefined we fall back to the schema default 'all' — an "any-day" cue.
    // The picker only produces undefined when nothing was picked; this matches
    // the plan validator's default behaviour and avoids a silent drop.
    const resolvedDays: CueDays = serialised.days ?? 'all';
    return {
      cue: assembleCue({
        initial: initialCue,
        kind: partyTrigger ? 'mood' : kind,
        trigger,
        action: partyTrigger
          ? buildNormalizedAction(partyAction)
          : buildNormalizedAction(),
        days: resolvedDays,
        label,
        durationMin: partyTrigger ? partySessionDurationMin : durationMin,
      }),
      overflowError: serialised.overflowError,
    };
  };

  const buildPartyWindowSpec = (): PartyWindowSpec => {
    const baselineAction = buildNormalizedAction();
    const detectedPartyAction = buildNormalizedAction(partyAction);
    if (baselineAction.type !== 'playlist') {
      throw new Error('Party Window baseline must be a playlist action.');
    }
    if (detectedPartyAction.type !== 'playlist') {
      throw new Error('Detected Party state must be a playlist action.');
    }
    return {
      startAt: partyStartAt,
      windowDurationMin: partyWindowDurationMin,
      baselineAction,
      partyAction: detectedPartyAction,
      minDwellSec: trigger.type === 'mood' ? (trigger.minDwellSec ?? 30) : 30,
      sessionDurationMin: partySessionDurationMin,
      cooldownSec: trigger.type === 'mood' ? (trigger.cooldownSec ?? 120) : 120,
    };
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

  // Validate first, mutate second. The parent submits a complete candidate plan
  // to the engine validator and inserts/replaces this cue only after a 2xx
  // response. A schema error OR an unreachable validator leaves the draft and
  // modal untouched, with the reason rendered beside the save controls.
  const validateAndSave = async () => {
    if (validating) return;
    setSaveError(null);
    try {
      if (isDefaultMode) {
        if (!onSaveDefault) {
          throw new Error('CueEditorSheet: defaultCue mode requires onSaveDefault');
        }
        setValidating(true);
        const result = await onSaveDefault(buildDefaultCue());
        if (!result.ok) {
          setSaveError(result.error);
          setValidating(false);
        }
        return;
      }

      const { cue: candidate, overflowError } = buildCue();
      if (overflowError) {
        setSaveError(overflowError);
        return;
      }
      const autopilotSafety = programCueAutopilotError(candidate);
      if (autopilotSafety) {
        setSaveError(autopilotSafety);
        return;
      }
      const overlap = findOverlapError(candidate);
      if (overlap) {
        setSaveError(overlap);
        return;
      }
      setValidating(true);
      const result = await onSave(candidate, partyTrigger ? buildPartyWindowSpec() : undefined);
      if (!result.ok) {
        setSaveError(result.error);
        setValidating(false);
      }
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Cue validation failed.');
      setValidating(false);
    }
  };

  // ── Trigger sub-editors ──
  const renderTriggerBody = () => {
    if (trigger.type === 'clock') {
      const mins = hhmmToMinutes(trigger.at) ?? 1200;
      return (
        <View style={styles.subBlock}>
          <FieldLabel>PLACE ON DAY</FieldLabel>
          {/* The visual picker snaps to a comfortable 15-minute grid. Keep
              these five-minute steppers immediately above it as the explicit
              precision adjustment the operator requested. */}
          <Text style={[styles.hint, { marginBottom: 8, color: C.text }]}>
            {`EXACT START · ${minutesTo12h(mins)} · adjust in 5-minute steps`}
          </Text>
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
              sets START (15-min snap), dragging the block's bottom-edge pill
              sets DURATION. Two-way synced with the steppers above and the
              DURATION presets/stepper below (all drive the same state). Sun
              shading is omitted here — the sheet has no overview sun table
              (see DayTimePicker header). min/max mirror the DURATION stepper. */}
          <View style={{ height: 8 }} />
          <DayTimePicker
            startMinutes={mins}
            durationMin={durationMin}
            kind={kind}
            others={dayContextCues}
            onChangeStart={(m) => setTrigger({ type: 'clock', at: minutesToHHMM(m) })}
            onChangeDuration={setDurationMin}
            minDuration={0.5}
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
    if (partyTrigger && trigger.type === 'mood') {
      const startMinutes = hhmmToMinutes(partyStartAt) ?? 1200;
      return (
        <View style={styles.subBlock}>
          <Text style={styles.hint}>
            PARTY WINDOW is a timed period on the calendar. Its baseline playlist
            runs normally; only sustained party music may temporarily switch to
            the detected-party playlist.
          </Text>
          <View style={{ height: 8 }} />
          <FieldLabel>PLACE ON DAY</FieldLabel>
          <Text style={[styles.hint, { marginBottom: 8, color: C.text }]}>
            {`EXACT START · ${minutesTo12h(startMinutes)} · adjust in 5-minute steps`}
          </Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Stepper
                value={Math.floor(startMinutes / 60)}
                onChange={(hour) => setPartyStartAt(minutesToHHMM(hour * 60 + (startMinutes % 60)))}
                min={0}
                max={23}
                wrap
                format={(hour) => `${String(hour).padStart(2, '0')}h`}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Stepper
                value={startMinutes % 60}
                step={5}
                onChange={(minute) => setPartyStartAt(minutesToHHMM(Math.floor(startMinutes / 60) * 60 + minute))}
                min={0}
                max={55}
                wrap
                format={(minute) => `${String(minute).padStart(2, '0')}m`}
              />
            </View>
          </View>
          <View style={{ height: 8 }} />
          <DayTimePicker
            startMinutes={startMinutes}
            durationMin={partyWindowDurationMin}
            kind="mood"
            others={dayContextCues}
            onChangeStart={(m) => setPartyStartAt(minutesToHHMM(m))}
            onChangeDuration={setPartyWindowDurationMin}
            minDuration={5}
            maxDuration={720}
          />
          <View style={{ height: 12 }} />
          <FieldLabel>SUSTAIN BEFORE TRIGGER</FieldLabel>
          <Stepper
            value={trigger.minDwellSec ?? 0}
            step={15}
            onChange={(v) => setTrigger({ ...trigger, minDwellSec: v })}
            min={0} max={1800}
            format={(v) => `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`}
          />
          <Text style={[styles.hint, { marginTop: 6 }]}>
            Party audio must remain strong for this long before the cue fires.
          </Text>
          <View style={{ height: 8 }} />
          <FieldLabel>COOLDOWN AFTER SESSION</FieldLabel>
          <Stepper
            value={trigger.cooldownSec ?? 0}
            step={60}
            onChange={(v) => setTrigger({ ...trigger, cooldownSec: v })}
            min={0} max={7200}
            format={(v) => `${Math.round(v / 60)} min`}
          />
          <Text style={[styles.hint, { marginTop: 8 }]}>
            Outside this window, party detection cannot switch playlists. LIVE can
            enable or disable detection without changing the saved window.
          </Text>
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
    const manualMinutes = hhmmToMinutes(trigger.placementAt) ?? 1200;
    return (
      <View style={styles.subBlock}>
        <Text style={styles.hint}>
          Manual cues fire only when the operator taps FIRE. Placement organizes
          the cue on the calendar; it never schedules an automatic trigger.
        </Text>
        <View style={{ height: 8 }} />
        <FieldLabel>PLACE ON DAY</FieldLabel>
        <Text style={[styles.hint, { marginBottom: 8, color: C.text }]}>
          {`PLANNED TIME · ${minutesTo12h(manualMinutes)} · adjust in 5-minute steps`}
        </Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Stepper
              value={Math.floor(manualMinutes / 60)}
              onChange={(hour) => setTrigger({
                ...trigger,
                placementAt: minutesToHHMM(hour * 60 + (manualMinutes % 60)),
              })}
              min={0}
              max={23}
              wrap
              format={(hour) => `${String(hour).padStart(2, '0')}h`}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Stepper
              value={manualMinutes % 60}
              step={5}
              onChange={(minute) => setTrigger({
                ...trigger,
                placementAt: minutesToHHMM(Math.floor(manualMinutes / 60) * 60 + minute),
              })}
              min={0}
              max={55}
              wrap
              format={(minute) => `${String(minute).padStart(2, '0')}m`}
            />
          </View>
        </View>
        <View style={{ height: 8 }} />
        <DayTimePicker
          startMinutes={manualMinutes}
          durationMin={durationMin}
          kind={kind}
          others={dayContextCues}
          onChangeStart={(minute) => setTrigger({
            ...trigger,
            placementAt: minutesToHHMM(minute),
          })}
          onChangeDuration={setDurationMin}
          minDuration={0.5}
          maxDuration={720}
        />
      </View>
    );
  };

  // ── Action sub-editors ──
  const renderActionBody = (
    editedAction: CueAction = action,
    updateAction: (next: CueAction) => void = setAction,
  ) => {
    if (editedAction.type === 'special_event') {
      return (
        <View style={styles.subBlock}>
          <FieldLabel>SPECIAL EVENT</FieldLabel>
          <Dropdown
            value={editedAction.showId || null}
            options={specialEventShows.map((show) => ({ id: show.id, label: show.name }))}
            onSelect={(showId) => updateAction({ type: 'special_event', showId })}
            placeholder="Choose an event…"
            emptyHint="No Special Events are usable in this scene."
          />
          <Text style={[styles.hint, { marginTop: 8 }]}>
            FIRE arms the selected event and starts its first stage. Continue its
            protected stages and choices from the Events tab.
          </Text>
        </View>
      );
    }
    if (editedAction.type !== 'playlist') return null;
    const pl = editedAction;
    const ap = pl.autopilot ?? {};
    const ca = pl.colorAutopilot;
    // Each rich section is gated by BLOCK PRESENCE, not the block's `active`
    // flag: the outer ON/OFF adds/removes the whole override, while the reused
    // deck card's own PLAY/PAUSE drives `active` inside it. (Tracking `active`
    // here would make an in-panel PAUSE collapse the card out from under the
    // operator.) buildNormalizedAction preserves an inactive block on save.
    const apOn = pl.autopilot !== undefined;
    const caOn = pl.colorAutopilot !== undefined;
    const hueOn = typeof pl.hue === 'number';
    const transitionSource: 'default' | 'custom' = pl.transition ? 'custom' : 'default';
    const overlayMode: 'asis' | ActionOverlays = pl.overlays ?? 'asis';
    const hueDeg = typeof pl.hue === 'number' ? pl.hue : 0;
    // GLOBALS (SPEED/SYNC) — block presence gates the card; seeded on enable
    // so the emitted JSON always carries both. speed is a CPC param in [0,1];
    // bpmSpeedSync is the SYNC toggle (0|1). Cue-level SIZE was removed
    // (operator ruling 2026-08-03) — legacy values are shed at load/emit.
    const glOn = pl.globals !== undefined;
    const gl = pl.globals ?? {};
    const speedVal = typeof gl.speed === 'number' ? gl.speed : 0.5;
    const syncOn = (gl.bpmSpeedSync ?? 0) >= 0.5;

    return (
      <>
        {/* 1. PLAYLIST — a cue NAMES a playlist; deck-only target. */}
        <ActionCard title="PLAYLIST">
          <Dropdown
            value={pl.name || null}
            options={playlists.map((p) => ({ id: p, label: p }))}
            onSelect={(id) => updateAction({ ...pl, name: id })}
            placeholder="Pick a playlist…"
            emptyHint="Engine reports no playlists."
          />
          {/* TARGET is deck-only now — the playlist always drives the main deck.
              We keep target on the action so the wire shape stays stable. */}
          <Text style={styles.hint}>Target: deck — the main deck (mixer authoring removed).</Text>
        </ActionCard>

        {/* 2. AUTOPILOT PATTERNS — reuse the live deck's PatternAutopilotPanel.
            The header ON/OFF adds/removes the whole autopilot block; the panel
            drives every knob (PLAY/PAUSE, SHUFFLE, GROUP + SIZE/DWELL, cadence).
            DECK TX is deliberately NOT nested here (its own card below) so the
            cue's inherit-vs-custom transition semantics stay separate. */}
        <ActionCard
          title="AUTOPILOT PATTERNS"
          right={
            <ToggleChip
              on={apOn}
              onToggle={() => {
                if (apOn) {
                  const next = { ...pl };
                  delete next.autopilot;
                  updateAction(next);
                } else {
                  // Seed a COMPLETE, valid block (engine validateAutopilot is
                  // strict: active + delay_s>0 + shuffle, no defaults).
                  updateAction({ ...pl, autopilot: { active: true, delay_s: 30, shuffle: true } });
                }
              }}
              label={apOn ? 'ON' : 'OFF'}
            />
          }
        >
          {apOn ? (
            <PatternAutopilotPanel
              bare
              title=""
              active={!!ap.active}
              delayStr={String(ap.delay_s ?? 30)}
              shuffle={!!ap.shuffle}
              groupMode={!!ap.groupMode}
              groupSize={ap.groupSize ?? 3}
              groupDwell={ap.groupDwell ?? 6}
              onChange={(patch) => {
                // One key per emit; keep the block complete (active/delay_s/
                // shuffle always present — the seed guarantees it, and buildNormalizedAction re-guards).
                if (patch.active !== undefined) updateAction({ ...pl, autopilot: { ...ap, active: patch.active } });
                else if (patch.shuffle !== undefined) updateAction({ ...pl, autopilot: { ...ap, shuffle: patch.shuffle } });
                else if (patch.delayStr !== undefined) updateAction({ ...pl, autopilot: { ...ap, delay_s: parseInt(patch.delayStr, 10) || 30 } });
                else if (patch.groupMode !== undefined) updateAction({ ...pl, autopilot: { ...ap, groupMode: patch.groupMode } });
                else if (patch.groupSize !== undefined) updateAction({ ...pl, autopilot: { ...ap, groupSize: patch.groupSize } });
                else if (patch.groupDwell !== undefined) updateAction({ ...pl, autopilot: { ...ap, groupDwell: patch.groupDwell } });
              }}
            />
          ) : (
            <Text style={styles.hint}>Off — this cue leaves the deck&apos;s pattern autopilot as-is.</Text>
          )}
        </ActionCard>

        {/* 3. DECK TX — deck transition override (verbatim behavior). "Deck
            default" emits no `transition` field (inherit the deck's standing
            config); "Custom" emits a full block (all 16 blends + time + shuffle)
            edited via the SAME control as the live deck's DECK TX. */}
        <ActionCard title="DECK TX">
          <Segmented
            options={TRANSITION_SOURCE_OPTIONS}
            value={transitionSource}
            onChange={(id) => {
              if (id === 'default') {
                const next = { ...pl };
                delete next.transition;
                updateAction(next);
              } else if (!pl.transition) {
                updateAction({
                  ...pl,
                  transition: { mode: 'trans_crossfade', durationMs: 1000, enabled: true, shuffle: false },
                });
              }
            }}
          />
          <Text style={styles.hint}>
            Default keeps the deck&apos;s standing transition. Custom sets the full blend, time,
            and shuffle for this cue.
          </Text>
          {pl.transition ? (
            <DeckTransitionControls
              bare
              enabled={pl.transition.enabled ?? true}
              mode={pl.transition.mode}
              durationMs={pl.transition.durationMs ?? 1000}
              shuffle={pl.transition.shuffle ?? false}
              onChange={(patch) => updateAction({
                ...pl,
                transition: {
                  mode: (patch.mode ?? pl.transition!.mode) as DeckTransitionMode,
                  durationMs: patch.durationMs ?? pl.transition!.durationMs,
                  shuffle: patch.shuffle ?? pl.transition!.shuffle,
                  enabled: patch.enabled ?? pl.transition!.enabled,
                },
              })}
            />
          ) : null}
        </ActionCard>

        {/* 4. AUTOPILOT COLOR THEME — the same families as Deck > Colors:
            fixed/crossfading two-tone, five-tone rotation, and Follow Note.
            SAVED SET remains available for old cues and palette-library shows. */}
        <ActionCard
          title="AUTOPILOT COLOR THEME"
          right={
            <ToggleChip
              on={caOn}
              onToggle={() => {
                if (caOn) {
                  const next = { ...pl };
                  delete next.colorAutopilot;
                  updateAction(next);
                } else {
                  const defaultColorAutopilot = defaultCuePlaylistAction().colorAutopilot;
                  if (!defaultColorAutopilot) {
                    throw new Error('Cue defaults must define an Autopilot Color theme.');
                  }
                  updateAction({
                    ...pl,
                    colorAutopilot: defaultColorAutopilot,
                  });
                }
              }}
              label={caOn ? 'OVERRIDE COLORS' : 'LEAVE AS-IS'}
            />
          }
        >
          {caOn && ca ? (
            <CueColorThemeEditor
              value={ca}
              onChange={(colorAutopilot) => updateAction({ ...pl, colorAutopilot })}
              paletteOptions={paletteOptions.map((palette) => ({ id: palette.id, label: palette.name }))}
            />
          ) : (
            <Text style={styles.hint}>
              Leave as-is — this cue does not start, stop, or replace the deck&apos;s current color theme.
            </Text>
          )}
        </ActionCard>

        {/* 5. HUE — NEW. Global hue shift (degrees, 0–360) applied when the cue
            fires (deck-only). ON seeds hue:0; OFF drops the field. Controlled
            HorizontalFader mapped 0..1 ⇄ 0..360, filled with the live hue. */}
        <ActionCard
          title="HUE"
          right={
            <ToggleChip
              on={hueOn}
              onToggle={() => {
                if (hueOn) {
                  const next = { ...pl };
                  delete next.hue;
                  updateAction(next);
                } else {
                  updateAction({ ...pl, hue: 0 });
                }
              }}
              label={hueOn ? 'SET HUE' : 'LEAVE AS-IS'}
            />
          }
        >
          {hueOn ? (
            <View style={{ gap: 10 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text style={styles.hint}>Global hue shift applied when this cue fires.</Text>
                <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 15, color: C.text }}>{`${Math.round(hueDeg)}°`}</Text>
              </View>
              <HorizontalFader
                value={hueDeg / 360}
                onChange={(v: number) => updateAction({ ...pl, hue: Math.round(v * 360) })}
                trackStyle={{ height: 28, borderRadius: 14, borderWidth: 1, borderColor: C.ghostBorder, backgroundColor: C.surfaceContainerLowest, justifyContent: 'center' }}
                fillStyle={{ position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 14, backgroundColor: hueToHex(hueDeg) }}
                thumbStyle={{ width: 6, height: 32, borderRadius: 3, backgroundColor: C.text, marginTop: -2 }}
              />
            </View>
          ) : (
            <Text style={styles.hint}>Leave as-is — this cue doesn&apos;t change the global hue.</Text>
          )}
        </ActionCard>

        {/* 6. GLOBALS — rig-wide CPC knobs (SPEED/SYNC) applied when the cue
            fires (deck-only). ON seeds {speed:0.5,bpmSpeedSync:0}; OFF drops
            the field. Lets a cue pin speed low and keep sync off. Cue-level
            SIZE removed (operator ruling 2026-08-03). */}
        <ActionCard
          title="GLOBALS"
          right={
            <ToggleChip
              on={glOn}
              onToggle={() => {
                if (glOn) {
                  const next = { ...pl };
                  delete next.globals;
                  updateAction(next);
                } else {
                  updateAction({ ...pl, globals: { speed: 0.25, bpmSpeedSync: 0 } });
                }
              }}
              label={glOn ? 'SET GLOBALS' : 'LEAVE AS-IS'}
            />
          }
        >
          {glOn ? (
            <View style={{ gap: 12 }}>
              {/* SPEED */}
              <View style={{ gap: 6 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <FieldLabel>SPEED</FieldLabel>
                  <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 15, color: C.text }}>{`${Math.round(speedVal * 100)}%`}</Text>
                </View>
                <HorizontalFader
                  value={speedVal}
                  onChange={(v: number) => updateAction({ ...pl, globals: { ...gl, speed: Math.round(v * 100) / 100 } })}
                  trackStyle={{ height: 28, borderRadius: 14, borderWidth: 1, borderColor: C.ghostBorder, backgroundColor: C.surfaceContainerLowest, justifyContent: 'center' }}
                  fillStyle={{ position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 14, backgroundColor: C.primary }}
                  thumbStyle={{ width: 6, height: 32, borderRadius: 3, backgroundColor: C.text, marginTop: -2 }}
                />
              </View>
              {/* SYNC — bpmSpeedSync: drive SPEED from the arbitrated tempo. */}
              <ToggleChip
                on={syncOn}
                onToggle={() => updateAction({ ...pl, globals: { ...gl, bpmSpeedSync: syncOn ? 0 : 1 } })}
                label={syncOn ? 'SPEED SYNC ON' : 'SPEED SYNC OFF'}
              />
              <Text style={styles.hint}>
                SYNC drives SPEED from the arbitrated tempo (OSC/TAP). Off = SPEED stays where you set it.
              </Text>
            </View>
          ) : (
            <Text style={styles.hint}>Leave as-is — this cue doesn&apos;t change speed or sync.</Text>
          )}
        </ActionCard>

        {/* 7. OVERLAYS — cue-level overlay intent. "Leave as-is" emits nothing. */}
        <ActionCard title="OVERLAYS">
          <Segmented
            options={OVERLAY_OPTIONS}
            value={overlayMode}
            onChange={(id) => {
              if (id === 'asis') {
                const next = { ...pl };
                delete next.overlays;
                updateAction(next);
              } else {
                updateAction({ ...pl, overlays: id as ActionOverlays });
              }
            }}
          />
          <Text style={styles.hint}>
            Overlays = extra pattern layers stacked over the deck; ‘disable’ blacks them out for this cue.
          </Text>
        </ActionCard>
      </>
    );
  };

  return (
    <Modal
      transparent
      visible={visible}
      animationType="fade"
      onRequestClose={onClose}
      supportedOrientations={CAPTAIN_PAD_MODAL_SUPPORTED_ORIENTATIONS}
    >
      <View style={styles.backdrop}>
        <Pressable
          onPress={onClose}
          style={styles.backdropDismiss}
          accessibilityLabel="Close cue editor"
        />
        <View style={styles.panelHost}>
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

            {/* The body owns all remaining panel height; header, validation
                message, and footer stay visible. LockableScrollView prevents
                native fader/duration gestures from stealing or being stolen by
                the sheet, while ordinary vertical drags scroll from anywhere
                else — including the large day-placement pane. */}
            <LockableScrollView
              style={styles.sheetScroll}
              contentContainerStyle={styles.sheetScrollContent}
              showsVerticalScrollIndicator
              indicatorStyle="white"
              keyboardShouldPersistTaps="handled"
              nestedScrollEnabled
            >
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
                  <FieldLabel>CUE TYPE</FieldLabel>
                  {partyTrigger ? (
                    <Text style={styles.hint}>
                      PARTY WINDOW · timed baseline with audio-detected party sessions
                    </Text>
                  ) : (
                    <Segmented
                      options={[
                        { id: 'program', label: 'Program' },
                        { id: 'ambient', label: 'Ambient' },
                      ]}
                      value={kind === 'mood' ? 'program' : kind}
                      onChange={(v) => setKind(v as CueKind)}
                    />
                  )}

                  <View style={{ height: 14 }} />
                  <FieldLabel>TRIGGER</FieldLabel>
                  <Segmented
                    options={[
                      { id: 'clock', label: 'Clock' },
                      { id: 'sun', label: 'Sun' },
                      { id: 'party', label: 'Party Window' },
                      { id: 'manual', label: 'Manual' },
                    ]}
                    value={partyTrigger ? 'party' : trigger.type}
                    onChange={(v) => {
                      const mode = v as TriggerEditorMode;
                      if (mode === 'party') {
                        setKind('mood');
                        setPartyStartAt(smartDefaultClockAt(plan.location.tz));
                        if (!initialCue && isPrefilledCueLabel(label)) {
                          setLabel(nextCueLabel(plan, 'Party'));
                        }
                      } else if (kind === 'mood') {
                        setKind('program');
                        if (!initialCue && isPrefilledCueLabel(label)) {
                          setLabel(nextCueLabel(plan, 'Cue'));
                        }
                      }
                      if (mode !== 'manual' && action.type === 'special_event') {
                        setAction(defaultCuePlaylistAction());
                      }
                      setTrigger(makeEditorTrigger(mode));
                    }}
                  />
                  {renderTriggerBody()}
                </>
              ) : null}

              {/* ACTION — PLAYLIST only now (look removed; operator decision).
                  No segmented switch: the maker authors a single action type.
                  Reused verbatim by the DEFAULT CUE editor. */}
              <View style={{ height: 14 }} />
              <FieldLabel>ACTION</FieldLabel>
              {!isDefaultMode && trigger.type === 'manual' ? (
                <View style={{ marginBottom: 10 }}>
                  <Segmented
                    options={[
                      { id: 'playlist', label: 'Playlist' },
                      { id: 'special_event', label: 'Special Event' },
                    ]}
                    value={action.type === 'special_event' ? 'special_event' : 'playlist'}
                    onChange={(value) => {
                      if (value === 'special_event') {
                        const next: ActionSpecialEvent = {
                          type: 'special_event',
                          showId: specialEventShows[0]?.id ?? '',
                        };
                        setAction(next);
                      } else {
                        setAction(defaultCuePlaylistAction());
                      }
                    }}
                  />
                </View>
              ) : null}
              <Text style={styles.hint}>
                {partyTrigger
                  ? 'Choose what normally runs during the window and what replaces it only while party is detected.'
                  : action.type === 'special_event'
                    ? 'Start a staged Special Event instead of loading a playlist.'
                    : 'Load and configure a Deck playlist.'}
              </Text>
              {partyTrigger && action.type === 'playlist' ? (
                <View style={{ gap: 12, marginTop: 10 }}>
                  <View style={styles.subBlock}>
                    <FieldLabel>SHARE CUSTOMIZATIONS</FieldLabel>
                    <Text style={[styles.hint, { marginBottom: 8 }]}>
                      Copy every Deck setting without replacing the destination playlist.
                    </Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                      <TouchableOpacity
                        style={styles.dayPill}
                        onPress={() => setPartyAction(copyPlaylistSettings(action, partyAction))}
                        accessibilityRole="button"
                      >
                        <Text style={styles.dayPillText}>COPY BASELINE → PARTY</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.dayPill}
                        onPress={() => setAction(copyPlaylistSettings(partyAction, action))}
                        accessibilityRole="button"
                      >
                        <Text style={styles.dayPillText}>COPY PARTY → BASELINE</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                  <FieldLabel>WINDOW BASELINE</FieldLabel>
                  <Text style={styles.hint}>
                    Runs whenever the Party Window is open and no detected session owns the Deck.
                  </Text>
                  {renderActionBody(action, setAction)}
                  <FieldLabel>DETECTED PARTY</FieldLabel>
                  <Text style={styles.hint}>
                    Replaces the baseline only after the strong signal completes its sustain.
                  </Text>
                  {renderActionBody(partyAction, (next) => {
                    if (next.type !== 'playlist') {
                      throw new Error('Detected Party customization must remain a playlist action.');
                    }
                    setPartyAction(next);
                  })}
                </View>
              ) : renderActionBody()}

              {/* DURATION — cue-only. A cue owns the deck for this window after it
                  fires; outside it (and in the gaps) the default cue runs. */}
              {!isDefaultMode ? (
                <>
                  <View style={{ height: 14 }} />
                  <FieldLabel>{partyTrigger ? 'PARTY WINDOW LENGTH' : 'DURATION'}</FieldLabel>
                  <View style={styles.chipRow}>
                    {(partyTrigger ? DURATION_PRESETS_MIN : CUE_DURATION_PRESETS_MIN).map((m) => {
                      const displayedDuration = partyTrigger ? partyWindowDurationMin : durationMin;
                      const sel = displayedDuration === m;
                      return (
                        <TouchableOpacity
                          key={m}
                          onPress={() => {
                            if (partyTrigger) setPartyWindowDurationMin(m);
                            else setDurationMin(m);
                          }}
                          style={[styles.dayPill, sel && { backgroundColor: C.primary, borderColor: C.primary }]}
                          accessibilityRole="button"
                          accessibilityState={{ selected: sel }}
                          accessibilityLabel={`${formatDurationMinutes(m)} duration`}
                        >
                          <Text style={[styles.dayPillText, sel && { color: C.onPrimary }]}>
                            {formatDurationMinutes(m)}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                  <View style={{ marginTop: 8 }}>
                    <Stepper
                      value={partyTrigger ? partyWindowDurationMin : durationMin}
                      step={partyTrigger ? 15 : 0.5}
                      onChange={partyTrigger ? setPartyWindowDurationMin : setDurationMin}
                      min={partyTrigger ? 5 : 0.5}
                      max={720}
                      format={formatDurationMinutes}
                    />
                  </View>
                  <Text style={[styles.hint, { marginTop: 8 }]}>
                    {partyTrigger
                      ? `The baseline may run for ${partyWindowDurationMin} min from the selected start. Party detection is blocked before and after this window.`
                      : `This cue owns the deck for ${formatDurationMinutes(durationMin)} after it fires; the default cue fills the gaps.`}
                  </Text>
                  {partyTrigger ? (
                    <View style={[styles.subBlock, { marginTop: 12 }]}>
                      <FieldLabel>DETECTED SESSION LENGTH</FieldLabel>
                      <Stepper
                        value={partySessionDurationMin}
                        step={1}
                        onChange={setPartySessionDurationMin}
                        min={1}
                        max={180}
                        format={(value) => `${value} min`}
                      />
                      <Text style={[styles.hint, { marginTop: 6 }]}>
                        Each detected session uses the party playlist for this long, then returns to the window baseline.
                      </Text>
                    </View>
                  ) : null}
                </>
              ) : null}

              {/* HOLD deliberately has NO section here (operator ruling
                  2026-08-03: "remove hold from the cue UI to avoid confusion,
                  but keep it for the party"). The field stays engine-side and
                  round-trips untouched through assembleCue. */}

              {/* DAYS — cue-only (the default cue applies to every day/gap). */}
              {!isDefaultMode ? (
                <>
              <View style={{ height: 14 }} />
              <FieldLabel>DAYS</FieldLabel>
              <Segmented
                options={[
                  // A Party Window's "this day" is a CALENDAR festival day, so
                  // NAME it — the operator could not previously see which day a
                  // window they were authoring would open on.
                  { id: 'this', label: partyTrigger ? `This day (D${dayIndex + 1})` : 'This day' },
                  { id: 'all', label: 'All days' },
                  { id: 'pick', label: 'Pick…' },
                ]}
                value={daysMode}
                onChange={(v) => setDaysMode(v as 'all' | 'this' | 'pick')}
              />
              {partyTrigger && partyDaysSummary ? (
                <View style={styles.subBlock}>
                  <Text style={styles.hint}>{partyDaysSummary}</Text>
                </View>
              ) : null}
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
            </LockableScrollView>

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
                onPress={() => { void validateAndSave(); }}
                disabled={validating}
                style={[styles.footerBtn, { backgroundColor: C.primary, opacity: validating ? 0.55 : 1 }]}
                accessibilityLabel={isDefaultMode ? 'Save default cue' : 'Save cue'}
                accessibilityState={{ disabled: validating, busy: validating }}
              >
                <Text style={[styles.footerBtnText, { color: C.onPrimary }]}>
                  {validating
                    ? 'VALIDATING…'
                    : isDefaultMode
                      ? 'SAVE DEFAULT'
                      : (initialCue ? 'SAVE CUE' : 'ADD CUE')}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}


function makeStyles(C: Palette) {
  return StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.68)',
      justifyContent: 'center',
      alignItems: 'center',
      padding: 24,
    },
    backdropDismiss: {
      ...StyleSheet.absoluteFillObject,
    },
    panelHost: {
      width: '100%',
      maxWidth: 720,
      height: '92%',
      maxHeight: 760,
      minHeight: 0,
    },
    sheet: {
      flex: 1,
      minHeight: 0,
      backgroundColor: C.surfaceContainerLow,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: C.ghostBorder,
      padding: 20,
    },
    sheetScroll: {
      flex: 1,
      minHeight: 0,
    },
    sheetScrollContent: {
      paddingBottom: 20,
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
