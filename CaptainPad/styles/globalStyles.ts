import { useMemo } from 'react';
import { StyleSheet } from 'react-native';

import { Palette, Radius, Space, Type } from '../constants/theme';
import { usePalette } from '../hooks/use-theme';
import { isLightSurface, shadow } from './design_recipes';

// Theme-aware factory for the shared style atoms. Recomputed when the
// palette flips (light <-> dark). Components should call
// `const gs = useGlobalStyles()` rather than importing a module-level
// `globalStyles` constant.

// `shadow()` and the pure design recipes now live in `design_recipes.ts`
// (importable from the node-env vitest suite, which cannot load React
// Native). They are re-exported here because this is where every call site
// already imports them from — docs/54 §1.1 puts the recipes in globalStyles,
// and from a component's point of view that is still true.
export {
  accentFill, accentWash, glowFor, identityDot, isLightSurface, readableInk, shadow, withAlpha,
} from './design_recipes';

export function makeGlobalStyles(C: Palette) {
  // A panel is ONE object: fill + hairline + inset top highlight + ambient
  // shadow (docs/54 §1). The inset white line only exists on dark bases —
  // on a light ground it is invisible, and a shadow tuned for a dark ground
  // is a smudge on a light one, so the ambient flips too.
  const lightBase = isLightSurface(C.background);
  const ambient = lightBase
    ? shadow(0, 8, 24, C.text, 0.05)
    : shadow(0, 8, 24, '#000000', 0.45);
  const panelShadow = lightBase ? ambient : `inset ${shadow(0, 1, 0, '#ffffff', 0.06)}, ${ambient}`;

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
    // docs/54 row 12: height 80 is FROZEN (the toggle/momentary grid's
    // density is a feature); only the radius moves onto the scale — a macro
    // button is a card-sized object sitting on a panel, not a panel.
    macroButton: {
      backgroundColor: C.surfaceContainerLowest,
      height: 80,
      borderRadius: Radius.card,
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

    // ── docs/54 restyle recipes (R0: declared, not yet consumed) ──────
    //
    // These are ADDITIVE. Nothing renders them until slice R1 starts
    // swapping call sites over, which is why R0 is a zero-pixel change.

    /** A workspace window / modal surface — the "one object" chrome. */
    panel: {
      backgroundColor: C.surfaceContainerLow,
      borderRadius: Radius.panel,
      borderWidth: 1,
      borderColor: C.ghostBorder,
      boxShadow: panelShadow,
    },
    /** A card sitting ON a panel. Today's `card`, re-pointed at the radius
     *  scale (16 → 12) so cards read as nested inside panels rather than as
     *  peers of them. */
    cardOnPanel: {
      backgroundColor: C.surfaceContainerLowest,
      padding: Space.lg,
      borderRadius: Radius.card,
      borderWidth: 1,
      borderColor: C.ghostBorder,
    },
    /** The compact panel header: identity dot + title + right-aligned
     *  controls. Chrome-thin on purpose — every pixel spent on the header is
     *  a pixel off the pad. Height is the CALLER's (docs/54 §3: the restyle
     *  repaints headers, it never thickens them). */
    panelHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.sm,
    },
    /** The app's dominant label recipe, finally importable. */
    labelCaps: {
      ...Type.labelCaps,
      color: C.secondary,
    },
    /** One step below `labelCaps` — restore-rail chips, countdowns. */
    microCaps: {
      ...Type.microCaps,
      color: C.secondary,
    },
    /** A numeric readout beside a control. */
    valueText: {
      ...Type.valueText,
      color: C.text,
    },
  });
}

export type GlobalStyles = ReturnType<typeof makeGlobalStyles>;

export function useGlobalStyles(): GlobalStyles {
  const palette = usePalette();
  return useMemo(() => makeGlobalStyles(palette), [palette]);
}
