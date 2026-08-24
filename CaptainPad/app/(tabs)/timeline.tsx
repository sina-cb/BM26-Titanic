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
 *   C. DAY level (`DayView`) — tap a day to ZOOM IN: a full-screen day with
 *      phase bands, the resolved "what actually plays" ribbon, the events, and
 *      the same add/edit/delete via the themed CueEditorSheet (segmented/
 *      stepper/dropdown — no keyboard walls). Validation 400s surface inline,
 *      loudly. ◀ WEEK zooms back out.
 *   D. Cue list + controls — per-cue FIRE, the EVENT LOG (cue fires + plan
 *      lifecycle: activate/resume/autopilot/takeover/program),
 *      program/end.
 *
 * The ZOOM LADDER (report _94, operator ruling D1–D8 as recommended):
 *
 *     FESTIVAL ──tap a day──▶ DAY ──tap an event──▶ EVENT (the deck itself)
 *      (the 8-day strip)     (this tab, level C)    LIVE  → PERFORM
 *                                                   else  → TIME TRAVEL
 *
 * FESTIVAL and DAY are pure BROWSE levels — client-side navigation, zero engine
 * effect, so reviewing the timeline can never touch the rig. EVENT is the only
 * level that does, and it goes through the arbiter's EXISTING human layer (a
 * scoped operator takeover). Leaving it is the existing resume() — which is why
 * returning to THIS tab ends the zoom (D1), from the client that entered it.
 * The mode banner itself is global: `components/timeline/ZoomBanner.tsx`.
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
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { opConfirm, opInfo, opWarn } from '@/utils/op_dialog';
import { useFocusEffect, router } from 'expo-router';
import { Palette } from '@/constants/theme';
import { useGlobalStyles, GlobalStyles } from '@/styles/globalStyles';
import { usePalette } from '@/hooks/use-theme';
import { useTimeline } from '@/hooks/useTimeline';
import { usePerformanceMode } from '@/hooks/usePerformanceMode';
import {
  fetchPlaylists, getCachedColorPalettes, fetchLayerSettingsState,
  fetchDeckChannel, getAutopilot, fetchDeckColorAutopilot,
  getApiBaseAsync,
} from '@/utils/api';
import {
  fetchTimelinePlans,
  fetchTimelinePlan,
  fetchTimelineOverview,
  fetchTimelineState,
  fetchTimelineResolve,
  previewTimelineOverview,
  saveTimelinePlan,
  deleteTimelinePlan,
  TimelineOverview,
  TimelineResolve,
  TimelineTravelSpec,
  OverviewCue,
  TimelineCue,
  OverviewDay,
  ShowPlan,
  PlanCue,
  PlanDefaultCue,
  ActionPlaylist,
} from '@/utils/timelineApi';
import { DayOverviewStrip } from '@/components/timeline/DayOverviewStrip';
import { DayView } from '@/components/timeline/DayView';
import { EventSheet } from '@/components/timeline/EventSheet';
import { CueEditorSheet, type CueSaveResult } from '@/components/timeline/CueEditorSheet';
import { planWithUpsertedCue } from '@/components/timeline/cue_edit_logic';
import {
  isPartyWindowImplementationCue,
  planWithPartyWindow,
  planWithoutPartyWindow,
  type PartyWindowSpec,
} from '@/components/timeline/party_window_logic';
import { PlanPickerSheet } from '@/components/timeline/PlanPickerSheet';
import {
  FestivalEditor, addDaysToDateKey, FESTIVAL_MIN_DAYS, FESTIVAL_MAX_DAYS,
} from '@/components/timeline/FestivalEditor';
import { PlanTransitionEditor } from '@/components/timeline/plan_transition_editor';
import {
  brcStarterPlan, blankPlan, clonePlan, duplicatePlan, makeCueId, seedDefaultCue,
} from '@/components/timeline/timelineTemplate';
import { engineEvents, type EngineMessage } from '@/utils/engineEvents';
import { babyRevealConfirmation } from '@/components/timeline/baby_reveal_confirmation';
import { BabyRevealChoiceSheet } from '@/components/timeline/baby_reveal_choice_sheet';
import { ManualCueReviewSheet } from '@/components/timeline/manual_cue_review_sheet';
import { TimelineLiveView } from '@/components/timeline/timeline_live_view';
import { TimelineOperatorShell } from '@/components/timeline/timeline_operator_shell';
import { TimelinePartyCard } from '@/components/timeline/timeline_party_card';
import { TimelineTravelView } from '@/components/timeline/timeline_travel_view';
import { parseLayerSettingsState, type LayerSettingsState } from '@/utils/layer_settings';
import {
  describeTimelineDraftSaveFailure,
  TimelineDraftSaver,
  type TimelineDraftSaveEvent,
  type TimelineDraftSaveFailure,
} from '@/utils/timeline_draft_saver';
import {
  beginTimelinePriorityFeedback,
  settleTimelinePriorityFeedback,
  timelinePriorityFeedbackText,
  type TimelinePriorityFeedback,
} from '@/utils/timeline_priority_feedback';
import {
  primaryTimelineAlert,
  timelineEditHeaderHelper,
  TIMELINE_STALE_AFTER_MS,
} from '@/utils/timeline_alert_model';
import { useDayFrame } from '@/hooks/use_day_frame';
import { frameNowStatus } from '@/components/timeline/day_frame_logic';
import type { DayOverviewStripProps } from '@/components/timeline/DayOverviewStrip';
import {
  manualTimelineCues,
  overviewForTimelineView,
  resolveTimelineNowOwner,
  timelineTravelCuesForDay,
  timelineTravelResolveDateForOperatorTime,
  upcomingTimelineCues,
  type TimelineTravelCue,
  type TimelineOperatorView,
} from '@/utils/timeline_operator_model';
import { roundTimelineLocalTime } from '@/utils/timeline_travel_model';
import { normalizeCueColorAutopilot } from '@/components/timeline/cue_color_theme_logic';

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

function minutesToLocalTime(minutes: number | null): string {
  if (minutes === null) return '00:00';
  const normalized = Math.max(0, Math.min(1439, Math.trunc(minutes)));
  return `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`;
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

  // Color theme — capture the COMPLETE Deck wire, including two-tone
  // continuous crossfades (`delay_s:0`), five-tone inline rings, and Follow
  // Note sampling. The shared normalizer strips runtime-only fields and fails
  // loudly on a malformed Deck response instead of saving a lossy cue.
  const ca = caRes.ok ? caRes.data : null;
  if (ca?.active) {
    action.colorAutopilot = normalizeCueColorAutopilot(ca);
  }

  return { label: 'Default (from deck)', action };
}

export default function TimelineScreen() {
  return <TimelineScreenContent />;
}

function TimelineScreenContent() {
  const C = usePalette();
  const globalStyles = useGlobalStyles();
  const styles = useMemo(() => makeStyles(C, globalStyles), [C, globalStyles]);
  const {
    state, connected, receivedAtMs, error, setAutopilot, endProgram, fireCue, activatePlan,
    resume, takeover, performTakeover, travel,
  } = useTimeline();
  const performanceMode = usePerformanceMode();

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
  // Auto-save (operator request 2026-07-02: the maker saves like a doc editor —
  // no SAVE / CANCEL buttons). `lastSavedVersionRef` is the last draftVersion
  // successfully written; the auto-save effect debounces writes and skips a
  // version that's already persisted. `autoSaveEvent` drives a small status
  // chip where the buttons used to be.
  const lastSavedVersionRef = useRef<number | null>(null);
  const [autoSaveEvent, setAutoSaveEvent] = useState<TimelineDraftSaveEvent | null>(null);
  const [saveFailure, setSaveFailure] = useState<TimelineDraftSaveFailure | null>(null);
  const [saveOk, setSaveOk] = useState<string | null>(null);
  const draftSaverRef = useRef<TimelineDraftSaver<ShowPlan> | null>(null);
  const [liveTouchLease, setLiveTouchLease] = useState<LayerSettingsState['liveTouch'] | null>(null);
  const liveTouchLeaseRef = useRef<LayerSettingsState['liveTouch'] | null>(null);
  const priorityAttemptRef = useRef(0);
  const [priorityFeedback, setPriorityFeedback] = useState<TimelinePriorityFeedback | null>(null);

  // Latest draft version that has been requested — used to discard out-of-order
  // preview responses (a slow v1 must not overwrite a newer v2).
  const latestDraftVersionRef = useRef(0);
  const mountedRef = useRef(true);
  useEffect(() => () => {
    mountedRef.current = false;
    draftSaverRef.current?.dispose();
  }, []);
  useEffect(() => { latestDraftVersionRef.current = draftVersion; }, [draftVersion]);
  const bumpDraftVersion = useCallback(() => {
    const next = latestDraftVersionRef.current + 1;
    latestDraftVersionRef.current = next;
    setDraftVersion(next);
    return next;
  }, []);

  // The layer-settings replay is the shared ownership truth. Timeline preview
  // remains available while Live Touch is armed, but background plan writes do
  // not borrow its owner identity. We keep the draft locally and retry only
  // after the lease is visibly released.
  useEffect(() => {
    let active = true;
    let observedWsOwnership = false;
    // A control-bus replay can arrive before this screen's effect subscribes.
    // Seed from REST first so a cold mount never briefly writes through an ARM
    // lease it simply has not observed yet.
    void getApiBaseAsync()
      .then(() => fetchLayerSettingsState())
      .then((result) => {
        if (!active || observedWsOwnership) return;
        if (result.ok && result.data) {
          liveTouchLeaseRef.current = result.data.liveTouch;
          setLiveTouchLease(result.data.liveTouch);
        }
        else setActionError(result.error || 'Could not load layer ownership state');
      })
      .catch((ownershipError: unknown) => {
        if (!active) return;
        setActionError(ownershipError instanceof Error
          ? ownershipError.message
          : 'Could not resolve layer ownership state');
      });
    const unsubscribe = engineEvents.subscribe((message: EngineMessage) => {
      if (!message || message.type !== 'layerSettings') return;
      try {
        observedWsOwnership = true;
        const nextLease = parseLayerSettingsState(message).liveTouch;
        liveTouchLeaseRef.current = nextLease;
        setLiveTouchLease(nextLease);
      } catch (leaseError: any) {
        setActionError(leaseError?.message || 'Layer ownership state is invalid');
      }
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const priorConnectedRef = useRef(connected);
  useEffect(() => {
    if (connected && priorConnectedRef.current === false) {
      void draftSaverRef.current?.retry();
    }
    priorConnectedRef.current = connected;
  }, [connected]);

  const beginPriorityHandoff = useCallback((operation: string): number | null => {
    const lease = liveTouchLeaseRef.current;
    const attemptId = priorityAttemptRef.current + 1;
    const feedback = beginTimelinePriorityFeedback(
      attemptId,
      operation,
      lease?.armed === true,
      lease?.ownerId ?? null,
    );
    if (!feedback) return null;
    priorityAttemptRef.current = attemptId;
    setPriorityFeedback(feedback);
    return attemptId;
  }, []);

  const finishPriorityHandoff = useCallback((
    attemptId: number | null,
    ok: boolean,
    detail: string | null = null,
  ) => {
    if (attemptId === null) return;
    setPriorityFeedback((current) => settleTimelinePriorityFeedback(
      current,
      attemptId,
      ok,
      detail,
    ));
  }, []);

  const runPriorityBooleanAction = useCallback(async (
    operation: string,
    action: () => Promise<boolean>,
  ): Promise<boolean> => {
    const attemptId = beginPriorityHandoff(operation);
    const ok = await action();
    finishPriorityHandoff(
      attemptId,
      ok,
      ok ? null : 'The engine rejected the Timeline operation after requesting the handoff.',
    );
    return ok;
  }, [beginPriorityHandoff, finishPriorityHandoff]);

  // ── UI sheet state ──
  // WORKING DAY (6 PM → 6 PM) vs CALENDAR DAY. A device preference; the engine
  // never learns about frames (_359 §C.1).
  const { frame } = useDayFrame();
  const [operatorView, setOperatorView] = useState<TimelineOperatorView>('live');
  const [planPickerOpen, setPlanPickerOpen] = useState(false);
  // The operator-SELECTED day (highlighted in the strip + drives the cue
  // filter below it). Defaults to today; falls back to day 0. `null` only
  // until the first overview resolves.
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [showAllDays, setShowAllDays] = useState(false);
  // ── ZOOM LADDER (report _94 §1) ──────────────────────────────────────
  //   FESTIVAL (the 8-day strip) ──tap a day──▶ DAY (full screen) ──tap an
  //   event──▶ EVENT (the deck itself, under a mode banner).
  // FESTIVAL and DAY are pure BROWSE levels — client-side only, zero engine
  // effect. Reviewing the timeline never touches the rig. Only the EVENT rung
  // does, and it goes through the arbiter's existing human layer.
  const [zoomLevel, setZoomLevel] = useState<'festival' | 'day'>('festival');
  const [cueSheetOpen, setCueSheetOpen] = useState(false);
  const [editingCue, setEditingCue] = useState<PlanCue | null>(null);
  // The plan's DEFAULT CUE editor (reuses CueEditorSheet in 'defaultCue' mode).
  const [defaultCueSheetOpen, setDefaultCueSheetOpen] = useState(false);

  // ── EVENT rung: the event sheet + its read-only resolver peek ──────────
  const [eventCue, setEventCue] = useState<OverviewCue | null>(null);
  // A bare CALENDAR tap (empty time between cues) — the MOMENT variant of the
  // event sheet (operator ruling 2026-08-03). Exactly one of eventCue /
  // eventMoment is ever set.
  const [eventMoment, setEventMoment] = useState<{ date: string; time: string } | null>(null);
  const [eventOperatorDate, setEventOperatorDate] = useState<string | null>(null);
  // Saved plan used for this preview/travel. Edit/Calendar may rehearse a
  // selected plan without activating it; retaining the source here prevents a
  // later tab/view change from silently resolving the event against another plan.
  const [eventPlanName, setEventPlanName] = useState<string | null>(null);
  const [eventResolve, setEventResolve] = useState<TimelineResolve | null>(null);
  const [eventResolveError, setEventResolveError] = useState<string | null>(null);
  const [eventResolvePending, setEventResolvePending] = useState(false);
  const [eventBusy, setEventBusy] = useState(false);
  const [eventActionError, setEventActionError] = useState<string | null>(null);
  const [manualCue, setManualCue] = useState<OverviewCue | null>(null);
  const [babyRevealOpen, setBabyRevealOpen] = useState(false);
  const [travelDate, setTravelDate] = useState<string | null>(null);
  const [travelTime, setTravelTime] = useState(() => roundTimelineLocalTime(new Date()));
  const [travelCueId, setTravelCueId] = useState<string | null>(null);
  const [travelAdvancedOpen, setTravelAdvancedOpen] = useState(false);
  const [travelResolve, setTravelResolve] = useState<TimelineResolve | null>(null);
  const [travelResolveError, setTravelResolveError] = useState<string | null>(null);
  const [travelResolving, setTravelResolving] = useState(false);
  const [travelBusy, setTravelBusy] = useState(false);
  const [travelLeadSecondsBusy, setTravelLeadSecondsBusy] = useState<number | null>(null);
  const [liveActionPending, setLiveActionPending] = useState(false);
  const [liveActionFeedback, setLiveActionFeedback] = useState<string | null>(null);
  const liveActionFeedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showLiveActionFeedback = useCallback((message: string) => {
    setLiveActionFeedback(message);
    if (liveActionFeedbackTimer.current) clearTimeout(liveActionFeedbackTimer.current);
    liveActionFeedbackTimer.current = setTimeout(() => {
      setLiveActionFeedback(null);
      liveActionFeedbackTimer.current = null;
    }, 7000);
  }, []);
  useEffect(() => () => {
    if (liveActionFeedbackTimer.current) clearTimeout(liveActionFeedbackTimer.current);
  }, []);

  // ── 1s ticker — drives the live NOW playhead (strip + day editor). ──
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (state?.zoom?.scope !== 'travel' || performanceMode.active) return;
    setOperatorView('travel');
    if (state.zoom.targetDate) setTravelDate(state.zoom.targetDate);
    if (state.zoom.targetLocal) setTravelTime(state.zoom.targetLocal);
    setTravelCueId(state.zoom.cueId);
    setTravelAdvancedOpen(state.zoom.cueId === null);
  }, [
    performanceMode.active,
    state?.zoom?.cueId,
    state?.zoom?.scope,
    state?.zoom?.targetDate,
    state?.zoom?.targetLocal,
  ]);
  useEffect(() => {
    if (!performanceMode.active) return;
    if (operatorView === 'edit' || operatorView === 'travel') setOperatorView('live');
    setPlanPickerOpen(false);
    setCueSheetOpen(false);
    setDefaultCueSheetOpen(false);
  }, [operatorView, performanceMode.active]);

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
    // A preview is truth for exactly one draft version. Clear the older derived
    // view before scheduling the next request so a pending/failed preview can
    // never leave stale cues presented as if they described the current draft.
    setDraftOverview(null);
    setPreviewError(null);
    setPreviewTransportError(null);
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
        // Transport failure (offline / timeout / 5xx) — do NOT block save, but
        // also do not leave an older overview on screen under a newer draft.
        setPreviewTransportError(r.error || 'Could not reach the engine to preview the draft');
      }
    }, PREVIEW_DEBOUNCE_MS);
    return () => {
      if (previewTimer.current) clearTimeout(previewTimer.current);
      controller.abort();
    };
  }, [draft, draftVersion]);

  // LIVE is active-plan truth. Calendar, Time Travel, and Edit follow the
  // operator-selected saved plan (the loaded draft), falling back to live only
  // when no selected plan exists.
  const overview = overviewForTimelineView(operatorView, liveOverview, draftOverview);
  const selectedPlanName = draft?.name ?? state?.activePlan ?? null;

  // SAVE is blocked ONLY by a schema-validation (HTTP 400) error that belongs
  // to the CURRENT draft version — never by a transient transport failure, and
  // never by a stale error from an older draft (fix: sticky previewError).
  const saveBlocked = !!previewError && previewError.version === draftVersion;
  const autoSaveLabel = (() => {
    if (saveBlocked) return '⚠ FIX TO SAVE';
    if (saveFailure?.kind === 'live_touch_held') return '⚠ NOT SAVED · LIVE TOUCH';
    if (saveFailure) return '⚠ NOT SAVED';
    if (!autoSaveEvent || autoSaveEvent.version !== draftVersion) return 'UNSAVED';
    if (autoSaveEvent.phase === 'saving') return 'SAVING…';
    if (autoSaveEvent.phase === 'saved') return '✓ SAVED';
    return 'UNSAVED…';
  })();
  const autoSaveTone = autoSaveLabel === '✓ SAVED'
    ? C.tertiary
    : autoSaveLabel === 'SAVING…' || autoSaveLabel === 'UNSAVED…'
      ? C.secondary
      : C.error;

  // Plan timezone (festival-local). Never guess from the pad: a missing plan
  // timezone means no truthful TODAY/playhead answer.
  const planTz = useMemo(() => {
    return (
      overview?.location?.tz
      ?? liveOverview?.location?.tz
      ?? null
    );
  }, [liveOverview?.location?.tz, overview?.location?.tz]);

  // "Now" in the plan tz, recomputed each 1s tick. dateKey picks "today"; the
  // minutes feed the playhead position.
  const nowInTz = nowPartsInTz(planTz);

  // Live minutes-of-day for the playhead (null when no tz could be read).
  const nowMinutes = nowInTz ? nowInTz.minutes : null;
  const nowLocal = minutesToLocalTime(nowMinutes);
  const nowDate = nowInTz?.dateKey ?? null;

  // The frame span NOW sits in — the ONLY thing that may be badged TODAY
  // (C-01). `todayIndex` above is the CALENDAR day and is still what the
  // engine's own day-scoped answers key on; the two are different in the
  // working frame and must not be confused.
  const frameNowIndex = useMemo(() => {
    if (!overview) return null;
    const status = frameNowStatus(frame, overview.days, nowDate, nowMinutes);
    return status.kind === 'inside' ? status.index : null;
  }, [frame, nowDate, nowMinutes, overview]);
  const liveToday = useMemo(() => {
    if (!liveOverview || !nowInTz) return liveOverview?.days[0] ?? null;
    return liveOverview.days.find((day) => day.date === nowInTz.dateKey)
      ?? liveOverview.days[0]
      ?? null;
  }, [liveOverview, nowInTz]);
  const nowOwner = useMemo(
    () => resolveTimelineNowOwner(state, liveOverview, liveToday, nowLocal),
    [liveOverview, liveToday, nowLocal, state],
  );
  // T-07: `nowDate` is the REAL calendar today in the plan tz, or null when we
  // are outside the festival — never `days[0]`, which would badge a row TONIGHT
  // on a day that is not tonight.
  const nextCues = useMemo(
    () => upcomingTimelineCues(liveOverview, frame, nowDate, nowLocal, 4),
    [frame, liveOverview, nowDate, nowLocal],
  );
  const manualCues = useMemo(() => manualTimelineCues(liveOverview), [liveOverview]);
  const syncAgeSec = receivedAtMs === null
    ? null
    : Math.max(0, Math.floor((nowTick - receivedAtMs) / 1000));
  const timelineDataStale = !connected
    || receivedAtMs === null
    || nowTick - receivedAtMs > TIMELINE_STALE_AFTER_MS;
  const actionsDisabled = timelineDataStale || performanceMode.active;
  const primaryAlert = primaryTimelineAlert({
    connected,
    receivedAtMs,
    nowMs: nowTick,
    timelineError: state?.lastError || error,
    actionError,
    planWarnings: state?.planWarnings,
    priorityMessage: priorityFeedback
      ? timelinePriorityFeedbackText(priorityFeedback)
      : null,
    priorityFailed: priorityFeedback?.phase === 'failed',
    performanceViewOnly: performanceMode.active,
    liveTouchActive: liveTouchLease?.armed === true,
    liveTouchOwner: liveTouchLease?.ownerId ?? null,
    zoomActive: !!state?.zoom,
    zoomScope: state?.zoom?.scope ?? null,
    saveError: saveFailure?.detail ?? previewTransportError,
    activePlanHotReload: operatorView === 'edit'
      && !!draft?.name
      && draft.name === state?.activePlan,
  });

  // Default the SELECTED day to today (or day 0) once the overview resolves.
  // Re-applies if the selection points outside the current day range (e.g. a
  // different plan loaded). Operator taps override this thereafter.
  useEffect(() => {
    if (!overview || overview.days.length === 0) return;
    const validIndexes = new Set(overview.days.map((d) => d.index));
    setSelectedDay((prev) => {
      if (prev !== null && validIndexes.has(prev)) return prev;
      // The span NOW is in, in the ACTIVE frame — not the calendar day.
      if (frameNowIndex !== null) return frameNowIndex;
      return overview.days[0].index;
    });
  }, [frameNowIndex, overview]);

  // ── Draft mutators ──
  const mutateDraft = useCallback((fn: (p: ShowPlan) => void) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const next = clonePlan(prev);
      fn(next);
      return next;
    });
    bumpDraftVersion();
    setSaveOk(null);
  }, [bumpDraftVersion]);

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
    const loadedVersion = bumpDraftVersion();
    lastSavedVersionRef.current = loadedVersion;
    draftSaverRef.current?.markSaved(loadedVersion);
    setSaveOk(null);
    setActionError(null);
    setPreviewTransportError(null);
    setPlanPickerOpen(false);
    return true;
  }, [bumpDraftVersion]);

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
    const loadedVersion = bumpDraftVersion();
    lastSavedVersionRef.current = loadedVersion;
    draftSaverRef.current?.markSaved(loadedVersion);
    setSaveOk(null);
    setPreviewTransportError(null);
  }, [bumpDraftVersion]);

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
  const persistPlan = useCallback(async (plan: ShowPlan) => {
    const priorityAttempt = beginPriorityHandoff('SAVE PLAN');
    const r = await saveTimelinePlan(plan);
    finishPriorityHandoff(priorityAttempt, r.ok, r.error ?? null);
    if (r.ok) {
      setActionError(null);
      refreshPlans();
      refreshLiveOverview();
    }
    return r;
  }, [beginPriorityHandoff, finishPriorityHandoff, refreshPlans, refreshLiveOverview]);

  if (draftSaverRef.current === null) {
    draftSaverRef.current = new TimelineDraftSaver<ShowPlan>(persistPlan, (event) => {
      if (!mountedRef.current) return;
      setAutoSaveEvent(event);
      if (event.phase === 'saved') {
        lastSavedVersionRef.current = event.version;
        setSaveFailure(null);
      } else if (event.phase === 'saving') {
        setSaveFailure(null);
      } else if (event.phase === 'error') {
        setSaveFailure(describeTimelineDraftSaveFailure(event.result));
      }
    });
  }

  // New plans REQUIRE an operator-entered name (the PlanPickerSheet's name
  // prompt validates + de-duplicates before calling these with the slug).
  // Load a freshly-created/duplicated plan into the maker AND persist it
  // immediately (operator request 2026-07-02: "when adding a new plan, save it
  // automatically too") so it exists on disk right away — ready to ACTIVATE
  // without a manual save. The auto-save effect then keeps subsequent edits
  // written; lastSavedVersionRef starts null so it also re-writes as they edit.
  const startDraft = useCallback((plan: ShowPlan) => {
    setDraft(plan);
    const version = bumpDraftVersion();
    lastSavedVersionRef.current = null;
    setSaveOk(null);
    setActionError(null);
    setPreviewTransportError(null);
    setSaveFailure(null);
    setPlanPickerOpen(false);
    draftSaverRef.current?.enqueue(version, plan);
    void draftSaverRef.current?.flush();
  }, [bumpDraftVersion]);

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
    const ok = await runPriorityBooleanAction('ACTIVATE PLAN', () => activatePlan(name));
    if (ok) {
      refreshPlans(); refreshLiveOverview(); setPlanPickerOpen(false);
      // Always-editing: switch the maker to the plan we just activated so the
      // tab keeps showing the running plan (replaces whatever was loaded).
      setDraft(null);
      await autoLoadActiveIntoDraft(name);
    } else setActionError('Engine rejected plan activation');
  }, [activatePlan, refreshPlans, refreshLiveOverview, autoLoadActiveIntoDraft,
    runPriorityBooleanAction]);

  const handleFireCue = useCallback((id: string) => runPriorityBooleanAction(
    'FIRE CUE',
    () => fireCue(id),
  ), [fireCue, runPriorityBooleanAction]);

  const handleEndProgram = useCallback(() => runPriorityBooleanAction(
    'END PROGRAM',
    endProgram,
  ), [endProgram, runPriorityBooleanAction]);

  // Delete a saved plan (the picker confirms + hides the ACTIVE plan; the
  // engine also refuses to delete the active one). If the deleted plan is the
  // one loaded in the maker, close the editor so we don't keep re-saving a
  // now-deleted file.
  const handleDeletePlan = useCallback(async (name: string) => {
    const priorityAttempt = beginPriorityHandoff('DELETE PLAN');
    const r = await deleteTimelinePlan(name);
    finishPriorityHandoff(priorityAttempt, r.ok, r.error ?? null);
    if (!r.ok) { setActionError(r.error || `Could not delete plan ${name}`); return; }
    setActionError(null);
    if (draft?.name === name) {
      setDraft(null);
      setDraftOverview(null);
      draftSaverRef.current?.discardPending(draftVersion);
      lastSavedVersionRef.current = null;
      setAutoSaveEvent(null);
      setSaveFailure(null);
    }
    refreshPlans();
  }, [beginPriorityHandoff, draft?.name, draftVersion, finishPriorityHandoff, refreshPlans]);

  // Persist a plan and refresh the derived views. Shared by auto-save, eager
  // new-plan saves, and the close flush. Saving over the ACTIVE plan
  // ── AUTO-SAVE ── debounce a write ~700ms after the last edit. A
  // schema-invalid draft (saveBlocked) is held back until it's valid again (the
  // error banner explains why); a version already on disk is skipped so we
  // don't re-write on load or after our own save.
  useEffect(() => {
    if (!draft) {
      draftSaverRef.current?.discardPending(draftVersion);
      lastSavedVersionRef.current = null;
      setAutoSaveEvent(null);
      setSaveFailure(null);
      return;
    }
    if (saveBlocked) {
      draftSaverRef.current?.discardPending(draftVersion);
      setAutoSaveEvent({ phase: 'error', version: draftVersion, result: {
        ok: false,
        status: 400,
        error: previewError?.msg || 'Draft invalid',
      } });
      setSaveFailure({
        kind: 'invalid',
        title: 'NOT SAVED — DRAFT INVALID',
        detail: previewError?.msg || 'Fix the draft before saving.',
      });
      return;
    }
    if (lastSavedVersionRef.current === draftVersion) {
      draftSaverRef.current?.markSaved(draftVersion);
      return;
    }
    draftSaverRef.current?.enqueue(draftVersion, draft);
    const versionToSave = draftVersion;
    const t = setTimeout(async () => {
      if (versionToSave !== latestDraftVersionRef.current) return;
      await draftSaverRef.current?.flush();
    }, 700);
    return () => clearTimeout(t);
  }, [draft, draftVersion, saveBlocked, previewError?.msg]);

  /**
   * Named-plan rehearsal is allowed only against an engine-acknowledged saved
   * plan. Flush the selected draft before preview/travel; fail loudly if the
   * latest version is invalid, still saving, or rejected.
   */
  const prepareSelectedPlanForRehearsal = useCallback(async (): Promise<
    { ok: true; planName: string | null } | { ok: false; error: string }
  > => {
    if (!draft) return { ok: true, planName: state?.activePlan ?? null };
    if (saveBlocked) {
      return {
        ok: false,
        error: previewError?.msg || 'Fix the invalid draft before Time Travel.',
      };
    }
    const version = draftVersion;
    if (lastSavedVersionRef.current !== version) {
      draftSaverRef.current?.enqueue(version, draft);
      await draftSaverRef.current?.flush();
    }
    if (lastSavedVersionRef.current !== version) {
      return {
        ok: false,
        error: 'The selected plan is not saved yet. Wait for ✓ SAVED, then try Time Travel again.',
      };
    }
    return { ok: true, planName: draft.name };
  }, [draft, draftVersion, previewError?.msg, saveBlocked, state?.activePlan]);

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
    bumpDraftVersion();
    setSaveOk(null);
    setActionError(null);
    setPreviewTransportError(null);
  }, [draft, mutateDraft, state?.activePlan, bumpDraftVersion]);

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
  const handleSaveCue = useCallback(async (
    cue: PlanCue,
    partyWindow?: PartyWindowSpec,
  ): Promise<CueSaveResult> => {
    if (!draft) {
      return { ok: false, error: 'Cue was not added: there is no draft plan to validate.' };
    }
    const finalCue = cue.id
      ? cue
      : { ...cue, id: makeCueId(new Set(draft.cues.map((current) => current.id))) };
    const candidate = partyWindow
      ? planWithPartyWindow(draft, finalCue, partyWindow)
      : planWithUpsertedCue(draft, finalCue);
    const validation = await previewTimelineOverview(candidate);
    if (!validation.ok) {
      return {
        ok: false,
        error: `Cue was not added — ${validation.error || 'engine validation failed.'}`,
      };
    }

    mutateDraft((p) => {
      p.cues = candidate.cues;
      p.phases = candidate.phases;
    });
    setCueSheetOpen(false);
    setEditingCue(null);
    return { ok: true };
  }, [draft, mutateDraft]);

  const handleDeleteCue = useCallback((cueId: string) => {
    mutateDraft((p) => {
      const next = planWithoutPartyWindow(p, cueId);
      p.cues = next.cues;
      p.phases = next.phases;
    });
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
    if (cue.action.type === 'sequence') {
      opWarn(
        'Sequenced event is locked',
        'This cue contains second-accurate event steps that the visual cue editor cannot safely rewrite. Edit its plan YAML and revalidate instead.',
      );
      return;
    }
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

  const handleSaveDefaultCue = useCallback(async (dc: PlanDefaultCue): Promise<CueSaveResult> => {
    if (!draft) {
      return { ok: false, error: 'Default cue was not saved: there is no draft plan to validate.' };
    }
    const validation = await previewTimelineOverview({ ...draft, defaultCue: dc });
    if (!validation.ok) {
      return {
        ok: false,
        error: `Default cue was not saved — ${validation.error || 'engine validation failed.'}`,
      };
    }
    mutateDraft((p) => { p.defaultCue = dc; });
    setDefaultCueSheetOpen(false);
    return { ok: true };
  }, [draft, mutateDraft]);

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

  // The SELECTED day's overview object — the DAY level renders this, and it
  // also drives the filtered cue list at the FESTIVAL level.
  const selectedDayOverview = useMemo(() => {
    if (selectedDay === null || !overview) return null;
    return overview.days.find((d) => d.index === selectedDay) ?? null;
  }, [selectedDay, overview]);
  const selectedNextDayOverview = useMemo(() => {
    if (!selectedDayOverview || !overview) return null;
    return overview.days.find((d) => d.index === selectedDayOverview.index + 1) ?? null;
  }, [overview, selectedDayOverview]);

  // Cues shown in the timeline view: the selected day's resolved cues, or all
  // days' cues flattened (with their day index) when the toggle is ALL DAYS.
  // These come from the overview (resolved atLocal), time-ordered.
  const viewCues = useMemo(() => {
    if (!overview) return [] as { cue: OverviewCue; dayIndex: number }[];
    const rows: { cue: OverviewCue; dayIndex: number }[] = [];
    const mins = (s: string | null) => {
      if (!s) return 100000;
      const m = /^(\d{1,2}):(\d{2})$/.exec(s);
      return m ? Number(m[1]) * 60 + Number(m[2]) : 100000;
    };
    if (showAllDays) {
      for (const d of overview.days) {
        for (const c of d.cues) {
          if (!isPartyWindowImplementationCue(c, d.cues)) {
            rows.push({ cue: c, dayIndex: d.index });
          }
        }
      }
    } else if (selectedDayOverview) {
      // The operator day is 6 PM → 6 PM. Evening cues on this day plus the
      // morning half from the following calendar day belong on this card.
      for (const c of selectedDayOverview.cues) {
        if (isPartyWindowImplementationCue(c, selectedDayOverview.cues)) continue;
        // Cues without a resolvable time (manual/mood) always show on the
        // authoring day; timed cues need atLocal >= 6 PM to belong to the
        // evening half of this operator day.
        if (!c.atLocal || mins(c.atLocal) >= 18 * 60) {
          rows.push({ cue: c, dayIndex: selectedDayOverview.index });
        }
      }
      if (selectedNextDayOverview) {
        for (const c of selectedNextDayOverview.cues) {
          if (isPartyWindowImplementationCue(c, selectedNextDayOverview.cues)) continue;
          // Only pick up the morning half of the next calendar day (< 6 PM);
          // its evening cues stay on that day's own card.
          if (c.atLocal && mins(c.atLocal) < 18 * 60) {
            rows.push({ cue: c, dayIndex: selectedDayOverview.index });
          }
        }
      }
    }
    rows.sort((a, b) => {
      if (a.dayIndex !== b.dayIndex) return a.dayIndex - b.dayIndex;
      const am = mins(a.cue.atLocal);
      const bm = mins(b.cue.atLocal);
      // Sort operator-day evening (≥18:00) before morning (<18:00) so the
      // calendar row order matches how the strip renders top→bottom.
      const aRank = am >= 18 * 60 ? am : am + 24 * 60;
      const bRank = bm >= 18 * 60 ? bm : bm + 24 * 60;
      return aRank - bRank;
    });
    return rows;
  }, [overview, showAllDays, selectedDayOverview, selectedNextDayOverview]);

  const travelCueEntries = useMemo(
    () => timelineTravelCuesForDay(overview, frame, travelDate),
    [frame, overview, travelDate],
  );
  const selectedTravelEntry = useMemo(
    () => travelCueEntries.find((entry) => entry.cue.id === travelCueId) ?? null,
    [travelCueEntries, travelCueId],
  );

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

  // ── ZOOM LADDER: navigation + the EVENT rung ──────────────────────────

  // FESTIVAL → DAY. Pure client navigation; nothing is sent to the engine.
  const openDay = useCallback((idx: number) => {
    setSelectedDay(idx);
    setShowAllDays(false);
    setZoomLevel('day');
  }, []);

  const backToWeek = useCallback(() => setZoomLevel('festival'), []);

  // ONE prop builder for BOTH week-strip mounts (CALENDAR + EDIT PLAN) so the
  // two can never drift apart by hand-copying (C-12).
  const stripPropsFor = useCallback(
    (days: OverviewDay[]): DayOverviewStripProps => ({
      days,
      frame,
      selectedIndex: selectedDay,
      nowDate,
      nowMinutes,
      onOpenDay: openDay,
    }),
    [frame, nowDate, nowMinutes, openDay, selectedDay],
  );

  const stepDay = useCallback((delta: number) => {
    if (!overview) return;
    const idxs = overview.days.map((d) => d.index);
    const cur = selectedDay ?? idxs[0];
    const pos = idxs.indexOf(cur);
    const next = idxs[pos + delta];
    if (next !== undefined) setSelectedDay(next);
  }, [overview, selectedDay]);

  const preparePlanForCurrentView = useCallback(() => {
    if (operatorView === 'live') {
      return Promise.resolve({
        ok: true as const,
        planName: state?.activePlan ?? null,
      });
    }
    return prepareSelectedPlanForRehearsal();
  }, [operatorView, prepareSelectedPlanForRehearsal, state?.activePlan]);

  // DAY → EVENT. Opens the sheet and fires the READ-ONLY resolver peek
  // (GET /timeline/resolve — zero side effects: nothing dispatched, no lease
  // armed, no latch written). A 400 (out-of-window target, unresolvable cue) is
  // surfaced verbatim in the sheet; we never fake a preview.
  const openEvent = useCallback((cue: OverviewCue, dateOverride?: string) => {
    setEventCue(cue);
    setEventMoment(null);
    setEventResolve(null);
    setEventResolveError(null);
    setEventActionError(null);
    setEventResolvePending(true);
    const date = dateOverride ?? selectedDayOverview?.date;
    setEventOperatorDate(
      operatorView === 'live'
        ? (date ?? null)
        : (selectedDayOverview?.date ?? date ?? null),
    );
    void preparePlanForCurrentView().then(async (prepared) => {
      if (!prepared.ok) {
        setEventResolvePending(false);
        setEventResolveError(prepared.error);
        return;
      }
      setEventPlanName(prepared.planName);
      const r = await fetchTimelineResolve({
        cueId: cue.id,
        ...(date ? { date } : {}),
        ...(prepared.planName ? { planName: prepared.planName } : {}),
      });
      setEventResolvePending(false);
      if (r.ok && r.data) { setEventResolve(r.data); setEventResolveError(null); }
      else setEventResolveError(r.error || 'Could not resolve this moment');
    });
  }, [operatorView, preparePlanForCurrentView, selectedDayOverview?.date]);

  // CALENDAR → MOMENT. A tap on EMPTY calendar time opens the same sheet in
  // MOMENT mode, peeking the resolver at that bare instant ({date, time} —
  // the same arbitrary-timestamp surface the travel steppers ride on). Still
  // read-only: the rig moves only on the sheet's TIME TRAVEL button.
  const openMoment = useCallback((time: string, dateOverride?: string) => {
    const date = dateOverride ?? selectedDayOverview?.date;
    if (!date) return; // no resolvable day under the tap — open nothing
    setEventCue(null);
    setEventMoment({ date, time });
    setEventResolve(null);
    setEventResolveError(null);
    setEventActionError(null);
    setEventResolvePending(true);
    setEventOperatorDate(
      operatorView === 'live'
        ? date
        : (selectedDayOverview?.date ?? date),
    );
    void preparePlanForCurrentView().then(async (prepared) => {
      if (!prepared.ok) {
        setEventResolvePending(false);
        setEventResolveError(prepared.error);
        return;
      }
      setEventPlanName(prepared.planName);
      const r = await fetchTimelineResolve({
        date,
        time,
        ...(prepared.planName ? { planName: prepared.planName } : {}),
      });
      setEventResolvePending(false);
      if (r.ok && r.data) { setEventResolve(r.data); setEventResolveError(null); }
      else setEventResolveError(r.error || 'Could not resolve this moment');
    });
  }, [operatorView, preparePlanForCurrentView, selectedDayOverview?.date]);

  const closeEvent = useCallback(() => {
    setEventCue(null);
    setEventMoment(null);
    setEventResolve(null);
    setEventResolveError(null);
    setEventActionError(null);
    setEventPlanName(null);
    setEventOperatorDate(null);
  }, []);

  // PERFORM — a SCOPED takeover of the LIVE event. The plan holds; a program
  // that comes due is deferred (never dismissed) until the zoom exits. On
  // success we land on the DECK tab under the green banner — the event level
  // does not build a second deck UI, it reuses the real one.
  //
  // PERFORMANCE MODE (operator ruling 2026-08-14): a scoped PERFORM is still a
  // takeover from a running plan, so the operator passcode prompt opens first.
  // 'cancelled' = they dismissed it — keep the EVENT sheet open, show no error,
  // and do not navigate (nothing was taken over).
  const handlePerform = useCallback(async () => {
    if (!eventCue) return;
    setEventBusy(true);
    const result = await performTakeover(eventCue.id);
    setEventBusy(false);
    if (result.outcome === 'cancelled') return;
    if (result.outcome === 'failed') {
      setEventActionError(result.error || 'Failed to take the deck');
      return;
    }
    closeEvent();
    router.push('/');
  }, [eventCue, performTakeover, closeEvent]);

  // TIME TRAVEL — the deck carries the plan's resolved state at the target
  // instant, as a STATIC snapshot (D4): a CUE's fire instant, or a bare
  // MOMENT tapped on the calendar ({date, time}). Works while the plan is
  // DORMANT: that is exactly when the operator rehearses.
  const handleTravel = useCallback(async (leadSeconds?: number) => {
    let spec: TimelineTravelSpec;
    if (eventCue) {
      const date = eventResolve?.date ?? selectedDayOverview?.date;
      spec = {
        cueId: eventCue.id,
        ...(date ? { date } : {}),
        ...(leadSeconds ? { leadSeconds } : {}),
        ...(eventPlanName ? { planName: eventPlanName } : {}),
      };
    } else if (eventMoment) {
      spec = {
        date: eventMoment.date,
        time: eventMoment.time,
        ...(eventPlanName ? { planName: eventPlanName } : {}),
      };
    } else {
      return;
    }
    // The large purple action inside EventSheet is the confirmation. Opening a
    // second native confirmation Modal while EventSheet's Modal is still
    // presented can place the confirmation behind the sheet on iPad, making a
    // valid tap look like a no-op. Apply immediately and keep the sheet visible
    // in its busy state until success (navigate to Deck) or a loud error.
    setEventBusy(true);
    const priorityAttempt = beginPriorityHandoff('TIME TRAVEL');
    const outcome = await travel(spec);
    finishPriorityHandoff(
      priorityAttempt,
      outcome.ok,
      outcome.ok ? null : outcome.error,
    );
    setEventBusy(false);
    if (!outcome.ok) { setEventActionError(outcome.error); return; }
    if (eventOperatorDate) {
      setTravelDate(eventOperatorDate);
      if ('time' in spec) setTravelTime(spec.time);
      else if (eventResolve) setTravelTime(eventResolve.atLocal);
    } else if ('date' in spec && spec.date) {
      setTravelDate(spec.date);
      if ('time' in spec) setTravelTime(spec.time);
    } else if (eventResolve) {
      setTravelDate(eventResolve.date);
      setTravelTime(eventResolve.atLocal);
    }
    setTravelCueId(eventCue?.id ?? null);
    setTravelAdvancedOpen(eventCue === null);
    closeEvent();
    // Time Travel puts the rig into the resolved snapshot: the operator now
    // needs to see the Deck (and Mixer) that the plan applied. Navigate to
    // the Deck tab and surface a temporary confirmation toast that names the
    // applied plan, target, cue, playlist, and palette so the operator sees
    // the truth without hunting for it.
    const resolved = outcome.result.resolved;
    const planLabel = outcome.result.rehearsingPlan ?? state?.activePlan ?? 'plan';
    const targetLabel = `${resolved.date} ${resolved.atLocal}`;
    const ownerLabel = resolved.owner?.label ?? 'resolved baseline';
    const applied = [resolved.playlist, resolved.palette].filter(Boolean).join(' · ');
    const leadLabel = leadSeconds && eventCue
      ? ` · ${leadSeconds} sec before ${eventCue.label}`
      : '';
    opInfo(
      'TIME TRAVEL APPLIED',
      `${planLabel} → ${targetLabel}${leadLabel} · ${ownerLabel}${applied ? ` · ${applied}` : ''}`,
    );
    router.push('/');
  }, [beginPriorityHandoff, eventCue, eventMoment, finishPriorityHandoff, travel,
    closeEvent, eventOperatorDate, eventPlanName, eventResolve, selectedDayOverview?.date,
    state?.activePlan]);

  // Returning to this tab never mutates a zoom. TIME TRAVEL and PERFORM remain
  // active until the explicit RESUME LIVE action, including across tab changes
  // and on pads that did not initiate the takeover.

  useEffect(() => {
    if (travelDate || !liveOverview?.days.length) return;
    setTravelDate(liveToday?.date ?? liveOverview.days[0].date);
  }, [liveOverview, liveToday?.date, travelDate]);

  useEffect(() => {
    if (operatorView !== 'travel' || !travelDate || !connected) return;
    if (!travelCueId && !travelAdvancedOpen) {
      setTravelResolve(null);
      setTravelResolveError(null);
      setTravelResolving(false);
      return;
    }
    let active = true;
    setTravelResolving(true);
    setTravelResolve(null);
    setTravelResolveError(null);
    void prepareSelectedPlanForRehearsal().then(async (prepared) => {
      if (!active) return;
      if (!prepared.ok) {
        setTravelResolving(false);
        setTravelResolveError(prepared.error);
        return;
      }
      if (travelCueId && !selectedTravelEntry) {
        setTravelResolving(false);
        setTravelResolveError('The selected cue is not part of this operator day.');
        return;
      }
      const exactResolveDate = selectedTravelEntry?.resolveDate
        ?? timelineTravelResolveDateForOperatorTime(overview, frame, travelDate, travelTime);
      if (!exactResolveDate) {
        setTravelResolving(false);
        setTravelResolveError('This target falls beyond the selected plan’s last operator day.');
        return;
      }
      const spec = selectedTravelEntry
        ? {
          cueId: selectedTravelEntry.cue.id,
          date: selectedTravelEntry.resolveDate,
          ...(prepared.planName ? { planName: prepared.planName } : {}),
        }
        : {
          date: exactResolveDate,
          time: travelTime,
          ...(prepared.planName ? { planName: prepared.planName } : {}),
        };
      const result = await fetchTimelineResolve(spec);
      if (!active) return;
      setTravelResolving(false);
      if (result.ok && result.data) {
        setTravelResolve(result.data);
        setTravelResolveError(null);
      } else {
        setTravelResolveError(result.error || 'Could not resolve this Time Travel target');
      }
    });
    return () => { active = false; };
  }, [
    connected,
    frame,
    operatorView,
    overview,
    prepareSelectedPlanForRehearsal,
    selectedTravelEntry,
    travelAdvancedOpen,
    travelCueId,
    travelDate,
    travelTime,
  ]);

  const handleTravelDate = useCallback((date: string) => {
    setTravelDate(date);
    setTravelCueId(null);
    setTravelAdvancedOpen(false);
  }, []);

  const handleTravelCue = useCallback((entry: TimelineTravelCue) => {
    setTravelCueId(entry.cue.id);
    setTravelAdvancedOpen(false);
    if (entry.cue.atLocal) setTravelTime(entry.cue.atLocal);
  }, []);

  const handleToggleTravelAdvanced = useCallback(() => {
    if (!travelAdvancedOpen) setTravelCueId(null);
    setTravelAdvancedOpen(!travelAdvancedOpen);
  }, [travelAdvancedOpen]);

  const handleOperatorView = useCallback((next: TimelineOperatorView) => {
    if (performanceMode.active && (next === 'edit' || next === 'travel')) return;
    setOperatorView(next);
    if (next === 'calendar' || next === 'edit') setZoomLevel('festival');
  }, [performanceMode.active]);

  const handleTakeover = useCallback(async () => {
    if (actionsDisabled) return;
    const confirmed = await opConfirm({
      title: 'TAKE OVER TIMELINE?',
      message: 'Manual control will own the deck until RESUME LIVE or the operator lease expires.',
      confirmLabel: 'TAKE OVER',
    });
    if (!confirmed) return;
    setLiveActionPending(true);
    showLiveActionFeedback('Requesting MANUAL control…');
    const priorityAttempt = beginPriorityHandoff('TAKE OVER');
    const result = await takeover();
    finishPriorityHandoff(priorityAttempt, result === 'ok', result === 'failed'
      ? 'The engine rejected the Timeline takeover.'
      : null);
    setLiveActionPending(false);
    showLiveActionFeedback(result === 'ok'
      ? 'OPERATOR TAKEOVER now controls Deck output. The live plan is waiting.'
      : 'The engine did not grant operator control.');
  }, [
    actionsDisabled,
    beginPriorityHandoff,
    finishPriorityHandoff,
    showLiveActionFeedback,
    takeover,
  ]);

  const handleResumeLive = useCallback(async () => {
    if (actionsDisabled) return;
    if (!state?.zoom && !state?.activePlan) {
      showLiveActionFeedback(
        'No live plan is active. Open EDIT PLAN → PLANS and activate one first.',
      );
      return;
    }
    setLiveActionPending(true);
    showLiveActionFeedback('Enabling Timeline and returning control to the live plan…');
    const priorityAttempt = beginPriorityHandoff('RESUME TIMELINE');
    // RESUME TIMELINE is one operator action, not two hidden switches. The
    // engine deliberately keeps "enable the schedule" separate from "release
    // an operator lease"; calling only resume() while Timeline AUTO was off
    // cleared the lease but left controller=manual forever. Always arm the
    // active plan first (idempotent when already on), then hand control back.
    const enabled = await setAutopilot(true);
    const ok = enabled && await resume();
    finishPriorityHandoff(priorityAttempt, ok, ok ? null : 'The engine rejected RESUME TIMELINE.');
    setLiveActionPending(false);
    if (ok) {
      // Read AFTER resume. The render-scope `state` is the pre-action snapshot
      // and previously produced a false DORMANT message after a successful
      // handoff even when the plan covered today.
      const refreshed = await fetchTimelineState();
      const resumedState = refreshed.ok && refreshed.data ? refreshed.data : null;
      if (!resumedState) {
        showLiveActionFeedback(
          'RESUME TIMELINE was accepted. Waiting for authoritative Timeline state.',
        );
      } else if (resumedState.inFestivalWindow === false) {
        showLiveActionFeedback(
          `Operator lease cleared, but “${resumedState.activePlan}” is outside its festival window.`,
        );
      } else if (resumedState.controller === 'manual') {
        showLiveActionFeedback(
          `“${resumedState.activePlan}” is enabled, but the engine still reports operator control. Check the Timeline alert above.`,
        );
      } else {
        showLiveActionFeedback(
          `Control returned to “${resumedState.activePlan}”. Timeline is resolving what should run now.`,
        );
      }
      setOperatorView('live');
    } else {
      showLiveActionFeedback('RESUME TIMELINE was rejected. Check the Timeline alert above.');
    }
  }, [
    actionsDisabled,
    beginPriorityHandoff,
    finishPriorityHandoff,
    resume,
    setAutopilot,
    showLiveActionFeedback,
    state?.activePlan,
    state?.zoom,
  ]);

  const handlePausePlan = useCallback(async () => {
    if (actionsDisabled || !state?.activePlan) return;
    const confirmed = await opConfirm({
      title: 'PAUSE ACTIVE PLAN?',
      message: `Pause “${state.activePlan}” now? Its active cue/program ends and the operator keeps Deck output until RESUME TIMELINE NOW is pressed. The schedule will resume at the current time, not where it paused.`,
      confirmLabel: 'PAUSE PLAN',
      destructive: true,
    });
    if (!confirmed) return;

    setLiveActionPending(true);
    showLiveActionFeedback(`Pausing “${state.activePlan}”…`);
    const priorityAttempt = beginPriorityHandoff('PAUSE TIMELINE');
    const ok = await setAutopilot(false);
    finishPriorityHandoff(priorityAttempt, ok, ok ? null : 'The engine rejected PAUSE PLAN.');
    setLiveActionPending(false);
    showLiveActionFeedback(ok
      ? `“${state.activePlan}” is paused. Operator control owns Deck output until RESUME TIMELINE NOW.`
      : 'PAUSE PLAN was rejected. Check the Timeline alert above.');
  }, [
    actionsDisabled,
    beginPriorityHandoff,
    finishPriorityHandoff,
    setAutopilot,
    showLiveActionFeedback,
    state?.activePlan,
  ]);

  const handleEndProgramConfirmed = useCallback(async () => {
    if (actionsDisabled) return;
    const confirmed = await opConfirm({
      title: 'END ACTIVE PROGRAM?',
      message: 'The running program ends immediately and Timeline resolves the live owner again.',
      confirmLabel: 'END PROGRAM',
      destructive: true,
    });
    if (confirmed) await handleEndProgram();
  }, [actionsDisabled, handleEndProgram]);

  const confirmAndFireManualCue = useCallback(async (cue: OverviewCue) => {
    if (actionsDisabled) return;
    // Close the native review/choice Modal BEFORE opening opConfirm. iOS does
    // not reliably stack the app-wide confirmation host over an already-open
    // native Modal; the old ordering made FIRE appear to do nothing.
    setManualCue(null);
    setBabyRevealOpen(false);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const protectedReveal = babyRevealConfirmation(cue.id);
    const specialEventId = cue.action.type === 'special_event' ? cue.action.showId : null;
    const babyReveal = specialEventId === 'baby_reveal';
    const confirmed = await opConfirm(babyReveal ? {
      title: 'START BABY REVEAL?',
      message: 'This starts START TEASE on the live rig and opens the protected Baby Reveal controls.',
      confirmLabel: 'START BABY REVEAL',
      destructive: true,
    } : protectedReveal ? {
      title: protectedReveal.title,
      message: protectedReveal.body,
      confirmLabel: protectedReveal.confirmLabel,
      destructive: true,
    } : {
      title: `FIRE ${cue.label.toUpperCase()}?`,
      message: 'This ON DEMAND cue applies to the live rig immediately. It never auto-fires.',
      confirmLabel: 'FIRE CUE',
      destructive: true,
    });
    if (!confirmed) return;
    setEventBusy(true);
    const ok = await handleFireCue(cue.id);
    setEventBusy(false);
    if (ok) {
      if (specialEventId) {
        opInfo(
          `${cue.label.toUpperCase()} STARTED`,
          'Opening Events for the remaining protected stages and choices.',
        );
        router.push('/special_events');
      }
    } else {
      setEventActionError('The engine rejected the ON DEMAND cue.');
      opWarn('ON DEMAND CUE FAILED', 'The engine rejected the cue. No Special Event was started.');
    }
  }, [actionsDisabled, handleFireCue]);

  const handleLocalTravel = useCallback(async (leadSeconds?: number) => {
    if (!travelDate || !travelResolve || actionsDisabled) return;
    if (!travelCueId && !travelAdvancedOpen) return;
    const prepared = await prepareSelectedPlanForRehearsal();
    if (!prepared.ok) {
      setTravelResolveError(prepared.error);
      return;
    }
    if (travelCueId && !selectedTravelEntry) {
      setTravelResolveError('The selected cue no longer exists in this operator day.');
      return;
    }
    const exactResolveDate = selectedTravelEntry?.resolveDate
      ?? timelineTravelResolveDateForOperatorTime(overview, frame, travelDate, travelTime);
    if (!exactResolveDate) {
      setTravelResolveError('This target falls beyond the selected plan’s last operator day.');
      return;
    }
    const spec: TimelineTravelSpec = selectedTravelEntry
      ? {
        cueId: selectedTravelEntry.cue.id,
        date: selectedTravelEntry.resolveDate,
        ...(leadSeconds ? { leadSeconds } : {}),
        ...(prepared.planName ? { planName: prepared.planName } : {}),
      }
      : {
        date: exactResolveDate,
        time: travelTime,
        ...(prepared.planName ? { planName: prepared.planName } : {}),
      };
    const targetLabel = selectedTravelEntry
      ? `${leadSeconds ? `${leadSeconds} seconds before ` : ''}“${selectedTravelEntry.cue.label}” on ${travelDate}`
      : `${travelDate} at ${travelTime}`;
    const confirmed = await opConfirm({
      title: 'ENTER TIME TRAVEL?',
      message: leadSeconds
        ? `Run ${targetLabel} as NOW on the live rig. Inspect the Deck, then tap ▶ to apply the cue itself. Timeline autopilot stays paused until RESUME LIVE.`
        : `Run ${targetLabel} as NOW on the live rig. Timeline autopilot stays paused until RESUME LIVE.`,
      confirmLabel: state?.zoom?.scope === 'travel' ? 'MOVE TIME TRAVEL' : 'RUN AS NOW',
    });
    if (!confirmed) return;
    setTravelLeadSecondsBusy(leadSeconds ?? null);
    setTravelBusy(true);
    const priorityAttempt = beginPriorityHandoff('TIME TRAVEL');
    const outcome = await travel(spec);
    finishPriorityHandoff(
      priorityAttempt,
      outcome.ok,
      outcome.ok ? null : outcome.error,
    );
    setTravelBusy(false);
    setTravelLeadSecondsBusy(null);
    if (!outcome.ok) { setTravelResolveError(outcome.error); return; }
    // Confirm the applied travel by naming exactly what the engine resolved,
    // then hop to Deck so the operator sees the resulting look. The banner
    // (ZoomBanner) remains the persistent proof of the active rehearsal.
    const resolved = outcome.result.resolved;
    const planLabel = outcome.result.rehearsingPlan ?? state?.activePlan ?? 'plan';
    const appliedTarget = `${resolved.date} ${resolved.atLocal}`;
    const ownerLabel = resolved.owner?.label ?? 'resolved baseline';
    const applied = [resolved.playlist, resolved.palette].filter(Boolean).join(' · ');
    const leadLabel = leadSeconds && selectedTravelEntry
      ? ` · ${leadSeconds} sec before ${selectedTravelEntry.cue.label}`
      : '';
    opInfo(
      'TIME TRAVEL APPLIED',
      `${planLabel} → ${appliedTarget}${leadLabel} · ${ownerLabel}${applied ? ` · ${applied}` : ''}`,
    );
    router.push('/');
  }, [
    actionsDisabled,
    beginPriorityHandoff,
    finishPriorityHandoff,
    frame,
    overview,
    prepareSelectedPlanForRehearsal,
    selectedTravelEntry,
    state?.activePlan,
    state?.zoom?.scope,
    travel,
    travelAdvancedOpen,
    travelCueId,
    travelDate,
    travelResolve,
    travelTime,
  ]);

  const pinkBabyCue = manualCues.find((cue) => cue.id === 'c_baby_reveal_pink') ?? null;
  const blueBabyCue = manualCues.find((cue) => cue.id === 'c_baby_reveal_blue') ?? null;

  const renderOperatorWorkspace = (body: React.ReactNode) => (
    <>
      <TimelineOperatorShell
        state={state}
        connected={connected}
        syncAgeSec={syncAgeSec}
        dayLabel={liveToday?.weekday ?? null}
        alert={primaryAlert}
        view={operatorView}
        editDisabled={performanceMode.active}
        travelDisabled={performanceMode.active}
        onView={handleOperatorView}
      >
        {body}
      </TimelineOperatorShell>

      <PlanPickerSheet
        visible={planPickerOpen}
        plans={plans}
        activePlan={state?.activePlan ?? null}
        planActive={state?.planActive === true}
        inFestivalWindow={state?.inFestivalWindow ?? null}
        draftName={draft?.name ?? null}
        onLoad={loadPlanIntoDraft}
        onActivate={handleActivate}
        onDuplicate={handleDuplicate}
        onDelete={handleDeletePlan}
        onNewTemplate={handleNewTemplate}
        onNewBlank={handleNewBlank}
        onClose={() => setPlanPickerOpen(false)}
      />

      {eventCue || eventMoment ? (
        <EventSheet
          cue={eventCue}
          moment={eventMoment}
          dayDate={eventResolve?.date ?? eventMoment?.date ?? selectedDayOverview?.date ?? null}
          activeCueId={
            eventResolve?.date === nowInTz?.dateKey
              ? nowOwner.cueId
              : null
          }
          planActive={state?.planActive}
          inFestivalWindow={state?.inFestivalWindow}
          resolve={eventResolve}
          resolveError={eventResolveError}
          resolvePending={eventResolvePending}
          busy={eventBusy}
          actionError={eventActionError}
          actionsDisabled={actionsDisabled}
          canEdit={operatorView === 'edit'
            && !!draft
            && !!eventCue
            && (draft.cues ?? []).some((cue) => cue.id === eventCue.id)}
          onPerform={() => { void handlePerform(); }}
          onTravel={() => { void handleTravel(); }}
          onTravelBefore={() => { void handleTravel(10); }}
          onEdit={() => {
            if (!eventCue || operatorView !== 'edit') return;
            const planCue = (draft?.cues ?? []).find((cue) => cue.id === eventCue.id);
            closeEvent();
            if (planCue) openEditCue(planCue);
          }}
          onClose={closeEvent}
        />
      ) : null}

      <ManualCueReviewSheet
        cue={manualCue}
        busy={eventBusy}
        disabled={actionsDisabled}
        onClose={() => setManualCue(null)}
        onFire={(cue) => { void confirmAndFireManualCue(cue); }}
      />
      <BabyRevealChoiceSheet
        visible={babyRevealOpen}
        pinkCue={pinkBabyCue}
        blueCue={blueBabyCue}
        disabled={actionsDisabled}
        onChoose={(cue) => { void confirmAndFireManualCue(cue); }}
        onClose={() => setBabyRevealOpen(false)}
      />

      {draft ? (
        <CueEditorSheet
          visible={cueSheetOpen}
          initialCue={editingCue}
          plan={draft}
          playlists={playlists}
          palettes={getCachedColorPalettes()}
          dayIndex={selectedDay ?? 0}
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
    </>
  );

  if (operatorView === 'live') {
    return renderOperatorWorkspace(
      <TimelineLiveView
        state={state}
        nowOwner={nowOwner}
        nextCues={nextCues}
        manualCues={manualCues}
        nowMs={nowTick}
        actionsDisabled={actionsDisabled}
        actionPending={liveActionPending}
        actionFeedback={liveActionFeedback}
        partyCard={(
          <TimelinePartyCard
            state={state}
            connected={connected}
            controlsLocked={performanceMode.active}
            planTz={planTz}
          />
        )}
        onReviewCue={(cue, date) => openEvent(cue, date)}
        onReviewManualCue={setManualCue}
        onOpenBabyReveal={() => setBabyRevealOpen(true)}
        onTakeover={() => { void handleTakeover(); }}
        onPausePlan={() => { void handlePausePlan(); }}
        onResumeLive={() => { void handleResumeLive(); }}
        onEndProgram={() => { void handleEndProgramConfirmed(); }}
      />,
    );
  }

  if (operatorView === 'travel') {
    return renderOperatorWorkspace(
      <TimelineTravelView
        overview={overview}
        frame={frame}
        todayDate={nowDate}
        nowMinutes={nowMinutes}
        targetDate={travelDate}
        targetTime={travelTime}
        selectedCueId={travelCueId}
        advancedOpen={travelAdvancedOpen}
        resolved={travelResolve}
        previewError={travelResolveError}
        resolving={travelResolving}
        busy={travelBusy}
        pendingLeadSeconds={travelLeadSecondsBusy}
        actionsDisabled={actionsDisabled}
        zoom={state?.zoom}
        onTargetDate={handleTravelDate}
        onTargetTime={setTravelTime}
        onSelectCue={handleTravelCue}
        onToggleAdvanced={handleToggleTravelAdvanced}
        onTravel={() => { void handleLocalTravel(); }}
        onTravelBefore={() => { void handleLocalTravel(10); }}
        onResumeLive={() => { void handleResumeLive(); }}
      />,
    );
  }

  if (operatorView === 'calendar') {
    return renderOperatorWorkspace(
      zoomLevel === 'day' && selectedDayOverview ? (
        <>
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
            <TouchableOpacity
              style={[styles.miniBtn, { minHeight: 48, paddingHorizontal: 20 }]}
              onPress={() => {
                setOperatorView('edit');
                if (!draft && state?.activePlan) void loadPlanIntoDraft(state.activePlan);
              }}
              disabled={performanceMode.active}
              accessibilityRole="button"
            >
              <Text style={styles.miniBtnText}>EDIT THIS DAY</Text>
            </TouchableOpacity>
          </View>
          <DayView
            days={overview?.days ?? []}
            frame={frame}
            index={selectedDay ?? 0}
            planCues={[]}
            nowMinutes={nowMinutes}
            nowDate={nowDate}
            activeCueId={frameNowIndex === selectedDay ? nowOwner.cueId : null}
            canEdit={false}
            showRibbon={false}
            onBackToWeek={backToWeek}
            onPrevDay={() => stepDay(-1)}
            onNextDay={() => stepDay(1)}
            onOpenEvent={openEvent}
            onOpenMoment={openMoment}
            onEditCue={() => undefined}
            onDeleteCue={() => undefined}
            onAddCue={() => undefined}
          />
        </>
      ) : overview ? (
        <View style={{ gap: 12 }}>
          <Text style={[styles.sectionLabel, { fontSize: 18, color: C.text }]}>
            {`SAVED PLAN · ${selectedPlanName ?? 'NO PLAN'} · WEEK OVERVIEW`}
          </Text>
          <Text style={[styles.helperLine, { fontSize: 16, lineHeight: 22 }]}>
            Cue and empty-time taps open review first. Nothing on this calendar fires immediately.
          </Text>
          <DayOverviewStrip {...stripPropsFor(overview.days)} />
        </View>
      ) : (
        <Text style={styles.emptyHint}>No saved plan overview is available.</Text>
      ),
    );
  }

  if (operatorView === 'edit') {
    return renderOperatorWorkspace(
      <View
        style={{ gap: 14, opacity: timelineDataStale ? 0.58 : 1 }}
        pointerEvents={timelineDataStale ? 'none' : 'auto'}
      >
        <View style={[
          {
            minHeight: 72,
            alignItems: 'center',
            paddingHorizontal: 18,
            paddingVertical: 12,
            flexDirection: 'row',
            gap: 12,
            borderRadius: 14,
            borderWidth: 1,
            borderColor: C.ghostBorder,
            backgroundColor: C.surfaceContainerLowest,
          },
        ]}>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle}>
              EDIT PLAN · {draft?.name || 'NO DRAFT'}
            </Text>
            <Text style={styles.helperLine}>
              {timelineEditHeaderHelper({
                draftName: draft?.name,
                activePlan: state?.activePlan,
              })}
            </Text>
          </View>
          <Text style={[styles.miniBtnText, { color: autoSaveTone }]}>
            {autoSaveLabel}
          </Text>
          <TouchableOpacity
            style={[styles.miniBtn, { minHeight: 48, paddingHorizontal: 18 }]}
            onPress={() => setPlanPickerOpen(true)}
            accessibilityRole="button"
          >
            <Text style={styles.miniBtnText}>PLANS</Text>
          </TouchableOpacity>
        </View>

        {zoomLevel === 'day' && selectedDayOverview ? (
          <DayView
            days={overview?.days ?? []}
            frame={frame}
            index={selectedDay ?? 0}
            planCues={draft?.cues ?? []}
            nowMinutes={nowMinutes}
            nowDate={nowDate}
            activeCueId={frameNowIndex === selectedDay ? nowOwner.cueId : null}
            canEdit={!!draft}
            showRibbon={false}
            onBackToWeek={backToWeek}
            onPrevDay={() => stepDay(-1)}
            onNextDay={() => stepDay(1)}
            onOpenEvent={openEvent}
            onOpenMoment={openMoment}
            onEditCue={openEditCue}
            onDeleteCue={handleDeleteCue}
            onAddCue={openAddCue}
          />
        ) : (
          <>
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
            <PlanTransitionEditor
              value={draft?.transition}
              disabled={!draft}
              onChange={(transition) => mutateDraft((plan) => {
                if (transition) plan.transition = transition;
                else delete plan.transition;
              })}
            />
            <TouchableOpacity
              style={[
                styles.miniBtn,
                { minHeight: 52, alignSelf: 'flex-start', paddingHorizontal: 18 },
                !draft && { opacity: 0.4 },
              ]}
              onPress={openEditDefaultCue}
              disabled={!draft}
              accessibilityRole="button"
            >
              <Text style={styles.miniBtnText}>EDIT DEFAULT CUE</Text>
            </TouchableOpacity>
            {overview ? (
              <DayOverviewStrip {...stripPropsFor(overview.days)} />
            ) : (
              <Text style={styles.emptyHint}>
                {draft ? 'Previewing draft…' : 'Open PLANS to load or create a draft.'}
              </Text>
            )}
          </>
        )}
      </View>,
    );
  }

  // Every member of TimelineOperatorView returns above. This assignment is
  // the compiler's proof of that: adding a view to the union stops
  // typechecking here until the new view gets its own branch, so the throw
  // can never run.
  const unreachable: never = operatorView;
  throw new Error(`Timeline: no view for operator mode ${String(unreachable)}`);
}

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
    // ── PARTY MODE card (session handling) ──
    partyCard: {
      borderRadius: 12, borderWidth: 1, borderColor: C.ghostBorder,
      backgroundColor: C.surfaceContainerLowest, padding: 16, marginBottom: 14,
    },
    partyHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
    partyTitle: {
      fontFamily: 'SpaceGrotesk_700Bold', fontSize: 14, color: C.text,
      letterSpacing: 1.2, textTransform: 'uppercase',
    },
    partyDetail: { fontFamily: 'Inter_400Regular', fontSize: 12, color: C.secondary, marginTop: 2 },
    partySubLabel: {
      fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10, color: C.icon, letterSpacing: 1.2,
      textTransform: 'uppercase', marginTop: 16, marginBottom: 8,
    },
    partyChip: {
      paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8, borderWidth: 1,
      minHeight: 40, justifyContent: 'center',
    },
    partyChipText: { fontFamily: 'SpaceGrotesk_700Bold', fontSize: 12, letterSpacing: 0.6 },
    partyFieldRow: {
      flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap',
      paddingVertical: 8, borderTopWidth: 1, borderTopColor: C.ghostBorder,
    },
    partyFieldLabel: { fontFamily: 'SpaceGrotesk_700Bold', fontSize: 12, color: C.text, letterSpacing: 0.6 },
    partyFieldHint: { fontFamily: 'Inter_400Regular', fontSize: 11, color: C.secondary, marginTop: 2 },
    partyFieldValue: {
      fontFamily: 'SpaceGrotesk_700Bold', fontSize: 15, color: C.text,
      minWidth: 76, textAlign: 'center',
    },
    partyStepBtn: {
      width: 44, height: 44, borderRadius: 8, borderWidth: 1, borderColor: C.ghostBorder,
      backgroundColor: C.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center',
    },
    partyStepBtnText: { fontFamily: 'SpaceGrotesk_700Bold', fontSize: 20, color: C.text },
    partyToggle: {
      minWidth: 56, minHeight: 44, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1,
      alignItems: 'center', justifyContent: 'center',
    },
    partyToggleText: { fontFamily: 'SpaceGrotesk_700Bold', fontSize: 12, letterSpacing: 0.8 },
    partyMono: { fontFamily: 'SpaceGrotesk_700Bold', fontSize: 11, color: C.text },
    partyLink: { fontFamily: 'SpaceGrotesk_700Bold', fontSize: 11, color: C.primary },
  });
}
