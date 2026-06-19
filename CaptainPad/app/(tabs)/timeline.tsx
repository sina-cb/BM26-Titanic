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
  ShowPlan,
  PlanCue,
} from '@/utils/timelineApi';
import { DayOverviewStrip } from '@/components/timeline/DayOverviewStrip';
import { DayEditor } from '@/components/timeline/DayEditor';
import { CueEditorSheet } from '@/components/timeline/CueEditorSheet';
import { PlanPickerSheet } from '@/components/timeline/PlanPickerSheet';
import {
  brcStarterPlan, clonePlan, duplicatePlan, makeCueId,
} from '@/components/timeline/timelineTemplate';

const HOLD_MINUTES = 30;
const PREVIEW_DEBOUNCE_MS = 350;

function formatCountdown(sec: number | null): string {
  if (sec === null || sec === undefined || !Number.isFinite(sec) || sec < 0) return '—';
  const total = Math.round(sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// "starts in M:SS" for the pending-program sign (docs/38 §16.7). Always M:SS
// (no hour rollup — leases are short, default 30 s), clamped at 0:00 so the
// operator never sees a negative or em-dash on an armed lease.
function formatMSS(sec: number | null): string {
  const total = sec === null || !Number.isFinite(sec) ? 0 : Math.max(0, Math.round(sec));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ── Pending-program sign (docs/38 §16.5/§16.7) ──────────────────────────
// The "SCHEDULED SHOW PENDING" lease banner. High-attention amber/warning —
// deliberately louder than the muted error red — so the operator clocks it
// from across the deck. Renders nothing when no lease is armed (handled by the
// caller). ENABLE NOW starts the show immediately; KEEP MANUAL dismisses it.
function PendingProgramSign({
  label, countdownSec, onEnable, onDismiss, styles,
}: {
  label: string;
  countdownSec: number | null;
  onEnable: () => void;
  onDismiss: () => void;
  styles: Styles;
}) {
  return (
    <View style={styles.pendingBanner}>
      <View style={styles.pendingTextCol}>
        <Text style={styles.pendingTitle} numberOfLines={2}>
          {`⚠ SCHEDULED SHOW PENDING — ${label}`}
        </Text>
        <Text style={styles.pendingCountdown}>
          {`starts in ${formatMSS(countdownSec)}`}
        </Text>
      </View>
      <View style={styles.pendingBtnRow}>
        <TouchableOpacity
          onPress={onEnable}
          style={[styles.pendingBtn, styles.pendingBtnEnable]}
          accessibilityLabel="Enable scheduled show now"
        >
          <Text style={styles.pendingBtnEnableText}>ENABLE NOW</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={onDismiss}
          style={[styles.pendingBtn, styles.pendingBtnDismiss]}
          accessibilityLabel="Keep manual control, dismiss scheduled show"
        >
          <Text style={styles.pendingBtnDismissText}>KEEP MANUAL</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
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
  const { state, connected, error, setMode, setAutopilot, hold, resume, endProgram, enableProgram, dismissProgram, fireCue, activatePlan } = useTimeline();

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
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [cueSheetOpen, setCueSheetOpen] = useState(false);
  const [editingCue, setEditingCue] = useState<PlanCue | null>(null);

  const [nowTick, setNowTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setNowTick((n) => n + 1), 1000);
    return () => clearInterval(t);
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

  // Today's festival index for highlighting (from the overview's dates vs now).
  const todayIndex = useMemo(() => {
    if (!overview) return null;
    const now = new Date();
    const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const d = overview.days.find((day) => day.date === todayKey);
    return d ? d.index : null;
  }, [overview]);

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
    setSelectedDay(null);
  }, []);

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

  // Pending-program lease countdown (docs/38 §16.5/§16.7): seconds until the
  // lease auto-starts the show, clamped at 0. Re-derived every 1 s tick so the
  // sign counts down live. We read nowTick (via the shared ticker above) so
  // this memo re-runs each second; clamp to >= 0 ("0:00" at expiry).
  const pendingCountdown = useMemo(() => {
    const p = state?.pendingProgram;
    if (!p || !Number.isFinite(p.expiresAtMs)) return null;
    return Math.max(0, Math.round((p.expiresAtMs - Date.now()) / 1000));
  }, [state?.pendingProgram, nowTick]);

  // The selected day's overview object.
  const selectedDayOverview = useMemo(() => {
    if (selectedDay === null || !overview) return null;
    return overview.days.find((d) => d.index === selectedDay) ?? null;
  }, [selectedDay, overview]);

  return (
    <View style={styles.container}>
      <View style={styles.surface}>
        {/* ── Pending-program sign (docs/38 §16.5/§16.7) ──
            Sits ABOVE everything else and is intentionally the loudest thing on
            the tab so the operator sees it from across the deck. Null lease =>
            nothing rendered (additive; the rest of the tab is unchanged). */}
        {state?.pendingProgram ? (
          <PendingProgramSign
            label={state.pendingProgram.label}
            countdownSec={pendingCountdown}
            onEnable={() => enableProgram()}
            onDismiss={() => dismissProgram()}
            styles={styles}
          />
        ) : null}

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
              onSelectDay={(idx) => {
                // The day editor needs a draft to edit. If we're viewing the
                // live plan, load it into the draft first so taps mutate a copy.
                // Only open the day editor if the load actually succeeded —
                // a failed / festival-less load must not leave a dangling day.
                if (!draft && state?.activePlan) {
                  loadPlanIntoDraft(state.activePlan).then((ok) => { if (ok) setSelectedDay(idx); });
                } else if (draft) {
                  setSelectedDay(idx);
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
            <Text style={styles.helperLine}>Tap a day to edit it — the active plan loads into the maker.</Text>
          ) : (
            <Text style={styles.helperLine}>Edits preview live across all days. SAVE writes the plan; ACTIVATE (in PLANS) makes it run.</Text>
          )}

          {/* ── D. Cue list + controls (live) ── */}
          {state ? (
            <>
              <Text style={styles.sectionLabel}>CUES (LIVE)</Text>
              {state.cues.length === 0 ? (
                <Text style={styles.emptyHint}>The active plan has no cues.</Text>
              ) : (
                state.cues.map((cue) => (
                  <CueRow key={cue.id} cue={cue} onFire={fireCue} styles={styles} C={C} />
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
        visible={selectedDay !== null && !!draft}
        day={selectedDayOverview}
        plan={draft ?? brcStarterPlan()}
        onAddCue={openAddCue}
        onEditCue={openEditCue}
        onDeleteCue={handleDeleteCue}
        onClose={() => setSelectedDay(null)}
      />

      {draft ? (
        <CueEditorSheet
          visible={cueSheetOpen}
          initialCue={editingCue}
          plan={draft}
          playlists={playlists}
          dayIndex={selectedDay ?? 0}
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

// ── Cue row (live, with FIRE) ──
function CueRow({ cue, onFire, styles, C }: { cue: TimelineCue; onFire: (id: string) => void; styles: Styles; C: Palette }) {
  const hasError = !!cue.lastError;
  return (
    <View style={[styles.cueRow, hasError && { borderColor: C.error, backgroundColor: C.errorContainer }]}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[styles.cueLabel, hasError && { color: C.error }]} numberOfLines={1}>{cue.label}</Text>
        <Text style={styles.cueTrigger} numberOfLines={1}>{cue.trigger}</Text>
        {hasError ? <Text style={styles.cueError} numberOfLines={2}>{cue.lastError}</Text> : null}
      </View>
      <Text style={[styles.cueCountdown, !cue.enabled && { color: C.icon }]}>
        {cue.enabled ? formatCountdown(cue.nextInSec) : 'off'}
      </Text>
      <TouchableOpacity onPress={() => onFire(cue.id)} style={styles.fireButton} accessibilityLabel={`Fire cue ${cue.label}`}>
        <Text style={styles.fireButtonLabel}>FIRE</Text>
      </TouchableOpacity>
    </View>
  );
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
    // ── Pending-program sign (docs/38 §16.5/§16.7) ──
    // Amber/warning, deliberately the loudest element on the tab: thick amber
    // border + warm fill so it reads from across the deck. NOT the muted error
    // red. Stacks text + big touch buttons; wraps on narrow widths.
    pendingBanner: {
      backgroundColor: 'rgba(245, 166, 35, 0.16)',
      borderColor: '#f5a623',
      borderWidth: 2.5,
      borderRadius: 14,
      paddingVertical: 16,
      paddingHorizontal: 18,
      marginBottom: 18,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 16,
      flexWrap: 'wrap',
    },
    pendingTextCol: { flex: 1, minWidth: 200 },
    pendingTitle: {
      fontFamily: 'SpaceGrotesk_700Bold', fontSize: 20, color: '#f5a623',
      letterSpacing: 0.6, textTransform: 'uppercase',
    },
    pendingCountdown: {
      fontFamily: 'SpaceGrotesk_700Bold', fontSize: 16, color: C.text, marginTop: 6, letterSpacing: 0.4,
    },
    pendingBtnRow: { flexDirection: 'row', gap: 12, alignItems: 'center' },
    pendingBtn: {
      paddingHorizontal: 22, paddingVertical: 16, borderRadius: 10,
      minHeight: 56, minWidth: 140, alignItems: 'center', justifyContent: 'center',
    },
    pendingBtnEnable: { backgroundColor: '#f5a623' },
    pendingBtnEnableText: {
      fontFamily: 'SpaceGrotesk_700Bold', fontSize: 15, color: '#1a1100', letterSpacing: 0.8,
    },
    pendingBtnDismiss: { backgroundColor: 'transparent', borderWidth: 2, borderColor: '#f5a623' },
    pendingBtnDismissText: {
      fontFamily: 'SpaceGrotesk_700Bold', fontSize: 15, color: '#f5a623', letterSpacing: 0.8,
    },
  });
}
