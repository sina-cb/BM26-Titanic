/**
 * smokestack_cli_service.cjs — the operator-gated SWITCH path for the
 * smokestack rope controllers (save-server routes `POST /smokestack/run`,
 * `GET /smokestack/job`, `GET /smokestack/provision`).
 *
 * Mode switching is executed EXCLUSIVELY by the private MarsinLED deploy CLI
 * (`smokestack_mode.py`): registry-driven targeting with MAC verification,
 * placeholder refusal, pre-flight sweep with zero writes on any refusal,
 * canary-first sequential rollout, post-change verification, and the terminal
 * `SAFE TO KILL NETWORK` verdict. NONE of that is reimplemented here — this
 * module only spawns the CLI, captures its output verbatim, and enforces the
 * sim-side operator gates on top:
 *
 *   1. PROVISIONING — the CLI and the deploy registry live OUTSIDE this
 *      public repo and are located ONLY via environment variables:
 *        BM26_SMOKESTACK_CLI    absolute path to the private smokestack_mode.py
 *        BM26_DEPLOY_REGISTRY   absolute path to the private deploy registry
 *        BM26_SMOKESTACK_PYTHON interpreter (default `python`)
 *      Missing either ⇒ every run is refused with an honest "deployment
 *      source not provisioned". There is NO bundled registry, NO path
 *      guessing, NO fallback (codex P0).
 *   2. TWO-STEP MUTATION — an apply (`--yes`) is accepted only when the
 *      request references a COMPLETED, CLEAN (`exit 0`), FRESH dry-run job of
 *      the SAME action with an exact SHA-256 plan fingerprint, AND carries the
 *      exact typed confirmation phrase. Apply passes that reviewed fingerprint
 *      back to the CLI so a changed plan is refused.
 *      The UI renders the same gate; this server-side copy is the one that
 *      counts.
 *   3. ONE JOB AT A TIME — a second run while one is in flight is a 409-shaped
 *      refusal, never a queue. The playa failure mode of two overlapping
 *      fleet mutations is exactly the one the CLI's pre-flight cannot see.
 *   4. TARGETED REPAIR — `repair-to-dmx` accepts only a non-empty subset of
 *      the four semantic Titanic controller IDs. The sorted target set is
 *      frozen into the dry-run job and must match its apply byte-for-byte;
 *      this module alone translates it to the CLI's `--names` selector.
 *   5. ADVANCED RECOVERY (`force-to-dmx` / `force-to-swarm`) — the
 *      one-controller escape hatch, gated harder than anything else here:
 *      EXACTLY ONE approved controller ID (never an IP, card name or free
 *      text); a CONTROLLER-SPECIFIC typed phrase (`FORCE DMX <id>`); a
 *      `preflightDigest` of the four-controller readback that must still
 *      match at apply time (any drift refuses); a single-use dry-run (armed
 *      once, then consumed); and, for a follower's SWARM force, a frozen
 *      read-only `leaderContext` whose no-write status the dry-run must have
 *      PROVEN in the CLI's own words. It is still the CLI that executes —
 *      through `--names` — and the CLI's asset/identity contract is never
 *      weakened by any of this.
 *
 *   6. ASSET RE-RELEASE (`re-release`) — restores a board to the frozen
 *      canonical release so the switch flow's asset contract can pass again.
 *      Same two-step as everything else (dry-run → 64-hex fingerprint → typed
 *      `RE-RELEASE <id>` / `RE-RELEASE ALL` → apply), same frozen-target-set
 *      rule as the targeted repair. It never changes a board's MODE, and it
 *      never earns a fleet verdict of any kind.
 *
 * Mode applies always pass `--rollback-on-failure`, so a board that fails its
 * post-change verification is restored to its pre-change snapshot by the CLI.
 *
 * Output handling: stdout+stderr are captured verbatim (arrival order) up to
 * OUTPUT_MAX_BYTES; past the cap the run continues (killing a mid-apply CLI
 * could strand a half-verified fleet) but the job is marked
 * `outputTruncated`, which the UI's outcome model treats as NOT SAFE. The
 * `VERDICT: …` line is extracted for the panel; interpretation (the
 * SAFE-TO-KILL / DO-NOT-KILL split) lives in the pure browser model
 * (src/dmx/smokestack_mode.js) so it is unit-tested without a server.
 */

const fs = require('fs');
const { spawn } = require('child_process');

const ENV_CLI = 'BM26_SMOKESTACK_CLI';
const ENV_REGISTRY = 'BM26_DEPLOY_REGISTRY';
const ENV_PYTHON = 'BM26_SMOKESTACK_PYTHON';
const DEFAULT_PYTHON = 'python';

const ACTION_REPAIR_TO_DMX = 'repair-to-dmx';
const ACTION_FORCE_TO_DMX = 'force-to-dmx';
const ACTION_FORCE_TO_SWARM = 'force-to-swarm';
// Restore a board's ON-BOARD ASSETS to the frozen canonical release. It is a
// MUTATING action (it deletes and uploads files and reboots the board) but it
// never touches identity, roles, universes, wifi, firmware — or MODE.
const ACTION_RE_RELEASE = 're-release';
const FORCE_ACTIONS = Object.freeze([ACTION_FORCE_TO_DMX, ACTION_FORCE_TO_SWARM]);
const ACTIONS = ['status', 'to-dmx', 'to-swarm', ACTION_REPAIR_TO_DMX, ACTION_RE_RELEASE,
  ...FORCE_ACTIONS];
const MUTATING_ACTIONS = ['to-dmx', 'to-swarm', ACTION_REPAIR_TO_DMX, ACTION_RE_RELEASE,
  ...FORCE_ACTIONS];
/** Actions whose exact target set is frozen at dry-run and re-checked at apply. */
const TARGETED_ACTIONS = Object.freeze([ACTION_REPAIR_TO_DMX, ACTION_RE_RELEASE,
  ...FORCE_ACTIONS]);
const TITANIC_TARGET_IDS = Object.freeze([
  'ss_left_left',
  'ss_left_right',
  'ss_right_right',
  'ss_right_left',
]);
const TITANIC_TARGET_ID_SET = new Set(TITANIC_TARGET_IDS);
// The ONE controller a follower's FORCE TO SWARM may carry as read-only
// beacon context. No other value is ever accepted.
const TITANIC_LEADER_ID = 'ss_left_right';
// The deploy CLI's exact dry-run wording for a board already in its target
// mode. The leader-context gate matches this line and nothing else: any other
// wording means the leader might be written to, and the apply fails closed.
const CLI_NO_WRITE_LINE = (name) =>
  `${name}: already in target mode - no mutation POST would be sent`;

// MUST match src/dmx/smokestack_mode.js CONFIRM_PHRASES — the routes test
// asserts the three stay identical.
const CONFIRM_PHRASES = {
  'to-dmx': 'SWITCH',
  'to-swarm': 'SWITCH',
  [ACTION_REPAIR_TO_DMX]: 'SWITCH',
};

/**
 * The exact phrase an apply must carry. Force actions derive a
 * CONTROLLER-SPECIFIC phrase so a phrase armed for one board can never arm
 * another; MUST equal the browser model's forceConfirmPhrase (routes test
 * pins all 8 combinations plus the 3 fleet ones).
 */
function confirmPhraseFor(action, targetIds) {
  if (action === ACTION_RE_RELEASE) {
    // MUST equal the browser model's reReleaseConfirmPhrase (routes test pins
    // both). One board names itself; a multi-board run confirms the SET, whose
    // exact membership is separately frozen and re-checked byte-for-byte.
    if (!Array.isArray(targetIds) || targetIds.length === 0) return null;
    return targetIds.length === 1 ? `RE-RELEASE ${targetIds[0]}` : 'RE-RELEASE ALL';
  }
  if (!FORCE_ACTIONS.includes(action)) return CONFIRM_PHRASES[action];
  if (!Array.isArray(targetIds) || targetIds.length !== 1) return null;
  return `${action === ACTION_FORCE_TO_DMX ? 'FORCE DMX' : 'FORCE SWARM'} ${targetIds[0]}`;
}

const OUTPUT_MAX_BYTES = 1024 * 1024;
const VERDICT_DRY_RUN = 'VERDICT: DRY RUN - no changes made';
const PLAN_FINGERPRINT_PATTERN = /^PLAN FINGERPRINT: ([0-9a-f]{64})$/gm;
// A to-swarm apply legitimately rides out per-board reboots (--reboot-wait
// 90 s each, 4 boards, plus the terminal reboot canary) — give it room, but
// never let a hung interpreter hold the "one job at a time" slot forever.
const JOB_TIMEOUT_MS = 15 * 60 * 1000;
// An apply must follow ITS dry-run promptly — a plan reviewed an hour ago
// says nothing about the fleet now.
const DRY_RUN_FRESH_MS = 15 * 60 * 1000;
// ONE freshness window for every plan, force or fleet (operator ruling: a
// shorter force-only window was too restrictive in the field). The force
// path's real guard is the preflight digest, which refuses on ANY state
// change between plan and apply regardless of how much time passed.
const FORCE_DRY_RUN_FRESH_MS = DRY_RUN_FRESH_MS;
const COMPLETED_JOBS_KEPT = 10;

/** Last VERDICT: line of the captured output (the CLI prints exactly one). */
function extractVerdictLine(output) {
  if (typeof output !== 'string') return null;
  const matches = output.match(/^VERDICT: .*$/gm);
  return matches && matches.length > 0 ? matches[matches.length - 1].trim() : null;
}

/**
 * The CLI's first `WOULD REFUSE:` line, or null. It appears INSIDE the plan
 * table's row (after the BOARD/RESULT/MODE columns) as well as on continuation
 * lines, so this must search the line rather than anchor at its start.
 */
function firstWouldRefuse(output) {
  if (typeof output !== 'string') return null;
  for (const line of output.split(/\r?\n/)) {
    const index = line.indexOf('WOULD REFUSE:');
    if (index >= 0) return line.slice(index).trim();
  }
  return null;
}

/** Last exact SHA-256 plan fingerprint emitted by a completed dry-run. */
function extractPlanFingerprint(output) {
  if (typeof output !== 'string') return null;
  const matches = [...output.matchAll(PLAN_FINGERPRINT_PATTERN)];
  return matches.length > 0 ? matches[matches.length - 1][1] : null;
}

function validateTargetIds(action, targetIds) {
  if (FORCE_ACTIONS.includes(action)) {
    if (!Array.isArray(targetIds) || targetIds.length !== 1) {
      return { ok: false, code: 'force_target_required',
        error: `'${action}' requires targetIds naming EXACTLY ONE approved Titanic ` +
          'controller ID' };
    }
    const [targetId] = targetIds;
    if (typeof targetId !== 'string' || !TITANIC_TARGET_ID_SET.has(targetId)) {
      return { ok: false, code: 'bad_targets',
        error: 'targetIds must contain only approved Titanic controller IDs: ' +
          TITANIC_TARGET_IDS.join(', ') };
    }
    return { ok: true, targetIds: Object.freeze([targetId]) };
  }
  if (action !== ACTION_REPAIR_TO_DMX && action !== ACTION_RE_RELEASE) {
    if (targetIds !== undefined) {
      return { ok: false, code: 'bad_targets',
        error: `targetIds is only valid for ${TARGETED_ACTIONS.join(', ')}` };
    }
    return { ok: true, targetIds: null };
  }
  if (!Array.isArray(targetIds) || targetIds.length === 0) {
    return { ok: false, code: 'bad_targets',
      error: `'${action}' requires a non-empty targetIds array` };
  }
  const seen = new Set();
  for (const targetId of targetIds) {
    if (typeof targetId !== 'string' || !TITANIC_TARGET_ID_SET.has(targetId)) {
      return { ok: false, code: 'bad_targets',
        error: `targetIds must contain only approved Titanic controller IDs: ` +
          TITANIC_TARGET_IDS.join(', ') };
    }
    if (seen.has(targetId)) {
      return { ok: false, code: 'bad_targets',
        error: `targetIds contains duplicate '${targetId}'` };
    }
    seen.add(targetId);
  }
  return { ok: true, targetIds: Object.freeze([...seen].sort()) };
}

/**
 * A follower's FORCE TO SWARM cannot succeed alone: the CLI's coherence check
 * needs exactly one leader IN the target set. So the request must name the
 * saved sole leader as read-only context — and ONLY that leader. The leader's
 * own force carries no context at all.
 *
 * Returns the frozen `cliNames` the CLI's `--names` selector will receive.
 */
function validateForceContext(action, targetIds, leaderContext) {
  if (!FORCE_ACTIONS.includes(action)) {
    if (leaderContext !== undefined) {
      return { ok: false, code: 'force_leader_context',
        error: `leaderContext is only valid for '${ACTION_FORCE_TO_SWARM}'` };
    }
    return { ok: true, cliNames: null };
  }
  const [targetId] = targetIds;
  if (action === ACTION_FORCE_TO_DMX) {
    if (leaderContext !== undefined) {
      return { ok: false, code: 'force_leader_context',
        error: 'a DMX force never carries leader context — to-dmx has no leader/follower ' +
          'dependency' };
    }
    return { ok: true, cliNames: Object.freeze([targetId]) };
  }
  if (targetId === TITANIC_LEADER_ID) {
    if (leaderContext !== undefined) {
      return { ok: false, code: 'force_leader_context',
        error: `the leader's own SWARM force must not carry leaderContext` };
    }
    return { ok: true, cliNames: Object.freeze([targetId]) };
  }
  if (leaderContext !== TITANIC_LEADER_ID) {
    return { ok: false, code: 'force_leader_context',
      error: `a follower's SWARM force requires leaderContext '${TITANIC_LEADER_ID}' — ` +
        'the CLI needs exactly one leader in the target set, and only the saved sole ' +
        'leader is ever accepted' };
  }
  return { ok: true, cliNames: Object.freeze([TITANIC_LEADER_ID, targetId]) };
}

function sameTargetIds(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
    return false;
  }
  return left.every((targetId, index) => targetId === right[index]);
}

/**
 * Factory so the tests can inject env/spawn/clock. save-server uses the
 * default singleton below.
 */
function createSmokestackCliService(opts = {}) {
  const env = opts.env || process.env;
  const spawnFn = opts.spawnFn || spawn;
  const existsFn = opts.existsFn || fs.existsSync;
  const now = opts.now || Date.now;
  const jobTimeoutMs = opts.jobTimeoutMs || JOB_TIMEOUT_MS;
  const dryRunFreshMs = opts.dryRunFreshMs || DRY_RUN_FRESH_MS;
  const forceDryRunFreshMs = opts.forceDryRunFreshMs || FORCE_DRY_RUN_FRESH_MS;

  let nextJobId = 1;
  let runningJob = null; // internal record of the in-flight job, or null
  const jobs = new Map(); // id → internal record (running + last N completed)

  /**
   * Is the private deployment source available to this process? Reports WHICH
   * pieces are missing by env-var name — never a guessed path, never a value
   * echo (the paths are machine-local and stay out of responses).
   */
  function provisionState() {
    const missing = [];
    const reasons = [];
    const cliPath = env[ENV_CLI];
    if (!cliPath) {
      missing.push(ENV_CLI);
      reasons.push(`$${ENV_CLI} is not set (path to the private MarsinLED deploy CLI)`);
    } else if (!existsFn(cliPath)) {
      missing.push(ENV_CLI);
      reasons.push(`$${ENV_CLI} points at a file that does not exist`);
    }
    const registryPath = env[ENV_REGISTRY];
    if (!registryPath) {
      missing.push(ENV_REGISTRY);
      reasons.push(`$${ENV_REGISTRY} is not set (path to the private deploy registry)`);
    } else if (!existsFn(registryPath)) {
      missing.push(ENV_REGISTRY);
      reasons.push(`$${ENV_REGISTRY} points at a file that does not exist`);
    }
    return { provisioned: missing.length === 0, missing, reasons };
  }

  /** The wire shape of a job — action args only, NEVER the CLI/interpreter
   * machine paths. */
  function toPublicJob(job) {
    if (!job) return null;
    const publicJob = {
      id: job.id,
      action: job.action,
      apply: job.apply,
      args: [...job.args],
      state: job.state,
      startedAt: job.startedAt,
      endedAt: job.endedAt,
      exitCode: job.exitCode,
      timedOut: job.timedOut,
      outputTruncated: job.outputTruncated,
      output: job.output,
      verdictLine: job.verdictLine,
      planFingerprint: job.planFingerprint,
      planFingerprintMismatch: job.planFingerprintMismatch,
    };
    if (job.targetIds) publicJob.targetIds = [...job.targetIds];
    if (job.cliNames) publicJob.cliNames = [...job.cliNames];
    if (job.preflightDigest !== null && job.preflightDigest !== undefined) {
      publicJob.preflightDigest = job.preflightDigest;
    }
    publicJob.consumed = job.consumed === true;
    publicJob.leaderContextUnsafe = job.leaderContextUnsafe === true;
    return publicJob;
  }

  function pruneCompleted() {
    const done = [...jobs.values()].filter((j) => j.state === 'done');
    if (done.length <= COMPLETED_JOBS_KEPT) return;
    done.sort((a, b) => a.endedAt - b.endedAt);
    for (const j of done.slice(0, done.length - COMPLETED_JOBS_KEPT)) jobs.delete(j.id);
  }

  function finishJob(job, exitCode) {
    if (job.state === 'done') return;
    job.state = 'done';
    const emittedFingerprint = extractPlanFingerprint(job.output);
    if (job.apply && emittedFingerprint && emittedFingerprint !== job.planFingerprint) {
      job.planFingerprintMismatch = true;
      appendOutput(job, '\nERROR: plan fingerprint mismatch — apply evidence differs from reviewed dry-run\n');
      exitCode = -1;
    } else if (!job.apply) {
      job.planFingerprint = emittedFingerprint;
    }
    // A follower's SWARM force runs the leader in the same --names set purely
    // so the coherence check has a beacon source. Its dry-run MUST prove the
    // CLI would send the leader no mutation POST — fail closed on any other
    // wording, and refuse the apply that would follow.
    if (!job.apply && Array.isArray(job.cliNames) && job.cliNames.length === 2) {
      const proof = CLI_NO_WRITE_LINE(job.cliNames[0]);
      const lines = job.output.split(/\r?\n/).map((line) => line.trim());
      if (!lines.includes(proof)) {
        job.leaderContextUnsafe = true;
        appendOutput(job, `\nERROR: leader context ${job.cliNames[0]} did not render the exact `
          + 'no-write line — refusing to treat it as read-only context\n');
      }
    }
    job.exitCode = exitCode;
    job.endedAt = now();
    job.verdictLine = extractVerdictLine(job.output);
    if (job.timeoutTimer) { clearTimeout(job.timeoutTimer); job.timeoutTimer = null; }
    if (runningJob === job) runningJob = null;
    pruneCompleted();
  }

  function appendOutput(job, chunk) {
    const text = chunk.toString('utf8');
    if (job.outputBytes >= OUTPUT_MAX_BYTES) { job.outputTruncated = true; return; }
    job.outputBytes += Buffer.byteLength(text);
    if (job.outputBytes > OUTPUT_MAX_BYTES) {
      job.outputTruncated = true;
      job.output += text.slice(0, Math.max(0, text.length - (job.outputBytes - OUTPUT_MAX_BYTES)));
      job.output += '\n[output truncated]\n';
      return;
    }
    job.output += text;
  }

  /**
   * Validate + start one CLI run. Returns `{ok: true, job}` (public shape) or
   * `{ok: false, code, error, ...}` — the route maps `code` to an HTTP status.
   */
  function startJob({ action, apply = false, confirm, dryRunJobId, targetIds,
    leaderContext, preflightDigest } = {}) {
    if (!ACTIONS.includes(action)) {
      return { ok: false, code: 'bad_action',
        error: `action must be one of ${ACTIONS.join(', ')}` };
    }
    if (apply && !MUTATING_ACTIONS.includes(action)) {
      return { ok: false, code: 'bad_action', error: `'${action}' has no apply form` };
    }
    const targets = validateTargetIds(action, targetIds);
    if (!targets.ok) return targets;
    const context = validateForceContext(action, targets.targetIds, leaderContext);
    if (!context.ok) return context;
    const isForce = FORCE_ACTIONS.includes(action);
    if (isForce && (typeof preflightDigest !== 'string' || preflightDigest.length === 0)) {
      return { ok: false, code: 'force_drift',
        error: 'a force run requires the preflightDigest computed from the fresh ' +
          'four-controller readback that preceded it' };
    }

    const provision = provisionState();
    if (!provision.provisioned) {
      return { ok: false, code: 'not_provisioned',
        error: `deployment source not provisioned: ${provision.reasons.join('; ')}`,
        missing: provision.missing };
    }

    if (runningJob) {
      return { ok: false, code: 'busy',
        error: `job ${runningJob.id} (${runningJob.action}` +
          `${runningJob.apply ? ' --yes' : ''}) is still running — one at a time`,
        runningJobId: runningJob.id };
    }

    let validatedDryRun = null;
    if (apply) {
      const phrase = confirmPhraseFor(action, targets.targetIds);
      if (!phrase || confirm !== phrase) {
        return { ok: false, code: 'confirm_mismatch',
          error: `apply requires the exact confirmation phrase '${phrase}'` };
      }
      const dryRun = jobs.get(dryRunJobId);
      if (!dryRun || dryRun.apply || dryRun.action !== action) {
        return { ok: false, code: 'dry_run_required',
          error: `apply requires dryRunJobId referencing a completed '${action}' dry-run` };
      }
      if (dryRun.state !== 'done' || dryRun.exitCode !== 0) {
        return { ok: false, code: 'dry_run_failed',
          error: 'the referenced dry-run did not complete cleanly — re-run it and review ' +
            'the plan' };
      }
      if (dryRun.timedOut || dryRun.outputTruncated ||
          dryRun.verdictLine !== VERDICT_DRY_RUN) {
        return { ok: false, code: 'dry_run_failed',
          error: 'the referenced dry-run has no exact trusted no-write verdict — ' +
            're-run it and review the plan' };
      }
      if (!dryRun.planFingerprint) {
        return { ok: false, code: 'dry_run_failed',
          error: 'the referenced dry-run has no exact SHA-256 plan fingerprint — ' +
            're-run it before applying' };
      }
      // The CLI's dry-run exits 0 and prints its ordinary no-write verdict even
      // when it refused boards on the asset/identity contract — the refusals
      // live in the plan table. Spawning the apply would just burn a pre-flight
      // rejection, so refuse here and hand back the CLI's own first reason.
      const refusal = firstWouldRefuse(dryRun.output);
      if (refusal) {
        return { ok: false, code: 'dry_run_failed',
          error: `the referenced dry-run's plan was REFUSED by the CLI — ${refusal}` };
      }
      // A dry-run is single-use. The moment an apply is accepted against it,
      // it is consumed — a job id lying around in the panel can never arm a
      // second write, and neither can its fingerprint (which is only ever
      // read from the stored dry-run, never from the request body).
      if (dryRun.consumed === true) {
        return { ok: false, code: 'dry_run_consumed',
          error: 'that dry-run has already armed an apply — run a fresh dry-run' };
      }
      const freshMs = isForce ? forceDryRunFreshMs : dryRunFreshMs;
      if (now() - dryRun.endedAt > freshMs) {
        return { ok: false, code: 'dry_run_stale',
          error: `the referenced dry-run is older than ${Math.round(freshMs / 60000)} ` +
            'minutes — re-run it so the plan reflects the fleet now' };
      }
      if (TARGETED_ACTIONS.includes(action) &&
          !sameTargetIds(dryRun.targetIds, targets.targetIds)) {
        return { ok: false, code: 'dry_run_target_mismatch',
          error: 'apply targetIds must exactly match the frozen targetIds from the dry-run' };
      }
      if (isForce) {
        if (!sameTargetIds(dryRun.cliNames, context.cliNames)) {
          return { ok: false, code: 'force_leader_context',
            error: 'apply CLI target names must exactly match the frozen names from the ' +
              'dry-run' };
        }
        if (dryRun.leaderContextUnsafe === true) {
          return { ok: false, code: 'force_leader_context',
            error: 'the dry-run did not prove the leader context is read-only — the CLI must ' +
              'print its exact "already in target mode - no mutation POST would be sent" line ' +
              'for the leader before an apply may run' };
        }
        if (dryRun.preflightDigest !== preflightDigest) {
          return { ok: false, code: 'force_drift',
            error: 'state drifted since the dry-run — the four-controller readback no longer ' +
              'matches the one this plan was reviewed against; re-run the dry-run' };
        }
      }
      validatedDryRun = dryRun;
    }

    let args;
    if (isForce) {
      // The force path is the CLI's OWN `--names` selector and nothing else.
      // This module never writes to a board; it only chooses which registry
      // names the private CLI is allowed to plan for.
      args = [action === ACTION_FORCE_TO_DMX ? 'to-dmx' : 'to-swarm',
        '--names', context.cliNames.join(','),
        ...(apply ? ['--yes', '--rollback-on-failure', '--plan-fingerprint',
          validatedDryRun.planFingerprint] : ['--dry-run'])];
    } else if (action === ACTION_RE_RELEASE) {
      // The CLI's own asset subcommand. It carries no --rollback-on-failure:
      // a re-release has no previous mode to restore, and the CLI reports a
      // failed board loudly in its result table instead.
      args = ['re-release', '--names', targets.targetIds.join(','),
        ...(apply ? ['--yes', '--plan-fingerprint', validatedDryRun.planFingerprint]
          : ['--dry-run'])];
    } else if (action === ACTION_REPAIR_TO_DMX) {
      args = ['to-dmx', '--names', targets.targetIds.join(','),
        ...(apply ? ['--yes', '--rollback-on-failure', '--plan-fingerprint',
          validatedDryRun.planFingerprint] : ['--dry-run'])];
    } else {
      args = action === 'status' ? ['status']
        : apply ? [action, '--yes', '--rollback-on-failure', '--plan-fingerprint',
          validatedDryRun.planFingerprint]
          : [action, '--dry-run'];
    }
    Object.freeze(args);

    const interpreter = env[ENV_PYTHON] || DEFAULT_PYTHON;
    const job = {
      id: String(nextJobId++),
      action,
      apply,
      args,
      targetIds: targets.targetIds,
      cliNames: context.cliNames,
      preflightDigest: isForce ? preflightDigest : null,
      consumed: false,
      leaderContextUnsafe: false,
      state: 'running',
      startedAt: now(),
      endedAt: null,
      exitCode: null,
      timedOut: false,
      outputTruncated: false,
      output: '',
      outputBytes: 0,
      verdictLine: null,
      planFingerprint: apply ? validatedDryRun.planFingerprint : null,
      planFingerprintMismatch: false,
      timeoutTimer: null,
      child: null,
    };

    let child;
    try {
      child = spawnFn(interpreter, [env[ENV_CLI], ...args], {
        env,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      return { ok: false, code: 'spawn_failed',
        error: `could not launch the deploy CLI: ${err.message}` };
    }
    job.child = child;
    jobs.set(job.id, job);
    runningJob = job;
    if (validatedDryRun) validatedDryRun.consumed = true;

    child.stdout.on('data', (chunk) => appendOutput(job, chunk));
    child.stderr.on('data', (chunk) => appendOutput(job, chunk));
    child.on('error', (err) => {
      appendOutput(job, `\n[spawn error] ${err.message}\n`);
      finishJob(job, -1);
    });
    child.on('close', (code) => {
      finishJob(job, code === null ? -1 : code);
    });
    job.timeoutTimer = setTimeout(() => {
      if (job.state !== 'running') return;
      job.timedOut = true;
      appendOutput(job, `\n[killed: exceeded the ${Math.round(jobTimeoutMs / 60000)} minute ` +
        'job ceiling — board state is UNVERIFIED]\n');
      try { child.kill('SIGKILL'); } catch (err) {
        appendOutput(job, `[kill failed: ${err.message}]\n`);
        finishJob(job, -1);
      }
    }, jobTimeoutMs);
    // Never keep the process alive just for the watchdog.
    if (job.timeoutTimer.unref) job.timeoutTimer.unref();

    return { ok: true, job: toPublicJob(job) };
  }

  function getJob(id) {
    const job = jobs.get(id);
    if (!job) return null;
    // A running job's verdict is surfaced live so the panel can show the
    // VERDICT line the moment the CLI prints it.
    if (job.state === 'running') {
      job.verdictLine = extractVerdictLine(job.output);
      if (!job.apply) job.planFingerprint = extractPlanFingerprint(job.output);
    }
    return toPublicJob(job);
  }

  return { provisionState, startJob, getJob };
}

// The save-server's singleton — real env, real spawn.
const defaultService = createSmokestackCliService();

module.exports = {
  ENV_CLI,
  ENV_REGISTRY,
  ENV_PYTHON,
  ACTIONS,
  ACTION_REPAIR_TO_DMX,
  ACTION_RE_RELEASE,
  ACTION_FORCE_TO_DMX,
  ACTION_FORCE_TO_SWARM,
  FORCE_ACTIONS,
  TARGETED_ACTIONS,
  TITANIC_TARGET_IDS,
  TITANIC_LEADER_ID,
  CONFIRM_PHRASES,
  confirmPhraseFor,
  OUTPUT_MAX_BYTES,
  JOB_TIMEOUT_MS,
  DRY_RUN_FRESH_MS,
  FORCE_DRY_RUN_FRESH_MS,
  CLI_NO_WRITE_LINE,
  extractVerdictLine,
  extractPlanFingerprint,
  firstWouldRefuse,
  validateTargetIds,
  validateForceContext,
  createSmokestackCliService,
  defaultService,
};
