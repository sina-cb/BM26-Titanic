/*
 * special_events_service.js — the engine-side SPECIAL EVENTS show runner
 * (docs/52; design report `_197`, operator's playlist-driven revision `_205`).
 *
 * WHAT THIS IS. A tiny, linear STAGE MACHINE that holds authority over the rig
 * while the operator walks a staged show one big button at a time (Baby Reveal
 * is show #1: TEASE → BLACKOUT → the pink/blue REVEAL). It is a
 * sibling of lib/timeline/timeline_service.js in SHAPE — deps-injected internal
 * calls, a 1 s tick, a WS broadcast, a persisted state file — and roughly a
 * tenth its size, because it is a stage machine and not an arbiter.
 *
 * WHY IT LIVES IN THE ENGINE AND NOT IN CAPTAINPAD (docs/52 §1). Show state and
 * timers must survive the iPad: sleep, a tab switch, a dropped WS, a dead
 * battery. Engine-side, the tab is a pure view — reopening it lands exactly on
 * the live stage. Engine-side also means the deck autopilot cannot legally swap
 * a pattern in the middle of the blackout, because the runner disarms it and
 * holds the timeline's takeover lease for the whole show.
 *
 * AUTHORITY MODEL — three layers, in order of who wins:
 *
 *   1. PANIC always wins. `notePanic()` is fire-and-forget from the panic /
 *      blackout routes: the show ends WITHOUT a snapshot recall (panic has just
 *      established a known-good LIT state; morphing an old look over it would
 *      fight the operator's emergency).
 *   2. THE TIMELINE outranks the event. A special event is an operator
 *      TAKEOVER, taken through the timeline's existing lease
 *      (`timelineService.takeover()`), refreshed every tick exactly like
 *      CaptainPad refreshes it. Per the operator's 2026-08-14 ruling
 *      ("the timeline is high priority", report `_200`) the reverse direction
 *      is NEVER blocked: RESUME and lease expiry are free. If the plan takes the
 *      rig back, the runner SEES the lease is gone on its next tick and ABORTS
 *      the show WITH the restore, loudly. It never re-seizes.
 *   2b. STAGE ROTATION (the show autopilot). A stage may author an
 *      `autopilot:` block — cadence, shuffle and a soft transition — and the
 *      runner drives the deck's OWN pattern-autopilot daemon with it rather
 *      than growing a second timer: that daemon already awaits each swap
 *      before rescheduling, refuses overlapping transitions, and pre-warms the
 *      next pattern. Engine-side for the same reason the stage clock is: a tab
 *      that sleeps must not stop the tease from breathing. The operator retunes
 *      it live through POST /special-events/autopilot, and that tuning is
 *      remembered per show+stage across runs. COLOUR is deliberately absent —
 *      the Baby families are hard-coded RGB and the colour autopilot stays
 *      disarmed for the whole show.
 *   3. THE EVENT owns deck CONTENT while it holds the rig. api_server 409s the
 *      deck content routes with code SPECIAL_EVENT so there is one writer.
 *      Everything safety-shaped (panic, blackout, master, dimmers) stays open,
 *      and the Dimmer Rack's authority is untouched — no verb writes dimmers.
 *
 * FAIL LOUD (codex P0). A broken show file is a listed, visible load error and
 * is never armable. A missing playlist refuses the ARM and names what exists.
 * A mid-ARM dep failure unwinds every step it completed and returns the error —
 * a show never starts half-armed. A restore that fails lands in
 * `ended:restore_failed` with the rig forced back to its pre-show master, never
 * a silent shrug and never a dark ship.
 */
import fs from 'node:fs';
import path from 'node:path';

import yaml from 'js-yaml';

import {
  loadShowLibrary,
  showPlaylistNames,
  summarizeShow,
  validateAutopilotPatch,
} from './show_schema.js';

/** Runtime state file, next to timeline_state.yaml in `states/<scene>/`. */
export const SPECIAL_EVENTS_STATE_FILE = 'special_events_state.yaml';

/**
 * The reserved pre-show snapshot. Overwritten on every ARM; recalled by the
 * shared restore. api_server refuses a manual snapshot under this name.
 */
export const EVENT_SNAPSHOT_NAME = 'ev_prev';

/** Runner tick. Drives countdowns, the lease keep-alive and the state clock. */
const TICK_MS = 1000;

/** Snapshot morph duration for FINISH / ABORT. */
const RESTORE_MORPH_MS = 3000;

/**
 * Readback tolerance for the `globals` write verification. ParamCenter stores
 * what it was handed, so this is float-equality slack and nothing more — it is
 * NOT a "close enough" window for a partially applied write.
 */
const GLOBALS_READBACK_EPS = 1e-6;

/** Statuses. `ended` is sticky until the operator dismisses it. */
export const STATUS = Object.freeze({
  IDLE: 'idle', ARMED: 'armed', RUNNING: 'running', ENDED: 'ended',
});

/** Terminal reasons carried on `ended`. */
export const END_REASON = Object.freeze({
  FINISHED: 'finished',
  ABORTED: 'aborted',
  PANIC: 'panic',
  RESTORE_FAILED: 'restore_failed',
});

/**
 * A refusal the API layer maps straight onto an HTTP status + `code`, the same
 * `code`-carrying shape CaptainPad's existing callers already understand.
 */
export class SpecialEventError extends Error {
  constructor(message, { status = 400, code = 'SPECIAL_EVENT_ERROR', detail = null } = {}) {
    super(message);
    this.name = 'SpecialEventError';
    this.status = status;
    this.code = code;
    if (detail) this.detail = detail;
  }
}

const REQUIRED_DEPS = [
  'activatePlaylist', 'listPlaylists', 'inspectPlaylist', 'setDeckControl',
  'fadeMaster', 'setMaster', 'getMaster', 'setGlobals', 'captureGlobals', 'setEffect',
  'startStrobe', 'fireStrobeBurst', 'stopStrobe', 'captureSnapshot', 'recallSnapshotFade',
  'getAutopilotFlags', 'setPatternAutopilot', 'setColorAutopilot',
  // STAGE ROTATION (the show autopilot). The runner drives the deck's OWN
  // pattern-autopilot daemon and transition config rather than growing a
  // second timer: that daemon already waits out each swap before rescheduling,
  // refuses to overlap transitions, and pre-warms the next pattern. A private
  // timer here would race it for the same deck channel.
  'getPatternAutopilot', 'getDeckTransition', 'setDeckTransition',
  // NOW PLAYING on the SHOW autopilot card (docs/57 §4.3): the deck's active
  // playlist entry, read engine-side so the Events tab never grows a second
  // data source for the deck.
  'getDeckNowPlaying',
];

function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** Human-readable rendering of a global param value for an error message. */
function formatGlobalValue(v) {
  if (typeof v === 'number') return String(v);
  if (isPlainObject(v) && typeof v.h === 'number') {
    return `{h: ${v.h}, s: ${v.s}, v: ${v.v}}`;
  }
  return JSON.stringify(v);
}

/**
 * Does the value ParamCenter reads back equal the value the show wrote?
 *
 * The `globals` verb authors exactly two shapes (show_schema `case 'globals'`):
 * a finite number, or an `{h, s, v}` triple. Numbers compare within
 * GLOBALS_READBACK_EPS; HSV compares component-wise within the same epsilon.
 * ANY other shape on either side is a mismatch — there is no lenient branch,
 * because "we could not tell" and "it did not land" must fail the same way.
 */
function globalsValueMatches(wrote, read) {
  if (typeof wrote === 'number') {
    return typeof read === 'number' && Math.abs(wrote - read) <= GLOBALS_READBACK_EPS;
  }
  if (isPlainObject(wrote)) {
    if (!isPlainObject(read)) return false;
    for (const component of ['h', 's', 'v']) {
      const a = wrote[component];
      const b = read[component];
      if (typeof a !== 'number' || typeof b !== 'number') return false;
      if (Math.abs(a - b) > GLOBALS_READBACK_EPS) return false;
    }
    return true;
  }
  return false;
}

export class SpecialEventsService {
  /**
   * @param {object}   o
   * @param {string}   o.scene       scene / model name
   * @param {string}   o.showsDir    `simulation/scenes/<scene>/special_events`
   * @param {string}   o.stateDir    `states/<scene>`
   * @param {object}   o.deps        engine internals (see REQUIRED_DEPS)
   * @param {function} o.broadcast   broadcastWs
   * @param {object}   [o.timeline]  { takeover, activity, authorityHeld, release } —
   *                                 omitted / null when the timeline is disabled,
   *                                 in which case there is nothing to take over.
   * @param {function} [o.nowFn]
   */
  constructor({ scene, showsDir, stateDir, deps, broadcast, timeline = null, nowFn = null }) {
    if (typeof scene !== 'string' || !scene) throw new Error('SpecialEventsService: scene is required');
    if (typeof showsDir !== 'string' || !showsDir) throw new Error('SpecialEventsService: showsDir is required');
    if (typeof stateDir !== 'string' || !stateDir) throw new Error('SpecialEventsService: stateDir is required');
    if (!deps || typeof deps !== 'object') throw new Error('SpecialEventsService: deps is required');
    for (const name of REQUIRED_DEPS) {
      if (typeof deps[name] !== 'function') {
        throw new Error(`SpecialEventsService: deps.${name}() is required`);
      }
    }
    if (typeof broadcast !== 'function') throw new Error('SpecialEventsService: broadcast is required');

    this.scene = scene;
    this.showsDir = showsDir;
    this.stateDir = stateDir;
    this.deps = deps;
    this.broadcast = broadcast;
    this.timeline = timeline;
    this.nowFn = nowFn || Date.now;

    this.shows = [];
    this.loadErrors = [];
    this.lastError = null;

    this.run = null;            // the live run record (null when idle)
    this.ended = null;          // the sticky ENDED card (null once dismissed)

    // LIVE AUTOPILOT OVERRIDES, keyed `<showId>/<stageId>`. The operator tunes
    // the tease cadence at the rail, and that tuning must still be there the
    // next night — so unlike the run record these OUTLIVE the show and are
    // persisted alongside it. The show YAML remains the author's intent; an
    // override is the operator's, and `reset` puts the YAML back.
    this._autopilotOverrides = new Map();
    // True while the runner has armed the deck's pattern autopilot itself, so
    // teardown knows whether it has anything of its own to stop.
    this._rotationArmed = false;

    this._tickHandle = null;
    this._ticking = false;
    // Action timers, cancelled by a generation bump (a new stage supersedes an
    // in-flight authored sequence).
    this._actionGeneration = 0;
    this._actionTimers = new Set();
    // RELEASE timers are deliberately NOT generation-scoped: an effect the
    // runner switched ON must come back OFF even if the operator jumps stages
    // mid-pulse. Terminal transitions flush them synchronously.
    this._releaseTimers = new Set();
    this._activeEffects = new Set();
    this._strobeFired = false;
    // Every global param key a `globals` action wrote during this run. The end
    // of the show puts back exactly these and nothing else — restoring the
    // whole ParamCenter would stomp state no stage ever touched.
    this._globalsWritten = new Set();
  }

  // ── lifecycle ─────────────────────────────────────────────────────────────

  /**
   * Load the show library, recover from a state file left behind by a crashed /
   * killed engine, then begin ticking.
   *
   * RESTART IS AN ABORT. A persisted `armed`/`running` state means the process
   * died mid-show; the rig must come back NORMAL, not stuck mid-blackout with
   * the autopilots off. Boot therefore runs the shared restore and lands in
   * `ended:aborted`.
   */
  async start() {
    if (this._tickHandle) return;
    this.reloadLibrary();
    await this._recoverFromStateFile();
    this._tickHandle = setInterval(() => {
      this._tick().catch((err) => {
        this.lastError = `tick: ${err && err.message}`;
        console.warn(`  ⚠ [special-events] tick error: ${err && err.message}`);
      });
    }, TICK_MS);
    if (typeof this._tickHandle.unref === 'function') this._tickHandle.unref();
    this._broadcast();
  }

  stop() {
    if (this._tickHandle) {
      clearInterval(this._tickHandle);
      this._tickHandle = null;
    }
    this._cancelActionTimers();
    // Drop the pending release timers WITHOUT running them: stop() fires on
    // shutdown and on a scene switch, and their deps close over a mixer /
    // effects controller that is being torn down. The boot-time recovery is
    // what puts a killed show right — it restores the pre-show look wholesale.
    for (const handle of this._releaseTimers) clearTimeout(handle);
    this._releaseTimers.clear();
  }

  /** Re-scan `special_events/`. Broken files become listed load errors. */
  reloadLibrary() {
    const { shows, errors } = loadShowLibrary(this.showsDir);
    this.shows = shows;
    this.loadErrors = errors;
    for (const err of errors) {
      console.error(`  ⛔ [special-events] "${err.file}" REFUSED TO LOAD: ${err.error}`);
    }
    return { shows, errors };
  }

  getShow(id) {
    return this.shows.find((s) => s.id === id) || null;
  }

  // ── state file ────────────────────────────────────────────────────────────

  _statePath() {
    return path.join(this.stateDir, SPECIAL_EVENTS_STATE_FILE);
  }

  _persist() {
    const payload = this.run
      ? {
        status: this.run.status,
        showId: this.run.showId,
        stageIndex: this.run.stageIndex,
        stageId: this.run.stageId,
        choiceId: this.run.choiceId,
        armedAtMs: this.run.armedAtMs,
        startedAtMs: this.run.startedAtMs,
        stageStartedAtMs: this.run.stageStartedAtMs,
        countdownEndsAtMs: this.run.countdownEndsAtMs,
        leaseExpiresAtMs: this.run.leaseExpiresAtMs,
        leaseHeld: this.run.leaseHeld,
        priorPatternAutopilot: this.run.priorPatternAutopilot,
        priorColorAutopilot: this.run.priorColorAutopilot,
        priorDeckTransition: this.run.priorDeckTransition,
        priorMaster: this.run.priorMaster,
      }
      : { status: STATUS.IDLE };
    // ALWAYS written, run or no run: the operator's cadence tuning is not part
    // of a run and must survive FINISH, ABORT and a restart.
    payload.autopilotOverrides = this._serializeOverrides();
    try {
      if (!fs.existsSync(this.stateDir)) fs.mkdirSync(this.stateDir, { recursive: true });
      const tmp = `${this._statePath()}.tmp`;
      fs.writeFileSync(tmp, yaml.dump(payload), 'utf8');
      fs.renameSync(tmp, this._statePath());
    } catch (err) {
      // Loud, but never fatal: losing the crash-recovery breadcrumb must not
      // take the show down mid-reveal.
      this.lastError = `state persist: ${err && err.message}`;
      console.warn(`  ⚠ [special-events] could not persist state: ${err && err.message}`);
    }
  }

  async _recoverFromStateFile() {
    const file = this._statePath();
    if (!fs.existsSync(file)) return;
    let saved;
    try {
      saved = yaml.load(fs.readFileSync(file, 'utf8'));
    } catch (err) {
      // A corrupt breadcrumb is not a reason to refuse to boot, but it IS a
      // reason to say so: we cannot know whether a show was live.
      console.error(
        `  ⛔ [special-events] ${SPECIAL_EVENTS_STATE_FILE} is corrupt (${err && err.message}) — ` +
        'cannot tell whether a show was live; starting idle');
      this.lastError = `state file corrupt: ${err && err.message}`;
      return;
    }
    if (!saved || typeof saved !== 'object') return;

    // Overrides load FIRST and unconditionally — they are not part of a run, so
    // an idle breadcrumb still carries the operator's cadence tuning.
    this._loadOverrides(saved.autopilotOverrides);

    if (saved.status !== STATUS.ARMED && saved.status !== STATUS.RUNNING) return;

    console.warn(
      `  ⚠ [special-events] the engine restarted while show "${saved.showId}" was ` +
      `${saved.status} — a restart IS an abort: restoring the pre-show look`);
    this.run = {
      status: saved.status,
      showId: saved.showId,
      show: this.getShow(saved.showId),
      stageIndex: typeof saved.stageIndex === 'number' ? saved.stageIndex : null,
      stageId: saved.stageId || null,
      choiceId: saved.choiceId || null,
      armedAtMs: saved.armedAtMs || null,
      startedAtMs: saved.startedAtMs || null,
      stageStartedAtMs: saved.stageStartedAtMs || null,
      countdownEndsAtMs: null,
      leaseHeld: !!saved.leaseHeld,
      priorPatternAutopilot: this._recoverPriorPatternAutopilot(saved.priorPatternAutopilot),
      priorColorAutopilot: saved.priorColorAutopilot || null,
      priorDeckTransition: isPlainObject(saved.priorDeckTransition)
        ? { ...saved.priorDeckTransition } : null,
      priorMaster: typeof saved.priorMaster === 'number' ? saved.priorMaster : null,
      autopilot: null,
      autopilotStageId: null,
    };
    // A restart IS an abort, and the runner may have armed the deck's rotation
    // before it died. Nothing in memory says so, so assume it did: the teardown
    // restores the recorded pre-show block either way, which is the honest
    // end state whether or not rotation was actually running.
    this._rotationArmed = true;
    await this._endRun(END_REASON.ABORTED, 'the engine restarted mid-show', { restore: true });
  }

  /**
   * Read `priorPatternAutopilot` out of a breadcrumb.
   *
   * It used to be a BOOLEAN (only the active flag was restored); it is now the
   * whole `{active, delay_s, shuffle}` block, because the runner writes cadence
   * and shuffle too and a restore that put back only the flag would leave the
   * operator's deck on the SHOW's cadence. A boolean here means the breadcrumb
   * predates that change — say so out loud and restore what it does carry.
   */
  _recoverPriorPatternAutopilot(saved) {
    if (isPlainObject(saved)) return { ...saved };
    if (typeof saved === 'boolean') {
      console.warn(
        `  ⚠ [special-events] ${SPECIAL_EVENTS_STATE_FILE} predates the stage autopilot ` +
        `(priorPatternAutopilot is a bare boolean) — restoring active=${saved} only; ` +
        'the deck cadence and shuffle cannot be recovered from it');
      return { active: saved, delay_s: null, shuffle: null };
    }
    return { active: false, delay_s: null, shuffle: null };
  }

  // ── autopilot overrides (persisted across runs) ───────────────────────────

  _overrideKey(showId, stageId) {
    return `${showId}/${stageId}`;
  }

  _serializeOverrides() {
    const out = {};
    for (const [key, value] of this._autopilotOverrides) out[key] = value;
    return out;
  }

  /**
   * Rehydrate the persisted overrides. Each stored patch is re-validated
   * through the SAME wire validator that accepted it, so a hand-edited or
   * truncated state file cannot inject an out-of-range cadence into the deck at
   * boot — a bad entry is dropped, loudly and by name, and the show falls back
   * to nothing more surprising than the author's own YAML.
   */
  _loadOverrides(saved) {
    this._autopilotOverrides.clear();
    if (!isPlainObject(saved)) return;
    for (const [key, value] of Object.entries(saved)) {
      try {
        this._autopilotOverrides.set(key, validateAutopilotPatch(value, `override '${key}'`));
      } catch (err) {
        console.error(
          `  ⛔ [special-events] discarding unreadable autopilot override '${key}': ` +
          `${err && err.message}`);
      }
    }
  }

  // ── ARM ───────────────────────────────────────────────────────────────────

  /**
   * The ARM TRANSACTION (docs/52 §3), in this order, all-or-nothing:
   *   0. validate the show's playlist references against the scene library
   *   1. capture the pre-show look as the reserved snapshot `ev_prev`
   *   2. record the live autopilot flags
   *   3. engage the timeline's operator-takeover lease
   *   4. disarm the deck PATTERN autopilot
   *   5. disarm the deck COLOR autopilot (only if it is actually running)
   * Any failure unwinds the steps already done and rethrows. The deck keeps
   * playing whatever it was playing — ARM changes no content.
   */
  async arm(showId) {
    if (this.run) {
      throw new SpecialEventError(
        `special event "${this.run.showId}" is already ${this.run.status}`,
        { status: 409, code: 'EVENT_ACTIVE' });
    }
    if (typeof showId !== 'string' || !showId) {
      throw new SpecialEventError('show (a show id) is required', { status: 400, code: 'SHOW_REQUIRED' });
    }
    // A fresh ARM starts with a clean error line — a stale message from the
    // last show would read as a problem with this one. Anything wrong with
    // THIS show is written below (playlist drift) or thrown.
    this.lastError = null;
    const broken = this.loadErrors.find((e) => e.id === showId);
    if (broken) {
      throw new SpecialEventError(
        `show "${showId}" failed to load and cannot be armed: ${broken.error}`,
        { status: 400, code: 'SHOW_LOAD_ERROR' });
    }
    const show = this.getShow(showId);
    if (!show) {
      // Names BOTH the show and the scene: this is the refusal a request for
      // e.g. the wedding on titanic actually hits (its show file lives only
      // in test_bench's special_events/, so titanic's library never lists
      // it) — a caller must never have to guess which of the two is wrong.
      throw new SpecialEventError(
        `show "${showId}" is not available in scene "${this.scene}" — ` +
        `available here: ${this.shows.map((s) => s.id).join(', ') || '(none)'}`,
        { status: 404, code: 'SHOW_NOT_FOUND' });
    }
    this._assertPlaylistsUsable(show);
    this._reportPlaylistDrift(show);

    const undo = [];
    let priorMaster = null;
    let priorPatternAutopilot = null;
    let priorColorAutopilot = null;
    let priorDeckTransition = null;
    let priorGlobals = null;
    let leaseHeld = false;
    try {
      // 1 — the restore primitive.
      this.deps.captureSnapshot(EVENT_SNAPSHOT_NAME);

      // 2 — read-only bookkeeping (nothing to unwind).
      priorMaster = this.deps.getMaster();
      const flags = this.deps.getAutopilotFlags();
      priorColorAutopilot = flags.colorAutopilot && flags.colorAutopilot.active
        ? { ...flags.colorAutopilot }
        : null;
      // The WHOLE deck pattern-autopilot block and the deck transition config,
      // not just the on/off flag: a stage writes cadence, shuffle, transition
      // style and duration, so FINISH has to put all of them back or the
      // operator's deck silently inherits the show's tease timing.
      const priorAp = this.deps.getPatternAutopilot();
      priorPatternAutopilot = {
        active: !!(priorAp && priorAp.active),
        delay_s: priorAp && priorAp.delay_s !== undefined ? priorAp.delay_s : null,
        shuffle: !!(priorAp && priorAp.shuffle),
      };
      priorDeckTransition = { ...this.deps.getDeckTransition() };
      // The pre-show GLOBAL params. The mixer snapshot restores the LOOK, but
      // the `globals` verb writes ParamCenter — a different surface the recall
      // does not reach — so a stage that pins SPEED for the ceremony would
      // leave it pinned for the night (`_231` §7.1). Captured here, put back at
      // the end for exactly the keys the show actually wrote.
      priorGlobals = this.deps.captureGlobals();

      // 3 — timeline takeover. Absent timeline (disabled, or out of the
      // festival window where there is nothing to take over) yields no lease,
      // and the runner then monitors nothing — see _tick.
      if (this.timeline) {
        const result = this.timeline.takeover();
        leaseHeld = !!(result && result.leaseHeld);
        if (leaseHeld) undo.push(() => this.timeline.release('special event ARM unwound'));
      }

      // 4 — deck pattern autopilot off. The show owns rotation from here: a
      // stage that wants it arms it again with ITS cadence, and a stage that
      // does not (BLACKOUT) leaves it off.
      if (priorPatternAutopilot.active) {
        this.deps.setPatternAutopilot({ active: false });
        undo.push(() => this.deps.setPatternAutopilot({ ...priorPatternAutopilot }));
      }

      // 5 — deck colour autopilot off. Only touched when it is running: the
      // wire validator rejects an empty palette list, so an idle/unconfigured
      // autopilot must not be round-tripped through it.
      if (priorColorAutopilot) {
        this.deps.setColorAutopilot({ ...priorColorAutopilot, active: false });
        undo.push(() => this.deps.setColorAutopilot({ ...priorColorAutopilot }));
      }
    } catch (err) {
      for (const step of undo.reverse()) {
        try { step(); } catch (unwindErr) {
          console.error(
            `  ⛔ [special-events] ARM unwind step failed: ${unwindErr && unwindErr.message}`);
        }
      }
      const message = `ARM of "${showId}" failed and was unwound: ${err && err.message}`;
      this.lastError = message;
      console.error(`  ⛔ [special-events] ${message}`);
      throw new SpecialEventError(message, { status: 500, code: 'ARM_FAILED' });
    }

    const now = this.nowFn();
    this.ended = null;
    this.run = {
      status: STATUS.ARMED,
      showId: show.id,
      show,
      stageIndex: null,
      stageId: null,
      choiceId: null,
      armedAtMs: now,
      startedAtMs: null,
      stageStartedAtMs: null,
      countdownEndsAtMs: null,
      leaseExpiresAtMs: show.leaseDurationSec === null
        ? null
        : now + show.leaseDurationSec * 1000,
      leaseHeld,
      priorPatternAutopilot,
      priorColorAutopilot,
      priorDeckTransition,
      priorGlobals,
      priorMaster,
      // Rotation belongs to a STAGE, and no stage has fired yet.
      autopilot: null,
      autopilotStageId: null,
    };
    this._rotationArmed = false;
    this._globalsWritten.clear();
    console.log(
      `  🎈 [special-events] ARMED "${show.id}" — pre-show look captured as ` +
      `'${EVENT_SNAPSHOT_NAME}', autopilots ${priorPatternAutopilot.active ? 'disarmed' : 'already off'}, ` +
      `timeline lease ${leaseHeld ? 'held' : 'not held (no plan to take over)'}`);
    this._persistAndBroadcast();
    return this.getState();
  }

  /**
   * Every playlist a show can reach must exist AND be loadable in THIS scene's
   * library. Checked at ARM, not at 2 a.m. when the stage fires.
   *
   * Two grades, deliberately different (codex P0 fail-loud, proportionately):
   *
   *   REFUSE — the playlist is absent, malformed, or every one of its entries
   *            points at a pattern file that no longer exists. Firing the stage
   *            would either throw or silently do nothing, so the ARM stops here
   *            and the message names the missing playlists AND lists what the
   *            scene actually has, because the fix is always "create or rename
   *            a playlist" and the operator should not have to go looking.
   *
   *   REPORT — the playlist loads but SOME entries reference absent patterns
   *            (the usual cause: a pattern was renamed and the playlist was not
   *            re-saved). The show still runs on its remaining entries, so
   *            refusing would be over-strict, but the drift is logged loudly and
   *            surfaced on `lastError` so the tab shows it.
   *
   * The runner NEVER creates or edits playlist content — playlists are the
   * operator's domain.
   *
   * The check itself lives in `_checkPlaylistsUsable`, which never throws, so
   * the SAME question can be asked non-fatally for the show catalog (a show
   * whose scene cannot ARM it must not even be offered as a card — see
   * `playlistsUsable` on the wire summary) as well as fatally here at ARM.
   */
  _assertPlaylistsUsable(show) {
    const { unusable, reasons, available } = this._checkPlaylistsUsable(show);
    if (unusable.length > 0) {
      throw new SpecialEventError(
        `show "${show.id}" cannot be armed in scene "${this.scene}" — ${reasons.join('; ')}. ` +
        'Create, rename or re-save the playlist(s); the show runner never authors playlist ' +
        `content. Available playlists: ${available.join(', ') || '(none)'}`,
        {
          status: 400,
          code: 'SPECIAL_EVENT_PLAYLIST_MISSING',
          detail: { missing: unusable, reasons, available },
        });
    }
  }

  /**
   * Non-throwing half of the playlist-usability question: which of `show`'s
   * referenced playlists are absent or unloadable IN THIS SCENE, which are
   * merely degraded (loadable but missing some entries), and the scene's full
   * playlist list. `unusable.length === 0` is exactly the ARM contract; the
   * catalog wire format also reads `unusable` to decide whether to offer the
   * show as a card at all (`playlistsUsable`, see `getState()`).
   */
  _checkPlaylistsUsable(show) {
    const wanted = showPlaylistNames(show);
    const available = this.deps.listPlaylists();
    if (wanted.length === 0) return { unusable: [], reasons: [], degraded: [], available };
    const unusable = [];
    const reasons = [];
    const degraded = [];
    for (const name of wanted) {
      const info = this.deps.inspectPlaylist(name);
      if (!info || !info.exists) {
        unusable.push(name);
        reasons.push(`"${name}": no such playlist in this scene`);
        continue;
      }
      if (info.loadable === 0) {
        unusable.push(name);
        reasons.push(
          `"${name}": exists but has no loadable entry` +
          (info.missingPatterns && info.missingPatterns.length
            ? ` — its entries reference missing patterns [${info.missingPatterns.join(', ')}]`
            : ' (empty or malformed)'));
        continue;
      }
      if (info.missingPatterns && info.missingPatterns.length) {
        degraded.push(`"${name}" is missing patterns [${info.missingPatterns.join(', ')}]`);
      }
    }
    return { unusable, reasons, degraded, available };
  }

  /**
   * `true` exactly when `show` could be ARMed in this scene right now — a
   * cheap, non-throwing wrapper around `_checkPlaylistsUsable` for the show
   * catalog. A show that fails this is still LISTED as a load error would be
   * (it is valid show data), but the catalog says it cannot run here so a
   * caller — CaptainPad's picker — can decline to offer it, rather than
   * letting the operator ARM into a guaranteed `SPECIAL_EVENT_PLAYLIST_MISSING`
   * refusal.
   */
  isShowUsableHere(show) {
    return this._checkPlaylistsUsable(show).unusable.length === 0;
  }

  /**
   * Report playlist drift (loadable but missing some entries) on `lastError`
   * for a show that IS otherwise usable. Called once at ARM, where drift was
   * previously logged inline; kept as its own step so `_assertPlaylistsUsable`
   * stays a pure "may this ARM" gate.
   */
  _reportPlaylistDrift(show) {
    const { degraded } = this._checkPlaylistsUsable(show);
    if (degraded.length > 0) {
      this.lastError = `playlist drift: ${degraded.join('; ')}`;
      console.warn(`  ⚠ [special-events] ${this.lastError}`);
    }
  }

  // ── stage firing ──────────────────────────────────────────────────────────

  /** Index of the stage that may be fired next (null when the show is done). */
  _armedStageIndex() {
    if (!this.run) return null;
    // The boot-recovery path can hold a run whose show is no longer in the
    // library (the YAML was edited or removed while the engine was down). It
    // is torn down immediately, but nothing may crash on the way there.
    if (!this.run.show) return null;
    if (this.run.status === STATUS.ARMED) return 0;
    if (this.run.status !== STATUS.RUNNING) return null;
    const next = this.run.stageIndex + 1;
    return next < this.run.show.stages.length ? next : null;
  }

  /**
   * Fire the ARMED stage (or re-fire the CURRENT one — restart pulses make that
   * the natural "run it again" gesture). Anything else is refused: the engine
   * is the guard, not just the UI.
   */
  async fire(stageId, choiceId = null) {
    const run = this._requireActiveRun();
    const show = run.show;
    if (typeof stageId !== 'string' || !stageId) {
      throw new SpecialEventError('stageId is required', { status: 400, code: 'STAGE_REQUIRED' });
    }
    const index = show.stages.findIndex((s) => s.id === stageId);
    if (index === -1) {
      throw new SpecialEventError(
        `stage "${stageId}" is not in show "${show.id}" (stages: ${show.stages.map((s) => s.id).join(', ')})`,
        { status: 404, code: 'STAGE_NOT_FOUND' });
    }
    const armedIndex = this._armedStageIndex();
    const isRefire = run.status === STATUS.RUNNING && index === run.stageIndex;
    if (!isRefire && index !== armedIndex) {
      throw new SpecialEventError(
        `stage "${stageId}" is not armed — the armed stage is ` +
        `${armedIndex === null ? '(none — the show is on its last stage)' : `"${show.stages[armedIndex].id}"`}`,
        { status: 409, code: 'STAGE_NOT_ARMED' });
    }

    const stage = show.stages[index];
    let actions;
    let resolvedChoice = null;
    if (stage.kind === 'choice') {
      if (typeof choiceId !== 'string' || !choiceId) {
        throw new SpecialEventError(
          `stage "${stageId}" is a CHOICE stage — choiceId is required ` +
          `(${stage.choices.map((c) => c.id).join(' | ')})`,
          { status: 400, code: 'CHOICE_REQUIRED' });
      }
      resolvedChoice = stage.choices.find((c) => c.id === choiceId);
      if (!resolvedChoice) {
        throw new SpecialEventError(
          `unknown choice "${choiceId}" on stage "${stageId}" ` +
          `(${stage.choices.map((c) => c.id).join(' | ')})`,
          { status: 400, code: 'CHOICE_NOT_FOUND' });
      }
      actions = resolvedChoice.actions;
    } else {
      if (choiceId !== null && choiceId !== undefined) {
        throw new SpecialEventError(
          `stage "${stageId}" takes no choiceId (it is not a CHOICE stage)`,
          { status: 400, code: 'CHOICE_NOT_ALLOWED' });
      }
      actions = stage.actions;
    }

    const now = this.nowFn();
    run.status = STATUS.RUNNING;
    if (run.startedAtMs === null) run.startedAtMs = now;
    run.stageIndex = index;
    run.stageId = stage.id;
    run.choiceId = resolvedChoice ? resolvedChoice.id : null;
    run.stageStartedAtMs = now;
    run.countdownEndsAtMs = stage.advance.mode === 'timed'
      ? now + stage.advance.afterSec * 1000
      : null;

    // ── ROTATION HANDOVER ────────────────────────────────────────────────
    // STOP first, synchronously, before a single action of the new stage
    // lands. The previous stage's swap timer is armed against the previous
    // stage's playlist; letting it survive even one action means a tease
    // pattern can land on top of the blackout the operator just called.
    this._stopRotation('the stage changed');
    const rotation = this._resolveStageAutopilot(show, stage);
    run.autopilot = rotation;
    run.autopilotStageId = rotation ? stage.id : null;
    // The transition config is applied BEFORE the actions so the stage's OWN
    // playlist activation crossfades too — the operator asked for the swap
    // between looks to be soft, and the first one into the stage is a swap.
    //
    // G2 (docs/57 §6, measured in `_231` §5): a stage that authors NO
    // `autopilot:` block used to INHERIT whatever transition the previous stage
    // left on the deck. THE KISS landed its answer playlist as a 5.7 s dissolve
    // it never asked for — under a 900 ms flash, which means the dissolve was
    // still visibly running long after the flash exposed it. A stage with no
    // rotation is a HARD CUT stage: say so explicitly, before its actions.
    if (rotation) this._applyRotationTransition(rotation);
    else this.deps.setDeckTransition({ enabled: false });

    console.log(
      `  🎈 [special-events] "${show.id}" → stage "${stage.id}"` +
      `${resolvedChoice ? ` (${resolvedChoice.id})` : ''}`);
    // A `delayMs: 0` action is applied SYNCHRONOUSLY here, so its failure
    // rejects this call and answers the operator's HTTP request — which is the
    // point. But the Events tab reads `lastError` out of getState(), not the
    // HTTP body, so put it on that surface too before rethrowing. Generic on
    // purpose: any synchronous action failure, not just the palette readback.
    try {
      await this._dispatchActions(actions, `stage ${stage.id}`);
    } catch (err) {
      this.lastError = `stage ${stage.id} refused: ${err && err.message}`;
      console.error(`  ⛔ [special-events] ${this.lastError}`);
      this._broadcast();
      throw err;
    }
    // The CADENCE arms only once the stage's last authored action has landed.
    // The reveal activates its playlist at +700 ms under a white flash; arming
    // the timer at t=0 would start it counting against the playlist the stage
    // is about to replace.
    if (rotation && rotation.active) this._scheduleRotationArm(rotation, actions, stage.id);
    this._persistAndBroadcast();
    return this.getState();
  }

  // ── stage rotation (the show autopilot) ───────────────────────────────────

  /**
   * The EFFECTIVE rotation settings for a stage: the show file's authored
   * block with the operator's persisted live override laid on top. Returns
   * `null` for a stage that authors no `autopilot:` at all — which is how the
   * tab knows not to draw the card, and how the runner knows to leave rotation
   * off while that stage holds.
   */
  _resolveStageAutopilot(show, stage) {
    if (!stage.autopilot || !stage.autopilot.supported) return null;
    const authored = stage.autopilot;
    const override = this._autopilotOverrides.get(this._overrideKey(show.id, stage.id)) || {};
    const pick = (key) => (override[key] !== undefined ? override[key] : authored[key]);
    return {
      active: pick('active'),
      everySec: pick('everySec'),
      shuffle: pick('shuffle'),
      groupMode: pick('groupMode'),
      groupSize: pick('groupSize'),
      groupDwell: pick('groupDwell'),
      transition: { ...authored.transition, ...(override.transition || {}) },
    };
  }

  _applyRotationTransition(rotation) {
    this.deps.setDeckTransition({ ...rotation.transition });
  }

  /**
   * Arm the deck's pattern autopilot with this stage's cadence, once the
   * stage's authored actions have all fired. Generation-scoped exactly like an
   * authored action, so jumping stages cancels a pending arm.
   */
  _scheduleRotationArm(rotation, actions, stageId) {
    let lastDelay = 0;
    for (const action of actions) lastDelay = Math.max(lastDelay, action.delayMs);
    if (lastDelay === 0) {
      this._armRotation(rotation, stageId);
      return;
    }
    this._scheduleActionTimer(lastDelay, this._actionGeneration,
      () => this._armRotation(rotation, stageId));
  }

  _armRotation(rotation, stageId) {
    this.deps.setPatternAutopilot({
      active: true,
      delay_s: rotation.everySec,
      shuffle: rotation.shuffle,
      groupMode: rotation.groupMode,
      groupSize: rotation.groupSize,
      groupDwell: rotation.groupDwell,
    });
    this._rotationArmed = true;
    console.log(
      `  🎈 [special-events] stage "${stageId}" rotation ON — every ${rotation.everySec}s` +
      `${rotation.shuffle ? ', shuffled' : ''}` +
      `${rotation.transition.enabled
        ? `, ${rotation.transition.mode} over ${rotation.transition.durationMs}ms`
        : ', hard cut'}`);
  }

  /**
   * Put the deck's pattern autopilot back OFF if the runner is what turned it
   * on. Never writes when the runner never armed it: ARM already parked the
   * operator's own autopilot and a redundant write would churn the deck's
   * state file and broadcast for nothing.
   */
  _stopRotation(why) {
    if (!this._rotationArmed) return;
    this._rotationArmed = false;
    try {
      this.deps.setPatternAutopilot({ active: false });
      console.log(`  🎈 [special-events] rotation OFF — ${why}`);
    } catch (err) {
      this.lastError = `stopping the stage rotation failed: ${err && err.message}`;
      console.error(`  ⛔ [special-events] ${this.lastError}`);
    }
  }

  /**
   * The LIVE knob (`POST /special-events/autopilot`) — the operator retuning
   * the rotation while the stage holds the rig.
   *
   * Applies immediately AND is remembered: the patch is merged into the
   * persisted override for this show+stage, so re-firing the stage (RESTART
   * TEASE) and next night's show both start where the operator left it.
   * `{ reset: true }` drops the override and returns to the show file.
   */
  async setAutopilot(raw) {
    const run = this._requireActiveRun();
    if (run.status !== STATUS.RUNNING) {
      throw new SpecialEventError(
        'no stage is running — fire a stage before tuning its autopilot',
        { status: 409, code: 'NO_STAGE_RUNNING' });
    }
    const stage = run.show.stages[run.stageIndex];
    if (!run.autopilot) {
      throw new SpecialEventError(
        `stage "${stage.id}" authors no 'autopilot:' block, so it has no pattern ` +
        'rotation to tune — add one to the show YAML to give this stage the controls',
        { status: 400, code: 'NO_STAGE_AUTOPILOT' });
    }

    const key = this._overrideKey(run.showId, stage.id);
    if (isPlainObject(raw) && raw.reset === true) {
      if (Object.keys(raw).length > 1) {
        throw new SpecialEventError(
          "autopilot 'reset' takes no other fields — reset, then tune",
          { status: 400, code: 'AUTOPILOT_INVALID' });
      }
      this._autopilotOverrides.delete(key);
    } else {
      let patch;
      try {
        patch = validateAutopilotPatch(raw);
      } catch (err) {
        throw new SpecialEventError(err && err.message,
          { status: 400, code: 'AUTOPILOT_INVALID' });
      }
      const previous = this._autopilotOverrides.get(key) || {};
      this._autopilotOverrides.set(key, {
        ...previous,
        ...patch,
        // `transition` is a nested object: a patch that names only `durationMs`
        // must not erase a previously overridden `mode`.
        ...(patch.transition
          ? { transition: { ...(previous.transition || {}), ...patch.transition } }
          : {}),
      });
    }

    const rotation = this._resolveStageAutopilot(run.show, stage);
    run.autopilot = rotation;
    run.autopilotStageId = stage.id;
    this._applyRotationTransition(rotation);
    if (rotation.active) {
      this._armRotation(rotation, stage.id);
    } else {
      this._stopRotation('the operator paused the stage rotation');
    }
    this._persistAndBroadcast();
    return this.getState();
  }

  /** Apply the current stage's EXTEND — more time, or an authored action set. */
  async extend() {
    const run = this._requireActiveRun();
    if (run.status !== STATUS.RUNNING) {
      throw new SpecialEventError('no stage is running to extend',
        { status: 409, code: 'NO_STAGE_RUNNING' });
    }
    const stage = run.show.stages[run.stageIndex];
    if (!stage.extend) {
      throw new SpecialEventError(`stage "${stage.id}" defines no extend`,
        { status: 400, code: 'NO_EXTEND' });
    }
    if (stage.extend.addSec !== null) {
      if (run.countdownEndsAtMs === null) {
        throw new SpecialEventError(
          `stage "${stage.id}" has no live countdown to extend`,
          { status: 409, code: 'NO_COUNTDOWN' });
      }
      run.countdownEndsAtMs += stage.extend.addSec * 1000;
    } else {
      await this._dispatchActions(stage.extend.actions, `extend ${stage.id}`, { supersede: false });
    }
    this._persistAndBroadcast();
    return this.getState();
  }

  /**
   * Fire one of the current stage's QUICK EFFECTS — a momentary pulse (strobe,
   * flash all vintage white, …). Does NOT advance the stage and does NOT
   * supersede the stage's own in-flight actions: it is a garnish on top.
   */
  async quickEffect(quickId) {
    const run = this._requireActiveRun();
    if (run.status !== STATUS.RUNNING) {
      throw new SpecialEventError('no stage is running',
        { status: 409, code: 'NO_STAGE_RUNNING' });
    }
    const stage = run.show.stages[run.stageIndex];
    const quick = stage.quickEffects.find((q) => q.id === quickId);
    if (!quick) {
      throw new SpecialEventError(
        `stage "${stage.id}" has no quick effect "${quickId}" ` +
        `(${stage.quickEffects.map((q) => q.id).join(' | ') || 'none'})`,
        { status: 404, code: 'QUICK_EFFECT_NOT_FOUND' });
    }
    await this._dispatchActions(quick.actions, `quick ${stage.id}/${quick.id}`, { supersede: false });
    this._broadcast();
    return this.getState();
  }

  _requireActiveRun() {
    if (!this.run) {
      throw new SpecialEventError('no special event is armed',
        { status: 409, code: 'NO_EVENT_ARMED' });
    }
    return this.run;
  }

  // ── FINISH / ABORT / PANIC ────────────────────────────────────────────────

  /** The polite exit: the same restore ABORT uses, reported as `finished`. */
  async finish() {
    this._requireActiveRun();
    await this._endRun(END_REASON.FINISHED, 'the operator ended the show', { restore: true });
    return this.getState();
  }

  /** Available from `armed` onward. Same restore path as FINISH. */
  async abort(detail = 'the operator aborted the show') {
    this._requireActiveRun();
    await this._endRun(END_REASON.ABORTED, detail, { restore: true });
    return this.getState();
  }

  /**
   * PANIC WINS. Called fire-and-forget from POST /mixer/panic,
   * /global-effect-macros/panic-stop and the blackout ENABLE path — never
   * awaited, because panic latency is untouchable.
   *
   * Ends the show, releases every effect the runner switched on, restores the
   * autopilot flags and hands the timeline back — but deliberately does NOT
   * recall the snapshot and does NOT touch the master. Panic has just
   * established the rig's state on purpose; the runner must not fight it.
   */
  notePanic(why = 'panic') {
    if (!this.run) return;
    this._endRun(END_REASON.PANIC, why, { restore: false }).catch((err) => {
      console.error(`  ⛔ [special-events] panic teardown failed: ${err && err.message}`);
    });
  }

  /** Clear a sticky ENDED card so the tab returns to the show picker. */
  dismiss() {
    if (this.run) {
      throw new SpecialEventError(
        `cannot dismiss while a show is ${this.run.status}`,
        { status: 409, code: 'EVENT_ACTIVE' });
    }
    this.ended = null;
    this._broadcast();
    return this.getState();
  }

  /**
   * The ONE teardown. Every exit — finish, abort, panic, timeline revocation,
   * boot recovery — goes through here so there is exactly one ordering and one
   * set of guarantees.
   *
   * Order (each step individually guarded so no failure can abort the rest):
   *   1. cancel in-flight authored actions, release every pulsed effect
   *   2. restore the pre-show look (skipped for PANIC)
   *   3. restore the autopilot flags
   *   4. hand the timeline back (skipped when the timeline already took it)
   */
  async _endRun(reason, detail, { restore, releaseTimeline = true } = {}) {
    const run = this.run;
    if (!run) return;
    this.run = null;

    this._cancelActionTimers();
    this._releaseAllEffects();
    // Stop the stage rotation BEFORE the restore morph: a swap landing halfway
    // through the 3 s morph would fight it for the deck.
    this._stopRotation(`the show ended (${reason})`);

    let endReason = reason;
    let endDetail = detail;

    if (restore) {
      try {
        this.deps.recallSnapshotFade(EVENT_SNAPSHOT_NAME, RESTORE_MORPH_MS);
      } catch (err) {
        // NEVER LEAVE THE SHIP DARK. A blackout stage may have the master at 0
        // and the recall is what was going to bring it back, so force the
        // pre-show master by hand before reporting the failure.
        endReason = END_REASON.RESTORE_FAILED;
        endDetail = `restoring the pre-show look failed: ${err && err.message}`;
        console.error(`  ⛔ [special-events] ${endDetail}`);
        try {
          const safeMaster = typeof run.priorMaster === 'number' && run.priorMaster > 0
            ? run.priorMaster : 1.0;
          this.deps.setMaster(safeMaster);
          console.error(
            `  ⛔ [special-events] forced the grand master back to ${safeMaster} so the ` +
            'rig is not left dark by the failed restore');
        } catch (masterErr) {
          console.error(
            `  ⛔ [special-events] could not force the master back either: ${masterErr && masterErr.message}`);
        }
      }
    }

    // G1 — put back every global param a `globals` action pinned, and ONLY
    // those. The mixer recall above restores the LOOK; ParamCenter is a
    // different surface it does not reach, so without this a ceremony that
    // pinned SPEED left the whole night slowed down (`_231` §7.1). Skipped for
    // PANIC alongside the look restore: panic is a stop, not a tidy-up.
    if (restore && this._globalsWritten.size > 0) {
      try {
        const prior = run.priorGlobals;
        if (!prior) throw new Error('the ARM globals capture is missing');
        const back = {};
        for (const key of this._globalsWritten) {
          if (!(key in prior)) {
            throw new Error(`'${key}' was not in the pre-show globals capture`);
          }
          back[key] = prior[key];
        }
        this.deps.setGlobals(back);
        console.log(
          `  🎈 [special-events] globals restored — ${Object.keys(back).join(', ')}`);
      } catch (err) {
        console.error(`  ⛔ [special-events] restoring the globals failed: ${err && err.message}`);
        this.lastError = `restore globals: ${err && err.message}`;
      }
    }
    this._globalsWritten.clear();

    // The deck goes back EXACTLY as it was found — flag, cadence and shuffle.
    // A stage may have written all three, so restoring only the flag would
    // leave the operator's deck cycling on the tease's timing.
    try {
      const prior = run.priorPatternAutopilot;
      if (prior) {
        const restore = { active: !!prior.active };
        if (prior.delay_s !== null && prior.delay_s !== undefined) restore.delay_s = prior.delay_s;
        if (prior.shuffle !== null && prior.shuffle !== undefined) restore.shuffle = prior.shuffle;
        this.deps.setPatternAutopilot(restore);
      }
    } catch (err) {
      console.error(`  ⛔ [special-events] restoring the pattern autopilot failed: ${err && err.message}`);
      this.lastError = `restore pattern autopilot: ${err && err.message}`;
    }
    try {
      if (run.priorDeckTransition) this.deps.setDeckTransition({ ...run.priorDeckTransition });
    } catch (err) {
      console.error(`  ⛔ [special-events] restoring the deck transition config failed: ${err && err.message}`);
      this.lastError = `restore deck transition: ${err && err.message}`;
    }
    try {
      if (run.priorColorAutopilot) this.deps.setColorAutopilot({ ...run.priorColorAutopilot });
    } catch (err) {
      console.error(`  ⛔ [special-events] restoring the colour autopilot failed: ${err && err.message}`);
      this.lastError = `restore colour autopilot: ${err && err.message}`;
    }
    if (releaseTimeline && run.leaseHeld && this.timeline) {
      try {
        this.timeline.release(`special event ended (${endReason})`);
      } catch (err) {
        console.error(`  ⛔ [special-events] handing the timeline back failed: ${err && err.message}`);
        this.lastError = `timeline release: ${err && err.message}`;
      }
    }

    this.ended = {
      showId: run.showId,
      showName: run.show ? run.show.name : run.showId,
      reason: endReason,
      detail: endDetail,
      atMs: this.nowFn(),
    };
    const level = endReason === END_REASON.RESTORE_FAILED ? console.error : console.log;
    level(`  🎈 [special-events] "${run.showId}" ENDED — ${endReason}: ${endDetail}`);
    this._persistAndBroadcast();
  }

  // ── action dispatch ───────────────────────────────────────────────────────

  /**
   * Run an authored action set. `delayMs` is an absolute offset from NOW, so a
   * set reads top-to-bottom as a little timeline: this is what makes the
   * reveal's "white flash up, playlist swapped underneath it, flash releases"
   * ordering authored DATA rather than code.
   *
   * Zero-offset actions are applied synchronously so a bad one fails the HTTP
   * request the operator is looking at. Delayed ones are scheduled; a failure
   * there is recorded on `lastError` and broadcast (loud), because by then the
   * response is long gone.
   */
  async _dispatchActions(actions, label, { supersede = true } = {}) {
    if (supersede) this._cancelActionTimers();
    const generation = supersede ? ++this._actionGeneration : this._actionGeneration;
    for (const action of actions) {
      if (action.delayMs === 0) {
        this._applyAction(action, label);
      } else {
        this._scheduleActionTimer(action.delayMs, generation, () => this._applyAction(action, label));
      }
    }
  }

  _scheduleActionTimer(delayMs, generation, fn) {
    const handle = setTimeout(() => {
      this._actionTimers.delete(handle);
      if (generation !== this._actionGeneration) return;
      try {
        fn();
      } catch (err) {
        this.lastError = `delayed action: ${err && err.message}`;
        console.error(`  ⛔ [special-events] delayed action failed: ${err && err.message}`);
        this._broadcast();
      }
    }, delayMs);
    if (typeof handle.unref === 'function') handle.unref();
    this._actionTimers.add(handle);
  }

  _scheduleRelease(delayMs, fn) {
    const handle = setTimeout(() => {
      this._releaseTimers.delete(handle);
      try {
        fn();
      } catch (err) {
        this.lastError = `effect release: ${err && err.message}`;
        console.error(`  ⛔ [special-events] effect release failed: ${err && err.message}`);
      }
    }, delayMs);
    if (typeof handle.unref === 'function') handle.unref();
    this._releaseTimers.add(handle);
  }

  _cancelActionTimers() {
    for (const handle of this._actionTimers) clearTimeout(handle);
    this._actionTimers.clear();
    this._actionGeneration += 1;
  }

  /**
   * Put every effect the runner switched ON back OFF, now. Called on every
   * terminal transition, so a show can never leave a strobe or a white slam
   * latched on the rig.
   *
   * DELIBERATELY INSTANT — the two-argument `setEffect` here is not an
   * oversight. FINISH / ABORT / PANIC teardown must not linger in a decay tail
   * (panic precedence, docs/52 §4.2): an authored `releaseMs` softens the END
   * OF A FLASH, never the end of the SHOW. Do not thread release opts through
   * this path.
   */
  _releaseAllEffects() {
    for (const handle of this._releaseTimers) clearTimeout(handle);
    this._releaseTimers.clear();
    for (const effectId of [...this._activeEffects]) {
      try {
        this.deps.setEffect(effectId, false);
      } catch (err) {
        console.error(
          `  ⛔ [special-events] could not release effect '${effectId}': ${err && err.message}`);
      }
    }
    this._activeEffects.clear();
    if (this._strobeFired) {
      try { this.deps.stopStrobe(); } catch (err) {
        console.error(`  ⛔ [special-events] could not stop the strobe: ${err && err.message}`);
      }
      this._strobeFired = false;
    }
  }

  _applyAction(action, label) {
    switch (action.type) {
      case 'playlist': {
        // `activatePlaylist` is ASYNC — it awaits the deck transition it
        // starts. A stage must NEVER wait out a fade (FIRE has to answer the
        // tab immediately), so this is deliberately not awaited. That leaves
        // the promise with no caller to reject onto, and an escaped rejection
        // reaches the engine's fatal `unhandledRejection` handler — i.e. a bad
        // playlist would kill the rig MID-SHOW instead of refusing. Land it in
        // the same loud contract a delayed action's failure uses: lastError on
        // the wire, a console error, a broadcast. Loud, never silent.
        const activation = this.deps.activatePlaylist(action.playlist, action.entryId);
        if (activation && typeof activation.catch === 'function') {
          activation.catch((err) => {
            this.lastError = `${label}: playlist "${action.playlist}" failed: ${err && err.message}`;
            console.error(`  ⛔ [special-events] ${this.lastError}`);
            this._broadcast();
          });
        }
        return;
      }
      case 'control':
        if (action.pulse) {
          this.deps.setDeckControl(action.control, 1.0);
          this._scheduleRelease(action.pulseMs, () => this.deps.setDeckControl(action.control, 0.0));
        } else {
          this.deps.setDeckControl(action.control, action.value);
        }
        return;
      case 'masterFade':
        this.deps.fadeMaster(action.target, action.durationMs);
        return;
      case 'globals':
        this.deps.setGlobals(action.set);
        // VERIFY IT LANDED. `setGlobals` is not a promise that the write took:
        // api_server's dep treats a ParamCenter `source_lock` refusal as
        // runtime arbitration and CONTINUES WITHOUT ERROR, so with Live Touch
        // holding the lock the palette write is silently dropped. The Baby
        // Reveal patterns used to fail safe to BLACK in that case; under the v2
        // palette contract (docs/73 §2.4-v2) they render whatever colour is
        // live instead — i.e. a swallowed write now shows the WRONG COLOUR at
        // the one moment that must not be wrong. So the dispatch path reads the
        // values back and refuses. No fallback, no retry.
        this._assertGlobalsLanded(action.set, label);
        // Remember WHAT was pinned so the end of the show can put back exactly
        // those keys (G1). Recorded after the write AND after the readback, so
        // a refused set leaves nothing to restore.
        for (const key of Object.keys(action.set)) this._globalsWritten.add(key);
        return;
      case 'effect':
        this._applyEffectAction(action);
        return;
      default:
        throw new Error(`${label}: unhandled action type '${action.type}'`);
    }
  }

  /**
   * Assert that every key a `globals` action just wrote is actually live in
   * ParamCenter. Throws — loudly, by key — if any of them is not.
   *
   * WHY A READBACK IS PROOF. `captureGlobals` (already a REQUIRED_DEP, used by
   * ARM to record the pre-show globals) flattens ParamCenter's CANONICAL state
   * — the TARGET value of each param, not the `_rendered` value that ramps
   * toward it over `colorTransitionMs`. So a matching readback means the write
   * was ACCEPTED, and does not merely mean a slew happens to have finished.
   * A refused write leaves the canonical value untouched, which is exactly the
   * failure this catches.
   *
   * SCOPE. `type: globals` appears today ONLY in the two `baby_reveal.yaml`
   * show files, so this verification is generic in shape but in practice
   * guards the reveal's palette and nothing else.
   *
   * The reveal's globals action sits at `delayMs: 0`, so it is applied
   * synchronously inside `fire()` and this throw propagates out of `fire()` to
   * the operator's HTTP request: the show REFUSES TO START the run rather than
   * starting it in a stale colour.
   */
  _assertGlobalsLanded(set, label) {
    let live;
    try {
      live = this.deps.captureGlobals();
    } catch (err) {
      throw new Error(
        `${label}: the globals write cannot be verified — reading ParamCenter back failed ` +
        `(${err && err.message}). The show refuses to run on an unverified palette.`);
    }
    if (!isPlainObject(live)) {
      throw new Error(
        `${label}: the globals write cannot be verified — captureGlobals() returned ` +
        `${formatGlobalValue(live)} instead of a param map. The show refuses to run on an ` +
        'unverified palette.');
    }
    for (const [key, wrote] of Object.entries(set)) {
      const present = Object.prototype.hasOwnProperty.call(live, key);
      const read = present ? live[key] : undefined;
      if (present && globalsValueMatches(wrote, read)) continue;
      throw new Error(
        `${label}: the globals write DID NOT LAND — '${key}' was written as ` +
        `${formatGlobalValue(wrote)} but ParamCenter reads back ` +
        `${present ? formatGlobalValue(read) : '(no such param)'}. The likely cause is a ` +
        'source_lock refusal — Live Touch is armed and holding the params, and setGlobals ' +
        'treats that as runtime arbitration and swallows it without error. NO FALLBACK: the ' +
        'stage refuses rather than running the show on a stale colour.');
    }
  }

  /**
   * The authored RELEASE envelope for an effect action's FALLING edge, or
   * `undefined` when the action authors none — and `undefined` matters: it
   * leaves `setEffect` a two-argument call, which is the historical hard cut
   * bit-for-bit. Never synthesized: a show that did not ask for a soft exit
   * does not get one.
   */
  _releaseOptsFor(action) {
    if (!action.releaseMs) return undefined;
    return { releaseMs: action.releaseMs, releaseTo: action.releaseTo };
  }

  /**
   * Turn an effect OFF, carrying the action's release envelope only when it
   * authored one. The no-release branch is a genuine TWO-ARGUMENT call — not a
   * third `undefined` — so an unauthored falling edge is indistinguishable from
   * every pre-`_240` call site, all the way down to arity.
   */
  _setEffectOff(action) {
    const opts = this._releaseOptsFor(action);
    if (opts) this.deps.setEffect(action.effectId, false, opts);
    else this.deps.setEffect(action.effectId, false);
  }

  _applyEffectAction(action) {
    if (action.effectId === 'strobe') {
      if (action.toggle) {
        if (this._strobeFired) {
          this.deps.stopStrobe();
          this._strobeFired = false;
        } else {
          this.deps.startStrobe(action.hz);
          this._strobeFired = true;
        }
        return;
      }
      // `fadeOutMs` rides the controller's existing strobeFadingOut blend; 0 is
      // the snap-off (schema default).
      this.deps.fireStrobeBurst(action.hz, action.durationMs, action.fadeOutMs || 0);
      this._strobeFired = true;
      // The controller's burst window ends the strobe itself; this release only
      // clears the runner's bookkeeping (and hard-stops it if the burst window
      // somehow outlives its frames). A fading burst gets its tail before the
      // hard stop lands, otherwise the runner's own cleanup would cut the fade.
      this._scheduleRelease(action.durationMs + (action.fadeOutMs || 0) + 250, () => {
        this._strobeFired = false;
        this.deps.stopStrobe();
      });
      return;
    }
    if (action.holdMs !== null) {
      this.deps.setEffect(action.effectId, true);
      this._activeEffects.add(action.effectId);
      this._scheduleRelease(action.holdMs, () => {
        this._activeEffects.delete(action.effectId);
        this._setEffectOff(action);
      });
      return;
    }
    if (action.state) {
      // A rising edge has no release to carry (the schema refuses one).
      this.deps.setEffect(action.effectId, true);
      this._activeEffects.add(action.effectId);
      return;
    }
    this._setEffectOff(action);
    this._activeEffects.delete(action.effectId);
  }

  // ── tick ──────────────────────────────────────────────────────────────────

  async _tick() {
    if (this._ticking) return;
    this._ticking = true;
    try {
      if (!this.run) return;

      // ABSOLUTE SHOW LEASE. Operator activity may refresh the short timeline
      // takeover, but it cannot move this ARM-time deadline. An abandoned
      // Tease, Blackout, or Reveal therefore cannot own the rig all night.
      if (this.run.leaseExpiresAtMs !== null
          && this.nowFn() >= this.run.leaseExpiresAtMs) {
        await this._endRun(
          END_REASON.FINISHED,
          'the special-event lease expired — pre-show state restored and the show disarmed',
          { restore: true });
        return;
      }

      // 1. TIMELINE AUTHORITY. The plan outranks the event (operator ruling
      //    2026-08-14, report `_200`). If the lease we took at ARM is gone, the
      //    plan resumed or its lease expired — either way the rig is no longer
      //    ours and the show ABORTS with the restore, loudly. We never take it
      //    back: re-seizing would be exactly the automatic re-seizure `_200`
      //    removed from Live Touch.
      if (this.run.leaseHeld && this.timeline) {
        let held = true;
        try {
          held = this.timeline.authorityHeld();
        } catch (err) {
          // Reading the timeline must never crash the runner; treat an
          // unreadable timeline as "still ours" and say so.
          this.lastError = `timeline authority read: ${err && err.message}`;
          console.warn(`  ⚠ [special-events] could not read timeline authority: ${err && err.message}`);
        }
        if (!held) {
          console.warn(
            '  ⚠ [special-events] THE TIMELINE TOOK THE RIG BACK (resume or lease expiry) — ' +
            'the show plan is high priority, so the special event aborts and restores');
          await this._endRun(
            END_REASON.ABORTED,
            'the timeline resumed and took the rig back — the show plan is high priority',
            { restore: true, releaseTimeline: false });
          return;
        }
        // Keep the lease alive exactly like CaptainPad does while the operator
        // is working. Never arms a lease of its own.
        try { this.timeline.activity(); } catch (err) {
          this.lastError = `timeline keep-alive: ${err && err.message}`;
        }
      }

      // 2. AUTO-ADVANCE. A timed stage fires the armed next stage on expiry;
      //    tapping the armed button early always wins (manual pre-empts).
      if (this.run.status === STATUS.RUNNING && this.run.countdownEndsAtMs !== null
          && this.nowFn() >= this.run.countdownEndsAtMs) {
        const nextIndex = this._armedStageIndex();
        this.run.countdownEndsAtMs = null;
        if (nextIndex === null) {
          // Last stage's countdown elapsed with nothing to advance to. That is
          // the show's own polite end.
          await this._endRun(END_REASON.FINISHED, 'the final stage timed out', { restore: true });
          return;
        }
        const nextStage = this.run.show.stages[nextIndex];
        if (nextStage.kind === 'choice') {
          // A CHOICE cannot be auto-fired — the whole point is that a human
          // picks. Hold here and say so rather than guessing a variant.
          this.lastError =
            `stage "${nextStage.id}" is a CHOICE stage and cannot auto-advance — waiting for the operator`;
          console.warn(`  ⚠ [special-events] ${this.lastError}`);
        } else {
          await this.fire(nextStage.id);
          return;
        }
      }

      this._broadcast();
    } finally {
      this._ticking = false;
    }
  }

  // ── wire ──────────────────────────────────────────────────────────────────

  /** The complete runner state. The WS frame and GET /special-events/state are
   *  the same object — the tab has no second shape to keep in sync. */
  getState() {
    const now = this.nowFn();
    const run = this.run;
    const show = run ? run.show : null;
    const armedIndex = this._armedStageIndex();
    return {
      type: 'specialEvents',
      scene: this.scene,
      // `ended` is the sticky card the tab shows until the operator dismisses
      // it — the ONE status that outlives the run record.
      status: run ? run.status : (this.ended ? STATUS.ENDED : STATUS.IDLE),
      showId: run ? run.showId : (this.ended ? this.ended.showId : null),
      showName: show ? show.name : (this.ended ? this.ended.showName : null),
      showColor: show ? show.color : null,
      showIcon: show ? show.icon : null,
      stages: show ? summarizeShow(show).stages : [],
      stageIndex: run ? run.stageIndex : null,
      stageId: run ? run.stageId : null,
      choiceId: run ? run.choiceId : null,
      armedStageIndex: armedIndex,
      armedStageId: armedIndex === null || !show ? null : show.stages[armedIndex].id,
      stageElapsedSec: run && run.stageStartedAtMs !== null
        ? Math.max(0, Math.round((now - run.stageStartedAtMs) / 1000)) : null,
      countdownSec: run && run.countdownEndsAtMs !== null
        ? Math.max(0, Math.ceil((run.countdownEndsAtMs - now) / 1000)) : null,
      armedAtMs: run ? run.armedAtMs : null,
      startedAtMs: run ? run.startedAtMs : null,
      showLeaseExpiresAtMs: run ? run.leaseExpiresAtMs : null,
      showLeaseRemainingSec: run && run.leaseExpiresAtMs !== null
        ? Math.max(0, Math.ceil((run.leaseExpiresAtMs - now) / 1000)) : null,
      timelineLeaseHeld: run ? run.leaseHeld : false,
      // Toggle quick effects need a live state, not merely an "actionable"
      // button. Pulse effects are deliberately absent: they self-release and
      // are represented as READY in CaptainPad rather than pretending to be ON.
      quickEffectStates: run && run.status === STATUS.RUNNING && show
        ? Object.fromEntries(
          show.stages[run.stageIndex].quickEffects
            .filter((quick) => quick.actions.some(
              (action) => action.type === 'effect' && action.toggle === true))
            .map((quick) => [quick.id, quick.actions.some(
              (action) => action.effectId === 'strobe' && action.toggle === true)
              ? this._strobeFired
              : false]),
        )
        : {},
      // The LIVE rotation controls for the stage holding the rig. `supported`
      // is what the tab gates the AUTOPILOT card on; `null` fields would make
      // the card guess, so the block is always complete and always honest.
      autopilot: this._autopilotWire(),
      endedReason: this.ended ? this.ended.reason : null,
      endedDetail: this.ended ? this.ended.detail : null,
      endedAtMs: this.ended ? this.ended.atMs : null,
      lastError: this.lastError,
      // `playlistsUsable` is computed fresh per frame (cheap — a handful of
      // playlist stat calls) so a playlist saved or removed mid-session is
      // reflected on the very next tick, not just after a reload. It is the
      // non-throwing ARM question (`isShowUsableHere`), so a card the picker
      // offers as tappable is a card ARM will actually accept.
      shows: this.shows.map((s) => ({ ...summarizeShow(s), playlistsUsable: this.isShowUsableHere(s) })),
      loadErrors: this.loadErrors,
    };
  }

  /**
   * The `autopilot` half of the wire document.
   *
   * `supported:false` (idle, or a stage that authors no block) still carries a
   * complete settings object so the tab never has to invent one to render a
   * disabled card. `nextSwapAtMs` is read from the deck daemon itself, so the
   * countdown on this card is the SAME clock the deck's own card shows.
   */
  _autopilotWire() {
    const run = this.run;
    const rotation = run ? run.autopilot : null;
    if (!rotation) {
      return {
        supported: false,
        stageId: null,
        active: false,
        everySec: null,
        shuffle: false,
        groupMode: false,
        groupSize: null,
        groupDwell: null,
        transition: null,
        nextSwapAtMs: null,
        nowPlaying: null,
        overridden: false,
      };
    }
    let nextSwapAtMs = null;
    try {
      const live = this.deps.getPatternAutopilot();
      nextSwapAtMs = live && typeof live.nextSwapAtMs === 'number' ? live.nextSwapAtMs : null;
    } catch (err) {
      // Reading the deck must never break the frame the operator is watching.
      this.lastError = `reading the deck autopilot failed: ${err && err.message}`;
    }
    return {
      nowPlaying: this._readNowPlaying(),
      supported: true,
      stageId: run.autopilotStageId,
      active: rotation.active,
      everySec: rotation.everySec,
      shuffle: rotation.shuffle,
      groupMode: rotation.groupMode,
      groupSize: rotation.groupSize,
      groupDwell: rotation.groupDwell,
      transition: { ...rotation.transition },
      nextSwapAtMs,
      overridden: this._autopilotOverrides.has(
        this._overrideKey(run.showId, run.autopilotStageId)),
    };
  }

  /**
   * The deck's active playlist entry, or `null` when the deck has none to name.
   *
   * Guarded exactly like the `nextSwapAtMs` read above: a deck that cannot be
   * read must never break the frame the operator is watching — the card just
   * has no name to show.
   *
   * A rotation SWAP changes deck state without firing a `specialEvents` frame
   * of its own, and it needs none: the runner's 1 s `_tick()` broadcasts the
   * whole state while a run is live, so a new pattern name reaches the tab
   * within a second of the swap on a cadence measured in seconds. No new timer,
   * no coupling to the deck's own frames.
   */
  _readNowPlaying() {
    try {
      const np = this.deps.getDeckNowPlaying();
      if (!np) return null;
      return { pattern: np.pattern || null, label: np.label || null };
    } catch (err) {
      this.lastError = `reading the deck's now-playing entry failed: ${err && err.message}`;
      return null;
    }
  }

  _broadcast() {
    try {
      this.broadcast(this.getState());
    } catch (err) {
      console.warn(`  ⚠ [special-events] broadcast failed: ${err && err.message}`);
    }
  }

  _persistAndBroadcast() {
    this._persist();
    this._broadcast();
  }

  /** True while a show holds the rig — api_server's SPECIAL_EVENT write gate. */
  holdsRig() {
    return !!this.run;
  }
}
