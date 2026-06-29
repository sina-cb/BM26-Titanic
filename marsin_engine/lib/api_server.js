import http from 'http';
import os from 'os';
import { WebSocketServer } from 'ws';
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { Autopilot } from './autopilot.js';
import { StateManager, serializeChannel as serializeChannelForState } from './state_manager.js';
import { SnapshotManager, SnapshotLoadError } from './snapshot_manager.js';
import { ParamPresetManager, ParamPresetError } from './param_preset_manager.js';
import { PlaylistManager, PlaylistLoadError } from './playlist_manager.js';
import {
  validateModulationMapping,
} from './modulation_engine.js';
import { describeLibrary, GLOBAL_EFFECT_LIBRARY } from './global_effect_library.js';
import { validateSlotsConfig } from './global_effect_slot_manager.js';
import {
  ScheduledTaskService,
  ScheduledTaskValidationError,
  ON_DURATION_PRESETS_MS,
  INTERVAL_PRESETS_MS,
} from './scheduled_tasks.js';
import { topicForType, TOPICS } from './ws_topic_routing.js';
import { parsePatternDefaults } from './pattern_defaults.js';
import { UndoStack, UNDO_MAX } from './undo_stack.js';
import { DECK_OVERLAY_MAX } from './pattern_mixer.js';

/**
 * Validate a `viewSelection` payload before it reaches the mixer.
 * Per docs/27_[todo]_mixer_layer_view_selection.md §3.1 the API MUST
 * reject malformed shapes with 400 — silently coercing them would let
 * a typo brick the render loop into "everything masked to black".
 *
 * Returns { ok: true, value } on success (value is the normalized
 * object suitable for handing to mixer.setChannelViewSelection), or
 * { ok: false, error } on failure (error is a human-readable string
 * suitable for the 400 response body).
 */
export function validateViewSelection(vs) {
  if (vs === null || vs === undefined) {
    return { ok: true, value: { type: 'all', target: null, invert: false } };
  }
  if (typeof vs !== 'object' || Array.isArray(vs)) {
    return { ok: false, error: 'viewSelection must be an object' };
  }
  const type = vs.type;
  const target = vs.target;
  const invert = !!vs.invert;
  if (typeof type !== 'string') {
    return { ok: false, error: 'viewSelection.type must be a string' };
  }
  switch (type) {
    case 'all':
      if (target !== null && target !== undefined) {
        return { ok: false, error: "viewSelection.target must be null or omitted when type === 'all'" };
      }
      return { ok: true, value: { type: 'all', target: null, invert } };
    case 'group':
      if (typeof target !== 'string' || target.length === 0) {
        return { ok: false, error: "viewSelection.target must be a non-empty string when type === 'group'" };
      }
      return { ok: true, value: { type: 'group', target, invert } };
    case 'section':
      if (!Number.isInteger(target)) {
        return { ok: false, error: "viewSelection.target must be an integer when type === 'section'" };
      }
      return { ok: true, value: { type: 'section', target, invert } };
    case 'fixture':
      if (!Number.isInteger(target)) {
        return { ok: false, error: "viewSelection.target must be an integer when type === 'fixture'" };
      }
      return { ok: true, value: { type: 'fixture', target, invert } };
    case 'viewMask':
      // Two shapes accepted:
      //   1. target: '<name>'  (preferred — resolved against the model's
      //      viewMasks dictionary at mask-compile time so operators
      //      pick by human label, not a bitmask integer).
      //   2. target: <positive int>  (legacy bitmask passthrough; kept so
      //      tests / programmatic clients can still drive raw bits
      //      without going through the model dictionary).
      if (typeof target === 'string') {
        if (target.length === 0) {
          return { ok: false, error: "viewSelection.target must be a non-empty string name when type === 'viewMask'" };
        }
        return { ok: true, value: { type: 'viewMask', target, invert } };
      }
      if (Number.isInteger(target) && target > 0) {
        return { ok: true, value: { type: 'viewMask', target, invert } };
      }
      return { ok: false, error: "viewSelection.target must be a non-empty string name OR a positive integer bitmask when type === 'viewMask'" };
    default:
      return { ok: false, error: `Unknown viewSelection.type '${type}' (expected: all | group | section | fixture | viewMask)` };
  }
}

// Range per Companion signal type. The Companion sends a `type`
// (intensity|frequency|bpm); the engine picks the canonical CPC range so
// the live key clamps correctly regardless of what the Companion claims.
const COMPANION_SIGNAL_RANGES = Object.freeze({
  intensity: [0, 1],
  frequency: [0, 8000],
  bpm:       [0, 300],
});

/**
 * Validate + normalize a POST /audio/signals/manifest body. The Companion
 * POSTs `{ signals: [{ cpcKey, address, label, type }] }`. We reject a
 * malformed manifest with a specific message (→ 400) rather than silently
 * dropping bad rows (Codex P0).
 *
 * Returns { ok: true, signals: [{ cpcKey, address, label, type, range }] }
 * (deduped, normalized) or { ok: false, error }.
 */
export function validateSignalManifest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'manifest must be an object with a "signals" array' };
  }
  const { signals } = body;
  if (!Array.isArray(signals)) {
    return { ok: false, error: 'manifest.signals must be an array' };
  }
  const out = [];
  const seenKeys = new Set();
  const seenAddrs = new Set();
  for (let i = 0; i < signals.length; i++) {
    const s = signals[i];
    if (!s || typeof s !== 'object' || Array.isArray(s)) {
      return { ok: false, error: `signals[${i}] must be an object` };
    }
    const { cpcKey, address, label, type } = s;
    if (typeof cpcKey !== 'string' || cpcKey.length === 0) {
      return { ok: false, error: `signals[${i}].cpcKey must be a non-empty string` };
    }
    if (typeof address !== 'string' || address.length === 0 || address[0] !== '/') {
      return { ok: false, error: `signals[${i}].address must be an OSC address starting with "/"` };
    }
    if (typeof type !== 'string' || !COMPANION_SIGNAL_RANGES[type]) {
      return { ok: false, error: `signals[${i}].type must be one of intensity|frequency|bpm` };
    }
    if (label !== undefined && typeof label !== 'string') {
      return { ok: false, error: `signals[${i}].label must be a string when present` };
    }
    if (seenKeys.has(cpcKey)) {
      return { ok: false, error: `duplicate cpcKey "${cpcKey}" in manifest` };
    }
    if (seenAddrs.has(address)) {
      return { ok: false, error: `duplicate address "${address}" in manifest` };
    }
    seenKeys.add(cpcKey);
    seenAddrs.add(address);
    const range = COMPANION_SIGNAL_RANGES[type];
    out.push({ cpcKey, address, label: label || cpcKey, type, range: [range[0], range[1]] });
  }
  return { ok: true, signals: out };
}

// ── Blend-mode validation (single source of truth) ─────────────────────
// A channel's `mode` is the compositing blend used to lay it over the
// layer beneath it. Two legitimate shapes:
//   1. A steady channel-blend script under patterns/channel_blends/.
//   2. A scripted transition under patterns/transitions/ (a `trans_*`
//      name), used transiently while a fade is in flight.
// Centralizing the accepted set here means the PATCH /mixer/channels/:id,
// PATCH /deck/channel, and /deck/transition-config paths can't drift apart
// (before this, each path open-coded its own `startsWith('trans_')` check
// or accepted anything). An unknown mode is rejected with 400 instead of
// being silently handed to the mixer (which would then composite it via
// the degraded host-side fallback — visible on /status, but better caught
// at the API boundary).
export const VALID_CHANNEL_BLEND_MODES = Object.freeze(new Set([
  'blend_screen',
  'blend_add',
  'blend_over',
]));

// True for any accepted channel mode: a known steady channel-blend, or a
// scripted transition (`trans_*`). Transition script existence is verified
// by the mixer at compile time; here we only gate the NAME shape so a typo
// like 'blend_scren' is rejected loudly.
export function isValidBlendMode(mode) {
  if (typeof mode !== 'string' || mode.length === 0) return false;
  if (VALID_CHANNEL_BLEND_MODES.has(mode)) return true;
  if (mode.startsWith('trans_')) return true;
  return false;
}

// ── Fader value validation (single source of truth) ────────────────────
// A fader is a normalized [0,1] gain. Every write path (mixer PATCH, deck
// PATCH, mixer master PATCH, WS setChannelFader) routes through this so a
// bad value can never reach the render loop. Codex P0 (no silent fallback):
// a non-finite value (NaN/Infinity, e.g. `Number('abc')`) is REJECTED with
// 400 — we do NOT coerce it to 0/1, because that masks a broken client. A
// finite-but-out-of-range value IS clamped to [0,1]: that's a benign
// saturation of a real intent (slider overshoot), not a malformed input.
//
// Returns { ok: true, value } with the clamped number on success, or
// { ok: false, error } (human-readable, suitable for a 400 body) when the
// input is not a finite number.
export function validateFader(raw) {
  // Only accept an actual number, or a string that parses to a finite
  // number. Reject null / undefined / boolean / object outright — JSON
  // coercion (Number(null)===0, Number(true)===1) would otherwise mask a
  // structurally-wrong payload as a valid fader (silent fallback, Codex P0).
  let n;
  if (typeof raw === 'number') {
    n = raw;
  } else if (typeof raw === 'string' && raw.trim() !== '') {
    n = Number(raw);
  } else {
    return { ok: false, error: `fader must be a finite number in [0,1], got '${raw}'` };
  }
  if (!Number.isFinite(n)) {
    return { ok: false, error: `fader must be a finite number in [0,1], got '${raw}'` };
  }
  return { ok: true, value: Math.max(0, Math.min(1, n)) };
}

// ── Hue value validation (single source of truth) ──────────────────────
// A hue is an angle in degrees. Every write path (per-channel PATCH, deck
// PATCH, POST /global-effect-hue) routes through this. Codex P0 (no silent
// fallback): a NON-FINITE value (NaN / Infinity, or a non-number /
// unparseable string) is REJECTED with 400 — we never coerce a broken
// payload to 0. A finite value (any magnitude, including negatives like
// -30 or wrap-arounds like 370) is NORMALIZED into the canonical [0,360)
// range via ((n % 360) + 360) % 360 — that's a real, benign intent (the
// hue wheel wraps), not a malformed input.
//
// Returns { ok: true, value } with the normalized angle on success, or
// { ok: false, error } (human-readable, suitable for a 400 body).
export function validateHue(raw) {
  let n;
  if (typeof raw === 'number') {
    n = raw;
  } else if (typeof raw === 'string' && raw.trim() !== '') {
    n = Number(raw);
  } else {
    return { ok: false, error: `hue must be a finite number of degrees, got '${raw}'` };
  }
  if (!Number.isFinite(n)) {
    return { ok: false, error: `hue must be a finite number of degrees, got '${raw}'` };
  }
  return { ok: true, value: ((n % 360) + 360) % 360 };
}

// ── Per-channel FOLLOW SCALE validation (docs/39 §F-follow, round-2 #6) ─
// A follower's followScale multiplies the leader's effective level before the
// follower's own caps. Accept/reject contract: a
// NON-FINITE value (NaN / Infinity, non-number / unparseable string) is
// REJECTED with 400 (Codex P0 — never coerce a broken payload to a default);
// a finite value is CLAMPED into [0,2] (a follower may run hotter than its
// leader up to 2×, but never negative — that would be a phase flip the follow
// semantics don't model). Mirrors the PatternChannel constructor clamp.
export function validateFollowScale(raw) {
  let n;
  if (typeof raw === 'number') {
    n = raw;
  } else if (typeof raw === 'string' && raw.trim() !== '') {
    n = Number(raw);
  } else {
    return { ok: false, error: `followScale must be a finite number in [0,2], got '${raw}'` };
  }
  if (!Number.isFinite(n)) {
    return { ok: false, error: `followScale must be a finite number in [0,2], got '${raw}'` };
  }
  return { ok: true, value: Math.max(0, Math.min(2, n)) };
}

// ── Per-pattern param SHARING — pure propagation core ─────────────────────
// (operator request, feat/optimize_channels)
//
// Given the SOURCE channel a control was just written on, mirror that SAME
// exported slider/param onto every OTHER live channel running the SAME pattern
// from the SAME playlist (deck base, mixer overlays, deck overlays). Extracted
// as a pure, dependency-injected function (no engine closure) so it is unit-
// testable in isolation; the api_server factory's `propagatePatternParam`
// wrapper supplies `mixer`/`wasmHost`/`paramRouter`.
//
// Keying is strict (mixer.channelsRunningPattern): playlist.name === L AND
// channel.pattern === P. Mapping is by export NAME (per-handle controlIds are
// not guaranteed identical across compiles): resolve the source export's name,
// then find the same-named export on each target and write THROUGH
// paramRouter.setChannelControl — which already rejects CPC-owned / CPC-blocked
// / non-local controls per target, so only the pattern's LOCAL sliders/params
// ever propagate (never fader/level/hue/mode — those are not pattern exports
// and never reach here). Returns the array of channel ids that actually
// received the value (status 'ok'); the source is never included.
export function propagatePatternParamWith({ source, sourceChannelId, controlId, v0, v1, v2, mixer, wasmHost, paramRouter }) {
  if (!source || !source.playlist || !source.playlist.name || !source.pattern) {
    // No (playlist, pattern) context on the source — nothing to share by.
    return [];
  }
  const playlistName = source.playlist.name;
  const patternName = source.pattern;

  const sourceExports = wasmHost.getExports(source.handle) || [];
  const sourceExp = sourceExports.find(e => e.id === controlId);
  if (!sourceExp) return [];
  const exportName = sourceExp.name;

  const targets = mixer.channelsRunningPattern(playlistName, patternName, { excludeId: sourceChannelId });
  const applied = [];
  for (const target of targets) {
    const targetExports = wasmHost.getExports(target.handle) || [];
    const targetExp = targetExports.find(e => e.name === exportName);
    if (!targetExp) continue; // pattern recompiled without this export — skip, never crash
    const result = paramRouter.setChannelControl(target.id, targetExp.id, v0, v1, v2);
    if (result && result.status === 'ok') applied.push(target.id);
  }
  return applied;
}

// ── Auto-cycle DELAY validation (docs/39 §auto-cycle, round-2 #2) ──────
// The interval (seconds) between automatic playlist advances on a mixer
// overlay channel. Codex P0 (no silent fallback): a NON-FINITE value (NaN /
// Infinity, non-number / unparseable string) OR a value ≤ 0 is REJECTED with
// 400 AUTOCYCLE_BAD_DELAY — we never coerce a broken/zero delay to a default
// (a 0 / negative interval would advance every frame = a strobe storm, which
// the codex forbids as a silent failure). A finite POSITIVE value is FLOORED
// to 1s (the only mutation — a benign floor, never a reject of an in-range
// number) so the cycle can never out-run a 50-200ms overlay compile. Rejects
// ≤0 instead of clamping it.
export function validateAutoCycleDelay(raw) {
  let n;
  if (typeof raw === 'number') {
    n = raw;
  } else if (typeof raw === 'string' && raw.trim() !== '') {
    n = Number(raw);
  } else {
    return { ok: false, error: `delay_s must be a finite number > 0, got '${raw}'` };
  }
  if (!Number.isFinite(n) || n <= 0) {
    return { ok: false, error: `delay_s must be a finite number > 0, got '${raw}'` };
  }
  return { ok: true, value: Math.max(1, n) };
}

// ── Auto-cycle DUE decision (pure, fake-clock unit-tested) ────────────
// Decides what the per-frame auto-cycle tick should do for ONE channel at
// wall-clock `nowMs`. Pure (no Date.now / no side effects) so a test can
// inject a fake clock instead of sleeping real seconds. Returns:
//   'skip' — not an active overlay (no playlist.name, autopilot absent or
//            inactive). Exterior immunity rides here: active defaults false.
//   'seed' — autopilot is active but the wall-clock anchor is not yet set
//            (first active frame, or post manual-tap / post-advance re-seed).
//            The caller seeds `_autoCycleLastAdvanceMs = nowMs` and does NOT
//            advance, so the first auto-advance lands a full delay_s later.
//   'wait' — active + seeded, but delay_s has not elapsed yet.
//   'due'  — active + seeded + delay_s elapsed: the caller picks the next
//            entry and advances. delay_s is floored to 1s (mirrors the
//            validator) so a stale/zero on-disk value can't strobe.
export function autoCycleDueDecision(channel, nowMs) {
  const ap = channel.playlist && channel.playlist.autopilot;
  if (!ap || !ap.active) return 'skip';
  if (!channel.playlist.name) return 'skip';
  if (channel._autoCycleLastAdvanceMs === null
      || channel._autoCycleLastAdvanceMs === undefined) return 'seed';
  const delayMs = Math.max(1, ap.delay_s) * 1000;
  return (nowMs - channel._autoCycleLastAdvanceMs >= delayMs) ? 'due' : 'wait';
}

// ── Auto-cycle group-locality clamps (single source of truth) ─────────
// PATTERN-GROUP LOCALITY (feat/optimize_channels): the autopilot grabs a
// small WINDOW of adjacent playlist entries, dwells within it for a number of
// swaps, then releases and grabs a fresh window. The window size and dwell
// count are clamped here so a stale/garbage on-disk value can't form a
// degenerate (1-wide) or runaway window. Defaults match the field docs.
export const AUTO_GROUP_SIZE_MIN = 2;
export const AUTO_GROUP_SIZE_MAX = 8;
export const AUTO_GROUP_SIZE_DEFAULT = 3;
export const AUTO_GROUP_DWELL_MIN = 1;
export const AUTO_GROUP_DWELL_MAX = 50;
export const AUTO_GROUP_DWELL_DEFAULT = 6;

const clampInt = (raw, lo, hi, dflt) => {
  const n = Number(raw);
  if (!Number.isFinite(n)) return dflt;
  return Math.max(lo, Math.min(hi, Math.trunc(n)));
};

// Normalize the three group-locality fields off any autopilot-ish object for
// serialize / broadcast / restore (single shape, single source of clamps).
// Absent fields default (off / 3 / 6), so an old state file restores clean.
const autoGroupFields = (ap) => ({
  groupMode: !!(ap && ap.groupMode),
  groupSize: clampInt(ap && ap.groupSize, AUTO_GROUP_SIZE_MIN, AUTO_GROUP_SIZE_MAX, AUTO_GROUP_SIZE_DEFAULT),
  groupDwell: clampInt(ap && ap.groupDwell, AUTO_GROUP_DWELL_MIN, AUTO_GROUP_DWELL_MAX, AUTO_GROUP_DWELL_DEFAULT),
});

// ── Auto-cycle next-entry pick (pure, unit-tested) ────────────────────
// MIRRORS the deck Autopilot advance pick (api_server deck daemon): when
// group-locality is armed, dwell within a window of adjacent entries, else
// shuffle picks a random OTHER usable entry, else sequential walks forward
// skipping `_missing`. `usable` excludes `_missing` entries.
// Returns the chosen entry, or null when there is nothing to advance to (no
// usable entries).
//
// PATTERN-GROUP LOCALITY: when `autopilot.groupMode` is true AND there are
// strictly more usable entries than the window size, dwell state lives in the
// caller-owned mutable `groupRuntime` ({ windowIds, swapsLeft }) so the window
// + remaining-swap count persist ACROSS advances. The function reads and
// MUTATES `groupRuntime` in place (the contract); randomness via Math.random
// matches shuffle. With group-locality off (default), or too few usable
// entries, group mode is a no-op and the existing shuffle/sequential logic
// runs unchanged — `groupRuntime` may be omitted by those callers.
export function pickNextAutoCycleEntry(pl, autopilot, curEntryId, groupRuntime) {
  if (!pl || !Array.isArray(pl.entries) || pl.entries.length === 0) return null;
  const usable = pl.entries.filter(e => !e._missing);
  if (usable.length === 0) return null;
  // PATTERN-GROUP LOCALITY: dwell inside a rolling window of adjacent usable
  // entries. No-op (fall through) unless armed AND the playlist is bigger than
  // one window — otherwise the "window" would be the whole list, defeating the
  // point. Needs a mutable runtime to carry dwell state across advances.
  const groupSize = clampInt(
    autopilot && autopilot.groupSize, AUTO_GROUP_SIZE_MIN, AUTO_GROUP_SIZE_MAX,
    AUTO_GROUP_SIZE_DEFAULT,
  );
  if (autopilot && autopilot.groupMode && groupRuntime && usable.length > groupSize) {
    const groupDwell = clampInt(
      autopilot.groupDwell, AUTO_GROUP_DWELL_MIN, AUTO_GROUP_DWELL_MAX,
      AUTO_GROUP_DWELL_DEFAULT,
    );
    const win = groupRuntime.windowIds;
    const haveWindow = Array.isArray(win) && win.length > 0;
    const curInWindow = haveWindow && win.includes(curEntryId);
    // Form a FRESH window when there is none, the dwell expired, or we've
    // wandered out of the current window (manual tap / loop release landed
    // elsewhere). A fresh random start is fine even when re-forming.
    if (!haveWindow || groupRuntime.swapsLeft <= 0 || !curInWindow) {
      const start = Math.floor(Math.random() * usable.length);
      const windowIds = [];
      for (let i = 0; i < groupSize; i++) {
        windowIds.push(usable[(start + i) % usable.length].id);
      }
      groupRuntime.windowIds = windowIds;
      groupRuntime.swapsLeft = groupDwell;
    }
    // Pick a random entry from the window that is NOT the current one (no
    // immediate repeat); if the window collapsed to only the current entry,
    // replay it. Decrement the dwell counter (mutate in place — the contract).
    const choices = groupRuntime.windowIds.filter(id => id !== curEntryId);
    const pickId = choices.length
      ? choices[Math.floor(Math.random() * choices.length)]
      : curEntryId;
    groupRuntime.swapsLeft -= 1;
    const picked = usable.find(e => e.id === pickId);
    if (picked) return picked;
    // The chosen id is no longer usable (entry removed mid-dwell) — force a
    // fresh window next call and fall through to sequential this beat.
    groupRuntime.windowIds = null;
    groupRuntime.swapsLeft = 0;
  }
  if (autopilot && autopilot.shuffle) {
    const others = usable.filter(e => e.id !== curEntryId);
    return others.length ? others[Math.floor(Math.random() * others.length)] : usable[0];
  }
  // Sequential: walk forward from the current index, skipping _missing.
  const idx = pl.entries.findIndex(e => e.id === curEntryId);
  let nextIdx = (idx + 1) % pl.entries.length;
  for (let i = 0; i < pl.entries.length; i++) {
    if (!pl.entries[nextIdx]._missing) return pl.entries[nextIdx];
    nextIdx = (nextIdx + 1) % pl.entries.length;
  }
  return null;
}

// ── Deck transition durationMs bounds (single source of truth) ─────────
// The /deck/transition-config POST, the per-call swap override, and the
// internal loadPlaylistEntryWithTransition resolve all clamp to this same
// window so a "5 minute" or "1 ms" fade can never reach the render loop.
export const DECK_TRANSITION_MIN_MS = 50;
export const DECK_TRANSITION_MAX_MS = 30000;

/**
 * Validate a per-call deck-transition override (item 10 — drivable by
 * feat/timeline_support). Mirrors the field validation of POST
 * /deck/transition-config EXACTLY so the two paths can't drift:
 *   - enabled  optional boolean
 *   - shuffle  optional boolean
 *   - mode     optional string, must be a trans_* transition name
 *   - durationMs optional, must be finite, clamped to [50, 30000] ms
 *
 * Returns { ok: true, value } where value is a NEW config object built by
 * merging the validated override on top of `base` (so omitted fields keep
 * the base/global config), or { ok: false, error } on the first bad field.
 * A null/undefined override yields a shallow copy of base unchanged.
 *
 * @param {Object} override per-call { enabled?, shuffle?, mode?, durationMs? }
 * @param {Object} base the global deckTransitionConfig to layer onto
 */
export function validateSwapTransitionOverride(override, base) {
  const out = { ...base };
  if (override === null || override === undefined) {
    return { ok: true, value: out };
  }
  if (typeof override !== 'object' || Array.isArray(override)) {
    return { ok: false, error: 'transition must be an object' };
  }
  if (override.enabled !== undefined) {
    if (typeof override.enabled !== 'boolean') {
      return { ok: false, error: 'transition.enabled must be a boolean' };
    }
    out.enabled = override.enabled;
  }
  if (override.shuffle !== undefined) {
    if (typeof override.shuffle !== 'boolean') {
      return { ok: false, error: 'transition.shuffle must be a boolean' };
    }
    out.shuffle = override.shuffle;
  }
  if (override.mode !== undefined) {
    if (typeof override.mode !== 'string' || !override.mode.startsWith('trans_')) {
      return {
        ok: false,
        error: `transition.mode must be a trans_* transition name, got '${override.mode}'`,
      };
    }
    out.mode = override.mode;
  }
  if (override.durationMs !== undefined) {
    const n = Number(override.durationMs);
    if (!Number.isFinite(n)) {
      return {
        ok: false,
        error: `transition.durationMs must be a finite number, got '${override.durationMs}'`,
      };
    }
    out.durationMs = Math.max(DECK_TRANSITION_MIN_MS, Math.min(DECK_TRANSITION_MAX_MS, n));
  }
  return { ok: true, value: out };
}

function listPatterns(patternsDir) {
  if (!fs.existsSync(patternsDir)) return [];
  return fs.readdirSync(patternsDir)
    .filter(f => f.endsWith('.js'))
    .map(f => f.replace(/\.js$/, ''));
}

// Directory name guard. Mirrors the playlist VALID_NAME slug so a
// directory request can never escape patternsDir via traversal or odd
// characters. Subdir patterns reference as `<dir>/<name>` which the
// playlist VALID_PATTERN regex already accepts.
const VALID_PATTERN_DIR = /^[a-z0-9][a-z0-9_-]{0,63}$/;

// Synthetic directory name for the top-level patterns/ folder. The "load
// directory" picker surfaces it as `default` so an operator can pull every
// root pattern (not just one sub-folder) into a playlist.
const ROOT_PATTERN_DIR = 'default';

// Enumerate the "load directory" targets — the synthetic `default` (the
// top-level patterns/ folder) followed by every immediate sub-directory.
// An operator can bulk-add a whole folder's patterns into a playlist in
// one action.
function listPatternDirs(patternsDir) {
  if (!fs.existsSync(patternsDir)) return [ROOT_PATTERN_DIR];
  const subs = fs.readdirSync(patternsDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .filter(name => VALID_PATTERN_DIR.test(name))
    .sort();
  return [ROOT_PATTERN_DIR, ...subs];
}

// List the patterns inside one directory as slugs ready to drop straight
// into playlist entries. `_`-prefixed files are internal helpers and are
// skipped; `default` returns the top-level patterns/ folder (bare slugs,
// filtered the same way PlaylistManager.generateDefault picks them — no
// `test*`), while a sub-directory returns fully-qualified `<dir>/<name>`.
function listPatternsInDir(patternsDir, dir) {
  if (dir === ROOT_PATTERN_DIR) {
    if (!fs.existsSync(patternsDir)) return [];
    return fs.readdirSync(patternsDir)
      .filter(f => f.endsWith('.js'))
      .filter(f => !f.startsWith('test'))
      .filter(f => !f.startsWith('_'))
      .map(f => f.replace(/\.js$/, ''))
      .sort();
  }
  if (!VALID_PATTERN_DIR.test(dir)) {
    throw new Error(`Invalid pattern directory: "${dir}"`);
  }
  const full = path.join(patternsDir, dir);
  if (!fs.existsSync(full) || !fs.statSync(full).isDirectory()) return [];
  return fs.readdirSync(full)
    .filter(f => f.endsWith('.js'))
    .filter(f => !f.startsWith('_'))
    .map(f => `${dir}/${f.replace(/\.js$/, '')}`)
    .sort();
}

function loadPattern(patternsDir, name) {
  const filePath = path.join(patternsDir, `${name}.js`);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Pattern not found: ${filePath}`);
  }
  return fs.readFileSync(filePath, 'utf8');
}

/**
 * Mission-critical deck-restore safety (Codex P0 — keep the exterior LIT).
 *
 * The deck channel drives the Titanic's exterior — the one surface that is
 * mission-critical to be visible at night. Restoring it from saved state can
 * fail two ways: the saved pattern is null/empty/missing-on-disk (load throws),
 * or it loads but fails to compile. EITHER outcome used to leave the rig dark
 * (silent null deck) or refuse to boot (crash). Both are unacceptable for the
 * deck.
 *
 * This helper makes the deck restore self-healing: it tries to build from the
 * saved pattern, and on ANY failure FALLS BACK to the known-good default
 * pattern so the deck is never dark. The fallback is NOT silent — it returns a
 * `degraded` descriptor the caller surfaces on `/status` (so an operator /
 * CaptainPad / smoke-check can SEE the saved deck didn't restore) and logs a
 * loud one-time `console.error`. Only if the DEFAULT pattern ALSO fails does it
 * throw fatally — that means the install itself is broken.
 *
 * `build(pattern)` must synchronously return the built channel or THROW. It is
 * the only injected dependency, which keeps this pure and unit-testable without
 * booting the engine.
 *
 * Returns `{ channel, degraded }` where `degraded` is either `null` (saved
 * pattern restored cleanly) or `{ failedPattern, reason, fellBackTo }`.
 */
export function restoreDeckWithFallback(saved, defaultPattern, build) {
  const savedPattern = saved && saved.pattern;
  // A null/empty saved pattern can't even be attempted — treat the same as a
  // load failure so the fallback path runs (don't hand build() a bad name).
  if (typeof savedPattern === 'string' && savedPattern.length > 0) {
    try {
      const channel = build(savedPattern);
      return { channel, degraded: null };
    } catch (e) {
      return buildDeckFallback(saved, savedPattern, e.message, defaultPattern, build);
    }
  }
  return buildDeckFallback(
    saved,
    savedPattern == null ? null : String(savedPattern),
    savedPattern == null ? 'saved deck pattern is null/empty' : `saved deck pattern is empty`,
    defaultPattern,
    build,
  );
}

function buildDeckFallback(saved, failedPattern, reason, defaultPattern, build) {
  console.error(
    `[Restore] DECK RESTORE DEGRADED — saved deck pattern ` +
    `'${failedPattern == null ? '(null)' : failedPattern}' failed to restore ` +
    `(${reason}). Falling back to default pattern '${defaultPattern}' to keep ` +
    `the mission-critical exterior LIT. This is a LOUD, VISIBLE degrade — see ` +
    `deckRestoreDegraded on /status.`,
  );
  // Build the deck from the known-good default with the saved channel's
  // identity/lock/view prefs preserved (so the operator's slot survives) but
  // the broken pattern swapped for the default.
  let channel;
  try {
    channel = build(defaultPattern);
  } catch (e) {
    // The default ALSO failed — the install is broken; boot must fail loud.
    const fatal = new Error(
      `Deck restore fallback FAILED: default pattern '${defaultPattern}' also ` +
      `failed to build (${e.message}) after saved pattern ` +
      `'${failedPattern == null ? '(null)' : failedPattern}' failed (${reason}). ` +
      `The install is broken — refusing to boot a dark deck.`,
    );
    fatal._deckRestoreFatal = true;
    throw fatal;
  }
  return {
    channel,
    degraded: { failedPattern: failedPattern == null ? null : failedPattern, reason, fellBackTo: defaultPattern },
  };
}

/**
 * Enumerate every non-internal IPv4 URL the engine is reachable on,
 * for the boot-time "Reachable on:" block.
 *
 * Loopback (127.0.0.1) is always first — useful for the local browser
 * dev case even on a quiet box. Then RFC1918 private addresses
 * (10.x, 192.168.x, 172.16-31.x) — those are the "real" LAN URLs the
 * operator usually wants for CaptainPad's Config tab fallback when
 * discovery is flaky. Then any remaining public IPv4 at the bottom.
 *
 * Excluded outright (noise that's never reachable from a LAN peer):
 *   - IPv4 link-local (169.254.0.0/16, APIPA) — only assigned when
 *     DHCP fails, never useful to hand to a peer.
 *   - VPN / tunnel virtual interfaces by name prefix: `utun`, `tun`,
 *     `tap`, `ipsec`. Addresses on these (e.g. 10.254.x from a corp
 *     VPN) are reachable only via the tunnel endpoint, NOT from a
 *     peer on the operator's LAN. Printing them clutters the boot log
 *     and misleads anyone trying to type the URL into a browser.
 *
 * One pass at boot — we don't re-enumerate on interface changes.
 */
function reachableUrls(port) {
  const isPrivate = (ip) => {
    if (ip.startsWith('10.')) return true;
    if (ip.startsWith('192.168.')) return true;
    if (ip.startsWith('172.')) {
      const second = parseInt(ip.split('.')[1], 10);
      return second >= 16 && second <= 31;
    }
    return false;
  };
  const ips = ['127.0.0.1'];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    // Drop VPN / tunnel virtual interfaces wholesale — their addresses
    // only route through the tunnel endpoint, not from a LAN peer.
    if (name.startsWith('utun') || name.startsWith('tun')
        || name.startsWith('tap') || name.startsWith('ipsec')) continue;
    for (const info of ifaces[name] || []) {
      if (info.family !== 'IPv4') continue;
      if (info.internal) continue;
      // Drop IPv4 link-local (APIPA, 169.254.0.0/16) — only assigned
      // when DHCP fails, never a useful URL to give a peer.
      if (info.address.startsWith('169.254.')) continue;
      if (!ips.includes(info.address)) ips.push(info.address);
    }
  }
  const rank = (ip) => {
    if (ip === '127.0.0.1') return 0;
    if (isPrivate(ip)) return 1;
    return 2;
  };
  ips.sort((a, b) => rank(a) - rank(b));
  return ips.map(ip => `http://${ip}:${port}`);
}

export function startApiServer(opts, engineCore, patternsDir, publishStatsRef, intensityController, globalEffectsController) {
  const { mixer, wasmHost, paramRouter, paramCenter, model } = engineCore;
  const localControlKinds = new Set([1, 2, 3, 6]);

  /**
   * Distinct fixture-group names declared by the loaded model, sorted
   * for stable UI ordering. Source list for the Dimmer Rack's FIXED
   * COLORS picker and the validation gate for PUT /group-fixed-colors
   * (docs/32 §2.4).
   */
  function listModelGroups() {
    const seen = new Set();
    if (model && Array.isArray(model.pixels)) {
      for (const px of model.pixels) {
        if (px && typeof px.group === 'string' && px.group.length > 0) seen.add(px.group);
      }
    }
    return [...seen].sort();
  }
  // Monotonic suffix for new-channel ids — guards against two POSTs in
  // the same millisecond producing the same `ch_<Date.now()>` id.
  let channelIdCounter = 0;

  function onChannelCompiled(channel, source = null) {
    if (paramCenter) {
      paramCenter.registerChannel(channel.id, channel.handle, wasmHost.getExports(channel.handle));
      // Force the VM to execute its top-level scope (export var defaults) so that
      // CPC values don't get clobbered by the first real beginFrame.
      wasmHost.beginFrame(channel.handle, 0);
    }
    // Seed each SLIDER control to its pattern's `export var` code default
    // (parsed from source — the VM can't report it). This is the BASE that
    // playlist/CPC overrides layer on top of (both run AFTER this call), so
    // override order is preserved. Must run even when paramCenter is absent.
    seedSliderCodeDefaults(channel, source);
    if (paramCenter) {
      // We also broadcast so clients know the new schema bindings
      broadcastWs({ type: 'sharedParams', ...paramCenter.getCanonicalState() });
    }
  }

  /**
   * Seed a channel's SLIDER controls (export kind 1) to the pattern's declared
   * `export var <x> = <default>` value, parsed from the pattern source. The
   * WASM VM's getExports() carries no values and there is no get_var cwrap, so
   * the host can't read the code default at runtime — this restores author
   * intent instead of leaving the VM's compiled-in 0.5 slider seed in place.
   *
   * The seed is written through channel.setControl so it lands in BOTH the live
   * WASM handle AND channel.localControls — the latter is what the exports
   * payload (`/mixer`, `/deck`), modulation baseParams, and playlist
   * captureDefaults all read as the control's current value. CPC-owned /
   * conflict-blocked controls are skipped (CPC owns those). Sliders with no
   * matching `export var` default are left at the VM default and logged.
   *
   * @param {object} channel
   * @param {string|null} source — explicit pattern text (live-edit buffer).
   *   When null we load it from disk by `channel.pattern`.
   */
  function seedSliderCodeDefaults(channel, source = null) {
    if (!channel || !channel.handle) return;
    let src = source;
    if (src === null) {
      if (!channel.pattern) return; // transition/blend handle — no var defaults
      try {
        src = loadPattern(patternsDir, channel.pattern);
      } catch (err) {
        // A channel pointing at a now-missing pattern is a real problem, but
        // not one this seeding step should crash the request over — surface it.
        console.warn(`[SliderDefaults] cannot load source for "${channel.pattern}": ${err.message}`);
        return;
      }
    }
    const { defaults, computed } = parsePatternDefaults(src);
    const sliderExports = wasmHost.getExports(channel.handle).filter(e => e.kind === 1);
    const noDefault = [];
    for (const exp of sliderExports) {
      // CPC owns these — never let a code default fight the global value.
      if (paramCenter && paramCenter.isSharedExport(channel.id, exp.name)) continue;
      if (paramCenter && paramCenter.getBlockedIds(channel.id).has(exp.id)) continue;
      if (!(exp.name in defaults)) {
        noDefault.push(exp.name);   // collected; summarized once below
        continue;
      }
      channel.setControl(wasmHost, exp.id, defaults[exp.name], 0, 0);
    }
    // Surface non-literal / no-default sliders as ONE summary line per load
    // instead of one per slider — under autopilot cycling 50+ patterns the
    // per-slider spam buried the actionable swap/compile errors. Still surfaced
    // (codex P0: no silent fallback), just not flooded.
    const who = channel.pattern || channel.id;
    if (computed.length) {
      console.warn(`[SliderDefaults] ${who}: ${computed.length} non-literal default(s) `
        + `left at VM default: ${computed.map(c => `${c.control}(${c.varName})`).join(', ')}`);
    }
    if (noDefault.length) {
      console.warn(`[SliderDefaults] ${who}: ${noDefault.length} slider(s) with no parsed `
        + `export var default, left at VM default: ${noDefault.join(', ')}`);
    }
  }

  // Per-channel cache of parsed code defaults, keyed by pattern name, so the
  // hot serialize path (mixer/deck broadcasts) doesn't re-read + re-parse the
  // pattern file on every frame. Invalidated implicitly: a new pattern name is
  // a new key; a live-edit recompile keeps the same name but the defaults are
  // re-seeded into localControls regardless, so a stale cache here only affects
  // the additive `codeDefault` HINT field, never the live value.
  const codeDefaultsCache = new Map();
  function codeDefaultsForPattern(patternName) {
    if (!patternName) return {};
    if (codeDefaultsCache.has(patternName)) return codeDefaultsCache.get(patternName);
    let defaults = {};
    try {
      defaults = parsePatternDefaults(loadPattern(patternsDir, patternName)).defaults;
    } catch (err) {
      console.warn(`[SliderDefaults] codeDefault hint unavailable for "${patternName}": ${err.message}`);
    }
    codeDefaultsCache.set(patternName, defaults);
    return defaults;
  }

  /**
   * Additive: stamp each SLIDER export (kind 1) with `codeDefault` — the
   * pattern's declared `export var` default — so clients can show / reset to
   * it. Does NOT touch existing fields; mutates and returns the same array.
   */
  function annotateCodeDefaults(channel, exportsArr) {
    const defaults = codeDefaultsForPattern(channel.pattern);
    for (const e of exportsArr) {
      if (e.kind === 1 && e.name in defaults) e.codeDefault = defaults[e.name];
    }
    return exportsArr;
  }

  /**
   * Push current CPC (global) values to a channel as the FINAL step after
   * onChannelCompiled + (optional) playlist entry defaults + localControls
   * restore. Ensures the latest system color palette, speed, etc. always
   * wins over any per-pattern state.
   */
  function finalizeCpcValues(channel) {
    if (paramCenter) {
      paramCenter.applyToChannel(wasmHost, channel.id);
    }
  }

  // Topic-aware broadcaster. Picks the right WebSocketServer based on
  // the message `type` (see lib/ws_topic_routing.js for the full
  // routing table). The four sockets (`/ws/control`, `/ws/params`,
  // `/ws/signals`, `/ws/viz`) are created in `wssByTopic` below; this
  // function is a no-op until that map is populated, which makes it
  // safe to call during early boot before listen() has bound.
  //
  // A missing classification throws — see ws_topic_routing.js — so a
  // typo in a payload `type` fails loud at the broadcast site instead
  // of silently disappearing or leaking onto every socket.
  function broadcastWs(msgObj) {
    if (!msgObj || typeof msgObj !== 'object') return;
    const topic = topicForType(msgObj.type);
    const wssForTopic = global.wssByTopic && global.wssByTopic[topic];
    if (!wssForTopic) return;
    const msg = JSON.stringify(msgObj);
    wssForTopic.clients.forEach(c => {
      if (c.readyState === 1) c.send(msg);
    });
  }

  // Wire the ModulationController's broadcast publisher to our local
  // broadcastWs. The controller was constructed in engine.js BEFORE
  // this fn ran, so it was given a deferred ref — now it flows.
  //
  // WS topic routing note: when the round-3 WS topic split lands,
  // `modulationState` must route to /ws/params (the "values changing
  // live" socket alongside sharedParams + liveParams). Until then it
  // rides the single global.wss like everything else.
  if (engineCore.modulationBroadcastRef) {
    engineCore.modulationBroadcastRef.publish = broadcastWs;
  }

  // Same pattern for the SignalPostProcessor (docs/29) — the engine
  // constructs it before api_server runs, hands us a deferred ref;
  // wire it here so `audioChainsChanged` (on PUT/PATCH/reset) and
  // 5 Hz `signalChain` previews flow through broadcastWs.
  if (engineCore.signalPostProcessorBroadcastRef) {
    engineCore.signalPostProcessorBroadcastRef.publish = broadcastWs;
  }

  const stateDir = path.join(patternsDir, '..', 'states', opts.modelName || 'default');
  const stateManager = new StateManager(stateDir);
  // Named mixer snapshots / look recall (F-A). Lives in <stateDir>/snapshots
  // and reuses the StateManager's atomic writer for torn-write safety.
  const snapshotManager = new SnapshotManager(stateDir, stateManager);
  // Named per-channel parameter presets (round-2 #9). Lives in
  // <stateDir>/param_presets and reuses the StateManager's atomic writer for
  // torn-write safety. Captures one channel's localControls; recall is
  // pattern-scoped (see param_preset_manager.js + docs/39).
  const paramPresetManager = new ParamPresetManager(stateDir, stateManager);

  // Playlist library lives in simulation/scenes/<scene>/playlists/
  const playlistsDir = path.join(
    patternsDir, '..', '..', 'simulation', 'scenes',
    opts.modelName || 'default', 'playlists'
  );
  const playlistManager = new PlaylistManager(playlistsDir, patternsDir);

  // ── Modulation context push ─────────────────────────────────────────
  // Whenever the deck's (playlist, activeEntryId) tuple changes OR a
  // CRUD mutation lands on the currently-active entry, push the
  // matching mappings into the ModulationController. The hot loop
  // never reads disk for this.
  function pushActiveEntryToModulation() {
    const mc = engineCore.modulationController;
    if (!mc) return;
    const deckCh = mixer.getDeckChannel();
    const playlistName = deckCh?.playlist?.name || null;
    const entryId = deckCh?.playlist?.activeEntryId || null;
    if (!playlistName || !entryId) {
      mc.setActiveEntry({ playlistName: null, entryId: null, pattern: null, mappings: [] });
      return;
    }
    let mappings = [];
    let pattern = deckCh?.pattern || null;
    try {
      const pl = playlistManager.load(playlistName);
      const entry = pl && pl.entries.find(e => e.id === entryId);
      if (entry) {
        mappings = Array.isArray(entry.modulations) ? entry.modulations : [];
        pattern = entry.pattern || pattern;
      }
    } catch (err) {
      console.warn(`[Modulation] could not load mappings for ${playlistName}/${entryId}: ${err.message}`);
    }
    mc.setActiveEntry({ playlistName, entryId, pattern, mappings });
  }

  // ── Dynamic-signal modulation purge ──────────────────────────────────
  // When a dynamic CPC key is DEREGISTERED (gone from the Companion's
  // signal manifest), every modulation mapping SOURCED from that key must
  // be removed across all playlist entries — otherwise CaptainPad keeps
  // showing the green "ghost" slider for a source that no longer exists,
  // and the controller would resolve it to 0 forever. We touch ONLY
  // mappings whose `source.key` matches; all other mappings are preserved
  // verbatim. Returns the number of mappings purged.
  function purgeModulationsForSource(removedKey) {
    let purged = 0;
    let touchedActive = false;
    const deckCh = mixer.getDeckChannel();
    const activePlaylist = deckCh?.playlist?.name || null;
    for (const name of playlistManager.list()) {
      let pl;
      try {
        pl = playlistManager.load(name);
      } catch (err) {
        console.warn(`[CompanionManifest] could not load playlist ${name} for purge: ${err.message}`);
        continue;
      }
      if (!pl || !Array.isArray(pl.entries)) continue;
      let changed = false;
      for (const entry of pl.entries) {
        if (!Array.isArray(entry.modulations) || entry.modulations.length === 0) continue;
        const before = entry.modulations.length;
        entry.modulations = entry.modulations.filter(
          m => !(m && m.source && m.source.key === removedKey),
        );
        const removed = before - entry.modulations.length;
        if (removed > 0) {
          purged += removed;
          changed = true;
        }
      }
      if (!changed) continue;
      try {
        playlistManager.save(pl);
        broadcastWs({ type: 'playlistSaved', name });
        if (name === activePlaylist) touchedActive = true;
      } catch (err) {
        console.warn(`[CompanionManifest] could not save purged playlist ${name}: ${err.message}`);
      }
    }
    // Re-push the active entry so the ModulationController drops the now-
    // gone mappings and broadcasts a fresh modulationState frame — that
    // clears the iPad's green ghost sliders immediately.
    if (touchedActive) pushActiveEntryToModulation();
    return purged;
  }

  if (playlistManager.list().length === 0) {
    try {
      playlistManager.generateDefault();
      console.log(`  ✅ Playlist library initialized at ${playlistsDir} (default.yaml generated)`);
    } catch (e) {
      console.warn(`[Playlist] Could not generate default playlist:`, e.message);
    }
  } else {
    console.log(`  ✅ Playlist library: ${playlistManager.list().length} playlist(s) in ${playlistsDir}`);
  }

  let mixerState = stateManager.loadMixerState();
  let deckState = stateManager.loadDeckState();
  let globalsState = stateManager.loadGlobalsState();

  // ── Deck transition config ───────────────────────────────────────────
  // Operator picks (deck tab → DECK TRANSITIONS row) for how playlist
  // entry switches on the deck should look:
  //
  //   enabled    : false → instant swap (original behaviour)
  //                true  → soft swap via mixer's hidden shadow channel
  //   mode       : 'trans_crossfade' | 'trans_flash' | 'trans_dissolve'
  //                | 'trans_wipe_*' | 'trans_iris' — see patterns/transitions/
  //   durationMs : 50..30000
  //   shuffle    : if true, pick a random transition style per swap
  //                (mode field is ignored)
  //
  // Persisted alongside the deck state so it survives engine restarts.
  // The mixer's swap machinery lives in pattern_mixer.js
  // (`triggerDeckPatternSwap` + `updateDeckSwapTransition`).
  const deckTransitionConfig = {
    enabled: false,
    mode: 'trans_crossfade',
    durationMs: 1000,
    shuffle: false,
    ...(deckState && deckState.transitionConfig ? deckState.transitionConfig : {}),
  };

  if (paramCenter) {
    paramCenter.saveHook = () => stateManager.saveGlobalsState(globalsState, paramCenter);
  }

  try {
    stateManager.applyGlobalsState(globalsState, paramCenter, intensityController, globalEffectsController);
  } catch (err) {
    console.warn('Failed to apply loaded state:', err);
  }

  // Restore Global Effect Macro slot bindings (docs/28 §8 — persistent).
  // The slot manager is created at engine boot with the in-code default
  // config; if a persisted file exists AND validates we overlay it.
  // If validation throws (e.g. old yaml references a removed effect),
  // we leave the defaults in place and log — never silently fall back.
  const globalEffectSlotManager = engineCore.globalEffectSlotManager || null;
  if (globalEffectSlotManager) {
    const persistedSlots = stateManager.loadGlobalEffectSlots();
    if (persistedSlots && Array.isArray(persistedSlots.slots)) {
      try {
        validateSlotsConfig(persistedSlots.slots);
        globalEffectSlotManager.setSlots(persistedSlots.slots);
        console.log(`  ✅ Global effect slots: restored ${persistedSlots.slots.length} from disk`);
      } catch (e) {
        console.warn(`[GlobalEffectSlots] persisted config invalid, keeping defaults: ${e.message}`);
      }
    }
  }

  // ── Scheduler service (docs/31_scheduled_tasks.md v3) ───────────────
  // Engine-owned task list that fires (effectId, presetId) bindings
  // from the global effect library on a timer ("hazer 10s every 1m").
  // The schedule keeps running even when CaptainPad is closed, asleep,
  // or disconnected — the engine is the source of truth. Persisted to
  // states/<model>/scheduled_tasks.yaml. Dispatch goes through
  // GlobalEffectSlotManager.dispatchEffectAction — slot-less direct
  // route, no GEM slot reservation (v3 change).
  const scheduledTaskService = new ScheduledTaskService({
    stateDir,
    slotManager: globalEffectSlotManager,
    broadcast: broadcastWs,
    getFrameIndex: () => (engineCore.getFrameIndex ? engineCore.getFrameIndex() : 0),
  });
  try {
    scheduledTaskService.loadFromDisk();
    if (scheduledTaskService.list().length > 0) {
      console.log(`  ✅ Scheduled tasks: restored ${scheduledTaskService.list().length} from disk`);
    }
  } catch (err) {
    // Codex P0: hand-edited YAML with off-preset values must crash boot
    // loudly rather than silently dropping the bad row.
    console.error(`[ScheduledTasks] failed to load scheduled_tasks.yaml: ${err.message}`);
    process.exit(1);
  }
  scheduledTaskService.start();

  // After loading saved CPC values, push them to all boot-created channels.
  // This must happen after the channels have been primed with beginFrame(0)
  // (which onChannelCompiled already does).
  if (paramCenter) paramCenter.applySnapshot(wasmHost);

  // ── CPC fan-out via onChange (docs/24 §7.2) ────────────────────────────
  //
  // Single source of truth for post-mutation work after a CPC write
  // from any source (HTTP, WS, OSC, future MIDI). Replaces the
  // ad-hoc `applySnapshot/save/broadcastWs` calls that used to live
  // in each handler, which would double-broadcast as soon as we
  // added a second source.
  //
  // - WASM injection: relies on the render loop's flushDirty() —
  //   set() marks the slot dirty; flushDirty pushes on the next
  //   frame. No applySnapshot call here.
  // - Persistence: skipped entirely for batches that touch only
  //   live (persist:false) params, so audio at 60 Hz never writes
  //   to disk.
  // - WS broadcast: throttled per-key by registry broadcastHz.
  let lastOscStats = null;
  // Same caching contract as lastOscStats — a WS client that connects
  // after the most recent audioStatus broadcast gets it replayed on
  // connect so the Audio Analysis tab paints the right state without
  // waiting up to a second for the next 1Hz heartbeat (docs/25 §6.3).
  let lastAudioStatus = null;
  // Same replay-on-connect contract as lastAudioStatus, but for the
  // operator-tunable audio CONFIG (bands.inputGain / sourceSmoothHz /
  // capture.device / enabled). Broadcast on PATCH /audio/config + reset
  // so EVERY /ws/control subscriber (CaptainPad and the Audio Companion)
  // mirrors the engine's single source of truth. The Companion uses this
  // to drive its live analyzer gain/smooth/device. Null until the first
  // config broadcast — a fresh client then seeds via GET /audio/config.
  let lastAudioConfig = null;
  // Cached most-recent payloads for replay on WS connect. lastSharedParams
  // is the full canonical CPC doc; lastLiveParams is the audio-derived
  // subset that broadcasts on the `liveParams` channel — see
  // broadcastCpcSplit() below.
  let lastSharedParams = null;
  let lastLiveParams = null;
  const lastBroadcastMs = {};
  // Bucket-level emit cap (May 2026 perf; cadence revisited Jun 2026 for
  // the audio-meter latency pass). One coalesced `liveParams` frame is
  // emitted per bucket interval carrying ALL live keys (mic bands + kick
  // + flux, stems, detector outputs). The bucket interval is the SOLE
  // pacer for the live channel:
  //
  //   - At 50 ms (the old 20 Hz cap) the audio meters looked laggy and
  //     stepped — a fresh sample could sit up to 50 ms before hitting
  //     the wire, and 20 Hz is visibly below the ~40-60 Hz the eye reads
  //     as "smooth" for fast-moving bars.
  //   - The old design ALSO required `pastThrottle(...)` (per-key Hz) to
  //     pass on top of the bucket. That was redundant: the live bundle is
  //     coalesced (every frame carries every live key regardless of which
  //     one tripped), so a per-key OR-gate only let the effective rate
  //     float up to the fastest live key (micKick @ 30 Hz) while adding
  //     no smoothing and a confusing second knob.
  //
  // 22 ms ~= 45 Hz: smooth and low-latency for the meters, still far
  // below the analyser's ~86 Hz hop rate, and the ~150 B payload keeps
  // the iPad JSON.parse + fan-out cost trivial. Per-key Hz now only
  // governs the STEADY (sharedParams) bucket; the live bucket is paced
  // purely by this interval.
  const LIVE_BUCKET_MIN_INTERVAL_MS = 22; // ~45 Hz coalesced live frame
  let lastLiveBroadcastMs = 0;
  let hzByKeyCache = null;
  let liveKeysSetCache = null;
  function getHzByKey() {
    if (hzByKeyCache) return hzByKeyCache;
    hzByKeyCache = {};
    if (paramCenter) {
      for (const e of paramCenter.getSchema()) {
        hzByKeyCache[e.key] = e.broadcastHz || 30;
      }
    }
    return hzByKeyCache;
  }
  // Set of CPC keys flagged `live: true` (see lib/param_center.js
  // REGISTRY). These are the audio-derived, high-rate, non-persistent
  // params (mic bands + kick, OSC stems, tempoBpm) that ride a
  // SEPARATE `liveParams` WS message so the mixer / deck onmessage
  // path doesn't have to parse + setState a 1.5 KB sharedParams
  // snapshot 30× / second while the audio analyser is running.
  // Cached lazily; INVALIDATED whenever the registry changes (a dynamic
  // Companion-manifest key was added/removed — see invalidateSchemaCaches).
  // Pre-dynamic-keys this was "cached once at boot, immutable per process";
  // that assumption no longer holds.
  function getLiveKeysSet() {
    if (liveKeysSetCache) return liveKeysSetCache;
    liveKeysSetCache = new Set();
    if (paramCenter) {
      for (const e of paramCenter.getSchema()) {
        if (e && e.live === true) liveKeysSetCache.add(e.key);
      }
    }
    return liveKeysSetCache;
  }
  // Drop the schema-derived caches so the next getHzByKey/getLiveKeysSet
  // rebuilds from the current registry. Called after a dynamic CPC key is
  // registered or deregistered so a freshly-added live key gets routed to
  // the liveParams bucket (and a removed one stops being looked up).
  function invalidateSchemaCaches() {
    hzByKeyCache = null;
    liveKeysSetCache = null;
  }
  // Throttle helper, shared by both message types. `bucket` namespaces
  // the timestamps so a key can independently pace its sharedParams
  // and liveParams emissions even though the key only ever appears in
  // one of them (defensive: cheap insurance against future re-classing).
  function pastThrottle(now, bucket, keys, hzByKey) {
    for (const k of keys) {
      const hz = hzByKey[k] || 30;
      const interval = 1000 / hz;
      const ts = lastBroadcastMs[`${bucket}:${k}`] || 0;
      if (!ts || (now - ts) >= interval) return true;
    }
    return false;
  }
  function stampThrottle(now, bucket, keys) {
    for (const k of keys) lastBroadcastMs[`${bucket}:${k}`] = now;
  }
  // Emit one `sharedParams` (steady keys) and / or one `liveParams`
  // (audio-derived keys) per CPC change batch.
  //
  // Why split: pre-split, every audio hop pushed the whole CPC
  // snapshot (~30 keys, ~1.5 KB) at up to 30 Hz to every WS client,
  // including the mixer / deck which don't react to audio params at
  // all. That cost was visible as JS-thread starvation on the iPad
  // (slow playlist taps with the mic listener active). After the
  // split:
  //   - sharedParams: full CPC, only emitted when a STEADY key
  //     actually changes (colors, speed, gains, etc.) — i.e. when the
  //     operator turns a knob. Quiet by default.
  //   - liveParams: just the live keys (mic*, stems*, tempoBpm),
  //     broadcast at their per-key rate. Small payload (~150 B), the
  //     audio tab is the only consumer that has to re-render on it.
  //
  // The mixer / deck onmessage handlers can early-return on the
  // `liveParams` type and stay smooth even with the analyser hot.
  function broadcastCpcSplit(state, changedKeys) {
    if (!changedKeys || changedKeys.length === 0) return;
    const now = Date.now();
    const hzByKey = getHzByKey();
    const liveSet = getLiveKeysSet();
    const liveChanged = [];
    const steadyChanged = [];
    for (const k of changedKeys) {
      if (liveSet.has(k)) liveChanged.push(k);
      else steadyChanged.push(k);
    }

    // ── liveParams: tight payload, only live keys ───────────────────
    // Single gate: the BUCKET interval. Whenever any live key changed and
    // at least LIVE_BUCKET_MIN_INTERVAL_MS has elapsed since the last live
    // frame, emit ONE coalesced frame carrying every live key's freshest
    // value. The per-key Hz `pastThrottle` requirement was removed here
    // (Jun 2026 latency pass) — see the LIVE_BUCKET_MIN_INTERVAL_MS comment
    // for why it was redundant for a coalesced bundle.
    if (liveChanged.length > 0
        && (now - lastLiveBroadcastMs) >= LIVE_BUCKET_MIN_INTERVAL_MS) {
      lastLiveBroadcastMs = now;
      const params = {};
      const srcParams = (state && state.params) || {};
      // Only ship live keys; if you need full CPC state, hit
      // /param-center or wait for the next sharedParams emission.
      for (const k of liveSet) {
        const slot = srcParams[k];
        if (!slot) continue;
        params[k] = { value: slot.value };
      }
      const payload = {
        type: 'liveParams',
        revision: state && state.revision,
        params,
      };
      lastLiveParams = payload;
      broadcastWs(payload);
    }

    // ── sharedParams: full canonical CPC, steady-key triggered ──────
    // We keep emitting the WHOLE state (back-compat for any consumer
    // that flattens `params[k].value`), but only when a steady key
    // actually changed — so it goes from "30 Hz audio-driven firehose"
    // back to "operator-touch driven".
    if (steadyChanged.length > 0 && pastThrottle(now, 'steady', steadyChanged, hzByKey)) {
      stampThrottle(now, 'steady', steadyChanged);
      const payload = { type: 'sharedParams', ...state };
      lastSharedParams = payload;
      broadcastWs(payload);
    }
  }
  if (paramCenter) {
    paramCenter.onChange = ({ changedKeys, state }) => {
      if (paramCenter.hasPersistentDirty(changedKeys)) {
        paramCenter.save();
      }
      broadcastCpcSplit(state, changedKeys);
    };
  }

  function saveAllState() {
    stateManager.saveMixerState(mixer);
    stateManager.saveDeckState(mixer, {
      transitionConfig: { ...deckTransitionConfig },
      // Deck dynamic view overrides: persist the overlay stack + the SHARED
      // overlay autopilot cadence so they survive an engine restart (operator
      // ruling #5). Each overlay is serialized with the same channel shape the
      // mixer overlays use (serializeChannelForState) so the restore path can
      // rebuild them via buildChannelFromSaved + loadPlaylistEntry. order is
      // array order (bottom→top). The transient shared anchor is not persisted.
      overlays: (mixer.getDeckOverlays ? mixer.getDeckOverlays() : []).map(serializeChannelForState),
      overlayAutopilot: {
        active: !!(mixer.deckOverlayAutopilot && mixer.deckOverlayAutopilot.active),
        delay_s: (mixer.deckOverlayAutopilot && typeof mixer.deckOverlayAutopilot.delay_s === 'number')
          ? mixer.deckOverlayAutopilot.delay_s : 30,
        shuffle: !!(mixer.deckOverlayAutopilot && mixer.deckOverlayAutopilot.shuffle),
        ...autoGroupFields(mixer.deckOverlayAutopilot),
      },
    });
  }

  function getReplayableLocalExport(channel, controlId) {
    if (paramCenter && paramCenter.isSharedControlId(channel.id, controlId)) return null;
    const exp = wasmHost.getExports(channel.handle).find(e => e.id === controlId);
    if (!exp || !localControlKinds.has(exp.kind)) return null;
    return exp;
  }

  // ── Debounced per-channel auto-capture ───────────────────────────────
  // Every control change schedules a capture of the active playlist entry's
  // defaults 500 ms after the LAST change. Coalesces fast slider drags into
  // one disk write and one WS broadcast. The broadcast lets every open client
  // (deck + mixer) update its UI in lockstep.
  const captureTimers = new Map();
  const CAPTURE_DEBOUNCE_MS = 500;

  /**
   * Capture current channel state as the entry.defaults of the playlist's
   * currently active entry. Persists to disk.
   */
  function captureActiveEntryDefaults(channel) {
    if (!channel.playlist || !channel.playlist.name || !channel.playlist.activeEntryId) {
      throw new Error('Channel has no active playlist entry');
    }
    const playlist = playlistManager.load(channel.playlist.name);
    if (!playlist) throw new Error(`Playlist not found: ${channel.playlist.name}`);
    const entry = playlist.entries.find(e => e.id === channel.playlist.activeEntryId);
    if (!entry) throw new Error(`Active entry not found: ${channel.playlist.activeEntryId}`);
    entry.defaults = playlistManager.captureDefaults(channel, wasmHost, paramCenter);
    playlistManager.save(playlist);
    return entry.defaults;
  }

  function scheduleEntryCapture(channelId) {
    if (!channelId) return;
    // Locked channels intentionally do NOT auto-capture. Param edits are
    // still applied to the live WASM handle (so the operator can tweak a
    // show), but the playlist defaults on disk stay frozen until the user
    // unlocks and explicitly chooses save or discard.
    const ch0 = mixer.getChannel(channelId);
    if (ch0 && ch0.locked) return;
    const existing = captureTimers.get(channelId);
    if (existing) clearTimeout(existing);
    captureTimers.set(channelId, setTimeout(() => {
      captureTimers.delete(channelId);
      const ch = mixer.getChannel(channelId);
      if (!ch || !ch.playlist || !ch.playlist.activeEntryId) return;
      // Defensive re-check: lock may have been engaged inside the debounce
      // window. Never let a stale timer write into a locked channel.
      if (ch.locked) return;
      try {
        const defaults = captureActiveEntryDefaults(ch);
        broadcastWs({
          type: 'playlistEntryCaptured',
          channelId,
          playlist: ch.playlist.name,
          entryId: ch.playlist.activeEntryId,
          defaults,
        });
      } catch (e) {
        // Active entry may have been removed mid-edit, etc. Surface to the
        // operator log but never crash the request handler.
        console.warn('[Playlist] Auto-capture skipped:', e.message);
      }
    }, CAPTURE_DEBOUNCE_MS));
  }

  /**
   * Track whether a control was edited *while the channel was locked*. We
   * keep this as an explicit, intent-driven flag rather than diffing the
   * live state against the saved entry defaults, because:
   *
   *   1. Freshly-added playlist entries have `defaults = {}` (no opinion
   *      saved yet). A diff would either flag every channel as dirty (any
   *      WASM init produces non-empty captureDefaults output) or never
   *      flag them (empty-saved-equals-clean). Neither matches user
   *      intent for the "I locked this, then tweaked sliders, now I'm
   *      unlocking" workflow.
   *   2. Pattern exports can change between releases. Diff-based dirty
   *      would chase phantom diffs from added/removed exports rather than
   *      real user edits.
   *
   * The flag lifecycle:
   *   - Initialized lazily to `false` whenever read.
   *   - Set to `true` only when `markChannelDirtyIfLocked` is called on a
   *     locked channel (i.e. operator turned a knob while the lock was on).
   *   - Cleared whenever we resolve the state: on lock toggle (either
   *     direction), on capture, on discard, and on entry swap.
   */
  function markChannelDirtyIfLocked(channelId) {
    const ch = mixer.getChannel(channelId);
    if (!ch || !ch.locked) return;
    if (ch._dirty) return;
    ch._dirty = true;
    broadcastMixerState();
  }
  function clearChannelDirty(channel) {
    if (channel && channel._dirty) channel._dirty = false;
  }

  /**
   * Per-pattern param SHARING (operator request, feat/optimize_channels).
   *
   * A pattern's exported SLIDERS/params are conceptually owned by the
   * (playlist, pattern) pair, NOT by the one channel the operator happened
   * to touch. So when a control is written on the SOURCE channel, mirror that
   * SAME export onto every OTHER live channel currently running the SAME
   * pattern from the SAME playlist — the deck base channel, every mixer
   * overlay, AND every deck overlay.
   *
   * Keying: matched on (channel.playlist.name === L) AND (channel.pattern === P)
   * via mixer.channelsRunningPattern. The on-disk source of truth is each
   * matched channel's playlist-entry `defaults` (captured by
   * scheduleEntryCapture below), so the shared value ALSO lands on disk and is
   * re-applied when any channel later (re)loads that (playlist, pattern).
   *
   * Mapping is by export NAME, not by raw controlId: each channel has its own
   * WASM handle, so we resolve the source export's name, then find the
   * same-named export on each target and write THROUGH paramRouter
   * (setChannelControl), which already rejects CPC-owned / CPC-blocked /
   * non-local controls per target. This guarantees we only ever propagate the
   * pattern's LOCAL sliders/params — never channel-level things (fader, level,
   * hue, mode, faderMax) which are not pattern exports and never reach here.
   *
   * Returns the array of channel ids that actually received the value (so the
   * caller can schedule their entry-capture too). The source channel is never
   * in the result — the caller already wrote + captured it.
   */
  function propagatePatternParam(sourceChannelId, controlId, v0, v1, v2) {
    const source = mixer.getChannel(sourceChannelId)
      || (mixer.getDeckOverlay && mixer.getDeckOverlay(sourceChannelId));
    return propagatePatternParamWith({
      source,
      sourceChannelId,
      controlId,
      v0, v1, v2,
      mixer,
      wasmHost,
      paramRouter,
    });
  }

  /**
   * Convenience wrapper used by the runtime control-write routes: write the
   * control on the source channel's OWN capture+dirty pipeline, then propagate
   * the same export to every sibling channel running the same (playlist,
   * pattern), scheduling their capture too. The source channel's own write +
   * scheduleEntryCapture is done by the caller BEFORE this is invoked.
   */
  function propagateAndCapturePatternParam(sourceChannelId, controlId, v0, v1, v2) {
    const applied = propagatePatternParam(sourceChannelId, controlId, v0, v1, v2);
    for (const id of applied) {
      scheduleEntryCapture(id);
      markChannelDirtyIfLocked(id);
    }
    return applied;
  }

  /**
   * Load a playlist entry into an EXISTING channel: compile pattern, swap
   * handle, apply entry defaults, and let CPC have the last word. Updates
   * channel.playlist.activeEntryId + cursor.
   */
  function loadPlaylistEntry(channel, playlistName, entryId) {
    const playlist = playlistManager.load(playlistName);
    if (!playlist) throw new Error(`Playlist not found: ${playlistName}`);
    const idx = playlist.entries.findIndex(e => e.id === entryId);
    if (idx < 0) throw new Error(`Entry not found in ${playlistName}: ${entryId}`);
    const entry = playlist.entries[idx];
    if (entry._missing) throw new Error(`Pattern missing for entry ${entryId}: ${entry.pattern}`);

    // Cancel any pending auto-capture targeting the PREVIOUS active entry —
    // we don't want a stale timer to write old values into the entry we just
    // left behind (which would then overwrite the on-disk defaults captured
    // at switch time).
    const pending = captureTimers.get(channel.id);
    if (pending) { clearTimeout(pending); captureTimers.delete(channel.id); }

    const src = loadPattern(patternsDir, entry.pattern);
    const comp = wasmHost.compile(src);
    if (!comp.ok) throw new Error(`Compile error: ${comp.error}`);

    if (channel.handle) wasmHost.destroy(channel.handle);
    channel.handle = comp.handle;
    channel.pattern = entry.pattern;
    channel.localControls = {};
    onChannelCompiled(channel);

    playlistManager.applyEntryDefaults(channel, entry, wasmHost, paramRouter, paramCenter);
    finalizeCpcValues(channel);

    // Update assignment cursor
    channel.playlist = channel.playlist || {};
    channel.playlist.name = playlistName;
    channel.playlist.activeEntryId = entryId;
    channel.playlist.cursor = idx;
    channel.playlist.autopilot = channel.playlist.autopilot || { active: false, delay_s: 30, shuffle: false };

    // Auto-cycle baseline reset (round-2 #2): EVERY load through this choke —
    // whether an operator's manual entry tap OR an auto-cycle advance itself —
    // re-seeds the wall-clock anchor to null so the next auto-cycle tick
    // measures a full delay_s from THIS load, not from a stale pre-load
    // baseline. (The tick re-seeds null→now on its next active frame, so a
    // manual tap mid-cycle restarts the timer cleanly. Transient, never saved.)
    channel._autoCycleLastAdvanceMs = null;
    // PATTERN-GROUP LOCALITY (feat/optimize_channels): a manual entry tap OR a
    // (re-)load/assignment change must START A FRESH GROUP — drop any window
    // we were dwelling in so the next group-mode advance grabs a new one from
    // the new baseline (mirrors the anchor reset directly above). Transient.
    if (channel._autoGroup) { channel._autoGroup.windowIds = null; channel._autoGroup.swapsLeft = 0; }

    // Switching to a new entry resets the "dirty since lock" state — the
    // new entry's own defaults are now the canonical reference, and any
    // edits made in the previous entry are no longer relevant here.
    channel._dirty = false;

    // Push the entry's modulations into the ModulationController if this
    // load lands on the deck channel.
    if (mixer.getDeckChannel && mixer.getDeckChannel()?.id === channel.id) {
      pushActiveEntryToModulation();
    }

    return { entry, index: idx, total: playlist.entries.length };
  }

  // ── AUTO-CYCLE tick (round-2 #2, docs/39 §auto-cycle) ─────────────────
  //
  // Generalizes the deck Autopilot daemon to ANY mixer overlay: a channel
  // with `playlist.autopilot.active` auto-advances its playlist on a timer.
  // Called ONCE PER FRAME from the engine render loop's beforeFrame hook
  // (engine.js), so there is ONE source of time (the wall clock) and NO
  // per-channel setTimeout sprawl — naturally paused by a stopped loop.
  //
  // The tick itself is cheap + synchronous: for each active overlay it reads
  // the wall-clock anchor and decides whether an advance is DUE. It never
  // compiles inline — overlay `loadPlaylistEntry` is an INSTANT hard handle
  // destroy+compile (50-200ms) with no double-buffer, so awaiting it in the
  // frame would darken the composite. Instead the actual advance is dispatched
  // OFF THE HOT PATH via setImmediate (drained after the frame returns), with
  // an in-flight guard so a slow compile can never stack two advances. A
  // compile error is logged LOUDLY and the channel keeps its current pattern
  // (Codex P0 — NOT a silent swap, NOT a silent swallow).
  //
  // Mirrors the deck advance pick logic — see the module-level exported
  // `pickNextAutoCycleEntry` / `autoCycleDueDecision` (pure, unit-tested with
  // a fake clock). Exterior immunity is free: active defaults false (opt-in).
  // v1 ships the visible hard-cut on overlays (no overlay double-buffer exists
  // today — documented in docs/39); a v2 fade is out of scope.
  function autoCycleTick() {
    // If a snapshot morph / recall-fade is rebuilding overlays this frame,
    // skip auto-advance entirely — a handle swap mid-morph would fight the
    // morph's per-channel ramps. (Deck-swap in-flight only affects the deck,
    // not overlays, so we don't gate on it here.)
    if (mixer.getMorph && mixer.getMorph()) return;

    const now = Date.now();
    const overlays = mixer.getMixerChannels ? mixer.getMixerChannels() : [];
    for (const channel of overlays) {
      if (channel._autoCycleInFlight) continue; // a compile is still draining

      // Pure decision (fake-clock unit-tested): 'skip' | 'seed' | 'wait' |
      // 'due'. Seeds the anchor on the first active frame (no advance), waits
      // until delay_s elapses, then reports 'due'.
      const decision = autoCycleDueDecision(channel, now);
      if (decision === 'skip') continue;
      if (decision === 'seed') { channel._autoCycleLastAdvanceMs = now; continue; }
      if (decision === 'wait') continue;

      // Due. Resolve the playlist + next entry synchronously (cheap), then
      // dispatch the compile off the hot path.
      const ap = channel.playlist.autopilot;
      const pl = playlistManager.load(channel.playlist.name);
      if (!pl || pl.entries.length === 0) { channel._autoCycleLastAdvanceMs = now; continue; }
      const next = pickNextAutoCycleEntry(pl, ap, channel.playlist.activeEntryId, channel._autoGroup);
      if (!next) {
        // Held / no usable target — re-anchor so we re-check after delay_s,
        // not every frame (mirrors the deck daemon re-checking each beat).
        channel._autoCycleLastAdvanceMs = now;
        continue;
      }
      // Anchor BEFORE dispatch so the next due-check counts from this beat
      // even while the compile is draining. (loadPlaylistEntry will reset
      // the anchor to null on success → re-seeded next frame; on failure the
      // anchor we set here keeps the cadence so we don't hammer a bad entry.)
      channel._autoCycleLastAdvanceMs = now;
      channel._autoCycleInFlight = true;
      const targetId = next.id;
      const plName = channel.playlist.name;
      setImmediate(() => {
        try {
          loadPlaylistEntry(channel, plName, targetId);
          saveAllState();
          broadcastMixerState();
        } catch (e) {
          // Fail LOUD; keep the current pattern (NOT a silent swallow).
          console.warn(`[AutoCycle] advance failed on channel ${channel.id} → ${targetId}: ${e.message}`);
        } finally {
          channel._autoCycleInFlight = false;
        }
      });
    }
  }

  // ── SHARED deck-overlay auto-cycle tick (deck dynamic view overrides) ─────
  //
  // Operator refinement #1: deck overlays auto-advance on ONE SHARED clock, in
  // UNISON — a single anchor + a single delay for the whole overlay group, NOT
  // an independent per-overlay anchor. When the shared timer crosses its delay
  // boundary EVERY auto-advancing overlay advances its OWN playlist cursor at
  // the same instant (each to its own next entry/content). An overlay may be
  // individually paused (its own `enabled` flag); a disabled overlay does not
  // advance, but the SHARED cadence/phase is unaffected so the others stay in
  // step.
  //
  // Driven from the SAME render-loop beforeFrame hook as autoCycleTick (one
  // source of time, the wall clock). The shared autopilot state lives on
  // `mixer.deckOverlayAutopilot` ({active,delay_s,shuffle}) and the transient
  // anchor on `mixer._deckOverlayAnchorMs` (null = not yet seeded; first active
  // tick seeds it without advancing, so the first advance lands a full delay_s
  // later — mirrors the per-channel seed semantics). Actual advances are
  // dispatched OFF the hot path via setImmediate (overlay loadPlaylistEntry is
  // a 50-200ms hard handle swap; awaiting it in-frame would darken the deck).
  // A per-overlay in-flight guard prevents stacking. Compile errors are logged
  // LOUDLY and the overlay keeps its current pattern (Codex P0 — never silent).
  function deckOverlayAutoCycleTick() {
    // Mirror autoCycleTick: skip while a snapshot morph is rebuilding state.
    if (mixer.getMorph && mixer.getMorph()) return;

    const ap = mixer.deckOverlayAutopilot;
    if (!ap || !ap.active) return;
    const overlays = mixer.getDeckOverlays ? mixer.getDeckOverlays() : [];
    if (overlays.length === 0) return;

    const now = Date.now();
    // Seed the SHARED anchor on the first active tick (no advance), then wait
    // until delay_s elapses. delay_s floored to 1s (mirrors the validator) so a
    // stale/zero on-disk value can't strobe.
    if (mixer._deckOverlayAnchorMs === null || mixer._deckOverlayAnchorMs === undefined) {
      mixer._deckOverlayAnchorMs = now;
      return;
    }
    const delayMs = Math.max(1, ap.delay_s) * 1000;
    if (now - mixer._deckOverlayAnchorMs < delayMs) return; // shared 'wait'

    // Due on the SHARED clock: advance the SHARED anchor ONCE for the whole
    // group (single cadence, no drift), then advance EVERY auto-advancing
    // overlay's own cursor in unison. Re-anchor BEFORE dispatch so the next
    // due-check counts from this beat even while compiles drain.
    mixer._deckOverlayAnchorMs = now;
    for (const overlay of overlays) {
      // Individually-paused overlays don't advance, but the shared cadence is
      // unaffected (the anchor already moved above) so the rest stay in step.
      if (!overlay.enabled) continue;
      if (overlay._autoCycleInFlight) continue;
      if (!overlay.playlist || !overlay.playlist.name) continue;
      const pl = playlistManager.load(overlay.playlist.name);
      if (!pl || pl.entries.length === 0) continue;
      // Each overlay picks its OWN next entry from its OWN playlist + cursor,
      // honoring the SHARED shuffle flag (per-overlay content, shared timer).
      const next = pickNextAutoCycleEntry(pl, ap, overlay.playlist.activeEntryId, overlay._autoGroup);
      if (!next) continue; // held / no usable target — stays put this beat
      overlay._autoCycleInFlight = true;
      const targetId = next.id;
      const plName = overlay.playlist.name;
      setImmediate(() => {
        try {
          loadPlaylistEntry(overlay, plName, targetId);
          saveAllState();
          broadcastDeckState();
        } catch (e) {
          // Fail LOUD; keep the current pattern (NOT a silent swallow).
          console.warn(`[DeckOverlayAutoCycle] advance failed on overlay ${overlay.id} → ${targetId}: ${e.message}`);
        } finally {
          overlay._autoCycleInFlight = false;
        }
      });
    }
  }
  // ── Deck pattern transitions (double-buffer via mixer shadow channel) ──
  //
  // `loadPlaylistEntryWithTransition` is the soft-swap sibling of
  // `loadPlaylistEntry`. When the operator has enabled deck transitions
  // (see /deck/transition-config), playlist entry loads on the deck base
  // channel route through here:
  //
  //   1. Compile the new pattern (we need both old + new running
  //      simultaneously during the fade, so we DON'T install on the
  //      base channel yet — that would clobber the live one).
  //   2. Hand the fresh handle to `mixer.triggerDeckPatternSwap`, which
  //      drives a smoothstep fader on a hidden shadow channel composited
  //      ON TOP of the deck buffer using the chosen blend script.
  //   3. On completion (callback), do all the bookkeeping that
  //      `loadPlaylistEntry` would have done up front: CPC re-register,
  //      apply entry defaults, finalize CPC values, update the cursor,
  //      save state, broadcast.
  //
  // If `transitionConfig` is missing or disabled, we fall back to the
  // instant `loadPlaylistEntry`.
  function pickRandomTransitionMode() {
    // Transition shuffle picks a random visual style each swap. We list
    // these explicitly (instead of reading the transitions/ dir) so we
    // can guarantee the picks are scripts the engine knows how to drive
    // via the `progress` argument — adding a new wipe script needs an
    // intentional bump here so a busted script doesn't silently roulette.
    const TRANSITION_OPTIONS = [
      'trans_crossfade', 'trans_flash', 'trans_dissolve',
      'trans_wipe_right', 'trans_wipe_left', 'trans_wipe_down',
      'trans_iris', 'trans_iris_close',
      'trans_diagonal_wipe', 'trans_diamond_wipe',
      'trans_ripple_in', 'trans_color_burst',
      'trans_split_horizontal', 'trans_split_vertical',
      'trans_wave_sweep', 'trans_morse_blink',
    ];
    return TRANSITION_OPTIONS[Math.floor(Math.random() * TRANSITION_OPTIONS.length)];
  }

  /**
   * Returns:
   *   {
   *     entry, index, total,
   *     transitionId : string|null,   // null for instant load
   *     done         : Promise<void>, // resolves on swap completion
   *                                   // (or immediately for instant load)
   *   }
   *
   * `done` is awaited by the autopilot daemon so its inter-pattern timer
   * cleanly stays decoupled from the transition duration — i.e. with
   * delay=1s + transition=5s the cycle is `show 1s → transition 5s → next`
   * instead of an interval-overlap mess where the timer fires every 1s
   * regardless of whether the previous transition has settled.
   *
   * HTTP handlers don't need to await; they read `transitionId` (so the
   * client can correlate the upcoming `deckSwapStarted` broadcast) and
   * respond immediately. Completion drives further broadcasts.
   *
   * Throws if a swap is already in flight — see `cannotStartReason`
   * below for the specific guard. Callers are expected to short-circuit
   * with a 409 (HTTP) or no-op (autopilot).
   */
  function deckSwapInFlightReason() {
    if (mixer.isDeckSwapInFlight && mixer.isDeckSwapInFlight()) {
      return 'swap-already-in-flight';
    }
    return null;
  }

  function loadPlaylistEntryWithTransition(channel, playlistName, entryId, transitionConfig) {
    const enabled = !!(transitionConfig && transitionConfig.enabled);
    if (!enabled) {
      const r = loadPlaylistEntry(channel, playlistName, entryId);
      saveAllState();
      opts.pattern = channel.pattern;
      broadcastWs({ type: 'pattern', name: channel.pattern });
      broadcastMixerState();
      // Warm the predicted-next handle for the next sequential advance.
      if (mixer.getDeckChannel && mixer.getDeckChannel()?.id === channel.id) {
        precompileNextDeckEntry(channel);
      }
      return { ...r, transitionId: null, done: Promise.resolve() };
    }

    // Refuse if a swap is already in flight — taps during a transition
    // are explicitly ignored at the operator's request, not queued.
    const reason = deckSwapInFlightReason();
    if (reason) {
      const err = new Error(reason);
      err.code = 'EBUSY';
      throw err;
    }

    const playlist = playlistManager.load(playlistName);
    if (!playlist) throw new Error(`Playlist not found: ${playlistName}`);
    const idx = playlist.entries.findIndex(e => e.id === entryId);
    if (idx < 0) throw new Error(`Entry not found in ${playlistName}: ${entryId}`);
    const entry = playlist.entries[idx];
    if (entry._missing) throw new Error(`Pattern missing for entry ${entryId}: ${entry.pattern}`);

    // Pre-cancel any pending auto-capture targeting the PREVIOUS entry,
    // same reasoning as in loadPlaylistEntry.
    const pending = captureTimers.get(channel.id);
    if (pending) { clearTimeout(pending); captureTimers.delete(channel.id); }

    // ── Ping-pong handle reuse ──────────────────────────────────────
    // The mixer keeps the previously-active deck handle alive in an
    // INACTIVE slot after every swap completes (its WASM handle stays
    // warm and is ticked each frame). If the operator is ping-ponging
    // A→B→A→B, the inactive slot already holds the target pattern's
    // compiled handle from the last swap — recompiling would burn
    // tens-to-hundreds of ms per tap. We check the inactive slot HERE,
    // BEFORE paying the compile cost. If it's warm, signal reuse to
    // the mixer with newHandle:null.
    //
    // We do NOT reuse if the inactive holds the SAME pattern but the
    // entry has different `defaults` — in that case we want a fresh
    // compile so default application starts from a clean export-table
    // state rather than overwriting whatever the previous swap's
    // controls were when the handle got demoted. (Most playlist
    // entries have empty defaults, so this branch is rare.)
    const inactivePattern = mixer.getInactiveDeckPattern && mixer.getInactiveDeckPattern();
    const wantHandleReuse = inactivePattern === entry.pattern
      && (!entry.defaults || Object.keys(entry.defaults).length === 0);

    let handleForSwap = null;
    let handleExports = null;
    let isReused = false;
    if (wantHandleReuse) {
      const inactiveCh = mixer.getInactiveDeckChannel && mixer.getInactiveDeckChannel();
      handleForSwap = inactiveCh ? inactiveCh.handle : null;
      isReused = !!handleForSwap;
    }
    if (!handleForSwap) {
      const src = loadPattern(patternsDir, entry.pattern);
      const comp = wasmHost.compile(src);
      if (!comp.ok) throw new Error(`Compile error: ${comp.error}`);
      handleForSwap = comp.handle;
    }
    handleExports = wasmHost.getExports(handleForSwap);

    // Resolve transition mode + duration. Shuffle picks a fresh random
    // visual style per swap; otherwise the operator's configured pick wins.
    let transMode = transitionConfig.mode || 'trans_crossfade';
    if (transitionConfig.shuffle) transMode = pickRandomTransitionMode();
    const durationMs = Math.max(50, Math.min(30000, Number(transitionConfig.durationMs) || 1000));

    // CPC needs to know about the inactive handle so it receives
    // global color palette / speed / etc. during the fade. We register
    // under a stable shadow id so it cleans up tidily. On reuse the
    // handle is already warm — re-registering is still cheap and
    // ensures CPC's per-channel snapshot reflects the current global
    // state (which may have shifted since the previous swap).
    if (paramCenter) {
      paramCenter.registerChannel('__deck_swap__', handleForSwap, handleExports);
      if (!isReused) {
        // Execute top-level scope so export var defaults land. Skip on
        // reuse — the handle has been ticking via beginFrame() the
        // whole time (warm in the inactive slot) so its exports are
        // already initialized.
        wasmHost.beginFrame(handleForSwap, 0);
      }
      paramCenter.applyToChannel(wasmHost, '__deck_swap__');
    }
    // Seed the shadow swap handle's sliders to their pattern code defaults so
    // the fading-in pattern reads author intent as its BASE (entry defaults +
    // CPC still layer on top below / via finalizeCpcValues on completion).
    // Skip on reuse — the warm inactive handle was already seeded when it was
    // first compiled and has been ticking since. CPC-owned/blocked sliders are
    // skipped (resolved against the shadow id).
    if (!isReused) {
      try {
        const swapSrc = loadPattern(patternsDir, entry.pattern);
        const { defaults: swapDefaults } = parsePatternDefaults(swapSrc);
        for (const exp of (handleExports || [])) {
          if (exp.kind !== 1) continue;
          if (!(exp.name in swapDefaults)) continue;
          if (paramCenter && paramCenter.isSharedExport('__deck_swap__', exp.name)) continue;
          if (paramCenter && paramCenter.getBlockedIds('__deck_swap__').has(exp.id)) continue;
          wasmHost.setControl(handleForSwap, exp.id, swapDefaults[exp.name], 0, 0);
        }
      } catch (err) {
        console.warn(`[SliderDefaults] deck-swap seed skipped for "${entry.pattern}": ${err.message}`);
      }
    }
    // Apply per-entry defaults to the swap handle directly (not via
    // the channel object — that's still pointing at the active
    // channel). Mimics playlistManager.applyEntryDefaults but bypasses
    // the channel lookup.
    if (entry.defaults && Object.keys(entry.defaults).length > 0) {
      const byName = {};
      for (const e of (handleExports || [])) byName[e.name] = e;
      for (const [name, value] of Object.entries(entry.defaults)) {
        const exp = byName[name];
        if (!exp) continue;
        // Skip CPC-owned + blocked just like applyEntryDefaults does, but
        // resolve against the shadow id.
        if (paramCenter && paramCenter.isSharedExport('__deck_swap__', exp.name)) continue;
        if (paramCenter && paramCenter.getBlockedIds('__deck_swap__').has(exp.id)) continue;
        if (typeof value === 'object' && value !== null) {
          wasmHost.setControl(handleForSwap, exp.id, value.h ?? 0, value.s ?? 0, value.v ?? 0);
        } else {
          wasmHost.setControl(handleForSwap, exp.id, value, 0, 0);
        }
      }
    }

    let resolveDone;
    const done = new Promise((res) => { resolveDone = res; });

    const txid = mixer.triggerDeckPatternSwap({
      // On reuse, signal "use the warm inactive handle" by passing
      // null. Otherwise transfer ownership of the fresh compile to
      // the mixer (it destroys the previously-inactive handle on our
      // behalf).
      newHandle: isReused ? null : handleForSwap,
      patternName: entry.pattern,
      durationMs,
      transitionMode: transMode,
      steadyMode: 'blend_screen',
      onComplete: () => {
        // Handle has been promoted onto `channel` (the base) by the
        // mixer. Finish the bookkeeping that loadPlaylistEntry would
        // normally do synchronously.
        channel.localControls = {};
        // Re-register CPC against the new handle (replaces the old
        // registration in-place for `channel.id`).
        if (paramCenter) {
          paramCenter.registerChannel(channel.id, channel.handle, wasmHost.getExports(channel.handle));
          wasmHost.beginFrame(channel.handle, 0);
          broadcastWs({ type: 'sharedParams', ...paramCenter.getCanonicalState() });
        }
        // Replay per-entry defaults onto the now-installed base handle,
        // then let CPC have the last word.
        playlistManager.applyEntryDefaults(channel, entry, wasmHost, paramRouter, paramCenter);
        finalizeCpcValues(channel);
        // Clean up the shadow CPC registration.
        if (paramCenter && paramCenter.unregisterChannel) {
          paramCenter.unregisterChannel('__deck_swap__');
        }

        channel.playlist = channel.playlist || {};
        channel.playlist.name = playlistName;
        channel.playlist.activeEntryId = entryId;
        channel.playlist.cursor = idx;
        channel.playlist.autopilot = channel.playlist.autopilot || { active: false, delay_s: 30, shuffle: false };
        channel._dirty = false;

        // Refresh modulation context for the new entry now that the
        // deck channel's handle and playlist tuple reflect the swap.
        pushActiveEntryToModulation();

        opts.pattern = channel.pattern;
        saveAllState();
        broadcastWs({ type: 'pattern', name: channel.pattern });
        broadcastWs({ type: 'deckSwapComplete', pattern: channel.pattern, transitionId: txid, transitionMode: transMode });
        broadcastMixerState();
        // Warm the predicted-next handle now that the swap landed and the
        // inactive slot is free again. Sequential autopilot only (the
        // helper guards this) so manual ping-pong warmth is preserved.
        precompileNextDeckEntry(channel);
        // Resolve the autopilot's await so its inter-pattern timer
        // can start its next countdown from a clean baseline.
        try { resolveDone(); } catch (_) {}
      },
    });

    if (!txid) {
      // Swap rejected (e.g. no deck base). Fall back to instant load
      // so the operator's pick still lands instead of vanishing.
      console.warn('[Deck] triggerDeckPatternSwap returned null — falling back to instant load');
      if (paramCenter && paramCenter.unregisterChannel) {
        paramCenter.unregisterChannel('__deck_swap__');
      }
      const r = loadPlaylistEntry(channel, playlistName, entryId);
      saveAllState();
      opts.pattern = channel.pattern;
      broadcastWs({ type: 'pattern', name: channel.pattern });
      broadcastMixerState();
      try { resolveDone(); } catch (_) {}
      return { ...r, transitionId: null, done };
    }

    // Optimistic broadcast so the UI knows a transition is in flight.
    // Final state lands via the onComplete broadcast above.
    broadcastWs({ type: 'deckSwapStarted', pattern: entry.pattern, transitionId: txid, transitionMode: transMode, durationMs });
    return {
      entry, index: idx, total: playlist.entries.length,
      transitionId: txid, done,
    };
  }

  // ── Precompile-next-entry (hot-swap playlist optimization) ───────────
  // After the deck lands on an entry, predict the NEXT entry the operator
  // (or autopilot) will advance to and warm-compile its pattern into the
  // mixer's inactive deck slot. The next advance then reuses a warm handle
  // (zero-compile) instead of stalling on a fresh compile in the request
  // path — the smooth-swap win that feat/timeline_support needs.
  //
  // Prediction is intentionally simple and side-effect-free:
  //   - shuffle autopilot → unpredictable, so we DON'T pre-warm (a wrong
  //     guess would just waste a compile + evict a possibly-useful warm
  //     ping-pong handle).
  //   - otherwise → the next non-missing entry after the active cursor,
  //     wrapping to the top (matches sequential autopilot advance).
  //
  // Safe to call after every deck entry load. Never throws (a prediction
  // failure must not break the load that just succeeded).
  function precompileNextDeckEntry(channel) {
    try {
      if (!channel || !channel.playlist || !channel.playlist.name) return;
      const ap = channel.playlist.autopilot;
      // Only pre-warm during ACTIVE SEQUENTIAL autopilot (the forward
      // timeline-playback scenario). Manual taps are left to the ping-pong
      // warm-keeper so we don't evict a useful back-and-forth handle on a
      // single manual advance. Shuffle is unpredictable → skip.
      if (!ap || !ap.active || ap.shuffle) return;
      const pl = playlistManager.tryLoad(channel.playlist.name);
      if (!pl || pl.entries.length === 0) return;
      const usable = pl.entries.filter(e => !e._missing);
      if (usable.length === 0) return;
      const activeIdx = usable.findIndex(e => e.id === channel.playlist.activeEntryId);
      // Next sequential entry, wrapping. If the active entry isn't found
      // (e.g. it was missing), start from the first usable entry.
      const nextEntry = usable[(activeIdx + 1) % usable.length];
      if (!nextEntry || nextEntry.pattern === channel.pattern) return;
      // Already warm? getInactiveDeckPattern avoids a redundant compile.
      if (mixer.getInactiveDeckPattern && mixer.getInactiveDeckPattern() === nextEntry.pattern) {
        return;
      }
      // Don't fight an in-flight swap — the inactive slot is the live fade
      // target then. warmInactiveDeckHandle also guards this, but checking
      // here avoids a wasted compile.
      if (mixer.isDeckSwapInFlight && mixer.isDeckSwapInFlight()) return;
      const src = loadPattern(patternsDir, nextEntry.pattern);
      const comp = wasmHost.compile(src);
      if (!comp.ok) {
        console.warn(`[Deck] precompile-next skipped for '${nextEntry.pattern}': ${comp.error}`);
        return;
      }
      // Seed top-level scope so the warmed handle's exports are initialized
      // and it ticks correctly while parked.
      wasmHost.beginFrame(comp.handle, 0);
      const installed = mixer.warmInactiveDeckHandle(nextEntry.pattern, comp.handle);
      if (installed) {
        console.log(`[Deck] precompiled next entry '${nextEntry.pattern}' into warm slot`);
      }
    } catch (err) {
      console.warn(`[Deck] precompileNextDeckEntry failed (non-fatal): ${err.message}`);
    }
  }

  // Mission-critical deck-restore visibility (FIX A). Set to a descriptor
  // `{ failedPattern, reason, fellBackTo }` iff the saved deck channel failed
  // to restore and we fell back to the default pattern to keep the exterior
  // LIT. Surfaced on GET /status as `deckRestoreDegraded` so an operator /
  // CaptainPad / smoke-check can SEE that the saved deck didn't restore.
  // Null on a clean boot.
  let deckRestoreDegraded = null;

  // Build a channel (deck or mixer) from a saved-state shape against a given
  // pattern name. Loads + compiles the pattern, installs the channel, re-binds
  // its saved playlist, and replays entry defaults / localControls. THROWS on
  // load or compile failure so the deck-fallback wrapper can react; the mixer
  // path lets the throw bubble to restoreChannel's catch (degrade + warn).
  function buildChannelFromSaved(saved, role, pattern) {
    const src = loadPattern(patternsDir, pattern);
    const comp = wasmHost.compile(src);
    if (!comp.ok) {
      throw new Error(`Failed to compile saved ${role} channel '${pattern}': ${comp.error}`);
    }
    const config = {
      id: saved.id,
      name: saved.name,
      // Use the pattern we actually built — on a deck fallback this is the
      // default, not the broken saved.pattern.
      pattern: pattern,
      handle: comp.handle,
      mode: saved.mode,
      fader: saved.fader,
      enabled: saved.enabled,
      // Restore lock flags so the channel survives engine restart in
      // the same lock state the operator left it in. Pre-fader_lock
      // these were silently dropped; with the new faderLocked field
      // added in slot 5 we plumb them through explicitly. Falsy
      // defaults match the PatternChannel constructor.
      locked: !!saved.locked,
      faderLocked: !!saved.faderLocked,
      // Same reasoning for transition prefs.
      transitionMode: saved.transitionMode || 'trans_crossfade',
      transitionTime: saved.transitionTime || 1.0,
      // Restore view-selection so a mask-restricted channel survives
      // engine restart. setDeckChannel / addMixerChannel will compile
      // the mask immediately via recompileChannelMask (no extra call
      // needed here).
      viewSelection: saved.viewSelection || { type: 'all', target: null, invert: false },
      // F-C / F-D restore. An old state file without these fields restores
      // to the documented schema defaults (faderMax 1.0 = no clamp,
      // color null). The PatternChannel constructor clamps/types both.
      faderMax: typeof saved.faderMax === 'number' ? saved.faderMax : 1.0,
      color: typeof saved.color === 'string' ? saved.color : null,
      // WAVE 15 restore. An old state file without these restores to the
      // documented defaults (mixGroupId null = no group; soloSafe false).
      // The group it points at is restored separately (mixGroups, below) so
      // membership resolves. The PatternChannel ctor types both defensively.
      mixGroupId: typeof saved.mixGroupId === 'string' ? saved.mixGroupId : null,
      soloSafe: !!saved.soloSafe,
      // F-hue restore (docs/39). An old state file without this restores
      // to 0 = no shift (documented schema default). The PatternChannel
      // ctor normalizes into [0,360).
      hue: typeof saved.hue === 'number' ? saved.hue : 0,
      // F-phase #4 restore (docs/39 §F-phase). An old state file without this
      // restores to the documented default (followsTempo false = immune to
      // tap-tempo). The transient _phaseSeconds accumulator is NEVER restored
      // (it starts at 0 on boot).
      followsTempo: !!saved.followsTempo,
      // F-follow restore (docs/39 §F-follow, round-2 #6). An old state file
      // without these restores to the documented defaults (followLeaderId null
      // = not following; followScale 1.0). The leader the pointer names is
      // restored as its own channel separately; if that leader no longer exists
      // after a restore, _effFader reads a missing prev-frame cache entry as 0
      // (the follower tracks down, never crashes) — but the operator should
      // re-link. The PatternChannel ctor types/clamps both defensively.
      followLeaderId: typeof saved.followLeaderId === 'string' ? saved.followLeaderId : null,
      followScale: typeof saved.followScale === 'number' ? saved.followScale : 1.0,
    };
    const ch = role === 'deck'
      ? mixer.setDeckChannel(config)
      : role === 'deckOverlay'
        ? mixer.addDeckOverlay(config)
        : mixer.addMixerChannel(config);
    if (saved.playlist) ch.playlist = saved.playlist;
    onChannelCompiled(ch);

    // Per docs/19_playlists.md §9.3 the playlist entry's `defaults` is the
    // canonical per-slot state. If a playlist+entry survived in saved
    // state, re-apply those defaults; otherwise just replay localControls.
    // tryLoad (not load) so a corrupt active playlist degrades to the
    // localControls fallback instead of aborting the channel restore.
    const pl = ch.playlist && ch.playlist.name && playlistManager.tryLoad(ch.playlist.name);
    const entry = pl && ch.playlist.activeEntryId &&
      pl.entries.find(e => e.id === ch.playlist.activeEntryId);
    // Codex P0: a dangling activeEntryId (the entry was deleted from the
    // playlist since this state was saved) is a restore-time bomb — every
    // later "advance from current entry" lookup would silently no-op
    // against an id that resolves to nothing. Detect it here, WARN loudly,
    // and CLEAR the stale id so the channel is in a clean "no active
    // entry" state rather than carrying a pointer to a ghost. We still
    // fall back to localControls below so the slot keeps its last params.
    const danglingEntryId = pl && ch.playlist.activeEntryId && !entry;
    if (danglingEntryId) {
      console.warn(
        `[Restore] ${role} channel '${ch.id}': playlist '${ch.playlist.name}' ` +
        `has no entry '${ch.playlist.activeEntryId}' (deleted since save) — ` +
        `clearing the stale activeEntryId.`);
      ch.playlist.activeEntryId = null;
    }
    if (entry && !entry._missing) {
      playlistManager.applyEntryDefaults(ch, entry, wasmHost, paramRouter, paramCenter);
    } else if (saved.localControls) {
      for (const [idStr, cv] of Object.entries(saved.localControls)) {
        const controlId = parseInt(idStr, 10);
        if (!getReplayableLocalExport(ch, controlId)) continue;
        paramRouter.setChannelControl(ch.id, controlId, cv.v0, cv.v1, cv.v2);
      }
    }
    // CPC gets the last word — latest color palette, speed, etc. always win
    finalizeCpcValues(ch);
    return ch;
  }

  function restoreChannel(saved, role /* 'deck' | 'mixer' */) {
    if (role === 'deck') {
      // FIX A (mission critical): the deck drives the exterior — it must NEVER
      // boot dark. On ANY failure to restore the saved deck (null/empty/
      // missing-file/compile-fail) fall back to the known-good default pattern
      // and surface a LOUD, VISIBLE degrade (console.error + deckRestoreDegraded
      // on /status). Only a default that ALSO fails throws fatally.
      const { degraded } = restoreDeckWithFallback(
        saved,
        opts.pattern,
        (pattern) => buildChannelFromSaved(saved, 'deck', pattern),
      );
      deckRestoreDegraded = degraded;
      return;
    }
    // Mixer overlay path: a dead overlay degrades + warns (the deck + other
    // overlays stay live). Behavior unchanged from before FIX A.
    try {
      buildChannelFromSaved(saved, 'mixer', saved.pattern);
    } catch (e) {
      console.warn(`Failed to restore ${role} channel ${saved.pattern}:`, e.message);
    }
  }

  const hasDeck = deckState.channel != null;
  const hasMixer = mixerState.channels && mixerState.channels.length > 0;

  if (hasDeck || hasMixer) {
    // Tear down whatever the engine boot created and rebuild from saved
    // state. Boot installs a single deck channel; we destroy it
    // explicitly because the replacement may use the same id (`ch_base`)
    // and we don't want a duplicate handle to leak.
    if (mixer.getDeckChannel()) mixer.removeDeckChannel();
    for (const overlay of [...mixer.getMixerChannels()]) {
      mixer.removeMixerChannel(overlay.id);
    }

    if (hasDeck) {
      restoreChannel(deckState.channel, 'deck');
    } else {
      restoreChannel({
        id: 'ch_base',
        name: 'Base',
        pattern: opts.pattern,
        mode: 'blend_screen',
        fader: 1.0,
        enabled: true
      }, 'deck');
    }

    if (hasMixer) {
      for (const saved of mixerState.channels) {
        // Defensive: skip any leaked deck-shaped id. The state_manager
        // migration also strips these on load, this is belt-and-braces.
        if (saved.id && saved.id.startsWith('ch_base')) continue;
        restoreChannel(saved, 'mixer');
      }
    }

    // Deck dynamic view overrides restore (operator ruling #5): rebuild the
    // deck overlays from deck_state.yaml in saved order (bottom→top), mirroring
    // the mixer restore loop. A dead overlay degrades + warns (the deck + other
    // overlays stay live — never crashes the boot). An old file without
    // `overlays` loads to [] (documented default). The shared overlay autopilot
    // cadence is restored afterward; the transient shared anchor stays null
    // (re-seeds on the first active tick).
    if (Array.isArray(deckState.overlays)) {
      for (const saved of deckState.overlays) {
        try {
          buildChannelFromSaved(saved, 'deckOverlay', saved.pattern);
        } catch (e) {
          console.warn(`Failed to restore deck overlay ${saved && saved.id} (${saved && saved.pattern}):`, e.message);
        }
      }
    }
    if (deckState.overlayAutopilot && typeof deckState.overlayAutopilot === 'object') {
      const oap = deckState.overlayAutopilot;
      mixer.deckOverlayAutopilot = {
        active: !!oap.active,
        // delay floored to 1s (mirrors validateAutoCycleDelay) so a stale/zero
        // on-disk value can't strobe.
        delay_s: (typeof oap.delay_s === 'number' && Number.isFinite(oap.delay_s)) ? Math.max(1, oap.delay_s) : 30,
        shuffle: !!oap.shuffle,
        // PATTERN-GROUP LOCALITY (feat/optimize_channels): absent fields default
        // (off / 3 / 6) so an old state file with no group keys restores clean.
        ...autoGroupFields(oap),
      };
      mixer._deckOverlayAnchorMs = null;
    }

    if (mixerState.master !== undefined) {
      mixer.setMaster(mixerState.master);
    }

    // F-phase #4 (tap-tempo) restore: rebuild the derived _tempoMultiplier
    // from the persisted global tempoBpm. A finite saved value goes through
    // setTempoBpm (which clamps the multiplier); a missing/null/non-finite
    // value leaves the default null tempo (no tempo set) untouched — a
    // documented schema default, not a silent fallback.
    if (typeof mixerState.tempoBpm === 'number' && Number.isFinite(mixerState.tempoBpm)) {
      mixer.setTempoBpm(mixerState.tempoBpm);
    }
    // STICKY tempo source preference restore (operator request 2026-06-29). The
    // selector position survives a restart. Absent/invalid ⇒ the mixer default
    // 'osc' (a documented default, not a silent fallback). The arbiter reads
    // mixer.tempoSourcePref live, so setting it here is sufficient.
    if (mixerState.tempoSourcePref === 'osc' || mixerState.tempoSourcePref === 'tap') {
      mixer.tempoSourcePref = mixerState.tempoSourcePref;
    }

    const base = mixer.getDeckChannel();
    if (base) opts.pattern = base.pattern;
    // WAVE 15: restore the gang-fader group registry so member channels'
    // mixGroupId pointers resolve. Done after channels (membership is a
    // channel→group pointer the channels already carry). Defensive — skip
    // malformed entries rather than abort the whole boot.
    restoreMixGroups();
  } else {
    if (mixer.getDeckChannel()) finalizeCpcValues(mixer.getDeckChannel());
    for (const ch of mixer.getMixerChannels()) finalizeCpcValues(ch);
    // WAVE 15: a state file with a group registry but no surviving channels
    // is still worth restoring (the operator may re-add members). Idempotent.
    restoreMixGroups();
  }

  // ── Named mixer snapshots / look recall (F-A) ─────────────────────────
  //
  // captureLook() serializes the FULL mixer state (master + the deck channel
  // + every overlay) into the same on-disk channel shape buildChannelFromSaved
  // restores from — so a captured look round-trips through recall identically
  // to an engine restart. recallLook() reuses the existing build/setter
  // machinery (buildChannelFromSaved → setDeckChannel/addMixerChannel) and
  // RESPECTS maxChannels: it removes every current overlay, then re-adds the
  // snapshot's overlays up to the cap. A snapshot with more overlays than the
  // cap is a fail-loud condition (the caller 400s) — not a silent truncation.
  function captureLook() {
    const deck = mixer.getDeckChannel();
    return {
      master: mixer.master,
      deck: deck ? serializeChannelForState(deck) : null,
      channels: mixer.getMixerChannels().map(c => serializeChannelForState(c)),
      // WAVE 15: groups ride in the look so a recall reproduces the gang
      // faders + membership exactly (members' mixGroupId is in `channels`).
      mixGroups: mixer.getMixGroups().map(g => ({
        id: g.id, name: g.name, fader: g.fader, muted: g.muted, color: g.color,
      })),
    };
  }

  // WAVE 15: rebuild the gang-fader group registry from saved/snapshot state.
  // Validates each entry defensively — a malformed group is skipped + warned
  // rather than aborting boot. The mixer's createMixGroup mints fresh ids, so
  // we install groups directly to PRESERVE the saved id (member pointers
  // reference it). Called at boot and on look recall.
  function restoreMixGroups(savedGroups) {
    const groups = Array.isArray(savedGroups)
      ? savedGroups
      : (Array.isArray(mixerState.mixGroups) ? mixerState.mixGroups : []);
    mixer.mixGroups = [];
    let maxCounter = 0;
    for (const g of groups) {
      if (!g || typeof g.id !== 'string' || g.id.length === 0) {
        console.warn('[Restore] skipping malformed mix group (missing id):', g);
        continue;
      }
      mixer.mixGroups.push({
        id: g.id,
        name: (typeof g.name === 'string') ? g.name : g.id,
        fader: (typeof g.fader === 'number' && Number.isFinite(g.fader)) ? Math.max(0, Math.min(1, g.fader)) : 1.0,
        muted: !!g.muted,
        color: (typeof g.color === 'string') ? g.color : null,
      });
      // Keep the counter ahead of any restored id of the form mg_<n>_<ts> so
      // a freshly-created group can't collide with a restored one.
      const m = /^mg_(\d+)_/.exec(g.id);
      if (m) { const n = parseInt(m[1], 10); if (Number.isFinite(n) && n > maxCounter) maxCounter = n; }
    }
    if (maxCounter > mixer._mixGroupCounter) mixer._mixGroupCounter = maxCounter;
  }

  // Apply a loaded snapshot to the live mixer. Throws on a structurally
  // invalid look (over-cap overlay count, deck rebuild failure) so the route
  // can surface a real error instead of half-applying. Best-effort per overlay
  // (a dead overlay degrades + warns, matching restoreChannel's mixer path).
  function recallLook(look) {
    if (!look || typeof look !== 'object') {
      throw new Error('recallLook: look must be an object');
    }
    const overlays = Array.isArray(look.channels) ? look.channels : [];
    if (overlays.length > mixer.maxChannels) {
      const err = new Error(
        `Snapshot has ${overlays.length} overlays but the mixer cap is ` +
        `${mixer.maxChannels}`);
      err.code = 'SNAPSHOT_OVER_CAP';
      throw err;
    }
    // Tear down the current overlays (unregister CPC + destroy handles via the
    // existing remover). The deck channel is rebuilt in place below.
    for (const overlay of [...mixer.getMixerChannels()]) {
      if (paramCenter) paramCenter.unregisterChannel(overlay.id);
      mixer.removeMixerChannel(overlay.id);
    }
    // Deck: rebuild from the snapshot if present (reuses the mission-critical
    // never-dark fallback). If the snapshot carried no deck, leave the live
    // deck untouched rather than going dark.
    if (look.deck) {
      if (mixer.getDeckChannel()) {
        if (paramCenter) paramCenter.unregisterChannel(mixer.getDeckChannel().id);
        mixer.removeDeckChannel();
      }
      restoreChannel(look.deck, 'deck');
    }
    // Overlays: rebuild each through the same degrade-tolerant path as boot.
    for (const saved of overlays) {
      if (saved && saved.id && saved.id.startsWith('ch_base')) continue;
      restoreChannel(saved, 'mixer');
    }
    // WAVE 15: restore the look's group registry (members' mixGroupId came
    // back with the overlay rebuild above). A look without mixGroups (older
    // snapshot) clears the registry to [] — the recalled overlays carry no
    // membership in that case either, so nothing dangles.
    restoreMixGroups(Array.isArray(look.mixGroups) ? look.mixGroups : []);
    // Master last (setMaster cancels any in-flight fade — a recall is a hard
    // set of the whole look, not an animation).
    if (typeof look.master === 'number' && Number.isFinite(look.master)) {
      mixer.setMaster(look.master);
    }
  }

  // ── Snapshot crossfade / morph (round-2 #1) ───────────────────────────
  //
  // morphToLook(look, durationMs) is the RAMPED sibling of recallLook(): it
  // brings the live mix to `look` by ANIMATING current→target over durationMs
  // instead of the instant teardown+rebuild recallLook does. It reuses the
  // engine's existing animation machinery wholesale — per-channel fadeChannel
  // transitions[], the grand-master _masterFade, and the morph group fades
  // (_groupFades) — and owns the build (T channels) + CPC bookkeeping. The
  // mixer's _morph descriptor + _tickMorph drive the single completion
  // finalizer (onMorphComplete, wired below) that CPC-unregisters the
  // faded-out channels, persists, and broadcasts.
  //
  // Channel semantics (match by channel ID), v1 RAMP LEVELS ONLY:
  //   M (id in both):    SNAP structural/chroma (rebuild content so a changed
  //                      pattern/mode/view/faderMax/color/hue/group takes
  //                      effect at kickoff), but RAMP the fader current→target.
  //   T (target only):   build at fader 0 + enabled, then ramp 0→target fader.
  //   C (current only):  ramp fader →0 with destroyOnComplete; the finalizer
  //                      CPC-unregisters the id (removeChannel does NOT).
  // Master: startMasterFade. Groups: ramp the fader of groups present in BOTH;
  // snap (no ramp) groups that are target-only (they didn't exist to ramp
  // from). Deck: SNAP content (mission-critical never-dark), RAMP its fader.
  //
  // v1 DEFERRALS (documented, additive-safe): hue/color/faderMax are SNAPPED
  // at kickoff, not ramped — color is metadata (no render), faderMax is a
  // non-linear ceiling, hue is angular (needs short-arc interpolation). See
  // docs/39 §10.8. Fader-locked channels are skipped by fadeChannel (their
  // parked level is sacred); their structural snap still applies.
  //
  // Throws on a structurally invalid look (over-cap UNION, deck rebuild
  // failure) so the route surfaces a real error instead of half-applying.
  // The UNION cap check is the transient-cap guard: while a morph is in
  // flight the current-only (C) channels still exist (fading out) WHILE the
  // target-only (T) channels are added, so the peak channel count is the
  // union, not the target count. Over-cap ⇒ fail-loud SNAPSHOT_OVER_CAP, no
  // silent truncation (Codex P0).
  function morphToLook(look, durationMs) {
    if (!look || typeof look !== 'object') {
      throw new Error('morphToLook: look must be an object');
    }
    if (!Number.isFinite(durationMs) || durationMs <= 0) {
      // Defensive re-validation — the route validates first, but never mutate
      // on a bad duration.
      const err = new Error(`morphToLook: durationMs must be finite > 0, got ${durationMs}`);
      err.code = 'MORPH_BAD_DURATION';
      throw err;
    }

    const targetOverlays = (Array.isArray(look.channels) ? look.channels : [])
      .filter(s => s && !(typeof s.id === 'string' && s.id.startsWith('ch_base')));
    const currentOverlays = mixer.getMixerChannels();

    // ── Transient UNION cap check (BEFORE any mutation) ──────────────────
    const unionIds = new Set();
    for (const c of currentOverlays) unionIds.add(c.id);
    for (const s of targetOverlays) if (s && typeof s.id === 'string') unionIds.add(s.id);
    if (unionIds.size > mixer.maxChannels) {
      const err = new Error(
        `Morph would peak at ${unionIds.size} overlays (current ∪ target) but the ` +
        `mixer cap is ${mixer.maxChannels}`);
      err.code = 'SNAPSHOT_OVER_CAP';
      throw err;
    }

    // Classify by id. M = in both, T = target-only, C = current-only.
    const targetById = new Map();
    for (const s of targetOverlays) if (s && typeof s.id === 'string') targetById.set(s.id, s);
    const currentById = new Map();
    for (const c of currentOverlays) currentById.set(c.id, c);

    // ── Arm the morph descriptor + cancel any conflicting in-flight state ─
    // Kickoff cancels/replaces a prior morph, the grand-master fade (auto via
    // startMasterFade below), per-channel transitions (auto via fadeChannel's
    // cancelChannelTransition), the deck swap, and clears solo (transient —
    // a stuck solo would gate the morph's losers to black mid-ramp).
    mixer.cancelMorph();
    mixer.cancelAllGroupFades();
    mixer.cancelDeckPatternSwap();
    mixer.soloedChannelIds.clear();
    if (typeof mixer.clearBumps === 'function') mixer.clearBumps();

    // ── C: current-only channels ramp to 0 + are removed on completion ───
    // Schedule the fade-out FIRST (before rebuilds) so destroyOnComplete +
    // the finalizer CPC-unregister own the teardown. fadeChannel refuses
    // fader-locked channels (returns false) — those stay put; document.
    const fadeOutIds = [];
    for (const c of currentOverlays) {
      if (targetById.has(c.id)) continue; // M handled below
      c.enabled = true; // ensure it's visible so the fade-out actually reads
      const scheduled = mixer.fadeChannel(c.id, 0, durationMs, {
        curve: 'smoothstep',
        destroyOnComplete: true,
      });
      // Track every current-only id for finalizer CPC cleanup. Even a
      // fader-locked channel (scheduled=false, won't auto-remove) is left
      // alone — it's not part of the target, but ripping it out mid-morph
      // would be a silent structural change; v1 leaves locked C channels in
      // place and documents it. Only push ids we actually fade out.
      if (scheduled) fadeOutIds.push(c.id);
    }

    // ── M: id in both — SNAP structural by rebuild, RAMP the fader ───────
    // We rebuild the channel from the target's saved shape so a changed
    // pattern/mode/view/chroma takes effect at kickoff, then anchor the
    // rebuilt channel's fader at the CURRENT (pre-morph) value and ramp it to
    // the target fader. Rebuild = remove (CPC unregister + destroy handle) +
    // re-add through the same degrade-tolerant restoreChannel path recall
    // uses. The fader is the only thing that animates.
    for (const [id, saved] of targetById) {
      if (!currentById.has(id)) continue; // T handled below
      const startFader = currentById.get(id).fader;
      const targetFader = (typeof saved.fader === 'number' && Number.isFinite(saved.fader))
        ? Math.max(0, Math.min(1, saved.fader))
        : 1.0;
      if (paramCenter) paramCenter.unregisterChannel(id);
      mixer.removeMixerChannel(id);
      restoreChannel(saved, 'mixer');
      const rebuilt = mixer.getMixerChannel(id);
      if (rebuilt) {
        rebuilt.enabled = true;
        rebuilt.fader = startFader; // anchor at the pre-morph level
        mixer.fadeChannel(id, targetFader, durationMs, { curve: 'smoothstep' });
      }
    }

    // ── T: target-only — build at fader 0, then ramp 0→target fader ─────
    for (const [id, saved] of targetById) {
      if (currentById.has(id)) continue; // M handled above
      const targetFader = (typeof saved.fader === 'number' && Number.isFinite(saved.fader))
        ? Math.max(0, Math.min(1, saved.fader))
        : 1.0;
      restoreChannel(saved, 'mixer');
      const built = mixer.getMixerChannel(id);
      if (built) {
        built.enabled = true;
        built.fader = 0; // start dark, ramp up
        mixer.fadeChannel(id, targetFader, durationMs, { curve: 'smoothstep' });
      }
    }

    // ── Deck: SNAP content (never-dark), RAMP the fader ─────────────────
    // Rebuild the deck from the snapshot (mission-critical never-dark
    // fallback inside restoreChannel), anchored at the current deck fader,
    // then ramp to the snapshot's deck fader. If the snapshot carried no
    // deck, leave the live deck untouched (don't go dark).
    if (look.deck) {
      const liveDeck = mixer.getDeckChannel();
      const deckStartFader = liveDeck ? liveDeck.fader : 0;
      const deckTargetFader = (typeof look.deck.fader === 'number' && Number.isFinite(look.deck.fader))
        ? Math.max(0, Math.min(1, look.deck.fader))
        : 1.0;
      const deckId = look.deck.id;
      if (liveDeck) {
        if (paramCenter) paramCenter.unregisterChannel(liveDeck.id);
        mixer.removeDeckChannel();
      }
      restoreChannel(look.deck, 'deck');
      const rebuiltDeck = mixer.getDeckChannel();
      if (rebuiltDeck && rebuiltDeck.id === deckId && !rebuiltDeck.faderLocked) {
        rebuiltDeck.enabled = true;
        rebuiltDeck.fader = deckStartFader;
        mixer.fadeChannel(deckId, deckTargetFader, durationMs, { curve: 'smoothstep' });
      }
    }

    // ── Groups: ramp groups in BOTH, snap target-only groups ────────────
    // Capture the live group faders by id, install the target group registry
    // (restoreMixGroups replaces it wholesale, preserving the saved id so
    // member pointers resolve), then for any group that existed BEFORE too,
    // rewind its fader to the pre-morph value and ramp it to the target.
    // Target-only groups stay at their snapshot fader (nothing to ramp from).
    const priorGroupFaders = new Map();
    for (const g of mixer.getMixGroups()) priorGroupFaders.set(g.id, g.fader);
    restoreMixGroups(Array.isArray(look.mixGroups) ? look.mixGroups : []);
    for (const g of mixer.getMixGroups()) {
      if (!priorGroupFaders.has(g.id)) continue; // target-only → snap
      const startF = priorGroupFaders.get(g.id);
      const targetF = g.fader;
      if (startF === targetF) continue; // already there, no ramp needed
      g.fader = startF; // rewind to pre-morph level
      mixer.startGroupFade(g.id, targetF, durationMs);
    }

    // ── Master: ramp current→target ────────────────────────────────────
    if (typeof look.master === 'number' && Number.isFinite(look.master)) {
      mixer.startMasterFade(look.master, durationMs);
    }

    // ── Arm the completion window. The ramps above all share durationMs, so
    // they land on the same wall-clock boundary _tickMorph watches; the
    // finalizer then CPC-unregisters the faded-out ids + persists.
    mixer.beginMorph(durationMs, fadeOutIds);
  }

  // ── Mixer UNDO (round-2 #10, docs/39 §F-undo) ─────────────────────────
  //
  // A bounded, SESSION-ONLY ring of full captureLook() snapshots taken
  // BEFORE each DESTRUCTIVE mixer mutation. Undo pops the most recent look
  // and restores it through the proven never-dark recallLook() path. See
  // lib/undo_stack.js for the rationale (ring of looks vs inverse-op log;
  // session-only vs persisted). pushUndo() is the single choke point: it is
  // called as the FIRST line — BEFORE the mutation — in each destructive
  // route, so the captured look is always the PRE-mutation state.
  //
  // NOT pushed: fader/hue/speed/etc PATCH writes (non-destructive,
  // high-frequency — pushing them would flood the ring and bury the
  // structural action the operator actually wants to undo). Undo scope is
  // STRUCTURAL mutations only.
  const undoStack = new UndoStack(UNDO_MAX);

  // Broadcast the undo button's enable/label state. ONE typed message on
  // /ws/control (registered in ws_topic_routing TOPIC_BY_TYPE), emitted on
  // every push + every undo so CaptainPad mirrors depth/top live. Replayed
  // on /ws/control connect (see wssControl 'connection' below).
  function broadcastUndoState() {
    broadcastWs({ type: 'undoState', depth: undoStack.depth, top: undoStack.topLabel });
  }

  // The choke point. Call as the FIRST line of a destructive route, BEFORE
  // mutating the mixer, so captureLook() records the PRE-mutation look. The
  // ring is bounded (oldest dropped at UNDO_MAX) inside UndoStack.push.
  function pushUndo(label) {
    undoStack.push({ label, look: captureLook(), atMs: Date.now() });
    broadcastUndoState();
  }

  // ── Channel serialization (post-split) ────────────────────────────
  //
  // After the May 2026 channel split, /mixer surfaces ONLY overlay
  // channels and /deck/channel surfaces the deck channel. The two
  // payloads use the same per-channel shape (so the iPad's renderer
  // doesn't have to fork). The deck channel is intentionally NOT
  // returned in the mixer broadcast — a regression test
  // (hil_channel_isolation_test.mjs) asserts this invariant on every
  // engine boot.
  function serializeChannel(c) {
    return {
      id: c.id,
      name: c.name,
      pattern: c.pattern,
      mode: c.mode.startsWith('trans_') ? 'blend_screen' : c.mode,
      fader: c.fader,
      enabled: c.enabled,
      locked: !!c.locked,
      // Fader-lock: surfaced so CaptainPad can render the lock icon
      // and skip the channel in client-side solo gestures. Independent
      // of `locked` (the playlist/pattern lock). See
      // PatternChannel.faderLocked for the four semantic rules.
      faderLocked: !!c.faderLocked,
      // `dirty` is true iff the operator changed a param *while this
      // channel was locked*. Drives the unlock-time save-or-discard
      // prompt on the client. Cleared on lock toggle / capture /
      // discard / entry swap (see markChannelDirtyIfLocked +
      // clearChannelDirty).
      dirty: !!c._dirty,
      transitionMode: c.transitionMode || 'trans_crossfade',
      transitionTime: c.transitionTime || 1.0,
      playlist: c.playlist || null,
      viewSelection: c.viewSelection || { type: 'all', target: null, invert: false },
      // F-C: per-channel intensity ceiling (hard cap on this channel's own
      // contribution). Default 1.0 = no clamp. F-D: per-channel color
      // metadata (no render effect). Surfaced so CaptainPad can show the
      // clamp slider + color chip. See docs/39 §F-C/§F-D.
      faderMax: typeof c.faderMax === 'number' ? c.faderMax : 1.0,
      color: typeof c.color === 'string' ? c.color : null,
      // WAVE 15: gang-fader group membership pointer (null = no group) +
      // solo-safe rig flag. Surfaced so CaptainPad can render the group rail
      // chip + the solo-safe toggle. See docs/39 §F-group/§F-solo.
      mixGroupId: typeof c.mixGroupId === 'string' ? c.mixGroupId : null,
      soloSafe: !!c.soloSafe,
      // F-hue (docs/39): per-channel hue rotation in degrees [0,360).
      // Surfaced so CaptainPad can render the per-channel HUE control. A
      // channel without the field (old engine) serializes 0 = no shift.
      hue: typeof c.hue === 'number' ? c.hue : 0,
      // F-phase (docs/39 §F-phase #4): tap-tempo opt-in. Surfaced so CaptainPad
      // can render the FOLLOW TEMPO toggle. The transient _phaseSeconds
      // accumulator is NEVER surfaced. Default false for an old engine without
      // the field.
      followsTempo: !!c.followsTempo,
      // F-follow (docs/39 §F-follow, round-2 #6): channel FOLLOW/LINK. Surfaced
      // so CaptainPad can render the follow picker + scale. followLeaderId is
      // the leader channel id (null = not following). followScale multiplies
      // the leader's effective level [0,2]. A channel without the fields (old
      // engine) serializes null / 1.0 = no follow.
      followLeaderId: typeof c.followLeaderId === 'string' ? c.followLeaderId : null,
      followScale: typeof c.followScale === 'number' ? c.followScale : 1.0,
      // CPC-matched exports are tagged with `cpcOwned`/`cpcKey`/
      // `cpcLabel` so the iPad can show a disabled "MATCHED · SPEED"
      // badge instead of silently hiding them — see notes in the
      // pre-split serializer for the May 2026 reasoning.
      exports: annotateCodeDefaults(c, wasmHost.getExports(c.handle)
        .filter(e => localControlKinds.has(e.kind))
        .map(e => {
          const cv = c.localControls[e.id];
          if (cv) { e.v0 = cv.v0; e.v1 = cv.v1; e.v2 = cv.v2; }
          const owned = paramCenter ? paramCenter.cpcKeyForExport(c.id, e) : null;
          if (owned) {
            e.cpcOwned = true;
            e.cpcKey = owned.key;
            e.cpcLabel = owned.label;
          }
          return e;
        }))
    };
  }

  function serializeDeckChannel() {
    const deck = mixer.getDeckChannel();
    return deck ? serializeChannel(deck) : null;
  }

  function serializeDeckState() {
    return {
      type: 'deck',
      blackout: globalsState.blackout,
      master: mixer.master,
      // F-B: in-flight grand-master fade descriptor, or null when steady.
      // Lets the deck tab show a fade-in-progress affordance.
      masterFade: mixer.getMasterFade ? mixer.getMasterFade() : null,
      channel: serializeDeckChannel(),
      // Deck dynamic view overrides (deck overlays). Folded into the `deck`
      // WS message (the deck tab already subscribes) so existing subscribers
      // get them free — NO new WS type. order[0] = bottom, order[last] = top.
      // Each overlay serialized with the full channel shape (serializeChannel)
      // PLUS its compiled view + the overlay-specific color accent.
      overlays: (mixer.getDeckOverlays ? mixer.getDeckOverlays() : []).map(serializeChannel),
      // SHARED deck-overlay autopilot cadence (operator refinement #1): ONE
      // clock for the whole overlay group. The transient anchor
      // (_deckOverlayAnchorMs) is NOT surfaced. delay_s/shuffle persist;
      // active is the live arm flag.
      overlayAutopilot: {
        active: !!(mixer.deckOverlayAutopilot && mixer.deckOverlayAutopilot.active),
        delay_s: (mixer.deckOverlayAutopilot && typeof mixer.deckOverlayAutopilot.delay_s === 'number')
          ? mixer.deckOverlayAutopilot.delay_s : 30,
        shuffle: !!(mixer.deckOverlayAutopilot && mixer.deckOverlayAutopilot.shuffle),
        ...autoGroupFields(mixer.deckOverlayAutopilot),
      },
    };
  }

  function broadcastDeckState() {
    broadcastWs(serializeDeckState());
  }

  // Single source of truth for serializing mixer state — used by
  // GET /mixer, broadcastMixerState(), and WS connect.
  //
  // Post-split: `channels` contains ONLY mixer overlays. The deck
  // channel goes through serializeDeckChannel(). `baseChannelId` is
  // surfaced for legacy clients that still want to display the deck's
  // id, but the deck channel itself is no longer in `channels`.
  function serializeMixerState() {
    return {
      type: 'mixer',
      blackout: globalsState.blackout,
      // Model-sync flag — true when the engine refused a model hot
      // reload (e.g. pixel count changed) and is still rendering a
      // STALE model. Set/cleared by the hot-reload path in engine.js.
      modelStale: !!(engineCore.modelSync && engineCore.modelSync.stale),
      modelStaleMessage: (engineCore.modelSync && engineCore.modelSync.message) || null,
      master: mixer.master,
      // F-B: in-flight grand-master fade descriptor (null when steady).
      masterFade: mixer.getMasterFade ? mixer.getMasterFade() : null,
      maxChannels: mixer.maxChannels,
      baseChannelId: mixer.baseChannelId,
      channels: mixer.getMixerChannels().map(c => ({
        id: c.id,
        name: c.name,
        pattern: c.pattern,
        mode: c.mode.startsWith('trans_') ? 'blend_screen' : c.mode,
        fader: c.fader,
        enabled: c.enabled,
        locked: !!c.locked,
        // Fader-lock — see serializeChannel above for semantics.
        faderLocked: !!c.faderLocked,
        // `dirty` is true iff the operator changed a param *while this
        // channel was locked*. Drives the unlock-time save-or-discard
        // prompt on the client. Cleared on lock toggle / capture / discard
        // / entry swap (see markChannelDirtyIfLocked + clearChannelDirty).
        dirty: !!c._dirty,
        transitionMode: c.transitionMode || 'trans_crossfade',
        transitionTime: c.transitionTime || 1.0,
        // View-selection: per-channel masking config (which group/section/
        // fixture/viewMask the channel paints). Broadcast so CaptainPad
        // can show / set the selection per channel strip. See
        // docs/27_[todo]_mixer_layer_view_selection.md.
        viewSelection: c.viewSelection || { type: 'all', target: null, invert: false },
        // Playlist assignment is the "where am I right now in this slot"
        // pointer. Broadcasting it lets the deck and mixer panels detect
        // cross-tab swaps without polling.
        playlist: c.playlist || null,
        // F-C / F-D: per-channel intensity ceiling + color metadata. See
        // serializeChannel above for semantics.
        faderMax: typeof c.faderMax === 'number' ? c.faderMax : 1.0,
        color: typeof c.color === 'string' ? c.color : null,
        // WAVE 15: gang-fader group membership + solo-safe flag. See
        // serializeChannel above for semantics. docs/39 §F-group/§F-solo.
        mixGroupId: typeof c.mixGroupId === 'string' ? c.mixGroupId : null,
        soloSafe: !!c.soloSafe,
        // F-hue (docs/39): per-channel hue rotation. See serializeChannel
        // above for semantics. 0 = no shift.
        hue: typeof c.hue === 'number' ? c.hue : 0,
        // F-phase (docs/39 §F-phase #4): tap-tempo opt-in. See serializeChannel
        // above for semantics. Default false. _phaseSeconds is transient and
        // never surfaced.
        followsTempo: !!c.followsTempo,
        // F-follow (docs/39 §F-follow, round-2 #6): FOLLOW/LINK. See
        // serializeChannel above for semantics. null / 1.0 = no follow.
        followLeaderId: typeof c.followLeaderId === 'string' ? c.followLeaderId : null,
        followScale: typeof c.followScale === 'number' ? c.followScale : 1.0,
        // CPC-matched exports used to be filtered out here. As of
        // May 2026 they're SURFACED with a `cpcOwned` / `cpcKey` /
        // `cpcLabel` tag so the UI can show a disabled "MATCHED ·
        // SPEED" badge instead of silently hiding them — operators
        // want to see what each pattern declares, even when a global
        // is driving the underlying variable. The /control write
        // path still no-ops on these exports (getReplayableLocalExport
        // returns null for shared IDs), so re-exposing them in the
        // payload doesn't open a back-channel write.
        exports: annotateCodeDefaults(c, wasmHost.getExports(c.handle)
          .filter(e => localControlKinds.has(e.kind))
          .map(e => {
            const cv = c.localControls[e.id];
            if (cv) { e.v0 = cv.v0; e.v1 = cv.v1; e.v2 = cv.v2; }
            const owned = paramCenter ? paramCenter.cpcKeyForExport(c.id, e) : null;
            if (owned) {
              e.cpcOwned = true;
              e.cpcKey = owned.key;
              e.cpcLabel = owned.label;
            }
            return e;
          }))
      })),
      // WAVE 15: the gang-fader group registry and the server-authoritative
      // solo set. soloedChannelIds is an ARRAY snapshot of the transient Set
      // (the client reconciles its display-only dim/active state from this on
      // every broadcast; it survives reconnect because it lives server-side).
      mixGroups: mixer.getMixGroups().map(g => ({
        id: g.id, name: g.name, fader: g.fader, muted: g.muted, color: g.color,
      })),
      soloedChannelIds: [...mixer.soloedChannelIds],
      // FLASH / BUMP (round-2 #5, docs/39 §10.7): the transient momentary-full
      // set. ARRAY snapshot of the Set — the client reconciles its "held" button
      // display from this on every broadcast. NOT persisted (transient, like
      // solo); empty after a restart.
      bumpedChannelIds: [...mixer._bumpedChannelIds],
      // F-phase #4 (tap-tempo): the GLOBAL operator-tapped tempo. null =
      // no tempo set (documented default — distinct from a tapped value).
      // Affects only channels that opted in (followsTempo). The derived
      // _tempoMultiplier is NOT surfaced (recomputed from bpm on the
      // client / on restore). Rides the mixer-state broadcast — no new WS
      // message type needed.
      tempoBpm: (typeof mixer.tempoBpm === 'number' && Number.isFinite(mixer.tempoBpm))
        ? mixer.tempoBpm
        : null,
      // TEMPO ARBITRATION: the LIVE status of how tempoBpm is being driven —
      // for the colour/liveness accent (NOT the selector highlight):
      //   'osc'    — OSC selected and live, auto-following.
      //   'manual' — TAP is the sticky source (the tapped tempo owns it).
      //   'held'   — OSC selected but stale/off, the last value just holding.
      // `tempoSourcePref` is the STICKY operator selection ('osc' | 'tap') the
      // OSC/TAP selector highlights — it does NOT flap with OSC liveness, so a
      // brief OSC dropout reads as 'held' here while the selector stays on OSC.
      // `oscTempoBpm` is the RAW live OSC value (clamped) or null when stale —
      // distinct from the applied `tempoBpm`. All ride the existing mixer-state
      // broadcast; the legacy `tempoBpm` field is unchanged.
      tempoSource: engineCore.tempoArbiter
        ? engineCore.tempoArbiter.deriveSource()
        : 'held',
      tempoSourcePref: engineCore.tempoArbiter
        ? engineCore.tempoArbiter.sourcePref()
        : (mixer.tempoSourcePref === 'tap' ? 'tap' : 'osc'),
      oscTempoBpm: engineCore.tempoArbiter
        ? engineCore.tempoArbiter.oscTempoBpm()
        : null,
    };
  }

  function broadcastMixerState() {
    // Post-split: every "mixer changed" event also implicitly carries
    // deck-state implications (e.g. master changed; blackout flipped;
    // playlist entries fired CPC writes that the deck cares about).
    // Broadcast BOTH events back-to-back so subscribers only have to
    // pick the message type they care about. Deck-only changes have
    // their own callers that fire just `broadcastDeckState()`.
    broadcastWs(serializeMixerState());
    broadcastWs(serializeDeckState());
  }

  // ── Channel-id role enforcement ─────────────────────────────────────
  //
  // Bullet-proofs the deck-vs-mixer isolation at the API boundary. The
  // mixer routes (`/mixer/channels/:id/...`) must NEVER accept the
  // deck channel's id; the deck routes (`/deck/...`) must never accept
  // a mixer overlay's id.
  //
  //   - returns null if `id` is appropriate for the given role
  //   - returns a `{ status, body }` triple the route handler should
  //     send back to the client otherwise
  function rejectIfWrongRole(id, role /* 'mixer' | 'deck' */) {
    if (role === 'mixer') {
      if (mixer.deckChannel && id === mixer.deckChannel.id) {
        return {
          status: 400,
          body: {
            error: 'deck channel cannot be addressed via /mixer routes',
            code: 'WRONG_ROLE',
            channelId: id,
            useInstead: '/deck/channel',
          },
        };
      }
    } else if (role === 'deck') {
      if (mixer.deckChannel && id !== mixer.deckChannel.id) {
        return {
          status: 400,
          body: {
            error: 'this id is not the deck channel',
            code: 'WRONG_ROLE',
            channelId: id,
            useInstead: `/mixer/channels/${encodeURIComponent(id)}`,
          },
        };
      }
    }
    return null;
  }

  // Push the FULL playlist content (entries + defaults) for a channel
  // out over WS as a dedicated event, so every connected client can
  // prime its per-name playlist cache without having to issue a
  // follow-up GET /playlists/<name>. Called on channel add and on
  // playlist swap — both right BEFORE broadcastMixerState() so the
  // iPad processes the cache-prime BEFORE it mounts the new
  // PlaylistPanel off the mixer event. Without this ordering,
  // the panel would race the POST response and risk timing out
  // on the entries fetch.
  function broadcastChannelPlaylistData(channel) {
    try {
      if (!channel || !channel.playlist || !channel.playlist.name) return;
      const pl = playlistManager.load(channel.playlist.name);
      if (!pl) return;
      broadcastWs({
        type: 'channelPlaylistData',
        channelId: channel.id,
        playlist: channel.playlist,
        playlistData: pl,
      });
    } catch (e) {
      console.warn('[api_server] broadcastChannelPlaylistData failed:', e.message);
    }
  }

  // ── Server-driven group transitions ───────────────────────────────────
  // The mixer's updateTransitions() runs once per render tick (40 Hz) and
  // calls back to us whenever a transition is making progress. We throttle
  // those frame-rate callbacks down to 10 Hz of WS broadcasts so the iPad's
  // slider UI updates smoothly without flooding the WS. On completion we
  // do ONE save + broadcast — that's the canonical end-of-transition state.
  // Per agent review (May 2026): the completion callback fires exactly
  // once per transition group, even if N channels finish on the same tick,
  // so we never call saveAllState() N times.
  let lastTransitionBroadcastMs = 0;
  mixer.onTransitionProgress = () => {
    const now = Date.now();
    if (now - lastTransitionBroadcastMs >= 100) {
      lastTransitionBroadcastMs = now;
      broadcastMixerState();
    }
  };
  mixer.onTransitionComplete = ({ transitionId } = {}) => {
    lastTransitionBroadcastMs = 0; // unthrottle the next transition's first broadcast
    saveAllState();
    broadcastWs({
      type: 'mixerTransitionComplete',
      transitionId: transitionId || null,
    });
    broadcastMixerState();
  };

  // ── Snapshot morph finalizer (round-2 #1) ──────────────────────────────
  // The mixer's _tickMorph() fires this exactly once when a morph's wall-clock
  // window elapses (the descriptor is already cleared by the time we run).
  // The per-channel/master/group ramps have all landed by this boundary; our
  // job is the bookkeeping recallLook does synchronously but a morph defers:
  //   - CPC-unregister the faded-out (current-only) channel ids. The mixer's
  //     destroyOnComplete + removeChannel already destroyed their handles +
  //     spliced them out of the stack, but removeChannel does NOT touch the
  //     ParamCenter registry (recallLook unregisters explicitly at its
  //     teardown); without this the registry would leak a ghost id.
  //   - Persist (we deliberately did NOT saveAllState at kickoff — the morph
  //     is a transient animation, like /mixer/master/fade; the settled look
  //     is the canonical state).
  //   - Broadcast the settled mixer + a recall-fade-complete signal so the
  //     iPad reconciles the strips on the look it landed on.
  mixer.onMorphComplete = ({ fadeOutIds = [] } = {}) => {
    if (paramCenter) {
      for (const id of fadeOutIds) paramCenter.unregisterChannel(id);
    }
    saveAllState();
    broadcastWs({ type: 'snapshots', action: 'recall-fade-complete', snapshots: snapshotManager.list() });
    broadcastMixerState();
  };

  // Single payload shape used by every autopilot writer. Kept on its own
  // WS event type so subscribers (CaptainPad's deck tab, future PortWatch
  // mirror, etc.) can wire `if (msg.type === 'autopilot') …` without
  // having to scrape the larger mixer broadcast.
  function broadcastAutopilot() {
    const st = autopilot.state || {};
    broadcastWs({
      type: 'autopilot',
      active: !!st.active,
      delay_s: st.delay_s !== undefined ? String(st.delay_s) : '30',
      shuffle: !!st.shuffle,
    });
  }

  // The "view override" pins the engine output to the deck regardless of
  // any subsequent /mixer/view writes from another panel. When cleared,
  // we restore whatever target the user last picked. Implemented on the
  // server (instead of mutating mixer.targetViewFader directly) so the
  // pre-override target survives even if the live mixer panel keeps
  // sending writes while we're held in deck. A WS broadcast keeps every
  // UI honest about whether the override is engaged.
  //
  // The override is also surfaced as the `controlLock` field of
  // `globalsState` — making it a first-class entry in the unified
  // global-parameters interface. Once `controlLock === 'portwatch'`,
  // every UI in the building (CaptainPad, future control surfaces,
  // diagnostic dashboards) reads off that one field to decide whether
  // to disable interactive controls. This avoids a parallel
  // "is-locked" mechanism per client and means a fresh client
  // hitting `/globals` on boot already sees the lock state without
  // needing to subscribe to the WS event first.
  //
  // Boot-time hydration: if the engine restarted while a lock was
  // engaged, we honour the persisted value but we only know it was
  // a deck-pin (the only kind we set). Restoring the saved view
  // fader is impossible — we have no record — so we leave the engine
  // wherever its persisted mixerState put it and let the operator
  // release explicitly.
  let viewOverrideMode =
    (globalsState && globalsState.controlLock === 'portwatch') ? 'deck' : null;
  let savedTargetViewFader = null;       // float pre-override

  // ── controlLock lease ───────────────────────────────────────────────
  //
  // The lock is a LEASE, not a permanent take. The owner (PortWatch
  // today) must renew within `CONTROL_LOCK_LEASE_MS` or the engine
  // auto-clears the override and CaptainPad regains control. This
  // protects against:
  //
  //   * a phone walking out of LoRa range while holding the lock
  //   * the PortWatch app crashing / being force-quit
  //   * the bridge or radio link going down silently
  //
  // Without the lease, any of those would permanently lock CaptainPad
  // out and require a manual engine restart. With a 30 s lease and a
  // ~20 s client-side renew cadence, the worst-case lockout is one
  // missed beat of operator visibility.
  //
  // Renewal happens via the same POST /mixer/view-override {override:
  // 'deck'} call that takes the lock — every successful POST resets
  // the timer. The wire surface stays minimal (no new endpoint), and
  // clients that just want to take the lock once still work — they
  // either renew or they let the lease expire.
  const CONTROL_LOCK_LEASE_MS = 30_000;
  let controlLockLeaseTimer = null;
  let controlLockLeaseExpiresAtMs = null;

  function clearViewOverrideInternal() {
    if (viewOverrideMode === 'deck' && savedTargetViewFader !== null) {
      mixer.targetViewFader = savedTargetViewFader;
    }
    viewOverrideMode = null;
    savedTargetViewFader = null;
  }

  function disarmControlLockLease() {
    if (controlLockLeaseTimer !== null) {
      clearTimeout(controlLockLeaseTimer);
      controlLockLeaseTimer = null;
    }
    controlLockLeaseExpiresAtMs = null;
  }

  function armControlLockLease() {
    // Restart the timer on every arm. setTimeout is cheap and the
    // resolution doesn't need to be tighter than 1 s.
    if (controlLockLeaseTimer !== null) {
      clearTimeout(controlLockLeaseTimer);
    }
    controlLockLeaseExpiresAtMs = Date.now() + CONTROL_LOCK_LEASE_MS;
    controlLockLeaseTimer = setTimeout(() => {
      // Lease expired with no renew — auto-release. Same code path as
      // a manual `view/clear` so every UI sees the standard
      // viewOverride broadcast and reacts identically. We
      // intentionally do NOT bypass syncControlLockToGlobals here:
      // CaptainPad's overlay clears via the globals fan-out, not via
      // a separate "lease expired" event.
      controlLockLeaseTimer = null;
      controlLockLeaseExpiresAtMs = null;
      if (viewOverrideMode !== 'deck') return;
      clearViewOverrideInternal();
      syncControlLockToGlobals();
      broadcastViewOverride();
      console.log('[viewOverride] lease expired — released to CaptainPad');
    }, CONTROL_LOCK_LEASE_MS);
  }

  function controlLockLeaseRemainingMs() {
    if (controlLockLeaseExpiresAtMs === null) return 0;
    return Math.max(0, controlLockLeaseExpiresAtMs - Date.now());
  }

  // ── FLASH / BUMP release-on-disconnect lease (round-2 #5, docs/39 §10.7) ──
  //
  // A held bump pins a channel to FULL. If the iPad that's holding the bump
  // drops off (walks out of wifi range, app force-quit, link dies), the
  // channel must NOT stay pinned full forever. Two independent safety nets,
  // both belt-and-braces:
  //
  //   1. LEASE: every `bump` (REST or WS) stamps `bumpLeaseExpiry[channelId]`
  //      = now + BUMP_LEASE_MS. The client RENEWS by re-sending the bump
  //      while the button is held (CaptainPad re-sends every BUMP_RENEW_MS).
  //      A periodic sweep (BUMP_SWEEP_MS) auto-releases any bump whose lease
  //      has lapsed. So a dropped client's bump self-heals within ~one lease.
  //   2. WS-CLOSE: each /ws/control socket tracks the channels IT bumped
  //      (`ws._bumpedByThisWs`). On close we release exactly those — instant
  //      cleanup for the common "tab closed / reconnect" case, without
  //      waiting out the lease. (REST bumps have no socket to close, so they
  //      rely solely on the lease — that's why the lease exists at all.)
  //
  // The lease window is short (2 s) so a stuck channel recovers fast; the
  // renew cadence (~700 ms) is comfortably inside it so a healthy hold never
  // flickers. unbump (release) clears the lease entry immediately.
  const BUMP_LEASE_MS = 2_000;
  const bumpLeaseExpiry = new Map(); // channelId -> expiry ms (Date.now()-based)
  let bumpSweepTimer = null;
  const BUMP_SWEEP_MS = 500;

  function touchBumpLease(channelId) {
    bumpLeaseExpiry.set(channelId, Date.now() + BUMP_LEASE_MS);
  }
  function clearBumpLease(channelId) {
    bumpLeaseExpiry.delete(channelId);
  }

  // Periodic sweep: release any bump whose lease has lapsed (dropped client).
  // Runs only while at least one bump is held — the timer is armed on the
  // first bump and disarmed when the set empties, so an idle engine pays zero.
  function sweepExpiredBumps() {
    const now = Date.now();
    let releasedAny = false;
    for (const id of [...mixer._bumpedChannelIds]) {
      const exp = bumpLeaseExpiry.get(id);
      if (exp === undefined || exp <= now) {
        const r = mixer.unbumpChannel(id);
        if (r.ok && r.changed) releasedAny = true;
        bumpLeaseExpiry.delete(id);
        console.log(`[bump] lease expired — auto-released '${id}'`);
      }
    }
    if (releasedAny) {
      saveAllState();
      broadcastMixerState();
    }
    if (mixer._bumpedChannelIds.size === 0) {
      disarmBumpSweep();
    }
  }
  function armBumpSweep() {
    if (bumpSweepTimer !== null) return;
    bumpSweepTimer = setInterval(sweepExpiredBumps, BUMP_SWEEP_MS);
    // Don't keep the event loop alive solely for the bump sweep.
    if (typeof bumpSweepTimer.unref === 'function') bumpSweepTimer.unref();
  }
  function disarmBumpSweep() {
    if (bumpSweepTimer !== null) {
      clearInterval(bumpSweepTimer);
      bumpSweepTimer = null;
    }
  }

  // Apply a bump (on=true) / release (on=false) with full validation + lease
  // bookkeeping. Returns the mixer result ({ ok, changed } | { ok:false,
  // status, error }). The caller broadcasts/saves on ok. Shared by REST + WS.
  function applyBump(channelId, on) {
    if (on) {
      const r = mixer.bumpChannel(channelId);
      if (r.ok) { touchBumpLease(channelId); armBumpSweep(); }
      return r;
    }
    const r = mixer.unbumpChannel(channelId);
    if (r.ok) {
      if (channelId === null || channelId === undefined) bumpLeaseExpiry.clear();
      else clearBumpLease(channelId);
      if (mixer._bumpedChannelIds.size === 0) disarmBumpSweep();
    }
    return r;
  }

  function broadcastViewOverride() {
    broadcastWs({
      type: 'viewOverride',
      override: viewOverrideMode,           // 'deck' | null
      // Mirror the engine-globals view of the same fact. We deliberately
      // namespace it ("controlLock") rather than reusing "viewOverride"
      // so listeners can tell at a glance whether they're looking at
      // raw view-fader state or "who owns the rig right now".
      controlLock: viewOverrideMode === 'deck' ? 'portwatch' : null,
      // Lease metadata — every UI can render a countdown without
      // needing to subscribe to a separate event. expiresAt is an
      // absolute UNIX ms timestamp so clients with skewed clocks
      // can still compute "remaining = max(0, expiresAt - now)" off
      // a synchronised time source if they care.
      controlLockLeaseExpiresAtMs: controlLockLeaseExpiresAtMs,
      controlLockLeaseDurationMs: viewOverrideMode === 'deck'
        ? CONTROL_LOCK_LEASE_MS
        : null,
      currentView: mixer.targetViewFader < 0.5 ? 'deck' : 'mixer',
      savedView: savedTargetViewFader === null
        ? null
        : (savedTargetViewFader < 0.5 ? 'deck' : 'mixer'),
    });
  }

  // Persist the override into globalsState as a single source of truth.
  // Called by every code path that flips `viewOverrideMode`, and on
  // boot to seed the initial value. Idempotent + cheap (saveGlobalsState
  // batches via the same hook the rest of the globals use).
  function syncControlLockToGlobals() {
    const next = viewOverrideMode === 'deck' ? 'portwatch' : null;
    if ((globalsState.controlLock || null) !== next) {
      globalsState.controlLock = next;
      try {
        stateManager.saveGlobalsState(globalsState, paramCenter);
      } catch (err) {
        // Persistence failure shouldn't break the in-memory state —
        // worst case the lock isn't restored on the next engine
        // restart, which is the safe direction (everything unlocks).
        console.warn('Failed to persist controlLock:', err && err.message);
      }
    }
  }
  // Seed globalsState on boot in case it was missing the field
  // (older saved state has no `controlLock`).
  syncControlLockToGlobals();
  // If we restored a `controlLock === 'portwatch'` from disk, arm a
  // fresh lease so the lock doesn't outlive the engine restart by
  // more than CONTROL_LOCK_LEASE_MS. Without this, a crash while
  // someone held the lock would silently strand CaptainPad after
  // boot until an operator manually cleared the override.
  if (viewOverrideMode === 'deck') {
    armControlLockLease();
  }

  // Initialize Autopilot Daemon. We are always in playlist mode, so the
  // "current key" is the active entry id and the swap target is the next
  // entry in the deck channel's playlist.
  const autopilot = new Autopilot(
    listPatterns,
    patternsDir,
    () => {
      const baseCh = mixer.getDeckChannel();
      return baseCh && baseCh.playlist ? baseCh.playlist.activeEntryId : null;
    },
    async () => {
      const baseCh = mixer.getDeckChannel();
      if (!baseCh || !baseCh.playlist || !baseCh.playlist.name) return;
      try {
        const pl = playlistManager.load(baseCh.playlist.name);
        if (!pl || pl.entries.length === 0) return;
        const usable = pl.entries.filter(e => !e._missing);
        if (usable.length === 0) return;

        const cur = baseCh.playlist.activeEntryId;
        // Selection is the SHARED pure picker (group→shuffle→sequential) —
        // the SAME `pickNextAutoCycleEntry` the mixer overlay ticks use, so
        // the deck and overlays can never drift. It applies group-locality,
        // then shuffle/sequential. Group dwell state lives on the deck base
        // channel's transient `_autoGroup` (reset by loadPlaylistEntry on every
        // manual tap / (re-)load, so a manual tap starts a fresh group).
        const nextEntry = pickNextAutoCycleEntry(
          pl, baseCh.playlist.autopilot, cur, baseCh._autoGroup);
        if (!nextEntry) return;
        // Route through the deck-transition path: if the operator has
        // enabled transitions, the load runs as a smooth double-buffer
        // swap; otherwise it falls back to the instant load that
        // `loadPlaylistEntryWithTransition` does internally. We AWAIT
        // the `done` Promise so the autopilot daemon can keep its
        // inter-pattern timer decoupled from the transition duration:
        //
        //   - With delay=1s + transition=5s the cycle is
        //     "show pattern 1s → run transition 5s → wait 1s → swap again"
        //   - The autopilot's self-rescheduling setTimeout only schedules
        //     the next tick AFTER this awaits resolves.
        const r = loadPlaylistEntryWithTransition(
          baseCh, baseCh.playlist.name, nextEntry.id, deckTransitionConfig,
        );
        if (r && r.done && typeof r.done.then === 'function') {
          await r.done;
        }
      } catch (e) {
        if (e && e.code === 'EBUSY') {
          // A manual operator tap landed first and is still animating —
          // skip this autopilot beat, the next setTimeout cycle will
          // pick up the new active entry as its baseline.
          console.warn('[Autopilot] tick skipped: swap already in flight');
        } else {
          console.warn('Autopilot playlist swap failed:', e.message);
        }
      }
    }
  );

  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'OPTIONS, GET, PUT, POST, PATCH, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }

    // Body parsing helper
    const readBody = (callback) => {
      let body = '';
      req.on('data', chunk => body += chunk.toString());
      req.on('end', () => {
        try {
          callback(JSON.parse(body || '{}'));
        } catch (e) {
          res.writeHead(400); res.end(JSON.stringify({ error: 'Invalid JSON' }));
        }
      });
    };

    if (req.method === 'GET' && (req.url === '/patterns' || req.url === '/list-patterns')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(listPatterns(patternsDir)));
    } else if (req.method === 'GET' && req.url === '/pattern-dirs') {
      // List the sub-directories of patterns/ — the "load directory"
      // targets for bulk-adding a folder of patterns into a playlist.
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(listPatternDirs(patternsDir)));
    } else if (req.method === 'GET' && req.url.match(/^\/pattern-dirs\/[^\/]+$/)) {
      // List the patterns inside one sub-directory as `<dir>/<name>`
      // slugs ready to drop into playlist entries.
      try {
        const dir = decodeURIComponent(req.url.split('/')[2]);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(listPatternsInDir(patternsDir, dir)));
      } catch (e) {
        res.writeHead(400); res.end(JSON.stringify({ error: e.message }));
      }
    } else if (req.method === 'GET' && req.url === '/channel-blends') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      const blendsDir = path.join(patternsDir, 'channel_blends');
      try {
        const files = fs.readdirSync(blendsDir).filter(f => f.endsWith('.js')).map(f => f.replace('.js', ''));
        res.end(JSON.stringify(files));
      } catch (e) {
        res.end(JSON.stringify([]));
      }
    } else if (req.method === 'GET' && req.url === '/transitions') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      const transitionsDir = path.join(patternsDir, 'transitions');
      try {
        const files = fs.readdirSync(transitionsDir).filter(f => f.endsWith('.js')).map(f => f.replace('.js', ''));
        res.end(JSON.stringify(files));
      } catch (e) {
        res.end(JSON.stringify([]));
      }
    } else if (req.method === 'GET' && req.url === '/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ 
        service: 'marsin-engine',
        name: 'MarsinEngine',
        version: '2.0',
        port: opts.port || 6968,
        activeScene: opts.modelName || 'unknown', 
        activeModel: opts.modelName || 'unknown', 
        activePattern: opts.pattern || 'unknown',
        unrealState: 'streaming',
        // True when a model hot reload was refused (pixel count changed)
        // and the engine is still rendering the old model — restart needed.
        modelStale: !!(engineCore.modelSync && engineCore.modelSync.stale),
        modelStaleMessage: (engineCore.modelSync && engineCore.modelSync.message) || null,
        // Render-health (Codex P0 visibility): renderHealth.ok === false
        // means at least one channel blend is degraded — running on the
        // host-side linear-interp fallback because its WASM blend script is
        // missing or failed to compile. blendErrors lists the offending
        // modes. A green rig has renderHealth.ok === true with an empty
        // blendErrors array. See pattern_mixer.getRenderHealth().
        renderHealth: mixer.getRenderHealth ? mixer.getRenderHealth() : null,
        // FIX A (Codex P0 visibility): non-null iff the saved DECK channel
        // failed to restore at boot and the engine fell back to the default
        // pattern to keep the mission-critical exterior LIT. Shape:
        // { failedPattern, reason, fellBackTo }. Null on a clean boot. An
        // operator / CaptainPad / smoke-check reads this to SEE that the
        // saved deck did not restore (a loud, VISIBLE degrade — never silent).
        deckRestoreDegraded,
        // F-B: current grand-master value + any in-flight timed fade. A
        // timed blackout / restore animates `master` toward a target on the
        // render tick; `masterFade` is null when steady, else carries
        // { active, from, to, durationMs, elapsedMs, remainingMs }.
        master: mixer.master,
        masterFade: mixer.getMasterFade ? mixer.getMasterFade() : null,
      }));
    } else if (req.method === 'GET' && req.url === '/exports') {
      // Legacy endpoint, return exports of base channel
      res.writeHead(200, { 'Content-Type': 'application/json' });
      const baseChannel = mixer.getDeckChannel();
      if (!baseChannel) {
        res.end('[]'); return;
      }
      const exports = wasmHost.getExports(baseChannel.handle);
      const filtered = exports.filter(e => !(paramCenter && paramCenter.isSharedExport(baseChannel.id, e.name)));
      res.end(JSON.stringify(annotateCodeDefaults(baseChannel, filtered)));
    } else if (req.method === 'GET' && req.url.startsWith('/pattern-code')) {
      const name = req.url.split('?name=')[1];
      if (!name) { res.writeHead(400); return res.end(JSON.stringify({ error: 'name required' })); }
      let safeName = path.basename(name);
      if (!safeName.endsWith('.js')) safeName += '.js';
      const filePath = path.join(patternsDir, safeName);
      if (fs.existsSync(filePath)) {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end(fs.readFileSync(filePath, 'utf8'));
      } else {
        res.writeHead(404); res.end('Not Found');
      }
    } else if (req.method === 'POST' && req.url === '/save-pattern') {
      readBody(data => {
        if (!data.name || !data.code) {
          res.writeHead(400); return res.end(JSON.stringify({ error: 'name and code required' }));
        }
        let safeName = path.basename(data.name);
        if (!safeName.endsWith('.js')) safeName += '.js';
        const filePath = path.join(patternsDir, safeName);
        
        // Compile check (does not destroy existing running patterns because of WasmHost!)
        const comp = wasmHost.compile(data.code);
        if (!comp.ok) {
          res.writeHead(400); return res.end(JSON.stringify({ error: comp.error }));
        }
        wasmHost.destroy(comp.handle); // Clean up validation handle
        
        fs.writeFileSync(filePath, data.code, 'utf8');
        
        const patternName = safeName.replace('.js', '');
        const allChannels = [
          ...(mixer.getDeckChannel() ? [mixer.getDeckChannel()] : []),
          ...mixer.getMixerChannels(),
        ];
        allChannels.forEach(ch => {
          if (ch.pattern === patternName) {
            const compNew = wasmHost.compile(data.code);
            if (compNew.ok) {
              if (ch.handle) wasmHost.destroy(ch.handle);
              ch.handle = compNew.handle;
              // Seed slider defaults from the LIVE edit buffer, not stale disk.
              onChannelCompiled(ch, data.code);
              // Re-apply playlist entry defaults if a playlist+entry is active.
              // tryLoad so a corrupt active playlist can't break a pattern save.
              const pl = ch.playlist && ch.playlist.name && playlistManager.tryLoad(ch.playlist.name);
              const entry = pl && ch.playlist.activeEntryId &&
                pl.entries.find(e => e.id === ch.playlist.activeEntryId);
              if (entry && !entry._missing) {
                playlistManager.applyEntryDefaults(ch, entry, wasmHost, paramRouter, paramCenter);
              }
              finalizeCpcValues(ch);
            }
          }
        });
        
        saveAllState();
        broadcastMixerState();

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
      });
    } else if ((req.method === 'PUT' || req.method === 'POST') && (req.url === '/pattern' || req.url === '/set-pattern')) {
      readBody(data => {
        try {
          if (!data.pattern) {
            res.writeHead(400); return res.end(JSON.stringify({ error: 'pattern required' }));
          }
          const patternName = path.basename(data.pattern, '.js');

          // Compile FIRST so we never tear down the live deck channel
          // for a pattern that turns out to fail to compile / load.
          // PortWatch hits us over LoRa with whatever name landed in
          // its (possibly stale or partially-fetched) catalog, so a
          // bad name is a routine, recoverable case — not a reason
          // to leave the deck channel-less and the rig dark.
          let src;
          try {
            src = loadPattern(patternsDir, patternName);
          } catch (loadErr) {
            res.writeHead(404);
            return res.end(JSON.stringify({ error: String(loadErr.message || loadErr) }));
          }
          const comp = wasmHost.compile(src);
          if (!comp.ok) {
            res.writeHead(400); return res.end(JSON.stringify({ error: comp.error }));
          }

          // Legacy /set-pattern replaces the deck channel's WASM handle
          // with the freshly compiled pattern. Post-channel-split this
          // is dramatically simpler: the deck slot is its own field, so
          // we don't have to dance around mixer overlay slots or do the
          // "below cap / at cap" two-branch swap that the old combined
          // array required. The deck id stays STABLE (we just swap the
          // handle in place) so CaptainPad's PlaylistPanel keeps its
          // /mixer/channels/<id>/playlist fetches valid.
          const oldBase = mixer.getDeckChannel();
          const oldPlaylist = oldBase ? oldBase.playlist : null;
          const oldBaseId = oldBase ? oldBase.id : null;
          const oldHandle = oldBase ? oldBase.handle : null;

          let newChannel;
          if (oldBase) {
            // In-place handle swap on the existing deck channel —
            // preserves id, faders, exports list, etc.
            oldBase.handle = comp.handle;
            oldBase.pattern = patternName;
            oldBase.mode = 'blend_screen';
            oldBase.fader = 1.0;
            oldBase.enabled = true;
            oldBase.localControls = {};
            newChannel = oldBase;
            if (oldHandle && oldHandle !== comp.handle) {
              try { wasmHost.destroy(oldHandle); } catch (_) {}
            }
          } else {
            newChannel = mixer.setDeckChannel({
              id: 'ch_base_' + Date.now(),
              name: 'Base',
              pattern: patternName,
              handle: comp.handle,
              mode: 'blend_screen',
              fader: 1.0,
              enabled: true,
            });
          }
          if (oldPlaylist) {
            // Re-attach the playlist, but pick the first entry whose
            // pattern matches the one we just loaded so the panel in
            // CaptainPad highlights the right row. Without this the
            // legacy /set-pattern path (used by PortWatch over LoRa
            // and by anything calling `cmd pattern/<name>`) would
            // render the new pattern but leave activeEntryId pinned
            // to whatever was active before — making CaptainPad's
            // playlist UI lie about what's on stage.
            try {
              const pl = playlistManager.load(oldPlaylist.name);
              const entry = (pl && Array.isArray(pl.entries))
                ? pl.entries.find(e => e && e.pattern === patternName)
                : null;
              newChannel.playlist = {
                ...oldPlaylist,
                activeEntryId: entry ? entry.id : null,
              };
            } catch (_) {
              // Playlist file may have been deleted out from under us.
              // Falling back to the old assignment is fine — the panel
              // will refresh on the next mixer broadcast.
              newChannel.playlist = oldPlaylist;
            }
          }

          opts.pattern = patternName;
          onChannelCompiled(newChannel);
          finalizeCpcValues(newChannel);
          saveAllState();

          broadcastWs({ type: 'pattern', name: patternName });
          broadcastMixerState();

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok', pattern: opts.pattern }));
        } catch (err) {
          // Last-resort guard: anything that escaped above should
          // become a clean 500 rather than crashing the engine and
          // dropping sACN entirely. The bridge surfaces it as
          // `nak engine_error` and PortWatch leaves the deck on the
          // previously-active pattern.
          try {
            res.writeHead(500);
            res.end(JSON.stringify({ error: String(err && err.message || err) }));
          } catch (_) { /* response already sent */ }
        }
      });
    } else if (req.method === 'POST' && req.url === '/scene') {
      // Scene/model coordination (sim → engine). When the operator picks a
      // different scene in the sim's #scene-select dropdown, the sim POSTs the
      // new scene name here so the engine follows and renders that scene's
      // model — the most-recently exported marsin_engine/models/<scene>.js.
      //
      // Cross-scene switches always change the pixel count (every scene's
      // model differs), and the render loop / WASM buffers are sized once at
      // boot — so an in-process hot swap is impossible by construction (see
      // the engine's existing "model is STALE" refusal). The robust path is a
      // clean engine restart with the new --model, driven by the
      // requestSceneSwitch hook the engine wires onto engineCore.
      //
      // Codex P0 (fail loudly, no fallback): a missing model file is a 404,
      // never a silent substitution.
      readBody(data => {
        try {
          const scene = data && typeof data.scene === 'string' ? data.scene.trim() : '';
          if (!scene) {
            res.writeHead(400);
            return res.end(JSON.stringify({ error: 'scene (string) required' }));
          }
          // Reject path-traversal / nested names — model files are flat under
          // marsin_engine/models/.
          if (scene !== path.basename(scene)) {
            res.writeHead(400);
            return res.end(JSON.stringify({ error: `invalid scene name '${scene}'` }));
          }
          const modelFile = path.join(patternsDir, '..', 'models', `${scene}.js`);
          if (!fs.existsSync(modelFile)) {
            res.writeHead(404);
            return res.end(JSON.stringify({
              error: `Engine model not found: ${modelFile}. Save/export the scene's model from the sim first.`,
            }));
          }

          const current = opts.modelName || null;
          if (scene === current) {
            // Already rendering this scene — nothing to switch. The on-disk
            // file watcher already hot-reloads same-scene edits in place.
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ status: 'ok', scene, restarting: false, activeModel: current }));
          }

          if (typeof engineCore.requestSceneSwitch !== 'function') {
            res.writeHead(500);
            return res.end(JSON.stringify({ error: 'engine does not support scene switching (no requestSceneSwitch hook)' }));
          }

          console.log(`\n  🎬 Scene switch requested via /scene: '${current}' → '${scene}'. Restarting engine with the new model…`);
          // Respond BEFORE the restart tears the process down, so the sim
          // gets a clean acknowledgement instead of a dropped connection.
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok', scene, restarting: true, from: current }));
          // Defer the restart a tick so the HTTP response fully flushes.
          setTimeout(() => engineCore.requestSceneSwitch(scene), 50);
        } catch (err) {
          try {
            res.writeHead(500);
            res.end(JSON.stringify({ error: String(err && err.message || err) }));
          } catch (_) { /* response already sent */ }
        }
      });
    } else if (req.method === 'POST' && req.url === '/control') {
      readBody(data => {
        if (data.id === undefined) {
           res.writeHead(400); return res.end(JSON.stringify({ error: 'id required' }));
        }
        paramRouter.setControl(data.id, data.v0 || 0, data.v1 || 0, data.v2 || 0);
        // Legacy /control targets the deck base channel; auto-capture into
        // its active playlist entry so the deck's playlist stays in sync.
        scheduleEntryCapture(mixer.baseChannelId);
        markChannelDirtyIfLocked(mixer.baseChannelId);
        // Per-pattern param SHARING: mirror onto siblings on the same
        // (playlist, pattern).
        if (mixer.baseChannelId) {
          propagateAndCapturePatternParam(mixer.baseChannelId, data.id, data.v0 || 0, data.v1 || 0, data.v2 || 0);
        }
        saveAllState();
        broadcastMixerState();
        broadcastDeckState();

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', id: data.id }));
      });
    } else if (req.method === 'GET' && req.url === '/dimmer-groups') {
      // Build group→sectionId map from model pixels
      const groups = {};
      if (model && model.pixels) {
        for (const px of model.pixels) {
          if (px.group && px.sId > 0 && !groups[px.group]) {
            groups[px.group] = px.sId;
          }
        }
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(groups));
    } else if (req.method === 'GET' && req.url === '/dimmers') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(globalsState.dimmers || {}));

    // ── Group fixed colors (docs/32) ─────────────────────────────────
    // Per-group color locks driven by the CaptainPad Dimmer Rack.
    // GET    /group-fixed-colors          → { groups, overrides }
    // PUT    /group-fixed-colors/:group   → set/replace override
    // DELETE /group-fixed-colors/:group   → clear override
    // Group names are URL-encoded in the path (names may have spaces).
    } else if (req.method === 'GET' && req.url === '/group-fixed-colors') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        groups: listModelGroups(),
        overrides: globalEffectsController ? globalEffectsController.groupFixedColors : {},
      }));
    } else if ((req.method === 'PUT' || req.method === 'DELETE')
               && req.url.startsWith('/group-fixed-colors/')) {
      const m = req.url.match(/^\/group-fixed-colors\/(.+)$/);
      if (!m) { res.writeHead(404); return res.end('Not Found'); }
      if (!globalEffectsController) {
        res.writeHead(503); return res.end(JSON.stringify({ error: 'effects controller not initialized' }));
      }
      let group;
      try {
        group = decodeURIComponent(m[1]);
      } catch (e) {
        res.writeHead(400); return res.end(JSON.stringify({ error: `bad group encoding: ${e.message}` }));
      }
      if (req.method === 'DELETE') {
        const removed = globalEffectsController.clearGroupFixedColor(group);
        if (globalsState.groupFixedColors) delete globalsState.groupFixedColors[group];
        stateManager.saveGlobalsState(globalsState);
        broadcastWs({ type: 'groupFixedColors', overrides: globalEffectsController.groupFixedColors });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ status: 'ok', group, removed }));
      }
      readBody(data => {
        try {
          // Reject unknown groups loudly — a typo'd group name must not
          // become a silent no-op override (codex P0).
          const known = listModelGroups();
          if (!known.includes(group)) {
            res.writeHead(400);
            return res.end(JSON.stringify({ error: `unknown group '${group}' (model groups: ${known.join(', ')})` }));
          }
          globalEffectsController.setGroupFixedColor(group, data.color, data.brightness);
          if (!globalsState.groupFixedColors) globalsState.groupFixedColors = {};
          globalsState.groupFixedColors[group] = {
            color: [...data.color],
            brightness: data.brightness,
          };
          stateManager.saveGlobalsState(globalsState);
          broadcastWs({ type: 'groupFixedColors', overrides: globalEffectsController.groupFixedColors });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok', group, override: globalEffectsController.groupFixedColors[group] }));
        } catch (e) {
          res.writeHead(400); res.end(JSON.stringify({ error: e.message }));
        }
      });
    } else if (req.method === 'POST' && req.url === '/section-brightness') {
      readBody(data => {
        if (data.sectionId === undefined || data.brightness === undefined) {
           res.writeHead(400); return res.end(JSON.stringify({ error: 'sectionId and brightness required' }));
        }
        if (intensityController) intensityController.setSectionBrightness(data.sectionId, data.brightness);
        if (!globalsState.dimmers) globalsState.dimmers = {};
        globalsState.dimmers[data.sectionId] = data.brightness;
        stateManager.saveGlobalsState(globalsState);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', sectionId: data.sectionId, brightness: data.brightness }));
      });
    } else if (req.method === 'POST' && req.url === '/global-blackout') {
      readBody(data => {
        if (data.state === undefined) {
           res.writeHead(400); return res.end(JSON.stringify({ error: 'state boolean required' }));
        }
        if (intensityController) intensityController.setBlackout(data.state);
        globalsState.blackout = data.state;
        stateManager.saveGlobalsState(globalsState);
        broadcastMixerState();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', blackoutActive: data.state }));
      });
    } else if (req.method === 'POST' && req.url === '/global-effect') {
      readBody(data => {
        if (data.effect === undefined || data.state === undefined) {
           res.writeHead(400); return res.end(JSON.stringify({ error: 'effect string and state boolean required' }));
        }
        if (globalEffectsController) globalEffectsController.setEffect(data.effect, data.state);
        if (!globalsState.effects) globalsState.effects = {};
        globalsState.effects[data.effect] = data.state;
        stateManager.saveGlobalsState(globalsState);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', effect: data.effect, state: data.state }));
      });

    // ── Global Effect Macros (docs/28 §5) ────────────────────────────
    } else if (req.method === 'GET' && req.url === '/global-effect-library') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ effects: describeLibrary() }));
    } else if (req.method === 'GET' && req.url === '/global-effect-slots') {
      if (!globalEffectSlotManager) { res.writeHead(503); return res.end(JSON.stringify({ error: 'slot manager not initialized' })); }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ slots: globalEffectSlotManager.getSlots() }));
    } else if (req.method === 'GET' && req.url === '/global-effect-slots/status') {
      if (!globalEffectSlotManager) { res.writeHead(503); return res.end(JSON.stringify({ error: 'slot manager not initialized' })); }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        slots: globalEffectSlotManager.getStatus(),
        controller: globalEffectsController && globalEffectsController.getStatus
          ? globalEffectsController.getStatus()
          : null,
      }));
    } else if (req.method === 'PATCH' && req.url === '/global-effect-slots') {
      if (!globalEffectSlotManager) { res.writeHead(503); return res.end(JSON.stringify({ error: 'slot manager not initialized' })); }
      readBody(data => {
        try {
          if (!Array.isArray(data.slots)) {
            res.writeHead(400); return res.end(JSON.stringify({ error: 'body must include slots: array' }));
          }
          globalEffectSlotManager.setSlots(data.slots);
          stateManager.saveGlobalEffectSlots(globalEffectSlotManager.getSlots());
          broadcastWs({ type: 'globalEffectSlots', slots: globalEffectSlotManager.getSlots() });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ slots: globalEffectSlotManager.getSlots() }));
        } catch (e) {
          res.writeHead(400); res.end(JSON.stringify({ error: e.message }));
        }
      });
    } else if (req.method === 'POST' && req.url === '/global-effect-macros/panic-stop') {
      if (!globalEffectsController || !globalEffectsController.panicStop) {
        res.writeHead(503); return res.end(JSON.stringify({ error: 'macros controller not initialized' }));
      }
      globalEffectsController.panicStop();
      broadcastWs({ type: 'globalEffectMacroStatus',
        controller: globalEffectsController.getStatus(),
        slots: globalEffectSlotManager ? globalEffectSlotManager.getStatus() : [],
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));

    // E-stop. Unified blackout endpoint that:
    //   1. Sets the IntensityController blackout flag (pixel-level kill).
    //   2. Kills every active macro / legacy global effect (panic stop)
    //      so when blackout is released the rig wakes up to a clean
    //      slate instead of resuming the strobe/wash/etc. that was
    //      running at e-stop time. This is the operator's expectation
    //      from the "e-stop" framing.
    //   3. Persists globalsState.blackout so the next boot honours it.
    //
    // Body: { enabled: boolean }. Returns the resolved blackout flag.
    } else if (req.method === 'POST' && req.url === '/global-effect-macros/blackout') {
      readBody(data => {
        if (typeof data.enabled !== 'boolean') {
          res.writeHead(400); return res.end(JSON.stringify({ error: 'enabled boolean required' }));
        }
        if (intensityController) intensityController.setBlackout(data.enabled);
        globalsState.blackout = data.enabled;
        // E-stop also clears the macro/legacy state when ENABLING so a
        // release leaves the rig dark instead of resuming whatever
        // strobe/wash was running at e-stop time.
        if (data.enabled && globalEffectsController && globalEffectsController.panicStop) {
          globalEffectsController.panicStop();
        }
        stateManager.saveGlobalsState(globalsState);
        broadcastMixerState();
        broadcastWs({ type: 'globalEffectMacroStatus',
          controller: globalEffectsController ? globalEffectsController.getStatus() : null,
          slots: globalEffectSlotManager ? globalEffectSlotManager.getStatus() : [],
          blackout: data.enabled,
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', blackout: data.enabled }));
      });
    // POST /global-effect-hue (docs/39 §F-hue) — the GLOBAL hue shifter.
    // A first-class continuous knob (like blackout), NOT a GEM slot.
    // Rotates the RGB hue of the WHOLE post-mixer buffer (W/A/UV
    // untouched); stacks additively with any per-channel hue.
    //   Body: { degrees, autoRotateDegPerSec? }
    //     - degrees             required, finite ⇒ normalized [0,360),
    //                           else 400 (Codex P0, no silent fallback).
    //     - autoRotateDegPerSec optional (default 0), finite + clamped
    //                           [-360,360]; else 400.
    // Persists globalsState.hueShift so the next boot honours it, and
    // broadcasts { type: 'globalHueShift', hueShift } + mixer state.
    } else if (req.method === 'POST' && req.url === '/global-effect-hue') {
      readBody(data => {
        if (!globalEffectsController) {
          res.writeHead(503); return res.end(JSON.stringify({ error: 'global effects controller not initialized' }));
        }
        const hv = validateHue(data.degrees);
        if (!hv.ok) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: hv.error.replace(/^hue/, 'degrees') }));
        }
        let rot = 0;
        if (data.autoRotateDegPerSec !== undefined) {
          if (typeof data.autoRotateDegPerSec !== 'number' || !Number.isFinite(data.autoRotateDegPerSec)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: `autoRotateDegPerSec must be a finite number, got '${data.autoRotateDegPerSec}'` }));
          }
          rot = Math.max(-360, Math.min(360, data.autoRotateDegPerSec));
        }
        // setHueShift re-validates + normalizes (degrees [0,360), rot
        // clamped) and throws on non-finite — defence in depth.
        globalEffectsController.setHueShift(hv.value, rot);
        globalsState.hueShift = { ...globalEffectsController.hueShift };
        stateManager.saveGlobalsState(globalsState, paramCenter);
        broadcastWs({ type: 'globalHueShift', hueShift: { ...globalEffectsController.hueShift } });
        broadcastMixerState();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', hueShift: { ...globalEffectsController.hueShift } }));
      });
    // POST /global-effect-invert (docs/39 §F-invert) — the GLOBAL color
    // invert. A first-class boolean toggle (like blackout), NOT a GEM slot.
    // Inverts the RGB of the WHOLE post-mixer buffer (1 - v; W/A/UV
    // untouched) in the pipeline AFTER the global hue rotation. Mirrors the
    // global-hue route's shape.
    //   Body: { enabled }
    //     - enabled  coerced via !! (pure boolean toggle — no fail-loud
    //                contract, matching the legacy effect toggles).
    // Persists globalsState.invert so the next boot honours it, and
    // broadcasts { type: 'globalInvert', invert } + mixer state.
    } else if (req.method === 'POST' && req.url === '/global-effect-invert') {
      readBody(data => {
        if (!globalEffectsController) {
          res.writeHead(503); return res.end(JSON.stringify({ error: 'global effects controller not initialized' }));
        }
        const enabled = !!(data && data.enabled);
        globalEffectsController.setInvert(enabled);
        globalsState.invert = globalEffectsController.invert;
        stateManager.saveGlobalsState(globalsState, paramCenter);
        broadcastWs({ type: 'globalInvert', invert: globalEffectsController.invert });
        broadcastMixerState();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', invert: globalEffectsController.invert }));
      });
    } else if (req.method === 'PATCH' && req.url.startsWith('/global-effect-slots/')) {
      // PATCH /global-effect-slots/:slotId
      const m = req.url.match(/^\/global-effect-slots\/(\d+)$/);
      if (!m) { res.writeHead(404); return res.end('Not Found'); }
      const slotId = parseInt(m[1], 10);
      if (!globalEffectSlotManager) { res.writeHead(503); return res.end(JSON.stringify({ error: 'slot manager not initialized' })); }
      readBody(data => {
        try {
          const slot = globalEffectSlotManager.patchSlot(slotId, data || {});
          stateManager.saveGlobalEffectSlots(globalEffectSlotManager.getSlots());
          broadcastWs({ type: 'globalEffectSlots', slots: globalEffectSlotManager.getSlots() });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ slot }));
        } catch (e) {
          res.writeHead(400); res.end(JSON.stringify({ error: e.message }));
        }
      });
    } else if (req.method === 'POST' && req.url.startsWith('/global-effect-slots/')) {
      // POST /global-effect-slots/:slotId/{activate,deactivate,trigger}
      const m = req.url.match(/^\/global-effect-slots\/(\d+)\/(activate|deactivate|trigger|toggle|down|up)$/);
      if (!m) { res.writeHead(404); return res.end('Not Found'); }
      const slotId = parseInt(m[1], 10);
      const action = m[2];
      if (!globalEffectSlotManager) { res.writeHead(503); return res.end(JSON.stringify({ error: 'slot manager not initialized' })); }
      try {
        const frameIndex = engineCore.getFrameIndex ? engineCore.getFrameIndex() : 0;
        const nowMs = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        globalEffectSlotManager.dispatchSlotAction({ slotId, action, frameIndex, nowMs });
        broadcastWs({ type: 'globalEffectMacroStatus',
          slots: globalEffectSlotManager.getStatus(),
          controller: globalEffectsController.getStatus(),
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'ok',
          slotId, action,
          controller: globalEffectsController.getStatus(),
        }));
      } catch (e) {
        res.writeHead(400); res.end(JSON.stringify({ error: e.message }));
      }

    // ── Scheduled tasks (docs/31_scheduled_tasks.md) ────────────────
    // Engine-owned schedule that fires GEM slots on a timer. CaptainPad
    // is a thin client over these endpoints + the `scheduledTasks` WS
    // broadcast. All validation errors return 400 with a human-readable
    // message — never silently clamp (codex P0).
    } else if (req.method === 'GET' && req.url === '/scheduled-tasks') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        tasks: scheduledTaskService.list(),
        presets: {
          onDurationMs: [...ON_DURATION_PRESETS_MS],
          intervalMs:   [...INTERVAL_PRESETS_MS],
        },
      }));
    } else if (req.method === 'POST' && req.url === '/scheduled-tasks') {
      readBody(data => {
        try {
          const task = scheduledTaskService.create(data || {});
          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ task }));
        } catch (e) {
          const code = e instanceof ScheduledTaskValidationError ? 400 : 500;
          res.writeHead(code); res.end(JSON.stringify({ error: e.message }));
        }
      });
    } else if ((req.method === 'PATCH' || req.method === 'DELETE' || req.method === 'POST')
               && req.url.startsWith('/scheduled-tasks/')) {
      // The id path uses URL-safe characters; allow letters, digits,
      // dash, underscore (covers crypto.randomUUID() output + the
      // operator-friendly slugs the doc shows in YAML examples).
      const m = req.url.match(/^\/scheduled-tasks\/([A-Za-z0-9_-]+)(?:\/(fire-now|stop))?$/);
      if (!m) { res.writeHead(404); return res.end('Not Found'); }
      const id = m[1];
      const sub = m[2] || null;

      try {
        if (req.method === 'PATCH' && !sub) {
          readBody(data => {
            try {
              const task = scheduledTaskService.patch(id, data || {});
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ task }));
            } catch (e) {
              const code = e instanceof ScheduledTaskValidationError ? 400 : 500;
              res.writeHead(code); res.end(JSON.stringify({ error: e.message }));
            }
          });
        } else if (req.method === 'DELETE' && !sub) {
          scheduledTaskService.delete(id);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } else if (req.method === 'POST' && sub === 'fire-now') {
          const task = scheduledTaskService.fireNow(id);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ task }));
        } else if (req.method === 'POST' && sub === 'stop') {
          const task = scheduledTaskService.stop(id);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ task }));
        } else {
          res.writeHead(404); res.end('Not Found');
        }
      } catch (e) {
        const code = e instanceof ScheduledTaskValidationError ? 400 : 500;
        res.writeHead(code); res.end(JSON.stringify({ error: e.message }));
      }

    } else if (req.method === 'GET' && req.url === '/globals') {
      // Always reflect the LIVE override state alongside whatever was
      // persisted to disk — the in-memory `viewOverrideMode` is the
      // canonical source of truth (it can change without an immediate
      // save), and a CaptainPad client polling /globals before any WS
      // event lands needs to see the same value the broadcast would
      // have shown.
      const live = {
        ...globalsState,
        controlLock: viewOverrideMode === 'deck' ? 'portwatch' : null,
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(live));
    } else if (req.method === 'GET' && req.url === '/autopilot') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(autopilot.state));
    } else if (req.method === 'POST' && req.url === '/autopilot') {
      readBody(data => {
        autopilot.updateState(data);
        // ── Mirror into deck base channel's per-playlist autopilot ──
        // The actual "advance to next entry" runner in the autopilot
        // callback (see `new Autopilot(...)` above) reads
        // `baseCh.playlist.autopilot.shuffle` to decide between
        // shuffle and sequential. Without this mirror, the iPad would
        // toggle the SHUFFLE pill, the Autopilot daemon would store
        // it in its own config.yaml, but the runner would still see
        // `baseCh.playlist.autopilot.shuffle === false` and keep
        // walking the playlist sequentially. Fixed May 2026.
        try {
          const baseCh = mixer.getDeckChannel();
          if (baseCh) {
            baseCh.playlist = baseCh.playlist || { name: null, activeEntryId: null, cursor: 0, autopilot: { active: false, delay_s: 30, shuffle: false } };
            const ap = baseCh.playlist.autopilot = baseCh.playlist.autopilot || { active: false, delay_s: 30, shuffle: false };
            if (data.active !== undefined) ap.active = !!data.active;
            if (data.delay_s !== undefined) ap.delay_s = parseInt(data.delay_s, 10) || 30;
            if (data.shuffle !== undefined) ap.shuffle = !!data.shuffle;
            // PATTERN-GROUP LOCALITY (feat/optimize_channels): mirror the group
            // fields into the deck playlist autopilot the SAME way as shuffle,
            // so external writers (PortWatch/LoRa) can drive them too.
            if (data.groupMode !== undefined) ap.groupMode = !!data.groupMode;
            if (data.groupSize !== undefined) {
              ap.groupSize = clampInt(
                data.groupSize, AUTO_GROUP_SIZE_MIN, AUTO_GROUP_SIZE_MAX, AUTO_GROUP_SIZE_DEFAULT);
            }
            if (data.groupDwell !== undefined) {
              ap.groupDwell = clampInt(
                data.groupDwell, AUTO_GROUP_DWELL_MIN, AUTO_GROUP_DWELL_MAX, AUTO_GROUP_DWELL_DEFAULT);
            }
            if (data.groupMode !== undefined || data.groupSize !== undefined || data.groupDwell !== undefined) {
              if (baseCh._autoGroup) { baseCh._autoGroup.windowIds = null; baseCh._autoGroup.swapsLeft = 0; }
            }
            saveAllState();
            broadcastMixerState();
          }
        } catch (e) {
          console.warn('[Autopilot] mirror-to-deck failed:', e.message);
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(autopilot.state));
        // External writers (PortWatch over LoRa, scripts, etc.) need the
        // CaptainPad UI to reflect their flips immediately. Broadcast on
        // every transition so the existing `engineEvents` bus on the iPad
        // can mirror state without polling.
        broadcastAutopilot();
      });
    }
    // ---- MODEL METADATA ----
    // Lightweight enumeration of the model's view-selection targets
    // (groups, sections, fixtures, and the union of viewMask bits the
    // model actually uses). Consumed by the CaptainPad mixer strip so
    // it can populate the view-selection picker WITHOUT having to ship
    // the full pixel list. Pure read; safe to hit at panel mount time.
    else if (req.method === 'GET' && req.url === '/model/view-selection-options') {
      const pixels = (model && Array.isArray(model.pixels)) ? model.pixels : [];
      const groups = new Set();
      const sections = new Set();
      const fixtures = new Set();
      let viewMaskUnion = 0;
      for (const px of pixels) {
        if (typeof px.group === 'string' && px.group.length > 0) groups.add(px.group);
        const sId = px.sId ?? px.sectionId;
        if (Number.isInteger(sId)) sections.add(sId);
        const fId = px.fId ?? px.fixtureId;
        if (Number.isInteger(fId)) fixtures.add(fId);
        const vMask = px.vMask ?? px.viewMask;
        if (Number.isInteger(vMask)) viewMaskUnion |= vMask;
      }
      // Named view-mask presets the model author declared (e.g.
      // [{name:'MainShow', bit:2}, ...]). Picker rows in the CaptainPad
      // mixer strip render straight from this array, so we strip any
      // malformed entries here rather than push that work onto the iPad.
      // We also enrich each entry with `inUse` = whether ANY pixel has
      // that bit set, so the picker can dim presets that the operator
      // hasn't tagged any fixtures with yet (without removing them —
      // they may belong to a future scene).
      const rawViewMasks = (model && Array.isArray(model.viewMasks)) ? model.viewMasks : [];
      const viewMasks = rawViewMasks
        .filter(vm => vm && typeof vm.name === 'string' && vm.name.length > 0 && Number.isInteger(vm.bit))
        .map(vm => ({
          name: vm.name,
          bit: vm.bit,
          inUse: (viewMaskUnion & vm.bit) !== 0,
        }));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        groups: [...groups].sort(),
        sections: [...sections].sort((a, b) => a - b),
        fixtures: [...fixtures].sort((a, b) => a - b),
        viewMaskUnion,
        viewMasks,
        // Group→bit table for this model (pinned by the sidecar or
        // derived at load time — docs/13 §4.5.1) and the MASK_* pattern
        // constants built from it. Surfaced so operators, tools, and
        // pattern authors can verify the assignment instead of guessing
        // at bit values.
        groupBits: (model && model.groupBits) || {},
        maskConstants: (model && model.maskConstants) || {},
        pixelCount: pixels.length,
      }));
    }
    // ---- MIXER API ----
    else if (req.method === 'GET' && req.url === '/mixer') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(serializeMixerState()));
    } else if (req.method === 'PATCH' && req.url === '/mixer') {
      readBody(data => {
        if (data.master !== undefined) {
          // Codex P0: master is a [0,1] fader. Reject non-finite with 400
          // (setMaster's Math.max/min would otherwise pass NaN straight
          // through to applyMaster and black the rig). Clamp finite.
          const mv = validateFader(data.master);
          if (!mv.ok) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: mv.error }));
          }
          mixer.setMaster(mv.value);
        }
        saveAllState();
        broadcastMixerState();
        res.writeHead(200); res.end(JSON.stringify({ status: 'ok' }));
      });
    } else if (req.method === 'POST' && req.url === '/mixer/master/fade') {
      // F-B: grand-master timed fade / timed blackout. Animates `master`
      // toward `target` over `durationMs` on the render tick. A timed
      // blackout is target=0; a restore is a fade to a non-zero value.
      readBody(data => {
        // Codex P0: reject non-finite / out-of-range BEFORE touching the
        // mixer. target reuses validateFader's finite-[0,1] contract (but
        // is NOT clamped silently here — validateFader clamps a finite
        // overshoot, which is the same benign saturation as a slider).
        const tv = validateFader(data.target);
        if (!tv.ok) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: tv.error.replace('fader', 'target') }));
        }
        const durationMs = (typeof data.durationMs === 'number')
          ? data.durationMs
          : Number(data.durationMs);
        if (!Number.isFinite(durationMs) || durationMs <= 0) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({
            error: `durationMs must be a finite number > 0, got '${data.durationMs}'`,
          }));
        }
        mixer.startMasterFade(tv.value, durationMs);
        // Note: we deliberately do NOT saveAllState() here. The master fade
        // is a transient animation; the final master value is persisted on
        // the next mutation (or by the periodic save). Persisting an
        // in-flight intermediate would be misleading on restart.
        broadcastMixerState();
        res.writeHead(200); res.end(JSON.stringify({
          status: 'ok',
          masterFade: mixer.getMasterFade(),
        }));
      });
    } else if (req.method === 'POST' && req.url === '/mixer/tempo') {
      // F-phase #4 (tap-tempo). The CLIENT computes BPM from tap intervals;
      // the engine just stores the resolved tempo and derives the global
      // multiplier (120 BPM = 1×). Affects ONLY channels that opted in via
      // followsTempo — the mission-critical exterior stays immune unless the
      // operator opts it in. Rides the existing mixer-state broadcast (the
      // serialized payload carries tempoBpm); no new WS message type.
      readBody(data => {
        // Codex P0: reject a non-finite or out-of-musical-range bpm with
        // 400 BEFORE touching the mixer. [20,400] BPM is the supported
        // musical window; outside it is a malformed tap, not a clamp.
        const bpm = (typeof data.bpm === 'number') ? data.bpm : Number(data.bpm);
        if (data.bpm === null || data.bpm === undefined || typeof data.bpm === 'boolean'
            || (typeof data.bpm === 'string' && data.bpm.trim() === '')
            || !Number.isFinite(bpm) || bpm < 20 || bpm > 400) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({
            error: `bpm must be a finite number in [20,400], got '${data.bpm}'`,
          }));
        }
        mixer.setTempoBpm(bpm);
        // TEMPO ARBITRATION: a manual tap means the operator is hand-driving,
        // so it makes TAP the STICKY source (mixer.tempoSourcePref='tap'). OSC
        // auto-follow stays suppressed until the operator selects OSC again —
        // no 12s auto-revert (that revert made the source jump OSC↔TAP).
        // (No arbiter ⇒ a tapped tempo simply has no preference; still honored.)
        if (engineCore.tempoArbiter) {
          engineCore.tempoArbiter.noteManualTap();
        }
        // BPM → SPEED sync is source-agnostic: a manual tap just moved the
        // arbitrated tempo (mixer.tempoBpm) WITHOUT a CPC event, so re-evaluate
        // the speed mapping now so SPEED follows the tapped tempo immediately
        // (idempotent — only writes when the mapped value changed).
        if (engineCore.bpmSync) {
          engineCore.bpmSync.recompute();
        }
        saveAllState();
        broadcastMixerState();
        res.writeHead(200); res.end(JSON.stringify({
          status: 'ok',
          tempoBpm: mixer.tempoBpm,
          tempoMultiplier: mixer._tempoMultiplier,
          tempoSource: engineCore.tempoArbiter
            ? engineCore.tempoArbiter.deriveSource()
            : 'manual',
          tempoSourcePref: engineCore.tempoArbiter
            ? engineCore.tempoArbiter.sourcePref()
            : 'tap',
        }));
      });
    } else if (req.method === 'POST' && req.url === '/mixer/tempo/sync') {
      // TEMPO ARBITRATION: explicit "re-sync to OSC". Drops the manual-override
      // hold immediately so the live OSC BPM reclaims the tempo on the next
      // render tick (if OSC is live; otherwise the last value just holds).
      // Codex P0 — fail loud if the arbiter (and thus the mixer) is missing.
      readBody(() => {
        if (!engineCore.tempoArbiter) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({
            error: 'tempo arbiter unavailable — cannot drop manual override',
          }));
        }
        engineCore.tempoArbiter.clearOverride();
        // Apply the OSC auto-follow NOW (before broadcasting) so the readout
        // immediately shows the OSC bpm on "use OSC". Without this the broadcast
        // would carry tempoSource='osc' but the STALE tapped tempoBpm (the
        // per-frame tick hadn't run yet) — which read as "OSC selected but the
        // number stays on the tapped value". If OSC isn't live, tick() is a
        // no-op and the last value just holds (source 'held').
        engineCore.tempoArbiter.tick(Date.now());
        if (engineCore.bpmSync) engineCore.bpmSync.recompute();
        saveAllState();
        broadcastMixerState();
        res.writeHead(200); res.end(JSON.stringify({
          status: 'ok',
          tempoBpm: mixer.tempoBpm,
          tempoSource: engineCore.tempoArbiter.deriveSource(),
          tempoSourcePref: engineCore.tempoArbiter.sourcePref(),
          oscTempoBpm: engineCore.tempoArbiter.oscTempoBpm(),
        }));
      });
    } else if (req.method === 'POST' && req.url === '/mixer/tempo/source') {
      // STICKY tempo source selector (operator request 2026-06-29). Sets the
      // persisted preference the OSC/TAP selector reflects on BOTH the deck and
      // mixer (one source of truth, no per-surface guessing):
      //   'osc' — follow the live OSC BPM (snaps on the next tick if live).
      //   'tap' — hold the current/tapped tempo; OSC auto-follow suppressed.
      // Codex P0 — fail loud if the arbiter is missing or the source invalid.
      readBody(data => {
        if (!engineCore.tempoArbiter) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({
            error: 'tempo arbiter unavailable — cannot set tempo source',
          }));
        }
        if (data.source !== 'osc' && data.source !== 'tap') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({
            error: `source must be 'osc' | 'tap', got '${data.source}'`,
          }));
        }
        engineCore.tempoArbiter.setSourcePref(data.source);
        // On 'osc', apply the auto-follow NOW so the readout snaps to the live
        // OSC bpm immediately (same rationale as /sync). On 'tap', the current
        // tempo just holds — tick() is a no-op in tap mode.
        engineCore.tempoArbiter.tick(Date.now());
        if (engineCore.bpmSync) engineCore.bpmSync.recompute();
        saveAllState();
        broadcastMixerState();
        res.writeHead(200); res.end(JSON.stringify({
          status: 'ok',
          tempoBpm: mixer.tempoBpm,
          tempoSource: engineCore.tempoArbiter.deriveSource(),
          tempoSourcePref: engineCore.tempoArbiter.sourcePref(),
          oscTempoBpm: engineCore.tempoArbiter.oscTempoBpm(),
        }));
      });
    }
    // ── MIXER CHANNEL GROUPS (gang-faders) + SOLO (WAVE 15) ──────────────
    //
    // These routes use DISTINCT url prefixes (`/mixer/groups`, `/mixer/solo`)
    // from `/mixer/channels/...` and `/mixer/snapshots/...`, so the existing
    // channel/snapshot regexes can't shadow them. Within this block the more
    // specific `.../members/...` and `.../members` routes are armed BEFORE
    // the bare `/mixer/groups/:gid` route so the `[^\/]+$` regex doesn't
    // swallow a members path. All mutations are validate→mutate→saveAllState
    // →broadcastMixerState; bad input fails loud (400/404), never silently.
    else if (req.method === 'GET' && req.url === '/mixer/groups') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ mixGroups: mixer.getMixGroups() }));
    } else if (req.method === 'POST' && req.url === '/mixer/groups') {
      // Create a group. name/color optional; fader=1, muted=false to start.
      readBody(data => {
        if (data.name !== undefined && data.name !== null && typeof data.name !== 'string') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: `name must be a string or null, got ${typeof data.name}` }));
        }
        if (data.color !== undefined && data.color !== null && typeof data.color !== 'string') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: `color must be a string or null, got ${typeof data.color}` }));
        }
        const group = mixer.createMixGroup({ name: data.name, color: data.color });
        saveAllState();
        broadcastMixerState();
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', group }));
      });
    } else if (req.method === 'POST' && req.url.match(/^\/mixer\/groups\/[^\/]+\/members$/)) {
      // Add a mixer channel to this group (single membership).
      const gid = decodeURIComponent(req.url.split('/')[3]);
      readBody(data => {
        if (typeof data.channelId !== 'string' || data.channelId.length === 0) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'channelId (non-empty string) required' }));
        }
        // A deck channel can never be in a mixer group — reuse the role guard.
        const reject = rejectIfWrongRole(data.channelId, 'mixer');
        if (reject) { res.writeHead(reject.status, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(reject.body)); }
        const r = mixer.addChannelToGroup(gid, data.channelId);
        if (!r.ok) { res.writeHead(r.status, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: r.error })); }
        saveAllState();
        broadcastMixerState();
        res.writeHead(200); res.end(JSON.stringify({ status: 'ok' }));
      });
    } else if (req.method === 'DELETE' && req.url.match(/^\/mixer\/groups\/[^\/]+\/members\/[^\/]+$/)) {
      // Remove a channel from this group.
      const parts = req.url.split('/');
      const gid = decodeURIComponent(parts[3]);
      const channelId = decodeURIComponent(parts[5]);
      const r = mixer.removeChannelFromGroup(gid, channelId);
      if (!r.ok) { res.writeHead(r.status, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: r.error })); }
      saveAllState();
      broadcastMixerState();
      res.writeHead(200); res.end(JSON.stringify({ status: 'ok' }));
    } else if (req.method === 'PATCH' && req.url.match(/^\/mixer\/groups\/[^\/]+$/)) {
      // Update a group's name / fader / muted / color.
      const gid = decodeURIComponent(req.url.split('/')[3]);
      readBody(data => {
        if (!mixer.getMixGroup(gid)) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: `group '${gid}' not found` }));
        }
        const patch = {};
        if (data.name !== undefined) {
          if (data.name !== null && typeof data.name !== 'string') {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: `name must be a string or null, got ${typeof data.name}` }));
          }
          patch.name = data.name;
        }
        if (data.fader !== undefined) {
          const fv = validateFader(data.fader);
          if (!fv.ok) { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: fv.error })); }
          patch.fader = fv.value;
        }
        if (data.muted !== undefined) patch.muted = !!data.muted;
        if (data.color !== undefined) {
          if (data.color !== null && typeof data.color !== 'string') {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: `color must be a string or null, got ${typeof data.color}` }));
          }
          patch.color = data.color;
        }
        const group = mixer.updateMixGroup(gid, patch);
        saveAllState();
        broadcastMixerState();
        res.writeHead(200); res.end(JSON.stringify({ status: 'ok', group }));
      });
    } else if (req.method === 'DELETE' && req.url.match(/^\/mixer\/groups\/[^\/]+$/)) {
      // Delete a group (clears every member's mixGroupId first).
      const gid = decodeURIComponent(req.url.split('/')[3]);
      const removed = mixer.deleteMixGroup(gid);
      if (!removed) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: `group '${gid}' not found` }));
      }
      saveAllState();
      broadcastMixerState();
      res.writeHead(200); res.end(JSON.stringify({ status: 'ok' }));
    }
    // ── SERVER-AUTHORITATIVE SOLO (WAVE 15) ──────────────────────────────
    else if (req.method === 'POST' && req.url === '/mixer/solo') {
      // Solo a channel. additive=true adds to the set; false (default)
      // replaces it. The render gate reads soloedChannelIds; siblings'
      // enabled/fader are NEVER mutated (parked levels survive).
      readBody(data => {
        if (typeof data.channelId !== 'string' || data.channelId.length === 0) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'channelId (non-empty string) required' }));
        }
        const reject = rejectIfWrongRole(data.channelId, 'mixer');
        if (reject) { res.writeHead(reject.status, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(reject.body)); }
        const r = mixer.setSolo(data.channelId, !!data.additive);
        if (!r.ok) { res.writeHead(r.status, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: r.error })); }
        saveAllState();
        broadcastMixerState();
        res.writeHead(200); res.end(JSON.stringify({ status: 'ok', soloedChannelIds: [...mixer.soloedChannelIds] }));
      });
    } else if (req.method === 'DELETE' && req.url === '/mixer/solo') {
      // Clear ALL solos.
      mixer.clearSolo();
      saveAllState();
      broadcastMixerState();
      res.writeHead(200); res.end(JSON.stringify({ status: 'ok', soloedChannelIds: [] }));
    } else if (req.method === 'DELETE' && req.url.match(/^\/mixer\/solo\/[^\/]+$/)) {
      // Un-solo a single channel.
      const channelId = decodeURIComponent(req.url.split('/')[3]);
      const r = mixer.clearSolo(channelId);
      if (!r.ok) { res.writeHead(r.status, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: r.error })); }
      saveAllState();
      broadcastMixerState();
      res.writeHead(200); res.end(JSON.stringify({ status: 'ok', soloedChannelIds: [...mixer.soloedChannelIds] }));
    }
    // ── MIXER SNAPSHOTS / LOOK RECALL (F-A) ──────────────────────────────
    else if (req.method === 'GET' && req.url === '/mixer/snapshots') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ snapshots: snapshotManager.list() }));
    } else if (req.method === 'POST' && req.url === '/mixer/snapshots') {
      // Capture the current full mixer state under a name.
      readBody(data => {
        if (typeof data.name !== 'string' || data.name.trim() === '') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'name (non-empty string) required' }));
        }
        try {
          const saved = snapshotManager.save(data.name, captureLook());
          broadcastWs({ type: 'snapshots', action: 'saved', name: saved.name, snapshots: snapshotManager.list() });
          res.writeHead(200); res.end(JSON.stringify({ status: 'ok', name: saved.name }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
    } else if (req.method === 'GET' && req.url.match(/^\/mixer\/snapshots\/[^\/]+$/)) {
      const name = decodeURIComponent(req.url.split('/')[3]);
      try {
        const look = snapshotManager.load(name);
        if (!look) { res.writeHead(404, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: `snapshot '${name}' not found` })); }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(look));
      } catch (e) {
        // SnapshotLoadError (malformed YAML / shape) ⇒ structured 400.
        if (e instanceof SnapshotLoadError) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: e.message, code: e.code }));
        }
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    } else if (req.method === 'DELETE' && req.url.match(/^\/mixer\/snapshots\/[^\/]+$/)) {
      const name = decodeURIComponent(req.url.split('/')[3]);
      try {
        const removed = snapshotManager.delete(name);
        if (!removed) { res.writeHead(404, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: `snapshot '${name}' not found` })); }
        broadcastWs({ type: 'snapshots', action: 'deleted', name, snapshots: snapshotManager.list() });
        res.writeHead(200); res.end(JSON.stringify({ status: 'ok' }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    } else if (req.method === 'POST' && req.url.match(/^\/mixer\/snapshots\/[^\/]+\/recall$/)) {
      const name = decodeURIComponent(req.url.split('/')[3]);
      let look;
      try {
        look = snapshotManager.load(name);
      } catch (e) {
        // Malformed snapshot ⇒ fail loud with a structured error.
        if (e instanceof SnapshotLoadError) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: e.message, code: e.code }));
        }
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: e.message }));
      }
      if (!look) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: `snapshot '${name}' not found` }));
      }
      // UNDO: snapshot the live look AFTER validation (no phantom entry on a
      // 404/malformed snapshot) but BEFORE recallLook destructively swaps it.
      pushUndo(`recall '${name}'`);
      try {
        recallLook(look);
      } catch (e) {
        // An over-cap snapshot (or other structural failure) is a real
        // error, not a silent truncation — surface it.
        const status = e.code === 'SNAPSHOT_OVER_CAP' ? 400 : 500;
        res.writeHead(status, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: e.message, code: e.code || 'SNAPSHOT_RECALL_FAILED' }));
      }
      saveAllState();
      broadcastWs({ type: 'snapshots', action: 'recalled', name, snapshots: snapshotManager.list() });
      broadcastMixerState();
      res.writeHead(200); res.end(JSON.stringify({ status: 'ok', name }));
    } else if (req.method === 'POST' && req.url.match(/^\/mixer\/snapshots\/[^\/]+\/recall-fade$/)) {
      // ── SNAPSHOT CROSSFADE / MORPH (round-2 #1, docs/39 §10.8) ──────────
      // Recall a saved look by RAMPING current→target over durationMs instead
      // of the instant cut /recall does. Body: { durationMs } (finite > 0).
      // Validate (404 missing, 400 malformed, 400 bad duration, 400 over-cap
      // UNION) BEFORE any mutation; no saveAllState at kickoff (transient,
      // like /mixer/master/fade — persisted by the morph finalizer on
      // completion). Broadcasts {type:'snapshots',action:'recall-fade'} now +
      // a recall-fade-complete from the finalizer when the ramps land.
      const name = decodeURIComponent(req.url.split('/')[3]);
      readBody(data => {
        // Validate durationMs FIRST — never load/mutate on a bad duration.
        const durationMs = (typeof data.durationMs === 'number')
          ? data.durationMs
          : Number(data.durationMs);
        if (!Number.isFinite(durationMs) || durationMs <= 0) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({
            error: `durationMs must be a finite number > 0, got '${data.durationMs}'`,
          }));
        }
        let look;
        try {
          look = snapshotManager.load(name);
        } catch (e) {
          // Malformed snapshot ⇒ fail loud with a structured error.
          if (e instanceof SnapshotLoadError) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: e.message, code: e.code }));
          }
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: e.message }));
        }
        if (!look) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: `snapshot '${name}' not found` }));
        }
        // UNDO: snapshot the PRE-morph live look (captures it before the ramp
        // begins) AFTER validation so a 404/400 leaves no phantom entry.
        pushUndo(`recall-fade '${name}'`);
        try {
          morphToLook(look, durationMs);
        } catch (e) {
          // An over-cap UNION (or other structural failure) is a real error,
          // not a silent truncation — surface it (transient-cap fail-loud).
          const status = e.code === 'SNAPSHOT_OVER_CAP' ? 400 : 500;
          res.writeHead(status, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: e.message, code: e.code || 'SNAPSHOT_MORPH_FAILED' }));
        }
        // Transient animation: do NOT saveAllState() here (the finalizer
        // persists the settled look). Broadcast the kickoff so the iPad
        // knows a morph is in flight; the mixer broadcast carries the
        // current (ramping) faders.
        broadcastWs({ type: 'snapshots', action: 'recall-fade', name, snapshots: snapshotManager.list() });
        broadcastMixerState();
        res.writeHead(200); res.end(JSON.stringify({
          status: 'ok',
          name,
          morph: mixer.getMorph(),
        }));
      });
    }
    // ── MIXER UNDO (round-2 #10, docs/39 §F-undo) ────────────────────────
    // POST /mixer/undo → pop the most recent destructive-action snapshot and
    // restore it via recallLook (never-dark). Empty ring → 400 UNDO_EMPTY
    // (fail loud, NOT a silent no-op — Codex P0). GET /mixer/undo → {depth,
    // top} for the UI button enable/label.
    else if (req.method === 'POST' && req.url === '/mixer/undo') {
      if (undoStack.isEmpty) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'nothing to undo', code: 'UNDO_EMPTY' }));
      }
      // MORPH RACE (CRITICAL): if a recall-fade/morph is mid-flight, cancel it
      // BEFORE recallLook so its completion finalizer (onMorphComplete) can't
      // fire against the torn-down/rebuilt state we're about to install.
      // cancelMorph() drops the descriptor WITHOUT firing the finalizer; the
      // C channels it would have removed are still present and recallLook tears
      // them down + rebuilds the captured look wholesale.
      if (typeof mixer.cancelMorph === 'function') mixer.cancelMorph();
      const popped = undoStack.pop();
      try {
        recallLook(popped.look);
      } catch (e) {
        // A self-captured look should never be over-cap, but surface any
        // structural failure loud rather than half-applying silently.
        const status = e.code === 'SNAPSHOT_OVER_CAP' ? 400 : 500;
        res.writeHead(status, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: e.message, code: e.code || 'UNDO_RECALL_FAILED' }));
      }
      saveAllState();
      broadcastMixerState();
      broadcastUndoState();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', label: popped.label }));
    } else if (req.method === 'GET' && req.url === '/mixer/undo') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ depth: undoStack.depth, top: undoStack.topLabel }));
    }
    // ── NAMED PER-CHANNEL PARAM PRESETS (round-2 #9) ─────────────────────
    // Capture one channel's live localControls (its pattern slider/knob/color
    // values) under a name, and recall them later. NARROWER than a mixer
    // snapshot (whole-mixer look): a param preset is ONE channel's pattern
    // params. Recall is PATTERN-SCOPED — recalling onto a channel running a
    // different pattern is a fail-loud 409 (the control ids are pattern-
    // specific export slots; replaying them onto another pattern would set
    // the wrong knobs). Works on ANY channel (deck or mixer) via
    // mixer.getChannel — disjoint from the snapshot routes above. See docs/39.
    else if (req.method === 'GET' && req.url === '/mixer/param-presets') {
      try {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ paramPresets: paramPresetManager.listParamPresets() }));
      } catch (e) {
        // A corrupt preset file surfaces here (listParamPresets reads each
        // header) — fail loud rather than hiding the bad preset from the list.
        if (e instanceof ParamPresetError) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: e.message, code: e.code }));
        }
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    } else if (req.method === 'POST' && req.url.match(/^\/mixer\/channels\/[^\/]+\/param-presets$/)) {
      // Capture the addressed channel's current params under a name.
      const id = decodeURIComponent(req.url.split('/')[3]);
      readBody(data => {
        if (typeof data.name !== 'string' || data.name.trim() === '') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'name (non-empty string) required' }));
        }
        const channel = mixer.getChannel(id);
        if (!channel) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: `channel '${id}' not found` }));
        }
        try {
          const saved = paramPresetManager.captureParamPreset(data.name, channel);
          broadcastWs({ type: 'paramPresets', action: 'captured', name: saved.name, pattern: saved.pattern, paramPresets: paramPresetManager.listParamPresets() });
          res.writeHead(200); res.end(JSON.stringify({ status: 'ok', name: saved.name, pattern: saved.pattern }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
    } else if (req.method === 'POST' && req.url.match(/^\/mixer\/channels\/[^\/]+\/param-presets\/[^\/]+\/recall$/)) {
      // Recall a named preset onto the addressed channel. Validate everything
      // (404 missing channel/preset, 400 malformed preset, 409 pattern
      // mismatch) BEFORE applying any control. On success, replay every saved
      // control through paramRouter.setChannelControl — the SAME path
      // boot/snapshot-recall uses — which writes both channel.localControls
      // AND the live WASM handle, so the running pattern picks the values up
      // on the NEXT frame.
      const parts = req.url.split('/');
      const id = decodeURIComponent(parts[3]);
      const name = decodeURIComponent(parts[5]);
      const channel = mixer.getChannel(id);
      if (!channel) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: `channel '${id}' not found` }));
      }
      let preset;
      try {
        preset = paramPresetManager.loadParamPreset(name);
      } catch (e) {
        // Malformed preset ⇒ fail loud with a structured error.
        if (e instanceof ParamPresetError) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: e.message, code: e.code }));
        }
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: e.message }));
      }
      if (!preset) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: `param preset '${name}' not found` }));
      }
      // Pattern-scope guard: refuse to apply a preset onto a channel running a
      // different pattern. The control ids are pattern-specific export slots.
      if (preset.pattern !== channel.pattern) {
        res.writeHead(409, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          error: `param preset '${name}' was captured on pattern '${preset.pattern}' ` +
            `but channel '${id}' is running '${channel.pattern}' — pattern mismatch`,
          code: 'PARAM_PRESET_PATTERN_MISMATCH',
        }));
      }
      // UNDO: snapshot the live look AFTER all validation (404/400/409) but
      // BEFORE replaying the preset's controls onto the channel.
      pushUndo(`param-preset '${name}'`);
      // Replay each saved control. setChannelControl ignores CPC-owned /
      // blocked / non-local ids defensively; getReplayableLocalExport mirrors
      // that gate so we don't even attempt those (same as the boot restore
      // path). Numeric control ids round-trip as YAML string keys — parseInt
      // them back, just as restoreChannel does.
      for (const [idStr, cv] of Object.entries(preset.controls)) {
        const controlId = parseInt(idStr, 10);
        if (!getReplayableLocalExport(channel, controlId)) continue;
        paramRouter.setChannelControl(channel.id, controlId, cv.v0, cv.v1, cv.v2);
      }
      scheduleEntryCapture(channel.id);
      markChannelDirtyIfLocked(channel.id);
      saveAllState();
      broadcastWs({ type: 'paramPresets', action: 'recalled', name, channelId: channel.id, paramPresets: paramPresetManager.listParamPresets() });
      broadcastMixerState();
      res.writeHead(200); res.end(JSON.stringify({ status: 'ok', name, channelId: channel.id }));
    } else if (req.method === 'DELETE' && req.url.match(/^\/mixer\/param-presets\/[^\/]+$/)) {
      const name = decodeURIComponent(req.url.split('/')[3]);
      try {
        const removed = paramPresetManager.deleteParamPreset(name);
        if (!removed) { res.writeHead(404, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: `param preset '${name}' not found` })); }
        broadcastWs({ type: 'paramPresets', action: 'deleted', name, paramPresets: paramPresetManager.listParamPresets() });
        res.writeHead(200); res.end(JSON.stringify({ status: 'ok' }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    } else if (req.method === 'POST' && req.url === '/mixer/channels') {
      // Add a mixer channel. Two ways to call this, both are playlist-driven:
      //  1. {playlist:'<name>', playlistEntryId?:'<id>'} — load that playlist
      //     onto the new channel; pattern comes from the entry.
      //  2. {pattern:'<name>'} — legacy; we still attach the 'default' playlist
      //     afterwards so every channel is always in playlist mode.
      readBody(data => {
        let playlistName = data.playlist;
        let entryId = data.playlistEntryId;
        let patternName;

        // Resolve pattern + playlist together so we always end up with a
        // channel that has a playlist assignment.
        if (playlistName) {
          const pl = playlistManager.load(playlistName);
          if (!pl) {
            res.writeHead(400); return res.end(JSON.stringify({ error: `Playlist not found: ${playlistName}` }));
          }
          const usable = pl.entries.filter(e => !e._missing);
          if (usable.length === 0) {
            res.writeHead(400); return res.end(JSON.stringify({ error: `Playlist ${playlistName} has no usable entries` }));
          }
          const entry = entryId
            ? pl.entries.find(e => e.id === entryId && !e._missing) || usable[0]
            : usable[0];
          entryId = entry.id;
          patternName = entry.pattern;
        } else if (data.pattern) {
          patternName = path.basename(data.pattern, '.js');
          playlistName = 'default';
        } else {
          res.writeHead(400); return res.end(JSON.stringify({ error: 'playlist or pattern required' }));
        }

        const src = loadPattern(patternsDir, patternName);
        const comp = wasmHost.compile(src);
        if (!comp.ok) {
          res.writeHead(400); return res.end(JSON.stringify({ error: comp.error }));
        }
        // Validate (optional) initial view-selection before we burn a
        // WASM handle. Invalid payloads MUST 400 so the operator sees
        // the typo instead of getting a silently-defaulted channel.
        let initialViewSelection = { type: 'all', target: null, invert: false };
        if (data.viewSelection !== undefined) {
          const v = validateViewSelection(data.viewSelection);
          if (!v.ok) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: v.error }));
          }
          initialViewSelection = v.value;
        }
        // Channel ids combined Date.now() + a per-process monotonic counter
        // so two POSTs in the same millisecond can never collide. The old
        // pure-Date.now() id caused the second-and-later rapid adds to
        // silently overwrite each other.
        //
        // Wrap mixer.addChannel in an explicit try so the iPad sees a
        // real error message (e.g. "Maximum of 6 channels allowed")
        // instead of readBody's generic "Invalid JSON" — the latter is
        // what made the "tried to add a channel and it said Adding but
        // nothing happened" bug so hard to diagnose.
        let channel;
        try {
          channel = mixer.addMixerChannel({
            id: 'ch_' + Date.now() + '_' + (channelIdCounter++),
            name: data.name || 'New Layer',
            pattern: patternName,
            handle: comp.handle,
            mode: data.mode || 'blend_screen',
            fader: data.fader !== undefined ? data.fader : 1.0,
            enabled: true,
            viewSelection: initialViewSelection
          });
        } catch (addErr) {
          res.writeHead(400);
          return res.end(JSON.stringify({ error: String(addErr.message || addErr) }));
        }
        onChannelCompiled(channel);

        // Attach the playlist + (best-effort) load the chosen entry. If we
        // came in via the legacy {pattern:...} path, just stamp the playlist
        // name without forcing an entry switch so the channel keeps the
        // requested pattern.
        try {
          if (data.playlist) {
            loadPlaylistEntry(channel, playlistName, entryId);
          } else {
            channel.playlist = { name: playlistName, activeEntryId: null, cursor: 0, autopilot: { active: false, delay_s: 30, shuffle: false } };
          }
        } catch (e) {
          console.warn(`[Mixer] Could not attach playlist ${playlistName} to new channel:`, e.message);
        }

        finalizeCpcValues(channel);
        saveAllState();
        // Emit playlist content on WS BEFORE the mixer broadcast so
        // every client primes its playlist cache before mounting the
        // new PlaylistPanel off the mixer event. See
        // broadcastChannelPlaylistData() for the why.
        broadcastChannelPlaylistData(channel);
        broadcastMixerState();
        // Bundle the FULL playlist data (entries, defaults) inline in
        // the response so the iPad's brand-new PlaylistPanel for this
        // channel never has to do a follow-up
        // GET /playlists/<name>. That follow-up was the bottleneck
        // under rapid-add load — the engine was busy broadcasting
        // mixer + vis, the GET would queue behind, and panels would
        // stall on "still loading" past their 8s fetch timeout. Now
        // the panel gets everything it needs to render the entry list
        // from this single response. See PlaylistPanel.tsx
        // initialPlaylist prop and CaptainPad/utils/api.ts
        // primePlaylistCache for the iPad side.
        let inlinePlaylistData = null;
        try {
          if (channel.playlist && channel.playlist.name) {
            const pl = playlistManager.load(channel.playlist.name);
            if (pl) inlinePlaylistData = pl;
          }
        } catch (_) {}
        res.writeHead(200); res.end(JSON.stringify({
          status: 'ok',
          channelId: channel.id,
          pattern: channel.pattern,
          playlist: channel.playlist,
          playlistData: inlinePlaylistData,
        }));
      });
    }
    // ── CHANNEL OPS #6 — DUPLICATE ───────────────────────────────────────
    // POST /mixer/channels/:id/bump { on: true|false }. FLASH / BUMP (round-2
    // #5, docs/39 §10.7): momentary full-while-held accent. on:true bumps the
    // channel to FULL (capped by faderMax); on:false releases it to its parked
    // level. The REST mirror of the WS bump/unbump (low-latency path is WS).
    // Armed BEFORE the `^/mixer/channels/[^/]+$` PATCH/DELETE regexes so the
    // literal `/bump` segment isn't swallowed as a channel id. Each `on:true`
    // RENEWS the disconnect-safety lease (see applyBump / sweepExpiredBumps).
    else if (req.method === 'POST' && req.url.match(/^\/mixer\/channels\/[^\/]+\/bump$/)) {
      const id = decodeURIComponent(req.url.split('/')[3]);
      // Decks never bump via /mixer routes (deck is PFL, never in the composite).
      const reject = rejectIfWrongRole(id, 'mixer');
      if (reject) { res.writeHead(reject.status, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(reject.body)); }
      readBody(data => {
        if (typeof data.on !== 'boolean') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'on (boolean) required' }));
        }
        const r = applyBump(id, data.on);
        if (!r.ok) { res.writeHead(r.status, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: r.error })); }
        saveAllState();
        broadcastMixerState();
        res.writeHead(200);
        res.end(JSON.stringify({ status: 'ok', bumpedChannelIds: [...mixer._bumpedChannelIds] }));
      });
    }
    // POST /mixer/channels/:id/duplicate. Deep-copies a mixer overlay into a
    // NEW overlay landing on TOP of the stack. MUST be armed BEFORE the
    // `^/mixer/channels/[^/]+$` PATCH/DELETE regexes so the literal
    // `/duplicate` segment isn't swallowed as a channel id.
    //
    // Copy strategy (spec §#6): serialize the source via the SAME serializer
    // captureLook uses (serializeChannelForState), override id (fresh minted)
    // + name (`<src> copy`), then rebuild through buildChannelFromSaved which
    // compiles a FRESH wasm handle (never shares src.handle → no double-free),
    // re-binds playlist + replays localControls + finalizeCpcValues. All
    // additive fields (faderMax, color, mixGroupId, soloSafe, viewSelection,
    // locks, transition prefs) ride along in the serialized blob for free.
    else if (req.method === 'POST' && req.url.match(/^\/mixer\/channels\/[^\/]+\/duplicate$/)) {
      const id = decodeURIComponent(req.url.split('/')[3]);
      // Decks can't be duplicated via /mixer routes (single deck identity).
      const reject = rejectIfWrongRole(id, 'mixer');
      if (reject) { res.writeHead(reject.status, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(reject.body)); }
      const src = mixer.getMixerChannel(id);
      if (!src) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: `mixer channel '${id}' not found` }));
      }
      // Serialize, then override identity. The id uses the SAME monotonic
      // minting as POST /mixer/channels so two rapid dups can't collide.
      const serialized = serializeChannelForState(src);
      serialized.id = 'ch_' + Date.now() + '_' + (channelIdCounter++);
      serialized.name = `${src.name} copy`;
      let copy;
      try {
        // buildChannelFromSaved delegates the cap check to addMixerChannel
        // (throws "Maximum of N mixer channels allowed" → 400, single source
        // of truth — no separate pre-check to drift out of sync).
        copy = buildChannelFromSaved(serialized, 'mixer', serialized.pattern);
      } catch (dupErr) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: String(dupErr.message || dupErr) }));
      }
      saveAllState();
      // Mirror POST /mixer/channels ordering: prime the playlist cache BEFORE
      // the mixer broadcast so a freshly-mounting panel has its entries.
      broadcastChannelPlaylistData(copy);
      broadcastMixerState();
      let inlinePlaylistData = null;
      try {
        if (copy.playlist && copy.playlist.name) {
          const pl = playlistManager.load(copy.playlist.name);
          if (pl) inlinePlaylistData = pl;
        }
      } catch (_) {}
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        channelId: copy.id,
        sourceChannelId: id,
        pattern: copy.pattern,
        playlist: copy.playlist,
        playlistData: inlinePlaylistData,
      }));
    }
    // ── CHANNEL OPS #7 — REORDER ─────────────────────────────────────────
    // POST /mixer/channels/reorder { order: [ids] }. Reassigns the overlay
    // stack order. MUST be armed BEFORE the `:id` regexes (the literal
    // `reorder` segment would otherwise be read as a channel id). Validate the
    // permutation BEFORE mutating (fail loud, no partial apply).
    // order[0] = bottom of the mix, order[last] = top.
    else if (req.method === 'POST' && req.url === '/mixer/channels/reorder') {
      readBody(data => {
        const order = data && data.order;
        const current = mixer.getMixerChannels();
        const currentIds = current.map(c => c.id);
        // Permutation validation: array, exact length, no dups, exact same id
        // set as the live stack. Any deviation ⇒ 400 REORDER_BAD_SET.
        const bad = (msg) => {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: msg, code: 'REORDER_BAD_SET' }));
        };
        if (!Array.isArray(order)) return bad('order must be an array of channel ids');
        if (order.length !== currentIds.length) {
          return bad(`order has ${order.length} ids but the mixer has ${currentIds.length} channels`);
        }
        const orderSet = new Set(order);
        if (orderSet.size !== order.length) return bad('order contains duplicate ids');
        const currentSet = new Set(currentIds);
        for (const oid of order) {
          if (!currentSet.has(oid)) return bad(`order contains unknown channel id '${oid}'`);
        }
        // Set equality is now guaranteed (same length, no dups, every order id
        // is a current id) — every current id is therefore covered too.
        // UNDO: snapshot the current order AFTER validation, BEFORE reordering.
        pushUndo('reorder channels');
        try {
          mixer.reorderMixerChannels(order);
        } catch (e) {
          // Defensive: the mixer re-validates and throws. Shouldn't happen
          // after the checks above, but surface it loud rather than swallow.
          return bad(String(e.message || e));
        }
        saveAllState();
        broadcastMixerState();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', order: mixer.getMixerChannels().map(c => c.id) }));
      });
    }
    // ── CHANNEL OPS #9 — PANIC / HOME ────────────────────────────────────
    // POST /mixer/panic { home? }. Mission-critical: leave the rig LIT.
    //   - If a "home" snapshot exists (reserved name 'home') → recallLook it.
    //     A 404/malformed home is the ONE sanctioned LOUD fallback: return
    //     400 with the structured error BUT STILL clear blackout + master up
    //     so the exterior is never left dark on a broken home.
    //   - Else panicToSafeDefault() + clear blackout + master 1.0.
    // Always cancels master-fade / deck-swap / transitions, clears solo,
    // un-mutes groups (panicToSafeDefault), and persists.
    else if (req.method === 'POST' && req.url === '/mixer/panic') {
      readBody(data => {
        const HOME_NAME = 'home';
        const wantHome = data && data.home !== undefined ? !!data.home : true;

        // The always-run LIT guarantee: blackout off + master up. Factored so
        // every exit path (success, safe-default, broken-home loud fallback)
        // leaves the rig visible.
        const forceLit = () => {
          if (intensityController) intensityController.setBlackout(false);
          globalsState.blackout = false;
          stateManager.saveGlobalsState(globalsState, paramCenter);
          mixer.setMaster(1.0);
          mixer.targetViewFader = 1.0;
        };

        // Try a home snapshot first when requested + present.
        let homeLook = null;
        let homeExists = false;
        if (wantHome) {
          try {
            homeLook = snapshotManager.load(HOME_NAME);
            homeExists = !!homeLook;
          } catch (e) {
            // Malformed home snapshot — fail loud, but STILL light the rig.
            forceLit();
            broadcastMixerState();
            broadcastWs({ type: 'globalEffectMacroStatus', blackout: false });
            const status = (e instanceof SnapshotLoadError) ? 400 : 400;
            res.writeHead(status, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({
              error: `home snapshot '${HOME_NAME}' is malformed: ${e.message}`,
              code: e.code || 'PANIC_HOME_MALFORMED',
              rigLit: true,
            }));
          }
        }

        if (homeExists) {
          try {
            recallLook(homeLook);
          } catch (e) {
            // Home loaded but is structurally unusable (e.g. over-cap). Loud
            // 400 — but light the rig first so the exterior stays visible.
            forceLit();
            broadcastMixerState();
            broadcastWs({ type: 'globalEffectMacroStatus', blackout: false });
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({
              error: `home snapshot '${HOME_NAME}' could not be recalled: ${e.message}`,
              code: e.code || 'PANIC_HOME_RECALL_FAILED',
              rigLit: true,
            }));
          }
          // Recall set master/overlays from the look; still force blackout off
          // + master up so a home captured at low master can't leave it dark.
          forceLit();
          saveAllState();
          broadcastMixerState();
          broadcastWs({ type: 'globalEffectMacroStatus', blackout: false });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ status: 'ok', mode: 'home', home: HOME_NAME, rigLit: true }));
        }

        // No home snapshot → safe LIT default.
        mixer.panicToSafeDefault();
        forceLit();
        saveAllState();
        broadcastMixerState();
        broadcastWs({ type: 'globalEffectMacroStatus', blackout: false });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', mode: 'safeDefault', rigLit: true }));
      });
    } else if (req.method === 'PATCH' && req.url.match(/^\/mixer\/channels\/[^\/]+$/)) {
      const id = req.url.split('/')[3];
      readBody(data => {
        const reject = rejectIfWrongRole(id, 'mixer');
        if (reject) { res.writeHead(reject.status, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(reject.body)); }
        const channel = mixer.getMixerChannel(id);
        if (!channel) { res.writeHead(404); return res.end(); }
        if (data.name !== undefined) channel.name = data.name;
        if (data.mode !== undefined) {
          if (!isValidBlendMode(data.mode)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({
              error: `Invalid blend mode '${data.mode}' (expected one of ` +
                `${[...VALID_CHANNEL_BLEND_MODES].join(', ')} or a trans_* transition)`,
            }));
          }
          // PATCH-driven mode change: clear any scripted-transition
          // restore so the operator's pick is sticky. Mirrors the WS
          // setChannelMode logic — see that handler for rationale.
          if (channel._savedMode) delete channel._savedMode;
          mixer.cancelChannelTransition(id);
          channel.mode = data.mode;
          mixer.getBlendHandle(data.mode);
        }
        if (data.fader !== undefined) {
          // Codex P0: reject a non-finite fader (NaN/Infinity) with 400
          // BEFORE the fader-lock check — a malformed value is a client
          // bug regardless of lock state, and must never reach the render
          // loop. A finite out-of-range value is clamped to [0,1].
          const fv = validateFader(data.fader);
          if (!fv.ok) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: fv.error }));
          }
          // Fader-lock: reject the fader portion silently (no-op) but
          // still process other fields in this PATCH. We do NOT 4xx
          // because operators bulk-PATCH multiple fields at once and a
          // hard error would block name / mode / enabled updates that
          // are still valid on a fader-locked channel. The next mixer
          // broadcast carries the unchanged fader so the iPad re-syncs.
          if (!channel.faderLocked) {
            // Manual fader writes ALWAYS cancel any in-flight transition
            // for that channel — mirrors WS setChannelFader (see above).
            mixer.cancelChannelTransition(id);
            channel.fader = fv.value;
          }
        }
        if (data.enabled !== undefined) channel.enabled = data.enabled;
        if (data.faderLocked !== undefined) {
          // Pure boolean toggle — orthogonal to `locked`. No transition
          // cleanup needed: an in-flight fade on this channel can
          // continue naturally (the locked flag will gate the NEXT
          // fadeChannel call), and we don't want to interrupt a
          // visually-mid-fade animation just because the operator
          // tapped the lock icon.
          channel.faderLocked = !!data.faderLocked;
        }
        // F-C: per-channel intensity ceiling. Validated identically to a
        // fader (finite, clamped to [0,1]); non-finite ⇒ 400 (Codex P0,
        // no silent coercion). Applied as a hard cap at the composite.
        if (data.faderMax !== undefined) {
          const fm = validateFader(data.faderMax);
          if (!fm.ok) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: fm.error.replace('fader', 'faderMax') }));
          }
          channel.faderMax = fm.value;
        }
        // F-D: per-channel color metadata. Pure metadata (no render effect);
        // accept a string (e.g. hex) or null to clear. A non-string/non-null
        // value is a malformed payload ⇒ 400 (fail loud).
        if (data.color !== undefined) {
          if (data.color !== null && typeof data.color !== 'string') {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: `color must be a string or null, got ${typeof data.color}` }));
          }
          channel.color = data.color === null ? null : data.color;
        }
        // WAVE 15: solo-safe toggle — pure boolean rig-config (never gated
        // off by another channel's solo). Orthogonal to faderLocked/enabled.
        // A non-boolean-ish value is coerced via !! (the field is a simple
        // flag, like faderLocked above).
        if (data.soloSafe !== undefined) {
          channel.soloSafe = !!data.soloSafe;
        }
        // F-hue: per-channel hue rotation (docs/39). Validated via
        // validateHue — non-finite ⇒ 400 (Codex P0, no silent coercion);
        // a finite value is normalized into [0,360). Rotates this layer's
        // RGB BEFORE blend (W/A/U untouched). Stacks additively with the
        // global hue. The render loop gates on non-zero, so hue=0 = no-op.
        if (data.hue !== undefined) {
          const hv = validateHue(data.hue);
          if (!hv.ok) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: hv.error }));
          }
          channel.hue = hv.value;
        }
        // F-phase #4: opt this channel in/out of the global tap-tempo. Pure
        // boolean flag (coerced via !! like soloSafe/faderLocked). The render
        // loop reads channel.followsTempo each frame via _effectiveSpeed.
        if (data.followsTempo !== undefined) {
          channel.followsTempo = !!data.followsTempo;
        }
        // FOLLOW/LINK (round-2 #6, docs/39 §F-follow): set/clear this
        // channel's leader. A null/empty value CLEARS the link (revert to the
        // follower's own manual fader). A non-empty string id must name an
        // EXISTING channel (mixer overlay or the deck — a mixer overlay may
        // follow the deck), else 404. Self-follow and any cycle (A→B→A, longer
        // chains) are REJECTED with 400 FOLLOW_CYCLE (Codex P0: fail loud — a
        // cyclic follow would be an undefined render). Non-string/non-null is a
        // malformed payload ⇒ 400. Validated BEFORE mutation so a bad payload
        // never half-applies.
        if (data.followLeaderId !== undefined) {
          if (data.followLeaderId === null || data.followLeaderId === '') {
            channel.followLeaderId = null;
          } else if (typeof data.followLeaderId !== 'string') {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({
              error: `followLeaderId must be a channel id string or null, got ${typeof data.followLeaderId}`,
            }));
          } else {
            const leaderId = data.followLeaderId;
            // Leader must exist (mixer overlay OR the deck channel).
            if (!mixer.getChannel(leaderId)) {
              res.writeHead(404, { 'Content-Type': 'application/json' });
              return res.end(JSON.stringify({
                error: `follow leader '${leaderId}' not found`,
                code: 'FOLLOW_LEADER_NOT_FOUND',
              }));
            }
            // Self-follow + cycle rejection (walks the existing chain at PATCH
            // time so the live follow graph can never contain a loop).
            if (mixer.wouldCreateFollowCycle(id, leaderId)) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              return res.end(JSON.stringify({
                error: leaderId === id
                  ? `channel '${id}' cannot follow itself`
                  : `following '${leaderId}' would create a follow cycle`,
                code: 'FOLLOW_CYCLE',
              }));
            }
            channel.followLeaderId = leaderId;
          }
        }
        // FOLLOW/LINK scale: validateFollowScale — non-finite ⇒ 400 (Codex
        // P0); a finite value is clamped to [0,2]. Independent of
        // followLeaderId (an operator can pre-set the scale before linking).
        if (data.followScale !== undefined) {
          const fsv = validateFollowScale(data.followScale);
          if (!fsv.ok) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: fsv.error }));
          }
          channel.followScale = fsv.value;
        }
        if (data.transitionMode !== undefined) channel.transitionMode = data.transitionMode;
        if (data.transitionTime !== undefined) channel.transitionTime = data.transitionTime;
        // View-selection update: validate first so a typo can't brick
        // the render loop. The mixer recompiles the channel's
        // compiledPixelMask synchronously; the next frame composites
        // through the new mask.
        if (data.viewSelection !== undefined) {
          const v = validateViewSelection(data.viewSelection);
          if (!v.ok) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: v.error }));
          }
          mixer.setChannelViewSelection(id, v.value);
        }
        if (data.locked !== undefined) {
          const becameLocked = !channel.locked && !!data.locked;
          channel.locked = !!data.locked;
          // Lock just engaged — cancel any pending auto-capture so a timer
          // that armed pre-lock can't fire after lock and silently overwrite
          // the saved defaults the user is now trying to preserve.
          if (becameLocked) {
            const pending = captureTimers.get(channel.id);
            if (pending) { clearTimeout(pending); captureTimers.delete(channel.id); }
          }
          // Either direction: the dirty flag tracks edits made while locked.
          // Toggling the lock is a clean transition — any "dirty since last
          // resolve" state is no longer relevant after the user changes the
          // lock state through a deliberate UI action.
          clearChannelDirty(channel);
        }
        // Pattern swap: recompile WASM, swap handle, preserve channel ID
        if (data.pattern !== undefined && data.pattern !== channel.pattern) {
          const patternName = path.basename(data.pattern, '.js');
          const src = loadPattern(patternsDir, patternName);
          const comp = wasmHost.compile(src);
          if (comp.ok) {
            // Destroy old handle
            if (channel.handle) wasmHost.destroy(channel.handle);
            channel.handle = comp.handle;
            channel.pattern = patternName;
            channel.localControls = {};
            onChannelCompiled(channel);
            finalizeCpcValues(channel);
          } else {
            console.warn(`[Mixer] Pattern swap FAILED: ${patternName} compile error:`, comp.error);
          }
        }
        // AUTO-CYCLE (round-2 #2, docs/39 §auto-cycle): merge a partial
        // autopilot patch into this overlay's playlist.autopilot. Mirrors the
        // deck `/deck/playlist/autopilot` handler, but stricter on delay_s
        // (Codex P0 — no silent parseInt||30 coerce; validateAutoCycleDelay
        // rejects ≤0 / non-finite with 400 AUTOCYCLE_BAD_DELAY). Auto-cycle
        // requires an assigned playlist to advance through — a channel with no
        // playlist.name has nothing to cycle, so we 400 rather than arm a
        // no-op timer (fail loud). active/shuffle coerce via !! like the other
        // boolean flags. Validated BEFORE any mutation so a bad payload never
        // half-applies; the autopilot rides the existing `mixer` broadcast (no
        // new WS type) since it lives inside the serialized per-channel
        // playlist. Exterior immunity is free: autopilot.active defaults false
        // (opt-in), so a mission-critical channel never auto-changes unless an
        // operator explicitly flips it here.
        if (data.autopilot !== undefined) {
          if (data.autopilot === null || typeof data.autopilot !== 'object') {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({
              error: `autopilot must be an object {active?,delay_s?,shuffle?}, got ${data.autopilot === null ? 'null' : typeof data.autopilot}`,
              code: 'AUTOCYCLE_BAD_PAYLOAD',
            }));
          }
          if (!channel.playlist || !channel.playlist.name) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({
              error: `channel '${id}' has no playlist assigned; cannot enable auto-cycle`,
              code: 'AUTOCYCLE_NO_PLAYLIST',
            }));
          }
          // Validate delay_s FIRST (before mutating) so an invalid delay can't
          // half-apply active/shuffle.
          let nextDelay;
          if (data.autopilot.delay_s !== undefined) {
            const dv = validateAutoCycleDelay(data.autopilot.delay_s);
            if (!dv.ok) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              return res.end(JSON.stringify({ error: dv.error, code: 'AUTOCYCLE_BAD_DELAY' }));
            }
            nextDelay = dv.value;
          }
          const ap = channel.playlist.autopilot = channel.playlist.autopilot
            || { active: false, delay_s: 30, shuffle: false };
          if (data.autopilot.active !== undefined) ap.active = !!data.autopilot.active;
          if (nextDelay !== undefined) ap.delay_s = nextDelay;
          if (data.autopilot.shuffle !== undefined) ap.shuffle = !!data.autopilot.shuffle;
          // PATTERN-GROUP LOCALITY (feat/optimize_channels): groupMode/groupSize
          // /groupDwell mirror `shuffle` — booleans coerce via !!, ints clamp at
          // the picker (a bad value lands inside the clamp window, not a 400).
          if (data.autopilot.groupMode !== undefined) ap.groupMode = !!data.autopilot.groupMode;
          if (data.autopilot.groupSize !== undefined) {
            ap.groupSize = clampInt(
              data.autopilot.groupSize, AUTO_GROUP_SIZE_MIN, AUTO_GROUP_SIZE_MAX, AUTO_GROUP_SIZE_DEFAULT);
          }
          if (data.autopilot.groupDwell !== undefined) {
            ap.groupDwell = clampInt(
              data.autopilot.groupDwell, AUTO_GROUP_DWELL_MIN, AUTO_GROUP_DWELL_MAX, AUTO_GROUP_DWELL_DEFAULT);
          }
          // Re-seed the wall-clock anchor so the next auto-cycle tick measures
          // a full delay_s from THIS arm/change, not a stale pre-patch baseline
          // (the tick re-seeds null→now on its next active frame). Drop the
          // group window too — an arm/disarm/reconfigure starts a fresh group.
          channel._autoCycleLastAdvanceMs = null;
          if (channel._autoGroup) { channel._autoGroup.windowIds = null; channel._autoGroup.swapsLeft = 0; }
        }
        // PATCH might target ch_base, so persist deck state too.
        saveAllState();
        broadcastMixerState();
        res.writeHead(200); res.end(JSON.stringify({ status: 'ok' }));
      });
    } else if (req.method === 'DELETE' && req.url.match(/^\/mixer\/channels\/[^\/]+$/)) {
      const id = req.url.split('/')[3];
      const reject = rejectIfWrongRole(id, 'mixer');
      if (reject) { res.writeHead(reject.status, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(reject.body)); }
      // UNDO: snapshot the full look (incl. this channel + its CPC registration,
      // playlist, follow/group membership) BEFORE we tear it down. recallLook
      // rebuilds the deleted channel through buildChannelFromSaved→registerChannel
      // so undo restores it never-dark with CPC re-registered.
      pushUndo(`delete '${id}'`);
      if (paramCenter) paramCenter.unregisterChannel(id);
      // FOLLOW/LINK (round-2 #6, docs/39 §F-follow): fail-safe leader DELETE.
      // BEFORE removing the channel, clear followLeaderId on every channel that
      // followed it so no follower is left pointing at a ghost (which _effFader
      // would read as a 0-level missing leader, freezing the follower dark — a
      // silent dangling reference the codex forbids). A cleared follower reverts
      // to its OWN manual fader (still lit, never silent). removeMixerChannel
      // also clears followers belt-and-braces, but doing it here lets the single
      // broadcast below carry the cleared followLeaderId values.
      mixer.clearFollowersOf(id);
      mixer.removeMixerChannel(id);
      saveAllState();
      broadcastMixerState();
      res.writeHead(200); res.end(JSON.stringify({ status: 'ok' }));
    } else if (req.method === 'POST' && req.url.match(/^\/mixer\/channels\/[^\/]+\/control$/)) {
      const id = req.url.split('/')[3];
      const reject = rejectIfWrongRole(id, 'mixer');
      if (reject) { res.writeHead(reject.status, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(reject.body)); }
      readBody(data => {
        if (data.id === undefined) {
           res.writeHead(400); return res.end(JSON.stringify({ error: 'id required' }));
        }
        paramRouter.setChannelControl(id, data.id, data.v0 || 0, data.v1 || 0, data.v2 || 0);
        scheduleEntryCapture(id);
        markChannelDirtyIfLocked(id);
        // Per-pattern param SHARING: mirror this export onto every other live
        // channel running the same (playlist, pattern) — deck base, mixer
        // overlays, deck overlays.
        propagateAndCapturePatternParam(id, data.id, data.v0 || 0, data.v1 || 0, data.v2 || 0);
        saveAllState();
        broadcastMixerState();
        broadcastDeckState();
        res.writeHead(200); res.end(JSON.stringify({ status: 'ok' }));
      });
    } else if (req.method === 'POST' && req.url === '/mixer/view') {
      // NOTE: this match must be exact-string, NOT a regex like
      // /\/mixer\/view/, otherwise it would also catch
      // /mixer/view-override and shadow the override handler below.
      readBody(data => {
        // While the override is engaged we still let the user pre-set
        // their next view; we save it so `clear` knows where to land,
        // but don't actually move the live fader.
        if (viewOverrideMode === 'deck') {
          if (data.view === 'deck') savedTargetViewFader = 0.0;
          else if (data.view === 'mixer') savedTargetViewFader = 1.0;
        } else {
          if (data.view === 'deck') mixer.targetViewFader = 0.0;
          else if (data.view === 'mixer') mixer.targetViewFader = 1.0;
        }
        // ── Auto-finalize an in-flight deck swap on view → mixer ────
        // Per the operator's spec: navigating to the mixer tab while a
        // deck pattern transition is mid-flight should treat the
        // transition as complete, so coming back to the deck shows the
        // destination pattern fully (no half-blended buffer waiting
        // around invisibly). This snaps the shadow channel to the end,
        // promotes its handle onto the base channel, and fires the
        // same onComplete callback the natural completion path uses.
        if (data.view === 'mixer' && mixer.isDeckSwapInFlight && mixer.isDeckSwapInFlight()) {
          mixer.finishDeckSwapNow();
        }
        res.writeHead(200); res.end(JSON.stringify({ status: 'ok' }));
        broadcastViewOverride();
      });
    } else if (req.method === 'POST' && req.url === '/mixer/view-override') {
      // Body shape: { override: 'deck' } or { override: null }
      // Forces the engine output to the deck side, regardless of any
      // /mixer/view writes that arrive while engaged. Clearing the
      // override snaps back to whatever target was active before.
      readBody(data => {
        const requested = (data && data.override) || null;
        if (requested === 'deck') {
          if (viewOverrideMode !== 'deck') {
            savedTargetViewFader = mixer.targetViewFader;
            mixer.targetViewFader = 0.0;
            viewOverrideMode = 'deck';
          }
          // (Re)arm the lease on every successful deck-pin POST. This
          // is the renew path: clients holding the lock POST again
          // every ~20s to refresh the 30s lease. Doing it for the
          // initial take too keeps the code single-pathed and means
          // a first take always starts the countdown.
          armControlLockLease();
        } else if (requested === null || requested === '' || requested === 'clear') {
          clearViewOverrideInternal();
          disarmControlLockLease();
        } else {
          res.writeHead(400);
          return res.end(JSON.stringify({ error: 'override must be "deck" or null' }));
        }
        // Keep the unified globals view of the lock in sync — this is
        // what makes the override a "global parameter" across the rest
        // of the system. CaptainPad reads `controlLock` off /globals
        // (and off the broadcast below) to decide whether to lock its
        // UI; PortWatch's bridge already pulls it down via
        // engine_client.compact_status `vov/<0|1>`.
        syncControlLockToGlobals();
        res.writeHead(200);
        res.end(JSON.stringify({
          status: 'ok',
          override: viewOverrideMode,
          controlLock: viewOverrideMode === 'deck' ? 'portwatch' : null,
          controlLockLeaseExpiresAtMs: controlLockLeaseExpiresAtMs,
          controlLockLeaseDurationMs: viewOverrideMode === 'deck'
            ? CONTROL_LOCK_LEASE_MS
            : null,
          currentView: mixer.targetViewFader < 0.5 ? 'deck' : 'mixer',
        }));
        broadcastViewOverride();
      });
    } else if (req.method === 'GET' && req.url === '/mixer/view-override') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        override: viewOverrideMode,
        controlLock: viewOverrideMode === 'deck' ? 'portwatch' : null,
        controlLockLeaseExpiresAtMs: controlLockLeaseExpiresAtMs,
        controlLockLeaseRemainingMs: controlLockLeaseRemainingMs(),
        controlLockLeaseDurationMs: viewOverrideMode === 'deck'
          ? CONTROL_LOCK_LEASE_MS
          : null,
        currentView: mixer.targetViewFader < 0.5 ? 'deck' : 'mixer',
        savedView: savedTargetViewFader === null
          ? null
          : (savedTargetViewFader < 0.5 ? 'deck' : 'mixer'),
      }));
    } else if (req.method === 'GET' && req.url === '/color-palettes') {
      // Curated CPC colour-pair presets from config.yaml. Hue-only
      // (S/V are pinned to 1.0 by the picker — see
      // CaptainPad/components/CPCControls.tsx). Empty list is a valid
      // response — the picker just hides the Presets tab.
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(Array.isArray(engineCore.colorPalettes) ? engineCore.colorPalettes : []));
    } else if (req.method === 'GET' && req.url === '/param-center/schema') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(paramCenter ? paramCenter.getSchema() : []));
    } else if (req.method === 'GET' && req.url === '/param-center') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(paramCenter ? paramCenter.getCanonicalState() : {}));
    } else if (req.method === 'POST' && req.url === '/param-center') {
      readBody(data => {
        if (!paramCenter) return res.end('{}');
        // CPC fan-out via paramCenter.onChange handles WASM dirty
        // marking, persistence, and throttled WS broadcast. No
        // need to call applySnapshot/save/broadcastWs here — doing
        // so would double-broadcast every write (docs/24 §7.2).
        let rev = 0;
        for (const k in data) {
          const r = paramCenter.set(k, data[k], 'api');
          if (r.status === 'ok') rev = r.revision;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', revision: rev }));
      });
    } else if (req.method === 'POST' && req.url === '/param-center/source-lock') {
      readBody(data => {
        if (paramCenter) paramCenter.setSourceLock(data);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', sourceLock: paramCenter ? paramCenter.getSourceLock() : null }));
        broadcastWs({ type: 'sharedParams', ...paramCenter.getCanonicalState() });
      });
    }
    // ── AUDIO ANALYSIS ───────────────────────────────────────────────────
    // See docs/25_marsin_audio_analysis.md §9. `audioState` is wired
    // by engine.js and may be absent if engine wasn't booted with
    // audio support — those routes degrade to a clear 503.
    else if (req.method === 'GET' && req.url === '/osc/config') {
      // Sanitised OSC config snapshot for the iPad config tab.
      // Bindings are intentionally returned as a count, not the full
      // map — the operator edits them in config.yaml, not the iPad.
      const oscState = engineCore && engineCore.oscState;
      if (!oscState) { res.writeHead(503); return res.end(JSON.stringify({ error: 'osc_not_initialized' })); }
      const cfg = oscState.config || {};
      const status = oscState.listener ? oscState.listener.getStatus() : { enabled: false };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        enabled:        !!cfg.enabled,
        port:           cfg.port ?? null,
        host:           cfg.host ?? null,
        gainMax:        cfg.gainMax ?? null,
        allowedSenders: Array.isArray(cfg.allowedSenders) ? cfg.allowedSenders : [],
        bindingsCount:  Object.keys(cfg.bindings || {}).length,
        running:        !!oscState.listener,
        status,
      }));
    } else if (req.method === 'PATCH' && req.url === '/osc/config') {
      // Operator-editable subset: enabled + allowedSenders. port/host
      // changes also stop+restart the listener but we keep them on the
      // engine machine's config.yaml — exposed here as a convenience
      // toggle, not persisted across restarts.
      const oscState = engineCore && engineCore.oscState;
      if (!oscState || typeof oscState.restart !== 'function') {
        res.writeHead(503); return res.end(JSON.stringify({ error: 'osc_not_initialized' }));
      }
      readBody(data => {
        if (!data || typeof data !== 'object') {
          res.writeHead(400); return res.end(JSON.stringify({ error: 'patch body must be an object' }));
        }
        const patch = {};
        if (data.enabled !== undefined) {
          if (typeof data.enabled !== 'boolean') {
            res.writeHead(400); return res.end(JSON.stringify({ error: '"enabled" must be a boolean' }));
          }
          patch.enabled = data.enabled;
        }
        if (data.allowedSenders !== undefined) {
          if (!Array.isArray(data.allowedSenders)) {
            res.writeHead(400); return res.end(JSON.stringify({ error: '"allowedSenders" must be an array' }));
          }
          // Defensive shape check — each entry needs {name, ip}.
          // The full canonical validation runs again inside the
          // OscListener constructor, which throws on malformed input.
          for (const s of data.allowedSenders) {
            if (!s || typeof s !== 'object' || typeof s.name !== 'string' || typeof s.ip !== 'string') {
              res.writeHead(400); return res.end(JSON.stringify({ error: 'allowedSenders entry must be { name: string, ip: string }' }));
            }
          }
          patch.allowedSenders = data.allowedSenders;
        }
        if (data.port !== undefined) {
          const p = Number(data.port);
          if (!Number.isInteger(p) || p < 1 || p > 65535) {
            res.writeHead(400); return res.end(JSON.stringify({ error: '"port" must be an integer in [1, 65535]' }));
          }
          patch.port = p;
        }
        if (data.host !== undefined) {
          if (typeof data.host !== 'string' || !data.host) {
            res.writeHead(400); return res.end(JSON.stringify({ error: '"host" must be a non-empty string' }));
          }
          patch.host = data.host;
        }
        try {
          const next = oscState.restart(patch);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            enabled: !!next.enabled,
            port: next.port ?? null,
            host: next.host ?? null,
            allowedSenders: next.allowedSenders || [],
            bindingsCount: Object.keys(next.bindings || {}).length,
            running: !!oscState.listener,
          }));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
    }
    else if (req.method === 'GET' && req.url === '/audio/config') {
      const audioState = engineCore && engineCore.audioState;
      if (!audioState) { res.writeHead(503); return res.end(JSON.stringify({ error: 'audio_not_initialized' })); }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(audioState.config || {}));
    } else if (req.method === 'GET' && req.url === '/audio/status') {
      const audioState = engineCore && engineCore.audioState;
      if (!audioState) { res.writeHead(503); return res.end(JSON.stringify({ error: 'audio_not_initialized' })); }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(audioState.lastStatus || { enabled: false }));
    } else if (req.method === 'GET' && req.url === '/audio/devices') {
      // Mic picker source for CaptainPad. Shells out to ffmpeg on the
      // ENGINE machine — this is intentional: the iPad needs to choose
      // from the rig's mics, not from its own. Listing is cached for
      // 2 s so rapid re-renders don't fork ffmpeg repeatedly.
      const audioState = engineCore && engineCore.audioState;
      if (!audioState) { res.writeHead(503); return res.end(JSON.stringify({ error: 'audio_not_initialized' })); }
      const now = Date.now();
      const cached = engineCore._audioDevicesCache;
      if (cached && now - cached.at < 2000) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(cached.payload));
      }
      Promise.all([
        import('../audio/capture/audio_devices.js'),
        import('./ffmpeg_resolver.js'),
      ]).then(async ([{ listAudioDevices }, { resolveFfmpegPath }]) => {
        try {
          const cfg = audioState.config || {};
          const ffmpegPath = await resolveFfmpegPath(cfg.capture?.ffmpegPath || 'ffmpeg');
          const { devices, platform, inputFormat } = await listAudioDevices({ ffmpegPath });
          const payload = {
            platform,
            inputFormat,
            devices,
            current: {
              device:      cfg.capture?.device ?? null,
              deviceLabel: cfg.capture?.deviceLabel ?? null,
              deviceId:    cfg.capture?.deviceId ?? null,
              inputFormat: cfg.capture?.inputFormat ?? null,
            },
          };
          engineCore._audioDevicesCache = { at: Date.now(), payload };
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(payload));
        } catch (err) {
          // Surface stable error codes (`ffmpeg_missing`, `unsupported_platform`)
          // so the iPad can show a useful message instead of a stack trace.
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message, code: err.code || 'list_failed' }));
        }
      });
    } else if (req.method === 'POST' && req.url === '/audio/config/reset') {
      // CaptainPad → "Reset to defaults" on the Audio Analysis tab.
      // Wipes the scene's analyzer tuning back to config.yaml defaults
      // while preserving the chosen mic. See engine.js
      // audioState.resetToDefaults for the persistence contract.
      const audioState = engineCore && engineCore.audioState;
      if (!audioState || typeof audioState.resetToDefaults !== 'function') {
        res.writeHead(503); return res.end(JSON.stringify({ error: 'audio_not_initialized' }));
      }
      try {
        const next = audioState.resetToDefaults();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(next));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    } else if (req.method === 'GET' && req.url === '/audio/chains') {
      // docs/29 §REST endpoints: full per-signal chain map.
      const spp = engineCore && engineCore.signalPostProcessor;
      if (!spp) { res.writeHead(503); return res.end(JSON.stringify({ error: 'signal_post_processor_not_initialized' })); }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(spp.getAllChains()));
    } else if (req.method === 'GET' && req.url === '/audio/chains/catalog') {
      // docs/29 §REST endpoints — op catalog for the iPad's "+ ADD OP"
      // picker (Phase 5). Cached client-side per engine version.
      import('../audio/postproc/signal_post_processor.js').then(({ opCatalog }) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(opCatalog()));
      });
    } else if (req.method === 'POST' && req.url === '/audio/chains/reset') {
      // docs/29 §REST endpoints — restore ALL signals to defaults.
      const spp = engineCore && engineCore.signalPostProcessor;
      const audioState = engineCore && engineCore.audioState;
      if (!spp) { res.writeHead(503); return res.end(JSON.stringify({ error: 'signal_post_processor_not_initialized' })); }
      const r = spp.resetAll();
      if (audioState && typeof audioState.persistChains === 'function') audioState.persistChains();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(r.chains));
    } else if (req.method === 'GET' && req.url.match(/^\/audio\/chains\/[^\/]+$/)) {
      const spp = engineCore && engineCore.signalPostProcessor;
      if (!spp) { res.writeHead(503); return res.end(JSON.stringify({ error: 'signal_post_processor_not_initialized' })); }
      const signalKey = decodeURIComponent(req.url.split('/')[3]);
      const chain = spp.getChain(signalKey);
      if (chain === null) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: `unknown signalKey "${signalKey}"` }));
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(chain));
    } else if (req.method === 'PUT' && req.url.match(/^\/audio\/chains\/[^\/]+$/)) {
      // docs/29: atomic replace of a signal's chain. 400 on validation
      // failure (existing chain unchanged — see SignalPostProcessor).
      const spp = engineCore && engineCore.signalPostProcessor;
      const audioState = engineCore && engineCore.audioState;
      if (!spp) { res.writeHead(503); return res.end(JSON.stringify({ error: 'signal_post_processor_not_initialized' })); }
      const signalKey = decodeURIComponent(req.url.split('/')[3]);
      readBody(data => {
        const r = spp.putChain(signalKey, data);
        if (!r.ok) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: r.error }));
        }
        if (audioState && typeof audioState.persistChains === 'function') audioState.persistChains();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(r.chain));
      });
    } else if (req.method === 'POST' && req.url.match(/^\/audio\/chains\/[^\/]+\/reset$/)) {
      // Place BEFORE the generic /:signalKey/:opId PATCH so /reset
      // doesn't get parsed as an opId.
      const spp = engineCore && engineCore.signalPostProcessor;
      const audioState = engineCore && engineCore.audioState;
      if (!spp) { res.writeHead(503); return res.end(JSON.stringify({ error: 'signal_post_processor_not_initialized' })); }
      const parts = req.url.split('/');
      const signalKey = decodeURIComponent(parts[3]);
      const r = spp.resetSignal(signalKey);
      if (!r.ok) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: r.error }));
      }
      if (audioState && typeof audioState.persistChains === 'function') audioState.persistChains();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(r.chain));
    } else if (req.method === 'PATCH' && req.url.match(/^\/audio\/chains\/[^\/]+\/[^\/]+$/)) {
      // docs/29: partial update of one op (enabled toggle + subset of
      // params). 400 on validation failure.
      const spp = engineCore && engineCore.signalPostProcessor;
      const audioState = engineCore && engineCore.audioState;
      if (!spp) { res.writeHead(503); return res.end(JSON.stringify({ error: 'signal_post_processor_not_initialized' })); }
      const parts = req.url.split('/');
      const signalKey = decodeURIComponent(parts[3]);
      const opId      = decodeURIComponent(parts[4]);
      readBody(data => {
        const r = spp.patchOp(signalKey, opId, data);
        if (!r.ok) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: r.error }));
        }
        if (audioState && typeof audioState.persistChains === 'function') audioState.persistChains();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(r.op));
      });
    } else if (req.method === 'PATCH' && req.url === '/audio/config') {
      const audioState = engineCore && engineCore.audioState;
      if (!audioState || typeof audioState.applyLiveUpdate !== 'function') {
        res.writeHead(503); return res.end(JSON.stringify({ error: 'audio_not_initialized' }));
      }
      readBody(data => {
        // Lazy-import to avoid pulling audio_config into the api_server
        // module graph when audio support is disabled. Lazy import
        // inside an async closure isn't worth the complexity in this
        // sync handler — require it at the top of the file would be
        // cleaner, but this keeps the cross-file deps obvious.
        import('../audio/config/audio_config.js').then(async ({ validateLivePatch }) => {
          const v = validateLivePatch(data);
          if (!v.ok) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: v.error }));
          }
          try {
            // applyLiveUpdate is async — it may need to stop/respawn
            // ffmpeg when `enabled` or `capture.*` change. Await so
            // the response reflects the post-restart state.
            const next = await audioState.applyLiveUpdate(v.live, {
              requiresCaptureRestart: v.requiresCaptureRestart,
            });
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(next));
          } catch (err) {
            // Analyzer.reconfigure throws RangeError on bad combos.
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
          }
        });
      });
    } else if (req.method === 'POST' && req.url === '/audio/signals/manifest') {
      // ── Audio Companion signal manifest (dynamic CPC keys) ────────────
      // The Companion (sole analyzer) POSTs the set of OUTPUT signals it is
      // streaming. Each signal NOT already a built-in/registered key becomes
      // a runtime LIVE CPC key: registered in the CPC, bound in the OSC
      // listener, surfaced in /param-center/schema, and broadcast so
      // CaptainPad picks it up live. Keys previously registered this way but
      // ABSENT from THIS manifest are deregistered (key + OSC binding +
      // schema), and any modulation sourced from a removed key is purged.
      // Built-in curated keys are never touched. Malformed manifest → 400.
      if (!paramCenter) {
        res.writeHead(503); return res.end(JSON.stringify({ error: 'param_center_not_initialized' }));
      }
      readBody(data => {
        const v = validateSignalManifest(data);
        if (!v.ok) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: v.error }));
        }
        const listener = engineCore && engineCore.oscState && engineCore.oscState.listener;
        const added = [];
        const updated = [];
        const removed = [];
        let purgedModulations = 0;

        // 1) Register / update every manifest signal that is not a built-in.
        //    A cpcKey that collides with a built-in is REFUSED loudly (the
        //    Companion must not shadow curated keys).
        for (const sig of v.signals) {
          if (paramCenter.isRegisteredKey(sig.cpcKey)
              && !paramCenter.isDynamicLiveParam(sig.cpcKey)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({
              error: `cpcKey "${sig.cpcKey}" is a built-in CPC key — cannot be redefined by the manifest`,
            }));
          }
          let result;
          try {
            result = paramCenter.registerDynamicLiveParam({
              key: sig.cpcKey,
              oscAddress: sig.address,
              label: sig.label,
              range: sig.range,
              broadcastHz: 15,
            });
          } catch (err) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: err.message }));
          }
          if (listener) {
            try {
              listener.addDynamicBinding(sig.address, sig.cpcKey);
            } catch (err) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              return res.end(JSON.stringify({ error: err.message }));
            }
          }
          // No source registration needed — modulation sources are not
          // allow-listed; any CPC key is assignable the moment it exists.
          if (result.status === 'added') added.push(sig.cpcKey);
          else updated.push(sig.cpcKey);
        }

        // 2) Deregister dynamic keys absent from THIS manifest.
        const present = new Set(v.signals.map(s => s.cpcKey));
        for (const key of paramCenter.getDynamicLiveParamKeys()) {
          if (present.has(key)) continue;
          // Remember its OSC address before we drop the registry entry.
          const schemaEntry = paramCenter.getSchema().find(e => e.key === key);
          const addr = schemaEntry && schemaEntry.oscAddress;
          // Purge modulations sourced from this removed key so a deleted
          // signal doesn't leave a dangling mapping (the param returns to its
          // base value rather than freezing).
          purgedModulations += purgeModulationsForSource(key);
          if (listener && addr) listener.removeDynamicBinding(addr);
          paramCenter.deregisterDynamicLiveParam(key);
          removed.push(key);
        }

        // 3) Refresh schema-derived caches + broadcast so CaptainPad picks
        //    up the live key set immediately. We send BOTH the full schema
        //    (paramSchema — so the iPad re-derives its live-key set without
        //    a re-fetch) AND a fresh sharedParams snapshot (so values for a
        //    newly-added key are present). Mirrors the audioConfig pattern.
        if (added.length > 0 || removed.length > 0 || updated.length > 0) {
          invalidateSchemaCaches();
          broadcastWs({ type: 'paramSchema', schema: paramCenter.getSchema() });
          broadcastWs({ type: 'sharedParams', ...paramCenter.getCanonicalState() });
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'ok',
          added, updated, removed,
          purgedModulations,
          oscBound: !!listener,
        }));
      });
    }
    // ── PLAYLIST LIBRARY ─────────────────────────────────────────────────
    else if (req.method === 'GET' && req.url === '/playlists') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(playlistManager.list()));
    } else if (req.method === 'GET' && req.url.match(/^\/playlists\/[^\/]+$/)) {
      try {
        // decodeURIComponent throws on malformed escapes (e.g. "%G0"); guard so
        // we always return a clean 400 instead of crashing the request handler.
        const name = decodeURIComponent(req.url.split('/')[2]);
        const pl = playlistManager.load(name);
        if (!pl) { res.writeHead(404); return res.end(JSON.stringify({ error: 'not_found' })); }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(pl));
      } catch (e) {
        res.writeHead(400); res.end(JSON.stringify({ error: e.message }));
      }
    } else if (req.method === 'POST' && req.url === '/playlists') {
      readBody(data => {
        try {
          if (!data || !data.name) {
            res.writeHead(400); return res.end(JSON.stringify({ error: 'name required' }));
          }
          // Auto-assign entry ids for any entry missing one
          const entries = (data.entries || []).map(e => ({
            ...e,
            id: e.id || playlistManager.generateEntryId(),
            label: e.label ?? null,
            defaults: e.defaults || {},
            notes: e.notes ?? null,
          }));
          const saved = playlistManager.save({ name: data.name, tags: data.tags, entries });
          // Re-sync per-channel cursor for any channel whose playlist
          // points at the saved name (operator reorder, slot 5 May
          // 2026). `cursor` is a display index used in WS broadcasts;
          // autopilot itself uses id-based lookup so it doesn't need
          // this, but if we leave cursor stale a UI consumer reading
          // it from the mixer broadcast (or a future code path that
          // honours it) would point at the wrong row. activeEntryId
          // is intentionally NOT touched — the operator's currently
          // playing pattern keeps playing; only the surrounding order
          // shifts.
          for (const ch of mixer.channels) {
            if (!ch.playlist || ch.playlist.name !== saved.name) continue;
            const activeId = ch.playlist.activeEntryId;
            if (!activeId) continue;
            const newIdx = saved.entries.findIndex(e => e.id === activeId);
            // newIdx === -1 means the active entry was removed from
            // the playlist by this save (delete path, not a reorder).
            // Leave cursor as-is; that path is exercised by the
            // existing handleRemoveEntry flow, which separately
            // advances the active entry when needed.
            if (newIdx >= 0) ch.playlist.cursor = newIdx;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok', playlist: saved }));
          // Two broadcasts so clients can react narrowly:
          //   - playlistLibrary: list of names changed (new playlist appears).
          //   - playlistSaved:   THIS playlist's content changed (entries
          //                      were added / removed / labeled). Anyone
          //                      currently showing it must refresh.
          broadcastWs({ type: 'playlistLibrary', names: playlistManager.list() });
          broadcastWs({ type: 'playlistSaved', name: saved.name, playlist: saved });
        } catch (e) {
          res.writeHead(400); res.end(JSON.stringify({ error: e.message }));
        }
      });
    } else if (req.method === 'DELETE' && req.url.match(/^\/playlists\/[^\/]+$/)) {
      try {
        let name;
        try {
          name = decodeURIComponent(req.url.split('/')[2]);
        } catch (e) {
          res.writeHead(400); return res.end(JSON.stringify({ error: 'invalid URI encoding' }));
        }
        playlistManager.delete(name);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
        broadcastWs({ type: 'playlistLibrary', names: playlistManager.list() });
        broadcastWs({ type: 'playlistDeleted', name });
      } catch (e) {
        res.writeHead(400); res.end(JSON.stringify({ error: e.message }));
      }
    }
    // ── PLAYLIST MODULATIONS (Phase 1A) ──────────────────────────────────
    //
    // Per docs/26 §5.1. CRUD by mapping id, scoped to a playlist item.
    // v1 policy: at most one continuous mapping per target parameter —
    // the validator + save path enforce this.
    //
    // Routes:
    //   PUT    /api/playlists/:name/items/:itemId/modulations/:mappingId
    //   PATCH  /api/playlists/:name/items/:itemId/modulations/:mappingId
    //   DELETE /api/playlists/:name/items/:itemId/modulations/:mappingId
    //
    // All mutations re-save the playlist via playlistManager.save (which
    // re-validates everything strict), then re-push the entry's
    // mappings to the ModulationController IF the entry is currently
    // active on the deck.
    else if (req.url.match(/^\/api\/playlists\/[^\/]+\/items\/[^\/]+\/modulations\/[^\/]+$/)) {
      const parts = req.url.split('/');
      let playlistName, itemId, mappingId;
      try {
        playlistName = decodeURIComponent(parts[3]);
        itemId = decodeURIComponent(parts[5]);
        mappingId = decodeURIComponent(parts[7]);
      } catch (e) {
        res.writeHead(400); return res.end(JSON.stringify({ error: 'invalid URI encoding' }));
      }

      const finishOk = (savedEntry) => {
        broadcastWs({ type: 'playlistSaved', name: playlistName });
        const deckCh = mixer.getDeckChannel();
        if (deckCh && deckCh.playlist
            && deckCh.playlist.name === playlistName
            && deckCh.playlist.activeEntryId === itemId) {
          pushActiveEntryToModulation();
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', entry: savedEntry }));
      };

      if (req.method === 'PUT') {
        readBody(data => {
          try {
            if (!data || typeof data !== 'object') {
              res.writeHead(400); return res.end(JSON.stringify({ error: 'request body required' }));
            }
            const playlist = playlistManager.load(playlistName);
            if (!playlist) { res.writeHead(404); return res.end(JSON.stringify({ error: 'playlist not found' })); }
            const entry = playlist.entries.find(e => e.id === itemId);
            if (!entry) { res.writeHead(404); return res.end(JSON.stringify({ error: 'item not found' })); }
            const incoming = { ...data, id: mappingId };
            // Validate before mutating in-memory so we don't leave a
            // half-edited playlist behind on bad input.
            try { validateModulationMapping(incoming); }
            catch (ve) { res.writeHead(400); return res.end(JSON.stringify({ error: ve.message })); }
            entry.modulations = (entry.modulations || []).filter(m => m.id !== mappingId);
            entry.modulations.push(incoming);
            const saved = playlistManager.save(playlist);
            const savedEntry = saved.entries.find(e => e.id === itemId);
            finishOk(savedEntry);
          } catch (e) {
            res.writeHead(400); res.end(JSON.stringify({ error: e.message }));
          }
        });
        return;
      }
      if (req.method === 'PATCH') {
        readBody(data => {
          try {
            if (!data || typeof data !== 'object') {
              res.writeHead(400); return res.end(JSON.stringify({ error: 'request body required' }));
            }
            const playlist = playlistManager.load(playlistName);
            if (!playlist) { res.writeHead(404); return res.end(JSON.stringify({ error: 'playlist not found' })); }
            const entry = playlist.entries.find(e => e.id === itemId);
            if (!entry) { res.writeHead(404); return res.end(JSON.stringify({ error: 'item not found' })); }
            const existing = (entry.modulations || []).find(m => m.id === mappingId);
            if (!existing) { res.writeHead(404); return res.end(JSON.stringify({ error: 'mapping not found' })); }
            const merged = { ...existing, ...data, id: mappingId };
            try { validateModulationMapping(merged); }
            catch (ve) { res.writeHead(400); return res.end(JSON.stringify({ error: ve.message })); }
            entry.modulations = (entry.modulations || []).map(m => m.id === mappingId ? merged : m);
            const saved = playlistManager.save(playlist);
            const savedEntry = saved.entries.find(e => e.id === itemId);
            finishOk(savedEntry);
          } catch (e) {
            res.writeHead(400); res.end(JSON.stringify({ error: e.message }));
          }
        });
        return;
      }
      if (req.method === 'DELETE') {
        try {
          const playlist = playlistManager.load(playlistName);
          if (!playlist) { res.writeHead(404); return res.end(JSON.stringify({ error: 'playlist not found' })); }
          const entry = playlist.entries.find(e => e.id === itemId);
          if (!entry) { res.writeHead(404); return res.end(JSON.stringify({ error: 'item not found' })); }
          const before = (entry.modulations || []).length;
          entry.modulations = (entry.modulations || []).filter(m => m.id !== mappingId);
          if (entry.modulations.length === before) {
            res.writeHead(404); return res.end(JSON.stringify({ error: 'mapping not found' }));
          }
          const saved = playlistManager.save(playlist);
          const savedEntry = saved.entries.find(e => e.id === itemId);
          finishOk(savedEntry);
        } catch (e) {
          res.writeHead(400); res.end(JSON.stringify({ error: e.message }));
        }
        return;
      }
      res.writeHead(405); res.end(JSON.stringify({ error: 'method not allowed' }));
    }
    // ── DECK DYNAMIC VIEW OVERRIDES (deck overlays) ──────────────────────
    // Layered, view-scoped overlay decks composited OVER the main deck. Mirror
    // the mixer overlay routes (fail loud, no silent fallback). Literal-segment
    // routes (/deck/overlays/reorder, /deck/overlays/autopilot) are armed
    // BEFORE the `:id` regexes so the literal segment isn't read as an id.
    // Operator rulings: unique view per overlay (409 DECK_OVERLAY_VIEW_TAKEN),
    // cap 4 (400 DECK_OVERLAY_OVER_CAP), SHARED autopilot timer, SHARED globals,
    // persist across restart. order[0]=bottom, order[last]=top.
    else if (req.method === 'GET' && req.url === '/deck/overlays') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        overlays: (mixer.getDeckOverlays ? mixer.getDeckOverlays() : []).map(serializeChannel),
        overlayAutopilot: {
          active: !!(mixer.deckOverlayAutopilot && mixer.deckOverlayAutopilot.active),
          delay_s: (mixer.deckOverlayAutopilot && typeof mixer.deckOverlayAutopilot.delay_s === 'number')
            ? mixer.deckOverlayAutopilot.delay_s : 30,
          shuffle: !!(mixer.deckOverlayAutopilot && mixer.deckOverlayAutopilot.shuffle),
          ...autoGroupFields(mixer.deckOverlayAutopilot),
        },
      }));
    }
    // POST /deck/overlays { viewSelection(required), playlist|pattern, mode,
    // enabled } — add a deck overlay. Mirrors POST /mixer/channels but targets
    // the deck-overlay stack: REQUIRES an explicit, non-'all' view (never-dark
    // guard), rejects a taken view (409), and the cap (400 over 4).
    else if (req.method === 'POST' && req.url === '/deck/overlays') {
      readBody(data => {
        // viewSelection is REQUIRED (an all-view overlay would defeat the
        // feature AND violate never-dark). Validate first (fail loud).
        if (data.viewSelection === undefined || data.viewSelection === null) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'viewSelection is required for a deck overlay', code: 'DECK_OVERLAY_VIEW_REQUIRED' }));
        }
        const v = validateViewSelection(data.viewSelection);
        if (!v.ok) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: v.error }));
        }
        if (v.value.type === 'all') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'deck overlay viewSelection must target a specific view (not "all")', code: 'DECK_OVERLAY_VIEW_REQUIRED' }));
        }
        // Cap check BEFORE we burn a WASM handle (fail loud, distinct code).
        if ((mixer.getDeckOverlays ? mixer.getDeckOverlays() : []).length >= DECK_OVERLAY_MAX) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: `Maximum of ${DECK_OVERLAY_MAX} deck overlays allowed`, code: 'DECK_OVERLAY_OVER_CAP' }));
        }
        // Unique-view check (409) BEFORE compile.
        if (mixer.deckOverlayViewTaken(v.value, null)) {
          res.writeHead(409, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'a deck overlay already targets this view', code: 'DECK_OVERLAY_VIEW_TAKEN' }));
        }
        // Optional blend mode (default blend_screen). trans_* excluded for
        // overlays — only steady channel-blend modes are valid.
        let mode = 'blend_screen';
        if (data.mode !== undefined) {
          if (!VALID_CHANNEL_BLEND_MODES.has(data.mode)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({
              error: `Invalid deck-overlay blend mode '${data.mode}' (expected one of ${[...VALID_CHANNEL_BLEND_MODES].join(', ')})`,
            }));
          }
          mode = data.mode;
        }
        // Resolve playlist + pattern (mirror POST /mixer/channels).
        let playlistName = data.playlist;
        let entryId = data.playlistEntryId;
        let patternName;
        if (playlistName) {
          const pl = playlistManager.load(playlistName);
          if (!pl) { res.writeHead(400); return res.end(JSON.stringify({ error: `Playlist not found: ${playlistName}` })); }
          const usable = pl.entries.filter(e => !e._missing);
          if (usable.length === 0) { res.writeHead(400); return res.end(JSON.stringify({ error: `Playlist ${playlistName} has no usable entries` })); }
          const entry = entryId ? (pl.entries.find(e => e.id === entryId && !e._missing) || usable[0]) : usable[0];
          entryId = entry.id;
          patternName = entry.pattern;
        } else if (data.pattern) {
          patternName = path.basename(data.pattern, '.js');
          playlistName = 'default';
        } else {
          res.writeHead(400); return res.end(JSON.stringify({ error: 'playlist or pattern required' }));
        }
        const src = loadPattern(patternsDir, patternName);
        const comp = wasmHost.compile(src);
        if (!comp.ok) { res.writeHead(400); return res.end(JSON.stringify({ error: comp.error })); }

        let overlay;
        try {
          overlay = mixer.addDeckOverlay({
            id: 'do_' + Date.now() + '_' + (channelIdCounter++),
            name: data.name || 'Overlay',
            pattern: patternName,
            handle: comp.handle,
            mode,
            fader: data.fader !== undefined ? data.fader : 1.0,
            enabled: data.enabled !== undefined ? !!data.enabled : true,
            viewSelection: v.value,
          });
        } catch (addErr) {
          // Belt-and-braces (the API checks above should have caught these).
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: String(addErr.message || addErr) }));
        }
        onChannelCompiled(overlay);
        try {
          if (data.playlist) {
            loadPlaylistEntry(overlay, playlistName, entryId);
          } else {
            overlay.playlist = { name: playlistName, activeEntryId: null, cursor: 0, autopilot: { active: false, delay_s: 30, shuffle: false } };
          }
        } catch (e) {
          console.warn(`[DeckOverlay] Could not attach playlist ${playlistName} to new overlay:`, e.message);
        }
        finalizeCpcValues(overlay);
        saveAllState();
        broadcastChannelPlaylistData(overlay);
        broadcastDeckState();
        let inlinePlaylistData = null;
        try {
          if (overlay.playlist && overlay.playlist.name) {
            const pl = playlistManager.load(overlay.playlist.name);
            if (pl) inlinePlaylistData = pl;
          }
        } catch (_) {}
        res.writeHead(200); res.end(JSON.stringify({
          status: 'ok',
          overlayId: overlay.id,
          pattern: overlay.pattern,
          color: overlay.color,
          playlist: overlay.playlist,
          playlistData: inlinePlaylistData,
        }));
      });
    }
    // POST /deck/overlays/reorder { order:[ids] } (armed before :id regexes).
    else if (req.method === 'POST' && req.url === '/deck/overlays/reorder') {
      readBody(data => {
        const order = data && data.order;
        const current = mixer.getDeckOverlays ? mixer.getDeckOverlays() : [];
        const currentIds = current.map(o => o.id);
        const bad = (msg) => {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: msg, code: 'REORDER_BAD_SET' }));
        };
        if (!Array.isArray(order)) return bad('order must be an array of overlay ids');
        if (order.length !== currentIds.length) {
          return bad(`order has ${order.length} ids but there are ${currentIds.length} deck overlays`);
        }
        const orderSet = new Set(order);
        if (orderSet.size !== order.length) return bad('order contains duplicate ids');
        const currentSet = new Set(currentIds);
        for (const oid of order) {
          if (!currentSet.has(oid)) return bad(`order contains unknown overlay id '${oid}'`);
        }
        try {
          mixer.reorderDeckOverlays(order);
        } catch (e) {
          return bad(String(e.message || e));
        }
        saveAllState();
        broadcastDeckState();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', order: mixer.getDeckOverlays().map(o => o.id) }));
      });
    }
    // POST /deck/overlays/autopilot { active?, delay_s?, shuffle? } — set the
    // SHARED overlay autopilot cadence (operator refinement #1: ONE clock for
    // the whole group). Armed before the :id regexes. delay_s validated by
    // validateAutoCycleDelay (reject ≤0 / non-finite 400 AUTOCYCLE_BAD_DELAY).
    else if (req.method === 'POST' && req.url === '/deck/overlays/autopilot') {
      readBody(data => {
        if (data === null || typeof data !== 'object' || Array.isArray(data)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'body must be an object {active?,delay_s?,shuffle?}', code: 'AUTOCYCLE_BAD_PAYLOAD' }));
        }
        let nextDelay;
        if (data.delay_s !== undefined) {
          const dv = validateAutoCycleDelay(data.delay_s);
          if (!dv.ok) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: dv.error, code: 'AUTOCYCLE_BAD_DELAY' }));
          }
          nextDelay = dv.value;
        }
        const ap = mixer.deckOverlayAutopilot = mixer.deckOverlayAutopilot
          || { active: false, delay_s: 30, shuffle: false };
        if (data.active !== undefined) ap.active = !!data.active;
        if (nextDelay !== undefined) ap.delay_s = nextDelay;
        if (data.shuffle !== undefined) ap.shuffle = !!data.shuffle;
        // PATTERN-GROUP LOCALITY (feat/optimize_channels): mirror `shuffle`. The
        // SHARED overlay autopilot drives every overlay's per-overlay picker, so
        // group config lives on this one object; each overlay keeps its own
        // window in its own transient `_autoGroup`.
        if (data.groupMode !== undefined) ap.groupMode = !!data.groupMode;
        if (data.groupSize !== undefined) {
          ap.groupSize = clampInt(
            data.groupSize, AUTO_GROUP_SIZE_MIN, AUTO_GROUP_SIZE_MAX, AUTO_GROUP_SIZE_DEFAULT);
        }
        if (data.groupDwell !== undefined) {
          ap.groupDwell = clampInt(
            data.groupDwell, AUTO_GROUP_DWELL_MIN, AUTO_GROUP_DWELL_MAX, AUTO_GROUP_DWELL_DEFAULT);
        }
        // Re-seed the SHARED anchor so the next tick measures a full delay_s
        // from THIS arm/change, not a stale pre-patch baseline. Drop each
        // overlay's group window so a reconfigure starts fresh windows.
        mixer._deckOverlayAnchorMs = null;
        if (data.groupMode !== undefined || data.groupSize !== undefined || data.groupDwell !== undefined) {
          for (const overlay of (mixer.getDeckOverlays ? mixer.getDeckOverlays() : [])) {
            if (overlay._autoGroup) { overlay._autoGroup.windowIds = null; overlay._autoGroup.swapsLeft = 0; }
          }
        }
        saveAllState();
        broadcastDeckState();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', overlayAutopilot: { ...ap } }));
      });
    }
    // POST /deck/overlays/:id/playlist { name } — swap the overlay's playlist.
    else if (req.method === 'POST' && req.url.match(/^\/deck\/overlays\/[^\/]+\/playlist$/)) {
      const id = decodeURIComponent(req.url.split('/')[3]);
      readBody(data => {
        const overlay = mixer.getDeckOverlay(id);
        if (!overlay) { res.writeHead(404); return res.end(JSON.stringify({ error: 'deck overlay not found' })); }
        try {
          if (data.name === null) {
            overlay.playlist = null;
            saveAllState();
            res.writeHead(200); res.end(JSON.stringify({ status: 'ok', playlist: null, playlistData: null }));
            broadcastDeckState(); return;
          }
          const pl = playlistManager.load(data.name);
          if (!pl) { res.writeHead(404); return res.end(JSON.stringify({ error: 'playlist not found' })); }
          const firstEntry = pl.entries.find(e => !e._missing) || pl.entries[0];
          if (!firstEntry) {
            overlay.playlist = { name: pl.name, activeEntryId: null, cursor: 0, autopilot: { active: false, delay_s: 30, shuffle: false } };
            saveAllState();
            res.writeHead(200); res.end(JSON.stringify({ status: 'ok', playlist: overlay.playlist, playlistData: pl }));
            broadcastChannelPlaylistData(overlay);
            broadcastDeckState(); return;
          }
          loadPlaylistEntry(overlay, pl.name, firstEntry.id);
          saveAllState();
          res.writeHead(200); res.end(JSON.stringify({ status: 'ok', playlist: overlay.playlist, playlistData: pl }));
          broadcastChannelPlaylistData(overlay);
          broadcastDeckState();
        } catch (e) {
          res.writeHead(400); res.end(JSON.stringify({ error: e.message }));
        }
      });
    }
    // POST /deck/overlays/:id/playlist/entry { entryId } — load a specific entry.
    else if (req.method === 'POST' && req.url.match(/^\/deck\/overlays\/[^\/]+\/playlist\/entry$/)) {
      const id = decodeURIComponent(req.url.split('/')[3]);
      readBody(data => {
        const overlay = mixer.getDeckOverlay(id);
        if (!overlay) { res.writeHead(404); return res.end(JSON.stringify({ error: 'deck overlay not found' })); }
        if (!overlay.playlist || !overlay.playlist.name) {
          res.writeHead(400); return res.end(JSON.stringify({ error: 'no playlist loaded' }));
        }
        if (!data.entryId) {
          res.writeHead(400); return res.end(JSON.stringify({ error: 'entryId required' }));
        }
        try {
          loadPlaylistEntry(overlay, overlay.playlist.name, data.entryId);
          saveAllState();
          res.writeHead(200); res.end(JSON.stringify({ status: 'ok', playlist: overlay.playlist, pattern: overlay.pattern }));
          broadcastDeckState();
        } catch (e) {
          res.writeHead(400); res.end(JSON.stringify({ error: e.message }));
        }
      });
    }
    // PATCH /deck/overlays/:id { mode, fader, enabled, faderLocked, faderMax,
    // color, hue, viewSelection } — mutate one overlay. The role guard rejects
    // the deck id and any mixer overlay id (must be a deck-overlay id).
    else if (req.method === 'PATCH' && req.url.match(/^\/deck\/overlays\/[^\/]+$/)) {
      const id = decodeURIComponent(req.url.split('/')[3]);
      readBody(data => {
        // Role guard: :id must be a deck overlay — not the deck channel,
        // not a mixer overlay (fail loud, mirrors rejectIfWrongRole).
        if (mixer.deckChannel && id === mixer.deckChannel.id) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'deck channel cannot be addressed via /deck/overlays routes', code: 'WRONG_ROLE', useInstead: '/deck/channel' }));
        }
        if (mixer.getMixerChannel && mixer.getMixerChannel(id)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'mixer overlay cannot be addressed via /deck/overlays routes', code: 'WRONG_ROLE', useInstead: `/mixer/channels/${encodeURIComponent(id)}` }));
        }
        const overlay = mixer.getDeckOverlay(id);
        if (!overlay) { res.writeHead(404); return res.end(JSON.stringify({ error: 'deck overlay not found' })); }
        if (data.name !== undefined) overlay.name = data.name;
        if (data.mode !== undefined) {
          // Overlays only accept steady channel-blend modes (no trans_*).
          if (!VALID_CHANNEL_BLEND_MODES.has(data.mode)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({
              error: `Invalid deck-overlay blend mode '${data.mode}' (expected one of ${[...VALID_CHANNEL_BLEND_MODES].join(', ')})`,
            }));
          }
          overlay.mode = data.mode;
          mixer.getBlendHandle(data.mode);
        }
        if (data.fader !== undefined) {
          const fv = validateFader(data.fader);
          if (!fv.ok) { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: fv.error })); }
          if (!overlay.faderLocked) overlay.fader = fv.value;
        }
        if (data.enabled !== undefined) overlay.enabled = !!data.enabled;
        if (data.faderLocked !== undefined) overlay.faderLocked = !!data.faderLocked;
        if (data.faderMax !== undefined) {
          const fm = validateFader(data.faderMax);
          if (!fm.ok) { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: fm.error.replace('fader', 'faderMax') })); }
          overlay.faderMax = fm.value;
        }
        if (data.color !== undefined) {
          if (data.color !== null && typeof data.color !== 'string') {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: `color must be a string or null, got ${typeof data.color}` }));
          }
          overlay.color = data.color === null ? null : data.color;
        }
        if (data.hue !== undefined) {
          const hv = validateHue(data.hue);
          if (!hv.ok) { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: hv.error })); }
          overlay.hue = hv.value;
        }
        if (data.viewSelection !== undefined) {
          const v = validateViewSelection(data.viewSelection);
          if (!v.ok) { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: v.error })); }
          // Never-dark guard + unique-view rule (409) on view change too.
          if (v.value.type === 'all') {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'deck overlay viewSelection must target a specific view (not "all")', code: 'DECK_OVERLAY_VIEW_REQUIRED' }));
          }
          if (mixer.deckOverlayViewTaken(v.value, id)) {
            res.writeHead(409, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'a deck overlay already targets this view', code: 'DECK_OVERLAY_VIEW_TAKEN' }));
          }
          mixer.setDeckOverlayViewSelection(id, v.value);
        }
        if (data.pattern !== undefined && data.pattern !== overlay.pattern) {
          const patternName = path.basename(data.pattern, '.js');
          const src = loadPattern(patternsDir, patternName);
          const comp = wasmHost.compile(src);
          if (comp.ok) {
            if (overlay.handle) wasmHost.destroy(overlay.handle);
            overlay.handle = comp.handle;
            overlay.pattern = patternName;
            overlay.localControls = {};
            onChannelCompiled(overlay);
            finalizeCpcValues(overlay);
          } else {
            console.warn(`[DeckOverlay] Pattern swap FAILED: ${patternName} compile error:`, comp.error);
          }
        }
        saveAllState();
        broadcastDeckState();
        res.writeHead(200); res.end(JSON.stringify({ status: 'ok' }));
      });
    }
    // DELETE /deck/overlays/:id — remove an overlay (free its WASM handle).
    else if (req.method === 'DELETE' && req.url.match(/^\/deck\/overlays\/[^\/]+$/)) {
      const id = decodeURIComponent(req.url.split('/')[3]);
      if (paramCenter) paramCenter.unregisterChannel(id);
      const removed = mixer.removeDeckOverlay(id);
      if (!removed) { res.writeHead(404); return res.end(JSON.stringify({ error: 'deck overlay not found' })); }
      saveAllState();
      broadcastDeckState();
      res.writeHead(200); res.end(JSON.stringify({ status: 'ok' }));
    }
    // ── DECK CHANNEL (post-split) ────────────────────────────────────────
    // Replaces the deck-via-/mixer/channels/<baseId>/... access pattern.
    // The deck is a singleton (no id needed in the URL) and these routes
    // refuse to surface mixer overlay channels.
    else if (req.method === 'GET' && req.url === '/deck/channel') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        master: mixer.master,
        blackout: globalsState.blackout,
        channel: serializeDeckChannel(),
      }));
    } else if (req.method === 'PATCH' && req.url === '/deck/channel') {
      // PATCH the deck channel — same fields as the mixer's PATCH but
      // routed through the deck slot. The legacy `/mixer/channels/<deckId>`
      // PATCH no longer accepts the deck id (returns WRONG_ROLE).
      readBody(data => {
        const channel = mixer.getDeckChannel();
        if (!channel) { res.writeHead(404); return res.end(JSON.stringify({ error: 'no deck channel' })); }
        if (data.name !== undefined) channel.name = data.name;
        if (data.mode !== undefined) {
          if (!isValidBlendMode(data.mode)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({
              error: `Invalid blend mode '${data.mode}' (expected one of ` +
                `${[...VALID_CHANNEL_BLEND_MODES].join(', ')} or a trans_* transition)`,
            }));
          }
          if (channel._savedMode) delete channel._savedMode;
          mixer.cancelChannelTransition(channel.id);
          channel.mode = data.mode;
          mixer.getBlendHandle(data.mode);
        }
        if (data.fader !== undefined) {
          // Codex P0: reject non-finite, clamp finite (see validateFader).
          const fv = validateFader(data.fader);
          if (!fv.ok) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: fv.error }));
          }
          // Fader-lock: same silent-skip semantics as the mixer PATCH.
          if (!channel.faderLocked) {
            mixer.cancelChannelTransition(channel.id);
            channel.fader = fv.value;
          }
        }
        if (data.enabled !== undefined) channel.enabled = data.enabled;
        if (data.faderLocked !== undefined) channel.faderLocked = !!data.faderLocked;
        // F-C: per-channel intensity ceiling on the deck channel. (The deck
        // drives the mission-critical exterior — a clamp here caps its own
        // contribution; same validation as the mixer PATCH.)
        if (data.faderMax !== undefined) {
          const fm = validateFader(data.faderMax);
          if (!fm.ok) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: fm.error.replace('fader', 'faderMax') }));
          }
          channel.faderMax = fm.value;
        }
        // F-D: per-channel color metadata on the deck channel.
        if (data.color !== undefined) {
          if (data.color !== null && typeof data.color !== 'string') {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: `color must be a string or null, got ${typeof data.color}` }));
          }
          channel.color = data.color === null ? null : data.color;
        }
        // F-hue: per-channel hue on the deck channel. Same validation +
        // semantics as the mixer PATCH (docs/39 §F-hue).
        if (data.hue !== undefined) {
          const hv = validateHue(data.hue);
          if (!hv.ok) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: hv.error }));
          }
          channel.hue = hv.value;
        }
        // F-phase #4 on the deck channel — tap-tempo opt-in, same semantics
        // as the mixer PATCH (docs/39 §F-phase).
        if (data.followsTempo !== undefined) {
          channel.followsTempo = !!data.followsTempo;
        }
        if (data.locked !== undefined) {
          const becameLocked = !channel.locked && !!data.locked;
          channel.locked = !!data.locked;
          if (becameLocked) {
            const pending = captureTimers.get(channel.id);
            if (pending) { clearTimeout(pending); captureTimers.delete(channel.id); }
          }
          clearChannelDirty(channel);
        }
        if (data.viewSelection !== undefined) {
          const v = validateViewSelection(data.viewSelection);
          if (!v.ok) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: v.error }));
          }
          mixer.setChannelViewSelection(channel.id, v.value);
        }
        saveAllState();
        broadcastMixerState();
        res.writeHead(200); res.end(JSON.stringify({ status: 'ok' }));
      });
    } else if (req.method === 'POST' && req.url === '/deck/channel/control') {
      // Per-control write targeting the deck channel. Mirrors
      // `POST /mixer/channels/:id/control` for the deck role.
      readBody(data => {
        const channel = mixer.getDeckChannel();
        if (!channel) { res.writeHead(404); return res.end(JSON.stringify({ error: 'no deck channel' })); }
        if (data.id === undefined) {
          res.writeHead(400); return res.end(JSON.stringify({ error: 'id required' }));
        }
        paramRouter.setChannelControl(channel.id, data.id, data.v0 || 0, data.v1 || 0, data.v2 || 0);
        scheduleEntryCapture(channel.id);
        markChannelDirtyIfLocked(channel.id);
        // Per-pattern param SHARING: mirror onto siblings on the same
        // (playlist, pattern) — mixer overlays + deck overlays.
        propagateAndCapturePatternParam(channel.id, data.id, data.v0 || 0, data.v1 || 0, data.v2 || 0);
        saveAllState();
        broadcastMixerState();
        broadcastDeckState();
        res.writeHead(200); res.end(JSON.stringify({ status: 'ok' }));
      });
    }
    // ── DECK PLAYLIST ASSIGNMENT ─────────────────────────────────────────
    else if (req.method === 'GET' && req.url === '/deck/playlist') {
      const baseCh = mixer.getDeckChannel();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(baseCh && baseCh.playlist ? baseCh.playlist : null));
    } else if (req.method === 'POST' && req.url === '/deck/playlist') {
      readBody(data => {
        const baseCh = mixer.getDeckChannel();
        if (!baseCh) { res.writeHead(404); return res.end(JSON.stringify({ error: 'no deck channel' })); }
        try {
          if (data.name === null) {
            baseCh.playlist = null;
            // Modulation context must be cleared here too — otherwise
            // the last entry's mappings keep firing until a new
            // pattern lands. setActiveEntry handles the
            // null-playlist case (empty mappings → _lastWrittenTargets
            // clears + base restore fires on the next frame).
            pushActiveEntryToModulation();
            saveAllState();
            res.writeHead(200); res.end(JSON.stringify({ status: 'ok', playlist: null }));
            broadcastMixerState();
            return;
          }
          const pl = playlistManager.load(data.name);
          if (!pl) { res.writeHead(404); return res.end(JSON.stringify({ error: 'playlist not found' })); }
          // Pick first non-missing entry, else first entry
          let firstEntry = pl.entries.find(e => !e._missing) || pl.entries[0];
          if (!firstEntry) {
            baseCh.playlist = {
              name: pl.name, activeEntryId: null, cursor: 0,
              autopilot: (baseCh.playlist && baseCh.playlist.autopilot) || { active: false, delay_s: 30, shuffle: false }
            };
            saveAllState();
            res.writeHead(200); res.end(JSON.stringify({ status: 'ok', playlist: baseCh.playlist }));
            broadcastMixerState();
            return;
          }
          loadPlaylistEntry(baseCh, pl.name, firstEntry.id);
          saveAllState();
          opts.pattern = baseCh.pattern;
          res.writeHead(200); res.end(JSON.stringify({ status: 'ok', playlist: baseCh.playlist }));
          broadcastWs({ type: 'pattern', name: baseCh.pattern });
          broadcastMixerState();
        } catch (e) {
          res.writeHead(400); res.end(JSON.stringify({ error: e.message }));
        }
      });
    } else if (req.method === 'POST' && req.url === '/deck/playlist/entry') {
      readBody(data => {
        const baseCh = mixer.getDeckChannel();
        if (!baseCh) { res.writeHead(404); return res.end(JSON.stringify({ error: 'no deck channel' })); }
        if (!baseCh.playlist || !baseCh.playlist.name) {
          res.writeHead(400); return res.end(JSON.stringify({ error: 'no playlist loaded' }));
        }
        if (!data.entryId) {
          res.writeHead(400); return res.end(JSON.stringify({ error: 'entryId required' }));
        }
        try {
          // Route through the deck-transition helper. With transitions
          // disabled, it falls back to the instant load + does the same
          // broadcasts; with transitions enabled, it kicks off a soft
          // swap and broadcasts a `deckSwapStarted` event so the UI can
          // show pending state, then `deckSwapComplete` on landing.
          const r = loadPlaylistEntryWithTransition(
            baseCh, baseCh.playlist.name, data.entryId, deckTransitionConfig,
          );
          res.writeHead(200);
          res.end(JSON.stringify({
            status: 'ok',
            playlist: baseCh.playlist,
            pattern: baseCh.pattern,
            transitionId: r && r.transitionId ? r.transitionId : null,
            // FIX B: the RESOLVED target entry id for this swap. During a soft
            // transition baseCh.playlist.activeEntryId is still the OLD entry
            // (the new id is written in onComplete after the fade), so the
            // client must arm its pending-gate from THIS, not playlist.
            // activeEntryId, or the panel suppresses reconcile until the ~8s
            // watchdog. For the entry-advance path the resolved target IS the
            // requested entryId.
            targetEntryId: data.entryId,
          }));
        } catch (e) {
          if (e && e.code === 'EBUSY') {
            // Operator tapped during an in-flight transition. Per the
            // user's spec these taps are silently ignored — return 409
            // (Conflict) so the client knows nothing changed but it's
            // not an error. The iPad already greys the list during a
            // swap, so this is belt-and-suspenders.
            res.writeHead(409); res.end(JSON.stringify({
              error: 'transition in progress', code: 'EBUSY',
            }));
          } else {
            res.writeHead(400); res.end(JSON.stringify({ error: e.message }));
          }
        }
      });
    } else if (req.method === 'POST' && req.url === '/deck/playlist/swap') {
      // ── Hot-swap the deck playlist (feat/timeline_support) ────────────
      // Load a DIFFERENT playlist and transition to its first (or a
      // specified) entry using the SAME deck transition machinery as
      // /deck/playlist/entry — no blocking full-recompile stall, the swap
      // rides the smooth crossfade/transition. This is additive and behind
      // an explicit endpoint; the existing entry-advance route is untouched.
      //
      // Body: { name: string, entryId?: string, transition?: {...} }
      //   name       — playlist to swap to (required)
      //   entryId    — entry within that playlist to land on (optional;
      //                defaults to the first non-missing entry)
      //   transition — OPTIONAL per-call override of the global deck
      //                transition config FOR THIS SWAP ONLY (item 10,
      //                feat/timeline_support). { enabled?, shuffle?,
      //                mode?, durationMs? }, validated identically to
      //                POST /deck/transition-config. Omitted ⇒ existing
      //                callers get the exact current behavior (the global
      //                deckTransitionConfig). Does NOT mutate the global.
      readBody(data => {
        const baseCh = mixer.getDeckChannel();
        if (!baseCh) { res.writeHead(404); return res.end(JSON.stringify({ error: 'no deck channel' })); }
        if (typeof data.name !== 'string' || data.name.length === 0) {
          res.writeHead(400); return res.end(JSON.stringify({ error: 'name (playlist) required' }));
        }
        // Resolve the transition config for THIS swap: validated per-call
        // override layered on the global. A bad override 400s before we
        // touch the deck — fail loud, don't silently use the global.
        const tv = validateSwapTransitionOverride(data.transition, deckTransitionConfig);
        if (!tv.ok) {
          res.writeHead(400); return res.end(JSON.stringify({ error: tv.error }));
        }
        const swapTransitionConfig = tv.value;
        let pl;
        try {
          pl = playlistManager.load(data.name);
        } catch (e) {
          if (e instanceof PlaylistLoadError) {
            res.writeHead(400); return res.end(JSON.stringify({ error: e.message, code: e.code }));
          }
          throw e;
        }
        if (!pl) { res.writeHead(404); return res.end(JSON.stringify({ error: 'playlist not found' })); }
        // Resolve the target entry: explicit entryId, else first usable.
        let targetEntry;
        if (data.entryId !== undefined) {
          targetEntry = pl.entries.find(e => e.id === data.entryId);
          if (!targetEntry) {
            res.writeHead(404); return res.end(JSON.stringify({ error: `entry not found in ${data.name}: ${data.entryId}` }));
          }
          if (targetEntry._missing) {
            res.writeHead(400); return res.end(JSON.stringify({ error: `pattern missing for entry ${data.entryId}: ${targetEntry.pattern}` }));
          }
        } else {
          targetEntry = pl.entries.find(e => !e._missing);
          if (!targetEntry) {
            res.writeHead(400); return res.end(JSON.stringify({ error: `playlist ${data.name} has no usable entries` }));
          }
        }
        try {
          // Same helper the entry-advance path uses. It loads the named
          // playlist fresh, drives the deck transition, and on completion
          // rebinds baseCh.playlist.name to the new playlist — so a swap
          // is just an entry load that happens to cross playlists.
          const r = loadPlaylistEntryWithTransition(
            baseCh, pl.name, targetEntry.id, swapTransitionConfig,
          );
          res.writeHead(200);
          res.end(JSON.stringify({
            status: 'ok',
            playlist: baseCh.playlist,
            pattern: baseCh.pattern,
            transitionId: r && r.transitionId ? r.transitionId : null,
            // FIX B: the RESOLVED target entry id for this swap. During a soft
            // transition baseCh.playlist.activeEntryId is still the OLD entry
            // (the new id is written in onComplete after the fade), so the
            // client must arm its pending-gate from THIS, not playlist.
            // activeEntryId, or the panel pins to the stale id until the ~8s
            // watchdog.
            targetEntryId: targetEntry.id,
          }));
        } catch (e) {
          // Concurrency: an in-flight swap throws EBUSY (see
          // loadPlaylistEntryWithTransition). We return 409 — the SAFER
          // choice (documented): finishing the previous swap NOW to make
          // room would visibly snap the deck to an intermediate pattern the
          // operator didn't ask to settle on. 409 lets the caller (timeline
          // driver) decide whether to retry on the next anchor.
          if (e && e.code === 'EBUSY') {
            res.writeHead(409); res.end(JSON.stringify({ error: 'transition in progress', code: 'EBUSY' }));
          } else {
            res.writeHead(400); res.end(JSON.stringify({ error: e.message }));
          }
        }
      });
    } else if (req.method === 'POST' && req.url === '/deck/playlist/queue') {
      // ── Warm-then-fire-on-anchor (item 11, feat/timeline_support) ─────
      // Compile a target entry and PARK it in the inactive deck slot WITHOUT
      // advancing the deck. The next swap (manual ping-pong or autopilot)
      // that targets the same pattern reuses this warm handle for a
      // zero-compile fade — letting a timeline pre-stage the next look on a
      // musical anchor and fire it instantly when the beat lands.
      //
      // Body: { name: string, entryId?: string }
      //   name    — playlist holding the entry to warm (required)
      //   entryId — entry to warm (optional; first non-missing entry)
      //
      // Uses the SAME leak-safe warmInactiveDeckHandle contract: a
      // redundant or refused handle is destroyed by the mixer, never
      // leaked. Returns once the slot is warm (the compile is synchronous).
      readBody(data => {
        const baseCh = mixer.getDeckChannel();
        if (!baseCh) { res.writeHead(404); return res.end(JSON.stringify({ error: 'no deck channel' })); }
        if (typeof data.name !== 'string' || data.name.length === 0) {
          res.writeHead(400); return res.end(JSON.stringify({ error: 'name (playlist) required' }));
        }
        let pl;
        try {
          pl = playlistManager.load(data.name);
        } catch (e) {
          if (e instanceof PlaylistLoadError) {
            res.writeHead(400); return res.end(JSON.stringify({ error: e.message, code: e.code }));
          }
          throw e;
        }
        if (!pl) { res.writeHead(404); return res.end(JSON.stringify({ error: 'playlist not found' })); }
        let targetEntry;
        if (data.entryId !== undefined) {
          targetEntry = pl.entries.find(e => e.id === data.entryId);
          if (!targetEntry) {
            res.writeHead(404);
            return res.end(JSON.stringify({ error: `entry not found in ${data.name}: ${data.entryId}` }));
          }
          if (targetEntry._missing) {
            res.writeHead(400);
            return res.end(JSON.stringify({ error: `pattern missing for entry ${data.entryId}: ${targetEntry.pattern}` }));
          }
        } else {
          targetEntry = pl.entries.find(e => !e._missing);
          if (!targetEntry) {
            res.writeHead(400);
            return res.end(JSON.stringify({ error: `playlist ${data.name} has no usable entries` }));
          }
        }
        // Refuse to touch the inactive slot mid-fade — it's the live fade
        // target then. warmInactiveDeckHandle also guards this (and would
        // destroy our handle), but returning 409 here avoids a wasted
        // compile and gives the caller a clean retry signal.
        if (mixer.isDeckSwapInFlight && mixer.isDeckSwapInFlight()) {
          res.writeHead(409);
          return res.end(JSON.stringify({ error: 'transition in progress', code: 'EBUSY' }));
        }
        // Already warm with this exact pattern? Skip the compile — the slot
        // holds a ticking handle for it (e.g. a prior queue or ping-pong).
        if (mixer.getInactiveDeckPattern && mixer.getInactiveDeckPattern() === targetEntry.pattern) {
          res.writeHead(200);
          return res.end(JSON.stringify({
            status: 'ok', warmed: targetEntry.pattern, entryId: targetEntry.id, reused: true,
          }));
        }
        try {
          const src = loadPattern(patternsDir, targetEntry.pattern);
          const comp = wasmHost.compile(src);
          if (!comp.ok) {
            res.writeHead(400);
            return res.end(JSON.stringify({ error: `Compile error: ${comp.error}` }));
          }
          // Seed top-level scope so the warmed handle's exports initialize
          // and it ticks correctly while parked at fader 0.
          wasmHost.beginFrame(comp.handle, 0);
          // Ownership of comp.handle transfers to the mixer. If the slot
          // already holds a DIFFERENT pattern, the mixer destroys the old
          // handle; if it somehow holds the same one, it destroys the
          // redundant incoming handle. Either way: no leak.
          const installed = mixer.warmInactiveDeckHandle(targetEntry.pattern, comp.handle);
          if (!installed) {
            // Refused (e.g. a swap raced in). The mixer already destroyed
            // our handle per its contract — surface loudly, don't pretend.
            res.writeHead(409);
            return res.end(JSON.stringify({
              error: 'could not warm slot (swap in flight)', code: 'EBUSY',
            }));
          }
          res.writeHead(200);
          res.end(JSON.stringify({
            status: 'ok', warmed: targetEntry.pattern, entryId: targetEntry.id, reused: false,
          }));
        } catch (e) {
          res.writeHead(400); res.end(JSON.stringify({ error: e.message }));
        }
      });
    } else if (req.method === 'POST' && req.url === '/deck/playlist/capture') {
      const baseCh = mixer.getDeckChannel();
      if (!baseCh) { res.writeHead(404); return res.end(JSON.stringify({ error: 'no deck channel' })); }
      try {
        const captured = captureActiveEntryDefaults(baseCh);
        clearChannelDirty(baseCh);
        res.writeHead(200); res.end(JSON.stringify({ status: 'ok', defaults: captured }));
        broadcastWs({ type: 'playlistEntryCaptured', channelId: baseCh.id, playlist: baseCh.playlist.name, entryId: baseCh.playlist.activeEntryId, defaults: captured });
        broadcastMixerState();
      } catch (e) {
        res.writeHead(400); res.end(JSON.stringify({ error: e.message }));
      }
    } else if (req.method === 'POST' && req.url === '/deck/playlist/autopilot') {
      readBody(data => {
        const baseCh = mixer.getDeckChannel();
        if (!baseCh) { res.writeHead(404); return res.end(JSON.stringify({ error: 'no deck channel' })); }
        baseCh.playlist = baseCh.playlist || { name: null, activeEntryId: null, cursor: 0, autopilot: { active: false, delay_s: 30, shuffle: false } };
        const ap = baseCh.playlist.autopilot = baseCh.playlist.autopilot || { active: false, delay_s: 30, shuffle: false };
        if (data.active !== undefined) ap.active = !!data.active;
        if (data.delay_s !== undefined) ap.delay_s = parseInt(data.delay_s, 10) || 30;
        if (data.shuffle !== undefined) ap.shuffle = !!data.shuffle;
        // PATTERN-GROUP LOCALITY (feat/optimize_channels): mirror `shuffle` —
        // groupMode bool, groupSize/groupDwell ints clamped to their windows.
        if (data.groupMode !== undefined) ap.groupMode = !!data.groupMode;
        if (data.groupSize !== undefined) {
          ap.groupSize = clampInt(
            data.groupSize, AUTO_GROUP_SIZE_MIN, AUTO_GROUP_SIZE_MAX, AUTO_GROUP_SIZE_DEFAULT);
        }
        if (data.groupDwell !== undefined) {
          ap.groupDwell = clampInt(
            data.groupDwell, AUTO_GROUP_DWELL_MIN, AUTO_GROUP_DWELL_MAX, AUTO_GROUP_DWELL_DEFAULT);
        }
        // Reconfiguring group-locality starts a fresh group (drop the window).
        if (data.groupMode !== undefined || data.groupSize !== undefined || data.groupDwell !== undefined) {
          if (baseCh._autoGroup) { baseCh._autoGroup.windowIds = null; baseCh._autoGroup.swapsLeft = 0; }
        }
        saveAllState();
        autopilot.updateState({ active: ap.active, delay_s: String(ap.delay_s), shuffle: ap.shuffle });
        res.writeHead(200); res.end(JSON.stringify({ status: 'ok', autopilot: ap }));
        broadcastMixerState();
        broadcastAutopilot();
      });
    } else if (req.method === 'GET' && req.url === '/deck/transition-config') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(deckTransitionConfig));
    } else if (req.method === 'POST' && req.url === '/deck/transition-config') {
      readBody(data => {
        // Validate + clamp each field individually so a partial POST
        // can update one knob without resetting the rest.
        if (typeof data.enabled === 'boolean') deckTransitionConfig.enabled = data.enabled;
        if (typeof data.shuffle === 'boolean') deckTransitionConfig.shuffle = data.shuffle;
        if (data.mode !== undefined) {
          // The deck transition `mode` is a scripted transition (trans_*),
          // not a steady channel blend. Reject anything else with 400 so a
          // typo can't silently leave the previous mode in place.
          if (typeof data.mode !== 'string' || !data.mode.startsWith('trans_')) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({
              error: `transition-config mode must be a trans_* transition name, got '${data.mode}'`,
            }));
          }
          deckTransitionConfig.mode = data.mode;
        }
        if (data.durationMs !== undefined) {
          // NaN/finite validation (Codex P0): reject a non-finite duration
          // with 400 instead of silently coercing it (Number(NaN)||1000
          // used to mask 'abc'/NaN as 1000s, hiding a broken client). A
          // finite value is still clamped to the safe 50..30000 ms window.
          const n = Number(data.durationMs);
          if (!Number.isFinite(n)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({
              error: `durationMs must be a finite number, got '${data.durationMs}'`,
            }));
          }
          deckTransitionConfig.durationMs = Math.max(50, Math.min(30000, n));
        }
        saveAllState();
        // Broadcast so other clients see the change immediately.
        broadcastWs({ type: 'deckTransitionConfig', ...deckTransitionConfig });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(deckTransitionConfig));
      });
    }
    // ── MIXER CHANNEL PLAYLIST ASSIGNMENT ────────────────────────────────
    else if (req.method === 'GET' && req.url.match(/^\/mixer\/channels\/[^\/]+\/playlist$/)) {
      const id = req.url.split('/')[3];
      const reject = rejectIfWrongRole(id, 'mixer');
      if (reject) { res.writeHead(reject.status, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(reject.body)); }
      const ch = mixer.getMixerChannel(id);
      if (!ch) { res.writeHead(404); return res.end(JSON.stringify({ error: 'channel not found' })); }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(ch.playlist || null));
    } else if (req.method === 'POST' && req.url.match(/^\/mixer\/channels\/[^\/]+\/playlist$/)) {
      const id = req.url.split('/')[3];
      const reject = rejectIfWrongRole(id, 'mixer');
      if (reject) { res.writeHead(reject.status, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(reject.body)); }
      readBody(data => {
        const ch = mixer.getMixerChannel(id);
        if (!ch) { res.writeHead(404); return res.end(JSON.stringify({ error: 'channel not found' })); }
        try {
          if (data.name === null) {
            ch.playlist = null;
            saveAllState();
            res.writeHead(200); res.end(JSON.stringify({ status: 'ok', playlist: null, playlistData: null }));
            broadcastMixerState(); return;
          }
          const pl = playlistManager.load(data.name);
          if (!pl) { res.writeHead(404); return res.end(JSON.stringify({ error: 'playlist not found' })); }
          let firstEntry = pl.entries.find(e => !e._missing) || pl.entries[0];
          if (!firstEntry) {
            ch.playlist = { name: pl.name, activeEntryId: null, cursor: 0, autopilot: { active: false, delay_s: 30, shuffle: false } };
            saveAllState();
            // Empty-but-named playlist: send the (empty) data inline
            // so the panel can still render "Empty playlist" without
            // hitting the network.
            res.writeHead(200); res.end(JSON.stringify({ status: 'ok', playlist: ch.playlist, playlistData: pl }));
            broadcastChannelPlaylistData(ch);
            broadcastMixerState(); return;
          }
          loadPlaylistEntry(ch, pl.name, firstEntry.id);
          saveAllState();
          // playlistData mirrors POST /mixer/channels — entries are
          // included inline so the panel never needs to GET
          // /playlists/<name> for this swap. See engine_inline_playlist
          // todo in the assistant transcript for context.
          res.writeHead(200); res.end(JSON.stringify({ status: 'ok', playlist: ch.playlist, playlistData: pl }));
          // Prime every connected client's cache for the NEW playlist
          // before the mixer broadcast tells them the channel changed.
          broadcastChannelPlaylistData(ch);
          broadcastMixerState();
        } catch (e) {
          res.writeHead(400); res.end(JSON.stringify({ error: e.message }));
        }
      });
    } else if (req.method === 'POST' && req.url.match(/^\/mixer\/channels\/[^\/]+\/playlist\/entry$/)) {
      const id = req.url.split('/')[3];
      const reject = rejectIfWrongRole(id, 'mixer');
      if (reject) { res.writeHead(reject.status, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(reject.body)); }
      readBody(data => {
        const ch = mixer.getMixerChannel(id);
        if (!ch) { res.writeHead(404); return res.end(JSON.stringify({ error: 'channel not found' })); }
        if (!ch.playlist || !ch.playlist.name) {
          res.writeHead(400); return res.end(JSON.stringify({ error: 'no playlist loaded' }));
        }
        if (!data.entryId) {
          res.writeHead(400); return res.end(JSON.stringify({ error: 'entryId required' }));
        }
        try {
          // Mixer overlay entry swap = instant load (no deck transition
          // machinery on this path). The deck-side soft-swap branch
          // that used to live here moved to /deck/playlist/entry now
          // that mixer/deck routes are isolated.
          loadPlaylistEntry(ch, ch.playlist.name, data.entryId);
          saveAllState();
          res.writeHead(200); res.end(JSON.stringify({ status: 'ok', playlist: ch.playlist, pattern: ch.pattern }));
          broadcastMixerState();
        } catch (e) {
          if (e && e.code === 'EBUSY') {
            res.writeHead(409); res.end(JSON.stringify({
              error: 'transition in progress', code: 'EBUSY',
            }));
          } else {
            res.writeHead(400); res.end(JSON.stringify({ error: e.message }));
          }
        }
      });
    } else if (req.method === 'POST' && req.url.match(/^\/mixer\/channels\/[^\/]+\/playlist\/swap$/)) {
      // Mixer-overlay equivalent of /deck/playlist/swap. Mixer overlays
      // don't have the deck's double-buffer transition machinery, so this
      // is an instant load of a DIFFERENT playlist's first/specified entry
      // onto the overlay. Additive + explicit, mirroring the deck route.
      //
      // Body: { name: string, entryId?: string }
      const id = req.url.split('/')[3];
      const reject = rejectIfWrongRole(id, 'mixer');
      if (reject) { res.writeHead(reject.status, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(reject.body)); }
      readBody(data => {
        const ch = mixer.getMixerChannel(id);
        if (!ch) { res.writeHead(404); return res.end(JSON.stringify({ error: 'channel not found' })); }
        if (typeof data.name !== 'string' || data.name.length === 0) {
          res.writeHead(400); return res.end(JSON.stringify({ error: 'name (playlist) required' }));
        }
        let pl;
        try {
          pl = playlistManager.load(data.name);
        } catch (e) {
          if (e instanceof PlaylistLoadError) {
            res.writeHead(400); return res.end(JSON.stringify({ error: e.message, code: e.code }));
          }
          throw e;
        }
        if (!pl) { res.writeHead(404); return res.end(JSON.stringify({ error: 'playlist not found' })); }
        let targetEntry;
        if (data.entryId !== undefined) {
          targetEntry = pl.entries.find(e => e.id === data.entryId);
          if (!targetEntry) {
            res.writeHead(404); return res.end(JSON.stringify({ error: `entry not found in ${data.name}: ${data.entryId}` }));
          }
          if (targetEntry._missing) {
            res.writeHead(400); return res.end(JSON.stringify({ error: `pattern missing for entry ${data.entryId}: ${targetEntry.pattern}` }));
          }
        } else {
          targetEntry = pl.entries.find(e => !e._missing);
          if (!targetEntry) {
            res.writeHead(400); return res.end(JSON.stringify({ error: `playlist ${data.name} has no usable entries` }));
          }
        }
        try {
          loadPlaylistEntry(ch, pl.name, targetEntry.id);
          saveAllState();
          res.writeHead(200); res.end(JSON.stringify({ status: 'ok', playlist: ch.playlist, pattern: ch.pattern, playlistData: pl }));
          broadcastChannelPlaylistData(ch);
          broadcastMixerState();
        } catch (e) {
          res.writeHead(400); res.end(JSON.stringify({ error: e.message }));
        }
      });
    } else if (req.method === 'POST' && req.url.match(/^\/mixer\/channels\/[^\/]+\/playlist\/capture$/)) {
      const id = req.url.split('/')[3];
      const reject = rejectIfWrongRole(id, 'mixer');
      if (reject) { res.writeHead(reject.status, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(reject.body)); }
      const ch = mixer.getMixerChannel(id);
      if (!ch) { res.writeHead(404); return res.end(JSON.stringify({ error: 'channel not found' })); }
      try {
        const captured = captureActiveEntryDefaults(ch);
        clearChannelDirty(ch);
        res.writeHead(200); res.end(JSON.stringify({ status: 'ok', defaults: captured }));
        broadcastWs({
          type: 'playlistEntryCaptured',
          channelId: ch.id,
          playlist: ch.playlist.name,
          entryId: ch.playlist.activeEntryId,
          defaults: captured,
        });
        broadcastMixerState();
      } catch (e) {
        res.writeHead(400); res.end(JSON.stringify({ error: e.message }));
      }
    } else if (req.method === 'POST' && req.url.match(/^\/mixer\/channels\/[^\/]+\/playlist\/discard$/)) {
      // Discard in-memory edits and snap the channel back to the saved
      // playlist entry defaults. Used by the "Load from playlist" branch of
      // the unlock-dirty prompt.
      const id = req.url.split('/')[3];
      const reject = rejectIfWrongRole(id, 'mixer');
      if (reject) { res.writeHead(reject.status, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(reject.body)); }
      const ch = mixer.getMixerChannel(id);
      if (!ch) { res.writeHead(404); return res.end(JSON.stringify({ error: 'channel not found' })); }
      if (!ch.playlist || !ch.playlist.name || !ch.playlist.activeEntryId) {
        res.writeHead(400); return res.end(JSON.stringify({ error: 'no active playlist entry' }));
      }
      try {
        const pl = playlistManager.load(ch.playlist.name);
        if (!pl) { res.writeHead(404); return res.end(JSON.stringify({ error: 'playlist not found' })); }
        const entry = pl.entries.find(e => e.id === ch.playlist.activeEntryId);
        if (!entry) { res.writeHead(404); return res.end(JSON.stringify({ error: 'entry not found' })); }

        // Re-apply the on-disk defaults exactly as `loadPlaylistEntry` would
        // on a fresh swap. Clear localControls first so any keys NOT present
        // in the saved defaults snap back to the WASM export's initial value.
        ch.localControls = {};
        playlistManager.applyEntryDefaults(ch, entry, wasmHost, paramRouter, paramCenter);
        finalizeCpcValues(ch);

        // Cancel any pending capture for this channel — discard is an
        // explicit "throw away in-memory edits" action; we shouldn't let a
        // stale timer fire after we revert.
        const pending = captureTimers.get(id);
        if (pending) { clearTimeout(pending); captureTimers.delete(id); }

        clearChannelDirty(ch);
        saveAllState();
        res.writeHead(200); res.end(JSON.stringify({ status: 'ok', defaults: entry.defaults || {} }));
        broadcastMixerState();
      } catch (e) {
        res.writeHead(400); res.end(JSON.stringify({ error: e.message }));
      }
    } else {
      res.writeHead(404); res.end('Not Found');
    }
  });

  // ── Topic-split WS topology ───────────────────────────────────────────
  //
  // Pre-split, the engine ran a single WebSocketServer at `/` and every
  // broadcast went to every client. With the audio analyser running and
  // 3 mixer channels, that meant the iPad's onmessage handler was
  // parsing ~50 messages/sec just to figure out which 1-2 of them it
  // actually cared about — enough to starve the JS thread and leave the
  // audio config tab spinning for 30+ s after mount.
  //
  // Each WSS uses `noServer: true` and we route the HTTP upgrade
  // request by path. The legacy root path `/` is intentionally NOT
  // exposed — clients MUST pick a topic. See lib/ws_topic_routing.js
  // for the routing table.
  const wssControl = new WebSocketServer({ noServer: true });
  const wssParams  = new WebSocketServer({ noServer: true });
  const wssSignals = new WebSocketServer({ noServer: true });
  const wssViz     = new WebSocketServer({ noServer: true });

  const wssByTopic = {
    [TOPICS.CONTROL]: wssControl,
    [TOPICS.PARAMS]:  wssParams,
    [TOPICS.SIGNALS]: wssSignals,
    [TOPICS.VIZ]:     wssViz,
  };

  // Expose the map BEFORE we wire any handlers — broadcastWs() reads
  // global.wssByTopic on every call and will no-op until this assignment
  // runs. Done early so any synchronous broadcasts during the WS
  // connect handlers (e.g. autopilot.start emitting a state event) find
  // the right socket already registered.
  global.wssByTopic = wssByTopic;
  // Back-compat shim — exported tests + a couple of legacy call sites
  // still reach for `global.wss`. Point it at the control socket so any
  // straggler that broadcasts via the old shape lands on something
  // sensible. New code should never use this.
  global.wss = wssControl;

  for (const [topicName, wssInst] of Object.entries(wssByTopic)) {
    wssInst.on('error', (e) => {
      console.warn(`WebSocketServer[${topicName}] error:`, e.message);
    });
  }

  // Manual upgrade routing.
  //
  // Path → topic mapping. The four `/ws/<topic>` paths are the
  // canonical, post-split topology. The root path `/` is a TRANSITIONAL
  // alias for `/ws/control` so unmigrated clients (in-flight branches
  // that subscribe to the old root socket) still see the UI/state
  // events they need to function. It deliberately does NOT route vis
  // frames or live audio signals — the whole point of the split is
  // that those high-volume streams must not land on `/` anymore. Once
  // every CaptainPad call site is on engineBus topics this alias
  // should be removed.
  const WS_PATH_TO_TOPIC = {
    '/':           TOPICS.CONTROL,
    '/ws/control': TOPICS.CONTROL,
    '/ws/params':  TOPICS.PARAMS,
    '/ws/signals': TOPICS.SIGNALS,
    '/ws/viz':     TOPICS.VIZ,
  };

  server.on('upgrade', (req, socket, head) => {
    let pathname = '/';
    try {
      pathname = new URL(req.url, 'http://localhost').pathname;
    } catch (_) {
      pathname = '/';
    }
    const topic = WS_PATH_TO_TOPIC[pathname];
    if (!topic) {
      // Unknown path. Refuse the upgrade with an explicit 400 so the
      // client sees a real failure instead of a silently-empty socket.
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
      socket.destroy();
      return;
    }
    const wssForTopic = wssByTopic[topic];
    wssForTopic.handleUpgrade(req, socket, head, (ws) => {
      wssForTopic.emit('connection', ws, req);
    });
  });

  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      console.error(`\n  ❌ Port ${opts.port} is already in use by another process.`);
      process.exit(1);
    } else {
      console.error('Server error:', e);
    }
  });
  autopilot.start();

  // ── Per-topic replay-on-connect ──────────────────────────────────────
  // Each socket only replays the cached payloads it owns. A fresh
  // /ws/control connection gets mixer + deck + autopilot + viewOverride
  // + oscStats + audioStatus — not sharedParams, not vis, not
  // liveParams. The audio tab opens /ws/control AND /ws/signals so it
  // still gets a warm liveParams replay below.

  wssControl.on('connection', ws => {
    // Send full state on connect — uses shared serializers. Both deck
    // and mixer go out so a fresh CaptainPad sees both surfaces
    // without having to GET them separately.
    try { ws.send(JSON.stringify(serializeMixerState())); } catch (e) {}
    try { ws.send(JSON.stringify(serializeDeckState())); } catch (e) {}

    // Push the current autopilot + view-override state on connect so
    // late joiners (e.g. CaptainPad after a foreground/background cycle)
    // see the same values that the existing one-shot REST loads would
    // have given them — without having to wait for the next change.
    try {
      const st = autopilot.state || {};
      ws.send(JSON.stringify({
        type: 'autopilot',
        active: !!st.active,
        delay_s: st.delay_s !== undefined ? String(st.delay_s) : '30',
        shuffle: !!st.shuffle,
      }));
    } catch (e) {
      // never let a snapshot send break a fresh WS handshake
    }
    // UNDO state replay (round-2 #10): a late-joining CaptainPad sees the
    // current undo depth/top immediately, so its UNDO button paints enabled/
    // labeled without waiting for the next push.
    try {
      ws.send(JSON.stringify({
        type: 'undoState',
        depth: undoStack.depth,
        top: undoStack.topLabel,
      }));
    } catch (e) {
      // ignore — never break the handshake on a replay send
    }
    try {
      ws.send(JSON.stringify({
        type: 'viewOverride',
        override: viewOverrideMode,
        controlLock: viewOverrideMode === 'deck' ? 'portwatch' : null,
        controlLockLeaseExpiresAtMs: controlLockLeaseExpiresAtMs,
        controlLockLeaseDurationMs: viewOverrideMode === 'deck'
          ? CONTROL_LOCK_LEASE_MS
          : null,
        currentView: mixer.targetViewFader < 0.5 ? 'deck' : 'mixer',
        savedView: savedTargetViewFader === null
          ? null
          : (savedTargetViewFader < 0.5 ? 'deck' : 'mixer'),
      }));
    } catch (e) {
      // ignore
    }

    // Replay cached telemetry so the pills paint immediately on
    // connect rather than waiting up to one second for the next stats
    // tick (docs/24 §10.1, docs/25 §6.3).
    try {
      if (lastOscStats)    ws.send(JSON.stringify(lastOscStats));
      if (lastAudioStatus) ws.send(JSON.stringify(lastAudioStatus));
      // Audio TUNING config replay (single source of truth → all
      // subscribers). Prefer the cached last broadcast; otherwise emit
      // the engine's current config so a Companion connecting BEFORE the
      // first PATCH still seeds its analyzer gain/smooth/device.
      const audioCfg = lastAudioConfig
        || (engineCore && engineCore.audioState && engineCore.audioState.config
            ? { type: 'audioConfig', config: engineCore.audioState.config }
            : null);
      if (audioCfg) ws.send(JSON.stringify(audioCfg));
    } catch (e) {
      // ignore
    }

    // Initial audio-chains snapshot — docs/29 §Interactions step 8:
    // "engine emits one of these immediately after any client reconnects
    // to /ws/control so the iPad picks up changes that happened during
    // disconnect". Reuses the same accessor as GET /audio/chains. If
    // signalPostProcessor isn't initialized (engine booted without
    // audio), skip silently — an empty map would be misleading.
    try {
      const spp = engineCore && engineCore.signalPostProcessor;
      if (spp) {
        ws.send(JSON.stringify({
          type: 'audioChainsChanged',
          chains: spp.getAllChains(),
        }));
      }
    } catch (e) {
      // never let a snapshot send break a fresh WS handshake
    }

    ws.on('message', msg => {
      try {
        const d = JSON.parse(msg);
        if (d.type === 'setControl' && d.id !== undefined) {
          paramRouter.setControl(d.id, d.v0 || 0, d.v1 || 0, d.v2 || 0);
          scheduleEntryCapture(mixer.baseChannelId);
          markChannelDirtyIfLocked(mixer.baseChannelId);
          // Per-pattern param SHARING (see propagatePatternParam).
          if (mixer.baseChannelId) {
            propagateAndCapturePatternParam(mixer.baseChannelId, d.id, d.v0 || 0, d.v1 || 0, d.v2 || 0);
          }
          saveAllState();
          broadcastMixerState();
          broadcastDeckState();
        } else if (d.type === 'setChannelControl' && d.channelId && d.id !== undefined) {
          paramRouter.setChannelControl(d.channelId, d.id, d.v0 || 0, d.v1 || 0, d.v2 || 0);
          scheduleEntryCapture(d.channelId);
          markChannelDirtyIfLocked(d.channelId);
          // Per-pattern param SHARING (see propagatePatternParam).
          propagateAndCapturePatternParam(d.channelId, d.id, d.v0 || 0, d.v1 || 0, d.v2 || 0);
          saveAllState();
          broadcastMixerState();
          broadcastDeckState();
        } else if (d.type === 'setChannelFader' && d.channelId && d.fader !== undefined) {
          // Codex P0: reject a non-finite fader loudly over WS too. We have
          // no res to 4xx on a socket, so push back a typed rejection the
          // iPad can surface + re-sync from; we do NOT coerce NaN to a
          // number. Finite values are clamped to [0,1] before they land.
          const fv = validateFader(d.fader);
          if (!fv.ok) {
            ws.send(JSON.stringify({
              type: 'channelFaderRejected',
              channelId: d.channelId,
              fader: d.fader,
              reason: fv.error,
            }));
            return;
          }
          const channel = mixer.getChannel(d.channelId);
          if (channel) {
            // Fader-lock: refuse manual fader writes on a locked
            // channel. We do NOT broadcast or push back here — the
            // iPad's optimistic local update will be corrected on the
            // next `mixer` broadcast (slider snaps back to the engine
            // truth). This is the cheapest UX path: the operator sees
            // the slider try to move, then it visibly re-pegs to the
            // locked value within ~100ms.
            if (channel.faderLocked) {
              // Force a broadcast so the iPad's slider re-syncs
              // immediately rather than waiting for the next periodic
              // mixer event. Without this the slider can "stick"
              // visually wherever the finger left it.
              broadcastMixerState();
              return;
            }
            // Manual fader writes ALWAYS cancel any in-flight transition
            // for that channel — otherwise the server-side animation
            // would keep overwriting the operator's slider drag, causing
            // a "rubber band" snap-back effect. Agent review (May 2026) §5.
            mixer.cancelChannelTransition(d.channelId);
            channel.fader = fv.value;
            // No broadcast — fader-only updates outside transitions are
            // already at human-touch rate; full state syncs on
            // saveMixerState (e.g. on slider release).
          }
        } else if (d.type === 'setChannelMode' && d.channelId && d.mode) {
          if (!isValidBlendMode(d.mode)) {
            ws.send(JSON.stringify({
              type: 'channelModeRejected',
              channelId: d.channelId,
              mode: d.mode,
              reason: 'invalid-blend-mode',
            }));
            return;
          }
          const channel = mixer.getChannel(d.channelId);
          if (channel) {
            // A manual mode change wins over any in-flight scripted
            // transition for this channel: cancel the transition (which
            // would otherwise restore the old saved mode at completion)
            // and drop the now-stale `_savedMode` so the operator's
            // pick sticks. cancelChannelTransition will also re-apply
            // _savedMode if present — we clear it FIRST so it doesn't
            // overwrite the user's intent.
            if (channel._savedMode) delete channel._savedMode;
            mixer.cancelChannelTransition(d.channelId);
            channel.mode = d.mode;
            // Pre-compile the blend handle so first frame isn't skipped
            mixer.getBlendHandle(d.mode);
            // No save/broadcast — mode changes during transitions are transient.
            // State is persisted explicitly via 'saveMixerState' at transition end.
          }
        } else if (d.type === 'setChannelEnabled' && d.channelId !== undefined) {
          const channel = mixer.getChannel(d.channelId);
          if (channel) {
            channel.enabled = !!d.enabled;
            // No broadcast — enabled toggles during transition setup are batched.
          }
        } else if (d.type === 'saveMixerState') {
          // Explicit save + broadcast — called once at transition completion
          saveAllState();
          broadcastMixerState();
        } else if ((d.type === 'triggerMixerTransition' || d.type === 'triggerTransition') && d.targetChannelId) {
          // Server-driven transition: client sends ONE message, engine
          // animates every overlay channel's fader at 40 Hz on its own
          // render thread. See pattern_mixer.triggerMixerTransition() for
          // the rationale (no WS jitter, no rAF stepping, butter-smooth
          // fades on the actual LED output). The old `triggerTransition`
          // name is accepted for backwards-compat with any deployed iPad
          // that hasn't picked up the rename yet.
          const durationMs = Math.max(1, Math.min(30000, Number.isFinite(d.durationMs) ? d.durationMs : 1000));
          const curve = (d.curve === 'linear') ? 'linear' : 'smoothstep';
          const mode = d.mode || 'exclusiveOverlays';
          // The visual transition style — one of the scripts under
          // patterns/transitions/ (trans_crossfade, trans_flash,
          // trans_dissolve, trans_iris, trans_wipe_*). Defaults to
          // trans_crossfade for back-compat with old clients that don't
          // send this field. Validated again in the mixer.
          const transitionMode = (typeof d.transitionMode === 'string' && d.transitionMode.startsWith('trans_'))
            ? d.transitionMode
            : 'trans_crossfade';

          if (d.targetChannelId === mixer.baseChannelId) {
            ws.send(JSON.stringify({
              type: 'mixerTransitionRejected',
              targetChannelId: d.targetChannelId,
              reason: 'cannot-transition-to-base',
            }));
          } else {
            const transitionId = mixer.triggerMixerTransition({
              targetChannelId: d.targetChannelId,
              durationMs,
              curve,
              mode,
              transitionMode,
              transitionId: d.transitionId || null,
            });
            if (!transitionId) {
              ws.send(JSON.stringify({
                type: 'mixerTransitionRejected',
                targetChannelId: d.targetChannelId,
                reason: 'no-overlays-or-missing-target',
              }));
            } else {
              // Immediate broadcast so the iPad sees the force-enabled
              // state (mute cleared, target enabled) within one frame,
              // well before the throttled progress broadcasts start
              // landing. Carries the transitionId + transitionMode so
              // the client can correlate.
              broadcastWs({
                type: 'mixerTransitionStarted',
                transitionId,
                targetChannelId: d.targetChannelId,
                durationMs,
                curve,
                transitionMode,
              });
              broadcastMixerState();
            }
          }
        } else if (d.type === 'setSolo' && d.channelId) {
          // Server-authoritative solo over WS (low-latency mirror of POST
          // /mixer/solo). Same dual-path as setChannelFader. additive=true
          // adds; false replaces. A bad / non-mixer id is pushed back as a
          // typed rejection (no res to 4xx on a socket); siblings are never
          // mutated. Always broadcast so every client reconciles its
          // display-only solo state from the canonical soloedChannelIds.
          const r = mixer.setSolo(d.channelId, !!d.additive);
          if (!r.ok) {
            ws.send(JSON.stringify({ type: 'soloRejected', channelId: d.channelId, reason: r.error }));
            return;
          }
          saveAllState();
          broadcastMixerState();
        } else if (d.type === 'clearSolo') {
          // Clear one channel's solo (d.channelId present) or ALL (absent).
          const r = mixer.clearSolo(d.channelId !== undefined ? d.channelId : null);
          if (!r.ok) {
            ws.send(JSON.stringify({ type: 'soloRejected', channelId: d.channelId, reason: r.error }));
            return;
          }
          saveAllState();
          broadcastMixerState();
        } else if (d.type === 'bump' && d.channelId) {
          // FLASH / BUMP over WS (low-latency mirror of POST
          // /mixer/channels/:id/bump {on:true}). Same dual-path as setSolo.
          // Each `bump` RENEWS the disconnect lease, so a held button that
          // re-sends every BUMP_RENEW_MS keeps the channel pinned; stop
          // re-sending (or drop off wifi) and the sweep auto-releases. We
          // ALSO track which channels THIS socket bumped so ws-close releases
          // them instantly (belt-and-braces beside the lease). A bad / non-
          // mixer id is pushed back as a typed rejection.
          const r = applyBump(d.channelId, true);
          if (!r.ok) {
            ws.send(JSON.stringify({ type: 'bumpRejected', channelId: d.channelId, reason: r.error }));
            return;
          }
          if (!ws._bumpedByThisWs) ws._bumpedByThisWs = new Set();
          ws._bumpedByThisWs.add(d.channelId);
          // Broadcast only when the set actually changed — a renew (already
          // bumped) is a no-op for every other client, so skip the fan-out
          // to keep the hold-renew cadence off the wire.
          if (r.changed) { saveAllState(); broadcastMixerState(); }
        } else if (d.type === 'unbump') {
          // Release one channel's bump (d.channelId present) or ALL (absent).
          const r = applyBump(d.channelId !== undefined ? d.channelId : null, false);
          if (!r.ok) {
            ws.send(JSON.stringify({ type: 'bumpRejected', channelId: d.channelId, reason: r.error }));
            return;
          }
          if (ws._bumpedByThisWs) {
            if (d.channelId !== undefined) ws._bumpedByThisWs.delete(d.channelId);
            else ws._bumpedByThisWs.clear();
          }
          saveAllState();
          broadcastMixerState();
        } else if (d.type === 'setSharedParam') {
          if (!paramCenter) return;
          const res = paramCenter.set(d.key, d.value, 'ws', d.origin);
          if (res.status === 'ignored') {
            ws.send(JSON.stringify({ type: 'paramRejected', key: d.key, reason: res.reason, lockedTo: res.lockedTo }));
          }
          // Success path: paramCenter.onChange (wired at boot)
          // handles persistence + throttled WS broadcast + WASM
          // dirty marking. See docs/24 §7.2.
        } else if (d.type === 'subscribeChains' || d.type === 'unsubscribeChains') {
          // docs/29 §WS contract: gate the 5 Hz signalChain preview
          // emission. Engine pays zero cost when no client is subscribed.
          // V1 is "is anyone subscribed at all?" — the engine doesn't
          // need a per-client subscriber map because the 5 Hz frame is
          // broadcast to ALL /ws/signals clients anyway.
          const spp = engineCore && engineCore.signalPostProcessor;
          if (spp && typeof spp.setEditorSubscribed === 'function') {
            spp.setEditorSubscribed(d.type === 'subscribeChains');
          }
        }
      } catch(e) {}
    });

    // FLASH / BUMP release-on-disconnect (docs/39 §10.7): when this /ws/control
    // socket closes (tab closed, app backgrounded long enough to drop the
    // socket, wifi dropout the OS noticed), release every bump THIS socket was
    // holding — instant cleanup so a channel can't stay pinned full. The lease
    // sweep is the backstop for the case where close never fires (hard link
    // loss); this is the fast path for clean disconnects.
    ws.on('close', () => {
      if (!ws._bumpedByThisWs || ws._bumpedByThisWs.size === 0) return;
      let releasedAny = false;
      for (const id of ws._bumpedByThisWs) {
        const r = applyBump(id, false);
        if (r.ok && r.changed) releasedAny = true;
      }
      ws._bumpedByThisWs.clear();
      if (releasedAny) {
        saveAllState();
        broadcastMixerState();
        console.log('[bump] /ws/control closed — released held bumps');
      }
    });
  });

  // /ws/params — sharedParams replay. CPC writes are quiet by default
  // (only operator knob turns emit), so without the replay a fresh
  // CaptainPad would have stale colour/speed values until the next
  // operator touch. The REST seed in useEngineState catches this for
  // the steady CPC doc, but the WS replay keeps the contracts symmetric
  // with the other sockets — one cached payload, replayed on connect.
  wssParams.on('connection', ws => {
    try {
      if (paramCenter) {
        ws.send(JSON.stringify({
          type: 'sharedParams',
          ...paramCenter.getCanonicalState(),
        }));
      }
    } catch (e) {
      // ignore
    }
  });

  // /ws/signals — liveParams replay so audio meters / BPM badge paint
  // warm values on cold reconnect without waiting one whole audio-hop
  // interval. Only the latest payload is replayed; the bus keeps
  // ticking from there.
  wssSignals.on('connection', ws => {
    try {
      if (lastLiveParams) ws.send(JSON.stringify(lastLiveParams));
    } catch (e) {
      // ignore
    }
  });

  // /ws/viz — no replay. Vis frames are stateless 6ch base64 buffers
  // and the next broadcast (≤100 ms away at the default 10 Hz) will
  // paint a fresh frame anyway. Keeping the cold-connect cost at zero
  // is more important than the one-frame visual delay.
  wssViz.on('connection', () => {
    // no-op — frames arrive on the next render-loop tick
  });

  server.listen(opts.port, () => {
    console.log(`\n  🌐 Output Server listening on HTTP/WS port ${opts.port}`);
    console.log(`     Reachable on:`);
    for (const url of reachableUrls(opts.port)) {
      console.log(`       ${url}`);
    }
  });

  publishStatsRef.publish = (data) => {
    // Four message shapes flow through this hook. Each is classified
    // to one topic via broadcastWs (lib/ws_topic_routing.js):
    //   - { type: 'vis', ...}     → /ws/viz       (high-volume frames)
    //   - { type: 'oscStats', ...}→ /ws/control   (1 Hz pill telemetry)
    //   - { type: 'audioStatus' } → /ws/control   (1 Hz pill telemetry)
    //   - everything else         → /ws/control   ({ type: 'stats',...})
    //
    // oscStats + audioStatus are cached for late-joining WS clients so
    // a freshly-opened CaptainPad sees the right pill state inside a
    // single render frame instead of waiting up to one second for the
    // next stats tick.
    let payload;
    if (data && data.type === 'vis') {
      payload = data;
    } else if (data && data.type === 'oscStats') {
      payload = data;
      lastOscStats = data;
    } else if (data && data.type === 'audioStatus') {
      payload = data;
      lastAudioStatus = data;
    } else if (data && data.type === 'audioConfig') {
      // Audio TUNING config rebroadcast (PATCH /audio/config + reset).
      // Cached so a late-joining /ws/control client (CaptainPad OR the
      // Audio Companion) gets the current tuning replayed on connect.
      payload = data;
      lastAudioConfig = data;
    } else {
      payload = { type: 'stats', ...data };
    }
    broadcastWs(payload);
  };

  // Boot-time: if the persisted deck state has a playlist+activeEntryId,
  // hand its modulations to the controller now so the very first render
  // tick already has them. Subsequent swaps refresh via the existing
  // pushActiveEntryToModulation() calls in loadPlaylistEntry +
  // deckSwapComplete.
  pushActiveEntryToModulation();

  // Exposed for the engine's model hot-reload path: after the model and
  // mixer view-mask state are refreshed, push the new mixer/deck state
  // to connected clients so an already-open CaptainPad re-syncs its
  // channel strips without a manual reload. (The views PICKER list is
  // fetched from /model/view-selection-options at mount, which reads
  // the live model object and is therefore fresh on the next reload.)
  server.broadcastMixerState = broadcastMixerState;

  // AUTO-CYCLE (round-2 #2): the per-frame auto-cycle tick. engine.js composes
  // this into the render loop's beforeFrame hook so overlay playlists advance
  // on their timer. One source of time (wall clock), no per-channel timers.
  server.autoCycleTick = autoCycleTick;

  // SHARED deck-overlay auto-cycle tick (deck dynamic view overrides). engine.js
  // composes this into the SAME beforeFrame hook as autoCycleTick so deck
  // overlays auto-advance in UNISON on one shared clock (operator refinement #1).
  server.deckOverlayAutoCycleTick = deckOverlayAutoCycleTick;

  // Forceful close for the scene-switch restart path: terminate every live
  // WS client (they hold the connection open, which would otherwise delay
  // server.close() and the port release) and stop accepting connections so a
  // replacement engine can re-bind :6968 immediately.
  server.closeNow = () => {
    try {
      for (const wssInst of Object.values(wssByTopic)) {
        for (const client of wssInst.clients) {
          try { client.terminate(); } catch (_) { /* ignore */ }
        }
      }
    } catch (_) { /* ignore */ }
    try { server.close(); } catch (_) { /* ignore */ }
  };

  return server;
}
