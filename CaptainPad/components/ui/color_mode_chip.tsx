// ColorModeChip — the app-wide "a colour mode is driving" badge
// (docs/61_colors_interaction_model.md §4.4, W4).
//
// WHY IT EXISTS (C5, docs/61 §1). Outside the Deck tab, nothing anywhere used
// to say a colour rotation / follow-note daemon was driving colorPalette1/2.
// The operator would see a colour pick on the Mixer flash and get eaten with
// no visible cause. This chip names the driver from EVERY tab (D3: all tabs,
// every active family) — the Mixer/CPC colour controls themselves stay
// ungated in this wave (D7, filed separately).
//
// LOUD, NOT SPAMMY. Same discipline as HealthChip: nothing driving ⇒ render
// NOTHING (no layout shift, no chrome change). It appears only while
// `rotationKind(...)` off the live broadcast resolves to something other
// than `'none'`.
//
// READ-ONLY, ON PURPOSE. The chip never stops anything — a surface that
// cannot show WHAT would freeze (no strip, no timing, no STOP context) must
// not be able to write a blind STOP (docs/61 §4.4). Tapping only navigates to
// the Deck tab and hints the deck workspace to restore the COLORS window
// (`requestDeckWindow('colors')` — a fire-and-forget UI hint, never a
// command); the STOP affordance lives ONLY on the COLORS window's driving
// strip (W2), where the operator can see what they're about to freeze.
//
// Derivation is 100% the landed W1 pure logic (`rotationKind` /
// `colorChipLabel`, colors_window_logic.ts) fed by `useColorAutopilotFrame()`
// (hooks/useEngineState.ts) — this component itself is presentational only.

import React, { useMemo } from 'react';
import { Pressable, Text } from 'react-native';
import { router } from 'expo-router';

import { rotationKind, colorChipLabel } from '@/components/deck/colors_window_logic';
import { requestDeckWindow } from '@/utils/deck_window_requests';
import { useColorAutopilotFrame } from '@/hooks/useEngineState';
import { usePalette } from '@/hooks/use-theme';
import { Radius, Type, type Palette } from '@/constants/theme';
import { accentWash } from '@/styles/design_recipes';

interface Props {
  /** Compact variant for tight space — single-line label, no wrap. Mirrors
   *  the HealthChip / MidiStatusChip `compact` convention. */
  compact?: boolean;
}

export function ColorModeChip({ compact = false }: Props) {
  const frame = useColorAutopilotFrame();
  const C = usePalette();
  const styles = useMemo(() => makeStyles(C), [C]);

  const kind = rotationKind(frame?.active, frame?.palettes, frame?.mode);
  const label = colorChipLabel(kind, frame?.notePc);

  // No colour mode driving ⇒ render NOTHING. `label === null` covers both
  // `kind === 'none'` (nothing active) and is the ONLY null case
  // colorChipLabel returns — see colors_window_logic.ts.
  if (label === null) return null;

  const onPress = () => {
    // Navigate to the Deck tab, then hint the deck workspace to restore the
    // COLORS window. Order matches docs/61 §4.4's "navigate to the Deck tab
    // (and open/restore the COLORS window)". No STOP affordance exists here
    // — see the module header.
    router.push('/');
    requestDeckWindow('colors');
  };

  return (
    <Pressable
      onPress={onPress}
      style={styles.chip}
      accessibilityRole="button"
      accessibilityLabel={`${label}. Open the Deck tab's COLORS window.`}
      testID="color-mode-chip"
    >
      <Text style={styles.label} numberOfLines={compact ? 1 : 4}>
        {'◉'} {label}
      </Text>
    </Pressable>
  );
}

function makeStyles(C: Palette) {
  // `tertiary` is the palette's "auto-driven" accent (docs/54 §1.1 — the same
  // token FOLLOW NOTE / TURNS / crossfade already wear inside the COLORS
  // window itself), never the amber `warning` family: this chip is
  // information, not a caution. `accentWash` (styles/design_recipes.ts) is
  // the house on-state recipe — translucent fill + accent border + accent
  // text, guaranteed to clear contrast on every theme's surfaces.
  const wash = accentWash(C.tertiary);
  return {
    chip: {
      minHeight: 44,
      paddingHorizontal: 6,
      paddingVertical: 6,
      borderRadius: Radius.control,
      borderWidth: 1,
      backgroundColor: wash.backgroundColor,
      borderColor: wash.borderColor,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
    },
    label: {
      ...Type.labelCaps,
      textTransform: Type.labelCaps.textTransform as 'uppercase',
      fontSize: 8,
      lineHeight: 10,
      letterSpacing: 0.2,
      textAlign: 'center' as const,
      color: wash.color,
    },
  };
}
