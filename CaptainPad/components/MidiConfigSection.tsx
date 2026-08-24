// Config tab → read-only MIDI section. Shows the capability state, each
// detected controller (status, resolved endpoints, any param-key errors,
// persistent endpoint-ambiguity notes, and the last inbound event — a
// poor-man's MIDI monitor for on-playa debugging), and the header runtime
// notice.  When MIDI is unavailable it says so plainly (the explicit
// capability gate) rather than hiding.
//
// The controller-neutral copy is deliberate: this rig runs three profiles at
// once (APC mini mk2 + MFT + VSN1), so the section header, chip, and empty
// state all say "MIDI" — the per-controller card names each device
// individually.

import React from 'react';
import { View, Text } from 'react-native';

import { useGlobalStyles } from '@/styles/globalStyles';
import { usePalette } from '@/hooks/use-theme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useMidiStatus } from '@/hooks/useMidiControl';
import { ControllerStatus, MidiTransportKind } from '@/utils/midi';

function StatusDot({ color }: { color: string }) {
  return <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color }} />;
}

/** Operator-facing label for the transport kind. */
function describeTransport(kind: MidiTransportKind): string {
  switch (kind) {
    case 'native': return 'Native CoreMIDI (iPad)';
    case 'web':    return 'Web MIDI (desktop Chromium)';
    case 'none':   return '—';
  }
}

function ControllerCard({ status }: { status: ControllerStatus }) {
  const C = usePalette();
  // Reuse the palette's semantic tokens for status colour so this section
  // matches the header chip (which now reads from `palette.tertiary` for the
  // connected green — docs/54 §1.1 unified the two).
  const color =
    status.kind === 'connected' ? C.tertiary
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
      {/* Non-sticky warning (auto-clears on the next successful send). Distinct
          from the persistent `notes` below: a warning is "your writes are
          failing right now"; a note is "your enumeration was ambiguous". */}
      {status.warning && (
        <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 12, color: C.tertiary }}>
          ⚠ {status.warning}
        </Text>
      )}
      {/* Persistent endpoint-resolution notes (multi-device ambiguity, etc.).
          Rendered under an amber tone so they read as steady-state facts, not
          urgent errors — the JS layer resolved to a specific port but the
          operator should know a second identical unit is on the bus. */}
      {status.notes && status.notes.length > 0 && (
        <View style={{ gap: 2 }}>
          {status.notes.map((note, i) => (
            <Text key={i} style={{ fontFamily: 'Inter_400Regular', fontSize: 12, color: C.tertiary }}>
              ℹ {note}
            </Text>
          ))}
        </View>
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
  // A configured profile is not a detected physical device. Keep absent
  // controllers out of the UI so an unplugged APC/MFT/VSN1 does not look like
  // a broken or required part of the current setup. Real endpoint/open errors
  // remain visible because they need operator action.
  const visibleStatuses = state.statuses.filter((status) => status.kind !== 'disconnected');

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
            MIDI is not available on this platform. Direct MIDI control needs
            desktop Chrome/Edge (Web MIDI) or the CaptainPad Release / dev-client
            iPad build that bundles the native CoreMIDI module. The rest of
            CaptainPad works normally without it.
          </Text>
        </View>
      ) : (
        <View style={{ gap: 12 }}>
          <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 12, color: C.secondary }}>
            Transport: <Text style={{ color: C.text, fontFamily: 'Inter_600SemiBold' }}>
              {describeTransport(state.transportKind)}
            </Text>
          </Text>
          {/* Header-level runtime notice (e.g. "autopilot disable failed"),
              routed here so it stays visible after the chip's own accessibility
              label scrolls off. Amber to match the same non-fatal register the
              per-controller warning uses. */}
          {state.notice && (
            <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 12, color: C.tertiary }}>
              ⚠ {state.notice}
            </Text>
          )}
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
          {visibleStatuses.length === 0 && !state.profileError ? (
            <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 13, color: C.icon }}>
              No MIDI controllers detected.
            </Text>
          ) : (
            visibleStatuses.map((s) => <ControllerCard key={s.deviceId} status={s} />)
          )}
        </View>
      )}
    </View>
  );
}
