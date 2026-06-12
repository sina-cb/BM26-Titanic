import { useMemo } from 'react';
import { StyleSheet } from 'react-native';

import { Palette } from '../constants/theme';
import { usePalette } from '../hooks/use-theme';

// Theme-aware factory for the shared style atoms. Recomputed when the
// palette flips (light <-> dark). Components should call
// `const gs = useGlobalStyles()` rather than importing a module-level
// `globalStyles` constant.

// shadow* style props are deprecated (react-native-web warns on every
// render; RN's new architecture prefers `boxShadow`). One string
// replaces the four shadow* props, with the opacity baked into an
// 8-digit hex color. `elevation` is untouched where present — it is
// the Android-native shadow, unrelated to this deprecation.
export function shadow(x: number, y: number, blur: number, hexColor: string, opacity: number): string {
  let hex = hexColor;
  if (/^#[0-9a-fA-F]{3}$/.test(hex)) {
    hex = '#' + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3];
  }
  const a = Math.round(Math.max(0, Math.min(1, opacity)) * 255)
    .toString(16).padStart(2, '0');
  return `${x}px ${y}px ${blur}px ${hex}${a}`;
}

export function makeGlobalStyles(C: Palette) {
  return StyleSheet.create({
    container: {
      flex: 1,
      flexDirection: 'row',
      backgroundColor: C.background,
    },
    leftPane: {
      flex: 1,
      backgroundColor: C.surfaceContainerLow,
      marginLeft: 20,
      marginTop: 20,
      marginBottom: 20,
      borderRadius: 24,
      padding: 24,
      borderWidth: 1,
      borderColor: C.ghostBorder,
    },
    rightPane: {
      flex: 2,
      padding: 20,
      flexDirection: 'column',
    },
    headline: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 20,
      color: C.text,
      textTransform: 'uppercase',
      letterSpacing: 1,
    },
    subtext: {
      fontFamily: 'Inter_400Regular',
      fontSize: 14,
      color: C.secondary,
      marginTop: 8,
    },
    ambientShadow: {
      boxShadow: shadow(0, 8, 24, C.text, 0.05),
      elevation: 3,
    },
    ghostBorder: {
      borderWidth: 1,
      borderColor: C.ghostBorder,
    },
    surfaceLow: {
      backgroundColor: C.surfaceContainerLow,
      borderRadius: 24,
    },
    surfaceLowest: {
      backgroundColor: C.surfaceContainerLowest,
      borderRadius: 16,
    },
    card: {
      backgroundColor: C.surfaceContainerLowest,
      padding: 16,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: C.ghostBorder,
    },
    macroButton: {
      backgroundColor: C.surfaceContainerLowest,
      height: 80,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: C.ghostBorder,
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: C.text,
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.05,
      shadowRadius: 24,
      elevation: 3,
    },
    glassOverlay: {
      backgroundColor: C.sidebarBackground,
      borderRadius: 12,
    },
  });
}

export type GlobalStyles = ReturnType<typeof makeGlobalStyles>;

export function useGlobalStyles(): GlobalStyles {
  const palette = usePalette();
  return useMemo(() => makeGlobalStyles(palette), [palette]);
}
