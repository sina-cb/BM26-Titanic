/**
 * Timeline tab — viewer + MAKER for the in-engine Timeline (docs/38 §14–§15).
 *
 * The Timeline now lives IN the engine (REST/WS on the engine base :6968).
 * This tab is the ONLY UI for it (§15.3): a live viewer AND a super-fluid
 * 8-day festival maker, all in CaptainPad's theme.
 *
 * Sections:
 *   A. Header / live status — plan + scene, controller pill (AUTOPILOT /
 *      PROGRAM / MANUAL), autopilot toggle, mood pill,
 *      active-program countdown, engine dot, offline banner.
 *   B. 8-day overview — horizontally-scannable day cards (sun arc + cue
 *      markers by kind). Live (GET /overview) until the operator edits, then
 *      a debounced preview of the DRAFT (POST /overview) so changes are seen
 *      across all days before saving.
 *   C. Day editor / maker — tap a day → vertical timeline; add/edit/delete
 *      cues via the themed CueEditorSheet (segmented/stepper/dropdown — no
 *      keyboard walls). Validation 400s surface inline, loudly.
 *   D. Cue list + controls — per-cue FIRE, the EVENT LOG (cue fires + plan
 *      lifecycle: activate/resume/autopilot/takeover/program),
 *      program/end.
 *
 * Draft / preview / save loop:
 *   - The draft plan is local state (loaded from GET /timeline/plans/:name,
 *     or seeded from the BRC template). Every draft mutation bumps a version
 *     counter; a 350 ms debounce POSTs the draft to /timeline/overview and
 *     re-renders the strip + day editor from the returned overview.
 *   - SAVE → POST /timeline/plans; ACTIVATE → POST /timeline/plan/activate.
 *   - With NO draft, the strip shows the live active-plan overview.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Palette } from '@/constants/theme';
import { useGlobalStyles, GlobalStyles } from '@/styles/globalStyles';
import { usePalette } from '@/hooks/use-theme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useTimeline } from '@/hooks/useTimeline';
import {
  fetchPlaylists, getCachedColorPalettes,
  fetchDeckChannel, getAutopilot, fetchDeckColorAutopilot,
} from '@/utils/api';
import {
  fetchTimelinePlans,
  fetchTimelinePlan,
  fetchTimelineOverview,
  previewTimelineOverview,
  saveTimelinePlan,
  deleteTimelinePlan,
  TimelineState,
  TimelineCue,
  TimelineRecentFire,
  TimelineOverview,
  OverviewCue,
  ShowPlan,
  PlanCue,
  PlanDefaultCue,
  ActionPlaylist,
} from '@/utils/timelineApi';
import { DayOverviewStrip } from '@/components/timeline/DayOverviewStrip';
import { DayEditor } from '@/components/timeline/DayEditor';
import { CueEditorSheet } from '@/components/timeline/CueEditorSheet';
import { PlanPickerSheet } from '@/components/timeline/PlanPickerSheet';
import {
  FestivalEditor, addDaysToDateKey, FESTIVAL_MIN_DAYS, FESTIVAL_MAX_DAYS,
} from '@/components/timeline/FestivalEditor';
import {
  brcStarterPlan, blankPlan, clonePlan, duplicatePlan, makeCueId, hhmmTo12h, seedDefaultCue,
} from '@/components/timeline/timelineTemplate';

const PREVIEW_DEBOUNCE_MS = 350;
// EVENT LOG list cap (the engine ring holds up to 50; show the freshest 20).
const EVENT_LOG_MAX_ROWS = 20;

// ── Plan-timezone "now" helpers ─────────────────────────────────────────
// The overview dates are festival-local (plan tz). To pick "today" and to
// place the NOW playhead we must read the wall clock IN THE PLAN TZ, not the
// operator's device tz — they differ if CaptainPad runs off-playa. We use
// Intl with the plan's IANA tz; on a malformed tz Intl throws, so we fail to
// null (no today, no playhead) rather than silently using device-local time.
function nowPartsInTz(tz: string | null | undefined): { dateKey: string; minutes: number } | null {
  if (!tz) return null;
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    });
    const parts = fmt.formatToParts(new Date());
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
    const year = get('year');
    const month = get('month');
    const day = get('day');
    let hour = Number(get('hour'));
    const minute = Number(get('minute'));
    // Intl can emit '24' for midnight under hour12:false on some engines.
    if (hour === 24) hour = 0;
    if (!year || !month || !day || Number.isNaN(hour) || Number.isNaN(minute)) return null;
    return { dateKey: `${year}-${month}-${day}`, minutes: hour * 60 + minute };
  } catch {
    return null;
  }
}

function formatCountdown(sec: number | null): string {
  if (sec === null || sec === undefined || !Number.isFinite(sec) || sec < 0) return '—';
  const total = Math.round(sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Snapshot the deck's CURRENT live state (playlist + pattern autopilot + color
// autopilot) into a plan DEFAULT CUE, taken at plan-creation time (operator:
// "when a plan is set and the default cue has not been modified, use the current
// state of the deck as the default at the time of plan creation"). A freshly
// created plan's standing fallback then matches what the deck is doing right
// now, instead of a hardcoded 'default' playlist. Mirrors the CueEditorSheet's
// emit discipline (buildNormalizedAction): the autopilot/colorAutopilot blocks
// are included ONLY when active + valid, so the snapshot always satisfies the
// engine's strict validators. Best-effort: if the engine is unreachable or the
// deck has no playlist loaded, degrade to the maker seed (a valid 'default').
async function snapshotDeckAsDefaultCue(): Promise<PlanDefaultCue> {
  const [deckRes, apRes, caRes] = await Promise.all([
    fetchDeckChannel(),
    getAutopilot(),
    fetchDeckColorAutopilot(),
  ]);
  const playlistName = deckRes.ok && deckRes.data?.channel?.playlist?.name
    ? String(deckRes.data.channel.playlist.name)
    : null;
  // Nothing live to snapshot (engine down / no playlist on the deck) → keep the
  // standard maker seed so the new plan still has a valid default cue.
  if (!playlistName) return seedDefaultCue();

  const action: ActionPlaylist = {
    type: 'playlist',
    name: playlistName,
    target: { channel: 'deck', id: null },
  };

  // Pattern autopilot — include the block ONLY when active, with a positive
  // delay_s + boolean shuffle (same normalization the cue editor emits).
  const ap = apRes.ok ? apRes.data : null;
  if (ap && ap.active) {
    const d = Number(ap.delay_s);
    action.autopilot = {
      active: true,
      delay_s: Number.isFinite(d) && d > 0 ? d : 30,
      shuffle: !!ap.shuffle,
    };
  }

  // Color autopilot — include ONLY when active with ≥1 palette (the engine's
  // strict validateColorAutopilot); clamp delay_s / transitionMs like the editor.
  const ca = caRes.ok ? caRes.data : null;
  if (ca && ca.active && Array.isArray(ca.palettes) && ca.palettes.length > 0) {
    const d = Number(ca.delay_s);
    const tm = Number(ca.transitionMs);
    action.colorAutopilot = {
      active: true,
      palettes: [...ca.palettes],
      delay_s: Number.isFinite(d) && d > 0 ? d : 30,
      shuffle: !!ca.shuffle,
      transitionMs: Number.isFinite(tm) && tm >= 0 ? tm : 0,
    };
  }

  return { label: 'Default (from deck)', action };
}

// Compact summary of the plan's default-cue action for the DEFAULT CUE row.
// The maker only authors playlist actions, but the field is permissive for
// hand-authored plans, so we summarise the other action types too.
function defaultCueActionSummary(dc: PlanDefaultCue): string {
  const a = dc.action;
  switch (a.type) {
    case 'playlist': return `playlist · ${a.name}`;
    case 'look': return `look · ${a.look}`;
    case 'globals': return 'globals';
    default: return 'action';
  }
}

// ── Controller pill (§14): AUTOPILOT green / PROGRAM amber / MANUAL grey ──
function ControllerPill({ state, styles, C }: { state: TimelineState; styles: Styles; C: Palette }) {
  const map: Record<TimelineState['controller'], { label: string; color: string }> = {
    autopilot: { label: 'AUTOPILOT', color: C.tertiary },
    program: { label: 'PROGRAM', color: '#f5a623' },
    manual: { label: 'MANUAL', color: C.icon },
  };
  const m = map[state.controller] || { label: String(state.controller).toUpperCase(), color: C.secondary };
  return (
    <View style={[styles.pill, { borderColor: m.color }]}>
      <Text style={[styles.pillText, { color: m.color }]}>{m.label}</Text>
    </View>
  );
}

function MoodPill({ party, mood, styles, C }: { party: boolean; mood: string | null; styles: Styles; C: Palette }) {
  const color = party ? C.error : C.tertiary;
  const label = party ? 'PARTY' : (mood ? mood.toUpperCase() : 'CALM');
  return (
    <View style={[styles.pill, { borderColor: color }]}>
      <Text style={[styles.pillText, { color }]}>{`● ${label}`}</Text>
    </View>
  );
}

export default function TimelineScreen() {
  const C = usePalette();
  const globalStyles = useGlobalStyles();
  const styles = useMemo(() => makeStyles(C, globalStyles), [C, globalStyles]);
  const { state, connected, error, setAutopilot, endProgram, fireCue, activatePlan } = useTimeline();

  // ── Server resources ──
  const [plans, setPlans] = useState<string[]>([]);
  const [playlists, setPlaylists] = useState<string[]>([]);
  const [liveOverview, setLiveOverview] = useState<TimelineOverview | null>(null);

  // ── Maker draft state ──
  // draft === null → viewer shows the LIVE active-plan overview.
  // draft !== null → operator is editing; the strip shows the draft preview.
  const [draft, setDraft] = useState<ShowPlan | null>(null);
  const [draftOverview, setDraftOverview] = useState<TimelineOverview | null>(null);
  const [draftVersion, setDraftVersion] = useState(0);
  // Validation (HTTP 400) error — BLOCKS save. Tagged with the draftVersion it
  // belongs to so a stale late response can't stick after a newer draft.
  const [previewError, setPreviewError] = useState<{ msg: string; version: number } | null>(null);
  // Transport failure (offline / timeout / 5xx) — does NOT block save; the
  // operator may still write a structurally-valid draft while the engine blips.
  const [previewTransportError, setPreviewTransportError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState<string | null>(null);
  // Auto-save (operator request 2026-07-02: the maker saves like a doc editor —
  // no SAVE / CANCEL buttons). `lastSavedVersionRef` is the last draftVersion
  // successfully written; the auto-save effect debounces writes and skips a
  // version that's already persisted. `autoSaveState` drives a small status
  // chip where the buttons used to be.
  const lastSavedVersionRef = useRef<number | null>(null);
  const [autoSaveState, setAutoSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  // Latest draft version that has been requested — used to discard out-of-order
  // preview responses (a slow v1 must not overwrite a newer v2).
  const latestDraftVersionRef = useRef(0);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);
  useEffect(() => { latestDraftVersionRef.current = draftVersion; }, [draftVersion]);

  // ── UI sheet state ──
  const [planPickerOpen, setPlanPickerOpen] = useState(false);
  // The operator-SELECTED day (highlighted in the strip + drives the cue
  // filter below it). Defaults to today; falls back to day 0. `null` only
  // until the first overview resolves.
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  // Whether the cue list shows the SELECTED day's cues or ALL days. Default =
  // the selected day (per the brief).
  const [showAllDays, setShowAllDays] = useState(false);
  // The day whose editor modal is OPEN (explicit EDIT DAY) — distinct from the
  // selected/viewed day so a single tap selects without opening the editor.
  const [editingDay, setEditingDay] = useState<number | null>(null);
  const [cueSheetOpen, setCueSheetOpen] = useState(false);
  const [editingCue, setEditingCue] = useState<PlanCue | null>(null);
  // The plan's DEFAULT CUE editor (reuses CueEditorSheet in 'defaultCue' mode).
  const [defaultCueSheetOpen, setDefaultCueSheetOpen] = useState(false);

  // ── 1s ticker — drives the live NOW playhead (strip + day editor). ──
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // ── Resource loaders ──
  const refreshPlans = useCallback(() => {
    fetchTimelinePlans().then((r) => {
      if (r.ok && r.data && Array.isArray(r.data.plans)) setPlans(r.data.plans);
    });
  }, []);
  const refreshLiveOverview = useCallback(() => {
    fetchTimelineOverview().then((r) => {
      if (r.ok && r.data) setLiveOverview(r.data);
    });
  }, []);
  // The cue editor's playlist dropdown reads from `playlists`. A playlist the
  // operator creates in the deck AFTER this screen mounted must show up, so the
  // list can't be a one-shot mount fetch — it refreshes on tab focus and again
  // the moment the cue editor opens (see openAddCue / openEditCue). Mirrors the
  // refreshPlans / refreshLiveOverview idiom; surfaces a failure loudly via
  // actionError instead of silently leaving a stale list (Codex P0: fail loud).
  const refreshPlaylists = useCallback(() => {
    fetchPlaylists().then((r) => {
      if (r.ok && r.data) setPlaylists(r.data);
      else if (!r.ok) setActionError(r.error || 'Could not load playlists');
    });
  }, []);
  useEffect(() => {
    refreshPlans();
    refreshLiveOverview();
  }, [refreshPlans, refreshLiveOverview]);
  // Refresh the playlist library whenever this tab gains focus (also runs on the
  // first focus, so it replaces the old mount-time playlist fetch) — returning
  // here after adding a playlist in the deck picks the new one up.
  useFocusEffect(useCallback(() => { refreshPlaylists(); }, [refreshPlaylists]));

  // Keep the live overview fresh when the active plan flips (server-driven).
  const activePlanName = state?.activePlan ?? null;
  useEffect(() => { refreshLiveOverview(); }, [activePlanName, refreshLiveOverview]);

  // ── Debounced draft preview (POST /timeline/overview) ──
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!draft) {
      setDraftOverview(null);
      setPreviewError(null);
      setPreviewTransportError(null);
      return;
    }
    if (previewTimer.current) clearTimeout(previewTimer.current);
    // Capture the version this request belongs to BEFORE the await so an
    // out-of-order response can be discarded (fix: preview race).
    const v = draftVersion;
    const controller = new AbortController();
    previewTimer.current = setTimeout(async () => {
      const r = await previewTimelineOverview(draft, controller.signal);
      // Bail if a newer draft has since superseded this one, or we unmounted.
      if (!mountedRef.current || v !== latestDraftVersionRef.current) return;
      if (r.ok && r.data) {
        setDraftOverview(r.data);
        setPreviewError(null);
        setPreviewTransportError(null);
      } else if (r.status === 400) {
        // Schema-invalid draft — BLOCK save. Codex P0: surface the engine's
        // validation error verbatim, loudly. Tagged with this draft version.
        setPreviewError({ msg: r.error || 'Draft invalid', version: v });
        setPreviewTransportError(null);
      } else {
        // Transport failure (offline / timeout / 5xx) — do NOT block save;
        // the last good preview (if any) stays on screen.
        setPreviewTransportError(r.error || 'Could not reach the engine to preview the draft');
      }
    }, PREVIEW_DEBOUNCE_MS);
    return () => {
      if (previewTimer.current) clearTimeout(previewTimer.current);
      controller.abort();
    };
  }, [draft, draftVersion]);

  // The overview the strip / day editor render from.
  const overview = draft ? draftOverview : liveOverview;

  // SAVE is blocked ONLY by a schema-validation (HTTP 400) error that belongs
  // to the CURRENT draft version — never by a transient transport failure, and
  // never by a stale error from an older draft (fix: sticky previewError).
  const saveBlocked = !!previewError && previewError.version === draftVersion;

  // Plan timezone (festival-local). Falls back to the active plan's location if
  // the overview carries no location, then to the device tz so the playhead
  // still tracks *something* when a plan omits a tz.
  const planTz = useMemo(() => {
    return (
      overview?.location?.tz
      ?? draft?.location?.tz
      ?? (typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : null)
    );
  }, [overview?.location?.tz, draft?.location?.tz]);

  // "Now" in the plan tz, recomputed each 1s tick. dateKey picks "today"; the
  // minutes feed the playhead position.
  const nowInTz = useMemo(() => nowPartsInTz(planTz), [planTz, nowTick]);

  // Today's festival index (the overview day whose date matches today in the
  // plan tz). null when today is outside the festival span.
  const todayIndex = useMemo(() => {
    if (!overview || !nowInTz) return null;
    const d = overview.days.find((day) => day.date === nowInTz.dateKey);
    return d ? d.index : null;
  }, [overview, nowInTz]);

  // Live minutes-of-day for the playhead (null when no tz could be read).
  const nowMinutes = nowInTz ? nowInTz.minutes : null;

  // Default the SELECTED day to today (or day 0) once the overview resolves.
  // Re-applies if the selection points outside the current day range (e.g. a
  // different plan loaded). Operator taps override this thereafter.
  useEffect(() => {
    if (!overview || overview.days.length === 0) return;
    const validIndexes = new Set(overview.days.map((d) => d.index));
    setSelectedDay((prev) => {
      if (prev !== null && validIndexes.has(prev)) return prev;
      if (todayIndex !== null) return todayIndex;
      return overview.days[0].index;
    });
  }, [overview, todayIndex]);

  // ── Draft mutators ──
  const mutateDraft = useCallback((fn: (p: ShowPlan) => void) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const next = clonePlan(prev);
      fn(next);
      return next;
    });
    setDraftVersion((v) => v + 1);
    setSaveOk(null);
  }, []);

  // Returns true when a draft was actually loaded onto the 8-day grid; false
  // when the load failed or the plan has no festival span (the caller must
  // NOT open the day editor in that case — fix: half-load + dangling day).
  const loadPlanIntoDraft = useCallback(async (name: string): Promise<boolean> => {
    const r = await fetchTimelinePlan(name);
    if (!r.ok || !r.data) {
      setActionError(r.error || `Could not load plan ${name}`);
      return false;
    }
    // The maker's day grid math needs a festival span (engine normalises
    // v1→v2 on read, but a festival-less plan still can't be edited on the
    // 8-day grid). Refuse the load loudly rather than half-load a broken grid.
    const plan = r.data;
    if (!plan.festival) {
      setActionError(`This plan has no festival span — duplicate from the BRC template to edit on the 8-day grid.`);
      setPlanPickerOpen(false);
      return false;
    }
    setDraft(clonePlan(plan));
    setDraftVersion((v) => v + 1);
    setSaveOk(null);
    setActionError(null);
    setPreviewTransportError(null);
    setPlanPickerOpen(false);
    return true;
  }, []);

  // ALWAYS-EDITING (operator request 2026-07-03): the maker auto-loads the
  // ACTIVE plan into the draft so the timeline tab is ALWAYS in edit mode — the
  // DEFAULT CUE (and the whole maker) is always visible with no "enter the
  // editor" step, and there is no DONE button (auto-save means we're always
  // editing). Unlike loadPlanIntoDraft this seeds lastSavedVersionRef to the
  // freshly-loaded version, so the initial auto-load does NOT trigger a spurious
  // re-save (which would needlessly hot-reload the running plan). A plan without
  // a festival span can't be edited on the 8-day grid → left as no-draft (the
  // helper text points the operator at duplicating from the template).
  const autoLoadActiveIntoDraft = useCallback(async (name: string) => {
    const r = await fetchTimelinePlan(name);
    if (!r.ok || !r.data || !r.data.festival) return;
    setDraft(clonePlan(r.data));
    setDraftVersion((v) => { const nv = v + 1; lastSavedVersionRef.current = nv; return nv; });
    setSaveOk(null);
    setPreviewTransportError(null);
  }, []);

  // Drive the always-editing model: whenever there's an active plan and nothing
  // is loaded in the maker, pull the active plan into the draft. Re-fires if the
  // draft is cleared (e.g. its plan was deleted). The in-flight guard prevents a
  // double-load while the async fetch is mid-flight.
  const autoLoadInFlightRef = useRef(false);
  useEffect(() => {
    const active = state?.activePlan;
    if (!active || draft || autoLoadInFlightRef.current) return;
    autoLoadInFlightRef.current = true;
    autoLoadActiveIntoDraft(active).finally(() => { autoLoadInFlightRef.current = false; });
  }, [state?.activePlan, draft, autoLoadActiveIntoDraft]);

  // Persist a plan and refresh the derived views. Shared by auto-save, eager
  // new-plan saves, and the close flush. Saving over the ACTIVE plan
  // hot-reloads it engine-side, so the live overview (which gates the FIRE
  // buttons) must refresh — freshly-saved cues become fireable immediately.
  const persistPlan = useCallback(async (plan: ShowPlan): Promise<boolean> => {
    const r = await saveTimelinePlan(plan);
    if (r.ok) {
      setActionError(null);
      refreshPlans();
      refreshLiveOverview();
      return true;
    }
    setActionError(r.error || 'Auto-save failed');
    return false;
  }, [refreshPlans, refreshLiveOverview]);

  // New plans REQUIRE an operator-entered name (the PlanPickerSheet's name
  // prompt validates + de-duplicates before calling these with the slug).
  // Load a freshly-created/duplicated plan into the maker AND persist it
  // immediately (operator request 2026-07-02: "when adding a new plan, save it
  // automatically too") so it exists on disk right away — ready to ACTIVATE
  // without a manual save. The auto-save effect then keeps subsequent edits
  // written; lastSavedVersionRef starts null so it also re-writes as they edit.
  const startDraft = useCallback((plan: ShowPlan) => {
    setDraft(plan);
    setDraftVersion((v) => v + 1);
    lastSavedVersionRef.current = null;
    setSaveOk(null);
    setActionError(null);
    setPreviewTransportError(null);
    setPlanPickerOpen(false);
    void persistPlan(plan);
  }, [persistPlan]);

  // New plans seed their DEFAULT CUE from the deck's current live state (see
  // snapshotDeckAsDefaultCue) so the standing fallback matches what's playing
  // right now, captured at creation. The operator can still edit it afterwards.
  const handleNewTemplate = useCallback(async (name: string) => {
    const plan = brcStarterPlan(name);
    plan.defaultCue = await snapshotDeckAsDefaultCue();
    startDraft(plan);
  }, [startDraft]);

  // New BLANK plan from scratch — seeded by blankPlan(name): starts TODAY in
  // the plan tz with a 2-day festival span the operator grows as needed.
  const handleNewBlank = useCallback(async (name: string) => {
    const plan = blankPlan(name);
    plan.defaultCue = await snapshotDeckAsDefaultCue();
    startDraft(plan);
  }, [startDraft]);

  const handleDuplicate = useCallback(async (name: string) => {
    const r = await fetchTimelinePlan(name);
    if (!r.ok || !r.data) { setActionError(r.error || `Could not load plan ${name}`); return; }
    startDraft(duplicatePlan(r.data, `${name}_copy`.slice(0, 64)));
  }, [startDraft]);

  const handleActivate = useCallback(async (name: string) => {
    const ok = await activatePlan(name);
    if (ok) {
      refreshPlans(); refreshLiveOverview(); setPlanPickerOpen(false);
      // Always-editing: switch the maker to the plan we just activated so the
      // tab keeps showing the running plan (replaces whatever was loaded).
      setDraft(null);
      await autoLoadActiveIntoDraft(name);
    } else setActionError('Engine rejected plan activation');
  }, [activatePlan, refreshPlans, refreshLiveOverview, autoLoadActiveIntoDraft]);

  // Delete a saved plan (the picker confirms + hides the ACTIVE plan; the
  // engine also refuses to delete the active one). If the deleted plan is the
  // one loaded in the maker, close the editor so we don't keep re-saving a
  // now-deleted file.
  const handleDeletePlan = useCallback(async (name: string) => {
    const r = await deleteTimelinePlan(name);
    if (!r.ok) { setActionError(r.error || `Could not delete plan ${name}`); return; }
    setActionError(null);
    if (draft?.name === name) {
      setDraft(null);
      setDraftOverview(null);
      lastSavedVersionRef.current = null;
    }
    refreshPlans();
  }, [draft?.name, refreshPlans]);

  // Persist a plan and refresh the derived views. Shared by auto-save, eager
  // new-plan saves, and the close flush. Saving over the ACTIVE plan
  // ── AUTO-SAVE ── debounce a write ~700ms after the last edit. A
  // schema-invalid draft (saveBlocked) is held back until it's valid again (the
  // error banner explains why); a version already on disk is skipped so we
  // don't re-write on load or after our own save.
  useEffect(() => {
    if (!draft) { lastSavedVersionRef.current = null; setAutoSaveState('idle'); return; }
    if (saveBlocked) { setAutoSaveState('error'); return; }
    if (lastSavedVersionRef.current === draftVersion) { setAutoSaveState('saved'); return; }
    const versionToSave = draftVersion;
    const t = setTimeout(async () => {
      setAutoSaveState('saving');
      const ok = await persistPlan(draft);
      if (ok) { lastSavedVersionRef.current = versionToSave; setAutoSaveState('saved'); }
      else setAutoSaveState('error');
    }, 700);
    return () => clearTimeout(t);
  }, [draft, draftVersion, saveBlocked, persistPlan]);

  // ── Festival span / estimate-tz mutators (top-of-page FestivalEditor) ──
  // These edit the DRAFT. When the operator touches them while viewing the LIVE
  // plan (no draft yet) we first load the active plan into the draft — same
  // "edit a copy" discipline as onEditDay — then apply the change. If there is
  // no active plan to load, we surface the error loudly (Codex P0: no fallback)
  // rather than silently seeding a template the operator didn't ask for.
  const ensureDraftThen = useCallback(async (fn: (p: ShowPlan) => void) => {
    if (draft) { mutateDraft(fn); return; }
    if (!state?.activePlan) {
      setActionError('No active plan to edit — start from the BRC template via PLANS.');
      return;
    }
    const r = await fetchTimelinePlan(state.activePlan);
    if (!r.ok || !r.data) { setActionError(r.error || `Could not load plan ${state.activePlan}`); return; }
    if (!r.data.festival) {
      setActionError('This plan has no festival span — duplicate from the BRC template to edit on the 8-day grid.');
      return;
    }
    const next = clonePlan(r.data);
    fn(next);
    setDraft(next);
    setDraftVersion((v) => v + 1);
    setSaveOk(null);
    setActionError(null);
    setPreviewTransportError(null);
  }, [draft, mutateDraft, state?.activePlan]);

  // Set the festival start date to a chosen 'YYYY-MM-DD' (from the DateWheel
  // picker). Day i = startDate + i, so moving the start moves every day's
  // calendar date; the engine re-computes sun on the next preview. No cue
  // cleanup needed (the span length is unchanged). Same draft mutation path the
  // old ±1-day stepper used — only the chosen value differs.
  const handleSetStartDate = useCallback((dateKey: string) => {
    ensureDraftThen((p) => {
      p.festival = { ...p.festival, startDate: dateKey };
    });
  }, [ensureDraftThen]);

  // Append a festival day (date = startDate + (newDays-1)). Capped at the engine
  // max (31). No cue cleanup: every existing day index/date is still in range.
  const handleAddDay = useCallback(() => {
    ensureDraftThen((p) => {
      if (p.festival.days >= FESTIVAL_MAX_DAYS) return;
      p.festival = { ...p.festival, days: p.festival.days + 1 };
    });
  }, [ensureDraftThen]);

  // Drop the LAST festival day. To keep the draft valid (so validateShowPlan
  // never rejects it), clean every cue whose `days` references the removed day:
  //   - index form: drop the now-out-of-range index (newDays..);
  //   - date form: drop any date outside the new festival span;
  // a cue whose `days` array becomes empty reverts to 'all'.
  const handleRemoveDay = useCallback(() => {
    ensureDraftThen((p) => {
      if (p.festival.days <= FESTIVAL_MIN_DAYS) return;
      const newDays = p.festival.days - 1;
      p.festival = { ...p.festival, days: newDays };
      // The set of calendar dates that remain in the (shorter) festival span.
      const validDates = new Set<string>();
      for (let i = 0; i < newDays; i += 1) validDates.add(addDaysToDateKey(p.festival.startDate, i));
      p.cues = p.cues.map((c) => {
        if (!Array.isArray(c.days)) return c; // 'all' or undefined — unaffected.
        const arr = c.days as (number | string)[];
        const kept = arr.filter((v) =>
          typeof v === 'number' ? v >= 0 && v <= newDays - 1 : validDates.has(v));
        if (kept.length === arr.length) return c; // unchanged
        if (kept.length === 0) return { ...c, days: 'all' as const };
        return { ...c, days: kept as number[] | string[] };
      });
    });
  }, [ensureDraftThen]);

  // Set the sun-estimate timezone (IANA). The engine validates it and 400s on a
  // bad tz; changing it re-previews the overview so the strips' sun updates.
  const handleSetTz = useCallback((tz: string) => {
    ensureDraftThen((p) => { p.location = { ...p.location, tz }; });
  }, [ensureDraftThen]);

  // ── Cue CRUD (within the draft) ──
  const handleSaveCue = useCallback((cue: PlanCue) => {
    mutateDraft((p) => {
      if (cue.id && p.cues.some((c) => c.id === cue.id)) {
        p.cues = p.cues.map((c) => (c.id === cue.id ? cue : c));
      } else {
        const id = cue.id || makeCueId(new Set(p.cues.map((c) => c.id)));
        p.cues = [...p.cues, { ...cue, id }];
      }
    });
    setCueSheetOpen(false);
    setEditingCue(null);
  }, [mutateDraft]);

  const handleDeleteCue = useCallback((cueId: string) => {
    mutateDraft((p) => { p.cues = p.cues.filter((c) => c.id !== cueId); });
    setCueSheetOpen(false);
    setEditingCue(null);
  }, [mutateDraft]);

  const openAddCue = useCallback(() => {
    if (!draft) return;
    // Pull the latest playlist library so the dropdown is current the moment the
    // operator starts building a cue (a playlist added since focus shows up).
    refreshPlaylists();
    setEditingCue(null);
    setCueSheetOpen(true);
  }, [draft, refreshPlaylists]);

  const openEditCue = useCallback((cue: PlanCue) => {
    refreshPlaylists();
    setEditingCue(cue);
    setCueSheetOpen(true);
  }, [refreshPlaylists]);

  // ── Default-cue editor (maker-only, plan-level fallback) ──
  const openEditDefaultCue = useCallback(() => {
    if (!draft) return;
    refreshPlaylists();
    setDefaultCueSheetOpen(true);
  }, [draft, refreshPlaylists]);

  const handleSaveDefaultCue = useCallback((dc: PlanDefaultCue) => {
    mutateDraft((p) => { p.defaultCue = dc; });
    setDefaultCueSheetOpen(false);
  }, [mutateDraft]);

  // ── Live controls ──
  const isOffline = !connected && !state;

  const programCountdown = useMemo(() => {
    const p = state?.activeProgram;
    if (!p || p.untilMs == null) return null;
    return Math.max(0, Math.round((p.untilMs - Date.now()) / 1000));
  }, [state?.activeProgram]);

  // Festival span + estimate-tz shown in the top-of-page FestivalEditor. When a
  // draft is loaded these read the DRAFT (live, pre-preview); otherwise they
  // mirror the active plan's overview so the controls show the live span/tz
  // until the operator edits. Null when neither carries a festival (no editor).
  const festivalView = useMemo(() => {
    const festival = draft?.festival ?? overview?.festival ?? null;
    const tz = draft?.location?.tz ?? overview?.location?.tz ?? null;
    if (!festival || !tz) return null;
    return { startDate: festival.startDate, days: festival.days, tz };
  }, [draft?.festival, draft?.location?.tz, overview?.festival, overview?.location?.tz]);

  // The day-editor's overview object (the day whose modal is open).
  const editingDayOverview = useMemo(() => {
    if (editingDay === null || !overview) return null;
    return overview.days.find((d) => d.index === editingDay) ?? null;
  }, [editingDay, overview]);

  // The SELECTED day's overview object (drives the filtered cue list).
  const selectedDayOverview = useMemo(() => {
    if (selectedDay === null || !overview) return null;
    return overview.days.find((d) => d.index === selectedDay) ?? null;
  }, [selectedDay, overview]);

  // Cues shown in the timeline view: the selected day's resolved cues, or all
  // days' cues flattened (with their day index) when the toggle is ALL DAYS.
  // These come from the overview (resolved atLocal), time-ordered.
  const viewCues = useMemo(() => {
    if (!overview) return [] as { cue: OverviewCue; dayIndex: number }[];
    const rows: { cue: OverviewCue; dayIndex: number }[] = [];
    if (showAllDays) {
      for (const d of overview.days) for (const c of d.cues) rows.push({ cue: c, dayIndex: d.index });
    } else if (selectedDayOverview) {
      for (const c of selectedDayOverview.cues) rows.push({ cue: c, dayIndex: selectedDayOverview.index });
    }
    const mins = (s: string | null) => {
      if (!s) return 100000;
      const m = /^(\d{1,2}):(\d{2})$/.exec(s);
      return m ? Number(m[1]) * 60 + Number(m[2]) : 100000;
    };
    rows.sort((a, b) => {
      if (a.dayIndex !== b.dayIndex) return a.dayIndex - b.dayIndex;
      return mins(a.cue.atLocal) - mins(b.cue.atLocal);
    });
    return rows;
  }, [overview, showAllDays, selectedDayOverview]);

  // Map overview cue id → live engine cue (for FIRE + countdown), so the
  // filtered/resolved rows still drive the real fire path + live status.
  const liveCueById = useMemo(() => {
    const m = new Map<string, TimelineCue>();
    if (state?.cues) for (const c of state.cues) m.set(c.id, c);
    return m;
  }, [state?.cues]);

  // Which cues can be FIRED: those present in the ACTIVE plan. The live WS
  // `state.cues` is unreliable for this gate (it can arrive empty/stale, which
  // left FIRE disabled even after the plan was activated), so we gate on the
  // active-plan OVERVIEW (`liveOverview`, from GET /timeline/overview, refreshed
  // on activate + focus). When there is NO draft, the viewer IS the active plan,
  // so every shown cue is fireable; while editing a draft, only cues already
  // saved + activated (present in liveOverview) can fire.
  const liveCueIds = useMemo(() => {
    const s = new Set<string>();
    if (liveOverview?.days) for (const d of liveOverview.days) for (const c of d.cues) s.add(c.id);
    return s;
  }, [liveOverview]);

  return (
    <View style={styles.container}>
      <View style={styles.surface}>
        {/* The "scheduled show pending" lease warning now lives in the GLOBAL,
            non-disruptive PendingProgramOverlay (mounted in (tabs)/_layout.tsx)
            so it floats over EVERY tab — including this one — without blocking
            a live performance. It is intentionally NOT rendered inline here. */}

        {/* ── A. Header / live status ── */}
        <View style={styles.headerRow}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 }}>
            <IconSymbol name="sun.max" size={28} color={C.primary} />
            <View style={{ minWidth: 0 }}>
              {/* ACTIVE PLAN made unmistakable (operator request 2026-07-02):
                  a small caps label + a green ● RUNNING chip carrying the plan
                  NAME, so the plan the engine is actually running never gets
                  confused with a DRAFT being edited below (the maker header
                  reads "MAKER — <name> (DRAFT)"). */}
              <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 9, letterSpacing: 1.4, color: C.secondary, textTransform: 'uppercase' }}>
                ACTIVE PLAN
              </Text>
              {state?.activePlan ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0 }}>
                  <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: state.planActive ? '#00a86b' : C.secondary }} />
                  <Text style={styles.headerTitle} numberOfLines={1}>{state.activePlan}</Text>
                </View>
              ) : (
                <Text style={styles.headerTitle} numberOfLines={1}>— none —</Text>
              )}
              {state?.scene ? <Text style={styles.headerScene} numberOfLines={1}>{`scene · ${state.scene}`}</Text> : null}
            </View>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {state ? <ControllerPill state={state} styles={styles} C={C} /> : null}
            {state ? <MoodPill party={!!state.party} mood={state.currentMood} styles={styles} C={C} /> : null}
            <View style={styles.engineDotWrap}>
              <View style={[styles.engineDot, { backgroundColor: state?.engineConnected ? C.tertiary : C.error }]} />
              <Text style={styles.engineDotLabel}>{state?.engineConnected ? 'ENGINE' : 'NO ENGINE'}</Text>
            </View>
          </View>
        </View>

        {/* Out-of-window note (plan-view ONLY — deliberately NOT shown on the
            deck/mixer). When the plan is active but today is BEFORE its
            festival span, the engine holds the lock OFF (inFestivalWindow
            false) so the deck/mixer stay usable. Surface that here as a calm,
            minimal note so the operator knows the plan is armed and merely
            waiting, not broken. `festivalStartsInDays` is a positive int only
            in this pre-festival window. */}
        {state?.planActive && state?.inFestivalWindow === false && typeof state?.festivalStartsInDays === 'number' ? (
          <View style={styles.nextCueRow}>
            <IconSymbol name="clock" size={14} color="#f5a623" />
            <Text style={[styles.nextCueText, { color: '#f5a623' }]} numberOfLines={2}>
              {`Plan active — starts in ${state.festivalStartsInDays} day${state.festivalStartsInDays === 1 ? '' : 's'}. Deck & mixer stay unlocked until then.`}
            </Text>
          </View>
        ) : null}

        {/* NOW PLAYING — the live event driving the deck (engine activeCue),
            shown clearly whenever one is active (operator request 2026-07-02:
            "when an event is active, clearly show it in the timeline UI"). A
            running program keeps its END affordance below; this green banner is
            the always-visible "what's on the deck right now". */}
        {state?.activeCue ? (
          <View style={[styles.nextCueRow, { backgroundColor: 'rgba(0,168,107,0.12)', borderRadius: 8, borderWidth: 1, borderColor: 'rgba(0,168,107,0.4)', paddingHorizontal: 10, paddingVertical: 6 }]}>
            <IconSymbol name="play.fill" size={14} color="#00a86b" />
            <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 9, letterSpacing: 1.2, color: '#00a86b', textTransform: 'uppercase' }}>NOW</Text>
            <Text style={[styles.nextCueText, { fontFamily: 'SpaceGrotesk_700Bold', color: C.text, flex: 1 }]} numberOfLines={1}>
              {`${state.activeCue.label}${state.activeCue.kind === 'program' ? ' · show' : ''}`}
            </Text>
            {state.activeProgram ? (
              <TouchableOpacity onPress={() => endProgram()} style={styles.endProgramBtn} accessibilityLabel="End active program">
                <Text style={styles.endProgramText}>END</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}

        {/* Active-program countdown */}
        {state?.activeProgram && !state?.activeCue ? (
          <View style={styles.nextCueRow}>
            <IconSymbol name="play.fill" size={14} color="#f5a623" />
            <Text style={styles.nextCueText} numberOfLines={1}>
              {`program · ${state.activeProgram.cueId}${programCountdown != null ? ` · ${formatCountdown(programCountdown)} left` : ''}`}
            </Text>
            <TouchableOpacity onPress={() => endProgram()} style={styles.endProgramBtn} accessibilityLabel="End active program">
              <Text style={styles.endProgramText}>END</Text>
            </TouchableOpacity>
          </View>
        ) : state?.nextCue ? (
          <View style={styles.nextCueRow}>
            <IconSymbol name="clock" size={14} color={C.secondary} />
            <Text style={styles.nextCueText} numberOfLines={1}>
              {`next in ${formatCountdown(state.nextCue.inSec)} · ${state.nextCue.label}`}
            </Text>
            {state.currentPhase ? <Text style={styles.phaseChip}>{`phase · ${state.currentPhase}`}</Text> : null}
          </View>
        ) : null}

        {/* Banners */}
        {isOffline ? (
          <View style={styles.offlineBanner}>
            <IconSymbol name="wifi.slash" size={24} color={C.error} />
            <View style={{ flex: 1 }}>
              <Text style={styles.offlineTitle}>TIMELINE OFFLINE</Text>
              {/* Friendly explanation is primary; the raw error is a secondary
                  detail so the operator still sees it but isn't led by it. */}
              <Text style={styles.offlineBody}>
                CaptainPad can&apos;t reach the engine timeline; it keeps firing cues on its own — reconnecting…
              </Text>
              {error ? <Text style={styles.offlineDetail}>{error}</Text> : null}
            </View>
          </View>
        ) : null}
        {!isOffline && error ? <Banner styles={styles} text={error} tone="error" /> : null}
        {actionError ? <Banner styles={styles} text={actionError} tone="error" /> : null}
        {previewError ? <Banner styles={styles} text={`Draft invalid: ${previewError.msg}`} tone="error" /> : null}
        {previewTransportError ? <Banner styles={styles} text={`Preview unavailable: ${previewTransportError} (a valid draft still auto-saves)`} tone="error" /> : null}
        {saveOk ? <Banner styles={styles} text={saveOk} tone="ok" C={C} /> : null}

        {/* ── Live controls ──
            PAUSE and HOLD were removed (2026-07-03 simplification): the only
            way to interrupt a running plan is a TEMPORARY TAKE OVER from the
            deck/mixer (which always auto-resumes), surfaced by the global plan
            banner + its RESUME NOW. What stays here is the AUTO toggle (baseline
            autopilot on/off) and the plan picker. */}
        <View style={styles.controlsRow}>
          <TouchableOpacity
            onPress={() => state && setAutopilot(!state.autopilotEnabled)}
            disabled={!state}
            style={[
              styles.controlButton,
              state?.autopilotEnabled
                ? { backgroundColor: C.tertiary }
                : { backgroundColor: C.surfaceContainerHigh, borderColor: C.ghostBorder, borderWidth: 1 },
            ]}
            accessibilityLabel={state?.autopilotEnabled ? 'Disable autopilot' : 'Enable autopilot'}
          >
            <IconSymbol name="shuffle" size={16} color={state?.autopilotEnabled ? '#FFF' : C.text} />
            <Text style={[styles.controlLabel, { color: state?.autopilotEnabled ? '#FFF' : C.text }]}>
              {state?.autopilotEnabled ? 'AUTO ON' : 'AUTO OFF'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => { refreshPlans(); setPlanPickerOpen(true); }}
            style={[styles.controlButton, { backgroundColor: C.surfaceContainerHigh, borderColor: C.ghostBorder, borderWidth: 1 }]}
            accessibilityLabel="Open plans"
          >
            <IconSymbol name="calendar.badge.clock" size={16} color={C.text} />
            <Text style={[styles.controlLabel, { color: C.text }]} numberOfLines={1}>PLANS ▾</Text>
          </TouchableOpacity>
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 32 }} showsVerticalScrollIndicator={false}>
          {/* ── Festival span + sun-estimate tz (top of the maker page) ── */}
          {festivalView ? (
            <FestivalEditor
              startDate={festivalView.startDate}
              days={festivalView.days}
              tz={festivalView.tz}
              onSetStartDate={handleSetStartDate}
              onAddDay={handleAddDay}
              onRemoveDay={handleRemoveDay}
              onSetTz={handleSetTz}
            />
          ) : null}

          {/* ── B. 8-day overview ── */}
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionLabel}>
              {draft ? `MAKER — ${draft.name}` : '8-DAY OVERVIEW'}
            </Text>
            {draft ? (
              <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
                {/* Auto-save status — no SAVE/CANCEL/DONE buttons (operator
                    request 2026-07-03): the maker writes changes automatically
                    and the tab is ALWAYS editing the active plan, so there's
                    nothing to "close". A schema-invalid draft shows "⚠ fix to
                    save" (the error banner below explains). */}
                <Text style={{
                  fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10, letterSpacing: 0.6,
                  color: autoSaveState === 'error' ? C.error : (autoSaveState === 'saving' ? C.secondary : '#00a86b'),
                }}>
                  {autoSaveState === 'saving' ? 'SAVING…' : autoSaveState === 'error' ? '⚠ FIX TO SAVE' : '✓ SAVED'}
                </Text>
              </View>
            ) : null}
          </View>

          {/* ── DEFAULT CUE (maker-only) — the deck's standing fallback that
              runs in the gaps between cues + when the plan has no cues. Every
              maker plan is seeded with one; tap EDIT to set its playlist. ── */}
          {draft ? (
            <View style={styles.defaultCueRow}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.defaultCueLabel}>DEFAULT CUE</Text>
                <Text style={styles.defaultCueSub} numberOfLines={1}>
                  {draft.defaultCue
                    ? `${draft.defaultCue.label ? `${draft.defaultCue.label} · ` : ''}${defaultCueActionSummary(draft.defaultCue)}`
                    : 'No default cue set — tap EDIT to add one.'}
                </Text>
              </View>
              <TouchableOpacity
                onPress={openEditDefaultCue}
                style={styles.miniBtn}
                accessibilityLabel="Edit the plan default cue"
              >
                <Text style={styles.miniBtnText}>EDIT</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {overview ? (
            <DayOverviewStrip
              days={overview.days}
              todayIndex={todayIndex}
              selectedIndex={selectedDay}
              nowMinutes={nowMinutes}
              onSelectDay={(idx) => {
                // Single tap: SELECT/VIEW the day (highlight + filter the cue
                // list to it). This never opens the editor and never touches
                // the draft, so viewing is non-destructive.
                setSelectedDay(idx);
                setShowAllDays(false);
              }}
              onEditDay={(idx) => {
                // Explicit EDIT DAY: open the day editor. It needs a draft to
                // edit; if we're viewing the live plan, load it into the draft
                // first so edits mutate a copy. Only open if the load actually
                // succeeded — a failed / festival-less load must not dangle.
                setSelectedDay(idx);
                if (!draft && state?.activePlan) {
                  loadPlanIntoDraft(state.activePlan).then((ok) => { if (ok) setEditingDay(idx); });
                } else if (draft) {
                  setEditingDay(idx);
                } else {
                  setActionError('No active plan to edit — start from the BRC template via PLANS.');
                }
              }}
            />
          ) : (
            <Text style={styles.emptyHint}>
              {draft ? 'Previewing draft…' : 'No active plan overview. Open PLANS to start one.'}
            </Text>
          )}

          {!draft ? (
            <Text style={styles.helperLine}>Tap a day to view its cues; tap EDIT DAY to edit it — the active plan loads into the maker.</Text>
          ) : (
            <Text style={styles.helperLine}>Edits preview live across all days and auto-save. ACTIVATE (in PLANS) makes the plan run.</Text>
          )}

          {/* ── D. Cue list + controls (live) ── */}
          {state ? (
            <>
              {/* CUES header with the ALL DAYS / DAY N toggle. The default view
                  shows the SELECTED day's resolved cues. */}
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionLabel}>
                  {showAllDays
                    ? 'CUES (LIVE) · ALL DAYS'
                    : `CUES (LIVE) · ${selectedDayOverview ? `DAY ${selectedDayOverview.index + 1}` : 'DAY'}`}
                </Text>
                <View style={styles.dayToggle}>
                  <TouchableOpacity
                    onPress={() => setShowAllDays(false)}
                    style={[styles.dayToggleBtn, !showAllDays && { backgroundColor: C.primary }]}
                    accessibilityLabel="Show selected day cues"
                  >
                    <Text style={[styles.dayToggleText, { color: !showAllDays ? C.onPrimary : C.text }]} numberOfLines={1}>
                      {selectedDayOverview ? `DAY ${selectedDayOverview.index + 1}` : 'DAY'}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => setShowAllDays(true)}
                    style={[styles.dayToggleBtn, showAllDays && { backgroundColor: C.primary }]}
                    accessibilityLabel="Show all days cues"
                  >
                    <Text style={[styles.dayToggleText, { color: showAllDays ? C.onPrimary : C.text }]}>ALL DAYS</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {viewCues.length === 0 ? (
                <Text style={styles.emptyHint}>
                  {showAllDays ? 'The active plan has no cues.' : 'No cues on this day.'}
                </Text>
              ) : (
                viewCues.map(({ cue, dayIndex }) => (
                  <CueRow
                    key={`${dayIndex}:${cue.id}`}
                    cue={cue}
                    dayIndex={showAllDays ? dayIndex : null}
                    live={liveCueById.get(cue.id) ?? null}
                    fireable={draft === null || liveCueIds.has(cue.id)}
                    // Distinguish WHY a draft cue can't fire so the hint is
                    // actionable (operator confusion 2026-07-02: a saved cue on
                    // a non-active plan still said "save + activate"). Editing
                    // the ACTIVE plan → an un-fireable cue is merely UNSAVED
                    // ("Save to fire"; hot-reload makes it live). A DIFFERENT
                    // plan loaded in the maker → the whole plan isn't running
                    // ("Activate this plan to fire"). The engine's fireCue only
                    // targets the ACTIVE plan, so activation is mandatory there.
                    fireBlockedReason={
                      (draft === null || liveCueIds.has(cue.id))
                        ? null
                        : (draft.name === activePlanName ? 'save' : 'activate')
                    }
                    // Mark the row that is the LIVE event right now so the
                    // running cue is unmistakable in the list. Always-editing:
                    // the draft is normally the ACTIVE plan, so show the
                    // highlight when viewing live OR editing the active plan —
                    // but never when a DIFFERENT plan is loaded in the maker.
                    isActive={(draft === null || draft.name === activePlanName) && state?.activeCue?.id === cue.id}
                    onFire={fireCue}
                    styles={styles}
                    C={C}
                  />
                ))
              )}

              <Text style={styles.sectionLabel}>EVENT LOG</Text>
              {(!Array.isArray(state.recentFires) || state.recentFires.length === 0) ? (
                <Text style={styles.emptyHint}>No events yet.</Text>
              ) : (
                // Newest FIRST, capped to the latest EVENT_LOG_MAX_ROWS. The
                // engine ring is newest-LAST, so reverse a copy (stable under
                // same-ms entries — Array.reverse preserves relative order of
                // the reversal deterministically).
                [...state.recentFires].reverse().slice(0, EVENT_LOG_MAX_ROWS).map((f, i) => (
                  <EventLogRow
                    key={`${f.kind ?? 'fire'}:${f.cueId ?? f.label ?? 'event'}:${f.atMs}:${i}`}
                    entry={f}
                    styles={styles}
                  />
                ))
              )}
            </>
          ) : !isOffline ? (
            <Text style={styles.emptyHint}>Loading timeline…</Text>
          ) : null}
        </ScrollView>
      </View>

      {/* ── Sheets ── */}
      <PlanPickerSheet
        visible={planPickerOpen}
        plans={plans}
        activePlan={state?.activePlan ?? null}
        draftName={draft?.name ?? null}
        onLoad={loadPlanIntoDraft}
        onActivate={handleActivate}
        onDuplicate={handleDuplicate}
        onDelete={handleDeletePlan}
        onNewTemplate={handleNewTemplate}
        onNewBlank={handleNewBlank}
        onClose={() => setPlanPickerOpen(false)}
      />

      <DayEditor
        visible={editingDay !== null && !!draft}
        day={editingDayOverview}
        plan={draft ?? brcStarterPlan()}
        nowMinutes={editingDay !== null && editingDay === todayIndex ? nowMinutes : null}
        onAddCue={openAddCue}
        onEditCue={openEditCue}
        onDeleteCue={handleDeleteCue}
        onClose={() => setEditingDay(null)}
      />

      {draft ? (
        <CueEditorSheet
          visible={cueSheetOpen}
          initialCue={editingCue}
          plan={draft}
          playlists={playlists}
          palettes={getCachedColorPalettes()}
          dayIndex={editingDay ?? 0}
          onSave={handleSaveCue}
          onDelete={editingCue ? () => handleDeleteCue(editingCue.id) : null}
          onClose={() => { setCueSheetOpen(false); setEditingCue(null); }}
        />
      ) : null}

      {draft ? (
        <CueEditorSheet
          visible={defaultCueSheetOpen}
          mode="defaultCue"
          initialCue={null}
          initialDefaultCue={draft.defaultCue ?? null}
          plan={draft}
          playlists={playlists}
          palettes={getCachedColorPalettes()}
          dayIndex={0}
          onSave={handleSaveCue}
          onSaveDefault={handleSaveDefaultCue}
          onDelete={null}
          onClose={() => setDefaultCueSheetOpen(false)}
        />
      ) : null}
    </View>
  );
}

// ── Banner ──
function Banner({ styles, text, tone, C }: { styles: Styles; text: string; tone: 'error' | 'ok'; C?: Palette }) {
  if (tone === 'ok' && C) {
    return (
      <View style={[styles.actionErrorBanner, { backgroundColor: 'transparent', borderColor: C.tertiary }]}>
        <Text style={[styles.actionErrorText, { color: C.tertiary }]} numberOfLines={2}>{text}</Text>
      </View>
    );
  }
  return (
    <View style={styles.actionErrorBanner}>
      <Text style={styles.actionErrorText} numberOfLines={3}>{text}</Text>
    </View>
  );
}

// ── Cue row (overview-resolved, with live FIRE + countdown) ──
// Renders a day's resolved cue (atLocal time + kind) and layers the LIVE engine
// cue (countdown / error / enabled) over it when one matches by id.
function CueRow({
  cue, dayIndex, live, fireable, fireBlockedReason, isActive, onFire, styles, C,
}: {
  cue: OverviewCue;
  /** When set (ALL DAYS view), prefixes the row with its day number. */
  dayIndex: number | null;
  /** Matching live engine cue, or null when not live-tracked. */
  live: TimelineCue | null;
  /** Whether this cue exists in the ACTIVE plan (so it can be fired). */
  fireable: boolean;
  /** Why FIRE is blocked (drives the hint), or null when fireable. */
  fireBlockedReason: 'save' | 'activate' | null;
  /** True when this cue is the live event driving the deck right now. */
  isActive: boolean;
  onFire: (id: string) => void;
  styles: Styles;
  C: Palette;
}) {
  const hasError = !!live?.lastError;
  const triggerText = triggerSummaryText(cue.trigger);
  const atText = hhmmTo12h(cue.atLocal, '—');
  const subtitle = dayIndex !== null
    ? `D${dayIndex + 1} · ${atText} · ${triggerText}`
    : `${atText} · ${triggerText}`;
  const countdown = live
    ? (live.enabled ? formatCountdown(live.nextInSec) : 'off')
    : atText;
  // FIRE only fires cues that exist in the ENGINE'S ACTIVE plan (`fireable`,
  // computed from the active-plan overview). A row from an unsaved/unactivated
  // DRAFT (an id not yet in the live plan) is NOT fireable — firing it would make
  // the engine fireCue(id) throw `cue "<id>" not found`. So we disable FIRE with a
  // clear "save + activate" hint for those; every active-plan cue fires normally.
  const canFire = fireable;
  const fireHint = fireBlockedReason === 'save'
    ? 'save to fire'
    : fireBlockedReason === 'activate'
      ? 'activate this plan to fire'
      : null;
  return (
    <View style={[
      styles.cueRow,
      // Live-event highlight: a green wash + rule marks the cue driving the
      // deck right now (never at the same time as an error row).
      isActive && !hasError && { borderColor: '#00a86b', backgroundColor: 'rgba(0,168,107,0.10)' },
      hasError && { borderColor: C.error, backgroundColor: C.errorContainer },
    ]}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {isActive ? <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 8, letterSpacing: 1, color: '#00a86b', backgroundColor: 'rgba(0,168,107,0.18)', paddingHorizontal: 5, paddingVertical: 2, borderRadius: 4, overflow: 'hidden' }}>● NOW</Text> : null}
          <Text style={[styles.cueLabel, hasError && { color: C.error }]} numberOfLines={1}>{cue.label}</Text>
        </View>
        <Text style={styles.cueTrigger} numberOfLines={1}>{subtitle}</Text>
        {hasError ? <Text style={styles.cueError} numberOfLines={2}>{live!.lastError}</Text> : null}
        {fireHint ? <Text style={styles.cueTrigger} numberOfLines={1}>{fireHint}</Text> : null}
      </View>
      <Text style={[styles.cueCountdown, live && !live.enabled && { color: C.icon }]}>{countdown}</Text>
      <TouchableOpacity
        onPress={() => onFire(cue.id)}
        disabled={!canFire}
        style={[styles.fireButton, !canFire && { opacity: 0.4 }]}
        accessibilityLabel={canFire ? `Fire cue ${cue.label}` : `Fire cue ${cue.label} (${fireHint || 'unavailable'})`}
        accessibilityState={{ disabled: !canFire }}
      >
        <Text style={styles.fireButtonLabel}>FIRE</Text>
      </TouchableOpacity>
    </View>
  );
}

// Compact trigger summary for the overview cue subtitle. The live engine
// cue carries a `trigger` string; the overview cue carries a structured
// CueTrigger object, so summarise it here (parallels triggerSummary in the
// template, kept local to avoid importing the maker helper into the live row).
function triggerSummaryText(t: OverviewCue['trigger']): string {
  switch (t.type) {
    case 'clock': return `clock ${hhmmTo12h(t.at, t.at)}`;
    case 'sun': {
      const off = t.offsetMin ? ` ${t.offsetMin > 0 ? '+' : ''}${t.offsetMin}m` : '';
      return `${t.event}${off}`;
    }
    case 'phase': return `phase ${t.phase}`;
    case 'mood': return `mood ${t.from}→${t.to}`;
    case 'manual': return 'manual';
    default: return 'cue';
  }
}

// One EVENT LOG row (engine wire shape
// { kind:'fire'|'lifecycle', cueId?, label, reason, source, atMs }):
//   fire      — a cue application: bold label + source·reason + time.
//   lifecycle — a plan/mode transition: visibly dimmer, no FIRE affordances.
// DEFENSIVE by contract: an unknown/missing kind renders as a fire row; a
// missing label falls back to cueId then 'event'; non-string reason/source and
// a bad atMs render harmlessly ('' / '—') — a malformed entry can never crash
// the list. Times are DEVICE-LOCAL AM/PM wall-clock formatted from atMs (on
// playa the device tz == the plan tz; off-playa the operator's own clock is
// the least-surprising rendering — deliberate, matches the pre-existing rows).
function EventLogRow({ entry, styles }: { entry: TimelineRecentFire; styles: Styles }) {
  const label = (typeof entry.label === 'string' && entry.label)
    || (typeof entry.cueId === 'string' && entry.cueId)
    || 'event';
  const reason = typeof entry.reason === 'string' ? entry.reason : '';
  const source = typeof entry.source === 'string' ? entry.source : '';
  let time = '—';
  if (typeof entry.atMs === 'number' && Number.isFinite(entry.atMs)) {
    const t = new Date(entry.atMs);
    const h24 = t.getHours();
    const period = h24 < 12 ? 'AM' : 'PM';
    const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
    time = `${h12}:${String(t.getMinutes()).padStart(2, '0')}:${String(t.getSeconds()).padStart(2, '0')} ${period}`;
  }
  if (entry.kind === 'lifecycle') {
    return (
      <View style={[styles.fireLogRow, styles.lifecycleRow]}>
        <Text style={styles.lifecycleLabel} numberOfLines={1}>{label}</Text>
        <Text style={styles.lifecycleReason} numberOfLines={1}>{reason}</Text>
        <Text style={styles.fireLogTime}>{time}</Text>
      </View>
    );
  }
  // 'auto' is the baseline fire source — only tag the noteworthy ones
  // (manual / catchUp / default / anything unknown-but-present).
  const detail = source && source !== 'auto' ? `${source} · ${reason}` : reason;
  return (
    <View style={styles.fireLogRow}>
      <Text style={styles.fireLogCue} numberOfLines={1}>{label}</Text>
      <Text style={styles.fireLogReason} numberOfLines={1}>{detail}</Text>
      <Text style={styles.fireLogTime}>{time}</Text>
    </View>
  );
}

type Styles = ReturnType<typeof makeStyles>;

function makeStyles(C: Palette, globalStyles: GlobalStyles) {
  return StyleSheet.create({
    container: { ...globalStyles.container, padding: 24, flexDirection: 'column' },
    surface: { flex: 1, ...globalStyles.surfaceLow, padding: 24, borderWidth: 1, borderColor: C.ghostBorder },
    headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, gap: 12 },
    headerTitle: { fontFamily: 'SpaceGrotesk_700Bold', fontSize: 16, color: C.text, letterSpacing: 1.2, textTransform: 'uppercase' },
    headerScene: { fontFamily: 'Inter_400Regular', fontSize: 11, color: C.secondary, marginTop: 2 },
    pill: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1.5, minHeight: 30, justifyContent: 'center' },
    pillText: { fontFamily: 'SpaceGrotesk_700Bold', fontSize: 11, letterSpacing: 0.8 },
    engineDotWrap: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    engineDot: { width: 10, height: 10, borderRadius: 5 },
    engineDotLabel: { fontFamily: 'SpaceGrotesk_700Bold', fontSize: 9, letterSpacing: 0.8, color: C.secondary },
    nextCueRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14, flexWrap: 'wrap' },
    nextCueText: { fontFamily: 'Inter_600SemiBold', fontSize: 13, color: C.text, flexShrink: 1 },
    endProgramBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: '#f5a623' },
    endProgramText: { fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10, letterSpacing: 0.8, color: '#f5a623' },
    phaseChip: {
      fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10, letterSpacing: 0.6, color: C.primary,
      borderWidth: 1, borderColor: C.ghostBorder, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3,
    },
    controlsRow: { flexDirection: 'row', gap: 10, marginBottom: 16, flexWrap: 'wrap' },
    controlButton: {
      flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 12,
      borderRadius: 8, minHeight: 44, justifyContent: 'center',
    },
    controlLabel: { fontFamily: 'SpaceGrotesk_700Bold', fontSize: 12, letterSpacing: 0.8 },
    sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
    sectionLabel: {
      fontFamily: 'SpaceGrotesk_700Bold', fontSize: 11, color: C.icon, letterSpacing: 1.2,
      textTransform: 'uppercase', marginTop: 8, marginBottom: 10,
    },
    helperLine: { fontFamily: 'Inter_400Regular', fontSize: 11, color: C.secondary, marginTop: 8, marginBottom: 4 },
    defaultCueRow: {
      flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 4, marginBottom: 10,
      paddingVertical: 10, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1,
      borderColor: C.ghostBorder, backgroundColor: C.surfaceContainerLowest,
    },
    defaultCueLabel: {
      fontFamily: 'SpaceGrotesk_700Bold', fontSize: 11, letterSpacing: 1, color: C.icon, textTransform: 'uppercase',
    },
    defaultCueSub: { fontFamily: 'Inter_400Regular', fontSize: 12, color: C.secondary, marginTop: 3 },
    dayToggle: {
      flexDirection: 'row', gap: 4, borderWidth: 1, borderColor: C.ghostBorder, borderRadius: 8, padding: 2,
    },
    dayToggleBtn: {
      paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6, minHeight: 30, justifyContent: 'center', alignItems: 'center',
    },
    dayToggleText: { fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10, letterSpacing: 0.6 },
    miniBtn: {
      paddingHorizontal: 16, paddingVertical: 8, minHeight: 36, borderRadius: 8,
      backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center',
    },
    miniBtnText: { fontFamily: 'SpaceGrotesk_700Bold', fontSize: 11, letterSpacing: 0.8, color: C.onPrimary },
    cueRow: {
      flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 14,
      borderRadius: 12, borderWidth: 1, borderColor: C.ghostBorder, backgroundColor: C.surfaceContainerLowest, marginBottom: 8,
    },
    cueLabel: { fontFamily: 'SpaceGrotesk_700Bold', fontSize: 14, color: C.text },
    cueTrigger: { fontFamily: 'Inter_400Regular', fontSize: 12, color: C.secondary, marginTop: 2 },
    cueError: { fontFamily: 'Inter_400Regular', fontSize: 11, color: C.error, marginTop: 4 },
    cueCountdown: { fontFamily: 'SpaceGrotesk_700Bold', fontSize: 14, color: C.text, minWidth: 56, textAlign: 'right' },
    fireButton: {
      paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8, backgroundColor: C.primary,
      minHeight: 40, minWidth: 64, alignItems: 'center', justifyContent: 'center',
    },
    fireButtonLabel: { fontFamily: 'SpaceGrotesk_700Bold', fontSize: 12, color: C.onPrimary, letterSpacing: 0.8 },
    fireLogRow: {
      flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, paddingHorizontal: 12,
      borderRadius: 8, backgroundColor: C.surfaceContainerLowest, marginBottom: 4,
    },
    fireLogCue: { fontFamily: 'SpaceGrotesk_700Bold', fontSize: 12, color: C.text, flex: 1 },
    fireLogReason: { fontFamily: 'Inter_400Regular', fontSize: 12, color: C.secondary, flex: 1 },
    fireLogTime: { fontFamily: 'Inter_400Regular', fontSize: 12, color: C.icon },
    // Lifecycle event rows: visibly quieter than fires (transparent bg, hairline
    // border, secondary text) — a mode/plan transition, not a cue application.
    lifecycleRow: { backgroundColor: 'transparent', borderWidth: 1, borderColor: C.ghostBorder },
    lifecycleLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 12, color: C.secondary, flex: 1.4 },
    lifecycleReason: { fontFamily: 'Inter_400Regular', fontSize: 11, color: C.icon, flex: 0.6, textAlign: 'right' },
    emptyHint: { fontFamily: 'Inter_400Regular', fontSize: 12, color: C.secondary, paddingVertical: 8, paddingHorizontal: 4 },
    offlineBanner: {
      backgroundColor: C.errorContainer, borderColor: C.error, borderWidth: 1, borderRadius: 12,
      padding: 16, marginBottom: 16, flexDirection: 'row', alignItems: 'center', gap: 12,
    },
    offlineTitle: { fontFamily: 'SpaceGrotesk_700Bold', color: C.error, fontSize: 14, letterSpacing: 0.8 },
    offlineBody: { fontFamily: 'Inter_400Regular', color: C.error, fontSize: 12, marginTop: 4 },
    offlineDetail: { fontFamily: 'Inter_400Regular', color: C.error, fontSize: 10, marginTop: 4, opacity: 0.7 },
    actionErrorBanner: {
      backgroundColor: C.errorContainer, borderColor: C.error, borderWidth: 1, borderRadius: 8, padding: 12, marginBottom: 12,
    },
    actionErrorText: { fontFamily: 'Inter_400Regular', color: C.error, fontSize: 12 },
  });
}
