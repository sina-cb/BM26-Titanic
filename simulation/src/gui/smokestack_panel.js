/**
 * smokestack_panel.js — the "🌫 Smokestack Ropes" section of the controller
 * mapping pane: current DMX ⇄ swarm mode per rope controller at a glance, and
 * the guided, operator-gated switch flow.
 *
 * Rendering is dumb on purpose: every decision (which cards are ropes, what a
 * board's chips say, whether APPLY may arm, what a finished run means) lives
 * in the PURE model src/dmx/smokestack_mode.js, where the tests pin it.
 *
 * Data paths (see the model header for the full story):
 *   glance   POST /smokestack/status — read-only, fired when the operator
 *            opens the pane or presses Refresh. Never on a timer.
 *   switch   POST /smokestack/run — the private deploy CLI, dry-run first,
 *            then a typed-phrase apply that references that dry-run. The sim
 *            server enforces the same two-step; this UI is the front of it.
 *
 * The section repaints ITSELF in place (its own container only) so an async
 * status/job update never tears down the rest of the pane mid-edit.
 */

import {
  smokestackTargets,
  smokestackBoardModel,
  smokestackFleetModel,
  smokestackFleetToggleModel,
  smokestackRepairModel,
  smokestackForceRecoveryModel,
  smokestackControllerTransitionModel,
  smokestackJobPhase,
  jobOutcomeModel,
  applyGateModel,
  forceConfirmPhrase,
  forceFleetVerdict,
  preflightDigest,
  ACTION_TO_DMX,
  ACTION_TO_SWARM,
  ACTION_REPAIR_TO_DMX,
  ACTION_FORCE_TO_DMX,
  ACTION_FORCE_TO_SWARM,
  FORCE_ACTIONS,
  MODE_DMX,
  MODE_SWARM,
  MODE_INVALID,
  MODE_UNKNOWN,
  MODE_UNREACHABLE,
  CONFIRM_PHRASES,
  TRUSTED_OUTCOME_KINDS,
  TRUSTED_APPLY_OUTCOME_KINDS,
  SMOKESTACK_LEADER_CONTROLLER_ID,
  REPAIR_READBACK_MAX_AGE_MS,
} from '../dmx/smokestack_mode.js';
import { saveHttpUrl } from '../core/save_endpoint.js';
import { isStaticHost, logStaticHostSkip } from '../core/static_host.js';

// ── Section state (module-scoped, survives pane re-renders) ────────────────
let containerEl = null;      // live .smk-group element (repaint target)
let lastTargets = [];        // targets of the last render (repaint input)
let collapsed = false;       // session-scoped, like the pane's type groups
let advancedOpen = false;    // survives status/job updates and parent re-renders
// Advanced Recovery (force ONE controller) — collapsed by default; its open
// state, selected controller and previewed direction survive repaints exactly
// like advancedOpen does.
let recoveryOpen = false;
let recoverySelection = null;
let recoveryAction = ACTION_FORCE_TO_DMX;
let sectionRefs = null;      // persistent keyed DOM; async updates mutate it in place
let targetSignature = '';

const statusResults = new Map(); // target id → /smokestack/status result
let statusSweeping = false;
let statusSweptOnce = false; // one automatic sweep per page load, on first render
let statusError = null;      // last sweep failure message (rendered inline)
let statusSweepPromise = null;
let latestStatusReadback = { sweptAt: 0, resultIds: new Set() };
let repairStaleTimer = null;

let provision = null;        // GET /smokestack/provision result, or null
let provisionError = null;

// The switch flow: null, or { action, dryRunJob, applyJob, typed }.
let flow = null;
let flowError = null;        // last /smokestack/run refusal (rendered inline)
let pollTimer = null;
const postJobReadbacks = new Set();

const JOB_POLL_MS = 1200;

function sameTargetIds(left, right) {
  return Array.isArray(left) && Array.isArray(right)
    && left.length === right.length && left.every((value, index) => value === right[index]);
}

function scheduleRepairFreshnessRepaint() {
  if (repairStaleTimer !== null) clearTimeout(repairStaleTimer);
  const delay = Math.max(0,
    latestStatusReadback.sweptAt + REPAIR_READBACK_MAX_AGE_MS - Date.now() + 1);
  repairStaleTimer = setTimeout(() => {
    repairStaleTimer = null;
    repaint();
  }, delay);
}

// ── Networking ──────────────────────────────────────────────────────────────

function repaint() {
  if (!containerEl || !containerEl.isConnected) return;
  preserveMainScroll(() => updateSection(lastTargets));
}

function preserveMainScroll(update) {
  const scroller = containerEl && containerEl.closest('.cm-main');
  const scrollTop = scroller ? scroller.scrollTop : null;
  update();
  if (scroller && scrollTop !== null) scroller.scrollTop = scrollTop;
}

function refreshProvision() {
  return fetch(saveHttpUrl('/smokestack/provision'))
    .then((res) => res.json())
    .then((body) => {
      if (!body || body.ok !== true) throw new Error((body && body.error) || 'no result');
      provision = body;
      provisionError = null;
    })
    .catch((err) => {
      provision = null;
      provisionError = `could not read provisioning state: ${err.message} — if the sim stack ` +
        'predates this feature, restart it so the save server serves /smokestack/*';
    })
    .then(repaint);
}

export function refreshSmokestackStatuses({ readbackJobId = null } = {}) {
  if (statusSweeping) return statusSweepPromise || Promise.resolve(null);
  if (lastTargets.length === 0) return Promise.resolve(null);
  if (isStaticHost()) {
    logStaticHostSkip('smokestack mode status (port 6970)');
    return Promise.resolve(null);
  }
  statusSweeping = true;
  if (readbackJobId !== null && flow) {
    flow.readback = { jobId: readbackJobId, state: 'running', resultIds: new Set() };
  }
  repaint();
  statusSweepPromise = fetch(saveHttpUrl('/smokestack/status'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      targets: lastTargets.map((t) => ({ id: t.id, name: t.name, ip: t.ip })),
    }),
  })
    .then((res) => res.json())
    .then((body) => {
      if (!body || body.ok !== true) {
        throw new Error((body && body.error) || 'status sweep returned no result');
      }
      for (const r of body.results || []) statusResults.set(r.id, r);
      latestStatusReadback = {
        sweptAt: Date.now(),
        resultIds: new Set((body.results || []).map((result) => result.id)),
      };
      scheduleRepairFreshnessRepaint();
      if (readbackJobId !== null && flow && flow.readback
          && flow.readback.jobId === readbackJobId) {
        flow.readback = {
          jobId: readbackJobId,
          state: 'done',
          resultIds: new Set((body.results || []).map((result) => result.id)),
        };
      }
      statusError = null;
    })
    .catch((err) => {
      // A failed SWEEP is not a board state. Every row keeps its previous
      // verdict; the failure is named inline.
      statusError = `status sweep failed: ${err.message}`;
      if (readbackJobId !== null && flow && flow.readback
          && flow.readback.jobId === readbackJobId) {
        flow.readback = { jobId: readbackJobId, state: 'error', resultIds: new Set() };
      }
      console.error(`[Smokestack] ✋ ${statusError}`);
    })
    .then(() => {
      statusSweeping = false;
      statusSweepPromise = null;
      repaint();
    });
  return statusSweepPromise;
}

function queuePostJobReadback(job) {
  if (!job || postJobReadbacks.has(job.id)) return;
  postJobReadbacks.add(job.id);
  if (flow) flow.readback = { jobId: job.id, state: 'pending', resultIds: new Set() };
  const afterCurrentSweep = statusSweepPromise || Promise.resolve();
  afterCurrentSweep.then(() => refreshSmokestackStatuses({ readbackJobId: job.id }));
}

function startRun(action, { apply = false, targetIds = null, force = null } = {}) {
  const payload = { action, apply };
  let frozenTargetIds = null;
  if (action === ACTION_REPAIR_TO_DMX) {
    const sourceIds = apply && flow ? flow.targetIds : targetIds;
    if (!Array.isArray(sourceIds) || sourceIds.length === 0) {
      flowError = 'repair refused: exact controller target set is missing';
      repaint();
      return Promise.resolve();
    }
    frozenTargetIds = [...sourceIds].sort();
    payload.targetIds = frozenTargetIds;
  }
  let forceContext = force;
  if (FORCE_ACTIONS.includes(action)) {
    if (apply && flow) forceContext = flow.force;
    if (!forceContext || !forceContext.controllerId) {
      flowError = 'force refused: exact controller selection is missing';
      repaint();
      return Promise.resolve();
    }
    frozenTargetIds = [forceContext.controllerId];
    payload.targetIds = frozenTargetIds;
    // The digest is recomputed from the readback state RIGHT NOW: an apply
    // whose fleet drifted since its dry-run is refused by the server.
    payload.preflightDigest = apply
      ? preflightDigest(lastTargets, statusResults) : forceContext.preflightDigest;
    if (forceContext.leaderContext) payload.leaderContext = forceContext.leaderContext;
  }
  if (apply && flow) {
    payload.confirm = flow.typed;
    payload.dryRunJobId = flow.dryRunJob && flow.dryRunJob.id;
  }
  flowError = null;
  return fetch(saveHttpUrl('/smokestack/run'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
    .then((res) => res.json())
    .then((body) => {
      if (!body || body.ok !== true) {
        throw new Error((body && body.error) || 'run refused with no reason');
      }
      if ((action === ACTION_REPAIR_TO_DMX || FORCE_ACTIONS.includes(action))
          && !sameTargetIds(body.job && body.job.targetIds, frozenTargetIds)) {
        throw new Error('run refused: server job target set does not match the frozen plan');
      }
      if (FORCE_ACTIONS.includes(action)
          && !sameTargetIds(body.job && body.job.cliNames, forceContext.cliNames)) {
        throw new Error('force refused: server CLI target names do not match the frozen plan');
      }
      if (apply) {
        flow.applyJob = body.job;
      } else {
        flow = {
          action,
          targetIds: frozenTargetIds,
          controllerId: forceContext ? forceContext.controllerId : null,
          force: forceContext,
          preUptimeMs: forceContext ? forceContext.preUptimeMs : null,
          dryRunJob: body.job,
          applyJob: null,
          typed: '',
        };
      }
      schedulePoll();
    })
    .catch((err) => {
      flowError = err.message;
      console.error(`[Smokestack] ✋ run refused: ${err.message}`);
    })
    .then(repaint);
}

function activeJob() {
  if (!flow) return null;
  if (flow.applyJob && flow.applyJob.state !== 'done') return flow.applyJob;
  if (flow.dryRunJob && flow.dryRunJob.state !== 'done') return flow.dryRunJob;
  return null;
}

function schedulePoll() {
  if (pollTimer !== null) return;
  pollTimer = setInterval(() => {
    const job = activeJob();
    if (!job) {
      clearInterval(pollTimer);
      pollTimer = null;
      return;
    }
    fetch(saveHttpUrl(`/smokestack/job?id=${encodeURIComponent(job.id)}`))
      .then((res) => res.json())
      .then((body) => {
        if (!body || body.ok !== true) throw new Error((body && body.error) || 'no job');
        if (flow && flow.applyJob && flow.applyJob.id === body.job.id) flow.applyJob = body.job;
        if (flow && flow.dryRunJob && flow.dryRunJob.id === body.job.id) flow.dryRunJob = body.job;
        if (body.job.state === 'done') {
          clearInterval(pollTimer);
          pollTimer = null;
          // Exactly one bounded readback follows EVERY completed job, including
          // a refused dry-run. Exit status never substitutes for saved/runtime
          // state on the four exact controllers.
          queuePostJobReadback(body.job);
        }
        repaint();
      })
      .catch((err) => {
        // Keep polling; a single dropped poll says nothing about the run.
        console.error(`[Smokestack] job poll failed: ${err.message}`);
      });
  }, JOB_POLL_MS);
}

// ── Rendering ────────────────────────────────────────────────────────────────

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function actionLabel(action) {
  if (action === ACTION_REPAIR_TO_DMX) return 'repair selected controllers to DMX';
  if (action === ACTION_FORCE_TO_DMX) {
    return `FORCE ${flow && flow.controllerId ? flow.controllerId : 'one controller'} to DMX`;
  }
  if (action === ACTION_FORCE_TO_SWARM) {
    return `FORCE ${flow && flow.controllerId ? flow.controllerId : 'one controller'} to SWARM`;
  }
  return action === ACTION_TO_DMX ? 'switch ALL ropes to DMX' : 'switch ALL ropes to SWARM';
}

/** The current force decision for the selected controller + previewed action. */
function currentForceModel() {
  return smokestackForceRecoveryModel(lastTargets, statusResults, {
    ...latestStatusReadback,
    sweeping: statusSweeping,
  }, { controllerId: recoverySelection, action: recoveryAction });
}

function formatPoint(point) {
  return `(${point.x}, ${point.y}, ${point.z})`;
}

function createCompactRows(targets) {
  const rows = el('div', 'smk-rows');
  const refs = new Map();
  for (const target of targets) {
    const row = el('div', 'smk-row');
    row.dataset.controllerId = target.controllerId;
    row.dataset.filterTags = target.filterTag;

    const name = el('span', 'smk-row-name', target.operatorLabel);
    row.appendChild(name);

    const identity = el('span', 'smk-row-identity', target.controllerId);
    row.appendChild(identity);

    const mode = el('span', 'smk-chip');
    row.appendChild(mode);

    const state = el('span', 'smk-row-state');
    const readiness = el('span', 'smk-readiness');
    state.appendChild(readiness);
    const transition = el('span', 'smk-transition');
    state.appendChild(transition);
    const repair = el('span', 'smk-repair-badge');
    repair.hidden = true;
    state.appendChild(repair);
    row.appendChild(state);
    rows.appendChild(row);
    refs.set(target.controllerId, { row, mode, readiness, transition, repair });
  }
  return { rows, refs };
}

function updateCompactRows(targets, refs, repairModel) {
  const job = flow && (flow.applyJob || flow.dryRunJob);
  const readback = flow && flow.readback;
  for (const target of targets) {
    const status = statusResults.get(target.id) || null;
    const model = smokestackBoardModel(target, status);
    const ref = refs.get(target.controllerId);
    if (!ref) continue;
    ref.row.title = model.detail;
    ref.mode.className = `smk-chip ${model.modeCls}`;
    ref.mode.textContent = statusSweeping && !statusResults.has(target.id)
      ? '⋯' : model.modeLabel;
    ref.readiness.className = `smk-readiness${model.roleOk ? ' smk-readiness-ok' : ''}`;
    ref.readiness.textContent = model.readinessLabel;
    const readbackStatus = readback && readback.state === 'done'
      && !readback.resultIds.has(target.id) ? null : status;
    const transition = smokestackControllerTransitionModel(
      target, job || null, readbackStatus, readback || null,
      { preUptimeMs: flow && flow.preUptimeMs });
    ref.transition.className = `smk-transition ${transition.cls}`;
    ref.transition.textContent = transition.label;
    ref.transition.hidden = transition.label.length === 0;
    const repair = repairModel && repairModel.rows.get(target.controllerId);
    ref.repair.hidden = !(repairModel && repairModel.visible && repair);
    ref.repair.className = `smk-repair-badge ${repair ? repair.cls : ''}`;
    ref.repair.textContent = repair ? repair.label : '';
  }
}

function updateJobBanner(refs, targets) {
  const job = flow && (flow.applyJob || flow.dryRunJob);
  if (!job) {
    refs.banner.hidden = !flowError;
    if (flowError) {
      refs.banner.className = 'smk-job-banner smk-job-banner-danger';
      refs.banner.setAttribute('role', 'alert');
      refs.banner.setAttribute('aria-live', 'assertive');
      refs.phase.textContent = 'RUN REFUSED';
      refs.headline.textContent = flowError;
      refs.verdict.textContent = 'Trusted verdict: NONE';
      refs.readback.textContent = 'Final four-controller readback: not started';
      refs.progress.className = 'smk-job-progress';
      refs.progress.textContent = 'Operation did not start';
      for (const segment of refs.segments.values()) {
        segment.className = 'smk-job-segment smk-transition-danger';
        segment.textContent = `${segment.textContent.split(' ')[0]} not started`;
      }
    }
    return;
  }
  const outcome = jobOutcomeModel(job);
  const phase = `${job.apply ? 'APPLY' : 'DRY-RUN'} · ${smokestackJobPhase(job)}`;
  const forceId = Array.isArray(job.targetIds) && job.targetIds.length === 1
    ? job.targetIds[0] : '?';
  const direction = job.action === ACTION_FORCE_TO_DMX ? `FORCE TO DMX ${forceId}`
    : job.action === ACTION_FORCE_TO_SWARM ? `FORCE TO SWARM ${forceId}`
      : job.action === ACTION_TO_SWARM ? 'TO SWARM'
        : job.action === ACTION_REPAIR_TO_DMX ? 'REPAIR TO DMX' : 'TO DMX';
  const isForce = FORCE_ACTIONS.includes(job.action);
  // A dry-run's completed readback must never be mistaken for the active
  // APPLY's final readback. Final evaluation starts only after THIS job ends
  // and queues its own bounded sweep.
  const readback = flow.readback && flow.readback.jobId === job.id ? flow.readback : null;
  const readbackBoards = readback && readback.state === 'done'
    ? targets.map((target) => ({
      target,
      board: smokestackBoardModel(target,
        readback.resultIds.has(target.id) ? statusResults.get(target.id) || null : null),
    })) : [];
  const expectedMode = job.action === ACTION_TO_SWARM || job.action === ACTION_FORCE_TO_SWARM
    ? MODE_SWARM : MODE_DMX;
  const readbackFailures = readbackBoards.filter(({ target, board }) => {
    const targeted = (job.action !== ACTION_REPAIR_TO_DMX && !isForce)
      || (Array.isArray(job.targetIds) && job.targetIds.includes(target.controllerId));
    return (
    board.mode === MODE_UNREACHABLE || board.mode === MODE_UNKNOWN || board.mode === MODE_INVALID
    || (job.apply && targeted && board.mode !== expectedMode)
    || (job.apply && job.action === ACTION_TO_SWARM && !board.roleOk));
  });
  const readbackComplete = !!(readback && readback.state === 'done'
    && readback.resultIds.size === targets.length);
  const cliTrusted = TRUSTED_OUTCOME_KINDS.includes(outcome.kind);
  const trusted = cliTrusted && (!job.apply || (readbackComplete && readbackFailures.length === 0));
  const failed = (job.state === 'done' && !TRUSTED_OUTCOME_KINDS.includes(outcome.kind))
    || (readback && readback.state === 'error') || readbackFailures.length > 0;
  refs.banner.hidden = false;
  refs.banner.setAttribute('role', failed ? 'alert' : 'status');
  refs.banner.setAttribute('aria-live', failed ? 'assertive' : 'polite');
  refs.banner.className = `smk-job-banner ${failed ? 'smk-job-banner-danger'
    : job.state === 'done' && trusted ? 'smk-job-banner-ok' : 'smk-job-banner-running'}`;
  refs.phase.textContent = `${phase} · ${direction} · ${job.state === 'done'
    ? `EXIT ${job.exitCode}` : 'RUNNING'}`;
  const awaitingApplyReadback = job.apply && job.state === 'done' && !readbackComplete && !failed;
  refs.headline.textContent = awaitingApplyReadback
    ? 'CLI completed — awaiting independent four-controller readback; no fleet verdict yet.'
    : readback && readback.state === 'error'
      ? 'FINAL READBACK FAILED — fleet is NOT verified; do not act on the CLI verdict.'
    // A force job speaks ONLY about its one controller, and only from the
    // independent readback. It can never print a fleet-safety claim.
    : isForce && job.apply && readbackComplete
      ? `${forceFleetVerdict(job.action, forceId, readbackBoards.map(({ target, board }) => ({
        controllerId: target.controllerId, mode: board.mode,
      })))}${readbackFailures.length > 0
        ? ` · ${readbackFailures.length} controller(s) failed the final readback` : ''}`
    : readbackFailures.length > 0
    ? trusted
      ? `TRUSTED CLI VERDICT CONTRADICTED by independent final readback on ` +
        `${readbackFailures.length} controller(s) — ${outcome.headline}`
      : `${outcome.headline} — FINAL READBACK FAILED on ${readbackFailures.length} controller(s)`
    : outcome.headline;
  // A force job's CLI verdict is NEVER the trusted one — a one-controller
  // `--names` run skips the canonical asset contract, and a leader-only
  // to-swarm legitimately prints the fleet kill verdict. Show what the CLI
  // said, never endorse it.
  refs.verdict.textContent = trusted && !isForce
    ? `Trusted verdict: ${job.verdictLine}`
    : `Trusted verdict: NONE${job.verdictLine ? ` · CLI said ${job.verdictLine}` : ''}`;
  refs.readback.textContent = !readback || readback.jobId !== job.id
    ? 'Final four-controller readback: waiting for job completion'
    : readback.state === 'done'
      ? `Final four-controller readback: ${readback.resultIds.size}/4 verdicts · ` +
        `${readbackBoards.filter(({ board }) => board.mode !== MODE_UNREACHABLE
          && board.mode !== MODE_UNKNOWN && board.mode !== MODE_INVALID).length} canonical · ` +
        `${readbackBoards.filter(({ board }) => board.mode === MODE_UNREACHABLE).length} unreachable · ` +
        `${readbackBoards.filter(({ board }) => board.mode === MODE_UNKNOWN).length} unknown · ` +
        `${readbackBoards.filter(({ board }) => board.mode === MODE_INVALID).length} invalid`
      : readback.state === 'error'
        ? 'Final four-controller readback: FAILED'
        : `Final four-controller readback: ${readback.state}…`;

  let completed = 0;
  for (const target of targets) {
    const status = readback && readback.state === 'done' && !readback.resultIds.has(target.id)
      ? null : statusResults.get(target.id) || null;
    const transition = smokestackControllerTransitionModel(target, job, status, readback,
      { preUptimeMs: flow && flow.preUptimeMs });
    const segment = refs.segments.get(target.controllerId);
    if (!segment) continue;
    const shortPhase = (transition.label || smokestackJobPhase(job)).split(' · ')[0];
    segment.className = `smk-job-segment ${transition.cls}`;
    segment.textContent = `${target.ip.slice(target.ip.lastIndexOf('.'))} ${shortPhase}`;
    segment.title = `${target.operatorLabel}: ${transition.label || smokestackJobPhase(job)}`;
    if (/^(verified|restored|failed|planned|preflight failed|unknown after)/.test(shortPhase)) {
      completed++;
    }
  }
  if (readback && readback.state === 'done') {
    refs.progress.className = 'smk-job-progress';
    refs.progress.textContent = `${readback.resultIds.size}/${targets.length} final readbacks complete`;
  } else if (completed > 0) {
    refs.progress.className = 'smk-job-progress';
    refs.progress.textContent = `${completed}/${targets.length} controller stages explicitly reported`;
  } else {
    refs.progress.className = 'smk-job-progress smk-job-progress-indeterminate';
    refs.progress.textContent = 'Controller progress waits for explicit CLI events';
  }
}

// ── Advanced Recovery (force ONE controller) ────────────────────────────────

function createRecoverySection(targets) {
  const details = el('details', 'smk-recovery');
  details.open = recoveryOpen;
  details.addEventListener('toggle', () => { recoveryOpen = details.open; });
  details.appendChild(el('summary', 'smk-recovery-summary',
    '⚠ Advanced Recovery — force ONE controller'));

  const content = el('div', 'smk-recovery-content');
  content.appendChild(el('div', 'smk-recovery-intro',
    'The fleet toggle above acts on all four ropes and is bound by the deploy CLI\'s ' +
    'canonical asset/identity contract. When that contract legitimately refuses the whole ' +
    'fleet but ONE controller still has to move, this forces exactly that one — through the ' +
    'CLI\'s own --names selector, never a direct write from this browser. It never produces ' +
    'a fleet verdict and never says the network is safe to disconnect.'));

  const select = el('div', 'smk-recovery-select');
  select.setAttribute('role', 'radiogroup');
  select.setAttribute('aria-label', 'Force target controller');
  const radioRefs = new Map();
  for (const target of targets) {
    const label = el('label', 'smk-recovery-option');
    const radio = el('input');
    radio.type = 'radio';
    radio.name = 'smk-recovery-target';
    radio.value = target.controllerId;
    radio.addEventListener('change', () => {
      if (!radio.checked) return;
      recoverySelection = target.controllerId;
      repaint();
    });
    label.appendChild(radio);
    label.appendChild(el('span', 'smk-recovery-option-label',
      `${target.operatorLabel} · ${target.controllerId}`));
    select.appendChild(label);
    radioRefs.set(target.controllerId, radio);
  }
  content.appendChild(select);

  const actions = el('div', 'smk-recovery-actions');
  const dmxBtn = el('button', 'cm-btn cm-danger smk-recovery-btn', 'FORCE TO DMX…');
  dmxBtn.onclick = () => armForce(ACTION_FORCE_TO_DMX);
  const swarmBtn = el('button', 'cm-btn cm-danger smk-recovery-btn', 'FORCE TO SWARM…');
  swarmBtn.onclick = () => armForce(ACTION_FORCE_TO_SWARM);
  actions.append(dmxBtn, swarmBtn);
  content.appendChild(actions);

  const reason = el('div', 'smk-recovery-reason');
  reason.setAttribute('role', 'status');
  reason.setAttribute('aria-live', 'polite');
  content.appendChild(reason);

  const card = el('div', 'smk-recovery-card');
  content.appendChild(card);
  details.appendChild(content);
  return { details, radioRefs, dmxBtn, swarmBtn, reason, card };
}

/**
 * Preview the direction, take ONE fresh readback, re-derive the model from it,
 * and only then start the guarded dry-run. A blocked model stops here and
 * renders why — no request is made.
 */
function armForce(action) {
  recoveryAction = action;
  flowError = null;
  repaint();
  return Promise.resolve(refreshSmokestackStatuses()).then(() => {
    const model = currentForceModel();
    if (!model.eligible) {
      repaint();
      return null;
    }
    const leaderStatus = lastTargets
      .filter((target) => target.controllerId === SMOKESTACK_LEADER_CONTROLLER_ID)
      .map((target) => statusResults.get(target.id))[0] || null;
    return startRun(action, {
      force: {
        controllerId: model.controllerId,
        cliNames: model.cliNames,
        leaderContext: model.leaderContextRequired
          ? SMOKESTACK_LEADER_CONTROLLER_ID : undefined,
        preflightDigest: model.preflightDigest,
        // Baseline for proving the read-only leader context never rebooted.
        preUptimeMs: leaderStatus && leaderStatus.health
          ? leaderStatus.health.uptimeMs : null,
      },
    });
  });
}

function recoveryKeyValue(host, key, value, cls) {
  const row = el('div', `smk-recovery-kv${cls ? ` ${cls}` : ''}`);
  row.appendChild(el('span', 'smk-recovery-k', key));
  row.appendChild(el('span', 'smk-recovery-v', value));
  host.appendChild(row);
}

function recoveryList(host, title, items, cls) {
  if (!items || items.length === 0) return;
  const block = el('div', `smk-recovery-list ${cls}`);
  block.appendChild(el('div', 'smk-recovery-list-title', title));
  for (const item of items) block.appendChild(el('div', 'smk-recovery-list-item', item));
  host.appendChild(block);
}

function renderRecoveryConfirm(host, model) {
  const action = flow.action;
  const controllerId = flow.controllerId;
  const phrase = forceConfirmPhrase(action, controllerId);
  const digestNow = preflightDigest(lastTargets, statusResults);
  const frozenDigest = flow.dryRunJob.preflightDigest;

  recoveryKeyValue(host, 'Plan fingerprint',
    flow.dryRunJob.planFingerprint || '(none — the dry-run printed no SHA-256)',
    'smk-fingerprint');
  recoveryKeyValue(host, 'Preflight digest',
    frozenDigest === digestNow
      ? 'matches — the fleet still looks exactly as it did when this plan was made'
      : 'DRIFTED — the fleet changed since the dry-run; re-run it',
    frozenDigest === digestNow ? '' : 'smk-recovery-drift');

  const confirmRow = el('div', 'smk-confirm-row');
  const inputId = `smk-force-confirm-${action}-${controllerId}`;
  const inputLabel = el('label', 'smk-confirm-label', `Type ${phrase} to arm apply`);
  inputLabel.htmlFor = inputId;
  confirmRow.appendChild(inputLabel);

  const input = el('input', 'smk-confirm-input');
  input.id = inputId;
  input.type = 'text';
  input.placeholder = `type ${phrase} to arm`;
  input.value = flow.typed;
  input.setAttribute('spellcheck', 'false');
  confirmRow.appendChild(input);

  const applyBtn = el('button', 'cm-btn cm-danger smk-apply-btn', `⚡ APPLY — ${phrase}`);
  const gateNote = el('div', 'smk-gate-note');
  gateNote.setAttribute('role', 'status');
  gateNote.setAttribute('aria-live', 'polite');
  gateNote.setAttribute('aria-atomic', 'true');
  const syncGate = () => {
    const gate = applyGateModel(flow.dryRunJob, action, flow.typed,
      { controllerId, preflightDigest: digestNow });
    const readback = flow.readback;
    const readbackReady = readback && readback.jobId === flow.dryRunJob.id
      && readback.state === 'done' && readback.resultIds.size === lastTargets.length;
    const liveGate = model.eligible && model.controllerId === controllerId
      && model.action === action && sameTargetIds(model.cliNames, flow.dryRunJob.cliNames);
    applyBtn.disabled = !gate.allowed || !readbackReady || !liveGate;
    gateNote.textContent = gate.allowed && readbackReady && liveGate
      ? `Armed. APPLY writes to ${controllerId} ONLY (rollback on a failed verify), then a ` +
        'four-controller readback decides the verdict.'
      : !gate.allowed ? gate.reason
        : !readbackReady ? 'wait for the final four-controller dry-run readback'
          : model.blockers[0] || 'the fresh readback no longer matches this plan — re-run it';
  };
  input.addEventListener('input', () => { flow.typed = input.value; syncGate(); });
  applyBtn.onclick = () => startRun(action, { apply: true });
  confirmRow.appendChild(applyBtn);

  const cancelBtn = el('button', 'cm-btn smk-cancel-btn', 'Cancel');
  cancelBtn.title = 'Discard this plan. Nothing has been written.';
  cancelBtn.onclick = () => { flow = null; flowError = null; repaint(); };
  confirmRow.appendChild(cancelBtn);

  host.appendChild(confirmRow);
  host.appendChild(gateNote);
  syncGate();
}

function updateRecoverySection(targets, refs, fleetToggle) {
  const provisioned = !!(provision && provision.provisioned);
  const running = activeJob() !== null;
  if (recoverySelection === null && targets.length > 0) {
    recoverySelection = targets[0].controllerId;
  }
  for (const [controllerId, radio] of refs.radioRefs) {
    radio.checked = controllerId === recoverySelection;
    radio.disabled = !provisioned || running;
  }
  refs.details.open = recoveryOpen;

  const forceFlow = flow && FORCE_ACTIONS.includes(flow.action) ? flow : null;
  const model = forceFlow
    ? smokestackForceRecoveryModel(targets, statusResults, {
      ...latestStatusReadback, sweeping: statusSweeping,
    }, { controllerId: forceFlow.controllerId, action: forceFlow.action })
    : currentForceModel();

  refs.dmxBtn.disabled = !provisioned || running;
  refs.swarmBtn.disabled = !provisioned || running;
  refs.dmxBtn.classList.toggle('smk-recovery-btn-active',
    recoveryAction === ACTION_FORCE_TO_DMX);
  refs.swarmBtn.classList.toggle('smk-recovery-btn-active',
    recoveryAction === ACTION_FORCE_TO_SWARM);

  const note = !provisioned
    ? 'Advanced Recovery unavailable — deployment source not provisioned.'
    : running ? 'A run is in flight — one job at a time.'
      : model.eligible ? '' : `Blocked: ${model.blockers[0]}`;
  refs.reason.textContent = note;
  refs.reason.hidden = note.length === 0;
  refs.reason.className = `smk-recovery-reason${model.eligible || !provisioned || running
    ? '' : ' smk-recovery-blocked'}`;

  const card = refs.card;
  card.textContent = '';
  const target = model.target;
  if (!target) {
    card.appendChild(el('div', 'smk-recovery-list-item',
      'Select one of the four approved controllers.'));
    return;
  }

  const ageMs = model.targetState.readbackAgeMs;
  recoveryKeyValue(card, 'Target',
    `${target.operatorLabel} · ${target.controllerId}`);
  recoveryKeyValue(card, 'Target state now',
    `${model.targetState.mode.toUpperCase()} · ${model.targetState.role}` +
    `${model.targetState.followState ? ` · follow ${model.targetState.followState}` : ''}` +
    `${Number.isFinite(model.targetState.beaconAgeMs)
      ? ` · beacon ${model.targetState.beaconAgeMs} ms ago` : ''}`);
  recoveryKeyValue(card, 'Readback freshness',
    Number.isFinite(ageMs) ? `${(ageMs / 1000).toFixed(1)} s old` : 'no readback yet');
  recoveryKeyValue(card, 'Requested result',
    model.action === ACTION_FORCE_TO_SWARM
      ? `${target.controllerId} renders natively in SWARM`
      : `${target.controllerId} renders from sACN in DMX`);
  recoveryKeyValue(card, 'CLI target names',
    model.cliNames.length > 1
      ? `${model.cliNames.join(', ')} (${model.cliNames[0]} is read-only beacon context — the ` +
        'dry-run must prove the CLI sends it no mutation POST)'
      : model.cliNames.join(', ') || '(none)');
  recoveryKeyValue(card, 'Preserved role', model.preserved.role || '(unknown)');

  const mapping = el('div', 'smk-recovery-map');
  mapping.appendChild(el('div', 'smk-recovery-list-title',
    `Preserved output map (${model.preserved.mappingVerified
      ? 'verified against the board\'s live sACN origins'
      : 'live sACN origins NOT reported — unverified'})`));
  for (const output of model.preserved.outputs) {
    mapping.appendChild(el('div', 'smk-recovery-list-item',
      `O${output.output} ${output.strand} · U${output.universe} @ ${output.address} · ` +
      `${output.px} px${output.live
        ? ` · live U${output.live.universe} @ ${output.live.address}` : ' · live not reported'}`));
  }
  card.appendChild(mapping);

  recoveryKeyValue(card, 'Why the normal action is blocked',
    fleetToggle && !fleetToggle.enabled ? fleetToggle.reason
      : 'the fleet action is available — prefer it unless the CLI refuses the fleet plan');
  recoveryList(card, 'What this force bypasses',
    model.bypasses.length > 0 ? model.bypasses : ['nothing — this is the ordinary direction'],
    'smk-recovery-bypass');
  recoveryList(card, 'What it STILL refuses', model.stillRefuses, 'smk-recovery-refuses');
  if (model.consequence) {
    recoveryKeyValue(card, 'Fleet consequence', model.consequence, 'smk-recovery-consequence');
  }
  recoveryList(card, 'Blockers', model.blockers, 'smk-recovery-blockers');

  if (!forceFlow) return;
  const dryOutcome = jobOutcomeModel(forceFlow.dryRunJob);
  if (forceFlow.applyJob) {
    recoveryKeyValue(card, 'Apply', forceFlow.applyJob.state === 'done'
      ? `exit ${forceFlow.applyJob.exitCode} · ${jobOutcomeModel(forceFlow.applyJob).headline}`
      : 'running…');
    const readback = forceFlow.readback
      && forceFlow.readback.jobId === forceFlow.applyJob.id ? forceFlow.readback : null;
    if (readback && readback.state === 'done'
        && readback.resultIds.size === lastTargets.length) {
      const boardModels = lastTargets.map((row) =>
        smokestackBoardModel(row, statusResults.get(row.id) || null));
      const boards = lastTargets.map((row, index) => ({
        controllerId: row.controllerId, mode: boardModels[index].mode,
      }));
      const verdict = el('div', 'smk-verdict smk-verdict-plan',
        forceFleetVerdict(forceFlow.action, forceFlow.controllerId, boards));
      verdict.setAttribute('role', 'status');
      verdict.setAttribute('aria-live', 'polite');
      card.appendChild(verdict);
      card.appendChild(el('div', 'smk-recovery-list-item',
        `Remaining fleet: ${smokestackFleetModel(boardModels).text}`));
    } else {
      card.appendChild(el('div', 'smk-recovery-list-item',
        'Awaiting the independent four-controller readback — no verdict yet.'));
    }
    return;
  }
  if (forceFlow.dryRunJob.state !== 'done') {
    recoveryKeyValue(card, 'Dry-run', 'running…');
    return;
  }
  if (dryOutcome.kind !== 'dry_run_ok') {
    recoveryKeyValue(card, 'Dry-run', dryOutcome.headline, 'smk-recovery-drift');
    const retryRow = el('div', 'smk-confirm-row');
    const dismissBtn = el('button', 'cm-btn smk-cancel-btn', 'Dismiss');
    dismissBtn.onclick = () => { flow = null; flowError = null; repaint(); };
    retryRow.appendChild(dismissBtn);
    card.appendChild(retryRow);
    return;
  }
  if (forceFlow.dryRunJob.leaderContextUnsafe === true) {
    recoveryKeyValue(card, 'Leader context',
      'UNSAFE — the dry-run did not prove the leader receives no mutation POST. Apply is ' +
      'refused.', 'smk-recovery-drift');
    return;
  }
  renderRecoveryConfirm(card, model);
}

function createAdvancedDetails(targets) {
  const details = el('details', 'smk-advanced');
  details.open = advancedOpen;
  details.addEventListener('toggle', () => { advancedOpen = details.open; });
  details.appendChild(el('summary', 'smk-advanced-summary', 'Advanced details'));
  const content = el('div', 'smk-advanced-content');
  content.appendChild(el('div', 'smk-model-scope',
    'SWARM-only model · 80 pixels/controller · one Titanic-global coordinate frame. ' +
    'Mapping pushes are mode-neutral.'));
  const warningRefs = new Map();

  for (const target of targets) {
    const board = el('section', 'smk-advanced-board');
    board.appendChild(el('div', 'smk-advanced-board-title',
      `${target.operatorLabel} · ${target.controllerId} · ${target.ip}`));
    board.appendChild(el('div', 'smk-placement',
      `Placement ${target.placement} is a legacy geometry label; scene-side operator view is ` +
      `${target.operatorSide}. It does not rename controller identity.`));

    const mapping = el('div', 'smk-output-mapping');
    for (const output of target.swarmModel.outputs) {
      const modelRange = `${output.modelRange[0]}–${output.modelRange[1]}`;
      const localRange = `${output.outputLocalRange[0]}–${output.outputLocalRange[1]}`;
      const line = el('div', 'smk-output-row');
      line.appendChild(el('span', 'smk-output-label', `O${output.output}`));
      line.appendChild(el('span', 'smk-output-strand', output.strand));
      line.appendChild(el('span', 'smk-output-ranges',
        `model ${modelRange} · output-local ${localRange}`));
      line.appendChild(el('span', 'smk-output-direction',
        `authored 0→39 ${formatPoint(output.start)} → ${formatPoint(output.end)} · ` +
        `${output.dominantWalk}`));
      mapping.appendChild(line);
    }
    board.appendChild(mapping);
    board.appendChild(el('div', 'smk-orientation-warning',
      '⚠ PHYSICAL DIRECTION UNVERIFIED — coordinates show authored logical 0→39 only. ' +
      'Confirm the installed rope input/pixel-0 end before treating this as physical truth.'));
    const warnings = el('div', 'smk-advanced-warnings');
    board.appendChild(warnings);
    warningRefs.set(target.controllerId, warnings);
    content.appendChild(board);
  }
  const logSection = el('section', 'smk-advanced-log');
  logSection.appendChild(el('div', 'smk-advanced-board-title', 'Transaction log'));
  const logHost = el('div', 'smk-log-boundary');
  logSection.appendChild(logHost);
  content.appendChild(logSection);
  details.appendChild(content);
  return { details, warningRefs, logHost };
}

function updateAdvancedWarnings(targets, warningRefs) {
  for (const target of targets) {
    const host = warningRefs.get(target.controllerId);
    if (!host) continue;
    const model = smokestackBoardModel(target, statusResults.get(target.id) || null);
    host.textContent = '';
    for (const warning of model.warnings) {
      host.appendChild(el('div', 'smk-row-warning', `✋ ${warning}`));
    }
  }
}

function renderConsole(job, title) {
  const wrap = el('div', 'smk-console-wrap');
  wrap.appendChild(el('div', 'smk-console-title',
    `${title} — ${job.state === 'done' ? `exit ${job.exitCode}` : 'running…'}`));
  const pre = el('pre', 'smk-console', job.output || '(no output yet)');
  pre.setAttribute('role', 'log');
  pre.setAttribute('aria-live', 'polite');
  pre.setAttribute('aria-label', `${title} output`);
  wrap.appendChild(pre);
  // Autoscroll after the node is attached.
  requestAnimationFrame(() => { pre.scrollTop = pre.scrollHeight; });
  return wrap;
}

function renderVerdict(outcome) {
  const verdict = el('div', `smk-verdict ${outcome.cls}`, outcome.headline);
  const isDanger = outcome.cls === 'smk-verdict-danger';
  verdict.setAttribute('role', isDanger ? 'alert' : 'status');
  verdict.setAttribute('aria-live', isDanger ? 'assertive' : 'polite');
  verdict.setAttribute('aria-atomic', 'true');
  return verdict;
}

function renderFlow(body, logBody) {
  if (!flow) return;
  const action = flow.action;

  // Dry-run console + outcome.
  logBody.appendChild(renderConsole(flow.dryRunJob, `DRY-RUN: ${actionLabel(action)}`));
  const dryOutcome = jobOutcomeModel(flow.dryRunJob);
  if (flow.dryRunJob.state === 'done' && !flow.applyJob) {
    body.appendChild(renderVerdict(dryOutcome));
  }

  // Apply console + verdict. A nominal CLI success is not rendered as safe
  // until the independent exact-four readback verifies the expected state.
  if (flow.applyJob) {
    logBody.appendChild(renderConsole(flow.applyJob, `APPLY: ${actionLabel(action)}`));
    const outcome = jobOutcomeModel(flow.applyJob);
    if (flow.applyJob.state === 'done') {
      const trustedKind = TRUSTED_APPLY_OUTCOME_KINDS.includes(outcome.kind);
      const readback = flow.readback && flow.readback.jobId === flow.applyJob.id
        ? flow.readback : null;
      const readbackComplete = !!(readback && readback.state === 'done'
        && readback.resultIds.size === lastTargets.length);
      const expectedMode = action === ACTION_TO_SWARM ? MODE_SWARM : MODE_DMX;
      const readbackOk = readbackComplete && lastTargets.every((target) => {
        const status = readback.resultIds.has(target.id) ? statusResults.get(target.id) : null;
        const board = smokestackBoardModel(target, status || null);
        const targeted = action !== ACTION_REPAIR_TO_DMX
          || (Array.isArray(flow.applyJob.targetIds)
            && flow.applyJob.targetIds.includes(target.controllerId));
        return board.mode !== MODE_UNREACHABLE && board.mode !== MODE_UNKNOWN
          && board.mode !== MODE_INVALID && (!targeted || board.mode === expectedMode)
          && (action !== ACTION_TO_SWARM || board.roleOk);
      });
      if (!trustedKind) {
        body.appendChild(renderVerdict(outcome));
      } else if (readbackOk) {
        body.appendChild(renderVerdict(outcome));
      } else if (readback && (readback.state === 'done' || readback.state === 'error')) {
        body.appendChild(renderVerdict({
          headline: 'Apply CLI completed, but independent final readback failed — fleet is NOT verified.',
          cls: 'smk-verdict-danger',
        }));
      } else {
        body.appendChild(renderVerdict({
          headline: 'Apply CLI completed — waiting for independent four-controller readback.',
          cls: 'smk-verdict-plan',
        }));
      }
    }
    return;
  }

  // Confirm row — only after a clean dry-run, and even then the server
  // re-checks everything this UI checks. A FORCE run's confirm step lives
  // inside the Advanced Recovery section, next to the context it needs.
  if (FORCE_ACTIONS.includes(action)) return;
  if (flow.dryRunJob.state === 'done' && dryOutcome.kind === 'dry_run_ok') {
    const confirmRow = el('div', 'smk-confirm-row');
    const phrase = CONFIRM_PHRASES[action];

    const inputId = `smk-confirm-${action}`;
    const inputLabel = el('label', 'smk-confirm-label', `Type ${phrase} to arm apply`);
    inputLabel.htmlFor = inputId;
    confirmRow.appendChild(inputLabel);

    const input = el('input', 'smk-confirm-input');
    input.id = inputId;
    input.type = 'text';
    input.placeholder = `type ${phrase} to arm`;
    input.value = flow.typed;
    input.setAttribute('spellcheck', 'false');
    confirmRow.appendChild(input);

    const applyBtn = el('button', 'cm-btn cm-danger smk-apply-btn', `⚡ APPLY — ${phrase}`);
    const gateNote = el('div', 'smk-gate-note');
    gateNote.setAttribute('role', 'status');
    gateNote.setAttribute('aria-live', 'polite');
    gateNote.setAttribute('aria-atomic', 'true');
    const syncGate = () => {
      const gate = applyGateModel(flow.dryRunJob, action, flow.typed);
      const readback = flow.readback;
      const readbackReady = readback && readback.jobId === flow.dryRunJob.id
        && readback.state === 'done' && readback.resultIds.size === lastTargets.length;
      const repairGate = action === ACTION_REPAIR_TO_DMX && sectionRefs
        && sectionRefs.repairModel && sectionRefs.repairModel.enabled
        && sameTargetIds(sectionRefs.repairModel.targetIds, flow.targetIds)
        && sameTargetIds(flow.dryRunJob.targetIds, flow.targetIds);
      const fleetGate = action !== ACTION_REPAIR_TO_DMX && sectionRefs
        && sectionRefs.fleetToggle && sectionRefs.fleetToggle.enabled
        && sectionRefs.fleetToggle.action === action;
      const liveGate = repairGate || fleetGate;
      applyBtn.disabled = !gate.allowed || !readbackReady || !liveGate;
      gateNote.textContent = gate.allowed && readbackReady && liveGate
        ? 'Armed. APPLY writes to the real boards (canary-first, rollback on a failed verify).'
        : !gate.allowed ? gate.reason
          : !readbackReady ? 'wait for the final four-controller dry-run readback'
            : 'fleet readback no longer matches this plan — re-run the dry-run';
    };
    input.addEventListener('input', () => {
      flow.typed = input.value;
      syncGate();
    });
    applyBtn.onclick = () => startRun(action, { apply: true, targetIds: flow.targetIds });
    confirmRow.appendChild(applyBtn);

    const cancelBtn = el('button', 'cm-btn smk-cancel-btn', 'Cancel');
    cancelBtn.title = 'Discard this plan. Nothing has been written.';
    cancelBtn.onclick = () => { flow = null; flowError = null; repaint(); };
    confirmRow.appendChild(cancelBtn);

    body.appendChild(confirmRow);
    body.appendChild(gateNote);
    syncGate();
  } else if (flow.dryRunJob.state === 'done') {
    // Refused dry-run: the outcome banner above says why; offer the way out.
    const retryRow = el('div', 'smk-confirm-row');
    const dismissBtn = el('button', 'cm-btn smk-cancel-btn', 'Dismiss');
    dismissBtn.onclick = () => { flow = null; flowError = null; repaint(); };
    retryRow.appendChild(dismissBtn);
    body.appendChild(retryRow);
  }
}

function createSection(group, targets) {
  const head = el('div', 'cm-group-head');
  const toggleBtn = el('button', 'cm-toggle');
  toggleBtn.onclick = () => {
    collapsed = !collapsed;
    preserveMainScroll(() => updateSection(lastTargets));
  };
  head.appendChild(toggleBtn);

  const groupTitle = el('span', 'cm-group-title');
  head.appendChild(groupTitle);

  const fleetStatus = el('span', 'smk-fleet');
  fleetStatus.setAttribute('role', 'status');
  fleetStatus.setAttribute('aria-live', 'polite');
  fleetStatus.setAttribute('aria-atomic', 'true');
  head.appendChild(fleetStatus);

  head.appendChild(el('span', 'cm-group-spacer'));

  const refreshBtn = el('button', 'cm-btn smk-refresh');
  refreshBtn.title = 'Read each rope board\'s mode now (GET /api/status + /api/config via the ' +
    'sim server). Read-only — nothing is written.';
  refreshBtn.onclick = refreshSmokestackStatuses;
  head.appendChild(refreshBtn);
  group.appendChild(head);

  const body = el('div', 'smk-body');
  const switchRow = el('div', 'smk-switch-row');
  const switchBtn = el('button', 'cm-btn smk-switch-btn smk-switch-primary');
  switchBtn.onclick = () => {
    const fleetToggle = sectionRefs && sectionRefs.fleetToggle;
    if (fleetToggle && fleetToggle.enabled && fleetToggle.action) {
      startRun(fleetToggle.action);
    }
  };
  switchRow.appendChild(switchBtn);
  body.appendChild(switchRow);

  const switchReason = el('div', 'smk-switch-refusal');
  switchReason.setAttribute('role', 'status');
  body.appendChild(switchReason);

  const repairRow = el('div', 'smk-repair-row');
  repairRow.hidden = true;
  const repairBtn = el('button', 'cm-btn cm-danger smk-repair-btn');
  repairBtn.onclick = () => {
    const repair = sectionRefs && sectionRefs.repairModel;
    if (repair && repair.enabled) {
      startRun(repair.action, { targetIds: [...repair.targetIds] });
    }
  };
  const repairReason = el('div', 'smk-repair-reason');
  repairReason.setAttribute('role', 'status');
  repairRow.append(repairBtn, repairReason);
  body.appendChild(repairRow);

  const jobBanner = el('div', 'smk-job-banner');
  jobBanner.hidden = true;
  jobBanner.setAttribute('role', 'status');
  jobBanner.setAttribute('aria-live', 'polite');
  jobBanner.setAttribute('aria-atomic', 'true');
  const jobPhase = el('div', 'smk-job-phase');
  const jobHeadline = el('div', 'smk-job-headline');
  const jobVerdict = el('div', 'smk-job-verdict');
  const jobReadback = el('div', 'smk-job-readback');
  const jobProgress = el('div', 'smk-job-progress');
  const jobSegments = el('div', 'smk-job-segments');
  const jobSegmentRefs = new Map();
  for (const target of targets) {
    const segment = el('span', 'smk-job-segment', `${target.ip.slice(target.ip.lastIndexOf('.'))} idle`);
    segment.dataset.controllerId = target.controllerId;
    jobSegments.appendChild(segment);
    jobSegmentRefs.set(target.controllerId, segment);
  }
  jobBanner.append(jobPhase, jobHeadline, jobVerdict, jobReadback, jobProgress, jobSegments);
  body.appendChild(jobBanner);

  const compact = createCompactRows(targets);
  body.appendChild(compact.rows);

  const flowHost = el('div', 'smk-flow-boundary');
  body.appendChild(flowHost);

  const recovery = createRecoverySection(targets);
  body.appendChild(recovery.details);

  const advanced = createAdvancedDetails(targets);
  body.appendChild(advanced.details);
  group.appendChild(body);

  sectionRefs = {
    groupTitle,
    toggleBtn,
    fleetStatus,
    refreshBtn,
    body,
    switchBtn,
    switchReason,
    repairRow,
    repairBtn,
    repairReason,
    jobBannerRefs: {
      banner: jobBanner,
      phase: jobPhase,
      headline: jobHeadline,
      verdict: jobVerdict,
      readback: jobReadback,
      progress: jobProgress,
      segments: jobSegmentRefs,
    },
    rowRefs: compact.refs,
    warningRefs: advanced.warningRefs,
    advancedDetails: advanced.details,
    flowHost,
    logHost: advanced.logHost,
    recoveryRefs: recovery,
    fleetToggle: null,
    repairModel: null,
  };
}

function updateFlowBoundary(host, logHost) {
  host.textContent = '';
  logHost.textContent = '';
  if (flowError) host.appendChild(el('div', 'smk-error', `✋ run refused: ${flowError}`));
  renderFlow(host, logHost);
}

function updateSection(targets) {
  if (!sectionRefs) return;
  const boardModels = targets.map((target) =>
    smokestackBoardModel(target, statusResults.get(target.id) || null));
  const fleet = smokestackFleetModel(boardModels);
  const fleetToggle = smokestackFleetToggleModel(boardModels);
  const provisioned = !!(provision && provision.provisioned);
  const running = activeJob() !== null;
  const repairModel = smokestackRepairModel(targets, statusResults, {
    ...latestStatusReadback,
    sweeping: statusSweeping,
  });
  sectionRefs.fleetToggle = fleetToggle;
  sectionRefs.repairModel = repairModel;

  sectionRefs.groupTitle.textContent = `Smokestack SWARM (${targets.length})`;
  sectionRefs.toggleBtn.textContent = collapsed ? '▸' : '▾';
  sectionRefs.toggleBtn.title = collapsed ? 'Expand Smokestack SWARM' : 'Collapse Smokestack SWARM';
  sectionRefs.toggleBtn.setAttribute('aria-label', sectionRefs.toggleBtn.title);
  sectionRefs.toggleBtn.setAttribute('aria-expanded', String(!collapsed));
  sectionRefs.body.hidden = collapsed;

  sectionRefs.fleetStatus.className = `smk-fleet ${fleet.cls}`;
  sectionRefs.fleetStatus.textContent = fleet.text;
  sectionRefs.refreshBtn.textContent = statusSweeping ? '🛰 checking…' : '🛰 Refresh';
  sectionRefs.refreshBtn.disabled = statusSweeping;

  sectionRefs.switchBtn.textContent = fleetToggle.label;
  sectionRefs.switchBtn.disabled = !provisioned || running || !fleetToggle.enabled;
  let shortReason = '';
  if (provisionError) {
    shortReason = 'Switch unavailable — provisioning status could not be read.';
  } else if (!provision) {
    shortReason = 'Switch unavailable — checking provisioning.';
  } else if (!provisioned) {
    shortReason = 'Switch unavailable — deployment source not provisioned.';
  } else if (!fleetToggle.enabled) {
    shortReason = fleetToggle.reason;
  } else if (statusError) {
    shortReason = statusError;
  }
  sectionRefs.switchReason.textContent = shortReason;
  sectionRefs.switchReason.hidden = shortReason.length === 0;
  sectionRefs.switchBtn.title = shortReason ||
    `Run a guarded ${fleetToggle.action} dry-run for all four controllers.`;

  sectionRefs.repairRow.hidden = !repairModel.visible;
  sectionRefs.repairBtn.textContent = repairModel.label;
  sectionRefs.repairBtn.disabled = !provisioned || running || !repairModel.enabled;
  const repairReason = !provisioned
    ? 'Repair unavailable — deployment source not provisioned.'
    : repairModel.reason;
  sectionRefs.repairReason.textContent = repairReason;
  sectionRefs.repairReason.hidden = repairReason.length === 0;
  sectionRefs.repairBtn.title = repairReason
    || `Dry-run exact repair targets: ${repairModel.targetIds.join(', ')}`;

  updateCompactRows(targets, sectionRefs.rowRefs, repairModel);
  updateJobBanner(sectionRefs.jobBannerRefs, targets);
  updateRecoverySection(targets, sectionRefs.recoveryRefs, fleetToggle);
  updateAdvancedWarnings(targets, sectionRefs.warningRefs);
  sectionRefs.advancedDetails.open = advancedOpen;
  updateFlowBoundary(sectionRefs.flowHost, sectionRefs.logHost);
}

/**
 * Render the smokestack section for the controller mapping pane, or null when
 * this scene has no rope controllers (the section simply does not exist for
 * test_bench-style scenes).
 *
 * Called from controller_map_editor.render(). First render per page load
 * takes one automatic read-only glance + a provisioning check (the pane is
 * open and the operator is looking — that is the "operator opens the panel"
 * moment); after that, status refreshes are manual or post-apply only.
 */
export function renderSmokestackSection(registry) {
  const targets = smokestackTargets(registry);
  if (targets.length === 0) {
    containerEl = null;
    sectionRefs = null;
    targetSignature = '';
    lastTargets = [];
    return null;
  }
  lastTargets = targets;
  const nextSignature = targets.map((target) =>
    `${target.controllerId}:${target.id}:${target.ip}`).join('|');
  if (!containerEl || targetSignature !== nextSignature) {
    containerEl = el('div', 'cm-group smk-group');
    sectionRefs = null;
    targetSignature = nextSignature;
    createSection(containerEl, targets);
  }
  updateSection(targets);
  if (!statusSweptOnce && !isStaticHost()) {
    statusSweptOnce = true;
    refreshProvision();
    refreshSmokestackStatuses();
  }
  return containerEl;
}
