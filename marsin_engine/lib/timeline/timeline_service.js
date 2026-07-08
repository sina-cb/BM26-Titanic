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
import {
  applicableCues, festivalDayIndex, festivalDateFor, festivalStartsInDays,
} from './festival.js';
import { loadTimelineState, saveTimelineState } from './timeline_state.js';
import { arbitrate, resolveHold } from './arbiter.js';

// Event-log ring cap. The ring carries cue FIRES *and* plan LIFECYCLE events
// (pause/resume/hold/autopilot/takeover/program-end/lease — see
// _recordLifecycle), so it is sized to hold a full evening of both.
const RECENT_MAX = 50;
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
      const overviewCue = {
        id: cue.id,
        label: cue.label || cue.id,
        kind: cue.kind,
        trigger: cue.trigger,
        action: cue.action,
        atLocal,
      };
      // Carry durationMin through so the maker strip renders the deck-owned
      // WINDOW as a time BLOCK (start→start+durationMin) rather than a point
      // marker (operator: "make sure the duration is shown on the day overview
      // timeline"). Only when authored (>0) — a point cue omits it.
      if (typeof cue.durationMin === 'number' && cue.durationMin > 0) {
        overviewCue.durationMin = cue.durationMin;
      }
      return overviewCue;
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
   *   setMaster(value)                       — DECK GRAND MASTER write (the same
   *                                            mixer.setMaster path the operator's
   *                                            master fader uses). A cue/look's
   *                                            `master` global routes here, NOT to
   *                                            the CPC (which has no `master` param)
   *                                            — Task 1 unify.
   *   requestScene(name)                     — engine scene switch
   *   patchScheduledTask(id, patch)          — scheduled-tasks patch
   *   fireScheduledTask(id)                  — scheduled-tasks fire-now
   *   listMixerChannelIds()                  — array of mixer channel ids (for target 'all')
   *   listPlaylists()                        — playlist library listing
   *   setDeckTransition(patch)               — patch the deck transition-config
   *                                            ({mode, durationMs?, enabled?}) before a deck swap
   *   setDeckOverlaysEnabled(bool)           — enable (honor configured) / disable ALL deck overlays
   *   setColorAutopilot({active, palettes, delay_s, shuffle}) — configure + start/stop the
   *                                            engine palette-cycling daemon (docs/39)
   *   setDeckHue(degrees)                    — apply the DECK CHANNEL's per-channel hue the SAME
   *                                            way the operator's deck hue slider does (the PATCH
   *                                            /deck/channel { hue } internal path). A deck
   *                                            playlist cue's `hue` routes here. Hue is
   *                                            PER-CHANNEL ONLY (the global shifter was removed).
   *   forceDeckView()                        — PIN engine output to the deck via the existing
   *                                            viewOverride machinery (docs/38 §16.9) — the plan owns
   *                                            the deck-pin while it drives the deck
   *   releaseDeckView()                      — RELEASE the plan's soft deck-pin (docs/38 §16.9): the
   *                                            counterpart to forceDeckView, called on every transition
   *                                            where the plan stops driving the deck (pause / autopilot
   *                                            off / deactivate). Clears the 'plan' controlLock but
   *                                            NEVER a real PortWatch hardware lock.
   *   getViewOverrideMode()                  — read-only: current engine view-override ('deck'|null),
   *                                            so getState can surface `forcingDeckView`
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
    // Pending-program lease window (docs/38 §16.5). Default 30 s.
    this.programLeaseSec = typeof config.programLeaseSec === 'number' && config.programLeaseSec > 0
      ? config.programLeaseSec : 30;
    // Operator-takeover lease window (docs/38 §16). Default 120 s. When the
    // operator takes over (POST /timeline/takeover) the plan is leased to them;
    // with no UI activity for this many seconds the lease releases and the plan
    // resumes at the wall-clock time of release (via _catchUp).
    this.operatorLeaseSec = typeof config.operatorLeaseSec === 'number' && config.operatorLeaseSec > 0
      ? config.operatorLeaseSec : 120;
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
    // The EVENT LOG ring (docs/38 §15.2). Field name kept `recentFires` for
    // wire compat; entries are { kind:'fire'|'lifecycle', cueId?, label,
    // reason, source, atMs }. 'fire' = a cue application; 'lifecycle' = a
    // plan/mode transition (activate, resume, autopilot toggle,
    // takeover/lease, program end, pending-program lease). In-memory only
    // (never persisted) — matches the pre-existing recentFires behavior.
    this.recentFires = [];
    this.wouldFire = [];        // ring of mood-suppressed { cueId, reason, atMs }
    this.sunCache = { dayKey: null, events: null };
    this._tickHandle = null;
    this._ticking = false;      // re-entrancy guard for the async tick
    // Tracks whether the engine's BASELINE autopilot is currently armed, so the
    // per-tick reconcile (_reconcileBaselineArm) only flips it on a controller
    // transition. Flipping every tick would reset the autopilot delay timer and
    // the deck would never advance.
    this._baselineArmed = false;
    // ── default-cue / durationMin bookkeeping (docs/38 §16.11) ───────────────
    // A cue with `durationMin` OWNS the deck for [fireTime, fireTime+durationMin).
    // While a window is open the default cue must NOT fill the deck. These are
    // in-memory runtime (never persisted): a restart re-derives ownership from
    // the plan + wall-clock in catchUp.
    this._deckWindowUntilMs = null;  // epoch ms the current durationMin window ends (or null)
    this._deckWindowCueId = null;    // the cue that owns the window
    this._defaultCueActive = false;  // the default cue currently drives the deck (idempotency latch)
    // F4 (docs/38 §16.11): a default cue whose apply THREW must not retry every
    // tick (log spam). Latch the failed signature (plan + defaultCue action);
    // back off until the plan/cue changes. null → no failure latched.
    this._defaultCueFailKey = null;
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
    // The plan coming alive on boot/scene-switch is a lifecycle event — the
    // operator sees WHICH plan the engine woke up driving (docs/38 §15.2).
    this._recordLifecycle(`Plan activated: ${this.activePlan}`, 'boot', { source: 'auto' });
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
    // Load STATE FIRST: the operator's last plan ACTIVATION is persisted state
    // and must survive a restart (bug 2026-07-02: the plan file was loaded off
    // the CONFIG default before state was read, so a reboot silently reverted
    // to the config plan's CONTENT while getState still REPORTED the persisted
    // activePlan name — cues/window/autopilot all came from the wrong plan).
    this.state = loadTimelineState(this.stateDir);
    if (this.state.activePlan && this.state.activePlan !== this.activePlan) {
      if (fs.existsSync(this._planPath(this.state.activePlan))) {
        this.activePlan = this.state.activePlan;
      } else {
        // The persisted plan's file is gone (deleted outside activatePlan's
        // guard). Fail LOUD, then boot the config plan and repair the state
        // name so what we report always matches what we run.
        console.error(`  ⚠ [timeline] persisted active plan "${this.state.activePlan}" has no file — booting config plan "${this.activePlan}"`);
        this.state.activePlan = this.activePlan;
      }
    }
    const planPath = this._planPath(this.activePlan);
    if (!fs.existsSync(planPath)) {
      // A fresh scene must be runnable — write the default plan (the only
      // file-creation path; matches the old companion's loadSceneFiles).
      saveShowPlan(defaultShowPlan(), planPath);
      console.log(`  📝 [timeline] wrote default plan → ${planPath}`);
    }
    this.plan = loadShowPlan(planPath);
    if (!this.state.activePlan) this.state.activePlan = this.activePlan;
    // Seed the runtime autopilot toggle from the plan's baseline only when the
    // state predates the §14 model. Once toggled, the runtime value wins.
    if (this.state.autopilotEnabled === undefined) this.state.autopilotEnabled = this.plan.autopilot.enabled;
    if (this.state.activeProgram === undefined) this.state.activeProgram = null;
    if (this.state.pendingProgram === undefined) this.state.pendingProgram = null;
    if (this.state.operatorLease === undefined) this.state.operatorLease = null;
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

  // Patch the deck transition-config (mode/duration/enabled) before a deck
  // playlist swap so the load animates in the authored style (docs/38 §16.9). A
  // requested transition implies the operator wants the soft swap → default
  // `enabled:true` when the cue didn't say otherwise. FAIL LOUD if the dep is
  // missing (codex P0 — never silently drop an authored transition).
  async _applyDeckTransition(transition, steps) {
    if (typeof this.deps.setDeckTransition !== 'function') {
      throw new Error('setDeckTransition dep is required to apply a deck transition');
    }
    const patch = { mode: transition.mode, enabled: transition.enabled !== undefined ? transition.enabled : true };
    if (transition.durationMs !== undefined) patch.durationMs = transition.durationMs;
    if (transition.shuffle !== undefined) patch.shuffle = !!transition.shuffle;
    await this.deps.setDeckTransition(patch);
    steps.push(`deck ← transition ${JSON.stringify(patch)}`);
  }

  // Enable (honor the deck's configured overlays) or disable ALL deck overlays
  // (docs/38 §16.9). FAIL LOUD if the dep is missing.
  async _applyDeckOverlays(mode, steps) {
    if (typeof this.deps.setDeckOverlaysEnabled !== 'function') {
      throw new Error('setDeckOverlaysEnabled dep is required to apply deck overlays');
    }
    const enabled = mode === 'enable';
    await this.deps.setDeckOverlaysEnabled(enabled);
    steps.push(`deck overlays ← ${enabled ? 'enabled' : 'disabled'}`);
  }

  // Configure + (re)start / stop the engine's COLOR autopilot (palette cycling)
  // from a deck playlist cue (docs/39). active:true → start cycling the given
  // palette set on the delay/shuffle; active:false → stop. FAIL LOUD if the dep
  // is missing (codex P0 — never silently drop an authored colorAutopilot).
  async _applyColorAutopilot(colorAutopilot, steps) {
    if (typeof this.deps.setColorAutopilot !== 'function') {
      throw new Error('setColorAutopilot dep is required to apply a cue colorAutopilot');
    }
    await this.deps.setColorAutopilot(colorAutopilot);
    steps.push(`deck ← colorAutopilot ${JSON.stringify(colorAutopilot)}`);
  }

  // Apply the DECK CHANNEL's per-channel hue (degrees, already normalized
  // [0,360) by show_plan.js) from a deck playlist cue. Routes through the same
  // internal path the operator's deck hue slider uses (PATCH /deck/channel
  // { hue }). Hue is PER-CHANNEL ONLY — the global shifter was removed
  // (2026-07). FAIL LOUD if the dep is missing (codex P0 — never silently
  // drop an authored hue).
  async _applyHue(hue, steps) {
    if (typeof this.deps.setDeckHue !== 'function') {
      throw new Error('setDeckHue dep is required to apply a cue hue');
    }
    await this.deps.setDeckHue(hue);
    steps.push(`deck ← hue ${hue}`);
  }

  // Pin engine output to the deck through the EXISTING viewOverride machinery
  // (docs/38 §16.9). The plan OWNS the deck-pin while it drives the deck; an
  // operator view-change off deck is what arms the operator-takeover lease
  // (wired in api_server's /mixer/view-override route). FAIL LOUD if missing.
  async _forceDeckView(steps) {
    // FESTIVAL-WINDOW GATE (docs/38 §15.2): the plan's soft deck-pin (and the
    // yellow 'plan' controlLock it raises) engages ONLY while the plan is in
    // time. Out of window the plan may still drive the deck's content
    // (baseline/cues load + autopilot), but it must NOT pin the view / raise the
    // lock — so CaptainPad keeps full deck/mixer control. A no-op out of window;
    // _reconcileDeckPin releases any pin that predates leaving the window.
    if (!this._inFestivalWindow()) return;
    // TAKEOVER GATE (audit M7 2026-07-02): a cue dispatch that was in-flight
    // when the operator took over must not re-pin the deck out from under them
    // — the tail of an awaited apply used to snap the view back and re-raise the
    // lock for up to a tick. Mode is set synchronously by takeover(), so this
    // gate is race-safe.
    if (this.state.mode === 'overridden') return;
    if (typeof this.deps.forceDeckView !== 'function') {
      throw new Error('forceDeckView dep is required to pin output to the deck');
    }
    await this.deps.forceDeckView();
    if (steps) steps.push('output ← deck (view pinned)');
  }

  // Release the plan's soft deck-pin through the EXISTING viewOverride machinery
  // (docs/38 §16.9). The counterpart to _forceDeckView: called on EVERY
  // transition where the plan stops driving the deck (takeover / autopilot
  // off / deactivate) so the yellow "PLAN IS RUNNING" soft-lock clears and
  // CaptainPad regains the deck/mixer (its gating keys off controlLock==='plan').
  // The engine dep only clears a 'plan'-owned pin — a real PortWatch device lock
  // is left untouched (codex P0: never yank a hardware lock). FAIL LOUD if the
  // dep is missing (never silently leave the deck stranded under the plan pin).
  async _releaseDeckView(steps) {
    if (typeof this.deps.releaseDeckView !== 'function') {
      throw new Error('releaseDeckView dep is required to release the plan deck-pin');
    }
    // CONFIRMED BEHAVIOR (operator request): releasing the plan's deck-pin ONLY
    // clears the soft 'plan' controlLock — it does NOT restore or overwrite the
    // deck's params/pattern. When the plan is disabled/paused the deck is LEFT
    // EXACTLY WHERE THE PLAN LAST SET IT (no revert to a "last known good"
    // snapshot). This is intentional: no param restore on release.
    //
    // TODO (optional, NOT implemented — operator deemed it not worth the added
    // state/complexity): an OPTIONAL future feature could "restore the deck to a
    // last-known-good snapshot captured before the plan took over". That would
    // mean capture-on-takeover (snapshot the deck pattern/params the first time
    // the plan seizes the deck) + restore-on-release (re-apply that snapshot
    // here when the plan hands the deck back). Deliberately left out for now.
    await this.deps.releaseDeckView();
    if (steps) steps.push('output ← released (deck pin cleared)');
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

  // Write a CPC globals map, routing the special `master` key to the DECK GRAND
  // MASTER (the SAME mixer.setMaster path the operator's PATCH /mixer { master }
  // uses) instead of a dead CPC param, and every other key to the CPC via
  // deps.setParams. This UNIFIES a cue's `master` global with the operator's own
  // master control (Task 1): before this, a look/globals `master` wrote an
  // UNREGISTERED CPC key that nothing reads — a silent no-op, so the deck's
  // brightness never changed (a "separate route" from the operator's master
  // fader). FAIL LOUD if a master is authored but the setMaster dep is missing
  // (codex P0 — never silently drop an authored global). Emits ONE step under
  // `label` describing the whole globals map.
  async _writeGlobals(globals, steps, label) {
    const rest = {};
    let hasMaster = false;
    let masterVal;
    for (const [k, v] of Object.entries(globals)) {
      if (k === 'master') { hasMaster = true; masterVal = v; } else rest[k] = v;
    }
    if (Object.keys(rest).length > 0) await this.deps.setParams(rest);
    if (hasMaster) {
      if (typeof this.deps.setMaster !== 'function') {
        throw new Error('setMaster dep is required to apply a master global');
      }
      await this.deps.setMaster(masterVal);
    }
    steps.push(`${label} ${JSON.stringify(globals)}`);
  }

  // Execute a 'look' bundle: palette → globals → playlist → autopilot → tasks.
  async _applyLook(look, name, steps) {
    if (look.palette) {
      await this.deps.setParams(this._resolvePalette(look.palette));
      steps.push(`look "${name}" palette "${look.palette}"`);
    }
    if (look.globals) {
      await this._writeGlobals(look.globals, steps, `look "${name}" globals`);
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
    this._baselineArmed = true;
    // The plan is active and reconciling its DECK baseline → pin output to the
    // deck (docs/38 §16.9). Only when the baseline actually drives the deck; a
    // mixer-only baseline leaves the operator's view choice alone.
    if (targets.some((t) => t.kind === 'deck')) await this._forceDeckView(steps);
    return { steps };
  }

  /** Execute one validated cue action object. Returns { steps }. THROWS loud. */
  async _applyAction(action) {
    if (!action || typeof action !== 'object') throw new Error('applyAction: action must be an object');
    const steps = [];
    switch (action.type) {
      case 'playlist': {
        const targets = await this._resolveTargets(action.target);
        const onDeck = targets.some((t) => t.kind === 'deck');
        // Deck transition + overlays are validated DECK-ONLY (show_plan.js), so
        // they only ever apply when a deck target is in play. Configure the
        // transition BEFORE the load so the swap that loads the playlist uses
        // the requested style/duration (docs/38 §16.9).
        if (action.transition && onDeck) await this._applyDeckTransition(action.transition, steps);
        for (const target of targets) await this._loadPlaylistOnTarget(target, action.name, steps);
        if (action.overlays && onDeck) await this._applyDeckOverlays(action.overlays, steps);
        if (action.autopilot) {
          for (const target of targets) await this._setAutopilotOnTarget(target, action.autopilot, steps);
        }
        // colorAutopilot is validated DECK-ONLY (show_plan.js) → only when a deck
        // target is in play. Configure the palette-cycling daemon alongside the
        // pattern autopilot (docs/39): they run in parallel.
        if (action.colorAutopilot && onDeck) await this._applyColorAutopilot(action.colorAutopilot, steps);
        // hue is validated DECK-ONLY (show_plan.js) → only when a deck target
        // is in play. Applies the DECK CHANNEL's per-channel hue alongside
        // the deck swap (per-channel only — no global shifter).
        if (action.hue !== undefined && onDeck) await this._applyHue(action.hue, steps);
        // globals (SPEED/SIZE/bpmSpeedSync) — validated DECK-ONLY (show_plan.js).
        // Routes through _writeGlobals → setParams, exactly like a look's globals.
        if (action.globals && onDeck) await this._writeGlobals(action.globals, steps, 'cue globals');
        // The plan is driving the DECK → pin engine output to the deck (docs/38
        // §16.9). Reuses the existing viewOverride machinery via the injected dep.
        if (onDeck) await this._forceDeckView(steps);
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
        await this._writeGlobals(action.set, steps, 'globals');
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

  // ── default cue + durationMin (docs/38 §16.11) ────────────────────────────

  // Does this cue ACTION drive the DECK? A cue owns the deck window only when its
  // action lands on the deck (channel 'deck' or 'all'). Resolves the target the
  // same way _resolveTargets does, including a 'look' action's own look.target.
  async _actionDrivesDeck(action) {
    if (!action || typeof action !== 'object') return false;
    if (action.type === 'look') {
      const look = this.plan && this.plan.looks ? this.plan.looks[action.look] : undefined;
      if (!look) return false;
      const targets = await this._resolveTargets(look.target);
      return targets.some((t) => t.kind === 'deck');
    }
    // scene / tasks / effect never target a deck channel; playlist/globals do.
    if (action.type !== 'playlist' && action.type !== 'globals') return false;
    const targets = await this._resolveTargets(action.target);
    return targets.some((t) => t.kind === 'deck');
  }

  // Open the deck-OWNERSHIP latch for a cue that just fired (docs/38 §16.11).
  // A deck-driving cue always takes OWNERSHIP of the deck from the previous
  // owner (`_deckWindowCueId` = this cue). With `durationMin` it owns for a
  // TIMED window [now, now+durationMin) (`_deckWindowUntilMs` set); without one
  // it owns with NO expiry (`_deckWindowUntilMs=null` → "holds until the next
  // deck cue"). EITHER WAY the default cue must NOT fill under a live owner
  // (F1 fix: a no-duration mood/ambient swap must not be clobbered every tick).
  // A non-deck cue leaves ownership untouched. Firing any deck cue clears the
  // default-cue latch (the real cue now owns the deck).
  async _noteDeckWindow(cueId, durationMin, action, now) {
    const drivesDeck = await this._actionDrivesDeck(action);
    if (!drivesDeck) return;
    this._defaultCueActive = false;
    this._deckWindowCueId = cueId;
    if (typeof durationMin === 'number' && durationMin > 0) {
      this._deckWindowUntilMs = now + durationMin * 60000;
    } else {
      // No durationMin → the cue owns the deck with no timed window (until the
      // next deck cue). Ownership latch (_deckWindowCueId) above keeps the
      // default cue from filling under it.
      this._deckWindowUntilMs = null;
    }
  }

  // Apply the plan-level DEFAULT CUE to the deck (docs/38 §16.11): the fallback
  // the rig reverts to in a gap between owning cue windows, and when the plan has
  // no owning cues. Dispatches defaultCue.action through the SAME apply path (so
  // it pins the deck via _forceDeckView like any deck cue and is subject to the
  // P1 release logic). Sets the idempotency latch so the tick does not re-apply
  // it every second. THROWS loud on a dep failure (recorded by the caller).
  // The failure-latch signature for the CURRENT default cue (F4). Keyed on the
  // active plan + the defaultCue action so ANY plan/cue change clears the latch
  // and re-attempts the apply. Returns null when there is no default cue.
  _defaultCueKey() {
    const dc = this.plan && this.plan.defaultCue ? this.plan.defaultCue : null;
    if (!dc) return null;
    return `${this.activePlan}::${JSON.stringify(dc.action)}`;
  }

  async _applyDefaultCue(reason) {
    const dc = this.plan && this.plan.defaultCue ? this.plan.defaultCue : null;
    if (!dc) return { steps: [] };
    let result;
    try {
      result = await this._applyAction(dc.action);
    } catch (e) {
      // F4: a throwing default cue must NOT retry every tick (log spam). Latch
      // the failed signature and surface the error LOUDLY ONCE — never swallow
      // it (codex P0: no silent fallback). The latch clears when the plan/cue
      // changes (_defaultCueKey mismatch) so a fixed plan re-attempts.
      this.lastError = `default cue (${reason}): ${e && e.message}`;
      if (this._defaultCueFailKey !== this._defaultCueKey()) {
        console.warn(`  ⚠ [timeline] default cue (${reason}) failed — backing off: ${e && e.message}`);
        this._defaultCueFailKey = this._defaultCueKey();
      }
      // Mark the latch so the tick does not re-enter the apply every second.
      this._defaultCueActive = true;
      throw e;
    }
    // Success → clear any prior failure latch (a fixed/changed cue recovered).
    this._defaultCueFailKey = null;
    this._defaultCueActive = true;
    this._deckWindowUntilMs = null;
    this._deckWindowCueId = null;
    // The default cue is now the deck's baseline driver — mark the baseline as
    // armed so _reconcileBaselineArm does NOT reload plan.autopilot.playlist on
    // top of it (docs/38 §16.11: defaultCue REPLACES the autopilot baseline as
    // the deck fill when authored). A later disarm (pause/program) flips this off.
    this._baselineArmed = true;
    // The default cue is an AUTOMATIC deck application — record it in the event
    // log too (docs/38 §16.11). It is not a plan cue (no id/trigger), so use a
    // synthetic id + its authored label (or a readable default). source:'default'
    // lets the UI style/group it distinctly from a scheduled cue.
    this._recordFire('__default_cue__', reason, 'default', dc.label || 'Default cue');
    console.log(`  🎯 [timeline] default cue applied (${reason}): ${result.steps.join('; ')}`);
    return result;
  }

  // Reconcile the DEFAULT CUE against the deck-ownership window (docs/38 §16.11).
  // When the plan is driving the deck under AUTOPILOT (not a held program) and no
  // cue currently owns the deck window, the default cue fills the deck:
  //   • window elapsed (durationMin ran out) with no new owner → revert to default;
  //   • plan has cues but none currently own the deck → default fills the gap;
  //   • plan has no owning cues at all → default drives the deck.
  // Only runs when defaultCue is authored; absent → the autopilot baseline stands
  // (no regression). Never overrides a held program (controller 'program') or a
  // manual/paused operator. Idempotent via _defaultCueActive.
  async _reconcileDefaultCue(now) {
    const dc = this.plan && this.plan.defaultCue ? this.plan.defaultCue : null;
    if (!dc) return;                                  // no default cue → baseline stands
    if (!this._isPlanDrivingDeck()) return;           // manual/paused → operator owns the deck
    // A live durationMin window still owns the deck → do not fill.
    if (typeof this._deckWindowUntilMs === 'number' && this._deckWindowUntilMs > now) return;
    // A no-duration deck cue OWNS the deck until the next deck cue (F1 fix): its
    // ownership latch is a cueId with a null window. The default cue must NOT
    // fill under it — a mood/ambient swap holds the deck exactly like today's
    // no-hold program behavior. Only a durationMin window that has ELAPSED
    // (untilMs set and now past it) yields the deck below.
    const hasElapsedWindow = typeof this._deckWindowUntilMs === 'number' && this._deckWindowUntilMs <= now;
    if (this._deckWindowCueId !== null && !hasElapsedWindow && !this._defaultCueActive) {
      return; // a live no-duration deck cue owns the deck → do not fill under it
    }
    // A HELD program (an explicit hold window still in the future) owns the deck
    // and its precedence — the default cue never preempts it (durationMin governs
    // the deck-fill window; hold governs program precedence — docs/38 §16.11). A
    // program whose durationMin window has elapsed with no live hold DOES yield to
    // the default cue: end it so the arbiter drops back to autopilot + default.
    const prog = this.state.activeProgram;
    if (prog) {
      const heldUntil = prog.untilMs;
      if (typeof heldUntil === 'number' && heldUntil > now) return; // live hold owns the deck
      // No live hold: only end the program when the elapsed window was opened by
      // THIS program's OWN cue (F2 fix). An unrelated cue's elapsed window must
      // NOT be misattributed to this program and force-end it early. A program
      // with no elapsed window of its own is today's "holds until next cue"
      // behavior — the default cue does not fill under it (no regression).
      if (this._deckWindowCueId === prog.cueId && hasElapsedWindow) {
        this.state.activeProgram = null;
        if (this.state.autopilotEnabled !== false) this.state.controller = 'autopilot';
        // A program force-ended by its own elapsed durationMin window is a
        // lifecycle transition (docs/38 §15.2) — logged HERE (not the tick's
        // arbiter diff, which only sees hold expiry). One-shot: activeProgram
        // is null from now on, so this branch can't re-enter.
        this._recordLifecycle(
          `Program ended (window elapsed): ${this._cueLabelFor(prog.cueId)}`,
          'window-elapsed', { cueId: prog.cueId, source: 'auto' },
        );
      } else {
        return;
      }
    }
    // An elapsed durationMin window → revert to the default cue.
    if (hasElapsedWindow) {
      await this._applyDefaultCue('window-elapsed');
      return;
    }
    // No owning cue at all → fill the deck with the default cue (plan has no cue
    // driving the deck right now). Idempotent: only apply once.
    if (!this._defaultCueActive) {
      await this._applyDefaultCue('no-owning-cue');
    }
  }

  // ── dispatch (ported from timeline_server.js) ─────────────────────────────

  // Look up a cue's operator-facing label from the active plan (falls back to
  // the id, which is always present). Used to enrich a recentFires entry so the
  // event log can show the human label, not just the slug.
  _cueLabelFor(cueId) {
    const cue = this.plan && Array.isArray(this.plan.cues)
      ? this.plan.cues.find((c) => c.id === cueId) : null;
    return cue ? cueLabel(cue) : cueId;
  }

  // Append ONE entry to the recentFires ring (docs/38 §15.2 event log). EVERY
  // application of a cue on the deck/mixer — MANUAL (fireCue) AND AUTOMATIC
  // (scheduled clock/sun/mood, program auto-start, catchUp, default cue) — flows
  // through here so the CaptainPad "RECENT FIRES" log records the automatic
  // starts too (operator: the auto-start of a cue was not landing in the log).
  //   cueId    — the cue id (or a synthetic id like '__default_cue__' / a resume)
  //   reason   — the fine-grained trigger reason the UI renders ('manual',
  //              'catchUp', 'clock', 'sun', 'mood', 'resume', 'lease-enable',
  //              'window-elapsed', …). Preserved verbatim (the UI reads it).
  //   source   — a COARSE category the UI can group/filter on: 'manual' | 'auto'
  //              | 'catchUp' | 'default'. Defaults to 'auto' (any non-manual,
  //              non-catchUp application is automatic).
  //   label    — resolved operator-facing label (defaults to the cue's label).
  _recordFire(cueId, reason, source, label) {
    this.recentFires.push({
      kind: 'fire',
      cueId,
      atMs: this.nowFn(),
      reason,
      source: source || 'auto',
      label: label !== undefined ? label : this._cueLabelFor(cueId),
    });
    if (this.recentFires.length > RECENT_MAX) this.recentFires.shift();
  }

  // Append ONE LIFECYCLE entry to the SAME ring (docs/38 §15.2 event log):
  // plan/mode/controller transitions rather than cue applications — plan
  // activated, paused/resumed, hold armed/expired, autopilot toggled, operator
  // takeover/lease release, program ended, pending-program lease armed /
  // auto-started / dismissed. Same wire shape as a fire entry, kind:'lifecycle'.
  // EDGE-ONLY BY CONTRACT: every caller must log a TRANSITION, never a steady
  // state — a reconcile loop must not funnel through here per tick.
  //   label  — the operator-facing line the UI renders ('Timeline paused', …)
  //   reason — machine-ish transition tag ('pause', 'hold-expired', …)
  //   source — 'manual' (operator-initiated) | 'auto' (engine-initiated)
  //   cueId  — optional related cue (program/lease events); null otherwise
  _recordLifecycle(label, reason, { cueId, source } = {}) {
    this.recentFires.push({
      kind: 'lifecycle',
      cueId: cueId !== undefined ? cueId : null,
      atMs: this.nowFn(),
      reason,
      source: source || 'auto',
      label,
    });
    if (this.recentFires.length > RECENT_MAX) this.recentFires.shift();
  }

  async _dispatchCue(cueId, reason) {
    const cue = this.plan.cues.find((c) => c.id === cueId);
    if (!cue) throw new Error(`cue "${cueId}" not in active plan`);
    const result = await this._applyAction(cue.action);
    // Open/clear the deck-ownership window for the default-cue fallback (§16.11).
    await this._noteDeckWindow(cue.id, cue.durationMin, cue.action, this.nowFn());
    delete this.cueErrors[cueId];
    this.state.lastFiredCueId = cueId;
    this.state.lastFiredAtMs = this.nowFn();
    // _dispatchCue is the boot catchUp path — record it as source 'catchUp' so
    // the log distinguishes a restored cue from a live automatic fire.
    this._recordFire(cueId, reason, reason === 'catchUp' ? 'catchUp' : 'auto');
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
    this._baselineArmed = false;
  }

  // Re-arm the baseline autopilot WITHOUT reloading the playlist — so resuming
  // from a takeover continues cycling from the CURRENT entry rather than
  // jumping back to the first. (_applyAutopilotBaseline reloads; this doesn't.)
  async _rearmBaselineAutopilot() {
    const ap = this.plan && this.plan.autopilot ? this.plan.autopilot : null;
    if (!ap) return;
    const targets = await this._resolveTargets(ap.target);
    const state = { active: true, delay_s: ap.delay_s, shuffle: ap.shuffle };
    for (const target of targets) await this.deps.setAutopilot({ target, state });
    this._baselineArmed = true;
    // Resuming the deck baseline (takeover → armed) re-pins output to the deck
    // (docs/38 §16.9) so a stale operator view doesn't leave the plan running off-screen.
    if (targets.some((t) => t.kind === 'deck')) await this._forceDeckView(null);
  }

  // Keep the engine baseline autopilot armed IFF the controller is 'autopilot'.
  // This is what makes a takeover actually FREEZE deck cycling and resume it —
  // uniformly, in one place. Acts only on a transition (the _baselineArmed
  // flag), never every tick (which would reset the autopilot delay). Touches
  // only the baseline's target(s); independent operator-armed overlays on other
  // channels are left alone (docs/38 §16 I5, per-channel).
  async _reconcileBaselineArm() {
    const ap = this.plan && this.plan.autopilot ? this.plan.autopilot : null;
    if (!ap) return;   // no baseline target to act on
    // `controller` already encodes the runtime autopilot toggle + takeover +
    // program, so it is the single source of truth for "should the baseline run".
    const want = this.state.controller === 'autopilot';
    if (want === this._baselineArmed) return;
    if (want) await this._rearmBaselineAutopilot();
    else await this._disarmBaselineAutopilot();
  }

  // Whether the plan is "in time" — TODAY falls inside its festival span
  // (docs/38 §15.2). A plan with NO festival block is a recurring-nightly plan
  // and is ALWAYS in window (it locks every night). A plan WITH a festival span
  // is in window only on days [startDate, startDate+days-1] in the plan's tz;
  // outside the span the plan must NOT soft-pin the deck / raise the 'plan'
  // controlLock (operator: the yellow "PLAN IS RUNNING" lock should engage only
  // while the plan is in time). Uses the injected clock — never Date.now().
  _inFestivalWindow() {
    if (!this.plan || !this.plan.festival) return true; // no festival → always locks
    return festivalDayIndex(this.plan, this.nowFn()) !== null;
  }

  // True when the plan is currently DRIVING the rig (docs/38 §16). Mirrors the
  // `planActive` computed in getState(): autopilot-or-program controller, not
  // overridden (operator takeover), AND in the festival window. When false the
  // plan owns nothing and its soft deck-pin must be released.
  //
  // The festival-window term is the SAME isolation gate as everywhere else
  // (operator request 2026-07-03): out of its scheduled days the plan drives
  // nothing, so it never "drives the deck" for pin/lock purposes.
  _isPlanDrivingDeck() {
    const controller = this.state.controller || 'autopilot';
    return (controller === 'autopilot' || controller === 'program')
      && this.state.mode !== 'overridden'
      && this._inFestivalWindow();
  }

  // FESTIVAL-WINDOW ISOLATION (operator request 2026-07-03): go fully DORMANT.
  // Out of the plan's scheduled days the plan must affect NOTHING — no autopilot
  // baseline cycling the deck, no cue fires, no deck-pin / 'plan' lock, no
  // takeover. The ONLY out-of-window signal is the timeline tab's "not in time"
  // note (getState.inFestivalWindow=false). This tears down everything the plan
  // might own and hands the whole rig back to the operator. Idempotent + cheap
  // at steady state (the disarm is _baselineArmed-gated; the pin release early-
  // returns when nothing is pinned; the state writes are all no-ops once set).
  async _goDormant() {
    // Never resume stale runtime driving/manual state out of window.
    this.state.activeProgram = null;
    this.state.pendingProgram = null;
    this.state.operatorLease = null;
    if (this.state.mode === 'overridden') this.state.mode = 'armed';
    this.state.controller = 'manual';
    this._deckWindowUntilMs = null;
    this._deckWindowCueId = null;
    this._defaultCueActive = false;
    // Stop the plan's baseline autopilot from cycling the deck.
    if (this._baselineArmed) {
      try {
        await this._disarmBaselineAutopilot();
      } catch (e) {
        this.lastError = `dormant disarm: ${e && e.message}`;
      }
    }
    // Release the plan's soft deck-pin so the yellow 'plan' lock clears. Out of
    // window _isPlanDrivingDeck() is false, so this takes the release branch.
    try {
      await this._reconcileDeckPin();
    } catch (e) {
      this.lastError = `dormant deck-pin: ${e && e.message}`;
    }
  }

  // Reconcile the plan's SOFT deck-pin against whether the plan is still driving
  // the deck (docs/38 §16.9). The symmetric counterpart to the forceDeckView
  // calls scattered through the apply/baseline paths: whenever the plan STOPS
  // driving (takeover / autopilot-off / deactivate), release the pin so the
  // 'plan' controlLock clears and CaptainPad's PlanLockBanner + deck/mixer gating
  // drop automatically. The engine dep only clears a 'plan'-owned pin, so a real
  // PortWatch hardware lock is left untouched. Idempotent (release is a no-op
  // when nothing is pinned by the plan). Re-pinning on resume/arm is handled by
  // the existing _forceDeckView calls in the apply/baseline paths.
  async _reconcileDeckPin() {
    // A plan that is out of its festival window is treated exactly like a
    // non-driving plan for the purpose of the deck-pin: release the pin so the
    // 'plan' controlLock clears even while the plan is armed + driving content
    // (docs/38 §15.2). In window, keep the pin iff the plan is driving.
    if (this._isPlanDrivingDeck() && this._inFestivalWindow()) {
      // RE-PIN (audit H2/H3 2026-07-02): the apply/baseline paths only pin on
      // TRANSITIONS, so two steady-state cases used to leave a driving,
      // in-window plan unpinned indefinitely (controlLock null, deck/mixer
      // unlocked while the plan drives): (a) the festival window OPENING at
      // midnight with the baseline already armed, and (b) a PortWatch hard
      // lock releasing back to a still-driving plan. This tick-side re-pin
      // heals both within one tick. A no-op while ANYTHING already pins the
      // deck — including a PortWatch hard lock, which is never downgraded.
      if (typeof this.deps.getViewOverrideMode === 'function'
          && this.deps.getViewOverrideMode() !== 'deck') {
        await this._forceDeckView(null);
      }
      return;
    }
    await this._releaseDeckView(null);
  }

  async _dispatchArbitratedAction(act, reason) {
    if (act.autopilotOff) {
      await this._disarmBaselineAutopilot();
    }
    if (act.action && act.action.type === '__resume_autopilot__') {
      const result = await this._applyAutopilotBaseline();
      // Autopilot-resume is a synthetic cue id — give it a readable label so the
      // event log shows "Autopilot resumed" rather than the raw sentinel id.
      this._recordFire(act.cueId, 'resume', reason === 'manual' ? 'manual' : 'auto', 'Autopilot resumed');
      return result;
    }
    const cue = this.plan.cues.find((c) => c.id === act.cueId);
    if (!cue) throw new Error(`cue "${act.cueId}" not in active plan`);
    const result = await this._applyAction(act.action);
    // Open/clear the deck-ownership window for the default-cue fallback (§16.11).
    // durationMin comes from the plan cue; the action is the one actually applied.
    await this._noteDeckWindow(cue.id, cue.durationMin, act.action, this.nowFn());
    delete this.cueErrors[act.cueId];
    this.state.lastFiredCueId = act.cueId;
    this.state.lastFiredAtMs = this.nowFn();
    // Source is MANUAL only when this dispatch came from fireCue ('manual');
    // every other reason (scheduled clock/sun, mood, lease-enable, auto) is an
    // AUTOMATIC application and must still land in the recentFires log so the
    // operator sees the auto-start of the cue.
    this._recordFire(act.cueId, reason, reason === 'manual' ? 'manual' : 'auto');
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
    // FESTIVAL-WINDOW ISOLATION (operator request 2026-07-03): out of window the
    // plan never establishes an autopilot baseline (this is the gate for
    // boot/operator-AUTO-ON/program-end). Leaves the deck to the operator; the
    // baseline arms only once the plan is in time.
    if (!this._inFestivalWindow()) { this.state.controller = 'manual'; return; }
    if (this.state.autopilotEnabled === false) {
      this.state.controller = 'manual';
      return;
    }
    if (this.state.mode === 'overridden') { this.state.controller = 'manual'; return; }
    try {
      await this._establishAutopilotBaseline(reason);
      this.state.controller = 'autopilot';
      // §16.11: with a plan-level defaultCue authored, the deck runs the default
      // cue whenever no cue currently owns the deck. Apply it now (idempotent)
      // so an empty-cues plan (or a boot into a gap) shows the default cue on the
      // deck immediately, not only after the first reconcile tick. Absent →
      // the autopilot baseline just established stands (no regression).
      if (this.plan && this.plan.defaultCue
          && !(typeof this._deckWindowUntilMs === 'number' && this._deckWindowUntilMs > now)) {
        await this._applyDefaultCue(reason);
      }
    } catch (e) {
      this.bootError = `autopilot baseline (${reason}): ${e && e.message}`;
      console.warn(`  ⚠ [timeline] autopilot baseline (${reason}) failed: ${e && e.message}`);
    }
  }

  // ── catchUp on boot (ported from timeline_server.js catchUp) ──────────────

  async _catchUp() {
    const now = this.nowFn();
    // RESUME / lease-release FULL RESET (Task 3, docs/38 §16): capture the cue
    // that OWNS the deck window BEFORE any dispatch below reassigns it. On a
    // resume() / operator-lease release this is the plan cue whose COMPLETE
    // action must be re-applied so ANY operator change made during the takeover
    // is overwritten back to the plan's authored cue (playlist+entry, params,
    // palette/global color, colorAutopilot, pattern autopilot, transitions,
    // overlays). On BOOT it is null (fresh runtime) → nothing to re-apply.
    const priorDeckWindowCueId = this._deckWindowCueId;
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
    // A pendingProgram lease is ALSO pure runtime state — drop any persisted one
    // on boot/scene-switch and re-derive (docs/38 §16.6/I6). A stale lease whose
    // expiry already passed would otherwise auto-start the wrong program.
    this.state.pendingProgram = null;
    // An operatorLease is ALSO pure runtime state — drop any persisted one on
    // boot/scene-switch (docs/38 §16/I6). Never resume a stale operator lease;
    // catchUp re-establishes the correct owner for the current wall-clock.
    this.state.operatorLease = null;
    // …and dropping the lease MUST also exit 'overridden' (bug 2026-07-02):
    // a persisted mode 'overridden' with its lease nulled was a permanent trap
    // — the tick's lease-release used to require a lease, so the mode never
    // cleared, CaptainPad read leaseHeld=true forever, and the deck/mixer
    // never re-locked under an armed plan. takeover() always arms mode+lease
    // together, so an 'overridden' without a lease is by definition orphaned.
    if (this.state.mode === 'overridden') this.state.mode = 'armed';

    // FESTIVAL-WINDOW ISOLATION (operator request 2026-07-03): out of window the
    // plan is dormant — do NOT restore/fire any cue and do NOT establish the
    // autopilot baseline on boot/activate/resume. Tear down anything owned and
    // return; the plan wakes on the first in-window tick.
    if (!this._inFestivalWindow()) {
      await this._goDormant();
      saveTimelineState(this.state, this.stateDir);
      this.lastStateJson = JSON.stringify(this.state);
      return;
    }

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
        // §16.11: _dispatchCue opened the deck window at `now`, but a caught-up
        // cue actually fired in the PAST (best.fireMs). Re-anchor the window to
        // its true start so an already-elapsed durationMin lets the default cue
        // fill the gap immediately rather than granting a fresh full window.
        if (this._deckWindowCueId === best.cue.id
            && typeof best.cue.durationMin === 'number' && best.cue.durationMin > 0) {
          this._deckWindowUntilMs = best.fireMs + best.cue.durationMin * 60000;
        }
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

    // RESUME / lease-release FULL RESET (Task 3, docs/38 §16). Re-apply the
    // COMPLETE action of the cue that OWNED the deck window before this catchUp,
    // so ANY operator change made during a takeover (pattern, params, palette,
    // colorAutopilot, autopilot, transitions, overlays) is overwritten back to
    // the plan's authored cue. The clock/sun `best` selection above only
    // restores program/look cues that have a SCHEDULABLE trigger; a mood /
    // phase / ambient / manual cue that owned the deck is otherwise LOST on
    // resume (the deck fell back to the autopilot baseline). Re-dispatch it
    // explicitly here. Skipped on boot (priorDeckWindowCueId is null), when
    // `best` / the caught-up program already restored the SAME cue, when the
    // operator is still overridden, or when it no longer drives the deck.
    if (priorDeckWindowCueId
        && priorDeckWindowCueId !== '__default_cue__'
        && !programCaughtUp
        && !(best && best.cue && best.cue.id === priorDeckWindowCueId)
        && this.state.mode !== 'overridden') {
      const owner = this.plan.cues.find((c) => c.id === priorDeckWindowCueId);
      if (owner && owner.enabled !== false && await this._actionDrivesDeck(owner.action)) {
        try {
          const result = await this._dispatchCue(owner.id, 'resume');
          console.log(`  ⟳ [timeline] resume re-applied deck cue "${owner.id}": ${result.steps.join('; ')}`);
        } catch (e) {
          this.cueErrors[owner.id] = `resume re-apply failed: ${e && e.message}`;
          this.lastError = `resume re-apply "${owner.id}": ${e && e.message}`;
          console.warn(`  ⚠ [timeline] resume re-apply "${owner.id}" failed: ${e && e.message}`);
        }
      }
    }

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

      // FESTIVAL-WINDOW ISOLATION (operator request 2026-07-03) — the EARLIEST
      // gate in the tick. Out of the plan's scheduled days the plan drives
      // NOTHING: skip the whole evaluate/arbitrate/dispatch/baseline machinery
      // and go dormant (disarm baseline, release deck-pin, drop driving state).
      // Nothing below runs, so no cue fires, no lock raises, no takeover arms —
      // only the timeline tab's inFestivalWindow=false note remains.
      if (!this._inFestivalWindow()) {
        await this._goDormant();
        // A scene action inside a dep could have torn the service down.
        if (this._tickHandle === null) return;
        const dormantJson = JSON.stringify(this.state);
        if (dormantJson !== this.lastStateJson) {
          saveTimelineState(this.state, this.stateDir);
          this.lastStateJson = dormantJson;
        }
        this._broadcastState();
        return;
      }

      // Operator-takeover lease auto-release (docs/38 §16): if the operator
      // holds a lease (mode 'overridden') and it has expired with no UI
      // activity, RELEASE it and resume the plan at NOW (catchUp re-derives the
      // correct owner/look for the current wall-clock). This is the
      // "continue the plan at the exact time of release" behavior. After a
      // release the tick falls through to normal ticking on the fresh state.
      //
      // SELF-HEAL (bug 2026-07-02): also release 'overridden' with NO lease.
      // That state is otherwise a PERMANENT trap — _catchUp() nulls a stale
      // persisted lease on boot but used to leave the persisted mode
      // 'overridden' behind, and this release only matched lease-holding
      // states. Result: CaptainPad read leaseHeld=true forever ("TOOK OVER ·
      // RESUMES —" with a 0:00 pill) and the deck/mixer never re-locked even
      // with the plan armed + AUTO ON. An 'overridden' mode without a lease is
      // by definition orphaned (takeover() always arms both together), so
      // release it on the next tick.
      if (this.state.mode === 'overridden'
          && (!this.state.operatorLease || now >= this.state.operatorLease.expiresAtMs)) {
        try {
          await this._releaseOperatorLease();
        } catch (e) {
          this.lastError = `operator lease release: ${e && e.message}`;
          console.warn(`  ⚠ [timeline] operator lease release failed: ${e && e.message}`);
        }
        // A scene action inside catchUp could have torn the service down.
        if (this._tickHandle === null) return;
      }
      // SELF-HEAL (audit C1 2026-07-02), the mirror image: a lease stranded on
      // a NON-'overridden' mode. takeover() is the only lease writer and always
      // sets mode 'overridden' with it, so lease-without-overridden is by
      // definition orphaned (a mode exit that predates the resume/enableProgram
      // clears). activity() won't extend it and the release above won't
      // match it — drop it so CaptainPad's leaseHeld can't wedge true.
      if (this.state.mode !== 'overridden' && this.state.operatorLease) {
        this.state.operatorLease = null;
        console.warn('  🔧 [timeline] dropped an orphaned operator lease (mode was not overridden)');
      }

      const sunEvents = this._sunEventsFor(now);
      // The RUNTIME tick is always "today": build the day's working plan = the
      // full plan with cues restricted to those applicable to today's festival
      // day (docs/38 §15.2). resolveDayTimes / evaluateTick / arbitrate all see
      // only today's cues, so only today's cues fire — multi-day lives in the
      // plan + overview, never the tick.
      const dayPlan = { ...this.plan, cues: applicableCues(this.plan, now) };
      const dayTimes = resolveDayTimes({ plan: dayPlan, now, sunEvents });
      const mood = this.getMood();

      // EVENT-LOG edge captures (docs/38 §15.2): the arbiter is PURE, so its
      // lifecycle transitions (program hold-expiry end, pending-program lease
      // arm / lease auto-start) are detected here by diffing the state around
      // it. Captured BEFORE evaluateTick/arbitrate; compared after. EDGE-ONLY
      // by construction — same-state ticks log nothing.
      const prevProgram = this.state.activeProgram
        ? { cueId: this.state.activeProgram.cueId } : null;
      const prevPendingCueId = this.state.pendingProgram
        ? this.state.pendingProgram.cueId : null;

      const { fires, state: nextState } = evaluateTick({ now, plan: dayPlan, state: this.state, mood, dayTimes });
      this.state = nextState;
      this.state.currentMood = mood.party ? 'party' : 'calm';

      const reasonByCue = new Map(fires.map((f) => [f.cueId, f.reason]));
      const { actions, state: arbState } = arbitrate({
        now, plan: dayPlan, state: this.state, fires, dayTimes, leaseSec: this.programLeaseSec,
      });
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

      // ── lifecycle edges out of the arbiter (docs/38 §15.2, edge-only) ──────
      // Logged BEFORE the dispatch loop so the transition precedes the fire it
      // causes (auto-start lifecycle → program fire; program end → autopilot
      // resume) in the ring's insertion order.
      const pendNow = this.state.pendingProgram;
      // Pending-program lease ARMED: a due program found the deck in manual and
      // armed a countdown lease instead of firing (docs/38 §16.5). cueId edge —
      // a lease re-observed on later ticks (same cue) is never re-logged.
      if (pendNow && pendNow.cueId && pendNow.cueId !== prevPendingCueId) {
        const inSec = Math.max(0, Math.round((pendNow.expiresAtMs - now) / 1000));
        this._recordLifecycle(
          `Show pending: ${pendNow.label || pendNow.cueId} (auto-starts in ${inSec}s)`,
          'lease-armed', { cueId: pendNow.cueId, source: 'auto' },
        );
      }
      // Pending-program lease AUTO-START: the lease expired un-actioned and the
      // arbiter promoted it to the active program this tick (docs/38 §16.5 I2).
      if (prevPendingCueId && !pendNow && this.state.activeProgram
          && this.state.activeProgram.cueId === prevPendingCueId
          && this.state.activeProgram.startedAtMs === now) {
        this._recordLifecycle(
          `Show auto-started: ${this._cueLabelFor(prevPendingCueId)}`,
          'lease-expired', { cueId: prevPendingCueId, source: 'auto' },
        );
      }
      // Program HOLD EXPIRED: the arbiter cleared an active program whose hold
      // window lapsed. (A program REPLACED by another leaves activeProgram set,
      // so it lands as the new program's fire, not a spurious "ended".)
      if (prevProgram && !this.state.activeProgram) {
        this._recordLifecycle(
          `Program ended (hold expired): ${this._cueLabelFor(prevProgram.cueId)}`,
          'hold-expired', { cueId: prevProgram.cueId, source: 'auto' },
        );
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

      // Sync the engine baseline autopilot to the final controller (freeze on
      // pause/hold/program, resume on autopilot) — transition-gated.
      try {
        await this._reconcileBaselineArm();
      } catch (e) {
        this.lastError = `autopilot reconcile: ${e && e.message}`;
        console.warn(`  ⚠ [timeline] autopilot reconcile failed: ${e && e.message}`);
      }

      // Reconcile the plan's soft deck-pin against whether it still drives the
      // deck (docs/38 §16.9): a program that expired into manual, or any drift
      // into a non-driving controller, releases the pin so the 'plan' controlLock
      // clears. Re-pinning on resume is handled by the apply/baseline paths.
      try {
        await this._reconcileDeckPin();
      } catch (e) {
        this.lastError = `deck-pin reconcile: ${e && e.message}`;
        console.warn(`  ⚠ [timeline] deck-pin reconcile failed: ${e && e.message}`);
      }

      // Reconcile the DEFAULT CUE against the deck-ownership window (§16.11): a
      // durationMin window that just elapsed (or a plan with no owning cue right
      // now) reverts the deck to plan.defaultCue. No-op when defaultCue is absent
      // (autopilot baseline stands) or a program/operator owns the deck.
      try {
        await this._reconcileDefaultCue(now);
      } catch (e) {
        this.lastError = `default-cue reconcile: ${e && e.message}`;
        console.warn(`  ⚠ [timeline] default-cue reconcile failed: ${e && e.message}`);
      }

      // A `scene` action (requestScene → engine exit-75) tears this service down
      // mid-tick via stop(); if that happened during the awaits above, don't
      // persist/broadcast against a stopping engine.
      if (this._tickHandle === null) return;

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
        controller: 'autopilot', planActive: false, forcingDeckView: false,
        inFestivalWindow: this._inFestivalWindow(), festivalStartsInDays: festivalStartsInDays(this.plan, now),
        autopilotEnabled: true, activeProgram: null, activeCue: null,
        pendingProgram: null, operatorLease: null, operatorLeaseSec: this.operatorLeaseSec,
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

    // Out of the festival window the plan HASN'T STARTED (operator request
    // 2026-07-02): the "starts in X days" note is the only status, so there is
    // no live "NOW"/"next in …" — those would contradict the dormant state.
    // The per-day cue SCHEDULE (atLocal times in the overview) still renders;
    // only the header-level live-status fields are suppressed here.
    const inWindow = this._inFestivalWindow();
    const cues = [];
    let nextCue = null;
    for (const cue of this.plan.cues) {
      const fireMs = dayTimes.cueTimes[cue.id];
      let nextInSec = null;
      if (inWindow && typeof fireMs === 'number' && fireMs > now && cue.enabled !== false) {
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

    const mode = this.state.mode;

    // Surface the operator-takeover lease as {expiresAtMs} (docs/38 §16) so
    // CaptainPad can render/seed the auto-resume countdown.
    let operatorLease = null;
    if (this.state.operatorLease && typeof this.state.operatorLease.expiresAtMs === 'number') {
      operatorLease = { expiresAtMs: this.state.operatorLease.expiresAtMs };
    }
    const controller = this.state.controller || 'autopilot';
    // planActive (docs/38 §16): the timeline is actively DRIVING the rig.
    // OUT OF THE FESTIVAL WINDOW this is ALWAYS false (operator request
    // 2026-07-03): the plan drives nothing out of its scheduled days, so the
    // deck/mixer lock, the takeover flow, and the plan indicator all stay off —
    // only the timeline tab's inFestivalWindow=false note shows.
    const planActive = (controller === 'autopilot' || controller === 'program')
      && this.state.mode !== 'overridden'
      && inWindow;
    // forcingDeckView (docs/38 §16.9): the plan is active AND the engine output
    // is currently pinned to the deck under plan control. CaptainPad reads this
    // to know a switch-to-mixer needs the confirm prompt + 1-min auto-revert
    // (the confirm/revert lives in the UI, NOT the engine).
    const forcingDeckView = planActive
      && typeof this.deps.getViewOverrideMode === 'function'
      && this.deps.getViewOverrideMode() === 'deck';

    // Surface the pending-program lease as {cueId,label,expiresAtMs} (docs/38
    // §16.7) so CaptainPad can render the "SCHEDULED SHOW PENDING" countdown.
    let pendingProgram = null;
    if (this.state.pendingProgram && this.state.pendingProgram.cueId) {
      pendingProgram = {
        cueId: this.state.pendingProgram.cueId,
        label: this.state.pendingProgram.label || this.state.pendingProgram.cueId,
        expiresAtMs: this.state.pendingProgram.expiresAtMs,
      };
    }

    let activeProgram = null;
    if (this.state.activeProgram && this.state.activeProgram.cueId) {
      activeProgram = {
        cueId: this.state.activeProgram.cueId,
        startedAtMs: this.state.activeProgram.startedAtMs,
        untilMs: this.state.activeProgram.untilMs !== undefined ? this.state.activeProgram.untilMs : null,
      };
    }

    // activeCue — the EVENT currently driving the deck, for the operator to see
    // at a glance on the timeline tab AND inside the deck/mixer lock banner
    // (operator request 2026-07-02: "when an event is active, clearly show it").
    // Precedence: a running program wins, else the cue that owns the deck window
    // (§16.11 `_deckWindowCueId`), else null = the autopilot baseline is driving
    // (nothing cue-specific is "active"). `until` is the program hold / the
    // durationMin window end when known, so the UI can show a countdown.
    let activeCue = null;
    const activeCueId = (this.state.activeProgram && this.state.activeProgram.cueId)
      || this._deckWindowCueId || null;
    // Out of window → no active event (see the nextCue note above): the plan
    // hasn't started, so nothing is "NOW" even if a recurring cue technically
    // owns the deck window.
    if (activeCueId && inWindow) {
      const c = this.plan.cues.find((x) => x.id === activeCueId);
      if (c) {
        const untilMs = (this.state.activeProgram && this.state.activeProgram.cueId === activeCueId)
          ? (this.state.activeProgram.untilMs ?? null)
          : (typeof this._deckWindowUntilMs === 'number' ? this._deckWindowUntilMs : null);
        activeCue = {
          id: c.id,
          label: cueLabel(c),
          kind: c.kind === 'program' ? 'program' : 'cue',
          untilMs,
        };
      }
    }

    return {
      type: 'timelineState',
      mode,
      scene: this.scene,
      activePlan: this.state.activePlan || this.activePlan,
      controller,
      planActive,
      forcingDeckView,
      // Festival-window surface (docs/38 §15.2): whether the plan is "in time"
      // (drives the 'plan' controlLock gate), and — when it hasn't started yet —
      // the whole-day countdown to festival.startDate in plan.location.tz.
      inFestivalWindow: inWindow,
      festivalStartsInDays: festivalStartsInDays(this.plan, now),
      autopilotEnabled: this.state.autopilotEnabled !== false,
      activeProgram,
      activeCue,
      pendingProgram,
      operatorLease,
      operatorLeaseSec: this.operatorLeaseSec,
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
  async savePlan(plan) {
    if (!plan || typeof plan !== 'object') throw new Error('savePlan: plan must be an object');
    const normalized = validateShowPlan(plan);
    this._assertPlanName(normalized.name);
    if (!fs.existsSync(this.sceneDir)) fs.mkdirSync(this.sceneDir, { recursive: true });
    saveShowPlan(normalized, this._planPath(normalized.name));
    // Saving OVER the ACTIVE plan hot-reloads it. Previously the engine kept
    // running the stale in-memory copy until re-activate (disk/memory
    // divergence), which also left freshly-saved cues invisible to the live
    // overview — the maker's FIRE buttons stayed dead after SAVE. Swap the
    // plan in place (the event ring is PRESERVED — unlike activatePlan) and
    // catchUp so cue windows / baseline re-derive from the new content.
    if (normalized.name === this.activePlan) {
      this.plan = normalized;
      this._recordLifecycle(`Plan updated (live): ${normalized.name}`, 'save', { source: 'manual' });
      await this._catchUp();
    }
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
    // Deck-ownership latches (docs/38 §16.11) are per-plan runtime — reset them
    // so the incoming plan's default cue / windows are re-derived from scratch,
    // and a stale F4 failure-latch from the outgoing plan does not suppress the
    // new plan's default cue.
    this._deckWindowUntilMs = null;
    this._deckWindowCueId = null;
    this._defaultCueActive = false;
    this._defaultCueFailKey = null;
    // Event log (docs/38 §15.2): the activation opens the (just-cleared) ring —
    // logged BEFORE _catchUp so it precedes the plan's catch-up fire.
    this._recordLifecycle(`Plan activated: ${name}`, 'activate', { source: 'manual' });
    await this._catchUp();
    this._broadcastState();
    return name;
  }

  // ── operator controls (docs/38 §14.5) ─────────────────────────────────────

  /**
   * Explicit operator hand-back (docs/38 §14.5 + §16). Ends any operator
   * takeover — clears the takeover lease + exits 'overridden' — and RESUMES THE
   * PLAN AT NOW via catchUp (re-derives the correct program/look for the current
   * wall-clock and re-establishes the baseline). Same "resume-at-now" behavior
   * as a lease auto-release, but triggered by the operator rather than by
   * inactivity. Since PAUSE/HOLD were removed, takeover is the ONLY manual
   * interruption of a running plan (it always auto-resumes) — resume is its
   * explicit hand-back.
   */
  async resume() {
    // Event log (docs/38 §15.2): explicit operator hand-back. EDGE-ONLY — a
    // resume that changes nothing (already armed, no lease) logs nothing.
    // Logged BEFORE _catchUp so the resume precedes its catchUp fire.
    const wasManual = this.state.mode !== 'armed' || !!this.state.operatorLease;
    this.state.mode = 'armed';
    this.state.operatorLease = null;
    if (wasManual) this._recordLifecycle('Plan resumed by operator', 'resume', { source: 'manual' });
    try {
      await this._catchUp();
    } catch (e) {
      this.lastError = `resume catchUp: ${e && e.message}`;
      console.warn(`  ⚠ [timeline] resume catchUp failed: ${e && e.message}`);
    }
    this._persistAndBroadcast();
    return { mode: this.state.mode };
  }

  /**
   * Operator takeover (docs/38 §16) — UI-DRIVEN: CaptainPad signals that the
   * operator grabbed manual control. Sets mode 'overridden' (→ controller
   * 'manual' via the arbiter/baseline reconcile, which FREEZES the deck) and
   * arms an operator-takeover lease that auto-resumes the plan at now +
   * operatorLeaseSec unless refreshed by /activity pings or cleared by /resume.
   * Idempotent: re-calling refreshes the expiry.
   *
   * @returns {{ok:true, operatorLease:{expiresAtMs:number}}}
   */
  takeover() {
    // FESTIVAL-WINDOW ISOLATION (operator request 2026-07-03): out of window the
    // plan drives nothing, so there is nothing to take over — refuse to arm a
    // lease. Defense in depth: CaptainPad won't even offer takeover out of
    // window (planActive is false), but a stray call must never resurrect the
    // "taken over" banner while the plan is dormant.
    if (!this._inFestivalWindow()) {
      return { ok: true, operatorLease: null };
    }
    const expiresAtMs = this.nowFn() + this.operatorLeaseSec * 1000;
    // Event log (docs/38 §15.2): the ARM edge only — takeover() is idempotent
    // and CaptainPad re-calls it to refresh the lease; refreshes log nothing.
    if (this.state.mode !== 'overridden') {
      this._recordLifecycle('Operator takeover (lease armed)', 'takeover', { source: 'manual' });
    }
    this.state.mode = 'overridden';
    this.state.operatorLease = { expiresAtMs };
    // Reflect the takeover in the controller immediately (don't read stale
    // 'autopilot' until the next tick) — overridden is operator manual.
    this.state.controller = 'manual';
    // Operator grabbed the deck → the plan no longer drives it. Release the
    // soft deck-pin (docs/38 §16.9). Fire-and-forget keeps the sync REST
    // contract; the tick's _reconcileDeckPin is the backstop.
    this._reconcileDeckPin().catch((e) => {
      this.lastError = `takeover deck-pin release: ${e && e.message}`;
    });
    this._persistAndBroadcast();
    return { ok: true, operatorLease: { expiresAtMs: this.state.operatorLease.expiresAtMs } };
  }

  /**
   * Activity ping (docs/38 §16) — CaptainPad sends these (~once/10s) while the
   * operator is interacting. If a takeover lease is held (mode 'overridden'),
   * refresh its expiry; otherwise a no-op (never arms a lease on its own).
   *
   * @returns {{ok:true}}
   */
  activity() {
    if (this.state.mode === 'overridden' && this.state.operatorLease) {
      this.state.operatorLease.expiresAtMs = this.nowFn() + this.operatorLeaseSec * 1000;
      this._persistAndBroadcast();
    }
    return { ok: true };
  }

  /**
   * Release an expired operator-takeover lease (docs/38 §16): clear the lease,
   * exit manual (mode 'armed'), and RESUME THE PLAN AT NOW via catchUp — the
   * "continue the plan at the exact time of release" behavior. Called from the
   * tick when now ≥ operatorLease.expiresAtMs.
   */
  async _releaseOperatorLease() {
    const expiry = this.state.operatorLease && this.state.operatorLease.expiresAtMs;
    this.state.mode = 'armed';
    this.state.operatorLease = null;
    // Event log (docs/38 §15.2): auto-resume on lease expiry. One-shot by
    // construction (the lease is nulled here). Logged BEFORE _catchUp so the
    // release precedes its catchUp fire in the ring.
    this._recordLifecycle('Operator lease released — plan resumed', 'lease-released', { source: 'auto' });
    console.log(`  🔓 [timeline] operator lease released (${typeof expiry === 'number' ? `expired ${expiry}` : 'orphaned override — no lease'}) — resuming plan at now`);
    await this._catchUp();
  }

  async setAutopilotEnabled(enabled) {
    if (typeof enabled !== 'boolean') throw new Error('enabled must be a boolean');
    // Event log (docs/38 §15.2): the AUTO toggle. EDGE-ONLY — re-posting the
    // current value logs nothing. Logged before the apply so the toggle
    // precedes any baseline/program fire it causes.
    if ((this.state.autopilotEnabled !== false) !== enabled) {
      this._recordLifecycle(
        enabled ? 'Autopilot enabled' : 'Autopilot disabled',
        'autopilot-toggle', { source: 'manual' },
      );
    }
    this.state.autopilotEnabled = enabled;
    try {
      if (enabled) {
        // An active takeover lease ('overridden') is deliberately NOT broken by
        // AUTO ON — the lease owns the rig until it expires or the operator
        // resumes. (PAUSE/HOLD were removed, so there is no paused/holding state
        // for AUTO ON to re-arm anymore.)
        // §16.6 lease + ap-on: enabling autopilot while a lease is pending starts
        // the (due) program rather than just resuming the baseline.
        if (this.state.pendingProgram && this.state.pendingProgram.cueId) {
          await this.enableProgram();
          return { autopilotEnabled: this.state.autopilotEnabled, controller: this.state.controller };
        }
        await this._establishBaselineIfActive('operator');
      } else {
        // Turning the plan's autopilot OFF is an explicit operator "stop
        // driving" — it must ALSO END any takeover in progress (clear the
        // operator lease + exit 'overridden'), so no stale "taken over — plan
        // resumes in M:SS" banner lingers (operator report 2026-07-03:
        // disabling the plan after a takeover left the warning up). With the
        // lease cleared and mode armed, planActive AND leaseHeld both read
        // false → the deck/mixer lock banner and the lease countdown both drop.
        this.state.operatorLease = null;
        this.state.mode = 'armed';
        await this._disarmBaselineAutopilot();
        if (!this.state.activeProgram) this.state.controller = 'manual';
        // The baseline no longer owns the deck (docs/38 §16.9). If a program is
        // still active it keeps its own deck-pin; otherwise release the plan's
        // soft deck-pin so the 'plan' controlLock clears (yellow lock drops).
        await this._reconcileDeckPin();
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
    // Event log (docs/38 §15.2): operator END SHOW. Edge-only via the early
    // return above (no active program → nothing ends, nothing logs).
    this._recordLifecycle(
      `Program ended: ${this._cueLabelFor(this.state.activeProgram.cueId)}`,
      'program-end', { cueId: this.state.activeProgram.cueId, source: 'manual' },
    );
    this.state.activeProgram = null;
    try {
      if (this.state.autopilotEnabled !== false && this.state.mode !== 'overridden') {
        await this._establishBaselineIfActive('program/end');
      } else {
        this.state.controller = 'manual';
      }
      // If the plan is no longer driving the deck (autopilot off / takeover),
      // release its soft deck-pin (docs/38 §16.9). No-op when the baseline
      // re-established above re-pinned the deck.
      await this._reconcileDeckPin();
      this.lastError = null;
    } catch (e) {
      this.lastError = `program/end: ${e && e.message}`;
    }
    this._persistAndBroadcast();
    return { activeProgram: null, controller: this.state.controller };
  }

  /**
   * Start the PENDING program immediately (docs/38 §16.5 lease-enable). Exits
   * any takeover (manual), promotes pendingProgram → activeProgram, disarms
   * the baseline on the program's target(s), applies the pending action through
   * the same dispatch path, clears the lease, sets controller='program'. FAIL
   * LOUD with a 400-style result when there is no pending lease.
   *
   * @returns {Promise<{ok:boolean, error?:string, controller?:string, activeProgram?:object}>}
   */
  async enableProgram() {
    const pend = this.state.pendingProgram;
    if (!pend || !pend.cueId) return { ok: false, error: 'no pending program' };
    const now = this.nowFn();
    const sunEvents = this._sunEventsFor(now);
    const dayTimes = resolveDayTimes({ plan: this.plan, now, sunEvents });
    const cue = this.plan.cues.find((c) => c.id === pend.cueId);
    const hold = cue ? cue.hold : undefined;
    // Exit manual — the operator chose to hand the deck to the program.
    this.state.mode = 'armed';
    // Exiting 'overridden' must clear the takeover lease too (audit C1) — a
    // stranded lease is never extended/released once mode isn't 'overridden'.
    this.state.operatorLease = null;
    this.state.activeProgram = {
      cueId: pend.cueId,
      startedAtMs: now,
      untilMs: resolveHold(hold, now, dayTimes),
    };
    this.state.pendingProgram = null;
    // Latch firedToday so the just-started program does not re-arm a lease today.
    this._latchFiredToday(pend.cueId, now);
    try {
      // Same dispatch contract as the arbiter: disarm baseline + apply action.
      await this._dispatchArbitratedAction({ cueId: pend.cueId, action: pend.action, autopilotOff: true }, 'lease-enable');
      this.state.controller = 'program';
      this.lastError = null;
      this._persistAndBroadcast();
      return { ok: true, controller: this.state.controller, activeProgram: this.state.activeProgram };
    } catch (e) {
      this.cueErrors[pend.cueId] = `${e && e.message}`;
      this.lastError = `program/enable "${pend.cueId}": ${e && e.message}`;
      this._broadcastState();
      throw e;
    }
  }

  /**
   * Dismiss (cancel) the pending program (docs/38 §16.5 lease-dismiss). Stays
   * manual; latches firedToday[cueId] for today so the cue does NOT re-arm a
   * lease again today. FAIL LOUD when there is no pending lease.
   *
   * @returns {{ok:boolean, error?:string}}
   */
  dismissProgram() {
    const pend = this.state.pendingProgram;
    if (!pend || !pend.cueId) return { ok: false, error: 'no pending program' };
    // Event log (docs/38 §15.2): operator dismissed the pending show. Edge-only
    // via the early return above (nulling the lease makes this one-shot).
    this._recordLifecycle(
      `Show dismissed: ${pend.label || pend.cueId}`,
      'lease-dismissed', { cueId: pend.cueId, source: 'manual' },
    );
    this._latchFiredToday(pend.cueId, this.nowFn());
    this.state.pendingProgram = null;
    this._persistAndBroadcast();
    return { ok: true };
  }

  // Latch a cue as fired-today (docs/38 §16: a dismissed lease sticks for the
  // day; an enabled/auto-started program does not re-arm). dayKey is the
  // tz-local calendar day, matching evaluateTick's latch bookkeeping.
  _latchFiredToday(cueId, now) {
    if (!this.state.firedToday) this.state.firedToday = {};
    this.state.firedToday[cueId] = dayKeyFor(now, this.plan.location.tz);
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
    const prevPendingCueId = this.state.pendingProgram ? this.state.pendingProgram.cueId : null;
    const { actions, state: arbState } = arbitrate({
      now, plan: this.plan, state: this.state, fires: [{ cueId: id, reason: 'manual' }], dayTimes,
      leaseSec: this.programLeaseSec,
    });
    this.state = arbState;
    // A MANUAL fire of a program cue while the deck is in manual control ARMS a
    // lease instead of firing (docs/38 §16.4) — surface that in the event log,
    // same edge rule as the tick (cueId change only).
    const pendNow = this.state.pendingProgram;
    if (pendNow && pendNow.cueId && pendNow.cueId !== prevPendingCueId) {
      const inSec = Math.max(0, Math.round((pendNow.expiresAtMs - now) / 1000));
      this._recordLifecycle(
        `Show pending: ${pendNow.label || pendNow.cueId} (auto-starts in ${inSec}s)`,
        'lease-armed', { cueId: pendNow.cueId, source: 'manual' },
      );
    }
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
