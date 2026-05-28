// Palette tokens for CaptainPad. Light is the default; dark is the
// operator's late-night option, toggled from the Config tab (see
// `useTheme()` + `useGlobalStyles()`).
//
// Both palettes MUST expose the exact same key set — code reads tokens
// dynamically via the active palette, and a missing key crashes loudly
// (Codex P0, no fallback behaviors).

export type Palette = {
  text: string;
  background: string;
  tint: string;
  icon: string;
  tabIconDefault: string;
  tabIconSelected: string;

  surface: string;
  surfaceContainerLow: string;
  surfaceContainerLowest: string;
  surfaceContainerHigh: string;
  surfaceDim: string;

  primary: string;
  primaryContainer: string;
  primaryFixedDim: string;
  /** Text/icon color rendered ON TOP of `primary` (button labels). */
  onPrimary: string;
  secondary: string;
  secondaryContainer: string;

  error: string;
  /** Translucent error fill for inline error boxes — readable in both themes. */
  errorContainer: string;
  /** Border companion for `errorContainer`. */
  errorContainerBorder: string;
  /** "Auto-driven / synced" green — BPM sync, autopilot, etc. */
  tertiary: string;
  ghostBorder: string;
  ambientShadow: string;

  /** Background tint used by the side-tab bar (glass over content). */
  sidebarBackground: string;
  /** Active-tab pill background in the side bar. */
  sidebarActiveBackground: string;
  /** Active-tab pill border in the side bar. */
  sidebarActiveBorder: string;

  /** Handle/thumb fill for vertical faders (Dimmer Rack NauticalFader).
   *  MUST visually contrast with `surfaceContainerHigh` (the track) on
   *  both themes — operator report 2026-05-28: in dark mode the knob
   *  inherited surfaceContainerLowest which was DARKER than the track,
   *  making the knob invisible against the page background. */
  faderKnob: string;
};

export const Colors: Record<'light' | 'dark' | 'midnight' | 'sunset' | 'gruvbox', Palette> = {
  // Luminance Command — daytime palette. Default; never break.
  light: {
    text: '#191c1d', // on-surface
    background: '#f8f9fa', // surface
    tint: '#006875', // primary
    icon: '#bac9cc', // outline-variant
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

    faderKnob: '#ffffff', // crisp white on the #e7e8e9 track
  },
  // Stage mode — late-night palette. Tuned for sustained reading on a
  // dim iPad (WCAG AA body text vs. background).
  dark: {
    text: '#e3e6e8', // ≥ 13:1 on background
    background: '#0f1416',
    tint: '#5ae0ee',
    icon: '#7a8a8e', // outline-variant
    tabIconDefault: '#7a8a8e',
    tabIconSelected: '#5ae0ee',

    surface: '#0f1416',
    surfaceContainerLow: '#171d20',
    surfaceContainerLowest: '#0a0e10',
    surfaceContainerHigh: '#1f262a',
    surfaceDim: '#0a0e10',

    primary: '#5ae0ee', // bright cyan reads well on dark surfaces
    primaryContainer: '#003640',
    primaryFixedDim: '#7fe9f4',
    onPrimary: '#003640', // dark text on bright primary stays readable
    secondary: '#a8c5d4',
    secondaryContainer: '#2a3e48',

    error: '#ff8a82', // softened red for dark bg
    errorContainer: 'rgba(255, 138, 130, 0.16)',
    errorContainerBorder: 'rgba(255, 138, 130, 0.45)',
    tertiary: '#34d39a',
    ghostBorder: 'rgba(180, 195, 200, 0.18)',
    ambientShadow: 'rgba(0, 0, 0, 0.5)',

    sidebarBackground: 'rgba(15, 20, 22, 0.85)',
    sidebarActiveBackground: 'rgba(90, 224, 238, 0.12)',
    sidebarActiveBorder: 'rgba(90, 224, 238, 0.4)',

    faderKnob: '#4a575c', // clearly lighter than the #1f262a track
  },

  // Midnight — deep blue-black for very low ambient light. Cool blue
  // accent (#5cc0ff). Bigger contrast on body text vs. dark for
  // late-late-night sessions.
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

  // Gruvbox Dark — retro warm palette, mustard-yellow accent. Mirrors
  // the medium-contrast variant most users mean by "gruvbox" (Pawel
  // Stradomski / Pavel Pertsev). Tokens picked to keep semantic colour
  // roles consistent with the other dark themes.
  gruvbox: {
    text: '#ebdbb2',             // fg1
    background: '#282828',       // bg0
    tint: '#fabd2f',             // yellow
    icon: '#928374',             // gray
    tabIconDefault: '#928374',
    tabIconSelected: '#fabd2f',

    surface: '#282828',          // bg0
    surfaceContainerLow: '#32302f',
    surfaceContainerLowest: '#1d2021', // bg0_h
    surfaceContainerHigh: '#3c3836',   // bg1
    surfaceDim: '#1d2021',

    primary: '#fabd2f',          // yellow — the gruvbox accent
    primaryContainer: '#665c54', // bg3
    primaryFixedDim: '#fadc7f',
    onPrimary: '#282828',        // dark text on yellow
    secondary: '#a89984',        // fg4
    secondaryContainer: '#3c3836',

    error: '#fb4934',            // red
    errorContainer: 'rgba(251, 73, 52, 0.16)',
    errorContainerBorder: 'rgba(251, 73, 52, 0.45)',
    tertiary: '#b8bb26',         // green — "synced/auto" accent
    ghostBorder: 'rgba(168, 153, 132, 0.25)',
    ambientShadow: 'rgba(0, 0, 0, 0.55)',

    sidebarBackground: 'rgba(40, 40, 40, 0.88)',
    sidebarActiveBackground: 'rgba(250, 189, 47, 0.12)',
    sidebarActiveBorder: 'rgba(250, 189, 47, 0.4)',

    faderKnob: '#504945',        // bg2 — clearly above the bg1 track
  },

  // Sunset — warm amber late-night. Easier on eyes pre-sleep; matches
  // a low-Kelvin lighting environment. Body bg has a hint of brown.
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

// ── Theme registry ──────────────────────────────────────────────────
//
// Single source of truth for the operator's pickable themes. Each entry
// names a palette in `Colors` plus its `base` (used to flip React
// Navigation between DefaultTheme and DarkTheme — the nav chrome only
// has those two modes). Add new themes by adding a palette above AND
// an entry here; Config tab + the use-theme hook pick them up
// automatically.

export type ThemeId = 'light' | 'dark' | 'midnight' | 'sunset' | 'gruvbox';

export interface ThemeDef {
  id: ThemeId;
  /** Operator-facing label in the Config picker. */
  label: string;
  /** One-line hint shown under the active option. */
  hint: string;
  /** Underlying base — drives navigation chrome (light vs dark theme). */
  base: 'light' | 'dark';
}

export const THEMES: Record<ThemeId, ThemeDef> = {
  light:    { id: 'light',    label: 'LIGHT',    hint: 'Daytime palette (default).',                          base: 'light' },
  dark:     { id: 'dark',     label: 'DARK',     hint: 'Late-night palette. Easier on the eyes at the podium.', base: 'dark'  },
  midnight: { id: 'midnight', label: 'MIDNIGHT', hint: 'Deep blue-black for very low ambient light.',         base: 'dark'  },
  sunset:   { id: 'sunset',   label: 'SUNSET',   hint: 'Warm amber low-light. Friendly pre-sleep.',           base: 'dark'  },
  gruvbox:  { id: 'gruvbox',  label: 'GRUVBOX',  hint: 'Retro warm palette with a mustard-yellow accent.',    base: 'dark'  },
};

/** Ordered list for picker rendering. */
export const THEME_ORDER: ThemeId[] = ['light', 'dark', 'midnight', 'sunset', 'gruvbox'];

export const Fonts = {
  headline: 'SpaceGrotesk_700Bold',
  headlineRegular: 'SpaceGrotesk_400Regular',
  body: 'Inter_400Regular',
  bodySemibold: 'Inter_600SemiBold',
};
