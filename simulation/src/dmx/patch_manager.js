/**
 * patch_manager.js — Single source of truth for DMX patch state.
 *
 * All patch routing decisions flow through this module.
 * State is derived exclusively from `params.parLights`.
 *
 * Responsibilities:
 *   1. Track which fixtures are patched (from params.parLights)
 *   2. Provide query utilities (allPatched, nonePatched, partiallyPatched)
 *   3. Manage the "unpatched" warning banner
 *   4. Coordinate patch file I/O (read/write patches.yaml via save-server)
 *   5. Notify sACN bridge when patches change
 *
 * Consumers:
 *   - animate.js: gates direct vs DMX rendering paths via window._patchesActive
 *   - auto_patcher.js: calls recompute() after patching/clearing
 *   - fixtures.js: calls recompute() after rebuild
 *   - gui_builder.js: calls recompute() after manual patch edits
 *   - main.js: calls recompute() after scene load
 */
import { params } from "../core/state.js";

// ─── Internal State ──────────────────────────────────────────────────────
let _patchedCount = 0;    // number of fixtures with valid patches
let _totalCount = 0;      // total number of fixtures
let _warningEl = null;
let _universeWarningEl = null;
let _lastUniverseWarning = ''; // dedupe

/**
 * Parse a comma-separated `sacn_universes` config string into a sorted
 * array of positive integers (deduped). Shared by derive + validate so the
 * two stay in lockstep.
 */
function _parseUniverseList(configStr) {
  return [...new Set(
    String(configStr || '')
      .split(',')
      .map((u) => parseInt(u.trim(), 10))
      .filter((u) => !isNaN(u) && u > 0)
  )].sort((a, b) => a - b);
}

/**
 * Collect every DMX universe referenced by the current patches (fixtures +
 * LED strands). This is the authoritative set the sim must subscribe to so a
 * freshly-patched model lights up without a manual sACN-settings detour.
 * @returns {number[]} sorted, deduped, positive universe numbers
 */
function deriveSubscribedUniverses(fixtures) {
  const universes = new Set();
  const add = (entry) => {
    const u = entry && parseInt(entry.dmxUniverse, 10);
    if (u > 0) universes.add(u);
  };
  if (fixtures) for (const f of fixtures) add(f);
  // LED strands carry their own patch record and are NOT in params.parLights.
  // A strand may SPILL across universes (128 RGBW px/universe): subscribe to
  // EVERY universe its segments touch, not just the start — otherwise spill
  // universes render dark under sACN-in (G2). Legacy records with no segments
  // field (freshly loaded, pre-first-projection) fall back to the start
  // universe only — identical to the old behavior, never a silent drop.
  if (params.ledStrands) {
    for (const s of params.ledStrands) {
      if (s && Array.isArray(s.segments) && s.segments.length > 0) {
        for (const seg of s.segments) {
          const u = parseInt(seg && seg.universe, 10);
          if (u > 0) universes.add(u);
        }
      } else {
        add(s);
      }
    }
  }
  return [...universes].sort((a, b) => a - b);
}

/**
 * Auto-subscribe: ensure `params.sacn_universes` contains every universe the
 * current patches reference. Whenever patches change (boot, auto-patch,
 * manual edit) we re-derive from the loaded model and merge any newly-patched
 * universes into the subscribed list — no manual "add universe, restart"
 * step. The browser sACN-IN source already auto-adds router universes on the
 * first frame; this closes the validation/config gap so the loud mismatch
 * banner only fires for a universe that genuinely cannot be subscribed.
 *
 * Loud by design: every auto-added universe is logged. No silent failure — if
 * `params.sacn_universes` is missing the derived universes still flow through
 * and the merge is reported.
 * @returns {number[]} universes that were newly added (empty if no change)
 */
function autoSubscribePatchUniverses(fixtures) {
  const referenced = deriveSubscribedUniverses(fixtures);
  if (referenced.length === 0) return [];

  const subscribed = new Set(_parseUniverseList(params.sacn_universes));
  const added = referenced.filter((u) => !subscribed.has(u));
  if (added.length === 0) return [];

  const merged = [...new Set([...subscribed, ...added])].sort((a, b) => a - b);
  params.sacn_universes = merged.join(', ');

  // Reflect the new value in the sACN Settings control so the operator sees
  // the live subscribed set (no stale UI).
  const ctrl = window._guiControllers && window._guiControllers.sacn_universes;
  if (ctrl && typeof ctrl.updateDisplay === 'function') ctrl.updateDisplay();

  console.log(
    `[PatchManager] Auto-subscribed sACN universe(s) [${added.join(', ')}] ` +
    `from patches — subscribed set now [${merged.join(', ')}].`
  );

  // Persist: arm the SAME debounced save every other mutation arms — this
  // path deliberately does NOT force a write (slice S4). Auto-subscribe is an
  // incidental side effect of a patch recompute, and the operator runs with
  // `config.autoSave: false` precisely so nothing writes the scene behind his
  // back; forcing `exportConfig()` here would turn every merged universe into
  // a surprise full-scene save (and would make read-only agent tools that
  // stub `debounceAutoSave` start saving scenes).
  //
  // No bridge notify here either: the bridge rebuilds its relay routes by
  // re-reading `patches.yaml` ON DISK, so notifying before (or without) a
  // write only makes it re-read the OLD file and look like progress. When the
  // debounced save actually lands, `exportConfig`'s own post-save notify tells
  // the bridge — after the write, never 500 ms into it.
  if (typeof window.debounceAutoSave === 'function') window.debounceAutoSave();

  return added;
}

/**
 * Validate that all patched fixture universes are in the sacn_universes config.
 * Logs loud errors and shows a persistent red banner if mismatches found.
 * Runs AFTER autoSubscribePatchUniverses, so by here a mismatch means a
 * universe genuinely could not be subscribed — fail loudly, don't paper over.
 */
function _validatePatchUniverses(fixtures) {
  if (!fixtures || fixtures.length === 0) return;

  // Parse configured universes from params
  const configStr = params.sacn_universes || '';
  if (!configStr) return; // no config = no validation
  const configUniverses = new Set(_parseUniverseList(configStr));
  if (configUniverses.size === 0) return;

  // Collect universes actually used by patches (fixtures + LED strands).
  const missingUniverses = new Set();
  for (const u of deriveSubscribedUniverses(fixtures)) {
    if (!configUniverses.has(u)) missingUniverses.add(u);
  }

  if (missingUniverses.size > 0) {
    const missing = [...missingUniverses].sort((a, b) => a - b);
    const configList = [...configUniverses].sort((a, b) => a - b).join(', ');
    const msg = `🚨 UNIVERSE MISMATCH — Patches use universe(s) [${missing.join(', ')}] but sacn_universes only has [${configList}]. Fix: ⚡ Lighting Engine → 📡 sACN Settings → Subscribed Universes — add the missing universe(s) and restart the simulation.`;
    
    // Only log if changed (avoid spam from the 10s poll)
    if (msg !== _lastUniverseWarning) {
      _lastUniverseWarning = msg;
      console.error(`[PatchManager] ${msg}`);
    }

    // Show persistent red warning banner
    if (!_universeWarningEl) {
      _universeWarningEl = document.createElement('div');
      _universeWarningEl.id = 'universe-mismatch-warning';
      _universeWarningEl.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;background:#cc0000;color:white;font-weight:bold;font-size:13px;padding:10px 16px;text-align:center;font-family:monospace;cursor:pointer;line-height:1.6;';
      _universeWarningEl.title = 'Click to dismiss';
      _universeWarningEl.onclick = () => { _universeWarningEl.style.display = 'none'; };
      document.body.appendChild(_universeWarningEl);
    }
    _universeWarningEl.innerHTML = 
      `🚨 UNIVERSE MISMATCH: Patches reference universe(s) [${missing.join(', ')}] not in Subscribed Universes [${configList}]<br>` +
      `<span style="font-weight:normal;font-size:12px;">Fix: ⚡ Lighting Engine → 📡 sACN Settings → 📡 Subscribed Universes — add the missing universe(s), save, and restart the simulation.</span>`;
    _universeWarningEl.style.display = '';
  } else {
    // All good — hide warning if it was shown
    if (_universeWarningEl) _universeWarningEl.style.display = 'none';
    _lastUniverseWarning = '';
  }
}

// ─── Warning Banner ──────────────────────────────────────────────────────
function _updateWarning(show) {
  if (show) {
    if (!_warningEl) {
      _warningEl = document.createElement('div');
      _warningEl.id = 'unpatched-warning';
      _warningEl.setAttribute('role', 'status');
      _warningEl.textContent = '\u26A0 UNPATCHED \u2014 SIM-ONLY MODE';
      document.body.appendChild(_warningEl);
    }
    _warningEl.classList.remove('hidden');
  } else if (_warningEl) {
    _warningEl.classList.add('hidden');
  }
}

function _isPatched(f) {
  return f && f.dmxUniverse > 0 && f.dmxAddress > 0;
}

let _ipWarningEl = null;
let _lastIpWarning = '';

/**
 * Validate that all patched fixtures have a controllerIp set.
 * Warns loudly if any patched fixture is missing its controller IP —
 * this means sACN output won't know where to send data.
 */
function _validateControllerIps(fixtures) {
  if (!fixtures || fixtures.length === 0) return;

  const missingIp = [];
  for (const f of fixtures) {
    if (!f) continue;
    // Only check fixtures that ARE patched (have universe + address)
    if (f.dmxUniverse > 0 && f.dmxAddress > 0) {
      const ip = f.controllerIp;
      if (!ip || ip === '' || ip === '0.0.0.0') {
        missingIp.push(f.name || `Fixture ${f.dmxUniverse}:${f.dmxAddress}`);
      }
    }
  }

  if (missingIp.length > 0) {
    const msg = `⚠ MISSING CONTROLLER IP — ${missingIp.length} patched fixture(s) have no controllerIp: ${missingIp.slice(0, 5).join(', ')}${missingIp.length > 5 ? ` (+${missingIp.length - 5} more)` : ''}`;

    if (msg !== _lastIpWarning) {
      _lastIpWarning = msg;
      console.warn(`[PatchManager] ${msg}`);
    }

    if (!_ipWarningEl) {
      _ipWarningEl = document.createElement('div');
      _ipWarningEl.id = 'controller-ip-warning';
      _ipWarningEl.style.cssText = 'position:fixed;top:40px;left:50%;transform:translateX(-50%);max-width:500px;z-index:99998;background:rgba(180,100,0,0.92);color:white;font-size:10px;padding:6px 12px;text-align:center;font-family:monospace;border-radius:6px;cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,0.4);backdrop-filter:blur(8px);line-height:1.4;';
      _ipWarningEl.title = 'Click to dismiss';
      _ipWarningEl.onclick = () => { _ipWarningEl.style.display = 'none'; };
      document.body.appendChild(_ipWarningEl);
    }
    const names = missingIp.slice(0, 6).join(', ') + (missingIp.length > 6 ? ` (+${missingIp.length - 6} more)` : '');
    _ipWarningEl.textContent = `⚠ ${missingIp.length} patched fixture(s) missing Controller IP: ${names}`;
    _ipWarningEl.style.display = '';
  } else {
    if (_ipWarningEl) _ipWarningEl.style.display = 'none';
    _lastIpWarning = '';
  }
}

// ─── Core State API ──────────────────────────────────────────────────────

/**
 * Recompute patch state from the authoritative source (params.parLights).
 * Call this after any operation that could change patch assignments.
 */
function recompute() {
  const fixtures = params.parLights;
  _totalCount = (fixtures && fixtures.length) || 0;
  _patchedCount = 0;
  if (fixtures) {
    for (let i = 0; i < fixtures.length; i++) {
      if (_isPatched(fixtures[i])) _patchedCount++;
    }
  }
  window._patchesActive = _patchedCount > 0;
  _updateWarning(_patchedCount === 0 && _totalCount > 0);
  console.log(`[PatchManager] ${_patchedCount}/${_totalCount} patched, active=${window._patchesActive}`);

  // ── Auto-subscribe: extend sacn_universes to cover every patched universe ──
  // (re-derived from the loaded model on every patch change). Runs BEFORE
  // validation so a normally-patched model just lights up — no manual
  // "add universe + restart" step.
  autoSubscribePatchUniverses(fixtures);
  // ── Universe validation: warn loudly if patches still reference unsubscribed universes ──
  _validatePatchUniverses(fixtures);
  // ── Controller IP validation: warn if patched fixtures are missing IPs ──
  _validateControllerIps(fixtures);
}

/**
 * Explicit override — used by auto_patcher when it knows the result.
 */
function forceSet(active) {
  window._patchesActive = !!active;
  if (active) {
    _patchedCount = _totalCount;
  } else {
    _patchedCount = 0;
  }
  _updateWarning(!active && _totalCount > 0);
  console.log(`[PatchManager] patchesActive=${window._patchesActive} (forced)`);
}

// ─── Query Utilities ─────────────────────────────────────────────────────

/** True if at least one fixture has a valid DMX patch. */
function hasAnyPatch() { return _patchedCount > 0; }

/** True if ALL fixtures have valid DMX patches. */
function allPatched() { return _totalCount > 0 && _patchedCount === _totalCount; }

/** True if NO fixtures have valid DMX patches. */
function nonePatched() { return _patchedCount === 0; }

/** True if SOME (but not all) fixtures are patched — mixed state. */
function partiallyPatched() { return _patchedCount > 0 && _patchedCount < _totalCount; }

/** Get counts. */
function getPatchedCount() { return _patchedCount; }
function getTotalCount() { return _totalCount; }

// ─── Patch File I/O ──────────────────────────────────────────────────────

/**
 * Apply patch data from a parsed patches.yaml tree to a fixtures array.
 * Called during scene load (main.js) and after file reload.
 * @param {Object} patchTree - The `patches` object from patches.yaml
 * @param {Array} fixturesArray - The params.parLights array to merge into
 */
function applyPatchTree(patchTree, fixturesArray) {
  if (!patchTree || !fixturesArray) return;
  fixturesArray.forEach(fixture => {
    if (fixture.name && patchTree[fixture.name]) {
      Object.assign(fixture, patchTree[fixture.name]);
    }
  });
  recompute();
}

/**
 * Notify the sACN bridge server to reload routes from patches.yaml.
 * Call this after any patch change that has been saved to disk.
 *
 * REPORTS ITS OUTCOME (slice S1): resolves to `{ ok: boolean, reason?: string }`
 * and never rejects. "WebSocket not connected" is a FAILURE of this step, not a
 * console footnote — the bridge rebuilds its relay routes only on this message,
 * so a missed notify means the freshly saved patches.yaml is never read and the
 * hardware keeps following the old routes. The push flow renders the reason
 * verbatim; the other callers go through `notifySacnBridgeLoud` (slice S4),
 * which adds the toast + monitor line.
 *
 * @returns {Promise<{ok: boolean, scene?: string, reason?: string}>}
 */
async function notifySacnBridge() {
  try {
    if (window.sacnInput && window.sacnInput._ws && window.sacnInput._ws.readyState === 1) {
      const activeScene = window.__activeScene || 'titanic';
      window.sacnInput._ws.send(JSON.stringify({ type: 'setScene', scene: activeScene }));
      console.log('[PatchManager] sACN bridge notified to reload routes via WebSocket');
      return { ok: true, scene: activeScene };
    }
    const reason = 'sACN bridge WebSocket not connected — the bridge did NOT reload its routes';
    console.warn(`[PatchManager] ${reason}`);
    return { ok: false, reason };
  } catch (e) {
    const reason = `failed to notify the sACN bridge: ${e.message}`;
    console.warn(`[PatchManager] ${reason}`);
    return { ok: false, reason };
  }
}

/**
 * Surface a save/notify failure where the operator actually looks (slice S4).
 * A stale sACN feed is invisible from the sim's own render — the sim paints
 * from memory while the hardware follows the bridge's routes — so a swallowed
 * `console.warn` here is exactly how a controller stays dark for a day.
 *
 * Three surfaces, cheapest to loudest:
 *   1. `console.error` — always, unconditionally.
 *   2. the save toast (`window.showSaveToast`, red/6 s — same element the
 *      "SAVE FAILED" toast uses).
 *   3. a red line in the sACN-IN monitor's activity log (`window.sacnLog`).
 *
 * The two DOM surfaces are only present once the GUI has mounted (unit tests,
 * boot, static host have neither) — the console line is the one that can never
 * be missed, so nothing is ever swallowed.
 */
function _surfaceFailure(message) {
  console.error(`[PatchManager] ${message}`);
  if (typeof window.showSaveToast === 'function') window.showSaveToast(`⚠ ${message}`, true);
  if (typeof window.sacnLog === 'function') window.sacnLog(message, 'error');
}

/**
 * `notifySacnBridge` + the loud surface on failure. Use this from every path
 * that has no other way to report the outcome (the post-save notify, the
 * save-and-notify helper). The LED per-output push deliberately calls the
 * QUIET `notifySacnBridge` instead: it renders the same failure in its own
 * push dialog and toast, and a second toast would just repeat itself.
 *
 * @returns {Promise<{ok: boolean, scene?: string, reason?: string}>}
 */
async function notifySacnBridgeLoud() {
  const result = await notifySacnBridge();
  if (!result.ok) {
    _surfaceFailure(
      `sACN bridge NOT notified — ${result.reason}. The bridge is still routing ` +
      'from the patches.yaml it last read: the hardware will NOT follow this change. ' +
      'The page re-sends the notify automatically when the bridge WebSocket reconnects.'
    );
  }
  return result;
}

/**
 * Force a full scene save (which extracts patches.yaml server-side), then —
 * and only then — notify the sACN bridge. Use after an explicit, operator-
 * initiated patch change (auto-patch, clear-patch, manual patch edits).
 *
 * ORDERING (slice S4): the notify is chained on the AWAITED save, replacing
 * the old `setTimeout(notify, 500)`. That timer raced the save it was meant to
 * follow — and always lost when the save went through the 2 s debounce, so the
 * bridge re-read a STALE patches.yaml and reported success. On a failed save
 * the bridge is NOT notified at all: re-reading the old file is not progress,
 * it just makes a stale feed look fresh.
 *
 * Both failures are surfaced loudly (toast + monitor line + console). Never
 * rejects — fire-and-forget callers must not become unhandled rejections.
 *
 * @returns {Promise<{save: {ok: boolean, reason?: string},
 *                    notify: {ok: boolean, reason?: string}|null}>}
 */
async function saveAndNotify() {
  if (typeof window.exportConfig !== 'function') {
    const reason = 'window.exportConfig is not installed — nothing was saved and the ' +
      'sACN bridge was NOT notified';
    _surfaceFailure(reason);
    return { save: { ok: false, reason }, notify: null };
  }

  let save;
  try {
    save = await window.exportConfig();
  } catch (e) {
    save = { ok: false, reason: `the scene save threw: ${e.message}` };
  }
  // A save step that answers with no `{ok}` is a REFUSAL, not an assumed
  // success — same rule the push flow applies to its steps.
  if (!save || save.ok !== true) {
    const reason = (save && save.reason) || 'the scene save reported no result';
    _surfaceFailure(
      `scene NOT saved — ${reason}. The sACN bridge was NOT notified (it would only ` +
      're-read the stale patches.yaml); the hardware keeps following the old routes.'
    );
    return { save: save || { ok: false, reason }, notify: null };
  }

  const notify = await notifySacnBridgeLoud();
  return { save, notify };
}

// ─── Safety Poll ─────────────────────────────────────────────────────────
// Recompute every 10s as eventual consistency fallback. In the browser this
// returns a numeric id; under Node (unit tests import this module) it returns
// a Timeout — unref it so the poll never keeps the test process alive.
const _safetyPoll = setInterval(recompute, 10000);
if (_safetyPoll && typeof _safetyPoll.unref === 'function') _safetyPoll.unref();

// ─── Global Bridge (for non-module consumers) ────────────────────────────
window._patchesActive = false;
window.recomputePatchesActive = recompute;
window.setPatchesActive = forceSet;

const PatchManager = {
  recompute,
  forceSet,
  isActive: hasAnyPatch,
  hasAnyPatch,
  allPatched,
  nonePatched,
  partiallyPatched,
  getPatchedCount,
  getTotalCount,
  applyPatchTree,
  notifySacnBridge,
  notifySacnBridgeLoud,
  saveAndNotify,
  deriveSubscribedUniverses,
  autoSubscribePatchUniverses,
};
window.PatchManager = PatchManager;
export default PatchManager;
export {
  deriveSubscribedUniverses,
  autoSubscribePatchUniverses,
  notifySacnBridge,
  notifySacnBridgeLoud,
  saveAndNotify,
};
