// HealthChip — small, non-intrusive amber "⚠ DEGRADED" warning rendered
// next to the header connection pill (deck + mixer) when the engine reports
// a degraded health signal on GET /status.
//
// Codex P0 (operator visibility): a HEALTHY engine renders NOTHING here (the
// component returns null) — no layout shift, no chrome change. The chip
// appears ONLY when the engine reports a degrade:
//   - renderHealth.ok === false  (a channel blend fell back to host-side
//     linear interp), OR
//   - deckRestoreDegraded != null (the saved deck pattern failed to restore
//     and the engine fell back to the default to keep the exterior LIT).
// The degrade predicate + reason are derived in useEngineHealth()
// (hooks/useEngineState.ts) so this component is purely presentational.
//
// Tap / hover reveals the full reason (Alert on tap; accessibilityLabel for
// hover / screen readers). The Pressable hit target is >= 44pt tall to stay
// comfortably tappable in the header.
//
// The amber accent is hardcoded (no amber token exists in the Palette and
// this is an additive feature) — same precedent as the header's hardcoded
// MOD_GREEN connected color. AMBER reads as a warning on both light and dark
// surfaces.

import React, { useMemo } from 'react';
import { Pressable, Text, Alert, View } from 'react-native';
import { useEngineHealth } from '@/hooks/useEngineState';

// Warning amber — readable on both the light (#f3f4f5-ish) and dark header
// surfaces. Mirrors the hardcoded '#00a86b' connected-green precedent in
// DeckTopBar / mixer.tsx (intentionally theme-agnostic accents).
const AMBER = '#d98300';
const AMBER_FILL = 'rgba(217, 131, 0, 0.16)';
const AMBER_BORDER = 'rgba(217, 131, 0, 0.55)';

interface Props {
  /** Optional override for hidden-on-portrait behaviour, matching the
   *  CONNECTED label / model chip. The header passes `compact` (portrait)
   *  so the chip stays a tight icon-only badge in the narrow layout. */
  compact?: boolean;
}

export function HealthChip({ compact = false }: Props) {
  const { degraded, reason } = useEngineHealth();

  const styles = useMemo(
    () => ({
      chip: {
        minHeight: 44,
        flexDirection: 'row' as const,
        alignItems: 'center' as const,
        gap: 6,
        paddingHorizontal: compact ? 8 : 10,
        paddingVertical: 6,
        borderRadius: 8,
        borderWidth: 1,
        backgroundColor: AMBER_FILL,
        borderColor: AMBER_BORDER,
      },
      label: {
        fontFamily: 'SpaceGrotesk_700Bold',
        fontSize: 10,
        letterSpacing: 1.2,
        color: AMBER,
        textTransform: 'uppercase' as const,
      },
      reason: {
        fontFamily: 'SpaceGrotesk_700Bold',
        fontSize: 11,
        letterSpacing: 0.4,
        color: AMBER,
        maxWidth: 180,
      },
    }),
    [compact],
  );

  // Healthy engine ⇒ render NOTHING (no chrome, no layout shift). This is
  // the explicit "absence == healthy" path: a degraded engine sets
  // `degraded` true, so a missing/healthy snapshot correctly shows nothing.
  if (!degraded) return null;

  const full = `Engine health degraded — ${reason}`;

  return (
    <Pressable
      onPress={() => Alert.alert('Engine Health Degraded', reason)}
      accessibilityRole="button"
      accessibilityLabel={full}
      style={styles.chip}
    >
      <Text style={styles.label}>{'⚠'} DEGRADED</Text>
      {!compact && reason ? (
        <View>
          <Text style={styles.reason} numberOfLines={1}>
            {reason}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}
