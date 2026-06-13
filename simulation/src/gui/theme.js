/**
 * theme.js — Sim-side port of the CaptainPad theme system.
 *
 * Palette VALUES are ported verbatim from `CaptainPad/constants/theme.ts`
 * (`Colors`, `THEMES`, `THEME_ORDER`) so the sim and the iPad app share one
 * design language. `simulation/tests/theme_parity.test.js` extracts the
 * palettes from the TypeScript source and fails the build if these drift.
 *
 * The module self-initializes on import (index.html loads it before
 * main.js): it resolves the operator's persisted choice from localStorage
 * (`system` resolves via prefers-color-scheme), writes every palette token
 * as a CSS custom property on <html>, and wires the #theme-select picker
 * in the HUD bar. Switching themes restyles the whole UI live — all chrome
 * colors in style.css and inline JS styles reference these variables, so
 * no component can capture a boot-time palette.
 */

// ── Palettes (verbatim from CaptainPad/constants/theme.ts `Colors`) ────
const PALETTES = {
  light: {
    text: '#191c1d',
    background: '#f8f9fa',
    tint: '#006875',
    icon: '#bac9cc',
    tabIconDefault: '#bac9cc',
    tabIconSelected: '#006875',

    surface: '#f8f9fa',
    surfaceContainerLow: '#f3f4f5',
    surfaceContainerLowest: '#ffffff',
    surfaceContainerHigh: '#e7e8e9',
    surfaceDim: '#d9dadb',

    primary: '#006875',
    primaryContainer: '#00e5ff',
    primaryFixedDim: '#00daf3',
    onPrimary: '#ffffff',
    secondary: '#466270',
    secondaryContainer: '#c6e4f4',

    error: '#ba1a1a',
    errorContainer: 'rgba(186, 26, 26, 0.08)',
    errorContainerBorder: 'rgba(186, 26, 26, 0.3)',
    tertiary: '#1b9e77',
    ghostBorder: 'rgba(186, 201, 204, 0.4)',
    ambientShadow: 'rgba(25, 28, 29, 0.05)',

    sidebarBackground: 'rgba(255,255,255,0.6)',
    sidebarActiveBackground: 'rgba(0, 229, 255, 0.1)',
    sidebarActiveBorder: 'rgba(0, 229, 255, 0.3)',

    faderKnob: '#ffffff',
  },
  dark: {
    text: '#e3e6e8',
    background: '#0f1416',
    tint: '#5ae0ee',
    icon: '#7a8a8e',
    tabIconDefault: '#7a8a8e',
    tabIconSelected: '#5ae0ee',

    surface: '#0f1416',
    surfaceContainerLow: '#171d20',
    surfaceContainerLowest: '#0a0e10',
    surfaceContainerHigh: '#1f262a',
    surfaceDim: '#0a0e10',

    primary: '#5ae0ee',
    primaryContainer: '#003640',
    primaryFixedDim: '#7fe9f4',
    onPrimary: '#003640',
    secondary: '#a8c5d4',
    secondaryContainer: '#2a3e48',

    error: '#ff8a82',
    errorContainer: 'rgba(255, 138, 130, 0.16)',
    errorContainerBorder: 'rgba(255, 138, 130, 0.45)',
    tertiary: '#34d39a',
    ghostBorder: 'rgba(180, 195, 200, 0.18)',
    ambientShadow: 'rgba(0, 0, 0, 0.5)',

    sidebarBackground: 'rgba(15, 20, 22, 0.85)',
    sidebarActiveBackground: 'rgba(90, 224, 238, 0.12)',
    sidebarActiveBorder: 'rgba(90, 224, 238, 0.4)',

    faderKnob: '#4a575c',
  },
  midnight: {
    text: '#d4dde8',
    background: '#06080c',
    tint: '#5cc0ff',
    icon: '#5a6878',
    tabIconDefault: '#5a6878',
    tabIconSelected: '#5cc0ff',

    surface: '#06080c',
    surfaceContainerLow: '#0d1320',
    surfaceContainerLowest: '#04060a',
    surfaceContainerHigh: '#152030',
    surfaceDim: '#04060a',

    primary: '#5cc0ff',
    primaryContainer: '#003a5c',
    primaryFixedDim: '#7fcffa',
    onPrimary: '#001827',
    secondary: '#7a8a9e',
    secondaryContainer: '#2a3a4c',

    error: '#ff7a82',
    errorContainer: 'rgba(255, 122, 130, 0.16)',
    errorContainerBorder: 'rgba(255, 122, 130, 0.45)',
    tertiary: '#3ad4a6',
    ghostBorder: 'rgba(150, 170, 200, 0.18)',
    ambientShadow: 'rgba(0, 0, 0, 0.6)',

    sidebarBackground: 'rgba(6, 8, 12, 0.88)',
    sidebarActiveBackground: 'rgba(92, 192, 255, 0.12)',
    sidebarActiveBorder: 'rgba(92, 192, 255, 0.4)',

    faderKnob: '#3a4858',
  },
  gruvbox: {
    text: '#ebdbb2',
    background: '#282828',
    tint: '#fabd2f',
    icon: '#928374',
    tabIconDefault: '#928374',
    tabIconSelected: '#fabd2f',

    surface: '#282828',
    surfaceContainerLow: '#32302f',
    surfaceContainerLowest: '#1d2021',
    surfaceContainerHigh: '#3c3836',
    surfaceDim: '#1d2021',

    primary: '#fabd2f',
    primaryContainer: '#665c54',
    primaryFixedDim: '#fadc7f',
    onPrimary: '#282828',
    secondary: '#a89984',
    secondaryContainer: '#3c3836',

    error: '#fb4934',
    errorContainer: 'rgba(251, 73, 52, 0.16)',
    errorContainerBorder: 'rgba(251, 73, 52, 0.45)',
    tertiary: '#b8bb26',
    ghostBorder: 'rgba(168, 153, 132, 0.25)',
    ambientShadow: 'rgba(0, 0, 0, 0.55)',

    sidebarBackground: 'rgba(40, 40, 40, 0.88)',
    sidebarActiveBackground: 'rgba(250, 189, 47, 0.12)',
    sidebarActiveBorder: 'rgba(250, 189, 47, 0.4)',

    faderKnob: '#504945',
  },
  sunset: {
    text: '#f4e8d8',
    background: '#1a0f0a',
    tint: '#ffb84a',
    icon: '#7a6552',
    tabIconDefault: '#7a6552',
    tabIconSelected: '#ffb84a',

    surface: '#1a0f0a',
    surfaceContainerLow: '#251812',
    surfaceContainerLowest: '#100905',
    surfaceContainerHigh: '#2e2017',
    surfaceDim: '#100905',

    primary: '#ffb84a',
    primaryContainer: '#5a3a00',
    primaryFixedDim: '#ffc566',
    onPrimary: '#3a2400',
    secondary: '#b89478',
    secondaryContainer: '#3e2e1a',

    error: '#ff8a6a',
    errorContainer: 'rgba(255, 138, 106, 0.16)',
    errorContainerBorder: 'rgba(255, 138, 106, 0.45)',
    tertiary: '#9acb87',
    ghostBorder: 'rgba(180, 150, 120, 0.18)',
    ambientShadow: 'rgba(0, 0, 0, 0.55)',

    sidebarBackground: 'rgba(26, 15, 10, 0.88)',
    sidebarActiveBackground: 'rgba(255, 184, 74, 0.12)',
    sidebarActiveBorder: 'rgba(255, 184, 74, 0.4)',

    faderKnob: '#5a4533',
  },
};

// ── Theme registry (mirrors CaptainPad `THEMES` / `THEME_ORDER`) ───────
const THEMES = {
  light:    { id: 'light',    label: 'LIGHT',    base: 'light' },
  dark:     { id: 'dark',     label: 'DARK',     base: 'dark'  },
  midnight: { id: 'midnight', label: 'MIDNIGHT', base: 'dark'  },
  sunset:   { id: 'sunset',   label: 'SUNSET',   base: 'dark'  },
  gruvbox:  { id: 'gruvbox',  label: 'GRUVBOX',  base: 'dark'  },
};

const THEME_ORDER = ['light', 'dark', 'midnight', 'sunset', 'gruvbox'];

// Same role as CaptainPad's `@CaptainPad:themeMode` AsyncStorage key —
// sim keeps its own namespace because the two apps run in different
// storage scopes.
const STORAGE_KEY = 'bm26.sim.themeMode';

// camelCase palette token → --kebab-case CSS custom property.
function tokenToCssVar(token) {
  return `--${token.replace(/([A-Z])/g, '-$1').toLowerCase()}`;
}

function isThemeMode(v) {
  return v === 'system' || (typeof v === 'string' && v in THEMES);
}

let _mode = 'gruvbox';
const _systemDarkQuery = window.matchMedia('(prefers-color-scheme: dark)');

/** Resolve the operator preference to a concrete palette key. */
function resolvePaletteKey(mode) {
  if (mode === 'system') return _systemDarkQuery.matches ? 'dark' : 'light';
  return mode;
}

/** Write every palette token of the active theme onto <html> as a CSS
 *  custom property, plus data attributes for theme-conditional CSS. */
function applyCssVariables(paletteKey) {
  const palette = PALETTES[paletteKey];
  const rootStyle = document.documentElement.style;
  for (const [token, value] of Object.entries(palette)) {
    rootStyle.setProperty(tokenToCssVar(token), value);
  }
  document.documentElement.dataset.theme = paletteKey;
  document.documentElement.dataset.themeBase = THEMES[paletteKey].base;
}

/** Persist + apply an operator preference ('system' or a theme id). */
export function setThemeMode(mode) {
  if (!isThemeMode(mode)) {
    console.error(`[Theme] Unknown theme mode "${mode}" — keeping "${_mode}".`);
    return;
  }
  _mode = mode;
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch (err) {
    console.error('[Theme] Failed to persist theme preference:', err);
  }
  applyCssVariables(resolvePaletteKey(mode));
  _syncSelector();
}

export function getThemeMode() {
  return _mode;
}

export function getResolvedTheme() {
  return resolvePaletteKey(_mode);
}

// ── HUD selector ────────────────────────────────────────────────────────
function _syncSelector() {
  const select = document.getElementById('theme-select');
  if (select && select.value !== _mode) select.value = _mode;
}

function setupThemeSelector() {
  const select = document.getElementById('theme-select');
  if (!select) return;

  let html = '';
  for (const id of THEME_ORDER) {
    html += `<option value="${id}">${THEMES[id].label}</option>`;
  }
  html += '<option value="system">SYSTEM</option>';
  select.innerHTML = html;
  select.value = _mode;

  select.addEventListener('change', (e) => setThemeMode(e.target.value));
}

// ── Init (runs on import, before main.js) ──────────────────────────────
function initTheme() {
  // URL override (?theme=gruvbox) — applies AND persists, so themed
  // agent renders and the reload-persistence check use one mechanism.
  const urlTheme = new URLSearchParams(window.location.search).get('theme');
  let stored = null;
  try {
    stored = localStorage.getItem(STORAGE_KEY);
  } catch (err) {
    console.error('[Theme] localStorage unavailable:', err);
  }

  if (urlTheme !== null) {
    if (isThemeMode(urlTheme)) {
      _mode = urlTheme;
      try {
        localStorage.setItem(STORAGE_KEY, urlTheme);
      } catch (err) {
        console.error('[Theme] Failed to persist theme preference:', err);
      }
    } else {
      console.error(`[Theme] Invalid ?theme= value "${urlTheme}" — ignoring.`);
    }
  } else if (isThemeMode(stored)) {
    _mode = stored;
  }
  // Missing/unrecognized stored value falls through to 'gruvbox' — the
  // sim's default theme (operator decision 2026-06-12). 'system' remains
  // selectable from the picker.

  applyCssVariables(resolvePaletteKey(_mode));

  // Live-track OS scheme flips while in 'system' mode.
  _systemDarkQuery.addEventListener('change', () => {
    if (_mode === 'system') applyCssVariables(resolvePaletteKey(_mode));
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupThemeSelector);
  } else {
    setupThemeSelector();
  }
}

initTheme();

export { PALETTES, THEMES, THEME_ORDER, STORAGE_KEY };
