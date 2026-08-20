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
//     and the engine fell back to the default to keep the exterior LIT), OR
//   - sizeLockWarning != null (something fought the engine's global SIZE pin
//     at 0.5 — a saved state file carried another value, or a writer tried
//     to change it. See marsin_engine/lib/size_lock.js; there is no SIZE
//     control in this app, so this chip is the operator's only view of it).
// The degrade predicate + reason are derived in useEngineHealth()
// (hooks/useEngineState.ts) so this component is purely presentational.
//
// Tap / hover reveals the full reason (Alert on tap; accessibilityLabel for
// hover / screen readers). The Pressable hit target is >= 44pt tall to stay
// comfortably tappable in the header.
//
// The amber accent USED to be hardcoded here because the Palette had no amber
// token. It does now: docs/54 §1.1 added the `warning` / `warningContainer` /
// `warningContainerBorder` family to all five palettes, each value contrast-
// picked against that theme's surfaces (the old fixed '#d98300' measured
// ~3.2:1 on the light header). This chip is the canonical caution chip, so it
// wears the caution tokens.

import React, { useMemo } from 'react';
import { Pressable, Text, View } from 'react-native';
import { opWarn } from '@/utils/op_dialog';
import { useEngineHealth } from '@/hooks/useEngineState';
import { usePalette } from '@/hooks/use-theme';
import { Radius, Type } from '@/constants/theme';

interface Props {
  /** Optional override for hidden-on-portrait behaviour, matching the
   *  CONNECTED label / model chip. The header passes `compact` (portrait)
   *  so the chip stays a tight icon-only badge in the narrow layout. */
  compact?: boolean;
}

export function HealthChip({ compact = false }: Props) {
  const { degraded, reason } = useEngineHealth();
  const C = usePalette();

  const styles = useMemo(
    () => ({
      chip: {
        minHeight: 44,
        flexDirection: 'row' as const,
        alignItems: 'center' as const,
        gap: 6,
        paddingHorizontal: compact ? 8 : 10,
        paddingVertical: 6,
        borderRadius: Radius.control,
        borderWidth: 1,
        backgroundColor: C.warningContainer,
        borderColor: C.warningContainerBorder,
      },
      label: {
        ...Type.labelCaps,
        textTransform: Type.labelCaps.textTransform as 'uppercase',
        color: C.warning,
      },
      reason: {
        fontFamily: 'SpaceGrotesk_700Bold',
        fontSize: 11,
        letterSpacing: 0.4,
        color: C.warning,
        maxWidth: 180,
      },
    }),
    [compact, C],
  );

  // Healthy engine ⇒ render NOTHING (no chrome, no layout shift). This is
  // the explicit "absence == healthy" path: a degraded engine sets
  // `degraded` true, so a missing/healthy snapshot correctly shows nothing.
  if (!degraded) return null;

  const full = `Engine health degraded — ${reason}`;

  return (
    <Pressable
      onPress={() => opWarn('Engine Health Degraded', reason)}
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
