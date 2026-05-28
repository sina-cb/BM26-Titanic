/**
 * Scheduler tab — operator surface for the engine-owned scheduled
 * task list (docs/31 v3 + Phase 1 engine report
 * .agent/02_reports/202605/20260527_2_scheduler_engine.md).
 *
 * Canonical use case the operator asked for: "turn on the hazer for
 * 10 seconds every 1 minute." One ADD tap + one library-picker tap
 * (fogger / default — the rig's hazer) gets there with no keyboard
 * input anywhere on this surface.
 *
 * The tab is intentionally thin — the engine owns:
 *   - the canonical task list and YAML persistence,
 *   - the 250 ms tick + fire dispatch,
 *   - the library lookup at fire time (so a removed effect surfaces
 *     as `status:'error'`, not a silent skip — codex P0).
 *
 * CaptainPad's job is:
 *   - render the list (FlatList, virtualised),
 *   - optimistic UI on every mutation,
 *   - countdown ticks (ONE 250 ms interval feeds nowMs to every row),
 *   - the library picker modal (one shared library fetch),
 *   - engine-offline banner identical to the deck tab's.
 *
 * No keyboard input. The single text affordance on the row is the
 * library-picker chip label (auto-derived from effectId/presetId) —
 * tap to swap, not to edit.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Palette } from '@/constants/theme';
import { View, Text, TouchableOpacity, FlatList, ActivityIndicator, StyleSheet } from 'react-native';
import { useGlobalStyles, GlobalStyles } from '@/styles/globalStyles';
import { usePalette } from '@/hooks/use-theme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { engineEvents } from '@/utils/engineEvents';
import {
  fetchGlobalEffectLibrary,
  createScheduledTask,
  patchScheduledTask,
  deleteScheduledTask,
  fireScheduledTaskNow,
  stopScheduledTask,
  ScheduledTask,
} from '@/utils/api';
import {
  useScheduledTasks,
  applyOptimisticTaskUpdate,
  applyOptimisticTaskRemove,
  applyOptimisticTaskInsert,
} from '@/hooks/useScheduledTasks';
import { ScheduledTaskRow } from '@/components/ScheduledTaskRow';
import { LibraryEffectPicker, Library, LibraryPick, isSchedulerAllowedEffect } from '@/components/LibraryEffectPicker';

// Operator default for [+ ADD TASK]. The Phase 1 engine report flagged
// this is server-validated (POST requires effectId + presetId), so the
// UI picks the alphabetical-first library entry to seed a valid row.
// The very next tap should be the library picker — the bottom of the
// row is already in "valid, armed" state from the moment of creation.
const DEFAULT_ON_DURATION_MS = 10_000;
const DEFAULT_INTERVAL_MS = 60_000;

function pickFirstLibraryEntry(library: Library): { effectId: string; presetId: string } | null {
  // Prefer the first allowed effect so `+ ADD TASK` lands on something
  // the operator can actually keep — otherwise a fresh row starts on
  // an effect they immediately can't change without flipping the
  // allowlist. Falls back to any effect if no allowed entry exists in
  // the library (defensive — would only happen if the allowlist drifts).
  const sortedEffects = Object.values(library).sort((a, b) => a.id.localeCompare(b.id));
  const allowedFirst = sortedEffects.filter((fx) => isSchedulerAllowedEffect(fx.id));
  for (const fx of [...allowedFirst, ...sortedEffects]) {
    const presets = Object.keys(fx.presets).sort();
    if (presets.length > 0) {
      return { effectId: fx.id, presetId: presets[0] };
    }
  }
  return null;
}

// ── Offline banner ──────────────────────────────────────────────────
// Same visual recipe as the deck's OfflineBanner (index.tsx:70). Hoisted
// here as a local component so the Scheduler tab stays self-contained
// and we don't reach into the deck file.
function OfflineBanner({ error }: { error: string }) {
  const C = usePalette();
  const globalStyles = useGlobalStyles();
  const styles = useMemo(() => makeStyles(C, globalStyles), [C, globalStyles]);
  return (
    <View style={styles.offlineBanner}>
      <IconSymbol name="wifi.slash" size={24} color={C.error} />
      <View style={{ flex: 1 }}>
        <Text style={styles.offlineTitle}>ENGINE OFFLINE</Text>
        <Text style={styles.offlineBody}>
          {error || 'CaptainPad cannot reach the engine. The engine continues to fire scheduled tasks on its own.'}
        </Text>
      </View>
    </View>
  );
}

// ── Empty state ──────────────────────────────────────────────────────
// Centred prose + ADD button. Caps heading + Inter prose, matches the
// dimmer rack's "no groups" empty state and the deck's empty channel
// state. The ADD button below the prose mirrors the header chip so
// the operator has two equivalent entry points.
function EmptyState({ onAdd }: { onAdd: () => void }) {
  const C = usePalette();
  const globalStyles = useGlobalStyles();
  const styles = useMemo(() => makeStyles(C, globalStyles), [C, globalStyles]);
  return (
    <View style={styles.emptyWrap}>
      <Text style={styles.emptyTitle}>NO SCHEDULED TASKS YET</Text>
      <Text style={styles.emptyBody}>
        Tap ADD TASK to schedule any effect from the library to fire on a timer.{'\n\n'}
        Typical use: hazer 10s every 1m, blast white 2s every 5m.
      </Text>
      <TouchableOpacity onPress={onAdd} style={styles.emptyAddButton} accessibilityRole="button" accessibilityLabel="Add scheduled task">
        <Text style={styles.emptyAddLabel}>+ ADD TASK</Text>
      </TouchableOpacity>
    </View>
  );
}

export default function SchedulerScreen() {
  const C = usePalette();
  const globalStyles = useGlobalStyles();
  const styles = useMemo(() => makeStyles(C, globalStyles), [C, globalStyles]);
  const { tasks, presets, isLoading, error } = useScheduledTasks();
  const [library, setLibrary] = useState<Library | null>(null);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [pickerTaskId, setPickerTaskId] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState<boolean>(engineEvents.getStatus().connected);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  // Surfaces engine 4xx errors from mutations that aren't already
  // visible as `task.lastError`. Cleared on the next successful
  // broadcast (the ws subscription in useScheduledTasks does that
  // implicitly by replacing the task list).
  const [actionError, setActionError] = useState<string | null>(null);
  const actionErrorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Library fetch (once per mount; cached across the modal opens) ──
  // Mirrors the GEM swap-sheet's library loader (GlobalEffectMacros).
  // The fetch is cheap on the engine (in-memory library); we don't try
  // to share with GEM because that component holds its own copy and
  // the tab isn't going to thrash this.
  useEffect(() => {
    let alive = true;
    fetchGlobalEffectLibrary().then((r) => {
      if (!alive) return;
      if (r.ok && r.data?.effects) {
        setLibrary(r.data.effects as Library);
        setLibraryError(null);
      } else {
        setLibraryError(r.error || 'Failed to load effect library');
      }
    });
    return () => { alive = false; };
  }, []);

  // ── Single 250 ms ticker drives every row's countdown ──────────────
  // One interval, one setState — every row reads nowMs as a prop and
  // re-renders only if its countdown actually changed. React.memo
  // on ScheduledTaskRow handles the per-row short-circuit when the
  // visible text didn't change.
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 250);
    return () => clearInterval(t);
  }, []);

  // ── Engine connection status ───────────────────────────────────────
  useEffect(() => {
    const unsub = engineEvents.subscribeStatus((s) => setIsConnected(!!s.connected));
    return unsub;
  }, []);

  // ── Action error surfacing ─────────────────────────────────────────
  // Show a transient banner for engine-rejected mutations (the row's
  // own `lastError` covers errors raised inside the scheduler tick;
  // this is for 400s on POST/PATCH/DELETE that don't make it into the
  // task list). Auto-clears after 4 seconds. Codex P0: surface the
  // engine error verbatim; do not retry on 400.
  const flashError = useCallback((msg: string) => {
    setActionError(msg);
    if (actionErrorTimerRef.current) clearTimeout(actionErrorTimerRef.current);
    actionErrorTimerRef.current = setTimeout(() => {
      setActionError(null);
      actionErrorTimerRef.current = null;
    }, 4000);
  }, []);
  useEffect(() => () => {
    if (actionErrorTimerRef.current) clearTimeout(actionErrorTimerRef.current);
  }, []);

  // ── Mutations ──────────────────────────────────────────────────────

  const handleAdd = useCallback(async () => {
    if (!library) {
      flashError('Effect library not loaded yet — try again in a moment.');
      return;
    }
    const seed = pickFirstLibraryEntry(library);
    if (!seed) {
      flashError('Engine reports no effects in the global library — cannot create task.');
      return;
    }
    const body = {
      effectId: seed.effectId,
      presetId: seed.presetId,
      label: `${seed.effectId} / ${seed.presetId}`,
      enabled: true,
      mode: 'duration' as const,
      onDurationMs: DEFAULT_ON_DURATION_MS,
      intervalMs: DEFAULT_INTERVAL_MS,
    };
    const r = await createScheduledTask(body);
    if (!r.ok) {
      flashError(r.error || 'Engine rejected create');
      return;
    }
    // Optimistic insert — the WS broadcast usually beats this, but
    // belt-and-braces guarantees the row is visible the instant the
    // engine confirms.
    if (r.data?.task) applyOptimisticTaskInsert(r.data.task);
  }, [library, flashError]);

  const handleToggleEnabled = useCallback(async (task: ScheduledTask) => {
    const nextEnabled = !task.enabled;
    const optimistic: ScheduledTask = {
      ...task,
      enabled: nextEnabled,
      status: nextEnabled ? 'armed' : 'disabled',
    };
    applyOptimisticTaskUpdate(optimistic);
    const r = await patchScheduledTask(task.id, { enabled: nextEnabled });
    if (!r.ok) {
      // Roll back — preserve the original by re-applying.
      applyOptimisticTaskUpdate(task);
      flashError(r.error || 'Engine rejected enable toggle');
    } else if (r.data?.task) {
      applyOptimisticTaskUpdate(r.data.task);
    }
  }, [flashError]);

  const handlePickLibrary = useCallback((task: ScheduledTask) => {
    setPickerTaskId(task.id);
  }, []);

  const handlePicked = useCallback(async (pick: LibraryPick) => {
    const task = tasks.find((t) => t.id === pickerTaskId);
    if (!task) return;
    const optimistic: ScheduledTask = {
      ...task,
      effectId: pick.effectId,
      presetId: pick.presetId,
      label: pick.label,
    };
    applyOptimisticTaskUpdate(optimistic);
    // Engine requires {effectId, presetId} as a pair (Phase 1 report
    // ambiguity #1 / docs/31 §"Engine API"). Send both + the derived
    // label so the row reads naturally afterwards.
    const r = await patchScheduledTask(task.id, {
      effectId: pick.effectId,
      presetId: pick.presetId,
      label: pick.label,
    });
    if (!r.ok) {
      applyOptimisticTaskUpdate(task);
      flashError(r.error || 'Engine rejected effect swap');
    } else if (r.data?.task) {
      applyOptimisticTaskUpdate(r.data.task);
    }
  }, [tasks, pickerTaskId, flashError]);

  const handleChangeOnDuration = useCallback(async (task: ScheduledTask, ms: number) => {
    const optimistic: ScheduledTask = { ...task, onDurationMs: ms };
    applyOptimisticTaskUpdate(optimistic);
    const r = await patchScheduledTask(task.id, { onDurationMs: ms });
    if (!r.ok) {
      applyOptimisticTaskUpdate(task);
      flashError(r.error || 'Engine rejected on-duration change');
    } else if (r.data?.task) {
      applyOptimisticTaskUpdate(r.data.task);
    }
  }, [flashError]);

  const handleChangeInterval = useCallback(async (task: ScheduledTask, ms: number) => {
    const optimistic: ScheduledTask = { ...task, intervalMs: ms };
    applyOptimisticTaskUpdate(optimistic);
    const r = await patchScheduledTask(task.id, { intervalMs: ms });
    if (!r.ok) {
      applyOptimisticTaskUpdate(task);
      flashError(r.error || 'Engine rejected interval change');
    } else if (r.data?.task) {
      applyOptimisticTaskUpdate(r.data.task);
    }
  }, [flashError]);

  const handleFireNow = useCallback(async (task: ScheduledTask) => {
    // Optimistically flip to 'firing' so the row reads as "going" the
    // instant the operator taps — the broadcast lands within a few ms
    // and overrides the firingUntilMs accurately.
    const optimistic: ScheduledTask = {
      ...task,
      status: 'firing',
      firingUntilMs: Date.now() + task.onDurationMs,
    };
    applyOptimisticTaskUpdate(optimistic);
    const r = await fireScheduledTaskNow(task.id);
    if (!r.ok) {
      applyOptimisticTaskUpdate(task);
      flashError(r.error || 'Engine rejected fire-now');
    } else if (r.data?.task) {
      applyOptimisticTaskUpdate(r.data.task);
    }
  }, [flashError]);

  const handleStop = useCallback(async (task: ScheduledTask) => {
    const optimistic: ScheduledTask = {
      ...task,
      status: task.enabled ? 'armed' : 'disabled',
      firingUntilMs: null,
    };
    applyOptimisticTaskUpdate(optimistic);
    const r = await stopScheduledTask(task.id);
    if (!r.ok) {
      applyOptimisticTaskUpdate(task);
      flashError(r.error || 'Engine rejected stop');
    } else if (r.data?.task) {
      applyOptimisticTaskUpdate(r.data.task);
    }
  }, [flashError]);

  const handleDelete = useCallback(async (task: ScheduledTask) => {
    // No confirmation — doc says delete is one tap.
    applyOptimisticTaskRemove(task.id);
    const r = await deleteScheduledTask(task.id);
    if (!r.ok) {
      // Re-insert so the operator can see what failed. The WS
      // broadcast should also re-converge if the engine still has it.
      applyOptimisticTaskInsert(task);
      flashError(r.error || 'Engine rejected delete');
    }
  }, [flashError]);

  // ── Derived list (server order is canonical) ───────────────────────
  const data = tasks;
  const pickerTask = useMemo(
    () => (pickerTaskId ? data.find((t) => t.id === pickerTaskId) ?? null : null),
    [pickerTaskId, data],
  );

  // FlatList virtualisation — fixed-ish per-row height keeps scrolling
  // smooth even at 20+ rows. The row has three internal rows of ~36
  // px each plus paddings; 156 is a tight estimate that prevents
  // visible blank space on slow scrolls.
  const ROW_HEIGHT_ESTIMATE = 156;
  const getItemLayout = useCallback(
    (_: ArrayLike<ScheduledTask> | null | undefined, index: number) => ({
      length: ROW_HEIGHT_ESTIMATE,
      offset: ROW_HEIGHT_ESTIMATE * index,
      index,
    }),
    [],
  );

  const keyExtractor = useCallback((t: ScheduledTask) => t.id, []);

  const renderItem = useCallback(({ item }: { item: ScheduledTask }) => {
    // Resolve the bound preset's behavior from the cached library so
    // the row can hide ON DURATION for trigger/burst effects. null when
    // the library hasn't loaded yet OR the effect/preset is missing —
    // the engine will surface the real mismatch via task.lastError.
    const behavior =
      library?.[item.effectId]?.presets?.[item.presetId]?.defaultBehavior ?? null;
    return (
      <ScheduledTaskRow
        task={item}
        behavior={behavior}
        onDurationPresets={presets.onDurationMs}
        intervalPresets={presets.intervalMs}
        nowMs={nowMs}
        onToggleEnabled={handleToggleEnabled}
        onPickLibrary={handlePickLibrary}
        onChangeOnDuration={handleChangeOnDuration}
        onChangeInterval={handleChangeInterval}
        onFireNow={handleFireNow}
        onStop={handleStop}
        onDelete={handleDelete}
      />
    );
  }, [
    library,
    presets.onDurationMs,
    presets.intervalMs,
    nowMs,
    handleToggleEnabled,
    handlePickLibrary,
    handleChangeOnDuration,
    handleChangeInterval,
    handleFireNow,
    handleStop,
    handleDelete,
  ]);

  return (
    <View style={styles.container}>
      <View style={styles.surface}>
        <View style={styles.headerRow}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 }}>
            <IconSymbol name="calendar.badge.clock" size={28} color={C.primary} />
            <Text style={styles.headerTitle}>SCHEDULED TASKS</Text>
          </View>
          <TouchableOpacity
            onPress={handleAdd}
            style={styles.addButton}
            accessibilityRole="button"
            accessibilityLabel="Add scheduled task"
          >
            <Text style={styles.addButtonLabel}>+ ADD TASK</Text>
          </TouchableOpacity>
        </View>

        {isConnected === false ? <OfflineBanner error="" /> : null}

        {actionError ? (
          <View style={styles.actionErrorBanner}>
            <Text style={styles.actionErrorText} numberOfLines={2}>
              {actionError}
            </Text>
          </View>
        ) : null}

        {libraryError ? (
          <View style={styles.actionErrorBanner}>
            <Text style={styles.actionErrorText} numberOfLines={2}>
              {libraryError}
            </Text>
          </View>
        ) : null}

        {/* Body — loading shell, empty state, or virtualised list. */}
        {isLoading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator size="large" color={C.primary} />
            <Text style={styles.loadingText}>Loading scheduled tasks…</Text>
          </View>
        ) : error ? (
          <View style={styles.loadingWrap}>
            <Text style={styles.errorTitle}>Engine error</Text>
            <Text style={styles.errorBody}>{error}</Text>
          </View>
        ) : data.length === 0 ? (
          <EmptyState onAdd={handleAdd} />
        ) : (
          <FlatList
            data={data}
            keyExtractor={keyExtractor}
            renderItem={renderItem}
            getItemLayout={getItemLayout}
            contentContainerStyle={{ paddingBottom: 32 }}
            showsVerticalScrollIndicator={false}
            removeClippedSubviews={false}
          />
        )}

        <LibraryEffectPicker
          visible={pickerTaskId !== null}
          library={library}
          currentEffectId={pickerTask?.effectId ?? null}
          currentPresetId={pickerTask?.presetId ?? null}
          onClose={() => setPickerTaskId(null)}
          onPick={handlePicked}
        />
      </View>
    </View>
  );
}


function makeStyles(C: Palette, globalStyles: GlobalStyles) {
  return StyleSheet.create({
  container: {
    ...globalStyles.container,
    padding: 24,
    flexDirection: 'column',
  },
  surface: {
    flex: 1,
    ...globalStyles.surfaceLow,
    padding: 24,
    borderWidth: 1,
    borderColor: C.ghostBorder,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
    gap: 12,
  },
  headerTitle: {
    fontFamily: 'SpaceGrotesk_700Bold',
    fontSize: 16,
    color: C.text,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  addButton: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: C.primary,
    minHeight: 44,
    minWidth: 132,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addButtonLabel: {
    fontFamily: 'SpaceGrotesk_700Bold',
    fontSize: 12,
    color: '#FFF',
    letterSpacing: 0.8,
  },
  offlineBanner: {
    backgroundColor: 'rgba(186, 26, 26, 0.12)',
    borderColor: C.error,
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  offlineTitle: {
    fontFamily: 'SpaceGrotesk_700Bold',
    color: C.error,
    fontSize: 14,
    letterSpacing: 0.8,
  },
  offlineBody: {
    fontFamily: 'Inter_400Regular',
    color: C.error,
    fontSize: 12,
    marginTop: 4,
  },
  actionErrorBanner: {
    backgroundColor: 'rgba(186, 26, 26, 0.10)',
    borderColor: C.error,
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  },
  actionErrorText: {
    fontFamily: 'Inter_400Regular',
    color: C.error,
    fontSize: 12,
  },
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  loadingText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    color: C.secondary,
  },
  errorTitle: {
    fontFamily: 'SpaceGrotesk_700Bold',
    fontSize: 16,
    color: C.error,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  errorBody: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    color: C.secondary,
    textAlign: 'center',
    maxWidth: 480,
  },
  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    padding: 24,
  },
  emptyTitle: {
    fontFamily: 'SpaceGrotesk_700Bold',
    fontSize: 16,
    color: C.secondary,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  emptyBody: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    color: C.secondary,
    textAlign: 'center',
    maxWidth: 480,
    lineHeight: 20,
  },
  emptyAddButton: {
    marginTop: 8,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.primary,
    backgroundColor: 'rgba(0, 104, 117, 0.08)',
    minHeight: 44,
    justifyContent: 'center',
  },
  emptyAddLabel: {
    fontFamily: 'SpaceGrotesk_700Bold',
    color: C.primary,
    fontSize: 14,
    letterSpacing: 1,
  },
});
}
