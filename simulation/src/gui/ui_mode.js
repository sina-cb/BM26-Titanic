/**
 * ui_mode.js — UI implementation toggle for the strangler migration.
 *
 * The modern UI (Preact panels in src/gui/modern/ + the MarsinGui control
 * engine in src/gui/modern_gui/) is the DEFAULT since the task-019
 * cutover. `?ui=legacy` is the escape hatch and remains byte-identical
 * legacy behavior; it stays available until the post-cutover soak ends
 * and lil-gui is removed (task 019 remainder).
 *
 * Deliberately URL-param only (no persistence): mode is an engineering
 * switch, not an operator preference.
 */

const VALID_UI_MODES = new Set(['legacy', 'modern']);

function resolveUiMode() {
  const requested = new URLSearchParams(window.location.search).get('ui');
  if (requested === null) return 'modern';
  if (!VALID_UI_MODES.has(requested)) {
    console.error(`[UI] Invalid ?ui= value "${requested}" — using "modern".`);
    return 'modern';
  }
  return requested;
}

export const UI_MODE = resolveUiMode();
export const IS_MODERN_UI = UI_MODE === 'modern';
