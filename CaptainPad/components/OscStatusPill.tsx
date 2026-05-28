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
import { usePalette } from '@/hooks/use-theme';
import { Palette } from '@/constants/theme';
import { useOscStatus, OscPillState } from '@/hooks/useEngineState';

// Visual mapping. We keep these in one place so the pill body and
// the sheet header agree on color semantics.
//
//   off       → muted (listener intentionally disabled)
//   idle      → amber (enabled but nothing flowing — operator
//               probably needs to start their sender)
//   unmapped  → orange/error (packets are arriving but addresses
//               don't match any binding — config mistake)
//   live      → green/primary (values are flowing into the CPC)
//
// '#fff3cd' / '#7a5300' / '#f8d7da' / '#842029' / '#003a44' are
// semantic-state literals intentionally pinned across both themes — the
// "OSC unmapped" / "OSC idle" badges should look the same regardless of
// the operator's light/dark preference so the colour reads as a status
// signal, not a chrome accent.
function makeStateStyles(C: Palette): Record<OscPillState['state'], { bg: string; fg: string; border: string }> {
  return {
    off:      { bg: C.surfaceContainerHigh, fg: C.secondary, border: C.ghostBorder },
    idle:     { bg: '#fff3cd',              fg: '#7a5300',   border: '#e0b400' },
    unmapped: { bg: '#f8d7da',              fg: '#842029',   border: C.error },
    live:     { bg: C.primaryContainer,     fg: '#003a44',   border: C.primary },
  };
}

interface Props {
  /** Optional compact variant for tight horizontal space. */
  compact?: boolean;
}

export function OscStatusPill({ compact = false }: Props) {
  const C = usePalette();
  const status = useOscStatus();
  const [sheetVisible, setSheetVisible] = useState(false);

  // Tile dimensions mirror BpmTile / ColorPairButton so the COLORS · BPM
  // · OSC cluster reads as one row of compact status tiles, distinct
  // from the SPEED / SIZE sliders to the left. Operator request
  // 2026-05-28.
  const w = compact ? 60 : 86;
  const TILE_HEIGHT = 48;

  if (!status) {
    // First frame before any WS message lands — placeholder that
    // doesn't shift layout once real data arrives.
    return (
      <View style={{
        width: w, height: TILE_HEIGHT,
        paddingVertical: 4, paddingHorizontal: 6,
        borderRadius: 8, borderWidth: 1,
        backgroundColor: C.surface,
        borderColor: C.ghostBorder,
        justifyContent: 'space-between',
      }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={{
            fontFamily: 'SpaceGrotesk_700Bold', fontSize: 9,
            color: C.secondary, textTransform: 'uppercase', letterSpacing: 0.8,
          }}>OSC</Text>
        </View>
        <Text style={{
          fontFamily: 'SpaceGrotesk_700Bold', fontSize: 11,
          color: C.icon, textAlign: 'center',
        }}>…</Text>
      </View>
    );
  }

  const styles = makeStateStyles(C)[status.state];

  return (
    <>
      <TouchableOpacity
        onPress={() => setSheetVisible(true)}
        accessibilityLabel={`OSC listener status: ${status.state}, ${status.label}`}
        accessibilityRole="button"
        style={{
          width: w, height: TILE_HEIGHT,
          paddingVertical: 4, paddingHorizontal: 6,
          borderRadius: 8, borderWidth: 1,
          // Subtle bg tinted toward the state, but not flooded — keeps
          // the tile readable next to the other globals-cluster boxes.
          // The border + dot do the heavy state-signal lifting.
          backgroundColor: status.state === 'off' ? C.surface : styles.bg,
          borderColor: styles.border,
          justifyContent: 'space-between',
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={{
            fontFamily: 'SpaceGrotesk_700Bold', fontSize: 9,
            color: styles.fg, textTransform: 'uppercase', letterSpacing: 0.8,
          }}>OSC</Text>
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: styles.border }} />
        </View>
        <Text
          numberOfLines={1}
          style={{
            fontFamily: 'SpaceGrotesk_700Bold', fontSize: 11,
            color: styles.fg, textAlign: 'center', textTransform: 'uppercase', letterSpacing: 0.6,
          }}
        >
          {status.label}
        </Text>
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
  const C = usePalette();
  const { state, stats } = status;
  const styles = makeStateStyles(C)[state];
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
  const C = usePalette();
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
