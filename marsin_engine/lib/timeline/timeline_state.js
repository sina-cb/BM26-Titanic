/*
 * timeline_state.js — runtime state persistence for the Timeline Companion.
 * Runtime (assignment) state lives under marsin_engine/states/<scene>/ per
 * docs/38 §3.6, NOT versioned. Writes are atomic (temp file + renameSync) so a
 * crash mid-write never leaves a half-written state file.
 *
 * A MISSING file is the only non-error path → a fresh default state (boot must
 * always have a working runtime). The companion owns these fields; the pure
 * trigger evaluator (triggers.js) reads/returns the latch + mood bookkeeping.
 */
import fs from 'node:fs';
import path from 'node:path';

import yaml from 'js-yaml';

export const TIMELINE_STATE_FILE = 'timeline_state.yaml';

// `mode` ∈ armed | paused | holding | overridden.
export function defaultTimelineState() {
  return {
    activePlan: null,
    mode: 'armed',
    // Control-precedence layer (docs/38 §14): autopilot is the baseline,
    // controller is the derived active layer, activeProgram is the running show.
    autopilotEnabled: true,
    controller: 'autopilot',
    activeProgram: null,
    // Pending-program lease (docs/38 §16.5): when a program comes due while the
    // controller is in any MANUAL sub-state, a lease is ARMED instead of firing.
    // null = no lease. Armed shape:
    //   { cueId, label, action, armedAtMs, expiresAtMs }
    // The lease auto-starts the program at expiresAtMs (show goes on, I2), or the
    // operator ENABLEs (start now) / DISMISSes (cancel, latch firedToday) it.
    pendingProgram: null,
    currentPhase: null,
    currentMood: 'calm',
    lastFiredCueId: null,
    lastFiredAtMs: null,
    manualHoldUntilMs: null,
    firedToday: {},
    dayKey: null,
    prevMood: null,
    moodSince: 0,
    moodLastFire: {},
  };
}

/**
 * Load runtime state from <stateDir>/timeline_state.yaml. A missing file →
 * a fresh default state. A present-but-broken file THROWS (codex P0).
 *
 * @param {string} stateDir
 */
export function loadTimelineState(stateDir) {
  const filePath = path.join(stateDir, TIMELINE_STATE_FILE);
  let text;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return defaultTimelineState();
    throw new Error(`timeline state read failed (${filePath}): ${err.message}`);
  }
  let parsed;
  try {
    parsed = yaml.load(text);
  } catch (err) {
    throw new Error(`timeline state parse failed (${filePath}): ${err.message}`);
  }
  if (parsed === null || parsed === undefined) return defaultTimelineState();
  return parsed;
}

/**
 * Persist runtime state atomically: write to <file>.tmp then renameSync over
 * the target (rename is atomic on the same filesystem). Creates the state dir
 * if it does not yet exist.
 *
 * @param {object} state
 * @param {string} stateDir
 */
export function saveTimelineState(state, stateDir) {
  if (!fs.existsSync(stateDir)) fs.mkdirSync(stateDir, { recursive: true });
  const filePath = path.join(stateDir, TIMELINE_STATE_FILE);
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, yaml.dump(state, { lineWidth: 100, noRefs: true }), 'utf8');
  fs.renameSync(tmpPath, filePath);
  return state;
}
