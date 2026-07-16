// Config tab → read-only MIDI section. Shows the capability state, each
// detected controller (status, resolved endpoints, any param-key errors), and
// the last inbound event — a poor-man's MIDI monitor for on-playa debugging.
// When MIDI is unavailable it says so plainly (the explicit capability gate)
// rather than hiding. Pure read of useMidiStatus(); no lifecycle here.

import React from 'react';
import { View, Text } from 'react-native';

import { useGlobalStyles } from '@/styles/globalStyles';
import { usePalette } from '@/hooks/use-theme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useMidiStatus } from '@/hooks/useMidiControl';
import { ControllerStatus } from '@/utils/midi';

const MOD_GREEN = '#00a86b';

function StatusDot({ color }: { color: string }) {
  return <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color }} />;
}

function ControllerCard({ status }: { status: ControllerStatus }) {
  const C = usePalette();
  const color =
    status.kind === 'connected' ? MOD_GREEN
      : status.kind === 'error' ? C.error
        : C.icon;
  const kindLabel = status.kind.toUpperCase();
  return (
    <View style={{
      backgroundColor: C.surfaceContainerLow, borderRadius: 8, padding: 12,
      borderWidth: 1, borderColor: C.ghostBorder, gap: 4,
    }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <StatusDot color={color} />
          <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 14, color: C.text }}>
            {status.label}
          </Text>
        </View>
        <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 11, color }}>{kindLabel}</Text>
      </View>
      {status.kind === 'connected' && (
        <>
          <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 12, color: C.secondary }}>
            In: <Text style={{ color: C.text }}>{status.sourceName ?? '—'}</Text>
          </Text>
          <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 12, color: C.secondary }}>
            Out: <Text style={{ color: C.text }}>{status.destinationName ?? '—'}</Text>
          </Text>
        </>
      )}
      {status.error && (
        <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 12, color: C.error }}>
          {status.error}
        </Text>
      )}
      {status.paramErrors && status.paramErrors.length > 0 && (
        <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 12, color: C.error }}>
          Unknown param keys: {status.paramErrors.map((e) => `${e.controlId}→${e.key}`).join(', ')}
        </Text>
      )}
      <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 12, color: C.icon }}>
        Last event: <Text style={{ color: C.secondary }}>{status.lastEvent ?? '—'}</Text>
      </Text>
    </View>
  );
}

export function MidiConfigSection() {
  const globalStyles = useGlobalStyles();
  const C = usePalette();
  const state = useMidiStatus();

  return (
    <View style={[globalStyles.card, { alignSelf: 'stretch', padding: 24, marginBottom: 24 }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <IconSymbol name="metronome" size={24} color={C.primary} />
        <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 16, color: C.text, letterSpacing: 1 }}>
          MIDI CONTROL
        </Text>
      </View>

      {!state.available ? (
        <View style={{
          backgroundColor: C.surfaceContainerLow, borderRadius: 8, padding: 12,
          borderWidth: 1, borderColor: C.ghostBorder,
        }}>
          <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 13, color: C.secondary, lineHeight: 19 }}>
            MIDI is not available on this platform. Direct MIDI control needs Web
            MIDI (desktop Chrome/Edge) or the native iPad module (a follow-up
            build). The rest of CaptainPad works normally without it.
          </Text>
        </View>
      ) : (
        <View style={{ gap: 12 }}>
          <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 12, color: C.secondary }}>
            Transport: <Text style={{ color: C.text, fontFamily: 'Inter_600SemiBold' }}>
              {state.transportKind === 'web' ? 'Web MIDI' : state.transportKind === 'native' ? 'Native CoreMIDI' : '—'}
            </Text>
          </Text>
          {state.profileError && (
            <View style={{
              backgroundColor: 'rgba(186, 26, 26, 0.08)', borderRadius: 8, padding: 12,
              borderWidth: 1, borderColor: 'rgba(186, 26, 26, 0.3)',
            }}>
              <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 13, color: C.error }}>
                Profile error: {state.profileError}
              </Text>
            </View>
          )}
          {state.statuses.length === 0 && !state.profileError ? (
            <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 13, color: C.icon }}>
              No controllers configured.
            </Text>
          ) : (
            state.statuses.map((s) => <ControllerCard key={s.deviceId} status={s} />)
          )}
        </View>
      )}
    </View>
  );
}
