/*
 * timeline_service.js — the Timeline as an ENGINE-INTERNAL service (docs/38 §15).
 *
 * This is the relocation of the old standalone Timeline Companion process into
 * the engine, modeled on lib/scheduled_tasks.js: it owns the plan library
 * (simulation/scenes/<scene>/timeline/*.yaml), the runtime state
 * (states/<scene>/timeline_state.yaml), and ONE in-engine 1 s tick. The pure
 * cores (sun / triggers / arbiter / show_plan / timeline_state) are unchanged —
 * they were written IO-free precisely so this is a relocation, not a rewrite.
 *
 * Two things changed versus the companion (docs/38 §15):
 *   1. MOOD is read DIRECTLY from the CPC via the injected `getMood()` — no WS
 *      subscription, no engine_link.
 *   2. ACTIONS are applied by calling the engine's INTERNAL functions through the
 *      injected `deps` — no HTTP self-calls, no :6965, no separate process. The
 *      old actions.js / engine_link.js logic becomes direct `deps` calls here.
 *
 * The behavioral model (cues, looks, sun math, mood, the §14 precedence arbiter)
 * is identical and the `timelineState` broadcast shape is preserved verbatim so
 * the CaptainPad tab keeps working.
 *
 * Codex P0 — FAIL LOUD: every action dep is awaited and a rejection is recorded
 * + surfaced (per-cue error, lastError) — never a silent skip. The tick loop
 * never crashes the engine on a dispatch failure: the failure is recorded and
 * broadcast, the loop keeps ticking. A missing plan/state on boot writes the
 * built-in default plan (a fresh scene must be runnable) but a present-but-broken
 * plan/state THROWS (no fallback over corruption).
 */
import fs from 'node:fs';
import path from 'node:path';

import { computeSunEvents, formatLocal } from './sun.js';
import { loadShowPlan, saveShowPlan, defaultShowPlan, validateShowPlan } from './show_plan.js';
import {
  resolveDayTimes, evaluateTick, activePhase, dayKeyFor, anchorToMs, dateClockToEpochMs,
} from './triggers.js';
import { applicableCues, festivalDayIndex, festivalDateFor } from './festival.js';
import { loadTimelineState, saveTimelineState } from './timeline_state.js';
import { arbitrate, resolveHold } from './arbiter.js';

const RECENT_MAX = 30;
const PLAN_NAME_RE = /^[a-z0-9][a-z0-9_-]*$/;

// Sun-ribbon events surfaced as HH:MM in the timelineState (matches the
// companion's SUN_RIBBON_EVENTS so the CaptainPad ribbon is unchanged).
const SUN_RIBBON_EVENTS = [
  'sunrise', 'goldenHourEnd', 'solarNoon', 'goldenHourStart',
  'sunset', 'civilDusk', 'nauticalDusk', 'sunrise',
];

function cueLabel(cue) {
  return cue.label || cue.id;
}

function triggerSummary(t) {
  switch (t.type) {
    case 'clock': return `clock ${t.at}`;
    case 'sun': return `${t.event}${t.offsetMin ? (t.offsetMin > 0 ? `+${t.offsetMin}m` : `${t.offsetMin}m`) : ''}`;
    case 'phase': return `phase ${t.phase}`;
    case 'mood': return `mood ${t.from}→${t.to}`;
    case 'manual': return 'manual';
    default: return t.type;
  }
}

// Sun events surfaced in the overview (docs/38 §15.2 overview shape).
const OVERVIEW_SUN_EVENTS = [
  'sunrise', 'sunset', 'solarNoon', 'civilDusk', 'goldenHourStart', 'goldenHourEnd',
];

// Short weekday name ('Sat') of a 'YYYY-MM-DD' calendar date in tz `tz`.
function weekdayFor(dateKey, tz) {
  const [y, m, d] = dateKey.split('-').map(Number);
  // Noon UTC keeps the date stable across any tz offset for weekday formatting.
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(dt);
}

/**
 * Build the multi-day OVERVIEW for the UI (docs/38 §15.2). PURE-ish: no IO, the
 * only impurity is `Date.now()` defaulting when nowMs is omitted. Returns one
 * entry per festival day (or a single "today" entry when the plan has no
 * festival), each with that date's sun events (HH:MM local or null) and the cues
 * that apply that day with their resolved `atLocal` (clock/sun cues → 'HH:MM';
 * mood/phase/manual → null).
 *
 * @param {object} plan   — a normalized (v2) plan
 * @param {number} [nowMs]
 */
export function buildOverview(plan, nowMs) {
  const now = typeof nowMs === 'number' ? nowMs : Date.now();
  if (!plan || typeof plan !== 'object') {
    return { plan: null, festival: null, location: null, days: [] };
  }
  const { lat, lon, tz } = plan.location;

  // Days to render: every festival day, or a single "today" entry if no span.
  const dayKeys = [];
  if (plan.festival) {
    for (let i = 0; i < plan.festival.days; i += 1) {
      dayKeys.push({ index: i, date: festivalDateFor(plan.festival, i) });
    }
  } else {
    dayKeys.push({ index: 0, date: dayKeyFor(now, tz) });
  }

  const days = dayKeys.map(({ index, date }) => {
    // Anchor the day at local noon so sun math + clock resolution land on the
    // intended calendar day in tz regardless of UTC offset.
    const dayNoonMs = dateClockToEpochMs(date, '12:00', tz);
    const sunEvents = computeSunEvents({ lat, lon, date: new Date(dayNoonMs), tz });

    const sun = {};
    for (const name of OVERVIEW_SUN_EVENTS) {
      const ev = sunEvents[name];
      sun[name] = ev instanceof Date ? formatLocal(ev, tz) : null;
    }

    // Cues applying on this day, with their resolved local fire time.
    const applies = applicableCues(plan, dayNoonMs);
    const cues = applies.map((cue) => {
      let atLocal = null;
      const t = cue.trigger;
      if (t.type === 'clock') {
        atLocal = formatLocal(new Date(anchorToMs({ clock: t.at }, dayNoonMs, tz, sunEvents)), tz);
      } else if (t.type === 'sun') {
        const ms = anchorToMs({ sun: t.event, offsetMin: t.offsetMin || 0 }, dayNoonMs, tz, sunEvents);
        atLocal = ms !== null ? formatLocal(new Date(ms), tz) : null;
      }
      return {
        id: cue.id,
        label: cue.label || cue.id,
        kind: cue.kind,
        trigger: cue.trigger,
        action: cue.action,
        atLocal,
      };
    });

    return { index, date, weekday: weekdayFor(date, tz), sun, cues };
  });

  return {
    plan: plan.name || null,
    festival: plan.festival || null,
    location: plan.location,
    days,
  };
}

export class TimelineService {
  /**
   * @param {object} opts
   * @param {string}  opts.scene      — active scene/model name
   * @param {string}  opts.sceneDir   — simulation/scenes/<scene>/timeline/ (plan library)
   * @param {string}  opts.stateDir   — states/<scene>/ (runtime state)
   * @param {() => {party:0|1, value:number}} opts.getMood — reads mood from the CPC
   * @param {object}  opts.deps       — engine-internal action callbacks (see below)
   * @param {(stateObj:object) => void} opts.broadcast — WS broadcaster for {type:'timelineState',...}
   * @param {object}  opts.config     — { enabled, activePlan, tickMs, mood:{key, partyThreshold} }
   * @param {() => number} [opts.nowFn]   — clock (default Date.now). Injected for tests.
   *
   * `deps` covers everything the old actions.js / engine_link.js did, but as
   * direct in-engine calls (all may be async):
   *   loadPlaylist({ target, name })        — load a playlist onto a target
   *   setAutopilot({ target, state })        — set autopilot on a target ({active, delay_s, shuffle})
   *   setParams(obj)                         — CPC write (numbers + {h,s,v} palette HSV)
   *   requestScene(name)                     — engine scene switch
   *   patchScheduledTask(id, patch)          — scheduled-tasks patch
   *   fireScheduledTask(id)                  — scheduled-tasks fire-now
   *   listMixerChannelIds()                  — array of mixer channel ids (for target 'all')
   *   listPlaylists()                        — playlist library listing
   * where `target` is { channel:'deck'|'mixer'|'all', id }.
   */
  constructor({ scene, sceneDir, stateDir, getMood, deps, broadcast, config, nowFn }) {
    if (typeof scene !== 'string' || !scene) throw new Error('TimelineService: scene is required');
    if (typeof sceneDir !== 'string' || !sceneDir) throw new Error('TimelineService: sceneDir is required');
    if (typeof stateDir !== 'string' || !stateDir) throw new Error('TimelineService: stateDir is required');
    if (typeof getMood !== 'function') throw new Error('TimelineService: getMood is required');
    if (!deps || typeof deps !== 'object') throw new Error('TimelineService: deps is required');
    if (typeof broadcast !== 'function') throw new Error('TimelineService: broadcast is required');
    if (!config || typeof config !== 'object') throw new Error('TimelineService: config is required');

    this.scene = scene;
    this.sceneDir = sceneDir;
    this.stateDir = stateDir;
    this.getMood = getMood;
    this.deps = deps;
    this.broadcast = broadcast;
    this.config = config;
    this.nowFn = nowFn || Date.now;

    this.activePlan = config.activePlan || 'playa_default';
    this.tickMs = config.tickMs || 1000;
    // Palettes are resolved from the engine's colorPalettes config (ported from
    // the old actions.js resolvePalette). Injected so the service has no IO of
    // its own for palette lookup.
    this.colorPalettes = Array.isArray(config.colorPalettes) ? config.colorPalettes : [];

    this.plan = null;
    this.state = null;
    this.lastStateJson = '';
    this.bootError = null;
    this.lastError = null;
    this.cueErrors = {};        // cueId → last error string
    this.recentFires = [];      // ring of { cueId, atMs, reason }
    this.wouldFire = [];        // ring of mood-suppressed { cueId, reason, atMs }
    this.sunCache = { dayKey: null, events: null };
    this._tickHandle = null;
    this._ticking = false;      // re-entrancy guard for the async tick
  }

  // ── lifecycle ───────────────────────────────────────────────────────────

  /**
   * Load the active plan + runtime state, establish the autopilot baseline (or
   * resume a caught-up program), then begin the 1 s tick. Never throws over a
   * missing plan/state (writes/uses the default); a broken file THROWS.
   */
  async start() {
    if (this._tickHandle) return;
    this._loadSceneFiles();
    try {
      await this._catchUp();
    } catch (e) {
      this.bootError = `catchUp: ${e && e.message}`;
      console.warn(`  ⚠ [timeline] catchUp threw: ${e && e.message}`);
    }
    this._tickHandle = setInterval(() => {
      this._tick().catch((e) => {
        this.lastError = `tick: ${e && e.message}`;
        console.warn(`  ⚠ [timeline] tick error: ${e && e.message}`);
      });
    }, this.tickMs);
    this._broadcastState();
  }

  stop() {
    if (this._tickHandle) {
      clearInterval(this._tickHandle);
      this._tickHandle = null;
    }
  }

  // ── scene/plan/state load ────────────────────────────────────────────────

  _planPath(name) {
    return path.join(this.sceneDir, `${name}.yaml`);
  }

  _loadSceneFiles() {
    if (!fs.existsSync(this.sceneDir)) fs.mkdirSync(this.sceneDir, { recursive: true });
    const planPath = this._planPath(this.activePlan);
    if (!fs.existsSync(planPath)) {
      // A fresh scene must be runnable — write the default plan (the only
      // file-creation path; matches the old companion's loadSceneFiles).
      saveShowPlan(defaultShowPlan(), planPath);
      console.log(`  📝 [timeline] wrote default plan → ${planPath}`);
    }
    this.plan = loadShowPlan(planPath);
    this.state = loadTimelineState(this.stateDir);
    if (!this.state.activePlan) this.state.activePlan = this.activePlan;
    // Seed the runtime autopilot toggle from the plan's baseline only when the
    // state predates the §14 model. Once toggled, the runtime value wins.
    if (this.state.autopilotEnabled === undefined) this.state.autopilotEnabled = this.plan.autopilot.enabled;
    if (this.state.activeProgram === undefined) this.state.activeProgram = null;
    if (this.state.controller === undefined) this.state.controller = 'autopilot';
  }

  // ── sun / day-time helpers ────────────────────────────────────────────────

  _sunEventsFor(now) {
    const tz = this.plan.location.tz;
    const dayKey = dayKeyFor(now, tz);
    if (this.sunCache.dayKey !== dayKey) {
      this.sunCache = {
        dayKey,
        events: computeSunEvents({
          lat: this.plan.location.lat, lon: this.plan.location.lon, date: new Date(now), tz,
        }),
      };
    }
    return this.sunCache.events;
  }

  // ── action resolution (ported from companion actions.js, now direct deps) ──

  /**
   * Resolve an action `target` into a concrete channel list.
   *   { channel:'deck' }       → [{ kind:'deck' }]
   *   { channel:'mixer', id }  → [{ kind:'mixer', id }]
   *   { channel:'all' }        → deck + every mixer channel id (from the engine)
   * Default target is the deck. Throws if a mixer target omits its id.
   */
  async _resolveTargets(target) {
    const t = target || { channel: 'deck', id: null };
    if (t.channel === 'deck') return [{ kind: 'deck' }];
    if (t.channel === 'mixer') {
      if (!t.id) throw new Error('action target channel "mixer" requires an id');
      return [{ kind: 'mixer', id: t.id }];
    }
    if (t.channel === 'all') {
      const ids = await this.deps.listMixerChannelIds();
      const out = [{ kind: 'deck' }];
      for (const id of (Array.isArray(ids) ? ids : [])) {
        if (id !== undefined && id !== null) out.push({ kind: 'mixer', id });
      }
      return out;
    }
    throw new Error(`unknown action target channel "${t.channel}"`);
  }

  /**
   * Resolve a colorPalette id from the engine's colorPalettes config → a CPC
   * write that sets both palette slots from the palette's c1/c2 hues. Throws if
   * the id is not found (a cue referencing a missing palette must fail loud).
   * Ported from actions.js resolvePalette.
   */
  _resolvePalette(id) {
    const entry = this.colorPalettes.find((p) => p && p.id === id);
    if (!entry) throw new Error(`palette "${id}" not found in colorPalettes config`);
    return {
      colorPalette1: { h: entry.c1, s: 1, v: 1 },
      colorPalette2: { h: entry.c2, s: 1, v: 1 },
    };
  }

  async _loadPlaylistOnTarget(target, name, steps) {
    await this.deps.loadPlaylist({ target, name });
    steps.push(target.kind === 'deck'
      ? `deck ← playlist "${name}"`
      : `mixer:${target.id} ← playlist "${name}"`);
  }

  async _setAutopilotOnTarget(target, state, steps) {
    await this.deps.setAutopilot({ target, state });
    steps.push(target.kind === 'deck'
      ? `deck ← autopilot ${JSON.stringify(state)}`
      : `mixer:${target.id} ← autopilot ${JSON.stringify(state)}`);
  }

  async _applyTaskToggles(enable, disable, steps) {
    for (const id of enable || []) {
      await this.deps.patchScheduledTask(id, { enabled: true });
      steps.push(`task ${id} ← enabled`);
    }
    for (const id of disable || []) {
      await this.deps.patchScheduledTask(id, { enabled: false });
      steps.push(`task ${id} ← disabled`);
    }
  }

  // Execute a 'look' bundle: palette → globals → playlist → autopilot → tasks.
  async _applyLook(look, name, steps) {
    if (look.palette) {
      await this.deps.setParams(this._resolvePalette(look.palette));
      steps.push(`look "${name}" palette "${look.palette}"`);
    }
    if (look.globals) {
      await this.deps.setParams(look.globals);
      steps.push(`look "${name}" globals ${JSON.stringify(look.globals)}`);
    }
    const targets = await this._resolveTargets(look.target);
    if (look.playlist) {
      for (const target of targets) await this._loadPlaylistOnTarget(target, look.playlist, steps);
    }
    if (look.autopilot) {
      for (const target of targets) await this._setAutopilotOnTarget(target, look.autopilot, steps);
    }
    if (look.tasks) {
      await this._applyTaskToggles(look.tasks.enable, look.tasks.disable, steps);
    }
  }

  /**
   * Establish the AUTOPILOT baseline (docs/38 §14): load the plan-level autopilot
   * playlist on its target and turn engine autopilot ON. Ported from actions.js
   * applyAutopilotBaseline. Returns { steps }; THROWS on any dep rejection.
   */
  async _applyAutopilotBaseline() {
    const ap = this.plan && this.plan.autopilot ? this.plan.autopilot : null;
    if (!ap) throw new Error('applyAutopilotBaseline: plan.autopilot missing');
    const steps = [];
    const targets = await this._resolveTargets(ap.target);
    if (ap.playlist) {
      for (const target of targets) await this._loadPlaylistOnTarget(target, ap.playlist, steps);
    }
    const state = { active: true, delay_s: ap.delay_s, shuffle: ap.shuffle };
    for (const target of targets) await this._setAutopilotOnTarget(target, state, steps);
    return { steps };
  }

  /** Execute one validated cue action object. Returns { steps }. THROWS loud. */
  async _applyAction(action) {
    if (!action || typeof action !== 'object') throw new Error('applyAction: action must be an object');
    const steps = [];
    switch (action.type) {
      case 'playlist': {
        const targets = await this._resolveTargets(action.target);
        for (const target of targets) await this._loadPlaylistOnTarget(target, action.name, steps);
        if (action.autopilot) {
          for (const target of targets) await this._setAutopilotOnTarget(target, action.autopilot, steps);
        }
        break;
      }
      case 'look': {
        const look = this.plan && this.plan.looks ? this.plan.looks[action.look] : undefined;
        if (!look) throw new Error(`look "${action.look}" not defined in plan`);
        await this._applyLook(look, action.look, steps);
        break;
      }
      case 'scene': {
        await this.deps.requestScene(action.scene);
        steps.push(`scene ← "${action.scene}"`);
        break;
      }
      case 'globals': {
        await this.deps.setParams(action.set);
        steps.push(`globals ${JSON.stringify(action.set)}`);
        break;
      }
      case 'tasks': {
        await this._applyTaskToggles(action.enable, action.disable, steps);
        break;
      }
      case 'effect': {
        // fire-now uses the scheduled task's OWN preset. params are rejected at
        // validation (show_plan.js) so they can never reach here silently.
        await this.deps.fireScheduledTask(action.effectId);
        steps.push(`effect fire scheduled-task "${action.effectId}"`);
        break;
      }
      default:
        throw new Error(`applyAction: unknown action type "${action.type}"`);
    }
    return { steps };
  }

  // ── dispatch (ported from timeline_server.js) ─────────────────────────────

  _recordFire(cueId, reason) {
    this.recentFires.push({ cueId, atMs: this.nowFn(), reason });
    if (this.recentFires.length > RECENT_MAX) this.recentFires.shift();
  }

  async _dispatchCue(cueId, reason) {
    const cue = this.plan.cues.find((c) => c.id === cueId);
    if (!cue) throw new Error(`cue "${cueId}" not in active plan`);
    const result = await this._applyAction(cue.action);
    delete this.cueErrors[cueId];
    this.state.lastFiredCueId = cueId;
    this.state.lastFiredAtMs = this.nowFn();
    this._recordFire(cueId, reason);
    return result;
  }

  /**
   * Honour the §14 contract: autopilotOff turns the baseline autopilot OFF (a
   * program takes over), the synthetic __resume_autopilot__ re-establishes the
   * baseline, everything else is a normal cue action. Ported verbatim from the
   * companion's dispatchArbitratedAction, minus HTTP.
   */
  /**
   * Disarm engine autopilot on the BASELINE's configured target(s). A program
   * preempting an all-channel (or mixer) baseline must turn autopilot OFF on the
   * SAME channels the baseline armed — disarming only the deck would leave the
   * mixer cycling underneath the program (docs/38 §14). Resolves the plan's
   * autopilot.target the same way actions resolve targets.
   */
  async _disarmBaselineAutopilot() {
    const ap = this.plan && this.plan.autopilot ? this.plan.autopilot : null;
    const targets = await this._resolveTargets(ap ? ap.target : { channel: 'deck', id: null });
    for (const target of targets) {
      await this.deps.setAutopilot({ target, state: { active: false } });
    }
  }

  async _dispatchArbitratedAction(act, reason) {
    if (act.autopilotOff) {
      await this._disarmBaselineAutopilot();
    }
    if (act.action && act.action.type === '__resume_autopilot__') {
      const result = await this._applyAutopilotBaseline();
      this._recordFire(act.cueId, 'resume');
      return result;
    }
    const cue = this.plan.cues.find((c) => c.id === act.cueId);
    if (!cue) throw new Error(`cue "${act.cueId}" not in active plan`);
    const result = await this._applyAction(act.action);
    delete this.cueErrors[act.cueId];
    this.state.lastFiredCueId = act.cueId;
    this.state.lastFiredAtMs = this.nowFn();
    this._recordFire(act.cueId, reason);
    console.log(`  ▶ [timeline] fired "${act.cueId}" (${reason}): ${result.steps.join('; ')}`);
    return result;
  }

  async _establishAutopilotBaseline(reason) {
    const result = await this._applyAutopilotBaseline();
    console.log(`  🛟 [timeline] autopilot baseline (${reason}): ${result.steps.join('; ')}`);
    return result;
  }

  // Establish baseline + set controller='autopilot' iff the baseline is enabled
  // and the operator hasn't taken over. A dep failure records the error — boot
  // never crashes (codex P0). Ported from establishBaselineIfActive.
  async _establishBaselineIfActive(reason) {
    const now = this.nowFn();
    const holding = typeof this.state.manualHoldUntilMs === 'number' && this.state.manualHoldUntilMs > now;
    const paused = this.state.mode === 'paused' || this.state.mode === 'overridden';
    if (this.state.autopilotEnabled === false) {
      this.state.controller = 'manual';
      return;
    }
    if (paused || holding) { this.state.controller = 'manual'; return; }
    try {
      await this._establishAutopilotBaseline(reason);
      this.state.controller = 'autopilot';
    } catch (e) {
      this.bootError = `autopilot baseline (${reason}): ${e && e.message}`;
      console.warn(`  ⚠ [timeline] autopilot baseline (${reason}) failed: ${e && e.message}`);
    }
  }

  // ── catchUp on boot (ported from timeline_server.js catchUp) ──────────────

  async _catchUp() {
    const now = this.nowFn();
    const sunEvents = this._sunEventsFor(now);
    // catchUp also restricts to TODAY's applicable cues (docs/38 §15.2) — a
    // burn-night program must not "catch up" on a non-burn day.
    const dayPlan = { ...this.plan, cues: applicableCues(this.plan, now) };
    const dayTimes = resolveDayTimes({ plan: dayPlan, now, sunEvents });
    const dayKey = dayKeyFor(now, this.plan.location.tz);
    if (!this.state.firedToday) this.state.firedToday = {};
    this.state.dayKey = dayKey;
    // activeProgram is RUNTIME state — never resume a persisted one across a
    // restart (docs/31 "never resume an interrupted window"). A stale program
    // (esp. an untilMs:null one) would hang as the controller forever and
    // permanently suppress mood. Clear it; catchUp below re-derives it from the
    // current time + plan.
    this.state.activeProgram = null;

    let best = null;
    for (const cue of dayPlan.cues) {
      if (cue.enabled === false) continue;
      const t = cue.trigger;
      if (t.type !== 'clock' && t.type !== 'sun') continue;
      const fireMs = dayTimes.cueTimes[cue.id];
      if (typeof fireMs !== 'number' || fireMs > now) continue;
      this.state.firedToday[cue.id] = dayKey;
      const restorable = (cue.action.type === 'look' || cue.action.type === 'playlist') && cue.catchUp !== false;
      if (restorable && (best === null || fireMs > best.fireMs)) best = { cue, fireMs };
    }

    let programCaughtUp = false;
    if (best && best.cue.kind === 'program') {
      const untilMs = resolveHold(best.cue.hold, best.fireMs, dayTimes);
      // Only re-arm as an ACTIVE program if it is genuinely still inside a real
      // (future) hold window. A no-hold (untilMs===null) or already-expired
      // program from earlier today restores its LOOK (dispatched below) but must
      // NOT seize the controller forever — otherwise autopilot + mood never run.
      if (typeof untilMs === 'number' && untilMs > now) {
        this.state.activeProgram = { cueId: best.cue.id, startedAtMs: best.fireMs, untilMs };
        this.state.controller = 'manual';
        programCaughtUp = true;
      }
    }

    if (best) {
      try {
        const result = await this._dispatchCue(best.cue.id, 'catchUp');
        console.log(`  ⏪ [timeline] catchUp restored "${best.cue.id}": ${result.steps.join('; ')}`);
        if (programCaughtUp) {
          await this._disarmBaselineAutopilot();
          this.state.controller = 'program';
        }
      } catch (e) {
        this.cueErrors[best.cue.id] = `catchUp failed: ${e && e.message}`;
        this.bootError = `catchUp "${best.cue.id}": ${e && e.message}`;
        console.warn(`  ⚠ [timeline] catchUp "${best.cue.id}" failed: ${e && e.message}`);
      }
    }

    if (!programCaughtUp) await this._establishBaselineIfActive('boot');
    saveTimelineState(this.state, this.stateDir);
    this.lastStateJson = JSON.stringify(this.state);
  }

  // ── the tick (ported from timeline_server.js tick) ────────────────────────

  async _tick() {
    if (!this.plan || !this.state) return;
    if (this._ticking) return; // never overlap two async ticks
    this._ticking = true;
    try {
      const now = this.nowFn();
      const sunEvents = this._sunEventsFor(now);
      // The RUNTIME tick is always "today": build the day's working plan = the
      // full plan with cues restricted to those applicable to today's festival
      // day (docs/38 §15.2). resolveDayTimes / evaluateTick / arbitrate all see
      // only today's cues, so only today's cues fire — multi-day lives in the
      // plan + overview, never the tick.
      const dayPlan = { ...this.plan, cues: applicableCues(this.plan, now) };
      const dayTimes = resolveDayTimes({ plan: dayPlan, now, sunEvents });
      const mood = this.getMood();

      const { fires, state: nextState } = evaluateTick({ now, plan: dayPlan, state: this.state, mood, dayTimes });
      this.state = nextState;
      this.state.currentMood = mood.party ? 'party' : 'calm';

      const reasonByCue = new Map(fires.map((f) => [f.cueId, f.reason]));
      const { actions, state: arbState } = arbitrate({ now, plan: dayPlan, state: this.state, fires, dayTimes });
      this.state = arbState;

      // Fires the arbiter dropped (e.g. a mood swap suppressed under a program)
      // are surfaced as recent "wouldFire" so the operator sees the intent — never
      // silent. The companion broadcast a separate `wouldFire` WS message; here we
      // fold them into a ring exposed by getState() (control WS carries only
      // timelineState).
      const dispatchedCues = new Set(actions.map((a) => a.cueId));
      for (const fire of fires) {
        if (!dispatchedCues.has(fire.cueId)) {
          this.wouldFire.push({ cueId: fire.cueId, reason: fire.reason, controller: this.state.controller, atMs: now });
          if (this.wouldFire.length > RECENT_MAX) this.wouldFire.shift();
        }
      }

      for (const act of actions) {
        try {
          await this._dispatchArbitratedAction(act, reasonByCue.get(act.cueId) || 'auto');
          this.lastError = null;
        } catch (e) {
          this.cueErrors[act.cueId] = `${e && e.message}`;
          this.lastError = `cue "${act.cueId}": ${e && e.message}`;
          console.warn(`  ⚠ [timeline] cue "${act.cueId}" failed: ${e && e.message}`);
          // Never crash the loop on a dispatch failure (codex P0 fail loud, but
          // keep ticking — the failure is surfaced, not fatal).
        }
      }

      const json = JSON.stringify(this.state);
      if (json !== this.lastStateJson) {
        saveTimelineState(this.state, this.stateDir);
        this.lastStateJson = json;
      }

      this._broadcastState();
    } finally {
      this._ticking = false;
    }
  }

  // ── timelineState (preserved shape) ───────────────────────────────────────

  getState() {
    const now = this.nowFn();
    if (!this.plan || !this.state) {
      return {
        type: 'timelineState',
        mode: 'armed', scene: this.scene, activePlan: this.activePlan,
        controller: 'autopilot', autopilotEnabled: true, activeProgram: null,
        currentPhase: null, currentMood: 'calm', party: 0, moodValue: 0,
        engineConnected: true,
        waiting: true, nextCue: null,
        sun: {}, phases: {}, cues: [], recentFires: [], wouldFire: [],
        lastError: this.bootError || this.lastError,
      };
    }

    const sunEvents = this._sunEventsFor(now);
    const dayTimes = resolveDayTimes({ plan: this.plan, now, sunEvents });
    const phaseNow = activePhase({ plan: this.plan, now, dayTimes });
    const mood = this.getMood();
    const tz = this.plan.location.tz;

    const sun = {};
    for (const name of SUN_RIBBON_EVENTS) {
      const d = sunEvents[name];
      if (d instanceof Date) sun[name] = formatLocal(d, tz);
    }

    const phases = {};
    for (const [name, win] of Object.entries(dayTimes.phases)) {
      phases[name] = {
        start: win.startMs !== null ? formatLocal(new Date(win.startMs), tz) : null,
        end: win.endMs !== null ? formatLocal(new Date(win.endMs), tz) : null,
      };
    }

    const cues = [];
    let nextCue = null;
    for (const cue of this.plan.cues) {
      const fireMs = dayTimes.cueTimes[cue.id];
      let nextInSec = null;
      if (typeof fireMs === 'number' && fireMs > now && cue.enabled !== false) {
        nextInSec = Math.round((fireMs - now) / 1000);
        if (nextCue === null || nextInSec < nextCue.inSec) {
          nextCue = { id: cue.id, label: cueLabel(cue), inSec: nextInSec };
        }
      }
      cues.push({
        id: cue.id,
        label: cueLabel(cue),
        trigger: triggerSummary(cue.trigger),
        enabled: cue.enabled !== false,
        nextInSec,
        lastError: this.cueErrors[cue.id] || null,
      });
    }

    const holding = typeof this.state.manualHoldUntilMs === 'number' && this.state.manualHoldUntilMs > now;
    const mode = holding ? 'holding' : this.state.mode;

    let activeProgram = null;
    if (this.state.activeProgram && this.state.activeProgram.cueId) {
      activeProgram = {
        cueId: this.state.activeProgram.cueId,
        startedAtMs: this.state.activeProgram.startedAtMs,
        untilMs: this.state.activeProgram.untilMs !== undefined ? this.state.activeProgram.untilMs : null,
      };
    }

    return {
      type: 'timelineState',
      mode,
      scene: this.scene,
      activePlan: this.state.activePlan || this.activePlan,
      controller: this.state.controller || 'autopilot',
      autopilotEnabled: this.state.autopilotEnabled !== false,
      activeProgram,
      currentPhase: phaseNow,
      currentMood: mood.party ? 'party' : 'calm',
      party: mood.party,
      moodValue: mood.value,
      engineConnected: true,
      waiting: false,
      nextCue,
      sun,
      phases,
      cues,
      recentFires: this.recentFires.slice(-RECENT_MAX),
      wouldFire: this.wouldFire.slice(-RECENT_MAX),
      lastError: this.bootError || this.lastError,
    };
  }

  _broadcastState() {
    this.broadcast(this.getState());
  }

  // ── plan library CRUD (backs the CaptainPad maker) ────────────────────────

  _assertPlanName(name) {
    if (typeof name !== 'string' || !PLAN_NAME_RE.test(name)) {
      throw new Error(`invalid plan name "${name}" (must match ${PLAN_NAME_RE})`);
    }
    return name;
  }

  listPlans() {
    if (!this.sceneDir || !fs.existsSync(this.sceneDir)) return [];
    return fs.readdirSync(this.sceneDir)
      .filter((f) => f.endsWith('.yaml'))
      .map((f) => f.replace(/\.yaml$/, ''));
  }

  getPlan(name) {
    this._assertPlanName(name);
    const planPath = this._planPath(name);
    if (!fs.existsSync(planPath)) throw new Error(`plan "${name}" not found`);
    return loadShowPlan(planPath);
  }

  /** Validate-then-write an authored plan. THROWS on an invalid plan (no fallback). */
  savePlan(plan) {
    if (!plan || typeof plan !== 'object') throw new Error('savePlan: plan must be an object');
    const normalized = validateShowPlan(plan);
    this._assertPlanName(normalized.name);
    if (!fs.existsSync(this.sceneDir)) fs.mkdirSync(this.sceneDir, { recursive: true });
    saveShowPlan(normalized, this._planPath(normalized.name));
    return normalized;
  }

  deletePlan(name) {
    this._assertPlanName(name);
    if (name === this.activePlan) throw new Error(`cannot delete the active plan "${name}"`);
    const planPath = this._planPath(name);
    if (!fs.existsSync(planPath)) throw new Error(`plan "${name}" not found`);
    fs.unlinkSync(planPath);
  }

  /** Switch to a different plan name (reload + re-run catchUp). */
  async activatePlan(name) {
    this._assertPlanName(name);
    const planPath = this._planPath(name);
    if (!fs.existsSync(planPath)) throw new Error(`plan "${name}" not found in ${this.sceneDir}`);
    this.plan = loadShowPlan(planPath);
    this.activePlan = name;
    this.state.activePlan = name;
    this.state.firedToday = {};
    // Stale fires/errors belong to the OUTGOING plan — clearing firedToday alone
    // would leave the previous plan's history bleeding into the new plan's UI.
    this.recentFires = [];
    this.wouldFire = [];
    this.cueErrors = {};
    await this._catchUp();
    this._broadcastState();
    return name;
  }

  // ── operator controls (docs/38 §14.5) ─────────────────────────────────────

  setMode(mode) {
    if (mode !== 'armed' && mode !== 'paused') {
      throw new Error("mode must be 'armed' or 'paused'");
    }
    this.state.mode = mode;
    if (mode === 'armed') this.state.manualHoldUntilMs = null;
    this._persistAndBroadcast();
    return { mode: this.state.mode };
  }

  hold(minutes) {
    const m = Number(minutes);
    if (!Number.isFinite(m) || m <= 0) throw new Error('minutes must be a number > 0');
    this.state.manualHoldUntilMs = this.nowFn() + m * 60000;
    // A hold is operator takeover — reflect that in the controller immediately
    // rather than letting it read stale (e.g. 'autopilot') until the next tick.
    this.state.controller = 'manual';
    this._persistAndBroadcast();
    return { manualHoldUntilMs: this.state.manualHoldUntilMs };
  }

  resume() {
    this.state.mode = 'armed';
    this.state.manualHoldUntilMs = null;
    this._persistAndBroadcast();
    return { mode: this.state.mode };
  }

  async setAutopilotEnabled(enabled) {
    if (typeof enabled !== 'boolean') throw new Error('enabled must be a boolean');
    this.state.autopilotEnabled = enabled;
    try {
      if (enabled) {
        await this._establishBaselineIfActive('operator');
      } else {
        await this._disarmBaselineAutopilot();
        if (!this.state.activeProgram) this.state.controller = 'manual';
        this.lastError = null;
      }
    } catch (e) {
      this.lastError = `autopilot toggle: ${e && e.message}`;
    }
    this._persistAndBroadcast();
    return { autopilotEnabled: this.state.autopilotEnabled, controller: this.state.controller };
  }

  async endProgram() {
    if (!this.state.activeProgram) {
      return { activeProgram: null, controller: this.state.controller };
    }
    this.state.activeProgram = null;
    try {
      if (this.state.autopilotEnabled !== false && this.state.mode !== 'paused' && this.state.mode !== 'overridden') {
        await this._establishBaselineIfActive('program/end');
      } else {
        this.state.controller = 'manual';
      }
      this.lastError = null;
    } catch (e) {
      this.lastError = `program/end: ${e && e.message}`;
    }
    this._persistAndBroadcast();
    return { activeProgram: null, controller: this.state.controller };
  }

  /**
   * Manual cue fire. Routes through the SAME arbiter path so a program cue
   * starts a program (sets activeProgram, turns baseline autopilot off) and a
   * mood cue respects the controller (docs/38 §14). Returns { steps, controller }.
   */
  async fireCue(id) {
    const cue = this.plan && this.plan.cues.find((c) => c.id === id);
    if (!cue) throw new Error(`cue "${id}" not found`);
    const now = this.nowFn();
    const sunEvents = this._sunEventsFor(now);
    const dayTimes = resolveDayTimes({ plan: this.plan, now, sunEvents });
    const { actions, state: arbState } = arbitrate({
      now, plan: this.plan, state: this.state, fires: [{ cueId: id, reason: 'manual' }], dayTimes,
    });
    this.state = arbState;
    const steps = [];
    try {
      for (const act of actions) {
        const r = await this._dispatchArbitratedAction(act, 'manual');
        if (r && r.steps) steps.push(...r.steps);
      }
      this.lastError = null;
      this._persistAndBroadcast();
      return { steps, controller: this.state.controller };
    } catch (e) {
      this.cueErrors[id] = `${e && e.message}`;
      this.lastError = `manual fire "${id}": ${e && e.message}`;
      this._broadcastState();
      throw e;
    }
  }

  _persistAndBroadcast() {
    saveTimelineState(this.state, this.stateDir);
    this.lastStateJson = JSON.stringify(this.state);
    this._broadcastState();
  }
}
