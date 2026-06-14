// Deck top bar.
//
// Visual parity with the Marsin Mixer header (`app/(tabs)/mixer.tsx`
// ~line 615): brand title on the left, connection-status badge, and
// the global master fader on the right. The deck deliberately does
// NOT show the "+ DEFAULT" / "+ FROM PLAYLIST" channel-add buttons —
// channel management is a mixer-tab responsibility; the deck is the
// "performance" surface.
//
// Master is read from the shared `useEngineState()` cache (populated
// by the mixer WS broadcast) so the deck mirrors any change made
// from the mixer tab, PortWatch, or HTTP without owning its own
// WS binding. Writes go through `updateMixerMaster` and are
// throttled to ~30 Hz to keep slow Wi-Fi from queueing PATCHes.

import React, { useMemo, useRef } from 'react';
import { View, Text, useWindowDimensions } from 'react-native';
import { usePalette } from '@/hooks/use-theme';
import { Palette } from '@/constants/theme';
import { HorizontalFader } from '@/components/ui/HorizontalFader';
import { useMaster, useActiveModel } from '@/hooks/useEngineState';
import { updateMixerMaster } from '@/utils/api';

interface Props {
  /** Connection state passed in from the deck screen. */
  isConnected: boolean | null;
  /** Optional display title — defaults to "Marsin Deck". */
  title?: string;
}

export function DeckTopBar({ isConnected, title = 'Marsin Deck' }: Props) {
  const palette = usePalette();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const { width, height } = useWindowDimensions();
  const isPortrait = width < height;
  const master = useMaster();
  // Active model name (GET /status → activeModel). Null until the first
  // probe lands / while offline — we hide the chip in that case, same
  // graceful-degrade posture as the OFFLINE status pill.
  const activeModel = useActiveModel();
  // Throttle PATCH writes to ~30 Hz — same cadence as the mixer
  // header, keeps the engine from being PATCH-spammed while still
  // letting the slider feel live.
  const lastWriteRef = useRef(0);

  const handleMasterChange = (val: number) => {
    const now = Date.now();
    if (now - lastWriteRef.current > 33) {
      lastWriteRef.current = now;
      updateMixerMaster(val).catch(() => undefined);
    }
  };

  return (
    <View style={[styles.header, isPortrait && { paddingHorizontal: 8 }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: isPortrait ? 8 : 16 }}>
        <Text style={[styles.brandText, isPortrait && { fontSize: 16 }]}>{title}</Text>
        <View style={[styles.statusBadge, isPortrait && { paddingHorizontal: 8, paddingVertical: 4 }]}>
          <View style={[styles.statusDot, !isConnected && { backgroundColor: palette.error }]} />
          {!isPortrait && (
            // '#00a86b' (MOD_GREEN) is the "connected/ok" green, intentionally
            // hardcoded — reads as success on both light and dark surfaces.
            <Text style={[styles.labelCaps, { color: isConnected ? '#00a86b' : palette.error }]}>
              {isConnected ? 'CONNECTED' : 'OFFLINE'}
            </Text>
          )}
        </View>
        {/* Active model chip — secondary status, after the connection
            pill. Hidden until the /status probe resolves and on
            portrait (matches the CONNECTED label's portrait behaviour)
            so the narrow header isn't crowded. */}
        {!isPortrait && activeModel ? (
          <View style={styles.modelChip}>
            <Text style={styles.labelCaps}>MODEL</Text>
            <Text style={styles.modelName} numberOfLines={1}>{activeModel}</Text>
          </View>
        ) : null}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: isPortrait ? 4 : 12 }}>
        {!isPortrait && <Text style={styles.labelCaps}>MASTER</Text>}
        <HorizontalFader
          value={master}
          onChange={handleMasterChange}
          trackStyle={[styles.faderTrack, { width: 180 }]}
          fillStyle={styles.faderFill}
        />
        <Text style={[
          styles.displayMono,
          { fontSize: 16, width: 36, textAlign: 'right' },
          isPortrait && { fontSize: 14, width: 28 },
        ]}>
          {Math.round(master * 100)}
        </Text>
      </View>
    </View>
  );
}

// Style tokens lifted from mixer.tsx so the two tabs match pixel-for-pixel.
function makeStyles(C: Palette) {
  return {
    header: {
      height: 64,
      backgroundColor: C.surfaceContainerLow,
      borderBottomWidth: 1,
      borderBottomColor: C.ghostBorder,
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      justifyContent: 'space-between' as const,
      paddingHorizontal: 24,
    },
    brandText: {
      color: C.primary,
      fontSize: 20,
      fontFamily: 'SpaceGrotesk_700Bold',
      letterSpacing: -0.5,
    },
    statusBadge: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: 8,
      backgroundColor: C.surfaceContainerHigh,
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: C.ghostBorder,
    },
    statusDot: {
      width: 8, height: 8, borderRadius: 4,
      // '#00a86b' MOD_GREEN — works on both themes (matches the connected label).
      backgroundColor: '#00a86b',
    },
    // Secondary "active model" chip. Same surface/border geometry as the
    // status badge so the two read as one toolbar; slightly tighter
    // padding to keep it visually subordinate to the connection pill.
    modelChip: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: 6,
      maxWidth: 200,
      backgroundColor: C.surfaceContainerHigh,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: C.ghostBorder,
    },
    modelName: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 11,
      letterSpacing: 0.4,
      color: C.primary,
      flexShrink: 1,
    },
    labelCaps: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 10,
      letterSpacing: 1.2,
      color: C.secondary,
      textTransform: 'uppercase' as const,
    },
    displayMono: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 18,
      color: C.primary,
    },
    faderTrack: {
      height: 16,
      backgroundColor: C.surfaceContainerHigh,
      borderRadius: 4,
    },
    faderFill: {
      position: 'absolute' as const,
      left: 0, top: 0, bottom: 0,
      backgroundColor: C.primaryFixedDim,
      borderRadius: 4,
    },
  };
}
