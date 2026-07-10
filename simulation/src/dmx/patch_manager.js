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
 * Loud by design: every auto-added universe is logged and the bridge is
 * re-notified. No silent failure — if `params.sacn_universes` is missing the
 * derived universes still flow through and the merge is reported.
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

  // Persist + re-notify the bridge so its routing/subscription picks up the
  // freshly-patched universes (saveAndNotify debounces the save).
  if (typeof window.debounceAutoSave === 'function') saveAndNotify();

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
 */
async function notifySacnBridge() {
  try {
    if (window.sacnInput && window.sacnInput._ws && window.sacnInput._ws.readyState === 1) {
      const activeScene = window.__activeScene || 'titanic';
      window.sacnInput._ws.send(JSON.stringify({ type: 'setScene', scene: activeScene }));
      console.log('[PatchManager] sACN bridge notified to reload routes via WebSocket');
    } else {
      console.warn('[PatchManager] sACN bridge WebSocket not connected, cannot notify');
    }
  } catch (e) {
    console.warn('[PatchManager] Failed to notify sACN bridge:', e.message);
  }
}

/**
 * Trigger a save (which extracts patches.yaml server-side) and notify sACN bridge.
 * Use after auto-patch, clear-patch, or manual patch edits.
 */
async function saveAndNotify() {
  if (window.debounceAutoSave) window.debounceAutoSave();
  // Give the save a moment to complete before notifying bridge
  setTimeout(() => { notifySacnBridge(); }, 500);
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
  saveAndNotify,
  deriveSubscribedUniverses,
  autoSubscribePatchUniverses,
};
window.PatchManager = PatchManager;
export default PatchManager;
export { deriveSubscribedUniverses, autoSubscribePatchUniverses };
