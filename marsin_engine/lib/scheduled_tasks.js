/**
 * lib/scheduled_tasks.js
 *
 * Engine-owned scheduler. Each task binds to a library (effectId,
 * presetId, params?) and owns its own effect instance — independent
 * of the 6/16 visible GEM slots. Canonical use case: "hazer 10s every
 * 1m" — the operator describes the cadence once and walks away.
 *
 * Architecture (docs/31_scheduled_tasks.md v3):
 *   - In-memory task list. Operator-authored fields persisted to
 *     `states/<model>/scheduled_tasks.yaml`. Runtime fields rebuilt
 *     on boot (no replay of missed fires — codex P0).
 *   - ONE setInterval at 250ms cadence for the whole module.
 *   - Dispatch via `GlobalEffectSlotManager.dispatchEffectAction({
 *     effectId, presetId, action, params })` — slot-less direct
 *     route, no GEM slot reservation. Two tasks pointing at the
 *     same effect+preset fire as independent instances.
 *   - Behaviors:
 *       toggle:        ON='activate', OFF='deactivate'
 *       hold:          ON='down',     OFF='up'
 *       trigger/burst: ON='trigger',  OFF=(no dispatch — self-terminates)
 *   - Broadcasts `{type:'scheduledTasks', tasks:[...]}` on every state
 *     change (create/patch/delete/fire/stop/error).
 *
 * Codex P0:
 *   - Off-preset `onDurationMs`/`intervalMs` → ValidationError (400).
 *   - `mode !== 'duration'` → ValidationError (400).
 *   - Missing effectId in library at create/PATCH → ValidationError (400).
 *   - Missing presetId in effect at create/PATCH → ValidationError (400).
 *   - PATCH of `effectId` without `presetId` (or vice versa) → 400.
 *   - Missing effect/preset at fire time → status='error', loud lastError,
 *     persisted task stays (operator fixes or deletes).
 *   - Missing YAML file on boot → empty list (no file creation).
 *   - Legacy v2 yaml with `slotId` row → dropped with a once-per-row
 *     warning (no migration; the v2 schema is irreconcilable with v3).
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

import yaml from 'js-yaml';

import { GLOBAL_EFFECT_LIBRARY } from './global_effect_library.js';

// ── Preset arrays (frozen at v2 design time, carried into v3) ────────
export const ON_DURATION_PRESETS_MS = Object.freeze([
  1_000, 2_000, 5_000, 10_000, 15_000, 30_000, 60_000,
  120_000,   // 2m
  180_000,   // 3m
  240_000,   // 4m
  300_000,   // 5m
  600_000,   // 10m
]);

export const INTERVAL_PRESETS_MS = Object.freeze([
  5_000,     // 5s
  10_000,    // 10s
  15_000,    // 15s
  30_000,    // 30s
  60_000,    // 1m
  120_000,   // 2m
  300_000,   // 5m
  600_000,   // 10m
  900_000,   // 15m
  1_800_000, // 30m
  3_600_000, // 1h
]);

const SCHEDULER_TICK_MS = 250;
const SCHEDULED_TASKS_FILENAME = 'scheduled_tasks.yaml';
const MAX_LABEL_LEN = 80;
const MAX_PARAMS_KEYS = 32;

const ALLOWED_PATCH_FIELDS = new Set([
  'label', 'effectId', 'presetId', 'params', 'enabled', 'onDurationMs', 'intervalMs',
]);

// Behavior → wire-action map. trigger/burst share the ON verb
// 'trigger' and have NO OFF verb (self-terminating; OFF would
// double-fire).
const BEHAVIOR_ACTIONS = Object.freeze({
  toggle:  { on: 'activate', off: 'deactivate' },
  hold:    { on: 'down',     off: 'up' },
  trigger: { on: 'trigger',  off: null },
  burst:   { on: 'trigger',  off: null },
});

/**
 * Thrown by validation methods. Caller (API endpoint) maps to HTTP 400.
 */
export class ScheduledTaskValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ScheduledTaskValidationError';
  }
}

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function validatePreset(field, value, presets) {
  if (!isFiniteNumber(value) || !presets.includes(value)) {
    throw new ScheduledTaskValidationError(
      `${field} must be one of [${presets.join(', ')}] (got ${JSON.stringify(value)})`
    );
  }
}

function validateMode(value) {
  if (value !== 'duration') {
    throw new ScheduledTaskValidationError(
      `mode must be 'duration' (got ${JSON.stringify(value)})`
    );
  }
}

function validateLabel(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_LABEL_LEN) {
    throw new ScheduledTaskValidationError(
      `label must be a non-empty string up to ${MAX_LABEL_LEN} chars (got ${JSON.stringify(value)})`
    );
  }
}

function validateNonEmptyString(field, value) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ScheduledTaskValidationError(
      `${field} must be a non-empty string (got ${JSON.stringify(value)})`
    );
  }
}

/**
 * Validate `params` is a JSON-serialisable record of primitive values.
 * Per docs/31 the override map is `Record<string, number|boolean|string>`.
 * Reject arrays, nested objects, and non-finite numbers.
 */
function validateParamsShape(value) {
  if (value === undefined || value === null) return;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new ScheduledTaskValidationError(
      `params must be an object of primitive values (got ${JSON.stringify(value)})`
    );
  }
  const keys = Object.keys(value);
  if (keys.length > MAX_PARAMS_KEYS) {
    throw new ScheduledTaskValidationError(
      `params has too many keys (${keys.length} > ${MAX_PARAMS_KEYS})`
    );
  }
  for (const k of keys) {
    const v = value[k];
    if (v === null) continue;
    const t = typeof v;
    if (t === 'number') {
      if (!Number.isFinite(v)) {
        throw new ScheduledTaskValidationError(
          `params.${k} must be finite (got ${JSON.stringify(v)})`
        );
      }
      continue;
    }
    if (t === 'boolean' || t === 'string') continue;
    throw new ScheduledTaskValidationError(
      `params.${k} must be number|boolean|string (got ${JSON.stringify(v)})`
    );
  }
}

/**
 * Verify (effectId, presetId) exist in the engine's effect library.
 * Per docs/31 §"Validation": rejecting at create/PATCH so the operator
 * can't end up with a task that points at nothing. The runtime-missing
 * case (library rebuilt and dropped the effect AFTER task creation) is
 * handled at fire time with status='error'.
 */
function validateLibraryBinding(effectId, presetId, library) {
  const effect = library[effectId];
  if (!effect) {
    throw new ScheduledTaskValidationError(
      `unknown effectId '${effectId}' (not present in global effect library)`
    );
  }
  const preset = effect.presets && effect.presets[presetId];
  if (!preset) {
    throw new ScheduledTaskValidationError(
      `unknown presetId '${presetId}' for effect '${effectId}'`
    );
  }
}

/**
 * Atomic file write: temp file in the same directory, then rename. Same
 * write pattern is used by other engine state files via fs.writeFileSync,
 * but for the scheduler we go one step further with temp+rename so a
 * concurrent reader can never see a partial file.
 */
function atomicWriteFileSync(filePath, contents) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(filePath)}.tmp-${process.pid}-${Date.now()}`);
  fs.writeFileSync(tmp, contents);
  fs.renameSync(tmp, filePath);
}

export class ScheduledTaskService {
  /**
   * @param {object} opts
   * @param {string} opts.stateDir              — directory holding scheduled_tasks.yaml
   * @param {object|null} opts.slotManager      — GlobalEffectSlotManager (may be null for unit tests)
   * @param {(msg:object)=>void} opts.broadcast — WS broadcaster
   * @param {(args:{effectId:string, presetId:string, action:string, params:object, nowMs:number, frameIndex:number, behavior:string})=>void} [opts.dispatch]
   *        — engine-side effect-action sink. Defaults to slotManager.dispatchEffectAction.
   * @param {object} [opts.library]             — effect library (default GLOBAL_EFFECT_LIBRARY)
   * @param {()=>number} [opts.nowFn]           — clock (default Date.now). Injected for tests.
   * @param {()=>string} [opts.randomIdFn]      — UUID generator (default randomUUID). Injected for tests.
   * @param {()=>number} [opts.getFrameIndex]   — engine frame counter (default ()=>0).
   * @param {number} [opts.tickMs]              — tick cadence (default 250 ms).
   */
  constructor({
    stateDir,
    slotManager,
    broadcast,
    dispatch,
    library,
    nowFn,
    randomIdFn,
    getFrameIndex,
    tickMs,
  }) {
    if (typeof stateDir !== 'string' || !stateDir) {
      throw new Error('ScheduledTaskService: stateDir is required');
    }
    if (typeof broadcast !== 'function') {
      throw new Error('ScheduledTaskService: broadcast is required');
    }
    this.stateDir = stateDir;
    this.slotManager = slotManager || null;
    this.broadcast = broadcast;
    this.library = library || GLOBAL_EFFECT_LIBRARY;
    this.dispatch = dispatch || ((args) => {
      if (!this.slotManager) throw new Error('no slotManager configured');
      this.slotManager.dispatchEffectAction(args);
    });
    this.nowFn = nowFn || Date.now;
    this.randomIdFn = randomIdFn || (() => crypto.randomUUID());
    this.getFrameIndex = getFrameIndex || (() => 0);
    this.tickMs = tickMs || SCHEDULER_TICK_MS;

    this.tasks = [];
    this._tickHandle = null;
  }

  // ── lifecycle ──────────────────────────────────────────────────────

  /**
   * Load tasks from disk + reconstruct runtime state. Per docs/31
   * §"Restart behavior": never resume an interrupted ON window, never
   * replay missed fires. If the YAML file is missing, start with an
   * empty list (no file creation — codex P0).
   *
   * v2→v3 migration: rows with the legacy `slotId` field are dropped
   * with a one-shot warning per row. There is no implicit coercion —
   * the v2 schema bound to a GEM slot, the v3 schema binds to a
   * library entry, and a slotId number alone can't legally name a
   * library entry (the slot manager's bindings live in a separate
   * file the user could have edited since).
   */
  loadFromDisk() {
    const filePath = this._yamlPath();
    if (!fs.existsSync(filePath)) {
      this.tasks = [];
      return;
    }
    let parsed;
    try {
      parsed = yaml.load(fs.readFileSync(filePath, 'utf8'));
    } catch (err) {
      throw new Error(`Failed to parse ${SCHEDULED_TASKS_FILENAME}: ${err.message}`);
    }
    const list = parsed && Array.isArray(parsed.scheduledTasks)
      ? parsed.scheduledTasks
      : [];
    const now = this.nowFn();
    const tasks = [];
    let droppedLegacy = false;
    for (const raw of list) {
      if (raw && typeof raw === 'object'
          && raw.slotId !== undefined
          && (raw.effectId === undefined || raw.presetId === undefined)) {
        // Legacy v2 row. Drop loudly.
        console.warn(
          `scheduled_tasks.yaml: dropping legacy slotId-bound row ${JSON.stringify(raw.id)} ` +
          `— v2→v3 schema change, no migration`
        );
        droppedLegacy = true;
        continue;
      }
      tasks.push(this._reconstructTask(raw, now));
    }
    this.tasks = tasks;

    // Singleton boot-time conflict resolution. If the YAML file has
    // two or more enabled tasks on the same singleton effect (e.g.
    // it was edited by hand, or written before this check existed),
    // keep the FIRST and force-disable the rest with a one-shot
    // warning. We don't crash the boot — the rig coming up is more
    // important than punishing a stale file — but we make it loud
    // so the operator notices and fixes it.
    const seenSingletonEffects = new Set();
    let demotedAny = false;
    for (const t of this.tasks) {
      if (!t.enabled) continue;
      const entry = this.library && this.library[t.effectId];
      if (!entry || !entry.singleton) continue;
      if (seenSingletonEffects.has(t.effectId)) {
        console.warn(
          `scheduled_tasks.yaml: singleton collision on effect '${t.effectId}'; ` +
          `force-disabling task '${t.label}' (id ${t.id}). ` +
          `Re-enable manually after deciding which row owns the effect.`
        );
        t.enabled = false;
        t.status = 'disabled';
        t.nextFireAtMs = null;
        t.firingUntilMs = null;
        demotedAny = true;
      } else {
        seenSingletonEffects.add(t.effectId);
      }
    }

    // Re-persist if we dropped any legacy rows OR demoted any singleton
    // conflicts, so the file matches the in-memory state on the very
    // next read.
    if (droppedLegacy || demotedAny) this._persist();
  }

  start() {
    if (this._tickHandle) return;
    this._tickHandle = setInterval(() => this._tickOnce(this.nowFn()), this.tickMs);
    // setInterval keeps node alive — fine for engine boot but if a test
    // spins this up it should call stopTick(). No unref here on purpose.
  }

  stopTick() {
    if (this._tickHandle) {
      clearInterval(this._tickHandle);
      this._tickHandle = null;
    }
  }

  // ── CRUD ───────────────────────────────────────────────────────────

  list() {
    return this.tasks.map(t => this._serialize(t));
  }

  get(id) {
    const t = this.tasks.find(t => t.id === id);
    return t ? this._serialize(t) : null;
  }

  /**
   * Library effects flagged `singleton: true` can only have ONE
   * enabled task at a time. The controller only tracks one runtime
   * state per singleton (strobeActive, colorWashConfig, fogger flag,
   * etc.), so two enabled rows on the same singleton step on each
   * other: row A's OFF dispatch kills row B's "firing" state silently.
   *
   * Returns the conflicting task or null. `selfId` is excluded so a
   * PATCH on an existing task doesn't see itself as the conflict.
   */
  _findSingletonConflict(effectId, selfId) {
    const entry = this.library && this.library[effectId];
    if (!entry || !entry.singleton) return null;
    for (const t of this.tasks) {
      if (t.id === selfId) continue;
      if (!t.enabled) continue;
      if (t.effectId === effectId) return t;
    }
    return null;
  }

  /**
   * Create a new task. Body shape per docs/31 §"POST body". Throws
   * ScheduledTaskValidationError on bad input.
   */
  create(input) {
    if (!input || typeof input !== 'object') {
      throw new ScheduledTaskValidationError('body must be an object');
    }
    validateNonEmptyString('effectId', input.effectId);
    validateNonEmptyString('presetId', input.presetId);
    validateLibraryBinding(input.effectId, input.presetId, this.library);
    validateParamsShape(input.params);
    // Label defaults to "<effectId> / <presetId>" if the operator
    // doesn't supply one (docs/31 §"Data shape").
    const label = (input.label === undefined || input.label === null)
      ? `${input.effectId} / ${input.presetId}`
      : input.label;
    validateLabel(label);
    if (typeof input.enabled !== 'boolean') {
      throw new ScheduledTaskValidationError(
        `enabled must be boolean (got ${JSON.stringify(input.enabled)})`
      );
    }
    validateMode(input.mode);
    validatePreset('onDurationMs', input.onDurationMs, ON_DURATION_PRESETS_MS);
    validatePreset('intervalMs',   input.intervalMs,   INTERVAL_PRESETS_MS);

    // Singleton effects (strobe, fogger, vintageWhite, blastWhite,
    // uvBlast, colorWash, feedbackTrails) can only have ONE enabled
    // task at a time. See _findSingletonConflict for the rationale.
    if (input.enabled) {
      const conflict = this._findSingletonConflict(input.effectId, null);
      if (conflict) {
        throw new ScheduledTaskValidationError(
          `effect '${input.effectId}' is a singleton; already scheduled by enabled task '${conflict.label}' (id ${conflict.id}). ` +
          `Disable or delete that task first, or create this one with enabled:false.`
        );
      }
    }

    const now = this.nowFn();
    const task = {
      id: this.randomIdFn(),
      label,
      effectId: input.effectId,
      presetId: input.presetId,
      params: input.params ? { ...input.params } : null,
      enabled: !!input.enabled,
      mode: 'duration',
      onDurationMs: input.onDurationMs,
      intervalMs: input.intervalMs,
      nextFireAtMs: input.enabled ? now + input.intervalMs : null,
      firingUntilMs: null,
      lastFiredAtMs: null,
      lastStoppedAtMs: null,
      status: input.enabled ? 'armed' : 'disabled',
      lastError: null,
      lastMissedAtMs: null,
      createdAtMs: now,
      updatedAtMs: now,
    };
    this.tasks.push(task);
    this._persist();
    this._broadcastAll();
    return this._serialize(task);
  }

  /**
   * Patch operator-authored fields only. Runtime fields are NOT
   * patchable — attempting to set one raises ValidationError so a
   * misuse fails loudly rather than silently dropping (codex P0).
   *
   * `effectId` and `presetId` must be patched together. The old
   * presetId key has no meaning on a new effect.
   */
  patch(id, input) {
    const task = this.tasks.find(t => t.id === id);
    if (!task) {
      throw new ScheduledTaskValidationError(`task not found: ${id}`);
    }
    if (!input || typeof input !== 'object') {
      throw new ScheduledTaskValidationError('body must be an object');
    }
    const keys = Object.keys(input);
    for (const k of keys) {
      if (!ALLOWED_PATCH_FIELDS.has(k)) {
        throw new ScheduledTaskValidationError(
          `field '${k}' is not patchable (allowed: ${[...ALLOWED_PATCH_FIELDS].join(', ')})`
        );
      }
    }

    // effectId/presetId must move as a pair.
    const hasEffect = 'effectId' in input;
    const hasPreset = 'presetId' in input;
    if (hasEffect !== hasPreset) {
      throw new ScheduledTaskValidationError(
        `effectId and presetId must be patched together (got ${
          hasEffect ? 'effectId without presetId' : 'presetId without effectId'
        })`
      );
    }

    const next = { ...task };
    if (hasEffect) {
      validateNonEmptyString('effectId', input.effectId);
      validateNonEmptyString('presetId', input.presetId);
      validateLibraryBinding(input.effectId, input.presetId, this.library);
      next.effectId = input.effectId;
      next.presetId = input.presetId;
    }
    if ('params' in input) {
      validateParamsShape(input.params);
      next.params = input.params ? { ...input.params } : null;
    }
    if ('label'        in input) { validateLabel(input.label); next.label = input.label; }
    if ('enabled'      in input) {
      if (typeof input.enabled !== 'boolean') {
        throw new ScheduledTaskValidationError(
          `enabled must be boolean (got ${JSON.stringify(input.enabled)})`
        );
      }
      next.enabled = input.enabled;
    }
    if ('onDurationMs' in input) { validatePreset('onDurationMs', input.onDurationMs, ON_DURATION_PRESETS_MS); next.onDurationMs = input.onDurationMs; }
    if ('intervalMs'   in input) { validatePreset('intervalMs',   input.intervalMs,   INTERVAL_PRESETS_MS);    next.intervalMs   = input.intervalMs; }

    // Singleton collision check. Reject if the post-patch state would
    // produce two enabled tasks on the same singleton effect. Excludes
    // self (`task.id`) so a row patching its own fields doesn't trip
    // the check against itself.
    if (next.enabled) {
      const conflict = this._findSingletonConflict(next.effectId, task.id);
      if (conflict) {
        throw new ScheduledTaskValidationError(
          `effect '${next.effectId}' is a singleton; already scheduled by enabled task '${conflict.label}' (id ${conflict.id}). ` +
          `Disable or delete that task first.`
        );
      }
    }

    const now = this.nowFn();
    const wasFiring  = task.firingUntilMs !== null;
    const wasEnabled = task.enabled;

    // Apply mutation
    Object.assign(task, next);
    task.updatedAtMs = now;

    // Re-derive runtime state from the patch
    if (!task.enabled) {
      // Disabling. If we were firing AND the (pre-mutation) behavior had
      // an OFF action, close the ON window immediately. Look up the OFF
      // action against the NEW binding — that matches the engine's
      // current dispatch state.
      if (wasFiring) {
        this._safeDispatchOff(task);
        task.firingUntilMs = null;
        task.lastStoppedAtMs = now;
      }
      task.nextFireAtMs = null;
      task.status = 'disabled';
      task.lastError = null;
    } else {
      // Enabled (or stays enabled).
      if (!wasEnabled) {
        // Newly enabled: schedule one interval out.
        task.nextFireAtMs = now + task.intervalMs;
        task.status = 'armed';
        task.lastError = null;
      } else if ('intervalMs' in input) {
        // Re-base off the last OFF time (or creation if never fired)
        // so the wait-gap semantics hold under live interval edits.
        // If currently firing, leave nextFireAtMs null — the tick's
        // OFF branch will compute it with the new intervalMs.
        if (task.firingUntilMs === null) {
          const base = task.lastStoppedAtMs ?? task.createdAtMs;
          task.nextFireAtMs = base + task.intervalMs;
        }
        if (task.status === 'error') {
          task.status = 'armed';
          task.lastError = null;
        }
      }
    }

    this._persist();
    this._broadcastAll();
    return this._serialize(task);
  }

  delete(id) {
    const idx = this.tasks.findIndex(t => t.id === id);
    if (idx === -1) {
      throw new ScheduledTaskValidationError(`task not found: ${id}`);
    }
    const task = this.tasks[idx];
    // Anti-strand: if the row was firing, send the OFF before removing.
    // For trigger/burst behaviors there is no OFF — _safeDispatchOff
    // is a no-op for those cases.
    if (task.firingUntilMs !== null) {
      this._safeDispatchOff(task);
    }
    this.tasks.splice(idx, 1);
    this._persist();
    this._broadcastAll();
  }

  fireNow(id) {
    const task = this.tasks.find(t => t.id === id);
    if (!task) {
      throw new ScheduledTaskValidationError(`task not found: ${id}`);
    }
    const now = this.nowFn();
    // If currently firing, force-stop first so the new ON window starts
    // clean. Without this, lastFiredAtMs would shift but firingUntilMs
    // would still reflect the old OFF time → a confusing tail.
    if (task.firingUntilMs !== null) {
      this._safeDispatchOff(task);
      task.firingUntilMs = null;
      task.lastStoppedAtMs = now;
    }
    task.nextFireAtMs = now;
    task.updatedAtMs = now;
    // Force-fire via the tick so all the error handling stays in one
    // place (missing effect, dispatch throw, etc).
    this._tryFire(task, now);
    this._persist();
    this._broadcastAll();
    return this._serialize(task);
  }

  /**
   * Force-close an in-flight ON window WITHOUT disabling the task.
   * Re-bases nextFireAtMs off lastStoppedAtMs (interval is the wait
   * gap between OFF and the next ON — same semantics as the tick's
   * natural close).
   */
  stop(id) {
    const task = this.tasks.find(t => t.id === id);
    if (!task) {
      throw new ScheduledTaskValidationError(`task not found: ${id}`);
    }
    if (task.firingUntilMs === null) {
      // Not firing — nothing to stop. Return current state idempotently;
      // callers tolerate this rather than treating it as an error.
      return this._serialize(task);
    }
    const now = this.nowFn();
    this._safeDispatchOff(task);
    task.firingUntilMs = null;
    task.lastStoppedAtMs = now;
    if (task.enabled) {
      task.nextFireAtMs = now + task.intervalMs;
      task.status = 'armed';
    }
    task.updatedAtMs = now;
    this._persist();
    this._broadcastAll();
    return this._serialize(task);
  }

  // ── tick ───────────────────────────────────────────────────────────

  /**
   * Single scheduler tick. Public-ish so unit tests can drive it
   * deterministically with an injected `nowFn` rather than wall clock.
   */
  _tickOnce(now) {
    let changed = false;
    for (const task of this.tasks) {
      if (!task.enabled) continue;

      // 1. Close any ON window whose duration has elapsed.
      if (task.firingUntilMs !== null && now >= task.firingUntilMs) {
        // For trigger/burst the OFF dispatch is a no-op (handled inside
        // _safeDispatchOff via BEHAVIOR_ACTIONS lookup) — the row still
        // transitions firing→armed so the UI countdown clears.
        this._safeDispatchOff(task);
        task.firingUntilMs = null;
        task.lastStoppedAtMs = now;
        // Interval is the WAIT GAP between an OFF and the next ON,
        // not the period from one ON to the next. Operator request
        // 2026-05-28: a {duration:5, interval:5} row should run
        // 5s on / 5s off / 5s on / 5s off — not 5s on / instant on.
        // Re-base off lastStoppedAtMs (== now in this branch) so
        // duration + interval are independent.
        task.nextFireAtMs = now + task.intervalMs;
        if (task.status !== 'error') task.status = 'armed';
        task.updatedAtMs = now;
        changed = true;
      }

      // 2. Open a new ON window if we've reached nextFireAtMs.
      if (task.nextFireAtMs !== null && task.firingUntilMs === null && now >= task.nextFireAtMs) {
        if (this._tryFire(task, now)) changed = true;
      }
    }
    if (changed) {
      this._persist();
      this._broadcastAll();
    }
  }

  /**
   * Resolve the library entry for a task without touching the slot pool.
   * Returns { effect, preset, behavior } or null with a side-effect of
   * setting status='error' / lastError on the task per codex P0.
   */
  _resolveTask(task, now) {
    const effect = this.library[task.effectId];
    if (!effect) {
      task.status = 'error';
      task.lastError = `effect '${task.effectId}' missing from library`;
      task.lastMissedAtMs = now;
      task.nextFireAtMs = now + task.intervalMs;
      task.updatedAtMs = now;
      return null;
    }
    const preset = effect.presets && effect.presets[task.presetId];
    if (!preset) {
      task.status = 'error';
      task.lastError = `preset '${task.effectId}/${task.presetId}' missing from library`;
      task.lastMissedAtMs = now;
      task.nextFireAtMs = now + task.intervalMs;
      task.updatedAtMs = now;
      return null;
    }
    const behavior = preset.defaultBehavior;
    if (!BEHAVIOR_ACTIONS[behavior]) {
      task.status = 'error';
      task.lastError = `behavior '${behavior}' on '${task.effectId}/${task.presetId}' is not supported by the scheduler`;
      task.lastMissedAtMs = now;
      task.nextFireAtMs = now + task.intervalMs;
      task.updatedAtMs = now;
      return null;
    }
    return { effect, preset, behavior };
  }

  /**
   * Attempt to fire the ON action. Returns true if state changed.
   * On missing effect/preset / dispatch failure, sets status='error'
   * and re-schedules nextFireAtMs one interval out so the row keeps
   * trying (per docs/31 §"Scheduler tick" pseudocode).
   */
  _tryFire(task, now) {
    const resolved = this._resolveTask(task, now);
    if (!resolved) return true; // error already set on task
    const actions = BEHAVIOR_ACTIONS[resolved.behavior];
    try {
      this.dispatch({
        effectId: task.effectId,
        presetId: task.presetId,
        action: actions.on,
        params: task.params ? { ...task.params } : {},
        behavior: resolved.behavior,
        nowMs: now,
        frameIndex: this.getFrameIndex(),
      });
    } catch (err) {
      task.status = 'error';
      task.lastError = `dispatch failed: ${err.message}`;
      task.lastMissedAtMs = now;
      task.nextFireAtMs = now + task.intervalMs;
      task.updatedAtMs = now;
      return true;
    }
    task.lastFiredAtMs = now;
    task.firingUntilMs = now + task.onDurationMs;
    task.status = 'firing';
    task.lastError = null;
    task.updatedAtMs = now;
    return true;
  }

  /**
   * Dispatch the OFF action and swallow errors — the OFF path runs in
   * tick / disable / delete / stop contexts where we don't want a
   * throwing dispatcher to bury subsequent tasks or corrupt state.
   * Still records the error on the row so the operator sees it.
   *
   * For trigger/burst behaviors there is no OFF action — this is a
   * no-op (the row transitions firing→armed in the caller).
   */
  _safeDispatchOff(task) {
    const now = this.nowFn();
    const effect = this.library[task.effectId];
    if (!effect) {
      task.lastError = `effect '${task.effectId}' missing from library (OFF skipped)`;
      task.status = 'error';
      return;
    }
    const preset = effect.presets && effect.presets[task.presetId];
    if (!preset) {
      task.lastError = `preset '${task.effectId}/${task.presetId}' missing from library (OFF skipped)`;
      task.status = 'error';
      return;
    }
    const behavior = preset.defaultBehavior;
    const actions = BEHAVIOR_ACTIONS[behavior];
    if (!actions || actions.off === null) {
      // trigger/burst self-terminate — no OFF wire dispatch.
      return;
    }
    try {
      this.dispatch({
        effectId: task.effectId,
        presetId: task.presetId,
        action: actions.off,
        params: task.params ? { ...task.params } : {},
        behavior,
        nowMs: now,
        frameIndex: this.getFrameIndex(),
      });
    } catch (err) {
      task.lastError = `OFF dispatch failed: ${err.message}`;
      task.status = 'error';
    }
  }

  // ── persistence ────────────────────────────────────────────────────

  _yamlPath() {
    return path.join(this.stateDir, SCHEDULED_TASKS_FILENAME);
  }

  _persist() {
    const payload = {
      scheduledTasks: this.tasks.map(t => {
        const row = {
          id: t.id,
          label: t.label,
          effectId: t.effectId,
          presetId: t.presetId,
          enabled: t.enabled,
          mode: t.mode,
          onDurationMs: t.onDurationMs,
          intervalMs: t.intervalMs,
        };
        // Only persist `params` if the operator supplied any — keep
        // the YAML clean and forward-compatible with rows that have
        // no overrides.
        if (t.params && Object.keys(t.params).length > 0) {
          row.params = { ...t.params };
        }
        return row;
      }),
    };
    atomicWriteFileSync(this._yamlPath(), yaml.dump(payload));
  }

  _broadcastAll() {
    this.broadcast({ type: 'scheduledTasks', tasks: this.list() });
  }

  // ── helpers ────────────────────────────────────────────────────────

  _reconstructTask(raw, now) {
    // Validate persisted fields just like a fresh create — if the YAML
    // was hand-edited into an off-preset value, we want a loud boot
    // failure, not a silent acceptance (codex P0).
    if (!raw || typeof raw !== 'object') {
      throw new Error(`Invalid scheduled task entry: ${JSON.stringify(raw)}`);
    }
    if (typeof raw.id !== 'string' || !raw.id) {
      throw new Error(`scheduled task missing id: ${JSON.stringify(raw)}`);
    }
    validateNonEmptyString('effectId', raw.effectId);
    validateNonEmptyString('presetId', raw.presetId);
    validateLibraryBinding(raw.effectId, raw.presetId, this.library);
    validateParamsShape(raw.params);
    validateLabel(raw.label);
    validateMode(raw.mode);
    validatePreset('onDurationMs', raw.onDurationMs, ON_DURATION_PRESETS_MS);
    validatePreset('intervalMs',   raw.intervalMs,   INTERVAL_PRESETS_MS);
    if (typeof raw.enabled !== 'boolean') {
      throw new Error(`scheduled task '${raw.id}' enabled must be boolean`);
    }
    return {
      id: raw.id,
      label: raw.label,
      effectId: raw.effectId,
      presetId: raw.presetId,
      params: raw.params ? { ...raw.params } : null,
      enabled: raw.enabled,
      mode: 'duration',
      onDurationMs: raw.onDurationMs,
      intervalMs: raw.intervalMs,
      nextFireAtMs: raw.enabled ? now + raw.intervalMs : null,
      firingUntilMs: null,
      lastFiredAtMs: null,
      lastStoppedAtMs: null,
      status: raw.enabled ? 'armed' : 'disabled',
      lastError: null,
      lastMissedAtMs: null,
      createdAtMs: now,
      updatedAtMs: now,
    };
  }

  _serialize(task) {
    // Defensive copy so external mutation can't corrupt internal state.
    return {
      ...task,
      params: task.params ? { ...task.params } : null,
    };
  }
}
