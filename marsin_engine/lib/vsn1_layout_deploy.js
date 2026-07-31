/**
 * lib/vsn1_layout_deploy.js — VSN1 MIDI-layout deploy hook.
 *
 * The engine is the single source of truth for the 32-slot effects layout
 * (project effects_v2_midi_layout). When the layout CHANGES (an effect is
 * ADDED or REMOVED from a slot — slot assign / clear / rename / recolor /
 * reorder, or a whole-config replace), the slot manager emits a layout-changed
 * event carrying the AFFECTED PAGE(S). This module writes the layout to a YAML
 * file and hands OFF to the proven VSN1 serial deploy CLI, ONE PAGE AT A TIME,
 * per the pinned single-page contract:
 *
 *     node tools/vsn1_config/deploy_layout.cjs --from-engine --page N --live
 *
 * The CLI reads the LIVE engine over HTTP (`--from-engine` → GET
 * /global-effects/layout etc.), turns page N into per-element Lua, and flashes
 * just that page of the controller, where it persists until the next deploy.
 * The `vsn1_layout.yaml` this module writes is the on-disk INSPECTION artifact
 * of the current layout (for tools/operator), NOT the CLI's input. We code ONLY
 * to that CLI contract here.
 *
 * WHY INCREMENTAL: a full 4-page flash is ~2-3 min; one page is ~10-40s. A UI
 * edit changes exactly one page (the slot's page), so we re-flash only that
 * page. A whole-config replace marks ALL pages.
 *
 * DEBOUNCE + SERIALIZE (project brief §3/§5, Codex P0 SAFETY):
 *   - The deploy CLI opens COM12 (the physical device). Only ONE process may
 *     hold that port, so this module NEVER launches overlapping deploys. A
 *     single in-flight deploy runs at a time (busy-guard); pages that arrive
 *     while a deploy is running (or during the debounce window) are coalesced
 *     into a pending set and flushed, one page per CLI call, in order, after a
 *     short quiet period. A burst of edits across a page becomes ONE deploy for
 *     that page.
 *   - Debounce (~1-2s, configurable) coalesces rapid edits so reassigning
 *     several slots doesn't queue N serial flashes.
 *
 * SAFETY / TEST ISOLATION (project brief + Codex P0):
 *   - Deploy is CONFIG-GATED. It runs ONLY when explicitly enabled (engine
 *     config `vsn1.deployLayout: true` or env `MARSIN_VSN1_DEPLOY=1`). The
 *     default is OFF, so the unit-test suite NEVER spawns the child process.
 *   - Param VALUE changes (intensity / mode / active) are runtime MIDI
 *     feedback and are NOT layout changes — they never reach this module.
 *   - Failures fail LOUDLY (rejected promise + status flag); there is no
 *     silent retry loop and no fallback (Codex P0).
 *
 * ATTACH STATE (2026-07-28, report _30 §4/§5 — the "is it even plugged in?"
 * gate):
 *   Before this, the engine deployed BLIND. The only gate was config, so with
 *   no VSN1 attached every layout change still spawned the full CLI, burned a
 *   ~2-3 s compile, failed with "No VSN1 found", RE-QUEUED the page, and
 *   painted a red NOT-deployed banner in CaptainPad — per change, forever.
 *   There was no concept of "not attached" anywhere in the system.
 *
 *   Now a tri-state `attachState: 'attached' | 'detached' | 'unknown'` is
 *   resolved by a short-lived PROBE CHILD (tools/vsn1_config/probe_vsn1.cjs)
 *   at every decision point — start of a flush drain, boot, explicit deploy.
 *   No polling loop: without native code there are no cheap USB events, and
 *   probing at decision points is exactly sufficient. Serial stays OUT of the
 *   engine process (the crash isolation that has kept device faults away from
 *   the show).
 *
 *   `detached` is an EXPLICIT DESIGNED STATE, not a fallback (Codex P0):
 *   pending pages are cleared, `lastResult` becomes 'skipped-detached', and
 *   EXACTLY ONE line is logged per attached→detached transition — never a
 *   per-change spam, never a crash, never a red error banner. `unknown` (the
 *   probe itself failed) deliberately does NOT block the deploy: we could not
 *   tell, so we do what we always did and let the deploy CLI fail loud.
 *
 * This module holds NO device state beyond that last probe result. It writes a
 * layout YAML into the state dir and spawns the CLI; the last-deploy result is
 * reported back to the caller (api_server surfaces it in engine status).
 */
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

import yaml from 'js-yaml';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The CLI path is fixed by the project contract. Relative to marsin_engine/.
const DEPLOY_CLI_REL = path.join('tools', 'vsn1_config', 'deploy_layout.cjs');
// Soft-reboot CLI (RESET/EXECUTE = hands-free unplug/replug) — run after a
// multi-page flash burst to re-init the device's pad scan (docs/42 Known
// issues: the initial-load pad wedge).
const SOFT_RESET_CLI_REL = path.join('tools', 'vsn1_config', 'soft_reset.cjs');
// Attach probe: enumerates serial ports and answers "is a VSN1 present?".
// NEVER opens the port, so it can run at any moment without colliding with a
// deploy's exclusive hold. Exit 0 = attached, 3 = detached, 1 = probe error.
const PROBE_CLI_REL = path.join('tools', 'vsn1_config', 'probe_vsn1.cjs');

// Probe exit codes → attach state. The 3-vs-anything-else split is load
// bearing: "no device" (3) and "the probe broke" (1) are DIFFERENT states and
// must never collapse, or one broken probe would silently disable deploys.
const PROBE_EXIT_ATTACHED = 0;
const PROBE_EXIT_DETACHED = 3;

// The one line the operator sees when a layout change lands with no device.
// Printed ONCE per attached→detached transition (never per change).
const DETACHED_SKIP_LINE =
  'VSN1 not attached — layout deploy skipped (deploys resume on next change once attached)';

// Default quiet period before a coalesced burst of layout edits deploys. Kept
// in the 1-2s band the brief specifies; overridable via engine config
// (`vsn1.deployDebounceMs`) for tuning without a code change.
const DEFAULT_DEBOUNCE_MS = 1200;

/**
 * Decide whether layout deploy is enabled. Precedence (highest first):
 *   1. env `MARSIN_VSN1_DEPLOY=1` → force ON  (party laptop, no config edit)
 *   2. env `MARSIN_VSN1_DEPLOY=0` → force OFF (tests / CI / any machine that
 *      must never spawn the deploy child, regardless of the committed config)
 *   3. engine config `vsn1: { deployLayout: true }`
 * Off by default so a machine with no VSN1 never flashes. The explicit `0`
 * override is what lets a unit test pin deploy OFF independent of config.yaml,
 * instead of fragilely depending on the committed default.
 *
 * @param {object} [engineConfig]
 * @returns {boolean}
 */
export function isLayoutDeployEnabled(engineConfig) {
  if (process.env.MARSIN_VSN1_DEPLOY === '1') return true;
  if (process.env.MARSIN_VSN1_DEPLOY === '0') return false;
  const vsn1 = engineConfig && engineConfig.vsn1;
  return !!(vsn1 && vsn1.deployLayout === true);
}

/**
 * Build a layout-deploy hook bound to a state dir + config. The returned
 * function matches GlobalEffectSlotManager's `onLayoutChanged(evt)` shape
 * (`{ type, revision, pages, layout }`).
 *
 * When deploy is DISABLED (default), the hook still writes the layout JSON to
 * disk (so the operator/tools can inspect the current layout) but does NOT
 * spawn the CLI — it records `{ deployed: false, reason: 'disabled' }`. When
 * ENABLED, it coalesces the affected pages, debounces, and flashes each
 * changed page via the CLI — serialized so COM12 is never opened twice at once.
 *
 * @param {object} args
 * @param {string} args.stateDir           Where the layout JSON is written.
 * @param {object} [args.engineConfig]     Read for the deploy gate + debounce.
 * @param {string} [args.engineRoot=marsin_engine]  Dir the CLI path is resolved from.
 * @param {number} [args.debounceMs]       Override the coalesce quiet period.
 * @param {(cmd:string,cliArgs:string[],opts:object)=>object} [args.spawnFn]
 *        Injectable spawn (defaults to child_process.spawn) so tests can
 *        assert the CLI invocation WITHOUT launching a process.
 * @param {()=>Promise<'attached'|'detached'|'unknown'>} [args.probeFn]
 *        Injectable attach probe (defaults to running probe_vsn1.cjs through
 *        `spawnFn`) so tests can drive attach/detach transitions WITHOUT a
 *        device and without a process.
 * @param {(msg:object)=>void} [args.broadcast]  Optional WS broadcaster for
 *        the deploy result (`{ type: 'vsn1LayoutDeploy', ... }`).
 * @param {(ms:number)=>any} [args.setTimeoutFn]  Injectable timer (tests).
 * @param {(t:any)=>void} [args.clearTimeoutFn]   Injectable clear (tests).
 * @returns {{ hook: (evt:object)=>Promise<object>, status: object,
 *            flush: ()=>Promise<void>, probeAttach: ()=>Promise<string>,
 *            dispose: ()=>void }}
 */
export function createLayoutDeployHook({
  stateDir,
  engineConfig,
  engineRoot,
  debounceMs,
  spawnFn = spawn,
  probeFn,
  broadcast,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
} = {}) {
  if (!stateDir || typeof stateDir !== 'string') {
    throw new Error('createLayoutDeployHook: stateDir is required');
  }
  const root = engineRoot || path.resolve(__dirname, '..');
  const cliPath = path.join(root, DEPLOY_CLI_REL);
  const softResetCliPath = path.join(root, SOFT_RESET_CLI_REL);
  const probeCliPath = path.join(root, PROBE_CLI_REL);
  // Pad-wedge mitigation gate: ON unless explicitly disabled in config
  // (`vsn1: { softResetAfterMultiPage: false }`). See runFlush.
  const softResetAfterMultiPage = !(
    engineConfig && engineConfig.vsn1 && engineConfig.vsn1.softResetAfterMultiPage === false
  );
  const layoutFile = path.join(stateDir, 'vsn1_layout.yaml');
  // A pre-v3 build wrote vsn1_layout.json here; delete that sibling on write so
  // a stale JSON artifact never lingers next to the canonical YAML (D9).
  const staleJsonFile = path.join(stateDir, 'vsn1_layout.json');
  const quietMs = Number.isFinite(debounceMs)
    ? debounceMs
    : (engineConfig && engineConfig.vsn1 && Number.isFinite(engineConfig.vsn1.deployDebounceMs)
      ? engineConfig.vsn1.deployDebounceMs
      : DEFAULT_DEBOUNCE_MS);

  // Last-deploy status, surfaced in engine status by the API layer.
  const status = {
    enabled: isLayoutDeployEnabled(engineConfig),
    lastRevision: null,
    lastAt: null,
    lastResult: null,   // 'ok' | 'error' | 'disabled' | 'skipped-detached'
    lastError: null,
    lastPages: null,    // pages flushed in the last deploy run
    pendingPages: [],   // pages waiting for the next flush
    deploying: false,   // busy-guard: a CLI is in flight right now
    // Attach tri-state (report _30 §5). 'unknown' until the first probe runs —
    // we have genuinely not looked yet, and saying 'detached' before looking
    // would be a lie the UI would render.
    attachState: 'unknown',
    lastProbeAt: null,
    layoutFile,
    debounceMs: quietMs,
  };

  // ── Debounce + serialize state (COM12 is a single-holder resource) ────
  // pendingPages: the coalesced set of page indices to flash on the next run.
  // A slot patch adds one page; a whole-config replace adds all. Multiple
  // edits to the SAME page collapse to one entry (Set), so a burst is one
  // deploy per page.
  const pendingPages = new Set();
  let debounceTimer = null;   // the quiet-period timer
  let flushing = false;       // busy-guard: a flush loop is running
  let flushPromise = null;    // the in-flight runFlush() promise (or null)
  // Teardown handle (step 10): the CLI child currently running, so shutdown can
  // kill it instead of exiting with a live pipe attached.
  let activeChild = null;

  // ── Attach state (report _30 §5) ──────────────────────────────────────
  // lastAttachState is the LATCH that makes the skip message fire exactly once
  // per transition. Without it, an operator who unplugs the VSN1 and keeps
  // editing would get one skip line per edit — the spam this whole state
  // machine exists to prevent.
  let lastAttachState = null;
  // The layout revision we declined to deploy because nothing was plugged in.
  // On the next probe that finds the device, page 0 is re-queued ONCE so the
  // device catches up on the edits it missed (§5 "Reattach").
  let deferredRevision = null;
  let lastDeployedRevision = null;

  /**
   * Default attach probe: run probe_vsn1.cjs and map its EXIT CODE (never its
   * text) to the tri-state. Uses the injected spawnFn so a test can drive the
   * probe without a process.
   */
  async function probeViaCli() {
    const r = await runCli(spawnFn, [probeCliPath], { cwd: root }, (c) => { activeChild = c; });
    if (r.code === PROBE_EXIT_ATTACHED) return 'attached';
    if (r.code === PROBE_EXIT_DETACHED) return 'detached';
    // Any other code is the probe itself failing — NOT evidence of absence.
    console.warn(
      `⚠ VSN1 attach probe exited ${r.code} (expected 0=attached / 3=detached) — ` +
        `attach state UNKNOWN. ${(r.stderr || '').slice(0, 200)}`,
    );
    return 'unknown';
  }

  const runProbe = typeof probeFn === 'function' ? probeFn : probeViaCli;

  /**
   * Resolve the current attach state and update `status`. NEVER throws: a
   * probe that blows up (spawn error, bad return) resolves to 'unknown', which
   * is a real designed state that lets the deploy proceed and fail loud on its
   * own — it does not silently suppress deploys.
   */
  async function resolveAttachState() {
    let state;
    try {
      state = await runProbe();
    } catch (e) {
      console.warn(`⚠ VSN1 attach probe FAILED: ${e.message} — attach state UNKNOWN.`);
      state = 'unknown';
    }
    if (state !== 'attached' && state !== 'detached' && state !== 'unknown') {
      console.warn(
        `⚠ VSN1 attach probe returned an invalid state ${JSON.stringify(state)} — ` +
          `treating as UNKNOWN.`,
      );
      state = 'unknown';
    }
    status.attachState = state;
    status.lastProbeAt = Date.now();
    logAttachTransition(state);
    return state;
  }

  /** Log ONCE per state transition — the anti-spam latch. */
  function logAttachTransition(state) {
    if (state === lastAttachState) return;
    const previous = lastAttachState;
    lastAttachState = state;
    if (state === 'detached') {
      console.log(`🎛 ${DETACHED_SKIP_LINE}`);
    } else if (state === 'attached') {
      // Silent on the very first probe of a healthy boot — "it works" is not
      // news. Only a RECOVERY is worth a line.
      if (previous !== null) console.log('🎛 VSN1 attached — layout deploy resumed.');
    } else {
      console.warn(
        '⚠ VSN1 attach state UNKNOWN (probe did not answer) — attempting the deploy anyway; ' +
          'the deploy CLI fails loud if the device is absent.',
      );
    }
  }

  /**
   * Detached is a designed terminal state for this drain, not an error: drop
   * the queued pages (they would only pile up), record it, and say nothing
   * further — the ONE transition line above is the whole operator signal.
   */
  function settleDetached() {
    deferredRevision = status.lastRevision;
    pendingPages.clear();
    status.pendingPages = [];
    status.lastAt = Date.now();
    status.lastResult = 'skipped-detached';
    status.lastError = null;
    status.lastPages = [];
  }

  /**
   * Reattach catch-up (§5): the device is back and the layout moved on while
   * it was gone, so queue page 0 exactly once.
   */
  function queueDeferredOnReattach() {
    if (deferredRevision === null) return;
    if (deferredRevision === lastDeployedRevision) { deferredRevision = null; return; }
    deferredRevision = null;
    pendingPages.add(0);
    status.pendingPages = [...pendingPages].sort((a, b) => a - b);
    console.log('🎛 VSN1 back — re-queuing page 0 to catch up on edits made while it was unplugged.');
  }

  function armDebounce() {
    if (debounceTimer) clearTimeoutFn(debounceTimer);
    debounceTimer = setTimeoutFn(() => {
      debounceTimer = null;
      // Fire-and-report: the flush loop owns its own status/broadcast reporting
      // AND now logs each page failure loudly (see runFlush). A rejection here
      // must not crash the timer callback, but it must not be silently swallowed
      // either — log it so a debounced auto-deploy failure is visible.
      runFlush().catch((e) => {
        console.error(`[VSN1] debounced layout deploy failed: ${e.message}`);
      });
    }, quietMs);
  }

  /**
   * Persist the layout YAML (crash-safe: write temp then rename). Always runs
   * — even when deploy is disabled — so tools/operator can read the current
   * layout. Fails loud on a write error (Codex P0). After the rename, delete any
   * lingering pre-v3 `vsn1_layout.json` sibling (D9) — a warn on unlink failure,
   * never fatal (the YAML write already succeeded).
   */
  function writeLayoutFile(layout) {
    fs.mkdirSync(stateDir, { recursive: true });
    const tmp = `${layoutFile}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, yaml.dump(layout));
    fs.renameSync(tmp, layoutFile);
    try {
      if (fs.existsSync(staleJsonFile)) fs.unlinkSync(staleJsonFile);
    } catch (e) {
      console.warn(`[VSN1] could not remove stale ${staleJsonFile}: ${e.message}`);
    }
  }

  /**
   * Drain the pending-pages set, deploying ONE page per CLI call, strictly
   * serialized (COM12 single-holder). Re-checks the set after each page so
   * pages that arrive mid-flush are picked up in the same drain. Guarded so
   * only one flush loop ever runs — a second caller is a no-op (the running
   * loop will see the newly-added pages). On the FIRST page error it stops and
   * fails loud (no silent retry storm); remaining pending pages stay queued
   * for the next explicit change.
   */
  function runFlush() {
    // Busy-guard — only one loop ever runs. A second caller rides the same
    // in-flight promise (the running loop re-checks pendingPages after every
    // page, so newly-added pages are picked up without a second COM12 open).
    if (flushing) return flushPromise;
    flushing = true;
    status.deploying = true;
    flushPromise = (async () => {
      let firstError = null;
      let pagesFlashed = 0;
      // try/finally (audit 2026-07-10 stuck-state #3): a runCli REJECTION
      // (spawn error — node missing, EMFILE) used to escape the loop before
      // the flag resets, wedging `flushing`/`status.deploying` at true
      // FOREVER (every later flush no-ops on the busy-guard). The finally
      // guarantees the reset + final broadcast on every exit path; the
      // rejection itself still propagates (fail loud, no retry).
      try {
        // ── ATTACH GATE (report _30 §5) ───────────────────────────────
        // Ask ONCE per drain, before burning a ~2-3 s compile in a child that
        // can only end in "No VSN1 found". This is also what catches the
        // device VANISHING between the debounce and the drain.
        const attach = await resolveAttachState();
        if (attach === 'detached') {
          settleDetached();
          return; // finally below resets the guards and broadcasts
        }
        queueDeferredOnReattach();
        while (pendingPages.size > 0) {
          // Deploy pages in ascending order for deterministic behavior/tests.
          const page = [...pendingPages].sort((a, b) => a - b)[0];
          pendingPages.delete(page);
          status.pendingPages = [...pendingPages].sort((a, b) => a - b);
          const cliArgs = [cliPath, '--from-engine', '--page', String(page), '--live'];
          const result = await runCli(spawnFn, cliArgs, { cwd: root }, (c) => { activeChild = c; });
          status.lastAt = Date.now();
          status.lastPages = [page];
          if (result.code === 0) {
            status.lastResult = 'ok';
            status.lastError = null;
            lastDeployedRevision = status.lastRevision;
            pagesFlashed += 1;
            if (broadcast) broadcast({ type: 'vsn1LayoutDeploy', ...status });
          } else {
            status.lastResult = 'error';
            status.lastError = result.stderr || `deploy CLI exited ${result.code}`;
            // Re-queue the FAILED page so the next hook event retries it. The
            // old code deleted it above BEFORE the attempt and never re-added it
            // on failure — a page that overflowed the LCD budget was stranded
            // out of the queue forever (live evidence: page 1 pending never
            // cleared). Re-adding on failure keeps exactly one retry per future
            // change, NOT a busy retry loop (we still `break` the drain).
            pendingPages.add(page);
            status.pendingPages = [...pendingPages].sort((a, b) => a - b);
            // LOUD failure surfacing (Codex P0 fail-loud): the old flush path
            // only set status.lastError with no console output, so a failed
            // flash was triple-silenced (debounce .catch(()=>{}), no api_server
            // log for flush failures). Print the page + the CLI stderr so the
            // operator learns WHY a page didn't flash.
            console.error(
              `[VSN1] page ${page} deploy FAILED: ${status.lastError}`,
            );
            if (broadcast) broadcast({ type: 'vsn1LayoutDeploy', ...status });
            // Fail loud — no silent retry loop (Codex P0). Stop the drain; the
            // failed + remaining pages stay pending for the operator's next change.
            firstError = new Error(`VSN1 layout deploy failed (page ${page}): ${status.lastError}`);
            break;
          }
        }
        // Initial-load pad-wedge mitigation (docs/42 Known issues, confirmed
        // on hardware 2026-07-10): a MULTI-page back-to-back flash burst can
        // wedge the device's pad scan (8 pads + encoder dead until a power
        // cycle). RESET/EXECUTE is a soft MCU reboot — the hands-free
        // unplug/replug (NVM config survives; verified live). After any drain
        // that flashed 2+ pages, reboot the device so its scan re-inits; the
        // device's post-boot hello then drives CaptainPad's full resync.
        // Single-page flashes (the common mid-session case) are proven safe
        // and skip this. Gate: vsn1.softResetAfterMultiPage !== false.
        if (pagesFlashed >= 2 && firstError === null && softResetAfterMultiPage) {
          const r = await runCli(spawnFn, [softResetCliPath], { cwd: root }, (c) => { activeChild = c; });
          if (r.code === 0) {
            console.log('🎛 VSN1 soft reset after multi-page flash (pad-scan re-init).');
          } else {
            // Loud but non-fatal: the flash itself succeeded; the operator
            // may just need the manual remedy if the pads are wedged.
            console.warn(
              `⚠ VSN1 soft reset after multi-page flash FAILED (exit ${r.code}) — ` +
                `if the pads are dead, run tools/vsn1_config/soft_reset.cjs or unplug/replug. ` +
                `${(r.stderr || '').slice(0, 200)}`,
            );
          }
        }
      } finally {
        flushing = false;
        activeChild = null;
        status.deploying = false;
        status.pendingPages = [...pendingPages].sort((a, b) => a - b);
        // FINAL broadcast with deploying=false — the per-page broadcasts above
        // all carry deploying=true (set for the whole drain), so a consumer
        // gating on "deploy finished" (CaptainPad's resyncVsn1AfterLayoutDeploy)
        // never fired off them (review D1, 2026-07-10). This one is the real
        // "deploy finished" signal.
        if (broadcast) broadcast({ type: 'vsn1LayoutDeploy', ...status });
      }
      if (firstError) throw firstError;
    })();
    return flushPromise;
  }

  async function hook(evt) {
    status.lastRevision = evt && evt.revision != null ? evt.revision : null;
    const layout = evt && evt.layout ? evt.layout : { version: 1, slots: [] };
    // Affected pages: the slot manager sends the exact page(s) that changed.
    // Fall back to no pages (nothing to flash) if the event omits them — the
    // JSON is still written so the artifact stays current.
    const pages = Array.isArray(evt && evt.pages) ? evt.pages : [];

    // Always persist the layout JSON.
    try {
      writeLayoutFile(layout);
    } catch (e) {
      status.lastResult = 'error';
      status.lastError = `failed to write layout file: ${e.message}`;
      status.lastAt = Date.now();
      if (broadcast) broadcast({ type: 'vsn1LayoutDeploy', ...status });
      throw e; // fail loud
    }

    if (!isLayoutDeployEnabled(engineConfig)) {
      status.lastResult = 'disabled';
      status.lastError = null;
      status.lastAt = Date.now();
      if (broadcast) broadcast({ type: 'vsn1LayoutDeploy', ...status });
      return { deployed: false, reason: 'disabled', layoutFile, pages };
    }

    // PAGE-0-ONLY CLAMP (own-page retirement, effects_v2 2026-07): the device
    // is a fixed page-0 surface. A layout change on an INVISIBLE page (1-3)
    // flashes nothing the operator can see AND a multi-page flash burst is what
    // wedged the pad scan — so we drop pages 1-3 entirely and only ever queue
    // page 0. The engine still tracks logical pages 1-3 (effectsPage plumbing);
    // they just never reach the device. Pass --allow-nonzero-page to the CLI by
    // hand for deliberate manual recovery of a stale page.
    const clampedPages = pages.filter((p) => p === 0);
    const droppedPages = pages.filter((p) => p !== 0);
    if (droppedPages.length > 0) {
      console.log(
        `🎛 VSN1 deploy: page(s) ${droppedPages.join(', ')} are invisible on the fixed ` +
          `page-0 device (own-page retirement) — not flashed. ` +
          `${clampedPages.length ? 'Page 0 queued.' : 'Nothing to flash.'}`,
      );
    }

    // Coalesce the affected pages and (re)arm the debounce. The actual CLI
    // spawn happens later, serialized, in runFlush — never inline here, so a
    // burst of hook() calls can't launch overlapping COM12 deploys.
    for (const p of clampedPages) pendingPages.add(p);
    status.pendingPages = [...pendingPages].sort((a, b) => a - b);
    if (pendingPages.size > 0) armDebounce();
    return {
      deployed: false,
      reason: clampedPages.length ? 'debounced' : 'no-visible-page',
      layoutFile,
      pages: clampedPages,
      droppedPages,
      pendingPages: status.pendingPages,
    };
  }

  /**
   * Await quiescence: resolve once the debounce window has (been forced to)
   * elapse and no flush loop is running — i.e. all coalesced pages have been
   * deployed. Used by tests + the engine's optional shutdown drain to
   * deterministically wait for the coalesced deploy to complete; normal engine
   * operation is fire-and-forget. Rejects (once) if the drain failed loud.
   *
   * Skips the debounce wait entirely: it cancels any armed timer and drives
   * the flush loop immediately, then re-drives if a fresh page landed while it
   * was running, until the pending set is empty.
   */
  async function flush() {
    // Cancel a pending debounce — we deploy now rather than wait it out.
    if (debounceTimer) { clearTimeoutFn(debounceTimer); debounceTimer = null; }
    // Drive to quiescence. runFlush() is idempotent under the busy-guard: if a
    // loop is already running we await it, then re-check for stragglers.
    while (flushing || pendingPages.size > 0) {
      await runFlush();
    }
  }

  /**
   * Probe the device on demand and report the tri-state. Used by the BOOT
   * deploy path and the deploy-status endpoint so "should I even try?" is
   * answered the same way everywhere. Queues the reattach catch-up if the
   * device came back while the layout moved on.
   */
  async function probeAttach() {
    // Deploy gated OFF ⇒ we do not touch the device layer AT ALL, not even to
    // look. The gate's whole purpose is that a test machine or a dev laptop
    // never spawns a VSN1 child; a probe is still a child. 'unknown' is the
    // honest answer here — we did not look, which is not the same as absent.
    if (!isLayoutDeployEnabled(engineConfig)) return 'unknown';
    const state = await resolveAttachState();
    if (state !== 'detached') {
      queueDeferredOnReattach();
      if (pendingPages.size > 0) armDebounce();
    }
    return state;
  }

  /**
   * Release everything this module owns, for engine shutdown (report _30 step
   * 10). The libuv `!(handle->flags & UV_HANDLE_CLOSING)` abort can only be
   * tripped while handles are being torn down, so the fix direction is to
   * SHRINK the set of live handles at exit: cancel the debounce timer and kill
   * any CLI child whose stdout/stderr pipes we are still holding. Idempotent.
   */
  function dispose() {
    if (debounceTimer) { clearTimeoutFn(debounceTimer); debounceTimer = null; }
    const child = activeChild;
    activeChild = null;
    if (!child) return;
    try {
      if (typeof child.kill === 'function') child.kill();
      if (typeof child.unref === 'function') child.unref();
    } catch (e) {
      // Loud but non-fatal: we are already shutting down, and a child that
      // refuses to die must not block the blackout frame.
      console.warn(`⚠ VSN1 deploy child could not be killed on shutdown: ${e.message}`);
    }
  }

  return { hook, status, flush, probeAttach, dispose };
}

/**
 * Run the deploy CLI, resolving with { code, stdout, stderr }. Never rejects
 * on a non-zero exit (the caller decides) — it rejects only on a spawn error
 * (e.g. node missing), which is a genuine fail-loud condition.
 *
 * `onSpawn` hands the live child back to the caller so shutdown can kill it
 * (report _30 step 10: exiting with a child's pipes still attached is one of
 * the live-handle teardown surfaces behind the libuv async.c:94 abort).
 */
function runCli(spawnFn, cliArgs, opts, onSpawn) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnFn('node', cliArgs, { ...opts, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      return reject(e);
    }
    if (typeof onSpawn === 'function') onSpawn(child);
    let stdout = '';
    let stderr = '';
    if (child.stdout) child.stdout.on('data', d => { stdout += d.toString(); });
    if (child.stderr) child.stderr.on('data', d => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('close', code => resolve({ code, stdout, stderr }));
  });
}
