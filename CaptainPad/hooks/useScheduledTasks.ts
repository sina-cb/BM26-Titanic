// useScheduledTasks — live mirror of the engine-owned scheduled task list.
//
// Mirrors the useEngineState pattern (module-level cache + listener set +
// REST seed). The engine is the source of truth: it broadcasts
// `scheduledTasks` on /ws/control whenever the list state-machines (create,
// PATCH, delete, fire, stop, error). The hook holds an in-memory cache so
// every cold-paint of the Scheduler tab is < 100 ms once the first GET
// has resolved (and is instantaneous on re-mount).
//
// Why module-level (not per-component):
//   The scheduler ALSO renders nothing on the dimmer-rack / mixer tabs,
//   but having the cache live in module space means tab switches don't
//   tear down the WS subscription or re-fetch on every focus — both are
//   the same "we've already paid the parse cost, just keep the listener"
//   recipe used by useEngineState / useEngineLock.
//
// What we expose:
//   - `tasks`        — the task list, in server-ordered form.
//   - `presets`      — { onDurationMs[], intervalMs[] } so the row UI
//                      renders the same pill set the engine validates.
//   - `isLoading`    — true until the first REST seed lands.
//   - `error`        — last GET/seed error, or null. PATCH/POST errors
//                      live on individual rows via `task.lastError`.

import { useEffect, useState } from 'react';
import { engineEvents } from '@/utils/engineEvents';
import {
  fetchScheduledTasks,
  ScheduledTask,
  ScheduledTaskPresets,
} from '@/utils/api';

export interface ScheduledTasksState {
  tasks: ScheduledTask[];
  presets: ScheduledTaskPresets;
  isLoading: boolean;
  error: string | null;
}

// The doc's preset arrays. Used as the fall-back display set until the
// engine's GET /scheduled-tasks resolves and overrides them with the
// engine-canonical lists. The doc says they're locked, so the hard-coded
// values here exactly match the doc's `ON_DURATION_PRESETS_MS` and
// `INTERVAL_PRESETS_MS`. If the engine ever expands these, the GET
// response overrides — UI re-renders with the new pills.
const FALLBACK_PRESETS: ScheduledTaskPresets = {
  onDurationMs: [1_000, 2_000, 5_000, 10_000, 15_000, 30_000, 60_000],
  intervalMs: [30_000, 60_000, 120_000, 300_000, 600_000, 900_000, 1_800_000, 3_600_000],
};

const EMPTY_STATE: ScheduledTasksState = {
  tasks: [],
  presets: FALLBACK_PRESETS,
  isLoading: true,
  error: null,
};

let _cached: ScheduledTasksState = EMPTY_STATE;
const _listeners = new Set<(s: ScheduledTasksState) => void>();
let _initialized = false;

function _emit(next: ScheduledTasksState) {
  _cached = next;
  _listeners.forEach((cb) => {
    try { cb(next); } catch { /* a buggy listener must never break the bus */ }
  });
}

function _ensureInitialized() {
  if (_initialized) return;
  _initialized = true;

  // Subscribe to /ws/control for live updates. The engine emits
  // {type:'scheduledTasks', tasks:[...]} on create / PATCH / delete /
  // fire / stop / error. Status broadcasts come through the same bus
  // (subscribeStatus); the Scheduler tab consumes that separately so
  // the row list keeps rendering frozen-state-from-cache while the
  // banner reports offline.
  engineEvents.subscribe((msg) => {
    if (msg && msg.type === 'scheduledTasks' && Array.isArray(msg.tasks)) {
      _emit({
        ..._cached,
        tasks: msg.tasks as ScheduledTask[],
        isLoading: false,
        error: null,
      });
    }
  });

  // REST seed. The WS broadcast covers state changes but doesn't fire
  // on connect — we need the initial list to populate the cache.
  fetchScheduledTasks()
    .then((r) => {
      if (r.ok && r.data) {
        _emit({
          tasks: r.data.tasks ?? [],
          presets: r.data.presets ?? FALLBACK_PRESETS,
          isLoading: false,
          error: null,
        });
      } else {
        // Codex P0: surface the engine error verbatim. The banner /
        // empty-state UI inspects `error` to decide what to render.
        _emit({
          ..._cached,
          isLoading: false,
          error: r.error || 'Failed to load scheduled tasks',
        });
      }
    })
    .catch((err: any) => {
      _emit({
        ..._cached,
        isLoading: false,
        error: err?.message || 'Failed to load scheduled tasks',
      });
    });
}

export function useScheduledTasks(): ScheduledTasksState {
  _ensureInitialized();
  const [state, setState] = useState<ScheduledTasksState>(_cached);
  useEffect(() => {
    _listeners.add(setState);
    // Resync to whatever's current in case we missed an update between
    // mount and effect run (same pattern as useEngineState).
    setState(_cached);
    return () => { _listeners.delete(setState); };
  }, []);
  return state;
}

/**
 * Mutator helper for tab-local optimistic state. Components apply the
 * patch locally (instant UI), POST/PATCH to the engine, then the WS
 * broadcast comes through and reconciles. If the PATCH response lands
 * BEFORE the broadcast we also reconcile from it via this helper.
 *
 * This is a pure cache update — does not hit the network. Pass the
 * full updated task or use it inside the helpers below for common
 * shapes.
 */
export function applyOptimisticTaskUpdate(task: ScheduledTask) {
  _ensureInitialized();
  const next = _cached.tasks.map((t) => (t.id === task.id ? task : t));
  if (next.some((t) => t.id === task.id)) {
    _emit({ ..._cached, tasks: next });
  }
}

export function applyOptimisticTaskInsert(task: ScheduledTask) {
  _ensureInitialized();
  if (_cached.tasks.some((t) => t.id === task.id)) return;
  _emit({ ..._cached, tasks: [..._cached.tasks, task] });
}

export function applyOptimisticTaskRemove(id: string) {
  _ensureInitialized();
  if (!_cached.tasks.some((t) => t.id === id)) return;
  _emit({ ..._cached, tasks: _cached.tasks.filter((t) => t.id !== id) });
}
