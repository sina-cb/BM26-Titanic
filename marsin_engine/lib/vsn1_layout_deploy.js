/**
 * lib/vsn1_layout_deploy.js — VSN1 MIDI-layout deploy hook.
 *
 * The engine is the single source of truth for the 32-slot effects layout
 * (project effects_v2_midi_layout). When the layout CHANGES (an effect is
 * ADDED or REMOVED from a slot — slot assign / clear / rename / recolor /
 * reorder, or a whole-config replace), the slot manager emits a layout-changed
 * event carrying the AFFECTED PAGE(S). This module converts the layout to a
 * JSON file and hands it to the proven VSN1 serial deploy CLI, ONE PAGE AT A
 * TIME, per the pinned single-page contract:
 *
 *     node tools/vsn1_config/deploy_layout.cjs --from-engine --page N --live
 *
 * The CLI (built in parallel by the device/tools track) reads the engine's
 * vsn1_layout.json (`--from-engine`), turns page N into per-element Lua, and
 * flashes just that page of the controller, where it persists until the next
 * deploy. We code ONLY to that CLI contract here.
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
 * This module holds NO device state. It writes a layout JSON into the state
 * dir and spawns the CLI; the last-deploy result is reported back to the
 * caller (api_server surfaces it in engine status).
 */
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The CLI path is fixed by the project contract. Relative to marsin_engine/.
const DEPLOY_CLI_REL = path.join('tools', 'vsn1_config', 'deploy_layout.cjs');
// Soft-reboot CLI (RESET/EXECUTE = hands-free unplug/replug) — run after a
// multi-page flash burst to re-init the device's pad scan (docs/42 Known
// issues: the initial-load pad wedge).
const SOFT_RESET_CLI_REL = path.join('tools', 'vsn1_config', 'soft_reset.cjs');

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
 * @param {(msg:object)=>void} [args.broadcast]  Optional WS broadcaster for
 *        the deploy result (`{ type: 'vsn1LayoutDeploy', ... }`).
 * @param {(ms:number)=>any} [args.setTimeoutFn]  Injectable timer (tests).
 * @param {(t:any)=>void} [args.clearTimeoutFn]   Injectable clear (tests).
 * @returns {{ hook: (evt:object)=>Promise<object>, status: object, flush: ()=>Promise<void> }}
 */
export function createLayoutDeployHook({
  stateDir,
  engineConfig,
  engineRoot,
  debounceMs,
  spawnFn = spawn,
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
  // Pad-wedge mitigation gate: ON unless explicitly disabled in config
  // (`vsn1: { softResetAfterMultiPage: false }`). See runFlush.
  const softResetAfterMultiPage = !(
    engineConfig && engineConfig.vsn1 && engineConfig.vsn1.softResetAfterMultiPage === false
  );
  const layoutFile = path.join(stateDir, 'vsn1_layout.json');
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
    lastResult: null,   // 'ok' | 'error' | 'disabled'
    lastError: null,
    lastPages: null,    // pages flushed in the last deploy run
    pendingPages: [],   // pages waiting for the next flush
    deploying: false,   // busy-guard: a CLI is in flight right now
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
   * Persist the layout JSON (crash-safe: write temp then rename). Always runs
   * — even when deploy is disabled — so tools/operator can read the current
   * layout. Fails loud on a write error (Codex P0).
   */
  function writeLayoutFile(layout) {
    fs.mkdirSync(stateDir, { recursive: true });
    const tmp = `${layoutFile}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(layout, null, 2));
    fs.renameSync(tmp, layoutFile);
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
        while (pendingPages.size > 0) {
          // Deploy pages in ascending order for deterministic behavior/tests.
          const page = [...pendingPages].sort((a, b) => a - b)[0];
          pendingPages.delete(page);
          status.pendingPages = [...pendingPages].sort((a, b) => a - b);
          const cliArgs = [cliPath, '--from-engine', '--page', String(page), '--live'];
          const result = await runCli(spawnFn, cliArgs, { cwd: root });
          status.lastAt = Date.now();
          status.lastPages = [page];
          if (result.code === 0) {
            status.lastResult = 'ok';
            status.lastError = null;
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
          const r = await runCli(spawnFn, [softResetCliPath], { cwd: root });
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

  return { hook, status, flush };
}

/**
 * Run the deploy CLI, resolving with { code, stdout, stderr }. Never rejects
 * on a non-zero exit (the caller decides) — it rejects only on a spawn error
 * (e.g. node missing), which is a genuine fail-loud condition.
 */
function runCli(spawnFn, cliArgs, opts) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnFn('node', cliArgs, { ...opts, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      return reject(e);
    }
    let stdout = '';
    let stderr = '';
    if (child.stdout) child.stdout.on('data', d => { stdout += d.toString(); });
    if (child.stderr) child.stderr.on('data', d => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('close', code => resolve({ code, stdout, stderr }));
  });
}
