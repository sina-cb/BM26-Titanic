/*
 * timeline_dryrun.mjs — OFFLINE clock-simulation harness for the SHOW timeline.
 *
 * The problem it solves (report `_91` §6.2, build item 0.1): you could unit-test
 * the timeline mechanism, or you could wait real hours with the engine running
 * an in-window fixture plan. Nothing in between. This tool fast-forwards a whole
 * playa night in seconds and PRINTS it.
 *
 * WHAT IT DRIVES — the REAL code, never a reimplementation:
 *   • the plan is loaded by `lib/timeline/show_plan.js` `loadShowPlan`
 *   • the run is `lib/timeline/timeline_service.js` `TimelineService._tick()`
 *     with an injected `nowFn` fast clock and an injected `getMood()`
 *   • which means the REAL `triggers.js` evaluator, the REAL `arbiter.js`
 *     precedence model, the REAL festival/sun math, the REAL party session
 *     bookkeeping and the REAL default-cue reconcile
 *   • the deck side resolves playlists through the REAL `PlaylistManager` and
 *     advances the pattern through the REAL `pickNextAutoCycleEntry`, so
 *     "which playlist and pattern is actually on the deck" is honest, including
 *     `_missing` entries the autopilot skips.
 *
 * WHAT IT NEVER DOES: no sACN, no DMX, no HTTP, no WebSocket, no device traffic,
 * no running engine. Every engine `deps` callback is a recording fake. The ONLY
 * writes are a throwaway plan copy + runtime state under `~/tmp/timeline_dryrun/`
 * (and `--out`, which must also live under `~/tmp`). The operator's scene files
 * are opened READ-ONLY and copied — the service never sees their directory, so
 * it can never write its built-in default plan over them.
 *
 * USAGE (run from marsin_engine/):
 *   node tools/timeline_dryrun.mjs --fixture --date 2026-09-01
 *   node tools/timeline_dryrun.mjs --date 2026-09-01                    # real titanic plan, in-window day
 *   node tools/timeline_dryrun.mjs --date 2026-09-05 --mood loud_stereo_1500
 *   node tools/timeline_dryrun.mjs --fixture --days 2 --step 5 --events-only
 *   node tools/timeline_dryrun.mjs --scene titanic --plan playa_default --date 2026-09-05 --days 2
 *   node tools/timeline_dryrun.mjs --list-moods
 *   node tools/timeline_dryrun.mjs --help
 *
 * Codex P0 — NO FALLBACKS: an unknown flag, an unknown mood script, a plan that
 * is DORMANT on the requested date, a missing plan file, a playlist whose entries
 * are all broken — every one of them fails loudly instead of quietly producing a
 * misleading transcript.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import yaml from 'js-yaml';

import { pickNextAutoCycleEntry } from '../lib/autopilot_pick.js';
import { PlaylistManager } from '../lib/playlist_manager.js';
import { resolvePlaylistsDir } from '../lib/state_paths.js';
import { festivalDateFor, festivalDayIndex } from '../lib/timeline/festival.js';
import { loadShowPlan } from '../lib/timeline/show_plan.js';
import { computeSunEvents, formatLocal } from '../lib/timeline/sun.js';
import { TimelineService } from '../lib/timeline/timeline_service.js';
import { dateClockToEpochMs, dayKeyFor } from '../lib/timeline/triggers.js';
import { parseAssertSpec, runAssertions, renderAssertionReport } from './timeline_assertions.mjs';

const ENGINE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO_DIR = path.resolve(ENGINE_DIR, '..');
const FIXTURE_PLAN = path.join(ENGINE_DIR, 'tests', 'fixtures', 'timeline', 'dryrun_bench.yaml');
const TMP_ROOT = path.join(os.homedir(), 'tmp', 'timeline_dryrun');

const MS_PER_MIN = 60000;
const MS_PER_DAY = 86400000;

// Sun events printed in each simulated day's header.
const DAY_HEADER_SUN = ['sunrise', 'goldenHourEnd', 'solarNoon', 'goldenHourStart', 'sunset', 'civilDusk'];

/**
 * Built-in mood tracks. Each is a list of PARTY windows in playa-local wall
 * clock; outside every window the mood is CALM. `days` (optional) restricts a
 * window to those 0-based SIMULATED day indices.
 *
 * These are deliberately blunt: the point is to answer "what does the show do
 * when the music does X", not to model a detector.
 */
export const MOOD_SCRIPTS = Object.freeze({
  quiet: {
    label: 'quiet night — the detector never calls party',
    windows: [],
  },
  loud_stereo_1500: {
    label: 'a loud stereo parked next to the boat at 15:00 for 40 minutes',
    windows: [{ from: '15:00', to: '15:40' }],
  },
  night_sets: {
    label: 'two real DJ sets after dark (22:10–22:55 and 01:30–02:20)',
    windows: [{ from: '22:10', to: '22:55' }, { from: '01:30', to: '02:20' }],
  },
  all_night: {
    label: 'continuous music from 21:00 to 05:00 (repeat-session stress)',
    windows: [{ from: '21:00', to: '05:00' }],
  },
});

// ── pure helpers (exported for tests/timeline/timeline_dryrun.test.js) ────────

const DAY_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function dayKeyUtc(dayKey) {
  const m = DAY_KEY_RE.exec(dayKey);
  if (!m) throw new Error(`expected a YYYY-MM-DD day key, got ${JSON.stringify(dayKey)}`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** Shift a 'YYYY-MM-DD' key by whole calendar days. tz-independent. */
export function shiftDayKey(dayKey, deltaDays) {
  const dt = new Date(dayKeyUtc(dayKey) + deltaDays * MS_PER_DAY);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

/** Whole calendar days from `aKey` to `bKey` (b − a). tz-independent. */
export function dayKeyDelta(aKey, bKey) {
  return Math.round((dayKeyUtc(bKey) - dayKeyUtc(aKey)) / MS_PER_DAY);
}

// Flag spec: name → 'string' | 'number' | 'bool'. Anything not listed is a typo
// and throws (codex P0 — a silently-ignored flag makes a dry run lie).
const FLAG_SPEC = Object.freeze({
  scene: 'string',
  plan: 'string',
  fixture: 'bool',
  date: 'string',
  days: 'number',
  from: 'string',
  to: 'string',
  step: 'number',
  mood: 'string',
  'mood-file': 'string',
  seed: 'number',
  'party-config': 'string',
  'allow-dormant': 'bool',
  'events-only': 'bool',
  'engine-log': 'bool',
  out: 'string',
  'list-moods': 'bool',
  help: 'bool',
  assert: 'bool',
  'assert-spec': 'string',
});

const CLOCK_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parse argv (the slice AFTER `node tools/timeline_dryrun.mjs`) into options.
 * Throws on an unknown flag, a missing value, or an out-of-range number.
 *
 * @param {string[]} argv
 * @returns {object} options
 */
export function parseArgv(argv) {
  const raw = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      throw new Error(`unexpected positional argument "${token}" (every input is a --flag)`);
    }
    const key = token.slice(2);
    const kind = FLAG_SPEC[key];
    if (kind === undefined) {
      throw new Error(`unknown flag "--${key}" (known: ${Object.keys(FLAG_SPEC).map((k) => `--${k}`).join(' ')})`);
    }
    if (kind === 'bool') { raw[key] = true; continue; }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`flag "--${key}" requires a value`);
    }
    raw[key] = value;
    i += 1;
  }

  const opts = {
    scene: raw.scene !== undefined ? String(raw.scene) : 'titanic',
    plan: raw.plan !== undefined ? String(raw.plan) : 'playa_default',
    fixture: raw.fixture === true,
    date: raw.date !== undefined ? String(raw.date) : null,
    days: raw.days !== undefined ? Number(raw.days) : 1,
    from: raw.from !== undefined ? String(raw.from) : '12:00',
    to: raw.to !== undefined ? String(raw.to) : null,
    stepMin: raw.step !== undefined ? Number(raw.step) : 1,
    mood: raw.mood !== undefined ? String(raw.mood) : 'quiet',
    moodFile: raw['mood-file'] !== undefined ? String(raw['mood-file']) : null,
    seed: raw.seed !== undefined ? Number(raw.seed) : 1,
    partyConfig: raw['party-config'] !== undefined ? JSON.parse(String(raw['party-config'])) : null,
    allowDormant: raw['allow-dormant'] === true,
    eventsOnly: raw['events-only'] === true,
    engineLog: raw['engine-log'] === true,
    out: raw.out !== undefined ? String(raw.out) : null,
    listMoods: raw['list-moods'] === true,
    help: raw.help === true,
    assert: raw.assert === true,
    assertSpec: raw['assert-spec'] !== undefined ? String(raw['assert-spec']) : null,
  };

  if (opts.date !== null && !DATE_RE.test(opts.date)) {
    throw new Error(`--date must be YYYY-MM-DD, got ${JSON.stringify(opts.date)}`);
  }
  if (!Number.isInteger(opts.days) || opts.days < 1 || opts.days > 31) {
    throw new Error(`--days must be an integer 1..31, got ${JSON.stringify(raw.days)}`);
  }
  if (!CLOCK_RE.test(opts.from)) throw new Error(`--from must be HH:MM, got ${JSON.stringify(opts.from)}`);
  if (opts.to !== null && !CLOCK_RE.test(opts.to)) {
    throw new Error(`--to must be HH:MM, got ${JSON.stringify(opts.to)}`);
  }
  if (!Number.isInteger(opts.stepMin) || opts.stepMin < 1 || opts.stepMin > 60) {
    throw new Error(`--step must be an integer 1..60 minutes, got ${JSON.stringify(raw.step)}`);
  }
  if (!Number.isInteger(opts.seed) || opts.seed < 0) {
    throw new Error(`--seed must be a non-negative integer, got ${JSON.stringify(raw.seed)}`);
  }
  if (opts.moodFile === null && MOOD_SCRIPTS[opts.mood] === undefined) {
    throw new Error(
      `unknown mood script "${opts.mood}" (have: ${Object.keys(MOOD_SCRIPTS).join(', ')}) — or pass --mood-file <path>`,
    );
  }
  if (opts.moodFile !== null && raw.mood !== undefined) {
    throw new Error('--mood and --mood-file are mutually exclusive');
  }
  if (opts.fixture && raw.plan !== undefined) {
    throw new Error('--fixture and --plan are mutually exclusive');
  }
  if (opts.assertSpec !== null && !opts.assert) {
    throw new Error('--assert-spec requires --assert');
  }
  return opts;
}

/**
 * Resolve the simulated span. `--from` on `--date` starts it; the span runs
 * `days × 24 h` unless `--to` clips it to a wall clock on the LAST day.
 *
 * @param {{dateKey:string, days:number, tz:string, fromClock:string, toClock:string|null}} args
 * @returns {{startMs:number, endMs:number, dayKeys:string[]}}
 */
export function resolveSpan({ dateKey, days, tz, fromClock, toClock }) {
  const startMs = dateClockToEpochMs(dateKey, fromClock, tz);
  const dayKeys = [];
  for (let i = 0; i < days; i += 1) dayKeys.push(shiftDayKey(dateKey, i));
  let endMs;
  if (toClock === null || toClock === undefined) {
    // A day-anchored end (not startMs + N×24 h) so a DST shift inside the span
    // cannot drift the finish clock away from `fromClock`.
    endMs = dateClockToEpochMs(shiftDayKey(dateKey, days), fromClock, tz);
  } else {
    endMs = dateClockToEpochMs(dayKeys[dayKeys.length - 1], toClock, tz);
  }
  if (endMs <= startMs) {
    throw new Error(`empty span: ${dateKey} ${fromClock} → ${toClock || fromClock} (+${days}d) ends at or before it starts`);
  }
  return { startMs, endMs, dayKeys };
}

/**
 * The instants the harness ticks the service at: [startMs, endMs) every
 * `stepMs`. Returned as an array (a night at 1-minute steps is ~1440 entries).
 */
export function stepInstants({ startMs, endMs, stepMs }) {
  if (!Number.isFinite(stepMs) || stepMs <= 0) throw new Error(`stepInstants: stepMs must be > 0, got ${stepMs}`);
  const out = [];
  for (let t = startMs; t < endMs; t += stepMs) out.push(t);
  return out;
}

/**
 * Validate a mood-script document (built-in or file) into a window list.
 * Shape: `{ label?, windows: [{ from:'HH:MM', to:'HH:MM', days?:number[] }] }`.
 * A window whose `to` is at or before its `from` WRAPS past midnight.
 */
export function parseMoodDoc(doc, source) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    throw new Error(`mood script (${source}): must be a mapping with a "windows" list`);
  }
  if (!Array.isArray(doc.windows)) {
    throw new Error(`mood script (${source}): "windows" must be an array`);
  }
  const windows = doc.windows.map((w, i) => {
    if (!w || typeof w !== 'object') throw new Error(`mood script (${source}): window ${i} must be a mapping`);
    if (!CLOCK_RE.test(w.from)) throw new Error(`mood script (${source}): window ${i} "from" must be HH:MM, got ${JSON.stringify(w.from)}`);
    if (!CLOCK_RE.test(w.to)) throw new Error(`mood script (${source}): window ${i} "to" must be HH:MM, got ${JSON.stringify(w.to)}`);
    let days = null;
    if (w.days !== undefined && w.days !== null) {
      if (!Array.isArray(w.days) || w.days.some((d) => !Number.isInteger(d) || d < 0)) {
        throw new Error(`mood script (${source}): window ${i} "days" must be an array of non-negative integers`);
      }
      days = [...w.days];
    }
    return { from: w.from, to: w.to, days };
  });
  return { label: typeof doc.label === 'string' ? doc.label : source, windows };
}

/** Read + validate a mood script from a YAML or JSON file. */
export function loadMoodFile(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  return parseMoodDoc(yaml.load(text), filePath);
}

/**
 * Compile a window list into `partyAt(nowMs) → 0|1`. Windows are resolved on the
 * plan's timezone calendar day, and a window is also checked against the PREVIOUS
 * day's anchor so a midnight-wrapping window covers the small hours correctly.
 *
 * @param {{windows:Array, tz:string, startDayKey:string}} args
 * @returns {(nowMs:number) => 0|1}
 */
export function compileMoodTrack({ windows, tz, startDayKey }) {
  const covers = (win, anchorKey, nowMs) => {
    if (win.days !== null && !win.days.includes(dayKeyDelta(startDayKey, anchorKey))) return false;
    const startMs = dateClockToEpochMs(anchorKey, win.from, tz);
    const endKey = win.to <= win.from ? shiftDayKey(anchorKey, 1) : anchorKey;
    const endMs = dateClockToEpochMs(endKey, win.to, tz);
    return nowMs >= startMs && nowMs < endMs;
  };
  return (nowMs) => {
    const todayKey = dayKeyFor(nowMs, tz);
    const yesterdayKey = shiftDayKey(todayKey, -1);
    for (const win of windows) {
      if (covers(win, todayKey, nowMs) || covers(win, yesterdayKey, nowMs)) return 1;
    }
    return 0;
  };
}

/** Deterministic PRNG (mulberry32) so `--seed` makes a shuffled run reproducible. */
export function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── summary accumulation ─────────────────────────────────────────────────────

/** A fresh summary accumulator. All minute totals are step-weighted. */
export function newSummary() {
  return {
    totalMin: 0,
    dormantMin: 0,
    playlistMin: {},        // playlist name → minutes on the deck
    ownerMin: {},           // deck-owner label → minutes
    controllerMin: {},      // 'autopilot' | 'program' | 'manual' → minutes
    paletteMin: {},         // palette id (or 'unset') → minutes
    partyStateMin: {},      // effectiveState → minutes
    fires: {},              // cueId → fire count
    suppressed: {},         // cueId → suppression count
    suppressionReasons: {}, // reason text → count
    partySessionsStarted: 0,
    partySessionEnds: {},   // end reason → count
    playlistHealth: {},     // playlist name → { entries, missing, usable, loads }
    cueErrors: {},          // cueId → last error
  };
}

/**
 * Fold ONE simulated step into the summary. `sample` is the post-tick snapshot;
 * `stepMin` is that step's length in minutes.
 */
export function accumulate(summary, sample, stepMin) {
  const bump = (bucket, key) => {
    if (key === null || key === undefined) return;
    bucket[key] = (bucket[key] || 0) + stepMin;
  };
  summary.totalMin += stepMin;
  if (sample.dormant) {
    summary.dormantMin += stepMin;
    return summary;
  }
  bump(summary.playlistMin, sample.playlist || '(none)');
  bump(summary.ownerMin, sample.owner);
  bump(summary.controllerMin, sample.controller);
  bump(summary.paletteMin, sample.palette || 'unset');
  bump(summary.partyStateMin, sample.partyState);
  return summary;
}

function countIn(bucket, key) {
  if (key === null || key === undefined) return;
  bucket[key] = (bucket[key] || 0) + 1;
}

function fmtMin(mins) {
  const total = Math.round(mins);
  return `${String(Math.floor(total / 60)).padStart(2, ' ')}h${String(total % 60).padStart(2, '0')}m`;
}

function sortedByValueDesc(bucket) {
  return Object.entries(bucket).sort((a, b) => b[1] - a[1]);
}

/** Render the end-of-run summary as an array of lines. */
export function renderSummary(summary) {
  const lines = [];
  const rule = '─'.repeat(78);
  lines.push('', rule, 'SUMMARY', rule);
  lines.push(`simulated span: ${fmtMin(summary.totalMin)}${summary.dormantMin > 0 ? `  (${fmtMin(summary.dormantMin)} DORMANT — out of the festival window)` : ''}`);

  lines.push('', 'DECK TIME BY PLAYLIST');
  for (const [name, mins] of sortedByValueDesc(summary.playlistMin)) {
    const pct = summary.totalMin > 0 ? Math.round((mins / summary.totalMin) * 100) : 0;
    lines.push(`  ${fmtMin(mins)}  ${String(pct).padStart(3)}%   ${name}`);
  }

  lines.push('', 'DECK TIME BY OWNER (which cue/look holds the deck)');
  for (const [name, mins] of sortedByValueDesc(summary.ownerMin)) {
    const pct = summary.totalMin > 0 ? Math.round((mins / summary.totalMin) * 100) : 0;
    lines.push(`  ${fmtMin(mins)}  ${String(pct).padStart(3)}%   ${name}`);
  }

  lines.push('', 'DECK TIME BY CONTROLLER / PALETTE');
  for (const [name, mins] of sortedByValueDesc(summary.controllerMin)) lines.push(`  ${fmtMin(mins)}   controller ${name}`);
  for (const [name, mins] of sortedByValueDesc(summary.paletteMin)) lines.push(`  ${fmtMin(mins)}   palette    ${name}`);

  lines.push('', 'CUE FIRES');
  const fireRows = sortedByValueDesc(summary.fires);
  if (fireRows.length === 0) lines.push('  (none)');
  for (const [cueId, n] of fireRows) lines.push(`  ${String(n).padStart(3)} ×  ${cueId}`);

  lines.push('', 'SUPPRESSED (wouldFire — the trigger wanted to, the arbiter said no)');
  const supRows = sortedByValueDesc(summary.suppressed);
  if (supRows.length === 0) lines.push('  (none)');
  for (const [cueId, n] of supRows) lines.push(`  ${String(n).padStart(3)} ×  ${cueId}`);
  for (const [reason, n] of sortedByValueDesc(summary.suppressionReasons)) {
    lines.push(`        ${String(n).padStart(3)} ×  ${reason}`);
  }

  lines.push('', 'PARTY SESSIONS');
  lines.push(`  started: ${summary.partySessionsStarted}`);
  const endRows = sortedByValueDesc(summary.partySessionEnds);
  if (endRows.length === 0) lines.push('  ended:   (none)');
  for (const [reason, n] of endRows) lines.push(`  ended:   ${String(n).padStart(3)} ×  ${reason}`);
  for (const [state, mins] of sortedByValueDesc(summary.partyStateMin)) {
    lines.push(`  ${fmtMin(mins)}   party state ${state}`);
  }

  lines.push('', 'PLAYLIST HEALTH (as the engine actually resolved it)');
  const healthRows = Object.entries(summary.playlistHealth).sort((a, b) => a[0].localeCompare(b[0]));
  if (healthRows.length === 0) lines.push('  (no playlist was loaded)');
  for (const [name, h] of healthRows) {
    const flag = h.missing > 0 ? `  ⚠ ${h.missing} UNREACHABLE` : '';
    lines.push(`  ${name.padEnd(18)} ${String(h.usable).padStart(3)}/${String(h.entries).padEnd(3)} usable   loaded ${h.loads}×${flag}`);
  }

  const errRows = Object.entries(summary.cueErrors);
  if (errRows.length > 0) {
    lines.push('', 'CUE ERRORS');
    for (const [cueId, msg] of errRows) lines.push(`  ${cueId}: ${msg}`);
  }
  lines.push(rule);
  return lines;
}

// ── the simulated deck (recording fakes over the REAL playlist resolution) ────

/**
 * Build the `deps` object the TimelineService drives, plus the deck mirror the
 * narrative reads. Every callback records; the playlist ones resolve through the
 * REAL PlaylistManager and enforce the SAME fail-loud contract as the engine's
 * `timelineLoadPlaylistOnDeck` (api_server.js) — an all-`_missing` playlist
 * throws, so a broken playlist surfaces in the dry run exactly as it would live.
 */
export function makeDryRunDeps({ playlistManager, colorPalettes, summary, nowRef }) {
  const deck = {
    playlist: null,
    entries: null,
    entryId: null,
    pattern: null,
    autopilot: { active: false, delay_s: 30, shuffle: false },
    lastAdvanceMs: null,
    master: null,
    palette: null,
    advances: 0,
  };
  const view = { mode: null, source: null };
  const mixerLoads = [];

  const notePlaylistHealth = (pl) => {
    const missing = pl.entries.filter((e) => e._missing).length;
    const prior = summary.playlistHealth[pl.name];
    summary.playlistHealth[pl.name] = {
      entries: pl.entries.length,
      missing,
      usable: pl.entries.length - missing,
      loads: (prior ? prior.loads : 0) + 1,
    };
  };

  const resolve = (name) => {
    const pl = playlistManager.load(name);
    if (!pl) throw new Error(`playlist not found: ${name}`);
    notePlaylistHealth(pl);
    return pl;
  };

  const deps = {
    loadPlaylist: ({ target, name }) => {
      const pl = resolve(name);
      if (target.kind !== 'deck') { mixerLoads.push({ id: target.id, name }); return; }
      const firstEntry = pl.entries.find((e) => !e._missing);
      if (!firstEntry) {
        if (pl.entries.length > 0) throw new Error(`playlist "${name}" has no loadable entries`);
        deck.playlist = pl.name; deck.entryId = null; deck.pattern = null;
        deck.lastAdvanceMs = nowRef.now; deck.entries = pl.entries;
        return;
      }
      deck.playlist = pl.name;
      deck.entryId = firstEntry.id;
      deck.pattern = firstEntry.pattern;
      deck.entries = pl.entries;
      deck.lastAdvanceMs = nowRef.now;
    },
    setAutopilot: ({ target, state }) => {
      if (target.kind !== 'deck') return;
      if (state.active !== undefined) deck.autopilot.active = !!state.active;
      if (state.delay_s !== undefined) deck.autopilot.delay_s = parseInt(state.delay_s, 10) || 30;
      if (state.shuffle !== undefined) deck.autopilot.shuffle = !!state.shuffle;
      deck.lastAdvanceMs = nowRef.now;
    },
    setParams: (obj) => {
      if (obj && obj.colorPalette1 && obj.colorPalette2) {
        const hit = colorPalettes.find(
          (p) => p && p.c1 === obj.colorPalette1.h && p.c2 === obj.colorPalette2.h,
        );
        deck.palette = hit ? hit.id : `hsv(${obj.colorPalette1.h},${obj.colorPalette2.h})`;
      }
    },
    setMaster: (value) => { deck.master = value; },
    requestScene: (name) => { throw new Error(`dry run refuses a scene switch to "${name}" (offline harness)`); },
    patchScheduledTask: () => {},
    fireScheduledTask: () => {},
    listMixerChannelIds: () => [],
    listPlaylists: () => playlistManager.list(),
    setDeckTransition: () => {},
    setDeckOverlaysEnabled: () => {},
    setColorAutopilot: () => {},
    setDeckHue: () => {},
    forceDeckView: () => { view.mode = 'deck'; view.source = 'plan'; },
    releaseDeckView: () => {
      if (view.source === 'plan') { view.mode = null; view.source = null; }
    },
    getViewOverrideMode: () => view.mode,
  };

  /**
   * Advance the deck's pattern autopilot up to `nowMs`, using the REAL picker.
   * Mirrors the engine's deck daemon: one advance per `delay_s`, `_missing`
   * entries are never picked. Bounded so a long step can't spin.
   */
  const advanceAutopilot = (nowMs) => {
    if (!deck.autopilot.active || !deck.entries || deck.lastAdvanceMs === null) return;
    const delayMs = Math.max(1, deck.autopilot.delay_s) * 1000;
    let guard = 0;
    while (nowMs - deck.lastAdvanceMs >= delayMs && guard < 10000) {
      const next = pickNextAutoCycleEntry(
        { entries: deck.entries }, deck.autopilot, deck.entryId, null,
      );
      deck.lastAdvanceMs += delayMs;
      guard += 1;
      if (!next) break;
      deck.entryId = next.id;
      deck.pattern = next.pattern;
      deck.advances += 1;
    }
  };

  return { deps, deck, view, mixerLoads, advanceAutopilot };
}

// ── event-ring draining ──────────────────────────────────────────────────────

/**
 * Entries appended to a capped ring since `lastSeen`. Identity-anchored (not
 * length-anchored) so the ring shifting past its cap never silently drops or
 * replays events.
 */
export function drainRing(ring, lastSeen) {
  const idx = lastSeen === null ? -1 : ring.lastIndexOf(lastSeen);
  const fresh = lastSeen === null ? ring.slice() : (idx === -1 ? ring.slice() : ring.slice(idx + 1));
  return { fresh, last: ring.length > 0 ? ring[ring.length - 1] : lastSeen };
}

/**
 * Human "why was this fire dropped" for a wouldFire entry. The service records
 * the controller at suppression time; the arbiter's rules map onto it 1:1.
 */
export function suppressionReason(entry, { cueKind, activeProgramCueId, moodAllowed }) {
  if (cueKind === 'mood' && moodAllowed === false) {
    return 'mood cues are disabled at plan level (autopilot.mood: false)';
  }
  if (entry.controller === 'manual') {
    return 'the operator owns control (takeover, or autopilot off with no program)';
  }
  if (entry.controller === 'program') {
    // `_98` fix 3 made AMBIENT cues obey the same gate as mood cues, so name the
    // kind rather than always saying "mood".
    return `a program owns the deck${activeProgramCueId ? ` (${activeProgramCueId})` : ''} — ${cueKind === 'ambient' ? 'ambient' : 'mood'} swaps are suppressed for its hold`;
  }
  return `controller "${entry.controller}" did not accept a ${cueKind || 'cue'} fire`;
}

// ── the run ──────────────────────────────────────────────────────────────────

function planPathFor(opts) {
  if (opts.fixture) return FIXTURE_PLAN;
  // An explicit path wins over the scene-relative name, so `--plan ./x.yaml`
  // works without pretending it lives in the scene library.
  if (opts.plan.includes('/') || opts.plan.includes('\\') || opts.plan.endsWith('.yaml')) {
    return path.resolve(opts.plan.startsWith('~') ? path.join(os.homedir(), opts.plan.slice(1)) : opts.plan);
  }
  return path.join(REPO_DIR, 'simulation', 'scenes', opts.scene, 'timeline', `${opts.plan}.yaml`);
}

function deckOwnerLabel(svc) {
  if (svc._deckWindowCueId !== null) return `cue ${svc._deckWindowCueId}`;
  if (svc._defaultCueActive) {
    const dc = svc.plan && svc.plan.defaultCue;
    return `defaultCue (${(dc && dc.label) || 'default'})`;
  }
  return 'autopilot baseline';
}

function actionSummary(plan, action) {
  if (!action) return '(no action)';
  if (action.type === 'look') {
    const look = plan.looks ? plan.looks[action.look] : null;
    const pl = look && look.playlist ? ` playlist=${look.playlist}` : '';
    const pal = look && look.palette ? ` palette=${look.palette}` : '';
    return `look ${action.look}${pl}${pal}`;
  }
  if (action.type === 'playlist') return `playlist ${action.name}`;
  if (action.type === 'scene') return `scene ${action.scene}`;
  return action.type;
}

function cueDetail(plan, cueId) {
  const cue = plan.cues.find((c) => c.id === cueId);
  if (!cue) return '';
  const bits = [`kind=${cue.kind}`];
  if (cue.hold && cue.hold.min !== undefined) bits.push(`hold=${cue.hold.min}m`);
  else if (cue.hold && cue.hold.until !== undefined) bits.push('hold=until-anchor');
  else if (cue.kind === 'program') bits.push('hold=until-next-program');
  if (typeof cue.durationMin === 'number' && cue.durationMin > 0) bits.push(`window=${cue.durationMin}m`);
  else if (cue.kind !== 'program') bits.push('window=NONE (owns the deck until the next deck cue)');
  return bits.join(' ');
}

/**
 * Run the whole simulation. Returns `{ lines, summary, meta }`. Writes nothing
 * except the throwaway plan copy + runtime state under `~/tmp/timeline_dryrun/`.
 */
export async function runDryRun(opts, emit) {
  const planPath = planPathFor(opts);
  if (!fs.existsSync(planPath)) {
    throw new Error(`plan file not found: ${planPath}`);
  }
  // The REAL loader, on the REAL file — validation, normalization and all.
  const plan = loadShowPlan(planPath);
  const tz = plan.location.tz;

  const engineConfig = yaml.load(fs.readFileSync(path.join(ENGINE_DIR, 'config.yaml'), 'utf8')) || {};
  const colorPalettes = Array.isArray(engineConfig.colorPalettes) ? engineConfig.colorPalettes : [];
  const timelineCfg = engineConfig.timeline || {};

  const dateKey = opts.date !== null ? opts.date : dayKeyFor(Date.now(), tz);
  const span = resolveSpan({ dateKey, days: opts.days, tz, fromClock: opts.from, toClock: opts.to });

  // ── festival-window pre-flight (LOUD, no silent dormant run) ───────────────
  const dormantDays = [];
  if (plan.festival) {
    for (const key of span.dayKeys) {
      const noonMs = dateClockToEpochMs(key, '12:00', tz);
      if (festivalDayIndex(plan, noonMs) === null) dormantDays.push(key);
    }
  }
  if (dormantDays.length > 0 && !opts.allowDormant) {
    const first = festivalDateFor(plan.festival, 0);
    const last = festivalDateFor(plan.festival, plan.festival.days - 1);
    throw new Error(
      `plan "${plan.name}" is DORMANT on ${dormantDays.join(', ')} — its festival window is `
      + `${first} … ${last} (${plan.festival.days} days, tz ${tz}).\n`
      + '  The timeline fires NOTHING outside that window (timeline_service._goDormant), so a run\n'
      + '  there would print an honest but useless flat line. Pick an in-window --date, use\n'
      + '  --fixture (the committed bench plan has no festival block and is always in-window),\n'
      + '  or pass --allow-dormant to watch the dormant behaviour on purpose.',
    );
  }

  // ── an isolated scene/state dir: the operator's scene files are NEVER written ─
  const runId = `${plan.name}_${dateKey}_${Date.now()}`;
  const runDir = path.join(TMP_ROOT, runId);
  const sceneDir = path.join(runDir, 'scene_timeline');
  const stateDir = path.join(runDir, 'state');
  fs.mkdirSync(sceneDir, { recursive: true });
  fs.mkdirSync(stateDir, { recursive: true });
  fs.copyFileSync(planPath, path.join(sceneDir, `${plan.name}.yaml`));

  const playlistsDir = resolvePlaylistsDir(ENGINE_DIR, opts.scene);
  const patternsDir = path.join(ENGINE_DIR, 'patterns');
  const playlistManager = new PlaylistManager(playlistsDir, patternsDir);

  const moodDoc = opts.moodFile !== null
    ? loadMoodFile(opts.moodFile)
    : parseMoodDoc(MOOD_SCRIPTS[opts.mood], opts.mood);
  const moodAt = compileMoodTrack({ windows: moodDoc.windows, tz, startDayKey: dateKey });

  const summary = newSummary();
  const nowRef = { now: span.startMs };
  const rng = makeRng(opts.seed);
  const { deps, deck, advanceAutopilot } = makeDryRunDeps({
    playlistManager, colorPalettes, summary, nowRef,
  });

  // Deterministic shuffle: the picker reaches for Math.random directly, so the
  // seeded stream is installed for the run and restored in the finally below.
  const origRandom = Math.random;
  const origLog = console.log;
  const origWarn = console.warn;
  const origError = console.error;
  const engineLines = [];

  const svc = new TimelineService({
    scene: opts.scene,
    sceneDir,
    stateDir,
    getMood: () => {
      const party = moodAt(nowRef.now);
      return { party, value: party };
    },
    deps,
    broadcast: () => {},
    config: {
      enabled: true,
      activePlan: plan.name,
      // A tick interval far longer than the run: the harness calls _tick() by
      // hand, and the (unref'd) interval must never fire on its own.
      tickMs: 7 * MS_PER_DAY,
      programLeaseSec: typeof timelineCfg.programLeaseSec === 'number' ? timelineCfg.programLeaseSec : 30,
      operatorLeaseSec: typeof timelineCfg.operatorLeaseSec === 'number' ? timelineCfg.operatorLeaseSec : 120,
      colorPalettes,
    },
    nowFn: () => nowRef.now,
  });

  const lines = [];
  const out = (text) => { lines.push(text); if (emit) emit(text); };

  const flushEngineLines = (prefix) => {
    for (const entry of engineLines) {
      if (entry.level === 'log' && !opts.engineLog) continue;
      out(`${prefix}    ${entry.level === 'log' ? '·' : '!!'} engine: ${entry.text.trim()}`);
    }
    engineLines.length = 0;
  };

  const moodAllowed = !plan.autopilot || plan.autopilot.mood !== false;
  const stepMs = opts.stepMin * MS_PER_MIN;
  const instants = stepInstants({ startMs: span.startMs, endMs: span.endMs, stepMs });

  let lastFire = null;
  let lastWould = null;
  let lastPartyState = null;
  let printedDayKey = null;

  const dayHeader = (key) => {
    const noonMs = dateClockToEpochMs(key, '12:00', tz);
    const sun = computeSunEvents({ lat: plan.location.lat, lon: plan.location.lon, date: new Date(noonMs), tz });
    const bits = DAY_HEADER_SUN.map((n) => `${n} ${sun[n] instanceof Date ? formatLocal(sun[n], tz) : '—'}`);
    const fest = plan.festival ? festivalDayIndex(plan, noonMs) : null;
    const festTag = plan.festival
      ? (fest === null ? '  [OUT OF FESTIVAL WINDOW — dormant]' : `  [festival day ${fest}]`)
      : '  [no festival block — always in-window]';
    out('');
    out(`══ ${key} (${new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long' }).format(new Date(noonMs))})${festTag}`);
    out(`   ${bits.join(' · ')}`);
  };

  try {
    Math.random = rng;
    console.log = (...a) => engineLines.push({ level: 'log', text: a.join(' ') });
    console.warn = (...a) => engineLines.push({ level: 'warn', text: a.join(' ') });
    console.error = (...a) => engineLines.push({ level: 'error', text: a.join(' ') });

    await svc.start();
    if (svc._tickHandle && typeof svc._tickHandle.unref === 'function') svc._tickHandle.unref();
    if (opts.partyConfig !== null) await svc.setPartyConfig(opts.partyConfig);

    // start() ran catchUp at the span's FIRST instant, which is also the first
    // tick's instant — so its boot/catchUp events belong to step 1 and the
    // rings are deliberately left undrained here.
    for (const nowMs of instants) {
      nowRef.now = nowMs;
      await svc._tick();
      advanceAutopilot(nowMs);

      const dayKey = dayKeyFor(nowMs, tz);
      if (dayKey !== printedDayKey) { dayHeader(dayKey); printedDayKey = dayKey; }

      const events = [];
      const fireDrain = drainRing(svc.recentFires, lastFire);
      lastFire = fireDrain.last;
      for (const ev of fireDrain.fresh) {
        if (ev.kind === 'fire') {
          const cue = plan.cues.find((c) => c.id === ev.cueId);
          const detail = cueDetail(plan, ev.cueId);
          events.push(
            `▶ FIRE  ${ev.cueId}  "${ev.label}"  why=${ev.reason}`
            + `${cue ? ` → ${actionSummary(plan, cue.action)}` : ''}${detail ? `  [${detail}]` : ''}`,
          );
          countIn(summary.fires, ev.cueId);
        } else {
          events.push(`◆ ${ev.label}  (${ev.reason}, ${ev.source})`);
          if (ev.reason && ev.reason.startsWith('party-')) countIn(summary.partySessionEnds, ev.reason);
        }
      }

      const wouldDrain = drainRing(svc.wouldFire, lastWould);
      lastWould = wouldDrain.last;
      for (const ev of wouldDrain.fresh) {
        const cue = plan.cues.find((c) => c.id === ev.cueId);
        const why = suppressionReason(ev, {
          cueKind: cue ? cue.kind : null,
          activeProgramCueId: svc.state.activeProgram ? svc.state.activeProgram.cueId : null,
          moodAllowed,
        });
        events.push(`✖ SUPPRESSED  ${ev.cueId}  (wanted: ${ev.reason})  — ${why}`);
        countIn(summary.suppressed, ev.cueId);
        countIn(summary.suppressionReasons, why);
      }

      const party = svc.getPartyStatus();
      if (party.effectiveState !== lastPartyState) {
        if (lastPartyState !== null) {
          events.push(`♪ PARTY  ${lastPartyState} → ${party.effectiveState}`
            + `${party.effectiveState === 'in_session' && party.sessionEndsAtMs
              ? ` (session ends ${formatLocal(new Date(party.sessionEndsAtMs), tz)})` : ''}`
            + `${party.effectiveState === 'cooldown' ? ` (cooldown ${party.cooldownRemainingSec}s)` : ''}`);
        }
        if (party.effectiveState === 'in_session') summary.partySessionsStarted += 1;
        lastPartyState = party.effectiveState;
      }

      for (const [cueId, msg] of Object.entries(svc.cueErrors)) summary.cueErrors[cueId] = msg;

      const dormant = !svc._inFestivalWindow();
      const sample = {
        dormant,
        playlist: deck.playlist,
        owner: dormant ? 'dormant' : deckOwnerLabel(svc),
        controller: svc.state.controller,
        palette: deck.palette,
        partyState: party.effectiveState,
      };
      accumulate(summary, sample, opts.stepMin);

      const hasEvents = events.length > 0
        || engineLines.some((e) => e.level !== 'log')
        || (opts.engineLog && engineLines.length > 0);
      if (!opts.eventsOnly || hasEvents) {
        const clock = formatLocal(new Date(nowMs), tz);
        const phase = svc.state.currentPhase || '—';
        const deckStr = deck.playlist
          ? `${deck.playlist} ▸ ${deck.pattern || '(empty)'}`
          : '(nothing loaded)';
        const ap = deck.autopilot.active
          ? `ap ${deck.autopilot.delay_s}s${deck.autopilot.shuffle ? ' shuf' : ' seq'}`
          : 'ap OFF';
        out(
          `${clock} │ ${(dormant ? 'DORMANT' : phase).padEnd(13)}`
          + `│ ${String(svc.state.controller).padEnd(9)}`
          + `│ ${sample.owner.padEnd(29)}`
          + `│ ${deckStr.padEnd(34)}`
          + `│ ${ap.padEnd(12)}`
          + `│ ${String(deck.palette || '—').padEnd(13)}`
          + `│ ${party.effectiveState}`,
        );
      }
      for (const line of events) out(`          ${line}`);
      flushEngineLines('       ');
    }
    svc.stop();
  } finally {
    Math.random = origRandom;
    console.log = origLog;
    console.warn = origWarn;
    console.error = origError;
  }

  for (const line of renderSummary(summary)) out(line);

  return {
    lines,
    summary,
    plan,
    meta: {
      planPath, planName: plan.name, tz, runDir, playlistsDir,
      moodLabel: moodDoc.label, spanStartMs: span.startMs, spanEndMs: span.endMs,
      steps: instants.length, deckAdvances: deck.advances,
      dateKey, dayKeys: span.dayKeys,
    },
  };
}

// ── CLI ──────────────────────────────────────────────────────────────────────

const HELP = `
timeline_dryrun.mjs — fast-forward a playa night through the REAL timeline code.

  node tools/timeline_dryrun.mjs [flags]        (run from marsin_engine/)

PLAN
  --scene <name>      scene whose timeline + playlists to use     (default: titanic)
  --plan <name|path>  plan in that scene's timeline/ dir, or a path (default: playa_default)
  --fixture           use the committed bench plan instead
                      (tests/fixtures/timeline/dryrun_bench.yaml — no festival
                       block, so it is ALWAYS in-window and any --date works)

CLOCK  (entirely independent of today's real date)
  --date YYYY-MM-DD   simulated playa-local start date            (default: today in the plan tz)
  --from HH:MM        start wall clock on that date               (default: 12:00)
  --days N            how many 24 h days to simulate              (default: 1)
  --to HH:MM          stop at this wall clock on the LAST day     (default: --from, i.e. full days)
  --step N            minutes of simulated time per tick, 1..60   (default: 1)
  --allow-dormant     run even where the plan is out of its festival window

MOOD  (the party-detection track)
  --mood <name>       built-in script                             (default: quiet)
  --mood-file <path>  YAML/JSON: { windows: [ {from:'HH:MM', to:'HH:MM', days?:[0,1]} ] }
  --list-moods        print the built-ins and exit

OUTPUT
  --events-only       only print steps that carry an event
  --engine-log        include the engine's own console.log chatter
  --out <file>        also write the transcript to a file (must be under ~/tmp)
  --seed N            PRNG seed for the autopilot shuffle          (default: 1)
  --party-config <json>  applied through the REAL setPartyConfig before the run,
                      e.g. --party-config '{"durationMin":5,"cooldownSec":600}'

VALIDATION (docs/77 §9 — offline dry-run assertion harness, G2)
  --assert             run the 8 assertion classes after the transcript and print
                      an ASSERTIONS section; exits 1 on any violation
  --assert-spec <path> YAML spec (masterWriters, directedCues, nightStart/End,
                      solarSweep, eventCues, masterZeroCue, eligibility,
                      expectedOrder, restartProbes, restartExpect — all optional).
                      Without it, classes 2 (master-authorship) and 4
                      (shuffle-pinning) are SKIPPED loudly (they need a
                      whitelist); every other class still runs on defaults.

The harness is OFFLINE: no sACN, no network, no running engine, and it never
writes inside simulation/scenes/** (the plan is copied to ~/tmp first).
`;

async function main() {
  let opts;
  try {
    opts = parseArgv(process.argv.slice(2));
  } catch (err) {
    console.error(`timeline_dryrun: ${err.message}`);
    process.exit(2);
  }
  if (opts.help) { console.log(HELP); return; }
  if (opts.listMoods) {
    console.log('Built-in mood scripts:');
    for (const [name, script] of Object.entries(MOOD_SCRIPTS)) {
      const windows = script.windows.length === 0
        ? 'never party'
        : script.windows.map((w) => `${w.from}–${w.to}`).join(', ');
      console.log(`  ${name.padEnd(20)} ${script.label}`);
      console.log(`  ${' '.repeat(20)} party windows: ${windows}`);
    }
    return;
  }

  let outStream = null;
  if (opts.out !== null) {
    const resolved = path.resolve(opts.out.startsWith('~') ? path.join(os.homedir(), opts.out.slice(1)) : opts.out);
    const tmpHome = path.join(os.homedir(), 'tmp');
    if (!resolved.startsWith(tmpHome + path.sep)) {
      console.error(`timeline_dryrun: --out must live under ${tmpHome} (got ${resolved})`);
      process.exit(2);
    }
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    outStream = fs.createWriteStream(resolved, { encoding: 'utf8' });
  }

  const emit = (text) => {
    process.stdout.write(`${text}\n`);
    if (outStream) outStream.write(`${text}\n`);
  };

  try {
    const result = await runDryRun(opts, emit);
    emit('');
    emit(`plan:      ${result.meta.planPath}`);
    emit(`playlists: ${result.meta.playlistsDir}`);
    emit(`mood:      ${result.meta.moodLabel}`);
    emit(`steps:     ${result.meta.steps} × ${opts.stepMin} min   (deck autopilot advances: ${result.meta.deckAdvances})`);
    emit(`scratch:   ${result.meta.runDir}`);

    if (opts.assert) {
      let spec = null;
      if (opts.assertSpec !== null) {
        const specPath = path.resolve(opts.assertSpec);
        const specText = fs.readFileSync(specPath, 'utf8');
        spec = parseAssertSpec(yaml.load(specText), specPath);
      }
      const assertResult = runAssertions({
        plan: result.plan,
        spec,
        dayKeys: result.meta.dayKeys,
        runDateKey: result.meta.dateKey,
      });
      for (const line of renderAssertionReport(assertResult)) emit(line);
      if (!assertResult.pass) process.exitCode = 1;
    }
  } catch (err) {
    console.error(`\ntimeline_dryrun FAILED: ${err.message}`);
    process.exitCode = 1;
  } finally {
    if (outStream) outStream.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
