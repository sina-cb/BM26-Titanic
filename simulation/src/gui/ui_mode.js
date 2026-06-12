/**
 * ui_mode.js — UI implementation toggle for the strangler migration.
 *
 * `?ui=modern` mounts the Preact-based panels (src/gui/modern/) for the
 * surfaces that have been migrated; everything else keeps the legacy
 * implementation. `?ui=legacy` (or no param) is byte-identical legacy
 * behavior — the default until the rehaul reaches cutover (task 019).
 *
 * Deliberately URL-param only (no persistence): the operator must opt in
 * per load while the modern UI is under construction.
 */

const VALID_UI_MODES = new Set(['legacy', 'modern']);

function resolveUiMode() {
  const requested = new URLSearchParams(window.location.search).get('ui');
  if (requested === null) return 'legacy';
  if (!VALID_UI_MODES.has(requested)) {
    console.error(`[UI] Invalid ?ui= value "${requested}" — using "legacy".`);
    return 'legacy';
  }
  return requested;
}

export const UI_MODE = resolveUiMode();
export const IS_MODERN_UI = UI_MODE === 'modern';
