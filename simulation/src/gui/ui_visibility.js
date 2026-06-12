/**
 * ui_visibility.js — Hotkey-cycled UI visibility modes.
 *
 * Pressing `H` steps through three modes:
 *   show_all → hide_noncritical → hide_all → show_all …
 *
 * Every UI element belongs to one of two categories:
 *   - non-critical: editing/browsing chrome (lighting controls, pattern
 *     editor, info panel, HUD frame, view preset buttons, view masks
 *     editor). Hidden from the first step onward.
 *   - critical: link-health monitors and alert banners (sACN in/out
 *     monitors, engine blackout / unpatched / spotlight warnings).
 *     Hidden only in hide_all.
 *
 * Visibility is applied via a body class + injected CSS so each panel's
 * own show/hide logic (e.g. the sACN monitors' mode-driven `.hidden`
 * class) is left untouched and restores exactly when the mode is lifted.
 */

const NONCRITICAL_SELECTORS = [
  '#gui-panel',
  '.lil-gui',
  '#pattern-editor-panel',
  '#info-panel',
  '#hud-frame',
  '#view-presets',
  '#view-masks-panel',
];

const CRITICAL_SELECTORS = [
  '#sacn-in-monitor-panel',
  '#sacn-out-monitor-panel',
  '#engine-blackout-warning',
  '#unpatched-warning',
  '#spotlight-warning',
  '#spotlight-cap-toast',
  '#dirty-indicator',
];

const MODES = ['show_all', 'hide_noncritical', 'hide_all'];

const MODE_LABELS = {
  show_all: '🖥 UI: everything visible',
  hide_noncritical: '🖥 UI: non-critical hidden (monitors + warnings stay)',
  hide_all: '🖥 UI: everything hidden',
};

const BODY_CLASSES = {
  hide_noncritical: 'ui-hide-noncritical',
  hide_all: 'ui-hide-all',
};

let _mode = 'show_all';

function injectStyles() {
  const noncrit = NONCRITICAL_SELECTORS;
  const all = [...NONCRITICAL_SELECTORS, ...CRITICAL_SELECTORS];
  const rule = (bodyClass, selectors) =>
    selectors.map((s) => `body.${bodyClass} ${s}`).join(',\n') + ' { display: none !important; }';
  const style = document.createElement('style');
  style.id = 'ui-visibility-styles';
  style.textContent = `${rule(BODY_CLASSES.hide_noncritical, noncrit)}\n${rule(BODY_CLASSES.hide_all, all)}`;
  document.head.appendChild(style);
}

function showModeToast(label) {
  let toast = document.getElementById('ui-visibility-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'ui-visibility-toast';
    toast.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:rgba(20,24,30,0.92);border:1px solid rgba(120,160,220,0.4);color:#cfe0ff;padding:8px 20px;border-radius:8px;font-family:Inter,sans-serif;font-size:13px;pointer-events:none;z-index:10000;opacity:0;transition:opacity 0.25s;';
    document.body.appendChild(toast);
  }
  toast.textContent = `${label} — [H] to cycle`;
  toast.style.opacity = '1';
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { toast.style.opacity = '0'; }, 2500);
}

export function getUiVisibilityMode() {
  return _mode;
}

export function setUiVisibilityMode(mode) {
  if (!MODES.includes(mode)) {
    throw new Error(`[ui_visibility] Unknown mode '${mode}'. Valid: ${MODES.join(', ')}`);
  }
  _mode = mode;
  for (const cls of Object.values(BODY_CLASSES)) document.body.classList.remove(cls);
  if (BODY_CLASSES[mode]) document.body.classList.add(BODY_CLASSES[mode]);
  showModeToast(MODE_LABELS[mode]);
  console.log(`[ui_visibility] Mode: ${mode}`);
}

export function cycleUiVisibility() {
  const next = MODES[(MODES.indexOf(_mode) + 1) % MODES.length];
  setUiVisibilityMode(next);
}

export function setupUiVisibility() {
  injectStyles();

  window.addEventListener('keydown', (event) => {
    // Same typing guard as core/interaction.js — never steal keys from inputs.
    if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA' || event.target.isContentEditable) {
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key.toLowerCase() !== 'h') return;
    cycleUiVisibility();
  });

  // Expose for agent tooling / console use.
  window.cycleUiVisibility = cycleUiVisibility;
  window.setUiVisibilityMode = setUiVisibilityMode;
  window.getUiVisibilityMode = getUiVisibilityMode;
}
