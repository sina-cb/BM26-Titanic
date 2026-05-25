// OSC listener status pill + diagnostic sheet for CaptainPad.
//
// Lives in the Global Params strip (CPCControls header). Four
// visual states derived from the engine's per-second `oscStats`
// WS broadcast — see useOscStatus() in @/hooks/useEngineState and
// docs/24_osc_integration.md §10.2 for the source spec.
//
// The pill is informational only in v1: tapping it opens a
// read-only sheet showing the live counters, listener address,
// last sender origin, and binding/allowlist counts. A future
// CaptainPad binding editor (docs/24 §15) would hang off the same
// sheet.

import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Modal } from 'react-native';
import { Colors } from '@/constants/theme';
import { useOscStatus, OscPillState } from '@/hooks/useEngineState';

const C = Colors.light;

// Visual mapping. We keep these in one place so the pill body and
// the sheet header agree on color semantics.
//
//   off       → muted (listener intentionally disabled)
//   idle      → amber (enabled but nothing flowing — operator
//               probably needs to start their sender)
//   unmapped  → orange/error (packets are arriving but addresses
//               don't match any binding — config mistake)
//   live      → green/primary (values are flowing into the CPC)
const STATE_STYLES: Record<OscPillState['state'], { bg: string; fg: string; border: string }> = {
  off:      { bg: C.surfaceContainerHigh, fg: C.secondary, border: C.ghostBorder },
  idle:     { bg: '#fff3cd',              fg: '#7a5300',   border: '#e0b400' },
  unmapped: { bg: '#f8d7da',              fg: '#842029',   border: C.error },
  live:     { bg: C.primaryContainer,     fg: '#003a44',   border: C.primary },
};

interface Props {
  /** Optional compact variant for tight horizontal space. */
  compact?: boolean;
}

export function OscStatusPill({ compact = false }: Props) {
  const status = useOscStatus();
  const [sheetVisible, setSheetVisible] = useState(false);

  if (!status) {
    // First frame before any WS message lands — placeholder that
    // doesn't shift layout once real data arrives.
    return (
      <View style={{
        paddingHorizontal: compact ? 6 : 8, paddingVertical: 3,
        borderRadius: 10, borderWidth: 1,
        backgroundColor: C.surfaceContainerHigh,
        borderColor: C.ghostBorder,
      }}>
        <Text style={{
          fontFamily: 'SpaceGrotesk_700Bold', fontSize: 9,
          color: C.secondary, textTransform: 'uppercase',
        }}>OSC …</Text>
      </View>
    );
  }

  const styles = STATE_STYLES[status.state];

  return (
    <>
      <TouchableOpacity
        onPress={() => setSheetVisible(true)}
        accessibilityLabel={`OSC listener status: ${status.state}, ${status.label}`}
        accessibilityRole="button"
        style={{
          flexDirection: 'row', alignItems: 'center', gap: 4,
          paddingHorizontal: compact ? 6 : 10, paddingVertical: 3,
          borderRadius: 10, borderWidth: 1,
          backgroundColor: styles.bg, borderColor: styles.border,
        }}
      >
        <Text style={{
          fontFamily: 'SpaceGrotesk_700Bold', fontSize: 9,
          color: styles.fg, textTransform: 'uppercase',
        }}>OSC</Text>
        <Text style={{
          fontFamily: 'SpaceGrotesk_700Bold', fontSize: 9,
          color: styles.fg,
        }}>{status.label}</Text>
      </TouchableOpacity>

      <OscDiagnosticSheet
        visible={sheetVisible}
        onClose={() => setSheetVisible(false)}
        status={status}
      />
    </>
  );
}

// ── Diagnostic sheet ───────────────────────────────────────────────────────

interface SheetProps {
  visible: boolean;
  onClose: () => void;
  status: OscPillState;
}

function OscDiagnosticSheet({ visible, onClose, status }: SheetProps) {
  const { state, stats } = status;
  const styles = STATE_STYLES[state];
  const referenceTime = stats.now ?? Date.now();
  const lastSeenSeconds = stats.lastSeenMs === 0
    ? '—'
    : `${Math.max(0, Math.floor((referenceTime - stats.lastSeenMs) / 1000))}s ago`;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{
        flex: 1, backgroundColor: 'rgba(0,0,0,0.7)',
        justifyContent: 'center', alignItems: 'center',
      }}>
        <View style={{
          width: 340, backgroundColor: C.surfaceContainerLowest,
          padding: 20, borderRadius: 12,
          borderWidth: 1, borderColor: C.ghostBorder,
        }}>
          {/* Header */}
          <View style={{
            flexDirection: 'row', alignItems: 'center', gap: 8,
            marginBottom: 16,
          }}>
            <View style={{
              paddingHorizontal: 10, paddingVertical: 4,
              borderRadius: 10, borderWidth: 1,
              backgroundColor: styles.bg, borderColor: styles.border,
            }}>
              <Text style={{
                fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10,
                color: styles.fg, textTransform: 'uppercase',
              }}>OSC {status.label}</Text>
            </View>
            <Text style={{
              fontFamily: 'SpaceGrotesk_700Bold', color: C.primary,
              fontSize: 14, textTransform: 'uppercase',
            }}>Listener</Text>
          </View>

          {/* Listener address */}
          <Row label="Listener" value={
            stats.enabled
              ? `${stats.host ?? '0.0.0.0'}:${stats.port ?? '—'}`
              : 'disabled at boot'
          } />
          <Row label="Bindings" value={String(stats.bindingsCount)} />
          <Row
            label="Allowed senders"
            value={stats.allowedSendersCount === 0 ? 'open (any sender)' : String(stats.allowedSendersCount)}
          />

          {/* Counters */}
          <View style={{
            marginTop: 12, paddingTop: 12,
            borderTopWidth: 1, borderTopColor: C.ghostBorder,
          }}>
            <Text style={{
              fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10,
              color: C.secondary, textTransform: 'uppercase',
              marginBottom: 8,
            }}>Last second</Text>
            <Row label="RX (received)" value={String(stats.rxMessagesPerSec)} />
            <Row label="Mapped" value={String(stats.mappedMessagesPerSec)} />
            <Row label="Dropped (no binding)" value={String(stats.droppedMessagesPerSec)} />
            <Row label="Invalid" value={String(stats.invalidMessagesPerSec)} />
          </View>

          {/* Origin info */}
          <View style={{
            marginTop: 12, paddingTop: 12,
            borderTopWidth: 1, borderTopColor: C.ghostBorder,
          }}>
            <Row label="Last sender" value={stats.lastSender ?? '—'} />
            <Row label="Last packet" value={lastSeenSeconds} />
          </View>

          {/* Close */}
          <TouchableOpacity
            onPress={onClose}
            style={{
              marginTop: 20, alignSelf: 'flex-end',
              backgroundColor: C.primary,
              paddingHorizontal: 24, paddingVertical: 12,
              borderRadius: 8,
            }}
          >
            <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: '#000' }}>CLOSE</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={{
      flexDirection: 'row', justifyContent: 'space-between',
      paddingVertical: 4,
    }}>
      <Text style={{
        fontFamily: 'SpaceGrotesk_700Bold', fontSize: 11,
        color: C.secondary, textTransform: 'uppercase',
      }}>{label}</Text>
      <Text style={{
        fontFamily: 'SpaceGrotesk_700Bold', fontSize: 11,
        color: C.text,
      }}>{value}</Text>
    </View>
  );
}
