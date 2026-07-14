/**
 * scene_recovery.js — the HUD "Recover scene" (⟲) button.
 *
 * Lists the pre-save snapshots the save-server writes before every overwrite
 * (simulation/server/scene_backup.cjs) and lets the operator roll the current
 * scene back to any of them. The server takes a fresh "pre-restore" snapshot
 * of the live files first, so a mistaken restore is itself reversible.
 *
 * Patterned on scene_manager.js: same isStaticHost() gate (the backups API
 * lives on the dev save-server, unreachable from an HTTPS static host) and the
 * SAME themed modal singleton (showAlert / showListModal / showModal) so the
 * interaction.js keyboard guard via isSceneModalOpen() keeps working.
 *
 * Always derives the endpoint via saveHttpUrl (config-driven port) — never a
 * hardcoded :6970 (see save_endpoint.js for why).
 */

import { isStaticHost, logStaticHostSkip } from "../core/static_host.js";
import { saveHttpUrl } from "../core/save_endpoint.js";
import { showAlert, showListModal, showModal } from "./scene_manager.js";

function activeScene() {
  const select = document.getElementById('scene-select');
  return (select && select.value) || window.__activeScene || null;
}

/** Human-readable local timestamp for a backup's ISO createdAt. */
function formatWhen(createdAt) {
  const d = new Date(createdAt);
  return Number.isNaN(d.getTime()) ? String(createdAt) : d.toLocaleString();
}

async function handleRecover() {
  // Disarm the pending autosave FIRST. The debounced save (and the
  // beforeunload sendBeacon that would fire on the post-restore reload) must
  // not re-save the current in-browser state back over whatever we restore.
  if (typeof window.disarmUnloadGuard === 'function') window.disarmUnloadGuard();

  const scene = activeScene();
  if (!scene) return;

  let backups;
  try {
    const resp = await fetch(saveHttpUrl(`/backups?scene=${encodeURIComponent(scene)}`));
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    backups = await resp.json();
  } catch (e) {
    console.error('[Scene] Load backups failed:', e);
    await showAlert('Recover scene', String(e && e.message ? e.message : e));
    return;
  }

  if (!Array.isArray(backups) || backups.length === 0) {
    await showAlert('Recover scene', `No backups yet for "${scene}".`);
    return;
  }

  const chosen = await showListModal({
    title: 'Recover scene',
    message: `Pick a snapshot to restore "${scene}" to (newest first):`,
    items: backups.map((b) => ({
      primary: `${formatWhen(b.createdAt)} · ${b.trigger}`,
      secondary: `${(b.files || []).length} file(s)`,
      value: b,
    })),
  });
  if (!chosen) return;

  const ok = await showModal({
    title: 'Recover scene',
    message: `Restores "${scene}" to ${formatWhen(chosen.createdAt)}. Current ` +
      `on-disk state is backed up first; unsaved in-browser changes are discarded.`,
    okLabel: 'Restore',
    danger: true,
  });
  if (!ok) return;

  // Disarm again just before the write — nothing should have re-armed the
  // autosave while the modal was open, but the reload below fires
  // beforeunload, so this is the last line of defense (see #9 in the plan).
  if (typeof window.disarmUnloadGuard === 'function') window.disarmUnloadGuard();

  try {
    const resp = await fetch(saveHttpUrl(`/restore-backup?scene=${encodeURIComponent(scene)}`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: chosen.id }),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    // Reload so the whole scene (config, patches, views, controllers, cameras)
    // re-reads from the freshly restored files. A restored
    // marsin_engine/models/<scene>.js only reaches a running engine on its
    // next model load/restart — we deliberately do NOT poke the engine here.
    window.location.reload();
  } catch (e) {
    console.error('[Scene] Restore failed:', e);
    await showAlert('Restore failed', String(e && e.message ? e.message : e));
  }
}

/** Wire the HUD recover-scene button. Safe to call once on boot. */
export function setupSceneRecovery() {
  const btn = document.getElementById('scene-recover-btn');
  if (!btn) return;

  // The backups API lives on the dev save-server (port 6970); a static host
  // can't reach it, so hide the button instead of offering a dead control.
  if (isStaticHost()) {
    logStaticHostSkip('scene recovery (port 6970)');
    btn.style.display = 'none';
    return;
  }

  btn.addEventListener('click', handleRecover);
}
