/**
 * Timeline tab — viewer + MAKER for the in-engine Timeline (docs/38 §14–§15).
 *
 * The Timeline now lives IN the engine (REST/WS on the engine base :6968).
 * This tab is the ONLY UI for it (§15.3): a live viewer AND a super-fluid
 * 8-day festival maker, all in CaptainPad's theme.
 *
 * Sections:
 *   A. Header / live status — plan + scene, controller pill (AUTOPILOT /
 *      PROGRAM / MANUAL), autopilot toggle, PAUSE/RESUME + HOLD, mood pill,
 *      active-program countdown, engine dot, offline banner.
 *   B. 8-day overview — horizontally-scannable day cards (sun arc + cue
 *      markers by kind). Live (GET /overview) until the operator edits, then
 *      a debounced preview of the DRAFT (POST /overview) so changes are seen
 *      across all days before saving.
 *   C. Day editor / maker — tap a day → vertical timeline; add/edit/delete
 *      cues via the themed CueEditorSheet (segmented/stepper/dropdown — no
 *      keyboard walls). Validation 400s surface inline, loudly.
 *   D. Cue list + controls — per-cue FIRE, recent fires, program/end.
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
import { Palette } from '@/constants/theme';
import { useGlobalStyles, GlobalStyles } from '@/styles/globalStyles';
import { usePalette } from '@/hooks/use-theme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useTimeline } from '@/hooks/useTimeline';
import { fetchPlaylists } from '@/utils/api';
import {
  fetchTimelinePlans,
  fetchTimelinePlan,
  fetchTimelineOverview,
  previewTimelineOverview,
  saveTimelinePlan,
  TimelineState,
  TimelineCue,
  TimelineRecentFire,
  TimelineOverview,
  OverviewCue,
  ShowPlan,
  PlanCue,
} from '@/utils/timelineApi';
import { DayOverviewStrip } from '@/components/timeline/DayOverviewStrip';
import { DayEditor } from '@/components/timeline/DayEditor';
import { CueEditorSheet } from '@/components/timeline/CueEditorSheet';
import { PlanPickerSheet } from '@/components/timeline/PlanPickerSheet';
import {
  FestivalEditor, addDaysToDateKey, FESTIVAL_MIN_DAYS, FESTIVAL_MAX_DAYS,
} from '@/components/timeline/FestivalEditor';
import {
  brcStarterPlan, clonePlan, duplicatePlan, makeCueId,
} from '@/components/timeline/timelineTemplate';

const HOLD_MINUTES = 30;
const PREVIEW_DEBOUNCE_MS = 350;

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
  const { state, connected, error, setMode, setAutopilot, hold, resume, endProgram, fireCue, activatePlan } = useTimeline();

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
  useEffect(() => {
    refreshPlans();
    refreshLiveOverview();
    fetchPlaylists().then((r) => { if (r.ok && r.data) setPlaylists(r.data); });
  }, [refreshPlans, refreshLiveOverview]);

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

  const handleNewTemplate = useCallback(() => {
    setDraft(brcStarterPlan());
    setDraftVersion((v) => v + 1);
    setSaveOk(null);
    setActionError(null);
    setPreviewTransportError(null);
    setPlanPickerOpen(false);
  }, []);

  const handleDuplicate = useCallback(async (name: string) => {
    const r = await fetchTimelinePlan(name);
    if (!r.ok || !r.data) { setActionError(r.error || `Could not load plan ${name}`); return; }
    setDraft(duplicatePlan(r.data, `${name}_copy`.slice(0, 64)));
    setDraftVersion((v) => v + 1);
    setActionError(null);
    setPreviewTransportError(null);
    setPlanPickerOpen(false);
  }, []);

  const handleActivate = useCallback(async (name: string) => {
    const ok = await activatePlan(name);
    if (ok) { refreshPlans(); refreshLiveOverview(); setPlanPickerOpen(false); }
    else setActionError('Engine rejected plan activation');
  }, [activatePlan, refreshPlans, refreshLiveOverview]);

  const handleSave = useCallback(async () => {
    if (!draft) return;
    const r = await saveTimelinePlan(draft);
    if (r.ok) {
      setSaveOk(`Saved "${draft.name}"`);
      setActionError(null);
      refreshPlans();
    } else {
      setActionError(r.error || 'Engine rejected save');
    }
  }, [draft, refreshPlans]);

  const handleDiscardDraft = useCallback(() => {
    setDraft(null);
    setDraftOverview(null);
    setPreviewError(null);
    setPreviewTransportError(null);
    setSaveOk(null);
    setEditingDay(null);
  }, []);

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

  // Step the festival start date by ±1 day. Day i = startDate + i, so shifting
  // the start shifts every day's calendar date; the engine re-computes sun on
  // the next preview. No cue cleanup needed (the span length is unchanged).
  const handleShiftStart = useCallback((deltaDays: number) => {
    ensureDraftThen((p) => {
      p.festival = { ...p.festival, startDate: addDaysToDateKey(p.festival.startDate, deltaDays) };
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
    setEditingCue(null);
    setCueSheetOpen(true);
  }, [draft]);

  const openEditCue = useCallback((cue: PlanCue) => {
    setEditingCue(cue);
    setCueSheetOpen(true);
  }, []);

  // ── Live controls ──
  const isOffline = !connected && !state;
  const mode = state?.mode ?? 'armed';
  const isPaused = mode === 'paused';
  const handlePauseResume = useCallback(() => {
    if (isPaused) resume(); else setMode('paused');
  }, [isPaused, resume, setMode]);

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
              <Text style={styles.headerTitle} numberOfLines={1}>
                {state?.activePlan ? `TIMELINE — ${state.activePlan}` : 'TIMELINE'}
              </Text>
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

        {/* Active-program countdown */}
        {state?.activeProgram ? (
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
        {previewTransportError ? <Banner styles={styles} text={`Preview unavailable: ${previewTransportError} (you can still SAVE a valid draft)`} tone="error" /> : null}
        {saveOk ? <Banner styles={styles} text={saveOk} tone="ok" C={C} /> : null}

        {/* ── Live controls ── */}
        <View style={styles.controlsRow}>
          <TouchableOpacity
            onPress={handlePauseResume}
            disabled={!state}
            style={[styles.controlButton, isPaused ? { backgroundColor: C.tertiary } : { backgroundColor: C.surfaceContainerHigh, borderColor: C.ghostBorder, borderWidth: 1 }]}
            accessibilityLabel={isPaused ? 'Resume timeline' : 'Pause timeline'}
          >
            <IconSymbol name={isPaused ? 'play.fill' : 'pause.fill'} size={16} color={isPaused ? '#FFF' : C.text} />
            <Text style={[styles.controlLabel, { color: isPaused ? '#FFF' : C.text }]}>{isPaused ? 'RESUME' : 'PAUSE'}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => hold(HOLD_MINUTES)}
            disabled={!state}
            style={[styles.controlButton, { backgroundColor: C.surfaceContainerHigh, borderColor: C.ghostBorder, borderWidth: 1 }]}
            accessibilityLabel={`Hold for ${HOLD_MINUTES} minutes`}
          >
            <IconSymbol name="pin.fill" size={16} color={C.text} />
            <Text style={[styles.controlLabel, { color: C.text }]}>{`HOLD ${HOLD_MINUTES}m`}</Text>
          </TouchableOpacity>

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
              onShiftStart={handleShiftStart}
              onAddDay={handleAddDay}
              onRemoveDay={handleRemoveDay}
              onSetTz={handleSetTz}
            />
          ) : null}

          {/* ── B. 8-day overview ── */}
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionLabel}>
              {draft ? `MAKER — ${draft.name} (DRAFT)` : '8-DAY OVERVIEW'}
            </Text>
            {draft ? (
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TouchableOpacity onPress={handleDiscardDraft} style={styles.miniBtnGhost} accessibilityLabel="Discard draft">
                  <Text style={styles.miniBtnGhostText}>DISCARD</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleSave}
                  disabled={saveBlocked}
                  style={[styles.miniBtn, saveBlocked && { opacity: 0.4 }]}
                  accessibilityLabel="Save draft plan"
                >
                  <Text style={styles.miniBtnText}>SAVE</Text>
                </TouchableOpacity>
              </View>
            ) : null}
          </View>

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
            <Text style={styles.helperLine}>Edits preview live across all days. SAVE writes the plan; ACTIVATE (in PLANS) makes it run.</Text>
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
                    onFire={fireCue}
                    styles={styles}
                    C={C}
                  />
                ))
              )}

              <Text style={styles.sectionLabel}>RECENT FIRES</Text>
              {(!state.recentFires || state.recentFires.length === 0) ? (
                <Text style={styles.emptyHint}>No cues fired yet.</Text>
              ) : (
                state.recentFires.map((f, i) => (
                  <RecentFireRow key={`${f.cueId}:${f.atMs}:${i}`} fire={f} styles={styles} />
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
        onNewTemplate={handleNewTemplate}
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
          dayIndex={editingDay ?? 0}
          onSave={handleSaveCue}
          onDelete={editingCue ? () => handleDeleteCue(editingCue.id) : null}
          onClose={() => { setCueSheetOpen(false); setEditingCue(null); }}
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
  cue, dayIndex, live, onFire, styles, C,
}: {
  cue: OverviewCue;
  /** When set (ALL DAYS view), prefixes the row with its day number. */
  dayIndex: number | null;
  /** Matching live engine cue, or null when not live-tracked. */
  live: TimelineCue | null;
  onFire: (id: string) => void;
  styles: Styles;
  C: Palette;
}) {
  const hasError = !!live?.lastError;
  const triggerText = triggerSummaryText(cue.trigger);
  const subtitle = dayIndex !== null
    ? `D${dayIndex + 1} · ${cue.atLocal ?? '—'} · ${triggerText}`
    : `${cue.atLocal ?? '—'} · ${triggerText}`;
  const countdown = live
    ? (live.enabled ? formatCountdown(live.nextInSec) : 'off')
    : (cue.atLocal ?? '—');
  return (
    <View style={[styles.cueRow, hasError && { borderColor: C.error, backgroundColor: C.errorContainer }]}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[styles.cueLabel, hasError && { color: C.error }]} numberOfLines={1}>{cue.label}</Text>
        <Text style={styles.cueTrigger} numberOfLines={1}>{subtitle}</Text>
        {hasError ? <Text style={styles.cueError} numberOfLines={2}>{live!.lastError}</Text> : null}
      </View>
      <Text style={[styles.cueCountdown, live && !live.enabled && { color: C.icon }]}>{countdown}</Text>
      <TouchableOpacity onPress={() => onFire(cue.id)} style={styles.fireButton} accessibilityLabel={`Fire cue ${cue.label}`}>
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
    case 'clock': return `clock ${t.at}`;
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

function RecentFireRow({ fire, styles }: { fire: TimelineRecentFire; styles: Styles }) {
  const t = new Date(fire.atMs);
  const time = Number.isFinite(fire.atMs)
    ? `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}:${String(t.getSeconds()).padStart(2, '0')}`
    : '—';
  return (
    <View style={styles.fireLogRow}>
      <Text style={styles.fireLogCue} numberOfLines={1}>{fire.cueId}</Text>
      <Text style={styles.fireLogReason} numberOfLines={1}>{fire.reason}</Text>
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
    miniBtnGhost: {
      paddingHorizontal: 16, paddingVertical: 8, minHeight: 36, borderRadius: 8,
      borderWidth: 1, borderColor: C.ghostBorder, alignItems: 'center', justifyContent: 'center',
    },
    miniBtnGhostText: { fontFamily: 'SpaceGrotesk_700Bold', fontSize: 11, letterSpacing: 0.8, color: C.text },
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
