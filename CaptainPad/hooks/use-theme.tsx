// Theme context — resolves the active palette for CaptainPad.
//
// Operator can pick `'light'`, `'dark'`, or `'system'` from the Config
// tab. The preference is persisted to AsyncStorage and survives cold
// launches. `'system'` defers to the OS (`useRNColorScheme()`), which
// is what the historical `useColorScheme()` hook returned.
//
// All UI code should read the palette via `useTheme().palette` rather
// than importing `Colors.light.*` directly. Module-level
// `StyleSheet.create({ background: Colors.light.background })` patterns
// MUST be moved inside the component and recomputed with `useMemo` keyed
// on the palette — otherwise they capture the boot-time palette and
// don't re-render when the operator flips the toggle.
//
// Codex P0: a missing AsyncStorage value falls through to `'system'`
// (the historical behavior). An unrecognized value also falls through.
// These are not silent failures — they're documented defaults.

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useColorScheme as useRNColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { Colors, Palette, ThemeId, THEMES } from '@/constants/theme';

/** Operator preference: one of the registered theme IDs, or 'system' to
 *  follow the iPad's light/dark setting. */
export type ThemeMode = ThemeId | 'system';
/** The base mode used for React Navigation chrome. Always 'light' or 'dark'. */
export type ResolvedScheme = 'light' | 'dark';

const STORAGE_KEY = '@CaptainPad:themeMode';

function isThemeMode(v: unknown): v is ThemeMode {
  if (v === 'system') return true;
  return typeof v === 'string' && (v as ThemeId) in THEMES;
}

interface ThemeContextValue {
  /** Operator preference. */
  mode: ThemeMode;
  /** Actual rendered scheme (`'system'` resolved against the OS). */
  scheme: ResolvedScheme;
  /** Active palette object — same shape as `Colors.light`. */
  palette: Palette;
  /** Persist a new preference. Updates AsyncStorage in the same call. */
  setMode: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

interface ThemeProviderProps {
  children: React.ReactNode;
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const systemScheme = useRNColorScheme();
  const [mode, setModeState] = useState<ThemeMode>('system');

  // Hydrate the persisted preference on mount. We start in `'system'`
  // so existing installs (no key set) behave exactly as before.
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (isThemeMode(stored)) {
          setModeState(stored);
        }
      })
      .catch(() => undefined);
  }, []);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    AsyncStorage.setItem(STORAGE_KEY, next).catch(() => undefined);
  }, []);

  // `scheme` is the underlying light-or-dark mode used to flip React
  // Navigation chrome. For named themes we honour the registry's `base`;
  // for 'system' we follow the iPad's preference.
  const scheme: ResolvedScheme = useMemo(() => {
    if (mode === 'system') return systemScheme === 'dark' ? 'dark' : 'light';
    return THEMES[mode].base;
  }, [mode, systemScheme]);

  // `palette` is the actual colour set used by every component. 'system'
  // maps to the OS scheme; named themes pick their own palette directly.
  const paletteKey: ThemeId = useMemo(() => {
    if (mode === 'system') return systemScheme === 'dark' ? 'dark' : 'light';
    return mode;
  }, [mode, systemScheme]);

  const palette = Colors[paletteKey];

  const value = useMemo<ThemeContextValue>(
    () => ({ mode, scheme, palette, setMode }),
    [mode, scheme, palette, setMode],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    // P0: do not silently fall back to a default palette. If a component
    // is rendered outside the provider, we want the developer to see it.
    throw new Error('useTheme() called outside <ThemeProvider>');
  }
  return ctx;
}

/** Shorthand when only the palette is needed. */
export function usePalette(): Palette {
  return useTheme().palette;
}
